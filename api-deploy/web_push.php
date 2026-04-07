<?php
// web_push.php — Pure PHP Web Push sender (no composer dependencies).
//
// Uses VAPID authentication and RFC 8291 payload encryption (AES-128-GCM + ECDH).
// Requires PHP 7.4+ with openssl extension.
//
// Usage:
//   require_once __DIR__ . '/web_push.php';
//   web_push_send($subscription, $payload, $options);
//
// where $subscription = [
//   'endpoint' => 'https://fcm.googleapis.com/...',
//   'keys'     => ['p256dh' => '...', 'auth' => '...'],
// ];

if (!defined('WEB_PUSH_PRIVATE_KEY')) {
    define('WEB_PUSH_PRIVATE_KEY', ''); // Set in config.php
}
if (!defined('WEB_PUSH_SUBJECT')) {
    define('WEB_PUSH_SUBJECT', 'mailto:push@example.com'); // Set in config.php
}

// ── Base64 helpers ────────────────────────────────────────────

function web_push_urlsafe_b64_decode(string $input): string {
    $padding = str_repeat('=', (4 - strlen($input) % 4) % 4);
    return base64_decode(strtr($input, '-_', '+/') . $padding);
}

function web_push_urlsafe_b64_encode(string $input): string {
    return rtrim(strtr(base64_encode($input), '+/', '-_'), '=');
}

// ── VAPID JWT ─────────────────────────────────────────────────

function web_push_vapid_jwt(string $audience): string {
    $privateKey = defined('WEB_PUSH_PRIVATE_KEY')
        ? WEB_PUSH_PRIVATE_KEY
        : getenv('WEB_PUSH_PRIVATE_KEY');

    if (empty($privateKey)) {
        throw new \RuntimeException('WEB_PUSH_PRIVATE_KEY not configured');
    }

    $now = time();
    $header = ['typ' => 'JWT', 'alg' => 'ES256'];
    $claims = [
        'aud'  => $audience,
        'exp'  => $now + 12 * 3600, // 12 hours
        'sub'  => defined('WEB_PUSH_SUBJECT') ? WEB_PUSH_SUBJECT : getenv('WEB_PUSH_SUBJECT') ?: 'mailto:push@example.com',
    ];

    $headerB64  = web_push_urlsafe_b64_encode(json_encode($header, JSON_UNESCAPED_SLASHES));
    $claimsB64  = web_push_urlsafe_b64_encode(json_encode($claims, JSON_UNESCAPED_SLASHES));
    $input      = "{$headerB64}.{$claimsB64}";

    openssl_sign($input, $signature, $privateKey, OPENSSL_ALGO_SHA256);
    $signatureB64 = web_push_urlsafe_b64_encode($signature);

    return "{$input}.{$signatureB64}";
}

// ── RFC 8291 Payload Encryption (AES-128-GCM + ECDH) ────────

function web_push_encrypt_payload(string $payload, string $userPublicKey, string $userAuth): array
{
    // Decode keys
    $userKey = web_push_urlsafe_b64_decode($userPublicKey);
    $authKey = web_push_urlsafe_b64_decode($userAuth);

    // Generate local ECDH key pair
    $localKeyPair = openssl_pkey_new([
        'curve_name'       => 'prime256v1',
        'ec_private_key'   => null,
    ]);
    $localKeyDetails = openssl_pkey_get_details($localKeyPair);
    $localPublicKey  = $localKeyDetails['key'];

    // Extract raw public key (65 bytes: 04 || x || y)
    $localPublicKeyRaw = '';
    // Parse the PEM to get raw bytes
    $keyInfo = openssl_pkey_get_details($localKeyPair);
    foreach ($keyInfo['ec']['pub_key_points'] ?? [] as $point) {
        $localPublicKeyRaw .= chr($point);
    }
    // If the above doesn't work (PHP version dependent), use the DER approach
    if (strlen($localPublicKeyRaw) !== 65) {
        $localPublicKeyRaw = web_push_extract_uncompressed_public_key($localKeyPair);
    }

    // Shared secret via ECDH
    $shared = openssl_dh_compute_key($localKeyPair, $userKey);
    if ($shared === false) {
        // Try using the raw key as a PEM
        $userKeyPem = "-----BEGIN PUBLIC KEY-----\n" .
            chunk_split(base64_encode(
                "\x04" . $userKey // prepend uncompressed point marker if not present
            ), 64) .
            "-----END PUBLIC KEY-----";
        $shared = openssl_dh_compute_key($localKeyPair, $userKeyPem);
    }
    if ($shared === false) {
        throw new \RuntimeException('ECDH shared secret computation failed');
    }

    // HKDF (RFC 5869) — HMAC-SHA256 based key derivation
    // info = "Content-Encoding: auth\0"
    // info = "Content-Encoding: p256dh\0"
    // info = "Content-Encoding: aes128gcm\0"

    // PRK = HKDF-Extract(salt=userAuth, IKM=shared)
    $prk = hash_hmac('sha256', $shared, $authKey, true);

    // clientToken = HKDF-Expand(PRK, "WebPush: info\0" || 0x00 || 0x00, 16)
    $clientToken = web_push_hkdf_expand($prk, "WebPush: info\x00", 16);

    // nonce = HKDF-Expand(PRK, "Content-Encoding: nonce\0" || 0x00 || 0x00, 12)
    $nonce = web_push_hkdf_expand($prk, "Content-Encoding: nonce\x00", 12);

    // contentEncryptionKey = HKDF-Expand(PRK, "Content-Encoding: aes128gcm\0" || 0x00 || 0x00, 16)
    $cek = web_push_hkdf_expand($prk, "Content-Encoding: aes128gcm\x00", 16);

    // Encrypt payload with AES-128-GCM
    $iv = $nonce; // 12 bytes
    $ciphertext = openssl_encrypt($payload, 'aes-128-gcm', $cek, OPENSSL_RAW_DATA, $iv, $tag);

    if ($ciphertext === false) {
        throw new \RuntimeException('AES-128-GCM encryption failed');
    }

    // Build the encrypted payload (RFC 8291)
    // salt(16) || localPublicKey(65) || ciphertext || tag(16)
    $salt = random_bytes(16);
    $result = $salt . $localPublicKeyRaw . $ciphertext . $tag;

    // Base64url-encode for the body
    return [
        'body'    => web_push_urlsafe_b64_encode($result),
        'headers' => [
            'Content-Encoding'          => 'aes128gcm',
            'Crypto-Key'                => 'p256ecdsa=' . web_push_urlsafe_b64_encode($localPublicKeyRaw),
        ],
    ];
}

function web_push_extract_uncompressed_public_key($keyPair): string {
    $details = openssl_pkey_get_details($keyPair);
    if (isset($details['ec']) && isset($details['ec']['x']) && isset($details['ec']['y'])) {
        return "\x04" .
            str_pad($details['ec']['x'], 32, "\x00", STR_PAD_LEFT) .
            str_pad($details['ec']['y'], 32, "\x00", STR_PAD_LEFT);
    }
    // Fallback: extract from DER
    $der = $details['key'];
    $pos = strpos($der, "\x04");
    if ($pos !== false) {
        return substr($der, $pos, 65);
    }
    throw new \RuntimeException('Cannot extract raw public key');
}

function web_push_hkdf_expand(string $prk, string $info, int $length): string {
    // Simple HKDF-Expand for single iteration (length <= 32)
    $hashLen = 32; // SHA-256
    $n = (int) ceil($length / $hashLen);
    $okm = '';

    for ($i = 1; $i <= $n; $i++) {
        $okm .= $t = hash_hmac('sha256', $t . $info . chr($i), $prk, true);
    }

    return substr($okm, 0, $length);
}

// ── Main send function ────────────────────────────────────────

/**
 * Send a Web Push notification.
 *
 * @param array $subscription  Push subscription object: ['endpoint' => ..., 'keys' => ['p256dh' => ..., 'auth' => ...]]
 * @param array $payload       Associative array of data to send (will be JSON-encoded)
 * @param int   $ttl           Time-to-live in seconds (default 24 hours)
 * @return bool  True on success
 */
function web_push_send(array $subscription, array $payload, int $ttl = 86400): bool
{
    $endpoint = $subscription['endpoint'] ?? '';
    $p256dh   = $subscription['keys']['p256dh'] ?? '';
    $auth     = $subscription['keys']['auth']   ?? '';

    if (empty($endpoint) || empty($p256dh) || empty($auth)) {
        error_log('WebPush: invalid subscription (missing endpoint/keys)');
        return false;
    }

    $jsonPayload = json_encode($payload, JSON_UNESCAPED_UNICODE);

    try {
        // Encrypt payload
        $encrypted = web_push_encrypt_payload($jsonPayload, $p256dh, $auth);
    } catch (\Throwable $e) {
        error_log('WebPush encryption error: ' . $e->getMessage());
        return false;
    }

    // VAPID JWT
    $origin = parse_url($endpoint, PHP_URL_ORIGIN);
    if (!$origin) {
        error_log('WebPush: cannot parse endpoint origin: ' . $endpoint);
        return false;
    }

    try {
        $jwt = web_push_vapid_jwt($origin);
    } catch (\Throwable $e) {
        error_log('WebPush VAPID error: ' . $e->getMessage());
        return false;
    }

    // Build Crypto-Key header (VAPID)
    $privateKeyRaw = defined('WEB_PUSH_PRIVATE_KEY')
        ? WEB_PUSH_PRIVATE_KEY
        : getenv('WEB_PUSH_PRIVATE_KEY');
    $vapidPublicKey = web_push_extract_vapid_public_key($privateKeyRaw);

    $cryptoKey = $encrypted['headers']['Crypto-Key'];
    if (!empty($vapidPublicKey)) {
        $cryptoKey .= ';p256ecdsa=' . web_push_urlsafe_b64_encode($vapidPublicKey);
    }

    // Send via cURL
    $headers = [
        'Content-Type: application/octet-stream',
        'Authorization: vapid t=' . $jwt,
        'TTL: ' . $ttl,
        'Content-Encoding: ' . $encrypted['headers']['Content-Encoding'],
        'Crypto-Key: ' . $cryptoKey,
    ];

    $ch = curl_init($endpoint);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_POSTFIELDS     => $encrypted['body'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 5,
        CURLOPT_FOLLOWLOCATION => true,
    ]);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);

    if ($curlError) {
        error_log("WebPush cURL error: {$curlError}");
        return false;
    }

    if ($httpCode === 200 || $httpCode === 201) {
        return true;
    }

    error_log("WebPush error HTTP {$httpCode}: {$response}");

    // 404 or 410 = subscription expired/gone → should be cleaned up
    if ($httpCode === 404 || $httpCode === 410) {
        // Caller should clean up the subscription from DB
        return false;
    }

    return false;
}

function web_push_extract_vapid_public_key(string $privateKeyPem): string {
    // If the private key is a PEM, extract the public key from it
    if (str_contains($privateKeyPem, '-----')) {
        $key = openssl_pkey_get_private($privateKeyPem);
        if ($key) {
            $details = openssl_pkey_get_details($key);
            if (isset($details['ec']['x']) && isset($details['ec']['y'])) {
                return "\x04" .
                    str_pad($details['ec']['x'], 32, "\x00", STR_PAD_LEFT) .
                    str_pad($details['ec']['y'], 32, "\x00", STR_PAD_LEFT);
            }
        }
    }
    // If it's URL-safe base64 (raw private key bytes), we need the public key separately
    // In this case, caller should set WEB_PUSH_PUBLIC_KEY
    return '';
}

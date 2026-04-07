<?php
// web_push.php — Pure PHP Web Push sender (RFC 8291 / RFC 8292).
//
// Uses VAPID authentication and RFC 8291 payload encryption (AES-128-GCM + ECDH).
// Requires PHP 7.4+ with openssl extension.
//
// Usage:
//   require_once __DIR__ . '/web_push.php';
//   web_push_send($subscription, $payload);
//
// where $subscription = [
//   'endpoint' => 'https://fcm.googleapis.com/...',
//   'keys'     => ['p256dh' => '...', 'auth' => '...'],
// ];

if (!defined('WEB_PUSH_PRIVATE_KEY')) {
    define('WEB_PUSH_PRIVATE_KEY', '');
}
if (!defined('WEB_PUSH_SUBJECT')) {
    define('WEB_PUSH_SUBJECT', 'mailto:push@example.com');
}

// ── Base64 helpers ────────────────────────────────────────────

function web_push_urlsafe_b64_decode(string $input): string {
    $padding = str_repeat('=', (4 - strlen($input) % 4) % 4);
    return base64_decode(strtr($input, '-_', '+/') . $padding);
}

function web_push_urlsafe_b64_encode(string $input): string {
    return rtrim(strtr(base64_encode($input), '+/', '-_'), '=');
}

// ── VAPID key handling ───────────────────────────────────────

/**
 * Convert a raw URL-safe Base64 VAPID private key (32 bytes) to a PEM string
 * that openssl_sign() can use.
 */
function web_push_raw_key_to_pem(string $rawBase64): string {
    $raw = web_push_urlsafe_b64_decode($rawBase64);
    if (strlen($raw) !== 32) {
        throw new \RuntimeException('Invalid VAPID private key: expected 32 bytes, got ' . strlen($raw));
    }

    $oid = "\x2A\x86\x48\xCE\x3D\x03\x01\x07"; // prime256v1

    $seqContent = "\x02\x01\x01"              // version = 1
        . "\x04\x20" . $raw                   // OCTET STRING: 32-byte private key
        . "\xA0\x0A\x06\x08" . $oid;          // CONTEXT[0]: curve OID

    $der = "\x30" . chr(strlen($seqContent)) . $seqContent;

    return "-----BEGIN EC PRIVATE KEY-----\n"
        . chunk_split(base64_encode($der), 64)
        . "-----END EC PRIVATE KEY-----";
}

function web_push_get_private_key_pem(): string {
    static $pem = null;
    if ($pem !== null) return $pem;

    $raw = defined('WEB_PUSH_PRIVATE_KEY') ? WEB_PUSH_PRIVATE_KEY : getenv('WEB_PUSH_PRIVATE_KEY');
    if (empty($raw)) {
        throw new \RuntimeException('WEB_PUSH_PRIVATE_KEY not configured');
    }

    if (str_contains($raw, '-----BEGIN')) {
        $pem = $raw;
        return $pem;
    }

    $pem = web_push_raw_key_to_pem($raw);
    return $pem;
}

function web_push_get_vapid_public_key_raw(): string {
    static $pub = null;
    if ($pub !== null) return $pub;

    $pem = web_push_get_private_key_pem();
    $key = openssl_pkey_get_private($pem);
    if (!$key) {
        throw new \RuntimeException('Failed to load VAPID private key: ' . openssl_error_string());
    }

    $details = openssl_pkey_get_details($key);
    if (!isset($details['ec']['x']) || !isset($details['ec']['y'])) {
        throw new \RuntimeException('VAPID key is not an EC key');
    }

    $pub = "\x04"
        . str_pad($details['ec']['x'], 32, "\x00", STR_PAD_LEFT)
        . str_pad($details['ec']['y'], 32, "\x00", STR_PAD_LEFT);

    return $pub;
}

// ── VAPID JWT ─────────────────────────────────────────────────

function web_push_vapid_jwt(string $audience): string {
    $privateKeyPem = web_push_get_private_key_pem();
    $subject = defined('WEB_PUSH_SUBJECT') ? WEB_PUSH_SUBJECT
        : (getenv('WEB_PUSH_SUBJECT') ?: 'mailto:push@example.com');

    $now = time();
    $header = ['typ' => 'JWT', 'alg' => 'ES256'];
    $claims = [
        'aud'  => $audience,
        'exp'  => $now + 12 * 3600,
        'sub'  => $subject,
    ];

    $headerB64  = web_push_urlsafe_b64_encode(json_encode($header, JSON_UNESCAPED_SLASHES));
    $claimsB64  = web_push_urlsafe_b64_encode(json_encode($claims, JSON_UNESCAPED_SLASHES));
    $input      = "{$headerB64}.{$claimsB64}";

    $ok = openssl_sign($input, $signature, $privateKeyPem, OPENSSL_ALGO_SHA256);
    if (!$ok) {
        throw new \RuntimeException('VAPID JWT signing failed: ' . openssl_error_string());
    }

    // openssl_sign returns DER-encoded signature; we need raw r||s (64 bytes)
    $signature = web_push_der_to_raw_ecdsa($signature);

    $signatureB64 = web_push_urlsafe_b64_encode($signature);
    return "{$input}.{$signatureB64}";
}

/**
 * Convert DER-encoded ECDSA signature to raw r||s (64 bytes, 32 each).
 * PHP's openssl_sign() returns DER; JWT/VAPID require raw r||s.
 */
function web_push_der_to_raw_ecdsa(string $der): string {
    // DER: SEQUENCE { INTEGER r, INTEGER s }
    $offset = 0;
    if (ord($der[$offset++]) !== 0x30) throw new \RuntimeException('Not a DER SEQUENCE');
    // Length (could be short or long form)
    $len = ord($der[$offset++]);
    if ($len & 0x80) {
        $numBytes = $len & 0x7F;
        $offset += $numBytes; // skip extended length bytes
    }

    // r
    if (ord($der[$offset++]) !== 0x02) throw new \RuntimeException('Expected INTEGER for r');
    $rLen = ord($der[$offset++]);
    $r = substr($der, $offset, $rLen);
    $offset += $rLen;

    // s
    if (ord($der[$offset++]) !== 0x02) throw new \RuntimeException('Expected INTEGER for s');
    $sLen = ord($der[$offset++]);
    $s = substr($der, $offset, $sLen);

    // Strip leading zero bytes (DER adds 0x00 if high bit set)
    $r = ltrim($r, "\x00");
    $s = ltrim($s, "\x00");

    // Pad to 32 bytes each
    return str_pad($r, 32, "\x00", STR_PAD_LEFT)
         . str_pad($s, 32, "\x00", STR_PAD_LEFT);
}

// ── RFC 8291 Payload Encryption (AES-128-GCM + ECDH) ────────

/**
 * Build a SubjectPublicKeyInfo PEM from a raw 65-byte uncompressed point.
 */
function web_push_build_public_key_pem(string $rawPoint): string {
    if (strlen($rawPoint) === 64) {
        $rawPoint = "\x04" . $rawPoint;
    }

    $ecOid  = "\x06\x07\x2A\x86\x48\xCE\x3D\x02\x01"; // ecPublicKey
    $cvOid  = "\x06\x08\x2A\x86\x48\xCE\x3D\x03\x01\x07"; // prime256v1

    $algId = "\x30" . chr(strlen($ecOid) + strlen($cvOid)) . $ecOid . $cvOid;
    $bitStr = "\x03" . chr(strlen($rawPoint) + 1) . "\x00" . $rawPoint;
    $seqContent = $algId . $bitStr;

    $der = "\x30" . chr(strlen($seqContent)) . $seqContent;

    return "-----BEGIN PUBLIC KEY-----\n"
        . chunk_split(base64_encode($der), 64)
        . "-----END PUBLIC KEY-----";
}

/**
 * HKDF-Extract: PRK = HMAC-SHA256(salt, IKM)
 */
function web_push_hkdf_extract(string $salt, string $ikm): string {
    return hash_hmac('sha256', $ikm, $salt, true);
}

/**
 * HKDF-Expand: OKM = HKDF-Expand(PRK, info, length)
 */
function web_push_hkdf_expand(string $prk, string $info, int $length): string {
    $hashLen = 32; // SHA-256
    $n = (int) ceil($length / $hashLen);
    $okm = '';
    $t = '';
    for ($i = 1; $i <= $n; $i++) {
        $t = hash_hmac('sha256', $t . $info . chr($i), $prk, true);
        $okm .= $t;
    }
    return substr($okm, 0, $length);
}

/**
 * RFC 8291 §3.3 — encrypt a Web Push payload.
 *
 * Returns ['ciphertext' => binary_string, 'localPublicKey' => 65-byte binary, 'salt' => 16-byte binary]
 */
function web_push_encrypt_payload(string $plaintext, string $userPublicKeyB64, string $userAuthB64): array
{
    $userKeyRaw = web_push_urlsafe_b64_decode($userPublicKeyB64);
    $authSecret = web_push_urlsafe_b64_decode($userAuthB64);

    // Generate ephemeral ECDH key pair (as)
    $localKeyPair = openssl_pkey_new(['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC]);
    if (!$localKeyPair) {
        throw new \RuntimeException('Failed to generate ECDH key pair: ' . openssl_error_string());
    }

    $localDetails = openssl_pkey_get_details($localKeyPair);
    $localPubRaw = "\x04"
        . str_pad($localDetails['ec']['x'], 32, "\x00", STR_PAD_LEFT)
        . str_pad($localDetails['ec']['y'], 32, "\x00", STR_PAD_LEFT);

    if (strlen($localPubRaw) !== 65) {
        throw new \RuntimeException('Cannot extract local EC public key');
    }

    // Build PEM for user's public key
    $userPubPem  = web_push_build_public_key_pem($userKeyRaw);
    $userPubKey  = openssl_pkey_get_public($userPubPem);
    if (!$userPubKey) {
        throw new \RuntimeException('Failed to parse user public key: ' . openssl_error_string());
    }

    // ECDH shared secret (dh_secret = ECDH(as_private, ua_public))
    $dhSecret = false;
    if (PHP_VERSION_ID >= 80000 && function_exists('openssl_pkey_derive')) {
        $dhSecret = openssl_pkey_derive($userPubKey, $localKeyPair, 32);
    }
    if ($dhSecret === false) {
        $dhSecret = openssl_dh_compute_key($userPubPem, $localKeyPair);
    }
    if ($dhSecret === false || $dhSecret === '') {
        throw new \RuntimeException('ECDH failed: ' . openssl_error_string());
    }
    // Ensure exactly 32 bytes
    $dhSecret = str_pad(ltrim($dhSecret, "\x00"), 32, "\x00", STR_PAD_LEFT);

    // Random 16-byte salt
    $salt = random_bytes(16);

    // ── RFC 8291 §3.3 Key derivation ────────────────────────────
    //
    // ikm = HKDF-Extract(auth_secret, dh_secret || "WebPush: info\x00" || ua_public || as_public)
    //     where salt for HKDF-Extract = auth_secret (32 bytes from subscription)
    //
    // Per spec:
    //   key_info  = "Content-Encoding: aes128gcm\x00"
    //   nonce_info = "Content-Encoding: nonce\x00"
    //   PRK = HKDF(salt=salt, IKM=IKM, info=..., len=...)
    //
    // RFC 8291 uses a two-step derivation:
    //   Step 1: Extract pseudo-random key using auth secret
    //   Step 2: Derive content encryption key and nonce

    // Build the shared IKM context string
    $ikm_info = "WebPush: info\x00" . $userKeyRaw . $localPubRaw;

    // Step 1: PRK_key = HKDF-Extract(salt=auth_secret, IKM=dh_secret)
    //         IKM_key = HKDF-Expand(PRK_key, ikm_info, 32)
    $prk_key = web_push_hkdf_extract($authSecret, $dhSecret);
    $ikm     = web_push_hkdf_expand($prk_key, $ikm_info, 32);

    // Step 2: PRK = HKDF-Extract(salt=random_salt, IKM=ikm)
    //         cek = HKDF-Expand(PRK, "Content-Encoding: aes128gcm\x00", 16)
    //         nonce = HKDF-Expand(PRK, "Content-Encoding: nonce\x00", 12)
    $prk   = web_push_hkdf_extract($salt, $ikm);
    $cek   = web_push_hkdf_expand($prk, "Content-Encoding: aes128gcm\x00", 16);
    $nonce = web_push_hkdf_expand($prk, "Content-Encoding: nonce\x00", 12);

    // ── AES-128-GCM encrypt ─────────────────────────────────────
    // Padding: append 0x02 delimiter byte (RFC 8291 §4)
    $padded = $plaintext . "\x02";

    $tag = '';
    $ciphertext = openssl_encrypt($padded, 'aes-128-gcm', $cek, OPENSSL_RAW_DATA, $nonce, $tag, '', 16);
    if ($ciphertext === false) {
        throw new \RuntimeException('AES-128-GCM encryption failed: ' . openssl_error_string());
    }

    // ── RFC 8291 §4 — aes128gcm content-coding header ──────────
    // salt (16) || rs (4, big-endian uint32 = record size) || idlen (1) || keyid (65 bytes = local public key)
    $rs     = 4096; // record size (must be > plaintext size + 17)
    $header = $salt
        . pack('N', $rs)        // rs: big-endian uint32
        . chr(65)               // idlen: length of keyid
        . $localPubRaw;         // keyid: sender's ephemeral public key (65 bytes)

    return [
        'body' => $header . $ciphertext . $tag,
    ];
}

// ── Main send function ────────────────────────────────────────

/**
 * Send a Web Push notification.
 *
 * @param array $subscription  ['endpoint' => ..., 'keys' => ['p256dh' => ..., 'auth' => ...]]
 * @param array $payload       Data to send (will be JSON-encoded)
 * @param int   $ttl           Time-to-live in seconds (default 4 hours)
 * @return bool  True on success
 */
function web_push_send(array $subscription, array $payload, int $ttl = 14400): bool
{
    $endpoint = $subscription['endpoint'] ?? '';
    $p256dh   = $subscription['keys']['p256dh'] ?? '';
    $auth     = $subscription['keys']['auth']   ?? '';

    if (empty($endpoint) || empty($p256dh) || empty($auth)) {
        error_log('WebPush: invalid subscription (missing endpoint/keys)');
        return false;
    }

    $jsonPayload = json_encode($payload, JSON_UNESCAPED_UNICODE);

    // 1. Encrypt payload (RFC 8291)
    try {
        $encrypted = web_push_encrypt_payload($jsonPayload, $p256dh, $auth);
    } catch (\Throwable $e) {
        error_log('WebPush encryption error: ' . $e->getMessage());
        return false;
    }

    // 2. Build VAPID JWT for the push service origin
    $parsedUrl = parse_url($endpoint);
    if (!$parsedUrl || empty($parsedUrl['host'])) {
        error_log('WebPush: cannot parse endpoint: ' . $endpoint);
        return false;
    }
    $audience = $parsedUrl['scheme'] . '://' . $parsedUrl['host'];

    try {
        $jwt = web_push_vapid_jwt($audience);
    } catch (\Throwable $e) {
        error_log('WebPush VAPID JWT error: ' . $e->getMessage());
        return false;
    }

    // 3. Get VAPID public key for Authorization header
    try {
        $vapidPubRaw = web_push_get_vapid_public_key_raw();
        $vapidPubB64 = web_push_urlsafe_b64_encode($vapidPubRaw);
    } catch (\Throwable $e) {
        error_log('WebPush VAPID public key error: ' . $e->getMessage());
        return false;
    }

    // 4. Send via cURL
    // RFC 8292: Authorization: vapid t=<jwt>,k=<public-key>
    $headers = [
        'Content-Type: application/octet-stream',
        'Content-Encoding: aes128gcm',
        'Authorization: vapid t=' . $jwt . ',k=' . $vapidPubB64,
        'TTL: ' . $ttl,
        'Urgency: high',
    ];

    $ch = curl_init($endpoint);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_POSTFIELDS     => $encrypted['body'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 10,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_FOLLOWLOCATION => true,
    ]);

    $response  = curl_exec($ch);
    $httpCode  = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);

    if ($curlError) {
        error_log("WebPush cURL error: {$curlError}");
        return false;
    }

    if ($httpCode === 200 || $httpCode === 201) {
        return true;
    }

    // 404 / 410 = subscription expired
    if ($httpCode === 404 || $httpCode === 410) {
        error_log("WebPush: subscription expired (HTTP {$httpCode}) for endpoint: " . substr($endpoint, 0, 60));
        return false;
    }

    error_log("WebPush push service error HTTP {$httpCode}: " . substr((string)$response, 0, 500));
    return false;
}

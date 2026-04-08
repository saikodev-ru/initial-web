<?php
// ============================================================
//  s3_helper.php — загрузка файлов в S3-совместимое хранилище
//  Совместим с reg.ru Cloud S3 (AWS Signature V4, path-style)
//
//  В config.php:
//    define('S3_ENDPOINT',   'https://s3.regru.cloud');
//    define('S3_BUCKET',     'a558487e-...');
//    define('S3_REGION',     'ru-1');
//    define('S3_ACCESS_KEY', 'CQVZ...');
//    define('S3_SECRET_KEY', 'D1Lm...');
//    define('S3_PUBLIC_URL', 'https://signal.storage.website.regru.cloud');
// ============================================================
declare(strict_types=1);

/**
 * Загружает файл в S3 и возвращает публичный URL.
 *
 * ВАЖНО: публичный доступ к файлам должен быть разрешён через
 * политику бакета в консоли reg.ru (bucket policy), а НЕ через ACL.
 * reg.ru не поддерживает x-amz-acl заголовок.
 */
function s3_upload(string $localPath, string $s3Key, string $contentType): ?string {
    if (!defined('S3_ENDPOINT') || !defined('S3_BUCKET') ||
        !defined('S3_ACCESS_KEY') || !defined('S3_SECRET_KEY')) {
        error_log('S3: настройки не заданы в config.php');
        return null;
    }

    $endpoint  = rtrim(S3_ENDPOINT, '/');
    $bucket    = S3_BUCKET;
    $region    = defined('S3_REGION') ? S3_REGION : 'us-east-1';
    $accessKey = S3_ACCESS_KEY;
    $secretKey = S3_SECRET_KEY;

    $fileContents = file_get_contents($localPath);
    if ($fileContents === false) {
        error_log("S3: не удалось прочитать файл: $localPath");
        return null;
    }

    $fileSize    = strlen($fileContents);
    $payloadHash = hash('sha256', $fileContents);
    $now         = new DateTimeImmutable('now', new DateTimeZone('UTC'));
    $amzDate     = $now->format('Ymd\THis\Z');
    $dateStamp   = $now->format('Ymd');
    $host        = parse_url($endpoint, PHP_URL_HOST);

    // ── Подписываем ТОЛЬКО эти заголовки (строго по алфавиту) ──
    // НЕ добавляем x-amz-acl — reg.ru его не поддерживает,
    // а неподписанный заголовок вызывает SignatureDoesNotMatch.
    $canonicalHeaders = implode("\n", [
        "content-type:{$contentType}",
        "host:{$host}",
        "x-amz-content-sha256:{$payloadHash}",
        "x-amz-date:{$amzDate}",
    ]) . "\n";

    $signedHeaders  = 'content-type;host;x-amz-content-sha256;x-amz-date';
    $canonicalUri   = '/' . $bucket . '/' . ltrim($s3Key, '/');
    $canonicalQuery = '';

    $canonicalRequest = implode("\n", [
        'PUT',
        $canonicalUri,
        $canonicalQuery,
        $canonicalHeaders,
        $signedHeaders,
        $payloadHash,
    ]);

    // ── String to Sign ───────────────────────────────────────
    $credentialScope = "{$dateStamp}/{$region}/s3/aws4_request";
    $stringToSign    = implode("\n", [
        'AWS4-HMAC-SHA256',
        $amzDate,
        $credentialScope,
        hash('sha256', $canonicalRequest),
    ]);

    // ── Signing Key ──────────────────────────────────────────
    $signingKey = _s3_hmac(
        _s3_hmac(_s3_hmac(_s3_hmac("AWS4{$secretKey}", $dateStamp), $region), 's3'),
        'aws4_request'
    );
    $signature  = bin2hex(hash_hmac('sha256', $stringToSign, $signingKey, true));

    $authorization = "AWS4-HMAC-SHA256 "
        . "Credential={$accessKey}/{$credentialScope}, "
        . "SignedHeaders={$signedHeaders}, "
        . "Signature={$signature}";

    $url = "{$endpoint}/{$bucket}/" . ltrim($s3Key, '/');

    // ── cURL PUT ─────────────────────────────────────────────
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST  => 'PUT',
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POSTFIELDS     => $fileContents,
        CURLOPT_HTTPHEADER     => [
            "Authorization: {$authorization}",
            "Content-Type: {$contentType}",
            "Content-Length: {$fileSize}",
            "x-amz-content-sha256: {$payloadHash}",
            "x-amz-date: {$amzDate}",
            // x-amz-acl НАМЕРЕННО убран — reg.ru не поддерживает ACL.
            // Публичный доступ — через bucket policy в консоли.
        ],
        CURLOPT_TIMEOUT        => 60,
        CURLOPT_SSL_VERIFYPEER => true,
    ]);

    $result   = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlErr  = curl_error($ch);
    curl_close($ch);

    if (!empty($curlErr)) {
        error_log("S3 cURL error: $curlErr");
        return null;
    }

    if ($httpCode < 200 || $httpCode >= 300) {
        error_log("S3 upload HTTP {$httpCode} для s3Key={$s3Key}: " . substr((string)$result, 0, 800));
        return null;
    }

    // ── Возвращаем относительный путь ────────────────────────────
    // Ранее здесь возвращался полный URL, но для масштабируемости БД 
    // теперь храним просто s3 key.
    return ltrim($s3Key, '/');
}

/**
 * Удаляет объект из S3.
 */
function s3_delete(string $s3Key): bool {
    if (!defined('S3_ENDPOINT') || !defined('S3_BUCKET') ||
        !defined('S3_ACCESS_KEY') || !defined('S3_SECRET_KEY')) {
        return false;
    }

    $endpoint  = rtrim(S3_ENDPOINT, '/');
    $bucket    = S3_BUCKET;
    $region    = defined('S3_REGION') ? S3_REGION : 'us-east-1';
    $accessKey = S3_ACCESS_KEY;
    $secretKey = S3_SECRET_KEY;
    $host      = parse_url($endpoint, PHP_URL_HOST);

    $now        = new DateTimeImmutable('now', new DateTimeZone('UTC'));
    $amzDate    = $now->format('Ymd\THis\Z');
    $dateStamp  = $now->format('Ymd');
    $emptyHash  = hash('sha256', '');

    $canonicalHeaders = "host:{$host}\nx-amz-content-sha256:{$emptyHash}\nx-amz-date:{$amzDate}\n";
    $signedHeaders    = 'host;x-amz-content-sha256;x-amz-date';
    $canonicalUri     = '/' . $bucket . '/' . ltrim($s3Key, '/');
    $canonicalRequest = "DELETE\n{$canonicalUri}\n\n{$canonicalHeaders}\n{$signedHeaders}\n{$emptyHash}";

    $credentialScope = "{$dateStamp}/{$region}/s3/aws4_request";
    $stringToSign    = "AWS4-HMAC-SHA256\n{$amzDate}\n{$credentialScope}\n" . hash('sha256', $canonicalRequest);
    $signingKey      = _s3_hmac(_s3_hmac(_s3_hmac(_s3_hmac("AWS4{$secretKey}", $dateStamp), $region), 's3'), 'aws4_request');
    $signature       = bin2hex(hash_hmac('sha256', $stringToSign, $signingKey, true));
    $authorization   = "AWS4-HMAC-SHA256 Credential={$accessKey}/{$credentialScope}, SignedHeaders={$signedHeaders}, Signature={$signature}";

    $ch = curl_init("{$endpoint}/{$bucket}/" . ltrim($s3Key, '/'));
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST  => 'DELETE',
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => [
            "Authorization: {$authorization}",
            "x-amz-content-sha256: {$emptyHash}",
            "x-amz-date: {$amzDate}",
        ],
        CURLOPT_TIMEOUT => 15,
    ]);
    curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return $httpCode >= 200 && $httpCode < 300;
}

/**
 * Читает объект из S3 и возвращает содержимое как строку (для get_media.php прокси).
 */
function s3_get(string $s3Key): ?string {
    if (!defined('S3_ENDPOINT') || !defined('S3_BUCKET') ||
        !defined('S3_ACCESS_KEY') || !defined('S3_SECRET_KEY')) {
        return null;
    }
    $endpoint  = rtrim(S3_ENDPOINT, '/');
    $bucket    = S3_BUCKET;
    $region    = defined('S3_REGION') ? S3_REGION : 'us-east-1';
    $accessKey = S3_ACCESS_KEY;
    $secretKey = S3_SECRET_KEY;
    $host      = parse_url($endpoint, PHP_URL_HOST);

    $now       = new DateTimeImmutable('now', new DateTimeZone('UTC'));
    $amzDate   = $now->format('Ymd\\THis\\Z');
    $dateStamp = $now->format('Ymd');
    $emptyHash = hash('sha256', '');

    $canonicalHeaders = "host:{$host}\nx-amz-content-sha256:{$emptyHash}\nx-amz-date:{$amzDate}\n";
    $signedHeaders    = 'host;x-amz-content-sha256;x-amz-date';
    $canonicalUri     = '/' . $bucket . '/' . ltrim($s3Key, '/');
    $canonicalRequest = "GET\n{$canonicalUri}\n\n{$canonicalHeaders}\n{$signedHeaders}\n{$emptyHash}";

    $credentialScope  = "{$dateStamp}/{$region}/s3/aws4_request";
    $stringToSign     = "AWS4-HMAC-SHA256\n{$amzDate}\n{$credentialScope}\n" . hash('sha256', $canonicalRequest);
    $signingKey       = _s3_hmac(_s3_hmac(_s3_hmac(_s3_hmac("AWS4{$secretKey}", $dateStamp), $region), 's3'), 'aws4_request');
    $signature        = bin2hex(hash_hmac('sha256', $stringToSign, $signingKey, true));
    $authorization    = "AWS4-HMAC-SHA256 Credential={$accessKey}/{$credentialScope}, SignedHeaders={$signedHeaders}, Signature={$signature}";

    $ch = curl_init("{$endpoint}/{$bucket}/" . ltrim($s3Key, '/'));
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => [
            "Authorization: {$authorization}",
            "x-amz-content-sha256: {$emptyHash}",
            "x-amz-date: {$amzDate}",
        ],
        CURLOPT_TIMEOUT        => 60,
        CURLOPT_SSL_VERIFYPEER => true,
    ]);
    $content  = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlErr  = curl_error($ch);
    curl_close($ch);

    if (!empty($curlErr) || $httpCode !== 200) {
        error_log("S3 GET HTTP {$httpCode} key={$s3Key}: " . ($curlErr ?: substr((string)$content, 0, 200)));
        return null;
    }
    return $content;
}

// Вспомогательная HMAC-функция (бинарный вывод)
function _s3_hmac(string $key, string $msg): string {
    return hash_hmac('sha256', $msg, $key, true);
}
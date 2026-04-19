<?php
// ============================================================
//  GET /api/get_media.php?key=music/1/abc123.mp3
//  GET /api/get_media.php?key=media/images/5/abc123.jpg
//  GET /api/get_media.php?key=media/voice/1/abc123.webm
//
//  Прокси для медиафайлов из S3.
//  Зачем нужен: S3_PUBLIC_URL (signal.storage.website.regru.cloud)
//  имеет 4 уровня субдомена → SSLPeerUnverifiedException на Android.
//  Этот прокси стримит файлы с валидным SSL signal.saikodev.ru.
// ============================================================
declare(strict_types=1);
require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/../s3_helper.php';

// CORS + Range support для аудио/видео стриминга
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Range, Content-Type, Authorization');
header('Access-Control-Expose-Headers: Content-Range, Accept-Ranges, Content-Length');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    http_response_code(405);
    exit;
}

$key = trim($_GET['key'] ?? '');

// ── Защита доступа ────────────────────────────────────────────────────────
// Приоритет: 1) Bearer token, 2) Signed URL (sig+exp), 3) fallback legacy token (deprecated)
$authed = false;
$bearerToken = get_bearer_token();
if (!empty($bearerToken)) {
    check_media_auth();
    $authed = true;
} else {
    // Signed URL — проверяем подпись
    $sig = $_GET['sig'] ?? '';
    $exp = (int)($_GET['exp'] ?? 0);
    if (verify_media_signature($key, $sig, $exp)) {
        $authed = true;
    } elseif (!empty($_GET['token'])) {
        // Legacy fallback: ?token= в URL для <img> тегов (deprecated)
        check_media_auth();
        $authed = true;
    }
}

if (!$authed) {
    http_response_code(403);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'forbidden', 'message' => 'Auth required'], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── Валидация ключа (защита от path traversal) ────────────────────────────
// Разрешаем:
//   avatars/user_{id}_{uid}.{ext}            ← аватарки
//   music/{userId}/{uid}.{ext}              ← треки
//   music/{userId}/covers/{uid}.{ext}       ← обложки треков
//   media/images/{userId}/{uid}.{ext}       ← медиа чата
//   media/videos/{userId}/{uid}.{ext}
//   media/audio/{userId}/{uid}.{ext}
//   media/voice/{userId}/{uid}.{ext}        ← голосовые сообщения
if (empty($key) || !preg_match(
    '#^(avatars/(user_|channels/).*?\.(jpg|jpeg|png|webp|gif)|music/\d+/(covers/)?[a-f0-9]{16}\.(mp3|m4a|aac|ogg|wav|flac|webm|jpg|jpeg|png|webp)|media/(images|videos|audio|voice|documents)/\d+/[a-f0-9]{16}\.(jpg|jpeg|png|webp|gif|mp4|mov|avi|webm|mp3|ogg|aac|m4a|pdf|doc|docx|xls|xlsx|zip|rar|7z|txt|csv|json|html|css|xml|md|rtf))$#i',
    $key
)) {
    http_response_code(400);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'invalid_key', 'key' => $key]);
    exit;
}

// ── Определить Content-Type ───────────────────────────────────────────────
$ext = strtolower(pathinfo($key, PATHINFO_EXTENSION));
$isVoice = str_contains($key, 'media/voice/');

$mimeMap = [
    'jpg'  => 'image/jpeg',  'jpeg' => 'image/jpeg',
    'png'  => 'image/png',   'webp' => 'image/webp',
    'gif'  => 'image/gif',
    'mp4'  => 'video/mp4',   'mov'  => 'video/quicktime',
    'avi'  => 'video/x-msvideo',
    'mp3'  => 'audio/mpeg',  'ogg'  => 'audio/ogg',
    'aac'  => 'audio/aac',   'm4a'  => 'audio/mp4',
    'wav'  => 'audio/wav',   'flac' => 'audio/flac',
    // webm — контекстно: для голосовых это аудио, для видео — видео
    'webm' => $isVoice ? 'audio/webm' : 'video/webm',
    // Documents
    'pdf'  => 'application/pdf',
    'doc'  => 'application/msword',
    'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'xls'  => 'application/vnd.ms-excel',
    'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];
$mime = $mimeMap[$ext] ?? 'application/octet-stream';

$isAudio = str_starts_with($mime, 'audio/');
$isVideo = str_starts_with($mime, 'video/');

// ── Range-запросы для аудио/видео ────────────────────────────────────────
// Браузерный <audio> и ExoPlayer шлют Range-запросы — нужно их поддержать.
// Для этого сначала получаем размер файла через HEAD, потом стримим нужный кусок.

if ($isAudio || $isVideo) {
    streamWithRange($key, $mime);
} else {
    // Изображения — отдаём целиком
    $content = s3_get($key);
    if ($content === null) {
        http_response_code(404);
        echo json_encode(['error' => 'not_found']);
        exit;
    }
    header('Content-Type: ' . $mime);
    header('Content-Length: ' . strlen($content));
    header('Cache-Control: public, max-age=86400, immutable');
    echo $content;
}
exit;

// ─────────────────────────────────────────────────────────────────────────
function streamWithRange(string $key, string $mime): void {
    // Получаем весь файл из S3 (для shared-хостинга без возможности проксировать побайтово)
    $content = s3_get($key);
    if ($content === null) {
        http_response_code(404);
        echo json_encode(['error' => 'not_found']);
        return;
    }

    $totalSize = strlen($content);
    $start     = 0;
    $end       = $totalSize - 1;

    header('Accept-Ranges: bytes');
    header('Cache-Control: public, max-age=86400, immutable');
    header('Content-Type: ' . $mime);

    // Обработка Range-заголовка
    $rangeHeader = $_SERVER['HTTP_RANGE'] ?? '';
    if ($rangeHeader && preg_match('/bytes=(\d*)-(\d*)/i', $rangeHeader, $m)) {
        $requestedStart = $m[1] !== '' ? (int)$m[1] : 0;
        $requestedEnd   = $m[2] !== '' ? (int)$m[2] : $end;

        // Валидация диапазона
        if ($requestedStart > $end || $requestedEnd > $end || $requestedStart > $requestedEnd) {
            http_response_code(416); // Range Not Satisfiable
            header("Content-Range: bytes */{$totalSize}");
            return;
        }

        $start  = $requestedStart;
        $end    = $requestedEnd;
        $length = $end - $start + 1;

        http_response_code(206); // Partial Content
        header("Content-Range: bytes {$start}-{$end}/{$totalSize}");
        header("Content-Length: {$length}");
        echo substr($content, $start, $length);
    } else {
        // Полный файл
        http_response_code(200);
        header("Content-Length: {$totalSize}");
        echo $content;
    }
}

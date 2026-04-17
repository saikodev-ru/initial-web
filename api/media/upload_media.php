<?php
// ═══════════════════════════════════════════════════════════════
//  UPLOAD MEDIA
//  POST /api/upload_media.php
//  Header: Authorization: Bearer <token>
//  Body:   multipart/form-data, field: "file"
//  Response: { "ok": true, "url": "https://...", "media_type": "image"|"video" }
// ═══════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/../s3_helper.php';

set_cors_headers();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_err('method_not_allowed', 'Только POST', 405);

$me = auth_user();
require_rate_limit('upload_media', 30, 60);

if (empty($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
    $code = $_FILES['file']['error'] ?? -1;
    json_err('no_file', "Файл не получен (upload error: {$code})");
}

$file    = $_FILES['file'];
$tmpPath = $file['tmp_name'];
$size    = (int) $file['size'];

if (!is_uploaded_file($tmpPath)) {
    error_log("SECURITY: upload_media attempted local file access: {$tmpPath}");
    json_err('invalid_upload', 'Некорректный файл');
}

// 50 МБ — максимум для видео
if ($size > 50 * 1024 * 1024) {
    json_err('file_too_large', 'Максимальный размер файла — 50 МБ');
}

// ── Определить тип по mime ────────────────────────────────────
$imageInfo = @getimagesize($tmpPath);
$mime      = $imageInfo['mime'] ?? (function_exists('mime_content_type') ? mime_content_type($tmpPath) : '');

$allowedImages = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
$allowedVideos = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo'];

if (in_array($mime, $allowedImages, true)) {
    $mediaType = 'image';
    $ext = match ($mime) {
        'image/jpeg' => 'jpg',
        'image/png'  => 'png',
        'image/webp' => 'webp',
        'image/gif'  => 'gif',
        default      => 'jpg',
    };
} elseif (in_array($mime, $allowedVideos, true)) {
    $mediaType = 'video';
    $ext = match ($mime) {
        'video/mp4'       => 'mp4',
        'video/quicktime' => 'mov',
        'video/webm'      => 'webm',
        default           => 'mp4',
    };
} else {
    json_err('invalid_type', 'Поддерживаются: JPEG, PNG, WebP, GIF, MP4, MOV, WebM');
}

// ── Сформировать ключ S3 ──────────────────────────────────────
$uid    = (int) $me['id'];
$uid16  = bin2hex(random_bytes(8));           // 16 hex-символов
$folder = $mediaType === 'image' ? 'media/images' : 'media/videos';
$s3Key  = "{$folder}/{$uid}/{$uid16}.{$ext}";

// ── Загрузить в S3 ────────────────────────────────────────────
$url = s3_upload($tmpPath, $s3Key, $mime);
if (!$url) {
    json_err('upload_error', 'Не удалось загрузить файл. Попробуйте позже.', 500);
}

json_ok(['url' => $url, 'media_type' => $mediaType]);

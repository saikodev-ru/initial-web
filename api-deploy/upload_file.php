<?php
// ═══════════════════════════════════════════════════════════════
//  UPLOAD FILE (universal — images, videos, documents)
//  POST /api/upload_file.php
//  Header: Authorization: Bearer <token>
//  Body:   multipart/form-data, field: "file"
//  Response: { "ok": true, "url": "https://...", "media_type": "image"|"video"|"document", "filename": "..." }
// ═══════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/s3_helper.php';

set_cors_headers();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_err('method_not_allowed', 'Только POST', 405);

$me = auth_user();

if (empty($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
    $code = $_FILES['file']['error'] ?? -1;
    json_err('no_file', "Файл не получен (upload error: {$code})");
}

$file    = $_FILES['file'];
$tmpPath = $file['tmp_name'];
$origName = $file['name'] ?? 'file';
$size    = (int) $file['size'];

// ── 50 МБ максимум ──────────────────────────────────────────
if ($size > 50 * 1024 * 1024) {
    json_err('file_too_large', 'Максимальный размер файла — 50 МБ');
}

// ── Определить тип по mime (приоритет — изображения/видео) ──
$imageInfo = @getimagesize($tmpPath);
$mime      = $imageInfo['mime'] ?? (function_exists('mime_content_type') ? mime_content_type($tmpPath) : '');

$allowedImages = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
$allowedVideos = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo'];

// Allowed document extensions whitelist
$allowedDocExts = [
    'txt', 'csv', 'json', 'xml', 'html', 'css', 'md', 'log', 'rtf',
    'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
    'zip', 'rar', '7z',
];

if (in_array($mime, $allowedImages, true)) {
    $mediaType = 'image';
    $ext = match ($mime) {
        'image/jpeg' => 'jpg',
        'image/png'  => 'png',
        'image/webp' => 'webp',
        'image/gif'  => 'gif',
        default      => 'jpg',
    };
    $folder = 'media/images';
} elseif (in_array($mime, $allowedVideos, true)) {
    $mediaType = 'video';
    $ext = match ($mime) {
        'video/mp4'       => 'mp4',
        'video/quicktime' => 'mov',
        'video/webm'      => 'webm',
        default           => 'mp4',
    };
    $folder = 'media/videos';
} else {
    // ── Документ — определяем по расширению ──────────────────────
    $ext = strtolower(pathinfo($origName, PATHINFO_EXTENSION));

    if (empty($ext)) {
        // Нет расширения — пробуем по MIME
        $extMap = [
            'text/plain'              => 'txt',
            'application/pdf'         => 'pdf',
            'application/vnd.ms-excel' => 'xls',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' => 'xlsx',
            'text/html'               => 'html',
            'text/css'                => 'css',
            'application/xml'         => 'xml',
            'text/xml'                => 'xml',
            'text/csv'                => 'csv',
            'application/json'        => 'json',
            'text/markdown'           => 'md',
            'text/x-log'              => 'log',
            'application/msword'      => 'doc',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document' => 'docx',
            'application/rtf'         => 'rtf',
            'application/vnd.ms-powerpoint' => 'ppt',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation' => 'pptx',
            'application/zip'         => 'zip',
            'application/x-rar-compressed' => 'rar',
            'application/x-7z-compressed'  => '7z',
        ];
        $ext = $extMap[$mime] ?? 'txt';
    }

    if (!in_array($ext, $allowedDocExts, true)) {
        json_err('invalid_type', 'Неподдерживаемый тип файла');
    }

    $mediaType = 'document';
    $folder = 'media/documents';
}

// ── MIME для загрузки в S3 (для документов) ──────────────────
if ($mediaType === 'document') {
    $docMimeMap = [
        'txt'  => 'text/plain',
        'csv'  => 'text/csv',
        'json' => 'application/json',
        'md'   => 'text/markdown',
        'log'  => 'text/plain',
        'html' => 'text/html',
        'css'  => 'text/css',
        'xml'  => 'application/xml',
        'pdf'  => 'application/pdf',
        'xls'  => 'application/vnd.ms-excel',
        'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'doc'  => 'application/msword',
        'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'rtf'  => 'application/rtf',
        'ppt'  => 'application/vnd.ms-powerpoint',
        'pptx' => 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'zip'  => 'application/zip',
        'rar'  => 'application/x-rar-compressed',
        '7z'   => 'application/x-7z-compressed',
    ];
    $mime = $docMimeMap[$ext] ?? 'application/octet-stream';
}

// ── Сформировать ключ S3 ──────────────────────────────────────
$uid    = (int) $me['id'];
$uid16  = bin2hex(random_bytes(8));           // 16 hex-символов
$s3Key  = "{$folder}/{$uid}/{$uid16}.{$ext}";

// ── Загрузить в S3 ────────────────────────────────────────────
$url = s3_upload($tmpPath, $s3Key, $mime);
if (!$url) {
    json_err('upload_error', 'Не удалось загрузить файл. Попробуйте позже.', 500);
}

// Sanitize filename for response (remove path components)
$filename = basename($origName);

json_ok(['url' => $url, 'media_type' => $mediaType, 'filename' => $filename]);

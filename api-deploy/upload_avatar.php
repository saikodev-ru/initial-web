<?php
// POST /api/upload_avatar.php
// Header: Authorization: Bearer <token>
// Body: multipart/form-data, field: "avatar" (JPEG image)
// Response: { "ok": true, "avatar_url": "https://...", "user": {...} }
declare(strict_types=1);
require_once __DIR__ . '/helpers.php';

require_once __DIR__ . '/s3_helper.php';

set_cors_headers();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_err('method_not_allowed', 'Только POST', 405);

$me = auth_user();
require_rate_limit('upload_avatar', 10, 60);

// ── Читаем старый avatar_url ДО загрузки нового (чтобы удалить из S3) ──
$stmt = db()->prepare('SELECT avatar_url, bio FROM users WHERE id = ? LIMIT 1');
$stmt->execute([$me['id']]);
$row    = $stmt->fetch();
$oldUrl = $row['avatar_url'] ?? null;

// ── Проверить загруженный файл ────────────────────────────────
if (empty($_FILES['avatar']) || $_FILES['avatar']['error'] !== UPLOAD_ERR_OK) {
    $uploadError = $_FILES['avatar']['error'] ?? -1;
    json_err('no_file', "Файл не загружен (error code: {$uploadError})");
}

$file     = $_FILES['avatar'];
$tmpPath  = $file['tmp_name'];
$fileSize = $file['size'];

if (!is_uploaded_file($tmpPath)) {
    error_log("SECURITY: upload_avatar attempted local file access: {$tmpPath}");
    json_err('invalid_upload', 'Некорректный файл');
}

// ── Проверка размера (макс. 5 МБ) ──────────────────────────────
if ($fileSize > 5 * 1024 * 1024) {
    json_err('file_too_large', 'Максимальный размер файла — 5 МБ');
}

// ── Проверка что это реальное изображение ────────────────────
$imageInfo = @getimagesize($tmpPath);
if (!$imageInfo) {
    json_err('invalid_image', 'Файл не является изображением');
}

$mime = $imageInfo['mime'];
if (!in_array($mime, ['image/jpeg', 'image/png', 'image/webp', 'image/gif'], true)) {
    json_err('invalid_format', 'Поддерживаются только JPEG, PNG, WebP и GIF');
}

$isGif = ($mime === 'image/gif');
$ext = $isGif ? 'gif' : 'jpg';

// ── Имя файла и S3 Key ────────────────────────────────────────
$filename = 'user_' . $me['id'] . '_' . time() . '_' . substr(md5(uniqid()), 0, 6) . '.' . $ext;
$s3Key    = 'avatars/' . $filename;
$uploadFile = $tmpPath; // По умолчанию загружаем оригинал

// ── Обработка изображения (GD crop) ТОЛЬКО если не GIF ──────
if (!$isGif) {
    $srcImage = match($mime) {
        'image/jpeg' => @imagecreatefromjpeg($tmpPath),
        'image/png'  => @imagecreatefrompng($tmpPath),
        'image/webp' => @imagecreatefromwebp($tmpPath),
        default      => false,
    };

    if (!$srcImage) {
        json_err('gd_error', 'Ошибка обработки изображения');
    }

    $srcW = imagesx($srcImage);
    $srcH = imagesy($srcImage);
    $size = 512;

    if ($srcW !== $size || $srcH !== $size) {
        $cropSize = min($srcW, $srcH);
        $cropX    = intdiv($srcW - $cropSize, 2);
        $cropY    = intdiv($srcH - $cropSize, 2);

        $dstImage = imagecreatetruecolor($size, $size);
        
        // Preserve alpha for PNG internally temporarily
        imagealphablending($dstImage, false);
        imagesavealpha($dstImage, true);
        $transparent = imagecolorallocatealpha($dstImage, 255, 255, 255, 127);
        imagefilledrectangle($dstImage, 0, 0, $size, $size, $transparent);

        imagecopyresampled($dstImage, $srcImage, 0, 0, $cropX, $cropY, $size, $size, $cropSize, $cropSize);
        imagedestroy($srcImage);
        $srcImage = $dstImage;
    }

    // Сохраняем во временный файл чтобы загрузить на S3
    $tempDstPath = sys_get_temp_dir() . '/' . $filename;
    
    // Convert everything to solid background JPEG
    $bg = imagecreatetruecolor($size, $size);
    imagefill($bg, 0, 0, imagecolorallocate($bg, 255, 255, 255));
    imagecopy($bg, $srcImage, 0, 0, 0, 0, $size, $size);
    imagedestroy($srcImage);
    
    $saved = imagejpeg($bg, $tempDstPath, 85);
    imagedestroy($bg);

    if (!$saved) {
        json_err('save_error', 'Ошибка временного сохранения изображения');
    }
    
    $uploadFile = $tempDstPath;
    $mime = 'image/jpeg';
}

// ── Загрузка в S3 ────────────────────────────────────────────
$avatarUrl = s3_upload($uploadFile, $s3Key, $mime);

if (isset($tempDstPath) && file_exists($tempDstPath)) {
    @unlink($tempDstPath);
}

if (!$avatarUrl) {
    json_err('s3_error', 'Не удалось загрузить аватар в хранилище');
}

// ── Обновить avatar_url в БД ──────────────────────────────────
db()->prepare('UPDATE users SET avatar_url = ? WHERE id = ?')
    ->execute([$avatarUrl, $me['id']]);

// ── Удалить СТАРЫЙ аватар из S3 (после успешного обновления БД) ──
if ($oldUrl) {
    $oldKey = null;
    if (str_starts_with($oldUrl, 'avatars/')) {
        $oldKey = $oldUrl;
    } elseif (strpos($oldUrl, '/get_media.php?key=') !== false) {
        $urlParts = parse_url($oldUrl);
        if (isset($urlParts['query'])) {
            parse_str($urlParts['query'], $query);
            if (!empty($query['key'])) {
                $oldKey = $query['key'];
            }
        }
    }
    if ($oldKey) {
        s3_delete($oldKey);
    }
}

json_ok([
    'avatar_url' => $avatarUrl,
    'user' => [
        'id'         => (int) $me['id'],
        'email'      => $me['email'],
        'nickname'   => $me['nickname'],
        'signal_id'  => $me['signal_id'],
        'bio'        => $row['bio'] ?? null,
        'avatar_url' => $avatarUrl,
    ],
]);
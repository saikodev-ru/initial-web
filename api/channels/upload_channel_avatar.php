<?php
// POST /api/upload_channel_avatar
// Header: Authorization: Bearer <token>
// Body: multipart/form-data, field: "avatar" (JPEG/PNG/WebP/GIF)
// Response: { ok: true, avatar_url: "...", channel_id: N }
declare(strict_types=1);
require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/../s3_helper.php';

set_cors_headers();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_err('method_not_allowed', 'Только POST', 405);

$me = auth_user();
require_rate_limit('upload_channel_avatar', 10, 60);

$data = json_decode(file_get_contents('php://input'), true) ?? [];
$channelId = (int) ($_POST['channel_id'] ?? ($data['channel_id'] ?? 0));
if ($channelId <= 0) json_err('invalid_id', 'Укажите channel_id');

$db = db();

// Check admin/owner permission
$stmt = $db->prepare(
    'SELECT c.id, c.owner_id, c.avatar_url, cm.role
     FROM channels c
     JOIN channel_members cm ON cm.channel_id = c.id AND cm.user_id = ?
     WHERE c.id = ?
     LIMIT 1'
);
$stmt->execute([$me['id'], $channelId]);
$ch = $stmt->fetch();

if (!$ch) json_err('not_found', 'Канал не найден', 404);
if (!in_array($ch['role'], ['owner', 'admin'], true)) {
    json_err('forbidden', 'Только администраторы могут менять аватар', 403);
}

$oldUrl = $ch['avatar_url'] ?? null;

// Validate uploaded file
if (empty($_FILES['avatar']) || $_FILES['avatar']['error'] !== UPLOAD_ERR_OK) {
    $code = $_FILES['avatar']['error'] ?? -1;
    json_err('no_file', "Файл не загружен (error code: {$code})");
}

$file     = $_FILES['avatar'];
$tmpPath  = $file['tmp_name'];
$fileSize = $file['size'];

if (!is_uploaded_file($tmpPath)) {
    error_log("SECURITY: upload_channel_avatar attempted local file access: {$tmpPath}");
    json_err('invalid_upload', 'Некорректный файл');
}

if ($fileSize > 5 * 1024 * 1024) {
    json_err('file_too_large', 'Максимальный размер файла — 5 МБ');
}

$imageInfo = @getimagesize($tmpPath);
if (!$imageInfo) json_err('invalid_image', 'Файл не является изображением');

$mime = $imageInfo['mime'];
if (!in_array($mime, ['image/jpeg', 'image/png', 'image/webp', 'image/gif'], true)) {
    json_err('invalid_format', 'Поддерживаются только JPEG, PNG, WebP и GIF');
}

$isGif = ($mime === 'image/gif');
$ext = $isGif ? 'gif' : 'jpg';

// S3 key
$filename = 'channel_' . $channelId . '_' . time() . '_' . substr(md5(uniqid()), 0, 6) . '.' . $ext;
$s3Key = 'avatars/channels/' . $filename;
$uploadFile = $tmpPath;

// GD crop (skip for GIF)
if (!$isGif) {
    $srcImage = match ($mime) {
        'image/jpeg' => @imagecreatefromjpeg($tmpPath),
        'image/png'  => @imagecreatefrompng($tmpPath),
        'image/webp' => @imagecreatefromwebp($tmpPath),
        default      => false,
    };

    if (!$srcImage) json_err('gd_error', 'Ошибка обработки изображения');

    $srcW = imagesx($srcImage);
    $srcH = imagesy($srcImage);
    $size = 512;

    if ($srcW !== $size || $srcH !== $size) {
        $cropSize = min($srcW, $srcH);
        $cropX    = intdiv($srcW - $cropSize, 2);
        $cropY    = intdiv($srcH - $cropSize, 2);

        $dstImage = imagecreatetruecolor($size, $size);
        imagealphablending($dstImage, false);
        imagesavealpha($dstImage, true);
        $transparent = imagecolorallocatealpha($dstImage, 255, 255, 255, 127);
        imagefilledrectangle($dstImage, 0, 0, $size, $size, $transparent);
        imagecopyresampled($dstImage, $srcImage, 0, 0, $cropX, $cropY, $size, $size, $cropSize, $cropSize);
        imagedestroy($srcImage);
        $srcImage = $dstImage;
    }

    // Save as JPEG with white background
    $tempDstPath = sys_get_temp_dir() . '/' . $filename;
    $bg = imagecreatetruecolor($size, $size);
    imagefill($bg, 0, 0, imagecolorallocate($bg, 255, 255, 255));
    imagecopy($bg, $srcImage, 0, 0, 0, 0, $size, $size);
    imagedestroy($srcImage);

    $saved = imagejpeg($bg, $tempDstPath, 85);
    imagedestroy($bg);

    if (!$saved) json_err('save_error', 'Ошибка временного сохранения');
    $uploadFile = $tempDstPath;
    $mime = 'image/jpeg';
}

// Upload to S3
$avatarUrl = s3_upload($uploadFile, $s3Key, $mime);

if (isset($tempDstPath) && file_exists($tempDstPath)) @unlink($tempDstPath);

if (!$avatarUrl) json_err('s3_error', 'Не удалось загрузить аватар в хранилище');

// Update DB
$db->prepare('UPDATE channels SET avatar_url = ? WHERE id = ?')
    ->execute([$avatarUrl, $channelId]);

// Delete old avatar from S3
if ($oldUrl) {
    $oldKey = null;
    if (str_starts_with($oldUrl, 'avatars/')) {
        $oldKey = $oldUrl;
    } elseif (strpos($oldUrl, 'get_media') !== false) {
        $urlParts = parse_url($oldUrl);
        if (isset($urlParts['query'])) {
            parse_str($urlParts['query'], $query);
            if (!empty($query['key'])) $oldKey = $query['key'];
        }
    }
    if ($oldKey) s3_delete($oldKey);
}

json_ok([
    'avatar_url' => $avatarUrl,
    'channel_id' => $channelId,
]);

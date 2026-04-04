<?php
// migrate_avatars.php (Одноразовый скрипт)
// Запускается разово, переносит локальные аватары на S3, удаляет локальные и обновляет БД.
declare(strict_types=1);
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/s3_helper.php';

// Защита: разрешить запуск только администратору или из консоли, 
// но так как это одноразовый ручной скрипт, оставим простым.
if (php_sapi_name() !== 'cli' && !isset($_GET['run'])) {
    die("Use ?run=1 to execute");
}

$db = db();
$stmt = $db->query("SELECT id, email, avatar_url FROM users WHERE avatar_url LIKE '%/uploads/avatars/%'");
$users = $stmt->fetchAll(PDO::FETCH_ASSOC);

$migrated = 0;
$failed = 0;
$notFound = 0;

$uploadDir = __DIR__ . '/../uploads/avatars/';

foreach ($users as $u) {
    $url = $u['avatar_url'];
    $filename = basename(parse_url($url, PHP_URL_PATH));
    $localPath = $uploadDir . $filename;

    echo "Пользователь {$u['id']} ({$u['email']}), файл: {$filename} ... ";

    if (!file_exists($localPath)) {
        echo "НЕ НАЙДЕН ЛОКАЛЬНО!\n<br>";
        $notFound++;
        continue;
    }

    $mime = mime_content_type($localPath);
    if (!$mime) $mime = 'image/jpeg';
    
    $s3Key = 'avatars/' . $filename;
    
    // Загрузка в S3
    $s3Url = s3_upload($localPath, $s3Key, $mime);
    
    if ($s3Url) {
        // Обновляем БД
        $db->prepare("UPDATE users SET avatar_url = ? WHERE id = ?")->execute([$s3Url, $u['id']]);
        
        // Удаляем локальный файл
        @unlink($localPath);
        
        echo "ОК! Новый URL: {$s3Url}\n<br>";
        $migrated++;
    } else {
        echo "ОШИБКА ЗАГРУЗКИ В S3!\n<br>";
        $failed++;
    }
}

echo "<hr>";
echo "<h3>Готово</h3>";
echo "Мигрировано: $migrated<br>";
echo "Ошибок S3: $failed<br>";
echo "Файл не найден локально: $notFound<br>";
echo "<b>Можете удалить этот скрипт.</b>";

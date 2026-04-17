<?php
// POST /api/qr_create.php
// Создаёт QR-сессию для входа без пароля.
// Требует таблицу:
//   CREATE TABLE IF NOT EXISTS qr_sessions (
//     id         INT AUTO_INCREMENT PRIMARY KEY,
//     token      VARCHAR(64) NOT NULL UNIQUE,
//     status     ENUM('pending','scanned','approved','expired') DEFAULT 'pending',
//     user_id    INT NULL,
//     auth_token VARCHAR(128) NULL,
//     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
//     expires_at TIMESTAMP NOT NULL,
//     INDEX idx_token (token),
//     INDEX idx_status_exp (status, expires_at)
//   );
declare(strict_types=1);
require_once __DIR__ . '/../helpers.php';

set_cors_headers();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_err('method_not_allowed', 'Только POST', 405);

require_rate_limit('qr_create', 10, 60);

// Чистим протухшие сессии
db()->exec("DELETE FROM qr_sessions WHERE expires_at < NOW() - INTERVAL 10 MINUTE");

$token     = bin2hex(random_bytes(24)); // 48 hex символов
$expiresAt = date('Y-m-d H:i:s', strtotime('+3 minutes'));

db()->prepare(
    "INSERT INTO qr_sessions (token, status, expires_at) VALUES (?, 'pending', ?)"
)->execute([$token, $expiresAt]);

// URL, который будет закодирован в QR — открывается на уже авторизованном устройстве
$appBase = rtrim(defined('APP_URL') ? APP_URL : 'https://initial.su/web', '/');
$qrUrl   = $appBase . '/?qr=' . $token;

json_ok([
    'token'      => $token,
    'url'        => $qrUrl,
    'expires_at' => $expiresAt,
    'expires_in' => 180, // секунд
]);

<?php
// POST /api/qr_link_create.php
// Создаёт QR «Связать устройство» для залогиненного пользователя.
// При сканировании мобильным → qr_link_consume.php → выдаёт сессию того же аккаунта.
declare(strict_types=1);
require_once __DIR__ . '/../helpers.php';

set_cors_headers();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_err('method_not_allowed', 'Только POST', 405);

$me = auth_user();

// Чистим старые link-токены этого пользователя
db()->prepare(
    "DELETE FROM qr_sessions WHERE type='link' AND user_id=?"
)->execute([$me['id']]);

$token     = bin2hex(random_bytes(24));
$expiresAt = date('Y-m-d H:i:s', strtotime('+3 minutes'));

db()->prepare(
    "INSERT INTO qr_sessions (token, type, status, user_id, expires_at)
     VALUES (?, 'link', 'pending', ?, ?)"
)->execute([$token, (int)$me['id'], $expiresAt]);

$appBase = rtrim(defined('APP_URL') ? APP_URL : 'https://initial.su/web', '/');
// qr_link= отличает этот тип от qr= (login flow)
$qrUrl   = $appBase . '/?qr_link=' . $token;

json_ok([
    'token'      => $token,
    'url'        => $qrUrl,
    'expires_in' => 180,
    'expires_at' => $expiresAt,
]);

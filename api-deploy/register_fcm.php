<?php
// POST /api/register_fcm.php
// Header: Authorization: Bearer <token>
// Body: { "fcm_token": "firebase_token_here" }
declare(strict_types=1);
require_once __DIR__ . '/helpers.php';

set_cors_headers();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_err('method_not_allowed', 'Только POST', 405);

$me       = auth_user();
$data     = input();
$fcmToken = trim($data['fcm_token'] ?? '');

if (empty($fcmToken)) json_err('invalid_token', 'fcm_token не может быть пустым');

db()->prepare('UPDATE users SET fcm_token = ? WHERE id = ?')
    ->execute([$fcmToken, $me['id']]);

json_ok(['message' => 'FCM токен сохранён']);

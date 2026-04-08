<?php
// POST /api/register_fcm.php
// Header: Authorization: Bearer <token>
// Body: { "fcm_token": "firebase_token_here" }
//   or { "fcm_token": "" }  → clears the token (unregister)
declare(strict_types=1);
require_once __DIR__ . '/helpers.php';

set_cors_headers();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_err('method_not_allowed', 'Только POST', 405);

$me       = auth_user();
$data     = input();
$fcmToken = trim($data['fcm_token'] ?? '');

// Allow empty token for unregistering (clears FCM token from DB)
$value = empty($fcmToken) ? null : $fcmToken;

db()->prepare('UPDATE users SET fcm_token = ? WHERE id = ?')
    ->execute([$value, $me['id']]);

$msg = empty($fcmToken) ? 'FCM токен удалён' : 'FCM токен сохранён';
json_ok(['message' => $msg]);

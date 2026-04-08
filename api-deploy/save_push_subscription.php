<?php
// POST /api/save_push_subscription.php
// Header: Authorization: Bearer <token>
// Body: { "endpoint": "...", "keys_p256dh": "...", "keys_auth": "..." }
//
// Stores or updates the Web Push subscription for the current user.
// Each user can have one active subscription (last device wins).
// Old subscriptions with expired endpoints will be cleaned up on send.
declare(strict_types=1);
require_once __DIR__ . '/helpers.php';

set_cors_headers();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_err('method_not_allowed', 'Только POST', 405);

$me   = auth_user();
$data = input();

$endpoint   = trim($data['endpoint']   ?? '');
$keysP256dh = trim($data['keys_p256dh'] ?? '');
$keysAuth   = trim($data['keys_auth']   ?? '');

if (empty($endpoint))   json_err('invalid_endpoint', 'endpoint не может быть пустым');
if (empty($keysP256dh)) json_err('invalid_keys', 'keys_p256dh не может быть пустым');
if (empty($keysAuth))   json_err('invalid_keys', 'keys_auth не может быть пустым');

// Store as JSON — simple one-subscription-per-user model.
// If you need multi-device, switch to a separate push_subscriptions table.
$subscriptionJson = json_encode([
    'endpoint'   => $endpoint,
    'keys'       => [
        'p256dh' => $keysP256dh,
        'auth'   => $keysAuth,
    ],
]);

db()->prepare('UPDATE users SET push_subscription = ? WHERE id = ?')
    ->execute([$subscriptionJson, $me['id']]);

json_ok(['message' => 'Push-подписка сохранена']);

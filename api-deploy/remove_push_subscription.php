<?php
// POST /api/remove_push_subscription.php
// Header: Authorization: Bearer <token>
// Body: {} (empty)
declare(strict_types=1);
require_once __DIR__ . '/helpers.php';

set_cors_headers();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_err('method_not_allowed', 'Только POST', 405);

$me = auth_user();

db()->prepare('UPDATE users SET push_subscription = NULL WHERE id = ?')
    ->execute([$me['id']]);

json_ok(['message' => 'Push-подписка удалена']);

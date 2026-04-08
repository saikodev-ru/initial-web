<?php
// GET /api/get_me.php
// Header: Authorization: Bearer <token>
// Returns current user profile (for cross-session avatar sync)
declare(strict_types=1);
require_once __DIR__ . '/helpers.php';

set_cors_headers();
if ($_SERVER['REQUEST_METHOD'] !== 'GET') json_err('method_not_allowed', 'Только GET', 405);

$me = auth_user();

$stmt = db()->prepare('SELECT * FROM users WHERE id = ? LIMIT 1');
$stmt->execute([$me['id']]);
$dbUser = $stmt->fetch() ?: $me;

json_ok([
    'user' => [
        'id'             => (int) $dbUser['id'],
        'email'          => $dbUser['email'],
        'nickname'       => $dbUser['nickname'],
        'signal_id'      => $dbUser['signal_id'],
        'avatar_url'     => $dbUser['avatar_url'] ?? null,
        'bio'            => $dbUser['bio'] ?? null,
        'is_verified'    => (int) ($dbUser['is_verified'] ?? 0),
        'is_team_signal' => (int) ($dbUser['is_team_signal'] ?? 0),
    ],
]);

<?php
// GET /api/resolve_profile?u=username
// PUBLIC endpoint — no auth required
// Returns user profile info for public profile pages (initial.su/@username)
declare(strict_types=1);
require_once __DIR__ . '/../helpers.php';

set_cors_headers();
if ($_SERVER['REQUEST_METHOD'] !== 'GET') json_err('method_not_allowed', 'Только GET', 405);

require_rate_limit('resolve_profile', 30, 60);

$username = trim($_GET['u'] ?? '');

if (empty($username)) {
    json_err('missing_param', 'Укажите username (параметр u)');
}

// Remove leading @ if present
$username = ltrim($username, '@');

if (mb_strlen($username) < 2 || mb_strlen($username) > 50) {
    json_err('invalid_param', 'Некорректная длина username');
}

// Only allow valid signal_id characters
$cleanId = preg_replace('/[^a-z0-9_]/i', '', $username);
if (empty($cleanId)) {
    json_err('invalid_param', 'Некорректный username');
}

$stmt = db()->prepare(
    'SELECT id, nickname, signal_id, avatar_url, bio, is_verified, is_team_signal
     FROM users
     WHERE signal_id = ?
       AND is_system = 0
     LIMIT 1'
);
$stmt->execute([$cleanId]);
$user = $stmt->fetch();

if (!$user) {
    json_err('not_found', 'Пользователь не найден', 404);
}

// Build avatar URL
$avatarUrl = null;
if (!empty($user['avatar_url'])) {
    $mediaInfo = build_media_response($user['avatar_url']);
    $avatarUrl = $mediaInfo['url'];
}

json_ok([
    'user' => [
        'id'             => (int) $user['id'],
        'nickname'       => $user['nickname'] ?? $user['signal_id'],
        'signal_id'      => $user['signal_id'],
        'avatar_url'     => $avatarUrl,
        'bio'            => $user['bio'] ?? null,
        'is_verified'    => (int) ($user['is_verified'] ?? 0),
        'is_team_signal' => (int) ($user['is_team_signal'] ?? 0),
    ],
]);

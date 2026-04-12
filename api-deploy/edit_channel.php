<?php
// POST /api/edit_channel
// Header: Authorization: Bearer <token>
// Body: { channel_id, name?, description?, username?, avatar_url?, who_can_post?, slow_mode_seconds? }
// Response: { ok: true }
declare(strict_types=1);
require_once __DIR__ . '/helpers.php';

set_cors_headers();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_err('method_not_allowed', 'Только POST', 405);

$me   = auth_user();
require_rate_limit('edit_channel', 10, 60);
$data = input();

$uid               = (int) $me['id'];
$channelId         = (int) ($data['channel_id'] ?? 0);
$name              = isset($data['name'])              ? sanitize_string(trim($data['name']), 128) : null;
$desc              = isset($data['description'])       ? sanitize_string(trim($data['description']), 512) : null;
$username          = isset($data['username'])          ? trim($data['username']) : null;
$avatarUrl         = isset($data['avatar_url'])        ? trim($data['avatar_url']) : null;
$whoCanPost        = isset($data['who_can_post'])      ? trim($data['who_can_post']) : null;
$slowModeSeconds   = isset($data['slow_mode_seconds']) ? (int) $data['slow_mode_seconds'] : null;

if ($channelId <= 0) json_err('invalid_id', 'Некорректный channel_id');

$db = db();

// Check channel & admin/owner permission
$stmt = $db->prepare(
    'SELECT c.id, c.owner_id, c.username, c.type, cm.role
     FROM channels c
     JOIN channel_members cm ON cm.channel_id = c.id AND cm.user_id = ?
     WHERE c.id = ?
     LIMIT 1'
);
$stmt->execute([$uid, $channelId]);
$channel = $stmt->fetch();

if (!$channel) json_err('not_found', 'Канал не найден', 404);
if (!in_array($channel['role'], ['owner', 'admin'], true)) {
    json_err('forbidden', 'Только владелец или администратор может редактировать канал', 403);
}

// Validate username change
if ($username !== null) {
    $username = strtolower($username);
    if ($username !== '' && !preg_match('/^[a-z0-9_]{5,32}$/', $username)) {
        json_err('invalid_username', 'Username: 5-32 символов, только a-z, 0-9, _');
    }
    if ($username !== '') {
        $chk = $db->prepare('SELECT id FROM channels WHERE username = ? AND id != ? LIMIT 1');
        $chk->execute([$username, $channelId]);
        if ($chk->fetch()) json_err('username_taken', 'Этот username уже занят');
    }
}

// Public channels require username
if ($channel['type'] === 'public' && $username !== null && empty($username) && $channel['username'] !== null) {
    json_err('username_required', 'Публичный канал не может быть без username');
}

// Validate who_can_post
if ($whoCanPost !== null) {
    if (!in_array($whoCanPost, ['admins', 'all'], true)) {
        json_err('invalid_param', 'who_can_post должен быть "admins" или "all"');
    }
}

// Validate slow_mode_seconds
if ($slowModeSeconds !== null) {
    if ($slowModeSeconds < 0) $slowModeSeconds = 0;
    if ($slowModeSeconds > 300) $slowModeSeconds = 300;
    // Round to nearest 5
    $slowModeSeconds = (int) (round($slowModeSeconds / 5) * 5);
}

// Build SET clause dynamically
$sets = [];
$params = [];

if ($name !== null) {
    if (empty($name)) json_err('invalid_name', 'Название не может быть пустым');
    $sets[] = 'name = ?';
    $params[] = $name;
}
if ($desc !== null) {
    $sets[] = 'description = ?';
    $params[] = !empty($desc) ? $desc : null;
}
if ($username !== null) {
    $sets[] = 'username = ?';
    $params[] = !empty($username) ? $username : null;
}
if ($avatarUrl !== null) {
    $sets[] = 'avatar_url = ?';
    $params[] = !empty($avatarUrl) ? $avatarUrl : null;
}
if ($whoCanPost !== null) {
    $sets[] = 'who_can_post = ?';
    $params[] = $whoCanPost;
}
if ($slowModeSeconds !== null) {
    $sets[] = 'slow_mode_seconds = ?';
    $params[] = $slowModeSeconds;
}

if (empty($sets)) json_err('nothing_to_update', 'Нет данных для обновления');

$params[] = $channelId;

$sql = 'UPDATE channels SET ' . implode(', ', $sets) . ' WHERE id = ?';
$db->prepare($sql)->execute($params);

json_ok(['ok' => true]);

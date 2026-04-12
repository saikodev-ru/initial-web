<?php
// POST /api/update_channel_member
// Header: Authorization: Bearer <token>
// Body: { channel_id, user_id, role: 'admin'|'member' }
// Response: { ok: true }
declare(strict_types=1);
require_once __DIR__ . '/helpers.php';

set_cors_headers();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_err('method_not_allowed', 'Только POST', 405);

$me   = auth_user();
require_rate_limit('update_channel_member', 20, 60);
$data = input();

$uid       = (int) $me['id'];
$channelId = (int) ($data['channel_id'] ?? 0);
$targetUid = (int) ($data['user_id'] ?? 0);
$role      = trim($data['role'] ?? '');

if ($channelId <= 0) json_err('invalid_id', 'Некорректный channel_id');
if ($targetUid <= 0) json_err('invalid_id', 'Некорректный user_id');
if (!in_array($role, ['admin', 'member'], true)) {
    json_err('invalid_role', 'Роль должна быть "admin" или "member"');
}

// Cannot change own role
if ($targetUid === $uid) json_err('forbidden', 'Нельзя изменить свою роль');

$db = db();

// Check channel & owner permission
$stmt = $db->prepare(
    'SELECT c.id, c.owner_id, cm.role
     FROM channels c
     JOIN channel_members cm ON cm.channel_id = c.id AND cm.user_id = ?
     WHERE c.id = ?
     LIMIT 1'
);
$stmt->execute([$uid, $channelId]);
$channel = $stmt->fetch();

if (!$channel) json_err('not_found', 'Канал не найден', 404);
if ($channel['role'] !== 'owner') {
    json_err('forbidden', 'Только владелец может изменять роли участников', 403);
}

// Check target user is a member
$memStmt = $db->prepare('SELECT role FROM channel_members WHERE channel_id = ? AND user_id = ? LIMIT 1');
$memStmt->execute([$channelId, $targetUid]);
$targetMember = $memStmt->fetch();

if (!$targetMember) json_err('not_member', 'Пользователь не является участником канала');

// Cannot change owner's role (only owner can transfer via separate mechanism)
if ($targetMember['role'] === 'owner') {
    json_err('forbidden', 'Нельзя изменить роль владельца');
}

$db->prepare('UPDATE channel_members SET role = ? WHERE channel_id = ? AND user_id = ?')
    ->execute([$role, $channelId, $targetUid]);

json_ok(['ok' => true]);

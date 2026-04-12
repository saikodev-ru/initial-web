<?php
// POST /api/join_channel
// Header: Authorization: Bearer <token>
// Body: { channel_id? or invite_link? or username? }
// Response: { ok: true, channel_id }
declare(strict_types=1);
require_once __DIR__ . '/helpers.php';

set_cors_headers();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_err('method_not_allowed', 'Только POST', 405);

$me   = auth_user();
require_rate_limit('join_channel', 20, 60);
$data = input();

$uid        = (int) $me['id'];
$channelId  = (int) ($data['channel_id'] ?? 0);
$inviteLink = trim($data['invite_link'] ?? '');
$username   = trim($data['username'] ?? '');

if ($channelId <= 0 && empty($inviteLink) && empty($username)) {
    json_err('invalid_params', 'Укажите channel_id, invite_link или username');
}

$db = db();

// Find channel
if ($channelId > 0) {
    $stmt = $db->prepare('SELECT * FROM channels WHERE id = ? LIMIT 1');
    $stmt->execute([$channelId]);
} elseif (!empty($inviteLink)) {
    $stmt = $db->prepare('SELECT * FROM channels WHERE invite_link_hash = ? LIMIT 1');
    $stmt->execute([$inviteLink]);
} else {
    $username = strtolower($username);
    $stmt = $db->prepare('SELECT * FROM channels WHERE username = ? AND type = ? LIMIT 1');
    $stmt->execute([$username, 'public']);
}
$channel = $stmt->fetch();

if (!$channel) json_err('not_found', 'Канал не найден', 404);

$cid = (int) $channel['id'];

// Private channel requires valid invite link
if ($channel['type'] === 'private' && ($inviteLink === '' || $channel['invite_link_hash'] !== $inviteLink)) {
    // Allow if already member
    $checkStmt = $db->prepare('SELECT id FROM channel_members WHERE channel_id = ? AND user_id = ? LIMIT 1');
    $checkStmt->execute([$cid, $uid]);
    if ($checkStmt->fetch()) {
        json_ok(['ok' => true, 'channel_id' => $cid]);
    }
    json_err('forbidden', 'Для вступления в приватный канал нужна ссылка-приглашение', 403);
}

// Check if already member
$checkStmt = $db->prepare('SELECT id FROM channel_members WHERE channel_id = ? AND user_id = ? LIMIT 1');
$checkStmt->execute([$cid, $uid]);
if ($checkStmt->fetch()) {
    json_ok(['ok' => true, 'channel_id' => $cid]);
}

// Join
try {
    $db->beginTransaction();
    $db->prepare('INSERT INTO channel_members (channel_id, user_id, role) VALUES (?, ?, ?)')
        ->execute([$cid, $uid, 'member']);
    $db->prepare('UPDATE channels SET members_count = members_count + 1 WHERE id = ?')
        ->execute([$cid]);
    $db->commit();
} catch (\Throwable $e) {
    if ($db->inTransaction()) $db->rollBack();
    error_log('join_channel error: ' . $e->getMessage());
    json_err('server_error', 'Ошибка при вступлении в канал', 500);
}

json_ok(['ok' => true, 'channel_id' => $cid]);

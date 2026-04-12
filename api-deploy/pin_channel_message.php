<?php
// POST /api/pin_channel_message
// Header: Authorization: Bearer <token>
// Body: { channel_id, message_id } or { channel_id, unpin: 1 }
// Response: { ok: true, pinned_message_id? }
declare(strict_types=1);
require_once __DIR__ . '/helpers.php';

set_cors_headers();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_err('method_not_allowed', 'Только POST', 405);

$me   = auth_user();
require_rate_limit('pin_channel_message', 10, 60);
$data = input();

$uid       = (int) $me['id'];
$channelId = (int) ($data['channel_id'] ?? 0);
$messageId = (int) ($data['message_id'] ?? 0);
$unpin     = !empty($data['unpin']);

if ($channelId <= 0) json_err('invalid_id', 'Некорректный channel_id');

$db = db();

// Check channel & admin/owner permission
$stmt = $db->prepare(
    'SELECT c.id, cm.role FROM channels c
     JOIN channel_members cm ON cm.channel_id = c.id AND cm.user_id = ?
     WHERE c.id = ?
     LIMIT 1'
);
$stmt->execute([$uid, $channelId]);
$membership = $stmt->fetch();

if (!$membership) json_err('not_found', 'Канал не найден', 404);
if (!in_array($membership['role'], ['owner', 'admin'], true)) {
    json_err('forbidden', 'Только администраторы могут закреплять сообщения', 403);
}

// ── Unpin ──────────────────────────────────────────────────────
if ($unpin) {
    $db->prepare('DELETE FROM channel_pinned WHERE channel_id = ?')
        ->execute([$channelId]);
    json_ok(['ok' => true, 'pinned_message_id' => null]);
}

// ── Pin ────────────────────────────────────────────────────────
if ($messageId <= 0) json_err('invalid_id', 'Некорректный message_id');

// Verify message exists in this channel
$stmt = $db->prepare(
    'SELECT id FROM channel_messages WHERE id = ? AND channel_id = ? AND is_deleted = 0 LIMIT 1'
);
$stmt->execute([$messageId, $channelId]);
if (!$stmt->fetch()) json_err('not_found', 'Сообщение не найдено', 404);

// Upsert pinned message (one per channel)
$db->prepare(
    'INSERT INTO channel_pinned (channel_id, message_id, pinned_by, pinned_at)
     VALUES (?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE message_id = VALUES(message_id), pinned_by = VALUES(pinned_by), pinned_at = VALUES(pinned_at)'
)->execute([$channelId, $messageId, $uid]);

json_ok(['ok' => true, 'pinned_message_id' => $messageId]);

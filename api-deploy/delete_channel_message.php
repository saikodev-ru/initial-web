<?php
// POST /api/delete_channel_message
// Header: Authorization: Bearer <token>
// Body: { message_id }
// Response: { ok: true }
declare(strict_types=1);
require_once __DIR__ . '/helpers.php';

set_cors_headers();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_err('method_not_allowed', 'Только POST', 405);

$me   = auth_user();
require_rate_limit('delete_channel_message', 30, 60);
$data = input();

$uid       = (int) $me['id'];
$messageId = (int) ($data['message_id'] ?? 0);

if ($messageId <= 0) json_err('invalid_id', 'Некорректный message_id');

$db = db();

// Find message and check permissions
$stmt = $db->prepare(
    'SELECT m.id, m.channel_id, m.sender_id, m.is_deleted,
            cm.role AS deleter_role, c.owner_id
     FROM channel_messages m
     JOIN channel_members cm ON cm.channel_id = m.channel_id AND cm.user_id = ?
     JOIN channels c ON c.id = m.channel_id
     WHERE m.id = ?
     LIMIT 1'
);
$stmt->execute([$uid, $messageId]);
$msg = $stmt->fetch();

if (!$msg) json_err('not_found', 'Сообщение не найдено', 404);
if ((int) $msg['is_deleted']) json_err('already_deleted', 'Сообщение уже удалено');

// Only sender (if admin) or owner can delete
$canDelete = false;
if ($msg['deleter_role'] === 'owner') {
    $canDelete = true;
} elseif ($msg['deleter_role'] === 'admin' && (int) $msg['sender_id'] === $uid) {
    $canDelete = true;
}
if (!$canDelete) {
    json_err('forbidden', 'У вас нет прав для удаления этого сообщения', 403);
}

// Soft-delete (mark as deleted)
$db->prepare('UPDATE channel_messages SET is_deleted = 1, body = NULL, media_url = NULL WHERE id = ?')
    ->execute([$messageId]);

// Remove from pinned if it was pinned
$db->prepare('DELETE FROM channel_pinned WHERE message_id = ?')->execute([$messageId]);

json_ok(['ok' => true]);

<?php
// POST /api/react_channel_message — add reaction
// DELETE /api/react_channel_message — remove reaction
// Body: { channel_id, message_id, emoji }
declare(strict_types=1);
require_once __DIR__ . '/../helpers.php';

set_cors_headers();

$me   = auth_user();
require_rate_limit('react_channel_message', 60, 60);
$data = input();

$channelId = (int) ($data['channel_id'] ?? 0);
$messageId = (int) ($data['message_id'] ?? 0);
$emoji     = trim($data['emoji'] ?? '');

// Normalize: remove variation selector U+FE0F
$emoji = preg_replace('/\x{FE0F}/u', '', $emoji);
$emoji = mb_substr($emoji, 0, 16);

if ($channelId <= 0) json_err('invalid_data', 'Некорректный channel_id');
if ($messageId <= 0) json_err('invalid_data', 'Некорректный message_id');
if ($emoji === '')   json_err('invalid_data', 'Эмодзи отсутствует');

$db = db();

// Verify channel membership
$stmt = $db->prepare(
    'SELECT cm.role FROM channel_members cm
     JOIN channels c ON c.id = cm.channel_id
     WHERE cm.channel_id = ? AND cm.user_id = ?
     LIMIT 1'
);
$stmt->execute([$channelId, $me['id']]);
if (!$stmt->fetch()) {
    // Allow for public channels (view-only reaction)
    $pubStmt = $db->prepare('SELECT id FROM channels WHERE id = ? AND type = ? LIMIT 1');
    $pubStmt->execute([$channelId, 'public']);
    if (!$pubStmt->fetch()) json_err('forbidden', 'Нет доступа к этому каналу', 403);
}

// Verify message exists in this channel
$msgStmt = $db->prepare(
    'SELECT id FROM channel_messages WHERE id = ? AND channel_id = ? AND is_deleted = 0 LIMIT 1'
);
$msgStmt->execute([$messageId, $channelId]);
if (!$msgStmt->fetch()) json_err('not_found', 'Сообщение не найдено', 404);

if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
    $db->prepare(
        'DELETE FROM channel_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?'
    )->execute([$messageId, $me['id'], $emoji]);
} else {
    $db->prepare(
        'INSERT IGNORE INTO channel_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)'
    )->execute([$messageId, $me['id'], $emoji]);
}

// Return current reactions for this message
$stmt = $db->prepare(
    'SELECT emoji,
            COUNT(*) AS cnt,
            MAX(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS by_me,
            MAX(CASE WHEN user_id = ? THEN UNIX_TIMESTAMP(created_at) ELSE 0 END) AS my_created_at
     FROM channel_reactions
     WHERE message_id = ?
     GROUP BY emoji
     ORDER BY cnt DESC, emoji'
);
$stmt->execute([$me['id'], $me['id'], $messageId]);

$reactions = array_map(fn($r) => [
    'emoji'      => $r['emoji'],
    'count'      => (int)  $r['cnt'],
    'by_me'      => (bool) $r['by_me'],
    'created_at' => (int)  $r['my_created_at'],
], $stmt->fetchAll());

json_ok([
    'message_id' => $messageId,
    'reactions'  => $reactions,
]);

<?php
// GET /api/get_pinned_channel_message?channel_id=X
// Returns the currently pinned message for a channel (if any)
declare(strict_types=1);
require_once __DIR__ . '/../helpers.php';

set_cors_headers();
if ($_SERVER['REQUEST_METHOD'] !== 'GET') json_err('method_not_allowed', 'Только GET', 405);

$me       = auth_user();
$uid      = (int) $me['id'];
$channelId = (int) ($_GET['channel_id'] ?? 0);

if ($channelId <= 0) json_err('invalid_id', 'Некорректный channel_id');

$db = db();

// Check membership (or public channel)
$stmt = $db->prepare(
    'SELECT cm.role FROM channel_members cm
     JOIN channels c ON c.id = cm.channel_id
     WHERE cm.channel_id = ? AND cm.user_id = ?
     LIMIT 1'
);
$stmt->execute([$channelId, $uid]);
$membership = $stmt->fetch();

if (!$membership) {
    $pubStmt = $db->prepare('SELECT id FROM channels WHERE id = ? AND type = ? LIMIT 1');
    $pubStmt->execute([$channelId, 'public']);
    if (!$pubStmt->fetch()) json_err('forbidden', 'Нет доступа', 403);
}

// Get pinned message
$stmt = $db->prepare(
    'SELECT p.message_id, p.pinned_by, p.pinned_at,
            m.body, m.media_url, m.media_type, m.sent_at, m.sender_id,
            u.nickname AS sender_name
     FROM channel_pinned p
     JOIN channel_messages m ON m.id = p.message_id AND m.is_deleted = 0
     LEFT JOIN users u ON u.id = m.sender_id
     WHERE p.channel_id = ?
     LIMIT 1'
);
$stmt->execute([$channelId]);
$pinned = $stmt->fetch();

if (!$pinned) {
    json_ok(['pinned' => null]);
}

json_ok([
    'pinned' => [
        'message_id'  => (int) $pinned['message_id'],
        'sender_id'   => (int) $pinned['sender_id'],
        'sender_name' => $pinned['sender_name'] ?? '',
        'body'        => $pinned['body'],
        'media_url'   => $pinned['media_url'],
        'media_type'  => $pinned['media_type'],
        'sent_at'     => (int) $pinned['sent_at'],
        'pinned_by'   => (int) $pinned['pinned_by'],
        'pinned_at'   => $pinned['pinned_at'],
    ],
]);

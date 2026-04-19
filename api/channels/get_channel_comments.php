<?php
// GET /api/get_channel_comments?channel_id=X&message_id=Y&limit=50&after_id=0
declare(strict_types=1);
require_once __DIR__ . '/../helpers.php';

set_cors_headers();
if ($_SERVER['REQUEST_METHOD'] !== 'GET') json_err('method_not_allowed', 'Только GET', 405);

try {
$me        = auth_user();
$uid       = (int) $me['id'];
$channelId = (int) ($_GET['channel_id'] ?? 0);
$messageId = (int) ($_GET['message_id'] ?? 0);
$afterId   = (int) ($_GET['after_id'] ?? 0);
$limit     = min(max((int) ($_GET['limit'] ?? 50), 1), 100);

if ($channelId <= 0) json_err('invalid_id', 'Некорректный channel_id');
if ($messageId <= 0) json_err('invalid_id', 'Некорректный message_id');

$db = db();

// Check membership or public channel
$stmt = $db->prepare(
    'SELECT cm.role FROM channel_members cm
     JOIN channels c ON c.id = cm.channel_id
     WHERE cm.channel_id = ? AND cm.user_id = ? LIMIT 1'
);
$stmt->execute([$channelId, $uid]);
$membership = $stmt->fetch();

if (!$membership) {
    $pubStmt = $db->prepare('SELECT id FROM channels WHERE id = ? AND type = ? LIMIT 1');
    $pubStmt->execute([$channelId, 'public']);
    if (!$pubStmt->fetch()) json_err('forbidden', 'Нет доступа', 403);
}

// Fetch comments
$stmt = $db->prepare(
    'SELECT c.id, c.sender_id, c.body, c.media_url, c.media_type, c.media_spoiler,
            c.sent_at, c.is_edited,
            u.nickname AS sender_name, u.avatar_url AS sender_avatar
     FROM channel_comments c
     JOIN users u ON u.id = c.sender_id
     WHERE c.message_id = ? AND c.channel_id = ? AND c.is_deleted = 0 AND c.id > ?
     ORDER BY c.sent_at ASC LIMIT ?'
);
$stmt->execute([$messageId, $channelId, $afterId, $limit]);
$comments = $stmt->fetchAll();

// Get total count
$countStmt = $db->prepare(
    'SELECT COUNT(*) as total FROM channel_comments WHERE message_id = ? AND channel_id = ? AND is_deleted = 0'
);
$countStmt->execute([$messageId, $channelId]);
$total = (int) $countStmt->fetchColumn();

$comments = array_map(function ($c) {
    return [
        'id'            => (int) $c['id'],
        'sender_id'     => (int) $c['sender_id'],
        'sender_name'   => $c['sender_name'] ?? '',
        'sender_avatar' => $c['sender_avatar'] ?? null,
        'body'          => $c['body'],
        'media_url'     => $c['media_url'] ?? null,
        'media_type'    => $c['media_type'] ?? null,
        'media_spoiler' => (int) ($c['media_spoiler'] ?? 0),
        'sent_at'       => (int) $c['sent_at'],
        'is_edited'     => (int) $c['is_edited'],
    ];
}, $comments);

json_ok([
    'comments' => $comments,
    'total'    => $total,
]);

} catch (\Throwable $e) {
    error_log('get_channel_comments error: ' . $e->getMessage());
    json_err('server_error', 'Ошибка загрузки комментариев', 500);
}

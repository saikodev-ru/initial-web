<?php
// GET /api/get_channels
// Header: Authorization: Bearer <token>
// Response: { channels: [...] }
declare(strict_types=1);
require_once __DIR__ . '/../helpers.php';

set_cors_headers();
if ($_SERVER['REQUEST_METHOD'] !== 'GET') json_err('method_not_allowed', 'Только GET', 405);

try {
$me = auth_user();

$uid = (int) $me['id'];
$db  = db();

// Get all channels the user is a member of, with last message preview
$lastMsgSql = "
    SELECT channel_id, id AS last_msg_id, body, sender_id, sent_at, media_type
    FROM channel_messages
    WHERE is_deleted = 0
      AND id IN (
          SELECT MAX(id) FROM channel_messages WHERE is_deleted = 0 GROUP BY channel_id
      )
";

$stmt = $db->prepare(
    "SELECT
        c.id AS channel_id,
        c.name,
        c.username,
        c.avatar_url,
        c.description,
        c.type,
        c.members_count,
        c.owner_id,
        c.who_can_post,
        c.slow_mode_seconds,
        cm.role AS member_role,
        cm.muted AS is_muted,
        cm.last_read_message_id,
        lm.last_msg_id,
        lm.body AS last_msg_body,
        lm.sender_id AS last_sender_id,
        lm.sent_at AS last_msg_sent_at,
        lm.media_type AS last_media_type,
        u.nickname AS last_sender_name
     FROM channel_members cm
     JOIN channels c ON c.id = cm.channel_id
     LEFT JOIN ({$lastMsgSql}) lm ON lm.channel_id = c.id
     LEFT JOIN users u ON u.id = lm.sender_id
     WHERE cm.user_id = ?
     ORDER BY lm.sent_at IS NULL, lm.sent_at DESC, c.created_at DESC"
);
$stmt->execute([$uid]);
$rows = $stmt->fetchAll();

$channels = array_map(function ($c) use ($db) {
    $last = null;
    if ($c['last_msg_id'] !== null) {
        $last = [
            'id'          => (int) $c['last_msg_id'],
            'body'        => $c['last_msg_body'],
            'sender_name' => $c['last_sender_name'] ?? '',
            'sent_at'     => (int) $c['last_msg_sent_at'],
            'media_type'  => $c['last_media_type'],
        ];
    }

    // Count unread messages
    $lastReadId = (int) ($c['last_read_message_id'] ?? 0);
    $unreadCount = 0;
    if ($lastReadId > 0 && $c['last_msg_id'] !== null) {
        $ucStmt = $db->prepare('SELECT COUNT(*) FROM channel_messages WHERE channel_id = ? AND id > ? AND is_deleted = 0');
        $ucStmt->execute([(int) $c['channel_id'], $lastReadId]);
        $unreadCount = (int) $ucStmt->fetchColumn();
    } elseif ($c['last_msg_id'] !== null && $lastReadId === 0) {
        // Never read any message — count all messages as unread
        $ucStmt = $db->prepare('SELECT COUNT(*) FROM channel_messages WHERE channel_id = ? AND is_deleted = 0');
        $ucStmt->execute([(int) $c['channel_id']]);
        $unreadCount = (int) $ucStmt->fetchColumn();
    }

    return [
        'channel_id'         => (int) $c['channel_id'],
        'name'               => $c['name'],
        'username'           => $c['username'],
        'avatar_url'         => $c['avatar_url'],
        'description'        => $c['description'],
        'type'               => $c['type'],
        'member_role'        => $c['member_role'],
        'my_role'            => $c['member_role'],
        'owner_id'           => (int) $c['owner_id'],
        'members_count'      => (int) $c['member_count'],
        'who_can_post'       => $c['who_can_post'] ?? 'admins',
        'slow_mode_seconds'  => (int) ($c['slow_mode_seconds'] ?? 0),
        'muted'              => !empty($c['is_muted']),
        'unread_count'       => $unreadCount,
        'last_message'       => $last,
        'last_message_time'  => $c['last_msg_sent_at'] !== null ? (int) $c['last_msg_sent_at'] : null,
    ];
}, $rows);

json_ok(['channels' => $channels]);

} catch (\Throwable $e) {
    error_log('get_channels error: ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
    json_err('server_error', 'Ошибка загрузки каналов: ' . $e->getMessage(), 500);
}

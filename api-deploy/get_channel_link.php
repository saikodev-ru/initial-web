<?php
// GET /api/get_channel_link?channel_id=X
// Header: Authorization: Bearer <token>
// Response: { invite_link } or { invite_link: null }
declare(strict_types=1);
require_once __DIR__ . '/helpers.php';

set_cors_headers();
if ($_SERVER['REQUEST_METHOD'] !== 'GET') json_err('method_not_allowed', 'Только GET', 405);

$me        = auth_user();
$uid       = (int) $me['id'];
$channelId = (int) ($_GET['channel_id'] ?? 0);

if ($channelId <= 0) json_err('invalid_id', 'Некорректный channel_id');

$db = db();

// Check channel & membership + admin/owner
$stmt = $db->prepare(
    'SELECT c.id, c.type, c.invite_link_hash, cm.role
     FROM channels c
     JOIN channel_members cm ON cm.channel_id = c.id AND cm.user_id = ?
     WHERE c.id = ?
     LIMIT 1'
);
$stmt->execute([$uid, $channelId]);
$channel = $stmt->fetch();

if (!$channel) json_err('not_found', 'Канал не найден', 404);
if (!in_array($channel['role'], ['owner', 'admin'], true)) {
    json_err('forbidden', 'Только администраторы могут просматривать ссылку-приглашение', 403);
}

// Public channels don't have invite links
if ($channel['type'] === 'public') {
    json_ok(['invite_link' => null]);
}

json_ok(['invite_link' => $channel['invite_link_hash']]);

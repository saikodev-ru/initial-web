<?php
// GET /api/get_channel_info?channel_id=X or ?username=X
// Header: Authorization: Bearer <token>
// Response: { channel_id, name, username?, description?, avatar_url?, type, members_count, created_at, member_role, owner_id, invite_link?, muted, slow_mode_seconds, who_can_post }
declare(strict_types=1);
require_once __DIR__ . '/helpers.php';

set_cors_headers();
if ($_SERVER['REQUEST_METHOD'] !== 'GET') json_err('method_not_allowed', 'Только GET', 405);

$me       = auth_user();
$uid      = (int) $me['id'];
$channelId = (int) ($_GET['channel_id'] ?? 0);
$username  = trim($_GET['username'] ?? '');

if ($channelId <= 0 && empty($username)) {
    json_err('invalid_params', 'Укажите channel_id или username');
}

$db = db();

// Find channel
if (!empty($username)) {
    $username = strtolower($username);
    $stmt = $db->prepare('SELECT * FROM channels WHERE username = ? LIMIT 1');
    $stmt->execute([$username]);
} else {
    $stmt = $db->prepare('SELECT * FROM channels WHERE id = ? LIMIT 1');
    $stmt->execute([$channelId]);
}
$channel = $stmt->fetch();

if (!$channel) json_err('not_found', 'Канал не найден', 404);

$cid = (int) $channel['id'];

// Check membership
$memStmt = $db->prepare('SELECT role, muted FROM channel_members WHERE channel_id = ? AND user_id = ? LIMIT 1');
$memStmt->execute([$cid, $uid]);
$member = $memStmt->fetch();

// If not member but public channel, allow viewing
$memberRole = $member ? $member['role'] : null;
if (!$member && $channel['type'] === 'private') {
    json_err('forbidden', 'Это приватный канал', 403);
}

$isAdmin = in_array($memberRole, ['owner', 'admin'], true);

$response = [
    'channel_id'         => $cid,
    'name'               => $channel['name'],
    'username'           => $channel['username'],
    'description'        => $channel['description'],
    'avatar_url'         => $channel['avatar_url'],
    'type'               => $channel['type'],
    'members_count'      => (int) $channel['members_count'],
    'created_at'         => $channel['created_at'],
    'member_role'        => $memberRole,
    'my_role'            => $memberRole,
    'owner_id'           => (int) $channel['owner_id'],
    'muted'              => $member ? (bool) $member['muted'] : false,
    'slow_mode_seconds'  => (int) $channel['slow_mode_seconds'],
    'who_can_post'       => $channel['who_can_post'] ?: 'admins',
];

// Show invite_link only to admin/owner
if ($isAdmin && $channel['invite_link_hash'] !== null) {
    $response['invite_link'] = $channel['invite_link_hash'];
}

json_ok($response);

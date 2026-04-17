<?php
// GET /api/get_channel_members?channel_id=X&limit=50&offset=0
// Header: Authorization: Bearer <token>
// Response: { members: [...], total }
declare(strict_types=1);
require_once __DIR__ . '/../helpers.php';

set_cors_headers();
if ($_SERVER['REQUEST_METHOD'] !== 'GET') json_err('method_not_allowed', 'Только GET', 405);

$me        = auth_user();
$uid       = (int) $me['id'];
$channelId = (int) ($_GET['channel_id'] ?? 0);
$limit     = min(max((int) ($_GET['limit'] ?? 50), 1), 200);
$offset    = max((int) ($_GET['offset'] ?? 0), 0);

if ($channelId <= 0) json_err('invalid_id', 'Некорректный channel_id');

$db = db();

// Check channel & membership
$stmt = $db->prepare(
    'SELECT c.id, cm.role FROM channels c
     JOIN channel_members cm ON cm.channel_id = c.id AND cm.user_id = ?
     WHERE c.id = ?
     LIMIT 1'
);
$stmt->execute([$uid, $channelId]);
$membership = $stmt->fetch();

if (!$membership) json_err('forbidden', 'Нет доступа к этому каналу', 403);

$isAdmin = in_array($membership['role'], ['owner', 'admin'], true);

// Total count
$totalStmt = $db->prepare('SELECT COUNT(*) FROM channel_members WHERE channel_id = ?');
$totalStmt->execute([$channelId]);
$total = (int) $totalStmt->fetchColumn();

// Only owner/admin can see full member list
if (!$isAdmin) {
    json_ok([
        'members' => [],
        'total'   => $total,
    ]);
}

// Fetch members with user info
$stmt = $db->prepare(
    'SELECT cm.user_id, u.nickname, u.avatar_url, cm.role, cm.joined_at
     FROM channel_members cm
     JOIN users u ON u.id = cm.user_id
     WHERE cm.channel_id = ?
     ORDER BY
        CASE cm.role WHEN \'owner\' THEN 0 WHEN \'admin\' THEN 1 ELSE 2 END,
        cm.joined_at ASC
     LIMIT ? OFFSET ?'
);
$stmt->execute([$channelId, $limit, $offset]);
$rows = $stmt->fetchAll();

$members = array_map(fn($r) => [
    'user_id'    => (int) $r['user_id'],
    'nickname'   => $r['nickname'] ?? '',
    'avatar_url' => $r['avatar_url'],
    'role'       => $r['role'],
    'joined_at'  => $r['joined_at'],
], $rows);

json_ok([
    'members' => $members,
    'total'   => $total,
]);

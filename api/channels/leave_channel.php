<?php
// POST /api/leave_channel
// Header: Authorization: Bearer <token>
// Body: { channel_id }
// Response: { ok: true }
declare(strict_types=1);
require_once __DIR__ . '/../helpers.php';

set_cors_headers();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_err('method_not_allowed', 'Только POST', 405);

$me   = auth_user();
require_rate_limit('leave_channel', 10, 60);
$data = input();

$uid       = (int) $me['id'];
$channelId = (int) ($data['channel_id'] ?? 0);

if ($channelId <= 0) json_err('invalid_id', 'Некорректный channel_id');

$db = db();

// Check channel exists
$stmt = $db->prepare('SELECT * FROM channels WHERE id = ? LIMIT 1');
$stmt->execute([$channelId]);
$channel = $stmt->fetch();
if (!$channel) json_err('not_found', 'Канал не найден', 404);

// Check membership
$memStmt = $db->prepare('SELECT role FROM channel_members WHERE channel_id = ? AND user_id = ? LIMIT 1');
$memStmt->execute([$channelId, $uid]);
$member = $memStmt->fetch();
if (!$member) json_err('not_member', 'Вы не участник этого канала');

// Owner cannot leave
if ($member['role'] === 'owner') {
    json_err('forbidden', 'Владелец не может покинуть канал. Передайте права или удалите канал.');
}

try {
    $db->beginTransaction();
    $db->prepare('DELETE FROM channel_members WHERE channel_id = ? AND user_id = ?')
        ->execute([$channelId, $uid]);
    $db->prepare('UPDATE channels SET members_count = GREATEST(members_count - 1, 1) WHERE id = ?')
        ->execute([$channelId]);
    $db->commit();
} catch (\Throwable $e) {
    if ($db->inTransaction()) $db->rollBack();
    error_log('leave_channel error: ' . $e->getMessage());
    json_err('server_error', 'Ошибка при выходе из канала', 500);
}

json_ok(['ok' => true]);

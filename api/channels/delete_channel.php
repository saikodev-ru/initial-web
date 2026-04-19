<?php
// POST /api/delete_channel
// Header: Authorization: Bearer <token>
// Body: { channel_id }
// Response: { ok: true }
declare(strict_types=1);
require_once __DIR__ . '/../helpers.php';

set_cors_headers();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_err('method_not_allowed', 'Только POST', 405);

$me   = auth_user();
require_rate_limit('delete_channel', 5, 60);
$data = input();

$uid       = (int) $me['id'];
$channelId = (int) ($data['channel_id'] ?? 0);

if ($channelId <= 0) json_err('invalid_id', 'Некорректный channel_id');

$db = db();

// Check channel & owner permission
$stmt = $db->prepare(
    'SELECT c.id, c.owner_id, cm.role
     FROM channels c
     JOIN channel_members cm ON cm.channel_id = c.id AND cm.user_id = ?
     WHERE c.id = ?
     LIMIT 1'
);
$stmt->execute([$uid, $channelId]);
$channel = $stmt->fetch();

if (!$channel) json_err('not_found', 'Канал не найден', 404);
if ($channel['role'] !== 'owner') {
    json_err('forbidden', 'Только владелец может удалить канал', 403);
}

try {
    $db->beginTransaction();

    // Delete reactions
    $db->prepare(
        'DELETE cr FROM channel_reactions cr
         JOIN channel_messages cm ON cm.id = cr.message_id
         WHERE cm.channel_id = ?'
    )->execute([$channelId]);

    // Delete pinned message
    $db->prepare('DELETE FROM channel_pinned WHERE channel_id = ?')->execute([$channelId]);

    // Delete comments (before messages, since they reference message_id)
    $db->prepare('DELETE FROM channel_comments WHERE channel_id = ?')->execute([$channelId]);

    // Delete messages
    $db->prepare('DELETE FROM channel_messages WHERE channel_id = ?')->execute([$channelId]);

    // Delete members
    $db->prepare('DELETE FROM channel_members WHERE channel_id = ?')->execute([$channelId]);

    // Delete channel
    $db->prepare('DELETE FROM channels WHERE id = ?')->execute([$channelId]);

    $db->commit();
} catch (\Throwable $e) {
    if ($db->inTransaction()) $db->rollBack();
    error_log('delete_channel error: ' . $e->getMessage());
    json_err('server_error', 'Ошибка при удалении канала', 500);
}

json_ok(['ok' => true]);

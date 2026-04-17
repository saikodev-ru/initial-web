<?php
// POST /api/mute_channel
// Header: Authorization: Bearer <token>
// Body: { channel_id, muted: true|false }
// Response: { ok: true }
declare(strict_types=1);
require_once __DIR__ . '/../helpers.php';

set_cors_headers();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_err('method_not_allowed', 'Только POST', 405);

$me   = auth_user();
$data = input();

$uid       = (int) $me['id'];
$channelId = (int) ($data['channel_id'] ?? 0);
$muted     = !empty($data['muted']) ? 1 : 0;

if ($channelId <= 0) json_err('invalid_id', 'Некорректный channel_id');

$db = db();

// Verify membership
$stmt = $db->prepare(
    'SELECT channel_id FROM channel_members WHERE channel_id = ? AND user_id = ? LIMIT 1'
);
$stmt->execute([$channelId, $uid]);
if (!$stmt->fetch()) json_err('forbidden', 'Вы не участник этого канала', 403);

$db->prepare('UPDATE channel_members SET muted = ? WHERE channel_id = ? AND user_id = ?')
    ->execute([$muted, $channelId, $uid]);

json_ok(['ok' => true]);

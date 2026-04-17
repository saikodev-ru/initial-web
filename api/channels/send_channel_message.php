<?php
// POST /api/send_channel_message
// Header: Authorization: Bearer <token>
// Body: { channel_id, body?, reply_to?, media_url?, media_type?, media_spoiler?, batch_id?, media_file_name?, media_file_size? }
// Response: { message_id, channel_id, sent_at }
declare(strict_types=1);
require_once __DIR__ . '/../helpers.php';

set_cors_headers();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_err('method_not_allowed', 'Только POST', 405);

$me   = auth_user();
require_rate_limit('send_channel_message', 30, 60);
$data = input();

$uid          = (int) $me['id'];
$channelId    = (int) ($data['channel_id'] ?? 0);
$body         = sanitize_string(trim($data['body'] ?? ''), 10000);
$replyTo      = isset($data['reply_to'])       ? (int) $data['reply_to'] : null;
$mediaUrl     = trim($data['media_url']        ?? '');
$mediaType    = trim($data['media_type']       ?? '');
$mediaSpoiler = !empty($data['media_spoiler']) ? 1 : 0;
$batchId      = trim($data['batch_id']         ?? '');
$mediaFileName = trim($data['media_file_name']  ?? '');
$mediaFileSize = isset($data['media_file_size']) ? (int) $data['media_file_size'] : null;

// ── Validation ─────────────────────────────────────────────────
if ($channelId <= 0) json_err('invalid_id', 'Некорректный channel_id');

$hasText  = mb_strlen($body) > 0;
$hasMedia = !empty($mediaUrl);

if (!$hasText && !$hasMedia) json_err('empty_message', 'Сообщение не может быть пустым');

// ── Check channel & permissions ─────────────────────────────────
$db = db();

$stmt = $db->prepare(
    'SELECT c.id, c.owner_id, cm.role
     FROM channels c
     JOIN channel_members cm ON cm.channel_id = c.id AND cm.user_id = ?
     WHERE c.id = ?
     LIMIT 1'
);
$stmt->execute([$uid, $channelId]);
$membership = $stmt->fetch();

if (!$membership) json_err('forbidden', 'Вы не участник этого канала', 403);

$isAdmin = in_array($membership['role'], ['owner', 'admin'], true);

// Only admins can post (default until migration 006 is applied)
if (!$isAdmin) {
    json_err('forbidden', 'Только администраторы могут отправлять сообщения в этот канал', 403);
}

if ($hasMedia) {
    if (!in_array($mediaType, ['image', 'video', 'file', 'audio'], true)) {
        json_err('invalid_media_type', 'Некорректный media_type');
    }
}

if (mb_strlen($batchId) > 64) $batchId = '';

$sentAt = time();

try {
    $db->beginTransaction();

    // Insert message
    $stmt = $db->prepare(
        'INSERT INTO channel_messages
         (channel_id, sender_id, body, reply_to, media_url, media_type, media_spoiler, batch_id, media_file_name, media_file_size, sent_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    $stmt->execute([
        $channelId,
        $uid,
        $hasText  ? $body       : null,
        $replyTo,
        $hasMedia ? $mediaUrl    : null,
        $hasMedia ? $mediaType   : null,
        $hasMedia ? $mediaSpoiler : 0,
        ($hasMedia && $batchId !== '') ? $batchId : null,
        !empty($mediaFileName) ? $mediaFileName : null,
        $mediaFileSize,
        $sentAt,
    ]);
    $messageId = (int) $db->lastInsertId();

    // Update channel's updated_at
    $db->prepare('UPDATE channels SET updated_at = NOW() WHERE id = ?')->execute([$channelId]);

    $db->commit();
} catch (\Throwable $e) {
    if ($db->inTransaction()) $db->rollBack();
    error_log('send_channel_message error: ' . $e->getMessage());
    json_err('server_error', 'Ошибка при отправке сообщения', 500);
}

json_ok([
    'message_id' => $messageId,
    'channel_id' => $channelId,
    'sent_at'    => $sentAt,
]);

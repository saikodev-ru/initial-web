<?php
// POST /api/send_channel_comment
// Body: { channel_id, message_id, body, reply_to? }
declare(strict_types=1);
require_once __DIR__ . '/../helpers.php';

set_cors_headers();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_err('method_not_allowed', 'Только POST', 405);

$me   = auth_user();
require_rate_limit('send_channel_comment', 30, 60);
$data = input();

$uid       = (int) $me['id'];
$channelId = (int) ($data['channel_id'] ?? 0);
$messageId = (int) ($data['message_id'] ?? 0);
$body      = sanitize_string(trim($data['body'] ?? ''), 10000);
$mediaUrl  = trim($data['media_url'] ?? '');
$mediaType = trim($data['media_type'] ?? '');

if ($channelId <= 0) json_err('invalid_id', 'Некорректный channel_id');
if ($messageId <= 0) json_err('invalid_id', 'Некорректный message_id');

$hasText  = mb_strlen($body) > 0;
$hasMedia = !empty($mediaUrl);

if (!$hasText && !$hasMedia) json_err('empty_comment', 'Комментарий не может быть пустым');

$db = db();

// Check membership
$stmt = $db->prepare(
    'SELECT cm.role, c.who_can_post FROM channel_members cm
     JOIN channels c ON c.id = cm.channel_id
     WHERE cm.channel_id = ? AND cm.user_id = ? LIMIT 1'
);
$stmt->execute([$channelId, $uid]);
$membership = $stmt->fetch();

if (!$membership) {
    // Allow comments on public channels even for non-members
    $pubStmt = $db->prepare('SELECT id, who_can_post FROM channels WHERE id = ? AND type = ? LIMIT 1');
    $pubStmt->execute([$channelId, 'public']);
    $pubChannel = $pubStmt->fetch();
    if (!$pubChannel) json_err('forbidden', 'Нет доступа', 403);
    $membership = ['role' => 'member', 'who_can_post' => $pubChannel['who_can_post']];
}

// Verify message exists
$msgStmt = $db->prepare(
    'SELECT id FROM channel_messages WHERE id = ? AND channel_id = ? AND is_deleted = 0 LIMIT 1'
);
$msgStmt->execute([$messageId, $channelId]);
if (!$msgStmt->fetch()) json_err('not_found', 'Сообщение не найдено', 404);

// Check posting permissions
$isAdmin = in_array($membership['role'], ['owner', 'admin'], true);
$whoCanPost = $membership['who_can_post'] ?? 'admins';
if (!$isAdmin && $whoCanPost !== 'all') {
    json_err('forbidden', 'Только администраторы могут комментировать', 403);
}

$sentAt = time();

try {
    $db->beginTransaction();

    // Insert comment
    $stmt = $db->prepare(
        'INSERT INTO channel_comments (message_id, channel_id, sender_id, body, media_url, media_type, media_spoiler, sent_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    $stmt->execute([
        $messageId,
        $channelId,
        $uid,
        $hasText  ? $body      : null,
        $hasMedia ? $mediaUrl  : null,
        $hasMedia ? $mediaType : null,
        $hasMedia ? (int)(!empty($data['media_spoiler'])) : 0,
        $sentAt,
    ]);
    $commentId = (int) $db->lastInsertId();

    // Increment comments_count on the parent message
    $db->prepare('UPDATE channel_messages SET comments_count = comments_count + 1 WHERE id = ?')
        ->execute([$messageId]);

    $db->commit();
} catch (\Throwable $e) {
    if ($db->inTransaction()) $db->rollBack();
    error_log('send_channel_comment error: ' . $e->getMessage());
    json_err('server_error', 'Ошибка при отправке комментария', 500);
}

json_ok([
    'comment_id' => $commentId,
    'channel_id' => $channelId,
    'message_id' => $messageId,
    'sent_at'    => $sentAt,
]);

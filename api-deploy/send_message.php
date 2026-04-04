<?php
// POST /api/send_message.php
// Header: Authorization: Bearer <token>
// Body: {
//   "to_signal_id": "ivan_42",
//   "body":         "Привет!",           // можно пустым если есть media_url
//   "reply_to":     42,                  // опционально
//   "media_url":    "https://...",       // опционально
//   "media_type":   "image" | "video"   // обязателен если media_url задан
// }
declare(strict_types=1);
require_once __DIR__ . '/helpers.php';

set_cors_headers();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_err('method_not_allowed', 'Только POST', 405);

$me   = auth_user();
$data = input();

$toSignalId   = trim($data['to_signal_id']  ?? '');
$body         = trim($data['body']          ?? '');
$replyTo      = isset($data['reply_to'])    ? (int) $data['reply_to'] : null;
$mediaUrl     = trim($data['media_url']     ?? '');
$mediaType    = trim($data['media_type']    ?? '');
$mediaSpoiler = !empty($data['media_spoiler']) ? 1 : 0;
$batchId      = trim($data['batch_id']      ?? '');

// ── Валидация ─────────────────────────────────────────────────
if (empty($toSignalId)) json_err('invalid_recipient', 'Укажите получателя');

$hasText  = mb_strlen($body) > 0;
$hasMedia = !empty($mediaUrl);

if (!$hasText && !$hasMedia) json_err('empty_message', 'Сообщение не может быть пустым');
if ($hasText && mb_strlen($body) > 10000) json_err('message_too_long', 'Максимум 10 000 символов');

if ($hasMedia) {
    if (!in_array($mediaType, ['image', 'video'], true)) {
        json_err('invalid_media_type', 'media_type должен быть "image" или "video"');
    }
    if (!str_starts_with($mediaUrl, 'https://') && !str_starts_with($mediaUrl, 'media/')) {
        json_err('invalid_media_url', 'media_url должен быть ссылкой (https://) или относительным путем (media/)');
    }
}

if (mb_strlen($batchId) > 64) $batchId = '';

// ── Найти получателя ──────────────────────────────────────────
$stmt = db()->prepare('SELECT id, nickname, fcm_token FROM users WHERE signal_id = ? LIMIT 1');
$stmt->execute([$toSignalId]);
$recipient = $stmt->fetch();

if (!$recipient) json_err('user_not_found', "Пользователь @{$toSignalId} не найден");

$senderId    = (int) $me['id'];
$recipientId = (int) $recipient['id'];

// Нельзя писать самому себе, КРОМЕ чата «Избранное»
$isSelfMessage = $senderId === $recipientId;
if ($isSelfMessage) {
    $stmtSaved = db()->prepare(
        'SELECT id FROM chats WHERE is_saved_msgs = 1 AND user_a = ? AND user_b = ? LIMIT 1'
    );
    $stmtSaved->execute([$senderId, $senderId]);
    if (!$stmtSaved->fetch()) {
        json_err('self_message', 'Нельзя писать самому себе');
    }
}

// ── Найти или создать чат ─────────────────────────────────────
if ($isSelfMessage) {
    $stmt = db()->prepare('SELECT id FROM chats WHERE is_saved_msgs = 1 AND user_a = ? LIMIT 1');
    $stmt->execute([$senderId]);
    $chat = $stmt->fetch();
    if (!$chat) {
        db()->prepare(
            'INSERT INTO chats (user_a, user_b, is_saved_msgs, is_protected) VALUES (?, ?, 1, 1)'
        )->execute([$senderId, $senderId]);
        $chatId = (int) db()->lastInsertId();
    } else {
        $chatId = (int) $chat['id'];
    }
} else {
    $userA = min($senderId, $recipientId);
    $userB = max($senderId, $recipientId);

    $stmt = db()->prepare('SELECT id FROM chats WHERE user_a = ? AND user_b = ? AND is_saved_msgs = 0 LIMIT 1');
    $stmt->execute([$userA, $userB]);
    $chat = $stmt->fetch();

    if (!$chat) {
        db()->prepare('INSERT INTO chats (user_a, user_b) VALUES (?, ?)')->execute([$userA, $userB]);
        $chatId = (int) db()->lastInsertId();
    } else {
        $chatId = (int) $chat['id'];
    }
}

// ── Сохранить сообщение ───────────────────────────────────────
$stmt = db()->prepare(
    'INSERT INTO messages (chat_id, sender_id, body, reply_to, media_url, media_type, media_spoiler, batch_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
);
$stmt->execute([
    $chatId,
    $senderId,
    $body,
    $replyTo,
    $hasMedia ? $mediaUrl  : null,
    $hasMedia ? $mediaType : null,
    $hasMedia ? $mediaSpoiler : 0,
    ($hasMedia && $batchId !== '') ? $batchId : null,
]);
$messageId = (int) db()->lastInsertId();

// ── Получить точный sent_at ───────────────────────────────────
$stmt = db()->prepare('SELECT FLOOR(UNIX_TIMESTAMP(sent_at)) AS ts FROM messages WHERE id = ? LIMIT 1');
$stmt->execute([$messageId]);
$sentAt = (int) ($stmt->fetchColumn() ?: time());

// ── Push-уведомление ─────────────────────────────────────────
if (!empty($recipient['fcm_token'])) {
    $senderName = $me['nickname'] ?? $me['email'];
    $pushBody   = $hasMedia
        ? ($mediaType === 'video' ? '🎥 Видео' : '🖼 Фото') . ($hasText ? ": $body" : '')
        : (mb_strlen($body) > 80 ? mb_substr($body, 0, 80) . '…' : $body);

    send_push(
    $recipient['fcm_token'],
    $senderName,
    $pushBody,
    [
        'chat_id'          => (string) $chatId,
        'sender_signal_id' => $me['signal_id'] ?? '',
        'sender_avatar'    => $me['avatar_url'] ?? '', // просто ключ: avatars/user_2_xxx.jpg
        'media_type'       => $mediaType,
    ]
);
}

json_ok([
    'message_id' => $messageId,
    'chat_id'    => $chatId,
    'sent_at'    => $sentAt,
]);
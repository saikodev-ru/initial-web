<?php
// POST /api/send_message
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
require_rate_limit('send_message', 60, 60);
$data = input();

$toSignalId   = sanitize_string(trim($data['to_signal_id'] ?? ''), 100);
$body         = sanitize_string(trim($data['body'] ?? ''), 10000);
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
    // media_url должен быть: наш S3 ключ, наш прокси, или подписанный URL
    $allowedMediaPrefixes = ['media/', 'avatars/', 'music/', 'get_media.php'];
    $urlOk = false;
    foreach ($allowedMediaPrefixes as $prefix) {
        if (str_starts_with($mediaUrl, $prefix)) { $urlOk = true; break; }
    }
    // Также разрешаем подписанные URL
    if (!$urlOk && str_contains($mediaUrl, 'sig=') && str_contains($mediaUrl, 'exp=')) $urlOk = true;
    if (!$urlOk) {
        json_err('invalid_media_url', 'Некорректный media_url');
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

// ── Найти или создать чат (атомарно через общий хелпер) ───────
$chatId = $isSelfMessage
    ? find_or_create_chat($senderId, $senderId, savedMsgs: true)
    : find_or_create_chat($senderId, $recipientId);

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

// ── Push-уведомление (FCM only) ─────────────────────────────────
$senderName = $me['nickname'] ?? $me['email'];
$pushBody   = $hasMedia
    ? ($mediaType === 'video' ? 'Видео' : 'Фото') . ($hasText ? ": " . mb_substr($body, 0, 80) : '')
    : (mb_strlen($body) > 80 ? mb_substr($body, 0, 80) . '...' : $body);

$pushData = [
    'chat_id'          => (string) $chatId,
    'sender_signal_id' => $me['signal_id'] ?? '',
    'sender_avatar'    => $me['avatar_url'] ?? '',
    'media_type'       => $mediaType,
    'message_id'       => (string) $messageId,
    'sender_name'      => $senderName,
];

// FCM push (sole push channel)
if (!empty($recipient['fcm_token'])) {
    send_push(
        $recipient['fcm_token'],
        $senderName,
        $pushBody,
        $pushData
    );
}

json_ok([
    'message_id' => $messageId,
    'chat_id'    => $chatId,
    'sent_at'    => $sentAt,
]);

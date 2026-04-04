<?php
// ═══════════════════════════════════════════════════════════════
//  SEND VOICE MESSAGE
//  POST /api/send_voice_message.php
//  Header: Authorization: Bearer <token>
//  Body:   multipart/form-data
//          voice          — encrypted audio file (AES-256-GCM)
//          to_signal_id   — recipient signal ID
//          reply_to       — (optional) message ID to reply to
//          voice_duration — (optional) duration in seconds
//          voice_waveform — (optional) JSON array of 0-1 values
//          enc_key        — AES-256 key (hex, 64 chars)
//          enc_iv         — AES-GCM IV  (hex, 24 chars)
//
//  Security: audio is encrypted client-side with AES-256-GCM.
//  The server decrypts it upon receipt and stores plaintext in S3.
//  Key & IV travel as POST params separate from the file blob,
//  so intercepted uploads are useless without them.
//
//  Flow: текстовые данные на сервере (MySQL), медиа в S3
//
//  Response: { "ok": true, "message_id": int, "chat_id": int }
// ═══════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/s3_helper.php';

set_cors_headers();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_err('method_not_allowed', 'Только POST', 405);

$me   = auth_user();
$myId = (int) $me['id'];

/* ── Validate required fields ────────────────────────────────── */
$toSignalId = trim($_POST['to_signal_id'] ?? '');
if (empty($toSignalId)) {
    json_err('missing_param', 'Не указан to_signal_id');
}

// Cannot send to self
$mySignal = $me['signal_id'] ?? '';
if (strtolower($toSignalId) === strtolower($mySignal)) {
    json_err('self_send', 'Нельзя отправить сообщение самому себе');
}

// Cannot send to @signal bot
if (strtolower($toSignalId) === 'signal') {
    json_err('invalid_recipient', 'Нельзя отправить голосовое @signal');
}

$replyTo       = !empty($_POST['reply_to']) ? (int) $_POST['reply_to'] : null;
$voiceDuration = !empty($_POST['voice_duration']) ? (int) $_POST['voice_duration'] : 0;
$voiceWaveform = validate_waveform_json($_POST['voice_waveform'] ?? '[]');

/* ── Validate voice file upload ──────────────────────────────── */
$upload = validate_voice_upload($_FILES['voice'] ?? []);
$tmpPath = $upload['tmp'];
$size    = $upload['size'];

/* ── AES-256-GCM DECRYPTION ──────────────────────────────────── */
$encKey = trim($_POST['enc_key'] ?? '');
$encIv  = trim($_POST['enc_iv'] ?? '');

if (!empty($encKey) && !empty($encIv)) {
    $cipherText = @file_get_contents($tmpPath);
    if ($cipherText === false) {
        json_err('read_error', 'Не удалось прочитать загруженный файл');
    }

    $plainText = decrypt_aes256gcm($cipherText, $encKey, $encIv);
    if ($plainText === false) {
        json_err('decrypt_error', 'Ошибка расшифровки голосового сообщения', 500);
    }

    // Write decrypted data to temp file
    $decPath = $tmpPath . '.dec';
    if (@file_put_contents($decPath, $plainText) === false) {
        json_err('write_error', 'Ошибка записи расшифрованного файла', 500);
    }

    $tmpPath = $decPath;
    $size    = strlen($plainText);
    unset($plainText, $cipherText);

    // After decryption, force webm/opus (what MediaRecorder produces)
    $ext  = 'webm';
    $mime = 'audio/webm';
} else {
    // No encryption — detect format from file
    $audioInfo = detect_audio_mime_ext($tmpPath);
    $ext  = $audioInfo['ext'];
    $mime = $audioInfo['mime'];
}

/* ── Get duration if not provided ────────────────────────────── */
if ($voiceDuration <= 0) {
    $voiceDuration = get_audio_duration($tmpPath, $size);
}

/* ── Upload to S3 (медиа в S3) ──────────────────────────────── */
$s3Path = make_voice_s3_path($myId, $ext);
$s3Key  = s3_upload($tmpPath, $s3Path['key'], $s3Path['mime']);
if (!$s3Key) {
    json_err('upload_error', 'Не удалось загрузить голосовое сообщение', 500);
}

// В БД храним относительный s3Key для унификации со всеми остальными медиа
$mediaUrl = ltrim($s3Key, '/');

// Clean up temp files
if (file_exists($tmpPath))     @unlink($tmpPath);
if (isset($decPath) && file_exists($decPath)) @unlink($decPath);

/* ── Найти получателя (как в send_message.php) ──────────────── */
$stmt = db()->prepare('SELECT id, nickname, fcm_token FROM users WHERE signal_id = ? LIMIT 1');
$stmt->execute([$toSignalId]);
$recipient = $stmt->fetch();

if (!$recipient) {
    json_err('user_not_found', "Пользователь @{$toSignalId} не найден");
}

$recipientId = (int) $recipient['id'];

if ($recipientId === $myId) {
    json_err('self_send', 'Нельзя отправить сообщение самому себе');
}

/* ── Найти или создать чат (user_a/min, user_b/max) ────────── */
$userA = min($myId, $recipientId);
$userB = max($myId, $recipientId);

$stmt = db()->prepare('SELECT id FROM chats WHERE user_a = ? AND user_b = ? AND is_saved_msgs = 0 LIMIT 1');
$stmt->execute([$userA, $userB]);
$chat = $stmt->fetch();

if ($chat) {
    $chatId = (int) $chat['id'];
} else {
    db()->prepare('INSERT INTO chats (user_a, user_b) VALUES (?, ?)')->execute([$userA, $userB]);
    $chatId = (int) db()->lastInsertId();
}

/* ── Insert message (как в send_message.php) ────────────────── */
$stmt = db()->prepare(
    'INSERT INTO messages (chat_id, sender_id, body, reply_to, media_url, media_type, voice_duration, voice_waveform)
     VALUES (?, ?, ?, ?, ?, "voice", ?, ?)'
);
$stmt->execute([
    $chatId,
    $myId,
    '',              // body — голосовые не имеют текста (duration передаётся отдельно)
    $replyTo,
    $mediaUrl,
    $voiceDuration,
    $voiceWaveform,
]);

$messageId = (int) db()->lastInsertId();

/* ── Получить точный sent_at ─────────────────────────────────── */
$stmt = db()->prepare('SELECT FLOOR(UNIX_TIMESTAMP(sent_at)) AS ts FROM messages WHERE id = ? LIMIT 1');
$stmt->execute([$messageId]);
$sentAt = (int) ($stmt->fetchColumn() ?: time());

/* ── Push-уведомление ───────────────────────────────────────── */
if (!empty($recipient['fcm_token'])) {
    $senderName = $me['nickname'] ?? $me['email'];

    send_push(
        $recipient['fcm_token'],
        $senderName,
        '🎤 Голосовое сообщение',
        [
            'chat_id'          => (string) $chatId,
            'sender_signal_id' => $me['signal_id'] ?? '',
            'sender_avatar'    => $me['avatar_url'] ?? '',
            'media_type'       => 'voice',
            'voice_duration'   => (string) $voiceDuration,
        ]
    );
}

json_ok([
    'message_id'     => $messageId,
    'chat_id'        => $chatId,
    'sent_at'        => $sentAt,
    'media_url'      => $mediaUrl,
    'voice_duration' => $voiceDuration,
    'voice_waveform' => $voiceWaveform,
]);

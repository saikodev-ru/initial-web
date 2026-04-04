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
require_once __DIR__ . '/../upload/helpers.php';
require_once __DIR__ . '/../upload/s3_helper.php';

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

/* ── Get recipient user (текстовые данные на сервере) ────────── */
$pdo = get_pdo();

$stmt = $pdo->prepare('SELECT id, signal_id FROM users WHERE LOWER(signal_id) = LOWER(?) LIMIT 1');
$stmt->execute([$toSignalId]);
$recipient = $stmt->fetch(PDO::FETCH_ASSOC);

if (!$recipient) {
    json_err('user_not_found', 'Пользователь не найден');
}

$recipientId = (int) $recipient['id'];

if ($recipientId === $myId) {
    json_err('self_send', 'Нельзя отправить сообщение самому себе');
}

/* ── Get or create chat ──────────────────────────────────────── */
$stmt = $pdo->prepare("
    SELECT id FROM chats
    WHERE (user1_id = ? AND user2_id = ?) OR (user1_id = ? AND user2_id = ?)
    LIMIT 1
");
$stmt->execute([$myId, $recipientId, $recipientId, $myId]);
$chat = $stmt->fetch(PDO::FETCH_ASSOC);

if ($chat) {
    $chatId = (int) $chat['id'];
} else {
    $stmt = $pdo->prepare("
        INSERT INTO chats (user1_id, user2_id, created_at, updated_at)
        VALUES (?, ?, NOW(), NOW())
    ");
    $stmt->execute([$myId, $recipientId]);
    $chatId = (int) $pdo->lastInsertId();
}

/* ── Insert message (текстовые данные на сервере) ────────────── */
$stmt = $pdo->prepare("
    INSERT INTO messages (chat_id, sender_id, body, media_type, media_url, media_file_name,
                          voice_duration, voice_waveform, reply_to, sent_at, is_read)
    VALUES (?, ?, ?, 'voice', ?, ?, ?, ?, ?, NOW(), 0)
");
$stmt->execute([
    $chatId,
    $myId,
    (string) $voiceDuration,
    $mediaUrl,
    'voice.' . $ext,
    $voiceDuration,
    $voiceWaveform,
    $replyTo,
]);

$messageId = (int) $pdo->lastInsertId();

/* ── Update chat's last message info ─────────────────────────── */
$stmt = $pdo->prepare("
    UPDATE chats SET updated_at = NOW(), last_message_body = ?, last_message_at = NOW()
    WHERE id = ?
");
$stmt->execute(['🎤 Голосовое сообщение', $chatId]);

/* ── Dispatch push / SSE events (optional integration) ────────── */
// send_push($recipientId, $myId, '🎤 Голосовое сообщение', $chatId, $messageId);

json_ok([
    'ok'             => true,
    'message_id'     => $messageId,
    'chat_id'        => $chatId,
    'media_url'      => $mediaUrl,
    'voice_duration' => $voiceDuration,
    'voice_waveform' => $voiceWaveform,
]);

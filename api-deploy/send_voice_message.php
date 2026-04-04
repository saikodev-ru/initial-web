<?php
// ═══════════════════════════════════════════════════════════════
//  SEND VOICE MESSAGE
//  POST /api/send_voice_message.php
//  Header: Authorization: Bearer <token>
//  Body:   multipart/form-data
//          voice          — audio file (webm/opus)
//          to_signal_id   — recipient signal ID
//          reply_to       — (optional) message ID to reply to
//          voice_duration — (optional) duration in seconds
//          voice_waveform — (optional) JSON array of 0-1 values
//
//  Flow: текстовые данные на сервере (MySQL), медиа в S3
//        Audio compression via ffmpeg if available
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

/* ── Debug log setup ─────────────────────────────────────────── */
$vLog = __DIR__ . '/voice_upload.log';
$vTs  = '[' . date('Y-m-d H:i:s') . '] ';

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

/* ── Null-safety: ensure tmpPath is valid ────────────────────── */
if (empty($tmpPath) || !file_exists($tmpPath)) {
    @file_put_contents($vLog, $vTs . "FAIL tmpPath is empty or file not found: tmpPath=" . var_export($tmpPath, true) . "\n", FILE_APPEND);
    json_err('no_file', 'Файл голосового не найден на сервере');
}

/* ── Detect audio format ─────────────────────────────────────── */
$audioInfo = detect_audio_mime_ext($tmpPath);
$ext  = $audioInfo['ext'];
$mime = $audioInfo['mime'];

/* ── Get duration if not provided ────────────────────────────── */
if ($voiceDuration <= 0) {
    $voiceDuration = get_audio_duration($tmpPath, $size);
}

/* ── Compress audio with ffmpeg if available ─────────────────── */
$compressedTmp = null;
$ffmpegPath = null;

if (function_exists('exec')) {
    $ffmpegPath = @exec('which ffmpeg 2>/dev/null');
    if (!empty($ffmpegPath) && is_executable($ffmpegPath)) {
        $compressedTmp = tempnam(sys_get_temp_dir(), 'vcmp_');
        if ($compressedTmp !== false) {
            // Compress to opus 32kbps mono (great quality/size ratio for voice)
            // -c:a libopus — opus codec
            // -b:a 32k — 32 kbps bitrate (small size, good voice quality)
            // -ar 24000 — 24kHz sample rate (sufficient for voice, opus-native)
            // -ac 1 — mono
            // -vbr on — variable bitrate for better quality at same bitrate
            $cmd = escapeshellcmd($ffmpegPath)
                 . ' -y -i ' . escapeshellarg($tmpPath)
                 . ' -c:a libopus -b:a 32k -ar 24000 -ac 1 -vbr on'
                 . ' ' . escapeshellarg($compressedTmp)
                 . ' 2>/dev/null';

            @exec($cmd, $output, $returnCode);

            if ($returnCode === 0 && file_exists($compressedTmp) && filesize($compressedTmp) > 0) {
                $compressedSize = (int) filesize($compressedTmp);
                // Only use compressed version if it's actually smaller
                if ($compressedSize < $size) {
                    @file_put_contents($vLog, $vTs . "COMPRESSED: {$size} -> {$compressedSize} bytes (saved "
                        . round((1 - $compressedSize / $size) * 100, 1) . "%)\n", FILE_APPEND);
                    // Use compressed file
                    @unlink($tmpPath);
                    $tmpPath = $compressedTmp;
                    $size = $compressedSize;
                    $ext = 'ogg'; // opus in ogg container
                    $mime = 'audio/ogg';

                    // Re-detect duration from compressed file
                    $voiceDuration = get_audio_duration($tmpPath, $size);
                } else {
                    @file_put_contents($vLog, $vTs . "SKIP compress: compressed {$compressedSize} >= original {$size}\n", FILE_APPEND);
                    @unlink($compressedTmp);
                    $compressedTmp = null;
                }
            } else {
                @file_put_contents($vLog, $vTs . "FAIL ffmpeg compress: return={$returnCode}\n", FILE_APPEND);
                @unlink($compressedTmp);
                $compressedTmp = null;
            }
        }
    }
}

/* ── Upload to S3 (медиа в S3) ──────────────────────────────── */
$s3Path = make_voice_s3_path($myId, $ext);
@file_put_contents($vLog, $vTs . "S3 uploading: tmpPath=" . $tmpPath . " exists=" . (file_exists($tmpPath) ? 'yes' : 'no')
    . " size=" . filesize($tmpPath) . " key=" . $s3Path['key'] . " mime=" . $s3Path['mime'] . "\n", FILE_APPEND);

if (empty($s3Path['key']) || empty($s3Path['mime'])) {
    @file_put_contents($vLog, $vTs . "FAIL s3Path key/mime is null\n", FILE_APPEND);
    json_err('upload_error', 'Ошибка формирования пути к файлу', 500);
}

$s3Key = s3_upload($tmpPath, $s3Path['key'], $s3Path['mime']);
if (!$s3Key) {
    @file_put_contents($vLog, $vTs . "FAIL s3_upload returned null\n", FILE_APPEND);
    json_err('upload_error', 'Не удалось загрузить голосовое сообщение', 500);
}
@file_put_contents($vLog, $vTs . "S3 OK key=" . $s3Key . "\n", FILE_APPEND);

// В БД храним относительный s3Key для унификации со всеми остальными медиа
$mediaUrl = ltrim($s3Key, '/');

// Clean up temp file
if (file_exists($tmpPath)) @unlink($tmpPath);

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

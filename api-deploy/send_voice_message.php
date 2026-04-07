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
$vLog = (__DIR__ ?: dirname(__FILE__)) . '/voice_upload.log';
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
    @file_put_contents($vLog ?? __DIR__ . '/voice_upload.log', $vTs . "FAIL tmpPath is empty or file not found: tmpPath=" . var_export($tmpPath, true) . "\n", FILE_APPEND);
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

/* ══════════════════════════════════════════════════════════════
   SERVER-SIDE AUDIO COMPRESSION (FFmpeg)
   
   Pipeline:
   1. Convert to opus/ogg at 24kbps (speech-optimized)
   2. Highpass 200Hz — removes rumble, HVAC, wind noise
   3. Lowpass 3400Hz — removes hiss, focuses on speech band
   4. Loudness normalize -20 LUFS — consistent volume
   5. Mono 16kHz — optimal for voice messages
   
   Note: afftdn noise reduction removed — it degrades voice quality
   ══════════════════════════════════════════════════════════════ */
$originalSize = $size;
$compressed = false;

if (function_exists('exec')) {
    $ffprobe = @exec('which ffprobe 2>/dev/null');
    $ffmpeg  = @exec('which ffmpeg 2>/dev/null');

    if (!empty($ffmpeg) && !empty($ffprobe) && $size > 8000) {
        $outPath = $tmpPath . '.ogg';
        $outSize = 0;

        // Get original duration for logging
        $origDur = 0;
        $probeCmd = escapeshellcmd($ffprobe)
            . ' -v quiet -print_format json -show_format '
            . escapeshellarg($tmpPath) . ' 2>/dev/null';
        $probeJson = @json_decode(@shell_exec($probeCmd) ?: '', true);
        if (isset($probeJson['format']['duration'])) {
            $origDur = (float) $probeJson['format']['duration'];
        }

        // Build filter chain — NO afftdn (degrades voice quality)
        $filters = [];
        $filters[] = 'highpass=f=200';           // Remove low-frequency rumble
        $filters[] = 'lowpass=f=3400';            // Remove high-frequency hiss

        $filterChain = implode(',', $filters);

        // FFmpeg command:
        // -i input
        // -af filter_chain
        // -af loudnorm (separate for proper EBU R128 loudness normalization)
        // -c:a libopus (opus codec)
        // -b:a 24k (24kbps — excellent speech quality, very compact)
        // -ar 16000 (16kHz sample rate — speech optimized)
        // -ac 1 (mono)
        // -application voip (opus VOIP mode — optimized for speech)
        $cmd = escapeshellcmd($ffmpeg)
            . ' -y -i ' . escapeshellarg($tmpPath)
            . ' -af "' . $filterChain . ',loudnorm=I=-20:TP=-1.5:LRA=11:print_format=json" -ar 16000 -ac 1'
            . ' -c:a libopus -b:a 24k -application voip'
            . ' ' . escapeshellarg($outPath)
            . ' 2>/dev/null';

        @exec($cmd, $output, $returnCode);

        if ($returnCode === 0 && file_exists($outPath) && filesize($outPath) > 0) {
            $outSize = (int) filesize($outPath);

            // Use compressed version if it's meaningfully smaller
            if ($outSize > 0 && $outSize < $originalSize * 0.95) {
                // Replace original with compressed
                @unlink($tmpPath);
                @rename($outPath, $tmpPath);

                // Update format detection
                $ext  = 'ogg';
                $mime = 'audio/ogg';
                $size = $outSize;
                $compressed = true;

                // Re-detect duration from compressed file (more accurate)
                $compDurCmd = escapeshellcmd($ffprobe)
                    . ' -v quiet -print_format json -show_format '
                    . escapeshellarg($tmpPath) . ' 2>/dev/null';
                $compDurJson = @json_decode(@shell_exec($compDurCmd) ?: '', true);
                if (isset($compDurJson['format']['duration'])) {
                    $voiceDuration = (int) ceil((float) $compDurJson['format']['duration']);
                }
            } else {
                // Compression didn't help — keep original
                @unlink($outPath);
            }
        } else {
            // FFmpeg failed — keep original
            if (file_exists($outPath)) @unlink($outPath);
        }

        // Log compression results
        $ratio = $compressed && $originalSize > 0
            ? round((1 - $outSize / $originalSize) * 100, 1)
            : 0;
        @file_put_contents(
            $vLog ?? __DIR__ . '/voice_upload.log',
            $vTs
            . "VOICE COMPRESS: "
            . ($compressed ? "OK" : "SKIPPED")
            . " | orig={$originalSize}B"
            . ($compressed ? " comp={$outSize}B saved={$ratio}%" : "")
            . " | dur={$origDur}s"
            . "\n",
            FILE_APPEND
        );
    }
}

/* ── Upload to S3 (медиа в S3) ──────────────────────────────── */
$s3Path = make_voice_s3_path($myId, $ext);
@file_put_contents($vLog ?? __DIR__ . '/voice_upload.log', $vTs . "S3 uploading: tmpPath=" . $tmpPath . " exists=" . (file_exists($tmpPath) ? 'yes' : 'no')
    . " size=" . filesize($tmpPath) . " key=" . $s3Path['key'] . " mime=" . $s3Path['mime'] . "\n", FILE_APPEND);

if (empty($s3Path['key']) || empty($s3Path['mime'])) {
    @file_put_contents($vLog ?? __DIR__ . '/voice_upload.log', $vTs . "FAIL s3Path key/mime is null\n", FILE_APPEND);
    json_err('upload_error', 'Ошибка формирования пути к файлу', 500);
}

$s3Key = s3_upload($tmpPath, $s3Path['key'], $s3Path['mime']);
if (!$s3Key) {
    @file_put_contents($vLog ?? __DIR__ . '/voice_upload.log', $vTs . "FAIL s3_upload returned null\n", FILE_APPEND);
    json_err('upload_error', 'Не удалось загрузить голосовое сообщение', 500);
}
@file_put_contents($vLog ?? __DIR__ . '/voice_upload.log', $vTs . "S3 OK key=" . $s3Key . "\n", FILE_APPEND);

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
$senderName = $me['nickname'] ?? $me['email'];
$voicePushData = [
    'chat_id'          => (string) $chatId,
    'sender_signal_id' => $me['signal_id'] ?? '',
    'sender_avatar'    => $me['avatar_url'] ?? '',
    'media_type'       => 'voice',
    'voice_duration'   => (string) $voiceDuration,
    'sender_name'      => $senderName,
];

// FCM push (sole push channel)
if (!empty($recipient['fcm_token'])) {
    send_push(
        $recipient['fcm_token'],
        $senderName,
        '🎤 Голосовое сообщение',
        $voicePushData
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

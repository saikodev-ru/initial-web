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
//  Response: { "ok": true, "message_id": int, "chat_id": int }
// ═══════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/../upload/helpers.php';
require_once __DIR__ . '/../upload/s3_helper.php';

set_cors_headers();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_err('method_not_allowed', 'Только POST', 405);

$me = auth_user();
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
    json_err('invalid_recipient', 'Нельзя отправить голосовое сообщение @signal');
}

$replyTo = !empty($_POST['reply_to']) ? (int) $_POST['reply_to'] : null;
$voiceDuration = !empty($_POST['voice_duration']) ? (int) $_POST['voice_duration'] : 0;
$voiceWaveform = $_POST['voice_waveform'] ?? '[]';

// Validate waveform JSON
$decoded = json_decode($voiceWaveform, true);
if (!is_array($decoded)) {
    $voiceWaveform = '[]';
}

/* ── Validate voice file ─────────────────────────────────────── */
if (empty($_FILES['voice']) || $_FILES['voice']['error'] !== UPLOAD_ERR_OK) {
    $code = $_FILES['voice']['error'] ?? -1;
    json_err('no_file', "Голосовое сообщение не получено (upload error: {$code})");
}

$voiceFile = $_FILES['voice'];
$tmpPath   = $voiceFile['tmp_name'];
$size      = (int) $voiceFile['size'];

// Max 25 MB for voice
if ($size > 25 * 1024 * 1024) {
    json_err('file_too_large', 'Максимальный размер голосового — 25 МБ');
}

if ($size < 1) {
    json_err('empty_file', 'Пустой файл');
}

// Validate MIME type
$mime = '';
if (function_exists('mime_content_type')) {
    $mime = mime_content_type($tmpPath) ?: '';
}
if (empty($mime)) {
    $finfo = finfo_open(FILEINFO_MIME_TYPE);
    $mime = finfo_file($finfo, $tmpPath) ?: '';
    finfo_close($finfo);
}

$allowedVoiceMimes = [
    'audio/webm',
    'audio/ogg',
    'audio/mp4',
    'audio/mpeg',
    'audio/wav',
    'audio/x-m4a',
    'audio/aac',
    'audio/opus',
];

$ext = 'webm';
if (str_contains($mime, 'ogg')) {
    $ext = 'ogg';
} elseif (str_contains($mime, 'mp4') || str_contains($mime, 'm4a') || str_contains($mime, 'aac')) {
    $ext = 'm4a';
} elseif (str_contains($mime, 'mpeg') || str_contains($mime, 'mp3')) {
    $ext = 'mp3';
} elseif (str_contains($mime, 'wav')) {
    $ext = 'wav';
} elseif (str_contains($mime, 'webm')) {
    $ext = 'webm';
}

// If MIME not in allowed list but file has content, still allow (some browsers send weird MIME)
if (!in_array($mime, $allowedVoiceMimes, true) && $size < 100) {
    json_err('invalid_type', 'Неподдерживаемый формат голосового сообщения');
}

/* ── Get or determine duration if not provided ────────────────── */
if ($voiceDuration <= 0 && function_exists('exec')) {
    // Try ffprobe to get real duration
    $ffprobe = @exec('which ffprobe 2>/dev/null');
    if ($ffprobe) {
        $cmd = escapeshellcmd($ffprobe) . ' -v quiet -print_format json -show_format ' . escapeshellarg($tmpPath) . ' 2>/dev/null';
        $json = @json_decode(shell_exec($cmd) ?: '', true);
        if (isset($json['format']['duration'])) {
            $voiceDuration = (int) ceil((float) $json['format']['duration']);
        }
    }
}

// Fallback: use a reasonable default
if ($voiceDuration <= 0) {
    // Rough estimate: assume 32kbps opus
    $voiceDuration = max(1, (int) ceil($size / 4000));
}

/* ── Upload to S3 ────────────────────────────────────────────── */
$uid    = $myId;
$uid16  = bin2hex(random_bytes(8));
$s3Key  = "media/voice/{$uid}/{$uid16}.{$ext}";
$s3Mime = $mime ?: 'audio/webm';

$url = s3_upload($tmpPath, $s3Key, $s3Mime);
if (!$url) {
    json_err('upload_error', 'Не удалось загрузить голосовое сообщение', 500);
}

/* ── Get recipient user ──────────────────────────────────────── */
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
    // Create new chat
    $stmt = $pdo->prepare("
        INSERT INTO chats (user1_id, user2_id, created_at, updated_at)
        VALUES (?, ?, NOW(), NOW())
    ");
    $stmt->execute([$myId, $recipientId]);
    $chatId = (int) $pdo->lastInsertId();
}

/* ── Insert message ──────────────────────────────────────────── */
$stmt = $pdo->prepare("
    INSERT INTO messages (chat_id, sender_id, body, media_type, media_url, media_file_name,
                          voice_duration, voice_waveform, reply_to, sent_at, is_read)
    VALUES (?, ?, ?, 'voice', ?, ?, ?, ?, ?, NOW(), 0)
");
$stmt->execute([
    $chatId,
    $myId,
    (string) $voiceDuration,            // body = duration in seconds (for display)
    $url,                                 // media_url
    'voice.' . $ext,                     // media_file_name
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
// If you have a push notification function, call it here:
// send_push($recipientId, $myId, '🎤 Голосовое сообщение', $chatId, $messageId);

json_ok([
    'ok'             => true,
    'message_id'     => $messageId,
    'chat_id'        => $chatId,
    'media_url'      => $url,
    'voice_duration' => $voiceDuration,
    'voice_waveform' => $voiceWaveform,
]);

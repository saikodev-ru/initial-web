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

/* ── AES-256-GCM DECRYPTION ──────────────────────────────────── */
$encKey = trim($_POST['enc_key'] ?? '');
$encIv  = trim($_POST['enc_iv'] ?? '');

if (!empty($encKey) && !empty($encIv)) {
    // Client sent encryption metadata — decrypt
    $keyBin = @hex2bin($encKey);
    $ivBin  = @hex2bin($encIv);

    if (strlen($keyBin) !== 32) {
        json_err('invalid_key', 'Неверная длина ключа шифрования');
    }
    if (strlen($ivBin) !== 12) {
        json_err('invalid_iv', 'Неверная длина вектора инициализации');
    }

    $cipherText = file_get_contents($tmpPath);
    if ($cipherText === false) {
        json_err('read_error', 'Не удалось прочитать загруженный файл');
    }

    // AES-256-GCM: tag is appended to ciphertext (OpenSSL default)
    $plainText = @openssl_decrypt($cipherText, 'aes-256-gcm', $keyBin, OPENSSL_RAW_DATA, $ivBin);

    if ($plainText === false) {
        json_err('decrypt_error', 'Ошибка расшифровки голосового сообщения', 500);
    }

    // Write decrypted data back to temp file for processing
    $decPath = $tmpPath . '.dec';
    if (file_put_contents($decPath, $plainText) === false) {
        json_err('write_error', 'Ошибка записи расшифрованного файла', 500);
    }

    // Replace temp path with decrypted version
    $tmpPath = $decPath;
    $size = strlen($plainText);
    unset($plainText, $cipherText);
}

/* ── Determine MIME type ─────────────────────────────────────── */
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
    'application/octet-stream',  // encrypted file may have this before decryption
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

// If decrypted successfully, force webm extension
if (!empty($encKey)) {
    $ext = 'webm';
    $mime = 'audio/webm';
}

/* ── Get or determine duration if not provided ────────────────── */
if ($voiceDuration <= 0 && function_exists('exec')) {
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

// Clean up decrypted temp file if it exists
if (!empty($encKey) && file_exists($tmpPath)) {
    @unlink($tmpPath);
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
    (string) $voiceDuration,
    $url,
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
    'media_url'      => $url,
    'voice_duration' => $voiceDuration,
    'voice_waveform' => $voiceWaveform,
]);

<?php
// ═══════════════════════════════════════════════════════════════
//  TRANSCRIBE VOICE (Speech-to-Text)
//  POST /api/transcribe_voice
//  Header: Authorization: Bearer <token>
//  Body:   { "audio_url": "media/voice/..." }
//
//  Flow:
//    1. Авторизация пользователя
//    2. Валидация audio_url (проверка владения сообщением)
//    3. Скачивание аудио из S3
//    4. Отправка в OpenAI Whisper API
//    5. Возврат текста расшифровки
//
//  Config (config.php):
//    define('OPENAI_API_KEY', 'sk-...');
//
//  Response: { "ok": true, "text": "расшифрованный текст" }
// ═══════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/s3_helper.php';

set_cors_headers();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_err('method_not_allowed', 'Только POST', 405);

$me   = auth_user();
$myId = (int) $me['id'];

/* ── Проверяем наличие API-ключа ────────────────────────────── */
if (!defined('OPENAI_API_KEY') || empty(OPENAI_API_KEY)) {
    error_log('STT: OPENAI_API_KEY не задан в config.php');
    json_err('config_error', 'STT не настроен на сервере', 503);
}

/* ── Парсим входящий JSON ──────────────────────────────────── */
$input   = input();
$audioUrl = trim($input['audio_url'] ?? '');

if (empty($audioUrl)) {
    json_err('missing_param', 'Не указан audio_url');
}

// Санитизация: извлекаем S3-путь из возможных форматов URL
// Формат может быть:
//   1) Прямой S3-путь: media/voice/123/abc.ogg
//   2) get_media прокси: https://initial.su/api/get_media?key=media/voice/123/abc.ogg&token=...
//   3) Публичный S3 URL: https://signal.storage.website.regru.cloud/media/voice/123/abc.ogg
if (str_starts_with($audioUrl, 'http://') || str_starts_with($audioUrl, 'https://')) {
    $parsed = parse_url($audioUrl);
    // get_media прокси — извлекаем key из query-параметра
    if (isset($parsed['query']) && str_contains($parsed['query'], 'key=')) {
        parse_str($parsed['query'], $params);
        if (!empty($params['key'])) {
            $audioUrl = $params['key'];
        } else {
            $audioUrl = ltrim($parsed['path'] ?? '', '/');
        }
    } else {
        // Прямой публичный URL — берём путь после домена
        $audioUrl = ltrim($parsed['path'] ?? '', '/');
    }
}

/* ── Проверяем, что это голосовое сообщение текущего чата ──── */
// Ищем сообщение с таким media_url, где текущий пользователь — участник чата
$stmt = db()->prepare(
    'SELECT m.id, m.media_url
     FROM messages m
     JOIN chats c ON c.id = m.chat_id
     WHERE m.media_url = ?
       AND (c.user_a = ? OR c.user_b = ?)
       AND m.media_type = "voice"
     LIMIT 1'
);
$stmt->execute([$audioUrl, $myId, $myId]);
$msg = $stmt->fetch();

if (!$msg) {
    json_err('not_found', 'Голосовое сообщение не найдено или нет доступа');
}

/* ── Кеширование: проверяем, уже расшифровывали ─────────────── */
$stmt = db()->prepare(
    'SELECT transcription FROM voice_transcriptions WHERE message_id = ? LIMIT 1'
);
$stmt->execute([(int) $msg['id']]);
$cached = $stmt->fetch();

if ($cached && !empty($cached['transcription'])) {
    json_ok(['text' => $cached['transcription']]);
}

/* ── Скачиваем аудио из S3 ──────────────────────────────────── */
$s3Key  = ltrim($msg['media_url'], '/');
$audio  = s3_get($s3Key);

if ($audio === null || strlen($audio) < 100) {
    error_log("STT: не удалось скачать аудио из S3 key={$s3Key}");
    json_err('download_error', 'Не удалось скачать аудио', 500);
}

/* ── Сохраняем во временный файл ────────────────────────────── */
$tmpDir  = sys_get_temp_dir();
$tmpFile = tempnam($tmpDir, 'stt_');
$ext     = 'ogg';

// Определяем расширение по S3-пути
if (preg_match('/\.(webm|ogg|mp3|wav|m4a|opus)$/i', $s3Key, $m)) {
    $ext = strtolower($m[1]);
}
$tmpFileWithExt = $tmpFile . '.' . $ext;

file_put_contents($tmpFileWithExt, $audio);
@unlink($tmpFile); // удаляем без расширения

if (!file_exists($tmpFileWithExt) || filesize($tmpFileWithExt) < 100) {
    json_err('file_error', 'Ошибка сохранения аудио', 500);
}

/* ══════════════════════════════════════════════════════════════
   OPENAI WHISPER API

   Отправляем аудио-файл на транскрибацию.
   Whisper автоматически определяет язык,
   но мы явно указываем ru для лучшей точности.

   Формат ответа:
   { "text": "расшифрованный текст" }
   ══════════════════════════════════════════════════════════════ */
$whisperUrl = 'https://api.openai.com/v1/audio/transcriptions';

$cfile = new CURLFile($tmpFileWithExt, mime_content_type($tmpFileWithExt) ?: 'audio/ogg', 'voice.' . $ext);

$ch = curl_init($whisperUrl);
curl_setopt_array($ch, [
    CURLOPT_POST           => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POSTFIELDS     => [
        'file'           => $cfile,
        'model'          => 'whisper-1',
        'language'       => 'ru',       // Русский язык (автоопределение работает, но ru точнее)
        'response_format' => 'json',
        'temperature'    => '0.0',      // Минимальная креативность — точная транскрипция
    ],
    CURLOPT_HTTPHEADER     => [
        'Authorization: Bearer ' . OPENAI_API_KEY,
    ],
    CURLOPT_TIMEOUT        => 30,        // Whisper может работать до 25 сек на длинных файлах
    CURLOPT_CONNECTTIMEOUT => 10,
]);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlErr  = curl_error($ch);
curl_close($ch);

// Удаляем временный файл
@unlink($tmpFileWithExt);

if (!empty($curlErr)) {
    error_log("STT: cURL error: {$curlErr}");
    json_err('api_error', 'Ошибка подключения к сервису транскрипции', 502);
}

if ($httpCode !== 200) {
    error_log("STT: OpenAI HTTP {$httpCode}: " . substr((string)$response, 0, 500));
    json_err('api_error', 'Сервис транскрипции вернул ошибку', 502);
}

$data = json_decode($response, true);

if (!$data || empty($data['text'])) {
    error_log("STT: пустой ответ от Whisper: " . substr((string)$response, 0, 300));
    json_err('api_error', 'Не удалось расшифровать аудио', 502);
}

$transcription = trim($data['text']);

if (empty($transcription)) {
    json_err('no_speech', 'Речь не обнаружена', 200);
}

/* ── Кешируем результат в БД ────────────────────────────────── */
// Создаём таблицу если не существует (idempotent)
@db()->exec("
    CREATE TABLE IF NOT EXISTS voice_transcriptions (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        message_id      INT NOT NULL,
        transcription   TEXT NOT NULL,
        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_message (message_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
");

try {
    db()->prepare(
        'INSERT INTO voice_transcriptions (message_id, transcription) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE transcription = VALUES(transcription)'
    )->execute([(int) $msg['id'], $transcription]);
} catch (\Throwable $e) {
    // Кеш — это оптимизация, не блокируем ответ если упала
    error_log("STT: cache write failed: " . $e->getMessage());
}

json_ok(['text' => $transcription]);

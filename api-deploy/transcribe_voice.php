<?php
// ═══════════════════════════════════════════════════════════════
//  TRANSCRIBE VOICE (Speech-to-Text) — Vosk (offline, free)
//  POST /api/transcribe_voice
//  Header: Authorization: Bearer <token>
//  Body:   { "audio_url": "media/voice/..." }
//
//  Flow:
//    1. Авторизация пользователя
//    2. Валидация audio_url (проверка владения сообщением)
//    3. Проверка кеша в БД
//    4. Скачивание аудио из S3
//    5. Конвертация + транскрибация через stt_vosk.py (Vosk)
//    6. Кеширование результата
//    7. Возврат текста расшифровки
//
//  Setup (один раз на сервере):
//    cd api-deploy/
//    wget https://alphacephei.com/vosk/models/vosk-model-ru-small-0.22.zip
//    unzip vosk-model-ru-small-0.22.zip
//    pip3 install vosk
//    # ffmpeg уже должен быть установлен
//
//  Config (config.php):
//    define('VOSK_MODEL_PATH', __DIR__ . '/vosk-model-ru-small');  // опционально
//    define('PYTHON3_BIN', '/usr/bin/python3');                     // опционально
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

/* ── Конфигурация ───────────────────────────────────────────── */
$voskScript = __DIR__ . '/stt_vosk.py';
$modelPath  = defined('VOSK_MODEL_PATH') ? VOSK_MODEL_PATH : __DIR__ . '/vosk-model-ru-small';
$pythonBin  = defined('PYTHON3_BIN')     ? PYTHON3_BIN     : 'python3';

// Проверяем, что Python-скрипт существует
if (!file_exists($voskScript)) {
    error_log('STT: stt_vosk.py не найден по пути ' . $voskScript);
    json_err('config_error', 'STT не настроен — скрипт не найден', 503);
}

// Проверяем, что модель существует
if (!is_dir($modelPath)) {
    error_log('STT: Vosk модель не найдена по пути ' . $modelPath);
    json_err('config_error', 'STT не настроен — модель не найдена', 503);
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
   VOSK TRANSCRIPTION (через stt_vosk.py)

   Python-скрипт:
   1. Конвертирует аудио в WAV mono 16kHz через ffmpeg
   2. Транскрибирует через Vosk (vosk-model-ru-small)
   3. Возвращает JSON в stdout
   ══════════════════════════════════════════════════════════════ */
$cmd = escapeshellcmd($pythonBin)
     . ' ' . escapeshellarg($voskScript)
     . ' ' . escapeshellarg($tmpFileWithExt)
     . ' ' . escapeshellarg($modelPath);

$descriptors = [
    0 => ['pipe', 'r'],  // stdin
    1 => ['pipe', 'w'],  // stdout
    2 => ['pipe', 'w'],  // stderr
];

$proc = proc_open($cmd, $descriptors, $pipes);
if (!is_resource($proc)) {
    @unlink($tmpFileWithExt);
    error_log("STT: не удалось запустить Python: {$cmd}");
    json_err('api_error', 'Ошибка запуска сервиса транскрипции', 502);
}

// Закрываем stdin
fclose($pipes[0]);

// Читаем stdout и stderr
$stdout = stream_get_contents($pipes[1]);
$stderr = stream_get_contents($pipes[2]);
fclose($pipes[1]);
fclose($pipes[2]);

$returnCode = proc_close($proc);

// Удаляем временный файл
@unlink($tmpFileWithExt);
// Удаляем промежуточный WAV (если Python не успел)
$wavTmp = $tmpFileWithExt . '.stt.wav';
if (file_exists($wavTmp)) @unlink($wavTmp);

if ($returnCode !== 0) {
    error_log("STT: Python exit code {$returnCode}: " . trim($stderr ?: $stdout));
    json_err('api_error', 'Ошибка транскрипции', 502);
}

$data = json_decode($stdout, true);

if (!$data) {
    error_log("STT: невалидный JSON от Python: " . substr((string)$stdout, 0, 300));
    json_err('api_error', 'Ошибка транскрипции', 502);
}

if (empty($data['text'])) {
    // "no_speech" — не ошибка, просто пустое аудио
    if (!empty($data['error']) && $data['error'] !== 'no_speech') {
        error_log("STT: Vosk error: " . ($data['error'] ?? ''));
        json_err('api_error', 'Ошибка транскрипции', 502);
    }
    json_err('no_speech', 'Речь не обнаружена', 200);
}

$transcription = trim($data['text']);

if (empty($transcription)) {
    json_err('no_speech', 'Речь не обнаружена', 200);
}

/* ── Кешируем результат в БД ────────────────────────────────── */
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
    error_log("STT: cache write failed: " . $e->getMessage());
}

json_ok(['text' => $transcription]);

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
//    3. Скачивание аудио из S3
//    4. Конвертация + транскрибация через stt_vosk.py (Vosk)
//    5. Возврат текста расшифровки
//
//  Кеширование: на стороне клиента (localStorage)
//
//  Setup (один раз на сервере):
//    cd api-deploy/
//    wget https://alphacephei.com/vosk/models/vosk-model-ru-small-0.22.zip
//    unzip vosk-model-ru-small-0.22.zip
//    pip3 install vosk
//
//    # Статический ffmpeg (без root):
//    wget https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz
//    tar xf ffmpeg-release-amd64-static.tar.xz
//    cp ffmpeg-*-static/ffmpeg . && chmod +x ffmpeg
//    rm -rf ffmpeg-*-static ffmpeg-release-amd64-static.tar.xz
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

// Validate python binary exists
if (!file_exists($pythonBin) && !is_executable($pythonBin)) {
    // Fallback: try 'which' to find python
    $which = @exec('which python3 2>/dev/null || which python 2>/dev/null');
    if ($which) $pythonBin = trim($which);
}

if (!file_exists($pythonBin)) {
    error_log('STT: Python не найден: ' . $pythonBin);
    json_err('config_error', 'STT не настроен — Python не найден', 503);
}

if (!file_exists($voskScript)) {
    error_log('STT: stt_vosk.py не найден по пути ' . $voskScript);
    json_err('config_error', 'STT не настроен — скрипт не найден', 503);
}

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
if (str_starts_with($audioUrl, 'http://') || str_starts_with($audioUrl, 'https://')) {
    $parsed = parse_url($audioUrl);
    if (isset($parsed['query']) && str_contains($parsed['query'], 'key=')) {
        parse_str($parsed['query'], $params);
        if (!empty($params['key'])) {
            $audioUrl = $params['key'];
        } else {
            $audioUrl = ltrim($parsed['path'] ?? '', '/');
        }
    } else {
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

if (preg_match('/\.(webm|ogg|mp3|wav|m4a|opus)$/i', $s3Key, $m)) {
    $ext = strtolower($m[1]);
}
$tmpFileWithExt = $tmpFile . '.' . $ext;

file_put_contents($tmpFileWithExt, $audio);
@unlink($tmpFile);

if (!file_exists($tmpFileWithExt) || filesize($tmpFileWithExt) < 100) {
    json_err('file_error', 'Ошибка сохранения аудио', 500);
}

/* ══════════════════════════════════════════════════════════════
   VOSK TRANSCRIPTION (через stt_vosk.py)
   ══════════════════════════════════════════════════════════════ */
$cmd = escapeshellcmd($pythonBin)
     . ' ' . escapeshellarg($voskScript)
     . ' ' . escapeshellarg($tmpFileWithExt)
     . ' ' . escapeshellarg($modelPath);

$descriptors = [
    0 => ['pipe', 'r'],
    1 => ['pipe', 'w'],
    2 => ['pipe', 'w'],
];

$proc = proc_open($cmd, $descriptors, $pipes);
if (!is_resource($proc)) {
    @unlink($tmpFileWithExt);
    error_log("STT: не удалось запустить Python: {$cmd}");
    json_err('api_error', 'Ошибка запуска сервиса транскрипции', 502);
}

fclose($pipes[0]);
$stdout = stream_get_contents($pipes[1]);
$stderr = stream_get_contents($pipes[2]);
fclose($pipes[1]);
fclose($pipes[2]);

$returnCode = proc_close($proc);

@unlink($tmpFileWithExt);
$wavTmp = $tmpFileWithExt . '.stt.wav';
if (file_exists($wavTmp)) @unlink($wavTmp);

if ($returnCode !== 0) {
    $detail = trim($stderr ?: $stdout);
    error_log("STT: Python exit code {$returnCode}: " . $detail);
    // Return actual error detail to client for debugging
    json_err('api_error', "Ошибка транскрипции: " . mb_substr($detail, 0, 200, 'UTF-8'), 502);
}

$data = json_decode($stdout, true);

if (!$data) {
    error_log("STT: невалидный JSON от Python: " . substr((string)$stdout, 0, 300));
    json_err('api_error', 'Ошибка транскрипции', 502);
}

if (empty($data['text'])) {
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

json_ok(['text' => $transcription]);

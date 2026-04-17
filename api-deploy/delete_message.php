<?php
// ═══════════════════════════════════════════════════════════════
//  DELETE MESSAGE — физическое удаление строки из БД
//  POST /api/delete_message.php
//  Header: Authorization: Bearer <token>
//  Body:   { "message_id": 123 }
//  Response: { "ok": true, "deleted_id": 123 }
// ═══════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/s3_helper.php';

set_cors_headers();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_err('method_not_allowed', 'Только POST', 405);

$me   = auth_user();
require_rate_limit('delete_message', 30, 60);
$data = input();

$messageId = (int) ($data['message_id'] ?? 0);
if ($messageId <= 0) json_err('invalid_id', 'Некорректный message_id');

// ── Проверить что сообщение существует и пользователь — участник чата ──
$stmt = db()->prepare(
    'SELECT m.id, m.sender_id, m.media_url, m.media_type
     FROM messages m
     JOIN chats c ON c.id = m.chat_id
     WHERE m.id = ?
       AND (c.user_a = ? OR c.user_b = ?)
     LIMIT 1'
);
$stmt->execute([$messageId, $me['id'], $me['id']]);
$msg = $stmt->fetch();

if (!$msg) json_err('not_found', 'Сообщение не найдено или нет доступа', 404);

// ── Удалить медиафайл из S3 (если есть) ──────────────────────
// media_url хранится в виде прокси-ссылки:
//   https://signal.saikodev.ru/api/get_media.php?key=media/images/5/abc123.jpg
// Извлекаем параметр key и удаляем объект из S3.
if (!empty($msg['media_url'])) {
    try {
        $s3Key = null;

        // Вариант 0: Относительный путь (media/...)
        if (str_starts_with($msg['media_url'], 'media/')) {
            $s3Key = $msg['media_url'];
        }

        // Вариант 1: прокси-ссылка через get_media.php?key=...
        if (!$s3Key) {
            $parsed = parse_url($msg['media_url']);
            if (!empty($parsed['query'])) {
                parse_str($parsed['query'], $qp);
                if (!empty($qp['key'])) {
                    $s3Key = $qp['key'];
                }
            }
        }

        // Вариант 2: прямая ссылка на S3_PUBLIC_URL 
        if (!$s3Key && defined('S3_PUBLIC_URL')) {
            $pubBase = rtrim(S3_PUBLIC_URL, '/') . '/';
            if (str_starts_with($msg['media_url'], $pubBase)) {
                $s3Key = substr($msg['media_url'], strlen($pubBase));
            }
        }

        if ($s3Key) {
            $deleted = s3_delete($s3Key);
            if (!$deleted) {
                error_log("delete_message: не удалось удалить S3 объект key={$s3Key} для message_id={$messageId}");
            }
        }
    } catch (\Throwable $e) {
        // S3-ошибка не должна блокировать удаление сообщения из БД
        error_log("delete_message: исключение при удалении S3 объекта для message_id={$messageId}: " . $e->getMessage());
    }
}

// ── Физически удалить строку из БД ───────────────────────────
db()->prepare('DELETE FROM messages WHERE id = ?')
    ->execute([$messageId]);

json_ok(['deleted_id' => $messageId]);
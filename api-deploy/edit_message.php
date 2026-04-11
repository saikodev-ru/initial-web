<?php
// POST /api/edit_message.php
// Header: Authorization: Bearer <token>
// Body: { "message_id": 42, "body": "новый текст" }
declare(strict_types=1);
require_once __DIR__ . '/helpers.php';

set_cors_headers();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_err('method_not_allowed', 'Только POST', 405);

$me        = auth_user();
$data      = input();
$messageId = (int) ($data['message_id'] ?? 0);
$body      = trim($data['body'] ?? '');

if ($messageId <= 0)          json_err('invalid_id',       'Некорректный message_id');
if (mb_strlen($body) === 0)   json_err('empty_message',    'Сообщение не может быть пустым');
if (mb_strlen($body) > 10000) json_err('message_too_long', 'Максимум 10 000 символов');

// Проверить что сообщение принадлежит текущему пользователю
$stmt = db()->prepare('SELECT id FROM messages WHERE id = ? AND sender_id = ? AND is_deleted = 0 LIMIT 1');
$stmt->execute([$messageId, $me['id']]);
if (!$stmt->fetch()) json_err('forbidden', 'Нельзя редактировать чужое или удалённое сообщение', 403);

db()->prepare('UPDATE messages SET body = ?, is_edited = 1, updated_at = NOW() WHERE id = ?')
    ->execute([$body, $messageId]);

json_ok(['message_id' => $messageId, 'body' => $body]);
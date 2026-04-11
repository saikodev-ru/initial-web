<?php
// POST /api/delete_chat.php
// Header: Authorization: Bearer <token>
// Body: { "chat_id": 5 }
// Удаляет чат и все его сообщения для обоих участников.
// Только участник чата может его удалить.
declare(strict_types=1);
require_once __DIR__ . '/helpers.php';

set_cors_headers();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_err('method_not_allowed', 'Только POST', 405);

$me     = auth_user();
$data   = input();
$chatId = (int) ($data['chat_id'] ?? 0);

if ($chatId <= 0) json_err('invalid_id', 'Некорректный chat_id');

$db = db();

// Убедиться что пользователь является участником чата + не системный
$stmt = $db->prepare(
    'SELECT id, is_protected, is_saved_msgs FROM chats WHERE id = ? AND (user_a = ? OR user_b = ?) LIMIT 1'
);
$stmt->execute([$chatId, $me['id'], $me['id']]);
$chatRow = $stmt->fetch();
if (!$chatRow) json_err('forbidden', 'Нет доступа к этому чату', 403);

// Запрещаем удаление защищённых чатов (Избранное, чат с @initial)
if ((int) $chatRow['is_protected'] || (int) $chatRow['is_saved_msgs']) {
    json_err('forbidden', 'Нельзя удалить системный чат', 403);
}

// Удаляем всё в транзакции
$db->beginTransaction();
try {
    // Реакции на сообщения чата
    $db->prepare(
        'DELETE mr FROM message_reactions mr
         JOIN messages m ON m.id = mr.message_id
         WHERE m.chat_id = ?'
    )->execute([$chatId]);

    // Сообщения
    $db->prepare('DELETE FROM messages WHERE chat_id = ?')->execute([$chatId]);

    // Сам чат
    $db->prepare('DELETE FROM chats WHERE id = ?')->execute([$chatId]);

    $db->commit();
} catch (\Throwable $e) {
    $db->rollBack();
    error_log('delete_chat error: ' . $e->getMessage());
    json_err('server_error', 'Ошибка при удалении чата', 500);
}

json_ok(['chat_id' => $chatId]);

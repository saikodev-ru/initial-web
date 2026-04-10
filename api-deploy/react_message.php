<?php
// POST /api/react_message.php
// Body: { "message_id": 42, "emoji": "👍" }
// DELETE /api/react_message.php (remove reaction)
declare(strict_types=1);
require_once __DIR__ . '/helpers.php';

set_cors_headers();

$me   = auth_user();
require_rate_limit('react_message', 60, 60);
$data = input();

$messageId = (int) ($data['message_id'] ?? 0);
$emoji     = trim($data['emoji'] ?? '');

// Нормализация: убираем variation selector U+FE0F
$emoji = preg_replace('/\x{FE0F}/u', '', $emoji);
$emoji = mb_substr($emoji, 0, 16);

if ($messageId <= 0) json_err('invalid_data', 'Некорректный message_id');
if ($emoji === '')   json_err('invalid_data', 'Эмодзи отсутствует');

$db = db();

// Проверяем доступ к сообщению
$stmt = $db->prepare(
    'SELECT m.id FROM messages m
     JOIN chats c ON c.id = m.chat_id
     WHERE m.id = ? AND (c.user_a = ? OR c.user_b = ?) AND m.is_deleted = 0
     LIMIT 1'
);
$stmt->execute([$messageId, $me['id'], $me['id']]);
if (!$stmt->fetch()) {
    json_err('forbidden', 'Нет доступа к этому сообщению', 403);
}

if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
    // Удаление реакции
    $db->prepare(
        'DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?'
    )->execute([$messageId, $me['id'], $emoji]);
} else {
    // Добавление реакции (INSERT IGNORE для защиты от дублей)
    $db->prepare(
        'INSERT IGNORE INTO message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)'
    )->execute([$messageId, $me['id'], $emoji]);
}

// Возвращаем текущие реакции
$stmt = $db->prepare(
    'SELECT emoji,
            COUNT(*) AS cnt,
            MAX(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS by_me,
            MAX(CASE WHEN user_id = ? THEN UNIX_TIMESTAMP(created_at) ELSE 0 END) AS my_created_at
     FROM message_reactions
     WHERE message_id = ?
     GROUP BY emoji
     ORDER BY cnt DESC, emoji'
);
$stmt->execute([$me['id'], $me['id'], $messageId]);

$reactions = array_map(fn($r) => [
    'emoji'      => $r['emoji'],
    'count'      => (int)  $r['cnt'],
    'by_me'      => (bool) $r['by_me'],
    'created_at' => (int)  $r['my_created_at'],
], $stmt->fetchAll());

json_ok([
    'message_id' => $messageId,
    'reactions'  => $reactions,
]);

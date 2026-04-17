<?php
// POST /api/update_presence.php
// Header: Authorization: Bearer <token>
// Body: { "typing_chat_id": 5 }   (0 = не печатает / выход из чата)
// Response: { "ok": true, "last_seen": 1709476837 }
declare(strict_types=1);
require_once __DIR__ . '/helpers.php';

set_cors_headers();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_err('method_not_allowed', 'Только POST', 405);

$me   = auth_user();
require_rate_limit('update_presence', 120, 60); // 2 в секунду — типинг
$data = input();

$typingChatId = (int) ($data['typing_chat_id'] ?? 0);

// Если typing_chat_id > 0, убеждаемся что пользователь участник этого чата
if ($typingChatId > 0) {
    $stmt = db()->prepare(
        'SELECT id FROM chats WHERE id = ? AND (user_a = ? OR user_b = ?) LIMIT 1'
    );
    $stmt->execute([$typingChatId, $me['id'], $me['id']]);
    if (!$stmt->fetch()) {
        $typingChatId = 0; // Не участник — сбрасываем typing
    }
}

if ($typingChatId > 0) {
    // Пользователь печатает — фиксируем момент печатания через typing_at
    db()->prepare(
        'UPDATE users
         SET last_seen      = UNIX_TIMESTAMP(),
             typing_chat_id = ?,
             typing_at      = NOW()
         WHERE id = ?'
    )->execute([$typingChatId, $me['id']]);
} else {
    // Пользователь остановился / вышел — сбрасываем typing_chat_id.
    // typing_at не трогаем: сервер проверяет его по 5-секундному окну.
    db()->prepare(
        'UPDATE users
         SET last_seen      = UNIX_TIMESTAMP(),
             typing_chat_id = 0
         WHERE id = ?'
    )->execute([$me['id']]);
}

json_ok(['last_seen' => time()]);
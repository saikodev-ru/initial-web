<?php
// POST /api/pin_message.php
// Pin / unpin / update a message within a chat (Telegram-style multi-pin)
// Header: Authorization: Bearer <token>
//
// Body (pin):
//   { chat_id: int, message_id: int, pinned_for_all: 0|1 }
//
// Body (unpin single):
//   { chat_id: int, message_id: int, unpin: true, pinned_for_all: 0|1 }
//
// Body (unpin all):
//   { chat_id: int, unpin_all: true }
declare(strict_types=1);
require_once __DIR__ . '/../helpers.php';

set_cors_headers();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_err('method_not_allowed', 'Только POST', 405);

$me   = auth_user();
$pdo  = db();
$body = input();

$chatId      = (int) ($body['chat_id'] ?? 0);
$messageId   = (int) ($body['message_id'] ?? 0);
$unpin       = !empty($body['unpin']);
$unpinAll    = !empty($body['unpin_all']);
$forAll      = (int) (bool) ($body['pinned_for_all'] ?? 1);

if ($chatId <= 0) json_err('invalid', 'Неверный chat_id', 400);

// Verify chat access
$stmt = $pdo->prepare('SELECT id, user_a, user_b FROM chats WHERE id = ? LIMIT 1');
$stmt->execute([$chatId]);
$chat = $stmt->fetch();
if (!$chat) json_err('not_found', 'Чат не найден', 404);
if ((int) $chat['user_a'] !== $me['id'] && (int) $chat['user_b'] !== $me['id']) {
    json_err('forbidden', 'Нет доступа к этому чату', 403);
}

// Determine other participant
$otherId = ((int) $chat['user_a'] === $me['id']) ? (int) $chat['user_b'] : (int) $chat['user_a'];

// ── Unpin all ──────────────────────────────────────────────
if ($unpinAll) {
    // Delete all pins for both participants in this chat
    $pdo->prepare('DELETE FROM pinned_messages WHERE chat_id = ? AND (user_id = ? OR user_id = ?)')
        ->execute([$chatId, $me['id'], $otherId]);
    json_ok(['unpinned' => true, 'unpinned_all' => true]);
}

// For single-pin/unpin operations, require message_id
if ($messageId <= 0) json_err('invalid', 'Неверный message_id', 400);

// Verify message exists in this chat
$stmt = $pdo->prepare('SELECT id FROM messages WHERE id = ? AND chat_id = ? LIMIT 1');
$stmt->execute([$messageId, $chatId]);
if (!$stmt->fetch()) json_err('not_found', 'Сообщение не найдено', 404);

// ── Unpin single message ───────────────────────────────────
if ($unpin) {
    if ($forAll) {
        // Unpin for both participants
        $pdo->prepare('DELETE FROM pinned_messages WHERE chat_id = ? AND message_id = ? AND (user_id = ? OR user_id = ?)')
            ->execute([$chatId, $messageId, $me['id'], $otherId]);
    } else {
        // Unpin only for current user
        $pdo->prepare('DELETE FROM pinned_messages WHERE chat_id = ? AND message_id = ? AND user_id = ?')
            ->execute([$chatId, $messageId, $me['id']]);
    }
    json_ok(['unpinned' => true]);
}

// ── Pin (multi-pin: INSERT IGNORE — allows multiple messages per chat) ──
// ON DUPLICATE KEY UPDATE handles re-pinning the same message (updates created_at)
$pdo->prepare(
    'INSERT INTO pinned_messages (chat_id, message_id, user_id, pinned_for_all, created_at)
     VALUES (?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE pinned_for_all = VALUES(pinned_for_all), created_at = VALUES(created_at)'
)->execute([$chatId, $messageId, $me['id'], $forAll]);

// If pinning for all, also insert for the other participant
if ($forAll) {
    $pdo->prepare(
        'INSERT INTO pinned_messages (chat_id, message_id, user_id, pinned_for_all, created_at)
         VALUES (?, ?, ?, 1, NOW())
         ON DUPLICATE KEY UPDATE pinned_for_all = 1, created_at = VALUES(created_at)'
    )->execute([$chatId, $messageId, $otherId]);
}

json_ok(['pinned' => true, 'message_id' => $messageId, 'pinned_for_all' => $forAll]);

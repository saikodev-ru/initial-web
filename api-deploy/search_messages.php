<?php
// GET /api/search_messages?chat_id=5&q=текст&limit=200
// Server-side full-text search across all messages in a chat.
declare(strict_types=1);
require_once __DIR__ . '/helpers.php';

set_cors_headers();
if ($_SERVER['REQUEST_METHOD'] !== 'GET') json_err('method_not_allowed', 'Только GET', 405);

$me     = auth_user();
$chatId = (int) ($_GET['chat_id'] ?? 0);
$q      = trim($_GET['q'] ?? '');
$limit  = min(max((int) ($_GET['limit'] ?? 200), 1), 500);

if ($chatId <= 0) json_err('bad_request', 'chat_id обязателен', 400);
if ($q === '')    json_err('bad_request', 'q обязателен', 400);
if (mb_strlen($q) > 200) json_err('bad_request', 'Запрос слишком длинный', 400);

// Check access
$stmt = db()->prepare('SELECT id FROM chats WHERE id = ? AND (user_a = ? OR user_b = ?) LIMIT 1');
$stmt->execute([$chatId, $me['id'], $me['id']]);
if (!$stmt->fetch()) json_err('forbidden', 'Нет доступа к этому чату', 403);

// Search messages with LIKE (case-insensitive)
$searchParam = '%' . $q . '%';

// Get total count (unlimited) for accurate "X из Y" display
$stmtCount = db()->prepare(
    'SELECT COUNT(*) AS cnt
     FROM messages m
     WHERE m.chat_id = ?
       AND m.is_deleted = 0
       AND m.body LIKE ?'
);
$stmtCount->execute([$chatId, $searchParam]);
$totalInChat = (int) $stmtCount->fetchColumn();

// Fetch actual messages (limited)
$stmt = db()->prepare(
    'SELECT m.id, m.sender_id, m.body,
            UNIX_TIMESTAMP(m.sent_at) AS sent_at
     FROM messages m
     WHERE m.chat_id = ?
       AND m.is_deleted = 0
       AND m.body LIKE ?
     ORDER BY m.id DESC
     LIMIT ?'
);
$stmt->execute([$chatId, $searchParam, $limit]);
$rows = $stmt->fetchAll();

$messages = array_map(fn($r) => [
    'id'        => (int) $r['id'],
    'sender_id' => (int) $r['sender_id'],
    'body'      => $r['body']   ?? '',
    'sent_at'   => (int) $r['sent_at'],
], $rows);

json_ok([
    'messages'      => $messages,
    'total'         => count($messages),
    'total_in_chat' => $totalInChat,
]);

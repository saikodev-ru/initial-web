<?php
// POST /api/pin_chat.php
// Body: { chat_id: int, pinned: 0|1 }          — toggle pin
//    OR { reorder: [id1, id2, id3, ...] }       — save drag order
// Header: Authorization: Bearer <token>
declare(strict_types=1);
require_once __DIR__ . '/../helpers.php';

set_cors_headers();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_err('method_not_allowed', 'Только POST', 405);

$me   = auth_user();
require_rate_limit('pin_chat', 30, 60);
$body = input();

// ── Reorder mode ─────────────────────────────────────────────
if (isset($body['reorder']) && is_array($body['reorder'])) {
    $ids = array_values(array_filter(array_map('intval', $body['reorder']), fn($id) => $id > 0));
    if (empty($ids)) json_ok(['ok' => true]);

    // Verify all chats belong to this user
    $ph = implode(',', array_fill(0, count($ids), '?'));
    $stmt = db()->prepare("SELECT id FROM chats WHERE id IN ($ph) AND (user_a = ? OR user_b = ?)");
    $stmt->execute([...$ids, $me['id'], $me['id']]);
    $allowed = array_map('intval', array_column($stmt->fetchAll(), 'id'));

    // Assign pin_order: first in array = highest value
    $total = count($ids);
    $update = db()->prepare('UPDATE chats SET pin_order = ? WHERE id = ? AND (user_a = ? OR user_b = ?)');
    foreach ($ids as $i => $chatId) {
        if (!in_array($chatId, $allowed)) continue;
        $update->execute([$total - $i, $chatId, $me['id'], $me['id']]);
    }

    json_ok(['reordered' => true]);
}

// ── Toggle pin mode ───────────────────────────────────────────
$chat_id = (int) ($body['chat_id'] ?? 0);
$pinned  = (int) (bool) ($body['pinned'] ?? 0);

if ($chat_id <= 0) json_err('invalid', 'Неверный chat_id', 400);

$stmt = db()->prepare('SELECT id FROM chats WHERE id = ? AND (user_a = ? OR user_b = ?) LIMIT 1');
$stmt->execute([$chat_id, $me['id'], $me['id']]);
if (!$stmt->fetch()) json_err('forbidden', 'Нет доступа к этому чату', 403);

db()->prepare('UPDATE chats SET is_pinned = ?, pin_order = COALESCE(pin_order, 0) WHERE id = ?')
    ->execute([$pinned, $chat_id]);

json_ok(['pinned' => $pinned]);
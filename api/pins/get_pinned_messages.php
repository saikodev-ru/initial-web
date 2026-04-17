<?php
// GET /api/get_pinned_messages.php?chat_id=X
// Returns ALL pinned messages for the current user in this chat (Telegram-style multi-pin)
// Header: Authorization: Bearer <token>
declare(strict_types=1);
require_once __DIR__ . '/../helpers.php';

set_cors_headers();
if ($_SERVER['REQUEST_METHOD'] !== 'GET') json_err('method_not_allowed', 'Только GET', 405);

$me     = auth_user();
$pdo    = db();
$chatId = (int) ($_GET['chat_id'] ?? 0);

if ($chatId <= 0) json_err('invalid', 'Неверный chat_id', 400);

// Verify chat access
$stmt = $pdo->prepare('SELECT id FROM chats WHERE id = ? AND (user_a = ? OR user_b = ?) LIMIT 1');
$stmt->execute([$chatId, $me['id'], $me['id']]);
if (!$stmt->fetch()) json_err('forbidden', 'Нет доступа к этому чату', 403);

// Get ALL pinned messages for current user in this chat, ordered by created_at ASC (oldest first)
$stmt = $pdo->prepare(
    'SELECT pm.message_id, pm.pinned_for_all, pm.created_at,
            m.body, m.media_url, m.media_type, m.sent_at,
            u.nickname AS sender_name, u.avatar_url AS sender_avatar
     FROM pinned_messages pm
     JOIN messages m ON m.id = pm.message_id
     LEFT JOIN users u ON u.id = m.sender_id
     WHERE pm.chat_id = ? AND pm.user_id = ?
     ORDER BY pm.created_at ASC'
);
$stmt->execute([$chatId, $me['id']]);
$pins = $stmt->fetchAll();

if (empty($pins)) {
    json_ok(['ok' => true, 'pinned' => []]);
}

$pinned = [];
foreach ($pins as $pin) {
    $mediaUrl = null;
    if (!empty($pin['media_url'])) {
        $mediaRes = build_media_response($pin['media_url']);
        $mediaUrl = $mediaRes['key'];
    }

    $pinned[] = [
        'message_id'      => (int) $pin['message_id'],
        'body'            => $pin['body'] ?? null,
        'sender_name'     => $pin['sender_name'] ?? null,
        'sender_avatar'   => $pin['sender_avatar'] ?? null,
        'media_url'       => $mediaUrl,
        'media_type'      => $pin['media_type'] ?? null,
        'pinned_for_all'  => (int) $pin['pinned_for_all'],
        'created_at'      => $pin['created_at'],
        'sent_at'         => (int) ($pin['sent_at'] ?? 0),
    ];
}

json_ok([
    'ok'     => true,
    'pinned' => $pinned,
]);

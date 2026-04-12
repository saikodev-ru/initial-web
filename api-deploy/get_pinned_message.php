<?php
// GET /api/get_pinned_message.php?chat_id=X
// Returns the pinned message for current user in this chat
// Header: Authorization: Bearer <token>
declare(strict_types=1);
require_once __DIR__ . '/helpers.php';

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

// Get pinned message for current user
$stmt = $pdo->prepare(
    'SELECT pm.message_id, pm.pinned_for_all, pm.created_at,
            m.body, m.media_url, m.media_type,
            u.nickname AS sender_name, u.avatar_url AS sender_avatar
     FROM pinned_messages pm
     JOIN messages m ON m.id = pm.message_id
     LEFT JOIN users u ON u.id = m.sender_id
     WHERE pm.chat_id = ? AND pm.user_id = ?
     LIMIT 1'
);
$stmt->execute([$chatId, $me['id']]);
$pin = $stmt->fetch();

if (!$pin) {
    json_ok(['ok' => true, 'pinned' => null]);
}

// Build media response if applicable
$mediaUrl = null;
if (!empty($pin['media_url'])) {
    $mediaRes = build_media_response($pin['media_url']);
    $mediaUrl = $mediaRes['key'];
}

json_ok([
    'ok'     => true,
    'pinned' => [
        'message_id'      => (int) $pin['message_id'],
        'body'            => $pin['body'] ?? null,
        'sender_name'     => $pin['sender_name'] ?? null,
        'sender_avatar'   => $pin['sender_avatar'] ?? null,
        'media_url'       => $mediaUrl,
        'media_type'      => $pin['media_type'] ?? null,
        'pinned_for_all'  => (int) $pin['pinned_for_all'],
        'created_at'      => $pin['created_at'],
    ],
]);

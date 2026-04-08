<?php
// POST /api/send_system_message.php
// Только internal — вызывается из других скриптов или cron.
// НЕ требует Bearer-токена пользователя, но требует SYSTEM_SECRET из .env.
declare(strict_types=1);
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/helpers.php';

// Защита: системный ключ в заголовке X-System-Key
$secret = $_ENV['SYSTEM_SECRET'] ?? '';
if (!$secret || ($_SERVER['HTTP_X_SYSTEM_KEY'] ?? '') !== $secret) {
    http_response_code(403);
    echo json_encode(['ok' => false, 'error' => 'forbidden']);
    exit;
}

$input = json_decode(file_get_contents('php://input'), true) ?? [];
$to_user_id = (int)($input['user_id'] ?? 0);
$body       = trim($input['body'] ?? '');

if (!$to_user_id || !$body) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'missing params']);
    exit;
}

// Найти системного пользователя
$stmt = $pdo->prepare("SELECT id FROM users WHERE is_system=1 AND signal_id='initial' LIMIT 1");
$stmt->execute();
$system = $stmt->fetch(PDO::FETCH_ASSOC);
if (!$system) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'system user not found']);
    exit;
}
$system_id = (int)$system['id'];

// Найти или создать чат @signal ↔ пользователь
$stmt = $pdo->prepare(
    "SELECT id FROM chats
     WHERE is_protected=1
       AND (
         (user_a=? AND user_b=?)
      OR (user_a=? AND user_b=?)
     ) LIMIT 1"
);
$stmt->execute([$system_id, $to_user_id, $to_user_id, $system_id]);
$chat = $stmt->fetch(PDO::FETCH_ASSOC);

if (!$chat) {
    // Создать защищённый чат
    $pdo->prepare(
        "INSERT INTO chats (user_a, user_b, is_protected, created_at)
         VALUES (?, ?, 1, NOW())"
    )->execute([$system_id, $to_user_id]);
    $chat_id = (int)$pdo->lastInsertId();
} else {
    $chat_id = (int)$chat['id'];
}

// Вставить сообщение от системы
$stmt = $pdo->prepare(
    "INSERT INTO messages (chat_id, sender_id, body, sent_at, is_read)
     VALUES (:cid, :sid, :body, NOW(), 0)"
);
$stmt->execute([
    ':cid'  => $chat_id,
    ':sid'  => $system_id,
    ':body' => $body,
]);

$msg_id = (int)$pdo->lastInsertId();

// Порядок чатов определяется по sent_at последнего сообщения — дополнительный UPDATE не нужен.

echo json_encode(['ok' => true, 'message_id' => $msg_id, 'chat_id' => $chat_id]);
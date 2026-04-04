<?php
// GET /api/get_reactions.php?ids=1,2,3,42
// Header: Authorization: Bearer <token>
// Response: { "ok": true, "reactions": { "1": [...], "42": [...] } }
declare(strict_types=1);
require_once __DIR__ . '/helpers.php';

set_cors_headers();
if ($_SERVER['REQUEST_METHOD'] !== 'GET') json_err('method_not_allowed', 'Только GET', 405);

$me = auth_user();

$raw = trim($_GET['ids'] ?? '');
if (!$raw) json_ok(['reactions' => (object) []]);

$ids = array_values(array_unique(array_filter(
    array_map('intval', explode(',', $raw)),
    fn($id) => $id > 0
)));

if (empty($ids))      json_ok(['reactions' => (object) []]);
if (count($ids) > 100) json_err('too_many', 'Максимум 100 ID за запрос');

// Оставляем только сообщения из чатов текущего пользователя
$ph   = implode(',', array_fill(0, count($ids), '?'));
$stmt = db()->prepare(
    "SELECT DISTINCT m.id FROM messages m
     JOIN chats c ON c.id = m.chat_id
     WHERE m.id IN ($ph)
       AND (c.user_a = ? OR c.user_b = ?)"
);
$stmt->execute(array_merge($ids, [$me['id'], $me['id']]));
$allowed = array_map('intval', array_column($stmt->fetchAll(), 'id'));

if (empty($allowed)) json_ok(['reactions' => (object) []]);

$ph2   = implode(',', array_fill(0, count($allowed), '?'));
$stmt2 = db()->prepare(
    "SELECT message_id,
            emoji,
            COUNT(*)                                                          AS cnt,
            MAX(CASE WHEN user_id = ? THEN 1 ELSE 0 END)                     AS by_me,
            MAX(CASE WHEN user_id = ? THEN UNIX_TIMESTAMP(created_at) ELSE 0 END) AS my_created_at
     FROM message_reactions
     WHERE message_id IN ($ph2)
     GROUP BY message_id, emoji
     ORDER BY cnt DESC, emoji"
);
$stmt2->execute(array_merge([(int) $me['id'], (int) $me['id']], $allowed));

$map = [];
foreach ($stmt2->fetchAll() as $r) {
    $map[$r['message_id']][] = [
        'emoji'      => $r['emoji'],
        'count'      => (int)  $r['cnt'],
        'by_me'      => (bool) $r['by_me'],
        'created_at' => (int)  $r['my_created_at'],
    ];
}

json_ok(['reactions' => (object) $map]);

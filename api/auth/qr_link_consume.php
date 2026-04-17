<?php
// POST /api/qr_link_consume.php
// Вызывается мобильным без авторизации.
// Потребляет link-токен → создаёт новую сессию → возвращает auth_token + user.
declare(strict_types=1);
require_once __DIR__ . '/../helpers.php';

set_cors_headers();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_err('method_not_allowed', 'Только POST', 405);

$data  = input();
$token = trim($data['token'] ?? '');
if (!$token || strlen($token) < 10) json_err('invalid_token', 'Неверный токен');

$stmt = db()->prepare(
    "SELECT qs.id, qs.status, qs.user_id, qs.expires_at,
            u.id as uid, u.email, u.nickname, u.signal_id, u.avatar_url
     FROM qr_sessions qs
     JOIN users u ON u.id = qs.user_id
     WHERE qs.token = ? AND qs.type = 'link'
     LIMIT 1"
);
$stmt->execute([$token]);
$row = $stmt->fetch();

if (!$row) json_err('not_found', 'QR-код не найден или уже использован', 404);

if ($row['status'] !== 'pending' || strtotime($row['expires_at']) < time()) {
    db()->prepare("UPDATE qr_sessions SET status='expired' WHERE id=?")->execute([$row['id']]);
    json_err('expired', 'QR-код истёк. Попросите показать новый.');
}

// Помечаем токен как использованный
db()->prepare("UPDATE qr_sessions SET status='approved' WHERE id=?")->execute([$row['id']]);

// Создаём сессию для владельца токена
$authToken = create_session((int)$row['uid']);

json_ok([
    'auth_token' => $authToken,
    'user' => [
        'id'         => $row['uid'],
        'email'      => $row['email'],
        'nickname'   => $row['nickname'],
        'signal_id'  => $row['signal_id'],
        'avatar_url' => $row['avatar_url'],
    ],
]);

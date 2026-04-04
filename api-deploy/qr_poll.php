<?php
// GET /api/qr_poll.php?token=XXX
// Опрашивает статус QR-сессии. Вызывается фронтом каждые 2 секунды.
// Статусы: pending → scanned → approved | expired
declare(strict_types=1);
require_once __DIR__ . '/helpers.php';

set_cors_headers();
if ($_SERVER['REQUEST_METHOD'] !== 'GET') json_err('method_not_allowed', 'Только GET', 405);

$token = trim($_GET['token'] ?? '');
if (!$token || strlen($token) < 10) json_err('invalid_token', 'Неверный токен');

$stmt = db()->prepare(
    "SELECT status, auth_token, expires_at, user_id FROM qr_sessions WHERE token = ? LIMIT 1"
);
$stmt->execute([$token]);
$row = $stmt->fetch();

if (!$row) json_err('not_found', 'QR-сессия не найдена', 404);

// Автоматически протухаем по времени
if ($row['status'] === 'pending' && strtotime($row['expires_at']) < time()) {
    db()->prepare("UPDATE qr_sessions SET status='expired' WHERE token=?")->execute([$token]);
    json_ok(['status' => 'expired']);
}

if ($row['status'] === 'approved') {
    // Если сессия еще не создана для этого QR кода (первый опрос после подтверждения)
    if (!$row['auth_token']) {
        $row['auth_token'] = create_session((int)$row['user_id']);
        db()->prepare("UPDATE qr_sessions SET auth_token=? WHERE token=?")->execute([$row['auth_token'], $token]);
        
        // Отправляем системное уведомление именно сейчас,
        // потому что здесь мы знаем настоящий IP десктопа, который делает опрос!
        sendLoginNotification((int)$row['user_id']);
    }

    // Отдаём токен сессии + данные пользователя
    $stmt = db()->prepare(
        "SELECT u.id, u.email, u.nickname, u.signal_id, u.avatar_url
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token = ? AND s.expires_at > NOW()
         LIMIT 1"
    );
    $stmt->execute([$row['auth_token']]);
    $user = $stmt->fetch();

    json_ok([
        'status'     => 'approved',
        'auth_token' => $row['auth_token'],
        'user'       => $user ?: null,
    ]);
}

// pending / scanned / expired — без токена
json_ok(['status' => $row['status']]);

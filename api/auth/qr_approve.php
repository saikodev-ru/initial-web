<?php
// POST /api/qr_approve.php
// Вызывается с авторизованного устройства. Подтверждает вход для устройства с QR.
// Body: { "qr_token": "..." }
declare(strict_types=1);
require_once __DIR__ . '/../helpers.php';

set_cors_headers();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_err('method_not_allowed', 'Только POST', 405);

$me   = auth_user();
$data = input();

$qrToken = trim($data['qr_token'] ?? '');
if (!$qrToken || strlen($qrToken) < 10) json_err('invalid_token', 'Неверный qr_token');

$stmt = db()->prepare(
    "SELECT id, status, expires_at FROM qr_sessions WHERE token = ? LIMIT 1"
);
$stmt->execute([$qrToken]);
$row = $stmt->fetch();

if (!$row) json_err('not_found', 'QR-сессия не найдена', 404);

if (in_array($row['status'], ['approved', 'expired'], true)) {
    json_err('already_used', 'QR-код уже использован или истёк');
}

if (strtotime($row['expires_at']) < time()) {
    db()->prepare("UPDATE qr_sessions SET status='expired' WHERE token=?")->execute([$qrToken]);
    json_err('expired', 'QR-код истёк. Запросите новый.');
}

// Помечаем QR как подтверждённый и привязываем user_id
// Саму сессию (auth_token) создаст desktop-клиент при следующем pull-запросе к qr_poll.php,
// чтобы в базе сохранились именно его IP и User-Agent.
db()->prepare(
    "UPDATE qr_sessions SET status='approved', user_id=? WHERE token=?"
)->execute([(int)$me['id'], $qrToken]);

json_ok(['approved' => true]);

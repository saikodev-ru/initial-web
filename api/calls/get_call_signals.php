<?php
// GET /api/get_call_signals.php?last_id=N
// Returns call signals addressed to the current user with id > last_id.
// Called by the frontend on a 1-second interval as a reliable fallback
// to the fragile SSE long-poll approach.
declare(strict_types=1);
require_once __DIR__ . '/../helpers.php';

set_cors_headers();
if ($_SERVER['REQUEST_METHOD'] !== 'GET') json_err('method_not_allowed', 'Only GET', 405);

$me     = auth_user();
require_rate_limit('call_signals', 120, 60); // 2/сек — polled каждую секунду
$lastId = (int) ($_GET['last_id'] ?? 0);

// Auto-migrate table if it doesn't exist yet
try {
    db()->query("SELECT 1 FROM call_signals LIMIT 1");
} catch (PDOException $e) {
    db()->exec("
        CREATE TABLE IF NOT EXISTS `call_signals` (
            `id` bigint unsigned NOT NULL AUTO_INCREMENT,
            `sender_id` int unsigned NOT NULL,
            `target_id` int unsigned NOT NULL,
            `type` varchar(50) NOT NULL,
            `payload` text NOT NULL,
            `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (`id`),
            KEY `target_id` (`target_id`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    ");
}

if ($lastId === 0) {
    // Инициализация поллинга: возвращаем абсолютный максимум ID, 
    // чтобы клиент разом пропустил ВСЕ старые сигналы (иначе LIMIT 10 разобьет их на партии)
    $stmt = db()->prepare('SELECT MAX(id) FROM call_signals WHERE target_id = ?');
    $stmt->execute([$me['id']]);
    $maxId = (int) $stmt->fetchColumn();

    // Возвращаем свежие offer-сигналы (за последние 30 сек),
    // чтобы входящий звонок не сбрасывался при обновлении/неполной загрузке страницы
    $stmt = db()->prepare(
        'SELECT id, sender_id, type, payload, UNIX_TIMESTAMP(created_at) AS created_at
         FROM call_signals
         WHERE target_id = ? AND type IN ("offer", "call_active") AND UNIX_TIMESTAMP(created_at) >= ?
         ORDER BY id ASC'
    );
    $stmt->execute([$me['id'], time() - 30]);
    $rows = $stmt->fetchAll();

    $signals = array_map(fn($s) => [
        'id'         => (int) $s['id'],
        'sender_id'  => (int) $s['sender_id'],
        'type'       => $s['type'],
        'payload'    => $s['payload'],
        'created_at' => (int) $s['created_at'],
    ], $rows);

    json_ok(['signals' => $signals, 'last_id' => $maxId]);
}

$stmt = db()->prepare(
    'SELECT id, sender_id, type, payload, UNIX_TIMESTAMP(created_at) AS created_at
     FROM call_signals
     WHERE target_id = ? AND id > ? AND UNIX_TIMESTAMP(created_at) >= ?
     ORDER BY id ASC
     LIMIT 10'
);
$stmt->execute([$me['id'], $lastId, time() - 60]);
$rows = $stmt->fetchAll();

$signals = array_map(fn($s) => [
    'id'         => (int) $s['id'],
    'sender_id'  => (int) $s['sender_id'],
    'type'       => $s['type'],
    'payload'    => $s['payload'],
    'created_at' => (int) $s['created_at'],
], $rows);

// Return max id so the caller can advance the cursor
$maxId = $signals ? max(array_column($signals, 'id')) : $lastId;

json_ok(['signals' => $signals, 'last_id' => $maxId]);

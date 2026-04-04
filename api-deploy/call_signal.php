<?php
// POST /api/call_signal.php
declare(strict_types=1);
require_once __DIR__ . '/helpers.php';
set_cors_headers();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_err('method_not_allowed', 'Только POST', 405);

$me = auth_user();
$in = input();

// Simple auto-migration for call_signals table
try {
    db()->query("SELECT 1 FROM call_signals LIMIT 1");
} catch(PDOException $e) {
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

$targetId = (int) ($in['target_id'] ?? 0);
$type     = trim($in['type'] ?? '');
$payload  = trim(is_array($in['payload'] ?? null) ? json_encode($in['payload']) : ($in['payload'] ?? ''));

if (!$targetId || !$type || !$payload) {
    json_err('bad_request', 'Missing parameters', 400);
}

$t = time();
$stmt = db()->prepare('INSERT INTO call_signals (sender_id, target_id, type, payload, created_at) VALUES (?, ?, ?, ?, FROM_UNIXTIME(?))');
$stmt->execute([$me['id'], $targetId, $type, $payload, $t]);
$signalId = (int) db()->lastInsertId();

// ── Отправка Push-уведомления для входящего вызова ───────────
if ($type === 'offer') {
    $stmtFcm = db()->prepare('SELECT fcm_token FROM users WHERE id = ?');
    $stmtFcm->execute([$targetId]);
    $recipientFcm = $stmtFcm->fetchColumn();

    if (!empty($recipientFcm)) {
        $senderName = $me['nickname'] ?? $me['email'] ?? 'Signal';
        send_push(
            $recipientFcm,
            $senderName,
            '📞 Входящий видео/аудио звонок...',
            [
                'action' => 'incoming_call',
                'sender_signal_id' => $me['signal_id'] ?? ''
            ]
        );
    }
}

// Safely cleanup old signals (older than 60s) using unix timestamps, bypassing MySQL timezone offset bugs
db()->prepare("DELETE FROM call_signals WHERE UNIX_TIMESTAMP(created_at) < ?")->execute([$t - 60]);

json_ok(['message' => 'Signal sent', 'signal_id' => $signalId]);

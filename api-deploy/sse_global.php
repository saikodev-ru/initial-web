<?php
// GET /api/sse_global.php
// Server-Sent Events for global events like calls across the app
declare(strict_types=1);
require_once __DIR__ . '/helpers.php';

header('Content-Type: text/event-stream; charset=UTF-8');
header('Cache-Control: no-cache');
header('X-Accel-Buffering: no');
header('Access-Control-Allow-Origin: ' . ALLOWED_ORIGIN);
header('Access-Control-Allow-Headers: Authorization, Content-Type');

@ini_set('zlib.output_compression', '0');
@ini_set('output_buffering', '0');
@set_time_limit(0);      // Prevent PHP from killing the long-poll loop
ignore_user_abort(true); // Keep running even if client disconnects (poll will catch it)
while (ob_get_level()) ob_end_flush();
flush();

if (!empty($_GET['token'])) {
    $_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . $_GET['token'];
}
$me = auth_user();

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

echo "event: connected\ndata: {\"global\":true}\n\n";
flush();

$pollInterval = 0.3;  // reduced from 0.8 to catch fast signals
$maxLifetime  = 55;
$startTime    = time();

// Start from signals inserted in the last 10 seconds — prevents missing
// offers that were sent a moment before this SSE connection opened.
$stmtLast = db()->prepare(
    "SELECT COALESCE(MIN(id), 0) - 1 FROM call_signals
     WHERE target_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 10 SECOND)"
);
$stmtLast->execute([$me['id']]);
$recentMin = (int) ($stmtLast->fetchColumn() ?: 0);

// But also cap it so we never re-deliver extremely old signals
$stmtMax = db()->prepare("SELECT COALESCE(MAX(id), 0) FROM call_signals WHERE target_id = ? AND created_at < DATE_SUB(NOW(), INTERVAL 10 SECOND)");
$stmtMax->execute([$me['id']]);
$oldMax = (int) ($stmtMax->fetchColumn() ?: 0);

$lastId = max($recentMin, $oldMax);

while (true) {
    if (connection_aborted()) break;
    if (time() - $startTime >= $maxLifetime) {
        echo "event: reconnect\ndata: {}\n\n";
        flush(); break;
    }

    $stmtNew = db()->prepare(
        'SELECT id, sender_id, type, payload, UNIX_TIMESTAMP(created_at) as created_at 
         FROM call_signals 
         WHERE target_id = ? AND id > ? 
         ORDER BY id ASC'
    );
    $stmtNew->execute([$me['id'], $lastId]);
    $signals = $stmtNew->fetchAll();

    if (!empty($signals)) {
        foreach ($signals as $s) {
            $lastId = max($lastId, (int)$s['id']);
            $data = json_encode([
                'id' => (int) $s['id'],
                'sender_id' => (int) $s['sender_id'],
                'type' => $s['type'],
                'payload' => $s['payload'],
                'created_at' => (int) $s['created_at']
            ], JSON_UNESCAPED_UNICODE);
            echo "event: call_signal\ndata: {$data}\n\n";
        }
        flush();
    }

    static $lastHb = 0;
    if (time() - $lastHb >= 10) {
        echo ": heartbeat\n\n";
        flush();
        $lastHb = time();
    }

    usleep((int)($pollInterval * 1_000_000));
}

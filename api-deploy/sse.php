<?php
// GET /api/sse.php?chat_id=5&last_id=100
// Server-Sent Events — мгновенная доставка новых сообщений, удалений и обновления профиля.
declare(strict_types=1);
require_once __DIR__ . '/helpers.php';

header('Content-Type: text/event-stream; charset=UTF-8');
header('Cache-Control: no-cache');
header('X-Accel-Buffering: no');
header('Access-Control-Allow-Origin: ' . ALLOWED_ORIGIN);
header('Access-Control-Allow-Headers: Authorization, Content-Type');

@ini_set('zlib.output_compression', '0');
@ini_set('output_buffering', '0');
while (ob_get_level()) ob_end_flush();
flush();

if (!empty($_GET['token'])) {
    $_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . $_GET['token'];
}
$me     = auth_user();
$chatId = (int) ($_GET['chat_id'] ?? 0);
$lastId = (int) ($_GET['last_id'] ?? 0);

if ($chatId <= 0) {
    echo "event: error\ndata: {\"error\":\"invalid_chat_id\"}\n\n";
    flush(); exit;
}

$stmt = db()->prepare('SELECT id FROM chats WHERE id=? AND (user_a=? OR user_b=?) LIMIT 1');
$stmt->execute([$chatId, $me['id'], $me['id']]);
if (!$stmt->fetch()) {
    echo "event: error\ndata: {\"error\":\"forbidden\"}\n\n";
    flush(); exit;
}

echo "event: connected\ndata: {\"chat_id\":{$chatId}}\n\n";
flush();

$pollInterval = 0.8;
$maxLifetime  = 55;
$startTime    = time();
$knownIds     = [];

// Snapshot профиля для обнаружения изменений
$stmtMe = db()->prepare('SELECT nickname, avatar_url, bio FROM users WHERE id=? LIMIT 1');
$stmtMe->execute([$me['id']]);
$myProfile     = $stmtMe->fetch() ?: [];
$knownAvatar   = $myProfile['avatar_url'] ?? '';
$knownNickname = $myProfile['nickname']   ?? '';
$knownBio      = $myProfile['bio']        ?? '';

while (true) {
    if (connection_aborted()) break;
    if (time() - $startTime >= $maxLifetime) {
        echo "event: reconnect\ndata: {}\n\n";
        flush(); break;
    }

    // ── Новые сообщения ───────────────────────────────────────
    $stmtNew = db()->prepare(
        'SELECT m.id, m.sender_id, m.body, m.is_read, m.reply_to, m.is_edited,
                m.media_url, m.media_type, UNIX_TIMESTAMP(m.sent_at) AS sent_at,
                u.nickname, u.signal_id, u.avatar_url
         FROM messages m JOIN users u ON u.id=m.sender_id
         WHERE m.chat_id=? AND m.is_deleted=0 AND m.id>?
         ORDER BY m.sent_at ASC LIMIT 20'
    );
    $stmtNew->execute([$chatId, $lastId]);
    $newMsgs = $stmtNew->fetchAll();

    if (!empty($newMsgs)) {
        foreach ($newMsgs as $m) {
            $lastId = max($lastId, (int)$m['id']);
        }
        $newMsgs = array_map(fn($m) => array_merge($m, [
            'id'         => (int) $m['id'],
            'sender_id'  => (int) $m['sender_id'],
            'sent_at'    => (int) $m['sent_at'],
            'is_read'    => (int) $m['is_read'],
            'is_edited'  => (int) $m['is_edited'],
            'reply_to'   => isset($m['reply_to']) ? (int)$m['reply_to'] : null,
            'media_url'  => $m['media_url']  ?? null,
            'media_type' => $m['media_type'] ?? null,
            'reactions'  => [],
        ]), $newMsgs);

        $data = json_encode(['messages' => $newMsgs, 'last_id' => $lastId], JSON_UNESCAPED_UNICODE);
        echo "event: messages\ndata: {$data}\n\n";
        flush();
    }

    // ── Обновление профиля (аватар / никнейм) ────────────────
    $stmtMe->execute([$me['id']]);
    $freshProfile  = $stmtMe->fetch() ?: [];
    $freshAvatar   = $freshProfile['avatar_url'] ?? '';
    $freshNickname = $freshProfile['nickname']   ?? '';
    $freshBio      = $freshProfile['bio']        ?? '';
    if ($freshAvatar !== $knownAvatar || $freshNickname !== $knownNickname || $freshBio !== $knownBio) {
        $knownAvatar   = $freshAvatar;
        $knownNickname = $freshNickname;
        $knownBio      = $freshBio;
        $profileData = json_encode([
            'avatar_url' => $freshAvatar,
            'nickname'   => $freshNickname,
            'bio'        => $freshBio,
        ], JSON_UNESCAPED_UNICODE);
        echo "event: profile_update\ndata: {$profileData}\n\n";
        flush();
    }

    foreach ($newMsgs as $m) $knownIds[$m['id']] = true;

    static $lastHb = 0;
    if (time() - $lastHb >= 10) {
        echo ": heartbeat\n\n";
        flush();
        $lastHb = time();
    }

    usleep((int)($pollInterval * 1_000_000));
}

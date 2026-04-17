<?php
// ═══════════════════════════════════════════════════════════════
//  POLL UPDATES — Long-polling endpoint for real-time delivery
//  GET /api/poll_updates?cursor=<unix_timestamp>&last_call_id=<int>
//  Header: Authorization: Bearer <token>
//
//  Holds connection open for up to 25 seconds, checking for updates.
//  Returns immediately when new data is available.
//
//  Response: {
//    ok: true,
//    now: <server_timestamp>,
//    messages: [...],
//    chat_updates: [...],
//    typing: [...],
//    call_signals: [...]
//  }
// ═══════════════════════════════════════════════════════════════
declare(strict_types=1);

// Увеличиваем лимит времени для long-polling
@set_time_limit(30);
@ini_set('max_execution_time', '30');

// Игнорируем abort клиента — пишем в лог, а не крашимся
ignore_user_abort(false);

require_once __DIR__ . '/../helpers.php';

set_cors_headers();
if ($_SERVER['REQUEST_METHOD'] !== 'GET') json_err('method_not_allowed', 'Только GET', 405);

$me       = auth_user();
$uid      = (int) $me['id'];
$cursor   = (int) ($_GET['cursor'] ?? 0);
$lastCall = (int) ($_GET['last_call_id'] ?? 0);
$chatId   = (int) ($_GET['chat_id'] ?? 0);

// Rate limit: 120/min (polled every ~0.5-1s)
if (function_exists('require_rate_limit')) {
    require_rate_limit('poll_updates', 120, 60);
}

// Validate cursor (not in the future, not negative)
if ($cursor < 0) $cursor = 0;
if ($cursor > time() + 60) $cursor = time(); // Не допускаем будущее больше чем на 60с

// If no cursor, return current server time
if ($cursor <= 0) {
    json_ok([
        'now'           => time(),
        'messages'      => [],
        'chat_updates'  => [],
        'typing'        => [],
        'call_signals'  => [],
        'last_call_id'  => $lastCall,
    ]);
}

$db      = db();
$maxWait = 25; // seconds
$start   = time();

// Pre-load user's chat IDs for efficient queries
$chatIds = [];
$stmtChats = $db->prepare('SELECT id FROM chats WHERE user_a = ? OR user_b = ?');
$stmtChats->execute([$uid, $uid]);
foreach ($stmtChats->fetchAll(PDO::FETCH_COLUMN) as $cid) {
    $chatIds[] = (int) $cid;
}

// If chat_id specified, also return messages for that specific chat
$checkChatId = ($chatId > 0 && in_array($chatId, $chatIds, true)) ? $chatId : 0;

// Pre-load current call_signals max ID (graceful — table may not exist yet)
$currentMaxCallId = 0;
try {
    $stmtMaxCall = $db->prepare('SELECT COALESCE(MAX(id), 0) FROM call_signals WHERE target_id = ?');
    $stmtMaxCall->execute([$uid]);
    $currentMaxCallId = (int) $stmtMaxCall->fetchColumn();
} catch (\Throwable $e) {
    error_log("poll_updates: call_signals table missing or error: " . $e->getMessage());
    $currentMaxCallId = 0;
}

// ── Main long-polling loop ──────────────────────────────────
while (true) {
    // ── Check if client disconnected ─────────────────────────
    if (connection_aborted()) {
        exit; // Клиент ушёл — молча завершаем
    }

    $results = [
        'messages'     => [],
        'chat_updates' => [],
        'typing'       => [],
        'call_signals' => [],
    ];

    $hasData = false;

    // ── 1. New messages in user's chats ──────────────────────
    if (!empty($chatIds)) {
        try {
            $ph = implode(',', array_fill(0, count($chatIds), '?'));
            $params = $chatIds;

            if ($checkChatId > 0) {
                // Specific chat mode: only messages from that chat
                $msgStmt = $db->prepare(
                    "SELECT m.id, m.chat_id, m.sender_id, m.body, m.reply_to, m.is_edited,
                            m.media_url, m.media_type, m.media_spoiler, m.batch_id,
                            m.voice_duration, m.voice_waveform,
                            UNIX_TIMESTAMP(m.sent_at) AS sent_at,
                            u.nickname, u.signal_id, u.avatar_url, u.is_team_signal
                     FROM messages m
                     JOIN users u ON u.id = m.sender_id
                     WHERE m.chat_id = ? AND m.is_deleted = 0
                       AND UNIX_TIMESTAMP(m.sent_at) > ?
                     ORDER BY m.sent_at ASC LIMIT 50"
                );
                $msgStmt->execute([$checkChatId, $cursor]);
            } else {
                // All chats mode
                $msgStmt = $db->prepare(
                    "SELECT m.id, m.chat_id, m.sender_id, m.body, m.reply_to, m.is_edited,
                            m.media_url, m.media_type, m.media_spoiler, m.batch_id,
                            m.voice_duration, m.voice_waveform,
                            UNIX_TIMESTAMP(m.sent_at) AS sent_at,
                            u.nickname, u.signal_id, u.avatar_url, u.is_team_signal
                     FROM messages m
                     JOIN users u ON u.id = m.sender_id
                     WHERE m.chat_id IN ($ph) AND m.is_deleted = 0
                       AND UNIX_TIMESTAMP(m.sent_at) > ?
                     ORDER BY m.sent_at ASC LIMIT 50"
                );
                $msgStmt->execute(array_merge($params, [$cursor]));
            }

            $msgs = $msgStmt->fetchAll();
            if (!empty($msgs)) {
                $hasData = true;
                $results['messages'] = array_map(fn($m) => [
                    'id'              => (int) $m['id'],
                    'chat_id'         => (int) $m['chat_id'],
                    'sender_id'       => (int) $m['sender_id'],
                    'body'            => $m['body'],
                    'reply_to'        => isset($m['reply_to']) ? (int) $m['reply_to'] : null,
                    'is_edited'       => (int) $m['is_edited'],
                    'media_url'       => $m['media_url'] ?? null,
                    'media_type'      => $m['media_type'] ?? null,
                    'media_spoiler'   => (int) ($m['media_spoiler'] ?? 0),
                    'batch_id'        => $m['batch_id'] ?? null,
                    'voice_duration'  => isset($m['voice_duration']) ? (int) $m['voice_duration'] : null,
                    'voice_waveform'  => $m['voice_waveform'] ?? null,
                    'sent_at'         => (int) $m['sent_at'],
                    'sender_signal_id'=> $m['signal_id'] ?? '',
                    'sender_name'     => $m['nickname'] ?? '',
                    'sender_avatar'   => $m['avatar_url'] ?? '',
                    'is_team_signal'  => (int) ($m['is_team_signal'] ?? 0),
                ], $msgs);

                $updatedChatIds = array_unique(array_column($msgs, 'chat_id'));
                $results['chat_updates'] = array_map('intval', $updatedChatIds);
            }
        } catch (\Throwable $e) {
            error_log("poll_updates: messages query error: " . $e->getMessage());
        }
    }

    // ── 2. Typing indicators ────────────────────────────────
    if (!empty($chatIds)) {
        try {
            $ph2 = implode(',', array_fill(0, count($chatIds), '?'));
            $typStmt = $db->prepare(
                "SELECT u.id AS user_id, u.signal_id, u.nickname, u.avatar_url, u.typing_chat_id
                 FROM users u
                 WHERE u.typing_chat_id IN ($ph2)
                   AND u.id != ?
                   AND u.typing_at > DATE_SUB(NOW(), INTERVAL 5 SECOND)"
            );
            $typStmt->execute(array_merge($chatIds, [$uid]));
            $typingRows = $typStmt->fetchAll();
            if (!empty($typingRows)) {
                $hasData = true;
                $results['typing'] = array_map(fn($t) => [
                    'user_id'     => (int) $t['user_id'],
                    'chat_id'     => (int) $t['typing_chat_id'],
                    'signal_id'   => $t['signal_id'],
                    'nickname'    => $t['nickname'],
                ], $typingRows);
            }
        } catch (\Throwable $e) {
            error_log("poll_updates: typing columns missing or error: " . $e->getMessage());
        }
    }

    // ── 3. Call signals ────────────────────────────────────
    if ($currentMaxCallId > $lastCall) {
        try {
            $sigStmt = $db->prepare(
                'SELECT id, sender_id, type, payload, UNIX_TIMESTAMP(created_at) AS created_at
                 FROM call_signals
                 WHERE target_id = ? AND id > ?
                 AND UNIX_TIMESTAMP(created_at) > ?
                 ORDER BY id ASC LIMIT 10'
            );
            $sigStmt->execute([$uid, $lastCall, time() - 120]);
            $signals = $sigStmt->fetchAll();
            if (!empty($signals)) {
                $hasData = true;
                $results['call_signals'] = array_map(fn($s) => [
                    'id'         => (int) $s['id'],
                    'sender_id'  => (int) $s['sender_id'],
                    'type'       => $s['type'],
                    'payload'    => $s['payload'],
                    'created_at' => (int) $s['created_at'],
                ], $signals);
            }
        } catch (\Throwable $e) {
            error_log("poll_updates: call_signals query error: " . $e->getMessage());
        }
    }

    // ── Return if data found ────────────────────────────────
    if ($hasData) {
        json_ok([
            'now'           => time(),
            'messages'      => $results['messages'],
            'chat_updates'  => $results['chat_updates'],
            'typing'        => $results['typing'],
            'call_signals'  => $results['call_signals'],
            'last_call_id'  => max($currentMaxCallId, $lastCall),
        ]);
    }

    // ── Check timeout ───────────────────────────────────────
    if (time() - $start >= $maxWait) {
        json_ok([
            'now'           => time(),
            'messages'      => [],
            'chat_updates'  => [],
            'typing'        => [],
            'call_signals'  => [],
            'last_call_id'  => $currentMaxCallId,
        ]);
    }

    // ── Sleep and retry (check every 0.5s) ─────────────────
    usleep(500000); // 500ms
}

<?php
// GET /api/get_channel_messages?channel_id=X&limit=50&after_id=0&before_id=0&init=0
// Header: Authorization: Bearer <token>
// Response: { messages: [...], last_read_id? }
declare(strict_types=1);
require_once __DIR__ . '/../helpers.php';

set_cors_headers();
if ($_SERVER['REQUEST_METHOD'] !== 'GET') json_err('method_not_allowed', 'Только GET', 405);

try {
$me       = auth_user();
$uid      = (int) $me['id'];
$channelId = (int) ($_GET['channel_id'] ?? 0);
$afterId  = (int) ($_GET['after_id'] ?? 0);
$beforeId = (int) ($_GET['before_id'] ?? 0);
$limit    = min(max((int) ($_GET['limit'] ?? 50), 1), 100);
$isInit   = ($_GET['init'] ?? '0') === '1';
$markRead = ($_GET['mark_read'] ?? '0') === '1';

if ($channelId <= 0) json_err('invalid_id', 'Некорректный channel_id');

$db = db();

// Check membership
$stmt = $db->prepare(
    'SELECT cm.role FROM channel_members cm JOIN channels c ON c.id = cm.channel_id WHERE cm.channel_id = ? AND cm.user_id = ? LIMIT 1'
);
$stmt->execute([$channelId, $uid]);
$membership = $stmt->fetch();

if (!$membership) {
    // Allow for public channels (view-only)
    $pubStmt = $db->prepare('SELECT id FROM channels WHERE id = ? AND type = ? LIMIT 1');
    $pubStmt->execute([$channelId, 'public']);
    if (!$pubStmt->fetch()) json_err('forbidden', 'Нет доступа к этому каналу', 403);
} elseif ($markRead) {
    // Update last_read_message_id
    if ($afterId > 0) {
        $db->prepare('UPDATE channel_members SET last_read_message_id = ? WHERE channel_id = ? AND user_id = ?')
            ->execute([$afterId, $channelId, $uid]);
    }
}

// ── Fetch messages ─────────────────────────────────────────────
$messages = [];

if ($isInit) {
    // Initial load: get latest N messages
    $stmt = $db->prepare(
        'SELECT m.id, m.sender_id, m.body, m.media_url, m.media_type, m.media_spoiler,
                m.batch_id, m.reply_to, m.media_file_name, m.media_file_size,
                m.sent_at, m.is_edited, m.views_count, m.comments_count,
                (SELECT COUNT(*) FROM channel_messages cm2 WHERE cm2.reply_to = m.id AND cm2.is_deleted = 0) AS replies_count,
                u.nickname AS sender_name, u.avatar_url AS sender_avatar
         FROM channel_messages m
         JOIN users u ON u.id = m.sender_id
         WHERE m.channel_id = ? AND m.is_deleted = 0
         ORDER BY m.sent_at DESC LIMIT ?'
    );
    $stmt->execute([$channelId, $limit]);
    $messages = array_reverse($stmt->fetchAll());
} elseif ($beforeId > 0) {
    // Pagination: older messages
    $stmt = $db->prepare(
        'SELECT m.id, m.sender_id, m.body, m.media_url, m.media_type, m.media_spoiler,
                m.batch_id, m.reply_to, m.media_file_name, m.media_file_size,
                m.sent_at, m.is_edited, m.views_count, m.comments_count,
                (SELECT COUNT(*) FROM channel_messages cm2 WHERE cm2.reply_to = m.id AND cm2.is_deleted = 0) AS replies_count,
                u.nickname AS sender_name, u.avatar_url AS sender_avatar
         FROM channel_messages m
         JOIN users u ON u.id = m.sender_id
         WHERE m.channel_id = ? AND m.is_deleted = 0 AND m.id < ?
         ORDER BY m.id DESC LIMIT ?'
    );
    $stmt->execute([$channelId, $beforeId, $limit]);
    $messages = array_reverse($stmt->fetchAll());
} else {
    // New messages after after_id
    $stmt = $db->prepare(
        'SELECT m.id, m.sender_id, m.body, m.media_url, m.media_type, m.media_spoiler,
                m.batch_id, m.reply_to, m.media_file_name, m.media_file_size,
                m.sent_at, m.is_edited, m.views_count, m.comments_count,
                (SELECT COUNT(*) FROM channel_messages cm2 WHERE cm2.reply_to = m.id AND cm2.is_deleted = 0) AS replies_count,
                u.nickname AS sender_name, u.avatar_url AS sender_avatar
         FROM channel_messages m
         JOIN users u ON u.id = m.sender_id
         WHERE m.channel_id = ? AND m.is_deleted = 0 AND m.id > ?
         ORDER BY m.sent_at ASC LIMIT ?'
    );
    $stmt->execute([$channelId, $afterId, $limit]);
    $messages = $stmt->fetchAll();
}

// ── Increment views_count for fetched messages ──────────────────
// Use unique views: only count if this user hasn't viewed this message before
if (!empty($messages) && $membership) {
    try {
        $ids = array_column($messages, 'id');
        
        // Find which messages the user has already viewed
        $ph = implode(',', array_fill(0, count($ids), '?'));
        $stmt = $db->prepare("SELECT message_id FROM channel_message_views WHERE user_id = ? AND message_id IN ($ph)");
        $stmt->execute(array_merge([$uid], $ids));
        $viewedIds = array_column($stmt->fetchAll(), 'message_id');
        
        // Filter to only unviewed messages
        $unviewedIds = array_diff($ids, $viewedIds);
        
        if (!empty($unviewedIds)) {
            // Insert view records for unviewed messages
            $insertStmt = $db->prepare('INSERT IGNORE INTO channel_message_views (user_id, message_id) VALUES (?, ?)');
            foreach ($unviewedIds as $mid) {
                $insertStmt->execute([$uid, $mid]);
            }
            
            // Increment views_count only for newly viewed messages
            $ph2 = implode(',', array_fill(0, count($unviewedIds), '?'));
            $db->prepare("UPDATE channel_messages SET views_count = views_count + 1 WHERE id IN ($ph2)")
                ->execute(array_values($unviewedIds));
        }
    } catch (\Throwable $e) {
        // channel_message_views table may not exist yet — skip views tracking
        error_log('get_channel_messages views tracking error (non-fatal): ' . $e->getMessage());
    }
}

// ── Reactions ──────────────────────────────────────────────────
$reactionsMap = [];
if (!empty($messages)) {
    try {
        $ids = array_column($messages, 'id');
        $ph  = implode(',', array_fill(0, count($ids), '?'));
        $stmt2 = $db->prepare(
            "SELECT message_id, emoji, COUNT(*) AS cnt,
                    SUM(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS by_me
             FROM channel_reactions
             WHERE message_id IN ($ph)
             GROUP BY message_id, emoji
             ORDER BY cnt DESC, emoji"
        );
        $stmt2->execute(array_merge([$uid], $ids));
        foreach ($stmt2->fetchAll() as $r) {
            $reactionsMap[$r['message_id']][] = [
                'emoji' => $r['emoji'],
                'count' => (int) $r['cnt'],
                'by_me' => (bool) $r['by_me'],
            ];
        }
    } catch (\Throwable $e) {
        // channel_reactions table may not exist yet — skip reactions
        error_log('get_channel_messages reactions error (non-fatal): ' . $e->getMessage());
    }
}

// ── Last commenters (for inline comment footer) ──────────────
$commentersMap = [];
if (!empty($messages)) {
    try {
        $ids = array_column($messages, 'id');
        $ph  = implode(',', array_fill(0, count($ids), '?'));
        // Get last 3 unique commenters per message, ordered by their latest comment
        $stmt3 = $db->prepare(
            "SELECT sub.message_id, sub.sender_id, u.nickname AS sender_name, u.avatar_url AS sender_avatar
             FROM (
                 SELECT message_id, sender_id, MAX(sent_at) AS last_at
                 FROM channel_comments
                 WHERE message_id IN ($ph) AND is_deleted = 0
                 GROUP BY message_id, sender_id
             ) sub
             JOIN users u ON u.id = sub.sender_id
             ORDER BY sub.message_id, sub.last_at DESC"
        );
        $stmt3->execute(array_values($ids));
        foreach ($stmt3->fetchAll() as $c) {
            $mid = (int) $c['message_id'];
            if (!isset($commentersMap[$mid])) $commentersMap[$mid] = [];
            if (count($commentersMap[$mid]) < 3) {
                // Avoid duplicate sender_ids
                if (!in_array((int) $c['sender_id'], array_column($commentersMap[$mid], 'sender_id'))) {
                    $commentersMap[$mid][] = [
                        'sender_id'     => (int) $c['sender_id'],
                        'sender_name'   => $c['sender_name'] ?? '',
                        'sender_avatar' => $c['sender_avatar'] ?? null,
                    ];
                }
            }
        }
    } catch (\Throwable $e) {
        error_log('get_channel_messages commenters error (non-fatal): ' . $e->getMessage());
    }
}

// ── last_read_id ──────────────────────────────────────────────
$lastReadId = null;
if ($membership) {
    $lrStmt = $db->prepare('SELECT last_read_message_id FROM channel_members WHERE channel_id = ? AND user_id = ? LIMIT 1');
    $lrStmt->execute([$channelId, $uid]);
    $lastReadId = (int) ($lrStmt->fetchColumn() ?: 0);
    if ($lastReadId <= 0) $lastReadId = null;
}

// ── Normalize ─────────────────────────────────────────────────
$messages = array_map(function ($m) use ($reactionsMap, $commentersMap) {
    return [
        'id'               => (int) $m['id'],
        'sender_id'        => (int) $m['sender_id'],
        'sender_name'      => $m['sender_name'] ?? '',
        'sender_avatar'    => $m['sender_avatar'] ?? null,
        'body'             => $m['body'],
        'media_url'        => $m['media_url']        ?? null,
        'media_type'       => $m['media_type']       ?? null,
        'media_spoiler'    => (int) ($m['media_spoiler'] ?? 0),
        'batch_id'         => $m['batch_id']         ?? null,
        'reply_to'         => isset($m['reply_to']) ? (int) $m['reply_to'] : null,
        'media_file_name'  => $m['media_file_name']  ?? null,
        'media_file_size'  => isset($m['media_file_size']) ? (int) $m['media_file_size'] : null,
        'sent_at'          => (int) $m['sent_at'],
        'is_edited'        => (int) $m['is_edited'],
        'views_count'      => (int) $m['views_count'],
        'comments_count'   => (int) ($m['comments_count'] ?? 0),
        'replies_count'   => (int) ($m['replies_count'] ?? 0),
        'last_commenters'  => $commentersMap[$m['id']] ?? [],
        'reactions'        => $reactionsMap[$m['id']] ?? [],
    ];
}, $messages);

json_ok([
    'messages'     => $messages,
    'last_read_id' => $lastReadId,
]);

} catch (\Throwable $e) {
    error_log('get_channel_messages error: ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
    json_err('server_error', 'Ошибка загрузки сообщений: ' . $e->getMessage(), 500);
}

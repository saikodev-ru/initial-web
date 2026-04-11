<?php
// GET /api/get_messages?chat_id=5&after_id=100&limit=50
// GET /api/get_messages?chat_id=5&init=1&limit=50          — начальная загрузка (последние N)
// GET /api/get_messages?chat_id=5&after_id=X&check_ids=1,2 — + проверка удалённых
// Header: Authorization: Bearer <token>
declare(strict_types=1);
require_once __DIR__ . '/helpers.php';

set_cors_headers();
if ($_SERVER['REQUEST_METHOD'] !== 'GET') json_err('method_not_allowed', 'Только GET', 405);

$me       = auth_user();
$chatId   = (int) ($_GET['chat_id'] ?? 0);
$afterId  = (int) ($_GET['after_id'] ?? 0);
$beforeId = (int) ($_GET['before_id'] ?? 0);
$limit    = min(max((int) ($_GET['limit'] ?? 50), 1), 100);
$isInit   = ($_GET['init'] ?? '0') === '1';
$markRead = ($_GET['mark_read'] ?? '0') === '1';

$skipChats = ($_GET['skip_chats'] ?? '0') === '1';
$rawCheck = trim($_GET['check_ids'] ?? '');

// Валидация check_ids: только цифры и запятые, максимум 200
if ($rawCheck !== '' && preg_match('/^[0-9,]+$/', $rawCheck) && mb_strlen($rawCheck) <= 2000) {
    $checkIds = array_values(array_unique(array_filter(
        array_map('intval', explode(',', $rawCheck)),
        fn($id) => $id > 0
    )));
    $checkIds = array_slice($checkIds, 0, 200); // Максимум 200 ID для проверки
} else {
    $checkIds = [];
}

// ════════════════════════════════════════════════════════════
//  ЛЕНИВОЕ СОЗДАНИЕ СИСТЕМНЫХ ЧАТОВ
//  Вызывается один раз при загрузке списка чатов (chat_id=0).
//  Создаёт «Избранное» и чат @signal для существующих пользователей,
//  у которых они ещё не были созданы при регистрации.
// ════════════════════════════════════════════════════════════
function ensure_special_chats(int $uid): void
{
    $pdo = db();

    // ── 1. «Избранное» (user_a = user_b = uid) ──────────────
    $stmt = $pdo->prepare(
        'SELECT id FROM chats WHERE is_saved_msgs = 1 AND user_a = ? LIMIT 1'
    );
    $stmt->execute([$uid]);
    if (!$stmt->fetch()) {
        $pdo->prepare(
            'INSERT INTO chats (user_a, user_b, is_saved_msgs, is_protected, created_at)
             VALUES (?, ?, 1, 1, NOW())'
        )->execute([$uid, $uid]);
    }

    // ── 2. Чат с @signal ────────────────────────────────────
    $sys = $pdo->prepare(
        "SELECT id FROM users WHERE is_system = 1 AND signal_id = 'initial' LIMIT 1"
    );
    $sys->execute();
    $sysRow = $sys->fetch();
    if (!$sysRow) return;

    $sysId = (int) $sysRow['id'];

    $chat = $pdo->prepare(
        'SELECT id FROM chats
         WHERE is_protected = 1
           AND (
               (user_a = ? AND user_b = ?)
            OR (user_a = ? AND user_b = ?)
           )
         LIMIT 1'
    );
    $chat->execute([$sysId, $uid, $uid, $sysId]);
    if (!$chat->fetch()) {
        $pdo->prepare(
            'INSERT INTO chats (user_a, user_b, is_protected, created_at)
             VALUES (?, ?, 1, NOW())'
        )->execute([$sysId, $uid]);

        $newChatId = (int) $pdo->lastInsertId();

        $welcome = implode("\n", [
            '**Добро пожаловать в Initial!**',
            '',
            'Здесь вы будете получать уведомления безопасности — например, о входе с нового устройства или IP-адреса.',
            '',
            'Если вы видите уведомление о действии, которое не совершали — немедленно завершите все сеансы в настройках аккаунта.',
        ]);

        $pdo->prepare(
            'INSERT INTO messages (chat_id, sender_id, body, sent_at, is_read)
             VALUES (?, ?, ?, NOW(), 0)'
        )->execute([$newChatId, $sysId, $welcome]);
    }
}

// ════════════════════════════════════════════════════════════
//  ЗАГРУЗКА СПИСКА ЧАТОВ
//  Оптимизировано: одно JOIN с последним сообщением вместо
//  4+ коррелированных подзапросов на каждый чат.
// ════════════════════════════════════════════════════════════
function fetch_chats(int $uid): array {
    $db = db();

    // Подзапрос: последнее сообщение для каждого чата (один скан вместо N)
    $lastMsgSql = "
        SELECT chat_id, body, media_type, sender_id, UNIX_TIMESTAMP(sent_at) AS sent_ts
        FROM messages
        WHERE is_deleted = 0
          AND id IN (
              SELECT MAX(id) FROM messages
              WHERE is_deleted = 0
              GROUP BY chat_id
          )
    ";

    // Подзапрос: кол-во непрочитанных для каждого чата
    $unreadSql = "
        SELECT chat_id, COUNT(*) AS cnt
        FROM messages
        WHERE sender_id != ? AND is_read = 0 AND is_deleted = 0
        GROUP BY chat_id
    ";

    $stmt = $db->prepare(
        "SELECT
            c.id          AS chat_id,
            c.is_pinned,
            c.pin_order,
            c.is_protected,
            c.is_saved_msgs,

            IF(c.user_a = ?, ub.id,         ua.id)         AS partner_id,
            IF(c.user_a = ?, ub.nickname,   ua.nickname)   AS partner_name,
            IF(c.user_a = ?, ub.signal_id,  ua.signal_id)  AS partner_signal_id,
            IF(c.user_a = ?, ub.avatar_url, ua.avatar_url) AS partner_avatar,
            IF(c.user_a = ?, ub.bio,        ua.bio)        AS partner_bio,
            IF(c.user_a = ?, ub.last_seen,  ua.last_seen)  AS partner_last_seen,
            IF(c.user_a = ?,
                (ub.typing_chat_id = c.id AND ub.typing_at > DATE_SUB(NOW(), INTERVAL 5 SECOND)),
                (ua.typing_chat_id = c.id AND ua.typing_at > DATE_SUB(NOW(), INTERVAL 5 SECOND))
            ) AS partner_is_typing,

            IF(c.user_a = ?, ub.is_verified, ua.is_verified) AS partner_is_verified,
            IF(c.user_a = ?, ub.is_system,   ua.is_system)   AS partner_is_system,
            IF(c.user_a = ?, ub.is_team_signal, ua.is_team_signal) AS partner_is_team_signal,

            lm.body           AS last_message,
            lm.media_type     AS last_media_type,
            lm.sender_id      AS last_sender_id,
            lm.sent_ts        AS last_time,
            COALESCE(unr.cnt, 0) AS unread_count

         FROM chats c
         JOIN users ua ON ua.id = c.user_a
         JOIN users ub ON ub.id = c.user_b
         LEFT JOIN ({$lastMsgSql}) lm ON lm.chat_id = c.id
         LEFT JOIN ({$unreadSql}) unr ON unr.chat_id = c.id
         WHERE c.user_a = ? OR c.user_b = ?
         ORDER BY
            c.is_pinned DESC,
            c.pin_order DESC,
            lm.sent_ts DESC"
    );

    $stmt->execute([
        // 10× IF(c.user_a = ?, ...)
        $uid, $uid, $uid, $uid, $uid,
        $uid, $uid, $uid, $uid, $uid,
        // $unreadSql: sender_id != ?
        $uid,
        // WHERE c.user_a = ? OR c.user_b = ?
        $uid, $uid,
    ]);

    $rows = $stmt->fetchAll();

    return array_map(fn($c) => [
        'chat_id'                  => (int)  $c['chat_id'],
        'partner_id'               => (int)  $c['partner_id'],
        'partner_name'             =>        $c['partner_name']     ?? '',
        'partner_signal_id'        =>        $c['partner_signal_id'] ?? null,
        'partner_avatar'           =>        $c['partner_avatar'] ?? null,
        'partner_bio'              =>        $c['partner_bio']     ?? '',
        'partner_last_seen'        => ($c['partner_last_seen'] !== null && $c['partner_last_seen'] !== '')
                                      ? (int) $c['partner_last_seen'] : null,
        'partner_is_typing'        => (int) (bool) ($c['partner_is_typing'] ?? 0),
        'partner_is_verified'      => (int) (bool) ($c['partner_is_verified'] ?? 0),
        'partner_is_system'        => (int) (bool) ($c['partner_is_system'] ?? 0),
        'partner_is_team_signal'   => (int) (bool) ($c['partner_is_team_signal'] ?? 0),
        'unread_count'             => (int)  ($c['unread_count'] ?? 0),
        'last_message'             =>        $c['last_message'] ?? null,
        'last_media_type'          =>        $c['last_media_type'] ?? null,
        'last_time'                => isset($c['last_time'])      ? (int) $c['last_time']      : null,
        'last_sender_id'           => isset($c['last_sender_id']) ? (int) $c['last_sender_id'] : null,
        'is_pinned'                => (int)  ($c['is_pinned']    ?? 0),
        'pin_order'                => (int)  ($c['pin_order']    ?? 0),
        'is_protected'             => (int)  ($c['is_protected']  ?? 0),
        'is_saved_msgs'            => (int)  ($c['is_saved_msgs'] ?? 0),
    ], $rows);
}

// ── chat_id = 0 → список чатов ────────────────────────────────
if ($chatId <= 0) {
    ensure_special_chats((int) $me['id']);
    json_ok([
        'messages'    => [],
        'chats'       => fetch_chats((int) $me['id']),
        'last_read_id'=> 0,
        'has_more'    => false,
        'deleted_ids' => [],
    ]);
}

// ── Проверить доступ к чату ────────────────────────────────────
$stmt = db()->prepare('SELECT id FROM chats WHERE id = ? AND (user_a = ? OR user_b = ?) LIMIT 1');
$stmt->execute([$chatId, $me['id'], $me['id']]);
if (!$stmt->fetch()) json_err('forbidden', 'Нет доступа к этому чату', 403);

// ── Обновить last_seen, а прочитанными отмечать только по явному флагу ──
db()->prepare('UPDATE users SET last_seen = UNIX_TIMESTAMP() WHERE id = ?')
    ->execute([$me['id']]);

if ($markRead) {
    db()->prepare(
        'UPDATE messages SET is_read = 1
         WHERE chat_id = ? AND sender_id != ? AND is_read = 0 AND is_deleted = 0'
    )->execute([$chatId, $me['id']]);
}

// ── Загрузка сообщений ────────────────────────────────────────
$messages = [];

if ($isInit) {
    $stmt = db()->prepare(
        'SELECT m.id, m.sender_id, m.body, m.is_read, m.reply_to, m.is_edited,
                m.media_url, m.media_type, m.media_spoiler, m.batch_id,
                m.voice_duration, m.voice_waveform,
                UNIX_TIMESTAMP(m.sent_at) AS sent_at,
                u.nickname, u.signal_id, u.avatar_url, u.is_team_signal
         FROM messages m
         JOIN users u ON u.id = m.sender_id
         WHERE m.chat_id = ? AND m.is_deleted = 0
         ORDER BY m.sent_at DESC LIMIT ?'
    );
    $stmt->execute([$chatId, $limit]);
    $messages = array_reverse($stmt->fetchAll());
} elseif ($beforeId > 0) {
    $stmt = db()->prepare(
        'SELECT m.id, m.sender_id, m.body, m.is_read, m.reply_to, m.is_edited,
                m.media_url, m.media_type, m.media_spoiler, m.batch_id,
                m.voice_duration, m.voice_waveform,
                UNIX_TIMESTAMP(m.sent_at) AS sent_at,
                u.nickname, u.signal_id, u.avatar_url, u.is_team_signal
         FROM messages m
         JOIN users u ON u.id = m.sender_id
         WHERE m.chat_id = ? AND m.is_deleted = 0
           AND m.id < ?
         ORDER BY m.id DESC LIMIT ?'
    );
    $stmt->execute([$chatId, $beforeId, $limit]);
    $messages = array_reverse($stmt->fetchAll());
} else {
    $stmt = db()->prepare(
        'SELECT m.id, m.sender_id, m.body, m.is_read, m.reply_to, m.is_edited,
                m.media_url, m.media_type, m.media_spoiler, m.batch_id,
                m.voice_duration, m.voice_waveform,
                UNIX_TIMESTAMP(m.sent_at) AS sent_at,
                u.nickname, u.signal_id, u.avatar_url, u.is_team_signal,
                (m.id <= ? AND m.is_edited = 1) AS patch_only
         FROM messages m
         JOIN users u ON u.id = m.sender_id
         WHERE m.chat_id = ? AND m.is_deleted = 0
         AND (
             m.id > ?
             OR (m.is_edited = 1 AND m.updated_at > DATE_SUB(NOW(), INTERVAL 30 MINUTE))
         )
         ORDER BY m.sent_at ASC LIMIT ?'
    );
    $stmt->execute([$afterId, $chatId, $afterId, $limit]);
    $messages = $stmt->fetchAll();
}

// ── Обнаружение удалённых ─────────────────────────────────────
$deletedIds = [];
if (!empty($checkIds)) {
    $ph  = implode(',', array_fill(0, count($checkIds), '?'));
    $stEx = db()->prepare("SELECT id FROM messages WHERE id IN ($ph)");
    $stEx->execute($checkIds);
    $existingIds = array_map('intval', array_column($stEx->fetchAll(), 'id'));
    $deletedIds  = array_values(array_diff($checkIds, $existingIds));
}

// ── Реакции ───────────────────────────────────────────────────
$reactionsMap = [];
if (!empty($messages)) {
    $ids = array_column($messages, 'id');
    $ph  = implode(',', array_fill(0, count($ids), '?'));
    $stmt2 = db()->prepare(
        "SELECT message_id, emoji, COUNT(*) AS cnt,
                SUM(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS by_me
         FROM message_reactions
         WHERE message_id IN ($ph)
         GROUP BY message_id, emoji
         ORDER BY cnt DESC, emoji"
    );
    $stmt2->execute(array_merge([(int) $me['id']], $ids));
    foreach ($stmt2->fetchAll() as $r) {
        $reactionsMap[$r['message_id']][] = [
            'emoji' => $r['emoji'],
            'count' => (int)   $r['cnt'],
            'by_me' => (bool)  $r['by_me'],
        ];
    }
}

// ── last_read_id ──────────────────────────────────────────────
$stmtLR = db()->prepare(
    'SELECT MAX(id) FROM messages WHERE chat_id = ? AND sender_id = ? AND is_read = 1 AND is_deleted = 0'
);
$stmtLR->execute([$chatId, $me['id']]);
$lastReadId = (int) ($stmtLR->fetchColumn() ?: 0);

// ── Нормализация ──────────────────────────────────────────────
$messages = array_map(fn($m) => [
    'id'           => (int)  $m['id'],
    'sender_id'    => (int)  $m['sender_id'],
    'sent_at'      => (int)  $m['sent_at'],
    'body'         =>        $m['body'],
    'is_read'      => (int)  $m['is_read'],
    'is_edited'    => (int)  $m['is_edited'],
    'is_team_signal' => (int) ($m['is_team_signal'] ?? 0),
    'reply_to'     => isset($m['reply_to'])     ? (int)  $m['reply_to']    : null,
    'media_url'    => $m['media_url']            ?? null,
    'media_type'   => $m['media_type']           ?? null,
    'media_spoiler'=> (int) ($m['media_spoiler'] ?? 0),
    'batch_id'        => $m['batch_id']             ?? null,
    'voice_duration'   => isset($m['voice_duration'])   ? (int) $m['voice_duration']   : null,
    'voice_waveform'   => $m['voice_waveform']         ?? null,
    'patch_only'       => (bool)($m['patch_only']        ?? false),
    'reactions'        => $reactionsMap[$m['id']]   ?? [],
    'sender_signal_id' => $m['signal_id']           ?? '',
    'sender_name'      => $m['nickname']            ?? '',
    'sender_avatar'    => $m['avatar_url']          ?? null,
], $messages);

json_ok([
    'messages'     => $messages,
    'chats'        => $skipChats ? [] : fetch_chats((int) $me['id']),
    'last_read_id' => $lastReadId,
    'has_more'     => count($messages) === $limit,
    'deleted_ids'  => $deletedIds,
]);

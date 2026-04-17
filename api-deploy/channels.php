<?php
// Channels & Hubs API
// Handles: CRUD for channels/hubs, subscribe/unsubscribe, send/list messages
declare(strict_types=1);
require_once __DIR__ . '/helpers.php';

set_cors_headers();

$me   = auth_user();
$uid  = (int) $me['id'];
$data = input();
$action = $data['action'] ?? ($_GET['action'] ?? '');

// ── Helper: sanitize string ──────────────────────────────────
function ch_sanitize(string $s, int $max = 100): string {
    return trim(mb_substr($s, 0, $max));
}

// ── Helper: generate unique signal_id for channel/hub ────────
function ch_generate_signal_id(string $prefix, string $name): string {
    $base = transliterate_ru($name);
    $base = preg_replace('/[^a-z0-9_]/', '_', strtolower($base));
    $base = preg_replace('/_+/', '_', $base);
    $base = trim($base, '_');
    if (strlen($base) < 3) $base = $prefix . '_' . bin2hex(random_bytes(3));
    // Check uniqueness, append number if needed
    $col = $prefix === 'ch' ? 'channels' : 'hubs';
    $orig = $base;
    $i = 0;
    while (true) {
        $check = $i === 0 ? $orig : $orig . '_' . $i;
        $stmt = db()->prepare("SELECT id FROM {$col} WHERE signal_id = ? LIMIT 1");
        $stmt->execute([$check]);
        if (!$stmt->fetch()) return $check;
        $i++;
    }
}

// Simple transliteration for Russian → Latin
function transliterate_ru(string $s): string {
    $map = [
        'а'=>'a','б'=>'b','в'=>'v','г'=>'g','д'=>'d','е'=>'e','ё'=>'yo','ж'=>'zh',
        'з'=>'z','и'=>'i','й'=>'y','к'=>'k','л'=>'l','м'=>'m','н'=>'n','о'=>'o',
        'п'=>'p','р'=>'r','с'=>'s','т'=>'t','у'=>'u','ф'=>'f','х'=>'kh','ц'=>'ts',
        'ч'=>'ch','ш'=>'sh','щ'=>'shch','ъ'=>'','ы'=>'y','ь'=>'','э'=>'e','ю'=>'yu','я'=>'ya',
        'А'=>'A','Б'=>'B','В'=>'V','Г'=>'G','Д'=>'D','Е'=>'E','Ё'=>'Yo','Ж'=>'Zh',
        'З'=>'Z','И'=>'I','Й'=>'Y','К'=>'K','Л'=>'L','М'=>'M','Н'=>'N','О'=>'O',
        'П'=>'P','Р'=>'R','С'=>'S','Т'=>'T','У'=>'U','Ф'=>'F','Х'=>'Kh','Ц'=>'Ts',
        'Ч'=>'Ch','Ш'=>'Sh','Щ'=>'Shch','Ъ'=>'','Ы'=>'Y','Ь'=>'','Э'=>'E','Ю'=>'Yu','Я'=>'Ya',
    ];
    return strtr($s, $map);
}

// ══════════════════════════════════════════════════════════════
//  ROUTING
// ══════════════════════════════════════════════════════════════

switch ($action) {

    // ──────────────────────────────────────────────────────────
    //  CREATE CHANNEL
    // ──────────────────────────────────────────────────────────
    case 'create_channel':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_err('method_not_allowed', 'Только POST', 405);

        $name    = ch_sanitize($data['name'] ?? '', 100);
        $desc    = ch_sanitize($data['description'] ?? '', 500);
        $hubId   = isset($data['hub_id']) ? (int) $data['hub_id'] : null;
        $isPublic = !empty($data['is_public']) ? 1 : 0;
        $customSid = ch_sanitize($data['signal_id'] ?? '', 50);

        if (mb_strlen($name) < 2) json_err('invalid_name', 'Название канала — минимум 2 символа');

        // If hub specified, check user is admin/owner
        if ($hubId) {
            $stmt = db()->prepare('SELECT id FROM hub_members WHERE hub_id = ? AND user_id = ? AND role IN ("owner","admin") LIMIT 1');
            $stmt->execute([$hubId, $uid]);
            if (!$stmt->fetch()) json_err('forbidden', 'Вы не админ этого хаба', 403);
        }

        // Generate signal_id
        if ($customSid) {
            $customSid = preg_replace('/[^a-z0-9_]/', '', strtolower($customSid));
            if (strlen($customSid) < 3) json_err('invalid_signal_id', 'Signal ID — минимум 3 символа (латиница, цифры, _)');
            $stmt = db()->prepare('SELECT id FROM channels WHERE signal_id = ? LIMIT 1');
            $stmt->execute([$customSid]);
            if ($stmt->fetch()) json_err('signal_id_taken', 'Этот Signal ID уже занят');
            $sid = $customSid;
        } else {
            $sid = ch_generate_signal_id('ch', $name);
        }

        $stmt = db()->prepare(
            'INSERT INTO channels (hub_id, name, description, owner_id, signal_id, is_public) VALUES (?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute([$hubId, $name, $desc, $uid, $sid, $isPublic]);
        $channelId = (int) db()->lastInsertId();

        // Auto-subscribe owner
        db()->prepare('INSERT INTO channel_subscribers (channel_id, user_id, role) VALUES (?, ?, "owner")')
            ->execute([$channelId, $uid]);

        // If hub, auto-add channel to hub_members as visible
        if ($hubId) {
            // Nothing extra needed — channel.hub_id links it
        }

        json_ok(['channel' => [
            'id' => $channelId,
            'name' => $name,
            'description' => $desc,
            'signal_id' => $sid,
            'hub_id' => $hubId,
            'owner_id' => $uid,
            'is_public' => $isPublic,
            'subscriber_count' => 1,
            'is_admin' => true,
        ]], 201);
        break;

    // ──────────────────────────────────────────────────────────
    //  CREATE HUB
    // ──────────────────────────────────────────────────────────
    case 'create_hub':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_err('method_not_allowed', 'Только POST', 405);

        $name    = ch_sanitize($data['name'] ?? '', 100);
        $desc    = ch_sanitize($data['description'] ?? '', 500);
        $isPublic = !empty($data['is_public']) ? 1 : 0;
        $customSid = ch_sanitize($data['signal_id'] ?? '', 50);

        if (mb_strlen($name) < 2) json_err('invalid_name', 'Название хаба — минимум 2 символа');

        if ($customSid) {
            $customSid = preg_replace('/[^a-z0-9_]/', '', strtolower($customSid));
            if (strlen($customSid) < 3) json_err('invalid_signal_id', 'Signal ID — минимум 3 символа');
            $stmt = db()->prepare('SELECT id FROM hubs WHERE signal_id = ? LIMIT 1');
            $stmt->execute([$customSid]);
            if ($stmt->fetch()) json_err('signal_id_taken', 'Этот Signal ID уже занят');
            $sid = $customSid;
        } else {
            $sid = ch_generate_signal_id('hub', $name);
        }

        $stmt = db()->prepare(
            'INSERT INTO hubs (name, description, owner_id, signal_id, is_public) VALUES (?, ?, ?, ?, ?)'
        );
        $stmt->execute([$name, $desc, $uid, $sid, $isPublic]);
        $hubId = (int) db()->lastInsertId();

        // Auto-add owner as member
        db()->prepare('INSERT INTO hub_members (hub_id, user_id, role) VALUES (?, ?, "owner")')
            ->execute([$hubId, $uid]);

        json_ok(['hub' => [
            'id' => $hubId,
            'name' => $name,
            'description' => $desc,
            'signal_id' => $sid,
            'owner_id' => $uid,
            'is_public' => $isPublic,
            'member_count' => 1,
            'channel_count' => 0,
            'is_admin' => true,
        ]], 201);
        break;

    // ──────────────────────────────────────────────────────────
    //  LIST MY HUBS & CHANNELS (for sidebar panel)
    // ──────────────────────────────────────────────────────────
    case 'list':
        if ($_SERVER['REQUEST_METHOD'] !== 'GET') json_err('method_not_allowed', 'Только GET', 405);

        // My hubs
        $stmt = db()->prepare(
            'SELECT h.id, h.name, h.description, h.avatar_url, h.signal_id, h.is_public,
                    hm.role AS my_role,
                    (SELECT COUNT(*) FROM hub_members WHERE hub_id = h.id) AS member_count,
                    (SELECT COUNT(*) FROM channels WHERE hub_id = h.id) AS channel_count
             FROM hubs h
             JOIN hub_members hm ON hm.hub_id = h.id AND hm.user_id = ?
             ORDER BY h.name'
        );
        $stmt->execute([$uid]);
        $hubs = $stmt->fetchAll();

        // My channels (standalone + hub channels)
        $stmt = db()->prepare(
            'SELECT c.id, c.name, c.description, c.avatar_url, c.signal_id, c.hub_id, c.is_public, c.owner_id,
                    cs.role AS my_role,
                    (SELECT COUNT(*) FROM channel_subscribers WHERE channel_id = c.id) AS subscriber_count,
                    (SELECT COUNT(*) FROM channel_messages WHERE channel_id = c.id AND is_deleted = 0) AS message_count,
                    (SELECT cm.body FROM channel_messages cm WHERE cm.channel_id = c.id AND cm.is_deleted = 0 ORDER BY cm.sent_at DESC LIMIT 1) AS last_message,
                    (SELECT UNIX_TIMESTAMP(cm.sent_at) FROM channel_messages cm WHERE cm.channel_id = c.id AND cm.is_deleted = 0 ORDER BY cm.sent_at DESC LIMIT 1) AS last_time
             FROM channels c
             JOIN channel_subscribers cs ON cs.channel_id = c.id AND cs.user_id = ?
             ORDER BY last_time DESC'
        );
        $stmt->execute([$uid]);
        $channels = $stmt->fetchAll();

        // Public channels not yet subscribed (discover)
        $stmt = db()->prepare(
            'SELECT c.id, c.name, c.description, c.avatar_url, c.signal_id, c.hub_id, c.is_public,
                    (SELECT COUNT(*) FROM channel_subscribers WHERE channel_id = c.id) AS subscriber_count
             FROM channels c
             WHERE c.is_public = 1
               AND c.id NOT IN (SELECT channel_id FROM channel_subscribers WHERE user_id = ?)
             ORDER BY subscriber_count DESC
             LIMIT 20'
        );
        $stmt->execute([$uid]);
        $discover = $stmt->fetchAll();

        // Public hubs not yet joined (discover)
        $stmt = db()->prepare(
            'SELECT h.id, h.name, h.description, h.avatar_url, h.signal_id, h.is_public,
                    (SELECT COUNT(*) FROM hub_members WHERE hub_id = h.id) AS member_count
             FROM hubs h
             WHERE h.is_public = 1
               AND h.id NOT IN (SELECT hub_id FROM hub_members WHERE user_id = ?)
             ORDER BY member_count DESC
             LIMIT 20'
        );
        $stmt->execute([$uid]);
        $discoverHubs = $stmt->fetchAll();

        json_ok([
            'hubs' => array_map(fn($h) => [
                'id' => (int) $h['id'],
                'name' => $h['name'],
                'description' => $h['description'] ?? '',
                'avatar_url' => $h['avatar_url'],
                'signal_id' => $h['signal_id'],
                'is_public' => (int) $h['is_public'],
                'my_role' => $h['my_role'],
                'member_count' => (int) $h['member_count'],
                'channel_count' => (int) $h['channel_count'],
                'is_admin' => in_array($h['my_role'], ['owner', 'admin']),
            ], $hubs),
            'channels' => array_map(fn($c) => [
                'id' => (int) $c['id'],
                'name' => $c['name'],
                'description' => $c['description'] ?? '',
                'avatar_url' => $c['avatar_url'],
                'signal_id' => $c['signal_id'],
                'hub_id' => $c['hub_id'] ? (int) $c['hub_id'] : null,
                'is_public' => (int) $c['is_public'],
                'owner_id' => (int) $c['owner_id'],
                'my_role' => $c['my_role'],
                'subscriber_count' => (int) $c['subscriber_count'],
                'message_count' => (int) $c['message_count'],
                'last_message' => $c['last_message'],
                'last_time' => $c['last_time'] ? (int) $c['last_time'] : null,
                'is_admin' => in_array($c['my_role'], ['owner', 'admin']),
            ], $channels),
            'discover_channels' => array_map(fn($c) => [
                'id' => (int) $c['id'],
                'name' => $c['name'],
                'description' => $c['description'] ?? '',
                'avatar_url' => $c['avatar_url'],
                'signal_id' => $c['signal_id'],
                'hub_id' => $c['hub_id'] ? (int) $c['hub_id'] : null,
                'is_public' => (int) $c['is_public'],
                'subscriber_count' => (int) $c['subscriber_count'],
            ], $discover),
            'discover_hubs' => array_map(fn($h) => [
                'id' => (int) $h['id'],
                'name' => $h['name'],
                'description' => $h['description'] ?? '',
                'avatar_url' => $h['avatar_url'],
                'signal_id' => $h['signal_id'],
                'is_public' => (int) $h['is_public'],
                'member_count' => (int) $h['member_count'],
            ], $discoverHubs),
        ]);
        break;

    // ──────────────────────────────────────────────────────────
    //  GET CHANNEL INFO
    // ──────────────────────────────────────────────────────────
    case 'get_channel':
        if ($_SERVER['REQUEST_METHOD'] !== 'GET') json_err('method_not_allowed', 'Только GET', 405);

        $channelId = (int) ($_GET['channel_id'] ?? 0);
        if (!$channelId) json_err('invalid_channel', 'Укажите channel_id');

        $stmt = db()->prepare(
            'SELECT c.*, 
                    (SELECT COUNT(*) FROM channel_subscribers WHERE channel_id = c.id) AS subscriber_count,
                    (SELECT role FROM channel_subscribers WHERE channel_id = c.id AND user_id = ?) AS my_role
             FROM channels c WHERE c.id = ? LIMIT 1'
        );
        $stmt->execute([$uid, $channelId]);
        $ch = $stmt->fetch();
        if (!$ch) json_err('not_found', 'Канал не найден', 404);

        json_ok(['channel' => [
            'id' => (int) $ch['id'],
            'name' => $ch['name'],
            'description' => $ch['description'] ?? '',
            'avatar_url' => $ch['avatar_url'],
            'signal_id' => $ch['signal_id'],
            'hub_id' => $ch['hub_id'] ? (int) $ch['hub_id'] : null,
            'is_public' => (int) $ch['is_public'],
            'owner_id' => (int) $ch['owner_id'],
            'subscriber_count' => (int) $ch['subscriber_count'],
            'my_role' => $ch['my_role'],
            'is_admin' => in_array($ch['my_role'], ['owner', 'admin']),
            'is_subscribed' => !empty($ch['my_role']),
        ]]);
        break;

    // ──────────────────────────────────────────────────────────
    //  GET HUB INFO (with channels)
    // ──────────────────────────────────────────────────────────
    case 'get_hub':
        if ($_SERVER['REQUEST_METHOD'] !== 'GET') json_err('method_not_allowed', 'Только GET', 405);

        $hubId = (int) ($_GET['hub_id'] ?? 0);
        if (!$hubId) json_err('invalid_hub', 'Укажите hub_id');

        $stmt = db()->prepare(
            'SELECT h.*,
                    (SELECT COUNT(*) FROM hub_members WHERE hub_id = h.id) AS member_count,
                    (SELECT role FROM hub_members WHERE hub_id = h.id AND user_id = ?) AS my_role
             FROM hubs h WHERE h.id = ? LIMIT 1'
        );
        $stmt->execute([$uid, $hubId]);
        $hub = $stmt->fetch();
        if (!$hub) json_err('not_found', 'Хаб не найден', 404);

        // Get hub's channels
        $stmt = db()->prepare(
            'SELECT c.id, c.name, c.description, c.avatar_url, c.signal_id, c.is_public, c.owner_id,
                    (SELECT COUNT(*) FROM channel_subscribers WHERE channel_id = c.id) AS subscriber_count,
                    (SELECT role FROM channel_subscribers WHERE channel_id = c.id AND user_id = ?) AS my_ch_role
             FROM channels c WHERE c.hub_id = ?
             ORDER BY c.name'
        );
        $stmt->execute([$uid, $hubId]);
        $hubChannels = $stmt->fetchAll();

        json_ok(['hub' => [
            'id' => (int) $hub['id'],
            'name' => $hub['name'],
            'description' => $hub['description'] ?? '',
            'avatar_url' => $hub['avatar_url'],
            'signal_id' => $hub['signal_id'],
            'is_public' => (int) $hub['is_public'],
            'owner_id' => (int) $hub['owner_id'],
            'member_count' => (int) $hub['member_count'],
            'my_role' => $hub['my_role'],
            'is_admin' => in_array($hub['my_role'], ['owner', 'admin']),
            'is_member' => !empty($hub['my_role']),
            'channels' => array_map(fn($c) => [
                'id' => (int) $c['id'],
                'name' => $c['name'],
                'description' => $c['description'] ?? '',
                'avatar_url' => $c['avatar_url'],
                'signal_id' => $c['signal_id'],
                'is_public' => (int) $c['is_public'],
                'owner_id' => (int) $c['owner_id'],
                'subscriber_count' => (int) $c['subscriber_count'],
                'my_role' => $c['my_ch_role'],
                'is_admin' => in_array($c['my_ch_role'], ['owner', 'admin']),
                'is_subscribed' => !empty($c['my_ch_role']),
            ], $hubChannels),
        ]]);
        break;

    // ──────────────────────────────────────────────────────────
    //  SUBSCRIBE / UNSUBSCRIBE CHANNEL
    // ──────────────────────────────────────────────────────────
    case 'subscribe':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_err('method_not_allowed', 'Только POST', 405);

        $channelId = (int) ($data['channel_id'] ?? 0);
        if (!$channelId) json_err('invalid_channel', 'Укажите channel_id');

        // Check channel exists and is public (or user is hub member)
        $stmt = db()->prepare('SELECT id, is_public, hub_id FROM channels WHERE id = ? LIMIT 1');
        $stmt->execute([$channelId]);
        $ch = $stmt->fetch();
        if (!$ch) json_err('not_found', 'Канал не найден', 404);

        if (!$ch['is_public'] && $ch['hub_id']) {
            // Private channel in a hub — must be hub member
            $stmt = db()->prepare('SELECT id FROM hub_members WHERE hub_id = ? AND user_id = ? LIMIT 1');
            $stmt->execute([(int) $ch['hub_id'], $uid]);
            if (!$stmt->fetch()) json_err('forbidden', 'Нет доступа к этому каналу', 403);
        }

        // Check if already subscribed
        $stmt = db()->prepare('SELECT id FROM channel_subscribers WHERE channel_id = ? AND user_id = ? LIMIT 1');
        $stmt->execute([$channelId, $uid]);
        if ($stmt->fetch()) json_err('already_subscribed', 'Вы уже подписаны');

        db()->prepare('INSERT INTO channel_subscribers (channel_id, user_id, role) VALUES (?, ?, "subscriber")')
            ->execute([$channelId, $uid]);

        json_ok(['subscribed' => true]);
        break;

    case 'unsubscribe':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_err('method_not_allowed', 'Только POST', 405);

        $channelId = (int) ($data['channel_id'] ?? 0);
        if (!$channelId) json_err('invalid_channel', 'Укажите channel_id');

        // Don't allow owner to unsubscribe
        $stmt = db()->prepare('SELECT role FROM channel_subscribers WHERE channel_id = ? AND user_id = ? LIMIT 1');
        $stmt->execute([$channelId, $uid]);
        $sub = $stmt->fetch();
        if (!$sub) json_err('not_subscribed', 'Вы не подписаны');
        if ($sub['role'] === 'owner') json_err('owner_cannot_unsubscribe', 'Владелец не может отписаться');

        db()->prepare('DELETE FROM channel_subscribers WHERE channel_id = ? AND user_id = ?')
            ->execute([$channelId, $uid]);

        json_ok(['unsubscribed' => true]);
        break;

    // ──────────────────────────────────────────────────────────
    //  JOIN / LEAVE HUB
    // ──────────────────────────────────────────────────────────
    case 'join_hub':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_err('method_not_allowed', 'Только POST', 405);

        $hubId = (int) ($data['hub_id'] ?? 0);
        if (!$hubId) json_err('invalid_hub', 'Укажите hub_id');

        $stmt = db()->prepare('SELECT id, is_public FROM hubs WHERE id = ? LIMIT 1');
        $stmt->execute([$hubId]);
        $hub = $stmt->fetch();
        if (!$hub) json_err('not_found', 'Хаб не найден', 404);
        if (!$hub['is_public']) json_err('forbidden', 'Хаб закрытый, вступление по приглашению', 403);

        $stmt = db()->prepare('SELECT id FROM hub_members WHERE hub_id = ? AND user_id = ? LIMIT 1');
        $stmt->execute([$hubId, $uid]);
        if ($stmt->fetch()) json_err('already_member', 'Вы уже участник');

        db()->prepare('INSERT INTO hub_members (hub_id, user_id, role) VALUES (?, ?, "member")')
            ->execute([$hubId, $uid]);

        // Auto-subscribe to all public channels in hub
        $stmt = db()->prepare('SELECT id FROM channels WHERE hub_id = ? AND is_public = 1');
        $stmt->execute([$hubId]);
        foreach ($stmt->fetchAll() as $ch) {
            db()->prepare('INSERT IGNORE INTO channel_subscribers (channel_id, user_id, role) VALUES (?, ?, "subscriber")')
                ->execute([(int) $ch['id'], $uid]);
        }

        json_ok(['joined' => true]);
        break;

    case 'leave_hub':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_err('method_not_allowed', 'Только POST', 405);

        $hubId = (int) ($data['hub_id'] ?? 0);
        if (!$hubId) json_err('invalid_hub', 'Укажите hub_id');

        $stmt = db()->prepare('SELECT role FROM hub_members WHERE hub_id = ? AND user_id = ? LIMIT 1');
        $stmt->execute([$hubId, $uid]);
        $member = $stmt->fetch();
        if (!$member) json_err('not_member', 'Вы не участник');
        if ($member['role'] === 'owner') json_err('owner_cannot_leave', 'Владелец не может покинуть хаб');

        db()->prepare('DELETE FROM hub_members WHERE hub_id = ? AND user_id = ?')
            ->execute([$hubId, $uid]);

        // Unsubscribe from all hub channels
        $stmt = db()->prepare('SELECT id FROM channels WHERE hub_id = ?');
        $stmt->execute([$hubId]);
        foreach ($stmt->fetchAll() as $ch) {
            db()->prepare('DELETE FROM channel_subscribers WHERE channel_id = ? AND user_id = ? AND role != "owner"')
                ->execute([(int) $ch['id'], $uid]);
        }

        json_ok(['left' => true]);
        break;

    // ──────────────────────────────────────────────────────────
    //  SEND MESSAGE TO CHANNEL
    // ──────────────────────────────────────────────────────────
    case 'send_message':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_err('method_not_allowed', 'Только POST', 405);

        $channelId = (int) ($data['channel_id'] ?? 0);
        $body      = ch_sanitize($data['body'] ?? '', 10000);
        $mediaUrl  = trim($data['media_url'] ?? '');
        $mediaType = trim($data['media_type'] ?? '');
        $replyTo   = isset($data['reply_to']) ? (int) $data['reply_to'] : null;

        if (!$channelId) json_err('invalid_channel', 'Укажите channel_id');

        // Check user is admin/owner of channel
        $stmt = db()->prepare(
            'SELECT cs.role FROM channel_subscribers cs WHERE cs.channel_id = ? AND cs.user_id = ? LIMIT 1'
        );
        $stmt->execute([$channelId, $uid]);
        $sub = $stmt->fetch();
        if (!$sub || !in_array($sub['role'], ['owner', 'admin'])) {
            json_err('forbidden', 'Только администраторы могут писать в канал', 403);
        }

        $hasText  = mb_strlen($body) > 0;
        $hasMedia = !empty($mediaUrl);
        if (!$hasText && !$hasMedia) json_err('empty_message', 'Сообщение не может быть пустым');

        if ($hasMedia) {
            if (!in_array($mediaType, ['image', 'video', 'document', 'voice'], true)) {
                json_err('invalid_media_type', 'Некорректный media_type');
            }
            $allowedPrefixes = ['media/', 'avatars/', 'music/', 'get_media.php'];
            $urlOk = false;
            foreach ($allowedPrefixes as $prefix) {
                if (str_starts_with($mediaUrl, $prefix)) { $urlOk = true; break; }
            }
            if (!$urlOk && str_contains($mediaUrl, 'sig=') && str_contains($mediaUrl, 'exp=')) $urlOk = true;
            if (!$urlOk) json_err('invalid_media_url', 'Некорректный media_url');
        }

        $stmt = db()->prepare(
            'INSERT INTO channel_messages (channel_id, sender_id, body, media_url, media_type, reply_to)
             VALUES (?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute([
            $channelId, $uid, $body,
            $hasMedia ? $mediaUrl : null,
            $hasMedia ? $mediaType : null,
            $replyTo,
        ]);
        $messageId = (int) db()->lastInsertId();

        // Get sent_at
        $stmt = db()->prepare('SELECT FLOOR(UNIX_TIMESTAMP(sent_at)) AS ts FROM channel_messages WHERE id = ? LIMIT 1');
        $stmt->execute([$messageId]);
        $sentAt = (int) ($stmt->fetchColumn() ?: time());

        // FCM push to all subscribers (except sender)
        $stmt = db()->prepare(
            'SELECT u.fcm_token FROM channel_subscribers cs
             JOIN users u ON u.id = cs.user_id
             WHERE cs.channel_id = ? AND cs.user_id != ? AND u.fcm_token IS NOT NULL AND u.fcm_token != ""'
        );
        $stmt->execute([$channelId, $uid]);

        // Get channel name for push title
        $stmtCh = db()->prepare('SELECT name FROM channels WHERE id = ? LIMIT 1');
        $stmtCh->execute([$channelId]);
        $chName = $stmtCh->fetchColumn() ?: 'Канал';

        $pushBody = $hasMedia
            ? ($mediaType === 'video' ? '🎥 Видео' : ($mediaType === 'voice' ? '🎤 Голосовое' : '🖼 Фото')) . ($hasText ? ': ' . mb_substr($body, 0, 80) : '')
            : (mb_strlen($body) > 80 ? mb_substr($body, 0, 80) . '...' : $body);

        foreach ($stmt->fetchAll() as $row) {
            if (!empty($row['fcm_token'])) {
                send_push(
                    $row['fcm_token'],
                    $chName,
                    $pushBody,
                    [
                        'type' => 'channel',
                        'channel_id' => (string) $channelId,
                        'sender_name' => $me['nickname'] ?? '',
                        'sender_avatar' => $me['avatar_url'] ?? '',
                    ]
                );
            }
        }

        json_ok([
            'message_id' => $messageId,
            'channel_id' => $channelId,
            'sent_at'    => $sentAt,
        ]);
        break;

    // ──────────────────────────────────────────────────────────
    //  GET CHANNEL MESSAGES
    // ──────────────────────────────────────────────────────────
    case 'get_messages':
        if ($_SERVER['REQUEST_METHOD'] !== 'GET') json_err('method_not_allowed', 'Только GET', 405);

        $channelId = (int) ($_GET['channel_id'] ?? 0);
        $afterId   = (int) ($_GET['after_id'] ?? 0);
        $beforeId  = (int) ($_GET['before_id'] ?? 0);
        $limit     = min(max((int) ($_GET['limit'] ?? 50), 1), 100);
        $init      = ($_GET['init'] ?? '0') === '1';

        if (!$channelId) json_err('invalid_channel', 'Укажите channel_id');

        // Check access
        $stmt = db()->prepare(
            'SELECT c.is_public, c.hub_id, cs.role AS my_role
             FROM channels c
             LEFT JOIN channel_subscribers cs ON cs.channel_id = c.id AND cs.user_id = ?
             WHERE c.id = ? LIMIT 1'
        );
        $stmt->execute([$uid, $channelId]);
        $ch = $stmt->fetch();
        if (!$ch) json_err('not_found', 'Канал не найден', 404);

        // If private, must be subscriber
        if (!$ch['is_public'] && empty($ch['my_role'])) {
            json_err('forbidden', 'Нет доступа к этому каналу', 403);
        }

        // Increment views for visible messages (batch update on init load)
        if ($init) {
            db()->prepare('UPDATE channel_messages SET views_count = views_count + 1 WHERE channel_id = ? AND is_deleted = 0')
                ->execute([$channelId]);
        }

        // Fetch messages
        if ($init) {
            $stmt = db()->prepare(
                'SELECT m.id, m.sender_id, m.body, m.media_url, m.media_type, m.media_spoiler,
                        m.reply_to, m.is_edited, m.views_count, m.batch_id,
                        m.voice_duration, m.voice_waveform,
                        UNIX_TIMESTAMP(m.sent_at) AS sent_at,
                        u.nickname, u.signal_id, u.avatar_url, u.is_team_signal
                 FROM channel_messages m
                 JOIN users u ON u.id = m.sender_id
                 WHERE m.channel_id = ? AND m.is_deleted = 0
                 ORDER BY m.sent_at DESC LIMIT ?'
            );
            $stmt->execute([$channelId, $limit]);
            $messages = array_reverse($stmt->fetchAll());
        } elseif ($beforeId > 0) {
            $stmt = db()->prepare(
                'SELECT m.id, m.sender_id, m.body, m.media_url, m.media_type, m.media_spoiler,
                        m.reply_to, m.is_edited, m.views_count, m.batch_id,
                        m.voice_duration, m.voice_waveform,
                        UNIX_TIMESTAMP(m.sent_at) AS sent_at,
                        u.nickname, u.signal_id, u.avatar_url, u.is_team_signal
                 FROM channel_messages m
                 JOIN users u ON u.id = m.sender_id
                 WHERE m.channel_id = ? AND m.is_deleted = 0 AND m.id < ?
                 ORDER BY m.id DESC LIMIT ?'
            );
            $stmt->execute([$channelId, $beforeId, $limit]);
            $messages = array_reverse($stmt->fetchAll());
        } else {
            $stmt = db()->prepare(
                'SELECT m.id, m.sender_id, m.body, m.media_url, m.media_type, m.media_spoiler,
                        m.reply_to, m.is_edited, m.views_count, m.batch_id,
                        m.voice_duration, m.voice_waveform,
                        UNIX_TIMESTAMP(m.sent_at) AS sent_at,
                        u.nickname, u.signal_id, u.avatar_url, u.is_team_signal
                 FROM channel_messages m
                 JOIN users u ON u.id = m.sender_id
                 WHERE m.channel_id = ? AND m.is_deleted = 0 AND m.id > ?
                 ORDER BY m.sent_at ASC LIMIT ?'
            );
            $stmt->execute([$channelId, $afterId, $limit]);
            $messages = $stmt->fetchAll();
        }

        // Reactions for messages
        $reactionsMap = [];
        if (!empty($messages)) {
            $ids = array_column($messages, 'id');
            $ph  = implode(',', array_fill(0, count($ids), '?'));
            $stmt2 = db()->prepare(
                "SELECT message_id, emoji, COUNT(*) AS cnt,
                        SUM(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS by_me
                 FROM channel_message_reactions
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
        }

        // Normalize
        $messages = array_map(fn($m) => [
            'id'              => (int) $m['id'],
            'sender_id'       => (int) $m['sender_id'],
            'sent_at'         => (int) $m['sent_at'],
            'body'            => $m['body'],
            'is_edited'       => (int) $m['is_edited'],
            'is_team_signal'  => (int) ($m['is_team_signal'] ?? 0),
            'reply_to'        => isset($m['reply_to']) ? (int) $m['reply_to'] : null,
            'media_url'       => $m['media_url'] ?? null,
            'media_type'      => $m['media_type'] ?? null,
            'media_spoiler'   => (int) ($m['media_spoiler'] ?? 0),
            'batch_id'        => $m['batch_id'] ?? null,
            'voice_duration'  => isset($m['voice_duration']) ? (int) $m['voice_duration'] : null,
            'voice_waveform'  => $m['voice_waveform'] ?? null,
            'views_count'     => (int) ($m['views_count'] ?? 0),
            'reactions'       => $reactionsMap[$m['id']] ?? [],
            'sender_signal_id' => $m['signal_id'] ?? '',
            'sender_name'     => $m['nickname'] ?? '',
            'sender_avatar'   => $m['avatar_url'] ?? null,
        ], $messages);

        json_ok([
            'messages'  => $messages,
            'has_more'  => count($messages) === $limit,
        ]);
        break;

    // ──────────────────────────────────────────────────────────
    //  DELETE CHANNEL MESSAGE
    // ──────────────────────────────────────────────────────────
    case 'delete_message':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_err('method_not_allowed', 'Только POST', 405);

        $messageId = (int) ($data['message_id'] ?? 0);
        if (!$messageId) json_err('invalid_message', 'Укажите message_id');

        // Check message exists and user is admin of its channel
        $stmt = db()->prepare(
            'SELECT cm.channel_id, cm.sender_id FROM channel_messages cm WHERE cm.id = ? AND cm.is_deleted = 0 LIMIT 1'
        );
        $stmt->execute([$messageId]);
        $msg = $stmt->fetch();
        if (!$msg) json_err('not_found', 'Сообщение не найдено', 404);

        // Must be admin of channel or message sender
        $stmt = db()->prepare(
            'SELECT role FROM channel_subscribers WHERE channel_id = ? AND user_id = ? LIMIT 1'
        );
        $stmt->execute([(int) $msg['channel_id'], $uid]);
        $sub = $stmt->fetch();
        $isAdmin = $sub && in_array($sub['role'], ['owner', 'admin']);
        $isSender = (int) $msg['sender_id'] === $uid;

        if (!$isAdmin && !$isSender) json_err('forbidden', 'Нет прав для удаления', 403);

        db()->prepare('UPDATE channel_messages SET is_deleted = 1 WHERE id = ?')
            ->execute([$messageId]);

        json_ok(['deleted' => true]);
        break;

    // ──────────────────────────────────────────────────────────
    //  EDIT CHANNEL MESSAGE
    // ──────────────────────────────────────────────────────────
    case 'edit_message':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_err('method_not_allowed', 'Только POST', 405);

        $messageId = (int) ($data['message_id'] ?? 0);
        $body      = ch_sanitize($data['body'] ?? '', 10000);
        if (!$messageId) json_err('invalid_message', 'Укажите message_id');
        if (mb_strlen($body) < 1) json_err('empty_message', 'Сообщение не может быть пустым');

        $stmt = db()->prepare('SELECT sender_id FROM channel_messages WHERE id = ? AND is_deleted = 0 LIMIT 1');
        $stmt->execute([$messageId]);
        $msg = $stmt->fetch();
        if (!$msg) json_err('not_found', 'Сообщение не найдено', 404);
        if ((int) $msg['sender_id'] !== $uid) json_err('forbidden', 'Можно редактировать только свои сообщения', 403);

        db()->prepare('UPDATE channel_messages SET body = ?, is_edited = 1 WHERE id = ?')
            ->execute([$body, $messageId]);

        json_ok(['edited' => true]);
        break;

    // ──────────────────────────────────────────────────────────
    //  REACT TO CHANNEL MESSAGE
    // ──────────────────────────────────────────────────────────
    case 'react':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_err('method_not_allowed', 'Только POST', 405);

        $messageId = (int) ($data['message_id'] ?? 0);
        $emoji     = trim($data['emoji'] ?? '');
        if (!$messageId || !$emoji) json_err('invalid_params', 'Укажите message_id и emoji');

        // Check message exists and user has access
        $stmt = db()->prepare(
            'SELECT cm.channel_id FROM channel_messages cm WHERE cm.id = ? AND cm.is_deleted = 0 LIMIT 1'
        );
        $stmt->execute([$messageId]);
        $msg = $stmt->fetch();
        if (!$msg) json_err('not_found', 'Сообщение не найдено', 404);

        // Check subscription
        $stmt = db()->prepare('SELECT id FROM channel_subscribers WHERE channel_id = ? AND user_id = ? LIMIT 1');
        $stmt->execute([(int) $msg['channel_id'], $uid]);
        if (!$stmt->fetch()) json_err('forbidden', 'Нет доступа', 403);

        // Toggle reaction
        $stmt = db()->prepare('SELECT id FROM channel_message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ? LIMIT 1');
        $stmt->execute([$messageId, $uid, $emoji]);
        if ($stmt->fetch()) {
            db()->prepare('DELETE FROM channel_message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?')
                ->execute([$messageId, $uid, $emoji]);
            json_ok(['reacted' => false]);
        } else {
            db()->prepare('INSERT INTO channel_message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)')
                ->execute([$messageId, $uid, $emoji]);
            json_ok(['reacted' => true]);
        }
        break;

    // ──────────────────────────────────────────────────────────
    //  SEARCH CHANNELS & HUBS
    // ──────────────────────────────────────────────────────────
    case 'search':
        if ($_SERVER['REQUEST_METHOD'] !== 'GET') json_err('method_not_allowed', 'Только GET', 405);

        $q = ch_sanitize($_GET['q'] ?? '', 100);
        if (mb_strlen($q) < 2) json_err('too_short', 'Минимум 2 символа для поиска');

        $like = '%' . $q . '%';

        // Search channels
        $stmt = db()->prepare(
            'SELECT c.id, c.name, c.description, c.avatar_url, c.signal_id, c.is_public,
                    (SELECT COUNT(*) FROM channel_subscribers WHERE channel_id = c.id) AS subscriber_count
             FROM channels c
             WHERE (c.name LIKE ? OR c.signal_id LIKE ?) AND c.is_public = 1
             ORDER BY subscriber_count DESC LIMIT 20'
        );
        $stmt->execute([$like, $like]);
        $channels = $stmt->fetchAll();

        // Search hubs
        $stmt = db()->prepare(
            'SELECT h.id, h.name, h.description, h.avatar_url, h.signal_id, h.is_public,
                    (SELECT COUNT(*) FROM hub_members WHERE hub_id = h.id) AS member_count
             FROM hubs h
             WHERE (h.name LIKE ? OR h.signal_id LIKE ?) AND h.is_public = 1
             ORDER BY member_count DESC LIMIT 20'
        );
        $stmt->execute([$like, $like]);
        $hubs = $stmt->fetchAll();

        json_ok([
            'channels' => array_map(fn($c) => [
                'id' => (int) $c['id'],
                'name' => $c['name'],
                'description' => $c['description'] ?? '',
                'avatar_url' => $c['avatar_url'],
                'signal_id' => $c['signal_id'],
                'subscriber_count' => (int) $c['subscriber_count'],
            ], $channels),
            'hubs' => array_map(fn($h) => [
                'id' => (int) $h['id'],
                'name' => $h['name'],
                'description' => $h['description'] ?? '',
                'avatar_url' => $h['avatar_url'],
                'signal_id' => $h['signal_id'],
                'member_count' => (int) $h['member_count'],
            ], $hubs),
        ]);
        break;

    // ──────────────────────────────────────────────────────────
    //  UPDATE CHANNEL / HUB
    // ──────────────────────────────────────────────────────────
    case 'update_channel':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_err('method_not_allowed', 'Только POST', 405);

        $channelId = (int) ($data['channel_id'] ?? 0);
        if (!$channelId) json_err('invalid_channel', 'Укажите channel_id');

        $stmt = db()->prepare('SELECT role FROM channel_subscribers WHERE channel_id = ? AND user_id = ? LIMIT 1');
        $stmt->execute([$channelId, $uid]);
        $sub = $stmt->fetch();
        if (!$sub || !in_array($sub['role'], ['owner', 'admin'])) json_err('forbidden', 'Нет прав', 403);

        $updates = [];
        $params = [];
        if (isset($data['name'])) { $updates[] = 'name = ?'; $params[] = ch_sanitize($data['name'], 100); }
        if (isset($data['description'])) { $updates[] = 'description = ?'; $params[] = ch_sanitize($data['description'], 500); }
        if (empty($updates)) json_err('nothing_to_update', 'Укажите поля для обновления');

        $params[] = $channelId;
        db()->prepare('UPDATE channels SET ' . implode(', ', $updates) . ' WHERE id = ?')->execute($params);

        json_ok(['updated' => true]);
        break;

    case 'update_hub':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_err('method_not_allowed', 'Только POST', 405);

        $hubId = (int) ($data['hub_id'] ?? 0);
        if (!$hubId) json_err('invalid_hub', 'Укажите hub_id');

        $stmt = db()->prepare('SELECT role FROM hub_members WHERE hub_id = ? AND user_id = ? LIMIT 1');
        $stmt->execute([$hubId, $uid]);
        $sub = $stmt->fetch();
        if (!$sub || !in_array($sub['role'], ['owner', 'admin'])) json_err('forbidden', 'Нет прав', 403);

        $updates = [];
        $params = [];
        if (isset($data['name'])) { $updates[] = 'name = ?'; $params[] = ch_sanitize($data['name'], 100); }
        if (isset($data['description'])) { $updates[] = 'description = ?'; $params[] = ch_sanitize($data['description'], 500); }
        if (empty($updates)) json_err('nothing_to_update', 'Укажите поля для обновления');

        $params[] = $hubId;
        db()->prepare('UPDATE hubs SET ' . implode(', ', $updates) . ' WHERE id = ?')->execute($params);

        json_ok(['updated' => true]);
        break;

    default:
        json_err('unknown_action', 'Неизвестное действие: ' . $action, 400);
}

<?php
// POST /api/create_channel
// Header: Authorization: Bearer <token>
// Body: { name, description?, username?, type: 'public'|'private' }
// Response: { channel_id, username, invite_link }
declare(strict_types=1);
require_once __DIR__ . '/helpers.php';

set_cors_headers();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_err('method_not_allowed', 'Только POST', 405);

$me   = auth_user();
require_rate_limit('create_channel', 5, 60);
$data = input();

$name        = sanitize_string(trim($data['name'] ?? ''), 128);
$description = sanitize_string(trim($data['description'] ?? ''), 512);
$username    = trim($data['username'] ?? '');
$type        = $data['type'] ?? 'public';
$avatarUrl   = trim($data['avatar_url'] ?? '');

// ── Validation ─────────────────────────────────────────────────
if (empty($name) || mb_strlen($name) < 1) json_err('invalid_name', 'Название канала обязательно');

if ($type !== 'public' && $type !== 'private') {
    $type = 'public';
}

// Public channels require username
if ($type === 'public') {
    if (empty($username)) json_err('username_required', 'Для публичного канала обязателен username');
}

// Validate username if provided
if (!empty($username)) {
    $username = strtolower($username);
    if (!preg_match('/^[a-z0-9_]{5,32}$/', $username)) {
        json_err('invalid_username', 'Username: 5-32 символов, только a-z, 0-9, _');
    }
}

// Check username uniqueness
if (!empty($username)) {
    $stmt = db()->prepare('SELECT id FROM channels WHERE username = ? LIMIT 1');
    $stmt->execute([$username]);
    if ($stmt->fetch()) json_err('username_taken', 'Этот username уже занят');
}

$db = db();

// Generate invite link for private channels
$inviteLink = null;
if ($type === 'private') {
    $inviteLink = generate_invite_link();
}

try {
    $db->beginTransaction();

    // Create channel
    $stmt = $db->prepare(
        'INSERT INTO channels (owner_id, name, username, description, avatar_url, type, invite_link_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    $stmt->execute([
        (int) $me['id'],
        $name,
        !empty($username) ? $username : null,
        !empty($description) ? $description : null,
        !empty($avatarUrl) ? $avatarUrl : null,
        $type,
        $inviteLink,
    ]);
    $channelId = (int) $db->lastInsertId();

    // Add owner as member
    $db->prepare(
        'INSERT INTO channel_members (channel_id, user_id, role) VALUES (?, ?, ?)'
    )->execute([$channelId, (int) $me['id'], 'owner']);

    $db->commit();
} catch (\Throwable $e) {
    if ($db->inTransaction()) $db->rollBack();
    error_log('create_channel error: ' . $e->getMessage());
    json_err('server_error', 'Ошибка при создании канала', 500);
}

json_ok([
    'channel_id'   => $channelId,
    'username'     => !empty($username) ? $username : null,
    'invite_link'  => $inviteLink,
]);

// ── Helper: generate unique 32-char hex hash for invite links ──
function generate_invite_link(): string {
    $db = db();
    for ($i = 0; $i < 10; $i++) {
        $hash = bin2hex(random_bytes(16)); // 32 hex chars
        $stmt = $db->prepare('SELECT id FROM channels WHERE invite_link_hash = ? LIMIT 1');
        $stmt->execute([$hash]);
        if (!$stmt->fetch()) return $hash;
    }
    // Extremely unlikely fallback
    return bin2hex(random_bytes(16)) . bin2hex(random_bytes(16));
}

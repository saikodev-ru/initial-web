<?php
// GET /api/search_user.php?q=ivan
// Header: Authorization: Bearer <token>
// Response: { "ok": true, "users": [...] }
declare(strict_types=1);
require_once __DIR__ . '/helpers.php';
set_cors_headers();
if ($_SERVER['REQUEST_METHOD'] !== 'GET') json_err('method_not_allowed', 'Только GET', 405);
$me    = auth_user();
$query = trim($_GET['q'] ?? '');

if (mb_strlen($query) < 2) {
    json_err('query_too_short', 'Минимум 2 символа для поиска');
}
if (mb_strlen($query) > 50) {
    json_err('query_too_long', 'Максимум 50 символов');
}

// Для поиска по signal_id — только допустимые символы (латиница, цифры, _)
$cleanId = preg_replace('/[^a-z0-9_]/i', '', $query);

// Если запрос состоит только из спецсимволов/emoji — ищем только по nickname
$hasIdPart = !empty($cleanId);

if ($hasIdPart) {
    // Ищем и по signal_id, и по nickname
    $stmt = db()->prepare(
        'SELECT id, nickname, signal_id, avatar_url, is_verified, is_team_signal
         FROM users
         WHERE id != ?
           AND is_system = 0
           AND signal_id IS NOT NULL
           AND (
               signal_id LIKE ?
               OR nickname LIKE ?
           )
         ORDER BY
             CASE WHEN signal_id = ? THEN 0 ELSE 1 END,
             signal_id ASC
         LIMIT 20'
    );
    $stmt->execute([
        $me['id'],
        $cleanId . '%',          // prefix match по signal_id
        '%' . $query . '%',      // substr match по nickname (оригинал с emoji/пробелами)
        $cleanId,                // точное совпадение — в топ
    ]);
} else {
    // Запрос не содержит допустимых символов для signal_id — ищем только по nickname
    $stmt = db()->prepare(
        'SELECT id, nickname, signal_id, avatar_url, is_verified, is_team_signal
         FROM users
         WHERE id != ?
           AND is_system = 0
           AND signal_id IS NOT NULL
           AND nickname LIKE ?
         ORDER BY signal_id ASC
         LIMIT 20'
    );
    $stmt->execute([
        $me['id'],
        '%' . $query . '%',
    ]);
}

$users = $stmt->fetchAll();

$result = array_map(fn($u) => [
    'id'             => (int) $u['id'],
    'nickname'       => $u['nickname'] ?? $u['signal_id'],
    'signal_id'      => $u['signal_id'],
    'avatar_url'     => $u['avatar_url'],
    'is_verified'    => (int) ($u['is_verified'] ?? 0),
    'is_team_signal' => (int) ($u['is_team_signal'] ?? 0),
], $users);

json_ok(['users' => $result]);
<?php
// GET /api/search_channels?q=keyword
// Header: Authorization: Bearer <token>
// Response: { channels: [...] }
declare(strict_types=1);
require_once __DIR__ . '/helpers.php';

set_cors_headers();
if ($_SERVER['REQUEST_METHOD'] !== 'GET') json_err('method_not_allowed', 'Только GET', 405);

$me    = auth_user();
require_rate_limit('search_channels', 30, 60);
$query = trim($_GET['q'] ?? '');

if (mb_strlen($query) < 2) json_err('query_too_short', 'Минимум 2 символа для поиска');
if (mb_strlen($query) > 50) json_err('query_too_long', 'Максимум 50 символов');

$db = db();

// Search public channels only, by name and username
$stmt = $db->prepare(
    "SELECT id, name, username, avatar_url, description, type, members_count
     FROM channels
     WHERE type = 'public'
       AND (
           name LIKE ?
           OR username LIKE ?
       )
     ORDER BY members_count DESC
     LIMIT 30"
);
$stmt->execute([
    '%' . $query . '%',
    '%' . strtolower($query) . '%',
]);
$rows = $stmt->fetchAll();

$channels = array_map(fn($c) => [
    'channel_id'    => (int) $c['id'],
    'name'          => $c['name'],
    'username'      => $c['username'],
    'avatar_url'    => $c['avatar_url'],
    'description'   => $c['description'],
    'type'          => $c['type'],
    'members_count' => (int) $c['members_count'],
], $rows);

json_ok(['channels' => $channels]);

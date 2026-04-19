<?php
// POST /api/delete_channel_comment
// Body: { comment_id }
declare(strict_types=1);
require_once __DIR__ . '/../helpers.php';

set_cors_headers();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_err('method_not_allowed', 'Только POST', 405);

$me = auth_user();
require_rate_limit('delete_channel_comment', 20, 60);
$data = input();

$uid       = (int) $me['id'];
$commentId = (int) ($data['comment_id'] ?? 0);

if ($commentId <= 0) json_err('invalid_id', 'Некорректный comment_id');

$db = db();

// Get comment and verify permissions
$stmt = $db->prepare(
    'SELECT c.*, cm.role AS member_role
     FROM channel_comments c
     JOIN channels ch ON ch.id = c.channel_id
     LEFT JOIN channel_members cm ON cm.channel_id = c.channel_id AND cm.user_id = ?
     WHERE c.id = ? AND c.is_deleted = 0
     LIMIT 1'
);
$stmt->execute([$uid, $commentId]);
$comment = $stmt->fetch();

if (!$comment) json_err('not_found', 'Комментарий не найден', 404);

// Only sender, admin, or owner can delete
$isAdmin = in_array($comment['member_role'], ['owner', 'admin'], true);
if ($comment['sender_id'] != $uid && !$isAdmin) {
    json_err('forbidden', 'Вы можете удалять только свои комментарии', 403);
}

try {
    $db->prepare('UPDATE channel_comments SET is_deleted = 1 WHERE id = ?')->execute([$commentId]);

    // Decrement comments_count on parent message
    $db->prepare('UPDATE channel_messages SET comments_count = GREATEST(comments_count - 1, 0) WHERE id = ?')
        ->execute([$comment['message_id']]);
} catch (\Throwable $e) {
    error_log('delete_channel_comment error: ' . $e->getMessage());
    json_err('server_error', 'Ошибка удаления', 500);
}

json_ok(['ok' => true]);

<?php
// POST /api/delete_chat.php
// Header: Authorization: Bearer <token>
// Body: { "chat_id": 5 }
// Удаляет чат и все его сообщения для обоих участников.
// Только участник чата может его удалить.
declare(strict_types=1);
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/s3_helper.php';

set_cors_headers();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_err('method_not_allowed', 'Только POST', 405);

$me     = auth_user();
require_rate_limit('delete_chat', 10, 60);
$data   = input();
$chatId = (int) ($data['chat_id'] ?? 0);

if ($chatId <= 0) json_err('invalid_id', 'Некорректный chat_id');

$db = db();

// Убедиться что пользователь является участником чата + не системный
$stmt = $db->prepare(
    'SELECT id, is_protected, is_saved_msgs FROM chats WHERE id = ? AND (user_a = ? OR user_b = ?) LIMIT 1'
);
$stmt->execute([$chatId, $me['id'], $me['id']]);
$chatRow = $stmt->fetch();
if (!$chatRow) json_err('forbidden', 'Нет доступа к этому чату', 403);

// Запрещаем удаление защищённых чатов (Избранное, чат с @initial)
if ((int) $chatRow['is_protected'] || (int) $chatRow['is_saved_msgs']) {
    json_err('forbidden', 'Нельзя удалить системный чат', 403);
}

// ── Собираем media_url для очистки S3 ──────────────────────
$mediaStmt = $db->prepare(
    'SELECT media_url FROM messages WHERE chat_id = ? AND media_url IS NOT NULL AND media_url != ""'
);
$mediaStmt->execute([$chatId]);
$mediaUrls = $mediaStmt->fetchAll(PDO::FETCH_COLUMN);

// Удаляем всё в транзакции
$db->beginTransaction();
try {
    // Реакции на сообщения чата
    $db->prepare(
        'DELETE mr FROM message_reactions mr
         JOIN messages m ON m.id = mr.message_id
         WHERE m.chat_id = ?'
    )->execute([$chatId]);

    // Сообщения
    $db->prepare('DELETE FROM messages WHERE chat_id = ?')->execute([$chatId]);

    // Сам чат
    $db->prepare('DELETE FROM chats WHERE id = ?')->execute([$chatId]);

    $db->commit();
} catch (\Throwable $e) {
    $db->rollBack();
    error_log('delete_chat error: ' . $e->getMessage());
    json_err('server_error', 'Ошибка при удалении чата', 500);
}

// ── Удаляем медиа из S3 (после успешной транзакции) ──────────
foreach ($mediaUrls as $url) {
    try {
        $s3Key = null;
        if (str_starts_with($url, 'media/') || str_starts_with($url, 'avatars/') || str_starts_with($url, 'music/')) {
            $s3Key = $url;
        } elseif (str_contains($url, 'key=')) {
            $parsed = parse_url($url);
            if (!empty($parsed['query'])) {
                parse_str($parsed['query'], $qp);
                if (!empty($qp['key'])) $s3Key = $qp['key'];
            }
        }
        if ($s3Key) s3_delete($s3Key);
    } catch (\Throwable) {
        // S3-ошибка не должна блокировать удаление чата
    }
}

json_ok(['chat_id' => $chatId]);

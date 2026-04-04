<?php
// ВЕРСИЯ С ДЕБАГОМ — удалить после диагностики!
declare(strict_types=1);
require_once __DIR__ . '/helpers.php';

set_cors_headers();

$me   = auth_user();
$data = input();

$messageId = (int) ($data['message_id'] ?? 0);
$emoji     = trim($data['emoji'] ?? '');

// ── DEBUG ─────────────────────────────────────────────────────
$debugInfo = [
    'method'        => $_SERVER['REQUEST_METHOD'],
    'message_id'    => $messageId,
    'emoji_hex_raw' => bin2hex($emoji),
];

// Нормализация: убираем U+FE0F
$emoji = preg_replace('/\x{FE0F}/u', '', $emoji);
$emoji = mb_substr($emoji, 0, 16);

$debugInfo['emoji_hex_norm'] = bin2hex($emoji);

if ($messageId <= 0) json_err('invalid_data', 'Некорректный message_id');
if ($emoji === '')   json_err('invalid_data', 'Эмодзи отсутствует');

$db = db();

// Проверяем доступ
$stmt = $db->prepare(
    'SELECT m.id FROM messages m
     JOIN chats c ON c.id = m.chat_id
     WHERE m.id = ? AND (c.user_a = ? OR c.user_b = ?) AND m.is_deleted = 0
     LIMIT 1'
);
$stmt->execute([$messageId, $me['id'], $me['id']]);
if (!$stmt->fetch()) {
    error_log('[REACT DEBUG] ' . json_encode(array_merge($debugInfo, ['error' => 'forbidden'])));
    json_err('forbidden', 'Нет доступа к этому сообщению', 403);
}

if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
    $db->prepare(
        'DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?'
    )->execute([$messageId, $me['id'], $emoji]);
    $debugInfo['action']   = 'DELETE';
    $debugInfo['affected'] = (int) $db->query('SELECT ROW_COUNT()')->fetchColumn();
} else {
    // Что уже есть в БД до INSERT
    $stmtCheck = $db->prepare(
        'SELECT emoji, HEX(emoji) as hex_e FROM message_reactions WHERE message_id = ? AND user_id = ?'
    );
    $stmtCheck->execute([$messageId, $me['id']]);
    $debugInfo['existing_before_insert'] = $stmtCheck->fetchAll();

    $db->prepare(
        'INSERT IGNORE INTO message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)'
    )->execute([$messageId, $me['id'], $emoji]);

    $affected = (int) $db->query('SELECT ROW_COUNT()')->fetchColumn();
    $debugInfo['action']   = 'INSERT';
    $debugInfo['affected'] = $affected;

    if ($affected === 0) {
        // Что помешало INSERT
        $stmtConflict = $db->prepare(
            'SELECT emoji, HEX(emoji) as hex_e FROM message_reactions
             WHERE message_id = ? AND user_id = ? AND emoji = ?'
        );
        $stmtConflict->execute([$messageId, $me['id'], $emoji]);
        $debugInfo['conflict_row'] = $stmtConflict->fetch();

        // INSERT без IGNORE чтобы увидеть реальную ошибку MySQL
        try {
            $db->prepare(
                'INSERT INTO message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)'
            )->execute([$messageId, $me['id'], $emoji]);
            $debugInfo['direct_insert'] = 'success';
        } catch (\Exception $ex) {
            $debugInfo['direct_insert_error'] = $ex->getMessage();
        }
    }
}

error_log('[REACT DEBUG] ' . json_encode($debugInfo, JSON_UNESCAPED_UNICODE));

$stmt = $db->prepare(
    'SELECT emoji,
            COUNT(*) AS cnt,
            MAX(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS by_me,
            MAX(CASE WHEN user_id = ? THEN UNIX_TIMESTAMP(created_at) ELSE 0 END) AS my_created_at
     FROM message_reactions
     WHERE message_id = ?
     GROUP BY emoji
     ORDER BY cnt DESC, emoji'
);
$stmt->execute([$me['id'], $me['id'], $messageId]);

$reactions = array_map(fn($r) => [
    'emoji'      => $r['emoji'],
    'count'      => (int)  $r['cnt'],
    'by_me'      => (bool) $r['by_me'],
    'created_at' => (int)  $r['my_created_at'],
], $stmt->fetchAll());

// debug прямо в ответе — убрать после диагностики!
json_ok([
    'message_id' => $messageId,
    'reactions'  => $reactions,
    'debug'      => $debugInfo,
]);
<?php
/**
 * auth.php — проверяет Bearer-токен через таблицу sessions,
 * устанавливает $current_user_id или отвечает 401 и завершает скрипт.
 *
 * Подключайте через require_once в каждом защищённом эндпоинте.
 * helpers.php (и значит config.php + синглтон db()) должны быть
 * подключены до этого файла — или подключаются здесь автоматически.
 */
declare(strict_types=1);

if (!function_exists('db')) {
    require_once __DIR__ . '/helpers.php';
}

// ── Извлечь Bearer-токен ─────────────────────────────────────
$_auth_header = $_SERVER['HTTP_AUTHORIZATION']
             ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION']
             ?? '';

if (empty($_auth_header) && function_exists('getallheaders')) {
    $_all_headers  = getallheaders();
    $_auth_header  = $_all_headers['Authorization'] ?? $_all_headers['authorization'] ?? '';
}

$_token = '';
if (preg_match('/^Bearer\s+(\S+)$/i', $_auth_header, $_m)) {
    $_token = $_m[1];
}
unset($_auth_header, $_all_headers, $_m);

if (!$_token) {
    http_response_code(401);
    header('Content-Type: application/json; charset=UTF-8');
    echo json_encode(['ok' => false, 'error' => 'unauthorized', 'message' => 'Необходима авторизация'], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── Проверить токен в таблице sessions ───────────────────────
// (именно sessions — auth_tokens устарела и не используется)
$_stmt = db()->prepare(
    'SELECT s.user_id
     FROM sessions s
     WHERE s.token = ? AND s.expires_at > NOW()
     LIMIT 1'
);
$_stmt->execute([$_token]);
$_row = $_stmt->fetch();
unset($_stmt, $_token);

if (!$_row) {
    http_response_code(401);
    header('Content-Type: application/json; charset=UTF-8');
    echo json_encode(['ok' => false, 'error' => 'unauthorized', 'message' => 'Токен недействителен или истёк'], JSON_UNESCAPED_UNICODE);
    exit;
}

$current_user_id = (int) $_row['user_id'];
unset($_row);
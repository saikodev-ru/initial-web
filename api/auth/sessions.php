<?php
// GET /api/sessions.php - Получить список
// DELETE /api/sessions.php - Удалить сессию (Body: { "session_id": 123 })
declare(strict_types=1);
require_once __DIR__ . '/../helpers.php';

set_cors_headers();
$me = auth_user();
require_rate_limit('sessions', 20, 60);

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    // Убедись, что таблица называется sessions и в ней есть нужные поля
    // Если нет, создай её: CREATE TABLE sessions (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, token VARCHAR(128), ip_address VARCHAR(64), user_agent VARCHAR(255), last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
    try {
        // Очистка истекших сессий (прошло более 30 дней)
        $db = db();
        $db->exec('DELETE FROM sessions WHERE expires_at < NOW()');

        $stmt = $db->prepare('SELECT id, ip, device, UNIX_TIMESTAMP(created_at) as last_active, token FROM sessions WHERE user_id = ? ORDER BY created_at DESC');
        $stmt->execute([$me['id']]);
        $sessions = $stmt->fetchAll(PDO::FETCH_ASSOC);
        
        // Помечаем текущую сессию
        $current_token = get_bearer_token();
        foreach ($sessions as &$s) {
            $s['is_current'] = ($s['token'] === $current_token);

            // Форматируем IP для отображения (перевод IPv6 localhost и IPv4-mapped)
            $ip = $s['ip'];
            if ($ip === '::1') $ip = '127.0.0.1';
            elseif (strpos($ip, '::ffff:') === 0) $ip = substr($ip, 7);
            $s['ip'] = $ip;

            // Форматируем User-Agent в читаемый вид: "Windows 10 • Chrome 114"
            $s['device'] = parse_user_agent($s['device']);

            unset($s['token']); // Не отдаем токены на фронт
        }
        json_ok(['sessions' => $sessions]);
    } catch (Throwable $e) {
        error_log('sessions: error loading sessions for user ' . $me['id'] . ': ' . $e->getMessage());
        json_ok(['sessions' => []]);
    }
} 
elseif ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
    $data = input();
    $sessionId = (int)($data['session_id'] ?? 0);
    if ($sessionId <= 0) json_err('invalid_id', 'Неверный ID сессии');
    
    $stmt = db()->prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?');
    $stmt->execute([$sessionId, $me['id']]);
    json_ok(['deleted' => true]);
}

json_err('method_not_allowed', 'Метод не поддерживается', 405);
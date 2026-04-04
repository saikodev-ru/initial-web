<?php
// POST /api/send_code.php
// Body: { "email": "user@example.com", "force_email"?: true }
// Response: { "ok": true, "message": "...", "via": "email"|"signal" }
declare(strict_types=1);
require_once __DIR__ . '/helpers.php';

set_cors_headers();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_err('method_not_allowed', 'Только POST', 405);

$data       = input();
$email      = strtolower(trim($data['email'] ?? ''));
$forceEmail = !empty($data['force_email']); // Пользователь явно выбрал "получить на email"

// ── Rate Limiting по IP ───────────────────────────────────────
$ip = $_SERVER['HTTP_CF_CONNECTING_IP'] ?? $_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? 'unknown';
$ip = trim(explode(',', $ip)[0]);
if ($ip === '::1') $ip = '127.0.0.1';

db()->exec("CREATE TABLE IF NOT EXISTS ip_limit_log (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    ip VARCHAR(45) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_ip_time (ip, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

$stmt = db()->prepare('SELECT COUNT(*) FROM ip_limit_log WHERE ip = ? AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)');
$stmt->execute([$ip]);
if ((int) $stmt->fetchColumn() >= CODES_PER_HOUR) {
    json_err('rate_limit', 'Исчерпан лимит запросов (' . CODES_PER_HOUR . ' в час). Попробуйте позже.', 429);
}
db()->prepare('INSERT INTO ip_limit_log (ip) VALUES (?)')->execute([$ip]);

if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    json_err('invalid_email', 'Некорректный email');
}

// ── Инвалидировать старые коды ───────────────────────────────
db()->prepare('UPDATE auth_codes SET used = 1 WHERE email = ? AND used = 0')
    ->execute([$email]);

// ── Генерация кода ───────────────────────────────────────────
$code      = (string) random_int(10000, 99999);
$codeHash  = password_hash($code, PASSWORD_BCRYPT);
$expiresAt = date('Y-m-d H:i:s', strtotime('+' . CODE_EXPIRE_MINUTES . ' minutes'));

db()->prepare(
    'INSERT INTO auth_codes (email, code_hash, expires_at) VALUES (?, ?, ?)'
)->execute([$email, $codeHash, $expiresAt]);

// ── Маршрутизация: @signal или email? ────────────────────────
$via = 'email';

if (!$forceEmail) {
    // Проверяем: есть ли у пользователя активные сессии?
    $stmt = db()->prepare(
        "SELECT u.id FROM users u
         JOIN sessions s ON s.user_id = u.id
         WHERE u.email = ? AND s.expires_at > NOW()
         LIMIT 1"
    );
    $stmt->execute([$email]);
    $userWithSession = $stmt->fetch();

    if ($userWithSession) {
        // Отправить код через @signal внутри мессенджера
        $sent = _sendCodeViaSignal((int)$userWithSession['id'], $code);
        if ($sent) {
            $via = 'signal';
        }
        // Если @signal не настроен — упадёт в email ниже
    }
}

// ── Отправка по email (всегда как fallback или если нет сессий) ──
if ($via === 'email') {
    $sent = send_email(
        $email,
        $code . ' — Код для входа в Инициал',
        make_code_email($code)
    );
    if (!$sent) {
        json_err('mail_error', 'Не удалось отправить письмо. Попробуйте позже.', 500);
    }
}

$response = [
    'message' => $via === 'signal'
        ? 'Код отправлен в ваш чат с @initial'
        : "Код отправлен на {$email}",
    'via' => $via,
];



json_ok($response);


// ════════════════════════════════════════════════════════════
//  Внутренний хелпер
// ════════════════════════════════════════════════════════════

function _sendCodeViaSignal(int $userId, string $code): bool {
    $body = implode("\n", [
        '🔑 **Код для входа в Initial**',
        '',
        "Ваш код: **{$code}**",
        '',
        'Действителен ' . CODE_EXPIRE_MINUTES . ' минут. Никому не сообщайте.',
        '',
        'Если это не Вы — немедленно завершите все сеансы в **Настройках**.',
    ]);

    sendSystemMsg($userId, $body);

    return true;
}

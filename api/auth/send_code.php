<?php
// POST /api/send_code
// Body: { "email": "user@example.com", "force_email"?: true }
// Response: { "ok": true, "message": "...", "via": "email"|"signal" }
declare(strict_types=1);
require_once __DIR__ . '/../helpers.php';

set_cors_headers();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_err('method_not_allowed', 'Только POST', 405);

// ── Rate limiting: 5 кодов в час по IP ──────────────────────────
$codesPerHour = defined('CODES_PER_HOUR') ? (int) CODES_PER_HOUR : 5;
require_rate_limit('send_code', $codesPerHour, 3600);

check_request_size(4096);

$data       = input();
$email      = strtolower(trim($data['email'] ?? ''));
$forceEmail = !empty($data['force_email']);

if (!validate_email($email)) {
    json_err('invalid_email', 'Некорректный email');
}

$db = db();

// ── Rate limiting: MySQL (постоянный) ────────────────────────────
try {
    $ip = get_real_ip();
    $stmt = $db->prepare(
        'SELECT COUNT(*) FROM ip_limit_log
         WHERE ip = ? AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)'
    );
    $stmt->execute([$ip]);
    if ((int) $stmt->fetchColumn() >= $codesPerHour) {
        json_err('rate_limit', 'Исчерпан лимит запросов. Попробуйте позже.', 429);
    }
    $db->prepare('INSERT INTO ip_limit_log (ip) VALUES (?)')->execute([$ip]);
} catch (\Throwable $e) {
    error_log("send_code: rate limit table error: " . $e->getMessage());
}

// ── Cooldown: не слать код чаще чем раз в 30 секунд на email ────
try {
    $stmt = $db->prepare(
        'SELECT 1 FROM auth_codes
         WHERE email = ? AND created_at > DATE_SUB(NOW(), INTERVAL 30 SECOND)
         LIMIT 1'
    );
    $stmt->execute([$email]);
    if ($stmt->fetch()) {
        json_err('cooldown', 'Слишком частые запросы. Подождите 30 секунд.', 429);
    }
} catch (\Throwable $e) {
    // Non-fatal: if table doesn't exist yet, skip cooldown check
    error_log("send_code: cooldown check error: " . $e->getMessage());
}

// ── Инвалидировать старые коды ───────────────────────────────────
$db->prepare('UPDATE auth_codes SET used = 1 WHERE email = ? AND used = 0')
    ->execute([$email]);

// ── Генерация кода (криптографически случайный) ──────────────────
$code      = (string) random_int(10000, 99999);
$codeHash  = password_hash($code, PASSWORD_BCRYPT);
$expiresAt = date('Y-m-d H:i:s', strtotime('+' . CODE_EXPIRE_MINUTES . ' minutes'));

$db->prepare(
    'INSERT INTO auth_codes (email, code_hash, expires_at) VALUES (?, ?, ?)'
)->execute([$email, $codeHash, $expiresAt]);

// ── Маршрутизация: @signal или email? ────────────────────────────
$via = 'email';

if (!$forceEmail) {
    // Проверяем: есть ли у пользователя активные сессии?
    $stmt = $db->prepare(
        "SELECT u.id FROM users u
         JOIN sessions s ON s.user_id = u.id
         WHERE u.email = ? AND s.expires_at > NOW()
         LIMIT 1"
    );
    $stmt->execute([$email]);
    $userWithSession = $stmt->fetch();

    if ($userWithSession) {
        $sent = _sendCodeViaSignal((int) $userWithSession['id'], $code);
        if ($sent) {
            $via = 'signal';
        }
    }
}

// ── Отправка по email (всегда как fallback или если нет сессий) ──
if ($via === 'email') {
    $sent = send_email(
        $email,
        $code . ' — Код для входа в Initial',
        make_code_email($code)
    );
    if (!$sent) {
        json_err('mail_error', 'Не удалось отправить письмо. Попробуйте позже.', 500);
    }
}

json_ok([
    'message' => $via === 'signal'
        ? 'Код отправлен в ваш чат с @initial'
        : "Код отправлен на {$email}",
    'via' => $via,
]);


// ════════════════════════════════════════════════════════════
//  Внутренний хелпер
// ════════════════════════════════════════════════════════════

function _sendCodeViaSignal(int $userId, string $code): bool {
    $body = implode("\n", [
        '**Код для входа в Initial**',
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

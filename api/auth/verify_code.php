<?php
// POST /api/verify_code
// Body: { "email": "user@example.com", "code": "12345" }
// Response: { "ok": true, "token": "...", "is_new_user": true, "user": {...} }
declare(strict_types=1);
require_once __DIR__ . '/../helpers.php';

set_cors_headers();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_err('method_not_allowed', 'Только POST', 405);

// ── Rate limiting: 20 попыток verify в час по IP ──────────────
require_rate_limit('verify_code', 20, 3600);

// ── Проверка размера запроса ───────────────────────────────────
check_request_size(4096);

$data  = input();
$email = strtolower(trim($data['email'] ?? ''));
$code  = trim($data['code'] ?? '');

// ── Валидация ────────────────────────────────────────────────────
if (!validate_email($email)) json_err('invalid_email', 'Некорректный email');
if (!preg_match('/^\d{5}$/', $code)) json_err('invalid_code', 'Код должен быть 5 цифр');

// ── Одно соединение на весь запрос ───────────────────────────────
$db = db();

// ══════════════════════════════════════════════════════════════════
//  1. Найти и проверить код
// ══════════════════════════════════════════════════════════════════
try {
    $stmt = $db->prepare(
        'SELECT id, code_hash, attempts FROM auth_codes
         WHERE email = ? AND used = 0 AND expires_at > NOW()
         ORDER BY created_at DESC LIMIT 1'
    );
    $stmt->execute([$email]);
    $row = $stmt->fetch();
} catch (\Throwable $e) {
    error_log("verify_code: ошибка поиска кода: " . $e->getMessage());
    json_err('server_error', 'Ошибка сервера. Попробуйте позже.', 500);
}

if (!$row) json_err('code_not_found', 'Код не найден или истёк. Запросите новый.');

// ── Лимит попыток ────────────────────────────────────────────────
if ((int) $row['attempts'] >= CODE_MAX_ATTEMPTS) {
    $db->prepare('UPDATE auth_codes SET used = 1 WHERE id = ?')->execute([$row['id']]);
    json_err('too_many_attempts', 'Превышено число попыток. Запросите новый код.', 429);
}

// ── Проверка кода (постоянное время через password_verify) ───────
if (!password_verify($code, $row['code_hash'])) {
    $db->prepare('UPDATE auth_codes SET attempts = attempts + 1 WHERE id = ?')
        ->execute([$row['id']]);
    $left = CODE_MAX_ATTEMPTS - (int) $row['attempts'] - 1;
    json_err('wrong_code', "Неверный код. Осталось попыток: {$left}");
}

// ── Код верный — инвалидируем ────────────────────────────────────
$db->prepare('UPDATE auth_codes SET used = 1 WHERE id = ?')->execute([$row['id']]);

// ══════════════════════════════════════════════════════════════════
//  2. Найти или создать пользователя (транзакция)
// ══════════════════════════════════════════════════════════════════
//
//  Стратегия (защита от race conditions + сломанный AUTO_INCREMENT):
//
//    1. SELECT ... FOR UPDATE по email → блокируем строку
//    2. Если нашёлся → используем существующий id
//    3. Если нет → вычисляем next_id = MAX(id) + 1 (минимум 1)
//    4. INSERT с явным id → гарантируем уникальность
//    5. COMMIT
//
//  Транзакция + FOR UPDATE исключает дублирование при concurrent
//  запросах с одним email.

$isNewUser = false;
$userId    = 0;

try {
    $db->beginTransaction();

    // Шаг 1: ищем с блокировкой строки (FOR UPDATE)
    $stmt = $db->prepare('SELECT id FROM users WHERE email = ? LIMIT 1 FOR UPDATE');
    $stmt->execute([$email]);
    $existRow = $stmt->fetch();

    if ($existRow) {
        // Пользователь существует — обновляем last_seen
        $userId = (int) $existRow['id'];
        $db->prepare('UPDATE users SET last_seen = NOW() WHERE id = ?')->execute([$userId]);
    } else {
        // Шаг 2: нового пользователя — вычисляем безопасный id
        $maxRow = $db->query('SELECT COALESCE(MAX(id), 0) AS max_id FROM users')->fetch();
        $nextId = max(1, (int) $maxRow['max_id'] + 1);

        $stmt = $db->prepare(
            'INSERT INTO users (id, email, last_seen) VALUES (?, ?, NOW())'
        );
        $stmt->execute([$nextId, $email]);
        $userId    = $nextId;
        $isNewUser = true;
    }

    $db->commit();
} catch (\Throwable $e) {
    if ($db->inTransaction()) {
        $db->rollBack();
    }
    error_log("verify_code: ошибка создания пользователя: " . $e->getMessage()
        . " | email={$email} | trace=" . $e->getTraceAsString());
    json_err('server_error', 'Ошибка при создании аккаунта. Попробуйте ещё раз.', 500);
}

if ($userId <= 0) {
    error_log("verify_code: userId=0 после транзакции, email={$email}");
    json_err('server_error', 'Ошибка при создании аккаунта. Попробуйте ещё раз.', 500);
}

// ══════════════════════════════════════════════════════════════════
//  3. Загрузить данные пользователя
// ══════════════════════════════════════════════════════════════════
if ($isNewUser) {
    bootstrapNewUser($userId);
    $user = [
        'id'         => $userId,
        'email'      => $email,
        'nickname'   => null,
        'signal_id'  => null,
        'avatar_url' => null,
        'bio'        => null,
    ];
} else {
    $stmt = $db->prepare('SELECT email, nickname, signal_id, avatar_url, bio FROM users WHERE id = ? LIMIT 1');
    $stmt->execute([$userId]);
    $user = $stmt->fetch() ?: [
        'email' => $email, 'nickname' => null,
        'signal_id' => null, 'avatar_url' => null, 'bio' => null,
    ];
    sendLoginNotification($userId);
}

// ── Создать сессию ───────────────────────────────────────────────
$token = create_session($userId);

json_ok([
    'token'       => $token,
    'is_new_user' => $isNewUser,
    'user'        => [
        'id'         => $userId,
        'email'      => $user['email'],
        'nickname'   => $user['nickname'],
        'signal_id'  => $user['signal_id'],
        'avatar_url' => $user['avatar_url'],
        'bio'        => $user['bio'] ?? null,
    ],
]);


// ══════════════════════════════════════════════════════════════════
//  ХЕЛПЕРЫ ДЛЯ ИНИЦИАЛИЗАЦИИ
// ══════════════════════════════════════════════════════════════════

function bootstrapNewUser(int $userId): void
{
    $db = db();

    // 1. Чат «Избранное»
    $db->prepare(
        'INSERT IGNORE INTO chats (user_a, user_b, is_saved_msgs, is_protected, created_at)
         VALUES (?, ?, 1, 1, NOW())'
    )->execute([$userId, $userId]);

    // 2. Приветственное сообщение от @initial
    $welcome = implode("\n", [
        '**Добро пожаловать в Initial!**',
        '',
        'Здесь вы будете получать уведомления безопасности — например, о входе с нового устройства или IP-адреса.',
        '',
        'Если вы видите уведомление о действии, которое не совершали — немедленно завершите все сеансы в настройках аккаунта.',
    ]);

    sendSystemMsg($userId, $welcome);
}

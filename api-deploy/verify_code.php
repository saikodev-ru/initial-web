<?php
// POST /api/verify_code.php
// Body: { "email": "user@example.com", "code": "12345" }
// Response: { "ok": true, "token": "...", "is_new_user": true, "user": {...} }
declare(strict_types=1);
require_once __DIR__ . '/helpers.php';

set_cors_headers();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_err('method_not_allowed', 'Только POST', 405);

// ── Rate limiting: 20 попыток verify в час по IP ──────────────
require_rate_limit('verify_code', 20, 3600);

// ── Проверка размера запроса ───────────────────────────────────
check_request_size(4096); // email + code = мало данных

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

// ── Проверка кода ────────────────────────────────────────────────
if (!password_verify($code, $row['code_hash'])) {
    $db->prepare('UPDATE auth_codes SET attempts = attempts + 1 WHERE id = ?')
        ->execute([$row['id']]);
    $left = CODE_MAX_ATTEMPTS - (int) $row['attempts'] - 1;
    json_err('wrong_code', "Неверный код. Осталось попыток: {$left}");
}

// ── Код верный — инвалидируем ────────────────────────────────────
$db->prepare('UPDATE auth_codes SET used = 1 WHERE id = ?')->execute([$row['id']]);

// ══════════════════════════════════════════════════════════════════
//  2. Найти или создать пользователя
//  ══════════════════════════════════════════════════════════════════
//  Стратегия:
//    - Сначала SELECT по email
//    - Если нет → INSERT IGNORE (защита от concurrent duplicate)
//    - Если INSERT IGNORE не вставил (affected=0) → повторный SELECT
//    - Если всё равно нет → fallback: INSERT с явным id (MAX+1)
//
//  Всё обёрнуто в try-catch — ЛЮБАЯ ошибка логируется, но НЕ
//  раскрывает внутренние детали клиенту.

$isNewUser = false;
$userId    = 0;

try {
    // Шаг 1: ищем существующего пользователя
    $stmt = $db->prepare('SELECT id FROM users WHERE email = ? LIMIT 1');
    $stmt->execute([$email]);
    $existRow = $stmt->fetch();

    if ($existRow) {
        $userId = (int) $existRow['id'];
        $db->prepare('UPDATE users SET last_seen = NOW() WHERE id = ?')->execute([$userId]);
    } else {
        // Шаг 2: пробуем INSERT IGNORE
        $stmt = $db->prepare('INSERT IGNORE INTO users (email, last_seen) VALUES (?, NOW())');
        $stmt->execute([$email]);
        $affected = $stmt->rowCount();

        if ($affected > 0) {
            // INSERT прошёл — получаем ID через lastInsertId
            $userId = (int) $db->lastInsertId();
            if ($userId > 0) {
                $isNewUser = true;
            }
        }

        // Шаг 3: если lastInsertId вернул 0 или INSERT был проигнорирован
        if ($userId <= 0) {
            $stmt = $db->prepare('SELECT id FROM users WHERE email = ? LIMIT 1');
            $stmt->execute([$email]);
            $existRow = $stmt->fetch();

            if ($existRow) {
                // Concurrent INSERT от другого запроса
                $userId = (int) $existRow['id'];
            } else {
                // Экстренный fallback: сломанный AUTO_INCREMENT
                error_log("verify_code: WARNING — INSERT IGNORE не сработал для email={$email}, пробуем fallback");
                $maxRow = $db->query('SELECT COALESCE(MAX(id), 0) + 1 AS nid FROM users')->fetch();
                $nextId = (int) $maxRow['nid'];

                $stmt = $db->prepare('INSERT INTO users (id, email, last_seen) VALUES (?, ?, NOW())');
                $stmt->execute([$nextId, $email]);

                $userId = (int) $db->lastInsertId();
                $isNewUser = true;
            }
        }
    }
} catch (\Throwable $e) {
    // Логируем ПОЛНУЮ ошибку для отладки, но клиенту даём общее сообщение
    error_log("verify_code: ошибка создания пользователя: " . $e->getMessage()
        . " | email={$email} | trace=" . $e->getTraceAsString());
    json_err('server_error', 'Ошибка при создании аккаунта. Попробуйте ещё раз.', 500);
}

// Финальная проверка
if ($userId <= 0) {
    error_log("verify_code: userId=0 после всех попыток, email={$email}");
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
    // 1. Чат «Избранное»
    db()->prepare(
        'INSERT IGNORE INTO chats (user_a, user_b, is_saved_msgs, is_protected, created_at)
         VALUES (?, ?, 1, 1, NOW())'
    )->execute([$userId, $userId]);

    // 2. Приветственное сообщение от @initial
    $welcome = implode("\n", [
        '👋 **Добро пожаловать в Initial!**',
        '',
        'Здесь вы будете получать уведомления безопасности — например, о входе с нового устройства или IP-адреса.',
        '',
        'Если вы видите уведомление о действии, которое не совершали — немедленно завершите все сеансы в настройках аккаунта.',
    ]);

    sendSystemMsg($userId, $welcome);
}

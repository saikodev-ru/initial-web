<?php
// POST /api/verify_code.php
// Body: { "email": "user@example.com", "code": "12345" }
// Response: { "ok": true, "token": "...", "is_new_user": true, "user": {...} }
declare(strict_types=1);
require_once __DIR__ . '/helpers.php';

set_cors_headers();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_err('method_not_allowed', 'Только POST', 405);

$data  = input();
$email = strtolower(trim($data['email'] ?? ''));
$code  = trim($data['code'] ?? '');

// ── Валидация ────────────────────────────────────────────────
if (!filter_var($email, FILTER_VALIDATE_EMAIL)) json_err('invalid_email', 'Некорректный email');
if (!preg_match('/^\d{5}$/', $code))            json_err('invalid_code',  'Код должен быть 5 цифр');

// ── Одно соединение на весь запрос ───────────────────────────
// Фиксируем ссылку один раз: lastInsertId() гарантированно
// вернёт ID именно этой транзакции, а не чужой.
$db = db();

// ── Найти актуальный код ─────────────────────────────────────
$stmt = $db->prepare(
    'SELECT id, code_hash, attempts FROM auth_codes
     WHERE email = ? AND used = 0 AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1'
);
$stmt->execute([$email]);
$row = $stmt->fetch();

if (!$row) json_err('code_not_found', 'Код не найден или истёк. Запросите новый.');

// ── Лимит попыток ────────────────────────────────────────────
if ((int) $row['attempts'] >= CODE_MAX_ATTEMPTS) {
    $db->prepare('UPDATE auth_codes SET used = 1 WHERE id = ?')->execute([$row['id']]);
    json_err('too_many_attempts', 'Превышено число попыток. Запросите новый код.', 429);
}

// ── Проверка кода ────────────────────────────────────────────
if (!password_verify($code, $row['code_hash'])) {
    $db->prepare('UPDATE auth_codes SET attempts = attempts + 1 WHERE id = ?')
        ->execute([$row['id']]);
    $left = CODE_MAX_ATTEMPTS - (int) $row['attempts'] - 1;
    json_err('wrong_code', "Неверный код. Осталось попыток: {$left}");
}

// ── Код верный — инвалидируем ────────────────────────────────
$db->prepare('UPDATE auth_codes SET used = 1 WHERE id = ?')->execute([$row['id']]);

// ── Найти или создать пользователя (race-condition-safe) ──────
// Используем INSERT IGNORE + повторный SELECT чтобы избежать
// Duplicate entry при конкурентных запросах одного email.
$db->beginTransaction();
try {
    $stmt = $db->prepare('SELECT * FROM users WHERE email = ? LIMIT 1 FOR UPDATE');
    $stmt->execute([$email]);
    $user      = $stmt->fetch();
    $isNewUser = !$user;

    if ($isNewUser) {
        // INSERT IGNORE — если уже вставлен конкурентным запросом, просто молча пропускаем
        $insStmt = $db->prepare('INSERT IGNORE INTO users (email, last_seen) VALUES (?, NOW())');
        $insStmt->execute([$email]);

        // Если INSERT не вставил (email уже существовал) — перечитаем
        if ($db->lastInsertId() == 0 || $insStmt->rowCount() === 0) {
            $stmt = $db->prepare('SELECT * FROM users WHERE email = ? LIMIT 1');
            $stmt->execute([$email]);
            $user = $stmt->fetch();
            if ($user) {
                $isNewUser = false;
                $userId = (int) $user['id'];
                $db->prepare('UPDATE users SET last_seen = NOW() WHERE id = ?')
                   ->execute([$userId]);
            } else {
                // Страховка: если записи всё ещё нет
                $db->rollBack();
                json_err('server_error', 'Ошибка при создании аккаунта. Попробуйте ещё раз.', 500);
            }
        } else {
            $userId = (int) $db->lastInsertId();
            if ($userId === 0) {
                $db->rollBack();
                error_log("verify_code: lastInsertId() вернул 0 для email={$email}");
                json_err('server_error', 'Ошибка при создании аккаунта. Попробуйте ещё раз.', 500);
            }
        }
    } else {
        $db->prepare('UPDATE users SET last_seen = NOW() WHERE id = ?')
           ->execute([$user['id']]);
        $userId = (int) $user['id'];
    }

    $db->commit();
} catch (\PDOException $e) {
    $db->rollBack();
    error_log("verify_code PDO: " . $e->getMessage());
    json_err('server_error', 'Ошибка базы данных. Попробуйте ещё раз.', 500);
}

if ($isNewUser) {
    if (!isset($user) || !$user) {
        $user = [
            'id'         => $userId,
            'email'      => $email,
            'nickname'   => null,
            'signal_id'  => null,
            'avatar_url' => null,
            'bio'        => null,
        ];
    }
    bootstrapNewUser($userId);
} else {
    sendLoginNotification($userId);
}

// ── Создать сессию ───────────────────────────────────────────
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


// ════════════════════════════════════════════════════════════
//  ХЕЛПЕРЫ ДЛЯ ИНИЦИАЛИЗАЦИИ
// ════════════════════════════════════════════════════════════

/**
 * Создать системные чаты для только что зарегистрированного пользователя:
 *   1. Чат «Избранное»  (is_saved_msgs = 1, user_a = user_b = userId)
 *   2. Приветственное сообщение от @signal
 *
 * Вызывается один раз при регистрации.
 */
function bootstrapNewUser(int $userId): void
{
    // ── 1. Чат «Избранное» ──────────────────────────────────
    db()->prepare(
        'INSERT IGNORE INTO chats (user_a, user_b, is_saved_msgs, is_protected, created_at)
         VALUES (?, ?, 1, 1, NOW())'
    )->execute([$userId, $userId]);

    // ── 2. Приветственное сообщение от @signal ──────────────
    $welcome = implode("\n", [
        '👋 **Добро пожаловать в Initial!**',
        '',
        'Здесь вы будете получать уведомления безопасности — например, о входе с нового устройства или IP-адреса.',
        '',
        'Если вы видите уведомление о действии, которое не совершали — немедленно завершите все сеансы в настройках аккаунта.',
    ]);

    sendSystemMsg($userId, $welcome);
}
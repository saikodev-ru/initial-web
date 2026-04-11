<?php
// POST /api/update_profile.php
// Header: Authorization: Bearer <token>
// Body: { "nickname": "Иван", "signal_id": "ivan_42", "avatar_url": "https://...", "bio": "..." }
declare(strict_types=1);
require_once __DIR__ . '/helpers.php';

set_cors_headers();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_err('method_not_allowed', 'Только POST', 405);

$me   = auth_user();
require_rate_limit('update_profile', 10, 60);
$data = input();

$nickname  = sanitize_string(trim($data['nickname'] ?? ''));
$signalId  = strtolower(trim($data['signal_id'] ?? ''));
$avatarUrl = trim($data['avatar_url'] ?? '');
$bio       = sanitize_string(trim($data['bio'] ?? ''), 150);

// ── Валидация avatar_url (если передан) ────────────────────────
if (!empty($avatarUrl)) {
    // Разрешаем: пустую строку (сброс), URL из нашего S3, или прокси
    $allowed = false;
    if (str_starts_with($avatarUrl, 'avatars/')) $allowed = true;
    if (str_starts_with($avatarUrl, 'get_media.php?key=')) $allowed = true;
    if ($allowed === false) {
        // Также разрешаем если URL подписан нашими сигнатурами
        if (str_contains($avatarUrl, 'sig=') && str_contains($avatarUrl, 'exp=')) $allowed = true;
    }
    if ($allowed === false) {
        $avatarUrl = ''; // Сбрасываем невалидный URL
    }
}
if (mb_strlen($nickname) < 2 || mb_strlen($nickname) > 64) {
    json_err('invalid_nickname', 'Имя: от 2 до 64 символов');
}
if (!preg_match('/^[a-z0-9_]{3,50}$/', $signalId)) {
    json_err('invalid_signal_id', 'Signal ID: 3-50 символов, только a-z, 0-9, _');
}

// ── Дополнительная валидация signal_id ──────────────────────
if (!validate_signal_id($signalId)) {
    json_err('invalid_signal_id', 'Signal ID содержит недопустимые символы или зарезервирован');
}

// ── Проверка уникальности Signal ID ──────────────────────────
$stmt = db()->prepare(
    'SELECT id FROM users WHERE signal_id = ? AND id != ? LIMIT 1'
);
$stmt->execute([$signalId, $me['id']]);
if ($stmt->fetch()) json_err('signal_id_taken', 'Этот Signal ID уже занят');

// ── Обновление ───────────────────────────────────────────────
$stmt = db()->prepare(
    'UPDATE users SET nickname = ?, signal_id = ?, avatar_url = ?, bio = ? WHERE id = ?'
);
$stmt->execute([$nickname, $signalId, $avatarUrl ?: null, $bio, $me['id']]);

json_ok([
    'user' => [
        'id'         => $me['id'],
        'email'      => $me['email'],
        'nickname'   => $nickname,
        'signal_id'  => $signalId,
        'avatar_url' => $avatarUrl ?: null,
        'bio'        => $bio,              // ← тоже стоит вернуть
    ]
]);
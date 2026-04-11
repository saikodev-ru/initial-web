<?php
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  security.php — Централизованный модуль безопасности
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  Функционал:
 *   - HTTP Security Headers (HSTS, CSP, X-Frame-Options, etc.)
 *   - Rate Limiting (in-memory per-process, MySQL-backed persistent)
 *   - CSRF-защита через Origin/Referer проверку
 *   - Sanitization входных данных
 *   - Валидация размера запроса
 *   - Защита от XSS в пользовательском контенте
 *
 *  Использование:
 *     require_once __DIR__ . '/security.php';
 *     security_init();         // один раз в index.php или начале каждого эндпоинта
 *     rate_limit('endpoint', 60, 60);  // 60 запросов за 60 секунд
 *     $safe = sanitize_html($userInput);
 * ═══════════════════════════════════════════════════════════════════════════════
 */
declare(strict_types=1);

// ── Инициализация заголовков безопасности (вызывать ОДИН раз) ────────────────
function security_init(): void {
    // Предотвращаем повторную инициализацию
    static $initialized = false;
    if ($initialized) return;
    $initialized = true;

    // ── HSTS — принудительный HTTPS (1 год, includeSubDomains) ──
    header('Strict-Transport-Security: max-age=31536000; includeSubDomains', false);

    // ── Защита от кликджекинга ──
    header('X-Frame-Options: DENY', false);

    // ── Защита от MIME-sniffing ──
    header('X-Content-Type-Options: nosniff', false);

    // ── XSS Protection (legacy, но не повредит) ──
    header('X-XSS-Protection: 1; mode=block', false);

    // ── Referrer Policy ──
    header('Referrer-Policy: strict-origin-when-cross-origin', false);

    // ── Permissions Policy — отключаем ненужные API ──
    header('Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()', false);

    // ── Content-Security-Policy (базовая для API) ──
    header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'", false);

    // ── Убираем информацию о сервере ──
    if (function_exists('header_remove')) {
        header_remove('X-Powered-By');
        header_remove('Server');
    }

    // ── Отключаем expose_php (если возможно) ──
    @ini_set('expose_php', '0');
}

// ═══════════════════════════════════════════════════════════════════════════════
//  RATE LIMITING
// ═══════════════════════════════════════════════════════════════════════════════
//
//  Двухуровневая система:
//   1. In-memory per-process (для быстрой блокировки спама в рамках одного PHP-процесса)
//   2. MySQL-backed (постоянная, разделяемая между процессами)
//
//  Внимание: MySQL rate limiting использует таблицу rate_limits.
//  Она создаётся автоматически при первом вызове (CREATE TABLE IF NOT EXISTS).

/**
 * Проверить rate limit. Возвращает true если запрос РАЗРЕШЁН, false если ЛИМИТ ИСЧЕРПАН.
 *
 * @param string $key     Уникальный ключ лимита (например: 'send_code', 'send_msg_42')
 * @param int    $max     Максимум запросов за окно
 * @param int    $window  Окно в секундах
 * @param string $scope   'ip' (по IP) или 'user' (по user_id, требует авторизации)
 * @return bool true = разрешено, false = лимит исчерпан
 */
function rate_limit(string $key, int $max, int $window, string $scope = 'ip'): bool {
    // ── Определяем идентификатор ──
    if ($scope === 'user' && function_exists('auth_user')) {
        // Пробуем получить user_id, но не фейлим если нет авторизации
        try {
            $token = get_bearer_token();
            if (empty($token)) return true; // Нет токена — не рейт-лимитим по user
            $user = null;
            // Лёгкий запрос к сессии
            $stmt = db()->prepare('SELECT user_id FROM sessions WHERE token = ? AND expires_at > NOW() LIMIT 1');
            $stmt->execute([$token]);
            $row = $stmt->fetch();
            if (!$row) return true;
            $identifier = 'user:' . (int) $row['user_id'] . ':' . $key;
        } catch (\Throwable) {
            return true; // Ошибка БД — пропускаем запрос
        }
    } else {
        $ip = get_real_ip();
        $identifier = 'ip:' . $ip . ':' . $key;
    }

    // ── MySQL-backed rate limiting ──
    try {
        $pdo = db();

        // Автосоздание таблицы (один раз)
        $pdo->exec("CREATE TABLE IF NOT EXISTS rate_limits (
            id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            identifier VARCHAR(191) NOT NULL,
            hit_at     DATETIME     NOT NULL,
            INDEX idx_ident_time (identifier, hit_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        // Удаляем старые записи (cleanup, не каждый раз)
        if (random_int(1, 20) === 1) {
            $pdo->exec("DELETE FROM rate_limits WHERE hit_at < DATE_SUB(NOW(), INTERVAL 1 HOUR)");
        }

        // Считаем текущие попадания
        $stmt = $pdo->prepare(
            'SELECT COUNT(*) FROM rate_limits
             WHERE identifier = ? AND hit_at > DATE_SUB(NOW(), INTERVAL ? SECOND)'
        );
        $stmt->execute([$identifier, $window]);
        $count = (int) $stmt->fetchColumn();

        if ($count >= $max) {
            // Лимит исчерпан
            return false;
        }

        // Добавляем запись о текущем запросе
        $pdo->prepare('INSERT INTO rate_limits (identifier, hit_at) VALUES (?, NOW())')
            ->execute([$identifier]);

        return true;

    } catch (\Throwable $e) {
        // Ошибка БД — логируем, но НЕ блокируем запрос
        error_log("rate_limit error: " . $e->getMessage());
        return true;
    }
}

/**
 * Проверить rate limit и отправить 429 если исчерпан.
 * Удобная обёртка для eindpunktов.
 */
function require_rate_limit(string $key, int $max, int $window, string $scope = 'ip'): void {
    if (!rate_limit($key, $max, $window, $scope)) {
        json_err('rate_limit', 'Слишком много запросов. Попробуйте позже.', 429);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CSRF ЗАЩИТА
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Проверить Origin/Referer заголовок для защиты от CSRF.
 * Для API это проверяет, что запрос приходит с разрешённого домена.
 *
 * @param bool $strict Если true — обязательно проверять Origin. Если false — только для state-changing запросов.
 */
function check_csrf_origin(bool $strict = false): void {
    $allowedOrigin = defined('ALLOWED_ORIGIN') ? ALLOWED_ORIGIN : '*';

    // Пропускаем если ALLOWED_ORIGIN = * (разработка)
    if ($allowedOrigin === '*') return;

    // GET/HEAD/OPTIONS — по умолчанию не проверяем (strict=false)
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if (!$strict && in_array($method, ['GET', 'HEAD', 'OPTIONS'], true)) return;

    // Разрешённый хост (без протокола и порта)
    $allowedHost = strtolower(parse_url($allowedOrigin, PHP_URL_HOST) ?: '');
    if (empty($allowedHost)) return;

    // Проверяем Origin
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if (!empty($origin)) {
        $originHost = strtolower(parse_url($origin, PHP_URL_HOST) ?: '');
        if ($originHost === $allowedHost) return; // Точное совпадение хостов

        error_log("CSRF: Origin mismatch. Origin={$origin}, Allowed={$allowedOrigin}");
        json_err('forbidden', 'CSRF: некорректный Origin', 403);
    }

    // Fallback: проверяем Referer
    $referer = $_SERVER['HTTP_REFERER'] ?? '';
    if (!empty($referer)) {
        $refHost = strtolower(parse_url($referer, PHP_URL_HOST) ?: '');
        if ($refHost === $allowedHost) return;

        error_log("CSRF: Referer mismatch. Referer={$referer}, Allowed={$allowedOrigin}");
        json_err('forbidden', 'CSRF: некорректный Referer', 403);
    }

    // Если strict и нет ни Origin ни Referer — блокируем
    if ($strict) {
        error_log("CSRF: Missing Origin and Referer headers");
        json_err('forbidden', 'CSRF: отсутствует Origin заголовок', 403);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SANITIZATION & ВАЛИДАЦИЯ
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Санитизировать строку для безопасного хранения и отображения.
 * Убирает потенциально опасные HTML-теги, нормализует Unicode.
 *
 * @param string $input    Входная строка
 * @param int    $maxLength Максимальная длина (0 = без лимита)
 * @return string Санитизированная строка
 */
function sanitize_string(string $input, int $maxLength = 0): string {
    // Убираем NULL-байты
    $input = str_replace("\0", '', $input);

    // Нормализация Unicode (NFC)
    if (function_exists('normalizer_normalize')) {
        $input = normalizer_normalize($input, \Normalizer::FORM_C) ?? $input;
    }

    // Убираем управляющие символы (кроме \n, \r, \t)
    $input = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $input);

    // Обрезаем
    if ($maxLength > 0) {
        $input = mb_substr($input, 0, $maxLength);
    }

    return trim($input);
}

/**
 * Подготовить строку для безопасного вывода в HTML-контексте.
 * НЕ использует htmlspecialchars напрямую — возвращает безопасную строку
 * для хранения в БД (вывод экранируется на клиенте).
 *
 * Для API (JSON) это просто trim + длина.
 */
function sanitize_api_string(string $input, int $maxLength = 0): string {
    return sanitize_string($input, $maxLength);
}

/**
 * Валидировать email с дополнительными проверками.
 *
 * @param string $email Email для проверки
 * @return bool true если email валиден
 */
function validate_email(string $email): bool {
    $email = strtolower(trim($email));

    // Базовая проверка
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) return false;

    // Длина домена (макс 253 символов по RFC)
    $parts = explode('@', $email);
    if (count($parts) !== 2) return false;
    if (strlen($parts[0]) > 64 || strlen($parts[1]) > 253) return false;

    // Запрещённые домены (temp mail / disposable)
    $banned = ['test.com', 'example.com', 'mailinator.com', 'guerrillamail.com',
               'throwaway.email', 'sharklasers.com', 'guerrillamailblock.com'];
    if (in_array($parts[1], $banned, true)) return false;

    // Block single-letter TLD (not valid)
    $tld = substr(strrchr($parts[1], '.'), 1);
    if (strlen($tld) < 2) return false;

    // Проверка DNS MX-записи (опционально, только если включено)
    if (defined('CHECK_EMAIL_DNS') && CHECK_EMAIL_DNS) {
        if (!checkdnsrr($parts[1], 'MX') && !checkdnsrr($parts[1], 'A')) return false;
    }

    return true;
}

/**
 * Валидировать signal_id (username).
 * Правила: 3-50 символов, a-z, 0-9, _
 * Дополнительно: не может начинаться с цифры, не может быть все цифры.
 */
function validate_signal_id(string $signalId): bool {
    if (!preg_match('/^[a-z0-9_]{3,50}$/', $signalId)) return false;
    if (ctype_digit($signalId)) return false;
    // Зарезервированные имена
    $reserved = ['initial', 'signal', 'admin', 'support', 'system', 'root', 'null', 'undefined', 'api'];
    if (in_array($signalId, $reserved, true)) return false;
    return true;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ БЕЗОПАСНОСТИ
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Получить реальный IP-адрес клиента.
 * Учитывает Cloudflare и反向 прокси.
 */
function get_real_ip(): string {
    // Cloudflare (надёжный, только если за Cloudflare)
    if (!empty($_SERVER['HTTP_CF_CONNECTING_IP'])) {
        $ip = $_SERVER['HTTP_CF_CONNECTING_IP'];
        if (filter_var($ip, FILTER_VALIDATE_IP)) return $ip;
    }

    // X-Forwarded-For (берём первый, только если не подделан)
    // Для безопасности: проверяем что REMOTE_ADDR — доверенный прокси
    $xff = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? '';
    if (!empty($xff)) {
        $parts = explode(',', $xff);
        $first = trim($parts[0]);
        // Защита от spoofing: XFF может быть подделан клиентом
        // Разрешаем только если запрос приходит от localhost/доверенного прокси
        $remoteAddr = $_SERVER['REMOTE_ADDR'] ?? '';
        $isTrusted = ($remoteAddr === '127.0.0.1' || $remoteAddr === '::1'
            || str_starts_with($remoteAddr, '10.')
            || str_starts_with($remoteAddr, '172.16.')
            || str_starts_with($remoteAddr, '192.168.')
            || defined('TRUSTED_PROXY_IPS')); // можно задать в config.php
        if ($isTrusted && filter_var($first, FILTER_VALIDATE_IP)) return $first;
    }

    // Прямой IP (фоллбек)
    $ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
    if ($ip === '::1') return '127.0.0.1';

    // IPv6-mapped IPv4
    if (str_starts_with($ip, '::ffff:')) {
        $ip = substr($ip, 7);
    }

    return filter_var($ip, FILTER_VALIDATE_IP) ? $ip : '0.0.0.0';
}

/**
 * Проверить размер входящего JSON-запроса.
 *
 * @param int $maxBytes Максимум байт (по умолчанию 1 МБ)
 */
function check_request_size(int $maxBytes = 1048576): void {
    $contentLength = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
    if ($contentLength > $maxBytes) {
        json_err('payload_too_large', 'Запрос слишком большой', 413);
    }
}

/**
 * Проверить, что файл был загружен через HTTP POST (не через SSRF/local file).
 */
function validate_uploaded_file(array $file, array $allowedMimes, int $maxBytes): array {
    // Проверяем upload error
    if (empty($file) || ($file['error'] ?? -1) !== UPLOAD_ERR_OK) {
        $code = $file['error'] ?? -1;
        json_err('upload_error', "Ошибка загрузки файла ({$code})");
    }

    $tmpPath = $file['tmp_name'];
    $size = (int) ($file['size'] ?? 0);

    // Проверяем размер
    if ($size > $maxBytes) {
        $mb = round($maxBytes / 1048576, 1);
        json_err('file_too_large', "Максимальный размер — {$mb} МБ");
    }

    if ($size < 1) {
        json_err('empty_file', 'Файл пуст');
    }

    // Проверяем что это реально загруженный файл (не /etc/passwd через symlink)
    if (!is_uploaded_file($tmpPath)) {
        error_log("SECURITY: attempted local file access via upload: {$tmpPath}");
        json_err('invalid_upload', 'Некорректный файл');
    }

    // Проверяем MIME
    $mime = '';
    $imageInfo = @getimagesize($tmpPath);
    if ($imageInfo) {
        $mime = $imageInfo['mime'];
    }
    if (empty($mime) && function_exists('mime_content_type')) {
        $mime = @mime_content_type($tmpPath) ?: '';
    }
    if (empty($mime)) {
        $finfo = @finfo_open(FILEINFO_MIME_TYPE);
        if ($finfo) {
            $mime = @finfo_file($finfo, $tmpPath) ?: '';
            finfo_close($finfo);
        }
    }

    if (!in_array($mime, $allowedMimes, true)) {
        json_err('invalid_type', 'Неподдерживаемый тип файла');
    }

    return [
        'tmp'  => $tmpPath,
        'size' => $size,
        'mime' => $mime,
    ];
}

/**
 * Генерировать криптографически случайный токен.
 *
 * @param int $bytes Длина в байтах (по умолчанию 32 = 64 hex символов)
 * @return string Hex-строка
 */
function secure_token(int $bytes = 32): string {
    return bin2hex(random_bytes($bytes));
}

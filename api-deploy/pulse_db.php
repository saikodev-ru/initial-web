<?php
// ============================================================
//  pulse_db.php — подключение к отдельной БД для Pulse
//  Используется ТОЛЬКО в музыкальных эндпоинтах.
//  Auth (сессии, пользователи) берётся из основной БД через helpers.php
// ============================================================
declare(strict_types=1);

// ── Pulse DB credentials ─────────────────────────────────────
define('PULSE_DB_HOST',    'localhost');
define('PULSE_DB_NAME',    'u3426818_pulse');
define('PULSE_DB_USER',    'u3426818_default');
define('PULSE_DB_PASS',    '4U9fpJg36XBp5yYF');
define('PULSE_DB_CHARSET', 'utf8mb4');

/**
 * PDO-соединение с Pulse БД (singleton).
 * Не перекрывает функцию db() из helpers.php — у неё другое имя.
 */
function pdb(): PDO {
    static $pdo = null;
    if ($pdo === null) {
        $dsn = sprintf(
            'mysql:host=%s;dbname=%s;charset=%s',
            PULSE_DB_HOST, PULSE_DB_NAME, PULSE_DB_CHARSET
        );
        $pdo = new PDO($dsn, PULSE_DB_USER, PULSE_DB_PASS, [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]);
    }
    return $pdo;
}

<?php
declare(strict_types=1); // ДОЛЖЕН быть первым оператором после <?php

// ============================================================
//  helpers.php — общие функции
// ============================================================

// ── Перехват PHP-ошибок → JSON ───────────────────────────────
ini_set('display_errors', 0);
ini_set('log_errors', 1);
ob_start(); // Буферизуем весь вывод

register_shutdown_function(function () {
    $err = error_get_last();
    if ($err && in_array($err['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
        ob_end_clean();
        header('Content-Type: application/json; charset=UTF-8');
        http_response_code(500);
        echo json_encode([
            'ok'      => false,
            'error'   => 'fatal_error',
            'message' => $err['message'] . ' in ' . basename($err['file']) . ':' . $err['line'],
        ], JSON_UNESCAPED_UNICODE);
    } else {
        ob_end_flush();
    }
});

require_once __DIR__ . '/config.php';

// ── PDO-соединение (singleton) ───────────────────────────────
function db(): PDO {
    static $pdo = null;
    if ($pdo === null) {
        $dsn = sprintf(
            'mysql:host=%s;dbname=%s;charset=%s',
            DB_HOST, DB_NAME, DB_CHARSET
        );
        $pdo = new PDO($dsn, DB_USER, DB_PASS, [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::MYSQL_ATTR_INIT_COMMAND => "SET NAMES utf8mb4",
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]);
    }
    return $pdo;
}

// ── Ответы ───────────────────────────────────────────────────
function json_ok(array $data, int $status = 200): never {
    http_response_code($status);
    echo json_encode(['ok' => true, ...$data], JSON_UNESCAPED_UNICODE);
    exit;
}

function json_err(string $code, string $message, int $status = 400): never {
    http_response_code($status);
    echo json_encode(['ok' => false, 'error' => $code, 'message' => $message], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── Заголовки CORS ───────────────────────────────────────────
function set_cors_headers(): void {
    header('Content-Type: application/json; charset=UTF-8');
    header('Access-Control-Allow-Origin: ' . ALLOWED_ORIGIN);
    header('Access-Control-Allow-Headers: Content-Type, Authorization');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
        http_response_code(204);
        exit;
    }
}

// ── Входящий JSON ────────────────────────────────────────────
function input(): array {
    $raw = file_get_contents('php://input');
    return json_decode($raw ?: '{}', true) ?? [];
}

// ── Аутентификация через Bearer-токен ────────────────────────
function auth_user(): array {
    $header = $_SERVER['HTTP_AUTHORIZATION']
           ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION']
           ?? '';

    if (empty($header) && function_exists('getallheaders')) {
        $all    = getallheaders();
        $header = $all['Authorization'] ?? $all['authorization'] ?? '';
    }

    if (!preg_match('/^Bearer\s+(\S+)$/i', $header, $m)) {
        json_err('unauthorized', 'Необходима авторизация', 401);
    }

    $token = $m[1];
    $stmt  = db()->prepare(
        'SELECT s.user_id, s.expires_at, u.id, u.email, u.nickname, u.signal_id, u.avatar_url
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token = ? AND s.expires_at > NOW()
         LIMIT 1'
    );
    $stmt->execute([$token]);
    $user = $stmt->fetch();
    if (!$user) json_err('unauthorized', 'Токен недействителен или истёк', 401);
    return $user;
}

function get_bearer_token(): string {
    $header = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if (empty($header) && function_exists('getallheaders')) {
        $all = getallheaders();
        $header = $all['Authorization'] ?? $all['authorization'] ?? '';
    }
    if (preg_match('/^Bearer\s+(\S+)$/i', $header, $m)) {
        return $m[1];
    }
    return '';
}

function check_media_auth(): array {
    $token = get_bearer_token();
    if (empty($token)) {
        $token = $_GET['token'] ?? '';
    }

    if (empty($token)) {
        http_response_code(403);
        header('Content-Type: application/json');
        die(json_encode(['error' => 'forbidden', 'message' => 'Token required'], JSON_UNESCAPED_UNICODE));
    }

    $stmt  = db()->prepare(
        'SELECT s.user_id FROM sessions s
         WHERE s.token = ? AND s.expires_at > NOW()
         LIMIT 1'
    );
    $stmt->execute([$token]);
    $user = $stmt->fetch();

    if (!$user) {
        http_response_code(403);
        header('Content-Type: application/json');
        die(json_encode(['error' => 'forbidden', 'message' => 'Invalid or expired token'], JSON_UNESCAPED_UNICODE));
    }
    return $user;
}

// ── Парсинг User-Agent ───────────────────────────────────────
function parse_user_agent(string $ua): string {
    $os = 'Неизвестная ОС';
    $browser = 'Неизвестный браузер';

    if (preg_match('/Windows NT 11\.0/i', $ua)) $os = 'Windows 11';
    elseif (preg_match('/Windows NT 10\.0/i', $ua)) $os = 'Windows 10';
    elseif (preg_match('/Windows NT 6\.[23]/i', $ua)) $os = 'Windows 8';
    elseif (preg_match('/Windows NT 6\.1/i', $ua)) $os = 'Windows 7';
    elseif (preg_match('/Mac OS X 10[_.](\d+)/i', $ua, $m)) $os = 'macOS 10.' . $m[1];
    elseif (preg_match('/Mac OS X 1[1-9][_.](\d+)?/i', $ua, $m)) $os = 'macOS';
    elseif (preg_match('/Macintosh(.*?)Mac OS X/i', $ua)) $os = 'macOS';
    elseif (preg_match('/Android\s([0-9\.]+)/i', $ua, $m)) $os = 'Android ' . $m[1];
    elseif (preg_match('/iPhone OS\s([0-9_]+)/i', $ua, $m)) $os = 'iPhone iOS ' . str_replace('_', '.', $m[1]);
    elseif (preg_match('/iPad.*OS\s([0-9_]+)/i', $ua, $m)) $os = 'iPadOS ' . str_replace('_', '.', $m[1]);
    elseif (preg_match('/Linux/i', $ua)) $os = 'Linux';

    if (preg_match('/Edg\/([0-9]+)/i', $ua, $m)) $browser = 'Edge ' . $m[1];
    elseif (preg_match('/OPR\/([0-9]+)/i', $ua, $m)) $browser = 'Opera ' . $m[1];
    elseif (preg_match('/YaBrowser\/([0-9]+)/i', $ua, $m)) $browser = 'Yandex Browser ' . $m[1];
    elseif (preg_match('/Chrome\/([0-9]+)/i', $ua, $m)) $browser = 'Chrome ' . $m[1];
    elseif (preg_match('/Firefox\/([0-9]+)/i', $ua, $m)) $browser = 'Firefox ' . $m[1];
    elseif (preg_match('/Version\/([0-9]+).*Safari/i', $ua, $m)) $browser = 'Safari ' . $m[1];
    elseif (preg_match('/Safari/i', $ua)) $browser = 'Safari';

    if ($os === 'Неизвестная ОС' && $browser === 'Неизвестный браузер') {
        return mb_substr($ua, 0, 50) ?: 'Неизвестное устройство';
    }

    return "$os • $browser";
}

// ── Создать сессию ───────────────────────────────────────────
function create_session(int $userId): string {
    $token     = bin2hex(random_bytes(32));
    $expiresAt = date('Y-m-d H:i:s', strtotime('+' . SESSION_DAYS . ' days'));
    $device    = substr($_SERVER['HTTP_USER_AGENT'] ?? 'unknown', 0, 200);
    $ip        = $_SERVER['REMOTE_ADDR'] ?? '';

    $stmt = db()->prepare(
        'INSERT INTO sessions (user_id, token, device, ip, expires_at)
         VALUES (?, ?, ?, ?, ?)'
    );
    $stmt->execute([$userId, $token, $device, $ip, $expiresAt]);
    return $token;
}

// ── Домены которые нужно отправлять через Brevo ──────────────
const BREVO_DOMAINS = ['proton.me', 'protonmail.com', 'protonmail.ch', 'pm.me'];

function _is_brevo_recipient(string $to): bool {
    $domain = strtolower(substr(strrchr($to, '@'), 1));
    return in_array($domain, BREVO_DOMAINS, true);
}

// ── Отправка email (reg.ru SMTP или Brevo для Proton) ────────
function send_email(string $to, string $subject, string $htmlBody): bool {
    @include_once __DIR__ . '/PHPMailer/src/Exception.php';
    @include_once __DIR__ . '/PHPMailer/src/PHPMailer.php';
    @include_once __DIR__ . '/PHPMailer/src/SMTP.php';

    if (!class_exists('PHPMailer\PHPMailer\PHPMailer') && !class_exists('PHPMailer')) {
        @include_once __DIR__ . '/PHPMailer/PHPMailerAutoload.php';
    }

    $useBrevo = _is_brevo_recipient($to)
        && defined('BREVO_HOST')
        && defined('BREVO_PASSWORD')
        && BREVO_PASSWORD !== '';

    if ($useBrevo) {
        error_log("MAIL: Proton-адрес — отправка через Brevo → $to");
        $host     = BREVO_HOST;
        $port     = BREVO_PORT;
        $username = BREVO_USERNAME;
        $password = BREVO_PASSWORD;
        $secure   = 'tls';
    } else {
        error_log("MAIL: отправка через reg.ru SMTP → $to");
        $host     = MAIL_HOST;
        $port     = MAIL_PORT;
        $username = MAIL_USERNAME;
        $password = MAIL_PASSWORD;
        $secure   = ($port == 465) ? 'ssl' : 'tls';
    }

    try {
        if (class_exists('PHPMailer\PHPMailer\PHPMailer')) {
            $mail = new \PHPMailer\PHPMailer\PHPMailer(true);
        } elseif (class_exists('PHPMailer')) {
            $mail = new \PHPMailer(true);
        } else {
            error_log("MAIL: PHPMailer не найден — используется mail()");
            $headers  = "MIME-Version: 1.0\r\n";
            $headers .= "Content-type: text/html; charset=UTF-8\r\n";
            $headers .= "From: =?UTF-8?B?" . base64_encode(MAIL_FROM_NAME) . "?= <" . MAIL_FROM . ">\r\n";
            return mail($to, '=?UTF-8?B?' . base64_encode($subject) . '?=', $htmlBody, $headers, "-f " . MAIL_FROM);
        }

        $mail->isSMTP();
        $mail->Host       = $host;
        $mail->SMTPAuth   = true;
        $mail->Username   = $username;
        $mail->Password   = $password;
        $mail->SMTPSecure = $secure;
        $mail->Port       = $port;
        $mail->CharSet    = 'UTF-8';
        $mail->setFrom(MAIL_FROM, MAIL_FROM_NAME);
        $mail->addAddress($to);
        $mail->isHTML(true);
        $mail->Subject = $subject;
        $mail->Body    = $htmlBody;
        $mail->AltBody = strip_tags(str_replace(['<br>', '<br/>', '<br />', '</p>', '</div>', '</tr>', '</td>'], "\n", $htmlBody));

        $mail->send();
        return true;
    } catch (\Exception $e) {
        error_log("PHPMailer error (" . ($useBrevo ? 'Brevo' : 'reg.ru') . "): " . $e->getMessage());
        return false;
    }
}

// ── Email-шаблон для кода (Black & White style) ──────────────
function make_code_email(string $code): string {
    $safeCode = htmlspecialchars($code, ENT_QUOTES, 'UTF-8');

    return <<<HTML
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="dark light">
  <meta name="supported-color-schemes" content="dark light">
  <title>Код для входа в Initial</title>

  <style>
    @media only screen and (max-width: 600px) {
      .wrap { padding: 18px 12px !important; }
      .card { border-radius: 16px !important; }
      .hero, .content { padding-left: 20px !important; padding-right: 20px !important; }
      .hero { padding-top: 22px !important; padding-bottom: 18px !important; }
      .content { padding-top: 20px !important; padding-bottom: 22px !important; }
      .title { font-size: 24px !important; line-height: 30px !important; }
      .subtitle { font-size: 14px !important; line-height: 22px !important; }
      .code-wrap { border-radius: 12px !important; }
      .code { font-size: 38px !important; line-height: 44px !important; letter-spacing: 12px !important; }
      .stack-col, .stack-col-right { display: block !important; width: 100% !important; padding: 0 !important; }
      .stack-gap { height: 10px !important; line-height: 10px !important; font-size: 10px !important; }
      .brand-mark { width: 40px !important; height: 40px !important; line-height: 40px !important; font-size: 18px !important; border-radius: 10px !important; }
      .badge { font-size: 11px !important; padding: 7px 10px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#000000;color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Inter,Helvetica,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
    Ваш код для входа в Initial: {$safeCode}. Код действует 10 минут.
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#000000;">
    <tr>
      <td align="center" class="wrap" style="padding:40px 16px;">

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;margin:0 auto;">
          <!-- top pill -->
          <tr>
            <td align="center" style="padding:0 0 14px 0;">
              <span class="badge" style="
                display:inline-block;
                padding:8px 14px;
                font-size:12px;
                line-height:12px;
                letter-spacing:0.8px;
                text-transform:uppercase;
                color:#ffffff;
                background:#111111;
                border:1px solid #333333;
                border-radius:999px;
              ">
                Secure Sign-In
              </span>
            </td>
          </tr>

          <!-- card -->
          <tr>
            <td class="card" style="
              background:#0a0a0a;
              border:1px solid #333333;
              border-radius:20px;
              overflow:hidden;
            ">

              <!-- hero -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td class="hero" style="
                    padding:32px 32px 20px 32px;
                    background:#0a0a0a;
                    border-bottom:1px solid #222222;
                  ">

                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td valign="middle" style="padding:0;">
                          <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                            <tr>
                              <td valign="middle" style="padding:0 14px 0 0;">
                                <div class="brand-mark" style="
                                  width:44px;
                                  height:44px;
                                  line-height:44px;
                                  text-align:center;
                                  border-radius:12px;
                                  background:#111111;
                                  border:1px solid #444444;
                                  font-size:20px;
                                  font-weight:700;
                                  color:#ffffff;
                                ">I</div>
                              </td>
                              <td valign="middle" style="padding:0;">
                                <div style="
                                  font-size:18px;
                                  line-height:22px;
                                  font-weight:700;
                                  color:#ffffff;
                                  letter-spacing:0.3px;
                                ">
                                  Initial
                                </div>
                                <div style="
                                  padding-top:2px;
                                  font-size:13px;
                                  line-height:18px;
                                  color:#888888;
                                ">
                                  Безопасный вход
                                </div>
                              </td>
                            </tr>
                          </table>
                        </td>

                        <td align="right" valign="middle" style="padding:0;">
                          <span class="badge" style="
                            display:inline-block;
                            padding:8px 12px;
                            font-size:12px;
                            line-height:12px;
                            color:#bbbbbb;
                            background:#111111;
                            border:1px solid #333333;
                            border-radius:999px;
                          ">
                            10 минут
                          </span>
                        </td>
                      </tr>
                    </table>

                    <div style="height:28px;line-height:28px;font-size:28px;">&nbsp;</div>

                    <div class="title" style="
                      font-size:30px;
                      line-height:34px;
                      font-weight:700;
                      color:#ffffff;
                      letter-spacing:-0.5px;
                    ">
                      Код для входа
                    </div>

                    <div class="subtitle" style="
                      max-width:430px;
                      padding-top:10px;
                      font-size:14px;
                      line-height:24px;
                      color:#999999;
                    ">
                      Введите этот код в приложении Initial, чтобы подтвердить вход. Не передавайте его третьим лицам.
                    </div>

                  </td>
                </tr>

                <!-- content -->
                <tr>
                  <td class="content" style="padding:32px;">

                    <!-- code box -->
                    <table class="code-wrap" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="
                      background:#000000;
                      border:1px solid #333333;
                      border-radius:16px;
                    ">
                      <tr>
                        <td align="center" style="padding:14px 16px 8px 16px;">
                          <div style="
                            font-size:12px;
                            line-height:16px;
                            text-transform:uppercase;
                            letter-spacing:1.1px;
                            color:#888888;
                          ">
                            One-time code
                          </div>
                        </td>
                      </tr>
                      <tr>
                        <td align="center" style="padding:0 16px 24px 16px;">
                          <div title="Нажмите дважды для копирования" class="code" style="
                            font-size:46px;
                            line-height:50px;
                            font-weight:800;
                            letter-spacing:14px;
                            color:#ffffff;
                            user-select:all;
                            -webkit-user-select:all;
                            -moz-user-select:all;
                            -ms-user-select:all;
                          ">
                            {$safeCode}
                          </div>
                        </td>
                      </tr>
                    </table>

                    <div style="height:16px;line-height:16px;font-size:16px;">&nbsp;</div>

                    <!-- info cards -->
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td class="stack-col" valign="top" style="width:50%;padding:0 8px 0 0;">
                          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="
                            background:#111111;
                            border:1px solid #222222;
                            border-radius:14px;
                          ">
                            <tr>
                              <td style="padding:16px 16px 14px 16px;">
                                <div style="
                                  font-size:13px;
                                  line-height:18px;
                                  color:#888888;
                                ">
                                  Действует
                                </div>
                                <div style="
                                  padding-top:4px;
                                  font-size:16px;
                                  line-height:22px;
                                  font-weight:700;
                                  color:#ffffff;
                                ">
                                  10 минут
                                </div>
                              </td>
                            </tr>
                          </table>
                        </td>

                        <td class="stack-col-right" valign="top" style="width:50%;padding:0 0 0 8px;">
                          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="
                            background:#111111;
                            border:1px solid #222222;
                            border-radius:14px;
                          ">
                            <tr>
                              <td style="padding:16px 16px 14px 16px;">
                                <div style="
                                  font-size:13px;
                                  line-height:18px;
                                  color:#888888;
                                ">
                                  Назначение
                                </div>
                                <div style="
                                  padding-top:4px;
                                  font-size:16px;
                                  line-height:22px;
                                  font-weight:700;
                                  color:#ffffff;
                                ">
                                  Вход в аккаунт
                                </div>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>

                      <tr>
                        <td colspan="2" class="stack-gap" style="height:0;line-height:0;font-size:0;">&nbsp;</td>
                      </tr>
                    </table>

                    <div style="height:18px;line-height:18px;font-size:18px;">&nbsp;</div>

                    <!-- note -->
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="
                      background:#0a0a0a;
                      border:1px solid #222222;
                      border-radius:14px;
                    ">
                      <tr>
                        <td style="padding:16px 18px;">
                          <div style="
                            font-size:14px;
                            line-height:22px;
                            color:#aaaaaa;
                          ">
                            Если это были не вы, просто проигнорируйте это письмо. Войти без этого кода нельзя.
                          </div>
                        </td>
                      </tr>
                    </table>

                    <div style="height:22px;line-height:22px;font-size:22px;">&nbsp;</div>

                    <!-- footer -->
                    <div style="
                      font-size:12px;
                      line-height:20px;
                      color:#555555;
                      text-align:center;
                    ">
                      Это автоматическое письмо от Initial. Пожалуйста, не отвечайте на него.
                    </div>

                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- outer footer -->
          <tr>
            <td align="center" style="padding:16px 12px 0 12px;">
              <div style="
                font-size:11px;
                line-height:18px;
                color:#444444;
              ">
                © 2026 Initial
              </div>
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>
</body>
</html>
HTML;
}

// ── Получить OAuth2 Access Token для FCM v1 ──────────────────
function get_fcm_access_token(): ?string {
    $keyFile = defined('FCM_SERVICE_ACCOUNT_JSON') ? FCM_SERVICE_ACCOUNT_JSON : '';
    if (empty($keyFile) || !file_exists($keyFile)) return null;

    $key = json_decode(file_get_contents($keyFile), true);
    if (!$key) return null;

    $now = time();
    $header  = base64_encode(json_encode(['alg' => 'RS256', 'typ' => 'JWT']));
    $payload = base64_encode(json_encode([
        'iss'   => $key['client_email'],
        'scope' => 'https://www.googleapis.com/auth/firebase.messaging',
        'aud'   => 'https://oauth2.googleapis.com/token',
        'iat'   => $now,
        'exp'   => $now + 3600,
    ]));
    $header  = str_replace(['+', '/', '='], ['-', '_', ''], $header);
    $payload = str_replace(['+', '/', '='], ['-', '_', ''], $payload);

    $sig = '';
    openssl_sign("$header.$payload", $sig, $key['private_key'], 'SHA256');
    $sig = str_replace(['+', '/', '='], ['-', '_', ''], base64_encode($sig));

    $jwt = "$header.$payload.$sig";

    $ch = curl_init('https://oauth2.googleapis.com/token');
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POSTFIELDS     => http_build_query([
            'grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            'assertion'  => $jwt,
        ]),
        CURLOPT_TIMEOUT => 5,
    ]);
    $resp = curl_exec($ch);
    curl_close($ch);

    $json = json_decode($resp, true);
    return $json['access_token'] ?? null;
}

// ── ПЕРЕНЕСЕННЫЕ ИЗ VERIFY_CODE.PHP ФУНКЦИИ ─────────────────
function getSystemUserId(): ?int {
    $stmt = db()->prepare("SELECT id FROM users WHERE is_system = 1 AND signal_id = 'initial' LIMIT 1");
    $stmt->execute();
    $row = $stmt->fetch();
    return $row ? (int) $row['id'] : null;
}

function getOrCreateSystemChat(int $sysId, int $userId): int {
    $stmt = db()->prepare(
        "SELECT id FROM chats
         WHERE is_protected = 1
           AND (
               (user_a = ? AND user_b = ?)
            OR (user_a = ? AND user_b = ?)
           )
         LIMIT 1"
    );
    $stmt->execute([$sysId, $userId, $userId, $sysId]);
    $chat = $stmt->fetch();

    if ($chat) return (int) $chat['id'];

    db()->prepare("INSERT INTO chats (user_a, user_b, is_protected, created_at) VALUES (?, ?, 1, NOW())")
        ->execute([$sysId, $userId]);
    return (int) db()->lastInsertId();
}

function sendSystemMsg(int $userId, string $body): void {
    $sysId = getSystemUserId();
    if (!$sysId) return;

    $chatId = getOrCreateSystemChat($sysId, $userId);

    $stmt = db()->prepare(
        "INSERT INTO messages (chat_id, sender_id, body, sent_at, is_read)
         VALUES (:cid, :sid, :body, NOW(), 0)"
    );
    $stmt->execute([':cid' => $chatId, ':sid' => $sysId, ':body' => $body]);
}

function sendLoginNotification(int $userId): void {
    $ip = $_SERVER['HTTP_CF_CONNECTING_IP'] ?? $_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? 'неизвестен';
    $ip = trim(explode(',', $ip)[0]);
    if ($ip === '::1') $ip = '127.0.0.1';

    if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6)) {
        if (strpos($ip, '::ffff:') === 0) {
            $ip = substr($ip, 7);
        }
    }

    $uaRaw = $_SERVER['HTTP_USER_AGENT'] ?? '';
    $ua    = parse_user_agent($uaRaw);
    $time  = date('d.m.Y в H:i');

    $body = implode("\n", [
        '🔐 **Новый вход в аккаунт**',
        '',
        "🕐 Время: {$time}",
        "🌐 IP-адрес: ||{$ip}||",
        "📱 Устройство: {$ua}",
        '',
        'Если это были не Вы, перейдите в **Настройки ⇾ Устройства** и закройте неизвестный сеанс.',
    ]);

    sendSystemMsg($userId, $body);
}

// ── Push-уведомление через FCM v1 (data-only) ────────────────
function send_push(string $token, string $title, string $body, array $data = []): void
{
    if (empty($token)) return;

    $accessToken = get_fcm_access_token();
    if (!$accessToken) {
        error_log('FCM: access token не получен — проверьте FCM_SERVICE_ACCOUNT_JSON в config.php');
        return;
    }

    $projectId = defined('FCM_PROJECT_ID') ? FCM_PROJECT_ID : getenv('FCM_PROJECT_ID');
    if (empty($projectId)) {
        error_log('FCM: FCM_PROJECT_ID не задан в config.php');
        return;
    }

    $strData = array_map('strval', array_merge($data, [
        'title'         => $title,
        'body'          => $body,
        'sender_avatar' => $data['sender_avatar'] ?? '',
    ]));

    $payload = [
        'message' => [
            'token'   => $token,
            'data'    => $strData,
            'android' => [
                'priority' => 'high',
            ],
        ],
    ];

    $ch = curl_init("https://fcm.googleapis.com/v1/projects/{$projectId}/messages:send");
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_HTTPHEADER     => [
            'Authorization: Bearer ' . $accessToken,
            'Content-Type: application/json',
        ],
        CURLOPT_POSTFIELDS     => json_encode($payload),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 5,
    ]);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode !== 200) {
        error_log("FCM error {$httpCode}: {$response}");
    }
}

// ============================================================
//  PDO alias (для совместимости)
// ============================================================
function get_pdo(): PDO {
    return db();
}

// ============================================================
//  Голосовые сообщения — вспомогательные функции
//  Текстовые данные на сервере (MySQL), медиа в S3
//  s3_upload() живёт в s3_helper.php (уже существует на сервере)
// ============================================================

/**
 * Расшифровка AES-256-GCM
 *
 * @param string $cipherText Зашифрованные данные (IV + ciphertext + tag)
 * @param string $keyHex     Ключ в hex (64 символа = 32 байта)
 * @param string $ivHex      Вектор инициализации в hex (24 символа = 12 байт)
 * @return string|false Расшифрованные данные или false при ошибке
 */
function decrypt_aes256gcm(string $cipherText, string $keyHex, string $ivHex): string|false
{
    $keyBin = @hex2bin($keyHex);
    $ivBin  = @hex2bin($ivHex);

    if ($keyBin === false || strlen($keyBin) !== 32) {
        error_log('decrypt_aes256gcm: неверная длина ключа (' . strlen($keyBin ?? '') . ' байт, нужно 32)');
        return false;
    }
    if ($ivBin === false || strlen($ivBin) !== 12) {
        error_log('decrypt_aes256gcm: неверная длина IV (' . strlen($ivBin ?? '') . ' байт, нужно 12)');
        return false;
    }

    return @openssl_decrypt($cipherText, 'aes-256-gcm', $keyBin, OPENSSL_RAW_DATA, $ivBin);
}

/**
 * Определить MIME-тип и расширение аудиофайла
 *
 * @param string $filePath Путь к файлу
 * @return array{mime: string, ext: string}
 */
function detect_audio_mime_ext(string $filePath): array
{
    $mime = '';

    if (function_exists('mime_content_type')) {
        $mime = @mime_content_type($filePath) ?: '';
    }
    if (empty($mime)) {
        $finfo = @finfo_open(FILEINFO_MIME_TYPE);
        if ($finfo) {
            $mime = @finfo_file($finfo, $filePath) ?: '';
            finfo_close($finfo);
        }
    }

    // Определяем расширение по MIME
    $ext = 'webm'; // default (MediaRecorder в браузерах пишет webm/opus)
    if (str_contains($mime, 'ogg'))                                                          $ext = 'ogg';
    elseif (str_contains($mime, 'mp4') || str_contains($mime, 'm4a') || str_contains($mime, 'aac')) $ext = 'm4a';
    elseif (str_contains($mime, 'mpeg') || str_contains($mime, 'mp3'))                       $ext = 'mp3';
    elseif (str_contains($mime, 'wav'))                                                      $ext = 'wav';
    elseif (str_contains($mime, 'webm'))                                                     $ext = 'webm';

    return [
        'mime' => (!empty($mime) && str_contains($mime, 'audio')) ? $mime : 'audio/webm',
        'ext'  => $ext,
    ];
}

/**
 * Получить длительность аудио (секунды)
 *
 * Приоритет: ffprobe > оценка по размеру (~4 КБ/сек для opus)
 *
 * @param string $filePath Путь к файлу
 * @param int    $fileSize Размер файла в байтах (0 = auto-detect)
 * @return int Длительность в секундах (минимум 1)
 */
function get_audio_duration(string $filePath, int $fileSize = 0): int
{
    // Пробуем ffprobe
    if (function_exists('exec')) {
        $ffprobe = @exec('which ffprobe 2>/dev/null');
        if (!empty($ffprobe)) {
            $cmd  = escapeshellcmd($ffprobe)
                  . ' -v quiet -print_format json -show_format '
                  . escapeshellarg($filePath) . ' 2>/dev/null';
            $json = @json_decode(@shell_exec($cmd) ?: '', true);
            if (isset($json['format']['duration'])) {
                $dur = (int) ceil((float) $json['format']['duration']);
                return max(1, $dur);
            }
        }
    }

    // Fallback: оценка по размеру (opus ~4 КБ/сек при 32 кбит/с)
    if ($fileSize <= 0 && file_exists($filePath)) {
        $fileSize = (int) filesize($filePath);
    }
    if ($fileSize > 0) {
        return max(1, (int) ceil($fileSize / 4000));
    }

    return 1;
}

/**
 * Валидировать и нормализовать waveform JSON
 *
 * Клиент присылает массив значений 0-1 для визуализации волны.
 * Функция проверяет JSON, ограничивает длину и нормализует значения.
 *
 * @param string $jsonRaw Сырая JSON-строка
 * @return string Валидный JSON-массив (максимум 64 значения)
 */
function validate_waveform_json(string $jsonRaw): string
{
    if (empty($jsonRaw)) return '[]';

    $decoded = @json_decode($jsonRaw, true);
    if (!is_array($decoded)) return '[]';

    // Ограничиваем 64 сэмплами, нормализуем 0-1
    $cleaned = [];
    foreach (array_slice($decoded, 0, 64) as $v) {
        $v = (float) $v;
        if ($v < 0.0) $v = 0.0;
        if ($v > 1.0) $v = 1.0;
        $cleaned[] = round($v, 4);
    }

    return json_encode($cleaned, JSON_UNESCAPED_UNICODE);
}

/**
 * Проверить загруженный голосовой файл
 *
 * @param array $file Элемент $_FILES['voice']
 * @param int   $maxBytes Максимальный размер в байтах
 * @return array{tmp: string, size: int} Путь и размер, или exit с ошибкой
 */
function validate_voice_upload(array $file, int $maxBytes = 26214400): array
{
    // Проверяем что файл загружен
    if (empty($file) || ($file['error'] ?? -1) !== UPLOAD_ERR_OK) {
        $code = $file['error'] ?? -1;
        json_err('no_file', "Голосовое сообщение не получено (upload error: {$code})");
    }

    $tmpPath = $file['tmp_name'];
    $size    = (int) ($file['size'] ?? 0);

    if ($size > $maxBytes) {
        $mb = round($maxBytes / 1024 / 1024, 1);
        json_err('file_too_large', "Максимальный размер голосового — {$mb} МБ");
    }
    if ($size < 1) {
        json_err('empty_file', 'Пустой файл');
    }

    return ['tmp' => $tmpPath, 'size' => $size];
}

/**
 * Сформировать S3-путь для голосового сообщения
 *
 * @param int    $userId ID пользователя
 * @param string $ext    Расширение файла (webm, ogg, mp3, …)
 * @return array{key: string, mime: string}
 */
function make_voice_s3_path(int $userId, string $ext = 'webm'): array
{
    $uid16 = bin2hex(random_bytes(8));
    return [
        'key'  => "media/voice/{$userId}/{$uid16}.{$ext}",
        'mime' => 'audio/' . $ext,
    ];
}
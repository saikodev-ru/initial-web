<?php
// /api/debug_push.php — УДАЛИТЬ ПОСЛЕ ОТЛАДКИ
declare(strict_types=1);
require_once __DIR__ . '/helpers.php';
set_cors_headers();
auth_user(); // только для авторизованных

$results = [];

// 1. Проверяем FCM_PROJECT_ID
$projectId = getenv('FCM_PROJECT_ID');
if (empty($projectId) && defined('FCM_PROJECT_ID')) $projectId = FCM_PROJECT_ID;
$results['project_id'] = $projectId ?: '❌ ПУСТО';

// 2. Проверяем файл сервисного аккаунта
$keyFile = defined('FCM_SERVICE_ACCOUNT_JSON') ? FCM_SERVICE_ACCOUNT_JSON : getenv('GOOGLE_APPLICATION_CREDENTIALS');
$results['key_file_path']   = $keyFile ?: '❌ не задан';
$results['key_file_exists'] = $keyFile && file_exists($keyFile) ? '✅ файл есть' : '❌ файл НЕ найден';

// 3. Пробуем получить токен
$token = get_fcm_access_token();
$results['access_token'] = $token ? '✅ получен (' . strlen($token) . ' символов)' : '❌ null — JWT/cURL упал';

// 4. Проверяем fcm_token у пользователей
$stmt = db()->query('SELECT id, nickname, LEFT(fcm_token, 20) as token_preview FROM users WHERE fcm_token IS NOT NULL AND fcm_token != "" LIMIT 5');
$results['users_with_tokens'] = $stmt->fetchAll();

// 5. Если токен есть — пробуем отправить тестовый пуш первому юзеру
if ($token && !empty($results['users_with_tokens'])) {
    $stmt2 = db()->query('SELECT fcm_token FROM users WHERE fcm_token IS NOT NULL AND fcm_token != "" LIMIT 1');
    $fcmToken = $stmt2->fetchColumn();

    $payload = [
        'message' => [
            'token' => $fcmToken,
            'data'  => ['chat_id' => '1', 'sender_signal_id' => 'debug', 'media_type' => ''],
            'android' => [
                'priority' => 'high',
                'notification' => ['title' => '🔔 Тест', 'body' => 'FCM работает', 'channel_id' => 'messages'],
            ],
            'webpush' => [
                'headers' => ['Urgency' => 'high'],
                'notification' => ['title' => '🔔 Тест', 'body' => 'FCM работает', 'icon' => '/icons/icon-192.png'],
                'fcm_options' => ['link' => '/'],
            ],
        ],
    ];

    $ch = curl_init("https://fcm.googleapis.com/v1/projects/{$projectId}/messages:send");
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_HTTPHEADER     => ['Authorization: Bearer ' . $token, 'Content-Type: application/json'],
        CURLOPT_POSTFIELDS     => json_encode($payload),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 10,
    ]);
    $resp     = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    $results['fcm_test_http_code'] = $httpCode;
    $results['fcm_test_response']  = json_decode($resp, true) ?: $resp;
}

json_ok(['debug' => $results]);
<?php
declare(strict_types=1);

require_once __DIR__ . '/helpers.php';
set_cors_headers();

// Получаем путь запроса
$requestUri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);

// Убираем базовый путь /api/ (если сервер настроен так)
$basePath = '/api/';
if (strpos($requestUri, $basePath) === 0) {
    $route = substr($requestUri, strlen($basePath));
} else {
    $route = basename($requestUri);
}

$route = trim($route, '/');

// Карта маршрутов (Чистый URL => Файл обработчика)
// Позже эти файлы можно будет заменить на вызовы контроллеров
$routes = [
    'send_message'     => 'send_message.php',
    'get_messages'     => 'get_messages.php',
    'verify_code'      => 'verify_code.php',
    'send_code'        => 'send_code.php',
    'update_profile'   => 'update_profile.php',
    'upload_media'     => 'upload_media.php',
    'upload_file'     => 'upload_file.php',
    'send_voice_message'     => 'send_voice_message.php',
    'get_media'        => 'get_media.php',
    'search_user'      => 'search_user.php',
    'get_me'           => 'get_me.php',
    'qr_create'        => 'qr_create.php',
    'qr_poll'          => 'qr_poll.php',
    'qr_approve'       => 'qr_approve.php',
    'qr_link_create'   => 'qr_link_create.php',
    'qr_link_consume'  => 'qr_link_consume.php',
    'sessions'         => 'sessions.php',
    'react_message'    => 'react_message.php',
    'delete_message'   => 'delete_message.php',
    'delete_chat'      => 'delete_chat.php',
    'pin_chat'         => 'pin_chat.php',
    'mute_chat'        => 'mute_chat.php',
    'call_signal'      => 'call_signal.php',
    'get_call_signals' => 'get_call_signals.php',
    'get_reactions'    => 'get_reactions.php',
    'link_preview'     => 'link_preview.php'
];

if ($route === '') {
    json_ok(['service' => 'Initial API', 'status' => 'running', 'router' => true]);
}

if (array_key_exists($route, $routes)) {
    $file = __DIR__ . '/' . $routes[$route];
    if (file_exists($file)) {
        // Подключаем старый файл. В будущем здесь будет $controller->action()
        require $file;
    } else {
        json_err('internal_error', 'Файл обработчика не найден', 500);
    }
} else {
    json_err('not_found', 'Эндпоинт не найден: ' . $route, 404);
}
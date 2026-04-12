<?php
declare(strict_types=1);

require_once __DIR__ . '/helpers.php';

// ── Security headers (дублируются из helpers.php для надёжности) ──
security_init();

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
$routes = [
    'send_message'        => 'send_message.php',
    'get_messages'        => 'get_messages.php',
    'verify_code'         => 'verify_code.php',
    'send_code'           => 'send_code.php',
    'update_profile'      => 'update_profile.php',
    'upload_media'        => 'upload_media.php',
    'upload_file'         => 'upload_file.php',
    'send_voice_message'  => 'send_voice_message.php',
    'get_media'           => 'get_media.php',
    'search_user'         => 'search_user.php',
    'get_me'              => 'get_me.php',
    'qr_create'           => 'qr_create.php',
    'qr_poll'             => 'qr_poll.php',
    'qr_approve'          => 'qr_approve.php',
    'qr_link_create'      => 'qr_link_create.php',
    'qr_link_consume'     => 'qr_link_consume.php',
    'sessions'            => 'sessions.php',
    'react_message'       => 'react_message.php',
    'delete_message'      => 'delete_message.php',
    'delete_chat'         => 'delete_chat.php',
    'pin_chat'            => 'pin_chat.php',
    'call_signal'         => 'call_signal.php',
    'get_call_signals'    => 'get_call_signals.php',
    'get_reactions'       => 'get_reactions.php',
    'link_preview'        => 'link_preview.php',
    'update_presence'     => 'update_presence.php',
    'upload_avatar'       => 'upload_avatar.php',
    'edit_message'        => 'edit_message.php',
    'register_fcm'        => 'register_fcm.php',
    'poll_updates'        => 'poll_updates.php',
    'search_messages'     => 'search_messages.php',

    // ── Channels ──────────────────────────────────────────────
    'create_channel'         => 'create_channel.php',
    'get_channels'           => 'get_channels.php',
    'get_channel_info'       => 'get_channel_info.php',
    'join_channel'           => 'join_channel.php',
    'leave_channel'          => 'leave_channel.php',
    'send_channel_message'   => 'send_channel_message.php',
    'get_channel_messages'   => 'get_channel_messages.php',
    'edit_channel'           => 'edit_channel.php',
    'delete_channel'         => 'delete_channel.php',
    'get_channel_members'    => 'get_channel_members.php',
    'get_channel_link'       => 'get_channel_link.php',
    'update_channel_member'  => 'update_channel_member.php',
    'delete_channel_message' => 'delete_channel_message.php',
    'search_channels'        => 'search_channels.php',
    'pin_channel_message'    => 'pin_channel_message.php',
];

// ── Запрещённые маршруты ────────────────────────────────────────
$forbidden = ['config'];

if ($route === '') {
    json_ok(['service' => 'Initial API', 'status' => 'running', 'router' => true]);
}

// ── Блокируем запрещённые маршруты ──────────────────────────────
if (in_array($route, $forbidden, true)) {
    json_err('forbidden', 'Эндпоинт недоступен', 403);
}

if (array_key_exists($route, $routes)) {
    $file = __DIR__ . '/' . $routes[$route];
    if (file_exists($file)) {
        require $file;
    } else {
        json_err('internal_error', 'Файл обработчика не найден', 500);
    }
} else {
    json_err('not_found', 'Эндпоинт не найден: ' . $route, 404);
}

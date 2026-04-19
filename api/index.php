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

// ── Карта маршрутов (Чистый URL => Файл обработчика) ────────────
// Структурировано по категориям для удобства навигации.

$routes = [

    // ── Аутентификация ──────────────────────────────────────────
    'send_code'           => 'auth/send_code.php',
    'verify_code'         => 'auth/verify_code.php',
    'sessions'            => 'auth/sessions.php',
    'qr_create'           => 'auth/qr_create.php',
    'qr_poll'             => 'auth/qr_poll.php',
    'qr_approve'          => 'auth/qr_approve.php',
    'qr_link_create'      => 'auth/qr_link_create.php',
    'qr_link_consume'     => 'auth/qr_link_consume.php',

    // ── Профиль пользователя ────────────────────────────────────
    'get_me'              => 'user/get_me.php',
    'update_profile'      => 'user/update_profile.php',
    'upload_avatar'       => 'user/upload_avatar.php',
    'search_user'         => 'user/search_user.php',
    'resolve_profile'     => 'user/resolve_profile.php',

    // ── Личные сообщения ────────────────────────────────────────
    'send_message'        => 'messages/send_message.php',
    'get_messages'        => 'messages/get_messages.php',
    'edit_message'        => 'messages/edit_message.php',
    'delete_message'      => 'messages/delete_message.php',
    'search_messages'     => 'messages/search_messages.php',
    'react_message'       => 'messages/react_message.php',
    'get_reactions'       => 'messages/get_reactions.php',
    'link_preview'        => 'messages/link_preview.php',
    'poll_updates'        => 'messages/poll_updates.php',
    'update_presence'     => 'messages/update_presence.php',

    // ── Каналы ──────────────────────────────────────────────────
    'create_channel'         => 'channels/create_channel.php',
    'get_channels'           => 'channels/get_channels.php',
    'get_channel_info'       => 'channels/get_channel_info.php',
    'edit_channel'           => 'channels/edit_channel.php',
    'delete_channel'         => 'channels/delete_channel.php',
    'join_channel'           => 'channels/join_channel.php',
    'leave_channel'          => 'channels/leave_channel.php',
    'send_channel_message'   => 'channels/send_channel_message.php',
    'get_channel_messages'   => 'channels/get_channel_messages.php',
    'delete_channel_message' => 'channels/delete_channel_message.php',
    'get_channel_members'    => 'channels/get_channel_members.php',
    'update_channel_member'  => 'channels/update_channel_member.php',
    'get_channel_link'       => 'channels/get_channel_link.php',
    'search_channels'        => 'channels/search_channels.php',
    'mute_channel'           => 'channels/mute_channel.php',
    'pin_channel_message'    => 'channels/pin_channel_message.php',
    'upload_channel_avatar'  => 'channels/upload_channel_avatar.php',
    'react_channel_message'    => 'channels/react_channel_message.php',
    'get_pinned_channel_message'=> 'channels/get_pinned_channel_message.php',
    'get_channel_comments'     => 'channels/get_channel_comments.php',
    'send_channel_comment'     => 'channels/send_channel_comment.php',
    'delete_channel_comment'   => 'channels/delete_channel_comment.php',

    // ── Закреплённые сообщения ──────────────────────────────────
    'pin_message'          => 'pins/pin_message.php',
    'get_pinned_message'   => 'pins/get_pinned_message.php',
    'get_pinned_messages'  => 'pins/get_pinned_messages.php',
    'pin_chat'             => 'pins/pin_chat.php',

    // ── Звонки ──────────────────────────────────────────────────
    'call_signal'          => 'calls/call_signal.php',
    'get_call_signals'     => 'calls/get_call_signals.php',

    // ── Медиа и файлы ───────────────────────────────────────────
    'upload_file'          => 'media/upload_file.php',
    'upload_media'         => 'media/upload_media.php',
    'send_voice_message'   => 'media/send_voice_message.php',
    'get_media'            => 'media/get_media.php',

    // ── Управление чатами ───────────────────────────────────────
    'delete_chat'          => 'chat/delete_chat.php',

    // ── Уведомления ─────────────────────────────────────────────
    'register_fcm'        => 'notifications/register_fcm.php',
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

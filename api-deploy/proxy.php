<?php
/**
 * proxy.php — пересылает все запросы к Node.js бэкенду.
 */
$BACKEND = 'http://127.0.0.1:38491';

// Путь запроса (например, /api/qr_create.php → /api/qr_create)
$uri = $_SERVER['REQUEST_URI'];
// Отсекаем расширение .php для новых Node.js роутов
$uri = preg_replace('/\.php(\?|$)/', '$1', $uri);

$incoming_headers = getallheaders();
$forward_headers = [];
$has_auth = false;

foreach ($incoming_headers as $name => $value) {
    if (in_array(strtolower($name), ['host', 'transfer-encoding', 'connection'])) continue;
    if (strtolower($name) === 'authorization') $has_auth = true;
    $forward_headers[] = "$name: $value";
}

// Fallback for Apache-stripped Authorization
if (!$has_auth) {
    if (isset($_SERVER['HTTP_AUTHORIZATION'])) {
        $forward_headers[] = "Authorization: " . $_SERVER['HTTP_AUTHORIZATION'];
    } elseif (isset($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
        $forward_headers[] = "Authorization: " . $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
    }
}

$method = $_SERVER['REQUEST_METHOD'];
$ch = curl_init($BACKEND . $uri);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_HEADER, true);
curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
curl_setopt($ch, CURLOPT_TIMEOUT, 60);

// Multipart Handling
$is_multipart = isset($_SERVER['CONTENT_TYPE']) && stripos($_SERVER['CONTENT_TYPE'], 'multipart/form-data') !== false;

if ($is_multipart) {
    // For multipart, we rebuild the fields to let cURL handle the boundary
    $post_data = $_POST;
    foreach ($_FILES as $name => $file) {
        if (is_array($file['tmp_name'])) {
            foreach ($file['tmp_name'] as $i => $tmp) {
                $post_data[$name."[$i]"] = new CURLFile($tmp, $file['type'][$i], $file['name'][$i]);
            }
        } else {
            $post_data[$name] = new CURLFile($file['tmp_name'], $file['type'], $file['name']);
        }
    }
    curl_setopt($ch, CURLOPT_POSTFIELDS, $post_data);
    
    // Filter out content-type from headers, let cURL set it with boundary
    $filtered_headers = [];
    foreach ($forward_headers as $h) {
        if (stripos($h, 'Content-Type:') === 0 || stripos($h, 'Content-Length:') === 0) continue;
        $filtered_headers[] = $h;
    }
    curl_setopt($ch, CURLOPT_HTTPHEADER, $filtered_headers);
} else {
    curl_setopt($ch, CURLOPT_HTTPHEADER, $forward_headers);
    if (in_array($method, ['POST', 'PUT', 'PATCH', 'DELETE'])) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, file_get_contents('php://input'));
    }
}

$response = curl_exec($ch);
$http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$header_size = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
curl_close($ch);

$headers = substr($response, 0, $header_size);
$body = substr($response, $header_size);

http_response_code($http_code);
foreach (explode("\r\n", $headers) as $line) {
    if (!trim($line) || stripos($line, 'http/') === 0) continue;
    header($line, false);
}
echo $body;

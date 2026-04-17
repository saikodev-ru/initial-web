<?php
// GET /api/link_preview.php?url=https://example.com
// Returns JSON with OG metadata for link preview cards
declare(strict_types=1);
require_once __DIR__ . '/helpers.php';

set_cors_headers();
if ($_SERVER['REQUEST_METHOD'] !== 'GET') json_err('method_not_allowed', 'Только GET', 405);

require_rate_limit('link_preview', 20, 60);

/**
 * SSRF-safe URL fetch using curl with pinned IP.
 * Prevents DNS rebinding by resolving once and using CURLOPT_RESOLVE.
 */
function _ssrf_safe_fetch(string $url, string $pinnedIp, int $timeout = 6, int $maxBytes = 65536): string|false {
    $host = parse_url($url, PHP_URL_HOST);
    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL            => $url,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => $timeout,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS      => 3,
        CURLOPT_CONNECTTIMEOUT => $timeout,
        CURLOPT_RESOLVE        => ["{$host}:443:{$pinnedIp}", "{$host}:80:{$pinnedIp}"],
        CURLOPT_USERAGENT      => 'InitialBot/1.0 (+https://initial.su)',
        CURLOPT_HTTPHEADER     => ['Accept: text/html,application/xhtml+xml'],
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_RANGE          => "0-{$maxBytes}",
    ]);
    $result = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return ($httpCode >= 200 && $httpCode < 300) ? $result : false;
}

// Auth not required for public link previews, but rate-limit by IP
$url = trim($_GET['url'] ?? '');
if (!$url || !filter_var($url, FILTER_VALIDATE_URL)) {
    json_err('invalid_url', 'Некорректный URL', 400);
}

// Only allow http/https
$scheme = parse_url($url, PHP_URL_SCHEME);
if (!in_array($scheme, ['http', 'https'], true)) {
    json_err('invalid_url', 'Только HTTP/HTTPS', 400);
}

// Block internal/private addresses
$host = parse_url($url, PHP_URL_HOST);
if (!$host) json_err('invalid_url', 'Некорректный хост', 400);

// SSRF-защита: резолвим DNS и пиним IP (предотвращаем DNS rebinding)
$resolvedIp = gethostbyname($host);
if ($resolvedIp === $host) {
    json_err('invalid_url', 'Не удалось разрешить хост', 400);
}
if (filter_var($resolvedIp, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) === false) {
    json_err('blocked', 'Приватный адрес', 403);
}
if (filter_var($resolvedIp, FILTER_VALIDATE_IP, FILTER_FLAG_NO_LOOP_RANGE) === false) {
    json_err('blocked', 'Приватный адрес', 403);
}

// ── Rich embed detection (no fetch needed) ────────────────────
function detect_embed(string $url, string $host): ?array {
    // YouTube
    if (preg_match('/(?:youtube\.com|youtu\.be)/', $host)) {
        $videoId = null;
        if (preg_match('/[?&]v=([a-zA-Z0-9_-]{11})/', $url, $m)) {
            $videoId = $m[1];
        } elseif (preg_match('/youtu\.be\/([a-zA-Z0-9_-]{11})/', $url, $m)) {
            $videoId = $m[1];
        } elseif (preg_match('/shorts\/([a-zA-Z0-9_-]{11})/', $url, $m)) {
            $videoId = $m[1];
        } elseif (preg_match('/embed\/([a-zA-Z0-9_-]{11})/', $url, $m)) {
            $videoId = $m[1];
        }
        if ($videoId) {
            // oEmbed API — возвращает title, thumbnail, author
            $oembed = @file_get_contents(
                'https://www.youtube.com/oembed?url=' . urlencode($url) . '&format=json',
                false,
                stream_context_create(['http' => ['timeout' => 4]])
            );
            $meta = $oembed ? json_decode($oembed, true) : [];
            return [
                'embed_type'  => 'youtube',
                'video_id'    => $videoId,
                'title'       => $meta['title']        ?? 'YouTube',
                'description' => $meta['author_name']  ?? '',
                'image'       => "https://i.ytimg.com/vi/{$videoId}/hqdefault.jpg",
                'domain'      => 'youtube.com',
                'site_name'   => 'YouTube',
                'url'         => $url,
            ];
        }
    }

    // Spotify
    if (preg_match('/open\.spotify\.com/', $host)) {
        $oembedUrl = 'https://open.spotify.com/oembed?url=' . urlencode($url);
        $oembed = @file_get_contents($oembedUrl, false,
            stream_context_create(['http' => ['timeout' => 4]]));
        $meta = $oembed ? json_decode($oembed, true) : [];
        if ($meta && !empty($meta['title'])) {
            // Определяем тип (track/album/playlist/episode)
            preg_match('/open\.spotify\.com\/(track|album|playlist|episode|show)\//', $url, $tm);
            $spType = $tm[1] ?? 'track';
            return [
                'embed_type'  => 'spotify',
                'spotify_type'=> $spType,
                'title'       => $meta['title']          ?? 'Spotify',
                'description' => $meta['provider_name']  ?? 'Spotify',
                'image'       => $meta['thumbnail_url']  ?? '',
                'domain'      => 'open.spotify.com',
                'site_name'   => 'Spotify',
                'url'         => $url,
            ];
        }
    }

    // Vimeo
    if (preg_match('/vimeo\.com/', $host)) {
        preg_match('/vimeo\.com\/(\d+)/', $url, $vm);
        if (!empty($vm[1])) {
            $oembed = @file_get_contents(
                'https://vimeo.com/api/oembed.json?url=' . urlencode($url),
                false,
                stream_context_create(['http' => ['timeout' => 4]])
            );
            $meta = $oembed ? json_decode($oembed, true) : [];
            return [
                'embed_type'  => 'vimeo',
                'video_id'    => $vm[1],
                'title'       => $meta['title']       ?? 'Vimeo',
                'description' => $meta['author_name'] ?? '',
                'image'       => $meta['thumbnail_url'] ?? '',
                'domain'      => 'vimeo.com',
                'site_name'   => 'Vimeo',
                'url'         => $url,
            ];
        }
    }

    // SoundCloud
    if (preg_match('/soundcloud\.com/', $host)) {
        $oembed = @file_get_contents(
            'https://soundcloud.com/oembed?url=' . urlencode($url) . '&format=json',
            false,
            stream_context_create(['http' => ['timeout' => 4]])
        );
        $meta = $oembed ? json_decode($oembed, true) : [];
        if ($meta && !empty($meta['title'])) {
            return [
                'embed_type'  => 'soundcloud',
                'title'       => $meta['title']          ?? 'SoundCloud',
                'description' => $meta['author_name']    ?? '',
                'image'       => $meta['thumbnail_url']  ?? '',
                'domain'      => 'soundcloud.com',
                'site_name'   => 'SoundCloud',
                'url'         => $url,
            ];
        }
    }

    // Twitch clip/channel
    if (preg_match('/twitch\.tv/', $host)) {
        $oembed = @file_get_contents(
            'https://api.twitch.tv/v5/oembed?url=' . urlencode($url),
            false,
            stream_context_create(['http' => ['timeout' => 4]])
        );
        $meta = $oembed ? json_decode($oembed, true) : [];
        if ($meta && !empty($meta['title'])) {
            return [
                'embed_type'  => 'twitch',
                'title'       => $meta['title']         ?? 'Twitch',
                'description' => $meta['author_name']   ?? '',
                'image'       => $meta['thumbnail_url'] ?? '',
                'domain'      => 'twitch.tv',
                'site_name'   => 'Twitch',
                'url'         => $url,
            ];
        }
    }

    return null;
}

$embed = detect_embed($url, $host);
if ($embed !== null) {
    $embed['ok'] = true;
    echo json_encode($embed);
    exit;
}

// Fetch the URL (SSRF-safe: pinned IP prevents DNS rebinding)
$html = _ssrf_safe_fetch($url, $resolvedIp);
if ($html === false || strlen($html) < 50) {
    json_err('fetch_error', 'Не удалось получить страницу', 422);
}

// Parse OG / meta tags
function extractMeta(string $html): array {
    $data = [
        'title'       => '',
        'description' => '',
        'image'       => '',
        'url'         => '',
        'site_name'   => '',
    ];

    // OG tags
    preg_match_all('/<meta[^>]+property=["\']og:([^"\']+)["\'][^>]+content=["\']([^"\']*)["\'][^>]*>/i', $html, $m);
    foreach ($m[1] as $i => $prop) {
        $prop = strtolower(trim($prop));
        if (isset($data[$prop])) $data[$prop] = html_entity_decode($m[2][$i], ENT_QUOTES | ENT_HTML5, 'UTF-8');
    }
    // Also try reversed attribute order (content before property)
    preg_match_all('/<meta[^>]+content=["\']([^"\']*)["\'][^>]+property=["\']og:([^"\']+)["\'][^>]*>/i', $html, $m2);
    foreach ($m2[2] as $i => $prop) {
        $prop = strtolower(trim($prop));
        if (isset($data[$prop]) && empty($data[$prop])) $data[$prop] = html_entity_decode($m2[1][$i], ENT_QUOTES | ENT_HTML5, 'UTF-8');
    }

    // Twitter card fallback
    if (empty($data['title'])) {
        preg_match('/<meta[^>]+name=["\']twitter:title["\'][^>]+content=["\']([^"\']*)["\'][^>]*>/i', $html, $m3);
        if (!empty($m3[1])) $data['title'] = html_entity_decode($m3[1], ENT_QUOTES | ENT_HTML5, 'UTF-8');
    }
    if (empty($data['description'])) {
        preg_match('/<meta[^>]+name=["\']twitter:description["\'][^>]+content=["\']([^"\']*)["\'][^>]*>/i', $html, $m4);
        if (!empty($m4[1])) $data['description'] = html_entity_decode($m4[1], ENT_QUOTES | ENT_HTML5, 'UTF-8');
    }
    if (empty($data['image'])) {
        preg_match('/<meta[^>]+name=["\']twitter:image["\'][^>]+content=["\']([^"\']*)["\'][^>]*>/i', $html, $m5);
        if (!empty($m5[1])) $data['image'] = html_entity_decode($m5[1], ENT_QUOTES | ENT_HTML5, 'UTF-8');
    }

    // <title> fallback
    if (empty($data['title'])) {
        preg_match('/<title[^>]*>([^<]{1,200})<\/title>/is', $html, $mt);
        if (!empty($mt[1])) $data['title'] = html_entity_decode(trim($mt[1]), ENT_QUOTES | ENT_HTML5, 'UTF-8');
    }
    // meta description fallback
    if (empty($data['description'])) {
        preg_match('/<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']*)["\'][^>]*>/i', $html, $md);
        if (!empty($md[1])) $data['description'] = html_entity_decode($md[1], ENT_QUOTES | ENT_HTML5, 'UTF-8');
    }

    // Truncate description
    if (mb_strlen($data['description']) > 200) {
        $data['description'] = mb_substr($data['description'], 0, 197) . '…';
    }

    return $data;
}

$meta = extractMeta($html);
$meta['url'] = $url;

// Resolve relative image URL
if (!empty($meta['image']) && !preg_match('/^https?:\/\//i', $meta['image'])) {
    $base = $scheme . '://' . $host;
    $meta['image'] = $meta['image'][0] === '/' ? $base . $meta['image'] : $base . '/' . $meta['image'];
}

// Derive domain
$meta['domain'] = $host;

if (empty($meta['title']) && empty($meta['description'])) {
    json_err('no_data', 'Нет данных для превью', 422);
}

json_ok($meta);

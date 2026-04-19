<?php
/**
 * u.php — Public profile redirect page (auth-screen style)
 * URL: initial.su/@username or initial.su/u/username
 *
 * Handles two routes:
 *   /@username — caught by ErrorDocument 404, parsed from REQUEST_URI
 *   /u/username — caught by RewriteRule, passed as ?u=username
 *
 * SSR: fetches user data for meta tags (og:image, og:title)
 * CSR: renders interactive UI as fallback
 */
declare(strict_types=1);

// ── Tell security_init() to skip restrictive API CSP ──
// u.php sets its own permissive CSP that allows inline styles.
// Without this, security_init() sets default-src 'none' which blocks all CSS.
define('SKIP_API_CSP', true);

// ── Resolve username ──
$username = '';

// From RewriteRule: ?u=username
if (!empty($_GET['u'])) {
    $username = trim($_GET['u']);
}

// From ErrorDocument 404: parse REQUEST_URI for /@username or /u/username
if (empty($username)) {
    $uri = parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH);
    if (preg_match('#^/@([a-zA-Z0-9_]+)/?$#', $uri, $m)) {
        $username = $m[1];
    } elseif (preg_match('#^/u/([a-zA-Z0-9_]+)/?$#', $uri, $m)) {
        $username = $m[1];
    }
}

$username = ltrim($username, '@');
$cleanId  = preg_replace('/[^a-z0-9_]/i', '', $username);

// ── Defaults ──
$nickname   = 'Initial';
$bio        = '';
$avatarUrl  = '';
$signalId   = $cleanId;
$isVerified = false;
$userFound  = false;
$pageTitle  = '@' . $cleanId . ' — Initial';
$pageDesc   = 'Профиль пользователя @' . $cleanId . ' в Initial';

// ── Try server-side DB lookup ──
if (!empty($cleanId)) {
    try {
        $configFile = __DIR__ . '/api/config.php';
        if (file_exists($configFile)) {
            require_once $configFile;
        }
        $helpersFile = __DIR__ . '/api/helpers.php';
        if (file_exists($helpersFile)) {
            require_once $helpersFile;
        }
        if (function_exists('db')) {
            $stmt = db()->prepare(
                'SELECT id, nickname, signal_id, avatar_url, bio, is_verified, is_team_signal
                 FROM users
                 WHERE signal_id = ?
                   AND is_system = 0
                 LIMIT 1'
            );
            $stmt->execute([$cleanId]);
            $user = $stmt->fetch();

            if ($user) {
                $userFound  = true;
                $nickname   = $user['nickname'] ?? $user['signal_id'];
                $signalId   = $user['signal_id'];
                $bio        = $user['bio'] ?? '';
                $isVerified = (bool) ($user['is_verified'] ?? false);

                if (!empty($user['avatar_url'])) {
                    $mediaInfo = build_media_response($user['avatar_url']);
                    $avatarUrl = $mediaInfo['url'] ?? '';
                }

                $pageTitle = $nickname . ' — Initial';
                $pageDesc  = !empty($bio) ? mb_substr($bio, 0, 160) : 'Профиль пользователя @' . $signalId . ' в Initial';
            }
        }
    } catch (\Throwable $e) {
        // Silently fail — CSR fallback
    }
}

// ── Set permissive CSP for profile page ──
// security_init() is skipped (SKIP_API_CSP) because its default-src 'none' CSP
// blocks inline styles. We set a permissive CSP here instead.
// Using header_remove + header to ensure no duplicate/conflicting CSP headers.
if (function_exists('header_remove')) {
    header_remove('Content-Security-Policy');
}
header('Content-Security-Policy: '
    . "default-src 'self'; "
    . "script-src 'unsafe-inline'; "
    . "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
    . "font-src 'self' https://fonts.gstatic.com; "
    . "img-src 'self' data: https:; "
    . "connect-src 'self'; "
    . "frame-ancestors 'none'; "
    . "base-uri 'self'; "
    . "form-action 'self'", true);

// Override 404 status — nginx serves u.php as ErrorDocument for /@username
// Use both header() and http_response_code() for maximum compatibility
// with different server configurations (Apache, nginx, etc.)
http_response_code(200);

header('Content-Type: text/html; charset=utf-8');
header('X-Content-Type-Options: nosniff');

// Build absolute avatar URL
$fullAvatarUrl = '';
$protocol = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
$host = $_SERVER['HTTP_HOST'] ?? 'initial.su';
$baseUrl = $protocol . '://' . $host;
$profileUrl = $baseUrl . '/@' . $signalId;

if (!empty($avatarUrl)) {
    $fullAvatarUrl = $baseUrl . '/api/' . $avatarUrl;
}

function esc(string $s): string {
    return htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
}

/**
 * Safe preg_replace — returns $subject unchanged if PCRE returns null (PHP 8 safety).
 */
function safePreReplace(string $pattern, string $replacement, string $subject, int $limit = -1): string {
    $r = preg_replace($pattern, $replacement, $subject, $limit);
    return $r === null ? $subject : $r;
}

/**
 * Safe preg_replace_callback — returns $subject unchanged if PCRE returns null.
 */
function safePreReplaceCb(string $pattern, callable $callback, string $subject): string {
    $r = preg_replace_callback($pattern, $callback, $subject);
    return $r === null ? $subject : $r;
}

/**
 * Format bio: full markdown + URLs + @mentions → HTML.
 * Mirrors the JS fmtText() from web/js/utils.js.
 * Supports: **bold**, *italic*, __underline__, ~~strikethrough~~, ||spoiler||, `code`, URLs, @mentions
 *
 * Pipeline:
 *  1. Extract URLs & @mentions BEFORE escaping (preserve original chars)
 *  2. HTML-escape remaining text
 *  3. Apply markdown formatting (markers survive esc since they aren't HTML-special)
 *  4. Restore extracted URLs/mentions
 */
function formatBio(?string $bio): string {
    if ($bio === null || $bio === '') return '';

    $cb = []; // callback buffer for extracted elements

    // 1) Extract URLs BEFORE html-escaping (preserve original URL chars)
    $s = safePreReplaceCb(
        '~(https?://[^\s<>"\'\x00-\x1F\x7F]+)~u',
        function ($m) use (&$cb) {
            $url = $m[1];
            $cb[] = '<a href="' . esc($url) . '" target="_blank" rel="noopener noreferrer">' . esc($url) . '</a>';
            return "\x00" . (count($cb) - 1) . "\x00";
        },
        $bio
    );

    // 2) Extract @mentions BEFORE html-escaping
    $s = safePreReplaceCb(
        '~(?<![a-zA-Z0-9_@])@([a-zA-Z0-9_]{2,32})(?![a-zA-Z0-9_])~',
        function ($m) use (&$cb) {
            $name = $m[1];
            $cb[] = '<a class="u-mention" href="/u/' . esc($name) . '">@' . esc($name) . '</a>';
            return "\x00" . (count($cb) - 1) . "\x00";
        },
        $s
    );

    // 3) Escape remaining text for XSS safety
    $s = esc($s);

    // 4) Apply markdown formatting (markers survive esc since they aren't HTML-special)
    // Inline code: `text`
    $s = safePreReplaceCb(
        '/`([^`\n]+)`/u',
        function ($m) use (&$cb) {
            $cb[] = '<code>' . $m[1] . '</code>';
            return "\x00" . (count($cb) - 1) . "\x00";
        },
        $s
    );
    // Bold: **text**
    $s = safePreReplace('/\*\*(.+?)\*\*/us', '<strong>$1</strong>', $s);
    // Italic: *text* (single *, not inside **)
    $s = safePreReplace('/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/us', '<em>$1</em>', $s);
    // Strikethrough: ~~text~~
    $s = safePreReplace('/~~(.+?)~~/us', '<del>$1</del>', $s);
    // Underline: __text__
    $s = safePreReplace('/__(.+?)__/us', '<u>$1</u>', $s);
    // Spoiler: ||text||
    $s = safePreReplaceCb(
        '/\|\|(.+?)\|\|/us',
        function ($m) use (&$cb) {
            $cb[] = '<span class="spoiler">' . $m[1] . '</span>';
            return "\x00" . (count($cb) - 1) . "\x00";
        },
        $s
    );

    // 5) Restore all placeholders
    $s = safePreReplaceCb(
        '/\x00(\d+)\x00/',
        function ($m) use (&$cb) {
            return $cb[(int)$m[1]] ?? $m[0];
        },
        $s
    );

    return $s;
}
?><!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<title><?php echo esc($pageTitle); ?></title>
<meta name="description" content="<?php echo esc($pageDesc); ?>">
<meta name="theme-color" content="#111111">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">

<!-- CSP meta tag as fallback: if server header CSP is restrictive, this meta tag overrides it.
     Multiple CSP policies are enforced additively (most restrictive wins), so this permissive
     policy only helps if there is NO restrictive HTTP header CSP. The SKIP_API_CSP constant
     prevents security_init() from setting default-src 'none', which is the primary fix. -->
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'">

<!-- Open Graph -->
<meta property="og:type" content="profile">
<meta property="og:title" content="<?php echo esc($pageTitle); ?>">
<meta property="og:description" content="<?php echo esc($pageDesc); ?>">
<meta property="og:url" content="<?php echo esc($profileUrl); ?>">
<meta property="og:site_name" content="Initial">
<?php if (!empty($fullAvatarUrl)): ?>
<meta property="og:image" content="<?php echo esc($fullAvatarUrl); ?>">
<meta property="og:image:width" content="400">
<meta property="og:image:height" content="400">
<?php endif; ?>

<!-- Twitter Card -->
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="<?php echo esc($pageTitle); ?>">
<meta name="twitter:description" content="<?php echo esc($pageDesc); ?>">
<?php if (!empty($fullAvatarUrl)): ?>
<meta name="twitter:image" content="<?php echo esc($fullAvatarUrl); ?>">
<?php endif; ?>

<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'><rect width='48' height='48' rx='12' fill='%238b5cf6'/><path d='M24 8C15.163 8 8 14.477 8 22.5c0 4.197 1.888 7.997 4.973 10.8-.42 2.466-1.533 4.825-3.06 6.45 2.954-.268 6.423-1.4 8.956-3.317A18.14 18.14 0 0024 37c8.837 0 16-6.477 16-14.5S32.837 8 24 8z' fill='white'/></svg>">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500;700&display=swap" rel="stylesheet">

<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
:root{
  --bg:#111111;--bg2:#181818;
  --s1:rgba(255,255,255,.05);--s2:rgba(255,255,255,.08);
  --b2:rgba(255,255,255,.09);
  --y:#8b5cf6;--y2:#a78bfa;
  --t1:#efefef;--t2:rgba(239,239,239,.55);--t3:rgba(239,239,239,.25);
  --font:'Google Sans',-apple-system,sans-serif;
  --ease:cubic-bezier(.16,1,.3,1);
  --sp:cubic-bezier(.34,1.56,.64,1);
}
html,body{height:100%;overflow:hidden}
body{
  font-family:var(--font);background:var(--bg);color:var(--t1);
  font-size:15px;line-height:1.5;font-weight:500;
  -webkit-font-smoothing:antialiased;
  display:flex;flex-direction:column;
  align-items:center;justify-content:flex-start;
  padding:24px 20px 40px;
}

/* ══ Card — vertical rounded rectangle ══ */
.u-card{
  position:relative;z-index:1;
  width:380px;max-width:calc(100vw - 40px);
  animation:cardIn .4s var(--ease) both;
  display:flex;flex-direction:column;align-items:center;
  background:var(--bg2);
  border-radius:24px;
  padding:32px 28px 28px;
  border:1px solid var(--s2);
  box-shadow:0 8px 40px rgba(0,0,0,.35);
}
@keyframes cardIn{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:none}}

/* ══ Logo — sits above the card ══ */
.u-logo{
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  margin-bottom:24px;
}
.u-logo-name{font-size:52px;font-weight:900;letter-spacing:-2px;color:var(--t1)}

/* ══ Profile section ══ */
.u-profile{
  display:flex;flex-direction:column;align-items:center;
  width:100%;margin-bottom:8px;
}

/* Avatar */
.u-avatar{
  width:100px;height:100px;
  border-radius:50%;
  background:var(--s1);
  border:3px solid rgba(255,255,255,.12);
  overflow:hidden;
  box-shadow:0 4px 24px rgba(0,0,0,.4);
  margin-bottom:20px;
  flex-shrink:0;
}
.u-avatar img{width:100%;height:100%;object-fit:cover;display:block}
.u-avatar-fallback{
  width:100%;height:100%;
  display:flex;align-items:center;justify-content:center;
  font-size:38px;font-weight:900;color:var(--t2);
}

/* Name row — matches auth-title style */
.u-name-row{
  display:flex;align-items:center;gap:6px;
  margin-bottom:4px;
}
.u-name{
  font-size:28px;font-weight:700;letter-spacing:-.4px;
  color:var(--t1);text-align:center;
}
.u-verified{
  width:22px;height:22px;flex-shrink:0;
  color:var(--y);display:inline-flex;
}

/* Signal ID */
.u-sid{
  font-size:15px;font-weight:500;
  color:var(--y2);margin-bottom:8px;
}

/* Bio — formatted with links */
.u-bio{
  font-size:15px;line-height:1.55;
  color:var(--t2);text-align:center;
  max-width:320px;word-break:break-word;
  white-space:pre-wrap;margin-bottom:8px;
}
.u-bio a{
  color:var(--y2);text-decoration:none;
  font-weight:600;
  border-bottom:1px solid rgba(139,92,246,.3);
  transition:color .15s,border-color .15s;
}
.u-bio a:hover{
  color:var(--y);border-bottom-color:var(--y);
}
.u-bio a.u-mention{
  border-bottom:none;
  color:var(--y);
  cursor:pointer;
}
.u-bio a.u-mention:hover{
  text-decoration:underline;
}
/* Bio markdown formatting */
.u-bio strong{color:var(--t1);font-weight:700}
.u-bio em{font-style:italic;color:var(--t1)}
.u-bio u{text-decoration:underline;text-underline-offset:2px}
.u-bio del{text-decoration:line-through;opacity:.7}
.u-bio code{
  font-family:'SF Mono',Menlo,Consolas,monospace;
  font-size:13px;background:var(--s1);
  padding:1px 5px;border-radius:4px;
}
.u-bio .spoiler{
  background:rgba(139,92,246,.18);
  color:transparent;border-radius:4px;
  cursor:pointer;transition:all .2s ease;
  padding:0 2px;
}
.u-bio .spoiler.revealed{
  background:rgba(139,92,246,.08);
  color:var(--t2);
}

/* Status */
.u-status{
  font-size:13px;color:var(--t3);margin-bottom:28px;
}

/* ══ Buttons — matches auth .btn and .btn-ghost ══ */
.u-actions{
  display:flex;flex-direction:column;gap:10px;
  width:100%;
}
.u-btn{
  width:100%;border-radius:12px;
  font-family:var(--font);font-size:16px;font-weight:700;
  padding:16px;cursor:pointer;
  transition:transform .15s var(--sp),box-shadow .15s,opacity .15s,background .15s;
  position:relative;overflow:hidden;letter-spacing:.1px;
  display:flex;align-items:center;justify-content:center;gap:8px;
  text-decoration:none;
  -webkit-tap-highlight-color:transparent;
}
.u-btn svg{width:18px;height:18px;flex-shrink:0}

/* Primary — matches .btn */
.u-btn-primary{
  background:#fff;color:#000;border:none;
  box-shadow:0 4px 12px rgba(255,255,255,.1);
}
.u-btn-primary:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 6px 16px rgba(255,255,255,.15);background:#f2f2f2}
.u-btn-primary:active:not(:disabled){transform:scale(.97)}

/* Ghost — matches .btn-ghost */
.u-btn-ghost{
  background:transparent;color:#fff;
  border:1px solid rgba(255,255,255,.15);
  box-shadow:none;font-weight:600;
}
.u-btn-ghost:hover:not(:disabled){background:rgba(255,255,255,.05);color:#fff;transform:none;box-shadow:none}
.u-btn-ghost:active:not(:disabled){transform:scale(.97);opacity:.85}

/* ══ Footer ══ */
.u-footer{
  margin-top:auto;
  padding-top:32px;
  text-align:center;
  font-size:12px;color:var(--t3);
}
.u-footer a{color:var(--t2);text-decoration:none;font-weight:600}
.u-footer a:hover{color:var(--t1)}

/* ══ Not found — also in a rounded card ══ */
.u-notfound{
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  width:380px;max-width:calc(100vw - 40px);
  text-align:center;
  animation:cardIn .4s var(--ease) both;
  background:var(--bg2);
  border-radius:24px;
  padding:32px 28px 28px;
  border:1px solid var(--s2);
  box-shadow:0 8px 40px rgba(0,0,0,.35);
}
.u-notfound-title{font-size:28px;font-weight:700;letter-spacing:-.4px;color:var(--t1);margin-bottom:12px}
.u-notfound-desc{font-size:15px;color:var(--t2);line-height:1.5;margin-bottom:28px}

/* ══ Loading skeleton — in a rounded card ══ */
.u-loading{
  display:flex;flex-direction:column;align-items:center;
  padding:40px 24px;
  animation:cardIn .4s var(--ease) both;
  width:380px;max-width:calc(100vw - 40px);
  background:var(--bg2);
  border-radius:24px;
  border:1px solid var(--s2);
  box-shadow:0 8px 40px rgba(0,0,0,.35);
}
.u-skel-circle{
  width:100px;height:100px;border-radius:50%;
  background:var(--s1);margin-bottom:20px;
  animation:shimmer 1.5s ease-in-out infinite;
}
.u-skel-line{
  height:16px;border-radius:8px;background:var(--s1);
  margin-bottom:8px;animation:shimmer 1.5s ease-in-out infinite;
}
.u-skel-line.w60{width:60%;margin:0 auto 8px}
.u-skel-line.w40{width:40%;margin:0 auto 8px}
@keyframes shimmer{0%,100%{opacity:.5}50%{opacity:.8}}
</style>
</head>
<body>

<?php if ($userFound): ?>
<!-- SSR: User found -->
<div class="u-logo">
  <div class="u-logo-name">Initial.</div>
</div>

<div class="u-card">
  <div class="u-profile">
    <div class="u-avatar">
      <?php if (!empty($avatarUrl)): ?>
      <img src="<?php echo esc($baseUrl . '/api/' . $avatarUrl); ?>" alt="<?php echo esc($nickname); ?>" loading="eager">
      <?php else: ?>
      <div class="u-avatar-fallback"><?php echo esc(mb_substr($nickname, 0, 1)); ?></div>
      <?php endif; ?>
    </div>

    <div class="u-name-row">
      <span class="u-name"><?php echo esc($nickname); ?></span>
      <?php if ($isVerified): ?>
      <svg class="u-verified" viewBox="0 0 22 22"><path d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.705 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681s.075-1.299-.165-1.903c.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z" fill="currentColor"/></svg>
      <?php endif; ?>
    </div>

    <div class="u-sid">@<?php echo esc($signalId); ?></div>

    <?php if (!empty($bio)): ?>
    <div class="u-bio"><?php echo formatBio($bio); ?></div>
    <?php endif; ?>

    <div class="u-status">Initial Messenger</div>
  </div>

  <div class="u-actions">
    <a class="u-btn u-btn-primary" href="/web/?u=<?php echo esc($signalId); ?>" id="btn-web">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
      Перейти в Web
    </a>
    <button class="u-btn u-btn-ghost" id="btn-app">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>
      Открыть
    </button>
  </div>
</div>

<div class="u-footer">
  <a href="/">Initial</a> — безопасный мессенджер
</div>

<?php elseif (empty($cleanId)): ?>
<!-- No username -->
<div class="u-logo">
  <div class="u-logo-name">Initial.</div>
</div>
<div class="u-notfound">
  <div class="u-notfound-title">Добро пожаловать</div>
  <div class="u-notfound-desc">Безопасный мессенджер нового поколения</div>
  <a class="u-btn u-btn-primary" href="/web/">Открыть Web</a>
</div>

<?php else: ?>
<!-- Username not found — try CSR fallback -->
<div id="u-loading-wrap">
  <div class="u-logo">
    <div class="u-logo-name">Initial.</div>
  </div>
  <div class="u-loading">
    <div class="u-skel-circle"></div>
    <div class="u-skel-line w60" style="height:20px"></div>
    <div class="u-skel-line w40" style="height:14px"></div>
  </div>
</div>
<div id="u-content" style="display:none"></div>
<?php endif; ?>

<script>
(function(){
  var signalId = '<?php echo esc($cleanId); ?>';
  var userFound = <?php echo $userFound ? 'true' : 'false'; ?>;
  var baseUrl = '<?php echo esc($baseUrl); ?>';

  // ── App button: deep link ──
  function setupAppButton() {
    var btn = document.getElementById('btn-app');
    if (!btn) return;
    btn.onclick = function() {
      var deepLink = 'initial://u/' + signalId;
      var timeout;
      window.location.href = deepLink;
      timeout = setTimeout(function() {
        window.location.href = '/web/?u=' + encodeURIComponent(signalId);
      }, 1500);
      window.addEventListener('blur', function() {
        clearTimeout(timeout);
      }, { once: true });
    };
  }

  if (userFound) {
    setupAppButton();
  }

  // ── CSR fallback ──
  if (!userFound && signalId) {
    fetch(baseUrl + '/api/resolve_profile?u=' + encodeURIComponent(signalId))
      .then(function(r){ return r.json(); })
      .then(function(data){
        if (data.ok && data.user) {
          renderProfile(data.user);
        } else {
          showNotFound();
        }
      })
      .catch(function(){ showNotFound(); });
  }

  function renderProfile(user) {
    var loading = document.getElementById('u-loading-wrap');
    var content = document.getElementById('u-content');
    if (loading) loading.style.display = 'none';
    if (!content) return;
    content.style.display = 'block';

    var avatarHtml = user.avatar_url
      ? '<img src="' + baseUrl + '/api/' + user.avatar_url + '" alt="' + esc(user.nickname) + '">'
      : '<div class="u-avatar-fallback">' + esc(user.nickname.charAt(0)) + '</div>';

    var verifiedHtml = user.is_verified
      ? '<svg class="u-verified" viewBox="0 0 22 22"><path d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.705 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681s.075-1.299-.165-1.903c.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z" fill="currentColor"/></svg>'
      : '';

    var bioHtml = user.bio ? '<div class="u-bio">' + formatBio(user.bio) + '</div>' : '';

    content.innerHTML =
      '<div class="u-logo"><div class="u-logo-name">Initial.</div></div>' +
      '<div class="u-card">' +
        '<div class="u-profile">' +
          '<div class="u-avatar">' + avatarHtml + '</div>' +
          '<div class="u-name-row">' +
            '<span class="u-name">' + esc(user.nickname) + '</span>' +
            verifiedHtml +
          '</div>' +
          '<div class="u-sid">@' + esc(user.signal_id) + '</div>' +
          bioHtml +
          '<div class="u-status">Initial Messenger</div>' +
        '</div>' +
        '<div class="u-actions">' +
          '<a class="u-btn u-btn-primary" href="/web/?u=' + encodeURIComponent(user.signal_id) + '">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>' +
            'Перейти в Web' +
          '</a>' +
          '<button class="u-btn u-btn-ghost" id="btn-app">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>' +
            'Открыть' +
          '</button>' +
        '</div>' +
      '</div>' +
      '<div class="u-footer"><a href="/">Initial</a> — безопасный мессенджер</div>';

    signalId = user.signal_id;
    setupAppButton();
  }

  function showNotFound() {
    var loading = document.getElementById('u-loading-wrap');
    var content = document.getElementById('u-content');
    if (loading) loading.style.display = 'none';
    if (!content) return;
    content.style.display = 'block';
    content.innerHTML =
      '<div class="u-logo"><div class="u-logo-name">Initial.</div></div>' +
      '<div class="u-notfound">' +
        '<div class="u-notfound-title">Пользователь не найден</div>' +
        '<div class="u-notfound-desc">Аккаунт @' + esc(signalId) + ' не найден или не существует</div>' +
        '<a class="u-btn u-btn-primary" href="/web/">Открыть Initial</a>' +
      '</div>';
  }

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  /**
   * Format bio: full markdown + URLs + @mentions → HTML.
   * Mirrors PHP formatBio() and JS fmtText() from utils.js.
   */
  function formatBio(text) {
    if (!text) return '';
    var cb = [];
    // 1) Extract URLs BEFORE escaping
    var s = text.replace(/(https?:\/\/[^\s<>"'\x00-\x1F\x7F]+)/g, function(url) {
      cb.push('<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(url) + '</a>');
      return '\x00' + (cb.length - 1) + '\x00';
    });
    // 2) Extract @mentions BEFORE escaping
    s = s.replace(/(?<![a-zA-Z0-9_@])@([a-zA-Z0-9_]{2,32})(?![a-zA-Z0-9_])/g, function(_, name) {
      cb.push('<a class="u-mention" href="/u/' + esc(name) + '">@' + esc(name) + '</a>');
      return '\x00' + (cb.length - 1) + '\x00';
    });
    // 3) Escape remaining text
    s = esc(s);
    // 4) Markdown formatting
    s = s.replace(/`([^`\n]+)`/g, function(_, c) { cb.push('<code>' + c + '</code>'); return '\x00' + (cb.length - 1) + '\x00'; });
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
    s = s.replace(/~~(.+?)~~/g, '<del>$1</del>');
    s = s.replace(/__(.+?)__/g, '<u>$1</u>');
    s = s.replace(/\|\|(.+?)\|\|/g, function(_, c) { cb.push('<span class="spoiler" onclick="this.classList.toggle(\'revealed\')">' + c + '</span>'); return '\x00' + (cb.length - 1) + '\x00'; });
    // 5) Restore placeholders
    s = s.replace(/\x00(\d+)\x00/g, function(_, i) { return cb[+i]; });
    return s;
  }
})();
</script>
</body>
</html>

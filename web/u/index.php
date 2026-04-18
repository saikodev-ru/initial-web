<?php
/**
 * /u/index.php — Public profile page (Telegram Web-style)
 * URL: initial.su/u/username
 *
 * SSR: fetches user data server-side for proper meta tags (og:image, og:title)
 * CSR: renders the interactive profile UI client-side as fallback
 */
declare(strict_types=1);

// ── Get username from query param (rewritten by .htaccess) ──
$username = trim($_GET['u'] ?? '');
$username = ltrim($username, '@');
$cleanId  = preg_replace('/[^a-z0-9_]/i', '', $username);

// ── Defaults for meta tags (before DB lookup) ──
$nickname   = 'Initial';
$bio        = '';
$avatarUrl  = '';
$signalId   = $cleanId;
$isVerified = false;
$userFound  = false;
$pageTitle  = '@' . $cleanId . ' — Initial';
$pageDesc   = 'Профиль пользователя @' . $cleanId . ' в Initial';

// ── Try server-side DB lookup for meta tags ──
if (!empty($cleanId)) {
    try {
        $configFile = __DIR__ . '/../../api/config.php';
        if (file_exists($configFile)) {
            require_once $configFile;
        }

        $helpersFile = __DIR__ . '/../../api/helpers.php';
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

                // Build avatar URL
                if (!empty($user['avatar_url'])) {
                    $mediaInfo = build_media_response($user['avatar_url']);
                    $avatarUrl = $mediaInfo['url'] ?? '';
                }

                $pageTitle = $nickname . ' — Initial';
                $pageDesc  = !empty($bio) ? mb_substr($bio, 0, 160) : 'Профиль пользователя @' . $signalId . ' в Initial';
            }
        }
    } catch (\Throwable $e) {
        // Silently fail — page will still render with client-side fetch
    }
}

// Build absolute avatar URL for og:image
$fullAvatarUrl = '';
if (!empty($avatarUrl)) {
    $protocol = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? 'initial.su';
    $fullAvatarUrl = $protocol . '://' . $host . '/api/' . $avatarUrl;
}

$protocol = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
$host = $_SERVER['HTTP_HOST'] ?? 'initial.su';
$baseUrl = $protocol . '://' . $host;
$profileUrl = $baseUrl . '/u/' . $signalId;

// Escape for HTML
function esc(string $s): string {
    return htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
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
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#111111;--bg2:#181818;
  --s1:rgba(255,255,255,.05);--s2:rgba(255,255,255,.08);
  --b:rgba(255,255,255,.05);--b2:rgba(255,255,255,.09);
  --t1:#efefef;--t2:rgba(239,239,239,.55);--t3:rgba(239,239,239,.25);
  --y:#8b5cf6;--y2:#a78bfa;--yb:rgba(139,92,246,.36);--ybg:rgba(139,92,246,.13);
  --font:'Google Sans',-apple-system,sans-serif;
}
html,body{height:100%;overflow:hidden}
body{
  font-family:var(--font);background:var(--bg);color:var(--t1);
  font-size:15px;line-height:1.5;font-weight:500;
  -webkit-font-smoothing:antialiased;
  display:flex;align-items:center;justify-content:center;
}

/* ── Profile card container ── */
.profile-card{
  position:relative;width:100%;max-width:420px;
  min-height:100vh;min-height:100dvh;
  display:flex;flex-direction:column;
  overflow-y:auto;overflow-x:hidden;
  background:var(--bg);
}

/* ── Hero section with blurred background ── */
.profile-hero{
  position:relative;
  display:flex;flex-direction:column;align-items:center;
  padding:60px 24px 24px;
  overflow:hidden;
}
.profile-hero-bg{
  position:absolute;inset:0;z-index:0;
  background-size:cover;background-position:center;
  filter:blur(40px) brightness(0.4) saturate(1.3);
  transform:scale(1.3);
}
.profile-hero-bg::after{
  content:'';position:absolute;inset:0;
  background:linear-gradient(to bottom,rgba(17,17,17,.2),rgba(17,17,17,.9));
}
.profile-hero > *{position:relative;z-index:1}

/* ── Avatar ── */
.profile-avatar{
  width:100px;height:100px;
  border-radius:50%;
  background:var(--s1);
  border:3px solid rgba(255,255,255,.15);
  overflow:hidden;
  box-shadow:0 4px 24px rgba(0,0,0,.4);
  margin-bottom:16px;
  flex-shrink:0;
}
.profile-avatar img{width:100%;height:100%;object-fit:cover;display:block}
.profile-avatar-fallback{
  width:100%;height:100%;
  display:flex;align-items:center;justify-content:center;
  font-size:38px;font-weight:900;color:var(--t2);
}

/* ── Name + badges ── */
.profile-name-row{
  display:flex;align-items:center;gap:6px;
  margin-bottom:4px;
}
.profile-name{
  font-size:22px;font-weight:900;letter-spacing:-.3px;
  color:var(--t1);text-align:center;
}
.profile-verified{
  width:20px;height:20px;flex-shrink:0;
  color:var(--y);display:inline-flex;
}

/* ── Signal ID ── */
.profile-sid{
  font-size:14px;font-weight:500;
  color:var(--y2);margin-bottom:8px;
}

/* ── Status ── */
.profile-status{
  font-size:13px;color:var(--t3);margin-bottom:8px;
}

/* ── Bio ── */
.profile-bio{
  font-size:14px;line-height:1.55;
  color:var(--t2);text-align:center;
  max-width:320px;word-break:break-word;
  white-space:pre-wrap;margin-bottom:8px;
}

/* ── Action buttons ── */
.profile-actions{
  display:flex;gap:10px;
  margin-top:12px;width:100%;
  padding:0 24px;
}
.profile-action-btn{
  flex:1;display:flex;align-items:center;justify-content:center;gap:8px;
  padding:13px 16px;border-radius:14px;
  font-family:var(--font);font-size:14.5px;font-weight:700;
  cursor:pointer;transition:transform .12s,opacity .15s,background .15s;
  -webkit-tap-highlight-color:transparent;
  border:none;letter-spacing:.1px;
}
.profile-action-btn:active{transform:scale(.96);opacity:.85}
.profile-action-btn svg{width:18px;height:18px;flex-shrink:0}

.profile-btn-primary{
  background:#fff;color:#000;
  box-shadow:0 2px 12px rgba(255,255,255,.1);
}
.profile-btn-primary:hover{background:#f2f2f2}

.profile-btn-secondary{
  background:var(--s2);color:var(--t1);
  border:1px solid var(--b2);
}
.profile-btn-secondary:hover{background:rgba(255,255,255,.12)}

/* ── Divider ── */
.profile-divider{
  width:100%;height:1px;
  background:var(--b);margin:20px 0;
}

/* ── QR section ── */
.profile-qr-section{
  display:flex;flex-direction:column;align-items:center;
  padding:0 24px 32px;
}
.profile-qr-wrap{
  width:180px;height:180px;
  border-radius:16px;overflow:hidden;
  background:#fff;
  box-shadow:0 2px 16px rgba(0,0,0,.2);
  line-height:0;font-size:0;
  margin-bottom:12px;
}
.profile-qr-wrap canvas,.profile-qr-wrap svg{
  width:100%!important;height:100%!important;display:block!important;
}
.profile-qr-link{
  font-size:13px;color:var(--t3);
  word-break:break-all;text-align:center;
}

/* ── Footer ── */
.profile-footer{
  margin-top:auto;
  padding:16px 24px;
  text-align:center;
  font-size:12px;color:var(--t3);
}
.profile-footer a{
  color:var(--t2);text-decoration:none;font-weight:600;
}
.profile-footer a:hover{color:var(--t1)}

/* ── Not found ── */
.profile-notfound{
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  min-height:100vh;min-height:100dvh;padding:40px;
  text-align:center;
}
.profile-notfound-ico{font-size:56px;opacity:.2;margin-bottom:16px}
.profile-notfound-title{font-size:22px;font-weight:900;color:var(--t1);margin-bottom:8px}
.profile-notfound-desc{font-size:14px;color:var(--t2);line-height:1.6;margin-bottom:24px;max-width:280px}
.profile-notfound-btn{
  display:inline-flex;align-items:center;gap:8px;
  padding:13px 28px;border-radius:14px;
  background:#fff;color:#000;
  font-family:var(--font);font-size:15px;font-weight:700;
  cursor:pointer;border:none;
  box-shadow:0 2px 12px rgba(255,255,255,.1);
  text-decoration:none;
}
.profile-notfound-btn:active{transform:scale(.96)}

/* ── Loading skeleton ── */
.profile-loading{
  display:flex;flex-direction:column;align-items:center;
  min-height:100vh;min-height:100dvh;padding:60px 24px;
}
.skeleton-circle{
  width:100px;height:100px;border-radius:50%;
  background:var(--s1);margin-bottom:16px;
  animation:shimmer 1.5s ease-in-out infinite;
}
.skeleton-line{
  height:16px;border-radius:8px;background:var(--s1);
  margin-bottom:8px;animation:shimmer 1.5s ease-in-out infinite;
}
.skeleton-line.w60{width:60%;margin:0 auto 8px}
.skeleton-line.w40{width:40%;margin:0 auto 8px}
.skeleton-line.w80{width:80%;margin:0 auto 8px}
@keyframes shimmer{0%,100%{opacity:.5}50%{opacity:.8}}
</style>
</head>
<body>

<div id="app">
<?php if ($userFound): ?>
  <!-- SSR: User found — render immediately with server data -->
  <div class="profile-card">
    <div class="profile-hero">
      <?php if (!empty($avatarUrl)): ?>
      <div class="profile-hero-bg" style="background-image:url('<?php echo esc($baseUrl . '/api/' . $avatarUrl); ?>')"></div>
      <?php else: ?>
      <div class="profile-hero-bg" style="background:var(--bg2)"></div>
      <?php endif; ?>

      <div class="profile-avatar">
        <?php if (!empty($avatarUrl)): ?>
        <img src="<?php echo esc($baseUrl . '/api/' . $avatarUrl); ?>" alt="<?php echo esc($nickname); ?>" loading="eager">
        <?php else: ?>
        <div class="profile-avatar-fallback"><?php echo esc(mb_substr($nickname, 0, 1)); ?></div>
        <?php endif; ?>
      </div>

      <div class="profile-name-row">
        <span class="profile-name"><?php echo esc($nickname); ?></span>
        <?php if ($isVerified): ?>
        <svg class="profile-verified" viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg"><path d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.705 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681s.075-1.299-.165-1.903c.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z" fill="currentColor"/></svg>
        <?php endif; ?>
      </div>

      <div class="profile-sid">@<?php echo esc($signalId); ?></div>

      <?php if (!empty($bio)): ?>
      <div class="profile-bio"><?php echo esc($bio); ?></div>
      <?php endif; ?>

      <div class="profile-status">Initial Messenger</div>
    </div>

    <div class="profile-actions">
      <a class="profile-action-btn profile-btn-primary" href="/web/" id="btn-open-web">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
        Открыть в Web
      </a>
      <button class="profile-action-btn profile-btn-secondary" id="btn-open-app">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>
        В приложении
      </button>
    </div>

    <div class="profile-divider"></div>

    <div class="profile-qr-section">
      <div class="profile-qr-wrap" id="qr-canvas"></div>
      <div class="profile-qr-link">initial.su/u/<?php echo esc($signalId); ?></div>
    </div>

    <div class="profile-footer">
      <a href="/web/">Initial</a> — безопасный мессенджер
    </div>
  </div>

<?php elseif (empty($cleanId)): ?>
  <!-- No username specified -->
  <div class="profile-notfound">
    <div class="profile-notfound-ico">💬</div>
    <div class="profile-notfound-title">Initial</div>
    <div class="profile-notfound-desc">Безопасный мессенджер нового поколения</div>
    <a class="profile-notfound-btn" href="/web/">Открыть</a>
  </div>

<?php else: ?>
  <!-- Username specified but not found — try client-side fallback -->
  <div class="profile-loading" id="profile-loading">
    <div class="skeleton-circle"></div>
    <div class="skeleton-line w60" style="height:20px"></div>
    <div class="skeleton-line w40" style="height:14px"></div>
    <div class="skeleton-line w80"></div>
  </div>
  <div id="profile-content" style="display:none"></div>
<?php endif; ?>
</div>

<script src="https://unpkg.com/qr-code-styling@1.5.0/lib/qr-code-styling.js"></script>
<script>
(function(){
  var signalId = '<?php echo esc($cleanId); ?>';
  var userFound = <?php echo $userFound ? 'true' : 'false'; ?>;
  var baseUrl = '<?php echo esc($baseUrl); ?>';

  // ── QR Code rendering ──
  function renderQR(url) {
    var container = document.getElementById('qr-canvas');
    if (!container || typeof QRCodeStyling === 'undefined') return;
    container.innerHTML = '';
    try {
      var qr = new QRCodeStyling({
        width: 180, height: 180,
        type: 'canvas',
        data: url,
        dotsOptions: { color: '#000', type: 'rounded' },
        backgroundOptions: { color: '#fff' },
        cornersSquareOptions: { type: 'extra-rounded' },
        cornersDotOptions: { type: 'dot' },
        qrOptions: { errorCorrectionLevel: 'M' }
      });
      qr.append(container);
    } catch(e) {}
  }

  // ── SSR path: render QR for server-rendered profile ──
  if (userFound) {
    renderQR('https://initial.su/u/' + signalId);
    setupAppButton();
  }

  // ── CSR fallback: fetch user data client-side ──
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
      .catch(function(){
        showNotFound();
      });
  }

  function renderProfile(user) {
    var loading = document.getElementById('profile-loading');
    var content = document.getElementById('profile-content');
    if (loading) loading.style.display = 'none';
    if (!content) return;
    content.style.display = 'block';

    var avatarHtml = user.avatar_url
      ? '<img src="' + baseUrl + '/api/' + user.avatar_url + '" alt="' + esc(user.nickname) + '">'
      : '<div class="profile-avatar-fallback">' + esc(user.nickname.charAt(0)) + '</div>';

    var heroBgStyle = user.avatar_url
      ? 'style="background-image:url(\'' + baseUrl + '/api/' + user.avatar_url + '\')"'
      : 'style="background:var(--bg2)"';

    var verifiedHtml = user.is_verified
      ? '<svg class="profile-verified" viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg"><path d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.705 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681s.075-1.299-.165-1.903c.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z" fill="currentColor"/></svg>'
      : '';

    var bioHtml = user.bio
      ? '<div class="profile-bio">' + esc(user.bio) + '</div>'
      : '';

    content.innerHTML =
      '<div class="profile-card">' +
        '<div class="profile-hero">' +
          '<div class="profile-hero-bg" ' + heroBgStyle + '></div>' +
          '<div class="profile-avatar">' + avatarHtml + '</div>' +
          '<div class="profile-name-row">' +
            '<span class="profile-name">' + esc(user.nickname) + '</span>' +
            verifiedHtml +
          '</div>' +
          '<div class="profile-sid">@' + esc(user.signal_id) + '</div>' +
          bioHtml +
          '<div class="profile-status">Initial Messenger</div>' +
        '</div>' +
        '<div class="profile-actions">' +
          '<a class="profile-action-btn profile-btn-primary" href="/web/">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>' +
            'Открыть в Web' +
          '</a>' +
          '<button class="profile-action-btn profile-btn-secondary" id="btn-open-app">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>' +
            'В приложении' +
          '</button>' +
        '</div>' +
        '<div class="profile-divider"></div>' +
        '<div class="profile-qr-section">' +
          '<div class="profile-qr-wrap" id="qr-canvas"></div>' +
          '<div class="profile-qr-link">initial.su/u/' + esc(user.signal_id) + '</div>' +
        '</div>' +
        '<div class="profile-footer">' +
          '<a href="/web/">Initial</a> — безопасный мессенджер' +
        '</div>' +
      '</div>';

    renderQR('https://initial.su/u/' + user.signal_id);
    setupAppButton();
  }

  function showNotFound() {
    var loading = document.getElementById('profile-loading');
    var content = document.getElementById('profile-content');
    if (loading) loading.style.display = 'none';
    if (!content) return;
    content.style.display = 'block';
    content.innerHTML =
      '<div class="profile-notfound">' +
        '<div class="profile-notfound-ico">🔍</div>' +
        '<div class="profile-notfound-title">Пользователь не найден</div>' +
        '<div class="profile-notfound-desc">Аккаунт @' + esc(signalId) + ' не найден или не существует</div>' +
        '<a class="profile-notfound-btn" href="/web/">Открыть Initial</a>' +
      '</div>';
  }

  function setupAppButton() {
    var btn = document.getElementById('btn-open-app');
    if (!btn) return;
    btn.onclick = function() {
      // Try deep link first, fallback to web
      var deepLink = 'initial://u/' + signalId;
      var timeout;
      var fallbackUrl = '/web/';

      // Try opening deep link
      window.location.href = deepLink;

      // If app not installed, fallback after a short delay
      timeout = setTimeout(function() {
        window.location.href = fallbackUrl;
      }, 1500);

      // Clear fallback if page loses focus (app opened)
      window.addEventListener('blur', function() {
        clearTimeout(timeout);
      }, { once: true });
    };
  }

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }
})();
</script>
</body>
</html>

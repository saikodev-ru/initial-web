/* ══ AUTH — Вход · QR-код · Код через @signal · Регистрация · Сессия · Выход ══ */

/* ══ AUTH STATE ═══════════════════════════════════════════════ */
const AUTH_SS_KEY = 'sg_auth_step';

function saveAuthState(step, email, via = 'email') {
  const payload = JSON.stringify({ step, email: email || '', via, ts: Date.now() });
  try { sessionStorage.setItem(AUTH_SS_KEY, payload); } catch(e) {}
  try { localStorage.setItem(AUTH_SS_KEY, payload); } catch(e) {}
}
function loadAuthState() {
  try {
    const ss = sessionStorage.getItem(AUTH_SS_KEY);
    const ls = localStorage.getItem(AUTH_SS_KEY);
    const s  = JSON.parse(ss || ls || 'null');
    if (!s) return null;
    if (Date.now() - s.ts > 15 * 60 * 1000) { clearAuthState(); return null; }
    return s;
  } catch { return null; }
}
function clearAuthState() {
  try { sessionStorage.removeItem(AUTH_SS_KEY); } catch {}
  try { localStorage.removeItem(AUTH_SS_KEY); } catch {}
}

let authEmail   = '';
let authStep    = 'qr';
let authCodeVia = 'email';

function getAuthStep() { return authStep; }

function persistAuthState() {
  if (S.token && S.user) return;
  const step  = getAuthStep();
  const email = (authEmail || $('inp-email')?.value || '').trim();
  if (step === 'code' && email) saveAuthState('code', email, authCodeVia);
  else if (step === 'prof' && email) saveAuthState('prof', email, 'email');
  else if (email) saveAuthState('email', email, 'email');
}

function restoreAuthState() {
  if (S.token && S.user) return;
  const saved = loadAuthState();
  if (!saved) { authStep = 'qr'; return; }
  if (saved.email) { authEmail = saved.email; $('inp-email').value = saved.email; }
  if (saved.step === 'code' && saved.email) {
    authStep = 'code';
    $$('.auth-step').forEach(s => { s.classList.remove('on'); s.style.cssText = ''; });
    const codeEl = $('st-code');
    if (codeEl) { codeEl.classList.add('on'); codeEl.style.cssText = ''; }
    _applyCodeViaUI(saved.via || 'email');
    startResendTimer();
    requestAnimationFrame(() => {
      const inputs = $('code-row')?.querySelectorAll('input') || [];
      const first  = [...inputs].find(i => !i.value) || inputs[0];
      if (first) first.focus();
    });
  } else if (saved.step === 'prof') {
    authStep = 'prof';
    $$('.auth-step').forEach(s => { s.classList.remove('on'); s.style.cssText = ''; });
    const profEl = $('st-prof');
    if (profEl) { profEl.classList.add('on'); profEl.style.cssText = ''; }
  } else {
    authStep = 'qr';
    $$('.auth-step').forEach(s => { s.classList.remove('on'); s.style.cssText = ''; });
    const qrEl = $('st-qr');
    if (qrEl) { qrEl.classList.add('on'); qrEl.style.cssText = ''; }
    requestAnimationFrame(() => startQrTab());
  }
  _syncAuthTabs();
}

/* ══ DEVICE DETECTION ═════════════════════════════════════════ */
function _isMobile() {
  return ('ontouchstart' in window || navigator.maxTouchPoints > 0) && window.innerWidth <= 1024;
}

/* ══ STEP ANIMATION ═══════════════════════════════════════════ */
const STEP_ORDER = ['qr', 'email', 'code', 'prof'];
const STEP_DUR   = 340;
const SHIFT      = 90;

function initStepsWrap() {
  const wrap = document.querySelector('.auth-steps-wrap');
  if (!wrap) return;
  const steps = [...$$('.auth-step')];
  steps.forEach(s => { s.style.cssText = 'position:absolute;top:0;left:0;right:0;opacity:0;pointer-events:none;'; });
  void wrap.offsetHeight;
  const maxH = steps.reduce((m, s) => Math.max(m, s.scrollHeight), 0);
  wrap.style.height = maxH + 'px';
  steps.forEach(s => s.style.cssText = '');
  _syncAuthTabs();
}

function _syncAuthTabs() {
}

function goStep(to) {
  const fromEl = [...$$('.auth-step')].find(e => e.classList.contains('on'));
  const toEl   = $('st-' + to);
  if (!toEl || fromEl === toEl) return;
  authStep = to;
  persistAuthState();
  const fromIdx = fromEl ? STEP_ORDER.indexOf(fromEl.id.replace('st-', '')) : -1;
  const toIdx   = STEP_ORDER.indexOf(to);
  const forward = toIdx > fromIdx;
  const ease    = 'cubic-bezier(.25,.46,.45,.94)';
  const trans   = `opacity ${STEP_DUR}ms ${ease}, transform ${STEP_DUR}ms ${ease}`;

  if (fromEl) {
    fromEl.style.transition = 'none';
    fromEl.style.opacity    = '1';
    fromEl.style.transform  = 'none';
    fromEl.classList.remove('on');
  }
  toEl.classList.remove('on');
  toEl.style.transform  = `translateX(${forward ? SHIFT : -SHIFT}px)`;

  requestAnimationFrame(() => {
    if (fromEl) {
      fromEl.style.transition = trans;
      fromEl.style.opacity    = '0';
      fromEl.style.transform  = `translateX(${forward ? -SHIFT : SHIFT}px)`;
    }
    toEl.style.transition = trans;
    toEl.style.opacity    = '1';
    toEl.style.transform  = 'none';

    setTimeout(() => {
      if (fromEl) fromEl.style.cssText = '';
      toEl.style.cssText = '';
      toEl.classList.add('on');
      if (to === 'email') $('inp-email').focus();
    }, STEP_DUR + 20);
  });

  if (to === 'qr')   startQrTab();
  if (to !== 'qr')   stopQrAll();
  _syncAuthTabs();
}

/* ══ QR ENTRY POINT ════════════════════════════════════════════
   Выбирает нужный режим в зависимости от устройства           */
function startQrTab() {
  if (_isMobile()) {
    // Мобильный: показываем viewfinder с иконкой камеры, запускаем только по тапу
    $('qr-desktop').style.display = 'none';
    $('qr-mobile').style.display  = 'flex';
    const vf        = $('qr-scan-viewfinder');
    const camPrompt = $('qr-cam-prompt');
    const video     = $('qr-video');
    if (vf) {
      vf.style.display    = 'flex';
      vf.style.background = 'rgba(255,255,255,0.03)';
      const frameSpan = vf.querySelector('.qr-scan-frame');
      const scanLine  = vf.querySelector('.qr-scan-line');
      if (frameSpan) frameSpan.style.display = 'none';
      if (scanLine)  scanLine.style.display  = 'none';
      if (video)     video.style.display     = 'none';
    }
    if (camPrompt) {
      camPrompt.style.display = 'flex';
      camPrompt.onclick = () => {
        camPrompt.style.display = 'none';
        startQrScanner();
      };
    }
  } else {
    // Десктоп: показываем QR-код для сканирования
    $('qr-desktop').style.display = 'flex';
    $('qr-mobile').style.display  = 'none';
    startQrFlow();
  }
}

function stopQrAll() {
  stopQrFlow();
  stopQrScanner();
}

/* ══ DESKTOP: показ QR-кода ════════════════════════════════════ */
let _qrToken     = null;
let _qrPollTimer = null;
let _qrIsLoading = false;
const _QR_LIFETIME = 175; // seconds before auto-refresh (slightly under server TTL)

/* ══ SKELETON QR (pre-rendered with real QRCodeStyling, data: https://initial.su) ═══ */
let _skelQrReady = false;
function _ensureSkelQr() {
  if (_skelQrReady) return;
  const skelEl = document.getElementById('qr-skel-canvas');
  if (!skelEl || typeof QRCodeStyling === 'undefined') return;
  try {
    skelEl.innerHTML = '';
    const qr = new QRCodeStyling({
      width: 230, height: 230, type: 'svg', data: 'https://initial.su',
      dotsOptions: { color: '#afafaf', type: 'extra-rounded' },
      backgroundOptions: { color: '#ffffff' },
      cornersSquareOptions: { type: 'extra-rounded' },
      qrOptions: { errorCorrectionLevel: 'M' }
    });
    qr.append(skelEl);
    _skelQrReady = true;
  } catch(e) {}
}

/* ══ COUNTDOWN RING ════════════════════════════════════════════ */
function _startCountdownRing(seconds) {
  const svg  = document.getElementById('qr-ring-svg');
  const prog = document.getElementById('qr-ring-progress');
  if (!svg || !prog) return;
  const circ = 1122; // perimeter of rounded-rect path (see path d=)
  prog.style.transition       = 'none';
  prog.style.strokeDasharray  = String(circ);
  prog.style.strokeDashoffset = '0';
  svg.classList.remove('active');
  void svg.offsetHeight;
  requestAnimationFrame(() => {
    svg.classList.add('active');
    prog.style.transition       = `stroke-dashoffset ${seconds}s linear`;
    prog.style.strokeDashoffset = String(circ);
  });
}
function _stopCountdownRing() {
  const svg = document.getElementById('qr-ring-svg');
  if (svg) svg.classList.remove('active');
}

/* ══ AUTO-REFRESH ══════════════════════════════════════════════ */
function _autoRefreshQr() {
  _stopCountdownRing();
  // Show skeleton overlay again for the brief refresh moment, then call startQrFlow
  const skelOv = document.getElementById('qr-skel-overlay');
  if (skelOv) {
    skelOv.style.transition = 'opacity 0.25s ease';
    skelOv.style.display    = 'flex';
    requestAnimationFrame(() => { skelOv.style.opacity = '1'; });
  }
  setTimeout(() => startQrFlow(), 260);
}

async function startQrFlow() {
  if (_qrIsLoading) return;
  _qrIsLoading = true;
  _stopCountdownRing();

  try {
    // Pre-render skeleton QR (if not yet done) and show overlay immediately
    _ensureSkelQr();
    const skelOverlay = document.getElementById('qr-skel-overlay');
    if (skelOverlay) {
      skelOverlay.style.transition = 'none';
      skelOverlay.style.opacity    = '1';
      skelOverlay.style.display    = 'flex';
    }
    const wrap = $('qr-canvas-wrap');
    if (wrap) { wrap.style.display = 'flex'; wrap.style.opacity = '1'; }
    $('qr-err').textContent = '';

    const frame   = $('qr-frame');
    const overlay = $('qr-state-overlay');
    const hint    = $('qr-hint');
    if (frame) frame.style.transform = '';
    if (overlay) { overlay.className = 'qr-state-overlay'; overlay.classList.remove('visible'); overlay.innerHTML = ''; }
    if (hint) hint.style.opacity = '1';

    let res;
    try {
      res = await api('qr_create', 'POST');
    } catch(e) {
      const skelOvErr = document.getElementById('qr-skel-overlay');
      if (skelOvErr) skelOvErr.style.display = 'none';
      $('qr-err').textContent = 'Ошибка сети или сервера: ' + (e.message || e);
      return;
    }

    if (!res.ok) {
      const skelOvErr = document.getElementById('qr-skel-overlay');
      if (skelOvErr) skelOvErr.style.display = 'none';
      $('qr-err').textContent = res.message || 'Ошибка генерации QR';
      return;
    }

    _qrToken = res.token;
    const qrEl = $('qr-canvas');
    qrEl.innerHTML = '';

    try {
      const qrCodeStylingInstance = new QRCodeStyling({
        width: 230, height: 230, type: "svg", data: res.url,
        dotsOptions: { color: "#000000", type: "extra-rounded" },
        backgroundOptions: { color: "#ffffff" },
        cornersSquareOptions: { type: "extra-rounded" },
        qrOptions: { errorCorrectionLevel: 'M' }
      });
      qrCodeStylingInstance.append(qrEl);
    } catch(e) {
      qrEl.innerHTML = `<div style="font-size:10px;word-break:break-all;opacity:.5;padding:8px">Ошибка создания QR-кода: ${e.message}</div>`;
    }

    // Crossfade: skeleton overlay fades out, real QR is already underneath
    const skelOv = document.getElementById('qr-skel-overlay');
    requestAnimationFrame(() => {
      if (skelOv) {
        skelOv.style.transition = 'opacity 0.45s cubic-bezier(.4,0,.2,1)';
        skelOv.style.opacity    = '0.5';
      }
      setTimeout(() => {
        if (skelOv) { skelOv.style.display = 'none'; }
        _startCountdownRing(_QR_LIFETIME);
      }, 460);
    });

    stopQrFlow();
    _qrPollTimer = setInterval(_pollQr, 2000);
  } finally {
    _qrIsLoading = false;
  }
}

function stopQrFlow() {
  if (_qrPollTimer) { clearInterval(_qrPollTimer); _qrPollTimer = null; }
}

async function _pollQr() {
  if (!_qrToken) return;
  let res;
  try { res = await api('qr_poll?token=' + _qrToken); } catch { return; }
  if (!res || !res.ok) return;

  if (res.status === 'scanned') {
    const frame   = $('qr-frame');
    const overlay = $('qr-state-overlay');
    if (frame)   frame.style.transform = 'scale(0.97)';
    if (overlay) {
      overlay.innerHTML = `
        <div class="qr-scanned-dots"><span></span><span></span><span></span></div>
        <div class="qr-scanned-text">Подтвердите на телефоне</div>`;
      overlay.className = 'qr-state-overlay scanned';
      requestAnimationFrame(() => overlay.classList.add('visible'));
    }
    const hint = $('qr-hint');
    if (hint) hint.style.opacity = '0';
  }

  if (res.status === 'approved' && res.auth_token && res.user) {
    stopQrFlow(); _qrToken = null;
    const frame   = $('qr-frame');
    const overlay = $('qr-state-overlay');
    if (frame) frame.style.transform = 'scale(1)';
    if (overlay) {
      overlay.className = 'qr-state-overlay approved';
      overlay.innerHTML = `
        <div class="qr-check-wrap">
          <div class="qr-check-ring"></div>
          <svg class="qr-check-svg" viewBox="0 0 68 68">
            <circle class="circ-bg"   cx="34" cy="34" r="32"/>
            <circle class="circ-fill" cx="34" cy="34" r="32" transform="rotate(-90 34 34)"/>
            <path   class="check-path" d="M20 34 l10 10 18-20"/>
          </svg>
        </div>
        <div class="qr-approved-text">Вход выполнен</div>`;
      requestAnimationFrame(() => overlay.classList.add('visible'));
    }
    S.token = res.auth_token; S.user = res.user;
    localStorage.setItem('sg_token', res.auth_token);
    localStorage.setItem('sg_user', JSON.stringify(res.user));
    setTimeout(() => {
      if (!res.user.signal_id) { $('inp-name').value = res.user.nickname || ''; goStep('prof'); }
      else enterApp();
    }, 1000);
  }

  if (res.status === 'expired') {
    stopQrFlow();
    _autoRefreshQr();
  }
}

/* ══ MOBILE: сканер QR-кода ════════════════════════════════════ */
let _scanStream    = null;
let _scanRaf       = null;
let _scanDetector  = null;   // BarcodeDetector если доступен
let _scanLastText  = '';
let _scanCooldown  = false;

async function startQrScanner() {
  const video     = $('qr-video');
  const status    = $('qr-scan-status');
  const errEl     = $('qr-scan-err');
  const btnWrap   = $('qr-scan-btn-wrap');

  // Сброс предыдущего состояния
  errEl.textContent = '';
  status.textContent = 'Наведите камеру на QR-код';
  _scanLastText = '';
  _scanCooldown = false;

  if (!navigator.mediaDevices?.getUserMedia) {
    _showScanErr('Камера недоступна в этом браузере');
    return;
  }

  try {
    _scanStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    video.srcObject = _scanStream;
    await video.play();

    const vf = $('qr-scan-viewfinder');
    if (vf) {
      vf.style.display = 'flex';
      vf.style.background = '#000';
      const frameSpan = vf.querySelector('.qr-scan-frame');
      const scanLine  = vf.querySelector('.qr-scan-line');
      if (frameSpan) frameSpan.style.display = '';
      if (scanLine)  scanLine.style.display  = '';
    }
    const camPrompt = $('qr-cam-prompt');
    if (camPrompt) camPrompt.style.display = 'none';
    video.style.display = 'block';
    status.style.display = 'block';

    // Инициализируем декодер
    if ('BarcodeDetector' in window) {
      try { _scanDetector = new BarcodeDetector({ formats: ['qr_code'] }); } catch {}
    }

    _runScanLoop();
  } catch(e) {
    if (e.name === 'NotAllowedError') {
      _showScanErr('Нет доступа к камере. Разрешите доступ в настройках браузера.');
    } else if (e.name === 'NotFoundError') {
      _showScanErr('Камера не найдена на этом устройстве.');
    } else {
      _showScanErr('Не удалось запустить камеру: ' + e.message);
    }
  }
}

function _runScanLoop() {
  const video  = $('qr-video');
  const canvas = $('qr-scan-canvas');
  const ctx    = canvas.getContext('2d');

  async function tick() {
    if (!_scanStream || video.readyState < 2) {
      _scanRaf = requestAnimationFrame(tick);
      return;
    }

    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    if (!_scanCooldown) {
      let text = null;

      if (_scanDetector) {
        // Fast path: native BarcodeDetector
        try {
          const codes = await _scanDetector.detect(video);
          if (codes.length) text = codes[0].rawValue;
        } catch {}
      }

      if (!text && typeof jsQR === 'function') {
        // Fallback: jsQR
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
        if (code) text = code.data;
      }

      if (text && text !== _scanLastText) {
        _scanLastText = text;
        _handleQrScan(text);
      }
    }

    _scanRaf = requestAnimationFrame(tick);
  }

  _scanRaf = requestAnimationFrame(tick);
}

function stopQrScanner() {
  if (_scanRaf)    { cancelAnimationFrame(_scanRaf); _scanRaf = null; }
  if (_scanStream) {
    _scanStream.getTracks().forEach(t => t.stop());
    _scanStream = null;
  }
  const video = $('qr-video');
  if (video) video.srcObject = null;
  const vf = $('qr-scan-viewfinder');
  if (vf) {
    vf.style.display = 'flex';
    vf.style.background = 'rgba(255,255,255,0.03)';
    const frameSpan = vf.querySelector('.qr-scan-frame');
    const scanLine  = vf.querySelector('.qr-scan-line');
    if (frameSpan) frameSpan.style.display = 'none';
    if (scanLine)  scanLine.style.display  = 'none';
    if (video) video.style.display = 'none';
  }
  _hideOverlay();
  const camPrompt = $('qr-cam-prompt');
  if (camPrompt) {
    camPrompt.style.display = 'flex';
    camPrompt.onclick = () => {
      camPrompt.style.display = 'none';
      startQrScanner();
    };
  }
}

async function _handleQrScan(rawText) {
  _scanCooldown = true;

  // Вибрация при успешном сканировании
  if ('vibrate' in navigator) navigator.vibrate(50);

  let loginToken = null;
  let linkToken  = null;

  // Разбираем URL из QR
  try {
    const url    = new URL(rawText);
    loginToken   = url.searchParams.get('qr');
    linkToken    = url.searchParams.get('qr_link');
  } catch {
    // Не URL — пробуем как просто токен
    if (/^[0-9a-f]{40,}$/i.test(rawText.trim())) loginToken = rawText.trim();
  }

  if (!loginToken && !linkToken) {
    _setScanStatus('Нераспознанный QR-код', 'err');
    setTimeout(() => { _scanCooldown = false; _scanLastText = ''; _setScanStatus('Наведите камеру на QR-код'); }, 2000);
    return;
  }

  _setScanStatus('Обработка…');
  _showScanOverlay('processing');

  if (linkToken) {
    // ── Вход через "Связать устройство" ─────────────────────────
    // Этот QR создал залогиненный пользователь на другом устройстве
    const res = await api('qr_link_consume', 'POST', { token: linkToken });
    if (res.ok) {
      _showScanOverlay('success');
      S.token = res.auth_token; S.user = res.user;
      localStorage.setItem('sg_token', res.auth_token);
      localStorage.setItem('sg_user', JSON.stringify(res.user));
      setTimeout(() => {
        stopQrScanner();
        const qrMobile = $('qr-mobile');
        if (qrMobile) qrMobile.style.display = 'none';
        if (!res.user.signal_id) { $('inp-name').value = res.user.nickname || ''; goStep('prof'); }
        else enterApp();
      }, 700);

    } else {
      _showScanOverlay('error');
      _setScanStatus(res.message || 'Недействительный QR', 'err');
      setTimeout(() => { _hideOverlay(); _scanCooldown = false; _scanLastText = ''; _setScanStatus('Наведите камеру на QR-код'); }, 2500);
    }
    return;
  }

  if (loginToken) {
    // ── Подтверждение входа другого устройства ────────────────────
    // Этот QR создал другой браузер (desktop) на экране входа
    if (!S.token || !S.user) {
      _showScanOverlay('error');
      _setScanStatus('Войдите в аккаунт, чтобы авторизовать другое устройство', 'err');
      setTimeout(() => { _hideOverlay(); _scanCooldown = false; _scanLastText = ''; _setScanStatus('Наведите камеру на QR-код'); }, 3000);
      return;
    }
    const res = await api('qr_approve', 'POST', { qr_token: loginToken });
    if (res.ok) {
      _showScanOverlay('success');
      _setScanStatus('Устройство авторизовано ✓', 'ok');
      setTimeout(() => {
        stopQrScanner();
        // Hide the entire QR mobile section so user sees clean app screen
        const qrMobile = $('qr-mobile');
        if (qrMobile) qrMobile.style.display = 'none';
        if (S.token && S.user) enterApp();
      }, 1500);
    } else {
      _showScanOverlay('error');
      _setScanStatus(res.message || 'QR истёк или недействителен', 'err');
      setTimeout(() => { _hideOverlay(); _scanCooldown = false; _scanLastText = ''; _setScanStatus('Наведите камеру на QR-код'); }, 2500);
    }
  }
}

function _setScanStatus(msg, type = '') {
  const el = $('qr-scan-status');
  if (!el) return;
  el.textContent  = msg;
  el.className    = 'qr-scan-status' + (type ? ' ' + type : '');
}

function _showScanErr(msg) {
  // Keep viewfinder visible; show camera prompt again so user can retry
  const camPrompt = $('qr-cam-prompt');
  if (camPrompt) camPrompt.style.display = 'flex';
  $('qr-scan-err').textContent = msg;
  $('qr-scan-err').style.display = 'block';
}

function _showScanOverlay(type) {
  const ov = $('qr-scan-overlay');
  if (!ov) return;
  ov.className = 'qr-scan-overlay ' + type;
  ov.style.display = 'flex';
  ov.innerHTML = type === 'processing'
    ? '<div class="loader"></div>'
    : type === 'success'
      ? '<svg viewBox="0 0 48 48" width="52" height="52"><circle cx="24" cy="24" r="22" fill="rgba(139,92,246,.2)"/><path d="M13 24l8 8 14-16" stroke="#8b5cf6" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>'
      : '<svg viewBox="0 0 48 48" width="52" height="52"><circle cx="24" cy="24" r="22" fill="rgba(255,69,58,.15)"/><path d="M15 15l18 18M33 15l-18 18" stroke="#ff453a" stroke-width="3.5" stroke-linecap="round" fill="none"/></svg>';
}

function _hideOverlay() {
  const ov = $('qr-scan-overlay');
  if (ov) { ov.style.display = 'none'; ov.className = 'qr-scan-overlay'; }
}

/* ══ LINK DEVICE (для залогиненных пользователей) ═════════════
   Десктоп: показывает QR для сканирования телефоном
   Мобильный: открывает камеру для сканирования QR с компьютера  */
let _linkQrPollTimer = null;
let _linkScanStream  = null;
let _linkScanRaf     = null;
let _linkScanDetector = null;
let _linkScanCooldown = false;
let _linkScanLastText = '';

async function openLinkDeviceModal() {
  openMod('modal-qr');

  const desktopView = $('link-desktop-view');
  const mobileView  = $('link-mobile-view');

  if (_isMobile()) {
    // ── Мобильный: сканируем QR с экрана компьютера ──────────────
    if (desktopView) desktopView.style.display = 'none';
    if (mobileView)  mobileView.style.display  = 'block';
    $('link-modal-title').textContent = 'Сканировать QR';
    // Сбрасываем состояние
    const vf     = $('link-scan-viewfinder');
    const errEl  = $('link-scan-err');
    const status = $('link-scan-status');
    const startBtn = $('link-scan-start-btn');
    if (vf)     vf.style.display   = 'none';
    if (errEl)  { errEl.textContent = ''; errEl.style.display = 'none'; }
    if (status) { status.textContent = 'Наведите камеру на QR-код'; status.style.display = 'none'; }
    if (startBtn) {
      startBtn.style.display = 'block';
      // iOS требует вызова getUserMedia строго из обработчика жеста
      startBtn.onclick = () => {
        startBtn.style.display = 'none';
        _startLinkScanner();
      };
    }
  } else {
    // ── Десктоп: показываем QR для телефона ──────────────────────
    if (desktopView) desktopView.style.display = 'block';
    if (mobileView)  mobileView.style.display  = 'none';
    $('link-modal-title').textContent = 'Связать устройство';

    const canvas  = $('link-qr-canvas');
    const loading = $('link-qr-loading');
    const err     = $('link-qr-err');
    const success = $('link-qr-success');
    if (canvas)  canvas.innerHTML = '';
    if (loading) loading.style.display = 'flex';
    if (err)     { err.textContent = ''; err.style.display = 'none'; }
    if (success) success.style.display = 'none';

    const res = await api('qr_link_create', 'POST');
    if (!res.ok) {
      if (loading) loading.style.display = 'none';
      if (err) { err.textContent = res.message || 'Ошибка'; err.style.display = 'block'; }
      return;
    }

    if (loading) loading.style.display = 'none';

    try {
      // Use standalone renderer — canvas-based for reliable sizing
      renderLinkQR(canvas, res.url, 240);
    } catch(e) {
      if (canvas) canvas.innerHTML = `<div style="font-size:10px;word-break:break-all;opacity:.5;padding:8px">${res.url}</div>`;
    }

    // Таймер истечения
    let secsLeft = res.expires_in || 180;
    const timer  = $('link-qr-timer');
    clearInterval(_linkQrPollTimer);

    const checkStatus = async () => {
      try {
        const pollRes = await api('qr_poll?token=' + res.token);
        if (pollRes && pollRes.ok) {
          if (pollRes.status === 'approved') {
            clearInterval(_linkQrPollTimer);
            if (canvas) canvas.style.opacity = '0.2';
            if (timer) timer.style.display = 'none';
            if (success) success.style.display = 'block';
            setTimeout(() => closeMod('modal-qr'), 1500);
            return true;
          } else if (pollRes.status === 'expired') {
            clearInterval(_linkQrPollTimer);
            if (canvas) canvas.style.opacity = '.25';
            if (timer) timer.textContent = 'Истёк';
            return true;
          }
        }
      } catch (e) {}
      return false;
    };

    if (timer) {
      timer.style.display = '';
      const tick = async () => {
        const m = Math.floor(secsLeft / 60), s = secsLeft % 60;
        timer.textContent = `${m}:${String(s).padStart(2, '0')}`;
        
        if (secsLeft % 2 === 0) {
          const done = await checkStatus();
          if (done) return;
        }

        if (secsLeft <= 0) {
          clearInterval(_linkQrPollTimer);
          if (canvas) canvas.style.opacity = '.25';
          timer.textContent = 'Истёк';
        }
        secsLeft--;
      };
      tick();
      _linkQrPollTimer = setInterval(tick, 1000);
    }
  }
}

/* ── Мобильный сканер для Link Device ─────────────────────── */
async function _startLinkScanner() {
  const video   = $('link-scan-video');
  const vf      = $('link-scan-viewfinder');
  const status  = $('link-scan-status');
  const errEl   = $('link-scan-err');

  _linkScanCooldown = false;
  _linkScanLastText = '';
  if (errEl)  { errEl.textContent = ''; errEl.style.display = 'none'; }
  if (status) { status.textContent = 'Наведите камеру на QR-код'; status.style.display = 'block'; }

  if (!navigator.mediaDevices?.getUserMedia) {
    if (errEl) { errEl.textContent = 'Камера недоступна в этом браузере'; errEl.style.display = 'block'; }
    return;
  }

  try {
    _linkScanStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    video.srcObject = _linkScanStream;
    await video.play();
    if (vf) vf.style.display = 'flex';

    if ('BarcodeDetector' in window) {
      try { _linkScanDetector = new BarcodeDetector({ formats: ['qr_code'] }); } catch {}
    }

    _runLinkScanLoop();
  } catch(e) {
    let msg = 'Не удалось запустить камеру';
    if (e.name === 'NotAllowedError') msg = 'Нет доступа к камере. Разрешите доступ в настройках браузера.';
    else if (e.name === 'NotFoundError') msg = 'Камера не найдена на этом устройстве.';
    if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
    if (vf) vf.style.display = 'none';
  }
}

function _runLinkScanLoop() {
  const video  = $('link-scan-video');
  const canvas = $('link-scan-canvas');
  const ctx    = canvas.getContext('2d');

  async function tick() {
    if (!_linkScanStream || video.readyState < 2) {
      _linkScanRaf = requestAnimationFrame(tick);
      return;
    }
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    if (!_linkScanCooldown) {
      let text = null;

      if (_linkScanDetector) {
        try {
          const codes = await _linkScanDetector.detect(video);
          if (codes.length) text = codes[0].rawValue;
        } catch {}
      }

      if (!text && typeof jsQR === 'function') {
        const img  = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
        if (code) text = code.data;
      }

      if (text && text !== _linkScanLastText) {
        _linkScanLastText = text;
        _handleLinkQrScan(text);
      }
    }
    _linkScanRaf = requestAnimationFrame(tick);
  }
  _linkScanRaf = requestAnimationFrame(tick);
}

function _stopLinkScanner() {
  if (_linkScanRaf)    { cancelAnimationFrame(_linkScanRaf); _linkScanRaf = null; }
  if (_linkScanStream) { _linkScanStream.getTracks().forEach(t => t.stop()); _linkScanStream = null; }
  const video = $('link-scan-video');
  if (video) video.srcObject = null;
  const vf = $('link-scan-viewfinder');
  if (vf) vf.style.display = 'none';
  const overlay = $('link-scan-overlay');
  if (overlay) { overlay.style.display = 'none'; overlay.className = 'qr-scan-overlay'; }
}

async function _handleLinkQrScan(rawText) {
  _linkScanCooldown = true;
  if ('vibrate' in navigator) navigator.vibrate(50);

  const overlay = $('link-scan-overlay');
  const status  = $('link-scan-status');

  function _setLinkOverlay(type) {
    if (!overlay) return;
    overlay.className = 'qr-scan-overlay ' + type;
    overlay.style.display = 'flex';
    overlay.innerHTML = type === 'processing'
      ? '<div class="loader"></div>'
      : type === 'success'
        ? '<svg viewBox="0 0 48 48" width="52" height="52"><circle cx="24" cy="24" r="22" fill="rgba(139,92,246,.2)"/><path d="M13 24l8 8 14-16" stroke="#8b5cf6" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>'
        : '<svg viewBox="0 0 48 48" width="52" height="52"><circle cx="24" cy="24" r="22" fill="rgba(255,69,58,.15)"/><path d="M15 15l18 18M33 15l-18 18" stroke="#ff453a" stroke-width="3.5" stroke-linecap="round" fill="none"/></svg>';
  }
  function _hideLinkOverlay() {
    if (overlay) { overlay.style.display = 'none'; overlay.className = 'qr-scan-overlay'; }
  }

  let loginToken = null;
  let linkToken  = null;
  try {
    const url = new URL(rawText);
    loginToken = url.searchParams.get('qr');
    linkToken  = url.searchParams.get('qr_link');
  } catch {
    if (/^[0-9a-f]{40,}$/i.test(rawText.trim())) loginToken = rawText.trim();
  }

  if (!loginToken && !linkToken) {
    if (status) { status.textContent = 'Нераспознанный QR-код'; status.className = 'qr-scan-status err'; }
    setTimeout(() => { _linkScanCooldown = false; _linkScanLastText = ''; if (status) { status.textContent = 'Наведите камеру на QR-код'; status.className = 'qr-scan-status'; } }, 2000);
    return;
  }

  if (status) status.textContent = 'Обработка…';
  _setLinkOverlay('processing');

  // Оба типа QR обрабатываем одинаково: потребляем link-токен или
  // подтверждаем login-QR (мобильный залогинен)
  if (linkToken) {
    const res = await api('qr_link_consume', 'POST', { token: linkToken });
    if (res.ok) {
      _setLinkOverlay('success');
      if (status) { status.textContent = 'Устройство связано ✓'; status.className = 'qr-scan-status ok'; }
      S.token = res.auth_token; S.user = res.user;
      localStorage.setItem('sg_token', res.auth_token);
      localStorage.setItem('sg_user', JSON.stringify(res.user));
      setTimeout(() => { _stopLinkScanner(); closeMod('modal-qr'); }, 1200);
    } else {
      _setLinkOverlay('error');
      if (status) { status.textContent = res.message || 'QR истёк или недействителен'; status.className = 'qr-scan-status err'; }
      setTimeout(() => { _hideLinkOverlay(); _linkScanCooldown = false; _linkScanLastText = ''; if (status) { status.textContent = 'Наведите камеру на QR-код'; status.className = 'qr-scan-status'; } }, 2500);
    }
    return;
  }

  if (loginToken) {
    if (!S.token || !S.user) {
      _setLinkOverlay('error');
      if (status) { status.textContent = 'Войдите в аккаунт, чтобы авторизовать другое устройство'; status.className = 'qr-scan-status err'; }
      setTimeout(() => { _hideLinkOverlay(); _linkScanCooldown = false; _linkScanLastText = ''; if (status) { status.textContent = 'Наведите камеру на QR-код'; status.className = 'qr-scan-status'; } }, 3000);
      return;
    }
    const res = await api('qr_approve', 'POST', { qr_token: loginToken });
    if (res.ok) {
      _setLinkOverlay('success');
      if (status) { status.textContent = 'Устройство авторизовано ✓'; status.className = 'qr-scan-status ok'; }
      setTimeout(() => { _stopLinkScanner(); closeMod('modal-qr'); }, 1500);
    } else {
      _setLinkOverlay('error');
      if (status) { status.textContent = res.message || 'QR истёк или недействителен'; status.className = 'qr-scan-status err'; }
      setTimeout(() => { _hideLinkOverlay(); _linkScanCooldown = false; _linkScanLastText = ''; if (status) { status.textContent = 'Наведите камеру на QR-код'; status.className = 'qr-scan-status'; } }, 2500);
    }
  }
}

// Переопределяем btn-link-device
  const bld = document.getElementById('btn-link-device');
  if (bld) bld.onclick = () => openLinkDeviceModal();

// Останавливаем таймер и сканер при закрытии модала
document.addEventListener('click', e => {
  if (e.target.closest('#modal-qr') && e.target.dataset.close === 'modal-qr') {
    clearInterval(_linkQrPollTimer);
    _stopLinkScanner();
  }
});

// Approved on boot: ?qr=TOKEN in URL while already logged in
async function approveQrSession(qrToken) {
  if (!S.token || !S.user) return;
  const res = await api('qr_approve', 'POST', { qr_token: qrToken });
  history.replaceState(null, '', location.pathname);
  toast(res.ok ? 'Устройство авторизовано ✓' : (res.message || 'QR истёк'), res.ok ? 'ok' : 'err');
}

/* ══ RESEND TIMER ══════════════════════════════════════════════ */
let resendTimer = null;
function startResendTimer(isNew = false) {
  const duration = 60; // 60 seconds
  clearInterval(resendTimer);
  const now = Date.now();
  let endsAt = now + duration * 1000;
  
  try {
    const savedTs = parseInt(localStorage.getItem('sg_resend_ts') || '0', 10);
    if (isNew) {
      localStorage.setItem('sg_resend_ts', endsAt);
    } else {
      if (savedTs > 0) {
        if (savedTs > now) {
          endsAt = savedTs; // continue existing timer
        } else {
          endsAt = 0; // expired
        }
      } else {
        endsAt = 0; // nothing saved
      }
    }
  } catch(e) {}

  const cd = $('resend-countdown'), timer = $('resend-timer'), btn = $('btn-resend');
  if (!cd) return;

  if (endsAt === 0) {
    cd.textContent = '0';
    if (timer) timer.style.opacity = '0';
    if (btn) btn.classList.add('visible');
    try { localStorage.removeItem('sg_resend_ts'); } catch(e){}
    return;
  }
  
  if (timer) timer.style.opacity = '1';
  if (btn) btn.classList.remove('visible');

  function _tick() {
    const left = Math.ceil((endsAt - Date.now()) / 1000);
    if (left <= 0) {
      clearInterval(resendTimer);
      if (cd) cd.textContent = '0';
      if (timer) timer.style.opacity = '0';
      if (btn) btn.classList.add('visible');
      try { localStorage.removeItem('sg_resend_ts'); } catch(e){}
    } else {
      if (cd) cd.textContent = left;
    }
  }
  _tick();
  resendTimer = setInterval(_tick, 1000);
}

/* ══ CODE STEP UI ══════════════════════════════════════════════ */
function _applyCodeViaUI(via) {
  authCodeVia = via;
  const isSignal = (via === 'signal');
  $('code-title').textContent = isSignal ? 'Код в Signal' : 'Проверьте почту';
  if (isSignal) {
    $('code-desc').innerHTML = 'Отправили код в чат с <b>@initial</b> внутри мессенджера';
    $('code-via-signal').style.display     = 'flex';
    $('code-email-fallback').style.display = 'block';
    // Обновляем текст кнопки для случая signal
    const btnFallback = $('btn-code-email-fallback');
    if (btnFallback) btnFallback.textContent = 'Отправить код на email';
  } else {
    $('code-desc').innerHTML = 'Отправили 5-значный код на <b>' + (authEmail || '') + '</b>';
    $('code-via-signal').style.display     = 'none';
    $('code-email-fallback').style.display = 'none';
  }
}

/* ══ BUTTON HANDLERS ═══════════════════════════════════════════ */
const teb = $('tab-email-btn'); if (teb) teb.onclick = () => { if (authStep !== 'email') goStep('email'); };
const tqb = $('tab-qr-btn');    if (tqb) tqb.onclick   = () => { if (authStep !== 'qr')    goStep('qr'); };
const bqr = $('btn-qr-refresh'); if (bqr) bqr.onclick = () => startQrFlow();

$('btn-code').onclick = async () => {
  const email = $('inp-email').value.trim(); if (!email) return;
  const btn = $('btn-code'); btn.disabled = true; btn.classList.add('sp');
  $('e-email').classList.remove('on');
  try { localStorage.removeItem('sg_resend_ts'); } catch(e){}
  const res = await api('send_code', 'POST', { email });
  btn.disabled = false; btn.classList.remove('sp');
  if (res.ok) {
    authEmail = email;
    saveAuthState('code', email, res.via || 'email');
    _applyCodeViaUI(res.via || 'email');
    goStep('code');
    startResendTimer(true);
    $('code-row').querySelectorAll('input')[0].focus();
  } else {
    $('e-email').textContent = res.message || 'Ошибка';
    $('e-email').classList.add('on');
  }
};

$('inp-email').onkeydown = e => { if (e.key === 'Enter') $('btn-code').click(); };
$('btn-back-email').onclick = () => { clearAuthState(); goStep('email'); };

$('btn-resend').onclick = async () => {
  const btn = $('btn-resend'); btn.style.opacity = '.5'; btn.style.pointerEvents = 'none';
  const forceEmail = (authCodeVia === 'email');
  const res = await api('send_code', 'POST', { email: authEmail, force_email: forceEmail });
  btn.style.opacity = ''; btn.style.pointerEvents = '';
  if (res.ok) {
    try { localStorage.removeItem('sg_resend_ts'); } catch(e){}
    toast('Код отправлен повторно', 'ok'); 
    _applyCodeViaUI(res.via || authCodeVia); 
    saveAuthState('code', authEmail, res.via || authCodeVia);
    startResendTimer(true); 
  }
  else toast(res.message || 'Ошибка', 'err');
};

$('btn-code-email-fallback').onclick = async () => {
  const btn = $('btn-code-email-fallback'); btn.style.opacity = '.5'; btn.style.pointerEvents = 'none';
  const res = await api('send_code', 'POST', { email: authEmail, force_email: true });
  btn.style.opacity = ''; btn.style.pointerEvents = '';
  if (res.ok) {
    try { localStorage.removeItem('sg_resend_ts'); } catch(e){}
    _applyCodeViaUI('email'); 
    saveAuthState('code', authEmail, 'email');
    toast('Код отправлен на почту', 'ok'); 
    startResendTimer(true); 
  }
  else toast(res.message || 'Ошибка', 'err');
};

$('code-row').querySelectorAll('input').forEach((inp, i, all) => {
  inp.oninput = () => {
    inp.value = inp.value.replace(/\D/g, '');
    inp.classList.toggle('filled', !!inp.value);
    if (inp.value && i < all.length - 1) all[i + 1].focus();
    if ([...all].every(x => x.value)) $('btn-verify').click();
  };
  inp.onkeydown = e => {
    if (e.key === 'Backspace' && !inp.value && i > 0) { all[i-1].focus(); all[i-1].value = ''; all[i-1].classList.remove('filled'); }
    if (e.key === 'ArrowLeft'  && i > 0)              all[i-1].focus();
    if (e.key === 'ArrowRight' && i < all.length - 1) all[i+1].focus();
  };
  inp.onpaste = e => {
    e.preventDefault();
    const t = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '').slice(0, 5);
    [...t].forEach((c, j) => { if (all[j]) all[j].value = c; });
    if (all[t.length - 1]) all[t.length - 1].focus();
    if (t.length === 5) setTimeout(() => $('btn-verify').click(), 100);
  };
});

$('btn-verify').onclick = async () => {
  const inputs = $('code-row').querySelectorAll('input');
  const code   = [...inputs].map(x => x.value).join('');
  if (code.length !== 5) return;
  const btn = $('btn-verify'); btn.disabled = true; btn.classList.add('sp');
  $('e-code').classList.remove('on');
  const res = await api('verify_code', 'POST', { email: authEmail, code });
  btn.disabled = false; btn.classList.remove('sp');
  if (res.ok) {
    S.token = res.token; S.user = res.user;
    localStorage.setItem('sg_token', res.token);
    localStorage.setItem('sg_user', JSON.stringify(res.user));
    if (res.is_new_user || !res.user.signal_id) {
      $('inp-name').value = res.user.nickname || ''; $('inp-sid').value = res.user.signal_id || '';
      goStep('prof');
    } else enterApp();
  } else {
    $('e-code').textContent = res.message || 'Неверный код';
    $('e-code').classList.add('on');
    [...inputs].forEach(i => i.value = ''); inputs[0].focus();
  }
};

$('btn-saveprof').onclick = async () => {
  const nickname = $('inp-name').value.trim(), signal_id = $('inp-sid').value.trim().toLowerCase();
  $('e-prof').classList.remove('on');
  if (!nickname || !signal_id) { $('e-prof').textContent = 'Заполните все поля'; $('e-prof').classList.add('on'); return; }
  const btn = $('btn-saveprof'); btn.disabled = true; btn.classList.add('sp');
  const res = await api('update_profile', 'POST', { nickname, signal_id, avatar_url: S.user.avatar_url || '' });
  btn.disabled = false; btn.classList.remove('sp');
  if (res.ok) { S.user = res.user; localStorage.setItem('sg_user', JSON.stringify(res.user)); enterApp(); }
  else { $('e-prof').textContent = res.message || 'Ошибка'; $('e-prof').classList.add('on'); }
};

/* ══ APP LIFECYCLE ══════════════════════════════════════════════ */
function enterApp() {
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  clearAuthState(); stopQrAll();
  showScr('scr-app'); updateFooter(); loadChats(); startPoll(); startGlobalSSE(); syncNotifUI(); if(window.initChannels)initChannels();
}

function logout() {
  clearInterval(S.polling); clearInterval(S._bgSync); clearInterval(S._burstPoll);
  if (S.sse) { stopSSE(); }
  if (S._callSigInterval) { clearInterval(S._callSigInterval); S._callSigInterval = null; }
  stopQrAll();
  
  // ── Wipe all per-user cache so next account won't see it ──
  try {
    const toDelete = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith('sg_cache_') || k.startsWith('sg_scroll_') || k.startsWith('sg_ch_') || k === 'sg_cache_chats' || k === 'sg_active_chat')) {
        toDelete.push(k);
      }
    }
    toDelete.forEach(k => localStorage.removeItem(k));
  } catch(e) {}
  
  try {
    localStorage.removeItem('sg_token');
    localStorage.removeItem('sg_user');
  } catch(e) {}
  
  S.token = null; S.user = null; S.chatId = null; S.partner = null; S.msgs = {}; S.chats = []; S.lastId = {}; S.rxns = {};
  S.channels = []; S.activeChannel = null; S.channelMsgs = {}; S.channelLastId = {};

  clearAuthState();
  authEmail = '';
  if ($('inp-email')) $('inp-email').value = '';
  
  if ($('sb-profile-panel')) $('sb-profile-panel').classList.remove('open');
  $$('.modal.on').forEach(m => m.classList.remove('on'));
  
  showScr('scr-auth');
  
  $$('.auth-step').forEach(s => { s.classList.remove('on'); s.style.cssText = ''; });
  
  const targetTab = ($('st-qr') && !_isMobile()) ? 'qr' : 'email';
  authStep = targetTab;
  const toEl = $('st-' + targetTab);
  if (toEl) { toEl.classList.add('on'); }
  
  _syncAuthTabs();
  if (targetTab === 'qr') startQrTab();
  else stopQrAll();
}

function updateFooter() {
  if (!S.user) return; const u = S.user;
  const fn = $('foot-name'); fn.textContent = '';
  const fnSpan = document.createElement('span'); fnSpan.textContent = u.nickname || u.email; wtn(fnSpan); fn.appendChild(fnSpan);
  const sid = (u.signal_id || '').toLowerCase();
  if (isVerified({ signal_id: sid, is_verified: u.is_verified })) {
    const vb = document.createElement('span');
    vb.innerHTML = '<svg class="verified-badge sm" viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg" style="margin-left:3px;flex-shrink:0"><path d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.705 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681s.075-1.299-.165-1.903c.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z" fill="currentColor"/></svg>';
    fn.appendChild(vb.firstChild);
  }
  fn.style.display = 'flex'; fn.style.alignItems = 'center'; fn.style.gap = '3px';
  $('foot-id').textContent = u.signal_id ? `@${u.signal_id}` : u.email;
  $('foot-av').innerHTML   = aviHtml(u.nickname || u.email, u.avatar_url);
  // Update mobile navbar avatar
  var mobileNavAv = document.getElementById('mobile-nav-av');
  if (mobileNavAv) mobileNavAv.innerHTML = aviHtml(u.nickname || u.email, u.avatar_url);
}

function syncNotifUI() {
  const n = S.notif;
  $('tog-notif').classList.toggle('on', n.enabled);
  $('tog-sound').classList.toggle('on', n.sound);
  $('tog-anon').classList.toggle('on',  n.anon);
  $('tog-inapp-push').classList.toggle('on', n.inappPush !== false);
}

initStepsWrap();
// QR-first: start QR tab immediately on load
requestAnimationFrame(() => startQrTab());

// "Войти по email" links inside the QR step
document.addEventListener('click', e => {
  if (e.target.id === 'btn-email-from-qr' || e.target.id === 'btn-email-from-qr-mobile') {
    goStep('email');
    requestAnimationFrame(() => $('inp-email')?.focus());
  }
});

// Сохраняем email при потере фокуса
const inpEmail = $('inp-email');
if (inpEmail) {
  inpEmail.addEventListener('blur', () => persistAuthState());
}

// Сохраняем состояние перед закрытием страницы
window.addEventListener('beforeunload', () => persistAuthState());
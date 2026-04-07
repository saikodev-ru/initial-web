/**
 * fcm.js — Firebase Cloud Messaging for push notifications.
 *
 * Strategy:
 *   - FCM is the SOLE push channel (no VAPID Web Push).
 *   - Register FCM token on ALL platforms (Android, desktop, iOS).
 *   - If FCM is not supported, the UI shows an error prompting the user
 *     to install a supported browser (Chrome, Edge, Firefox, etc.).
 *
 * Dependencies:
 *   - Firebase App + Messaging compat SDKs (loaded via CDN in index.html)
 *   - Global state S (S.token, S.notif.enabled)
 *   - Global api() from utils.js
 */

/* global S, api, firebase */

(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════════
  // SW register patch — redirect Firebase hardcoded paths to /web/
  //
  // Firebase SDK v10+ hardcodes:
  //   script → /firebase-messaging-sw.js
  //   scope → /firebase-cloud-messaging-push-scope
  // When the app lives in a subdirectory (e.g. /web/), these paths
  // resolve to the origin root and return 404.
  //
  // We intercept the registration call and rewrite both paths to
  // include the app's base directory, derived from this script's URL.
  // ═══════════════════════════════════════════════════════════════
  const _FCM_SW_SCRIPT = '/firebase-messaging-sw.js';
  const _FCM_SW_SCOPE  = '/firebase-cloud-messaging-push-scope';

  // Derive /web from this script's src  (…/web/js/fcm.js → /web)
  const _fcmScriptEl = document.querySelector('script[src*="fcm.js"]');
  const _WEB_BASE = _fcmScriptEl
    ? new URL('..', _fcmScriptEl.src).pathname.replace(/\/$/, '')
    : '';

  if (_WEB_BASE && 'serviceWorker' in navigator) {
    const _origRegister = navigator.serviceWorker.register.bind(navigator.serviceWorker);
    navigator.serviceWorker.register = function (scriptURL, options) {
      let url = typeof scriptURL === 'string' ? scriptURL : scriptURL.toString();
      if (url === _FCM_SW_SCRIPT || url === new URL(_FCM_SW_SCRIPT, location.origin).href) {
        url = _WEB_BASE + _FCM_SW_SCRIPT;
        if (options && options.scope === _FCM_SW_SCOPE) {
          options = Object.assign({}, options, { scope: _WEB_BASE + _FCM_SW_SCOPE });
        }
        console.log('[FCM] Patched SW path:', url, 'scope:', options?.scope);
      }
      return _origRegister(url, options);
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // Firebase Configuration — from Firebase Console → Project Settings → Web App
  // ═══════════════════════════════════════════════════════════════
  const FIREBASE_CONFIG = {
    apiKey:            'AIzaSyBP2OObK7mkIIJfPxJOaJJ7hcP76q2gxX4',
    authDomain:        'initial-messenger.firebaseapp.com',
    projectId:         'initial-messenger',
    storageBucket:     'initial-messenger.firebasestorage.app',
    messagingSenderId: '879915718420',
    appId:             '1:879915718420:web:1ed8f51e05a847a065bd21',
  };

  // VAPID key from Firebase Console → Project Settings → Cloud Messaging → Web Push certs
  const FCM_VAPID_KEY = 'BDDKX_qLAKyRECL0QzvMHVUde4z0AXC6k-rYBiw6rA6gyaaTQpmFlto1PIVwwqBDXz5RDNVbPhew74HWiq99YZQ';

  const FCM_TOKEN_KEY = 'sg_fcm_token'; // localStorage key

  // ── Detection ───────────────────────────────────────────────

  /**
   * Check if Firebase Messaging is available in this browser.
   * Returns true if Firebase SDK is loaded and Notification + SW APIs exist.
   */
  function _isFCMSupported() {
    return typeof firebase !== 'undefined' &&
           firebase.messaging &&
           'Notification' in window &&
           'serviceWorker' in navigator;
  }

  /**
   * Returns detailed info about why FCM might not be supported.
   * Used to show user-friendly error messages.
   */
  function _getFCMUnsupportedReason() {
    if (typeof firebase === 'undefined' || !firebase.messaging) {
      return 'Firebase SDK не загружен. Используйте современный браузер (Chrome, Edge, Firefox).';
    }
    if (!('serviceWorker' in navigator)) {
      return 'Ваш браузер не поддерживает Service Workers. Установите Chrome, Edge или Firefox для получения push-уведомлений.';
    }
    if (!('Notification' in window)) {
      return 'Ваш браузер не поддерживает уведомления. Установите Chrome, Edge или Firefox.';
    }
    return 'Push-уведомления не поддерживаются. Попробуйте другой браузер.';
  }

  // ── Storage ─────────────────────────────────────────────────

  function _getStoredToken() {
    try { return localStorage.getItem(FCM_TOKEN_KEY); } catch { return null; }
  }

  function _setStoredToken(token) {
    try { localStorage.setItem(FCM_TOKEN_KEY, token || ''); } catch {}
  }

  // ── Server registration ────────────────────────────────────

  async function _registerTokenOnServer(token) {
    if (!S.token || !token) return false;
    try {
      const res = await api('register_fcm', 'POST', { fcm_token: token });
      if (res && res.ok) {
        console.log('[FCM] Token registered on server');
        return true;
      }
      console.warn('[FCM] Server registration failed:', res);
      return false;
    } catch (err) {
      console.error('[FCM] Server registration error:', err);
      return false;
    }
  }

  async function _unregisterTokenOnServer() {
    if (!S.token) return;
    try {
      await api('register_fcm', 'POST', { fcm_token: '' });
      console.log('[FCM] Token removed from server');
    } catch {}
  }

  // ── FCM Registration ───────────────────────────────────────

  async function registerFCM() {
    if (!_isFCMSupported()) {
      console.warn('[FCM] Not supported:', _getFCMUnsupportedReason());
      return { ok: false, reason: _getFCMUnsupportedReason() };
    }

    // Initialize Firebase app (safe to call multiple times)
    if (!firebase.apps.length) {
      firebase.initializeApp(FIREBASE_CONFIG);
    }

    const messaging = firebase.messaging();

    // Request permission if not already granted
    if (Notification.permission === 'default') {
      const granted = await Notification.requestPermission();
      if (granted !== 'granted') {
        console.warn('[FCM] Notification permission denied');
        return { ok: false, reason: 'Разрешите уведомления в настройках браузера.' };
      }
    }

    if (Notification.permission !== 'granted') {
      console.warn('[FCM] No notification permission');
      return { ok: false, reason: 'Уведомления заблокированы в настройках браузера.' };
    }

    try {
      // Get FCM registration token
      const currentToken = await messaging.getToken({
        vapidKey: FCM_VAPID_KEY,
      });

      if (!currentToken) {
        console.warn('[FCM] No token received');
        return { ok: false, reason: 'Не удалось получить push-токен. Попробуйте позже.' };
      }

      // Check if token changed
      const stored = _getStoredToken();
      if (stored === currentToken) {
        return { ok: true }; // Already registered
      }

      // Register on server
      const ok = await _registerTokenOnServer(currentToken);
      if (ok) {
        _setStoredToken(currentToken);
        console.log('[FCM] Registered successfully');
      }
      return { ok };
    } catch (err) {
      if (err.code === 'messaging/permission-blocked') {
        return { ok: false, reason: 'Уведомления заблокированы в настройках браузера.' };
      } else if (err.code === 'messaging/token-unsubscribe-failed') {
        console.warn('[FCM] Token unsubscribe failed');
        return { ok: false, reason: 'Ошибка подписки. Попробуйте позже.' };
      } else {
        console.error('[FCM] Registration error:', err);
        return { ok: false, reason: 'Ошибка регистрации push-уведомлений: ' + (err.message || 'неизвестная ошибка') };
      }
    }
  }

  // ── FCM Unregistration ─────────────────────────────────────

  async function unregisterFCM() {
    if (!_isFCMSupported()) return;
    try {
      if (!firebase.apps.length) return;
      const messaging = firebase.messaging();

      const token = await messaging.getToken().catch(() => null);
      if (token) {
        await messaging.deleteToken(token);
        console.log('[FCM] Client token deleted');
      }
    } catch {}
    _setStoredToken(null);
    await _unregisterTokenOnServer();
    console.log('[FCM] Unregistered');
  }

  // ── Token refresh listener ─────────────────────────────────

  function _setupTokenRefresh() {
    if (!_isFCMSupported()) return;
    try {
      if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
      const messaging = firebase.messaging();

      messaging.onTokenRefresh(async () => {
        console.log('[FCM] Token refreshed');
        const newToken = await messaging.getToken({ vapidKey: FCM_VAPID_KEY }).catch(() => null);
        if (newToken && S.token) {
          await _registerTokenOnServer(newToken);
          _setStoredToken(newToken);
        }
      });
    } catch {}
  }

  // ── Foreground message handler ─────────────────────────────

  function _setupForegroundMessages() {
    if (!_isFCMSupported()) return;
    try {
      if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
      const messaging = firebase.messaging();

      messaging.onMessage((payload) => {
        // Forward to the existing message handler
        console.log('[FCM] Foreground message:', payload);
        if (payload.data) {
          // Dispatch as if it came from the SW
          window.dispatchEvent(new CustomEvent('FCM_MSG', { detail: payload.data }));
        }
      });
    } catch {}
  }

  // ── Expose globally ────────────────────────────────────────

  window.registerFCM = registerFCM;
  window.unregisterFCM = unregisterFCM;
  window.__fcmReady = true;
  window.isFCMSupported = _isFCMSupported;
  window.getFCMUnsupportedReason = _getFCMUnsupportedReason;

  // ── Auto-register on load ──────────────────────────────────
  function _autoRegister() {
    if (!S.token || !S.notif?.enabled) return;
    if (Notification.permission !== 'granted') return;

    registerFCM().catch(() => {});
  }

  // Setup listeners
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      _setupTokenRefresh();
      _setupForegroundMessages();
      setTimeout(_autoRegister, 3000);
    });
  } else {
    _setupTokenRefresh();
    _setupForegroundMessages();
    setTimeout(_autoRegister, 3000);
  }

})();

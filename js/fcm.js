/**
 * fcm.js — Firebase Cloud Messaging for Android PWA push delivery.
 *
 * Strategy:
 *   - On Android PWA (standalone + Android UA): register FCM token
 *   - On desktop / iOS: skip (VAPID Web Push from push-subscribe.js handles it)
 *
 * FCM is the ONLY reliable way to deliver pushes to a backgrounded PWA
 * on Android. The native VAPID Web Push is unreliable there because
 * Android Chrome aggressively throttles non-FCM push services.
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
  // This is DIFFERENT from our self-generated VAPID key in push-subscribe.js
  const FCM_VAPID_KEY = 'BDDKX_qLAKyRECL0QzvMHVUde4z0AXC6k-rYBiw6rA6gyaaTQpmFlto1PIVwwqBDXz5RDNVbPhew74HWiq99YZQ';

  const FCM_TOKEN_KEY = 'sg_fcm_token'; // localStorage key

  // ── Detection ───────────────────────────────────────────────

  /**
   * Returns true on any Android Chrome (standalone OR browser tab).
   * FCM token registration must work even before the user installs
   * the PWA so that background pushes arrive on first use.
   */
  function _isAndroid() {
    return /Android/i.test(navigator.userAgent);
  }

  /** Legacy alias kept for internal use */
  function _isAndroidPWA() {
    return _isAndroid();
  }

  function _isFCMSupported() {
    return typeof firebase !== 'undefined' &&
           firebase.messaging &&
           'Notification' in window &&
           'serviceWorker' in navigator;
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
    if (!_isAndroidPWA()) {
      console.log('[FCM] Skipped: not Android PWA');
      return false;
    }
    if (!_isFCMSupported()) {
      console.warn('[FCM] Firebase SDK not loaded or not supported');
      return false;
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
        return false;
      }
    }

    if (Notification.permission !== 'granted') {
      console.warn('[FCM] No notification permission');
      return false;
    }

    try {
      // Get FCM registration token
      const currentToken = await messaging.getToken({
        vapidKey: FCM_VAPID_KEY,
      });

      if (!currentToken) {
        console.warn('[FCM] No token received');
        return false;
      }

      // Check if token changed
      const stored = _getStoredToken();
      if (stored === currentToken) {
        return true; // Already registered
      }

      // Register on server
      const ok = await _registerTokenOnServer(currentToken);
      if (ok) {
        _setStoredToken(currentToken);
        console.log('[FCM] Registered successfully');
      }
      return ok;
    } catch (err) {
      if (err.code === 'messaging/permission-blocked') {
        console.warn('[FCM] Permission blocked');
      } else if (err.code === 'messaging/token-unsubscribe-failed') {
        console.warn('[FCM] Token unsubscribe failed');
      } else {
        console.error('[FCM] Registration error:', err);
      }
      return false;
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

  // ── Auto-register on load ──────────────────────────────────
  function _autoRegister() {
    if (!_isAndroidPWA()) return;
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

/**
 * fcm.js — Firebase Cloud Messaging integration for web push notifications.
 *
 * Uses the Firebase Web SDK (modular, v10+) to obtain an FCM registration
 * token and send it to the server via /api/register_fcm.
 *
 * The token is automatically refreshed and re-sent when it changes.
 *
 * IMPORTANT: Replace the firebaseConfig below with your actual Firebase
 * project configuration. You can find it in:
 *   Firebase Console → Project Settings → General → Your apps → Web app
 */

/* global S, api, requestNotifPermission */

(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════════
  // Firebase configuration — REPLACE WITH YOUR PROJECT VALUES
  // ═══════════════════════════════════════════════════════════════
  const firebaseConfig = {
    apiKey:            '',
    authDomain:        '',
    projectId:         '',
    storageBucket:     '',
    messagingSenderId: '',
    appId:             '',
  };

  // Bail out if config is not filled in
  const configReady = Object.values(firebaseConfig).every(v => typeof v === 'string' && v.length > 0);
  if (!configReady) {
    console.warn('[FCM] firebaseConfig is not configured — push notifications disabled.');
    window.__fcmReady = false;
    return;
  }

  // ═══════════════════════════════════════════════════════════════
  // Lazy-load Firebase SDK (modular from CDN)
  // ═══════════════════════════════════════════════════════════════
  let _initialized = false;
  let _messaging = null;

  async function _ensureFirebase() {
    if (_initialized) return _messaging;
    _initialized = true;

    try {
      // Dynamic import of Firebase ESM modules from CDN
      const [{ initializeApp }, { getMessaging, getToken, onMessage, deleteToken }]
        = await Promise.all([
          import('https://www.gstatic.com/firebasejs/11.9.1/firebase-app.js'),
          import('https://www.gstatic.com/firebasejs/11.9.1/firebase-messaging.js'),
        ]);

      const app = initializeApp(firebaseConfig);
      _messaging = getMessaging(app);

      // Listen for foreground messages
      onMessage(_messaging, (payload) => {
        // Foreground messages are handled by the page directly via SSE;
        // this is just for logging / optional in-app toast
        console.log('[FCM] Foreground message:', payload);
      });

      return _messaging;
    } catch (err) {
      console.error('[FCM] Failed to initialize Firebase:', err);
      _initialized = false; // allow retry
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Token management
  // ═══════════════════════════════════════════════════════════════
  const FCM_TOKEN_KEY = 'sg_fcm_token';

  function _getStoredToken() {
    try { return localStorage.getItem(FCM_TOKEN_KEY); } catch { return null; }
  }

  function _setStoredToken(token) {
    try { localStorage.setItem(FCM_TOKEN_KEY, token || ''); } catch {}
  }

  async function _sendTokenToServer(token) {
    if (!S.token) return false;
    try {
      const res = await api('register_fcm', 'POST', { fcm_token: token });
      if (res && res.ok) {
        console.log('[FCM] Token registered on server');
        return true;
      }
      console.warn('[FCM] Server registration failed:', res);
      return false;
    } catch (err) {
      console.error('[FCM] Error sending token to server:', err);
      return false;
    }
  }

  /**
   * Request FCM token and register with the server.
   * Called when the user enables notifications.
   */
  async function registerFCM() {
    const messaging = await _ensureFirebase();
    if (!messaging) {
      console.error('[FCM] Messaging not available');
      return false;
    }

    try {
      // Request notification permission first
      const granted = await requestNotifPermission();
      if (!granted) {
        console.warn('[FCM] Notification permission not granted');
        return false;
      }

      const vapidKey = ''; // VAPID key if using Web Push directly; empty for FCM
      const currentToken = await getToken(messaging, vapidKey ? { vapidKey } : {});

      if (currentToken) {
        const stored = _getStoredToken();
        // Only send to server if token changed
        if (currentToken !== stored) {
          await _sendTokenToServer(currentToken);
          _setStoredToken(currentToken);
        }
        return true;
      } else {
        console.warn('[FCM] No token obtained — permission may be denied');
        return false;
      }
    } catch (err) {
      console.error('[FCM] Error getting token:', err);
      return false;
    }
  }

  /**
   * Unregister FCM token (when user disables notifications).
   */
  async function unregisterFCM() {
    const messaging = await _ensureFirebase();
    if (!messaging) return;
    try {
      await deleteToken(messaging);
      _setStoredToken('');
      console.log('[FCM] Token deleted');
    } catch (err) {
      console.warn('[FCM] Error deleting token:', err);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Auto-register on load if notifications are enabled
  // ═══════════════════════════════════════════════════════════════
  window.__fcmReady = configReady;
  window.registerFCM = registerFCM;
  window.unregisterFCM = unregisterFCM;

  // Auto-register after auth is ready
  function _autoRegister() {
    if (!S.token || !S.notif?.enabled) return;
    if (Notification.permission === 'granted') {
      registerFCM().catch(() => {});
    }
  }

  // Wait for the app to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(_autoRegister, 1500));
  } else {
    setTimeout(_autoRegister, 1500);
  }
})();

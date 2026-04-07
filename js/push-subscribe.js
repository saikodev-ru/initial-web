/**
 * push-subscribe.js — Web Push API subscription (no Firebase, no FCM).
 *
 * Uses the standard Web Push API with VAPID keys.
 * - Subscribes via navigator.serviceWorker.pushManager
 * - Sends subscription to server via /api/save_push_subscription
 * - Auto-renews subscription on change
 *
 * VAPID keys are configured below (public key only; private key stays server-side).
 */

/* global S, api, requestNotifPermission */

(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════════
  // VAPID Public Key (URL-safe Base64, no padding)
  // Generated with: npx web-push generate-vapid-keys
  // Private key lives on the server only — NEVER expose it client-side.
  // ═══════════════════════════════════════════════════════════════
  const VAPID_PUBLIC_KEY =
    'BDDKX_qLAKyRECL0QzvMHVUde4z0AXC6k-rYBiw6rA6gyaaTQpmFlto1PIVwwqBDXz5RDNVbPhew74HWiq99YZQ';

  // Convert URL-safe Base64 → Uint8Array (required by pushManager.subscribe)
  // URL-safe Base64 uses - and _ instead of + and /
  function _urlBase64ToUint8(base64) {
    try {
      // Replace URL-safe chars with standard Base64 chars
      const base64std = base64.replace(/-/g, '+').replace(/_/g, '/');
      const padding = '='.repeat((4 - base64std.length % 4) % 4);
      const raw = atob(base64std + padding);
      return Uint8Array.from(raw, c => c.charCodeAt(0));
    } catch (e) {
      console.error('[WebPush] Invalid VAPID public key:', e);
      return null;
    }
  }

  const _appServerKey = _urlBase64ToUint8(VAPID_PUBLIC_KEY);
  if (!_appServerKey) {
    console.error('[WebPush] Cannot proceed without valid VAPID key');
  }
  const SUB_KEY = 'sg_push_sub'; // localStorage key for stored subscription JSON

  // ── Helpers ──────────────────────────────────────────────────

  function _getStoredSub() {
    try {
      const raw = localStorage.getItem(SUB_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function _setStoredSub(sub) {
    try { localStorage.setItem(SUB_KEY, sub ? JSON.stringify(sub) : ''); } catch {}
  }

  /**
   * Send subscription to server.
   * The server stores it and uses it to push messages.
   */
  async function _sendSubToServer(subscription) {
    if (!S.token) return false;
    try {
      const res = await api('save_push_subscription', 'POST', {
        endpoint:    subscription.endpoint,
        keys_p256dh: subscription.keys.p256dh,
        keys_auth:   subscription.keys.auth,
      });
      if (res && res.ok) {
        console.log('[WebPush] Subscription saved on server');
        return true;
      }
      console.warn('[WebPush] Server save failed:', res);
      return false;
    } catch (err) {
      console.error('[WebPush] Error sending subscription:', err);
      return false;
    }
  }

  /**
   * Remove subscription from server.
   */
  async function _removeSubFromServer() {
    if (!S.token) return;
    try {
      await api('remove_push_subscription', 'POST', {});
      console.log('[WebPush] Subscription removed from server');
    } catch {}
  }

  // ── Public API ───────────────────────────────────────────────

  /**
   * Subscribe to push notifications and register on server.
   * Call this after user grants Notification permission.
   * Returns true on success.
   */
  async function subscribePush() {
    // Ensure VAPID key was parsed correctly
    if (!_appServerKey) {
      console.error('[WebPush] VAPID key not available');
      return false;
    }

    // Ensure Service Worker is ready
    const reg = await navigator.serviceWorker?.ready;
    if (!reg) {
      console.error('[WebPush] Service Worker not ready');
      return false;
    }

    try {
      const existing = await reg.pushManager.getSubscription();
      if (existing) {
        // Already subscribed — just re-send to server if different
        const stored = _getStoredSub();
        if (stored && stored.endpoint === existing.endpoint) {
          return true; // Already registered
        }
        // Subscription changed — update server
        const ok = await _sendSubToServer(existing);
        if (ok) _setStoredSub(existing);
        return ok;
      }

      // Subscribe fresh
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: _appServerKey,
      });

      const ok = await _sendSubToServer(subscription);
      if (ok) {
        _setStoredSub(subscription);
        console.log('[WebPush] Subscribed successfully');
      }
      return ok;
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        console.warn('[WebPush] Permission denied');
      } else {
        console.error('[WebPush] Subscription error:', err);
      }
      return false;
    }
  }

  /**
   * Unsubscribe from push and notify server.
   */
  async function unsubscribePush() {
    try {
      const reg = await navigator.serviceWorker?.ready;
      if (!reg) return;

      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await sub.unsubscribe();
      }
      _setStoredSub(null);
      await _removeSubFromServer();
      console.log('[WebPush] Unsubscribed');
    } catch (err) {
      console.warn('[WebPush] Unsubscribe error:', err);
    }
  }

  // ── Expose globally ──────────────────────────────────────────

  window.subscribePush = subscribePush;
  window.unsubscribePush = unsubscribePush;
  window.__webPushReady = true;

  // ── Auto-subscribe on load if notifications already enabled ───
  function _autoSubscribe() {
    if (!S.token || !S.notif?.enabled) return;
    if (Notification.permission === 'granted') {
      subscribePush().catch(() => {});
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(_autoSubscribe, 2000));
  } else {
    setTimeout(_autoSubscribe, 2000);
  }
})();

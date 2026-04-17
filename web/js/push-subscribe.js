/**
 * push-subscribe.js — STUB (VAPID Web Push removed).
 *
 * FCM (Firebase Cloud Messaging) is now the sole push channel.
 * This file is kept as a placeholder to avoid 404 errors if cached.
 * All functions are no-ops.
 *
 * See fcm.js for the actual push registration logic.
 */

/* global S */

(function () {
  'use strict';

  // No-op stubs for backward compatibility
  window.subscribePush = async function () {
    console.log('[WebPush] Disabled — FCM is the sole push channel');
    return false;
  };

  window.unsubscribePush = async function () {
    console.log('[WebPush] Disabled — nothing to unsubscribe');
  };

  window.__webPushReady = false;

  console.log('[WebPush] VAPID Web Push disabled — using FCM only');
})();

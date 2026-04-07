/**
 * push-notifications.js
 * Rich browser push notifications for the messenger app.
 *
 * All notifications are delegated to the Service Worker via postMessage.
 * SW notifications show as heads-up popups on Android PWA;
 * page-originated "new Notification()" does NOT.
 *
 * Exposes `window.showRichNotif(options)` where options = {
 *   senderName   — display name of the sender
 *   senderAvatar — avatar URL (optional, will look in SW cache first)
 *   body         — raw message HTML
 *   chatId       — unique chat identifier (used for tag dedup)
 * }
 *
 * Dependencies:
 *   - Global state `S`  (S.notif.enabled, S.notif.anon, S.notif.sound, S.token)
 *   - Global `playNotifSound()` from utils.js
 */

(function () {
  'use strict';

  // ── Helpers ──────────────────────────────────────────────────────────────

  function replaceSpoilersWithBraille(html) {
    return html.replace(/<spoiler[^>]*>([\s\S]*?)<\/spoiler>/gi, function (match, content) {
      var result = '';
      for (var i = 0; i < content.length; i++) {
        result += String.fromCharCode(0x2800 + Math.floor(Math.random() * 256));
      }
      return result;
    });
  }

  function stripHtml(raw) {
    var text = raw;
    text = text.replace(/<br\s*\/?>/gi, '\n');
    text = text.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, '$1');
    text = text.replace(/<(?:code|b|i|em|strong|span|div|p|ul|ol|li|blockquote|h[1-6])[^>]*>([\s\S]*?)<\/(?:code|b|i|em|strong|span|div|p|ul|ol|li|blockquote|h[1-6])>/gi, '$1');
    text = replaceSpoilersWithBraille(text);
    text = text.replace(/<[^>]+>/g, '');
    var ta = document.createElement('textarea');
    ta.innerHTML = text;
    text = ta.value;
    text = text.replace(/[ \t]+/g, ' ');
    text = text.replace(/\n{3,}/g, '\n\n');
    return text.trim();
  }

  function truncate(text, max) {
    if (text.length <= max) return text;
    return text.slice(0, max - 1) + '\u2026';
  }

  // ── Avatar: canvas → data URL (blob URLs don't work with SW notifications) ──

  function _generateInitialAvatar(name) {
    return new Promise(function (resolve) {
      try {
        var size = 96;
        var canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        var ctx = canvas.getContext('2d');
        var hash = 0;
        var str = (name || 'A').toUpperCase();
        for (var i = 0; i < str.length; i++) {
          hash = str.charCodeAt(i) + ((hash << 5) - hash);
        }
        var hue = Math.abs(hash % 30) + 10;
        var sat = 55 + Math.abs((hash >> 8) % 20);
        var lit = 45 + Math.abs((hash >> 16) % 10);
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
        ctx.closePath();
        ctx.fillStyle = 'hsl(' + hue + ',' + sat + '%,' + lit + '%)';
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold ' + Math.round(size * 0.45) + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(str.charAt(0), size / 2, size / 2 + 1);
        resolve(canvas.toDataURL('image/png'));
      } catch (e) {
        resolve(null);
      }
    });
  }

  function _getAvatarFromCache(avatarUrl) {
    if (!avatarUrl || !navigator.serviceWorker) return Promise.resolve(null);
    return caches.match(avatarUrl).then(function (cached) {
      if (cached && cached.ok) return cached;
      return null;
    }).catch(function () { return null; });
  }

  /**
   * Convert cached response to a cropped circle data-URL.
   */
  function _cropAvatarToDataUrl(response) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () {
        try {
          var size = 96;
          var canvas = document.createElement('canvas');
          canvas.width = size; canvas.height = size;
          var ctx = canvas.getContext('2d');
          ctx.beginPath();
          ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
          ctx.closePath();
          ctx.clip();
          var side = Math.min(img.width, img.height);
          var sx = (img.width - side) / 2;
          var sy = (img.height - side) / 2;
          ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
          resolve(canvas.toDataURL('image/png'));
        } catch (e) { resolve(null); }
      };
      img.onerror = function () { resolve(null); };
      img.src = URL.createObjectURL(response.blob ? response : response);
    });
  }

  function _responseToDataUrl(resp) {
    return resp.blob().then(function (blob) {
      return new Promise(function (resolve) {
        var url = URL.createObjectURL(blob);
        var img = new Image();
        img.onload = function () {
          URL.revokeObjectURL(url);
          try {
            var size = 96;
            var canvas = document.createElement('canvas');
            canvas.width = size; canvas.height = size;
            var ctx = canvas.getContext('2d');
            ctx.beginPath();
            ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
            ctx.closePath();
            ctx.clip();
            var side = Math.min(img.width, img.height);
            var sx = (img.width - side) / 2;
            var sy = (img.height - side) / 2;
            ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
            resolve(canvas.toDataURL('image/png'));
          } catch (e) { resolve(null); }
        };
        img.onerror = function () { URL.revokeObjectURL(url); resolve(null); };
        img.src = url;
      });
    });
  }

  /**
   * Resolve avatar: cache → generate initial.
   * Returns Promise<string|null> — data URL.
   */
  function _resolveAvatar(avatarUrl, senderName) {
    return _getAvatarFromCache(avatarUrl).then(function (cached) {
      if (cached) return _responseToDataUrl(cached);
      return _generateInitialAvatar(senderName || '?');
    });
  }

  // ── SVG icons for action buttons ─────────────────────────────────────────
  var _replyIcon = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>'
  );
  var _checkIcon = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
  );

  // ── Public API ───────────────────────────────────────────────────────────

  window.showRichNotif = function (opts) {
    if (document.hasFocus()) return;

    // Skip if SW already showed a background notification for this chat
    if (window._fcmBgHandled && opts.chatId &&
        window._fcmBgHandled.chatId == opts.chatId &&
        Date.now() - window._fcmBgHandled.ts < 8000) return;

    if (!S.notif.enabled) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    // Play notification sound (from utils.js)
    if (typeof playNotifSound === 'function') playNotifSound();

    var title = S.notif.anon ? 'Инициал' : (opts.senderName || 'Initial');
    var text = truncate(stripHtml(opts.body || ''), 160);
    var tag = 'signal-' + String(opts.chatId || 'msg').replace(/\s+/g, '-');

    // Resolve avatar then delegate to SW
    _resolveAvatar(opts.senderAvatar, opts.senderName).then(function (avatarDataUrl) {
      var notifOpts = {
        body: text,
        tag: tag,
        renotify: true,
        vibrate: [200, 100, 200],
        badge: '/web/icon-192.png',
        data: { chatId: opts.chatId },
      };
      if (avatarDataUrl) notifOpts.icon = avatarDataUrl;

      // Action buttons (Android Chrome)
      try {
        if ('Notification' in window && Notification.maxActions > 0) {
          notifOpts.actions = [
            { action: 'reply',    title: 'Ответить',   icon: _replyIcon },
            { action: 'markread', title: 'Прочитано',  icon: _checkIcon }
          ];
        }
      } catch (_) {}

      // Delegate to SW — SW notifications show as popups on Android PWA
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: 'SHOW_NOTIF',
          title: title,
          options: notifOpts
        });
      } else {
        // Fallback: page notification (no popup on Android)
        try { new Notification(title, notifOpts); } catch (_) {}
      }
    });
  };

  window.syncNotifDataToSW = function() {
    if (!navigator.serviceWorker || !navigator.serviceWorker.controller) return;
    const chatData = (S.chats || []).slice(0, 20).map(function(c) {
      return {
        chat_id: c.chat_id,
        partner_name: c.partner_name || '',
        partner_avatar: c.partner_avatar || null,
        last_message: c.last_message || '',
        last_media_type: c.last_media_type || null
      };
    });
    navigator.serviceWorker.controller.postMessage({
      type: 'SYNC_NOTIF_DATA',
      chats: chatData
    });
  };

})();

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
    // Handle ||spoiler|| syntax — convert to braille before stripping tags
    text = text.replace(/\|\|([^|]+)\|\|/g, function(_, content) {
      var result = '';
      for (var i = 0; i < content.length; i++) {
        result += String.fromCharCode(0x2800 + Math.floor(Math.random() * 256));
      }
      return result;
    });
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
        var str = (name || 'A').toUpperCase();
        // Black circle with white letter
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
        ctx.closePath();
        ctx.fillStyle = '#1e1e1e';
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
      var contentType = (response.headers && response.headers.get) ? (response.headers.get('content-type') || '') : '';
      var isGif = contentType.indexOf('gif') >= 0;
      // For GIF: create an image element that loads first frame
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
      // For GIF: use blob URL (draws first frame on canvas)
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
   * Extract a data-URL from a loaded <img> or <canvas> element found in the DOM.
   * Returns Promise<string|null>.
   */
  function _extractAvatarFromDOM(chatId, senderName) {
    // Find the chat list item for this chat
    var ciEl = document.querySelector('.ci[data-chat-id="' + chatId + '"]');
    if (!ciEl) return _generateInitialAvatar(senderName || '?');

    var avImg = ciEl.querySelector('.av-img');
    if (!avImg) return _generateInitialAvatar(senderName || '?');

    // Check for a loaded <img> inside
    var img = avImg.querySelector('img');
    if (img && img.classList.contains('loaded') && img.naturalWidth > 0) {
      return new Promise(function (resolve) {
        try {
          var size = 96;
          var canvas = document.createElement('canvas');
          canvas.width = size; canvas.height = size;
          var ctx = canvas.getContext('2d');
          ctx.beginPath();
          ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
          ctx.closePath();
          ctx.clip();
          var side = Math.min(img.naturalWidth, img.naturalHeight);
          var sx = (img.naturalWidth - side) / 2;
          var sy = (img.naturalHeight - side) / 2;
          ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
          resolve(canvas.toDataURL('image/png'));
        } catch (e) { resolve(null); }
      }).then(function (url) {
        return url || _generateInitialAvatar(senderName || '?');
      });
    }

    // Check for a <canvas> (used for GIF avatars)
    var cvs = avImg.querySelector('canvas');
    if (cvs && cvs.width > 0 && cvs.height > 0) {
      return new Promise(function (resolve) {
        try {
          var size = 96;
          var out = document.createElement('canvas');
          out.width = size; out.height = size;
          var ctx = out.getContext('2d');
          ctx.beginPath();
          ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
          ctx.closePath();
          ctx.clip();
          var side = Math.min(cvs.width, cvs.height);
          var sx = (cvs.width - side) / 2;
          var sy = (cvs.height - side) / 2;
          ctx.drawImage(cvs, sx, sy, side, side, 0, 0, size, size);
          resolve(out.toDataURL('image/png'));
        } catch (e) { resolve(null); }
      }).then(function (url) {
        return url || _generateInitialAvatar(senderName || '?');
      });
    }

    // No loaded avatar in DOM → generate initial
    return _generateInitialAvatar(senderName || '?');
  }

  /**
   * Resolve avatar: try DOM first, then SW cache, then generate initial.
   * Returns Promise<string|null> — data URL.
   */
  function _resolveAvatar(avatarUrl, senderName, chatId) {
    // Primary: extract from already-loaded DOM elements (most reliable)
    if (chatId) {
      return _extractAvatarFromDOM(chatId, senderName);
    }
    // Fallback for cases without chatId (e.g. search results)
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

  // ── In-app push banner state ──
  var _inappPushTimeout = null;
  var _inappPushChatId = null;

  function _showInappPush(opts) {
    var el = $('inapp-push');
    if (!el) return;

    // Wait for DOM if not ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function() { _showInappPush(opts); });
      return;
    }

    var avEl = $('inapp-push-av');
    var nameEl = $('inapp-push-name');
    var msgEl = $('inapp-push-msg');
    var replyWrap = $('inapp-push-reply-wrap');
    var replyInput = $('inapp-push-reply-input');

    // ── Debounce: if same chat, just update content ──
    var isVisible = el.classList.contains('visible');
    if (isVisible && _inappPushChatId === opts.chatId) {
      // Same chat — update in place without resetting animation
      nameEl.textContent = opts.senderName || 'Initial';
      msgEl.textContent = truncate(stripHtml(opts.body || ''), 80);
      if (avEl && typeof aviHtml === 'function') {
        avEl.innerHTML = aviHtml(opts.senderName || 'Initial', opts.senderAvatar || null);
      }
      // Reset auto-hide timer
      if (_inappPushTimeout) clearTimeout(_inappPushTimeout);
      _inappPushTimeout = setTimeout(function () {
        _hideInappPush();
      }, 6000);
      return;
    }

    // Different chat — hide old, show new after short delay
    if (isVisible) {
      _hideInappPush();
      setTimeout(function() { _showInappPush(opts); }, 300);
      return;
    }

    // Set name
    nameEl.textContent = opts.senderName || 'Initial';
    // Set message body
    msgEl.textContent = truncate(stripHtml(opts.body || ''), 80);
    // Set avatar using aviHtml() for proper URL resolution, shimmer loading, and fallback
    if (avEl) {
      if (typeof aviHtml === 'function') {
        avEl.innerHTML = aviHtml(opts.senderName || 'Initial', opts.senderAvatar || null);
      } else {
        avEl.textContent = (opts.senderName || '?').charAt(0).toUpperCase();
      }
    }

    // Reset reply state
    if (replyWrap) replyWrap.classList.remove('open');
    if (replyInput) replyInput.textContent = '';

    // Store chatId for reply
    _inappPushChatId = opts.chatId;

    // Clear existing timeout
    if (_inappPushTimeout) clearTimeout(_inappPushTimeout);

    // Show
    el.classList.add('visible');

    // Auto-hide after 6 seconds
    _inappPushTimeout = setTimeout(function () {
      _hideInappPush();
    }, 6000);
  }

  function _hideInappPush() {
    var el = $('inapp-push');
    if (!el) return;
    el.classList.remove('visible');
    if (_inappPushTimeout) { clearTimeout(_inappPushTimeout); _inappPushTimeout = null; }
    var replyWrap = $('inapp-push-reply-wrap');
    if (replyWrap) replyWrap.classList.remove('open');
    var replyInput = $('inapp-push-reply-input');
    if (replyInput) replyInput.textContent = '';
    _inappPushChatId = null;
  }

  // Close button
  document.addEventListener('DOMContentLoaded', function () {
    var closeBtn = $('inapp-push-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', function () { _hideInappPush(); });

    // Reply toggle button
    var replyBtn = $('inapp-push-reply-btn');
    if (replyBtn) replyBtn.addEventListener('click', function () {
      var wrap = $('inapp-push-reply-wrap');
      if (!wrap) return;
      wrap.classList.toggle('open');
      if (wrap.classList.contains('open')) {
        var inp = $('inapp-push-reply-input');
        if (inp) inp.focus();
        // Reset auto-hide timer while reply is open
        if (_inappPushTimeout) { clearTimeout(_inappPushTimeout); _inappPushTimeout = null; }
      }
    });

    // Send quick reply
    var sendBtn = $('inapp-push-reply-send');
    if (sendBtn) sendBtn.addEventListener('click', function () { _sendInappReply(); });

    // Enter key to send
    var replyInput = $('inapp-push-reply-input');
    if (replyInput) {
      replyInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          _sendInappReply();
        }
      });
    }

    // Click on push content area to open the chat
    var pushEl = $('inapp-push');
    if (pushEl) {
      pushEl.addEventListener('click', function (e) {
        // Don't trigger if clicking on action buttons or reply field
        if (e.target.closest('.inapp-push-acts') || e.target.closest('.inapp-push-reply-wrap')) return;
        if (_inappPushChatId && typeof openChat === 'function') {
          var c = (S.chats || []).find(function(ch) { return ch.chat_id == _inappPushChatId; });
          if (c) openChat(c);
          _hideInappPush();
        }
      });
    }
  });

  function _sendInappReply() {
    var inp = $('inapp-push-reply-input');
    if (!inp || !inp.textContent.trim()) return;
    var text = inp.textContent.trim();
    if (!_inappPushChatId) return;

    var c = (S.chats || []).find(function(ch) { return ch.chat_id == _inappPushChatId; });
    if (!c) return;

    // Send via API
    var payload = { to_signal_id: c.partner_signal_id, body: text };
    if (typeof api === 'function') {
      api('send_message', 'POST', payload).then(function (res) {
        if (res && res.ok) {
          toast('Отправлено', 'ok');
        } else {
          toast(res && res.message ? res.message : 'Ошибка отправки', 'err');
        }
      }).catch(function () {
        toast('Ошибка отправки', 'err');
      });
    }

    _hideInappPush();
  }

  window.showRichNotif = function (opts) {
    var isTabFocused = document.hasFocus();

    // If tab IS focused: show in-app banner if not in the same chat
    if (isTabFocused) {
      // Only show banner if user is NOT in the chat that received the message
      if (opts.chatId && opts.chatId == S.chatId) return;
      // Check in-app push toggle
      if (S.notif && S.notif.inappPush === false) return;
      _showInappPush(opts);
      // Play sound if enabled
      if (S.notif.sound && typeof playNotifSound === 'function') playNotifSound();
      return;
    }

    // Tab NOT focused: show browser push notification (existing logic)

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

    // Resolve avatar: try DOM first (chatId), then SW cache
    _resolveAvatar(opts.senderAvatar, opts.senderName, opts.chatId).then(function (avatarDataUrl) {
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

    // Convert avatars to data URLs so the SW can use them even without S3 access
    var chats = (S.chats || []).slice(0, 30);
    var promises = chats.map(function(c) {
      return _resolveAvatar(c.partner_avatar, c.partner_name, c.chat_id).then(function(dataUrl) {
        return {
          chat_id: c.chat_id,
          partner_name: c.partner_name || '',
          partner_avatar: c.partner_avatar || null,
          avatar_data_url: dataUrl
        };
      }).catch(function() {
        // Fallback on error — generate initial avatar
        return _generateInitialAvatar(c.partner_name || '?').then(function(dataUrl) {
          return {
            chat_id: c.chat_id,
            partner_name: c.partner_name || '',
            partner_avatar: null,
            avatar_data_url: dataUrl
          };
        });
      });
    });

    Promise.all(promises).then(function(chatData) {
      navigator.serviceWorker.controller.postMessage({
        type: 'SYNC_NOTIF_DATA',
        chats: chatData
      });
    }).catch(function() {});
  };

})();

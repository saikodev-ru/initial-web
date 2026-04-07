/**
 * push-notifications.js
 * Rich browser push notifications for the messenger app.
 *
 * Exposes `window.showRichNotif(options)` where options = {
 *   senderName   — display name of the sender
 *   senderAvatar — avatar URL (optional)
 *   body         — raw message HTML
 *   chatId       — unique chat identifier (used for tag dedup)
 *   onClick      — callback fired when the notification is clicked
 *   onReply      — callback fired when "Reply" action is clicked
 *   onMarkRead   — callback fired when "Mark read" action is clicked
 * }
 *
 * Features:
 *   - Sender avatar as notification icon + large notification image
 *   - Action buttons "Ответить" and "Прочитано" (Android Chrome)
 *   - Automatic mark-as-read via API on "Прочитано" action
 *   - Auto-close after 10 seconds
 *
 * Dependencies:
 *   - Global state `S`  (S.notif.enabled, S.notif.anon, S.notif.sound, S.token)
 *   - Global `playNotifSound()` from utils.js
 *   - Global `api()` from utils.js
 */

(function () {
  'use strict';

  // ── Check if actions are supported (Android Chrome, some desktop) ────
  var _actionsSupported = false;
  try {
    _actionsSupported = 'Notification' in window && Notification.maxActions > 0;
  } catch (e) {}

  // ── SVG icons for action buttons (inline data URIs) ──────────────────
  var _replyIcon = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>'
  );
  var _checkIcon = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
  );

  // ── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Replace the contents of every <spoiler> tag with random Braille characters
   * so the spoiler text is hidden in the notification body.
   */
  function replaceSpoilersWithBraille(html) {
    return html.replace(/<spoiler[^>]*>([\s\S]*?)<\/spoiler>/gi, function (match, content) {
      var result = '';
      for (var i = 0; i < content.length; i++) {
        result += String.fromCharCode(0x2800 + Math.floor(Math.random() * 256));
      }
      return result;
    });
  }

  /**
   * Strip known inline formatting tags but keep their text content,
   * then remove any remaining HTML tags entirely.
   */
  function stripHtml(raw) {
    var text = raw;

    // Convert <br> to newlines first
    text = text.replace(/<br\s*\/?>/gi, '\n');

    // Handle <pre> blocks — preserve inner text
    text = text.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, '$1');

    // Remove inline formatting tags but keep contents
    text = text.replace(/<(?:code|b|i|em|strong|span|div|p|ul|ol|li|blockquote|h[1-6])[^>]*>([\s\S]*?)<\/(?:code|b|i|em|strong|span|div|p|ul|ol|li|blockquote|h[1-6])>/gi, '$1');

    // Replace spoilers with braille (must run before the generic strip below)
    text = replaceSpoilersWithBraille(text);

    // Strip every remaining HTML tag
    text = text.replace(/<[^>]+>/g, '');

    // Decode HTML entities (&amp; &lt; &gt; &quot; &#39; etc.)
    var ta = document.createElement('textarea');
    ta.innerHTML = text;
    text = ta.value;

    // Collapse excessive whitespace (but keep intentional newlines)
    text = text.replace(/[ \t]+/g, ' ');
    text = text.replace(/\n{3,}/g, '\n\n');

    return text.trim();
  }

  /**
   * Truncate text to approximately `max` characters, appending an ellipsis.
   */
  function truncate(text, max) {
    if (text.length <= max) return text;
    return text.slice(0, max - 1) + '\u2026'; // '…'
  }

  /**
   * Convert a blob to a cropped circle avatar PNG (96x96) via canvas.
   * Falls back to blob URL if canvas fails.
   */
  function _cropAvatarToBlob(blob) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        try {
          var size = 96;
          var canvas = document.createElement('canvas');
          canvas.width = size;
          canvas.height = size;
          var ctx = canvas.getContext('2d');
          // Circle crop
          ctx.beginPath();
          ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
          ctx.closePath();
          ctx.clip();
          // Draw image centered and covering
          var side = Math.min(img.width, img.height);
          var sx = (img.width - side) / 2;
          var sy = (img.height - side) / 2;
          ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
          canvas.toBlob(function (cropped) {
            if (cropped) resolve(URL.createObjectURL(cropped));
            else resolve(URL.createObjectURL(blob));
          }, 'image/png');
        } catch (e) {
          // Canvas not available — use original
          resolve(URL.createObjectURL(blob));
        }
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        resolve(URL.createObjectURL(blob));
      };
      img.src = url;
    });
  }

  /**
   * Create and display the actual Notification object.
   */
  function _sendNotif(title, body, tag, icon, largeIcon, chatId, onClick, onReply, onMarkRead) {
    try {
      var opts = {
        body: body,
        tag: tag,
        renotify: true,
        silent: false
      };

      // App icon (small icon in top-left corner)
      if (icon) {
        opts.icon = icon;
      }

      // Sender avatar (large image on the right side of notification)
      if (largeIcon) {
        opts.image = largeIcon;
      }

      // Action buttons (Android Chrome, some desktop browsers)
      if (_actionsSupported) {
        opts.actions = [
          { action: 'reply', title: 'Ответить', icon: _replyIcon },
          { action: 'markread', title: 'Прочитано', icon: _checkIcon }
        ];
        // Vibrate pattern on Android
        if ('vibrate' in Notification.prototype) {
          opts.vibrate = [200, 100, 200];
        }
      }

      var n = new Notification(title, opts);

      // Default click — open the chat
      n.onclick = function () {
        window.focus();
        if (typeof onClick === 'function') {
          onClick();
        }
        n.close();
      };

      // Action button handlers
      n.onclose = function () {};

      // Use addEventListener for 'action' if supported, fallback to onreply/onmarkread
      if (n.addEventListener) {
        n.addEventListener('action', function (event) {
          window.focus();

          if (event.action === 'reply') {
            if (typeof onReply === 'function') {
              onReply();
            } else if (typeof onClick === 'function') {
              onClick();
            }
          } else if (event.action === 'markread') {
            // Mark messages as read via API
            if (chatId && typeof api === 'function') {
              api('get_messages?chat_id=' + chatId + '&mark_read=1&skip_chats=1')
                .catch(function () {});
            }
            if (typeof onMarkRead === 'function') {
              onMarkRead();
            }
            // Reload chat list to clear unread badge
            if (typeof loadChats === 'function') {
              loadChats().catch(function () {});
            }
          }

          n.close();
        });
      }

      // Auto-close after 10 seconds
      setTimeout(function () {
        try { n.close(); } catch (e) {}
      }, 10000);

    } catch (e) {
      // Silently fail — Notification API may throw in certain environments
    }
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Show a rich push notification for an incoming message.
   *
   * @param {Object} opts
   * @param {string} opts.senderName   - Display name of the sender.
   * @param {string} [opts.senderAvatar] - Avatar image URL.
   * @param {string} opts.body         - Raw message HTML.
   * @param {string|number} opts.chatId - Unique chat identifier.
   * @param {Function} [opts.onClick]    - Callback on notification click.
   * @param {Function} [opts.onReply]    - Callback on "Reply" action click.
   * @param {Function} [opts.onMarkRead] - Callback on "Mark read" action click.
   */
  window.showRichNotif = function (opts) {
    // Don't show if the tab is already focused
    if (document.hasFocus()) return;

    // Respect user notification preferences
    if (!S.notif.enabled) return;

    // Check browser support and permission
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    // Play notification sound (from utils.js)
    if (typeof playNotifSound === 'function') {
      playNotifSound();
    }

    // Build notification title (respect anonymous mode)
    var title = S.notif.anon ? 'Инициал' : (opts.senderName || 'Initial');

    // Process message body
    var text = stripHtml(opts.body || '');
    text = truncate(text, 160);

    // Build a unique tag per chat to prevent duplicate notifications
    var tag = 'signal-' + String(opts.chatId || 'msg').replace(/\s+/g, '-');

    // Default click handler: open the specific chat
    var defaultOnClick = opts.onClick || function () {
      if (opts.chatId) {
        var chat = (S.chats || []).find(function (c) { return c.chat_id === opts.chatId; });
        if (chat && S.chatId !== opts.chatId) {
          if (typeof openChat === 'function') openChat(chat);
        }
      }
    };

    // Reply action: open chat + focus input
    var defaultOnReply = opts.onReply || function () {
      if (opts.chatId) {
        var chat = (S.chats || []).find(function (c) { return c.chat_id === opts.chatId; });
        if (chat && S.chatId !== opts.chatId) {
          if (typeof openChat === 'function') openChat(chat);
        }
      }
      // Focus message input after a short delay to let the chat render
      setTimeout(function () {
        var mfield = document.getElementById('mfield') || document.querySelector('.mfield');
        if (mfield) mfield.focus();
      }, 500);
    };

    // Attempt to load the sender's avatar
    if (opts.senderAvatar) {
      fetch(opts.senderAvatar)
        .then(function (r) {
          if (!r.ok) throw new Error('Avatar fetch failed');
          return r.blob();
        })
        .then(function (blob) {
          // Crop avatar to circle and create blob URLs
          _cropAvatarToBlob(blob).then(function (avatarUrl) {
            var iconUrl = URL.createObjectURL(blob);
            _sendNotif(title, text, tag, iconUrl, avatarUrl, opts.chatId, defaultOnClick, defaultOnReply, opts.onMarkRead);
            // Revoke blob URLs after the notification is created
            setTimeout(function () {
              URL.revokeObjectURL(iconUrl);
              URL.revokeObjectURL(avatarUrl);
            }, 15000);
          });
        })
        .catch(function () {
          // Fallback: show without avatar
          _sendNotif(title, text, tag, null, null, opts.chatId, defaultOnClick, defaultOnReply, opts.onMarkRead);
        });
    } else {
      // No avatar available — show without icon/image
      _sendNotif(title, text, tag, null, null, opts.chatId, defaultOnClick, defaultOnReply, opts.onMarkRead);
    }
  };

})();

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
 * }
 *
 * Dependencies:
 *   - Global state `S`  (S.notif.enabled, S.notif.anon, S.notif.sound)
 *   - Global `playNotifSound()` from utils.js
 */

(function () {
  'use strict';

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
   * Create and display the actual Notification object.
   */
  function _sendNotif(title, body, tag, icon, onClick) {
    try {
      var opts = {
        body: body,
        tag: tag,
        renotify: true,
        silent: false
      };

      if (icon) {
        opts.icon = icon;
      }

      var n = new Notification(title, opts);

      // Focus window and fire callback on click
      n.onclick = function () {
        window.focus();
        if (typeof onClick === 'function') {
          onClick();
        }
        n.close();
      };

      // Auto-close after 8 seconds
      setTimeout(function () {
        n.close();
      }, 8000);

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
   * @param {string} opts.chatId       - Unique chat identifier.
   * @param {Function} [opts.onClick]  - Callback on notification click.
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
    text = truncate(text, 120);

    // Build a unique tag per chat to prevent duplicate notifications
    var tag = 'signal-' + (opts.chatId || 'msg').replace(/\s+/g, '-');

    // Attempt to load the sender's avatar as the notification icon
    if (opts.senderAvatar) {
      fetch(opts.senderAvatar)
        .then(function (r) {
          if (!r.ok) throw new Error('Avatar fetch failed');
          return r.blob();
        })
        .then(function (blob) {
          var iconUrl = URL.createObjectURL(blob);
          _sendNotif(title, text, tag, iconUrl, opts.onClick);
          // Revoke the blob URL after the notification is created
          // (keep alive long enough for the OS to pick it up)
          setTimeout(function () {
            URL.revokeObjectURL(iconUrl);
          }, 10000);
        })
        .catch(function () {
          // Fallback: show without avatar icon
          _sendNotif(title, text, tag, null, opts.onClick);
        });
    } else {
      // No avatar available — show without icon
      _sendNotif(title, text, tag, null, opts.onClick);
    }
  };

})();

/* ═══════════════════════════════════════════════════════════════
   FIREBASE MESSAGING SERVICE WORKER — Initial.
   Standalone SW required by Firebase SDK for FCM push delivery.
   Handles background push notifications (avatar, queue, click).
   ═══════════════════════════════════════════════════════════════ */

// ── Firebase Messaging SDK ──
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

// ── Firebase initialization ──
var FIREBASE_CONFIG = {
  apiKey:            'AIzaSyCA8vZ1d9VLDvmhQ_4DbER8WjjZ8jO9Thw',
  authDomain:        'initial-messenger.firebaseapp.com',
  projectId:         'initial-messenger',
  storageBucket:     'initial-messenger.firebasestorage.app',
  messagingSenderId: '738215038267',
  appId:             '1:738215038267:web:1cab851d6e98dd2730bb1e',
};

firebase.initializeApp(FIREBASE_CONFIG);
var _fcmMessaging = firebase.messaging();

// ── Activate immediately — Firebase needs an active SW for push subscribe ──
self.addEventListener('install', function() { self.skipWaiting(); });
self.addEventListener('activate', function(e) { e.waitUntil(self.clients.claim()); });

// ── Base path: when the app lives in a subdirectory (e.g. /web/) ──
// self.location = …/web/firebase-messaging-sw.js  →  BASE = /web
var _BASE = self.location.pathname.replace(/\/firebase-messaging-sw\.js$/, '') || '';

/* ═══════════════════════════════════════════════════════════════
   Avatar data-URL cache — populated by the page via SYNC_NOTIF_DATA.
   Stored in IndexedDB so it survives SW restarts between pushes.
   ═══════════════════════════════════════════════════════════════ */

var _IDB_NAME    = 'initial-notif-cache';
var _IDB_STORE   = 'avatars';
var _IDB_VERSION = 1;

function _idbOpen() {
  return new Promise(function(resolve, reject) {
    var req = indexedDB.open(_IDB_NAME, _IDB_VERSION);
    req.onupgradeneeded = function(e) { e.target.result.createObjectStore(_IDB_STORE); };
    req.onsuccess  = function(e) { resolve(e.target.result); };
    req.onerror    = function(e) { reject(e.target.error); };
  });
}

function _idbSaveAvatars(map) {
  return _idbOpen().then(function(db) {
    var tx = db.transaction(_IDB_STORE, 'readwrite');
    var st = tx.objectStore(_IDB_STORE);
    var keys = Object.keys(map);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      if (key && map[key]) st.put(map[key], key);
    }
    return new Promise(function(res, rej) { tx.oncomplete = res; tx.onerror = rej; }).then(function() { db.close(); });
  }).catch(function() {});
}

function _idbLoadAvatars() {
  return _idbOpen().then(function(db) {
    var tx = db.transaction(_IDB_STORE, 'readonly');
    var st = tx.objectStore(_IDB_STORE);
    return new Promise(function(res, rej) {
      var result = {};
      var req = st.openCursor();
      req.onsuccess = function(e) {
        var cursor = e.target.result;
        if (cursor) { result[cursor.key] = cursor.value; cursor.continue(); }
        else { db.close(); res(result); }
      };
      req.onerror = function() { db.close(); rej(); };
    });
  }).catch(function() { return {}; });
}

// In-memory mirror of IDB (populated on first background message)
var _avatarCache    = null; // null = not loaded yet
var _avatarCacheInited = false;

function _ensureAvatarCache() {
  if (_avatarCacheInited) return Promise.resolve();
  _avatarCacheInited = true;
  return _idbLoadAvatars().then(function(all) {
    _avatarCache = all;
  });
}

// ── Message handler: receive SYNC_NOTIF_DATA from the page ──
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SYNC_NOTIF_DATA') {
    var chats = event.data.chats || [];
    var updates = {};
    for (var i = 0; i < chats.length; i++) {
      var c = chats[i];
      var key = 'chat:' + c.chat_id;
      if (c.avatar_data_url) updates[key] = c.avatar_data_url;
    }
    if (!_avatarCache) _avatarCache = {};
    var ukeys = Object.keys(updates);
    for (var j = 0; j < ukeys.length; j++) {
      _avatarCache[ukeys[j]] = updates[ukeys[j]];
    }
    _avatarCacheInited = true;
    _idbSaveAvatars(updates);
  }
});

/* ═══════════════════════════════════════════════════════════════
   Body formatting — strip HTML, convert spoilers to Braille
   (no DOM in SW, so pure regex)
   ═══════════════════════════════════════════════════════════════ */

function _swFormatBody(raw) {
  if (!raw) return '';
  var text = raw;

  // ||spoiler|| syntax → braille
  text = text.replace(/\|\|([^|]+)\|\|/g, function(_, content) {
    var result = '';
    for (var i = 0; i < content.length; i++) {
      result += String.fromCharCode(0x2800 + Math.floor(Math.random() * 256));
    }
    return result;
  });

  // <spoiler> tags → braille
  text = text.replace(/<spoiler[^>]*>([\s\S]*?)<\/spoiler>/gi, function(_, content) {
    var result = '';
    for (var i = 0; i < content.length; i++) {
      result += String.fromCharCode(0x2800 + Math.floor(Math.random() * 256));
    }
    return result;
  });

  // Preserve line breaks
  text = text.replace(/<br\s*\/?>/gi, '\n');
  // Strip remaining tags
  text = text.replace(/<[^>]+>/g, '');
  // Decode common HTML entities
  text = text
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
  // Normalize whitespace
  text = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return text;
}

// ── FCM Background Message Handler ────────────────────────────
_fcmMessaging.onBackgroundMessage(function(payload) {
  var data = payload.data || {};

  // Forward to open tabs (foreground handling)
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clients) {

    // Check if any tab is actually visible
    var hasVisible = false;
    for (var i = 0; i < clients.length; i++) {
      if (clients[i].visibilityState === 'visible') { hasVisible = true; break; }
    }

    for (var j = 0; j < clients.length; j++) {
      var client = clients[j];
      if (data.action === 'incoming_call') {
        client.postMessage({ type: 'FCM_CALL', payload: data });
      } else {
        // Tell the page whether the SW already showed a notification
        client.postMessage({ type: 'FCM_MSG', payload: data, swHandled: !hasVisible });
      }
    }

    // Skip notification for incoming calls (handled by foreground)
    if (data.action === 'incoming_call') return;

    // If a visible tab exists → skip notification (the page will handle sound + UI).
    // SW notifications show as popups on Android only when NO tab is visible.
    if (hasVisible) return;

    var title  = data.sender_name || 'Initial.';
    var body   = _swFormatBody(data.body || 'Новое сообщение').slice(0, 160) || 'Новое сообщение';
    var chatId = data.chat_id || null;

    // Resolve avatar: data-URL cache synced from page (S3 not directly accessible)
    return _ensureAvatarCache().then(function() {
      var iconUrl = _BASE + '/icon-192.png';
      var _cacheKey = chatId ? 'chat:' + chatId : null;
      if (_cacheKey && _avatarCache && _avatarCache[_cacheKey] &&
          (_avatarCache[_cacheKey].indexOf('data:') === 0 || _avatarCache[_cacheKey].indexOf('http') === 0)) {
        iconUrl = _avatarCache[_cacheKey];
      } else {
        try { iconUrl = _swGenerateInitialAvatar(data.sender_name || title); } catch(_) {}
      }

      return _queuedNotification(chatId, title, body, iconUrl, { chatId: chatId });
    }).catch(function(err) {
      console.error('[SW] Background message error:', err);
    });
  });
});

/* ═══════════════════════════════════════════════════════════════
   Avatar generation — minimal PNG without DOM/canvas
   ═══════════════════════════════════════════════════════════════ */

function _swGenerateInitialAvatar(name) {
  var size = 96;
  var str = (name || 'A').toUpperCase();
  var letter = str.charAt(0);

  // Black circle background with white letter
  var bgR = 30, bgG = 30, bgB = 30; // dark circle
  var fgR = 255, fgG = 255, fgB = 255; // white letter

  // Build raw RGBA pixels
  var pixels = new Uint8ClampedArray(size * size * 4);
  var cx = size / 2, cy = size / 2, rad = size / 2 - 1;
  for (var y = 0; y < size; y++) {
    for (var x = 0; x < size; x++) {
      var idx = (y * size + x) * 4;
      var dx = x - cx, dy = y - cy;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= rad) {
        pixels[idx] = bgR; pixels[idx+1] = bgG; pixels[idx+2] = bgB; pixels[idx+3] = 255;
      } else if (dist <= rad + 1) {
        var alpha = Math.max(0, (rad + 1 - dist));
        pixels[idx] = bgR; pixels[idx+1] = bgG; pixels[idx+2] = bgB; pixels[idx+3] = Math.round(alpha * 255);
      }
    }
  }

  // Stamp a simple 5×7 bitmap letter in the centre
  var glyph = _swLetterBitmap(letter);
  var gw = glyph[0].length, gh = glyph.length;
  var scale = Math.max(1, Math.floor(size * 0.42 / gh));
  var ox = Math.floor((size - gw * scale) / 2);
  var oy = Math.floor((size - gh * scale) / 2);
  for (var gy = 0; gy < gh; gy++) {
    for (var gx = 0; gx < gw; gx++) {
      if (!glyph[gy][gx]) continue;
      for (var sy = 0; sy < scale; sy++) {
        for (var sx = 0; sx < scale; sx++) {
          var px = ox + gx * scale + sx;
          var py = oy + gy * scale + sy;
          if (px >= 0 && px < size && py >= 0 && py < size) {
            var pidx = (py * size + px) * 4;
            // Check if pixel is inside the circle
            var ddx = px - cx, ddy = py - cy;
            if (Math.sqrt(ddx * ddx + ddy * ddy) <= rad) {
              pixels[pidx] = fgR; pixels[pidx+1] = fgG; pixels[pidx+2] = fgB; pixels[pidx+3] = 255;
            }
          }
        }
      }
    }
  }

  var png = _swEncodePNG(size, size, pixels);
  // Convert to data URL (blob URLs don't work in SW notifications)
  var base64 = '';
  var chunk = 8192;
  for (var i = 0; i < png.length; i += chunk) {
    base64 += String.fromCharCode.apply(null, png.subarray(i, Math.min(i + chunk, png.length)));
  }
  return 'data:image/png;base64,' + btoa(base64);
}

function _swEncodePNG(width, height, rgba) {
  var sig = new Uint8Array([137,80,78,71,13,10,26,10]);
  var ihdrData = new Uint8Array(13);
  new DataView(ihdrData.buffer).setUint32(0, width);
  new DataView(ihdrData.buffer).setUint32(4, height);
  ihdrData[8]=8; ihdrData[9]=6; ihdrData[10]=0; ihdrData[11]=0; ihdrData[12]=0;
  var ihdr = _pngChunk('IHDR', ihdrData);
  var rawData = new Uint8Array(height * (1 + width * 4));
  for (var y = 0; y < height; y++) {
    rawData[y * (1 + width * 4)] = 0;
    rawData.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (1 + width * 4) + 1);
  }
  var deflated = _zlibDeflateRaw(rawData);
  var idat = _pngChunk('IDAT', deflated);
  var iend = _pngChunk('IEND', new Uint8Array(0));
  var total = sig.length + ihdr.length + idat.length + iend.length;
  var result = new Uint8Array(total);
  var off = 0;
  result.set(sig, off); off += sig.length;
  result.set(ihdr, off); off += ihdr.length;
  result.set(idat, off); off += idat.length;
  result.set(iend, off);
  return result;
}

function _pngChunk(type, data) {
  var len = data.length;
  var chunk = new Uint8Array(12 + len);
  var dv = new DataView(chunk.buffer);
  dv.setUint32(0, len);
  for (var i = 0; i < 4; i++) chunk[4 + i] = type.charCodeAt(i);
  chunk.set(data, 8);
  var crc = _crc32(chunk.subarray(4, 8 + len));
  dv.setUint32(8 + len, crc);
  return chunk;
}

function _adler32(data) {
  var a = 1, b = 0;
  for (var i = 0; i < data.length; i++) { a = (a + data[i]) % 65521; b = (b + a) % 65521; }
  return (b << 16) | a;
}

var _crcTable = (function() {
  var t = new Uint32Array(256);
  for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c; }
  return t;
})();

/* ═══ Minimal bitmap font — 5×7 pixels per letter ═══ */
var _SW_FONT = {
  'A':[[0,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,1,1,1,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1]],
  'B':[[1,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,1,1,1,0]],
  'C':[[0,1,1,1,0],[1,0,0,0,1],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,1],[0,1,1,1,0]],
  'D':[[1,1,1,0,0],[1,0,0,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,1,0],[1,1,1,0,0]],
  'E':[[1,1,1,1,1],[1,0,0,0,0],[1,0,0,0,0],[1,1,1,1,0],[1,0,0,0,0],[1,0,0,0,0],[1,1,1,1,1]],
  'F':[[1,1,1,1,1],[1,0,0,0,0],[1,0,0,0,0],[1,1,1,1,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0]],
  'G':[[0,1,1,1,0],[1,0,0,0,1],[1,0,0,0,0],[1,0,1,1,1],[1,0,0,0,1],[1,0,0,0,1],[0,1,1,1,0]],
  'H':[[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,1,1,1,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1]],
  'I':[[1,1,1,1,1],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[1,1,1,1,1]],
  'J':[[0,1,1,1,1],[0,0,0,0,1],[0,0,0,0,1],[0,0,0,0,1],[0,0,0,0,1],[1,0,0,0,1],[0,1,1,1,0]],
  'K':[[1,0,0,0,1],[1,0,0,1,0],[1,0,1,0,0],[1,1,0,0,0],[1,0,1,0,0],[1,0,0,1,0],[1,0,0,0,1]],
  'L':[[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,1,1,1,1]],
  'M':[[1,0,0,0,1],[1,1,0,1,1],[1,0,1,0,1],[1,0,1,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1]],
  'N':[[1,0,0,0,1],[1,1,0,0,1],[1,0,1,0,1],[1,0,0,1,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1]],
  'O':[[0,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[0,1,1,1,0]],
  'P':[[1,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,1,1,1,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0]],
  'Q':[[0,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,1,0,1],[1,0,0,1,0],[0,1,1,0,1]],
  'R':[[1,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,1,1,1,0],[1,0,1,0,0],[1,0,0,1,0],[1,0,0,0,1]],
  'S':[[0,1,1,1,1],[1,0,0,0,0],[1,0,0,0,0],[0,1,1,1,0],[0,0,0,0,1],[0,0,0,0,1],[1,1,1,1,0]],
  'T':[[1,1,1,1,1],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0]],
  'U':[[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[0,1,1,1,0]],
  'V':[[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[0,1,0,1,0],[0,1,0,1,0],[0,1,0,1,0],[0,0,1,0,0]],
  'W':[[1,0,0,0,1],[1,0,0,0,1],[1,0,1,0,1],[1,0,1,0,1],[1,1,0,1,1],[1,0,0,0,1],[1,0,0,0,1]],
  'X':[[1,0,0,0,1],[1,0,0,0,1],[0,1,0,1,0],[0,0,1,0,0],[0,1,0,1,0],[1,0,0,0,1],[1,0,0,0,1]],
  'Y':[[1,0,0,0,1],[1,0,0,0,1],[0,1,0,1,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0]],
  'Z':[[1,1,1,1,1],[0,0,0,0,1],[0,0,0,1,0],[0,0,1,0,0],[0,1,0,0,0],[1,0,0,0,0],[1,1,1,1,1]],
  '0':[[0,1,1,1,0],[1,0,0,0,1],[1,0,0,1,1],[1,0,1,0,1],[1,1,0,0,1],[1,0,0,0,1],[0,1,1,1,0]],
  '1':[[0,0,1,0,0],[0,1,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,1,1,1,0]],
  '2':[[0,1,1,1,0],[1,0,0,0,1],[0,0,0,0,1],[0,0,1,1,0],[0,1,0,0,0],[1,0,0,0,0],[1,1,1,1,1]],
  '3':[[1,1,1,1,0],[0,0,0,0,1],[0,0,0,0,1],[0,1,1,1,0],[0,0,0,0,1],[0,0,0,0,1],[1,1,1,1,0]],
  '4':[[1,0,0,1,0],[1,0,0,1,0],[1,0,0,1,0],[1,1,1,1,1],[0,0,0,1,0],[0,0,0,1,0],[0,0,0,1,0]],
  '5':[[1,1,1,1,1],[1,0,0,0,0],[1,1,1,1,0],[0,0,0,0,1],[0,0,0,0,1],[1,0,0,0,1],[0,1,1,1,0]],
  '6':[[0,1,1,1,0],[1,0,0,0,0],[1,0,0,0,0],[1,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[0,1,1,1,0]],
  '7':[[1,1,1,1,1],[0,0,0,0,1],[0,0,0,1,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0]],
  '8':[[0,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[0,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[0,1,1,1,0]],
  '9':[[0,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[0,1,1,1,1],[0,0,0,0,1],[0,0,0,0,1],[0,1,1,1,0]],
};

function _swLetterBitmap(ch) {
  return _SW_FONT[ch] || _SW_FONT['A'];
}

function _crc32(data) {
  var crc = 0xFFFFFFFF;
  for (var i = 0; i < data.length; i++) crc = _crcTable[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function _zlibDeflateRaw(data) {
  var header = new Uint8Array([0x78, 0x01]);
  var maxBlock = 65535;
  var blocks = [];
  for (var off = 0; off < data.length; off += maxBlock) {
    var end = Math.min(off + maxBlock, data.length);
    var len = end - off;
    var isLast = end >= data.length;
    var bh = new Uint8Array(5);
    bh[0] = isLast ? 0x01 : 0x00;
    bh[1] = len & 0xFF; bh[2] = (len >> 8) & 0xFF;
    bh[3] = (~len & 0xFF); bh[4] = ((~len >> 8) & 0xFF);
    blocks.push(bh, data.subarray(off, end));
  }
  var cs = _adler32(data);
  var trailer = new Uint8Array(4);
  new DataView(trailer.buffer).setUint32(0, cs);
  var total = 2;
  for (var i = 0; i < blocks.length; i++) total += blocks[i].length;
  total += 4;
  var result = new Uint8Array(total);
  var o = 0;
  result.set(header, o); o += 2;
  for (var j = 0; j < blocks.length; j++) { result.set(blocks[j], o); o += blocks[j].length; }
  result.set(trailer, o);
  return result;
}

/* ═══════════════════════════════════════════════════════════════
   Notification queue — debounce to avoid Chrome rate-limiting
   ═══════════════════════════════════════════════════════════════ */

var _notifQueue = [];
var _notifProcessing = false;

function _queuedNotification(chatId, title, body, iconUrl, data) {
  var tag = chatId ? 'signal-' + chatId : 'signal-msg';
  var existing = -1;
  for (var i = 0; i < _notifQueue.length; i++) {
    if (_notifQueue[i].tag === tag) { existing = i; break; }
  }
  if (existing >= 0) {
    _notifQueue[existing].title     = title;
    _notifQueue[existing].body      = body;
    _notifQueue[existing].iconUrl   = iconUrl;
    _notifQueue[existing].data      = data;
    _notifQueue[existing].updatedAt = Date.now();
    return;
  }
  _notifQueue.push({ tag: tag, title: title, body: body, iconUrl: iconUrl, data: data, updatedAt: Date.now() });
  if (!_notifProcessing) {
    _notifProcessing = true;
    _processNotifQueue();
  }
}

function _processNotifQueue() {
  if (_notifQueue.length === 0) {
    _notifProcessing = false;
    return;
  }
  var notif = _notifQueue.shift();
  var notifOpts = {
    body:     notif.body,
    icon:     notif.iconUrl,
    tag:      notif.tag,
    renotify: true,
    data:     notif.data,
    vibrate:  [200, 100, 200],
    badge:    _BASE + '/icon-192.png',
  };
  if ('Notification' in self && self.Notification.maxActions > 0) {
    notifOpts.actions = [
      { action: 'reply',    title: 'Ответить'  },
      { action: 'markread', title: 'Прочитано' }
    ];
  }

  // Show notification with error handling — don't break the queue on failure
  var showPromise = self.registration.showNotification(notif.title, notifOpts)
    .then(function() {
      // Success — continue queue after debounce delay
      if (_notifQueue.length > 0) {
        return new Promise(function(r) { setTimeout(r, 1100); }).then(function() {
          _processNotifQueue();
        });
      } else {
        _notifProcessing = false;
      }
    })
    .catch(function(err) {
      console.error('[SW] showNotification error:', err);
      // Continue processing remaining notifications even on error
      if (_notifQueue.length > 0) {
        return new Promise(function(r) { setTimeout(r, 1100); }).then(function() {
          _processNotifQueue();
        });
      } else {
        _notifProcessing = false;
      }
    });
}

/* ═══════════════════════════════════════════════════════════════
   Notification click handler
   ═══════════════════════════════════════════════════════════════ */

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  var action = event.action;
  var chatId = (event.notification.data && event.notification.data.chatId) || null;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clients) {
      var targetClient = null;
      var focusPromises = [];

      for (var i = 0; i < clients.length; i++) {
        var client = clients[i];
        if ('focus' in client) {
          targetClient = client;
          focusPromises.push(client.focus());
          break;
        }
      }

      return Promise.all(focusPromises).then(function() {
        if (!targetClient && self.clients.openWindow) {
          return self.clients.openWindow(_BASE + '/').then(function(win) {
            targetClient = win;
          });
        }
      }).then(function() {
        if (targetClient) {
          targetClient.postMessage({
            type:   'NOTIF_ACTION',
            action: action || 'open',
            chatId: chatId
          });
        }
      });
    })
  );
});

/* ═══════════════════════════════════════════════════════════════
   FIREBASE MESSAGING SERVICE WORKER — Initial.
   Standalone SW required by Firebase SDK for FCM push delivery.
   Handles background push notifications (avatar, queue, click).
   ═══════════════════════════════════════════════════════════════ */

// ── Firebase Messaging SDK ──
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

// ── Firebase initialization ──
const FIREBASE_CONFIG = {
  apiKey:            'AIzaSyCA8vZ1d9VLDvmhQ_4DbER8WjjZ8jO9Thw',
  authDomain:        'initial-messenger.firebaseapp.com',
  projectId:         'initial-messenger',
  storageBucket:     'initial-messenger.firebasestorage.app',
  messagingSenderId: '738215038267',
  appId:             '1:738215038267:web:1cab851d6e98dd2730bb1e',
};

firebase.initializeApp(FIREBASE_CONFIG);
const _fcmMessaging = firebase.messaging();

// ── Activate immediately — Firebase needs an active SW for push subscribe ──
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// ── Base path: when the app lives in a subdirectory (e.g. /web/) ──
// self.location = …/web/firebase-messaging-sw.js  →  BASE = /web
const _BASE = self.location.pathname.replace(/\/firebase-messaging-sw\.js$/, '') || '';

// ── FCM Background Message Handler ────────────────────────────
_fcmMessaging.onBackgroundMessage(async (payload) => {
  const data = payload.data || {};

  // Forward to open tabs (foreground handling if any tab is visible)
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  clients.forEach(client => {
    if (data.action === 'incoming_call') {
      client.postMessage({ type: 'FCM_CALL', payload: data });
    } else {
      client.postMessage({ type: 'FCM_MSG', payload: data });
    }
  });

  // Skip notification for incoming calls (handled by foreground)
  if (data.action === 'incoming_call') return;

  const title  = data.sender_name || 'Initial.';
  const body   = (data.body || 'Новое сообщение').slice(0, 160);
  const chatId = data.chat_id || null;

  // Resolve avatar: try SW cache → fetch from network → generate initial letter
  let iconUrl = _BASE + '/icon-192.png';
  if (data.sender_avatar) {
    try {
      // 1. Try all SW caches
      const cached = await caches.match(data.sender_avatar);
      if (cached && cached.ok) {
        const blob = await cached.blob();
        iconUrl = URL.createObjectURL(blob);
      } else {
        // 2. Fetch from network
        try {
          const resp = await fetch(data.sender_avatar);
          if (resp && resp.ok) {
            const blob = await resp.blob();
            if (blob && blob.size > 0 && blob.type.startsWith('image/')) {
              iconUrl = URL.createObjectURL(blob);
            } else {
              iconUrl = await _swGenerateInitialAvatar(data.sender_name || title);
            }
          } else {
            iconUrl = await _swGenerateInitialAvatar(data.sender_name || title);
          }
        } catch(fetchErr) {
          // 3. Network failed → generate initial letter
          iconUrl = await _swGenerateInitialAvatar(data.sender_name || title);
        }
      }
    } catch(e) {
      iconUrl = await _swGenerateInitialAvatar(data.sender_name || title).catch(() => _BASE + '/icon-192.png');
    }
  }

  return _queuedNotification(chatId, title, body, iconUrl, { chatId });
});

/* ═══════════════════════════════════════════════════════════════
   Avatar generation — minimal PNG without DOM/canvas
   ═══════════════════════════════════════════════════════════════ */

async function _swGenerateInitialAvatar(name) {
  const size = 96;
  const str = (name || 'A').toUpperCase();
  const letter = str.charAt(0);

  // Deterministic colour from name hash
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash % 30) + 10;
  const sat = 55 + Math.abs((hash >> 8) % 20);
  const lit = 45 + Math.abs((hash >> 16) % 10);

  // HSL → RGB
  const h = hue / 360, s = sat / 100, l = lit / 100;
  const a2 = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h * 12) % 12;
    return l - a2 * Math.max(Math.min(k - 3, 9 - k, 1), -1);
  };
  const r = Math.round(f(0) * 255);
  const g = Math.round(f(8) * 255);
  const b = Math.round(f(4) * 255);

  // Build raw RGBA pixels
  const pixels = new Uint8ClampedArray(size * size * 4);
  const cx = size / 2, cy = size / 2, rad = size / 2 - 1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const dx = x - cx, dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= rad) {
        pixels[idx] = r; pixels[idx+1] = g; pixels[idx+2] = b; pixels[idx+3] = 255;
      } else if (dist <= rad + 1) {
        const alpha = Math.max(0, (rad + 1 - dist));
        pixels[idx] = r; pixels[idx+1] = g; pixels[idx+2] = b; pixels[idx+3] = Math.round(alpha * 255);
      }
    }
  }

  const png = _swEncodePNG(size, size, pixels);
  return URL.createObjectURL(new Blob([png], { type: 'image/png' }));
}

function _swEncodePNG(width, height, rgba) {
  const sig = new Uint8Array([137,80,78,71,13,10,26,10]);
  const ihdrData = new Uint8Array(13);
  new DataView(ihdrData.buffer).setUint32(0, width);
  new DataView(ihdrData.buffer).setUint32(4, height);
  ihdrData[8]=8; ihdrData[9]=6; ihdrData[10]=0; ihdrData[11]=0; ihdrData[12]=0;
  const ihdr = _pngChunk('IHDR', ihdrData);
  const rawData = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    rawData[y * (1 + width * 4)] = 0;
    rawData.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (1 + width * 4) + 1);
  }
  const deflated = _zlibDeflateRaw(rawData);
  const idat = _pngChunk('IDAT', deflated);
  const iend = _pngChunk('IEND', new Uint8Array(0));
  const total = sig.length + ihdr.length + idat.length + iend.length;
  const result = new Uint8Array(total);
  let off = 0;
  result.set(sig, off); off += sig.length;
  result.set(ihdr, off); off += ihdr.length;
  result.set(idat, off); off += idat.length;
  result.set(iend, off);
  return result;
}

function _pngChunk(type, data) {
  const len = data.length;
  const chunk = new Uint8Array(12 + len);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, len);
  for (let i = 0; i < 4; i++) chunk[4 + i] = type.charCodeAt(i);
  chunk.set(data, 8);
  const crc = _crc32(chunk.subarray(4, 8 + len));
  dv.setUint32(8 + len, crc);
  return chunk;
}

function _adler32(data) {
  let a = 1, b = 0;
  for (let i = 0; i < data.length; i++) { a = (a + data[i]) % 65521; b = (b + a) % 65521; }
  return (b << 16) | a;
}

const _crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c; }
  return t;
})();

function _crc32(data) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) crc = _crcTable[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function _zlibDeflateRaw(data) {
  const header = new Uint8Array([0x78, 0x01]);
  const maxBlock = 65535;
  const blocks = [];
  for (let off = 0; off < data.length; off += maxBlock) {
    const end = Math.min(off + maxBlock, data.length);
    const len = end - off;
    const isLast = end >= data.length;
    const bh = new Uint8Array(5);
    bh[0] = isLast ? 0x01 : 0x00;
    bh[1] = len & 0xFF; bh[2] = (len >> 8) & 0xFF;
    bh[3] = (~len & 0xFF); bh[4] = ((~len >> 8) & 0xFF);
    blocks.push(bh, data.subarray(off, end));
  }
  const cs = _adler32(data);
  const trailer = new Uint8Array(4);
  new DataView(trailer.buffer).setUint32(0, cs);
  let total = 2;
  for (const b of blocks) total += b.length;
  total += 4;
  const result = new Uint8Array(total);
  let o = 0;
  result.set(header, o); o += 2;
  for (const b of blocks) { result.set(b, o); o += b.length; }
  result.set(trailer, o);
  return result;
}

/* ═══════════════════════════════════════════════════════════════
   Notification queue — debounce to avoid Chrome rate-limiting
   ═══════════════════════════════════════════════════════════════ */

const _notifQueue = [];
let _notifProcessing = false;

async function _queuedNotification(chatId, title, body, iconUrl, data) {
  const tag = chatId ? 'signal-' + chatId : 'signal-msg';
  const existing = _notifQueue.findIndex(n => n.tag === tag);
  if (existing >= 0) {
    _notifQueue[existing].title     = title;
    _notifQueue[existing].body      = body;
    _notifQueue[existing].iconUrl   = iconUrl;
    _notifQueue[existing].data      = data;
    _notifQueue[existing].updatedAt = Date.now();
    return;
  }
  _notifQueue.push({ tag, title, body, iconUrl, data, updatedAt: Date.now() });
  if (!_notifProcessing) {
    _notifProcessing = true;
    await _processNotifQueue();
  }
}

async function _processNotifQueue() {
  while (_notifQueue.length > 0) {
    const notif = _notifQueue.shift();
    const notifOpts = {
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
    await self.registration.showNotification(notif.title, notifOpts);
    if (_notifQueue.length > 0) {
      await new Promise(r => setTimeout(r, 1100));
    }
  }
  _notifProcessing = false;
}

/* ═══════════════════════════════════════════════════════════════
   Notification click handler
   ═══════════════════════════════════════════════════════════════ */

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const action = event.action;
  const chatId = event.notification.data?.chatId || null;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async clients => {
      let targetClient = null;
      for (const client of clients) {
        if ('focus' in client) {
          targetClient = client;
          await client.focus();
          break;
        }
      }
      if (!targetClient && self.clients.openWindow) {
        targetClient = await self.clients.openWindow(_BASE + '/');
      }
      if (targetClient) {
        targetClient.postMessage({
          type:   'NOTIF_ACTION',
          action: action || 'open',
          chatId: chatId
        });
      }
    })
  );
});

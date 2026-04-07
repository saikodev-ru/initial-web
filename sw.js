/* ═══════════════════════════════════════════════════════════════
   SERVICE WORKER — Initial.
   Кешируем критические ресурсы при установке,
   отправляем реальный прогресс на страницу через postMessage.
   emoji.ttf дополнительно хранится в IndexedDB — переживает
   жёсткие перезагрузки и очистку SW-кеша.
   ═══════════════════════════════════════════════════════════════ */

// ── Firebase Messaging SDK (required for FCM on Android PWA) ──
// Must import both app-compat AND messaging-compat (not the combined sw.js)
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

// ── Firebase initialization (REQUIRED for FCM token fetch + background push) ──
const FIREBASE_CONFIG = {
  apiKey:            'AIzaSyBP2OObK7mkIIJfPxJOaJJ7hcP76q2gxX4',
  authDomain:        'initial-messenger.firebaseapp.com',
  projectId:         'initial-messenger',
  storageBucket:     'initial-messenger.firebasestorage.app',
  messagingSenderId: '879915718420',
  appId:             '1:879915718420:web:1ed8f51e05a847a065bd21',
};

firebase.initializeApp(FIREBASE_CONFIG);
const _fcmMessaging = firebase.messaging();

// ── FCM Background Message Handler ────────────────────────────
// Called when app is backgrounded/closed and a FCM message arrives.
// Firebase intercepts the push event for FCM messages — we use this callback.
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

  // Enrich payload from cached chat data if needed
  if ((!data.sender_name || !data.sender_avatar) && self._notifChatCache && data.chat_id) {
    const cached = self._notifChatCache.find(c => c.chat_id === data.chat_id);
    if (cached) {
      if (!data.sender_name)   data.sender_name   = cached.partner_name   || '';
      if (!data.sender_avatar) data.sender_avatar = cached.partner_avatar || null;
      if (!data.body && cached.last_message) data.body = cached.last_message;
    }
  }

  const title  = data.sender_name || 'Initial.';
  const body   = (data.body || 'Новое сообщение').slice(0, 160);
  const chatId = data.chat_id || null;

  // Resolve avatar: try SW cache → fetch from network → generate initial letter
  let iconUrl = '/icon-192.png';
  if (data.sender_avatar) {
    try {
      // 1. Try SW cache first
      const cached = await caches.match(data.sender_avatar);
      if (cached && cached.ok) {
        const blob = await cached.blob();
        iconUrl = URL.createObjectURL(blob);
      } else {
        // 2. Fetch from network (SW context supports fetch)
        try {
          const resp = await fetch(data.sender_avatar);
          if (resp && resp.ok) {
            const blob = await resp.blob();
            if (blob && blob.size > 0 && blob.type.startsWith('image/')) {
              // Cache for future use
              const cache = await caches.open(CACHE_VER);
              cache.put(data.sender_avatar, new Response(blob));
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
      iconUrl = await _swGenerateInitialAvatar(data.sender_name || title).catch(() => '/icon-192.png');
    }
  }

  return _queuedNotification(chatId, title, body, iconUrl, { chatId });
});
const CACHE_VER  = 'sg-v19';
const API_PREFIX = '/api/';
const EMOJI_URL  = 'assets/emoji.ttf'; // тяжёлый ресурс — храним в IDB

const CRITICAL = [
  'index.html',
  'manifest.json',
  'css/style.css',
  'js/theme.js',
  'js/utils.js',
  'js/chat-list.js',
  'js/auth.js',
  'js/link-qr-renderer.js',
  'js/push-notifications.js',
  // 'js/push-subscribe.js' removed — FCM only, no VAPID Web Push
  'js/fcm.js',
  'js/messages.js',
  'js/context-menu.js',
  'js/app.js',
  'js/call.js',
  'assets/background-pattern.svg',
  EMOJI_URL,
];

let _installProgress = 0;
let _installDone     = false;

/* ══ IndexedDB helpers для emoji.ttf ═════════════════════════ */
const IDB_NAME    = 'sg-assets';
const IDB_STORE   = 'blobs';
const IDB_VERSION = 1;

function _idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = e => e.target.result.createObjectStore(IDB_STORE);
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = ()  => reject(req.error);
  });
}

async function _idbGet(key) {
  try {
    const db = await _idbOpen();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror   = () => reject(req.error);
    });
  } catch { return null; }
}

async function _idbPut(key, value) {
  try {
    const db = await _idbOpen();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(IDB_STORE, 'readwrite');
      const req = tx.objectStore(IDB_STORE).put(value, key);
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(req.error);
    });
  } catch {}
}

/* Строит Response из сохранённого в IDB объекта {blob, headers} */
async function _idbToResponse(key) {
  const stored = await _idbGet(key);
  if (!stored) return null;
  return new Response(stored.blob, { headers: stored.headers });
}

/* Сохраняет Response в IDB (клонируем чтобы не сломать оригинал) */
async function _saveToIdb(key, response) {
  try {
    const blob    = await response.clone().blob();
    const headers = {};
    response.headers.forEach((v, k) => { headers[k] = v; });
    await _idbPut(key, { blob, headers });
  } catch {}
}

/* ── Утилита: broadcast прогресс всем вкладкам ── */
async function broadcast(msg) {
  const all = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  all.forEach(c => c.postMessage(msg));
}

/* ══ INSTALL ══════════════════════════════════════════════════ */
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VER);
    const total = CRITICAL.length;
    let done = 0;

    for (const url of CRITICAL) {
      let ok = false;
      try {
        // Для emoji.ttf: сначала смотрим в IDB — там он может уже лежать
        if (url === EMOJI_URL) {
          const idbResp = await _idbToResponse(EMOJI_URL);
          if (idbResp) {
            await cache.put(url, idbResp);
            ok = true;
          }
        }
        if (!ok) {
          const req  = new Request(url, { cache: 'no-cache' });
          const resp = await fetch(req);
          if (resp.ok) {
            // Сохраняем в SW-кеш
            await cache.put(url, resp.clone());
            // emoji.ttf дополнительно в IDB для выживания очисток кеша
            if (url === EMOJI_URL) await _saveToIdb(EMOJI_URL, resp);
            ok = true;
          }
        }
      } catch (e) {
        // Сеть недоступна — старый SW-кеш
        const old = await caches.match(url);
        if (old) { await cache.put(url, old.clone()); ok = true; }
        // Для emoji.ttf последний шанс — IDB
        if (!ok && url === EMOJI_URL) {
          const idbResp = await _idbToResponse(EMOJI_URL);
          if (idbResp) { await cache.put(url, idbResp); ok = true; }
        }
      }

      if (ok) done++;
      _installProgress = Math.round((done / total) * 100);
      await broadcast({ type: 'CACHE_PROGRESS', progress: _installProgress, done: false });
    }

    // Финальная проверка — каждый URL реально в кеше
    const checks = await Promise.all(
      CRITICAL.map(url => cache.match(url).then(r => !!r))
    );
    const allCached = checks.every(Boolean);

    _installDone     = allCached;
    _installProgress = allCached ? 100 : Math.round((checks.filter(Boolean).length / total) * 100);

    await broadcast({ type: 'CACHE_PROGRESS', progress: _installProgress, done: allCached });

    if (allCached) self.skipWaiting();
  })());
});

/* ══ ACTIVATE ═════════════════════════════════════════════════ */
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Удаляем старые версии кеша
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_VER).map(k => caches.delete(k)));
    // Захватываем все открытые вкладки без перезагрузки
    await self.clients.claim();
    // Сообщаем вкладкам что SW активен — они сами запросят GET_STATUS
    await broadcast({ type: 'SW_ACTIVE', cacheVer: CACHE_VER });
  })());
});

/* ══ MESSAGE — ответы на запросы от страницы ══════════════════ */
self.addEventListener('message', event => {
  if (event.data?.type === 'GET_STATUS') {
    (async () => {
      let reallyDone = _installDone;
      if (!reallyDone) {
        try {
          const cache = await caches.open(CACHE_VER);
          // Проверяем каждый критический ресурс отдельно
          const checks = await Promise.all(
            CRITICAL.map(url => cache.match(url).then(r => !!r))
          );
          reallyDone = checks.every(Boolean);
          if (reallyDone) { _installProgress = 100; _installDone = true; }
          else {
            // Считаем сколько уже есть для прогресс-бара
            const done = checks.filter(Boolean).length;
            _installProgress = Math.round((done / CRITICAL.length) * 100);
          }
        } catch (e) {}
      }
      event.source.postMessage({
        type:     'CACHE_PROGRESS',
        progress: reallyDone ? 100 : _installProgress,
        done:     reallyDone,
      });
    })();
  }
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data?.type === 'SYNC_NOTIF_DATA') {
    // Store chat data for rich push notifications
    self._notifChatCache = event.data.chats || [];
  }
});

/* ══ PUSH NOTIFICATIONS — FCM only ═══════════════════════════
   All push notifications are delivered via Firebase Cloud Messaging.
   The onBackgroundMessage handler above processes background pushes.
   No VAPID / Web Push API — FCM is the sole push channel.
   ═══════════════════════════════════════════════════════════════ */

/**
 * Generate a circle avatar with initial letter (for push notifications).
 * SW has no DOM/canvas, so we build a minimal PNG manually:
 * 96x96 PNG with a coloured circle and a white letter.
 */
async function _swGenerateInitialAvatar(name) {
  const size = 96;
  const str = (name || 'A').toUpperCase();
  const letter = str.charAt(0);

  // Deterministic colour from name hash
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash % 30) + 10;  // 10-40 warm palette
  const sat = 55 + Math.abs((hash >> 8) % 20);
  const lit = 45 + Math.abs((hash >> 16) % 10);

  // Convert HSL to RGB
  const h = hue / 360, s = sat / 100, l = lit / 100;
  const a2 = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h * 12) % 12;
    return l - a2 * Math.max(Math.min(k - 3, 9 - k, 1), -1);
  };
  const r = Math.round(f(0) * 255);
  const g = Math.round(f(8) * 255);
  const b = Math.round(f(4) * 255);

  // Build raw RGBA pixel data
  const pixels = new Uint8ClampedArray(size * size * 4);
  const cx = size / 2, cy = size / 2, rad = size / 2 - 1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const dx = x - cx, dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= rad) {
        pixels[idx] = r;
        pixels[idx + 1] = g;
        pixels[idx + 2] = b;
        pixels[idx + 3] = 255;
      } else if (dist <= rad + 1) {
        // Anti-alias edge
        const alpha = Math.max(0, (rad + 1 - dist));
        pixels[idx] = r;
        pixels[idx + 1] = g;
        pixels[idx + 2] = b;
        pixels[idx + 3] = Math.round(alpha * 255);
      }
      // else transparent (default 0)
    }
  }

  // Encode as PNG (minimal valid PNG with raw IDAT)
  const png = _swEncodePNG(size, size, pixels);
  return URL.createObjectURL(new Blob([png], { type: 'image/png' }));
}

/**
 * Minimal PNG encoder for raw RGBA pixel data.
 * Produces a valid PNG with a single IDAT chunk (uncompressed deflate).
 */
function _swEncodePNG(width, height, rgba) {
  // PNG signature
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdrData = new Uint8Array(13);
  new DataView(ihdrData.buffer).setUint32(0, width);
  new DataView(ihdrData.buffer).setUint32(4, height);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type: RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdr = _pngChunk('IHDR', ihdrData);

  // IDAT: filter byte (0=None) + raw pixel rows
  const rawData = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    rawData[y * (1 + width * 4)] = 0; // no filter
    rawData.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (1 + width * 4) + 1);
  }

  // Deflate: wrap in zlib header (CM=8, CINFO=7) + stored block + adler32
  const deflated = _zlibDeflateRaw(rawData);
  const idat = _pngChunk('IDAT', deflated);

  // IEND chunk
  const iend = _pngChunk('IEND', new Uint8Array(0));

  // Concat
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
  // type (4 ASCII bytes)
  for (let i = 0; i < 4; i++) chunk[4 + i] = type.charCodeAt(i);
  chunk.set(data, 8);
  // CRC over type + data
  const crc = _crc32(chunk.subarray(4, 8 + len));
  dv.setUint32(8 + len, crc);
  return chunk;
}

/** Adler-32 checksum */
function _adler32(data) {
  let a = 1, b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % 65521;
    b = (b + a) % 65521;
  }
  return (b << 16) | a;
}

/** CRC-32 lookup table */
const _crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c;
  }
  return table;
})();

function _crc32(data) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) crc = _crcTable[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/** Minimal zlib wrapper: header (CMF=0x78, FLG=0x01) + stored block(s) + adler32 */
function _zlibDeflateRaw(data) {
  // zlib header: CMF=0x78 (deflate, window=32k), FLG=0x01 (no dict, check bits ok)
  const header = new Uint8Array([0x78, 0x01]);

  // Stored (uncompressed) deflate blocks
  const maxBlock = 65535;
  const blocks = [];
  for (let off = 0; off < data.length; off += maxBlock) {
    const end = Math.min(off + maxBlock, data.length);
    const len = end - off;
    const isLast = end >= data.length;
    // Block header: BFINAL + BTYPE=00 (stored) + LEN + NLEN
    const blockHead = new Uint8Array(5);
    blockHead[0] = isLast ? 0x01 : 0x00;
    blockHead[1] = len & 0xFF;
    blockHead[2] = (len >> 8) & 0xFF;
    blockHead[3] = (~len & 0xFF);
    blockHead[4] = ((~len >> 8) & 0xFF);
    blocks.push(blockHead, data.subarray(off, end));
  }

  // Adler-32 checksum
  const checksum = _adler32(data);
  const trailer = new Uint8Array(4);
  new DataView(trailer.buffer).setUint32(0, checksum);

  // Concat all
  let total = 2; // header
  for (const b of blocks) total += b.length;
  total += 4; // adler32
  const result = new Uint8Array(total);
  let o = 0;
  result.set(header, o); o += 2;
  for (const b of blocks) { result.set(b, o); o += b.length; }
  result.set(trailer, o);
  return result;
}

// VAPID push event handler removed — FCM onBackgroundMessage handles all pushes.
// Firebase SDK intercepts FCM push events internally, so no 'push' listener is needed.

/**
 * Notification queue — prevents Chrome from dropping rapid notifications.
 * Shows at most 1 notification per second, per chat tag.
 * If a new notification for the same chat arrives within 1s, it updates
 * the pending one instead of queuing a second.
 */
const _notifQueue = [];
let _notifProcessing = false;

async function _queuedNotification(chatId, title, body, iconUrl, data) {
  const tag = chatId ? 'signal-' + chatId : 'signal-msg';

  // If there's already a pending notification for this tag, update it
  const existing = _notifQueue.findIndex(n => n.tag === tag);
  if (existing >= 0) {
    _notifQueue[existing].title     = title;
    _notifQueue[existing].body      = body;
    _notifQueue[existing].iconUrl   = iconUrl;
    _notifQueue[existing].data      = data;
    _notifQueue[existing].updatedAt = Date.now();
    return;
  }

  // FIX: was { tag, title, body, icon, iconUrl, data } — 'icon' was undefined
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
      icon:     notif.iconUrl,          // FIX: was notif.icon (undefined)
      tag:      notif.tag,
      renotify: true,
      data:     notif.data,
      vibrate:  [200, 100, 200],
      badge:    '/icon-192.png',
    };

    if ('Notification' in self && self.Notification.maxActions > 0) {
      notifOpts.actions = [
        { action: 'reply',    title: 'Ответить'  },
        { action: 'markread', title: 'Прочитано' }
      ];
    }

    await self.registration.showNotification(notif.title, notifOpts);

    // Space out notifications by 1 second to avoid Chrome throttling
    if (_notifQueue.length > 0) {
      await new Promise(r => setTimeout(r, 1100));
    }
  }
  _notifProcessing = false;
}

self.addEventListener('notificationclick', event => {
  event.notification.close();

  const action = event.action; // 'reply', 'markread', or undefined (default click)
  const chatId = event.notification.data?.chatId || null;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async clients => {
      let targetClient = null;

      // Find an existing window client
      for (const client of clients) {
        if ('focus' in client) {
          targetClient = client;
          await client.focus();
          break;
        }
      }

      if (!targetClient && self.clients.openWindow) {
        targetClient = await self.clients.openWindow('/');
      }

      // Send action data to the page so it can handle reply/markread
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

/* ══ FETCH — cache-first для ресурсов, network-first для API ══ */
self.addEventListener('fetch', event => {
  const url = event.request.url;

  // API и PHP — всегда в сеть (никогда не кешируем)
  if (url.includes('/api/') || url.includes('.php') || url.includes('googleapis.com') || url.includes('jsdelivr.net') || url.includes('gstatic.com')) {
    return;
  }

  if (event.request.method !== 'GET') return;

  // Navigation (переход по URL) — отдаём index.html из кеша (SPA offline)
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(async cached => {
      if (cached) return cached;

      // Промах SW-кеша: для emoji.ttf проверяем IDB перед сетью
      if (url.includes('emoji.ttf')) {
        const idbResp = await _idbToResponse(EMOJI_URL);
        if (idbResp) {
          // Восстанавливаем в SW-кеш заодно
          const clone = idbResp.clone();
          caches.open(CACHE_VER).then(c => c.put(event.request, clone));
          return idbResp;
        }
      }

      // Идём в сеть и кешируем ответ
      return fetch(event.request).then(resp => {
        if (resp.status === 200 && resp.type !== 'opaque') {
          const clone = resp.clone();
          caches.open(CACHE_VER).then(c => c.put(event.request, clone));
          // emoji.ttf — дополнительно в IDB
          if (url.includes('emoji.ttf')) {
            _saveToIdb(EMOJI_URL, resp.clone());
          }
        }
        return resp;
      }).catch(() => new Response('Offline', { status: 503 }));
    })
  );
});

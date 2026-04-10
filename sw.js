/* ═══════════════════════════════════════════════════════════════
   SERVICE WORKER — Initial.
   Кешируем критические ресурсы при установке,
   отправляем реальный прогресс на страницу через postMessage.
   emoji.ttf дополнительно хранится в IndexedDB — переживает
   жёсткие перезагрузки и очистку SW-кеша.

   Push-уведомления обрабатываются отдельным SW:
   firebase-messaging-sw.js (FCM background messages).
   ═══════════════════════════════════════════════════════════════ */

const CACHE_VER  = 'sg-v38';
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
          const checks = await Promise.all(
            CRITICAL.map(url => cache.match(url).then(r => !!r))
          );
          reallyDone = checks.every(Boolean);
          if (reallyDone) { _installProgress = 100; _installDone = true; }
          else {
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
  // SYNC_NOTIF_DATA — kept for backward compat (no-op, data not used here)

  // SHOW_NOTIF — page delegates notification to SW (SW notifications show as popups on Android)
  if (event.data?.type === 'SHOW_NOTIF') {
    const title = event.data.title;
    const opts = event.data.options || {};
    try {
      self.registration.showNotification(title, opts);
    } catch (_) {}
  }
});

/* ══ NOTIFICATION CLICK — handle clicks from page-delegated notifications ══ */
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const chatId = event.notification.data?.chatId || null;
  const action = event.action;

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
        targetClient = await self.clients.openWindow('/web/');
      }
      if (targetClient) {
        targetClient.postMessage({
          type: 'NOTIF_ACTION',
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

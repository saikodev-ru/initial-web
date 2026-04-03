/* ══ APP — Медиа · SSE · Polling · Просмотрщик · Профиль · Boot ══ */

/* ══ MEDIA PREVIEW SEND ══════════════════════════════════════ */
/* ── Performance / low-end device detection ─────────────────── */
(function detectPerfMode() {
  try {
    const mem = navigator.deviceMemory;
    const conn = navigator.connection;
    const slow = conn && (conn.saveData || conn.effectiveType === 'slow-2g' || conn.effectiveType === '2g');
    if ((mem && mem < 2) || slow || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2))
      document.documentElement.classList.add('perf-low');
  } catch (e) { }
})();

const MAX_FILE_BYTES = 100 * 1024 * 1024; // 100 MB

function openSendPreview(files) {
  const arr = Array.from(files);
  const tooBig = arr.filter(f => f.size > MAX_FILE_BYTES);
  if (tooBig.length) {
    toast(`Файл слишком большой (макс. 100 МБ): ${tooBig.map(f => f.name).join(', ')}`, 'err');
    const ok = arr.filter(f => f.size <= MAX_FILE_BYTES);
    if (!ok.length) return;
    files = ok;
  }
  S.prevFiles = Array.from(files).map(f => ({ file: f, url: URL.createObjectURL(f), type: f.type.startsWith('video') ? 'video' : 'image', uploaded: null }));
  S.prevIdx = 0; renderPreview(); openMod('modal-preview');
}
function renderPreview() {
  const files = S.prevFiles, idx = S.prevIdx, cur = files[idx];
  $('prev-count').textContent = files.length === 1 ? `Отправить ${cur.type === 'video' ? 'видео' : 'фото'}` : `Отправить ${files.length} файл${files.length < 5 ? 'а' : 'ов'}`;
  const stage = $('prev-stage'); stage.innerHTML = '';
  if (cur.type === 'image') { const img = document.createElement('img'); img.src = cur.url; img.className = 'prev-main-img'; stage.appendChild(img); }
  else { const vid = document.createElement('video'); vid.src = cur.url; vid.controls = true; vid.className = 'prev-main-vid'; stage.appendChild(vid); }
  const thumbs = $('prev-thumbs'); thumbs.innerHTML = '';
  if (files.length > 1) files.forEach((f, i) => { const pt = document.createElement('div'); pt.className = 'pt' + (i === idx ? ' active' : ''); if (f.type === 'image') { const img = document.createElement('img'); img.src = f.url; pt.appendChild(img); } else { const vid = document.createElement('video'); vid.src = f.url; pt.appendChild(vid); } const rm = document.createElement('button'); rm.className = 'pt-rm'; rm.textContent = '✕'; rm.onclick = ev => { ev.stopPropagation(); S.prevFiles.splice(i, 1); if (!S.prevFiles.length) { closeMod('modal-preview'); return; } S.prevIdx = Math.min(S.prevIdx, S.prevFiles.length - 1); renderPreview(); }; pt.appendChild(rm); pt.onclick = () => { S.prevIdx = i; renderPreview(); }; thumbs.appendChild(pt); });
  $('prev-info').textContent = fmtBytes(files.reduce((a, f) => a + f.file.size, 0));
}
$('btn-attach').onclick = () => $('file-in').click();
$('file-in').onchange = () => { if ($('file-in').files.length) { openSendPreview($('file-in').files); $('file-in').value = ''; } };
$('prev-add-in').onchange = () => {
  if (!$('prev-add-in').files.length) return;
  const arr = Array.from($('prev-add-in').files);
  const tooBig = arr.filter(f => f.size > MAX_FILE_BYTES);
  if (tooBig.length) toast(`Файл слишком большой (макс. 100 МБ)`, 'err');
  const ok = arr.filter(f => f.size <= MAX_FILE_BYTES);
  if (ok.length) {
    S.prevFiles.push(...ok.map(f => ({ file: f, url: URL.createObjectURL(f), type: f.type.startsWith('video') ? 'video' : 'image', uploaded: null })));
    renderPreview();
  }
  $('prev-add-in').value = '';
};
$('btn-prev-send').onclick = async () => {
  if (!S.partner) return;
  const btn = $('btn-prev-send'); btn.disabled = true;
  const caption = $('prev-caption').value.trim();
  const spoiler = S.prevSpoiler;
  const files = [...S.prevFiles];         // snapshot before clearing
  const replyId = S.replyTo?.id || null;
  const total = files.length;
  const batchId = total > 1 ? ('b' + Date.now()) : null;

  // ── 1. Close modal immediately (instant UX) ───────────────────
  if (S.replyTo) { S.replyTo = null; hideRbar(); }
  S.prevFiles = []; S.prevIdx = 0; S.prevSpoiler = false; $('prev-caption').value = '';
  closeMod('modal-preview');
  btn.disabled = false;

  // ── 2. Build temp bubbles and inject into chat ────────────────
  const pending = files.map((pf, i) => {
    const tid = 'tu' + Date.now() + '_' + i;
    const isLast = i === total - 1;
    const tmp = {
      id: tid,
      sender_id: S.user.id,
      body: isLast && caption ? caption : '',
      sent_at: Math.floor(Date.now() / 1000),
      is_read: 0, is_edited: 0,
      nickname: S.user.nickname,
      avatar_url: S.user.avatar_url,
      reply_to: i === 0 ? replyId : null,
      media_url: pf.url,           // blob URL — renders instantly
      media_type: pf.type === 'video' ? 'video' : 'image',
      media_spoiler: spoiler ? 1 : 0,
      reactions: [],
    };
    if (batchId) tmp.batch_id = batchId;
    S.msgs[S.chatId] = S.msgs[S.chatId] || [];
    S.msgs[S.chatId].push(tmp);
    S.rxns[tid] = [];
    appendMsg(S.chatId, tmp);
    return { tid, pf, isLast, tmp };
  });
  scrollBot();

  // ── 3. Attach upload-ring overlay to each bubble ──────────────
  const abortMap = new Map();

  pending.forEach(({ tid }) => {
    const row = document.querySelector(`.mrow[data-id="${tid}"]`);
    const gridEl = batchId ? document.querySelector(`.mrow[data-batch="${batchId}"]`) : null;
    let mediaEl = row ? row.querySelector('.single-media') || row.querySelector('.vid-wrap') : null;
    if (!mediaEl && gridEl) {
      mediaEl = gridEl.querySelector(`.gi[data-id="${tid}"]`);
    }
    if (!mediaEl) return;

    const ov = document.createElement('div');
    ov.className = 'media-upload-ov';
    ov.innerHTML =
      '<div class="upload-ring-wrap">' +
      '<svg class="upload-ring-svg" viewBox="0 0 54 54">' +
      '<circle class="upload-ring-bg" cx="27" cy="27" r="22"/>' +
      '<circle class="upload-ring-fg" cx="27" cy="27" r="22"/>' +
      '</svg>' +
      '<div class="upload-cancel-btn">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
      '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>' +
      '</svg>' +
      '</div>' +
      '</div>';
    // Blur the media while uploading
    mediaEl.classList.add('media-loading');
    mediaEl.appendChild(ov);

    // Cancel button
    ov.querySelector('.upload-cancel-btn').onclick = e => {
      e.stopPropagation();
      abortMap.get(tid)?.abort();
      removeMsgById(tid);
    };

    const ac = new AbortController();
    abortMap.set(tid, ac);
  });

  // ── 4. Upload + send each file in parallel ────────────────────
  const sentIds = [];

  await Promise.all(pending.map(async ({ tid, pf, isLast, tmp }) => {
    const ac = abortMap.get(tid);
    if (!ac) return;

    // Helper: update ring fill (0–1)
    const setRing = ratio => {
      const row = document.querySelector(`.mrow[data-id="${tid}"]`);
      const fg = row ? row.querySelector('.upload-ring-fg') : document.querySelector(`.mrow[data-batch="${batchId}"] .gi[data-id="${tid}"] .upload-ring-fg`);
      if (fg) fg.style.strokeDashoffset = String((1 - ratio) * 138.23);
    };

    try {
      // Upload via XHR so we get real progress
      const uploadRes = await uploadFileXHR(pf.file, ac.signal, p => setRing(p * 0.85));
      if (ac.signal.aborted) return;

      if (!uploadRes || !uploadRes.ok) {
        toast('Ошибка загрузки файла', 'err');
        removeMsgById(tid);
        return;
      }

      // Ring nearly full (85 → 100%) during send_message round-trip
      setRing(0.92);

      // ── send_message ──────────────────────────────────────────
      const toSid = S.partner.partner_signal_id;
      const payload = { to_signal_id: toSid, body: tmp.body || '' };
      if (tmp.reply_to) payload.reply_to = tmp.reply_to;
      payload.media_url = uploadRes.url;
      payload.media_type = uploadRes.media_type;
      if (spoiler) payload.media_spoiler = 1;
      if (batchId) payload.batch_id = batchId;

      const res = await api('send_message', 'POST', payload);

      if (!res.ok) {
        toast(res.message || 'Ошибка отправки', 'err');
        const r = document.querySelector(`.mrow[data-id="${tid}"]`);
        if (r) deleteMsgEl(r);
        if (S.msgs[S.chatId]) S.msgs[S.chatId] = S.msgs[S.chatId].filter(m => m.id !== tid);
        return;
      }

      sentIds.push(res.message_id);

      // ── New chat (first message ever) ─────────────────────────
      if (!S.chatId) {
        S.chatId = res.chat_id; S.lastId[res.chat_id] = res.message_id; S.msgs[res.chat_id] = [];
        await loadChats();
        const nc = S.chats.find(c => c.chat_id === res.chat_id);
        if (nc) { S.partner = nc; $$('.ci').forEach(e => e.classList.remove('active')); document.querySelector(`.ci[data-chat-id="${res.chat_id}"]`)?.classList.add('active'); }
        $('msgs').innerHTML = ''; await fetchMsgs(res.chat_id, true);
        return;
      }

      // ── Promote temp → real ───────────────────────────────────
      let finalUrl = getMediaUrl(uploadRes.url);

      if (S.msgs[S.chatId]) {
        const idx = S.msgs[S.chatId].findIndex(m => m.id === tid);
        if (idx >= 0) Object.assign(S.msgs[S.chatId][idx], { id: res.message_id, media_url: finalUrl });
      }
      S.rxns[res.message_id] = S.rxns[tid] || []; delete S.rxns[tid];
      S.lastId[S.chatId] = Math.max(S.lastId[S.chatId] || 0, res.message_id);

      // ── Ring → done: fill to 100%, fade overlay, patch DOM ────
      setRing(1);
      const rowEl = document.querySelector(`.mrow[data-id="${tid}"]`);
      const gridEl = batchId ? document.querySelector(`.mrow[data-batch="${batchId}"]`) : null;
      if (rowEl) {
        rowEl.dataset.id = res.message_id;
        const ov2 = rowEl.querySelector('.media-upload-ov');
        if (ov2) {
          ov2.classList.add('done');
          const mediaElDone = rowEl.querySelector('.single-media,.vid-wrap');
          if (mediaElDone) mediaElDone.classList.remove('media-loading');
          setTimeout(() => ov2.remove(), 230);
        }
        // Real media URL
        const img = rowEl.querySelector('.single-media img');
        if (img) img.src = finalUrl;
        const vid = rowEl.querySelector('.vid-wrap video');
        if (vid) vid.src = finalUrl;
        // Patch for correct tick + time
        const sentMsg = S.msgs[S.chatId]?.find(m => m.id === res.message_id);
        if (sentMsg) patchMsgDom(sentMsg);
      } else if (gridEl) {
        const gi = gridEl.querySelector(`.gi[data-id="${tid}"]`);
        if (gi) {
          gi.dataset.id = res.message_id;
          const ov2 = gi.querySelector('.media-upload-ov');
          if (ov2) { ov2.classList.add('done'); setTimeout(() => ov2.remove(), 230); }
          gi.classList.remove('media-loading');
          const img = gi.querySelector('img'); if (img) img.src = finalUrl;
          const sentMsg = S.msgs[S.chatId]?.find(m => m.id === res.message_id);
          if (sentMsg) patchMsgDom(sentMsg);
        }
      }

    } catch (e) {
      if (e && e.name === 'AbortError') return; // user cancelled
      removeMsgById(tid);
    }
  }));

  // Patch batch_id so media grid grouping works
  if (batchId && sentIds.length > 1 && S.chatId && S.msgs[S.chatId]) {
    // 1. Выставить batch_id в state
    S.msgs[S.chatId].forEach(m => { if (sentIds.includes(m.id)) m.batch_id = batchId; });
    // 2. Склеить одиночные DOM-баблы в сетку (renderMsgs() дублировал бы их)
    const batchMsgs = S.msgs[S.chatId].filter(m => sentIds.includes(m.id) && m.batch_id === batchId);
    const firstSentId = sentIds[0];
    const firstEl = document.querySelector(`.mrow[data-id="${firstSentId}"]`);
    if (firstEl && batchMsgs.length > 1) {
      // Удалить все одиночные баблы кроме первого
      sentIds.forEach(id => {
        if (id === firstSentId) return;
        const el = document.querySelector(`.mrow[data-id="${id}"]`);
        if (el) el.remove();
      });
      // Заменить первый бабл на grid
      const gridEl = makeGridEl(batchMsgs, firstEl.classList.contains('ns'));
      firstEl.replaceWith(gridEl);
      applyGroupClasses($('msgs'));
    }
  }
};


/* ══ SSE — мгновенная доставка новых сообщений ═══════════════ */
function startSSE(chatId, lastId) {
  if (S.sse) { S.sse.close(); S.sse = null; }
  // SSE отключен для снижения нагрузки на сервер.
  // Сообщения забираются через AJAX-опрос (startPoll) и FCM Push.
}


/* ══ POLLING ══════════════════════════════════════════════════ */
function pollNow() { if (S.chatId) fetchMsgs(S.chatId); else loadChats(); }

/* ══ BACKGROUND SYNC ══════════════════════════════════════════ */
// Every 30s: silently check all non-active chats for edits/deletes
// Uses the same get_messages endpoint with after_id from cached lastId
async function bgSync() {
  if (!S.token || !S.user) return;
  const chats = S.chats || [];
  for (const c of chats) {
    const cid = c.chat_id;
    if (cid === S.chatId) continue; // active chat already polled by fetchMsgs
    const cached = cacheReadMsgs(cid);
    if (!cached || !cached.length) continue;
    const lastId = cached.reduce((mx, m) => Math.max(mx, +m.id), 0);
    const visIds = cached.map(m => m.id).filter(id => !isTemp(id));
    const checkParam = visIds.length ? `&check_ids=${visIds.join(',')}` : '';
    const res = await api(`get_messages?chat_id=${cid}&after_id=${lastId}${checkParam}`);
    if (!res.ok) { if (res.error === 'auth') break; continue; } // break on 401, skip on other errors


    let changed = false;
    // Apply deletions to cache
    (res.deleted_ids || []).forEach(id => {
      const i = cached.findIndex(m => m.id === id);
      if (i >= 0) { cached.splice(i, 1); changed = true; }
    });
    // Apply edits / new messages to cache
    (res.messages || []).forEach(m => {
      if(m.media_url) m.media_url = getMediaUrl(m.media_url);
      const i = cached.findIndex(x => x.id === m.id);
      if (i >= 0) { cached[i] = m; changed = true; }
      else { cached.push(m); changed = true; }
    });
    const lastReadId = +res.last_read_id || 0;
    const myId = +S.user?.id || 0;
    if (lastReadId && myId) {
      cached.forEach(m => {
        if (!isTemp(m.id) && m.sender_id === myId && +m.id <= lastReadId && m.is_read != 1) {
          m.is_read = 1;
          changed = true;
        }
      });
    }
    if (changed) {
      cacheWriteMsgs(cid, cached.slice(-CACHE_MSGS_MAX));
    }
  }
}

/* ══ Global Call Signal Polling ═══ */
let _callSigLastId = 0;

window.advanceCallSigCursor = function(id) {
  if (id && id > _callSigLastId) _callSigLastId = id;
};

window.pollCallSignals = async function() {
  if (!S.token) return;
  try {
    const res = await api(`get_call_signals?last_id=${_callSigLastId}`);
    if (!res.ok) return;
    if (res.last_id > _callSigLastId) _callSigLastId = res.last_id;
    (res.signals || []).forEach(data => {
      if (window.CallUI?.handleSignal) window.CallUI.handleSignal(data);
    });
  } catch (e) { }
};

function startGlobalSSE() {
  if (S._callSigInterval) { clearInterval(S._callSigInterval); S._callSigInterval = null; }
  if (!S.token) return;

  api('get_call_signals?last_id=0').then(res => {
    _callSigLastId = (res && res.ok && res.last_id) ? res.last_id : 0;
    S._callSigInterval = setInterval(window.pollCallSignals, 12000); // Опрос раз в 12с (бэкап к FCM)
  }).catch(() => {
    _callSigLastId = 0;
    S._callSigInterval = setInterval(window.pollCallSignals, 12000);
  });
}


function startPoll() {
  clearInterval(S.polling);
  clearInterval(S._burstPoll);
  clearInterval(S._bgSync);

  // Background sync every 30s
  S._bgSync = setInterval(bgSync, 30000);
  bgSync(); // run once immediately

  // Base interval: 3s when tab is visible, 15s when hidden
  function scheduleBase() {
    clearInterval(S.polling);
    if (!S.token) return;
    const interval = document.visibilityState === 'visible' ? 3000 : 15000;
    S.polling = setInterval(pollNow, interval);
  }
  scheduleBase();

  // On tab focus — one immediate poll + catch-up after 1.5s
  function onActive() {
    if (!S.token) return;
    pollNow();
    clearInterval(S._burstPoll);
    S._burstPoll = setTimeout(() => { pollNow(); scheduleBase(); }, 1500);
  }

  if (!window._pollEventsReady) {
    window._pollEventsReady = true;
    document.addEventListener('visibilitychange', () => {
      scheduleBase();
      if (document.visibilityState === 'visible') onActive();
    });
    window.addEventListener('focus', onActive);
  }
}
/* ══ OFFLINE / CONNECTING INDICATOR ═════════════════════════ */
(function initNetworkStatus() {
  function setSbTitleConnecting(on) {
    const el = $('sb-title'); if (!el) return;
    if (on) {
      if (el.querySelector('.connecting-dots')) return;
      el.innerHTML = 'Соединение<span class="connecting-dots"><span></span><span></span><span></span></span>';
    } else {
      requestAnimationFrame(() => { if (el) el.textContent = fitSbTitle('Signal Messenger'); });
    }
  }
  function setConnecting(on) {
    S._connecting = on;
    setSbTitleConnecting(on);
    if (S.partner) updateHdrSt(S.partner);
  }
  window.addEventListener('offline', () => setConnecting(true));
  window.addEventListener('online', () => { setConnecting(false); pollNow(); });
  if (!navigator.onLine) setConnecting(true);
  window._onApiError = () => { if (!navigator.onLine) setConnecting(true); };
  window._onApiOk = () => { if (S._connecting && navigator.onLine) setConnecting(false); };
})();

/* ══ GRADIENT POSITION FOR OUTGOING MESSAGES ═══════════════════
   background-attachment:fixed не работает внутри overflow:scroll контейнера.
   Вместо этого используем JS для расчёта viewport-позиции каждого
   исходящего сообщения и установки CSS-переменной --msg-vy.
   ═══════════════════════════════════════════════════════════════════ */
(function initMsgGradient() {
  const msgsEl = document.getElementById('msgs');
  if (!msgsEl) return;

  function update() {
    const bodies = msgsEl.querySelectorAll('.me .mbody');
    for (let i = 0; i < bodies.length; i++) {
      const rect = bodies[i].getBoundingClientRect();
      bodies[i].style.setProperty('--msg-vy', rect.top + 'px');
    }
  }

  msgsEl.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update, { passive: true });
  const observer = new MutationObserver(update);
  observer.observe(msgsEl, { childList: true, subtree: true });
})();

/* ══ GRADIENT POSITION FOR OUTGOING MESSAGES ═══════════════════
   background-attachment:fixed не работает внутри overflow:scroll.
   Вместо этого JS рассчитывает viewport-позицию каждого исходящего
   сообщения и устанавливает CSS-переменную --msg-vy.
   Градиент: 100vh размер, no-repeat — виден только на экране.
   ═══════════════════════════════════════════════════════════════════ */
(function initMsgGradient() {
  const msgsEl = document.getElementById('msgs');
  if (!msgsEl) return;

  function update() {
    const bodies = msgsEl.querySelectorAll('.me .mbody');
    for (let i = 0; i < bodies.length; i++) {
      const rect = bodies[i].getBoundingClientRect();
      bodies[i].style.setProperty('--msg-vy', rect.top + 'px');
    }
  }

  msgsEl.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update, { passive: true });
  const observer = new MutationObserver(update);
  observer.observe(msgsEl, { childList: true, subtree: true });
})();

// Persist/restore auth state across backgrounding on mobile/desktop
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') persistAuthState();
  else restoreAuthState();
});
window.addEventListener('pagehide', persistAuthState);
window.addEventListener('pageshow', restoreAuthState);
/* ══ VIEWER with swipe ════════════════════════════════════════ */
function getChatMedia() {
  if (!S.chatId) return [];
  const msgs = S.msgs[S.chatId] || [];
  return msgs.filter(m => m.media_url && m.media_type && !m.is_deleted).map(m => ({ url: m.media_url, type: m.media_type, id: m.id, msg: m }));
}
function openChatViewer(msgId) {
  const all = getChatMedia(); if (!all.length) return;
  const idx = all.findIndex(x => String(x.id) === String(msgId));
  openViewer(all, idx >= 0 ? idx : 0);
}
function openViewer(items, idx) {
  S.viewItems = items; S.viewIdx = idx;
  const track = $('vwr-track');
  track.style.transition = 'none';
  buildViewerTrack();
  track.style.transform = `translateX(-${idx * 100}%)`;
  void track.offsetWidth;
  $('viewer').classList.add('on');
  updateViewerUI();
  requestAnimationFrame(() => { requestAnimationFrame(() => track.style.transition = ''); });
}
function buildViewerTrack() {
  const track = $('vwr-track'); track.innerHTML = '';
  S.viewItems.forEach(item => {
    const slide = document.createElement('div'); slide.className = 'vwr-slide';
    if (item.type === 'image') {
      const img = document.createElement('img'); img.className = 'vwr-img'; img.src = item.url;
      img.style.cursor = 'zoom-in';
      img.ondblclick = () => {
        if (vwrPinch.scale > 1) vwrResetZoom();
      };
      slide.appendChild(img);
    } else {
      const wrap = document.createElement('div'); wrap.className = 'vwr-vid-wrap';
      const vid = document.createElement('video'); vid.className = 'vwr-vid';
      vid.src = item.url; vid.playsInline = true; vid.preload = 'metadata'; vid.loop = true;

      const playBtn = document.createElement('div'); playBtn.className = 'vwr-vid-play-btn';
      playBtn.innerHTML = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>';

      const controls = document.createElement('div'); controls.className = 'vwr-vid-controls';
      const cPlay = document.createElement('button'); cPlay.className = 'vwr-vid-cbtn';
      cPlay.innerHTML = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>';

      const time = document.createElement('div'); time.className = 'vwr-vid-time'; time.textContent = '0:00 / 0:00';
      const progWrap = document.createElement('div'); progWrap.className = 'vwr-vid-prog';
      const progFill = document.createElement('div'); progFill.className = 'vwr-vid-prog-fill';
      progWrap.appendChild(progFill);
      const fsBtn = document.createElement('button'); fsBtn.className = 'vwr-vid-cbtn';
      fsBtn.innerHTML = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>';

      controls.append(cPlay, time, progWrap, fsBtn);
      wrap.append(vid, playBtn, controls);
      slide.appendChild(wrap);

      const fmt = s => { if (isNaN(s)) s = 0; s = Math.floor(s); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
      const updateUI = () => {
        if (vid.paused) { wrap.classList.remove('playing'); cPlay.innerHTML = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>'; }
        else { wrap.classList.add('playing'); cPlay.innerHTML = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>'; }
      };

      vid.addEventListener('timeupdate', () => {
        if (!vid.duration) return;
        time.textContent = `${fmt(vid.currentTime)} / ${fmt(vid.duration)}`;
        progFill.style.width = (vid.currentTime / vid.duration * 100) + '%';
      });
      vid.addEventListener('loadedmetadata', () => { time.textContent = `0:00 / ${fmt(vid.duration)}`; });
      vid.addEventListener('play', updateUI); vid.addEventListener('pause', updateUI);

      const togglePlay = e => { e.stopPropagation(); if (vid.paused) vid.play(); else vid.pause(); };
      playBtn.onclick = togglePlay; cPlay.onclick = togglePlay; vid.onclick = togglePlay;

      let dragging = false;
      const updateSeek = e => { const r = progWrap.getBoundingClientRect(); let p = (e.clientX - r.left) / r.width; p = Math.max(0, Math.min(1, p)); if (vid.duration) vid.currentTime = p * vid.duration; };
      progWrap.onmousedown = e => { e.stopPropagation(); dragging = true; updateSeek(e); };
      document.addEventListener('mousemove', e => { if (dragging) updateSeek(e); }); document.addEventListener('mouseup', () => { dragging = false; });
      progWrap.addEventListener('touchstart', e => { e.stopPropagation(); dragging = true; updateSeek(e.touches[0]); }, { passive: false });
      document.addEventListener('touchmove', e => { if (dragging) { e.preventDefault(); updateSeek(e.touches[0]); } }, { passive: false });
      document.addEventListener('touchend', () => { dragging = false; });

      fsBtn.onclick = e => { e.stopPropagation(); if (!document.fullscreenElement) { if (wrap.requestFullscreen) wrap.requestFullscreen(); else if (vid.webkitEnterFullscreen) vid.webkitEnterFullscreen(); } else document.exitFullscreen(); };
    }
    track.appendChild(slide);
  });
}
function updateViewerUI() {
  const idx = S.viewIdx, items = S.viewItems;
  const item = items[idx];
  $('vwr-track').style.transform = `translateX(-${idx * 100}%)`;
  const vInfo = $('vwr-info'); vInfo.innerHTML = '';
  if (item && item.msg) {
    const nameDiv = document.createElement('div');
    nameDiv.style.fontWeight = 'bold'; nameDiv.style.fontSize = '15px'; nameDiv.style.color = '#fff';
    nameDiv.textContent = item.msg.nickname || 'Пользователь';
    const dateDiv = document.createElement('div');
    dateDiv.style.fontSize = '12.5px'; dateDiv.style.color = 'rgba(255,255,255,0.6)'; dateDiv.style.marginTop = '2px';
    dateDiv.textContent = fmtDate(item.msg.sent_at) + ' ' + fmtTime(item.msg.sent_at);
    vInfo.appendChild(nameDiv); vInfo.appendChild(dateDiv);
    vInfo.style.display = 'flex'; vInfo.style.flexDirection = 'column'; vInfo.style.alignItems = 'flex-start';
  } else {
    vInfo.textContent = items.length > 1 ? `${idx + 1} / ${items.length}` : '';
    vInfo.style.display = 'block';
  }

  $('vwr-prev').classList.toggle('hide', idx === 0); $('vwr-next').classList.toggle('hide', idx === items.length - 1);
  // Pause all videos, play current
  $$('.vwr-vid').forEach((v, i) => { if (i === idx) v.play().catch(() => { }); else { v.pause(); v.currentTime = 0; } });
  // Thumbnail strip (replaces dots)
  const dotsEl = $('vwr-dots'); dotsEl.innerHTML = '';
  $('vwr-stage').classList.toggle('has-thumbs', items.length > 1);
  if (items.length > 1) {
    items.forEach((item, i) => {
      const t = document.createElement('div'); t.className = 'vwr-thumb' + (i === idx ? ' on' : '');
      if (item.type === 'image') { const img = document.createElement('img'); img.src = item.url; img.loading = 'lazy'; img.alt = ''; t.appendChild(img); }
      else { const vid = document.createElement('video'); vid.src = item.url; vid.muted = true; vid.preload = 'metadata'; t.appendChild(vid); }
      t.onclick = () => { S.viewIdx = i; vwrResetZoom(); updateViewerUI(); };
      dotsEl.appendChild(t);
    });
    requestAnimationFrame(() => { const active = dotsEl.children[idx]; if (active) active.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' }); });
  }
  // Download
  $('vwr-dl').onclick = () => { const a = document.createElement('a'); a.href = items[idx].url; a.download = 'media'; a.click(); };
  // Reset zoom on navigation
  vwrResetZoom();
}
$('vwr-prev').onclick = () => { if (S.viewIdx > 0) { S.viewIdx--; vwrResetZoom(); updateViewerUI(); } };
$('vwr-next').onclick = () => { if (S.viewIdx < S.viewItems.length - 1) { S.viewIdx++; vwrResetZoom(); updateViewerUI(); } };
$('vwr-close').onclick = () => { $('viewer').classList.remove('on'); $$('.vwr-vid').forEach(v => { v.pause(); v.currentTime = 0; }); vwrResetZoom(); };
$('viewer').addEventListener('click', e => {
  if (e.target === $('viewer') || e.target.classList.contains('vwr-slide') || e.target.classList.contains('vwr-stage') || e.target.classList.contains('vwr-track'))
    $('vwr-close').click();
});
// Keyboard
document.addEventListener('keydown', e => {
  if (!$('viewer').classList.contains('on')) return;
  if (e.key === 'ArrowLeft') $('vwr-prev').click(); else if (e.key === 'ArrowRight') $('vwr-next').click(); else if (e.key === 'Escape') $('vwr-close').click();
});
// Swipe + pinch-zoom
function getCurrentVwrImg() {
  const slides = [...$('vwr-track').querySelectorAll('.vwr-slide')];
  return slides[S.viewIdx]?.querySelector('.vwr-img') || null;
}
let vwrTX = 0, vwrTY = 0, vwrDragging = false, vwrSwipeY = false, vwrDY = 0;
const vwrPinch = { dist: 0, scale: 1, base: 1, active: false, ox: 0, oy: 0, panX: 0, panY: 0, basePanX: 0, basePanY: 0 };

function vwrApplyTransform(img) {
  img.style.transform = `scale(${vwrPinch.scale}) translate(${vwrPinch.panX / vwrPinch.scale}px,${vwrPinch.panY / vwrPinch.scale}px)`;
  img.style.cursor = vwrPinch.scale > 1 ? 'grab' : 'zoom-in';
}
function vwrResetZoom() {
  vwrPinch.scale = 1; vwrPinch.panX = 0; vwrPinch.panY = 0;
  const img = getCurrentVwrImg();
  if (img) { img.style.transform = ''; img.style.cursor = 'zoom-in'; }
}

// Mouse wheel zoom
$('vwr-stage').addEventListener('wheel', e => {
  if (!$('viewer').classList.contains('on')) return;
  const img = getCurrentVwrImg(); if (!img) return;
  e.preventDefault();
  const delta = e.deltaY > 0 ? 0.85 : 1.18;
  const r = img.getBoundingClientRect();
  const ox = e.clientX - r.left;
  const oy = e.clientY - r.top;
  const oldScale = vwrPinch.scale;
  vwrPinch.scale = Math.min(8, Math.max(1, oldScale * delta));
  if (vwrPinch.scale <= 1) {
    vwrPinch.scale = 1; vwrPinch.panX = 0; vwrPinch.panY = 0;
  } else {
    const ratio = vwrPinch.scale / oldScale;
    vwrPinch.panX -= ox * (ratio - 1);
    vwrPinch.panY -= oy * (ratio - 1);
  }
  img.style.transition = 'none';
  vwrApplyTransform(img);
}, { passive: false });

// Mouse pan when zoomed in
let _vwrMouseDown = false, _vwrMX = 0, _vwrMY = 0, _vwrBasePX = 0, _vwrBasePY = 0;
$('vwr-stage').addEventListener('mousedown', e => {
  if (vwrPinch.scale <= 1 || e.button !== 0) return;
  _vwrMouseDown = true; _vwrMX = e.clientX; _vwrMY = e.clientY;
  _vwrBasePX = vwrPinch.panX; _vwrBasePY = vwrPinch.panY;
  const img = getCurrentVwrImg(); if (img) img.style.cursor = 'grabbing';
  e.preventDefault();
});
document.addEventListener('mousemove', e => {
  if (!_vwrMouseDown) return;
  vwrPinch.panX = _vwrBasePX + (e.clientX - _vwrMX);
  vwrPinch.panY = _vwrBasePY + (e.clientY - _vwrMY);
  const img = getCurrentVwrImg(); if (img) { img.style.transition = 'none'; vwrApplyTransform(img); }
});
document.addEventListener('mouseup', () => {
  if (!_vwrMouseDown) return; _vwrMouseDown = false;
  const img = getCurrentVwrImg(); if (img && vwrPinch.scale > 1) img.style.cursor = 'grab';
});

// Double-click to toggle zoom at cursor position
$('vwr-stage').addEventListener('dblclick', e => {
  const img = getCurrentVwrImg(); if (!img) return;
  if (vwrPinch.scale > 1) { vwrResetZoom(); return; }
  const r = img.getBoundingClientRect();
  const ox = e.clientX - r.left;
  const oy = e.clientY - r.top;
  vwrPinch.scale = 3;
  vwrPinch.panX = -ox * (3 - 1);
  vwrPinch.panY = -oy * (3 - 1);
  img.style.transition = 'transform .2s var(--ease)';
  vwrApplyTransform(img);
});

// Touch pinch-zoom + pan
$('vwr-stage').addEventListener('touchstart', e => {
  if (e.touches.length === 2) {
    vwrDragging = false;
    vwrSwipeY = false;
    vwrPinch.active = true;
    vwrPinch.dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    vwrPinch.base = vwrPinch.scale;
    vwrPinch.basePanX = vwrPinch.panX; vwrPinch.basePanY = vwrPinch.panY;
  } else if (e.touches.length === 1) {
    vwrTX = e.touches[0].clientX;
    vwrTY = e.touches[0].clientY;
    vwrPinch.ox = e.touches[0].clientX; vwrPinch.oy = e.touches[0].clientY;
    vwrPinch.active = false;
    if (vwrPinch.scale <= 1) { vwrDragging = false; vwrSwipeY = false; }
    else { vwrDragging = false; vwrSwipeY = false; _vwrBasePX = vwrPinch.panX; _vwrBasePY = vwrPinch.panY; }
  }
}, { passive: true });
$('vwr-stage').addEventListener('touchmove', e => {
  if (vwrPinch.active && e.touches.length === 2) {
    e.preventDefault();
    const newDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    const ratio = newDist / vwrPinch.dist;
    vwrPinch.scale = Math.min(8, Math.max(1, vwrPinch.base * ratio));
    if (vwrPinch.scale <= 1) {
      vwrPinch.panX = 0; vwrPinch.panY = 0;
    }
    const img = getCurrentVwrImg();
    if (img) { img.style.transition = 'none'; vwrApplyTransform(img); }
    return;
  }
  if (vwrPinch.scale > 1 && e.touches.length === 1) {
    vwrPinch.panX = _vwrBasePX + (e.touches[0].clientX - vwrPinch.ox);
    vwrPinch.panY = _vwrBasePY + (e.touches[0].clientY - vwrPinch.oy);
    const img = getCurrentVwrImg(); if (img) { img.style.transition = 'none'; vwrApplyTransform(img); }
    return;
  }
  if (vwrPinch.scale <= 1 && e.touches.length === 1) {
    const dx = e.touches[0].clientX - vwrTX;
    const dy = e.touches[0].clientY - vwrTY;
    if (!vwrDragging && !vwrSwipeY) {
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) vwrDragging = true;
      else if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) vwrSwipeY = true;
    }
    if (vwrDragging) {
      e.preventDefault();
      $('vwr-track').style.transition = 'none';
      $('vwr-track').style.transform = `translateX(calc(-${S.viewIdx * 100}% + ${dx}px))`;
    } else if (vwrSwipeY) {
      e.preventDefault();
      vwrDY = dy;
      $('vwr-track').style.transition = 'none';
      $('viewer').style.transition = 'none';
      $('vwr-track').style.transform = `translate(calc(-${S.viewIdx * 100}%), ${dy}px)`;
      const op = Math.max(0, 0.98 - Math.abs(dy) / 400);
      $('viewer').style.backgroundColor = `rgba(0,0,0,${op})`;
    }
  }
}, { passive: false });
$('vwr-stage').addEventListener('touchend', e => {
  if (vwrPinch.active && e.touches.length < 2) {
    vwrPinch.active = false;
    const img = getCurrentVwrImg(); if (img) img.style.transition = 'transform .25s var(--sp)';
    if (vwrPinch.scale < 1.15) vwrResetZoom();
    return;
  }
  if (vwrSwipeY) {
    vwrSwipeY = false;
    $('vwr-track').style.transition = '';
    $('viewer').style.transition = '';
    if (Math.abs(vwrDY) > 100) {
      $('vwr-close').click();
      setTimeout(() => {
        $('viewer').style.backgroundColor = '';
        $('vwr-track').style.transform = '';
      }, 300);
    } else {
      $('viewer').style.backgroundColor = '';
      updateViewerUI();
    }
    vwrDY = 0;
    return;
  }
  if (vwrDragging) {
    vwrDragging = false; $('vwr-track').style.transition = '';
    const dx = e.changedTouches[0].clientX - vwrTX;
    if (vwrPinch.scale <= 1) {
      if (dx > 60 && S.viewIdx > 0) { S.viewIdx--; vwrResetZoom(); }
      else if (dx < -60 && S.viewIdx < S.viewItems.length - 1) { S.viewIdx++; vwrResetZoom(); }
    }
    updateViewerUI();
  }
}, { passive: true });



/* ══ PROFILE ══════════════════════════════════════════════════ */
function _checkProfileChanges() {
  if (!S.user) return;
  const n = $('pm-name').value.trim();
  const s = $('pm-sid').value.trim().toLowerCase();
  const b = $('pm-bio').innerHTML.trim();

  const changed = n !== (S.user.nickname || '') || s !== (S.user.signal_id || '').toLowerCase() || b !== (S.user.bio || '');
  const btn = $('btn-savepm');
  if (btn) btn.disabled = !changed;
}

function _updateHeroNameUI(u, customName) {
  const dn = $('pm-display-name');
  if (dn) {
    const nameText = customName !== undefined && customName !== '' ? customName : (u.nickname || u.email || '—');
    const isV = isVerified({signal_id: u.signal_id, is_verified: u.is_verified});
    const isT = isTeamSignal({is_team_signal: u.is_team_signal});
    
    let badgeHtml = '';
    if (isV) badgeHtml += `<span class="verified-badge lg" title="Верифицирован" style="margin-left:6px;vertical-align:middle;"><svg viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg"><path d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.705 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681s.075-1.299-.165-1.903c.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z" fill="currentColor"/></svg></span>`;
    if (isT) badgeHtml += `<span style="margin-left:6px;vertical-align:middle;">${teamBadgeSvg('lg')}</span>`;
    
    dn.innerHTML = esc(nameText) + badgeHtml;
  }
}

function openProfile() {
  if (!S.user) return;
  const u = S.user;
  $('pm-name').value = u.nickname || '';
  $('pm-sid').value = u.signal_id || '';
  $('pm-email').value = u.email || '';
  $('pm-bio').innerHTML = u.bio || '';
  if ($('pm-bio-counter')) $('pm-bio-counter').textContent = (u.bio || '').replace(/<[^>]*>/g, '').length + '/150';
  $('pm-av').innerHTML = aviHtml(u.nickname || u.email, u.avatar_url);
  applyBlurredAvatarBg('tg-hero-bg', u.nickname || u.email, u.avatar_url);
  _updateHeroNameUI(u);
  const ds = $('pm-display-sid'); if (ds) ds.textContent = u.signal_id ? '@' + u.signal_id : '';

  $('e-pm').classList.remove('on');
  _checkProfileChanges();
  syncNotifUI();
  syncEnterUI();
  loadSessions();
  $('sb-profile-panel').classList.add('open');

  // Синхронизируем профиль с сервером на случай, если кэш устарел (подтягиваем bio)
  api('get_me', 'GET').then(res => {
    if (res && res.ok && res.user) {
      S.user = { ...S.user, ...res.user };
      localStorage.setItem('sg_user', JSON.stringify(S.user));
      if ($('btn-savepm') && $('btn-savepm').disabled) {
        $('pm-name').value = S.user.nickname || '';
        $('pm-sid').value = S.user.signal_id || '';
        $('pm-bio').innerHTML = S.user.bio || '';
        if (ds) ds.textContent = S.user.signal_id ? '@' + S.user.signal_id : '';
        if ($('pm-bio-counter')) $('pm-bio-counter').textContent = ($('pm-bio').innerText.length) + '/150';
      }
    }
  }).catch(() => { });
}

async function loadSessions() {
  const list = $('sessions-list');
  list.innerHTML = '<div style="display:flex;justify-content:center;padding:12px"><div class="loader" style="width:24px;height:24px;border-width:2px"></div></div>';
  const res = await api('sessions');
  if (!res.ok) { list.innerHTML = '<div style="color:var(--red);font-size:13px;padding:12px">Ошибка загрузки сессий</div>'; return; }
  list.innerHTML = '';

  // Device type detection
  function deviceType(device) {
    const d = (device || '').toLowerCase();
    if (/iphone|android|mobile|ipad|tablet/.test(d)) return 'phone';
    if (/browser|chrome|firefox|safari|edge|web|opera/.test(d)) return 'web';
    return 'desktop';
  }

  // SVG icons per device type
  const icons = {
    desktop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
    phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>',
    web: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>'
  };

  res.sessions.forEach(s => {
    const type = deviceType(s.device);
    const el = document.createElement('div');
    el.className = 'tg-session-item';
    el.style.transition = 'opacity .2s';

    const metaText = s.is_current
      ? '<span class="tg-session-active-text">Активна сейчас</span>'
      : esc(fmtDate(s.last_active));

    el.innerHTML =
      `<div class="tg-session-icon tg-session-icon-${type}">${icons[type]}</div>` +
      `<div class="tg-session-info">` +
        `<div class="tg-session-name">${esc(s.device)}</div>` +
        `<div class="tg-session-meta">` +
          `<span class="sess-ip-spoiler" data-ip="${esc(s.ip)}">Скрытый</span>` +
          ` • ${metaText}` +
        `</div>` +
      `</div>` +
      `<div class="tg-session-actions">` +
        (s.is_current
          ? '<div class="tg-session-active-dot" title="Активна"></div>'
          : '<button class="tg-session-term" title="Завершить сеанс"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>'
        ) +
      `</div>`;

    // IP spoiler toggle
    const spoiler = el.querySelector('.sess-ip-spoiler');
    spoiler.addEventListener('click', function() {
      if (this.textContent === 'Скрытый') {
        this.textContent = this.dataset.ip;
        this.style.opacity = '1';
        this.style.textDecoration = 'none';
      } else {
        this.textContent = 'Скрытый';
        this.style.opacity = '';
        this.style.textDecoration = '';
      }
    });

    // Terminate button handler
    if (!s.is_current) {
      const termBtn = el.querySelector('.tg-session-term');
      if (termBtn) {
        termBtn.onclick = async (e) => {
          e.stopPropagation();
          if (!confirm('Завершить этот сеанс?')) return;
          const dr = await api('sessions', 'DELETE', { session_id: s.id });
          if (dr.ok) { el.style.opacity = '0'; setTimeout(() => el.remove(), 200); } else toast('Ошибка', 'err');
        };
      }
    }

    list.appendChild(el);
  });
}

$('btn-link-device').onclick = () => openLinkDeviceModal();


/* ══ REACTION STRIP: overscroll → full emoji picker ══════════ */
(function initRxnBarOverscroll() {
  const bar = $('ctx-rxn-bar');
  if (!bar) return;

  function openFullPicker() {
    document.getElementById('ctx-rxn-more')?.click();
  }

  // Wheel: when scrolled to end and user keeps going → open picker
  let _wxDebounce = 0;
  bar.addEventListener('wheel', e => {
    const atEnd = bar.scrollLeft + bar.clientWidth >= bar.scrollWidth - 4;
    if (!atEnd) return;
    if (e.deltaX > 0 || e.deltaY > 0) {
      e.preventDefault();
      bar.style.transition = 'transform .12s var(--ease)';
      bar.style.transform = 'translateX(-10px)';
      clearTimeout(_wxDebounce);
      _wxDebounce = setTimeout(() => {
        bar.style.transform = '';
        openFullPicker();
      }, 130);
    }
  }, { passive: false });

  // Touch: detect swipe-past-end (rubber-band + threshold)
  let _txStart = 0, _txLast = 0, _txPull = 0;
  bar.addEventListener('touchstart', e => {
    _txStart = e.touches[0].clientX;
    _txLast = _txStart;
    _txPull = 0;
    bar.style.transition = '';
  }, { passive: true });
  bar.addEventListener('touchmove', e => {
    const x = e.touches[0].clientX;
    const dx = _txLast - x; // positive = swipe left
    _txLast = x;
    const atEnd = bar.scrollLeft + bar.clientWidth >= bar.scrollWidth - 4;
    if (atEnd && dx > 0) {
      _txPull = Math.min(22, _txPull + dx * 0.45);
      bar.style.transform = `translateX(-${_txPull}px)`;
    }
  }, { passive: true });
  bar.addEventListener('touchend', () => {
    const pull = _txPull;
    _txPull = 0;
    bar.style.transition = 'transform .22s var(--sp)';
    bar.style.transform = '';
    if (pull >= 14) {
      setTimeout(openFullPicker, 160);
    }
  }, { passive: true });
})();
function closeProfile() {
  $('sb-profile-panel').classList.remove('open');
  // Reset all sub-views instantly so next open always starts at main page
  if (_stActiveSub) {
    _stActiveSub.classList.add('anim-none');
    $('st-view-main').classList.add('anim-none');
    _stActiveSub.classList.remove('active');
    $('st-view-main').classList.remove('shifted');
    _stActiveSub.style.transform = '';
    $('st-view-main').style.transform = '';
    const _sub = _stActiveSub;
    _stActiveSub = null;
    setTimeout(() => {
      _sub.classList.remove('anim-none');
      $('st-view-main').classList.remove('anim-none');
    }, 20);
  }
}

/* ── SETTINGS VIEWS NAVIGATION & SWIPE ── */
let _stActiveSub = null;
let _stTouchStartX = 0;
let _stTouchCurrentX = 0;
let _stIsSwiping = false;

document.querySelectorAll('.st-nav-btn[data-goto], .tg-row[data-goto]').forEach(btn => {
  btn.onclick = () => {
    const target = $(btn.dataset.goto);
    if (!target) return;
    _stActiveSub = target;
    target.classList.remove('anim-none');
    $('st-view-main').classList.remove('anim-none');
    $('st-view-main').classList.add('shifted');
    target.classList.add('active');
  };
});

document.querySelectorAll('.st-sub-back, .st-sub-save').forEach(btn => {
  if (btn.id !== 'btn-savepm') {
    btn.onclick = () => closeSettingsSubView();
  }
});

function closeSettingsSubView() {
  if (!_stActiveSub) return;
  _stActiveSub.classList.remove('anim-none');
  $('st-view-main').classList.remove('anim-none');
  _stActiveSub.style.transform = '';
  $('st-view-main').style.transform = '';
  _stActiveSub.classList.remove('active');
  $('st-view-main').classList.remove('shifted');
  setTimeout(() => { _stActiveSub = null; }, 350);
}

document.querySelectorAll('.sb-settings-view.st-sub').forEach(view => {
  view.addEventListener('touchstart', e => {
    if (e.touches[0].clientX > 40) return;
    _stIsSwiping = true;
    _stTouchStartX = e.touches[0].clientX;
    view.classList.add('anim-none');
    $('st-view-main').classList.add('anim-none');
  }, { passive: true });

  view.addEventListener('touchmove', e => {
    if (!_stIsSwiping) return;
    _stTouchCurrentX = Math.max(0, e.touches[0].clientX - _stTouchStartX);
    const progress = _stTouchCurrentX / window.innerWidth;
    view.style.transform = `translateX(${_stTouchCurrentX}px)`;
    $('st-view-main').style.transform = `translateX(-${30 * (1 - progress)}%)`;
  }, { passive: true });

  view.addEventListener('touchend', e => {
    if (!_stIsSwiping) return;
    _stIsSwiping = false;
    view.classList.remove('anim-none');
    $('st-view-main').classList.remove('anim-none');
    if (_stTouchCurrentX > window.innerWidth / 3) {
      closeSettingsSubView();
    } else {
      view.style.transform = '';
      $('st-view-main').style.transform = '';
    }
    _stTouchStartX = 0; _stTouchCurrentX = 0;
  });
});

$('prof-row').onclick = openProfile;
$('sb-prof-back').onclick = closeProfile;
if ($('tg-hero-info-wrap')) $('tg-hero-info-wrap').onclick = openSelfModal;

/* ── BG PATTERN TOGGLE ────────────────────────────────── */
const BG_PAT_KEY = 'sg_bg_pattern';
const _bgPatEl = $('tog-bg-pattern');
function _applyBgPattern(on) {
  const chatArea = $('msgs');
  if (!chatArea) return;
  if (on) chatArea.style.backgroundImage = 'radial-gradient(rgba(255,255,255,.03) 1px, transparent 1px)';
  else chatArea.style.backgroundImage = '';
  if (chatArea.style.backgroundImage) chatArea.style.backgroundSize = '20px 20px';
}
const _bgPatOn = (() => { try { return localStorage.getItem(BG_PAT_KEY) === '1'; } catch { return false; } })();
if (_bgPatEl) { _bgPatEl.classList.toggle('on', _bgPatOn); _applyBgPattern(_bgPatOn); }
if (_bgPatEl) _bgPatEl.onclick = () => {
  const on = !_bgPatEl.classList.contains('on');
  _bgPatEl.classList.toggle('on', on);
  _applyBgPattern(on);
  try { localStorage.setItem(BG_PAT_KEY, on ? '1' : '0'); } catch { }
};

/* ── CUSTOM CHAT BACKGROUND IMAGE ───────────────────────── */
const BG_IMG_KEY = 'sg_chat_bg_image';
const BG_IMG_EL_ID = 'chat-bg-custom';
const _bgImgInput = $('bg-image-input');
const _bgImgUpload = $('btn-bg-upload');
const _bgImgRemove = $('btn-bg-remove');
const _bgImgStatus = $('bg-image-status');

function _applyCustomBg(dataUrl) {
  let el = document.getElementById(BG_IMG_EL_ID);
  const layout = document.querySelector('.layout');
  if (dataUrl) {
    // Show custom bg, hide pattern
    if (!el) {
      el = document.createElement('div');
      el.id = BG_IMG_EL_ID;
      el.className = 'chat-bg-custom';
      const chatArea = document.querySelector('.chat-area') || document.getElementById('active-chat');
      if (chatArea) chatArea.prepend(el);
    }
    el.style.backgroundImage = `url(${dataUrl})`;
    // Also apply to layout so background is visible behind sidebar
    if (layout) {
      layout.style.backgroundImage = `url(${dataUrl})`;
      layout.style.backgroundSize = 'cover';
      layout.style.backgroundPosition = 'center';
    }
    document.body.classList.add('no-pattern');
    if (_bgImgRemove) _bgImgRemove.style.display = '';
    if (_bgImgStatus) _bgImgStatus.textContent = 'Установлено';
  } else {
    if (el) el.remove();
    if (layout) {
      layout.style.backgroundImage = '';
      layout.style.backgroundSize = '';
      layout.style.backgroundPosition = '';
    }
    document.body.classList.remove('no-pattern');
    if (_bgImgRemove) _bgImgRemove.style.display = 'none';
    if (_bgImgStatus) _bgImgStatus.textContent = 'Не установлено';
  }
}

// Restore cached background on load
try {
  const cached = localStorage.getItem(BG_IMG_KEY);
  if (cached) _applyCustomBg(cached);
} catch {}

if (_bgImgUpload && _bgImgInput) {
  _bgImgUpload.onclick = () => _bgImgInput.click();
  _bgImgInput.onchange = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { /* 5MB limit — warn user */ return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      // Resize to max 1920px to save localStorage space
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX = 1920;
        let w = img.width, h = img.height;
        if (w > MAX || h > MAX) {
          if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
          else { w = Math.round(w * MAX / h); h = MAX; }
        }
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        try { localStorage.setItem(BG_IMG_KEY, dataUrl); } catch { /* storage full */ }
        _applyCustomBg(dataUrl);
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
    _bgImgInput.value = '';
  };
}
if (_bgImgRemove) {
  _bgImgRemove.onclick = () => {
    try { localStorage.removeItem(BG_IMG_KEY); } catch {}
    _applyCustomBg(null);
  };
}

/* ── Show install separator when install button is visible ─ */
const _installObserver = new MutationObserver(() => {
  const pwa = $('btn-install-pwa');
  const sep = $('install-sep');
  if (pwa && sep) sep.style.display = pwa.style.display === 'none' ? 'none' : '';
});
const _pwaBtn = $('btn-install-pwa');
if (_pwaBtn) _installObserver.observe(_pwaBtn, { attributes: true, attributeFilter: ['style'] });

// Live-update hero display fields while typing + Trigger save button
['pm-name', 'pm-sid', 'pm-bio'].forEach(id => {
  const el = $(id); if (!el) return;
  el.addEventListener('input', () => {
    if (id === 'pm-sid') {
      const oldVal = el.value;
      const newVal = oldVal.replace(/[^a-zA-Z0-9_]/g, '');
      if (oldVal !== newVal) {
        const diff = oldVal.length - newVal.length;
        const start = Math.max(0, el.selectionStart - diff);
        el.value = newVal;
        el.setSelectionRange(start, start);
      }
    }
    const ds = $('pm-display-sid');
      if (id === 'pm-name') { 
        // Убираем невидимые, RTL-символы, множественные пробелы и пробелы в начале
        let val = el.value.replace(/[\u200B-\u200D\uFEFF\u202A-\u202E]/g, '').replace(/\s{2,}/g, ' ').replace(/^\s+/, '');
        if (el.value !== val) {
          const pos = Math.max(0, el.selectionStart - (el.value.length - val.length));
          el.value = val;
          el.setSelectionRange(pos, pos);
        }
        if (S.user) _updateHeroNameUI(S.user, val); 
      }
    if (id === 'pm-sid' && ds) { const v = $('pm-sid').value; ds.textContent = v ? '@' + v : ''; }
    if (id === 'pm-bio') {
      const cnt = $('pm-bio-counter'); if (cnt) cnt.textContent = el.innerText.length + '/150';
    }
    _checkProfileChanges();
  });
});


// Notification toggles
$('tog-notif').onclick = async () => {
  if (!S.notif.enabled) {
    // Unlock audio as part of the same gesture
    _unlockAudio();
    if (!('Notification' in window)) { toast('Браузер не поддерживает уведомления', 'err'); return; }
    if (Notification.permission === 'denied') {
      toast('Уведомления заблокированы в настройках браузера — разрешите вручную', 'err'); return;
    }
    const granted = await requestNotifPermission();
    if (!granted) { toast('Разрешите уведомления в браузере', 'err'); return; }
    S.notif.enabled = true;
    toast('Уведомления включены', 'ok');
  } else {
    S.notif.enabled = false;
    toast('Уведомления выключены');
  }
  saveNotif(); syncNotifUI();
};
$('tog-sound').onclick = () => { S.notif.sound = !S.notif.sound; saveNotif(); syncNotifUI(); };
$('tog-anon').onclick = () => { S.notif.anon = !S.notif.anon; saveNotif(); syncNotifUI(); };

function syncEnterUI() {
  const es = S.enterSend;
  $('tog-enter-send').classList.toggle('on', es);
  $('tog-ctrl-enter-send').classList.toggle('on', !es);
  if($('tog-quick-reply')) $('tog-quick-reply').classList.toggle('on', S.quickReply);
}
function saveEnterSend() {
  localStorage.setItem('sg_enter_send', S.enterSend ? 'true' : 'false');
}
$('tog-enter-send').onclick = () => {
  S.enterSend = true; saveEnterSend(); syncEnterUI();
};
$('tog-ctrl-enter-send').onclick = () => {
  S.enterSend = false; saveEnterSend(); syncEnterUI();
};
$('tog-quick-reply').onclick = () => {
  S.quickReply = !S.quickReply;
  localStorage.setItem('sg_quick_reply', S.quickReply ? 'true' : 'false');
  syncEnterUI();
};

$('btn-savepm').onclick = async () => {
  const nickname = $('pm-name').value.trim(), signal_id = $('pm-sid').value.trim().toLowerCase();
  const bio = $('pm-bio').innerHTML.trim();
  $('e-pm').classList.remove('on');
  if (!nickname || !signal_id) { $('e-pm').textContent = 'Заполните все поля'; $('e-pm').classList.add('on'); return; }
  const btn = $('btn-savepm'); btn.disabled = true; btn.classList.add('sp');
  const res = await api('update_profile', 'POST', { nickname, signal_id, bio, avatar_url: S.user.avatar_url || '' });
  btn.disabled = false; btn.classList.remove('sp');
  if (res.ok) {
    S.user = res.user; localStorage.setItem('sg_user', JSON.stringify(res.user));
    updateFooter(); toast('Сохранено', 'ok');
    _checkProfileChanges();
    closeSettingsSubView();
  }
  else { $('e-pm').textContent = res.message || 'Ошибка'; $('e-pm').classList.add('on'); }
};
function _initAvatarCrop() {
  const aviIn = $('avi-in');
  if (!aviIn) return;

  aviIn.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    _cropFile = file;
    _cropImg = new Image();
    _cropImg.onload = () => {
      openMod('modal-crop');
      const skipBtn = $('btn-crop-skip');
      if (skipBtn) {
        skipBtn.style.display = (file.type === 'image/gif') ? 'block' : 'none';
        skipBtn.textContent = (file.type === 'image/gif') ? 'Оставить оригинал (Анимация)' : 'Оставить оригинал';
      }
      const canvas = $('crop-canvas');
      const dpr = window.devicePixelRatio || 1;
      canvas.width = 512 * dpr; canvas.height = 512 * dpr;
      _cropScale = Math.max(512 / _cropImg.width, 512 / _cropImg.height);
      _cropPanX = (512 - (_cropImg.width * _cropScale)) / 2;
      _cropPanY = (512 - (_cropImg.height * _cropScale)) / 2;
      _drawCrop();
    };
    _cropImg.src = URL.createObjectURL(file);
  };
}

let _cropFile = null, _cropImg = null, _cropScale = 1, _cropPanX = 0, _cropPanY = 0;
let _cropIsDown = false, _cropStartX = 0, _cropStartY = 0, _cropInitX = 0, _cropInitY = 0;
let _cropDist = 0, _cropLastScale = 1;

function _drawCrop() {
  const canvas = $('crop-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const size = 512;

  if (canvas.width !== size * dpr) {
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);
  }

  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#1c1c1d'; ctx.fillRect(0, 0, size, size);

  if (_cropImg) {
    ctx.drawImage(_cropImg, _cropPanX, _cropPanY, _cropImg.width * _cropScale, _cropImg.height * _cropScale);
  }
}

const _ca = $('crop-area');
if (_ca) {
  function _getDist(t) { return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY); }

  function _crpDown(cx, cy) {
    _cropIsDown = true;
    _cropStartX = cx; _cropStartY = cy;
    _cropInitX = _cropPanX; _cropInitY = _cropPanY;
  }

  function _crpMove(cx, cy) {
    if (!_cropIsDown) return;
    const rect = _ca.getBoundingClientRect();
    const ratio = 512 / rect.width;
    _cropPanX = _cropInitX + (cx - _cropStartX) * ratio;
    _cropPanY = _cropInitY + (cy - _cropStartY) * ratio;
    _constrainCrop();
    _drawCrop();
  }

  function _constrainCrop() {
    if (!_cropImg) return;
    const minS = Math.max(512 / _cropImg.width, 512 / _cropImg.height);
    if (_cropScale < minS) _cropScale = minS;

    const minX = 512 - (_cropImg.width * _cropScale);
    const minY = 512 - (_cropImg.height * _cropScale);

    if (_cropPanX > 0) _cropPanX = 0;
    if (_cropPanX < minX) _cropPanX = minX;
    if (_cropPanY > 0) _cropPanY = 0;
    if (_cropPanY < minY) _cropPanY = minY;

    // If image is smaller than 512 (shouldn't happen with minS, but for safety)
    if (minX > 0) _cropPanX = minX / 2;
    if (minY > 0) _cropPanY = minY / 2;
  }

  function _zoomCrop(delta, cx, cy) {
    const rect = _ca.getBoundingClientRect();
    const ratio = 512 / rect.width;
    // Mouse coords relative to canvas
    const mx = (cx - rect.left) * ratio;
    const my = (cy - rect.top) * ratio;

    const oldS = _cropScale;
    _cropScale *= delta;

    const minS = Math.max(512 / _cropImg.width, 512 / _cropImg.height);
    if (_cropScale < minS) _cropScale = minS;
    if (_cropScale > 5) _cropScale = 5;

    // Adjust pan to zoom towards point (mx, my)
    _cropPanX = mx - (mx - _cropPanX) * (_cropScale / oldS);
    _cropPanY = my - (my - _cropPanY) * (_cropScale / oldS);

    _constrainCrop();
    _drawCrop();
  }

  _ca.addEventListener('mousedown', e => _crpDown(e.clientX, e.clientY));
  window.addEventListener('mousemove', e => _crpMove(e.clientX, e.clientY));
  window.addEventListener('mouseup', () => _cropIsDown = false);

  _ca.addEventListener('touchstart', e => {
    if (e.touches.length === 1) {
      _crpDown(e.touches[0].clientX, e.touches[0].clientY);
    } else if (e.touches.length === 2) {
      _cropIsDown = false;
      _cropDist = _getDist(e.touches);
      _cropLastScale = _cropScale;
    }
  }, { passive: false });

  _ca.addEventListener('touchmove', e => {
    e.preventDefault();
    if (e.touches.length === 1 && _cropIsDown) {
      _crpMove(e.touches[0].clientX, e.touches[0].clientY);
    } else if (e.touches.length === 2) {
      const d = _getDist(e.touches);
      const ratio = d / _cropDist;
      const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      _zoomCrop(ratio / (_cropScale / _cropLastScale), midX, midY);
    }
  }, { passive: false });

  window.addEventListener('touchend', () => _cropIsDown = false);

  _ca.addEventListener('wheel', e => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 1.1 : 0.9;
    _zoomCrop(delta, e.clientX, e.clientY);
  }, { passive: false });
}

if ($('btn-crop-cancel')) $('btn-crop-cancel').onclick = () => closeMod('modal-crop');
if ($('btn-crop-skip')) $('btn-crop-skip').onclick = () => { closeMod('modal-crop'); if (_cropFile) _uploadAvatarBlob(_cropFile); };
if ($('btn-crop-apply')) $('btn-crop-apply').onclick = () => {
  closeMod('modal-crop');
  $('crop-canvas').toBlob(b => { if (b) { b.name = _cropFile ? _cropFile.name.replace(/\.[^/.]+$/, ".jpg") : 'avatar.jpg'; _uploadAvatarBlob(b); } }, 'image/jpeg', 0.9);
};

async function _uploadAvatarBlob(blob) {
  const btn = $('btn-savepm'); if (btn) btn.disabled = true;
  toast('Загрузка…');
  const fd = new FormData(); fd.append('avatar', blob, blob.name || 'avatar.gif');
  const res = await api('upload_avatar', 'POST', fd, true);
  if (btn) btn.disabled = false;
  if (res.ok) {
    S.user = res.user; localStorage.setItem('sg_user', JSON.stringify(res.user));
    $('pm-av').innerHTML = aviHtml(S.user.nickname || S.user.email, res.avatar_url);
    applyBlurredAvatarBg('tg-hero-bg', S.user.nickname || S.user.email, res.avatar_url);
    updateFooter(); toast('Фото обновлено', 'ok');
  } else toast(res.message || 'Ошибка', 'err');
}

_initAvatarCrop();
if ($('btn-logout')) $('btn-logout').onclick = () => { if (confirm('Выйти?')) logout(); };

/* ══ SPLASH ═══════════════════════════════════════════════════ */
function hideSplash() {
  const sp = $('splash'); if (!sp || sp.classList.contains('hiding')) return;
  sp.classList.add('hiding');
  sp.addEventListener('transitionend', () => { sp.classList.add('gone'); }, { once: true });
}

/* ══ BOOT ════════════════════════════════════════════════════ */
// Minimum splash display so the animation is always visible
const _splashMin = 800; // ms
const _splashStart = Date.now();
let _splashProgress = 0;

function _updateSplash(pct) {
  if (pct > _splashProgress) _splashProgress = pct;
  const el = $('splash-name-fill');
  if (el) el.style.width = _splashProgress + '%';
}

// Simulate progress steps while waiting for DOM/network
_updateSplash(15);
const _fakeProgress = setInterval(() => {
  if (_splashProgress < 85) _updateSplash(_splashProgress + (Math.random() * 10 + 5));
}, 100);

let _booted = false;
function _boot() {
  if (_booted) return;
  _booted = true;
  _updateSplash(90);
  const elapsed = Date.now() - _splashStart;
  const delay = Math.max(0, _splashMin - elapsed);
  setTimeout(() => {
    clearInterval(_fakeProgress);
    _updateSplash(100);
    setTimeout(() => {
      if (S.token && S.user) {
        showScr('scr-app'); updateFooter();
        if (S.chats && S.chats.length) renderChats('');
        // Restore last open chat after network chats load
        const _lastChatId = parseInt(localStorage.getItem('sg_last_chat') || '0', 10) || null;
        loadChats().then(() => { if (_lastChatId) { const c = (S.chats || []).find(x => x.chat_id === _lastChatId); if (c) openChat(c); } }); 
        startPoll(); startGlobalSSE(); syncNotifUI();
        requestAnimationFrame(() => { const el = $('sb-title'); if (el) el.textContent = 'Сообщения'; });
      } else {
        showScr('scr-auth');
        restoreAuthState();
      }
      hideSplash();
    }, 250); // Ждём 250ms, чтобы прогресс-бар плавно дошёл до 100% визуально
  }, delay);
}

// Дожидаемся загрузки абсолютно всех ресурсов (картинок, стилей, шрифтов)
const _waitLoad = new Promise(resolve => {
  if (document.readyState === 'complete') resolve();
  else window.addEventListener('load', resolve, { once: true });
});
const _waitFonts = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();

Promise.all([_waitLoad, _waitFonts]).then(() => {
  _updateSplash(85);
  _boot();
}).catch(_boot);

// Резервный таймаут (5 секунд), чтобы пользователь гарантированно зашел в приложение,
// даже если загрузка какого-то некритичного ресурса зависла из-за сети.
setTimeout(_boot, 5000);

/* ══ PWA INSTALL ══════════════════════════════════════════════ */
let deferredPrompt;
const _isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
const _isStandalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;

// Show install button for iOS if not standalone
if (_isIOS && !_isStandalone) {
  const installBtn = $('btn-install-pwa');
  if (installBtn) {
    installBtn.style.display = 'flex';
    installBtn.onclick = () => {
      toast('Нажмите "Поделиться" и выберите "На экран «Домой»"', 'info');
    };
  }
}

window.addEventListener('beforeinstallprompt', (e) => {
  deferredPrompt = e;
  const installBtn = $('btn-install-pwa');
  if (installBtn) {
    e.preventDefault();
    installBtn.style.display = 'flex';
    installBtn.onclick = async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        installBtn.style.display = 'none';
      }
      deferredPrompt = null;
    };
  }
});

window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  const installBtn = $('btn-install-pwa');
  if (installBtn) installBtn.style.display = 'none';
});

/* ══ CROSS-SESSION AVATAR SYNC ════════════════════════════════ */
// Periodically re-fetch own profile to pick up avatar changes
// made on other devices/sessions (e.g. phone → desktop sync)
async function _syncMyProfile() {
  if (!S.token || !S.user) return;
  try {
    const res = await api('get_me', 'GET');
    if (!res.ok || !res.user) return;
    const newUrl = res.user.avatar_url || null;
    const oldUrl = S.user.avatar_url || null;
    if (newUrl !== oldUrl) {
      // Update state and cache
      S.user = { ...S.user, ...res.user };
      localStorage.setItem('sg_user', JSON.stringify(S.user));
      // Update avatar everywhere in the UI
      const avInMsg = (url, nick) => aviHtml(nick, url);
      // Profile panel avatar
      const pmAv = $('pm-av');
      if (pmAv) pmAv.innerHTML = aviHtml(S.user.nickname || S.user.email, newUrl);
      applyBlurredAvatarBg('tg-hero-bg', S.user.nickname || S.user.email, newUrl);
      _updateHeroNameUI(S.user);
      // Footer avatar
      updateFooter();
      // Refresh own messages avatar in chat
      const myId = S.user.id;
      document.querySelectorAll(`.mavi.ghost, .mrow.me .mavi`).forEach(el => {
        const inner = el.querySelector('.av-img');
        if (inner) inner.innerHTML = aviHtml(S.user.nickname, newUrl, true);
      });
    }
  } catch (e) { /* silently ignore */ }
}

// Start syncing 10s after boot, then every 60s
setTimeout(() => {
  _syncMyProfile();
  setInterval(_syncMyProfile, 60_000);
}, 10_000);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', event => {
    if (event.data?.type === 'FCM_MSG') {
      if (window.pollNow) pollNow();
    } else if (event.data?.type === 'FCM_CALL') {
      if (window.pollCallSignals) window.pollCallSignals();
    }
  });
}
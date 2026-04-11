/* ══ MESSAGES — Загрузка · Рендер · Отправка · Реакции · Контекстные меню · Редактирование ══ */

/* ══ LINK PREVIEW ════════════════════════════════════════════ */
// sessionStorage cache so previews survive in-session nav but not reload spam
const _lpCache = new Map();

function _lpGet(url) {
  if (_lpCache.has(url)) return _lpCache.get(url);
  try {
    const v = sessionStorage.getItem('lp_' + url);
    if (v) { const d = JSON.parse(v); _lpCache.set(url, d); return d; }
  } catch {}
  return null;
}
function _lpSet(url, data) {
  _lpCache.set(url, data);
  try { sessionStorage.setItem('lp_' + url, JSON.stringify(data)); } catch {}
}

async function fetchLinkPreview(url) {
  const cached = _lpGet(url);
  if (cached !== null) return cached;
  try {
    const res = await api('link_preview?url=' + encodeURIComponent(url));
    const data = res.ok ? res : false;
    _lpSet(url, data);
    return data;
  } catch { return false; }
}

/* ── Иконки сервисов для embed-превью ── */
const _LP_ICONS = {
  youtube:    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21.8 8s-.2-1.4-.8-2a2.9 2.9 0 0 0-2-.8C17.1 5 12 5 12 5s-5.1 0-7 .2a2.9 2.9 0 0 0-2 .8C2.4 6.6 2.2 8 2.2 8S2 9.6 2 11.2v1.5c0 1.6.2 3.2.2 3.2s.2 1.4.8 2c.7.7 1.6.7 2 .8C6.4 19 12 19 12 19s5.1 0 7-.2a2.9 2.9 0 0 0 2-.8c.6-.6.8-2 .8-2s.2-1.6.2-3.2v-1.5C22 9.6 21.8 8 21.8 8zM9.8 14.6V9.4l5.4 2.6-5.4 2.6z"/></svg>',
  spotify:    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2zm4.6 14.4a.6.6 0 0 1-.84.2c-2.3-1.4-5.2-1.7-8.6-.95a.6.6 0 1 1-.27-1.17c3.73-.85 6.93-.49 9.51 1.09a.6.6 0 0 1 .2.83zm1.22-2.72a.76.76 0 0 1-1.05.25c-2.64-1.62-6.66-2.1-9.78-1.14a.76.76 0 0 1-.44-1.45c3.56-1.08 7.98-.56 11 1.29a.76.76 0 0 1 .27 1.05zm.1-2.84c-3.16-1.88-8.37-2.05-11.38-1.13a.92.92 0 1 1-.53-1.75c3.46-1.05 9.2-.85 12.83 1.3a.92.92 0 0 1-.92 1.58z"/></svg>',
  vimeo:      '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M23 7.1c-.1 2.4-1.8 5.7-5 9.9C14.7 21.4 11.9 23 9.6 23c-1.4 0-2.5-1.3-3.5-3.8L4.3 13c-.7-2.5-1.4-3.8-2.3-3.8-.2 0-.8.4-1.9 1.1L0 9.2c1.2-1 2.3-2.1 3.1-2.9C4.5 5.1 5.6 4.5 6.3 4.4c1.7-.2 2.7.9 3 3.3l1.4 8.5c.4 2.5.9 3.8 1.5 3.8.4 0 1.1-.6 2-1.9 1-.9 1.5-1.9 1.6-2.7.1-1-.3-1.5-1.3-1.5-.5 0-.9.1-1.4.3.9-3 2.7-4.5 5.3-4.4 1.9.1 2.8 1.3 2.6 3.3z"/></svg>',
  soundcloud: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.56 8.87V17h8.76c1.5 0 1.68-2.22.42-2.67.33-2.3-1.86-3.92-3.82-2.88C16.16 9.1 13.93 7.5 11.56 8.87zM0 15.33C0 16.8 1.2 18 2.67 18S5.33 16.8 5.33 15.33V12.5C4.62 11.18 3.41 10.4 2.67 10.4 1.2 10.4 0 11.6 0 13.07v2.26zm6.4 1.33c0 .74.6 1.34 1.33 1.34.74 0 1.34-.6 1.34-1.34V9.87C8.33 8.13 7.7 7 6.93 6.67 6.07 7 5.6 7.87 5.6 9.2l.8 7.46z"/></svg>',
  twitch:     '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.64 5.93h1.43v4.28h-1.43m3.93-4.28H17v4.28h-1.43M7 2L3.43 5.57v12.86h4.28V22l3.58-3.57h2.85L20.57 12V2m-1.43 9.29-2.85 2.85h-2.86l-2.5 2.5v-2.5H7.71V3.43h11.43z"/></svg>',
};

/* ── Определяем embed-тип по домену (клиентская сторона) ── */
function _lpEmbedType(data) {
  return data.embed_type || null;
}

/* ── Строит shimmer-обёртку для картинки превью ── */
function _buildLpImg(src, isVideo) {
  const wrap = document.createElement('div');
  wrap.className = 'lp-img-wrap';

  // Shimmer пока грузится картинка
  const shimmer = document.createElement('div');
  shimmer.className = 'lp-img-shimmer';
  wrap.appendChild(shimmer);

  const img = document.createElement('img');
  img.className = 'lp-img lp-img-loading';
  img.alt = '';
  img.decoding = 'async';
  img.src = src;

  const onLoad = () => {
    img.classList.remove('lp-img-loading');
    shimmer.classList.add('lp-shimmer-done');
    setTimeout(() => shimmer.remove(), 300);
  };
  const onErr = () => { wrap.remove(); };

  if (img.complete && img.naturalWidth) { onLoad(); }
  else {
    img.addEventListener('load', onLoad, { once: true });
    img.addEventListener('error', onErr, { once: true });
  }
  wrap.appendChild(img);

  // Кнопка Play для видео
  if (isVideo) {
    const play = document.createElement('div');
    play.className = 'lp-play-btn';
    play.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
    wrap.appendChild(play);
  }

  return wrap;
}

function buildPreviewCard(data, url) {
  const embedType = _lpEmbedType(data);
  const isVideo = embedType === 'youtube' || embedType === 'vimeo' || embedType === 'twitch';
  const isAudio = embedType === 'spotify' || embedType === 'soundcloud';

  const card = document.createElement('a');
  card.className = 'link-preview' + (embedType ? ' lp-embed lp-' + embedType : '');
  card.href = data.url || url;
  card.target = '_blank';
  card.rel = 'noopener noreferrer';
  if (embedType) card.dataset.embedType = embedType;

  // Картинка с shimmer
  if (data.image) {
    card.appendChild(_buildLpImg(data.image, isVideo));
  }

  const body = document.createElement('div');
  body.className = 'lp-body';

  // Строка сервиса (иконка + домен)
  const domainRow = document.createElement('div');
  domainRow.className = 'lp-domain';
  const iconSvg = _LP_ICONS[embedType];
  if (iconSvg) {
    const iconWrap = document.createElement('span');
    iconWrap.className = 'lp-service-icon';
    iconWrap.innerHTML = iconSvg;
    domainRow.appendChild(iconWrap);
  }
  const domainTxt = document.createElement('span');
  domainTxt.textContent = data.site_name || data.domain || new URL(data.url || url).hostname;
  domainRow.appendChild(domainTxt);
  body.appendChild(domainRow);

  if (data.title) {
    const title = document.createElement('div');
    title.className = 'lp-title';
    title.textContent = data.title;
    body.appendChild(title);
  }
  if (data.description) {
    const desc = document.createElement('div');
    desc.className = 'lp-desc';
    desc.textContent = data.description;
    body.appendChild(desc);
  }

  // Для аудио — мини-плеер бейдж
  if (isAudio) {
    const badge = document.createElement('div');
    badge.className = 'lp-audio-badge';
    badge.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><polygon points="5 3 19 12 5 21 5 3"/></svg><span>Слушать</span>';
    body.appendChild(badge);
  }

  card.appendChild(body);
  return card;
}

// Called after a message element is appended to the DOM.
// Detects the first link in the message body and replaces the placeholder with a preview card.
function attachLinkPreview(mbodyEl, body) {
  if (!body) return;
  // Only for text messages (not media-only)
  if (mbodyEl.classList.contains('media-only')) return;
  // Extract first https?:// URL from raw body text
  const m = body.match(/https?:\/\/[^\s<>"'\x00-\x1f\u200B]+/);
  if (!m) return;
  const url = m[0].replace(/[.,!?;:]+$/, '');

  // Placeholder keeps layout from jumping
  const ph = document.createElement('div');
  ph.className = 'lp-placeholder';
  mbodyEl.appendChild(ph);

  fetchLinkPreview(url).then(data => {
    ph.remove();
    if (!data || (!data.title && !data.description)) return;
    mbodyEl.appendChild(buildPreviewCard(data, url));
  });
}


/* ══ CLIENT-SIDE THUMBNAIL ═══════════════════════════════════
   Сжимает изображение на клиенте через Canvas перед показом в чате.
   Оригинальный URL сохраняется для viewer.
   Кеш blob-URL в памяти сессии — повторный рендер не пережимает.
   Возвращает { url, w, h } — w/h нужны для резервирования места ДО загрузки.
   ════════════════════════════════════════════════════════════ */
const _thumbCache = new Map(); // originalUrl → { url, w, h }
const THUMB_MAX_PX = 900;
const THUMB_QUALITY = 0.72;

/* ── localStorage-кеш размеров медиа ──────────────────────────
   Ключ: 'sg_mdim_' + url → JSON {w,h}
   Заполняется при первой загрузке (_dimWrite), читается синхронно
   при каждом рендере (_dimRead) — shape медиа известен без async.
*/
const _MDIM_PFX = 'sg_mdim_';
const _MDIM_MAX  = 400;

function _dimRead(url) {
  try {
    const v = localStorage.getItem(_MDIM_PFX + url);
    return v ? JSON.parse(v) : null;
  } catch { return null; }
}

function _dimWrite(url, w, h) {
  if (!w || !h) return;
  try {
    const keys = Object.keys(localStorage).filter(k => k.startsWith(_MDIM_PFX));
    if (keys.length >= _MDIM_MAX) {
      keys.slice(0, keys.length - _MDIM_MAX + 1).forEach(k => localStorage.removeItem(k));
    }
    localStorage.setItem(_MDIM_PFX + url, JSON.stringify({ w, h }));
  } catch {}
}

function _makeThumb(url) {
  if (_thumbCache.has(url)) return Promise.resolve(_thumbCache.get(url));
  return new Promise(resolve => {
    const src = new Image();
    src.crossOrigin = 'anonymous';
    src.onload = () => {
      const { naturalWidth: w, naturalHeight: h } = src;
      _dimWrite(url, w, h); // сохраняем в localStorage сразу
      if (w <= THUMB_MAX_PX && h <= THUMB_MAX_PX) {
        const result = { url, w, h };
        _thumbCache.set(url, result);
        resolve(result);
        return;
      }
      const scale = THUMB_MAX_PX / Math.max(w, h);
      const tw = Math.round(w * scale);
      const th = Math.round(h * scale);
      const cv = document.createElement('canvas');
      cv.width = tw; cv.height = th;
      cv.getContext('2d').drawImage(src, 0, 0, tw, th);
      cv.toBlob(blob => {
        const blobUrl = blob ? URL.createObjectURL(blob) : url;
        const result = { url: blobUrl, w, h };
        _thumbCache.set(url, result);
        resolve(result);
      }, 'image/jpeg', THUMB_QUALITY);
    };
    src.onerror = () => {
      const result = { url, w: 0, h: 0 };
      _thumbCache.set(url, result);
      resolve(result);
    };
    src.src = url;
  });
}

/* ── Вычисляет отображаемые размеры медиа с сохранением пропорций ──
   Telegram Web K логика: ограничиваем MAX_W×MAX_H, min MIN_W×MIN_H.
   Возвращает { dispW, dispH } в пикселях для CSS.
*/
const MEDIA_MAX_W = 280, MEDIA_MAX_H = 320;
const MEDIA_MIN_W = 80,  MEDIA_MIN_H = 60;

function _calcMediaDims(origW, origH) {
  if (!origW || !origH) return null;
  const ratio = origW / origH;
  let dw = Math.min(origW, MEDIA_MAX_W);
  let dh = dw / ratio;
  if (dh > MEDIA_MAX_H) { dh = MEDIA_MAX_H; dw = dh * ratio; }
  dw = Math.max(Math.round(dw), MEDIA_MIN_W);
  dh = Math.max(Math.round(dh), MEDIA_MIN_H);
  return { dispW: dw, dispH: dh };
}

/* ── Применяет зарезервированные размеры к враперу медиа */
function _reserveMediaSize(wrap, origW, origH) {
  const dims = _calcMediaDims(origW, origH);
  if (!dims) return;
  wrap.style.width  = dims.dispW + 'px';
  wrap.style.aspectRatio = origW + '/' + origH;
  // Снимаем max-height с img — теперь высоту контролирует контейнер
  wrap.dataset.sized = '1';
}

/* ── Плейсхолдер пока размеры неизвестны — держит место в DOM ── */
const THUMB_PLACEHOLDER_W = 220;
const THUMB_PLACEHOLDER_H = 165; // ~4:3

function _applyPlaceholder(wrap) {
  if (wrap.dataset.sized) return; // уже есть реальные размеры
  wrap.style.width       = THUMB_PLACEHOLDER_W + 'px';
  wrap.style.aspectRatio = THUMB_PLACEHOLDER_W + '/' + THUMB_PLACEHOLDER_H;
  wrap.dataset.placeholder = '1';
}

function _upgradePlaceholder(wrap, origW, origH) {
  const dims = _calcMediaDims(origW, origH);
  if (!dims) return;
  delete wrap.dataset.placeholder;
  wrap.style.width       = dims.dispW + 'px';
  wrap.style.aspectRatio = origW + '/' + origH;
  wrap.dataset.sized = '1';
}

/* ── Normalize API message fields to match internal naming ── */
function _normMsg(m){
  if(m.sender_name!==undefined&&m.nickname===undefined)m.nickname=m.sender_name;
  if(m.sender_avatar!==undefined&&m.avatar_url===undefined)m.avatar_url=m.sender_avatar;
  return m;
}
function _normMsgs(arr){arr.forEach(_normMsg);return arr;}

/* ══ FETCH MESSAGES ══════════════════════════════════════════ */
async function fetchMsgs(chatId,init=false){
  if(init){
    S._initializingChat=chatId;
    const hadCache=!!(S.msgs[chatId]?.length);
    const res=await api(`get_messages?chat_id=${chatId}&init=1&limit=50&mark_read=1`);
    S._initializingChat=null;
    if(!res.ok||chatId!==S.chatId)return;

    // Update chats silently — suppress FLIP animation during chat open
    if(res.chats){S.chats=sortChats(res.chats);cacheWriteChats(S.chats);}

    const fresh=_normMsgs(res.messages||[]);
    fresh.forEach(m => { if(m.media_url) m.media_url = getMediaUrl(m.media_url); });
    S.historyEnd = fresh.length < 50; // Обязательно сбрасываем флаг, если история в новом чате длиннее 50
    const prevMsgs=S.msgs[chatId]||[];
    S.lastId[chatId]=fresh.reduce((mx,m)=>Math.max(mx,m.id),0);
    fresh.forEach(m=>{S.rxns[m.id]=Array.isArray(m.reactions)?m.reactions:[];});
    S.msgs[chatId]=fresh;
    
    const minFreshId = fresh.length ? Math.min(...fresh.filter(m => !isTemp(m.id)).map(m => +m.id)) : Infinity;
    const freshIds = new Set(fresh.map(m=>m.id));
    const olderPreserved = prevMsgs.filter(m => !freshIds.has(m.id) && !isTemp(m.id) && +m.id < minFreshId);

    S.msgs[chatId] = [...olderPreserved, ...fresh];
    syncReadState(chatId,res.last_read_id,false);
    cacheWriteMsgs(chatId,fresh);

    const area=$('msgs');
    if(hadCache){
      const oldIds=new Set(prevMsgs.map(m=>m.id));
      const wasAtBot=nearBot();

      // ── TG Web K approach ──────────────────────────────────
      // 1. Удалённые: убираем МГНОВЕННО без анимации схлопывания —
      //    анимация во время init вызывала "дрожание" сетки
      const freshIds=new Set(fresh.map(m=>m.id));
      prevMsgs.forEach(m=>{
        if(!freshIds.has(m.id) && +m.id >= minFreshId){
          const el=area.querySelector(`.mrow[data-id="${m.id}"]`);
          if(el) el.remove(); // instant, no collapse animation
        }
      });

      // ── 2. Собираем новые сообщения в batch-группы ──────────
      // Не используем appendMsg (вызывает replaceWith на сетках → рывок).
      // Сначала строим Set уже существующих batch_id в DOM.
      const domBatches=new Set(
        [...area.querySelectorAll('.mrow[data-batch]')].map(el=>el.dataset.batch)
      );
      const newMsgs=fresh.filter(m=>!oldIds.has(m.id));

      // Группируем новые по batch_id
      const newGroups=groupMsgs(newMsgs);
      newGroups.forEach(g=>{
        if(g.type==='grid'){
          // Если сетка уже в DOM (из кеша) — обновляем её без replaceWith
          const batchId=g.msgs[0].batch_id;
          if(domBatches.has(batchId)){
            // Сетка из кеша уже актуальна — просто патчим отдельные ячейки если нужно
            // (обычно не нужно при init)
            return;
          }
          const rows=area.querySelectorAll('.mrow');
          const lastRow=rows[rows.length-1];
          const newSender=!lastRow||lastRow.dataset.sid!==String(g.msgs[0].sender_id);
          area.appendChild(makeGridEl(g.msgs,newSender));
        } else {
          const m=g.msg;
          // Уже существующие — патчим
          if(oldIds.has(m.id)){ patchMsgDom(m); return; }
          const rows=area.querySelectorAll('.mrow');
          const lastRow=rows[rows.length-1];
          const newSender=!lastRow||lastRow.dataset.sid!==String(m.sender_id);
          area.appendChild(makeMsgEl(m,newSender));
        }
      });

      // ── 3. Патч изменённых старых сообщений ──────────────────
      fresh.forEach(m=>{
        if(!oldIds.has(m.id))return; // уже добавлены выше
        const cur=prevMsgs.find(x=>x.id===m.id);
        if(cur&&(cur.body!==m.body||cur.is_edited!==m.is_edited))patchMsgDom(m);
      });

      applyGroupClasses(area);

      // ── 4. Скролл: только если был внизу ─────────────────────
      if(wasAtBot) scrollBot();

    } else {
      // Нет кеша — полный рендер
      const skel = area.querySelector('.init-skel-wrap');
      if (skel) skel.remove();
      area.innerHTML='';
      renderMsgs(chatId);
      area.scrollTop=area.scrollHeight;
    }

    startSSE(chatId,S.lastId[chatId]);
    return;
  }

  // Skip poll while this chat is still doing its init fetch
  if(S._initializingChat===chatId)return;

  const visibleIds=(S.msgs[chatId]||[]).filter(m=>!isTemp(m.id)).map(m=>m.id);
  const checkIdsSliced = visibleIds.slice(-150);
  const checkParam=checkIdsSliced.length?`&check_ids=${checkIdsSliced.join(',')}`:'';
  const res=await api(`get_messages?chat_id=${chatId}&after_id=${S.lastId[chatId]||0}&limit=50&mark_read=1${checkParam}`);
  if(!res.ok||chatId!==S.chatId)return;
  syncChats(res.chats);

  // ── Удалённые сообщения ────────────────────────────────────
  const deletedIds=res.deleted_ids||[];
  if(deletedIds.length){
    deletedIds.forEach(id=>{
      if(S.msgs[chatId])S.msgs[chatId]=S.msgs[chatId].filter(m=>m.id!==id);
      delete S.rxns[id];
      const el=document.querySelector(`.mrow[data-id="${id}"]`);
      // If element still in DOM it was deleted by the other party — show visual feedback
      if(el) deleteMsgElRemote(el);
    });
  }

  // ── Новые / изменённые сообщения ──────────────────────────
  const msgs=_normMsgs(res.messages||[]);
  msgs.forEach(m => { if(m.media_url) m.media_url = getMediaUrl(m.media_url); });
  let readStateChanged=false;
  if(msgs.length){
    const atBot=nearBot();
    msgs.forEach(m=>{
      if(S.rxns[m.id]===undefined){S.rxns[m.id]=Array.isArray(m.reactions)&&m.reactions.length?m.reactions:[];}
      const idx=S.msgs[chatId]?.findIndex(x=>x.id===m.id)??-1;
      if(idx>=0){
        // Avoid unnecessary DOM swaps if the message hasn't actually changed
        // (prevents link hover flickering during background polling)
        const cur=S.msgs[chatId][idx];
        if(cur.body!==m.body||cur.is_read!==m.is_read||cur.is_edited!==m.is_edited||
           cur.media_url!==m.media_url||cur.sent_at!==m.sent_at||
           JSON.stringify(cur.reactions)!==JSON.stringify(m.reactions)){
          S.msgs[chatId][idx]=m;
          patchMsgDom(m);
        }
      } else {
        // patch_only: server returned an edited msg outside current window — skip
        if(m.patch_only) return;
        // Before appending: check if this is our own pending temp message
        const pending=S._pendingTids||new Map();
        const matchTid=[...pending.entries()].find(([,b])=>b===m.body&&m.sender_id===S.user?.id)?.[0];
        if(matchTid){
          // Swap temp → real in state and DOM without adding duplicate
          const tidIdx=S.msgs[chatId]?.findIndex(x=>x.id===matchTid)??-1;
          if(tidIdx>=0)S.msgs[chatId][tidIdx]=m;
          S.rxns[m.id]=S.rxns[matchTid]||[];delete S.rxns[matchTid];
          const tidEl=document.querySelector(`.mrow[data-id="${matchTid}"]`);
          if(tidEl){tidEl.dataset.id=m.id;patchMsgDom(m);}
          S.lastId[chatId]=Math.max(S.lastId[chatId]||0,m.id);
          return;
        }
        S.msgs[chatId]=S.msgs[chatId]||[];S.msgs[chatId].push(m);
        appendMsg(chatId,m);
        if(m.sender_id!==S.user?.id){
          let txt=m.body?hideSpoilerText(m.body):(m.media_type==='video'?'🎥 Видео':'🖼 Фото');
          const callMatch = m.body?.match(/^\[call:(missed|declined|ended)(?::(\d+))?\]$/);
          if (callMatch) {
            const type = callMatch[1];
            if (type === 'ended') txt = '📞 Звонок завершен';
            else if (type === 'missed') txt = '📞 Пропущенный звонок';
            else txt = '📞 Отклонённый звонок';
          }
          showRichNotif({
              senderName: m.nickname || 'Initial',
              senderAvatar: m.avatar_url || null,
              senderId: m.sender_id,
              body: m.body || txt,
              chatId: chatId,
              onClick: function() { if (S.chatId !== chatId) { var c = S.chats.find(function(ch){ return ch.chat_id === chatId; }); if (c) openChat(c); } }
            });
        }
      }
    });
    S.lastId[chatId]=msgs.reduce((mx,m)=>Math.max(mx,m.id),S.lastId[chatId]);
    if(atBot)scrollBot();
    else showSBBtn(msgs.filter(m=>m.sender_id!==S.user?.id).length);
  }
  readStateChanged=syncReadState(chatId,res.last_read_id,true)||readStateChanged;
  if(msgs.length||readStateChanged)cacheWriteMsgs(chatId, S.msgs[chatId]||[]);
  S.rxnTick=(S.rxnTick||0)+1;
  if(S.rxnTick%2===0)syncRxns(chatId);
}

window.makeSkeleton = function(count = 6) {
  const skeleton = document.createElement('div');
  skeleton.className = 'hist-skeleton';
  for(let i=0; i<count; i++){
    const me = Math.random() > 0.5;
    const w = Math.floor(Math.random() * 40 + 30) + '%';
    const row = document.createElement('div');
    row.className = 'hist-skel-row' + (me ? ' skel-me' : '');
    if(!me){ const av = document.createElement('div'); av.className = 'hist-skel-av'; row.appendChild(av); }
    const bub = document.createElement('div'); bub.className = 'hist-skel-bubble'; bub.style.width = w;
    row.appendChild(bub);
    skeleton.appendChild(row);
  }
  return skeleton;
};

/* ── Загрузка старых сообщений (бесконечный скроллинг) ── */
async function loadHistory(chatId) {
  if(S.historyLoading||S.historyEnd||!S.msgs[chatId]||S._initializingChat) return;
  const msgs=S.msgs[chatId];
  const validIds=msgs.filter(m=>!isTemp(m.id)).map(m=>+m.id);
  if(!validIds.length) return;
  const minId=Math.min(...validIds);

  S.historyLoading=true;
  const area=$('msgs');

  // Bubble-style skeleton сверху
  let skeleton=area.querySelector('.hist-skeleton');
  if(!skeleton){
    skeleton = window.makeSkeleton(4);
    const sentinel = area.querySelector('.hist-sentinel');
    if(sentinel) area.insertBefore(skeleton, sentinel.nextSibling);
    else area.insertBefore(skeleton, area.firstChild);
  }

  const res=await api(`get_messages?chat_id=${chatId}&before_id=${minId}&limit=50&skip_chats=1`);

  if(!res.ok||chatId!==S.chatId){ skeleton.remove(); S.historyLoading=false; return; }

  const older=_normMsgs(res.messages||[]);
  older.forEach(m => { if(m.media_url) m.media_url = getMediaUrl(m.media_url); });
  if(older.length<50) S.historyEnd=true;
  if(!older.length){ skeleton.remove(); S.historyLoading=false; return; }

  older.forEach(m=>{ S.rxns[m.id]=Array.isArray(m.reactions)?m.reactions:[]; });
  const existingIds=new Set(msgs.map(m=>m.id));
  const toAdd=older.filter(m=>!existingIds.has(m.id));

  S.msgs[chatId]=[...toAdd,...S.msgs[chatId]];
  prependMsgsToDOM(chatId,toAdd,skeleton);
  S.historyLoading=false;

  // Если высота добавленных сообщений оказалась меньше зоны триггера (rootMargin),
  // сентинел не выйдет из неё, и повторный скролл не сработает. Загружаем ещё порцию автоматически.
  if (area.scrollTop < 400 && !S.historyEnd) {
    loadHistory(chatId);
  }
}

function prependMsgsToDOM(chatId, olderMsgs, skeletonToRemove) {
  const area = $('msgs');
  if(!olderMsgs.length) return;

  const firstOldEl = area.querySelector('.mrow');
  const firstOldMsgId = firstOldEl ? firstOldEl.dataset.id : null;
  const firstOldMsg = firstOldMsgId ? S.msgs[chatId].find(m => String(m.id) === String(firstOldMsgId)) : null;
  const firstDatePill = area.querySelector('.date-pill');

  const groups = groupMsgs(olderMsgs);
  const frag = document.createDocumentFragment();
  let lastDate = null, lastSender = null;

  groups.forEach((g, i) => {
    const first = g.type === 'grid' ? g.msgs[0] : g.msg;
    const d = fmtDate(first.sent_at);
    if(d !== lastDate) {
      const sep = document.createElement('div');
      sep.className = 'date-pill';
      sep.innerHTML = `<span>${d}</span>`;
      frag.appendChild(sep);
      lastDate = d;
    }

    if(g.type === 'grid') {
      frag.appendChild(makeGridEl(g.msgs, lastSender !== first.sender_id));
      lastSender = first.sender_id;
    } else {
      frag.appendChild(makeMsgEl(g.msg, lastSender !== g.msg.sender_id));
      lastSender = g.msg.sender_id;
    }
  });

  if (firstOldEl && firstOldMsg) {
    const oldD = fmtDate(firstOldMsg.sent_at);
    if (oldD === lastDate && firstDatePill && (!firstDatePill.previousElementSibling || firstDatePill.previousElementSibling.classList.contains('hist-sentinel'))) {
      firstDatePill.remove();
    }

    if (firstOldMsg.sender_id === lastSender) {
      firstOldEl.classList.remove('ns');
    } else {
      firstOldEl.classList.add('ns');
    }

    const boundaryBatchId = olderMsgs[olderMsgs.length - 1].batch_id;
    if (boundaryBatchId && firstOldMsg.batch_id === boundaryBatchId) {
      const lastNodeInFrag = frag.lastChild;
      if (lastNodeInFrag && lastNodeInFrag.classList.contains('mrow')) {
         lastNodeInFrag.remove();
      }
      const combinedBatchMsgs = S.msgs[chatId].filter(m => m.batch_id === boundaryBatchId);
      const combinedGrid = makeGridEl(combinedBatchMsgs, lastSender !== firstOldMsg.sender_id);
      
      const oldBatchEl = area.querySelector(`.mrow[data-batch="${boundaryBatchId}"]`) || firstOldEl;
      if (oldBatchEl) {
         oldBatchEl.replaceWith(combinedGrid);
      }
    }
  }

  area.style.overflowAnchor = 'none';
  const st = area.scrollTop;
  const shBefore = area.scrollHeight;
  
  if (skeletonToRemove) skeletonToRemove.remove();

  // Вставляем строго после сентинела, чтобы он всегда оставался абсолютным первым элементом
  const sentinel = area.querySelector('.hist-sentinel');
  if (sentinel) {
    area.insertBefore(frag, sentinel.nextSibling);
  } else {
    area.insertBefore(frag, area.firstChild);
  }
  
  const shAfter = area.scrollHeight; // форсирует синхронный reflow
  area.scrollTop = st + (shAfter - shBefore);
  applyGroupClasses(area);
  area.style.overflowAnchor = '';
}

async function fullSync(){}// deprecated — deleted_ids в get_messages заменяет это


/* ══ MEDIA GROUPING ══════════════════════════════════════════ */
function groupMsgs(msgs){
  const groups=[];let i=0;
  while(i<msgs.length){
    const m=msgs[i];
    if(m.batch_id){
      const grp=[m];let j=i+1;
      while(j<msgs.length&&msgs[j].batch_id===m.batch_id){grp.push(msgs[j]);j++;}
      if(grp.length>1){groups.push({type:'grid',msgs:grp});i=j;continue;}
    }
    groups.push({type:'msg',msg:m});i++;
  }return groups;
}

/* ══ RENDER ══════════════════════════════════════════════════ */
function renderEmptyChat(chatId){
  const area=$('msgs');
  const emojis = ['👋', '✌️', '🖖', '🤝', '🙌', '🎉', '✨', '😎', '🐱', '❤️', '🔥'];
  let curIdx = Math.floor(Math.random() * emojis.length);
  area.innerHTML = `<div class="chat-empty-state">
    <div class="chat-empty-card">
      <div class="e-txt">Здесь пока ничего нет</div>
      <div class="e-sub">Отправьте сообщение или поприветствуйте собеседника</div>
      <div class="e-greet-wrap">
        <button class="e-greet-nav" id="e-greet-prev" title="Предыдущий"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/></svg></button>
        <button class="e-greet" id="e-greet-btn" title="Поздороваться"><span>${emojis[curIdx]}</span></button>
        <button class="e-greet-nav" id="e-greet-next" title="Следующий"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg></button>
      </div>
    </div>
  </div>`;
  
  const btn = area.querySelector('#e-greet-btn');
  const prev = area.querySelector('#e-greet-prev');
  const next = area.querySelector('#e-greet-next');
  
  const updateEmo = () => {
    const span = btn.querySelector('span');
    span.textContent = emojis[curIdx];
    span.style.animation = 'none';
    btn.style.animation = 'none';
    void span.offsetWidth; // trigger reflow
    span.style.animation = 'emoPopIn .3s var(--sp)';
    btn.style.animation = 'greetBgPop .3s var(--sp)';
  };
  
  if (prev) prev.onclick = (e) => { e.stopPropagation(); curIdx = (curIdx - 1 + emojis.length) % emojis.length; updateEmo(); };
  if (next) next.onclick = (e) => { e.stopPropagation(); curIdx = (curIdx + 1) % emojis.length; updateEmo(); };
  if (btn) btn.onclick = () => { if (!isTemp(chatId)) mfield.focus(); document.execCommand('insertText', false, btn.textContent.trim()); sendText(); };
}

function renderMsgs(chatId){
  const area=$('msgs'),all=S.msgs[chatId]||[],groups=groupMsgs(all);
  if(!all.length){ renderEmptyChat(chatId); return; }
  // Re-create sticky-date-pill if it was wiped by innerHTML=''
  if(!document.getElementById('sticky-date-pill')){
    const pill=document.createElement('div');
    pill.className='sticky-date-pill';pill.id='sticky-date-pill';
    pill.innerHTML='<span></span>';
    area.prepend(pill);
  }
  let lastDate=null,lastSender=null;
  groups.forEach(g=>{
    const first=g.type==='grid'?g.msgs[0]:g.msg;const d=fmtDate(first.sent_at);
    if(d!==lastDate){const sep=document.createElement('div');sep.className='date-pill';sep.innerHTML=`<span>${d}</span>`;area.appendChild(sep);lastDate=d;}
    if(g.type==='grid'){area.appendChild(makeGridEl(g.msgs,lastSender!==first.sender_id));lastSender=first.sender_id;}
    else{area.appendChild(makeMsgEl(g.msg,lastSender!==g.msg.sender_id));lastSender=g.msg.sender_id;}
  });
  applyGroupClasses(area);
  // Sentinel всегда первым для IntersectionObserver
  if(window._histSentinel){const s=window._histSentinel;if(area.firstChild!==s)area.insertBefore(s,area.firstChild);}
  // Re-sync sticky pill top after DOM rebuild
  if(window._syncStickyTop)requestAnimationFrame(()=>window._syncStickyTop());
}
/* ══ SEND ANIMATION — stretch from button, fade-out to real message ══ */

/**
 * Send animation with visible stretch + fade-out:
 *   1. Burst — send button pulses
 *   2. Stretch — clone (with real message content) stretches from button to message
 *   3. Fade-out — clone fades, real message fades in at same position
 */
function animateSend(tempId) {
  var sendBtn = document.getElementById('btn-send');
  var row = document.querySelector('.mrow[data-id="' + tempId + '"]');
  var bubble = row ? row.querySelector('.mbody') : null;

  if (!sendBtn || !row || !bubble) return;

  var isMe = row.classList.contains('me');
  var btnR = sendBtn.getBoundingClientRect();
  var bubR = bubble.getBoundingClientRect();

  var btnCx = btnR.left + btnR.width / 2;
  var btnCy = btnR.top + btnR.height / 2;
  var bubCx = bubR.left + bubR.width / 2;
  var bubCy = bubR.top + bubR.height / 2;

  var dx = btnCx - bubCx;
  var dy = btnCy - bubCy;
  var s0 = btnR.width / Math.max(bubR.width, 1);

  // Clone: visual copy of the real message bubble
  var clone = document.createElement('div');
  clone.className = 'send-anim-clone' + (isMe ? ' send-anim-clone-me' : '');
  clone.innerHTML = bubble.innerHTML;

  var bubCS = getComputedStyle(bubble);

  clone.style.cssText =
    'position:fixed;z-index:9999;pointer-events:none;' +
    'width:' + bubR.width + 'px;' +
    'height:' + bubR.height + 'px;' +
    'left:' + bubR.left + 'px;' +
    'top:' + bubR.top + 'px;' +
    'will-change:transform,opacity;' +
    'transform-origin:center center;' +
    'overflow:hidden;' +
    'border-radius:' + bubCS.borderRadius + ';' +
    'transform:translate(' + dx + 'px,' + dy + 'px) scale(' + s0 + ');' +
    'opacity:0.9;';

  document.body.appendChild(clone);
  clone.getBoundingClientRect();

  // Stretch: visible from button to message position, then fade out
  var flight = clone.animate([
    // Start: small at button
    { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(' + s0 + ')', opacity: 0.9 },
    // Mid: halfway, slightly overshoot
    {
      transform: 'translate(' + (dx * 0.3) + 'px,' + (dy * 0.25) + 'px) scale(1.04)',
      opacity: 0.95,
      offset: 0.6
    },
    // Fade-out: at target position, dissolve away
    { transform: 'translate(0,0) scale(1)', opacity: 0 }
  ], {
    duration: 380,
    easing: 'cubic-bezier(.22,1.1,.36,1)',
    fill: 'forwards'
  });

  // Pulse the send button
  sendBtn.classList.add('send-pulse');
  setTimeout(function() { sendBtn.classList.remove('send-pulse'); }, 420);

  // Hide real message during flight
  bubble.style.opacity = '0';
  bubble.style.transition = 'none';

  // Fade-in real message as clone fades out
  flight.onfinish = function() {
    clone.remove();

    bubble.style.transition = 'opacity .2s ease-out';
    bubble.style.opacity = '1';

    setTimeout(function() {
      bubble.style.transition = '';
      bubble.style.opacity = '';
    }, 220);
  };
}

function appendMsg(chatId,m){
  const area=$('msgs'),all=S.msgs[chatId]||[];
  // DOM-level dedup: prevent visual duplication from concurrent SSE + fetchMsgs
  if(area.querySelector('.mrow[data-id="'+m.id+'"]'))return;
  const empty=area.querySelector('.chat-empty-state');
  if(empty) empty.remove();
  const prev=all[all.length-2];
  const seps=area.querySelectorAll('.date-pill'),lastDate=seps.length?seps[seps.length-1].querySelector('span')?.textContent:null;
  const d=fmtDate(m.sent_at);if(d!==lastDate){const sep=document.createElement('div');sep.className='date-pill';sep.innerHTML=`<span>${d}</span>`;area.appendChild(sep);}
  // Batch media grouping during polling
  if(m.batch_id){
    const existingGrid=area.querySelector('.mrow[data-batch="'+m.batch_id+'"]');
    if(existingGrid){
      const batchMsgs=all.filter(x=>x.batch_id===m.batch_id);
      const newGrid=makeGridEl(batchMsgs,existingGrid.classList.contains('ns'));
      newGrid.style.animation='none';
      existingGrid.replaceWith(newGrid);
      applyGroupClassesTail(area);
      return;
    }
    const batchMsgs=all.filter(x=>x.batch_id===m.batch_id);
    const newSender=!prev||prev.sender_id!==m.sender_id;
    if(batchMsgs.length>1){
      const gridEl=makeGridEl(batchMsgs,newSender);
            gridEl.classList.add('msg-anim-in');
      area.appendChild(gridEl);
      applyGroupClassesTail(area);
      setTimeout(()=>gridEl.classList.remove('msg-anim-in'), 350);
      return;
    }
    const el=makeMsgEl(m,newSender);
    el.dataset.batch=m.batch_id;
          el.classList.add('msg-anim-in');
    area.appendChild(el);
    applyGroupClassesTail(area);
    setTimeout(()=>el.classList.remove('msg-anim-in'), 350);
    return;
  }
        const el = makeMsgEl(m,!prev||prev.sender_id!==m.sender_id);
        el.classList.add('msg-anim-in');
        area.appendChild(el);
  applyGroupClassesTail(area);
  setTimeout(()=>el.classList.remove('msg-anim-in'), 350);
}

function _effPrev(el) {
  let p = el.previousElementSibling;
  while(p && (p._deleting || !p.classList.contains('mrow'))) p = p.previousElementSibling;
  return p;
}
function _effNext(el) {
  let n = el.nextElementSibling;
  while(n && (n._deleting || !n.classList.contains('mrow'))) n = n.nextElementSibling;
  return n;
}

function deleteMsgEl(el, onDone) {
  if(el._deleting) return;
  el._deleting = true;

  const prevSib = el.previousElementSibling;
  const nextSib = el.nextElementSibling;
  const effPrev = _effPrev(el);
  const effNext = _effNext(el);

  const h = el.offsetHeight;
  const mt = parseFloat(getComputedStyle(el).marginTop) || 0;
  const nextMtBefore = nextSib ? (parseFloat(getComputedStyle(nextSib).marginTop) || 0) : 0;

  if (nextSib && nextSib.classList.contains('mrow')) {
    const nextSid = nextSib.dataset.sid;
    const prevSid = effPrev ? effPrev.dataset.sid : null;
    if (prevSid !== nextSid) nextSib.classList.add('ns');
    else nextSib.classList.remove('ns');
  }

  const nextMtAfter = nextSib ? (parseFloat(getComputedStyle(nextSib).marginTop) || 0) : 0;
  const delta = nextMtAfter - nextMtBefore;

  el.style.height       = h + 'px';
  el.style.marginTop    = mt + 'px';
  el.style.marginBottom = (delta) + 'px';
  el.style.overflow     = 'hidden';
  el.style.transition   = 'height .24s var(--ease), margin-top .24s var(--ease), margin-bottom .24s var(--ease), opacity .2s ease-out';

  el.classList.add('msg-deleting');

  const updateGrp = (target) => {
    const p = _effPrev(target);
    const n = _effNext(target);
    const sid = target.dataset.sid;
    const sp = p?.dataset?.sid === sid;
    const sn = n?.dataset?.sid === sid;
    target.classList.remove('grp-single','grp-top','grp-mid','grp-bot');
    if (!sp && !sn) target.classList.add('grp-single');
    else if (!sp && sn) target.classList.add('grp-top');
    else if (sp && sn) target.classList.add('grp-mid');
    else target.classList.add('grp-bot');
  };

  if (effPrev) updateGrp(effPrev);
  if (effNext) updateGrp(effNext);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      el.style.height       = '0';
      el.style.marginTop    = '0';
      el.style.marginBottom = '0';
      el.style.opacity      = '0';

      setTimeout(() => {
        el.remove();
        if (onDone) onDone();
      }, 250);
    });
  });
}

// Remote (server-side) deletion — collapse immediately, no placeholder
function deleteMsgElRemote(el) {
  deleteMsgEl(el);
}
function patchMsgDom(m){
  if(m.batch_id){
    const gridEl=document.querySelector(`.mrow[data-batch="${m.batch_id}"]`);
    if(gridEl){
      const batchMsgs=(S.msgs[S.chatId]||[]).filter(x=>x.batch_id===m.batch_id);
      const newGrid=makeGridEl(batchMsgs,gridEl.classList.contains('ns'));
      newGrid.style.animation='none';
      gridEl.replaceWith(newGrid);
      return;
    }
  }
  const el=document.querySelector(`.mrow[data-id="${m.id}"]`);if(!el)return;
  const newEl=makeMsgEl(m,el.classList.contains('ns'));
  newEl.style.animation='none';
  el.replaceWith(newEl);
}

function _patchTickOnly(msgId){
  // Хирургически показываем левую галочку — не пересоздаём DOM-ноду
  const row=document.querySelector(`.mrow[data-id="${msgId}"]`);
  if(!row)return;
  const tickWrap=row.querySelector('.tick');
  if(!tickWrap)return;
  const leftPath=tickWrap.querySelector('path:first-child');
  if(leftPath)leftPath.style.visibility='visible';
  tickWrap.classList.add('r');
}
function syncReadState(chatId,lastReadId,patchDom=false){
  const lr=+lastReadId||0;
  const myId=+S.user?.id||0;
  const list=S.msgs[chatId]||[];
  if(!lr||!myId||!list.length)return false;
  let changed=false;
  list.forEach(m=>{
    if(isTemp(m.id)||m.sender_id!==myId||+m.id>lr||m.is_read==1)return;
    m.is_read=1;
    changed=true;
    if(patchDom)_patchTickOnly(m.id);
  });
  return changed;
}

function removeMsgById(msgId){
  if(!S.chatId||!S.msgs[S.chatId])return;
  const list=S.msgs[S.chatId];
  const idx=list.findIndex(m=>m.id===msgId);
  if(idx<0)return;
  const batchId=list[idx].batch_id;
  list.splice(idx,1);
  delete S.rxns[msgId];

  if(batchId){
    const remain=list.filter(m=>m.batch_id===batchId);
    const gridEl=document.querySelector(`.mrow[data-batch="${batchId}"]`);
    if(gridEl){
      if(remain.length>1){
        const newGrid=makeGridEl(remain,gridEl.classList.contains('ns'));
        newGrid.style.animation='none';
        gridEl.replaceWith(newGrid);
      } else if(remain.length===1){
        const single=makeMsgEl(remain[0],gridEl.classList.contains('ns'));
        single.style.animation='none';
        gridEl.replaceWith(single);
      } else {
        gridEl.remove();
      }
      applyGroupClasses($('msgs'));
      return;
    }
  }
  const el=document.querySelector(`.mrow[data-id="${msgId}"]`);
  if(el)deleteMsgEl(el);
}

/* ══ BUILD META ══════════════════════════════════════════════ */
// cls: 'mmeta' for overlays/standalone, 'mtxt-meta' for inline float-right inside text
function makeMeta(m,isMe,sending=false,cls='mmeta'){
  const meta=document.createElement('div');meta.className=cls;
  if(m.is_edited){
    const ed=document.createElement('span');ed.className='med';
    const ns='http://www.w3.org/2000/svg';
    const sv=document.createElementNS(ns,'svg');sv.setAttribute('viewBox','0 0 16 16');sv.setAttribute('width','12');sv.setAttribute('height','12');sv.setAttribute('fill','none');
    const p=document.createElementNS(ns,'path');p.setAttribute('d','M11.5 2.5a1.5 1.5 0 0 1 2.12 2.12l-8 8a2 2 0 0 1-.76.46l-2.5.83.83-2.5a2 2 0 0 1 .46-.76l7.85-7.85z');p.setAttribute('stroke','currentColor');p.setAttribute('stroke-width','1.5');p.setAttribute('stroke-linecap','round');p.setAttribute('stroke-linejoin','round');
    sv.appendChild(p);ed.appendChild(sv);
    meta.appendChild(ed);
  }
  if(sending){
    const sp=document.createElement('div');sp.className='send-spinner';meta.appendChild(sp);
  } else {
    meta.appendChild(Object.assign(document.createElement('span'),{className:'mtime',textContent:fmtTime(m.sent_at)}));
    if(isMe){
      const isRead=m.is_read==1;
      const nsT='http://www.w3.org/2000/svg';
      // Всегда двойная галочка фиксированного размера 18×11.
      // Левая path скрыта через visibility:hidden — не смещает layout.
      const s=document.createElementNS(nsT,'svg');
      s.setAttribute('viewBox','0 0 18 11');
      s.setAttribute('width','18');s.setAttribute('height','11');s.setAttribute('fill','none');
      const p1=document.createElementNS(nsT,'path');
      p1.setAttribute('d','M1 5.5l3 3L10 1');
      p1.setAttribute('stroke','currentColor');p1.setAttribute('stroke-opacity','0.65');
      p1.setAttribute('stroke-width','1.75');p1.setAttribute('stroke-linecap','round');p1.setAttribute('stroke-linejoin','round');p1.setAttribute('fill','none');
      p1.style.visibility=isRead?'visible':'hidden';
      const p2=document.createElementNS(nsT,'path');
      p2.setAttribute('d','M5 5.5l3 3L14 1');
      p2.setAttribute('stroke','currentColor');
      p2.setAttribute('stroke-width','1.75');p2.setAttribute('stroke-linecap','round');p2.setAttribute('stroke-linejoin','round');p2.setAttribute('fill','none');
      s.appendChild(p1);s.appendChild(p2);
      const tWrap=document.createElement('span');tWrap.className='tick'+(isRead?' r':'');
      tWrap.appendChild(s);
      meta.appendChild(tWrap);
    }
  }
  return meta;
}

/* ══ BUILD MESSAGE ════════════════════════════════════════════ */
function makeMsgEl(m,newSender=true){
  const isMe=m.sender_id==S.user?.id;
  const sending=isTemp(m.id);
  const row=document.createElement('div');
  const selCls=S.selectMode?' selectable':'';const selSelected=S.selected.has(m.id)?' selected':'';
  row.className=`mrow${isMe?' me':''}${newSender?' ns':''}${selCls}${selSelected}`;row.dataset.sid=String(m.sender_id);
  row.dataset.id=m.id;

  // Checkbox for select mode
  const cb=document.createElement('div');cb.className='msg-checkbox';row.appendChild(cb);

  const aviEl=document.createElement('div');aviEl.className='mavi'+(isMe?' ghost':'');if(!isMe)aviEl.innerHTML=aviHtml(m.nickname,m.avatar_url);
  const bub=document.createElement('div');bub.className='mbub';

  const hasMedia=!!(m.media_url&&m.media_type),hasText=!!(m.body&&m.body.trim())&&m.media_type!=='voice',mediaOnly=hasMedia&&!hasText&&m.media_type!=='document'&&m.media_type!=='voice';
  const mediaCaption=hasMedia&&hasText;
  const rxns=sortRxns(S.rxns[m.id]||(Array.isArray(m.reactions)?m.reactions:[]));const hasRxns=rxns.length>0;

  const body=document.createElement('div');body.className='mbody'+(mediaOnly?' media-only':'')+(mediaCaption?' has-media-caption':'')+(sending?' sending':'')+(m.is_edited?' is-edited':'');

  const callMatch = typeof m.body === 'string' && m.body.match(/^\[call:(missed|declined|ended)(?::(\d+))?\]$/);

  if(m.reply_to && !callMatch){
    const orig=S.msgs[S.chatId]?.find(x=>x.id==m.reply_to);
    let rText = 'Сообщение';
    if (orig) {
      const oc = typeof orig.body === 'string' ? orig.body.match(/^\[call:(missed|declined|ended)(?::(\d+))?\]$/) : null;
      if (oc) {
        if (oc[1] === 'ended') rText = '📞 Звонок завершен';
        else if (oc[1] === 'missed') rText = '📞 Пропущенный звонок';
        else rText = '📞 Отклонённый звонок';
      } else {
        rText = hideSpoilerText(orig.body) || (orig.media_type==='video'?'🎥 Видео':'🖼 Фото') || 'Сообщение';
      }
    }
    const rName=orig?(orig.nickname||'Пользователь'):'—';
    const rDiv=document.createElement('div');rDiv.className='rply';rDiv.innerHTML=`<div class="rply-who">${esc(rName)}</div><div class="rply-txt">${esc(rText.slice(0,80))}</div>`;
    rDiv.onclick=()=>{const t=document.querySelector(`.mrow[data-id="${m.reply_to}"]`);if(t){t.scrollIntoView({behavior:'smooth',block:'center'});t.classList.add('msg-flash');setTimeout(()=>t.classList.remove('msg-flash'),1000);}};
    body.appendChild(rDiv);
  }

  if (callMatch && !hasMedia) {
    const type = callMatch[1];
    const secs = parseInt(callMatch[2] || '0', 10);
    
    let title = '';
    let isRed = false;
    if (type === 'ended') {
        const dur = `${Math.floor(secs/60)}:${String(secs%60).padStart(2,'0')}`;
        title = isMe ? `Исходящий звонок (${dur})` : `Входящий звонок (${dur})`;
    } else if (type === 'missed') {
        title = isMe ? 'Отменённый звонок' : 'Пропущенный звонок';
        isRed = !isMe;
    } else if (type === 'declined') {
        title = isMe ? 'Отклонённый звонок' : 'Отклонённый звонок';
        isRed = true; 
    }

    const svgIcon = isMe 
      ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M7 17L17 7"/><path d="M7 7h10v10"/></svg>` 
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M17 7L7 17"/><path d="M17 17H7V7"/></svg>`;

    body.classList.add('call-log');
    if (isRed) body.classList.add('call-log-red');
    
    body.innerHTML = `
      <div class="call-log-bubble">
        <div class="call-log-icon">${svgIcon}</div>
        <div style="font-weight:600; font-size:14.5px;" class="call-log-title">${title}</div>
      </div>
    `;
    const bottom = document.createElement('div');
    bottom.className = 'mbottom';
    bottom.appendChild(makeMeta(m, isMe, sending));
    body.appendChild(bottom);
    
    body.onclick = (ev) => {
      if (S.selectMode) return;
      ev.stopPropagation();
      if (window.CallUI && S.partner) {
        window.CallUI.startCall({
          id: S.partner.partner_id || S.partner.id,
          name: S.partner.partner_name || '@' + S.partner.partner_signal_id,
          avatarHtml: '', isVideo: false,
          signalId: S.partner.partner_signal_id || S.partner.signal_id
        });
      }
    };
  } else {
    if(hasMedia){
    if(m.media_type==='voice'){
      const voiceWrap=document.createElement('div');
      voiceWrap.className='voice-msg';
      const dur=m.voice_duration||parseInt(m.body||'0',10)||0;
      const durStr=window.VoiceMsg?window.VoiceMsg.formatTimeSec(dur):`${Math.floor(dur/60)}:${String(dur%60).padStart(2,'0')}`;
      const audioUrl=getMediaUrl(m.media_url);
      let wfData=[];
      try{if(m.voice_waveform)wfData=JSON.parse(m.voice_waveform);}catch(e){}
      voiceWrap.innerHTML=`
        <button class="voice-play-btn"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></button>
        <div class="voice-waveform">
          <div class="voice-wf-bars"></div>
          <div class="voice-wf-bottom">
            <button class="voice-speed-btn" title="Скорость воспроизведения">1×</button>
            <span class="voice-wf-time"></span>
          </div>
        </div>
      `;
      body.appendChild(voiceWrap);
      body.classList.add('voice-body');

      // Time — right-aligned on the same row as speed button
      const voiceTimeEl = voiceWrap.querySelector('.voice-wf-time');
      if (voiceTimeEl) voiceTimeEl.appendChild(makeMeta(m,isMe,sending));

      setTimeout(()=>{if(window.VoiceMsg){window.VoiceMsg.createPlayer(voiceWrap,audioUrl,dur,wfData);}},0);
    } else if(m.media_type==='document'){
      const ext=(m.media_file_name||'file').split('.').pop().toLowerCase();
      const fileName=m.media_file_name||'Файл';
      const fileSize=m.media_file_size?fmtFileSize(m.media_file_size):'';
      const docUrl=m.media_url;

      const card=document.createElement('a');
      card.className='doc-card';
      card.href=docUrl;
      card.target='_blank';
      card.rel='noopener noreferrer';
      card.download=fileName;

      const icoWrap=document.createElement('div');
      icoWrap.className='doc-card-icon doc-card-icon-'+ext;
      icoWrap.innerHTML=getDocIcon(ext)||'';

      const info=document.createElement('div');
      info.className='doc-card-info';

      const nameEl=document.createElement('div');
      nameEl.className='doc-card-name';
      nameEl.textContent=fileName;
      nameEl.title=fileName;

      const sizeEl=document.createElement('div');
      sizeEl.className='doc-card-size';
      sizeEl.textContent=fileSize;

      info.appendChild(nameEl);
      info.appendChild(sizeEl);
      card.appendChild(icoWrap);
      card.appendChild(info);
      body.appendChild(card);
    } else if(m.media_type==='image'){
      const wrap=document.createElement('div');wrap.className='single-media'+(m.media_spoiler?' media-spoiler':'');
      const img=document.createElement('img');img.loading='lazy';
      const ov=document.createElement('div');ov.className='media-overlay';
      wrap.appendChild(img);wrap.appendChild(ov);

      const origUrl = m.media_url;

      // ── 1. Резервируем размер НЕМЕДЛЕННО (синхронно) ────────
      if (m.media_width && m.media_height) {
        // Сервер прислал размеры — ставим точные сразу
        _reserveMediaSize(wrap, m.media_width, m.media_height);
      } else {
        // Проверяем кеши синхронно: сначала Map, потом localStorage
        const cached = _thumbCache.get(origUrl) || _dimRead(origUrl);
        if (cached && cached.w && cached.h) {
          _reserveMediaSize(wrap, cached.w, cached.h);
        } else {
          // Размеры неизвестны — плейсхолдер чтобы bubble не схлопнулся
          _applyPlaceholder(wrap);
        }
      }

      if(!sending && origUrl && !origUrl.startsWith('blob:')){
        _makeThumb(origUrl).then(({url: thumbUrl, w, h}) => {
          img.src = thumbUrl;
          // Обновляем с реальными пропорциями (убирает плейсхолдер)
          if (w && h) _upgradePlaceholder(wrap, w, h);
          // Снимаем shimmer как только картинка отрисована
          img.addEventListener('load', () => {
            delete wrap.dataset.placeholder;
          }, {once: true});
        });
      } else {
        img.src = origUrl;
        // Для blob (отправка) — обновляем после загрузки
        img.addEventListener('load', () => {
          if (img.naturalWidth && img.naturalHeight)
            _upgradePlaceholder(wrap, img.naturalWidth, img.naturalHeight);
          delete wrap.dataset.placeholder;
        }, {once: true});
      }

      // ── Loading ring for incoming (not a blob/temp URL) ──────
      if(!sending&&!origUrl?.startsWith('blob:')){
        wrap.classList.add('media-loading');
        const loadOv=document.createElement('div');loadOv.className='media-load-ov';
        loadOv.innerHTML='<svg viewBox="0 0 46 46"><circle class="mlr-bg" cx="23" cy="23" r="19"/><circle class="mlr-fg" cx="23" cy="23" r="19" transform="rotate(-90 23 23)"/></svg>';
        wrap.appendChild(loadOv);
        const onLoaded=()=>{
          wrap.classList.remove('media-loading');
          loadOv.classList.add('done');
          setTimeout(()=>loadOv.remove(),300);
        };
        if(img.complete&&img.naturalWidth){onLoaded();}
        else{img.addEventListener('load',onLoaded,{once:true});img.addEventListener('error',onLoaded,{once:true});}
      }
      if(m.media_spoiler){
        const cover=document.createElement('div');cover.className='spoiler-media-cover';
        cover.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg><span>Нажмите чтобы открыть</span>';
        cover.onclick=e=>{e.stopPropagation();wrap.classList.add('revealed');if(!sending)setTimeout(()=>{wrap.onclick=()=>openViewer([{url:origUrl,type:'image'}],0);},300);};
        wrap.appendChild(cover);
      } else if(!sending){
        wrap.onclick=()=>openChatViewer(m.id);
      }
      body.appendChild(wrap);
    } else if(m.media_type==='video'){
      // Telegram-style inline video: thumbnail + play button, opens viewer on click
      const wrap=document.createElement('div');wrap.className='vid-wrap';
      const vid=document.createElement('video');
      vid.src=m.media_url;vid.preload='metadata';vid.muted=true;vid.playsInline=true;
      // Show first frame as poster
      vid.addEventListener('loadedmetadata',()=>{
        // Seek to 0.1s to get a real frame (some browsers show black at 0)
        vid.currentTime=0.1;
        // Show duration
        const dur=wrap.querySelector('.vid-duration');
        if(dur&&isFinite(vid.duration)){
          const s=Math.round(vid.duration);
          dur.textContent=`${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
        }
      },{once:true});
      // Hover: play silently for live preview
      wrap.addEventListener('mouseenter',()=>{if(!sending){vid.currentTime=0;vid.play().catch(()=>{});}});
      wrap.addEventListener('mouseleave',()=>{vid.pause();vid.currentTime=0.1;});
      const overlay=document.createElement('div');overlay.className='vid-overlay';
      const btn=document.createElement('div');btn.className='vid-play-btn';
      btn.innerHTML='<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
      const durEl=document.createElement('div');durEl.className='vid-duration';
      overlay.appendChild(btn);
      wrap.appendChild(vid);wrap.appendChild(overlay);wrap.appendChild(durEl);

      // ── Loading ring for incoming video ──────────────────────
      if(!sending&&!m.media_url?.startsWith('blob:')){
        wrap.classList.add('media-loading');
        const vidLoadOv=document.createElement('div');vidLoadOv.className='media-load-ov';
        vidLoadOv.innerHTML='<svg viewBox="0 0 46 46"><circle class="mlr-bg" cx="23" cy="23" r="19"/><circle class="mlr-fg" cx="23" cy="23" r="19" transform="rotate(-90 23 23)"/></svg>';
        wrap.appendChild(vidLoadOv);
        const onVidLoaded=()=>{
          wrap.classList.remove('media-loading');
          vidLoadOv.classList.add('done');
          setTimeout(()=>vidLoadOv.remove(),300);
        };
        vid.addEventListener('loadeddata',onVidLoaded,{once:true});
        vid.addEventListener('error',onVidLoaded,{once:true});
        // Fallback: if metadata already loaded
        if(vid.readyState>=2)onVidLoaded();
      }
      if(!sending){
        wrap.onclick=()=>openChatViewer(m.id);
      }
      body.appendChild(wrap);
    }
  }
    if(hasText){
    const _stripped=(m.body||'').replace(mkEMORE(),'').replace(/[\s\u200B\uFEFF]/g,'');
    const _isEmoOnly=!hasMedia&&_stripped.length===0;
    const t=document.createElement('div');t.className='mtxt';

    if(_isEmoOnly){
      const _cnt=countEmoji(m.body||'');
      body.classList.add('emo-only','emo-c'+Math.min(_cnt,6));
      t.textContent=m.body||'';
      walkTextNodes(t); // convert to .emo-s spans so EmojiLocal + emo-c size applies
      // Emoji-only: classic mbottom (no reactions here — they go on .mbub below)
      const bottom=document.createElement('div');bottom.className='mbottom';
      bottom.appendChild(makeMeta(m,isMe,sending));
      if(mediaCaption){
        const cap=document.createElement('div');cap.className='mcap';
        cap.appendChild(t);cap.appendChild(bottom);body.appendChild(cap);
      } else {
        body.appendChild(t);body.appendChild(bottom);
      }
    } else {
      t.innerHTML=fmtText(m.body);
      walkTextNodes(t);
      if(hasRxns){
        // Reactions present: timestamp goes in .mbottom.rxns-only row (right side)
        const rb=document.createElement('div');rb.className='mbottom rxns-only';
        rb.appendChild(makeRxnRow(m.id,rxns));
        rb.appendChild(makeMeta(m,isMe,sending,'mtxt-meta'));
        if(mediaCaption){
          const cap=document.createElement('div');cap.className='mcap';
          cap.appendChild(t);cap.appendChild(rb);body.appendChild(cap);
        } else {
          body.appendChild(t);body.appendChild(rb);
        }
      } else {
        // Phantom-spacer approach: inline <span> reserves width on last text line,
        // absolute .mtxt-meta overlaps it at bottom-right (no float quirks with pre-wrap)
        const sp=document.createElement('span');sp.className='mtxt-spacer';t.appendChild(sp);
        t.appendChild(makeMeta(m,isMe,sending,'mtxt-meta'));
        if(mediaCaption){
          const cap=document.createElement('div');cap.className='mcap';
          cap.appendChild(t);body.appendChild(cap);
        } else {
          body.appendChild(t);
        }
      }
    }
  }

    // Link preview: attach async after text block (skip media-only and temp messages)
    if(hasText && !sending && !isTemp(m.id)) {
      attachLinkPreview(body, m.body);
    }

    if(!hasText && m.media_type!=='voice'){

    if(mediaOnly){
      body.appendChild(makeMeta(m,isMe,sending));
    } else if(!mediaCaption){
      const bottom=document.createElement('div');bottom.className='mbottom';
      bottom.appendChild(makeMeta(m,isMe,sending));body.appendChild(bottom);
    }
  }
  }

  const _isTouch=()=>'ontouchstart' in window;

  if(!sending){
    if(_isTouch()){
      // ── Mobile: single tap → dim + ctx menu (instant) | long press (700ms) → select ──
      let _selTimer=null, _moved=false, _startX=0, _startY=0, _blocked=false, _longFired=false;

      body.addEventListener('touchstart',e=>{
        if(S.selectMode)return; // in select mode, tap = checkbox
        // If touching media, don't interfere
        if(e.target.closest('.mmedia,.mmedia-video,.voice-msg')){_blocked=true;return;}
        _blocked=false;
        _moved=false;
        _longFired=false;
        _startX=e.touches[0].clientX;
        _startY=e.touches[0].clientY;

        // Long press → selection mode (700ms)
        _selTimer=setTimeout(()=>{
          _selTimer=null;
          if(_moved||_blocked)return;
          _longFired=true;
          navigator.vibrate&&navigator.vibrate(40);
          enterSelectMode(m.id);
          renderMsgsSelect();
        },700);
      },{passive:true});
      body.addEventListener('touchmove',e=>{
        if(Math.abs(e.touches[0].clientX-_startX)>10||Math.abs(e.touches[0].clientY-_startY)>10){
          _moved=true;
          clearTimeout(_selTimer);_selTimer=null;
        }
      },{passive:true});
      body.addEventListener('touchend',e=>{
        clearTimeout(_selTimer);_selTimer=null;
        if(_moved||_blocked||_longFired)return;
        // Single tap → dim + context menu immediately
        const t=e.changedTouches?.[0];
        if(t){
          const msgsEl=row.closest('.msgs');
          if(msgsEl){
            msgsEl.classList.add('msg-dim-active');
            row.classList.add('msg-ctx-target');
          }
          showCtx({clientX:t.clientX,clientY:t.clientY},m);
        }
      });
      body.addEventListener('touchcancel',()=>{
        clearTimeout(_selTimer);_selTimer=null;
        _blocked=false;
        _longFired=false;
      });
      body.addEventListener('contextmenu',e=>{e.preventDefault();});// block native on mobile

    } else {
      // ── Desktop: right-click context menu ──────────────────────────
      body.addEventListener('contextmenu',e=>{e.preventDefault();if(!S.selectMode)showCtx(e,m);});
    }
  }
  // Select mode click (both desktop + mobile)
  row.addEventListener('click',e=>{
    if(!S.selectMode)return;
    e.stopPropagation();
    if(S.selected.has(m.id))S.selected.delete(m.id);
    else S.selected.add(m.id);
    row.classList.toggle('selected',S.selected.has(m.id));
    updateSelBar();
  });

  // Quick reply on double click
  row.addEventListener('dblclick', e => {
    if(S.selectMode || !S.quickReply) return;
    // Игнорируем двойной клик по интерактивным элементам внутри пузыря
    if(e.target.closest('.single-media') || e.target.closest('.vid-wrap') || e.target.closest('.rxn-wrap') || e.target.closest('.msg-link') || e.target.closest('.mention') || e.target.closest('.spoiler') || e.target.closest('.rply') || e.target.closest('.voice-msg')) return;
    
    e.preventDefault();
    row.classList.add('quick-reply-anim');
    setTimeout(() => row.classList.remove('quick-reply-anim'), 500);

    let bodyPrev = m.body || 'Медиафайл';
    const cm = typeof bodyPrev === 'string' ? bodyPrev.match(/^\[call:(missed|declined|ended)(?::(\d+))?\]$/) : null;
    if(cm) {
      if (cm[1] === 'ended') bodyPrev = '📞 Звонок завершен';
      else if (cm[1] === 'missed') bodyPrev = '📞 Пропущенный звонок';
      else bodyPrev = '📞 Отклонённый звонок';
    }
    S.replyTo = { id: m.id, sender_name: m.nickname || 'Пользователь', body: bodyPrev };
    $('rbar-who').textContent = S.replyTo.sender_name;
    $('rbar-txt').textContent = hideSpoilerText(S.replyTo.body).slice(0, 80);
    showRbar();
    $('mfield').focus();
  });

  bub.appendChild(body);
  if(mediaOnly&&hasRxns){const rw=document.createElement('div');rw.className='rxn-wrap';rw.style.cssText=`display:flex;flex-wrap:wrap;gap:4px;margin-top:5px;width:100%;${isMe?'justify-content:flex-end':''}`;rw.appendChild(makeRxnRow(m.id,rxns));bub.appendChild(rw);}
  row.appendChild(isMe?bub:aviEl);row.appendChild(isMe?aviEl:bub);
  return row;
}

/* ══ GRID ════════════════════════════════════════════════════ */
function makeGridEl(msgs,newSender=true){
  const isMe=msgs[0].sender_id==S.user?.id;
  const row=document.createElement('div');row.className=`mrow${isMe?' me':''}${newSender?' ns':''}`;if(msgs[0].batch_id)row.dataset.batch=msgs[0].batch_id;
  // Checkbox for select mode
  const cb=document.createElement('div');cb.className='msg-checkbox';row.appendChild(cb);
  const aviEl=document.createElement('div');aviEl.className='mavi'+(isMe?' ghost':'');if(!isMe)aviEl.innerHTML=aviHtml(msgs[0].nickname,msgs[0].avatar_url);
  const bub=document.createElement('div');bub.className='mbub';
  const n=msgs.length,cls=n===2?'g2':n===3?'g3':n===4?'g4':'g6plus';
  const grid=document.createElement('div');grid.className=`mgrid ${cls}`;
  const viewItems=msgs.map(m=>({url:m.media_url,type:m.media_type}));
  const batchIds=msgs.map(m=>m.id);
  const toggleSelect=()=>{
    if(!S.selectMode)return;
    const allSelected=batchIds.every(id=>S.selected.has(id));
    batchIds.forEach(id=>{ if(allSelected) S.selected.delete(id); else S.selected.add(id); });
    row.classList.toggle('selected',!allSelected);
    updateSelBar();
  };
  const maxShow=Math.min(n,6);
  msgs.slice(0,maxShow).forEach((m,i)=>{
    const gi=document.createElement('div');gi.className='gi';gi.dataset.id=m.id;
    const img=document.createElement('img');img.src=m.media_url;img.loading='lazy';img.alt='';gi.appendChild(img);
    if(i===5&&n>6){const more=document.createElement('div');more.className='gi-more';more.textContent=`+${n-5}`;gi.appendChild(more);}
    gi.onclick=e=>{if(S.selectMode){e.stopPropagation();toggleSelect();return;}openChatViewer(m.id);};grid.appendChild(gi);
  });
  const last=msgs[msgs.length-1];
  const captionMsg=[...msgs].reverse().find(m=>m.body&&m.body.trim());
  const ctxTarget=captionMsg||msgs[0];
  row.dataset.id=ctxTarget.id;
  const rxns=sortRxns(S.rxns[ctxTarget.id]||(Array.isArray(ctxTarget.reactions)?ctxTarget.reactions:[]));
  const hasRxns=rxns.length>0;
  const mwrap=document.createElement('div');mwrap.className='mgrid-wrap';mwrap.classList.add(cls);mwrap.appendChild(grid);
  if(captionMsg){
    const body=document.createElement('div');
    body.className='mbody has-media-caption';
    const t=document.createElement('div');t.className='mtxt';
    t.innerHTML=fmtText(captionMsg.body);
    walkTextNodes(t);
    const cap=document.createElement('div');cap.className='mcap';
    if(hasRxns){
      // Reactions present: timestamp moves to rxns-only row
      const rb=document.createElement('div');rb.className='mbottom rxns-only';
      rb.appendChild(makeRxnRow(ctxTarget.id,rxns));
      rb.appendChild(makeMeta(last,isMe,false,'mtxt-meta'));
      cap.appendChild(t);
      cap.appendChild(rb);
    } else {
      // Phantom-spacer approach
      const spG=document.createElement('span');spG.className='mtxt-spacer';t.appendChild(spG);
      t.appendChild(makeMeta(last,isMe,false,'mtxt-meta'));
      cap.appendChild(t);
    }
    body.appendChild(mwrap);
    body.appendChild(cap);
    bub.appendChild(body);
    body.addEventListener('contextmenu',e=>{e.preventDefault();e.stopPropagation();if(!S.selectMode)showCtx(e,ctxTarget);});
  } else {
    const body=document.createElement('div');
    body.className='mbody media-only';
    body.appendChild(mwrap);
    body.appendChild(makeMeta(last,isMe,false));
    bub.appendChild(body);
    if(hasRxns){
      const rw=document.createElement('div');rw.className='rxn-wrap';
      rw.style.cssText=`display:flex;flex-wrap:wrap;gap:4px;margin-top:5px;width:100%;${isMe?'justify-content:flex-end':''}`;
      rw.appendChild(makeRxnRow(ctxTarget.id,rxns));
      bub.appendChild(rw);
    }
  }
  grid.addEventListener('contextmenu',e=>{e.preventDefault();e.stopPropagation();if(!S.selectMode)showCtx(e,ctxTarget);});
  row.addEventListener('click',e=>{
    if(!S.selectMode)return;
    e.stopPropagation();
    toggleSelect();
  });

  // Quick reply for grids
  row.addEventListener('dblclick', e => {
    if(S.selectMode || !S.quickReply) return;
    if(e.target.closest('.single-media') || e.target.closest('.vid-wrap') || e.target.closest('.rxn-wrap') || e.target.closest('.msg-link') || e.target.closest('.mention') || e.target.closest('.spoiler') || e.target.closest('.rply') || e.target.closest('.voice-msg')) return;
    
    e.preventDefault();
    row.classList.add('quick-reply-anim');
    setTimeout(() => row.classList.remove('quick-reply-anim'), 500);

    let bodyPrev = ctxTarget.body || 'Медиафайл';
    S.replyTo = { id: ctxTarget.id, sender_name: ctxTarget.nickname || 'Пользователь', body: bodyPrev };
    $('rbar-who').textContent = S.replyTo.sender_name;
    $('rbar-txt').textContent = hideSpoilerText(S.replyTo.body).slice(0, 80);
    showRbar();
    $('mfield').focus();
  });

  row.appendChild(isMe?bub:aviEl);row.appendChild(isMe?aviEl:bub);return row;
}

/* ══ REACTIONS PREMIUM (макс 3, при 4-ой удаляется самая старая) ═══════════════════════════ */
function manageReactionsLimit(msgId, newEmoji) {
  const reactions = S.rxns[+msgId] || [];
  const myReactions = reactions.filter(r => r.by_me);
  
  // Если это уже существующая реакция (переключение), не применяем лимит
  const existingMyReaction = myReactions.find(r => normEmoji(r.emoji) === normEmoji(newEmoji));
  if (existingMyReaction) return null; // Просто переключаем существующую
  
  // Если у меня уже 3 реакции, нужно удалить самую старую
  if (myReactions.length >= 3) {
    // Находим самую старую реакцию (по времени или по порядку)
    const oldestReaction = myReactions.reduce((oldest, current) => {
      // Если нет времени создания, используем порядок в массиве
      if (!oldest.created_at) return oldest;
      if (!current.created_at) return current;
      return current.created_at < oldest.created_at ? current : oldest;
    }, myReactions[0]);
    
    return oldestReaction.emoji; // Возвращаем эмодзи для удаления
  }
  
  return null; // Можно добавлять новую реакцию
}

async function toggleRxn(msgId, emoji, byMe){
  if(isTemp(msgId)){toast('Подождите — сообщение отправляется…');return;}
  
  // Если это добавление новой реакции, проверяем лимит
  if (!byMe) {
    const oldestToRemove = manageReactionsLimit(msgId, emoji);
    
    if (oldestToRemove) {
      // Сначала удаляем самую старую реакцию
      const deleteResult = await api('react_message', 'DELETE', {
        message_id: +msgId, 
        emoji: oldestToRemove
      });
      
      if (!deleteResult.ok) {
        toast('Ошибка при обновлении реакций', 'err');
        return;
      }
      
      // Обновляем локальное состояние после удаления
      if (deleteResult.reactions) {
        patchRxnDom(+msgId, deleteResult.reactions);
        S.rxns[+msgId] = deleteResult.reactions;
      }
      
      // Небольшая задержка для плавности
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  // Отправляем запрос на добавление/удаление реакции
  const method = byMe ? 'DELETE' : 'POST';
  const body = { message_id: +msgId, emoji };
  
  const res = await api('react_message', method, body);
  if (res.ok) {
    withScrollAnchor(()=>patchRxnDom(+msgId, res.reactions));
    // syncRxns не нужен — у нас уже есть свежие данные из res.reactions
  } else {
    toast(res.message || 'Ошибка реакции', 'err');
  }
}

function sortRxns(rxns){return[...rxns].sort((a,b)=>{if(b.count!==a.count)return b.count-a.count;return(b.created_at||0)-(a.created_at||0);});}
function makeRxnRow(msgId,rxns){const row=document.createElement('div');row.className='rxns';row.dataset.for=msgId;rxns.forEach(r=>row.appendChild(makeChip(msgId,r)));return row;}

function makeChip(msgId, r) {
  const chip = document.createElement('div');
  chip.className = 'rxn' + (r.by_me ? ' mine' : '');
  chip.dataset.msg = msgId;
  chip.dataset.emoji = r.emoji;
  
  const ico = document.createElement('span');
  ico.className = 'rxn-ico emo-s';
  ico.textContent = r.emoji;
  
  chip.appendChild(ico);
  chip.appendChild(Object.assign(document.createElement('span'), {
    className: 'rxn-n',
    textContent: r.count
  }));
  
  chip.onclick = () => {
    const fresh = S.rxns[+msgId] || [];
    const entry = fresh.find(x => normEmoji(x.emoji) === normEmoji(r.emoji));
    toggleRxn(+msgId, r.emoji, !!(entry && entry.by_me));
  };
  
  return chip;
}

function patchRxnDom(msgId,rxns){
  S.rxns[msgId]=rxns;
  const msgRow=document.querySelector(`.mrow[data-id="${msgId}"]`);if(!msgRow)return;
  const body=msgRow.querySelector('.mbody');if(!body)return;
  const isMe=msgRow.classList.contains('me');
  const bub=msgRow.querySelector('.mbub');if(!bub)return;

  const isTextBubble=!!(body.querySelector('.mtxt')||body.querySelector('.mcap'));

  // Existing rxns container and row
  let rxnContainer=body.querySelector('.mbottom.rxns-only')||bub.querySelector('.rxn-wrap');
  let row=rxnContainer?.querySelector('.rxns');

  // Helper: get the text parent (.mcap or .mbody) and the .mtxt element
  const textParent=body.querySelector('.mcap')||body;
  const mtxtEl=body.querySelector('.mtxt');

  if(!rxns.length){
    if(row){
      row.querySelectorAll('.rxn').forEach((chip,i)=>{
        chip.style.animationDelay=(i*20)+'ms';
        chip.classList.add('rxn-exit');
      });
      const delay=row.querySelectorAll('.rxn').length*25+200;
      setTimeout(()=>{
        if(isTextBubble&&rxnContainer){
          // Move .mtxt-meta back into .mtxt — prepend (firstChild) for float:right Telegram layout
          const metaEl=rxnContainer.querySelector('.mtxt-meta');
          if(metaEl&&mtxtEl){
            // Re-add phantom spacer before restoring meta
            let spR=mtxtEl.querySelector('.mtxt-spacer');
            if(!spR){spR=document.createElement('span');spR.className='mtxt-spacer';mtxtEl.appendChild(spR);}
            mtxtEl.appendChild(metaEl);
          }
          rxnContainer.remove();
        } else if(rxnContainer){
          rxnContainer.remove();
        }
      },delay);
    }
    const m2=S.msgs[S.chatId]?.find(x=>x.id==msgId);if(m2)m2.reactions=rxns;
    return;
  }

  // Build map of existing chips
  // Sort: higher count first; equal count → newer first (by created_at)
  const sorted=sortRxns(rxns);
  rxns=sorted;

  const existing=new Map();
  if(row)row.querySelectorAll('.rxn').forEach(c=>existing.set(c.dataset.emoji,c));
  const newEmojiKeys=new Set(rxns.map(r=>r.emoji));

  // Create rxns container if missing
  if(!rxnContainer){
    row=document.createElement('div');row.className='rxns';row.dataset.for=msgId;
    if(isTextBubble){
      // Create .mbottom.rxns-only with rxns + timestamp
      rxnContainer=document.createElement('div');rxnContainer.className='mbottom rxns-only';
      rxnContainer.appendChild(row);
      // Pull .mtxt-meta out of .mtxt and append it to rxns row (right side)
      const metaEl=mtxtEl&&mtxtEl.querySelector('.mtxt-meta');
      if(metaEl){rxnContainer.appendChild(metaEl);}
      textParent.appendChild(rxnContainer);
    } else {
      const wrap=document.createElement('div');wrap.className='rxn-wrap';
      wrap.style.cssText=`display:flex;flex-wrap:wrap;gap:4px;margin-top:5px;width:100%;${isMe?'justify-content:flex-end':''}`;
      wrap.appendChild(row);rxnContainer=wrap;bub.appendChild(wrap);
    }
  }

  // Remove chips no longer in rxns (animate out)
  existing.forEach((chip,emoji)=>{
    if(!newEmojiKeys.has(emoji)){
      chip.classList.add('rxn-exit');
      setTimeout(()=>chip.remove(),200);
    }
  });

  // Add or update chips
  rxns.forEach((r,idx)=>{
    if(existing.has(r.emoji)){
      // Update existing chip
      const chip=existing.get(r.emoji);
      const wasMine=chip.classList.contains('mine');
      if(wasMine!==r.by_me){chip.classList.toggle('mine',r.by_me);}
      const nEl=chip.querySelector('.rxn-n');
      if(nEl&&+nEl.textContent!==r.count){
        nEl.textContent=r.count;
        chip.classList.remove('rxn-bump');
        void chip.offsetWidth; // reflow
        chip.classList.add('rxn-bump');
      }
      chip.dataset.emoji=r.emoji;
      chip.onclick=()=>{const fresh=S.rxns[+msgId]||[];const entry=fresh.find(x=>normEmoji(x.emoji)===normEmoji(r.emoji));toggleRxn(+msgId,r.emoji,!!(entry&&entry.by_me));};
    } else {
      // New chip — animate in with stagger
      const chip=makeChip(msgId,r);
      chip.style.animationDelay=(idx*18)+'ms';
      chip.classList.add('rxn-enter');
      row.appendChild(chip);
    }
  });

  // Re-order to match server order (only if needed)
  let needsReorder = false;
  const chips = [...row.querySelectorAll('.rxn:not(.rxn-exit)')];
  rxns.forEach((r, i) => { if(chips[i]?.dataset.emoji !== r.emoji) needsReorder = true; });
  if(needsReorder) {
    rxns.forEach(r=>{
      const chip=row.querySelector(`.rxn[data-emoji="${CSS.escape(r.emoji)}"]`);
      if(chip&&!chip.classList.contains('rxn-exit'))row.appendChild(chip);
    });
  }

  const m2=S.msgs[S.chatId]?.find(x=>x.id==msgId);if(m2)m2.reactions=rxns;
}

/* ══ SELECT MODE ══════════════════════════════════════════════ */
function enterSelectMode(msgId){
  S.selectMode=true;S.selected.clear();if(msgId)S.selected.add(msgId);
  $('select-bar').classList.add('on');$('input-zone').style.display='none';
  // Clear any message dimming from context menu
  document.querySelectorAll('.msg-dim-active').forEach(el=>el.classList.remove('msg-dim-active'));
  document.querySelectorAll('.msg-ctx-target').forEach(el=>el.classList.remove('msg-ctx-target'));
  const dimEl=$('msg-ctx-dim');if(dimEl)dimEl.classList.remove('on');
  hideCtx&&hideCtx();
  // Re-render all messages to show checkboxes
  if(S.chatId)renderMsgsSelect();updateSelBar();
}
function exitSelectMode(){
  S.selectMode=false;S.selected.clear();
  $('select-bar').classList.remove('on');$('input-zone').style.display='';
  // Remove selection classes
  $$('.mrow').forEach(r=>{r.classList.remove('selectable','selected');});
  // Re-add selectable if still in mode (we're not so just clean up)
}
function renderMsgsSelect(){
  $$('.mrow:not([data-id^="t"])').forEach(r=>{
    r.classList.add('selectable');
    if(r.dataset.batch){
      const batchMsgs=getBatchMsgs(r.dataset.batch);
      const allSelected=batchMsgs.length&&batchMsgs.every(m=>S.selected.has(m.id));
      r.classList.toggle('selected',allSelected);
      return;
    }
    r.classList.toggle('selected',S.selected.has(+r.dataset.id||r.dataset.id));
  });
}
function updateSelBar(){
  const n=S.selected.size;
  $('sel-count').textContent=n===0?'Выберите сообщения':`${n} выбрано`;
  // Auto-exit selection mode when all messages are deselected
  if(n===0&&S.selectMode){
    exitSelectMode();
  }
}
const btnSelMode=$('btn-sel-mode');if(btnSelMode)btnSelMode.onclick=()=>{if(S.selectMode)exitSelectMode();else enterSelectMode(null);};
$('sel-cancel-btn').onclick=exitSelectMode;
$('sel-copy-btn').onclick=()=>{
  const texts=[];S.selected.forEach(id=>{
    const m=S.msgs[S.chatId]?.find(x=>x.id==id);
    if(m?.body){
      const cm = m.body.match(/^\[call:(missed|declined|ended)(?::(\d+))?\]$/);
      if(cm) {
        if (cm[1] === 'ended') texts.push('📞 Звонок завершен');
        else if (cm[1] === 'missed') texts.push('📞 Пропущенный звонок');
        else texts.push('📞 Отклонённый звонок');
      } else {
        texts.push(m.body);
      }
    }
  });
  if(texts.length)navigator.clipboard.writeText(texts.join('\n\n')).then(()=>{toast('Скопировано');exitSelectMode();});
};
$('sel-del-btn').onclick=()=>{
  const ids=[...S.selected].filter(id=>!isTemp(id));if(!ids.length)return;
  showConfirm(`Удалить ${ids.length} сообщение${ids.length>1?'й':''}?`,'Сообщения будут удалены для всех участников.',async()=>{
    exitSelectMode();
    // Fire all DELETE requests in parallel
    await Promise.all(ids.map(id=>api('delete_message','POST',{message_id:+id})));
    // Animate all rows simultaneously with slight stagger
    ids.forEach((id,i)=>{
      if(S.msgs[S.chatId])S.msgs[S.chatId]=S.msgs[S.chatId].filter(m=>m.id!==id);
      const el=document.querySelector(`.mrow[data-id="${id}"]`);
      if(el) setTimeout(()=>deleteMsgEl(el), i*35); // 35ms stagger per message
    });
    toast('Удалено');
  });
};

function getBatchMsgs(batchId){
  if(!batchId||!S.chatId)return[];
  return (S.msgs[S.chatId]||[]).filter(m=>m.batch_id===batchId);
}
function selectBatchInSelectMode(batchId){
  const batchMsgs=getBatchMsgs(batchId);
  if(!batchMsgs.length)return;
  batchMsgs.forEach(m=>S.selected.add(m.id));
  renderMsgsSelect();
  updateSelBar();
}
async function deleteBatch(batchId){
  const batchMsgs=getBatchMsgs(batchId);
  if(!batchMsgs.length)return;
  await Promise.all(batchMsgs.map(m=>api('delete_message','POST',{message_id:+m.id})));
  if(S.msgs[S.chatId])S.msgs[S.chatId]=S.msgs[S.chatId].filter(m=>m.batch_id!==batchId);
  batchMsgs.forEach(m=>{delete S.rxns[m.id];});
  const gridEl=document.querySelector(`.mrow[data-batch="${batchId}"]`);
  if(gridEl)deleteMsgEl(gridEl);
  else batchMsgs.forEach((m,i)=>{const el=document.querySelector(`.mrow[data-id="${m.id}"]`);if(el)setTimeout(()=>deleteMsgEl(el),i*35);});
  toast('Удалено');
}

// Edit state
let editingMsgId = null;
function startEdit(m) {
  // Cannot edit voice messages or call messages
  if (m.media_type === 'voice' || /^\[call:/.test(m.body || '')) return;
  editingMsgId = m.id;
  mfield.innerHTML='';
  mfield.appendChild(emojiToFrag(m.body||'',true));
  mfield.focus();
  // Курсор в конец
  const range=document.createRange();range.selectNodeContents(mfield);range.collapse(false);
  const sel=window.getSelection();sel.removeAllRanges();sel.addRange(range);
  $('rbar-who').textContent = 'Редактирование';
  $('rbar-txt').textContent = hideSpoilerText(m.body).slice(0, 80);
  showRbar();
  const el = document.querySelector(`.mrow[data-id="${m.id}"]`);
  if (el) { el.classList.add('msg-flash'); setTimeout(() => el.classList.remove('msg-flash'), 1000); }
}
function cancelEdit() {
  editingMsgId = null;
  clearField(); updateSendBtn();
  hideRbar();
  S.replyTo = null;
}

$('rbar-x').onclick=()=>{if(editingMsgId){cancelEdit();}else{S.replyTo=null;hideRbar();}}
/* ══ SEND TEXT ════════════════════════════════════════════════ */
const mfield=$('mfield');

// ── Plain-text extraction from pasted HTML ────────────────────
function htmlToPlainText(html){
  const tmp=document.createElement('div');
  tmp.innerHTML=html;
  // Walk DOM: collect text, emit newlines at block boundaries
  let out='';
  let needNl=false;
  const BLOCK=new Set(['P','DIV','BR','LI','TR','H1','H2','H3','H4','H5','H6','BLOCKQUOTE','PRE','HR','FIGURE','SECTION','ARTICLE','HEADER','FOOTER','MAIN','ASIDE','NAV','UL','OL','TABLE','THEAD','TBODY','TFOOT']);
  function walk(node){
    if(node.nodeType===3){
      const t=node.textContent;
      if(t){
        if(needNl){out+='\n';needNl=false;}
        out+=t;
      }
    } else if(node.nodeType===1){
      const tag=node.tagName;
      if(tag==='BR'){needNl=true;return;}
      // For <a> tags: prefer the href (actual URL) over the link text (page title)
      if(tag==='A'){
        const href=node.getAttribute('href')||'';
        const innerText=node.textContent||'';
        const isUrlText=/^https?:\/\//i.test(innerText.trim());
        // If link text already looks like a URL, use it; otherwise use href
        const urlToEmit=(isUrlText?innerText.trim():href)||innerText;
        if(urlToEmit){
          if(needNl){out+='\n';needNl=false;}
          // Only emit if it's a real http link (skip mailto:, #, javascript:, etc.)
          if(/^https?:\/\//i.test(urlToEmit)){out+=urlToEmit;}
          else{out+=innerText;}
        }
        return;
      }
      if(BLOCK.has(tag)&&out&&!out.endsWith('\n'))needNl=true;
      for(const c of node.childNodes)walk(c);
      if(BLOCK.has(tag)&&out&&!out.endsWith('\n'))needNl=true;
    }

  }
  walk(tmp);
  return out.replace(/\r\n/g,'\n').replace(/[ \t]{2,}/g,' ').replace(/\n{3,}/g,'\n\n').trim();
}

mfield.addEventListener('paste',e=>{
  // ── Media files → open send preview ──────────────────────────
  const items=[...(e.clipboardData?.items||[])];
  const mediaItems=items.filter(it=>it.kind==='file'&&(it.type.startsWith('image/')||it.type.startsWith('video/')));
  if(mediaItems.length){
    e.preventDefault();
    const files=mediaItems.map(it=>it.getAsFile()).filter(Boolean);
    if(files.length)openSendPreview(files);
    return;
  }
  // ── Text: always strip formatting, insert plain text ─────────
  const html=e.clipboardData?.getData('text/html')||'';
  if(html){
    e.preventDefault();
    const plain=htmlToPlainText(html);
    if(plain)document.execCommand('insertText',false,plain);
    return;
  }
  // Plain text fallback — let browser handle (already plain)
});

// ── Contenteditable helpers ───────────────────────────────────
function getFieldText(){
  // Field is plain text + br/div structure from Enter
  let out='';
  let firstBlock=true;
  function walk(node){
    if(node.nodeType===3){out+=node.textContent;}
    else if(node.nodeType===1){
      const tag=node.tagName;
      if(tag==='BR'){out+='\n';}
      else if(tag==='IMG'){out+=node.alt||'';}
      else if(tag==='SPAN'&&node.classList.contains('emo-field')){out+=node.textContent||'';}
      else if(tag==='STRONG'||tag==='B'){out+='**';for(const c of node.childNodes)walk(c);out+='**';}
      else if(tag==='EM'||tag==='I'){out+='*';for(const c of node.childNodes)walk(c);out+='*';}
      else if(tag==='DEL'||tag==='S'){out+='~~';for(const c of node.childNodes)walk(c);out+='~~';}
      else if(tag==='U'){out+='__';for(const c of node.childNodes)walk(c);out+='__';}
      else if(tag==='CODE'){out+='`';out+=node.textContent;out+='`';}
      else if(tag==='PRE'){out+='```\n'+node.textContent+'\n```';}
      else if(tag==='SPAN'&&node.classList.contains('spoiler-field')){out+='||';for(const c of node.childNodes)walk(c);out+='||';}
      else{for(const c of node.childNodes)walk(c);}
    }
  }
  for(const c of mfield.childNodes){
    if(c.nodeType===1&&c.tagName==='DIV'){
      if(!firstBlock)out+='\n';
      firstBlock=false;
      walk(c);
    } else {firstBlock=false;walk(c);}
  }
  return out.replace(/\u200B/g,'').replace(/\n{3,}/g,'\n\n').trim();
}

function clearField(){mfield.innerHTML='';mfield.style.height='';}
function insertTextAtCursor(text){
  mfield.focus();
  document.execCommand('insertText',false,text);
}
// Конвертирует строку с emoji в DocumentFragment со span-элементами
function mkEmoImg(e){
  const span=document.createElement('span');
  span.className='emo-s txt-emo';
  span.textContent=e;
  return span;
}
// For use inside contenteditable field — plain text, no wrapping
// (font stack on .mfield handles emoji rendering via EmojiLocal)
function emojiToFrag(text,forField=false){
  const frag=document.createDocumentFragment();
  if(forField){
    frag.appendChild(document.createTextNode(text));
    return frag;
  }
  const re=mkEMORE();
  let last=0,m;
  re.lastIndex=0;
  while((m=re.exec(text))!==null){
    if(m.index>last)frag.appendChild(document.createTextNode(text.slice(last,m.index)));
    frag.appendChild(mkEmoImg(m[0]));
    last=m.index+m[0].length;
  }
  if(last<text.length)frag.appendChild(document.createTextNode(text.slice(last)));
  return frag;
}

/* ══ FORMATTING TOOLBAR ══════════════════════════════════════ */
const fmtBar=$('fmt-bar');
const fmtBtns=$$('.fmt-btn[data-cmd]');

// Preserve selection when interacting with custom context menus / buttons.
let _fieldSavedRange = null;
function saveFieldSelection(){
  const sel = window.getSelection();
  if(!sel || sel.rangeCount===0) return;
  const r = sel.getRangeAt(0);
  const bio = $('pm-bio');
  const inMfield = mfield && mfield.contains(r.commonAncestorContainer);
  const inBio    = bio && bio.contains(r.commonAncestorContainer);
  if(inMfield || inBio) _fieldSavedRange = r.cloneRange();
}
function restoreFieldSelection(){
  if(!_fieldSavedRange) return;
  const sel = window.getSelection();
  if(!sel) return;
  sel.removeAllRanges();
  sel.addRange(_fieldSavedRange);
}

function getFieldSel(){
  const sel=window.getSelection();
  if(!sel||sel.isCollapsed||!sel.rangeCount)return null;
  const r=sel.getRangeAt(0);
  if(!mfield.contains(r.commonAncestorContainer))return null;
  return sel;
}

function _textNodesInRange(range, root){
  const out=[];
  if(!range || !root) return out;
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node){
      if(!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      try{
        // intersectsNode may throw for some nodes in Safari; guard anyway
        return range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }catch{
        return NodeFilter.FILTER_REJECT;
      }
    }
  });
  let n;
  while((n=tw.nextNode())) out.push(n);
  return out;
}

function _closestEl(n){
  if(!n) return null;
  return n.nodeType===1 ? n : n.parentElement;
}

function _rangeFullyMatchesSelector(range, root, selector){
  const nodes = _textNodesInRange(range, root);
  if(!nodes.length) return false;
  return nodes.every(tn => {
    const el = _closestEl(tn);
    return !!el && !!el.closest(selector);
  });
}

function _rangeFullyHasInlineStyle(range, root, styleKey, expected){
  const nodes = _textNodesInRange(range, root);
  if(!nodes.length) return false;
  return nodes.every(tn => {
    const el = _closestEl(tn);
    if(!el) return false;
    const cs = getComputedStyle(el);
    return cs && cs[styleKey] === expected;
  });
}

function wrapSelectionWith(tag,cls){
  restoreFieldSelection();
  const sel=window.getSelection();
  if(!sel||sel.isCollapsed||!sel.rangeCount)return;
  const range=sel.getRangeAt(0);
  const el=document.createElement(tag);
  if(cls)el.className=cls;
  try{range.surroundContents(el);}catch{
    const frag=range.extractContents();
    el.appendChild(frag);
    range.insertNode(el);
  }
  sel.removeAllRanges();
  const r=document.createRange();
  r.selectNodeContents(el);
  r.collapse(false);
  sel.addRange(r);
}

// Unwrap a formatting element that contains/covers the current selection
function unwrapSelectionBy(selector){
  restoreFieldSelection();
  const sel=window.getSelection();
  if(!sel||!sel.rangeCount)return;
  const range=sel.getRangeAt(0);
  const nodes=_textNodesInRange(range, mfield);
  const toUnwrap=new Set();
  nodes.forEach(n=>{
    const el=_closestEl(n);
    if(!el)return;
    const match=el.closest(selector);
    if(match&&mfield.contains(match))toUnwrap.add(match);
  });
  if(sel.isCollapsed){
    const anc=range.commonAncestorContainer;
    const el=_closestEl(anc)?.closest(selector);
    if(el&&mfield.contains(el))toUnwrap.add(el);
  }
  toUnwrap.forEach(el=>{
    const parent=el.parentNode;
    while(el.firstChild)parent.insertBefore(el.firstChild,el);
    parent.removeChild(el);
  });
  mfield.normalize();
}

// Sync active states of .fctx-fmt-btn with current selection formatting
function updateFmtBtnsCtx(activeField){
  const field = activeField || mfield;
  const sel=window.getSelection();
  if(!sel || sel.rangeCount===0) return;
  const r = sel.getRangeAt(0);
  if(!field || !field.contains(r.commonAncestorContainer)) return;
  $$('.fctx-fmt-btn').forEach(btn=>{
    const cmd=btn.dataset.cmd;
    if(!cmd) return;
    let active=false;
    if(sel.isCollapsed){
      if(cmd==='bold')       active=document.queryCommandState('bold');
      else if(cmd==='italic')active=document.queryCommandState('italic');
      else if(cmd==='underline')active=document.queryCommandState('underline');
      else if(cmd==='strikeThrough')active=document.queryCommandState('strikeThrough');
      else if(cmd==='mono'){
        const a=r.commonAncestorContainer;
        active=!!_closestEl(a)?.closest('code');
      } else if(cmd==='spoiler'){
        const a=r.commonAncestorContainer;
        active=!!_closestEl(a)?.closest('.spoiler-field');
      }
    } else {
      if(cmd==='bold')       active=_rangeFullyMatchesSelector(r, field, 'b,strong') || _rangeFullyHasInlineStyle(r, field, 'fontWeight', '700');
      else if(cmd==='italic')active=_rangeFullyMatchesSelector(r, field, 'i,em') || _rangeFullyHasInlineStyle(r, field, 'fontStyle', 'italic');
      else if(cmd==='underline')active=_rangeFullyMatchesSelector(r, field, 'u') || _rangeFullyMatchesSelector(r, field, '[style*="text-decoration"]') && _rangeFullyHasInlineStyle(r, field, 'textDecorationLine', 'underline');
      else if(cmd==='strikeThrough')active=_rangeFullyMatchesSelector(r, field, 's,strike,del') || _rangeFullyHasInlineStyle(r, field, 'textDecorationLine', 'line-through');
      else if(cmd==='mono')  active=_rangeFullyMatchesSelector(r, field, 'code');
      else if(cmd==='spoiler')active=_rangeFullyMatchesSelector(r, field, '.spoiler-field');
    }
    btn.classList.toggle('active',active);
  });
}

function updateFmtBar(activeField){
  const field = activeField || mfield;
  const sel = window.getSelection();
  const hasSel = !!(sel && sel.rangeCount && !sel.isCollapsed && field && field.contains(sel.getRangeAt(0).commonAncestorContainer));
  fmtBar.classList.toggle('on',hasSel);
  if(hasSel){
    const r = sel.getRangeAt(0);
    $('fmt-bold').classList.toggle('active', _rangeFullyMatchesSelector(r, field, 'b,strong') || _rangeFullyHasInlineStyle(r, field, 'fontWeight', '700'));
    $('fmt-italic').classList.toggle('active', _rangeFullyMatchesSelector(r, field, 'i,em') || _rangeFullyHasInlineStyle(r, field, 'fontStyle', 'italic'));
    $('fmt-under').classList.toggle('active', _rangeFullyMatchesSelector(r, field, 'u') || _rangeFullyHasInlineStyle(r, field, 'textDecorationLine', 'underline'));
    $('fmt-strike').classList.toggle('active', _rangeFullyMatchesSelector(r, field, 's,strike,del') || _rangeFullyHasInlineStyle(r, field, 'textDecorationLine', 'line-through'));
    $('fmt-mono').classList.toggle('active', _rangeFullyMatchesSelector(r, field, 'code'));
    $('fmt-spoiler').classList.toggle('active', _rangeFullyMatchesSelector(r, field, '.spoiler-field'));
  }
}

fmtBtns.forEach(btn=>{
  btn.addEventListener('mousedown',e=>{
    e.preventDefault();
    restoreFieldSelection();
    const cmd=btn.dataset.cmd;
    if(cmd==='mono'){
      wrapSelectionWith('code');
    } else if(cmd==='spoiler'){
      wrapSelectionWith('span','spoiler-field');
    } else {
      document.execCommand(cmd,false,null);
    }
    if (mfield.lastChild && mfield.lastChild.nodeType === 1) {
      mfield.appendChild(document.createTextNode('\u200B'));
    }
    saveFieldSelection();
    updateFmtBar(mfield);
  });
});

// ── Format buttons inside field-ctx (context menu) ────────────
$$('.fctx-fmt-btn').forEach(btn=>{
  const applyOrToggle=()=>{
    restoreFieldSelection();
    const cmd=btn.dataset.cmd;
    if(!cmd) return;
    const isActive=btn.classList.contains('active');
    if(cmd==='mono'){
      isActive?unwrapSelectionBy('code'):wrapSelectionWith('code');
    } else if(cmd==='spoiler'){
      isActive?unwrapSelectionBy('.spoiler-field'):wrapSelectionWith('span','spoiler-field');
    } else {
      document.execCommand(cmd,false,null); // execCommand auto-toggles
    }
    if (mfield.lastChild && mfield.lastChild.nodeType === 1) {
      mfield.appendChild(document.createTextNode('\u200B'));
    }
    saveFieldSelection();
    hideFieldCtx();
  };
  btn.addEventListener('mousedown',e=>{e.preventDefault();applyOrToggle();});
  btn.addEventListener('touchstart',e=>{e.preventDefault();applyOrToggle();},{passive:false});
});

$('fmt-clear').addEventListener('mousedown',e=>{
  e.preventDefault();
  restoreFieldSelection();
  // Unwrap custom tags inside selection
  const sel=window.getSelection();
  if(sel&&sel.rangeCount){
    const r=sel.getRangeAt(0);
    ['code','.spoiler-field'].forEach(s=>{
      mfield.querySelectorAll(s).forEach(el=>{
        if(r.intersectsNode(el)){
          const parent=el.parentNode;
          while(el.firstChild)parent.insertBefore(el.firstChild,el);
          parent.removeChild(el);
        }
      });
    });
  }
  document.execCommand('removeFormat',false,null);
  saveFieldSelection();
  updateFmtBar(mfield);
});

let _selChangeTid=0;
document.addEventListener('selectionchange', () => {
  clearTimeout(_selChangeTid);
  _selChangeTid = setTimeout(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const r = sel.getRangeAt(0);
    const inMfield = mfield.contains(r.commonAncestorContainer);
    const bio = $('pm-bio');
    const inBio = bio && bio.contains(r.commonAncestorContainer);

    if (inMfield || inBio) {
      saveFieldSelection();
      updateFmtBar(inBio ? bio : mfield);
    } else {
      if (fmtBar) fmtBar.classList.remove('on');
    }
  }, 50);
});

mfield.addEventListener('input',()=>{handleTyping();updateSendBtn();});
mfield.onkeydown=e=>{
  if(e.key==='Enter'){
    if(S.enterSend){
      // Enter = отправить, Shift+Enter = перенос
      if(!e.shiftKey&&!e.ctrlKey&&!e.metaKey){e.preventDefault();sendText();return;}
    } else {
      // Ctrl+Enter / Cmd+Enter = отправить, Enter = перенос
      if(e.ctrlKey||e.metaKey){e.preventDefault();sendText();return;}
    }
  }
    if(e.key==='ArrowUp' && !editingMsgId && !getFieldText()){
      e.preventDefault();
      const msgs = S.msgs[S.chatId] || [];
      for(let i = msgs.length - 1; i >= 0; i--){
        const m = msgs[i];
            if(m.sender_id == S.user?.id && !isTemp(m.id) && m.body && !m.is_deleted && m.media_type !== 'voice' && !/^\[call:/.test(m.body)){
          startEdit(m);
          break;
        }
      }
    }
};
$('btn-send').onclick=sendText;

// ── Send/Voice button toggle ──
function updateSendBtn(){
  const btn=$('btn-send');
  if(!btn)return;
  const text=getFieldText().trim();
  btn.classList.toggle('has-text',!!text);
}

// ── Автофокус: любой печатный символ или Ctrl+V из любого места → mfield ──
document.addEventListener('keydown',function(e){
  if(!S.chatId)return;
  if($('input-zone').style.display==='none')return;
  if(e.target===mfield||mfield.contains(e.target))return;
  if(e.target.closest&&(e.target.closest('.overlay.on')||e.target.closest('.epicker')||e.target.closest('.ctxmenu')))return;
  var tag=e.target.tagName;
  if(tag==='INPUT'||tag==='TEXTAREA'||e.target.isContentEditable)return;
  // Arrow Up — жёсткий захват вне input zone для быстрого редактирования
  if(e.key==='ArrowUp' && !editingMsgId && !getFieldText()){
    e.preventDefault();
    mfield.focus();
    const msgs = S.msgs[S.chatId] || [];
    for(let i = msgs.length - 1; i >= 0; i--){
      const m = msgs[i];
      if(m.sender_id == S.user?.id && !isTemp(m.id) && m.body && !m.is_deleted && m.media_type !== 'voice' && !/^\[call:/.test(m.body)){
        startEdit(m);
        break;
      }
    }
    return;
  }
  if((e.ctrlKey||e.metaKey)&&e.key==='v'){mfield.focus();return;}
  if(e.key.length===1&&!e.ctrlKey&&!e.metaKey&&!e.altKey){
    mfield.focus();
    document.execCommand('insertText',false,e.key);
    e.preventDefault();
  }
},{passive:false});

// ── Emoji picker toggle (не закрывать при вводе emoji) ────────
$('btn-emo-in').onclick=e=>{
  e.stopPropagation();
  const p=$('epicker');
  if(p.classList.contains('on')&&emoMode==='input'){
    p.classList.remove('on');
    $('btn-emo-in').classList.remove('active');
    if(!__isMobileView()) mfield.focus();
  } else {
    const r=$('btn-emo-in').getBoundingClientRect();
    openEmoPicker(r.right, r.top,'input',null);
    $('btn-emo-in').classList.add('active');
    if(!__isMobileView()) mfield.focus();
  }
};

async function sendText(){
  if(!S.partner)return;
  const body=getFieldText(); if(!body)return;

  // ── Edit mode ─────────────────────────────────────────────
  if(editingMsgId){
    const mid=editingMsgId; cancelEdit();
    const orig=S.msgs[S.chatId]?.find(m=>m.id==mid);
    if(orig&&body===orig.body){return;}
    const res=await api('edit_message','POST',{message_id:+mid,body});
    if(res.ok){const m=S.msgs[S.chatId]?.find(m=>m.id==mid);if(m){m.body=body;m.is_edited=1;patchMsgDom(m);}toast('Изменено');}
    else toast(res.message||'Ошибка','err');
    return;
  }

  // ── Normal send ────────────────────────────────────────────
  clearField();updateSendBtn();if(__isMobileView()){mfield.focus();}const replyId=S.replyTo?.id||null;if(S.replyTo){S.replyTo=null;hideRbar();}stopTyping();
  const toSid=S.partner.partner_signal_id;
  if(!S.chatId){const res=await api('send_message','POST',{to_signal_id:toSid,body,reply_to:replyId||undefined});if(!res.ok){toast('Ошибка: '+res.message,'err');return;}S.chatId=res.chat_id;S.lastId[res.chat_id]=res.message_id;S.msgs[res.chat_id]=[];await loadChats();const nc=S.chats.find(c=>c.chat_id===res.chat_id);if(nc){S.partner=nc;$$('.ci').forEach(e=>e.classList.remove('active'));document.querySelector(`.ci[data-chat-id="${res.chat_id}"]`)?.classList.add('active');}$('msgs').innerHTML='';await fetchMsgs(res.chat_id,true);return;}
  const tid='t'+Date.now();
  const tmp={id:tid,sender_id:S.user.id,body,sent_at:Math.floor(Date.now()/1000),is_read:0,is_edited:0,nickname:S.user.nickname,avatar_url:S.user.avatar_url,reply_to:replyId,media_url:null,media_type:null,reactions:[]};
  S.msgs[S.chatId]=S.msgs[S.chatId]||[];S.msgs[S.chatId].push(tmp);S.rxns[tid]=[];
  // Register pending tid so polling/SSE can swap instead of duplicate
  S._pendingTids=S._pendingTids||new Map();
  S._pendingTids.set(tid, body);
  appendMsg(S.chatId,tmp);scrollBot();
  animateSend(tid);
  const payload={to_signal_id:toSid,body};if(replyId)payload.reply_to=replyId;
  const res=await api('send_message','POST',payload);
  S._pendingTids.delete(tid);
  if(!res.ok){toast('Ошибка: '+(res.message||''),'err');document.querySelector(`.mrow[data-id="${tid}"]`)?.remove();if(S.msgs[S.chatId])S.msgs[S.chatId]=S.msgs[S.chatId].filter(m=>m.id!==tid);return;}
  // Promote temp → real id in state and DOM
  if(S.msgs[S.chatId]){const idx=S.msgs[S.chatId].findIndex(m=>m.id===tid);if(idx>=0)S.msgs[S.chatId][idx].id=res.message_id;}
  S.rxns[res.message_id]=S.rxns[tid]||[];delete S.rxns[tid];
  const tmpEl=document.querySelector(`.mrow[data-id="${tid}"]`);
  if(tmpEl){tmpEl.dataset.id=res.message_id;}
  S.lastId[S.chatId]=Math.max(S.lastId[S.chatId]||0,res.message_id);
  const sentMsg=S.msgs[S.chatId]?.find(m=>m.id===res.message_id);
  if(sentMsg)patchMsgDom(sentMsg);
}

/* ══ TYPING ══════════════════════════════════════════════════ */
function handleTyping(){if(!S.chatId)return;if(!S.isTyping){S.isTyping=true;api('update_presence','POST',{typing_chat_id:S.chatId});}clearTimeout(S.typTimer);S.typTimer=setTimeout(stopTyping,3000);}
function stopTyping(){if(!S.isTyping)return;S.isTyping=false;api('update_presence','POST',{typing_chat_id:0});}

// ── Scroll-to-bottom FAB ──────────────────────────────────────
let _sbUnread=0;
function showSBBtn(unread){
  const btn=$('scroll-bot-btn');if(!btn)return;
  if(unread>0)_sbUnread=(_sbUnread||0)+unread;
  btn.classList.add('on');
  const badge=$('scroll-bot-badge');
  if(badge)badge.textContent=_sbUnread>0?String(_sbUnread):'';
}
function hideSBBtn(){
  const btn=$('scroll-bot-btn');if(!btn)return;
  btn.classList.remove('on');
  _sbUnread=0;
  const badge=$('scroll-bot-badge');if(badge)badge.textContent='';
}
(function initSBBtn(){
  const btn=$('scroll-bot-btn');
  if(!btn)return;
  btn.onclick=()=>scrollBot();
  const area=$('msgs');

  // IntersectionObserver для загрузки истории
  const sentinel=document.createElement('div');
  sentinel.className='hist-sentinel';
  area.insertBefore(sentinel,area.firstChild);
  const histObserver=new IntersectionObserver(entries=>{
    if(entries[0].isIntersecting&&S.chatId)loadHistory(S.chatId);
  },{root:area,rootMargin:'400px 0px 0px 0px',threshold:0});
  histObserver.observe(sentinel);
  window._histSentinel=sentinel;
  window._histObserver=histObserver;

  let _scrollRaf=0;
  area.addEventListener('scroll',()=>{
    if(_scrollRaf)return;
    _scrollRaf=requestAnimationFrame(()=>{
      _scrollRaf=0;
      if(nearBot())hideSBBtn();
      // Pre-cache voice messages visible in viewport
      if(window.VoiceMsg&&window.VoiceMsg.precacheVoiceMessages)window.VoiceMsg.precacheVoiceMessages();
      clearTimeout(area._scrollSaveTimer);
      area._scrollSaveTimer=setTimeout(()=>{if(S.chatId)saveScrollPos(S.chatId);},200);
    });
  },{passive:true});

  // ── Sticky date pill: shows current visible date while scrolling ──
  // Ensure pill exists (innerHTML='' wipes may remove it)
  if(!document.getElementById('sticky-date-pill')){
    const pill=document.createElement('div');
    pill.className='sticky-date-pill';
    pill.id='sticky-date-pill';
    pill.innerHTML='<span></span>';
    area.prepend(pill);
  }
  // Dynamic top offset: match chat header height
  function _syncStickyTop(){
    const hdr=document.getElementById('chat-hdr');
    const pill=document.getElementById('sticky-date-pill');
    if(!hdr||!pill)return;
    const hdrR=hdr.getBoundingClientRect();
    const areaR=area.getBoundingClientRect();
    const offset=hdrR.bottom-areaR.top;
    pill.style.top=Math.max(0,Math.round(offset))+'px';
  }
  _syncStickyTop();
  window.addEventListener('resize',_syncStickyTop,{passive:true});
  const _resizeObs=new ResizeObserver(_syncStickyTop);
  const hdr=document.getElementById('chat-hdr');
  if(hdr)_resizeObs.observe(hdr);

  // Expose _syncStickyTop so renderMsgs can call it after rebuilding DOM
  window._syncStickyTop=_syncStickyTop;

  // Scroll handler: always query pill fresh from DOM (it may be recreated by renderMsgs)
  const datePills=()=>area.querySelectorAll('.date-pill');
  let _stickyTimer;
  let _scrollEndTimer;
  area.addEventListener('scroll',()=>{
    // Clear auto-hide timer on every scroll event
    clearTimeout(_scrollEndTimer);
    if(_stickyTimer)return;
    _stickyTimer=requestAnimationFrame(()=>{
      _stickyTimer=0;
      const stickyPill=document.getElementById('sticky-date-pill');
      if(!stickyPill){return;}
      const stickySpan=stickyPill.querySelector('span');
      if(!stickySpan)return;
      const pills=datePills();
      if(!pills.length){stickyPill.classList.remove('visible');return;}
      const aTop=area.scrollTop;
      const aBot=aTop+area.clientHeight;
      let visible=null;
      for(let i=pills.length-1;i>=0;i--){
        const r=pills[i].getBoundingClientRect();
        const aRect=area.getBoundingClientRect();
        if(r.top<=aRect.top+60){visible=pills[i].querySelector('span')?.textContent;break;}
      }
      if(visible&&visible!==stickySpan.textContent){
        stickySpan.textContent=visible;
        stickyPill.classList.add('visible');
      }else if(!visible){
        stickyPill.classList.remove('visible');
      }
      // Auto-hide pill after scrolling stops (1.5s)
      _scrollEndTimer=setTimeout(()=>{
        stickyPill.classList.remove('visible');
      },1500);
    });
  },{passive:true});
})();

// Spoiler reveal on click (delegated)
document.getElementById('msgs').addEventListener('click',e=>{
  const sp=e.target.closest('.spoiler');
  if(sp){sp.classList.toggle('revealed');return;}

  // @mention → open chat with that user
  const mention=e.target.closest('.mention');
  if(mention){
    const sid=mention.textContent.replace(/^@/,'').trim();
    if(!sid)return;
    
    // Если нажали на свой собственный ID
    if(S.user && S.user.signal_id && S.user.signal_id.toLowerCase() === sid.toLowerCase()){
      openProfileModal(S.user, true);
      return;
    }
    
    // Already have a chat with this user?
    const existing=S.chats.find(c=>(c.partner_signal_id||'').toLowerCase()===sid.toLowerCase());
    if(existing){openProfileModal(existing, false);return;}
    
    // Look up user by signal_id then open
    api('search_user?q='+encodeURIComponent(sid)).then(res=>{
      if(!res.ok||!res.users?.length){toast('@'+sid+' не найден','err');return;}
      const u=res.users.find(x=>(x.signal_id||'').toLowerCase()===sid.toLowerCase())||res.users[0];
      openProfileModal({
        chat_id: 0,
        partner_id: u.id,
        partner_name: u.nickname || u.signal_id,
        partner_signal_id: u.signal_id,
        partner_avatar: u.avatar_url,
        partner_bio: u.bio,
        partner_last_seen: u.last_seen || null
      }, false);
    });
  }
});

// Close profile panel on click outside
document.addEventListener('click',e=>{
  const panel=$('sb-profile-panel');
  if(!panel||!panel.classList.contains('open'))return;
  if(!panel.contains(e.target)&&!e.target.closest('#prof-row')&&!e.target.closest('.overlay')&&!e.target.closest('.epicker')&&!e.target.closest('#panel-backdrop'))closeProfile();
});

// Click on panel backdrop closes panels
document.getElementById('panel-backdrop')?.addEventListener('click', function() {
  closeProfile();
});
/* ══ SWIPE TO REPLY ══════════════════════════════════════════ */
(function initSwipeReply() {
  let sx = 0, sy = 0, row = null, bub = null, shift = 0, icon = null;
  const msgs = $('msgs');
  if(!msgs) return;
  
  msgs.addEventListener('touchstart', e => {
    if(!__isMobileView() || e.touches.length > 1) return;
    const t = e.touches[0];
    sx = t.clientX; sy = t.clientY;
    row = e.target.closest('.mrow');
    if(row && !row.classList.contains('msg-deleting') && !isTemp(row.dataset.id) && S.partner && !isSystemChat(S.partner) && !isSavedMsgs(S.partner)) {
      bub = row.querySelector('.mbub');
      shift = 0;
    } else {
      row = bub = null;
    }
  }, { passive: true });

  msgs.addEventListener('touchmove', e => {
    if(!row || !bub) return;
    const t = e.touches[0];
    const dx = t.clientX - sx, dy = t.clientY - sy;
    if(Math.abs(dy) > Math.abs(dx) && shift === 0) { row = bub = null; return; }
    if(dx < -5) {
      if(e.cancelable) e.preventDefault();
      shift = Math.max(dx, -70);
      // "Резиновое" сопротивление свайпа
      const actualShift = shift < -30 ? -30 + (shift + 30) * 0.4 : shift;
      bub.style.transform = `translateX(${actualShift}px)`;
      if(!icon) {
        icon = document.createElement('div');
        icon.className = 'swipe-reply-icon';
        icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>';
        row.appendChild(icon);
      }
      const p = Math.min(1, actualShift / -40);
      icon.style.opacity = p;
      icon.style.transform = `translateY(-50%) scale(${0.5 + p * 0.5})`;
    }
  }, { passive: false });

  msgs.addEventListener('touchend', e => {
    if(!row || !bub) return;
    const actualShift = shift < -30 ? -30 + (shift + 30) * 0.4 : shift;
    if(actualShift <= -35) {
      const m = S.msgs[S.chatId]?.find(x => x.id == row.dataset.id);
      if(m) {
        S.replyTo = { id: m.id, sender_name: m.nickname || 'Пользователь', body: m.body || 'Медиафайл' };
        $('rbar-who').textContent = S.replyTo.sender_name;
        $('rbar-txt').textContent = hideSpoilerText(S.replyTo.body).slice(0, 80);
            showRbar();
        $('mfield').focus();
        if('vibrate' in navigator) navigator.vibrate(50);
      }
    }
    bub.style.transition = 'transform 0.25s var(--sp)';
    bub.style.transform = '';
    if(icon) {
      icon.style.transition = 'opacity 0.2s, transform 0.2s';
      icon.style.opacity = '0';
      icon.style.transform = 'translateY(-50%) scale(0)';
      const r = icon; setTimeout(() => r.remove(), 250);
      icon = null;
    }
    const b = bub; setTimeout(() => b.style.transition = '', 250);
    row = bub = null;
  }, { passive: true });
})();
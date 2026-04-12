/* ══ CHAT-LIST — Список чатов · Открытие чата · Поиск · Пин · Сайдбар ══ */

/* ══ CHATS ════════════════════════════════════════════════════ */
async function loadChats(){const res=await api('get_messages?chat_id=0');if(!res.ok)return;syncChats(res.chats||[]);if(!S.chats.length)renderChats();}
function renderChats(filter=''){
  const list=$('chat-list');list.querySelectorAll('.ci').forEach(e=>e.remove());
  const chats=filter?S.chats.filter(c=>(c.partner_name||'').toLowerCase().includes(filter.toLowerCase())||(c.partner_signal_id||'').toLowerCase().includes(filter.toLowerCase())):S.chats;
  // already sorted by syncChats
  let empty=document.getElementById('chats-empty');
  if(!empty){empty=document.createElement('div');empty.id='chats-empty';empty.className='empty-st';empty.innerHTML='<div class="e-ico">💬</div><p>Нет диалогов.<br>Нажмите + чтобы начать</p>';list.appendChild(empty);}
  if(!chats.length){empty.style.display='flex';return;}empty.style.display='none';
  chats.forEach(c=>list.appendChild(makeChatItem(c)));
}
function makeChatItem(c){
  const el=document.createElement('div');
  el.className='ci'+(c.chat_id===S.chatId?' active':'')+(c.is_pinned?' pinned':'');
  el.dataset.chatId=c.chat_id;
  el._chatData=_chatKey(c);
  _renderChatItemContent(el,c);
  el.onclick=()=>openChat(c);
  el.addEventListener('contextmenu',e=>{e.preventDefault();showChatCtx(e,c);});
  return el;
}

// Only fields that affect visible content (NOT partner_last_seen — it changes every poll)
function _chatKey(c){
  return {
    last_time:c.last_time, last_message:c.last_message,
    last_media_type:c.last_media_type, last_sender_id:c.last_sender_id,
    unread_count:c.unread_count, partner_is_typing:c.partner_is_typing,
    partner_name:c.partner_name, partner_avatar:c.partner_avatar,
    partner_signal_id:c.partner_signal_id,
    online:isOnline(c.partner_last_seen)?1:0,
    is_pinned:c.is_pinned?1:0,
    pin_order:c.pin_order||0,
    is_protected:c.is_protected?1:0,
    is_saved_msgs:c.is_saved_msgs?1:0,
    partner_is_system:c.partner_is_system?1:0,
    partner_is_verified:c.partner_is_verified?1:0,
    partner_is_team_signal:c.partner_is_team_signal?1:0,
    is_muted:c.is_muted?1:0,
  };
}

function _renderChatItemContent(el,c){
  const isTyping=+c.partner_is_typing;
  let prev='';
  if(isTyping)prev=`<div class="dots"><span></span><span></span><span></span></div>`;
  else if(c.last_message){
    const msg=hideSpoilerText(c.last_message);
    const callMatch = msg.match(/^\[call:(missed|declined|ended)(?::(\d+))?\]$/);
    if (callMatch) {
       const type = callMatch[1];
       if (type === 'ended') prev = (c.last_sender_id == S.user?.id ? 'Исходящий звонок' : 'Входящий звонок');
       else if (type === 'missed') prev = (c.last_sender_id == S.user?.id ? 'Отменённый звонок' : 'Пропущенный звонок');
       else prev = 'Отклонённый звонок';
    } else {
       prev=(c.last_sender_id==S.user?.id?'Вы: ':'')+fmtPreview(msg.length>80?msg.slice(0,80)+'…':msg);
    }
  }
  else if(c.last_media_type)prev=c.last_media_type==='video'?'🎥 Видео':c.last_media_type==='voice'?'🎤 Голосовое сообщение':'🖼 Фото';

  // Preserve animating pin icon — don't overwrite it mid-animation
  const existingIcon=el.querySelector('.ci-pin-icon');
  const iconAnimating=existingIcon&&(existingIcon.classList.contains('anim-pin')||existingIcon.classList.contains('anim-unpin'));
  const pinSvg=iconAnimating?'':(c.is_pinned?'<svg class="ci-pin-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M16 12V4h1a1 1 0 000-2H7a1 1 0 000 2h1v8l-2 2v2h5v5h2v-5h5v-2l-2-2z"/></svg>':'');

  // ── Спецчаты: аватар + имя ──────────────────────────────
  let ciAvatarHtml, ciDisplayName;
  if(isSavedMsgs(c)){
    ciAvatarHtml=`<div class="av-img av-saved"><svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M17 3H7a2 2 0 00-2 2v16l7-3 7 3V5a2 2 0 00-2-2z"/></svg></div>`;
    ciDisplayName='Заметки';
  } else if(isSystemChat(c)){
    ciAvatarHtml=`<div class="av-img">${aviHtml(c.partner_name||'Initial',c.partner_avatar)}</div>`;
    ciDisplayName='Initial';
  } else {
    ciDisplayName=c.partner_name||'@'+c.partner_signal_id;
    ciAvatarHtml=`<div class="av-img">${aviHtml(c.partner_name,c.partner_avatar)}</div>`;
  }

  // Verified badge (только для обычных чатов)
  const isVerifiedCI=!isSavedMsgs(c)&&isVerified(c);
  const verBadgeCI=isVerifiedCI?'<svg class="verified-badge sm" viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0"><path d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.705 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681s.075-1.299-.165-1.903c.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z" fill="currentColor"/></svg>':'';
  // Team Signal badge
  const isTeamCI=!isSavedMsgs(c)&&!isSystemChat(c)&&isTeamSignal(c);
  const teamBadgeCI=isTeamCI?teamBadgeSvg('sm'):'';

  // Точка онлайн — не показывать для спецчатов
  const showOnlineDot=!isSavedMsgs(c)&&!isSystemChat(c)&&isOnline(c.partner_last_seen);

  // ── Read checkmarks for outgoing messages in chat list ──
  const isOutgoing = c.last_sender_id == S.user?.id && !isTyping;
  const isRead = isOutgoing && c.is_read == 1;
  const ciTickHtml = isOutgoing ? `<span class="ci-tick${isRead?' ci-tick-r':''}"><svg viewBox="0 0 18 11" width="16" height="11" fill="none"><path d="M1 5.5l3 3L10 1" stroke="currentColor" stroke-opacity="${isRead?1:0.4}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 5.5l3 3L14 1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>` : '';

  // ── Muted indicator (chat-level + per-user mute) — grey icon next to nickname ──
  const isUserMuted_ = (typeof isUserMuted === 'function' && c.partner_id) ? isUserMuted(c.partner_id) : false;
  const ciMuteHtml = (c.is_muted || isUserMuted_) ? '<svg class="ci-mute-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>' : '';

  el.innerHTML=`<div class="av">${ciAvatarHtml}${showOnlineDot?'<div class="av-dot"></div>':''}</div><div class="ci-meta"><div class="ci-row"><div class="ci-name" style="display:flex;align-items:center;gap:4px;min-width:0"><span class="marquee-inner">${esc(ciDisplayName)}</span>${ciMuteHtml}${verBadgeCI}${teamBadgeCI}</div><div style="display:flex;align-items:center;gap:2px;flex-shrink:0">${pinSvg}<div class="ci-ts">${c.last_time?fmtChatTime(c.last_time):''}</div></div></div><div class="ci-prev ${isTyping?'typ':''}"><span style="flex:1;overflow:hidden;text-overflow:ellipsis">${prev}</span>${ciTickHtml}${c.unread_count>0?`<span class="badge">${c.unread_count}</span>`:''}</div></div>`;

  // Restore saved animating icon
  if(iconAnimating&&existingIcon){const ts=el.querySelector('.ci-ts');const wrap=ts?.parentElement;if(wrap)wrap.insertBefore(existingIcon,ts);}
  wtn(el);
  // Marquee for long nicknames
  const ciNameSpan = el.querySelector('.ci-name .marquee-inner');
  if(ciNameSpan) setTimeout(() => checkMarquee(ciNameSpan), 0);
}

function _chatDataChanged(el,c){
  const d=el._chatData;
  if(!d)return true;
  const n=_chatKey(c);
  return d.last_time!==n.last_time||d.last_message!==n.last_message
    ||d.last_media_type!==n.last_media_type||d.last_sender_id!==n.last_sender_id
    ||d.unread_count!==n.unread_count||d.partner_is_typing!==n.partner_is_typing
    ||d.partner_name!==n.partner_name||d.partner_avatar!==n.partner_avatar
    ||d.partner_signal_id!==n.partner_signal_id||d.online!==n.online||d.is_pinned!==n.is_pinned||d.pin_order!==n.pin_order||d.is_muted!==n.is_muted;
}

function showRbar(){const rb=$('rbar');if(rb){rb.classList.remove('closing');rb.style.animation='';rb.classList.add('on');}}
function hideRbar(inst=false){const rb=$('rbar');if(!rb||!rb.classList.contains('on')||rb.classList.contains('closing'))return;if(inst){rb.classList.remove('on','closing');rb.style.animation='';}else{rb.classList.add('closing');rb.style.animation='rbarOut .2s var(--ease) forwards';setTimeout(()=>{if(rb.classList.contains('closing')){rb.classList.remove('on','closing');rb.style.animation='';}},190);}}

/* ══ OPEN CHAT ════════════════════════════════════════════════ */
function openChat(c){
  if(S.chatId===c.chat_id)return;
  // Hide in-app push banner when opening a chat
  var inappPush = $('inapp-push');
  if(inappPush) inappPush.classList.remove('visible');
  // Remember last open chat for restore on reload
  try{localStorage.setItem('sg_last_chat',String(c.chat_id));}catch(e){}
  // Save current scroll position before leaving
  if(S.chatId)saveScrollPos(S.chatId);
  S.chatId=c.chat_id;S.partner=c;S.replyTo=null;exitSelectMode();
  // Notify call panel to collapse/expand based on active call partner
  if(window.onCallChatSwitch) window.onCallChatSwitch(c.chat_id);
  S.historyLoading=false;
  S.historyEnd=false;
  hideSBBtn();
  if(S.sse){stopSSE();}
  hideRbar(true);
  if (window._hidePill) window._hidePill(); // reset pill on chat switch
  if (window._closeChatSearch) window._closeChatSearch(); // close inline search
  $$('.ci').forEach(e=>e.classList.remove('active'));
  document.querySelector(`.ci[data-chat-id="${c.chat_id}"]`)?.classList.add('active');
  const name=c.partner_name||'@'+c.partner_signal_id;
  
  updateHeaderUI(c, name);

  // ── Input zone / Mute pill ───────────────────────────────
  {
    const inpZone = $('input-zone');
    let pill = document.getElementById('system-mute-pill');
    const isSystem = isSystemChat(c);
    const isMuted = !!c.is_muted;

    const fadeIn = (el) => {
      if (!el) return;
      el.style.display = '';
      el.animate([
        { opacity: 0, transform: 'translateY(10px)' },
        { opacity: 1, transform: 'translateY(0)' }
      ], { duration: 200, easing: 'ease-out' });
    };

    if (isSystem) {
      if (inpZone && inpZone.style.display !== 'none') {
        inpZone.style.display = 'none';
      }
      
      if (!pill) {
        pill = document.createElement('div');
        pill.id = 'system-mute-pill';
        pill.className = 'system-mute-zone';
        if (inpZone && inpZone.parentElement) {
          inpZone.parentElement.insertBefore(pill, inpZone);
        }
      }
      
      pill.innerHTML = `<button class="mute-zone-btn${isMuted ? ' muted' : ''}" id="btn-mute-system">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          ${isMuted
            ? '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>'
            : '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line>'
          }
        </svg>
        ${isMuted ? 'Включить уведомления' : 'Заглушить чат'}
      </button>`;
      
      document.getElementById('btn-mute-system').onclick = async () => {
        const res = await api('mute_chat', 'POST', { chat_id: c.chat_id });
        if (res.ok) {
          const sc = S.chats.find(x => x.chat_id === c.chat_id);
          if (sc) { sc.is_muted = res.is_muted; S.partner = sc; }
          openChat(S.partner);
        } else toast(res.message || 'Ошибка', 'err');
      };
      
      if (pill.style.display === 'none' || !pill.hasAttribute('data-entered')) {
        pill.setAttribute('data-entered', '1');
        fadeIn(pill);
      }
      
    } else {
      if (pill) {
        pill.remove();
      }
      if (inpZone && inpZone.style.display === 'none') {
        fadeIn(inpZone);
      }
    }
  }
  updateHdrSt(c);
  $('chat-welcome').style.display='none';$('active-chat').style.display='flex';
  
  // Chat switch animation
  const ac = $('active-chat');
  ac.classList.remove('chat-switch');
  void ac.offsetWidth;
  ac.classList.add('chat-switch');

  if(__isMobileView()){
    $('sidebar').classList.add('hidden');
    // Use class-based slide animation
    requestAnimationFrame(()=>$('active-chat').classList.add('mb-visible'));
    // Push state so Android/iOS back button works
    history.pushState({chat:c.chat_id},'','');
    const mbNav = document.getElementById('mobile-bottom-nav');
    if(mbNav) mbNav.classList.add('hidden');
  }

  const area=$('msgs');
  const chatId=c.chat_id;
  const cached=cacheReadMsgs(chatId);

  if(cached&&cached.length){
    // ── Telegram Web K: мгновенный рендер + синхронный скролл ──────
    // 1. State
    S.msgs[chatId]=cached;
    S.lastId[chatId]=cached.reduce((mx,m)=>Math.max(mx,+m.id),0);
    cached.forEach(m=>{S.rxns[m.id]=Array.isArray(m.reactions)?m.reactions:[];});

    // 2. DOM — синхронный рендер
    area.innerHTML='';
    renderMsgs(chatId);

    // 3. scrollTop читает scrollHeight синхронно (layout уже выполнен),
    //    устанавливаем до первого paint — пользователь не видит прыжка
    restoreScrollPos(chatId);
    requestAnimationFrame(() => { if (window._positionPill) window._positionPill(); });

    // 4. Фоновый network-запрос — не блокирует UI
    fetchMsgs(chatId,true);

  } else {
    area.innerHTML='';
    const skelWrap = document.createElement('div');
    skelWrap.className = 'init-skel-wrap';
    skelWrap.style.cssText = 'flex:1; display:flex; flex-direction:column; justify-content:flex-end; padding-bottom:20px; overflow:hidden; pointer-events:none;';
    if(typeof window.makeSkeleton === 'function') {
      skelWrap.appendChild(window.makeSkeleton(12));
    }
    area.appendChild(skelWrap);
    S.msgs[chatId]=[];
    S.lastId[chatId]=0;
    fetchMsgs(chatId,true);
  }
}
function updateHdrSt(c){
  const el=$('hdr-st');if(!el)return;
  if(!navigator.onLine||S._connecting){
    el.innerHTML='<span class="connecting-text">Соединение<span class="connecting-dots"><span></span><span></span><span></span></span></span>';
    el.className='hdr-st connecting';return;
  }
  if(isSavedMsgs(c)){el.textContent='Ваше личное пространство';el.className='hdr-st';return;}
  if(isSystemChat(c)){el.textContent='Системные уведомления';el.className='hdr-st';return;}
  if(+c.partner_is_typing){el.textContent='печатает…';el.className='hdr-st typ';}
  else if(isOnline(c.partner_last_seen)){el.textContent='в сети';el.className='hdr-st on';}
  else{el.textContent=c.partner_last_seen?'Был(а) '+fmtLastSeen(c.partner_last_seen):'не в сети';el.className='hdr-st';}
}

/* ══ PARTNER PANEL ════════════════════════════════════════════ */
$('hdr-clickable').onclick=()=>{
  if(!S.partner)return;
  if(isSystemChat(S.partner)||isSavedMsgs(S.partner))return;
  openPartnerModal();
};

/* ══ INLINE CHAT SEARCH (Mobile long-press on center pill) ══ */
/* Hybrid search: instant cached results + server-side full search */
(function initChatSearch(){
  const pill=$('hdr-pill');
  const searchEl=$('hdr-chat-search');
  const input=$('hdr-search-input');
  const closeBtn=$('hdr-search-close');
  // Bottom navigation panel
  const navPanel=$('search-nav-panel');
  const countEl=$('search-nav-count');
  const prevBtn=$('search-nav-prev');
  const nextBtn=$('search-nav-next');
  // Input zone (hidden while searching)
  const inputZone=$('input-zone');
  if(!pill||!searchEl||!input||!closeBtn||!navPanel||!countEl)return;

  let _active=false;
  let _results=[];       // full ordered results [{id, body}] from server (desc by id)
  let _totalInChat=0;    // total matches on server
  let _currentIdx=-1;    // index into _results (0 = oldest, length-1 = newest)
  let _searchTimer=null;
  let _searchReq=0;      // request ID to cancel stale responses
  let _serverDone=false; // true when server response received

  /* ── Open / Close ─────────────────────────────────────── */
  function open(){
    if(_active)return;
    _active=true;
    pill.classList.add('searching');
    input.value='';
    _results=[];_currentIdx=-1;_totalInChat=0;_serverDone=false;
    _searchReq++;
    clearHighlights();
    // Show bottom panel, hide input zone
    if(inputZone) inputZone.style.display='none';
    navPanel.classList.add('on');
    countEl.textContent='Введите запрос';
    countEl.classList.remove('has-results','searching-indicator');
    prevBtn.disabled=true;
    nextBtn.disabled=true;
    // Focus input after pill transition
    setTimeout(()=>input.focus(),380);
  }

  function close(){
    if(!_active)return;
    _active=false;
    _searchReq++;
    pill.classList.remove('searching');
    input.value='';
    _results=[];_currentIdx=-1;_totalInChat=0;_serverDone=false;
    clearHighlights();
    input.blur();
    // Restore input zone
    navPanel.classList.remove('on');
    if(inputZone) inputZone.style.display='';
  }

  function showNav(){
    navPanel.classList.add('on');
    if(inputZone) inputZone.style.display='none';
  }

  /* ── Highlight management ─────────────────────────────── */
  function clearHighlights(){
    const area=$('msgs');
    if(!area)return;
    area.querySelectorAll('.search-match,.search-match-current').forEach(el=>{
      el.classList.remove('search-match','search-match-current');
      el.querySelectorAll('mark').forEach(mk=>mk.replaceWith(mk.textContent));
    });
  }

  function escapeRegex(s){return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}

  function highlightMatchesInDOM(ids){
    const area=$('msgs');
    if(!area)return;
    ids.forEach(id=>{
      const row=area.querySelector(`.mrow[data-id="${id}"]`);
      if(row)row.classList.add('search-match');
    });
  }

  function highlightText(row){
    const q=input.value.trim();
    if(!q)return;
    const regex=new RegExp('('+escapeRegex(q)+')','gi');
    row.querySelectorAll('.mtxt').forEach(txt=>{
      const walker=document.createTreeWalker(txt,NodeFilter.SHOW_TEXT,null,false);
      const textNodes=[];
      let node;
      while(node=walker.nextNode())textNodes.push(node);
      textNodes.forEach(tn=>{
        if(tn.parentElement.tagName==='MARK')return;
        const parts=tn.textContent.split(regex);
        if(parts.length<=1)return;
        const frag=document.createDocumentFragment();
        parts.forEach((p,i)=>{
          if(i>0){const mk=document.createElement('mark');mk.textContent=p;frag.appendChild(mk);}
          else frag.appendChild(document.createTextNode(p));
        });
        tn.parentNode.replaceChild(frag,tn);
      });
    });
  }

  /* ── Cached (instant) search ──────────────────────────── */
  function searchCached(query){
    const msgs=S.msgs[S.chatId];
    if(!msgs||!msgs.length)return[];
    const q=query.toLowerCase();
    return msgs.filter(m=>m.body&&m.body.toLowerCase().includes(q)).map(m=>({id:m.id,body:m.body}));
  }

  /* ── Main hybrid search ───────────────────────────────── */
  async function doSearch(query){
    clearHighlights();
    _results=[];_currentIdx=-1;_totalInChat=0;_serverDone=false;
    const reqId=++_searchReq;

    if(!query.trim()||!S.chatId){
      showNav();
      countEl.textContent='Введите запрос';
      countEl.classList.remove('has-results','searching-indicator');
      prevBtn.disabled=true;
      nextBtn.disabled=true;
      return;
    }

    showNav();
    const q=query.trim();

    // ── Phase 1: Instant cached results ──
    const cached=searchCached(q);
    if(cached.length){
      // Sort desc by id (newest first)
      cached.sort((a,b)=>b.id-a.id);
      _results=cached;
      highlightMatchesInDOM(_results.map(r=>r.id));
      prevBtn.disabled=false;
      nextBtn.disabled=false;
      _currentIdx=0; // newest first
      highlightCurrent();
      countEl.textContent='1 из '+_results.length;
      countEl.classList.add('has-results','searching-indicator');
    } else {
      countEl.textContent='Поиск…';
      countEl.classList.remove('has-results');
      countEl.classList.add('searching-indicator');
      prevBtn.disabled=true;
      nextBtn.disabled=true;
    }

    // ── Phase 2: Server-side search (full chat) ──
    try{
      const res=await api('search_messages?chat_id='+S.chatId+'&q='+encodeURIComponent(q)+'&limit=500');
      if(reqId!==_searchReq)return;
      _serverDone=true;
      countEl.classList.remove('searching-indicator');

      if(!res.ok||!res.messages){
        // Keep cached results if we have them
        if(!_results.length) countEl.textContent='Ошибка';
        return;
      }

      const serverResults=res.messages.map(m=>({id:m.id,body:m.body}));
      // Already sorted desc by id from server
      _results=serverResults;
      _totalInChat=res.total_in_chat||res.messages.length;

      // Re-highlight with authoritative server results
      clearHighlights();
      highlightMatchesInDOM(_results.map(r=>r.id));

      if(!_results.length){
        countEl.textContent='Ничего не найдено';
        countEl.classList.remove('has-results');
        prevBtn.disabled=true;
        nextBtn.disabled=true;
        return;
      }

      prevBtn.disabled=false;
      nextBtn.disabled=false;

      // If cached results existed, try to keep current position
      if(cached.length&&_currentIdx>=0){
        // Try to find a similar position — snap to newest
        _currentIdx=0;
      } else {
        _currentIdx=0; // newest first
      }
      highlightCurrent();
    }catch(e){
      if(reqId!==_searchReq)return;
      _serverDone=true;
      countEl.classList.remove('searching-indicator');
      if(!_results.length) countEl.textContent='Ошибка';
    }
  }

  /* ── Current match highlighting + scroll ──────────────── */
  function highlightCurrent(){
    const area=$('msgs');
    if(!area)return;
    area.querySelectorAll('.search-match-current').forEach(el=>el.classList.remove('search-match-current'));
    area.querySelectorAll('.search-match mark').forEach(mk=>mk.replaceWith(mk.textContent));

    if(_currentIdx<0||_currentIdx>=_results.length)return;

    const id=_results[_currentIdx].id;
    const row=area.querySelector(`.mrow[data-id="${id}"]`);

    if(!row){
      // Message not in DOM — show index but don't scroll
      updateCount();
      return;
    }

    row.classList.add('search-match-current');
    highlightText(row);
    row.scrollIntoView({behavior:'smooth',block:'center'});
    updateCount();
  }

  function updateCount(){
    const displayTotal=_totalInChat>_results.length?_totalInChat:_results.length;
    const extra=_totalInChat>_results.length?' ('+_totalInChat+')':'';
    if(_results.length){
      countEl.textContent=(_currentIdx+1)+' из '+displayTotal+extra;
      countEl.classList.add('has-results');
    }
  }

  /* ── Navigation ───────────────────────────────────────── */
  function goNext(){
    if(!_results.length)return;
    // _results is newest-first (desc by id)
    // "Next" in Telegram = go to OLDER message = move forward in array
    _currentIdx=Math.min(_currentIdx+1,_results.length-1);
    highlightCurrent();
  }
  function goPrev(){
    if(!_results.length)return;
    // "Prev" = go to NEWER message = move backward in array
    _currentIdx=Math.max(_currentIdx-1,0);
    highlightCurrent();
  }

  /* ── Long-press on center pill → open search (mobile) ── */
  if('ontouchstart' in window){
    let _lpTimer=null,_lpMoved=false,_lpX=0,_lpY=0;
    pill.addEventListener('touchstart',e=>{
      if(_active)return;
      _lpMoved=false;
      _lpX=e.touches[0].clientX;
      _lpY=e.touches[0].clientY;
      _lpTimer=setTimeout(()=>{
        if(_lpMoved)return;
        navigator.vibrate?.(12);
        open();
      },350);
    },{passive:true});
    pill.addEventListener('touchmove',e=>{
      if(Math.abs(e.touches[0].clientX-_lpX)>10||Math.abs(e.touches[0].clientY-_lpY)>10){
        _lpMoved=true;
        clearTimeout(_lpTimer);_lpTimer=null;
      }
    },{passive:true});
    pill.addEventListener('touchend',()=>{clearTimeout(_lpTimer);_lpTimer=null;});
    pill.addEventListener('touchcancel',()=>{clearTimeout(_lpTimer);_lpTimer=null;});
  }

  // Search input with debounce
  input.addEventListener('input',()=>{
    clearTimeout(_searchTimer);
    _searchTimer=setTimeout(()=>doSearch(input.value),250);
  });

  // Keyboard shortcuts
  input.addEventListener('keydown',e=>{
    if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();goNext();}
    else if(e.key==='Enter'&&e.shiftKey){e.preventDefault();goPrev();}
    else if(e.key==='Escape'){e.preventDefault();close();}
  });

  // Bottom navigation buttons
  prevBtn.onclick=goPrev;
  nextBtn.onclick=goNext;

  // Close button (in header)
  closeBtn.onclick=close;

  // Expose close for openChat reset
  window._closeChatSearch=close;
})();


function openProfileModal(u, isSelf=false){
  if(!u)return;
  const name = isSelf ? (u.nickname||u.email||'—') : (u.partner_name||'@'+u.partner_signal_id);
  const sid = isSelf ? (u.signal_id||'') : (u.partner_signal_id||'');
  const avatar = isSelf ? u.avatar_url : u.partner_avatar;
  const bio = isSelf ? u.bio : u.partner_bio;

  // Avatar & Background blur
  const aviEl=$('pm-hero-avi');
  if(aviEl) aviEl.innerHTML=aviHtml(name,avatar);
  applyBlurredAvatarBg('pm-hero-bg', name, avatar);

  // Name
  const nameEl=$('pm-partner-name');
  if(nameEl) { nameEl.textContent=name; wtn(nameEl); }

  // Verified & Team badges
  const vBadge=$('pm-verified-badge');
  const tBadge=$('pm-team-badge');
  if(vBadge) {
    const _isV = isVerified(isSelf ? {signal_id:u.signal_id, is_verified:u.is_verified} : u);
    vBadge.style.display = _isV ? '' : 'none';
    vBadge.onclick = () => openMod('modal-verified');
  }
  if(tBadge) {
    const _isT = isTeamSignal(isSelf ? {is_team_signal:u.is_team_signal} : u);
    tBadge.style.display = _isT ? '' : 'none';
    if(_isT) {
      tBadge.innerHTML = teamBadgeSvg('lg');
      tBadge.onclick = () => openMod('modal-team');
    }
  }

  // Status pill
  const pill=$('pm-partner-status');
  const pillTxt=$('pm-partner-status-text');
  if(pill && pillTxt){
    if(isSelf){
      pill.className='pm-status-pill on';
      pillTxt.textContent='в сети';
    }else{
      if(isOnline(u.partner_last_seen)){
        pill.className='pm-status-pill on';
        pillTxt.textContent='в сети';
      } else {
        pill.className='pm-status-pill off';
        pillTxt.textContent=u.partner_last_seen?'Был(а) '+fmtLastSeen(u.partner_last_seen):'не в сети';
      }
    }
  }

  // Info rows
  const rowSid = $('pm-row-sid');
  const valSid = $('pm-info-sid-val');
  const rowBio = $('pm-row-bio');
  const valBio = $('pm-info-bio-val');
  const sep    = $('pm-info-sep');

  const hasSid = !!sid;
  const hasBio = !!bio;

  if(rowSid && valSid){
    if(hasSid){
      rowSid.style.display = 'flex';
      valSid.textContent = '@' + sid;
      rowSid.onclick = () => {
        navigator.clipboard.writeText('@'+sid).then(()=>toast('Initial ID скопирован','ok'));
      };
    } else { rowSid.style.display = 'none'; }
  }
  if(rowBio && valBio){
    if(hasBio){
      rowBio.style.display = 'flex';
      valBio.innerHTML = fmtText(bio);
      wtn(valBio);
    } else { rowBio.style.display = 'none'; }
  }

  if(sep) sep.style.display = (hasSid && hasBio) ? 'block' : 'none';
  if($('pm-info-section')) $('pm-info-section').style.display = (hasSid || hasBio) ? 'flex' : 'none';

  // Action buttons
  const actsRow   = $('pm-actions-row');
  const btnMsg    = $('pm-btn-message');
  const btnMute   = $('pm-btn-mute');
  const btnCall   = $('pm-btn-call');
  const btnVideo  = $('pm-btn-video');
  const dangerRow = $('pm-danger-actions');

  if(isSelf){
    if(btnMsg)    btnMsg.style.display    = 'none';
    if(btnMute)   btnMute.style.display   = 'none';
    if(btnCall)   btnCall.style.display   = 'none';
    if(btnVideo)  btnVideo.style.display  = 'none';
    if(dangerRow) dangerRow.style.display = 'none';
    if(actsRow)   actsRow.style.display   = sid ? 'flex' : 'none';
  } else {
    if(actsRow) actsRow.style.display = 'flex';

    if(btnMsg){
      btnMsg.style.display = 'flex';
      btnMsg.onclick = () => { 
        closeMod('modal-partner'); 
        if(u.chat_id && u.chat_id !== S.chatId) {
            const existing = S.chats.find(c => c.chat_id === u.chat_id);
            if(existing) openChat(existing);
        } else if (!u.chat_id && u.partner_id) {
            startChat({id: u.partner_id, nickname: u.partner_name, signal_id: u.partner_signal_id, avatar_url: u.partner_avatar, bio: u.partner_bio});
        }
        setTimeout(() => $('mfield')?.focus(), 100);
      };
    }
    if(btnCall){
      btnCall.style.display = 'flex';
      btnCall.onclick = () => { closeMod('modal-partner'); toast('Звонки пока не поддерживаются','info'); };
    }
    if(btnVideo){
      btnVideo.style.display = 'flex';
      btnVideo.onclick = () => { closeMod('modal-partner'); toast('Видеозвонки пока не поддерживаются','info'); };
    }
    if(btnMute){
      if (!u.chat_id) {
        btnMute.style.display = 'none'; // Скрываем звук если чата еще нет
      } else {
        btnMute.style.display = 'flex';
        const muteTxt = $('pm-mute-txt');
        const muteIc  = btnMute.querySelector('.pm-act-ic');
        const isMuted = !!u.is_muted;
        if(isMuted){
          btnMute.classList.add('muted');
          if(muteTxt) muteTxt.textContent = 'Звук вкл';
          if(muteIc) muteIc.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>';
        } else {
          btnMute.classList.remove('muted');
          if(muteTxt) muteTxt.textContent = 'Звук';
          if(muteIc) muteIc.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>';
        }
        btnMute.onclick = async () => {
          const res = await api('mute_chat','POST',{ chat_id: u.chat_id });
          if(res.ok){
            const sc = S.chats.find(x=>x.chat_id===u.chat_id);
            if(sc){ 
              sc.is_muted=res.is_muted; 
              if(S.chatId===u.chat_id) S.partner=sc; 
            }
            openProfileModal(sc || u, false);
            toast(res.is_muted?'Уведомления выключены':'Уведомления включены','ok');
            if(S.chatId===u.chat_id) openChat(S.partner);
          } else toast(res.message||'Ошибка','err');
        };
      }
    }

    // Block / Report (with partner name in label)
    const partnerName = u.partner_name||('@'+u.partner_signal_id);
    if(dangerRow){
      dangerRow.style.display = 'flex';
      const blockLbl  = $('pm-block-label');
      const reportLbl = $('pm-report-label');
      if(blockLbl)  blockLbl.textContent  = 'Заблокировать ' + partnerName;
      if(reportLbl) reportLbl.textContent = 'Пожаловаться на ' + partnerName;
      const btnBlock  = $('pm-btn-block');
      const btnReport = $('pm-btn-report');
      if(btnBlock)  btnBlock.onclick  = () => { closeMod('modal-partner'); toast('Пользователь заблокирован','ok'); };
      if(btnReport) btnReport.onclick = () => { closeMod('modal-partner'); toast('Жалоба отправлена','ok'); };
    }
  }

  openMod('modal-partner');
}

function openPartnerModal(){
  if(!S.partner)return;
  openProfileModal(S.partner, false);
}
function openSelfModal(){
  if(!S.user)return;
  openProfileModal(S.user, true);
}
/* ══ DYNAMIC TITLE ════════════════════════════════════════════ */
function updateTitle(){
  const total=(S.chats||[]).reduce((s,c)=>s+(+c.unread_count||0),0);
  document.title=total>0?`(${total}) Сообщения — Initial`:'Сообщения — Initial';
  // Update header unread badge (mobile)
  const badge=document.getElementById('hdr-unread-badge');
  if(badge){
    if(total>0){
      badge.textContent=total>99?'99+':total;
      badge.style.display='';
    }else{
      badge.style.display='none';
    }
  }
}

/* ── Sort chats: pinned on top, then by last_time desc ── */
function sortChats(chats){
  return [...chats].sort((a,b)=>{
    const pa=a.is_pinned?1:0, pb=b.is_pinned?1:0;
    if(pa!==pb)return pb-pa;
    if(pa&&pb){
      // Use manual drag order if available
      const oa=a.pin_order||0, ob=b.pin_order||0;
      if(oa!==ob)return ob-oa;
    }
    // Свежие чаты (с большим timestamp) должны быть наверху, поэтому сортируем по убыванию
    return (b.last_time||0)-(a.last_time||0);
  });
}

/* ══ DRAG-TO-REORDER PINNED CHATS ════════════════════════════ */
(function initPinDrag(){
  const list=$('chat-list');
  if(!list)return;
  let dragSrc=null,dragSrcId=null;
  const isTouchDevice = () => ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

  function getPinnedEls(){
    return [...list.querySelectorAll('.ci.pinned')];
  }

  // ── Touch-based drag for mobile (requires movement threshold) ──
  let touchState = null;

  function attachTouchDrag(el){
    if(el._pinTouchBound)return;
    el._pinTouchBound=true;
    // On touch devices, do NOT set draggable — HTML5 DnD breaks context menu
    if(isTouchDevice()) el.removeAttribute('draggable');

    let longPressTimer=null, startX=0, startY=0, hasMoved=false, clone=null, offsetY=0;
    let longPressed=false; // Set after long-press timer fires — prevents drag entirely

    el.addEventListener('touchstart', e=>{
      if(!el.classList.contains('pinned'))return;
      const t=e.touches[0];
      startX=t.clientX; startY=t.clientY; hasMoved=false; longPressed=false;
      // Long press timer — only fires if finger stays still (no drag intent)
      longPressTimer=setTimeout(()=>{
        // Long press without movement — prevent any drag and let contextmenu handle
        longPressTimer=null;
        longPressed=true;
      },500);
    },{passive:true});

    el.addEventListener('touchmove', e=>{
      // After long press fired, completely ignore all movement — no drag possible
      if(longPressed)return;
      if(longPressTimer===null && !hasMoved)return;
      const t=e.touches[0];
      const dx=t.clientX-startX, dy=t.clientY-startY;
      // Cancel long-press if finger moves (indicates scroll intent, not context menu)
      if(longPressTimer!==null && (Math.abs(dx)>8||Math.abs(dy)>8)){
        clearTimeout(longPressTimer);longPressTimer=null;
      }
      // Start drag only after 15px movement (distinguishes scroll from drag)
      if(!hasMoved && (Math.abs(dx)>15||Math.abs(dy)>15)){
        hasMoved=true;
        dragSrc=el; dragSrcId=+el.dataset.chatId;
        el.classList.add('dragging');
        e.preventDefault();
      }
      if(hasMoved){
        e.preventDefault();
        // Visual: move the element (no clone needed for simplicity)
        const rect=el.getBoundingClientRect();
        const listRect=list.getBoundingClientRect();
        el.style.transform=`translateY(${t.clientY-startY}px)`;
        el.style.zIndex='100';
        el.style.position='relative';

        // Find drop target
        list.querySelectorAll('.ci.pinned').forEach(c=>{
          if(c===el)return;
          c.classList.remove('drag-over-top','drag-over-bot');
          const r=c.getBoundingClientRect();
          const mid=r.top+r.height/2;
          if(t.clientY<mid && t.clientY>r.top-20 && t.clientY<r.bottom+20){
            c.classList.add('drag-over-top');
          } else if(t.clientY>=mid && t.clientY>r.top-20 && t.clientY<r.bottom+20){
            c.classList.add('drag-over-bot');
          }
        });
      }
    },{passive:false});

    function touchEnd(e){
      clearTimeout(longPressTimer);longPressTimer=null;
      if(!hasMoved){el.style.transform='';el.style.zIndex='';el.style.position='';return;}
      hasMoved=false;
      el.classList.remove('dragging');
      el.style.transform='';el.style.zIndex='';el.style.position='';

      // Find drop target
      const target=list.querySelector('.ci.drag-over-top,.ci.drag-over-bot');
      if(target && target!==el && target.classList.contains('pinned')){
        const insertBefore=target.classList.contains('drag-over-top');
        if(insertBefore)list.insertBefore(el,target);
        else target.after(el);

        const newPinnedOrder=getPinnedEls().map(c=>+c.dataset.chatId);
        S.chats.forEach(c=>{
          const idx=newPinnedOrder.indexOf(c.chat_id);
          if(idx>=0)c.pin_order=newPinnedOrder.length-idx;
          else c.pin_order=0;
        });
        savePinOrder(newPinnedOrder);
      }
      list.querySelectorAll('.ci').forEach(c=>c.classList.remove('drag-over-top','drag-over-bot'));
      dragSrc=null;dragSrcId=null;
    }

    el.addEventListener('touchend',touchEnd);
    el.addEventListener('touchcancel',()=>{clearTimeout(longPressTimer);longPressTimer=null;if(hasMoved){hasMoved=false;el.classList.remove('dragging');el.style.transform='';el.style.zIndex='';el.style.position='';list.querySelectorAll('.ci').forEach(c=>c.classList.remove('drag-over-top','drag-over-bot'));}});
  }

  function attachDrag(el){
    if(el._pinDragBound)return;
    el._pinDragBound=true;
    // Only set draggable on non-touch devices (desktop)
    if(!isTouchDevice()) el.setAttribute('draggable','true');
    // Always attach touch handlers for hybrid devices
    attachTouchDrag(el);

    el.addEventListener('dragstart',e=>{
      if(!el.classList.contains('pinned')){e.preventDefault();return;}
      dragSrc=el;
      dragSrcId=+el.dataset.chatId;
      e.dataTransfer.effectAllowed='move';
      e.dataTransfer.setData('text/plain',dragSrcId);
      requestAnimationFrame(()=>el.classList.add('dragging'));
    });

    el.addEventListener('dragend',()=>{
      el.classList.remove('dragging');
      list.querySelectorAll('.ci').forEach(c=>{
        c.classList.remove('drag-over-top','drag-over-bot');
      });
      dragSrc=null;dragSrcId=null;
    });

    el.addEventListener('dragover',e=>{
      if(!dragSrc||!el.classList.contains('pinned')||el===dragSrc)return;
      e.preventDefault();e.dataTransfer.dropEffect='move';
      const rect=el.getBoundingClientRect();
      const mid=rect.top+rect.height/2;
      el.classList.toggle('drag-over-top',e.clientY<mid);
      el.classList.toggle('drag-over-bot',e.clientY>=mid);
    });

    el.addEventListener('dragleave',()=>{
      el.classList.remove('drag-over-top','drag-over-bot');
    });

    el.addEventListener('drop',e=>{
      e.preventDefault();
      if(!dragSrc||el===dragSrc||!el.classList.contains('pinned'))return;
      el.classList.remove('drag-over-top','drag-over-bot');

      const rect=el.getBoundingClientRect();
      const insertBefore=e.clientY<rect.top+rect.height/2;

      // Reorder DOM
      if(insertBefore)list.insertBefore(dragSrc,el);
      else el.after(dragSrc);

      // Rebuild S.chats pin order based on new DOM order
      const newPinnedOrder=getPinnedEls().map(c=>+c.dataset.chatId);
      // Assign descending pin_order values
      S.chats.forEach(c=>{
        const idx=newPinnedOrder.indexOf(c.chat_id);
        if(idx>=0)c.pin_order=newPinnedOrder.length-idx; // higher = higher up
        else c.pin_order=0;
      });

      // Save to server
      savePinOrder(newPinnedOrder);
    });
  }

  // Observe new .ci elements being added (e.g. after syncChats)
  const mo=new MutationObserver(muts=>{
    muts.forEach(m=>{
      m.addedNodes.forEach(n=>{
        if(n.classList&&n.classList.contains('ci'))attachDrag(n);
      });
    });
  });
  mo.observe(list,{childList:true});

  // Attach to existing items
  list.querySelectorAll('.ci').forEach(attachDrag);

  // Re-attach after renderChats (it recreates .ci elements)
  const origRender=window._origRenderChats;
  // Patch makeChatItem to auto-attach drag
  const _origMakeChatItem=window.makeChatItem;
})();

// Debounced save of pin order
const _pinOrderDebounce={t:null};
function savePinOrder(orderedIds){
  clearTimeout(_pinOrderDebounce.t);
  _pinOrderDebounce.t=setTimeout(async() => {
    const res = await api('pin_chat', 'POST', { reorder: orderedIds });
    if(!res.ok)toast(res.message||'Ошибка сортировки','err');
  }, 600);
}

function syncChats(rawChats){
  if(!rawChats)return;
  const prevChats=S.chats||[];
  
  // ── Preserve local pending pinned state during polling ──
  if(S.pinDebounce && S.pinDebounce.size > 0){
    rawChats.forEach(c => {
      if(S.pinDebounce.has(c.chat_id)){
        const local = prevChats.find(p => p.chat_id === c.chat_id);
        if(local) {
          c.is_pinned = local.is_pinned;
          c.pin_order = local.pin_order;
        }
      }
    });
  }

  const sortedChats = sortChats(rawChats);
  S.chats = sortedChats;
  cacheWriteChats(S.chats); // persist for instant restore on next load

  // ── Background notifications for non-active chats ─────────
  // Only notify when last_time strictly increased relative to what we knew before
  sortedChats.forEach(c=>{
    if(c.chat_id===S.chatId)return;
    if(c.last_sender_id===S.user?.id)return;
    if(!c.unread_count||!c.last_time)return;
    const old=prevChats.find(p=>p.chat_id===c.chat_id);
    // Skip if we had no previous state (first load) or time didn't change
    if(!old||!old.last_time)return;
    if(c.last_time<=old.last_time)return;
    const name=c.partner_name||('@'+c.partner_signal_id);
    
    let bodyText = c.last_message ? hideSpoilerText(c.last_message) : '';
    const cm = bodyText.match(/^\[call:(missed|declined|ended)(?::(\d+))?\]$/);
    if (cm) {
       if (cm[1] === 'ended') bodyText = (c.last_sender_id == S.user?.id ? 'Исходящий звонок' : 'Входящий звонок');
       else if (cm[1] === 'missed') bodyText = (c.last_sender_id == S.user?.id ? 'Отменённый звонок' : 'Пропущенный звонок');
       else bodyText = 'Отклонённый звонок';
    } else if (!bodyText) {
       bodyText = (c.last_media_type==='video'?'🎥 Видео':c.last_media_type==='voice'?'🎤 Голосовое сообщение':'🖼 Фото')||'Новое сообщение';
    }
    showRichNotif({
        senderName: name,
        senderAvatar: c.partner_avatar || null,
        senderId: c.partner_id,
        body: bodyText,
        chatId: c.chat_id,
        onClick: function() { if (S.chatId !== c.chat_id) openChat(c); }
      });
  });

  // ── Update chat list with FLIP animation (no jumps) ─────────
  const q=sbSearchActive?'':($('sb-q')?.value||'');
  if(q){renderChats(q);}
  else{
    const list=$('chat-list');
    const existing=new Map([...list.querySelectorAll('.ci')].map(el=>[+el.dataset.chatId,el]));
    const newIds=new Set(sortedChats.map(c=>c.chat_id));

    // Remove chats that no longer exist
    existing.forEach((el,id)=>{ if(!newIds.has(id))el.remove(); });

    // Update content of existing items / create new ones (no DOM reorder yet)
    const isNew=new Set();
    sortedChats.forEach(c=>{
      const old=existing.get(c.chat_id);
      if(old){
        if(_chatDataChanged(old,c)){
          _renderChatItemContent(old,c);
          old._chatData=_chatKey(c);
          old.onclick=()=>openChat(c);
          old.oncontextmenu=e=>{e.preventDefault();showChatCtx(e,c);};
        }
      } else {
        const newEl=makeChatItem(c);
        existing.set(c.chat_id,newEl);
        isNew.add(c.chat_id);
      }
    });

    // Check if order actually changed before touching DOM at all
    const currentOrder=[...list.querySelectorAll('.ci')].map(el=>+el.dataset.chatId);
    const newOrder=sortedChats.map(c=>c.chat_id);
    const orderChanged=currentOrder.length!==newOrder.length||currentOrder.some((id,i)=>id!==newOrder[i]);

    if(orderChanged){
      // FLIP — step 1: record positions BEFORE reorder
      const firstY=new Map();
      existing.forEach((el,id)=>{ if(!isNew.has(id))firstY.set(id, el.getBoundingClientRect().top); });

      // Reorder DOM
      sortedChats.forEach(c=>{
        const el=existing.get(c.chat_id);
        if(el)list.appendChild(el);
      });

      // FLIP — invert + play using a CSS class (never touch style.transition inline)
      sortedChats.forEach(c=>{
        const el=existing.get(c.chat_id);
        if(!el)return;
        if(isNew.has(c.chat_id)){
          // New item
          el.classList.add('ci-entering');
          requestAnimationFrame(()=>{
            el.classList.remove('ci-entering');
            el.classList.add('ci-entered');
            setTimeout(()=>el.classList.remove('ci-entered'),220);
          });
          return;
        }
        const oldY=firstY.get(c.chat_id);
        if(oldY===undefined)return;
        const dy=oldY-el.getBoundingClientRect().top;
        if(Math.abs(dy)<1)return;
        // Apply offset without transition (no style.transition manipulation)
        el.style.transform=`translateY(${dy}px)`;
        // Force paint, then animate to zero via class
        el.getBoundingClientRect(); // sync reflow
        el.classList.add('ci-moving');
        el.style.transform='';
        setTimeout(()=>el.classList.remove('ci-moving'),240);
      });
    }
  }
  const p=sortedChats.find(c=>c.chat_id===S.chatId);
  if(p){S.partner=p;updateHdrSt(p);}
  updateTitle();
}
let _syncRxnsRunning=false;
async function syncRxns(chatId){
  // Concurrency guard — предотвращаем гонку при burst-поллинге
  if(_syncRxnsRunning)return;
  _syncRxnsRunning=true;
  try{
    const all=S.msgs[chatId];if(!all||!all.length)return;
    const validIds = all.map(m => m.id).filter(id => !isTemp(id)).slice(-80); if(!validIds.length) return;
    const res = await api(`get_reactions?ids=${validIds.join(',')}`); if(!res.ok || chatId !== S.chatId) return;
    const map=res.reactions||{};
    const reqSet=new Set(validIds);
    const updates=[];
    all.forEach(m=>{
      if(isTemp(m.id)||!reqSet.has(m.id))return;
      const fresh=map[m.id]||[];
      if(JSON.stringify(S.rxns[m.id]||[])!==JSON.stringify(fresh))updates.push({m,fresh});
    });
    // Без withScrollAnchor — он вызывал дрейф скролла при конкурентных вызовах
    updates.forEach(({m,fresh})=>{S.rxns[m.id]=fresh;m.reactions=fresh;patchRxnDom(m.id,fresh);});
  }finally{_syncRxnsRunning=false;}
}

/* ══ SEARCH / NEW CHAT ════════════════════════════════════════ */
/* ══ UNIFIED SIDEBAR SEARCH ══════════════════════════════════ */
function getRecentUsers(){try{return JSON.parse(localStorage.getItem('sg_recent_users')||'[]');}catch{return[];}}
function saveRecentUser(u){let a=getRecentUsers().filter(x=>x.signal_id!==u.signal_id);a.unshift({id:u.id,nickname:u.nickname,signal_id:u.signal_id,avatar_url:u.avatar_url||null});localStorage.setItem('sg_recent_users',JSON.stringify(a.slice(0,3)));}
function removeRecentUser(sid){localStorage.setItem('sg_recent_users',JSON.stringify(getRecentUsers().filter(x=>x.signal_id!==sid)));if($('sb-q').value.trim()==='')renderSearchIdle();}

let sbSearchActive=false,sbSearchTimer,_searchReqId=0;

function enterSearch(){
  if(sbSearchActive)return;
  sbSearchActive=true;
  // Update mobile page title to "Поиск"
  const mobTitle = document.getElementById('sb-page-title');
  if (mobTitle) mobTitle.textContent = 'Поиск';
  // Hide any active nav-panels and clear their inline styles so CSS can take over
  document.querySelectorAll('.nav-panel').forEach(p => {
    p.style.transform = 'translateX(100%)';
    p.style.opacity = '0';
    p.style.pointerEvents = 'none';
  });
  // Clear inline styles on chat-list so CSS .searching can animate it
  const chatList = $('chat-list');
  if (chatList) {
    chatList.style.transform = '';
    chatList.style.opacity = '';
    chatList.style.pointerEvents = '';
  }
  const searchResults = $('sb-search-results');
  if (searchResults) {
    searchResults.style.transform = '';
    searchResults.style.opacity = '';
    searchResults.style.pointerEvents = '';
  }
  // Ensure nav-rail "chats" button is active
  document.querySelectorAll('.nav-rail-btn[data-nav]').forEach(b => b.classList.remove('active'));
  const chatsBtn = document.querySelector('.nav-rail-btn[data-nav="chats"]');
  if (chatsBtn) chatsBtn.classList.add('active');
  // Поднимаем панели на GPU-слой прямо перед анимацией
  const panels=document.querySelectorAll('.sb-panel');
  panels.forEach(p=>p.style.willChange='transform,opacity');
  $('sidebar').classList.add('searching');
  if($('sb-title')) $('sb-title').textContent = 'Поиск';
  renderSearchIdle();
}
function exitSearch(){
  sbSearchActive=false;
  $('sidebar').classList.remove('searching');
  $('sb-q').value='';
  if($('sb-title')) $('sb-title').textContent = 'Сообщения';
  // Restore mobile page title to current nav title
  const mobTitle = document.getElementById('sb-page-title');
  if (mobTitle) {
    const activeNav = document.querySelector('.mobile-nav-btn.active[data-nav], .nav-rail-btn.active[data-nav]');
    const navMap = { chats: 'Сообщения', feed: 'Лента', servers: 'Хабы' };
    mobTitle.textContent = navMap[activeNav?.dataset.nav] || 'Сообщения';
  }
  renderChats('');
  // Снимаем will-change после завершения transition (~300ms)
  const panels=document.querySelectorAll('.sb-panel');
  const cleanup=()=>panels.forEach(p=>{ p.style.willChange=''; p.removeEventListener('transitionend',cleanup); });
  panels.forEach(p=>p.addEventListener('transitionend',cleanup,{once:true}));
  setTimeout(()=>panels.forEach(p=>p.style.willChange=''),350); // fallback
  // Return focus to search input
  setTimeout(()=>$('sb-q')?.blur(),50);
}

function renderSearchIdle(){
  const c=$('sb-search-results');c.innerHTML='';

  // Ярлык «Избранное» всегда наверху поиска
  const savedChat=S.chats.find(ch=>isSavedMsgs(ch));
  if(savedChat){
    c.innerHTML='<div class="sb-section-label">Быстрый доступ</div>';
    const el=document.createElement('div');el.className='sb-result-item';
    const aviEl=document.createElement('div');
    aviEl.className='av-img av-saved';
    aviEl.style.cssText="width:40px;height:40px;flex-shrink:0";
    aviEl.innerHTML=`<svg viewBox="0 0 24 24" fill="none" width="20" height="20"><path d="M19 21l-7-3-7 3V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" fill="rgba(255,255,255,.95)" stroke="rgba(255,255,255,.25)" stroke-width="1" stroke-linejoin="round"/></svg>`;
    el.appendChild(aviEl);
    el.insertAdjacentHTML('beforeend',`<div style="flex:1;min-width:0"><div style="font-weight:700;font-size:14px">Избранное</div><div style="font-size:12px;color:var(--t2)">Ваши заметки</div></div>`);
    el.onclick=()=>{openChat(savedChat);};
    c.appendChild(el);
  }

  const recent=getRecentUsers();
  if(recent.length){
    c.insertAdjacentHTML('beforeend','<div class="sb-section-label">Недавние</div>');
    recent.forEach(u=>c.appendChild(makeSbItem(u,true)));
  } else if(!savedChat){
    c.innerHTML='<div class="empty-st" style="padding:32px 0"><div class="e-ico" style="font-size:28px;opacity:.25">🔍</div><p>Поиск по чатам и пользователям</p></div>';
  }
}

function makeSbItem(u,isRecent=false){
  const el=document.createElement('div');el.className='sb-result-item';
  el.innerHTML=`<div class="av-img" style="width:40px;height:40px;font-size:13px;flex-shrink:0">${aviHtml(u.nickname,u.avatar_url)}</div><div style="flex:1;min-width:0"><div style="font-weight:700;font-size:14px">${esc(u.nickname||'—')}</div><div style="font-size:12px;color:var(--t2)">@${esc(u.signal_id)}</div></div>`;
  if(isRecent){
    const del=document.createElement('button');del.className='sb-recent-del';
    del.innerHTML='<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>';
    del.onclick=ev=>{ev.stopPropagation();removeRecentUser(u.signal_id);};
    el.appendChild(del);
  }
  wtn(el);
  el.onclick=()=>{
    saveRecentUser(u);
    openProfileModal({...u,chat_id:u.chat_id||0,partner_id:u.id,partner_name:u.nickname,partner_signal_id:u.signal_id,partner_avatar:u.avatar_url,partner_bio:u.bio,is_verified:u.is_verified,is_team_signal:u.is_team_signal},false);
  };
  return el;
}

$('sb-q').onfocus=()=>{if(!sbSearchActive)enterSearch();};
// Cancel search via X button
$('btn-sb-close').onclick = () => { if(sbSearchActive) exitSearch(); };
// Cancel search when clicking outside sidebar — but allow clicks inside search results panel
document.addEventListener('mousedown', e => {
  if (!sbSearchActive) return;
  const sb = $('sidebar');
  if (sb && sb.contains(e.target)) return; // ignore clicks inside sidebar (search results are inside)
  // Cancel search if clicking nav-rail, chat area, profile footer, or prof-id
  const navRail = e.target.closest('.nav-rail');
  const chatArea = e.target.closest('#active-chat');
  const profId = e.target.closest('.prof-row');
  if (navRail || chatArea || profId) exitSearch();
});
$('btn-sb-search').onclick=()=>{if(sbCollapsed)toggleSidebar(false);setTimeout(()=>{$('sb-q').focus();},320);};

$('sb-q').oninput=()=>{
  const q=$('sb-q').value.trim();
  clearTimeout(sbSearchTimer);
  if(!sbSearchActive)enterSearch();
  if(!q){renderSearchIdle();return;}
  const c=$('sb-search-results');c.innerHTML='';

  // Совпадения по чатам — включая спецчаты
  const qL=q.toLowerCase().replace(/^@/,''); // Игнорируем @ для локального и API поиска
  const chatMatches=S.chats.filter(ch=>{
    if(isSavedMsgs(ch))return'заметки'.includes(qL)||(S.user?.nickname||'').toLowerCase().includes(qL)||(S.user?.signal_id||'').toLowerCase().includes(qL);
    if(isSystemChat(ch))return'signal'.includes(qL);
    return(ch.partner_name||'').toLowerCase().includes(qL)||(ch.partner_signal_id||'').toLowerCase().includes(qL);
  });

  if(chatMatches.length){
    c.innerHTML='<div class="sb-section-label">Чаты</div>';
    chatMatches.forEach(ch=>{
      const el=document.createElement('div');el.className='sb-result-item';
      // Спецаватар для Избранного / @signal
      let avHtml,dispName,sub;
      if(isSavedMsgs(ch)){
        avHtml=`<div class="av-img av-saved" style="width:40px;height:40px;flex-shrink:0"><svg viewBox="0 0 24 24" fill="none" width="20" height="20"><path d="M19 21l-7-3-7 3V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" fill="rgba(255,255,255,.95)" stroke="rgba(255,255,255,.25)" stroke-width="1" stroke-linejoin="round"/></svg></div>`;
        dispName='Заметки';sub='Ваше личное пространство';
      } else if(isSystemChat(ch)){
        avHtml=`<div class="av-img av-system" style="width:40px;height:40px;flex-shrink:0"><svg viewBox="0 0 24 24" fill="none" width="20" height="20" aria-hidden="true"><path d="M12 2.5l6 2.4v5.5c0 4.2-2.5 8-6 9.6-3.5-1.6-6-5.4-6-9.6V4.9l6-2.4z" fill="rgba(255,255,255,.96)"/><path d="M12 5.1l3.3 1.3v4c0 2.7-1.4 5.2-3.3 6.5-1.9-1.3-3.3-3.8-3.3-6.5v-4L12 5.1z" fill="rgba(139,92,246,.24)"/></svg></div>`;
        dispName='Initial';sub='Системные уведомления';
      } else {
        avHtml=`<div class="av-img" style="width:40px;height:40px;font-size:13px;flex-shrink:0">${aviHtml(ch.partner_name,ch.partner_avatar)}</div>`;
        dispName=ch.partner_name||'@'+ch.partner_signal_id;
        let subText = ch.last_message ? hideSpoilerText(ch.last_message) : '';
        const cm = subText.match(/^\[call:(missed|declined|ended)(?::(\d+))?\]$/);
        if (cm) {
           if (cm[1] === 'ended') subText = (ch.last_sender_id == S.user?.id ? 'Исходящий звонок' : 'Входящий звонок');
           else if (cm[1] === 'missed') subText = (ch.last_sender_id == S.user?.id ? 'Отменённый звонок' : 'Пропущенный звонок');
           else subText = 'Отклонённый звонок';
        } else {
           subText = subText.slice(0, 40);
        }
        sub = subText ? esc(subText) : '';
      }
      el.innerHTML=`${avHtml}<div style="flex:1;min-width:0"><div style="font-weight:700;font-size:14px">${esc(dispName)}</div><div style="font-size:12px;color:var(--t2)">${sub}</div></div>`;
      wtn(el);
      el.onclick=()=>{
        if(isSavedMsgs(ch)||isSystemChat(ch)){exitSearch();openChat(ch);}
        else if(ch.partner_id){
          saveRecentUser({signal_id:ch.partner_signal_id,nickname:ch.partner_name,avatar_url:ch.partner_avatar,id:ch.partner_id});
          openProfileModal({chat_id:ch.chat_id,partner_id:ch.partner_id,partner_name:ch.partner_name,partner_signal_id:ch.partner_signal_id,partner_avatar:ch.partner_avatar,partner_bio:ch.partner_bio,is_verified:ch.is_verified,is_team_signal:ch.is_team_signal},false);
        } else {exitSearch();openChat(ch);}
      };
      c.appendChild(el);
    });
  }

  // Поиск пользователей через API — не показывать системных / себя
  if(qL.length < 2) {
    return;
  }
  
  c.insertAdjacentHTML('beforeend','<div class="sb-section-label" id="lbl-users">Пользователи</div><div id="users-spin" style="display:flex;justify-content:center;padding:12px 0"><div style="width:18px;height:18px;border:2px solid rgba(255,255,255,.1);border-top-color:var(--y);border-radius:50%;animation:rot .6s linear infinite"></div></div>');
  
  const reqId = ++_searchReqId;
  sbSearchTimer=setTimeout(async()=>{
    const res=await api('search_user?q='+encodeURIComponent(qL));
    if(reqId !== _searchReqId) return; // Защита от гонки запросов при быстром вводе
    
    const spin=$('users-spin');if(spin)spin.remove();
    if(!res?.ok||!res.users?.length){const lbl=$('lbl-users');if(lbl)lbl.remove();return;}
    // Фильтруем системных пользователей и себя из результатов поиска
    const filtered=res.users.filter(u=>u.signal_id!=='signal'&&u.id!==S.user?.id);
    if(!filtered.length){const lbl=$('lbl-users');if(lbl)lbl.remove();return;}
    filtered.forEach(u=>{
      const el=makeSbItem(u,false);
      // Open profile modal on click without canceling search
      el.onclick=()=>{
        saveRecentUser(u);
        openProfileModal({...u,chat_id:u.chat_id||0,partner_id:u.id,partner_name:u.nickname,partner_signal_id:u.signal_id,partner_avatar:u.avatar_url,partner_bio:u.bio,is_verified:u.is_verified,is_team_signal:u.is_team_signal},false);
      };
      c.appendChild(el);
    });
  },400);
};
let sqT;
/* user search moved inline */
async function startChat(u){
  saveRecentUser(u);
  if(sbSearchActive)exitSearch();
  const ex=S.chats.find(c=>c.partner_signal_id===u.signal_id);
  if(ex){openChat(ex);return;}
  
  const fake={
    chat_id:0,
    partner_id:u.id,
    partner_name:u.nickname||u.signal_id,
    partner_signal_id:u.signal_id,
    partner_avatar:u.avatar_url,
    partner_bio:u.bio,
    partner_last_seen:null,
    partner_is_typing:0,
    partner_is_verified:u.is_verified,
    partner_is_team_signal:u.is_team_signal
  };
  S.partner=fake;
  S.chatId=null;
  const name=u.nickname||'@'+u.signal_id;
  
  updateHeaderUI(fake, name);
  $('hdr-st').textContent='';
  $('chat-welcome').style.display='none';
  $('active-chat').style.display='flex';
  
  if(__isMobileView()){
    $('sidebar').classList.add('hidden');
    requestAnimationFrame(()=>$('active-chat').classList.add('mb-visible'));
    history.pushState({chat:0},'','');
    const mbNav = document.getElementById('mobile-bottom-nav');
    if(mbNav) mbNav.classList.add('hidden');
  }
  renderEmptyChat(0);
  mfield.focus();
}
/* ══ MISC ════════════════════════════════════════════════════ */
$$('[data-close]').forEach(b=>b.onclick=()=>closeMod(b.dataset.close));
$$('.overlay').forEach(o=>o.onclick=e=>{if(e.target===o)closeMod(o.id);});
// chat-q merged into sb-q
function goBackToList(){
  if(S.chatId)saveScrollPos(S.chatId);
  try{localStorage.removeItem('sg_last_chat');}catch(e){}
  // Remove active highlight from chat list
  $$('.ci').forEach(e=>e.classList.remove('active'));
  if(__isMobileView()){
    // Slide chat out to the right, slide sidebar in from left
    $('active-chat').classList.remove('mb-visible');
    $('sidebar').classList.remove('hidden');
    const mbNav = document.getElementById('mobile-bottom-nav');
    if(mbNav) mbNav.classList.remove('hidden');
    setTimeout(()=>{
      S.chatId=null;
      $('active-chat').style.display='';
      $('chat-welcome').style.display='flex';
      if(typeof showWelcomeScreen==='function')showWelcomeScreen();
    },300); // matches transition duration
  } else {
    // Desktop: animate close
    const ac = $('active-chat');
    ac.style.transition = 'opacity .2s ease, transform .2s ease';
    ac.style.opacity = '0';
    ac.style.transform = 'translateX(20px)';
    setTimeout(()=>{
      S.chatId=null;
      ac.style.display='none';
      ac.style.transition = '';
      ac.style.opacity = '';
      ac.style.transform = '';
      $('chat-welcome').style.display='flex';
      if(typeof showWelcomeScreen==='function')showWelcomeScreen();
    }, 200);
  }
}

$('btn-back-mb').onclick=()=>{
  history.back(); // triggers popstate, which calls goBackToList
};

// Esc — сначала отменить редактирование/ответ, потом закрыть чат
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  // 0. Esc prioritizes canceling search
  if (sbSearchActive) { exitSearch(); return; }
  if (!S.chatId) return;
  // Не перехватывать если открыт модал, эмодзи-пикер или контекстное меню
  if (document.querySelector('.overlay.on')) return;
  if (document.querySelector('.epicker.on')) return;
  if (document.querySelector('.ctxmenu.on') || document.querySelector('#chat-ctxmenu.on')) return;

  // 1. Если редактируем сообщение — отменить
  if (typeof editingMsgId !== 'undefined' && editingMsgId) {
    cancelEdit();
    return;
  }
  // 2. Если отвечаем на сообщение — отменить ответ
  if (S.replyTo) {
    S.replyTo = null;
    hideRbar();
    return;
  }
  // 3. Иначе — закрыть чат
  goBackToList();
});

// System back (Android hardware button, browser back gesture)
window.addEventListener('popstate',e=>{
  // Don't close chat if settings panel or a modal is handling the back gesture
  if(__isMobileView()&&$('active-chat').classList.contains('mb-visible')){
    const panel = $('sb-profile-panel');
    if (panel && panel.classList.contains('open')) return;
    // Check if any modal is open
    if (document.querySelector('.overlay.on')) return;
    goBackToList();
  }
});

/* ══ SIDEBAR COLLAPSE ════════════════════════════════════════ */
let sbCollapsed=false;
function toggleSidebar(force){
  sbCollapsed=force!==undefined?force:!sbCollapsed;
  $('sidebar').classList.toggle('collapsed',sbCollapsed);
  document.querySelector('.layout').classList.toggle('sb-collapsed',sbCollapsed);
  const p=$('sb-chv-path');
  if(p)p.setAttribute('d',sbCollapsed?'M13 5l7 7-7 7M6 5l7 7-7 7':'M11 19l-7-7 7-7M18 19l-7-7 7-7');
}
$('btn-collapse-sb').onclick=()=>toggleSidebar();
$('btn-sb-expand').onclick=()=>toggleSidebar(false);

/* ══ UNIFY INPUT WRAP ════════════════════════════════════════ */
(function unifyInput() {
  const mfWrap = document.querySelector('.mfield-wrap');
  const rbar = document.getElementById('rbar');
  if (mfWrap && rbar) {
    mfWrap.classList.add('unified-input-wrap');
    mfWrap.insertBefore(rbar, document.getElementById('mfield'));
  }
})();

/* ══ RESIZE SIDEBAR ══════════════════════════════════════════ */
(()=>{
  const handle=$('resize-handle');const sidebar=$('sidebar');
  let dragging=false,startX=0,startW=0;
  handle.addEventListener('mousedown',e=>{
    dragging=true;startX=e.clientX;startW=sidebar.offsetWidth;
    handle.classList.add('dragging');document.body.style.userSelect='none';
  });
  document.addEventListener('mousemove',e=>{
    if(!dragging)return;
    const newW=Math.max(200,Math.min(480,startW+(e.clientX-startX)));
    document.documentElement.style.setProperty('--sb-w',newW+'px');
    // Update title in real-time during drag
    const el=$('sb-title');if(el&&el.textContent!=='Поиск')el.textContent='Сообщения';
  });
  document.addEventListener('mouseup',()=>{if(!dragging)return;dragging=false;handle.classList.remove('dragging');document.body.style.userSelect='';});
})();

function updateHeaderUI(c, name) {
  // 1. Name & Badges
  const hn = $('hdr-name');
  if(hn) {
    hn.textContent = '';
    let displayName;
    if(isSavedMsgs(c)) displayName = 'Заметки';
    else if(isSystemChat(c)) displayName = 'Initial';
    else displayName = name;

    const span = document.createElement('span');
    span.className = 'marquee-inner';
    span.textContent = displayName;
    wtn(span);
    hn.appendChild(span);

    if(isVerified(c) && !isSavedMsgs(c)) {
      const vb = document.createElement('span');
      vb.style.display = 'flex';
      vb.innerHTML = '<svg class="verified-badge sm" viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg" width="14" height="14"><path d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.705 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681s.075-1.299-.165-1.903c.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z" fill="currentColor"/></svg>';
      hn.appendChild(vb);
    }
    
    if(isTeamSignal(c) && !isSavedMsgs(c) && !isSystemChat(c)) {
      const tb = document.createElement('span');
      tb.style.display = 'flex';
      tb.innerHTML = teamBadgeSvg('sm');
      hn.appendChild(tb);
    }
    hn.style.display = 'flex';
    hn.style.alignItems = 'center';
    hn.style.gap = '4px';
        hn.style.minWidth = '0';
        hn.style.maxWidth = '100%';
        setTimeout(() => checkMarquee(span), 50);

    // Mute indicator in header
    const isMutedUser = (typeof isUserMuted === 'function' && c.partner_id) ? isUserMuted(c.partner_id) : false;
    const existingMuteIcon = hn.querySelector('.hdr-mute-icon');
    if (existingMuteIcon) existingMuteIcon.remove();
    if (isMutedUser && !isSavedMsgs(c) && !isSystemChat(c)) {
      const mi = document.createElement('span');
      mi.className = 'hdr-mute-icon';
      mi.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>';
      hn.appendChild(mi);
    }
  }

  // 2. Avatar (desktop)
  const hdrAv = $('hdr-av');
  if(hdrAv) {
    if(isSavedMsgs(c)){
      hdrAv.className='av-img av-saved';
      hdrAv.innerHTML='<svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M17 3H7a2 2 0 00-2 2v16l7-3 7 3V5a2 2 0 00-2-2z"/></svg>';
    } else if(isSystemChat(c)){
      hdrAv.className='av-img';
      hdrAv.innerHTML=aviHtml(c.partner_name||'Initial', c.partner_avatar || c.avatar_url);
    } else {
      hdrAv.className='av-img';
      hdrAv.innerHTML=aviHtml(name, c.partner_avatar || c.avatar_url);
    }
  }

  // 3. Avatar (mobile — same content)
  const hdrAvMb = $('hdr-av-mb');
  if(hdrAvMb) {
    if(isSavedMsgs(c)){
      hdrAvMb.className='av-img av-saved';
      hdrAvMb.innerHTML='<svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M17 3H7a2 2 0 00-2 2v16l7-3 7 3V5a2 2 0 00-2-2z"/></svg>';
    } else if(isSystemChat(c)){
      hdrAvMb.className='av-img';
      hdrAvMb.innerHTML=aviHtml(c.partner_name||'Initial', c.partner_avatar || c.avatar_url);
    } else {
      hdrAvMb.className='av-img';
      hdrAvMb.innerHTML=aviHtml(name, c.partner_avatar || c.avatar_url);
    }
  }
  
  const btnCall = $('btn-hdr-call');
  if(btnCall) {
    btnCall.style.display = (isSavedMsgs(c) || isSystemChat(c)) ? 'none' : '';
  }
}
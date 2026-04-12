'use strict';
/* ══ CHANNELS — Telegram-style channels module ══ */

/* ══ STATE EXTENSIONS ══════════════════════════════════════════ */
S.channels = [];
S.activeChannel = null;
S.channelMsgs = {};
S.channelLastId = {};
S.channelSSE = null;
S._channelSSEActive = false;

/* ══ CACHE ════════════════════════════════════════════════════ */
const CACHE_CH_PFX = 'sg_ch_';
function cacheWriteChannel(id, msgs) {
  try { localStorage.setItem(CACHE_CH_PFX + id, JSON.stringify(msgs.slice(-60))); } catch(e){}
}
function cacheReadChannel(id) {
  try { return JSON.parse(localStorage.getItem(CACHE_CH_PFX + id) || 'null'); } catch { return null; }
}
function cacheDeleteChannel(id) {
  try { localStorage.removeItem(CACHE_CH_PFX + id); } catch(e){}
}

/* ══ HELPERS ════════════════════════════════════════════════════ */
function _chRoleLabel(role) {
  if (role === 'owner') return 'Владелец';
  if (role === 'admin') return 'Админ';
  return 'Подписчик';
}
function _chIsAdmin(ch) {
  if (!ch) return false;
  const myId = S.user?.id;
  if (ch.owner_id === myId) return true;
  if (ch.my_role === 'owner' || ch.my_role === 'admin') return true;
  return false;
}
function _chIsOwner(ch) {
  if (!ch) return false;
  const myId = S.user?.id;
  if (ch.owner_id === myId) return true;
  return ch.my_role === 'owner';
}
function _fmtViews(n) {
  if (!n && n !== 0) return '';
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace('.0', '') + 'М';
  if (n >= 1000) return (n / 1000).toFixed(1).replace('.0', '') + 'К';
  return String(n);
}
function _chAvatarHtml(ch) {
  const name = ch.name || 'Канал';
  const url = ch.avatar_url;
  if (url) {
    return '<div class="av-img">' + aviHtml(name, url) + '</div>';
  }
  // Channel icon fallback
  const color = _avatarColor(name);
  return '<div class="av-img" style="background:' + color + ';color:#fff;display:flex;align-items:center;justify-content:center"><svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M4.5 3h15A2.5 2.5 0 0 1 22 5.5v13a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 18.5v-13A2.5 2.5 0 0 1 4.5 3zm0 2a.5.5 0 0 0-.5.5v13a.5.5 0 0 0 .5.5h15a.5.5 0 0 0 .5-.5v-13a.5.5 0 0 0-.5-.5h-15zM9 15.5l6-4.5-6-4.5v9z"/></svg></div>';
}

/* ══ INIT ══════════════════════════════════════════════════════ */
async function initChannels() {
  // Populate panel-servers content
  const panel = $('panel-servers');
  if (panel) {
    panel.innerHTML = '<div class="ch-panel-inner">' +
      '<div class="ch-panel-head">' +
        '<div class="ch-panel-title">Каналы</div>' +
        '<div style="display:flex;gap:6px">' +
          '<button class="ico-btn ch-ico-btn" id="btn-ch-search" title="Поиск каналов"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="18" height="18"><circle cx="11" cy="11" r="8"/><path stroke-linecap="round" d="M21 21l-4.35-4.35"/></svg></button>' +
          '<button class="ico-btn ch-ico-btn" id="btn-ch-join" title="Присоединиться"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="18" height="18"><path stroke-linecap="round" stroke-linejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"/></svg></button>' +
          '<button class="ico-btn ch-ico-btn" id="btn-ch-create" title="Создать канал"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="18" height="18"><path stroke-linecap="round" d="M12 4v16m8-8H4"/></svg></button>' +
        '</div>' +
      '</div>' +
      '<div class="ch-list" id="ch-list"></div>' +
    '</div>';

    $('btn-ch-create').onclick = showCreateChannelModal;
    $('btn-ch-join').onclick = showJoinChannelModal;
    $('btn-ch-search').onclick = showChannelSearch;
  }
  // Wire nav titles
  if (window.NAV_TITLES) window.NAV_TITLES.channels = 'Каналы';
  await loadChannels();
}

/* ══ LOAD CHANNELS ════════════════════════════════════════════ */
async function loadChannels() {
  const res = await api('get_channels');
  if (!res.ok) return;
  S.channels = (res.channels || []).sort((a, b) => (b.last_message_time || 0) - (a.last_message_time || 0));
  renderChannelsList();
}

/* ══ RENDER CHANNELS LIST ═════════════════════════════════════ */
function renderChannelsList() {
  const list = $('ch-list');
  if (!list) return;
  list.querySelectorAll('.ch-item').forEach(e => e.remove());
  if (!S.channels.length) {
    list.innerHTML = '<div class="empty-st"><div class="e-ico">📢</div><p>Нет каналов.<br>Создайте свой или найдите интересные</p></div>';
    return;
  }
  S.channels.forEach(ch => list.appendChild(_makeChannelItem(ch)));
}

function _makeChannelItem(ch) {
  const el = document.createElement('div');
  el.className = 'ch-item' + (S.activeChannel && S.activeChannel.channel_id === ch.channel_id ? ' active' : '');
  el.dataset.chId = ch.channel_id;

  const name = ch.name || 'Канал';
  const desc = ch.description ? (ch.description.length > 50 ? ch.description.slice(0, 50) + '…' : ch.description) : '';
  const lastMsg = ch.last_message ? (ch.last_message.length > 60 ? ch.last_message.slice(0, 60) + '…' : ch.last_message) : '';
  const time = ch.last_message_time ? fmtChatTime(ch.last_message_time) : '';
  const unread = ch.unread_count || 0;
  const isPrivate = ch.type === 'private';

  el.innerHTML =
    '<div class="ch-item-av">' + _chAvatarHtml(ch) + '</div>' +
    '<div class="ch-item-meta">' +
      '<div class="ch-item-row">' +
        '<div class="ch-item-name"><span class="marquee-inner">' + esc(name) + '</span>' +
          (isPrivate ? '<svg class="ch-lock-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="14" height="14"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>' : '') +
        '</div>' +
        '<div class="ch-item-ts">' + time + '</div>' +
      '</div>' +
      '<div class="ch-item-prev">' +
        '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
          (lastMsg ? esc(lastMsg) : (desc ? '<span style="color:var(--t3)">' + esc(desc) + '</span>' : '<span style="color:var(--t3)">Нет сообщений</span>')) +
        '</span>' +
        (unread > 0 ? '<span class="badge">' + (unread > 99 ? '99+' : unread) + '</span>' : '') +
      '</div>' +
    '</div>';

  el.onclick = () => openChannel(ch);
  el.oncontextmenu = (e) => { e.preventDefault(); _showChannelItemCtx(e, ch); };
  wtn(el);
  const nameSpan = el.querySelector('.ch-item-name .marquee-inner');
  if (nameSpan) setTimeout(() => checkMarquee(nameSpan), 0);
  return el;
}

function _showChannelItemCtx(e, ch) {
  const items = [];
  items.push({ label: 'Открыть', icon: '💬', action: () => openChannel(ch) });
  if (_chIsAdmin(ch)) {
    items.push({ label: 'Настройки', icon: '⚙️', action: () => { openChannel(ch); setTimeout(() => showChannelSettings(ch), 200); } });
  }
  items.push({ label: 'Скопировать ссылку', icon: '🔗', action: () => copyChannelLink(ch) });
  items.push({ label: 'Покинуть', icon: '🚪', action: () => _leaveChannel(ch.channel_id) });
  _showCtxMenu(e, items);
}

/* ══ CONTEXT MENU ════════════════════════════════════════════ */
let _chCtxEl = null;
function _showCtxMenu(e, items) {
  _closeCtxMenu();
  const menu = document.createElement('div');
  menu.className = 'ctxmenu';
  menu.id = 'ch-ctxmenu';
  items.forEach((it, i) => {
    const d = document.createElement('div');
    d.className = 'ctx-it' + (it.danger ? ' danger' : '');
    d.innerHTML = '<span>' + it.label + '</span>';
    d.onclick = () => { _closeCtxMenu(); it.action(); };
    menu.appendChild(d);
  });
  document.body.appendChild(menu);
  _chCtxEl = menu;
  // Position
  const x = Math.min(e.clientX, window.innerWidth - 200);
  const y = Math.min(e.clientY, window.innerHeight - items.length * 40 - 20);
  menu.style.display = 'block';
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  requestAnimationFrame(() => menu.classList.add('on'));
  const close = (ev) => { if (!menu.contains(ev.target)) { _closeCtxMenu(); } };
  setTimeout(() => document.addEventListener('click', close, { once: true }), 10);
}
function _closeCtxMenu() {
  if (_chCtxEl) { _chCtxEl.remove(); _chCtxEl = null; }
}

/* ══ OPEN CHANNEL ════════════════════════════════════════════ */
function openChannel(ch) {
  // Close any existing channel view or chat first
  if (S.activeChannel) stopChannelSSE();
  if (S.chatId) { saveScrollPos(S.chatId); stopSSE(); }

  S.activeChannel = ch;
  S.chatId = null; // Not a regular chat
  S.partner = null;
  hideRbar(true);
  exitSelectMode();
  if (window._hidePill) window._hidePill();
  if (window._closeChatSearch) window._closeChatSearch();

  // Update header
  renderChannelHeader(ch);

  // Show active chat area
  $('chat-welcome').style.display = 'none';
  $('active-chat').style.display = 'flex';

  // Mobile: hide sidebar
  if (__isMobileView()) {
    $('sidebar').classList.add('hidden');
    requestAnimationFrame(() => $('active-chat').classList.add('mb-visible'));
    history.pushState({ channel: ch.channel_id }, '');
    const mbNav = $('mobile-bottom-nav');
    if (mbNav) mbNav.classList.add('hidden');
  }

  // Hide input zone for non-admins
  const inpZone = $('input-zone');
  const isAdmin = _chIsAdmin(ch);
  if (inpZone) inpZone.style.display = isAdmin ? '' : 'none';

  // Remove system-mute-pill if present
  const pill = $('system-mute-pill');
  if (pill) pill.remove();

  // Render messages
  const area = $('msgs');
  const chId = ch.channel_id;
  S.channelMsgs[chId] = S.channelMsgs[chId] || [];
  const cached = cacheReadChannel(chId);

  if (cached && cached.length) {
    S.channelMsgs[chId] = cached;
    S.channelLastId[chId] = cached.reduce((mx, m) => Math.max(mx, +m.id), 0);
    area.innerHTML = '';
    _renderChannelMsgs(chId);
    area.scrollTop = area.scrollHeight;
    fetchChannelMsgs(chId, true);
  } else {
    area.innerHTML = '';
    const skelWrap = document.createElement('div');
    skelWrap.className = 'init-skel-wrap';
    skelWrap.style.cssText = 'flex:1;display:flex;flex-direction:column;justify-content:flex-end;padding-bottom:20px;overflow:hidden;pointer-events:none;';
    if (typeof window.makeSkeleton === 'function') skelWrap.appendChild(window.makeSkeleton(8));
    area.appendChild(skelWrap);
    S.channelMsgs[chId] = [];
    S.channelLastId[chId] = 0;
    fetchChannelMsgs(chId, true);
  }

  // Reset pin bar
  if (typeof resetPinBarForChatSwitch === 'function') resetPinBarForChatSwitch();

  // Start SSE for channel
  startChannelSSE(chId);

  // Update sidebar active
  document.querySelectorAll('.ch-item').forEach(e => e.classList.remove('active'));
  document.querySelector('.ch-item[data-ch-id="' + ch.channel_id + '"]')?.classList.add('active');
}

/* ══ CLOSE CHANNEL ════════════════════════════════════════════ */
function closeChannel() {
  if (!S.activeChannel) return;
  stopChannelSSE();
  S.activeChannel = null;

  // Restore UI
  $('active-chat').style.display = 'none';
  $('active-chat').classList.remove('mb-visible');
  $('chat-welcome').style.display = '';
  $('msgs').innerHTML = '';
  $('msgs').style.display = '';

  // Restore header
  $('hdr-name').textContent = '—';
  $('hdr-st').textContent = '';
  $('hdr-st').className = 'hdr-st';
  const hdrAv = $('hdr-av');
  if (hdrAv) hdrAv.innerHTML = '';
  const hdrAvMb = $('hdr-av-mb');
  if (hdrAvMb) hdrAvMb.innerHTML = '';

  // Show input zone again
  const inpZone = $('input-zone');
  if (inpZone) inpZone.style.display = '';

  // Mobile
  if (__isMobileView()) {
    $('sidebar').classList.remove('hidden');
    const mbNav = $('mobile-bottom-nav');
    if (mbNav) mbNav.classList.remove('hidden');
  }

  // Clear channel active
  document.querySelectorAll('.ch-item').forEach(e => e.classList.remove('active'));

  // Restart regular SSE if there was a chat open
  if (S.chatId) {
    startSSE(S.chatId, S.lastId[S.chatId] || 0);
  }
}

/* ══ RENDER CHANNEL HEADER ════════════════════════════════════ */
function renderChannelHeader(ch) {
  const nameEl = $('hdr-name');
  const stEl = $('hdr-st');
  const hdrAv = $('hdr-av');
  const hdrAvMb = $('hdr-av-mb');

  if (nameEl) {
    nameEl.innerHTML = '<span style="display:flex;align-items:center;gap:6px">' +
      '<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16" style="flex-shrink:0;opacity:.6"><path d="M4.5 3h15A2.5 2.5 0 0 1 22 5.5v13a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 18.5v-13A2.5 2.5 0 0 1 4.5 3zm0 2a.5.5 0 0 0-.5.5v13a.5.5 0 0 0 .5.5h15a.5.5 0 0 0 .5-.5v-13a.5.5 0 0 0-.5-.5h-15zM9 15.5l6-4.5-6-4.5v9z"/></svg>' +
      esc(ch.name || 'Канал') +
      (_chIsAdmin(ch) ? '<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14" title="' + _chRoleLabel(ch.my_role || 'admin') + '" style="opacity:.5"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>' : '') +
    '</span>';
    wtn(nameEl);
  }

  const members = ch.member_count || ch.subscribers || 0;
  const desc = ch.description || '';
  if (stEl) {
    stEl.className = 'hdr-st';
    stEl.textContent = (desc && desc.length > 30 ? desc.slice(0, 30) + '…' : desc) || (members ? members + ' подписчиков' : '');
  }

  const aviContent = aviHtml(ch.name || 'Канал', ch.avatar_url);
  if (hdrAv) hdrAv.innerHTML = aviContent;
  if (hdrAvMb) hdrAvMb.innerHTML = aviContent;

  // Override header click to show channel settings
  const hdrClick = $('hdr-clickable');
  if (hdrClick) {
    hdrClick.onclick = () => {
      if (S.activeChannel) showChannelSettings(S.activeChannel);
    };
  }
  const mbAvBtn = $('hdr-mb-avatar');
  if (mbAvBtn) {
    mbAvBtn.onclick = () => {
      if (S.activeChannel) showChannelSettings(S.activeChannel);
    };
  }
  // Hide call/search buttons in channel header
  const callBtn = $('btn-hdr-call');
  if (callBtn) callBtn.style.display = 'none';

  // More button → channel settings
  const moreBtn = $('btn-hdr-more');
  if (moreBtn) {
    moreBtn.onclick = (e) => {
      if (!S.activeChannel) return;
      const items = [
        { label: 'Поиск', icon: '🔍', action: () => { if (window._openChatSearch) window._openChatSearch(); } },
        { label: 'Настройки', icon: '⚙️', action: () => showChannelSettings(S.activeChannel) },
        { label: 'Скопировать ссылку', icon: '🔗', action: () => copyChannelLink(S.activeChannel) },
      ];
      if (_chIsAdmin(S.activeChannel)) {
        items.push({ label: 'Закрепить сообщение', icon: '📌', action: () => toast('Выберите сообщение для закрепления', 'info') });
      }
      _showCtxMenu(e, items);
    };
  }

  // Close button → back to sidebar
  const closeBtn = $('btn-hdr-close');
  if (closeBtn) {
    closeBtn.onclick = () => closeChannel();
  }

  // Back button (mobile) → close channel
  const backBtn = $('btn-back-mb');
  if (backBtn) {
    backBtn.onclick = () => {
      if (__isMobileView() && history.state?.channel) {
        history.back();
      } else {
        closeChannel();
      }
    };
  }

  // Override send to channel
  const sendBtn = $('btn-send');
  if (sendBtn && S.activeChannel) {
    const old = sendBtn.onclick;
    sendBtn.onclick = (e) => {
      e.stopPropagation();
      sendChannelText();
    };
  }
}

/* ══ FETCH CHANNEL MESSAGES ═══════════════════════════════════ */
async function fetchChannelMsgs(chId, init) {
  if (!chId) return;
  if (init) {
    S._chInitId = chId;
    const hadCache = !!(S.channelMsgs[chId]?.length);
    const res = await api('get_channel_messages?channel_id=' + chId + '&init=1&limit=50');
    S._chInitId = null;
    if (!res.ok || (S.activeChannel && chId !== S.activeChannel.channel_id)) return;

    const msgs = (res.messages || []).map(m => {
      if (m.media_url) m.media_url = getMediaUrl(m.media_url);
      return m;
    });
    S.channelMsgs[chId] = msgs;
    S.channelLastId[chId] = msgs.reduce((mx, m) => Math.max(mx, +m.id), 0);
    cacheWriteChannel(chId, msgs);

    const area = $('msgs');
    if (hadCache && S.activeChannel) {
      // Diff and patch
      _patchChannelMsgs(chId, msgs);
    } else if (S.activeChannel) {
      const skel = area.querySelector('.init-skel-wrap');
      if (skel) skel.remove();
      area.innerHTML = '';
      _renderChannelMsgs(chId);
      area.scrollTop = area.scrollHeight;
    }
    return;
  }

  // Polling mode
  const afterId = S.channelLastId[chId] || 0;
  if (!afterId) return;
  const res = await api('get_channel_messages?channel_id=' + chId + '&after_id=' + afterId + '&limit=50');
  if (!res.ok || (S.activeChannel && chId !== S.activeChannel.channel_id)) return;

  // Update channel info
  if (res.channel) {
    const idx = S.channels.findIndex(c => c.channel_id === chId);
    if (idx >= 0) S.channels[idx] = { ...S.channels[idx], ...res.channel };
  }

  // Deleted messages
  const deleted = res.deleted_ids || [];
  if (deleted.length) {
    deleted.forEach(id => {
      if (S.channelMsgs[chId]) S.channelMsgs[chId] = S.channelMsgs[chId].filter(m => m.id !== id);
      const el = document.querySelector('.mrow[data-id="' + id + '"]');
      if (el) deleteMsgElRemote(el);
    });
  }

  // New messages
  const msgs = (res.messages || []).map(m => {
    if (m.media_url) m.media_url = getMediaUrl(m.media_url);
    return m;
  });
  if (msgs.length) {
    const area = $('msgs');
    const atBot = area ? (area.scrollHeight - area.scrollTop - area.clientHeight < 130) : false;
    msgs.forEach(m => {
      const existing = (S.channelMsgs[chId] || []).find(x => x.id === m.id);
      if (!existing) {
        S.channelMsgs[chId] = S.channelMsgs[chId] || [];
        S.channelMsgs[chId].push(m);
        if (S.activeChannel && chId === S.activeChannel.channel_id) {
          appendChannelMsg(chId, m);
        }
      } else if (existing.body !== m.body || existing.is_edited !== m.is_edited) {
        Object.assign(existing, m);
        _patchChannelMsgDom(m);
      }
    });
    S.channelLastId[chId] = msgs.reduce((mx, m) => Math.max(mx, +m.id), S.channelLastId[chId] || 0);
    if (atBot && area) scrollBot();
    cacheWriteChannel(chId, S.channelMsgs[chId]);
  }
}

/* ══ RENDER CHANNEL MESSAGES ═══════════════════════════════════ */
function _renderChannelMsgs(chId) {
  const area = $('msgs');
  const msgs = S.channelMsgs[chId] || [];
  if (!msgs.length) {
    area.innerHTML = '<div class="chat-empty-state"><div class="chat-empty-card">' +
      '<div class="e-txt">В этом канале пока нет сообщений</div>' +
      '<div class="e-sub">Будьте первыми!</div>' +
    '</div></div>';
    return;
  }
  let lastDate = null;
  msgs.forEach(m => {
    const d = fmtDate(m.sent_at);
    if (d !== lastDate) {
      const sep = document.createElement('div');
      sep.className = 'date-pill';
      sep.innerHTML = '<span>' + d + '</span>';
      area.appendChild(sep);
      lastDate = d;
    }
    area.appendChild(_makeChannelMsgEl(m));
  });
}

function _patchChannelMsgs(chId, freshMsgs) {
  const area = $('msgs');
  if (!area) return;
  const oldIds = new Set((S.channelMsgs[chId] || []).map(m => m.id));
  // Remove deleted
  oldIds.forEach(id => {
    if (!freshMsgs.find(m => m.id === id)) {
      const el = area.querySelector('.mrow[data-id="' + id + '"]');
      if (el) el.remove();
    }
  });
  // Add new
  freshMsgs.forEach(m => {
    if (!oldIds.has(m.id)) {
      appendChannelMsg(chId, m);
    }
  });
  // Patch edited
  freshMsgs.forEach(m => {
    if (oldIds.has(m.id)) _patchChannelMsgDom(m);
  });
}

function appendChannelMsg(chId, m) {
  const area = $('msgs');
  if (!area) return;
  if (area.querySelector('.mrow[data-id="' + m.id + '"]')) return;
  const empty = area.querySelector('.chat-empty-state');
  if (empty) empty.remove();
  const d = fmtDate(m.sent_at);
  const seps = area.querySelectorAll('.date-pill');
  const lastDate = seps.length ? seps[seps.length - 1].querySelector('span')?.textContent : null;
  if (d !== lastDate) {
    const sep = document.createElement('div');
    sep.className = 'date-pill';
    sep.innerHTML = '<span>' + d + '</span>';
    area.appendChild(sep);
  }
  const el = _makeChannelMsgEl(m);
  el.classList.add('msg-anim-in');
  area.appendChild(el);
  setTimeout(() => el.classList.remove('msg-anim-in'), 350);
}

function _patchChannelMsgDom(m) {
  const el = document.querySelector('.mrow[data-id="' + m.id + '"]');
  if (!el) return;
  const newEl = _makeChannelMsgEl(m);
  newEl.style.animation = 'none';
  el.replaceWith(newEl);
}

/* ══ BUILD CHANNEL MESSAGE ELEMENT ════════════════════════════ */
function _makeChannelMsgEl(m) {
  const ch = S.activeChannel;
  const isMe = m.sender_id == S.user?.id;
  const sending = isTemp(m.id);
  const isAdmin = m.is_admin || m.sender_role === 'admin' || m.sender_role === 'owner';

  const row = document.createElement('div');
  row.className = 'mrow ch-msg' + (sending ? ' sending' : '');
  row.dataset.sid = String(m.sender_id);
  row.dataset.id = m.id;

  // Checkbox for select mode
  const cb = document.createElement('div');
  cb.className = 'msg-checkbox';
  row.appendChild(cb);

  // No avatar next to each message — channel style
  // Sender name above bubble
  const senderName = m.nickname || m.sender_name || ch?.name || 'Канал';
  const showSender = isAdmin || isMe || !ch; // always show for admin posts

  const bub = document.createElement('div');
  bub.className = 'mbub';

  const hasMedia = !!(m.media_url && m.media_type);
  const hasText = !!(m.body && m.body.trim()) && m.media_type !== 'voice';
  const mediaOnly = hasMedia && !hasText;

  const body = document.createElement('div');
  body.className = 'mbody' + (mediaOnly ? ' media-only' : '') + (sending ? ' sending' : '') + (m.is_edited ? ' is-edited' : '');

  // Forward label
  if (m.forwarded_from) {
    const fwd = document.createElement('div');
    fwd.className = 'fwd-label';
    fwd.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path stroke-linecap="round" stroke-linejoin="round" d="M7 17L17 7M17 7H7M17 7v10"/></svg> ' +
      'Переслано от <b>' + esc(m.forwarded_from) + '</b>';
    body.appendChild(fwd);
  }

  // Sender name (shown above bubble for admin posts)
  if (showSender && !m.forwarded_from) {
    const nameDiv = document.createElement('div');
    nameDiv.className = 'ch-sender-name';
    nameDiv.textContent = senderName;
    nameDiv.style.cssText = 'font-weight:600;font-size:13px;color:var(--accent);margin-bottom:2px;cursor:pointer';
    body.appendChild(nameDiv);
  }

  // Reply
  if (m.reply_to) {
    const orig = (S.channelMsgs[ch?.channel_id] || S.msgs[S.chatId] || []).find(x => x.id == m.reply_to);
    let rText = 'Сообщение';
    if (orig) rText = hideSpoilerText(orig.body) || 'Медиа';
    const rName = orig ? (orig.nickname || orig.sender_name || 'Автор') : '—';
    const rDiv = document.createElement('div');
    rDiv.className = 'rply';
    rDiv.innerHTML = '<div class="rply-who">' + esc(rName) + '</div><div class="rply-txt">' + esc(rText.slice(0, 80)) + '</div>';
    rDiv.onclick = () => {
      const t = document.querySelector('.mrow[data-id="' + m.reply_to + '"]');
      if (t) { t.scrollIntoView({ behavior: 'smooth', block: 'center' }); t.classList.add('msg-flash'); setTimeout(() => t.classList.remove('msg-flash'), 1000); }
    };
    body.appendChild(rDiv);
  }

  // Media
  if (hasMedia) {
    if (m.media_type === 'image') {
      const mWrap = document.createElement('div');
      mWrap.className = 'media-wrap';
      const dims = _dimRead(m.media_url);
      if (dims) _reserveMediaSize(mWrap, dims.w, dims.h);
      else _applyPlaceholder(mWrap);
      const img = document.createElement('img');
      img.className = 'msg-media';
      img.src = m.media_url;
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.onload = () => {
        mWrap.classList.add('loaded');
        if (!dims) { _dimWrite(m.media_url, img.naturalWidth, img.naturalHeight); _upgradePlaceholder(mWrap, img.naturalWidth, img.naturalHeight); }
      };
      img.onerror = () => { mWrap.classList.add('media-err'); };
      img.onclick = () => { if (typeof openViewer === 'function') openViewer(S.channelMsgs[ch?.channel_id] || [], m, 'channel'); };
      mWrap.appendChild(img);
      body.appendChild(mWrap);
    } else if (m.media_type === 'video') {
      const mWrap = document.createElement('div');
      mWrap.className = 'media-wrap video-wrap';
      const dims = _dimRead(m.media_url);
      if (dims) _reserveMediaSize(mWrap, dims.w, dims.h);
      else _applyPlaceholder(mWrap);
      const vid = document.createElement('video');
      vid.className = 'msg-media msg-video';
      vid.src = m.media_url;
      vid.preload = 'metadata';
      vid.playsInline = true;
      vid.onclick = () => { if (typeof openViewer === 'function') openViewer(S.channelMsgs[ch?.channel_id] || [], m, 'channel'); };
      const playBtn = document.createElement('div');
      playBtn.className = 'video-play-btn';
      playBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" width="32" height="32"><path d="M8 5v14l11-7z"/></svg>';
      playBtn.onclick = (e) => { e.stopPropagation(); vid.paused ? vid.play() : vid.pause(); playBtn.style.display = vid.paused ? '' : 'none'; };
      mWrap.appendChild(vid);
      mWrap.appendChild(playBtn);
      body.appendChild(mWrap);
    } else if (m.media_type === 'voice') {
      const vWrap = document.createElement('div');
      vWrap.className = 'voice-msg';
      const dur = m.voice_duration || parseInt(m.body || '0', 10) || 0;
      const durStr = window.VoiceMsg ? window.VoiceMsg.formatTimeSec(dur) : Math.floor(dur / 60) + ':' + String(dur % 60).padStart(2, '0');
      vWrap.innerHTML = '<button class="voice-play-btn" title="Воспроизвести"><svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M8 5v14l11-7z"/></svg></button>' +
        '<div class="voice-wave"><canvas class="voice-canvas" width="200" height="30"></canvas></div>' +
        '<span class="voice-dur">' + durStr + '</span>';
      body.appendChild(vWrap);
    } else if (m.media_type === 'document') {
      const dWrap = document.createElement('div');
      dWrap.className = 'doc-msg';
      const fileName = m.file_name || 'Файл';
      const fileSize = m.file_size ? fmtBytes(m.file_size) : '';
      dWrap.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="24" height="24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>' +
        '<div class="doc-info"><div class="doc-name">' + esc(fileName) + '</div><div class="doc-size">' + fileSize + '</div></div>';
      dWrap.onclick = () => { const a = document.createElement('a'); a.href = m.media_url; a.download = fileName; a.click(); };
      body.appendChild(dWrap);
    }
  }

  // Text
  if (hasText) {
    const txt = document.createElement('div');
    txt.className = 'mtxt';
    txt.innerHTML = fmtText(m.body);
    txt.style.cssText = '';
    body.appendChild(txt);
    walkTextNodes(txt);
  }

  // Bottom: timestamp, views, edited
  const bottom = document.createElement('div');
  bottom.className = 'mbottom';

  if (m.is_edited) {
    const ed = document.createElement('span');
    ed.className = 'med';
    ed.title = 'ред.';
    bottom.appendChild(ed);
  }

  const ts = document.createElement('span');
  ts.className = 'mtime';
  ts.textContent = fmtTime(m.sent_at);
  bottom.appendChild(ts);

  // Views count (channel-specific)
  if (m.views !== undefined && m.views !== null) {
    const views = document.createElement('span');
    views.className = 'ch-views';
    views.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> ' + _fmtViews(m.views);
    bottom.appendChild(views);
  }

  // Send indicator for admin messages only
  if (isMe && isAdmin && !sending) {
    const tick = document.createElement('span');
    tick.className = 'tick';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 18 11');
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '11');
    svg.setAttribute('fill', 'none');
    const p2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p2.setAttribute('d', 'M5 5.5l3 3L14 1');
    p2.setAttribute('stroke', 'currentColor');
    p2.setAttribute('stroke-width', '1.75');
    p2.setAttribute('stroke-linecap', 'round');
    p2.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(p2);
    tick.appendChild(svg);
    bottom.appendChild(tick);
  }

  if (sending) {
    const sp = document.createElement('div');
    sp.className = 'send-spinner';
    bottom.appendChild(sp);
  }

  body.appendChild(bottom);
  bub.appendChild(body);
  row.appendChild(bub);

  // Forward button
  const fwdBtn = document.createElement('button');
  fwdBtn.className = 'ch-fwd-btn';
  fwdBtn.title = 'Переслать';
  fwdBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path stroke-linecap="round" stroke-linejoin="round" d="M7 17L17 7M17 7H7M17 7v10"/></svg>';
  fwdBtn.onclick = (e) => { e.stopPropagation(); toast('Пересылка скоро будет доступна', 'info'); };
  row.appendChild(fwdBtn);

  // Context menu
  row.oncontextmenu = (e) => {
    e.preventDefault();
    _showChannelMsgCtx(e, m);
  };
  row.ondblclick = (e) => {
    if (typeof onEmojiPick === 'function' && typeof emoImg === 'function' && !isTemp(m.id)) {
      // Long press reaction picker — reuse existing emoji picker
    }
  };

  return row;
}

function _showChannelMsgCtx(e, m) {
  const ch = S.activeChannel;
  if (!ch) return;
  const isMe = m.sender_id == S.user?.id;
  const isAdmin = _chIsAdmin(ch);
  const items = [];

  items.push({ label: 'Ответить', icon: '↩️', action: () => toast('Ответ скоро будет доступен', 'info') });
  items.push({ label: 'Переслать', icon: '↗️', action: () => toast('Пересылка скоро будет доступна', 'info') });
  items.push({ label: 'Копировать', icon: '📋', action: () => {
    if (m.body) { navigator.clipboard.writeText(m.body).then(() => toast('Скопировано', 'ok')); }
  }});

  if (isAdmin && m.message_id) {
    items.push({ label: 'Закрепить', icon: '📌', action: () => _pinChannelMsg(ch.channel_id, m.message_id) });
  }
  if ((isAdmin || isMe) && !isTemp(m.id)) {
    items.push({ label: 'Редактировать', icon: '✏️', action: () => _editChannelMsg(m) });
    items.push({ label: 'Удалить', icon: '🗑', action: () => _deleteChannelMsg(m), danger: true });
  }
  _showCtxMenu(e, items);
}

async function _pinChannelMsg(chId, msgId) {
  const res = await api('pin_channel_message', 'POST', { channel_id: chId, message_id: msgId });
  if (res.ok) toast('Сообщение закреплено', 'ok');
  else toast(res.message || 'Ошибка', 'err');
}

async function _deleteChannelMsg(m) {
  if (!confirm('Удалить сообщение?')) return;
  const res = await api('delete_channel_message', 'POST', { message_id: m.id });
  if (res.ok) {
    const el = document.querySelector('.mrow[data-id="' + m.id + '"]');
    if (el) deleteMsgEl(el);
    const chId = S.activeChannel?.channel_id;
    if (chId && S.channelMsgs[chId]) {
      S.channelMsgs[chId] = S.channelMsgs[chId].filter(x => x.id !== m.id);
      cacheWriteChannel(chId, S.channelMsgs[chId]);
    }
    toast('Сообщение удалено', 'ok');
  } else toast(res.message || 'Ошибка', 'err');
}

async function _editChannelMsg(m) {
  const newBody = prompt('Редактировать сообщение:', m.body || '');
  if (newBody === null || newBody === m.body) return;
  // Optimistic
  m.body = newBody;
  m.is_edited = 1;
  _patchChannelMsgDom(m);
  toast('Редактирование... функционал в разработке', 'info');
}

/* ══ SEND CHANNEL TEXT ════════════════════════════════════════ */
async function sendChannelText() {
  const ch = S.activeChannel;
  if (!ch) return;
  if (!_chIsAdmin(ch)) { toast('Только админы могут писать', 'err'); return; }

  const mfield = $('mfield');
  if (!mfield) return;
  const body = mfield.innerText?.trim() || '';
  if (!body) return;
  mfield.innerHTML = '';

  const chId = ch.channel_id;
  const tid = 'tc' + Date.now();
  const tmpMsg = {
    id: tid, sender_id: S.user.id, sender_name: S.user.nickname || S.user.signal_id || 'Вы',
    body: body, sent_at: Math.floor(Date.now() / 1000), is_admin: true, is_edited: false, views: 0,
  };
  S.channelMsgs[chId] = S.channelMsgs[chId] || [];
  S.channelMsgs[chId].push(tmpMsg);
  appendChannelMsg(chId, tmpMsg);
  scrollBot();

  try {
    const res = await api('send_channel_message', 'POST', { channel_id: chId, body: body });
    if (res.ok && res.message) {
      const real = res.message;
      if (real.media_url) real.media_url = getMediaUrl(real.media_url);
      const idx = S.channelMsgs[chId].findIndex(x => x.id === tid);
      if (idx >= 0) S.channelMsgs[chId][idx] = real;
      S.channelLastId[chId] = Math.max(S.channelLastId[chId] || 0, real.id);
      const el = document.querySelector('.mrow[data-id="' + tid + '"]');
      if (el) { el.dataset.id = real.id; _patchChannelMsgDom(real); }
      cacheWriteChannel(chId, S.channelMsgs[chId]);
    } else {
      toast(res.message || 'Ошибка отправки', 'err');
      const el = document.querySelector('.mrow[data-id="' + tid + '"]');
      if (el) { el.classList.add('msg-err'); }
    }
  } catch(e) {
    toast('Ошибка сети', 'err');
    const el = document.querySelector('.mrow[data-id="' + tid + '"]');
    if (el) el.classList.add('msg-err');
  }
}

/* ══ CHANNEL SSE (POLLING) ════════════════════════════════════ */
function startChannelSSE(chId) {
  stopChannelSSE();
  S._channelSSEActive = true;
  _chPoll(chId);
}

async function _chPoll(chId) {
  while (S._channelSSEActive && S.token) {
    try {
      const controller = new AbortController();
      S.channelSSE = controller;

      const afterId = S.channelLastId[chId] || 0;
      const res = await fetch(
        API + '/get_channel_messages?channel_id=' + chId + '&after_id=' + afterId + '&limit=50',
        {
          headers: S.token ? { 'Authorization': 'Bearer ' + S.token } : {},
          signal: controller.signal,
        }
      );

      S.channelSSE = null;
      if (!S._channelSSEActive || !S.token) return;
      if (!res.ok) { await new Promise(r => setTimeout(r, 3000)); continue; }

      const data = await res.json();
      if (!data || !data.ok) { await new Promise(r => setTimeout(r, 2000)); continue; }

      // Check if we're still viewing this channel
      if (S.activeChannel && chId !== S.activeChannel.channel_id) return;

      // Update channel info
      if (data.channel) {
        const idx = S.channels.findIndex(c => c.channel_id === chId);
        if (idx >= 0) S.channels[idx] = { ...S.channels[idx], ...data.channel };
        if (S.activeChannel && chId === S.activeChannel.channel_id) {
          S.activeChannel = { ...S.activeChannel, ...data.channel };
        }
      }

      // Deleted messages
      const deleted = data.deleted_ids || [];
      if (deleted.length) {
        deleted.forEach(id => {
          if (S.channelMsgs[chId]) S.channelMsgs[chId] = S.channelMsgs[chId].filter(m => m.id !== id);
          const el = document.querySelector('.mrow[data-id="' + id + '"]');
          if (el) deleteMsgElRemote(el);
        });
      }

      // New/edited messages
      const msgs = (data.messages || []).map(m => {
        if (m.media_url) m.media_url = getMediaUrl(m.media_url);
        return m;
      });

      if (msgs.length) {
        const area = $('msgs');
        const atBot = area ? (area.scrollHeight - area.scrollTop - area.clientHeight < 130) : false;

        msgs.forEach(m => {
          const existing = (S.channelMsgs[chId] || []).find(x => x.id === m.id);
          if (!existing) {
            // Skip own messages without pending match (handled by send response)
            if (m.sender_id === S.user?.id) return;
            S.channelMsgs[chId] = S.channelMsgs[chId] || [];
            S.channelMsgs[chId].push(m);
            if (S.activeChannel && chId === S.activeChannel.channel_id) {
              appendChannelMsg(chId, m);
            }
          } else if (existing.body !== m.body || existing.is_edited !== m.is_edited || existing.views !== m.views) {
            Object.assign(existing, m);
            _patchChannelMsgDom(m);
          }
        });

        S.channelLastId[chId] = msgs.reduce((mx, m) => Math.max(mx, +m.id), S.channelLastId[chId] || 0);
        if (atBot && area) scrollBot();
        cacheWriteChannel(chId, S.channelMsgs[chId]);
      }

      // Brief pause between polls
      await new Promise(r => setTimeout(r, 500));
    } catch(e) {
      S.channelSSE = null;
      if (e && e.name === 'AbortError') return;
      if (S._channelSSEActive) await new Promise(r => setTimeout(r, 3000));
    }
  }
}

function stopChannelSSE() {
  S._channelSSEActive = false;
  if (S.channelSSE) { S.channelSSE.abort(); S.channelSSE = null; }
}

/* ══ CREATE CHANNEL MODAL ══════════════════════════════════════ */
function showCreateChannelModal() {
  // Ensure modal overlay exists
  let overlay = $('modal-ch-create');
  if (overlay) { overlay.remove(); }

  overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.id = 'modal-ch-create';
  overlay.innerHTML = '<div class="modal" style="width:380px;max-width:95vw">' +
    '<div class="modal-hdr">' +
      '<div class="modal-title">Создать канал</div>' +
      '<button class="modal-x" data-close="modal-ch-create"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg></button>' +
    '</div>' +
    '<div class="modal-body" style="padding:20px">' +
      '<div style="margin-bottom:16px">' +
        '<label style="display:block;font-size:13px;color:var(--t3);margin-bottom:6px">Название канала *</label>' +
        '<input type="text" id="ch-create-name" placeholder="Мой канал" style="width:100%;padding:10px 14px;border-radius:12px;border:1px solid var(--br);background:var(--bg2);color:var(--t1);font-size:15px;outline:none" maxlength="100">' +
      '</div>' +
      '<div style="margin-bottom:16px">' +
        '<label style="display:block;font-size:13px;color:var(--t3);margin-bottom:6px">Описание</label>' +
        '<textarea id="ch-create-desc" placeholder="О чём этот канал..." rows="3" style="width:100%;padding:10px 14px;border-radius:12px;border:1px solid var(--br);background:var(--bg2);color:var(--t1);font-size:14px;outline:none;resize:vertical" maxlength="500"></textarea>' +
      '</div>' +
      '<div style="margin-bottom:16px">' +
        '<label style="display:block;font-size:13px;color:var(--t3);margin-bottom:6px">Тип канала</label>' +
        '<div style="display:flex;gap:8px">' +
          '<label style="flex:1;cursor:pointer">' +
            '<input type="radio" name="ch-type" value="public" checked style="display:none">' +
            '<div class="ch-type-opt" style="padding:12px;border-radius:12px;border:2px solid var(--accent);background:var(--bg2);text-align:center;font-size:13px">' +
              '<div style="font-weight:600;margin-bottom:2px">🌐 Публичный</div>' +
              '<div style="font-size:12px;color:var(--t3)">Виден всем</div>' +
            '</div>' +
          '</label>' +
          '<label style="flex:1;cursor:pointer">' +
            '<input type="radio" name="ch-type" value="private" style="display:none">' +
            '<div class="ch-type-opt" style="padding:12px;border-radius:12px;border:2px solid var(--br);background:var(--bg2);text-align:center;font-size:13px">' +
              '<div style="font-weight:600;margin-bottom:2px">🔒 Приватный</div>' +
              '<div style="font-size:12px;color:var(--t3)">По ссылке</div>' +
            '</div>' +
          '</label>' +
        '</div>' +
      '</div>' +
      '<div style="margin-bottom:20px" id="ch-create-username-wrap">' +
        '<label style="display:block;font-size:13px;color:var(--t3);margin-bottom:6px">Username (для публичного)</label>' +
        '<div style="display:flex;align-items:center;border-radius:12px;border:1px solid var(--br);background:var(--bg2);overflow:hidden">' +
          '<span style="padding:10px 0 10px 14px;color:var(--t3);font-size:14px">@</span>' +
          '<input type="text" id="ch-create-username" placeholder="username" style="flex:1;padding:10px 14px 10px 0;border:none;background:transparent;color:var(--t1);font-size:14px;outline:none" maxlength="32">' +
        '</div>' +
      '</div>' +
      '<button class="btn" id="btn-ch-create-submit" style="width:100%;padding:12px;border-radius:12px;font-size:15px;font-weight:600">Создать канал</button>' +
    '</div>' +
  '</div>';

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('on'));

  // Type toggle
  const radios = overlay.querySelectorAll('input[name="ch-type"]');
  const usernameWrap = $('ch-create-username-wrap');
  radios.forEach(r => {
    r.onchange = () => {
      overlay.querySelectorAll('.ch-type-opt').forEach(o => { o.style.borderColor = 'var(--br)'; });
      r.nextElementSibling.style.borderColor = 'var(--accent)';
      if (usernameWrap) usernameWrap.style.display = r.value === 'public' ? '' : 'none';
    };
  });

  // Close
  overlay.querySelector('[data-close="modal-ch-create"]').onclick = () => closeMod('modal-ch-create');
  overlay.onclick = (e) => { if (e.target === overlay) closeMod('modal-ch-create'); };

  // Submit
  $('btn-ch-create-submit').onclick = async () => {
    const name = $('ch-create-name')?.value?.trim();
    if (!name) { toast('Введите название канала', 'err'); $('ch-create-name')?.focus(); return; }
    const desc = $('ch-create-desc')?.value?.trim() || '';
    const type = (overlay.querySelector('input[name="ch-type"]:checked')?.value) || 'public';
    const username = type === 'public' ? ($('ch-create-username')?.value?.trim() || '') : '';

    $('btn-ch-create-submit').disabled = true;
    $('btn-ch-create-submit').textContent = 'Создание...';

    const res = await api('create_channel', 'POST', { name: name, description: desc, username: username, type: type });

    $('btn-ch-create-submit').disabled = false;
    $('btn-ch-create-submit').textContent = 'Создать канал';

    if (res.ok) {
      closeMod('modal-ch-create');
      toast('Канал создан!', 'ok');
      await loadChannels();
      if (res.channel) openChannel(res.channel);
    } else {
      toast(res.message || 'Ошибка создания канала', 'err');
    }
  };

  // Focus name input
  setTimeout(() => $('ch-create-name')?.focus(), 300);
}

/* ══ JOIN CHANNEL MODAL ════════════════════════════════════════ */
function showJoinChannelModal() {
  let overlay = $('modal-ch-join');
  if (overlay) overlay.remove();

  overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.id = 'modal-ch-join';
  overlay.innerHTML = '<div class="modal" style="width:380px;max-width:95vw">' +
    '<div class="modal-hdr">' +
      '<div class="modal-title">Присоединиться к каналу</div>' +
      '<button class="modal-x" data-close="modal-ch-join"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg></button>' +
    '</div>' +
    '<div class="modal-body" style="padding:20px">' +
      '<div style="margin-bottom:16px">' +
        '<label style="display:block;font-size:13px;color:var(--t3);margin-bottom:6px">Ссылка-приглашение или @username</label>' +
        '<input type="text" id="ch-join-input" placeholder="https://initial.su/join/... или @username" style="width:100%;padding:10px 14px;border-radius:12px;border:1px solid var(--br);background:var(--bg2);color:var(--t1);font-size:14px;outline:none">' +
      '</div>' +
      '<button class="btn" id="btn-ch-join-submit" style="width:100%;padding:12px;border-radius:12px;font-size:15px;font-weight:600">Присоединиться</button>' +
    '</div>' +
  '</div>';

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('on'));

  overlay.querySelector('[data-close="modal-ch-join"]').onclick = () => closeMod('modal-ch-join');
  overlay.onclick = (e) => { if (e.target === overlay) closeMod('modal-ch-join'); };

  $('btn-ch-join-submit').onclick = async () => {
    const val = $('ch-join-input')?.value?.trim();
    if (!val) { toast('Введите ссылку или @username', 'err'); return; }

    $('btn-ch-join-submit').disabled = true;
    $('btn-ch-join-submit').textContent = 'Присоединение...';

    const data = {};
    if (val.startsWith('http')) data.invite_link = val;
    else if (val.startsWith('@')) data.username = val.slice(1);
    else data.username = val;

    const res = await api('join_channel', 'POST', data);

    $('btn-ch-join-submit').disabled = false;
    $('btn-ch-join-submit').textContent = 'Присоединиться';

    if (res.ok) {
      closeMod('modal-ch-join');
      toast('Вы подписались!', 'ok');
      await loadChannels();
      if (res.channel) openChannel(res.channel);
    } else {
      toast(res.message || 'Ошибка', 'err');
    }
  };

  setTimeout(() => $('ch-join-input')?.focus(), 300);
}

/* ══ CHANNEL SETTINGS ══════════════════════════════════════════ */
function showChannelSettings(ch) {
  if (!ch) return;
  const isAdmin = _chIsAdmin(ch);
  const isOwner = _chIsOwner(ch);

  let overlay = $('modal-ch-settings');
  if (overlay) overlay.remove();

  overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.id = 'modal-ch-settings';

  let html = '<div class="modal" style="width:420px;max-width:95vw;max-height:90vh;overflow-y:auto">' +
    '<div class="modal-hdr">' +
      '<div class="modal-title">Настройки канала</div>' +
      '<button class="modal-x" id="btn-ch-settings-close"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg></button>' +
    '</div>' +
    '<div class="modal-body" style="padding:20px">';

  // Channel header
  html += '<div style="display:flex;align-items:center;gap:14px;margin-bottom:20px">' +
    '<div style="width:56px;height:56px;flex-shrink:0;border-radius:50%;overflow:hidden">' + _chAvatarHtml(ch) + '</div>' +
    '<div style="min-width:0">' +
      '<div style="font-size:17px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(ch.name) + '</div>' +
      '<div style="font-size:13px;color:var(--t3)">' + (ch.type === 'private' ? '🔒 Приватный канал' : '🌐 Публичный канал') + '</div>' +
      '<div style="font-size:13px;color:var(--t3)">' + _chRoleLabel(ch.my_role || '') + '</div>' +
    '</div>' +
  '</div>';

  // Editable fields (admin only)
  if (isAdmin) {
    html += '<div style="margin-bottom:14px">' +
      '<label style="display:block;font-size:13px;color:var(--t3);margin-bottom:6px">Название</label>' +
      '<input type="text" id="ch-set-name" value="' + esc(ch.name || '') + '" style="width:100%;padding:10px 14px;border-radius:12px;border:1px solid var(--br);background:var(--bg2);color:var(--t1);font-size:15px;outline:none" maxlength="100">' +
    '</div>';

    html += '<div style="margin-bottom:14px">' +
      '<label style="display:block;font-size:13px;color:var(--t3);margin-bottom:6px">Описание</label>' +
      '<textarea id="ch-set-desc" rows="3" style="width:100%;padding:10px 14px;border-radius:12px;border:1px solid var(--br);background:var(--bg2);color:var(--t1);font-size:14px;outline:none;resize:vertical" maxlength="500">' + esc(ch.description || '') + '</textarea>' +
    '</div>';

    if (ch.type === 'public') {
      html += '<div style="margin-bottom:14px">' +
        '<label style="display:block;font-size:13px;color:var(--t3);margin-bottom:6px">Username</label>' +
        '<div style="display:flex;align-items:center;border-radius:12px;border:1px solid var(--br);background:var(--bg2);overflow:hidden">' +
          '<span style="padding:10px 0 10px 14px;color:var(--t3);font-size:14px">@</span>' +
          '<input type="text" id="ch-set-username" value="' + esc(ch.username || '') + '" style="flex:1;padding:10px 14px 10px 0;border:none;background:transparent;color:var(--t1);font-size:14px;outline:none" maxlength="32">' +
        '</div>' +
      '</div>';
    }

    html += '<button class="btn" id="btn-ch-set-save" style="width:100%;padding:11px;border-radius:12px;font-size:14px;font-weight:600;margin-bottom:16px">Сохранить изменения</button>';
  }

  // Link section
  html += '<div style="border-top:1px solid var(--br);padding-top:16px;margin-top:4px">' +
    '<div style="font-size:14px;font-weight:600;margin-bottom:10px">Ссылка на канал</div>';

  if (ch.type === 'public' && ch.username) {
    html += '<div style="display:flex;align-items:center;gap:8px;padding:10px 14px;border-radius:10px;background:var(--bg2);cursor:pointer" id="ch-link-copy">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>' +
      '<span style="flex:1;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">@' + esc(ch.username) + '</span>' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>' +
    '</div>';
  } else {
    html += '<div style="display:flex;align-items:center;gap:8px;padding:10px 14px;border-radius:10px;background:var(--bg2);cursor:pointer" id="ch-link-copy">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>' +
      '<span style="flex:1;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" id="ch-link-text">Загрузка...</span>' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>' +
    '</div>';
  }
  html += '</div>';

  // Members
  html += '<div style="border-top:1px solid var(--br);padding-top:16px;margin-top:16px">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">' +
      '<div style="font-size:14px;font-weight:600">Подписчики</div>' +
      '<button class="ico-btn" id="btn-ch-members" style="font-size:13px;color:var(--accent);padding:4px 10px;border-radius:8px">Все (' + (ch.member_count || 0) + ')</button>' +
    '</div>' +
  '</div>';

  // Danger zone
  html += '<div style="border-top:1px solid var(--br);padding-top:16px;margin-top:16px">';

  if (!isOwner) {
    html += '<button class="btn" id="btn-ch-leave" style="width:100%;padding:11px;border-radius:12px;font-size:14px;font-weight:600;background:var(--red);box-shadow:0 4px 20px rgba(255,69,58,.35);margin-bottom:8px">Покинуть канал</button>';
  }
  if (isOwner) {
    html += '<button class="btn" id="btn-ch-delete" style="width:100%;padding:11px;border-radius:12px;font-size:14px;font-weight:600;background:var(--red);box-shadow:0 4px 20px rgba(255,69,58,.35)">Удалить канал</button>';
  }
  html += '</div>';

  html += '</div></div>';

  overlay.innerHTML = html;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('on'));

  // Close handlers
  $('btn-ch-settings-close').onclick = () => closeMod('modal-ch-settings');
  overlay.onclick = (e) => { if (e.target === overlay) closeMod('modal-ch-settings'); };

  // Load invite link for private channels
  if (ch.type !== 'public') {
    api('get_channel_link?channel_id=' + ch.channel_id).then(res => {
      const txt = $('ch-link-text');
      if (txt && res.ok) txt.textContent = res.invite_link || res.link || 'Нет ссылки';
      else if (txt) txt.textContent = 'Не удалось загрузить';
    });
  }

  // Copy link
  const linkCopy = $('ch-link-copy');
  if (linkCopy) linkCopy.onclick = () => copyChannelLink(ch);

  // Save changes
  const saveBtn = $('btn-ch-set-save');
  if (saveBtn) {
    saveBtn.onclick = async () => {
      const name = $('ch-set-name')?.value?.trim();
      if (!name) { toast('Введите название', 'err'); return; }
      const desc = $('ch-set-desc')?.value?.trim() || '';
      const username = $('ch-set-username')?.value?.trim() || '';

      saveBtn.disabled = true;
      saveBtn.textContent = 'Сохранение...';

      const data = { channel_id: ch.channel_id, name: name, description: desc };
      if (ch.type === 'public' && username) data.username = username;

      const res = await api('edit_channel', 'POST', data);

      saveBtn.disabled = false;
      saveBtn.textContent = 'Сохранить изменения';

      if (res.ok) {
        toast('Сохранено!', 'ok');
        const idx = S.channels.findIndex(c => c.channel_id === ch.channel_id);
        if (idx >= 0) S.channels[idx] = { ...S.channels[idx], name, description: desc, username };
        if (S.activeChannel && ch.channel_id === S.activeChannel.channel_id) {
          S.activeChannel = { ...S.activeChannel, name, description: desc, username };
          renderChannelHeader(S.activeChannel);
        }
        renderChannelsList();
      } else {
        toast(res.message || 'Ошибка', 'err');
      }
    };
  }

  // Members button
  const membersBtn = $('btn-ch-members');
  if (membersBtn) {
    membersBtn.onclick = () => {
      closeMod('modal-ch-settings');
      showChannelMembers(ch.channel_id);
    };
  }

  // Leave
  const leaveBtn = $('btn-ch-leave');
  if (leaveBtn) {
    leaveBtn.onclick = () => {
      closeMod('modal-ch-settings');
      _leaveChannel(ch.channel_id);
    };
  }

  // Delete
  const deleteBtn = $('btn-ch-delete');
  if (deleteBtn) {
    deleteBtn.onclick = () => {
      closeMod('modal-ch-settings');
      _deleteChannel(ch);
    };
  }
}

/* ══ LEAVE CHANNEL ════════════════════════════════════════════ */
async function _leaveChannel(chId) {
  if (!confirm('Вы уверены, что хотите покинуть канал?')) return;
  const res = await api('leave_channel', 'POST', { channel_id: chId });
  if (res.ok) {
    toast('Вы покинули канал', 'ok');
    if (S.activeChannel && S.activeChannel.channel_id === chId) closeChannel();
    S.channels = S.channels.filter(c => c.channel_id !== chId);
    cacheDeleteChannel(chId);
    delete S.channelMsgs[chId];
    delete S.channelLastId[chId];
    renderChannelsList();
  } else toast(res.message || 'Ошибка', 'err');
}

/* ══ DELETE CHANNEL ════════════════════════════════════════════ */
async function _deleteChannel(ch) {
  if (!confirm('Удалить канал «' + (ch.name || '') + '»? Это действие необратимо.')) return;
  const res = await api('delete_channel', 'POST', { channel_id: ch.channel_id });
  if (res.ok) {
    toast('Канал удалён', 'ok');
    if (S.activeChannel && S.activeChannel.channel_id === ch.channel_id) closeChannel();
    S.channels = S.channels.filter(c => c.channel_id !== ch.channel_id);
    cacheDeleteChannel(ch.channel_id);
    delete S.channelMsgs[ch.channel_id];
    delete S.channelLastId[ch.channel_id];
    renderChannelsList();
  } else toast(res.message || 'Ошибка', 'err');
}

/* ══ COPY CHANNEL LINK ════════════════════════════════════════ */
async function copyChannelLink(ch) {
  if (!ch) return;
  let link = '';
  if (ch.type === 'public' && ch.username) {
    link = '@' + ch.username;
  } else {
    try {
      const res = await api('get_channel_link?channel_id=' + ch.channel_id);
      if (res.ok) link = res.invite_link || res.link || '';
    } catch(e) {}
  }
  if (!link) { toast('Ссылка недоступна', 'err'); return; }
  try {
    await navigator.clipboard.writeText(link);
    toast('Ссылка скопирована', 'ok');
  } catch(e) {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = link;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('Ссылка скопирована', 'ok');
  }
}

/* ══ CHANNEL MEMBERS ══════════════════════════════════════════ */
function showChannelMembers(chId) {
  let overlay = $('modal-ch-members');
  if (overlay) overlay.remove();

  overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.id = 'modal-ch-members';
  overlay.innerHTML = '<div class="modal" style="width:420px;max-width:95vw;max-height:85vh;display:flex;flex-direction:column">' +
    '<div class="modal-hdr">' +
      '<div class="modal-title">Подписчики</div>' +
      '<button class="modal-x" id="btn-ch-members-close"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg></button>' +
    '</div>' +
    '<div id="ch-members-list" style="flex:1;overflow-y:auto;padding:12px 20px">' +
      '<div style="text-align:center;padding:30px;color:var(--t3)">Загрузка...</div>' +
    '</div>' +
  '</div>';

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('on'));

  $('btn-ch-members-close').onclick = () => closeMod('modal-ch-members');
  overlay.onclick = (e) => { if (e.target === overlay) closeMod('modal-ch-members'); };

  api('get_channel_members?channel_id=' + chId).then(res => {
    const list = $('ch-members-list');
    if (!list) return;
    if (!res.ok || !res.members?.length) {
      list.innerHTML = '<div style="text-align:center;padding:30px;color:var(--t3)">Нет подписчиков</div>';
      return;
    }
    const ch = S.channels.find(c => c.channel_id === chId);
    const isAdmin = _chIsAdmin(ch);

    list.innerHTML = '';
    res.members.forEach(m => {
      const el = document.createElement('div');
      el.className = 'ch-member-item';
      el.style.cssText = 'display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--br)';

      const name = m.nickname || m.name || m.signal_id || 'Пользователь';
      const role = m.role || 'member';
      const isMe = m.user_id == S.user?.id;

      el.innerHTML =
        '<div style="width:40px;height:40px;flex-shrink:0;border-radius:50%;overflow:hidden">' + aviHtml(name, m.avatar_url) + '</div>' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(name) + (isMe ? ' <span style="color:var(--t3);font-weight:400">(вы)</span>' : '') + '</div>' +
          '<div style="font-size:12px;color:var(--t3)">' + _chRoleLabel(role) + '</div>' +
        '</div>';

      // Admin controls
      if (isAdmin && !isMe && m.user_id !== ch?.owner_id) {
        const promoteBtn = document.createElement('button');
        promoteBtn.className = 'ico-btn';
        promoteBtn.style.cssText = 'font-size:12px;padding:4px 10px;border-radius:8px;color:var(--accent)';
        promoteBtn.textContent = role === 'admin' ? 'Разжаловать' : 'Повысить';
        promoteBtn.onclick = async () => {
          const newRole = role === 'admin' ? 'member' : 'admin';
          const r = await api('update_channel_member', 'POST', { channel_id: chId, user_id: m.user_id, role: newRole });
          if (r.ok) {
            toast(newRole === 'admin' ? 'Пользователь повышен' : 'Пользователь разжалован', 'ok');
            showChannelMembers(chId); // Refresh
          } else toast(r.message || 'Ошибка', 'err');
        };
        el.appendChild(promoteBtn);
      }

      list.appendChild(el);
    });
  }).catch(() => {
    const list = $('ch-members-list');
    if (list) list.innerHTML = '<div style="text-align:center;padding:30px;color:var(--t3)">Ошибка загрузки</div>';
  });
}

/* ══ CHANNEL SEARCH ════════════════════════════════════════════ */
function showChannelSearch() {
  let overlay = $('modal-ch-search');
  if (overlay) overlay.remove();

  overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.id = 'modal-ch-search';
  overlay.innerHTML = '<div class="modal" style="width:420px;max-width:95vw;max-height:85vh;display:flex;flex-direction:column">' +
    '<div class="modal-hdr">' +
      '<div class="modal-title">Поиск каналов</div>' +
      '<button class="modal-x" id="btn-ch-search-close"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg></button>' +
    '</div>' +
    '<div style="padding:0 20px 12px">' +
      '<div class="srch" style="width:100%">' +
        '<div class="srch-ic"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><path stroke-linecap="round" d="M21 21l-4.35-4.35"/></svg></div>' +
        '<input type="text" id="ch-search-input" placeholder="Название или @username…" style="width:100%" autocomplete="off">' +
      '</div>' +
    '</div>' +
    '<div id="ch-search-results" style="flex:1;overflow-y:auto;padding:0 20px 20px">' +
      '<div style="text-align:center;padding:30px;color:var(--t3)">Введите запрос для поиска</div>' +
    '</div>' +
  '</div>';

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('on'));

  $('btn-ch-search-close').onclick = () => closeMod('modal-ch-search');
  overlay.onclick = (e) => { if (e.target === overlay) closeMod('modal-ch-search'); };

  let searchTimer = null;
  $('ch-search-input').oninput = () => {
    clearTimeout(searchTimer);
    const q = $('ch-search-input').value.trim();
    if (!q) {
      $('ch-search-results').innerHTML = '<div style="text-align:center;padding:30px;color:var(--t3)">Введите запрос для поиска</div>';
      return;
    }
    searchTimer = setTimeout(() => _doChannelSearch(q), 400);
  };

  setTimeout(() => $('ch-search-input')?.focus(), 300);
}

async function _doChannelSearch(q) {
  const results = $('ch-search-results');
  if (!results) return;
  results.innerHTML = '<div style="text-align:center;padding:20px;color:var(--t3)">Поиск...</div>';

  const res = await api('search_channels?q=' + encodeURIComponent(q));
  if (!res.ok || !res.channels?.length) {
    results.innerHTML = '<div style="text-align:center;padding:30px;color:var(--t3)">Ничего не найдено</div>';
    return;
  }

  results.innerHTML = '';
  res.channels.forEach(ch => {
    const isJoined = S.channels.some(c => c.channel_id === ch.channel_id);
    const el = document.createElement('div');
    el.className = 'ch-search-item';
    el.style.cssText = 'display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--br);cursor:pointer';

    el.innerHTML =
      '<div style="width:44px;height:44px;flex-shrink:0;border-radius:50%;overflow:hidden">' + _chAvatarHtml(ch) + '</div>' +
      '<div style="flex:1;min-width:0">' +
        '<div style="font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(ch.name || 'Канал') +
          (ch.type === 'private' ? ' <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12" style="opacity:.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>' : '') +
        '</div>' +
        '<div style="font-size:12px;color:var(--t3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
          (ch.description ? esc(ch.description.slice(0, 60)) : (ch.subscribers || ch.member_count || 0) + ' подписчиков') +
        '</div>' +
      '</div>';

    if (isJoined) {
      const badge = document.createElement('span');
      badge.style.cssText = 'font-size:12px;color:var(--t3);flex-shrink:0';
      badge.textContent = 'Вы подписаны';
      el.appendChild(badge);
    } else {
      const joinBtn = document.createElement('button');
      joinBtn.className = 'btn';
      joinBtn.style.cssText = 'flex-shrink:0;padding:6px 14px;border-radius:8px;font-size:13px;font-weight:600';
      joinBtn.textContent = 'Подписаться';
      joinBtn.onclick = async (e) => {
        e.stopPropagation();
        joinBtn.disabled = true;
        joinBtn.textContent = '...';
        const r = await api('join_channel', 'POST', { channel_id: ch.channel_id });
        if (r.ok) {
          toast('Вы подписались!', 'ok');
          await loadChannels();
          joinBtn.textContent = 'Вы подписаны';
          joinBtn.disabled = true;
          joinBtn.style.background = 'var(--bg2)';
          joinBtn.style.color = 'var(--t3)';
        } else {
          toast(r.message || 'Ошибка', 'err');
          joinBtn.disabled = false;
          joinBtn.textContent = 'Подписаться';
        }
      };
      el.appendChild(joinBtn);
    }

    el.onclick = () => {
      if (!isJoined) return;
      closeMod('modal-ch-search');
      openChannel(ch);
    };

    results.appendChild(el);
  });
}

/* ══ SEND OVERRIDE — route send to channel when viewing channel ════ */
const _origSendText = typeof sendText === 'function' ? sendText : null;
window.sendText = function() {
  if (S.activeChannel) {
    sendChannelText();
    return;
  }
  if (_origSendText) _origSendText();
};

/* ══ BACK BUTTON OVERRIDE ══════════════════════════════════════ */
// Handle Android/iOS back gesture for channels
window.addEventListener('popstate', (e) => {
  if (e.state?.channel && S.activeChannel) {
    closeChannel();
    e.preventDefault();
  }
});

/* ══ KEYBOARD SHORTCUT ════════════════════════════════════════ */
document.addEventListener('keydown', (e) => {
  // Escape closes channel
  if (e.key === 'Escape' && S.activeChannel && !document.querySelector('.modal.on') && !document.querySelector('.overlay.on')) {
    if (!__isMobileView()) closeChannel();
  }
});

/* ══ MODAL CLOSE HELPERS ════════════════════════════════════════ */
// Extend closeMod to handle our custom modals
const _origCloseMod = typeof closeMod === 'function' ? closeMod : null;
window.closeMod = function(id) {
  const el = $(id);
  if (el) {
    el.classList.remove('on');
    setTimeout(() => el.remove(), 300);
  }
  if (_origCloseMod) _origCloseMod(id);
};

/* ══ INIT ON BOOT ═════════════════════════════════════════════ */
// Called from app.js boot sequence or auto-init
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { if (S.token) initChannels(); });
} else {
  if (S.token) initChannels();
}
// Also expose for explicit call
window.initChannels = initChannels;
window.loadChannels = loadChannels;
window.openChannel = openChannel;
window.closeChannel = closeChannel;
window.showCreateChannelModal = showCreateChannelModal;
window.showJoinChannelModal = showJoinChannelModal;
window.showChannelSearch = showChannelSearch;
window.showChannelSettings = showChannelSettings;
window.showChannelMembers = showChannelMembers;
window.copyChannelLink = copyChannelLink;
window.sendChannelText = sendChannelText;
window.startChannelSSE = startChannelSSE;
window.stopChannelSSE = stopChannelSSE;

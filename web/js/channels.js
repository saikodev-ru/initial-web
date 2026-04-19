'use strict';
/* ══ CHANNELS — Telegram-style channels module ══ */

/* ══ STATE EXTENSIONS ══════════════════════════════════════════ */
S.channels = [];
S.activeChannel = null;
S.channelMsgs = {};
S.channelLastId = {};
S.channelSSE = null;
S._channelSSEActive = false;
S.channelMuted = {}; // { channelId: true }
S.chRxns = {};          // { messageId: [{emoji, count, by_me, created_at}] }
S.chReplyTo = null;     // { id, sender_name, body } — reply state for channels
S.chPinnedMsg = null;   // { message_id, sender_name, body, media_url, media_type, sent_at }
S.chCommentsMsgId = null; // currently open comments panel message_id

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
function _chCanPost(ch) {
  if (!ch) return false;
  if (_chIsAdmin(ch)) return true;
  if (ch.who_can_post === 'all') return true;
  return false;
}
function _fmtViews(n) {
  if (!n && n !== 0) return '';
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace('.0', '') + 'М';
  if (n >= 1000) return (n / 1000).toFixed(1).replace('.0', '') + 'К';
  return String(n);
}
function _pluralRu(n) {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return 'ов';
  if (last > 1 && last < 5) return 'а';
  if (last === 1) return '';
  return 'ов';
}
function _pluralComment(n) {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return 'комментариев';
  if (last > 1 && last < 5) return 'комментария';
  if (last === 1) return 'комментарий';
  return 'комментариев';
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
  S.channels = (res.channels || []).map(ch => ({
    ...ch,
    member_count: ch.member_count || ch.members_count || 0,
    is_member: true, // All channels from get_channels are user's channels
  }));
  // Populate muted state
  S.channelMuted = {};
  S.channels.forEach(ch => {
    if (ch.muted) S.channelMuted[ch.channel_id] = true;
  });
  S.channels.sort((a, b) => (b.last_message_time || 0) - (a.last_message_time || 0));
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
  const lastMsgBody = (ch.last_message && ch.last_message.body) ? ch.last_message.body : '';
  const lastMsg = lastMsgBody.length > 60 ? lastMsgBody.slice(0, 60) + '…' : lastMsgBody;
  const time = ch.last_message_time ? fmtChatTime(ch.last_message_time) : '';
  const unread = ch.unread_count || 0;
  const isPrivate = ch.type === 'private';
  const isMuted = ch.muted || S.channelMuted[ch.channel_id];

  el.innerHTML =
    '<div class="ch-item-av">' + _chAvatarHtml(ch) + '</div>' +
    '<div class="ch-item-meta">' +
      '<div class="ch-item-row">' +
        '<div class="ch-item-name"><span class="marquee-inner">' + esc(name) + '</span>' +
          (isPrivate ? '<svg class="ch-lock-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="14" height="14"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>' : '') +
          (isMuted ? '<svg class="ch-mute-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="14" height="14" title="Без звука"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path stroke-linecap="round" d="M23 9l-6 6m0-6l6 6"/></svg>' : '') +
        '</div>' +
        '<div class="ch-item-ts">' + time + '</div>' +
      '</div>' +
      '<div class="ch-item-prev">' +
        '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
          (lastMsg ? esc(lastMsg) : (desc ? '<span style="color:var(--t3)">' + esc(desc) + '</span>' : '<span style="color:var(--t3)">Нет сообщений</span>')) +
        '</span>' +
        (unread > 0 && !isMuted ? '<span class="badge">' + (unread > 99 ? '99+' : unread) + '</span>' : '') +
      '</div>' +
    '</div>';

  el.onclick = () => openChannel(ch);
  el.oncontextmenu = (e) => { e.preventDefault(); _showChannelItemCtx(e, ch); };
  // Long press for mobile
  let lpTimer;
  el.ontouchstart = (e) => { lpTimer = setTimeout(() => { e.preventDefault(); _showChannelItemCtx(e, ch); }, 500); };
  el.ontouchend = () => clearTimeout(lpTimer);
  el.ontouchmove = () => clearTimeout(lpTimer);
  wtn(el);
  const nameSpan = el.querySelector('.ch-item-name .marquee-inner');
  if (nameSpan) setTimeout(() => checkMarquee(nameSpan), 0);
  return el;
}

function _showChannelItemCtx(e, ch) {
  const isAdmin = _chIsAdmin(ch);
  const isOwner = _chIsOwner(ch);
  const isMuted = ch.muted || S.channelMuted[ch.channel_id];
  const items = [];

  items.push({ label: 'Открыть', icon: '💬', action: () => openChannel(ch) });

  // Mute / Unmute
  items.push({
    label: isMuted ? 'Включить уведомления' : 'Без звука',
    icon: isMuted ? '🔔' : '🔕',
    action: () => _toggleMuteChannel(ch.channel_id, !isMuted)
  });

  // Mark as read
  items.push({ label: 'Прочитать', icon: '✅', action: () => _markChannelRead(ch.channel_id) });

  if (isAdmin) {
    items.push({ label: 'Настройки', icon: '⚙️', action: () => { openChannel(ch); setTimeout(() => showChannelSettings(ch), 200); } });
  }

  items.push({ label: 'Скопировать ссылку', icon: '🔗', action: () => copyChannelLink(ch) });

  // Pin / Unpin (if supported)
  items.push({ label: 'Закрепить', icon: '📌', action: () => toast('Функция закрепления чатов в разработке', 'info') });

  items.push({ divider: true });

  if (!isOwner) {
    items.push({ label: 'Покинуть канал', icon: '🚪', action: () => _leaveChannel(ch.channel_id), danger: true });
  }
  if (isOwner) {
    items.push({ label: 'Удалить канал', icon: '🗑', action: () => _deleteChannel(ch), danger: true });
  }
  _showCtxMenu(e, items);
}

/* ══ CONTEXT MENU ════════════════════════════════════════════ */
let _chCtxEl = null;
function _showCtxMenu(e, items) {
  _closeCtxMenu();
  const menu = document.createElement('div');
  menu.className = 'ctxmenu';
  menu.id = 'ch-ctxmenu';
  const its = document.createElement('div');
  its.className = 'ctx-its';
  items.forEach((it, i) => {
    if (it.divider) {
      const sep = document.createElement('div');
      sep.className = 'ctx-hr';
      its.appendChild(sep);
      return;
    }
    const d = document.createElement('div');
    d.className = 'ctx-it' + (it.danger ? ' danger' : '') + (it.rxn ? ' rxn-ctx' : '');
    if (it.rxn) {
      d.innerHTML = '<span style="font-size:20px;line-height:1">' + it.label + '</span>';
    } else if (it.svg) {
      d.innerHTML = it.svg + '<span>' + it.label + '</span>';
    } else {
      d.innerHTML = '<span>' + (it.icon || '') + '</span><span>' + it.label + '</span>';
    }
    d.onclick = () => { _closeCtxMenu(); it.action(); };
    its.appendChild(d);
  });
  menu.appendChild(its);
  document.body.appendChild(menu);
  _chCtxEl = menu;
  // Position
  const x = Math.min(e.clientX, window.innerWidth - 240);
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
  _closeCommentsPanel();
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

  // Hide input zone for non-posters
  const inpZone = $('input-zone');
  const canPost = _chCanPost(ch);
  if (inpZone) inpZone.style.display = canPost ? '' : 'none';

  // Show mute notification for muted users or non-posters
  const pill = $('system-mute-pill');
  if (pill) pill.remove();
  if (!canPost && !_chIsAdmin(ch)) {
    const mutePill = document.createElement('div');
    mutePill.id = 'system-mute-pill';
    mutePill.className = 'system-mute-pill';
    mutePill.style.cssText = 'text-align:center;padding:8px 16px;font-size:13px;color:var(--t2);background:var(--s1);border-bottom:1px solid var(--b)';
    mutePill.textContent = 'Только администраторы могут писать в этом канале';
    const msgsEl = $('msgs');
    if (msgsEl) msgsEl.parentNode.insertBefore(mutePill, msgsEl);
  }

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
  _loadChannelPin(chId);

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
  S.chReplyTo = null;
  S.chPinnedMsg = null;
  S.chCommentsMsgId = null;
  S._chCmtReplyTo = null;
  _closeCommentsPanel();
  const chPinBar = $('ch-pin-bar');
  if (chPinBar) chPinBar.remove();
  hideRbar(true);

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

  // ── CRITICAL: Restore all header button overrides back to DM defaults ──
  const hdrClick = $('hdr-clickable');
  if (hdrClick) {
    hdrClick.onclick = () => {
      if (!S.partner) return;
      if (typeof isSystemChat === 'function' && (isSystemChat(S.partner) || (typeof isSavedMsgs === 'function' && isSavedMsgs(S.partner)))) return;
      if (typeof openPartnerModal === 'function') openPartnerModal();
    };
  }
  const mbAvBtn = $('hdr-mb-avatar');
  if (mbAvBtn) {
    mbAvBtn.onclick = () => {
      if (!S.partner) return;
      if (typeof isSystemChat === 'function' && (isSystemChat(S.partner) || (typeof isSavedMsgs === 'function' && isSavedMsgs(S.partner)))) return;
      if (typeof openPartnerModal === 'function') openPartnerModal();
    };
  }
  const callBtn = $('btn-hdr-call');
  if (callBtn) callBtn.style.display = '';
  const moreBtn = $('btn-hdr-more');
  if (moreBtn) moreBtn.onclick = null; // Uses default context menu
  const closeBtn = $('btn-hdr-close');
  if (closeBtn) closeBtn.onclick = null; // Uses default close behavior
  const backBtn = $('btn-back-mb');
  if (backBtn) {
    backBtn.onclick = () => { history.back(); };
  }
  const sendBtn = $('btn-send');
  // Restore original DM send handler (was overridden in renderChannelHeader)
  if (sendBtn) sendBtn.onclick = function(e){ if(typeof sendText==='function') sendText(e); this.blur(); };

  // Remove any mute pill
  const pill = $('system-mute-pill');
  if (pill) pill.remove();

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

  const members = ch.member_count || ch.members_count || ch.subscribers || 0;
  if (stEl) {
    stEl.className = 'hdr-st';
    // Always show subscriber count in channel header
    stEl.textContent = members ? members + ' подписчик' + _pluralRu(members) : '0 подписчиков';
  }

  const aviContent = aviHtml(ch.name || 'Канал', ch.avatar_url);
  if (hdrAv) hdrAv.innerHTML = aviContent;
  if (hdrAvMb) hdrAvMb.innerHTML = aviContent;

  // Override header click to show channel profile panel
  const hdrClick = $('hdr-clickable');
  if (hdrClick) {
    hdrClick.onclick = () => {
      if (S.activeChannel) openChannelProfile(S.activeChannel);
    };
  }
  const mbAvBtn = $('hdr-mb-avatar');
  if (mbAvBtn) {
    mbAvBtn.onclick = () => {
      if (S.activeChannel) openChannelProfile(S.activeChannel);
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
      const ch = S.activeChannel;
      const isMuted = ch.muted || S.channelMuted[ch.channel_id];
      const items = [
        { label: 'Поиск', icon: '🔍', action: () => { if (window._openChatSearch) window._openChatSearch(); } },
        { label: isMuted ? 'Включить уведомления' : 'Без звука', icon: isMuted ? '🔔' : '🔕', action: () => _toggleMuteChannel(ch.channel_id, !isMuted) },
        { label: 'Настройки', icon: '⚙️', action: () => showChannelSettings(ch) },
        { label: 'Скопировать ссылку', icon: '🔗', action: () => copyChannelLink(ch) },
      ];
      if (_chIsAdmin(ch)) {
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
      // Normalize views field
      if (m.views_count !== undefined && m.views === undefined) m.views = m.views_count;
      return m;
    });
    S.channelMsgs[chId] = msgs;
    // Store reactions
    msgs.forEach(m => { if (m.reactions) S.chRxns[m.id] = m.reactions; });
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
      } else if (existing.body !== m.body || existing.is_edited !== m.is_edited ||
                 existing.views !== m.views || existing.comments_count !== m.comments_count ||
                 JSON.stringify(existing.reactions) !== JSON.stringify(m.reactions) ||
                 JSON.stringify(existing.last_commenters) !== JSON.stringify(m.last_commenters)) {
        Object.assign(existing, m);
        if (m.reactions) S.chRxns[m.id] = m.reactions;
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
  // Check if there were reactions before patch to animate new ones
  const oldRxns = el.querySelectorAll('.rxn');
  const oldEmojiSet = new Set();
  oldRxns.forEach(c => oldEmojiSet.add(c.dataset.emoji));

  const newEl = _makeChannelMsgEl(m);
  newEl.style.animation = 'none';
  el.replaceWith(newEl);

  // Animate newly appeared reaction chips
  if (oldEmojiSet.size >= 0) {
    newEl.querySelectorAll('.rxn').forEach((chip, idx) => {
      if (!oldEmojiSet.has(chip.dataset.emoji)) {
        chip.classList.add('rxn-enter');
      }
    });
  }
}

/* ══ BUILD CHANNEL MESSAGE ELEMENT (unified with chat makeMsgEl logic) ══ */
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

  // Channel messages always show channel name
  const senderName = ch?.name || 'Канал';

  const bub = document.createElement('div');
  bub.className = 'mbub';

  const hasMedia = !!(m.media_url && m.media_type);
  const hasText = !!(m.body && m.body.trim()) && m.media_type !== 'voice';
  const mediaOnly = hasMedia && !hasText && m.media_type !== 'document' && m.media_type !== 'voice';
  const mediaCaption = hasMedia && hasText;

  // Reactions — use shared sortRxns if available
  const _rxns = S.chRxns[m.id] || m.reactions || [];
  const rxns = typeof sortRxns === 'function' ? sortRxns(_rxns) : [..._rxns].sort((a, b) => b.count - a.count);
  const hasRxns = rxns.length > 0;

  const body = document.createElement('div');
  body.className = 'mbody' + (mediaOnly ? ' media-only' : '') + (mediaCaption ? ' has-media-caption' : '') + (sending ? ' sending' : '') + (m.is_edited ? ' is-edited' : '');

  // Forward label
  if (m.forwarded_from) {
    const fwd = document.createElement('div');
    fwd.className = 'fwd-label';
    fwd.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path stroke-linecap="round" stroke-linejoin="round" d="M7 17L17 7M17 7H7M17 7v10"/></svg> ' +
      'Переслано от <b>' + esc(m.forwarded_from) + '</b>';
    body.appendChild(fwd);
  }

  // Sender name
  if (!m.forwarded_from) {
    const nameDiv = document.createElement('div');
    nameDiv.className = 'ch-sender-name';
    nameDiv.textContent = senderName;
    body.appendChild(nameDiv);
  }

  // Reply reference (same logic as chat)
  if (m.reply_to) {
    const _chId = S.activeChannel?.channel_id;
    const orig = (S.channelMsgs[_chId] || []).find(x => x.id == m.reply_to);
    let rText = 'Сообщение';
    if (orig) {
      rText = hideSpoilerText(orig.body) || (orig.media_type === 'video' ? '🎥 Видео' : orig.media_type === 'image' ? '🖼 Фото' : 'Медиа') || 'Сообщение';
    }
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

  // ── Media (same structure as chat makeMsgEl) ──
  if (hasMedia) {
    if (m.media_type === 'image') {
      const mWrap = document.createElement('div');
      mWrap.className = 'single-media' + (m.media_spoiler ? ' media-spoiler' : '');
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.decoding = 'async';
      const ov = document.createElement('div');
      ov.className = 'media-overlay';
      mWrap.appendChild(img);
      mWrap.appendChild(ov);
      const origUrl = m.media_url;
      if (m.media_width && m.media_height) {
        _reserveMediaSize(mWrap, m.media_width, m.media_height);
      } else {
        const cached = _dimRead(origUrl);
        if (cached && cached.w && cached.h) {
          _reserveMediaSize(mWrap, cached.w, cached.h);
        } else {
          _applyPlaceholder(mWrap);
        }
      }
      img.src = origUrl;
      img.alt = '';
      img.onload = () => {
        if (!m.media_width) { _dimWrite(origUrl, img.naturalWidth, img.naturalHeight); _upgradePlaceholder(mWrap, img.naturalWidth, img.naturalHeight); }
        delete mWrap.dataset.placeholder;
      };
      img.onerror = () => { mWrap.classList.add('media-err'); };
      if (!sending) img.onclick = () => { if (typeof openViewer === 'function') openViewer(S.channelMsgs[ch?.channel_id] || [], m, 'channel'); };
      if (!origUrl?.startsWith('blob:')) {
        mWrap.classList.add('media-loading');
        const loadOv = document.createElement('div');
        loadOv.className = 'media-load-ov';
        loadOv.innerHTML = '<svg viewBox="0 0 46 46"><circle class="mlr-bg" cx="23" cy="23" r="19"/><circle class="mlr-fg" cx="23" cy="23" r="19" transform="rotate(-90 23 23)"/></svg>';
        mWrap.appendChild(loadOv);
        const onLoaded = () => {
          mWrap.classList.remove('media-loading');
          loadOv.classList.add('done');
          setTimeout(() => loadOv.remove(), 300);
        };
        img.addEventListener('load', onLoaded, { once: true });
        img.addEventListener('error', onLoaded, { once: true });
        if (img.complete && img.naturalWidth) onLoaded();
      }
      body.appendChild(mWrap);
    } else if (m.media_type === 'video') {
      const mWrap = document.createElement('div');
      mWrap.className = 'vid-wrap';
      const vid = document.createElement('video');
      vid.src = m.media_url;
      vid.preload = 'metadata';
      vid.muted = true;
      vid.playsInline = true;
      vid.addEventListener('loadedmetadata', () => {
        vid.currentTime = 0.1;
        const dur = mWrap.querySelector('.vid-duration');
        if (dur && isFinite(vid.duration)) {
          const s = Math.round(vid.duration);
          dur.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
        }
      }, { once: true });
      mWrap.addEventListener('mouseenter', () => { if (!sending) { vid.currentTime = 0; vid.play().catch(() => {}); } });
      mWrap.addEventListener('mouseleave', () => { vid.pause(); vid.currentTime = 0.1; });
      const overlay = document.createElement('div');
      overlay.className = 'vid-overlay';
      const playBtn = document.createElement('div');
      playBtn.className = 'vid-play-btn';
      playBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
      const durEl = document.createElement('div');
      durEl.className = 'vid-duration';
      overlay.appendChild(playBtn);
      mWrap.appendChild(vid);
      mWrap.appendChild(overlay);
      mWrap.appendChild(durEl);
      if (!m.media_url?.startsWith('blob:')) {
        mWrap.classList.add('media-loading');
        const vidLoadOv = document.createElement('div');
        vidLoadOv.className = 'media-load-ov';
        vidLoadOv.innerHTML = '<svg viewBox="0 0 46 46"><circle class="mlr-bg" cx="23" cy="23" r="19"/><circle class="mlr-fg" cx="23" cy="23" r="19" transform="rotate(-90 23 23)"/></svg>';
        mWrap.appendChild(vidLoadOv);
        const onVidLoaded = () => {
          mWrap.classList.remove('media-loading');
          vidLoadOv.classList.add('done');
          setTimeout(() => vidLoadOv.remove(), 300);
        };
        vid.addEventListener('loadeddata', onVidLoaded, { once: true });
        vid.addEventListener('error', onVidLoaded, { once: true });
        if (vid.readyState >= 2) onVidLoaded();
      }
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
      // Same doc-card style as chat
      const fileName = m.media_file_name || m.file_name || 'Файл';
      const fileSize = m.media_file_size ? fmtFileSize(m.media_file_size) : (m.file_size ? fmtBytes(m.file_size) : '');
      const docUrl = m.media_url;
      const ext = (fileName.split('.').pop() || '').toLowerCase().slice(0, 4);
      const card = document.createElement('a');
      card.className = 'doc-card';
      card.href = docUrl;
      card.target = '_blank';
      card.rel = 'noopener noreferrer';
      card.download = fileName;
      const icoWrap = document.createElement('div');
      icoWrap.className = 'doc-card-icon doc-card-icon-' + ext;
      icoWrap.innerHTML = typeof getDocIcon === 'function' ? (getDocIcon(ext) || '') : '';
      const info = document.createElement('div');
      info.className = 'doc-card-info';
      const nameEl = document.createElement('div');
      nameEl.className = 'doc-card-name';
      nameEl.textContent = fileName;
      nameEl.title = fileName;
      const sizeEl = document.createElement('div');
      sizeEl.className = 'doc-card-size';
      sizeEl.textContent = fileSize;
      info.appendChild(nameEl);
      info.appendChild(sizeEl);
      card.appendChild(icoWrap);
      card.appendChild(info);
      body.appendChild(card);
    }
  }

  // ── Text (same logic as chat: emoji-only detection, media caption, phantom spacer) ──
  if (hasText) {
    const _stripped = (m.body || '').replace(typeof mkEMORE === 'function' ? mkEMORE() : /(?:)/, '').replace(/[\s\u200B\uFEFF]/g, '');
    const _isEmoOnly = !hasMedia && _stripped.length === 0 && typeof countEmoji === 'function';
    const t = document.createElement('div');
    t.className = 'mtxt';

    if (_isEmoOnly) {
      const _cnt = countEmoji(m.body || '');
      body.classList.add('emo-only', 'emo-c' + Math.min(_cnt, 6));
      t.textContent = m.body || '';
      walkTextNodes(t);
      const bottom = document.createElement('div');
      bottom.className = 'mbottom';
      bottom.appendChild(_chMakeMeta(m, sending));
      if (mediaCaption) {
        const cap = document.createElement('div');
        cap.className = 'mcap';
        cap.appendChild(t);
        cap.appendChild(bottom);
        body.appendChild(cap);
      } else {
        body.appendChild(t);
        body.appendChild(bottom);
      }
    } else {
      t.innerHTML = fmtText(m.body);
      walkTextNodes(t);
      if (hasRxns) {
        // Reactions present: timestamp in .mbottom.rxns-only (same as chat)
        const rb = document.createElement('div');
        rb.className = 'mbottom rxns-only';
        rb.appendChild(_chMakeRxnRow(m.id, rxns, m));
        rb.appendChild(_chMakeMeta(m, sending, 'mtxt-meta'));
        if (mediaCaption) {
          const cap = document.createElement('div');
          cap.className = 'mcap';
          cap.appendChild(t);
          cap.appendChild(rb);
          body.appendChild(cap);
        } else {
          body.appendChild(t);
          body.appendChild(rb);
        }
      } else {
        // Phantom spacer approach (same as chat)
        const sp = document.createElement('span');
        sp.className = 'mtxt-spacer';
        t.appendChild(sp);
        t.appendChild(_chMakeMeta(m, sending, 'mtxt-meta'));
        if (mediaCaption) {
          const cap = document.createElement('div');
          cap.className = 'mcap';
          cap.appendChild(t);
          body.appendChild(cap);
        } else {
          body.appendChild(t);
        }
      }
    }
  }

  // Link preview (same as chat)
  if (hasText && !sending && !isTemp(m.id) && typeof attachLinkPreview === 'function') {
    attachLinkPreview(body, m.body);
  }

  // Meta for media-only / no-text messages
  if (!hasText && m.media_type !== 'voice') {
    if (mediaOnly) {
      body.appendChild(_chMakeMeta(m, sending));
    } else if (!mediaCaption) {
      const bottom = document.createElement('div');
      bottom.className = 'mbottom';
      bottom.appendChild(_chMakeMeta(m, sending));
      body.appendChild(bottom);
    }
  }

  // ── Channel-specific extras: views, reply count — inside .mbody ──
  if (hasText && !mediaOnly) {
    const viewCount = m.views ?? m.views_count ?? 0;
    const replyCount = m.replies_count || 0;
    if (viewCount > 0 || replyCount > 0) {
      const extra = document.createElement('div');
      extra.className = 'mbottom ch-msg-extra';
      if (viewCount > 0) {
        const views = document.createElement('span');
        views.className = 'ch-views';
        views.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> ' + _fmtViews(viewCount);
        extra.appendChild(views);
      }
      if (replyCount > 0) {
        const rb = document.createElement('span');
        rb.className = 'ch-reply-count';
        rb.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path stroke-linecap="round" stroke-linejoin="round" d="M3 10h10a8 8 0 0 1 8 8v2M3 10l6 6m-6-6l6-6"/></svg> ' + replyCount;
        rb.onclick = (e) => { e.stopPropagation(); _openReplyPanel(m); };
        extra.appendChild(rb);
      }
      body.appendChild(extra);
    }
  }

  // ── Inline comment footer (inside .mbody, after all content) ──
  if (!sending) {
    const cmtCount = m.comments_count || 0;
    const commenters = m.last_commenters || [];
    const divider = document.createElement('div');
    divider.className = 'ch-cmt-divider';
    body.appendChild(divider);
    const cmtBar = document.createElement('button');
    cmtBar.className = 'ch-cmt-bar';
    cmtBar.dataset.msgId = m.id;
    if (cmtCount > 0 && commenters.length > 0) {
      // Only render avatar slots that actually have commenters (no empty placeholders)
      const aviWrap = document.createElement('div');
      aviWrap.className = 'ch-cmt-avis';
      aviWrap.dataset.count = Math.min(commenters.length, 3);
      commenters.slice(0, 3).forEach((c, i) => {
        const avi = document.createElement('div');
        avi.className = 'ch-cmt-avi';
        avi.style.cssText = 'z-index:' + (3 - i);
        const url = c.sender_avatar;
        if (url) {
          avi.innerHTML = '<img src="' + getMediaUrl(url) + '" alt="" loading="lazy">';
        } else {
          const color = _avatarColor(c.sender_name || '?');
          avi.style.background = color;
          avi.textContent = (c.sender_name || '?')[0].toUpperCase();
        }
        aviWrap.appendChild(avi);
      });
      cmtBar.appendChild(aviWrap);
    }
    const infoWrap = document.createElement('div');
    infoWrap.className = 'ch-cmt-info';
    const label = document.createElement('span');
    label.className = 'ch-cmt-label' + (cmtCount > 0 ? '' : ' ch-cmt-placeholder');
    label.textContent = cmtCount > 0 ? (cmtCount + ' ' + _pluralComment(cmtCount)) : 'оставить комментарий';
    infoWrap.appendChild(label);
    // Right arrow in accent color
    const arrow = document.createElement('span');
    arrow.className = 'ch-cmt-arrow';
    arrow.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M9 18l6-6-6-6"/></svg>';
    infoWrap.appendChild(arrow);
    cmtBar.appendChild(infoWrap);
    cmtBar.onclick = (e) => { e.stopPropagation(); _openCommentsPanel(m); };
    body.appendChild(cmtBar);
  }

  bub.appendChild(body);

  // Reactions for media-only messages (on .mbub, same as chat)
  if (mediaOnly && hasRxns && !sending) {
    const rw = document.createElement('div');
    rw.className = 'rxn-wrap';
    rw.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-top:5px;width:100%';
    rw.appendChild(_chMakeRxnRow(m.id, rxns, m));
    bub.appendChild(rw);
  }

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
    if (!isTemp(m.id) && typeof emoImg === 'function') {
      e.preventDefault();
      _showChRxnPicker(e, m);
    }
  };

  return row;
}

/* ── Channel meta builder (mirrors chat makeMeta, with views count) ── */
function _chMakeMeta(m, sending = false, cls = 'mmeta') {
  const meta = document.createElement('div');
  meta.className = cls;

  // Views count (left of timestamp, like Telegram)
  const viewCount = m.views ?? m.views_count ?? 0;
  if (!sending && viewCount > 0) {
    const views = document.createElement('span');
    views.className = 'ch-meta-views';
    views.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> ' + _fmtViews(viewCount);
    meta.appendChild(views);
  }

  if (m.is_edited) {
    const ed = document.createElement('span');
    ed.className = 'med';
    const ns = 'http://www.w3.org/2000/svg';
    const sv = document.createElementNS(ns, 'svg');
    sv.setAttribute('viewBox', '0 0 16 16');
    sv.setAttribute('width', '12');
    sv.setAttribute('height', '12');
    sv.setAttribute('fill', 'none');
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', 'M11.5 2.5a1.5 1.5 0 0 1 2.12 2.12l-8 8a2 2 0 0 1-.76.46l-2.5.83.83-2.5a2 2 0 0 1 .46-.76l7.85-7.85z');
    p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', '1.5');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    sv.appendChild(p);
    ed.appendChild(sv);
    meta.appendChild(ed);
  }
  if (sending) {
    const sp = document.createElement('div');
    sp.className = 'send-spinner';
    meta.appendChild(sp);
  } else {
    const ts = document.createElement('span');
    ts.className = 'mtime';
    ts.textContent = fmtTime(m.sent_at);
    meta.appendChild(ts);
  }
  return meta;
}

/* ── Channel reaction row builder — always uses channel-specific toggle ── */
function _chMakeRxnRow(msgId, rxns, msgObj) {
  // Build via makeRxnRow for correct DOM structure, then override onclick handlers
  const row = typeof makeRxnRow === 'function' ? makeRxnRow(msgId, rxns) : document.createElement('div');
  // Override every chip onclick to use channel toggle (react_channel_message API)
  row.querySelectorAll('.rxn').forEach(chip => {
    const emoji = chip.dataset.emoji;
    chip.onclick = () => {
      const fresh = S.chRxns[+msgId] || [];
      const entry = fresh.find(x => x.emoji === emoji);
      _toggleChRxn(msgObj || { id: +msgId }, emoji, !!(entry && entry.by_me));
    };
  });
  return row;
}

async function _toggleChRxn(m, emoji, byMe) {
  if (isTemp(m.id)) { toast('Подождите — сообщение отправляется…', 'err'); return; }
  const ch = S.activeChannel;
  if (!ch) return;
  
  const method = byMe ? 'DELETE' : 'POST';
  try {
    const res = await api('react_channel_message', method, {
      channel_id: ch.channel_id,
      message_id: m.id,
      emoji: emoji,
    });
    if (res.ok && res.reactions) {
      S.chRxns[m.id] = res.reactions;
      // Animate the specific chip that changed (bump effect)
      _animateChRxnChip(m.id, emoji);
      // Patch the DOM after a short delay to let animation play
      setTimeout(() => _patchChannelMsgDom(m), 200);
      // Update in memory
      const chId = ch.channel_id;
      const mem = (S.channelMsgs[chId] || []).find(x => x.id === m.id);
      if (mem) mem.reactions = res.reactions;
    }
  } catch(e) { toast('Ошибка реакции', 'err'); }
}

function _animateChRxnChip(msgId, emoji) {
  const msgRow = document.querySelector('.mrow[data-id="' + msgId + '"]');
  if (!msgRow) return;
  const chip = msgRow.querySelector('.rxn[data-emoji="' + CSS.escape(emoji) + '"]');
  if (!chip) return;
  chip.classList.remove('rxn-bump');
  void chip.offsetWidth; // reflow
  chip.classList.add('rxn-bump');
}

function _showChRxnPicker(e, m) {
  _closeCtxMenu();
  const ch = S.activeChannel;
  if (!ch) return;
  
  const quickEmojis = ['👍', '❤️', '😂', '😮', '😢', '🔥', '👎', '🎉'];
  const menu = document.createElement('div');
  menu.className = 'ctxmenu';
  menu.id = 'ch-rxn-picker';
  
  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex;gap:2px;padding:4px 6px';
  quickEmojis.forEach(em => {
    const btn = document.createElement('button');
    btn.style.cssText = 'background:none;border:none;padding:6px;font-size:20px;cursor:pointer;border-radius:8px;transition:background .12s';
    btn.textContent = em;
    btn.onmouseenter = () => btn.style.background = 'var(--s2)';
    btn.onmouseleave = () => btn.style.background = '';
    btn.onclick = () => {
      _closeCtxMenu();
      const existing = (S.chRxns[m.id] || m.reactions || []).find(r => r.emoji === em);
      _toggleChRxn(m, em, !!(existing && existing.by_me));
    };
    bar.appendChild(btn);
  });
  menu.appendChild(bar);
  
  document.body.appendChild(menu);
  _chCtxEl = menu;
  
  // Position above cursor
  const x = Math.min(Math.max(e.clientX - 150, 10), window.innerWidth - 310);
  const y = Math.max(e.clientY - 60, 10);
  menu.style.display = 'block';
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  requestAnimationFrame(() => menu.classList.add('on'));
  setTimeout(() => document.addEventListener('click', () => _closeCtxMenu(), { once: true }), 10);
}

function _showChannelMsgCtx(e, m) {
  const ch = S.activeChannel;
  if (!ch) return;
  const isMe = m.sender_id == S.user?.id;
  const isAdmin = _chIsAdmin(ch);
  const items = [];

  // ── Reactions quick bar ──
  if (!isTemp(m.id)) {
    const quickEmojis = ['👍', '❤️', '😂', '😮', '😢', '🔥', '👎', '🎉'];
    quickEmojis.forEach(em => {
      const existing = (S.chRxns[m.id] || m.reactions || []).find(r => r.emoji === em);
      items.push({
        label: em,
        icon: em,
        rxn: true,
        action: () => _toggleChRxn(m, em, !!(existing && existing.by_me))
      });
    });
    items.push({ divider: true });
  }

  items.push({ label: 'Ответить', svg: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"/></svg>', action: () => _setChannelReply(m) });
  items.push({ label: 'Комментировать', svg: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>', action: () => _openCommentsPanel(m) });

  // Pin (admin only)
  const isPinned = S.chPinnedMsg && S.chPinnedMsg.message_id == m.id;
  if (isAdmin && m.id && !isTemp(m.id)) {
    items.push({
      label: isPinned ? 'Открепить' : 'Закрепить',
      svg: '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M16 12V4h1a1 1 0 000-2H7a1 1 0 000 2h1v8l-2 2v2h5v5h2v-5h5v-2l-2-2z"/></svg>',
      action: isPinned ? () => _unpinChannelMsg(ch.channel_id) : () => _pinChannelMsg(ch.channel_id, m.id)
    });
  }

  // Copy
  if (m.body) {
    items.push({ label: 'Копировать', svg: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>', action: () => {
      navigator.clipboard.writeText(m.body).then(() => toast('Скопировано', 'ok'));
    }});
  }

  // Select mode
  if (!isTemp(m.id)) {
    items.push({ label: 'Выбрать', svg: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>', action: () => {
      _closeCtxMenu();
      const row = document.querySelector('.mrow[data-id="' + m.id + '"]');
      if (row) row.click();
    }});
  }

  // Edit (own or admin)
  if ((isAdmin || isMe) && !isTemp(m.id)) {
    items.push({ label: 'Изменить', svg: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>', action: () => _editChannelMsg(m) });
  }

  // Delete (own or admin)
  if ((isAdmin || isMe) && !isTemp(m.id)) {
    items.push({ label: 'Удалить', svg: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>', action: () => _deleteChannelMsg(m), danger: true });
  }
  _showCtxMenu(e, items);
}

async function _pinChannelMsg(chId, msgId) {
  const res = await api('pin_channel_message', 'POST', { channel_id: chId, message_id: msgId });
  if (res.ok) {
    toast('Сообщение закреплено', 'ok');
    _loadChannelPin(chId);
  }
  else toast(res.message || 'Ошибка', 'err');
}

async function _unpinChannelMsg(chId) {
  const res = await api('pin_channel_message', 'POST', { channel_id: chId, unpin: 1 });
  if (res.ok) { toast('Сообщение откреплено', 'ok'); _loadChannelPin(chId); }
  else toast(res.message || 'Ошибка', 'err');
}

async function _loadChannelPin(chId) {
  try {
    const res = await api('get_pinned_channel_message?channel_id=' + chId);
    if (!res.ok || !res.pinned) {
      S.chPinnedMsg = null;
      _renderChannelPin();
      return;
    }
    S.chPinnedMsg = res.pinned;
    _renderChannelPin();
  } catch(e) {}
}

function _renderChannelPin() {
  // Remove existing pin bar
  const existing = $('ch-pin-bar');
  if (existing) existing.remove();
  
  const msg = S.chPinnedMsg;
  const pinBar = $('pin-bar');
  
  if (!msg) {
    // Hide DM pin bar
    if (pinBar) pinBar.style.display = 'none';
    return;
  }
  
  // Hide DM pin bar, show our custom one
  if (pinBar) pinBar.style.display = 'none';
  
  const ch = S.activeChannel;
  const msgsEl = $('msgs');
  if (!msgsEl || !ch) return;
  
  const bar = document.createElement('div');
  bar.id = 'ch-pin-bar';
  bar.className = 'pin-bar';
  bar.style.cssText = 'display:flex;align-items:center;padding:6px 12px;background:var(--s1);border-bottom:1px solid var(--b);cursor:pointer;gap:8px';
  bar.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16" style="flex-shrink:0;opacity:.5"><path d="M16 12V4h1a1 1 0 000-2H7a1 1 0 000 2h1v8l-2 2v2h5v5h2v-5h5v-2l-2-2z"/></svg>' +
    '<div style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
      '<span style="font-size:12px;font-weight:700;color:var(--t2)">' + esc(msg.sender_name || 'Канал') + '</span>' +
      '<span style="font-size:12px;color:var(--t3);margin-left:6px">' + esc((msg.body || '').slice(0, 60)) + '</span>' +
    '</div>';
  bar.onclick = () => {
    const t = document.querySelector('.mrow[data-id="' + msg.message_id + '"]');
    if (t) { t.scrollIntoView({ behavior: 'smooth', block: 'center' }); t.classList.add('msg-flash'); setTimeout(() => t.classList.remove('msg-flash'), 1000); }
  };
  
  // Insert before msgs area
  msgsEl.parentNode.insertBefore(bar, msgsEl);
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

function _setChannelReply(m) {
  S.chReplyTo = { id: m.id, sender_name: m.sender_name || S.activeChannel?.name || 'Канал', body: m.body || '' };
  const rbar = $('rbar');
  if (!rbar) return;
  const who = $('rbar-who');
  const txt = $('rbar-txt');
  const x = $('rbar-x');
  if (who) who.textContent = S.chReplyTo.sender_name;
  if (txt) txt.textContent = hideSpoilerText(S.chReplyTo.body).slice(0, 80);
  rbar.classList.add('on');
  if (x) x.onclick = () => _clearChannelReply();
  // Focus input
  const mfield = $('mfield');
  if (mfield) mfield.focus();
}
function _clearChannelReply() {
  S.chReplyTo = null;
  const rbar = $('rbar');
  if (rbar) rbar.classList.remove('on');
}

/* ══ COMMENTS PANEL ════════════════════════════════════════════ */
function _openCommentsPanel(m) {
  const ch = S.activeChannel;
  if (!ch) return;
  _closeCommentsPanel();
  S.chCommentsMsgId = m.id;

  const panel = document.createElement('div');
  panel.className = 'ch-comments-panel';
  panel.id = 'ch-comments-panel';

  // Blurred background layer (including custom background)
  const overlay = document.createElement('div');
  overlay.className = 'ch-comments-overlay';
  const bgUrl = S.chatBg || S.userBgUrl || '';
  if (bgUrl) {
    overlay.innerHTML = '<div class="blur-bg-img" style="background-image:url(' + esc(bgUrl) + ')"></div><div class="blur-bg-ov"></div>';
  }
  panel.appendChild(overlay);

  // Foreground content
  const fg = document.createElement('div');
  fg.className = 'ch-comments-fg';

  // Header
  fg.innerHTML = '<div class="ch-comments-hdr">' +
    '<button class="ch-comments-back" id="ch-cmt-back"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="18" height="18"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/></svg></button>' +
    '<span class="ch-comments-title">Комментарии</span>' +
    '<span class="ch-comments-count" id="ch-cmt-total"></span>' +
    '</div>' +
    '<div class="ch-comments-scroll" id="ch-comments-scroll"></div>' +
    '<div class="ch-comments-input">' +
      '<div class="rbar" id="ch-cmt-rbar" style="display:none"><div class="rbar-info"><div class="rbar-who" id="ch-cmt-rbar-who"></div><div class="rbar-txt" id="ch-cmt-rbar-txt"></div></div><div class="rbar-x" id="ch-cmt-rbar-x"><svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg></div></div>' +
      '<div contenteditable="true" class="ch-cmt-field" id="ch-cmt-field" placeholder="Написать комментарий..."></div>' +
      '<button class="ch-cmt-send" id="ch-cmt-send"><svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg></button>' +
    '</div>';

  panel.appendChild(fg);
  // Append to #active-chat instead of body so it fills only the chat area
  const host = $('active-chat') || document.body;
  host.appendChild(panel);
  requestAnimationFrame(() => panel.classList.add('on'));

  // Render the original post at top of scroll area
  const scrollArea = $('ch-comments-scroll');
  if (scrollArea) {
    // Add "Начало обсуждения" date-pill above the post
    const startPill = document.createElement('div');
    startPill.className = 'date-pill';
    startPill.innerHTML = '<span>Начало обсуждения</span>';
    scrollArea.appendChild(startPill);

    const postEl = _makeChannelMsgEl(m);
    postEl.style.pointerEvents = 'none';
    postEl.querySelector('.ch-fwd-btn')?.remove();
    // Remove comment footer (divider + avatars + count) from post inside comments panel
    postEl.querySelector('.ch-cmt-divider')?.remove();
    postEl.querySelector('.ch-cmt-bar')?.remove();
    const postWrap = document.createElement('div');
    postWrap.className = 'ch-comments-post';
    postWrap.appendChild(postEl);
    scrollArea.appendChild(postWrap);
  }

  $('ch-cmt-back').onclick = () => _closeCommentsPanel();
  $('ch-cmt-send').onclick = () => _sendComment();
  $('ch-cmt-field').onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _sendComment(); }
  };

  _loadComments(ch.channel_id, m.id);
}

function _closeCommentsPanel() {
  S.chCommentsMsgId = null;
  const panel = $('ch-comments-panel');
  if (panel) panel.remove();
}

/* ══ REPLY PANEL (fullscreen, shows replies to a message) ═════════ */
function _openReplyPanel(m) {
  const ch = S.activeChannel;
  if (!ch) return;
  const _chId = ch.channel_id;
  const replies = (S.channelMsgs[_chId] || []).filter(x => x.reply_to == m.id);
  if (!replies.length) { toast('Нет ответов', 'info'); return; }

  // Reuse comments panel structure for replies
  _closeCommentsPanel();
  S.chCommentsMsgId = m.id;

  const panel = document.createElement('div');
  panel.className = 'ch-comments-panel';
  panel.id = 'ch-comments-panel';

  const overlay = document.createElement('div');
  overlay.className = 'ch-comments-overlay';
  const bgUrl = S.chatBg || S.userBgUrl || '';
  if (bgUrl) {
    overlay.innerHTML = '<div class="blur-bg-img" style="background-image:url(' + esc(bgUrl) + ')"></div><div class="blur-bg-ov"></div>';
  }
  panel.appendChild(overlay);

  const fg = document.createElement('div');
  fg.className = 'ch-comments-fg';
  fg.innerHTML = '<div class="ch-comments-hdr">' +
    '<button class="ch-comments-back" id="ch-cmt-back"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="18" height="18"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/></svg></button>' +
    '<span class="ch-comments-title">Ответы</span>' +
    '<span class="ch-comments-count" id="ch-cmt-total">' + replies.length + '</span>' +
    '</div>' +
    '<div class="ch-comments-scroll" id="ch-comments-scroll"></div>';

  panel.appendChild(fg);
  document.body.appendChild(panel);
  requestAnimationFrame(() => panel.classList.add('on'));

  const scrollArea = $('ch-comments-scroll');
  if (scrollArea) {
    // Show original post
    const postEl = _makeChannelMsgEl(m);
    postEl.style.pointerEvents = 'none';
    postEl.querySelector('.ch-fwd-btn')?.remove();
    const postWrap = document.createElement('div');
    postWrap.className = 'ch-comments-post';
    postWrap.appendChild(postEl);
    scrollArea.appendChild(postWrap);

    // Show replies as chat-style messages
    replies.forEach(r => {
      const replyEl = _makeChannelMsgEl(r);
      replyEl.querySelector('.ch-fwd-btn')?.remove();
      scrollArea.appendChild(replyEl);
    });
  }

  $('ch-cmt-back').onclick = () => _closeCommentsPanel();
}

async function _loadComments(chId, msgId) {
  const scroll = $('ch-comments-scroll');
  if (!scroll) return;

  // Keep the post element, remove only comment items and date-pills
  scroll.querySelectorAll('.ch-comment-item, .ch-comment-skel, .ch-cmt-date-sep').forEach(e => e.remove());

  // Skeleton loading instead of text
  for (let i = 0; i < 3; i++) {
    const skel = document.createElement('div');
    skel.className = 'ch-comment-skel';
    skel.innerHTML =
      '<div class="ch-comment-skel-avi"></div>' +
      '<div class="ch-comment-skel-body">' +
        '<div class="ch-comment-skel-line ch-comment-skel-name"></div>' +
        '<div class="ch-comment-skel-line ch-comment-skel-text"></div>' +
        '<div class="ch-comment-skel-line ch-comment-skel-text short"></div>' +
      '</div>';
    scroll.appendChild(skel);
  }

  try {
    const res = await api('get_channel_comments?channel_id=' + chId + '&message_id=' + msgId + '&limit=100');
    const total = $('ch-cmt-total');
    if (total) total.textContent = res.total ? res.total + '' : '';

    // Remove skeletons
    scroll.querySelectorAll('.ch-comment-skel').forEach(e => e.remove());

    if (!res.ok || !res.comments?.length) {
      return;
    }

    let lastDate = null;
    res.comments.forEach(c => {
      // Date-pill between comments when date changes
      const d = fmtDate(c.sent_at);
      if (d !== lastDate) {
        const sep = document.createElement('div');
        sep.className = 'date-pill ch-cmt-date-sep';
        sep.innerHTML = '<span>' + d + '</span>';
        scroll.appendChild(sep);
        lastDate = d;
      }

      const el = document.createElement('div');
      el.className = 'ch-comment-item' + (c.sender_id == S.user?.id ? ' is-me' : '');
      el.dataset.id = c.id;
      const isMe = c.sender_id == S.user?.id;

      const aviHtml_c = (() => {
        if (c.sender_avatar) {
          return '<img src="' + getMediaUrl(c.sender_avatar) + '" alt="" loading="lazy">';
        }
        const color = _avatarColor(c.sender_name || '?');
        return '<div style="width:100%;height:100%;background:' + color + ';display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:#fff">' + (c.sender_name || '?')[0].toUpperCase() + '</div>';
      })();

      el.innerHTML = '<div class="ch-comment-avi">' + aviHtml_c + '</div>' +
        '<div class="ch-comment-body">' +
          '<div class="ch-comment-head"><span class="ch-comment-name">' + esc(c.sender_name || 'Анон') + '</span>' +
            '<span class="ch-comment-time">' + fmtTime(c.sent_at) + '</span>' +
            (c.is_edited ? '<span class="med" title="ред."></span>' : '') +
          '</div>' +
          '<div class="ch-comment-bubble"><div class="ch-comment-text">' + fmtText(c.body || '') + '</div></div>' +
        '</div>';

      el.oncontextmenu = (e) => {
        e.preventDefault();
        const items = [
          { label: 'Ответить', icon: '↩️', action: () => {
            const rbar = $('ch-cmt-rbar');
            if (rbar) {
              const who = $('ch-cmt-rbar-who');
              const txt = $('ch-cmt-rbar-txt');
              if (who) who.textContent = c.sender_name || 'Анон';
              if (txt) txt.textContent = (c.body || '').slice(0, 60);
              rbar.style.display = 'flex';
              S._chCmtReplyTo = c.id;
              $('ch-cmt-rbar-x').onclick = () => { rbar.style.display = 'none'; S._chCmtReplyTo = null; };
            }
          }},
          { label: 'Копировать', icon: '📋', action: () => {
            if (c.body) navigator.clipboard.writeText(c.body).then(() => toast('Скопировано', 'ok'));
          }},
        ];
        if (isMe) items.push({ label: 'Удалить', icon: '🗑', action: () => _deleteComment(c.id), danger: true });
        _showCtxMenu(e, items);
      };

      scroll.appendChild(el);
    });
    scroll.scrollTop = scroll.scrollHeight;
  } catch(e) {
    scroll.querySelectorAll('.ch-comment-skel').forEach(e => e.remove());
  }
}

async function _sendComment() {
  const ch = S.activeChannel;
  const msgId = S.chCommentsMsgId;
  if (!ch || !msgId) return;
  
  const field = $('ch-cmt-field');
  if (!field) return;
  const body = field.innerText?.trim() || '';
  if (!body) return;
  field.innerHTML = '';
  
  try {
    const payload = { channel_id: ch.channel_id, message_id: msgId, body: body };
    if (S._chCmtReplyTo) { payload.reply_to = S._chCmtReplyTo; S._chCmtReplyTo = null; $('ch-cmt-rbar').style.display = 'none'; }
    
    const res = await api('send_channel_comment', 'POST', payload);
    if (res.ok) {
      _loadComments(ch.channel_id, msgId);
      // Update inline comment footer on the message bubble
      const chId = ch.channel_id;
      const mem = (S.channelMsgs[chId] || []).find(x => x.id == msgId);
      if (mem) {
        mem.comments_count = (mem.comments_count || 0) + 1;
        // Add current user as last commenter if not already there
        if (!mem.last_commenters) mem.last_commenters = [];
        const myIdx = mem.last_commenters.findIndex(c => c.sender_id == S.user?.id);
        if (myIdx >= 0) mem.last_commenters.splice(myIdx, 1);
        mem.last_commenters.unshift({
          sender_id: S.user?.id,
          sender_name: S.user?.nickname || S.user?.signal_id || 'Вы',
          sender_avatar: S.user?.avatar_url || null,
        });
        if (mem.last_commenters.length > 3) mem.last_commenters = mem.last_commenters.slice(0, 3);
        _patchChannelMsgDom(mem);
      }
    } else toast(res.message || 'Ошибка', 'err');
  } catch(e) { toast('Ошибка сети', 'err'); }
}

async function _deleteComment(commentId) {
  if (!confirm('Удалить комментарий?')) return;
  const ch = S.activeChannel;
  const msgId = S.chCommentsMsgId;
  try {
    const res = await api('delete_channel_comment', 'POST', { comment_id: commentId });
    if (res.ok) {
      toast('Комментарий удалён', 'ok');
      if (ch && msgId) {
        _loadComments(ch.channel_id, msgId);
        // Decrement comments_count and re-render footer
        const chId = ch.channel_id;
        const mem = (S.channelMsgs[chId] || []).find(x => x.id == msgId);
        if (mem) {
          mem.comments_count = Math.max(0, (mem.comments_count || 1) - 1);
          _patchChannelMsgDom(mem);
        }
      }
    } else toast(res.message || 'Ошибка', 'err');
  } catch(e) { toast('Ошибка', 'err'); }
}

/* ══ SEND CHANNEL TEXT ════════════════════════════════════════ */
async function sendChannelText() {
  const ch = S.activeChannel;
  if (!ch) return;
  if (!_chCanPost(ch)) { toast('Вы не можете писать в этом канале', 'err'); return; }

  const mfield = $('mfield');
  if (!mfield) return;
  const body = mfield.innerText?.trim() || '';
  if (!body) return;
  mfield.innerHTML = '';

  const chId = ch.channel_id;
  const replyTo = S.chReplyTo ? S.chReplyTo.id : null;
  S.chReplyTo ? _clearChannelReply() : null;
  const tid = 'tc' + Date.now();
  const tmpMsg = {
    id: tid, sender_id: S.user?.id, sender_name: S.user?.nickname || S.user?.signal_id || 'Вы',
    body: body, sent_at: Math.floor(Date.now() / 1000), is_admin: true, is_edited: false, views: 0,
  };
  S.channelMsgs[chId] = S.channelMsgs[chId] || [];
  S.channelMsgs[chId].push(tmpMsg);
  appendChannelMsg(chId, tmpMsg);
  scrollBot();

  try {
    const payload = { channel_id: chId, body: body };
    if (replyTo) payload.reply_to = replyTo;
    const res = await api('send_channel_message', 'POST', payload);
    if (res.ok) {
      // The API may return a full message object or just { message_id, sent_at }
      if (res.message && res.message.id) {
        const real = res.message;
        if (real.media_url) real.media_url = getMediaUrl(real.media_url);
        const idx = S.channelMsgs[chId].findIndex(x => x.id === tid);
        if (idx >= 0) S.channelMsgs[chId][idx] = real;
        S.channelLastId[chId] = Math.max(S.channelLastId[chId] || 0, real.id);
        const el = document.querySelector('.mrow[data-id="' + tid + '"]');
        if (el) { el.dataset.id = real.id; _patchChannelMsgDom(real); }
      } else if (res.message_id) {
        // API returned just the ID — promote temp message
        const idx = S.channelMsgs[chId].findIndex(x => x.id === tid);
        if (idx >= 0) {
          S.channelMsgs[chId][idx].id = res.message_id;
          S.channelMsgs[chId][idx].is_edited = 0;
          if (res.sent_at) S.channelMsgs[chId][idx].sent_at = res.sent_at;
        }
        S.channelLastId[chId] = Math.max(S.channelLastId[chId] || 0, res.message_id);
        const el = document.querySelector('.mrow[data-id="' + tid + '"]');
        if (el) { el.dataset.id = res.message_id; }
      }
      // Remove sending state from temp bubble
      const tmpEl = document.querySelector('.mrow[data-id="' + (res.message_id || tid) + '"]');
      if (tmpEl) {
        tmpEl.classList.remove('sending');
        const mbody = tmpEl.querySelector('.mbody');
        if (mbody) mbody.classList.remove('sending');
        const sp = tmpEl.querySelector('.send-spinner');
        if (sp) sp.remove();
      }
      cacheWriteChannel(chId, S.channelMsgs[chId]);
    } else {
      const errMsg = res.message || res.error || 'Ошибка отправки';
      toast(errMsg, 'err');
      console.warn('[channel] send error:', res);
      const el = document.querySelector('.mrow[data-id="' + tid + '"]');
      if (el) {
        el.classList.remove('sending');
        el.classList.add('msg-err');
        const mbody = el.querySelector('.mbody');
        if (mbody) mbody.classList.remove('sending');
        const sp = el.querySelector('.send-spinner');
        if (sp) {
          sp.classList.remove('send-spinner');
          sp.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="var(--err,#e74c3c)" stroke-width="2.5" width="13" height="13"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>';
          sp.style.animation = 'none';
          sp.style.opacity = '.6';
        }
      }
    }
  } catch(e) {
    toast('Ошибка сети', 'err');
    console.warn('[channel] send network error:', e);
    const el = document.querySelector('.mrow[data-id="' + tid + '"]');
    if (el) {
      el.classList.remove('sending');
      el.classList.add('msg-err');
      const mbody = el.querySelector('.mbody');
      if (mbody) mbody.classList.remove('sending');
      const sp = el.querySelector('.send-spinner');
      if (sp) {
        sp.classList.remove('send-spinner');
        sp.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="var(--err,#e74c3c)" stroke-width="2.5" width="13" height="13"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>';
        sp.style.animation = 'none';
        sp.style.opacity = '.6';
      }
    }
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
          } else if (existing.body !== m.body || existing.is_edited !== m.is_edited ||
                     existing.views !== m.views || existing.comments_count !== m.comments_count ||
                     JSON.stringify(existing.reactions) !== JSON.stringify(m.reactions) ||
                     JSON.stringify(existing.last_commenters) !== JSON.stringify(m.last_commenters)) {
            Object.assign(existing, m);
            if (m.reactions) S.chRxns[m.id] = m.reactions;
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

/* ══ CREATE CHANNEL MODAL — Clean centered layout ══════════════════ */
function showCreateChannelModal() {
  let overlay = $('modal-ch-create');
  if (overlay) overlay.remove();

  overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.id = 'modal-ch-create';

  overlay.innerHTML = `<div class="pm-panel" style="width:400px;max-width:100vw">
    <button class="pm-close" data-close="modal-ch-create">
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
    </button>

    <div class="pm-scroll">
      <div class="ch-create-head">
        <label for="ch-create-avatar-input" class="ch-create-avi" id="ch-create-av" title="Загрузить аватарку">
          <svg viewBox="0 0 24 24" fill="currentColor" width="36" height="36"><path d="M4.5 3h15A2.5 2.5 0 0 1 22 5.5v13a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 18.5v-13A2.5 2.5 0 0 1 4.5 3zm0 2a.5.5 0 0 0-.5.5v13a.5.5 0 0 0 .5.5h15a.5.5 0 0 0 .5-.5v-13a.5.5 0 0 0-.5-.5h-15zM9 15.5l6-4.5-6-4.5v9z"/></svg>
          <div class="ch-create-avi-edit">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="12" height="12"><path stroke-linecap="round" stroke-linejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
          </div>
        </label>
        <input type="file" id="ch-create-avatar-input" accept="image/*" style="display:none">
        <div class="ch-create-title">Создать канал</div>
        <div class="ch-create-subtitle">Выберите аватарку и введите данные</div>
      </div>

      <div class="ch-create-body">
        <div class="tg-section">
          <div class="tg-row" style="align-items:flex-start;cursor:text">
            <div class="tg-row-ic" style="color:var(--y);background:transparent">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            </div>
            <div class="tg-row-body" style="padding:6px 0">
              <input type="text" id="ch-create-name" placeholder="Название канала" maxlength="100" style="
                width:100%;border:none;outline:none;background:transparent;color:var(--t1);
                font-family:var(--font);font-size:15px;font-weight:500;padding:0;
              ">
              <span class="tg-row-sub">Обязательное поле</span>
            </div>
          </div>
        </div>

        <div class="tg-section">
          <div class="tg-row" style="align-items:flex-start;cursor:text">
            <div class="tg-row-ic" style="color:var(--y);background:transparent">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
            </div>
            <div class="tg-row-body" style="padding:6px 0">
              <textarea id="ch-create-desc" placeholder="Описание (необязательно)" rows="2" maxlength="500" style="
                width:100%;border:none;outline:none;background:transparent;color:var(--t1);
                font-family:var(--font);font-size:15px;resize:vertical;line-height:1.5;
                padding:0;
              "></textarea>
              <span class="tg-row-sub">О чём этот канал</span>
            </div>
          </div>
        </div>

        <div class="tg-section" id="ch-create-username-section">
          <div class="tg-row" style="cursor:text">
            <div class="tg-row-ic" style="color:var(--y);background:transparent">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
            </div>
            <div class="tg-row-body">
              <input type="text" id="ch-create-username" placeholder="username" maxlength="32" style="
                width:100%;border:none;outline:none;background:transparent;color:var(--t1);
                font-family:var(--font);font-size:15px;padding:0;
              ">
              <span class="tg-row-sub">Публичная ссылка t.me/<wbr>username</span>
            </div>
            <span style="color:var(--t3);font-size:15px;margin-right:4px">@</span>
          </div>
        </div>

        <div class="tg-section">
          <div class="tg-row ch-create-type-row" id="ch-create-type-public" style="cursor:pointer" onclick="chCreateSetType('public')">
            <div class="tg-row-ic" style="background:transparent">
              <span style="font-size:22px">🌐</span>
            </div>
            <div class="tg-row-body">
              <span class="tg-row-lbl">Публичный канал</span>
              <span class="tg-row-sub">Виден всем, можно найти по ссылке</span>
            </div>
            <div class="ch-radio-dot on" id="ch-dot-public"><div></div></div>
          </div>
          <div class="tg-row-sep"></div>
          <div class="tg-row ch-create-type-row" id="ch-create-type-private" style="cursor:pointer" onclick="chCreateSetType('private')">
            <div class="tg-row-ic" style="background:transparent">
              <span style="font-size:22px">🔒</span>
            </div>
            <div class="tg-row-body">
              <span class="tg-row-lbl">Приватный канал</span>
              <span class="tg-row-sub">Доступ только по ссылке-приглашению</span>
            </div>
            <div class="ch-radio-dot" id="ch-dot-private"><div></div></div>
          </div>
        </div>

        <div class="ch-create-submit-wrap">
          <button class="btn" id="btn-ch-create-submit" style="width:100%;padding:13px;border-radius:14px;font-size:15px;font-weight:600">Создать канал</button>
        </div>
      </div>
    </div>
  </div>`;

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('on'));

  // Type toggle
  window.chCreateSetType = function(type) {
    const pubDot = $('ch-dot-public');
    const prvDot = $('ch-dot-private');
    const usernameSection = $('ch-create-username-section');
    if (type === 'public') {
      pubDot.classList.add('on');
      prvDot.classList.remove('on');
      if (usernameSection) usernameSection.style.display = '';
    } else {
      prvDot.classList.add('on');
      pubDot.classList.remove('on');
      if (usernameSection) usernameSection.style.display = 'none';
    }
    window._chCreateType = type;
  };
  window._chCreateType = 'public';

  // Avatar preview
  const avInput = $('ch-create-avatar-input');
  const avLabel = $('ch-create-av');
  let _chCreateAvatarFile = null;
  if (avInput) {
    avInput.onchange = () => {
      const file = avInput.files[0];
      if (!file) return;
      _chCreateAvatarFile = file;
      const reader = new FileReader();
      reader.onload = (e) => {
        if (avLabel) {
          avLabel.innerHTML = '<img src="' + e.target.result + '" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">' +
            '<div class="ch-create-avi-edit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="12" height="12"><path stroke-linecap="round" stroke-linejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg></div>';
        }
      };
      reader.readAsDataURL(file);
    };
  }

  // Close
  overlay.querySelector('[data-close="modal-ch-create"]').onclick = () => closeMod('modal-ch-create');
  overlay.onclick = (e) => { if (e.target === overlay) closeMod('modal-ch-create'); };

  // Submit
  $('btn-ch-create-submit').onclick = async () => {
    const name = $('ch-create-name')?.value?.trim();
    if (!name) { toast('Введите название канала', 'err'); $('ch-create-name')?.focus(); return; }
    const desc = $('ch-create-desc')?.value?.trim() || '';
    const type = window._chCreateType || 'public';
    const username = type === 'public' ? ($('ch-create-username')?.value?.trim() || '') : '';

    $('btn-ch-create-submit').disabled = true;
    $('btn-ch-create-submit').textContent = 'Создание...';

    let avatarUrl = null;
    // Upload avatar first if selected
    if (_chCreateAvatarFile) {
      try {
        const formData = new FormData();
        formData.append('avatar', _chCreateAvatarFile);
        const avRes = await api('upload_channel_avatar', 'POST', formData, true);
        if (avRes.ok && avRes.avatar_url) avatarUrl = avRes.avatar_url;
      } catch(e) { /* ignore avatar upload error */ }
    }

    const data = { name, description: desc, username, type };
    if (avatarUrl) data.avatar_url = avatarUrl;
    const res = await api('create_channel', 'POST', data);

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

/* ══ JOIN CHANNEL MODAL — Profile panel style ══════════════════ */
function showJoinChannelModal() {
  let overlay = $('modal-ch-join');
  if (overlay) overlay.remove();

  overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.id = 'modal-ch-join';

  overlay.innerHTML = `<div class="pm-panel" style="width:400px;max-width:100vw">
    <div class="pm-hero-bg">
      <div class="blur-bg-img" style="background:linear-gradient(135deg, hsl(200,50%,35%), hsl(160,50%,30%))"></div>
      <div class="blur-bg-ov"></div>
    </div>
    <button class="pm-close" data-close="modal-ch-join">
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
    </button>

    <div class="pm-scroll">
      <div class="pm-header-zone" style="padding-top:56px">
        <div class="pm-avi-wrap">
          <div class="pm-hero-avi" style="cursor:default">
            <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:hsl(200,50%,35%);color:#fff;border-radius:inherit">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="48" height="48"><path d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"/></svg>
            </div>
          </div>
        </div>
        <div class="pm-name-row" style="margin-top:12px;justify-content:center">
          <span class="pm-name" style="font-size:20px">Присоединиться</span>
        </div>
        <div class="pm-status-pill" style="margin-top:6px;cursor:default">
          <span style="font-size:13px;color:var(--t3)">Найдите канал по ссылке или @username</span>
        </div>
      </div>

      <div class="pm-body-zone" style="padding-top:8px">
        <div class="tg-section">
          <div class="tg-row" style="cursor:text">
            <div class="tg-row-ic" style="color:var(--y);background:transparent">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            </div>
            <div class="tg-row-body">
              <input type="text" id="ch-join-input" placeholder="https://initial.su/join/… или @username" style="
                width:100%;border:none;outline:none;background:transparent;color:var(--t1);
                font-family:var(--font);font-size:15px;padding:0;
              ">
              <span class="tg-row-sub">Ссылка-приглашение или @username</span>
            </div>
          </div>
        </div>

        <div style="padding:20px 0">
          <button class="btn" id="btn-ch-join-submit" style="width:100%;padding:13px;border-radius:14px;font-size:15px;font-weight:600">Присоединиться</button>
        </div>
      </div>
    </div>
  </div>`;

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

/* ══ CHANNEL PROFILE (unified with user profile panel) ═════════ */
function openChannelProfile(ch) {
  if (!ch) return;

  const name = ch.name || 'Канал';
  const avatar = ch.avatar_url;
  const members = ch.member_count || ch.members_count || ch.subscribers || 0;
  const desc = ch.description || '';
  const isMuted = ch.muted || S.channelMuted[ch.channel_id];
  const isAdmin = _chIsAdmin(ch);
  const isOwner = _chIsOwner(ch);

  // Avatar & Background blur
  const aviEl = $('pm-hero-avi');
  if (aviEl) {
    aviEl.innerHTML = aviHtml(name, avatar);
    aviEl.classList.add('ch-profile-avi');
  }
  applyBlurredAvatarBg('pm-hero-bg', name, avatar);

  // Name
  const nameEl = $('pm-partner-name');
  if (nameEl) { nameEl.textContent = name; wtn(nameEl); }

  // Hide verified/team badges for channels
  const vBadge = $('pm-verified-badge');
  if (vBadge) vBadge.style.display = 'none';
  const tBadge = $('pm-team-badge');
  if (tBadge) tBadge.style.display = 'none';

  // Status: subscriber count + channel type (white text on avatar gradient)
  const pill = $('pm-partner-status');
  const pillTxt = $('pm-partner-status-text');
  if (pill && pillTxt) {
    pill.className = 'pm-status-pill on'; // Use 'on' class for white text on gradient
    const subsText = members ? members + ' подписчик' + _pluralRu(members) : '0 подписчиков';
    const typeLabel = ch.type === 'private' ? ' · Приватный' : ' · Публичный';
    pillTxt.textContent = subsText + typeLabel;
  }

  // Info rows
  const rowSid = $('pm-row-sid');
  const valSid = $('pm-info-sid-val');
  const rowBio = $('pm-row-bio');
  const valBio = $('pm-info-bio-val');
  const sep    = $('pm-info-sep');

  const hasUsername = !!(ch.username);
  const hasBio = !!desc;

  if (rowSid && valSid) {
    if (hasUsername) {
      rowSid.style.display = 'flex';
      valSid.textContent = '@' + ch.username;
      rowSid.onclick = () => {
        navigator.clipboard.writeText('@' + ch.username).then(() => toast('Username скопирован', 'ok'));
      };
    } else { rowSid.style.display = 'none'; }
  }
  if (rowBio && valBio) {
    if (hasBio) {
      rowBio.style.display = 'flex';
      valBio.innerHTML = fmtText(desc);
      wtn(valBio);
    } else { rowBio.style.display = 'none'; }
  }

  if (sep) sep.style.display = (hasUsername && hasBio) ? 'block' : 'none';
  if ($('pm-info-section')) $('pm-info-section').style.display = (hasUsername || hasBio) ? 'flex' : 'none';

  // Action buttons — channel-specific
  const actsRow   = $('pm-actions-row');
  const btnMsg    = $('pm-btn-message');
  const btnMute   = $('pm-btn-mute');
  const btnCall   = $('pm-btn-call');
  const btnVideo  = $('pm-btn-video');

  if (actsRow) actsRow.style.display = 'flex';

  // Message button → "посты" (close profile, stay on channel)
  if (btnMsg) {
    btnMsg.style.display = 'flex';
    const msgLbl = btnMsg.querySelector('.pm-act-lbl');
    if (msgLbl) msgLbl.textContent = 'посты';
    const msgIc = btnMsg.querySelector('.pm-act-ic');
    if (msgIc) msgIc.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>';
    btnMsg.onclick = () => { closeMod('modal-partner'); };
  }

  // Call → hide for channels
  if (btnCall) { btnCall.style.display = 'none'; }
  // Video → hide for channels
  if (btnVideo) { btnVideo.style.display = 'none'; }

  // Mute toggle
  if (btnMute) {
    btnMute.style.display = 'flex';
    const muteTxt = $('pm-mute-txt');
    const muteIc  = btnMute.querySelector('.pm-act-ic');
    if (isMuted) {
      btnMute.classList.add('muted');
      if (muteTxt) muteTxt.textContent = 'Звук вкл';
      if (muteIc) muteIc.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>';
    } else {
      btnMute.classList.remove('muted');
      if (muteTxt) muteTxt.textContent = 'Звук';
      if (muteIc) muteIc.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>';
    }
    btnMute.onclick = async () => {
      await _toggleMuteChannel(ch.channel_id, !isMuted);
      // Re-open profile to refresh
      openChannelProfile(S.activeChannel || ch);
    };
  }

  // ── Join / Leave dynamic button (pm-actions style, first in row) ──
  if (actsRow) {
    const existingJoinBtn = $('pm-btn-join');
    if (existingJoinBtn) existingJoinBtn.remove();

    // Owner cannot leave — hide button entirely for owners
    const isOwner = _chIsOwner(ch);
    if (isOwner) {
      // Don't show join/leave button for channel owner
    } else {
      const joinBtn = document.createElement('button');
      joinBtn.id = 'pm-btn-join';
      joinBtn.className = 'pm-action-btn' + (ch.is_member ? ' muted' : '');
      
      let joinIconSvg, joinLabel;
      if (ch.is_member) {
        // Already a member — show "Выйти" with exit icon
        joinIconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>';
        joinLabel = 'выйти';
      } else if (ch.type !== 'private') {
        joinIconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>';
        joinLabel = 'вступить';
      } else {
        joinBtn.style.display = 'none';
      }

      if (joinBtn.style.display !== 'none') {
        joinBtn.innerHTML = '<div class="pm-act-circle"><div class="pm-act-ic">' + joinIconSvg + '</div></div><span class="pm-act-lbl">' + joinLabel + '</span>';
        joinBtn.onclick = async () => {
          if (ch.is_member) {
            // _leaveChannel already has its own confirm — don't double confirm
            await _leaveChannel(ch.channel_id);
            // After leaving, close profile and channel if active
            if (S.activeChannel && S.activeChannel.channel_id === ch.channel_id) {
              closeChannel();
            }
            closeMod('modal-partner');
          } else {
            joinBtn.disabled = true;
            const origLabel = joinBtn.querySelector('.pm-act-lbl');
            if (origLabel) origLabel.textContent = '...';
            const res = await api('join_channel', 'POST', { channel_id: ch.channel_id });
            joinBtn.disabled = false;
            if (res.ok) {
              toast('Вы подписались!', 'ok');
              await loadChannels();
              try {
                const info = await api('get_channel_info?channel_id=' + ch.channel_id);
                if (info.ok) {
                  const updatedCh = { ...ch, ...info, channel_id: ch.channel_id };
                  S.activeChannel = updatedCh;
                  openChannelProfile(updatedCh);
                }
              } catch(e) {}
            } else toast(res.message || 'Ошибка', 'err');
          }
        };
        actsRow.insertBefore(joinBtn, actsRow.firstChild);
      }
    }
  }

  // Block / Report → Leave / Delete for channels
  const dangerRow = $('pm-danger-actions');
  if (dangerRow) {
    dangerRow.style.display = 'flex';
    const blockLbl  = $('pm-block-label');
    const reportLbl = $('pm-report-label');
    const btnBlock  = $('pm-btn-block');
    const btnReport = $('pm-btn-report');

    if (isOwner) {
      if (blockLbl) blockLbl.textContent = 'Удалить канал';
      if (btnBlock) {
        btnBlock.onclick = () => { closeMod('modal-partner'); _deleteChannel(ch); };
      }
      if (reportLbl) reportLbl.textContent = 'Настройки канала';
      if (btnReport) {
        btnReport.onclick = () => { closeMod('modal-partner'); showChannelSettings(ch); };
      }
    } else {
      if (blockLbl) blockLbl.textContent = 'Пожаловаться';
      if (btnBlock) {
        btnBlock.onclick = () => { closeMod('modal-partner'); toast('Жалоба отправлена', 'ok'); };
      }
      if (reportLbl) reportLbl.textContent = 'Настройки канала';
      if (btnReport) {
        if (isAdmin) {
          btnReport.onclick = () => { closeMod('modal-partner'); showChannelSettings(ch); };
        } else {
          reportLbl.textContent = 'Пожаловаться';
          btnReport.onclick = () => { closeMod('modal-partner'); toast('Жалоба отправлена', 'ok'); };
        }
      }
    }
  }

  // Add channel-specific info rows (link, role)
  _addChannelProfileExtras(ch);

  // Update media section header for channels
  const mediaHeader = $('pm-media-section')?.querySelector('.pm-media-header span');
  if (mediaHeader) mediaHeader.textContent = 'Медиа канала';

  openMod('modal-partner');
}

function _addChannelProfileExtras(ch) {
  // Remove any previous channel extras
  document.querySelectorAll('.ch-profile-extra').forEach(e => e.remove());

  const section = $('pm-info-section');
  if (!section) return;

  const isAdmin = _chIsAdmin(ch);
  const isOwner = _chIsOwner(ch);

  // Role row
  const roleRow = document.createElement('div');
  roleRow.className = 'tg-row ch-profile-extra';
  roleRow.style.cssText = 'cursor:default;align-items:center;';
  roleRow.innerHTML = '<div class="tg-row-ic" style="color:var(--y);background:transparent;margin-right:16px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg></div><div class="tg-row-body"><span class="tg-row-lbl">' + _chRoleLabel(ch.my_role || '') + '</span><span class="tg-row-sub">Ваша роль</span></div>';
  section.appendChild(roleRow);

  // Link row (for public channels)
  if (ch.type === 'public' && ch.username) {
    const linkRow = document.createElement('div');
    linkRow.className = 'tg-row ch-profile-extra';
    linkRow.style.cssText = 'cursor:pointer;align-items:center;';
    linkRow.innerHTML = '<div class="tg-row-ic" style="color:var(--y);background:transparent;margin-right:16px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></div><div class="tg-row-body"><span class="tg-row-lbl">@' + esc(ch.username) + '</span><span class="tg-row-sub">Ссылка на канал</span></div><svg class="tg-row-arr" width="7" height="12" viewBox="0 0 7 12" fill="none"><path d="M1 1l5 5-5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    linkRow.onclick = () => copyChannelLink(ch);
    section.appendChild(linkRow);
  }
}

/* ══ CHANNEL SETTINGS ══════════════════════════════════════════ */
function showChannelSettings(ch) {
  if (!ch) return;
  const isAdmin = _chIsAdmin(ch);
  const isOwner = _chIsOwner(ch);
  const isMuted = ch.muted || S.channelMuted[ch.channel_id];

  let overlay = $('modal-ch-settings');
  if (overlay) overlay.remove();

  overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.id = 'modal-ch-settings';

  let html = '<div class="modal ch-settings-modal" style="width:440px;max-width:95vw;max-height:90vh;overflow-y:auto">' +
    '<div class="modal-hdr">' +
      '<div class="modal-title">Настройки канала</div>' +
      '<button class="modal-x" id="btn-ch-settings-close"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg></button>' +
    '</div>' +
    '<div class="modal-body" style="padding:20px">';

  // Channel header with avatar edit
  html += '<div style="display:flex;align-items:center;gap:16px;margin-bottom:20px">' +
    '<div class="ch-settings-avatar" id="ch-set-avatar" style="width:64px;height:64px;flex-shrink:0;border-radius:50%;overflow:hidden;cursor:pointer;position:relative">' +
      _chAvatarHtml(ch) +
      (isAdmin ? '<div style="position:absolute;bottom:0;right:0;width:22px;height:22px;border-radius:50%;background:var(--y);display:flex;align-items:center;justify-content:center;border:2px solid var(--bg2)">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" width="12" height="12"><path stroke-linecap="round" stroke-linejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>' +
      '</div>' : '') +
    '</div>' +
    '<div style="min-width:0;flex:1">' +
      '<div style="font-size:18px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(ch.name) + '</div>' +
      '<div style="font-size:13px;color:var(--t3);margin-top:2px">' + (ch.type === 'private' ? '🔒 Приватный канал' : '🌐 Публичный канал') + '</div>' +
      '<div style="font-size:13px;color:var(--t3)">' + _chRoleLabel(ch.my_role || '') + ' · ' + (ch.member_count || 0) + ' подписчиков</div>' +
    '</div>' +
  '</div>';

  if (isAdmin) html += '<input type="file" id="ch-avatar-input" accept="image/*" style="display:none">';

  // Editable fields (admin only)
  if (isAdmin) {
    html += '<div class="ch-settings-section">';
    html += '<div style="font-size:13px;font-weight:600;color:var(--t2);margin-bottom:10px;text-transform:uppercase;letter-spacing:.5px">Основное</div>';
    html += '<div style="margin-bottom:14px"><label style="display:block;font-size:13px;color:var(--t3);margin-bottom:6px">Название</label><input type="text" id="ch-set-name" value="' + esc(ch.name || '') + '" style="width:100%;padding:10px 14px;border-radius:12px;border:1px solid var(--br);background:var(--bg2);color:var(--t1);font-size:15px;outline:none" maxlength="100"></div>';
    html += '<div style="margin-bottom:14px"><label style="display:block;font-size:13px;color:var(--t3);margin-bottom:6px">Описание</label><textarea id="ch-set-desc" rows="3" style="width:100%;padding:10px 14px;border-radius:12px;border:1px solid var(--br);background:var(--bg2);color:var(--t1);font-size:14px;outline:none;resize:vertical" maxlength="500">' + esc(ch.description || '') + '</textarea></div>';
    if (ch.type === 'public') {
      html += '<div style="margin-bottom:14px"><label style="display:block;font-size:13px;color:var(--t3);margin-bottom:6px">Username</label><div style="display:flex;align-items:center;border-radius:12px;border:1px solid var(--br);background:var(--bg2);overflow:hidden"><span style="padding:10px 0 10px 14px;color:var(--t3);font-size:14px">@</span><input type="text" id="ch-set-username" value="' + esc(ch.username || '') + '" style="flex:1;padding:10px 14px 10px 0;border:none;background:transparent;color:var(--t1);font-size:14px;outline:none" maxlength="32"></div></div>';
    }
    html += '<button class="btn" id="btn-ch-set-save" style="width:100%;padding:11px;border-radius:12px;font-size:14px;font-weight:600;margin-bottom:4px">Сохранить изменения</button></div>';
  }

  // Permissions section (admin only)
  if (isAdmin) {
    html += '<div class="ch-settings-section" style="border-top:1px solid var(--br);padding-top:16px;margin-top:16px">';
    html += '<div style="font-size:13px;font-weight:600;color:var(--t2);margin-bottom:10px;text-transform:uppercase;letter-spacing:.5px">Права</div>';
    html += '<div style="margin-bottom:14px"><label style="display:block;font-size:13px;color:var(--t3);margin-bottom:8px">Кто может писать</label><div style="display:flex;gap:8px">' +
      '<label class="ch-perm-opt" style="flex:1;cursor:pointer"><input type="radio" name="ch-wcp" value="admins"' + (ch.who_can_post !== 'all' ? ' checked' : '') + ' style="display:none"><div style="padding:12px;border-radius:12px;border:2px solid ' + (ch.who_can_post !== 'all' ? 'var(--accent)' : 'var(--br)') + ';background:var(--bg2);text-align:center;font-size:13px;transition:border-color .2s"><div style="font-weight:600;margin-bottom:2px">Только админы</div><div style="font-size:11px;color:var(--t3)">Только администраторы могут отправлять сообщения</div></div></label>' +
      '<label class="ch-perm-opt" style="flex:1;cursor:pointer"><input type="radio" name="ch-wcp" value="all"' + (ch.who_can_post === 'all' ? ' checked' : '') + ' style="display:none"><div style="padding:12px;border-radius:12px;border:2px solid ' + (ch.who_can_post === 'all' ? 'var(--accent)' : 'var(--br)') + ';background:var(--bg2);text-align:center;font-size:13px;transition:border-color .2s"><div style="font-weight:600;margin-bottom:2px">Все подписчики</div><div style="font-size:11px;color:var(--t3)">Каждый может отправлять сообщения</div></div></label></div></div>';
    html += '<div style="margin-bottom:14px"><label style="display:block;font-size:13px;color:var(--t3);margin-bottom:6px">Медленный режим</label><select id="ch-set-slow" style="width:100%;padding:10px 14px;border-radius:12px;border:1px solid var(--br);background:var(--bg2);color:var(--t1);font-size:14px;outline:none;appearance:none"><option value="0"' + ((ch.slow_mode_seconds || 0) === 0 ? ' selected' : '') + '>Выключен</option><option value="10"' + ((ch.slow_mode_seconds || 0) === 10 ? ' selected' : '') + '>10 секунд</option><option value="30"' + ((ch.slow_mode_seconds || 0) === 30 ? ' selected' : '') + '>30 секунд</option><option value="60"' + ((ch.slow_mode_seconds || 0) === 60 ? ' selected' : '') + '>1 минута</option><option value="300"' + ((ch.slow_mode_seconds || 0) === 300 ? ' selected' : '') + '>5 минут</option></select></div>';
    html += '<button class="btn" id="btn-ch-set-perms" style="width:100%;padding:11px;border-radius:12px;font-size:14px;font-weight:600;margin-bottom:4px">Сохранить права</button></div>';
  }

  // Notifications
  html += '<div class="ch-settings-section" style="border-top:1px solid var(--br);padding-top:16px;margin-top:16px">';
  html += '<div style="font-size:13px;font-weight:600;color:var(--t2);margin-bottom:10px;text-transform:uppercase;letter-spacing:.5px">Уведомления</div>';
  html += '<div class="ch-settings-row" id="ch-set-mute" style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-radius:12px;background:var(--bg2);cursor:pointer"><div><div style="font-size:14px;font-weight:500">' + (isMuted ? 'Включить уведомления' : 'Без звука') + '</div><div style="font-size:12px;color:var(--t3)">' + (isMuted ? 'Вы получите уведомления о новых сообщениях' : 'Уведомления отключены для этого канала') + '</div></div><div class="ch-toggle' + (isMuted ? '' : ' on') + '" id="ch-mute-toggle"><div class="ch-toggle-dot"></div></div></div></div>';

  // Link section
  html += '<div class="ch-settings-section" style="border-top:1px solid var(--br);padding-top:16px;margin-top:16px">';
  html += '<div style="font-size:13px;font-weight:600;color:var(--t2);margin-bottom:10px;text-transform:uppercase;letter-spacing:.5px">Ссылка на канал</div>';
  if (ch.type === 'public' && ch.username) {
    html += '<div style="display:flex;align-items:center;gap:8px;padding:10px 14px;border-radius:12px;background:var(--bg2);cursor:pointer" id="ch-link-copy"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg><span style="flex:1;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">@' + esc(ch.username) + '</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></div>';
  } else {
    html += '<div style="display:flex;align-items:center;gap:8px;padding:10px 14px;border-radius:12px;background:var(--bg2);cursor:pointer" id="ch-link-copy"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg><span style="flex:1;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" id="ch-link-text">Загрузка...</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></div>';
  }
  html += '</div>';

  // Members
  html += '<div class="ch-settings-section" style="border-top:1px solid var(--br);padding-top:16px;margin-top:16px"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><div style="font-size:13px;font-weight:600;color:var(--t2);text-transform:uppercase;letter-spacing:.5px">Подписчики</div><button class="ico-btn" id="btn-ch-members" style="font-size:13px;color:var(--accent);padding:4px 10px;border-radius:8px">Все (' + (ch.member_count || 0) + ')</button></div></div>';

  // Danger zone
  html += '<div class="ch-settings-section" style="border-top:1px solid var(--br);padding-top:16px;margin-top:16px">';
  if (!isOwner) html += '<button class="btn" id="btn-ch-leave" style="width:100%;padding:11px;border-radius:12px;font-size:14px;font-weight:600;background:transparent;color:var(--red);border:1px solid var(--red);margin-bottom:8px">Покинуть канал</button>';
  if (isOwner) html += '<button class="btn" id="btn-ch-delete" style="width:100%;padding:11px;border-radius:12px;font-size:14px;font-weight:600;background:var(--red);box-shadow:0 4px 20px rgba(255,69,58,.35)">Удалить канал</button>';
  html += '</div></div></div>';

  overlay.innerHTML = html;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('on'));

  $('btn-ch-settings-close').onclick = () => closeMod('modal-ch-settings');
  overlay.onclick = (e) => { if (e.target === overlay) closeMod('modal-ch-settings'); };

  // Avatar upload
  if (isAdmin) {
    const avBtn = $('ch-set-avatar');
    const avInput = $('ch-avatar-input');
    if (avBtn && avInput) {
      avBtn.onclick = () => avInput.click();
      avInput.onchange = async () => {
        const file = avInput.files[0];
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) { toast('Файл слишком большой (макс 5 МБ)', 'err'); return; }
        toast('Загрузка аватара...', 'info');
        try {
          const formData = new FormData();
          formData.append('avatar', file);
          formData.append('channel_id', ch.channel_id);
          const r2 = await api('upload_channel_avatar', 'POST', formData, true);
          if (r2.ok && r2.avatar_url) {
            toast('Аватар обновлён', 'ok');
            ch.avatar_url = r2.avatar_url;
            const idx = S.channels.findIndex(c => c.channel_id === ch.channel_id);
            if (idx >= 0) S.channels[idx].avatar_url = r2.avatar_url;
            if (S.activeChannel) { S.activeChannel.avatar_url = r2.avatar_url; renderChannelHeader(S.activeChannel); }
            renderChannelsList();
            showChannelSettings(ch);
          } else toast(r2.message || 'Ошибка загрузки', 'err');
        } catch(e) { toast('Ошибка сети', 'err'); }
      };
    }
  }

  // Load invite link for private channels
  if (ch.type !== 'public') {
    api('get_channel_link?channel_id=' + ch.channel_id).then(res => {
      const txt = $('ch-link-text');
      if (txt && res.ok) txt.textContent = res.invite_link || res.link || 'Нет ссылки';
      else if (txt) txt.textContent = 'Не удалось загрузить';
    });
  }

  const linkCopy = $('ch-link-copy');
  if (linkCopy) linkCopy.onclick = () => copyChannelLink(ch);

  // Permissions toggle UI
  const permRadios = overlay.querySelectorAll('input[name="ch-wcp"]');
  const permOpts = overlay.querySelectorAll('.ch-perm-opt > div');
  permRadios.forEach((r) => {
    r.onchange = () => { permOpts.forEach(o => o.style.borderColor = 'var(--br)'); r.nextElementSibling.style.borderColor = 'var(--accent)'; };
  });

  // Save basic changes
  const saveBtn = $('btn-ch-set-save');
  if (saveBtn) {
    saveBtn.onclick = async () => {
      const name = $('ch-set-name')?.value?.trim();
      if (!name) { toast('Введите название', 'err'); return; }
      const desc = $('ch-set-desc')?.value?.trim() || '';
      const username = $('ch-set-username')?.value?.trim() || '';
      saveBtn.disabled = true; saveBtn.textContent = 'Сохранение...';
      const data = { channel_id: ch.channel_id, name: name, description: desc };
      if (ch.type === 'public' && username) data.username = username;
      const res = await api('edit_channel', 'POST', data);
      saveBtn.disabled = false; saveBtn.textContent = 'Сохранить изменения';
      if (res.ok) {
        toast('Сохранено!', 'ok');
        const idx = S.channels.findIndex(c => c.channel_id === ch.channel_id);
        if (idx >= 0) S.channels[idx] = { ...S.channels[idx], name, description: desc, username };
        if (S.activeChannel && ch.channel_id === S.activeChannel.channel_id) {
          S.activeChannel = { ...S.activeChannel, name, description: desc, username };
          renderChannelHeader(S.activeChannel);
        }
        renderChannelsList();
      } else toast(res.message || 'Ошибка', 'err');
    };
  }

  // Save permissions
  const permsBtn = $('btn-ch-set-perms');
  if (permsBtn) {
    permsBtn.onclick = async () => {
      const wcp = overlay.querySelector('input[name="ch-wcp"]:checked')?.value || 'admins';
      const slow = parseInt($('ch-set-slow')?.value || '0', 10);
      permsBtn.disabled = true; permsBtn.textContent = 'Сохранение...';
      const res = await api('edit_channel', 'POST', { channel_id: ch.channel_id, who_can_post: wcp, slow_mode_seconds: slow });
      permsBtn.disabled = false; permsBtn.textContent = 'Сохранить права';
      if (res.ok) {
        toast('Права обновлены', 'ok');
        ch.who_can_post = wcp; ch.slow_mode_seconds = slow;
        const idx = S.channels.findIndex(c => c.channel_id === ch.channel_id);
        if (idx >= 0) { S.channels[idx].who_can_post = wcp; S.channels[idx].slow_mode_seconds = slow; }
        if (S.activeChannel) {
          S.activeChannel.who_can_post = wcp; S.activeChannel.slow_mode_seconds = slow;
          const canPost = _chCanPost(S.activeChannel);
          const inpZone = $('input-zone');
          if (inpZone) inpZone.style.display = canPost ? '' : 'none';
        }
      } else toast(res.message || 'Ошибка', 'err');
    };
  }

  // Mute toggle
  const muteBtn = $('ch-set-mute');
  const muteToggle = $('ch-mute-toggle');
  if (muteBtn && muteToggle) {
    muteBtn.onclick = () => {
      const newMuted = !muteToggle.classList.contains('on');
      muteToggle.classList.toggle('on', newMuted);
      _toggleMuteChannel(ch.channel_id, newMuted);
    };
  }

  const membersBtn = $('btn-ch-members');
  if (membersBtn) membersBtn.onclick = () => { closeMod('modal-ch-settings'); showChannelMembers(ch.channel_id); };

  const leaveBtn = $('btn-ch-leave');
  if (leaveBtn) leaveBtn.onclick = () => { closeMod('modal-ch-settings'); _leaveChannel(ch.channel_id); };

  const deleteBtn = $('btn-ch-delete');
  if (deleteBtn) deleteBtn.onclick = () => { closeMod('modal-ch-settings'); _deleteChannel(ch); };
}

/* ══ MUTE / UNMUTE CHANNEL ═════════════════════════════════════ */
async function _toggleMuteChannel(chId, muted) {
  const res = await api('mute_channel', 'POST', { channel_id: chId, muted: muted });
  if (res.ok) {
    if (muted) {
      S.channelMuted[chId] = true;
      toast('Уведомления отключены', 'ok');
    } else {
      delete S.channelMuted[chId];
      toast('Уведомления включены', 'ok');
    }
    // Update channel data
    const idx = S.channels.findIndex(c => c.channel_id === chId);
    if (idx >= 0) S.channels[idx].muted = muted;
    if (S.activeChannel && S.activeChannel.channel_id === chId) S.activeChannel.muted = muted;
    renderChannelsList();
  } else toast(res.message || 'Ошибка', 'err');
}

/* ══ MARK CHANNEL READ ══════════════════════════════════════════ */
async function _markChannelRead(chId) {
  // Reset unread count visually
  const idx = S.channels.findIndex(c => c.channel_id === chId);
  if (idx >= 0) { S.channels[idx].unread_count = 0; renderChannelsList(); }
  toast('Прочитано', 'ok');
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
  // Not in a channel — make sure partner is set for DM
  if (!S.partner) return;
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
// Static modals that exist in index.html — must NOT be removed from DOM
const _staticModals = new Set([
  'modal-partner','modal-verified','modal-team','modal-preview',
  'modal-crop','modal-create','modal-qr'
]);
window.closeMod = function(id) {
  const el = $(id);
  if (el) {
    el.classList.remove('on');
    // Only remove dynamically-created channel modals from DOM
    if (!_staticModals.has(id)) {
      setTimeout(() => el.remove(), 300);
    }
  }
  if (_origCloseMod && id !== 'modal-ch-create' && id !== 'modal-ch-join' && id !== 'modal-ch-settings' && id !== 'modal-ch-members' && id !== 'modal-ch-search') _origCloseMod(id);
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

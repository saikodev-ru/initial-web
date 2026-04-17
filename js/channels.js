/* ══ CHANNELS & HUBS — Хабы и каналы (Telegram-style) ══ */

/* ── State ─────────────────────────────────────────────────────── */
window.S_hubChannels = {
  hubs: [],
  channels: [],
  discover_channels: [],
  discover_hubs: [],
  activeChannelId: null,
  activeHubId: null,
  loaded: false,
};

/* ── API helper ────────────────────────────────────────────────── */
async function chApi(action, method, body) {
  const payload = { action, ...body };
  return await api('channels', method, payload);
}
async function chGet(action, params) {
  const q = new URLSearchParams({ action, ...params }).toString();
  return await api('channels?' + q);
}

/* ── Avatar helper for channels/hubs ───────────────────────────── */
function chAviHtml(name, avatar) {
  if (avatar) return `<img src="${esc(getMediaUrl(avatar))}" alt="" loading="lazy">`;
  const letter = (name || '?')[0]?.toUpperCase() || '?';
  const hue = [...(name || '')].reduce((h, c) => h + c.charCodeAt(0), 0) % 360;
  return `<span style="background:hsl(${hue},50%,45%);color:#fff;width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px;border-radius:inherit">${esc(letter)}</span>`;
}

/* ══════════════════════════════════════════════════════════════════
   LOAD HUBS & CHANNELS LIST
   ══════════════════════════════════════════════════════════════════ */
async function loadHubsChannels() {
  const res = await chGet('list', {});
  if (!res.ok) return;
  S_hubChannels.hubs = res.hubs || [];
  S_hubChannels.channels = res.channels || [];
  S_hubChannels.discover_channels = res.discover_channels || [];
  S_hubChannels.discover_hubs = res.discover_hubs || [];
  S_hubChannels.loaded = true;
  renderServersPanel();
}

/* ══════════════════════════════════════════════════════════════════
   RENDER SERVERS PANEL (Хабы tab in sidebar)
   ══════════════════════════════════════════════════════════════════ */
function renderServersPanel() {
  const panel = document.getElementById('panel-servers');
  if (!panel) return;

  const { hubs, channels, discover_channels, discover_hubs } = S_hubChannels;

  // Standalone channels (not in any hub)
  const standaloneChannels = channels.filter(c => !c.hub_id);
  // Hub channels grouped
  const hubChannelMap = {};
  channels.forEach(c => {
    if (c.hub_id) {
      if (!hubChannelMap[c.hub_id]) hubChannelMap[c.hub_id] = [];
      hubChannelMap[c.hub_id].push(c);
    }
  });

  let html = '<div class="ch-servers-panel">';

  // ── Create button ──
  html += `
    <div class="ch-create-bar">
      <button class="ch-create-btn" onclick="showCreateChannelModal()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 4v16m8-8H4"/></svg>
        <span>Создать канал</span>
      </button>
      <button class="ch-create-btn" onclick="showCreateHubModal()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 4v16m8-8H4"/></svg>
        <span>Создать хаб</span>
      </button>
    </div>`;

  // ── My Channels ──
  if (standaloneChannels.length) {
    html += '<div class="ch-section-label">Мои каналы</div>';
    standaloneChannels.forEach(c => {
      html += makeChannelItem(c);
    });
  }

  // ── My Hubs (with channels inside) ──
  hubs.forEach(h => {
    const hubChs = hubChannelMap[h.id] || [];
    html += `
      <div class="ch-hub-group">
        <div class="ch-hub-header" onclick="toggleHubGroup(this)" data-hub-id="${h.id}">
          <div class="ch-hub-av">${chAviHtml(h.name, h.avatar_url)}</div>
          <div class="ch-hub-info">
            <div class="ch-hub-name">${esc(h.name)}</div>
            <div class="ch-hub-meta">${h.member_count} участников · ${h.channel_count} каналов</div>
          </div>
          <svg class="ch-hub-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
        </div>
        <div class="ch-hub-channels">`;
    if (hubChs.length) {
      hubChs.forEach(c => { html += makeChannelItem(c, true); });
    } else {
      html += '<div class="ch-empty-hint">Нет каналов</div>';
    }
    html += `
          <button class="ch-add-channel-btn" onclick="showCreateChannelModal(${h.id})">+ Добавить канал</button>
        </div>
      </div>`;
  });

  // ── Discover section ──
  if (discover_channels.length || discover_hubs.length) {
    html += '<div class="ch-section-label" style="margin-top:12px">Рекомендации</div>';
    discover_hubs.forEach(h => {
      html += `
        <div class="ch-discover-item" onclick="chJoinHub(${h.id}, '${esc(h.name)}')">
          <div class="ch-hub-av ch-discover-av">${chAviHtml(h.name, h.avatar_url)}</div>
          <div class="ch-hub-info">
            <div class="ch-hub-name">${esc(h.name)}</div>
            <div class="ch-hub-meta">${h.member_count} участников</div>
          </div>
          <button class="ch-join-btn">Вступить</button>
        </div>`;
    });
    discover_channels.forEach(c => {
      html += `
        <div class="ch-discover-item" onclick="chSubscribe(${c.id}, '${esc(c.name)}')">
          <div class="ch-ch-av ch-discover-av">${chAviHtml(c.name, c.avatar_url)}</div>
          <div class="ch-hub-info">
            <div class="ch-hub-name">${esc(c.name)}</div>
            <div class="ch-hub-meta">${c.subscriber_count} подписчиков</div>
          </div>
          <button class="ch-join-btn">Подписаться</button>
        </div>`;
    });
  }

  // ── Empty state ──
  if (!hubs.length && !channels.length && !discover_channels.length && !discover_hubs.length) {
    html += `
      <div class="ch-empty-state">
        <div style="font-size:48px;margin-bottom:16px;opacity:.3">📢</div>
        <div style="font-size:16px;font-weight:700;color:var(--t2);margin-bottom:8px">Хабы и каналы</div>
        <div style="font-size:13px;max-width:240px;color:var(--t3)">Создайте канал или хаб, чтобы начать общение</div>
      </div>`;
  }

  html += '</div>';
  panel.innerHTML = html;
}

function makeChannelItem(c, inHub = false) {
  const lastMsg = c.last_message ? (c.last_message.length > 40 ? c.last_message.slice(0, 40) + '…' : c.last_message) : '';
  const lastTime = c.last_time ? fmtChatTime(c.last_time) : '';
  const unread = c.unread_count > 0 ? `<span class="badge">${c.unread_count}</span>` : '';
  return `
    <div class="ch-channel-item${inHub ? ' ch-in-hub' : ''}" onclick="openChannelChat(${c.id})">
      <div class="ch-ch-av">${chAviHtml(c.name, c.avatar_url)}</div>
      <div class="ch-ch-info">
        <div class="ch-ch-row">
          <span class="ch-ch-name">${esc(c.name)}</span>
          ${lastTime ? `<span class="ch-ch-time">${lastTime}</span>` : ''}
        </div>
        <div class="ch-ch-prev">
          <span>${lastMsg || (c.subscriber_count + ' подписчиков')}</span>
          ${unread}
        </div>
      </div>
    </div>`;
}

/* ── Toggle hub group expand/collapse ── */
function toggleHubGroup(header) {
  const channels = header.nextElementSibling;
  const chevron = header.querySelector('.ch-hub-chevron');
  const isCollapsed = channels.style.display === 'none';
  channels.style.display = isCollapsed ? '' : 'none';
  chevron.style.transform = isCollapsed ? '' : 'rotate(-90deg)';
}

/* ══════════════════════════════════════════════════════════════════
   OPEN CHANNEL CHAT (like openChat but for channels)
   ══════════════════════════════════════════════════════════════════ */
let _chChatLoading = false;

async function openChannelChat(channelId) {
  if (_chChatLoading) return;
  _chChatLoading = true;
  S_hubChannels.activeChannelId = channelId;

  try {
    // Get channel info
    const info = await chGet('get_channel', { channel_id: channelId });
    if (!info.ok) { toast(info.message || 'Ошибка загрузки канала', 'err'); return; }
    const ch = info.channel;

    // Set up the chat area like a regular chat
    S.chatId = 'ch_' + channelId; // special prefix to identify channel chats
    S.partner = {
      chat_id: 'ch_' + channelId,
      channel_id: channelId,
      partner_name: ch.name,
      partner_signal_id: ch.signal_id ? '@' + ch.signal_id : '',
      partner_avatar: ch.avatar_url,
      partner_bio: ch.description,
      is_channel: true,
      is_admin: ch.is_admin,
      subscriber_count: ch.subscriber_count,
      is_subscribed: ch.is_subscribed,
    };
    S.replyTo = null;
    exitSelectMode();

    // Hide sidebar on mobile
    if (__isMobileView()) {
      $('sidebar').classList.add('hidden');
      requestAnimationFrame(() => $('active-chat').classList.add('mb-visible'));
      history.pushState({ chat: S.chatId }, '', '');
      const mbNav = document.getElementById('mobile-bottom-nav');
      if (mbNav) mbNav.classList.add('hidden');
    }

    // Update chat header
    updateHeaderUI(S.partner, ch.name);
    const hdrSt = $('hdr-st');
    if (hdrSt) {
      hdrSt.textContent = ch.subscriber_count + ' подписчиков';
      hdrSt.className = 'hdr-st';
    }

    // Input zone — only admins can type
    const inpZone = $('input-zone');
    const mutePill = document.getElementById('system-mute-pill');
    if (mutePill) mutePill.remove();

    if (ch.is_admin) {
      inpZone.style.display = '';
    } else {
      // Show "subscribe" or "view only" pill
      if (!ch.is_subscribed) {
        let pill = document.createElement('div');
        pill.id = 'system-mute-pill';
        pill.className = 'system-mute-zone';
        pill.innerHTML = `<button class="mute-zone-btn" onclick="chSubscribe(${channelId}, '${esc(ch.name)}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v16m8-8H4"/></svg>
          Подписаться
        </button>`;
        inpZone.parentElement.insertBefore(pill, inpZone);
      } else {
        let pill = document.createElement('div');
        pill.id = 'system-mute-pill';
        pill.className = 'system-mute-zone';
        pill.innerHTML = `<div class="mute-zone-btn" style="cursor:default;opacity:.6">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          Только чтение
        </div>`;
        inpZone.parentElement.insertBefore(pill, inpZone);
      }
      inpZone.style.display = 'none';
    }

    $('chat-welcome').style.display = 'none';
    $('active-chat').style.display = 'flex';

    // Animate chat switch
    const ac = $('active-chat');
    ac.classList.remove('chat-switch');
    void ac.offsetWidth;
    ac.classList.add('chat-switch');

    // Load messages
    $('msgs').innerHTML = '';
    S.msgs[S.chatId] = [];
    S.lastId[S.chatId] = 0;

    const res = await chGet('get_messages', { channel_id: channelId, init: 1, limit: 50 });
    if (!res.ok) { toast(res.message || 'Ошибка загрузки', 'err'); return; }

    const msgs = res.messages || [];
    msgs.forEach(m => {
      if (m.media_url) m.media_url = getMediaUrl(m.media_url);
      S.rxns[m.id] = m.reactions || [];
    });
    S.msgs[S.chatId] = msgs;
    if (msgs.length) {
      S.lastId[S.chatId] = msgs.reduce((mx, m) => Math.max(mx, +m.id), 0);
    }
    renderMsgs(S.chatId);
    scrollBot();

    // Start SSE for channel (reuse existing polling)
    if (S.sse) stopSSE();
    startChannelPoll(channelId);

  } finally {
    _chChatLoading = false;
  }
}

/* ── Channel-specific polling ── */
let _chPollInterval = null;

function startChannelPoll(channelId) {
  clearInterval(_chPollInterval);
  _chPollInterval = setInterval(async () => {
    if (!S_hubChannels.activeChannelId || S_hubChannels.activeChannelId !== channelId) {
      clearInterval(_chPollInterval);
      return;
    }
    const chatKey = 'ch_' + channelId;
    const afterId = S.lastId[chatKey] || 0;
    const res = await chGet('get_messages', { channel_id: channelId, after_id: afterId, limit: 50 });
    if (!res.ok || !res.messages || !res.messages.length) return;

    const newMsgs = res.messages.filter(m => {
      if (m.media_url) m.media_url = getMediaUrl(m.media_url);
      S.rxns[m.id] = m.reactions || [];
      return !S.msgs[chatKey]?.some(x => x.id === m.id);
    });
    if (!newMsgs.length) return;

    newMsgs.forEach(m => {
      S.msgs[chatKey].push(m);
      S.lastId[chatKey] = Math.max(S.lastId[chatKey] || 0, +m.id);
      if (chatKey === S.chatId) {
        const atBot = nearBot();
        appendMsg(chatKey, m);
        if (atBot) scrollBot();
        else showSBBtn(1);
      }
    });
  }, 3000);
}

function stopChannelPoll() {
  clearInterval(_chPollInterval);
  _chPollInterval = null;
  S_hubChannels.activeChannelId = null;
}

/* ══════════════════════════════════════════════════════════════════
   SUBSCRIBE / JOIN
   ══════════════════════════════════════════════════════════════════ */
async function chSubscribe(channelId, name) {
  const res = await chApi('subscribe', 'POST', { channel_id: channelId });
  if (res.ok) {
    toast('Вы подписались на ' + name, 'ok');
    loadHubsChannels();
  } else {
    toast(res.message || 'Ошибка', 'err');
  }
}

async function chJoinHub(hubId, name) {
  const res = await chApi('join_hub', 'POST', { hub_id: hubId });
  if (res.ok) {
    toast('Вы вступили в хаб ' + name, 'ok');
    loadHubsChannels();
  } else {
    toast(res.message || 'Ошибка', 'err');
  }
}

/* ══════════════════════════════════════════════════════════════════
   CREATE CHANNEL / HUB MODALS
   ══════════════════════════════════════════════════════════════════ */
function showCreateChannelModal(hubId) {
  // Reuse the existing modal-create, switch to channel tab
  openMod('modal-create');
  // Switch to channel tab
  document.querySelectorAll('.cm-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.cm-tab-content').forEach(t => t.classList.remove('active'));
  const chTab = document.querySelector('.cm-tab[data-tab="cm-tab-channel"]');
  const chContent = document.getElementById('cm-tab-channel');
  if (chTab) chTab.classList.add('active');
  if (chContent) chContent.classList.add('active');

  // Replace placeholder with actual form
  chContent.innerHTML = `
    <div class="ch-create-form">
      <div class="ch-form-group">
        <label class="ch-form-label">Название канала</label>
        <input type="text" id="ch-name" class="ch-form-input" placeholder="Мой канал" maxlength="100" autocomplete="off">
      </div>
      <div class="ch-form-group">
        <label class="ch-form-label">Описание</label>
        <textarea id="ch-desc" class="ch-form-input" placeholder="О чём этот канал…" maxlength="500" rows="2"></textarea>
      </div>
      <div class="ch-form-group">
        <label class="ch-form-label">Signal ID (необязательно)</label>
        <input type="text" id="ch-sid" class="ch-form-input" placeholder="@my_channel" maxlength="50" autocomplete="off">
      </div>
      ${hubId ? `<input type="hidden" id="ch-hub-id" value="${hubId}">` : ''}
      <div class="ch-form-group ch-form-row">
        <label class="ch-form-label">Публичный канал</label>
        <label class="ch-toggle">
          <input type="checkbox" id="ch-public" checked>
          <span class="ch-toggle-slider"></span>
        </label>
      </div>
      <button class="ch-form-submit" onclick="submitCreateChannel()">Создать канал</button>
    </div>`;
}

function showCreateHubModal() {
  openMod('modal-create');
  document.querySelectorAll('.cm-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.cm-tab-content').forEach(t => t.classList.remove('active'));
  const hubTab = document.querySelector('.cm-tab[data-tab="cm-tab-server"]');
  const hubContent = document.getElementById('cm-tab-server');
  if (hubTab) hubTab.classList.add('active');
  if (hubContent) hubContent.classList.add('active');

  hubContent.innerHTML = `
    <div class="ch-create-form">
      <div class="ch-form-group">
        <label class="ch-form-label">Название хаба</label>
        <input type="text" id="hub-name" class="ch-form-input" placeholder="Мой хаб" maxlength="100" autocomplete="off">
      </div>
      <div class="ch-form-group">
        <label class="ch-form-label">Описание</label>
        <textarea id="hub-desc" class="ch-form-input" placeholder="О чём этот хаб…" maxlength="500" rows="2"></textarea>
      </div>
      <div class="ch-form-group">
        <label class="ch-form-label">Signal ID (необязательно)</label>
        <input type="text" id="hub-sid" class="ch-form-input" placeholder="@my_hub" maxlength="50" autocomplete="off">
      </div>
      <div class="ch-form-group ch-form-row">
        <label class="ch-form-label">Публичный хаб</label>
        <label class="ch-toggle">
          <input type="checkbox" id="hub-public" checked>
          <span class="ch-toggle-slider"></span>
        </label>
      </div>
      <button class="ch-form-submit" onclick="submitCreateHub()">Создать хаб</button>
    </div>`;
}

async function submitCreateChannel() {
  const name = $('ch-name')?.value?.trim();
  const desc = $('ch-desc')?.value?.trim() || '';
  const sid = $('ch-sid')?.value?.trim() || '';
  const isPublic = $('ch-public')?.checked ? 1 : 0;
  const hubId = $('ch-hub-id')?.value ? parseInt($('ch-hub-id').value) : null;

  if (!name || name.length < 2) { toast('Название — минимум 2 символа', 'err'); return; }

  const res = await chApi('create_channel', 'POST', { name, description: desc, signal_id: sid, is_public: isPublic, hub_id: hubId });
  if (res.ok) {
    toast('Канал «' + name + '» создан!', 'ok');
    closeMod('modal-create');
    loadHubsChannels();
  } else {
    toast(res.message || 'Ошибка создания канала', 'err');
  }
}

async function submitCreateHub() {
  const name = $('hub-name')?.value?.trim();
  const desc = $('hub-desc')?.value?.trim() || '';
  const sid = $('hub-sid')?.value?.trim() || '';
  const isPublic = $('hub-public')?.checked ? 1 : 0;

  if (!name || name.length < 2) { toast('Название — минимум 2 символа', 'err'); return; }

  const res = await chApi('create_hub', 'POST', { name, description: desc, signal_id: sid, is_public: isPublic });
  if (res.ok) {
    toast('Хаб «' + name + '» создан!', 'ok');
    closeMod('modal-create');
    loadHubsChannels();
  } else {
    toast(res.message || 'Ошибка создания хаба', 'err');
  }
}

/* ══════════════════════════════════════════════════════════════════
   SEND MESSAGE TO CHANNEL (override for channel context)
   ══════════════════════════════════════════════════════════════════ */
async function sendChannelMessage(body, channelId) {
  const payload = { action: 'send_message', channel_id: channelId, body };
  const replyId = S.replyTo?.id;
  if (replyId) payload.reply_to = replyId;

  const res = await api('channels', 'POST', payload);
  return res;
}

/* ══════════════════════════════════════════════════════════════════
   HOOK INTO EXISTING SEND MESSAGE FLOW
   ══════════════════════════════════════════════════════════════════ */
// We intercept the send button to detect channel context
(function hookSendForChannels() {
  const origSend = window._origSendMsg || window.sendMsg;
  if (window._channelSendHooked) return;
  window._channelSendHooked = true;

  // Store original
  window._origSendMsg = origSend;

  // Override: check if current chat is a channel
  window.sendMsg = async function(body) {
    if (S.partner?.is_channel && S.partner?.channel_id) {
      // Channel message sending
      const channelId = S.partner.channel_id;
      const chatKey = S.chatId;
      const replyId = S.replyTo?.id || null;

      // Optimistic bubble
      const tid = 'tch' + Date.now();
      const tmp = {
        id: tid,
        sender_id: S.user.id,
        body: body,
        sent_at: Math.floor(Date.now() / 1000),
        is_read: 0, is_edited: 0,
        nickname: S.user.nickname,
        avatar_url: S.user.avatar_url,
        reply_to: replyId,
        reactions: [],
        views_count: 0,
      };
      S.msgs[chatKey] = S.msgs[chatKey] || [];
      S.msgs[chatKey].push(tmp);
      S.rxns[tid] = [];
      appendMsg(chatKey, tmp);
      scrollBot();

      if (S.replyTo) { S.replyTo = null; hideRbar(); }

      const res = await sendChannelMessage(body, channelId);

      if (res.ok) {
        // Promote temp → real
        if (S.msgs[chatKey]) {
          const idx = S.msgs[chatKey].findIndex(m => m.id === tid);
          if (idx >= 0) {
            S.msgs[chatKey][idx].id = res.message_id;
            S.msgs[chatKey][idx].sent_at = res.sent_at;
          }
        }
        S.rxns[res.message_id] = S.rxns[tid] || [];
        delete S.rxns[tid];
        S.lastId[chatKey] = Math.max(S.lastId[chatKey] || 0, res.message_id);

        // Patch DOM
        const rowEl = document.querySelector(`.mrow[data-id="${tid}"]`);
        if (rowEl) {
          rowEl.dataset.id = res.message_id;
          const sentMsg = S.msgs[chatKey]?.find(m => m.id === res.message_id);
          if (sentMsg) patchMsgDom(sentMsg);
        }
      } else {
        toast(res.message || 'Ошибка отправки', 'err');
        // Remove optimistic bubble
        const idx = S.msgs[chatKey]?.findIndex(m => m.id === tid);
        if (idx >= 0) S.msgs[chatKey].splice(idx, 1);
        const rowEl = document.querySelector(`.mrow[data-id="${tid}"]`);
        if (rowEl) rowEl.remove();
      }
    } else {
      // Regular DM — use original
      return origSend.call(this, body);
    }
  };
})();

/* ══════════════════════════════════════════════════════════════════
   HOOK INTO CHAT HEADER CLICK (channel info instead of partner modal)
   ══════════════════════════════════════════════════════════════════ */
(function hookHeaderForChannels() {
  const hdrClick = $('hdr-clickable');
  if (!hdrClick || window._channelHdrHooked) return;
  window._channelHdrHooked = true;

  const origOnclick = hdrClick.onclick;
  hdrClick.onclick = () => {
    if (S.partner?.is_channel) {
      // Show channel info panel
      openChannelInfo();
    } else {
      origOnclick?.call(hdrClick);
    }
  };
})();

async function openChannelInfo() {
  if (!S.partner?.channel_id) return;
  const chId = S.partner.channel_id;
  const res = await chGet('get_channel', { channel_id: chId });
  if (!res.ok) return;
  const ch = res.channel;

  // Reuse partner modal
  const aviEl = $('pm-hero-avi');
  if (aviEl) aviEl.innerHTML = chAviHtml(ch.name, ch.avatar_url);
  applyBlurredAvatarBg('pm-hero-bg', ch.name, ch.avatar_url);

  const nameEl = $('pm-partner-name');
  if (nameEl) { nameEl.textContent = ch.name; wtn(nameEl); }

  const vBadge = $('pm-verified-badge');
  const tBadge = $('pm-team-badge');
  if (vBadge) vBadge.style.display = 'none';
  if (tBadge) tBadge.style.display = 'none';

  const pill = $('pm-partner-status');
  const pillTxt = $('pm-partner-status-text');
  if (pill && pillTxt) {
    pill.className = 'pm-status-pill';
    pillTxt.textContent = ch.subscriber_count + ' подписчиков';
  }

  const rowSid = $('pm-row-sid');
  const valSid = $('pm-info-sid-val');
  const rowBio = $('pm-row-bio');
  const valBio = $('pm-info-bio-val');
  const sep = $('pm-info-sep');
  const infoSec = $('pm-info-section');

  if (rowSid && valSid) {
    if (ch.signal_id) {
      rowSid.style.display = 'flex';
      valSid.textContent = '@' + ch.signal_id;
      rowSid.onclick = () => navigator.clipboard.writeText('@' + ch.signal_id).then(() => toast('ID скопирован', 'ok'));
    } else { rowSid.style.display = 'none'; }
  }
  if (rowBio && valBio) {
    if (ch.description) {
      rowBio.style.display = 'flex';
      valBio.innerHTML = fmtText(ch.description);
      wtn(valBio);
    } else { rowBio.style.display = 'none'; }
  }
  if (sep) sep.style.display = (ch.signal_id && ch.description) ? 'block' : 'none';
  if (infoSec) infoSec.style.display = (ch.signal_id || ch.description) ? 'flex' : 'none';

  // Action buttons
  const actsRow = $('pm-actions-row');
  const btnMsg = $('pm-btn-message');
  const btnMute = $('pm-btn-mute');
  const btnCall = $('pm-btn-call');
  const btnVideo = $('pm-btn-video');
  const dangerRow = $('pm-danger-actions');

  if (actsRow) actsRow.style.display = 'flex';
  if (btnMsg) btnMsg.style.display = 'none';
  if (btnCall) btnCall.style.display = 'none';
  if (btnVideo) btnVideo.style.display = 'none';
  if (dangerRow) dangerRow.style.display = 'none';

  if (btnMute) {
    if (ch.is_admin) {
      btnMute.style.display = 'none';
    } else if (ch.is_subscribed) {
      btnMute.style.display = 'flex';
      const muteTxt = $('pm-mute-txt');
      const muteIc = btnMute.querySelector('.pm-act-ic');
      btnMute.classList.remove('muted');
      if (muteTxt) muteTxt.textContent = 'Отписаться';
      if (muteIc) muteIc.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';
      btnMute.onclick = async () => {
        const res = await chApi('unsubscribe', 'POST', { channel_id: chId });
        if (res.ok) {
          toast('Вы отписались от канала', 'ok');
          closeMod('modal-partner');
          loadHubsChannels();
        } else toast(res.message || 'Ошибка', 'err');
      };
    } else {
      btnMute.style.display = 'flex';
      const muteTxt = $('pm-mute-txt');
      const muteIc = btnMute.querySelector('.pm-act-ic');
      btnMute.classList.remove('muted');
      if (muteTxt) muteTxt.textContent = 'Подписаться';
      if (muteIc) muteIc.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v16m8-8H4"/></svg>';
      btnMute.onclick = async () => {
        const res = await chApi('subscribe', 'POST', { channel_id: chId });
        if (res.ok) {
          toast('Вы подписались!', 'ok');
          closeMod('modal-partner');
          loadHubsChannels();
          openChannelChat(chId);
        } else toast(res.message || 'Ошибка', 'err');
      };
    }
  }

  openMod('modal-partner');
}

/* ══════════════════════════════════════════════════════════════════
   HOOK INTO BACK NAVIGATION (handle channel chat on mobile)
   ══════════════════════════════════════════════════════════════════ */
(function hookBackForChannels() {
  if (window._channelBackHooked) return;
  window._channelBackHooked = true;

  const origPopstate = window.onpopstate;
  window.addEventListener('popstate', () => {
    if (S.partner?.is_channel) {
      // Close channel chat
      stopChannelPoll();
      if (__isMobileView()) {
        $('active-chat').classList.remove('mb-visible');
        $('sidebar').classList.remove('hidden');
        const mbNav = document.getElementById('mobile-bottom-nav');
        if (mbNav) mbNav.classList.remove('hidden');
      }
      S.chatId = null;
      S.partner = null;
    }
  });
})();

/* ══════════════════════════════════════════════════════════════════
   AUTO-LOAD ON NAV SWITCH
   ══════════════════════════════════════════════════════════════════ */
// Hook into _switchNav to load channels when "servers" tab is selected
(function hookNavForChannels() {
  if (window._channelNavHooked) return;
  window._channelNavHooked = true;

  const origSwitch = window._switchNav;
  window._switchNav = function(nav) {
    origSwitch.call(this, nav);
    if (nav === 'servers') {
      if (!S_hubChannels.loaded) {
        loadHubsChannels();
      } else {
        renderServersPanel();
      }
    }
  };
})();

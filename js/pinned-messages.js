'use strict';
/* ══ PINNED MESSAGES — Telegram-style multi-pin with dot indicators and list screen ══ */

S.pinnedMsgs = [];   // Array of pinned messages per current chat (DESC: newest first)
S.pinIndex  = 0;     // Current visible index (0 = newest)

/* ── Show skeleton loading state on the pin bar ── */
function showPinBarSkeleton() {
  const bar = $('pin-bar');
  if (!bar) return;
  // Immediately hide previous content, show skeleton
  bar.classList.remove('visible');
  // Don't hide display — keep it visible for skeleton
  const inner = bar.querySelector('.pin-bar-inner');
  if (!inner) return;
  // Swap content to skeleton
  const content = $('pin-bar-content');
  const dots = $('pin-dots');
  const btn = $('pin-bar-list-btn');
  if (content) content.style.display = 'none';
  if (dots) dots.style.display = 'none';
  if (btn) btn.style.display = 'none';
  // Remove old skeleton if any
  const oldSkel = inner.querySelector('.pin-skel-wrap');
  if (oldSkel) oldSkel.remove();
  // Create skeleton elements matching real pin-bar layout:
  // [dots (left)] [content (flex:1)] [list-btn (right)]
  const skelWrap = document.createElement('div');
  skelWrap.className = 'pin-skel-wrap';
  skelWrap.innerHTML =
    '<div class="pin-skel-dots"><div class="pin-skel-dot active"></div><div class="pin-skel-dot"></div></div>' +
    '<div class="pin-skel-content"><div class="pin-skel-author"></div><div class="pin-skel-text"></div></div>' +
    '<div class="pin-skel-btn"></div>';
  inner.appendChild(skelWrap);
  bar.style.display = '';
  // Force reflow then add skeleton class for transition
  void bar.offsetWidth;
  bar.classList.add('skel-loading');
}

/* ── Hide skeleton, restore normal content ── */
function hidePinBarSkeleton() {
  const bar = $('pin-bar');
  if (!bar) return;
  bar.classList.remove('skel-loading');
  const inner = bar.querySelector('.pin-bar-inner');
  if (!inner) return;
  // Remove skeleton elements
  const skel = inner.querySelector('.pin-skel-wrap');
  if (skel) skel.remove();
  // Restore visibility of normal elements
  const content = $('pin-bar-content');
  const dots = $('pin-dots');
  const btn = $('pin-bar-list-btn');
  if (content) content.style.display = '';
  if (dots) dots.style.display = '';
  if (btn) btn.style.display = '';
}

/* ── Fetch pinned messages for a chat (supports both single and array APIs) ── */
async function fetchPinnedMsgs(chatId) {
  try {
    // Try array endpoint first
    let res = await api('get_pinned_messages?chat_id=' + chatId);
    if (res.ok && Array.isArray(res.pinned)) {
      S.pinnedMsgs = res.pinned;
    } else {
      // Fallback to single message endpoint
      res = await api('get_pinned_message?chat_id=' + chatId);
      if (res.ok && res.pinned) {
        S.pinnedMsgs = Array.isArray(res.pinned) ? res.pinned : [res.pinned];
      } else {
        S.pinnedMsgs = [];
      }
    }
    // Sort DESC: newest pinned message first (Telegram behavior)
    S.pinnedMsgs.sort((a, b) => {
      const ta = a.sent_at || a.created_at || 0;
      const tb = b.sent_at || b.created_at || 0;
      return tb - ta;
    });
    // Default to most recently pinned (first in DESC array)
    S.pinIndex = 0;
    hidePinBarSkeleton();
    updatePinBar();
  } catch {
    S.pinnedMsgs = [];
    hidePinBarSkeleton();
    updatePinBar();
  }
}

/* Backwards-compatible alias */
function fetchPinnedMsg(chatId) { return fetchPinnedMsgs(chatId); }

/* ── Reset pin bar for chat switch — show skeleton immediately ── */
function resetPinBarForChatSwitch() {
  S.pinnedMsgs = [];
  S.pinIndex = 0;
  // Hide current pin bar content without animation delay
  const bar = $('pin-bar');
  if (!bar) return;
  bar.classList.remove('visible');
  // Show skeleton after a tiny delay so the hide transition doesn't conflict
  setTimeout(() => showPinBarSkeleton(), 50);
}

/* ── Toggle pin for a specific message ── */
async function togglePinMessage(m) {
  const isPinned = S.pinnedMsgs.some(p => p.message_id == m.id);
  if (isPinned) {
    const pinned = S.pinnedMsgs.find(p => p.message_id == m.id);
    const forAll = pinned ? pinned.pinned_for_all : 0;
    const label = forAll ? 'для всех' : 'для вас';
    showConfirm('Открепить сообщение?', 'Сообщение будет откреплено ' + label + '.', async () => {
      const res = await api('pin_message', 'POST', {
        chat_id: S.chatId,
        message_id: m.id,
        unpin: true,
        pinned_for_all: forAll || 0
      });
      if (res.ok) {
        S.pinnedMsgs = S.pinnedMsgs.filter(p => p.message_id != m.id);
        if (S.pinIndex >= S.pinnedMsgs.length) S.pinIndex = Math.max(0, S.pinnedMsgs.length - 1);
        updatePinBar();
        toast('Сообщение откреплено');
      } else {
        toast(res.message || 'Ошибка', 'err');
      }
    });
    return;
  }

  // Not pinned — pin for all by default (Telegram behavior)
  doPinMessage(m, 1);
}

async function doPinMessage(m, pinnedForAll) {
  const res = await api('pin_message', 'POST', {
    chat_id: S.chatId,
    message_id: m.id,
    pinned_for_all: pinnedForAll
  });
  if (res.ok) {
    await fetchPinnedMsgs(S.chatId);
    toast(pinnedForAll ? 'Сообщение закреплено' : 'Сообщение закреплено для вас');
  } else {
    toast(res.message || 'Ошибка', 'err');
  }
}

/* ── Update the pin bar visibility and content ── */
function updatePinBar() {
  const bar = $('pin-bar');
  if (!bar) return;

  if (!S.pinnedMsgs || !S.pinnedMsgs.length) {
    hidePinBarSkeleton();
    bar.classList.remove('visible');
    setTimeout(() => { if (!S.pinnedMsgs || !S.pinnedMsgs.length) bar.style.display = 'none'; }, 300);
    // Notify that pin bar height changed (for sticky date pill)
    _notifyPinBarHeight();
    return;
  }

  // Clamp index
  if (S.pinIndex < 0) S.pinIndex = 0;
  if (S.pinIndex >= S.pinnedMsgs.length) S.pinIndex = S.pinnedMsgs.length - 1;

  const p = S.pinnedMsgs[S.pinIndex];
  bar.style.display = '';

  // Author nickname
  const author = $('pin-bar-author');
  if (author) {
    author.textContent = p.pinned_for_all ? (p.sender_name || 'Пользователь') : 'Закреплено для вас';
  }

  // Message preview
  const text = $('pin-bar-text');
  if (text) {
    let preview = p.body || (p.media_type === 'video' ? 'Видео' : p.media_type === 'photo' ? 'Фото' : p.media_type === 'voice' ? 'Голосовое сообщение' : 'Медиафайл');
    preview = preview.replace(/\*\*/g, '').replace(/\|\|/g, '').replace(/\[.*?\]\(.*?\)/g, '').trim();
    if (preview.length > 60) preview = preview.slice(0, 60) + '…';
    text.textContent = preview || 'Медиафайл';
  }

  // Render dot indicators
  _renderPinDots();

  // Animate in
  requestAnimationFrame(() => bar.classList.add('visible'));

  // Notify height change after transition
  setTimeout(() => _notifyPinBarHeight(), 350);
}

/* ── Render dot indicators ── */
function _renderPinDots() {
  const dotsEl = $('pin-dots');
  if (!dotsEl) return;

  const count = S.pinnedMsgs.length;
  if (!count) { dotsEl.style.display = 'none'; return; }
  dotsEl.style.display = 'flex';

  // Only rebuild dots if count changed
  const prevCount = dotsEl.children.length;
  if (prevCount !== count) {
    dotsEl.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const dot = document.createElement('span');
      dot.className = 'pin-dot';
      dot.dataset.index = i;
      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        S.pinIndex = i;
        updatePinBar();
      });
      dotsEl.appendChild(dot);
    }
  }
  // Update active state only
  for (let i = 0; i < count; i++) {
    dotsEl.children[i].classList.toggle('active', i === S.pinIndex);
  }
}

/* ── Navigate between pinned messages (DESC order: 0=newest, N-1=oldest) ── */
function _pinNavPrev() {
  if (S.pinnedMsgs.length < 2) return;
  S.pinIndex = Math.max(0, S.pinIndex - 1); // → newer (lower index)
  updatePinBar();
}

function _pinNavNext() {
  if (S.pinnedMsgs.length < 2) return;
  S.pinIndex = Math.min(S.pinnedMsgs.length - 1, S.pinIndex + 1); // → older (higher index)
  updatePinBar();
}

/* ── Touch swipe on pin bar to navigate ── */
function _initPinSwipe() {
  const bar = $('pin-bar');
  if (!bar) return;
  const inner = bar.querySelector('.pin-bar-inner');
  if (!inner) return;

  let startX = 0, startY = 0, swiping = false;

  inner.addEventListener('touchstart', (e) => {
    if (S.pinnedMsgs.length < 2) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    swiping = false;
  }, { passive: true });

  inner.addEventListener('touchmove', (e) => {
    if (S.pinnedMsgs.length < 2) return;
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 15) {
      swiping = true;
    }
  }, { passive: true });

  inner.addEventListener('touchend', (e) => {
    if (!swiping || S.pinnedMsgs.length < 2) return;
    const dx = e.changedTouches[0].clientX - startX;
    if (dx < -40) _pinNavNext();      // swipe left → show next in list (older, higher index)
    else if (dx > 40) _pinNavPrev();   // swipe right → show prev in list (newer, lower index)
  }, { passive: true });
}

/* ── Notify sticky date pill about pin bar height change ── */
function _notifyPinBarHeight() {
  if (window._positionPill) {
    // Delay to let CSS transitions settle
    requestAnimationFrame(() => window._positionPill());
  }
}

/* ── Get current pin bar height (for sticky date pill positioning) ── */
function getPinBarHeight() {
  const bar = $('pin-bar');
  if (!bar || bar.style.display === 'none') return 0;
  if (!bar.classList.contains('visible')) return 0;
  return bar.offsetHeight;
}

/* ── Pinned messages list screen ── */
function openPinListScreen() {
  const screen = $('pin-list-screen');
  if (!screen) return;

  const body = $('pin-list-body');
  if (!body) return;

  // Clear and populate
  body.innerHTML = '';

  if (!S.pinnedMsgs.length) {
    body.innerHTML = '<div class="pin-list-empty">Нет закрепленных сообщений</div>';
    screen.style.display = 'flex';
    screen.classList.add('visible');
    return;
  }

  // Render messages — already DESC (newest first), no reverse needed
  S.pinnedMsgs.forEach((p, i) => {
    const item = document.createElement('div');
    item.className = 'pin-list-item';
    item.dataset.msgId = p.message_id;

    // Avatar — use getMediaUrl() for proper S3 URL construction
    const avUrl = p.sender_avatar ? getMediaUrl(p.sender_avatar) : null;
    const avInitial = esc((p.sender_name || '?')[0]);
    const avHtml = avUrl
      ? '<div class="pin-list-av"><img src="' + esc(avUrl) + '" alt="" onerror="this.style.display=\'none\';this.parentNode.classList.add(\'pin-list-av-placeholder\');this.parentNode.textContent=\'' + avInitial + '\';"></div>'
      : '<div class="pin-list-av pin-list-av-placeholder">' + avInitial + '</div>';

    // Message body preview
    let bodyText = p.body || (p.media_type === 'video' ? 'Видео' : p.media_type === 'photo' ? 'Фото' : p.media_type === 'voice' ? 'Голосовое сообщение' : 'Медиафайл');
    bodyText = bodyText.replace(/\*\*/g, '').replace(/\|\|/g, '').replace(/\[.*?\]\(.*?\)/g, '').trim();
    if (bodyText.length > 120) bodyText = bodyText.slice(0, 120) + '…';

    // Time
    const time = p.sent_at ? fmtPinTime(p.sent_at) : '';

    item.innerHTML =
      avHtml +
      '<div class="pin-list-item-body">' +
        '<div class="pin-list-item-name">' + esc(p.sender_name || 'Пользователь') + '</div>' +
        '<div class="pin-list-item-text">' + esc(bodyText) + '</div>' +
      '</div>' +
      '<div class="pin-list-item-right">' +
        '<span class="pin-list-item-time">' + time + '</span>' +
        '<button class="pin-list-item-unpin" data-msg-id="' + p.message_id + '" title="Открепить">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
        '</button>' +
      '</div>';

    // Click to scroll to message in chat
    item.addEventListener('click', (e) => {
      if (e.target.closest('.pin-list-item-unpin')) return;
      closePinListScreen();
      const row = document.querySelector('.mrow[data-id="' + p.message_id + '"]');
      if (row) {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        row.style.transition = 'background .2s ease';
        row.style.background = 'rgba(var(--y-rgb, 139,92,246),.12)';
        setTimeout(() => { row.style.background = ''; }, 1200);
      }
    });

    // Unpin button
    const unpinBtn = item.querySelector('.pin-list-item-unpin');
    if (unpinBtn) {
      unpinBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const msgId = unpinBtn.dataset.msgId;
        const pinned = S.pinnedMsgs.find(pp => pp.message_id == msgId);
        const forAll = pinned ? pinned.pinned_for_all : 0;
        api('pin_message', 'POST', {
          chat_id: S.chatId,
          message_id: msgId,
          unpin: true,
          pinned_for_all: forAll || 0
        }).then(res => {
          if (res.ok) {
            S.pinnedMsgs = S.pinnedMsgs.filter(pp => pp.message_id != msgId);
            if (S.pinIndex >= S.pinnedMsgs.length) S.pinIndex = Math.max(0, S.pinnedMsgs.length - 1);
            updatePinBar();
            // Remove item from list with animation
            item.style.transition = 'opacity .2s ease, transform .2s ease';
            item.style.opacity = '0';
            item.style.transform = 'translateX(40px)';
            setTimeout(() => {
              item.remove();
              if (!S.pinnedMsgs.length) {
                body.innerHTML = '<div class="pin-list-empty">Нет закрепленных сообщений</div>';
                const unpinAllBtn = $('pin-list-unpin-all');
                if (unpinAllBtn) unpinAllBtn.style.display = 'none';
              }
            }, 220);
            toast('Сообщение откреплено');
          }
        });
      });
    }

    body.appendChild(item);
  });

  // Show/hide unpin all button
  const unpinAllBtn = $('pin-list-unpin-all');
  if (unpinAllBtn) {
    unpinAllBtn.style.display = S.pinnedMsgs.length > 1 ? '' : 'none';
  }

  // Update count badge
  const countEl = $('pin-list-count');
  if (countEl) {
    countEl.textContent = S.pinnedMsgs.length ? S.pinnedMsgs.length : '';
  }

  screen.style.display = 'flex';
  requestAnimationFrame(() => screen.classList.add('visible'));
}

function closePinListScreen() {
  const screen = $('pin-list-screen');
  if (!screen) return;
  screen.classList.remove('visible');
  setTimeout(() => { screen.style.display = 'none'; }, 300);
}

/* ── Unpin all messages ── */
function unpinAllMessages() {
  if (!S.pinnedMsgs.length) return;
  showConfirm(
    'Открепить все сообщения?',
    'Все закрепленные сообщения в этом чате будут откреплены.',
    async () => {
      const res = await api('pin_message', 'POST', {
        chat_id: S.chatId,
        unpin_all: 1
      });
      if (res.ok) {
        S.pinnedMsgs = [];
        S.pinIndex = 0;
        updatePinBar();
        closePinListScreen();
        toast('Все сообщения откреплены');
      } else {
        toast(res.message || 'Ошибка', 'err');
      }
    }
  );
}

/* ── Format time for pinned messages list ── */
function fmtPinTime(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (isToday) return hh + ':' + mm;
  return String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + hh + ':' + mm;
}

/* ── Init pin bar ── */
function initPinBar() {
  const bar = $('pin-bar');
  if (!bar) return;

  const inner = bar.querySelector('.pin-bar-inner');
  if (inner) {
    // Click to scroll to message
    inner.addEventListener('click', (e) => {
      if (e.target.closest('.pin-bar-list-btn') || e.target.closest('.pin-dots')) return;
      if (!S.pinnedMsgs.length) return;
      const p = S.pinnedMsgs[S.pinIndex];
      if (!p) return;
      const row = document.querySelector('.mrow[data-id="' + p.message_id + '"]');
      if (row) {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        row.style.transition = 'background .2s ease';
        row.style.background = 'rgba(var(--y-rgb, 139,92,246),.12)';
        setTimeout(() => { row.style.background = ''; }, 1200);
      }
    });
  }

  // Pin list button → open list screen
  const listBtn = $('pin-bar-list-btn');
  if (listBtn) {
    listBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openPinListScreen();
    });
  }

  // Pin list screen close
  const backBtn = $('pin-list-back');
  if (backBtn) {
    backBtn.addEventListener('click', closePinListScreen);
  }

  // Unpin all button
  const unpinAllBtn = $('pin-list-unpin-all');
  if (unpinAllBtn) {
    unpinAllBtn.addEventListener('click', unpinAllMessages);
  }

  // Init swipe navigation
  _initPinSwipe();
}

/* ── Silent content update (no animation, no re-show) — used by scroll sync ── */
function _updatePinBarContent() {
  if (!S.pinnedMsgs || !S.pinnedMsgs.length) return;
  if (S.pinIndex < 0) S.pinIndex = 0;
  if (S.pinIndex >= S.pinnedMsgs.length) S.pinIndex = S.pinnedMsgs.length - 1;

  const p = S.pinnedMsgs[S.pinIndex];
  const author = $('pin-bar-author');
  if (author) author.textContent = p.pinned_for_all ? (p.sender_name || 'Пользователь') : 'Закреплено для вас';
  const text = $('pin-bar-text');
  if (text) {
    let preview = p.body || (p.media_type === 'video' ? 'Видео' : p.media_type === 'photo' ? 'Фото' : p.media_type === 'voice' ? 'Голосовое сообщение' : 'Медиафайл');
    preview = preview.replace(/\*\*/g, '').replace(/\|\|/g, '').replace(/\[.*?\]\(.*?\)/g, '').trim();
    if (preview.length > 60) preview = preview.slice(0, 60) + '…';
    text.textContent = preview || 'Медиафайл';
  }
  _renderPinDots();
}

/* ── Dynamic pin index: update pin bar when scrolling past pinned messages ── */
/* DESC array: idx 0 = newest (bottom of chat DOM), idx N-1 = oldest (top of chat DOM)
   Telegram uses the BOTTOM of the visible area as reference:
   - At bottom of chat → show newest pin (idx 0)
   - Scroll UP → newest pin moves below viewport bottom → switch to next older
   - Scroll DOWN → older pin rises above viewport bottom → switch back to newer */
function _syncPinIndexOnScroll() {
  if (!S.pinnedMsgs || !S.pinnedMsgs.length) return;
  const area = $('msgs');
  if (!area) return;
  const areaRect = area.getBoundingClientRect();
  const bottomLine = areaRect.bottom;

  // DESC: iterate from newest (0) to oldest (N-1)
  // Skip messages that are below viewport bottom (scrolled UP past them: r.top > bottomLine)
  // First match = newest pin still at or above the bottom of the screen
  let bestIdx = -1;
  for (let i = 0; i < S.pinnedMsgs.length; i++) {
    const row = document.querySelector('.mrow[data-id="' + S.pinnedMsgs[i].message_id + '"]');
    if (!row) continue;
    const r = row.getBoundingClientRect();
    if (r.top <= bottomLine) {
      bestIdx = i;
      break;
    }
  }

  // Fallback: ALL pins are below viewport (user scrolled above all of them)
  if (bestIdx === -1) bestIdx = S.pinnedMsgs.length - 1;

  if (bestIdx !== S.pinIndex) {
    S.pinIndex = bestIdx;
    _updatePinBarContent();
  }
}

// Throttled scroll sync for pin index
let _pinScrollTimer = null;
function _onMsgScrollSyncPin() {
  if (!S.pinnedMsgs || !S.pinnedMsgs.length) return;
  if (_pinScrollTimer) return;
  _pinScrollTimer = requestAnimationFrame(() => {
    _pinScrollTimer = null;
    _syncPinIndexOnScroll();
  });
}

document.addEventListener('DOMContentLoaded', function() {
  initPinBar();
  // Attach scroll listener for dynamic pin index
  const area = $('msgs');
  if (area) area.addEventListener('scroll', _onMsgScrollSyncPin, { passive: true });
});

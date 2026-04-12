'use strict';
/* ══ PINNED MESSAGES — Telegram-style multi-pin with dot indicators and list screen ══ */

S.pinnedMsgs = [];   // Array of pinned messages per current chat
S.pinIndex  = 0;     // Current visible index (0 = oldest)

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
    // Default to most recently pinned (last in array)
    S.pinIndex = S.pinnedMsgs.length > 0 ? S.pinnedMsgs.length - 1 : 0;
    updatePinBar();
  } catch {
    S.pinnedMsgs = [];
    updatePinBar();
  }
}

/* Backwards-compatible alias */
function fetchPinnedMsg(chatId) { return fetchPinnedMsgs(chatId); }

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
  dotsEl.innerHTML = '';

  // Only show dots if there are 2+ pinned messages
  if (count < 2) {
    dotsEl.style.display = 'none';
    return;
  }
  dotsEl.style.display = 'flex';

  for (let i = 0; i < count; i++) {
    const dot = document.createElement('span');
    dot.className = 'pin-dot' + (i === S.pinIndex ? ' active' : '');
    dot.dataset.index = i;
    dot.addEventListener('click', (e) => {
      e.stopPropagation();
      S.pinIndex = i;
      updatePinBar();
    });
    dotsEl.appendChild(dot);
  }
}

/* ── Navigate between pinned messages ── */
function _pinNavPrev() {
  if (S.pinnedMsgs.length < 2) return;
  S.pinIndex = Math.max(0, S.pinIndex - 1);
  updatePinBar();
}

function _pinNavNext() {
  if (S.pinnedMsgs.length < 2) return;
  S.pinIndex = Math.min(S.pinnedMsgs.length - 1, S.pinIndex + 1);
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
    if (dx < -40) _pinNavPrev();      // swipe left → show previous (older)
    else if (dx > 40) _pinNavNext();   // swipe right → show next (newer)
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

  // Render messages in reverse order (newest first)
  const reversed = [...S.pinnedMsgs].reverse();
  reversed.forEach((p, ri) => {
    const realIndex = S.pinnedMsgs.length - 1 - ri;
    const item = document.createElement('div');
    item.className = 'pin-list-item';
    item.dataset.msgId = p.message_id;

    // Avatar — use getMediaUrl() for proper S3 URL construction
    const avUrl = p.sender_avatar ? getMediaUrl(p.sender_avatar) : null;
    const avHtml = avUrl
      ? '<div class="pin-list-av"><img src="' + esc(avUrl) + '" alt=""></div>'
      : '<div class="pin-list-av pin-list-av-placeholder">' + esc((p.sender_name || '?')[0]) + '</div>';

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

document.addEventListener('DOMContentLoaded', initPinBar);

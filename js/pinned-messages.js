'use strict';
/* ══ PINNED MESSAGES — Telegram-style pin/unpin with pill bar ══ */

S.pinnedMsg = null; // { message_id, body, sender_name, sender_avatar, media_url, media_type, pinned_for_all }

async function fetchPinnedMsg(chatId) {
  try {
    const res = await api('get_pinned_message?chat_id=' + chatId);
    if(res.ok) {
      S.pinnedMsg = res.pinned || null;
      updatePinBar();
    }
  } catch { S.pinnedMsg = null; updatePinBar(); }
}

async function togglePinMessage(m) {
  const isPinned = S.pinnedMsg && S.pinnedMsg.message_id == m.id;
  if(isPinned) {
    // Already pinned — confirm unpin
    const forAll = S.pinnedMsg.pinned_for_all;
    const label = forAll ? 'для всех' : 'для вас';
    showConfirm('Открепить сообщение?', 'Сообщение будет откреплено ' + label + '.', async () => {
      const res = await api('pin_message', 'POST', {
        chat_id: S.chatId,
        message_id: m.id,
        unpin: true,
        pinned_for_all: forAll || 0
      });
      if(res.ok) {
        S.pinnedMsg = null;
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
  if(res.ok) {
    await fetchPinnedMsg(S.chatId);
    toast(pinnedForAll ? 'Сообщение закреплено' : 'Сообщение закреплено для вас');
  } else {
    toast(res.message || 'Ошибка', 'err');
  }
}

function updatePinBar() {
  const bar = $('pin-bar');
  const text = $('pin-bar-text');
  const author = $('pin-bar-author');
  if(!bar) return;

  if(!S.pinnedMsg) {
    bar.classList.remove('visible');
    setTimeout(() => { if(!S.pinnedMsg) bar.style.display = 'none'; }, 300);
    return;
  }

  const p = S.pinnedMsg;
  bar.style.display = '';
  let preview = p.body || (p.media_type === 'video' ? '🎥 Видео' : '🖼 Фото');
  // Strip markdown
  preview = preview.replace(/\*\*/g, '').replace(/\|\|/g, '').replace(/\[.*?\]\(.*?\)/g, '').trim();
  if(preview.length > 60) preview = preview.slice(0, 60) + '…';

  text.textContent = preview || 'Медиафайл';
  author.textContent = p.pinned_for_all ? (p.sender_name || 'Пользователь') : 'Закреплено для вас';

  requestAnimationFrame(() => bar.classList.add('visible'));
}

function initPinBar() {
  const bar = $('pin-bar');
  const closeBtn = $('pin-bar-close');
  if(!bar) return;

  bar.querySelector('.pin-bar-inner').addEventListener('click', (e) => {
    if(e.target.closest('.pin-bar-close')) return;
    if(!S.pinnedMsg) return;
    const row = document.querySelector('.mrow[data-id="' + S.pinnedMsg.message_id + '"]');
    if(row) {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Flash highlight
      row.style.transition = 'background .2s ease';
      row.style.background = 'rgba(var(--y-rgb, 139,92,246),.12)';
      setTimeout(() => { row.style.background = ''; }, 1200);
    }
  });

  if(closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      bar.classList.remove('visible');
      setTimeout(() => { bar.style.display = 'none'; }, 300);
      // Actually unpin
      if(S.pinnedMsg) {
        api('pin_message', 'POST', {
          chat_id: S.chatId,
          message_id: S.pinnedMsg.message_id,
          unpin: true,
          pinned_for_all: S.pinnedMsg.pinned_for_all || 0
        });
        S.pinnedMsg = null;
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', initPinBar);

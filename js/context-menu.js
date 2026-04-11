'use strict';
/* ══ CONTEXT MENUS — Логика всех выпадающих контекстных меню ══ */

/* ── 1. ГЛАВНОЕ МЕНЮ СООБЩЕНИЙ (с пикером реакций) ── */
let ctxMsg = null;

function showCtx(e, m) {
  hideChatCtx();
  hideFieldCtx();
  hidePrevCtx();
  ctxMsg = m;

  // Show dim overlay (mobile context)
  const dimEl = $('msg-ctx-dim');
  if(dimEl && _isTouch()) dimEl.classList.add('on');

  const isMe = m.sender_id == S.user?.id;
  $('ctx-edit').style.display = isMe && m.body ? 'flex' : 'none';
  $('ctx-del').style.display = isMe ? 'flex' : 'none';
  $('ctx-del-partner').style.display = !isMe ? 'flex' : 'none';
  $('ctx-copy').style.display = m.body ? 'flex' : 'none';
  // Mute user button: only show for other people's messages
  const muteBtn = $('ctx-mute-user');
  const muteLabel = $('ctx-mute-user-label');
  if (muteBtn) {
    const muted = isUserMuted(m.sender_id);
    muteBtn.style.display = !isMe ? 'flex' : 'none';
    if (muteLabel) muteLabel.textContent = muted ? 'Разглушить пользователя' : 'Заглушить пользователя';
  }
  
  const bar = $('ctx-rxn-bar');
  bar.innerHTML = '';
  bar.scrollLeft = 0;
  
  const myReactions = (S.rxns[m.id] || []).filter(r => r.by_me);
  const myReactionEmojis = new Set(myReactions.map(r => normEmoji(r.emoji)));
  const canAddMore = myReactions.length < 3;
  
  const sorted = getSortedRxns();
  const active = sorted.filter(e => myReactionEmojis.has(normEmoji(e)));
  const rest   = sorted.filter(e => !myReactionEmojis.has(normEmoji(e)));
  const visible = [...active, ...rest].slice(0, 8);

  visible.forEach(emoji => {
    const btn = document.createElement('button');
    const isActive = myReactionEmojis.has(normEmoji(emoji));
    const isDisabled = !isActive && !canAddMore;
    
    btn.className = 'ctx-rxn-btn' + (isActive ? ' active-rxn' : '') + (isDisabled ? ' rxn-disabled' : '');
    btn.title = isDisabled ? 'Максимум 3 реакции' : emoji + (isActive ? ' (убрать)' : '');
    btn.innerHTML = emoImg(emoji, 21);
    
    btn.onclick = ev => {
      ev.stopPropagation();
      hideCtx();
      if (isTemp(m.id)) { toast('Подождите…'); return; }
      if (!isDisabled) bumpRxnFreq(emoji);
      toggleRxn(+m.id, emoji, isActive);
    };
    bar.appendChild(btn);
  });

  const moreBtn = $('ctx-rxn-more');
  if (moreBtn) {
    moreBtn.onclick = ev => {
      ev.stopPropagation();
      if (!isTemp(m.id)) openCtxEmoPanel(m);
    };
  }

  bar._wheelHandler && bar.removeEventListener('wheel', bar._wheelHandler);
  bar._wheelHandler = ev => {
    if(Math.abs(ev.deltaY) < Math.abs(ev.deltaX)) return;
    ev.preventDefault();
    bar.scrollLeft += ev.deltaY * 0.8;
  };
  bar.addEventListener('wheel', bar._wheelHandler, {passive: false});
  
  const menu = $('ctxmenu');
  menu.style.transition = 'none';
  menu.classList.remove('on');
  menu.style.visibility = 'hidden';
  menu.style.display = 'block';
  
  // Отключаем CSS transform для кристально точного замера 1:1
  menu.style.transform = 'none';
  menu.style.left = '0px';
  menu.style.top = '0px';
  
  const rect = menu.getBoundingClientRect();
  const menuW = rect.width || menu.offsetWidth;
  const menuH = rect.height || menu.offsetHeight;
  const W = document.documentElement.clientWidth;
  const H = document.documentElement.clientHeight;
  const x = e.clientX, y = e.clientY;
  const M = 6;
  let left = x, top = y;
  
  // Если не влезает справа — отзеркаливаем (правый-верхний угол меню будет у курсора)
  if(left + menuW > W - M) left = x - menuW;
  // Если не влезает снизу — отзеркаливаем вверх
  if(top + menuH > H - M) top = y - menuH;
  if(left < M) left = M;
  if(top < M) top = M;
  
  const ox = x - left, oy = y - top;
  
  menu.style.transform = ''; // Возвращаем scale() из CSS
  menu.style.transformOrigin = `${ox}px ${oy}px`;
  menu.style.left = left + 'px'; menu.style.top = top + 'px';
  
  // Форсируем пересчет стилей, чтобы браузер точно применил transformOrigin до старта анимации
  getComputedStyle(menu).transformOrigin;
  
  menu.style.visibility = '';
  menu.style.transition = '';
  menu.classList.add('on');
}

function hideCtx() {
  const menu = $('ctxmenu');
  if(menu) {
    menu.classList.remove('on');
    setTimeout(() => { if (!menu.classList.contains('on')) menu.style.display = 'none'; }, 150);
  }
  const bar = $('ctx-rxn-bar');
  if(bar) bar.scrollLeft = 0;
  hideCtxEmoPanel();
  // Remove dim overlay and message dimming
  const dimEl = $('msg-ctx-dim');
  if(dimEl) dimEl.classList.remove('on');
  document.querySelectorAll('.msg-dim-active').forEach(el => el.classList.remove('msg-dim-active'));
  document.querySelectorAll('.msg-ctx-target').forEach(el => el.classList.remove('msg-ctx-target'));
}

/* ── Inline emoji panel inside ctx menu ── */
let _ctxEmoMsg = null, _ctxEmoCat = 0;
function openCtxEmoPanel(m) {
  _ctxEmoMsg = m;
  const panel = $('ctx-emo-panel');
  const catsEl = $('ctx-emo-cats');
  if(!panel) return;
  if(!catsEl.dataset.built){
    catsEl.dataset.built = '1';
    EMO_CATS.forEach((cat,i) => {
      const btn = document.createElement('button');
      btn.className = 'ctx-emo-cat' + (i === 0 ? ' on' : '');
      btn.innerHTML = `<span class="emo-s">${cat.l}</span>`;
      btn.title = cat.n;
      btn.onclick = ev => {
        ev.stopPropagation();
        _ctxEmoCat = i;
        $$('.ctx-emo-cat').forEach((b,j) => b.classList.toggle('on', j === i));
        renderCtxEmoGrid();
      };
      catsEl.appendChild(btn);
    });
  }
  _ctxEmoCat = 0;
  $$('.ctx-emo-cat').forEach((b,i) => b.classList.toggle('on', i === 0));
  renderCtxEmoGrid();
  panel.classList.add('on');
  $('ctxmenu').style.width = '280px';
}

function renderCtxEmoGrid() {
  const grid = $('ctx-emo-grid'); if(!grid) return;
  grid.innerHTML = '';
  const cat = EMO_CATS[_ctxEmoCat];
  const m = _ctxEmoMsg;
  const myReactions = (S.rxns[m?.id] || []).filter(r => r.by_me);
  const mySet = new Set(myReactions.map(r => normEmoji(r.emoji)));
  const canAdd = myReactions.length < 3;
  cat.e.forEach(emoji => {
    const btn = document.createElement('button');
    btn.className = 'ctx-eg-btn';
    const isActive = mySet.has(normEmoji(emoji));
    const disabled = !isActive && !canAdd;
    if(isActive) btn.style.background = 'rgba(139,92,246,.28)';
    if(disabled) btn.style.opacity = '.35';
    btn.innerHTML = `<span class="emo-s">${emoji}</span>`;
    btn.title = emoji + (isActive ? ' (убрать)' : disabled ? ' (макс. 3)' : '');
    btn.onclick = ev => {
      ev.stopPropagation();
      if(disabled) return;
      hideCtx();
      if(!isTemp(m.id)) { bumpRxnFreq(emoji); toggleRxn(+m.id, emoji, isActive); }
    };
    grid.appendChild(btn);
  });
}

function hideCtxEmoPanel() {
  const panel = $('ctx-emo-panel');
  if(panel) panel.classList.remove('on');
  $('ctxmenu').style.width = '';
}

$('ctx-emo-back').onclick = e => {
  e.stopPropagation();
  hideCtxEmoPanel();
};

$('ctx-sel').onclick = () => {
  if(!ctxMsg) return; hideCtx();
  const batchId = ctxMsg.batch_id;
  const batchMsgs = getBatchMsgs(batchId);
  if(batchId && batchMsgs.length > 1) {
    enterSelectMode(null);
    selectBatchInSelectMode(batchId);
    return;
  }
  enterSelectMode(ctxMsg.id);
};

$('ctx-reply').onclick = () => {
  if(!ctxMsg) return; hideCtx();
  let bodyPrev = ctxMsg.body || 'Медиафайл';
  const cm = typeof bodyPrev === 'string' ? bodyPrev.match(/^\[call:(missed|declined|ended)(?::(\d+))?\]$/) : null;
  if(cm) {
    if (cm[1] === 'ended') bodyPrev = '📞 Звонок завершен';
    else if (cm[1] === 'missed') bodyPrev = '📞 Пропущенный звонок';
    else bodyPrev = '📞 Отклонённый звонок';
  }
  S.replyTo = { id: ctxMsg.id, sender_name: ctxMsg.nickname || 'Пользователь', body: bodyPrev };
  $('rbar-who').textContent = S.replyTo.sender_name;
  $('rbar-txt').textContent = hideSpoilerText(S.replyTo.body).slice(0, 80);
  $('rbar').classList.add('on');
  $('mfield').focus();
};

$('ctx-copy').onclick = () => {
  hideCtx();
  if(ctxMsg?.body) {
    let txt = ctxMsg.body;
    const cm = txt.match(/^\[call:(missed|declined|ended)(?::(\d+))?\]$/);
    if(cm) {
      if (cm[1] === 'ended') txt = '📞 Звонок завершен';
      else if (cm[1] === 'missed') txt = '📞 Пропущенный звонок';
      else txt = '📞 Отклонённый звонок';
    }
    navigator.clipboard.writeText(txt).then(() => toast('Скопировано'));
  }
};

$('ctx-edit').onclick = () => {
  if(!ctxMsg) return; hideCtx();
  if(typeof startEdit === 'function') startEdit(ctxMsg);
};

$('ctx-del').onclick = () => {
  if(!ctxMsg) return; hideCtx();
  const batchId = ctxMsg.batch_id;
  const batchMsgs = getBatchMsgs(batchId);
  if(batchId && batchMsgs.length > 1) {
    showConfirm('Удалить группу медиа?', 'Все файлы и подпись будут удалены для всех участников.', async () => { await deleteBatch(batchId); });
    return;
  }
  showConfirm('Удалить сообщение?', 'Сообщение будет удалено для всех участников.', async () => {
    const res = await api('delete_message', 'POST', { message_id: +ctxMsg.id });
    if(res.ok) {
      if(S.msgs[S.chatId]) S.msgs[S.chatId] = S.msgs[S.chatId].filter(m => m.id !== ctxMsg.id);
      const el = document.querySelector(`.mrow[data-id="${ctxMsg.id}"]`);
      if(el) deleteMsgEl(el);
      toast('Удалено');
    } else toast(res.message || 'Ошибка', 'err');
  });
};

$('ctx-del-partner').onclick = () => {
  if(!ctxMsg) return; hideCtx();
  const batchId = ctxMsg.batch_id;
  const batchMsgs = getBatchMsgs(batchId);
  if(batchId && batchMsgs.length > 1) {
    showConfirm('Удалить группу медиа для всех?', 'Все файлы и подпись будут удалены для обоих.', async () => { await deleteBatch(batchId); });
    return;
  }
  showConfirm('Удалить сообщение для всех?', 'Сообщение собеседника будет удалено для обоих.', async () => {
    const res = await api('delete_message', 'POST', { message_id: +ctxMsg.id });
    if(res.ok) {
      if(S.msgs[S.chatId]) S.msgs[S.chatId] = S.msgs[S.chatId].filter(m => m.id !== ctxMsg.id);
      const el = document.querySelector(`.mrow[data-id="${ctxMsg.id}"]`);
      if(el) deleteMsgEl(el);
      toast('Удалено');
    } else toast(res.message || 'Ошибка', 'err');
  });
};

/* ── 2. МЕНЮ СПИСКА ЧАТОВ (левая панель) ── */
let ctxChat = null;
function showChatCtx(e, c) {
  hideCtx();
  hideFieldCtx();
  hidePrevCtx();
  ctxChat = c;
  const delBtn = $('chat-ctx-del');
  if(delBtn) delBtn.style.display = (c.is_protected || c.is_saved_msgs) ? 'none' : '';
  const lbl = $('chat-ctx-pin-label');
  if(lbl) lbl.textContent = c.is_pinned ? 'Открепить' : 'Закрепить';
  const profBtn = $('chat-ctx-profile');
  if (profBtn) profBtn.style.display = (c.is_saved_msgs || c.is_protected) ? 'none' : '';
  // Mute user button: show for regular chats (not saved msgs / system / protected)
  const muteChatBtn = $('chat-ctx-mute-user');
  const muteChatLabel = $('chat-ctx-mute-user-label');
  if (muteChatBtn) {
    const canMute = c.partner_id && !c.is_saved_msgs && !c.is_protected;
    muteChatBtn.style.display = canMute ? 'flex' : 'none';
    if (canMute && muteChatLabel) {
      const muted = isUserMuted(c.partner_id);
      muteChatLabel.textContent = muted ? 'Разглушить пользователя' : 'Заглушить пользователя';
    }
  }
  
  const menu = $('chat-ctxmenu');
  menu.style.transition = 'none';
  menu.classList.remove('on');
  menu.style.visibility = 'hidden';
  menu.style.display = 'block';
  
  menu.style.transform = 'none';
  menu.style.left = '0px';
  menu.style.top = '0px';
  
  const rect = menu.getBoundingClientRect();
  const menuW = rect.width || menu.offsetWidth;
  const menuH = rect.height || menu.offsetHeight;
  const W = document.documentElement.clientWidth;
  const H = document.documentElement.clientHeight;
  const x = e.clientX, y = e.clientY;
  const M = 6;
  let left = x, top = y;
  
  if(left + menuW > W - M) left = x - menuW;
  if(top + menuH > H - M) top = y - menuH;
  if(left < M) left = M;
  if(top < M) top = M;
  
  menu.style.transform = '';
  menu.style.transformOrigin = `${x - left}px ${y - top}px`;
  menu.style.left = left + 'px'; menu.style.top = top + 'px';
  
  getComputedStyle(menu).transformOrigin;
  
  menu.style.visibility = '';
  menu.style.transition = '';
  menu.classList.add('on');
}

function hideChatCtx() {
  const menu = $('chat-ctxmenu');
  if(menu) {
    menu.classList.remove('on');
    setTimeout(() => { if (!menu.classList.contains('on')) menu.style.display = 'none'; }, 150);
  }
}

function applyPinToggle(chat) {
  const chatId = chat.chat_id;
  const willPin = !chat.is_pinned;

  const c = S.chats.find(x => x.chat_id === chatId);
  if(!c) return;
  c.is_pinned = willPin ? 1 : 0;
  chat.is_pinned = c.is_pinned;

  const ciEl = document.querySelector(`.ci[data-chat-id="${chatId}"]`);
  if(ciEl) {
    ciEl.classList.toggle('pinned', willPin);
    const oldIcon = ciEl.querySelector('.ci-pin-icon');
    if(willPin) {
      const ico = document.createElementNS ? (() => {
        const d = document.createElement('div');
        d.innerHTML = '<svg class="ci-pin-icon anim-pin" viewBox="0 0 24 24" fill="currentColor"><path d="M16 12V4h1a1 1 0 000-2H7a1 1 0 000 2h1v8l-2 2v2h5v5h2v-5h5v-2l-2-2z"/></svg>';
        return d.firstChild;
      })() : null;
      if(ico) {
        if(oldIcon) oldIcon.replaceWith(ico);
        else {
          const ts = ciEl.querySelector('.ci-ts');
          const wrap = ts && ts.parentElement;
          if(wrap) wrap.insertBefore(ico, ts);
        }
      }
    } else {
      if(oldIcon) {
        oldIcon.classList.remove('anim-pin');
        oldIcon.classList.add('anim-unpin');
        const onEnd = () => {
          oldIcon.removeEventListener('animationend', onEnd);
          if(oldIcon.parentNode) oldIcon.remove();
        };
        oldIcon.addEventListener('animationend', onEnd, {once: true});
        setTimeout(() => { if(oldIcon.parentNode) oldIcon.remove(); }, 350);
      }
    }
  }

  S.chats = sortChats(S.chats);
  if(typeof sbSearchActive !== 'undefined' && !sbSearchActive) syncChats(S.chats);

  clearTimeout(S.pinDebounce.get(chatId));
  S.pinDebounce.set(chatId, setTimeout(async () => {
    S.pinDebounce.delete(chatId);
    const final = c.is_pinned;
    const res = await api('pin_chat', 'POST', { chat_id: chatId, pinned: final });
    if(res.ok) {
      toast(final ? 'Чат закреплён' : 'Чат откреплён');
    } else {
      c.is_pinned = final ? 0 : 1;
      S.chats = sortChats(S.chats);
      if(typeof sbSearchActive !== 'undefined' && !sbSearchActive) syncChats(S.chats);
      toast(res.message || 'Ошибка', 'err');
    }
  }, 400));
}

$('chat-ctx-pin').onclick = () => {
  if(!ctxChat) return; hideChatCtx();
  const chat = ctxChat; ctxChat = null;
  applyPinToggle(chat);
};

$('chat-ctx-profile').onclick = () => {
  if (!ctxChat) return; hideChatCtx();
  if (isSavedMsgs(ctxChat) || isSystemChat(ctxChat)) return;
  // If we have chat data with partner info, open the profile modal
  const chatData = ctxChat;
  if (chatData.chat_id === S.chatId && S.partner) {
    openPartnerModal();
  } else {
    // Open chat first then show profile
    openProfileModal(chatData, false);
  }
  ctxChat = null;
};

$('chat-ctx-mute-user').onclick = () => {
  if (!ctxChat || !ctxChat.partner_id) return; hideChatCtx();
  const chat = ctxChat; ctxChat = null;
  const nowMuted = toggleMuteUser(chat.partner_id);
  toast(nowMuted ? 'Пользователь заглушен' : 'Пользователь разглушен');
  // Force re-render by invalidating _chatData on the target element
  const el = document.querySelector(`.ci[data-chat-id="${chat.chat_id}"]`);
  if (el) { el._chatData = null; }
  if(typeof syncChats === 'function') syncChats(S.chats);
  else if(typeof renderChats === 'function') renderChats('');
};

$('chat-ctx-clear').onclick = () => {
  if (!ctxChat) return; hideChatCtx();
  const chatId = ctxChat.chat_id;
  showConfirm('Очистить историю?', 'Все сообщения будут удалены только у вас.', async () => {
    const res = await api('clear_chat_history', 'POST', { chat_id: chatId });
    if (res.ok) {
      S.msgs[chatId] = [];
      delete S.lastId[chatId];
      if (typeof cacheDeleteChat === 'function') cacheDeleteChat(chatId);
      if (S.chatId === chatId) {
        renderMsgs(chatId);
      }
      toast('История очищена');
    } else {
      toast(res.message || 'Ошибка', 'err');
    }
    ctxChat = null;
  });
  ctxChat = null;
};

$('chat-ctx-del').onclick = () => {
  if(!ctxChat) return; hideChatCtx();
  if(ctxChat.is_protected || ctxChat.is_saved_msgs) { toast('Этот чат нельзя удалить', 'err'); ctxChat = null; return; }
  showConfirm('Удалить чат?', 'История сообщений будет удалена для обоих участников.', async () => {
    const res = await api('delete_chat', 'POST', { chat_id: ctxChat.chat_id });
    if(res.ok) {
      S.chats = S.chats.filter(c => c.chat_id !== ctxChat.chat_id);
      if(S.chatId === ctxChat.chat_id) {
        S.partner = null;
        goBackToList();
      }
      delete S.msgs[ctxChat.chat_id];
      delete S.lastId[ctxChat.chat_id];
      if (typeof cacheDeleteChat === 'function') cacheDeleteChat(ctxChat.chat_id);
      if (typeof cacheWriteChats === 'function') cacheWriteChats(S.chats);
      if(typeof sbSearchActive !== 'undefined' && !sbSearchActive) renderChats('');
      toast('Чат удалён');
    } else {
      toast(res.message || 'Ошибка удаления чата', 'err');
    }
    ctxChat = null;
  });
};

/* ── 3. МЕНЮ ФОРМАТИРОВАНИЯ ТЕКСТА (поле ввода) ── */
const fieldCtx = $('field-ctx');

function hideFieldCtx() {
  if (fieldCtx) fieldCtx.classList.remove('on');
}

function showFieldCtx(x, y) {
  hideCtx();
  hideChatCtx();
  hidePrevCtx();
  if(typeof saveFieldSelection === 'function') saveFieldSelection();
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) {
    hideFieldCtx();
    return;
  }
  const r = sel.getRangeAt(0);
  
  const mfieldEl = $('mfield');
  const bioEl = $('pm-bio');
  
  const inMfield = mfieldEl && mfieldEl.contains(r.commonAncestorContainer);
  const inBio = bioEl && bioEl.contains(r.commonAncestorContainer);
  const inField = inMfield || inBio;
  const hasSel = inField && !sel.isCollapsed;

  const cutBtn = $('fctx-cut');
  const copyBtn = $('fctx-copy');
  if(cutBtn) cutBtn.disabled = !hasSel;
  if(copyBtn) copyBtn.disabled = !hasSel;

  const fmtRow = $('fctx-fmt-row');
  const fmtSep = $('fctx-fmt-sep');
  if(fmtRow) fmtRow.style.display = inField ? 'flex' : 'none';
  if(fmtSep) fmtSep.style.display = inField ? 'block' : 'none';
  
  if(inField && typeof updateFmtBtnsCtx === 'function') {
    updateFmtBtnsCtx(inBio ? bioEl : mfieldEl);
  }
  
  fieldCtx.style.transition = 'none';
  fieldCtx.classList.remove('on');
  fieldCtx.style.visibility = 'hidden';
  fieldCtx.style.display = 'block';
  
  fieldCtx.style.transform = 'none';
  fieldCtx.style.left = '0px';
  fieldCtx.style.top = '0px';
  
  const rect = fieldCtx.getBoundingClientRect();
  const mw = rect.width || fieldCtx.offsetWidth;
  const mh = rect.height || fieldCtx.offsetHeight;
  const W = document.documentElement.clientWidth;
  const H = document.documentElement.clientHeight;
  const M = 8;
  let cx = x, cy = y;
  
  if(cx + mw > W - M) cx = x - mw;
  if(cy + mh > H - M) cy = y - mh;
  if(cx < M) cx = M;
  if(cy < M) cy = M;
  
  fieldCtx.style.transform = '';
  fieldCtx.style.transformOrigin = `${x - cx}px ${y - cy}px`;
  fieldCtx.style.left = cx + 'px';
  fieldCtx.style.top = cy + 'px';
  
  getComputedStyle(fieldCtx).transformOrigin;
  
  fieldCtx.style.visibility = '';
  fieldCtx.style.transition = '';
  fieldCtx.classList.add('on');
}

document.addEventListener('DOMContentLoaded', () => {
  const mfieldEl = $('mfield');
  if (mfieldEl) {
    mfieldEl.addEventListener('contextmenu', e => {
      e.preventDefault();
      showFieldCtx(e.clientX, e.clientY);
    });
  }
  const bioEl = $('pm-bio');
  if (bioEl) {
    bioEl.addEventListener('contextmenu', e => {
      e.preventDefault();
      showFieldCtx(e.clientX, e.clientY);
    });
  }
});

const fctxCut = $('fctx-cut');
if (fctxCut) {
  fctxCut.addEventListener('click', async () => {
    if(typeof getFieldSel !== 'function') return;
    const sel = getFieldSel();
    if(!sel) return;
    const text = sel.toString();
    await navigator.clipboard.writeText(text).catch(() => document.execCommand('copy'));
    document.execCommand('delete');
    hideFieldCtx();
  });
}

const fctxCopy = $('fctx-copy');
if (fctxCopy) {
  fctxCopy.addEventListener('click', async () => {
    if(typeof getFieldSel !== 'function') return;
    const sel = getFieldSel();
    if(!sel) return;
    await navigator.clipboard.writeText(sel.toString()).catch(() => document.execCommand('copy'));
    hideFieldCtx();
  });
}

const fctxPaste = $('fctx-paste');
if (fctxPaste) {
  fctxPaste.addEventListener('click', async () => {
    hideFieldCtx();
    const mfieldEl = $('mfield');
    if(mfieldEl) mfieldEl.focus();
    try {
      const text = await navigator.clipboard.readText();
      document.execCommand('insertText', false, text);
    } catch {
      document.execCommand('paste');
    }
  });
}

/* ── 4. МЕНЮ ОТПРАВКИ МЕДИА (скрытый/спойлер) ── */
const prevCtx = $('prev-ctx');
function hidePrevCtx() {
  if(prevCtx) prevCtx.classList.remove('on');
  const btn = $('btn-prev-opts');
  if(btn) btn.classList.remove('active');
}

const btnPrevOpts = $('btn-prev-opts');
if (btnPrevOpts) {
  btnPrevOpts.onclick = e => {
    e.stopPropagation();
    hideCtx();
    hideChatCtx();
    hideFieldCtx();
    if (prevCtx.classList.contains('on')) { hidePrevCtx(); return; }
    const r = btnPrevOpts.getBoundingClientRect();
    let top = r.bottom + 6;
    prevCtx.style.right = (window.innerWidth - r.right) + 'px';
    let originY = 'top';
    if (top + 60 > window.innerHeight) {
       top = r.top - 60 - 6; 
       originY = 'bottom';
    }
    prevCtx.style.transition = 'none';
    prevCtx.classList.remove('on');
    prevCtx.style.top = top + 'px';
    prevCtx.style.transformOrigin = `right ${originY}`;
    getComputedStyle(prevCtx).transformOrigin;
    prevCtx.style.transition = '';
    prevCtx.classList.add('on');
    btnPrevOpts.classList.add('active');
  };
}

const prevCtxSpoiler = $('prev-ctx-spoiler');
if (prevCtxSpoiler) {
  prevCtxSpoiler.onclick = () => {
    S.prevSpoiler = !S.prevSpoiler;
    prevCtxSpoiler.classList.toggle('active', S.prevSpoiler);
    const btn = $('btn-prev-opts');
    if(btn) btn.classList.toggle('prev-spoiler-on', S.prevSpoiler);
    hidePrevCtx();
  };
}

/* ── ОБЩИЕ ОБРАБОТЧИКИ ЗАКРЫТИЯ ── */
let _hdrMbCtxOpenTime = 0;
const _isTouch=()=>'ontouchstart' in window;

// Mobile: tap dim overlay → close context menu immediately
const _dimEl = $('msg-ctx-dim');
if(_dimEl){
  _dimEl.addEventListener('touchstart', e => {
    e.preventDefault();
    hideCtx();
  }, {passive:false});
}

document.addEventListener('click', e => {
  // Prevent immediate close of hdr-mb context menu right after long-press
  if (Date.now() - _hdrMbCtxOpenTime < 400 && e.target.closest('#hdr-mb-avatar')) return;
  if (!e.target.closest('.ctxmenu')) hideCtx();
  if (!e.target.closest('#chat-ctxmenu')) hideChatCtx();
  if (Date.now() - _hdrMbCtxOpenTime > 400 && !e.target.closest('#hdr-mb-ctxmenu')) hideHdrMbCtx();
  if (fieldCtx && !fieldCtx.contains(e.target)) hideFieldCtx();
  if (prevCtx && !prevCtx.contains(e.target) && e.target.closest('#btn-prev-opts') == null) hidePrevCtx();
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    hideFieldCtx();
    hideCtx();
    hideChatCtx();
    hidePrevCtx();
    hideHdrMbCtx();
  }
});

/* ── 4. МОБИЛЬНЫЙ АВАТАР ШАПКИ ЧАТА (long-press контекстное меню) ── */
const hdrMbCtx = $('hdr-mb-ctxmenu');

function showHdrMbCtx(e) {
  hideCtx();
  hideChatCtx();
  hideFieldCtx();
  hidePrevCtx();

  const c = S.partner;
  if (!c) return;

  // Hide call/delete for saved msgs and system chats
  const callBtn = $('hdr-mb-ctx-call');
  if (callBtn) callBtn.style.display = (isSavedMsgs(c) || isSystemChat(c)) ? 'none' : '';
  const delBtn = $('hdr-mb-ctx-delete');
  if (delBtn) delBtn.style.display = (c.is_protected || c.is_saved_msgs) ? 'none' : '';
  const clearBtn = $('hdr-mb-ctx-clear');
  if (clearBtn) clearBtn.style.display = (c.is_saved_msgs) ? 'none' : '';
  // Mute user button
  const muteMbBtn = $('hdr-mb-ctx-mute');
  const muteMbLabel = $('hdr-mb-ctx-mute-label');
  if (muteMbBtn) {
    const partnerId = c.partner_id || c.id;
    const muted = isUserMuted(partnerId);
    muteMbBtn.style.display = (c.is_saved_msgs || c.is_protected || isSystemChat(c)) ? 'none' : '';
    if (muteMbLabel) muteMbLabel.textContent = muted ? 'Разглушить' : 'Заглушить';
  }

  hdrMbCtx.style.display = 'block';
  hdrMbCtx.style.transition = 'none';
  hdrMbCtx.classList.remove('on');
  hdrMbCtx.style.visibility = 'hidden';

  // Position — center above the avatar button
  const btn = $('hdr-mb-avatar');
  const btnRect = btn.getBoundingClientRect();
  hdrMbCtx.style.left = '0px';
  hdrMbCtx.style.top = '0px';
  hdrMbCtx.style.transform = 'none';

  const rect = hdrMbCtx.getBoundingClientRect();
  const menuW = rect.width || 200;
  const menuH = rect.height || 200;
  const W = document.documentElement.clientWidth;
  const H = document.documentElement.clientHeight;

  let left = btnRect.right - menuW - 4;
  let top = btnRect.top - menuH - 8;
  if (left < 6) left = 6;
  if (top < 6) top = btnRect.bottom + 8;
  if (left + menuW > W - 6) left = W - menuW - 6;
  if (top + menuH > H - 6) top = H - menuH - 6;

  hdrMbCtx.style.left = left + 'px';
  hdrMbCtx.style.top = top + 'px';
  hdrMbCtx.style.transform = '';
  hdrMbCtx.style.visibility = '';
  hdrMbCtx.style.transition = '';

  void hdrMbCtx.offsetWidth; // force reflow
  hdrMbCtx.classList.add('on');
  _hdrMbCtxOpenTime = Date.now();
}

function hideHdrMbCtx() {
  if (hdrMbCtx) {
    hdrMbCtx.classList.remove('on');
    setTimeout(() => { if (!hdrMbCtx.classList.contains('on')) hdrMbCtx.style.display = 'none'; }, 150);
  }
}

// Long-press on mobile avatar
(function() {
  const btn = $('hdr-mb-avatar');
  if (!btn) return;

  let timer = null;
  let fired = false;
  let startX = 0, startY = 0;

  function onStart(e) {
    e.preventDefault(); // prevent native long-press menu / save-image popup
    const touch = e.touches ? e.touches[0] : e;
    startX = touch.clientX;
    startY = touch.clientY;
    fired = false;
    timer = setTimeout(() => {
      fired = true;
      showHdrMbCtx({ clientX: startX, clientY: startY });
    }, 400);
  }

  function onMove(e) {
    if (timer === null) return;
    const touch = e.touches ? e.touches[0] : e;
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function onEnd(e) {
    clearTimeout(timer);
    timer = null;
    if (fired) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // Tap — open partner modal
    if (S.partner && !isSystemChat(S.partner) && !isSavedMsgs(S.partner)) {
      openPartnerModal();
    }
  }

  btn.addEventListener('touchstart', onStart, { passive: false });
  btn.addEventListener('touchmove', onMove, { passive: true });
  btn.addEventListener('touchend', onEnd);
  btn.addEventListener('touchcancel', () => { clearTimeout(timer); timer = null; });
  // Mouse fallback for desktop testing
  btn.addEventListener('mousedown', onStart);
  btn.addEventListener('mousemove', onMove);
  btn.addEventListener('mouseup', onEnd);
  btn.addEventListener('mouseleave', () => { clearTimeout(timer); timer = null; });
  // Prevent native context menu on right-click / long-press
  btn.addEventListener('contextmenu', e => e.preventDefault());
})();

// Context menu item handlers
$('hdr-mb-ctx-call').onclick = () => {
  hideHdrMbCtx();
  if (!S.partner || isSavedMsgs(S.partner) || isSystemChat(S.partner)) return;
  if (window.startCall) {
    window.startCall({
      id: S.partner?.partner_id || S.partner?.id,
      name: $('hdr-name')?.textContent || '—',
      avatarHtml: $('hdr-av')?.innerHTML || '',
      signalId: S.partner?.partner_signal_id || S.partner?.signal_id
    });
  }
};

$('hdr-mb-ctx-profile').onclick = () => {
  hideHdrMbCtx();
  if (!S.partner) return;
  if (isSavedMsgs(S.partner) || isSystemChat(S.partner)) return;
  openPartnerModal();
};

$('hdr-mb-ctx-clear').onclick = () => {
  hideHdrMbCtx();
  if (!S.partner || isSavedMsgs(S.partner)) return;
  const chatId = S.partner.chat_id;
  showConfirm('Очистить историю?', 'Все сообщения будут удалены только у вас.', async () => {
    const res = await api('clear_chat_history', 'POST', { chat_id: chatId });
    if (res.ok) {
      S.msgs[chatId] = [];
      delete S.lastId[chatId];
      if (typeof cacheDeleteChat === 'function') cacheDeleteChat(chatId);
      if (S.chatId === chatId) renderMsgs(chatId);
      toast('История очищена');
    } else {
      toast(res.message || 'Ошибка', 'err');
    }
  });
};

$('hdr-mb-ctx-delete').onclick = () => {
  hideHdrMbCtx();
  if (!S.partner) return;
  if (S.partner.is_protected || S.partner.is_saved_msgs) return;
  const partnerCopy = S.partner;
  showConfirm('Удалить чат?', 'История сообщений будет удалена для обоих участников.', async () => {
    const res = await api('delete_chat', 'POST', { chat_id: partnerCopy.chat_id });
    if (res.ok) {
      S.chats = S.chats.filter(c => c.chat_id !== partnerCopy.chat_id);
      if (S.chatId === partnerCopy.chat_id) {
        S.partner = null;
        goBackToList();
      }
      delete S.msgs[partnerCopy.chat_id];
      delete S.lastId[partnerCopy.chat_id];
      if (typeof cacheDeleteChat === 'function') cacheDeleteChat(partnerCopy.chat_id);
      if (typeof cacheWriteChats === 'function') cacheWriteChats(S.chats);
      if (typeof sbSearchActive !== 'undefined' && !sbSearchActive) renderChats('');
      toast('Чат удалён');
    } else {
      toast(res.message || 'Ошибка удаления чата', 'err');
    }
  });
};

/* ══ MUTED USERS ═══════════════════════════════════════════════ */
const MUTED_KEY = 'sg_muted_users';

function getMutedUsers() {
  try { return new Set(JSON.parse(localStorage.getItem(MUTED_KEY) || '[]')); } catch { return new Set(); }
}
function saveMutedUsers(set) {
  try { localStorage.setItem(MUTED_KEY, JSON.stringify([...set])); } catch {}
}
function isUserMuted(userId) {
  if (!userId) return false;
  return getMutedUsers().has(+userId);
}
function toggleMuteUser(userId) {
  if (!userId) return false;
  const set = getMutedUsers();
  const id = +userId;
  if (set.has(id)) { set.delete(id); saveMutedUsers(set); return false; }
  set.add(id); saveMutedUsers(set); return true;
}

// Mute from message context menu
document.addEventListener('DOMContentLoaded', function() {
  var ctxMuteBtn = $('ctx-mute-user');
  if (ctxMuteBtn) ctxMuteBtn.addEventListener('click', function() {
    hideCtx();
    if (!ctxMsg || !ctxMsg.sender_id) return;
    var nowMuted = toggleMuteUser(ctxMsg.sender_id);
    toast(nowMuted ? 'Пользователь заглушен' : 'Пользователь разглушен');
  });

  var hdrMuteBtn = $('hdr-mb-ctx-mute');
  if (hdrMuteBtn) hdrMuteBtn.addEventListener('click', function() {
    hideHdrMbCtx();
    if (!S.partner) return;
    var partnerId = S.partner.partner_id || S.partner.id;
    if (!partnerId) return;
    var nowMuted = toggleMuteUser(partnerId);
    toast(nowMuted ? 'Пользователь заглушен' : 'Пользователь разглушен');
    // Force re-render of chat list item
    if (S.chatId) {
      var el = document.querySelector(`.ci[data-chat-id="${S.chatId}"]`);
      if (el) { el._chatData = null; }
      if(typeof syncChats === 'function') syncChats(S.chats);
    }
  });
});
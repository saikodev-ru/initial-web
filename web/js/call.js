/* ══ CALL UI — Initial Messenger ══════════════════════════════════
   Desktop: Discord-style inline panel above chat.
   Mobile: Full-screen modal (unchanged).
   ════════════════════════════════════════════════════════════════ */

window.CallUI = (() => {
  'use strict';

  let _timer = null, _seconds = 0;
  let _muted = false, _video = false;
  let _pipActive = false, _callState = 'idle';
  let _partnerId = null, _partnerName = '', _partnerAv = '', _partnerAvKey = null;
  let _iceDisconnectTimeout = null;
  let _iceQueue = [];
  let _statsInterval = null;
  let _remoteCallTimeout = null;
  window._remoteCallActive = false;
  window._remoteCallPartner = null;
  let _isInitiator = false;
  let _endReason = 'missed';
  let _partnerSid = null;
  let _isNegotiating = false;

  // WebRTC
  let _pc = null, _localStream = null, _remoteStream = null;

  // Panel state
  let _panelCollapsed = false;
  let _panelCallerChatId = null;
  let _remoteVolume = 1.0;
  let _screenStream = null;

  const ALL_STUN_SERVERS = [
    'stun:stun.l.google.com:19302','stun:stun1.l.google.com:19302',
    'stun:stun2.l.google.com:19302','stun:stun.sipnet.ru:3478',
    'stun:stun.sipnet.net:3478','stun:stun.comtube.ru:3478',
    'stun:stun.zadarma.com:3478','stun:stun.freeswitch.org:3478',
    'stun:stun.stunprotocol.org:3478','stun:stun.voipbuster.com:3478',
    'stun:stun.schlund.de:3478','stun:stun.1und1.de:3478',
    'stun:stun.gmx.net:3478','stun:stun.t-online.de:3478','stun:stun.voiparound.com:3478'
  ];

  async function getWorkingStunServers(count = 2) {
    const shuffled = [...ALL_STUN_SERVERS].sort(() => 0.5 - Math.random()).slice(0, 8);
    const promises = shuffled.map(url => new Promise(resolve => {
      let pc, done = false;
      const finish = (ok) => { if (done) return; done = true; if (pc) pc.close(); resolve(ok ? url : null); };
      try { pc = new RTCPeerConnection({ iceServers: [{ urls: url }] }); } catch(e) { return finish(false); }
      setTimeout(() => finish(false), 800);
      pc.onicecandidate = (e) => { if (e.candidate && e.candidate.type === 'srflx') finish(true); };
      pc.createDataChannel('test');
      pc.createOffer().then(o => pc.setLocalDescription(o)).catch(() => finish(false));
    }));
    const results = await Promise.all(promises);
    const valid = results.filter(u => u !== null);
    return valid.length > 0 ? valid.slice(0, count).map(u => ({ urls: u })) : [{ urls: 'stun:stun.l.google.com:19302' }];
  }

  /* ── SVG icons ── */
  const SVG_MIC_ON  = '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>';
  const SVG_MIC_OFF = '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/><line x1="1" y1="1" x2="23" y2="23" stroke-width="2.5"/></svg>';
  const SVG_VID_ON  = '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>';
  const SVG_VID_OFF = '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/><line x1="1" y1="1" x2="23" y2="23" stroke-width="2.5"/></svg>';

  function _setCallState(newState) {
    _callState = newState;
    const m = $('call-modal-inner');
    if (m) {
      m.classList.remove('idle','calling','ringing','answering','connected','ended');
      if (newState) m.classList.add(newState);
    }
    if (newState !== 'idle' && newState !== 'ended') {
      if (!window._activeCallPoll) window._activeCallPoll = setInterval(window.pollCallSignals, 800);
    } else {
      if (window._activeCallPoll) { clearInterval(window._activeCallPoll); window._activeCallPoll = null; }
    }
  }

  const $ = id => document.getElementById(id);

  const el = {
    // Incoming modal elements
    overlay:       () => $('modal-call'),
    avatar:        () => $('call-avatar'),
    name:          () => $('call-name'),
    status:        () => $('call-status'),
    timer:         () => $('call-timer'),
    quality:       () => $('call-quality'),
    bg:            () => $('call-bg'),
    btnMute:       () => $('call-btn-mute'),
    btnVid:        () => $('call-btn-video'),
    btnEnd:        () => $('call-btn-end'),
    pipWrap:       () => $('call-pip-wrap'),
    pipVideo:      () => $('call-pip-video'),
    actions:       () => $('call-actions'),
    incoming:      () => $('call-incoming'),
    btnAccept:     () => $('call-ic-accept-btn'),
    btnDecline:    () => $('call-ic-decline-btn'),
    swipeBar:      () => $('call-swipe-bar'),
    swipeKnob:     () => $('call-swipe-knob'),
    remoteVideo:   () => _isMobile() ? $('mc-remote-video') : $('cp-remote-video'),
    localVideo:    () => _isMobile() ? $('mc-local-video') : $('cp-local-video'),
    // Panel elements
    panel:         () => $('call-panel'),
    miniBar:       () => $('call-mini-bar'),
    cpStatus:      () => $('cp-status'),
    cpTimer:       () => $('cp-timer'),
    cpQuality:     () => $('cp-quality'),
    cpRemoteAv:    () => $('cp-remote-av'),
    cpRemoteName:  () => $('cp-remote-name'),
    cpLocalAv:     () => $('cp-local-av'),
    cpMutedIcon:   () => $('cp-muted-icon'),
    cpBtnMute:     () => $('cp-btn-mute'),
    cpBtnVideo:    () => $('cp-btn-video'),
    cpBtnShare:    () => $('cp-btn-share'),
    cpBtnAudioDev: () => $('cp-btn-audio-dev'),
    cpBtnEnd:      () => $('cp-btn-end'),
    cpCollapse:    () => $('cp-collapse-btn'),
    cpResizeHandle:() => $('cp-resize-handle'),
    cmbAv:         () => $('cmb-av'),
    cmbName:       () => $('cmb-name'),
    cmbTimer:      () => $('cmb-timer'),
    cmbBtnExpand:  () => $('cmb-btn-expand'),
    cmbBtnEnd:     () => $('cmb-btn-end'),
    volCtx:        () => $('call-vol-ctx'),
    cvcSlider:     () => $('cvc-slider'),
    cvcVal:        () => $('cvc-val'),
    devPicker:     () => $('call-dev-picker'),
    cpScreen:      () => $('cp-screen'),
    screenVideo:   () => $('call-screen-video'),
    cpFullscreen:  () => $('cp-fullscreen-btn'),
    cpFsIcon:      () => $('cp-fullscreen-icon'),
  };

  let _panelFullscreen = false;
  function _toggleFullscreen() {
    const panel = el.panel(); if (!panel) return;
    _panelFullscreen = !_panelFullscreen;
    panel.classList.toggle('cp-fullscreen', _panelFullscreen);
    const icon = el.cpFsIcon();
    const SVG_EXIT = '<path stroke-linecap="round" stroke-linejoin="round" d="M9 9L4 4m0 0v4m0-4h4m7 0l5-5m0 0v4m0-4h-4M9 15l-5 5m0 0v-4m0 4h4m7 0l5 5m0 0v-4m0 4h-4"/>';
    const SVG_ENTER = '<path stroke-linecap="round" stroke-linejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-5h-4m4 0v4m0-4l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"/>';
    if (icon) icon.innerHTML = _panelFullscreen ? SVG_EXIT : SVG_ENTER;
    const btn = el.cpFullscreen();
    if (btn) btn.title = _panelFullscreen ? 'Свернуть' : 'Распахнуть';
  }

  let _ringAudio = new Audio('assets/incoming-call.mp3');
  let _ringPromise = null;
  let _outgoingRingAudio = new Audio('assets/outgoing-ring.mp3');
  let _outgoingRingPromise = null;
  let _endCallAudio = new Audio('assets/end-call.mp3');

  function playRing() {
    try { _ringAudio.loop = true; _ringAudio.currentTime = 0; _ringPromise = _ringAudio.play(); if (_ringPromise) _ringPromise.catch(() => {}); } catch(e) {}
  }
  function stopRing() {
    if (_ringPromise !== null) { _ringPromise.then(() => { try { _ringAudio.pause(); _ringAudio.currentTime = 0; } catch(e){} }).catch(() => {}); _ringPromise = null; }
    else { try { _ringAudio.pause(); _ringAudio.currentTime = 0; } catch(e){} }
  }
  function playOutgoingRing() {
    try { _outgoingRingAudio.loop = true; _outgoingRingAudio.currentTime = 0; _outgoingRingPromise = _outgoingRingAudio.play(); if (_outgoingRingPromise) _outgoingRingPromise.catch(() => {}); } catch(e) {}
  }
  function stopOutgoingRing() {
    if (_outgoingRingPromise !== null) { _outgoingRingPromise.then(() => { try { _outgoingRingAudio.pause(); _outgoingRingAudio.currentTime = 0; } catch(e){} }).catch(() => {}); _outgoingRingPromise = null; }
    else { try { _outgoingRingAudio.pause(); _outgoingRingAudio.currentTime = 0; } catch(e){} }
  }
  function playEndSound() { try { _endCallAudio.currentTime = 0; _endCallAudio.play().catch(() => {}); } catch(e) {} }

  /* ── Mute/Video UI ── */
  function _updateMuteUI() {
    // Panel
    el.cpBtnMute()?.classList.toggle('danger', _muted);
    if (el.cpMutedIcon()) el.cpMutedIcon().style.display = _muted ? 'flex' : 'none';
    // Modal fallback
    const btn = $('call-btn-mute');
    if (btn) { btn.innerHTML = _muted ? SVG_MIC_OFF : SVG_MIC_ON; btn.classList.toggle('danger', _muted); }
  }

  function _updateVideoUI() {
    const rv = el.remoteVideo();
    const vTracks = _remoteStream ? _remoteStream.getVideoTracks() : [];
    const remoteHasVideo = vTracks.length > 0 && vTracks.some(t => t.readyState === 'live' && !t.muted);
    if (rv) {
      rv.classList.toggle('has-video', !!remoteHasVideo);
      if (remoteHasVideo) {
        if (rv.srcObject !== _remoteStream) rv.srcObject = _remoteStream;
        if (rv.paused) rv.play().catch(() => {});
        if (rv.volume !== undefined) rv.volume = Math.min(1, _remoteVolume);
      }
    }
    // JS fallback for hiding/showing remote avatar (for browsers without :has() CSS support)
    const remAv = el.cpRemoteAv();
    if (remAv) remAv.style.display = remoteHasVideo ? 'none' : '';
    // Mobile avatar hiding logic
    const mcAv = el.avatar();
    if (mcAv && _isMobile()) mcAv.style.display = remoteHasVideo ? 'none' : '';

    const lv = el.localVideo();
    if (lv) lv.style.display = _video ? 'block' : 'none';
    // JS fallback for hiding/showing local avatar when camera is on
    const locAv = el.cpLocalAv();
    if (locAv) locAv.style.display = _video ? 'none' : '';
    el.cpBtnVideo()?.classList.toggle('danger', !_video);
    const btn = $('call-btn-video');
    if (btn) { btn.innerHTML = _video ? SVG_VID_ON : SVG_VID_OFF; btn.classList.toggle('danger', !_video); }
    
    // Sync connected state classes for CSS styling
    const m = $('call-modal-inner');
    if (m) {
      m.classList.toggle('remote-video-active', !!remoteHasVideo);
      m.classList.toggle('video-active', _video);
    }
  }

  /* ── Timer ── */
  function _fmt(s) { return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }

  async function _updateStats() {
    if (!_pc || _callState !== 'connected') return;
    try {
      const stats = await _pc.getStats();
      let ping = null;
      stats.forEach(r => { if (r.type === 'candidate-pair' && r.state === 'succeeded' && r.currentRoundTripTime !== undefined) ping = r.currentRoundTripTime * 1000; });
      const qEl = el.cpQuality();
      if (qEl) {
        if (ping !== null) {
          const p = Math.round(ping);
          let color = '#34c759'; if (p > 150) color = '#ffcc00'; if (p > 300) color = '#ff3b30';
          qEl.style.display = 'inline-flex';
          qEl.innerHTML = `<span class="cp-quality-dot" style="background:${color}"></span>${p} мс`;
        } else { qEl.style.display = 'none'; }
      }
      // Also update legacy quality el
      const qLegacy = el.quality();
      if (qLegacy && ping !== null) {
        const p = Math.round(ping);
        let color = '#34c759'; if (p > 150) color = '#ffcc00'; if (p > 300) color = '#ff3b30';
        qLegacy.style.display = 'flex';
        qLegacy.innerHTML = `<span class="call-quality-dot" style="background:${color};box-shadow:0 0 8px ${color}80"></span> ${p} мс`;
      }
    } catch(e) {}
  }

  function _startTimer() {
    _seconds = 0;
    // Add CSS class for timer pulse animation
    el.cpTimer()?.classList.add('timer-active');
    _timer = setInterval(() => {
      _seconds++;
      const fmt = _fmt(_seconds);
      if (el.cpTimer()) { el.cpTimer().textContent = fmt; el.cpTimer().style.display = 'inline'; }
      if (el.cpStatus()) el.cpStatus().style.display = 'none';
      if (el.cmbTimer()) el.cmbTimer().textContent = fmt;
      if (el.timer()) el.timer().textContent = fmt;
      if (_pipActive) _pipDraw();
      if (_seconds % 15 === 0 && _callState !== 'idle') _sendSignal('call_active', { partnerId: _partnerId, ts: Date.now() }, S.user?.id);
    }, 1000);
    _statsInterval = setInterval(_updateStats, 2000);
  }

  function _stopTimer() {
    if (_timer) clearInterval(_timer);
    if (_statsInterval) clearInterval(_statsInterval);
    _timer = null; _statsInterval = null; _seconds = 0;
    if (el.cpQuality()) el.cpQuality().style.display = 'none';
    if (el.quality()) el.quality().style.display = 'none';
    // Clean up CSS animation classes
    el.cpTimer()?.classList.remove('timer-active');
    el.cpStatus()?.classList.remove('connecting-status');
    const remoteTile = $('cp-remote');
    if (remoteTile) remoteTile.classList.remove('connected-tile');
  }

  /* ── Signaling ── */
  async function _sendSignal(type, payload, overrideTarget = null) {
    const target = overrideTarget || _partnerId;
    if (!target) return;
    const res = await api('call_signal', 'POST', { target_id: target, type, payload });
    if (res && res.ok && res.signal_id && window.advanceCallSigCursor) window.advanceCallSigCursor(res.signal_id);
  }

  /* ── PiP ── */
  let _pipCanvas = null, _pipCtx = null, _pipReady = false, _pipAvi = null;
  function _pipDraw() {
    if (!_pipCtx || !_callState) return;
    const ctx = _pipCtx, W = 320, H = 180;
    const rv = el.remoteVideo();
    ctx.fillStyle = '#100d1a'; ctx.fillRect(0, 0, W, H);
    if (rv && rv.srcObject && !rv.paused && _remoteStream && _remoteStream.getVideoTracks().length > 0) {
      ctx.drawImage(rv, 0, 0, W, H);
    } else {
      const g = ctx.createRadialGradient(W/2,H/2,8,W/2,H/2,W/1.4);
      g.addColorStop(0,'rgba(109,40,217,.35)'); g.addColorStop(1,'transparent');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      const cx = W/2, cy = 72, r = 38;
      ctx.save(); ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.clip();
      if (_pipAvi && _pipAvi.complete && _pipAvi.naturalWidth) ctx.drawImage(_pipAvi,cx-r,cy-r,r*2,r*2);
      else { ctx.fillStyle='#4c1d95'; ctx.fillRect(cx-r,cy-r,r*2,r*2); }
      ctx.restore();
    }
    const cx = W/2, cy = 72, r = 38;
    ctx.fillStyle='#fff'; ctx.font='600 14px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='top';
    ctx.fillText(el.cpRemoteName()?.textContent || _partnerName || '', cx, cy+r+10);
    const label = (el.cpTimer() && el.cpTimer().style.display!=='none') ? el.cpTimer().textContent : (el.cpStatus()?.textContent||'');
    ctx.fillStyle='rgba(255,255,255,.55)'; ctx.font='13px sans-serif';
    ctx.fillText(label, cx, cy+r+28);
  }
  function _pipPrepare() {
    if (!_pipCanvas) { _pipCanvas = document.createElement('canvas'); _pipCanvas.width=320; _pipCanvas.height=180; _pipCtx=_pipCanvas.getContext('2d'); }
    _pipDraw();
    const v = el.pipVideo(); if (!v) return;
    v.srcObject = _pipCanvas.captureStream(4); v.muted = true;
    v.play().then(() => { _pipReady = true; }).catch(() => {});
  }
  function _pipExit() {
    if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
    _pipActive = false;
  }

  /* ── Panel show/hide ── */
  function _showPanel() {
    const panel = el.panel(); const mini = el.miniBar();
    if (!panel) return;
    panel.style.display = 'flex';
    if (mini) mini.style.display = 'none';
    _panelCollapsed = false;
  }
  function _hidePanel() {
    const panel = el.panel(); if (!panel) return;
    // Exit fullscreen before hiding
    if (_panelFullscreen) {
      _panelFullscreen = false;
      panel.classList.remove('cp-fullscreen');
    }
    panel.style.display = 'none';
  }
  function _showMiniBar() {
    const mini = el.miniBar(); if (!mini) return;
    // Exit fullscreen when collapsing to mini-bar
    const panel = el.panel();
    if (_panelFullscreen && panel) {
      _panelFullscreen = false;
      panel.classList.remove('cp-fullscreen');
      const icon = el.cpFsIcon();
      if (icon) icon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-5h-4m4 0v4m0-4l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"/>';
    }
    mini.style.display = 'flex'; _panelCollapsed = true; _hidePanel();
  }
  function _collapsePanel() { _showMiniBar(); }
  function _expandPanel() {
    if (_panelCallerChatId && S.chatId !== _panelCallerChatId) {
      if (window.openChat) { const c = (S.chats||[]).find(x => x.chat_id === _panelCallerChatId); if (c) window.openChat(c); }
    }
    const panel = el.panel();
    if (panel) { panel.classList.add('expanding'); setTimeout(() => panel.classList.remove('expanding'), 350); }
    _showPanel();
  }

  function _syncMiniAv() {
    const mav = el.cmbAv(); if (!mav) return;
    mav.innerHTML = aviHtml(_partnerName, _partnerAvKey);
    if (el.cmbName()) el.cmbName().textContent = _partnerName || '—';
  }

  function _syncPanelAv() {
    const remAv = el.cpRemoteAv(); const remName = el.cpRemoteName();
    if (remAv) remAv.innerHTML = aviHtml(_partnerName, _partnerAvKey);
    if (remName) remName.textContent = _partnerName || '—';
    const locAv = el.cpLocalAv();
    if (locAv) locAv.innerHTML = aviHtml(S.user?.nickname, S.user?.avatar_url);
    // Apply avatar accent color to tile backgrounds
    const remTile = $('cp-remote'); const locTile = $('cp-local');
    if (remTile && typeof _avatarColor === 'function') {
      remTile.style.background = _avatarColor(_partnerName) + '22';
    }
    if (locTile && typeof _avatarColor === 'function') {
      locTile.style.background = _avatarColor(S.user?.nickname) + '22';
    }
  }

  const _isMobile = () => window.__isMobileView ? window.__isMobileView() : window.matchMedia('(max-width: 680px)').matches;

  /* ── UI State ── */
  function _setUIState(name, avHtml, isRinging, isVideo) {
    _partnerName = name; _partnerAv = avHtml;
    _muted = false; _video = isVideo; _pipActive = false;
    _updateMuteUI(); _updateVideoUI();

    if (isRinging) {
      // Always show incoming modal for ringing
      const ov = el.overlay(); if (!ov) return;
      if (el.name()) el.name().textContent = name;
      if (el.status()) { el.status().textContent = 'Входящий звонок…'; el.status().style.display = ''; }
      if (el.timer()) el.timer().style.display = 'none';
      const av = el.avatar();
      if (av) {
        let inner = avHtml || '';
        if (inner && /^<img\s/i.test(inner.trim())) inner = `<div class="call-av-img-wrap">${inner}</div>`;
        av.innerHTML = '<div class="call-avatar-ring"></div>' + inner;
        av.style.display = '';
      }
      if (el.incoming()) el.incoming().style.display = 'flex';
      if (el.actions()) el.actions().style.display = 'none';
      if (el.btnEnd()) el.btnEnd().style.display = 'none';
      ov.classList.add('on');
      playRing();
      _resetSwipeKnob();
    } else if (_isMobile()) {
      // Mobile: use the full modal for active calls too
      const ov = el.overlay(); if (!ov) return;
      if (el.name()) el.name().textContent = name;
      if (el.status()) { el.status().textContent = 'Ожидание ответа…'; el.status().style.display = ''; }
      if (el.timer()) el.timer().style.display = 'none';
      const av = el.avatar();
      if (av) {
        let inner = avHtml || '';
        if (inner && /^<img\s/i.test(inner.trim())) inner = `<div class="call-av-img-wrap">${inner}</div>`;
        av.innerHTML = '<div class="call-avatar-ring"></div>' + inner;
        av.style.display = '';
      }
      if (el.incoming()) el.incoming().style.display = 'none';
      if (el.actions()) el.actions().style.display = 'flex';
      if (el.btnEnd()) el.btnEnd().style.display = 'flex';
      ov.classList.add('on');
    } else {
      // Desktop: show inline panel
      _syncPanelAv(); _syncMiniAv();
      if (el.cpStatus()) { el.cpStatus().textContent = 'Вызов…'; el.cpStatus().style.display = 'inline'; el.cpStatus().classList.add('connecting-status'); }
      if (el.cpTimer()) el.cpTimer().style.display = 'none';
      _showPanel();
    }

    // PiP avatar
    const imgMatch = avHtml ? avHtml.match(/<img[^>]*src=["']([^"']+)["']/i) : null;
    if (imgMatch) { _pipAvi = new Image(); _pipAvi.crossOrigin = 'anonymous'; _pipAvi.src = imgMatch[1]; } else _pipAvi = null;
    _pipPrepare();
  }

  /* ── Swipe (mobile incoming) ── */
  function _resetSwipeKnob() {
    const knob = el.swipeKnob(); const bar = el.swipeBar();
    if (!knob || !bar) return;
    knob.style.transition = 'transform 0.35s cubic-bezier(.4,0,.2,1), color 0.2s';
    knob.style.transform = 'translateX(0)'; knob.style.color = '#1c1c2e';
    bar.style.setProperty('--sw-accept-op', '0'); bar.style.setProperty('--sw-decline-op', '0');
    setTimeout(() => { if (knob) knob.style.transition = ''; }, 380);
  }

  function _initSwipe() {
    const knob = el.swipeKnob(); const bar = el.swipeBar();
    if (!knob || !bar) return;
    let startX = 0, curX = 0, dragging = false;
    const THRESHOLD = 100, MAX_TRAVEL = 120;
    function onStart(e) { if (_callState !== 'ringing') return; dragging = true; startX = e.touches ? e.touches[0].clientX : e.clientX; curX = 0; knob.style.transition = 'none'; e.preventDefault(); }
    function onMove(e) {
      if (!dragging) return;
      const x = e.touches ? e.touches[0].clientX : e.clientX;
      curX = Math.max(-MAX_TRAVEL, Math.min(MAX_TRAVEL, x - startX));
      knob.style.transform = `translateX(${curX}px)`;
      const r = Math.abs(curX) / MAX_TRAVEL;
      if (curX > 0) { bar.style.setProperty('--sw-accept-op', Math.min(r*1.5,1)); bar.style.setProperty('--sw-decline-op','0'); knob.style.color = '#34c759'; }
      else if (curX < 0) { bar.style.setProperty('--sw-decline-op', Math.min(r*1.5,1)); bar.style.setProperty('--sw-accept-op','0'); knob.style.color = '#ff3b30'; }
      else { bar.style.setProperty('--sw-accept-op','0'); bar.style.setProperty('--sw-decline-op','0'); knob.style.color = '#1c1c2e'; }
      e.preventDefault();
    }
    function onEnd() {
      if (!dragging) return; dragging = false;
      if (curX >= THRESHOLD) { knob.style.transition='transform 0.25s cubic-bezier(0.34,1.56,0.64,1)'; knob.style.transform=`translateX(${MAX_TRAVEL+20}px)`; setTimeout(answerCall, 200); }
      else if (curX <= -THRESHOLD) { knob.style.transition='transform 0.25s cubic-bezier(0.34,1.56,0.64,1)'; knob.style.transform=`translateX(${-MAX_TRAVEL-20}px)`; setTimeout(_declineCall, 200); }
      else _resetSwipeKnob();
    }
    knob.addEventListener('touchstart', onStart, { passive: false });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
    knob.addEventListener('mousedown', onStart);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);
  }

  function _declineCall() {
    if (_callState !== 'ringing') return;
    _endReason = 'declined';
    _sendSignal('decline', { reason: 'rejected' });
    _sendSignal('declined_elsewhere', {}, S.user.id);
    close(true, true);
  }

  /* ── WebRTC ── */
  function _cleanupRTC() {
    clearTimeout(_iceDisconnectTimeout); _iceDisconnectTimeout = null;
    if (_pc) { _pc.close(); _pc = null; }
    if (_localStream) { _localStream.getTracks().forEach(t => t.stop()); _localStream = null; }
    if (_screenStream) { _screenStream.getTracks().forEach(t => t.stop()); _screenStream = null; }
    _remoteStream = null;
    const lv = el.localVideo(), rv = el.remoteVideo();
    if (lv) { lv.srcObject = null; lv.style.display = 'none'; }
    if (rv) { rv.srcObject = null; rv.classList.remove('has-video'); }
    $('call-modal-inner')?.classList.remove('connected','remote-video-active','video-active');
    el.cpBtnShare()?.classList.remove('active');
    if (el.cpScreen()) el.cpScreen().style.display = 'none';
    stopRing(); stopOutgoingRing();
  }

  async function _initMedia(video) {
    if (_localStream) return true;
    try {
      _localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: { facingMode: 'user' } });
    } catch(e) {
      try { _localStream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
      catch(e2) { toast('Нет доступа к микрофону/камере', 'err'); return false; }
    }
    if (_muted) _localStream.getAudioTracks().forEach(t => t.enabled = false);
    const vTrack = _localStream.getVideoTracks()[0];
    if (vTrack) vTrack.enabled = _video;
    const lv = el.localVideo(); if (lv) lv.srcObject = _localStream;
    _updateMuteUI(); _updateVideoUI();
    return true;
  }

  async function _createPeerConnection() {
    const stunServers = await getWorkingStunServers(2);
    const rtcConfig = {
      iceServers: [
        ...stunServers,
        { urls: 'turns:relay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turn:relay.metered.ca:80?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
      ]
    };
    // Speed up ICE gathering by pre-allocating candidate pool (if supported)
    if (RTCPeerConnection.prototype.hasOwnProperty('iceCandidatePoolSize') ||
        'iceCandidatePoolSize' in RTCPeerConnection.prototype) {
      rtcConfig.iceCandidatePoolSize = 10;
    }
    // Bundle all media on a single transport for faster connection (if supported)
    if (RTCPeerConnection.prototype.hasOwnProperty('bundlePolicy') ||
        'bundlePolicy' in RTCPeerConnection.prototype) {
      rtcConfig.bundlePolicy = 'max-bundle';
    }
    _pc = new RTCPeerConnection(rtcConfig);

    _pc.onnegotiationneeded = async () => {
      if (_callState !== 'connected') return;
      if (_isNegotiating || _pc.signalingState !== 'stable') return;
      _isNegotiating = true;
      try {
        const offer = await _pc.createOffer();
        await _pc.setLocalDescription(offer);
        _sendSignal('renegotiate', { sdp: _pc.localDescription, video: _video });
      } catch(e) { console.warn('[Call] Renegotiation error', e); }
      finally { _isNegotiating = false; }
    };

    _pc.onicecandidate = e => { if (e.candidate) _sendSignal('candidate', e.candidate); };

    _pc.ontrack = e => {
      if (!_remoteStream) {
        _remoteStream = e.streams[0] || new MediaStream();
        const rv = el.remoteVideo();
        if (rv) { rv.srcObject = _remoteStream; rv.play().catch(() => {}); }
      }
      if (!_remoteStream.getTracks().includes(e.track)) _remoteStream.addTrack(e.track);
      e.track.onmute = () => _updateVideoUI();
      e.track.onunmute = () => _updateVideoUI();
      e.track.onended = () => _updateVideoUI();
      _remoteStream.onaddtrack = () => _updateVideoUI();
      _remoteStream.onremovetrack = () => _updateVideoUI();
      _updateVideoUI();
    };

    const _checkConnected = () => {
      if (_callState === 'connected' || _callState === 'ended') return;
      if (_pc.connectionState === 'connected' || _pc.iceConnectionState === 'connected' || _pc.iceConnectionState === 'completed') {
        clearTimeout(_iceDisconnectTimeout); _endReason = 'ended'; _iceDisconnectTimeout = null;
        _setCallState('connected');
        if (el.cpStatus()) { el.cpStatus().textContent = 'Соединено'; el.cpStatus().classList.remove('connecting-status'); }
        if (el.status()) { el.status().textContent = 'Соединено'; el.status().style.display = 'none'; }
        // Add glow ring class to remote tile
        const remoteTile = $('cp-remote');
        if (remoteTile) remoteTile.classList.add('connected-tile');
        stopRing(); _startTimer();
      }
    };

    _pc.onconnectionstatechange = () => {
      if (_callState === 'ended' || _callState === 'idle') return;
      _checkConnected();
      if (_pc.connectionState === 'failed') close(false, false);
    };

    _pc.oniceconnectionstatechange = () => {
      if (_callState === 'ended' || _callState === 'idle') return;
      _checkConnected();
      if (_pc.iceConnectionState === 'failed') {
        close(false, false);
      } else if (_pc.iceConnectionState === 'disconnected') {
        if (el.cpStatus()) { el.cpStatus().textContent = 'Переподключение…'; el.cpStatus().style.display = 'inline'; el.cpStatus().classList.add('connecting-status'); }
        if (el.cpTimer()) el.cpTimer().style.display = 'none';
        if (el.status()) { el.status().textContent = 'Переподключение…'; el.status().style.display = ''; }
        if (el.timer()) el.timer().style.display = 'none';
        clearTimeout(_iceDisconnectTimeout);
        _iceDisconnectTimeout = setTimeout(() => {
          if (_pc && (_pc.iceConnectionState === 'disconnected' || _pc.iceConnectionState === 'failed')) close(false, false);
        }, 5000);
      } else if (_pc.iceConnectionState === 'connected' || _pc.iceConnectionState === 'completed') {
        clearTimeout(_iceDisconnectTimeout); _iceDisconnectTimeout = null;
        if (el.cpTimer()) el.cpTimer().style.display = 'inline';
        if (el.cpStatus()) { el.cpStatus().style.display = 'none'; el.cpStatus().classList.remove('connecting-status'); }
        if (el.timer()) el.timer().style.display = '';
        if (el.status()) el.status().style.display = 'none';
      }
    };

    if (_localStream) {
      _localStream.getTracks().forEach(track => {
        const sender = _pc.addTrack(track, _localStream);
        if (track.kind === 'video' && !_video) {
          const tc = _pc.getTransceivers().find(t => t.sender === sender);
          if (tc) tc.direction = 'inactive';
        }
      });
    }
  }

  /* ── Outgoing Call ── */
  async function startCall({ id, name = '—', avatarHtml = '', isVideo = false, signalId = null } = {}) {
    if (_callState !== 'idle') return;
    if (window._remoteCallActive) { toast('У вас уже есть активный звонок на другом устройстве', 'err'); return; }
    if (!id) return;
    _isInitiator = true; _endReason = 'missed';
    _partnerSid = signalId || S.partner?.partner_signal_id || S.partner?.signal_id;
    _panelCallerChatId = S.chatId || null;
    _setCallState('calling'); _partnerId = id; _partnerName = name; _partnerAv = avatarHtml;
    // Store raw avatar key so aviHtml() can build URL with current user's token
    _partnerAvKey = S.partner?.partner_avatar || null;
    _setUIState(name, avatarHtml, false, isVideo);
    if (!await _initMedia(isVideo)) { close(); return; }
    if (_callState !== 'calling') { _cleanupRTC(); return; }
    await _createPeerConnection();
    if (_callState !== 'calling') { _cleanupRTC(); return; }
    const offer = await _pc.createOffer();
    await _pc.setLocalDescription(offer);
    _sendSignal('call_active', { partnerId: id, ts: Date.now() }, S.user?.id);
    await _sendSignal('offer', { sdp: offer, name: S.user?.nickname, av: S.user?.avatar_url, video: isVideo, ts: Date.now() });
  }

  /* ── Incoming signal handler ── */
  let _pendingOffer = null;
  let _processedSignals = new Set();

  function handleSignal(data) {
    if (data.id && _processedSignals.has(data.id)) return;
    if (data.id) {
      _processedSignals.add(data.id);
      if (_processedSignals.size > 200) { const arr = Array.from(_processedSignals).slice(-100); _processedSignals.clear(); arr.forEach(id => _processedSignals.add(id)); }
    }
    let p;
    try { p = typeof data.payload === 'string' ? JSON.parse(data.payload) : data.payload; } catch(e) { p = {}; }

    if (+data.sender_id === +S.user?.id) {
      if (data.type === 'call_active') { window._remoteCallActive = true; window._remoteCallPartner = p.partnerId||null; clearTimeout(_remoteCallTimeout); _remoteCallTimeout = setTimeout(() => { window._remoteCallActive = false; window._remoteCallPartner = null; }, 35000); return; }
      if (data.type === 'call_inactive') { window._remoteCallActive = false; window._remoteCallPartner = null; clearTimeout(_remoteCallTimeout); return; }
      if ((data.type === 'answered_elsewhere' || data.type === 'declined_elsewhere') && _callState === 'ringing') { _endReason = 'answered_elsewhere'; close(true, true); }
      else { /* echo — ignore */ }
      return;
    }

    if (data.type === 'offer') {
      _isInitiator = false;
      if (p.ts && Date.now() - p.ts > 30000) return;
      if (_callState !== 'idle' || window._remoteCallActive) {
        if ((_callState !== 'idle' && _partnerId === +data.sender_id) || (window._remoteCallActive && window._remoteCallPartner === +data.sender_id)) return;
        const prev = _partnerId; _partnerId = +data.sender_id;
        _sendSignal('decline', { reason: 'busy' }).then(() => { _partnerId = prev; });
        return;
      }
      _sendSignal('is_ringing', { ts: Date.now() }, +data.sender_id);
      _iceQueue = []; _partnerId = +data.sender_id; _partnerName = p.name || 'Пользователь';
      // Use partner_avatar from chat list if available (proper key), else fall back to what the caller sent
      const partnerChat = (S.chats||[]).find(c => +c.partner_id === +data.sender_id || (c.chat_id && +c.partner_id === +data.sender_id));
      _partnerAvKey = partnerChat?.partner_avatar || p.av || null;
      _partnerAv = _partnerAvKey ? aviHtml(_partnerName, _partnerAvKey) : '';
      _pendingOffer = p.sdp || p;
      _panelCallerChatId = S.chatId || null;
      _setCallState('ringing');
      _setUIState(_partnerName, _partnerAv, true, p.video);
      if (p.video) _initMedia(true).catch(() => {});
    }
    else if (data.type === 'renegotiate') {
      if (_partnerId !== +data.sender_id || !_pc) return;
      const sdpObj = p.sdp || p;
      if (p.video && !_video) {
        const tc = _pc.getTransceivers().find(t => t.receiver?.track?.kind === 'video');
        if (tc && tc.direction === 'inactive') tc.direction = 'recvonly';
      }
      _pc.setRemoteDescription(new RTCSessionDescription(sdpObj))
        .then(() => _pc.createAnswer())
        .then(answer => _pc.setLocalDescription(answer).then(() => { _sendSignal('answer', { sdp: _pc.localDescription }); _updateVideoUI(); }))
        .catch(e => console.warn('[Call] Renegotiation error', e));
    }
    else if (data.type === 'is_ringing') {
      if (_callState === 'calling') { if (el.cpStatus()) el.cpStatus().textContent = 'Вызов…'; if (el.status()) el.status().textContent = 'Вызов…'; playOutgoingRing(); }
    }
    else if (data.type === 'answer' && _pc && (_callState === 'calling' || _callState === 'answering' || _callState === 'connected')) {
      stopOutgoingRing();
      if (_callState !== 'connected') {
        if (el.cpStatus()) { el.cpStatus().textContent = 'Подключение…'; el.cpStatus().style.display = 'inline'; el.cpStatus().classList.add('connecting-status'); }
        if (el.status()) { el.status().style.display = ''; el.status().textContent = 'Подключение…'; }
      }
      const sdpObj = p.sdp || p;
      _pc.setRemoteDescription(new RTCSessionDescription(sdpObj))
        .then(() => { _iceQueue.forEach(c => _pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {})); _iceQueue = []; _updateVideoUI(); })
        .catch(e => console.warn('[Call] setRemote answer', e));
    }
    else if (data.type === 'candidate' && _pc) {
      if (_pc.remoteDescription?.type) _pc.addIceCandidate(new RTCIceCandidate(p)).catch(() => {});
      else _iceQueue.push(p);
    }
    else if (data.type === 'decline') {
      if (_callState === 'calling') {
        _endReason = 'declined';
        const txt = p.reason === 'busy' ? 'Линия занята' : 'Отклонён';
        if (el.cpStatus()) { el.cpStatus().textContent = txt; el.cpStatus().style.display = 'inline'; }
        if (el.status()) { el.status().style.display = ''; el.status().textContent = txt; }
        close(true, false);
      }
    }
    else if (data.type === 'end') {
      if (_callState !== 'idle' && _callState !== 'ended') close(true, false);
    }
  }

  /* ── Answer ── */
  async function answerCall() {
    if (_callState !== 'ringing' || !_pendingOffer) return;
    stopRing();
    _sendSignal('answered_elsewhere', {}, S.user.id);
    _sendSignal('call_active', { partnerId: _partnerId, ts: Date.now() }, S.user.id);
    _setCallState('answering');

    const ov = el.overlay();

    if (!_isMobile()) {
      if (ov) ov.classList.remove('on');
      _syncPanelAv(); _syncMiniAv();
      if (el.cpStatus()) { el.cpStatus().textContent = 'Подключение…'; el.cpStatus().style.display = 'inline'; el.cpStatus().classList.add('connecting-status'); }
      if (el.cpTimer()) el.cpTimer().style.display = 'none';
      _showPanel();
      // Navigate to caller's chat if possible
      if (_partnerId && window.openChat) {
        // Find chat with this partner — best effort
        const ci = document.querySelector(`.ci[data-partner-id="${_partnerId}"]`);
        if (ci) { const cid = ci.dataset.chatId || ci.dataset.id; if (cid) { window.openChat(+cid); _panelCallerChatId = +cid; } }
      }
    } else {
      if (el.incoming()) el.incoming().style.display = 'none';
      if (el.actions()) el.actions().style.display = 'flex';
      if (el.btnEnd()) el.btnEnd().style.display = 'flex';
      if (el.status()) { el.status().style.display = ''; el.status().textContent = 'Подключение…'; }
    }

    // Start media init immediately (don't wait for UI to finish)
    const mediaReady = await _initMedia(_video);
    if (!mediaReady) { close(); return; }
    if (_callState !== 'answering') { _cleanupRTC(); return; }
    await _createPeerConnection();
    if (_callState !== 'answering') { _cleanupRTC(); return; }
    try {
      const offerDesc = typeof _pendingOffer === 'string' ? { type: 'offer', sdp: _pendingOffer } : _pendingOffer;
      await _pc.setRemoteDescription(new RTCSessionDescription(offerDesc));
      _iceQueue.forEach(c => _pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {}));
      _iceQueue = [];
      const answer = await _pc.createAnswer();
      await _pc.setLocalDescription(answer);
      await _sendSignal('answer', { sdp: answer });
    } catch(e) { console.warn('[Call] Answer failed', e); close(); }
    _pendingOffer = null;
  }

  /* ── Close ── */
  function close(skipEndSignal = false, instant = true) {
    if (_callState === 'idle' || _callState === 'ended') return;
    if (!skipEndSignal && _callState !== 'ringing') _sendSignal('end', {});
    if (_isInitiator && _partnerSid && _endReason !== 'answered_elsewhere') {
      const logBody = _endReason === 'ended' ? `[call:ended:${_seconds}]` : _endReason === 'declined' ? `[call:declined]` : `[call:missed]`;
      api('send_message', 'POST', { to_signal_id: _partnerSid, body: logBody }).catch(() => {});
      _isInitiator = false; _partnerSid = null;
    }
    _setCallState('ended');
    stopRing(); stopOutgoingRing(); playEndSound();

    const finishClose = () => {
      _setCallState('idle'); _partnerId = null;
      _sendSignal('call_inactive', { ts: Date.now() }, S.user?.id);
      _sendSignal('call_inactive', { ts: Date.now() }, S.user?.id);
      _stopTimer(); _pipExit(); _cleanupRTC();
      const ov = el.overlay(); if (ov) ov.classList.remove('on');
      _hidePanel();
      const mini = el.miniBar(); if (mini) mini.style.display = 'none';
      _panelCallerChatId = null;
    };

    if (instant) {
      finishClose();
    } else {
      const endTxt = 'Звонок завершён';
      if (el.cpStatus()) { el.cpStatus().textContent = endTxt; el.cpStatus().style.display = 'inline'; }
      if (el.cpTimer()) el.cpTimer().style.display = 'none';
      if (el.status()) { el.status().style.display = ''; el.status().textContent = endTxt; }
      if (el.timer()) el.timer().style.display = 'none';
      const actions = el.actions(); if (actions) actions.style.pointerEvents = 'none';
      setTimeout(() => { if (actions) actions.style.pointerEvents = ''; finishClose(); }, 1500);
    }
  }

  /* ── Video toggle ── */
  async function _toggleVideo() {
    if (!_localStream) return;
    let vTrack = _localStream.getVideoTracks()[0];
    if (!vTrack) {
      try {
        const vs = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
        vTrack = vs.getVideoTracks()[0]; _localStream.addTrack(vTrack);
        const lv = el.localVideo(); if (lv) lv.srcObject = _localStream;
        if (_pc) {
          const sender = _pc.addTrack(vTrack, _localStream);
          const tc = _pc.getTransceivers().find(t => t.sender === sender);
          if (tc) tc.direction = 'sendrecv';
        }
      } catch(e) { toast('Камера не найдена', 'err'); return; }
    }
    _video = !_video; vTrack.enabled = _video; _updateVideoUI();
    if (_pc) {
      const tc = _pc.getTransceivers().find(t => t.sender?.track === vTrack);
      if (tc) tc.direction = _video ? 'sendrecv' : 'recvonly';
    }
  }

  /* ── Chat switch hook ── */
  window.onCallChatSwitch = function(newChatId) {
    if (_callState === 'idle' || _callState === 'ended') return;
    if (newChatId !== _panelCallerChatId) _collapsePanel();
    else _showPanel();
  };

  /* ── Panel resize ── */
  function _initPanelResize() {
    const handle = el.cpResizeHandle(); const panel = el.panel();
    if (!handle || !panel) return;
    let startY = 0, startH = 0, dragging = false;

    const onMove = e => {
      if (!dragging) return;
      const dy = e.clientY - startY;  // positive = drag down = grow panel
      const parent = panel.parentElement;
      const maxH = parent ? parent.offsetHeight * 0.9 : window.innerHeight * 0.9;
      const newH = Math.max(180, Math.min(maxH, startH + dy));
      panel.style.height = newH + 'px';
      // Exit fullscreen if manually resized
      if (_panelFullscreen) {
        _panelFullscreen = false;
        panel.classList.remove('cp-fullscreen');
        const icon = el.cpFsIcon();
        if (icon) icon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-5h-4m4 0v4m0-4l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"/>';
        if (el.cpFullscreen()) el.cpFullscreen().title = 'Распахнуть';
      }
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('dragging');
      document.body.style.userSelect = '';
    };

    handle.addEventListener('mousedown', e => {
      dragging = true; startY = e.clientY; startH = panel.offsetHeight;
      handle.classList.add('dragging'); document.body.style.userSelect = 'none'; e.preventDefault();
    });
    // Touch support
    handle.addEventListener('touchstart', e => {
      dragging = true; startY = e.touches[0].clientY; startH = panel.offsetHeight;
      handle.classList.add('dragging'); e.preventDefault();
    }, { passive: false });
    handle.addEventListener('touchmove', e => {
      if (!dragging) return;
      const dy = e.touches[0].clientY - startY;
      const parent = panel.parentElement;
      const maxH = parent ? parent.offsetHeight * 0.9 : window.innerHeight * 0.9;
      panel.style.height = Math.max(180, Math.min(maxH, startH + dy)) + 'px';
    }, { passive: false });
    handle.addEventListener('touchend', onUp);

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  /* ── Audio device picker ── */
  async function _openDevPicker(btn) {
    const picker = el.devPicker(); if (!picker) return;
    if (picker.style.display !== 'none') { picker.style.display = 'none'; return; }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inSel = $('cdp-input-select'); const outSel = $('cdp-output-select');
      if (inSel) {
        inSel.innerHTML = '';
        devices.filter(d => d.kind === 'audioinput').forEach(d => {
          const opt = document.createElement('option'); opt.value = d.deviceId; opt.textContent = d.label || 'Микрофон'; inSel.appendChild(opt);
        });
      }
      if (outSel) {
        outSel.innerHTML = '';
        devices.filter(d => d.kind === 'audiooutput').forEach(d => {
          const opt = document.createElement('option'); opt.value = d.deviceId; opt.textContent = d.label || 'Динамик'; outSel.appendChild(opt);
        });
        if (!outSel.options.length) { const opt = document.createElement('option'); opt.textContent = 'Системный динамик'; outSel.appendChild(opt); }
      }
    } catch(e) {}

    $('cdp-input-select')?.addEventListener('change', async ev => {
      const devId = ev.target.value;
      if (_localStream) {
        const ns = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: devId } }, video: false }).catch(() => null);
        if (ns) {
          const old = _localStream.getAudioTracks()[0]; if (old) { _localStream.removeTrack(old); old.stop(); }
          const nw = ns.getAudioTracks()[0];
          if (nw) { _localStream.addTrack(nw); nw.enabled = !_muted; const sender = _pc?.getSenders().find(s => s.track?.kind === 'audio'); if (sender) sender.replaceTrack(nw).catch(() => {}); }
        }
      }
    }, { once: true });

    $('cdp-output-select')?.addEventListener('change', ev => {
      const rv = el.remoteVideo(); if (rv && rv.setSinkId) rv.setSinkId(ev.target.value).catch(() => {});
    }, { once: true });

    if (btn) {
      const rect = btn.getBoundingClientRect();
      picker.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
      picker.style.left = rect.left + 'px';
    }
    picker.style.display = 'block';
  }

  /* ── Init ── */
  function _init() {
    _initSwipe();
    _initPanelResize();

    // Incoming modal buttons
    el.btnEnd()?.addEventListener('click', () => close(false, true));
    el.btnAccept()?.addEventListener('click', answerCall);
    el.btnDecline()?.addEventListener('click', _declineCall);
    el.btnMute()?.addEventListener('click', () => { _muted = !_muted; _updateMuteUI(); if (_localStream) _localStream.getAudioTracks().forEach(t => t.enabled = !_muted); });
    el.btnVid()?.addEventListener('click', _toggleVideo);

    // Panel buttons
    el.cpBtnEnd()?.addEventListener('click', () => close(false, true));
    el.cpCollapse()?.addEventListener('click', _collapsePanel);
    el.cpFullscreen()?.addEventListener('click', _toggleFullscreen);
    el.cpBtnMute()?.addEventListener('click', () => { _muted = !_muted; _updateMuteUI(); if (_localStream) _localStream.getAudioTracks().forEach(t => t.enabled = !_muted); });
    el.cpBtnVideo()?.addEventListener('click', _toggleVideo);

    // Screen share
    el.cpBtnShare()?.addEventListener('click', async () => {
      if (_screenStream) {
        _screenStream.getTracks().forEach(t => t.stop()); _screenStream = null;
        if (el.cpScreen()) el.cpScreen().style.display = 'none';
        el.cpBtnShare()?.classList.remove('active'); return;
      }
      try {
        _screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        const sv = el.screenVideo(); if (sv) { sv.srcObject = _screenStream; sv.play().catch(() => {}); }
        if (el.cpScreen()) el.cpScreen().style.display = 'flex';
        el.cpBtnShare()?.classList.add('active');
        if (_pc) {
          const vt = _screenStream.getVideoTracks()[0];
          if (vt) { _pc.addTrack(vt, _screenStream); vt.addEventListener('ended', () => { _screenStream = null; if (el.cpScreen()) el.cpScreen().style.display = 'none'; el.cpBtnShare()?.classList.remove('active'); }); }
        }
      } catch(e) { console.warn('[Call] Screen share error', e); }
    });

    // Audio device picker
    el.cpBtnAudioDev()?.addEventListener('click', (e) => _openDevPicker(e.currentTarget));

    // Volume context menu
    $('cp-remote')?.addEventListener('contextmenu', e => {
      e.preventDefault();
      const ctx = el.volCtx(); if (!ctx) return;
      ctx.style.display = 'block';
      ctx.style.left = Math.min(e.clientX, window.innerWidth - 220) + 'px';
      ctx.style.top  = Math.min(e.clientY, window.innerHeight - 160) + 'px';
    });
    el.cvcSlider()?.addEventListener('input', e => {
      const val = +e.target.value; _remoteVolume = val / 100;
      if (el.cvcVal()) el.cvcVal().textContent = val + '%';
      e.target.style.setProperty('--val', val / 2);
      const rv = el.remoteVideo(); if (rv) rv.volume = Math.min(1, _remoteVolume);
    });
    $('cvc-btn-input')?.addEventListener('click', () => { el.volCtx().style.display='none'; _openDevPicker(el.cpBtnAudioDev()); });
    $('cvc-btn-output')?.addEventListener('click', () => { el.volCtx().style.display='none'; _openDevPicker(el.cpBtnAudioDev()); });

    // Mini-bar — use onclick (more reliable when element starts as display:none)
    const _cmbEnd = el.cmbBtnEnd();
    const _cmbExp = el.cmbBtnExpand();
    const _miniBar = el.miniBar();
    if (_cmbEnd)  _cmbEnd.onclick  = e => { e.stopPropagation(); close(false, true); };
    if (_cmbExp)  _cmbExp.onclick  = e => { e.stopPropagation(); _expandPanel(); };
    if (_miniBar) _miniBar.onclick = e => { if (!e.target.closest('button')) _expandPanel(); };

    // Close popups on outside click
    document.addEventListener('click', e => {
      const ctx = el.volCtx(); if (ctx && ctx.style.display!=='none' && !ctx.contains(e.target)) ctx.style.display = 'none';
      const picker = el.devPicker(); if (picker && picker.style.display!=='none' && !picker.contains(e.target) && e.target !== el.cpBtnAudioDev()) picker.style.display = 'none';
    });

    // Header call button
    $('btn-hdr-call')?.addEventListener('click', () => {
      startCall({ id: S.partner?.partner_id || S.partner?.id, name: $('hdr-name')?.textContent || '—', avatarHtml: $('hdr-av')?.innerHTML || '', signalId: S.partner?.partner_signal_id || S.partner?.signal_id });
    });
    const pmCallBtn = $('pm-btn-call'); const pmVideoBtn = $('pm-btn-video');
    if (pmCallBtn)  pmCallBtn.onclick  = () => startCall({ id: S.partner?.partner_id || S.partner?.id, name: $('pm-partner-name')?.textContent, avatarHtml: $('pm-hero-avi')?.innerHTML, isVideo: false,  signalId: S.partner?.partner_signal_id || S.partner?.signal_id });
    if (pmVideoBtn) pmVideoBtn.onclick = () => startCall({ id: S.partner?.partner_id || S.partner?.id, name: $('pm-partner-name')?.textContent, avatarHtml: $('pm-hero-avi')?.innerHTML, isVideo: true,   signalId: S.partner?.partner_signal_id || S.partner?.signal_id });

    window.addEventListener('beforeunload', () => { if (_callState !== 'idle') close(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _init);
  else _init();

  return { startCall, handleSignal, close, answerCall };
})();
/* ══ VOICE MESSAGE — Telegram-style Recording, Preview, Playback, Upload ═══ */
window.VoiceMsg = (function () {
  'use strict';

  /* ── Structured State ───────────────────────────────────────── */
  const state = {
    recorder: { mediaRecorder: null, audioCtx: null, analyser: null, stream: null, chunks: [], recStart: 0, timer: null, isRecording: false, isPaused: false },
    overlays: { rec: null, locked: null, preview: null },
    pointer: { startX: 0, startY: 0, swipeCancel: false, swipeLock: false },
    locked: { timer: null, cleanup: null, swipeStartX: 0, swiping: false, isLocked: false },
    preview: { blob: null, duration: 0, waveform: [], audio: null, playing: false, animFrame: null, isPreviewMode: false },
    playback: { audio: null, btn: null, container: null },
    ui: { miniPlayer: null },
    _recAnimFrame: null,
  };

  /* ── Constants ─────────────────────────────────────────────── */
  const BAR_COUNT = 44;
  const REC_BAR_COUNT = 48;
  const MIN_DURATION = 1;
  const MAX_DURATION = 300;
  const LOCK_THRESHOLD = 60;
  const CANCEL_THRESHOLD = 100;
  const CANCEL_COMPLETE = 240;
  const LOCKED_CANCEL_THRESHOLD = 30;
  const LOCKED_CANCEL_COMPLETE = 120;
  const MAX_CACHE_SIZE = 20;
  const HINT_HIDE_DELAY = 800;
  const SEND_ANIM_DELAY = 220;
  const SEND_BTN_ANIM_MS = 400;
  const TIMER_INTERVAL = 200;
  const STT_CACHE_PREFIX = 'vstt_';
  const STT_CACHE_MAX = 200;
  const STT_CACHE_TTL = 30 * 24 * 3600 * 1000; // 30 дней

  const PLAY_SVG_SM = '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M8 5v14l11-7z"/></svg>';
  const PAUSE_SVG_SM = '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>';
  const PLAY_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
  const PAUSE_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>';

  const API_BASE = 'https://initial.su/api/';

  /* ── Audio Cache (LRU) ─────────────────────────────────────── */
  const audioCache = new Map();
  function cacheAudio(url, audio) {
    if (audioCache.size >= MAX_CACHE_SIZE) {
      const oldest = audioCache.keys().next().value;
      const old = audioCache.get(oldest);
      if (old) { old.pause(); old.src = ''; }
      audioCache.delete(oldest);
    }
    audioCache.set(url, audio);
  }
  function clearAudioCache() { audioCache.forEach(a => { a.pause(); a.src = ''; }); audioCache.clear(); }

  /* ── Voice Audio WeakMap (replaces container._voiceAudio) ── */
  const voiceAudioMap = new WeakMap();

  /* ── DOM Helpers ────────────────────────────────────────────── */
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);
  const getWrap = () => $('.mfield-wrap');
  const getSendBtn = () => $('#btn-send');

  /* ── Time Formatting (exported) ────────────────────────────── */
  function formatTimeSec(s) {
    s = Math.max(0, Math.floor(s));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  /* ── Shared Helpers ────────────────────────────────────────── */

  /** Build waveform bars into a container */
  function buildBars(container, count, className, heightFn) {
    for (let i = 0; i < count; i++) {
      const bar = document.createElement('div');
      bar.className = className;
      bar.style.height = heightFn(i) + 'px';
      bar.dataset.idx = String(i);
      container.appendChild(bar);
    }
  }

  /** Release all recording resources (stream, audioCtx, analyser, chunks, mediaRecorder) */
  function cleanupRecordingResources() {
    if (state.recorder.stream) { state.recorder.stream.getTracks().forEach(t => t.stop()); state.recorder.stream = null; }
    if (state.recorder.audioCtx) { try { state.recorder.audioCtx.close(); } catch(e){} state.recorder.audioCtx = null; }
    state.recorder.analyser = null;
    state.recorder.chunks = [];
    state.recorder.mediaRecorder = null;
  }

  /** Reset wrap styles, show children, restore send button */
  function cleanupInputPanel() {
    const wrap = getWrap();
    if (wrap) {
      wrap.classList.remove('voice-rec-active');
      wrap.style.height = '';
      wrap.style.minHeight = '';
      wrap.style.maxHeight = '';
      wrap.style.overflow = '';
      wrap.style.transform = '';
      wrap.style.opacity = '';
      wrap.style.marginRight = '';
      wrap.style.borderRadius = '';
    }
    _showMfieldChildren();
    if (typeof updateSendBtn === 'function') updateSendBtn();
  }

  /* ══════════════════════════════════════════════════════════════
     RECORDING
     ══════════════════════════════════════════════════════════════ */

  async function startRecording() {
    if (state.recorder.mediaRecorder && state.recorder.mediaRecorder.state === 'recording') return;

    // Show overlay IMMEDIATELY for instant UI feedback (Telegram behavior)
    _showRecOverlay();

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      toast('Нет доступа к микрофону', 'err');
      _removeAllOverlays();
      return;
    }

    // Guard: user may have released before permission was granted
    if (!state.overlays.rec) {
      stream.getTracks().forEach(t => t.stop());
      return;
    }

    state.recorder.stream = stream;

    let mimeType = '';
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4',
    ];
    for (const mt of candidates) {
      if (MediaRecorder.isTypeSupported(mt)) { mimeType = mt; break; }
    }

    state.recorder.chunks = [];
    state.locked.isLocked = false;
    state.recorder.isRecording = true;
    state.recorder.isPaused = false;
    state.recorder.mediaRecorder = new MediaRecorder(state.recorder.stream, mimeType ? { mimeType } : {});
    state.recorder.mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) state.recorder.chunks.push(e.data); };

    state.recorder.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = state.recorder.audioCtx.createMediaStreamSource(state.recorder.stream);
    state.recorder.analyser = state.recorder.audioCtx.createAnalyser();
    state.recorder.analyser.fftSize = 128;
    source.connect(state.recorder.analyser);

    state.recorder.recStart = Date.now();
    state.recorder.timer = setInterval(_updateRecTimer, TIMER_INTERVAL);
    state.recorder.mediaRecorder.start(200);
    _startRecVisualization();
  }

  function stopRecording() {
    return new Promise((resolve) => {
      if (!state.recorder.mediaRecorder || state.recorder.mediaRecorder.state !== 'recording') {
        resolve(null);
        return;
      }

      _stopRecVisualization();
      clearInterval(state.recorder.timer);
      clearInterval(state.locked.timer);

      state.recorder.mediaRecorder.onstop = async () => {
        state.recorder.isRecording = false;
        if (state.recorder.stream) state.recorder.stream.getTracks().forEach(t => t.stop());
        if (state.recorder.audioCtx) { try { state.recorder.audioCtx.close(); } catch(e){} state.recorder.audioCtx = null; }

        const duration = Math.round((Date.now() - state.recorder.recStart) / 1000);

        // Use state check instead of _recCancelled flag
        if (duration < MIN_DURATION) {
          _removeAllOverlays();
          resolve(null);
          return;
        }

        const blob = new Blob(state.recorder.chunks, { type: state.recorder.mediaRecorder.mimeType || 'audio/webm' });
        let waveform = [];
        try {
          waveform = await generateWaveform(blob);
        } catch (e) {
          waveform = Array.from({ length: BAR_COUNT }, () => 0.2 + Math.random() * 0.8);
        }

        resolve({ blob, duration, waveform, mimeType: state.recorder.mediaRecorder.mimeType || 'audio/webm' });
      };
      state.recorder.mediaRecorder.stop();
    });
  }

  function cancelRecording() {
    state.recorder.isRecording = false;
    state.locked.isLocked = false;
    state.pointer.swipeCancel = false;
    state.pointer.swipeLock = false;
    state.locked.swiping = false;
    // Do NOT null out overlays here — _removeVoiceOverlays() needs them
    if (state.recorder.mediaRecorder && state.recorder.mediaRecorder.state === 'recording') {
      _stopRecVisualization();
      clearInterval(state.recorder.timer);
      clearInterval(state.locked.timer);
      state.recorder.mediaRecorder.onstop = () => {
        cleanupRecordingResources();
        _removeAllOverlays();
      };
      state.recorder.mediaRecorder.stop();
    } else {
      cleanupRecordingResources();
      _removeAllOverlays();
    }
  }

  /* ══════════════════════════════════════════════════════════════
     OVERLAY MANAGEMENT — show/hide approach (preserves event handlers)
     ══════════════════════════════════════════════════════════════ */

  function _hideMfieldChildren() {
    const wrap = getWrap();
    if (!wrap) return;
    const children = wrap.querySelectorAll(':scope > .attach-btn-in, :scope > .mfield, :scope > .emo-btn-in:not(.attach-btn-in)');
    children.forEach(c => { c.style.display = 'none'; });
  }

  function _showMfieldChildren() {
    const wrap = getWrap();
    if (!wrap) return;
    const children = wrap.querySelectorAll(':scope > .attach-btn-in, :scope > .mfield, :scope > .emo-btn-in:not(.attach-btn-in)');
    children.forEach(c => { c.style.display = ''; });
  }

  function _removeVoiceOverlays() {
    if (state.overlays.rec) {
      state.overlays.rec.style.background = '';
      state.overlays.rec.classList.remove('swipe-cancel');
      state.overlays.rec.remove();
      state.overlays.rec = null;
    }
    if (state.overlays.locked) {
      state.overlays.locked.style.transform = '';
      state.overlays.locked.style.background = '';
      state.overlays.locked.classList.remove('swipe-delete');
      state.overlays.locked.remove();
      state.overlays.locked = null;
    }
    // Clean up locked gesture listeners
    if (state.locked.cleanup) { state.locked.cleanup(); state.locked.cleanup = null; }
    if (state.overlays.preview) {
      if (state.preview.audio) {
        state.preview.audio.pause();
        if (state.preview.audio.src.startsWith('blob:')) URL.revokeObjectURL(state.preview.audio.src);
        state.preview.audio = null;
      }
      state.preview.playing = false;
      _stopPreviewAnim();
      state.preview.blob = null;
      state.overlays.preview.remove();
      state.overlays.preview = null;
    }
  }

  function _removeAllOverlays() {
    _removeVoiceOverlays();

    state.recorder.isRecording = false;
    state.preview.isPreviewMode = false;
    state.locked.isLocked = false;
    _restoreBtnFromSend();
    _restoreBtnFromLocked();

    cleanupInputPanel();

    const sendBtn = getSendBtn();
    if (sendBtn) sendBtn.classList.remove('hints-visible', 'recording', 'locked-stop-mode');
  }

  /* ── Recording UI (hold mode) ─────────────────────────────── */

  function _showRecOverlay() {
    const wrap = getWrap();
    if (!wrap) return;

    // Remove existing overlays first
    _removeVoiceOverlays();

    // Hide original children
    _hideMfieldChildren();

    // Activate recording mode on wrap
    wrap.classList.add('voice-rec-active');

    const overlay = document.createElement('div');
    overlay.className = 'voice-recording';
    overlay.id = 'voice-rec-overlay';
    overlay.innerHTML = `
      <div class="voice-rec-dot"></div>
      <span class="voice-rec-timer">0:00</span>
      <div class="voice-rec-wave" id="voice-rec-wave-container"></div>
      <div class="voice-lock-arrow" id="voice-lock-arrow">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="11" height="11"><polyline points="18 15 12 9 6 15"/></svg>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
      </div>
    `;

    wrap.appendChild(overlay);
    state.overlays.rec = overlay;

    // Show hints on mic button
    const sendBtn = getSendBtn();
    if (sendBtn) sendBtn.classList.add('hints-visible', 'recording');

    // Build recording waveform bars
    const wfWrap = overlay.querySelector('#voice-rec-wave-container');
    if (wfWrap) {
      buildBars(wfWrap, REC_BAR_COUNT, 'voice-rec-bar', () => 3);
    }
  }

  /* ── Lock mode (swipe up) — Telegram Desktop style ───────── */

  function _transitionToLocked() {
    if (state.locked.isLocked || !state.overlays.rec) return;
    state.locked.isLocked = true;
    state.recorder.isPaused = false;
    state.pointer.swipeLock = false;
    state.pointer.swipeCancel = false;
    state.locked.swiping = false;

    // Stop current visualization — will restart on new overlay
    _stopRecVisualization();

    const wrap = getWrap();
    if (!wrap) return;

    // ── Transform mic button into SEND icon + create floating STOP button ──
    const sendBtn = getSendBtn();
    if (sendBtn) {
      sendBtn.classList.remove('hints-visible', 'recording', 'locked-stop-mode');
      sendBtn.classList.add('voice-send-mode');
      // Hide mic, show send icon
      const icoMic = sendBtn.querySelector('.ico-mic');
      const icoSend = sendBtn.querySelector('.ico-send');
      const icoStop = sendBtn.querySelector('.ico-stop');
      if (icoMic) icoMic.style.cssText = 'opacity:0;transform:translateY(-6px) rotate(30deg);position:absolute';
      if (icoSend) icoSend.style.cssText = 'opacity:1;transform:translateY(0) rotate(0deg)';
      if (icoStop) icoStop.style.display = 'none';

      // Create floating STOP button above send button
      let stopFloat = sendBtn.querySelector('.voice-stop-float');
      if (!stopFloat) {
        stopFloat = document.createElement('button');
        stopFloat.className = 'voice-stop-float';
        stopFloat.title = 'Остановить запись';
        stopFloat.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><rect x="4" y="4" width="16" height="16" rx="3"/></svg>';
        sendBtn.appendChild(stopFloat);
      }
      stopFloat.style.display = 'flex';

      // Stop button: stops recording → shows preview
      // Must use capture on sendBtn (parent) so it fires BEFORE the send handler
      const stopHandler = (e) => {
        if (!e.target.closest('.voice-stop-float')) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        _onLockedStop();
      };
      sendBtn._stopFloatHandler = stopHandler;
      sendBtn.addEventListener('click', stopHandler, true);
      // Also keep handler on stopFloat itself as fallback (bubble)
      stopFloat.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        _onLockedStop();
      });

      // Send button click: send voice directly (no preview)
      const sendHandler = (e) => {
        // Don't intercept clicks on the floating stop button
        if (e.target.closest('.voice-stop-float')) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        _onLockedSend();
        return false;
      };
      sendBtn._lockedSendHandler = sendHandler;
      sendBtn.addEventListener('click', sendHandler, true);
    }

    // Reset wrap transforms (in case user was mid-swipe)
    wrap.style.transform = '';
    wrap.style.opacity = '';

    // Clean up previous locked gesture listeners
    if (state.locked.cleanup) { state.locked.cleanup(); state.locked.cleanup = null; }

    // ── Morph recording overlay → locked overlay IN-PLACE ──
    const overlay = state.overlays.rec;
    state.overlays.rec = null;

    overlay.className = 'voice-locked';
    overlay.id = 'voice-locked-overlay';
    overlay.style.transform = '';
    overlay.style.background = '';
    overlay.innerHTML = `
      <button class="voice-locked-delete" id="voice-locked-delete" title="Удалить">
        <svg class="trash-lid" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="1 6 3 6 21 6"/>
          <path class="trash-body" d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        </svg>
      </button>
      <span class="voice-locked-timer" id="voice-locked-timer">${_formatElapsed()}</span>
      <div class="voice-locked-wave" id="voice-locked-wave-container"></div>
    `;

    state.overlays.locked = overlay;

    // Build waveform bars in the locked container
    const wfWrap = overlay.querySelector('#voice-locked-wave-container');
    if (wfWrap) {
      buildBars(wfWrap, REC_BAR_COUNT, 'voice-rec-bar', () => 3);
    }

    // Restart visualization
    _startRecVisualization();

    // Locked timer (independent from state.recorder.timer)
    state.locked.timer = setInterval(() => {
      const timerEl = $('#voice-locked-timer');
      if (timerEl) timerEl.textContent = _formatElapsed();
    }, TIMER_INTERVAL);

    // Delete button: animated cancel
    const delBtn = $('#voice-locked-delete');
    if (delBtn) {
      delBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        _animatedCancelRecording();
      });
    }

    // ── Swipe-to-delete gesture on locked overlay (deduplicated) ──
    const ac = new AbortController();
    state.locked.cleanup = () => { ac.abort(); state.locked.cleanup = null; };

    // Mouse
    overlay.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      state.locked.swipeStartX = e.clientX;
      state.locked.swiping = false;
    }, { signal: ac.signal });

    document.addEventListener('mousemove', (e) => {
      if (!state.locked.isLocked || !state.overlays.locked) return;
      const dx = state.locked.swipeStartX - e.clientX;
      handleLockedSwipe(dx);
    }, { signal: ac.signal });

    document.addEventListener('mouseup', () => {
      if (!state.locked.swiping || !state.overlays.locked) return;
      resetLockedSwipe();
    }, { signal: ac.signal });

    // Touch
    overlay.addEventListener('touchstart', (e) => {
      if (e.target.closest('button')) return;
      state.locked.swipeStartX = e.touches[0].clientX;
      state.locked.swiping = false;
    }, { passive: true, signal: ac.signal });

    document.addEventListener('touchmove', (e) => {
      if (!state.locked.isLocked || !state.overlays.locked) return;
      const dx = state.locked.swipeStartX - e.touches[0].clientX;
      handleLockedSwipe(dx);
    }, { passive: true, signal: ac.signal });

    document.addEventListener('touchend', () => {
      if (!state.locked.swiping || !state.overlays.locked) return;
      resetLockedSwipe();
    }, { signal: ac.signal });
  }

  /** Send directly from locked mode (no preview) */
  async function _onLockedSend() {
    if (!state.locked.isLocked) return;
    state.recorder.isPaused = false;
    const result = await stopRecording();
    if (!result) { _removeAllOverlays(); return; }

    // Animated cancel of overlay + send
    const overlay = state.overlays.locked;
    if (overlay) {
      overlay.classList.add('voice-locked-sending');
    }
    const sendBtn = getSendBtn();
    if (sendBtn) {
      sendBtn.classList.add('voice-send-fly');
      setTimeout(() => sendBtn.classList.remove('voice-send-fly'), SEND_BTN_ANIM_MS);
    }

    sendVoice(result.blob, result.duration, result.waveform);

    setTimeout(() => {
      _removeAllOverlays();
    }, SEND_ANIM_DELAY);
  }

  /** Restore button from locked send mode */
  function _restoreBtnFromLocked() {
    const btn = getSendBtn();
    if (!btn) return;

    // Remove send mode
    btn.classList.remove('voice-send-mode');

    // Restore mic icon
    const icoMic = btn.querySelector('.ico-mic');
    const icoSend = btn.querySelector('.ico-send');
    const icoStop = btn.querySelector('.ico-stop');
    if (icoMic) icoMic.style.cssText = '';
    if (icoSend) icoSend.style.cssText = '';
    if (icoStop) icoStop.style.display = 'none';

    // Remove stop float
    const stopFloat = btn.querySelector('.voice-stop-float');
    if (stopFloat) {
      if (btn._stopFloatHandler) stopFloat.removeEventListener('click', btn._stopFloatHandler, true);
      stopFloat.remove();
      btn._stopFloatHandler = null;
    }

    // Remove send handler
    if (btn._lockedSendHandler) {
      btn.removeEventListener('click', btn._lockedSendHandler, true);
      btn._lockedSendHandler = null;
    }
  }

  /** Animated cancel — plays swipe-delete animation then transitions back to input */
  function _animatedCancelRecording() {
    const overlay = state.overlays.locked || state.overlays.rec || state.overlays.preview;
    if (!overlay) { cancelRecording(); return; }

    // Animate the overlay out
    overlay.classList.add('voice-anim-cancel');

    const db = overlay.querySelector('.voice-locked-delete') || overlay.querySelector('.voice-preview-delete');
    if (db) db.classList.add('trash-open');

    // Fade out the wrap as well
    const wrap = getWrap();
    if (wrap) {
      wrap.style.transition = 'opacity .25s ease, transform .25s ease';
      wrap.style.opacity = '0';
      wrap.style.transform = 'translateX(-16px)';
    }

    // Wait for animation, then clean up
    setTimeout(() => {
      cancelRecording();
    }, 300);
  }

  /* ── Locked swipe helpers (shared by mouse & touch) ── */

  function handleLockedSwipe(dx) {
    if (dx <= 0) {
      if (state.locked.swiping) resetLockedSwipe();
      return;
    }
    if (dx > LOCKED_CANCEL_THRESHOLD && !state.locked.swiping) state.locked.swiping = true;
    if (!state.locked.swiping) return;

    const progress = Math.min(1, (dx - LOCKED_CANCEL_THRESHOLD) / (LOCKED_CANCEL_COMPLETE - LOCKED_CANCEL_THRESHOLD));
    const ov = state.overlays.locked;
    ov.style.transform = `translateX(${-progress * 100}px) scale(${1 - progress * 0.12})`;
    ov.style.background = `rgba(255,59,48,${progress * 0.25})`;
    ov.classList.toggle('swipe-delete', progress > 0.1);

    const db = $('#voice-locked-delete');
    if (db) {
      db.style.transform = `scale(${1 + progress * 0.3})`;
      db.style.color = `rgba(255,59,58,${0.5 + progress * 0.5})`;
      db.classList.toggle('trash-open', progress > 0.3);
    }
    if (progress >= 1) cancelRecording();
  }

  function resetLockedSwipe() {
    state.locked.swiping = false;
    const ov = state.overlays.locked;
    if (!ov) return;
    ov.style.transform = '';
    ov.style.background = '';
    ov.classList.remove('swipe-delete');
    const db = $('#voice-locked-delete');
    if (db) { db.style.transform = ''; db.style.color = ''; db.classList.remove('trash-open'); }
  }

  async function _onLockedStop() {
    state.recorder.isPaused = false;
    const result = await stopRecording();
    if (result) {
      _showPreview(result.blob, result.duration, result.waveform);
    } else {
      _removeAllOverlays();
    }
  }


  /* ── Preview mode ─────────────────────────────────────────── */

  function _showPreview(blob, duration, waveform) {
    const wrap = getWrap();
    if (!wrap) return;

    state.preview.isPreviewMode = true;
    state.preview.blob = blob;
    state.preview.duration = duration;
    state.preview.waveform = waveform;
    state.preview.playing = false;

    // Remove any existing overlays
    _removeVoiceOverlays();

    const overlay = document.createElement('div');
    overlay.className = 'voice-preview';
    overlay.id = 'voice-preview-overlay';
    overlay.innerHTML = `
      <button class="voice-preview-delete" id="voice-preview-delete" title="Удалить">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        </svg>
      </button>
      <button class="voice-preview-play" id="voice-preview-play" title="Прослушать">
        ${PLAY_SVG_SM}
      </button>
      <div class="voice-preview-wave" id="voice-preview-wave"></div>
      <span class="voice-preview-dur" id="voice-preview-dur">${formatTimeSec(duration)}</span>
    `;

    wrap.appendChild(overlay);
    state.overlays.preview = overlay;

    // Transform mic button into send button
    _transformBtnToSend();

    // Build waveform bars in preview
    const wfWrap = overlay.querySelector('#voice-preview-wave');
    const wfData = waveform || Array.from({ length: BAR_COUNT }, () => 0.3 + Math.random() * 0.7);
    buildBars(wfWrap, wfData.length, 'voice-wf-bar', (i) => 3 + wfData[i] * 25);

    // Create audio for preview
    state.preview.audio = new Audio();
    state.preview.audio.preload = 'metadata';
    state.preview.audio.src = URL.createObjectURL(blob);

    // Play button
    $('#voice-preview-play').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      _togglePreviewPlay();
    });

    // Waveform seek
    wfWrap.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!state.preview.audio.duration || !isFinite(state.preview.audio.duration)) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      state.preview.audio.currentTime = pct * state.preview.audio.duration;
      _updatePreviewProgress();
      if (!state.preview.playing) _togglePreviewPlay();
    });

    // Delete button — animated cancel
    $('#voice-preview-delete').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      _animatedCancelRecording();
    });

    // Audio ended
    state.preview.audio.addEventListener('ended', () => {
      state.preview.playing = false;
      const playBtn = $('#voice-preview-play');
      if (playBtn) playBtn.innerHTML = PLAY_SVG_SM;
      _stopPreviewAnim();
      _resetPreviewWaveform();
      _updatePreviewDur();
    });
  }

  function _togglePreviewPlay() {
    if (!state.preview.audio) return;

    if (state.preview.playing) {
      state.preview.audio.pause();
      state.preview.playing = false;
      const playBtn = $('#voice-preview-play');
      if (playBtn) playBtn.innerHTML = PLAY_SVG_SM;
      _stopPreviewAnim();
    } else {
      state.preview.audio.play().catch(() => {});
      state.preview.playing = true;
      const playBtn = $('#voice-preview-play');
      if (playBtn) playBtn.innerHTML = PAUSE_SVG_SM;
      _startPreviewAnim();
    }
  }

  function _startPreviewAnim() {
    function tick() {
      _updatePreviewProgress();
      if (state.preview.playing) state.preview.animFrame = requestAnimationFrame(tick);
    }
    tick();
  }

  function _stopPreviewAnim() {
    if (state.preview.animFrame) { cancelAnimationFrame(state.preview.animFrame); state.preview.animFrame = null; }
  }

  function _updatePreviewProgress() {
    if (!state.preview.audio || !state.preview.audio.duration || !isFinite(state.preview.audio.duration)) return;
    const pct = state.preview.audio.currentTime / state.preview.audio.duration;
    const bars = state.overlays.preview ? state.overlays.preview.querySelectorAll('.voice-wf-bar') : [];
    const count = bars.length;
    const playedIdx = Math.floor(pct * count);
    bars.forEach((bar, i) => {
      bar.classList.toggle('played', i < playedIdx);
      bar.classList.toggle('active', i === playedIdx);
    });
    _updatePreviewDur();
  }

  function _updatePreviewDur() {
    if (!state.preview.audio) return;
    const durEl = $('#voice-preview-dur');
    if (!durEl) return;
    const dur = isFinite(state.preview.audio.duration) ? state.preview.audio.duration : state.preview.duration;
    if (state.preview.playing) {
      durEl.textContent = formatTimeSec(state.preview.audio.currentTime) + ' / ' + formatTimeSec(dur);
    } else {
      durEl.textContent = formatTimeSec(dur);
    }
  }

  function _resetPreviewWaveform() {
    if (!state.overlays.preview) return;
    const bars = state.overlays.preview.querySelectorAll('.voice-wf-bar');
    bars.forEach(b => { b.classList.remove('played', 'active'); });
  }

  /* ── Button state management ──────────────────────────────── */

  function _transformBtnToSend() {
    const btn = getSendBtn();
    if (!btn) return;

    // Hide hint elements
    const hints = btn.querySelectorAll('.rec-hint-lock, .rec-hint-cancel');
    hints.forEach(h => h.style.display = 'none');

    // Add voice-send-mode class
    btn.classList.add('voice-send-mode');
    btn.classList.remove('recording', 'hints-visible');

    // Store original onclick and remove it
    if (!btn._origOnclick && btn.onclick) {
      btn._origOnclick = btn.onclick;
    }
    btn.onclick = null;

    // Remove any previous preview handler
    if (btn._previewSendHandler) {
      btn.removeEventListener('click', btn._previewSendHandler, true);
    }

    // Add preview send handler in capture phase
    btn._previewSendHandler = (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      _sendPreview();
      return false;
    };
    btn.addEventListener('click', btn._previewSendHandler, true);
  }

  function _restoreBtnFromSend() {
    const btn = getSendBtn();
    if (!btn) return;

    state.preview.isPreviewMode = false;

    // Restore hint elements
    const hints = btn.querySelectorAll('.rec-hint-lock, .rec-hint-cancel');
    hints.forEach(h => h.style.display = '');

    // Remove voice-send-mode
    btn.classList.remove('voice-send-mode', 'recording', 'hints-visible', 'locked-stop-mode');

    // Remove preview send handler
    if (btn._previewSendHandler) {
      btn.removeEventListener('click', btn._previewSendHandler, true);
      btn._previewSendHandler = null;
    }

    // Restore original onclick handler
    if (btn._origOnclick !== undefined && btn._origOnclick !== null) {
      btn.onclick = btn._origOnclick;
      btn._origOnclick = undefined;
    }
  }

  function _dismissPreview() {
    if (state.preview.audio) {
      state.preview.audio.pause();
      if (state.preview.audio.src.startsWith('blob:')) URL.revokeObjectURL(state.preview.audio.src);
      state.preview.audio = null;
    }
    state.preview.playing = false;
    _stopPreviewAnim();
    state.preview.blob = null;

    _removeAllOverlays();
  }

  async function _sendPreview() {
    if (!state.preview.blob || !state.preview.duration) return;

    const blob = state.preview.blob;
    const duration = state.preview.duration;
    const waveform = state.preview.waveform;

    // Clean up preview audio
    if (state.preview.audio) {
      state.preview.audio.pause();
      if (state.preview.audio.src.startsWith('blob:')) URL.revokeObjectURL(state.preview.audio.src);
      state.preview.audio = null;
    }
    state.preview.playing = false;
    _stopPreviewAnim();
    state.preview.blob = null;

    // Play send animation — shrink + slide right + fade
    const overlay = state.overlays.preview;
    if (overlay) {
      overlay.classList.add('voice-preview-sending');

      // Animate the send button: pulse + fly-up effect
      const sendBtn = getSendBtn();
      if (sendBtn) {
        sendBtn.classList.add('voice-send-fly');
        setTimeout(() => sendBtn.classList.remove('voice-send-fly'), SEND_BTN_ANIM_MS);
      }
    }

    // Send voice immediately (optimistic UI appears right away)
    sendVoice(blob, duration, waveform);

    // Wait for send animation to finish, then clean up
    if (overlay) {
      await new Promise(resolve => setTimeout(resolve, SEND_ANIM_DELAY));
    }

    // Remove preview overlay and restore button — use shared cleanup
    _removeVoiceOverlays();
    _restoreBtnFromSend();
    cleanupInputPanel();
  }

  /* ── Timer helpers ──────────────────────────────────────── */

  function _updateRecTimer() {
    if (!state.overlays.rec && !state.locked.isLocked) return;
    const elapsed = Math.floor((Date.now() - state.recorder.recStart) / 1000);

    if (state.overlays.rec) {
      const timer = state.overlays.rec.querySelector('.voice-rec-timer');
      if (timer) timer.textContent = formatTimeSec(elapsed);
    }

    if (elapsed >= MAX_DURATION) {
      if (state.locked.isLocked) {
        stopRecording().then(result => {
          if (result) _showPreview(result.blob, result.duration, result.waveform);
        });
      } else {
        stopRecording().then(result => {
          if (result) sendVoice(result.blob, result.duration, result.waveform);
        });
      }
    }
  }

  function _formatElapsed() {
    const elapsed = Math.floor((Date.now() - state.recorder.recStart) / 1000);
    return formatTimeSec(elapsed);
  }

  /* ── Recording visualization ──────────────────────────────── */

  function _startRecVisualization() {
    if (!state.recorder.analyser) return;
    const bufLen = state.recorder.analyser.frequencyBinCount;
    const freqData = new Uint8Array(bufLen);
    const timeData = new Uint8Array(bufLen);

    function draw() {
      state._recAnimFrame = requestAnimationFrame(draw);
      state.recorder.analyser.getByteFrequencyData(freqData);
      state.recorder.analyser.getByteTimeDomainData(timeData);

      // ── Mic button volume-reactive scale ──
      let rms = 0;
      for (let i = 0; i < timeData.length; i++) {
        const s = (timeData[i] - 128) / 128;
        rms += s * s;
      }
      rms = Math.sqrt(rms / timeData.length);
      const scale = 1 + Math.min(rms * 3, 0.25);
      const micBtn = getSendBtn();
      if (micBtn && micBtn.classList.contains('recording') && !state.locked.isLocked) {
        micBtn.style.transform = `scale(${scale.toFixed(3)})`;
      }

      const container = state.overlays.rec || state.overlays.locked;
      if (!container) return;

      const bars = container.querySelectorAll('.voice-rec-bar');
      if (!bars || !bars.length) return;

      const totalBars = bars.length;

      // All bars visible — react to audio in real-time (Telegram style)
      const step = Math.max(1, Math.floor(bufLen / totalBars));
      for (let i = 0; i < totalBars; i++) {
        const freqIdx = Math.min((totalBars - 1 - i) * step, bufLen - 1);
        const val = freqData[freqIdx] / 255;
        const h = Math.max(3, val * 28);
        bars[i].style.height = h + 'px';
        bars[i].style.opacity = String(0.3 + val * 0.7);
      }
    }
    draw();
  }

  function _stopRecVisualization() {
    if (state._recAnimFrame) {
      cancelAnimationFrame(state._recAnimFrame);
      state._recAnimFrame = null;
    }
    // Reset mic button scale
    const micBtn = getSendBtn();
    if (micBtn) micBtn.style.transform = '';
  }

  /* ── Pointer (mouse + touch) gesture handling ─────────────── */

  function _onPointerMove(clientX, clientY) {
    if (state.locked.isLocked || !state.overlays.rec) return;

    const dx = state.pointer.startX - clientX;
    const dy = state.pointer.startY - clientY;

    const lockHint = state.overlays.rec.querySelector('#voice-lock-arrow');

    // Swipe UP → lock
    if (dy > 0) {
      const lockProgress = Math.min(1, dy / LOCK_THRESHOLD);
      if (lockProgress > 0.2 && !state.pointer.swipeLock) {
        state.pointer.swipeLock = true;
        if (lockHint) lockHint.classList.add('show');
      }
      if (lockHint) {
        lockHint.style.opacity = String(Math.min(1, lockProgress * 1.5));
      }
      if (dy >= LOCK_THRESHOLD && !state.locked.isLocked) {
        _transitionToLocked();
        return;
      }
    } else {
      if (state.pointer.swipeLock) {
        state.pointer.swipeLock = false;
        if (lockHint) { lockHint.classList.remove('show'); lockHint.style.opacity = ''; }
      }
    }

    // Swipe LEFT → cancel (with red panel + trash animation)
    if (dx > 0) {
      const cancelProgress = Math.min(1, (dx - CANCEL_THRESHOLD) / (CANCEL_COMPLETE - CANCEL_THRESHOLD));
      if (dx > CANCEL_THRESHOLD && !state.pointer.swipeCancel) {
        state.pointer.swipeCancel = true;
        if (state.overlays.rec) state.overlays.rec.classList.add('swipe-cancel');
      }
      if (state.pointer.swipeCancel) {
        const p = Math.max(0, cancelProgress);
        const wrap = getWrap();
        if (wrap) {
          wrap.style.transform = `translateX(${-p * 120}px) scale(${1 - p * 0.15})`;
          wrap.style.opacity = String(1 - p * 0.6);
        }
        // Red tint intensifies with progress
        if (state.overlays.rec) {
          state.overlays.rec.style.background = `rgba(255,59,48,${p * 0.35})`;
        }

        if (p >= 1) {
          cancelRecording();
        }
      }
    } else {
      if (state.pointer.swipeCancel) {
        state.pointer.swipeCancel = false;
        const wrap = getWrap();
        if (wrap) {
          wrap.style.transform = '';
          wrap.style.opacity = '';
        }
        if (state.overlays.rec) {
          state.overlays.rec.style.background = '';
          state.overlays.rec.classList.remove('swipe-cancel');
        }
      }
    }
  }

  function _onPointerEnd() {
    // Check _recOverlay is null instead of _recCancelled flag
    if (!state.locked.isLocked && state.overlays.rec) {
      // Reset transform on wrap
      const wrap = getWrap();
      if (wrap) {
        wrap.style.transform = '';
        wrap.style.opacity = '';
      }

      const cancelHint = state.overlays.rec?.querySelector('#voice-cancel-arrow');
      if (cancelHint) { cancelHint.classList.remove('show'); cancelHint.style.opacity = ''; cancelHint.style.transform = ''; cancelHint.style.color = ''; }
      const lockHint = state.overlays.rec?.querySelector('#voice-lock-arrow');
      if (lockHint) { lockHint.classList.remove('show'); lockHint.style.opacity = ''; }

      // Reset any swipe-cancel styling
      if (state.overlays.rec) {
        state.overlays.rec.style.background = '';
        state.overlays.rec.classList.remove('swipe-cancel');
      }

      // Hide hints
      const sendBtn = getSendBtn();
      if (sendBtn) sendBtn.classList.remove('hints-visible', 'recording');

      state.pointer.swipeCancel = false;
      state.pointer.swipeLock = false;

      // If media recorder is actually recording, stop and send
      if (state.recorder.mediaRecorder && state.recorder.mediaRecorder.state === 'recording') {
        stopRecording().then(result => {
          if (result) {
            // Play send animation on recording overlay — shrink + slide + fade
            const recOverlay = state.overlays.rec;
            if (recOverlay) {
              recOverlay.classList.add('voice-rec-sending');

              // Animate the send button: pulse + fly-up effect
              const btn = getSendBtn();
              if (btn) {
                btn.classList.add('voice-send-fly');
                setTimeout(() => btn.classList.remove('voice-send-fly'), SEND_BTN_ANIM_MS);
              }
            }

            // Send voice immediately (optimistic message appears right away)
            sendVoice(result.blob, result.duration, result.waveform);

            // Wait for send animation to finish, then clean up
            setTimeout(() => {
              _removeVoiceOverlays();
              _restoreBtnFromSend();
              cleanupInputPanel();
            }, SEND_ANIM_DELAY);
          } else {
            _removeAllOverlays();
          }
        });
      } else {
        // Recording never started (e.g. permission denied) — just clean up overlay
        _removeAllOverlays();
      }
    }
  }

  /* ══════════════════════════════════════════════════════════════
     WAVEFORM GENERATION
     ══════════════════════════════════════════════════════════════ */

  async function generateWaveform(blob) {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    try {
      const buf = await blob.arrayBuffer();
      const audio = await ctx.decodeAudioData(buf);
      const raw = audio.getChannelData(0);

      const samples = BAR_COUNT * 8;
      const blockSize = Math.floor(raw.length / samples);
      const peaks = [];

      for (let i = 0; i < samples; i++) {
        const start = i * blockSize;
        let max = 0;
        for (let j = start; j < start + blockSize && j < raw.length; j++) {
          const abs = Math.abs(raw[j]);
          if (abs > max) max = abs;
        }
        peaks.push(max);
      }

      const bars = [];
      const perBar = Math.floor(samples / BAR_COUNT);
      for (let i = 0; i < BAR_COUNT; i++) {
        let max = 0;
        for (let j = 0; j < perBar; j++) {
          const idx = i * perBar + j;
          if (idx < peaks.length && peaks[idx] > max) max = peaks[idx];
        }
        bars.push(max);
      }

      const maxVal = Math.max(...bars, 0.01);
      return bars.map(v => v / maxVal);
    } finally {
      ctx.close();
    }
  }

  /**
   * Client-side audio compression + noise reduction
   * - Decodes audio buffer
   * - Applies highpass filter (removes DC offset & rumble below 120Hz)
   * - Normalizes peak amplitude to -3dB
   * - Re-encodes via MediaRecorder at low bitrate (opus)
   *
   * @param {Blob} blob - raw recorded audio
   * @returns {Promise<Blob>} compressed blob
   */
  async function compressAudio(blob) {
    // Quick check for reasonable size — skip compression if already tiny
    if (blob.size < 8000) return blob;

    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const arrayBuf = await blob.arrayBuffer();
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuf);

      // Resample to 16kHz mono for speech (dramatically reduces processing)
      const sampleRate = 16000;
      const numSamples = Math.floor(audioBuffer.duration * sampleRate);
      const offCtx = new OfflineAudioContext(1, numSamples, sampleRate);

      // Source
      const source = offCtx.createBufferSource();
      source.buffer = audioBuffer;

      // Highpass filter — removes DC offset and low-frequency rumble
      const highpass = offCtx.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = 120;
      highpass.Q.value = 0.7;

      // Lowpass filter — removes high-frequency hiss above 8kHz
      const lowpass = offCtx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = 8000;
      lowpass.Q.value = 0.7;

      // Compressor — evens out loud/soft parts (speech-friendly)
      const compressor = offCtx.createDynamicsCompressor();
      compressor.threshold.value = -24;
      compressor.knee.value = 30;
      compressor.ratio.value = 12;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.25;

      source.connect(highpass);
      highpass.connect(lowpass);
      lowpass.connect(compressor);
      compressor.connect(offCtx.destination);
      source.start();

      const renderedBuf = await offCtx.startRendering();

      // Peak normalization to -3dB
      const channelData = renderedBuf.getChannelData(0);
      let peak = 0;
      for (let i = 0; i < channelData.length; i++) {
        const abs = Math.abs(channelData[i]);
        if (abs > peak) peak = abs;
      }
      const targetPeak = Math.pow(10, -3 / 20); // -3dB
      const gain = peak > 0 ? Math.min(targetPeak / peak, 2.0) : 1.0;

      // Apply gain
      const normalizedBuf = audioCtx.createBuffer(1, channelData.length, sampleRate);
      const outData = normalizedBuf.getChannelData(0);
      for (let i = 0; i < channelData.length; i++) {
        outData[i] = channelData[i] * gain;
      }

      // Re-encode via MediaRecorder (opus codec preferred)
      const dest = audioCtx.createMediaStreamDestination();
      const reSource = audioCtx.createBufferSource();
      reSource.buffer = normalizedBuf;
      reSource.connect(dest);

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')
          ? 'audio/ogg;codecs=opus'
          : '';

      const recorder = new MediaRecorder(dest.stream, mimeType ? { mimeType, audioBitsPerSecond: 24000 } : {});
      const chunks = [];

      const done = new Promise((resolve) => {
        recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
        recorder.onstop = () => {
          const compressed = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
          audioCtx.close();
          resolve(compressed);
        };
      });

      recorder.start(100);
      reSource.start();

      // Wait until playback finishes
      await new Promise((resolve) => {
        reSource.onended = () => {
          setTimeout(() => {
            recorder.stop();
            resolve();
          }, 150);
        };
      });

      const compressed = await done;

      // Only return compressed if it's actually smaller
      return compressed.size < blob.size * 0.9 ? compressed : blob;
    } catch (e) {
      console.warn('[VoiceMsg] Audio compression failed:', e);
      return blob;
    }
  }

  /**
   * Generate waveform from an AudioBuffer (reusable for compressed audio)
   * @param {AudioBuffer} audioBuffer
   * @returns {number[]} normalized 0-1 array
   */
  function generateWaveformFromBuffer(audioBuffer) {
    const raw = audioBuffer.getChannelData(0);
    const samples = BAR_COUNT * 8;
    const blockSize = Math.floor(raw.length / samples);
    const peaks = [];
    for (let i = 0; i < samples; i++) {
      const start = i * blockSize;
      let max = 0;
      for (let j = start; j < start + blockSize && j < raw.length; j++) {
        const abs = Math.abs(raw[j]);
        if (abs > max) max = abs;
      }
      peaks.push(max);
    }
    const bars = [];
    const perBar = Math.floor(samples / BAR_COUNT);
    for (let i = 0; i < BAR_COUNT; i++) {
      let max = 0;
      for (let j = 0; j < perBar; j++) {
        const idx = i * perBar + j;
        if (idx < peaks.length && peaks[idx] > max) max = peaks[idx];
      }
      bars.push(max);
    }
    const maxVal = Math.max(...bars, 0.01);
    return bars.map(v => v / maxVal);
  }

  /* ══════════════════════════════════════════════════════════════
     PLAYBACK (in chat messages)
     ══════════════════════════════════════════════════════════════ */

  function createPlayer(container, audioUrl, duration, waveform) {
    if (!container || !audioUrl) return;

    // Clean up any existing player on this container (prevents stale ended handlers)
    const existingAudio = voiceAudioMap.get(container);
    if (existingAudio) {
      existingAudio.pause();
      if (existingAudio._endedHandler) existingAudio.removeEventListener('ended', existingAudio._endedHandler);
      voiceAudioMap.delete(container);
    }

    const playBtn = container.querySelector('.voice-play-btn');
    const wfWrap = container.querySelector('.voice-wf-bars');
    const timeEl = container.querySelector('.voice-wf-time');
    if (!playBtn || !wfWrap) return;

    if (!waveform || waveform.length === 0) {
      waveform = Array.from({ length: BAR_COUNT }, () => 0.25 + Math.random() * 0.75);
    }

    const barCount = waveform.length;

    wfWrap.innerHTML = '';
    buildBars(wfWrap, barCount, 'voice-wf-bar', (i) => 3 + waveform[i] * 25);

    const bars = wfWrap.querySelectorAll('.voice-wf-bar');

    // Show voice duration in time element (prepended before timestamp meta)
    if (timeEl) {
      let durSpan = timeEl.querySelector('.voice-dur');
      if (!durSpan) {
        durSpan = document.createElement('span');
        durSpan.className = 'voice-dur';
        timeEl.insertBefore(durSpan, timeEl.firstChild);
      }
      durSpan.textContent = duration ? formatTimeSec(duration) : '0:00';
    }

    // ── Speed button: 1× → 1.5× → 2× cycle ──
    const speedBtn = container.querySelector('.voice-speed-btn');
    const SPEEDS = [1, 1.5, 2];
    let speedIdx = 0;
    if (speedBtn) {
      speedBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        speedIdx = (speedIdx + 1) % SPEEDS.length;
        const rate = SPEEDS[speedIdx];
        audio.playbackRate = rate;
        speedBtn.textContent = rate === 1 ? '1×' : rate + '×';
        speedBtn.classList.toggle('active', rate !== 1);
      });
    }

    let audio;
    const cached = audioCache.get(audioUrl);
    if (cached) {
      audio = cached;
    } else {
      audio = new Audio();
      audio.preload = 'auto';       // Start downloading immediately (pre-cache)
      audio.crossOrigin = 'anonymous';
      audio.src = audioUrl;
      audio.addEventListener('canplaythrough', () => {
        // Fully buffered — cache the element
        if (isFinite(audio.duration) && audio.duration > 0) {
          cacheAudio(audioUrl, audio);
        }
      }, { once: true });
    }
    let isPlaying = false;
    let animFrame = null;
    let isBuffering = false;

    const mrow = container.closest('.mrow');
    let senderName = '';
    let senderAvatar = null;
    if (mrow) {
      const dataId = mrow.dataset.id;
      if (dataId && S.chatId && S.msgs && S.msgs[S.chatId]) {
        const msgData = S.msgs[S.chatId].find(m => String(m.id) === dataId);
        if (msgData) senderName = msgData.nickname || '';
      }
      senderAvatar = mrow.querySelector('.av-img img');
    }

    function updateProgress() {
      if (!audio.duration || !isFinite(audio.duration)) return;
      const pct = audio.currentTime / audio.duration;
      const playedIdx = Math.floor(pct * barCount);
      bars.forEach((bar, i) => {
        bar.classList.toggle('played', i < playedIdx);
        bar.classList.toggle('active', i === playedIdx);
      });
      const timeStr = formatTimeSec(audio.currentTime) + ' / ' + formatTimeSec(audio.duration);
      _updateMiniPlayer(audio, waveform, timeStr);
      // Update duration display in bubble
      if (timeEl) {
        const durSpan = timeEl.querySelector('.voice-dur');
        if (durSpan) durSpan.textContent = timeStr;
      }
    }

    function startAnim() {
      function tick() {
        updateProgress();
        if (isPlaying) animFrame = requestAnimationFrame(tick);
      }
      tick();
    }

    function stopAnim() {
      if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
    }

    audio.addEventListener('loadedmetadata', () => {
      // Duration metadata loaded — no separate dur display needed
    }, { once: true });

    function endedHandler() {
      isPlaying = false;
      playBtn.innerHTML = PLAY_SVG;
      playBtn.classList.remove('playing');
      stopAnim();
      bars.forEach(b => { b.classList.remove('played', 'active'); });
      if (state.playback.audio === audio) { state.playback.audio = null; state.playback.btn = null; state.playback.container = null; }
      _hideMiniPlayer();
      // Reset speed to 1× on end
      if (speedBtn) { speedIdx = 0; audio.playbackRate = 1; speedBtn.textContent = '1×'; speedBtn.classList.remove('active'); }
      // Reset duration display to full duration
      if (timeEl) {
        const durSpan = timeEl.querySelector('.voice-dur');
        if (durSpan && isFinite(audio.duration)) durSpan.textContent = formatTimeSec(audio.duration);
      }
      _autoPlayNext(container);
    }
    audio.addEventListener('ended', endedHandler);
    audio._endedHandler = endedHandler;

    audio.addEventListener('error', () => {
      // Error handled silently
    });

    // Streaming: show buffering indicator when data is not ready
    audio.addEventListener('waiting', () => {
      if (isPlaying) {
        isBuffering = true;
        playBtn.classList.add('buffering');
      }
    });
    audio.addEventListener('playing', () => {
      isBuffering = false;
      playBtn.classList.remove('buffering');
    });
    audio.addEventListener('canplay', () => {
      isBuffering = false;
      playBtn.classList.remove('buffering');
    });

    function toggle() {
      if (state.playback.audio && state.playback.audio !== audio && !state.playback.audio.paused) {
        state.playback.audio.pause();
        state.playback.audio.currentTime = 0;
        if (state.playback.btn) {
          state.playback.btn.innerHTML = PLAY_SVG;
          state.playback.btn.classList.remove('playing');
        }
        if (state.playback.container) {
          state.playback.container.querySelectorAll('.voice-wf-bar').forEach(b => b.classList.remove('played', 'active'));
        }
      }

      if (isPlaying) {
        audio.pause();
        isPlaying = false;
        playBtn.innerHTML = PLAY_SVG;
        playBtn.classList.remove('playing');
        stopAnim();
        state.playback.audio = null;
        state.playback.btn = null;
        state.playback.container = null;
        _hideMiniPlayer();
      } else {
        audio.play().catch(() => {});
        isPlaying = true;
        playBtn.innerHTML = PAUSE_SVG;
        playBtn.classList.add('playing');
        startAnim();
        state.playback.audio = audio;
        state.playback.btn = playBtn;
        state.playback.container = container;
        voiceAudioMap.set(container, audio);
        _showMiniPlayer(audio, waveform, senderName, senderAvatar);
      }
    }

    playBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggle();
    });

    wfWrap.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!audio.duration || !isFinite(audio.duration)) {
        if (!isPlaying) toggle();
        return;
      }
      const rect = wfWrap.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      audio.currentTime = pct * audio.duration;
      updateProgress();
      if (!isPlaying) toggle();
    });

    // STT (Speech-to-Text) transcription button
    const sttBtn = container.querySelector('.voice-stt-btn');
    if (sttBtn) {
      // Restore cached transcription from localStorage
      restoreSttCache(container, audioUrl);
      sttBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        _transcribeVoice(container, audioUrl);
      });
    }
  }

  /* ── Auto-play next voice message ─────────────────────────── */

  function _autoPlayNext(currentContainer) {
    const currentRow = currentContainer.closest('.mrow');
    if (!currentRow) return;
    const msgs = $('#msgs');
    if (!msgs) return;

    const allVoiceMsgs = msgs.querySelectorAll('.voice-msg');
    let foundCurrent = false;
    let nextVoice = null;
    for (let i = 0; i < allVoiceMsgs.length; i++) {
      const voiceEl = allVoiceMsgs[i];
      if (!foundCurrent) {
        if (voiceEl === currentContainer || voiceEl.contains(currentContainer)) {
          foundCurrent = true;
        }
        continue;
      }
      const rect = voiceEl.getBoundingClientRect();
      if (rect.top < window.innerHeight && rect.bottom > 0) {
        nextVoice = voiceEl;
        break;
      }
    }
    if (nextVoice) _playVoiceByElement(nextVoice);
  }

  function _playPrevVoice(currentContainer) {
    const msgs = $('#msgs');
    if (!msgs) return;
    const allVoiceMsgs = msgs.querySelectorAll('.voice-msg');
    let prevVoice = null;
    for (let i = 0; i < allVoiceMsgs.length; i++) {
      const voiceEl = allVoiceMsgs[i];
      if (voiceEl === currentContainer || voiceEl.contains(currentContainer)) break;
      const rect = voiceEl.getBoundingClientRect();
      if (rect.top < window.innerHeight && rect.bottom > 0) prevVoice = voiceEl;
    }
    if (prevVoice) _playVoiceByElement(prevVoice);
  }

  function _playVoiceByElement(voiceEl) {
    const nextRow = voiceEl.closest('.mrow');
    if (!nextRow) return;
    const dataId = nextRow.dataset.id;
    if (!dataId) return;
    const chatMsgs = (S.chatId && S.msgs) ? S.msgs[S.chatId] : null;
    if (!chatMsgs) return;
    const msgData = chatMsgs.find(m => String(m.id) === dataId);
    if (!msgData || msgData.media_type !== 'voice') return;

    const audioUrl = msgData.media_url;
    const dur = msgData.voice_duration || parseInt(msgData.body || '0', 10) || 0;
    let wfData = [];
    try { if (msgData.voice_waveform) wfData = JSON.parse(msgData.voice_waveform); } catch(e) {}

    voiceEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    voiceEl.classList.add('msg-flash');
    setTimeout(() => voiceEl.classList.remove('msg-flash'), 1000);

    setTimeout(() => {
      if (state.playback.audio && !state.playback.audio.paused) {
        state.playback.audio.pause();
        state.playback.audio.currentTime = 0;
        if (state.playback.btn) {
          state.playback.btn.innerHTML = PLAY_SVG;
          state.playback.btn.classList.remove('playing');
        }
      }
      if (window.VoiceMsg) {
        window.VoiceMsg.createPlayer(voiceEl, audioUrl, dur, wfData);
        const playBtn = voiceEl.querySelector('.voice-play-btn');
        if (playBtn) playBtn.click();
      }
    }, 400);
  }

  /* ══════════════════════════════════════════════════════════════
     MINI PLAYER
     ══════════════════════════════════════════════════════════════ */

  function _initMiniPlayer() {
    const chatArea = $('#chat-area');
    if (!chatArea) return;
    const chatHdr = chatArea.querySelector('.chat-hdr');
    if (!chatHdr) return;

    const el = document.createElement('div');
    el.className = 'voice-mini-player';
    el.id = 'voice-mini-player';
    el.innerHTML = `
      <button class="vmp-btn vmp-prev" id="vmp-prev" title="Предыдущее">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
      </button>
      <div class="vmp-avatar" id="vmp-avatar"></div>
      <div class="vmp-info"><div class="vmp-name" id="vmp-name"></div></div>
      <div class="vmp-wave" id="vmp-wave"></div>
      <span class="vmp-time" id="vmp-time">0:00</span>
      <button class="vmp-btn vmp-play" id="vmp-play" title="Воспроизвести">
        ${PLAY_SVG}
      </button>
      <button class="vmp-btn vmp-next" id="vmp-next" title="Следующее">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
      </button>
      <button class="vmp-close" id="vmp-close" title="Закрыть">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    `;

    chatHdr.insertAdjacentElement('afterend', el);
    state.ui.miniPlayer = el;

    $('#vmp-play').addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      // Delegate to the bubble's play button toggle() — keeps closure isPlaying in sync
      if (state.playback.btn) state.playback.btn.click();
    });

    // Seek via mini-player waveform
    $('#vmp-wave').addEventListener('click', (e) => {
      e.stopPropagation();
      if (!state.playback.audio || !state.playback.audio.duration || !isFinite(state.playback.audio.duration)) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      state.playback.audio.currentTime = pct * state.playback.audio.duration;
    });

    $('#vmp-prev').addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (state.playback.audio && state.playback.container) _playPrevVoice(state.playback.container);
    });

    $('#vmp-next').addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (state.playback.audio && state.playback.container) _autoPlayNext(state.playback.container);
    });

    $('#vmp-close').addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      // Delegate to the bubble's play button to properly stop + sync state
      if (state.playback.btn && state.playback.audio && !state.playback.audio.paused) {
        state.playback.btn.click();
      }
      _hideMiniPlayer();
    });
  }

  function _showMiniPlayer(audio, waveform, senderName, avatarEl) {
    if (!state.ui.miniPlayer) return;
    const nameEl = $('#vmp-name');
    if (nameEl) nameEl.textContent = senderName || 'Голосовое сообщение';

    const avatarContainer = $('#vmp-avatar');
    if (avatarContainer) {
      if (avatarEl) {
        const img = document.createElement('img'); img.src = avatarEl.src; img.alt = '';
        avatarContainer.innerHTML = ''; avatarContainer.appendChild(img);
      } else { avatarContainer.textContent = ''; }
    }

    const waveEl = $('#vmp-wave');
    if (waveEl) {
      waveEl.innerHTML = '';
      const wfData = waveform || Array.from({ length: BAR_COUNT }, () => 0.3);
      for (let i = 0; i < wfData.length; i++) {
        const bar = document.createElement('div');
        bar.className = 'vmp-wf-bar';
        bar.style.height = (2 + wfData[i] * 14) + 'px';
        waveEl.appendChild(bar);
      }
    }

    const playBtn = $('#vmp-play');
    if (playBtn && audio && !audio.paused) {
      playBtn.innerHTML = PAUSE_SVG;
    } else if (playBtn) {
      playBtn.innerHTML = PLAY_SVG;
    }
    state.ui.miniPlayer.classList.add('visible');
  }

  function _updateMiniPlayer(audio, waveform, timeStr) {
    if (!state.ui.miniPlayer || !state.ui.miniPlayer.classList.contains('visible')) return;
    const waveEl = $('#vmp-wave');
    if (waveEl && audio.duration && isFinite(audio.duration)) {
      const pct = audio.currentTime / audio.duration;
      const bars = waveEl.querySelectorAll('.vmp-wf-bar');
      const playedIdx = Math.floor(pct * bars.length);
      bars.forEach((bar, i) => { bar.classList.toggle('played', i < playedIdx); bar.classList.toggle('active', i === playedIdx); });
    }
    const timeEl = $('#vmp-time');
    if (timeEl) timeEl.textContent = timeStr || '';
  }

  function _hideMiniPlayer() {
    if (!state.ui.miniPlayer) return;
    state.ui.miniPlayer.classList.remove('visible');
  }

  /* ══ SEND VOICE ════════════════════════════════════════════════ */

  async function sendVoice(blob, duration, waveform, toSignalId, replyTo) {
    // ── Step 1: Validate partner and prepare metadata ──
    if (!S.partner) return;
    const replyId = replyTo || S.replyTo?.id || null;
    const toSid = toSignalId || S.partner.partner_signal_id;
    if (!toSid) return;

    // ── Step 2: Show optimistic message in chat IMMEDIATELY (Telegram-style) ──
    // Message appears with original blob for instant playback — no waiting for compression
    const tid = 't' + Date.now();
    const tmpBlobUrl = URL.createObjectURL(blob);
    const tmp = {
      id: tid, sender_id: S.user.id, body: String(duration),
      sent_at: Math.floor(Date.now() / 1000), is_read: 0, is_edited: 0,
      nickname: S.user.nickname, avatar_url: S.user.avatar_url, reply_to: replyId,
      media_url: tmpBlobUrl, media_type: 'voice',
      voice_duration: duration, voice_waveform: JSON.stringify(waveform),
      media_file_name: 'voice.webm', reactions: []
    };

    if (S.replyTo) { S.replyTo = null; hideRbar(); }
    S.msgs[S.chatId] = S.msgs[S.chatId] || [];
    S.msgs[S.chatId].push(tmp);
    S.rxns[tid] = [];
    S._pendingTids = S._pendingTids || new Map();
    S._pendingTids.set(tid, '[voice]');
    appendMsg(S.chatId, tmp);
    scrollBot();

    // ── Step 2.5: Fly animation from send button to chat ──
    if (typeof animateMsgFly === 'function') {
      animateMsgFly('voice', { duration, waveform }, tid);
    }

    // ── Step 3: Show upload progress ring on play button ──
    _showUploadProgress(tid, blob);

    // ── Step 4: Client-side compression in background (non-blocking) ──
    // Skip compression for short recordings (already small) — speeds up sending
    const SKIP_COMPRESS_BELOW = 15; // seconds
    if (duration >= SKIP_COMPRESS_BELOW) {
      try {
        const compressedBlob = await compressAudio(blob);
        if (compressedBlob !== blob) {
          const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
          try {
            const buf = await compressedBlob.arrayBuffer();
            const audio = await audioCtx.decodeAudioData(buf);
            waveform = generateWaveformFromBuffer(audio);
            audioCtx.close();
          } catch(e) { audioCtx.close(); }
          blob = compressedBlob;
        }
      } catch (e) {
        console.warn('[VoiceMsg] Compression skipped:', e);
      }
    } else {
      // Short messages: show quick ring progress to avoid "stuck at 0%" feel
      _updateUploadProgress(tid, 30);
    }

    // ── Step 5: Upload compressed audio to server ──
    const fd = new FormData();
    fd.append('voice', blob, 'voice.webm');
    fd.append('to_signal_id', toSid);
    if (replyId) fd.append('reply_to', String(replyId));
    fd.append('voice_duration', String(duration));
    fd.append('voice_waveform', JSON.stringify(waveform));

    let res;
    try {
      res = await _apiWithProgress('send_voice_message', 'POST', fd, tid);
    } catch (e) {
      _removeUploadProgress(tid);
      toast('Ошибка отправки голосового', 'err');
      document.querySelector(`.mrow[data-id="${tid}"]`)?.remove();
      if (S.msgs[S.chatId]) S.msgs[S.chatId] = S.msgs[S.chatId].filter(m => m.id !== tid);
      return;
    }

    S._pendingTids.delete(tid);
    // Remove upload progress ring
    _removeUploadProgress(tid);

    if (!res.ok) {
      toast('Ошибка: ' + (res.message || ''), 'err');
      document.querySelector(`.mrow[data-id="${tid}"]`)?.remove();
      if (S.msgs[S.chatId]) S.msgs[S.chatId] = S.msgs[S.chatId].filter(m => m.id !== tid);
      return;
    }

    // Revoke temp blob URL after server response with real URL
    if (tmpBlobUrl.startsWith('blob:')) URL.revokeObjectURL(tmpBlobUrl);

    if (S.msgs[S.chatId]) {
      const idx = S.msgs[S.chatId].findIndex(m => m.id === tid);
      if (idx >= 0) {
        S.msgs[S.chatId][idx].id = res.message_id;
        S.msgs[S.chatId][idx].media_url = res.media_url ? getMediaUrl(res.media_url) : S.msgs[S.chatId][idx].media_url;
      }
    }
    S.rxns[res.message_id] = S.rxns[tid] || []; delete S.rxns[tid];
    S.lastId[S.chatId] = Math.max(S.lastId[S.chatId] || 0, res.message_id);

    const rowEl = document.querySelector(`.mrow[data-id="${tid}"]`);
    if (rowEl) {
      rowEl.dataset.id = res.message_id;
      const realMsg = S.msgs[S.chatId]?.find(m => m.id === res.message_id);
      if (realMsg) patchMsgDom(realMsg);
    }

    if (!S.chatId && res.chat_id) {
      S.chatId = res.chat_id;
      S.lastId[res.chat_id] = res.message_id;
      S.msgs[res.chat_id] = [];
      await loadChats();
      const nc = S.chats.find(c => c.chat_id === res.chat_id);
      if (nc) { S.partner = nc; $$('.ci').forEach(e => e.classList.remove('active')); document.querySelector(`.ci[data-chat-id="${S.chatId}"]`)?.classList.add('active'); }
    }

    const sentMsg = S.msgs[S.chatId]?.find(m => m.id === res.message_id);
    if (sentMsg) patchMsgDom(sentMsg);
  }

  /* ══════════════════════════════════════════════════════════════
     UPLOAD PROGRESS RING — Telegram-style circular indicator
     ══════════════════════════════════════════════════════════════ */

  function _showUploadProgress(tempId, blob) {
    const row = document.querySelector(`.mrow[data-id="${tempId}"]`);
    if (!row) return;
    const playBtn = row.querySelector('.voice-play-btn');
    if (!playBtn) return;

    // Hide play SVG, show ring overlay (media-style — no % label)
    const origHtml = playBtn.innerHTML;
    playBtn.innerHTML = '';
    playBtn.classList.add('voice-uploading');
    playBtn._uploadOrigHtml = origHtml;

    const ring = document.createElement('div');
    ring.className = 'voice-upload-ring';
    ring.id = 'upload-ring-' + tempId;

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 36 36');
    svg.classList.add('voice-upload-ring-svg');

    // Background track (unified with media upload ring)
    const bg = document.createElementNS(svgNS, 'circle');
    bg.setAttribute('cx', '18');
    bg.setAttribute('cy', '18');
    bg.setAttribute('r', '14.14');
    bg.setAttribute('fill', 'none');
    bg.setAttribute('stroke', 'rgba(255,255,255,0.22)');
    bg.setAttribute('stroke-width', '3');
    bg.classList.add('voice-upload-ring-bg');

    const circumference = 2 * Math.PI * 14.14;
    const fg = document.createElementNS(svgNS, 'circle');
    fg.setAttribute('cx', '18');
    fg.setAttribute('cy', '18');
    fg.setAttribute('r', '14.14');
    fg.setAttribute('fill', 'none');
    fg.setAttribute('stroke', '#fff');
    fg.setAttribute('stroke-width', '3');
    fg.setAttribute('stroke-linecap', 'round');
    fg.setAttribute('stroke-dasharray', String(circumference));
    fg.setAttribute('stroke-dashoffset', String(circumference));
    fg.setAttribute('transform', 'rotate(-90 18 18)');
    fg.style.transition = 'stroke-dashoffset 0.18s linear';
    fg.classList.add('voice-upload-ring-fg');

    svg.appendChild(bg);
    svg.appendChild(fg);
    ring.appendChild(svg);
    playBtn.appendChild(ring);

    playBtn._uploadRing = ring;
    playBtn._uploadFg = fg;
    playBtn._uploadBlob = blob;
    playBtn._uploadDone = false;
  }

  function _updateUploadProgress(tempId, percent) {
    const row = document.querySelector(`.mrow[data-id="${tempId}"]`);
    if (!row) return;
    const playBtn = row.querySelector('.voice-play-btn');
    if (!playBtn || !playBtn._uploadFg) return;

    const circumference = 2 * Math.PI * 14.14;
    const offset = circumference * (1 - percent / 100);
    playBtn._uploadFg.setAttribute('stroke-dashoffset', String(offset));
  }

  function _removeUploadProgress(tempId) {
    const row = document.querySelector(`.mrow[data-id="${tempId}"]`);
    if (!row) return;
    const playBtn = row.querySelector('.voice-play-btn');
    if (!playBtn) return;
    const ring = playBtn.querySelector('.voice-upload-ring');
    if (ring) ring.remove();
    playBtn.classList.remove('voice-uploading');
    // Restore original play SVG
    if (playBtn._uploadOrigHtml) {
      playBtn.innerHTML = playBtn._uploadOrigHtml;
      playBtn._uploadOrigHtml = null;
    }
    playBtn._uploadRing = null;
    playBtn._uploadFg = null;
    playBtn._uploadDone = true;
  }

  /**
   * API call with upload progress tracking
   * Wraps fetch with XMLHttpRequest for progress events
   */
  function _apiWithProgress(endpoint, method, body, tempId) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(method, API_BASE + endpoint, true);
      xhr.setRequestHeader('Authorization', 'Bearer ' + (S.token || ''));

      let uploadComplete = false;
      let totalSize = 0;

      if (body instanceof FormData) {
        const blob = body.get('voice');
        totalSize = blob ? blob.size : 0;
      }

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable && totalSize > 0) {
          const uploadPct = (e.loaded / e.total) * 50;
          _updateUploadProgress(tempId, uploadPct);
        }
      });

      xhr.upload.addEventListener('load', () => {
        uploadComplete = true;
        _updateUploadProgress(tempId, 70);
      });

      xhr.addEventListener('load', () => {
        _updateUploadProgress(tempId, 100);
        setTimeout(() => {
          _removeUploadProgress(tempId);
        }, 400);

        try {
          const data = JSON.parse(xhr.responseText);
          resolve(data);
        } catch (e) {
          reject(new Error('Invalid JSON response'));
        }
      });

      xhr.addEventListener('error', () => {
        _removeUploadProgress(tempId);
        reject(new Error('Network error'));
      });

      xhr.addEventListener('timeout', () => {
        _removeUploadProgress(tempId);
        reject(new Error('Request timeout'));
      });

      xhr.timeout = 120000;
      xhr.send(body);
    });
  }

  /* ══════════════════════════════════════════════════════════════
     UI BINDING — Mic button ↔ hold-to-record with gestures
     ══════════════════════════════════════════════════════════════ */

  let _initialized = false;

  function init() {
    if (_initialized) return;
    _initialized = true;

    const btn = $('#btn-send');
    if (!btn) return;

    _initMiniPlayer();

    function isMicMode() {
      return !btn.classList.contains('has-text') && !state.preview.isPreviewMode;
    }

    // ── Mouse (desktop) ──
    btn.addEventListener('mousedown', (e) => {
      // In locked mode, clicks are handled by _lockedSendHandler / _stopFloatHandler
      if (state.locked.isLocked) return;
      if (!isMicMode()) return;
      e.preventDefault();
      e.stopPropagation();
      state.pointer.startX = e.clientX;
      state.pointer.startY = e.clientY;
      startRecording();
      setTimeout(() => { btn.classList.remove('hints-visible'); }, HINT_HIDE_DELAY);
    });

    document.addEventListener('mousemove', (e) => {
      if (!state.recorder.mediaRecorder || state.recorder.mediaRecorder.state !== 'recording') return;
      if (state.locked.isLocked) return;
      _onPointerMove(e.clientX, e.clientY);
    });

    document.addEventListener('mouseup', () => {
      if (!state.overlays.rec && (!state.recorder.mediaRecorder || state.recorder.mediaRecorder.state !== 'recording')) return;
      if (state.locked.isLocked) return;
      btn.classList.remove('hints-visible', 'recording');
      _onPointerEnd();
    });

    // ── Touch (mobile) ──
    btn.addEventListener('touchstart', (e) => {
      // In locked mode, clicks are handled by _lockedSendHandler / _stopFloatHandler
      if (state.locked.isLocked) return;
      if (!isMicMode()) return;
      e.preventDefault();
      e.stopPropagation();
      state.pointer.startX = e.touches[0].clientX;
      state.pointer.startY = e.touches[0].clientY;
      startRecording();
      setTimeout(() => { btn.classList.remove('hints-visible'); }, HINT_HIDE_DELAY);
    }, { passive: false });

    document.addEventListener('touchmove', (e) => {
      if (!state.recorder.mediaRecorder || state.recorder.mediaRecorder.state !== 'recording') return;
      if (state.locked.isLocked) return;
      _onPointerMove(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });

    document.addEventListener('touchend', () => {
      if (!state.overlays.rec && (!state.recorder.mediaRecorder || state.recorder.mediaRecorder.state !== 'recording')) return;
      if (state.locked.isLocked) return;
      btn.classList.remove('hints-visible', 'recording');
      _onPointerEnd();
    });

    // Prevent context menu on long press
    btn.addEventListener('contextmenu', (e) => {
      if (!isMicMode() && !state.locked.isLocked) return;
      e.preventDefault();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* ══════════════════════════════════════════════════════════════
     SPEECH-TO-TEXT (STT) TRANSCRIPTION — localStorage cache
     ══════════════════════════════════════════════════════════════ */

  /** Extract S3 key from any URL format for cache key */
  function _sttCacheKey(audioUrl) {
    try {
      if (audioUrl.includes('key=')) {
        const u = new URL(audioUrl);
        return u.searchParams.get('key') || audioUrl;
      }
      if (audioUrl.startsWith('http')) {
        return new URL(audioUrl).pathname.replace(/^\//, '');
      }
      return audioUrl;
    } catch { return audioUrl; }
  }

  /** Get cached transcription from localStorage */
  function _getSttCache(audioUrl) {
    try {
      const key = STT_CACHE_PREFIX + _sttCacheKey(audioUrl);
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const entry = JSON.parse(raw);
      if (Date.now() - entry.ts > STT_CACHE_TTL) {
        localStorage.removeItem(key);
        return null;
      }
      return entry.text;
    } catch { return null; }
  }

  /** Save transcription to localStorage */
  function _setSttCache(audioUrl, text) {
    try {
      const key = STT_CACHE_PREFIX + _sttCacheKey(audioUrl);
      localStorage.setItem(key, JSON.stringify({ text, ts: Date.now() }));
      _pruneSttCache();
    } catch (e) {
      // localStorage full — prune and retry once
      try { _pruneSttCache(true); localStorage.setItem(key, JSON.stringify({ text, ts: Date.now() })); } catch {}
    }
  }

  /** Remove old entries if over limit */
  function _pruneSttCache(aggressive) {
    try {
      const entries = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(STT_CACHE_PREFIX)) entries.push(k);
      }
      if (entries.length <= STT_CACHE_MAX) return;
      entries.sort((a, b) => {
        const ta = JSON.parse(localStorage.getItem(a) || '{}').ts || 0;
        const tb = JSON.parse(localStorage.getItem(b) || '{}').ts || 0;
        return ta - tb;
      });
      const toRemove = aggressive ? entries.length - Math.floor(STT_CACHE_MAX / 2) : entries.length - STT_CACHE_MAX;
      for (let i = 0; i < toRemove; i++) localStorage.removeItem(entries[i]);
    } catch {}
  }

  /** Restore cached transcription when voice bubble renders */
  function restoreSttCache(container, audioUrl) {
    const cached = _getSttCache(audioUrl);
    if (!cached) return;
    const sttBtn = container.querySelector('.voice-stt-btn');
    const resultEl = container.querySelector('.voice-stt-result');
    if (!sttBtn || !resultEl) return;
    resultEl.textContent = cached;
    resultEl.style.display = 'block';
    resultEl.classList.add('stt-visible');
    sttBtn.classList.add('stt-done');
    sttBtn.title = 'Скрыть расшифровку';
    sttBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><polyline points="20 6 9 17 4 12"/></svg>';
  }

  async function _transcribeVoice(container, audioUrl) {
    const sttBtn = container.querySelector('.voice-stt-btn');
    const resultEl = container.querySelector('.voice-stt-result');
    if (!sttBtn) return;

    // Check localStorage cache first
    const cached = _getSttCache(audioUrl);
    if (cached) {
      if (resultEl) {
        resultEl.textContent = cached;
        resultEl.style.display = 'block';
        resultEl.classList.add('stt-visible');
      }
      sttBtn.classList.add('stt-done');
      sttBtn.title = 'Скрыть расшифровку';
      sttBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><polyline points="20 6 9 17 4 12"/></svg>';
      return;
    }

    // Show loading state
    sttBtn.classList.add('stt-loading');
    sttBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>';

    try {
      const res = await fetch(API_BASE + 'transcribe_voice', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + (S.token || ''),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ audio_url: audioUrl }),
      });

      if (!res.ok) throw new Error('STT request failed');

      const data = await res.json();

      if (data.ok && data.text) {
        // Show transcription result
        if (resultEl) {
          resultEl.textContent = data.text;
          resultEl.style.display = 'block';
          resultEl.classList.add('stt-visible');
        }
        // Cache in localStorage
        _setSttCache(audioUrl, data.text);
        // Change button to "done" state
        sttBtn.classList.remove('stt-loading');
        sttBtn.classList.add('stt-done');
        sttBtn.title = 'Скрыть расшифровку';
        sttBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><polyline points="20 6 9 17 4 12"/></svg>';
      } else {
        toast(data.message || 'Не удалось расшифровать', 'err');
        _resetSttButton(sttBtn);
      }
    } catch (e) {
      console.warn('[VoiceMsg] STT failed:', e);
      toast('Ошибка расшифровки', 'err');
      _resetSttButton(sttBtn);
    }
  }

  function _resetSttButton(btn) {
    if (!btn) return;
    btn.classList.remove('stt-loading', 'stt-done');
    btn.title = 'Расшифровать';
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  }

  /* ══════════════════════════════════════════════════════════════
     PRE-CACHE — download visible voice messages in background
     ══════════════════════════════════════════════════════════════ */

  /** Pre-cache voice audio for visible messages (call on scroll, chat open) */
  function precacheVoiceMessages() {
    const msgs = $('#msgs');
    if (!msgs) return;
    const voiceMsgs = msgs.querySelectorAll('.voice-msg');
    if (!voiceMsgs.length) return;

    for (const vMsg of voiceMsgs) {
      // Already cached — skip
      const existing = voiceAudioMap.get(vMsg);
      if (existing) continue;

      // Check if in viewport (with margin)
      const rect = vMsg.getBoundingClientRect();
      const inView = rect.top < window.innerHeight + 500 && rect.bottom > -500;
      if (!inView) continue;

      // Get audio URL from data attribute
      const row = vMsg.closest('.mrow');
      if (!row) continue;
      const dataId = row.dataset.id;
      if (!dataId || !S.chatId || !S.msgs || !S.msgs[S.chatId]) continue;

      const msgData = S.msgs[S.chatId].find(m => String(m.id) === dataId);
      if (!msgData || !msgData.media_url) continue;

      const audioUrl = msgData.media_url;
      if (audioCache.get(audioUrl)) continue;

      // Preload audio in background (no UI changes)
      const a = new Audio();
      a.preload = 'auto';
      a.preload = 'metadata'; // Just load metadata first to save bandwidth
      a.src = audioUrl;
      a.addEventListener('loadedmetadata', () => {
        // Upgrade to full preload after metadata
        a.preload = 'auto';
        if (isFinite(a.duration) && a.duration > 0) {
          cacheAudio(audioUrl, a);
        }
      }, { once: true });
      a.addEventListener('canplaythrough', () => {
        cacheAudio(audioUrl, a);
      }, { once: true });
      // Cleanup on error
      a.addEventListener('error', () => { a.src = ''; }, { once: true });
    }
  }

  /* ══════════════════════════════════════════════════════════════
     PUBLIC API
     ══════════════════════════════════════════════════════════════ */

  return {
    startRecording,
    stopRecording,
    cancelRecording,
    generateWaveform,
    compressAudio,
    createPlayer,
    sendVoice,
    init,
    formatTimeSec,
    clearAudioCache,
    precacheVoiceMessages,
    restoreSttCache,
  };
})();

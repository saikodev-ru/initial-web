/* ══ VOICE MESSAGE — Telegram-style Recording, Preview, Playback, Upload ═══ */
window.VoiceMsg = (function () {
  'use strict';

  /* ── State ─────────────────────────────────────────────────── */
  let _mediaRecorder = null;
  let _audioCtx = null;
  let _analyser = null;
  let _stream = null;
  let _chunks = [];
  let _recStart = 0;
  let _recTimer = null;
  let _recOverlay = null;
  let _lockedOverlay = null;
  let _previewOverlay = null;
  let _recAnimFrame = null;
  let _recCancelled = false;
  let _isLocked = false;
  let _lockedTimer = null;
  let _pointerStartX = 0;
  let _pointerStartY = 0;
  let _swipeCancelActive = false;
  let _swipeLockActive = false;
  let _lockedCleanup = null;
  let _lockedSwipeStartX = 0;
  let _lockedSwiping = false;
  let _currentAudio = null;
  let _currentBtn = null;
  let _currentContainer = null;
  let _previewBlob = null;
  let _previewDuration = 0;
  let _previewWaveform = [];
  let _previewAudio = null;
  let _previewPlaying = false;
  let _previewAnimFrame = null;
  let _miniPlayer = null;
  let _miniPlayerAnimFrame = null;
  const _audioCache = new Map();

  let _isRecording = false;
  let _isPreviewMode = false;

  const BAR_COUNT = 44;
  const REC_BAR_COUNT = 48;
  const MIN_DURATION = 1;
  const MAX_DURATION = 300;
  const LOCK_THRESHOLD = 60;
  const CANCEL_THRESHOLD = 60;
  const CANCEL_COMPLETE = 140;

  /* ══════════════════════════════════════════════════════════════
     RECORDING
     ══════════════════════════════════════════════════════════════ */

  async function startRecording() {
    if (_mediaRecorder && _mediaRecorder.state === 'recording') return;

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
    if (_recCancelled || !_recOverlay) {
      stream.getTracks().forEach(t => t.stop());
      return;
    }

    _stream = stream;

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

    _chunks = [];
    _recCancelled = false;
    _isLocked = false;
    _isRecording = true;
    _mediaRecorder = new MediaRecorder(_stream, mimeType ? { mimeType } : {});
    _mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) _chunks.push(e.data); };

    _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = _audioCtx.createMediaStreamSource(_stream);
    _analyser = _audioCtx.createAnalyser();
    _analyser.fftSize = 128;
    source.connect(_analyser);

    _recStart = Date.now();
    _recTimer = setInterval(_updateRecTimer, 200);
    _mediaRecorder.start(200);
    _startRecVisualization();
  }

  function stopRecording() {
    return new Promise((resolve) => {
      if (!_mediaRecorder || _mediaRecorder.state !== 'recording') {
        resolve(null);
        return;
      }

      _stopRecVisualization();
      clearInterval(_recTimer);
      clearInterval(_lockedTimer);

      _mediaRecorder.onstop = async () => {
        _isRecording = false;
        if (_stream) _stream.getTracks().forEach(t => t.stop());
        if (_audioCtx) { try { _audioCtx.close(); } catch(e){} _audioCtx = null; }

        const duration = Math.round((Date.now() - _recStart) / 1000);

        if (_recCancelled || duration < MIN_DURATION) {
          _removeAllOverlays();
          resolve(null);
          return;
        }

        const blob = new Blob(_chunks, { type: _mediaRecorder.mimeType || 'audio/webm' });
        let waveform = [];
        try {
          waveform = await generateWaveform(blob);
        } catch (e) {
          waveform = Array.from({ length: BAR_COUNT }, () => 0.2 + Math.random() * 0.8);
        }

        resolve({ blob, duration, waveform, mimeType: _mediaRecorder.mimeType || 'audio/webm' });
      };
      _mediaRecorder.stop();
    });
  }

  function cancelRecording() {
    _recCancelled = true;
    _isRecording = false;
    if (_mediaRecorder && _mediaRecorder.state === 'recording') {
      _stopRecVisualization();
      clearInterval(_recTimer);
      clearInterval(_lockedTimer);
      _mediaRecorder.onstop = () => {
        if (_stream) _stream.getTracks().forEach(t => t.stop());
        if (_audioCtx) { try { _audioCtx.close(); } catch(e){} _audioCtx = null; }
        _removeAllOverlays();
      };
      _mediaRecorder.stop();
    } else {
      _removeAllOverlays();
    }
  }

  /* ══════════════════════════════════════════════════════════════
     OVERLAY MANAGEMENT — show/hide approach (preserves event handlers)
     ══════════════════════════════════════════════════════════════ */

  function _hideMfieldChildren() {
    const wrap = document.querySelector('.mfield-wrap');
    if (!wrap) return;
    // Hide original children using display:none (preserves DOM + event handlers)
    const children = wrap.querySelectorAll(':scope > .attach-btn-in, :scope > .mfield, :scope > .emo-btn-in:not(.attach-btn-in)');
    children.forEach(c => { c.style.display = 'none'; });
  }

  function _showMfieldChildren() {
    const wrap = document.querySelector('.mfield-wrap');
    if (!wrap) return;
    const children = wrap.querySelectorAll(':scope > .attach-btn-in, :scope > .mfield, :scope > .emo-btn-in:not(.attach-btn-in)');
    children.forEach(c => { c.style.display = ''; });
  }

  function _removeVoiceOverlays() {
    if (_recOverlay) {
      _recOverlay.style.background = '';
      _recOverlay.classList.remove('swipe-cancel');
      _recOverlay.remove();
      _recOverlay = null;
    }
    if (_lockedOverlay) {
      _lockedOverlay.style.transform = '';
      _lockedOverlay.style.background = '';
      _lockedOverlay.classList.remove('swipe-delete');
      _lockedOverlay.remove();
      _lockedOverlay = null;
    }
    // Clean up locked gesture listeners
    if (_lockedCleanup) { _lockedCleanup(); _lockedCleanup = null; }
    if (_previewOverlay) {
      if (_previewAudio) {
        _previewAudio.pause();
        if (_previewAudio.src.startsWith('blob:')) URL.revokeObjectURL(_previewAudio.src);
        _previewAudio = null;
      }
      _previewPlaying = false;
      _stopPreviewAnim();
      _previewBlob = null;
      _previewOverlay.remove();
      _previewOverlay = null;
    }
  }

  function _removeAllOverlays() {
    _removeVoiceOverlays();

    _isRecording = false;
    _isPreviewMode = false;
    _restoreBtnFromSend();

    const wrap = document.querySelector('.mfield-wrap');
    if (wrap) {
      wrap.classList.remove('voice-rec-active');
      wrap.style.height = '';
      wrap.style.minHeight = '';
      wrap.style.maxHeight = '';
      wrap.style.overflow = '';
      wrap.style.transform = '';
      wrap.style.opacity = '';
    }
    _showMfieldChildren();

    const sendBtn = document.getElementById('btn-send');
    if (sendBtn) sendBtn.classList.remove('hints-visible', 'recording');

    if (typeof updateSendBtn === 'function') updateSendBtn();
  }

  /* ── Recording UI (hold mode) ─────────────────────────────── */

  function _showRecOverlay() {
    const wrap = document.querySelector('.mfield-wrap');
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
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
          <polyline points="18 15 12 9 6 15"/>
        </svg>
        <span>Заблокировать</span>
      </div>
      <div class="voice-cancel-arrow" id="voice-cancel-arrow">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
        <span>Отменить</span>
      </div>
    `;

    wrap.appendChild(overlay);
    _recOverlay = overlay;

    // Show hints on mic button
    const sendBtn = document.getElementById('btn-send');
    if (sendBtn) sendBtn.classList.add('hints-visible', 'recording');

    // Build recording waveform bars
    const wfWrap = overlay.querySelector('#voice-rec-wave-container');
    if (wfWrap) {
      for (let i = 0; i < REC_BAR_COUNT; i++) {
        const bar = document.createElement('div');
        bar.className = 'voice-rec-bar';
        bar.style.height = '3px';
        wfWrap.appendChild(bar);
      }
    }
  }

  /* ── Lock mode (swipe up) — Telegram Desktop style ───────── */

  function _transitionToLocked() {
    if (_isLocked || !_recOverlay) return;
    _isLocked = true;
    _swipeLockActive = false;
    _swipeCancelActive = false;
    _lockedSwiping = false;

    // Stop current visualization — will restart on new overlay
    _stopRecVisualization();

    const wrap = document.querySelector('.mfield-wrap');
    if (!wrap) return;

    // Hide directional hints on mic button
    const sendBtn = document.getElementById('btn-send');
    if (sendBtn) sendBtn.classList.remove('hints-visible', 'recording');

    // Reset wrap transforms (in case user was mid-swipe)
    wrap.style.transform = '';
    wrap.style.opacity = '';

    // Clean up previous locked gesture listeners
    if (_lockedCleanup) { _lockedCleanup(); _lockedCleanup = null; }

    // ── Morph recording overlay → locked overlay IN-PLACE ──
    // Layout: [🗑 DELETE] [timer] [waveform fills remaining space] [■ STOP]
    const overlay = _recOverlay;
    _recOverlay = null;

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
      <button class="voice-locked-stop" id="voice-locked-stop" title="Остановить">
        <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>
      </button>
    `;

    _lockedOverlay = overlay;

    // Build waveform bars in the locked container
    const wfWrap = overlay.querySelector('#voice-locked-wave-container');
    if (wfWrap) {
      for (let i = 0; i < REC_BAR_COUNT; i++) {
        const bar = document.createElement('div');
        bar.className = 'voice-rec-bar';
        bar.style.height = '3px';
        wfWrap.appendChild(bar);
      }
    }

    // Restart visualization
    _startRecVisualization();

    // Locked timer (independent from _recTimer)
    _lockedTimer = setInterval(() => {
      const timerEl = document.getElementById('voice-locked-timer');
      if (timerEl) timerEl.textContent = _formatElapsed();
    }, 200);

    // Stop button: stop recording → go to preview
    const stopBtn = document.getElementById('voice-locked-stop');
    if (stopBtn) {
      stopBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        _onLockedStop();
      });
    }

    // Delete button: cancel recording
    const delBtn = document.getElementById('voice-locked-delete');
    if (delBtn) {
      delBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        cancelRecording();
      });
    }

    // ── Swipe-to-delete gesture on locked overlay ──
    const ac = new AbortController();
    _lockedCleanup = () => { ac.abort(); _lockedCleanup = null; };
    const LOCKED_CANCEL_THRESHOLD = 30;
    const LOCKED_CANCEL_COMPLETE = 120;

    // Mouse
    overlay.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      _lockedSwipeStartX = e.clientX;
      _lockedSwiping = false;
    }, { signal: ac.signal });

    document.addEventListener('mousemove', (e) => {
      if (!_isLocked || !_lockedOverlay) return;
      const dx = _lockedSwipeStartX - e.clientX;
      if (dx <= 0) {
        // Swipe back — reset
        if (_lockedSwiping) {
          _lockedSwiping = false;
          _lockedOverlay.style.transform = '';
          _lockedOverlay.style.background = '';
          _lockedOverlay.classList.remove('swipe-delete');
          const db = document.getElementById('voice-locked-delete');
          if (db) db.classList.remove('trash-open');
        }
        return;
      }
      if (dx > LOCKED_CANCEL_THRESHOLD && !_lockedSwiping) {
        _lockedSwiping = true;
      }
      if (!_lockedSwiping) return;

      const progress = Math.min(1, (dx - LOCKED_CANCEL_THRESHOLD) / (LOCKED_CANCEL_COMPLETE - LOCKED_CANCEL_THRESHOLD));
      _lockedOverlay.style.transform = 'translateX(' + (-progress * 70) + 'px)';
      _lockedOverlay.style.background = 'rgba(255,59,48,' + (progress * 0.18) + ')';

      if (progress > 0.1) _lockedOverlay.classList.add('swipe-delete');
      else _lockedOverlay.classList.remove('swipe-delete');

      const db = document.getElementById('voice-locked-delete');
      if (db) {
        db.style.transform = 'scale(' + (1 + progress * 0.25) + ')';
        db.style.color = 'rgba(255,59,58,' + (0.5 + progress * 0.5) + ')';
        if (progress > 0.3) db.classList.add('trash-open');
        else db.classList.remove('trash-open');
      }

      if (progress >= 1) {
        cancelRecording();
      }
    }, { signal: ac.signal });

    document.addEventListener('mouseup', () => {
      if (!_lockedSwiping || !_lockedOverlay) return;
      _lockedOverlay.style.transform = '';
      _lockedOverlay.style.background = '';
      _lockedOverlay.classList.remove('swipe-delete');
      const db = document.getElementById('voice-locked-delete');
      if (db) {
        db.style.transform = '';
        db.style.color = '';
        db.classList.remove('trash-open');
      }
      _lockedSwiping = false;
    }, { signal: ac.signal });

    // Touch
    overlay.addEventListener('touchstart', (e) => {
      if (e.target.closest('button')) return;
      _lockedSwipeStartX = e.touches[0].clientX;
      _lockedSwiping = false;
    }, { passive: true, signal: ac.signal });

    document.addEventListener('touchmove', (e) => {
      if (!_isLocked || !_lockedOverlay) return;
      const dx = _lockedSwipeStartX - e.touches[0].clientX;
      if (dx <= 0) {
        if (_lockedSwiping) {
          _lockedSwiping = false;
          _lockedOverlay.style.transform = '';
          _lockedOverlay.style.background = '';
          _lockedOverlay.classList.remove('swipe-delete');
          const db = document.getElementById('voice-locked-delete');
          if (db) db.classList.remove('trash-open');
        }
        return;
      }
      if (dx > LOCKED_CANCEL_THRESHOLD && !_lockedSwiping) _lockedSwiping = true;
      if (!_lockedSwiping) return;

      const progress = Math.min(1, (dx - LOCKED_CANCEL_THRESHOLD) / (LOCKED_CANCEL_COMPLETE - LOCKED_CANCEL_THRESHOLD));
      _lockedOverlay.style.transform = 'translateX(' + (-progress * 70) + 'px)';
      _lockedOverlay.style.background = 'rgba(255,59,48,' + (progress * 0.18) + ')';
      if (progress > 0.1) _lockedOverlay.classList.add('swipe-delete');
      else _lockedOverlay.classList.remove('swipe-delete');

      const db = document.getElementById('voice-locked-delete');
      if (db) {
        db.style.transform = 'scale(' + (1 + progress * 0.25) + ')';
        db.style.color = 'rgba(255,59,58,' + (0.5 + progress * 0.5) + ')';
        if (progress > 0.3) db.classList.add('trash-open');
        else db.classList.remove('trash-open');
      }
      if (progress >= 1) cancelRecording();
    }, { passive: true, signal: ac.signal });

    document.addEventListener('touchend', () => {
      if (!_lockedSwiping || !_lockedOverlay) return;
      _lockedOverlay.style.transform = '';
      _lockedOverlay.style.background = '';
      _lockedOverlay.classList.remove('swipe-delete');
      const db = document.getElementById('voice-locked-delete');
      if (db) {
        db.style.transform = '';
        db.style.color = '';
        db.classList.remove('trash-open');
      }
      _lockedSwiping = false;
    }, { signal: ac.signal });
  }

  async function _onLockedStop() {
    const result = await stopRecording();
    if (result) {
      _showPreview(result.blob, result.duration, result.waveform);
    } else {
      _removeAllOverlays();
    }
  }

  /* ── Preview mode ─────────────────────────────────────────── */

  function _showPreview(blob, duration, waveform) {
    const wrap = document.querySelector('.mfield-wrap');
    if (!wrap) return;

    _isPreviewMode = true;
    _previewBlob = blob;
    _previewDuration = duration;
    _previewWaveform = waveform;
    _previewPlaying = false;

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
        <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M8 5v14l11-7z"/></svg>
      </button>
      <div class="voice-preview-wave" id="voice-preview-wave"></div>
      <span class="voice-preview-dur" id="voice-preview-dur">${formatTimeSec(duration)}</span>
    `;

    wrap.appendChild(overlay);
    _previewOverlay = overlay;

    // Transform mic button into send button
    _transformBtnToSend();

    // Build waveform bars in preview
    const wfWrap = overlay.querySelector('#voice-preview-wave');
    const wfData = waveform || Array.from({ length: BAR_COUNT }, () => 0.3 + Math.random() * 0.7);
    for (let i = 0; i < wfData.length; i++) {
      const bar = document.createElement('div');
      bar.className = 'voice-wf-bar';
      bar.style.height = (3 + wfData[i] * 25) + 'px';
      bar.dataset.idx = String(i);
      wfWrap.appendChild(bar);
    }

    // Create audio for preview
    _previewAudio = new Audio();
    _previewAudio.preload = 'metadata';
    _previewAudio.src = URL.createObjectURL(blob);

    const PLAY_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M8 5v14l11-7z"/></svg>';
    const PAUSE_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>';

    // Play button
    document.getElementById('voice-preview-play').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      _togglePreviewPlay(PLAY_SVG, PAUSE_SVG);
    });

    // Waveform seek
    wfWrap.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!_previewAudio.duration || !isFinite(_previewAudio.duration)) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      _previewAudio.currentTime = pct * _previewAudio.duration;
      _updatePreviewProgress();
      if (!_previewPlaying) _togglePreviewPlay(PLAY_SVG, PAUSE_SVG);
    });

    // Delete button
    document.getElementById('voice-preview-delete').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      _dismissPreview();
    });

    // Audio ended
    _previewAudio.addEventListener('ended', () => {
      _previewPlaying = false;
      const playBtn = document.getElementById('voice-preview-play');
      if (playBtn) playBtn.innerHTML = PLAY_SVG;
      _stopPreviewAnim();
      _resetPreviewWaveform();
      _updatePreviewDur();
    });
  }

  function _togglePreviewPlay(PLAY_SVG, PAUSE_SVG) {
    if (!_previewAudio) return;

    if (_previewPlaying) {
      _previewAudio.pause();
      _previewPlaying = false;
      const playBtn = document.getElementById('voice-preview-play');
      if (playBtn) playBtn.innerHTML = PLAY_SVG;
      _stopPreviewAnim();
    } else {
      _previewAudio.play().catch(() => {});
      _previewPlaying = true;
      const playBtn = document.getElementById('voice-preview-play');
      if (playBtn) playBtn.innerHTML = PAUSE_SVG;
      _startPreviewAnim();
    }
  }

  function _startPreviewAnim() {
    function tick() {
      _updatePreviewProgress();
      if (_previewPlaying) _previewAnimFrame = requestAnimationFrame(tick);
    }
    tick();
  }

  function _stopPreviewAnim() {
    if (_previewAnimFrame) { cancelAnimationFrame(_previewAnimFrame); _previewAnimFrame = null; }
  }

  function _updatePreviewProgress() {
    if (!_previewAudio || !_previewAudio.duration || !isFinite(_previewAudio.duration)) return;
    const pct = _previewAudio.currentTime / _previewAudio.duration;
    const bars = _previewOverlay ? _previewOverlay.querySelectorAll('.voice-wf-bar') : [];
    const count = bars.length;
    const playedIdx = Math.floor(pct * count);
    bars.forEach((bar, i) => {
      bar.classList.toggle('played', i < playedIdx);
      bar.classList.toggle('active', i === playedIdx);
    });
    _updatePreviewDur();
  }

  function _updatePreviewDur() {
    if (!_previewAudio) return;
    const durEl = document.getElementById('voice-preview-dur');
    if (!durEl) return;
    const dur = isFinite(_previewAudio.duration) ? _previewAudio.duration : _previewDuration;
    if (_previewPlaying) {
      durEl.textContent = formatTimeSec(_previewAudio.currentTime) + ' / ' + formatTimeSec(dur);
    } else {
      durEl.textContent = formatTimeSec(dur);
    }
  }

  function _resetPreviewWaveform() {
    if (!_previewOverlay) return;
    const bars = _previewOverlay.querySelectorAll('.voice-wf-bar');
    bars.forEach(b => { b.classList.remove('played', 'active'); });
  }

  /* ── Button state management ──────────────────────────────── */

  function _transformBtnToSend() {
    const btn = document.getElementById('btn-send');
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
    btn._previewSendHandler = function(e) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      _sendPreview();
      return false;
    };
    btn.addEventListener('click', btn._previewSendHandler, true);
  }

  function _restoreBtnFromSend() {
    const btn = document.getElementById('btn-send');
    if (!btn) return;

    _isPreviewMode = false;

    // Restore hint elements
    const hints = btn.querySelectorAll('.rec-hint-lock, .rec-hint-cancel');
    hints.forEach(h => h.style.display = '');

    // Remove voice-send-mode
    btn.classList.remove('voice-send-mode', 'recording', 'hints-visible');

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
    if (_previewAudio) {
      _previewAudio.pause();
      if (_previewAudio.src.startsWith('blob:')) URL.revokeObjectURL(_previewAudio.src);
      _previewAudio = null;
    }
    _previewPlaying = false;
    _stopPreviewAnim();
    _previewBlob = null;

    _removeAllOverlays();
  }

  async function _sendPreview() {
    if (!_previewBlob || !_previewDuration) return;

    const blob = _previewBlob;
    const duration = _previewDuration;
    const waveform = _previewWaveform;

    // Clean up preview audio
    if (_previewAudio) {
      _previewAudio.pause();
      if (_previewAudio.src.startsWith('blob:')) URL.revokeObjectURL(_previewAudio.src);
      _previewAudio = null;
    }
    _previewPlaying = false;
    _stopPreviewAnim();
    _previewBlob = null;

    // Remove preview overlay and restore button
    _removeVoiceOverlays();
    _restoreBtnFromSend();

    const wrap = document.querySelector('.mfield-wrap');
    if (wrap) {
      wrap.classList.remove('voice-rec-active');
      wrap.style.height = '';
      wrap.style.minHeight = '';
      wrap.style.maxHeight = '';
      wrap.style.overflow = '';
    }
    _showMfieldChildren();
    if (typeof updateSendBtn === 'function') updateSendBtn();

    // Send voice
    sendVoice(blob, duration, waveform);
  }

  /* ── Timer helpers ──────────────────────────────────────── */

  function _updateRecTimer() {
    if (!_recOverlay && !_isLocked) return;
    const elapsed = Math.floor((Date.now() - _recStart) / 1000);

    if (_recOverlay) {
      const timer = _recOverlay.querySelector('.voice-rec-timer');
      if (timer) timer.textContent = formatTimeSec(elapsed);
    }

    if (elapsed >= MAX_DURATION) {
      if (_isLocked) {
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
    const elapsed = Math.floor((Date.now() - _recStart) / 1000);
    return formatTimeSec(elapsed);
  }

  /* ── Recording visualization ──────────────────────────────── */

  function _startRecVisualization() {
    if (!_analyser) return;
    const bufLen = _analyser.frequencyBinCount;
    const data = new Uint8Array(bufLen);

    function draw() {
      _recAnimFrame = requestAnimationFrame(draw);
      _analyser.getByteFrequencyData(data);

      const container = _recOverlay || _lockedOverlay;
      if (!container) return;

      const bars = container.querySelectorAll('.voice-rec-bar');
      if (!bars || !bars.length) return;

      const totalBars = bars.length;
      const elapsed = (Date.now() - _recStart) / 1000;
      const progress = Math.min(1, elapsed / MAX_DURATION);
      const visibleBars = Math.max(3, Math.min(totalBars, Math.ceil(progress * totalBars)));

      const step = Math.max(1, Math.floor(bufLen / visibleBars));
      for (let i = 0; i < totalBars; i++) {
        if (i >= visibleBars) {
          bars[i].style.opacity = '0';
          bars[i].style.height = '3px';
        } else {
          bars[i].style.opacity = '1';
          const freqIdx = Math.min((visibleBars - 1 - i) * step, bufLen - 1);
          const val = data[freqIdx] / 255;
          const h = Math.max(3, val * 28);
          bars[i].style.height = h + 'px';
        }
      }
    }
    draw();
  }

  function _stopRecVisualization() {
    if (_recAnimFrame) {
      cancelAnimationFrame(_recAnimFrame);
      _recAnimFrame = null;
    }
  }

  /* ── Pointer (mouse + touch) gesture handling ─────────────── */

  function _onPointerMove(clientX, clientY) {
    if (_isLocked || !_recOverlay) return;

    const dx = _pointerStartX - clientX;
    const dy = _pointerStartY - clientY;

    const cancelHint = _recOverlay.querySelector('#voice-cancel-arrow');
    const lockHint = _recOverlay.querySelector('#voice-lock-arrow');

    // Swipe UP → lock
    if (dy > 0) {
      const lockProgress = Math.min(1, dy / LOCK_THRESHOLD);
      if (lockProgress > 0.2 && !_swipeLockActive) {
        _swipeLockActive = true;
        if (lockHint) lockHint.classList.add('show');
      }
      if (lockHint) {
        lockHint.style.opacity = String(Math.min(1, lockProgress * 1.5));
      }
      if (dy >= LOCK_THRESHOLD && !_isLocked) {
        _transitionToLocked();
        return;
      }
    } else {
      if (_swipeLockActive) {
        _swipeLockActive = false;
        if (lockHint) { lockHint.classList.remove('show'); lockHint.style.opacity = ''; }
      }
    }

    // Swipe LEFT → cancel (with red panel + trash animation)
    if (dx > 0) {
      const cancelProgress = Math.min(1, (dx - CANCEL_THRESHOLD) / (CANCEL_COMPLETE - CANCEL_THRESHOLD));
      if (dx > CANCEL_THRESHOLD && !_swipeCancelActive) {
        _swipeCancelActive = true;
        if (cancelHint) cancelHint.classList.add('show');
        if (_recOverlay) _recOverlay.classList.add('swipe-cancel');
      }
      if (_swipeCancelActive) {
        const p = Math.max(0, cancelProgress);
        const wrap = document.querySelector('.mfield-wrap');
        if (wrap) {
          wrap.style.transform = 'translateX(' + (-p * 80) + 'px)';
          wrap.style.opacity = String(1 - p * 0.4);
        }
        // Red tint on recording overlay
        if (_recOverlay) {
          _recOverlay.style.background = 'rgba(255,59,48,' + (p * 0.2) + ')';
        }
        if (cancelHint) {
          cancelHint.style.opacity = String(Math.max(0.5, p));
          // Scale the cancel hint with progress
          cancelHint.style.transform = 'translateY(-50%) translateX(calc(100% + 6px)) scale(' + (1 + p * 0.15) + ')';
        }

        if (p >= 1) {
          cancelRecording();
        }
      }
    } else {
      if (_swipeCancelActive) {
        _swipeCancelActive = false;
        const wrap = document.querySelector('.mfield-wrap');
        if (wrap) {
          wrap.style.transform = '';
          wrap.style.opacity = '';
        }
        if (_recOverlay) {
          _recOverlay.style.background = '';
          _recOverlay.classList.remove('swipe-cancel');
        }
        if (cancelHint) {
          cancelHint.classList.remove('show');
          cancelHint.style.opacity = '';
          cancelHint.style.transform = '';
        }
      }
    }
  }

  function _onPointerEnd() {
    // Hold mode: stop recording → send directly (Telegram behavior)
    if (!_isLocked && !_recCancelled) {
      // Reset transform on wrap
      const wrap = document.querySelector('.mfield-wrap');
      if (wrap) {
        wrap.style.transform = '';
        wrap.style.opacity = '';
      }

      const cancelHint = _recOverlay?.querySelector('#voice-cancel-arrow');
      if (cancelHint) { cancelHint.classList.remove('show'); cancelHint.style.opacity = ''; cancelHint.style.transform = ''; }
      const lockHint = _recOverlay?.querySelector('#voice-lock-arrow');
      if (lockHint) { lockHint.classList.remove('show'); lockHint.style.opacity = ''; }

      // Reset any swipe-cancel styling
      if (_recOverlay) {
        _recOverlay.style.background = '';
        _recOverlay.classList.remove('swipe-cancel');
      }

      // Hide hints
      const sendBtn = document.getElementById('btn-send');
      if (sendBtn) sendBtn.classList.remove('hints-visible', 'recording');

      _swipeCancelActive = false;
      _swipeLockActive = false;

      // If media recorder is actually recording, stop and send
      if (_mediaRecorder && _mediaRecorder.state === 'recording') {
        stopRecording().then(result => {
          if (result) {
            _removeVoiceOverlays();
            _restoreBtnFromSend();
            if (wrap) {
              wrap.classList.remove('voice-rec-active');
              wrap.style.height = '';
              wrap.style.minHeight = '';
              wrap.style.maxHeight = '';
              wrap.style.overflow = '';
            }
            _showMfieldChildren();
            if (typeof updateSendBtn === 'function') updateSendBtn();

            sendVoice(result.blob, result.duration, result.waveform);
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

  /* ══════════════════════════════════════════════════════════════
     PLAYBACK (in chat messages)
     ══════════════════════════════════════════════════════════════ */

  function createPlayer(container, audioUrl, duration, waveform) {
    if (!container || !audioUrl) return;

    const playBtn = container.querySelector('.voice-play-btn');
    const wfWrap = container.querySelector('.voice-wf-bars');
    const metaEl = container.closest('.mbody')?.querySelector('.voice-meta') || container.parentElement?.querySelector('.voice-meta');
    const durEl = metaEl ? metaEl.querySelector('.voice-dur') : null;
    if (!playBtn || !wfWrap) return;

    if (!waveform || waveform.length === 0) {
      waveform = Array.from({ length: BAR_COUNT }, () => 0.25 + Math.random() * 0.75);
    }

    const barCount = waveform.length;

    wfWrap.innerHTML = '';
    for (let i = 0; i < barCount; i++) {
      const bar = document.createElement('div');
      bar.className = 'voice-wf-bar';
      bar.style.height = (3 + waveform[i] * 25) + 'px';
      bar.dataset.idx = String(i);
      wfWrap.appendChild(bar);
    }

    const bars = wfWrap.querySelectorAll('.voice-wf-bar');

    let audio;
    const cached = _audioCache.get(audioUrl);
    if (cached) {
      audio = cached;
      if (durEl && isFinite(audio.duration)) {
        durEl.textContent = formatTimeSec(audio.duration);
      }
    } else {
      audio = new Audio();
      audio.preload = 'metadata';
      audio.src = audioUrl;
      audio.addEventListener('loadedmetadata', () => {
        if (isFinite(audio.duration) && audio.duration > 0) {
          _audioCache.set(audioUrl, audio);
        }
      }, { once: true });
    }
    let isPlaying = false;
    let animFrame = null;

    const PLAY_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
    const PAUSE_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>';

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
      if (durEl) durEl.textContent = timeStr;
      _updateMiniPlayer(audio, waveform, timeStr);
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
      if (isFinite(audio.duration) && audio.duration > 0 && durEl) {
        durEl.textContent = formatTimeSec(audio.duration);
      }
    }, { once: true });

    audio.addEventListener('ended', () => {
      isPlaying = false;
      playBtn.innerHTML = PLAY_SVG;
      playBtn.classList.remove('playing');
      stopAnim();
      bars.forEach(b => { b.classList.remove('played', 'active'); });
      if (durEl) durEl.textContent = formatTimeSec(audio.duration || duration);
      if (_currentAudio === audio) { _currentAudio = null; _currentBtn = null; _currentContainer = null; }
      _hideMiniPlayer();
      _autoPlayNext(container);
    });

    audio.addEventListener('error', () => {
      if (durEl) durEl.textContent = formatTimeSec(duration);
    });

    function toggle() {
      if (_currentAudio && _currentAudio !== audio && !_currentAudio.paused) {
        _currentAudio.pause();
        _currentAudio.currentTime = 0;
        if (_currentBtn) {
          _currentBtn.innerHTML = PLAY_SVG;
          _currentBtn.classList.remove('playing');
        }
        if (_currentContainer) {
          _currentContainer.querySelectorAll('.voice-wf-bar').forEach(b => b.classList.remove('played', 'active'));
          const otherDur = _currentContainer.querySelector('.voice-dur');
          if (otherDur && _currentContainer._voiceAudio && isFinite(_currentContainer._voiceAudio.duration)) {
            otherDur.textContent = formatTimeSec(_currentContainer._voiceAudio.duration);
          }
        }
      }

      if (isPlaying) {
        audio.pause();
        isPlaying = false;
        playBtn.innerHTML = PLAY_SVG;
        playBtn.classList.remove('playing');
        stopAnim();
        _currentAudio = null;
        _currentBtn = null;
        _currentContainer = null;
        _hideMiniPlayer();
      } else {
        audio.play().catch(() => {});
        isPlaying = true;
        playBtn.innerHTML = PAUSE_SVG;
        playBtn.classList.add('playing');
        startAnim();
        _currentAudio = audio;
        _currentBtn = playBtn;
        _currentContainer = container;
        container._voiceAudio = audio;
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

    if (duration > 0 && durEl) {
      durEl.textContent = formatTimeSec(duration);
    }
  }

  /* ── Auto-play next voice message ─────────────────────────── */

  function _autoPlayNext(currentContainer) {
    const currentRow = currentContainer.closest('.mrow');
    if (!currentRow) return;
    const msgs = document.getElementById('msgs');
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
    const msgs = document.getElementById('msgs');
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
      if (_currentAudio && !_currentAudio.paused) {
        _currentAudio.pause();
        _currentAudio.currentTime = 0;
        if (_currentBtn) {
          _currentBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
          _currentBtn.classList.remove('playing');
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
    const chatArea = document.getElementById('chat-area');
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
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
      </button>
      <button class="vmp-btn vmp-next" id="vmp-next" title="Следующее">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
      </button>
      <button class="vmp-close" id="vmp-close" title="Закрыть">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    `;

    chatHdr.insertAdjacentElement('afterend', el);
    _miniPlayer = el;

    const PLAY_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
    const PAUSE_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>';

    document.getElementById('vmp-play').addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (_currentAudio) {
        if (_currentAudio.paused) {
          _currentAudio.play().catch(() => {});
          if (_currentBtn) { _currentBtn.innerHTML = PAUSE_SVG; _currentBtn.classList.add('playing'); }
          document.getElementById('vmp-play').innerHTML = PAUSE_SVG;
        } else {
          _currentAudio.pause();
          if (_currentBtn) { _currentBtn.innerHTML = PLAY_SVG; _currentBtn.classList.remove('playing'); }
          document.getElementById('vmp-play').innerHTML = PLAY_SVG;
        }
      }
    });

    document.getElementById('vmp-prev').addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (_currentAudio && _currentContainer) _playPrevVoice(_currentContainer);
    });

    document.getElementById('vmp-next').addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (_currentAudio && _currentContainer) _autoPlayNext(_currentContainer);
    });

    document.getElementById('vmp-close').addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (_currentAudio && !_currentAudio.paused) _currentAudio.pause();
      if (_currentBtn) { _currentBtn.innerHTML = PLAY_SVG; _currentBtn.classList.remove('playing'); }
      _hideMiniPlayer();
    });
  }

  function _showMiniPlayer(audio, waveform, senderName, avatarEl) {
    if (!_miniPlayer) return;
    const nameEl = document.getElementById('vmp-name');
    if (nameEl) nameEl.textContent = senderName || 'Голосовое сообщение';

    const avatarContainer = document.getElementById('vmp-avatar');
    if (avatarContainer) {
      if (avatarEl) {
        const img = document.createElement('img'); img.src = avatarEl.src; img.alt = '';
        avatarContainer.innerHTML = ''; avatarContainer.appendChild(img);
      } else { avatarContainer.textContent = ''; }
    }

    const waveEl = document.getElementById('vmp-wave');
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

    const playBtn = document.getElementById('vmp-play');
    if (playBtn && audio && !audio.paused) {
      playBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>';
    } else if (playBtn) {
      playBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
    }
    _miniPlayer.classList.add('visible');
  }

  function _updateMiniPlayer(audio, waveform, timeStr) {
    if (!_miniPlayer || !_miniPlayer.classList.contains('visible')) return;
    const waveEl = document.getElementById('vmp-wave');
    if (waveEl && audio.duration && isFinite(audio.duration)) {
      const pct = audio.currentTime / audio.duration;
      const bars = waveEl.querySelectorAll('.vmp-wf-bar');
      const playedIdx = Math.floor(pct * bars.length);
      bars.forEach((bar, i) => { bar.classList.toggle('played', i < playedIdx); bar.classList.toggle('active', i === playedIdx); });
    }
    const timeEl = document.getElementById('vmp-time');
    if (timeEl) timeEl.textContent = timeStr || '';
  }

  function _hideMiniPlayer() {
    if (!_miniPlayer) return;
    _miniPlayer.classList.remove('visible');
  }

  /* ══ SEND VOICE ════════════════════════════════════════════════ */

  async function sendVoice(blob, duration, waveform, toSignalId, replyTo) {
    if (!S.partner) return;
    const replyId = replyTo || S.replyTo?.id || null;
    const toSid = toSignalId || S.partner.partner_signal_id;
    if (!toSid) return;

    const tid = 't' + Date.now();
    const tmp = {
      id: tid, sender_id: S.user.id, body: String(duration),
      sent_at: Math.floor(Date.now() / 1000), is_read: 0, is_edited: 0,
      nickname: S.user.nickname, avatar_url: S.user.avatar_url, reply_to: replyId,
      media_url: URL.createObjectURL(blob), media_type: 'voice',
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

    // Sending happens in background (compression on server if ffmpeg available)
    // No label shown — optimistic UI message is already visible in chat

    var fd = new FormData();
    fd.append('voice', blob, 'voice.webm');
    fd.append('to_signal_id', toSid);
    if (replyId) fd.append('reply_to', String(replyId));
    fd.append('voice_duration', String(duration));
    fd.append('voice_waveform', JSON.stringify(waveform));

    let res;
    try { res = await api('send_voice_message', 'POST', fd, true); }
    catch (e) {
      toast('Ошибка отправки голосового', 'err');
      document.querySelector(`.mrow[data-id="${tid}"]`)?.remove();
      if (S.msgs[S.chatId]) S.msgs[S.chatId] = S.msgs[S.chatId].filter(m => m.id !== tid);
      return;
    }

    S._pendingTids.delete(tid);
    if (!res.ok) {
      toast('Ошибка: ' + (res.message || ''), 'err');
      document.querySelector(`.mrow[data-id="${tid}"]`)?.remove();
      if (S.msgs[S.chatId]) S.msgs[S.chatId] = S.msgs[S.chatId].filter(m => m.id !== tid);
      return;
    }

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

  function formatTimeSec(s) {
    s = Math.max(0, Math.floor(s));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  /* ══════════════════════════════════════════════════════════════
     UI BINDING — Mic button ↔ hold-to-record with gestures
     ══════════════════════════════════════════════════════════════ */

  function init() {
    const btn = document.getElementById('btn-send');
    if (!btn) return;

    _initMiniPlayer();

    function isMicMode() {
      return !btn.classList.contains('has-text') && !_isPreviewMode;
    }

    // ── Mouse (desktop) ──
    btn.addEventListener('mousedown', (e) => {
      if (!isMicMode()) return;
      e.preventDefault();
      e.stopPropagation();
      _pointerStartX = e.clientX;
      _pointerStartY = e.clientY;
      startRecording();
      setTimeout(() => { btn.classList.remove('hints-visible'); }, 800);
    });

    document.addEventListener('mousemove', (e) => {
      if (!_mediaRecorder || _mediaRecorder.state !== 'recording') return;
      if (_isLocked) return;
      _onPointerMove(e.clientX, e.clientY);
    });

    document.addEventListener('mouseup', () => {
      // Check if we're in voice recording flow (overlay shown OR recorder active)
      if (!_recOverlay && (!_mediaRecorder || _mediaRecorder.state !== 'recording')) return;
      if (_recCancelled || _isLocked) return;
      btn.classList.remove('hints-visible', 'recording');
      _onPointerEnd();
    });

    // ── Touch (mobile) ──
    btn.addEventListener('touchstart', (e) => {
      if (!isMicMode()) return;
      e.preventDefault();
      e.stopPropagation();
      _pointerStartX = e.touches[0].clientX;
      _pointerStartY = e.touches[0].clientY;
      startRecording();
      setTimeout(() => { btn.classList.remove('hints-visible'); }, 800);
    }, { passive: false });

    document.addEventListener('touchmove', (e) => {
      if (!_mediaRecorder || _mediaRecorder.state !== 'recording') return;
      if (_isLocked) return;
      _onPointerMove(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });

    document.addEventListener('touchend', () => {
      if (!_recOverlay && (!_mediaRecorder || _mediaRecorder.state !== 'recording')) return;
      if (_recCancelled || _isLocked) return;
      btn.classList.remove('hints-visible', 'recording');
      _onPointerEnd();
    });

    // Prevent context menu on long press
    btn.addEventListener('contextmenu', (e) => {
      if (!isMicMode()) return;
      e.preventDefault();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* ══════════════════════════════════════════════════════════════
     PUBLIC API
     ══════════════════════════════════════════════════════════════ */

  return {
    startRecording,
    stopRecording,
    cancelRecording,
    generateWaveform,
    createPlayer,
    sendVoice,
    init,
  };
})();

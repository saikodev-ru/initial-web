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
  let _recOverlay = null;       // recording overlay DOM element
  let _lockedOverlay = null;    // locked recording overlay
  let _previewOverlay = null;   // preview overlay
  let _recAnimFrame = null;
  let _recCancelled = false;
  let _isLocked = false;
  let _lockedTimer = null;
  let _pointerStartX = 0;
  let _pointerStartY = 0;
  let _swipeCancelActive = false;
  let _swipeLockActive = false;
  let _currentAudio = null;
  let _currentBtn = null;
  let _currentContainer = null;
  let _previewBlob = null;
  let _previewDuration = 0;
  let _previewWaveform = [];
  let _previewAudio = null;
  let _previewPlaying = false;
  let _previewAnimFrame = null;

  const BAR_COUNT = 44;
  const REC_BAR_COUNT = 36;
  const MIN_DURATION = 1;
  const MAX_DURATION = 300;
  const LOCK_THRESHOLD = 50;   // px up to lock
  const CANCEL_THRESHOLD = 60; // px left to start cancel
  const CANCEL_COMPLETE = 120; // px left to complete cancel

  /* ══════════════════════════════════════════════════════════════
     RECORDING
     ══════════════════════════════════════════════════════════════ */

  async function startRecording() {
    if (_mediaRecorder && _mediaRecorder.state === 'recording') return;
    try {
      _stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      toast('Нет доступа к микрофону', 'err');
      return;
    }

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
    _mediaRecorder = new MediaRecorder(_stream, mimeType ? { mimeType } : {});
    _mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) _chunks.push(e.data); };

    // Analyser for live waveform
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = _audioCtx.createMediaStreamSource(_stream);
    _analyser = _audioCtx.createAnalyser();
    _analyser.fftSize = 128;
    source.connect(_analyser);

    // Show recording UI
    _showRecOverlay();

    _recStart = Date.now();
    _recTimer = setInterval(_updateRecTimer, 200);
    _mediaRecorder.start(200);
    _startRecVisualization();
  }

  function stopRecording() {
    return new Promise((resolve, reject) => {
      if (!_mediaRecorder || _mediaRecorder.state !== 'recording') {
        resolve(null);
        return;
      }

      _stopRecVisualization();
      clearInterval(_recTimer);
      clearInterval(_lockedTimer);

      _mediaRecorder.onstop = async () => {
        if (_stream) _stream.getTracks().forEach(t => t.stop());
        if (_audioCtx) { try { _audioCtx.close(); } catch(e){} _audioCtx = null; }

        const duration = Math.round((Date.now() - _recStart) / 1000);
        _removeAllOverlays();

        if (_recCancelled || duration < MIN_DURATION) {
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
    }
  }

  /* ── Recording UI (hold mode) ─────────────────────────────── */

  function _showRecOverlay() {
    const zone = $('input-zone');
    if (!zone) return;

    _hideInputChildren(zone);

    // Remove any existing overlays
    _removeAllOverlays();

    const overlay = document.createElement('div');
    overlay.className = 'voice-recording';
    overlay.id = 'voice-rec-overlay';
    overlay.innerHTML = `
      <div class="voice-rec-dot"></div>
      <span class="voice-rec-timer">0:00</span>
      <div class="voice-rec-wave"></div>
      <div class="voice-rec-cancel" id="voice-rec-cancel">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        </svg>
        <span>Отменить</span>
      </div>
      <div class="voice-swipe-hint" id="voice-swipe-cancel">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        </svg>
      </div>
      <div class="voice-lock-hint" id="voice-lock-hint">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
      </div>
    `;

    zone.appendChild(overlay);
    _recOverlay = overlay;

    // Build recording bars
    const wfWrap = overlay.querySelector('.voice-rec-wave');
    for (let i = 0; i < REC_BAR_COUNT; i++) {
      const bar = document.createElement('div');
      bar.className = 'voice-rec-bar';
      bar.style.height = '4px';
      wfWrap.appendChild(bar);
    }
  }

  /* ── Lock mode (swipe up) ─────────────────────────────────── */

  function _transitionToLocked() {
    if (_isLocked || !_recOverlay) return;
    _isLocked = true;

    const zone = $('input-zone');
    if (!zone) return;

    // Remove hold overlay
    if (_recOverlay) { _recOverlay.remove(); _recOverlay = null; }

    _showLockedOverlay(zone);
  }

  function _showLockedOverlay(zone) {
    const overlay = document.createElement('div');
    overlay.className = 'voice-locked';
    overlay.id = 'voice-locked-overlay';
    overlay.innerHTML = `
      <button class="voice-locked-stop" id="voice-locked-stop" title="Остановить">
        <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>
      </button>
      <span class="voice-locked-timer" id="voice-locked-timer">${_formatElapsed()}</span>
      <div class="voice-locked-wave"></div>
      <button class="voice-locked-delete" id="voice-locked-delete" title="Удалить">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        </svg>
      </button>
    `;

    zone.appendChild(overlay);
    _lockedOverlay = overlay;

    // Build bars
    const wfWrap = overlay.querySelector('.voice-locked-wave');
    for (let i = 0; i < REC_BAR_COUNT; i++) {
      const bar = document.createElement('div');
      bar.className = 'voice-rec-bar';
      bar.style.height = '4px';
      wfWrap.appendChild(bar);
    }

    // Restart visualization for new bars
    _stopRecVisualization();
    _startRecVisualization();

    // Locked timer
    _lockedTimer = setInterval(() => {
      const timerEl = $('voice-locked-timer');
      if (timerEl) timerEl.textContent = _formatElapsed();
    }, 200);

    // Stop button: stop recording, go to preview
    $('voice-locked-stop').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      _onLockedStop();
    });

    // Delete button: cancel recording
    $('voice-locked-delete').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      cancelRecording();
    });
  }

  async function _onLockedStop() {
    const result = await stopRecording();
    if (result) {
      _showPreview(result.blob, result.duration, result.waveform);
    }
  }

  /* ── Preview mode ─────────────────────────────────────────── */

  function _showPreview(blob, duration, waveform) {
    const zone = $('input-zone');
    if (!zone) return;

    _hideInputChildren(zone);

    _previewBlob = blob;
    _previewDuration = duration;
    _previewWaveform = waveform;
    _previewPlaying = false;

    // Create preview overlay
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
      <button class="voice-preview-send" id="voice-preview-send" title="Отправить">
        <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
      </button>
    `;

    zone.appendChild(overlay);
    _previewOverlay = overlay;

    // Build waveform bars in preview
    const wfWrap = overlay.querySelector('.voice-preview-wave');
    const wfData = waveform || Array.from({ length: BAR_COUNT }, () => 0.3 + Math.random() * 0.7);
    for (let i = 0; i < wfData.length; i++) {
      const bar = document.createElement('div');
      bar.className = 'voice-wf-bar';
      bar.style.height = (4 + wfData[i] * 24) + 'px';
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
    $('voice-preview-play').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      _togglePreviewPlay(PLAY_SVG, PAUSE_SVG);
    });

    // Waveform seek
    $('voice-preview-wave').addEventListener('click', (e) => {
      e.stopPropagation();
      if (!_previewAudio.duration || !isFinite(_previewAudio.duration)) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      _previewAudio.currentTime = pct * _previewAudio.duration;
      _updatePreviewProgress();
      if (!_previewPlaying) _togglePreviewPlay(PLAY_SVG, PAUSE_SVG);
    });

    // Delete button
    $('voice-preview-delete').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      _dismissPreview();
    });

    // Send button
    $('voice-preview-send').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      _sendPreview();
    });

    // Audio ended
    _previewAudio.addEventListener('ended', () => {
      _previewPlaying = false;
      $('voice-preview-play').innerHTML = PLAY_SVG;
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
      $('voice-preview-play').innerHTML = PLAY_SVG;
      _stopPreviewAnim();
    } else {
      _previewAudio.play().catch(() => {});
      _previewPlaying = true;
      $('voice-preview-play').innerHTML = PAUSE_SVG;
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
    const bars = $$('.voice-wf-bar', _previewOverlay);
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
    const durEl = $('voice-preview-dur');
    if (!durEl) return;
    const dur = isFinite(_previewAudio.duration) ? _previewAudio.duration : _previewDuration;
    if (_previewPlaying) {
      durEl.textContent = formatTimeSec(_previewAudio.currentTime) + ' / ' + formatTimeSec(dur);
    } else {
      durEl.textContent = formatTimeSec(dur);
    }
  }

  function _resetPreviewWaveform() {
    const bars = $$('.voice-wf-bar', _previewOverlay);
    bars.forEach(b => { b.classList.remove('played', 'active'); });
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

    if (_previewOverlay) { _previewOverlay.remove(); _previewOverlay = null; }
    _showInputChildren($('input-zone'));
  }

  async function _sendPreview() {
    if (!_previewBlob || !_previewDuration) return;

    const blob = _previewBlob;
    const duration = _previewDuration;
    const waveform = _previewWaveform;

    // Clean up preview
    if (_previewAudio) {
      _previewAudio.pause();
      if (_previewAudio.src.startsWith('blob:')) URL.revokeObjectURL(_previewAudio.src);
      _previewAudio = null;
    }
    _previewPlaying = false;
    _stopPreviewAnim();
    _previewBlob = null;

    if (_previewOverlay) { _previewOverlay.remove(); _previewOverlay = null; }
    _showInputChildren($('input-zone'));

    // Send voice
    sendVoice(blob, duration, waveform);
  }

  /* ── Overlay helpers ──────────────────────────────────────── */

  function _hideInputChildren(zone) {
    if (!zone) return;
    const children = zone.querySelectorAll(':scope > .input-row, :scope > .rbar, :scope > .fmt-bar');
    children.forEach(el => el.classList.add('voice-hidden'));
  }

  function _showInputChildren(zone) {
    if (!zone) return;
    const children = zone.querySelectorAll(':scope > .input-row, :scope > .rbar, :scope > .fmt-bar');
    children.forEach(el => el.classList.remove('voice-hidden'));
  }

  function _removeAllOverlays() {
    const zone = $('input-zone');
    if (!zone) return;

    if (_recOverlay) { _recOverlay.remove(); _recOverlay = null; }
    if (_lockedOverlay) { _lockedOverlay.remove(); _lockedOverlay = null; }
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

    _showInputChildren(zone);
  }

  function _updateRecTimer() {
    if (!_recOverlay && !_isLocked) return;
    const elapsed = Math.floor((Date.now() - _recStart) / 1000);

    if (_recOverlay) {
      const timer = _recOverlay.querySelector('.voice-rec-timer');
      if (timer) timer.textContent = formatTimeSec(elapsed);
    }

    if (elapsed >= MAX_DURATION) {
      stopRecording().then(result => {
        if (result) _showPreview(result.blob, result.duration, result.waveform);
      });
    }
  }

  function _formatElapsed() {
    const elapsed = Math.floor((Date.now() - _recStart) / 1000);
    return formatTimeSec(elapsed);
  }

  /* ── Recording visualization ──────────────────────────────── */

  function _startRecVisualization() {
    if (!_analyser) return;
    const container = _recOverlay || _lockedOverlay;
    const bars = container?.querySelectorAll('.voice-rec-bar');
    if (!bars || !bars.length) return;

    const bufLen = _analyser.frequencyBinCount;
    const data = new Uint8Array(bufLen);

    function draw() {
      _recAnimFrame = requestAnimationFrame(draw);
      _analyser.getByteFrequencyData(data);

      const step = Math.floor(bufLen / bars.length);
      for (let i = 0; i < bars.length; i++) {
        const val = data[i * step] / 255;
        const h = Math.max(3, val * 28);
        bars[i].style.height = h + 'px';
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

    const dx = _pointerStartX - clientX;   // positive = swiped left
    const dy = _pointerStartY - clientY;   // positive = swiped up

    const cancelHint = _recOverlay.querySelector('#voice-swipe-cancel');
    const lockHint = _recOverlay.querySelector('#voice-lock-hint');

    // Swipe UP → lock
    if (dy > 0) {
      const lockProgress = Math.min(1, dy / LOCK_THRESHOLD);
      if (lockProgress > 0.3 && !_swipeLockActive) {
        _swipeLockActive = true;
        if (lockHint) lockHint.classList.add('show');
      }
      if (dy >= LOCK_THRESHOLD && !_isLocked) {
        _transitionToLocked();
        return;
      }
    } else {
      if (_swipeLockActive) {
        _swipeLockActive = false;
        if (lockHint) lockHint.classList.remove('show');
      }
    }

    // Swipe LEFT → cancel
    if (dx > 0) {
      const cancelProgress = Math.min(1, (dx - CANCEL_THRESHOLD) / (CANCEL_COMPLETE - CANCEL_THRESHOLD));
      if (dx > CANCEL_THRESHOLD && !_swipeCancelActive) {
        _swipeCancelActive = true;
        if (cancelHint) cancelHint.classList.add('show');
      }
      if (_swipeCancelActive) {
        const p = Math.max(0, cancelProgress);
        _recOverlay.style.transform = 'translateX(' + (-p * 80) + 'px)';
        _recOverlay.style.opacity = String(1 - p * 0.5);

        if (cancelHint) {
          cancelHint.style.opacity = String(p);
        }

        if (p >= 1) {
          cancelRecording();
        }
      }
    } else {
      if (_swipeCancelActive) {
        _swipeCancelActive = false;
        _recOverlay.style.transform = '';
        _recOverlay.style.opacity = '';
        if (cancelHint) { cancelHint.classList.remove('show'); cancelHint.style.opacity = ''; }
      }
    }
  }

  function _onPointerEnd() {
    // If we were in hold mode (not locked), stop recording → preview
    if (!_isLocked && _mediaRecorder && _mediaRecorder.state === 'recording' && !_recCancelled) {
      // Reset any transform
      if (_recOverlay) {
        _recOverlay.style.transform = '';
        _recOverlay.style.opacity = '';
      }
      const cancelHint = _recOverlay?.querySelector('#voice-swipe-cancel');
      if (cancelHint) { cancelHint.classList.remove('show'); cancelHint.style.opacity = ''; }
      const lockHint = _recOverlay?.querySelector('#voice-lock-hint');
      if (lockHint) lockHint.classList.remove('show');

      _swipeCancelActive = false;
      _swipeLockActive = false;

      stopRecording().then(result => {
        if (result) _showPreview(result.blob, result.duration, result.waveform);
      });
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
    const durEl = container.querySelector('.voice-dur');
    if (!playBtn || !wfWrap) return;

    if (!waveform || waveform.length === 0) {
      waveform = Array.from({ length: BAR_COUNT }, () => 0.25 + Math.random() * 0.75);
    }

    const barCount = waveform.length;

    // Build waveform bars
    wfWrap.innerHTML = '';
    for (let i = 0; i < barCount; i++) {
      const bar = document.createElement('div');
      bar.className = 'voice-wf-bar';
      bar.style.height = (4 + waveform[i] * 24) + 'px';
      bar.dataset.idx = String(i);
      wfWrap.appendChild(bar);
    }

    const bars = wfWrap.querySelectorAll('.voice-wf-bar');

    console.log('[VoicePlayer] init container=', container.className, 'url=', audioUrl?.substring(0, 100));
    console.log('[VoicePlayer] playBtn=', !!playBtn, 'wfWrap=', !!wfWrap, 'durEl=', !!durEl);

    const audio = new Audio();
    audio.preload = 'metadata';
    audio.src = audioUrl;
    let isPlaying = false;
    let animFrame = null;

    const PLAY_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
    const PAUSE_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>';

    function updateProgress() {
      if (!audio.duration || !isFinite(audio.duration)) return;
      const pct = audio.currentTime / audio.duration;
      const playedIdx = Math.floor(pct * barCount);
      bars.forEach((bar, i) => {
        bar.classList.toggle('played', i < playedIdx);
        bar.classList.toggle('active', i === playedIdx);
      });
      if (durEl) durEl.textContent = formatTimeSec(audio.currentTime) + ' / ' + formatTimeSec(audio.duration);
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
    });

    audio.addEventListener('error', () => {
      console.error('[VoicePlayer] audio error:', audio.error?.code, audio.error?.message, 'networkState=', audio.networkState, 'readyState=', audio.readyState);
      if (durEl) durEl.textContent = formatTimeSec(duration);
    });

    audio.addEventListener('canplaythrough', () => {
      console.log('[VoicePlayer] canplaythrough, duration=', audio.duration);
    }, { once: true });

    audio.addEventListener('loadeddata', () => {
      console.log('[VoicePlayer] loadeddata, duration=', audio.duration, 'readyState=', audio.readyState);
    }, { once: true });

    function toggle() {
      // Stop any other playing voice
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
      }
    }

    playBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log('[VoicePlayer] playBtn click, isPlaying=', isPlaying, 'audio.readyState=', audio.readyState, 'audio.error=', audio.error?.message);
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

  /* ══ AES-256-GCM ENCRYPTION ════════════════════════════════════ */

  async function encryptBlob(blob) {
    var subtle = window.crypto.subtle;
    var key = await subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt']
    );
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var plainBuf = await blob.arrayBuffer();
    var cipherBuf = await subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, plainBuf);
    var rawKey = await subtle.exportKey('raw', key);
    var keyHex = bufToHex(rawKey);
    var ivHex = bufToHex(iv);
    return { encrypted: new Uint8Array(cipherBuf), keyHex: keyHex, ivHex: ivHex };
  }

  function bufToHex(buf) {
    var arr = Array.from(buf);
    return arr.map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  /* ══ SEND VOICE ════════════════════════════════════════════════ */

  async function sendVoice(blob, duration, waveform, toSignalId, replyTo) {
    if (!S.partner) return;

    const replyId = replyTo || S.replyTo?.id || null;
    const toSid = toSignalId || S.partner.partner_signal_id;
    if (!toSid) return;

    const tid = 't' + Date.now();
    const durStr = formatTimeSec(duration);
    const tmp = {
      id: tid,
      sender_id: S.user.id,
      body: String(duration),
      sent_at: Math.floor(Date.now() / 1000),
      is_read: 0,
      is_edited: 0,
      nickname: S.user.nickname,
      avatar_url: S.user.avatar_url,
      reply_to: replyId,
      media_url: URL.createObjectURL(blob),
      media_type: 'voice',
      voice_duration: duration,
      voice_waveform: JSON.stringify(waveform),
      media_file_name: 'voice.webm',
      reactions: []
    };

    if (S.replyTo) { S.replyTo = null; hideRbar(); }

    S.msgs[S.chatId] = S.msgs[S.chatId] || [];
    S.msgs[S.chatId].push(tmp);
    S.rxns[tid] = [];
    S._pendingTids = S._pendingTids || new Map();
    S._pendingTids.set(tid, '[voice]');
    appendMsg(S.chatId, tmp);
    scrollBot();

    // Encrypt before upload
    var encryptedFile;
    var enc;
    try {
      enc = await encryptBlob(blob);
      encryptedFile = new File([enc.encrypted], 'voice.enc', { type: 'application/octet-stream' });
    } catch (e) {
      encryptedFile = blob;
      enc = { keyHex: '', ivHex: '' };
    }
    var encKeyHex = enc.keyHex;
    var encIvHex = enc.ivHex;

    var fd = new FormData();
    fd.append('voice', encryptedFile, 'voice.enc');
    fd.append('to_signal_id', toSid);
    if (replyId) fd.append('reply_to', String(replyId));
    fd.append('voice_duration', String(duration));
    fd.append('voice_waveform', JSON.stringify(waveform));
    fd.append('enc_key', encKeyHex);
    fd.append('enc_iv', encIvHex);

    let res;
    try {
      res = await api('send_voice_message', 'POST', fd, true);
    } catch (e) {
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

    // Promote temp → real id
    if (S.msgs[S.chatId]) {
      const idx = S.msgs[S.chatId].findIndex(m => m.id === tid);
      if (idx >= 0) {
        S.msgs[S.chatId][idx].id = res.message_id;
        if (res.media_url) S.msgs[S.chatId][idx].media_url = getMediaUrl(res.media_url);
        if (res.voice_duration) S.msgs[S.chatId][idx].voice_duration = res.voice_duration;
        if (res.voice_waveform) S.msgs[S.chatId][idx].voice_waveform = res.voice_waveform;
        S.msgs[S.chatId][idx].body = String(res.voice_duration || duration);
      }
    }
    S.rxns[res.message_id] = S.rxns[tid] || [];
    delete S.rxns[tid];

    const tmpEl = document.querySelector(`.mrow[data-id="${tid}"]`);
    if (tmpEl) tmpEl.dataset.id = String(res.message_id);

    S.lastId[S.chatId] = Math.max(S.lastId[S.chatId] || 0, res.message_id);

    if (!S.chatId || res.chat_id) {
      if (res.chat_id) S.chatId = res.chat_id;
      S.lastId[S.chatId] = Math.max(S.lastId[S.chatId] || 0, res.message_id);
      await loadChats();
      const nc = S.chats.find(c => c.chat_id === S.chatId);
      if (nc) {
        S.partner = nc;
        $$('.ci').forEach(e => e.classList.remove('active'));
        document.querySelector(`.ci[data-chat-id="${S.chatId}"]`)?.classList.add('active');
      }
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
    const btn = $('btn-send');
    if (!btn) return;

    function isMicMode() {
      return !btn.classList.contains('has-text');
    }

    // ── Mouse (desktop) ──
    btn.addEventListener('mousedown', (e) => {
      if (!isMicMode()) return;
      e.preventDefault();
      _pointerStartX = e.clientX;
      _pointerStartY = e.clientY;
      startRecording();
    });

    document.addEventListener('mousemove', (e) => {
      if (!_mediaRecorder || _mediaRecorder.state !== 'recording') return;
      if (_isLocked) return;
      _onPointerMove(e.clientX, e.clientY);
    });

    document.addEventListener('mouseup', () => {
      if (!_mediaRecorder || _mediaRecorder.state !== 'recording') return;
      if (_recCancelled) return;
      if (_isLocked) return; // locked mode has its own buttons
      _onPointerEnd();
    });

    // ── Touch (mobile) ──
    btn.addEventListener('touchstart', (e) => {
      if (!isMicMode()) return;
      e.preventDefault();
      _pointerStartX = e.touches[0].clientX;
      _pointerStartY = e.touches[0].clientY;
      startRecording();
    }, { passive: false });

    document.addEventListener('touchmove', (e) => {
      if (!_mediaRecorder || _mediaRecorder.state !== 'recording') return;
      if (_isLocked) return;
      _onPointerMove(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });

    document.addEventListener('touchend', () => {
      if (!_mediaRecorder || _mediaRecorder.state !== 'recording') return;
      if (_recCancelled) return;
      if (_isLocked) return;
      _onPointerEnd();
    });

    // ── Cancel button click ──
    document.addEventListener('click', (e) => {
      const cancelBtn = e.target.closest('#voice-rec-cancel');
      if (cancelBtn) {
        e.preventDefault();
        e.stopPropagation();
        cancelRecording();
      }
    });

    // ── Prevent context menu on long press ──
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

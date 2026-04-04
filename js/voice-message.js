/* ══ VOICE MESSAGE — Recording, Playback, Upload ══════════════════ */
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
  let _recAnimFrame = null;
  let _recCancelled = false;
  let _touchStartX = 0;
  let _swipeActive = false;
  let _currentAudio = null;   // currently playing Audio element
  let _currentBtn = null;     // currently playing button

  const BAR_COUNT = 44;       // number of waveform bars for playback
  const REC_BAR_COUNT = 36;   // bars for recording visualization
  const MIN_DURATION = 1;     // minimum 1 second to send
  const MAX_DURATION = 300;   // 5 minutes max

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

    // Pick best supported codec
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
    _mediaRecorder = new MediaRecorder(_stream, mimeType ? { mimeType } : {});
    _mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) _chunks.push(e.data); };

    // Setup analyser for live waveform
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = _audioCtx.createMediaStreamSource(_stream);
    _analyser = _audioCtx.createAnalyser();
    _analyser.fftSize = 128;
    source.connect(_analyser);

    // Show recording UI
    _showRecOverlay();

    _recStart = Date.now();
    _recTimer = setInterval(_updateRecTimer, 200);
    _mediaRecorder.start(200); // collect chunks every 200ms
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
      _mediaRecorder.onstop = async () => {
        // Stop all tracks
        if (_stream) _stream.getTracks().forEach(t => t.stop());
        if (_audioCtx) { try { _audioCtx.close(); } catch(e){} _audioCtx = null; }

        const duration = Math.round((Date.now() - _recStart) / 1000);
        _removeRecOverlay();

        if (_recCancelled || duration < MIN_DURATION) {
          resolve(null);
          return;
        }

        const blob = new Blob(_chunks, { type: _mediaRecorder.mimeType || 'audio/webm' });
        let waveform = [];
        try {
          waveform = await generateWaveform(blob);
        } catch (e) {
          // Fallback: random-ish waveform
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
      _mediaRecorder.onstop = () => {
        if (_stream) _stream.getTracks().forEach(t => t.stop());
        if (_audioCtx) { try { _audioCtx.close(); } catch(e){} _audioCtx = null; }
        _removeRecOverlay();
      };
      _mediaRecorder.stop();
    }
  }

  /* ── Recording UI ──────────────────────────────────────────── */

  function _showRecOverlay() {
    const zone = document.getElementById('input-zone');
    if (!zone) return;
    zone.style.position = 'relative';

    // Save original content visibility
    const children = zone.querySelectorAll(':scope > *:not(.voice-recording)');
    children.forEach(el => el.style.display = 'none');

    const overlay = document.createElement('div');
    overlay.className = 'voice-recording';
    overlay.innerHTML = `
      <div class="voice-rec-dot"></div>
      <span class="voice-rec-timer">0:00</span>
      <div class="voice-rec-waveform"></div>
      <div class="voice-rec-cancel" id="voice-rec-cancel">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        </svg>
        <span>Отменить</span>
      </div>
      <div class="voice-rec-overlay" id="voice-rec-swipe-overlay">
        <svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        </svg>
      </div>
    `;

    zone.appendChild(overlay);
    _recOverlay = overlay;

    // Build recording bars
    const wfWrap = overlay.querySelector('.voice-rec-waveform');
    for (let i = 0; i < REC_BAR_COUNT; i++) {
      const bar = document.createElement('div');
      bar.className = 'voice-rec-bar';
      bar.style.height = '4px';
      wfWrap.appendChild(bar);
    }

    // Swipe-to-cancel handlers on overlay
    overlay.addEventListener('touchmove', _onRecTouchMove, { passive: true });
    overlay.addEventListener('touchend', _onRecTouchEnd);
  }

  function _removeRecOverlay() {
    const zone = document.getElementById('input-zone');
    if (!zone) return;

    if (_recOverlay) {
      _recOverlay.removeEventListener('touchmove', _onRecTouchMove);
      _recOverlay.removeEventListener('touchend', _onRecTouchEnd);
      _recOverlay.remove();
      _recOverlay = null;
    }

    // Restore original children
    const children = zone.querySelectorAll(':scope > *:not(.voice-recording)');
    children.forEach(el => el.style.display = '');
    zone.style.position = '';
  }

  function _updateRecTimer() {
    if (!_recOverlay) return;
    const elapsed = Math.floor((Date.now() - _recStart) / 1000);
    const min = Math.floor(elapsed / 60);
    const sec = String(elapsed % 60).padStart(2, '0');
    const timer = _recOverlay.querySelector('.voice-rec-timer');
    if (timer) timer.textContent = `${min}:${sec}`;

    // Auto-stop at max duration
    if (elapsed >= MAX_DURATION) {
      stopRecording();
    }
  }

  function _startRecVisualization() {
    if (!_analyser) return;
    const bars = _recOverlay?.querySelectorAll('.voice-rec-bar');
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

  /* ── Swipe-to-cancel gesture ───────────────────────────────── */

  function _onRecTouchMove(e) {
    if (!_recOverlay) return;
    const touch = e.touches[0];
    const rect = _recOverlay.getBoundingClientRect();
    const dx = rect.right - touch.clientX;

    if (dx > 60 && !_swipeActive) {
      _swipeActive = true;
      const overlay = document.getElementById('voice-rec-swipe-overlay');
      if (overlay) overlay.classList.add('active');
    }

    if (_swipeActive) {
      const progress = Math.min(1, (dx - 60) / 80);
      _recOverlay.style.transform = `translateX(${-progress * 60}px)`;
      _recOverlay.style.opacity = String(1 - progress * 0.5);

      if (progress >= 1) {
        cancelRecording();
      }
    }
  }

  function _onRecTouchEnd() {
    if (_swipeActive && _recOverlay) {
      _recOverlay.style.transform = '';
      _recOverlay.style.opacity = '';
      const overlay = document.getElementById('voice-rec-swipe-overlay');
      if (overlay) overlay.classList.remove('active');
    }
    _swipeActive = false;
  }

  /* ══════════════════════════════════════════════════════════════
     WAVEFORM GENERATION (for playback from audio blob)
     ══════════════════════════════════════════════════════════════ */

  async function generateWaveform(blob) {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    try {
      const buf = await blob.arrayBuffer();
      const audio = await ctx.decodeAudioData(buf);
      const raw = audio.getChannelData(0);

      // Downsample to BAR_COUNT samples
      const samples = BAR_COUNT * 8; // oversample then pick peaks
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

      // Group into BAR_COUNT bars (each bar = 8 samples, take max)
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

      // Normalize
      const maxVal = Math.max(...bars, 0.01);
      return bars.map(v => v / maxVal);
    } finally {
      ctx.close();
    }
  }

  /* ══════════════════════════════════════════════════════════════
     PLAYBACK
     ══════════════════════════════════════════════════════════════ */

  function createPlayer(container, audioUrl, duration, waveform) {
    if (!container || !audioUrl) return;

    const playBtn = container.querySelector('.voice-play-btn');
    const wfWrap = container.querySelector('.voice-waveform');
    const durEl = container.querySelector('.voice-dur');
    if (!playBtn || !wfWrap) return;

    // If no waveform data, generate random
    if (!waveform || waveform.length === 0) {
      waveform = Array.from({ length: BAR_COUNT }, () => 0.25 + Math.random() * 0.75);
    }

    const barCount = waveform.length;

    // Build waveform bars
    wfWrap.innerHTML = '';
    for (let i = 0; i < barCount; i++) {
      const bar = document.createElement('div');
      bar.className = 'voice-bar';
      bar.style.height = (30 + waveform[i] * 70) + '%';
      bar.dataset.idx = String(i);
      wfWrap.appendChild(bar);
    }

    const bars = wfWrap.querySelectorAll('.voice-bar');

    // Audio instance
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.src = audioUrl;
    let isPlaying = false;
    let animFrame = null;

    const PLAY_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
    const PAUSE_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>';

    function formatTime(s) {
      s = Math.max(0, Math.floor(s));
      return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    }

    function updateProgress() {
      if (!audio.duration || !isFinite(audio.duration)) return;
      const pct = audio.currentTime / audio.duration;
      const playedIdx = Math.floor(pct * barCount);
      bars.forEach((bar, i) => {
        bar.classList.toggle('played', i < playedIdx);
        bar.classList.toggle('active', i === playedIdx);
      });
      durEl.textContent = formatTime(audio.currentTime) + ' / ' + formatTime(audio.duration);
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

    // Load metadata for duration
    audio.addEventListener('loadedmetadata', () => {
      if (isFinite(audio.duration) && audio.duration > 0) {
        durEl.textContent = formatTime(audio.duration);
      }
    }, { once: true });

    audio.addEventListener('ended', () => {
      isPlaying = false;
      playBtn.innerHTML = PLAY_SVG;
      playBtn.classList.remove('playing');
      stopAnim();
      bars.forEach(b => { b.classList.remove('played', 'active'); });
      durEl.textContent = formatTime(audio.duration || duration);
      _currentAudio = null;
      _currentBtn = null;
    });

    audio.addEventListener('error', () => {
      durEl.textContent = formatTime(duration);
    });

    // Play/pause
    function toggle() {
      // Stop any other playing voice
      if (_currentAudio && _currentAudio !== audio && !_currentAudio.paused) {
        _currentAudio.pause();
        _currentAudio.currentTime = 0;
        if (_currentBtn) {
          _currentBtn.innerHTML = PLAY_SVG;
          _currentBtn.classList.remove('playing');
          // Reset bars in other player
          const otherWrap = _currentBtn.closest('.voice-msg');
          if (otherWrap) {
            otherWrap.querySelectorAll('.voice-bar').forEach(b => b.classList.remove('played', 'active'));
            const otherDur = otherWrap.querySelector('.voice-dur');
            if (otherDur) {
              const otherAudio = otherWrap._voiceAudio;
              if (otherAudio && isFinite(otherAudio.duration)) {
                otherDur.textContent = formatTime(otherAudio.duration);
              }
            }
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
      } else {
        audio.play().catch(() => {});
        isPlaying = true;
        playBtn.innerHTML = PAUSE_SVG;
        playBtn.classList.add('playing');
        startAnim();
        _currentAudio = audio;
        _currentBtn = playBtn;
        container._voiceAudio = audio;
      }
    }

    playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggle();
    });

    // Click on waveform to seek
    wfWrap.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!audio.duration || !isFinite(audio.duration)) {
        // Start playing first if not loaded
        if (!isPlaying) toggle();
        return;
      }
      const rect = wfWrap.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      audio.currentTime = pct * audio.duration;
      updateProgress();
      if (!isPlaying) toggle();
    });

    // Set initial duration
    if (duration > 0) {
      durEl.textContent = formatTime(duration);
    }
  }

  /* ══ AES-256-GCM ENCRYPTION ════════════════════════════════════ */

  /**
   * Encrypt a Blob using AES-256-GCM via Web Crypto API.
   * Returns { encrypted: Uint8Array, keyHex: string, ivHex: string }
   * The key & IV travel as separate POST params — the raw file blob is
   * useless without them even if intercepted from S3 / CDN / proxy.
   */
  async function encryptBlob(blob) {
    var subtle = window.crypto.subtle;
    // 256-bit random key
    var key = await subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true, // extractable so we can export
      ['encrypt']
    );
    // 96-bit random IV (required by AES-GCM)
    var iv = crypto.getRandomValues(new Uint8Array(12));
    // Encrypt
    var plainBuf = await blob.arrayBuffer();
    var cipherBuf = await subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, plainBuf);
    // Export key to hex for server
    var rawKey = await subtle.exportKey('raw', key);
    var keyHex = bufToHex(rawKey);
    var ivHex = bufToHex(iv);
    return { encrypted: new Uint8Array(cipherBuf), keyHex: keyHex, ivHex: ivHex };
  }

  /** Uint8Array → lowercase hex string */
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

    // Show temp message
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

    // Encrypt the audio blob before upload (AES-256-GCM)
    var encryptedFile;
    try {
      var enc = await encryptBlob(blob);
      encryptedFile = new File([enc.encrypted], 'voice.enc', { type: 'application/octet-stream' });
    } catch (e) {
      // Fallback: upload without encryption if Web Crypto unavailable
      encryptedFile = blob;
      enc = { keyHex: '', ivHex: '' };
    }
    var encKeyHex = enc.keyHex;
    var encIvHex = enc.ivHex;

    // Upload (encrypted)
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
      if (idx >=0) {
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

    // If this was a new chat (no chatId), handle like sendText
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

    // Re-render the promoted message properly
    const sentMsg = S.msgs[S.chatId]?.find(m => m.id === res.message_id);
    if (sentMsg) patchMsgDom(sentMsg);
  }

  function formatTimeSec(s) {
    s = Math.max(0, Math.floor(s));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  /* ══════════════════════════════════════════════════════════════
     UI BINDING — Mic button ↔ hold-to-record
     ══════════════════════════════════════════════════════════════ */

  function init() {
    const btn = document.getElementById('btn-send');
    if (!btn) return;

    // Only bind recording on the mic button (when no text)
    function isMicMode() {
      return !btn.classList.contains('has-text');
    }

    // ── Mouse (desktop) ──
    btn.addEventListener('mousedown', (e) => {
      if (!isMicMode()) return;
      e.preventDefault();
      startRecording();
    });

    document.addEventListener('mouseup', async (e) => {
      if (!_mediaRecorder || _mediaRecorder.state !== 'recording') return;
      // If swipe-cancel happened, ignore
      if (_recCancelled) return;
      const result = await stopRecording();
      if (result) {
        sendVoice(result.blob, result.duration, result.waveform);
      }
    });

    // ── Touch (mobile) ──
    btn.addEventListener('touchstart', (e) => {
      if (!isMicMode()) return;
      e.preventDefault();
      _touchStartX = e.touches[0].clientX;
      startRecording();
    }, { passive: false });

    document.addEventListener('touchend', async (e) => {
      if (!_mediaRecorder || _mediaRecorder.state !== 'recording') return;
      if (_recCancelled) return;
      const result = await stopRecording();
      if (result) {
        sendVoice(result.blob, result.duration, result.waveform);
      }
    });

    // ── Cancel button in overlay ──
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

  // Init on DOMContentLoaded (scripts load in order, but be safe)
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

/* ═══════════════════════════════════════════════════════════════
   TDesktop Theme Parser & Manager  (v2 – complete rewrite)
   Reads .tdesktop-theme files (plain text or ZIP) and maps
   colors to CSS custom properties with full variable resolution.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ──────────────────────────────────────────────────────────────
     Built-in colors that Telegram recognises without declaration
     ────────────────────────────────────────────────────────────── */
  var BUILTINS = {
    COLOR_WHITE: '#ffffff',
    COLOR_BLACK: '#000000'
  };

  /* ──────────────────────────────────────────────────────────────
     Comprehensive mapping: tdesktop key → app CSS custom property
     ────────────────────────────────────────────────────────────── */
  var COLOR_MAP = {
    // Window / backgrounds
    'windowBg':               '--bg',
    'windowBgActive':         '--bg2',
    'windowBgOver':           '--bg2',
    'windowBgRipple':         '--s2',
    'windowFg':               '--t1',
    'windowFgOver':           '--t1',
    'windowFgActive':         '--t1',
    'windowSubTextFg':        '--t2',
    'windowSubTextFgOver':    '--t2',
    'windowBoldFg':           '--t1',
    'windowBoldFgOver':       '--t2',
    'windowActiveTextFg':     '--y',
    'windowShadowFg':         '--b',
    'windowShadowFgFallback': '--b',

    // Chat
    'chatBg':                  '--chat-bg',
    'chatBubbleBackground':    '--msg-bg',
    'chatBubbleBackgroundOut': '--msg-me-bg',
    'chatBubbleText':          '--t1',
    'chatBubbleTextOut':       '--t1',
    'chatReplyHeaderBgColor':  '--solid2',
    'chatDateColor':           '--t2',

    // Messages
    'msgInBg':            '--msg-bg',
    'msgOutBg':           '--msg-me-bg',
    'msgInDateFg':        '--t3',
    'msgOutDateFg':       '--t3',
    'msgInServiceFg':     '--y',
    'msgOutServiceFg':    '--y',
    'msgFileBg':          '--solid2',
    'msgFile1Bg':         '--solid2',
    'msgFile2Bg':         '--solid2',
    'msgFile3Bg':         '--solid2',
    'msgFile4Bg':         '--solid2',

    // Voice waveform
    'msgWaveformInActive':    '--y',
    'msgWaveformInInactive':  '--t3',
    'msgWaveformOutActive':   '--y',
    'msgWaveformOutInactive': '--t2',

    // Accent
    'accentColor':           '--y',
    'accentColorHover':      '--y2',
    'activeButtonBg':        '--y',
    'activeButtonBgOver':    '--y2',
    'activeButtonBgRipple':  '--yb',
    'activeButtonFg':        '--t1',
    'historyComposeAreaBg':  '--msg-bg',
    'historySendIconFg':     '--y',
    'historySendIconFgOver': '--y',

    // Borders
    'shadowFg':          '--b',
    'inputBorderFg':     '--b2',
    'filterInputBorderFg': '--yb',

    // Menu / sidebar
    'menuBg':        '--bg',
    'menuFg':        '--t1',
    'menuIconFg':    '--t3',
    'menuIconFgOver':'--y',

    // Title bar
    'titleBg':       '--bg',
    'titleFg':       '--t1',
    'titleFgActive': '--t1',

    // Buttons
    'lightButtonBg':  '--solid2',
    'lightButtonFg':  '--t1',
    'attentionButtonFg': '--red, #d84343',

    // Tooltip
    'tooltipBg': '--solid2',
    'tooltipFg': '--t2'
  };

  /* ══════════════════════════════════════════════════════════════
     Utility helpers
     ══════════════════════════════════════════════════════════════ */

  /** Normalise a hex colour to 7-char form (#rrggbb). */
  function normaliseHex(val) {
    if (!val || typeof val !== 'string') return null;
    val = val.trim();
    if (val[0] === '#') val = val.substring(1);
    // Expand shorthand (#abc → #aabbcc)
    if (val.length === 3) {
      val = val[0] + val[0] + val[1] + val[1] + val[2] + val[2];
    }
    if (val.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(val)) return null;
    return '#' + val.toLowerCase();
  }

  /** Hex (#rrggbb) → { r, g, b, str } or null. */
  function hexToRgb(hex) {
    var n = normaliseHex(hex);
    if (!n) return null;
    var r = parseInt(n.substring(1, 3), 16);
    var g = parseInt(n.substring(3, 5), 16);
    var b = parseInt(n.substring(5, 7), 16);
    return { r: r, g: g, b: b, str: r + ', ' + g + ', ' + b };
  }

  /** Perceived luminance (0 – 1). */
  function luminance(rgb) {
    var r = rgb.r / 255, g = rgb.g / 255, b = rgb.b / 255;
    return 0.299 * r + 0.587 * g + 0.114 * b;
  }

  /** Clamp integer to 0-255. */
  function clamp8(v) { return v < 0 ? 0 : v > 255 ? 255 : Math.round(v); }

  /** Lighten / darken a hex by a signed amount (-255 … 255). */
  function adjustHex(hex, amount) {
    var rgb = hexToRgb(hex);
    if (!rgb) return hex;
    var r = clamp8(rgb.r + amount);
    var g = clamp8(rgb.g + amount);
    var b = clamp8(rgb.b + amount);
    return '#' +
      (r < 16 ? '0' : '') + r.toString(16) +
      (g < 16 ? '0' : '') + g.toString(16) +
      (b < 16 ? '0' : '') + b.toString(16);
  }

  /** Lighten a hex toward white by factor 0-1. */
  function lightenHex(hex, factor) {
    var rgb = hexToRgb(hex);
    if (!rgb) return hex;
    var r = clamp8(rgb.r + (255 - rgb.r) * factor);
    var g = clamp8(rgb.g + (255 - rgb.g) * factor);
    var b = clamp8(rgb.b + (255 - rgb.b) * factor);
    return '#' +
      (r < 16 ? '0' : '') + r.toString(16) +
      (g < 16 ? '0' : '') + g.toString(16) +
      (b < 16 ? '0' : '') + b.toString(16);
  }

  /** Darken a hex toward black by factor 0-1. */
  function darkenHex(hex, factor) {
    var rgb = hexToRgb(hex);
    if (!rgb) return hex;
    var r = clamp8(rgb.r * (1 - factor));
    var g = clamp8(rgb.g * (1 - factor));
    var b = clamp8(rgb.b * (1 - factor));
    return '#' +
      (r < 16 ? '0' : '') + r.toString(16) +
      (g < 16 ? '0' : '') + g.toString(16) +
      (b < 16 ? '0' : '') + b.toString(16);
  }

  /* ══════════════════════════════════════════════════════════════
     Theme text parser
     ══════════════════════════════════════════════════════════════ */

  /**
   * Parse the raw text of a .tdesktop-theme colors file.
   *
   * Two-pass algorithm:
   *   Pass 1 – collect every  KEY: VALUE;  definition (raw strings).
   *   Pass 2 – resolve variable references recursively to hex values.
   *
   * Returns an object { key: "#rrggbb", … }.
   */
  function parseColorsFile(text) {
    /* ── Pass 0: strip comments & empty lines ── */
    var lines = text.split(/\r?\n/);
    var cleaned = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      // Remove everything after // (but not inside a potential string)
      var commentIdx = line.indexOf('//');
      if (commentIdx !== -1) {
        line = line.substring(0, commentIdx);
      }
      line = line.trim();
      if (line.length > 0) cleaned.push(line);
    }

    /* ── Pass 1: collect raw KEY: VALUE pairs ── */
    // The regex handles both:
    //   Non-quoted keys:   windowBg: #392F3C;   or   windowBg: COLOR_DARK;
    //   Quoted keys:       "Background": "#392F3C";   (legacy format)
    var pairRe = /(?:"([^"]+)"|([a-zA-Z_]\w*))\s*:\s*([^;]+)/;
    var rawDefs = {};  // key (uppercase-normalised) → raw value string

    for (var j = 0; j < cleaned.length; j++) {
      var m = cleaned[j].match(pairRe);
      if (m) {
        var key = (m[1] || m[2]).trim();
        var val = m[3].trim().replace(/;+$/, '').trim(); // strip trailing semicolons
        // Skip values that are clearly not colors (e.g., "WALLPAPER" directives)
        if (/^(none|null|undefined)$/i.test(val)) continue;
        // Store with case-sensitive key for variable lookup, but also normalise
        rawDefs[key] = val;
      }
    }

    /* ── Helper: resolve a value to a hex string ── */
    var MAX_DEPTH = 20;

    function resolveValue(val, depth) {
      if (depth > MAX_DEPTH) return null; // circular-ref guard

      // 1. Already a hex colour?
      var hex = normaliseHex(val);
      if (hex) return hex;

      // 2. Built-in?
      var upperVal = val.toUpperCase();
      if (BUILTINS[upperVal]) return BUILTINS[upperVal];

      // 3. Variable reference (try exact, then case-insensitive)
      var ref = null;
      if (rawDefs[val]) ref = val;
      else if (rawDefs[upperVal]) ref = upperVal;
      else {
        // Case-insensitive fallback scan
        for (var k in rawDefs) {
          if (rawDefs.hasOwnProperty(k) && k.toUpperCase() === upperVal) {
            ref = k;
            break;
          }
        }
      }
      if (ref) {
        return resolveValue(rawDefs[ref], depth + 1);
      }

      return null;
    }

    /* ── Pass 2: resolve every key to a final hex colour ── */
    var resolved = {};
    for (var key in rawDefs) {
      if (!rawDefs.hasOwnProperty(key)) continue;
      var hexVal = resolveValue(rawDefs[key], 0);
      if (hexVal) {
        resolved[key] = hexVal;
      }
    }

    return resolved;
  }

  /* ══════════════════════════════════════════════════════════════
     Map resolved tdesktop colours → CSS custom properties
     ══════════════════════════════════════════════════════════════ */

  function mapColors(resolved) {
    var vars = {};

    // Direct mapping from COLOR_MAP
    for (var tdKey in COLOR_MAP) {
      if (!COLOR_MAP.hasOwnProperty(tdKey)) continue;

      // Try exact match first, then case-insensitive
      var val = resolved[tdKey];
      if (!val) {
        // Case-insensitive lookup
        var upperTdKey = tdKey.toUpperCase();
        for (var k in resolved) {
          if (resolved.hasOwnProperty(k) && k.toUpperCase() === upperTdKey) {
            val = resolved[k];
            break;
          }
        }
      }
      if (val) {
        vars[COLOR_MAP[tdKey]] = val;
      }
    }

    return vars;
  }

  /* ══════════════════════════════════════════════════════════════
     Auto-generate derived CSS vars from the resolved palette
     ══════════════════════════════════════════════════════════════ */

  function deriveVars(vars) {
    var bg = vars['--bg'] || vars['--chat-bg'];
    var chatBg = vars['--chat-bg'] || vars['--bg'];
    var accent = vars['--y'];

    if (!bg) return vars;

    var bgRgb = hexToRgb(bg);
    var chatRgb = hexToRgb(chatBg);
    var isDark = bgRgb ? luminance(bgRgb) < 0.5 : true;

    // ── RGB strings (for rgba usage) ──
    if (bgRgb) {
      vars['--bg-rgb'] = bgRgb.str;
    }
    if (chatRgb && chatBg !== bg) {
      vars['--chat-bg-rgb'] = chatRgb.str;
    }

    // ── Shadow / separation layers (--s0 … --s3) ──
    // Already set by the theme? Skip.
    if (!vars['--s0']) {
      if (isDark) {
        // Light-on-dark: shadows are brighter
        vars['--s0'] = 'rgba(255,255,255,.03)';
        vars['--s1'] = 'rgba(255,255,255,.05)';
        vars['--s2'] = 'rgba(255,255,255,.08)';
        vars['--s3'] = 'rgba(255,255,255,.14)';
      } else {
        // Dark-on-light: shadows are darker
        vars['--s0'] = 'rgba(0,0,0,.03)';
        vars['--s1'] = 'rgba(0,0,0,.05)';
        vars['--s2'] = 'rgba(0,0,0,.08)';
        vars['--s3'] = 'rgba(0,0,0,.14)';
      }
    }

    // ── Border layers (--b, --b2, --b3) ──
    if (!vars['--b']) {
      if (isDark) {
        vars['--b']  = 'rgba(255,255,255,.05)';
        vars['--b2'] = 'rgba(255,255,255,.09)';
        vars['--b3'] = 'rgba(255,255,255,.15)';
      } else {
        vars['--b']  = 'rgba(0,0,0,.08)';
        vars['--b2'] = 'rgba(0,0,0,.12)';
        vars['--b3'] = 'rgba(0,0,0,.18)';
      }
    }

    // ── Solid surface colours (--solid1 … --solid3) ──
    // These are opaque hex colours derived from the bg
    if (!vars['--solid1']) {
      if (isDark) {
        vars['--solid1'] = darkenHex(bg, 0.18);
        vars['--solid2'] = lightenHex(bg, 0.08);
        vars['--solid3'] = lightenHex(bg, 0.16);
      } else {
        vars['--solid1'] = darkenHex(bg, 0.03);
        vars['--solid2'] = darkenHex(bg, 0.06);
        vars['--solid3'] = darkenHex(bg, 0.10);
      }
    }

    // ── Accent-derived vars ──
    if (accent && normaliseHex(accent)) {
      var accentHex = normaliseHex(accent);
      var accentRgb = hexToRgb(accentHex);

      if (!vars['--y2']) {
        vars['--y2'] = lightenHex(accentHex, 0.2);
      }

      if (!vars['--ybg'] && accentRgb) {
        if (isDark) {
          vars['--ybg'] = 'rgba(' + accentRgb.str + ',.13)';
        } else {
          vars['--ybg'] = 'rgba(' + accentRgb.str + ',.10)';
        }
      }

      if (!vars['--yb'] && accentRgb) {
        vars['--yb'] = 'rgba(' + accentRgb.str + ',.36)';
      }
    }

    // ── --msg-bg (incoming bubble) if not set ──
    if (!vars['--msg-bg']) {
      if (isDark) {
        vars['--msg-bg'] = lightenHex(bg, 0.12);
      } else {
        vars['--msg-bg'] = lightenHex(bg, 0.08);
      }
    }

    // ── --msg-me-bg (outgoing bubble) if not set ──
    if (!vars['--msg-me-bg']) {
      if (accent && normaliseHex(accent)) {
        // Use accent with reduced opacity for outgoing
        vars['--msg-me-bg'] = accent;
      } else if (isDark) {
        vars['--msg-me-bg'] = darkenHex(bg, 0.05);
      } else {
        vars['--msg-me-bg'] = darkenHex(bg, 0.12);
      }
    }

    // ── --bg2 if not already set (slightly elevated surface) ──
    if (!vars['--bg2']) {
      vars['--bg2'] = isDark ? lightenHex(bg, 0.06) : darkenHex(bg, 0.04);
    }

    return vars;
  }

  /* ══════════════════════════════════════════════════════════════
     Apply theme vars to the document
     ══════════════════════════════════════════════════════════════ */

  function applyTdesktopTheme(vars) {
    if (!vars || typeof vars !== 'object') return vars;

    // Derive missing vars before applying
    vars = deriveVars(vars);

    var root = document.documentElement;

    for (var prop in vars) {
      if (!vars.hasOwnProperty(prop)) continue;
      root.style.setProperty(prop, vars[prop]);
    }

    // Update theme-color meta tag
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta && vars['--bg']) {
      meta.content = vars['--bg'];
    }

    return vars;
  }

  /* ══════════════════════════════════════════════════════════════
     Reset theme overrides
     ══════════════════════════════════════════════════════════════ */

  function resetTdesktopTheme() {
    try {
      localStorage.removeItem('sg_active_custom_theme');
    } catch (e) { /* noop */ }

    // Re-apply base theme
    if (typeof applyTheme === 'function') {
      var saved = 'dark';
      try { saved = localStorage.getItem('sg_theme') || 'dark'; } catch (e) { /* noop */ }
      applyTheme(saved);
    }

    // Clear UI active state
    var cards = document.querySelectorAll('.tdtheme-card');
    for (var i = 0; i < cards.length; i++) {
      cards[i].classList.remove('active');
    }

    renderTdesktopThemeList();
  }

  /* ══════════════════════════════════════════════════════════════
     localStorage cache management
     ══════════════════════════════════════════════════════════════ */

  var CACHE_KEY  = 'sg_tdesktop_themes';
  var ACTIVE_KEY = 'sg_active_custom_theme';
  var MAX_THEMES = 10;

  function getCachedThemes() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }

  function saveCachedThemes(list) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(list)); } catch (e) { /* noop */ }
  }

  function getActiveCustomTheme() {
    try { return localStorage.getItem(ACTIVE_KEY); } catch (e) { return null; }
  }

  function setActiveCustomTheme(name) {
    try { localStorage.setItem(ACTIVE_KEY, name); } catch (e) { /* noop */ }
  }

  /** Add / replace a theme in cache with LRU eviction. */
  function cacheTheme(name, vars, bgDataUrl) {
    var list = getCachedThemes();

    // Remove any existing entry with same name
    var filtered = [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].name !== name) filtered.push(list[i]);
    }
    list = filtered;

    // Prepend new entry
    list.unshift({
      name:      name,
      vars:      vars,
      bgDataUrl: bgDataUrl || null,
      timestamp: Date.now()
    });

    // LRU eviction
    if (list.length > MAX_THEMES) {
      list = list.slice(0, MAX_THEMES);
    }

    saveCachedThemes(list);
  }

  /** Remove a theme from cache and reset if it was active. */
  function deleteCachedTheme(name) {
    var list = getCachedThemes();
    var filtered = [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].name !== name) filtered.push(list[i]);
    }
    saveCachedThemes(filtered);

    if (getActiveCustomTheme() === name) {
      resetTdesktopTheme();
    } else {
      renderTdesktopThemeList();
    }
  }

  /* ══════════════════════════════════════════════════════════════
     Parse .tdesktop-theme file (ZIP or plain text)
     ══════════════════════════════════════════════════════════════ */

  /**
   * Accepts a File object.
   * Returns Promise → { name, vars, bgDataUrl }
   */
  function parseTdesktopTheme(file) {
    return new Promise(function (resolve, reject) {
      // First try reading as plain text (most .tdesktop-theme files are just text)
      var textReader = new FileReader();
      textReader.onerror = function () { reject(new Error('Failed to read file')); };

      textReader.onload = function (e) {
        var text = e.target.result;
        var resolved = parseColorsFile(text);

        // If we got a meaningful number of color definitions, treat as plain text
        if (Object.keys(resolved).length >= 2) {
          var vars = mapColors(resolved);
          resolve({ name: null, vars: vars, bgDataUrl: null });
          return;
        }

        // Plain text didn't yield colours → try ZIP
        if (typeof JSZip === 'undefined') {
          reject(new Error('Could not parse theme file (not a valid colors file and JSZip not loaded)'));
          return;
        }

        // Re-read as ArrayBuffer for JSZip
        var bufReader = new FileReader();
        bufReader.onerror = function () { reject(new Error('Failed to read file as binary')); };

        bufReader.onload = function (e2) {
          JSZip.loadAsync(e2.target.result).then(function (zip) {
            var colorsFile = zip.file('colors.tdesktop-theme');
            if (!colorsFile) {
              reject(new Error('colors.tdesktop-theme not found in ZIP'));
              return;
            }

            colorsFile.async('string').then(function (zipText) {
              var zipResolved = parseColorsFile(zipText);
              if (Object.keys(zipResolved).length === 0) {
                reject(new Error('No valid colours found in theme file'));
                return;
              }

              var zipVars = mapColors(zipResolved);

              // Extract background image if present
              var bgFile = zip.file('background.jpg') || zip.file('background.png');
              var bgPromise;
              if (bgFile) {
                bgPromise = bgFile.async('base64').then(function (b64) {
                  var ext = bgFile.name.endsWith('.png') ? 'png' : 'jpeg';
                  return 'data:image/' + ext + ';base64,' + b64;
                }).catch(function () { return null; });
              } else {
                bgPromise = Promise.resolve(null);
              }

              bgPromise.then(function (bgDataUrl) {
                resolve({ name: null, vars: zipVars, bgDataUrl: bgDataUrl });
              });
            }).catch(reject);
          }).catch(function () {
            reject(new Error('Could not parse theme file — not a valid .tdesktop-theme'));
          });
        };

        bufReader.readAsArrayBuffer(file);
      };

      textReader.readAsText(file);
    });
  }

  /* ══════════════════════════════════════════════════════════════
     UI helpers
     ══════════════════════════════════════════════════════════════ */

  /** Build a 4-swatch preview from theme vars. */
  function buildSwatchHtml(vars) {
    var colors = [
      vars['--bg']       || '#222',
      vars['--msg-bg']   || '#333',
      vars['--msg-me-bg'] || '#555',
      vars['--y']        || '#8b5cf6'
    ];
    var html = '<div class="tdtheme-no-img">';
    for (var i = 0; i < colors.length; i++) {
      html += '<div class="tdtheme-swatch" style="background:' + colors[i] + '"></div>';
    }
    html += '</div>';
    return html;
  }

  /** Render the cached theme list into #tdtheme-grid. */
  function renderTdesktopThemeList() {
    var grid = document.getElementById('tdtheme-grid');
    if (!grid) return;

    var list = getCachedThemes();
    var activeName = getActiveCustomTheme();

    if (list.length === 0) {
      grid.innerHTML = '<div style="font-size:13px;color:var(--t3);padding:8px 0">Нет сохранённых тем</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      var isActive = (t.name === activeName);
      var inner = t.bgDataUrl
        ? '<img src="' + t.bgDataUrl + '" alt="" loading="lazy">'
        : buildSwatchHtml(t.vars || {});

      html += '<div class="tdtheme-card' + (isActive ? ' active' : '') +
              '" data-tdtheme="' + t.name + '" title="' + t.name + '">';
      html += inner;
      html += '<button class="tdtheme-del" data-tddel="' + t.name + '">&times;</button>';
      html += '</div>';
    }

    grid.innerHTML = html;

    // Bind click: apply theme
    var cards = grid.querySelectorAll('.tdtheme-card');
    for (var c = 0; c < cards.length; c++) {
      (function (card) {
        card.onclick = function (e) {
          if (e.target.closest('.tdtheme-del')) return;
          var n = card.getAttribute('data-tdtheme');
          loadCachedTheme(n);
        };
      })(cards[c]);
    }

    // Bind click: delete theme
    var delBtns = grid.querySelectorAll('.tdtheme-del');
    for (var d = 0; d < delBtns.length; d++) {
      (function (btn) {
        btn.onclick = function (e) {
          e.stopPropagation();
          var n = btn.getAttribute('data-tddel');
          if (confirm('Удалить тему «' + n + '»?')) {
            deleteCachedTheme(n);
          }
        };
      })(delBtns[d]);
    }
  }

  /** Load a cached theme by name and apply it. */
  function loadCachedTheme(name) {
    var list = getCachedThemes();
    var theme = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].name === name) { theme = list[i]; break; }
    }
    if (!theme) return;

    applyTdesktopTheme(theme.vars);
    setActiveCustomTheme(name);

    // Toggle active class
    var cards = document.querySelectorAll('.tdtheme-card');
    for (var c = 0; c < cards.length; c++) {
      cards[c].classList.toggle('active', cards[c].getAttribute('data-tdtheme') === name);
    }

    // Update meta theme-color
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta && theme.vars['--bg']) meta.content = theme.vars['--bg'];
  }

  /** On page load, re-apply the active custom theme (if any). */
  function applyActiveCustomTheme() {
    var activeName = getActiveCustomTheme();
    if (!activeName) return;
    loadCachedTheme(activeName);
  }

  /* ══════════════════════════════════════════════════════════════
     File input handler
     ══════════════════════════════════════════════════════════════ */

  function handleFileInput(file) {
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.tdesktop-theme')) {
      alert('Пожалуйста, выберите файл .tdesktop-theme');
      return;
    }

    var themeName = file.name.replace(/\.tdesktop-theme$/i, '');

    parseTdesktopTheme(file).then(function (result) {
      result.name = themeName;

      // Apply immediately
      applyTdesktopTheme(result.vars);
      setActiveCustomTheme(themeName);

      // Cache for persistence
      cacheTheme(themeName, result.vars, result.bgDataUrl);

      // Re-render list
      renderTdesktopThemeList();

      // Meta theme-color
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta && result.vars['--bg']) meta.content = result.vars['--bg'];

    }).catch(function (err) {
      console.error('[TDesktopTheme] Error:', err);
      alert('Ошибка чтения темы: ' + err.message);
    });
  }

  /* ══════════════════════════════════════════════════════════════
     Init: bind DOM elements
     ══════════════════════════════════════════════════════════════ */

  function init() {
    var fileInput = document.getElementById('tdtheme-file-input');
    if (fileInput) {
      fileInput.addEventListener('change', function () {
        if (fileInput.files && fileInput.files[0]) {
          handleFileInput(fileInput.files[0]);
          fileInput.value = '';
        }
      });
    }

    var btnUpload = document.getElementById('tdtheme-btn-upload');
    if (btnUpload && fileInput) {
      btnUpload.addEventListener('click', function () { fileInput.click(); });
    }

    var btnReset = document.getElementById('tdtheme-btn-reset');
    if (btnReset) {
      btnReset.addEventListener('click', function () { resetTdesktopTheme(); });
    }

    renderTdesktopThemeList();
    applyActiveCustomTheme();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* ══════════════════════════════════════════════════════════════
     Public API
     ══════════════════════════════════════════════════════════════ */

  window.TDesktopTheme = {
    /** Parse a File → Promise<{ name, vars, bgDataUrl }> */
    parse:   parseTdesktopTheme,

    /** Apply a { '--bg': '#…', … } vars object to the document */
    apply:   applyTdesktopTheme,

    /** Remove active custom theme & restore base */
    reset:   resetTdesktopTheme,

    /** Get cached theme list from localStorage */
    getCached: getCachedThemes,

    /** Load & apply a cached theme by name */
    load:    loadCachedTheme
  };
})();

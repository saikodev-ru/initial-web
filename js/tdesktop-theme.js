/* ═══════════════════════════════════════════════════════════════
   TDesktop Theme Parser & Manager
   Reads .tdesktop-theme files (ZIP) and maps colors to CSS vars
   ═══════════════════════════════════════════════════════════════ */
(function() {
  'use strict';

  /* ── Color key mapping: tdesktop → app CSS custom properties ── */
  const COLOR_MAP = {
    'Background':              '--bg',
    'ChatBackground':          '--chat-bg',
    'ChatBubbleBackground':    '--msg-bg',
    'ChatBubbleBackgroundOut': '--msg-me-bg',
    'ChatBubbleText':          '--t1',
    'ChatBubbleTextOut':       '--t1',
    'ChatDateColor':           '--t2',
    'MenuIconColor':           '--t3',
    'MenuItemColor':           '--t1',
    'AccentColor':             '--y',
    'AccentColorHover':        '--y2',
    'LinkColor':               '--y3',
    'ActiveSendButtonColor':   '--y',
    'ChatReplyHeaderBgColor':  '--solid2',
    'TitleColor':              '--t1',
    'HintTextColor':           '--t3'
  };

  /* ── Hex → RGB extraction ── */
  function hexToRgb(hex) {
    if (!hex || typeof hex !== 'string') return null;
    hex = hex.trim().replace(/^#/, '');
    if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
    if (hex.length !== 6) return null;
    var r = parseInt(hex.substring(0, 2), 16);
    var g = parseInt(hex.substring(2, 4), 16);
    var b = parseInt(hex.substring(4, 6), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
    return { r: r, g: g, b: b, str: r + ', ' + g + ', ' + b };
  }

  /* ── Parse colors.tdesktop-theme text content ── */
  function parseColorsFile(text) {
    var raw = {};
    var lines = text.split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      // Format: "Key": "#value"  or  "Key": value
      var m = line.match(/"([^"]+)"\s*:\s*"?([^"]+)"?/);
      if (m && m[2]) {
        var key = m[1].trim();
        var val = m[2].trim();
        // Ensure it's a valid hex color
        if (/^#?[0-9a-fA-F]{3,6}$/.test(val)) {
          if (val[0] !== '#') val = '#' + val;
          raw[key] = val;
        }
      }
    }
    return raw;
  }

  /* ── Map raw tdesktop colors → CSS vars ── */
  function mapColors(raw) {
    var vars = {};
    for (var tdKey in COLOR_MAP) {
      if (!COLOR_MAP.hasOwnProperty(tdKey)) continue;
      if (raw[tdKey] !== undefined) {
        vars[COLOR_MAP[tdKey]] = raw[tdKey];
      }
    }
    return vars;
  }

  /* ── Apply theme vars to document ── */
  function applyTdesktopTheme(vars) {
    var r = document.documentElement;

    // Apply --bg-rgb from --bg if available
    if (vars['--bg']) {
      var bgRgb = hexToRgb(vars['--bg']);
      if (bgRgb) {
        vars['--bg-rgb'] = bgRgb.str;
        r.style.setProperty('--bg-rgb', bgRgb.str);
      }
    }

    // Apply --chat-bg-rgb from --chat-bg if available
    if (vars['--chat-bg']) {
      var chatRgb = hexToRgb(vars['--chat-bg']);
      if (chatRgb) {
        vars['--chat-bg-rgb'] = chatRgb.str;
        r.style.setProperty('--chat-bg-rgb', chatRgb.str);
      }
    }

    // Apply all mapped vars
    for (var prop in vars) {
      if (!vars.hasOwnProperty(prop)) continue;
      if (prop === '--bg-rgb' || prop === '--chat-bg-rgb') continue; // already set
      r.style.setProperty(prop, vars[prop]);
    }

    // Update theme-color meta tag
    var metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme && vars['--bg']) metaTheme.content = vars['--bg'];

    return vars;
  }

  /* ── Reset tdesktop theme overrides (restore base theme) ── */
  function resetTdesktopTheme() {
    try {
      localStorage.removeItem('sg_active_custom_theme');
    } catch(e) {}
    // Re-apply the base theme
    if (typeof applyTheme === 'function') {
      var saved = null;
      try { saved = localStorage.getItem('sg_theme') || 'dark'; } catch(e) { saved = 'dark'; }
      applyTheme(saved);
    }
    // Update UI active state
    document.querySelectorAll('.tdtheme-card').forEach(function(c) {
      c.classList.remove('active');
    });
    renderTdesktopThemeList();
  }

  /* ── localStorage cache management ── */
  var CACHE_KEY = 'sg_tdesktop_themes';
  var ACTIVE_KEY = 'sg_active_custom_theme';
  var MAX_THEMES = 10;

  function getCachedThemes() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch(e) { return []; }
  }

  function saveCachedThemes(list) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(list)); } catch(e) {}
  }

  function getActiveCustomTheme() {
    try { return localStorage.getItem(ACTIVE_KEY); } catch(e) { return null; }
  }

  function setActiveCustomTheme(name) {
    try { localStorage.setItem(ACTIVE_KEY, name); } catch(e) {}
  }

  /* ── Add theme to cache (LRU eviction) ── */
  function cacheTheme(name, vars, bgDataUrl) {
    var list = getCachedThemes();

    // Remove existing entry with same name
    list = list.filter(function(t) { return t.name !== name; });

    // Add new entry with current timestamp
    list.unshift({
      name: name,
      vars: vars,
      bgDataUrl: bgDataUrl || null,
      timestamp: Date.now()
    });

    // LRU: keep only MAX_THEMES
    if (list.length > MAX_THEMES) {
      list = list.slice(0, MAX_THEMES);
    }

    saveCachedThemes(list);
  }

  /* ── Delete theme from cache ── */
  function deleteCachedTheme(name) {
    var list = getCachedThemes();
    list = list.filter(function(t) { return t.name !== name; });
    saveCachedThemes(list);

    // If deleted theme was active, reset
    if (getActiveCustomTheme() === name) {
      resetTdesktopTheme();
    } else {
      renderTdesktopThemeList();
    }
  }

  /* ── Parse .tdesktop-theme file (ZIP or plain text) ── */
  function parseTdesktopTheme(file) {
    return new Promise(function(resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function() { reject(new Error('Failed to read file')); };
      reader.onload = function(e) {
        var buffer = e.target.result;
        var textReader = new FileReader();
        textReader.onerror = function() { reject(new Error('Failed to read file as text')); };
        textReader.onload = function(e2) {
          var text = e2.target.result;

          // Try to parse as plain text colors file first (many .tdesktop-theme files are just text)
          var raw = parseColorsFile(text);
          if (Object.keys(raw).length > 0) {
            resolve({ name: null, vars: mapColors(raw), bgDataUrl: null });
            return;
          }

          // If plain text didn't work, try as ZIP
          if (typeof JSZip === 'undefined') {
            reject(new Error('Could not parse theme file (not a valid colors file and JSZip not loaded)'));
            return;
          }

          JSZip.loadAsync(buffer).then(function(zip) {
            var colorsFile = zip.file('colors.tdesktop-theme');
            if (!colorsFile) {
              reject(new Error('colors.tdesktop-theme not found in ZIP and file is not a plain colors file'));
              return;
            }
            colorsFile.async('string').then(function(zipText) {
              var zipRaw = parseColorsFile(zipText);
              if (Object.keys(zipRaw).length === 0) {
                reject(new Error('No valid colors found in theme file'));
                return;
              }
              var vars = mapColors(zipRaw);
              var bgDataUrl = null;
              var bgFile = zip.file('background.jpg') || zip.file('background.png');
              var bgPromise;
              if (bgFile) {
                bgPromise = bgFile.async('base64').then(function(base64) {
                  var ext = bgFile.name.endsWith('.png') ? 'png' : 'jpeg';
                  bgDataUrl = 'data:image/' + ext + ';base64,' + base64;
                }).catch(function() { bgDataUrl = null; });
              } else {
                bgPromise = Promise.resolve();
              }
              bgPromise.then(function() {
                resolve({ name: null, vars: vars, bgDataUrl: bgDataUrl });
              });
            }).catch(reject);
          }).catch(function() {
            reject(new Error('Could not parse theme file — not a valid .tdesktop-theme'));
          });
        };
        textReader.readAsText(file);
      };
      reader.readAsArrayBuffer(file);
    });
  }

  /* ── Build preview swatches from theme vars ── */
  function buildSwatchHtml(vars) {
    // Pick 4 representative colors: bg, msg-bg, msg-me-bg, accent
    var colors = [
      vars['--bg'] || '#222',
      vars['--msg-bg'] || '#333',
      vars['--msg-me-bg'] || '#555',
      vars['--y'] || '#8b5cf6'
    ];
    var html = '<div class="tdtheme-no-img">';
    for (var i = 0; i < colors.length; i++) {
      html += '<div class="tdtheme-swatch" style="background:' + colors[i] + '"></div>';
    }
    html += '</div>';
    return html;
  }

  /* ── Render the theme list in settings ── */
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
      var isActive = t.name === activeName;
      var inner = '';

      if (t.bgDataUrl) {
        inner = '<img src="' + t.bgDataUrl + '" alt="" loading="lazy">';
      } else {
        inner = buildSwatchHtml(t.vars);
      }

      html += '<div class="tdtheme-card' + (isActive ? ' active' : '') + '" data-tdtheme="' + t.name + '" title="' + t.name + '">';
      html += inner;
      html += '<button class="tdtheme-del" data-tddel="' + t.name + '">&times;</button>';
      html += '</div>';
    }

    grid.innerHTML = html;

    // Bind click handlers
    grid.querySelectorAll('.tdtheme-card').forEach(function(card) {
      card.onclick = function(e) {
        if (e.target.closest('.tdtheme-del')) return;
        var name = card.getAttribute('data-tdtheme');
        loadCachedTheme(name);
      };
    });

    grid.querySelectorAll('.tdtheme-del').forEach(function(btn) {
      btn.onclick = function(e) {
        e.stopPropagation();
        var name = btn.getAttribute('data-tddel');
        if (confirm('Удалить тему «' + name + '»?')) {
          deleteCachedTheme(name);
        }
      };
    });
  }

  /* ── Load and apply a cached theme ── */
  function loadCachedTheme(name) {
    var list = getCachedThemes();
    var theme = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].name === name) { theme = list[i]; break; }
    }
    if (!theme) return;

    // Apply theme vars (overrides base theme)
    applyTdesktopTheme(theme.vars);
    setActiveCustomTheme(name);

    // Update active state
    document.querySelectorAll('.tdtheme-card').forEach(function(c) {
      c.classList.toggle('active', c.getAttribute('data-tdtheme') === name);
    });

    // Update theme-color meta
    var metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme && theme.vars['--bg']) metaTheme.content = theme.vars['--bg'];
  }

  /* ── Apply active custom theme on load ── */
  function applyActiveCustomTheme() {
    var activeName = getActiveCustomTheme();
    if (!activeName) return;
    loadCachedTheme(activeName);
  }

  /* ── File input handler ── */
  function handleFileInput(file) {
    if (!file) return;

    // Validate extension
    var name = file.name;
    if (!name.endsWith('.tdesktop-theme')) {
      alert('Пожалуйста, выберите файл .tdesktop-theme');
      return;
    }

    // Derive theme name from filename
    var themeName = name.replace(/\.tdesktop-theme$/i, '');

    parseTdesktopTheme(file).then(function(result) {
      result.name = themeName;

      // Apply immediately
      applyTdesktopTheme(result.vars);
      setActiveCustomTheme(themeName);

      // Cache
      cacheTheme(themeName, result.vars, result.bgDataUrl);

      // Re-render list
      renderTdesktopThemeList();

      // Update theme-color meta
      var metaTheme = document.querySelector('meta[name="theme-color"]');
      if (metaTheme && result.vars['--bg']) metaTheme.content = result.vars['--bg'];

    }).catch(function(err) {
      console.error('[TDesktopTheme] Error:', err);
      alert('Ошибка чтения темы: ' + err.message);
    });
  }

  /* ── Init: bind UI after DOM ready ── */
  function init() {
    // File input
    var fileInput = document.getElementById('tdtheme-file-input');
    if (fileInput) {
      fileInput.addEventListener('change', function() {
        if (fileInput.files && fileInput.files[0]) {
          handleFileInput(fileInput.files[0]);
          fileInput.value = ''; // Reset so same file can be re-selected
        }
      });
    }

    // Upload button (clicks trigger file input)
    var btnUpload = document.getElementById('tdtheme-btn-upload');
    if (btnUpload && fileInput) {
      btnUpload.addEventListener('click', function() { fileInput.click(); });
    }

    // Reset button
    var btnReset = document.getElementById('tdtheme-btn-reset');
    if (btnReset) {
      btnReset.addEventListener('click', function() {
        resetTdesktopTheme();
      });
    }

    // Render theme list
    renderTdesktopThemeList();

    // Apply active custom theme (after base theme is applied)
    applyActiveCustomTheme();
  }

  // Run init on DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose for external use
  window.TDesktopTheme = {
    parse: parseTdesktopTheme,
    apply: applyTdesktopTheme,
    reset: resetTdesktopTheme,
    getCached: getCachedThemes,
    load: loadCachedTheme
  };
})();

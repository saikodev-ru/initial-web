const THEMES = {
  dark: {
    '--bg': '#111111', '--bg-rgb': '17, 17, 17',
    '--bg2': '#181818',
    '--chat-bg': '#111111', '--chat-bg-rgb': '17, 17, 17',
    '--pattern-color': '#161616',
    '--solid1': '#1a1a1b', '--solid2': '#222223', '--solid3': '#2d2d2f',
    '--msg-bg': '#212121',
    '--s0': 'rgba(255,255,255,.03)', '--s1': 'rgba(255,255,255,.05)', '--s2': 'rgba(255,255,255,.08)', '--s3': 'rgba(255,255,255,.14)',
    '--b': 'rgba(255,255,255,.05)', '--b2': 'rgba(255,255,255,.09)', '--b3': 'rgba(255,255,255,.15)',
    '--y': '#8b5cf6', '--y2': '#a78bfa', '--ybg': 'rgba(139,92,246,.13)', '--yb': 'rgba(139,92,246,.36)',
    '--t1': '#efefef', '--t2': 'rgba(239,239,239,.55)', '--t3': 'rgba(239,239,239,.25)',
    '--blur-op': '1',
    '--msg-me-bg': 'var(--y)',
    '--chat-btn-bg': 'transparent', '--chat-btn-b': 'transparent'
  },
  light: {
    '--bg': '#ffffff', '--bg-rgb': '255, 255, 255',
    '--bg2': '#f4f4f5',
    '--chat-bg': '#bac2cc', '--chat-bg-rgb': '186, 194, 204',
    '--pattern-color': '#9ea9b8',
    '--solid1': '#f0f2f5', '--solid2': '#e4e6e9', '--solid3': '#d8dadf',
    '--msg-bg': '#e1e9f1',
    '--s0': 'rgba(0,0,0,.03)', '--s1': 'rgba(0,0,0,.05)', '--s2': 'rgba(0,0,0,.08)', '--s3': 'rgba(0,0,0,.14)',
    '--b': 'rgba(0,0,0,.08)', '--b2': 'rgba(0,0,0,.12)', '--b3': 'rgba(0,0,0,.18)',
    '--y': '#3390ec', '--y2': '#4ea4f5', '--ybg': 'rgba(51,144,236,.12)', '--yb': 'rgba(51,144,236,.36)',
    '--t1': '#000000', '--t2': 'rgba(0,0,0,.55)', '--t3': 'rgba(0,0,0,.35)',
    '--blur-op': '0.3',
    '--msg-me-bg': 'var(--y)',
    '--chat-btn-bg': 'rgba(255,255,255,0.75)', '--chat-btn-b': 'rgba(0,0,0,0.12)'
  },
  amoled: {
    '--bg': '#000000', '--bg-rgb': '0, 0, 0',
    '--bg2': '#000000',
    '--chat-bg': '#000000', '--chat-bg-rgb': '0, 0, 0',
    '--pattern-color': '#0a0a0a',
    '--solid1': '#0a0a0a', '--solid2': '#121212', '--solid3': '#1c1c1c',
    '--msg-bg': '#111111',
    '--s0': 'rgba(255,255,255,.04)', '--s1': 'rgba(255,255,255,.08)', '--s2': 'rgba(255,255,255,.12)', '--s3': 'rgba(255,255,255,.18)',
    '--b': 'rgba(255,255,255,.1)', '--b2': 'rgba(255,255,255,.15)', '--b3': 'rgba(255,255,255,.2)',
    '--y': '#888888', '--y2': '#aaaaaa', '--ybg': 'rgba(255,255,255,.1)', '--yb': 'rgba(255,255,255,.25)',
    '--t1': '#ffffff', '--t2': 'rgba(255,255,255,.6)', '--t3': 'rgba(255,255,255,.35)',
    '--blur-op': '1',
    '--msg-me-bg': 'var(--y)',
    '--chat-btn-bg': 'transparent', '--chat-btn-b': 'transparent'
  }
};

function applyTheme(name) {
  const vars = THEMES[name] || THEMES.dark;
  const r = document.documentElement;
  for (const [k, v] of Object.entries(vars)) r.style.setProperty(k, v);
  
  document.querySelectorAll('.tg-theme-card').forEach(c => c.classList.toggle('active', c.dataset.theme === name));
  try { localStorage.setItem('sg_theme', name); } catch {}
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) metaTheme.content = vars['--bg'];
}

const _savedTheme = (() => { try { return localStorage.getItem('sg_theme') || 'dark'; } catch { return 'dark'; } })();
applyTheme(_savedTheme);
window.applyTheme = applyTheme;

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.tg-theme-card').forEach(c => c.onclick = () => applyTheme(c.dataset.theme));
});
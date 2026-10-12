// App chrome: the mobile navigation drawer and the light/dark theme switch.
import { t } from './i18n.js';
import { restyleCharts } from './charts/charts.js';

const THEME_KEY = 'flowsense.theme';
const THEMES = ['system', 'light', 'dark'];
const THEME_ICONS = { system: 'monitor', light: 'sun', dark: 'moon' };

function savedTheme() {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return THEMES.includes(value) ? value : 'system';
  } catch {
    return 'system';
  }
}

function applyTheme(theme) {
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  document.getElementById('theme-icon').setAttribute('href', `#i-${THEME_ICONS[theme]}`);
  document.getElementById('theme-label').textContent = t(`theme.${theme}`);
  restyleCharts();
}

function setupTheme() {
  let theme = savedTheme();
  applyTheme(theme);
  document.getElementById('theme-button').addEventListener('click', () => {
    theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* not persisted */ }
    applyTheme(theme);
  });
  // Following the OS: redraw charts when it switches.
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => restyleCharts());
}

function setupDrawer() {
  const sidebar = document.getElementById('sidebar');
  const scrim = document.getElementById('scrim');
  const button = document.getElementById('menu-button');
  const setOpen = (open) => {
    sidebar.classList.toggle('open', open);
    scrim.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
  };
  button.addEventListener('click', () => {
    const open = !sidebar.classList.contains('open');
    setOpen(open);
    if (open) sidebar.querySelector('a')?.focus();
  });
  scrim.addEventListener('click', () => setOpen(false));
  window.addEventListener('hashchange', () => setOpen(false));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && sidebar.classList.contains('open')) {
      setOpen(false);
      button.focus();
    }
  });
}

export function setupShell() {
  setupTheme();
  setupDrawer();
}

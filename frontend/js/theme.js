// Classic (non-module) script loaded in <head> so the saved theme applies
// before first paint. 'light' / 'dark' pin the theme; anything else follows
// the operating system. Storage can be unavailable (private mode).
(function applySavedTheme() {
  var theme = null;
  try { theme = localStorage.getItem('flowsense.theme'); } catch (e) { /* follow the system */ }
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
}());

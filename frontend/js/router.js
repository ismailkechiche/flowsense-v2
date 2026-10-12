import { getUser, hasRole, applyRoleVisibility } from './auth.js';
import { clear } from './dom.js';

/**
 * Hash router. Each route names the roles that may open it; anything else
 * shows the "not authorized" view. This only shapes the UI: the backend
 * returns 403 regardless of what the page shows.
 */
const routes = new Map();
let fallbackViews = {};

export function defineRoute(path, { view, roles = null, public: isPublic = false }) {
  routes.set(path, { view, roles, isPublic });
}

export function setFallbackViews(views) {
  fallbackViews = views;
}

export function navigate(path) {
  if (location.hash === `#${path}`) render();
  else location.hash = path;
}

function currentPath() {
  const path = location.hash.replace(/^#/, '').split('?')[0];
  return path || '/home';
}

export async function render() {
  const main = document.getElementById('main');
  const path = currentPath();
  const route = routes.get(path);
  const user = getUser();

  let view;
  if (!route) view = fallbackViews.notFound;
  else if (route.isPublic) view = route.view;
  else if (!user) { navigate('/login'); return; }
  else if (route.roles && !hasRole(route.roles)) view = fallbackViews.notAuthorized;
  else view = route.view;

  for (const link of document.querySelectorAll('#nav a')) {
    if (link.getAttribute('href') === `#${path}`) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }

  clear(main);
  await view(main);
  applyRoleVisibility(main);
  main.focus({ preventScroll: true });
}

export function startRouter() {
  window.addEventListener('hashchange', render);
  return render();
}

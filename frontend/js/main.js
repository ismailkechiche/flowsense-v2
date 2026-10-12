import { setUnauthorizedHandler } from './api.js';
import { loadCurrentUser, logout, clearUser, getUser } from './auth.js';
import { defineRoute, setFallbackViews, startRouter, navigate } from './router.js';
import { translateStatic, t } from './i18n.js';
import { h } from './dom.js';
import { loginView } from './views/login.js';
import { signupView } from './views/signup.js';
import { homeView } from './views/home.js';
import { usersView } from './views/users.js';
import { checkpointsView } from './views/checkpoints.js';
import { accountView } from './views/account.js';
import { sessionsView } from './views/sessions.js';
import { sessionNewView } from './views/sessionNew.js';
import { sessionDetailView } from './views/sessionDetail.js';
import { importView } from './views/import.js';
import { importHistoryView } from './views/importHistory.js';
import { notAuthorizedView, notFoundView } from './views/notAuthorized.js';

const ALL_ROLES = ['collector', 'analyst', 'admin'];

defineRoute('/login', { view: loginView, public: true });
defineRoute('/signup', { view: signupView, public: true });
defineRoute('/home', { view: homeView, roles: ALL_ROLES });
defineRoute('/account', { view: accountView, roles: ALL_ROLES });
defineRoute('/checkpoints', { view: checkpointsView, roles: ALL_ROLES });
defineRoute('/sessions', { view: sessionsView, roles: ALL_ROLES });
defineRoute('/sessions/new', { view: sessionNewView, roles: ['collector', 'admin'] });
defineRoute('/sessions/:id', { view: sessionDetailView, roles: ALL_ROLES });
defineRoute('/users', { view: usersView, roles: ['admin'] });
defineRoute('/import', { view: importView, roles: ['collector', 'admin'] });
defineRoute('/imports', { view: importHistoryView, roles: ['admin'] });
setFallbackViews({ notAuthorized: notAuthorizedView, notFound: notFoundView });

setUnauthorizedHandler(() => {
  if (!getUser()) return;
  clearUser();
  navigate('/login');
});

document.getElementById('logout-button').addEventListener('click', async () => {
  await logout();
  navigate('/login');
});

async function boot() {
  translateStatic();
  try {
    await loadCurrentUser();
  } catch {
    document.getElementById('main').replaceChildren(h('p', { class: 'message error', role: 'alert' }, t('error.network')));
    return;
  }
  await startRouter();
}

boot();

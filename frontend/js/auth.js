import { api } from './api.js';
import { t } from './i18n.js';

let currentUser = null;

export const getUser = () => currentUser;

/** Asks the server who is signed in (null when nobody is). */
export async function loadCurrentUser() {
  try {
    const { user } = await api.get('/auth/me', { redirectOn401: false });
    currentUser = user;
  } catch (err) {
    if (err.status !== 401) throw err;
    currentUser = null;
  }
  applyRoleVisibility();
  return currentUser;
}

export async function login(email, password) {
  const { user } = await api.post('/auth/login', { email, password }, { redirectOn401: false });
  currentUser = user;
  applyRoleVisibility();
  return user;
}

export async function logout() {
  try {
    await api.post('/auth/logout', {}, { redirectOn401: false });
  } finally {
    clearUser();
  }
}

export function clearUser() {
  currentUser = null;
  applyRoleVisibility();
}

export function hasRole(roles) {
  return Boolean(currentUser && roles.includes(currentUser.role));
}

/**
 * Role gating (spec §6.3): toggles the `role-visible` class on every element
 * with data-roles. Visibility is controlled only by this class, never by an
 * !important rule, so elements can always be shown again (e.g. after a
 * different user logs in without a page reload).
 */
export function applyRoleVisibility(root = document) {
  for (const el of root.querySelectorAll('[data-roles]')) {
    const roles = el.dataset.roles.split(/\s+/).filter(Boolean);
    el.classList.toggle('role-visible', hasRole(roles));
  }
  const signedIn = Boolean(currentUser);
  document.getElementById('nav').hidden = !signedIn;
  document.getElementById('user-box').hidden = !signedIn;
  document.getElementById('user-name').textContent = currentUser?.name ?? '';
  document.getElementById('user-role').textContent = currentUser ? t(`role.${currentUser.role}`) : '';
}

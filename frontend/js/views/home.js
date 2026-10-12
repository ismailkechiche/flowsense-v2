import { h, iconChip, icon, emptyState, loading, clear } from '../dom.js';
import { t } from '../i18n.js';
import { api, query } from '../api.js';
import { getUser, hasRole } from '../auth.js';
import { formatMinutes, cardHeader } from './common.js';
import { fmt, fmtPct } from './analyticsFilters.js';
import { slaBadge } from './sessions.js';

/** Shortcuts; `roles` reuses the data-roles gating of the sidebar. */
const SHORTCUTS = [
  { href: '#/sessions/new', icon: 'plus', tone: 'teal', key: 'newSession', roles: 'collector admin' },
  { href: '#/import', icon: 'import', tone: 'teal', key: 'import', roles: 'collector admin' },
  { href: '#/dashboard', icon: 'dashboard', key: 'dashboard', roles: 'analyst admin' },
  { href: '#/simulator', icon: 'simulator', tone: 'violet', key: 'simulator', roles: 'analyst admin' },
  { href: '#/pivot', icon: 'pivot', tone: 'amber', key: 'pivot', roles: 'analyst admin' },
  { href: '#/users', icon: 'users', tone: 'violet', key: 'users', roles: 'admin' },
  { href: '#/admin', icon: 'settings', tone: 'amber', key: 'admin', roles: 'admin' },
  { href: '#/sessions', icon: 'sessions', key: 'sessions', roles: 'collector analyst' },
];

function shortcut(s) {
  return h('a', { class: 'quick-link', href: s.href, 'data-roles': s.roles },
    iconChip(s.icon, s.tone),
    h('span', {}, h('strong', {}, t(`home.go.${s.key}`)), h('span', { class: 'muted' }, t(`home.go.${s.key}.hint`))));
}

async function recentSessions(holder) {
  try {
    const result = await api.get(`/sessions${query({ page_size: 5 })}`);
    clear(holder);
    if (result.total === 0) {
      holder.append(emptyState(t('home.noSessions'), t('home.noSessionsHint'), null, 'sessions'));
      return;
    }
    holder.append(h('ul', { class: 'list-rows' }, result.items.map((s) => h('li', {},
      h('span', {}, h('a', { href: `#/sessions/${s.id}` }, s.name),
        h('span', { class: 'meta' }, ` · ${s.date} · ${s.checkpoint_name}`)),
      h('span', { class: 'nowrap' }, h('span', { class: 'meta' }, t('home.paxWait', { pax: s.pax_total, wait: formatMinutes(s.avg_wait_minutes) })), ' ', slaBadge(s))))));
  } catch {
    clear(holder).append(h('p', { class: 'muted' }, t('error.generic')));
  }
}

async function snapshot(holder) {
  try {
    const s = await api.get('/analytics/summary');
    clear(holder);
    if (s.pax_total === 0) {
      holder.append(h('p', { class: 'muted' }, t('dash.noData')));
      return;
    }
    const tile = (label, value, tone, breach) => h('div', { class: `kpi ${tone ? `tone-${tone}` : ''}${breach ? ' breach' : ''}` },
      h('div', { class: 'kpi-label' }, label), h('div', { class: 'kpi-value' }, value));
    holder.append(h('div', { class: 'kpi-grid' },
      tile(t('dash.avgWait'), `${fmt(s.avg_wait_minutes)} min`),
      tile(t('dash.slaCompliance'), fmtPct(s.sla_compliance_pct), 'teal', s.breach_pax > 0),
      tile(t('dash.totalPax'), String(s.pax_total), 'violet'),
      tile(t('dash.throughput'), `${fmt(s.throughput_per_hour, 0)} ${t('dash.paxPerHour')}`, 'amber')));
  } catch {
    clear(holder).append(h('p', { class: 'muted' }, t('error.generic')));
  }
}

async function pendingAccounts(holder) {
  try {
    const { items } = await api.get(`/users${query({ status: 'pending' })}`);
    if (items.length === 0) return;
    holder.append(h('div', { class: 'message info row space-between' },
      h('span', {}, t('home.pending', { count: items.length })),
      h('a', { class: 'button', href: '#/users' }, t('home.review'), icon('arrow'))));
  } catch { /* the reminder is optional */ }
}

export async function homeView(main) {
  const user = getUser();
  const recent = h('div', {}, loading(t('app.loading')));
  const pending = h('div');
  const stats = h('div', {}, loading(t('app.loading')));

  main.append(h('section', { class: 'stack' },
    h('div', { class: 'hero' },
      h('span', { class: 'badge' }, t(`role.${user.role}`)),
      h('h1', {}, t('home.title', { name: user.name })),
      h('p', {}, t(`home.${user.role}`))),
    pending,
    h('div', { class: 'quick-grid' }, SHORTCUTS.map(shortcut)),
    h('div', { class: 'grid-2' },
      h('section', { class: 'card stack' },
        cardHeader({ title: t('home.recent'), icon: 'sessions', tone: 'teal', actions: h('a', { href: '#/sessions' }, t('home.allSessions')) }),
        recent),
      h('section', { class: 'card stack', 'data-roles': 'analyst admin' },
        cardHeader({ title: t('home.snapshot'), subtitle: t('home.snapshotHelp'), icon: 'dashboard', actions: h('a', { href: '#/dashboard' }, t('home.openDashboard')) }),
        stats))));

  const jobs = [recentSessions(recent)];
  if (hasRole(['analyst', 'admin'])) jobs.push(snapshot(stats));
  if (hasRole(['admin'])) jobs.push(pendingAccounts(pending));
  await Promise.all(jobs);
}

import { h } from '../dom.js';
import { t } from '../i18n.js';
import { pageHeader, tabs, hashParam, setHashParam } from './common.js';
import { importHistoryPanel } from './importHistory.js';
import { auditPanel } from './audit.js';
import { backupsPanel } from './backups.js';

const PANELS = [
  { key: 'imports', icon: 'history', render: importHistoryPanel },
  { key: 'audit', icon: 'audit', render: auditPanel },
  { key: 'backups', icon: 'backups', render: backupsPanel },
];

/**
 * Admin tools that are rarely needed day to day (import history and
 * rollback, audit log, backups), grouped on one admins-only page. The open
 * tab is kept in the hash (`#/admin?tab=audit`) so it can be linked and
 * survives a reload. Each panel loads the first time its tab opens.
 */
export async function adminView(main) {
  const loaded = new Set();
  const view = tabs(PANELS.map((p) => ({ key: p.key, icon: p.icon, label: t(`admin.tab.${p.key}`) })), {
    label: t('admin.title'),
    initial: hashParam('tab'),
    onSelect: (key) => {
      setHashParam('tab', key);
      if (loaded.has(key)) return;
      loaded.add(key);
      PANELS.find((p) => p.key === key).render(view.panels[key]);
    },
  });
  main.append(h('section', { class: 'stack' },
    pageHeader(t('admin.title'), { subtitle: t('admin.subtitle') }),
    view.list,
    ...PANELS.map((p) => view.panels[p.key])));
  view.select(view.current());
}

/** The old /imports, /audit and /backups addresses open the matching tab. */
export function adminRedirect(tab) {
  return () => { location.replace(`#/admin?tab=${tab}`); };
}

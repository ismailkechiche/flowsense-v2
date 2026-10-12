import { h } from '../dom.js';
import { t } from '../i18n.js';

/** Previous / next controls for a paginated API response. */
export function pager(result, onPage) {
  if (!result || result.total_pages <= 1) return h('div');
  return h('nav', { class: 'row', 'aria-label': 'Pagination' },
    h('button', { type: 'button', class: 'secondary', disabled: result.page <= 1, onclick: () => onPage(result.page - 1) }, t('pager.previous')),
    h('span', { class: 'muted' }, t('pager.status', { page: result.page, pages: result.total_pages, total: result.total })),
    h('button', { type: 'button', class: 'secondary', disabled: result.page >= result.total_pages, onclick: () => onPage(result.page + 1) }, t('pager.next')));
}

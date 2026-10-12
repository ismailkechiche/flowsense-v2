import { t } from '../i18n.js';

/** Turns an ApiError into a user-facing sentence. */
export function errorText(err) {
  if (err?.code === 'network_error') return t('error.network');
  return err?.message || t('error.generic');
}

/** Formats a stored local timestamp 'YYYY-MM-DDTHH:MM:SS' for display. */
export function formatLocal(ts) {
  return ts ? ts.replace('T', ' ').slice(0, 16) : '';
}

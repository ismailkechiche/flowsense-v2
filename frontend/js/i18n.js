// All UI strings live here. Add a `fr` dictionary later without touching views.
const dictionaries = {
  en: {
    'app.loading': 'Loading…',
    'nav.skip': 'Skip to content',
    'nav.home': 'Home',
    'nav.users': 'Users',
    'nav.checkpoints': 'Checkpoints',
    'nav.account': 'Account',
    'nav.logout': 'Log out',
    'role.collector': 'Collector',
    'role.analyst': 'Analyst',
    'role.admin': 'Admin',
    'status.pending': 'Pending',
    'status.approved': 'Approved',
    'status.rejected': 'Rejected',
    'status.disabled': 'Disabled',
    'common.save': 'Save',
    'common.cancel': 'Cancel',
    'common.yes': 'Yes',
    'common.no': 'No',
    'common.all': 'All',
    'common.actions': 'Actions',
    'common.saved': 'Saved',
    'common.empty': 'Nothing to show yet.',
    'error.generic': 'Something went wrong. Please try again.',
    'error.network': 'Cannot reach the server. Check your connection and try again.',
    'login.title': 'Log in to FLOWSENSE',
    'login.email': 'Email',
    'login.password': 'Password',
    'login.submit': 'Log in',
    'login.noAccount': 'No account yet?',
    'login.signupLink': 'Request access',
    'signup.title': 'Request access',
    'signup.name': 'Full name',
    'signup.email': 'Email',
    'signup.password': 'Password (at least 10 characters)',
    'signup.role': 'Role you need',
    'signup.submit': 'Send request',
    'signup.done': 'Request sent. An administrator must approve your account before you can log in.',
    'signup.backToLogin': 'Back to log in',
    'home.title': 'Welcome, {name}',
    'home.role': 'You are signed in as {role}.',
    'home.collector': 'Record observations at your checkpoint and import observation sheets.',
    'home.analyst': 'Explore KPIs, staffing recommendations and reports.',
    'home.admin': 'Approve accounts, configure checkpoints and SLAs, and manage the system.',
    'users.title': 'Users',
    'users.filter': 'Show',
    'users.name': 'Name',
    'users.email': 'Email',
    'users.role': 'Role',
    'users.status': 'Status',
    'users.created': 'Requested',
    'users.approveAs': 'Approve as',
    'users.approve': 'Approve',
    'users.reject': 'Reject',
    'users.disable': 'Disable',
    'users.enable': 'Re-enable',
    'users.changeRole': 'Change role',
    'users.you': '(you)',
    'users.confirmDisable': 'Disable {name}? They lose access immediately.',
    'users.confirmReject': 'Reject the request from {name}?',
    'checkpoints.title': 'Checkpoints',
    'checkpoints.name': 'Name',
    'checkpoints.area': 'Area',
    'checkpoints.servers': 'Servers',
    'checkpoints.sla': 'SLA wait (min)',
    'checkpoints.active': 'Active',
    'checkpoints.edit': 'Edit',
    'checkpoints.add': 'Add checkpoint',
    'checkpoints.create': 'Create',
    'checkpoints.slaNote': 'SLA thresholds apply as they are now; changing one re-evaluates all past data.',
    'account.title': 'Account',
    'account.changePassword': 'Change password',
    'account.current': 'Current password',
    'account.new': 'New password (at least 10 characters)',
    'account.changed': 'Password changed.',
    'notAuthorized.title': 'Not authorized',
    'notAuthorized.body': 'Your role does not have access to this page.',
    'notFound.title': 'Page not found',
    'notFound.body': 'This page does not exist.',
    'common.goHome': 'Go to home page',
  },
};

let current = 'en';

export function setLanguage(lang) {
  if (dictionaries[lang]) current = lang;
}

/** Looks up `key` and fills `{placeholders}` from `params`. */
export function t(key, params = {}) {
  const template = dictionaries[current][key] ?? dictionaries.en[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ''));
}

/** Translates static markup carrying data-i18n attributes. */
export function translateStatic(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
}

// Hash router. Later tasks call registerView(route, renderFn(container, ctx)).
// One consistent icon set: 20px outline SVGs drawn with currentColor (no emoji).
const svg = (d) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${d}</svg>`;
export const ICONS = {
  dashboard: svg('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>'),
  clients: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.3c2.2.7 3.5 2.6 3.5 5.7"/>'),
  filings: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>'),
  vault: svg('<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14.5v3"/>'),
  visitors: svg('<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11M9 8h6"/>'),
  reports: svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  users: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  profile: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>'),
  external: svg('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
};

export const ROUTES = [
  { route: '#/dashboard', label: 'Dashboard', icon: ICONS.dashboard },
  { route: '#/clients', label: 'Clients', icon: ICONS.clients },
  { route: '#/filings', label: 'Filings', icon: ICONS.filings },
  { route: '#/vault', label: 'Vault', icon: ICONS.vault },
  { route: '#/visitors', label: 'Visitors', icon: ICONS.visitors },
  { route: '#/reports', label: 'Reports', icon: ICONS.reports },
  { route: '#/users', label: 'Users', icon: ICONS.users, adminOnly: true },
  { route: '#/profile', label: 'Profile', icon: ICONS.profile },
];
export const DEFAULT_ROUTE = '#/dashboard';

const views = new Map();
let outlet = null;
let onChange = null;

export function registerView(route, renderFn) { views.set(route, renderFn); }

export function currentRoute() {
  const h = (typeof location !== 'undefined' && location.hash) || '';
  return h || DEFAULT_ROUTE;
}

function placeholder(route) {
  const meta = ROUTES.find((r) => r.route === route);
  const d = document.createElement('div');
  d.className = 'card placeholder';
  d.innerHTML = '<h2></h2><p class="muted">This section is coming soon.</p>';
  d.querySelector('h2').textContent = meta ? meta.label : route;
  return d;
}

export function renderRoute() {
  if (!outlet) return;
  const route = currentRoute();
  outlet.innerHTML = '';
  const known = ROUTES.some((r) => r.route === route);
  if (!known) {
    const d = document.createElement('div');
    d.className = 'card';
    d.innerHTML = '<h2>Page not found</h2><p class="muted">That page does not exist. Use the menu to continue.</p>';
    outlet.appendChild(d);
  } else if (views.has(route)) {
    views.get(route)(outlet, { route });
  } else {
    outlet.appendChild(placeholder(route));
  }
  if (onChange) onChange(route);
}

export function startRouter(el, changeCb) {
  stopRouter(); // never double-bind hashchange
  outlet = el;
  onChange = changeCb;
  if (!location.hash) location.hash = DEFAULT_ROUTE;
  window.addEventListener('hashchange', renderRoute);
  renderRoute();
}
export function stopRouter() {
  window.removeEventListener('hashchange', renderRoute);
  outlet = null; onChange = null;
}

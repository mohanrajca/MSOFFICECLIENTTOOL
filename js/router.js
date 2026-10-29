// Hash router. Later tasks call registerView(route, renderFn(container, ctx)).
export const ROUTES = [
  { route: '#/dashboard', label: 'Dashboard', icon: '▦' },
  { route: '#/clients', label: 'Clients', icon: '👥' },
  { route: '#/filings', label: 'Filings', icon: '🗂' },
  { route: '#/vault', label: 'Vault', icon: '🔐' },
  { route: '#/visitors', label: 'Visitors', icon: '📒' },
  { route: '#/reports', label: 'Reports', icon: '📊' },
  { route: '#/users', label: 'Users', icon: '⚙', adminOnly: true },
  { route: '#/profile', label: 'Profile', icon: '👤' },
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

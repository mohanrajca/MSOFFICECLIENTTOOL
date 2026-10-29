import { CONFIG } from './config.js';
import { apiCall, apiError } from './api.js';
import { currentUser, getSession } from './session.js';
import { renderSetup, renderLogin, logout } from './auth-ui.js';
import { ROUTES, ICONS, startRouter } from './router.js';
import './views/vault.js';
import './views/visitors.js';
import './views/clients.js';
import './views/filings.js';
import './views/dashboard.js';
import './views/reports.js';
import { esc } from './dom.js';

const root = document.getElementById('app');


function renderNotConfigured() {
  root.innerHTML = `<div class="auth-wrap"><div class="auth-card">
    <h1>Backend not configured</h1>
    <p class="muted">Paste your Apps Script URL and token into <code>js/config.js</code>, then reload this page.</p></div></div>`;
}

// Only http(s) links are allowed for the configured Suite URL.
function safeUrl(u) { return /^https?:\/\//i.test(String(u || '').trim()) ? String(u).trim() : ''; }

function renderShell(user) {
  const items = ROUTES.filter((r) => !r.adminOnly || user.Role === 'Admin');
  const suiteUrl = safeUrl(CONFIG.SUITE_URL);
  const initials = (user.Name || '?').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  root.innerHTML = `
    <header class="topbar">
      <button class="menu-btn" aria-label="Toggle menu" aria-expanded="false" aria-controls="main-nav" type="button">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button>
      <div class="brand"><span class="logo">MS</span><div><strong>MS Associates</strong><small>S. Mohanraj, ACS</small></div></div>
      <div class="spacer"></div>
      ${suiteUrl ? `<a class="suite-link" href="${esc(suiteUrl)}" target="_blank" rel="noopener">GST Suite Pro ${ICONS.external}</a>` : ''}
      <div class="user"><span class="avatar">${esc(initials)}</span><span class="uname">${esc(user.Name)}</span>
        <button class="btn ghost" id="logout" type="button">Logout</button></div>
    </header>
    <div class="layout">
      <nav class="sidenav" id="main-nav" aria-label="Main">
        ${items.map((r) => `<a href="${r.route}" data-route="${r.route}"><span class="ico">${r.icon}</span>${r.label}</a>`).join('')}
        ${suiteUrl ? `<a class="suite-nav" href="${esc(suiteUrl)}" target="_blank" rel="noopener"><span class="ico">${ICONS.external}</span>GST Suite Pro</a>` : ''}
      </nav>
      <main id="view" class="view"></main>
    </div>`;
  root.querySelector('#logout').addEventListener('click', logout);
  const layout = root.querySelector('.layout');
  const menuBtn = root.querySelector('.menu-btn');
  const setNav = (open) => { layout.classList.toggle('nav-open', open); menuBtn.setAttribute('aria-expanded', String(open)); };
  menuBtn.addEventListener('click', () => setNav(!layout.classList.contains('nav-open')));
  startRouter(root.querySelector('#view'), (route) => {
    setNav(false);
    root.querySelectorAll('.sidenav a').forEach((a) => a.classList.toggle('active', a.dataset.route === route));
  });
}

async function boot() {
  if (!CONFIG.ENDPOINT_URL) return renderNotConfigured();
  if (getSession() && currentUser()) return renderShell(currentUser());
  try {
    const st = await apiCall('bootstrapStatus', {});
    if (st && st.needsSetup) renderSetup(root, renderShell);
    else renderLogin(root, renderShell);
  } catch (e) {
    root.innerHTML = `<div class="auth-wrap"><div class="auth-card"><h1>Cannot reach backend</h1>
      <p class="muted">${esc(apiError(e))}</p><button class="btn primary" onclick="location.reload()">Retry</button></div></div>`;
  }
}

boot();

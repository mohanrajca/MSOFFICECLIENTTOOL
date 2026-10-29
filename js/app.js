import { CONFIG } from './config.js';
import { apiCall, apiError } from './api.js';
import { currentUser, getSession } from './session.js';
import { renderSetup, renderLogin, logout } from './auth-ui.js';
import { ROUTES, startRouter } from './router.js';
import './views/vault.js';
import './views/visitors.js';
import './views/clients.js';
import './views/filings.js';
import './views/dashboard.js';
import { esc } from './dom.js';

const root = document.getElementById('app');


function renderNotConfigured() {
  root.innerHTML = `<div class="auth-wrap"><div class="auth-card">
    <h1>Backend not configured</h1>
    <p class="muted">Paste your Apps Script URL and token into <code>js/config.js</code>, then reload this page.</p></div></div>`;
}

function renderShell(user) {
  const items = ROUTES.filter((r) => !r.adminOnly || user.Role === 'Admin');
  const initials = (user.Name || '?').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  root.innerHTML = `
    <header class="topbar">
      <button class="menu-btn" aria-label="Toggle menu" type="button">☰</button>
      <div class="brand"><span class="logo">MS</span><div><strong>MS Associates</strong><small>S. Mohanraj, ACS</small></div></div>
      <div class="spacer"></div>
      <a class="suite-link" href="#" target="_blank" rel="noopener">↗ GST Suite Pro</a>
      <div class="user"><span class="avatar">${esc(initials)}</span><span class="uname">${esc(user.Name)}</span>
        <button class="btn ghost" id="logout" type="button">Logout</button></div>
    </header>
    <div class="layout">
      <nav class="sidenav" aria-label="Main">
        ${items.map((r) => `<a href="${r.route}" data-route="${r.route}"><span class="ico">${r.icon}</span>${r.label}</a>`).join('')}
      </nav>
      <main id="view" class="view"></main>
    </div>`;
  root.querySelector('#logout').addEventListener('click', logout);
  const layout = root.querySelector('.layout');
  root.querySelector('.menu-btn').addEventListener('click', () => layout.classList.toggle('nav-open'));
  startRouter(root.querySelector('#view'), (route) => {
    layout.classList.remove('nav-open');
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

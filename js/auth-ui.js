import { apiCall, apiError } from './api.js';
import { setSession, clearSession } from './session.js';
import { lockVault } from './views/vault.js';

function field(label, name, type, extra = '') {
  return `<label class="field"><span>${label}</span><input name="${name}" type="${type}" ${extra}></label>`;
}

function authCard(title, sub, formHtml, submitLabel) {
  const wrap = document.createElement('div');
  wrap.className = 'auth-wrap';
  wrap.innerHTML = `
    <div class="auth-card">
      <div class="auth-brand"><span class="logo">MS</span><div><strong>MS Associates</strong><small>S. Mohanraj, ACS</small></div></div>
      <h1>${title}</h1><p class="muted">${sub}</p>
      <form novalidate>${formHtml}
        <div class="form-error" role="alert" hidden></div>
        <button class="btn primary" type="submit">${submitLabel}</button>
      </form>
    </div>`;
  return wrap;
}

function wire(wrap, handler) {
  const form = wrap.querySelector('form');
  const err = wrap.querySelector('.form-error');
  const btn = form.querySelector('button');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    const data = Object.fromEntries(new FormData(form).entries());
    for (const k of Object.keys(data)) if (k !== 'password' && k !== 'confirm') data[k] = String(data[k]).trim();
    btn.disabled = true;
    try { await handler(data); }
    catch (ex) { err.textContent = apiError(ex); err.hidden = false; btn.disabled = false; }
  });
}

export function renderSetup(root, onAuthed) {
  const w = authCard('Set up your practice', 'Create the first Admin account to get started.',
    field('Your name', 'name', 'text', 'autocomplete="name"') +
    field('Username', 'username', 'text', 'autocomplete="username"') +
    field('Password (min 8 characters)', 'password', 'password', 'autocomplete="new-password"') +
    field('Confirm password', 'confirm', 'password', 'autocomplete="new-password"'),
    'Create Admin account');
  wire(w, async (d) => {
    if (!d.name || !d.username || !d.password) throw new Error('Please fill in all fields.');
    if (d.password.length < 8) throw new Error('Password must be at least 8 characters.');
    if (d.password !== d.confirm) throw new Error('Passwords do not match.');
    const r = await apiCall('setupAdmin', { name: d.name, username: d.username, password: d.password });
    setSession(r.session, r.user);
    onAuthed(r.user);
  });
  root.innerHTML = ''; root.appendChild(w);
}

export function renderLogin(root, onAuthed) {
  const w = authCard('Sign in', 'Welcome back. Enter your credentials to continue.',
    field('Username', 'username', 'text', 'autocomplete="username"') +
    field('Password', 'password', 'password', 'autocomplete="current-password"'),
    'Sign in');
  wire(w, async (d) => {
    if (!d.username || !d.password) throw new Error('Enter your username and password.');
    const r = await apiCall('login', { username: d.username, password: d.password });
    setSession(r.session, r.user);
    onAuthed(r.user);
  });
  root.innerHTML = ''; root.appendChild(w);
}

export function logout() {
  lockVault();
  clearSession();
  location.hash = '';
  location.reload();
}

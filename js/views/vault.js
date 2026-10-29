// Credential vault. SECURITY: the master key lives ONLY in the module variable below.
// It is never written to any storage, URL, DOM attribute or network request. Passwords
// are encrypted here before upsertCredential and decrypted here only on an explicit
// Reveal click; the server and the DOM never see plaintext otherwise.
import { apiCall, apiError } from '../api.js';
import { registerView } from '../router.js';
import { getSession, requireRole } from '../session.js';
import { encryptSecret, decryptSecret, isCiphertext, WrongKeyError } from '../crypto.js';

const PORTALS = ['IT', 'GST', 'MCA', 'TRACES', 'Other'];
const REVEAL_MS = 30000;

let masterKey = null;      // in memory only
let keySession = null;     // the login session the key was entered under

export function lockVault() { masterKey = null; keySession = null; }
export function isUnlocked() { return masterKey !== null; }

function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
const isAdmin = () => requireRole('Admin');

// Retire the key if the signed-in session changed (logout/login as someone else).
function checkSession() {
  if (masterKey !== null && keySession !== getSession()) lockVault();
}

// A mistyped key must never be accepted when ciphertext already exists, otherwise new
// entries would be encrypted under a different key. Returns true if the key is usable.
function keyMatchesVault(key, creds) {
  const sample = creds.find((c) => isCiphertext(c.Password));
  if (!sample) return true; // empty vault: first key defines the vault
  try { decryptSecret(sample.Password, key); return true; } catch (e) {
    if (e instanceof WrongKeyError) return false;
    throw e;
  }
}

export async function renderVault(container) {
  checkSession();
  container.innerHTML = '<div class="card"><h2>Credential Vault</h2><p class="muted">Loading…</p></div>';
  let clients, creds;
  try {
    [clients, creds] = await Promise.all([apiCall('listClients', {}), apiCall('listCredentials', {})]);
  } catch (e) {
    container.innerHTML = `<div class="card"><h2>Credential Vault</h2><div class="form-error" role="alert">${esc(apiError(e))}</div></div>`;
    return;
  }
  if (masterKey === null) return renderGate(container, clients, creds);
  renderMain(container, clients, creds);
}

function renderGate(container, clients, creds) {
  container.innerHTML = `<div class="card vault-gate"><h2>Credential Vault</h2>
    <p class="muted">Enter the master key to unlock. It is kept in this browser tab's memory only and is never sent to the server.</p>
    <form id="gate" autocomplete="off">
      <label class="field"><span>Master key</span><input name="mk" type="password" autocomplete="off" required></label>
      <div class="form-error" role="alert" hidden></div>
      <button class="btn primary" type="submit">Unlock vault</button>
    </form></div>`;
  const form = container.querySelector('#gate');
  const err = form.querySelector('.form-error');
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const key = form.mk.value;
    form.mk.value = '';
    if (!key.trim()) { err.textContent = 'Enter the master key.'; err.hidden = false; return; }
    if (!keyMatchesVault(key, creds)) { err.textContent = 'Wrong master key'; err.hidden = false; return; }
    masterKey = key; keySession = getSession();
    renderMain(container, clients, creds);
  });
}

function credRow(c, admin) {
  const enc = isCiphertext(c.Password);
  return `<tr data-cred="${esc(c.CredID)}">
    <td>${esc(c.Portal)}</td><td>${esc(c.LoginID)}</td>
    <td class="pw-cell">${enc
      ? '<button class="btn reveal" type="button">Reveal</button>'
      : '<span class="muted">Not encrypted - re-save to encrypt</span>'}</td>
    <td class="actions">${admin ? '<button class="btn edit" type="button">Edit</button> <button class="btn del" type="button">Delete</button>' : ''}</td>
  </tr>`;
}

function renderMain(container, clients, creds) {
  const admin = isAdmin();
  const byClient = new Map();
  for (const c of creds) {
    const k = String(c.ClientID);
    if (!byClient.has(k)) byClient.set(k, []);
    byClient.get(k).push(c);
  }
  const known = new Set(clients.map((c) => String(c.ClientID)));
  const sections = clients.map((cl) => ({ id: String(cl.ClientID), name: cl.Name, list: byClient.get(String(cl.ClientID)) || [] }));
  for (const [id, list] of byClient) if (!known.has(id)) sections.push({ id, name: `(unknown client ${id})`, list });

  container.innerHTML = `<div class="card vault">
    <div class="vault-head"><h2>Credential Vault</h2>
      <div class="vault-tools"><span class="muted">Unlocked</span>
        <button class="btn" id="lock" type="button">Lock vault</button>
        ${admin ? '<button class="btn" id="add" type="button">Add credential</button><button class="btn" id="migrate" type="button">Import from existing sheet</button>' : ''}
      </div></div>
    <div class="form-error" id="msg" role="alert" hidden></div>
    <div id="panel"></div>
    ${sections.length ? sections.map((s) => `<section class="vault-client" data-client="${esc(s.id)}">
      <h3>${esc(s.name)} <small class="muted">${esc(s.id)}</small></h3>
      ${s.list.length ? `<table class="vault-table"><thead><tr><th>Portal</th><th>Login ID</th><th>Password</th><th></th></tr></thead>
        <tbody>${s.list.map((c) => credRow(c, admin)).join('')}</tbody></table>` : '<p class="muted">No credentials saved.</p>'}
    </section>`).join('') : '<p class="muted">No clients yet.</p>'}
  </div>`;

  const msg = container.querySelector('#msg');
  const panel = container.querySelector('#panel');
  const show = (t) => { msg.textContent = t; msg.hidden = !t; };
  const reload = () => renderVault(container);

  container.querySelector('#lock').addEventListener('click', () => { lockVault(); renderVault(container); });

  // Reveal: decrypt in memory only on click; plaintext lives in the DOM only until Hide / timeout.
  container.querySelectorAll('tr[data-cred]').forEach((tr) => {
    const cred = creds.find((c) => String(c.CredID) === tr.dataset.cred);
    const cell = tr.querySelector('.pw-cell');
    const btn = tr.querySelector('.reveal');
    if (btn) {
      let timer = null;
      const hide = () => {
        clearTimeout(timer);
        const out = cell.querySelector('.pw-plain');
        if (out) out.remove();
        btn.textContent = 'Reveal';
      };
      btn.addEventListener('click', () => {
        show('');
        if (cell.querySelector('.pw-plain')) return hide();
        if (masterKey === null) return reload();
        try {
          const plain = decryptSecret(cred.Password, masterKey);
          const out = document.createElement('code');
          out.className = 'pw-plain';
          out.textContent = plain;
          cell.insertBefore(out, btn);
          btn.textContent = 'Hide';
          timer = setTimeout(hide, REVEAL_MS);
        } catch (e) {
          show(e instanceof WrongKeyError ? 'Wrong master key' : 'Could not decrypt this entry.');
        }
      });
    }
    if (admin) {
      tr.querySelector('.edit').addEventListener('click', () => openForm(cred));
      tr.querySelector('.del').addEventListener('click', async () => {
        if (!confirm('Delete this credential?')) return;
        try { await apiCall('deleteCredential', { credId: cred.CredID }); reload(); } catch (e) { show(apiError(e)); }
      });
    }
  });

  if (!admin) return;
  container.querySelector('#add').addEventListener('click', () => openForm(null));

  function openForm(cred) {
    panel.innerHTML = `<form id="credform" class="vault-form" autocomplete="off">
      <h3>${cred ? 'Edit credential' : 'Add credential'}</h3>
      <label class="field"><span>Client</span><select name="client" ${cred ? 'disabled' : ''}>
        ${clients.map((c) => `<option value="${esc(c.ClientID)}">${esc(c.Name)} (${esc(c.ClientID)})</option>`).join('')}</select></label>
      <label class="field"><span>Portal</span><select name="portal">${PORTALS.map((p) => `<option>${p}</option>`).join('')}</select></label>
      <label class="field"><span>Login ID</span><input name="login" required></label>
      <label class="field"><span>Password${cred ? ' (leave blank to keep current)' : ''}</span><input name="pw" type="password" autocomplete="new-password" ${cred ? '' : 'required'}></label>
      <div class="form-error" role="alert" hidden></div>
      <button class="btn primary" type="submit">Save</button> <button class="btn" type="button" id="cancel">Cancel</button>
    </form>`;
    const f = panel.querySelector('#credform');
    const ferr = f.querySelector('.form-error');
    if (cred) { f.client.value = cred.ClientID; f.portal.value = PORTALS.includes(cred.Portal) ? cred.Portal : 'Other'; f.login.value = cred.LoginID; }
    f.querySelector('#cancel').addEventListener('click', () => { panel.innerHTML = ''; });
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      ferr.hidden = true;
      try {
        const body = { ClientID: f.client.value, Portal: f.portal.value, LoginID: f.login.value.trim() };
        if (cred) body.CredID = cred.CredID;
        if (f.pw.value) body.Password = encryptSecret(f.pw.value, masterKey); // ciphertext only
        else if (!cred) throw new Error('Enter a password.');
        f.pw.value = '';
        await apiCall('upsertCredential', body);
        reload();
      } catch (e) { ferr.textContent = apiError(e); ferr.hidden = false; }
    });
  }

  container.querySelector('#migrate').addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    btn.disabled = true; show('');
    try {
      const res = await apiCall('importLegacy', {});
      const existing = await apiCall('listCredentials', {});
      const have = new Set(existing.map((c) => `${c.ClientID}|${c.Portal}|${c.LoginID}`));
      let encrypted = 0; let already = 0;
      for (const m of res.matches || []) {
        const key = `${m.ClientID}|${m.Portal}|${m.LoginID}`;
        if (have.has(key)) { already++; continue; }
        await apiCall('upsertCredential', {
          ClientID: m.ClientID, Portal: m.Portal, LoginID: m.LoginID,
          Password: encryptSecret(m.password, masterKey),
        });
        have.add(key); encrypted++;
      }
      const un = res.unmatched || [];
      panel.innerHTML = `<div class="vault-summary" role="status"><h3>Import complete</h3>
        <p>${res.clientsImported} clients imported. ${encrypted} credentials encrypted and saved${already ? `, ${already} already present (skipped)` : ''}.</p>
        ${un.length ? `<p><strong>${un.length} client(s) had no matching password - add these manually:</strong></p><ul id="unmatched">${un.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : '<p>Every client was matched.</p>'}
        <button class="btn" id="done" type="button">Done</button></div>`;
      panel.querySelector('#done').addEventListener('click', reload);
    } catch (e) {
      show(apiError(e));
      btn.disabled = false;
    }
  });
}

registerView('#/vault', renderVault);

// Users admin (Admin only): list, add, edit, deactivate.
import { apiCall, apiError } from '../api.js';
import { registerView } from '../router.js';
import { currentUser } from '../session.js';
import { esc } from '../dom.js';

const ROLES = ['Admin', 'Staff'];
const MSG = {
  last_admin: 'At least one active admin is required.',
  cannot_deactivate_self: "You can't deactivate yourself.",
  username_taken: 'That username is already taken.',
  invalid_input: 'Please check the details: name, username and role are required (and a password for new users).',
  not_found: 'That user no longer exists.',
};
const errText = (e) => MSG[e && e.code] || apiError(e);
const v = (x) => (x === undefined || x === null ? '' : String(x));
const isActive = (u) => !(u.Active === false || /^(false|no|0)$/i.test(v(u.Active)));

export function renderUsers(container) {
  const me = currentUser();
  if (!me || me.Role !== 'Admin') {
    container.innerHTML = '<div class="card" id="us-noaccess"><h2>You do not have access</h2><p class="muted">Only administrators can manage users.</p></div>';
    return;
  }
  const st = { rows: [], editing: null };
  container.innerHTML = `<div class="card vis-head"><div><h2>Users</h2><p class="muted">Manage who can sign in to the practice manager.</p></div>
      <button type="button" class="btn primary" id="us-add">Add user</button></div>
    <div id="us-form"></div>
    <div class="card list-card"><div id="us-list"><p class="muted">Loading…</p></div></div>`;
  const $ = (s) => container.querySelector(s);
  const showErr = (m) => { $('#us-list').insertAdjacentHTML('afterbegin', `<div class="form-error" role="alert">${esc(m)}</div>`); };

  const drawList = () => {
    $('#us-list').innerHTML = `<table class="vault-table"><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Contact</th><th>Active</th><th></th></tr></thead>
      <tbody>${st.rows.map((r) => `<tr><td>${esc(r.Name)}</td><td>${esc(r.Username)}</td><td>${esc(r.Role)}</td><td>${esc(r.Contact)}</td>
        <td>${isActive(r) ? 'Yes' : 'No'}</td>
        <td class="row-actions"><button type="button" class="btn" data-edit="${esc(r.UserID)}" aria-label="Edit ${esc(r.Name)}">Edit</button>
        ${isActive(r) ? `<button type="button" class="btn" data-deact="${esc(r.UserID)}" aria-label="Deactivate ${esc(r.Name)}">Deactivate</button>` : ''}</td></tr>`).join('')
        || '<tr><td colspan="6" class="muted">No users found.</td></tr>'}</tbody></table>`;
    $('#us-list').querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
      st.editing = st.rows.find((r) => String(r.UserID) === b.dataset.edit) || {}; drawForm();
    }));
    $('#us-list').querySelectorAll('[data-deact]').forEach((b) => b.addEventListener('click', async () => {
      const r = st.rows.find((x) => String(x.UserID) === b.dataset.deact);
      if (!r || !window.confirm(`Deactivate user "${v(r.Name)}"? They will no longer be able to sign in.`)) return;
      try { await apiCall('deactivateUser', { userId: r.UserID }); await load(); } catch (e) { showErr(errText(e)); }
    }));
  };

  const drawForm = () => {
    const u = st.editing;
    if (!u) { $('#us-form').innerHTML = ''; return; }
    const isNew = !u.UserID;
    $('#us-form').innerHTML = `<form class="card form-card" id="us-f" novalidate><h3>${isNew ? 'Add user' : 'Edit user'}</h3>
      <div class="form-grid">
        <label class="field"><span>Name</span><input name="Name" type="text" value="${esc(u.Name)}"></label>
        <label class="field"><span>Username</span><input name="Username" type="text" autocomplete="off" value="${esc(u.Username)}"></label>
        <label class="field"><span>Role</span><select name="Role">${ROLES.map((o) => `<option value="${o}"${o === (v(u.Role) || 'Staff') ? ' selected' : ''}>${o}</option>`).join('')}</select></label>
        <label class="field"><span>Contact</span><input name="Contact" type="text" value="${esc(u.Contact)}"></label>
        <label class="field"><span>Active</span><select name="Active"><option value="true"${isNew || isActive(u) ? ' selected' : ''}>Yes</option><option value="false"${!isNew && !isActive(u) ? ' selected' : ''}>No</option></select></label>
        <label class="field"><span>${isNew ? 'Password (min 8 characters)' : 'Reset password (leave blank to keep)'}</span><input name="password" type="password" autocomplete="new-password"></label>
      </div>
      <div class="form-error" id="us-err" role="alert" hidden></div>
      <div class="vis-actions"><button type="submit" class="btn primary">Save user</button><button type="button" class="btn" id="us-cancel">Cancel</button></div></form>`;
    $('#us-cancel').addEventListener('click', () => { st.editing = null; drawForm(); });
    $('#us-f').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = ev.target; const err = $('#us-err');
      const fail = (m) => { err.textContent = m; err.hidden = false; };
      const p = { name: f.elements.Name.value.trim(), username: f.elements.Username.value.trim(), role: f.elements.Role.value,
        contact: f.elements.Contact.value.trim(), active: f.elements.Active.value === 'true' };
      const pw = f.elements.password.value;
      if (!p.name || !p.username) return fail('Name and username are required.');
      if (isNew && !pw) return fail('A password is required for a new user.');
      if (pw) { if (pw.length < 8) return fail('Password must be at least 8 characters.'); p.password = pw; }
      if (!isNew) p.userId = u.UserID;
      try { await apiCall('upsertUser', p); st.editing = null; drawForm(); await load(); } catch (e) { fail(errText(e)); }
    });
  };

  async function load() {
    try {
      const r = await apiCall('listUsers', {});
      st.rows = Array.isArray(r) ? r : []; drawList();
    } catch (e) { $('#us-list').innerHTML = `<div class="form-error" role="alert">${esc(errText(e))}</div>`; }
  }
  $('#us-add').addEventListener('click', () => { st.editing = {}; drawForm(); });
  load();
}

registerView('#/users', renderUsers);

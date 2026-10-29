// Profile: edit own name/contact and optionally change password.
import { apiCall, apiError } from '../api.js';
import { registerView } from '../router.js';
import { currentUser, getSession, setSession } from '../session.js';
import { esc } from '../dom.js';

const v = (x) => (x === undefined || x === null ? '' : String(x));
const initialsOf = (n) => (n || '?').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();

export function renderProfile(container) {
  const me = currentUser();
  if (!me) { container.innerHTML = '<div class="card"><h2>Profile</h2><p class="muted">Please sign in.</p></div>'; return; }
  // The session user carries no Contact/Username; they are filled from the updateProfile response.
  const st = { user: { ...me }, contact: '' };
  const $ = (s) => container.querySelector(s);

  const draw = (okMsg) => {
    const u = st.user;
    container.innerHTML = `<div class="card"><h2>Profile</h2><p class="muted">Update your own details.</p></div>
      <form class="card form-card" id="pf-f" novalidate>
        <div class="form-grid">
          <label class="field"><span>Name</span><input name="Name" type="text" value="${esc(u.Name)}"></label>
          <label class="field"><span>Username</span><input name="Username" type="text" value="${esc(u.Username)}" readonly></label>
          <label class="field"><span>Role</span><input name="Role" type="text" value="${esc(u.Role)}" readonly></label>
          <label class="field"><span>Contact</span><input name="Contact" type="text" value="${esc(st.contact)}" placeholder="Leave blank to keep current"></label>
          <label class="field"><span>New password (leave blank to keep)</span><input name="password" type="password" autocomplete="new-password"></label>
        </div>
        <div class="form-error" id="pf-err" role="alert" hidden></div>
        <p class="muted" id="pf-ok" role="status"${okMsg ? '' : ' hidden'}>${esc(okMsg || '')}</p>
        <div class="vis-actions"><button type="submit" class="btn primary">Save profile</button></div></form>`;
    $('#pf-f').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = ev.target; const err = $('#pf-err');
      const fail = (m) => { err.textContent = m; err.hidden = false; };
      const name = f.elements.Name.value.trim(); const pw = f.elements.password.value;
      const contact = f.elements.Contact.value.trim();
      if (!name) return fail('Name is required.');
      if (pw && pw.length < 8) return fail('Password must be at least 8 characters.');
      const p = { name };
      // Contact is not known client-side until saved once, so only send it when filled (avoids wiping it).
      if (contact) p.contact = contact;
      if (pw) p.password = pw;
      try {
        const r = await apiCall('updateProfile', p) || {};
        const newName = v(r.Name) || name;
        st.user = { ...st.user, Name: newName, Username: v(r.Username) || st.user.Username, Role: v(r.Role) || st.user.Role };
        if (r.Contact !== undefined) st.contact = v(r.Contact); else if (contact) st.contact = contact;
        setSession(getSession(), { ...currentUser(), Name: newName });
        const un = document.querySelector('.topbar .uname'); if (un) un.textContent = newName;
        const av = document.querySelector('.topbar .avatar'); if (av) av.textContent = initialsOf(newName);
        draw('Profile updated.');
      } catch (e) { fail(apiError(e)); }
    });
  };
  draw();
}

registerView('#/profile', renderProfile);

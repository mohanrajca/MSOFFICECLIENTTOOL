// In-memory session with a sessionStorage cache (storage may be unavailable).
const KEY = 'msa_session';
let _session = '';
let _user = null;

function store() { try { return globalThis.sessionStorage || null; } catch (e) { return null; } }

(function restore() {
  try {
    const s = store();
    const raw = s && s.getItem(KEY);
    if (raw) { const o = JSON.parse(raw); _session = o.session || ''; _user = o.user || null; }
  } catch (e) { /* ignore */ }
})();

export function setSession(session, user) {
  _session = session || '';
  _user = user || null;
  try { const s = store(); if (s) s.setItem(KEY, JSON.stringify({ session: _session, user: _user })); } catch (e) { /* ignore */ }
}
export function clearSession() {
  _session = ''; _user = null;
  try { const s = store(); if (s) s.removeItem(KEY); } catch (e) { /* ignore */ }
}
export function getSession() { return _session; }
export function currentUser() { return _user; }
export function requireRole(role) {
  return !!(_user && _user.Role === role);
}

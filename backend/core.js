// Pure backend logic. ES module for Node/Vitest; also attached to globalThis
// so the non-module Apps Script runtime can call it.

// Canonical column names; first column of each tab is its id field.
export const TABS = {
  Clients: ['ClientID', 'Name', 'GSTIN', 'TradeName', 'RegType', 'State', 'Address', 'Mobile', 'Email', 'FilingFrequency', 'Status'],
  Filings: ['FilingID', 'ClientID', 'Portal', 'ReturnType', 'Period', 'DueDate', 'FiledDate', 'AckNo', 'Status', 'FiledBy'],
  Credentials: ['CredID', 'ClientID', 'Portal', 'LoginID', 'Password', 'Notes', 'UpdatedBy', 'UpdatedOn'],
  Users: ['UserID', 'Name', 'Username', 'PassHash', 'Role', 'Contact', 'Active'],
  Visitors: ['VisitorID', 'Date', 'Category', 'VisitorCount', 'TaxAmt', 'FeesAmt', 'EnteredBy'],
  DayBalances: ['Date', 'CashBalance', 'BankBalance', 'Note'],
  Masters: ['Key', 'Value'],
};

// Id prefix per tab. null = natural key (caller must supply; never auto-generated).
export const ID_PREFIX = {
  Clients: '',
  Filings: 'F',
  Credentials: 'C',
  Users: 'U',
  Visitors: 'V',
  DayBalances: null,
  Masters: null,
};

// Collision-resistant id. Optional rng (returns [0,1)) for test determinism.
export function newId(prefix, rng = Math.random) {
  const rand = Math.floor(rng() * 36 ** 6).toString(36).padStart(6, '0');
  const body = `${Date.now().toString(36)}_${rand}`;
  return prefix ? `${prefix}_${body}` : body;
}

// ---- API dispatch -------------------------------------------------------
// Action registry: name -> (req, store, deps) => data. Later tasks add entries
// via registerAction(). Handlers return data (wrapped as {ok:true,data}) or
// a full {ok,error} envelope (auth/CRUD tasks may return errors directly).
export const ACTIONS = {};
// Actions reachable without a valid obscurity token.
export const PUBLIC_ACTIONS = new Set(['bootstrapStatus']);

export function registerAction(name, fn, { public: isPublic = false } = {}) {
  ACTIONS[name] = fn;
  if (isPublic) PUBLIC_ACTIONS.add(name);
}

export function handle(req, store, deps) {
  const { action } = req || {};
  const fn = Object.prototype.hasOwnProperty.call(ACTIONS, action) ? ACTIONS[action] : null;
  // Fail closed: a missing/empty expectedToken rejects every non-public action.
  const exp = deps && deps.expectedToken;
  if (!PUBLIC_ACTIONS.has(action) && (typeof exp !== 'string' || exp === '' || (req || {}).token !== exp)) {
    return { ok: false, error: 'bad_token' };
  }
  if (!fn) return { ok: false, error: 'unknown_action' };
  const out = fn(req, store, deps);
  return out && typeof out.ok === 'boolean' ? out : { ok: true, data: out };
}

registerAction('bootstrapStatus', (req, store) => ({
  needsSetup: store.readTable('Users').length === 0,
}));

registerAction('getMasters', (req, store) => {
  const portals = [];
  const returnTypes = {};
  for (const r of store.readTable('Masters')) {
    if (r.Key === 'portal') portals.push(r.Value);
    else if (typeof r.Key === 'string' && r.Key.startsWith('return:')) {
      (returnTypes[r.Key.slice(7)] ||= []).push(r.Value);
    }
  }
  return { portals, returnTypes };
});

// ---- Auth ---------------------------------------------------------------
// PassHash = `${salt}:${hashFn(salt, password)}`. Session = `${urlenc(json)}.${hashFn(secret, json)}`
// where json = {UserID, Role, exp}. All crypto goes through deps.hashFn.
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const ROLES = ['Admin', 'Staff'];
const str = (v) => (v === undefined || v === null ? '' : String(v));
const isActive = (u) => u.Active === true || u.Active === 1 || /^(true|1)$/i.test(str(u.Active).trim());
const sameUsername = (a, b) => str(a).trim().toLowerCase() === str(b).trim().toLowerCase();

// Never returns PassHash: whitelist projection.
function safeUser(u) {
  return {
    UserID: u.UserID, Name: u.Name, Username: u.Username, Role: u.Role,
    Contact: u.Contact === undefined ? '' : u.Contact, Active: isActive(u),
  };
}
const sessionUser = (u) => ({ UserID: u.UserID, Name: u.Name, Role: u.Role });

// Length-independent-ish constant-time string compare.
function safeEq(a, b) {
  a = str(a); b = str(b);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

const hasSecret = (deps) => deps && typeof deps.sessionSecret === 'string' && deps.sessionSecret !== '';

function makePassHash(deps, password) {
  const salt = str(deps.randomFn());
  return `${salt}:${deps.hashFn(salt, password)}`;
}
function checkPassword(deps, stored, password) {
  const s = str(stored);
  const i = s.indexOf(':');
  if (i < 1) return false;
  const salt = s.slice(0, i);
  return safeEq(s.slice(i + 1), deps.hashFn(salt, str(password)));
}

function signSession(deps, user) {
  const json = JSON.stringify({ UserID: user.UserID, Role: user.Role, exp: deps.now() + SESSION_TTL_MS });
  return `${encodeURIComponent(json)}.${deps.hashFn(deps.sessionSecret, json)}`;
}

// Returns {UserID, Role} for a valid session, else null. Signature + expiry are
// checked; when a store is supplied the user must still exist and be Active, and
// Role is taken from the store (so demotion/deactivation take effect at once).
export function requireSession(req, deps, store) {
  try {
    const tok = req && req.session;
    if (typeof tok !== 'string' || !hasSecret(deps)) return null;
    const dot = tok.lastIndexOf('.');
    if (dot < 1) return null;
    const json = decodeURIComponent(tok.slice(0, dot));
    if (!safeEq(tok.slice(dot + 1), deps.hashFn(deps.sessionSecret, json))) return null;
    const s = JSON.parse(json);
    if (!s || typeof s.exp !== 'number' || deps.now() > s.exp || !s.UserID) return null;
    if (store) {
      const u = store.readTable('Users').find((r) => String(r.UserID) === String(s.UserID));
      if (!u || !isActive(u)) return null;
      return { UserID: u.UserID, Role: u.Role };
    }
    return { UserID: s.UserID, Role: s.Role };
  } catch (e) {
    return null;
  }
}

const FORBIDDEN = { ok: false, error: 'forbidden' };
const requireAdmin = (req, store, deps) => {
  const me = requireSession(req, deps, store);
  return me && me.Role === 'Admin' ? me : null;
};
const payloadOf = (req) => (req && req.payload && typeof req.payload === 'object' ? req.payload : {});

registerAction('setupAdmin', (req, store, deps) => {
  if (store.readTable('Users').length > 0) return { ok: false, error: 'already_setup' };
  const { name, username, password } = payloadOf(req);
  if (!str(name).trim() || !str(username).trim() || !str(password)) return { ok: false, error: 'invalid_input' };
  if (!hasSecret(deps)) return { ok: false, error: 'server_misconfigured' };
  const row = store.appendRow('Users', {
    Name: str(name).trim(), Username: str(username).trim(), PassHash: makePassHash(deps, str(password)),
    Role: 'Admin', Contact: '', Active: true,
  });
  return { session: signSession(deps, row), user: sessionUser(row) };
});

registerAction('login', (req, store, deps) => {
  const { username, password } = payloadOf(req);
  if (!hasSecret(deps)) return { ok: false, error: 'server_misconfigured' };
  const u = store.readTable('Users').find((r) => sameUsername(r.Username, username) && str(username).trim() !== '');
  // Hash even for unknown users so both failure paths do the same work.
  const good = checkPassword(deps, u ? u.PassHash : `x:${'0'.repeat(8)}`, password);
  if (!u || !good) return { ok: false, error: 'bad_login' };
  if (!isActive(u)) return { ok: false, error: 'inactive' };
  return { session: signSession(deps, u), user: sessionUser(u) };
});

registerAction('updateProfile', (req, store, deps) => {
  const me = requireSession(req, deps, store);
  if (!me) return FORBIDDEN;
  const p = payloadOf(req);
  const patch = {};
  if (p.name !== undefined) {
    if (!str(p.name).trim()) return { ok: false, error: 'invalid_input' };
    patch.Name = str(p.name).trim();
  }
  if (p.contact !== undefined) patch.Contact = str(p.contact).trim();
  if (p.password !== undefined && p.password !== '') patch.PassHash = makePassHash(deps, str(p.password));
  return safeUser(store.updateRowById('Users', 'UserID', me.UserID, patch));
});

registerAction('listUsers', (req, store, deps) => {
  if (!requireAdmin(req, store, deps)) return FORBIDDEN;
  return store.readTable('Users').map(safeUser);
});

registerAction('upsertUser', (req, store, deps) => {
  if (!requireAdmin(req, store, deps)) return FORBIDDEN;
  const p = payloadOf(req);
  const users = store.readTable('Users');
  const existing = p.userId ? users.find((u) => String(u.UserID) === String(p.userId)) : null;
  if (p.userId && !existing) return { ok: false, error: 'not_found' };
  const base = existing || {};
  const name = p.name !== undefined ? str(p.name).trim() : str(base.Name);
  const username = p.username !== undefined ? str(p.username).trim() : str(base.Username);
  const role = p.role !== undefined ? p.role : base.Role;
  if (!name || !username || !ROLES.includes(role)) return { ok: false, error: 'invalid_input' };
  if (users.some((u) => u !== existing && String(u.UserID) !== String(base.UserID) && sameUsername(u.Username, username))) {
    return { ok: false, error: 'username_taken' };
  }
  // Never leave zero active Admins: block demoting / deactivating the last one.
  if (existing && isActive(existing) && existing.Role === 'Admin') {
    const losesAdmin = role !== 'Admin' || (p.active !== undefined && !p.active);
    const others = users.filter((u) => String(u.UserID) !== String(existing.UserID) && isActive(u) && u.Role === 'Admin');
    if (losesAdmin && others.length === 0) return { ok: false, error: 'last_admin' };
  }
  const fields = { Name: name, Username: username, Role: role };
  if (p.contact !== undefined) fields.Contact = str(p.contact).trim();
  if (p.password !== undefined && p.password !== '') fields.PassHash = makePassHash(deps, str(p.password));
  if (existing) {
    if (p.active !== undefined) fields.Active = !!p.active;
    return safeUser(store.updateRowById('Users', 'UserID', existing.UserID, fields));
  }
  if (!fields.PassHash) return { ok: false, error: 'invalid_input' };
  return safeUser(store.appendRow('Users', { ...fields, Contact: fields.Contact || '', Active: p.active === undefined ? true : !!p.active }));
});

registerAction('deactivateUser', (req, store, deps) => {
  const me = requireAdmin(req, store, deps);
  if (!me) return FORBIDDEN;
  const { userId } = payloadOf(req);
  if (!store.readTable('Users').some((u) => String(u.UserID) === String(userId))) return { ok: false, error: 'not_found' };
  if (String(userId) === String(me.UserID)) return { ok: false, error: 'cannot_deactivate_self' };
  return safeUser(store.updateRowById('Users', 'UserID', userId, { Active: false }));
});

// ---- CRUD ---------------------------------------------------------------
// Every action requires a valid session. Stored values pass through untouched
// (Credentials.Password is opaque ciphertext: stored/returned verbatim).
const anySession = (req, store, deps) => requireSession(req, deps, store);
const nowIso = (deps) => {
  const t = deps.now();
  return typeof t === 'number' ? new Date(t).toISOString() : str(t);
};
const same = (a, b) => String(a) === String(b);

// Pick only the table's columns from the payload; undefined -> ''.
function pickFields(tab, p, overrides = {}) {
  const out = {};
  for (const col of TABS[tab]) {
    if (Object.prototype.hasOwnProperty.call(p, col)) out[col] = p[col] === undefined ? '' : p[col];
  }
  for (const [k, v] of Object.entries(overrides)) out[k] = v === undefined ? '' : v;
  return out;
}

// Update when payload carries an existing id, else append.
function upsertById(store, tab, p, overrides) {
  const idField = TABS[tab][0];
  const fields = pickFields(tab, p, overrides);
  const id = fields[idField];
  if (id !== undefined && id !== '' && store.readTable(tab).some((r) => same(r[idField], id))) {
    delete fields[idField];
    return store.updateRowById(tab, idField, id, fields);
  }
  return store.appendRow(tab, fields);
}

function deleteById(store, tab, id) {
  const idField = TABS[tab][0];
  if (id === undefined || id === null || id === '' || !store.readTable(tab).some((r) => same(r[idField], id))) {
    return { ok: false, error: 'not_found' };
  }
  store.deleteRowById(tab, idField, id);
  return { deleted: String(id) };
}

function defineCrud(tab, names, { listFilter, listGuard = anySession, writeGuard = anySession, stamp, idKey }) {
  registerAction(names.list, (req, store, deps) => {
    if (!listGuard(req, store, deps)) return FORBIDDEN;
    const q = payloadOf(req);
    const rows = store.readTable(tab);
    return listFilter ? rows.filter((r) => listFilter(r, q)) : rows;
  });
  registerAction(names.upsert, (req, store, deps) => {
    const me = writeGuard(req, store, deps);
    if (!me) return FORBIDDEN;
    return upsertById(store, tab, payloadOf(req), stamp ? stamp(me, deps) : {});
  });
  if (names.del) {
    registerAction(names.del, (req, store, deps) => {
      if (!writeGuard(req, store, deps)) return FORBIDDEN;
      return deleteById(store, tab, payloadOf(req)[idKey]);
    });
  }
}

const byClient = (r, q) => q.clientId === undefined || q.clientId === null || q.clientId === '' || same(r.ClientID, q.clientId);

defineCrud('Clients', { list: 'listClients', upsert: 'upsertClient', del: 'deleteClient' }, { idKey: 'clientId' });
defineCrud('Filings', { list: 'listFilings', upsert: 'upsertFiling', del: 'deleteFiling' }, {
  idKey: 'filingId', listFilter: byClient, stamp: (me) => ({ FiledBy: me.UserID }),
});
defineCrud('Credentials', { list: 'listCredentials', upsert: 'upsertCredential', del: 'deleteCredential' }, {
  idKey: 'credId', listFilter: byClient, writeGuard: requireAdmin,
  stamp: (me, deps) => ({ UpdatedBy: me.UserID, UpdatedOn: nowIso(deps) }),
});
defineCrud('Visitors', { list: 'listVisitors', upsert: 'upsertVisitor' }, {
  stamp: (me) => ({ EnteredBy: me.UserID }),
  listFilter: (r, q) => {
    if (q.date) return same(r.Date, q.date);
    if (q.month) return str(r.Date).startsWith(str(q.month));
    return true;
  },
});

// ---- One-time legacy import (Admin) --------------------------------------
// deps.importSource() -> {clientRows, currentRows}: RAW rows of the firm's CLIENT and
// CURRENT tabs (read-only). Clients are upserted by ClientID (idempotent). GST passwords
// are returned in PLAINTEXT to the Admin's browser, which alone can encrypt them; this
// action never writes Credentials and never writes the CLIENT/CURRENT tabs.
// sheet-mapping.js registers globalThis.SheetMapping (a separate file in Apps Script).
registerAction('importLegacy', (req, store, deps) => {
  if (!requireAdmin(req, store, deps)) return FORBIDDEN;
  const M = globalThis.SheetMapping;
  if (!deps || typeof deps.importSource !== 'function' || !M) return { ok: false, error: 'import_unavailable' };
  const src = deps.importSource() || {};
  const passwords = M.currentPasswordMap(src.currentRows || []);
  const matches = [];
  const unmatched = [];
  let clientsImported = 0;
  for (const row of src.clientRows || []) {
    const c = M.clientRowToCanonical(row);
    if (!c.ClientID) { if (c.Name) unmatched.push(c.Name); continue; }
    const { gstUserName, ...client } = c;
    upsertById(store, 'Clients', client);
    clientsImported++;
    const pw = M.matchClientPassword(client, gstUserName, passwords);
    if (pw === null || pw === '' || !gstUserName) unmatched.push(client.Name || client.ClientID);
    else matches.push({ ClientID: client.ClientID, Name: client.Name, Portal: 'GST', LoginID: gstUserName, password: pw });
  }
  return { clientsImported, matches, unmatched };
});

registerAction('getDayBalance', (req, store, deps) => {
  if (!anySession(req, store, deps)) return FORBIDDEN;
  const { date } = payloadOf(req);
  return store.readTable('DayBalances').find((r) => same(r.Date, date)) || null;
});

registerAction('listBalances', (req, store, deps) => {
  if (!anySession(req, store, deps)) return FORBIDDEN;
  const { before } = payloadOf(req);
  const key = (r) => str(r.Date).slice(0, 10);
  const b = str(before).slice(0, 10);
  return store.readTable('DayBalances').filter((r) => key(r) && (!b || key(r) < b))
    .sort((x, y) => (key(x) < key(y) ? -1 : key(x) > key(y) ? 1 : 0));
});

registerAction('setDayBalance', (req, store, deps) => {
  if (!anySession(req, store, deps)) return FORBIDDEN;
  const p = payloadOf(req);
  if (!str(p.Date).trim()) return { ok: false, error: 'invalid_input' };
  const fields = pickFields('DayBalances', p);
  const exists = store.readTable('DayBalances').some((r) => same(r.Date, fields.Date));
  return exists ? store.updateRowById('DayBalances', 'Date', fields.Date, fields) : store.appendRow('DayBalances', fields);
});

globalThis.requireSession = requireSession;
globalThis.TABS = TABS;
globalThis.handle = handle;
globalThis.registerAction = registerAction;
globalThis.ID_PREFIX = ID_PREFIX;
globalThis.newId = newId;
globalThis.ACTIONS = ACTIONS;
globalThis.PUBLIC_ACTIONS = PUBLIC_ACTIONS;

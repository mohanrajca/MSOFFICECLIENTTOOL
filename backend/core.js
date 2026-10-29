// Pure backend logic. ES module for Node/Vitest; also attached to globalThis
// so the non-module Apps Script runtime can call it.

// Canonical column names; first column of each tab is its id field.
export const TABS = {
  Clients: ['ClientID', 'Name', 'GSTIN', 'TradeName', 'RegType', 'State', 'Address', 'Mobile', 'Email', 'FilingFrequency', 'Status'],
  Filings: ['FilingID', 'ClientID', 'Portal', 'ReturnType', 'Period', 'FiledDate', 'AckNo', 'Status', 'FiledBy'],
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
// throw nothing; auth/CRUD tasks may return {ok:false,error} directly.
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
  if (!PUBLIC_ACTIONS.has(action) && (req || {}).token !== deps.expectedToken) {
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

globalThis.TABS = TABS;
globalThis.handle = handle;
globalThis.registerAction = registerAction;
globalThis.ID_PREFIX = ID_PREFIX;
globalThis.newId = newId;

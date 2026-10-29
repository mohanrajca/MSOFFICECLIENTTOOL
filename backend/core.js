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

globalThis.TABS = TABS;
globalThis.ID_PREFIX = ID_PREFIX;
globalThis.newId = newId;

// Pure mapping from the firm's existing CLIENT / CURRENT tabs (read-only import sources)
// to the app's canonical schema. No I/O, no side effects.

export const CLIENT_HEADERS = [
  'CLIENT ID', 'CLIENT NAME', 'GSTIN', 'Trade Name', 'Reg. Type', 'STATE', 'ADDRESS',
  'Mobile', 'EMAIL ID', 'USER NAME', 'PASSWORD', 'Filing Frequency', 'Status',
];

const cell = (v) => (v === undefined || v === null ? '' : String(v).trim());

export function normalizeName(s) {
  return cell(s).toLowerCase().replace(/\s+/g, ' ');
}

// row: object keyed by the CLIENT tab headers. gstUserName is NOT a Clients column;
// the importer uses it to seed a GST credential.
const trimKeys = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [String(k).trim(), v]));

export function clientRowToCanonical(row) {
  const r = trimKeys(row);
  return {
    ClientID: cell(r['CLIENT ID']),
    Name: cell(r['CLIENT NAME']),
    GSTIN: cell(r['GSTIN']),
    TradeName: cell(r['Trade Name']),
    RegType: cell(r['Reg. Type']),
    State: cell(r['STATE']),
    Address: cell(r['ADDRESS']),
    Mobile: cell(r['Mobile']),
    Email: cell(r['EMAIL ID']),
    FilingFrequency: cell(r['Filing Frequency']),
    Status: cell(r['Status']),
    gstUserName: cell(r['USER NAME']),
  };
}

// rows: objects with CLIENT and Password keys (CURRENT tab). Blank names skipped.
export function currentPasswordMap(rows) {
  const map = {};
  for (const raw of rows || []) {
    const r = trimKeys(raw);
    const key = normalizeName(r.CLIENT);
    if (!key) continue;
    map[key] = r.Password === undefined || r.Password === null ? '' : String(r.Password).trim();
  }
  return map;
}

// Returns the password string, or null if neither name nor GST username matches.
export function matchClientPassword(canonicalClient, gstUserName, passwordMap) {
  const has = (k) => k !== '' && Object.prototype.hasOwnProperty.call(passwordMap || {}, k);
  const byName = normalizeName(canonicalClient && canonicalClient.Name);
  if (has(byName)) return passwordMap[byName];
  const byUser = normalizeName(gstUserName);
  if (has(byUser)) return passwordMap[byUser];
  return null;
}

globalThis.SheetMapping = { CLIENT_HEADERS, normalizeName, clientRowToCanonical, currentPasswordMap, matchClientPassword };

// Firm's per-period GST status rows -> Filing records (GSTR-1 and GSTR-3B). Pure; no live import yet.
// gstinToClientId: { GSTIN: ClientID }. Unknown GSTIN -> ClientID '' and Unmatched: true.
// A return with no Due/Filed/Status data in the row is skipped.
export function gstStatusRowsToFilings(rows, gstinToClientId) {
  const map = {};
  for (const [k, v] of Object.entries(gstinToClientId || {})) map[cell(k).toUpperCase()] = v;
  const out = [];
  for (const raw of rows || []) {
    const r = trimKeys(raw);
    const gstin = cell(r['Client GSTIN']).toUpperCase();
    const clientId = map[gstin];
    for (const [tag, returnType] of [['GSTR1', 'GSTR-1'], ['GSTR3B', 'GSTR-3B']]) {
      const due = cell(r[`${tag} Due`]); const filed = cell(r[`${tag} Filed`]); const status = cell(r[`${tag} Status`]);
      if (!due && !filed && !status) continue;
      const f = { ClientID: clientId === undefined ? '' : clientId, Portal: 'GST', ReturnType: returnType,
        Period: cell(r['Period']), DueDate: due, FiledDate: filed, Status: status || 'Pending' };
      if (clientId === undefined) f.Unmatched = true;
      out.push(f);
    }
  }
  return out;
}

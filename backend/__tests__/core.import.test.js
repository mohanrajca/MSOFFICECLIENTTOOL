import { describe, test, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { TABS, handle } from '../core.js';
import '../sheet-mapping.js';
import { memStore } from '../store-memory.js';

const TOKEN = 'tok123';
let n = 0;
const baseDeps = {
  now: () => Date.UTC(2026, 9, 29),
  hashFn: (s, p) => createHmac('sha256', String(s)).update(String(p)).digest('hex'),
  randomFn: () => `r${++n}x${n * 7919}`,
  expectedToken: TOKEN,
  sessionSecret: 'sec',
};
const clientRows = [
  { 'CLIENT ID': 'C001', 'CLIENT NAME': 'Acme Traders', GSTIN: '33AAAAA0000A1Z5', STATE: 'TN', 'EMAIL ID': 'a@x.in', 'USER NAME': 'acme_gst', ' Status ': 'Active' },
  { 'CLIENT ID': 'C002', 'CLIENT NAME': 'Beta Foods', GSTIN: '33BBBBB0000B1Z5', 'USER NAME': 'beta_u' },
  { 'CLIENT ID': 'C003', 'CLIENT NAME': 'Ghost Co', GSTIN: '33CCCCC0000C1Z5', 'USER NAME': 'ghost_u' },
];
const currentRows = [
  { CLIENT: 'ACME  traders', Password: 'p@ss-1 ' },
  { CLIENT: 'beta_u', Password: 'pw2' },
];
function setup(importSource) {
  const deps = { ...baseDeps, importSource };
  const store = memStore({ ...TABS });
  const a = handle({ action: 'setupAdmin', token: TOKEN, payload: { name: 'A', username: 'admin', password: 'pw-admin' } }, store, deps);
  handle({ action: 'upsertUser', token: TOKEN, session: a.data.session, payload: { name: 'S', username: 'staff', password: 'pw-staff', role: 'Staff' } }, store, deps);
  const s = handle({ action: 'login', token: TOKEN, payload: { username: 'staff', password: 'pw-staff' } }, store, deps);
  const call = (session) => handle({ action: 'importLegacy', token: TOKEN, session, payload: {} }, store, deps);
  return { store, deps, admin: a.data.session, staff: s.data.session, call };
}

describe('importLegacy', () => {
  const src = () => ({ clientRows, currentRows });

  test('Admin only', () => {
    const { call, staff } = setup(src);
    expect(call(staff)).toEqual({ ok: false, error: 'forbidden' });
    expect(call('')).toEqual({ ok: false, error: 'forbidden' });
  });

  test('imports clients, idempotent on re-run, returns matches + unmatched', () => {
    const { call, admin, store } = setup(src);
    const r = call(admin);
    expect(r.ok).toBe(true);
    expect(r.data.clientsImported).toBe(3);
    expect(store.readTable('Clients')).toHaveLength(3);
    expect(store.readTable('Clients').find((c) => c.ClientID === 'C001')).toMatchObject({ Name: 'Acme Traders', State: 'TN' });
    expect(r.data.matches).toEqual([
      { ClientID: 'C001', Name: 'Acme Traders', Portal: 'GST', LoginID: 'acme_gst', password: 'p@ss-1' },
      { ClientID: 'C002', Name: 'Beta Foods', Portal: 'GST', LoginID: 'beta_u', password: 'pw2' },
    ]);
    expect(r.data.unmatched).toEqual(['Ghost Co']);
    // re-run: no duplicates, and CLIENT-edits flow through as updates
    const r2 = call(admin);
    expect(r2.data.clientsImported).toBe(3);
    expect(store.readTable('Clients')).toHaveLength(3);
  });

  test('never writes Credentials (browser does, as ciphertext)', () => {
    const { call, admin, store } = setup(src);
    call(admin);
    expect(store.readTable('Credentials')).toEqual([]);
  });

  test('missing importSource or blank-ID client is reported, not crashed/dropped', () => {
    const none = setup(undefined);
    expect(none.call(none.admin)).toEqual({ ok: false, error: 'import_unavailable' });
    const s = setup(() => ({ clientRows: [{ 'CLIENT ID': '', 'CLIENT NAME': 'No Id Ltd' }], currentRows: [] }));
    const r = s.call(s.admin);
    expect(r.data.clientsImported).toBe(0);
    expect(r.data.unmatched).toEqual(['No Id Ltd']);
  });
});

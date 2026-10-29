import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { TABS, ACTIONS, handle } from '../core.js';
import { memStore } from '../store-memory.js';

const TOKEN = 'tok123';
const NOW = Date.UTC(2026, 9, 29, 10, 0, 0);
let n = 0;
const deps = {
  now: () => NOW,
  hashFn: (salt, pw) => createHmac('sha256', String(salt)).update(String(pw)).digest('hex'),
  randomFn: () => `r${++n}x${n * 7919}`,
  expectedToken: TOKEN,
  sessionSecret: 'sess-secret',
};
const call = (store, action, payload = {}, extra = {}) =>
  handle({ action, token: TOKEN, payload, ...extra }, store, deps);

function setup() {
  const store = memStore({ ...TABS });
  const a = call(store, 'setupAdmin', { name: 'Admin', username: 'admin', password: 'pw-admin' });
  call(store, 'upsertUser', { name: 'Staff', username: 'staff', password: 'pw-staff', role: 'Staff' }, { session: a.data.session });
  const s = call(store, 'login', { username: 'staff', password: 'pw-staff' });
  return { store, admin: { session: a.data.session }, staff: { session: s.data.session }, adminId: a.data.user.UserID, staffId: s.data.user.UserID };
}

describe('session required', () => {
  const actions = ['listClients', 'upsertClient', 'deleteClient', 'listFilings', 'upsertFiling', 'deleteFiling',
    'listCredentials', 'upsertCredential', 'deleteCredential', 'listVisitors', 'upsertVisitor', 'getDayBalance', 'setDayBalance', 'listBalances'];
  test.each(actions)('%s without session -> forbidden', (a) => {
    const { store } = setup();
    expect(call(store, a, {})).toEqual({ ok: false, error: 'forbidden' });
    expect(call(store, a, {}, { session: 'garbage.sig' })).toEqual({ ok: false, error: 'forbidden' });
  });
  test('bad token still rejected', () => {
    const { store, admin } = setup();
    expect(handle({ action: 'listClients', token: 'x', ...admin }, store, deps)).toEqual({ ok: false, error: 'bad_token' });
  });
});

describe('clients', () => {
  test('upsert create, update (merge-patch), list, delete; no undefined cells', () => {
    const { store, staff } = setup();
    const c = call(store, 'upsertClient', { Name: 'Acme', GSTIN: '33AAAAA0000A1Z5', Mobile: undefined }, staff);
    expect(c.ok).toBe(true);
    const id = c.data.ClientID;
    expect(id).toBeTruthy();
    expect(c.data.Mobile).toBe('');
    const u = call(store, 'upsertClient', { ClientID: id, Name: 'Acme 2', State: undefined }, staff);
    expect(u.data).toMatchObject({ ClientID: id, Name: 'Acme 2', GSTIN: '33AAAAA0000A1Z5', State: '' });
    const l = call(store, 'listClients', {}, staff);
    expect(l.data).toHaveLength(1);
    expect(Object.values(l.data[0]).includes(undefined)).toBe(false);
    expect(call(store, 'deleteClient', { clientId: id }, staff)).toMatchObject({ ok: true });
    expect(call(store, 'listClients', {}, staff).data).toEqual([]);
    expect(call(store, 'deleteClient', { clientId: id }, staff)).toEqual({ ok: false, error: 'not_found' });
  });
  test('deleteClient does not cascade', () => {
    const { store, admin } = setup();
    const id = call(store, 'upsertClient', { Name: 'A' }, admin).data.ClientID;
    call(store, 'upsertFiling', { ClientID: id, Portal: 'GST', ReturnType: 'GSTR-1', Period: '2026-09' }, admin);
    call(store, 'upsertCredential', { ClientID: id, Portal: 'GST', LoginID: 'u', Password: 'ct' }, admin);
    call(store, 'deleteClient', { clientId: id }, admin);
    expect(call(store, 'listFilings', {}, admin).data).toHaveLength(1);
    expect(call(store, 'listCredentials', {}, admin).data).toHaveLength(1);
  });
});

describe('filings', () => {
  test('round trip, FiledBy from session, filter, update, delete', () => {
    const { store, staff, staffId } = setup();
    const f1 = call(store, 'upsertFiling', { ClientID: 'c1', Portal: 'GST', ReturnType: 'GSTR-3B', Period: '2026-09', FiledBy: 'spoof' }, staff).data;
    call(store, 'upsertFiling', { ClientID: 'c2', Portal: 'GST', ReturnType: 'GSTR-1', Period: '2026-09' }, staff);
    expect(f1.FiledBy).toBe(staffId);
    expect(call(store, 'listFilings', {}, staff).data).toHaveLength(2);
    expect(call(store, 'listFilings', { clientId: 'c1' }, staff).data).toHaveLength(1);
    const u = call(store, 'upsertFiling', { FilingID: f1.FilingID, Status: 'Filed', AckNo: 'A1', FiledBy: 'spoof' }, staff).data;
    expect(u).toMatchObject({ Status: 'Filed', AckNo: 'A1', Period: '2026-09', FiledBy: staffId });
    expect(call(store, 'listFilings', {}, staff).data).toHaveLength(2);
    expect(call(store, 'deleteFiling', { filingId: f1.FilingID }, staff).ok).toBe(true);
    expect(call(store, 'listFilings', {}, staff).data).toHaveLength(1);
  });
});

describe('credentials', () => {
  test('Admin upsert stores Password verbatim; list returns it verbatim; provenance stamped', () => {
    const { store, admin, staff, adminId } = setup();
    const ct = 'U2FsdGVkX1+abc/def==';
    const c = call(store, 'upsertCredential', { ClientID: 'c1', Portal: 'GST', LoginID: 'u', Password: ct, UpdatedBy: 'spoof', UpdatedOn: '1999' }, admin).data;
    expect(c.Password).toBe(ct);
    expect(c.UpdatedBy).toBe(adminId);
    expect(c.UpdatedOn).toBe('2026-10-29T10:00:00.000Z');
    expect(store.readTable('Credentials')[0].Password).toBe(ct);
    const listed = call(store, 'listCredentials', {}, staff).data;
    expect(listed[0].Password).toBe(ct);
    expect(call(store, 'listCredentials', { clientId: 'zzz' }, staff).data).toEqual([]);
    call(store, 'upsertCredential', { CredID: c.CredID, Notes: 'n' }, admin);
    expect(store.readTable('Credentials')[0]).toMatchObject({ Password: ct, Notes: 'n' });
    expect(store.readTable('Credentials')).toHaveLength(1);
  });
  test('Staff cannot upsert/delete', () => {
    const { store, admin, staff } = setup();
    expect(call(store, 'upsertCredential', { ClientID: 'c1', Password: 'x' }, staff)).toEqual({ ok: false, error: 'forbidden' });
    const c = call(store, 'upsertCredential', { ClientID: 'c1', Password: 'x' }, admin).data;
    expect(call(store, 'deleteCredential', { credId: c.CredID }, staff)).toEqual({ ok: false, error: 'forbidden' });
    expect(store.readTable('Credentials')).toHaveLength(1);
    expect(call(store, 'deleteCredential', { credId: c.CredID }, admin).ok).toBe(true);
    expect(store.readTable('Credentials')).toHaveLength(0);
  });
  test('no decrypt path in backend', () => {
    expect(Object.keys(ACTIONS).filter((k) => /decrypt|reveal/i.test(k))).toEqual([]);
    expect(readFileSync(new URL('../core.js', import.meta.url), 'utf8')).not.toMatch(/decrypt/i);
  });
});

describe('visitors', () => {
  test('round trip, EnteredBy stamped, date/month filters', () => {
    const { store, staff, staffId } = setup();
    const v = call(store, 'upsertVisitor', { Date: '2026-10-05', Category: 'GST', VisitorCount: 3, EnteredBy: 'spoof' }, staff).data;
    call(store, 'upsertVisitor', { Date: '2026-10-06', Category: 'IT', VisitorCount: 1 }, staff);
    call(store, 'upsertVisitor', { Date: '2026-11-01', Category: 'IT', VisitorCount: 2 }, staff);
    expect(v.EnteredBy).toBe(staffId);
    expect(call(store, 'listVisitors', {}, staff).data).toHaveLength(3);
    expect(call(store, 'listVisitors', { date: '2026-10-05' }, staff).data).toHaveLength(1);
    expect(call(store, 'listVisitors', { month: '2026-10' }, staff).data).toHaveLength(2);
    const u = call(store, 'upsertVisitor', { VisitorID: v.VisitorID, VisitorCount: 9 }, staff).data;
    expect(u).toMatchObject({ VisitorCount: 9, Category: 'GST', EnteredBy: staffId });
    expect(call(store, 'listVisitors', {}, staff).data).toHaveLength(3);
  });
});

describe('day balances', () => {
  test('get null; set twice same Date updates, no duplicate', () => {
    const { store, staff } = setup();
    expect(call(store, 'getDayBalance', { date: '2026-10-29' }, staff)).toEqual({ ok: true, data: null });
    call(store, 'setDayBalance', { Date: '2026-10-29', CashBalance: 100, BankBalance: 200, Note: 'a' }, staff);
    const r = call(store, 'setDayBalance', { Date: '2026-10-29', CashBalance: 150 }, staff);
    expect(r.data).toMatchObject({ Date: '2026-10-29', CashBalance: 150, BankBalance: 200, Note: 'a' });
    expect(store.readTable('DayBalances')).toHaveLength(1);
    call(store, 'setDayBalance', { Date: '2026-10-30', CashBalance: 1 }, staff);
    expect(store.readTable('DayBalances')).toHaveLength(2);
    expect(call(store, 'getDayBalance', { date: '2026-10-29' }, staff).data.CashBalance).toBe(150);
  });
  test('listBalances returns all sorted; before filters strictly', () => {
    const { store, staff } = setup();
    expect(call(store, 'listBalances', {}, staff)).toEqual({ ok: true, data: [] });
    for (const d of ['2026-10-30', '2026-01-05', '2026-10-01']) call(store, 'setDayBalance', { Date: d, CashBalance: 1 }, staff);
    expect(call(store, 'listBalances', {}, staff).data.map((r) => r.Date)).toEqual(['2026-01-05', '2026-10-01', '2026-10-30']);
    expect(call(store, 'listBalances', { before: '2026-10-30' }, staff).data.map((r) => r.Date)).toEqual(['2026-01-05', '2026-10-01']);
  });
  test('missing Date -> invalid_input', () => {
    const { store, staff } = setup();
    expect(call(store, 'setDayBalance', { CashBalance: 1 }, staff)).toEqual({ ok: false, error: 'invalid_input' });
  });
});

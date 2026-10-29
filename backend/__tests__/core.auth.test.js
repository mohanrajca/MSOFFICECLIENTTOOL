import { describe, test, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { TABS, handle, requireSession } from '../core.js';
import { memStore } from '../store-memory.js';

const TOKEN = 'tok123';
let clock = 1000;
let n = 0;
const deps = {
  now: () => clock,
  hashFn: (salt, pw) => createHmac('sha256', String(salt)).update(String(pw)).digest('hex'),
  randomFn: () => `r${++n}x${n * 7919}`,
  expectedToken: TOKEN,
  sessionSecret: 'sess-secret',
};
const mk = () => memStore({ ...TABS });
const call = (store, action, payload = {}, extra = {}) =>
  handle({ action, token: TOKEN, payload, ...extra }, store, deps);

function setup(store = mk()) {
  hashesOf = () => store.readTable('Users').map((u) => u.PassHash).filter(Boolean);
  const r = call(store, 'setupAdmin', { name: 'Admin One', username: 'admin', password: 'pw-admin' });
  return { store, r, session: r.data.session };
}
function addStaff(store, adminSession, over = {}) {
  return call(store, 'upsertUser', { name: 'Staff', username: 'staff', password: 'pw-staff', role: 'Staff', ...over }, { session: adminSession });
}
let hashesOf = () => [];
const noHash = (o) => {
  const j = JSON.stringify(o);
  expect(j).not.toMatch(/PassHash/i);
  for (const h of hashesOf()) expect(j).not.toContain(h);
};

describe('setupAdmin', () => {
  test('creates first Admin, logs in, then refuses', () => {
    const { store, r } = setup();
    expect(r.ok).toBe(true);
    expect(r.data.user).toMatchObject({ Name: 'Admin One', Role: 'Admin' });
    expect(typeof r.data.session).toBe('string');
    noHash(r);
    const rows = store.readTable('Users');
    expect(rows).toHaveLength(1);
    expect(rows[0].Role).toBe('Admin');
    expect(rows[0].Active).toBe(true);
    expect(rows[0].PassHash).not.toContain('pw-admin');
    const again = call(store, 'setupAdmin', { name: 'X', username: 'x', password: 'pw-x' });
    expect(again).toEqual({ ok: false, error: 'already_setup' });
    expect(store.readTable('Users')).toHaveLength(1);
  });
  test('requires token and valid fields', () => {
    expect(handle({ action: 'setupAdmin', payload: {} }, mk(), deps)).toEqual({ ok: false, error: 'bad_token' });
    expect(call(mk(), 'setupAdmin', { name: 'A', username: 'a' }).ok).toBe(false);
    expect(call(mk(), 'setupAdmin', { name: '', username: 'a', password: 'p' }).ok).toBe(false);
  });
});

describe('login', () => {
  test('success returns session + safe user, no hash', () => {
    const { store } = setup();
    const r = call(store, 'login', { username: 'admin', password: 'pw-admin' });
    expect(r.ok).toBe(true);
    expect(Object.keys(r.data.user).sort()).toEqual(['Name', 'Role', 'UserID']);
    expect(typeof r.data.session).toBe('string');
    noHash(r);
    expect(JSON.stringify(r)).not.toContain(store.readTable('Users')[0].PassHash);
  });
  test('wrong password and unknown user give identical bad_login', () => {
    const { store } = setup();
    const a = call(store, 'login', { username: 'admin', password: 'nope' });
    const b = call(store, 'login', { username: 'ghost', password: 'nope' });
    expect(a).toEqual({ ok: false, error: 'bad_login' });
    expect(b).toEqual(a);
    expect(call(store, 'login', {})).toEqual({ ok: false, error: 'bad_login' });
  });
  test('inactive user rejected', () => {
    const { store, session } = setup();
    const u = addStaff(store, session).data;
    call(store, 'deactivateUser', { userId: u.UserID }, { session });
    expect(call(store, 'login', { username: 'staff', password: 'pw-staff' })).toEqual({ ok: false, error: 'inactive' });
  });
  test('login requires token', () => {
    const { store } = setup();
    expect(handle({ action: 'login', payload: { username: 'admin', password: 'pw-admin' } }, store, deps).error).toBe('bad_token');
  });
});

describe('sessions', () => {
  test('requireSession accepts valid, rejects tampered/expired/garbage', () => {
    const { store, session } = setup();
    const ok = requireSession({ session }, deps, store);
    expect(ok).toMatchObject({ Role: 'Admin' });
    expect(ok.UserID).toBeTruthy();
    const [p, sig] = session.split('.');
    const flipped = sig.slice(0, -1) + (sig.endsWith('0') ? '1' : '0');
    expect(requireSession({ session: `${p}.${flipped}` }, deps, store)).toBeNull();
    const forged = encodeURIComponent(decodeURIComponent(p).replace('Admin', 'Staff'));
    expect(requireSession({ session: `${forged}.${sig}` }, deps, store)).toBeNull();
    for (const s of [undefined, '', 'abc', '.', 42, {}]) expect(requireSession({ session: s }, deps, store)).toBeNull();
    expect(requireSession({ session }, { ...deps, sessionSecret: 'other' }, store)).toBeNull();
    expect(requireSession({ session }, { ...deps, sessionSecret: '' }, store)).toBeNull();
    const saved = clock;
    clock += 13 * 60 * 60 * 1000;
    expect(requireSession({ session }, deps, store)).toBeNull();
    clock = saved;
  });
  test('deactivated user session stops working', () => {
    const { store, session } = setup();
    const u = addStaff(store, session).data;
    const sSession = call(store, 'login', { username: 'staff', password: 'pw-staff' }).data.session;
    expect(call(store, 'updateProfile', { name: 'S2' }, { session: sSession }).ok).toBe(true);
    call(store, 'deactivateUser', { userId: u.UserID }, { session });
    expect(call(store, 'updateProfile', { name: 'S3' }, { session: sSession })).toEqual({ ok: false, error: 'forbidden' });
  });
});

describe('admin user management', () => {
  test('upsertUser as Staff -> forbidden; no session -> forbidden', () => {
    const { store, session } = setup();
    addStaff(store, session);
    const s = call(store, 'login', { username: 'staff', password: 'pw-staff' }).data.session;
    for (const action of ['upsertUser', 'listUsers', 'deactivateUser']) {
      expect(call(store, action, { name: 'Z', username: 'z', password: 'p', role: 'Admin', userId: 'x' }, { session: s })).toEqual({ ok: false, error: 'forbidden' });
      expect(call(store, action, {})).toEqual({ ok: false, error: 'forbidden' });
    }
    expect(store.readTable('Users')).toHaveLength(2);
  });
  test('Admin creates, lists (no hashes), edits and deactivates', () => {
    const { store, session } = setup();
    const c = addStaff(store, session, { contact: '999' });
    expect(c.ok).toBe(true);
    expect(c.data).toMatchObject({ Name: 'Staff', Username: 'staff', Role: 'Staff', Contact: '999', Active: true });
    noHash(c);
    const l = call(store, 'listUsers', {}, { session });
    expect(l.data).toHaveLength(2);
    noHash(l);
    for (const u of store.readTable('Users')) expect(JSON.stringify(l)).not.toContain(u.PassHash);
    const e = call(store, 'upsertUser', { userId: c.data.UserID, name: 'Staff Renamed', role: 'Staff' }, { session });
    expect(e.data.Name).toBe('Staff Renamed');
    expect(call(store, 'login', { username: 'staff', password: 'pw-staff' }).ok).toBe(true); // password kept
    const d = call(store, 'deactivateUser', { userId: c.data.UserID }, { session });
    expect(d.data.Active).toBe(false);
    noHash(d);
    expect(store.readTable('Users')).toHaveLength(2); // soft only
  });
  test('validation: duplicate username, bad role, missing password on create, self-deactivate', () => {
    const { store, session } = setup();
    expect(addStaff(store, session, { username: 'admin' })).toEqual({ ok: false, error: 'username_taken' });
    expect(addStaff(store, session, { role: 'Root' }).ok).toBe(false);
    expect(addStaff(store, session, { password: '' }).ok).toBe(false);
    const adminId = store.readTable('Users')[0].UserID;
    expect(call(store, 'deactivateUser', { userId: adminId }, { session }).ok).toBe(false);
    expect(call(store, 'deactivateUser', { userId: 'nope' }, { session }).ok).toBe(false);
  });
});

describe('updateProfile', () => {
  test('changes own name/contact only; re-hashes password when given', () => {
    const { store, session } = setup();
    addStaff(store, session);
    const s = call(store, 'login', { username: 'staff', password: 'pw-staff' }).data.session;
    const before = store.readTable('Users').find((u) => u.Username === 'staff').PassHash;
    const r = call(store, 'updateProfile', { name: 'New Name', contact: '123' }, { session: s });
    expect(r.ok).toBe(true);
    expect(r.data).toMatchObject({ Name: 'New Name', Contact: '123', Role: 'Staff' });
    noHash(r);
    expect(store.readTable('Users').find((u) => u.Username === 'staff').PassHash).toBe(before);
    const adminId = store.readTable('Users')[0].UserID;
    call(store, 'updateProfile', { name: 'Hax', role: 'Admin', userId: adminId, username: 'admin2' }, { session: s });
    const rows = store.readTable('Users');
    expect(rows[0].Name).toBe('Admin One');
    expect(rows[1]).toMatchObject({ Name: 'Hax', Role: 'Staff', Username: 'staff' });
    const p = call(store, 'updateProfile', { password: 'new-pw' }, { session: s });
    noHash(p);
    expect(store.readTable('Users')[1].PassHash).not.toBe(before);
    expect(call(store, 'login', { username: 'staff', password: 'pw-staff' }).error).toBe('bad_login');
    expect(call(store, 'login', { username: 'staff', password: 'new-pw' }).ok).toBe(true);
  });
  test('requires session', () => {
    const { store } = setup();
    expect(call(store, 'updateProfile', { name: 'x' })).toEqual({ ok: false, error: 'forbidden' });
  });
});

describe('last-admin invariant', () => {
  test('self-demote and self-deactivate via upsertUser rejected for last active Admin', () => {
    const { store, session } = setup();
    const id = store.readTable('Users')[0].UserID;
    expect(call(store, 'upsertUser', { userId: id, role: 'Staff' }, { session })).toEqual({ ok: false, error: 'last_admin' });
    expect(call(store, 'upsertUser', { userId: id, active: false }, { session })).toEqual({ ok: false, error: 'last_admin' });
    expect(store.readTable('Users')[0]).toMatchObject({ Role: 'Admin', Active: true });
  });
  test('same operations succeed when another active Admin exists', () => {
    const { store, session } = setup();
    const id = store.readTable('Users')[0].UserID;
    const a2 = addStaff(store, session, { username: 'admin2', role: 'Admin' }).data;
    expect(call(store, 'upsertUser', { userId: id, role: 'Staff' }, { session }).data.Role).toBe('Staff');
    // admin1 is now Staff; its session has no Admin rights
    const s2 = call(store, 'login', { username: 'admin2', password: 'pw-staff' }).data.session;
    expect(call(store, 'upsertUser', { userId: id, role: 'Admin' }, { session: s2 }).ok).toBe(true);
    expect(call(store, 'upsertUser', { userId: id, active: false }, { session: s2 }).data.Active).toBe(false);
    // admin2 is now the last active Admin
    expect(call(store, 'upsertUser', { userId: a2.UserID, active: false }, { session: s2 }).error).toBe('last_admin');
  });
  test('blank / odd Active counts as inactive', () => {
    const { store } = setup();
    store.appendRow('Users', { Name: 'B', Username: 'blank', PassHash: 's:x', Role: 'Staff', Active: '' });
    expect(call(store, 'login', { username: 'blank', password: 'x' }).error).toBe('bad_login');
    const salt = 'q';
    store.updateRowById('Users', 'UserID', store.readTable('Users')[1].UserID, { PassHash: salt + ':' + deps.hashFn(salt, 'x') });
    expect(call(store, 'login', { username: 'blank', password: 'x' }).error).toBe('inactive');
    store.updateRowById('Users', 'UserID', store.readTable('Users')[1].UserID, { Active: 'TRUE' });
    expect(call(store, 'login', { username: 'blank', password: 'x' }).ok).toBe(true);
  });
});

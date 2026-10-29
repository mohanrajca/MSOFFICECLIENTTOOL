import { describe, test, expect } from 'vitest';
import { TABS, handle } from '../core.js';
import { memStore } from '../store-memory.js';

const TOKEN = 'tok123';
const deps = { now: () => 0, hashFn: (s) => s, randomFn: () => 0.5, expectedToken: TOKEN };
const mk = (seed = {}) => memStore({ ...TABS, ...seed });
const call = (store, action, extra = {}) =>
  handle({ action, token: TOKEN, payload: {}, ...extra }, store, deps);

describe('TABS full column lists', () => {
  test('column typos are caught', () => {
    expect(TABS).toEqual({
      Clients: ['ClientID', 'Name', 'GSTIN', 'TradeName', 'RegType', 'State', 'Address', 'Mobile', 'Email', 'FilingFrequency', 'Status'],
      Filings: ['FilingID', 'ClientID', 'Portal', 'ReturnType', 'Period', 'FiledDate', 'AckNo', 'Status', 'FiledBy'],
      Credentials: ['CredID', 'ClientID', 'Portal', 'LoginID', 'Password', 'Notes', 'UpdatedBy', 'UpdatedOn'],
      Users: ['UserID', 'Name', 'Username', 'PassHash', 'Role', 'Contact', 'Active'],
      Visitors: ['VisitorID', 'Date', 'Category', 'VisitorCount', 'TaxAmt', 'FeesAmt', 'EnteredBy'],
      DayBalances: ['Date', 'CashBalance', 'BankBalance', 'Note'],
      Masters: ['Key', 'Value'],
    });
  });
});

describe('handle dispatch + token gate', () => {
  test('unknown action', () => {
    expect(call(mk(), 'nope')).toEqual({ ok: false, error: 'unknown_action' });
  });
  test('bad token rejected', () => {
    expect(call(mk(), 'getMasters', { token: 'wrong' })).toEqual({ ok: false, error: 'bad_token' });
    expect(call(mk(), 'getMasters', { token: undefined })).toEqual({ ok: false, error: 'bad_token' });
  });
  test('bad token is checked before unknown action', () => {
    expect(call(mk(), 'nope', { token: 'wrong' })).toEqual({ ok: false, error: 'bad_token' });
  });
  test('bootstrapStatus works without a valid token', () => {
    expect(call(mk(), 'bootstrapStatus', { token: 'wrong' })).toEqual({ ok: true, data: { needsSetup: true } });
  });
});

describe('bootstrapStatus', () => {
  test('needsSetup true when Users empty, false otherwise', () => {
    expect(call(mk(), 'bootstrapStatus').data.needsSetup).toBe(true);
    const s = mk();
    s.appendRow('Users', { Name: 'A', Username: 'a' });
    expect(call(s, 'bootstrapStatus').data.needsSetup).toBe(false);
    expect(s.readTable('Users')).toHaveLength(1);
  });
});

describe('getMasters', () => {
  test('empty tab gives empty collections', () => {
    expect(call(mk(), 'getMasters')).toEqual({ ok: true, data: { portals: [], returnTypes: {} } });
  });
  test('assembles portals and return types', () => {
    const s = mk();
    for (const [Key, Value] of [
      ['portal', 'GST'], ['portal', 'IT'],
      ['return:GST', 'GSTR-1'], ['return:GST', 'GSTR-3B'], ['return:IT', 'ITR'],
    ]) s.appendRow('Masters', { Key, Value });
    expect(call(s, 'getMasters').data).toEqual({
      portals: ['GST', 'IT'],
      returnTypes: { GST: ['GSTR-1', 'GSTR-3B'], IT: ['ITR'] },
    });
  });
});

import { describe, test, expect } from 'vitest';
import { TABS, newId } from '../core.js';
import { memStore } from '../store-memory.js';

describe('TABS / newId', () => {
  test('TABS has canonical columns with id field first', () => {
    expect(Object.keys(TABS)).toEqual(['Clients','Filings','Credentials','Users','Visitors','DayBalances','Masters']);
    expect(TABS.Clients[0]).toBe('ClientID');
    expect(TABS.DayBalances).toEqual(['Date','CashBalance','BankBalance','Note']);
    expect(globalThis.TABS).toBe(TABS);
  });
  test('newId is prefixed and collision-resistant', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newId('F')));
    expect(ids.size).toBe(500);
    expect([...ids][0].startsWith('F_')).toBe(true);
  });
  test('newId accepts an rng for determinism', () => {
    const a = newId('X', () => 0.5);
    const b = newId('X', () => 0.5);
    expect(a.split('_')[2]).toBe(b.split('_')[2]);
  });
});

describe('memStore', () => {
  test('appendRow assigns an id and returns the row', () => {
    const s = memStore({ Clients: [['ClientID', 'Name', 'GSTIN']] });
    const r = s.appendRow('Clients', { Name: 'A', GSTIN: '33AAA' });
    expect(r.ClientID).toBeTruthy();
    expect(r).toMatchObject({ Name: 'A', GSTIN: '33AAA' });
  });
  test('appendRow keeps a caller-supplied id', () => {
    const s = memStore({ Clients: [['ClientID', 'Name']] });
    expect(s.appendRow('Clients', { ClientID: 'C-001', Name: 'A' }).ClientID).toBe('C-001');
  });
  test('natural-key tables require the key', () => {
    const s = memStore({ DayBalances: TABS.DayBalances, Masters: TABS.Masters });
    expect(() => s.appendRow('DayBalances', { CashBalance: 5 })).toThrow(/Date/);
    expect(() => s.appendRow('Masters', { Value: 'x' })).toThrow(/Key/);
    expect(s.appendRow('DayBalances', { Date: '2026-01-02', CashBalance: 5 }).Date).toBe('2026-01-02');
  });
  test('readTable returns objects keyed by header (blank for missing)', () => {
    const s = memStore({ Clients: [['ClientID', 'Name', 'GSTIN']] });
    s.appendRow('Clients', { ClientID: '1', Name: 'A' });
    expect(s.readTable('Clients')).toEqual([{ ClientID: '1', Name: 'A', GSTIN: '' }]);
  });
  test('readTable returns copies, not internal state', () => {
    const s = memStore({ Clients: [['ClientID', 'Name']] });
    s.appendRow('Clients', { ClientID: '1', Name: 'A' });
    s.readTable('Clients')[0].Name = 'HACK';
    expect(s.readTable('Clients')[0].Name).toBe('A');
  });
  test('updateRowById preserves unsent fields', () => {
    const s = memStore({ Clients: [['ClientID', 'Name', 'GSTIN']] });
    const r = s.appendRow('Clients', { Name: 'A', GSTIN: '33AAA' });
    s.updateRowById('Clients', 'ClientID', r.ClientID, { Name: 'B' });
    expect(s.readTable('Clients')[0]).toMatchObject({ Name: 'B', GSTIN: '33AAA' });
  });
  test('updateRowById returns merged row, ignores unknown columns and id change, throws if missing', () => {
    const s = memStore({ Clients: [['ClientID', 'Name']] });
    s.appendRow('Clients', { ClientID: '1', Name: 'A' });
    const u = s.updateRowById('Clients', 'ClientID', '1', { Name: 'B', Bogus: 1, ClientID: '9' });
    expect(u).toEqual({ ClientID: '1', Name: 'B' });
    expect(() => s.updateRowById('Clients', 'ClientID', 'nope', {})).toThrow(/not found/i);
  });
  test('deleteRowById removes only that row', () => {
    const s = memStore({ Clients: [['ClientID', 'Name']] });
    s.appendRow('Clients', { ClientID: '1', Name: 'A' });
    s.appendRow('Clients', { ClientID: '2', Name: 'B' });
    s.deleteRowById('Clients', 'ClientID', '1');
    expect(s.readTable('Clients').map((r) => r.ClientID)).toEqual(['2']);
  });
  test('ensureTabs creates missing tabs only', () => {
    const s = memStore();
    s.ensureTabs(TABS);
    s.appendRow('Users', { Name: 'U' });
    s.ensureTabs(TABS);
    expect(s.readTable('Users')).toHaveLength(1);
    expect(s.readTable('Clients')).toEqual([]);
  });
  test('unknown tab throws', () => {
    expect(() => memStore().readTable('Nope')).toThrow(/Nope/);
  });
});

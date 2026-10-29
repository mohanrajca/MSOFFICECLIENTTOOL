import { describe, it, expect } from 'vitest';
import {
  CLIENT_HEADERS, normalizeName, clientRowToCanonical, currentPasswordMap, matchClientPassword,
} from '../sheet-mapping.js';

const row = {
  'CLIENT ID': 'C001', 'CLIENT NAME': 'Dhoni Traders', GSTIN: '33ABCDE1234F1Z5', 'Trade Name': 'Dhoni Tr',
  'Reg. Type': 'Regular', STATE: 'Tamil Nadu', ADDRESS: '1 Main St', Mobile: '9876543210',
  'EMAIL ID': 'd@x.com', 'USER NAME': 'dhoni_2025', PASSWORD: 'ignored', 'Filing Frequency': 'Monthly', Status: 'Active',
};

describe('sheet-mapping', () => {
  it('lists the CLIENT headers', () => {
    expect(CLIENT_HEADERS).toHaveLength(13);
    expect(CLIENT_HEADERS[0]).toBe('CLIENT ID');
  });
  it('maps a clean client row to canonical + gstUserName', () => {
    const c = clientRowToCanonical(row);
    expect(c).toEqual({
      ClientID: 'C001', Name: 'Dhoni Traders', GSTIN: '33ABCDE1234F1Z5', TradeName: 'Dhoni Tr', RegType: 'Regular',
      State: 'Tamil Nadu', Address: '1 Main St', Mobile: '9876543210', Email: 'd@x.com',
      FilingFrequency: 'Monthly', Status: 'Active', gstUserName: 'dhoni_2025',
    });
  });
  it('missing cells become empty strings and values are trimmed', () => {
    const c = clientRowToCanonical({ 'CLIENT ID': ' C2 ', 'CLIENT NAME': 'X ' });
    expect(c.ClientID).toBe('C2');
    expect(c.Name).toBe('X');
    expect(c.GSTIN).toBe('');
    expect(c.gstUserName).toBe('');
  });
  it('normalizeName lowercases, trims, collapses whitespace', () => {
    expect(normalizeName('  Dhoni   TRADERS ')).toBe('dhoni traders');
    expect(normalizeName(null)).toBe('');
  });
  it('builds password map, skipping blank names', () => {
    const m = currentPasswordMap([
      { CLIENT: 'Dhoni Traders ', Password: 'pw1' },
      { CLIENT: 'DHONI_2025', Password: 'pw2' },
      { CLIENT: '', Password: 'x' },
      { CLIENT: 'NoPass', Password: '' },
    ]);
    expect(m).toEqual({ 'dhoni traders': 'pw1', dhoni_2025: 'pw2', nopass: '' });
  });
  it('matches by name despite trailing spaces / case', () => {
    const m = currentPasswordMap([{ CLIENT: 'DHONI  TRADERS  ', Password: 'pw1' }]);
    expect(matchClientPassword({ Name: 'Dhoni Traders' }, '', m)).toBe('pw1');
  });
  it('matches by GST username', () => {
    const m = currentPasswordMap([{ CLIENT: 'DHONI_2025', Password: 'pw2' }]);
    expect(matchClientPassword({ Name: 'Other' }, 'dhoni_2025 ', m)).toBe('pw2');
  });
  it('returns null when unmatched', () => {
    const m = currentPasswordMap([{ CLIENT: 'A', Password: 'p' }]);
    expect(matchClientPassword({ Name: 'Zed' }, 'zed1', m)).toBeNull();
    expect(matchClientPassword({ Name: '' }, '', m)).toBeNull();
  });
  it('tolerates stray whitespace in header keys', () => {
    const c = clientRowToCanonical({ 'CLIENT ID ': 'C9', 'GSTIN ': '33AAA', 'CLIENT NAME': 'Y' });
    expect(c.ClientID).toBe('C9');
    expect(c.GSTIN).toBe('33AAA');
    const m = currentPasswordMap([{ 'CLIENT ': 'Y', 'Password ': 'pw' }]);
    expect(m).toEqual({ y: 'pw' });
  });
});

import { describe, it, expect } from 'vitest';
import { whatsappUrl, buildClientStatusMessage, filingsToExcelRows, clientsToExcelRows, visitorsToExcelRows, clientPdfModel } from '../report.js';

describe('whatsappUrl', () => {
  const want = 'https://wa.me/919876543210?text=Hi%20there';
  it.each(['98765 43210', '+91-98765-43210', '919876543210', '09876543210'])('normalises %s', (p) => {
    expect(whatsappUrl(p, 'Hi there')).toBe(want);
  });
  it('encodes the message', () => {
    expect(whatsappUrl('9876543210', 'a&b\nc')).toBe('https://wa.me/919876543210?text=a%26b%0Ac');
  });
  it.each(['', '12345', null, undefined, '98765432101234'])('returns null for %s', (p) => {
    expect(whatsappUrl(p, 'x')).toBeNull();
  });
});

const client = { ClientID: 'C1', Name: 'Acme Traders', Mobile: '9876543210' };
const filings = [
  { ClientID: 'C1', ReturnType: 'GSTR-3B', Period: '2026-09', Status: 'Filed', AckNo: 'AB123', FiledDate: '2026-10-18T00:00:00.000Z', DueDate: '2026-10-20' },
  { ClientID: 'C1', ReturnType: 'GSTR-1', Period: '2026-10', Status: 'Pending', AckNo: '', FiledDate: '', DueDate: '2026-11-11' },
  { ClientID: 'C1', ReturnType: 'ITR-3', Period: 'FY 2025-26', Status: 'Pending', DueDate: '' },
  { ClientID: 'C2', ReturnType: 'OTHER', Period: 'x', Status: 'Pending' },
];

describe('buildClientStatusMessage', () => {
  const m = buildClientStatusMessage(client, filings);
  it('greets, lists filed with ack and pending with due', () => {
    expect(m).toContain('Acme Traders');
    expect(m).toContain('GSTR-3B 2026-09 — Ack AB123, 2026-10-18');
    expect(m).toContain('GSTR-1 2026-10 — due 2026-11-11');
    expect(m).toContain('ITR-3 FY 2025-26 — due —');
    expect(m).toMatch(/MS Associates\s*$/);
    expect(m).not.toContain('OTHER');
  });
  it('never prints undefined', () => {
    expect(m).not.toContain('undefined');
    const m2 = buildClientStatusMessage(client, [{ ClientID: 'C1', ReturnType: 'X', Period: 'P', Status: 'Filed' }]);
    expect(m2).toContain('X P — Ack —, —');
    expect(m2).not.toContain('undefined');
  });
  it('handles empty sections', () => {
    const m3 = buildClientStatusMessage(client, []);
    expect(m3).toContain('Filed');
    expect(m3).toContain('Pending');
    expect(m3).not.toContain('undefined');
  });
});

describe('excel/pdf models', () => {
  it('filingsToExcelRows maps client names and blanks', () => {
    const rows = filingsToExcelRows(filings, [client]);
    expect(rows[0]).toEqual({ Client: 'Acme Traders', Portal: '', 'Return': 'GSTR-3B', Period: '2026-09', 'Due date': '2026-10-20', 'Filed date': '2026-10-18', 'Ack no.': 'AB123', Status: 'Filed' });
    expect(rows[3].Client).toBe('C2');
  });
  it('clientsToExcelRows', () => {
    expect(clientsToExcelRows([{ Name: 'A', GSTIN: 'G', Mobile: '1', Email: 'e' }])[0]).toMatchObject({ Name: 'A', GSTIN: 'G', Mobile: '1', Email: 'e', State: '' });
  });
  it('visitorsToExcelRows', () => {
    const r = visitorsToExcelRows([{ Date: '2026-10-01', Category: 'GST', VisitorCount: 2, TaxAmt: 10, FeesAmt: 5 }])[0];
    expect(r).toEqual({ Date: '2026-10-01', Category: 'GST', Visitors: 2, 'Tax (₹)': 10, 'Fees (₹)': 5 });
  });
  it('clientPdfModel has title, filed and pending tables with dashes', () => {
    const p = clientPdfModel(client, filings);
    expect(p.title).toBe('Filing status — Acme Traders');
    expect(p.filed.rows).toEqual([['GSTR-3B', '2026-09', '2026-10-18', 'AB123']]);
    expect(p.pending.rows).toEqual([['GSTR-1', '2026-10', '2026-11-11'], ['ITR-3', 'FY 2025-26', '—']]);
    expect(p.fileName).toBe('Acme_Traders_filing_status.pdf');
  });
});

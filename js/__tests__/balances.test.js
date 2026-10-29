import { describe, it, expect } from 'vitest';
import { computeDayBalance, prevCloseFor, categoryTotals, grandTotals, CATEGORIES } from '../balances.js';

describe('computeDayBalance', () => {
  it('opening = prevClose; closing = opening + receipts - outflows', () => {
    expect(computeDayBalance({ prevClose: 1000, cashReceipts: 500, cashOutflows: 200 })).toEqual({ opening: 1000, closing: 1300 });
  });
  it('override wins over the computed value (including 0)', () => {
    expect(computeDayBalance({ prevClose: 1000, cashReceipts: 500, override: 1234 }).closing).toBe(1234);
    expect(computeDayBalance({ prevClose: 1000, cashReceipts: 500, override: 0 }).closing).toBe(0);
  });
  it('blank / missing / junk inputs are 0, never NaN', () => {
    for (const args of [undefined, {}, { prevClose: '', cashReceipts: null, cashOutflows: undefined, override: '' }, { prevClose: 'abc', cashReceipts: NaN }]) {
      expect(computeDayBalance(args)).toEqual({ opening: 0, closing: 0 });
    }
    expect(computeDayBalance({ prevClose: '100', cashReceipts: '50' }).closing).toBe(150);
    expect(computeDayBalance({ prevClose: 10, override: NaN }).closing).toBe(10);
    expect(computeDayBalance({ prevClose: 10, cashReceipts: 5, override: '   ' }).closing).toBe(15);
  });
  it('carries forward across several days', () => {
    let prev = 0; const closes = [];
    for (const r of [300, 200, 0, 150]) { const d = computeDayBalance({ prevClose: prev, cashReceipts: r }); closes.push(d.closing); prev = d.closing; }
    expect(closes).toEqual([300, 500, 500, 650]);
  });
});

describe('prevCloseFor', () => {
  const rows = [
    { Date: '2026-10-03', CashBalance: 300 },
    { Date: '2026-10-01', CashBalance: 100 },
    { Date: '2026-10-05', CashBalance: 900 },
  ];
  it('uses the most recent row strictly before the date', () => {
    expect(prevCloseFor('2026-10-04', rows)).toBe(300);
    expect(prevCloseFor('2026-10-03', rows)).toBe(100);
    expect(prevCloseFor('2026-12-01', rows)).toBe(900);
  });
  it('no prior record -> 0, not NaN', () => {
    expect(prevCloseFor('2026-09-30', rows)).toBe(0);
    expect(prevCloseFor('2026-10-01', rows)).toBe(0);
    expect(prevCloseFor('2026-10-01', [])).toBe(0);
    expect(prevCloseFor('2026-10-01', undefined)).toBe(0);
  });
  it('blank CashBalance on a prior row -> 0; tolerates ISO datetime dates', () => {
    expect(prevCloseFor('2026-10-02', [{ Date: '2026-10-01', CashBalance: '' }])).toBe(0);
    expect(prevCloseFor('2026-10-02', [{ Date: '2026-10-01T00:00:00.000Z', CashBalance: '75' }])).toBe(75);
  });
});

describe('category totals', () => {
  const rows = [
    { Category: 'Income Tax', VisitorCount: 3, TaxAmt: 1000, FeesAmt: 500 },
    { Category: 'GST', VisitorCount: '2', TaxAmt: '', FeesAmt: 700 },
    { Category: 'Income Tax', VisitorCount: 1, TaxAmt: 200, FeesAmt: 100 },
    { Category: 'Accounts', VisitorCount: undefined, TaxAmt: null, FeesAmt: 50 },
  ];
  it('sums per category (IT/GST/Accounts), blanks as 0', () => {
    expect(CATEGORIES).toEqual(['Income Tax', 'GST', 'Accounts']);
    const t = categoryTotals(rows);
    expect(t['Income Tax']).toEqual({ count: 4, tax: 1200, fees: 600 });
    expect(t.GST).toEqual({ count: 2, tax: 0, fees: 700 });
    expect(t.Accounts).toEqual({ count: 0, tax: 0, fees: 50 });
  });
  it('grand totals across all categories', () => {
    expect(grandTotals(rows)).toEqual({ count: 6, tax: 1200, fees: 1350 });
    expect(grandTotals([])).toEqual({ count: 0, tax: 0, fees: 0 });
  });
});

import { describe, test, expect } from 'vitest';
import { filingBreakdown, monthlyFilingSeries, dueThisWeek, clientFilingSummary } from '../aggregate.js';

const F = [
  { FilingID: 'f1', ClientID: 'c1', Portal: 'Income Tax', Status: 'Filed', FiledDate: '2026-10-05', DueDate: '2026-10-31' },
  { FilingID: 'f2', ClientID: 'c1', Portal: 'GST', Status: 'Filed', FiledDate: '2026-10-11', DueDate: '2026-10-11' },
  { FilingID: 'f3', ClientID: 'c2', Portal: 'GST', Status: 'Filed', FiledDate: '2026-09-20', DueDate: '2026-09-20' },
  { FilingID: 'f4', ClientID: 'c2', Portal: 'MCA', Status: 'Filed', FiledDate: '2026-08-30' },
  { FilingID: 'f5', ClientID: 'c2', Portal: 'TRACES', Status: 'Pending', FiledDate: '', AckNo: '', DueDate: '2026-11-03' },
  { FilingID: 'f6', ClientID: 'c1', Portal: '', Status: 'Pending' },
];

describe('filingBreakdown', () => {
  test('buckets by portal, unknown/blank -> Others', () => {
    expect(filingBreakdown(F)).toEqual({ IT: 1, GST: 2, MCA: 1, Others: 2 });
  });
  test('empty/undefined input', () => {
    expect(filingBreakdown([])).toEqual({ IT: 0, GST: 0, MCA: 0, Others: 0 });
    expect(filingBreakdown(undefined)).toEqual({ IT: 0, GST: 0, MCA: 0, Others: 0 });
  });
});

describe('monthlyFilingSeries', () => {
  test('last N months ending at the latest month, keyed by FiledDate, pending excluded', () => {
    const s = monthlyFilingSeries(F, 3, '2026-10-15');
    expect(s).toEqual([
      { month: '2026-08', IT: 0, GST: 0, MCA: 1 },
      { month: '2026-09', IT: 0, GST: 1, MCA: 0 },
      { month: '2026-10', IT: 1, GST: 1, MCA: 0 },
    ]);
  });
  test('crosses year boundary', () => {
    const s = monthlyFilingSeries([], 3, '2026-01-10');
    expect(s.map((x) => x.month)).toEqual(['2025-11', '2025-12', '2026-01']);
  });
  test('pending filing with no FiledDate never produces NaN/undefined', () => {
    const s = monthlyFilingSeries(F, 6, '2026-10-15');
    expect(JSON.stringify(s)).not.toMatch(/NaN|undefined|null/);
  });
});

describe('dueThisWeek', () => {
  const mk = (id, due, status = 'Pending') => ({ FilingID: id, DueDate: due, Status: status });
  test('inclusive today..today+7; excludes +8, yesterday, filed, blank due', () => {
    const rows = [mk('y', '2026-10-14'), mk('t', '2026-10-15'), mk('m', '2026-10-18'), mk('e', '2026-10-22'),
      mk('x', '2026-10-23'), mk('filed', '2026-10-16', 'Filed'), mk('blank', ''), { FilingID: 'nodue', Status: 'Pending' }];
    expect(dueThisWeek(rows, '2026-10-15').map((r) => r.FilingID)).toEqual(['t', 'm', 'e']);
  });
  test('month rollover', () => {
    expect(dueThisWeek([mk('a', '2026-11-03')], '2026-10-29')).toHaveLength(1);
    expect(dueThisWeek([mk('a', '2026-11-06')], '2026-10-29')).toHaveLength(0);
  });
});

describe('clientFilingSummary', () => {
  test('filed vs pending per client; blank ack/date is pending', () => {
    const s = clientFilingSummary(F, 'c2');
    expect(s.filed.map((r) => r.FilingID).sort()).toEqual(['f3', 'f4']);
    expect(s.pending.map((r) => r.FilingID)).toEqual(['f5']);
    expect(clientFilingSummary(F, 'zz')).toEqual({ filed: [], pending: [] });
  });
});

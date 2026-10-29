// Pure helpers for the visitor note + carry-forward cash balances. No DOM, no API.
export const CATEGORIES = ['Income Tax', 'GST', 'Accounts'];

// Blank / missing / junk -> 0 (never NaN).
export function num(v) {
  if (v === '' || v == null) return 0;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

const isNum = (v) => {
  if (v == null) return false;
  if (typeof v === 'number') return Number.isFinite(v);
  const t = String(v).replace(/,/g, '').trim();
  return t !== '' && Number.isFinite(Number(t));
};
const day = (d) => String(d == null ? '' : d).slice(0, 10);

export function computeDayBalance({ prevClose, cashReceipts, cashOutflows, override } = {}) {
  const opening = num(prevClose);
  const closing = isNum(override) ? num(override) : opening + num(cashReceipts) - num(cashOutflows);
  return { opening, closing };
}

// CashBalance of the latest row dated strictly before `date`; 0 if none.
export function prevCloseFor(date, balances) {
  const d = day(date);
  let best = null;
  for (const r of balances || []) {
    const rd = day(r && r.Date);
    if (rd && rd < d && (best === null || rd > day(best.Date))) best = r;
  }
  return best ? num(best.CashBalance) : 0;
}

export function categoryTotals(rows) {
  const out = {};
  for (const c of CATEGORIES) out[c] = { count: 0, tax: 0, fees: 0 };
  for (const r of rows || []) {
    const t = out[r && r.Category];
    if (!t) continue;
    t.count += num(r.VisitorCount); t.tax += num(r.TaxAmt); t.fees += num(r.FeesAmt);
  }
  return out;
}

export function grandTotals(rows) {
  const g = { count: 0, tax: 0, fees: 0 };
  for (const t of Object.values(categoryTotals(rows))) { g.count += t.count; g.tax += t.tax; g.fees += t.fees; }
  return g;
}

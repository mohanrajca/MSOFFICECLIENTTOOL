// Pure filing aggregation (no DOM, Node-testable). Dates are ISO strings (YYYY-MM-DD).
const s = (v) => (v === undefined || v === null ? '' : String(v));
const day = (v) => s(v).slice(0, 10);
const isFiled = (f) => s(f && f.Status).trim().toLowerCase() === 'filed';

export function portalBucket(portal) {
  const p = s(portal).trim().toLowerCase();
  if (p === 'income tax' || p === 'it') return 'IT';
  if (p === 'gst') return 'GST';
  if (p === 'mca') return 'MCA';
  return 'Others';
}

export function filingBreakdown(filings) {
  const out = { IT: 0, GST: 0, MCA: 0, Others: 0 };
  for (const f of filings || []) out[portalBucket(f.Portal)] += 1;
  return out;
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Last `months` months ending at the month of `today` (default: now), oldest first.
// Only filings with a FiledDate are counted; pending ones are excluded.
export function monthlyFilingSeries(filings, months, today = todayISO()) {
  const [y, m] = day(today).split('-').map(Number);
  const series = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    series.push({ month: d.toISOString().slice(0, 7), IT: 0, GST: 0, MCA: 0 });
  }
  const byMonth = new Map(series.map((r) => [r.month, r]));
  for (const f of filings || []) {
    const fd = day(f.FiledDate);
    if (!fd) continue;
    const row = byMonth.get(fd.slice(0, 7));
    const b = portalBucket(f.Portal);
    if (row && b !== 'Others') row[b] += 1;
  }
  return series;
}

export function addDaysISO(iso, n) {
  const [y, m, d] = day(iso).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// Not filed, with a DueDate in [today, today+7] inclusive.
export function dueThisWeek(filings, today) {
  const from = day(today); const to = addDaysISO(from, 7);
  return (filings || []).filter((f) => {
    const due = day(f.DueDate);
    return !isFiled(f) && due !== '' && due >= from && due <= to;
  });
}

export function clientFilingSummary(filings, clientId) {
  const out = { filed: [], pending: [] };
  for (const f of filings || []) {
    if (s(f.ClientID) !== s(clientId)) continue;
    (isFiled(f) ? out.filed : out.pending).push(f);
  }
  return out;
}

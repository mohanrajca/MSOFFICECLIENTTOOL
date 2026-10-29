// Home dashboard: KPI tiles, filing donut + monthly stacked bars (Chart.js), client-wise table,
// due this week, and today's visitor totals + latest cash/bank. Aggregation lives in ../aggregate.js.
import { apiCall, apiError } from '../api.js';
import { registerView } from '../router.js';
import { esc, todayISO, day } from '../dom.js';
import { num, grandTotals } from '../balances.js';
import { filingBreakdown, monthlyFilingSeries, dueThisWeek, clientFilingSummary } from '../aggregate.js';

const COLORS = { IT: '#4f46e5', GST: '#059669', MCA: '#d97706', Others: '#0891b2' };
const inr = (n) => '₹' + num(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const int = (n) => Math.round(num(n)).toLocaleString('en-IN');
const dash = (x) => (day(x) === '' ? '—' : esc(day(x)));

let charts = [];
let gen = 0;
const arr = (x) => (Array.isArray(x) ? x : []);
function destroyCharts() {
  charts.forEach((c) => { try { c.destroy(); } catch (e) { /* already gone */ } });
  charts = [];
}

export async function renderDashboard(container) {
  destroyCharts();
  const my = ++gen;
  const today = todayISO(); const month = today.slice(0, 7);
  container.innerHTML = '<div class="card"><p class="muted">Loading dashboard…</p></div>';
  let clients, filings, monthVis, todayVis, bals;
  try {
    [clients, filings, monthVis, todayVis, bals] = await Promise.all([
      apiCall('listClients', {}), apiCall('listFilings', {}), apiCall('listVisitors', { month }),
      apiCall('listVisitors', { date: today }), apiCall('listBalances', {})]);
  } catch (e) {
    if (container.isConnected) container.innerHTML = `<div class="card"><div class="form-error" role="alert">${esc(apiError(e))}</div></div>`;
    return;
  }
  if (!container.isConnected || my !== gen) return; // navigated away / superseded while loading
  clients = arr(clients); filings = arr(filings);
  monthVis = arr(monthVis).filter((r) => day(r.Date).startsWith(month));
  todayVis = arr(todayVis).filter((r) => day(r.Date) === today);
  const latestBal = arr(bals).slice().sort((a, b) => day(b.Date).localeCompare(day(a.Date)))[0];

  const filedThisMonth = filings.filter((f) => day(f.FiledDate).startsWith(month)).length;
  const pending = filings.filter((f) => String(f.Status || '').toLowerCase() !== 'filed').length;
  const due = dueThisWeek(filings, today);
  const mv = grandTotals(monthVis); const tv = grandTotals(todayVis);
  const bd = filingBreakdown(filings);
  const series = monthlyFilingSeries(filings, 6, today);
  const clientName = (id) => { const c = clients.find((x) => String(x.ClientID) === String(id)); return c ? c.Name : id; };

  const rows = clients.map((c) => {
    const s = clientFilingSummary(filings, c.ClientID);
    const last = s.filed.map((f) => day(f.FiledDate)).filter(Boolean).sort().pop() || '';
    return `<tr><td>${esc(c.Name)}</td><td>${s.filed.length}</td><td>${s.pending.length}</td><td>${dash(last)}</td></tr>`;
  }).join('');

  const tile = (cls, label, value, sub, id) => `<div class="kpi ${cls}"><span>${label}</span><strong id="${id}">${value}</strong><small class="muted">${sub}</small></div>`;
  container.innerHTML = `<h2 class="dash-title">Dashboard</h2><p class="muted dash-sub">The breakdown donut counts all logged filings (filed and pending); the monthly bars count only filings filed in each month.</p><div class="dash-grid"><div class="dash-main">
      <div class="kpis">
        ${tile('k-it', 'Total clients', int(clients.length), 'on the master list', 'kpi-clients')}
        ${tile('k-gst', 'Filings this month', int(filedThisMonth), esc(month), 'kpi-filed')}
        ${tile('k-mca', 'Pending / due', int(pending), `${int(due.length)} due this week`, 'kpi-pending')}
        ${tile('k-others', 'Collections this month', inr(mv.tax + mv.fees), 'tax + fees', 'kpi-collect')}
      </div>
      <div class="dash-charts">
        <div class="card"><h3>Filing breakdown</h3><div class="chart-box"><canvas id="ch-donut" aria-label="Filing breakdown by portal" role="img"></canvas></div>
          <ul class="legend" id="bd-legend">${Object.keys(COLORS).map((k) => `<li><i style="background:${COLORS[k]}"></i>${k} <b id="bd-${k}">${bd[k]}</b></li>`).join('')}</ul></div>
        <div class="card"><h3>Filings per month</h3><div class="chart-box"><canvas id="ch-bars" aria-label="Filings per month" role="img"></canvas></div></div>
      </div>
      <div class="card"><h3>Client-wise filings</h3><table class="vault-table" id="client-table"><thead><tr><th>Client</th><th>Filed</th><th>Pending</th><th>Last filing</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="4" class="muted">No clients yet.</td></tr>'}</tbody></table></div>
      <div class="card"><h3>Due this week</h3><ul class="due-list" id="due-list">${due.map((f) => `<li><strong>${esc(clientName(f.ClientID))}</strong> — ${esc(f.ReturnType)} ${esc(f.Period)} <span class="muted">due ${esc(day(f.DueDate))}</span></li>`).join('') || '<li class="muted">Nothing due in the next 7 days.</li>'}</ul></div>
    </div>
    <aside class="dash-side">
      <div class="card"><h3>Today's visitors</h3><div class="tiles">
        <div class="tile"><span>Visitors</span><strong id="td-count">${int(tv.count)}</strong></div>
        <div class="tile"><span>Tax</span><strong id="td-tax">${inr(tv.tax)}</strong></div>
        <div class="tile"><span>Fees</span><strong id="td-fees">${inr(tv.fees)}</strong></div></div></div>
      <div class="card"><h3>Cash &amp; Bank</h3><dl class="cash-lines">
        <dt>Cash</dt><dd id="d-cash">${latestBal ? inr(latestBal.CashBalance) : '—'}</dd>
        <dt>Bank</dt><dd id="d-bank">${latestBal && latestBal.BankBalance !== '' && latestBal.BankBalance != null ? inr(latestBal.BankBalance) : '—'}</dd></dl>
        <p class="muted">${latestBal ? 'As of ' + esc(day(latestBal.Date)) : 'No balances recorded yet.'}</p></div>
    </aside></div>`;

  const Chart = typeof window !== 'undefined' ? window.Chart : undefined;
  if (!Chart) {
    container.querySelectorAll('.chart-box').forEach((b) => { b.innerHTML = '<p class="muted">Charts unavailable (Chart.js not loaded).</p>'; });
    return;
  }
  const keys = ['IT', 'GST', 'MCA', 'Others'];
  charts.push(new Chart(container.querySelector('#ch-donut'), {
    type: 'doughnut',
    data: { labels: keys, datasets: [{ data: keys.map((k) => bd[k]), backgroundColor: keys.map((k) => COLORS[k]) }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } },
  }));
  charts.push(new Chart(container.querySelector('#ch-bars'), {
    type: 'bar',
    data: {
      labels: series.map((s) => s.month),
      datasets: ['IT', 'GST', 'MCA'].map((k) => ({ label: k, data: series.map((s) => s[k]), backgroundColor: COLORS[k] })),
    },
    options: { responsive: true, maintainAspectRatio: false, scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } } },
  }));
}

registerView('#/dashboard', renderDashboard);

// Visitor note: daily footfall + collections per category, with carry-forward cash/bank
// balances, plus a month summary. Maths lives in ../balances.js (pure).
import { apiCall, apiError } from '../api.js';
import { registerView } from '../router.js';
import { esc, todayISO, day as dayOf } from '../dom.js';
import { CATEGORIES, num, computeDayBalance, prevCloseFor, grandTotals } from '../balances.js';

const CAT_CLASS = { 'Income Tax': 'it', GST: 'gst', Accounts: 'acc' };

export const inr = (n) => '₹' + num(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const int = (n) => Math.round(num(n)).toLocaleString('en-IN');

function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const loadBalances = (before) => apiCall('listBalances', before ? { before } : {});

export function renderVisitors(container) {
  const st = { tab: 'day', date: todayISO(), month: todayISO().slice(0, 7) };
  container.innerHTML = `<div class="card vis-head"><div><h2>Visitor Note</h2>
      <p class="muted">Daily footfall, collections and cash &amp; bank balances.</p></div>
      <div class="seg" role="tablist"><button type="button" class="btn active" data-tab="day">Day</button>
      <button type="button" class="btn" data-tab="month">Month</button></div></div>
    <div id="vis-body"></div>`;
  const body = container.querySelector('#vis-body');
  const show = () => (st.tab === 'day' ? renderDay(body, st) : renderMonth(body, st));
  container.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    st.tab = b.dataset.tab;
    container.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('active', x === b));
    show();
  }));
  show();
}

const errBox = (e) => `<div class="card"><div class="form-error" role="alert">${esc(apiError(e))}</div></div>`;

async function renderDay(body, st) {
  body.innerHTML = '<div class="card"><p class="muted">Loading…</p></div>';
  const date = st.date;
  let rows, existing, prior;
  try {
    [rows, existing, prior] = await Promise.all([
      apiCall('listVisitors', { date }), apiCall('getDayBalance', { date }), loadBalances(date)]);
  } catch (e) { body.innerHTML = errBox(e); return; }
  if (st.date !== date || st.tab !== 'day') return; // user moved on while loading
  rows = (rows || []).filter((r) => dayOf(r.Date) === date);
  const ids = {}; const byCat = {};
  rows.forEach((r) => { ids[r.Category] = r.VisitorID; byCat[r.Category] = r; });
  const prevClose = prevCloseFor(date, prior || []);
  const val = (c, k) => (byCat[c] && byCat[c][k] !== '' && byCat[c][k] != null ? num(byCat[c][k]) : '');

  const catCard = (c) => `<div class="card vis-cat ${CAT_CLASS[c]}" data-cat="${esc(c)}">
      <h3>${esc(c)}</h3>
      <div class="vis-fields">
        <label class="field"><span>Visitors</span><input name="count" type="number" min="0" step="1" value="${val(c, 'VisitorCount')}"></label>
        <label class="field"><span>Tax amount (₹)</span><input name="tax" type="number" min="0" step="0.01" value="${val(c, 'TaxAmt')}"></label>
        <label class="field"><span>Fees (₹)</span><input name="fees" type="number" min="0" step="0.01" value="${val(c, 'FeesAmt')}"></label>
      </div>
      <div class="vis-actions"><button type="button" class="btn" data-save="${esc(c)}" aria-label="Save ${esc(c)}">Save</button>
      <span class="muted vis-msg" data-msg></span></div></div>`;

  body.innerHTML = `<div class="card vis-datebar"><label class="field"><span>Date</span><input id="vis-date" type="date" value="${esc(date)}"></label></div>
    <div class="vis-grid"><div class="vis-left">${CATEGORIES.map(catCard).join('')}
      <div class="card vis-total"><h3>All visitors</h3><div class="tiles">
        <div class="tile"><span>Visitors</span><strong id="t-count">0</strong></div>
        <div class="tile"><span>Tax</span><strong id="t-tax">₹0</strong></div>
        <div class="tile"><span>Fees</span><strong id="t-fees">₹0</strong></div></div></div></div>
    <div class="card vis-cash"><h3>Cash &amp; Bank</h3>
      <dl class="cash-lines"><dt>Opening cash</dt><dd id="c-open">₹0</dd>
      <dt>Cash receipts <small class="muted">(tax + fees)</small></dt><dd id="c-rec">₹0</dd>
      <dt>Closing cash</dt><dd id="c-close" class="strong">₹0</dd></dl>
      <label class="field"><span>Counted cash (override, optional)</span><input name="override" type="number" step="0.01"></label>
      <label class="field"><span>Bank balance (₹)</span><input name="bank" type="number" step="0.01"></label>
      <label class="field"><span>Note</span><input name="note" type="text"></label>
      <div class="vis-actions"><button type="button" class="btn primary" id="save-bal">Save balances</button><span class="muted vis-msg" id="bal-msg"></span></div></div></div>`;

  const $ = (s) => body.querySelector(s);
  const catVals = (c) => {
    const el = body.querySelector(`[data-cat="${c}"]`);
    return { VisitorCount: Math.max(0, Math.round(num(el.querySelector('[name=count]').value))), TaxAmt: num(el.querySelector('[name=tax]').value), FeesAmt: num(el.querySelector('[name=fees]').value) };
  };
  const liveRows = () => CATEGORIES.map((c) => ({ Category: c, ...catVals(c) }));
  const calc = () => {
    const g = grandTotals(liveRows());
    return { g, ...computeDayBalance({ prevClose, cashReceipts: g.tax + g.fees, override: $('[name=override]').value }) };
  };
  const refresh = () => {
    const { g, opening, closing } = calc();
    $('#t-count').textContent = int(g.count); $('#t-tax').textContent = inr(g.tax); $('#t-fees').textContent = inr(g.fees);
    $('#c-open').textContent = inr(opening); $('#c-rec').textContent = inr(g.tax + g.fees); $('#c-close').textContent = inr(closing);
  };

  // Prefill balance fields: a saved cash figure counts as an override only if it differs from the computed one.
  const savedTotals = grandTotals(rows);
  const savedComputed = computeDayBalance({ prevClose, cashReceipts: savedTotals.tax + savedTotals.fees }).closing;
  if (existing) {
    if (num(existing.CashBalance) !== savedComputed) $('[name=override]').value = num(existing.CashBalance);
    if (existing.BankBalance !== '' && existing.BankBalance != null) $('[name=bank]').value = num(existing.BankBalance);
    $('[name=note]').value = existing.Note || '';
  }
  let storedCash = existing ? num(existing.CashBalance) : null;
  body.querySelectorAll('input[type=number]').forEach((i) => i.addEventListener('input', refresh));
  refresh();

  $('#vis-date').addEventListener('change', (e) => { if (e.target.value) { st.date = e.target.value; renderDay(body, st); } });

  body.querySelectorAll('[data-save]').forEach((btn) => btn.addEventListener('click', async () => {
    const c = btn.dataset.save; const msg = btn.parentElement.querySelector('[data-msg]');
    btn.disabled = true; msg.textContent = 'Saving…';
    try {
      const payload = { Date: date, Category: c, ...catVals(c) };
      if (ids[c]) payload.VisitorID = ids[c];
      const saved = await apiCall('upsertVisitor', payload);
      if (saved && saved.VisitorID) ids[c] = saved.VisitorID;
      const cEl = body.querySelector(`[data-cat="${c}"]`);
      cEl.querySelector('[name=count]').value = payload.VisitorCount;
      refresh();
      msg.textContent = 'Saved';
      if (storedCash !== null && calc().closing !== storedCash) $('#bal-msg').textContent = 'Totals changed: Save balances to update';
    } catch (e) { msg.textContent = apiError(e); }
    btn.disabled = false;
  }));

  $('#save-bal').addEventListener('click', async () => {
    const btn = $('#save-bal'); const msg = $('#bal-msg');
    btn.disabled = true; msg.textContent = 'Saving…';
    try {
      const closing = calc().closing;
      await apiCall('setDayBalance', { Date: date, CashBalance: closing, BankBalance: $('[name=bank]').value.trim() === '' ? '' : num($('[name=bank]').value), Note: $('[name=note]').value.trim() });
      storedCash = closing;
      msg.textContent = 'Saved';
    } catch (e) { msg.textContent = apiError(e); }
    btn.disabled = false;
  });
}

async function renderMonth(body, st) {
  body.innerHTML = '<div class="card"><p class="muted">Loading…</p></div>';
  const month = st.month;
  let rows, bals;
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  try {
    [rows, bals] = await Promise.all([apiCall('listVisitors', { month }), loadBalances()]);
  } catch (e) { body.innerHTML = errBox(e); return; }
  if (st.month !== month || st.tab !== 'month') return;
  rows = (rows || []).filter((r) => dayOf(r.Date).startsWith(month));
  const days = [...new Set(rows.map((r) => dayOf(r.Date)))].sort();
  const latest = (bals || []).filter((r) => dayOf(r.Date) <= last).sort((a, b) => dayOf(b.Date).localeCompare(dayOf(a.Date)))[0];
  const tr = days.map((d) => {
    const g = grandTotals(rows.filter((r) => dayOf(r.Date) === d));
    return `<tr data-day="${esc(d)}"><td>${esc(d)}</td><td>${int(g.count)}</td><td>${inr(g.tax)}</td><td>${inr(g.fees)}</td></tr>`;
  }).join('');
  const mt = grandTotals(rows);
  body.innerHTML = `<div class="card vis-datebar"><label class="field"><span>Month</span><input id="vis-month" type="month" value="${esc(month)}"></label></div>
    <div class="card vis-total"><div class="tiles">
      <div class="tile"><span>Visitors</span><strong id="m-count">${int(mt.count)}</strong></div>
      <div class="tile"><span>Tax</span><strong id="m-tax">${inr(mt.tax)}</strong></div>
      <div class="tile"><span>Fees</span><strong id="m-fees">${inr(mt.fees)}</strong></div>
      <div class="tile"><span>Cash balance</span><strong id="m-cash">${latest ? inr(latest.CashBalance) : '—'}</strong></div>
      <div class="tile"><span>Bank balance</span><strong id="m-bank">${latest && latest.BankBalance !== '' && latest.BankBalance != null ? inr(latest.BankBalance) : '—'}</strong></div></div>
      ${latest ? `<p class="muted">Latest recorded balances: ${esc(dayOf(latest.Date))}</p>` : '<p class="muted">No balances recorded yet.</p>'}</div>
    <div class="card vis-total"><table class="vault-table vis-table"><thead><tr><th>Date</th><th>Visitors</th><th>Tax</th><th>Fees</th></tr></thead>
      <tbody>${tr || '<tr><td colspan="4" class="muted">No visitor entries for this month.</td></tr>'}</tbody>
      <tfoot><tr><th>Month total</th><th>${int(mt.count)}</th><th>${inr(mt.tax)}</th><th>${inr(mt.fees)}</th></tr></tfoot></table></div>`;
  body.querySelector('#vis-month').addEventListener('change', (e) => { if (e.target.value) { st.month = e.target.value; renderMonth(body, st); } });
}

registerView('#/visitors', renderVisitors);

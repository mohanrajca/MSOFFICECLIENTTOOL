// Filings: log / list / edit / delete. Portal + return types come from Masters, with a built-in fallback.
import { apiCall, apiError } from '../api.js';
import { registerView } from '../router.js';
import { esc } from '../dom.js';

export const DEFAULT_MASTERS = {
  portals: ['Income Tax', 'GST', 'MCA', 'TRACES', 'PF/ESI', 'Professional Tax', 'Other'],
  returnTypes: {
    'Income Tax': ['ITR-1', 'ITR-3', 'ITR-4', 'TDS 24Q', 'TDS 26Q', 'TDS 27Q', 'Advance Tax'],
    GST: ['GSTR-1', 'GSTR-3B', 'GSTR-9', 'GSTR-9C', 'CMP-08'],
    MCA: ['AOC-4', 'MGT-7', 'ADT-1', 'DIR-3 KYC', 'INC-20A', 'DPT-3'],
    TRACES: ['TRACES'], 'PF/ESI': ['PF/ESI'], 'Professional Tax': ['Professional Tax'], Other: ['Other'],
  },
};

export function resolveMasters(m) {
  if (m && Array.isArray(m.portals) && m.portals.length) return { portals: m.portals, returnTypes: m.returnTypes || {} };
  return DEFAULT_MASTERS;
}

const v = (x) => (x === undefined || x === null ? '' : String(x));
const day = (x) => v(x).slice(0, 10);

export function renderFilings(container) {
  const st = { clients: [], filings: [], masters: DEFAULT_MASTERS, filter: '', editing: null };
  container.innerHTML = `<div class="card vis-head"><div><h2>Filings</h2><p class="muted">Log returns filed or pending for clients.</p></div>
      <button type="button" class="btn primary" id="fl-add">Log filing</button></div>
    <div id="fl-form"></div>
    <div class="card list-card"><label class="field"><span>Client</span><select id="fl-filter"><option value="">All clients</option></select></label>
      <div id="fl-list"><p class="muted">Loading…</p></div></div>`;
  const $ = (s) => container.querySelector(s);
  const clientName = (id) => { const c = st.clients.find((x) => String(x.ClientID) === String(id)); return c ? v(c.Name) : v(id); };

  const drawList = () => {
    const rows = st.filings.filter((f) => !st.filter || String(f.ClientID) === st.filter);
    $('#fl-list').innerHTML = `<table class="vault-table"><thead><tr><th>Client</th><th>Portal</th><th>Return</th><th>Period</th><th>Due</th><th>Filed</th><th>Ack no.</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows.map((f) => `<tr data-id="${esc(f.FilingID)}"><td>${esc(clientName(f.ClientID))}</td><td>${esc(f.Portal)}</td><td>${esc(f.ReturnType)}</td>
        <td>${esc(f.Period)}</td><td>${esc(day(f.DueDate))}</td><td>${esc(day(f.FiledDate))}</td><td>${esc(f.AckNo)}</td><td>${esc(f.Status)}</td>
        <td class="row-actions"><button type="button" class="btn" data-edit="${esc(f.FilingID)}" aria-label="Edit filing ${esc(f.ReturnType)}">Edit</button>
        <button type="button" class="btn" data-del="${esc(f.FilingID)}" aria-label="Delete filing ${esc(f.ReturnType)}">Delete</button></td></tr>`).join('')
        || '<tr><td colspan="9" class="muted">No filings found.</td></tr>'}</tbody></table>`;
    $('#fl-list').querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
      st.editing = st.filings.find((f) => String(f.FilingID) === b.dataset.edit) || {}; drawForm();
    }));
    $('#fl-list').querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!window.confirm('Delete this filing? This cannot be undone.')) return;
      try { await apiCall('deleteFiling', { filingId: b.dataset.del }); await load(); } catch (e) { $('#fl-list').insertAdjacentHTML('afterbegin', `<div class="form-error" role="alert">${esc(apiError(e))}</div>`); }
    }));
  };

  const drawForm = () => {
    const f = st.editing;
    if (!f) { $('#fl-form').innerHTML = ''; return; }
    const m = st.masters;
    const portal = v(f.Portal) || m.portals[0];
    const rtOpts = (p) => (m.returnTypes[p] || []).map((r) => `<option value="${esc(r)}"></option>`).join('');
    $('#fl-form').innerHTML = `<form class="card form-card" id="fl-f" novalidate><h3>${f.FilingID ? 'Edit filing' : 'Log filing'}</h3>
      <div class="form-grid">
        <label class="field"><span>Client</span><select name="ClientID"><option value="">Select client…</option>${st.clients.map((c) => `<option value="${esc(c.ClientID)}"${String(c.ClientID) === v(f.ClientID) ? ' selected' : ''}>${esc(c.Name)}</option>`).join('')}</select></label>
        <label class="field"><span>Portal</span><select name="Portal">${m.portals.map((p) => `<option${p === portal ? ' selected' : ''}>${esc(p)}</option>`).join('')}</select></label>
        <label class="field"><span>Return type</span><input name="ReturnType" list="fl-rt" value="${esc(f.ReturnType)}" autocomplete="off"><datalist id="fl-rt">${rtOpts(portal)}</datalist></label>
        <label class="field"><span>Period</span><input name="Period" type="text" placeholder="e.g. 2026-09 or FY 2025-26" value="${esc(f.Period)}"></label>
        <label class="field"><span>Due date</span><input name="DueDate" type="date" value="${esc(day(f.DueDate))}"></label>
        <label class="field"><span>Filed date</span><input name="FiledDate" type="date" value="${esc(day(f.FiledDate))}"></label>
        <label class="field"><span>Ack no.</span><input name="AckNo" type="text" value="${esc(f.AckNo)}"></label>
        <label class="field"><span>Status</span><select name="Status">${['Pending', 'Filed'].map((s) => `<option${s === (v(f.Status) || 'Pending') ? ' selected' : ''}>${s}</option>`).join('')}</select></label></div>
      <div class="form-error" id="fl-err" role="alert" hidden></div>
      <div class="vis-actions"><button type="submit" class="btn primary">Save filing</button><button type="button" class="btn" id="fl-cancel">Cancel</button></div></form>`;
    const form = $('#fl-f');
    form.elements.Portal.addEventListener('change', (e) => { $('#fl-rt').innerHTML = rtOpts(e.target.value); });
    $('#fl-cancel').addEventListener('click', () => { st.editing = null; drawForm(); });
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const el = form.elements; const err = $('#fl-err');
      const p = {};
      ['ClientID', 'Portal', 'ReturnType', 'Period', 'DueDate', 'FiledDate', 'AckNo', 'Status'].forEach((k) => { p[k] = el[k].value.trim(); });
      if (!p.ClientID) { err.textContent = 'Select a client'; err.hidden = false; return; }
      if (!p.ReturnType) { err.textContent = 'Return type is required'; err.hidden = false; return; }
      if (p.Status !== 'Filed') { p.FiledDate = ''; p.AckNo = ''; }
      if (f.FilingID) p.FilingID = f.FilingID;
      try { await apiCall('upsertFiling', p); st.editing = null; drawForm(); await load(); } catch (e) { err.textContent = apiError(e); err.hidden = false; }
    });
  };

  async function load() {
    try {
      const [clients, filings] = await Promise.all([apiCall('listClients', {}), apiCall('listFilings', {})]);
      st.clients = Array.isArray(clients) ? clients : []; st.filings = Array.isArray(filings) ? filings : [];
      $('#fl-filter').innerHTML = '<option value="">All clients</option>' + st.clients.map((c) => `<option value="${esc(c.ClientID)}"${String(c.ClientID) === st.filter ? ' selected' : ''}>${esc(c.Name)}</option>`).join('');
      drawList();
    } catch (e) { $('#fl-list').innerHTML = `<div class="form-error" role="alert">${esc(apiError(e))}</div>`; }
  }
  $('#fl-add').addEventListener('click', () => { st.editing = {}; drawForm(); });
  $('#fl-filter').addEventListener('change', (e) => { st.filter = e.target.value; drawList(); });
  apiCall('getMasters', {}).then((m) => { st.masters = resolveMasters(m); }).catch(() => {});
  load();
}

registerView('#/filings', renderFilings);

// Clients master: list + search, add/edit, delete.
import { apiCall, apiError } from '../api.js';
import { registerView } from '../router.js';
import { esc } from '../dom.js';

const FIELDS = [
  ['Name', 'Name', 'text'], ['GSTIN', 'GSTIN', 'text'], ['TradeName', 'Trade name', 'text'],
  ['RegType', 'Registration type', 'text'], ['State', 'State', 'text'], ['Address', 'Address', 'text'],
  ['Mobile', 'Mobile', 'tel'], ['Email', 'Email', 'email'],
];
const FREQ = ['', 'Monthly', 'Quarterly', 'Annual'];
const STATUS = ['Active', 'Inactive'];
const v = (x) => (x === undefined || x === null ? '' : String(x));

export function renderClients(container) {
  const st = { rows: [], q: '', editing: null };
  container.innerHTML = `<div class="card vis-head"><div><h2>Clients</h2><p class="muted">Client master for filings and the dashboard.</p></div>
      <button type="button" class="btn primary" id="cl-add">Add client</button></div>
    <div id="cl-form"></div>
    <div class="card list-card"><label class="field"><span>Search by name or GSTIN</span><input id="cl-search" type="search"></label>
      <div id="cl-list"><p class="muted">Loading…</p></div></div>`;
  const $ = (s) => container.querySelector(s);

  const drawList = () => {
    const q = st.q.trim().toLowerCase();
    const rows = st.rows.filter((r) => !q || v(r.Name).toLowerCase().includes(q) || v(r.GSTIN).toLowerCase().includes(q));
    $('#cl-list').innerHTML = `<table class="vault-table"><thead><tr><th>Name</th><th>GSTIN</th><th>Type</th><th>Frequency</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows.map((r) => `<tr data-id="${esc(r.ClientID)}"><td>${esc(r.Name)}</td><td>${esc(r.GSTIN)}</td><td>${esc(r.RegType)}</td>
        <td>${esc(r.FilingFrequency)}</td><td>${esc(r.Status)}</td>
        <td class="row-actions"><button type="button" class="btn" data-edit="${esc(r.ClientID)}" aria-label="Edit ${esc(r.Name)}">Edit</button>
        <button type="button" class="btn" data-del="${esc(r.ClientID)}" aria-label="Delete ${esc(r.Name)}">Delete</button></td></tr>`).join('')
        || '<tr><td colspan="6" class="muted">No clients found.</td></tr>'}</tbody></table>`;
    $('#cl-list').querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
      st.editing = st.rows.find((r) => String(r.ClientID) === b.dataset.edit) || {}; drawForm();
    }));
    $('#cl-list').querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      const r = st.rows.find((x) => String(x.ClientID) === b.dataset.del);
      if (!r || !window.confirm(`Delete client "${v(r.Name)}"? This cannot be undone.`)) return;
      try { await apiCall('deleteClient', { clientId: r.ClientID }); await load(); } catch (e) { $('#cl-list').insertAdjacentHTML('afterbegin', `<div class="form-error" role="alert">${esc(apiError(e))}</div>`); }
    }));
  };

  const drawForm = () => {
    const c = st.editing;
    if (!c) { $('#cl-form').innerHTML = ''; return; }
    const sel = (name, label, opts, cur) => `<label class="field"><span>${label}</span><select name="${name}">${opts.map((o) => `<option value="${esc(o)}"${o === cur ? ' selected' : ''}>${esc(o || '—')}</option>`).join('')}</select></label>`;
    $('#cl-form').innerHTML = `<form class="card form-card" id="cl-f" novalidate><h3>${c.ClientID ? 'Edit client' : 'Add client'}</h3>
      <div class="form-grid">${FIELDS.map(([k, l, t]) => `<label class="field"><span>${l}</span><input name="${k}" type="${t}" value="${esc(c[k])}"></label>`).join('')}
        ${sel('FilingFrequency', 'Filing frequency', FREQ, v(c.FilingFrequency))}
        ${sel('Status', 'Status', STATUS, v(c.Status) || 'Active')}</div>
      <div class="form-error" id="cl-err" role="alert" hidden></div>
      <div class="vis-actions"><button type="submit" class="btn primary">Save client</button><button type="button" class="btn" id="cl-cancel">Cancel</button></div></form>`;
    $('#cl-cancel').addEventListener('click', () => { st.editing = null; drawForm(); });
    $('#cl-f').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = ev.target; const err = $('#cl-err');
      const p = {};
      [...FIELDS.map((x) => x[0]), 'FilingFrequency', 'Status'].forEach((k) => { p[k] = f.elements[k].value.trim(); });
      if (!p.Name) { err.textContent = 'Name is required'; err.hidden = false; return; }
      if (c.ClientID) p.ClientID = c.ClientID;
      try { await apiCall('upsertClient', p); st.editing = null; drawForm(); await load(); } catch (e) { err.textContent = apiError(e); err.hidden = false; }
    });
  };

  async function load() {
    try { const r = await apiCall('listClients', {}); st.rows = Array.isArray(r) ? r : []; drawList(); } catch (e) { $('#cl-list').innerHTML = `<div class="form-error" role="alert">${esc(apiError(e))}</div>`; }
  }
  $('#cl-add').addEventListener('click', () => { st.editing = {}; drawForm(); });
  $('#cl-search').addEventListener('input', (e) => { st.q = e.target.value; drawList(); });
  load();
}

registerView('#/clients', renderClients);

// Reports: per-client status (WhatsApp Web pre-filled + PDF download) and Excel register exports.
import { apiCall, apiError } from '../api.js';
import { registerView } from '../router.js';
import { esc } from '../dom.js';
import {
  whatsappUrl, buildClientStatusMessage, buildClientStatusPdf, toExcel,
  filingsToExcelRows, clientsToExcelRows, visitorsToExcelRows,
} from '../report.js';

function monthNow() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function renderReports(container) {
  const st = { clients: [], filings: [], clientId: '' };
  container.innerHTML = `<div class="card vis-head"><div><h2>Reports</h2>
      <p class="muted">Send clients their filing status and export registers to Excel.</p></div></div>
    <div class="card" id="rp-client"><h3>Client filing status</h3>
      <label class="field"><span>Client</span><select id="rp-pick"><option value="">Select a client…</option></select></label>
      <pre id="rp-preview" class="muted" style="white-space:pre-wrap"></pre>
      <div class="vis-actions"><button type="button" class="btn primary" id="rp-wa" disabled>WhatsApp</button>
        <button type="button" class="btn" id="rp-pdf" disabled>PDF</button>
        <span class="muted" id="rp-note"></span></div>
      <p class="muted">WhatsApp opens WhatsApp Web with the message pre-filled; nothing is sent until you press send. Download the PDF, then attach it in WhatsApp Web.</p></div>
    <div class="card" id="rp-excel"><h3>Excel exports</h3>
      <div class="vis-fields">
        <label class="field"><span>Filings — client</span><select id="rp-fclient"><option value="">All clients</option></select></label>
        <label class="field"><span>Filings — period contains</span><input id="rp-fperiod" type="text" placeholder="e.g. 2026-09"></label>
      </div>
      <div class="vis-actions"><button type="button" class="btn" id="rp-x-filings">Export filings register</button>
        <button type="button" class="btn" id="rp-x-clients">Export client list</button></div>
      <div class="vis-fields"><label class="field"><span>Visitor register — month</span><input id="rp-vmonth" type="month" value="${monthNow()}"></label></div>
      <div class="vis-actions"><button type="button" class="btn" id="rp-x-visitors">Export visitor register</button></div>
      <div class="form-error" id="rp-err" role="alert" hidden></div></div>`;
  const $ = (q) => container.querySelector(q);
  const showErr = (e) => { const b = $('#rp-err'); b.textContent = e && e.message ? (apiError(e) || e.message) : String(e); b.hidden = false; };
  const clearErr = () => { $('#rp-err').hidden = true; };
  const guard = (fn) => async () => { clearErr(); try { await fn(); } catch (e) { showErr(e); } };
  const client = () => st.clients.find((c) => String(c.ClientID) === st.clientId);

  function refreshClient() {
    const c = client();
    const wa = $('#rp-wa'); const pdf = $('#rp-pdf');
    if (!c) { $('#rp-preview').textContent = ''; wa.disabled = true; pdf.disabled = true; $('#rp-note').textContent = ''; return; }
    const msg = buildClientStatusMessage(c, st.filings);
    $('#rp-preview').textContent = msg;
    const url = whatsappUrl(c.Mobile, msg);
    wa.disabled = !url; pdf.disabled = false;
    $('#rp-note').textContent = url ? '' : 'No valid WhatsApp number';
  }

  $('#rp-pick').addEventListener('change', (e) => { st.clientId = e.target.value; refreshClient(); });
  $('#rp-wa').addEventListener('click', () => {
    const c = client(); if (!c) return;
    const url = whatsappUrl(c.Mobile, buildClientStatusMessage(c, st.filings));
    if (url) window.open(url, '_blank', 'noopener');
  });
  $('#rp-pdf').addEventListener('click', guard(() => { const c = client(); if (c) buildClientStatusPdf(c, st.filings); }));
  $('#rp-x-clients').addEventListener('click', guard(() => toExcel(clientsToExcelRows(st.clients), 'Clients', 'clients.xlsx')));
  $('#rp-x-filings').addEventListener('click', guard(() => {
    const cid = $('#rp-fclient').value; const per = $('#rp-fperiod').value.trim().toLowerCase();
    const list = st.filings.filter((f) => (!cid || String(f.ClientID) === cid) && (!per || String(f.Period || '').toLowerCase().includes(per)));
    toExcel(filingsToExcelRows(list, st.clients), 'Filings', 'filings-register.xlsx');
  }));
  $('#rp-x-visitors').addEventListener('click', guard(async () => {
    const month = $('#rp-vmonth').value;
    const rows = await apiCall('listVisitors', { month });
    toExcel(visitorsToExcelRows(Array.isArray(rows) ? rows : []), 'Visitors', `visitors-${month}.xlsx`);
  }));

  (async () => {
    try {
      const [clients, filings] = await Promise.all([apiCall('listClients', {}), apiCall('listFilings', {})]);
      st.clients = Array.isArray(clients) ? clients : []; st.filings = Array.isArray(filings) ? filings : [];
      const opts = st.clients.map((c) => `<option value="${esc(c.ClientID)}">${esc(c.Name)}</option>`).join('');
      $('#rp-pick').insertAdjacentHTML('beforeend', opts);
      $('#rp-fclient').insertAdjacentHTML('beforeend', opts);
    } catch (e) { showErr(e); }
  })();
}

registerView('#/reports', renderReports);

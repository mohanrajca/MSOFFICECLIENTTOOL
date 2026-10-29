// Reports: pure shaping helpers (Node-testable) + thin download wrappers over SheetJS / jsPDF.
import { clientFilingSummary } from './aggregate.js';
import { day } from './dom.js';

const s = (v) => (v === undefined || v === null ? '' : String(v));
const dash = (v) => (s(v).trim() === '' ? '—' : s(v));
const dashDay = (v) => (day(v) === '' ? '—' : day(v));

export function whatsappUrl(phone, message) {
  let d = s(phone).replace(/\D/g, '');
  if (d.length === 11 && d[0] === '0') d = d.slice(1);
  if (d.length === 10) d = '91' + d;
  if (!(d.length === 12 && d.startsWith('91'))) return null;
  return `https://wa.me/${d}?text=${encodeURIComponent(s(message))}`;
}

export function buildClientStatusMessage(client, filings) {
  const { filed, pending } = clientFilingSummary(filings, client.ClientID);
  const fl = filed.map((f) => `• ${s(f.ReturnType)} ${s(f.Period)} — Ack ${dash(f.AckNo)}, ${dashDay(f.FiledDate)}`);
  const pl = pending.map((f) => `• ${s(f.ReturnType)} ${s(f.Period)} — due ${dashDay(f.DueDate)}`);
  return [
    `Dear ${s(client.Name)},`, '',
    'Here is your current filing status:', '',
    'Filed:', ...(fl.length ? fl : ['• None']), '',
    'Pending:', ...(pl.length ? pl : ['• None']), '',
    'Regards,', 'MS Associates',
  ].join('\n');
}

export function filingsToExcelRows(filings, clients) {
  const names = new Map((clients || []).map((c) => [s(c.ClientID), s(c.Name)]));
  return (filings || []).map((f) => ({
    Client: names.get(s(f.ClientID)) || s(f.ClientID), Portal: s(f.Portal), Return: s(f.ReturnType), Period: s(f.Period),
    'Due date': day(f.DueDate), 'Filed date': day(f.FiledDate), 'Ack no.': s(f.AckNo), Status: s(f.Status),
  }));
}

export function clientsToExcelRows(clients) {
  return (clients || []).map((c) => ({
    Name: s(c.Name), GSTIN: s(c.GSTIN), 'Trade name': s(c.TradeName), 'Registration type': s(c.RegType),
    State: s(c.State), Address: s(c.Address), Mobile: s(c.Mobile), Email: s(c.Email),
  }));
}

export function visitorsToExcelRows(rows) {
  return (rows || []).map((r) => ({
    Date: day(r.Date), Category: s(r.Category), Visitors: Number(r.VisitorCount) || 0,
    'Tax (₹)': Number(r.TaxAmt) || 0, 'Fees (₹)': Number(r.FeesAmt) || 0,
  }));
}

export function clientPdfModel(client, filings) {
  const { filed, pending } = clientFilingSummary(filings, client.ClientID);
  return {
    title: `Filing status — ${s(client.Name)}`,
    fileName: `${s(client.Name).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'client'}_filing_status.pdf`,
    filed: { head: ['Return', 'Period', 'Filed on', 'Ack no.'], rows: filed.map((f) => [s(f.ReturnType), s(f.Period), dashDay(f.FiledDate), dash(f.AckNo)]) },
    pending: { head: ['Return', 'Period', 'Due date'], rows: pending.map((f) => [s(f.ReturnType), s(f.Period), dashDay(f.DueDate)]) },
  };
}

function saveBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function toExcel(rows, sheetName, fileName) {
  if (!window.XLSX) throw new Error('Excel library failed to load');
  const ws = window.XLSX.utils.json_to_sheet(rows);
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, String(sheetName).slice(0, 31));
  window.XLSX.writeFile(wb, fileName);
}

export function buildClientStatusPdf(client, filings) {
  const jsPDF = window.jspdf && window.jspdf.jsPDF;
  if (!jsPDF) throw new Error('PDF library failed to load');
  const m = clientPdfModel(client, filings);
  const doc = new jsPDF();
  doc.setFontSize(16); doc.text('MS Associates', 14, 16);
  doc.setFontSize(12); doc.text(m.title, 14, 26);
  doc.text('Filed', 14, 38);
  doc.autoTable({ startY: 41, head: [m.filed.head], body: m.filed.rows.length ? m.filed.rows : [['None', '', '', '']] });
  const y = doc.lastAutoTable.finalY + 10;
  doc.text('Pending', 14, y);
  doc.autoTable({ startY: y + 3, head: [m.pending.head], body: m.pending.rows.length ? m.pending.rows : [['None', '', '']] });
  doc.save(m.fileName);
}

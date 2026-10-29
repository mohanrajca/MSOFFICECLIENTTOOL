import { test, expect } from '@playwright/test';

const CONFIGURED = "export const CONFIG = { ENDPOINT_URL: 'https://stub.test/exec', TOKEN: 'tok' };";
// Offline fakes that record what the app hands the libraries.
const FAKES = `
  window.Chart = class { constructor() {} destroy() {} };
  window.__xlsx = []; window.__pdf = []; window.__open = [];
  window.XLSX = { utils: { json_to_sheet: (rows) => ({ rows }), book_new: () => ({ sheets: [] }), book_append_sheet: (wb, ws, name) => wb.sheets.push({ ws, name }) },
    writeFile: (wb, name) => window.__xlsx.push({ name, sheets: wb.sheets }) };
  window.jspdf = { jsPDF: class { constructor() { this.lastAutoTable = { finalY: 50 }; this.t = []; this.tables = []; }
    setFontSize() {} text(s) { this.t.push(s); } autoTable(o) { this.tables.push(o); }
    save(name) { window.__pdf.push({ name, text: this.t, tables: this.tables }); } } };
  window.open = (u, t, f) => { window.__open.push({ u, t, f }); return null; };`;
const STUB = `
  window.__clients = [
    { ClientID: 'C1', Name: 'Dhoni <b>Traders</b>', Mobile: '98765 43210' },
    { ClientID: 'C2', Name: 'No Phone Co', Mobile: '12345' }];
  window.__filings = [
    { FilingID: 'F1', ClientID: 'C1', Portal: 'GST', ReturnType: 'GSTR-3B', Period: '2026-09', Status: 'Filed', AckNo: 'AB1', FiledDate: '2026-10-18', DueDate: '2026-10-20' },
    { FilingID: 'F2', ClientID: 'C1', Portal: 'GST', ReturnType: 'GSTR-1', Period: '2026-10', Status: 'Pending', DueDate: '' },
    { FilingID: 'F3', ClientID: 'C2', Portal: 'GST', ReturnType: 'GSTR-1', Period: '2026-10', Status: 'Pending', DueDate: '2026-11-11' }];
  window.__calls = [];
  window.fetch = async (url, opts) => {
    const req = JSON.parse(opts.body); window.__calls.push(req);
    const ok = (data) => ({ ok: true, text: async () => JSON.stringify({ ok: true, data }) });
    switch (req.action) {
      case 'bootstrapStatus': return ok({ needsSetup: false });
      case 'login': return ok({ session: 'S1', user: { UserID: 'U1', Name: 'Asha', Role: 'Staff' } });
      case 'listClients': return ok(window.__clients);
      case 'listFilings': return ok(window.__filings);
      case 'listVisitors': return ok([{ Date: req.payload.month + '-01', Category: 'GST', VisitorCount: 2, TaxAmt: 10, FeesAmt: 5 }]);
      default: return ok([]);
    }
  };`;

async function open(page) {
  await page.route('**/js/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: CONFIGURED }));
  await page.route('**/cdnjs.cloudflare.com/**', (r) => r.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.addInitScript(STUB + FAKES);
  await page.goto('/index.html');
  await page.fill('input[name=username]', 'asha');
  await page.fill('input[name=password]', 'goodpass1');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('link', { name: 'Reports' }).click();
  await expect(page.locator('#rp-pick')).toBeVisible();
  await expect(page.locator('#rp-pick option')).toHaveCount(3);
}

test('choose client -> preview, wa.me URL with encoded message, PDF download', async ({ page }) => {
  await open(page);
  await page.selectOption('#rp-pick', 'C1');
  const prev = page.locator('#rp-preview');
  await expect(prev).toContainText('GSTR-3B 2026-09 — Ack AB1, 2026-10-18');
  await expect(prev).toContainText('GSTR-1 2026-10 — due —');
  await expect(prev).not.toContainText('undefined');
  await expect(page.locator('#rp-preview b')).toHaveCount(0); // name rendered as text, not HTML
  await expect(page.locator('#rp-wa')).toBeEnabled();
  await page.click('#rp-wa');
  const opened = await page.evaluate(() => window.__open);
  expect(opened).toHaveLength(1);
  expect(opened[0].u.startsWith('https://wa.me/919876543210?text=')).toBe(true);
  const msg = decodeURIComponent(opened[0].u.split('?text=')[1]);
  expect(msg).toContain('Dhoni <b>Traders</b>');
  expect(msg).toContain('Ack AB1');
  await page.click('#rp-pdf');
  const pdf = await page.evaluate(() => window.__pdf);
  expect(pdf[0].name).toBe('Dhoni_b_Traders_b_filing_status.pdf');
  expect(pdf[0].tables[0].body).toEqual([['GSTR-3B', '2026-09', '2026-10-18', 'AB1']]);
});

test('invalid number disables WhatsApp and says why; PDF still available', async ({ page }) => {
  await open(page);
  await page.selectOption('#rp-pick', 'C2');
  await expect(page.locator('#rp-wa')).toBeDisabled();
  await expect(page.locator('#rp-note')).toHaveText('No valid WhatsApp number');
  await expect(page.locator('#rp-pdf')).toBeEnabled();
  expect(await page.evaluate(() => window.__open.length)).toBe(0);
});

test('excel exports fire for filings (filtered), clients and visitors', async ({ page }) => {
  await open(page);
  await page.selectOption('#rp-fclient', 'C2');
  await page.click('#rp-x-filings');
  await page.click('#rp-x-clients');
  await page.fill('#rp-vmonth', '2026-10');
  await page.click('#rp-x-visitors');
  await expect.poll(() => page.evaluate(() => window.__xlsx.length)).toBe(3);
  const x = await page.evaluate(() => window.__xlsx);
  expect(x[0].name).toBe('filings-register.xlsx');
  expect(x[0].sheets[0].ws.rows).toHaveLength(1);
  expect(x[0].sheets[0].ws.rows[0].Client).toBe('No Phone Co');
  expect(x[1].name).toBe('clients.xlsx');
  expect(x[2].name).toBe('visitors-2026-10.xlsx');
  expect(x[2].sheets[0].ws.rows[0]).toMatchObject({ Date: '2026-10-01', Visitors: 2 });
});

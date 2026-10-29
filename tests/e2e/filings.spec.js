import { test, expect } from '@playwright/test';

const CONFIGURED = "export const CONFIG = { ENDPOINT_URL: 'https://stub.test/exec', TOKEN: 'tok' };";
// Fake Chart.js so the test is offline; records the configs the dashboard hands it.
const FAKE_CHART = 'window.__charts = []; window.Chart = class { constructor(el, cfg) { this.cfg = cfg; this.destroyed = false; window.__charts.push(this); } destroy() { this.destroyed = true; } };';
const STUB = `
  window.__calls = []; window.__clients = []; window.__filings = [];
  window.fetch = async (url, opts) => {
    const req = JSON.parse(opts.body); window.__calls.push(req);
    const ok = (data) => ({ ok: true, text: async () => JSON.stringify({ ok: true, data }) });
    const p = req.payload || {};
    const upsert = (list, key, prefix) => {
      const i = p[key] ? list.findIndex((r) => r[key] === p[key]) : -1;
      if (i >= 0) { list[i] = { ...list[i], ...p }; return list[i]; }
      const row = { ...p, [key]: prefix + (list.length + 1) }; list.push(row); return row;
    };
    switch (req.action) {
      case 'bootstrapStatus': return ok({ needsSetup: false });
      case 'login': return ok({ session: 'S1', user: { UserID: 'U1', Name: 'Asha', Role: 'Staff' } });
      case 'listClients': return ok(window.__clients);
      case 'upsertClient': return ok(upsert(window.__clients, 'ClientID', 'C'));
      case 'deleteClient': window.__clients = window.__clients.filter((r) => r.ClientID !== p.clientId); return ok({ deleted: p.clientId });
      case 'listFilings': return ok(window.__filings.filter((r) => !p.clientId || r.ClientID === p.clientId));
      case 'upsertFiling': return ok(upsert(window.__filings, 'FilingID', 'F'));
      case 'deleteFiling': window.__filings = window.__filings.filter((r) => r.FilingID !== p.filingId); return ok({ deleted: p.filingId });
      case 'getMasters': return ok({ portals: [], returnTypes: {} });
      case 'listVisitors': case 'listBalances': return ok([]);
      default: return ok({});
    }
  };`;

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const TODAY = iso(new Date());
const SOON = iso(new Date(Date.now() + 3 * 86400000));

async function open(page) {
  await page.route('**/js/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: CONFIGURED }));
  await page.route('**/cdnjs.cloudflare.com/**', (r) => r.fulfill({ contentType: 'text/javascript', body: FAKE_CHART }));
  await page.addInitScript(STUB);
  await page.goto('/index.html');
  await page.fill('input[name=username]', 'asha');
  await page.fill('input[name=password]', 'goodpass1');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#kpi-clients')).toBeVisible();
}

test('add client -> log filed + pending filing -> dashboard reflects counts, no undefined/NaN', async ({ page }) => {
  await open(page);
  await expect(page.locator('#kpi-clients')).toHaveText('0');

  await page.getByRole('link', { name: 'Clients' }).click();
  await page.getByRole('button', { name: 'Add client' }).click();
  await page.fill('input[name=Name]', 'Dhoni Traders');
  await page.fill('input[name=GSTIN]', '33ABCDE1234F1Z5');
  await page.getByRole('button', { name: 'Save client' }).click();
  await expect(page.locator('#cl-list')).toContainText('Dhoni Traders');
  await page.fill('#cl-search', 'zzz');
  await expect(page.locator('#cl-list')).toContainText('No clients found');
  await page.fill('#cl-search', '33abcde');
  await expect(page.locator('#cl-list')).toContainText('Dhoni Traders');

  await page.getByRole('link', { name: 'Filings' }).click();
  // Filed GST filing, this month
  await page.getByRole('button', { name: 'Log filing' }).click();
  await page.selectOption('select[name=ClientID]', { label: 'Dhoni Traders' });
  await page.selectOption('select[name=Portal]', 'GST'); // falls back to built-in masters
  await page.fill('input[name=ReturnType]', 'GSTR-3B');
  await page.fill('input[name=Period]', '2026-09');
  await page.fill('input[name=FiledDate]', TODAY);
  await page.fill('input[name=AckNo]', 'AA123');
  await page.selectOption('select[name=Status]', 'Filed');
  await page.getByRole('button', { name: 'Save filing' }).click();
  await expect(page.locator('#fl-list')).toContainText('AA123');

  // Pending IT filing due in 3 days, with blank filed date / ack
  await page.getByRole('button', { name: 'Log filing' }).click();
  await page.selectOption('select[name=ClientID]', { label: 'Dhoni Traders' });
  await page.selectOption('select[name=Portal]', 'Income Tax');
  await expect(page.locator('#fl-rt option[value="ITR-3"]')).toHaveCount(1);
  await page.fill('input[name=ReturnType]', 'ITR-3');
  await page.fill('input[name=DueDate]', SOON);
  await page.getByRole('button', { name: 'Save filing' }).click();
  await expect(page.locator('#fl-list')).toContainText('ITR-3');
  const pendingRow = page.locator('#fl-list tbody tr', { hasText: 'ITR-3' });
  await expect(pendingRow).not.toContainText('undefined');
  await expect(pendingRow).not.toContainText('NaN');
  const sent = await page.evaluate(() => window.__calls.filter((c) => c.action === 'upsertFiling').map((c) => c.payload));
  expect(sent[1]).toMatchObject({ Status: 'Pending', FiledDate: '', AckNo: '' });

  await page.getByRole('link', { name: 'Dashboard' }).click();
  await expect(page.locator('#kpi-clients')).toHaveText('1');
  await expect(page.locator('#kpi-filed')).toHaveText('1');
  await expect(page.locator('#kpi-pending')).toHaveText('1');
  await expect(page.locator('.kpi.k-mca small')).toContainText('1 due this week');
  await expect(page.locator('#bd-GST')).toHaveText('1');
  await expect(page.locator('#bd-IT')).toHaveText('1');
  await expect(page.locator('#bd-MCA')).toHaveText('0');
  await expect(page.locator('#client-table')).toContainText('Dhoni Traders');
  await expect(page.locator('#due-list')).toContainText('ITR-3');
  await expect(page.locator('body')).not.toContainText('undefined');
  await expect(page.locator('body')).not.toContainText('NaN');

  const donut = await page.evaluate(() => window.__charts.filter((c) => !c.destroyed).map((c) => c.cfg.type + ':' + JSON.stringify(c.cfg.data.datasets.map((d) => d.data))));
  expect(donut).toContain('doughnut:[[1,1,0,0]]');
  // re-render destroys previous chart instances
  await page.getByRole('link', { name: 'Clients' }).click();
  await page.getByRole('link', { name: 'Dashboard' }).click();
  await expect(page.locator('#kpi-clients')).toHaveText('1');
  const live = await page.evaluate(() => ({ destroyed: window.__charts.filter((c) => c.destroyed).length, alive: window.__charts.filter((c) => !c.destroyed).length }));
  expect(live.alive).toBe(2);
  expect(live.destroyed).toBeGreaterThanOrEqual(2);
});

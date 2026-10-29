import { test, expect } from '@playwright/test';

const CONFIGURED = "export const CONFIG = { ENDPOINT_URL: 'https://stub.test/exec', TOKEN: 'tok' };";

// Stub backend with in-memory Visitors + DayBalances; records every request.
const STUB = `
  window.__calls = []; window.__visitors = []; window.__balances = [];
  window.fetch = async (url, opts) => {
    const req = JSON.parse(opts.body); window.__calls.push(req);
    const ok = (data) => ({ ok: true, text: async () => JSON.stringify({ ok: true, data }) });
    const p = req.payload || {};
    switch (req.action) {
      case 'bootstrapStatus': return ok({ needsSetup: false });
      case 'login': return ok({ session: 'S1', user: { UserID: 'U1', Name: 'Asha', Role: 'Staff' } });
      case 'listVisitors': return ok(window.__visitors.filter((r) => p.date ? r.Date === p.date : (!p.month || r.Date.startsWith(p.month))));
      case 'upsertVisitor': {
        const i = p.VisitorID ? window.__visitors.findIndex((r) => r.VisitorID === p.VisitorID) : -1;
        if (i >= 0) { window.__visitors[i] = { ...window.__visitors[i], ...p }; return ok(window.__visitors[i]); }
        const row = { ...p, VisitorID: 'V' + (window.__visitors.length + 1) }; window.__visitors.push(row); return ok(row);
      }
      case 'listBalances': return ok(window.__balances.filter((r) => !p.before || r.Date < p.before).sort((a, b) => a.Date.localeCompare(b.Date)));
      case 'getDayBalance': return ok(window.__balances.find((r) => r.Date === p.date) || null);
      case 'setDayBalance': {
        const i = window.__balances.findIndex((r) => r.Date === p.Date);
        if (i >= 0) window.__balances[i] = { ...p }; else window.__balances.push({ ...p });
        return ok(p);
      }
      default: return ok({});
    }
  };`;

async function open(page) {
  await page.route('**/js/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: CONFIGURED }));
  await page.addInitScript(STUB);
  await page.goto('/index.html');
  await page.fill('input[name=username]', 'asha');
  await page.fill('input[name=password]', 'goodpass1');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('link', { name: 'Visitors' }).click();
  await expect(page.locator('#vis-date')).toBeVisible();
}
const setDate = async (page, d) => { await page.fill('#vis-date', d); await expect(page.locator('#vis-date')).toHaveValue(d); await expect(page.locator('#t-count')).toBeVisible(); };
const fillCat = async (page, cat, count, tax, fees) => {
  const c = page.locator(`[data-cat="${cat}"]`);
  await c.locator('[name=count]').fill(String(count)); await c.locator('[name=tax]').fill(String(tax)); await c.locator('[name=fees]').fill(String(fees));
};
const calls = (page, action) => page.evaluate((a) => window.__calls.filter((c) => c.action === a).map((c) => c.payload), action);

test('day entry: totals update, upsertVisitor per Date+Category, re-save updates not duplicates', async ({ page }) => {
  await open(page);
  await setDate(page, '2026-10-01');
  await expect(page.locator('body')).not.toContainText('NaN');
  await expect(page.locator('#t-count')).toHaveText('0');
  await fillCat(page, 'Income Tax', 3, 1000, 500);
  await fillCat(page, 'GST', 2, '', 700);
  await expect(page.locator('#t-count')).toHaveText('5');
  await expect(page.locator('#t-tax')).toHaveText('₹1,000');
  await expect(page.locator('#t-fees')).toHaveText('₹1,200');
  await expect(page.locator('#c-rec')).toHaveText('₹2,200');
  await expect(page.locator('body')).not.toContainText('NaN');

  await page.getByRole('button', { name: 'Save Income Tax' }).click();
  await expect(page.locator('[data-cat="Income Tax"] [data-msg]')).toHaveText('Saved');
  const first = (await calls(page, 'upsertVisitor'))[0];
  expect(first).toMatchObject({ Date: '2026-10-01', Category: 'Income Tax', VisitorCount: 3, TaxAmt: 1000, FeesAmt: 500 });
  expect(first.VisitorID).toBeUndefined();

  await fillCat(page, 'Income Tax', 4, 1000, 500);
  await page.getByRole('button', { name: 'Save Income Tax' }).click();
  await expect(page.locator('[data-cat="Income Tax"] [data-msg]')).toHaveText('Saved');
  const ups = await calls(page, 'upsertVisitor');
  expect(ups[1].VisitorID).toBe('V1');
  expect(await page.evaluate(() => window.__visitors.length)).toBe(1);
});

test('cash override saved; next day shows carried-forward opening; no prior record -> opening 0', async ({ page }) => {
  await open(page);
  await setDate(page, '2026-10-01');
  await expect(page.locator('#c-open')).toHaveText('₹0');
  await fillCat(page, 'GST', 1, 0, 400);
  await expect(page.locator('#c-close')).toHaveText('₹400');
  await page.fill('[name=override]', '5000');
  await expect(page.locator('#c-close')).toHaveText('₹5,000');
  await page.fill('[name=bank]', '20000');
  await page.fill('[name=note]', 'counted');
  await page.getByRole('button', { name: 'Save balances' }).click();
  await expect(page.locator('#bal-msg')).toHaveText('Saved');
  expect((await calls(page, 'setDayBalance'))[0]).toMatchObject({ Date: '2026-10-01', CashBalance: 5000, BankBalance: 20000, Note: 'counted' });

  await setDate(page, '2026-10-02');
  await expect(page.locator('#c-open')).toHaveText('₹5,000');
  await fillCat(page, 'Accounts', 1, 0, 250);
  await expect(page.locator('#c-close')).toHaveText('₹5,250');
  // a gap day still carries forward from the last record
  await setDate(page, '2026-10-05');
  await expect(page.locator('#c-open')).toHaveText('₹5,000');
  await expect(page.locator('body')).not.toContainText('NaN');
});

test('month summary lists days, totals and latest balances', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    window.__visitors.push(
      { VisitorID: 'V1', Date: '2026-10-01', Category: 'GST', VisitorCount: 2, TaxAmt: 100, FeesAmt: 50 },
      { VisitorID: 'V2', Date: '2026-10-01', Category: 'Accounts', VisitorCount: 1, TaxAmt: '', FeesAmt: 25 },
      { VisitorID: 'V3', Date: '2026-10-03', Category: 'Income Tax', VisitorCount: 4, TaxAmt: 1000, FeesAmt: 200 });
    window.__balances.push({ Date: '2026-10-03', CashBalance: 12345, BankBalance: 99000, Note: '' });
  });
  await page.getByRole('button', { name: 'Month' }).click();
  await page.fill('#vis-month', '2026-10');
  await expect(page.locator('tr[data-day]')).toHaveCount(2);
  await expect(page.locator('#m-count')).toHaveText('7');
  await expect(page.locator('#m-tax')).toHaveText('₹1,100');
  await expect(page.locator('#m-fees')).toHaveText('₹275');
  await expect(page.locator('#m-cash')).toHaveText('₹12,345');
  await expect(page.locator('#m-bank')).toHaveText('₹99,000');
  await expect(page.locator('body')).not.toContainText('NaN');
});

test('old prior balance (beyond 35 days) still carries forward; integer counts; stale-cash hint; blank bank shows dash', async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.__balances.push({ Date: '2026-03-01', CashBalance: 7777, BankBalance: '', Note: '' }));
  await setDate(page, '2026-10-01');
  await expect(page.locator('#c-open')).toHaveText('₹7,777');
  await fillCat(page, 'GST', 2.6, 0, 100);
  await page.getByRole('button', { name: 'Save GST' }).click();
  await expect(page.locator('[data-cat="GST"] [data-msg]')).toHaveText('Saved');
  expect((await calls(page, 'upsertVisitor'))[0].VisitorCount).toBe(3);
  await fillCat(page, 'Income Tax', -4, 0, 0);
  await page.getByRole('button', { name: 'Save Income Tax' }).click();
  await expect(page.locator('[data-cat="Income Tax"] [data-msg]')).toHaveText('Saved');
  expect((await calls(page, 'upsertVisitor'))[1].VisitorCount).toBe(0);
  await page.getByRole('button', { name: 'Save balances' }).click();
  await expect(page.locator('#bal-msg')).toHaveText('Saved');
  await fillCat(page, 'GST', 2, 0, 500);
  await page.getByRole('button', { name: 'Save GST' }).click();
  await expect(page.locator('#bal-msg')).toContainText('Save balances to update');
  await page.getByRole('button', { name: 'Month' }).click();
  await expect(page.locator('#m-bank')).toHaveText('—');
});

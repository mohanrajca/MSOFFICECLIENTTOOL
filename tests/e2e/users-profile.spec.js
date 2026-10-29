import { test, expect } from '@playwright/test';

const CONFIGURED = "export const CONFIG = { ENDPOINT_URL: 'https://stub.test/exec', TOKEN: 'tok' };";
const FAKE_CHART = 'window.Chart = class { constructor() {} destroy() {} };';
const stub = (role) => `
  window.__calls = [];
  window.__users = [
    { UserID: 'U1', Name: 'Asha', Username: 'asha', Role: '${role}', Contact: '', Active: true },
    { UserID: 'U2', Name: 'Ravi <b>', Username: 'ravi', Role: 'Staff', Contact: '98400', Active: true },
  ];
  window.fetch = async (url, opts) => {
    const req = JSON.parse(opts.body); window.__calls.push(req);
    const ok = (data) => ({ ok: true, text: async () => JSON.stringify({ ok: true, data }) });
    const p = req.payload || {};
    switch (req.action) {
      case 'bootstrapStatus': return ok({ needsSetup: false });
      case 'login': return ok({ session: 'S1', user: { UserID: 'U1', Name: 'Asha', Role: '${role}' } });
      case 'listUsers': return ok(window.__users);
      case 'upsertUser': {
        const row = { UserID: 'U' + (window.__users.length + 1), Name: p.name, Username: p.username, Role: p.role, Contact: p.contact, Active: p.active };
        window.__users.push(row); return ok(row);
      }
      case 'updateProfile': return ok({ UserID: 'U1', Name: p.name, Username: 'asha', Role: '${role}', Contact: p.contact || '', Active: true });
      case 'listClients': case 'listFilings': case 'listVisitors': case 'listBalances': return ok([]);
      case 'getMasters': return ok({ portals: [], returnTypes: {} });
      default: return ok({});
    }
  };`;

async function open(page, role) {
  await page.route('**/js/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: CONFIGURED }));
  await page.route('**/cdnjs.cloudflare.com/**', (r) => r.fulfill({ contentType: 'text/javascript', body: FAKE_CHART }));
  await page.addInitScript(stub(role));
  await page.goto('/index.html');
  await page.fill('input[name=username]', 'asha');
  await page.fill('input[name=password]', 'goodpass1');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#view')).toBeVisible();
}
const calls = (page, action) => page.evaluate((a) => window.__calls.filter((c) => c.action === a), action);

test('admin lists users, adds a Staff user, payload correct, no undefined/NaN', async ({ page }) => {
  await open(page, 'Admin');
  await page.getByRole('link', { name: 'Users' }).click();
  await expect(page.locator('#us-list')).toContainText('asha');
  await expect(page.locator('#us-list')).toContainText('Ravi <b>'); // escaped, shown literally
  await page.getByRole('button', { name: 'Add user' }).click();
  await page.getByRole('button', { name: 'Save user' }).click();
  await expect(page.locator('#us-err')).toContainText('required');
  await page.fill('input[name=Name]', 'Meena');
  await page.fill('input[name=Username]', 'meena');
  await page.fill('input[name=Contact]', '99999');
  await page.fill('input[name=password]', 'secret123');
  await page.getByRole('button', { name: 'Save user' }).click();
  await expect(page.locator('#us-list')).toContainText('Meena');
  const [c] = await calls(page, 'upsertUser');
  expect(c.payload).toEqual({ name: 'Meena', username: 'meena', role: 'Staff', contact: '99999', active: true, password: 'secret123' });
  const text = await page.locator('#view').innerText();
  expect(text).not.toMatch(/undefined|NaN/);
});

test('profile edit updates name via updateProfile and the top bar', async ({ page }) => {
  await open(page, 'Staff');
  await page.getByRole('link', { name: 'Profile' }).click();
  await expect(page.locator('input[name=Role]')).toHaveValue('Staff');
  await page.fill('input[name=Name]', 'Asha Devi');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.locator('#pf-ok')).toContainText('updated');
  await expect(page.locator('.topbar .uname')).toHaveText('Asha Devi');
  const [c] = await calls(page, 'updateProfile');
  expect(c.payload).toEqual({ name: 'Asha Devi' }); // no password/contact sent when blank
  const text = await page.locator('#view').innerText();
  expect(text).not.toMatch(/undefined|NaN/);
});

test('staff at #/users sees no-access panel and listUsers is not called', async ({ page }) => {
  await open(page, 'Staff');
  await page.evaluate(() => { location.hash = '#/users'; });
  await expect(page.locator('#us-noaccess')).toContainText('You do not have access');
  expect(await calls(page, 'listUsers')).toHaveLength(0);
});

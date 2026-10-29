import { test, expect } from '@playwright/test';

const CONFIGURED = "export const CONFIG = { ENDPOINT_URL: 'https://stub.test/exec', TOKEN: 'tok' };";

// Stub window.fetch (no real backend). needsSetup is controlled per page load.
function stubFetch(needsSetup) {
  return `
    window.__calls = [];
    window.fetch = async (url, opts) => {
      const req = JSON.parse(opts.body);
      window.__calls.push({ url, ct: opts.headers['Content-Type'], req });
      const ok = (data) => ({ ok: true, text: async () => JSON.stringify({ ok: true, data }) });
      if (req.action === 'bootstrapStatus') return ok({ needsSetup: ${needsSetup} });
      if (req.action === 'setupAdmin') return ok({ session: 'S1', user: { UserID: 'U1', Name: req.payload.name, Role: 'Admin' } });
      if (req.action === 'login') {
        if (req.payload.password !== 'goodpass1') return { ok: true, text: async () => JSON.stringify({ ok: false, error: 'bad_login' }) };
        return ok({ session: 'S2', user: { UserID: 'U1', Name: 'Asha Rao', Role: 'Admin' } });
      }
      return ok({});
    };`;
}

async function setup(page, needsSetup) {
  await page.route('**/js/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: CONFIGURED }));
  await page.addInitScript(stubFetch(needsSetup));
}

test('unconfigured backend shows a clear message', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page.getByText('Backend not configured')).toBeVisible();
});

test('setup -> authed dashboard shell, then reload shows login', async ({ page, context }) => {
  await setup(page, true);
  await page.goto('/index.html');
  await expect(page.getByRole('heading', { name: 'Set up your practice' })).toBeVisible();

  await page.fill('input[name=name]', 'Asha Rao');
  await page.fill('input[name=username]', 'asha');
  await page.fill('input[name=password]', 'goodpass1');
  await page.fill('input[name=confirm]', 'goodpass1');
  await page.getByRole('button', { name: 'Create Admin account' }).click();

  await expect(page.locator('.topbar')).toContainText('MS Associates');
  await expect(page.locator('.topbar')).toContainText('S. Mohanraj, ACS');
  await expect(page.locator('.topbar')).toContainText('Asha Rao');
  await expect(page.getByRole('link', { name: /GST Suite Pro/ })).toHaveAttribute('target', '_blank');
  await expect(page.locator('.sidenav a')).toHaveCount(8);
  await expect(page).toHaveURL(/#\/dashboard$/);
  await expect(page.locator('#view')).toContainText('Dashboard');

  await page.getByRole('link', { name: 'Vault' }).click();
  await expect(page).toHaveURL(/#\/vault$/);
  await expect(page.locator('.sidenav a.active')).toHaveText(/Vault/);

  await page.evaluate(() => { location.hash = '#/nope'; });
  await expect(page.locator('#view')).toContainText('Page not found');

  const calls = await page.evaluate(() => window.__calls);
  const setupCall = calls.find((c) => c.req.action === 'setupAdmin');
  expect(setupCall.ct).toBe('text/plain');
  expect(setupCall.req.token).toBe('tok');

  // Logout clears the session; a fresh page with needsSetup:false shows login.
  await page.getByRole('button', { name: 'Logout' }).click();
  await expect(page.getByRole('heading', { name: 'Set up your practice' })).toBeVisible();

  const page2 = await context.newPage();
  await setup(page2, false);
  await page2.goto('/index.html');
  await expect(page2.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page2.fill('input[name=username]', 'asha');
  await page2.fill('input[name=password]', 'wrong');
  await page2.getByRole('button', { name: 'Sign in' }).click();
  await expect(page2.getByRole('alert')).toContainText('Incorrect username or password');
  await page2.fill('input[name=password]', 'goodpass1');
  await page2.getByRole('button', { name: 'Sign in' }).click();
  await expect(page2.locator('.sidenav a')).toHaveCount(8);
});

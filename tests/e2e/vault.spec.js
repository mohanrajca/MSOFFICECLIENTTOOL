import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const CONFIGURED = "export const CONFIG = { ENDPOINT_URL: 'https://stub.test/exec', TOKEN: 'tok' };";
const CRYPTOJS = readFileSync('node_modules/crypto-js/crypto-js.js', 'utf8');

// Stub backend: in-memory clients + credentials. Records every request so tests can
// assert exactly what the "server" received. Role is chosen per page.
function stub(role) {
  return `
    window.__calls = [];
    window.__creds = [];
    const clients = [{ ClientID: 'C001', Name: 'Acme Traders' }, { ClientID: 'C002', Name: 'Beta Foods' }, { ClientID: 'C003', Name: 'Ghost Co' }];
    window.fetch = async (url, opts) => {
      const req = JSON.parse(opts.body);
      window.__calls.push(req);
      const ok = (data) => ({ ok: true, text: async () => JSON.stringify({ ok: true, data }) });
      const err = (e) => ({ ok: true, text: async () => JSON.stringify({ ok: false, error: e }) });
      switch (req.action) {
        case 'bootstrapStatus': return ok({ needsSetup: false });
        case 'login': return ok({ session: 'S1', user: { UserID: 'U1', Name: 'Asha', Role: '${role}' } });
        case 'listClients': return ok(clients);
        case 'listCredentials': return ok(window.__creds.map((c) => ({ ...c })));
        case 'upsertCredential': {
          if ('${role}' !== 'Admin') return err('forbidden');
          const p = req.payload;
          const i = p.CredID ? window.__creds.findIndex((c) => c.CredID === p.CredID) : -1;
          if (i >= 0) { window.__creds[i] = { ...window.__creds[i], ...p }; return ok(window.__creds[i]); }
          const row = { CredID: 'K' + (window.__creds.length + 1), Notes: '', ...p };
          window.__creds.push(row); return ok(row);
        }
        case 'importLegacy': return ok({
          clientsImported: 3,
          matches: [{ ClientID: 'C001', Name: 'Acme Traders', Portal: 'GST', LoginID: 'acme_gst', password: 'LegacyPw#1' }],
          unmatched: ['Ghost Co'] });
        default: return ok({});
      }
    };`;
}

async function open(page, role) {
  await page.route('**/js/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: CONFIGURED }));
  // Serve the real crypto-js in place of the cdnjs script, and drop SRI (this file is not the .min build).
  await page.route('https://cdnjs.cloudflare.com/**', (r) => r.fulfill({ contentType: 'text/javascript', body: CRYPTOJS }));
  await page.route('**/index.html', async (r) => {
    const resp = await r.fetch();
    const body = (await resp.text()).replace(/\sintegrity="[^"]*"/, '');
    await r.fulfill({ response: resp, body });
  });
  await page.addInitScript(stub(role));
  await page.goto('/index.html');
  await page.fill('input[name=username]', 'asha');
  await page.fill('input[name=password]', 'goodpass1');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('link', { name: 'Vault' }).click();
}

const unlock = async (page, key) => {
  await page.fill('input[name=mk]', key);
  await page.getByRole('button', { name: 'Unlock vault' }).click();
};

test('admin: add sends ciphertext only; reveal shows plaintext; wrong key rejected, nothing garbled', async ({ page }) => {
  await open(page, 'Admin');
  await unlock(page, 'right-key');
  await page.getByRole('button', { name: 'Add credential' }).click();
  await page.selectOption('select[name=client]', 'C001');
  await page.selectOption('select[name=portal]', 'IT');
  await page.fill('input[name=login]', 'acme_it');
  await page.fill('input[name=pw]', 'S3cret-पास');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('tr[data-cred]')).toHaveCount(1);

  const sent = await page.evaluate(() => window.__calls.find((c) => c.action === 'upsertCredential').payload);
  expect(sent.Password.startsWith('pmv1:')).toBe(true);
  expect(sent.Password).not.toContain('S3cret');
  const all = await page.evaluate(() => JSON.stringify(window.__calls));
  expect(all).not.toContain('S3cret');
  expect(all).not.toContain('right-key'); // master key never sent

  // Hidden by default.
  expect(await page.locator('body').innerHTML()).not.toContain('S3cret');
  await page.getByRole('button', { name: 'Reveal' }).click();
  await expect(page.locator('.pw-plain')).toHaveText('S3cret-पास');
  await page.getByRole('button', { name: 'Hide' }).click();
  await expect(page.locator('.pw-plain')).toHaveCount(0);

  await page.getByRole('button', { name: 'Lock vault' }).click();
  await unlock(page, 'WRONG-key');
  await expect(page.getByRole('alert').filter({ hasText: 'Wrong master key' })).toBeVisible();
  await expect(page.locator('tr[data-cred]')).toHaveCount(0);
  await unlock(page, 'right-key');
  await page.getByRole('button', { name: 'Reveal' }).click();
  await expect(page.locator('.pw-plain')).toHaveText('S3cret-पास');
});

test('reveal of an entry under a different key shows "Wrong master key", never garbled text', async ({ page }) => {
  await open(page, 'Admin');
  await unlock(page, 'right-key'); // empty vault: any first key is accepted
  await page.getByRole('button', { name: 'Add credential' }).click();
  await page.fill('input[name=login]', 'acme_it');
  await page.fill('input[name=pw]', 'S3cret');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('tr[data-cred]')).toHaveCount(1);
  // Another admin's entry encrypted under a different key appears in the vault.
  await page.evaluate(() => {
    const ct = 'pmv1:' + CryptoJS.AES.encrypt('PMV1\nhidden', 'other-key').toString();
    window.__creds.push({ CredID: 'K9', ClientID: 'C002', Portal: 'GST', LoginID: 'beta', Password: ct });
  });
  await page.getByRole('link', { name: 'Dashboard' }).click();
  await page.getByRole('link', { name: 'Vault' }).click();
  await page.locator('tr[data-cred="K9"] .reveal').click();
  await expect(page.getByRole('alert').filter({ hasText: 'Wrong master key' })).toBeVisible();
  await expect(page.locator('tr[data-cred="K9"] .pw-plain')).toHaveCount(0);
  expect(await page.locator('body').innerText()).not.toContain('hidden');
});

test('migration encrypts matches, dedupes on re-run, lists unmatched', async ({ page }) => {
  await open(page, 'Admin');
  await unlock(page, 'right-key');
  await page.getByRole('button', { name: 'Import from existing sheet' }).click();
  await expect(page.getByRole('status')).toContainText('3 clients imported');
  await expect(page.getByRole('status')).toContainText('1 credentials encrypted');
  await expect(page.locator('#unmatched li')).toHaveText(['Ghost Co']);
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Import from existing sheet' }).click();
  await expect(page.getByRole('status')).toContainText('0 credentials encrypted');
  await expect(page.getByRole('status')).toContainText('1 already present');
  const ups = await page.evaluate(() => window.__calls.filter((c) => c.action === 'upsertCredential'));
  expect(ups).toHaveLength(1);
  expect(ups[0].payload.Password.startsWith('pmv1:')).toBe(true);
  expect(JSON.stringify(ups)).not.toContain('LegacyPw#1');
});

test('staff can view/reveal but sees no add/edit/delete/import', async ({ page }) => {
  await open(page, 'Staff');
  await unlock(page, 'k');
  await expect(page.getByRole('button', { name: 'Add credential' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Import from existing sheet' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Lock vault' })).toBeVisible();
  await expect(page.locator('.vault-client')).toHaveCount(3);
});

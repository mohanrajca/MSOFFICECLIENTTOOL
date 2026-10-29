import { test, expect } from '@playwright/test';

// Full end-to-end smoke over the whole app with a stateful stub backend and offline fake libraries.
// State lives in localStorage so it survives the logout reload (setup -> logout -> login).
const CONFIGURED = "export const CONFIG = { ENDPOINT_URL: 'https://stub.test/exec', TOKEN: 'tok', SUITE_URL: 'https://suite.example/app' };";

const FAKES = `
  window.__charts = [];
  window.Chart = class { constructor(el, cfg) { this.cfg = cfg; window.__charts.push(this); } destroy() {} };
  window.__xlsx = []; window.__pdf = []; window.__open = [];
  window.XLSX = { utils: { json_to_sheet: (rows) => ({ rows }), book_new: () => ({ sheets: [] }), book_append_sheet: (wb, ws, name) => wb.sheets.push({ ws, name }) },
    writeFile: (wb, name) => window.__xlsx.push({ name, sheets: wb.sheets }) };
  window.jspdf = { jsPDF: class { constructor() { this.lastAutoTable = { finalY: 50 }; this.t = []; this.tables = []; }
    setFontSize() {} text(s) { this.t.push(s); } autoTable(o) { this.tables.push(o); }
    save(name) { window.__pdf.push({ name, text: this.t, tables: this.tables }); } } };
  window.open = (u, t, f) => { window.__open.push({ u, t, f }); return null; };`;

const STUB = `
  const KEY = '__smokedb';
  const load = () => JSON.parse(localStorage.getItem(KEY) || '{"users":[],"clients":[],"filings":[],"creds":[],"visitors":[],"balances":[],"n":0}');
  const save = (db) => localStorage.setItem(KEY, JSON.stringify(db));
  window.__calls = [];
  window.fetch = async (url, opts) => {
    const req = JSON.parse(opts.body); window.__calls.push(req);
    const db = load(); const p = req.payload || {};
    const ok = (data) => { save(db); return { ok: true, text: async () => JSON.stringify({ ok: true, data }) }; };
    const err = (e) => ({ ok: true, text: async () => JSON.stringify({ ok: false, error: e }) });
    const upsert = (list, key, prefix) => {
      const i = p[key] ? list.findIndex((r) => r[key] === p[key]) : -1;
      if (i >= 0) { list[i] = { ...list[i], ...p }; return list[i]; }
      const row = { ...p, [key]: prefix + (++db.n) }; list.push(row); return row;
    };
    switch (req.action) {
      case 'bootstrapStatus': return ok({ needsSetup: db.users.length === 0 });
      case 'setupAdmin': {
        if (db.users.length) return err('already_setup');
        const u = { UserID: 'U1', Name: p.name, Username: p.username, Role: 'Admin', password: p.password };
        db.users.push(u); return ok({ session: 'S1', user: { UserID: 'U1', Name: p.name, Role: 'Admin' } });
      }
      case 'login': {
        const u = db.users.find((x) => x.Username === p.username && x.password === p.password);
        return u ? ok({ session: 'S2', user: { UserID: u.UserID, Name: u.Name, Role: u.Role } }) : err('bad_login');
      }
      case 'listClients': return ok(db.clients);
      case 'upsertClient': return ok(upsert(db.clients, 'ClientID', 'C'));
      case 'listFilings': return ok(db.filings);
      case 'upsertFiling': return ok(upsert(db.filings, 'FilingID', 'F'));
      case 'getMasters': return ok({ portals: [], returnTypes: {} });
      case 'listCredentials': return ok(db.creds);
      case 'upsertCredential': return ok(upsert(db.creds, 'CredID', 'K'));
      case 'listVisitors': return ok(db.visitors.filter((r) => p.date ? r.Date === p.date : (!p.month || r.Date.startsWith(p.month))));
      case 'upsertVisitor': return ok(upsert(db.visitors, 'VisitorID', 'V'));
      case 'listBalances': return ok(db.balances.filter((r) => !p.before || r.Date < p.before));
      case 'getDayBalance': return ok(db.balances.find((r) => r.Date === p.date) || null);
      case 'setDayBalance': {
        const i = db.balances.findIndex((r) => r.Date === p.Date);
        if (i >= 0) db.balances[i] = { ...p }; else db.balances.push({ ...p });
        return ok(p);
      }
      default: return ok({});
    }
  };`;

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const TODAY = iso(new Date());
const SOON = iso(new Date(Date.now() + 3 * 86400000));
const callsOf = (page, action) => page.evaluate((a) => window.__calls.filter((c) => c.action === a).map((c) => c.payload), action);
const noJunk = async (page) => {
  const t = await page.locator('body').innerText();
  expect(t).not.toMatch(/\bNaN\b/);
  expect(t).not.toMatch(/\bundefined\b/);
  expect(t).not.toMatch(/\[object /);
};

test('full flow: setup, login, client, filing, vault, visitors, dashboard, exports, whatsapp', async ({ page }) => {
  test.setTimeout(60000);
  await page.route('**/js/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: CONFIGURED }));
  await page.route('**/cdnjs.cloudflare.com/**', (r) => r.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.addInitScript(STUB + FAKES);
  await page.goto('/index.html');

  // 1. First-run setup creates the Admin.
  await expect(page.getByRole('heading', { name: 'Set up your practice' })).toBeVisible();
  await page.fill('input[name=name]', 'S Mohanraj');
  await page.fill('input[name=username]', 'admin');
  await page.fill('input[name=password]', 'goodpass1');
  await page.fill('input[name=confirm]', 'goodpass1');
  await page.getByRole('button', { name: 'Create Admin account' }).click();
  await expect(page.locator('#kpi-clients')).toBeVisible();

  // 2. Logout, then login with the new account.
  await page.getByRole('button', { name: 'Logout' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.fill('input[name=username]', 'admin');
  await page.fill('input[name=password]', 'wrong-pass');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Incorrect username or password' })).toBeVisible();
  await page.fill('input[name=password]', 'goodpass1');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#kpi-clients')).toHaveText('0');
  await noJunk(page);
  // GST Suite Pro link comes from CONFIG.SUITE_URL.
  await expect(page.locator('a.suite-link')).toHaveAttribute('href', 'https://suite.example/app');

  // 3. Add a client.
  await page.getByRole('link', { name: 'Clients' }).click();
  await page.getByRole('button', { name: 'Add client' }).click();
  await page.fill('input[name=Name]', 'Dhoni Traders');
  await page.fill('input[name=GSTIN]', '33ABCDE1234F1Z5');
  await page.fill('input[name=Mobile]', '98765 43210');
  await page.getByRole('button', { name: 'Save client' }).click();
  await expect(page.locator('#cl-list')).toContainText('Dhoni Traders');

  // 4. Log a filed GST filing and a pending Income Tax filing.
  await page.getByRole('link', { name: 'Filings' }).click();
  await page.getByRole('button', { name: 'Log filing' }).click();
  await page.selectOption('select[name=ClientID]', { label: 'Dhoni Traders' });
  await page.selectOption('select[name=Portal]', 'GST');
  await page.fill('input[name=ReturnType]', 'GSTR-3B');
  await page.fill('input[name=Period]', '2026-09');
  await page.fill('input[name=FiledDate]', TODAY);
  await page.fill('input[name=AckNo]', 'AA123');
  await page.selectOption('select[name=Status]', 'Filed');
  await page.getByRole('button', { name: 'Save filing' }).click();
  await expect(page.locator('#fl-list')).toContainText('AA123');
  await page.getByRole('button', { name: 'Log filing' }).click();
  await page.selectOption('select[name=ClientID]', { label: 'Dhoni Traders' });
  await page.selectOption('select[name=Portal]', 'Income Tax');
  await page.fill('input[name=ReturnType]', 'ITR-3');
  await page.fill('input[name=DueDate]', SOON);
  await page.getByRole('button', { name: 'Save filing' }).click();
  await expect(page.locator('#fl-list')).toContainText('ITR-3');
  await noJunk(page);

  // 5. Vault: set master key, add a credential (ciphertext only), reveal it.
  await page.getByRole('link', { name: 'Vault' }).click();
  await page.fill('input[name=mk]', 'smoke-master-key');
  await page.fill('input[name=mk2]', 'smoke-master-key');
  await page.getByRole('button', { name: 'Unlock vault', exact: true }).click();
  await page.getByRole('button', { name: 'Add credential' }).click();
  await page.selectOption('select[name=client]', { index: 0 });
  await page.selectOption('select[name=portal]', 'GST');
  await page.fill('input[name=login]', 'dhoni_gst');
  await page.fill('input[name=pw]', 'Sm0ke-Secret!');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('tr[data-cred]')).toHaveCount(1);
  const cred = (await callsOf(page, 'upsertCredential'))[0];
  expect(cred.Password.startsWith('pmv2:')).toBe(true);
  expect(cred.Password).not.toContain('Sm0ke');
  const wire = await page.evaluate(() => JSON.stringify(window.__calls));
  expect(wire).not.toContain('Sm0ke-Secret');
  expect(wire).not.toContain('smoke-master-key');
  await page.getByRole('button', { name: 'Reveal' }).click();
  await expect(page.locator('.pw-plain')).toHaveText('Sm0ke-Secret!');
  await page.getByRole('button', { name: 'Hide' }).click();

  // 6. Visitors: enter the day and save balances.
  await page.getByRole('link', { name: 'Visitors' }).click();
  await expect(page.locator('#vis-date')).toHaveValue(TODAY);
  const fill = async (cat, count, tax, fees) => {
    const c = page.locator(`[data-cat="${cat}"]`);
    await c.locator('[name=count]').fill(String(count)); await c.locator('[name=tax]').fill(String(tax)); await c.locator('[name=fees]').fill(String(fees));
    await page.getByRole('button', { name: `Save ${cat}` }).click();
    await expect(c.locator('[data-msg]')).toHaveText('Saved');
  };
  await fill('Income Tax', 3, 1000, 500);
  await fill('GST', 2, 0, 700);
  await expect(page.locator('#t-count')).toHaveText('5');
  await page.fill('[name=bank]', '20000');
  await page.getByRole('button', { name: 'Save balances' }).click();
  await expect(page.locator('#bal-msg')).toHaveText('Saved');
  await noJunk(page);

  // 7. Dashboard ties to the data entered.
  await page.getByRole('link', { name: 'Dashboard' }).click();
  await expect(page.locator('#kpi-clients')).toHaveText('1');
  await expect(page.locator('#kpi-filed')).toHaveText('1');
  await expect(page.locator('#kpi-pending')).toHaveText('1');
  await expect(page.locator('#kpi-collect')).toHaveText('₹2,200');
  await expect(page.locator('#td-count')).toHaveText('5');
  await expect(page.locator('#td-tax')).toHaveText('₹1,000');
  await expect(page.locator('#td-fees')).toHaveText('₹1,200');
  await expect(page.locator('#d-bank')).toHaveText('₹20,000');
  await expect(page.locator('#bd-GST')).toHaveText('1');
  await expect(page.locator('#bd-IT')).toHaveText('1');
  await expect(page.locator('#due-list')).toContainText('ITR-3');
  await expect(page.locator('#client-table')).toContainText('Dhoni Traders');
  const donut = await page.evaluate(() => window.__charts[window.__charts.length - 2].cfg.data.datasets[0].data); // latest render: [donut, bars]
  expect(donut).toEqual([1, 1, 0, 0]);
  await noJunk(page);

  // 8. Reports: Excel exports, client PDF, wa.me URL.
  await page.getByRole('link', { name: 'Reports' }).click();
  await expect(page.locator('#rp-pick option')).toHaveCount(2);
  await page.selectOption('#rp-pick', { label: 'Dhoni Traders' });
  await page.click('#rp-x-filings');
  await page.fill('#rp-vmonth', '');
  await page.click('#rp-x-visitors');
  await expect(page.locator('#rp-err')).toContainText('Choose a month'); // empty month never exports
  await page.fill('#rp-vmonth', TODAY.slice(0, 7));
  await page.click('#rp-x-visitors');
  await expect.poll(() => page.evaluate(() => window.__xlsx.map((x) => x.name))).toEqual(['filings-register.xlsx', `visitors-${TODAY.slice(0, 7)}.xlsx`]);
  const xl = await page.evaluate(() => window.__xlsx);
  expect(xl[0].sheets[0].ws.rows).toHaveLength(2);
  expect(xl[1].sheets[0].ws.rows.length).toBeGreaterThan(0);
  await page.click('#rp-pdf');
  const pdf = await page.evaluate(() => window.__pdf);
  expect(pdf).toHaveLength(1);
  expect(pdf[0].name).toBe('Dhoni_Traders_filing_status.pdf');
  await expect(page.locator('#rp-preview')).toContainText('GSTR-3B 2026-09');
  await page.click('#rp-wa');
  const opened = await page.evaluate(() => window.__open);
  expect(opened).toHaveLength(1);
  expect(opened[0].u).toMatch(/^https:\/\/wa\.me\/919876543210\?text=.+/);
  expect(decodeURIComponent(opened[0].u.split('?text=')[1])).toContain('Dhoni Traders');
  await noJunk(page);
});

test('mobile: 16px gutters, no horizontal scroll on any page, GST Suite Pro reachable, menu aria-expanded', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.route('**/js/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: CONFIGURED }));
  await page.route('**/cdnjs.cloudflare.com/**', (r) => r.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.addInitScript(`localStorage.setItem('__smokedb', JSON.stringify({users:[{UserID:'U1',Name:'Admin',Username:'admin',Role:'Admin',password:'goodpass1'}],clients:[{ClientID:'C1',Name:'A Very Long Client Name Private Limited',GSTIN:'33ABCDE1234F1Z5',Mobile:'98765 43210'}],filings:[{FilingID:'F1',ClientID:'C1',Portal:'GST',ReturnType:'GSTR-3B',Period:'2026-09',Status:'Filed',FiledDate:'${TODAY}',AckNo:'AA123456789012345'}],creds:[],visitors:[],balances:[],n:5}));` + STUB + FAKES);
  await page.goto('/index.html');
  await page.fill('input[name=username]', 'admin');
  await page.fill('input[name=password]', 'goodpass1');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#kpi-clients')).toBeVisible();

  const menu = page.locator('.menu-btn');
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await menu.click();
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  const suite = page.locator('a.suite-nav');
  await expect(suite).toBeVisible();
  await expect(suite).toHaveAttribute('href', 'https://suite.example/app');
  await menu.click();
  await expect(menu).toHaveAttribute('aria-expanded', 'false');

  for (const route of ['dashboard', 'clients', 'filings', 'vault', 'visitors', 'reports']) {
    await page.evaluate((r) => { location.hash = '#/' + r; }, route);
    await page.waitForTimeout(250);
    const m = await page.evaluate(() => ({
      over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      left: document.querySelector('#view').getBoundingClientRect().left,
      pad: parseFloat(getComputedStyle(document.querySelector('#view')).paddingLeft),
    }));
    expect(m.over, `horizontal overflow on ${route}`).toBeLessThanOrEqual(0);
    expect(m.pad).toBe(16);
  }
});

test('editing a filing keeps an unknown Portal/Status instead of normalising it', async ({ page }) => {
  await page.route('**/js/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: CONFIGURED }));
  await page.route('**/cdnjs.cloudflare.com/**', (r) => r.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.addInitScript(`localStorage.setItem('__smokedb', JSON.stringify({users:[{UserID:'U1',Name:'Admin',Username:'admin',Role:'Admin',password:'goodpass1'}],clients:[{ClientID:'C1',Name:'Acme'}],filings:[{FilingID:'F1',ClientID:'C1',Portal:'Customs',ReturnType:'BoE',Period:'2026-09',Status:'Revised',FiledDate:'2026-10-02',AckNo:'Z9'}],creds:[],visitors:[],balances:[],n:5}));` + STUB + FAKES);
  await page.goto('/index.html');
  await page.fill('input[name=username]', 'admin');
  await page.fill('input[name=password]', 'goodpass1');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('link', { name: 'Filings' }).click();
  await page.getByRole('button', { name: 'Edit filing BoE' }).click();
  await expect(page.locator('select[name=Portal]')).toHaveValue('Customs');
  await expect(page.locator('select[name=Status]')).toHaveValue('Revised');
  await page.fill('input[name=AckNo]', 'Z10');
  await page.getByRole('button', { name: 'Save filing' }).click();
  await expect(page.locator('#fl-list')).toContainText('Z10');
  const sent = (await callsOf(page, 'upsertFiling'))[0];
  expect(sent).toMatchObject({ Portal: 'Customs', Status: 'Revised', FiledDate: '2026-10-02', AckNo: 'Z10' });
});

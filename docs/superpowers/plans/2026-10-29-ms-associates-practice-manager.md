# MS Associates Practice Manager — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a hosted web app for MS Associates to manage clients, filing history, a credential vault, a daily visitor/collection note, filing dashboards, and per-client Excel/WhatsApp/PDF reports, backed by Google Sheets.

**Architecture:** A static multi-file front end (plain HTML/CSS/ES modules) talks to one Google Apps Script Web App over a small JSON action API. Backend logic lives in a pure, injectable `core` module (unit-tested in Node with an in-memory store) wired to `SpreadsheetApp` by a thin `Code.gs` adapter. Front-end pure logic (encryption, aggregation, balances, report/message builders) lives in testable ES modules; views are thin. Vault passwords are AES-encrypted in the browser with a firm-wide master key and only ever stored/transmitted as ciphertext.

**Tech Stack:** HTML/CSS/vanilla ES modules; Chart.js, SheetJS (xlsx), jsPDF + jspdf-autotable (CDN); crypto-js (AES). Backend: Google Apps Script. Tests: Vitest (Node unit) + Playwright (e2e smoke). Hosting: Vercel or GitHub Pages; backend deployed as an Apps Script Web App.

**Spec:** `docs/superpowers/specs/2026-10-29-ms-associates-practice-manager-design.md`

## Global Constraints

- No paid services; no server the firm maintains (static host + Apps Script only).
- Vault secrets: **only ciphertext** is ever transmitted or stored; master key stays in browser memory, never sent, never persisted. No recovery back door.
- No endpoint returns `Users` password hashes; login is verified server-side.
- Firm identity/copy: brand "MS Associates", "S. Mohanraj, ACS". Palette: navy `#0f172a`/`#1e3a5f`, teal/cyan accents; categorical colours IT=`#4f46e5`, GST=`#059669`, MCA=`#d97706`, Others=`#0891b2`.
- CDN libraries pinned to exact versions (≥ 2 weeks old). All other code inline/local.
- Money is INR; dates stored ISO `YYYY-MM-DD`, displayed `DD MMM YYYY`.
- The existing `GST_Suite_Pro.html` is not modified.

## Review Focus

- **Wrong/empty master key on decrypt** — a bad key must fail loudly (clear "wrong master key" message), never render garbled passwords or crash the vault. (Task 7)
- **Client phone with no country code / spaces / missing number** — WhatsApp link must normalise to `91XXXXXXXXXX` and disable the button when no valid number exists. (Task 10)
- **Day balance when the previous day has no record** — carry-forward must fall back to the last recorded closing (or zero on first use), not break the running total. (Task 8)
- **Concurrent edits from two staff (last-write-wins)** — an upsert must not silently blank fields it didn't send; unknown/missing columns are preserved. (Task 1)
- **Filing with missing ack no. / date (Pending status)** — dashboards, counts and reports must treat it as pending and never show "undefined"/NaN. (Tasks 6, 9, 10)

---

### Task 1: Backend core + in-memory store (data layer)

**Files:**
- Create: `backend/core.js` (pure logic; `export`s for Node, also attached to `globalThis` for Apps Script)
- Create: `backend/store-memory.js` (in-memory `SheetStore` for tests)
- Test: `backend/__tests__/core.store.test.js`

**Interfaces:**
- Produces: `SheetStore` interface — `readTable(name): Row[]`, `appendRow(name, row): Row` (assigns id), `updateRowById(name, idField, id, patch): Row` (merge-patch; preserves unsent fields), `deleteRowById(name, idField, id): void`, `ensureTabs(schema): void`.
- Produces: `TABS` schema constant (tab name → column list) matching spec §7.
- Produces: `newId(prefix): string`.

- [ ] **Step 1: Write failing tests** — `appendRow` assigns an id and returns the row; `updateRowById` merges a patch and **leaves unsent columns unchanged**; `deleteRowById` removes; `readTable` returns objects keyed by header. Include the Review-Focus case: update with `{Name:'X'}` does not blank `GSTIN`.

```js
test('updateRowById preserves unsent fields', () => {
  const s = memStore({Clients:[['ClientID','Name','GSTIN']]});
  const r = s.appendRow('Clients',{Name:'A',GSTIN:'33AAA'});
  s.updateRowById('Clients','ClientID',r.ClientID,{Name:'B'});
  expect(s.readTable('Clients')[0]).toMatchObject({Name:'B',GSTIN:'33AAA'});
});
```

- [ ] **Step 2: Run tests, verify fail** — `npx vitest run backend/__tests__/core.store.test.js` → FAIL (module/functions missing).
- [ ] **Step 3: Implement** `TABS`, `newId`, and `store-memory.js` implementing the `SheetStore` interface.
- [ ] **Step 4: Run tests, verify pass.**
- [ ] **Step 5: Commit** — `feat(backend): data store abstraction + schema`.

---

### Task 2: Backend API dispatch + auth-less actions

**Files:**
- Modify: `backend/core.js` (add `handle(request, store, deps)`)
- Test: `backend/__tests__/core.api.test.js`

**Interfaces:**
- Consumes: Task 1 `SheetStore`, `TABS`.
- Produces: `handle(req, store, deps) -> {ok, data?, error?}` where `req = {action, token, session, payload}`. `deps = {now, hashFn, randomFn}` (injected for testability).
- Produces action names (data actions added in later tasks route through here): `bootstrapStatus`, `getMasters`.
- Produces: token check — requests with a wrong `token` return `{ok:false,error:'bad_token'}` **except** `bootstrapStatus`.

- [ ] **Step 1: Write failing tests** — unknown action → `error:'unknown_action'`; wrong token → `error:'bad_token'`; `getMasters` returns portal + return-type lists from the `Masters` tab.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** `handle` dispatch + token gate (obscurity token per spec §8.3) + `getMasters`.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `feat(backend): api dispatch + masters`.

---

### Task 3: Auth — bootstrap, login, sessions, profile (server-side)

**Files:**
- Modify: `backend/core.js`
- Test: `backend/__tests__/core.auth.test.js`

**Interfaces:**
- Consumes: Task 2 `handle`, `deps.hashFn(salt, pw)`.
- Produces actions: `setupAdmin({name,username,password})` (only works while `Users` empty), `login({username,password}) -> {session, user:{UserID,Name,Role}}`, `updateProfile(session,{name,contact,password?})`, `listUsers`/`upsertUser`/`deactivateUser` (Admin only).
- Produces: `session` = signed opaque string encoding `{UserID,Role,exp}`; verified by `requireSession(req)`; **no response ever includes `PassHash`**.

- [ ] **Step 1: Write failing tests** — `setupAdmin` creates the first Admin then refuses once a user exists; `login` with correct creds returns a session and a user **without** `PassHash`; wrong password → `error:'bad_login'`; `upsertUser` as Staff → `error:'forbidden'`; `updateProfile` changes own name and, if given, re-hashes password.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** auth actions; salted hash via `deps.hashFn`; role guard helper.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `feat(backend): auth, sessions, profile, users`.

---

### Task 4: Backend CRUD — clients, filings, credentials, visitors, balances

**Files:**
- Modify: `backend/core.js`
- Test: `backend/__tests__/core.crud.test.js`

**Interfaces:**
- Consumes: Task 1 store, Task 3 `requireSession`.
- Produces actions (all require a valid session): `listClients`/`upsertClient`/`deleteClient`; `listFilings({clientId?})`/`upsertFiling`/`deleteFiling`; `listCredentials({clientId?})`/`upsertCredential`/`deleteCredential` (**Password column stored & returned verbatim as ciphertext — backend never decrypts**); `listVisitors({date?|month?})`/`upsertVisitor`; `getDayBalance({date})`/`setDayBalance`.
- Produces row shapes exactly per spec §7 column lists.

- [ ] **Step 1: Write failing tests** — round-trip upsert/list for each entity; `upsertCredential` stores the `Password` string unchanged and the backend has no decrypt path; `deleteClient` cascades nothing (filings/creds remain, flagged orphan-safe); session required (missing session → `forbidden`).
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** the CRUD actions over the store.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `feat(backend): crud for clients/filings/credentials/visitors/balances`.

---

### Task 5: Apps Script adapter + deployment doc

**Files:**
- Create: `backend/Code.gs` (thin: builds a `SpreadsheetApp`-backed `SheetStore`, routes `doGet`/`doPost` into `core.handle`)
- Create: `backend/store-sheets.gs` (`SheetStore` over `SpreadsheetApp`)
- Create: `backend/appsscript.json` (web app manifest)
- Create: `docs/deploy-backend.md`

**Interfaces:**
- Consumes: `core.handle`, `TABS`, deps (`Utilities` for hashing/UUID).
- Produces: deployed Web App URL + token to paste into front-end config.

- [ ] **Step 1:** Implement `store-sheets.gs` mirroring the `SheetStore` interface (Task 1), `ensureTabs` creating missing tabs from `TABS`.
- [ ] **Step 2:** Implement `doGet`/`doPost` → parse JSON → `core.handle` → `ContentService` JSON; CORS headers for the static host.
- [ ] **Step 3:** Write `docs/deploy-backend.md`: create Sheet, add Apps Script, set `SCRIPT_TOKEN` in Script Properties, deploy "execute as owner / anyone with link", copy URL.
- [ ] **Step 4: Manual verification** — deploy to a **test** Sheet; `curl` `bootstrapStatus` returns `{ok:true}`. Record result.
- [ ] **Step 5: Commit** — `feat(backend): apps script adapter + deploy guide`.

> **Dependency:** this task's manual step and Task 7's migration need the firm's existing client-login Sheet link + column headings. Build core logic first; wire the real Sheet when provided.

---

### Task 6: Front-end shell — config, API client, nav, auth screens

**Files:**
- Create: `index.html`, `css/app.css`, `js/config.js`, `js/api.js`, `js/auth-ui.js`, `js/router.js`
- Test: `tests/e2e/shell.spec.js` (Playwright), `js/__tests__/api.test.js`

**Interfaces:**
- Produces: `apiCall(action, payload) -> Promise<data>` (adds token + current session; throws on `{ok:false}` with `error`).
- Produces: `session` store (in-memory + `sessionStorage` cache), `currentUser()`, `requireRole(role)`.
- Produces: router with views registered by later tasks: `#/dashboard #/clients #/filings #/vault #/visitors #/reports #/users #/profile`.
- Produces: setup screen (first run), login screen, top bar (brand per Global Constraints) + left nav + "↗ GST Suite Pro" link.

- [ ] **Step 1:** Write `api.test.js` — `apiCall` injects token+session and unwraps `data`; on `{ok:false,error}` it throws that error. Mock `fetch`.
- [ ] **Step 2:** Run, verify fail.
- [ ] **Step 3:** Implement `config.js` (endpoint URL, token), `api.js`, `auth-ui.js` (setup/login/logout), `router.js`, shell layout + theme in `app.css`.
- [ ] **Step 4:** Run unit test (pass). Add Playwright smoke: with a mocked endpoint, setup→login→land on dashboard shell. Run, verify pass.
- [ ] **Step 5: Commit** — `feat(web): app shell, api client, auth screens`.

---

### Task 7: Credential vault + client-side encryption + migration

**Files:**
- Create: `js/crypto.js`, `js/views/vault.js`
- Test: `js/__tests__/crypto.test.js`, `tests/e2e/vault.spec.js`

**Interfaces:**
- Consumes: `apiCall` (`listCredentials`/`upsertCredential`), crypto-js.
- Produces: `encryptSecret(plaintext, masterKey) -> string` (AES, salted), `decryptSecret(ciphertext, masterKey) -> string` (throws `WrongKeyError` on failure), `isCiphertext(s) -> boolean`.
- Produces: master-key prompt (held in memory only), reveal-on-click, add/edit credential, and a one-time **migration** action `migratePlaintext(masterKey)` that encrypts any plaintext passwords found and re-saves as ciphertext.

- [ ] **Step 1: Write failing tests** (Review Focus) — `decryptSecret(encryptSecret(p,k),k) === p`; `decryptSecret(ct,'wrong')` throws `WrongKeyError`; empty key rejected; `isCiphertext` distinguishes a migrated value from raw plaintext.

```js
test('wrong master key fails loudly', () => {
  const ct = encryptSecret('portalPass!', 'rightkey');
  expect(() => decryptSecret(ct, 'wrongkey')).toThrow(WrongKeyError);
});
```

- [ ] **Step 2:** Run, verify fail.
- [ ] **Step 3:** Implement `crypto.js`; vault view that decrypts only in memory after the key is entered, shows "wrong master key" on `WrongKeyError`, and the migration routine.
- [ ] **Step 4:** Run unit tests (pass). Playwright: enter key, add a credential, reload, reveal → correct; wrong key → error, never garbled. Verify pass.
- [ ] **Step 5: Commit** — `feat(web): encrypted credential vault + migration`.

---

### Task 8: Visitor note + daily balances

**Files:**
- Create: `js/balances.js`, `js/views/visitors.js`
- Test: `js/__tests__/balances.test.js`, `tests/e2e/visitors.spec.js`

**Interfaces:**
- Consumes: `apiCall` (`listVisitors`,`upsertVisitor`,`getDayBalance`,`setDayBalance`).
- Produces: `computeDayBalance({prevClose, cashReceipts, cashOutflows, override}) -> {opening, closing}` — `opening = prevClose`; `closing = override ?? opening + cashReceipts - cashOutflows`.
- Produces: `prevCloseFor(date, balances) -> number` — last recorded closing before `date`, else `0` (Review Focus).

- [ ] **Step 1: Write failing tests** — carry-forward across days; **no prior record → opening 0, not NaN**; manual override wins; category totals (IT/GST/Accounts) sum correctly.
- [ ] **Step 2:** Run, verify fail.
- [ ] **Step 3:** Implement `balances.js` + visitor entry/summary view (daily + month), matching the dashboard right-panel layout.
- [ ] **Step 4:** Run tests + Playwright smoke. Verify pass.
- [ ] **Step 5: Commit** — `feat(web): visitor note + carry-forward balances`.

---

### Task 9: Client master, filings, and the filing dashboard

**Files:**
- Create: `js/aggregate.js`, `js/views/clients.js`, `js/views/filings.js`, `js/views/dashboard.js`
- Test: `js/__tests__/aggregate.test.js`, `tests/e2e/filings.spec.js`

**Interfaces:**
- Consumes: `apiCall` (clients/filings), Chart.js, Task 8 balances for the dashboard right panel.
- Produces: `filingBreakdown(filings) -> {IT,GST,MCA,Others}` counts; `monthlyFilingSeries(filings, months) -> [{month,IT,GST,MCA}]`; `dueThisWeek(filings, today) -> Filing[]`; `clientFilingSummary(filings, clientId) -> {filed:[], pending:[]}`.
- Produces: Clients CRUD view (name, GSTIN, PAN, type, contact); Filings view (log filing: portal, return type from masters, period, date, ack no., status); Dashboard (KPI tiles, donut, stacked bars, client-wise table, due-this-week).

- [ ] **Step 1: Write failing tests** — breakdown and monthly series from a fixture; `dueThisWeek` boundary (today..+7); **pending filing (no ack/date) counts as pending and never yields NaN/"undefined"** (Review Focus).
- [ ] **Step 2:** Run, verify fail.
- [ ] **Step 3:** Implement `aggregate.js`; clients + filings CRUD views; dashboard wiring Chart.js with the palette.
- [ ] **Step 4:** Run unit tests + Playwright (add client → add filing → see counts rise). Verify pass.
- [ ] **Step 5: Commit** — `feat(web): clients, filings, filing dashboard`.

---

### Task 10: Reports — Excel, per-client PDF, WhatsApp Web

**Files:**
- Create: `js/report.js`, `js/views/reports.js`
- Test: `js/__tests__/report.test.js`, `tests/e2e/reports.spec.js`

**Interfaces:**
- Consumes: SheetJS, jsPDF+autotable, Task 9 `clientFilingSummary`.
- Produces: `whatsappUrl(phone, message) -> string` — normalises phone to `91XXXXXXXXXX`, returns `https://wa.me/...?text=...`, or `null` when no valid number (Review Focus); `buildClientStatusMessage(client, filings) -> string`; `toExcel(rows, sheetName) -> Blob/download`; `buildClientStatusPdf(client, filings) -> Blob/download`.

- [ ] **Step 1: Write failing tests** — `whatsappUrl` normalises `98765 43210`, `+91-98765-43210`, `919876543210` to the same URL; returns `null` for empty/invalid; message lists filed (with ack no.) and pending; pending with no ack shows "—" not "undefined".
- [ ] **Step 2:** Run, verify fail.
- [ ] **Step 3:** Implement `report.js`; reports view with per-client "WhatsApp" (opens pre-filled) + "PDF" (download) + register "Excel" export.
- [ ] **Step 4:** Run unit tests + Playwright (generate message + trigger downloads). Verify pass.
- [ ] **Step 5: Commit** — `feat(web): excel export, client PDF, whatsapp web`.

---

### Task 11: Polish, deploy config, end-to-end pass

**Files:**
- Create: `vercel.json` (or `/.nojekyll` + notes for GitHub Pages), `README.md`
- Modify: views for responsive layout + empty/error/loading states
- Test: `tests/e2e/smoke.full.spec.js`

**Interfaces:**
- Consumes: everything above against the deployed test backend.

- [ ] **Step 1:** Add loading/empty/error states, mobile layout (16px gutters, no horizontal scroll), consistent iconography; confirm palette per Global Constraints.
- [ ] **Step 2:** Full Playwright smoke: setup → login → add client → log filing → add credential (encrypt/reveal) → visitor entry → dashboard numbers tie → export Excel/PDF → WhatsApp URL built.
- [ ] **Step 3:** Write `README.md` (host on Vercel/GitHub Pages; paste backend URL+token into `js/config.js`; set master key; lock Sheet sharing).
- [ ] **Step 4:** Run full smoke, verify pass.
- [ ] **Step 5: Commit** — `feat: polish, deploy config, full smoke`.

---

## Self-Review

**1. Spec coverage:** Clients (T4,T9) · Filings + date/ack (T4,T9) · Credential vault (T4,T7) · Profile menu/users (T3,T6) · Visitor note + balances (T4,T8) · Filing dashboards IT/GST/MCA/client-wise (T9) · Excel + WhatsApp + PDF (T10) · professional look/charts (T6,T9,T11) · Google Sheets backend + sync (T1–T5) · master-key encryption mandatory, no hash leakage, obscurity token (T2,T3,T4,T7). All spec sections map to a task.

**2. Step scan:** Pure-logic tasks carry test assertions + signatures; UI tasks carry interfaces + a smoke test; no "handle edge cases" placeholders. Bodies shown only for the two crypto/store tests that pin behaviour.

**3. Type consistency:** `SheetStore` methods (`readTable/appendRow/updateRowById/deleteRowById/ensureTabs`) identical in T1/T5. `handle(req,store,deps)` and `req={action,token,session,payload}` identical T2–T4. `apiCall(action,payload)` identical T6–T10. `computeDayBalance`/`prevCloseFor` (T8) reused by T9 dashboard. `clientFilingSummary` (T9) reused by T10.

**4. Review Focus:** wrong master key → T7 test; phone normalisation → T10 test; no-prior-day balance → T8 test; last-write-wins field preservation → T1 test; pending filing no ack → T9/T10 tests. All five owned.

**5. Proportion:** Plan is interface- and test-driven, not a code transcript; shorter than the eventual source. OK.

## Existing data (provided) — affects Tasks 1, 5, 7, 9

Sheet "MS FILE STATUS" (`1eDRRWzDEfsmEETvWfllh9z2yXs4rcHC9B0d30ipZzYc`):
- **CLIENT** tab → `Clients` master. Fields: CLIENT ID, CLIENT NAME, GSTIN, Trade Name, Reg.
  Type, STATE, ADDRESS, Mobile, EMAIL ID, USER NAME (GST login), PASSWORD (blank), Filing
  Frequency, Status. Use `CLIENT ID` as `ClientID`. (Update Task 1 `TABS.Clients` to these columns.)
- **CURRENT** tab → GST portal **passwords (plaintext)**, keyed loosely by name/username.
- A **filing-status** tab (per-period GSTR1/GSTR3B Due/Filed/Status, Late Fee, Interest,
  Remarks, Updated At) → feeds `Filings` (GST). *Confirm exact tab name with firm.*

**Task 7 migration add:** `migratePlaintext` also (a) joins CURRENT → clients by normalised
name/username, (b) encrypts and writes GST `Credentials` rows, (c) **returns a list of unmatched
CURRENT rows** for manual mapping (never silently dropped). Add a test: an unmatched name is
reported, not lost.

**Still to confirm with firm:** exact name/location of the filing-status tab (only blocks Task 9's
GST-filing import; Tasks 1–4, 6, 7-core do not need it).

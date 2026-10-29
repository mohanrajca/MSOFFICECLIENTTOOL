# MS Associates — Practice Manager
### Design document

- **Firm:** MS Associates (S. Mohanraj, ACS)
- **Date:** 2026-10-29
- **Status:** Draft for approval

---

## 1. Intent and why

MS Associates runs an accounting / auditing / company-secretary practice. Today the firm
tracks clients, filings, and the government-portal logins for each client informally —
client portal user-IDs and passwords already live in a Google Sheet, filing records are
scattered, and there is no single place to see what has been filed, what is pending, or to
report a client's status back to them.

This project builds a **web-based Practice Manager** that becomes the firm's single office
screen: a master list of clients, a per-client filing history, a credential vault for each
client's IT / GST / MCA (and other) portal logins, a daily visitor-and-collection note, and
dashboards that slice filings by portal and by client — with professional charts and one-click
Excel export and WhatsApp-Web reporting to clients.

**Why now:** the firm is about to host the tool (Vercel / GitHub Pages) so staff can use it
from any machine, which means the data must be shared and always current — not trapped in one
browser.

## 2. Goals

1. **Client master** — add / edit clients with name, GSTIN, PAN, entity type, contact.
2. **Filing history per client** — log each filing: portal (IT / GST / MCA / other), return
   type, period, filing date, acknowledgment number, status (Pending / Filed).
3. **Credential vault** — store each client's portal logins (IT, GST, MCA, TRACES, etc.);
   password revealed only on click, behind the office login.
4. **Profile menu** — logged-in users (staff) can update their own profile (name, contact,
   password); admin manages the user list.
5. **Daily visitor & collection note** — footfall by category (Income-Tax / GST / Accounts),
   tax vs fees collected, running cash & bank balances — modeled on the firm's sample screen.
6. **Filing dashboards** — counts and charts sliced IT-wise / GST-wise / MCA-wise and
   client-wise; "what's due this week," "filed this month."
7. **Excel export + WhatsApp Web** — export reports to `.xlsx`; per-client filing-status report
   generated as a text message (opens in WhatsApp Web, pre-filled to the client's number) **and**
   as a downloadable PDF to attach.
8. **Professional presentation** — infographic KPI tiles, charts, clean office-grade UI
   (navy + teal direction, approved from mockup).

## 3. Non-goals

- Not rebuilding the existing **GST_Suite_Pro.html** tools (Day Book, GSTR-1/2B/3B parsers,
  Financials, Audit). This app **links across** to them; it does not replace them.
- No actual filing on government portals; the app records filings, it does not submit them.
- No automatic logging into IT/GST/MCA portals with the stored credentials.
- No accounting ledger / Tally replacement — the visitor note is a daily cash/fees register,
  not double-entry books.

## 4. Anti-goals (would make this a failure even if it "works")

- **Leaking client portal passwords.** A design where any passer-by or any person on the
  internet can read the vault is a failure, even if every feature works.
- A tool so slow or fiddly to update that staff keep their own side-notes instead — the shared
  data must stay the single source of truth.
- A dashboard that looks impressive but shows numbers staff don't trust (filing counts must tie
  to the filing records).

## 5. Constraints

- **Hosting:** static front-end on Vercel or GitHub Pages (no server the firm maintains).
- **Storage (chosen):** Google Sheets as the shared database, read/written via a Google Apps
  Script Web App endpoint, two-way sync. (Chosen by the firm; see Approaches.)
- **Credentials already in a Google Sheet** — the app reads the firm's existing sheet rather
  than inventing a new store.
- **No paid services.** Rules out the official WhatsApp Business API (so WhatsApp is send-assist
  via WhatsApp Web, not auto-send) and any paid database.
- Must run in a normal desktop browser; primary users are the proprietor and office staff.

## 6. Approaches considered

### 6a. Storage / backend (the main architectural fork)

| Option | What it is | Why / why not |
|---|---|---|
| **A. Google Sheets + Apps Script** ✅ chosen | Sheet tabs act as tables; a deployed Apps Script Web App serves/accepts JSON; the page syncs both ways. | Free; the firm already keeps client logins in Sheets; data is human-readable and editable. Downsides accepted: Apps Script latency/quotas, DIY auth, and plaintext storage (mitigated — see §8). |
| B. Supabase | Hosted Postgres + Auth + row-level security. | Recommended for safety (encrypted, real auth), but the firm chose Sheets because the credential data already lives there. |
| C. Firebase | Firestore + Google auth, realtime. | Similar to B; NoSQL modeling more awkward for the client/filing tables; not chosen. |

**Decision:** Option A — Google Sheets + Apps Script, per the firm.

### 6b. App shell

| Option | Why / why not |
|---|---|
| **New standalone single-page app** ✅ (builder's recommendation) | A clean app whose architecture is Sheets-backed + multi-user from the start, styled to match, with a link to the existing GST Suite Pro. Keeps the 343 KB legacy file untouched. |
| Bolt modules into existing `GST_Suite_Pro.html` | The existing app is single-user `localStorage`; retrofitting shared-Sheets sync + multi-user login into it is heavier and riskier than a fresh shell. Not chosen. |

> **Decision (confirmed by firm):** build as a **new, separate** app (`Practice_Manager.html`,
> or a small multi-file app) — independent of the existing GST_Suite_Pro.html, which is left
> untouched. An optional link across to the GST Suite Pro tools is included for convenience.

## 7. The "how" — decided design

**Front end:** one single-page app, vanilla HTML/CSS/JS (matches house style), no heavy
framework. Libraries from CDN (allowed on Vercel/GitHub Pages):
- **Chart.js** — donut + stacked bar + trend charts.
- **SheetJS (xlsx)** — Excel export.
- **jsPDF + jspdf-autotable** — per-client PDF report.

**Navigation (left rail or top tabs):** Dashboard · Clients · Filings · Credentials · Visitor
Note · Reports · Users/Profile · ↗ GST Suite Pro.

**Back end:** one Google Apps Script Web App (`doGet`/`doPost`) bound to the firm's Google Sheet,
deployed "execute as owner." All reads/writes go through it as JSON. A shared **secret token** is
required on every request (see §8).

**Google Sheet tabs (schema):**
- `Clients` — ClientID, Name, GSTIN, TradeName, RegType, State, Address, Mobile, Email,
  FilingFrequency, Status (adopts the real **CLIENT** tab of MS FILE STATUS; PAN/EntityType
  optional add-ons).
- `Filings` — FilingID, ClientID, Portal, ReturnType, Period, FiledDate, AckNo, Status, FiledBy
  (general log for IT / MCA / other). **GST period status** is also kept in the firm's existing
  per-period shape (Period, Month, Year, GSTR1 Due/Filed/Status, GSTR3B Due/Filed/Status, Late
  Fee, Interest, Remarks) — see reconciliation note.
- `Credentials` — CredID, ClientID, Portal (GST/IT/MCA/TRACES/…), LoginID, Password(enc), Notes,
  UpdatedBy, UpdatedOn. GST rows seeded from CLIENT.`USER NAME` + the CURRENT tab's passwords,
  then encrypted; IT & MCA slots added empty for the firm to fill.
- `Users` — UserID, Name, Username, PassHash, Role (Admin/Staff), Contact, Active.
- `Visitors` — Date, Category, VisitorCount, TaxAmt, FeesAmt, EnteredBy.
- `DayBalances` — Date, CashBalance, BankBalance, Note.
- `Masters` — portal list + return-type list per portal (so dropdowns are data-driven).

**Auth / profile:** app-level login against `Users` (salted hash). **Login verification runs
inside the Apps Script** (server side) — the browser sends username + password, the script
checks the hash and returns only a session result; password hashes never leave the server, and
no endpoint ever returns the `Users` hash column. First-run **bootstrap**: if the `Users` tab is
empty, a one-time setup screen creates the initial Admin. Roles: **Admin** (full, manages users
and all data) and **Staff** (manage clients/filings/visitors, view credentials, edit **own**
profile only). Profile menu = edit own name/contact/password.

**Dashboards:** filing counts by portal (donut), monthly trend (stacked bars IT/GST/MCA),
client-wise filing table with status, "due this week" list. All computed from `Filings`.

**Visitor note:** daily entry form → `Visitors` + `DayBalances`; the dashboard's right panel and
a day/month summary render from these.

**Reports / WhatsApp / Excel:**
- **Excel:** any table (client filing history, filings register, visitor register) → `.xlsx`.
- **Per-client status:** builds a text summary (what's filed, what's pending, ack numbers),
  opens **WhatsApp Web** via `https://wa.me/<number>?text=<encoded message>` pre-filled to that
  client, **and** generates a matching **PDF** download to attach. (Attach step is manual — a
  browser app cannot auto-attach a file to WhatsApp Web; accepted.)

**Daily balances (settled):** `DayBalances` carries forward — each day's opening = previous
day's closing; closing = opening + day's cash receipts − cash outflows, with a **manual override
box** so staff can correct to the actual counted cash/bank figure. Bank balance is entered/
adjusted manually (no bank feed).

**Branding/look:** navy (`#0f172a`/`#1e3a5f`) + teal/cyan accents; categorical colours IT=indigo,
GST=emerald, MCA=amber, Others=cyan; KPI tiles, rounded cards. Approved from the mockup.

## 8. Security (critical — see anti-goals)

**Chosen model: master-key encryption ("Master key only").** The firm chose not to gate the
site behind Google sign-in, so the app is reachable from its public link and the Apps Script
endpoint can be hit by anyone who finds the URL. That makes **encryption-at-rest the one real
protection for the vault** — it is therefore **mandatory, not optional**. The design holds to
the §4 anti-goal by ensuring that what travels over the wire and sits in the Sheet is *useless
ciphertext* without the master key, and that nothing else sensitive is ever returned.

Decisions:
1. **Vault passwords are AES-encrypted** (crypto-js) with a single **firm-wide master key**.
   - The master key is entered once per session, held only in browser memory, **never sent to
     the script and never stored** anywhere.
   - The `Credentials` sheet holds **only ciphertext**; the endpoint returns only ciphertext;
     decryption happens in the browser after the master key is entered.
   - **No recovery / no back door:** if the master key is lost to everyone, stored portal
     passwords cannot be decrypted and must be re-entered from the portals. This is shown as a
     loud warning at setup. (Firm-wide single key, no per-user keys — confirmed default.)
   - **One-time migration:** at setup, the firm's existing plaintext portal passwords are read
     once and re-saved as ciphertext; the plaintext is then cleared from the working sheet.
2. **No sensitive data is ever returned in readable form.** Login hashes stay server-side
   (§7); credentials come back only as ciphertext; the endpoint exposes no "dump everything"
   call without a valid session.
3. **Obscurity token (not access control).** Requests carry a token to cut casual URL hits and
   basic abuse — but it is explicitly *not* treated as the security boundary (it ships in the
   client and is readable). The encryption in (1) is the boundary.
4. **Sheet sharing locked down** to the firm's Google accounts only (defence in depth).
5. Passwords shown in the UI only on explicit click, behind the app login; not printed in
   exports by default.
6. Served over HTTPS (Vercel / GitHub Pages provide it).

> **Residual risk the firm accepted:** without site-level sign-in, the *existence* of the app
> and its non-credential data (client names, filing records) are reachable behind only the app
> login screen. The portal passwords themselves remain protected by encryption. If the firm
> later wants the whole app private, add Google sign-in (the "Master key + Google sign-in"
> option) without changing the rest of the build.

## 9. What's left to the builder

- Exact field list / validation for Clients and Filings forms (sensible CA-practice defaults).
- Final portal + return-type master lists (IT: ITR-1..7, TDS 24Q/26Q, etc.; GST: GSTR-1/3B/9/9C;
  MCA: AOC-4/MGT-7/ADT-1/DIR-3 KYC/INC-20A; plus TRACES, PF/ESI, Professional Tax).
- Page-by-page layout beyond the approved dashboard (forms, tables, modals) in the approved style.
- Apps Script request/response contract and error handling.
- Offline/cache behaviour and sync-conflict handling (last-write-wins vs timestamp check).
- `.gitignore` of `.superpowers/` if the project is committed.

---

### Decisions — resolved
1. **App shell:** new, separate app (not editing GST_Suite_Pro.html). ✅ confirmed by firm.
2. **Vault security:** master-key encryption only; encryption-at-rest mandatory; firm-wide key,
   no recovery, one-time migration of existing plaintext. ✅ confirmed by firm (§8).
3. **Auth:** verified inside Apps Script; hashes never returned; first-admin bootstrap. (Builder's call.)
4. **Daily balances:** carried forward with manual override. (Builder's call.)

### Existing data — reconciliation (sheet "MS FILE STATUS", provided)
Spreadsheet ID `1eDRRWzDEfsmEETvWfllh9z2yXs4rcHC9B0d30ipZzYc`. Observed tabs:
- **CLIENT** — the real client master (fields above). Has `USER NAME` (GST portal login id);
  its `PASSWORD` column is blank. Stable `CLIENT ID` exists → use as `ClientID`.
- **CURRENT** — GST portal **passwords in plaintext**, keyed loosely by client **name** (some
  entries use the username or a variant, with trailing spaces / case differences). Matching
  CURRENT→CLIENT is fuzzy → migration must match on normalised name/username and **surface any
  unmatched rows for manual mapping** (don't silently drop).
- A **filing-status** tab in the firm's per-period shape (GSTR1/GSTR3B Due/Filed/Status, Late
  Fee, Interest, Remarks, Updated At) — *confirm exact tab name/location with firm.*

Migration (one-time): import CLIENT → `Clients`; join CURRENT passwords to each client, encrypt
with the master key, write to `Credentials` as GST rows; report unmatched CURRENT rows. The app
then reads/writes this same spreadsheet (new tabs `Users`, `Visitors`, `DayBalances`, `Masters`
are auto-created via `ensureTabs`).

### Confirmed scope note
Vault holds **IT, GST and MCA** logins per client (per the original request); today only GST
logins exist, so IT/MCA start empty.

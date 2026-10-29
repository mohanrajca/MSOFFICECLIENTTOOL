# MS Associates Practice Manager

A small practice-management app for MS Associates (S. Mohanraj, ACS): a static, no-build front end
(plain ES modules) plus a Google Apps Script backend that stores everything in the firm's Google Sheet.

What it does:

- **Clients** master list and **Filings** log (Income Tax, GST, MCA and others) with due date, filed date and ack no.
- **Credential vault** for client portal logins, encrypted in the browser with a master key.
- **Visitor note**: daily footfall and collections per category with carry-forward cash and bank balances.
- **Dashboard**: KPIs, filing breakdown and monthly charts, client-wise table, due this week, today's visitors.
- **Reports**: per-client status over WhatsApp Web (pre-filled `wa.me` link) and PDF, plus Excel exports.
- Role-based users (Admin / Staff) with signed sessions; a shared API token gates the backend.

## 1. Deploy the backend (Google Apps Script)

Follow [`docs/deploy-backend.md`](docs/deploy-backend.md). In short: `npm install`, `npm run build:gas`,
paste `dist/core.gs`, `dist/sheet-mapping.gs`, `backend/store-sheets.gs` and `backend/Code.gs` into the Sheet's
Apps Script project, set the `SCRIPT_TOKEN` and `SESSION_SECRET` script properties, and deploy as a Web app.
Copy the `/exec` URL.

## 2. Configure the front end

Edit `js/config.js`:

```js
export const CONFIG = {
  ENDPOINT_URL: 'https://script.google.com/macros/s/XXXX/exec', // the Web App /exec URL
  TOKEN: '<the same value as SCRIPT_TOKEN>',
  SUITE_URL: 'https://your-gst-suite-pro.example', // optional: shows a "GST Suite Pro" link; blank hides it
};
```

The token is visible to anyone who can load the site, so treat it as an obscurity gate only; real access
control is the per-user login. Rotate `SCRIPT_TOKEN` and `SESSION_SECRET` if either leaks.

## 3. Host the front end

It is plain static files (no build step). Libraries (Chart.js, SheetJS, jsPDF) load from cdnjs.

**Vercel**: import the repository as a project (framework "Other"). `vercel.json` already sets the output
directory to the repo root, so no build command is needed. Or run `npx vercel --prod`.

**GitHub Pages**: push to GitHub, then Settings > Pages > deploy from the branch root. The `.nojekyll` file is
included so Pages serves the `js/` ES modules as-is. The app uses hash routes (`#/dashboard`), so it works from
a sub-path such as `https://<user>.github.io/<repo>/`.

Local preview: `node tests/e2e/static-server.js` then open http://127.0.0.1:4173/.

## 4. First run

Open the site. With no users it shows **Set up your practice**: create the first **Admin**. Everyone else is
added by the Admin afterwards. Missing sheet tabs and new schema columns are created automatically on the first request.

## Master key and the credential vault (read this)

Portal passwords are encrypted **in the browser** (PBKDF2-SHA256 200k iterations, AES-256-GCM, native WebCrypto)
before they are sent. The master key is typed by the user, kept only in memory while the vault is unlocked, and
is **never sent to the server or stored**. The sheet holds ciphertext only.

> **There is NO recovery.** If the master key is forgotten, every saved credential is permanently unreadable.
> Store the key somewhere safe and share it only with people who need it. The first time you unlock an empty
> vault you must type the key twice; a wrong key on a populated vault is rejected rather than showing garbage.

## Lock down the Google Sheet

The web app runs as the account that deployed it and is reachable by anyone with the URL and token, so protect the
Sheet itself: keep its sharing to specific named people (no "anyone with the link"), do not give staff edit access
if they only need the app, and never paste the token or master key into the Sheet.

## One-time legacy import

The firm's existing **CLIENT** tab (clients) and **CURRENT** tab (plaintext GST passwords) are import sources and
are never written. As an Admin, unlock the vault and use **Import from existing sheet**. Clients are imported, GST
passwords are encrypted with your master key and saved, and any CURRENT row that cannot be matched to a client is
listed for manual mapping (never silently dropped).

**Post-migration step 1 (required): after the one-time import has run and you have verified the encrypted vault,
DELETE the plaintext passwords from the Google Sheet's `CURRENT` tab.** The app never writes to or clears that tab,
so until you do this, anyone with Sheet or Admin access can still read those plaintext GST passwords. Keep the
Sheet-lockdown guidance above in force as well.

## Known limitations

- **PDF fonts**: the per-client PDF uses jsPDF's standard fonts, so non-Latin names (for example Tamil) may not
  render. The WhatsApp message and Excel exports are unaffected.
- **GST filing-status import is still pending**: it needs the exact name of the firm's per-period GSTR-1 / GSTR-3B
  status tab. Until it is supplied, existing GST filing history is not imported; log filings in the app.

## Development

    npm install
    npm test            # Vitest unit tests (front end + backend core)
    npx playwright test # browser smoke tests (stubbed backend, no network)
    npm run build:gas   # regenerate dist/core.gs and dist/sheet-mapping.gs

# Deploying the Practice Manager backend (Google Apps Script)

The backend stores data in the firm's Google Spreadsheet (MS FILE STATUS). The app creates and
owns its own tabs (Clients, Filings, Credentials, Users, Visitors, DayBalances, Masters).
The existing **CLIENT** and **CURRENT** tabs are never written; they are only read later by the importer.

## 1. Prepare the code files
`backend/core.js` is an ES module; Apps Script does not accept `export`. Generate the Apps Script copy:

    npm run build:gas          # writes dist/core.gs (strips top-level "export ")

Windows PowerShell equivalent:

    New-Item -ItemType Directory -Force dist
    (Get-Content backend\core.js) -replace '^export ','' | Set-Content dist\core.gs

Safety check (must print nothing; the build script also fails on these):

    grep -nE "^(export \{|export default|import )" backend/core.js

core.js only uses `export function` / `export const` at column 0. It explicitly assigns every symbol the other
files use (TABS, ID_PREFIX, newId, handle, registerAction, requireSession, ACTIONS, PUBLIC_ACTIONS) to `globalThis`,
because top-level `const` is not auto-attached to `globalThis` in Apps Script.

## 2. Add the code to Apps Script
1. Open the **MS FILE STATUS** spreadsheet, then **Extensions > Apps Script**.
2. Add these files to the one project (names matter only for readability; all share one global scope):
   - `core.gs` (paste `dist/core.gs`)
   - `sheet-mapping.gs` (paste `dist/sheet-mapping.gs`; needed by the one-time legacy import)
   - `store-sheets.gs` (from `backend/`)
   - `Code.gs` (from `backend/`; replace the default `Code.gs`)
3. Project Settings > tick **Show "appsscript.json" manifest file**, then replace its contents with `backend/appsscript.json`
   (V8, Asia/Kolkata, web app executes as you, access anyone).
   (Alternatively use `clasp push` with the same files.)

## 3. Set Script Properties
Project Settings > Script Properties > add:

| Property | Value |
|---|---|
| `SCRIPT_TOKEN` | a long random string (e.g. 32+ chars). Shared with the front-end config. |
| `SESSION_SECRET` | a different long random string. Never leave the script. |

Both must be non-empty or the backend fails closed (all non-public calls are rejected).

## 4. Deploy
Deploy > **New deployment** > type **Web app** > Execute as **Me** > Who has access **Anyone** > Deploy.
Authorise the requested spreadsheet permissions. Copy the `/exec` URL.
After any later code change use Deploy > Manage deployments > Edit > New version.

## 5. Connect the front end
Paste the `/exec` URL and `SCRIPT_TOKEN` into the front-end config (Task 6). The front end must POST with
`Content-Type: text/plain` (no custom headers) to avoid a CORS preflight; the response body is JSON text.

## 6. First run
On first load the front end calls `bootstrapStatus`; with no users it shows the setup screen to create the Admin.
The first request also creates any missing app tabs.

## 7. Manual verification
    curl -L -H "Content-Type: text/plain" -d '{"action":"bootstrapStatus"}' "<EXEC_URL>"

(No `-X POST`: `-L` follows Apps Script's 302 and curl switches to GET for the redirect; forcing POST breaks it.)
Alternative: `curl -L "<EXEC_URL>?action=bootstrapStatus"` (GET is allowed for this one read-only action only).

Expected: `{"ok":true,"data":{"needsSetup":true}}`. After the Admin is created it returns `needsSetup:false`.
A non-public action with a wrong token returns `{"ok":false,"error":"bad_token"}`.

## Troubleshooting
- `TABS is not defined` / `createSheetStore is not defined`: core.gs or store-sheets.gs was not added to the project (or the deployment was not updated to a new version).
- `server_error`: see Executions / Cloud logs; the stack trace is logged via `console.error`.

## Notes
- Concurrency: every POST runs under the script lock, so check-then-append actions (setupAdmin, upsertUser, natural-key upserts) are atomic. GET is lock-free and limited to `bootstrapStatus`.
- Data types: only Visitors.{VisitorCount,TaxAmt,FeesAmt} and DayBalances.{CashBalance,BankBalance} are numeric; every other column is plain text, so values like `=SUM(..)` are stored literally and ids/GSTINs/ISO datetimes round-trip unchanged.
- Security: the web app is public; the only gates are `SCRIPT_TOKEN` and user sessions (HMAC-signed with `SESSION_SECRET`). Rotate both if leaked.

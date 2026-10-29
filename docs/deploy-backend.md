# Deploying the Practice Manager backend (Google Apps Script)

The backend stores data in the firm's Google Spreadsheet (MS FILE STATUS). The app creates and
owns its own tabs (Clients, Filings, Credentials, Users, Visitors, DayBalances, Masters).
The existing **CLIENT** and **CURRENT** tabs are never written; they are only read later by the importer.

## 1. Prepare the code files
`backend/core.js` is an ES module; Apps Script does not accept `export`. Make a copy with the
keyword stripped (the file already attaches its API to `globalThis`):

    sed 's/^export //' backend/core.js > core.gs

## 2. Add the code to Apps Script
1. Open the **MS FILE STATUS** spreadsheet, then **Extensions > Apps Script**.
2. Add these files to the one project (names matter only for readability; all share one global scope):
   - `core.gs` (generated above)
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
    curl -L -X POST "<EXEC_URL>" -H "Content-Type: text/plain" -d '{"action":"bootstrapStatus"}'

Expected: `{"ok":true,"data":{"needsSetup":true}}` (use `-L`; Apps Script redirects the response).
After the Admin is created it returns `needsSetup:false`. A non-public action with a wrong token returns `{"ok":false,"error":"bad_token"}`.

## Notes
- Concurrency: every write holds the script lock; `setupAdmin` holds it across its check-then-append.
- Security: the web app is public; the only gates are `SCRIPT_TOKEN` and user sessions (HMAC-signed with `SESSION_SECRET`). Rotate both if leaked.

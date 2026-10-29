/**
 * Web App entry points (Google Apps Script, V8). Thin adapter around core.handle.
 *
 * Requires, in the SAME Apps Script project: core.gs (backend/core.js with the
 * `export` keywords stripped -- see docs/deploy-backend.md) and store-sheets.gs.
 * core attaches its API to globalThis (handle, TABS, ...), so it is referenced
 * via globalThis here.
 *
 * FRONT-END CONTRACT (Apps Script web apps cannot set custom CORS headers):
 *   POST  <exec URL>   Content-Type: text/plain;charset=utf-8   (avoids CORS preflight)
 *         body = JSON text {"action":"...","token":"...","session":"...","payload":{...}}
 *   Response is JSON text ({"ok":true,"data":...} | {"ok":false,"error":"..."}).
 *   Use fetch(url,{method:'POST',body:JSON.stringify(req)}) and res.json()/JSON.parse(await res.text()).
 *   Do NOT set a Content-Type: application/json header (triggers preflight, which fails).
 *   GET <exec URL>?action=bootstrapStatus is the only supported GET (read-only, lock-free).
 *   Every other action must be a POST (token never goes in a URL).
 */

function hex_(bytes) {
  return bytes.map(function (b) { return ('0' + (b < 0 ? b + 256 : b).toString(16)).slice(-2); }).join('');
}

function buildDeps_() {
  var props = PropertiesService.getScriptProperties();
  return {
    now: function () { return Date.now(); },
    randomFn: function () { return Utilities.getUuid(); },
    // KEYED HMAC-SHA256 (hashFn(key, message)); never sha256(key + message).
    // Used for password hashing (key = salt) and session signing (key = sessionSecret).
    hashFn: function (key, message) {
      return hex_(Utilities.computeHmacSha256Signature(String(message), String(key)));
    },
    expectedToken: props.getProperty('SCRIPT_TOKEN') || '',
    sessionSecret: props.getProperty('SESSION_SECRET') || '',
  };
}

function respond_(result) {
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

function run_(req, isWrite) {
  try {
    var store = createSheetStore(SpreadsheetApp.getActiveSpreadsheet());
    store.ensureTabs(globalThis.TABS);
    var deps = buildDeps_();
    // Every POST (possible write) runs under the script lock so check-then-append
    // actions (setupAdmin, upsertUser, natural-key upserts) are atomic. Store writes re-enter the lock.
    if (isWrite) return runLocked(function () { return globalThis.handle(req, store, deps); });
    return globalThis.handle(req, store, deps);
  } catch (err) {
    console.error(err && err.stack);
    return { ok: false, error: 'server_error' };
  }
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return respond_({ ok: false, error: 'bad_request' });
  }
  if (!req || typeof req !== 'object' || Array.isArray(req) || typeof req.action !== 'string' || !req.action) {
    return respond_({ ok: false, error: 'bad_request' });
  }
  return respond_(run_(req, true));
}

// GET is lock-free and therefore restricted to the read-only public action.
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action !== 'bootstrapStatus') return respond_({ ok: false, error: 'bad_request' });
  return respond_(run_({ action: 'bootstrapStatus', payload: {} }, false));
}

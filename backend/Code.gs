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
 *   GET <exec URL>?action=bootstrapStatus is supported for simple reads
 *   (token/session may also be passed as query params; payload as JSON in ?payload=).
 *   Note: GET puts the token in the URL; prefer POST for anything but bootstrapStatus.
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

function run_(req) {
  try {
    var store = createSheetStore(SpreadsheetApp.getActiveSpreadsheet());
    store.ensureTabs(globalThis.TABS);
    var deps = buildDeps_();
    // setupAdmin does check-then-append; serialise it under the script lock
    // (store writes re-enter the same lock).
    if (req.action === 'setupAdmin') {
      return runLocked(function () { return globalThis.handle(req, store, deps); });
    }
    return globalThis.handle(req, store, deps);
  } catch (err) {
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
  if (!req || typeof req !== 'object') return respond_({ ok: false, error: 'bad_request' });
  return respond_(run_(req));
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  var payload = {};
  if (p.payload) {
    try { payload = JSON.parse(p.payload); } catch (err) {
      return respond_({ ok: false, error: 'bad_request' });
    }
  }
  return respond_(run_({ action: p.action, token: p.token, session: p.session, payload: payload }));
}

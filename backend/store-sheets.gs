/**
 * SheetStore over SpreadsheetApp (Google Apps Script, V8).
 * Implements the same interface as backend/store-memory.js:
 *   readTable(name), appendRow(name,row), updateRowById(name,idField,id,patch),
 *   deleteRowById(name,idField,id), ensureTabs(schema).
 *
 * Uses the app's CANONICAL tab names/headers directly (no header mapping).
 * Writes ONLY app-owned tabs. The firm's CLIENT / CURRENT tabs are never
 * opened here; they are import sources read by the importer.
 *
 * Relies on globals from core (loaded in the same Apps Script project):
 *   TABS, ID_PREFIX, newId.
 */

// Tabs holding only text values: force plain-text format so leading zeros,
// long numbers (mobile, GSTIN-like ids) and date-looking strings are preserved.
var TEXT_ONLY_TABS = { Clients: true, Credentials: true, Users: true, Masters: true };

var lockDepth_ = 0;
/** Run fn holding the script lock; re-entrant within one execution. */
function runLocked(fn) {
  if (lockDepth_ > 0) return fn();
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  lockDepth_ = 1;
  try { return fn(); } finally { lockDepth_ = 0; lock.releaseLock(); }
}

function createSheetStore(spreadsheet) {
  var ss = spreadsheet;
  var tz = ss.getSpreadsheetTimeZone() || 'Asia/Kolkata';

  function isEmpty_(v) { return v === undefined || v === null || v === ''; }

  function sheet_(name) {
    var sh = ss.getSheetByName(name);
    if (!sh) throw new Error('Unknown tab: ' + name);
    return sh;
  }

  function headers_(sh) {
    var lastCol = sh.getLastColumn();
    if (lastCol < 1) return [];
    return sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h); });
  }

  // Sheets auto-converts date-looking input into Date objects; normalise back to text.
  function cellOut_(v) {
    if (v instanceof Date) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
    return v;
  }

  function rowToObj_(headers, values) {
    var o = {};
    for (var i = 0; i < headers.length; i++) o[headers[i]] = cellOut_(values[i]);
    return o;
  }

  // Re-entrant script lock: a caller (Code.gs) may hold the lock around a whole
  // check-then-append action; nested store writes then join it instead of deadlocking.
  function withLock_(fn) {
    return runLocked(fn);
  }

  function findRowIndex_(sh, headers, idField, id) {
    var col = headers.indexOf(idField);
    if (col < 0) throw new Error(sh.getName() + ': no column ' + idField);
    var last = sh.getLastRow();
    if (last < 2) return -1;
    var ids = sh.getRange(2, col + 1, last - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(cellOut_(ids[i][0])) === String(id)) return i + 2; // 1-based sheet row
    }
    return -1;
  }

  return {
    ensureTabs: function (schema) {
      withLock_(function () {
        Object.keys(schema).forEach(function (name) {
          if (ss.getSheetByName(name)) return;
          var cols = schema[name];
          var sh = ss.insertSheet(name);
          sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
          sh.setFrozenRows(1);
          if (TEXT_ONLY_TABS[name]) {
            sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@');
          }
        });
      });
    },

    readTable: function (name) {
      var sh = sheet_(name);
      var headers = headers_(sh);
      var last = sh.getLastRow();
      if (last < 2 || !headers.length) return [];
      var data = sh.getRange(2, 1, last - 1, headers.length).getValues();
      return data.map(function (r) { return rowToObj_(headers, r); });
    },

    appendRow: function (name, row) {
      return withLock_(function () {
        var sh = sheet_(name);
        var headers = headers_(sh);
        var idField = (TABS[name] || headers)[0];
        var out = {};
        headers.forEach(function (h) { out[h] = isEmpty_(row[h]) ? '' : row[h]; });
        if (isEmpty_(out[idField])) {
          var prefix = Object.prototype.hasOwnProperty.call(ID_PREFIX, name) ? ID_PREFIX[name] : '';
          if (prefix === null) throw new Error(name + '.' + idField + ' is required (natural key)');
          out[idField] = newId(prefix);
        }
        sh.appendRow(headers.map(function (h) { return out[h]; }));
        return rowToObj_(headers, headers.map(function (h) { return out[h]; }));
      });
    },

    // Merge-patch: only fields present in patch change; id field and unknown columns ignored.
    updateRowById: function (name, idField, id, patch) {
      return withLock_(function () {
        var sh = sheet_(name);
        var headers = headers_(sh);
        var r = findRowIndex_(sh, headers, idField, id);
        if (r < 0) throw new Error(name + ': row ' + id + ' not found');
        var range = sh.getRange(r, 1, 1, headers.length);
        var values = range.getValues()[0];
        headers.forEach(function (h, i) {
          if (h !== idField && Object.prototype.hasOwnProperty.call(patch, h)) values[i] = patch[h];
        });
        range.setValues([values]);
        return rowToObj_(headers, values);
      });
    },

    deleteRowById: function (name, idField, id) {
      withLock_(function () {
        var sh = sheet_(name);
        var headers = headers_(sh);
        var r = findRowIndex_(sh, headers, idField, id);
        if (r < 0) throw new Error(name + ': row ' + id + ' not found');
        sh.deleteRow(r);
      });
    },
  };
}

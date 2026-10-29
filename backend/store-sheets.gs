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
 * Globals required from core.gs (same project): TABS, ID_PREFIX, newId.
 * (If you see "TABS is not defined", core.gs was not added to the project.)
 */

// The ONLY numeric columns. Every other column is plain text ('@'), which stops
// formula injection (=,+,-,@ prefixes) and preserves ids, GSTINs, leading zeros
// and ISO date/datetime strings exactly. Drives both write format and read coercion.
var NUMERIC_COLUMNS = {
  Visitors: { VisitorCount: true, TaxAmt: true, FeesAmt: true },
  DayBalances: { CashBalance: true, BankBalance: true },
};

var lockDepth_ = 0;
/** Run fn holding the script lock; re-entrant within one execution. */
function runLocked(fn) {
  if (lockDepth_ > 0) return fn();
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  lockDepth_ = 1;
  try { return fn(); } finally { lockDepth_ = 0; lock.releaseLock(); }
}

function isNumericCol_(tab, col) {
  return !!(NUMERIC_COLUMNS[tab] && NUMERIC_COLUMNS[tab][col]);
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

  // Read coercion (matches store-memory): numeric cols -> Number ('' if blank), others -> String.
  function cellOut_(tab, col, v) {
    if (isNumericCol_(tab, col)) {
      if (v === '' || v === null || v === undefined) return '';
      var n = Number(v);
      return isNaN(n) ? '' : n;
    }
    if (v instanceof Date) return Utilities.formatDate(v, tz, "yyyy-MM-dd'T'HH:mm:ss"); // legacy safety only
    return v === null || v === undefined ? '' : String(v);
  }

  function rowToObj_(tab, headers, values) {
    var o = {};
    for (var i = 0; i < headers.length; i++) o[headers[i]] = cellOut_(tab, headers[i], values[i]);
    return o;
  }

  function findRowIndex_(sh, headers, idField, id) {
    var col = headers.indexOf(idField);
    if (col < 0) throw new Error(sh.getName() + ': no column ' + idField);
    var last = sh.getLastRow();
    if (last < 2) return -1;
    var ids = sh.getRange(2, col + 1, last - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(cellOut_(sh.getName(), idField, ids[i][0])) === String(id)) return i + 2;
    }
    return -1;
  }

  function formatColumns_(sh, name, cols) {
    cols.forEach(function (c, i) {
      sh.getRange(1, i + 1, sh.getMaxRows(), 1).setNumberFormat(isNumericCol_(name, c) ? '0.######' : '@');
    });
  }

  // Cell values to write: strings for text columns (kept literal by '@' format).
  function cellIn_(tab, col, v) {
    if (isEmpty_(v)) return '';
    if (isNumericCol_(tab, col)) return Number(v);
    return String(v);
  }

  return {
    ensureTabs: function (schema) {
      var missing = Object.keys(schema).filter(function (n) { return !ss.getSheetByName(n); });
      if (!missing.length) return; // lock-free fast path
      runLocked(function () {
        missing.forEach(function (name) {
          if (ss.getSheetByName(name)) return; // created meanwhile
          var cols = schema[name];
          var sh = ss.insertSheet(name);
          formatColumns_(sh, name, cols);
          sh.getRange(1, 1, 1, cols.length).setNumberFormat('@').setValues([cols]).setFontWeight('bold');
          sh.setFrozenRows(1);
        });
      });
    },

    readTable: function (name) {
      var sh = sheet_(name);
      var headers = headers_(sh);
      var last = sh.getLastRow();
      if (last < 2 || !headers.length) return [];
      var data = sh.getRange(2, 1, last - 1, headers.length).getValues();
      return data.map(function (r) { return rowToObj_(name, headers, r); });
    },

    appendRow: function (name, row) {
      return runLocked(function () {
        row = row || {};
        var sh = sheet_(name);
        var headers = headers_(sh);
        var idField = (TABS[name] || headers)[0];
        var out = {};
        headers.forEach(function (h) { out[h] = cellIn_(name, h, row[h]); });
        if (isEmpty_(out[idField])) {
          var prefix = Object.prototype.hasOwnProperty.call(ID_PREFIX, name) ? ID_PREFIX[name] : '';
          if (prefix === null) throw new Error(name + '.' + idField + ' is required (natural key)');
          out[idField] = newId(prefix);
        }
        var values = headers.map(function (h) { return out[h]; });
        var r = sh.getLastRow() + 1;
        sh.getRange(r, 1, 1, headers.length).setValues([values]);
        return rowToObj_(name, headers, values);
      });
    },

    // Merge-patch: only defined fields present in patch change; id field and unknown columns ignored.
    updateRowById: function (name, idField, id, patch) {
      return runLocked(function () {
        patch = patch || {};
        var sh = sheet_(name);
        var headers = headers_(sh);
        var r = findRowIndex_(sh, headers, idField, id);
        if (r < 0) throw new Error(name + ': row ' + id + ' not found');
        var range = sh.getRange(r, 1, 1, headers.length);
        var values = range.getValues()[0];
        headers.forEach(function (h, i) {
          if (h !== idField && Object.prototype.hasOwnProperty.call(patch, h) && patch[h] !== undefined) {
            values[i] = cellIn_(name, h, patch[h]);
          }
        });
        range.setValues([values]);
        return rowToObj_(name, headers, values);
      });
    },

    deleteRowById: function (name, idField, id) {
      runLocked(function () {
        var sh = sheet_(name);
        var headers = headers_(sh);
        var r = findRowIndex_(sh, headers, idField, id);
        if (r < 0) throw new Error(name + ': row ' + id + ' not found');
        sh.deleteRow(r);
      });
    },
  };
}

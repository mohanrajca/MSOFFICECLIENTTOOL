// In-memory SheetStore (tests). Same interface the Apps Script adapter will implement:
// readTable, appendRow, updateRowById, deleteRowById, ensureTabs.
import { TABS, ID_PREFIX, newId } from './core.js';

const isEmpty = (v) => v === undefined || v === null || v === '';

// seed: { TabName: [headerRow, ...dataRows] } or { TabName: ['Col1','Col2'] } (header only)
export function memStore(seed = {}) {
  const tabs = {}; // name -> { headers: string[], rows: object[] }

  const makeTab = (def) => {
    const headers = Array.isArray(def[0]) ? [...def[0]] : [...def];
    const rows = Array.isArray(def[0])
      ? def.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])))
      : [];
    return { headers, rows };
  };
  const tab = (name) => {
    if (!tabs[name]) throw new Error(`Unknown tab: ${name}`);
    return tabs[name];
  };
  const copy = (o) => ({ ...o });
  for (const [name, def] of Object.entries(seed)) tabs[name] = makeTab(def);

  return {
    ensureTabs(schema) {
      for (const [name, cols] of Object.entries(schema)) {
        if (!tabs[name]) tabs[name] = makeTab(cols);
      }
    },
    readTable(name) {
      return tab(name).rows.map(copy);
    },
    appendRow(name, row) {
      const t = tab(name);
      const idField = (TABS[name] || t.headers)[0];
      const out = Object.fromEntries(t.headers.map((h) => [h, row[h] ?? '']));
      if (isEmpty(out[idField])) {
        const prefix = Object.prototype.hasOwnProperty.call(ID_PREFIX, name) ? ID_PREFIX[name] : '';
        if (prefix === null) throw new Error(`${name}.${idField} is required (natural key)`);
        out[idField] = newId(prefix);
      }
      t.rows.push(out);
      return copy(out);
    },
    // Merge-patch: only fields present in patch change; id field and unknown columns are ignored.
    updateRowById(name, idField, id, patch) {
      const t = tab(name);
      const row = t.rows.find((r) => String(r[idField]) === String(id));
      if (!row) throw new Error(`${name}: row ${id} not found`);
      for (const h of t.headers) {
        if (h !== idField && Object.prototype.hasOwnProperty.call(patch, h)) row[h] = patch[h];
      }
      return copy(row);
    },
    deleteRowById(name, idField, id) {
      const t = tab(name);
      const i = t.rows.findIndex((r) => String(r[idField]) === String(id));
      if (i < 0) throw new Error(`${name}: row ${id} not found`);
      t.rows.splice(i, 1);
    },
  };
}

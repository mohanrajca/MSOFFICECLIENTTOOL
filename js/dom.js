// Shared HTML escaping. Safe for text nodes AND quoted attribute values.
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/`/g, '&#96;');
}

// Shared date helpers. Dates travel as ISO strings (YYYY-MM-DD, optionally with a time suffix).
export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function day(x) { return String(x == null ? '' : x).slice(0, 10); }

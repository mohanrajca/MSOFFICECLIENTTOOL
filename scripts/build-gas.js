// Emits dist/core.gs from backend/core.js (strips top-level "export ").
// Fails on module syntax that cannot be stripped safely.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

mkdirSync('dist', { recursive: true });
for (const [inp, out] of [['backend/core.js', 'dist/core.gs'], ['backend/sheet-mapping.js', 'dist/sheet-mapping.gs']]) {
const src = readFileSync(inp, 'utf8');
const bad = src.split(/\r?\n/).filter((l) => /^(export \{|export default|import )/.test(l));
if (bad.length) {
  console.error('Unsupported module syntax in core.js:\n' + bad.join('\n'));
  process.exit(1);
}
writeFileSync(out, src.replace(/^export /gm, ''));
console.log('wrote ' + out);
}

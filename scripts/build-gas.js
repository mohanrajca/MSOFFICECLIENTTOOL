// Emits dist/core.gs from backend/core.js (strips top-level "export ").
// Fails on module syntax that cannot be stripped safely.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const src = readFileSync('backend/core.js', 'utf8');
const bad = src.split(/\r?\n/).filter((l) => /^(export \{|export default|import )/.test(l));
if (bad.length) {
  console.error('Unsupported module syntax in core.js:\n' + bad.join('\n'));
  process.exit(1);
}
mkdirSync('dist', { recursive: true });
writeFileSync('dist/core.gs', src.replace(/^export /gm, ''));
console.log('wrote dist/core.gs');

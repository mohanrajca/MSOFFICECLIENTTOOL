import { test, expect } from 'vitest';
import { esc } from '../dom.js';

test('esc encodes quotes so attribute values cannot be broken out of', () => {
  const evil = 'x" onmouseover="alert(1)\' autofocus=`y` <b>&';
  const out = esc(evil);
  expect(out).not.toMatch(/["'`<>]/);
  expect(out).toContain('&quot;');
  expect(out).toContain('&#39;');
  expect(esc(null)).toBe('');
  expect(esc(0)).toBe('0');
});

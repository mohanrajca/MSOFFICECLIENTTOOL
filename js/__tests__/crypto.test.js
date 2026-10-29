import { describe, test, expect } from 'vitest';
import { encryptSecret, decryptSecret, isCiphertext, WrongKeyError } from '../crypto.js';

describe('crypto', () => {
  test('round trip', () => {
    const ct = encryptSecret('portalPass!', 'rightkey');
    expect(decryptSecret(ct, 'rightkey')).toBe('portalPass!');
  });
  test('ciphertext is tagged, salted (differs each time) and hides plaintext', () => {
    const a = encryptSecret('portalPass!', 'k1'); const b = encryptSecret('portalPass!', 'k1');
    expect(a.startsWith('pmv1:')).toBe(true);
    expect(a).not.toBe(b);
    expect(a).not.toContain('portalPass!');
  });
  test('wrong master key fails loudly (many keys, never garbled)', () => {
    const ct = encryptSecret('portalPass!', 'rightkey');
    expect(() => decryptSecret(ct, 'wrongkey')).toThrow(WrongKeyError);
    for (let i = 0; i < 200; i++) expect(() => decryptSecret(ct, 'bad' + i)).toThrow(WrongKeyError);
  });
  test('empty / blank master key rejected', () => {
    expect(() => encryptSecret('x', '')).toThrow();
    expect(() => encryptSecret('x', '   ')).toThrow();
    expect(() => decryptSecret(encryptSecret('x', 'k'), '')).toThrow();
  });
  test('isCiphertext distinguishes tagged from raw plaintext', () => {
    expect(isCiphertext(encryptSecret('abc', 'k'))).toBe(true);
    expect(isCiphertext('abc123')).toBe(false);
    expect(isCiphertext('')).toBe(false);
    expect(isCiphertext(undefined)).toBe(false);
  });
  test('non-ASCII and empty-ish passwords round-trip', () => {
    for (const p of ['पासवर्ड-₹-é-😀', ' spaced ', 'a\nb']) {
      expect(decryptSecret(encryptSecret(p, 'கீ-key'), 'கீ-key')).toBe(p);
    }
    expect(decryptSecret(encryptSecret('', 'k'), 'k')).toBe('');
  });
  test('untagged / tampered input throws WrongKeyError', () => {
    expect(() => decryptSecret('plain', 'k')).toThrow(WrongKeyError);
    expect(() => decryptSecret('pmv1:@@@notbase64', 'k')).toThrow(WrongKeyError);
  });
});

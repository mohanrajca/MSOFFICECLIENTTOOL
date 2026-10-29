import { describe, test, expect } from 'vitest';
import { encryptSecret, decryptSecret, isCiphertext, WrongKeyError, KDF_ITERATIONS } from '../crypto.js';

describe('crypto (pmv2: PBKDF2-SHA256 + AES-256-GCM)', () => {
  test('round trip', async () => {
    expect(await decryptSecret(await encryptSecret('portalPass!', 'rightkey'), 'rightkey')).toBe('portalPass!');
  });
  test('tagged pmv2, iterations + salt stored, random salt/IV each time, hides plaintext', async () => {
    const a = await encryptSecret('portalPass!', 'k1'); const b = await encryptSecret('portalPass!', 'k1');
    expect(a.startsWith('pmv2:')).toBe(true);
    const [iter, salt, iv] = a.slice(5).split(':');
    expect(Number(iter)).toBe(KDF_ITERATIONS);
    expect(KDF_ITERATIONS).toBeGreaterThanOrEqual(150000);
    expect(salt).toMatch(/^[0-9a-f]{32}$/);
    expect(iv).toMatch(/^[0-9a-f]{24}$/);
    expect(a).not.toBe(b);
    expect(a.split(':')[2]).not.toBe(b.split(':')[2]); // distinct salts
    expect(a).not.toContain('portalPass!');
  });
  test('wrong master key fails loudly, never garbled', async () => {
    const ct = await encryptSecret('portalPass!', 'rightkey');
    await expect(decryptSecret(ct, 'wrongkey')).rejects.toThrow(WrongKeyError);
    for (let i = 0; i < 20; i++) await expect(decryptSecret(ct, 'bad' + i)).rejects.toThrow(WrongKeyError);
  });
  test('empty / blank master key rejected', async () => {
    await expect(encryptSecret('x', '')).rejects.toThrow();
    await expect(encryptSecret('x', '   ')).rejects.toThrow();
    await expect(decryptSecret(await encryptSecret('x', 'k'), '')).rejects.toThrow();
  });
  test('isCiphertext distinguishes tagged from raw plaintext', async () => {
    expect(isCiphertext(await encryptSecret('abc', 'k'))).toBe(true);
    expect(isCiphertext('abc123')).toBe(false);
    expect(isCiphertext('pmv1:old')).toBe(false);
    expect(isCiphertext('')).toBe(false);
    expect(isCiphertext(undefined)).toBe(false);
  });
  test('non-ASCII, whitespace, newline and empty passwords round-trip', async () => {
    for (const p of ['पासवर्ड-₹-é-😀', ' spaced ', 'a\nb', '']) {
      expect(await decryptSecret(await encryptSecret(p, 'கீ-key'), 'கீ-key')).toBe(p);
    }
  });
  test('untagged, malformed or tampered input throws WrongKeyError', async () => {
    await expect(decryptSecret('plain', 'k')).rejects.toThrow(WrongKeyError);
    await expect(decryptSecret('pmv2:@@@', 'k')).rejects.toThrow(WrongKeyError);
    await expect(decryptSecret('pmv2:99999999:' + '0'.repeat(32) + ':' + '0'.repeat(24) + ':AAAA', 'k')).rejects.toThrow(WrongKeyError);
    const parts = (await encryptSecret('x', 'k')).split(':');
    const flipped = parts[3].slice(0, -4) + (parts[3].slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA');
    await expect(decryptSecret([...parts.slice(0, 3), flipped].join(':'), 'k')).rejects.toThrow(WrongKeyError); // GCM tamper
  });
});

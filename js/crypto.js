// Client-side secret encryption for the credential vault. No DOM, no network.
// The master key is never stored or transmitted by this module: callers pass it in.
//
// Uses the platform WebCrypto API (globalThis.crypto.subtle): identical in browsers
// (secure context: https or localhost) and Node 20+, so tests run the real code, and
// there is no library to fail to load. Native PBKDF2 makes 200k iterations ~50ms; the
// pure-JS crypto-js PBKDF2 took ~2.5s per operation at that cost (unusable).
//
// Format (pmv2): "pmv2:" + iterations + ":" + saltHex + ":" + ivHex + ":" + base64(AES-256-GCM ciphertext+tag)
//   key = PBKDF2-HMAC-SHA256(masterKey, random 128-bit salt, iterations) -> AES-256-GCM key,
//   random 96-bit IV. GCM authenticates, so tampering or a wrong key fails the tag check.
//   The plaintext also carries a known marker (defence in depth for wrong-key detection).
const TAG = 'pmv2:';
const MARKER = 'PMV2\n';
export const KDF_ITERATIONS = 200000;
const MAX_ITERATIONS = 2000000;

export class WrongKeyError extends Error {
  constructor(message = 'Wrong master key') { super(message); this.name = 'WrongKeyError'; }
}

// Kept so callers can fail early and clearly (e.g. insecure http origin).
export async function initCrypto() {
  if (!globalThis.crypto || !globalThis.crypto.subtle) {
    throw new Error('Encryption is unavailable: open the app over https (or localhost).');
  }
}

function checkKey(masterKey) {
  if (typeof masterKey !== 'string' || masterKey.trim() === '') throw new Error('A master key is required');
}

export function isCiphertext(s) {
  return typeof s === 'string' && s.startsWith(TAG) && s.length > TAG.length;
}

const enc = new TextEncoder();
const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (h) => Uint8Array.from(h.match(/../g), (b) => parseInt(b, 16));
const b64 = (u8) => { let s = ''; for (const b of u8) s += String.fromCharCode(b); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(masterKey, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', enc.encode(masterKey), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

export async function encryptSecret(plaintext, masterKey) {
  checkKey(masterKey);
  await initCrypto();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(masterKey, salt, KDF_ITERATIONS);
  const payload = MARKER + (plaintext === undefined || plaintext === null ? '' : String(plaintext));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(payload)));
  return TAG + KDF_ITERATIONS + ':' + hex(salt) + ':' + hex(iv) + ':' + b64(ct);
}

export async function decryptSecret(ciphertext, masterKey) {
  checkKey(masterKey);
  if (!isCiphertext(ciphertext)) throw new WrongKeyError('Not an encrypted value');
  await initCrypto();
  const parts = ciphertext.slice(TAG.length).split(':');
  const iterations = Number(parts[0]);
  if (parts.length !== 4 || !Number.isInteger(iterations) || iterations < 1 || iterations > MAX_ITERATIONS
    || !/^[0-9a-f]{32}$/i.test(parts[1]) || !/^[0-9a-f]{24}$/i.test(parts[2])) {
    throw new WrongKeyError('Malformed encrypted value');
  }
  let text;
  try {
    const key = await deriveKey(masterKey, unhex(parts[1]), iterations);
    const buf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unhex(parts[2]) }, key, unb64(parts[3]));
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch (e) {
    throw new WrongKeyError(); // GCM tag mismatch (wrong key / tampering) or malformed data
  }
  if (!text.startsWith(MARKER)) throw new WrongKeyError();
  return text.slice(MARKER.length);
}

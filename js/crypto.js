// Client-side secret encryption for the credential vault. Pure; no DOM, no network.
// The master key is never stored or transmitted by this module: callers pass it in.
//
// Isomorphic crypto-js: in the browser index.html loads crypto-js from cdnjs as a
// classic <script> (sets globalThis.CryptoJS) before this module runs; in Node/Vitest
// the global is absent so the installed `crypto-js` package is imported instead.
const CryptoJS = globalThis.CryptoJS || (await import('crypto-js')).default;

const TAG = 'pmv1:';       // version tag on every ciphertext we produce
const MARKER = 'PMV1\n';   // known prefix inside the encrypted payload (wrong-key detector)

export class WrongKeyError extends Error {
  constructor(message = 'Wrong master key') { super(message); this.name = 'WrongKeyError'; }
}

function checkKey(masterKey) {
  if (typeof masterKey !== 'string' || masterKey.trim() === '') throw new Error('A master key is required');
}

export function isCiphertext(s) {
  return typeof s === 'string' && s.startsWith(TAG) && s.length > TAG.length;
}

// AES, crypto-js passphrase mode (EVP KDF with a random 8-byte salt per call).
export function encryptSecret(plaintext, masterKey) {
  checkKey(masterKey);
  const payload = MARKER + (plaintext === undefined || plaintext === null ? '' : String(plaintext));
  return TAG + CryptoJS.AES.encrypt(payload, masterKey).toString();
}

export function decryptSecret(ciphertext, masterKey) {
  checkKey(masterKey);
  if (!isCiphertext(ciphertext)) throw new WrongKeyError('Not an encrypted value');
  let text;
  try {
    text = CryptoJS.AES.decrypt(ciphertext.slice(TAG.length), masterKey).toString(CryptoJS.enc.Utf8);
  } catch (e) {
    throw new WrongKeyError(); // malformed UTF-8 => wrong key
  }
  if (!text || !text.startsWith(MARKER)) throw new WrongKeyError();
  return text.slice(MARKER.length);
}

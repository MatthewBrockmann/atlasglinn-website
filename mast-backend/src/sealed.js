/**
 * Sealed range directions — the owner's real PDF, encrypted so it can live in a public repository.
 *
 * The repo is public and the range address is private (ARCHITECTURE.md §6a), so the PDF he handed over on 2026-09-06
 * (MAST_Range_Directions.pdf: address, map pin, the route past the green house, the ten steps) never enters git in the
 * clear. Instead:
 *   1. the Worker keeps an RSA-OAEP key pair in D1 (`worker_keys`, made on first use; the private half never leaves D1),
 *   2. GET /directions-key publishes the public half,
 *   3. `node mast-backend/seal-directions.mjs <pdf> <that json>` encrypts the PDF with a fresh AES-256-GCM key, wraps that
 *      key with the public key and writes mast-backend/assets/range-directions.sealed.json — ciphertext only — which is
 *      committed to main,
 *   4. at send time the Worker fetches that file from main (DIRECTIONS_SEALED_URL), unwraps and decrypts it, and attaches
 *      the PDF to the confirmation and the T−7 / T−1 reminders (memoised per isolate).
 * Nobody without D1 can read the file; replacing the PDF is a re-seal and a merge, no deploy and no secret to paste.
 * A sealed file for a key the Worker does not hold (a wiped D1) is reported by /health as `sealed-key-mismatch`, and
 * the emails fall back to the RANGE_* secrets render or go without.
 */

const KEY_NAME = 'directions';
const DEFAULT_SEALED_URL = 'https://raw.githubusercontent.com/MatthewBrockmann/atlasglinn-website/main/mast-backend/assets/range-directions.sealed.json';
const RSA = { name: 'RSA-OAEP', hash: 'SHA-256' };

export const SEALED_SCHEMA = 'CREATE TABLE IF NOT EXISTS worker_keys (name TEXT PRIMARY KEY, created_at TEXT NOT NULL, key_id TEXT NOT NULL, public_jwk TEXT NOT NULL, private_jwk TEXT NOT NULL)';

let keyMemo = null;      // { key_id, public_jwk, private_jwk }
let sealedMemo = null;   // { url, at, ttl, result }

/** Test hook. */
export function _resetSealedMemo() { keyMemo = null; sealedMemo = null; }

/** The Worker's sealing key pair, created on first use and kept in D1. */
export async function ensureKeyPair(env) {
  if (keyMemo) return keyMemo;
  if (!env || !env.DB) throw new Error('D1 not bound');
  await env.DB.prepare(SEALED_SCHEMA).run();
  const read = () => env.DB.prepare('SELECT key_id, public_jwk, private_jwk FROM worker_keys WHERE name = ? LIMIT 1').bind(KEY_NAME).first();
  let row = await read();
  if (!row) {
    const pair = await crypto.subtle.generateKey({ ...RSA, modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]) }, true, ['encrypt', 'decrypt']);
    const pub = await crypto.subtle.exportKey('jwk', pair.publicKey);
    const priv = await crypto.subtle.exportKey('jwk', pair.privateKey);
    // INSERT OR IGNORE: two isolates racing on first use keep the row that landed first and re-read it.
    await env.DB.prepare('INSERT OR IGNORE INTO worker_keys (name, created_at, key_id, public_jwk, private_jwk) VALUES (?, ?, ?, ?, ?)')
      .bind(KEY_NAME, new Date().toISOString(), await keyIdOf(pub), JSON.stringify(pub), JSON.stringify(priv)).run();
    row = await read();
    if (!row) throw new Error('worker_keys row missing after insert');
  }
  keyMemo = { key_id: row.key_id, public_jwk: JSON.parse(row.public_jwk), private_jwk: JSON.parse(row.private_jwk) };
  return keyMemo;
}

/** What GET /directions-key serves: the public half and how to use it. Never the private key. */
export async function publicKeyInfo(env) {
  const k = await ensureKeyPair(env);
  return {
    key_id: k.key_id,
    algorithm: 'RSA-OAEP-256 wrapping AES-256-GCM',
    public_jwk: k.public_jwk,
    seal_with: 'node mast-backend/seal-directions.mjs <directions.pdf> <this file> → mast-backend/assets/range-directions.sealed.json, commit to main',
  };
}

/** 16 hex chars of SHA-256 over the public modulus and exponent. */
export async function keyIdOf(publicJwk) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(publicJwk.n) + '.' + String(publicJwk.e)));
  return hex(new Uint8Array(d)).slice(0, 16);
}

/** Encrypt `bytes` for the holder of `publicJwk`. Used by seal-directions.mjs (Node) and the tests; nothing here is secret. */
export async function seal(publicJwk, bytes, meta = {}) {
  const pub = await crypto.subtle.importKey('jwk', publicJwk, RSA, false, ['encrypt']);
  const aes = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', aes));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, bytes));
  const wrapped = new Uint8Array(await crypto.subtle.encrypt(RSA, pub, raw));
  return {
    v: 1,
    key_id: await keyIdOf(publicJwk),
    alg: 'RSA-OAEP-256+A256GCM',
    filename: meta.filename || 'MAST-Range-Directions.pdf',
    bytes: bytes.length,
    sha256: hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))),
    sealed_at: new Date().toISOString(),
    note: meta.note || 'Ciphertext only. The plaintext PDF is never committed; the Worker decrypts it with the key in its D1.',
    wrapped_key: b64(wrapped),
    iv: b64(iv),
    ciphertext: b64(ciphertext),
  };
}

/** Decrypt a sealed file with the private JWK; throws on tampering or the wrong key. */
export async function unseal(privateJwk, sealed) {
  const priv = await crypto.subtle.importKey('jwk', privateJwk, RSA, false, ['decrypt']);
  const raw = await crypto.subtle.decrypt(RSA, priv, unb64(sealed.wrapped_key));
  const aes = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt']);
  const bytes = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(sealed.iv) }, aes, unb64(sealed.ciphertext)));
  if (sealed.sha256 && hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))) !== sealed.sha256) throw new Error('sealed content digest mismatch');
  return bytes;
}

/**
 * The sealed PDF from main, opened with the Worker's key: { status, bytes, meta }. status is one of
 * sealed | none (no file on main yet) | off (DIRECTIONS_SEALED_URL=off) | sealed-key-mismatch | sealed-unreachable | sealed-error.
 * Success is memoised for an hour, a failure for five minutes, so a fix on main lands without a deploy.
 */
export async function sealedDirections(env) {
  const url = (env && env.DIRECTIONS_SEALED_URL) || DEFAULT_SEALED_URL;
  if (url === 'off') return { status: 'off', bytes: null };
  if (sealedMemo && sealedMemo.url === url && Date.now() - sealedMemo.at < sealedMemo.ttl) return sealedMemo.result;
  let result;
  try {
    const res = await fetch(url, { headers: { 'Cache-Control': 'no-cache', 'User-Agent': 'mast-booking-backend' } });
    if (res.status === 404) result = { status: 'none', bytes: null };
    else if (!res.ok) result = { status: 'sealed-unreachable', bytes: null, detail: 'HTTP ' + res.status };
    else {
      const sealed = await res.json();
      const k = await ensureKeyPair(env);
      if (!sealed || sealed.key_id !== k.key_id) result = { status: 'sealed-key-mismatch', bytes: null, detail: (sealed && sealed.key_id) + ' on main, ' + k.key_id + ' on the Worker' };
      else result = { status: 'sealed', bytes: await unseal(k.private_jwk, sealed), meta: { filename: sealed.filename, sha256: sealed.sha256, sealed_at: sealed.sealed_at, bytes: sealed.bytes } };
    }
  } catch (e) {
    result = { status: 'sealed-error', bytes: null, detail: e.message };
  }
  if (result.status !== 'sealed' && result.status !== 'none') console.warn('[Directions] sealed PDF not usable:', result.status, result.detail || '');
  sealedMemo = { url, at: Date.now(), ttl: result.status === 'sealed' ? 3600000 : 300000, result };
  return result;
}

function hex(bytes) { let s = ''; for (const b of bytes) s += b.toString(16).padStart(2, '0'); return s; }
export function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function unb64(s) {
  const bin = atob(String(s || ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

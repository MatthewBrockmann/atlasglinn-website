#!/usr/bin/env node
// Seal the range-directions PDF for the Worker (src/sealed.js):
//   node seal-directions.mjs <directions.pdf> <directions-key.json> [out.json]
// <directions-key.json> is what GET /directions-key answers (the smoke test saves it as
// claude/desktop-assets:reference/desktop/live/_directions-key.json). The PDF must live OUTSIDE the repository — the
// address is private and the repo is public — and only the ciphertext (default out: assets/range-directions.sealed.json)
// is committed. The Worker fetches that file from main and decrypts it with the private key in its D1.
import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seal } from './src/sealed.js';

const [pdfPath, keyPath, outArg] = process.argv.slice(2);
if (!pdfPath || !keyPath) {
  console.error('usage: node seal-directions.mjs <directions.pdf> <directions-key.json> [out.json]');
  process.exit(2);
}
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const pdfReal = realpathSync(pdfPath);
if (pdfReal.startsWith(repo + '/')) {
  console.error('refusing: the plaintext PDF is inside the repository (' + pdfReal + '). Keep it outside git; the address is private.');
  process.exit(2);
}
const bytes = new Uint8Array(readFileSync(pdfReal));
if (Buffer.from(bytes.subarray(0, 5)).toString('latin1') !== '%PDF-') { console.error('not a PDF: ' + pdfReal); process.exit(2); }
const keyDoc = JSON.parse(readFileSync(keyPath, 'utf8'));
const publicJwk = keyDoc.public_jwk || keyDoc;
if (!publicJwk || publicJwk.kty !== 'RSA' || publicJwk.d) { console.error('not a public RSA JWK: ' + keyPath); process.exit(2); }
const sealed = await seal(publicJwk, bytes, { filename: 'MAST-Range-Directions.pdf' });
const out = outArg || resolve(here, 'assets/range-directions.sealed.json');
writeFileSync(out, JSON.stringify(sealed, null, 1) + '\n');
console.log('sealed ' + bytes.length + ' bytes (sha256 ' + sealed.sha256.slice(0, 16) + '…) for Worker key ' + sealed.key_id + ' → ' + out);

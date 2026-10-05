// node --test workers/fbi-cde-proxy/test — no dependencies. Keys are generated at run time; nothing here is a credential.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../index.js';

const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const KEY = 'test-cde-key-not-real';
const ENV = { FBI_CDE_KEY: KEY };
const PATH = '/summarized/state/TX/violent-crime?from=01-2024&to=12-2024';

let kidSeq = 0;
async function makeSigner() {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const kid = `test-kid-${++kidSeq}`;
  return { kid, privateKey: pair.privateKey, jwk: { kty: 'RSA', n: jwk.n, e: jwk.e, kid, alg: 'RS256', use: 'sig' } };
}

const b64u = (bytes) => Buffer.from(bytes).toString('base64url');
const enc = (obj) => b64u(new TextEncoder().encode(JSON.stringify(obj)));

async function sign(signer, claims = {}, header = {}) {
  const now = Math.floor(Date.now() / 1000);
  const h = { alg: 'RS256', kid: signer.kid, typ: 'JWT', ...header };
  const c = {
    iss: 'https://securetoken.google.com/safeguard-atlasglinn',
    aud: 'safeguard-atlasglinn',
    sub: 'uid-test',
    iat: now - 10,
    exp: now + 3600,
    ...claims,
  };
  const input = `${enc(h)}.${enc(c)}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signer.privateKey, new TextEncoder().encode(input));
  return `${input}.${b64u(new Uint8Array(sig))}`;
}

let calls;
let published;
let upstream;
let store;

function installMocks() {
  calls = [];
  store = new Map();
  globalThis.fetch = async (input) => {
    const url = typeof input === 'string' ? input : input.url;
    calls.push(url);
    if (url === JWKS_URL) {
      return new Response(JSON.stringify({ keys: published }), {
        headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' },
      });
    }
    return upstream(url);
  };
  globalThis.caches = {
    default: {
      async match(req) {
        const r = store.get(req.url);
        return r ? r.clone() : undefined;
      },
      async put(req, res) {
        store.set(req.url, res);
      },
    },
  };
}

const ctx = { waitUntil: () => {} };
const call = (path, headers = {}, env = ENV, method = 'GET') =>
  worker.fetch(new Request(`https://fbi-cde-proxy.example.workers.dev${path}`, { method, headers }), env, ctx);
const upstreamCalls = () => calls.filter((u) => u.startsWith('https://api.usa.gov/'));

let signer;
beforeEach(async () => {
  signer = await makeSigner();
  published = [signer.jwk];
  upstream = async () => new Response('{"offenses":{"rates":{}}}', { status: 200 });
  installMocks();
});

test('valid token: upstream called once with the key, response cached by the key-free URL', async () => {
  const token = await sign(signer);
  const r1 = await call(PATH, { authorization: `Bearer ${token}` });
  assert.equal(r1.status, 200);
  assert.equal(await r1.text(), '{"offenses":{"rates":{}}}');
  assert.equal(r1.headers.get('access-control-allow-origin'), null);
  const up = upstreamCalls();
  assert.equal(up.length, 1);
  const u = new URL(up[0]);
  assert.equal(u.origin + u.pathname, 'https://api.usa.gov/crime/fbi/cde/summarized/state/TX/violent-crime');
  assert.equal(u.searchParams.get('API_KEY'), KEY);
  assert.equal(u.searchParams.get('from'), '01-2024');
  assert.equal(u.searchParams.get('to'), '12-2024');
  assert.deepEqual([...store.keys()], [
    'https://api.usa.gov/crime/fbi/cde/summarized/state/TX/violent-crime?from=01-2024&to=12-2024',
  ]);

  const r2 = await call(PATH, { authorization: `Bearer ${token}` });
  assert.equal(r2.status, 200);
  assert.equal(upstreamCalls().length, 1, 'second request served from cache');
});

test('no query is allowed too', async () => {
  const token = await sign(signer);
  const r = await call('/summarized/state/CA/property-crime', { authorization: `Bearer ${token}` });
  assert.equal(r.status, 200);
  assert.equal(new URL(upstreamCalls()[0]).search, `?API_KEY=${KEY}`);
});

for (const [name, claims, header] of [
  ['wrong iss', { iss: 'https://securetoken.google.com/other-project' }],
  ['wrong aud', { aud: 'other-project' }],
  ['expired beyond skew', { exp: Math.floor(Date.now() / 1000) - 120 }],
  ['iat in the future', { iat: Math.floor(Date.now() / 1000) + 600 }],
  ['empty sub', { sub: '' }],
  ['alg HS256', {}, { alg: 'HS256' }],
  ['alg none', {}, { alg: 'none' }],
  ['unknown kid', {}, { kid: 'not-published' }],
]) {
  test(`401: ${name}`, async () => {
    const token = await sign(signer, claims, header);
    const r = await call(PATH, { authorization: `Bearer ${token}` });
    assert.equal(r.status, 401);
    assert.deepEqual(await r.json(), { error: 'unauthorized' });
    assert.equal(upstreamCalls().length, 0);
  });
}

test('200: expired inside the 60s skew is still accepted', async () => {
  const token = await sign(signer, { exp: Math.floor(Date.now() / 1000) - 30 });
  assert.equal((await call(PATH, { authorization: `Bearer ${token}` })).status, 200);
});

test('401: signature from a key that is not published', async () => {
  const other = await makeSigner();
  const token = await sign(other, {}, { kid: signer.kid });
  assert.equal((await call(PATH, { authorization: `Bearer ${token}` })).status, 401);
});

test('401: tampered payload', async () => {
  const token = await sign(signer);
  const [h, , s] = token.split('.');
  const forged = `${h}.${enc({ iss: 'https://securetoken.google.com/safeguard-atlasglinn', aud: 'safeguard-atlasglinn', sub: 'x', iat: 1, exp: 9e9 })}.${s}`;
  assert.equal((await call(PATH, { authorization: `Bearer ${forged}` })).status, 401);
});

test('401: missing, non-Bearer and malformed authorization', async () => {
  for (const headers of [{}, { authorization: 'Basic abc' }, { authorization: 'Bearer not.a' }, { authorization: 'Bearer @@.@@.@@' }, { authorization: 'Bearer a.b.c' }]) {
    const r = await call(PATH, headers);
    assert.equal(r.status, 401, JSON.stringify(headers));
  }
  assert.equal(upstreamCalls().length, 0);
});

test('kid rotation: an unknown kid refetches the JWK set once, then verifies', async () => {
  const first = await sign(signer);
  assert.equal((await call(PATH, { authorization: `Bearer ${first}` })).status, 200);
  const rotated = await makeSigner();
  published = [signer.jwk, rotated.jwk];
  const r = await call('/summarized/state/NY/violent-crime', { authorization: `Bearer ${await sign(rotated)}` });
  assert.equal(r.status, 200);
});

test('404 before auth: disallowed paths, methods and params never reach JWKS or upstream', async () => {
  const token = await sign(signer);
  const auth = { authorization: `Bearer ${token}` };
  const bad = [
    '/',
    '/summarized/state/tx/violent-crime',
    '/summarized/state/TXX/violent-crime',
    '/summarized/state/TX/Violent-crime',
    '/summarized/state/TX/violent_crime',
    '/summarized/state/TX/1violent',
    '/summarized/state/TX/violent-crime/extra',
    '/summarized/state/TX/violent-crime/',
    '/summarized/state/TX/violent-crime/..%2F..%2Fother',
    '/summarized/state/TX/..%2F..%2Fagency',
    '/summarized/state/TX%2Fviolent-crime',
    '/summarized/state/TX/violent%2Dcrime',
    '/summarized/state/TX/../../agency/byStateAbbr/TX',
    '/summarized/state/TX/violent-crime/../../../../x',
    '/summarized/state/TX/' + 'a'.repeat(42),
    '/agency/byStateAbbr/TX',
    `${PATH}&API_KEY=attacker`,
    `${PATH}&from=01-2023`,
    '/summarized/state/TX/violent-crime?from=13-2024',
    '/summarized/state/TX/violent-crime?from=1-2024',
    '/summarized/state/TX/violent-crime?from=2024',
    '/summarized/state/TX/violent-crime?from=01-2024%26API_KEY%3Dx',
    '/summarized/state/TX/violent-crime?callback=x',
    '//api.usa.gov/crime/fbi/cde/summarized/state/TX/violent-crime',
  ];
  for (const p of bad) {
    const r = await call(p, auth);
    assert.equal(r.status, 404, p);
    assert.deepEqual(await r.json(), { error: 'not found' });
  }
  assert.equal((await call(PATH, auth, ENV, 'POST')).status, 404);
  assert.equal(calls.length, 0, 'no JWKS fetch and no upstream fetch for a rejected route');
});

test('dot segments are collapsed by the URL parser before routing — only allowlisted shapes survive', () => {
  const u = new URL('https://x.workers.dev/summarized/state/TX/violent-crime/../../agency');
  assert.equal(u.pathname, '/summarized/state/agency');
});

test('503 when the secret is not set, after auth, without calling upstream', async () => {
  const token = await sign(signer);
  const r = await call(PATH, { authorization: `Bearer ${token}` }, {});
  assert.equal(r.status, 503);
  assert.deepEqual(await r.json(), { error: 'proxy not configured' });
  assert.equal(upstreamCalls().length, 0);
});

test('upstream errors: no body echo, not cached; 429 maps to 503', async () => {
  const token = await sign(signer);
  upstream = async (url) => new Response(`upstream says ${url}`, { status: 500 });
  const r = await call(PATH, { authorization: `Bearer ${token}` });
  assert.equal(r.status, 502);
  const text = await r.text();
  assert.ok(!text.includes('upstream says'));
  assert.equal(store.size, 0);
  upstream = async () => new Response('slow down', { status: 429 });
  assert.equal((await call(PATH, { authorization: `Bearer ${token}` })).status, 503);
  upstream = async () => { throw new Error(`network ${KEY}`); };
  const r3 = await call(PATH, { authorization: `Bearer ${token}` });
  assert.equal(r3.status, 502);
  assert.ok(!(await r3.text()).includes(KEY));
});

test('the key and the token never appear in any response body, header or console output', async () => {
  const token = await sign(signer);
  const logged = [];
  const saved = {};
  for (const m of ['log', 'info', 'warn', 'error', 'debug']) {
    saved[m] = console[m];
    console[m] = (...a) => logged.push(a.map(String).join(' '));
  }
  try {
    const responses = [];
    responses.push(await call(PATH, { authorization: `Bearer ${token}` }));
    responses.push(await call(PATH, { authorization: `Bearer ${token}` }));
    responses.push(await call(PATH, { authorization: 'Bearer a.b.c' }));
    responses.push(await call('/nope', { authorization: `Bearer ${token}` }));
    upstream = async (url) => new Response(url, { status: 400 });
    responses.push(await call('/summarized/state/FL/violent-crime', { authorization: `Bearer ${token}` }));
    for (const r of responses) {
      const text = await r.text();
      const headers = JSON.stringify([...r.headers]);
      for (const secret of [KEY, token]) {
        assert.ok(!text.includes(secret), 'body leaks');
        assert.ok(!headers.includes(secret), 'header leaks');
      }
    }
  } finally {
    for (const m of Object.keys(saved)) console[m] = saved[m];
  }
  assert.ok(!logged.some((l) => l.includes(KEY) || l.includes(token)));
  for (const k of store.keys()) assert.ok(!k.includes(KEY), 'cache key carries the key');
});

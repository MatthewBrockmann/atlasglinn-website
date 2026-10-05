// FBI Crime Data Explorer proxy for the Atlas EP app.
//
// The api.data.gov key lives here as the Worker secret FBI_CDE_KEY, so no Release IPA carries it. A caller proves it is
// an app session with a Firebase ID token for project safeguard-atlasglinn, and can ask for exactly one shape:
//   GET /summarized/state/{ST}/{offense}?from=MM-YYYY&to=MM-YYYY
// Nothing else is forwarded, no other upstream exists, and no request path or query reaches the upstream URL except
// through the captured, validated groups below.

const PROJECT_ID = 'safeguard-atlasglinn';
const ISSUER = `https://securetoken.google.com/${PROJECT_ID}`;
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const UPSTREAM = 'https://api.usa.gov/crime/fbi/cde/summarized/state';
const CACHE_TTL = 86400;
const SKEW = 60;

const ROUTE = /^\/summarized\/state\/([A-Z]{2})\/([a-z][a-z-]{1,40})$/;
const MONTH_YEAR = /^(0[1-9]|1[0-2])-\d{4}$/;
const ALLOWED_QUERY = new Set(['from', 'to']);

let jwks = { keys: new Map(), expires: 0 };

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function b64urlBytes(s) {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error('bad base64url');
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

function b64urlJson(s) {
  return JSON.parse(new TextDecoder().decode(b64urlBytes(s)));
}

async function loadJwks(force) {
  const now = Date.now();
  if (!force && jwks.expires > now && jwks.keys.size) return jwks.keys;
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error('jwks unavailable');
  const body = await res.json();
  const maxAge = Number((/max-age=(\d+)/.exec(res.headers.get('cache-control') || '') || [])[1] || 3600);
  const keys = new Map();
  for (const k of body.keys || []) {
    if (k.kty !== 'RSA' || !k.kid) continue;
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: 'RSA', n: k.n, e: k.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    keys.set(k.kid, key);
  }
  jwks = { keys, expires: now + maxAge * 1000 };
  return keys;
}

async function verifyFirebaseToken(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const header = b64urlJson(parts[0]);
  const claims = b64urlJson(parts[1]);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') return false;

  let keys = await loadJwks(false);
  let key = keys.get(header.kid);
  if (!key) {
    keys = await loadJwks(true);
    key = keys.get(header.kid);
  }
  if (!key) return false;

  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    b64urlBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!ok) return false;

  const now = Math.floor(Date.now() / 1000);
  return (
    claims.iss === ISSUER &&
    claims.aud === PROJECT_ID &&
    typeof claims.exp === 'number' && claims.exp + SKEW > now &&
    typeof claims.iat === 'number' && claims.iat <= now + SKEW &&
    typeof claims.sub === 'string' && claims.sub.length > 0
  );
}

function parseRequest(request) {
  if (request.method !== 'GET') return null;
  const url = new URL(request.url);
  const m = ROUTE.exec(url.pathname);
  if (!m) return null;
  const query = {};
  for (const [name, value] of url.searchParams) {
    if (!ALLOWED_QUERY.has(name) || name in query || !MONTH_YEAR.test(value)) return null;
    query[name] = value;
  }
  return { state: m[1], offense: m[2], query };
}

function upstreamUrl({ state, offense, query }) {
  const u = new URL(`${UPSTREAM}/${state}/${offense}`);
  for (const name of ['from', 'to']) if (query[name]) u.searchParams.set(name, query[name]);
  return u;
}

export default {
  async fetch(request, env, ctx) {
    const route = parseRequest(request);
    if (!route) return json(404, { error: 'not found' });

    const auth = request.headers.get('authorization') || '';
    const token = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(auth);
    let authed = false;
    if (token) {
      try {
        authed = await verifyFirebaseToken(token[1]);
      } catch {
        authed = false;
      }
    }
    if (!authed) return json(401, { error: 'unauthorized' });

    if (!env.FBI_CDE_KEY) return json(503, { error: 'proxy not configured' });

    const canonical = upstreamUrl(route);
    const cache = globalThis.caches && globalThis.caches.default;
    const cacheKey = new Request(canonical.toString(), { method: 'GET' });
    if (cache) {
      const hit = await cache.match(cacheKey);
      if (hit) return hit;
    }

    const keyed = new URL(canonical);
    keyed.searchParams.set('API_KEY', env.FBI_CDE_KEY);
    let res;
    try {
      res = await fetch(keyed.toString(), { headers: { accept: 'application/json' } });
    } catch {
      return json(502, { error: 'upstream unreachable' });
    }
    if (res.status === 429) return json(503, { error: 'upstream rate limited' });
    if (res.status !== 200) return json(502, { error: 'upstream error', status: res.status });

    const body = await res.arrayBuffer();
    const out = new Response(body, {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': `public, max-age=${CACHE_TTL}`,
      },
    });
    if (cache) {
      const put = cache.put(cacheKey, out.clone());
      if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(put);
      else await put;
    }
    return out;
  },
};

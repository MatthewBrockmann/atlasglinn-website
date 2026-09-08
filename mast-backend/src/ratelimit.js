/**
 * Rate limiting and account lockout — D1 only, no new Cloudflare binding.
 *
 * Two independent counters, because they answer two different attacks:
 *   per account   failed_logins / locked_until on the accounts row. Five wrong passwords lock the account for 15 minutes,
 *                 doubling at every further five up to a day. A locked account is answered BEFORE the PBKDF2 runs, so
 *                 guess six costs the Worker nothing.
 *   per IP        a counter row per (bucket, CF-Connecting-IP) in rate_limits. Fixed windows that roll: the first request
 *                 after a window has run out starts a new one. Every increment is a single conditional UPDATE, so
 *                 concurrent requests can neither share nor skip a count (the same reason checkCode claims its try first).
 *
 * The per-account lock is what stops one address being ground through offline-speed guessing; the per-IP counter is what
 * stops one host spraying a password across many addresses, and what caps the seat-hold and email-sending routes.
 *
 * A D1 failure inside the limiter FAILS CLOSED (429) on every route but /event: a booking or a sign-in refused for a
 * minute is recoverable, an unmetered guessing window is not. /event is a first-party beacon — losing its writes during a
 * D1 outage is worse than letting it through.
 */

const MINUTE = 60000;
export const WINDOW_MS = 10 * MINUTE;

/**
 * "<METHOD> <path>" → the bucket its counter lives in and how many requests one IP gets per window.
 * forgot and resend share the 'code' bucket: both mail a 6-digit code to whatever address is posted, so they are one
 * email-sending budget, not two.
 */
export const RATE_ROUTES = {
  'POST /account/login': { bucket: 'login', limit: 20 },
  'POST /account/register': { bucket: 'signup', limit: 5 },
  'POST /account/forgot': { bucket: 'code', limit: 5 },
  'POST /account/resend': { bucket: 'code', limit: 5 },
  'POST /account/verify': { bucket: 'verify', limit: 20 },
  'POST /register': { bucket: 'seat', limit: 10 },
  'POST /contact': { bucket: 'contact', limit: 30 },
  'POST /event': { bucket: 'event', limit: 30, failOpen: true },
};

export const RATE_SCHEMA = [
  'CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, window_start TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0)',
  'CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits (window_start)',
  'ALTER TABLE accounts ADD COLUMN failed_logins INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE accounts ADD COLUMN locked_until TEXT',
];

let schemaReady = null;
/** Idempotent; once per isolate. Mirrors ensureCrmSchema: the ALTERs that already happened raise "duplicate column". */
export function ensureRateSchema(env) {
  if (!env || !env.DB) return Promise.resolve(false);
  if (!schemaReady) {
    schemaReady = (async () => {
      for (const s of RATE_SCHEMA) {
        try { await env.DB.prepare(s).run(); }
        catch (e) { if (!/duplicate column|already exists/i.test(String(e && e.message))) console.error('[Rate] schema step failed:', s.slice(0, 48), e.message); }
      }
      return true;
    })().catch((e) => { schemaReady = null; console.error('[Rate] schema failed:', e.message); return false; });
  }
  return schemaReady;
}
export function _resetRateSchemaMemo() { schemaReady = null; }   // tests

/** The caller as Cloudflare sees it. 'unknown' keeps one shared bucket rather than an unmetered hole. */
export function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || (request.headers.get('X-Forwarded-For') || '').split(',')[0].trim() || '';
}

const seconds = (ms) => Math.max(1, Math.ceil(ms / 1000));

/**
 * null = let it through. { retry_after } = 429.
 *
 * The row is created first so every decision below is one conditional UPDATE against a row that exists.
 */
export async function checkRate(request, env, method, pathname) {
  const rule = RATE_ROUTES[method + ' ' + pathname];
  if (!rule) return null;
  const key = rule.bucket + ':' + (clientIp(request) || 'unknown');
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const cutoff = new Date(now - WINDOW_MS).toISOString();
  try {
    if (!env.DB) throw new Error('D1 not bound');
    await ensureRateSchema(env);
    await env.DB.prepare('INSERT OR IGNORE INTO rate_limits (key, window_start, count) VALUES (?, ?, ?)').bind(key, nowIso, 0).run();
    const rolled = await env.DB.prepare('UPDATE rate_limits SET window_start = ?, count = ? WHERE key = ? AND window_start <= ?').bind(nowIso, 1, key, cutoff).run();
    if (rolled && rolled.meta && rolled.meta.changes) return null;
    const took = await env.DB.prepare('UPDATE rate_limits SET count = count + 1 WHERE key = ? AND count < ?').bind(key, rule.limit).run();
    if (took && took.meta && took.meta.changes) return null;
    const row = await env.DB.prepare('SELECT window_start FROM rate_limits WHERE key = ?').bind(key).first();
    const started = row && row.window_start ? Date.parse(row.window_start) : now;
    return { retry_after: seconds(started + WINDOW_MS - now) };
  } catch (e) {
    console.error('[Rate] limiter failed on ' + method + ' ' + pathname + ':', e.message);
    return rule.failOpen ? null : { retry_after: 60, degraded: true };
  }
}

/** Rows nobody has touched for a day carry no live window; the daily cron drops them. */
export async function purgeRateLimits(env) {
  if (!env.DB) return 0;
  const res = await env.DB.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(new Date(Date.now() - 86400000).toISOString()).run().catch(() => null);
  return (res && res.meta && res.meta.changes) || 0;
}

/* ─────────────────────────────── Per-account lockout ─────────────────────────────── */

export const LOGIN_FAILURES_PER_LOCK = 5;
const LOCK_BASE_MS = 15 * MINUTE, LOCK_MAX_MS = 24 * 3600000;

/** 5 → 15 min, 10 → 30, 15 → 60, 20 → 120 … capped at a day. */
export function lockMs(failures) {
  const steps = Math.max(0, Math.floor(failures / LOGIN_FAILURES_PER_LOCK) - 1);
  return Math.min(LOCK_BASE_MS * Math.pow(2, steps), LOCK_MAX_MS);
}

/** Seconds left on an account lock, or 0. Read before the password is hashed. */
export function lockedFor(acct, now = Date.now()) {
  const until = acct && acct.locked_until ? Date.parse(acct.locked_until) : 0;
  return Number.isFinite(until) && until > now ? seconds(until - now) : 0;
}

/**
 * A wrong password on an existing account. The failure is claimed with one conditional UPDATE and the count read back,
 * so parallel guesses cannot land on the same number and skip a lock. Returns the seconds locked, or 0.
 */
export async function noteFailedLogin(env, acct) {
  if (!env || !env.DB || !acct) return 0;
  try {
    await ensureRateSchema(env);
    const bumped = await env.DB.prepare('UPDATE accounts SET failed_logins = failed_logins + 1 WHERE id = ?').bind(acct.id).run();
    if (!bumped || !bumped.meta || !bumped.meta.changes) return 0;
    const row = await env.DB.prepare('SELECT failed_logins FROM accounts WHERE id = ?').bind(acct.id).first();
    const n = row && typeof row.failed_logins === 'number' ? row.failed_logins : (acct.failed_logins || 0) + 1;
    acct.failed_logins = n;
    if (n % LOGIN_FAILURES_PER_LOCK !== 0) return 0;
    const until = new Date(Date.now() + lockMs(n)).toISOString();
    // Never shorten a longer lock a parallel request already wrote.
    await env.DB.prepare('UPDATE accounts SET locked_until = ? WHERE id = ? AND (locked_until IS NULL OR locked_until < ?)').bind(until, acct.id, until).run();
    acct.locked_until = until;
    return lockedFor(acct);
  } catch (e) { console.error('[Rate] failed-login counter:', e.message); return 0; }
}

/** Any successful authentication clears the counter and the lock. Best-effort: an unmigrated column never blocks a sign-in. */
export async function clearFailedLogins(env, acct) {
  if (!env || !env.DB || !acct) return;
  if (!acct.failed_logins && !acct.locked_until) return;
  await env.DB.prepare('UPDATE accounts SET failed_logins = ?, locked_until = ? WHERE id = ?').bind(0, null, acct.id).run().catch((e) => console.error('[Rate] lock clear failed:', e.message));
  acct.failed_logins = 0; acct.locked_until = null;
}

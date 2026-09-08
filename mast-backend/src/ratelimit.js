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
 * A D1 failure inside the limiter FAILS CLOSED (429) on every limited route: a booking or a sign-in refused for a
 * minute is recoverable, an unmetered guessing window is not.
 *
 * EVERY public route is in the table (security review round 3, 2026-09-08). /event came OUT of it in round 2, on the
 * grounds that a counter in D1 turns every page view into a D1 write — true, and beside the point: /event is itself an
 * unauthenticated D1 INSERT, so leaving it out saved no write, it removed the only bound on how many an anonymous
 * caller could ask for. One counter row per address per window against one row per beacon is the cheaper half of that
 * trade, and a beacon answering 429 costs a visitor nothing. failOpen stayed gone: every limited route fails CLOSED.
 */

const MINUTE = 60000;
export const WINDOW_MS = 10 * MINUTE;

/**
 * "<METHOD> <path>" → the bucket its counter lives in and how many requests one IP gets per window.
 * forgot, resend and reset share the 'code' bucket: all three belong to one password-reset budget — two of them mail a
 * 6-digit code to whatever address is posted and the third spends guesses against one, so they are not three budgets.
 * The consequence is deliberate and worth naming: burning reset guesses eats into the same window as asking for a new
 * code, so a caller who spends 5 of the 20 on wrong codes cannot ask for a fresh one until the window rolls.
 */
export const RATE_ROUTES = {
  'POST /account/login': { bucket: 'login', limit: 20 },
  'POST /account/register': { bucket: 'signup', limit: 5 },
  'POST /account/forgot': { bucket: 'code', limit: 5 },
  'POST /account/resend': { bucket: 'code', limit: 5 },
  'POST /account/reset': { bucket: 'code', limit: 20 },
  'POST /account/verify': { bucket: 'verify', limit: 20 },
  'POST /register': { bucket: 'seat', limit: 10 },
  'POST /create-booking': { bucket: 'seat', limit: 10 },
  'POST /create-membership': { bucket: 'seat', limit: 10 },
  'POST /contact': { bucket: 'contact', limit: 30 },
  'POST /subscribe': { bucket: 'subscribe', limit: 10 },
  'GET /roster': { bucket: 'admin', limit: 60 },
  'POST /event': { bucket: 'event', limit: 60 },
};

/**
 * Path prefixes, any method — the staff tool is a tree of routes behind ADMIN_KEY, and an exact-path table would leave
 * every route added to it unlimited by default. /admin and everything under it share the 'admin' bucket with /roster.
 */
export const RATE_PREFIXES = [
  { path: '/admin', rule: { bucket: 'admin', limit: 60 } },
];

/** The rule for one request, exact path first and then the prefixes. null = the route is not limited. */
export function ruleFor(method, pathname) {
  const exact = RATE_ROUTES[method + ' ' + pathname];
  if (exact) return exact;
  for (const p of RATE_PREFIXES) if (pathname === p.path || pathname.startsWith(p.path + '/')) return p.rule;
  return null;
}

export const RATE_SCHEMA = [
  'CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, window_start TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0)',
  'CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits (window_start)',
  'ALTER TABLE accounts ADD COLUMN failed_logins INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE accounts ADD COLUMN locked_until TEXT',
  // The "someone tried to sign up with your address" notice throttles on its own column. It used to share verify_sent_at,
  // which let a stranger's sign-up attempt suppress the owner's own /account/forgot and /account/resend for a minute
  // (security review round 2, 2026-09-08). Carried here as well as in migrations/008 because that file has not been
  // applied to the live database yet.
  'ALTER TABLE accounts ADD COLUMN signup_notice_sent_at TEXT',
];

let schemaReady = null;
/**
 * Idempotent; once per isolate. Mirrors ensureCrmSchema: the ALTERs that already happened raise "duplicate column", which
 * is the success case, not a failure.
 *
 * SUCCESS ONLY IS MEMOISED. It used to return true whatever happened, so one statement failing once — a locked database,
 * a D1 blip on the very first request of an isolate — left the isolate believing the schema was there and never trying
 * again (security review round 2, 2026-09-08). A run with a genuinely failed step now clears the memo, so the next
 * request retries it.
 */
export function ensureRateSchema(env) {
  if (!env || !env.DB) return Promise.resolve(false);
  if (!schemaReady) {
    let attempt;
    attempt = (async () => {
      let allOk = true;
      for (const s of RATE_SCHEMA) {
        try { await env.DB.prepare(s).run(); }
        catch (e) {
          if (/duplicate column|already exists/i.test(String(e && e.message))) continue;
          allOk = false;
          console.error('[Rate] schema step failed:', s.slice(0, 48), e.message);
        }
      }
      if (!allOk && schemaReady === attempt) schemaReady = null;
      return allOk;
    })().catch((e) => { if (schemaReady === attempt) schemaReady = null; console.error('[Rate] schema failed:', e.message); return false; });
    schemaReady = attempt;
  }
  return schemaReady;
}
export function _resetRateSchemaMemo() { schemaReady = null; }   // tests

/**
 * The caller as Cloudflare sees it. CF-Connecting-IP ONLY: X-Forwarded-For is a request header anyone can set, so
 * falling back to it let a caller choose their own counter key and step out of every per-IP limit by rotating a string
 * (security review round 2, 2026-09-08). Without the Cloudflare header every such caller shares the one 'unknown'
 * bucket — a shared limit, not an unmetered hole, and limited routes still fail closed.
 *
 * ONE normalised value, and every cap uses it (security review round 3, 2026-09-08). The bare header used to reach the
 * seat-hold counter as an empty string, and an empty string made concurrentHolds count nothing — so a request arriving
 * without CF-Connecting-IP sat outside both hold caps rather than inside a shared one. 'unknown' is a bucket like any
 * other: shared, capped, never a bypass.
 */
export function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

const seconds = (ms) => Math.max(1, Math.ceil(ms / 1000));

/**
 * null = let it through. { retry_after } = 429.
 *
 * The row is created first so every decision below is one conditional UPDATE against a row that exists.
 */
export async function checkRate(request, env, method, pathname) {
  const rule = ruleFor(method, pathname);
  if (!rule) return null;
  const key = rule.bucket + ':' + clientIp(request);
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
    return { retry_after: 60, degraded: true };
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

/* ──────────── Failed sign-ins per (IP, address), whether or not the address has an account ────────────
   The per-account lock above cannot fire for an address that has no row, so the sixth wrong password answered 429 for a
   real address and 401 for an invented one — a one-request existence oracle, and a cheap one (security review round 2,
   2026-09-08). This counter is keyed on the pair (CF-Connecting-IP, normalised address) and lives in rate_limits, so an
   address with no account locks on exactly the attempt one with an account locks on, with the same body.

   key    'loginfail:<ip>:<address>'
   count  consecutive failures
   window_start  the ISO time the lock runs out, or NO_LOCK while there is none. The daily purge drops both, so a partial
                 count also resets once a day.

   What this does NOT make symmetric, stated rather than claimed away: the account lock is global and this one is per
   connection, so five failures from one address followed by a sixth from ANOTHER still answers 429 for a real account
   and 401 for an invented one. Closing that would mean locking on the address alone, which hands a stranger the power to
   lock a customer out and lets an attacker grow this table with addresses they invent. The remaining probe costs five
   requests from one address plus a sixth from a second, against a 20-per-window sign-in limit. */
const NO_LOCK = '1970-01-01T00:00:00.000Z';
const identityKey = (ip, email) => 'loginfail:' + (ip || 'unknown') + ':' + String(email || '').trim().toLowerCase();

/** Seconds left on the (IP, address) lock, or 0. Read before the password is hashed, for both paths. */
export async function identityLockedFor(env, ip, email, now = Date.now()) {
  if (!env || !env.DB) return 0;
  const row = await env.DB.prepare('SELECT window_start, count FROM rate_limits WHERE key = ?').bind(identityKey(ip, email)).first().catch(() => null);
  const until = row && row.window_start ? Date.parse(row.window_start) : 0;
  return Number.isFinite(until) && until > now ? seconds(until - now) : 0;
}

/** A wrong password, on any address. Same ladder as the per-account lock so the two fire on the same attempt. */
export async function noteFailedIdentity(env, ip, email) {
  if (!env || !env.DB) return 0;
  const key = identityKey(ip, email);
  try {
    await ensureRateSchema(env);
    await env.DB.prepare('INSERT OR IGNORE INTO rate_limits (key, window_start, count) VALUES (?, ?, ?)').bind(key, NO_LOCK, 0).run();
    const bumped = await env.DB.prepare('UPDATE rate_limits SET count = count + 1 WHERE key = ?').bind(key).run();
    if (!bumped || !bumped.meta || !bumped.meta.changes) return 0;
    const row = await env.DB.prepare('SELECT window_start, count FROM rate_limits WHERE key = ?').bind(key).first();
    const n = row && typeof row.count === 'number' ? row.count : 0;
    if (!n || n % LOGIN_FAILURES_PER_LOCK !== 0) return 0;
    const until = new Date(Date.now() + lockMs(n)).toISOString();
    // Never shorten a longer lock a parallel request already wrote.
    await env.DB.prepare('UPDATE rate_limits SET window_start = ? WHERE key = ? AND window_start < ?').bind(until, key, until).run();
    return seconds(Date.parse(until) - Date.now());
  } catch (e) { console.error('[Rate] identity failure counter:', e.message); return 0; }
}

/** The right password clears the pair, exactly as it clears the account counter. */
export async function clearFailedIdentity(env, ip, email) {
  if (!env || !env.DB) return;
  await env.DB.prepare('DELETE FROM rate_limits WHERE key = ?').bind(identityKey(ip, email)).run().catch((e) => console.error('[Rate] identity clear failed:', e.message));
}

/* ──────────── Wrong verification / reset codes, per (connection, account) ────────────
   Five wrong codes used to burn the live code outright, so a stranger who knew nothing but an address could reach into
   the owner's inbox and invalidate the code sitting in it — and, once round 2 made every wrong answer identical, do it
   silently. codeTooSoon() then refused the owner a replacement for the next minute, which is a denial of service built
   out of a safety feature (security review round 3, 2026-09-08).

   Two counters now, and they answer two different questions:
     per (IP, account)  five wrong guesses and THAT connection is refused; the code stays live for everyone else, so the
                        owner's own attempt is untouched by a stranger's.
     global             CODE_MAX_TRIES (20) wrong tries in total still burn it, because a code that has been guessed at
                        from twenty directions is a code under attack. Twenty tries against six digits is a 0.002%
                        chance of a hit, so the burn costs an attacker far more than it costs the owner — who is emailed
                        that it happened and can ask for a new one immediately.

   key    'codeguess:<ip>:<account id>'
   count  wrong guesses from that connection against that account
   The row is dropped when a fresh code is issued for the account, when a guess is right, and by the daily purge. */
export const CODE_GUESSES_PER_IP = 5;
const codeGuessKey = (ip, id) => 'codeguess:' + (ip || 'unknown') + ':' + id;

/** Wrong guesses this connection has already spent against this account. A D1 failure counts as none — the global
 *  counter inside checkCode is the control that must not fail open, and it lives on the accounts row. */
export async function codeGuessesSpent(env, ip, id) {
  if (!env || !env.DB) return 0;
  const row = await env.DB.prepare('SELECT count FROM rate_limits WHERE key = ?').bind(codeGuessKey(ip, id)).first().catch(() => null);
  return Number((row && row.count) || 0);
}

/** One wrong guess. Two statements, the same two whether or not the account exists. */
export async function noteCodeGuess(env, ip, id) {
  if (!env || !env.DB) return;
  const key = codeGuessKey(ip, id);
  try {
    await ensureRateSchema(env);
    await env.DB.prepare('INSERT OR IGNORE INTO rate_limits (key, window_start, count) VALUES (?, ?, ?)').bind(key, new Date().toISOString(), 0).run();
    await env.DB.prepare('UPDATE rate_limits SET count = count + 1 WHERE key = ?').bind(key).run();
  } catch (e) { console.error('[Rate] code-guess counter:', e.message); }
}

/** A right guess, or a fresh code, clears what EVERY connection has spent against this account: the owner asking for a
 *  new code is what un-refuses the connection that typo'd its way to five. */
export async function clearCodeGuesses(env, id) {
  if (!env || !env.DB) return;
  await env.DB.prepare('DELETE FROM rate_limits WHERE key LIKE ?').bind('codeguess:%:' + id).run().catch((e) => console.error('[Rate] code-guess clear failed:', e.message));
}

/** Any successful authentication clears the counter and the lock. Best-effort: an unmigrated column never blocks a sign-in. */
export async function clearFailedLogins(env, acct) {
  if (!env || !env.DB || !acct) return;
  if (!acct.failed_logins && !acct.locked_until) return;
  await env.DB.prepare('UPDATE accounts SET failed_logins = ?, locked_until = ? WHERE id = ?').bind(0, null, acct.id).run().catch((e) => console.error('[Rate] lock clear failed:', e.message));
  acct.failed_logins = 0; acct.locked_until = null;
}

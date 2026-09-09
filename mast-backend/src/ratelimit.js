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
  // A sign-up that nobody has proved yet. It lives HERE, in the rate-limiter's schema hook, because ensureRateSchema is
  // the one memoised self-heal every limited route already awaits — and /account/register is a limited route — so a
  // Worker deployed ahead of migrations/012 still has the table rather than answering 500 to every sign-up. The row is
  // keyed on a RANDOM signup_id and carries the address only as a DIGEST: pending_signups never holds the plaintext
  // address of someone who has not verified, and one address may hold as many rows as the mail budgets allow.
  'CREATE TABLE IF NOT EXISTS pending_signups (signup_id TEXT PRIMARY KEY, address_digest TEXT NOT NULL, password_hash TEXT NOT NULL, name TEXT, phone TEXT, organization TEXT, code_hash TEXT, verify_expires_at TEXT, verify_attempts INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, created_ip TEXT)',
  // The lookup /account/verify makes: ONE indexed read on (address_digest, code_hash) finds at most one row however
  // many sign-ups are waiting at the address, which is what keeps the route's statement count independent of them.
  'CREATE INDEX IF NOT EXISTS idx_pending_signups_code ON pending_signups (address_digest, code_hash)',
  'CREATE INDEX IF NOT EXISTS idx_pending_signups_created ON pending_signups (created_at)',
];

/**
 * The one schema step a CREATE cannot do: rounds 5 and 6 keyed pending_signups on address_digest as its PRIMARY KEY, and
 * round 7 keys it on a random signup_id so an address can hold a row per sign-up. A primary key cannot be ALTERed onto an
 * existing table, and `CREATE TABLE IF NOT EXISTS` is a no-op against the old one — so a Worker that met a round-5/6
 * database would write signup_id into a table that has no such column and every sign-up would fail silently.
 *
 * This drops the table when, and only when, it exists WITHOUT signup_id: the old shape and nothing else. What is lost is
 * unverified sign-ups minutes old by design, which is the same thing migrations/012 drops and the same thing the daily
 * purge drops. It exists because ONE of the two live deploy paths (scripts/wp-upload.sh, hourly) applies no migrations
 * at all — see README residual 5 — so "the migration will have run first" is not something this Worker may assume.
 */
export async function healPendingSignups(env) {
  const cols = await env.DB.prepare("SELECT name FROM pragma_table_info('pending_signups')").all();
  const names = ((cols && cols.results) || []).map((r) => r.name);
  if (!names.length || names.includes('signup_id')) return false;
  await env.DB.prepare('DROP TABLE IF EXISTS pending_signups').run();
  console.error('[Rate] pending_signups was the pre-round-7 shape (no signup_id) — dropped so the per-sign-up table can be created');
  return true;
}

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
      try { await healPendingSignups(env); }
      catch (e) { allOk = false; console.error('[Rate] pending_signups heal failed:', e.message); }
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
 *
 * Its absent-account twin is dummyFailedLogin below, and the two must stay statement-for-statement identical.
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

/**
 * The absent-account twin of noteFailedLogin: the same UPDATE, the same read-back and the same conditional lock write,
 * bound to an id no row carries. /account/login ran noteFailedLogin only `if (acct)`, so a wrong password cost a real
 * address two statements more than an invented one — and three on every fifth try, where the lock is written (security
 * review round 4, 2026-09-08). The ladder is driven by the (IP, address) count, which is the only failure count an
 * absent address has; against a real account the two counts move together on one connection, and can differ when the
 * same address is sprayed from several, which is stated in the README rather than claimed away.
 */
export async function dummyFailedLogin(env, id, failures) {
  if (!env || !env.DB) return 0;
  try {
    await ensureRateSchema(env);
    await env.DB.prepare('UPDATE accounts SET failed_logins = failed_logins + 1 WHERE id = ?').bind(id).run();
    await env.DB.prepare('SELECT failed_logins FROM accounts WHERE id = ?').bind(id).first();
    if (!failures || failures % LOGIN_FAILURES_PER_LOCK !== 0) return 0;
    const until = new Date(Date.now() + lockMs(failures)).toISOString();
    await env.DB.prepare('UPDATE accounts SET locked_until = ? WHERE id = ? AND (locked_until IS NULL OR locked_until < ?)').bind(until, id, until).run();
    return 0;
  } catch (e) { console.error('[Rate] failed-login twin:', e.message); return 0; }
}

/* ──────────── Failed sign-ins per (IP, address), whether or not the address has an account ────────────
   The per-account lock above cannot fire for an address that has no row, so the sixth wrong password answered 429 for a
   real address and 401 for an invented one — a one-request existence oracle, and a cheap one (security review round 2,
   2026-09-08). This counter is keyed on the pair (CF-Connecting-IP, normalised address) and lives in rate_limits, so an
   address with no account locks on exactly the attempt one with an account locks on, with the same body.

   key    'loginfail:<ip>:<digest of the address>'
   count  consecutive failures
   window_start  the ISO time the lock runs out, or NO_LOCK while there is none. The daily purge drops both, so a partial
                 count also resets once a day.

   THE ADDRESS IS DIGESTED (round 5, 2026-09-09). This key carried the plaintext address from round 2 onward, so
   rate_limits accumulated a list of every address a stranger had typed at the sign-in form — the exact property the
   code-guess counter three functions below claims for itself. A digest finds the same row on the next request, which is
   the only thing a counter needs, so there was never anything to trade for it.

   What this does NOT make symmetric, stated rather than claimed away: the account lock is global and this one is per
   connection, so five failures from one address followed by a sixth from ANOTHER still answers 429 for a real account
   and 401 for an invented one. Closing that would mean locking on the address alone, which hands a stranger the power to
   lock a customer out and lets an attacker grow this table with addresses they invent. The remaining probe costs five
   requests from one address plus a sixth from a second, against a 20-per-window sign-in limit. */
const NO_LOCK = '1970-01-01T00:00:00.000Z';
const identityKey = async (ip, email) => 'loginfail:' + (ip || 'unknown') + ':' + (await addressDigest(email)).slice(0, 16);

/** Seconds left on the (IP, address) lock, or 0. Read before the password is hashed, for both paths. */
export async function identityLockedFor(env, ip, email, now = Date.now()) {
  if (!env || !env.DB) return 0;
  const row = await env.DB.prepare('SELECT window_start, count FROM rate_limits WHERE key = ?').bind(await identityKey(ip, email)).first().catch(() => null);
  const until = row && row.window_start ? Date.parse(row.window_start) : 0;
  return Number.isFinite(until) && until > now ? seconds(until - now) : 0;
}

/**
 * A wrong password, on any address. Same ladder as the per-account lock so the two fire on the same attempt.
 *
 * Returns the failure COUNT this attempt landed on, not the seconds locked (round 4): it is the only failure count an
 * address with no account has, so it is what drives the absent twin of noteFailedLogin. The lock itself is read back by
 * identityLockedFor on the next attempt, which is where it is answered, so nothing needed the seconds here.
 */
export async function noteFailedIdentity(env, ip, email) {
  if (!env || !env.DB) return 0;
  const key = await identityKey(ip, email);
  try {
    await ensureRateSchema(env);
    await env.DB.prepare('INSERT OR IGNORE INTO rate_limits (key, window_start, count) VALUES (?, ?, ?)').bind(key, NO_LOCK, 0).run();
    const bumped = await env.DB.prepare('UPDATE rate_limits SET count = count + 1 WHERE key = ?').bind(key).run();
    if (!bumped || !bumped.meta || !bumped.meta.changes) return 0;
    const row = await env.DB.prepare('SELECT window_start, count FROM rate_limits WHERE key = ?').bind(key).first();
    const n = row && typeof row.count === 'number' ? row.count : 0;
    if (!n || n % LOGIN_FAILURES_PER_LOCK !== 0) return n;
    const until = new Date(Date.now() + lockMs(n)).toISOString();
    // Never shorten a longer lock a parallel request already wrote.
    await env.DB.prepare('UPDATE rate_limits SET window_start = ? WHERE key = ? AND window_start < ?').bind(until, key, until).run();
    return n;
  } catch (e) { console.error('[Rate] identity failure counter:', e.message); return 0; }
}

/** The right password clears the pair, exactly as it clears the account counter. */
export async function clearFailedIdentity(env, ip, email) {
  if (!env || !env.DB) return;
  await env.DB.prepare('DELETE FROM rate_limits WHERE key = ?').bind(await identityKey(ip, email)).run().catch((e) => console.error('[Rate] identity clear failed:', e.message));
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

   key    on /account/reset:  'codeguess:<ip>:<account id>', or 'codeguess:<ip>:absent:<digest>' when there is no account
          on /account/verify: 'codeguess:<ip>:pending:<digest>' ALWAYS, whether or not a sign-up is in progress (round 5)
                              — the row appearing is something a caller can cause with one /account/register, so keying
                              on its presence would hand a spent connection five fresh guesses for the price of a POST
   count  wrong guesses from that connection against that account
   The row is dropped when a guess is RIGHT and when the owner signs in with their password, and by the daily purge. A
   fresh code no longer drops it (round 4) — see issueCode in src/worker.js.

   THE ABSENT KEY IS PER ADDRESS (round 4, 2026-09-08). It used to be the constant id every absent path binds, so every
   invented address on the internet shared one row: five wrong guesses at one throwaway address armed it, and from the
   sixth request onward any address could be classified in ONE request — an invented one was refused before the twin
   statements ran (5 statements) where a real one still spent them (9). Two ranges that do not overlap is an
   account-existence oracle, whatever the body says. Keyed on a digest of the address, a ghost gets its own five-guess
   budget exactly as a real account does: an attacker rotating invented addresses cannot exhaust one shared row, cannot
   spend a real account's budget, and a real address never shares a counter with ghosts. The digest, not the address, so
   the table never holds a list of the addresses strangers have typed. */
export const CODE_GUESSES_PER_IP = 5;
const codeGuessKey = (ip, id) => 'codeguess:' + (ip || 'unknown') + ':' + id;

/**
 * SHA-256 over the normalised address, hex. THE one address digest in this Worker: the counter keys below, the sign-in
 * failure key above and the primary key of pending_signups are all cut from it, so nothing in rate_limits or in an
 * unverified sign-up row is a readable list of the addresses strangers have typed. A digest finds the same row the next
 * request finds, which is everything a counter or a pending row needs.
 */
export async function addressDigest(email) {
  const bytes = new TextEncoder().encode(String(email || '').trim().toLowerCase());
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The counter id for an address with no account: 'absent:' + the first 16 hex of the digest. */
export async function absentGuessId(email) {
  return 'absent:' + (await addressDigest(email)).slice(0, 16);
}

/** The verify route's counter id, whether or not a pending sign-up exists — one guess budget per (connection, address). */
export async function pendingGuessId(email) {
  return 'pending:' + (await addressDigest(email)).slice(0, 16);
}

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

/**
 * A RIGHT guess, or the owner signing in with their password, clears what every connection has spent against this
 * account. Asking for a fresh code no longer does (round 4, 2026-09-08): a reissue is an UNAUTHENTICATED request, so
 * clearing here let one /account/register or /account/forgot between every five guesses buy an attacker an endless run
 * of five-guess batches — and, with verify_attempts zeroed alongside it, the twenty-try global burn never fired at all.
 * The mistyping customer's way back is the same one it always was, minus the stranger's copy of it: sign in, or use
 * another connection, or wait for the daily purge.
 */
export async function clearCodeGuesses(env, id) {
  if (!env || !env.DB) return;
  await env.DB.prepare('DELETE FROM rate_limits WHERE key LIKE ?').bind('codeguess:%:' + id).run().catch((e) => console.error('[Rate] code-guess clear failed:', e.message));
}

/* ──────────── Unauthenticated code mail: budgets a STRANGER CANNOT SPEND ON THE OWNER'S BEHALF ────────────
   Round 4 capped the mailbox with one counter per ADDRESS, three an hour, whoever asked. That counter is one a stranger
   SHARES with the owner, and /account/forgot is the owner's only way back from a sign-in lock: three unauthenticated
   requests from any three connections, in under a second, closed the documented escape hatch for an hour — and the
   README asserted in the same commit that the hatch was what kept the lock a denial rather than a lockout (security
   review round 4, 2026-09-08, P1). Worse, the slot was spent BEFORE the mail was decided, so requests that sent nothing
   still consumed it.

   Round 5 replaces it with two budgets, and neither of them is spendable by anyone but the caller:
     per (connection, address)  'codemail:<ip>:<digest of the address>'   3 an hour
     per connection, all mail   'codemailtotal:<ip>'                      30 an hour
   A stranger can spend their OWN three at the owner's address and their OWN thirty across every address they can think
   of. The owner's next request arrives on a different connection with its own untouched budget, so recovery cannot be
   held shut from outside. Both keys carry a digest, never the address.

   THERE IS DELIBERATELY NO GLOBAL PER-ADDRESS CAP, and that is a stated trade rather than an oversight. Any counter
   keyed on the address alone is, by construction, a counter a stranger can spend for the owner — which is the P1 above.
   What bounds the mailbox instead is the price of connections: one gets 3 mails an hour at one address, so about 72 a
   day, where round 4's shape allowed ~1,440 from a single host. An attacker who rents twenty addresses can still reach
   ~1,440 a day at one mailbox; that is written down in README "What is NOT closed" rather than claimed closed, because
   the alternative is a lockout switch anyone on the internet may flip.

   A SLOT IS SPENT ONLY WHEN A MAIL ACTUALLY GOES. `sending` is decided from state the route has already read (is there
   an account or a pending sign-up, and is the 60-second reissue throttle up), and it is bound into the taking UPDATE as
   its limit — a limit of -1 can never be met, so the branch that mails nothing takes nothing while running exactly the
   same statements. The customer who taps "resend" three times in ninety seconds therefore still has their budget.

   SIX STATEMENTS, always, whichever way it answers and whichever branch the route is on: create the row, roll a window
   that has run out, take the try with one conditional UPDATE — twice, once per budget. An answer that changed the
   statement count would be the oracle this whole surface exists to close. Fails CLOSED, like every other limiter here. */
export const CODE_MAIL_PER_PAIR = 3;
export const CODE_MAIL_PER_IP = 30;
export const CODE_MAIL_WINDOW_MS = 60 * MINUTE;
const pairMailKey = (ip, digest) => 'codemail:' + (ip || 'unknown') + ':' + digest.slice(0, 16);
const ipMailKey = (ip) => 'codemailtotal:' + (ip || 'unknown');

/** One budget: three statements, and it takes only when `limit` is a number it can reach. */
async function spendMailBudget(env, key, limit) {
  const nowIso = new Date().toISOString();
  const cutoff = new Date(Date.now() - CODE_MAIL_WINDOW_MS).toISOString();
  await env.DB.prepare('INSERT OR IGNORE INTO rate_limits (key, window_start, count) VALUES (?, ?, ?)').bind(key, nowIso, 0).run();
  await env.DB.prepare('UPDATE rate_limits SET window_start = ?, count = ? WHERE key = ? AND window_start <= ?').bind(nowIso, 0, key, cutoff).run();
  const took = await env.DB.prepare('UPDATE rate_limits SET count = count + 1 WHERE key = ? AND count < ?').bind(key, limit).run();
  return !!(took && took.meta && took.meta.changes);
}

/**
 * true = mail it. `sending` is what the route already knows about its own state; passing false runs every statement and
 * takes nothing, which is how "this request was never going to mail" costs a caller no allowance and costs an observer
 * no information.
 */
export async function noteCodeMail(env, ip, email, sending) {
  if (!env || !env.DB) return false;
  const digest = await addressDigest(email);
  try {
    await ensureRateSchema(env);
    const pair = await spendMailBudget(env, pairMailKey(ip, digest), sending ? CODE_MAIL_PER_PAIR : -1);
    const total = await spendMailBudget(env, ipMailKey(ip), sending && pair ? CODE_MAIL_PER_IP : -1);
    return pair && total;
  } catch (e) { console.error('[Rate] code-mail budget:', e.message); return false; }
}

/** Any successful authentication clears the counter and the lock. Best-effort: an unmigrated column never blocks a sign-in. */
export async function clearFailedLogins(env, acct) {
  if (!env || !env.DB || !acct) return;
  if (!acct.failed_logins && !acct.locked_until) return;
  await env.DB.prepare('UPDATE accounts SET failed_logins = ?, locked_until = ? WHERE id = ?').bind(0, null, acct.id).run().catch((e) => console.error('[Rate] lock clear failed:', e.message));
  acct.failed_logins = 0; acct.locked_until = null;
}

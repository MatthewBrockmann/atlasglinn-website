/**
 * MAST Solutions — booking & membership backend.
 *
 * Cloudflare Worker handling Stripe Checkout for:
 *   - registration              POST /register   screening → agreement → refund consent → Stripe
 *   - one-time class seats      POST /create-booking   (legacy path, no screening; kept for the WP theme)
 *   - recurring memberships     POST /create-membership
 *   - Stripe webhooks           POST /webhook
 *   - admin roster              GET  /roster?key=...[&view=registrations]
 *   - health                    GET  /health
 *   - daily cron                scheduled(): purge eligibility answers, expire abandoned registrations; Mondays, the CRM digest
 *
 * Design notes vs. the older safeguard-stripe-backend:
 *   1. PRICES ARE SERVER-SIDE. The client sends a SKU, never an amount, so a
 *      crafted request cannot buy a $695 class for $1.
 *   2. ORDERS ARE PERSISTED. Completed checkouts are written to D1 and a
 *      notification email is sent, so a paid booking is never only a log line.
 *   3. CORS IS AN ALLOWLIST, not "*".
 *   4. Webhook signatures use a constant-time compare plus a replay window.
 *   5. ELIGIBILITY ANSWERS NEVER LEAVE D1. They are stored apart from the
 *      outcome, purged on a schedule, and never emailed or put in an event.
 */

import { AGREEMENT_VERSION, fillAgreement } from './agreement.js';
import { directionsAttachment, directionsStatus } from './directions.js';
import { publicKeyInfo } from './sealed.js';
import { checkRate, purgeRateLimits, clientIp, lockedFor, noteFailedLogin, dummyFailedLogin, clearFailedLogins, identityLockedFor, noteFailedIdentity, clearFailedIdentity, codeGuessesSpent, noteCodeGuess, clearCodeGuesses, absentGuessId, noteCodeMail, CODE_GUESSES_PER_IP } from './ratelimit.js';
import { ensureCrmSchema, crmSnapshot, audienceCsv, syncAudience, syncOnPayment, syncLead, adminPage, attributionFrom, recordContact, markContactEmailed, recordEvent, handleEvent, handleSubscribe, runJourneys, weeklyDigest, weeklyDigestPeriod } from './crm.js';

const REPLAY_WINDOW_SECONDS = 300; // reject webhook timestamps older than 5 min

/** Version stamps. The page sends what it showed; a mismatch means the participant saw stale terms. */
export const QUESTIONS_VERSION = '2q-2026-09-03';        // the two questions as worded on the page
export const REFUND_POLICY_VERSION = '2026-09-01'; // REFUND-POLICY-DRAFT.md as rendered on the page; approved by the owner 2026-09-02
export { AGREEMENT_VERSION };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      // Per-IP limits before anything reads a body or hashes a password (src/ratelimit.js): unlimited online guessing
      // against /account/login was the finding that created this gate, and the same counter caps the routes that mail a
      // code, hold a seat or write a lead. Routes not in RATE_ROUTES are untouched.
      const gate = await checkRate(request, env, request.method, url.pathname);
      if (gate) return tooMany(cors, gate.retry_after, 'rate_limited', 'Too many requests from this connection. Please wait a moment and try again.');

      if (url.pathname === '/health' && request.method === 'GET') {
        // build = the commit the deploy was made from (`wrangler deploy --var BUILD:<sha>`, set by scripts/wp-upload.sh and
        // deploy-worker.yml), so a runner can tell which merge is running; crm marks the /event, /subscribe, /admin routes.
        // directions: sealed = the owner's range PDF decrypts on this Worker (src/sealed.js); secrets = rendered from RANGE_*; none.
        const directions = await directionsStatus(env).catch((e) => 'error: ' + e.message);
        return json({ status: 'MAST booking backend — ONLINE', version: '1.2.0', build: env.BUILD || null, crm: true, directions }, 200, cors);
      }
      if (url.pathname === '/directions-key' && request.method === 'GET') {
        // The public half of the Worker's sealing key (never the private half). Anyone may read it; only main decides what is sealed.
        if (!env.DB) return json({ error: 'Database not bound' }, 503, cors);
        return json(await publicKeyInfo(env), 200, { ...cors, 'Cache-Control': 'no-store' });
      }
      if (url.pathname === '/catalog' && request.method === 'GET') {
        return await handleCatalog(env, cors);
      }
      if (url.pathname === '/weekends' && request.method === 'GET') {
        return await handleWeekends(env, cors);
      }
      if (url.pathname === '/register' && request.method === 'POST') {
        return await handleRegister(request, env, ctx, cors);
      }
      if (url.pathname === '/contact' && request.method === 'POST') {
        return await handleContact(request, env, cors);
      }
      if (url.pathname === '/create-booking' && request.method === 'POST') {
        return await handleBooking(request, env, cors);
      }
      if (url.pathname === '/create-membership' && request.method === 'POST') {
        return await handleMembership(request, env, cors);
      }
      if (url.pathname === '/webhook' && request.method === 'POST') {
        return await handleWebhook(request, env, ctx, cors);
      }
      // Student accounts (owner, 2026-09-05)
      if (url.pathname === '/account/register' && request.method === 'POST') return await handleAccountRegister(request, env, cors);
      if (url.pathname === '/account/login' && request.method === 'POST') return await handleAccountLogin(request, env, ctx, cors);
      if (url.pathname === '/account/verify' && request.method === 'POST') return await handleAccountVerify(request, env, ctx, cors);
      if (url.pathname === '/account/resend' && request.method === 'POST') return await handleAccountResend(request, env, ctx, cors);
      if (url.pathname === '/account/forgot' && request.method === 'POST') return await handleAccountForgot(request, env, ctx, cors);
      if (url.pathname === '/account/reset' && request.method === 'POST') return await handleAccountReset(request, env, ctx, cors);
      if (url.pathname === '/account/me' && request.method === 'GET') return await handleAccountMe(request, env, cors);
      if (url.pathname === '/account/update' && request.method === 'POST') return await handleAccountUpdate(request, env, cors);
      if (url.pathname === '/account/password' && request.method === 'POST') return await handleAccountPassword(request, env, cors);
      if (url.pathname === '/account/setup-payment' && request.method === 'POST') return await handleAccountSetupPayment(request, env, cors);
      if (url.pathname === '/roster' && request.method === 'GET') {
        return await handleRoster(request, env, cors);
      }
      // CRM + marketing (owner, 2026-09-06: "CRM should collect data - and much more"): the beacon and the newsletter form
      // are public; everything under /admin is the staff tool behind ADMIN_KEY.
      if (url.pathname === '/event' && request.method === 'POST') return await handleEvent(request, env, cors, json);
      if (url.pathname === '/subscribe' && request.method === 'POST') return await handleSubscribe(request, env, cors, json);
      if (url.pathname === '/admin' && request.method === 'GET') {
        return new Response(adminPage(), { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' } });
      }
      if (url.pathname.startsWith('/admin/')) return await handleAdmin(request, env, cors, url);
      return json({ error: 'Not found' }, 404, cors);
    } catch (err) {
      console.error('[Worker] Unhandled:', err.stack || err.message);
      return json({ error: 'Internal server error' }, 500, cors);
    }
  },

  /** Daily cron (wrangler.toml [triggers]). */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runRetention(env).catch((e) => console.error('[Retention] failed:', e.message)));
    // T−7 / T−1 / T+1 to booked participants (DATA-AND-MARKETING.md "Triggered journeys"); one per participant, class and kind.
    // Off until the owner has read the three emails (his 2026-09-06 "show me them before"): JOURNEYS_ENABLED = "1" in wrangler.toml [vars]
    // switches the cron on; POST /admin/journeys (staff, ADMIN_KEY) runs a day by hand meanwhile.
    if (String(env.JOURNEYS_ENABLED) === '1') {
      ctx.waitUntil(runJourneys(env, { send: (m) => sendEmail(env, m), catalog: await catalogRows(env) }).catch((e) => console.error('[Journeys] failed:', e.message)));
    } else console.log('[Journeys] off (JOURNEYS_ENABLED is not "1")');
    // Monday (owner, 2026-09-08: "weekly CRM Emails to matthew@atlasglinn.com + Matthew@mastsolutions.com"), and Tuesday or
    // Wednesday as the retry: a Resend outage on Monday used to cost the week its digest. sendWeeklyDigest is the idempotent
    // half — it claims the week in email_log before it sends and no-ops when the week is already claimed, so a doubled
    // Monday fire still sends once. It is queued alongside the purge in its own promise with its own catch: a CRM read that
    // fails cannot reach the retention run.
    const weekday = new Date(event && event.scheduledTime).getUTCDay();
    if (weekday >= 1 && weekday <= 3) {
      ctx.waitUntil(sendWeeklyDigest(env, new Date(event.scheduledTime)).catch((e) => console.error('[Digest] failed:', e.message)));
    }
  },
};

/* ───────────────────────── Student accounts (owner, 2026-09-05) ─────────────────────────
   "ADD ACCOUNT = account info to include payment method + save + classes taken + placeholder for Standards Passed + other
   details + account email + password." Email + password: PBKDF2-SHA256 (100,000 iterations, 16-byte salt) via WebCrypto,
   nothing reversible stored. Sessions are HMAC-SHA256 tokens (ACCOUNT_SECRET) carrying the account id, its token_version and
   an expiry; a password change bumps token_version so every issued token dies. The saved card lives on the account's Stripe
   Customer, set up through Checkout in setup mode; the Worker never sees card numbers. Classes taken are read from
   registrations by email. Without ACCOUNT_SECRET every /account/* call answers 503. */
const ACCOUNT_TOKEN_DAYS = 30;
const PBKDF2_ITER = 100000;
const PROFILE_FIELDS = ['name', 'phone', 'organization', 'address1', 'address2', 'emergency_name', 'emergency_phone', 'emergency_relationship'];
/* Credentials (owner, 2026-09-08: "Need to add 'CREDENTIALS' to the account if LE Teacher"). The account holder types what
   they hold; nothing is checked here. Any change stamps the row 'pending' and emails the office, and a person marks it
   verified or declined in the D1 console — credential_status is never taken from the client. */
const CREDENTIAL_TYPES = { none: 'None', le: 'Law enforcement', teacher: 'Teacher / educator' };

function b64(buf) { let s = ''; const a = new Uint8Array(buf); for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s); }
function unb64(s) { return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); }
function b64url(buf) { return b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function unb64url(s) { s = String(s).replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return unb64(s); }

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
}
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await pbkdf2(password, salt, PBKDF2_ITER);
  return 'pbkdf2-sha256$' + PBKDF2_ITER + '$' + b64(salt) + '$' + b64(bits);
}
async function verifyPassword(password, stored) {
  const [alg, iter, salt, hash] = String(stored || '').split('$');
  if (alg !== 'pbkdf2-sha256' || !salt || !hash) return false;
  let bits; try { bits = await pbkdf2(password, unb64(salt), parseInt(iter, 10) || PBKDF2_ITER); } catch (e) { return false; }
  const a = new Uint8Array(bits), b = unb64(hash);
  if (a.length !== b.length) return false;
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function signToken(env, account) {
  const exp = Date.now() + ACCOUNT_TOKEN_DAYS * 86400000;
  const body = b64url(new TextEncoder().encode(JSON.stringify({ id: account.id, v: account.token_version || 1, exp })));
  const sig = b64url(await crypto.subtle.sign('HMAC', await hmacKey(env.ACCOUNT_SECRET), new TextEncoder().encode(body)));
  return body + '.' + sig;
}
async function readToken(env, token) {
  if (!env.ACCOUNT_SECRET || !token || token.indexOf('.') < 0) return null;
  const [body, sig] = String(token).split('.');
  let okSig = false;
  try { okSig = await crypto.subtle.verify('HMAC', await hmacKey(env.ACCOUNT_SECRET), unb64url(sig), new TextEncoder().encode(body)); } catch (e) { return null; }
  if (!okSig) return null;
  let claims; try { claims = JSON.parse(new TextDecoder().decode(unb64url(body))); } catch (e) { return null; }
  if (!claims || !claims.id || !claims.exp || claims.exp < Date.now()) return null;
  return claims;
}
function bearer(request) { const m = /^Bearer\s+(.+)$/i.exec(request.headers.get('Authorization') || ''); return m ? m[1].trim() : ''; }
async function accountFromToken(env, token) {
  const claims = await readToken(env, token);
  if (!claims) return null;
  const row = await env.DB.prepare('SELECT * FROM accounts WHERE id = ?').bind(claims.id).first();
  if (!row || (row.token_version || 1) !== claims.v || !row.verified_at) return null;   // tokens are only signed after the email is verified
  return row;
}
async function requireAccount(request, env, cors) {
  if (!env.ACCOUNT_SECRET) return { res: json({ error: 'Accounts are not configured yet.', code: 'accounts_off' }, 503, cors) };
  const acct = await accountFromToken(env, bearer(request));
  if (!acct) return { res: json({ error: 'Please sign in again.', code: 'unauthorized' }, 401, cors) };
  return { acct };
}
function publicAccount(a) {
  let standards = []; try { standards = JSON.parse(a.standards_passed || '[]'); } catch (e) { standards = []; }
  return {
    id: a.id, email: a.email, name: a.name || '', phone: a.phone || '', organization: a.organization || '',
    address1: a.address1 || '', address2: a.address2 || '', emergency_name: a.emergency_name || '', emergency_phone: a.emergency_phone || '',
    emergency_relationship: a.emergency_relationship || '', standards_passed: Array.isArray(standards) ? standards : [],
    credential_type: a.credential_type || 'none', credential_org: a.credential_org || '',
    credential_status: a.credential_status || 'none',
    credential_id_last4: a.credential_id ? String(a.credential_id).slice(-4) : '',   // the number itself never leaves the database
    has_stripe_customer: !!a.stripe_customer_id, created_at: a.created_at, last_login_at: a.last_login_at || null,
  };
}

/* Email ownership (Codex review of PR #10, 2026-09-05, P1): an account is only live — and only sees the classes booked under
   its email — after a 6-digit code emailed to that address comes back. Until then no token is issued, and an unverified
   row is purged after a day. This paragraph used to end "an unverified account is overwritten by the next sign-up for the
   same address (nobody can squat a student's email)", and round 3 reversed exactly that: a sign-up writes NOTHING to an
   existing row, so the first password typed is the one on it and handleAccountVerify never moves it. Who owns a squatted
   address is therefore not settled here — /account/forgot → /account/reset is what moves a password and marks the address
   verified, and README.md "What is NOT closed" carries the measured probe and the two fixes (round 4, 2026-09-08).
   The same code mechanism carries the forgotten-password path (P2). Codes: 6 digits, 15 minutes, one at a time per
   account, stored as an HMAC of (account id, purpose, code) under ACCOUNT_SECRET; re-sends at most once a minute.

   TRIES ARE COUNTED TWICE, and the two counts answer two different questions (security review round 3, 2026-09-08).
   Five wrong guesses from ONE connection refuse that connection (src/ratelimit.js) and leave the code live for everyone
   else, which is what stops a stranger reaching into the owner's inbox and invalidating the code sitting in it. The
   global count below is what a code under real attack runs into: twenty tries against six digits is a 0.002% chance of
   a hit, so the burn costs an attacker far more than the owner — who is emailed that it happened and may ask for a
   replacement at once. It was 5 globally, so five requests from a stranger burned the owner's code and codeTooSoon()
   then held the replacement shut for a minute. */
const CODE_TTL_MS = 15 * 60000, CODE_MAX_TRIES = 20, CODE_RESEND_MS = 60000;
/** The id every absent-account path binds, so a ghost address spends the statements a real one spends. No row carries it. */
const ABSENT_ID = 'acct_absent';
function accountsOff(env, cors) {
  if (!env.ACCOUNT_SECRET) return json({ error: 'Accounts are not configured yet.', code: 'accounts_off' }, 503, cors);
  return null;
}
function signupOff(env, cors) {
  // Sign-up, verification and password reset all need the email leg; without it the page shows a clear message, not a dead code box.
  if (!env.RESEND_API_KEY) return json({ error: 'Account sign-up is not available yet. Please book as a guest.', code: 'email_off' }, 503, cors);
  return null;
}
function newCode() { const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000; return String(n).padStart(6, '0'); }
async function codeHash(env, acct, kind, code) {
  return b64url(await crypto.subtle.sign('HMAC', await hmacKey(env.ACCOUNT_SECRET), new TextEncoder().encode(acct.id + ':' + kind + ':' + String(code))));
}
/**
 * A fresh code. It does NOT reset the abuse counters (security review round 4, 2026-09-08), and that is the whole
 * change: it used to zero verify_attempts AND drop every connection's guess counter for the account, while every route
 * that calls it — /account/register, /account/forgot, /account/resend — is UNAUTHENTICATED. So a stranger who
 * interleaved one reissue between every five guesses bought themselves an unbounded run of five-guess batches and
 * deferred the twenty-try global burn indefinitely: 25 wrong codes across five connections with a sign-up between each
 * batch left the code live and sent the owner nothing. The counters are cleared by a CORRECT code (guardedCheckCode)
 * and by the owner signing in with their password (handleAccountLogin), which are the two things a stranger cannot do.
 * verify_attempts therefore counts wrong tries against the ADDRESS across however many codes were issued, until one of
 * them is right or twenty of them are wrong and the code burns.
 */
async function issueCode(env, acct, kind) {
  const code = newCode(), now = Date.now();
  const hash = await codeHash(env, acct, kind, code);
  const exp = new Date(now + CODE_TTL_MS).toISOString(), sent = new Date(now).toISOString();
  await env.DB.prepare('UPDATE accounts SET verify_kind = ?, verify_code_hash = ?, verify_expires_at = ?, verify_sent_at = ? WHERE id = ?').bind(kind, hash, exp, sent, acct.id).run();
  Object.assign(acct, { verify_kind: kind, verify_code_hash: hash, verify_expires_at: exp, verify_sent_at: sent });
  return code;
}
/**
 * The absent-account twin of issueCode: the same HMAC and the same statement, bound to an id no row carries, so
 * /account/forgot and /account/resend cost an invented address what they cost a real one. Before this the real path ran
 * an UPDATE and awaited a Resend round trip while the ghost path ran neither — 165 ms against 34 ms, a one-request
 * existence oracle inside a route written to be uniform (security review round 3, 2026-09-08). It was two statements
 * until round 4 dropped the counter-clearing DELETE from issueCode; the two move together or the parity is gone.
 */
async function dummyIssue(env, kind) {
  const now = Date.now();
  const hash = await codeHash(env, { id: ABSENT_ID }, kind, newCode());
  await env.DB.prepare('UPDATE accounts SET verify_kind = ?, verify_code_hash = ?, verify_expires_at = ?, verify_sent_at = ? WHERE id = ?')
    .bind(kind, hash, new Date(now + CODE_TTL_MS).toISOString(), new Date(now).toISOString(), ABSENT_ID).run().catch(() => {});
}
/**
 * One body for every wrong-code answer — wrong digits, no live code, and a code whose tries are spent alike. No
 * tries_left, no hint that the address is known, and no 'expired' (security review round 2, 2026-09-08: checkCode
 * returns 'expired' precisely when there is NO live code, so answering it told an unauthenticated caller that the
 * address has an account in one request) and no 'locked' (only an address that HAS an account could ever reach it).
 * The message carries the "ask for a new one" advice that the two distinct answers used to carry.
 */
function badCode() { return { error: 'That code is not right, or it has expired. Request a new one.', code: 'bad_code' }; }
function codeTooSoon(acct) { return !!(acct.verify_sent_at && Date.now() - Date.parse(acct.verify_sent_at) < CODE_RESEND_MS); }
/** The sign-up-attempt notice throttles on its OWN column; touching verify_sent_at here shut the owner's reset. */
function noticeTooSoon(acct) { return !!(acct.signup_notice_sent_at && Date.now() - Date.parse(acct.signup_notice_sent_at) < CODE_RESEND_MS); }
/** The one answer any route gives when the email leg refuses, whichever path asked it to send. */
function emailFailed(cors) { return json({ error: 'We could not send the email. Please try again in a minute.', code: 'email_failed' }, 502, cors); }
async function clearCode(env, acct) {
  await env.DB.prepare('UPDATE accounts SET verify_kind = ?, verify_code_hash = ?, verify_expires_at = ?, verify_attempts = ? WHERE id = ?').bind(null, null, null, 0, acct.id).run();
  Object.assign(acct, { verify_kind: null, verify_code_hash: null, verify_expires_at: null, verify_attempts: 0 });
}
/** 'ok' | 'wrong' | 'expired' | 'locked'. The try is claimed FIRST with one conditional UPDATE (code live, attempts < max), so
 *  concurrent guesses cannot share a count: at most CODE_MAX_TRIES comparisons ever happen per code, however many requests
 *  arrive at once (Codex on PR #11, P1). A wrong try counts; the last allowed try, or any try past the limit, burns the code. */
async function checkCode(env, acct, kind, code) {
  const now = new Date().toISOString();
  const claim = await env.DB.prepare('UPDATE accounts SET verify_attempts = verify_attempts + 1 WHERE id = ? AND verify_kind = ? AND verify_code_hash IS NOT NULL AND verify_expires_at > ? AND verify_attempts < ?')
    .bind(acct.id, kind, now, CODE_MAX_TRIES).run();
  if (!claim || !claim.meta || !claim.meta.changes) {
    // The row is read back rather than trusted from this copy, and it is read WHETHER OR NOT there is anything to find,
    // so the absent-account twin below spends the same two statements as an account with no live code — the ordinary
    // state of every account, and therefore the state a probe lands in (security review round 3, 2026-09-08).
    const row = await env.DB.prepare('SELECT verify_kind, verify_code_hash, verify_expires_at FROM accounts WHERE id = ?').bind(acct.id).first().catch(() => null);
    const live = !!(row && row.verify_code_hash && row.verify_kind === kind && row.verify_expires_at && row.verify_expires_at > now);
    if (live) return (await burnCode(env, acct)) ? 'burned' : 'locked';   // the tries are spent: burn what is left
    return 'expired';
  }
  const want = acct.verify_code_hash, got = await codeHash(env, acct, kind, String(code || '').replace(/\D/g, ''));
  let diff = want.length ^ got.length; for (let i = 0; i < Math.min(want.length, got.length); i++) diff |= want.charCodeAt(i) ^ got.charCodeAt(i);
  if (diff === 0) return 'ok';
  // Wrong: read the count back from the database (this copy may be stale under concurrent guesses) and burn the code once
  // the last allowed try is spent.
  const row = await env.DB.prepare('SELECT verify_attempts, verify_code_hash FROM accounts WHERE id = ?').bind(acct.id).first().catch(() => null);
  const used = row && typeof row.verify_attempts === 'number' ? row.verify_attempts : (acct.verify_attempts || 0) + 1;
  acct.verify_attempts = used;
  if (!row || !row.verify_code_hash) return 'locked';   // a parallel try already burned it
  if (used >= CODE_MAX_TRIES) return (await burnCode(env, acct)) ? 'burned' : 'locked';
  return 'wrong';
}
/**
 * clearCode, conditional on there still being a code — so exactly ONE of however many parallel guesses is told it did
 * the burning, and the owner is emailed once rather than once per racing request.
 */
async function burnCode(env, acct) {
  const res = await env.DB.prepare('UPDATE accounts SET verify_kind = ?, verify_code_hash = ?, verify_expires_at = ?, verify_attempts = ? WHERE id = ? AND verify_code_hash IS NOT NULL')
    .bind(null, null, null, 0, acct.id).run().catch(() => null);
  Object.assign(acct, { verify_kind: null, verify_code_hash: null, verify_expires_at: null, verify_attempts: 0 });
  return !!(res && res.meta && res.meta.changes);
}
/**
 * The absent-account twin of checkCode: the same claim UPDATE and the same read-back, bound to an id no row carries.
 * /account/verify and /account/reset used to answer an invented address after one HMAC and no statement at all, where a
 * real one cost two — the same shape of tell the mail routes carried, on the route that spends guesses.
 */
async function dummyCheckCode(env, kind, code) {
  await codeHash(env, { id: ABSENT_ID }, kind, String(code || '').replace(/\D/g, ''));
  await env.DB.prepare('UPDATE accounts SET verify_attempts = verify_attempts + 1 WHERE id = ? AND verify_kind = ? AND verify_code_hash IS NOT NULL AND verify_expires_at > ? AND verify_attempts < ?')
    .bind(ABSENT_ID, kind, new Date().toISOString(), CODE_MAX_TRIES).run().catch(() => {});
  await env.DB.prepare('SELECT verify_kind, verify_code_hash, verify_expires_at FROM accounts WHERE id = ?').bind(ABSENT_ID).first().catch(() => null);
  return 'expired';
}
/**
 * One wrong-code check, for a real account or for none, with the per-connection guess cap in front of it.
 *
 * Order matters: the cap is read BEFORE the code is touched, so a refused connection can neither spend a try on the
 * global count nor burn anything. What it gets back is the answer every other wrong guess gets — a refused guesser
 * learns that it guessed wrong, which it already knew.
 *
 * The cap for an address with NO account is keyed on that address, never on the shared absent id (security review round
 * 4, 2026-09-08). One shared row meant five wrong guesses at any throwaway address armed a classifier: from the sixth
 * request on, an invented address was refused before the twin statements ran and a real one still spent them — 5
 * statements against 9, two ranges that do not overlap, one request per address tested. Both branches now spend the
 * same statements from the same point in their own five-guess budget, and neither can spend the other's.
 */
async function guardedCheckCode(request, env, ctx, acct, email, kind, code) {
  const id = acct ? acct.id : await absentGuessId(email);
  const ip = clientIp(request);
  if ((await codeGuessesSpent(env, ip, id)) >= CODE_GUESSES_PER_IP) return 'wrong';
  const r = acct ? await checkCode(env, acct, kind, code) : await dummyCheckCode(env, kind, code);
  if (r === 'ok') { await clearCodeGuesses(env, id); return r; }
  await noteCodeGuess(env, ip, id);
  if (r === 'burned' && acct) {
    // The owner is told, and the throttle on their own next request is lifted with it: a burn they did not cause must
    // not also cost them the minute codeTooSoon() would hold the replacement for.
    await env.DB.prepare('UPDATE accounts SET verify_sent_at = ? WHERE id = ?').bind(null, acct.id).run().catch(() => {});
    acct.verify_sent_at = null;
    const send = notifyCodeBurned(env, acct, kind).catch((e) => console.error('[Account] burn notice failed:', e.message));
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(send);
  }
  return r;
}
/** The owner of an address whose live code was invalidated by repeated wrong guesses. Never says who, or from where. */
async function notifyCodeBurned(env, acct, kind) {
  const text = [
    'The code we emailed you has been invalidated: it was entered wrongly too many times.',
    '',
    'Nothing on your account changed and nobody was signed in. If this was not you there is nothing to do — an',
    'invalidated code is useless to whoever was trying it.',
    '',
    kind === 'reset' ? 'Ask for a new password-reset code at mastsolutions.com whenever you are ready.'
                     : 'Ask for a new verification code at mastsolutions.com whenever you are ready.',
    '', 'MAST Solutions · Atlas Glinn, LLC · Houston, Texas',
  ].join('\n');
  await sendEmail(env, { to: [acct.email], subject: 'Your MAST Solutions code was invalidated', text, bcc: false });
}
/**
 * The code leg of /account/forgot, /account/resend and the unverified-sign-in path: ONE issue-shaped statement whether
 * or not the address has an account, and the send itself handed to ctx.waitUntil() so it can neither be awaited before
 * the response nor change it. A refusing mail provider is a log line, never a status code — 502 for a real address and
 * 200 for an invented one was the same oracle the uniform body existed to close.
 *
 * `budget` spends the per-ADDRESS mail allowance first (round 4): the two UNAUTHENTICATED routes carry it, and the
 * sign-in path does not, because the caller there has already proved the password. It is spent on the posted address
 * before the account is looked at, so it costs an invented address exactly what it costs a real one, and being over it
 * changes nothing a caller can see — same 200, same statements, no mail.
 */
async function mailCodeAside(env, ctx, acct, kind, opts = {}) {
  const mayMail = opts.budget ? await noteCodeMail(env, opts.email) : true;
  if (!acct || !mayMail || codeTooSoon(acct)) { await dummyIssue(env, kind); return; }
  const code = await issueCode(env, acct, kind);
  const send = sendCode(env, acct, kind, code).catch((e) => console.error('[Account] code email failed:', e.message));
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(send);
}
async function sendCode(env, acct, kind, code) {
  const verify = kind === 'verify';
  const subject = verify ? 'Your MAST Solutions verification code' : 'Reset your MAST Solutions password';
  const text = [
    verify ? 'Enter this code on mastsolutions.com to finish creating your account:' : 'Enter this code on mastsolutions.com to set a new password:',
    '', '    ' + code, '',
    'It works for 15 minutes. If you did not ask for it, ignore this email; nothing changes without the code.',
    '', 'MAST Solutions · Atlas Glinn, LLC · Houston, Texas',
  ].join('\n');
  await sendEmail(env, { to: [acct.email], subject, text, bcc: false });
}
async function issueAndSend(env, acct, kind, cors) {
  let code; try { code = await issueCode(env, acct, kind); await sendCode(env, acct, kind, code); }
  catch (e) { console.error('[Account] code email failed:', e.message); return emailFailed(cors); }
  return null;
}
async function signedIn(env, acct, cors) {
  const now = new Date().toISOString();
  await env.DB.prepare('UPDATE accounts SET last_login_at = ? WHERE id = ?').bind(now, acct.id).run();
  // Any successful authentication — sign-in, verification or reset — clears the failure counter and the lock. Kept as its
  // own best-effort statement so an unmigrated column can never break a sign-in.
  await clearFailedLogins(env, acct);
  acct.last_login_at = now;
  return json({ token: await signToken(env, acct), account: publicAccount(acct) }, 200, cors);
}
async function accountByEmail(env, email) {
  return isEmail(email) ? await env.DB.prepare('SELECT * FROM accounts WHERE email = ?').bind(email).first() : null;
}

async function handleAccountRegister(request, env, cors) {
  const off = accountsOff(env, cors) || signupOff(env, cors); if (off) return off;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return json({ error: 'Bad request' }, 400, cors);
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!isEmail(email)) return json({ error: 'Enter a valid email address.', field: 'email' }, 400, cors);
  if (password.length < 10) return json({ error: 'Use a password of at least 10 characters.', field: 'password' }, 400, cors);
  if (password.length > 200) return json({ error: 'That password is too long.', field: 'password' }, 400, cors);
  const existing = await accountByEmail(env, email);
  const now = new Date().toISOString();
  const name = str(body.name).trim().slice(0, 120), phone = str(body.phone).replace(/[^\d+()\-.\s]/g, '').trim().slice(0, 40), organization = str(body.organization).trim().slice(0, 120);
  // An address that already has a VERIFIED account answers exactly what a brand-new one answers — same status, same body
  // (security review 2026-09-08: the old 409 'exists' turned this route into an address checker, and the 429 'too_soon'
  // did the same job one step later). Nothing on the account changes; the person who actually owns the address is told
  // that someone tried, and can sign in or reset. The password is hashed here too so the two paths cost the same time.
  if (existing && existing.verified_at) {
    await hashPassword(password);
    if (!noticeTooSoon(existing)) {
      // signup_notice_sent_at, NEVER verify_sent_at (security review round 2, 2026-09-08). Writing the shared column here
      // let a stranger's sign-up attempt against a verified address suppress that address's OWN /account/forgot and
      // /account/resend for the next minute — 200 with no mail — which held the reset shut and closed the documented way
      // out of a sign-in lockout. Stamped before the send, like issueCode, so a refusing mail provider is not a mail storm.
      await env.DB.prepare('UPDATE accounts SET signup_notice_sent_at = ? WHERE id = ?').bind(now, existing.id).run().catch(() => {});
      existing.signup_notice_sent_at = now;
      try { await notifySignupAttempt(env, existing); }
      catch (e) {
        // The same answer the new-address path gives when Resend refuses it. Different answers here were an oracle of
        // their own: 502 meant "no account", 202 meant "there is one".
        console.error('[Account] sign-up notice failed:', e.message);
        return emailFailed(cors);
      }
    }
    return json(signupPending(email), 202, cors);
  }
  let acct;
  if (existing) {
    // NOTHING on an existing row is overwritten, verified or not (security review round 3, 2026-09-08). The unverified
    // slot used to be handed to whoever signed up next, which let a stranger write their own password onto an address
    // whose owner had started but not finished — and then read the result off /account/login, where that password
    // answered 403 'unverified' for an address with a row and 401 for one without. The row keeps its own credentials;
    // the sign-up only re-sends the code, throttled, so the owner can still finish. Whoever holds the mailbox takes the
    // address back through Forgot password, which now serves unverified accounts and marks the address verified: mailbox
    // control, not who typed a password first, is what decides who owns an account.
    await hashPassword(password);   // the same work the two storing branches do, so the answer costs the same time
    acct = { ...existing };
  } else {
    acct = {
      id: 'acct_' + crypto.randomUUID(), email, password_hash: await hashPassword(password), token_version: 1, name, phone, organization,
      address1: '', address2: '', emergency_name: '', emergency_phone: '', emergency_relationship: '', stripe_customer_id: '', standards_passed: '[]', notes: '',
      created_at: now, updated_at: now, last_login_at: null, verified_at: null, verify_kind: null, verify_code_hash: null, verify_expires_at: null, verify_attempts: 0, verify_sent_at: null, signup_notice_sent_at: null,
    };
    await env.DB.prepare('INSERT INTO accounts (id, email, password_hash, token_version, name, phone, organization, address1, address2, emergency_name, emergency_phone, emergency_relationship, stripe_customer_id, standards_passed, notes, created_at, updated_at, last_login_at, verified_at, verify_kind, verify_code_hash, verify_expires_at, verify_attempts, verify_sent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(acct.id, acct.email, acct.password_hash, 1, acct.name, acct.phone, acct.organization, '', '', '', '', '', '', '[]', '', now, now, null, null, null, null, null, 0, null).run();
  }
  // A second sign-up inside a minute sends nothing and still gets the same envelope: the throttle must not be a signal.
  if (!codeTooSoon(acct)) { const fail = await issueAndSend(env, acct, 'verify', cors); if (fail) return fail; }
  return json(signupPending(email), 202, cors);
}

/** The one answer POST /account/register ever gives: new address, unverified address, verified address. */
function signupPending(email) {
  return { pending: true, email, message: 'We emailed a 6-digit code to ' + email + '. Enter it to finish.' };
}

/** The real owner of an address someone else just tried to sign up with. Never says whether a code was sent. */
async function notifySignupAttempt(env, acct) {
  const text = [
    'Someone tried to create a MAST Solutions account with this email address.',
    '',
    'You already have one, so nothing was created and nothing changed. If it was you, sign in at mastsolutions.com',
    'instead — and use "Forgot your password" if you need a new password.',
    '',
    'If it was not you, you do not need to do anything. Nobody can reach your account without your password.',
    '', 'MAST Solutions · Atlas Glinn, LLC · Houston, Texas',
  ].join('\n');
  await sendEmail(env, { to: [acct.email], subject: 'Someone tried to create a MAST Solutions account with your email', text, bcc: false });
}

async function handleAccountVerify(request, env, ctx, cors) {
  const off = accountsOff(env, cors); if (off) return off;
  const body = await request.json().catch(() => null);
  const email = String((body && body.email) || '').trim().toLowerCase();
  const acct = await accountByEmail(env, email);
  // Unknown address, already-verified address and simply the wrong six digits all answer the same 400 bad_code, and the
  // unknown one does the same HMAC work first (security review 2026-09-08: 400-vs-409, and the tries_left field, each
  // told a caller which addresses have accounts).
  //
  // 'expired' and 'locked' now answer it too (security review round 2, 2026-09-08). The comment that used to sit here
  // said "both need a live code to reach", and that was FACTUALLY WRONG for 'expired': checkCode returns 'expired'
  // exactly when there is NO live code, which is the ordinary state of every account, so one request separated a real
  // unverified address ('expired') from an invented one ('bad_code'). 'locked' is only reachable on an address that has
  // an account at all, and no invented address can ever produce it, so it goes the same way. The code is still burned by
  // checkCode either way; only the answer is uniform.
  const r = await guardedCheckCode(request, env, ctx, !acct || acct.verified_at ? null : acct, email, 'verify', body && body.code);
  if (r !== 'ok') return json(badCode(), 400, cors);
  const now = new Date().toISOString();
  await env.DB.prepare('UPDATE accounts SET verified_at = ?, updated_at = ? WHERE id = ?').bind(now, now, acct.id).run();
  acct.verified_at = now;
  await clearCode(env, acct);
  return await signedIn(env, acct, cors);
}

async function handleAccountResend(request, env, ctx, cors) {
  const off = accountsOff(env, cors) || signupOff(env, cors); if (off) return off;
  const body = await request.json().catch(() => null);
  const email = String((body && body.email) || '').trim().toLowerCase();
  const acct = await accountByEmail(env, email);
  // ONE answer, ONE statement count, and the mail leg outside the response entirely (mailCodeAside): unknown address,
  // already-verified address and throttled retry are indistinguishable in body, status AND time. The route used to
  // await Resend only when the account existed, and to answer 502 when Resend refused it — a one-request oracle either
  // way round (security review round 3, 2026-09-08).
  await mailCodeAside(env, ctx, acct && !acct.verified_at ? acct : null, 'verify', { email, budget: true });
  return json({ ok: true }, 200, cors);
}

async function handleAccountLogin(request, env, ctx, cors) {
  const off = accountsOff(env, cors); if (off) return off;
  const body = await request.json().catch(() => null);
  const email = String((body && body.email) || '').trim().toLowerCase();
  const password = String((body && body.password) || '');
  const acct = await accountByEmail(env, email);
  const ip = clientIp(request);
  // A locked account is answered BEFORE any PBKDF2 runs (src/ratelimit.js): five wrong passwords stop both the guessing
  // and its CPU cost.
  //
  // Both counters are read, and an address with NO account locks on the same attempt as one that has an account
  // (security review round 2, 2026-09-08). Before that the sixth wrong password answered 429 'locked' for a real address
  // and 401 for an invented one, so five throwaway guesses bought a definitive yes-or-no on any address — cheaper than
  // the twenty-per-window sign-in limit was ever meant to allow. Both paths return here before any hashing, so the
  // refusal costs the same time as well as saying the same thing.
  const locked = Math.max(lockedFor(acct), await identityLockedFor(env, ip, email));
  if (locked) return tooMany(cors, locked, 'locked', 'Too many sign-in attempts for this account. Try again later, or reset your password.');
  // The same hashing work runs whether or not the account exists, so timing does not reveal which emails have accounts.
  const okPw = acct ? await verifyPassword(password, acct.password_hash) : (await verifyPassword(password, 'pbkdf2-sha256$' + PBKDF2_ITER + '$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='), false);
  if (!acct || !okPw) {
    // The failing attempt itself always answers 401; the lock it may have just set shows on the next one, so the fifth
    // wrong password does not announce that the address exists. The (IP, address) counter is bumped whether or not the
    // address has an account — that is what makes the sixth attempt symmetric.
    //
    // And the per-ACCOUNT counter costs the same on both branches (security review round 4, 2026-09-08). noteFailedLogin
    // ran only `if (acct)`, so a wrong password at a real address spent two statements an invented one did not, and
    // three on the try where the lock is written. The twin runs the same statements against an id no row carries,
    // laddered on the (IP, address) count — the only failure count an address with no account has.
    const failures = await noteFailedIdentity(env, ip, email);
    if (acct) await noteFailedLogin(env, acct);
    else await dummyFailedLogin(env, ABSENT_ID, failures);
    return json({ error: 'That email and password do not match.', code: 'bad_login' }, 401, cors);
  }
  // The right password clears the pair, whether or not the email has been verified yet — and, since round 4, the code
  // guesses spent against this account: a reissue no longer clears them, so the owner proving the password is what
  // un-refuses a connection that typed its way to five wrong codes. A stranger cannot reach this line.
  await clearFailedIdentity(env, ip, email);
  await clearCodeGuesses(env, acct.id);
  if (!acct.verified_at) {
    // Right password, email never confirmed: send a fresh code (at most once a minute) and let the page open the code
    // box. The send is handed to ctx.waitUntil like every other code send, so a refusing mail provider cannot turn a
    // sign-in answer into a 502.
    if (env.RESEND_API_KEY) await mailCodeAside(env, ctx, acct, 'verify', { email });
    return json({ error: 'Verify your email first. Enter the code we sent you.', code: 'unverified', email }, 403, cors);
  }
  return await signedIn(env, acct, cors);
}

async function handleAccountForgot(request, env, ctx, cors) {
  const off = accountsOff(env, cors) || signupOff(env, cors); if (off) return off;
  const body = await request.json().catch(() => null);
  const email = String((body && body.email) || '').trim().toLowerCase();
  const acct = await accountByEmail(env, email);
  // Same 200, same statement count, mail leg in the background — see handleAccountResend.
  //
  // UNVERIFIED accounts are served too (security review round 3, 2026-09-08). /account/register no longer overwrites an
  // existing row's password, so this is the path by which the real owner of an address someone else started a sign-up
  // on takes it back: the code goes to the mailbox, and a successful reset sets the password AND marks the address
  // verified. It also removes a state branch from a route whose whole job is not to have any.
  // The per-address budget (round 4): three unauthenticated code mails an hour at any one mailbox, whoever asks and
  // from wherever. Nothing capped the address before — 60 seconds between mails and 5 per window per IP left ~1,440 a
  // day at any address, out of the firm's own sending domain.
  await mailCodeAside(env, ctx, acct, 'reset', { email, budget: true });
  return json({ ok: true }, 200, cors);
}

async function handleAccountReset(request, env, ctx, cors) {
  const off = accountsOff(env, cors); if (off) return off;
  const body = await request.json().catch(() => null);
  const email = String((body && body.email) || '').trim().toLowerCase();
  const next = String((body && body.password) || '');
  if (next.length < 10 || next.length > 200) return json({ error: 'Use a password of at least 10 characters.', field: 'password' }, 400, cors);
  const acct = await accountByEmail(env, email);
  // The same one answer /account/verify gives. This route was the sharper of the two: a single unauthenticated POST
  // against a VERIFIED address answered 'expired' where an invented address answered 'bad_code', with no code needed
  // and — until round 2 — no rate limit on the route at all. guardedCheckCode carries the absent-account branch now, so
  // an invented address also spends the same statements a real one spends, and five wrong guesses from one connection
  // refuse that connection instead of burning the code in the owner's inbox (round 3, 2026-09-08).
  const r = await guardedCheckCode(request, env, ctx, acct, email, 'reset', body && body.code);
  if (r !== 'ok') return json(badCode(), 400, cors);
  const v = (acct.token_version || 1) + 1, now = new Date().toISOString();
  // The code proved control of the mailbox, so the address is verified by the same act that sets the password. That is
  // what makes Forgot password the way an owner reclaims an address a stranger started a sign-up on.
  await env.DB.prepare('UPDATE accounts SET password_hash = ?, token_version = ?, verified_at = ?, updated_at = ? WHERE id = ?').bind(await hashPassword(next), v, acct.verified_at || now, now, acct.id).run();
  acct.token_version = v; acct.verified_at = acct.verified_at || now;
  await clearCode(env, acct);
  return await signedIn(env, acct, cors);
}

async function handleAccountMe(request, env, cors) {
  const { acct, res } = await requireAccount(request, env, cors); if (res) return res;
  const classes = await env.DB.prepare("SELECT sku, item_name, session_date, session_label, qty, status, created_at FROM registrations WHERE customer_email = ? AND status IN ('paid', 'completed') ORDER BY session_date DESC, created_at DESC LIMIT 200").bind(acct.email).all().catch(() => ({ results: [] }));
  const card = acct.stripe_customer_id ? await stripeDefaultCard(env, acct.stripe_customer_id).catch(() => null) : null;
  return json({ account: publicAccount(acct), classes: (classes && classes.results) || [], payment_method: card }, 200, cors);
}

/**
 * The three credential fields off an /account/update body, or null when the body carries none of them and when nothing
 * actually changed — the page posts the whole panel on every Save, and a re-save of the same credential must not restamp
 * the review or email the office again. Choosing "None" clears the row back to no credential.
 */
function credentialPatch(body, acct) {
  if (!('credential_type' in body) && !('credential_org' in body) && !('credential_id' in body)) return { fields: null };
  const type = 'credential_type' in body ? str(body.credential_type).trim().toLowerCase() : (acct.credential_type || 'none');
  if (!Object.prototype.hasOwnProperty.call(CREDENTIAL_TYPES, type)) return { error: { error: 'Choose a credential type.', field: 'credential_type' } };
  const org = ('credential_org' in body ? str(body.credential_org) : str(acct.credential_org)).trim().slice(0, 120);
  const id = ('credential_id' in body ? str(body.credential_id) : str(acct.credential_id)).trim().slice(0, 64);
  if (id && !/^[A-Za-z0-9-]+$/.test(id)) return { error: { error: 'A credential or badge number can hold letters, digits and dashes only.', field: 'credential_id' } };
  const same = type === (acct.credential_type || 'none') && org === (acct.credential_org || '') && id === (acct.credential_id || '');
  if (same) return { fields: null };
  if (type === 'none') return { fields: { credential_type: 'none', credential_org: '', credential_id: '', credential_status: 'none', credential_submitted_at: null } };
  return { notify: true, fields: { credential_type: type, credential_org: org, credential_id: id, credential_status: 'pending', credential_submitted_at: new Date().toISOString() } };
}

/** Staff notice for a credential a member entered: the office verifies it with the agency or school and marks the row. */
async function notifyCredential(env, acct) {
  const label = CREDENTIAL_TYPES[acct.credential_type] || acct.credential_type;
  const text = [
    'CREDENTIAL REVIEW NEEDED',
    '',
    'Account:  ' + acct.id,
    'Name:     ' + (acct.name || '(not given)'),
    'Email:    ' + acct.email,
    'Phone:    ' + (acct.phone || '(not given)'),
    'Type:     ' + label,
    'Org:      ' + (acct.credential_org || '\u2014'),
    'Number:   ' + (acct.credential_id || '(not given)'),
    'Entered:  ' + acct.credential_submitted_at,
    '',
    'The member typed these; nothing is verified. Check them with the agency or school, then set credential_status on',
    "the accounts row to 'verified' or 'declined' in the D1 console. It reads 'pending review' on their account until then.",
  ].join('\n');
  if (!env.NOTIFY_EMAIL || !env.RESEND_API_KEY) {
    console.error('[Credential] Email not configured (need NOTIFY_EMAIL + RESEND_API_KEY). Account ' + acct.id + ' needs credential review.');
    return;
  }
  await sendEmail(env, { to: list(env.NOTIFY_EMAIL), subject: 'Credential review needed: ' + (acct.name || acct.email) + ' \u00b7 ' + label + ' \u00b7 ' + (acct.credential_org || '\u2014'), text });
}

async function handleAccountUpdate(request, env, cors) {
  const { acct, res } = await requireAccount(request, env, cors); if (res) return res;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return json({ error: 'Bad request' }, 400, cors);
  const sets = [], vals = [];
  for (const f of PROFILE_FIELDS) if (f in body) { sets.push(f + ' = ?'); vals.push(str(body[f]).trim().slice(0, f.endsWith('phone') ? 40 : 160)); acct[f] = vals[vals.length - 1]; }
  const cred = credentialPatch(body, acct);
  if (cred.error) return json(cred.error, 400, cors);
  if (cred.fields) for (const [f, v] of Object.entries(cred.fields)) { sets.push(f + ' = ?'); vals.push(v); acct[f] = v; }
  if (!sets.length) return json({ error: 'Nothing to update.' }, 400, cors);
  const now = new Date().toISOString(); sets.push('updated_at = ?'); vals.push(now, acct.id);
  await env.DB.prepare('UPDATE accounts SET ' + sets.join(', ') + ' WHERE id = ?').bind(...vals).run();
  if (acct.stripe_customer_id && env.STRIPE_SECRET_KEY && ('name' in body || 'phone' in body)) {
    fetch('https://api.stripe.com/v1/customers/' + encodeURIComponent(acct.stripe_customer_id), { method: 'POST', headers: stripeHeaders(env), body: new URLSearchParams({ name: acct.name || '', phone: acct.phone || '' }).toString() }).catch(() => {});
  }
  // The save is already banked; a failed notice must not lose it. The office sees the pending row in the D1 console either way.
  if (cred.notify) await notifyCredential(env, acct).catch((e) => console.error('[Credential] notice failed:', e && e.message));
  return json({ account: publicAccount(acct) }, 200, cors);
}

async function handleAccountPassword(request, env, cors) {
  const { acct, res } = await requireAccount(request, env, cors); if (res) return res;
  const body = await request.json().catch(() => null);
  const current = String((body && body.current) || ''), next = String((body && body.password) || '');
  if (!(await verifyPassword(current, acct.password_hash))) return json({ error: 'Your current password is not right.', field: 'current' }, 401, cors);
  if (next.length < 10 || next.length > 200) return json({ error: 'Use a password of at least 10 characters.', field: 'password' }, 400, cors);
  const v = (acct.token_version || 1) + 1;
  await env.DB.prepare('UPDATE accounts SET password_hash = ?, token_version = ?, updated_at = ? WHERE id = ?').bind(await hashPassword(next), v, new Date().toISOString(), acct.id).run();
  acct.token_version = v;
  return json({ token: await signToken(env, acct), account: publicAccount(acct) }, 200, cors);
}

function stripeHeaders(env) { return { Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY, 'Content-Type': 'application/x-www-form-urlencoded' }; }
async function ensureStripeCustomer(env, acct) {
  if (acct.stripe_customer_id) return acct.stripe_customer_id;
  if (!env.STRIPE_SECRET_KEY) throw new Error('Payments are not configured.');
  const res = await fetch('https://api.stripe.com/v1/customers', { method: 'POST', headers: stripeHeaders(env),
    body: new URLSearchParams({ email: acct.email, name: acct.name || '', phone: acct.phone || '', 'metadata[account_id]': acct.id, 'metadata[source]': 'mastsolutions' }).toString() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id) throw new Error('Stripe customer: ' + ((data.error && data.error.message) || res.status));
  await env.DB.prepare('UPDATE accounts SET stripe_customer_id = ?, updated_at = ? WHERE id = ?').bind(data.id, new Date().toISOString(), acct.id).run();
  acct.stripe_customer_id = data.id;
  return data.id;
}
async function stripeDefaultCard(env, customerId) {
  if (!env.STRIPE_SECRET_KEY) return null;
  const res = await fetch('https://api.stripe.com/v1/customers/' + encodeURIComponent(customerId) + '?expand[]=invoice_settings.default_payment_method', { headers: { Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY } });
  const data = await res.json().catch(() => ({}));
  const pm = data && data.invoice_settings && data.invoice_settings.default_payment_method;
  if (!pm || typeof pm !== 'object') return null;
  const card = pm.card || {};
  return { brand: card.brand || pm.type || 'card', last4: card.last4 || '', exp_month: card.exp_month || null, exp_year: card.exp_year || null };
}
async function handleAccountSetupPayment(request, env, cors) {
  const { acct, res } = await requireAccount(request, env, cors); if (res) return res;
  const body = (await request.json().catch(() => null)) || {};
  let customer;
  try { customer = await ensureStripeCustomer(env, acct); } catch (e) { return json({ error: e.message }, 503, cors); }
  const payload = new URLSearchParams({
    mode: 'setup', customer, 'payment_method_types[0]': 'card',
    success_url: safeUrl(body.successUrl, env) || defaultUrl(env, '?account=card-saved'),
    cancel_url: safeUrl(body.cancelUrl, env) || defaultUrl(env, '?account=card-cancelled'),
    'metadata[kind]': 'account_card', 'metadata[account_id]': acct.id,
  });
  return await createSession(payload, env, cors, 'AccountCard');
}
async function setDefaultCardFromSetup(env, session) {
  if (!env.STRIPE_SECRET_KEY || !session.setup_intent || !session.customer) return;
  const siId = typeof session.setup_intent === 'string' ? session.setup_intent : session.setup_intent.id;
  const cusId = typeof session.customer === 'string' ? session.customer : session.customer.id;
  const si = await (await fetch('https://api.stripe.com/v1/setup_intents/' + encodeURIComponent(siId), { headers: { Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY } })).json().catch(() => ({}));
  const pm = si && (typeof si.payment_method === 'string' ? si.payment_method : si.payment_method && si.payment_method.id);
  if (!pm) return;
  await fetch('https://api.stripe.com/v1/customers/' + encodeURIComponent(cusId), { method: 'POST', headers: stripeHeaders(env), body: new URLSearchParams({ 'invoice_settings[default_payment_method]': pm }).toString() });
}

/* ────────────────────────────── CORS ────────────────────────────── */

function allowedOrigins(env) {
  return (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = allowedOrigins(env);
  // With no allowlist configured, fall back to "*" so a fresh deploy still works,
  // but log it — production should always set ALLOWED_ORIGINS.
  if (allowed.length === 0) {
    console.warn('[CORS] ALLOWED_ORIGINS not set — falling back to "*"');
    return baseCors('*');
  }
  return baseCors(allowed.includes(origin) ? origin : allowed[0]);
}

function baseCors(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

/* ──────────────────────────── Catalog ───────────────────────────── */

/**
 * Server-authoritative catalog. The client never supplies a price.
 *
 * Rows live in D1 (table `offerings`) so they can be edited without a redeploy;
 * if the table is empty or D1 is unbound, these seeds are used.
 *
 * Prices confirmed by the owner 2026-09-01. A price_cents of 0 means "call for
 * pricing" and makes handleBooking() return 409 rather than charging anything.
 *
 * SKUs must match schema.sql, mastsolutions.html, and the WP theme exactly —
 * a mismatch returns 404 on Enroll.
 */
const SEED_CLASSES = [
  { sku: 'MAST-HG-FUND',  name: 'Handgun Fundamentals',                    price_cents: 22500 },
  { sku: 'MAST-HG-LADIES', name: 'Ladies Only Handgun Fundamentals',        price_cents: 22500 },
  { sku: 'MAST-HG-OP',    name: 'Handgun Operator',                        price_cents: 45000 },
  { sku: 'MAST-CAR-FUND', name: 'Carbine Fundamentals',                    price_cents: 22500 },
  { sku: 'MAST-CAR-OP',   name: 'Carbine Operator',                        price_cents: 45000 },
  { sku: 'MAST-SG-FUND',  name: 'Shotgun Fundamentals',                    price_cents: 22500 },
  { sku: 'MAST-SUB-FUND', name: 'Sub-Gun Fundamentals',                    price_cents: 22500 },
  { sku: 'MAST-SUB-P1',   name: 'Sub-Gun P1',                              price_cents: 25000 },
  { sku: 'MAST-SF-P1',    name: 'Select-Fire M4A1 / MK18 Operator P1',     price_cents: 50000 },
  { sku: 'MAST-SF-P2',    name: 'Select-Fire M4A1 / MK18 Operator P2',     price_cents: 95000 },
  { sku: 'MAST-LL-FUND',  name: 'Low-Light Fundamentals',                  price_cents: 22500 },
  { sku: 'MAST-LL-P1',    name: 'Low-Light Operator P1',                   price_cents: 45000 },
  { sku: 'MAST-NVG-P1',   name: 'Low-Light / No-Light NVG Operator P1',    price_cents: 50000 },
  { sku: 'MAST-NVG-P2',   name: 'NVG Operator P2',                         price_cents: 95000 },
  { sku: 'MAST-TEAM-P1',  name: 'Team Tactics P1',                         price_cents: 45000 },
  { sku: 'MAST-TEAM-P2',  name: 'Team Tactics P2',                         price_cents: 47500 },
  { sku: 'MAST-HPP-P1',   name: 'Home & Property Protection P1',           price_cents: 25000 },
  { sku: 'MAST-VEH-P1',   name: 'Vehicular Tactics P1',                    price_cents: 22500 },
  { sku: 'MAST-VEH-P2',   name: 'Vehicular Tactics / Team Tactics P2',     price_cents: 50000 },
  { sku: 'MAST-GEAR',     name: 'Gear & Kit Considerations',               price_cents: 75000 },
  { sku: 'MAST-MOTOR-P1', name: 'Motorcade P1',                            price_cents: 0 },
  { sku: 'MAST-MOTOR-P2', name: 'Motorcade P2',                            price_cents: 0 },
];

async function lookupClass(env, sku) {
  if (env.DB) {
    try {
      const row = await env.DB.prepare(
        'SELECT sku, name, price_cents, capacity FROM offerings WHERE sku = ? AND active = 1 LIMIT 1'
      )
        .bind(sku)
        .first();
      if (row) return row;
    } catch (e) {
      console.error('[Catalog] D1 lookup failed, falling back to seeds:', e.message);
    }
  }
  return SEED_CLASSES.find((c) => c.sku === sku) || null;
}

async function handleCatalog(env, cors) {
  if (env.DB) {
    try {
      const { results } = await env.DB.prepare(
        'SELECT sku, name, price_cents FROM offerings WHERE active = 1 ORDER BY sort_order, name'
      ).all();
      if (results && results.length) return json({ classes: results, source: 'd1' }, 200, cors);
    } catch (e) {
      console.error('[Catalog] D1 list failed:', e.message);
    }
  }
  return json({ classes: SEED_CLASSES, source: 'seed' }, 200, cors);
}

/* ─────────────────────── Training weekends (calendar) ─────────────────────── */

/**
 * Owner's schedule (2026-09-01): Sep last · Oct 2nd+4th · Nov 2nd · Dec 2nd ·
 * Jan–Apr 2nd+4th, plus any 5th weekend. Oct 31 blocked by owner.
 *
 * Mirrors schema.sql `training_weekends`. D1 wins when bound so the owner can
 * block or open a weekend without a redeploy; these seeds are the fallback.
 */
const SEED_WEEKENDS = [
  { saturday: '2026-09-26', sunday: '2026-09-27', label: 'September — last weekend', status: 'available' },
  { saturday: '2026-10-10', sunday: '2026-10-11', label: 'October — 2nd weekend',    status: 'available' },
  { saturday: '2026-10-24', sunday: '2026-10-25', label: 'October — 4th weekend',    status: 'available' },
  { saturday: '2026-10-31', sunday: '2026-11-01', label: 'October — 5th weekend',    status: 'blocked' },
  { saturday: '2026-11-14', sunday: '2026-11-15', label: 'November — 2nd weekend',   status: 'available' },
  { saturday: '2026-12-12', sunday: '2026-12-13', label: 'December — 2nd weekend',   status: 'available' },
  { saturday: '2027-01-09', sunday: '2027-01-10', label: 'January — 2nd weekend',    status: 'available' },
  { saturday: '2027-01-23', sunday: '2027-01-24', label: 'January — 4th weekend',    status: 'available' },
  { saturday: '2027-01-30', sunday: '2027-01-31', label: 'January — 5th weekend',    status: 'available' },
  { saturday: '2027-02-13', sunday: '2027-02-14', label: 'February — 2nd weekend',   status: 'available' },
  { saturday: '2027-02-27', sunday: '2027-02-28', label: 'February — 4th weekend',   status: 'available' },
  { saturday: '2027-03-13', sunday: '2027-03-14', label: 'March — 2nd weekend',      status: 'available' },
  { saturday: '2027-03-27', sunday: '2027-03-28', label: 'March — 4th weekend',      status: 'available' },
  { saturday: '2027-04-10', sunday: '2027-04-11', label: 'April — 2nd weekend',      status: 'available' },
  { saturday: '2027-04-24', sunday: '2027-04-25', label: 'April — 4th weekend',      status: 'available' },
];

async function listWeekends(env) {
  if (env.DB) {
    try {
      const { results } = await env.DB.prepare(
        'SELECT saturday, sunday, label, status FROM training_weekends ORDER BY saturday'
      ).all();
      if (results && results.length) return { weekends: results, source: 'd1' };
    } catch (e) {
      console.error('[Weekends] D1 list failed, falling back to seeds:', e.message);
    }
  }
  return { weekends: SEED_WEEKENDS, source: 'seed' };
}

async function handleWeekends(env, cors) {
  const { weekends, source } = await listWeekends(env);
  return json({ weekends, source }, 200, cors);
}

/* ──────────────────────── Class booking (one-time) ──────────────────────── */

async function handleBooking(request, env, cors) {
  const body = await request.json().catch(() => null);
  if (!body || !body.sku || !body.customer_email) {
    return json({ error: 'Missing required fields: sku, customer_email' }, 400, cors);
  }
  if (!isEmail(body.customer_email)) {
    return json({ error: 'Invalid email address' }, 400, cors);
  }

  const qty = clampInt(body.qty, 1, 10);
  const offering = await lookupClass(env, String(body.sku));
  if (!offering) {
    return json({ error: 'Unknown class: ' + body.sku }, 404, cors);
  }
  if (!offering.price_cents || offering.price_cents < 100) {
    return json({ error: 'This class is not available for online booking. Please call to enroll.' }, 409, cors);
  }

  // Training weekend. The page always sends one; validate it server-side so a
  // crafted request cannot book a blocked or invented date.
  let weekend = null;
  if (body.session_date !== undefined && body.session_date !== null && body.session_date !== '') {
    const wanted = String(body.session_date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(wanted)) {
      return json({ error: 'session_date must be YYYY-MM-DD' }, 400, cors);
    }
    const { weekends } = await listWeekends(env);
    weekend = weekends.find((w) => w.saturday === wanted) || null;
    if (!weekend) {
      return json({ error: 'That date is not a MAST training weekend.' }, 404, cors);
    }
    if (weekend.status !== 'available' && weekend.status !== 'scheduled') {
      return json({ error: 'That weekend is not available for booking.' }, 409, cors);
    }
  }
  const sessionLabel = str(body.session_label) || (weekend ? weekend.label : '');

  const payload = new URLSearchParams({
    mode: 'payment',
    customer_email: body.customer_email,
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][product_data][name]': 'MAST Solutions — ' + offering.name,
    'line_items[0][price_data][product_data][description]':
      'SKU: ' + offering.sku + (weekend ? ' · ' + (sessionLabel || weekend.saturday) : ''),
    'line_items[0][price_data][unit_amount]': String(offering.price_cents),
    'line_items[0][quantity]': String(qty),
    success_url: safeUrl(body.success_url, env) || defaultUrl(env, '?checkout=success'),
    cancel_url: safeUrl(body.cancel_url, env) || defaultUrl(env, '?checkout=cancelled'),
    'payment_method_types[0]': 'card',
    billing_address_collection: 'required',
    'phone_number_collection[enabled]': 'true',
    'metadata[kind]': 'class_booking',
    'metadata[sku]': offering.sku,
    'metadata[class_name]': offering.name,
    'metadata[qty]': String(qty),
    'metadata[session_date]': weekend ? weekend.saturday : '',
    'metadata[session_label]': sessionLabel,
    'metadata[customer_name]': str(body.customer_name),
    'metadata[organization]': str(body.organization),
    'metadata[notes]': str(body.notes),
    'metadata[source]': 'mastsolutions',
    'metadata[utm_source]': attributionFrom(body, request).utm_source || '', 'metadata[utm_medium]': attributionFrom(body, request).utm_medium || '',
    'metadata[utm_campaign]': attributionFrom(body, request).utm_campaign || '', 'metadata[first_touch_at]': attributionFrom(body, request).first_touch_at || '',
  });

  await applyAccountCustomer(env, payload, body.account_token, 'Booking');
  return await createSession(payload, env, cors, 'Booking');
}

/** A signed-in student checks out against their Stripe Customer: Checkout offers the saved card, a new card can be saved, and
 *  the order joins the account (owner, 2026-09-05: "account info to include payment method + save + classes taken").
 *  A bad or expired token, or a Stripe hiccup, falls back to the guest path: the booking never fails because of the account. */
async function applyAccountCustomer(env, payload, token, label) {
  if (!token) return null;
  const acct = await accountFromToken(env, String(token)).catch(() => null);
  if (!acct) return null;
  try {
    const cus = await ensureStripeCustomer(env, acct);
    payload.delete('customer_email'); payload.set('customer', cus); payload.set('customer_update[address]', 'auto'); payload.set('customer_update[name]', 'auto');
    payload.set('saved_payment_method_options[payment_method_save]', 'enabled'); payload.set('metadata[account_id]', acct.id);
    return acct;
  } catch (e) { console.error('[' + label + '] account customer failed:', e.message); return null; }
}

/* ─────────── Registration: screening → agreement → refund consent → Stripe ─────────── */

/**
 * POST /register — the full flow behind one seat (ARCHITECTURE.md §1, privacy.html §3–5).
 *
 * Order of truth: who and what → version stamps → eligibility → agreement → refund
 * consent → persist → (review stop) → Stripe. A disqualifying answer is stored as a
 * flagged outcome and stops BEFORE Stripe: nothing is charged, staff get a notice that
 * names the registration and never the answers.
 */
/** Fundamentals is a gate (owner, 2026-09-04: "They MUST take Fundamentals first UNLESS they have taken it prior").
 *  Mirrors levelOf() on the page: Fundamentals courses have no prerequisite, P2 needs P1, Operator/P1 need Fundamentals. */
// Progression (owner, 2026-09-04: "first-time students HAVE to take Fundamentals in all courses that have fundamentals first"):
// a course requires its discipline's Fundamentals (Handgun — or its ladies-only class —, Carbine, Sub-Gun, Low-Light / NVG;
// Shotgun has only the Fundamentals); of the disciplines without their own, only Team Tactics requires one, Handgun
// Fundamentals (owner, 2026-09-05); a P2 course also needs the P1. The page shows and asks the
// same rule (levelOf / selectCourse in mastsolutions-tesla.html). The discipline is read from the course name so D1 rows
// and the seeds behave the same.
function prerequisiteFor(offering) {
  const n = String((offering && offering.name) || '');
  if (!n || /Fundamentals/i.test(n)) return null;
  const disc = /Carbine/i.test(n) ? 'Carbine' : /Sub-Gun/i.test(n) ? 'Sub-Gun' : /Low-Light|NVG/i.test(n) ? 'Low-Light' : /Shotgun/i.test(n) ? 'Shotgun'
    : /Handgun|^Team Tactics/i.test(n) ? 'Handgun' : null;
  // Select-Fire, Protective (Home, Vehicular, Motorcade — including "Vehicular Tactics / Team Tactics P2") and Gear carry no prerequisite
  // (owner, 2026-09-05: "Only Team Tactics = Handgun Fun 1st"). The page's levelOf applies the same rule by category.
  if (!disc) return null;
  const fund = 'MAST ' + disc + ' Fundamentals';
  return /\bP2\b/.test(n) ? fund + ' and a MAST P1 course' : fund;
}

/* Seat holds (security review 2026-09-08, revised round 2). A pending registration holds its seats for one of two
   windows, and NOTHING outside them:

     with a Stripe session id     SEAT_HOLD_MS       15 minutes — a Checkout Session exists and the buyer may be paying
     without one                  SEAT_PENDING_HOLD_MS  2 minutes — the row is written, Stripe has not answered yet

   Round 1 made the session id the whole condition, which closed a free denial of service (a POST that never reached
   Stripe used to hold seats for 30 minutes) but opened an oversell race the width of a full Stripe round trip: between
   claimSeats and the updateRegistration that stamps the session id, the row held nothing, so honest concurrent
   buyers could all pass the capacity check and all reach Checkout. The short window is that gap plus room for a slow
   API call; a row that has not been stamped in two minutes is a request that failed, and it goes back to holding
   nothing. The same predicate is used for capacity AND for the hold caps, so a stale session-less row neither holds a
   seat nor counts against anybody. */
const SEAT_HOLD_MS = 15 * 60 * 1000;
const SEAT_PENDING_HOLD_MS = 2 * 60 * 1000;
const MAX_HOLDS_PER_IP = 2, MAX_HOLDS_PER_EMAIL = 2;

/** The one definition of "this pending row is holding a seat right now". Binds two cutoffs, in holdCutoffs() order. */
const HOLDING_SEATS = "(status = 'pending' AND ((stripe_session_id IS NOT NULL AND created_at > ?) OR (stripe_session_id IS NULL AND created_at > ?)))";
const holdCutoffs = (now = Date.now()) => [new Date(now - SEAT_HOLD_MS).toISOString(), new Date(now - SEAT_PENDING_HOLD_MS).toISOString()];

/** Live holds from this connection, and from this connection under this address. A D1 failure counts as none — capacity
 *  itself is claimed atomically below and is the control that must not fail open.
 *
 *  The connection is clientIp(), which is the literal 'unknown' when Cloudflare passed no address (security review round
 *  3, 2026-09-08). It used to be an empty string, and an empty string made the count below return 0 without asking the
 *  database — so a request arriving without CF-Connecting-IP sat OUTSIDE both hold caps instead of inside a shared one.
 *
 *  The address count is bound to the PAIR, not to the address alone (security review round 2, 2026-09-08).
 *  customer_email is typed by whoever posts the form, so a per-address cap let a stranger take two holds under a known
 *  customer's address and answer that customer's own booking with 429. Bound to the pair, a stranger's holds sit on the
 *  stranger's connection. Because the pair is a subset of the connection, the two caps being equal means the connection
 *  cap is what actually refuses today; the pair is counted separately so that raising the connection cap later cannot
 *  silently uncap one address. */
async function concurrentHolds(env, ip, email, cutoffs) {
  if (!env.DB) return { byIp: 0, byPair: 0 };
  const count = async (where, vals) => {
    if (vals.some((v) => !v)) return 0;
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM registrations WHERE ${HOLDING_SEATS} ${where}`
    ).bind(...cutoffs, ...vals).first().catch(() => null);
    return Number((row && row.n) || 0);
  };
  return {
    byIp: await count('AND agreement_ip = ?', [ip]),
    byPair: await count('AND agreement_ip = ? AND customer_email = ?', [ip, email]),
  };
}

async function handleRegister(request, env, ctx, cors) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return json({ error: 'Bad request' }, 400, cors);
  const cust = body.customer || {};
  const elig = body.eligibility || {};
  const agr = body.agreement || {};
  const ref = body.refund || {};

  // 1. Who and what.
  const name = str(cust.name).trim();
  const email = String(cust.email || '').trim().toLowerCase();
  const phone = str(cust.phone).replace(/[^\d+()\-.\s]/g, '').trim();
  if (name.length < 2) return json({ error: 'Enter your full name.', field: 'name' }, 400, cors);
  if (!isEmail(email)) return json({ error: 'Enter a valid email address.', field: 'email' }, 400, cors);
  if (phone.replace(/\D/g, '').length < 7) return json({ error: 'Enter a phone number we can reach you on.', field: 'phone' }, 400, cors);
  const qty = clampInt(body.qty, 1, 10);
  const offering = await lookupClass(env, String(body.sku || ''));
  if (!offering) return json({ error: 'Unknown class: ' + str(body.sku) }, 404, cors);
  if (!offering.price_cents || offering.price_cents < 100) {
    return json({ error: 'This class is not available for online booking. Please call to enroll.' }, 409, cors);
  }
  const wanted = String(body.session_date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(wanted)) return json({ error: 'Choose a training weekend.', field: 'date' }, 400, cors);
  const { weekends } = await listWeekends(env);
  const weekend = weekends.find((w) => w.saturday === wanted) || null;
  if (!weekend) return json({ error: 'That date is not a MAST training weekend.', field: 'date' }, 404, cors);
  if (weekend.status !== 'available' && weekend.status !== 'scheduled') {
    return json({ error: 'That weekend is not available for booking.', field: 'date' }, 409, cors);
  }
  // 1b. Capacity (owner: 16 on one-day fundamentals, 10 on two-day operator courses). A course stops selling on a
  // weekend at offerings.capacity: paid seats count, and a pending registration holds its seats while its Stripe
  // Checkout is open. A live-fire class oversold is a safety problem, so this is checked before Stripe.
  //
  // A pending row holds a seat for 15 minutes once it carries a Stripe session id, and for 2 minutes before that
  // (HOLDING_SEATS above): long enough that honest simultaneous buyers cannot oversell across the Stripe round trip,
  // short enough that a request which never reached Stripe costs the class nothing.
  //
  // This read is a FAST PATH, not the control (security review round 3, 2026-09-08). It is separated from the INSERT by
  // half a dozen awaited statements with no transaction around them, so four requests arriving on the same tick all read
  // the same count and all passed it: four at qty 10 against a 16-seat class each got a 200 and a Stripe URL, 40 seats
  // held on 16. claimSeats() below does the real work in ONE env.DB.batch(), and it is the authority. This check stays
  // because refusing an obviously-full class before the eligibility write, the agreement write and a Stripe round trip
  // is worth one SELECT.
  const cutoffs = holdCutoffs();
  const capacity = Number(offering.capacity || 0);
  if (capacity > 0) {
    const takenRow = await env.DB.prepare(
      `SELECT COALESCE(SUM(qty), 0) AS n FROM registrations WHERE sku = ? AND session_date = ? AND (status = 'paid' OR ${HOLDING_SEATS})`
    ).bind(offering.sku, wanted, ...cutoffs).first();
    const taken = Number((takenRow && takenRow.n) || 0);
    if (taken + qty > capacity) return json(soldOut(capacity, taken), 409, cors);
  }
  // 1b-ii. Two live holds at a time per connection, and two under one address from that connection. The per-IP rate
  // limit caps how fast holds can be made; this caps how many can be open at once, so one caller cannot sit on a class.
  const ip = clientIp(request);
  const holds = await concurrentHolds(env, ip, email, cutoffs);
  if (holds.byIp >= MAX_HOLDS_PER_IP || holds.byPair >= MAX_HOLDS_PER_EMAIL) {
    return tooMany(cors, Math.ceil(SEAT_HOLD_MS / 1000), 'too_many_holds',
      'You already have ' + MAX_HOLDS_PER_EMAIL + ' bookings waiting to be paid. Finish or cancel one of those checkouts, or try again in 15 minutes.');
  }
  // 1c. Prerequisite attestation for level 2 and 3 courses.
  const prereq = prerequisiteFor(offering);
  const prereqAttested = !!(body.prerequisite && body.prerequisite.attested === true);
  if (prereq && !prereqAttested) {
    return json({ error: 'This course requires ' + prereq + ' first. Confirm you have completed it, or book that Fundamentals course instead.', field: 'prerequisite', code: 'prerequisite' }, 400, cors);
  }
  const sessionLabel = str(body.session_label) || weekend.label || '';

  // 2. Version stamps: the participant must have seen the current questions, agreement and policy.
  if (str(elig.questions_version) !== QUESTIONS_VERSION) {
    return json({ error: 'The eligibility questions have been updated. Reload the page and try again.', code: 'stale_questions' }, 409, cors);
  }
  if (str(agr.version) !== AGREEMENT_VERSION) {
    return json({ error: 'The participation agreement has been updated. Reload the page and try again.', code: 'stale_agreement' }, 409, cors);
  }
  if (str(ref.version) !== REFUND_POLICY_VERSION) {
    return json({ error: 'The cancellation and refund policy has been updated. Reload the page and try again.', code: 'stale_policy' }, 409, cors);
  }

  // 3. Eligibility: two booleans and the attestation. Sensitive data; it is stored apart and never emailed.
  if (typeof elig.us_citizen !== 'boolean' || typeof elig.felony_prohibited !== 'boolean') {
    return json({ error: 'Answer both eligibility questions.', field: 'eligibility' }, 400, cors);
  }
  if (elig.attested !== true) return json({ error: 'Confirm that your eligibility answers are true.', field: 'eligibility' }, 400, cors);
  const cleared = elig.us_citizen === true && elig.felony_prohibited === false;

  // 4. Agreement: typed attestation with its evidence record (ARCHITECTURE.md §4).
  const signedName = str(agr.signed_name).trim();
  const initials = str(agr.initials).replace(/[^A-Za-z]/g, '').toUpperCase();
  const address1 = str(agr.address1).trim();
  const address2 = str(agr.address2).trim();
  const emName = str(agr.emergency_name).trim();
  const emPhone = str(agr.emergency_phone).trim();
  const emRel = str(agr.emergency_relationship).trim();
  if (agr.scrolled !== true) return json({ error: 'Read the participation agreement to the end before signing.', field: 'agreement' }, 400, cors);
  if (agr.agreed !== true) return json({ error: 'Tick the box to accept the participation agreement.', field: 'agreement' }, 400, cors);
  if (signedName.length < 2) return json({ error: 'Type your full name to sign the agreement.', field: 'signed_name' }, 400, cors);
  if (initials.length < 2 || initials.length > 4) return json({ error: 'Enter your initials (2 to 4 letters).', field: 'initials' }, 400, cors);
  if (!address1) return json({ error: 'Enter your address.', field: 'address1' }, 400, cors);
  if (!emName || !emPhone || !emRel) {
    return json({ error: 'Enter an emergency contact: name, number and relationship.', field: 'emergency' }, 400, cors);
  }

  // 5. Refund policy: unticked by default on the page, recorded here with version, time and IP.
  if (ref.accepted !== true) return json({ error: 'Tick the box to accept the cancellation and refund policy.', field: 'refund' }, 400, cors);

  const now = new Date().toISOString();
  const ua = (request.headers.get('User-Agent') || '').slice(0, 300);
  const id = 'reg_' + crypto.randomUUID();
  const optIn = body.newsletter_opt_in === true;
  const reg = {
    id, created_at: now, status: cleared ? 'pending' : 'review',
    sku: offering.sku, item_name: offering.name, qty, session_date: weekend.saturday, session_label: sessionLabel,
    customer_name: name, customer_email: email, customer_phone: phone, organization: str(cust.organization).trim(),
    address1, address2, emergency_name: emName, emergency_phone: emPhone, emergency_relationship: emRel,
    eligibility_outcome_id: null, eligibility_status: cleared ? 'cleared' : 'flagged', questions_version: QUESTIONS_VERSION,
    agreement_version: AGREEMENT_VERSION, agreement_signed_name: signedName, agreement_initials: initials,
    agreement_signed_at: now, agreement_ip: ip, agreement_user_agent: ua,
    refund_policy_version: REFUND_POLICY_VERSION, refund_policy_accepted_at: now, refund_policy_ip: ip,
    newsletter_opt_in: optIn ? 1 : 0, newsletter_opted_in_at: optIn ? now : null,
    prereq_attested: prereq && prereqAttested ? 1 : 0,
  };
  // Attribution (CRM, 2026-09-06): first touch, UTM, referrer, landing page and the visitor id travel with the registration
  // and, through Stripe's metadata, onto the order the webhook stores — revenue per channel in SQL, not in a dashboard.
  const attribution = attributionFrom(body, request);
  Object.assign(reg, { utm_source: attribution.utm_source || null, utm_medium: attribution.utm_medium || null, utm_campaign: attribution.utm_campaign || null,
    referrer: attribution.referrer || null, landing_page: attribution.landing_page || null, first_touch_at: attribution.first_touch_at || null, visitor: attribution.visitor || null });
  recordEvent(env, { visitor: attribution.visitor, email, page: attribution.page, action: 'start_registration', label: offering.name, sku: offering.sku, attribution }).catch(() => {});

  // 6. Persist: the outcome (kept), the answers (purged on schedule), the registration — and with it the seat claim.
  let claimed;
  try {
    reg.eligibility_outcome_id = await storeEligibility(
      env, reg, { us_citizen: elig.us_citizen, felony_prohibited: elig.felony_prohibited, attested: true }, ip, now
    );
    claimed = await claimSeats(env, reg, capacity);
  } catch (e) {
    console.error('[Register] persist failed:', e.message);
    return json({ error: 'We could not save your registration. Please try again or call (281) 654-8100.' }, 503, cors);
  }
  if (claimed === 'abandoned') {
    // The row exists and is marked abandoned/capacity; it holds nothing and never reaches Stripe. Reading the count back
    // is what puts a number in the message, and it is only paid for on the request that lost.
    const takenRow = await env.DB.prepare(
      `SELECT COALESCE(SUM(qty), 0) AS n FROM registrations WHERE sku = ? AND session_date = ? AND (status = 'paid' OR ${HOLDING_SEATS})`
    ).bind(offering.sku, wanted, ...holdCutoffs()).first().catch(() => null);
    return json(soldOut(capacity, Number((takenRow && takenRow.n) || capacity)), 409, cors);
  }

  if (!cleared) {
    await notifyReview(env, reg).catch((e) => console.error('[Review] notice failed:', e.message));
    return json({
      review: true, registration_id: id,
      message: 'Thank you. A member of our staff will contact you before your booking continues. Nothing has been charged.',
    }, 202, cors);
  }

  // 7. Stripe. The price is the server's; the registration id rides in metadata for the webhook.
  const payload = new URLSearchParams({
    mode: 'payment',
    customer_email: email,
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][product_data][name]': 'MAST Solutions — ' + offering.name,
    'line_items[0][price_data][product_data][description]': 'SKU: ' + offering.sku + ' · ' + (sessionLabel || weekend.saturday),
    'line_items[0][price_data][unit_amount]': String(offering.price_cents),
    'line_items[0][quantity]': String(qty),
    success_url: safeUrl(body.success_url, env) || defaultUrl(env, '?checkout=success'),
    cancel_url: safeUrl(body.cancel_url, env) || defaultUrl(env, '?checkout=cancelled'),
    'payment_method_types[0]': 'card',
    billing_address_collection: 'required',
    'metadata[kind]': 'class_booking',
    'metadata[registration_id]': id,
    'metadata[sku]': offering.sku,
    'metadata[class_name]': offering.name,
    'metadata[qty]': String(qty),
    'metadata[session_date]': weekend.saturday,
    'metadata[session_label]': sessionLabel,
    'metadata[customer_name]': name,
    'metadata[organization]': reg.organization,
    'metadata[notes]': '',
    'metadata[source]': 'mastsolutions',
    'metadata[utm_source]': reg.utm_source || '', 'metadata[utm_medium]': reg.utm_medium || '', 'metadata[utm_campaign]': reg.utm_campaign || '',
    'metadata[first_touch_at]': reg.first_touch_at || '',
  });
  await applyAccountCustomer(env, payload, body.account_token, 'Register');
  const result = await createStripeSession(payload, env, 'Register');
  if (!result.ok) return json({ error: result.error }, result.status, cors);
  await updateRegistration(env, id, { stripe_session_id: result.session.id }).catch((e) =>
    console.error('[Register] session id write failed:', e.message)
  );
  return json({ checkoutUrl: result.session.url, sessionId: result.session.id, registration_id: id }, 200, cors);
}

/** Outcome row (kept) + answers row (purged). Returns the outcome id. Throws on a D1 failure. */
async function storeEligibility(env, reg, answers, ip, now) {
  if (!env.DB) throw new Error('D1 not bound');
  const cleared = reg.eligibility_status === 'cleared';
  const decided = new Date(now).getTime();
  const expires = cleared ? new Date(decided + 365 * 86400000).toISOString() : null;
  const purgeAfter = cleared
    ? new Date(new Date(reg.session_date + 'T12:00:00Z').getTime() + 7 * 86400000).toISOString() // cleared guest: class date + 7 days
    : new Date(decided + 30 * 86400000).toISOString();                                          // flagged: 30 days for the follow-up
  const res = await env.DB.prepare(
    `INSERT INTO eligibility_outcomes (email, full_name, registration_id, outcome, questions_version, decided_at, expires_at)
     VALUES (?,?,?,?,?,?,?)`
  ).bind(reg.customer_email, reg.customer_name, reg.id, reg.eligibility_status, reg.questions_version, now, expires).run();
  const outcomeId = res && res.meta && res.meta.last_row_id !== undefined ? res.meta.last_row_id : null;
  await env.DB.prepare(
    `INSERT INTO eligibility_answers (outcome_id, answers_json, answered_ip, created_at, purge_after) VALUES (?,?,?,?,?)`
  ).bind(outcomeId, JSON.stringify(answers), ip, now, purgeAfter).run();
  return outcomeId;
}

const REG_COLUMNS = [
  'id', 'created_at', 'status', 'sku', 'item_name', 'qty', 'session_date', 'session_label',
  'customer_name', 'customer_email', 'customer_phone', 'organization',
  'address1', 'address2', 'emergency_name', 'emergency_phone', 'emergency_relationship',
  'eligibility_outcome_id', 'eligibility_status', 'questions_version',
  'agreement_version', 'agreement_signed_name', 'agreement_initials', 'agreement_signed_at', 'agreement_ip', 'agreement_user_agent',
  'refund_policy_version', 'refund_policy_accepted_at', 'refund_policy_ip',
  'newsletter_opt_in', 'newsletter_opted_in_at',
  'prereq_attested',
  'utm_source', 'utm_medium', 'utm_campaign', 'referrer', 'landing_page', 'first_touch_at', 'visitor',
];

/** The one sold-out body, so the pre-check and the atomic claim answer a full class identically. */
function soldOut(capacity, taken) {
  const left = Math.max(0, Number(capacity) - Number(taken));
  return {
    error: left === 0 ? 'This weekend is sold out for this course. Choose another weekend.' : `Only ${left} seat${left === 1 ? '' : 's'} left on this weekend for this course.`,
    code: 'sold_out', seats_left: left, field: 'date',
  };
}

/* The column sets THIS database actually has, narrowed the first time D1 says one is missing rather than re-discovered
   on every request. A table that predates the attribution columns (crm.js adds them on first use) or migrations/009
   answers the same way every time, so one failed attempt per isolate is the whole cost. */
let REG_INSERT_COLS = null;          // null = the full REG_COLUMNS
let REG_HAS_ABANDON_REASON = true;   // migrations/009

/**
 * THE SEAT CLAIM. Insert the pending row and, in the SAME env.DB.batch(), roll it back to 'abandoned' when the class —
 * counting this row — is over capacity, then read the row's status back. D1 runs the statements of one batch in order
 * inside a single implicit transaction, so nothing can land between the count and the row that made the count wrong.
 *
 * Why it had to move here (security review round 3, 2026-09-08): the capacity SELECT above and this INSERT were
 * separated by roughly six awaited statements with no transaction, and four POSTs on the same tick at qty 10 against a
 * 16-seat class all passed the check and all reached Stripe — 40 seats held on 16. On a live-fire range an oversell is a
 * safety problem before it is a refund problem, which is why the authority is here and not in a read.
 *
 * Returns 'held' or 'abandoned'. Throws on a D1 failure, which the caller answers 503.
 */
async function claimSeats(env, reg, capacity) {
  if (!env.DB) throw new Error('D1 not bound');
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await runSeatClaim(env, reg, capacity); }
    catch (e) {
      const msg = String((e && e.message) || '');
      if (!/no column|no such column|has no column/i.test(msg)) throw e;
      if (REG_HAS_ABANDON_REASON && /abandoned_reason/i.test(msg)) { REG_HAS_ABANDON_REASON = false; continue; }
      if (!REG_INSERT_COLS) { REG_INSERT_COLS = REG_COLUMNS.filter((c) => !REG_ATTRIBUTION.has(c)); continue; }
      throw e;
    }
  }
  throw new Error('registrations: no column set this database accepts');
}

async function runSeatClaim(env, reg, capacity) {
  const cols = REG_INSERT_COLS || REG_COLUMNS;
  const batch = [
    env.DB.prepare(`INSERT INTO registrations (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(',')})`)
      .bind(...cols.map((c) => (reg[c] === undefined ? null : reg[c]))),
  ];
  // capacity 0 = the course carries no seat limit; there is nothing to roll back to.
  if (capacity > 0) {
    const reason = REG_HAS_ABANDON_REASON ? ", abandoned_reason = 'capacity'" : '';
    batch.push(env.DB.prepare(
      `UPDATE registrations SET status = 'abandoned'${reason} WHERE id = ? AND status = 'pending' AND ` +
      `(SELECT COALESCE(SUM(qty), 0) FROM registrations WHERE sku = ? AND session_date = ? AND (status = 'paid' OR ${HOLDING_SEATS})) > ?`
    ).bind(reg.id, reg.sku, reg.session_date, ...holdCutoffs(), capacity));
  }
  batch.push(env.DB.prepare('SELECT status FROM registrations WHERE id = ?').bind(reg.id));
  const res = await env.DB.batch(batch);
  const last = res && res[res.length - 1];
  const rows = (last && (last.results || last)) || [];
  const status = (rows[0] && rows[0].status) || reg.status;
  console.log('[Register] Stored:', reg.id, status, reg.item_name, reg.customer_email);
  return status === 'abandoned' ? 'abandoned' : 'held';
}

const REG_UPDATABLE = new Set(['status', 'stripe_session_id', 'paid_at', 'documents_sent_at', 'customer_phone']);
const REG_ATTRIBUTION = new Set(['utm_source', 'utm_medium', 'utm_campaign', 'referrer', 'landing_page', 'first_touch_at', 'visitor']);

async function updateRegistration(env, id, fields) {
  if (!env.DB) return;
  const keys = Object.keys(fields).filter((k) => REG_UPDATABLE.has(k));
  if (!keys.length) return;
  await env.DB.prepare(`UPDATE registrations SET ${keys.map((k) => k + ' = ?').join(', ')} WHERE id = ?`)
    .bind(...keys.map((k) => fields[k]), id)
    .run();
}

/** Staff notice for a flagged registration: who and what, never the answers or the question. */
async function notifyReview(env, reg) {
  const text = [
    'ELIGIBILITY REVIEW NEEDED',
    '',
    'Registration: ' + reg.id,
    'Name:         ' + reg.customer_name,
    'Email:        ' + reg.customer_email,
    'Phone:        ' + (reg.customer_phone || '(not given)'),
    'Course:       ' + reg.item_name + ' (' + reg.sku + ')',
    'Date:         ' + (reg.session_label || reg.session_date),
    'Seats:        ' + reg.qty,
    'Org:          ' + (reg.organization || '—'),
    '',
    'The participant answered the two eligibility questions and stopped before payment. Nothing was charged.',
    'The answers are held in the database for 30 days and are not in this message; open the roster',
    '(view=registrations) to follow up. Do not put the answers or the reason in any email.',
  ].join('\n');
  if (!env.NOTIFY_EMAIL || !env.RESEND_API_KEY) {
    console.error('[Review] Email not configured (need NOTIFY_EMAIL + RESEND_API_KEY). Registration ' + reg.id + ' needs review.');
    return;
  }
  await sendEmail(env, { to: list(env.NOTIFY_EMAIL), subject: 'Eligibility review needed: ' + reg.customer_name + ' · ' + reg.item_name, text });
}

/* ──────────────────────── Site contact + capability requests ──────────────────────── */

/**
 * POST /contact — the Atlas Glinn contact form and the capability-statement request.
 * Replaces the mailto: forms, which delivered nothing when the visitor had no mail client and
 * showed a success message anyway. Sends one email to NOTIFY_EMAIL with reply-to set to the
 * sender. A filled honeypot field returns 200 and sends nothing.
 */
async function handleContact(request, env, cors) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return json({ error: 'Bad request' }, 400, cors);
  if (str(body.website)) return json({ ok: true }, 200, cors); // honeypot
  const kind = str(body.kind) === 'capability' ? 'capability' : 'contact';
  const name = str(body.name).trim();
  const email = String(body.email || '').trim().toLowerCase();
  const phone = str(body.phone).trim();
  const message = String(body.message || '').slice(0, 4000).trim();
  if (name.length < 2) return json({ error: 'Enter your name.', field: 'name' }, 400, cors);
  if (!isEmail(email)) return json({ error: 'Enter a valid email address.', field: 'email' }, 400, cors);
  if (kind === 'contact' && message.length < 2) return json({ error: 'Enter a message.', field: 'message' }, 400, cors);
  const meta = {
    company: str(body.company).trim(), status: str(body.status).trim(), request_type: str(body.request_type).trim(),
    ip: request.headers.get('CF-Connecting-IP') || '',
  };
  // Subjects by origin: the Capability Statement form, the page's Private Instruction dialog, and the Gear chapter's quote
  // request (owner, 2026-09-05: Aimpoint / IWA "add to mastsolutions so we can sell there" — quoted by email, never charged online).
  const subject = kind === 'capability'
    ? 'Capability statement request: ' + name + (meta.company ? ' · ' + meta.company : '')
    : (meta.request_type === 'private' ? 'Private instruction request: ' : meta.request_type === 'gear' ? 'Gear quote request: ' : 'Website contact: ') + name;
  const text = [
    kind === 'capability' ? 'CAPABILITY STATEMENT REQUEST' : meta.request_type === 'gear' ? 'GEAR QUOTE REQUEST' : 'WEBSITE CONTACT',
    '',
    'Name:     ' + name,
    'Email:    ' + email,
    'Phone:    ' + (phone || '(not given)'),
    meta.company ? 'Company:  ' + meta.company : null,
    meta.status ? 'Status:   ' + meta.status : null,
    meta.request_type ? 'Request:  ' + meta.request_type : null,
    '',
    message ? 'Message:\n' + message : null,
    '',
    'Received: ' + new Date().toISOString(),
  ].filter((l) => l !== null).join('\n');
  // The lead is stored before anything is sent (CRM, 2026-09-06): a mail failure never loses an inquiry.
  const attribution = attributionFrom(body, request);
  const leadKind = kind === 'capability' ? 'capability' : (meta.request_type === 'private' || meta.request_type === 'gear' || meta.request_type === 'smoke') ? meta.request_type : 'contact';
  const leadId = await recordContact(env, { kind: leadKind, name, email, phone, company: meta.company, status: meta.status, request_type: meta.request_type, message, newsletter_opt_in: body.newsletter_opt_in === true, consent_text: body.consent_text, attribution });
  recordEvent(env, { visitor: attribution.visitor, email, page: attribution.page, action: leadKind === 'gear' ? 'gear_request' : 'contact', label: meta.request_type || kind, attribution }).catch(() => {});
  await syncLead(env, { id: leadId, kind: leadKind, email, name, phone, company: meta.company, request_type: meta.request_type, newsletter_opt_in: body.newsletter_opt_in === true ? 1 : 0 }).catch((e) => console.error('[Sync] lead failed:', e.message));
  if (!env.NOTIFY_EMAIL || !env.RESEND_API_KEY) {
    console.error('[Contact] Email not configured (need NOTIFY_EMAIL + RESEND_API_KEY). Message:\n' + text);
    return json({ error: 'The contact form is not connected yet. Please call (281) 654-8100 or email atlasglinn.hq@atlasglinn.com.' }, 503, cors);
  }
  try {
    await sendEmail(env, { to: list(env.NOTIFY_EMAIL), reply_to: email, subject, text });
    await markContactEmailed(env, leadId);
  } catch (e) {
    console.error('[Contact] send failed:', e.message);
    // The upstream status alone (never Resend's detail) rides along, so the runner smoke test can tell an API-key problem
    // (resend_401) from an unverified sending domain (resend_403) without the Cloudflare log (owner on the road, 2026-09-06).
    return json({ error: 'We could not send your message. Please call (281) 654-8100.', upstream: upstreamHint(e) }, 502, cors);
  }
  console.log('[Contact] Sent:', kind, email);
  return json({ ok: true }, 200, cors);
}

/* ────────────────────── Membership (recurring) ────────────────────── */

/**
 * Resolve a plan key to a Stripe Price ID.
 *
 * Looks in D1 first (table `memberships`), then falls back to a
 * STRIPE_PRICE_<PLAN_KEY> environment variable, so new tiers can be added
 * without editing this file.
 */
async function lookupPlan(env, planKey) {
  const key = String(planKey).toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (!key) return null;

  if (env.DB) {
    try {
      const row = await env.DB.prepare(
        'SELECT plan_key, name, stripe_price_id, price_cents, interval FROM memberships WHERE plan_key = ? AND active = 1 LIMIT 1'
      )
        .bind(key)
        .first();
      if (row) {
        const priceId = row.stripe_price_id || (await ensureMembershipPrice(env, row));
        if (priceId) return { key, name: row.name, priceId };
      }
    } catch (e) {
      console.error('[Plan] D1 lookup failed:', e.message);
    }
  }

  const envVar = 'STRIPE_PRICE_' + key.toUpperCase();
  const priceId = env[envVar];
  if (priceId && !priceId.startsWith('price_REPLACE')) {
    return { key, name: key, priceId };
  }
  return null;
}

/**
 * Membership prices provision themselves (owner, 2026-09-04: "2- you can do"). The first time a plan is joined, the Worker
 * finds the Stripe recurring Price by lookup_key (mast_<plan_key>) or creates it — a Product named after the plan and a
 * monthly Price at the plan's price_cents — and stores the id on the D1 row. No price id is ever pasted anywhere; the Worker
 * already holds the Stripe key. Returns null (and the join fails cleanly) if Stripe is not configured or refuses.
 */
async function ensureMembershipPrice(env, row) {
  if (!env.STRIPE_SECRET_KEY || !row || !row.price_cents) return null;
  const lookupKey = 'mast_' + row.plan_key;
  const headers = { Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY, 'Content-Type': 'application/x-www-form-urlencoded' };
  let priceId = null;
  try {
    const found = await (await fetch('https://api.stripe.com/v1/prices?active=true&limit=1&lookup_keys[]=' + encodeURIComponent(lookupKey), { headers })).json();
    if (found && Array.isArray(found.data) && found.data[0] && found.data[0].id) priceId = found.data[0].id;
  } catch (e) {
    console.error('[Plan] Stripe price lookup failed:', e.message);
  }
  if (!priceId) {
    const body = new URLSearchParams({
      currency: 'usd',
      unit_amount: String(row.price_cents),
      'recurring[interval]': row.interval || 'month',
      lookup_key: lookupKey,
      'product_data[name]': 'MAST Solutions Membership — ' + row.name,
      'metadata[plan_key]': row.plan_key,
    });
    const res = await fetch('https://api.stripe.com/v1/prices', { method: 'POST', headers, body: body.toString() });
    const created = await res.json().catch(() => null);
    if (!res.ok || !created || !created.id) {
      console.error('[Plan] could not create the Stripe price for ' + row.plan_key + ':', JSON.stringify(created));
      return null;
    }
    priceId = created.id;
  }
  if (env.DB) {
    try {
      await env.DB.prepare('UPDATE memberships SET stripe_price_id = ? WHERE plan_key = ?').bind(priceId, row.plan_key).run();
    } catch (e) {
      console.error('[Plan] could not store the price id:', e.message);
    }
  }
  console.log('[Plan] ' + row.plan_key + ' -> ' + priceId);
  return priceId;
}

const CREDENTIAL_PLANS = new Set(['le_team', 'teachers_team']);

async function handleMembership(request, env, cors) {
  const body = await request.json().catch(() => null);
  if (!body || !body.email || !body.plan) {
    return json({ error: 'Missing required fields: email, plan' }, 400, cors);
  }
  if (!isEmail(body.email)) {
    return json({ error: 'Invalid email address' }, 400, cors);
  }

  const plan = await lookupPlan(env, body.plan);
  if (!plan) {
    return json(
      {
        error: 'Membership plan not configured: ' + body.plan,
        hint:
          'Add a row to the D1 `memberships` table with a stripe_price_id, or set ' +
          'STRIPE_PRICE_' + String(body.plan).toUpperCase() + ' on the Worker.',
      },
      400,
      cors
    );
  }

  const seats = clampInt(body.seats, 1, 100);

  // Law Enforcement and Verified Teachers memberships need a photograph of the member's credentials at Join (owner, 2026-09-05:
  // 'how "verified" is checked = upload photo of credentials'). It is emailed to the office for the team to vet and kept nowhere
  // else; checkout proceeds once the email is accepted. A membership the team declines is refunded.
  let credentialNote = '';
  if (CREDENTIAL_PLANS.has(plan.key)) {
    const cred = body.credential && typeof body.credential === 'object' ? body.credential : null;
    const data = cred ? String(cred.data || '') : '';
    const type = cred ? String(cred.content_type || '').toLowerCase() : '';
    if (!cred || !data) return json({ error: plan.name + ' membership needs a photo of your credentials.', field: 'credential', code: 'credential' }, 400, cors);
    if (!/^(image\/(jpeg|jpg|png|heic|heif|webp)|application\/pdf)$/.test(type)) return json({ error: 'Send the credential as a photo (JPEG, PNG, HEIC) or a PDF.', field: 'credential', code: 'credential_type' }, 400, cors);
    if (data.length > 11 * 1024 * 1024 || !/^[A-Za-z0-9+/=\s]+$/.test(data.slice(0, 4096))) return json({ error: 'That file is too large. Up to 8 MB.', field: 'credential', code: 'credential_size' }, 400, cors);
    const safeName = String(cred.filename || 'credential').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80) || 'credential';
    const office = list(env.NOTIFY_EMAIL);
    if (!office.length) return json({ error: 'Membership verification is not configured yet. Please email your credentials to atlasglinn.hq@atlasglinn.com.' }, 503, cors);
    try {
      await sendEmail(env, {
        to: office,
        reply_to: body.email,
        subject: 'Membership credential: ' + (str(body.customer_name).trim() || body.email) + ' · ' + plan.name,
        text: ['A ' + plan.name + ' membership application with credentials attached.', '', 'Name: ' + (str(body.customer_name).trim() || '—'), 'Email: ' + body.email, 'Plan: ' + plan.name + ' (' + plan.key + ')', 'Seats: ' + seats, '', 'The applicant continues to Stripe Checkout after this email. If the team declines the membership, refund it in Stripe.'].join('\n'),
        attachments: [{ filename: safeName, content: data.replace(/\s+/g, '') }],
      });
    } catch (e) {
      console.error('[Membership] credential email failed', e && e.message);
      return json({ error: 'We could not receive your credentials just now. Please email them to atlasglinn.hq@atlasglinn.com and try again.' }, 502, cors);
    }
    credentialNote = 'emailed ' + new Date().toISOString();
  }

  const payload = new URLSearchParams({
    customer_email: body.email,
    mode: 'subscription',
    'line_items[0][price]': plan.priceId,
    'line_items[0][quantity]': String(seats),
    success_url: safeUrl(body.successUrl, env) || defaultUrl(env, '?checkout=success'),
    cancel_url: safeUrl(body.cancelUrl, env) || defaultUrl(env, '?checkout=cancelled'),
    'subscription_data[metadata][kind]': 'membership',
    'subscription_data[metadata][email]': body.email,
    'subscription_data[metadata][plan]': plan.key,
    'subscription_data[metadata][seats]': String(seats),
    'metadata[kind]': 'membership',
    'metadata[plan]': plan.key,
    'metadata[plan_name]': plan.name,
    'metadata[seats]': String(seats),
    'metadata[customer_name]': str(body.customer_name),
    'metadata[credential]': credentialNote,
    'metadata[source]': 'mastsolutions',
    allow_promotion_codes: 'true',
    billing_address_collection: 'auto',
  });

  return await createSession(payload, env, cors, 'Membership');
}

/* ─────────────────────── Stripe session helper ─────────────────────── */

async function createStripeSession(payload, env, label) {
  if (!env.STRIPE_SECRET_KEY) {
    console.error('[' + label + '] STRIPE_SECRET_KEY not set');
    return { ok: false, status: 503, error: 'Payments are not configured. Please call to book.' };
  }

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: payload.toString(),
  });

  const session = await res.json();
  if (!res.ok) {
    console.error('[' + label + '] Stripe error:', JSON.stringify(session));
    // Don't leak Stripe internals to the browser.
    return { ok: false, status: 502, error: 'Could not start checkout. Please try again or call us.' };
  }

  console.log('[' + label + '] Session created:', session.id);
  return { ok: true, session };
}

async function createSession(payload, env, cors, label) {
  const r = await createStripeSession(payload, env, label);
  return r.ok ? json({ checkoutUrl: r.session.url, sessionId: r.session.id }, 200, cors) : json({ error: r.error }, r.status, cors);
}

/* ────────────────────────────── Webhook ────────────────────────────── */

async function handleWebhook(request, env, ctx, cors) {
  const rawBody = await request.text();
  const signature = request.headers.get('stripe-signature');

  const verdict = await verifyStripeSignature(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  if (!verdict.ok) {
    console.warn('[Webhook] Rejected:', verdict.reason);
    return json({ error: 'Invalid signature' }, 401, cors);
  }

  const event = JSON.parse(rawBody);
  console.log('[Webhook] Event:', event.type, event.id);

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const meta = session.metadata || {};
    if (session.mode === 'setup') {
      // Account card saved through Checkout in setup mode: make it the customer's default for future charges.
      ctx.waitUntil(setDefaultCardFromSetup(env, session).catch((e) => console.error('[AccountCard] failed:', e.message)));
      return json({ received: true }, 200, cors);
    }
    const record = {
      stripe_session_id: session.id,
      stripe_event_id: event.id,
      kind: meta.kind || (session.mode === 'subscription' ? 'membership' : 'class_booking'),
      sku: meta.sku || meta.plan || '',
      item_name: meta.class_name || meta.plan_name || '',
      session_date: meta.session_date || '',
      session_label: meta.session_label || '',
      qty: parseInt(meta.qty || meta.seats || '1', 10) || 1,
      amount_total: session.amount_total || 0,
      currency: session.currency || 'usd',
      customer_email: session.customer_email || session.customer_details?.email || '',
      customer_name: meta.customer_name || session.customer_details?.name || '',
      customer_phone: session.customer_details?.phone || '',
      organization: meta.organization || '',
      notes: meta.notes || '',
      utm_source: meta.utm_source || '', utm_medium: meta.utm_medium || '', utm_campaign: meta.utm_campaign || '', first_touch_at: meta.first_touch_at || '',
      created_at: new Date().toISOString(),
    };

    // Persist first — a stored order is what makes the money recoverable.
    const stored = await storeOrder(env, record);

    // A registration (screening + agreement + refund consent) rides in metadata: mark it paid,
    // copy the refund consent onto the order, then send the participant and range documents.
    const registration = meta.registration_id
      ? await completeRegistration(env, meta.registration_id, record).catch((e) => {
          console.error('[Register] link failed:', e.message);
          return null;
        })
      : null;
    if (registration && !record.customer_phone) record.customer_phone = registration.customer_phone || '';

    // Then notify. Never let a failing email lose the order.
    ctx.waitUntil(
      notify(env, record, stored).catch((e) => console.error('[Notify] failed:', e.message))
    );
    if (registration) {
      ctx.waitUntil(
        sendRegistrationDocuments(env, registration, record).catch((e) => console.error('[Documents] failed:', e.message))
      );
      // CRM record (HubSpot) always; marketing lists (Mailchimp, Brevo) only with the newsletter tick — a purchase is not
      // consent. A no-op until the keys are on the Worker.
      ctx.waitUntil(syncOnPayment(env, registration, record).catch((e) => console.error('[Sync] failed:', e.message)));
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object;
    await markMembershipCancelled(env, sub).catch((e) =>
      console.error('[Webhook] cancel write failed:', e.message)
    );
  }

  if (event.type === 'invoice.payment_failed') {
    const inv = event.data.object;
    console.warn('[Webhook] Payment failed for:', inv.customer_email || inv.customer);
  }

  return json({ received: true }, 200, cors);
}

/** Write the order to D1. Idempotent on stripe_session_id. */
async function storeOrder(env, r) {
  if (!env.DB) {
    console.error('[Order] D1 not bound — ORDER NOT PERSISTED:', JSON.stringify(r));
    return false;
  }
  const base = [
    r.stripe_session_id, r.stripe_event_id, r.kind, r.sku, r.item_name,
    r.session_date || null, r.session_label || null, r.qty,
    r.amount_total, r.currency, r.customer_email, r.customer_name, r.customer_phone,
    r.organization, r.notes, r.created_at,
  ];
  const insertBase = () => env.DB.prepare(
    `INSERT INTO orders (
       stripe_session_id, stripe_event_id, kind, sku, item_name, session_date, session_label, qty,
       amount_total, currency, customer_email, customer_name, customer_phone,
       organization, notes, status, created_at
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'paid',?)
     ON CONFLICT(stripe_session_id) DO NOTHING`
  ).bind(...base).run();
  const insertWithUtm = () => env.DB.prepare(
    `INSERT INTO orders (
       stripe_session_id, stripe_event_id, kind, sku, item_name, session_date, session_label, qty,
       amount_total, currency, customer_email, customer_name, customer_phone,
       organization, notes, status, created_at, utm_source, utm_medium, utm_campaign, first_touch_at
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'paid',?,?,?,?,?)
     ON CONFLICT(stripe_session_id) DO NOTHING`
  ).bind(...base, r.utm_source || null, r.utm_medium || null, r.utm_campaign || null, r.first_touch_at || null).run();
  try {
    // Attribution columns when the table has them (schema.sql; crm.js adds them to an older table on first use); the
    // order itself never waits on them.
    try { await insertWithUtm(); }
    catch (e) { if (!/no column|no such column|has no column/i.test(String(e.message))) throw e; await insertBase(); }
    console.log('[Order] Stored:', r.stripe_session_id, r.item_name, r.customer_email);
    return true;
  } catch (e) {
    console.error('[Order] D1 write FAILED:', e.message, JSON.stringify(r));
    return false;
  }
}

async function markMembershipCancelled(env, sub) {
  if (!env.DB) return;
  const email = sub.metadata?.email || '';
  if (!email) return;
  await env.DB.prepare(
    "UPDATE orders SET status = 'cancelled' WHERE customer_email = ? AND kind = 'membership'"
  )
    .bind(email)
    .run();
  console.log('[Membership] Cancelled:', email);
}

/**
 * Send the booking notification.
 *
 * Uses Resend when RESEND_API_KEY is set. If email is not configured the order
 * is still stored, and this logs loudly rather than failing silently.
 */
async function notify(env, r, stored) {
  const to = env.NOTIFY_EMAIL;
  const subject =
    (r.kind === 'membership' ? 'New MAST membership: ' : 'New MAST booking: ') +
    (r.item_name || r.sku) +
    (r.qty > 1 ? ' ×' + r.qty : '');

  const lines = [
    r.kind === 'membership' ? 'NEW MEMBERSHIP' : 'NEW CLASS BOOKING',
    '',
    'Item:      ' + (r.item_name || r.sku),
    'SKU/Plan:  ' + r.sku,
    'Date:      ' + (r.session_label || r.session_date || '(not chosen — call customer)'),
    'Qty/Seats: ' + r.qty,
    'Paid:      ' + money(r.amount_total, r.currency),
    '',
    'Customer:  ' + (r.customer_name || '(not given)'),
    'Email:     ' + r.customer_email,
    'Phone:     ' + (r.customer_phone || '(not given)'),
    'Org:       ' + (r.organization || '—'),
    'Notes:     ' + (r.notes || '—'),
    '',
    'Stripe:    ' + r.stripe_session_id,
    'Booked:    ' + r.created_at,
    stored ? '' : '⚠️ WARNING: this order could NOT be written to the database. Record it manually.',
  ];
  const text = lines.join('\n');

  if (!to || !env.RESEND_API_KEY) {
    console.error('[Notify] Email not configured (need NOTIFY_EMAIL + RESEND_API_KEY). Order details:\n' + text);
    return;
  }

  await sendEmail(env, { to: list(to), reply_to: r.customer_email || undefined, subject, text });
  console.log('[Notify] Sent to', to, '—', subject);
}

/** One Resend call. Throws on a non-2xx so callers decide what a failed email means. */
// Every email the Worker sends is blind-copied to the owner (owner, 2026-09-05: "all emails to office + BCC matthew@atlasglinn,
// matthew@mastsolutions"); BCC_ALWAYS on the Worker overrides the list. Addresses already in `to` are not copied twice.
const BCC_DEFAULT = 'matthew@atlasglinn.com, matthew@mastsolutions.com';
// "resend_422:validation_error field=to": the status, Resend's error name and the field its message names — never the
// message itself or an address — so the runner smoke test can say which value on the Worker is malformed (2026-09-06:
// /contact answered 502 with Resend 422 while the key and the domain checked out).
function upstreamHint(e) {
  const msg = String((e && e.message) || '');
  const m = /^Resend (\d{3}):\s*([\s\S]*)$/.exec(msg);
  if (!m) return 'send_failed';
  let hint = 'resend_' + m[1];
  try {
    const d = JSON.parse(m[2]);
    if (d && d.name) hint += ':' + String(d.name).replace(/[^a-z_]/gi, '').slice(0, 40);
    const f = /`([a-z_]+)`\s*field|field\s*`([a-z_]+)`|Missing `([a-z_]+)`/i.exec(String(d && d.message || ''));
    if (f) hint += ' field=' + (f[1] || f[2] || f[3]);
  } catch (_) { /* not JSON: status alone */ }
  return hint;
}

async function sendEmail(env, { to, subject, text, reply_to, attachments, bcc: copy = true }) {
  const toList = Array.isArray(to) ? to : list(to);
  // bcc:false is for one-time codes (email verification, password reset): those are the student's alone.
  const bcc = copy ? list(env.BCC_ALWAYS === undefined ? BCC_DEFAULT : env.BCC_ALWAYS).filter((a) => !toList.map((x) => x.toLowerCase()).includes(a.toLowerCase())) : [];
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + env.RESEND_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.NOTIFY_FROM || 'MAST Solutions <bookings@mastsolutions.com>',
      to,
      bcc: bcc.length ? bcc : undefined,
      // The From address is a sender label on the verified domain, not a mailbox (owner, 2026-09-05: "bookings@mastsolutions.com
      // = NOT email"), so every email carries a real Reply-To unless the caller set one (office alerts reply to the customer).
      reply_to: reply_to || env.REPLY_TO || 'matthew@mastsolutions.com',
      subject,
      text,
      attachments: attachments && attachments.length ? attachments : undefined,
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error('Resend ' + res.status + ': ' + detail);
  }
}

function list(v) {
  return String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
}

/* ───────────── Registration completion: link, documents, retention ───────────── */

/** After payment: mark the registration paid and copy the refund consent onto the order row. */
async function completeRegistration(env, id, record) {
  if (!env.DB) return null;
  const reg = await env.DB.prepare('SELECT * FROM registrations WHERE id = ? LIMIT 1').bind(id).first();
  if (!reg) {
    console.error('[Register] webhook names an unknown registration:', id);
    return null;
  }
  const paidAt = new Date().toISOString();
  await updateRegistration(env, id, { status: 'paid', paid_at: paidAt, stripe_session_id: record.stripe_session_id });
  await env.DB.prepare(
    `UPDATE orders SET refund_policy_version = ?, refund_policy_accepted_at = ?, refund_policy_ip = ?,
       customer_phone = CASE WHEN customer_phone IS NULL OR customer_phone = '' THEN ? ELSE customer_phone END
     WHERE stripe_session_id = ?`
  ).bind(reg.refund_policy_version, reg.refund_policy_accepted_at, reg.refund_policy_ip, reg.customer_phone || '', record.stripe_session_id).run();
  console.log('[Register] Paid:', id, reg.item_name, reg.customer_email);
  return { ...reg, status: 'paid', paid_at: paidAt };
}

/**
 * The documents behind a paid registration (ARCHITECTURE.md §7 routing):
 *   - the participant: confirmation, what happens next, the range address (sent nowhere else),
 *     the cancellation policy they accepted, and the signed agreement as a PDF;
 *   - DOC_RECIPIENTS_AGREEMENT (range host + staff): the signed agreement and nothing else.
 * The internal roster notice already went out via notify(). Eligibility answers appear in none of these.
 */
async function sendRegistrationDocuments(env, reg, record) {
  if (!env.RESEND_API_KEY) {
    console.error('[Documents] RESEND_API_KEY not set — confirmation and agreement NOT sent for', reg.id);
    return;
  }
  let pdfB64 = null;
  try {
    const { default: blank } = await import('./agreement-asset.js');
    pdfB64 = toBase64(await fillAgreement(blank, reg));
  } catch (e) {
    console.error('[Documents] agreement fill failed (sending confirmation without the PDF):', e.message);
  }
  const fileName = 'MAST-Participation-Agreement-' + String(reg.customer_name || 'participant').replace(/[^A-Za-z0-9]+/g, '-') + '.pdf';
  const attachments = pdfB64 ? [{ filename: fileName, content: pdfB64 }] : [];
  // The range-directions PDF (RANGE_ADDRESS / RANGE_COORDS / RANGE_DIRECTIONS rendered by src/directions.js); [] when unset.
  const directions = await directionsAttachment(env);
  const when = reg.session_label || reg.session_date;
  const seats = Number(reg.qty || 1);

  const rangeLines = env.RANGE_ADDRESS
    ? ['Range:       ' + env.RANGE_ADDRESS + (env.RANGE_COORDS ? ' (' + env.RANGE_COORDS + ')' : ''),
       '             Rural range: your GPS will stop you short of it. Plan for the drive.']
    : [];
  rangeLines.push(directions.length ? 'Directions:  the PDF attached to this email. Keep it on your phone.' : 'Directions:  follow by email before the class.');
  const customerText = [
    "You're booked.",
    '',
    'Course:      ' + reg.item_name,
    'Date:        ' + when,
    'Seats:       ' + seats,
    'Paid:        ' + money(record.amount_total, record.currency) + ' (Stripe sends its own receipt)',
    'Booking ref: ' + reg.id,
    '',
    'WHAT HAPPENS NEXT',
    '- Your signed Class Participation and Use of Property Agreement is attached. Keep a copy.',
    '- Gear list arrives by separate email before the class.',
    ...rangeLines,
    '- Arrive 15 minutes early. Live-fire classes open with a mandatory safety brief; a student who misses it cannot be admitted to the range.',
    seats > 1
      ? '- Each additional attendee must complete the eligibility screening and sign the agreement before class. Reply with their names and emails and we will send each of them their own copy to complete.'
      : '',
    '',
    'CANCELLATION AND REFUND POLICY (accepted ' + reg.refund_policy_accepted_at + ', version ' + reg.refund_policy_version + ')',
    '- 15 or more days before class: full refund, or transfer to any future class at no charge.',
    '- 7 to 14 days: transfer at no charge, or refund less 25%.',
    '- 48 hours to 6 days: transfer once at no charge; no refund.',
    '- Under 48 hours, or no-show: no refund and no transfer.',
    '- Serious illness, injury, family emergency, or deployment: contact us and we will transfer your seat.',
    '',
    'Questions: (281) 654-8100 · atlasglinn.hq@atlasglinn.com',
    'MAST Solutions · a division of Atlas Glinn, LLC · Houston, Texas',
  ].filter((l) => l !== null).join('\n');

  await sendEmail(env, { to: [reg.customer_email], subject: "You're booked: " + reg.item_name + ' · ' + when, text: customerText, attachments: [...attachments, ...directions] });

  const agreementTo = list(env.DOC_RECIPIENTS_AGREEMENT);
  if (agreementTo.length && pdfB64) {
    await sendEmail(env, {
      to: agreementTo,
      subject: 'Signed participation agreement: ' + reg.customer_name + ' · ' + reg.item_name + ' · ' + when,
      text: 'Attached: the Class Participation and Use of Property Agreement signed electronically by ' + reg.customer_name +
        ' on ' + reg.agreement_signed_at + ' (agreement version ' + reg.agreement_version + ') for ' + reg.item_name + ', ' + when + '.\n\n' +
        'This message carries the agreement only.',
      attachments,
    });
  } else if (!agreementTo.length) {
    console.warn('[Documents] DOC_RECIPIENTS_AGREEMENT not set — the range host did not receive the agreement for', reg.id);
  }
  await updateRegistration(env, reg.id, { documents_sent_at: new Date().toISOString() }).catch(() => {});
  console.log('[Documents] Sent for', reg.id, pdfB64 ? 'with agreement PDF' : 'WITHOUT agreement PDF');
}

/* The week's claim in email_log: one row per ISO week, and the recipients are not its identity — reordering
   CRM_DIGEST_TO must not buy the week a second digest. Thirty minutes is longer than any run and shorter than the
   gap to the next cron, so a 'sending' row older than that is a crashed run and not a race. */
const DIGEST_CLAIM_EMAIL = 'crm-digest';
const DIGEST_CLAIM_STALE_MS = 30 * 60 * 1000;

/**
 * One CRM digest a week to CRM_DIGEST_TO (wrangler.toml [vars]). Same text as GET /admin/crm?view=weekly, so a
 * runner without the mailbox reads exactly what was sent. Unconfigured = logged and skipped, like the review notice.
 * Once per ISO week, claimed in email_log (kind 'digest', ref the week) the way the journeys claim theirs — CLAIM
 * BEFORE SEND: the row is written 'sending' before Resend is called and flipped to 'sent' after, so a week that has
 * been claimed is never mailed twice while its claim row survives (a lost flip-to-sent write costs one duplicate, not the week). A run that fails deletes its own claim, leaving the week
 * open for the Tuesday or Wednesday cron; a claim that cannot be written or read sends nothing at all, because a
 * fail-open dedupe read is how a week gets mailed twice. weeklyDigest itself rejects on a failed read, so a D1
 * outage sends nothing rather than a week of zeros.
 */
async function sendWeeklyDigest(env, now = new Date()) {
  const to = list(env.CRM_DIGEST_TO);
  const period = weeklyDigestPeriod(now);
  const ref = period.split('·').pop().trim();
  if (!env.DB) { console.error('[Digest] no DB binding — skipping'); return { sent: 0, skipped: true }; }
  if (!to.length || !env.RESEND_API_KEY) {
    console.error('[Digest] Email not configured (need CRM_DIGEST_TO + RESEND_API_KEY). Digest:\n' + await weeklyDigest(env, { now }));
    return { sent: 0 };
  }
  // The claim row lives in the CRM tables the Worker creates itself; on a fresh D1 the INSERT would fail before the table
  // exists and the week would fail closed forever (verifier, 2026-09-08). Ensure the schema first, every run.
  await ensureCrmSchema(env);
  try {
    const claim = await env.DB.prepare('INSERT OR IGNORE INTO email_log (created_at, email, ref, kind, status) VALUES (?, ?, ?, ?, ?)')
      .bind(now.toISOString(), DIGEST_CLAIM_EMAIL, ref, 'digest', 'sending').run();
    if (!(claim && claim.meta && claim.meta.changes)) {
      const held = await env.DB.prepare("SELECT status, created_at FROM email_log WHERE email = ? AND ref = ? AND kind = 'digest' LIMIT 1")
        .bind(DIGEST_CLAIM_EMAIL, ref).first();
      if (held && held.status === 'sent') { console.log('[Digest]', ref, 'already sent — nothing to do'); return { sent: 0, skipped: true }; }
      const crashed = held && held.status === 'sending' && Date.parse(held.created_at) < now.getTime() - DIGEST_CLAIM_STALE_MS;
      if (!crashed) { console.log('[Digest]', ref, 'is claimed — nothing to do'); return { sent: 0, skipped: true }; }
      console.warn('[Digest]', ref, 'was claimed at', held.created_at, 'and never finished — taking it over');
      await env.DB.prepare('UPDATE email_log SET created_at = ? WHERE email = ? AND ref = ? AND kind = ?')
        .bind(now.toISOString(), DIGEST_CLAIM_EMAIL, ref, 'digest').run();
    }
  } catch (e) {
    console.error('[Digest] claim failed:', e.message);
    return { sent: 0, skipped: true };
  }
  try {
    const text = await weeklyDigest(env, { now });
    await sendEmail(env, { to, subject: 'MAST CRM weekly — ' + period, text });
  } catch (e) {
    // The row is the week's lock, not a record of a send: release it so the Tuesday or Wednesday cron carries the week.
    await env.DB.prepare("DELETE FROM email_log WHERE email = ? AND ref = ? AND kind = ? AND status = 'sending'")
      .bind(DIGEST_CLAIM_EMAIL, ref, 'digest').run().catch((err) => console.error('[Digest] release failed:', err.message));
    throw e;
  }
  await env.DB.prepare("UPDATE email_log SET status = 'sent' WHERE email = ? AND ref = ? AND kind = ?")
    .bind(DIGEST_CLAIM_EMAIL, ref, 'digest').run().catch((e) => console.error('[Digest] log failed:', e.message));
  console.log('[Digest] Sent to', to.join(', '));
  return { sent: to.length };
}

/** Daily: answers past purge_after go; registrations that never reached payment are marked abandoned. */
async function runRetention(env) {
  if (!env.DB) return { purged: 0, abandoned: 0 };
  const now = new Date().toISOString();
  const purged = await env.DB.prepare('DELETE FROM eligibility_answers WHERE purge_after < ?').bind(now).run();
  const dayAgo = new Date(Date.now() - 86400000).toISOString();
  const abandoned = await env.DB.prepare("UPDATE registrations SET status = 'abandoned' WHERE status = 'pending' AND created_at < ?").bind(dayAgo).run();
  // An account whose email was never verified within a day is a squat or a typo: it goes, and the address is free again.
  const unverified = await env.DB.prepare('DELETE FROM accounts WHERE verified_at IS NULL AND created_at < ?').bind(dayAgo).run().catch(() => null);
  // Counter rows nobody has touched for a day carry no live window (src/ratelimit.js).
  const rateRows = await purgeRateLimits(env).catch(() => 0);
  const out = { purged: purged?.meta?.changes ?? 0, abandoned: abandoned?.meta?.changes ?? 0, unverified: unverified?.meta?.changes ?? 0, rate_limits: rateRows };
  console.log('[Retention] answers purged:', out.purged, '· registrations abandoned:', out.abandoned, '· unverified accounts removed:', out.unverified, '· rate-limit rows dropped:', out.rate_limits);
  return out;
}

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/* ─────────────────────────── CRM (staff) ─────────────────────────── */

function adminKeyOk(request, env, url) {
  const key = request.headers.get('X-Admin-Key') || url.searchParams.get('key') || '';
  return !!(env.ADMIN_KEY && key && timingSafeEqual(key, env.ADMIN_KEY));
}

/** The catalog as rows (D1 offerings when present, else the seed) for the journeys' next-course line. */
async function catalogRows(env) {
  if (env.DB) {
    try {
      const { results } = await env.DB.prepare('SELECT sku, name, price_cents FROM offerings WHERE active = 1 ORDER BY sort_order, name').all();
      if (results && results.length) return results;
    } catch (_) { /* seed below */ }
  }
  return SEED_CLASSES;
}

async function handleAdmin(request, env, cors, url) {
  if (!adminKeyOk(request, env, url)) return json({ error: 'Unauthorized' }, 401, cors);
  if (!env.DB) return json({ error: 'Database not bound' }, 503, cors);
  const noStore = { ...cors, 'Cache-Control': 'no-store' };
  if (url.pathname === '/admin/crm' && request.method === 'GET') {
    const view = url.searchParams.get('view');
    // view=weekly: the Monday digest as it is emailed, for a runner reading it without the mailbox (owner, 2026-09-08).
    if (view === 'weekly') return new Response(await weeklyDigest(env), { status: 200, headers: { ...noStore, 'Content-Type': 'text/plain; charset=utf-8' } });
    const snap = await crmSnapshot(env, { view: view === 'summary' ? 'summary' : 'full' });
    return json(snap, 200, noStore);
  }
  if (url.pathname === '/admin/audience.csv' && request.method === 'GET') {
    const { customers } = await crmSnapshot(env);
    return new Response(audienceCsv(customers), { status: 200, headers: { ...noStore, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="mast-audience.csv"' } });
  }
  if (url.pathname === '/admin/sync' && request.method === 'POST') {
    const { customers } = await crmSnapshot(env);
    return json(await syncAudience(env, customers), 200, noStore);
  }
  if (url.pathname === '/admin/journeys' && request.method === 'POST') {
    // Run today's journeys now instead of at 09:17 UTC (idempotent: email_log).
    return json(await runJourneys(env, { send: (m) => sendEmail(env, m), catalog: await catalogRows(env) }), 200, noStore);
  }
  return json({ error: 'Not found' }, 404, cors);
}

/* ─────────────────────────── Admin roster ─────────────────────────── */

async function handleRoster(request, env, cors) {
  const url = new URL(request.url);
  const key = url.searchParams.get('key') || '';
  if (!env.ADMIN_KEY || !timingSafeEqual(key, env.ADMIN_KEY)) {
    return json({ error: 'Unauthorized' }, 401, cors);
  }
  if (!env.DB) {
    return json({ error: 'Database not bound' }, 503, cors);
  }

  const sku = url.searchParams.get('sku');
  const limit = clampInt(url.searchParams.get('limit'), 1, 500) || 100;

  // view=registrations: the screening → agreement → payment records, review items first.
  // Never joins eligibility_answers; staff read those in the D1 console, one row at a time.
  if (url.searchParams.get('view') === 'registrations') {
    const { results } = await env.DB.prepare(
      `SELECT id, created_at, status, sku, item_name, qty, session_date, session_label, customer_name, customer_email,
              customer_phone, organization, eligibility_status, agreement_version, agreement_signed_at,
              refund_policy_version, refund_policy_accepted_at, stripe_session_id, paid_at, documents_sent_at
       FROM registrations ORDER BY CASE status WHEN 'review' THEN 0 ELSE 1 END, created_at DESC LIMIT ?`
    ).bind(limit).all();
    return json({ count: results.length, registrations: results }, 200, cors);
  }

  const query = sku
    ? env.DB.prepare(
        'SELECT * FROM orders WHERE sku = ? ORDER BY created_at DESC LIMIT ?'
      ).bind(sku, limit)
    : env.DB.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT ?').bind(limit);

  const { results } = await query.all();
  return json({ count: results.length, orders: results }, 200, cors);
}

/* ────────────────────────────── Helpers ────────────────────────────── */

/**
 * Verify a Stripe webhook signature.
 * Constant-time compare, and rejects timestamps outside the replay window.
 */
async function verifyStripeSignature(rawBody, signature, secret) {
  if (!secret) return { ok: false, reason: 'STRIPE_WEBHOOK_SECRET not set' };
  if (!signature) return { ok: false, reason: 'no stripe-signature header' };

  const parts = {};
  for (const piece of signature.split(',')) {
    const idx = piece.indexOf('=');
    if (idx > 0) {
      const k = piece.slice(0, idx).trim();
      const v = piece.slice(idx + 1).trim();
      if (k === 'v1') (parts.v1 ||= []).push(v);
      else parts[k] = v;
    }
  }

  const timestamp = parts.t;
  const signatures = parts.v1 || [];
  if (!timestamp || signatures.length === 0) {
    return { ok: false, reason: 'malformed signature header' };
  }

  const age = Math.floor(Date.now() / 1000) - parseInt(timestamp, 10);
  if (!Number.isFinite(age) || Math.abs(age) > REPLAY_WINDOW_SECONDS) {
    return { ok: false, reason: 'timestamp outside replay window (' + age + 's)' };
  }

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const buf = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(timestamp + '.' + rawBody)
  );
  const computed = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

  for (const candidate of signatures) {
    if (timingSafeEqual(computed, candidate)) return { ok: true };
  }
  return { ok: false, reason: 'signature mismatch' };
}

/** Constant-time string comparison. */
function timingSafeEqual(a, b) {
  const x = String(a);
  const y = String(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

/** Only allow redirect URLs back to an allowlisted origin. */
function safeUrl(candidate, env) {
  if (!candidate) return null;
  try {
    const u = new URL(candidate);
    const allowed = allowedOrigins(env);
    if (allowed.length === 0 || allowed.includes(u.origin)) return u.toString();
    console.warn('[Redirect] Rejected off-origin URL:', candidate);
    return null;
  } catch {
    return null;
  }
}

// Where Stripe sends people back when the page did not say (or said somewhere off-origin): the MAST page itself.
// SITE_URL is the page's full address; the old fallback used the first allowed ORIGIN alone, which dropped the
// /mastsolutions.html path and landed paid customers on the Atlas Glinn home page (owner, 2026-09-05: "correct
// the payment link in the back end").
function defaultUrl(env, suffix) {
  const page = env.SITE_URL || ((allowedOrigins(env)[0] || 'https://atlasglinn.com') + '/mastsolutions.html');
  const [path, query = ''] = page.split('?');
  const q = suffix.replace(/^\?/, '');
  return path + '?' + (query ? query + '&' + q : q);
}

function isEmail(v) {
  return typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
}

function clampInt(v, min, max) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function str(v) {
  return typeof v === 'string' ? v.slice(0, 500) : '';
}

function money(cents, currency) {
  return (
    '$' + (Number(cents || 0) / 100).toFixed(2) + ' ' + String(currency || 'usd').toUpperCase()
  );
}

/** A 429 that always carries Retry-After, so a browser or a script can back off without parsing the body. */
function tooMany(cors, retryAfter, code, message) {
  const secs = Math.max(1, Math.round(Number(retryAfter) || 1));
  return json({ error: message, code, retry_after: secs }, 429, { ...cors, 'Retry-After': String(secs) });
}

function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

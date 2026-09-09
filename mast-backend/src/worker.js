/**
 * MAST Solutions — booking & membership backend.
 *
 * Cloudflare Worker handling Stripe Checkout for:
 *   - registration              POST /register   screening → agreement → refund consent → Stripe
 *   - one-time class seats      POST /create-booking   (legacy path, no screening; kept for the WP theme)
 *   - recurring memberships     POST /create-membership
 *   - Stripe webhooks           POST /webhook
 *   - admin roster              GET  /roster   (X-Admin-Key header)[?view=registrations]
 *   - health                    GET  /health
 *   - one cron, two jobs        scheduled(): the five-minute Stripe Tax tick, and — on the fire inside the 09:15–09:19
 *                               UTC window, claimed once a day in D1 — purge eligibility answers, expire abandoned
 *                               registrations, the journeys and, on Mondays, the CRM digest
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
import { checkRate, ensureRateSchema, purgeRateLimits, clientIp, lockedFor, noteFailedLogin, dummyFailedLogin, clearFailedLogins, identityLockedFor, noteFailedIdentity, clearFailedIdentity, codeGuessesSpent, noteCodeGuess, clearCodeGuesses, absentGuessId, pendingGuessId, addressDigest, noteCodeMail, CODE_GUESSES_PER_IP } from './ratelimit.js';
import { ensureCrmSchema, crmSnapshot, audienceCsv, syncAudience, syncOnPayment, syncLead, adminPage, attributionFrom, recordContact, markContactEmailed, recordEvent, handleEvent, handleSubscribe, runJourneys, weeklyDigest, weeklyDigestPeriod } from './crm.js';

const REPLAY_WINDOW_SECONDS = 300; // reject webhook timestamps older than 5 min

/** Version stamps. The page sends what it showed; a mismatch means the participant saw stale terms. */
export const QUESTIONS_VERSION = '2q-2026-09-03';        // the two questions as worded on the page
export const REFUND_POLICY_VERSION = '2026-09-01'; // REFUND-POLICY-DRAFT.md as rendered on the page; approved by the owner 2026-09-02
export { AGREEMENT_VERSION };

/* ───────────────────────── Stripe Tax (Houston, Texas) ─────────────────────────
   Owner, 2026-09-08: "Also, a stripe taken out sales tax for Houston, Texas"; 2026-09-09, asked whether the business
   holds a Texas Sales and Use Tax Permit: "yes". Collection is EXCLUSIVE — tax is added on top of the listed price and
   never folded into it, so $695 stays $695 on the page and the tax is its own line at checkout.

   Tax codes, VERIFIED: https://docs.stripe.com/tax/tax-codes lists txcd_20030000 = "General - Services" and
   txcd_99999999 = "General - Physical Goods" (any tangible or physical good; the standard rate applies), read
   2026-09-09 00:52 UTC. The page itself does not open from inside the build container — the agent proxy answers 403 to
   CONNECT for docs.stripe.com — so re-reading it here is not possible; `GET /v1/tax_codes` with the live key is the
   in-account confirmation. */
const TAX_CODE_SERVICES = 'txcd_20030000'; // "General - Services" — training courses, private instruction, experiences, memberships
const TAX_CODE_GOODS = 'txcd_99999999';    // "General - Physical Goods" — IWA devices, if gear is ever sold through Checkout (no route sells goods today)

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
        // daily_last_run: the UTC date the once-a-day claim holds (DAILY_GUARD_KEY), so a lost day is measurable from
        // outside the isolate now that the daily work rides on one fire in 288. null when D1 is absent or unreadable.
        const dailyLastRun = await dailyLastRunDate(env);
        return json({ status: 'MAST booking backend — ONLINE', version: '1.2.0', build: env.BUILD || null, crm: true, directions, daily_last_run: dailyLastRun }, 200, cors);
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
        return await handleBooking(request, env, ctx, cors);
      }
      if (url.pathname === '/create-membership' && request.method === 'POST') {
        return await handleMembership(request, env, ctx, cors);
      }
      if (url.pathname === '/webhook' && request.method === 'POST') {
        return await handleWebhook(request, env, ctx, cors);
      }
      // Student accounts (owner, 2026-09-05)
      if (url.pathname === '/account/register' && request.method === 'POST') return await handleAccountRegister(request, env, ctx, cors);
      if (url.pathname === '/account/login' && request.method === 'POST') return await handleAccountLogin(request, env, ctx, cors);
      if (url.pathname === '/account/verify' && request.method === 'POST') return await handleAccountVerify(request, env, ctx, cors);
      if (url.pathname === '/account/resend' && request.method === 'POST') return await handleAccountResend(request, env, ctx, cors);
      if (url.pathname === '/account/forgot' && request.method === 'POST') return await handleAccountForgot(request, env, ctx, cors);
      if (url.pathname === '/account/reset' && request.method === 'POST') return await handleAccountReset(request, env, ctx, cors);
      if (url.pathname === '/account/me' && request.method === 'GET') return await handleAccountMe(request, env, cors);
      if (url.pathname === '/account/update' && request.method === 'POST') return await handleAccountUpdate(request, env, cors);
      if (url.pathname === '/account/password' && request.method === 'POST') return await handleAccountPassword(request, env, cors);
      if (url.pathname === '/account/setup-payment' && request.method === 'POST') return await handleAccountSetupPayment(request, env, ctx, cors);
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

  /** The crons (wrangler.toml [triggers]), dispatched by the one that fired. */
  async scheduled(event, env, ctx) {
    // The five-minute tick is the tax loop on 287 of its 288 daily fires. Cloudflare hands every trigger to this one
    // handler, so without this branch the daily work — the retention purge, the journeys, the Monday digest — would run
    // on every one of them instead of once. The tick exists because a ten-minute readiness TTL refreshed once a day is a
    // measurement that is stale 1430 minutes out of 1440: a business selling one order an hour would sell almost every
    // one of them UNTAXED, and a completed Checkout Session cannot be re-taxed afterwards. Refresh at least as often as
    // it expires. The 288th fire is the one inside the daily window, and it carries the daily work as well — see ONE
    // TRIGGER, TWO JOBS below and the block above runRetention.
    //
    // BOTH BRANCHES ARE EXPLICIT, and the unrecognised one runs the TICK. This used to be one `if` for the tick and the
    // daily work as the else, so anything that was not the tick string — a trigger added to wrangler.toml, a renamed
    // schedule, a Cloudflare event with no `cron` — fell into the DAILY branch. Firing every five minutes, that is 288
    // retention purges, 288 journey passes and 288 chances at the weekly digest in a day. The tick is the cheap,
    // idempotent one (one D1 read on a ready account), so it is what an unknown trigger gets, out loud.
    const cron = String((event && event.cron) || '');
    // The moment this fire was SCHEDULED for, which is what places it inside or outside the daily window. Date.now() is
    // the fallback and only the fallback: an event with no scheduledTime (or a nonsense one) must still tick.
    const firedAt = new Date(Number(event && event.scheduledTime) || Date.now());
    // `fromCron` is what stamps tax:cron_last_run, and it is the RECOGNISED trigger strings alone — not "scheduled()
    // was entered". An event carrying a cron this Worker does not know is a wrong wrangler.toml, and treating it as
    // proof the tax loop is alive is how a renamed schedule would report a healthy loop while the tick it was supposed
    // to drive never ran. It still gets the cheap tick; it does not get to write the liveness row.
    const tick = async (trigger, fromCron) => {
      if (String(env.STRIPE_TAX) === '1') ctx.waitUntil(taxTick(env, trigger, fromCron).catch((e) => console.error('[Tax] tick failed:', e.message)));
      else {
        // The scheduler's liveness is a fact about Cloudflare, not about the STRIPE_TAX switch: stamp the cron row so a
        // Worker with the switch off reports a LIVE loop that is skipping, not a dead one (round 9 verifier).
        // Awaited in place (one D1 write) rather than queued: the stamp must not become the last promise a harness
        // sees on the daily branch, and it must land before the log line that says the tick was skipped.
        if (fromCron) await taxCronStamp(env, trigger);
        console.log(JSON.stringify({ tax_tick: 'skipped', reason: 'stripe_tax_off' }));
      }
    };
    // ONE TRIGGER, TWO JOBS (2026-09-09). Workers Free allows FIVE CRON TRIGGERS PER ACCOUNT and this account is at that
    // ceiling: run #38 of Deploy MAST Worker uploaded this script and Cloudflare then refused the schedules with code
    // 10072, so the live Worker ran the new code on the OLD trigger set — the daily string alone, with the */5 tick never
    // registered. wrangler.toml therefore declares the one trigger the tax loop cannot live without, and the daily work
    // rides on it: a tick whose scheduledTime lands in the DAILY_WINDOW does the daily work as well. The scheduledTime
    // is the SCHEDULER's clock, not the Worker's, so a fire delivered late is still placed by the minute it was for;
    // Date.now() is the fallback for an event that carries no scheduledTime, which Cloudflare does not send but a test
    // and a hand-invoked handler both can.
    if (cron === TAX_TICK_CRON) {
      // Daily work first, tick second: the daily job is the established one, and the tick is the cheap idempotent one
      // that a failure above must not cost. Each keeps its own catch, and the liveness stamp still belongs to the tick.
      if (inDailyWindow(firedAt) && await claimDailyRun(env, firedAt)) await runDailyWork(event, env, ctx).catch((e) => console.error('[Daily] work failed:', e.message));
      await tick('tax-cron', true);
      return;
    }
    if (cron !== DAILY_CRON) {
      console.log(JSON.stringify({ unknown_cron: cron }));
      await tick('unknown-cron', false);
      return;
    }
    // The daily string still does the daily work, and it takes the SAME once-a-day claim as the window path above — so
    // restoring the daily trigger on a paid plan adds a second fire, not a second run of the work.
    if (await claimDailyRun(env, firedAt)) await runDailyWork(event, env, ctx).catch((e) => console.error('[Daily] work failed:', e.message));
    // Stripe Tax repairs itself here rather than in CI. Every run reads the cached measurement and, when the switch is on
    // and that cache is stale or says the account is not collecting, measures and runs the idempotent setup — so a Worker
    // deployed with STRIPE_TAX = "1" onto an account that was never set up converges on its own, with no repository secret
    // and nobody's attention. The */5 tick is what keeps the measurement WARM; this daily run does the same work and is
    // the backstop if that trigger ever stops firing. Both are where the Stripe calls belong: off the customer's path
    // entirely. A checkout can only ENQUEUE the same work behind its response.
    await tick('cron', true);
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
   its email — after a 6-digit code emailed to that address comes back.

   THERE IS NO ACCOUNT UNTIL THERE IS A VERIFIED ONE (round 5, 2026-09-09). /account/register writes a pending_signups
   row and nothing else; handleAccountVerify is what INSERTs the accounts row, in one batch, and only when no row for the
   address exists yet. Two findings die on that one change, and both had survived three rounds of patching the symptoms:

     the squat takeover  a stranger signed up victim@, their password landed on the accounts row, and round 3's "a
                         sign-up never overwrites an existing row" then PROTECTED it — the owner entered the code from
                         their own mailbox and the account came up holding the stranger's password. Rounds 5 and 6 moved
                         the same contest onto the pending row and kept losing it, because ONE ROW PER ADDRESS is a slot
                         and a slot can be taken, held and renewed. ROUND 7 REMOVES THE SLOT: a row per SIGN-UP, and
                         /account/verify takes the code AND the password that sign-up was made with, so the credentials
                         that become an account are always the ones whose own code came back. A stranger's row is inert
                         to the owner and the owner's is unreachable to the stranger.
     register→login      an address that had started a sign-up had an accounts row, so /account/login answered 403
                         'unverified' for it and 401 for an address with nothing — a one-request existence oracle. A
                         pending sign-up is not an accounts row, so it answers the 401 an absent address answers, on the
                         same statements. The 403 branch is gone from /account/login entirely.

   The pending row is keyed on a DIGEST of the address and holds no plaintext address; it is dropped when the account is
   created and by the daily cron after a day. The same code mechanism carries the forgotten-password path (P2). Codes: 6 digits, 15 minutes, one at a time per
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
/** A well-formed hash of nothing: what the absent branches verify against so a missing row costs the same PBKDF2. */
const DUMMY_PASSWORD_HASH = 'pbkdf2-sha256$' + PBKDF2_ITER + '$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
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
 *
 * TRUE HERE ALL ALONG, AND FALSE NEXT DOOR FOR THE WHOLE OF ROUND 5 (round 6, 2026-09-09). This function is the
 * ACCOUNTS path and /account/forgot is now its only caller; sign-ups moved to pending_signups, where the write bound
 * verify_attempts to a literal 0 and /account/register reset it on every unauthenticated call. The primitive described
 * above was therefore alive on the new path while this comment, and five documents quoting it, said it was closed. A
 * pending row still starts at 0 (it is a new row, not a reset one), and the counter the burn reads is MAX across the
 * live rows at the address — so opening a sign-up cannot lower it (round 7).
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
/* ─────────────────────────── Pending sign-ups ───────────────────────────
   A sign-up nobody has proved yet. It is NOT an account: /account/login cannot see it, /account/me cannot reach it, and
   the classes booked under the address stay invisible until a code from that mailbox comes back and handleAccountVerify
   creates the accounts row.

   ONE ROW PER SIGN-UP, NOT ONE PER ADDRESS (security review round 7, 2026-09-09). Rounds 5 and 6 gave the address a
   single row, and six rounds of review each closed one way of contesting it and opened the next: whoever held the row
   held the address, so the whole surface reduced to a race for a slot. Round 5 let the LAST writer win (a stranger took
   a sign-up in flight); round 6 let the FIRST writer win and gated the replace on the code's age, which made the slot a
   HOLD — and /account/resend renewed that hold every sixty seconds, so a stranger squatted an address indefinitely and
   the only live code in the owner's mailbox was always bound to the stranger's password.

   THERE IS NO SLOT NOW. The primary key is a random signup_id, the address is an ordinary indexed column, and a sign-up
   only ever INSERTS its own row. A stranger can create rows at any address the mail budgets let them mail; none of them
   touches the owner's, none of them delays the owner's, and there is nothing left to renew. Verification takes the
   triple {email, code, password}: the row is found by (address_digest, code_hash) and the account is created only if
   the password on that row also matches, so an owner who receives a stranger's code cannot complete the stranger's
   sign-up (the password is not theirs) and a stranger cannot complete the owner's (the code is not theirs).

   Keyed on the SHA-256 digest of the normalised address, never the address, so a table of half-finished sign-ups is not
   a list of who has typed what. The code lives on the row under the same HMAC as an account's, bound to the digest.

   The rows for an address are dropped when the account is created, dropped together when twenty wrong codes burn them,
   and purged by the daily cron after a day. */
const PENDING_ABSENT = 'absent';   // 'absent' is not a 64-hex digest, so no address can ever key this row
/** A random 128-bit primary key. Two sign-ups at one address are two rows; nothing about one is reachable from the other. */
function newSignupId() {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
}
/**
 * The one statement /account/register writes, on every branch.
 *
 * INSERT OR REPLACE and never an upsert on the address (round 7): the key is a fresh signup_id, so the REPLACE half can
 * only ever fire on the branch that mails nothing, which binds the constant PENDING_ABSENT and therefore rewrites one
 * row of nothing rather than growing the table. A sign-up that mails never touches a row that already exists — that
 * capability is the whole of what rounds 5 and 6 were trying to gate, and it is gone rather than gated.
 */
const PENDING_INSERT = 'INSERT OR REPLACE INTO pending_signups (signup_id, address_digest, password_hash, name, phone, organization, code_hash, verify_expires_at, verify_attempts, created_at, created_ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)';
/** The one statement /account/resend writes, on every branch. It names a signup_id, so it can only ever move the row it found. */
const PENDING_ISSUE = 'UPDATE pending_signups SET code_hash = ?, verify_expires_at = ? WHERE signup_id = ?';
/** The row /account/resend may re-mail: the newest sign-up at the address, whoever made it. The IP test is in the route. */
const PENDING_NEWEST = 'SELECT * FROM pending_signups WHERE address_digest = ? ORDER BY created_at DESC, rowid DESC LIMIT 1';
/**
 * The lookup /account/verify makes: ONE indexed read that returns at most one row however many sign-ups are waiting at
 * the address, which is what keeps the route's statement count independent of them. Two live rows can only collide here
 * by carrying the SAME six digits — one chance in a million — and the newest wins (rowid breaks a same-millisecond
 * tie the way an insertion order does); the password decides after that, so a collision refuses rather than crosses the
 * two sign-ups over.
 */
const PENDING_BY_CODE = 'SELECT * FROM pending_signups WHERE address_digest = ? AND code_hash = ? AND verify_expires_at > ? ORDER BY created_at DESC, rowid DESC LIMIT 1';
/**
 * The guess counter, claimed FIRST and across every live row at the address, so concurrent guesses cannot share a count
 * and a stranger cannot reset the twenty-try burn by opening a new sign-up — a row created later starts at 0, and MAX
 * below ignores it. One statement whatever the address holds: it bumps three rows, or one, or none.
 */
const PENDING_CLAIM = 'UPDATE pending_signups SET verify_attempts = verify_attempts + 1 WHERE address_digest = ? AND verify_expires_at > ? AND verify_attempts < ?';
const PENDING_SPENT = 'SELECT MAX(verify_attempts) AS used FROM pending_signups WHERE address_digest = ? AND verify_expires_at > ?';
/**
 * The burn: twenty wrong codes at an address end every sign-up waiting there, and the owner is emailed once.
 *
 * `AND ? >= ?` LOOKS ODD AND IS THE POINT (round 7). The statement runs on EVERY refused verification, at every address,
 * and the binds decide whether it deletes anything: an address with nothing has used = 0, so the predicate is false and
 * the statement changes nothing. Round 6 ran the burn only when it was due, which spent one statement on the twentieth
 * guess at a real address and none at an invented one — an existence classifier at the twentieth request, measured by
 * the round-6 review (10 x19 then 11, against 10 x20). Whoever's DELETE removes rows is the request that burned, so
 * exactly one racing guess sends the notice.
 */
const PENDING_BURN = 'DELETE FROM pending_signups WHERE address_digest = ? AND ? >= ?';
/** The verified sign-up's own row, and then every other sign-up waiting at the address. Both inside the create batch. */
const PENDING_DROP = 'DELETE FROM pending_signups WHERE signup_id = ?';
const PENDING_DROP_OTHERS = 'DELETE FROM pending_signups WHERE address_digest = ? AND signup_id <> ?';
/** The code on a pending row: HMAC(ACCOUNT_SECRET, digest:verify:code), the same shape an account's code carries. */
async function pendingCodeHash(env, digest, code) {
  return await codeHash(env, { id: digest }, 'verify', String(code || '').replace(/\D/g, ''));
}
/**
 * ONE verification attempt: five statements and exactly one PBKDF2, whatever the address is and whatever it holds.
 *
 * Every statement is keyed on the caller's own digest and runs unconditionally, so a brand-new address, an address with
 * one sign-up waiting, an address with three, and an address that already has an account all cost the same — there is
 * no absent twin to keep in step because there is no absent branch. `blocked` is an address that already has an
 * account: the statements still run, the row is discarded, and the answer is the one a wrong code gets.
 *
 * The PBKDF2 runs against DUMMY_PASSWORD_HASH when no row matched, so the cost of a wrong code and the cost of a wrong
 * password are the same cost, and neither says whether a sign-up exists.
 */
async function pendingVerify(env, digest, code, password, blocked) {
  const now = new Date().toISOString();
  await env.DB.prepare(PENDING_CLAIM).bind(digest, now, CODE_MAX_TRIES).run().catch(() => {});
  const spent = await env.DB.prepare(PENDING_SPENT).bind(digest, now).first().catch(() => null);
  const used = Number((spent && spent.used) || 0);
  const hash = await pendingCodeHash(env, digest, code);
  const found = await env.DB.prepare(PENDING_BY_CODE).bind(digest, hash, now).first().catch(() => null);
  const row = blocked ? null : found;
  const okPw = await verifyPassword(password, row ? row.password_hash : DUMMY_PASSWORD_HASH);
  if (row && okPw) return { r: 'ok', row };
  const burn = await env.DB.prepare(PENDING_BURN).bind(digest, used, CODE_MAX_TRIES).run().catch(() => null);
  return { r: burn && burn.meta && burn.meta.changes ? 'burned' : 'wrong', row: null };
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
  return await guardedCode(request, env, ctx, id, email, kind, acct, () => (acct ? checkCode(env, acct, kind, code) : dummyCheckCode(env, kind, code)));
}
/**
 * The same per-connection cap in front of a PENDING sign-up's verification, and the owner's burn notice behind it.
 *
 * The counter id is the address either way (round 5): a stranger who spends five guesses at an address must not get
 * five more the moment a sign-up row appears there, and the row appearing is something they can cause themselves with
 * one /account/register.
 *
 * It no longer shares guardedCode with the accounts path (round 7). That function decides the notice from whether a row
 * was found, and a pending verification does not find a row when the password is wrong — the notice is owed to the
 * address whenever the twenty tries are actually spent, which is what the burn statement itself reports.
 */
async function guardedPendingVerify(request, env, ctx, { email, digest, code, password, blocked }) {
  const ip = clientIp(request);
  const id = await pendingGuessId(email);
  if ((await codeGuessesSpent(env, ip, id)) >= CODE_GUESSES_PER_IP) return { r: 'wrong', row: null };
  const out = await pendingVerify(env, digest, code, password, blocked);
  if (out.r === 'ok') { await clearCodeGuesses(env, id); return out; }
  await noteCodeGuess(env, ip, id);
  if (out.r === 'burned') {
    const send = notifyCodeBurned(env, { email }, 'verify').catch((e) => console.error('[Account] burn notice failed:', e.message));
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(send);
  }
  return out;
}
/** The cap, the run, and the burn notice — shared by the account and pending paths so neither can drift from the other. */
async function guardedCode(request, env, ctx, id, email, kind, owner, run) {
  const ip = clientIp(request);
  if ((await codeGuessesSpent(env, ip, id)) >= CODE_GUESSES_PER_IP) return 'wrong';
  const r = await run();
  if (r === 'ok') { await clearCodeGuesses(env, id); return r; }
  await noteCodeGuess(env, ip, id);
  const acct = owner;
  if (r === 'burned' && acct) {
    // The owner is told, and the throttle on their own next request is lifted with it: a burn they did not cause must
    // not also cost them the minute codeTooSoon() would hold the replacement for. This is the ACCOUNTS path only now —
    // the pending path has no throttle column left to clear, because round 7 gave it no hold to be throttled out of.
    if (acct.id) { await env.DB.prepare('UPDATE accounts SET verify_sent_at = ? WHERE id = ?').bind(null, acct.id).run().catch(() => {}); acct.verify_sent_at = null; }
    const send = notifyCodeBurned(env, acct, kind).catch((e) => console.error('[Account] burn notice failed:', e.message));
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(send);
  }
  return r;
}
/**
 * The owner of an address whose live code was invalidated by repeated wrong guesses. Never says who, or from where.
 *
 * OUTSIDE noteCodeMail, DELIBERATELY, AND BOUNDED BY CONSTRUCTION (security review round 6, 2026-09-09). Metering it
 * would put six budget statements on the burning request and nowhere else, which is a statement-count tell on a route
 * whose whole design is that every wrong code costs the same; and a security notice the owner should always get is the
 * wrong thing to let an attacker suppress by pre-spending a connection's allowance. The ceiling is bounded anyway:
 * burnCode is conditional on `verify_code_hash IS NOT NULL` and PENDING_BURN reports the rows it actually removed, so
 * exactly ONE burn fires per live code, and a live code exists only because a mail passed noteCodeMail. Burn notices <=
 * code mails, so the per-mailbox ceiling in README is 2x the code-mail figures rather than 1x. Stated there, not
 * claimed away.
 */
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
 * The mail budgets are spent per (connection, address) and per connection (round 5), and they are spent ONLY when this
 * request is actually going to send: `sending` is decided from state already read, so an over-budget or throttled call
 * runs the identical statements, takes no allowance and looks the same from outside — same 200, same statement count,
 * no mail. A stranger can spend their own three an hour at any mailbox and nobody else's.
 *
 * /account/forgot is its only caller now. /account/register and /account/resend write pending_signups instead, under
 * the same budgets; the sign-in path that used to reach this went with the 403 'unverified' answer.
 */
async function mailCodeAside(env, ctx, acct, kind, opts = {}) {
  const sending = !!acct && !codeTooSoon(acct);
  const mayMail = await noteCodeMail(env, opts.ip, opts.email, sending);
  if (!sending || !mayMail) { await dummyIssue(env, kind); return; }
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

async function handleAccountRegister(request, env, ctx, cors) {
  const off = accountsOff(env, cors) || signupOff(env, cors); if (off) return off;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return json({ error: 'Bad request' }, 400, cors);
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!isEmail(email)) return json({ error: 'Enter a valid email address.', field: 'email' }, 400, cors);
  if (password.length < 10) return json({ error: 'Use a password of at least 10 characters.', field: 'password' }, 400, cors);
  if (password.length > 200) return json({ error: 'That password is too long.', field: 'password' }, 400, cors);
  const ip = clientIp(request), digest = await addressDigest(email), now = new Date().toISOString();
  // ONE read and exactly ONE write on every branch, so a brand-new address, an address with sign-ups already waiting
  // and an address with an account all cost the same (round 4 measured 6 / 5 / 5 here — the INSERT was the tell).
  //
  // THE PENDING READ IS GONE (round 7) and its absence is the fix, not an optimisation: this route used to read the
  // address's pending row in order to decide whether it was ALLOWED to write one. That decision — the replace gate —
  // is what made a single row per address a slot strangers could contest, and every takeover of rounds 5 and 6 lived
  // in it. A sign-up now inserts its own row unconditionally, so there is nothing to gate and nothing to read.
  const existing = await accountByEmail(env, email);
  const name = str(body.name).trim().slice(0, 120), phone = str(body.phone).replace(/[^\d+()\-.\s]/g, '').trim().slice(0, 40), organization = str(body.organization).trim().slice(0, 120);
  // Hashed on every branch, so the answer costs the same time as well as the same statements. The code and its HMAC are
  // computed on every branch too (round 7) — the branch that mails nothing binds them away rather than skipping them.
  const hash = await hashPassword(password);
  const code = newCode();
  const issued = await pendingCodeHash(env, digest, code);
  // An address that already has an account answers exactly what a brand-new one answers — same status, same body
  // (security review 2026-09-08: the old 409 'exists' turned this route into an address checker, and the 429 'too_soon'
  // did the same job one step later). Nothing on the account changes; the person who actually owns the address is told
  // that someone tried, and can sign in or reset.
  //
  // A NEW SIGN-UP IS NEVER REFUSED ON ACCOUNT OF ANOTHER ONE (round 7). There is no pendingHeld() and no
  // pendingTooSoon() on this route: whoever posts the address gets their own row and their own code, inside their own
  // mail budgets. That is what removes the delay a stranger could impose on the owner AND the hold a stranger could
  // renew — neither is gated better, both are gone.
  const sending = existing ? !noticeTooSoon(existing) : true;
  // The SAME budgets /account/forgot and /account/resend spend, and the same rule about when a slot is taken (round 5).
  // Round 4 left this route outside them entirely, so the ceiling it was written to lower — a mail a minute at any
  // mailbox on earth — was unmoved: twelve connections still delivered twelve emails to one address. They are also the
  // ONLY bound on how many pending rows an address can hold, which is deliberate: a stranger's rows cost a stranger's
  // mails and reach nothing of the owner's.
  const mayMail = await noteCodeMail(env, ip, email, sending);
  const mail = sending && mayMail;
  if (existing) {
    // signup_notice_sent_at, NEVER verify_sent_at (security review round 2, 2026-09-08). Writing the shared column here
    // let a stranger's sign-up attempt against a verified address suppress that address's OWN /account/forgot and
    // /account/resend for the next minute — 200 with no mail — which held the reset shut and closed the documented way
    // out of a sign-in lockout. Stamped before the send, like issueCode, so a refusing mail provider is not a mail storm.
    // The statement runs either way and rewrites the stamp it already carries when nothing is being sent.
    await env.DB.prepare('UPDATE accounts SET signup_notice_sent_at = ? WHERE id = ?').bind(mail ? now : (existing.signup_notice_sent_at || null), existing.id).run().catch(() => {});
    if (mail) {
      existing.signup_notice_sent_at = now;
      const send = notifySignupAttempt(env, existing).catch((e) => console.error('[Account] sign-up notice failed:', e.message));
      if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(send);
    }
    return json(signupPending(email), 202, cors);
  }
  // NO ACCOUNT ROW IS WRITTEN HERE (round 5, 2026-09-09). A sign-up is a pending_signups row and nothing else, so a
  // stranger cannot leave credentials sitting inside an account the owner later verifies, and /account/login answers an
  // address that has only started a sign-up exactly what it answers an address that has nothing.
  //
  // The row is this sign-up's own, keyed on a random signup_id (round 7). The branch that mails nothing binds the
  // constant PENDING_ABSENT, so it rewrites one row of nothing: same statement, same count, no row an address can find.
  const wrote = await env.DB.prepare(PENDING_INSERT).bind(
    mail ? newSignupId() : PENDING_ABSENT,
    mail ? digest : PENDING_ABSENT,
    mail ? hash : DUMMY_PASSWORD_HASH,
    mail ? name : '', mail ? phone : '', mail ? organization : '',
    mail ? issued : null,
    mail ? new Date(Date.now() + CODE_TTL_MS).toISOString() : null,
    now, mail ? ip : '',
  ).run().catch((e) => { console.error('[Account] pending sign-up write failed:', e.message); return null; });
  // A FAILED WRITE IS A REFUSAL, NEVER A 202 WITH A CODE IN IT (round 8, 2026-09-09). The result used to be swallowed by
  // the .catch above and the send ran anyway, so a database that could not take the row still mailed six digits — and the
  // person entering them met the one 401 bad_code every wrong guess gets, with nothing on the page to tell them the
  // sign-up never existed. This says so instead. It reads a result that is 1 on EVERY branch when D1 is healthy (the
  // mailing branch inserts a fresh signup_id, the branch that mails nothing REPLACEs the PENDING_ABSENT constant), so the
  // answer does not depend on the address and the statement count does not move.
  if (!wrote || !wrote.meta || !wrote.meta.changes) return json({ error: 'Sign-up is temporarily unavailable. Please try again shortly.', code: 'signup_unavailable' }, 503, cors);
  if (mail) {
    // Handed to ctx.waitUntil like every other code send: a refusing mail provider is a log line, never a status code.
    // It used to answer 502 email_failed here, which told an unauthenticated caller that the mail leg had run at all.
    const send = sendCode(env, { email }, 'verify', code).catch((e) => console.error('[Account] code email failed:', e.message));
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(send);
  }
  return json(signupPending(email), 202, cors);
}

/** The one answer POST /account/register ever gives: brand-new address, sign-up already in progress, address with an account. */
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
  const password = String((body && body.password) || '');
  // THE OLD PAGE IS ANSWERED, NOT REFUSED (round 8, 2026-09-09). Round 7 changed this route's contract to {email, code,
  // password}; a copy of the page cached before that deploy posts {email, code} and met the one 401 bad_code, which reads
  // as "your code is wrong" and has no way forward — the visitor retypes the six digits from their mailbox until the
  // twenty-try burn takes their sign-up. A missing password is a request this Worker cannot act on rather than a guess it
  // refused, and saying which one it is costs nothing: this runs before the digest, before D1 and before any PBKDF2, and
  // it is decided by the request body alone, so it answers identically at every address and classifies none of them.
  if (!password) return json({ error: 'Please enter the password you chose when you created the account.', code: 'password_required' }, 400, cors);
  const digest = await addressDigest(email);
  // THIS is where an account is created (round 5, 2026-09-09). /account/register only writes a pending row, so the
  // credentials that become an account are the ones belonging to the code the mailbox actually received.
  //
  // IT TAKES THE TRIPLE — email, code AND the password the sign-up was made with (round 7, 2026-09-09). One row per
  // address made the code alone sufficient, and that is what every takeover of rounds 5 and 6 exploited: whoever owned
  // the row owned whatever the mailbox typed back. With a row per sign-up the code selects the row and the password
  // proves it is the caller's own. An owner who receives a stranger's code cannot complete the stranger's sign-up, and
  // a stranger who owns a row cannot complete the owner's. Neither can wait the other out, because neither is holding
  // anything the other needs.
  //
  // Unknown address, already-verified address, a wrong six digits and a wrong password all answer the same 401
  // bad_code, on the same statements and after the same single PBKDF2 (security review 2026-09-08: 400-vs-409, and the
  // tries_left field, each told a caller which addresses have accounts; round 2: answering 'expired' told them the
  // same thing, because no live code is the ordinary state). It answers 401 rather than round 6's 400 because the
  // request now carries a credential and a refusal is an authentication failure.
  const taken = await accountByEmail(env, email);
  // An address that already has an account is answered as if the rows were not there: nothing a stranger left behind
  // can be applied over an account that exists. The statements run all the same.
  const { r, row } = await guardedPendingVerify(request, env, ctx, { email, digest, code: body && body.code, password, blocked: !!taken });
  if (r !== 'ok') return json(badCode(), 401, cors);
  const now = new Date().toISOString();
  const acct = {
    id: 'acct_' + crypto.randomUUID(), email, password_hash: row.password_hash, token_version: 1,
    name: row.name || '', phone: row.phone || '', organization: row.organization || '',
    address1: '', address2: '', emergency_name: '', emergency_phone: '', emergency_relationship: '',
    stripe_customer_id: '', standards_passed: '[]', notes: '', created_at: now, updated_at: now, last_login_at: null,
    verified_at: now, verify_kind: null, verify_code_hash: null, verify_expires_at: null, verify_attempts: 0,
    verify_sent_at: null, signup_notice_sent_at: null, failed_logins: 0, locked_until: null,
  };
  // ONE batch, so the account, the disappearance of this sign-up and the disappearance of every OTHER sign-up waiting
  // at the address are the same act, and WHERE NOT EXISTS so the INSERT cannot land on an address that acquired an
  // account while this request was in flight. D1 runs a batch in order inside a single implicit transaction. The other
  // rows go because the address is settled: a code still sitting in the mailbox from somebody else's attempt is dead
  // the moment the account exists, and leaving it would leave a row nothing can ever complete.
  const res = await env.DB.batch([
    env.DB.prepare('INSERT INTO accounts (id, email, password_hash, token_version, name, phone, organization, address1, address2, emergency_name, emergency_phone, emergency_relationship, stripe_customer_id, standards_passed, notes, created_at, updated_at, last_login_at, verified_at, verify_kind, verify_code_hash, verify_expires_at, verify_attempts, verify_sent_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE email = ?)')
      .bind(acct.id, acct.email, acct.password_hash, 1, acct.name, acct.phone, acct.organization, '', '', '', '', '', '', '[]', '', now, now, null, now, null, null, null, 0, null, email),
    env.DB.prepare(PENDING_DROP).bind(row.signup_id),
    env.DB.prepare(PENDING_DROP_OTHERS).bind(digest, row.signup_id),
  ]);
  const made = !!(res && res[0] && res[0].meta && res[0].meta.changes);
  if (!made) return json(badCode(), 401, cors);
  return await signedIn(env, acct, cors);
}

async function handleAccountResend(request, env, ctx, cors) {
  const off = accountsOff(env, cors) || signupOff(env, cors); if (off) return off;
  const body = await request.json().catch(() => null);
  const email = String((body && body.email) || '').trim().toLowerCase();
  const ip = clientIp(request), digest = await addressDigest(email);
  // ONE answer, ONE statement count, and the mail leg outside the response entirely: unknown address, address with an
  // account already, and a request that mails nothing are indistinguishable in body, status AND time. The route used to
  // await Resend only when the account existed, and to answer 502 when Resend refused it — a one-request oracle either
  // way round (security review round 3, 2026-09-08).
  //
  // IT RENEWS NOTHING OF ANYBODY ELSE'S (round 7, 2026-09-09). This route is unauthenticated: it cannot be told which
  // of the sign-ups waiting at an address is the caller's, and round 6 answered that by re-mailing whatever row the
  // address held — which re-stamped the column /account/register read as its replace gate, so a stranger renewed a hold
  // on the address every sixty seconds and the owner never got the row back. Measured at six hours and 51 refused
  // owner attempts by the round-6 review.
  //
  // The rule now is the narrow one that can be checked without a credential: re-mail the NEWEST sign-up at the address
  // only if it was created from THIS connection and its code has not run out. Anything else — no rows, somebody else's
  // row, an expired one, an address with an account — runs the same statements, takes no allowance and mails nothing.
  // There is no hold to renew in any case: a caller who is refused here can simply sign up again and get their own row.
  const taken = await accountByEmail(env, email);
  const newest = await env.DB.prepare(PENDING_NEWEST).bind(digest).first().catch(() => null);
  const now = new Date().toISOString();
  const sending = !!newest && !taken && newest.created_ip === ip && !!newest.verify_expires_at && newest.verify_expires_at > now;
  const mayMail = await noteCodeMail(env, ip, email, sending);
  const mail = sending && mayMail;
  const code = newCode();
  const issued = await pendingCodeHash(env, digest, code);
  // The same statement on every branch; the branch that mails nothing binds a signup_id no sign-up carries.
  await env.DB.prepare(PENDING_ISSUE).bind(
    mail ? issued : null,
    mail ? new Date(Date.now() + CODE_TTL_MS).toISOString() : null,
    mail ? newest.signup_id : PENDING_ABSENT,
  ).run().catch((e) => console.error('[Account] code reissue failed:', e.message));
  if (mail) {
    const send = sendCode(env, { email }, 'verify', code).catch((e) => console.error('[Account] code email failed:', e.message));
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(send);
  }
  return json({ ok: true }, 200, cors);
}

async function handleAccountLogin(request, env, ctx, cors) {
  const off = accountsOff(env, cors); if (off) return off;
  const body = await request.json().catch(() => null);
  const email = String((body && body.email) || '').trim().toLowerCase();
  const password = String((body && body.password) || '');
  const acct = await accountByEmail(env, email);
  const ip = clientIp(request);
  // Both counters are read, and an address with NO account locks on the same attempt as one that has an account
  // (security review round 2, 2026-09-08). Before that the sixth wrong password answered 429 'locked' for a real address
  // and 401 for an invented one, so five throwaway guesses bought a definitive yes-or-no on any address — cheaper than
  // the twenty-per-window sign-in limit was ever meant to allow.
  //
  // A LOCK IS ANSWERED AS A WRONG PASSWORD (security review round 6, 2026-09-09). It used to answer `429 locked` and to
  // do it BEFORE any PBKDF2, which saved the CPU and cost the whole round-2 property at six requests instead of one:
  // the per-account lock is GLOBAL, so five wrong passwords from any five connections made the sixth answer 429 in 5
  // statements and 0.7 ms where an absent address and an address with only a pending sign-up both answered 401 in 10
  // statements and 45.7 ms — a three-way classifier on status, statement count and time. The lock now runs the dummy
  // hash and the same statements the absent path runs and answers the same 401 body; what it still does — the whole of
  // what a lock is for — is refuse a CORRECT password while it holds.
  const locked = Math.max(lockedFor(acct), await identityLockedFor(env, ip, email));
  // The same hashing work runs whether or not the account exists, so timing does not reveal which emails have accounts;
  // a locked account is compared against the dummy rather than against its own hash, because the answer cannot depend
  // on the result and comparing would only be work with a branch attached to it.
  const okPw = acct && !locked ? await verifyPassword(password, acct.password_hash) : (await verifyPassword(password, DUMMY_PASSWORD_HASH), false);
  if (!okPw) {
    // The failing attempt itself always answers 401; the lock it may have just set shows on the next one, so the fifth
    // wrong password does not announce that the address exists. The (IP, address) counter is bumped whether or not the
    // address has an account — that is what makes the sixth attempt symmetric.
    //
    // And the per-ACCOUNT counter costs the same on both branches (security review round 4, 2026-09-08). noteFailedLogin
    // ran only `if (acct)`, so a wrong password at a real address spent two statements an invented one did not, and
    // three on the try where the lock is written. The twin runs the same statements against an id no row carries,
    // laddered on the (IP, address) count — the only failure count an address with no account has.
    //
    // A LOCKED account takes the absent branch here, so its refusal spends exactly what an invented address spends and
    // the ladder is not driven further by requests the lock is already refusing (round 6): a guesser who keeps typing
    // at a locked account cannot walk the per-account lock up to its 24-hour cap, which answering the failure path
    // would have let them do.
    const failures = await noteFailedIdentity(env, ip, email);
    if (acct && !locked) await noteFailedLogin(env, acct);
    else await dummyFailedLogin(env, ABSENT_ID, failures);
    return json({ error: 'That email and password do not match.', code: 'bad_login' }, 401, cors);
  }
  // The right password clears the pair, whether or not the email has been verified yet — and, since round 4, the code
  // guesses spent against this account: a reissue no longer clears them, so the owner proving the password is what
  // un-refuses a connection that typed its way to five wrong codes. A stranger cannot reach this line.
  await clearFailedIdentity(env, ip, email);
  await clearCodeGuesses(env, acct.id);
  // THE 403 'unverified' ANSWER IS GONE (round 5, 2026-09-09). It was the second half of the register→login oracle: an
  // address someone had started a sign-up on answered 403 where an address with nothing answered 401, so one request
  // classified any address. There is nothing left for it to say — an accounts row is created only by a verified code,
  // so every row this line can reach is verified. The guard below is for a row written before migrations/010 ran; it
  // answers the same 401 a wrong password answers, and after that migration nothing can reach it.
  if (!acct.verified_at) return json({ error: 'That email and password do not match.', code: 'bad_login' }, 401, cors);
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
  // The mail budgets are per (connection, address) and per connection (round 5). Round 4's single per-ADDRESS counter
  // made THIS route closable by a stranger: three unauthenticated requests an hour, from any three connections, and the
  // owner's own reset answered 200 with no mail — the escape hatch out of a sign-in lock, held shut from outside.
  await mailCodeAside(env, ctx, acct, 'reset', { email, ip: clientIp(request) });
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
    // Fire-and-forget, but not unbounded: through checkoutCall it carries the pin, the AbortController and the
    // checkout ceiling like every other Stripe call, and the id is capped before it is interpolated into a path.
    checkoutCall(env, '/customers/' + encodeURIComponent(capText(acct.stripe_customer_id, 255)),
      { method: 'POST', headers: stripeHeaders(env), body: new URLSearchParams({ name: acct.name || '', phone: acct.phone || '' }).toString() }).catch(() => {});
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

/**
 * THE API VERSION IS A PIN, NOT A DEFAULT. Every request this Worker makes carries Stripe-Version, so the shapes the
 * validators in the tax module check are the shapes of ONE NAMED VERSION rather than whatever the account's default has
 * drifted to. Without the header, Stripe moving the account default is an invisible change to every response this code
 * reads — and API-version drift is exactly what a renamed field looks like from in here, which is the failure the row
 * validator exists to catch. Pinned, drift becomes a deliberate edit to this line with a test run behind it.
 *
 * UNVERIFIABLE FROM HERE, said plainly: NO Stripe version is recorded anywhere in this repository — no `stripe` SDK
 * dependency, nothing in package.json, README.md, wrangler.toml or any comment (grepped, not recalled) — and this
 * container cannot reach Stripe to read the changelog. The literal below is therefore a CHOICE, not a measurement: a
 * version that supports every parameter this Worker sends (automatic_tax, price_data, product_data[tax_code],
 * country_options[us][type], head_office) and every field it reads back. The first live call is what confirms it.
 *
 * The override is clamped to the SHAPE of a version string, for the reason the timeouts are clamped: a typo here is not
 * a slow checkout, it is Stripe refusing every call including the Checkout Session, so anything that is not
 * version-shaped falls back to the pin instead of being sent.
 *
 * IT DOES NOT COVER THE WEBHOOK. A request header governs the answers to THIS Worker's requests; an event Stripe
 * delivers carries the version configured on the endpoint. handleWebhook therefore types and bounds every field it
 * takes off the Session at the point it reads it, rather than inheriting a guarantee this line does not give it.
 */
const STRIPE_API_VERSION = '2024-06-20';
export function stripeApiVersion(env) {
  const v = env && env.STRIPE_API_VERSION;
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}(?:\.[a-z]+)?$/.test(v) ? v : STRIPE_API_VERSION;
}

function stripeHeaders(env) { return { Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY, 'Content-Type': 'application/x-www-form-urlencoded', 'Stripe-Version': stripeApiVersion(env) }; }
async function ensureStripeCustomer(env, acct) {
  if (acct.stripe_customer_id) return acct.stripe_customer_id;
  if (!env.STRIPE_SECRET_KEY) throw new Error('Payments are not configured.');
  const res = await checkoutCall(env, '/customers', { method: 'POST', headers: stripeHeaders(env),
    body: new URLSearchParams({ email: acct.email, name: acct.name || '', phone: acct.phone || '', 'metadata[account_id]': acct.id, 'metadata[source]': 'mastsolutions' }).toString() });
  const data = res.data || {};
  if (!res.ok || typeof data.id !== 'string' || !data.id) throw new Error('Stripe customer: ' + taxSafe(env, (data.error && data.error.message) || res.status, 120));
  const cusId = capText(data.id, 255);
  await env.DB.prepare('UPDATE accounts SET stripe_customer_id = ?, updated_at = ? WHERE id = ?').bind(cusId, new Date().toISOString(), acct.id).run();
  acct.stripe_customer_id = cusId;
  return cusId;
}
async function stripeDefaultCard(env, customerId) {
  if (!env.STRIPE_SECRET_KEY) return null;
  const res = await checkoutCall(env, '/customers/' + encodeURIComponent(customerId) + '?expand[]=invoice_settings.default_payment_method', { headers: { Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY } });   // pinned in boundedStripe
  const data = res.data || {};
  const pm = data && data.invoice_settings && data.invoice_settings.default_payment_method;
  if (!pm || typeof pm !== 'object') return null;
  const card = pm.card || {};
  // Four Stripe-controlled fields on their way to a browser: two short strings and two numbers, typed and capped as
  // such. 'visa' and '4242' are what these are; nothing here is free text and nothing here is unbounded.
  return { brand: capText(card.brand || pm.type || 'card', 32), last4: capText(card.last4 || '', 4),
    exp_month: Number.isFinite(Number(card.exp_month)) ? Number(card.exp_month) : null,
    exp_year: Number.isFinite(Number(card.exp_year)) ? Number(card.exp_year) : null };
}
async function handleAccountSetupPayment(request, env, ctx, cors) {
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
  return await createSession(payload, env, cors, 'AccountCard', ctx);
}
/** Both ids here come off a WEBHOOK EVENT — the one Stripe surface the version pin does not govern — and both are
 *  interpolated straight into a request path, so both are capped before they get there. These were the last two raw
 *  `fetch` calls to api.stripe.com in the file: no clock, no pin on the second, and a Stripe that merely HUNG held a
 *  ctx.waitUntil open for the whole isolate lifetime. Both are on the checkout ceiling now, through the one bounded
 *  path every other Stripe call in this Worker takes. */
async function setDefaultCardFromSetup(env, session) {
  if (!env.STRIPE_SECRET_KEY || !session.setup_intent || !session.customer) return;
  const siId = capText(typeof session.setup_intent === 'string' ? session.setup_intent : session.setup_intent.id, 255);
  const cusId = capText(typeof session.customer === 'string' ? session.customer : session.customer.id, 255);
  if (!siId || !cusId) return;
  const read = await checkoutCall(env, '/setup_intents/' + encodeURIComponent(siId), { headers: { Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY } });
  const si = read.data || {};
  const pm = capText(typeof si.payment_method === 'string' ? si.payment_method : si.payment_method && si.payment_method.id, 255);
  if (!pm) return;
  await checkoutCall(env, '/customers/' + encodeURIComponent(cusId), { method: 'POST', headers: stripeHeaders(env), body: new URLSearchParams({ 'invoice_settings[default_payment_method]': pm }).toString() });
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

async function handleBooking(request, env, ctx, cors) {
  const body = await request.json().catch(() => null);
  if (!body || !body.sku || !body.customer_email) {
    return json({ error: 'Missing required fields: sku, customer_email' }, 400, cors);
  }
  if (!isEmail(body.customer_email)) {
    return json({ error: 'Invalid email address' }, 400, cors);
  }
  // What was VALIDATED is what is SENT. isEmail trims before it tests, so a body of " a@b.com " passed the check and
  // then went to Stripe with its whitespace on — a different string from the one that was approved. The register and
  // contact paths already normalise into a local before validating; these two checked a copy and sent the original.
  const email = String(body.customer_email).trim();

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
    customer_email: email,
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
  await applyTax(payload, env, ctx);
  return await createSession(payload, env, cors, 'Booking', ctx);
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
  await applyTax(payload, env, ctx);
  const result = await createStripeSession(payload, env, 'Register', ctx);
  if (!result.ok) return json({ error: result.error }, result.status, cors);
  await updateRegistration(env, id, { stripe_session_id: capText(result.session.id, 255) }).catch((e) =>
    console.error('[Register] session id write failed:', e.message)
  );
  return json({ checkoutUrl: result.session.url, sessionId: capText(result.session.id, 255), registration_id: id }, 200, cors);
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
 *
 * BOTH CALLS ARE ON THE SAME CLOCK AS THE TAX PATH (stripeCall, taxTimeoutMs). A hung /v1/prices held a membership join
 * open for as long as Stripe cared to hold it — measured at 3.1s against a 3s stub, unbounded in principle. A timed-out
 * call returns status 0 like any refusal, so the join answers the same clean 400 it already answers for a plan with no
 * price rather than hanging. This was NOT the only unbounded customer-blocking call, which is what the comment here
 * used to claim: the Checkout Session create, the Customer create and the saved-card read were all raw fetch until
 * round 5 put them on checkoutTimeoutMs. It was the only one the round-4 review had measured.
 */
async function ensureMembershipPrice(env, row) {
  if (!env.STRIPE_SECRET_KEY || !row || !row.price_cents) return null;
  const lookupKey = 'mast_' + row.plan_key;
  let priceId = null;
  const found = await stripeCall(env, '/prices?active=true&limit=1&lookup_keys[]=' + encodeURIComponent(lookupKey));
  if (!found.ok) console.error('[Plan] Stripe price lookup failed:', taxSafe(env, (found.data && found.data.error && found.data.error.message) || ('status ' + found.status), 120));
  else if (found.data && Array.isArray(found.data.data) && found.data.data[0] && typeof found.data.data[0].id === 'string') priceId = capText(found.data.data[0].id, 255);
  if (!priceId) {
    const body = new URLSearchParams({
      currency: 'usd',
      unit_amount: String(row.price_cents),
      'recurring[interval]': row.interval || 'month',
      lookup_key: lookupKey,
      'product_data[name]': 'MAST Solutions Membership — ' + row.name,
      'metadata[plan_key]': row.plan_key,
    });
    // A Checkout Session cannot override the tax code of a saved Price, so a membership's code has to be set HERE, on the
    // Product, the one time the Price is created. BEHIND THE SAME GATE AS THE SESSION — the switch AND a cached
    // measurement saying the account is collecting — not the switch alone as it was through round 3. Sending a tax code
    // to an account with Stripe Tax inactive was the last tax field on a customer path that readiness did not govern,
    // and whether Stripe refuses it there was never verifiable from the build container. A Price created during a
    // not-ready window keeps whatever code Stripe defaults it to; README.md "Sales tax (Texas)" carries the migration.
    if (String(env.STRIPE_TAX) === '1' && (await taxReadyCached(env)).ready) body.set('product_data[tax_code]', TAX_CODE_SERVICES);
    const res = await stripeCall(env, '/prices', body);
    const created = res.data;
    if (!res.ok || !created || typeof created.id !== 'string' || !created.id) {
      console.error('[Plan] could not create the Stripe price for ' + row.plan_key + ':', taxSafe(env, JSON.stringify(created), 300));
      return null;
    }
    priceId = capText(created.id, 255);
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

async function handleMembership(request, env, ctx, cors) {
  const body = await request.json().catch(() => null);
  if (!body || !body.email || !body.plan) {
    return json({ error: 'Missing required fields: email, plan' }, 400, cors);
  }
  if (!isEmail(body.email)) {
    return json({ error: 'Invalid email address' }, 400, cors);
  }
  const email = String(body.email).trim();   // validated trimmed, so sent trimmed — see handleBooking

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
        reply_to: email,
        subject: 'Membership credential: ' + (str(body.customer_name).trim() || email) + ' · ' + plan.name,
        text: ['A ' + plan.name + ' membership application with credentials attached.', '', 'Name: ' + (str(body.customer_name).trim() || '—'), 'Email: ' + email, 'Plan: ' + plan.name + ' (' + plan.key + ')', 'Seats: ' + seats, '', 'The applicant continues to Stripe Checkout after this email. If the team declines the membership, refund it in Stripe.'].join('\n'),
        attachments: [{ filename: safeName, content: data.replace(/\s+/g, '') }],
      });
    } catch (e) {
      console.error('[Membership] credential email failed', e && e.message);
      return json({ error: 'We could not receive your credentials just now. Please email them to atlasglinn.hq@atlasglinn.com and try again.' }, 502, cors);
    }
    credentialNote = 'emailed ' + new Date().toISOString();
  }

  const payload = new URLSearchParams({
    customer_email: email,
    mode: 'subscription',
    'line_items[0][price]': plan.priceId,
    'line_items[0][quantity]': String(seats),
    success_url: safeUrl(body.successUrl, env) || defaultUrl(env, '?checkout=success'),
    cancel_url: safeUrl(body.cancelUrl, env) || defaultUrl(env, '?checkout=cancelled'),
    'subscription_data[metadata][kind]': 'membership',
    'subscription_data[metadata][email]': email,
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

  await applyTax(payload, env, ctx);
  return await createSession(payload, env, cors, 'Membership', ctx);
}


/**
 * Stripe Tax on one Checkout payload — or nothing at all.
 *
 * STRIPE IS NEVER CALLED HERE. This runs on the customer's blocking path, so it reads ONE D1 row (tax:ready, written
 * off-path by the cron, by /admin/tax/setup, or by the refresh a previous checkout enqueued) and nothing else. Round 2
 * measured the alternative and graded it P1: measuring on the path let ten anonymous requests drive eleven Stripe tax
 * POSTs and sixty-one GETs, with no dedupe and no ceiling, against the same rate budget the Checkout Session itself
 * needs — and a Stripe endpoint that merely HUNG held every checkout open behind it.
 *
 * TWO conditions, not one. STRIPE_TAX (wrangler.toml [vars]) is the switch the owner controls; the cached measurement
 * is what the account was last MEASURED doing. Both must hold before automatic_tax goes anywhere near a Session,
 * because Stripe refuses a session carrying automatic_tax when Tax is not active on the account — and a refused session
 * is a customer who cannot pay. A cache that is ABSENT or STALE is treated as not ready for THIS checkout: the cost is
 * one untaxed checkout after a quiet spell, and the alternative is a customer waiting on api.stripe.com.
 *
 * When either condition is missing the payload is returned untouched, so the body that reaches Stripe is byte-identical
 * to the pre-tax one (a test pins that exact string) and one structured line says why.
 *
 * A checkout that finds no fresh measurement ENQUEUES one behind ctx.waitUntil — it never waits for it and never fails
 * on it — and that refresh does nothing at all unless it can take the tax:lock row. So the whole of an anonymous burst
 * costs at most one measurement and one setup attempt per lock window (TAX_LOCK_MS, 60s), not one per request. A
 * checkout that HAS a fresh measurement saying not-ready enqueues nothing: the cron and the next stale window are what
 * retry, which is what stops a permanently unrepairable account from being retried forever.
 *
 * READY is last-known-ready (taxReadyCached): a measurement that said the account is collecting still counts for 24h
 * even once it is stale, so the five-minute trigger going quiet costs a day of grace rather than the next ten minutes
 * of orders. If that trust turns out to be wrong, Stripe says so when the Session is created and createStripeSession
 * retries once without the tax fields — the checkout completes either way.
 *
 * The tax code rides on the line item only where the price is built here (price_data). A saved Price carries its own
 * code from ensureMembershipPrice, because Stripe will not let a Session override a Price's product.
 *
 * customer_update[address] is required by Stripe whenever a Customer is attached: without it Checkout cannot write the
 * address it collects back onto the Customer, and tax has nothing to compute against. It is a no-op re-set on the
 * booking and registration paths, where applyAccountCustomer already sets it, and it is guarded because Stripe rejects
 * customer_update on a session with no customer.
 */
async function applyTax(payload, env, ctx, taxCode = TAX_CODE_SERVICES) {
  if (String(env.STRIPE_TAX) !== '1') {
    console.log(JSON.stringify({ tax_skipped: 'stripe_tax_off', ready: false }));
    return payload;
  }
  const state = await taxReadyCached(env);
  const refresh = () => {
    if (state.fresh || !ctx || typeof ctx.waitUntil !== 'function') return;
    ctx.waitUntil(ensureTaxSetup(env, { trigger: 'checkout', background: true }).catch((e) => console.error('[Tax] background setup failed:', e.message)));
  };
  if (!state.ready) {
    console.log(JSON.stringify({ tax_skipped: state.reason, ready: false, cached: state.cached, age_seconds: Math.round(state.age_ms / 1000) }));
    refresh();
    return payload;
  }
  // Stale but last-known-ready: the order is taxed on the measurement that is there, and the re-measurement runs BEHIND
  // the response. Waiting for it would put Stripe back on the customer's path; not taxing would sell it untaxed.
  refresh();
  payload.set('automatic_tax[enabled]', 'true');
  if (payload.has('line_items[0][price_data][unit_amount]')) {
    payload.set('line_items[0][price_data][product_data][tax_code]', taxCode);
  }
  if (payload.has('customer')) payload.set('customer_update[address]', 'auto');
  return payload;
}

/* ─────────────────────── Stripe session helper ─────────────────────── */

/** The tax fields applyTax adds, and only those. `customer_update[address]` is deliberately NOT here: on a signed-in
 *  checkout applyAccountCustomer sets it before applyTax ever runs, so dropping it would send a body the tax-off path
 *  would not have sent — and the point of the retry is to send exactly the tax-off body. */
const TAX_FIELD_RE = /^(?:automatic_tax\[|line_items\[\d+\]\[price_data\]\[product_data\]\[tax_code\]$)/;
function withoutTaxFields(payload) {
  const clean = new URLSearchParams();
  let dropped = 0;
  for (const [k, v] of payload) { if (TAX_FIELD_RE.test(k)) dropped++; else clean.append(k, v); }
  return { clean, dropped };
}

/** Is this refusal ABOUT tax? Nothing else may be retried: a declined card, a bad price, a missing return URL are all
 *  answers, and re-sending them is one more charge attempt against a customer who already has an answer. */
function isTaxRefusal(err) {
  const hay = [err && err.code, err && err.param, err && err.message].filter(Boolean).join(' ').toLowerCase();
  return /automatic_tax|\btax\b|registration/.test(hay);
}

/** Did Stripe REFUSE this body, or did it fail to answer about it? Only the first is retryable. A 4xx refusal with an
 *  error object is Stripe reading the body and saying no; a 5xx, a timeout and a transport failure say nothing about
 *  the body at all and go straight to the normal error path. */
function isStripeRefusal(status, data) {
  return (status === 400 || status === 402) && !!(data && data.error && typeof data.error === 'object');
}

/**
 * THE FALLBACK THAT MAKES LAST-KNOWN-READY SAFE. A cached readiness can be out of date — Stripe Tax deactivated on the
 * account, a registration ended — and a Session carrying automatic_tax against an account that is no longer collecting
 * is refused outright. That must never be what the customer sees, so a TAX-CLASS refusal is retried ONCE with the tax
 * fields removed: the byte-identical pre-tax body, and the customer checks out.
 *
 * WHAT IT NO LONGER DOES IS WRITE THE READINESS ROW. Round 4 wrote tax:ready = UNMEASURED here, and the write was
 * reachable by an ANONYMOUS request, with no lock, no measurement and no rate limit, on any non-ok response whose free
 * text matched /automatic_tax|tax|registration/. An attacker-influenced string that Stripe echoes back — an email local
 * part, a description, a URL path — turned tax OFF for every other buyer for the length of the negative TTL, and a
 * completed Session cannot be re-taxed. The same write de-taxed everyone on a CUSTOMER-scoped code
 * (customer_tax_location_invalid) that says nothing about the account. So the refusal now buys exactly one thing: a
 * measurement, enqueued behind the response, that takes the tax:lock and ASKS STRIPE.
 *
 * SAID EXACTLY, AND THE PREVIOUS WORDING OVERSTATED IT. "The row this path never writes" was false: a refusal enqueues
 * a MEASUREMENT behind the response, that measurement takes the tax:lock, asks Stripe, and writes the readiness row
 * with what Stripe answered. A checkout can therefore cause a readiness write — at most once per TAX_LOCK_MS however
 * many refusals arrive, and off the customer's path. The property that actually holds is the narrower and stronger
 * one: NO CUSTOMER-INFLUENCED STRING CAN DETERMINE ITS VALUE. What goes into that row is Stripe's own answer to a
 * fresh read of the account; the refusal decides only that the question gets asked. A test pins the row byte-for-byte
 * across a refusal carrying attacker-chosen text, which is the same fact stated without the overclaim.
 *
 * isTaxRefusal still reads FREE TEXT, and it still matches on it: a message a stranger influenced and Stripe echoes
 * back can therefore start ONE bounded second Session attempt inside the same ceiling, plus that one enqueued
 * measurement. That is the whole of what a string can buy, and it cannot buy an untaxed order for anybody — not for
 * the sender, whose second body is the one this Worker would have sent anyway, and not for the next buyer, whose tax
 * is decided by whatever Stripe says when the account is next read.
 *
 * One retry, tax-class only, only on a 4xx refusal Stripe actually answered, only when the body carried tax fields,
 * and only if the shared budget has room — both attempts live inside ONE checkout ceiling, so the retry cannot double
 * the worst case a customer waits.
 *
 * THE STREAK is the one row it writes directly, and it is a counter with nothing behind it: +1 on the
 * tax:fallback_streak count column per refusal — its OWN row since round 8, not the heartbeat's, which is the fix for
 * a public counter that used to insert a liveness stamp — cleared the moment a tax-carrying Session is accepted. It exists because the double fault — tax
 * endpoints unreadable, so the grace holds the row at ready, AND Stripe refusing every tax-carrying body — is invisible
 * otherwise: every order completes, every order completes untaxed, and the report says tax_ready: true for 24 hours.
 */
async function createStripeSession(payload, env, label, ctx) {
  if (!env.STRIPE_SECRET_KEY) {
    console.error('[' + label + '] STRIPE_SECRET_KEY not set');
    return { ok: false, status: 503, error: 'Payments are not configured. Please call to book.' };
  }
  const deadline = Date.now() + checkoutTimeoutMs(env);
  const send = (body) => checkoutCall(env, '/checkout/sessions', { method: 'POST', headers: stripeHeaders(env), body: body.toString() }, Math.max(CHECKOUT_RETRY_FLOOR_MS, deadline - Date.now()));

  // Asked BEFORE the call, because after a retry `payload` is no longer what the successful attempt carried.
  const carriedTax = payload.has('automatic_tax[enabled]');
  let res = await send(payload);
  const taxAccepted = res.ok && carriedTax;
  if (!res.ok) {
    const err = (res.data && res.data.error) || {};
    const { clean, dropped } = withoutTaxFields(payload);
    if (dropped && isTaxRefusal(err) && isStripeRefusal(res.status, res.data)) {
      const left = deadline - Date.now();
      console.log(JSON.stringify({ tax_fallback: label, reason: taxSafe(env, err.code || err.message || 'tax refused', 120), fields_dropped: dropped, retried: left >= CHECKOUT_RETRY_FLOOR_MS }));
      // The real measurement, behind the response and under the lock. It is what may write the readiness row; this path
      // never does. A held lock means somebody is already asking, and then this costs nothing at all.
      if (ctx && typeof ctx.waitUntil === 'function') {
        ctx.waitUntil(taxFallbackBump(env)
          .then(() => ensureTaxSetup(env, { trigger: 'session_refused', background: true }))
          .catch((e) => console.error('[Tax] refused-session measurement failed:', e.message)));
      }
      if (left >= CHECKOUT_RETRY_FLOOR_MS) res = await send(clean);
    }
  }
  // Stripe took a tax-carrying body: whatever the double fault was, it is over. Conditional in D1, and behind the
  // response, so an ordinary taxed checkout pays nothing for it.
  if (taxAccepted && ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(taxFallbackReset(env).catch((e) => console.error('[Tax] fallback streak reset failed:', e.message)));
  }
  if (!res.ok) {
    console.error('[' + label + '] Stripe error:', taxSafe(env, JSON.stringify(res.data), 300));
    // Don't leak Stripe internals to the browser.
    return { ok: false, status: 502, error: 'Could not start checkout. Please try again or call us.' };
  }

  // The Session is a Stripe shape like any other, and it is the one the CUSTOMER is handed: an id and a URL that are
  // not both strings is a 200 this Worker cannot act on, and passing `undefined` to the browser as a redirect is a
  // broken checkout with no error behind it. The id, which goes to a log and to D1, is capped at 255.
  //
  // AND THE URL IS BOUNDED TOO, AS OF ROUND 8 — the last Stripe-controlled string in this Worker that left unbounded.
  // BOUNDED, NOT CAPPED, and round 9 fixes the word because the difference is the whole design: this URL is never
  // TRUNCATED. Round 7 argued against a cap on exactly that ground — truncating a redirect target breaks the purchase
  // it exists to start — and that argument is right and is not an argument for no ceiling. So a URL over
  // CHECKOUT_URL_MAX (2048) is REJECTED WHOLE: the Session is refused, the customer gets the ordinary 502, and no
  // truncated redirect is ever handed to a browser. A Checkout URL is about ninety characters; a "URL" past 2048 is
  // not a redirect this Worker should act on. Scheme first, length second — a length test applied before the https
  // check would be asking about the size of something that was never a URL.
  const session = res.data;
  if (typeof session.id !== 'string' || typeof session.url !== 'string' || !session.url.startsWith('https://') || session.url.length > CHECKOUT_URL_MAX) {
    console.error('[' + label + '] Stripe answered 200 with a Session this Worker cannot use:', taxSafe(env, JSON.stringify(res.data), 300));
    return { ok: false, status: 502, error: 'Could not start checkout. Please try again or call us.' };
  }
  console.log('[' + label + '] Session created:', taxSafe(env, session.id, 60));
  return { ok: true, session };
}

async function createSession(payload, env, cors, label, ctx) {
  const r = await createStripeSession(payload, env, label, ctx);
  return r.ok ? json({ checkoutUrl: r.session.url, sessionId: capText(r.session.id, 255) }, 200, cors) : json({ error: r.error }, r.status, cors);
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
  console.log('[Webhook] Event:', taxSafe(env, event.type, 60), taxSafe(env, event.id, 60));

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const meta = session.metadata || {};
    if (session.mode === 'setup') {
      // Account card saved through Checkout in setup mode: make it the customer's default for future charges.
      ctx.waitUntil(setDefaultCardFromSetup(env, session).catch((e) => console.error('[AccountCard] failed:', e.message)));
      return json({ received: true }, 200, cors);
    }
    // EVERY FIELD HERE IS STRIPE-CONTROLLED AND EVERY ONE OF THEM LANDS IN D1, so every one is bounded — by capText,
    // not taxSafe. These are RECORD fields: the buyer's own email and name are the point of the row, and the redactor
    // would corrupt them (the `re_` rule alone eats any address containing `…re_…`). A D1 TEXT column has no length of
    // its own, so the ceiling is the only thing standing between a malformed event and an unbounded write. The
    // numbers are typed as numbers rather than capped.
    const record = {
      stripe_session_id: capText(session.id, 255),
      stripe_event_id: capText(event.id, 255),
      kind: capText(meta.kind || (session.mode === 'subscription' ? 'membership' : 'class_booking'), 40),
      sku: capText(meta.sku || meta.plan || '', 100),
      item_name: capText(meta.class_name || meta.plan_name || '', 200),
      session_date: capText(meta.session_date || '', 40),
      session_label: capText(meta.session_label || '', 200),
      qty: parseInt(meta.qty || meta.seats || '1', 10) || 1,
      amount_total: Math.trunc(Number(session.amount_total)) || 0,
      currency: capText(session.currency || 'usd', 10),
      customer_email: capText(session.customer_email || session.customer_details?.email || '', 320),
      customer_name: capText(meta.customer_name || session.customer_details?.name || '', 200),
      customer_phone: capText(session.customer_details?.phone || '', 40),
      organization: capText(meta.organization || '', 200),
      notes: capText(meta.notes || '', 2000),
      utm_source: capText(meta.utm_source || '', 200), utm_medium: capText(meta.utm_medium || '', 200),
      utm_campaign: capText(meta.utm_campaign || '', 200), first_touch_at: capText(meta.first_touch_at || '', 40),
      created_at: new Date().toISOString(),
    };

    // Persist first — a stored order is what makes the money recoverable.
    const stored = await storeOrder(env, record);

    // A registration (screening + agreement + refund consent) rides in metadata: mark it paid,
    // copy the refund consent onto the order, then send the participant and range documents.
    const registration = meta.registration_id
      ? await completeRegistration(env, capText(meta.registration_id, 64), record).catch((e) => {
          console.error('[Register] link failed:', e.message);
          return null;
        })
      : null;
    if (registration && !record.customer_phone) record.customer_phone = capText(registration.customer_phone || '', 40);

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
    console.warn('[Webhook] Payment failed for:', taxSafe(env, inv.customer_email || inv.customer, 320));
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
  const email = capText(sub.metadata?.email || '', 320);
  if (!email) return;
  await env.DB.prepare(
    "UPDATE orders SET status = 'cancelled' WHERE customer_email = ? AND kind = 'membership'"
  )
    .bind(email)
    .run();
  console.log('[Membership] Cancelled:', taxSafe(env, email, 320));
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
    // Resend's body is a third party's free text on its way into a thrown Error and from there into console.error, so
    // it gets the same ceiling every Stripe string on that path has. Found by the R8-4 enumeration, which sweeps for
    // an unbounded read rather than for the fields somebody remembered to list.
    const detail = capText(await res.text(), 300);
    throw new Error('Resend ' + res.status + ': ' + detail);
  }
}

function list(v) {
  return String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
}

/* ───────────── Registration completion: link, documents, retention ───────────── */

/** After payment: mark the registration paid and copy the refund consent onto the order row.
 *
 *  `id` IS STRIPE-CONTROLLED — it is `metadata.registration_id` off a webhook event, and a webhook payload carries the
 *  version configured on the Stripe endpoint rather than the version this Worker pins, so nothing upstream bounds it.
 *  It was the one such string that reached a log uncapped: an unknown id was echoed WHOLE into console.error, which a
 *  200,000-character metadata value turned into a 200,000-character log line. Capped at the call site AND here, because
 *  this function is also reachable from anywhere else that learns a registration id later. A real one is a 32-character
 *  hex string. */
async function completeRegistration(env, id, record) {
  if (!env.DB) return null;
  const regId = capText(id, 64);
  const reg = await env.DB.prepare('SELECT * FROM registrations WHERE id = ? LIMIT 1').bind(regId).first();
  if (!reg) {
    console.error('[Register] unknown registration:', regId);
    return null;
  }
  const paidAt = new Date().toISOString();
  await updateRegistration(env, regId, { status: 'paid', paid_at: paidAt, stripe_session_id: record.stripe_session_id });
  await env.DB.prepare(
    `UPDATE orders SET refund_policy_version = ?, refund_policy_accepted_at = ?, refund_policy_ip = ?,
       customer_phone = CASE WHEN customer_phone IS NULL OR customer_phone = '' THEN ? ELSE customer_phone END
     WHERE stripe_session_id = ?`
  ).bind(reg.refund_policy_version, reg.refund_policy_accepted_at, reg.refund_policy_ip, reg.customer_phone || '', record.stripe_session_id).run();
  console.log('[Register] Paid:', regId, capText(reg.item_name, 60), capText(reg.customer_email, 80));
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

/* ──────────────────── The daily work, and the once-a-day claim it takes ────────────────────

   Two triggers became one on 2026-09-09: Workers Free allows five cron triggers per ACCOUNT (Cloudflare code 10072),
   the account is at that ceiling, and deploy run #38 uploaded the script and then had its schedules refused — leaving a
   live Worker running new code on the old trigger set. The tax tick is the trigger that cannot be dropped (a ten-minute
   readiness TTL refreshed once a day is stale 1430 minutes out of 1440), so the daily work moved onto it: the fire whose
   scheduledTime lands between 09:15 and 09:19 UTC does the daily work too.

   THE WINDOW IS FIVE MINUTES WIDE FOR ONE TRIGGER FIRE. TAX_TICK_CRON fires on the multiples of five, so exactly one
   fire a day — 09:15 — opens the window, and the four minutes after it are the slack for a scheduler that delivers
   late. The old daily trigger's own minute, 09:17, is inside it, which is what lets that trigger be restored on a paid
   plan without moving anything.

   AND THE CLAIM IS WHAT MAKES IT ONCE. The window alone would run the daily work twice if two fires ever landed in it,
   or if the daily trigger came back beside the tick. DAILY_GUARD_KEY holds the UTC date of the last run in
   rate_limits.window_start and the claim is ONE conditional upsert — the row moves to today only when it is not already
   today — so the run is claimed by the statement, not by a read the next fire could race.

   THE DAILY PURGE CANNOT EAT THIS ROW BEFORE IT HAS DONE ITS JOB. purgeRateLimits exempts `tax:%` and nothing else, so
   this row is purgeable — but window_start begins with the date and a pipe, and `|` sorts after the `T` of an ISO
   timestamp, so a row claimed on day D is still above the purge's `now − 24h` cutoff throughout day D+1. By the time it
   is old enough to be deleted, the date it holds is no longer today and the claim it grants is one this day would grant
   anyway.

   IT FAILS OPEN, deliberately. No D1 binding, or a D1 that throws, and the work RUNS: the failure this guard exists to
   prevent is a second run of an idempotent job (the digest claims its week in email_log, the journeys claim per
   participant, the purge is a DELETE by date), and the failure it must never cause is a day with no retention purge at
   all. Fail-open is bounded at two runs a day; fail-closed is unbounded silence. */
export const DAILY_GUARD_KEY = 'daily:last_run';   // rate_limits row: window_start = '<YYYY-MM-DD>|<iso of the claim>'
export const DAILY_WINDOW_HOUR = 9;                // UTC. The window the tax tick also does the daily work in …
export const DAILY_WINDOW_FIRST_MINUTE = 15;       // … opened by the */5 fire at :15 …
export const DAILY_WINDOW_LAST_MINUTE = 19;        // … and wide enough to hold a late delivery and the old 09:17 daily.

/** Is this fire the one that also carries the daily work? Read off the SCHEDULER's clock (event.scheduledTime). */
export function inDailyWindow(at) {
  const t = at instanceof Date ? at : new Date(at);
  if (!Number.isFinite(t.getTime())) return false;
  const m = t.getUTCMinutes();
  return t.getUTCHours() === DAILY_WINDOW_HOUR && m >= DAILY_WINDOW_FIRST_MINUTE && m <= DAILY_WINDOW_LAST_MINUTE;
}

/**
 * Claim today for the daily work. True = this fire owns the day and must do the work; false = a fire already did it.
 * One statement, so two fires cannot both read "not yet" and both proceed. Absent D1 or a throw returns TRUE (see above).
 */
/** The UTC date (YYYY-MM-DD) the daily claim currently holds, or null when there is no D1, no row, or a read failure. */
async function dailyLastRunDate(env) {
  if (!env || !env.DB) return null;
  try {
    const row = await env.DB.prepare('SELECT window_start FROM rate_limits WHERE key = ?').bind(DAILY_GUARD_KEY).first();
    const v = row && row.window_start ? String(row.window_start) : '';
    return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
  } catch (e) { return null; }
}
async function claimDailyRun(env, at) {
  const day = (at instanceof Date ? at : new Date(at)).toISOString().slice(0, 10);
  if (!env || !env.DB) { console.log(JSON.stringify({ daily_claim: 'no-db', day })); return true; }
  try {
    await ensureRateSchema(env);
    const res = await env.DB.prepare('INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 0) ON CONFLICT(key) DO UPDATE SET window_start = excluded.window_start WHERE substr(rate_limits.window_start, 1, 10) <> substr(excluded.window_start, 1, 10)')
      .bind(DAILY_GUARD_KEY, day + '|' + new Date().toISOString()).run();
    const claimed = !!(res && res.meta && res.meta.changes);
    if (!claimed) console.log(JSON.stringify({ daily_claim: 'already-ran', day }));
    return claimed;
  } catch (e) {
    console.error('[Daily] claim failed, running anyway:', e.message);
    return true;
  }
}

/**
 * The daily work itself, unchanged by the move onto the tick: the retention purge, the journeys, and the Monday digest
 * with its Tuesday/Wednesday retry. Every piece is queued in its own promise with its own catch, so one failing cannot
 * reach the others.
 *
 * THE DIGEST STILL READS event.scheduledTime DIRECTLY, and not the firedAt fallback: an event with no scheduledTime
 * gives `new Date(undefined)`, whose getUTCDay() is NaN, and no digest is sent. That is the conservative half of the
 * pair — a weekly email must not be sent because a handler guessed at the weekday — and the tests pin it.
 */
async function runDailyWork(event, env, ctx) {
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
}

/** Daily: answers past purge_after go; registrations that never reached payment are marked abandoned. */
async function runRetention(env) {
  if (!env.DB) return { purged: 0, abandoned: 0 };
  const now = new Date().toISOString();
  const purged = await env.DB.prepare('DELETE FROM eligibility_answers WHERE purge_after < ?').bind(now).run();
  const dayAgo = new Date(Date.now() - 86400000).toISOString();
  const abandoned = await env.DB.prepare("UPDATE registrations SET status = 'abandoned' WHERE status = 'pending' AND created_at < ?").bind(dayAgo).run();
  // An account whose email was never verified within a day is a squat or a typo: it goes, and the address is free again.
  // Nothing has created one since round 5 — /account/register writes pending_signups instead — so this now only clears
  // rows that predate migrations/010 on a database where that file has not run.
  const unverified = await env.DB.prepare('DELETE FROM accounts WHERE verified_at IS NULL AND created_at < ?').bind(dayAgo).run().catch(() => null);
  // A sign-up nobody proved within a day, and the placeholder row the non-mailing branches write.
  const stale = await env.DB.prepare('DELETE FROM pending_signups WHERE created_at < ?').bind(dayAgo).run().catch(() => null);
  // Counter rows nobody has touched for a day carry no live window (src/ratelimit.js).
  const rateRows = await purgeRateLimits(env).catch(() => 0);
  const out = { purged: purged?.meta?.changes ?? 0, abandoned: abandoned?.meta?.changes ?? 0, unverified: unverified?.meta?.changes ?? 0, pending: stale?.meta?.changes ?? 0, rate_limits: rateRows };
  console.log('[Retention] answers purged:', out.purged, '· registrations abandoned:', out.abandoned, '· unverified accounts removed:', out.unverified, '· pending sign-ups dropped:', out.pending, '· rate-limit rows dropped:', out.rate_limits);
  return out;
}

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/* ─────────────────────────── CRM (staff) ─────────────────────────── */

/**
 * The staff key travels in a HEADER, and only in a header. The `?key=` form it used to accept as well was removed
 * 2026-09-09: a key in a URL lands in browser history, in the Referer of anything the page links to, and in every
 * intermediary log between here and Cloudflare — and one of the routes behind this guard makes a Stripe write that is
 * not undoable. Nothing needs the query form: the staff page sends X-Admin-Key (src/crm.js) and so do both workflows.
 */
function adminKeyOk(request, env) {
  const key = request.headers.get('X-Admin-Key') || '';
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
  if (!adminKeyOk(request, env)) return json({ error: 'Unauthorized' }, 401, cors);
  // Stripe Tax sits above the database check because it still ANSWERS without D1 — but only as a REPORT. This comment
  // used to claim the writes still happen; they do not. takeTaxLock returns false with no DB, and a run that cannot
  // take the lock writes nothing to Stripe and leaves no heartbeat, which a round-2 probe demonstrated. So the
  // self-sufficiency claim carries a precondition: D1 must be writable. It does NOT make the route reachable on a
  // Worker with no D1 either, because the per-IP limiter fails closed and answers 429 ahead of every route here
  // (src/ratelimit.js). A test pins that.
  if (url.pathname === '/admin/tax/setup' && (request.method === 'POST' || request.method === 'GET')) {
    return await handleTaxSetup(request, env, { ...cors, 'Cache-Control': 'no-store' }, url);
  }
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

/* ─────────────────── Stripe Tax: readiness, self-setup, report ─────────────────── */

/** One Stripe call, on a clock. GET when `form` is undefined, POST of a form-encoded body otherwise. The parsed body
 *  comes back whether Stripe accepted it or not, because the caller reports Stripe's refusal rather than paraphrasing
 *  it. A transport failure, and now a timeout, are returned as status 0 rather than thrown, so every tax path fails
 *  closed instead of 500-ing.
 *
 *  THE TIMEOUT IS THE POINT. Round 2 held GET /v1/tax/settings open and every checkout stalled behind it: "any Stripe
 *  error is not ready" was true of Stripe's REFUSALS and said nothing about its LATENCY. Nothing in the tax path may
 *  outlive taxTimeoutMs now — the race is enforced here rather than trusted to the transport, and the AbortController
 *  cancels the request that lost it. Checkout no longer waits on any of this (applyTax reads D1 only), so the clock is
 *  what bounds the BACKGROUND work: a hung Stripe endpoint costs one timed-out measurement per lock window.
 *
 *  `idempotencyKey` is sent on POSTs only. The keys are deterministic constants (TAX_IDEMPOTENCY), so two isolates that
 *  somehow both get past the D1 lock still cannot create two Texas registrations — Stripe collapses the second into the
 *  first. The 24-hour lifetime of a key is deliberate here: a run that failed because the account has not accepted the
 *  Stripe Tax terms replays that refusal until the key ages out, and the readiness gate keeps checkout tax-free the
 *  whole time, which is the safe direction. */
async function stripeCall(env, path, form, idempotencyKey) {
  return await boundedStripe(env, path, form === undefined
    ? { headers: { Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY } }
    : { method: 'POST', headers: idempotencyKey ? { ...stripeHeaders(env), 'Idempotency-Key': idempotencyKey } : stripeHeaders(env), body: form.toString() },
    taxTimeoutMs(env));
}

/**
 * ONE CLOCK, TWO CEILINGS. Every bounded Stripe call in this Worker goes through here: the tax path on taxTimeoutMs,
 * the customer's checkout path on checkoutTimeoutMs. A transport failure and a timeout both come back as status 0 with
 * an error object rather than throwing, so a caller reports Stripe's silence the same way it reports Stripe's refusal.
 * Two implementations of a clock is how one of them ends up without a clamp, which is what the whole of round 2 was.
 *
 * `parse_error` is the third kind of answer, and it used to be indistinguishable from the first: a 200 whose body does
 * not parse — a proxy's HTML error page, a truncated stream — came back as `data: {}`, exactly like a 200 that really
 * said `{}`. `data` still keeps that shape so no caller has to change, and the flag is what lets a log line say which
 * of the two happened. A body of literal `null` PARSES; it is a null answer, not an unparseable one.
 */
async function boundedStripe(env, path, init, ms) {
  const ac = new AbortController();
  let timer = null;
  const call = (async () => {
    // The pin goes on HERE, not in each caller: one place means no call can be built without it (the GET in stripeCall
    // hand-rolls its Authorization header and would otherwise have gone out unpinned).
    const r = await fetch('https://api.stripe.com/v1' + path, { ...init, headers: { ...(init && init.headers), 'Stripe-Version': stripeApiVersion(env) }, signal: ac.signal });
    let data = {}, parseError = false;
    try { data = await r.json(); } catch { parseError = true; }
    return { ok: r.ok, status: r.status, data, parse_error: parseError };
  })();
  call.catch(() => {});   // the loser of the race is nobody's error; it must not surface as an unhandled rejection
  try {
    return await Promise.race([call, new Promise((_, reject) => {
      timer = setTimeout(() => { ac.abort(); reject(new Error('no answer in ' + ms + 'ms')); }, ms);
    })]);
  } catch (e) {
    const timedOut = ac.signal.aborted;
    return { ok: false, status: 0, timeout: timedOut, data: { error: { type: timedOut ? 'timeout' : 'transport_error',
      message: (timedOut ? 'Stripe did not answer ' : 'Could not reach Stripe') + (timedOut ? path + ' in ' + ms + 'ms.' : ': ' + e.message) } } };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * The ceiling on the Stripe calls a CUSTOMER waits behind — the Checkout Session itself, the Customer created for a
 * signed-in checkout, the saved card read on /account/me. Longer than the tax clock on purpose: those are the calls the
 * order depends on, where the tax path is work nobody is waiting for. Clamped into the same bounds for the same reason
 * — a typo of 999999999 is a ceiling that is not there.
 *
 * Round 4 left these three as raw `fetch` with no AbortController at all while the tax reads beside them were bounded,
 * and round 5's retry made it worse: the Session create now runs up to TWICE, so an unbounded pair was two open-ended
 * waits on one customer. Exported so the clamp is asserted directly rather than inferred from how long a hung test takes.
 */
const CHECKOUT_TIMEOUT_MS = 8000;
const CHECKOUT_RETRY_FLOOR_MS = 250;   // less budget left than this and the tax-off retry is not started at all
const CHECKOUT_URL_MAX = 2048;         // a Checkout URL is ~90 characters; past this the Session is REFUSED, never truncated
export function checkoutTimeoutMs(env) {
  const n = Number(env && env.STRIPE_CHECKOUT_TIMEOUT_MS);
  if (!Number.isFinite(n) || n <= 0) return CHECKOUT_TIMEOUT_MS;
  return Math.min(Math.max(n, TAX_TIMEOUT_MIN_MS), TAX_TIMEOUT_MAX_MS);
}

/** A Stripe call on the customer's path, on the checkout clock. `ms` overrides the ceiling, which is how the two
 *  Checkout Session attempts share ONE budget instead of getting one each. */
async function checkoutCall(env, path, init, ms) {
  return await boundedStripe(env, path, init, Number.isFinite(ms) ? ms : checkoutTimeoutMs(env));
}

const TAX_HEAD_OFFICE = {
  'head_office[address][line1]': '2450 Fondren Rd',
  'head_office[address][line2]': 'Suite 255',
  'head_office[address][city]': 'Houston',
  'head_office[address][state]': 'TX',
  'head_office[address][postal_code]': '77063',
  'head_office[address][country]': 'US',
};

/** Constant, so the key identifies the OPERATION rather than the attempt. Bump the suffix to force a genuinely new one. */
const TAX_IDEMPOTENCY = { settings: 'mast-tax-settings-v1', registration: 'mast-tax-reg-us-tx-v1' };

/**
 * Seven rows of Worker state, in the rate_limits table — no new binding, no migration to apply by hand.
 *
 *   tax:ready                   the measured readiness of the Stripe account. count 1/0/2, good for TAX_READY_TTL_MS.
 *   tax:lock                    held while a setup run is writing. window_start is the EXPIRY, so a crashed run frees
 *                               itself.
 *   tax:last_run                the LAST MEASUREMENT OF ANY ORIGIN: when a run finished and how it went, whichever
 *                               trigger started it — the cron, an /admin call, or the refresh a checkout enqueued.
 *   tax:cron_last_run           LOOP LIVENESS, and it is a separate row for the reason round 8 gave the streak one
 *                               (R9-4). A checkout that finds the measurement due enqueues a run, and that run stamps
 *                               tax:last_run — so on a site taking orders the heartbeat stays fresh whether or not
 *                               Cloudflare's scheduler has fired once, and "is the loop alive" cannot be read off it.
 *                               This row is stamped ONLY when the trigger was TAX_TICK_CRON or DAILY_CRON, at the top
 *                               of the tick, before any early return — so a healthy account, whose ticks cost one D1
 *                               read and never reach a run, still proves the scheduler fired. Absent = stale.
 *   tax:fallback_streak         the consecutive tax_fallback count (the double fault below), on its OWN key as of
 *                               round 8. It shared tax:last_run through round 7, and the shared row was a real defect
 *                               rather than a tidiness one: the streak bump had to INSERT the row when it was absent,
 *                               so N anonymous refused checkouts against a Worker whose loop had NEVER RUN wrote a
 *                               fresh timestamp into the heartbeat and made a dead loop report as `age_hours: 0`,
 *                               `stale: false`. A heartbeat an unauthenticated request can stamp is not a heartbeat.
 *                               It is written by a run or a measurement now, and by nothing else.
 *   tax:registration_witness    the FIRST witness to an absent Texas registration: when a validated, complete read of
 *                               the list last saw none. The create needs a second one (R8-3).
 *   tax:registration_create     the create ledger: when a registration create was last ATTEMPTED and how it went, with
 *                               the attempt count in the count column. No create is attempted within
 *                               TAX_CREATE_COOLDOWN_MS of the last one, whatever any read says.
 *
 * The table's columns are (key, window_start TEXT, count INTEGER), so the timestamp and the note share window_start as
 * `<iso>|<note>`. purgeRateLimits skips `tax:%` (src/ratelimit.js) — these rows are Worker state, not per-IP counters,
 * and a heartbeat the daily purge eats at 24h can never be REPORTED stale at 25h.
 *
 * THE DOUBLE FAULT, COUNTED. Tax endpoints unreadable AND Stripe refusing every tax-carrying Session is the one state
 * where the design is working exactly as written and still losing money: the grace keeps the readiness row saying
 * ready, every order pays for two Session creates, every order completes UNTAXED, and for 24 hours nothing anywhere
 * says so — each refusal writes one tax_fallback line into a stream nobody reads and the report keeps printing
 * tax_ready: true. The streak is the counter that makes it visible, and it is deliberately ONLY a counter: nothing
 * gates on it, nothing is suppressed by it. A number an anonymous request can raise must never be able to decide
 * whether the next buyer is taxed — that is the round-4 de-tax write R5-2 removed, and it is not coming back as a
 * threshold. It resets on the two things that mean the fault ended: a Session that carried tax and was ACCEPTED, and
 * a measurement that Stripe actually answered.
 */
const TAX_READY_KEY = 'tax:ready', TAX_LOCK_KEY = 'tax:lock', TAX_RUN_KEY = 'tax:last_run';
const TAX_CRON_RUN_KEY = 'tax:cron_last_run';          // loop liveness, stamped by a cron trigger and by nothing else
const TAX_STREAK_KEY = 'tax:fallback_streak';          // the double-fault counter, no longer riding on the heartbeat row
const TAX_WITNESS_KEY = 'tax:registration_witness';    // the first of the two witnesses a registration create needs
const TAX_CREATE_KEY = 'tax:registration_create';      // the create ledger the admin report prints
const TAX_READY_TTL_MS = 10 * 60000;      // how long a measurement of the account is FRESH (past it, the loop re-measures)
const TAX_READY_GRACE_MS = 24 * 3600000;  // how long a measurement that said READY is still trusted while nothing re-measures
const TAX_RETRY_TTL_MS = 60000;           // how long a measurement that COULD NOT BE MADE suppresses the next attempt
const TAX_LOCK_MS = 60000;                // the window: one measurement + at most one setup attempt per minute
const TAX_RUN_STALE_MS = 25 * 3600000;    // a loop that has not fired in 25h is not firing
const TAX_FALLBACK_LOUD = 3;              // consecutive tax_fallbacks past which the report says so in words
const TAX_WITNESS_MIN_MS = 30000;         // the second read must be a genuinely LATER one, never the same run's
const TAX_WITNESS_MAX_MS = 24 * 3600000;  // …and not a stale observation of an account that has since changed
const TAX_CREATE_COOLDOWN_MS = 30 * 24 * 3600000;   // one registration-create attempt per 30 days, ledgered and reported
const TAX_TIMEOUT_MS = 4000;              // no Stripe call in the tax path may outlive this (STRIPE_TAX_TIMEOUT_MS overrides)
const TAX_TIMEOUT_MIN_MS = 500, TAX_TIMEOUT_MAX_MS = 15000;   // the bounds an operator's override is clamped into
const TAX_TICK_CRON = '*/5 * * * *';      // THE ONLY TRIGGER IN wrangler.toml since 2026-09-09: it keeps the
                                          // measurement warm, and the fire inside DAILY_WINDOW carries the daily work
                                          // too (Workers Free allows five cron triggers per account; run #38 was
                                          // refused the second with code 10072).
const DAILY_CRON = '17 9 * * *';          // the daily trigger: retention, journeys, the digest. NOT REGISTERED TODAY —
                                          // the string stays because a paid plan lifts the ceiling to 1,000 and this
                                          // trigger can go straight back into wrangler.toml, sharing DAILY_GUARD_KEY
                                          // with the window path so the pair is still one run a day. scheduled()
                                          // branches on BOTH strings by name — an unrecognised trigger gets the cheap
                                          // tick, never the daily work. Every string here must match [triggers] exactly.

/** What the tax:ready row's count column means: what the last measurement found, or that it could not be made at all. */
const TAX_READY_YES = 1, TAX_READY_NO = 0, TAX_UNMEASURED = 2;

/** The clock on every Stripe call in the tax path. Tunable without a deploy of new code, because the right value is an
 *  operational one — Stripe's tax endpoints are not the checkout endpoint and do not deserve the same patience.
 *
 *  CLAMPED at both ends. Rejecting zero and nonsense was never the risk: a typo the other way (`999999999`) removed the
 *  clock entirely, the lock freed after its minute while the previous fetch was still open, and a new orphaned Stripe
 *  request could be started every minute forever. A bound the value can be typed past is not a bound. Exported so the
 *  bounds are asserted directly rather than inferred from how long a hung test takes. */
export function taxTimeoutMs(env) {
  const n = Number(env && env.STRIPE_TAX_TIMEOUT_MS);
  if (!Number.isFinite(n) || n <= 0) return TAX_TIMEOUT_MS;
  return Math.min(Math.max(n, TAX_TIMEOUT_MIN_MS), TAX_TIMEOUT_MAX_MS);
}

/** Anything key-shaped, gone — before it leaves the Worker, not in the workflow that happens to print it. */
function taxRedact(env, value) {
  let t = value == null ? '' : String(value);
  for (const secret of [env && env.ADMIN_KEY, env && env.STRIPE_SECRET_KEY, env && env.STRIPE_WEBHOOK_SECRET, env && env.RESEND_API_KEY]) {
    if (secret && String(secret).length >= 8) t = t.split(String(secret)).join('[redacted]');
  }
  return t
    // NOT ONE \b IN THIS FUNCTION, and that is the rule rather than an accident of these particular shapes. A word
    // boundary asks whether the character BESIDE the token is a word character — so `param_AC…`, `settings_status_
    // ghp_…` and every other token glued to a label went out verbatim, which is the one context a Stripe error message
    // reliably provides. Round 6 removed \b from the prefix rules and added three more rules WITH it eleven lines
    // under the comment saying not to; this pass removes the last of them. Where a match must not swallow a longer
    // run, that is a NEGATIVE LOOKAHEAD ON THE TOKEN'S OWN ALPHABET (below), which asks about the token instead of
    // about its neighbour. Over-redaction is the safe direction here; a missed key is not recoverable.
    .replace(/(sk_(?:live|test)_|rk_(?:live|test)_|pk_(?:live|test)_|whsec_|re_)[A-Za-z0-9_-]+/g, '$1[redacted]')
    // Anthropic and OpenAI keys are a HYPHEN after sk, so the Stripe rule above — which requires the underscore —
    // never touched them, and they are in the vault's canonical set. The cost is prose: `risk-` followed by twenty
    // key-alphabet characters is redacted too, which is a scrubbed log line rather than a leaked key.
    .replace(/sk-[A-Za-z0-9_-]{20,}/g, '[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi, 'Bearer [redacted]')
    // Not Stripe's own shapes, and that is the point: whatever a Stripe error quotes back came from a request body
    // somebody else wrote. A denylist can only remove what it has been told about, so it is told about the classes the
    // vault's canonical set names — a Google key, an AWS id, a Slack token, a JWT, a GitHub or GitLab token, a
    // RevenueCat key, a Twilio SID — rather than the four that happened to turn up in a round-2 probe.
    .replace(/AIzaSy[A-Za-z0-9_-]{33}/g, '[redacted]')
    .replace(/AKIA[A-Z0-9]{16}/g, '[redacted]')
    .replace(/xox[bpar]-[A-Za-z0-9-]+/g, '[redacted]')
    .replace(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/gh[pousr]_[A-Za-z0-9]{36,}/g, '[redacted]')
    .replace(/glpat-[A-Za-z0-9_-]{20,}/g, '[redacted]')
    .replace(/appl_[A-Za-z0-9]{20,}/g, '[redacted]')
    // The lookahead is what \b was there to do, asked correctly: a Twilio SID is AC/SK and EXACTLY 32 hex, so the match
    // must not eat a prefix of a longer hex run — but a `_` or a letter to the LEFT is the normal case in a log line,
    // not a reason to skip it.
    .replace(/(?:AC|SK)[a-f0-9]{32}(?![a-f0-9])/g, '[redacted]')
    // The heuristic, and the only one here: a 32-64 character hex string is not a shape anybody owns, so it is removed
    // only where a label BESIDE it says it is a credential. That is how the AISStream opaque hash was missed once — it
    // belongs to no vendor and matches no prefix, and the label is the only thing that identifies it. Anchor-free on
    // both sides, and widened to 64 so a longer opaque token beside its label is not left standing
    // because it was too big to match. A hex run longer than 64 characters keeps its head: the tail beside the label is
    // removed, the leading remainder is not, and no width makes a heuristic complete — the labelled shapes above are
    // what this is a backstop for.
    .replace(/((?:_key|_token|_secret|api_key|access_token)\W{0,4})[a-fA-F0-9]{32,64}/gi, '$1[redacted]')
    .replace(/[a-fA-F0-9]{32,64}(\W{0,4}(?:_key|_token|_secret|api_key|access_token))/gi, '[redacted]$1');
}

/** The ceiling on an accepted enum or id. A Stripe status is one of three words and a registration id is under thirty
 *  characters; nothing legitimate comes near this. */
const TAX_ENUM_MAX = 60;

/**
 * A Stripe ENUM or ID — a settings status, a registration id, a registration type. These are not free text and are no
 * longer scrubbed as though they were: anything not enum-shaped or id-shaped is replaced WHOLE.
 *
 * The denylist above is the right tool for an error message, which really is free text and can only be cleaned of the
 * shapes somebody thought to add. It is the wrong tool for a field with three legal values, where the question is not
 * "does this look like a secret" but "is this one of the three". A round-2 probe read a planted key back out of
 * settings.status; an allow-list is what makes the NEXT unanticipated shape an `[unexpected]` instead of a leak.
 * Redacted first, so a value that happens to equal a configured secret cannot be enum-shaped on its way through.
 *
 * AND THE ACCEPTED VALUE IS CAPPED, which round 5 dropped when it replaced taxSafe here: `^[a-z_]+$` is satisfied by a
 * 50,000-character lowercase status, so an allow-list with no length was a strictly larger write than the taxSafe it
 * replaced — the whole of it persisted into D1 and mirrored back out through /admin/tax/setup. Shape and size are two
 * checks, and passing one is not passing the other.
 */
function taxEnum(env, value) {
  const t = taxRedact(env, value == null ? '' : String(value));
  if (!(/^[a-z_]+$/.test(t) || /^taxreg_[A-Za-z0-9]+$/.test(t))) return '[unexpected]';
  return t.length > TAX_ENUM_MAX ? t.slice(0, TAX_ENUM_MAX) + '…' : t;
}

/** Any Stripe-controlled string on the SUCCESS path that is genuinely FREE TEXT — a readiness reason, an outcome note,
 *  anything interpolated into a sentence. Redaction used to be the error path's job alone, and a round-2 probe read a
 *  planted key back out of settings.status verbatim through /admin/tax/setup. Same scrubber as the error path, plus a
 *  length cap. The enum and id fields do NOT come through here: they go through taxEnum, which asks the stronger
 *  question and caps as well. */
function taxSafe(env, value, max = 120) {
  const t = taxRedact(env, value == null ? '' : String(value));
  return t.length > max ? t.slice(0, max) + '…' : t;
}

/** `active_from` on a registration is a TIMESTAMP — an ISO-8601 date-time or unix seconds — and it was going through
 *  taxSafe, the free-text scrubber, which only removes the shapes the denylist knows. It is not free text, so it gets
 *  the same treatment as the enums: checked against the two shapes it is allowed to be, replaced whole otherwise. */
function taxDate(env, value) {
  if (value == null || value === '') return 'unknown';
  const t = taxRedact(env, String(value));
  if (/^\d{9,10}$/.test(t)) return t;
  if (/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(t)) return t;
  return '[unexpected]';
}

/** Stripe's error, reduced to the three fields worth reporting, scrubbed AND CAPPED. The raw object is never mirrored:
 *  whoever reads this endpoint — CI, a hand-run curl, shell history, a future dashboard — gets the same redacted
 *  answer.
 *
 *  THE CAP IS ROUND 7'S HALF. Round 6 capped taxEnum and left these three on bare taxRedact, so the one field on this
 *  path that is genuinely unbounded free text — a Stripe message, which quotes back whatever was in the request —
 *  went whole into the 502 body and into every CI summary that prints it. Redaction and length are two different
 *  questions and a string needs both answered: scrubbing a 200,000-character message leaves a 200,000-character
 *  message. type and code are enum-shaped in practice but are NOT taxEnum'd — an unrecognised error code is worth
 *  reading verbatim when a call is failing, so they get the free-text treatment on a short leash. */
function taxError(env, r) {
  const e = (r && r.data && r.data.error) || {};
  return {
    type: taxSafe(env, e.type || 'api_error', 60),
    code: taxSafe(env, e.code || '', 60),
    message: taxSafe(env, e.message || (r && r.data ? 'Stripe refused the call and sent no message.' : 'No response body from Stripe.'), 300),
  };
}

/** LENGTH ONLY, NO REDACTION — the other half of doctrine 2, and the distinction matters more than the code does.
 *  taxSafe is for a string on its way to a LOG, a REPORT or an operator's screen: a stranger's planted key can reach
 *  those, so it is scrubbed. This is for a string on its way to a RECORD — an order row, a customer id — where the
 *  value must survive verbatim to be worth storing, and where scrubbing actively corrupts it (the `re_` rule alone
 *  mangles any address containing `…re_…`). What a record field still must not be is unbounded: a D1 TEXT column has
 *  no length of its own, so the ceiling is here. */
function capText(value, max) {
  const t = value == null ? '' : String(value);
  return t.length > max ? t.slice(0, max) : t;
}

async function taxStateGet(env, key) {
  if (!env || !env.DB) return null;
  try {
    await ensureRateSchema(env);
    const row = await env.DB.prepare('SELECT window_start, count FROM rate_limits WHERE key = ?').bind(key).first();
    if (!row || !row.window_start) return null;
    const cut = String(row.window_start).indexOf('|');
    const at = Date.parse(cut < 0 ? row.window_start : String(row.window_start).slice(0, cut));
    if (!at) return null;
    return { at, note: cut < 0 ? '' : String(row.window_start).slice(cut + 1), n: Number(row.count) || 0 };
  } catch (e) {
    console.error('[Tax] state read failed (' + key + '):', e.message);
    return null;
  }
}

/** THE HEARTBEAT, AND ONLY A RUN WRITES IT. Round 7 kept the fallback streak in this row's count column, which meant
 *  the streak bump had to be an upsert on THIS key — so an anonymous refused checkout INSERTED the heartbeat with a
 *  current timestamp and a Worker whose setup loop had never run once reported `stale: false, age_hours: 0`. The one
 *  field whose entire job is to show that a loop stopped firing was writable by the public. The streak lives on
 *  TAX_STREAK_KEY now (R8-5) and this function stamps a timestamp and a note, nothing else; a run that actually
 *  MEASURED the account additionally clears the streak, because that is one of the two halves of the double fault
 *  ending. */
async function taxRunStamp(env, note, measured) {
  if (!env || !env.DB) return false;
  try {
    await ensureRateSchema(env);
    await env.DB.prepare('INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 0) ON CONFLICT(key) DO UPDATE SET window_start = excluded.window_start')
      .bind(TAX_RUN_KEY, new Date().toISOString() + '|' + note).run();
    if (measured) await taxFallbackReset(env);
    return true;
  } catch (e) {
    console.error('[Tax] heartbeat write failed:', e.message);
    return false;
  }
}

/** LOOP LIVENESS, on its own key. taxRunStamp says a measurement happened; it does not say the SCHEDULER is alive,
 *  because a checkout that finds the measurement due enqueues a run and that run stamps it too. So the one question an
 *  operator actually asks of a heartbeat — "has Cloudflare fired this trigger lately?" — could not be read off
 *  tax:last_run on any Worker taking orders. This row answers it and nothing else: written only where the trigger is
 *  one of the two crons, and written at the TOP of the tick so the cheap early return on a healthy account (one D1
 *  read, no run, no measurement) still records that the scheduler fired. */
async function taxCronStamp(env, trigger) {
  if (!env || !env.DB) return;
  try {
    await ensureRateSchema(env);
    await env.DB.prepare('INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 0) ON CONFLICT(key) DO UPDATE SET window_start = excluded.window_start')
      .bind(TAX_CRON_RUN_KEY, new Date().toISOString() + '|' + trigger).run();
  } catch (e) {
    console.error('[Tax] cron heartbeat write failed:', e.message);
  }
}

/** +1 on the streak, on the streak's OWN key. Nothing an anonymous checkout can reach writes the heartbeat: a
 *  customer's refused Session is evidence that Stripe said no to a tax-carrying body and evidence of nothing else, and
 *  it is certainly not evidence that the setup loop ran. The measurement this same refusal enqueues is what stamps the
 *  heartbeat, a moment later, with a real outcome. */
async function taxFallbackBump(env) {
  if (!env || !env.DB) return;
  try {
    await ensureRateSchema(env);
    await env.DB.prepare('INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1) ON CONFLICT(key) DO UPDATE SET count = rate_limits.count + 1')
      .bind(TAX_STREAK_KEY, new Date().toISOString() + '|session_refused/fallback').run();
  } catch (e) {
    console.error('[Tax] fallback streak write failed:', e.message);
  }
}

/** The fault ended: a tax-carrying Session was accepted, or a measurement was actually made. Conditional, so the
 *  ordinary taxed checkout writes nothing. */
async function taxFallbackReset(env) {
  if (!env || !env.DB) return;
  try {
    await ensureRateSchema(env);
    await env.DB.prepare('UPDATE rate_limits SET count = 0 WHERE key = ? AND count <> 0').bind(TAX_STREAK_KEY).run();
  } catch (e) {
    console.error('[Tax] fallback streak reset failed:', e.message);
  }
}

/** Drop a tax state row. Used for the witness, which is CONSUMED by the create it authorised and dropped outright the
 *  moment a Texas registration is seen — a witness left lying about is a create waiting for the next transient
 *  absence. */
async function taxStateClear(env, key) {
  if (!env || !env.DB) return;
  try {
    await ensureRateSchema(env);
    await env.DB.prepare('DELETE FROM rate_limits WHERE key = ?').bind(key).run();
  } catch (e) {
    console.error('[Tax] state clear failed (' + key + '):', e.message);
  }
}

async function taxStatePut(env, key, note, n) {
  if (!env || !env.DB) return false;
  try {
    await ensureRateSchema(env);
    await env.DB.prepare('INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET window_start = excluded.window_start, count = excluded.count')
      .bind(key, new Date().toISOString() + '|' + note, Number(n) || 0).run();
    return true;
  } catch (e) {
    console.error('[Tax] state write failed (' + key + '):', e.message);
    return false;
  }
}

/**
 * The window, not merely a mutex: INSERT the row if it is absent, and otherwise take it over only if its expiry has
 * passed. Both are single conditional statements, so the winner is decided by D1, not by which read landed first.
 *
 * Two round-2 corrections live here. The row is no longer DELETED when a run finishes — holdTaxWindow re-stamps it for
 * a fresh TAX_LOCK_MS, so the ceiling is one measurement and one setup attempt per minute however many requests arrive;
 * deleting it made the real window "one run's duration", which is no ceiling at all. And what stops a DUPLICATE Texas
 * registration is the 24-hour deterministic Idempotency-Key, not this row: an expired-lock takeover can legitimately
 * run beside a stalled holder. This is a throttle with a correctness backstop, and saying it the other way round was
 * wrong. No D1 = no lock = no run at all: a lock-less run reports and writes nothing.
 */
async function takeTaxLock(env) {
  if (!env || !env.DB) return false;
  const now = new Date();
  const until = new Date(now.getTime() + TAX_LOCK_MS).toISOString();
  try {
    await ensureRateSchema(env);
    const made = await env.DB.prepare('INSERT OR IGNORE INTO rate_limits (key, window_start, count) VALUES (?, ?, ?)').bind(TAX_LOCK_KEY, until, 1).run();
    if (made && made.meta && made.meta.changes) return true;
    const stolen = await env.DB.prepare('UPDATE rate_limits SET window_start = ? WHERE key = ? AND window_start < ?').bind(until, TAX_LOCK_KEY, now.toISOString()).run();
    return !!(stolen && stolen.meta && stolen.meta.changes);
  } catch (e) {
    console.error('[Tax] lock failed:', e.message);
    return false;
  }
}

/** The end of a run holds the window open for another TAX_LOCK_MS rather than freeing it, so the next trigger — cron,
 *  admin or an anonymous checkout — is turned away until the minute is up. Upsert, so a row somebody deleted comes back. */
async function holdTaxWindow(env) {
  if (!env || !env.DB) return;
  const until = new Date(Date.now() + TAX_LOCK_MS).toISOString();
  await env.DB.prepare('INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET window_start = excluded.window_start, count = excluded.count')
    .bind(TAX_LOCK_KEY, until, 1).run().catch((e) => console.error('[Tax] lock hold failed:', e.message));
}

/**
 * ONE DECLARATIVE SCHEMA PER STRIPE SHAPE — doctrine 1, and round 8's correction to the way it was written.
 *
 * Rounds 5, 6 and 7 each wrote a HAND-ROLLED check for the fields that round had noticed, and each time an independent
 * fuzz found the next field nobody had named. Round 7's was `country`: the validator asked for "a string when present"
 * while isTexasSalesTax DECIDES on it first, so a row carrying no `country` at all validated, came out of the predicate
 * as a confident FALSE — a measured "this account has no Texas registration" — 13 violations of that one class across
 * 226 mutations, with a duplicate US/TX registration POST behind it.
 *
 * A NAMED CHECK CANNOT END THAT CLASS, because the failure is always the field nobody named. So the checks are not
 * written any more. The schemas below are the single declaration of every key this module dereferences; the validator
 * ITERATES them; and what comes back is a FROZEN object REBUILT from the schema, carrying the schema's keys and nothing
 * else. A field the schema does not list is not in the validated object at all, so no predicate can read it by
 * accident — and the suite wraps every validated object in a Proxy whose get trap THROWS on any key the schema does not
 * list, then runs isTexasSalesTax, measureTaxReady and taxRun's decision code through it. An unlisted read is
 * impossible rather than merely unintended, which is the only construction that ends a class instead of an instance.
 *
 * CLASSIFY OR REFUSE. A row the schema cannot FULLY classify — a required field missing or null, a value outside its
 * regex, an empty string anywhere — makes the WHOLE list unparseable: measured:false, the path that keeps a ready row
 * inside its grace (R5-1) and fails closed when there is nothing to keep. Absence is never read as "not Texas".
 *
 * AND NO NORMALISATION, ANYWHERE. Nothing is lowercased or trimmed on the way in. ' active ' and 'Active' are not the
 * enum Stripe documents; a drifted value is a SHAPE failure by doctrine, not a value to be repaired into a decision.
 */
// 500 is CHOSEN, not read off Stripe's documentation — this session had no route to Stripe and did not verify a
// documented ceiling, so it is not claimed as one. What is measured: the head office line1 this Worker writes is 15
// characters, and the fail direction is safe — over it, the settings body is unparseable, the grace holds and nothing
// is written to the account. If a real address line ever exceeds it, the symptom is `settings_head_office_address_line1_invalid`
// in the heartbeat, which names the field.
const TAX_TEXT_MAX = 500;
/** U+200B ZWSP, U+200C ZWNJ, U+200D ZWJ and U+FEFF are NOT in JavaScript's `\s`, which is the whole of R9-5: a line1 of
 *  one zero-width space satisfied `^\S(?:[\s\S]*\S)?$` and read as "the head office is set", so the settings write was
 *  skipped on an account that has no address. U+00A0 and U+FEFF ARE in `\s` and were already refused outright by that
 *  same test — they are named in the class anyway rather than left resting on one engine's definition of `\s`. Matched
 *  ANYWHERE, not only alone: an invisible in the middle of a line is padding this module does not normalise away. */
const TAX_INVISIBLE = /[\u200B-\u200D\uFEFF\u00A0]/;
const IS = {
  object: (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
  array: (v) => Array.isArray(v),
  boolean: (v) => typeof v === 'boolean',
  fn: (v) => typeof v === 'function',
  string: (v) => typeof v === 'string',
  regexp: (v) => v instanceof RegExp,
  // A head-office line is prose, so it gets the only non-enum test here. SHAPE AND SIZE, both: a line that is empty, or
  // entirely whitespace, or padded, or made of invisibles, or 100,000 characters long, is not an address line Stripe
  // wrote — and reading one as "the head office is set" is how a settings write is skipped on a body this code did not
  // understand. The ceiling is R9-2 applied to the one non-enum string the schema declares: `^\S…\S$` is satisfied by
  // any length, and an unbounded string inside a validated object is the residual that check was written to close.
  text: (v) => typeof v === 'string' && v.length <= TAX_TEXT_MAX && !TAX_INVISIBLE.test(v) && /^\S(?:[\s\S]*\S)?$/.test(v),
  // `active_from` is a timestamp — unix SECONDS or an ISO-8601 date-time — and never free text. The two shapes are the
  // two taxDate accepts, deliberately: one field, one answer about what it is allowed to be, asked once.
  timestamp: (v) => (typeof v === 'number' && Number.isInteger(v) && v >= 1e8 && v < 1e10)
    || (typeof v === 'string' && /^(?:\d{9,10}|\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?)$/.test(v)),
};

/**
 * THE ENUM SHAPE, WITH A SIZE — R9-2. `^[a-z][a-z_]*$` is a shape and nothing else, and it is satisfied by a
 * 100,000-character lowercase status. That is not a hypothetical read: taxEnum was capped in round 6 for exactly this
 * reason and the SCHEMA was written without one in round 8, so a deciding field was byte-shape-VALID at any size —
 * measured:true, the ready row inside its grace destroyed, the next order sold untaxed, on a body no Stripe account
 * produces. Shape and size are two questions and passing one is not passing the other, which this file has now
 * established twice; the bound is written into the regex so there is no second place for it to be forgotten. 60 is
 * TAX_ENUM_MAX — the ceiling the report already applies — so the schema and the redactor agree on what an enum is.
 * The two-letter fields (country, us.state) are bounded by `{2}` already, and `id` by `{1,64}`.
 */
const TAX_ENUM_SHAPE = /^[a-z][a-z_]{0,59}$/;

/** `required` is a US row's condition, not a constant: `country_options` is mandatory on a US registration and absent
 *  by design on every other one. It reads `country` off the RAW row, which the schema has already required and
 *  shape-checked by the time this runs — the schema is iterated in declaration order and `country` is declared first. */
const US_ROW = (row) => row.country === 'US';

/** GET /v1/tax/settings — the two things this module dereferences off it: the status measureTaxReady and taxRun decide
 *  on, and the head-office line taxRun decides whether to WRITE on. Anything else Stripe sends is not read here, so it
 *  is not listed here, so it cannot be read here. */
const TAX_SETTINGS_SCHEMA = {
  status: { required: true, test: TAX_ENUM_SHAPE },
  head_office: { required: false, test: IS.object },
  'head_office.address': { required: (s) => s.head_office !== undefined && s.head_office !== null, test: IS.object },
  'head_office.address.line1': { required: (s) => s.head_office !== undefined && s.head_office !== null, test: IS.text },
};

/** A tax.registration row. `country` is REQUIRED and two upper-case letters — that is the round-7 hole closed at the
 *  schema rather than at a call site. `state` is required for a US row and `''` is rejected by the regex itself, which
 *  is why the regexes are anchored and non-empty rather than a length check somewhere else. `id` and `active_from` are
 *  listed because the REPORT reads them: every key this module touches is declared, or the read guard throws. */
const TAX_REGISTRATION_ROW_SCHEMA = {
  status: { required: true, test: TAX_ENUM_SHAPE },
  country: { required: true, test: /^[A-Z]{2}$/ },
  id: { required: false, test: /^[A-Za-z0-9_]{1,64}$/ },
  active_from: { required: false, test: IS.timestamp },
  // R9-3: PRESENT ON A NON-US ROW IS A SHAPE FAILURE, not a decidable "not Texas". `required` alone made this field
  // optional-when-absent and unchecked-when-present, so a row saying `country: 'CA'` while carrying
  // `country_options.us.state = 'TX'` validated, came out of isTexasSalesTax as a confident FALSE — a MEASURED "this
  // account has no Texas registration" — and is a row Stripe cannot have written. A body that contradicts itself is
  // one this module did not understand, and the whole point of classify-or-refuse is that those take the grace path
  // rather than decide anything. The test reads the RAW row, which the validator hands it as the second argument;
  // `country` is declared above and has already been required and shape-checked by the time this runs.
  country_options: { required: US_ROW, test: (v, row) => IS.object(v) && US_ROW(row) },
  'country_options.us': { required: US_ROW, test: IS.object },
  'country_options.us.state': { required: US_ROW, test: /^[A-Z]{2}$/ },
  'country_options.us.type': { required: US_ROW, test: TAX_ENUM_SHAPE },
};

/** The list envelope. ABSENT has_more is read as false, deliberately and documentedly — Stripe omits it on a non-list
 *  body and nothing is turned off by that reading. A PRESENT has_more that is not a boolean (`"true"`, `1`) is the page
 *  failing to say, so it is a shape failure like any other. */
const TAX_LIST_SCHEMA = {
  data: { required: true, test: IS.array },
  has_more: { required: false, test: IS.boolean },
};

/** The keys the schema allows AT EACH LEVEL, derived from the schema itself so the two can never disagree. This is what
 *  the validated object is rebuilt from and what the suite's read guard throws on. */
function taxSchemaKeys(schema) {
  const byPath = new Map([['', new Set()]]);
  for (const path of Object.keys(schema)) {
    const parts = path.split('.');
    for (let i = 0; i < parts.length; i++) {
      const parent = parts.slice(0, i).join('.');
      if (!byPath.has(parent)) byPath.set(parent, new Set());
      byPath.get(parent).add(parts[i]);
    }
  }
  return byPath;
}
const TAX_SETTINGS_KEYS = taxSchemaKeys(TAX_SETTINGS_SCHEMA);
const TAX_REGISTRATION_ROW_KEYS = taxSchemaKeys(TAX_REGISTRATION_ROW_SCHEMA);
const TAX_LIST_KEYS = taxSchemaKeys(TAX_LIST_SCHEMA);

/** THE ONE TEST SEAM IN THIS MODULE, and it is the whole of R8-1's enforcement. In production it is the identity: the
 *  validators hand every object they return through it and nothing happens. The suite replaces it with a Proxy factory
 *  whose get trap throws on any key the schema does not list, and then drives isTexasSalesTax, measureTaxReady and
 *  taxRun through the result — so a predicate reading a field the schema forgot fails the suite instead of shipping.
 *  A guard nothing fires is not a guard; this one fires on every validated object in every tax test. */
let taxReadGuard = (value) => value;
export function setTaxReadGuard(fn) { taxReadGuard = IS.fn(fn) ? fn : (value) => value; }
export const TAX_SCHEMAS = { settings: TAX_SETTINGS_SCHEMA, row: TAX_REGISTRATION_ROW_SCHEMA, list: TAX_LIST_SCHEMA };

/** Freeze bottom-up, then hand each level to the read guard with the keys its schema allows. */
function sealValidated(node, path, byPath) {
  for (const k of Object.keys(node)) if (IS.object(node[k])) node[k] = sealValidated(node[k], path ? path + '.' + k : k, byPath);
  return taxReadGuard(Object.freeze(node), byPath.get(path) || new Set(Object.keys(node)));
}

/**
 * The engine, and the only place either Stripe shape is trusted. It walks the SOURCE for each declared path, decides
 * required from the rule, tests the value against the rule's RegExp (a RegExp implies "a string, and this shape") or
 * predicate, and writes it into a fresh object at the same path. A declared path that is itself a PARENT of another
 * declared path contributes an empty node rather than the raw object beneath it, which is what keeps an unlisted key
 * from riding into the validated result inside a container that happened to pass.
 *
 * `undefined` and `null` are both ABSENT: Stripe sends `head_office: null` on an account with no head office, and
 * treating that as a present-but-wrong shape would refuse to read a perfectly ordinary account.
 */
function validateAgainstSchema(schema, byPath, source, at) {
  if (!IS.object(source)) return { ok: false, reason: at + 'not_an_object' };
  const out = {};
  for (const [path, rule] of Object.entries(schema)) {
    const parts = path.split('.'), leaf = parts[parts.length - 1];
    let holder = source, target = out, unreachable = false;
    for (let i = 0; i < parts.length - 1; i++) {
      holder = IS.object(holder) ? holder[parts[i]] : undefined;
      if (!IS.object(holder)) { unreachable = true; break; }
      target = target[parts[i]] || (target[parts[i]] = {});
    }
    const need = rule.required === true || (IS.fn(rule.required) && rule.required(source) === true);
    const value = unreachable ? undefined : holder[leaf];
    const name = at + path.split('.').join('_');
    if (value === undefined || value === null) {
      if (need) return { ok: false, reason: name + '_missing' };
      continue;
    }
    // The SOURCE is the second argument, which is what lets a rule ask about the row rather than only about the value —
    // R9-3's contradictory-row check is the one rule that needs it, and every other test ignores it.
    const good = IS.regexp(rule.test) ? (IS.string(value) && rule.test.test(value)) : rule.test(value, source) === true;
    if (!good) return { ok: false, reason: name + '_invalid' };
    if (byPath.has(path)) target[leaf] = target[leaf] || {};
    else target[leaf] = value;
  }
  return { ok: true, value: sealValidated(out, '', byPath) };
}

/** Both validators answer { ok:true, value } or { ok:false, reason } — never a bare boolean, because the reason is what
 *  the heartbeat prints and what tells an operator WHICH row and WHICH field drifted. */
function validateTaxSettings(data) {
  return validateAgainstSchema(TAX_SETTINGS_SCHEMA, TAX_SETTINGS_KEYS, data, 'settings_');
}

function validateTaxRegistrations(data) {
  const list = validateAgainstSchema(TAX_LIST_SCHEMA, TAX_LIST_KEYS, data, 'list_');
  if (!list.ok) return list;
  const rows = [];
  for (let i = 0; i < list.value.data.length; i++) {
    const row = validateAgainstSchema(TAX_REGISTRATION_ROW_SCHEMA, TAX_REGISTRATION_ROW_KEYS, list.value.data[i], 'row_' + i + '_');
    if (!row.ok) return row;
    rows.push(row.value);
  }
  return { ok: true, value: Object.freeze({ rows: Object.freeze(rows), has_more: list.value.has_more === true }) };
}

/** US · Texas · state sales tax. The TYPE is the half round 1 left out: a Texas registration of some other type is not a
 *  sales-tax registration, and treating it as one meant no sales-tax registration was ever created. Both predicates run
 *  ONLY on rows the schema has already rebuilt, so every field they read is a declared one — that is what the read
 *  guard proves, and it is why there is not an optional chain or a typeof left in either of them. */
const isTexasSalesTax = (r) => !!(r && r.country === 'US' && r.country_options && r.country_options.us
  && r.country_options.us.state === 'TX' && r.country_options.us.type === 'state_sales_tax');
const isTexasAnyType = (r) => !!(r && r.country === 'US' && r.country_options && r.country_options.us && r.country_options.us.state === 'TX');

/**
 * Is this Stripe account actually collecting Texas sales tax right now? Two reads, both required:
 *   settings.status === 'active', AND an ACTIVE US/TX state_sales_tax registration.
 * A scheduled registration is registered-but-not-collecting and does not count until its active_from has passed.
 *
 * OFF-PATH ONLY — the cron, the ctx.waitUntil refresh a checkout enqueues, and /admin/tax/setup. A customer never
 * reaches this function; applyTax reads the cache it writes.
 *
 * Any Stripe error is NOT ready — fail closed for tax, open for checkout: the customer still checks out, without tax.
 * `measured` separates the two kinds of no: an account read successfully and found not collecting (trusted for the full
 * TTL) from an account that could not be read at all (cached for TAX_RETRY_TTL_MS only, so recovery is a minute away
 * rather than ten, and a hung or rate-limited Stripe still cannot be re-asked per request).
 *
 * AND `res.ok` IS NOT THE WHOLE OF "READ SUCCESSFULLY". Round 5 defined a failed measurement as `!res.ok`, so a 200
 * whose body says nothing this function can decide on — `{}`, a proxy's `<html>502 Bad Gateway</html>`, a registrations
 * list with no `data` array — counted as a MEASURED not-ready. That overwrote the row that said ready, took the whole
 * 24-hour grace with it, and sold the next order untaxed with no grace at all. A measurement is measured only when the
 * FIELDS IT DECIDES ON are present and well-typed; anything else is silence wearing a 200, and silence is not evidence.
 *
 * THE FIELDS IT DECIDES ON GO ALL THE WAY DOWN, which is round 7's correction and the reason there is not one ad-hoc
 * typeof left in this function. The checks here were per-container: status a string, `data` an Array — and then every
 * ROW in that Array was read on faith by isTexasSalesTax, so one renamed field inside a row produced a confident,
 * MEASURED "no Texas registration". Both shapes now go through the validators above, whose schema is the exact list of
 * fields this module dereferences, and a failure at any level is `<shape>_unparseable` / measured:false — the same
 * keep-the-grace path as a 5xx.
 *
 * `has_more` is the same rule applied to the page rather than the body. The list is read one page deep, so a Texas row
 * past the first hundred registrations was reported as a measured "no Texas registration" when the honest answer is
 * that this function did not look. Unmeasured, and the grace applies — a false negative here turns tax off. A has_more
 * that is TRUTHY BUT NOT A BOOLEAN (`"true"`, `1`) is not that answer either: it is the page failing to say, which the
 * validator returns as a shape failure.
 */
async function measureTaxReady(env) {
  if (!env || !env.STRIPE_SECRET_KEY) return { ready: false, reason: 'no_stripe_key', measured: false };
  const settings = await stripeCall(env, '/tax/settings');
  if (!settings.ok) return { ready: false, reason: settings.timeout ? 'timeout' : 'settings_read_failed', measured: false };
  const s = validateTaxSettings(settings.data);
  if (!s.ok) return { ready: false, reason: 'settings_unparseable', measured: false, parse_error: !!settings.parse_error, shape: s.reason };
  if (s.value.status !== 'active') return { ready: false, reason: 'settings_status:' + taxEnum(env, s.value.status), measured: true };
  const list = await stripeCall(env, '/tax/registrations?status=active&limit=100');
  if (!list.ok) return { ready: false, reason: list.timeout ? 'timeout' : 'registrations_read_failed', measured: false };
  const g = validateTaxRegistrations(list.data);
  if (!g.ok) return { ready: false, reason: 'registrations_unparseable', measured: false, parse_error: !!list.parse_error, shape: g.reason };
  const rows = g.value.rows;
  const tx = rows.find((r) => isTexasSalesTax(r) && r.status === 'active');
  if (tx) return { ready: true, reason: 'active', measured: true };
  if (g.value.has_more) return { ready: false, reason: 'registrations_paged', measured: false };
  return { ready: false, reason: rows.some(isTexasAnyType) ? 'tx_registration_wrong_type' : 'no_active_tx_state_sales_tax', measured: true };
}

/**
 * THE READINESS A CHECKOUT SEES: one D1 read, no Stripe call, ever. Two separate questions, and conflating them is what
 * sold orders untaxed:
 *
 *   `fresh` — is a re-measurement due? Ten minutes for something measured, one minute for a measurement that FAILED.
 *             A stale row is what makes the next checkout enqueue a refresh; it is not, by itself, an answer about tax.
 *   `ready` — does the last measurement say the account is collecting? A measurement that said YES is trusted for
 *             TAX_READY_GRACE_MS (24h), LAST-KNOWN-READY: only a measured not-ready, or nothing measured inside a day,
 *             turns tax off. Round 3 turned it off at ten minutes, which with a daily cron meant almost every order.
 *
 * Fail-closed still holds in the direction that matters: a measured not-ready is never graced, an account that could
 * not be read at all is never graced, and 24h of silence turns tax off rather than trusting a measurement from a
 * Stripe account that may have changed. Grace is what a stale-ready costs; the tax-error fallback in
 * createStripeSession is what a WRONG stale-ready costs, and it costs one retried session, not a failed checkout.
 */
async function taxReadyCached(env) {
  const row = await taxStateGet(env, TAX_READY_KEY);
  if (!row) return { ready: false, reason: 'never_measured', cached: false, fresh: false, stale: true, age_ms: 0, measured_at: null, ttl_ms: TAX_READY_TTL_MS, grace_ms: TAX_READY_GRACE_MS };
  const age = Date.now() - row.at;
  const ttl = row.n === TAX_UNMEASURED ? TAX_RETRY_TTL_MS : TAX_READY_TTL_MS;
  const base = { cached: true, age_ms: age, measured_at: new Date(row.at).toISOString(), ttl_ms: ttl, grace_ms: TAX_READY_GRACE_MS, fresh: age < ttl, stale: age >= ttl };
  if (row.n === TAX_READY_YES) {
    if (age < TAX_READY_GRACE_MS) return { ...base, ready: true, reason: base.fresh ? (row.note || 'active') : 'last_known_ready' };
    return { ...base, ready: false, reason: 'measurement_expired' };
  }
  if (base.fresh) return { ...base, ready: false, reason: row.note || (row.n === TAX_UNMEASURED ? 'unmeasured' : 'not_ready') };
  return { ...base, ready: false, reason: 'measurement_stale' };
}

/** The loop that keeps the measurement warm: the five-minute trigger, and the daily cron. A cache that is fresh AND
 *  ready needs nothing, so a tick costs one D1 read; anything else re-measures under the lock and repairs the account
 *  when it is genuinely not collecting. Off the customer's path by construction — a checkout can only ENQUEUE this. */
async function taxTick(env, trigger, fromCron) {
  // The liveness stamp is FIRST and unconditional, because the healthy path is the one that returns two lines down
  // without running anything: on an account that is collecting, every tick for the next ten minutes costs one D1 read
  // and stamps nothing else. A liveness row only a FAILING tick writes reports a working loop as dead.
  if (fromCron) await taxCronStamp(env, trigger);
  const state = await taxReadyCached(env);
  if (state.fresh && state.ready) return console.log(JSON.stringify({ tax_cron: 'ready', trigger, reason: state.reason, age_seconds: Math.round(state.age_ms / 1000) }));
  await ensureTaxSetup(env, { trigger, background: true });
}

/**
 * Measure the account and write what was found to the cache every checkout reads. Off-path callers only.
 *
 * A FAILED MEASUREMENT IS NOT A MEASUREMENT, AND IT NEVER OVERWRITES A ROW THAT SAID READY INSIDE THE GRACE. Round 4
 * shipped the 24-hour grace and then let the five-minute tick destroy it on the first bad tick: a Stripe 5xx or a timeout wrote
 * TAX_UNMEASURED over the ready row, taxReadyCached grants the grace only to a TAX_READY_YES row, and so tax came off
 * within seconds of an outage rather than after a day of it.
 *
 * THE REVERT NUMBER IS HARNESS-DEPENDENT, AND SAYING IT WITHOUT SAYING WHOSE HARNESS IS THE DEFECT ROUND 8 FIXES HERE.
 * Reverting the fix and driving an hour of Stripe 500s sells 10 of 12 orders untaxed IN THIS REPO'S SUITE and 11 of 12
 * in the round-7 reviewer's independent harness; the two advance the virtual clock at different points, so the count
 * is a property of the harness as much as of the bug. (An earlier comment quoted 11 of 12 and 3 of 6 as though this
 * suite had measured them; they were the round-4 reviewer's, carried forward rather than measured here.)
 *
 * THE INVARIANT IS WHAT BOTH HARNESSES AGREE ON, and it is the only number worth pinning: UNREVERTED, both report
 * 0 of 12 and 0 of 6. A completed Session cannot be re-taxed afterwards, so zero is the figure that matters.
 *
 * So silence and failure leave the row alone and are recorded in the heartbeat and the log instead. A MEASURED
 * not-ready still overwrites, immediately: Stripe answered and said the account is not collecting, and that is
 * evidence. Fail-closed is unchanged in the direction that matters — the grace still expires at 24h, and a failure
 * with no ready measurement behind it still writes UNMEASURED on the short negative TTL.
 *
 * AND A MEASUREMENT THAT FINDS THE ACCOUNT COLLECTING DROPS THE STANDING WITNESS — R9-1, and the reason it is HERE
 * rather than beside the other two clears is that the other two are in taxRun, which the cron does not reach on a
 * healthy account. ensureTaxSetup's background branch measures first and RETURNS on `seen.ready`, so every ordinary
 * five-minute tick against a collecting account ran the one code path that could see Texas and could not drop a
 * witness. A witness left standing has a 24-hour life (TAX_WITNESS_MAX_MS) and only two things end it: a create, or
 * being seen off. So a false absence, then healthy ticks every one of them MEASURING the registration present, then a
 * second false absence WITHIN 24 HOURS (the witness's own lifetime is the outer bound — a later one replaces rather
 * than pairs) still met as two witnesses and authorised a duplicate registration, which is the one act in this module
 * that cannot be undone. Measured with the clear reverted: two observed absences 11 h apart, one POST. The clear belongs to the
 * MEASUREMENT, which every path makes, not to the run, which the healthy path skips.
 */
async function taxMeasure(env) {
  const m = await measureTaxReady(env);
  // Only on a measured ready: an unparseable body or a timeout says nothing about whether Texas is registered, and a
  // witness dropped on silence would be a witness the grace path quietly destroys. Dropping one is always the SAFE
  // direction — it can only delay a create, never cause one — so it is done on every measurement that earns it.
  // READ BEFORE WRITE, like everything else here: a standing witness is the rare case, so the ordinary healthy tick
  // costs one SELECT that finds nothing and issues no DELETE at all.
  if (m.measured && m.ready && (await taxStateGet(env, TAX_WITNESS_KEY))) await taxStateClear(env, TAX_WITNESS_KEY);
  if (!m.measured) {
    const row = await taxStateGet(env, TAX_READY_KEY);
    const age = row ? Date.now() - row.at : 0;
    if (row && row.n === TAX_READY_YES && age < TAX_READY_GRACE_MS) {
      await taxRunStamp(env, 'measure_failed/' + taxSafe(env, m.reason, 40), false);
      console.log(JSON.stringify({ tax_measure: 'failed', reason: taxSafe(env, m.reason, 40), shape: m.shape || null, parse_error: !!m.parse_error, kept: 'last_known_ready', age_seconds: Math.round(age / 1000) }));
      return { ready: false, reason: m.reason, measured: false, kept_ready: true, cached: true, fresh: false, age_ms: age };
    }
  }
  await taxStatePut(env, TAX_READY_KEY, m.reason, m.measured ? (m.ready ? TAX_READY_YES : TAX_READY_NO) : TAX_UNMEASURED);
  return { ready: m.ready, reason: m.reason, measured: m.measured, cached: false, fresh: true, age_ms: 0 };
}

/**
 * THE ONE IRREVERSIBLE ACT IN THIS MODULE, BOUNDED STRUCTURALLY — R8-3.
 *
 * Creating a Texas registration cannot be undone, and every round of this work has found one more shape that made a
 * present registration look absent. The schema (R8-1) is the fix for the shapes anybody has thought of; this is the
 * fix for the shapes nobody has. Four conditions, and all four have to hold before the POST is built:
 *
 *   (a) the list VALIDATED and the read was a measurement — enforced by reaching this branch at all, because an
 *       unparseable page returns outright above and never gets here;
 *   (b) has_more === false on both pages read — `complete`, checked by the caller: a paged list is never the basis
 *       for a create, because "I did not look" is not "there is none";
 *   (c) TWO WITNESSES, at least TAX_WITNESS_MIN_MS apart. The first validated, complete read that sees no Texas
 *       sales-tax row records tax:registration_witness and creates NOTHING — the create is deferred to a later run.
 *       A second run that also validates and also sees the absence is what authorises it. A false absence therefore
 *       has to be produced TWICE, by two independent reads, thirty seconds apart, to reach the POST; a transient
 *       one — a shape that drifts under load, a page that momentarily answers short — cannot. The witness is dropped
 *       the moment a Texas registration IS seen, and consumed by the create it authorised.
 *   (d) THE LEDGER. tax:registration_create records when a create was last ATTEMPTED and how it went, and no second
 *       attempt is made within TAX_CREATE_COOLDOWN_MS (30 days) of it. This is the backstop that makes the residual
 *       finite and states its size: even if every check above were defeated at once, a false absence costs AT MOST
 *       ONE registration create per 30 days, and the admin report prints the ledger and the reason a create was
 *       withheld, so the attempt is visible rather than inferred.
 *
 * The deterministic Idempotency-Key stays exactly where it was. It collapses a RACE — two isolates past the D1 lock —
 * and it has a 24-hour lifetime; it was never the control for "this code read the account wrongly on Tuesday and
 * again on Friday", and saying so was the overstatement round 8 replaces with something structural.
 */
async function taxCreateGate(env, rowsRead) {
  const now = Date.now();
  const ledger = await taxStateGet(env, TAX_CREATE_KEY);
  const attempts = ledger ? ledger.n : 0;
  const cooldownDays = Math.round(TAX_CREATE_COOLDOWN_MS / 86400000);
  if (ledger && now - ledger.at < TAX_CREATE_COOLDOWN_MS) {
    const daysAgo = Math.round((now - ledger.at) / 86400000);
    return { go: false, attempts, note: 'registration: NOT created — the create ledger (tax:registration_create) records attempt #' + attempts
      + ' (' + taxSafe(env, ledger.note, 40) + ') ' + daysAgo + ' day(s) ago, and no create is attempted within ' + cooldownDays
      + ' days of the last one. If Texas really is missing, that is what the ledger is for: read it, and clear the row deliberately.' };
  }
  const witness = await taxStateGet(env, TAX_WITNESS_KEY);
  const age = witness ? now - witness.at : -1;
  if (!witness || age < TAX_WITNESS_MIN_MS || age > TAX_WITNESS_MAX_MS) {
    await taxStatePut(env, TAX_WITNESS_KEY, 'absent/rows_' + rowsRead, 1);
    return { go: false, attempts, note: 'registration: NOT created on THIS run. A validated, complete read found no US/TX state_sales_tax registration and that is now the FIRST witness (tax:registration_witness); the create needs a SECOND independent read, at least '
      + Math.round(TAX_WITNESS_MIN_MS / 1000) + 's later, that also validates and also finds none. ' + (witness ? 'The previous witness was ' + Math.round(age / 1000) + 's old, outside that window, so it was replaced. ' : '')
      + 'The next run creates it. A registration create is not undoable, so one reading of the account is not enough to make one.' };
  }
  return { go: true, attempts, note: 'Two independent reads ' + Math.round(age / 1000) + 's apart both validated and both found none, and the create ledger allows an attempt (this is attempt #' + (attempts + 1) + ', at most one per ' + cooldownDays + ' days).' };
}

/**
 * The setup itself, on a Stripe account, in the order Stripe needs it: settings → registration → settings again.
 *
 * `write` false is the report — it reads the same things and says what it WOULD do. Nothing else differs, so the report
 * cannot drift from the run.
 */
async function taxRun(env, write) {
  const notes = [];
  // Every Stripe read in this function is validated by the same two functions the measurement uses. An unparseable
  // body is an ERROR here rather than a shrug: this path WRITES to the account, and the round-6 revert measured what a
  // shrug costs — a registrations list this code could not read came out of the `Array.isArray ? … : []` below as ZERO
  // rows, which is indistinguishable from "no Texas registration exists", which creates a second one. A duplicate
  // registration is not undoable.
  let read = await stripeCall(env, '/tax/settings');
  if (!read.ok) return { ok: false, step: 'settings.read', stripe_status: read.status, error: taxError(env, read), notes };
  let shape = validateTaxSettings(read.data);
  if (!shape.ok) return { ok: false, step: 'settings.read', stripe_status: read.status, notes,
    error: { type: 'unparseable_response', code: shape.reason, message: 'GET /v1/tax/settings answered ' + read.status + ' with a body this Worker cannot read (' + shape.reason + '). Nothing was written.' } };
  // Read off the VALIDATED settings, not the raw body: head_office.address.line1 is a field this branch DECIDES on —
  // it is what sends the run into its write branch — so it is in the schema, and reading it anywhere else is exactly
  // the unlisted read the schema exists to make impossible.
  const officeSet = (v) => !!(v.head_office && v.head_office.address && v.head_office.address.line1);
  let hasOffice = officeSet(shape.value);
  if (hasOffice && shape.value.status === 'active') {
    notes.push('settings: already active with a head office; not written.');
  } else if (!write) {
    notes.push('settings: WOULD write the head office and defaults (status ' + taxEnum(env, shape.value.status) + ', head_office ' + (hasOffice ? 'set' : 'missing') + ') — report only, nothing written.');
  } else {
    const form = new URLSearchParams({ ...TAX_HEAD_OFFICE, 'defaults[tax_behavior]': 'exclusive', 'defaults[tax_code]': TAX_CODE_SERVICES });
    const wrote = await stripeCall(env, '/tax/settings', form, TAX_IDEMPOTENCY.settings);
    if (!wrote.ok) return { ok: false, step: 'settings.write', stripe_status: wrote.status, error: taxError(env, wrote), notes };
    notes.push('settings: wrote the Houston head office and the defaults (exclusive, ' + TAX_CODE_SERVICES + ').');
    read = await stripeCall(env, '/tax/settings');
    if (!read.ok) return { ok: false, step: 'settings.readback', stripe_status: read.status, error: taxError(env, read), notes };
    shape = validateTaxSettings(read.data);
    if (!shape.ok) return { ok: false, step: 'settings.readback', stripe_status: read.status, notes,
      error: { type: 'unparseable_response', code: shape.reason, message: 'The read-back of /v1/tax/settings answered ' + read.status + ' with a body this Worker cannot read (' + shape.reason + ').' } };
    hasOffice = officeSet(shape.value);
  }

  // Registration. Both statuses are read, because a registration that has not started yet is 'scheduled' and creating a
  // second one for the same state is not undoable — and because 'scheduled' is not 'collecting', which is a different
  // sentence and has to be reported as one.
  //
  // AND THE CREATE IS GATED ON A COMPLETE, WELL-TYPED READ. `complete` is false when Stripe says there is a page this
  // run did not fetch; an unreadable body returns outright above. Either way the branch that POSTs a new registration
  // is not reached, because "I did not see a Texas registration" and "there is no Texas registration" are different
  // sentences and only the second one may create one.
  const found = [];
  let complete = true;
  for (const status of ['active', 'scheduled']) {
    const list = await stripeCall(env, '/tax/registrations?status=' + status + '&limit=100');
    if (!list.ok) return { ok: false, step: 'registrations.read:' + status, stripe_status: list.status, error: taxError(env, list), notes };
    const page = validateTaxRegistrations(list.data);
    if (!page.ok) return { ok: false, step: 'registrations.read:' + status, stripe_status: list.status, notes,
      error: { type: 'unparseable_response', code: page.reason, message: 'GET /v1/tax/registrations?status=' + status + ' answered ' + list.status + ' with a body this Worker cannot read (' + page.reason + '). Nothing was written: a registration is only created on a MEASURED absence.' } };
    if (page.value.has_more) complete = false;
    for (const r of page.value.rows) found.push(r);
  }
  const salesTax = found.filter(isTexasSalesTax);
  const otherType = found.filter((r) => isTexasAnyType(r) && !isTexasSalesTax(r));
  if (otherType.length) {
    notes.push('registration: ' + otherType.length + ' Texas registration(s) of another type (' + otherType.map((r) => taxEnum(env, r.country_options.us.type)).join(', ') + ') — those are not sales-tax registrations and do not satisfy Texas.');
  }
  let registration = salesTax.find((r) => r.status === 'active') || salesTax[0] || null;
  let createdNow = false;
  if (registration && registration.status === 'active') {
    if (write) await taxStateClear(env, TAX_WITNESS_KEY);
    notes.push('registration: US/TX state_sales_tax already active (' + taxEnum(env, registration.id) + '); not created. ' + found.length + ' registration(s) read, none other touched.');
  } else if (registration) {
    if (write) await taxStateClear(env, TAX_WITNESS_KEY);
    notes.push('registration: US/TX state_sales_tax exists but is SCHEDULED (' + taxEnum(env, registration.id) + ', active_from ' + taxDate(env, registration.active_from) + ') — registered, NOT collecting yet. No second one is created: a duplicate registration is not undoable.');
  } else if (!complete) {
    notes.push('registration: NOT created, and none WOULD be. Stripe says the registration list has more pages than this run read (has_more), so "no US/TX state_sales_tax registration" is not something this run measured — it is something it did not look at. A create on an unmeasured absence is how a second, non-undoable Texas registration gets made. ' + found.length + ' registration(s) read.');
  } else if (!write) {
    notes.push('registration: WOULD create US/TX state_sales_tax active from now, subject to the two-witness rule and the ' + Math.round(TAX_CREATE_COOLDOWN_MS / 86400000) + '-day create ledger — report only, nothing written. ' + found.length + ' existing registration(s) read.');
  } else {
    const gate = await taxCreateGate(env, found.length);
    if (!gate.go) {
      notes.push(gate.note);
    } else {
      const form = new URLSearchParams({ country: 'US', 'country_options[us][type]': 'state_sales_tax', 'country_options[us][state]': 'TX', active_from: 'now' });
      const made = await stripeCall(env, '/tax/registrations', form, TAX_IDEMPOTENCY.registration);
      // THE LEDGER RECORDS THE ATTEMPT, not the success. A refusal that is retried every five minutes forever is the
      // same unbounded write pressure as a duplicate create, and a run that cannot tell an operator when it last
      // tried is a run nobody can audit.
      await taxStatePut(env, TAX_CREATE_KEY, (made.ok ? 'created' : 'refused/' + made.status), gate.attempts + 1);
      await taxStateClear(env, TAX_WITNESS_KEY);
      if (!made.ok) return { ok: false, step: 'registrations.write', stripe_status: made.status, error: taxError(env, made), notes };
      // The thing Stripe just created is a registration row like any other, so it is rebuilt by the row schema rather
      // than read off the response — one validator per shape, including the shape a POST answers with.
      const bornShape = validateTaxRegistrations({ object: 'list', data: [made.data], has_more: false });
      if (!bornShape.ok) return { ok: false, step: 'registrations.write', stripe_status: made.status, notes,
        error: { type: 'unparseable_response', code: bornShape.reason, message: 'POST /v1/tax/registrations answered ' + made.status + ' with a body this Worker cannot read (' + bornShape.reason + '). The registration may exist; the next run reads it rather than creating another (deterministic Idempotency-Key).' } };
      registration = bornShape.value.rows[0];
      createdNow = true;
      notes.push('registration: created US/TX state_sales_tax (' + taxEnum(env, registration.id) + '). ' + gate.note);
    }
  }

  if (write) {
    const final = await stripeCall(env, '/tax/settings');
    if (!final.ok) return { ok: false, step: 'settings.final', stripe_status: final.status, error: taxError(env, final), notes };
    const finalShape = validateTaxSettings(final.data);
    if (!finalShape.ok) return { ok: false, step: 'settings.final', stripe_status: final.status, notes,
      error: { type: 'unparseable_response', code: finalShape.reason, message: 'The final read of /v1/tax/settings answered ' + final.status + ' with a body this Worker cannot read (' + finalShape.reason + ').' } };
    read = final;
    shape = finalShape;
    hasOffice = officeSet(shape.value);
  }
  notes.push('Tax is EXCLUSIVE: added on top of the listed price, never folded into it.');
  notes.push('Tangible goods would use ' + TAX_CODE_GOODS + '; no route sells goods through Checkout today, so nothing is tagged with it.');
  if (!write) notes.push('report only — no POST was made to Stripe.');
  if (String(env.STRIPE_TAX) !== '1') notes.push('STRIPE_TAX is not "1" on this Worker: Stripe Tax can be set up on the ACCOUNT but no checkout asks for it.');

  // Every Stripe-controlled string in the report goes out through taxEnum: they are enums and ids, so they are checked
  // AGAINST THE SHAPES THEY ARE ALLOWED TO BE rather than scrubbed of the shapes a denylist happens to know. The
  // round-2 probe that read a planted key back out of settings.status is why they are not trusted to stay enums.
  // active_from is a timestamp, so it gets taxDate — the same allow-list question asked of the two shapes a timestamp
  // is allowed to be. It used to get taxSafe, the free-text scrubber, which is the wrong tool for a field with a shape.
  return {
    ok: true,
    settings: { status: taxEnum(env, shape.value.status), head_office_set: hasOffice },
    registration: {
      id: registration ? taxEnum(env, registration.id) : null,
      status: registration ? taxEnum(env, registration.status) : null,
      type: registration && registration.country_options && registration.country_options.us ? taxEnum(env, registration.country_options.us.type) : (registration ? 'state_sales_tax' : null),
      collecting: !!(registration && registration.status === 'active'),
      created_now: createdNow,
    },
    notes,
  };
}

/** A thrown exception, in the same shape every other tax failure reports, so the heartbeat and the redacted 502 both
 *  still happen instead of a bare 500 with no stamp. */
function taxThrew(env, e) {
  return { ok: false, step: 'exception', stripe_status: null, notes: [],
    error: { type: 'worker_exception', code: '', message: taxSafe(env, (e && e.message) || 'The setup run threw.') } };
}

/**
 * Make the Stripe account match the code — from the cron, from the refresh a checkout enqueued, or from
 * POST /admin/tax/setup. THE WORKER IS TAX-SELF-SUFFICIENT: no CI secret, no Dashboard, no hand-run curl is required for
 * the account to end up set up, because the Worker itself is the thing that notices and repairs it. One precondition,
 * and it is not rhetorical: D1 must be writable, because a run that cannot take the lock does not run.
 *
 * EVERY PATH INTO HERE IS OFF THE CUSTOMER'S. The two POSTs carry deterministic Idempotency-Keys, so neither a race nor
 * a retry can produce a second Texas registration, and the lock window bounds the WORK to one measurement plus at most
 * one setup attempt per TAX_LOCK_MS. Every run that takes the window leaves a heartbeat and re-measures readiness, so
 * the next checkout reads a cache that matches the account.
 *
 * `background` is the cron and the checkout refresh: they MEASURE first and write to Stripe only if the account is
 * really not collecting, and they do nothing whatsoever when the window is held — no report, no Stripe read. An admin
 * call is a person asking, so it runs the full idempotent setup and reports what it found either way.
 */
async function ensureTaxSetup(env, opts = {}) {
  const dry = !!opts.dry;
  const background = !!opts.background;
  const trigger = opts.trigger || 'manual';
  if (!env.STRIPE_SECRET_KEY) {
    return { ok: false, http: 503, step: 'config', stripe_status: null, notes: [],
      error: { type: 'worker_configuration', code: 'stripe_key_missing', message: 'Payments are not configured: STRIPE_SECRET_KEY is not set on this Worker.' } };
  }
  // THE REPORT READS D1 AND NOTHING ELSE. It was labelled read-only in four places while it re-measured the account and
  // REWROTE the readiness row every checkout gates on — so a smoke run that caught a Stripe timeout left an UNMEASURED
  // row behind and the next minute of checkouts sold untaxed. A report that can change what it reports is not a report.
  // It also needs no lock now, because a D1 read is not a Stripe call: ten reports cost ten SELECTs and zero requests to
  // Stripe. The live read is the POST, which takes the lock like every other writing path.
  if (dry) {
    const state = await taxReadyCached(env);
    return { ok: true, dry: true, read_only: true, ready: state, settings: null, registration: null,
      notes: ['read-only: this report is the cached measurement and the heartbeat, both read from D1. No Stripe call was made and no tax row was written (the /admin rate-limit counter still increments, as it does on every admin request). POST /admin/tax/setup is the live read (and the idempotent setup).'] };
  }

  if (!(await takeTaxLock(env))) {
    if (background) {
      console.log(JSON.stringify({ tax_setup: 'window_held', trigger }));
      return { ok: true, dry: false, locked_out: true, background: true, notes: [] };
    }
    const held = await taxRun(env, false);
    if (held.ok) held.notes.unshift('another setup run holds the lock (' + Math.round(TAX_LOCK_MS / 1000) + 's); this one wrote nothing.');
    return { ...held, dry: false, locked_out: true };
  }
  let res;
  try {
    if (background) {
      // Measure before writing: an account already collecting needs no run, and an account that could not be READ is
      // one this must not WRITE to — a blind write is how a stuck account got 6.6 Stripe calls per checkout in round 2.
      const seen = await taxMeasure(env);
      if (seen.ready || !seen.measured) {
        await taxRunStamp(env, trigger + '/' + (seen.ready ? 'ready' : seen.reason), !!seen.measured);
        console.log(JSON.stringify({ tax_setup: seen.ready ? 'ready' : seen.reason, trigger, ready: seen.ready, measured: seen.measured }));
        return { ok: true, dry: false, background: true, measured_only: true, ready: seen, notes: [] };
      }
    }
    res = await taxRun(env, true);
  } catch (e) {
    // A throw used to skip the heartbeat and answer a bare 500 (round-2 probe: a settings body of literal null). An
    // exception is an outcome like any other — it is stamped, redacted, and reported as the 502 it is.
    res = taxThrew(env, e);
  } finally {
    await holdTaxWindow(env);
  }
  const outcome = res.ok ? (res.registration.created_now ? 'created' : 'ok') : ('error:' + res.step);
  // res.ok means every read in the run answered, which is the successful measurement that clears the streak.
  await taxRunStamp(env, trigger + '/' + outcome, res.ok);
  // The account just changed: re-measure rather than serving a cache written before the write.
  const m = await taxMeasure(env).catch(() => ({ ready: false, reason: 'measure_failed', measured: false, cached: false, fresh: false, age_ms: 0 }));
  console.log(JSON.stringify({ tax_setup: outcome, trigger, ready: m.ready, reason: m.reason }));
  return { ...res, dry: false, ready: m };
}

/**
 * POST /admin/tax/setup — run the idempotent setup against Stripe and report. GET, or `?dry=1`, report from D1 alone:
 * no Stripe call, no row written, which is what "read-only" has to mean to be worth printing.
 *
 * `tax_ready` is the boolean every checkout gates on. `tax_ready_cache` is the row it reads — its age, its TTL, its
 * grace, and whether a re-measurement is overdue — built from taxReadyCached rather than from the measurement this
 * request happens to have made, because a field that can only ever say `age_seconds: 0` reports nothing.
 *
 * `last_run` and `cron_last_run` ARE TWO DIFFERENT MEASUREMENTS and round 9 stopped reading the first as the second.
 * `last_run` is the last measurement of ANY origin — a cron, an /admin call, or the refresh a checkout enqueued — and
 * that last origin is what made it useless as liveness: a site taking orders refreshes it all day with the scheduler
 * dead. `cron_last_run` is stamped by a cron trigger and by nothing else, so `loop_stale` is a statement about
 * Cloudflare's scheduler and about nothing else. Both print, because both are worth knowing and they answer different
 * questions: a fresh last_run with a stale cron_last_run is a loop that stopped and orders that are covering for it.
 *
 * `tax_fallback_streak` is the double fault, and it is the one number here that can be nonzero while every other field
 * on this page looks healthy: tax_ready true, a fresh cache, a recent heartbeat, and every order for the last day sold
 * untaxed because Stripe refused each tax-carrying Session and the retry quietly completed the sale without tax.
 *
 * THE NUMBER IS REPORTED ALWAYS; THE ALARM NEEDS A SECOND WITNESS. Round 6 put the note behind the count alone, and
 * the count is raised by anything that can POST a checkout — one anonymous address driving five refused Sessions on a
 * healthy account produced a paragraph asserting that orders were completing untaxed and that the tax endpoints were
 * not answering. Neither is carried by a counter of refusals: the streak knows that Stripe said no to a tax-carrying
 * body, and nothing else. So the alarm now needs the OTHER half of the double fault actually measured — a readiness
 * row that says UNMEASURED, or a ready row nothing has managed to refresh (kept alive by the grace, which is the same
 * fault seen from the row's side). Streak alone, on a freshly measured account, is a number and no words.
 *
 * And the words themselves claim only what is held: N Sessions were refused, readiness is measured or it is not.
 * Whether those orders COMPLETED is the retry's outcome, not this counter's, and saying so was an overclaim.
 */
async function handleTaxSetup(request, env, cors, url) {
  const dry = request.method === 'GET' || url.searchParams.get('dry') === '1';
  const res = await ensureTaxSetup(env, { dry, trigger: dry ? 'report' : 'admin' });
  if (!res.ok) return json({ step: res.step, error: res.error, stripe_status: res.stripe_status, notes: res.notes }, res.http || 502, cors);

  // The cache is read on BOTH paths, because it is what a checkout reads. `tax_ready` is the live measurement when this
  // request made one (POST) and the cached one otherwise; `tax_ready_cache` always describes the row.
  const cache = await taxReadyCached(env);
  const state = res.ready || cache;
  const run = await taxStateGet(env, TAX_RUN_KEY);
  const runAge = run ? Date.now() - run.at : null;
  // R9-4: LIVENESS IS A DIFFERENT QUESTION FROM "when did a measurement last happen", and last_run only ever answered
  // the second one. A checkout that finds the measurement due enqueues a run, and that run stamps last_run — so on a
  // site taking orders last_run stays fresh whether or not Cloudflare has fired a trigger since the deploy, which is
  // precisely the failure a heartbeat exists to show. tax:cron_last_run is written by a cron trigger and by nothing
  // else, so `loop_stale` means the scheduler, and last_run keeps its own honest meaning. Both print.
  const cronRun = await taxStateGet(env, TAX_CRON_RUN_KEY);
  const cronAge = cronRun ? Date.now() - cronRun.at : null;
  const loopStale = !cronRun || cronAge > TAX_RUN_STALE_MS;
  // The streak is read from its OWN row now (R8-5). While it shared the heartbeat's, an anonymous refused checkout
  // INSERTED that row with a current timestamp, so a Worker whose loop had never run reported a fresh heartbeat.
  const streakRow = await taxStateGet(env, TAX_STREAK_KEY);
  const streak = streakRow && streakRow.n > 0 ? streakRow.n : 0;
  // The create ledger and the standing witness, printed on every report — the irreversible act is the one thing an
  // operator should never have to read a run log to account for.
  const created = await taxStateGet(env, TAX_CREATE_KEY);
  const witness = await taxStateGet(env, TAX_WITNESS_KEY);
  // The corroboration, read from the row rather than inferred from the note: UNMEASURED is the measurement saying it
  // could not be made, and a READY row past its TTL is the same fault seen from the other side — nothing has been able
  // to refresh it, so the grace is what is holding tax on.
  const readyRow = await taxStateGet(env, TAX_READY_KEY);
  const readiness = !readyRow ? 'never_measured'
    : readyRow.n === TAX_UNMEASURED ? 'unmeasured'
    : cache.stale ? 'kept_ready'
    : 'measured';
  const alarm = streak >= TAX_FALLBACK_LOUD && readiness !== 'measured';
  const notes = [...(res.notes || [])];
  if (alarm) {
    notes.push('tax_fallback_streak is ' + streak + ': ' + streak + ' consecutive tax-carrying Checkout Sessions were refused by Stripe; readiness is not confirmed (' + readiness + '), so the row every checkout gates on is held by the grace rather than confirmed. That is the double fault. This counter does NOT say those orders completed — each refusal starts one tax-off retry, which has its own outcome — and it does not say an endpoint is down. Read last_run for what the measurement is failing on.');
  }
  return json({
    dry,
    settings: res.settings,
    registration: res.registration,
    tax_ready: state.ready,
    tax_ready_reason: taxSafe(env, state.reason, 60),
    tax_ready_cache: { cached: !!cache.cached, measured_at: cache.measured_at, age_seconds: Math.round((cache.age_ms || 0) / 1000),
      ttl_seconds: Math.round((cache.ttl_ms || TAX_READY_TTL_MS) / 1000), grace_seconds: Math.round(TAX_READY_GRACE_MS / 1000), stale: !!cache.stale },
    last_run: run ? { at: new Date(run.at).toISOString(), outcome: taxSafe(env, run.note, 60), age_hours: Math.round(runAge / 36000) / 100, stale: runAge > TAX_RUN_STALE_MS,
      origin: 'any — a cron, an /admin call, or the refresh a checkout enqueued. Read loop liveness from cron_last_run.' } : null,
    cron_last_run: cronRun ? { at: new Date(cronRun.at).toISOString(), trigger: taxSafe(env, cronRun.note, 40),
      age_hours: Math.round(cronAge / 36000) / 100, stale: loopStale } : null,
    loop_stale: loopStale,
    tax_fallback_streak: streak,
    tax_readiness: readiness,
    tax_fallback_alarm: alarm,
    registration_create_ledger: created ? { last_attempt_at: new Date(created.at).toISOString(), outcome: taxSafe(env, created.note, 60), attempts: created.n,
      cooldown_days: Math.round(TAX_CREATE_COOLDOWN_MS / 86400000), next_attempt_allowed_at: new Date(created.at + TAX_CREATE_COOLDOWN_MS).toISOString() } : null,
    registration_create_witness: witness ? { at: new Date(witness.at).toISOString(), age_seconds: Math.round((Date.now() - witness.at) / 1000),
      note: taxSafe(env, witness.note, 60), second_witness_due_in_seconds: Math.max(0, Math.round((TAX_WITNESS_MIN_MS - (Date.now() - witness.at)) / 1000)) } : null,
    read_only: !!res.read_only,
    locked_out: !!res.locked_out,
    notes,
  }, 200, cors);
}

/* ─────────────────────────── Admin roster ─────────────────────────── */

async function handleRoster(request, env, cors) {
  const url = new URL(request.url);
  if (!adminKeyOk(request, env)) {
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

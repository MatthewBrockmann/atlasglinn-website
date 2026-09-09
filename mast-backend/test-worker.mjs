import worker from './src/worker.js';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra); }
};

// ── every source file must parse ──
// The tests never import agreement-asset.js (it carries a .pdf Data module Node cannot load), so a syntax error there
// reached `wrangler deploy` once (a star-slash inside a block comment). `node --check` parses each file without running it.
const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), 'src');
for (const f of readdirSync(SRC).filter(n => n.endsWith('.js')).sort()) {
  let err = '';
  try { execFileSync(process.execPath, ['--check', path.join(SRC, f)], { stdio: ['ignore', 'ignore', 'pipe'] }); } catch (e) { err = String(e.stderr || e.message).split('\n').slice(0, 3).join(' | '); }
  ok(`parses: src/${f}`, !err, err);
}

// ── fake env ──
const stripeCalls = [];
const stored = [];
const emails = [];
let resendStatus = 200;      // flip to 500 to make the next Resend call fail (the digest retry test)
let resendGate = null;       // set to a promise to park the Resend call (the "the response never waits for the mail" probe)
const mailchimpCalls = [];   // PUT /3.0/lists/<list>/members/<md5>
const hubspotCalls = [];     // POST crm/v3/objects/contacts/batch/upsert
const brevoCalls = [];       // POST /v3/contacts
const orderRows = [];        // INSERT INTO orders as objects (the CRM reads them back)
const contacts = [];         // CRM leads
const events = [];           // CRM beacon
const emailLog = [];         // journeys idempotency

const stripePriceCalls = [];   // GET /v1/prices?lookup_keys[] and POST /v1/prices (membership price provisioning)
const stripeCustomerCalls = [];   // /v1/customers (account cards)
let fakeDefaultCard = null;         // what GET /v1/customers/<id>?expand=... returns as the default payment method
const fakePrices = [];         // prices "in Stripe" ({ id, lookup_key })
let stripeGate = null;         // set to a promise to hold the Checkout Session call open (the oversell-race test)
let sealedJson = null;         // what raw.githubusercontent.com serves for the sealed range directions (null = 404)
const workerKeys = new Map();  // worker_keys rows (the sealing key pair)
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes('raw.githubusercontent.com')) return sealedJson ? new Response(JSON.stringify(sealedJson), { status: 200 }) : new Response('404: Not Found', { status: 404 });
  if (u.includes('api.stripe.com/v1/prices')) {
    const method = (init && init.method) || 'GET';
    stripePriceCalls.push({ method, url: u, body: init && init.body ? new URLSearchParams(init.body) : null });
    if (method === 'GET') return new Response(JSON.stringify({ data: fakePrices.filter(p => u.includes(encodeURIComponent(p.lookup_key))) }), { status: 200 });
    const b = new URLSearchParams(init.body); const price = { id: 'price_new_' + b.get('lookup_key'), lookup_key: b.get('lookup_key') }; fakePrices.push(price);
    return new Response(JSON.stringify(price), { status: 200 });
  }
  if (u.includes('api.stripe.com/v1/customers')) {
    const method = (init && init.method) || 'GET';
    stripeCustomerCalls.push({ method, url: u, body: init && init.body ? new URLSearchParams(init.body) : null });
    if (method === 'POST' && /\/v1\/customers$/.test(u)) return new Response(JSON.stringify({ id: 'cus_test_1' }), { status: 200 });
    if (method === 'GET') return new Response(JSON.stringify({ id: 'cus_test_1', invoice_settings: { default_payment_method: fakeDefaultCard } }), { status: 200 });
    return new Response(JSON.stringify({ id: 'cus_test_1' }), { status: 200 });
  }
  if (u.includes('api.stripe.com/v1/setup_intents')) return new Response(JSON.stringify({ id: 'seti_1', payment_method: 'pm_saved_1' }), { status: 200 });
  if (u.includes('api.stripe.com')) {
    stripeCalls.push(new URLSearchParams(init.body));
    if (stripeGate) await stripeGate;   // held open by the oversell-race test; null everywhere else
    return new Response(JSON.stringify({ id: 'cs_test_123', url: 'https://checkout.stripe.com/pay/cs_test_123' }), { status: 200 });
  }
  if (String(url).includes('api.resend.com')) {
    if (resendGate) await resendGate;
    if (resendStatus !== 200) return new Response('{"message":"upstream refused"}', { status: resendStatus });
    emails.push(JSON.parse(init.body));
    return new Response('{}', { status: 200 });
  }
  if (u.includes('api.hubapi.com')) { hubspotCalls.push({ url: u, auth: (init && init.headers && init.headers.Authorization) || '', body: JSON.parse(init.body) }); return new Response('{"status":"COMPLETE"}', { status: 200 }); }
  if (u.includes('api.brevo.com')) { brevoCalls.push({ url: u, key: (init && init.headers && init.headers['api-key']) || '', body: JSON.parse(init.body) }); return new Response('{"id":1}', { status: 201 }); }
  if (u.includes('api.mailchimp.com')) {
    mailchimpCalls.push({ url: u, method: (init && init.method) || 'GET', auth: (init && init.headers && init.headers.Authorization) || '', body: JSON.parse(init.body) });
    return new Response('{"id":"x"}', { status: 200 });
  }
  return new Response('{}', { status: 200 });
};

// Registration tables (fake D1 keeps them in memory so the flow can be asserted end to end).
const registrations = new Map();   // id -> row
const accounts = new Map();        // id -> row (student accounts)
const outcomes = [];               // eligibility_outcomes rows
const answers = [];                // eligibility_answers rows
const orderUpdates = [];           // UPDATE orders ... from completeRegistration
const fakePlans = {                // memberships rows; a plan without a stripe_price_id is provisioned on first join
  range_member: { plan_key: 'range_member', name: 'Range Member', stripe_price_id: 'price_live_rm', price_cents: 9900, interval: 'month' },
  red_team: { plan_key: 'red_team', name: 'Red Team', stripe_price_id: '', price_cents: 25000, interval: 'month' },
  le_team: { plan_key: 'le_team', name: 'Law Enforcement', stripe_price_id: 'price_live_le', price_cents: 19500, interval: 'month' },
};
// The Worker's HOLDING_SEATS predicate, in JavaScript: a pending row holds a seat for 15 minutes once it carries a
// Stripe session id, and for 2 minutes before that.
const holdsASeat = (r, live, fresh) => r.status === 'pending' && (r.stripe_session_id ? r.created_at > live : r.created_at > fresh);
const pendingSignups = new Map();  // pending_signups rows: signup_id -> row (ONE ROW PER SIGN-UP since round 7; the address is not a key)
let pendingSeq = 0;                // stands in for SQLite's rowid: the tiebreak when two rows carry the same created_at
const pendingAt = (digest) => [...pendingSignups.values()].filter((r) => r.address_digest === digest);
const pendingLive = (digest, now) => pendingAt(digest).filter((r) => r.verify_expires_at && r.verify_expires_at > now);
const rateLimits = new Map();      // rate_limits rows: key -> { key, window_start, count }
/* EVERY key the table has ever been asked about, kept across resetLimits() (round 6). The "no key carries a plaintext
   address" assertion used to read rateLimits.keys() at one instant, which is whatever the last few requests happened to
   leave behind — it passed with the loginfail key back in clear, because no loginfail row existed at that moment. The
   key is read off the statement rather than assumed to be args[0], so a family added later is covered without an edit. */
const rateKeysEver = new Set();
const rateKeyArg = (sql) => {
  const m = /\bkey (?:=|LIKE) \?/.exec(sql);
  if (m) return (sql.slice(0, m.index).match(/\?/g) || []).length;
  return /INSERT OR IGNORE INTO rate_limits \(key,/.test(sql) ? 0 : -1;
};
const resetLimits = () => rateLimits.clear();   // a fresh window; the per-IP limits get their own block below
let rateFail = false;              // flip on to make every rate_limits statement throw (the fail-closed test)
const sqlLog = [];
let onEligibilityInsert = null;    // fired once, between the capacity SELECT and the seat claim (the oversell window)
const REG_COLS = ['id','created_at','status','sku','item_name','qty','session_date','session_label','customer_name','customer_email','customer_phone','organization','address1','address2','emergency_name','emergency_phone','emergency_relationship','eligibility_outcome_id','eligibility_status','questions_version','agreement_version','agreement_signed_name','agreement_initials','agreement_signed_at','agreement_ip','agreement_user_agent','refund_policy_version','refund_policy_accepted_at','refund_policy_ip','newsletter_opt_in','newsletter_opted_in_at','prereq_attested','utm_source','utm_medium','utm_campaign','referrer','landing_page','first_touch_at','visitor'];

const DB = {
  prepare(sql) {
    sqlLog.push(sql);
    return {
      bind(...args) { return this._b(args); },
      _b(args) {
        return {
          __sql: sql, __args: args,
          async first() {
            if (sql.includes('FROM worker_keys')) return workerKeys.get(args[0]) || null;
            if (sql.includes('SUM(qty)') && sql.includes('FROM registrations')) {
              // The Worker's HOLDING_SEATS predicate: with a session id the hold is 15 minutes, without one 2 minutes
              // (security review round 2, 2026-09-08). Both cutoffs are bound, live first.
              const [live, fresh] = [args[2], args[3]];
              let n = 0;
              for (const r of registrations.values()) if (r.sku === args[0] && r.session_date === args[1] && (r.status === 'paid' || holdsASeat(r, live, fresh))) n += Number(r.qty || 1);
              return { n };
            }
            if (sql.includes('COUNT(*)') && sql.includes('FROM registrations') && sql.includes("status = 'pending'")) {
              // Same predicate, then the trailing "AND <col> = ?" clauses: one for the connection, two for the pair.
              const cols = [...sql.matchAll(/AND (\w+) = \?/g)].map((m) => m[1]);
              const [live, fresh] = [args[0], args[1]];
              let n = 0;
              for (const r of registrations.values()) if (holdsASeat(r, live, fresh) && cols.every((c, i) => r[c] === args[2 + i])) n++;
              return { n };
            }
            if (sql.includes('FROM rate_limits')) { rateKeysEver.add(args[0]); if (rateFail) throw new Error('D1_ERROR: rate_limits unavailable'); const row = rateLimits.get(args[0]); return row ? { ...row } : null; }
            if (sql.includes('FROM offerings')) {
              const row = { 'MAST-DA': { sku: 'MAST-DA', name: 'Direct Action', price_cents: 69500, capacity: 10 },
                            'MAST-HG-OP': { sku: 'MAST-HG-OP', name: 'Handgun Operator', price_cents: 45000, capacity: 10 },
                            'MAST-HG-FUND': { sku: 'MAST-HG-FUND', name: 'Handgun Fundamentals', price_cents: 22500, capacity: 16 },
                            'MAST-HG-LADIES': { sku: 'MAST-HG-LADIES', name: 'Ladies Only Handgun Fundamentals', price_cents: 22500, capacity: 16 },
                            'MAST-CAR-OP': { sku: 'MAST-CAR-OP', name: 'Carbine Operator', price_cents: 45000, capacity: 10 },
                            'MAST-NVG-P2': { sku: 'MAST-NVG-P2', name: 'NVG Operator P2', price_cents: 95000, capacity: 10 },
                            'MAST-TEAM-P1': { sku: 'MAST-TEAM-P1', name: 'Team Tactics P1', price_cents: 45000, capacity: 10 },
                            'MAST-VEH-P2': { sku: 'MAST-VEH-P2', name: 'Vehicular Tactics / Team Tactics P2', price_cents: 50000, capacity: 10 },
                            'MAST-SF-P1': { sku: 'MAST-SF-P1', name: 'Select-Fire M4A1 / MK18 Operator P1', price_cents: 50000, capacity: 10 } }[args[0]];
              return row || null;
            }
            if (sql.includes('FROM memberships')) return fakePlans[args[0]] || null;
            if (sql.includes('FROM registrations WHERE id')) return registrations.get(args[0]) || null;
            if (sql.includes('FROM email_log')) { const k = (/kind = '(\w+)'/.exec(sql) || [])[1]; const l = emailLog.find(x => x.email === args[0] && x.ref === args[1] && x.kind === k); return l ? { ...l } : null; }
            if (sql.startsWith('SELECT MAX(verify_attempts)')) {
              // MAX across the live rows at the address: a row created later starts at 0 and cannot lower it, which is
              // what stops a stranger deferring the burn by opening a sign-up (round 7).
              const live = pendingLive(args[0], args[1]);
              return { used: live.length ? Math.max(...live.map((r) => r.verify_attempts || 0)) : null };
            }
            if (sql.includes('FROM pending_signups WHERE address_digest = ? AND code_hash = ?')) {
              const live = pendingLive(args[0], args[2]).filter((r) => r.code_hash === args[1]);
              live.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || b.__seq - a.__seq);
              return live.length ? { ...live[0] } : null;   // ORDER BY created_at DESC LIMIT 1
            }
            if (sql.includes('FROM pending_signups WHERE address_digest = ? ORDER BY created_at DESC')) {
              const rows = pendingAt(args[0]).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || b.__seq - a.__seq);
              return rows.length ? { ...rows[0] } : null;
            }
            if (sql.includes('FROM accounts WHERE email')) { for (const a of accounts.values()) if (a.email === args[0]) return { ...a }; return null; }
            if (sql.includes('FROM accounts WHERE id')) return accounts.has(args[0]) ? { ...accounts.get(args[0]) } : null;
            return null;
          },
          async run() {
            if (sql.includes('INSERT INTO orders')) {
              stored.push(args);
              const cols = sql.slice(sql.indexOf('(') + 1, sql.indexOf(')')).split(',').map(c => c.trim());
              const vals = [...args]; vals.splice(cols.indexOf('status'), 0, 'paid');   // the SQL carries 'paid' as a literal
              const row = Object.fromEntries(cols.map((c, i) => [c, vals[i]]));
              if (!orderRows.some(o => o.stripe_session_id === row.stripe_session_id)) orderRows.push(row);
            }
            if (sql.startsWith('INSERT INTO contacts')) { const cols = sql.slice(sql.indexOf('(') + 1, sql.indexOf(')')).split(',').map(c => c.trim()); contacts.push(Object.fromEntries(cols.map((c, i) => [c, args[i]]))); return { meta: { changes: 1 } }; }
            if (sql.startsWith('UPDATE contacts SET emailed = 1')) { const c = contacts.find(x => x.id === args[0]); if (c) c.emailed = 1; return { meta: { changes: c ? 1 : 0 } }; }
            if (sql.startsWith('INSERT INTO events')) { const cols = sql.slice(sql.indexOf('(') + 1, sql.indexOf(')')).split(',').map(c => c.trim()); events.push(Object.fromEntries(cols.map((c, i) => [c, args[i]]))); return { meta: { changes: 1 } }; }
            if (sql.startsWith('INSERT OR IGNORE INTO email_log')) { const [created_at, email, ref, kind, status] = args; if (emailLog.some(l => l.email === email && l.ref === ref && l.kind === kind)) return { meta: { changes: 0 } }; emailLog.push({ created_at, email, ref, kind, status }); return { meta: { changes: 1 } }; }
            if (sql.startsWith('UPDATE email_log SET status')) { const st = /status = '(\w+)'/.exec(sql)[1]; const l = emailLog.find(x => x.email === args[0] && x.ref === args[1] && x.kind === args[2]); if (l) l.status = st; return { meta: { changes: l ? 1 : 0 } }; }
            if (sql.startsWith('UPDATE email_log SET created_at')) { const l = emailLog.find(x => x.email === args[1] && x.ref === args[2] && x.kind === args[3]); if (l) l.created_at = args[0]; return { meta: { changes: l ? 1 : 0 } }; }
            if (sql.startsWith('DELETE FROM email_log')) { const st = (/status = '(\w+)'/.exec(sql) || [])[1]; const i = emailLog.findIndex(x => x.email === args[0] && x.ref === args[1] && x.kind === args[2] && (!st || x.status === st)); if (i >= 0) emailLog.splice(i, 1); return { meta: { changes: i >= 0 ? 1 : 0 } }; }
            if (sql.startsWith('INSERT OR IGNORE INTO worker_keys')) { const [name, created_at, key_id, public_jwk, private_jwk] = args; if (!workerKeys.has(name)) workerKeys.set(name, { name, created_at, key_id, public_jwk, private_jwk }); return { meta: { changes: 1 } }; }
            if (sql.includes('pending_signups')) {
              if (sql.startsWith('INSERT OR REPLACE INTO pending_signups')) {
                const cols = sql.slice(sql.indexOf('(') + 1, sql.indexOf(')')).split(',').map((c) => c.trim());
                const vals = [...args]; vals.splice(cols.indexOf('verify_attempts'), 0, 0);   // the SQL carries 0 as a literal
                const row = Object.fromEntries(cols.map((c, i) => [c, vals[i]]));
                // The key is a fresh signup_id, so REPLACE can only ever fire on the non-mailing branch's constant.
                row.__seq = ++pendingSeq;   // rowid: a REPLACE gets a new one, exactly as SQLite does
                pendingSignups.set(row.signup_id, row);
                return { meta: { changes: 1 } };
              }
              if (sql.startsWith('UPDATE pending_signups SET verify_attempts = verify_attempts + 1')) {
                const [digest, now, max] = args;
                let n = 0;
                for (const r of pendingLive(digest, now)) if ((r.verify_attempts || 0) < max) { r.verify_attempts = (r.verify_attempts || 0) + 1; n++; }
                return { meta: { changes: n } };   // one statement, however many rows the address holds
              }
              if (sql.startsWith('UPDATE pending_signups SET code_hash = ?')) {
                const keys = [...sql.matchAll(/(\w+) = \?/g)].map((m) => m[1]); const row = pendingSignups.get(args[args.length - 1]);
                if (row) keys.forEach((k, i) => { row[k] = args[i]; });
                return { meta: { changes: row ? 1 : 0 } };
              }
              if (sql.startsWith('DELETE FROM pending_signups WHERE address_digest = ? AND ? >= ?')) {
                // The burn, and the reason its predicate looks odd: the statement runs on EVERY refused verification and
                // the binds decide whether it removes anything, so the twentieth guess costs what the first one costs.
                if (!(Number(args[1]) >= Number(args[2]))) return { meta: { changes: 0 } };
                let n = 0; for (const r of pendingAt(args[0])) { pendingSignups.delete(r.signup_id); n++; }
                return { meta: { changes: n } };
              }
              if (sql.startsWith('DELETE FROM pending_signups WHERE address_digest = ? AND signup_id <> ?')) {
                let n = 0; for (const r of pendingAt(args[0])) if (r.signup_id !== args[1]) { pendingSignups.delete(r.signup_id); n++; }
                return { meta: { changes: n } };
              }
              if (sql.startsWith('DELETE FROM pending_signups WHERE signup_id')) { const had = pendingSignups.delete(args[0]); return { meta: { changes: had ? 1 : 0 } }; }
              if (sql.startsWith('DELETE FROM pending_signups WHERE created_at')) { let n = 0; for (const [k, r] of [...pendingSignups]) if (r.created_at < args[0]) { pendingSignups.delete(k); n++; } return { meta: { changes: n } }; }
              return { meta: { changes: 0 } };
            }
            if (sql.includes('rate_limits')) {
              const ki = rateKeyArg(sql); if (ki >= 0 && typeof args[ki] === 'string') rateKeysEver.add(args[ki]);
              if (rateFail) throw new Error('D1_ERROR: rate_limits unavailable');
              if (sql.startsWith('INSERT OR IGNORE INTO rate_limits')) { const [key, window_start, count] = args; if (rateLimits.has(key)) return { meta: { changes: 0 } }; rateLimits.set(key, { key, window_start, count }); return { meta: { changes: 1 } }; }
              if (sql.startsWith('UPDATE rate_limits SET window_start = ?, count = ?')) { const [window_start, count, key, cutoff] = args; const r = rateLimits.get(key); if (!r || !(r.window_start <= cutoff)) return { meta: { changes: 0 } }; r.window_start = window_start; r.count = count; return { meta: { changes: 1 } }; }
              if (sql.startsWith('UPDATE rate_limits SET count = count + 1 WHERE key = ? AND count < ?')) { const [key, limit] = args; const r = rateLimits.get(key); if (!r || !(r.count < limit)) return { meta: { changes: 0 } }; r.count += 1; return { meta: { changes: 1 } }; }
              // The (ip, address) sign-in failure counter: an unconditional bump, and a lock expiry that is never shortened.
              if (sql.startsWith('UPDATE rate_limits SET count = count + 1 WHERE key = ?')) { const r = rateLimits.get(args[0]); if (!r) return { meta: { changes: 0 } }; r.count += 1; return { meta: { changes: 1 } }; }
              if (sql.startsWith('UPDATE rate_limits SET window_start = ? WHERE key = ? AND window_start <')) { const [until, key, floor] = args; const r = rateLimits.get(key); if (!r || !(r.window_start < floor)) return { meta: { changes: 0 } }; r.window_start = until; return { meta: { changes: 1 } }; }
              if (sql.startsWith('DELETE FROM rate_limits WHERE key = ?')) { const had = rateLimits.delete(args[0]); return { meta: { changes: had ? 1 : 0 } }; }
              if (sql.startsWith('DELETE FROM rate_limits WHERE key LIKE ?')) {
                const like = new RegExp('^' + args[0].split('%').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
                let n = 0; for (const k of [...rateLimits.keys()]) if (like.test(k)) { rateLimits.delete(k); n++; }
                return { meta: { changes: n } };
              }
              if (sql.startsWith('DELETE FROM rate_limits')) { let n = 0; for (const [k, r] of [...rateLimits]) if (r.window_start < args[0]) { rateLimits.delete(k); n++; } return { meta: { changes: n } }; }
              return { meta: { changes: 0 } };
            }
            if (sql.startsWith('UPDATE accounts SET failed_logins = failed_logins + 1')) { const row = accounts.get(args[0]); if (!row) return { meta: { changes: 0 } }; row.failed_logins = (row.failed_logins || 0) + 1; return { meta: { changes: 1 } }; }
            if (sql.startsWith('UPDATE accounts SET locked_until = ?') && sql.includes('locked_until IS NULL OR locked_until <')) { const [until, id, floor] = args; const row = accounts.get(id); if (!row || (row.locked_until && !(row.locked_until < floor))) return { meta: { changes: 0 } }; row.locked_until = until; return { meta: { changes: 1 } }; }
            if (/^(CREATE TABLE|CREATE INDEX|ALTER TABLE)/.test(sql)) return { meta: { changes: 0 } };
            if (sql.includes('INSERT INTO eligibility_outcomes')) { outcomes.push(args); if (onEligibilityInsert) { const f = onEligibilityInsert; onEligibilityInsert = null; f(); } return { meta: { last_row_id: outcomes.length, changes: 1 } }; }
            if (sql.includes('INSERT INTO eligibility_answers')) { answers.push(args); return { meta: { last_row_id: answers.length, changes: 1 } }; }
            if (sql.startsWith('INSERT INTO accounts')) {
              const cols = sql.slice(sql.indexOf('(') + 1, sql.indexOf(')')).split(',').map(c => c.trim());
              const row = Object.fromEntries(cols.map((c, i) => [c, args[i]]));
              // WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE email = ?) — the last bind is the address it guards on.
              if (/WHERE NOT EXISTS/.test(sql) && [...accounts.values()].some((a) => a.email === args[args.length - 1])) return { meta: { changes: 0 } };
              accounts.set(row.id, row); return { meta: { changes: 1 } };
            }
            if (sql.startsWith('UPDATE accounts SET verify_attempts = verify_attempts + 1')) { const [id, kind, now, max] = args; const row = accounts.get(id); const live = !!(row && row.verify_kind === kind && row.verify_code_hash && row.verify_expires_at > now && (row.verify_attempts || 0) < max); if (live) row.verify_attempts = (row.verify_attempts || 0) + 1; return { meta: { changes: live ? 1 : 0 } }; }
            if (sql.startsWith('UPDATE accounts SET verify_kind = ?') && sql.includes('AND verify_code_hash IS NOT NULL')) {
              const row = accounts.get(args[args.length - 1]);
              if (!row || !row.verify_code_hash) return { meta: { changes: 0 } };
              Object.assign(row, { verify_kind: args[0], verify_code_hash: args[1], verify_expires_at: args[2], verify_attempts: args[3] });
              return { meta: { changes: 1 } };
            }
            if (sql.startsWith('UPDATE accounts SET')) { const keys = [...sql.matchAll(/(\w+) = \?/g)].map((m) => m[1]); const id = args[args.length - 1]; const row = accounts.get(id); if (row) keys.forEach((k, i) => { row[k] = args[i]; }); return { meta: { changes: row ? 1 : 0 } }; }
            if (sql.includes('INSERT INTO registrations')) { const cols = sql.slice(sql.indexOf('(') + 1, sql.indexOf(')')).split(',').map((c) => c.trim()); const row = Object.fromEntries(cols.map((c, i) => [c, args[i]])); registrations.set(row.id, row); return { meta: { changes: 1 } }; }
            if (sql.startsWith("UPDATE registrations SET status = 'abandoned'") && sql.includes('SELECT COALESCE(SUM(qty)')) {
              // The conditional roll-back of the atomic claim: the SUM counts the row just inserted, exactly as the SQL does.
              const [id, sku, sdate, live, fresh, cap] = args;
              const row = registrations.get(id);
              if (!row || row.status !== 'pending') return { meta: { changes: 0 } };
              let n = 0;
              for (const r of registrations.values()) if (r.sku === sku && r.session_date === sdate && (r.status === 'paid' || holdsASeat(r, live, fresh))) n += Number(r.qty || 1);
              if (!(n > cap)) return { meta: { changes: 0 } };
              row.status = 'abandoned'; if (sql.includes('abandoned_reason')) row.abandoned_reason = 'capacity';
              return { meta: { changes: 1 } };
            }
            if (sql.includes("SET status = 'abandoned'")) { let n = 0; for (const r of registrations.values()) if (r.status === 'pending' && r.created_at < args[0]) { r.status = 'abandoned'; n++; } return { meta: { changes: n } }; }
            if (sql.startsWith('UPDATE registrations SET')) {
              const keys = [...sql.matchAll(/(\w+) = \?/g)].map((m) => m[1]); const id = args[args.length - 1]; const row = registrations.get(id);
              if (row) keys.forEach((k, i) => { row[k] = args[i]; });
              return { meta: { changes: row ? 1 : 0 } };
            }
            if (sql.startsWith('UPDATE orders SET refund_policy_version')) { orderUpdates.push(args); return { meta: { changes: 1 } }; }
            if (sql.startsWith('UPDATE memberships SET stripe_price_id')) { if (fakePlans[args[1]]) fakePlans[args[1]].stripe_price_id = args[0]; return { meta: { changes: 1 } }; }
            if (sql.startsWith('DELETE FROM accounts WHERE verified_at IS NULL')) { let n = 0; for (const [id, a] of [...accounts]) if (!a.verified_at && a.created_at < args[0]) { accounts.delete(id); n++; } return { meta: { changes: n } }; }
            if (sql.startsWith('DELETE FROM eligibility_answers')) { const before = answers.length; for (let i = answers.length - 1; i >= 0; i--) if (answers[i][4] < args[0]) answers.splice(i, 1); return { meta: { changes: before - answers.length } }; }
            return { meta: { changes: 0 } };
          },
          async all() {
            if (sql.includes('FROM registrations WHERE status IN') && sql.includes('session_date = ?')) return { results: [...registrations.values()].filter(r => (r.status === 'paid' || r.status === 'completed') && r.session_date === args[0]) };
            if (sql.includes('FROM orders')) { const list = sql.includes('WHERE sku = ?') ? orderRows.filter(o => o.sku === args[0]) : orderRows; return { results: [...list].reverse() }; }
            if (sql.includes('FROM accounts ORDER BY')) return { results: [...accounts.values()] };
            if (sql.includes('FROM contacts')) return { results: [...contacts].reverse() };
            if (sql.includes('FROM events')) return { results: events.filter(e => e.created_at >= args[0]).reverse() };
            if (sql.includes('FROM email_log')) return { results: [...emailLog] };
            if (sql.includes('FROM offerings WHERE active')) return { results: [] };
            if (sql.includes('FROM registrations ORDER BY')) return { results: [...registrations.values()] };
            if (sql.includes('FROM registrations WHERE customer_email')) return { results: [...registrations.values()].filter(r => r.customer_email === args[0] && (r.status === 'paid' || r.status === 'completed')) };
            return { results: [] };
          },
        };
      },
      async first() { return null; },
      async run() { return this._b([]).run(); },
      async all() { return this._b([]).all(); },
    };
  },
  /**
   * D1 runs the statements of one batch in order inside a single implicit transaction. Modelled by STARTING each
   * statement synchronously: every run()/first() body in this fake is await-free, so an async function called in a tight
   * loop runs to completion before the loop moves on and no other request can interleave. It is still JavaScript
   * standing in for SQL — test-seat-claim-sqlite.mjs replays the same claim against a real SQL engine, which is the
   * proof that matters.
   */
  async batch(stmts) {
    const isSelect = (st) => /^\s*SELECT/i.test(st.__sql);
    const started = stmts.map((st) => (isSelect(st) ? st.first() : st.run()));
    const done = await Promise.all(started);
    return done.map((r, i) => (isSelect(stmts[i]) ? { success: true, results: r ? [r] : [] } : { success: true, ...r }));
  },
};

const env = {
  STRIPE_SECRET_KEY: 'sk_test_x',
  STRIPE_WEBHOOK_SECRET: 'whsec_testsecret',
  ALLOWED_ORIGINS: 'https://mastsolutions.com,https://mastsolutions.com',
  SITE_URL: 'https://mastsolutions.com/mastsolutions.html',
  NOTIFY_EMAIL: 'hq@atlasglinn.com',
  RESEND_API_KEY: 're_test',
  ADMIN_KEY: 'super-secret-admin-key',
  ACCOUNT_SECRET: 'account-secret-test',
  REPLY_TO: 'replies@example.com',
  DB,
};
// Code emails now leave through ctx.waitUntil (security review round 3, 2026-09-08), so the response comes back BEFORE
// the mail leg runs. The helpers below drain that background work after each request, which is what keeps every existing
// "…and one email went out" assertion meaningful; the probes that are ABOUT the mail leg not being awaited use raw()
// instead and look at emails.length before draining.
const waits = [];
const ctx = { waitUntil: (p) => { waits.push(Promise.resolve(p).catch(() => {})); return p; } };
const drain = async () => { while (waits.length) await Promise.all(waits.splice(0)); };
// Every request comes from its own address unless a test pins one: the per-IP limits and the per-IP seat-hold cap are
// real controls, so they are exercised in the block that is about them rather than tripping every other block.
let ipSeq = 0;
const nextIp = () => '203.0.113.' + ((ipSeq++ % 250) + 1);
const raw = (path, body, origin = 'https://mastsolutions.com', ip = nextIp()) =>
  worker.fetch(new Request('https://api.test' + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, 'CF-Connecting-IP': ip }, body: JSON.stringify(body),
  }), env, ctx);
const post = async (...a) => { const res = await raw(...a); await drain(); return res; };
// A sign-up nobody has verified yet is a pending_signups row — keyed on its own signup_id and carrying the address only
// as a digest (round 5, then round 7) — and not an accounts row, so the assertions about a half-finished sign-up look here.
const { addressDigest } = await import('./src/ratelimit.js');
/* The NEWEST sign-up waiting at an address, and all of them. An address may hold several rows since round 7 — one per
   sign-up — so 'the pending row for this address' is a question with more than one answer and the tests say which. */
const pendingsFor = async (email) => { const d = await addressDigest(email); return [...pendingSignups.values()].filter((r) => r.address_digest === d).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || b.__seq - a.__seq); };
const pendingFor = async (email) => (await pendingsFor(email))[0] || null;

console.log('\n── Server-side pricing (client cannot set the amount) ──');
{
  stripeCalls.length = 0;
  // Client tries to buy a $695 class for $1 by sending its own price.
  const res = await post('/create-booking', { sku: 'MAST-DA', customer_email: 'a@b.com', qty: 1, price_cents: 100 });
  const sent = stripeCalls[0];
  ok('checkout succeeds', res.status === 200, await res.clone().text());
  ok('charges the SERVER price ($695), not the injected $1',
     sent.get('line_items[0][price_data][unit_amount]') === '69500',
     'got ' + sent.get('line_items[0][price_data][unit_amount]'));
  ok('uses D1 class name', sent.get('line_items[0][price_data][product_data][name]') === 'MAST Solutions — Direct Action');
}
{
  const res = await post('/create-booking', { sku: 'NOT-A-CLASS', customer_email: 'a@b.com' });
  ok('unknown SKU is rejected (404)', res.status === 404);
}
{
  const res = await post('/create-booking', { sku: 'MAST-DA', customer_email: 'not-an-email' });
  ok('bad email rejected (400)', res.status === 400);
}
{
  stripeCalls.length = 0;
  await post('/create-booking', { sku: 'MAST-DA', customer_email: 'a@b.com', qty: 9999 });
  ok('qty clamped to 10', stripeCalls[0].get('line_items[0][quantity]') === '10');
}

console.log('\n── Redirect allowlist ──');
{
  stripeCalls.length = 0;
  await post('/create-booking', {
    sku: 'MAST-DA', customer_email: 'a@b.com',
    success_url: 'https://evil.example.com/steal',
  });
  const s = stripeCalls[0].get('success_url');
  ok('off-origin success_url rejected', !s.includes('evil.example.com'), 'got ' + s);
  ok('falls back to allowlisted origin', s.startsWith('https://mastsolutions.com'), 'got ' + s);
  // Owner, 2026-09-05: the fallback must land on the MAST page itself, not the bare origin (the site's home page).
  ok('fallback is the MAST page with the checkout flag', s === 'https://mastsolutions.com/mastsolutions.html?checkout=success', 'got ' + s);
  ok('cancel fallback is the MAST page too', stripeCalls[0].get('cancel_url') === 'https://mastsolutions.com/mastsolutions.html?checkout=cancelled', 'got ' + stripeCalls[0].get('cancel_url'));
}
{
  // No SITE_URL configured: the fallback still names the page on the first allowed origin.
  stripeCalls.length = 0;
  const { SITE_URL, ...noSite } = env;
  await worker.fetch(new Request('https://mast-booking-backend.matthew-221.workers.dev/create-booking', {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://mastsolutions.com' },
    body: JSON.stringify({ sku: 'MAST-DA', customer_email: 'a@b.com' }),
  }), noSite, ctx);
  const s = stripeCalls[0] && stripeCalls[0].get('success_url');
  ok('without SITE_URL the fallback is <first origin>/mastsolutions.html', s === 'https://mastsolutions.com/mastsolutions.html?checkout=success', 'got ' + s);
}
{
  stripeCalls.length = 0;
  await post('/create-booking', {
    sku: 'MAST-DA', customer_email: 'a@b.com',
    success_url: 'https://mastsolutions.com/?checkout=success',
  });
  ok('on-origin success_url accepted',
     stripeCalls[0].get('success_url').includes('mastsolutions.com/?checkout=success'));
}

console.log('\n── Training weekends (calendar) ──');
{
  const res = await worker.fetch(new Request('https://api.test/weekends', { headers: { Origin: 'https://mastsolutions.com' } }), env, ctx);
  const body = await res.json();
  ok('GET /weekends answers 200', res.status === 200);
  ok('lists all 15 owner weekends', Array.isArray(body.weekends) && body.weekends.length === 15, 'got ' + (body.weekends || []).length);
  ok('Oct 31 is blocked', body.weekends.some((w) => w.saturday === '2026-10-31' && w.status === 'blocked'));
  ok('Jan 30 (5th weekend) is present', body.weekends.some((w) => w.saturday === '2027-01-30'));
}
{
  stripeCalls.length = 0;
  const res = await post('/create-booking', {
    sku: 'MAST-DA', customer_email: 'a@b.com', session_date: '2026-10-10', session_label: 'Sat–Sun, Oct 10–11, 2026',
  });
  const sent = stripeCalls[0];
  ok('valid weekend accepted', res.status === 200, await res.clone().text());
  ok('session_date carried in Stripe metadata', sent && sent.get('metadata[session_date]') === '2026-10-10');
  ok('date label appears on the Stripe line item',
     sent && sent.get('line_items[0][price_data][product_data][description]').includes('Oct 10'));
}
{
  const res = await post('/create-booking', { sku: 'MAST-DA', customer_email: 'a@b.com', session_date: '2026-10-31' });
  ok('blocked weekend (Oct 31) rejected (409)', res.status === 409, 'got ' + res.status);
}
{
  const res = await post('/create-booking', { sku: 'MAST-DA', customer_email: 'a@b.com', session_date: '2026-10-17' });
  ok('non-training Saturday rejected (404)', res.status === 404, 'got ' + res.status);
}
{
  const res = await post('/create-booking', { sku: 'MAST-DA', customer_email: 'a@b.com', session_date: 'next saturday' });
  ok('malformed date rejected (400)', res.status === 400, 'got ' + res.status);
}

console.log('\n── Membership plan resolution ──');
{
  stripeCalls.length = 0;
  const res = await post('/create-membership', { email: 'a@b.com', plan: 'range_member' });
  ok('known plan succeeds', res.status === 200);
  ok('uses the D1 Stripe Price ID', stripeCalls[0].get('line_items[0][price]') === 'price_live_rm');
  ok('mode is subscription', stripeCalls[0].get('mode') === 'subscription');
}
{
  const res = await post('/create-membership', { email: 'a@b.com', plan: 'nonexistent' });
  const body = await res.json();
  ok('unconfigured plan returns 400 with a hint', res.status === 400 && body.hint.includes('STRIPE_PRICE_NONEXISTENT'));
}
{
  // Membership prices provision themselves (owner, 2026-09-04): the first join finds or creates the Stripe Price by lookup_key,
  // stores it on the plan, and checks out with it; later joins reuse the stored id.
  stripeCalls.length = 0; stripePriceCalls.length = 0;
  const res = await post('/create-membership', { email: 'a@b.com', plan: 'red_team' });
  ok('a plan without a price id still joins → 200', res.status === 200, String(res.status));
  const [look, make] = stripePriceCalls;
  ok('price looked up by lookup_key, then created', stripePriceCalls.length === 2 && look.method === 'GET' && look.url.includes('mast_red_team') && make.method === 'POST', JSON.stringify(stripePriceCalls.map(c => c.method)));
  ok('created monthly at the plan price with the product named after it', make && make.body.get('unit_amount') === '25000' && make.body.get('recurring[interval]') === 'month' && make.body.get('lookup_key') === 'mast_red_team' && /Red Team/.test(make.body.get('product_data[name]')));
  ok('the new price id is stored on the plan', fakePlans.red_team.stripe_price_id === 'price_new_mast_red_team', fakePlans.red_team.stripe_price_id);
  ok('checkout uses it, in subscription mode', stripeCalls[0].get('line_items[0][price]') === 'price_new_mast_red_team' && stripeCalls[0].get('mode') === 'subscription');
  stripePriceCalls.length = 0;
  await post('/create-membership', { email: 'a@b.com', plan: 'red_team' });
  ok('the second join reuses the stored id (no Stripe price calls)', stripePriceCalls.length === 0);
}
{
  // Verified memberships (owner, 2026-09-05: 'how "verified" is checked = upload photo of credentials'): Law Enforcement and Verified
  // Teachers must send a credential photograph at Join; it is emailed to the office and checkout proceeds; other plans are unchanged.
  stripeCalls.length = 0; const before = emails.length;
  const bare = await post('/create-membership', { email: 'officer@example.com', plan: 'le_team', customer_name: 'Pat Officer' }); const bb = await bare.json();
  ok('LE membership without a credential → 400 credential, Stripe not called', bare.status === 400 && bb.code === 'credential' && stripeCalls.length === 0, String(bare.status) + ' ' + JSON.stringify(bb));
  const badType = await post('/create-membership', { email: 'officer@example.com', plan: 'le_team', credential: { filename: 'x.exe', content_type: 'application/x-msdownload', data: 'AAAA' } });
  ok('LE membership with a non-photo file → 400 credential_type', badType.status === 400 && (await badType.json()).code === 'credential_type');
  const withIt = await post('/create-membership', { email: 'officer@example.com', plan: 'le_team', customer_name: 'Pat Officer', credential: { filename: 'badge.jpg', content_type: 'image/jpeg', data: 'aGVsbG8=' } });
  const sent = emails[emails.length - 1];
  ok('LE membership with a credential photo → 200 and one email to the office with the attachment', withIt.status === 200 && emails.length === before + 1 && /Membership credential: Pat Officer · Law Enforcement/.test(sent.subject) && sent.attachments && sent.attachments[0].filename === 'badge.jpg' && sent.attachments[0].content === 'aGVsbG8=', String(withIt.status) + ' ' + JSON.stringify(sent).slice(0, 200));
  ok('checkout metadata records the credential as emailed', /^emailed /.test(stripeCalls[stripeCalls.length - 1].get('metadata[credential]') || ''), String(stripeCalls[stripeCalls.length - 1] && stripeCalls[stripeCalls.length - 1].get('metadata[credential]')));
  const red = await post('/create-membership', { email: 'a@b.com', plan: 'red_team' });
  ok('an open team (Red) still joins without a credential', red.status === 200, String(red.status));
  emails.length = before;   // later blocks count emails from here
}

console.log('\n── Webhook signature ──');
const sign = async (payload, ts, secret = 'whsec_testsecret') => {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const buf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(ts + '.' + payload));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
};
const hook = (body, sigHeader) =>
  worker.fetch(new Request('https://api.test/webhook', { method: 'POST', headers: { 'stripe-signature': sigHeader }, body }), env, ctx);

const evt = JSON.stringify({
  id: 'evt_1', type: 'checkout.session.completed',
  data: { object: { id: 'cs_live_9', mode: 'payment', amount_total: 69500, currency: 'usd',
    customer_email: 'student@example.com', customer_details: { name: 'Jane Doe', phone: '+17135551234' },
    metadata: { kind: 'class_booking', sku: 'MAST-DA', class_name: 'Direct Action', qty: '1', customer_name: 'Jane Doe' } } },
});
{
  const now = Math.floor(Date.now() / 1000);
  const res = await hook(evt, `t=${now},v1=${await sign(evt, now)}`);
  ok('valid signature accepted', res.status === 200);
  ok('order PERSISTED to D1', stored.length === 1, 'stored=' + stored.length);
  await new Promise(r => setTimeout(r, 20));
  ok('notification email SENT', emails.length === 1, 'emails=' + emails.length);
  ok('email names the class and customer',
     emails[0] && emails[0].text.includes('Direct Action') && emails[0].text.includes('student@example.com'));
  ok('email subject is actionable', emails[0] && emails[0].subject.includes('New MAST booking'));
}
{
  const now = Math.floor(Date.now() / 1000);
  const res = await hook(evt, `t=${now},v1=${await sign(evt, now, 'wrong_secret')}`);
  ok('forged signature rejected (401)', res.status === 401);
}
{
  const old = Math.floor(Date.now() / 1000) - 3600; // 1 hour old
  const res = await hook(evt, `t=${old},v1=${await sign(evt, old)}`);
  ok('replayed old event rejected (401)', res.status === 401);
}
{
  const now = Math.floor(Date.now() / 1000);
  const tampered = evt.replace('69500', '100');
  const res = await hook(tampered, `t=${now},v1=${await sign(evt, now)}`);
  ok('tampered body rejected (401)', res.status === 401);
}

console.log('\n── Admin roster auth ──');
const get = (path, origin = 'https://mastsolutions.com') =>
  worker.fetch(new Request('https://api.test' + path, { headers: { Origin: origin } }), env, ctx);
{
  ok('no key rejected', (await get('/roster')).status === 401);
  ok('wrong key rejected', (await get('/roster?key=guess')).status === 401);
  ok('correct key accepted', (await get('/roster?key=super-secret-admin-key')).status === 200);
}

console.log('\n── CORS ──');
{
  const res = await get('/health', 'https://mastsolutions.com');
  ok('allowlisted origin echoed', res.headers.get('Access-Control-Allow-Origin') === 'https://mastsolutions.com');
  const bad = await get('/health', 'https://evil.example.com');
  ok('unknown origin NOT echoed', bad.headers.get('Access-Control-Allow-Origin') !== 'https://evil.example.com',
     'got ' + bad.headers.get('Access-Control-Allow-Origin'));
}

console.log('\n── Registration: screening → agreement → refund consent → Stripe ──');
const { QUESTIONS_VERSION, REFUND_POLICY_VERSION, AGREEMENT_VERSION } = await import('./src/worker.js');
const FIRST_WEEKEND = '2026-10-10', BLOCKED_WEEKEND = '2026-10-31'; // from the seeded training_weekends
const goodReg = (over = {}) => ({
  sku: 'MAST-DA', qty: 1, session_date: FIRST_WEEKEND, session_label: 'Sat–Sun test',
  customer: { name: 'Jane Doe', email: 'Student@Example.com', phone: '(713) 555-0100', organization: '' },
  eligibility: { us_citizen: true, felony_prohibited: false, attested: true, questions_version: QUESTIONS_VERSION },
  agreement: { version: AGREEMENT_VERSION, signed_name: 'Jane Doe', initials: 'jd', address1: '1 Main St', address2: 'Houston, TX 77002', emergency_name: 'John Doe', emergency_phone: '(713) 555-0199', emergency_relationship: 'Spouse', scrolled: true, agreed: true },
  refund: { accepted: true, version: REFUND_POLICY_VERSION },
  prerequisite: { required: true, attested: true },   // every course but Handgun Fundamentals asks (owner, 2026-09-04)
  newsletter_opt_in: false,
  success_url: 'https://mastsolutions.com/?checkout=success',
  ...over,
});
const reg = (body) => post('/register', body);
// One person per seat. Two live holds per address is the cap (SEAT_HOLD_MS / MAX_HOLDS_PER_EMAIL), so a block that books
// three or more times books them for three or more people, which is what filling a class actually looks like.
const party = (n, over = {}) => goodReg({ customer: { name: 'Cap ' + n, email: 'cap' + n + '@example.com', phone: '(713) 555-0100', organization: '' }, ...over });
{
  stripeCalls.length = 0; emails.length = 0;
  const res = await reg(goodReg()); const body = await res.json();
  ok('cleared participant reaches Stripe (200 + checkoutUrl)', res.status === 200 && body.checkoutUrl && body.registration_id.startsWith('reg_'), JSON.stringify(body));
  const p = stripeCalls[0];
  ok('Stripe amount is the server price', p && p.get('line_items[0][price_data][unit_amount]') === '69500');
  ok('registration id rides in Stripe metadata', p && p.get('metadata[registration_id]') === body.registration_id);
  const row = registrations.get(body.registration_id);
  ok('registration persisted before Stripe, status pending', row && row.status === 'pending');
  ok('email normalised to lowercase', row && row.customer_email === 'student@example.com');
  ok('initials uppercased', row && row.agreement_initials === 'JD');
  ok('agreement version + signed_at + ip recorded', row && row.agreement_version === AGREEMENT_VERSION && row.agreement_signed_at && 'agreement_ip' in row);
  ok('refund policy version + accepted_at recorded', row && row.refund_policy_version === REFUND_POLICY_VERSION && row.refund_policy_accepted_at);
  ok('newsletter NOT opted in by default', row && row.newsletter_opt_in === 0);
  ok('outcome row written as cleared', outcomes.length === 1 && outcomes[0][3] === 'cleared');
  ok('answers row written separately with a purge date', answers.length === 1 && answers[0][4] > row.created_at);
  ok('stripe session id written back to the registration', row.stripe_session_id === 'cs_test_123');
  ok('no email sent for a cleared registration before payment', emails.length === 0);
}
{
  // Capacity: MAST-DA is a 10-seat course in the fake catalog. Fill the first weekend, then the 11th seat is refused.
  stripeCalls.length = 0;
  const already = [...registrations.values()].filter((r) => r.sku === 'MAST-DA' && r.session_date === FIRST_WEEKEND && r.status === 'pending').reduce((s, r) => s + Number(r.qty || 1), 0);
  const SECOND_WEEKEND = '2026-10-24';   // seeded fortnightly: 09-26, 10-10, 10-24 …
  const upTo9 = await reg(party(1, { qty: 9 - already })); const r9 = await upTo9.json();
  ok('capacity: booking up to one seat short still reaches Stripe', upTo9.status === 200, String(upTo9.status));
  const tenth = await reg(party(2, { qty: 1 })); const r10 = await tenth.json();
  ok('capacity: the last seat still sells', tenth.status === 200, String(tenth.status));
  const over = await reg(party(3, { qty: 1 })); const ob = await over.json();
  ok('capacity: the 11th seat is refused with 409 sold_out and 0 left', over.status === 409 && ob.code === 'sold_out' && ob.seats_left === 0, JSON.stringify(ob));
  ok('capacity: no Stripe session for the refused seat', stripeCalls.length === 2);
  const other = await reg(party(4, { qty: 1, session_date: SECOND_WEEKEND })); const ro = await other.json();
  ok('capacity: another weekend of the same course is unaffected', other.status === 200, String(other.status));
  const tooMany = await reg(party(5, { qty: 10, session_date: SECOND_WEEKEND }));   // 1 taken, 9 left, 10 asked
  const tb = await tooMany.json();
  ok('capacity: a block bigger than the seats left is refused and told how many remain', tooMany.status === 409 && tb.seats_left === 9, JSON.stringify(tb));
  // Release the seats this block took so the fixture weekend is open again for the tests that follow.
  for (const id of [r9.registration_id, r10.registration_id, ro.registration_id]) { const row = registrations.get(id); if (row) row.status = 'abandoned'; }
}
{
  // Progression gate (owner, 2026-09-04, refined 2026-09-05): a course needs its discipline's Fundamentals; of the disciplines without
  // their own, only Team Tactics requires one (Handgun Fundamentals); P2 also needs the P1; Fundamentals courses never ask.
  stripeCalls.length = 0;
  const bare = await reg(goodReg({ sku: 'MAST-HG-OP', prerequisite: undefined })); const bb = await bare.json();
  ok('prerequisite: Handgun Operator without the attestation → 400 prerequisite', bare.status === 400 && bb.field === 'prerequisite' && bb.code === 'prerequisite', JSON.stringify(bb));
  ok('prerequisite: the refusal names Handgun Fundamentals', /Handgun Fundamentals/.test(bb.error || ''), bb.error);
  ok('prerequisite: Stripe not called without it', stripeCalls.length === 0);
  const carb = await (await reg(goodReg({ sku: 'MAST-CAR-OP', prerequisite: undefined }))).json();
  ok('prerequisite: Carbine Operator names Carbine Fundamentals', /MAST Carbine Fundamentals/.test(carb.error || '') && !/P1/.test(carb.error || ''), carb.error);
  const nvg = await (await reg(goodReg({ sku: 'MAST-NVG-P2', prerequisite: undefined }))).json();
  ok('prerequisite: NVG Operator P2 names Low-Light Fundamentals and a P1 course', /MAST Low-Light Fundamentals and a MAST P1 course/.test(nvg.error || ''), nvg.error);
  const daBare = await reg(party(11, { prerequisite: undefined })); const dab = await daBare.json();
  ok('prerequisite: a discipline without its own Fundamentals (Direct Action) has no prerequisite → 200 (owner, 2026-09-05)', daBare.status === 200, String(daBare.status) + ' ' + (dab.error || ''));
  const team = await reg(goodReg({ sku: 'MAST-TEAM-P1', prerequisite: undefined })); const tb = await team.json();
  ok('prerequisite: Team Tactics P1 is the one exception, Handgun Fundamentals first → 400', team.status === 400 && /MAST Handgun Fundamentals/.test(tb.error || '') && !/P1 course/.test(tb.error || ''), String(team.status) + ' ' + (tb.error || ''));
  const vehp2 = await reg(party(12, { sku: 'MAST-VEH-P2', prerequisite: undefined }));
  ok('prerequisite: "Vehicular Tactics / Team Tactics P2" (Protective) has no prerequisite → 200', vehp2.status === 200, String(vehp2.status));
  const sf = await reg(party(13, { sku: 'MAST-SF-P1', prerequisite: undefined }));
  ok('prerequisite: Select-Fire P1 has no prerequisite → 200', sf.status === 200, String(sf.status));
  const withIt = await reg(party(14, { sku: 'MAST-HG-OP' })); const wb = await withIt.json();
  ok('prerequisite: attested → reaches Stripe', withIt.status === 200, String(withIt.status));
  const row = registrations.get(wb.registration_id);
  ok('prerequisite: attestation recorded on the registration', row && row.prereq_attested === 1, JSON.stringify(row && row.prereq_attested));
  const fund = await reg(party(15, { sku: 'MAST-HG-FUND', prerequisite: undefined })); const fb = await fund.json();
  ok('prerequisite: Handgun Fundamentals never asks', fund.status === 200, String(fund.status));
  const fr = registrations.get(fb.registration_id);
  ok('prerequisite: Handgun Fundamentals records 0', fr && fr.prereq_attested === 0);
  const ladies = await reg(party(16, { sku: 'MAST-HG-LADIES', prerequisite: undefined })); const lb = await ladies.json();
  ok('prerequisite: the ladies-only Handgun Fundamentals class is a qualifier too (no attestation asked)', ladies.status === 200, String(ladies.status));
  const lr = registrations.get(lb.registration_id);
  for (const r of [row, fr, lr]) if (r) r.status = 'abandoned';
}
{
  stripeCalls.length = 0; emails.length = 0; const before = registrations.size;
  const res = await reg(goodReg({ eligibility: { us_citizen: true, felony_prohibited: true, attested: true, questions_version: QUESTIONS_VERSION } }));
  const body = await res.json();
  ok('disqualifying answer stops with 202 review, no checkoutUrl', res.status === 202 && body.review === true && !body.checkoutUrl, JSON.stringify(body));
  ok('Stripe NOT called for a flagged registration', stripeCalls.length === 0);
  const row = registrations.get(body.registration_id);
  ok('flagged registration stored with status review', row && row.status === 'review' && row.eligibility_status === 'flagged' && registrations.size === before + 1);
  ok('outcome kept as flagged', outcomes[outcomes.length - 1][3] === 'flagged');
  await new Promise(r => setTimeout(r, 20));
  ok('staff review notice sent', emails.length === 1 && emails[0].subject.startsWith('Eligibility review needed'));
  const txt = emails.length ? emails[0].text + emails[0].subject : '';
  ok('review notice never carries the answers or the question', emails.length === 1 && !/citizen|felony|yes|no\b/i.test(txt), txt.slice(0, 120));
  ok('neutral message does not say which question', !/citizen|felony/i.test(body.message));
}
{
  const cases = [
    ['missing phone', goodReg({ customer: { name: 'Jane Doe', email: 'a@b.co', phone: '' } }), 400],
    ['unticked eligibility attestation', goodReg({ eligibility: { us_citizen: true, felony_prohibited: false, attested: false, questions_version: QUESTIONS_VERSION } }), 400],
    ['agreement not scrolled to the end', goodReg({ agreement: { ...goodReg().agreement, scrolled: false } }), 400],
    ['agreement box unticked', goodReg({ agreement: { ...goodReg().agreement, agreed: false } }), 400],
    ['missing emergency contact', goodReg({ agreement: { ...goodReg().agreement, emergency_phone: '' } }), 400],
    ['refund policy unticked', goodReg({ refund: { accepted: false, version: REFUND_POLICY_VERSION } }), 400],
    ['stale questions version', goodReg({ eligibility: { ...goodReg().eligibility, questions_version: 'old' } }), 409],
    ['stale agreement version', goodReg({ agreement: { ...goodReg().agreement, version: 'old' } }), 409],
    ['stale refund policy version', goodReg({ refund: { accepted: true, version: 'old' } }), 409],
    ['blocked weekend', goodReg({ session_date: BLOCKED_WEEKEND }), 409],
    ['unknown sku', goodReg({ sku: 'MAST-NOPE' }), 404],
  ];
  for (const [name, body, status] of cases) {
    stripeCalls.length = 0;
    const res = await reg(body);
    ok(name + ' → ' + status + ', Stripe not called', res.status === status && stripeCalls.length === 0, 'got ' + res.status);
  }
}
{
  // Webhook for a registration: mark paid, copy refund consent onto the order, send the documents.
  stripeCalls.length = 0; emails.length = 0; stored.length = 0;
  const first = await (await reg(goodReg())).json();
  const evt2 = JSON.stringify({ id: 'evt_2', type: 'checkout.session.completed', data: { object: { id: 'cs_test_123', mode: 'payment', amount_total: 69500, currency: 'usd',
    customer_email: 'student@example.com', customer_details: { name: 'Jane Doe', phone: '' },
    metadata: { kind: 'class_booking', registration_id: first.registration_id, sku: 'MAST-DA', class_name: 'Direct Action', qty: '1', customer_name: 'Jane Doe', session_date: FIRST_WEEKEND, session_label: 'Sat–Sun test' } } } });
  const now = Math.floor(Date.now() / 1000);
  const res = await hook(evt2, `t=${now},v1=${await sign(evt2, now)}`);
  ok('webhook accepted for a registration', res.status === 200);
  const row = registrations.get(first.registration_id);
  ok('registration marked paid with paid_at', row.status === 'paid' && row.paid_at);
  ok('refund consent copied onto the order row', orderUpdates.length === 1 && orderUpdates[0][0] === REFUND_POLICY_VERSION);
  await new Promise(r => setTimeout(r, 300));
  const subjects = emails.map(e => e.subject);
  ok('internal roster notice + participant confirmation sent', subjects.some(s => s.startsWith('New MAST booking')) && subjects.some(s => s.startsWith("You're booked")), subjects.join(' | '));
  const conf = emails.find(e => e.subject.startsWith("You're booked"));
  ok('confirmation names the course, date and refund terms', conf && /Direct Action/.test(conf.text) && /Sat–Sun test/.test(conf.text) && /15 or more days/.test(conf.text));
  ok('no email carries eligibility answers', emails.every(e => !/us_citizen|felony_prohibited|citizen of the United States/i.test(e.text)));
  ok('documents_sent_at recorded', !!row.documents_sent_at);
}
{
  // Retention cron: answers past purge_after go, pending registrations older than a day are abandoned.
  answers.push([99, '{}', '', '2020-01-01T00:00:00Z', '2020-01-08T00:00:00Z']);
  const keep = answers.length - 1;
  registrations.set('reg_old', { id: 'reg_old', status: 'pending', created_at: '2020-01-01T00:00:00Z' });
  let ran = null; await worker.scheduled({}, env, { waitUntil: (p) => { ran = p; } }); await ran;
  ok('expired answers purged, current ones kept', answers.length === keep && !answers.some(a => a[4] < '2021'));
  ok('stale pending registration marked abandoned', registrations.get('reg_old').status === 'abandoned');
  ok('outcomes untouched by the purge', outcomes.length >= 2);
}
{
  const res = await get('/roster?key=super-secret-admin-key&view=registrations'); const body = await res.json();
  ok('roster view=registrations lists registrations', res.status === 200 && Array.isArray(body.registrations) && body.registrations.length >= 2);
}

console.log('\n── Site contact + capability requests ──');
{
  emails.length = 0;
  const res = await post('/contact', { name: 'Jane Doe', email: 'Jane@Example.com', phone: '(713) 555-0100', message: 'Need a residential assessment.', page: 'contact.html' });
  ok('contact form sends one email, 200', res.status === 200 && emails.length === 1, 'status=' + res.status + ' emails=' + emails.length);
  ok('every email is blind-copied to the owner (matthew@atlasglinn.com, matthew@mastsolutions.com)', Array.isArray(emails[0].bcc) && emails[0].bcc.includes('matthew@atlasglinn.com') && emails[0].bcc.includes('matthew@mastsolutions.com'), JSON.stringify(emails[0].bcc));
  const priv = await post('/contact', { kind: 'contact', request_type: 'private', name: 'Jane Doe', email: 'jane@example.com', phone: '', message: 'Private instruction request — Private Session (2 HRS · ONE-ON-ONE)', page: 'https://www.atlasglinn.com/mastsolutions.html' });
  ok('private instruction request (the page\'s Request dialog) sends one email titled as such, 200', priv.status === 200 && emails.length === 2 && /Private instruction request: Jane Doe/.test(JSON.stringify(emails[1])), 'status=' + priv.status + ' ' + JSON.stringify(emails[1]).slice(0, 160));
  ok('email has reply-to the sender and the message', emails[0] && emails[0].reply_to === 'jane@example.com' && /residential assessment/.test(emails[0].text));
  // Owner, 2026-09-08, on the notification that reached him: "REMOVE 'Page: github-actions'". The page is still collected —
  // it is on the lead row and drives attribution — it just does not take a line in the email.
  ok('the notification carries no Page: line, and the lead row still has the page', !emails[0].text.includes('Page:') && contacts.some((c) => c.email === 'jane@example.com' && c.page === 'contact.html'), emails[0].text);
  // The Gear chapter (owner, 2026-09-05): Aimpoint / IWA quote requests through the same dialog, never a Stripe charge.
  const gear = await post('/contact', { kind: 'contact', request_type: 'gear', company: 'Harris County SO', name: 'Jane Doe', email: 'jane@example.com', phone: '', message: 'Gear quote request — IWA-M12 M12 Distraction Device (IWA · Distraction) × 12\nAgency / organization: Harris County SO', page: 'https://atlasglinn.com/mastsolutions.html' });
  ok('gear quote request sends one email titled as such with the agency, 200', gear.status === 200 && emails.length === 3 && /Gear quote request: Jane Doe/.test(emails[2].subject) && /GEAR QUOTE REQUEST/.test(emails[2].text) && /Company:\s+Harris County SO/.test(emails[2].text) && /IWA-M12/.test(emails[2].text), 'status=' + gear.status + ' ' + JSON.stringify(emails[2] || {}).slice(0, 200));
  emails.length = 0;
  const cap = await post('/contact', { kind: 'capability', name: 'Jane Doe', email: 'jane@example.com', company: 'Acme', status: 'Need security', request_type: 'RFP' });
  ok('capability request needs no message, subject names it', cap.status === 200 && emails.length === 1 && emails[0].subject.startsWith('Capability statement request'));
  emails.length = 0;
  const bot = await post('/contact', { name: 'Bot', email: 'bot@example.com', message: 'hi', website: 'http://spam' });
  ok('honeypot filled → 200 and nothing sent', bot.status === 200 && emails.length === 0);
  const bad = await post('/contact', { name: 'J', email: 'nope', message: '' });
  ok('invalid contact rejected with 400', bad.status === 400);
}

console.log('\n── Agreement PDF fill (the real form, pdf-lib) ──');
{
  const { readFileSync } = await import('node:fs');
  const { createHash } = await import('node:crypto');
  const { fillAgreement } = await import('./src/agreement.js');
  const { PDFDocument } = await import('pdf-lib');
  const src = readFileSync(new URL('./assets/class-participation-agreement.pdf', import.meta.url));
  ok('AGREEMENT_VERSION is the hash prefix of the shipped PDF', createHash('sha256').update(src).digest('hex').startsWith(AGREEMENT_VERSION));
  const out = await fillAgreement(src, { id: 'reg_test', customer_name: 'Jane Doe', customer_email: 'student@example.com', customer_phone: '(713) 555-0100', address1: '1 Main St', address2: 'Houston, TX 77002', emergency_name: 'John Doe', emergency_phone: '(713) 555-0199', emergency_relationship: 'Spouse', agreement_signed_name: 'Jane Doe', agreement_initials: 'JD', agreement_signed_at: '2026-09-03T22:40:11Z', agreement_ip: '203.0.113.7' });
  ok('filled PDF produced', out && out.length > 100000, 'bytes=' + (out && out.length));
  const back = await PDFDocument.load(out);
  ok('form flattened: no editable fields remain', back.getForm().getFields().length === 0, 'fields=' + back.getForm().getFields().length);
  ok('three pages preserved', back.getPageCount() === 3);
}

console.log('\n── Student accounts (owner, 2026-09-05) ──');
{
  const get = (path, token) => worker.fetch(new Request('https://api.test' + path, { method: 'GET', headers: Object.assign({ Origin: 'https://mastsolutions.com' }, token ? { Authorization: 'Bearer ' + token } : {}) }), env, ctx);
  const postAuth = (path, body, token) => worker.fetch(new Request('https://api.test' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://mastsolutions.com', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) }), env, ctx);
  // CORS lets the bearer token through
  const pre = await worker.fetch(new Request('https://api.test/account/me', { method: 'OPTIONS', headers: { Origin: 'https://mastsolutions.com' } }), env, ctx);
  ok('CORS preflight allows the Authorization header', /Authorization/.test(pre.headers.get('Access-Control-Allow-Headers') || ''), pre.headers.get('Access-Control-Allow-Headers'));
  // register: no token until the emailed code comes back (Codex review of PR #10, P1)
  const codeIn = (m) => (/\b(\d{6})\b/.exec((m && m.text) || '') || [])[1];
  const rowFor = (email) => [...accounts.values()].find((a) => a.email === email);
  const short = await post('/account/register', { email: 'student@example.com', password: 'short' });
  ok('register: a short password → 400', short.status === 400);
  emails.length = 0;
  const reg1 = await post('/account/register', { email: 'Student@Example.com', password: 'correct horse battery', name: 'Jane Doe', phone: '(713) 555-0100' }); const p0 = await reg1.json();
  ok('register → 202 pending with no token; one code email to the student alone (no BCC)', reg1.status === 202 && p0.pending === true && !p0.token && emails.length === 1 && emails[0].to[0] === 'student@example.com' && !emails[0].bcc && /Your MAST Solutions verification code/.test(emails[0].subject) && !!codeIn(emails[0]), JSON.stringify({ status: reg1.status, body: p0, email: emails[0] && { to: emails[0].to, bcc: emails[0].bcc, subject: emails[0].subject } }));
  const code1 = codeIn(emails[0]);
  ok('the code email replies to the real mailbox (REPLY_TO), not the sender label', emails[0].reply_to === 'replies@example.com', JSON.stringify(emails[0].reply_to));
  let pendRow = await pendingFor('student@example.com');
  ok('the password is stored as a PBKDF2 hash, never in clear', pendRow && /^pbkdf2-sha256\$100000\$/.test(pendRow.password_hash) && !pendRow.password_hash.includes('correct horse'), pendRow && pendRow.password_hash.slice(0, 30));
  ok('a sign-up writes a pending_signups row and NO account, keyed on a digest that is not the address', !!pendRow && !rowFor('student@example.com') && /^[0-9a-f]{64}$/.test(pendRow.address_digest) && !pendRow.address_digest.includes('student'), JSON.stringify({ pending: !!pendRow, account: !!rowFor('student@example.com') }));
  ok('the code is stored hashed on the pending row', pendRow && pendRow.code_hash && !pendRow.code_hash.includes(code1));
  const early = await post('/account/login', { email: 'student@example.com', password: 'correct horse battery' });
  const earlyGhost = await post('/account/login', { email: 'never-signed-up-at-all@example.com', password: 'correct horse battery' });
  ok('sign-in for an address that has only STARTED a sign-up answers what an address with nothing answers — 401 bad_login, byte for byte, never the 403 that classified it', early.status === 401 && (await early.clone().json()).code === 'bad_login' && early.status === earlyGhost.status && (await early.clone().text()) === (await earlyGhost.clone().text()), early.status + ' ' + (await early.clone().text()) + ' vs ' + earlyGhost.status + ' ' + (await earlyGhost.clone().text()));
  const wrongCode = await post('/account/verify', { email: 'student@example.com', code: code1 === '000000' ? '000001' : '000000', password: 'correct horse battery' });
  ok('verify with a wrong code → 401 and the try is counted', wrongCode.status === 401 && (await pendingFor('student@example.com')).verify_attempts === 1, String(wrongCode.status));
  const ver = await post('/account/verify', { email: 'student@example.com', code: code1, password: 'correct horse battery' }); const r1 = await ver.json();
  ok('verify with the emailed code → 200 with a token and the account (email normalised)', ver.status === 200 && typeof r1.token === 'string' && r1.token.includes('.') && r1.account.email === 'student@example.com' && r1.account.name === 'Jane Doe', JSON.stringify(r1).slice(0, 160));
  const acctRow = accounts.get(r1.account.id);
  ok('verifying is what CREATES the account: verified_at is set, no code is stored on it, and the pending row is gone', !!acctRow.verified_at && !acctRow.verify_code_hash && !(await pendingFor('student@example.com')), JSON.stringify({ verified: !!acctRow.verified_at, pending: !!(await pendingFor('student@example.com')) }));
  ok('verify on an already-verified address → the same generic 401 bad_code, never a 409 that confirms it', (await post('/account/verify', { email: 'student@example.com', code: code1, password: 'correct horse battery' })).status === 401);
  emails.length = 0;
  rowFor('student@example.com').signup_notice_sent_at = null;   // the last notice went out a while ago
  const dup = await post('/account/register', { email: 'student@example.com', password: 'another long password' }); const dupBody = await dup.json();
  ok('register for a VERIFIED address → the same 202 pending envelope a new address gets (no exists oracle)', dup.status === 202 && dupBody.pending === true && !dupBody.token && dupBody.email === 'student@example.com' && dupBody.message === p0.message, JSON.stringify({ status: dup.status, body: dupBody }));
  ok('… and the real owner is told someone tried, with no code and no BCC', emails.length === 1 && emails[0].to[0] === 'student@example.com' && !emails[0].bcc && /Someone tried to create a MAST Solutions account/.test(emails[0].subject) && !/\b\d{6}\b/.test(emails[0].text), JSON.stringify(emails.map(e => e.subject)));
  ok('… and nothing on the account changed: the password and the verified stamp stand', /^pbkdf2/.test(accounts.get(r1.account.id).password_hash) && !!accounts.get(r1.account.id).verified_at && (await post('/account/login', { email: 'student@example.com', password: 'another long password' })).status === 401);
  emails.length = 0;
  const dup2 = await post('/account/register', { email: 'student@example.com', password: 'another long password' });
  ok('a second sign-up attempt inside a minute still answers 202 and does NOT mail the owner twice', dup2.status === 202 && (await dup2.json()).pending === true && emails.length === 0, String(dup2.status) + ' emails=' + emails.length);
  // login
  const bad = await post('/account/login', { email: 'student@example.com', password: 'wrong password here' });
  ok('login with the wrong password → 401', bad.status === 401);
  const nobody = await post('/account/login', { email: 'nobody@example.com', password: 'wrong password here' });
  ok('login for an unknown email → the same 401', nobody.status === 401);
  const login = await post('/account/login', { email: 'student@example.com', password: 'correct horse battery' }); const l1 = await login.json();
  ok('login → 200 with a token', login.status === 200 && typeof l1.token === 'string');
  const token = l1.token;
  // me: profile, classes taken by email, no card yet
  const anon = await get('/account/me');
  ok('me without a token → 401', anon.status === 401);
  const forged = await get('/account/me', token.split('.')[0] + '.forgedsignature');
  ok('me with a forged token → 401', forged.status === 401);
  registrations.set('reg_paid_1', { id: 'reg_paid_1', created_at: '2026-09-01T00:00:00Z', status: 'paid', sku: 'MAST-HG-FUND', item_name: 'Handgun Fundamentals', qty: 1, session_date: '2026-09-26', session_label: 'Sat, Sep 26, 2026', customer_email: 'student@example.com' });
  registrations.set('reg_pending_1', { id: 'reg_pending_1', created_at: '2026-09-02T00:00:00Z', status: 'pending', sku: 'MAST-HG-OP', item_name: 'Handgun Operator', qty: 1, session_date: '2026-10-10', session_label: 'Sat–Sun, Oct 10–11, 2026', customer_email: 'student@example.com' });
  const me = await get('/account/me', token); const m1 = await me.json();
  ok('me → 200 with the profile, the paid classes only, no card', me.status === 200 && m1.account.email === 'student@example.com' && m1.classes.some(c => c.sku === 'MAST-HG-FUND' && c.status === 'paid') && m1.classes.every(c => c.status === 'paid' || c.status === 'completed') && !m1.classes.some(c => c.sku === 'MAST-HG-OP') && m1.payment_method === null && Array.isArray(m1.account.standards_passed), JSON.stringify(m1).slice(0, 200));
  // update
  const upd = await postAuth('/account/update', { phone: '(713) 555-0199', address1: '1 Main St', address2: 'Houston, TX 77002', emergency_name: 'John Doe', emergency_phone: '(713) 555-0101', emergency_relationship: 'Spouse', password_hash: 'ignored' }, token); const u1 = await upd.json();
  ok('update saves the profile fields and ignores anything else', upd.status === 200 && u1.account.address1 === '1 Main St' && u1.account.emergency_name === 'John Doe' && accounts.get(r1.account.id).phone === '(713) 555-0199' && /^pbkdf2/.test(accounts.get(r1.account.id).password_hash), JSON.stringify(u1).slice(0, 160));
  // credentials (owner, 2026-09-08: "Need to add 'CREDENTIALS' to the account if LE Teacher")
  ok('an account with no credential reads none', u1.account.credential_type === 'none' && u1.account.credential_status === 'none' && u1.account.credential_id_last4 === '', JSON.stringify(u1.account).slice(0, 200));
  ok('an unknown credential type → 400', (await postAuth('/account/update', { credential_type: 'federal' }, token)).status === 400);
  ok('a badge number with punctuation in it → 400', (await postAuth('/account/update', { credential_type: 'le', credential_org: 'HPD', credential_id: 'HPD/1234' }, token)).status === 400);
  emails.length = 0;
  const cred = await postAuth('/account/update', { credential_type: 'le', credential_org: 'Houston Police Department', credential_id: 'HPD-4417', credential_status: 'verified' }, token); const c1 = await cred.json();
  const credRow = accounts.get(r1.account.id);
  ok('an LE credential saves as pending, stamped, and the client cannot set the status', cred.status === 200 && c1.account.credential_type === 'le' && c1.account.credential_status === 'pending' && credRow.credential_status === 'pending' && typeof credRow.credential_submitted_at === 'string', JSON.stringify(c1.account).slice(0, 240));
  ok('the number is stored whole and comes back as its last four only', credRow.credential_id === 'HPD-4417' && c1.account.credential_id_last4 === '4417' && !JSON.stringify(c1).includes('HPD-4417'), JSON.stringify(c1.account).slice(0, 240));
  ok('one credential-review email to the office, subject naming the member, type and org', emails.length === 1 && emails[0].to[0] === 'hq@atlasglinn.com' && emails[0].subject === 'Credential review needed: Jane Doe · Law enforcement · Houston Police Department', String(emails.length) + ' ' + (emails[0] ? emails[0].subject : ''));
  emails.length = 0;
  const again = await postAuth('/account/update', { credential_type: 'le', credential_org: 'Houston Police Department', phone: '(713) 555-0199' }, token);
  ok('re-saving the panel with the same credential does not restamp it or email again', again.status === 200 && emails.length === 0 && accounts.get(r1.account.id).credential_submitted_at === credRow.credential_submitted_at, 'emails=' + emails.length);
  const teacher = await postAuth('/account/update', { credential_type: 'teacher', credential_org: 'Klein ISD' }, token); const t1 = await teacher.json();
  ok('switching to teacher keeps the number on file and goes back to pending', teacher.status === 200 && t1.account.credential_type === 'teacher' && t1.account.credential_status === 'pending' && t1.account.credential_id_last4 === '4417', JSON.stringify(t1.account).slice(0, 240));
  emails.length = 0;
  const cleared = await postAuth('/account/update', { credential_type: 'none' }, token); const n1 = await cleared.json();
  ok('choosing None clears the credential and sends no review email', cleared.status === 200 && n1.account.credential_type === 'none' && n1.account.credential_status === 'none' && n1.account.credential_id_last4 === '' && accounts.get(r1.account.id).credential_id === '' && emails.length === 0, JSON.stringify(n1.account).slice(0, 240));
  // saved card: setup session on the account's Stripe Customer, then the webhook makes it the default, then me shows it
  stripeCalls.length = 0; stripeCustomerCalls.length = 0;
  const setup = await postAuth('/account/setup-payment', { successUrl: 'https://mastsolutions.com/mastsolutions.html?account=card-saved' }, token); const s1 = await setup.json();
  ok('setup-payment creates the Stripe Customer once and a Checkout session in setup mode on it', setup.status === 200 && s1.checkoutUrl && stripeCustomerCalls.some(c => c.method === 'POST' && /\/v1\/customers$/.test(c.url)) && stripeCalls[0].get('mode') === 'setup' && stripeCalls[0].get('customer') === 'cus_test_1', JSON.stringify({ status: setup.status, mode: stripeCalls[0] && stripeCalls[0].get('mode') }));
  ok('the customer id is stored on the account', accounts.get(r1.account.id).stripe_customer_id === 'cus_test_1');
  const setupEvent = JSON.stringify({ id: 'evt_setup_1', type: 'checkout.session.completed', data: { object: { id: 'cs_setup_1', mode: 'setup', customer: 'cus_test_1', setup_intent: 'seti_1', metadata: { kind: 'account_card' } } } });
  const ts = String(Math.floor(Date.now() / 1000)); const sig = await sign(setupEvent, ts);
  stripeCustomerCalls.length = 0; const before = stored.length;
  const bg = []; const bgCtx = { waitUntil: (p) => { bg.push(p); } };   // the card work runs after the 200 goes back to Stripe
  const wh = await worker.fetch(new Request('https://api.test/webhook', { method: 'POST', headers: { 'stripe-signature': 't=' + ts + ',v1=' + sig }, body: setupEvent }), env, bgCtx);
  await Promise.all(bg);
  ok('webhook: a setup-mode session sets the customer default payment method and stores no order', wh.status === 200 && stripeCustomerCalls.some(c => c.method === 'POST' && c.body && c.body.get('invoice_settings[default_payment_method]') === 'pm_saved_1') && stored.length === before, JSON.stringify(stripeCustomerCalls.map(c => c.method + ' ' + c.url.replace(/.*v1/, ''))));
  fakeDefaultCard = { type: 'card', card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030 } };
  const me2 = await (await get('/account/me', token)).json();
  ok('me shows the saved card (brand and last four only)', me2.payment_method && me2.payment_method.brand === 'visa' && me2.payment_method.last4 === '4242' && !JSON.stringify(me2).includes('pm_saved'), JSON.stringify(me2.payment_method));
  // a signed-in booking goes through the Stripe Customer
  stripeCalls.length = 0;
  // The hold this student took in the first registration block is well over 15 minutes old by now; only live holds count
  // against the two-per-address cap.
  for (const r of registrations.values()) if (r.status === 'pending' && r.customer_email === 'student@example.com') r.created_at = '2020-01-01T00:00:00Z';
  const booked = await reg(goodReg({ sku: 'MAST-HG-FUND', prerequisite: undefined, account_token: token }));
  ok('a signed-in registration checks out against the Stripe Customer with the saved card offered', booked.status === 200 && stripeCalls[0].get('customer') === 'cus_test_1' && !stripeCalls[0].has('customer_email') && stripeCalls[0].get('saved_payment_method_options[payment_method_save]') === 'enabled' && stripeCalls[0].get('metadata[account_id]') === r1.account.id, String(booked.status) + ' ' + JSON.stringify([...stripeCalls[0].entries()].filter(([k]) => /customer|account/.test(k))));
  stripeCalls.length = 0;
  const guest = await reg(goodReg({ sku: 'MAST-HG-FUND', prerequisite: undefined }));
  ok('a guest registration still checks out by email', guest.status === 200 && stripeCalls[0].get('customer_email') === 'student@example.com' && !stripeCalls[0].has('customer'));
  // password change kills the old token
  const pw = await postAuth('/account/password', { current: 'correct horse battery', password: 'a brand new long password' }, token); const p1 = await pw.json();
  ok('password change → 200 with a fresh token', pw.status === 200 && typeof p1.token === 'string' && p1.token !== token);
  ok('the old token is dead after a password change', (await get('/account/me', token)).status === 401);
  ok('the new token works', (await get('/account/me', p1.token)).status === 200);
  const relog = await post('/account/login', { email: 'student@example.com', password: 'a brand new long password' });
  ok('login with the new password → 200', relog.status === 200);
  /* ── the squat takeover, the four-step probe, now impossible by construction (round 5, then STRUCTURALLY round 7) ──
     Steps 1-4 as the round-4 review measured them: a stranger signs up victim@, the victim signs up with their OWN
     password, the victim enters the code from their OWN mailbox — and the account came up holding the STRANGER's
     password, because round 3's "a sign-up never overwrites an existing row" protected the row the stranger had already
     written. Round 5 stopped a sign-up writing an accounts row at all; rounds 5 and 6 then spent two rounds arguing
     over who owned the ONE pending row an address was allowed, and each answer was a takeover in the other direction.
     Round 7 gives every sign-up its own row and asks /account/verify for the password as well as the code, so the two
     sign-ups never meet: the owner's code finds the owner's row, and the stranger's password does not open it. There is
     no ordering, no wait and no replacement in this probe any more, because none of the three exists. */
  emails.length = 0;
  const squat = await post('/account/register', { email: 'victim@example.com', password: 'attacker password 1', name: 'Mallory' });
  const squatCode = codeIn(emails[0]);
  ok('a sign-up for another address gets no token, only a code sent to that address', squat.status === 202 && emails.length === 1 && emails[0].to[0] === 'victim@example.com');
  ok("the stranger's sign-up creates NO account — nothing for their password to be attached to", !rowFor('victim@example.com') && !!(await pendingFor('victim@example.com')), JSON.stringify({ account: !!rowFor('victim@example.com'), pending: !!(await pendingFor('victim@example.com')) }));
  ok('the squatter (right password, sign-up unverified) cannot sign in → 401 bad_login, the answer an unknown address gets', (await post('/account/login', { email: 'victim@example.com', password: 'attacker password 1' })).status === 401);
  emails.length = 0;
  const owner = await post('/account/register', { email: 'victim@example.com', password: 'the real owner pw', name: 'Vic Owner' });
  const ownerCode = codeIn(emails[0]);
  const both = await pendingsFor('victim@example.com');
  ok('the owner signs up at the same address seconds later and is NOT made to wait: their own 202, their own code, their own row — no hold, no replacement, nothing refused',
     owner.status === 202 && !!ownerCode && ownerCode !== squatCode && both.length === 2 && both.filter((r) => r.name === 'Vic Owner').length === 1 && both.filter((r) => r.name === 'Mallory').length === 1,
     JSON.stringify({ status: owner.status, rows: both.length, names: both.map((r) => r.name) }));
  ok('… and the two rows are strangers to each other: two signup_ids, two password hashes, two codes, and neither write moved the other',
     both.length === 2 && both[0].signup_id !== both[1].signup_id && both[0].password_hash !== both[1].password_hash && both[0].code_hash !== both[1].code_hash,
     JSON.stringify({ rows: both.length, ids: both.map((r) => r.signup_id.slice(0, 8)) }));
  const crossed = await post('/account/verify', { email: 'victim@example.com', code: squatCode, password: 'the real owner pw' });
  ok("THE OWNER CANNOT BE MADE TO COMPLETE THE STRANGER'S SIGN-UP — the code that arrived before they asked for one, entered with their own password, is refused and creates nothing",
     crossed.status === 401 && (await crossed.clone().json()).code === 'bad_code' && !rowFor('victim@example.com'),
     crossed.status + ' account=' + !!rowFor('victim@example.com'));
  const stolen = await post('/account/verify', { email: 'victim@example.com', code: ownerCode, password: 'attacker password 1' });
  ok("… and the stranger cannot complete the OWNER'S: the owner's code with the stranger's password is the same refusal, and still no account",
     stolen.status === 401 && (await stolen.clone().json()).code === 'bad_code' && !rowFor('victim@example.com'), stolen.status);
  ok('an unknown address and a wrong code answer byte for byte the same 401', await (async () => {
    const a = await post('/account/verify', { email: 'nobody-at-all@example.com', code: '123456', password: 'a long enough password' });
    const b = await post('/account/verify', { email: 'victim@example.com', code: ownerCode === '654321' ? '123456' : '654321', password: 'the real owner pw' });
    return a.status === b.status && a.status === 401 && JSON.stringify(await a.json()) === JSON.stringify(await b.json());
  })(), 'unknown vs wrong code must be indistinguishable');
  const ownerIn = await post('/account/verify', { email: 'victim@example.com', code: ownerCode, password: 'the real owner pw' });
  ok('the emailed code AND the password that asked for it verify the address', ownerIn.status === 200, String(ownerIn.status));
  ok('THE TAKEOVER IS GONE: the account the owner just verified holds the OWNER\'s password, and the stranger\'s does not sign in — no forgot/reset needed to undo it', (await post('/account/login', { email: 'victim@example.com', password: 'the real owner pw' })).status === 200 && (await post('/account/login', { email: 'victim@example.com', password: 'attacker password 1' })).status === 401, 'owner then attacker');
  ok('… and verifying wrote exactly one account and dropped EVERY sign-up waiting at the address, the stranger\'s included', [...accounts.values()].filter((a) => a.email === 'victim@example.com').length === 1 && (await pendingsFor('victim@example.com')).length === 0);
  // Forgot password still moves a password on a verified account, which is the ordinary recovery path.
  emails.length = 0;
  rowFor('victim@example.com').verify_sent_at = new Date(Date.now() - 120000).toISOString();
  const backIn = await post('/account/forgot', { email: 'victim@example.com' });
  const backCode = codeIn(emails[0]);
  const reclaimed = await post('/account/reset', { email: 'victim@example.com', code: backCode, password: 'a replacement owner pw' });
  ok('the owner can still move their own password through the mailbox', backIn.status === 200 && !!backCode && reclaimed.status === 200 && (await post('/account/login', { email: 'victim@example.com', password: 'a replacement owner pw' })).status === 200, String(reclaimed.status));
  // lockout and re-send
  emails.length = 0;
  // ONE connection makes the sign-up and asks for the re-send (round 7): /account/resend is unauthenticated, so the only
  // thing it can check is that the newest sign-up at the address came from the connection asking. Anyone else is served
  // the same nothing an unknown address is served — and can simply sign up again, which always mails.
  const LOCK_IP = '198.51.100.190';
  await post('/account/register', { email: 'locked@example.com', password: 'a long enough password' }, 'https://mastsolutions.com', LOCK_IP);
  const lockCode = codeIn(emails[0]); const statuses = [];
  // Round 3: five wrong codes from ONE connection refuse that connection and leave the code alone. The fifth used to
  // burn it outright, so a stranger holding nothing but an address could reach into the owner's inbox and invalidate the
  // code sitting in it — silently, once round 2 made every wrong answer identical. Answers stay identical; what changed
  // is that the owner's code survives.
  const STRANGER_IP = '198.51.100.200';
  const wrongFrom = (ip) => post('/account/verify', { email: 'locked@example.com', code: lockCode === '111111' ? '222222' : '111111', password: 'a long enough password' }, 'https://mastsolutions.com', ip);
  for (let i = 0; i < 5; i++) statuses.push((await wrongFrom(STRANGER_IP)).status);
  const sixthGuess = await wrongFrom(STRANGER_IP);
  ok("five wrong codes from one connection answer the same 401, refuse that connection, and do NOT burn the owner's code", statuses.join() === '401,401,401,401,401' && sixthGuess.status === 401 && !!(await pendingFor('locked@example.com')).code_hash && (await pendingFor('locked@example.com')).verify_attempts === 5, statuses.join() + ' then ' + sixthGuess.status + ' attempts=' + (await pendingFor('locked@example.com')).verify_attempts);
  emails.length = 0;
  ok('resend from a connection that did NOT make the sign-up → the same 200 and no email: nothing of anyone else\'s is ever re-mailed or renewed', (await post('/account/resend', { email: 'locked@example.com' })).status === 200 && emails.length === 0);
  ok('resend from the connection that DID make it → 200 and a new code email', (await post('/account/resend', { email: 'locked@example.com' }, 'https://mastsolutions.com', LOCK_IP)).status === 200 && emails.length === 1);
  ok('resend for an unknown email → 200 and no email (no account enumeration)', (await post('/account/resend', { email: 'nobody@example.com' }, 'https://mastsolutions.com', LOCK_IP)).status === 200 && emails.length === 1);
  ok('the new code works', (await post('/account/verify', { email: 'locked@example.com', code: codeIn(emails[0]), password: 'a long enough password' })).status === 200);
  // parallel guesses cannot share an attempt count (Codex on PR #11, P1): eight at once, at most five are ever compared
  emails.length = 0;
  await post('/account/register', { email: 'raced@example.com', password: 'a long enough password' });
  const raceCode = codeIn(emails[0]);
  const raced = await Promise.all(Array.from({ length: 8 }, (_, i) => post('/account/verify', { email: 'raced@example.com', code: String(900000 + i) === raceCode ? '000000' : String(900000 + i), password: 'a long enough password' })));
  const raceStatuses = raced.map((r) => r.status);
  const racedRow = await pendingFor('raced@example.com');
  const raceBodies = new Set(await Promise.all(raced.map((r) => r.clone().text())));
  // The claim-first UPDATE inside checkCode still bounds the comparisons at five however many arrive at once; what
  // changed is that all eight answers are now one answer, so the count cannot be read off the status codes either.
  ok('eight concurrent wrong guesses answer 401 with one identical body, and each try is claimed exactly once', raceStatuses.every((s) => s === 401) && raceBodies.size === 1 && racedRow.verify_attempts === 8 && !!racedRow.code_hash, raceStatuses.join() + ' bodies=' + raceBodies.size + ' attempts=' + racedRow.verify_attempts);
  ok('… and the right code still works afterwards: eight wrong tries is not twenty', (await post('/account/verify', { email: 'raced@example.com', code: raceCode, password: 'a long enough password' })).status === 200);
  // forgotten password (Codex P2)
  emails.length = 0;
  ok('forgot for an unknown email → 200 and no email', (await post('/account/forgot', { email: 'nobody@example.com' })).status === 200 && emails.length === 0);
  // Pinned explicitly: the sign-up attempts above no longer touch verify_sent_at (they throttle on signup_notice_sent_at),
  // so this assertion has to set up the state it is about instead of inheriting it from a stranger's request.
  rowFor('student@example.com').verify_sent_at = new Date().toISOString();
  ok('forgot within a minute of the last code → the same 200 and no email (no account enumeration)', (await post('/account/forgot', { email: 'student@example.com' })).status === 200 && emails.length === 0);
  rowFor('student@example.com').verify_sent_at = new Date(Date.now() - 120000).toISOString();   // the sign-up code went out a while ago
  const forgot = await post('/account/forgot', { email: 'student@example.com' });
  ok('forgot for a verified account → 200 and a reset code emailed to the student alone', forgot.status === 200 && emails.length === 1 && emails[0].to[0] === 'student@example.com' && !emails[0].bcc && /Reset your MAST Solutions password/.test(emails[0].subject), JSON.stringify(emails[0] && emails[0].subject));
  const resetCode = codeIn(emails[0]);
  ok('reset with a wrong code → 400', (await post('/account/reset', { email: 'student@example.com', code: resetCode === '333333' ? '444444' : '333333', password: 'yet another long password' })).status === 400);
  ok('reset with a short password → 400', (await post('/account/reset', { email: 'student@example.com', code: resetCode, password: 'short' })).status === 400);
  const reset = await post('/account/reset', { email: 'student@example.com', code: resetCode, password: 'yet another long password' }); const rs = await reset.json();
  ok('reset with the code → 200 with a token; the old token is dead; the new password works', reset.status === 200 && typeof rs.token === 'string' && (await get('/account/me', p1.token)).status === 401 && (await post('/account/login', { email: 'student@example.com', password: 'yet another long password' })).status === 200, String(reset.status) + ' ' + JSON.stringify(rs).slice(0, 120));
  ok('a used reset code does not work twice', (await post('/account/reset', { email: 'student@example.com', code: resetCode, password: 'yet another long password 2' })).status === 400);
  // retention: unverified accounts older than a day go, verified ones stay
  accounts.set('acct_stale', { id: 'acct_stale', email: 'stale@example.com', password_hash: 'x', token_version: 1, created_at: '2020-01-01T00:00:00Z', verified_at: null });
  let ran2 = null; await worker.scheduled({}, env, { waitUntil: (p) => { ran2 = p; } }); await ran2;
  ok('the daily cron removes unverified accounts older than a day and keeps verified ones', !accounts.has('acct_stale') && accounts.has(r1.account.id));
  // no email leg → sign-up is off, sign-in still works
  const savedResend = env.RESEND_API_KEY; env.RESEND_API_KEY = '';
  const noMail = await post('/account/register', { email: 'new@example.com', password: 'a long enough password' });
  ok('without RESEND_API_KEY sign-up answers 503 email_off', noMail.status === 503 && (await noMail.json()).code === 'email_off');
  ok('… and a verified student can still sign in', (await post('/account/login', { email: 'student@example.com', password: 'yet another long password' })).status === 200);
  env.RESEND_API_KEY = savedResend;
  // accounts off without the secret
  const saved = env.ACCOUNT_SECRET; delete env.ACCOUNT_SECRET;
  const off = await post('/account/login', { email: 'student@example.com', password: 'a brand new long password' });
  ok('without ACCOUNT_SECRET the account endpoints answer 503', off.status === 503 && (await off.json()).code === 'accounts_off');
  env.ACCOUNT_SECRET = saved;
  emails.length = 0;
}



console.log('\n── Rate limiting, lockout and seat holds (security review, 2026-09-08) ──');
{
  const { lockMs, LOGIN_FAILURES_PER_LOCK, WINDOW_MS } = await import('./src/ratelimit.js');
  const from = (path, body, ip) => worker.fetch(new Request('https://api.test' + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://mastsolutions.com', 'CF-Connecting-IP': ip }, body: JSON.stringify(body),
  }), env, ctx);
  const rowFor = (email) => [...accounts.values()].find((a) => a.email === email);

  // ── per-account lockout ──
  resetLimits(); emails.length = 0;
  await post('/account/register', { email: 'lockme@example.com', password: 'a long enough password' });
  const lockRow = rowFor('lockme@example.com');
  const lockCode = (/\b(\d{6})\b/.exec(emails[0].text) || [])[1];
  await post('/account/verify', { email: 'lockme@example.com', code: lockCode, password: 'a long enough password' });
  ok('lockout fixture: the account is verified and starts with no failures', !!rowFor('lockme@example.com').verified_at && !rowFor('lockme@example.com').failed_logins);

  resetLimits();
  const wrong = [];
  for (let i = 0; i < LOGIN_FAILURES_PER_LOCK; i++) wrong.push((await post('/account/login', { email: 'lockme@example.com', password: 'not the password ' + i })).status);
  ok('five wrong passwords all answer the plain 401 — the fifth does not announce that the address exists', wrong.join() === '401,401,401,401,401', wrong.join());
  ok('… and the fifth failure set a lock 15 minutes out', rowFor('lockme@example.com').failed_logins === 5 && Date.parse(rowFor('lockme@example.com').locked_until) - Date.now() > 14 * 60000, JSON.stringify({ n: rowFor('lockme@example.com').failed_logins, until: rowFor('lockme@example.com').locked_until }));
  // The sixth answers what the fifth answered, and what an address with no account answers (round 6). It used to answer
  // `429 locked`, which is a per-ACCOUNT state — the lock is global — so six requests from six connections classified
  // any address on status alone. What the lock still does is refuse a CORRECT password, which is the whole of its job.
  const sixth = await post('/account/login', { email: 'lockme@example.com', password: 'not the password 6' }); const sb = await sixth.json();
  const fifthBody = { error: 'That email and password do not match.', code: 'bad_login' };
  ok('the sixth attempt answers the same 401 bad_login the fifth did, with no Retry-After and nothing that names a lock',
     sixth.status === 401 && JSON.stringify(sb) === JSON.stringify(fifthBody) && !sixth.headers.get('Retry-After'),
     String(sixth.status) + ' ' + JSON.stringify(sb) + ' retry-after=' + sixth.headers.get('Retry-After'));
  ok('a locked account still refuses the RIGHT password — and refuses it with that same 401, so the refusal does not say the account exists',
     await (async () => { const r = await post('/account/login', { email: 'lockme@example.com', password: 'a long enough password' }); return r.status === 401 && JSON.stringify(await r.json()) === JSON.stringify(fifthBody); })(),
     'the lock shows only in that a correct password is refused');
  ok('… and a locked account does NOT walk its own ladder up: the requests the lock refuses take the absent branch, so failed_logins stays where the fifth failure left it',
     rowFor('lockme@example.com').failed_logins === 5, 'failed_logins=' + rowFor('lockme@example.com').failed_logins);
  ok('the lock doubles at every further five, capped at a day', lockMs(5) === 900000 && lockMs(10) === 1800000 && lockMs(15) === 3600000 && lockMs(500) === 86400000, [lockMs(5), lockMs(10), lockMs(15), lockMs(500)].join());
  ok('the lock is per account, not global: another account signs in while this one is locked', (await post('/account/login', { email: 'student@example.com', password: 'yet another long password' })).status === 200);

  // the lock runs out → the right password works again and the counter is reset
  rowFor('lockme@example.com').locked_until = new Date(Date.now() - 1000).toISOString();
  const back = await post('/account/login', { email: 'lockme@example.com', password: 'a long enough password' });
  ok('once the lock has run out the right password signs in again', back.status === 200 && typeof (await back.json()).token === 'string', String(back.status));
  ok('a successful sign-in clears the counter and the lock', rowFor('lockme@example.com').failed_logins === 0 && !rowFor('lockme@example.com').locked_until, JSON.stringify({ n: rowFor('lockme@example.com').failed_logins, until: rowFor('lockme@example.com').locked_until }));

  // ── per-IP window ──
  resetLimits();
  const IP = '198.51.100.7';
  const codes = [];
  for (let i = 0; i < 22; i++) codes.push((await from('/account/login', { email: 'lockme@example.com', password: 'a long enough password' }, IP)).status);
  ok('one address gets 20 sign-in attempts per 10-minute window, then 429', codes.slice(0, 20).every((c) => c === 200) && codes[20] === 429 && codes[21] === 429, codes.join());
  const over = await from('/account/login', { email: 'lockme@example.com', password: 'a long enough password' }, IP); const ob = await over.json();
  ok('the per-IP 429 carries Retry-After and code rate_limited', ob.code === 'rate_limited' && ob.retry_after > 0 && ob.retry_after <= WINDOW_MS / 1000 && over.headers.get('Retry-After') === String(ob.retry_after), JSON.stringify(ob));
  ok('… and another address is unaffected', (await from('/account/login', { email: 'lockme@example.com', password: 'a long enough password' }, '198.51.100.8')).status === 200);
  ok('the window rolls: an expired window starts a fresh count', await (async () => {
    const r = rateLimits.get('login:' + IP); r.window_start = new Date(Date.now() - 11 * 60000).toISOString();
    return (await from('/account/login', { email: 'lockme@example.com', password: 'a long enough password' }, IP)).status === 200;
  })());

  resetLimits();
  const signups = [];
  for (let i = 0; i < 7; i++) signups.push((await from('/account/register', { email: 'spray' + i + '@example.com', password: 'a long enough password' }, '198.51.100.9')).status);
  ok('sign-up is 5 per window from one address, then 429', signups.slice(0, 5).every((c) => c === 202) && signups[5] === 429 && signups[6] === 429, signups.join());

  resetLimits();
  const mails = [];
  for (let i = 0; i < 6; i++) mails.push((await from(i % 2 ? '/account/forgot' : '/account/resend', { email: 'lockme@example.com' }, '198.51.100.10')).status);
  ok('forgot and resend share one 5-per-window budget: both mail a code to whatever address is posted', mails.slice(0, 5).every((c) => c === 200) && mails[5] === 429, mails.join());

  resetLimits();
  const beacon = [];
  for (let i = 0; i < 62; i++) beacon.push((await from('/event', { action: 'view', page: 'p' }, '198.51.100.11')).status);
  // Back in the table (round 3, 2026-09-08). Round 2 took it out to save a D1 write per page view — but /event IS a D1
  // insert, so leaving it out saved nothing and removed the only bound on how many an anonymous caller could ask for.
  ok('the page-view beacon is 60 per window from one address, then 429', beacon.slice(0, 60).every((c) => c === 200) && beacon[60] === 429 && beacon[61] === 429 && rateLimits.has('event:198.51.100.11'), beacon.slice(58).join());

  // ── the limiter's own D1 failure ──
  resetLimits(); rateFail = true;
  const failLogin = await from('/account/login', { email: 'lockme@example.com', password: 'a long enough password' }, '198.51.100.12');
  const failEvent = await from('/event', { action: 'view', page: 'p' }, '198.51.100.12');
  const failReg = await from('/register', goodReg(), '198.51.100.12');
  rateFail = false;
  ok('a D1 failure in the limiter FAILS CLOSED on sign-in → 429, never a free guessing window', failLogin.status === 429 && (await failLogin.json()).code === 'rate_limited', String(failLogin.status));
  ok('… and fails closed on /register too', failReg.status === 429, String(failReg.status));
  ok('… and /event fails closed with everything else: a beacon answering 429 for a minute costs a visitor nothing', failEvent.status === 429 && (await failEvent.json()).code === 'rate_limited', String(failEvent.status));
  ok('the limiter recovers on the next request once D1 is back', (await from('/account/login', { email: 'lockme@example.com', password: 'a long enough password' }, '198.51.100.13')).status === 200);

  // ── seat holds ──
  resetLimits();
  const HOLD_SKU = 'MAST-HG-FUND', HOLD_DATE = '2026-11-14';
  for (const r of [...registrations.values()]) if (r.sku === HOLD_SKU && r.session_date === HOLD_DATE) registrations.delete(r.id);
  const holdBody = (n) => goodReg({ sku: HOLD_SKU, prerequisite: undefined, session_date: HOLD_DATE, qty: 1, customer: { name: 'Hold ' + n, email: 'hold' + n + '@example.com', phone: '(713) 555-0100', organization: '' } });

  stripeCalls.length = 0;
  const h1 = await (await from('/register', holdBody(1), '198.51.100.20')).json();
  const heldRow = registrations.get(h1.registration_id);
  ok('a booking stores the registration, then reaches Stripe, then stamps the session id on it', heldRow && heldRow.status === 'pending' && heldRow.stripe_session_id === 'cs_test_123' && stripeCalls.length === 1, JSON.stringify(heldRow && { s: heldRow.status, sid: heldRow.stripe_session_id }));

  // A pending row with no Stripe session id holds its seats for TWO MINUTES and then nothing (round 2, 2026-09-08).
  // Round 1 made the session id the whole condition, which widened the oversell race to a full Stripe round trip: honest
  // simultaneous buyers all passed the capacity check while every one of their rows was still session-less.
  registrations.set('reg_no_session', { id: 'reg_no_session', created_at: new Date().toISOString(), status: 'pending', sku: HOLD_SKU, session_date: HOLD_DATE, qty: 16, customer_email: 'ghost@example.com', agreement_ip: '198.51.100.99', stripe_session_id: null });
  const inWindow = await from('/register', holdBody(2), '198.51.100.21'); const iw = await inWindow.json();
  ok('a session-less row seconds old DOES hold its 16 seats: two honest buyers cannot oversell across the Stripe call', inWindow.status === 409 && iw.code === 'sold_out', String(inWindow.status) + ' ' + JSON.stringify(iw).slice(0, 120));
  registrations.get('reg_no_session').created_at = new Date(Date.now() - 3 * 60000).toISOString();
  const past = await from('/register', holdBody(2), '198.51.100.21');
  ok('… and three minutes later that same row holds nothing: a POST that never reached Stripe cannot empty a class', past.status === 200, String(past.status) + ' ' + JSON.stringify(await past.clone().json()).slice(0, 120));
  registrations.get('reg_no_session').stripe_session_id = 'cs_test_ghost';
  registrations.get('reg_no_session').created_at = new Date(Date.now() - 3 * 60000).toISOString();
  const blocked = await from('/register', holdBody(3), '198.51.100.22'); const bb = await blocked.json();
  ok('… and the moment that same row carries a session id it holds all 16 again, for the full 15 minutes', blocked.status === 409 && bb.code === 'sold_out', String(blocked.status) + ' ' + JSON.stringify(bb).slice(0, 120));
  registrations.delete('reg_no_session');
  for (const r of [...registrations.values()]) if (r.sku === HOLD_SKU && r.session_date === HOLD_DATE && r.id !== h1.registration_id) registrations.delete(r.id);

  // The two windows, read straight off the predicate the Worker uses.
  const HELD = "(status = 'pending' AND ((stripe_session_id IS NOT NULL AND created_at > ?) OR (stripe_session_id IS NULL AND created_at > ?)))";
  const seatsNow = async () => Number((await env.DB.prepare(`SELECT COALESCE(SUM(qty), 0) AS n FROM registrations WHERE sku = ? AND session_date = ? AND (status = 'paid' OR ${HELD})`)
    .bind(HOLD_SKU, HOLD_DATE, new Date(Date.now() - 15 * 60000).toISOString(), new Date(Date.now() - 2 * 60000).toISOString()).first()).n);
  const aged = registrations.get(h1.registration_id);
  aged.created_at = new Date(Date.now() - 20 * 60000).toISOString();
  ok('a hold WITH a session id 20 minutes old no longer counts: that window is 15 minutes, not the old 30', (await seatsNow()) === 0, 'seats=' + (await seatsNow()));
  aged.created_at = new Date(Date.now() - 10 * 60000).toISOString();
  ok('… and at 10 minutes it still counts', (await seatsNow()) === 1, 'seats=' + (await seatsNow()));
  aged.stripe_session_id = null;
  ok('the same row without a session id holds nothing at 10 minutes: the pre-Stripe window is 2 minutes', (await seatsNow()) === 0, 'seats=' + (await seatsNow()));
  aged.created_at = new Date(Date.now() - 60000).toISOString();
  ok('… and holds its seat at 1 minute', (await seatsNow()) === 1, 'seats=' + (await seatsNow()));
  registrations.delete(h1.registration_id);

  // two live holds per address, and two per connection
  resetLimits();
  for (const r of [...registrations.values()]) if (r.sku === HOLD_SKU && r.session_date === HOLD_DATE) registrations.delete(r.id);
  const sameEmail = { name: 'Repeat Booker', email: 'repeat@example.com', phone: '(713) 555-0100', organization: '' };
  const one = (ip) => from('/register', goodReg({ sku: HOLD_SKU, prerequisite: undefined, session_date: HOLD_DATE, qty: 1, customer: sameEmail }), ip);
  const e1 = await one('198.51.100.30'); const e2 = await one('198.51.100.30'); const e3 = await one('198.51.100.30');
  const e3b = await e3.json();
  ok('two live holds per address from one connection, and the third is refused with 429 too_many_holds', e1.status === 200 && e2.status === 200 && e3.status === 429 && e3b.code === 'too_many_holds' && e3.headers.get('Retry-After') === '900', [e1.status, e2.status, e3.status].join() + ' ' + JSON.stringify(e3b).slice(0, 140));
  // The cap is bound to the PAIR (round 2, 2026-09-08). customer_email is typed by whoever posts the form, so a cap on
  // the address alone let a stranger take two holds under a known customer's address and answer that customer's own
  // booking with 429. The trade is stated rather than hidden: holds under one address from DIFFERENT connections no
  // longer add up, and the per-connection cap plus the 10-per-window seat limit are what bound them.
  for (const r of [...registrations.values()]) if (r.sku === HOLD_SKU && r.session_date === HOLD_DATE) registrations.delete(r.id);
  const s1 = await one('198.51.100.33'); const s2 = await one('198.51.100.34'); const s3 = await one('198.51.100.35');
  ok('a stranger cannot lock a known customer out by typing their address: holds from other connections do not count against them', s1.status === 200 && s2.status === 200 && s3.status === 200, [s1.status, s2.status, s3.status].join());

  resetLimits();
  for (const r of [...registrations.values()]) if (r.sku === HOLD_SKU && r.session_date === HOLD_DATE) registrations.delete(r.id);
  const ONE_IP = '198.51.100.40';
  const i1 = await from('/register', holdBody(41), ONE_IP);
  const i2 = await from('/register', holdBody(42), ONE_IP);
  const i3 = await from('/register', holdBody(43), ONE_IP);
  ok('two live holds per connection, whatever addresses they are booked under', i1.status === 200 && i2.status === 200 && i3.status === 429 && (await i3.json()).code === 'too_many_holds', [i1.status, i2.status, i3.status].join());

  // The per-IP window on /register, isolated from the hold cap: each hold is cleared before the next request, so the only
  // thing that can refuse the eleventh is the rate limit.
  resetLimits();
  const clearHolds = () => { for (const r of [...registrations.values()]) if (r.sku === HOLD_SKU && r.session_date === HOLD_DATE) registrations.delete(r.id); };
  clearHolds();
  const seatSpray = [], seatCodes = [];
  for (let i = 0; i < 12; i++) {
    const res = await from('/register', holdBody(60 + i), '198.51.100.50');
    seatSpray.push(res.status); seatCodes.push((await res.json()).code);
    clearHolds();
  }
  ok('/register is 10 per window from one address, then 429 rate_limited — the seat-hold route cannot be sprayed', seatSpray.slice(0, 10).every((c) => c === 200) && seatSpray[10] === 429 && seatCodes[10] === 'rate_limited' && seatSpray[11] === 429, seatSpray.join() + ' / ' + seatCodes[10]);
  clearHolds();

  resetLimits();
  const leads = [];
  for (let i = 0; i < 32; i++) leads.push((await from('/contact', { name: 'Lead ' + i, email: 'lead' + i + '@example.com', message: 'A message long enough.' }, '198.51.100.60')).status);
  ok('/contact is 30 per window from one address, then 429', leads.slice(0, 30).every((c) => c === 200) && leads[30] === 429 && leads[31] === 429, leads.slice(28).join());

  // ── the daily cron purges the counter rows ──
  resetLimits();
  rateLimits.set('login:1.2.3.4', { key: 'login:1.2.3.4', window_start: '2020-01-01T00:00:00Z', count: 9 });
  rateLimits.set('login:5.6.7.8', { key: 'login:5.6.7.8', window_start: new Date().toISOString(), count: 1 });
  let ranRate = null; await worker.scheduled({}, env, { waitUntil: (p) => { ranRate = p; } }); await ranRate;
  ok('the daily cron drops rate-limit rows older than a day and keeps live ones', !rateLimits.has('login:1.2.3.4') && rateLimits.has('login:5.6.7.8'), [...rateLimits.keys()].join());
  resetLimits();
  emails.length = 0;
}

console.log('\n── Account oracles, limiter coverage and schema retry (security review round 2, 2026-09-08) ──');
{
  const { ensureRateSchema, _resetRateSchemaMemo, RATE_SCHEMA, ruleFor, clientIp } = await import('./src/ratelimit.js');
  const from = (path, body, ip, extra = {}) => worker.fetch(new Request('https://api.test' + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://mastsolutions.com', 'CF-Connecting-IP': ip, ...extra }, body: JSON.stringify(body),
  }), env, ctx);
  const getFrom = (path, ip) => worker.fetch(new Request('https://api.test' + path, { method: 'GET', headers: { Origin: 'https://mastsolutions.com', 'CF-Connecting-IP': ip } }), env, ctx);
  const rowFor = (email) => [...accounts.values()].find((a) => a.email === email);
  const codeIn = (m) => (/\b(\d{6})\b/.exec((m && m.text) || '') || [])[1];
  const same = async (a, b) => a.status === b.status && (await a.clone().text()) === (await b.clone().text());
  // A verified account to probe against, and the address of one that has never existed.
  const make = async (email, password) => {
    emails.length = 0;
    await post('/account/register', { email, password });
    const code = codeIn(emails[0]);
    await post('/account/verify', { email, code, password });
    return rowFor(email);
  };
  const GHOST = 'no-such-person-at-all@example.com';
  // No live code — what every real account looks like when nobody has just asked for one. This is the state that used to
  // answer 'expired' where an invented address answered 'bad_code'.
  const clearCodeOn = (email) => Object.assign(rowFor(email), { verify_kind: null, verify_code_hash: null, verify_expires_at: null, verify_attempts: 0 });
  // The same state on a PENDING sign-up: a real half-finished sign-up with no live code, which is what a probe lands in.
  const clearPendingCodeOn = async (email) => Object.assign(await pendingFor(email), { verify_code_hash: null, verify_expires_at: null, verify_attempts: 0 });

  // ── H2-1: POST /account/reset was a one-request account-existence oracle ──
  resetLimits();
  await make('oracle@example.com', 'a long enough password');
  const rKnown = await post('/account/reset', { email: 'oracle@example.com', code: '123456', password: 'a replacement password' });
  const rGhost = await post('/account/reset', { email: GHOST, code: '123456', password: 'a replacement password' });
  ok('reset against a VERIFIED address with no live code answers what an unknown address answers, byte for byte', await same(rKnown, rGhost) && rKnown.status === 400 && (await rKnown.clone().json()).code === 'bad_code', rKnown.status + ' ' + (await rKnown.clone().text()) + '  vs  ' + rGhost.status + ' ' + (await rGhost.clone().text()));
  // and with a live code: wrong digits, and then a burned code, answer the same thing too
  rowFor('oracle@example.com').verify_sent_at = new Date(Date.now() - 120000).toISOString();
  emails.length = 0;
  await post('/account/forgot', { email: 'oracle@example.com' });
  const liveCode = codeIn(emails[0]);
  const rWrong = await post('/account/reset', { email: 'oracle@example.com', code: liveCode === '123456' ? '654321' : '123456', password: 'a replacement password' });
  ok('… and with a live code, wrong digits answer it too', await same(rWrong, rGhost), rWrong.status + ' ' + (await rWrong.clone().text()));
  // Twenty wrong tries in total, from twenty connections (post() gives each request its own address), because five from
  // ONE connection now refuse that connection instead of burning the code — round 3.
  const guesses = []; for (let n = 100000; guesses.length < 20; n++) if (String(n) !== liveCode) guesses.push(String(n));
  const burn = [];
  for (const g of guesses) burn.push((await post('/account/reset', { email: 'oracle@example.com', code: g, password: 'a replacement password' })).status);
  const rBurned = await post('/account/reset', { email: 'oracle@example.com', code: liveCode, password: 'a replacement password' });
  ok('… and once twenty tries are spent the code is burned, and the answer is still that one answer', burn.every((s) => s === 400) && (await same(rBurned, rGhost)) && !rowFor('oracle@example.com').verify_code_hash, burn.length + ' tries then ' + rBurned.status);

  // ── H2-1: the same shape on POST /account/verify ──
  resetLimits(); emails.length = 0;
  await post('/account/register', { email: 'unverified-real@example.com', password: 'a long enough password' });
  await clearPendingCodeOn('unverified-real@example.com');   // a real, half-finished sign-up with NO live code — the ordinary state
  const vKnown = await post('/account/verify', { email: 'unverified-real@example.com', code: '123456', password: 'a long enough password' });
  const vGhost = await post('/account/verify', { email: GHOST, code: '123456', password: 'a long enough password' });
  ok('verify against a REAL half-finished sign-up with no live code answers what an unknown address answers, byte for byte', await same(vKnown, vGhost) && vKnown.status === 401 && (await vKnown.clone().json()).code === 'bad_code', vKnown.status + ' ' + (await vKnown.clone().text()) + '  vs  ' + vGhost.status + ' ' + (await vGhost.clone().text()));
  // The MESSAGE still says "or it has expired" — that is the advice both old answers used to carry, and it is now given
  // to every caller including one holding an address that has no account. What must never come back is the machine-
  // readable code, which is what a script would branch on.
  const codesSeen = await Promise.all([rKnown, rWrong, rBurned, vKnown, vGhost, rGhost].map(async (r) => (await r.clone().json()).code));
  ok('every one of those answers carries code bad_code — never expired, never locked', codesSeen.every((c) => c === 'bad_code'), codesSeen.join());

  // ── H2-3: the sixth wrong password, for an address that has an account and one that does not ──
  resetLimits();
  await make('locksym@example.com', 'a long enough password');
  const ONE = '198.51.100.70';
  const real = [], ghost = [];
  for (let i = 0; i < 5; i++) real.push((await from('/account/login', { email: 'locksym@example.com', password: 'wrong password ' + i }, ONE)).status);
  for (let i = 0; i < 5; i++) ghost.push((await from('/account/login', { email: GHOST, password: 'wrong password ' + i }, ONE)).status);
  const sixReal = await from('/account/login', { email: 'locksym@example.com', password: 'wrong password 6' }, ONE);
  const sixGhost = await from('/account/login', { email: GHOST, password: 'wrong password 6' }, ONE);
  ok('five wrong passwords answer 401 whether or not the address has an account', real.join() === '401,401,401,401,401' && ghost.join() === '401,401,401,401,401', real.join() + ' / ' + ghost.join());
  ok('the SIXTH answers 401 bad_login for both — a locked address and an invented one are the same answer, byte for byte (round 6: it used to be 429 locked for both, which still separated a locked address from an unlocked one)',
     sixReal.status === 401 && sixGhost.status === 401 && (await sixReal.clone().json()).code === 'bad_login' && (await sixGhost.clone().json()).code === 'bad_login' && (await same(sixReal, sixGhost)),
     sixReal.status + ' ' + (await sixReal.clone().text()) + '  vs  ' + sixGhost.status + ' ' + (await sixGhost.clone().text()));
  ok('… and the lock is per (connection, address): a different address from the same connection is unaffected', (await from('/account/login', { email: 'oracle@example.com', password: 'not it either' }, ONE)).status === 401);
  ok('the right password clears the pair: a sign-in after four failures leaves no lock behind', await (async () => {
    const IP2 = '198.51.100.71';
    for (let i = 0; i < 4; i++) await from('/account/login', { email: 'locksym@example.com', password: 'wrong ' + i }, IP2);
    rowFor('locksym@example.com').failed_logins = 0; rowFor('locksym@example.com').locked_until = null;   // the per-account half, cleared separately
    const good = await from('/account/login', { email: 'locksym@example.com', password: 'a long enough password' }, IP2);
    const after = [];
    for (let i = 0; i < 5; i++) after.push((await from('/account/login', { email: 'locksym@example.com', password: 'wrong again ' + i }, IP2)).status);
    return good.status === 200 && after.join() === '401,401,401,401,401';
  })());

  // ── H2-2: a stranger's sign-up attempt must not hold the owner's reset shut ──
  resetLimits();
  const owner = await make('holdshut@example.com', 'the owners real password');
  owner.verify_sent_at = new Date(Date.now() - 120000).toISOString();
  const verifyStampBefore = rowFor('holdshut@example.com').verify_sent_at;
  emails.length = 0;
  const attack = await from('/account/register', { email: 'holdshut@example.com', password: 'the attackers password' }, '198.51.100.80');
  ok('a stranger signing up at a verified address still gets the same 202 envelope, and the owner is told', attack.status === 202 && emails.length === 1 && /Someone tried to create a MAST Solutions account/.test(emails[0].subject), attack.status + ' emails=' + emails.length);
  ok('… and it stamped signup_notice_sent_at, NOT verify_sent_at', !!rowFor('holdshut@example.com').signup_notice_sent_at && rowFor('holdshut@example.com').verify_sent_at === verifyStampBefore, JSON.stringify({ notice: rowFor('holdshut@example.com').signup_notice_sent_at, verify: rowFor('holdshut@example.com').verify_sent_at }));
  emails.length = 0;
  const reset = await from('/account/forgot', { email: 'holdshut@example.com' }, '198.51.100.81');
  ok('… so the owner\'s own password reset still goes out: the stranger cannot hold it shut', reset.status === 200 && emails.length === 1 && /Reset your MAST Solutions password/.test(emails[0].subject) && !!codeIn(emails[0]), reset.status + ' emails=' + emails.length + ' ' + (emails[0] && emails[0].subject));
  emails.length = 0;
  const attack2 = await from('/account/register', { email: 'holdshut@example.com', password: 'the attackers password' }, '198.51.100.82');
  ok('… and the notice itself is still throttled to one a minute on its own column', attack2.status === 202 && emails.length === 0, attack2.status + ' emails=' + emails.length);

  // ── H2-7: when Resend refuses, both sign-up paths answer the same thing ──
  // Round 5: the answer on both is the ordinary 202. The mail leaves through ctx.waitUntil like every other code send,
  // so a refusing provider is a log line rather than a status code — the 502 email_failed this used to assert was itself
  // a statement that the mail leg had run at all, which is a thing only one of the two branches could say.
  resetLimits();
  const notTooSoon = rowFor('holdshut@example.com'); notTooSoon.signup_notice_sent_at = new Date(Date.now() - 120000).toISOString();
  resendStatus = 500;
  const failNew = await from('/account/register', { email: 'brand-new-address@example.com', password: 'a long enough password' }, '198.51.100.83');
  const failKnown = await from('/account/register', { email: 'holdshut@example.com', password: 'the attackers password' }, '198.51.100.84');
  await drain();
  resendStatus = 200;
  const shapeReg = async (r, email) => (await r.clone().text()).split(email).join('<ADDRESS>');
  ok('a Resend outage answers identically for a new address and one that has an account — the ordinary 202 both ways, never a 502 that names the mail leg', failNew.status === 202 && failKnown.status === 202 && (await shapeReg(failNew, 'brand-new-address@example.com')) === (await shapeReg(failKnown, 'holdshut@example.com')), failNew.status + ' ' + (await failNew.clone().text()) + '  vs  ' + failKnown.status + ' ' + (await failKnown.clone().text()));
  // and the throttled retry is 202 on both paths too, so the second request does not separate them either
  const soonNew = await from('/account/register', { email: 'brand-new-address@example.com', password: 'a long enough password' }, '198.51.100.85');
  const soonKnown = await from('/account/register', { email: 'holdshut@example.com', password: 'the attackers password' }, '198.51.100.86');
  // The envelope names the address the caller typed — their own input, not a fact about the database — so the two bodies
  // are compared with that address blanked out.
  const shape = async (r, email) => (await r.clone().text()).split(email).join('<ADDRESS>');
  ok('… and a retry inside the throttle window answers the same 202 on both paths, so the second request separates them no better', soonNew.status === soonKnown.status && soonNew.status === 202 && (await shape(soonNew, 'brand-new-address@example.com')) === (await shape(soonKnown, 'holdshut@example.com')), soonNew.status + ' ' + (await soonNew.clone().text()) + '  vs  ' + soonKnown.status + ' ' + (await soonKnown.clone().text()));

  // ── H2-5: honest concurrent buyers cannot oversell across the Stripe round trip ──
  const RACE_SKU = 'MAST-HG-OP', RACE_DATE = '2026-12-12';   // capacity 10 in the fake catalog
  for (const r of [...registrations.values()]) if (r.sku === RACE_SKU && r.session_date === RACE_DATE) registrations.delete(r.id);
  resetLimits();
  const buyer = (n, qty) => goodReg({ sku: RACE_SKU, prerequisite: { required: true, attested: true }, session_date: RACE_DATE, qty, customer: { name: 'Racer ' + n, email: 'racer' + n + '@example.com', phone: '(713) 555-0100', organization: '' } });
  // The race exactly as it happens: buyer A's row is written BEFORE the Stripe call and stamped with a session id AFTER
  // it, so the whole round trip is a window in which A's row exists and — under round 1's rule — held nothing. Buyer B
  // arrives inside that window. Nothing about the Stripe call moves; the gate only holds it open long enough to look.
  let release; stripeGate = new Promise((r) => { release = r; });
  const aPending = from('/register', buyer(1, 8), '198.51.100.91');
  await new Promise((r) => setTimeout(r, 30));   // A has stored its row and is now waiting on Stripe
  const aRow = [...registrations.values()].find((r) => r.customer_email === 'racer1@example.com' && r.session_date === RACE_DATE);
  // Snapshotted here, not read later: the row is a live object and A stamps its session id the moment the gate opens.
  const midFlight = aRow && { status: aRow.status, sid: aRow.stripe_session_id || null, qty: aRow.qty };
  const b = await from('/register', buyer(2, 8), '198.51.100.92'); const bb2 = await b.clone().json();
  release(); stripeGate = null;
  const a = await aPending;
  ok('buyer A holds its 8 seats while it is still inside the Stripe call — row stored, session id not yet stamped', !!midFlight && midFlight.status === 'pending' && !midFlight.sid && midFlight.qty === 8, JSON.stringify(midFlight));
  ok('… and the session id is stamped only once Stripe answers', aRow.stripe_session_id === 'cs_test_123', String(aRow.stripe_session_id));
  ok('… so buyer B, arriving in that window, is refused: the round-trip-wide oversell race is closed', a.status === 200 && b.status === 409 && bb2.code === 'sold_out', 'A=' + a.status + ' B=' + b.status + ' ' + JSON.stringify(bb2).slice(0, 90));
  // and the other way: the same row, unstamped and three minutes old, is a request that failed and holds nothing
  const stale = [...registrations.values()].find((r) => r.customer_email === 'racer1@example.com' && r.session_date === RACE_DATE);
  stale.stripe_session_id = null; stale.created_at = new Date(Date.now() - 3 * 60000).toISOString();
  const c = await from('/register', buyer(3, 8), '198.51.100.93');
  ok('… while a row that never got its session id and has not moved in three minutes holds nothing at all', c.status === 200, String(c.status));
  for (const r of [...registrations.values()]) if (r.sku === RACE_SKU && r.session_date === RACE_DATE) registrations.delete(r.id);

  // The fake D1 answers these queries in JavaScript rather than executing their SQL, so the assertions above would still
  // pass if the Worker's predicate text lost a branch. The SQL itself is therefore read back out of the log: one
  // definition of "holding a seat", used by capacity AND by both hold caps, or the tests are checking the fake.
  const twoTier = (s) => /stripe_session_id IS NOT NULL AND created_at > \?/.test(s) && /stripe_session_id IS NULL AND created_at > \?/.test(s);
  const capacitySql = sqlLog.filter((s) => s.includes('SUM(qty)') && s.includes('FROM registrations'));
  const holdSql = sqlLog.filter((s) => s.includes('COUNT(*)') && s.includes('FROM registrations') && s.includes("status = 'pending'"));
  ok('the capacity query and both hold-cap queries carry the SAME two-tier predicate, in SQL', capacitySql.length > 0 && holdSql.length > 0 && capacitySql.every(twoTier) && holdSql.every(twoTier), 'capacity=' + capacitySql.length + ' holds=' + holdSql.length + ' bad=' + [...capacitySql, ...holdSql].filter((s) => !twoTier(s)).length);
  ok('… and the address cap is bound to the connection AND the address, never the address alone', holdSql.some((s) => /agreement_ip = \? AND customer_email = \?/.test(s)) && !holdSql.some((s) => /AND customer_email = \?/.test(s) && !/agreement_ip/.test(s)), holdSql.length + ' variants');

  // ── H2-9: the routes that were never limited ──
  resetLimits();
  const resets = [];
  for (let i = 0; i < 21; i++) resets.push((await from('/account/reset', { email: GHOST, code: '123456', password: 'a long enough password' }, '198.51.100.100')).status);
  ok('/account/reset is limited at last — 20 per window from one address, then 429', resets.slice(0, 20).every((s) => s === 400) && resets[20] === 429, resets[19] + ',' + resets[20]);
  ok('… in the shared code budget: forgot is refused once that window is spent', (await from('/account/forgot', { email: GHOST }, '198.51.100.100')).status === 429);
  resetLimits();
  const staff = [];
  for (let i = 0; i < 61; i++) staff.push((await getFrom(i % 2 ? '/roster' : '/admin/crm', '198.51.100.101')).status);
  ok('/roster and every /admin route share one 60-per-window budget, and it is enforced without a key', staff.slice(0, 60).every((s) => s === 401) && staff[60] === 429, staff[59] + ',' + staff[60]);
  ok('… and the /admin rule is a PREFIX, so a route added under it is limited the day it is added', ruleFor('GET', '/admin/anything-added-later').bucket === 'admin' && ruleFor('POST', '/admin/sync').limit === 60 && ruleFor('GET', '/admin').bucket === 'admin' && ruleFor('GET', '/health') === null);
  resetLimits();
  const subs = [];
  for (let i = 0; i < 11; i++) subs.push((await from('/subscribe', { email: 'sub' + i + '@example.com', consent: true }, '198.51.100.102')).status);
  ok('/subscribe is 10 per window from one address, then 429', subs.slice(0, 10).every((s) => s === 200) && subs[10] === 429, subs[9] + ',' + subs[10]);
  resetLimits();
  const paid = [];
  for (let i = 0; i < 10; i++) paid.push((await from('/create-booking', { sku: 'MAST-DA', customer_email: 'b@example.com' }, '198.51.100.103')).status);
  const eleventh = await from('/create-booking', { sku: 'MAST-DA', customer_email: 'b@example.com' }, '198.51.100.103');
  const membership = await from('/create-membership', { email: 'b@example.com', plan: 'range_member' }, '198.51.100.103');
  ok('/create-booking is 10 Stripe sessions per window from one address, then 429 — it was unlimited and it costs money', paid.every((s) => s === 200) && eleventh.status === 429 && (await eleventh.clone().json()).code === 'rate_limited', paid.join() + ' then ' + eleventh.status);
  ok('… and /create-membership shares that one budget rather than doubling it', membership.status === 429, String(membership.status));
  ok('… while /register shares it too', (await from('/register', goodReg({ customer: { name: 'Seat Spray', email: 'seatspray@example.com', phone: '(713) 555-0100', organization: '' } }), '198.51.100.103')).status === 429);

  // ── H2-11: X-Forwarded-For no longer lets a caller pick its own counter ──
  resetLimits();
  const spoof = [];
  for (let i = 0; i < 6; i++) spoof.push((await from('/account/register', { email: 'spoof' + i + '@example.com', password: 'a long enough password' }, '198.51.100.110', { 'X-Forwarded-For': '10.0.0.' + i })).status);
  ok('a rotating X-Forwarded-For cannot buy a fresh window: one CF-Connecting-IP is one counter', spoof[5] === 429, spoof.join());
  ok('… and a caller with no CF-Connecting-IP shares the one "unknown" bucket rather than a bucket of their own', await (async () => {
    resetLimits();
    const noCf = (xff) => worker.fetch(new Request('https://api.test/account/register', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://mastsolutions.com', 'X-Forwarded-For': xff }, body: JSON.stringify({ email: 'anon' + xff + '@example.com', password: 'a long enough password' }) }), env, ctx);
    const codes = [];
    for (let i = 0; i < 6; i++) codes.push((await noCf('10.1.1.' + i)).status);
    return codes[5] === 429 && rateLimits.has('signup:unknown') && clientIp(new Request('https://api.test/', { headers: { 'X-Forwarded-For': '10.9.9.9' } })) === 'unknown';
  })());

  // ── H2-10: a schema step that really failed must not be memoised as done ──
  _resetRateSchemaMemo();
  const seen = []; let breakOnce = true;
  // all() answers the pragma healPendingSignups reads (round 7): no rows = no pending_signups table = nothing to heal,
  // so this stub measures the statement loop and nothing else.
  const flaky = { DB: { prepare(sql) { return { async run() { seen.push(sql); if (breakOnce && /signup_notice_sent_at/.test(sql)) { breakOnce = false; throw new Error('D1_ERROR: database is locked'); } return { meta: { changes: 0 } }; }, async all() { return { results: [] }; } }; } } };
  const firstRun = await ensureRateSchema(flaky); const afterFirst = seen.length;
  const secondRun = await ensureRateSchema(flaky);
  ok('a failed schema step answers false and is NOT memoised: the next request retries every statement', firstRun === false && secondRun === true && afterFirst === RATE_SCHEMA.length && seen.length === RATE_SCHEMA.length * 2, JSON.stringify({ firstRun, secondRun, afterFirst, total: seen.length, steps: RATE_SCHEMA.length }));
  const thirdRun = await ensureRateSchema(flaky);
  ok('… and once every statement has succeeded it IS memoised: no third run', thirdRun === true && seen.length === RATE_SCHEMA.length * 2, String(seen.length));
  _resetRateSchemaMemo();
  const dup = []; const already = { DB: { prepare(sql) { return { async run() { dup.push(sql); throw new Error('duplicate column name: failed_logins'); }, async all() { return { results: [] }; } }; } } };
  ok('a duplicate-column error is the already-applied case, not a failure: it memoises', (await ensureRateSchema(already)) === true && (await ensureRateSchema(already)) === true && dup.length === RATE_SCHEMA.length, String(dup.length));
  _resetRateSchemaMemo();
  resetLimits(); emails.length = 0;
}

console.log('\n── Uniform code routes, immovable credentials, per-connection guesses and the atomic seat claim (security review round 3, 2026-09-08) ──');
{
  const from = (path, body, ip) => post(path, body, 'https://mastsolutions.com', ip);
  const noIp = async (path, body) => {
    const res = await worker.fetch(new Request('https://api.test' + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://mastsolutions.com' }, body: JSON.stringify(body),
    }), env, ctx);
    await drain();
    return res;
  };
  const rowFor = (email) => [...accounts.values()].find((a) => a.email === email);
  const codeIn = (m) => (/\b(\d{6})\b/.exec((m && m.text) || '') || [])[1];
  const same = async (a, b) => a.status === b.status && (await a.clone().text()) === (await b.clone().text());
  const GHOST3 = 'no-such-address-round-three@example.com';

  resetLimits(); emails.length = 0;
  await post('/account/register', { email: 'r3owner@example.com', password: 'a long enough password' });
  await post('/account/verify', { email: 'r3owner@example.com', code: codeIn(emails[0]), password: 'a long enough password' });
  ok('round-3 fixture: r3owner@example.com is a verified account', !!rowFor('r3owner@example.com').verified_at);

  /* ── H3-1: /account/forgot and /account/resend, measured rather than asserted ──
     Round 2 made the BODY uniform and left two ways to tell the paths apart. The Resend round trip was awaited inline
     only when the account existed (165 ms against 34 ms), and when Resend refused it the real address got 502 where the
     invented one got 200. Both are gone: one body, one statement count, and the mail leg in ctx.waitUntil().
     The measurement is deliberately raw() — the response is looked at BEFORE the background work is drained, because
     "the response did not wait for the mail" is the whole claim. */
  const PIN = '198.51.100.150';
  const measure = async (path, body) => {
    rowFor('r3owner@example.com').verify_sent_at = new Date(Date.now() - 120000).toISOString();
    emails.length = 0;
    const before = sqlLog.length;
    // The mail call is PARKED. A Worker that awaited it could not answer at all; this one answers, and the send lands
    // afterwards. Raced against a timer so a regression fails the assertion instead of hanging the suite.
    let release; resendGate = new Promise((r) => { release = r; });
    const pending = raw(path, body, 'https://mastsolutions.com', PIN);
    const respondedFirst = !!(await Promise.race([pending.then((r) => r), new Promise((r) => setTimeout(() => r(null), 50))]));
    const mailedBeforeResponse = emails.length;
    release(); resendGate = null;
    const res = await pending;
    await drain();
    return { res, statements: sqlLog.length - before, respondedFirst, mailedBeforeResponse, mailedAfter: emails.length };
  };
  for (const [route, kind] of [['/account/forgot', 'reset'], ['/account/resend', 'verify']]) {
    resetLimits();
    // resend is the unverified path, so it gets an unverified account to be real against; forgot serves both.
    const realAddr = route === '/account/forgot' ? 'r3owner@example.com' : 'r3unver@example.com';
    // The sign-up is made from the connection that will ask for the re-send: since round 7 that is what /account/resend
    // matches on, and there is no minute-long throttle left to step past.
    if (route === '/account/resend') await post('/account/register', { email: realAddr, password: 'a long enough password' }, 'https://mastsolutions.com', PIN);
    resetLimits();
    const real = await measure(route, { email: realAddr });
    const ghost = await measure(route, { email: GHOST3 });
    ok(route + ' answers a real address and an invented one identically, and spends the same statements', await same(real.res, ghost.res) && real.res.status === 200 && real.statements === ghost.statements, real.res.status + ' ' + (await real.res.clone().text()) + ' stmts ' + real.statements + ' vs ' + ghost.statements + ' (' + kind + ')');
    ok('… and the mail leaves through waitUntil: the response comes back while the send is still parked, and lands after it', real.respondedFirst === true && real.mailedBeforeResponse === 0 && real.mailedAfter === 1 && ghost.mailedAfter === 0, JSON.stringify({ respondedFirst: real.respondedFirst, before: real.mailedBeforeResponse, after: real.mailedAfter, ghost: ghost.mailedAfter }));
    resetLimits();
    resendStatus = 500;
    const failReal = await measure(route, { email: realAddr });
    const failGhost = await measure(route, { email: GHOST3 });
    resendStatus = 200;
    ok('… and a refusing mail provider changes neither answer: 200 both ways, never a 502 that names the real one', failReal.res.status === 200 && (await same(failReal.res, failGhost.res)), failReal.res.status + ' vs ' + failGhost.res.status);
  }

  // /account/reset's absent-account path spends the claim and the read-back a real one spends.
  resetLimits();
  const beforeReal = sqlLog.length;
  const resetReal = await from('/account/reset', { email: 'r3owner@example.com', code: '123456', password: 'a long enough password' }, PIN);
  const stReal = sqlLog.length - beforeReal;
  const beforeGhost = sqlLog.length;
  const resetGhost = await from('/account/reset', { email: GHOST3, code: '123456', password: 'a long enough password' }, PIN);
  const stGhost = sqlLog.length - beforeGhost;
  ok('/account/reset costs an invented address exactly what it costs a real one — same body, same statement count', (await same(resetReal, resetGhost)) && resetReal.status === 400 && stReal === stGhost, resetReal.status + ' ' + (await resetReal.clone().text()) + ' stmts ' + stReal + ' vs ' + stGhost);

  /* ── H3-2: /account/register never writes over an existing row's credentials ──
     Round 5 moves the ground under this one and keeps its point: there is no accounts row for a half-finished sign-up to
     overwrite, so the password a stranger types cannot sign in and cannot be read off /account/login either. */
  resetLimits(); emails.length = 0;
  await post('/account/register', { email: 'r3half@example.com', password: 'the owners half-done password' });
  const ATTACK_PW = 'the attackers chosen password';
  const overUnverified = await post('/account/register', { email: 'r3half@example.com', password: ATTACK_PW });
  const overNew = await post('/account/register', { email: 'r3brandnew@example.com', password: ATTACK_PW });
  const loginOver = await post('/account/login', { email: 'r3half@example.com', password: ATTACK_PW });
  const loginVerified = await post('/account/login', { email: 'r3owner@example.com', password: ATTACK_PW });
  ok("a stranger registering over an unverified address cannot make that password sign in: 401 bad_login, exactly what a verified address answers", loginOver.status === 401 && (await loginOver.clone().json()).code === 'bad_login' && (await same(loginOver, loginVerified)), loginOver.status + ' ' + (await loginOver.clone().text()) + '  vs  ' + loginVerified.status + ' ' + (await loginVerified.clone().text()));
  const shape3 = async (r, email) => (await r.clone().text()).split(email).join('<ADDRESS>');
  ok('… and the 202 envelope is byte-identical for the taken address and a brand-new one', overUnverified.status === 202 && overNew.status === 202 && (await shape3(overUnverified, 'r3half@example.com')) === (await shape3(overNew, 'r3brandnew@example.com')), overUnverified.status + ' ' + overNew.status);
  ok("… and neither password signs in, because there is no account yet: the half-finished sign-up answers exactly what an address with nothing answers", (await post('/account/login', { email: 'r3half@example.com', password: 'the owners half-done password' })).status === 401 && !rowFor('r3half@example.com') && !!(await pendingFor('r3half@example.com')), 'a half-finished sign-up must not be an accounts row');

  /* ── H3-3: five wrong codes from a stranger no longer burn what is in the owner's inbox ── */
  resetLimits(); emails.length = 0;
  await post('/account/register', { email: 'r3burn@example.com', password: 'a long enough password' });
  const burnCode3 = codeIn(emails[0]);
  const burnPend = await pendingFor('r3burn@example.com');
  const liveHash = burnPend.code_hash;
  const ATT_IP = '198.51.100.210';
  const strangerTries = [];
  for (let i = 0; i < 6; i++) strangerTries.push((await from('/account/verify', { email: 'r3burn@example.com', code: burnCode3 === '111111' ? '222222' : '111111', password: 'a long enough password' }, ATT_IP)).status);
  ok("five wrong codes from one connection refuse that connection and leave the code live — the stranger cannot reach into the owner's inbox", strangerTries.join() === '401,401,401,401,401,401' && burnPend.code_hash === liveHash && burnPend.verify_attempts === 5, strangerTries.join() + ' attempts=' + burnPend.verify_attempts);
  ok('… and the sixth cost the code nothing: it never reached the check, so the global count did not move either', burnPend.verify_attempts === 5);
  ok('… and the owner, on their own connection, signs in with the code that was in their inbox all along', (await from('/account/verify', { email: 'r3burn@example.com', code: burnCode3, password: 'a long enough password' }, '198.51.100.211')).status === 200);

  // the same shape on the reset path
  resetLimits(); emails.length = 0;
  rowFor('r3owner@example.com').verify_sent_at = new Date(Date.now() - 120000).toISOString();
  await post('/account/forgot', { email: 'r3owner@example.com' });
  const resetCode3 = codeIn(emails[0]);
  const resetHash = rowFor('r3owner@example.com').verify_code_hash;
  for (let i = 0; i < 5; i++) await from('/account/reset', { email: 'r3owner@example.com', code: resetCode3 === '111111' ? '222222' : '111111', password: 'a long enough password' }, ATT_IP);
  ok("the same cap guards /account/reset: a stranger's five wrong codes do not burn the owner's reset code", rowFor('r3owner@example.com').verify_code_hash === resetHash, 'hash still live=' + !!rowFor('r3owner@example.com').verify_code_hash);
  ok('… and the owner completes the reset with it', (await from('/account/reset', { email: 'r3owner@example.com', code: resetCode3, password: 'a fresh long password' }, '198.51.100.212')).status === 200);

  // twenty wrong tries in total DO burn it — and the owner is told, and is not left waiting a minute for a replacement
  resetLimits(); emails.length = 0;
  await post('/account/register', { email: 'r3global@example.com', password: 'a long enough password' });
  const globalCode = codeIn(emails[0]);
  const globalPend = await pendingFor('r3global@example.com');
  emails.length = 0;
  const wrongCodes = []; for (let n = 200000; wrongCodes.length < 20; n++) if (String(n) !== globalCode) wrongCodes.push(String(n));
  const globalStatuses = [];
  for (const w of wrongCodes) globalStatuses.push((await post('/account/verify', { email: 'r3global@example.com', code: w, password: 'a long enough password' })).status);
  const leftAfterBurn = await pendingsFor('r3global@example.com');
  ok('twenty wrong tries in total, from twenty connections, DO burn the code — six digits against twenty tries is a 0.002% chance', globalStatuses.every((s) => s === 401) && leftAfterBurn.length === 0, globalStatuses.length + ' tries, rows left=' + leftAfterBurn.length);
  ok('… and the owner is emailed exactly once that it happened, with no code in the notice', emails.length === 1 && emails[0].to[0] === 'r3global@example.com' && /invalidated/i.test(emails[0].subject) && !/\b\d{6}\b/.test(emails[0].text), emails.length + ' ' + (emails[0] && emails[0].subject));
  emails.length = 0;
  // THERE IS NOTHING LEFT TO EXEMPT THE OWNER FROM (round 7). Rounds 5 and 6 had to hand the owner a throttle exemption
  // after a burn — first by nulling code_sent_at, which handed the row to a stranger, then by a second column — because
  // one row per address meant the owner had to get THAT row back. A burn deletes the rows, a sign-up always mails, and
  // the owner's way on is the ordinary one: sign up again, no wait and no exemption.
  const replacement = await post('/account/register', { email: 'r3global@example.com', password: 'a long enough password' });
  ok('… and the owner is not left waiting for a replacement: their next sign-up mails a new code at once, with no exemption to grant and no row to reclaim',
     replacement.status === 202 && emails.length === 1 && (await pendingsFor('r3global@example.com')).length === 1,
     replacement.status + ' emails=' + emails.length);
  ok('… and the new code is the owner\'s own: it opens with the password THEY just signed up with',
     (await post('/account/verify', { email: 'r3global@example.com', code: codeIn(emails[0]), password: 'a long enough password' })).status === 200);

  /* ── H3-4: the seat claim is atomic, and it is the authority ── */
  const CLAIM_SKU = 'MAST-HG-FUND', CLAIM_DATE = '2027-01-09';   // capacity 16 in the fake catalog
  const clearClaim = () => { for (const r of [...registrations.values()]) if (r.sku === CLAIM_SKU && r.session_date === CLAIM_DATE) registrations.delete(r.id); };
  const claimBody = (n, qty) => goodReg({ sku: CLAIM_SKU, prerequisite: undefined, session_date: CLAIM_DATE, qty, customer: { name: 'Claim ' + n, email: 'claim' + n + '@example.com', phone: '(713) 555-0100', organization: '' } });
  resetLimits(); clearClaim();
  const fourAtOnce = await Promise.all([1, 2, 3, 4].map((n) => from('/register', claimBody(n, 10), '198.51.100.22' + n)));
  const fourStatuses = fourAtOnce.map((r) => r.status);
  const stillHeld = [...registrations.values()].filter((r) => r.sku === CLAIM_SKU && r.session_date === CLAIM_DATE && r.status === 'pending');
  const seatsHeld = stillHeld.reduce((n, r) => n + Number(r.qty || 0), 0);
  ok('four claims on the same tick at qty 10 against a 16-seat class: one is held, the rest are refused, and 10 seats are held on 16', fourStatuses.filter((s) => s === 200).length === 1 && fourStatuses.filter((s) => s === 409).length === 3 && seatsHeld === 10, fourStatuses.join() + ' seats=' + seatsHeld);
  ok('… and every refusal carries the sold-out body with a seat count', await (async () => (await Promise.all(fourAtOnce.filter((r) => r.status === 409).map(async (r) => (await r.clone().json()).code === 'sold_out' && typeof (await r.clone().json()).seats_left === 'number'))).every(Boolean))());

  // The window the race actually lives in, reproduced exactly: this request PASSES the capacity check and is overtaken
  // before its INSERT. Round 2 sold it a seat and a Stripe URL; the batch rolls it back inside one transaction.
  resetLimits(); clearClaim();
  stripeCalls.length = 0;
  onEligibilityInsert = () => registrations.set('reg_rival', { id: 'reg_rival', created_at: new Date().toISOString(), status: 'paid', sku: CLAIM_SKU, session_date: CLAIM_DATE, qty: 16, customer_email: 'rival@example.com' });
  const overtaken = await from('/register', claimBody(9, 1), '198.51.100.229');
  const overtakenBody = await overtaken.clone().json();
  const rolled = [...registrations.values()].find((r) => r.customer_email === 'claim9@example.com' && r.session_date === CLAIM_DATE);
  ok('a booking overtaken between the capacity check and its INSERT is rolled back inside the batch, not sold: 409 sold_out and no Stripe call', overtaken.status === 409 && overtakenBody.code === 'sold_out' && stripeCalls.length === 0, overtaken.status + ' ' + JSON.stringify(overtakenBody).slice(0, 90) + ' stripe=' + stripeCalls.length);
  ok('… and the row it wrote is marked abandoned with abandoned_reason capacity, so it holds nothing and is readable in the roster', !!rolled && rolled.status === 'abandoned' && rolled.abandoned_reason === 'capacity' && !rolled.stripe_session_id, JSON.stringify(rolled && { s: rolled.status, why: rolled.abandoned_reason }));
  const claimSql = sqlLog.filter((q) => q.startsWith("UPDATE registrations SET status = 'abandoned'") && q.includes('SELECT COALESCE(SUM(qty)'));
  ok('… and the roll-back carries the SAME two-tier holding predicate the capacity read uses, in SQL', claimSql.length > 0 && claimSql.every((q) => /stripe_session_id IS NOT NULL AND created_at > \?/.test(q) && /stripe_session_id IS NULL AND created_at > \?/.test(q)), claimSql.length + ' statements');
  clearClaim(); registrations.delete('reg_rival'); onEligibilityInsert = null;

  /* ── H3-7: a request with no CF-Connecting-IP is inside the caps, in the shared 'unknown' bucket ── */
  const HOLD3 = 'MAST-HG-FUND', DATE3 = '2027-01-23';
  resetLimits();
  for (const r of [...registrations.values()]) if (r.sku === HOLD3 && r.session_date === DATE3) registrations.delete(r.id);
  const anonBody = (n) => goodReg({ sku: HOLD3, prerequisite: undefined, session_date: DATE3, qty: 1, customer: { name: 'Anon ' + n, email: 'anon' + n + '@example.com', phone: '(713) 555-0100', organization: '' } });
  const anon1 = await noIp('/register', anonBody(1));
  const anon2 = await noIp('/register', anonBody(2));
  const anon3 = await noIp('/register', anonBody(3));
  ok('a caller with no CF-Connecting-IP is inside the two-holds cap like everybody else — it used to be outside both, because an empty address counted nothing', anon1.status === 200 && anon2.status === 200 && anon3.status === 429 && (await anon3.clone().json()).code === 'too_many_holds', [anon1.status, anon2.status, anon3.status].join());
  ok('… and the rows it wrote carry the literal unknown as their agreement_ip, which is what the cap counts', [...registrations.values()].filter((r) => r.sku === HOLD3 && r.session_date === DATE3).every((r) => r.agreement_ip === 'unknown'), [...new Set([...registrations.values()].filter((r) => r.sku === HOLD3 && r.session_date === DATE3).map((r) => JSON.stringify(r.agreement_ip)))].join());
  for (const r of [...registrations.values()]) if (r.sku === HOLD3 && r.session_date === DATE3) registrations.delete(r.id);

  resetLimits(); emails.length = 0;
  await post('/account/register', { email: 'r3anon@example.com', password: 'a long enough password' });
  const anonCode = codeIn(emails[0]);
  const anonPend = await pendingFor('r3anon@example.com');
  const anonHash = anonPend.verify_code_hash;
  for (let i = 0; i < 6; i++) await noIp('/account/verify', { email: 'r3anon@example.com', code: anonCode === '111111' ? '222222' : '111111', password: 'a long enough password' });
  ok('… and the code-guess counter uses the same bucket: five wrong codes with no address refuse that bucket and leave the code live', anonPend.verify_attempts === 5 && anonPend.verify_code_hash === anonHash && [...rateLimits.keys()].some((k) => k.startsWith('codeguess:unknown:')), 'attempts=' + anonPend.verify_attempts + ' keys=' + [...rateLimits.keys()].filter((k) => k.startsWith('codeguess:')).length);

  resetLimits(); emails.length = 0;
}

console.log('\n── Round 4: ghost counters per address, sign-in cost symmetry, a burn a reissue cannot defer, a per-address mail budget (security review round 4, 2026-09-08) ──');
{
  const from = (path, body, ip) => post(path, body, 'https://mastsolutions.com', ip);
  const rowFor = (email) => [...accounts.values()].find((a) => a.email === email);
  const codeIn = (m) => (/\b(\d{6})\b/.exec((m && m.text) || '') || [])[1];
  const same = async (a, b) => a.status === b.status && (await a.clone().text()) === (await b.clone().text());
  /** One request, and the number of D1 statements it spent. The criterion the round-3 parity claim is written in. */
  const cost = async (path, body, ip) => {
    const before = sqlLog.length;
    const res = await from(path, body, ip);
    return { res, statements: sqlLog.length - before };
  };
  const guessKeys = () => [...rateLimits.keys()].filter((k) => k.startsWith('codeguess:'));

  resetLimits(); emails.length = 0;
  await post('/account/register', { email: 'r4real@example.com', password: 'a long enough password' });
  await post('/account/verify', { email: 'r4real@example.com', code: codeIn(emails[0]), password: 'a long enough password' });
  ok('round-4 fixture: r4real@example.com is a verified account', !!rowFor('r4real@example.com').verified_at);

  /* ── R4-1: the guess cap for an address with NO account is keyed on that address ──
     Round 3 keyed it on the constant absent id, so every invented address on the internet shared one row. Five wrong
     guesses at one throwaway address armed it, and from the sixth request on the refusal fired BEFORE the twin
     statements ran: an invented address cost 5 statements where a real one cost 9, with the same 400 and the same body.
     Disjoint cost ranges are an account-existence oracle. This measures the state the round-3 assertion never entered —
     the counter ALREADY at five. */
  resetLimits(); emails.length = 0;
  const R4IP = '198.51.100.60';
  const ARM = 'r4-arming-ghost@example.com';
  for (let i = 0; i < 5; i++) await from('/account/reset', { email: ARM, code: '111111', password: 'a long enough password' }, R4IP);
  const armKey = guessKeys().find((k) => k.startsWith('codeguess:' + R4IP + ':absent:'));
  ok('five wrong codes at an invented address arm a counter of its OWN — codeguess:<ip>:absent:<digest>, not one shared row',
     !!armKey && /^codeguess:198\.51\.100\.60:absent:[0-9a-f]{16}$/.test(armKey) && rateLimits.get(armKey).count === 5,
     guessKeys().join(' '));

  const armed = await cost('/account/reset', { email: ARM, code: '111111', password: 'a long enough password' }, R4IP);
  const realAfterArm = await cost('/account/reset', { email: 'r4real@example.com', code: '111111', password: 'a long enough password' }, R4IP);
  const ghostAfterArm = await cost('/account/reset', { email: 'r4-second-ghost@example.com', code: '111111', password: 'a long enough password' }, R4IP);
  ok('with the arming address at its cap, a real address and a DIFFERENT invented one still cost the same — same body, same statement count',
     (await same(realAfterArm.res, ghostAfterArm.res)) && realAfterArm.res.status === 400 && realAfterArm.statements === ghostAfterArm.statements,
     realAfterArm.res.status + ' ' + (await realAfterArm.res.clone().text()) + ' stmts ' + realAfterArm.statements + ' vs ' + ghostAfterArm.statements);
  ok('… and the arming address is the only one refused: its own sixth guess is the cheap one, and it is cheaper than both of theirs',
     armed.statements < realAfterArm.statements && armed.res.status === 400 && (await same(armed.res, realAfterArm.res)),
     'armed ' + armed.statements + ' vs real ' + realAfterArm.statements + ' vs ghost ' + ghostAfterArm.statements);

  // The shape the probe used: eight unknown addresses from one connection, one request each. Round 3 answered
  // 9,9,9,9,9,5,5,5 — every address after the fifth was free to classify. Every one of them costs the same now.
  const spray = [];
  for (let i = 0; i < 8; i++) spray.push((await cost('/account/reset', { email: 'r4-spray-' + i + '@example.com', code: '111111', password: 'a long enough password' }, R4IP)).statements);
  const realSpray = (await cost('/account/reset', { email: 'r4real@example.com', code: '111111', password: 'a long enough password' }, R4IP)).statements;
  ok('eight unknown addresses probed from one connection all cost what a real address costs — no address is free to test',
     spray.every((n) => n === spray[0]) && spray[0] === realSpray, spray.join() + ' vs real ' + realSpray);
  ok('… and rotating invented addresses cannot spend the real account’s budget: its counter holds only its own guesses',
     rateLimits.get('codeguess:' + R4IP + ':' + rowFor('r4real@example.com').id).count === 2,
     JSON.stringify(guessKeys().map((k) => k + '=' + rateLimits.get(k).count)));

  /* ── R4-2: a wrong password costs the same whether or not the address has an account ──
     noteFailedLogin ran only `if (acct)` — an UPDATE and a read-back a ghost never spent, plus the lock write on every
     fifth try. The 100k-iteration PBKDF2 both branches run buried it in wall clock, which is why it is measured in
     statements. */
  resetLimits(); emails.length = 0;
  await post('/account/register', { email: 'r4login@example.com', password: 'a long enough password' });
  await post('/account/verify', { email: 'r4login@example.com', code: codeIn(emails[0]), password: 'a long enough password' });
  resetLimits();
  const realCosts = [], ghostCosts = [];
  for (let i = 0; i < 5; i++) realCosts.push((await cost('/account/login', { email: 'r4login@example.com', password: 'wrong password ' + i }, '198.51.100.61')).statements);
  for (let i = 0; i < 5; i++) ghostCosts.push((await cost('/account/login', { email: 'r4-no-such-account@example.com', password: 'wrong password ' + i }, '198.51.100.62')).statements);
  ok('five wrong passwords cost an invented address exactly what they cost a real one, try by try',
     realCosts.join() === ghostCosts.join(), 'real ' + realCosts.join() + ' vs invented ' + ghostCosts.join());
  ok('… and the fifth try costs more than the fourth on BOTH paths: the lock write is what the twin had to spend too',
     realCosts[4] > realCosts[3] && ghostCosts[4] === realCosts[4], 'real ' + realCosts.join() + ' invented ' + ghostCosts.join());

  /* ── R4-3: the twenty-try burn fires even when the attacker interleaves a reissue, THROUGH EVERY ROUTE THAT REISSUES ──
     issueCode zeroed verify_attempts AND dropped every connection's guess counter, and /account/register,
     /account/forgot and /account/resend all reach it UNAUTHENTICATED. One reissue between every five guesses therefore
     bought an endless run of five-guess batches and deferred the global burn for ever: the probe ran 25 wrong codes
     across five connections with a sign-up between each batch, and the code was still live with no notice sent.

     ALL THREE ROUTES, not just the one that was safe (round 6, 2026-09-09). This test drove the reissue through
     /account/resend only — the one of the three named routes that never touched the counter — while the statement
     /account/register wrote (PENDING_UPSERT, a name round 7 retired) bound verify_attempts to a literal 0 and reset it
     on every sign-up. The
     round-4 primitive was therefore alive on the round-5 pending path and this test could not see it: swapping the one
     line to /account/register left the code live at 20 tries with no notice sent. Each route gets its own address, its
     own connections and its own window, and each must end with the code burned and the owner emailed exactly once.

     NOTHING HAS TO BE STEPPED PAST ANY MORE (round 7): /account/register always mails (into a NEW row), /account/resend
     re-mails the sign-up the asking connection made, and /account/forgot serves accounts only — for an address that has
     just a pending sign-up it mails nothing at all, which is itself the assertion. The primitive is therefore tested at
     full strength rather than through a gate: the reissues really do land, and the burn still arrives on try 20 because
     the count the burn reads is MAX(verify_attempts) across the live rows and a new row starts below it. */
  const { pendingGuessId } = await import('./src/ratelimit.js');
  for (const [route, addr, mark] of [['/account/resend', 'r4burn@example.com', 'r4'], ['/account/register', 'r6burn-register@example.com', 'r6a'], ['/account/forgot', 'r6burn-forgot@example.com', 'r6b']]) {
    resetLimits(); emails.length = 0;
    // ONE connection makes the sign-up and every interleaved reissue, so /account/resend really does re-mail (round 7)
    // rather than being served the nothing a stranger is served — the primitive has to be able to fire to be refuted.
    const REISSUE_IP = '198.51.100.' + mark.length + '95';
    await post('/account/register', { email: addr, password: 'a long enough password' }, 'https://mastsolutions.com', REISSUE_IP);
    const burnCounter = await pendingGuessId(addr);
    // Every reissue mails a NEW code, so the wrong guess is chosen against the live one each time — a fixed string would
    // eventually BE the code and pass.
    let liveCode = codeIn(emails[0]);
    const wrongNow = () => (liveCode === '111111' ? '222222' : '111111');
    const notices = () => emails.filter((m) => /invalidated/i.test(m.subject));
    emails.length = 0;
    const burnIps = [1, 2, 3, 4].map((n) => '198.51.100.' + mark.length + n + '0');
    const burnStatuses = [];
    let sixthAfterReissue = null;
    for (let b = 0; b < burnIps.length; b++) {
      for (let i = 0; i < 5; i++) burnStatuses.push((await from('/account/verify', { email: addr, code: wrongNow(), password: 'a long enough password' }, burnIps[b])).status);
      if (b < burnIps.length - 1) {
        // the interleaved UNAUTHENTICATED reissue — the whole primitive
        await from(route, { email: addr, password: 'the reissuing password' }, REISSUE_IP);
        const fresh = [...emails].reverse().find((m) => /verification code/i.test(m.subject));
        liveCode = codeIn(fresh) || liveCode;
        if (b === 0) sixthAfterReissue = rateLimits.get('codeguess:' + burnIps[0] + ':' + burnCounter);
      }
    }
    const rowsLeft = await pendingsFor(addr);
    ok('a reissue through ' + route + ' does not hand a refused connection a fresh budget: its counter still stands at five afterwards',
       !!sixthAfterReissue && sixthAfterReissue.count === 5, JSON.stringify(sixthAfterReissue));
    ok('twenty wrong codes with an unauthenticated reissue through ' + route + ' between every five STILL burn the code by try 20 — the global count is no longer resettable by a stranger',
       burnStatuses.length === 20 && burnStatuses.every((st) => st === 401) && rowsLeft.length === 0,
       burnStatuses.length + ' tries, rows left=' + rowsLeft.length);
    ok('… and the owner is emailed once that it happened, which is the notice the reissue used to suppress entirely (' + route + ')',
       notices().length === 1 && notices()[0].to[0] === addr,
       emails.map((m) => m.subject).join(' | '));
  }
  resetLimits(); emails.length = 0;

  /* ── R4-4 and R4-5 are superseded by round 5 and are measured in its own block below ──
     R4-4's per-ADDRESS mail budget was a counter a stranger shared with the owner, and R4-5's 6/5/5 register split was
     the statement-count half of the register→login oracle. Both are re-measured under their round-5 shapes rather than
     asserted twice in two shapes. */

  resetLimits(); emails.length = 0;
}

console.log('\n── Round 5: no account until a code comes back, budgets a stranger cannot spend, register under the mail rules (security review round 5, 2026-09-09) ──');
{
  const from = (path, body, ip) => post(path, body, 'https://mastsolutions.com', ip);
  const rowFor = (email) => [...accounts.values()].find((a) => a.email === email);
  const codeIn = (m) => (/\b(\d{6})\b/.exec((m && m.text) || '') || [])[1];
  const same = async (a, b) => a.status === b.status && (await a.clone().text()) === (await b.clone().text());
  const cost = async (path, body, ip) => {
    const before = sqlLog.length;
    const res = await from(path, body, ip);
    return { res, statements: sqlLog.length - before };
  };
  /* The per-IP ROUTE windows, cleared without touching the mail budgets — which live in the same table and are the
     thing under test. resetLimits() would wipe both and prove nothing. */
  const clearRouteWindows = () => { for (const k of [...rateLimits.keys()]) if (/^(login|signup|code|verify|seat|contact|subscribe|admin|event):/.test(k)) rateLimits.delete(k); };
  const mailKeys = () => [...rateLimits.keys()].filter((k) => k.startsWith('codemail'));

  /* ── R5-1: the register→login existence oracle, in status AND in statement count ──
     An address that had started a sign-up owned an accounts row, so /account/login answered 403 'unverified' where an
     address with nothing answered 401 — one request, no password needed, any address classified. Round 4 measured it
     and named pending_signups as the fix; this is that fix, measured. */
  resetLimits(); emails.length = 0;
  await post('/account/register', { email: 'r5started@example.com', password: 'a long enough password' });
  ok('a sign-up in progress is a pending row and NOT an accounts row', !rowFor('r5started@example.com') && !!(await pendingFor('r5started@example.com')));
  resetLimits();
  const startedLogin = await cost('/account/login', { email: 'r5started@example.com', password: 'a long enough password' }, '198.51.100.120');
  const nothingLogin = await cost('/account/login', { email: 'r5-never-heard-of@example.com', password: 'a long enough password' }, '198.51.100.121');
  ok('sign-in for an address mid-sign-up answers an address with nothing byte for byte, on the same statements — the 403 unverified oracle is gone',
     (await same(startedLogin.res, nothingLogin.res)) && startedLogin.res.status === 401 && (await startedLogin.res.clone().json()).code === 'bad_login' && startedLogin.statements === nothingLogin.statements,
     startedLogin.res.status + ' ' + (await startedLogin.res.clone().text()) + ' stmts ' + startedLogin.statements + ' vs ' + nothingLogin.statements);
  /* The two source-level guards this round rests on. Both are checked in the SOURCE, not only through a request, for the
     reason the seat block reads its predicate out of sqlLog: the behaviour above is closed by the ABSENCE of an accounts
     row, so putting the 403 back — or putting the INSERT back — passes every request-level assertion in this file until
     the day something else writes one. This is the invariant, stated where it cannot rot. */
  const workerSrc = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'src', 'worker.js'), 'utf8');
  const registerBody = workerSrc.slice(workerSrc.indexOf('async function handleAccountRegister'), workerSrc.indexOf('/** The one answer POST /account/register ever gives'));
  ok('POST /account/register contains no INSERT INTO accounts — a sign-up cannot create an account, in the source and not only in this run',
     registerBody.length > 500 && !/INSERT (OR \w+ )?INTO accounts/.test(registerBody) && /PENDING_INSERT/.test(registerBody),
     'register body ' + registerBody.length + ' chars');
  ok("… and no answer /account/login can give is a 403 or carries the code 'unverified': the oracle has no line left to come back on",
     !/code: 'unverified'/.test(workerSrc) && !/403, cors/.test(workerSrc.slice(workerSrc.indexOf('async function handleAccountLogin'), workerSrc.indexOf('async function handleAccountForgot'))) && !(await startedLogin.res.clone().text()).includes('unverified'),
     'unverified answer in source: ' + /code: .unverified./.test(workerSrc));

  /* ── R5-3: /account/register costs the same whichever of the three states the address is in ──
     Round 4 printed 6 / 5 / 5 for brand-new / already-signing-up / has-an-account: two reads, one budget and exactly one
     write on every branch now, so the INSERT that used to be the tell is one of three statements that always run. */
  resetLimits(); emails.length = 0;
  await post('/account/register', { email: 'r5taken-pending@example.com', password: 'a long enough password' });
  await post('/account/register', { email: 'r5has-account@example.com', password: 'a long enough password' });
  await post('/account/verify', { email: 'r5has-account@example.com', code: codeIn(emails[emails.length - 1]), password: 'a long enough password' });
  const regBranch = async (email) => {
    const acc = rowFor(email); if (acc) acc.signup_notice_sent_at = null;
    const pend = await pendingFor(email); if (pend) pend.code_sent_at = new Date(Date.now() - 120000).toISOString();
    resetLimits();
    return await cost('/account/register', { email, password: 'a long enough password' }, '198.51.100.122');
  };
  const regNew = await regBranch('r5brand-new@example.com');
  const regPending = await regBranch('r5taken-pending@example.com');
  const regAccount = await regBranch('r5has-account@example.com');
  console.log('  (register branch cost — brand-new ' + regNew.statements + ', already-signing-up ' + regPending.statements + ', has-an-account ' + regAccount.statements + ' statements)');
  ok('POST /account/register costs the SAME statements for a brand-new address, one mid-sign-up and one with an account — round 4 measured 6 / 5 / 5',
     regNew.statements === regPending.statements && regPending.statements === regAccount.statements && regNew.res.status === 202,
     [regNew.statements, regPending.statements, regAccount.statements].join());

  /* ── R5-2: three strangers cannot close the owner's recovery ──
     Round 4 keyed the code-mail budget on the ADDRESS: three unauthenticated /account/forgot from any three connections
     spent it, and the owner's own reset then answered 200 with no mail for the rest of the hour — the escape hatch the
     README named as what keeps a sign-in lock survivable, held shut for the price of three requests. */
  resetLimits(); emails.length = 0;
  await post('/account/register', { email: 'r5owner@example.com', password: 'the owners real password' });
  await post('/account/verify', { email: 'r5owner@example.com', code: codeIn(emails[emails.length - 1]), password: 'the owners real password' });
  resetLimits(); emails.length = 0;
  const rewind = () => { rowFor('r5owner@example.com').verify_sent_at = new Date(Date.now() - 120000).toISOString(); };
  const strangerStatuses = [];
  for (let i = 0; i < 3; i++) { rewind(); strangerStatuses.push((await cost('/account/forgot', { email: 'r5owner@example.com' }, '198.51.100.13' + i)).res.status); }
  const strangerMails = emails.length;
  // Five wrong passwords from a fourth stranger connection, so the account is locked as well — the full round-4 chain.
  for (let i = 0; i < 5; i++) await from('/account/login', { email: 'r5owner@example.com', password: 'wrong password ' + i }, '198.51.100.139');
  const lockedNow = await from('/account/login', { email: 'r5owner@example.com', password: 'the owners real password' }, '198.51.100.139');
  emails.length = 0; rewind();
  const ownerForgot = await cost('/account/forgot', { email: 'r5owner@example.com' }, '198.51.100.140');
  const ownerCode = codeIn(emails[0]);
  ok('three strangers spending their own budgets do NOT close the owner\'s recovery: their three requests mailed, and the owner\'s own request still mails a reset code',
     strangerStatuses.join() === '200,200,200' && strangerMails === 3 && ownerForgot.res.status === 200 && emails.length === 1 && !!ownerCode && /Reset your MAST Solutions password/.test(emails[0].subject),
     'stranger mails=' + strangerMails + ' owner mails=' + emails.length + ' ' + (emails[0] && emails[0].subject));
  const reclaimed = await from('/account/reset', { email: 'r5owner@example.com', code: ownerCode, password: 'a brand new owner password' }, '198.51.100.140');
  ok('… so the documented escape hatch out of a sign-in lock actually works: locked out on the guessed connection (a plain 401 on the right password, round 6), back in through the mailbox',
     lockedNow.status === 401 && reclaimed.status === 200 && (await from('/account/login', { email: 'r5owner@example.com', password: 'a brand new owner password' }, '198.51.100.141')).status === 200,
     'locked=' + lockedNow.status + ' reset=' + reclaimed.status);
  ok('… and the budgets that replaced it are keyed on the connection AND a digest, never on the address alone',
     mailKeys().length > 0 && mailKeys().every((k) => /^codemail:[^:]+:[0-9a-f]{16}$/.test(k) || /^codemailtotal:[^:]+$/.test(k)) && mailKeys().some((k) => k.startsWith('codemailtotal:')),
     mailKeys().slice(0, 4).join(' '));

  /* ── R5-2: the budget still bites, on the connection that spends it ── */
  resetLimits(); emails.length = 0;
  const ONE_IP = '198.51.100.150';
  const ownMail = [], ownCost = [];
  for (let i = 0; i < 4; i++) { rewind(); const c = await cost('/account/forgot', { email: 'r5owner@example.com' }, ONE_IP); ownMail.push(c.res.status); ownCost.push(c.statements); }
  ok('four /account/forgot from ONE connection mail one address three times, not four — the connection spends its own three an hour',
     emails.filter((m) => m.to[0] === 'r5owner@example.com').length === 3 && ownMail.join() === '200,200,200,200' && ownCost.every((n) => n === ownCost[0]),
     emails.length + ' mails, statuses ' + ownMail.join() + ' stmts ' + ownCost.join());
  const ghostMail = await cost('/account/forgot', { email: 'r5-mail-ghost@example.com' }, ONE_IP);
  ok('… and an invented address costs exactly what the over-budget real one costs — being refused a mail is not visible',
     ghostMail.res.status === 200 && ghostMail.statements === ownCost[3], 'ghost ' + ghostMail.statements + ' vs over-budget real ' + ownCost[3]);

  /* ── R5-3: /account/register mails under the same budgets, measured ──
     Round 4 wired the budget to /account/forgot and /account/resend and left the third unauthenticated mailer out, so
     the ~1,440-a-day-at-any-mailbox ceiling it was written to lower was unmoved: twelve connections delivered twelve. */
  resetLimits(); emails.length = 0;
  const REG_IP = '198.51.100.160';
  const regMailStatuses = [], regMailCosts = [];
  for (let i = 0; i < 4; i++) {
    // Past the CODE's own fifteen minutes, not merely past the one-a-minute throttle: since round 6 that is what makes a
    // second sign-up at the same address mail again, and this test is about the budget, not the gate.
    const pend = await pendingFor('r5regmail@example.com'); if (pend) pend.code_sent_at = new Date(Date.now() - 16 * 60000).toISOString();
    clearRouteWindows();
    const c = await cost('/account/register', { email: 'r5regmail@example.com', password: 'a long enough password' }, REG_IP);
    regMailStatuses.push(c.res.status); regMailCosts.push(c.statements);
  }
  ok('four /account/register from one connection mail one address THREE times, not four — the same budget forgot and resend spend',
     emails.filter((m) => m.to[0] === 'r5regmail@example.com').length === 3 && regMailStatuses.join() === '202,202,202,202' && regMailCosts.every((n) => n === regMailCosts[0]),
     emails.length + ' mails, statuses ' + regMailStatuses.join() + ' stmts ' + regMailCosts.join());
  ok('… and the sign-up notice to an address that already has an account is under it too', await (async () => {
    resetLimits(); emails.length = 0;
    const NOTICE_IP = '198.51.100.161';
    for (let i = 0; i < 4; i++) { rowFor('r5has-account@example.com').signup_notice_sent_at = null; clearRouteWindows(); await from('/account/register', { email: 'r5has-account@example.com', password: 'a stranger password' }, NOTICE_IP); }
    return emails.filter((m) => /Someone tried to create/.test(m.subject)).length === 3;
  })(), 'the notice mail is a mail like any other');

  /* ── R5-2: the per-connection total, across every address one host can invent ── */
  resetLimits(); emails.length = 0;
  const SPRAY_IP = '198.51.100.170';
  for (let i = 0; i < 31; i++) { clearRouteWindows(); await from('/account/register', { email: 'r5spray-' + i + '@example.com', password: 'a long enough password' }, SPRAY_IP); }
  ok('one connection gets thirty code mails an hour across every address it can invent, then nothing — the ceiling an attacker pays for in connections',
     emails.length === 30 && rateLimits.get('codemailtotal:' + SPRAY_IP).count === 30,
     emails.length + ' mails, total counter=' + JSON.stringify(rateLimits.get('codemailtotal:' + SPRAY_IP)));

  /* ── R5-2 / the round-4 P3: rate_limits must not be a list of the addresses strangers have typed ── */
  ok('… including loginfail, which carried the address in clear from round 2 until now', await (async () => {
    resetLimits();
    await from('/account/login', { email: 'r5-plaintext-probe@example.com', password: 'wrong password here' }, '198.51.100.180');
    const keys = [...rateLimits.keys()].filter((k) => k.startsWith('loginfail:'));
    return keys.length === 1 && /^loginfail:198\.51\.100\.180:[0-9a-f]{16}$/.test(keys[0]);
  })(), [...rateLimits.keys()].filter((k) => k.startsWith('loginfail:')).join(' '));
  /* rateKeysEver, NOT rateLimits.keys() (round 6): this used to read the map at one instant — here, right after a
     resetLimits() and a 31-request register spray, so it held codemail keys and nothing else. Putting the plaintext
     address back into the loginfail key left it PASSING; only the loginfail-shaped regex above failed. The sweep runs
     below that probe now, and over every key the fake table has been asked about since the first request of this file. */
  ok('no key rate_limits has been asked about carries a plaintext address — the mail budgets, the guess counters and the sign-in failure counter alike',
     [...rateKeysEver].every((k) => !k.includes('@')) && ['loginfail:', 'codeguess:', 'codemail:', 'codemailtotal:'].every((fam) => [...rateKeysEver].some((k) => k.startsWith(fam))),
     [...rateKeysEver].filter((k) => k.includes('@')).slice(0, 3).join(' ') || (rateKeysEver.size + ' keys, none'));

  /* ── R5-1: pending_signups holds no plaintext address either ── */
  ok('a pending sign-up is keyed on a digest and stores no address: the table is not a list of half-finished sign-ups by name',
     pendingSignups.size > 0 && [...pendingSignups.values()].every((r) => /^[0-9a-f]{64}$/.test(r.address_digest) || r.address_digest === 'absent') && !JSON.stringify([...pendingSignups.values()]).includes('@'),
     [...pendingSignups.keys()].slice(0, 2).join(' '));

  /* ── R5-6: the migration the deploy workflow must apply, and the guard that makes it apply it ──
     Re-pointed at 012 (round 7). 010 and 011 are still in the tree and are still the history of this table; what they
     no longer have is a GUARDS row, because 012 DROPs and recreates pending_signups on a different primary key and
     their columns are half-present by construction the moment it has run — which this guard reads as HALF APPLIED and
     stops every deploy on. The assertion that they carry no row is therefore load-bearing, not tidiness. */
  {
    const mig = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations', '012-pending-signup-per-row.sql'), 'utf8');
    const wf = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.github', 'workflows', 'deploy-worker.yml'), 'utf8');
    const guard = /migrations\/012-pending-signup-per-row\.sql\|pending_signups\|([a-z_,]+)/.exec(wf);
    const cols = guard ? guard[1].split(',') : [];
    ok('migrations/012 recreates pending_signups per sign-up and moves no verified account out of the way',
       /DROP TABLE IF EXISTS pending_signups/.test(mig) && /signup_id\s+TEXT PRIMARY KEY/.test(mig) && /DELETE FROM accounts\s+WHERE verified_at IS NULL/.test(mig) && !/DELETE FROM accounts\s+WHERE verified_at IS NOT NULL/.test(mig),
       'drop=' + /DROP TABLE IF EXISTS pending_signups/.test(mig));
    ok('… and deploy-worker.yml guards it on the columns UNIQUE to the new shape, so an old table reads apply and a new one reads already-applied — never HALF APPLIED',
       !!guard && cols.join() === 'signup_id,code_hash' && cols.every((c) => new RegExp('\\b' + c + '\\b').test(mig)) && !/verify_code_hash|code_sent_at/.test(cols.join()),
       cols.join());
    ok('… and 010 and 011 carry no GUARDS row any more: once 012 has run their column lists are half-present, which would stop every deploy for ever',
       !/migrations\/010-pending-signups\.sql\|/.test(wf) && !/migrations\/011-pending-burn-stamp\.sql\|/.test(wf),
       'rows for 010/011 in the workflow: ' + String(/migrations\/01[01][^|]*\|/.test(wf)));
    const { RATE_SCHEMA } = await import('./src/ratelimit.js');
    ok('… and the Worker self-heals the same table, so a deploy that lands ahead of the migration still takes sign-ups',
       RATE_SCHEMA.some((st) => /CREATE TABLE IF NOT EXISTS pending_signups/.test(st)) && cols.every((c) => RATE_SCHEMA.some((st) => st.includes('pending_signups') && st.includes(c))),
       String(RATE_SCHEMA.filter((st) => st.includes('pending_signups')).length));
  }

  resetLimits(); emails.length = 0;
}

console.log('\n── Round 7: one pending row per SIGN-UP, verification takes email + code + password, resend renews nothing (security review round 7, 2026-09-09) ──');
{
  const from = (path, body, ip) => post(path, body, 'https://mastsolutions.com', ip);
  const rowFor = (email) => [...accounts.values()].find((a) => a.email === email);
  const codeIn = (m) => (/\b(\d{6})\b/.exec((m && m.text) || '') || [])[1];
  const lastCode = () => codeIn([...emails].reverse().find((m) => /verification code/i.test(m.subject)));
  const notices = (to) => emails.filter((m) => /invalidated/i.test(m.subject) && m.to[0] === to);
  const cost = async (path, body, ip) => {
    const before = sqlLog.length, t0 = performance.now();
    const res = await from(path, body, ip);
    return { res, statements: sqlLog.length - before, ms: performance.now() - t0 };
  };
  const clearRouteWindows = () => { for (const k of [...rateLimits.keys()]) if (/^(login|signup|code|verify|seat|contact|subscribe|admin|event):/.test(k)) rateLimits.delete(k); };
  /** Twenty wrong codes across four connections — five each, the per-connection cap — which is what burns an address. */
  const burnAt = async (email, live, ips, pw) => {
    const st = [];
    for (const ip of ips) for (let i = 0; i < 5; i++) st.push((await from('/account/verify', { email, code: live === '111111' ? '222222' : '111111', password: pw }, ip)).status);
    return st;
  };
  const OWNER_PW = 'the real owner pw', ATT_PW = 'attacker password 1';

  /* ═══ R7-1 · the takeover class, in every ordering the last three reviews found ═══
     Round 5 let the LAST writer win: a stranger replaced a sign-up in flight and the owner verified the stranger's
     credentials. Round 6 made it the FIRST writer and gated the replace on the code's age — and /account/resend
     re-stamped the column that gate read, so the hold renewed every sixty seconds; the round-6 review held an address
     for six hours against 51 owner attempts. Both are the same bug: ONE ROW PER ADDRESS is a slot, and a slot is
     something a stranger can be in. There is no slot below. Every ordering ends with the owner holding the account and
     none of them ends with the owner waiting. */

  /* ── probe 1d: the burn ordering ── */
  resetLimits(); emails.length = 0;
  const V = 'r7victim@example.com', OWNER_IP = '198.51.100.200';
  await from('/account/register', { email: V, password: OWNER_PW, name: 'Vic Owner' }, OWNER_IP);
  const ownerCode1 = lastCode();
  const guesses = await burnAt(V, ownerCode1, ['198.51.100.201', '198.51.100.202', '198.51.100.203', '198.51.100.204'], ATT_PW);
  ok('1d step 2: twenty wrong codes across four connections burn every sign-up at the address and mail the owner the notice',
     guesses.length === 20 && guesses.every((s) => s === 401) && (await pendingsFor(V)).length === 0 && notices(V).length === 1,
     guesses.length + ' tries, rows=' + (await pendingsFor(V)).length + ' notices=' + notices(V).length);
  emails.length = 0;
  const grab = await from('/account/register', { email: V, password: ATT_PW, name: 'Mallory' }, '198.51.100.205');
  ok('1d step 3: the stranger\'s twenty-first request buys them a row of their own and nothing of the owner\'s — no account, no credential of theirs anywhere the owner can reach',
     grab.status === 202 && !rowFor(V) && (await pendingsFor(V)).every((r) => r.name === 'Mallory'), grab.status + ' rows=' + (await pendingsFor(V)).length);
  emails.length = 0;
  const again = await from('/account/register', { email: V, password: OWNER_PW, name: 'Vic Owner' }, OWNER_IP);
  const ownerCode2 = lastCode();
  ok('1d step 4: the owner signs up again and is mailed a code AT ONCE — no throttle exemption to grant, no fifteen minutes to wait, nothing of the stranger\'s in the way',
     again.status === 202 && !!ownerCode2 && ownerCode2 !== ownerCode1 && emails.length === 1, again.status + ' code=' + !!ownerCode2 + ' mails=' + emails.length);
  const made = await from('/account/verify', { email: V, code: ownerCode2, password: OWNER_PW }, OWNER_IP);
  const ownerIn = await from('/account/login', { email: V, password: OWNER_PW }, '198.51.100.207');
  const strangerIn = await from('/account/login', { email: V, password: ATT_PW }, '198.51.100.208');
  ok('1d: THE DETERMINISTIC TAKEOVER IS CLOSED, and closed without a wait — the OWNER\'s password issues the token and the stranger\'s answers 401',
     made.status === 200 && ownerIn.status === 200 && strangerIn.status === 401,
     'verify=' + made.status + ' owner=' + ownerIn.status + ' stranger=' + strangerIn.status);
  /* ── probe 1e: there is no stranger token to read /account/me with ── */
  const strangerBody = await strangerIn.clone().json();
  const meWithOwner = await worker.fetch(new Request('https://api.test/account/me', { headers: { Origin: 'https://mastsolutions.com', Authorization: 'Bearer ' + (await made.clone().json()).token } }), env, ctx);
  const meBody = await meWithOwner.json();
  ok('1e: no token is ever issued to the stranger, so /account/me carries the owner\'s account and there is nothing for the stranger to read it with',
     !strangerBody.token && strangerBody.code === 'bad_login' && meWithOwner.status === 200 && meBody.account.email === V && meBody.account.name === 'Vic Owner',
     JSON.stringify({ stranger: strangerBody.code, me: meWithOwner.status, name: meBody.account && meBody.account.name }));

  /* ── probe 1b: the owner signs up first and a stranger posts the address a minute later ── */
  resetLimits(); emails.length = 0;
  const V2 = 'r7owner-first@example.com';
  await from('/account/register', { email: V2, password: OWNER_PW, name: 'Vic Owner' }, '198.51.100.210');
  const code1b = lastCode();
  emails.length = 0;
  const grab1b = await from('/account/register', { email: V2, password: ATT_PW, name: 'Mallory' }, '198.51.100.211');
  const rows1b = await pendingsFor(V2);
  ok('1b: a stranger posting the address gets a row and a code of their OWN — the owner\'s row is untouched, unreplaced and still carries the owner\'s password',
     grab1b.status === 202 && rows1b.length === 2 && rows1b.some((r) => r.name === 'Vic Owner') && rows1b.some((r) => r.name === 'Mallory'),
     grab1b.status + ' rows=' + rows1b.length + ' names=' + rows1b.map((r) => r.name).join('/'));
  const made1b = await from('/account/verify', { email: V2, code: code1b, password: OWNER_PW }, '198.51.100.212');
  ok('1b: … so the code in the owner\'s mailbox is still THEIR code: the owner\'s password issues the token and the stranger\'s answers 401',
     made1b.status === 200 &&
     (await from('/account/login', { email: V2, password: OWNER_PW }, '198.51.100.213')).status === 200 &&
     (await from('/account/login', { email: V2, password: ATT_PW }, '198.51.100.214')).status === 401,
     'verify=' + made1b.status);

  /* ── probe 1c: the stranger signs up first — the ordering that was round 6's disclosed residual #4 ──
     Round 6 answered the owner's own sign-up with a 202 and NO mail while the stranger's code was live, so the only
     code in the owner's mailbox was the stranger's and entering it created the account under the stranger's password.
     The owner now gets their own code immediately, and the stranger's code — the one that arrived before they asked —
     is refused when they try it, because it does not belong to their password. */
  resetLimits(); emails.length = 0;
  const V3 = 'r7stranger-first@example.com';
  await from('/account/register', { email: V3, password: ATT_PW, name: 'Mallory' }, '198.51.100.220');
  const strangerCode = lastCode();
  emails.length = 0;
  const held1c = await from('/account/register', { email: V3, password: OWNER_PW, name: 'Vic Owner' }, '198.51.100.221');
  const code1c = lastCode();
  ok('1c: the owner\'s sign-up inside the stranger\'s live window is NOT held — same 202, and a second code goes out, which is what round 6 refused to send',
     held1c.status === 202 && emails.length === 1 && !!code1c && code1c !== strangerCode && (await pendingsFor(V3)).length === 2,
     held1c.status + ' mails=' + emails.length + ' rows=' + (await pendingsFor(V3)).length);
  const wrongRow = await from('/account/verify', { email: V3, code: strangerCode, password: OWNER_PW }, '198.51.100.222');
  ok('1c: … and the residual round 6 disclosed is gone: the owner entering the code that arrived BEFORE they asked is refused, and creates nothing',
     wrongRow.status === 401 && !rowFor(V3), wrongRow.status + ' account=' + !!rowFor(V3));
  const made1c = await from('/account/verify', { email: V3, code: code1c, password: OWNER_PW }, '198.51.100.223');
  ok('1c: … the owner\'s own code and password take the address immediately, with no expiry to wait out, and the stranger\'s password answers 401',
     made1c.status === 200 &&
     (await from('/account/login', { email: V3, password: OWNER_PW }, '198.51.100.224')).status === 200 &&
     (await from('/account/login', { email: V3, password: ATT_PW }, '198.51.100.225')).status === 401,
     'owner verify=' + made1c.status);
  ok('1c: … and creating the account took the stranger\'s row with it: their code is dead because their sign-up is gone',
     (await pendingsFor(V3)).length === 0 &&
     (await from('/account/verify', { email: V3, code: strangerCode, password: ATT_PW }, '198.51.100.226')).status === 401,
     'rows left=' + (await pendingsFor(V3)).length);

  /* ═══ R7-2 · the round-6 P1: resend renews a hold. There is no hold, so the probe cannot be run — it is run anyway ═══
     The round-6 review held an address for six hours: one /account/resend every fourteen minutes from two connections
     pushed the fifteen-minute replace gate forward for ever, and 51 consecutive owner sign-ups were refused with a 202
     and no mail. The same script below, at full speed: the owner must be refused ZERO times and must hold the account
     at the end. Nothing here waits, because there is nothing to wait for. */
  resetLimits(); emails.length = 0;
  const V4 = 'r7held@example.com';
  await from('/account/register', { email: V4, password: ATT_PW, name: 'Mallory' }, '198.51.100.230');
  let ownerRefused = 0, ownerCodes = 0, lastOwnerCode = null;
  for (let cycle = 0; cycle < 6; cycle++) {
    clearRouteWindows();
    await from('/account/resend', { email: V4 }, '198.51.100.230');
    await from('/account/resend', { email: V4 }, '198.51.100.231');
    await from('/account/register', { email: V4, password: ATT_PW, name: 'Mallory' }, '198.51.100.231');
    emails.length = 0;
    const attempt = await from('/account/register', { email: V4, password: OWNER_PW, name: 'Vic Owner' }, '198.51.100.23' + (cycle + 2));
    const code = lastCode();
    if (attempt.status !== 202 || !code) ownerRefused++; else { ownerCodes++; lastOwnerCode = code; }
  }
  ok('R7-2: six cycles of a stranger resending and re-registering — the round-6 hold script — refuse the owner NOTHING: six attempts, six codes, no waiting',
     ownerRefused === 0 && ownerCodes === 6, 'refused=' + ownerRefused + ' codes=' + ownerCodes);
  const heldOut = await from('/account/verify', { email: V4, code: lastOwnerCode, password: OWNER_PW }, '198.51.100.239');
  ok('R7-2: … and the owner\'s last code plus the owner\'s password takes the address, against however many rows the stranger left behind',
     heldOut.status === 200 && (await from('/account/login', { email: V4, password: OWNER_PW }, '198.51.100.240')).status === 200 &&
     (await from('/account/login', { email: V4, password: ATT_PW }, '198.51.100.241')).status === 401 && (await pendingsFor(V4)).length === 0,
     'verify=' + heldOut.status + ' rows left=' + (await pendingsFor(V4)).length);
  /* THE SOURCE-LEVEL INVARIANT, because the behaviour above is closed by an ABSENCE and an absence passes every request
     the day somebody re-adds the gate. /account/register must read no pending row and refuse on nothing. */
  const workerSrc7 = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'src', 'worker.js'), 'utf8');
  const regBody7 = workerSrc7.slice(workerSrc7.indexOf('async function handleAccountRegister'), workerSrc7.indexOf('/** The one answer POST /account/register ever gives'));
  ok('R7-2: /account/register reads no pending row at all — there is no gate in the source for a stranger to hold shut, and no column a resend could move',
     !/function pendingHeld|function pendingTooSoon/.test(workerSrc7) && !/'[^']*(code_sent_at|burn_cleared_at)[^']*'/.test(workerSrc7) && !/FROM pending_signups/.test(regBody7),
     'gate defined=' + /function pendingHeld|function pendingTooSoon/.test(workerSrc7) + ' gate columns in any statement=' + /'[^']*(code_sent_at|burn_cleared_at)[^']*'/.test(workerSrc7));
  ok('R7-2: … and /account/resend writes by signup_id, so the one row it can ever move is the one it just found from this connection',
     /const PENDING_ISSUE = 'UPDATE pending_signups SET code_hash = \?, verify_expires_at = \? WHERE signup_id = \?';/.test(workerSrc7),
     'PENDING_ISSUE keyed on signup_id');

  /* ═══ R7-3 · exactly one PBKDF2 per verification, and the guess caps a stranger spends are their own ═══ */
  resetLimits(); emails.length = 0;
  const verifyFn = workerSrc7.slice(workerSrc7.indexOf('async function pendingVerify'), workerSrc7.indexOf('async function guardedPendingVerify'));
  ok('R7-3: pendingVerify hashes exactly ONCE per request, against the row or against the dummy — a wrong password cannot be told from a wrong code by what it costs',
     (verifyFn.match(/verifyPassword\(/g) || []).length === 1 && /DUMMY_PASSWORD_HASH/.test(verifyFn), (verifyFn.match(/verifyPassword\(/g) || []).length + ' call');
  const V5 = 'r7guess@example.com', V5_IP = '198.51.100.250';
  await from('/account/register', { email: V5, password: OWNER_PW }, V5_IP);
  const code5 = lastCode();
  const strangerGuesses = [];
  for (let i = 0; i < 6; i++) strangerGuesses.push((await from('/account/verify', { email: V5, code: code5 === '111111' ? '222222' : '111111', password: ATT_PW }, '198.51.100.251')).status);
  ok('R7-3: a stranger guessing at the owner\'s code space spends their OWN five-guess budget and is refused on the sixth, and the owner\'s sign-up is still there',
     strangerGuesses.join() === '401,401,401,401,401,401' && (await pendingsFor(V5)).length === 1 && (await pendingsFor(V5))[0].verify_attempts === 5,
     strangerGuesses.join() + ' attempts=' + (await pendingsFor(V5))[0].verify_attempts);
  ok('R7-3: … and the owner, on their own connection, finishes with the code that was in their inbox all along',
     (await from('/account/verify', { email: V5, code: code5, password: OWNER_PW }, V5_IP)).status === 200);

  /* ═══ R7-4 · the statement count of every account route is the same in every class ═══
     The round-6 review found the burn branch had no absent twin: the twentieth guess at a real address cost one
     statement more than the twentieth at an invented one (10 x19 then 11, against 10 x20), which classifies an address
     at the price of twenty requests. PENDING_BURN now runs on every refused verification with its predicate in the
     BINDS, so the burning request costs what every other one costs. Four classes, because round 7 adds one the earlier
     rounds could not have: an address a STRANGER has a sign-up at. */
  resetLimits(); emails.length = 0;
  const ACC = 'r7class-account@example.com', PEND = 'r7class-pending@example.com', STRANGE = 'r7class-stranger@example.com';
  const CLASS_IP = '198.51.100.190';
  await from('/account/register', { email: ACC, password: OWNER_PW }, CLASS_IP);
  await from('/account/verify', { email: ACC, code: lastCode(), password: OWNER_PW }, CLASS_IP);
  await from('/account/register', { email: PEND, password: OWNER_PW }, CLASS_IP);
  await from('/account/register', { email: STRANGE, password: ATT_PW }, '198.51.100.191');
  await from('/account/register', { email: STRANGE, password: ATT_PW }, '198.51.100.192');
  const classesOf = (n) => [['brand-new', 'r7class-new-' + n + '@example.com'], ['pending', PEND], ['account', ACC], ['stranger-rows', STRANGE]];
  const parity = {};
  for (const [route, body] of [['/account/verify', (e) => ({ email: e, code: '123456', password: 'a long enough password' })],
                               ['/account/resend', (e) => ({ email: e })],
                               ['/account/register', (e) => ({ email: e, password: 'a long enough password' })]]) {
    const seen = {};
    for (let n = 0; n < 3; n++) {
      for (const [name, addr] of classesOf(n)) {
        clearRouteWindows();
        const c = await cost(route, body(addr), '10.7.' + (n + 1) + '.' + (classesOf(n).findIndex(([k]) => k === name) + 1));
        (seen[name] = seen[name] || []).push(c.statements);
      }
    }
    parity[route] = Object.fromEntries(Object.entries(seen).map(([k, v]) => [k, [...new Set(v)].join('/')]));
    const counts = new Set(Object.values(seen).flat());
    console.log('  (' + route + ' — ' + Object.entries(parity[route]).map(([k, v]) => k + ' ' + v).join(', ') + ' statements)');
    ok(route + ' costs the same statements for a brand-new address, one with a sign-up waiting, one with an account and one a STRANGER has sign-ups at',
       counts.size === 1, JSON.stringify(parity[route]));
  }
  /* The burning request is the class the round-6 review said probe 2b could not reach: the twentieth guess. */
  resetLimits(); emails.length = 0;
  const BURNCLASS = 'r7burnclass@example.com';
  await from('/account/register', { email: BURNCLASS, password: OWNER_PW }, CLASS_IP);
  const burnLive = lastCode();
  const burnCosts = [], ghostCosts = [];
  for (let i = 0; i < 4; i++) {
    for (let g = 0; g < 5; g++) {
      clearRouteWindows();
      burnCosts.push((await cost('/account/verify', { email: BURNCLASS, code: burnLive === '111111' ? '222222' : '111111', password: ATT_PW }, '10.7.9.' + (i + 1))).statements);
      ghostCosts.push((await cost('/account/verify', { email: 'r7burnghost-' + i + g + '@example.com', code: '111111', password: ATT_PW }, '10.7.8.' + (i + 1))).statements);
    }
  }
  ok('R7-4: the BURNING request — the twentieth wrong code, which round 6 spent an extra statement on — costs exactly what the twentieth guess at an address with nothing costs',
     (await pendingsFor(BURNCLASS)).length === 0 && new Set([...burnCosts, ...ghostCosts]).size === 1,
     'burned=' + [...new Set(burnCosts)].join('/') + ' ghost=' + [...new Set(ghostCosts)].join('/'));

  /* ═══ R7-5 · the burn notice stays outside the mail budgets, and is still bounded at one per live code ═══ */
  resetLimits(); emails.length = 0;
  const BOX = 'r7mailbox@example.com', MAILER = '198.51.100.180';
  let codeMails = 0;
  for (let round = 0; round < 4; round++) {
    clearRouteWindows();
    const before = emails.length;
    await from('/account/register', { email: BOX, password: OWNER_PW }, MAILER);
    const live = lastCode();
    if (emails.length > before) codeMails++;
    await burnAt(BOX, live, [0, 1, 2, 3].map((n) => '10.7.5.' + (round * 4 + n + 1)), ATT_PW);
  }
  const toBox = emails.filter((m) => m.to[0] === BOX);
  ok('R7-5: one connection buys three code mails at a mailbox and can convert each into one burn notice and no more — six mails, the 2x the README ceiling states',
     codeMails === 3 && notices(BOX).length === 3 && toBox.length === 6,
     'code mails=' + codeMails + ' burn notices=' + notices(BOX).length + ' total to the mailbox=' + toBox.length);
  const spentAgain = await burnAt(BOX, '111111', ['10.7.6.1', '10.7.6.2', '10.7.6.3', '10.7.6.4'], ATT_PW);
  ok('R7-5: … and twenty more wrong codes against an address with nothing left send nothing: no rows, no burn, no notice — the bound is the sign-up, not a counter that can be reset',
     spentAgain.every((s) => s === 401) && notices(BOX).length === 3, 'notices still ' + notices(BOX).length);

  /* ═══ R6-3 · probe 2b: the account lock must not classify an address (carried forward, unchanged) ═══
     Five wrong passwords from any five connections locked a real account, and the sixth request from ANY connection
     then answered 429 in 5 statements and 0.7 ms where an absent address and a pending-only address both answered 401
     in 10 statements and 45.7 ms. The lock runs the dummy hash and the same statements the absent path runs. */
  resetLimits(); emails.length = 0;
  const LOCKED = 'r7locked@example.com', PENDONLY = 'r7pending-only@example.com';
  await from('/account/register', { email: LOCKED, password: 'the owners real password' }, '198.51.100.170');
  await from('/account/verify', { email: LOCKED, code: lastCode(), password: 'the owners real password' }, '198.51.100.170');
  await from('/account/register', { email: PENDONLY, password: 'a long enough password' }, '198.51.100.171');
  ok('2b fixture: one verified account, one address with only a sign-up in progress, and one that has never been seen',
     !!rowFor(LOCKED) && !!rowFor(LOCKED).verified_at && !rowFor(PENDONLY) && !!(await pendingFor(PENDONLY)), 'fixture');
  for (let i = 0; i < 5; i++) await from('/account/login', { email: LOCKED, password: 'wrong password ' + i }, '198.51.100.16' + i);
  ok('2b: five wrong passwords from five different connections lock the account globally', !!rowFor(LOCKED).locked_until && Date.parse(rowFor(LOCKED).locked_until) > Date.now(), 'locked_until=' + rowFor(LOCKED).locked_until);
  const SAMPLES = 21;
  const classes = { absent: [], 'pending-only': [], 'verified-locked': [] };
  for (let i = 0; i < SAMPLES; i++) {
    classes.absent.push(await cost('/account/login', { email: 'r7-never-seen-' + i + '@example.com', password: 'wrong password here' }, '10.6.1.' + (i + 1)));
    classes['pending-only'].push(await cost('/account/login', { email: PENDONLY, password: 'wrong password here' }, '10.6.2.' + (i + 1)));
    classes['verified-locked'].push(await cost('/account/login', { email: LOCKED, password: 'wrong password here' }, '10.6.3.' + (i + 1)));
  }
  const bodies = {}, stmts = {}, medians = {};
  for (const [name, runs] of Object.entries(classes)) {
    bodies[name] = [...new Set(await Promise.all(runs.map(async (r) => r.res.status + ' ' + (await r.res.clone().text()))))];
    stmts[name] = [...new Set(runs.map((r) => r.statements))].sort((a, b) => a - b).join('/');
    medians[name] = runs.map((r) => r.ms).sort((a, b) => a - b)[Math.floor(SAMPLES / 2)];
  }
  const oneBody = [...new Set(Object.values(bodies).flat())];
  ok('2b: 21 samples per class — an absent address, an address with only a sign-up, and a LOCKED verified account all answer one 401 bad_login, byte for byte',
     oneBody.length === 1 && oneBody[0].startsWith('401') && JSON.parse(oneBody[0].slice(4)).code === 'bad_login', oneBody.join('  |  '));
  ok('2b: … on the same statement set, so a caller who counts D1 statements cannot separate them either (round 5: 10 / 10 / 5)',
     new Set(Object.values(stmts)).size === 1, Object.entries(stmts).map(([k, v]) => k + '=' + v).join(' '));
  const med = Object.values(medians), spread = Math.max(...med) / Math.min(...med);
  ok('2b: … and the medians sit inside the noise floor rather than two orders of magnitude apart (round 5: 45.7 / 45.8 / 0.7 ms — the lock skipped the PBKDF2)',
     spread < 2, Object.entries(medians).map(([k, v]) => k + '=' + v.toFixed(1) + 'ms').join(' ') + ' spread=' + spread.toFixed(2) + 'x');
  const right = await from('/account/login', { email: LOCKED, password: 'the owners real password' }, '10.6.4.1');
  ok('2b: … and the lock still does the one thing a lock is for: the RIGHT password is refused while it holds, with that same 401',
     right.status === 401 && (await right.clone().json()).code === 'bad_login' && (await right.clone().text()) === oneBody[0].slice(4),
     right.status + ' ' + (await right.clone().text()));
  ok('2b: … and the refused requests do not walk the ladder up: failed_logins stays at the five that set the lock, so a guesser cannot drive a customer to the 24-hour cap',
     rowFor(LOCKED).failed_logins === 5, 'failed_logins=' + rowFor(LOCKED).failed_logins);

  /* ═══ R6-5 · the '@' sweep, over every key the table has ever been asked about (carried forward) ═══ */
  ok('R6-5: the same sweep at the END of the file, where it covers every key every block has spent — the round-5 copy above cannot see what the later rounds write after it',
     rateKeysEver.size > 100 && [...rateKeysEver].every((k) => !k.includes('@')),
     [...rateKeysEver].filter((k) => k.includes('@')).slice(0, 3).join(' ') || (rateKeysEver.size + ' keys, none'));
  ok('… and the sweep is wide enough to mean something: every counter family this Worker keys on an address is in it',
     ['loginfail:', 'codeguess:', 'codemail:', 'codemailtotal:'].every((fam) => [...rateKeysEver].some((k) => k.startsWith(fam))),
     ['loginfail:', 'codeguess:', 'codemail:', 'codemailtotal:'].filter((fam) => ![...rateKeysEver].some((k) => k.startsWith(fam))).join() || 'all four present');
  ok('R7: and no pending row in the table carries a plaintext address or a key an address could be found by, however many sign-ups are waiting',
     [...pendingSignups.values()].every((r) => (/^[0-9a-f]{64}$/.test(r.address_digest) || r.address_digest === 'absent') && /^[0-9a-f]{32}$/.test(r.signup_id) || r.signup_id === 'absent') &&
     !JSON.stringify([...pendingSignups.values()]).includes('@'),
     pendingSignups.size + ' rows');

  /* ── the Worker's own schema heal, which is what makes a round-5/6 database survive a deploy that lands first ──
     The DDL is what the decision reads since round 8: the probe is a SELECT against sqlite_master, an ordinary table,
     rather than the pragma_table_info() table-valued function nothing had ever run against D1. */
  {
    const { healPendingSignups, RATE_SCHEMA } = await import('./src/ratelimit.js');
    const shapes = [];
    const OLD_DDL = 'CREATE TABLE pending_signups (address_digest TEXT PRIMARY KEY, password_hash TEXT NOT NULL, name TEXT, phone TEXT, organization TEXT, verify_code_hash TEXT, verify_expires_at TEXT, verify_attempts INTEGER NOT NULL DEFAULT 0, code_sent_at TEXT, created_ip TEXT, created_at TEXT NOT NULL)';
    const NEW_DDL = 'CREATE TABLE pending_signups (signup_id TEXT PRIMARY KEY, address_digest TEXT NOT NULL, password_hash TEXT NOT NULL, code_hash TEXT, verify_expires_at TEXT, verify_attempts INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, created_ip TEXT)';
    const fakeDb = (ddl) => ({ DB: { prepare(sql) { return { async all() { shapes.push(sql); return { results: ddl ? [{ sql: ddl }] : [] }; }, async run() { shapes.push(sql); return { meta: { changes: 0 } }; } }; } } });
    const droppedOld = await healPendingSignups(fakeDb(OLD_DDL));
    const keptNew = await healPendingSignups(fakeDb(NEW_DDL));
    const keptAbsent = await healPendingSignups(fakeDb(''));
    ok('R7: the Worker drops a pre-round-7 pending_signups and ONLY that — a table with signup_id and a database with no table at all are both left alone',
       droppedOld === true && keptNew === false && keptAbsent === false && shapes.filter((q) => /DROP TABLE/.test(q)).length === 1,
       'old=' + droppedOld + ' new=' + keptNew + ' absent=' + keptAbsent + ' drops=' + shapes.filter((q) => /DROP TABLE/.test(q)).length);
    ok('R8-8: … and it asks sqlite_master for the DDL rather than calling pragma_table_info() through the D1 binding — the form no test had ever executed against D1',
       shapes.some((q) => /FROM sqlite_master/.test(q) && /name = 'pending_signups'/.test(q)) && !shapes.some((q) => /pragma_table_info/.test(q)),
       shapes.filter((q) => /SELECT/.test(q))[0]);
    ok('… and the CREATE it heals into is the per-sign-up shape, with the (address_digest, code_hash) index /account/verify reads',
       RATE_SCHEMA.some((st) => /CREATE TABLE IF NOT EXISTS pending_signups \(signup_id TEXT PRIMARY KEY/.test(st)) &&
       RATE_SCHEMA.some((st) => /CREATE INDEX IF NOT EXISTS idx_pending_signups_code ON pending_signups \(address_digest, code_hash\)/.test(st)),
       String(RATE_SCHEMA.filter((st) => st.includes('pending_signups')).length) + ' statements');
  }

  resetLimits(); emails.length = 0;
}

console.log('\n── Round 8: a failed sign-up write is a refusal, the schema probe is plain SQL, and the old page is answered (security review round 8, 2026-09-09) ──');
{
  const from = (path, body, ip) => post(path, body, 'https://mastsolutions.com', ip);
  const rowsFor = (email) => [...accounts.values()].filter((a) => a.email === email);
  const codeIn = (m) => (/\b(\d{6})\b/.exec((m && m.text) || '') || [])[1];
  const lastCode = () => codeIn([...emails].reverse().find((m) => /verification code/i.test(m.subject)));
  const cost = async (path, body, ip) => {
    const before = sqlLog.length;
    const res = await from(path, body, ip);
    return { res, statements: sqlLog.length - before, sql: sqlLog.slice(before) };
  };
  const clearRouteWindows = () => { for (const k of [...rateLimits.keys()]) if (/^(login|signup|code|verify|seat|contact|subscribe|admin|event):/.test(k)) rateLimits.delete(k); };
  const OWNER_PW = 'the real owner pw', ATT_PW = 'attacker password 1';

  /* ═══ R8-7 · /account/register answered 202 and mailed a code when the row was never written ═══
     The PENDING_INSERT result was swallowed by a .catch that logged and continued, so a D1 that could not take the row
     still sent six digits — and every attempt to use them met the one 401 bad_code a wrong guess gets, with nothing to
     say the sign-up does not exist. Two failure shapes, because they are not the same shape: a statement that REJECTS,
     and one that resolves reporting it changed nothing. */
  resetLimits(); emails.length = 0;
  const envWith = (prepare) => ({ ...env, DB: { prepare } });
  const REJECTS = envWith((sql) => (sql.startsWith('INSERT OR REPLACE INTO pending_signups')
    ? { bind: () => ({ run: async () => { throw new Error('D1_ERROR: database is locked'); } }) }
    : DB.prepare(sql)));
  const CHANGES_NOTHING = envWith((sql) => (sql.startsWith('INSERT OR REPLACE INTO pending_signups')
    ? { bind: () => ({ run: async () => ({ meta: { changes: 0 } }) }) }
    : DB.prepare(sql)));
  const registerAgainst = async (e, email, ip) => {
    const res = await worker.fetch(new Request('https://api.test/account/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://mastsolutions.com', 'CF-Connecting-IP': ip }, body: JSON.stringify({ email, password: OWNER_PW, name: 'Vic Owner' }),
    }), e, ctx);
    await drain();
    return { status: res.status, body: await res.clone().json() };
  };
  const R8IP = '198.51.100.10';
  emails.length = 0;
  const rejected = await registerAgainst(REJECTS, 'r8reject@example.com', R8IP);
  const mailsAfterReject = emails.length;
  ok('R8-7: a sign-up whose pending row was REJECTED by D1 is refused — 503 signup_unavailable — and no code is mailed, so nobody is handed six digits that can never be verified',
     rejected.status === 503 && rejected.body.code === 'signup_unavailable' && mailsAfterReject === 0 && (await pendingsFor('r8reject@example.com')).length === 0,
     rejected.status + ' ' + JSON.stringify(rejected.body) + ' mails=' + mailsAfterReject);
  emails.length = 0;
  const silent = await registerAgainst(CHANGES_NOTHING, 'r8silent@example.com', '198.51.100.11');
  ok('R8-7: … and a write that resolves having changed NOTHING is the same refusal — meta.changes is read, not the absence of a rejection',
     silent.status === 503 && silent.body.code === 'signup_unavailable' && emails.length === 0,
     silent.status + ' ' + JSON.stringify(silent.body) + ' mails=' + emails.length);
  emails.length = 0;
  const healthy = await registerAgainst(env, 'r8healthy@example.com', '198.51.100.12');
  ok('R8-7: … and the healthy path is untouched: the ordinary 202, one code mailed, one row written',
     healthy.status === 202 && healthy.body.pending === true && emails.length === 1 && (await pendingsFor('r8healthy@example.com')).length === 1,
     healthy.status + ' mails=' + emails.length);
  /* The refusal must not be an address classifier: it is decided by the write, which is the same write at every address. */
  resetLimits(); emails.length = 0;
  const R8ACC = 'r8class-account@example.com', R8PEND = 'r8class-pending@example.com', R8STR = 'r8class-stranger@example.com';
  const R8CLASS_IP = '198.51.100.150';
  await from('/account/register', { email: R8ACC, password: OWNER_PW }, R8CLASS_IP);
  await from('/account/verify', { email: R8ACC, code: lastCode(), password: OWNER_PW }, R8CLASS_IP);
  await from('/account/register', { email: R8PEND, password: OWNER_PW }, R8CLASS_IP);
  await from('/account/register', { email: R8STR, password: ATT_PW }, '198.51.100.151');
  await from('/account/register', { email: R8STR, password: ATT_PW }, '198.51.100.152');
  const regClasses = (n) => [['brand-new', 'r8class-new-' + n + '@example.com'], ['pending', R8PEND], ['account', R8ACC], ['stranger-rows', R8STR]];
  const regSeen = {}, regStatus = new Set();
  for (let n = 0; n < 3; n++) {
    for (const [name, addr] of regClasses(n)) {
      clearRouteWindows();
      const c = await cost('/account/register', { email: addr, password: 'a long enough password' }, '10.8.' + (n + 1) + '.' + (regClasses(n).findIndex(([k]) => k === name) + 1));
      (regSeen[name] = regSeen[name] || []).push(c.statements); regStatus.add(c.res.status);
    }
  }
  console.log('  (/account/register after R8-7 — ' + Object.entries(regSeen).map(([k, v]) => k + ' ' + [...new Set(v)].join('/')).join(', ') + ' statements)');
  ok('R8-7: … and reading the result adds no statement and no branch a caller can see: the four classes still cost one count and still answer one 202',
     new Set(Object.values(regSeen).flat()).size === 1 && regStatus.size === 1 && [...regStatus][0] === 202,
     JSON.stringify(Object.fromEntries(Object.entries(regSeen).map(([k, v]) => [k, [...new Set(v)].join('/')]))) + ' statuses=' + [...regStatus].join());

  /* ═══ R8-8 · the schema probe, and what happens when the probe itself fails ═══
     healPendingSignups asked pragma_table_info('pending_signups') through the D1 binding — a table-valued function no
     test has ever executed against D1 rather than against a stand-in. If D1 rejects it the probe throws, and what
     followed was the real defect: ensureRateSchema set allOk = false and CONTINUED into a CREATE TABLE IF NOT EXISTS,
     which is a no-op against the old shape, so every sign-up wrote signup_id into a table with no such column. */
  {
    const { ensureRateSchema, _resetRateSchemaMemo } = await import('./src/ratelimit.js');
    const ran = [];
    let probes = 0;
    const brokenProbe = { DB: { prepare(sql) { return {
      async all() { if (/sqlite_master/.test(sql)) { probes++; throw new Error('D1_ERROR: no such table: sqlite_master'); } return { results: [] }; },
      async run() { ran.push(sql); return { meta: { changes: 0 } }; },
    }; } } };
    _resetRateSchemaMemo();
    const first = await ensureRateSchema(brokenProbe);
    ok('R8-8: when the schema probe itself fails, NOTHING is created over the shape it could not read — the run reports failure and the CREATE that used to paper over it does not run',
       first === false && probes === 1 && ran.length === 0, 'ok=' + first + ' probes=' + probes + ' statements run=' + ran.length + (ran[0] ? ' first=' + ran[0].slice(0, 40) : ''));
    const second = await ensureRateSchema(brokenProbe);
    ok('R8-8: … and the memo is cleared, so the next request probes again rather than believing a schema it never saw',
       second === false && probes === 2, 'probes=' + probes);
    _resetRateSchemaMemo();
    const good = { DB: { prepare(sql) { return {
      async all() { return { results: [{ sql: 'CREATE TABLE pending_signups (signup_id TEXT PRIMARY KEY, address_digest TEXT NOT NULL)' }] }; },
      async run() { ran.push(sql); return { meta: { changes: 0 } }; },
    }; } } };
    ok('R8-8: … and a probe that answers lets the schema run as it always did',
       (await ensureRateSchema(good)) === true && ran.some((q) => /CREATE TABLE IF NOT EXISTS rate_limits/.test(q)) && ran.some((q) => /CREATE TABLE IF NOT EXISTS pending_signups/.test(q)),
       ran.length + ' statements');
    _resetRateSchemaMemo();
  }

  /* ═══ R8-9 · a page cached before round 7 posts {email, code} and had no way forward ═══
     Round 7 made /account/verify take the triple. The old client's request is missing a field rather than wrong about
     one, and answering it with the one 401 bad_code told the visitor their code was wrong — so they retyped the six
     digits from their mailbox until the twenty-try burn took the sign-up. */
  resetLimits(); emails.length = 0;
  const OLDPAGE = 'r8oldpage@example.com', OLDIP = '198.51.100.60';
  await from('/account/register', { email: OLDPAGE, password: OWNER_PW }, OLDIP);
  const realCode = lastCode();
  const noPw = await cost('/account/verify', { email: OLDPAGE, code: realCode }, OLDIP);
  const noPwBody = await noPw.res.clone().json();
  ok('R8-9: the old page\'s {email, code} is answered 400 password_required rather than 401 bad_code — a request this Worker cannot act on, not a guess it refused',
     noPw.res.status === 400 && noPwBody.code === 'password_required' && !noPwBody.token, noPw.res.status + ' ' + JSON.stringify(noPwBody));
  ok('R8-9: … and it costs no D1 read of the address and no PBKDF2 — the answer is decided by the request body, so it cannot classify anything',
     !noPw.sql.some((q) => /pending_signups|FROM accounts/.test(q)), noPw.sql.join(' | ').slice(0, 160));
  const pwClasses = [['brand-new', 'r8nopw-new@example.com'], ['pending', OLDPAGE], ['account', R8ACC], ['stranger-rows', R8STR]];
  const pwSeen = {}, pwBodies = new Set();
  for (const [name, addr] of pwClasses) {
    clearRouteWindows();
    const c = await cost('/account/verify', { email: addr, code: '123456' }, '10.8.9.' + (pwClasses.findIndex(([k]) => k === name) + 1));
    pwSeen[name] = c.statements; pwBodies.add(c.res.status + ' ' + (await c.res.clone().text()));
  }
  ok('R8-9: … and it is the same answer and the same cost at a brand-new address, one with a sign-up, one with an account and one a stranger has rows at',
     new Set(Object.values(pwSeen)).size === 1 && pwBodies.size === 1 && [...pwBodies][0].startsWith('400'),
     JSON.stringify(pwSeen) + ' ' + [...pwBodies].join(' | '));
  const emptyPw = await from('/account/verify', { email: OLDPAGE, code: realCode, password: '' }, OLDIP);
  ok('R8-9: … an empty password string is the same missing field, not an empty guess to hash',
     emptyPw.status === 400 && (await emptyPw.clone().json()).code === 'password_required', emptyPw.status);
  const wrongPw = await from('/account/verify', { email: OLDPAGE, code: realCode, password: ATT_PW }, OLDIP);
  ok('R8-9: … and a password that is PRESENT and wrong is still the one 401 bad_code, so the new answer separates a missing field and nothing else',
     wrongPw.status === 401 && (await wrongPw.clone().json()).code === 'bad_code', wrongPw.status + ' ' + (await wrongPw.clone().text()));
  const good = await from('/account/verify', { email: OLDPAGE, code: realCode, password: OWNER_PW }, OLDIP);
  ok('R8-9: … and the triple the current page posts still finishes the sign-up', good.status === 200 && !!(await good.clone().json()).token, good.status);

  /* ═══ R8-11 · the blocked gate: an address that acquired an account while a sign-up was live ═══
     handleAccountVerify reads the accounts row and pendingVerify then discards whatever the code found —
     `const row = blocked ? null : found`. Nothing pinned that line: mutating it to `const row = found` left the whole
     suite green, and the mutation is a second account created from a code minted before the address had one. The state
     cannot be reached through the routes (verification drops every row at the address), so the account row is placed
     the way the race places it: under a sign-up that is already live. */
  resetLimits(); emails.length = 0;
  const BLK = 'r8blocked@example.com', BLKIP = '198.51.100.70';
  await from('/account/register', { email: BLK, password: OWNER_PW, name: 'Vic Owner' }, BLKIP);
  const blkCode = lastCode();
  const nowIso = new Date().toISOString();
  accounts.set('acct_r8_blocked', { id: 'acct_r8_blocked', email: BLK, password_hash: 'pbkdf2-sha256$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', token_version: 1, name: '', phone: '', organization: '', standards_passed: '[]', created_at: nowIso, updated_at: nowIso, verified_at: nowIso, verify_attempts: 0, failed_logins: 0, locked_until: null });
  ok('R8-11 fixture: the address has an account AND a live sign-up carrying its own code and password — the mid-flight race the gate exists for',
     rowsFor(BLK).length === 1 && (await pendingsFor(BLK)).length === 1 && !!blkCode, 'accounts=' + rowsFor(BLK).length + ' rows=' + (await pendingsFor(BLK)).length);
  clearRouteWindows();
  const blocked = await cost('/account/verify', { email: BLK, code: blkCode, password: OWNER_PW }, BLKIP);
  const blockedBody = await blocked.res.clone().json();
  ok('R8-11: the sign-up\'s OWN code and OWN password are refused once the address has an account — 401 bad_code, no token, no second account, and the create is never even ATTEMPTED',
     blocked.res.status === 401 && blockedBody.code === 'bad_code' && !blockedBody.token && rowsFor(BLK).length === 1 &&
     !blocked.sql.some((q) => /INSERT INTO accounts/.test(q)),
     blocked.res.status + ' ' + JSON.stringify(blockedBody) + ' accounts=' + rowsFor(BLK).length + ' create attempted=' + blocked.sql.some((q) => /INSERT INTO accounts/.test(q)));
  const blkClasses = [['pending', R8PEND], ['account', R8ACC], ['stranger-rows', R8STR]];
  const blkOther = {};
  for (const [name, addr] of blkClasses) {
    clearRouteWindows();
    blkOther[name] = (await cost('/account/verify', { email: addr, code: '123456', password: 'a long enough password' }, '10.8.8.' + (blkClasses.findIndex(([k]) => k === name) + 1))).statements;
  }
  clearRouteWindows();
  const blkNew = (await cost('/account/verify', { email: 'r8blk-new@example.com', code: '123456', password: 'a long enough password' }, '10.8.8.9')).statements;
  ok('R8-11: … and it costs exactly what the other classes cost, so the discarded row is not visible as a statement either',
     new Set([blocked.statements, blkNew, ...Object.values(blkOther)]).size === 1,
     'blocked=' + blocked.statements + ' brand-new=' + blkNew + ' ' + Object.entries(blkOther).map(([k, v]) => k + '=' + v).join(' '));
  /* ═══ R8-1 · the docs cite assertions by their TEXT, and a line number can never come back ═══
     Round 7 left two citations in README.md and both were wrong by the time anyone read them — "test-worker.mjs:1256"
     for an assertion at 1282, and "test-worker.mjs:1992" for one at 2144. A line number is stale the moment anything is
     inserted above it and every round inserts, so the round-8 answer is not "fix the numbers" (round 7 fixed a number
     too, and here we are) — it is that the docs quote the assertion, which is what a reader greps and what cannot
     drift. This is the guard that keeps it that way, and the two quotes below are the pins: if either assertion is
     renamed, the doc that quotes it fails here rather than going quietly out of date. */
  {
    const HERE8 = path.dirname(fileURLToPath(import.meta.url));
    const suite = readFileSync(path.join(HERE8, 'test-worker.mjs'), 'utf8');
    const docs = ['README.md', 'LAUNCH-LEDGER.md'].map((f) => [f, readFileSync(path.join(HERE8, f), 'utf8')]);
    // WIDENED IN ROUND 9 to every source file this repo has, not just this suite. Round 8 pinned the two citations that
    // had gone stale and left the rest of the tree citable by line — src/worker.js, scripts/wp-upload.sh, the workflows,
    // the migrations. A line number is stale the moment anything is inserted above it, and that is true whichever file it
    // points into; round 8's own fix would have missed round 7's bug had it been written about worker.js instead.
    const CITE = /[\w./-]+\.(?:js|mjs|sh|yml|py|sql):\d+/g;
    const strays = docs.flatMap(([f, text]) => (text.match(CITE) || []).map((m) => f + ' → ' + m));
    ok('R9-4: no doc in mast-backend/ cites ANY source file by LINE NUMBER — they were wrong twice in one round, and the quoted assertion is what a reader can actually grep',
       strays.length === 0, strays.join('  |  ') || 'README.md + LAUNCH-LEDGER.md clean');
    const quoted = [
      '2b: 21 samples per class — an absent address, an address with only a sign-up, and a LOCKED verified account all answer one 401 bad_login, byte for byte',
      'a Resend outage answers identically for a new address and one that has an account — the ordinary 202 both ways, never a 502 that names the mail leg',
    ];
    const flat = (t) => t.replace(/\s+/g, ' ');   // the docs wrap their quotes across lines; the suite does not
    // "ok('<name>'" and not the bare text: the array above is IN this file, so a bare includes() matches itself and the
    // pin passes whatever the assertion is called. It has to find the string as an assertion NAME to mean anything.
    const missing = quoted.filter((q) => !suite.includes("ok('" + q + "'") || !docs.some(([, text]) => flat(text).includes(flat(q))));
    ok('R8-1: … and every assertion the docs quote by name is still in the suite under that name, so a rename breaks the build instead of the documentation',
       missing.length === 0, missing.join(' | ') || quoted.length + ' quotes pinned, both present in the suite and in README.md');
  }

  /* The source-level twin, because the behaviour above is one expression and an expression can be edited back. */
  const workerSrc8 = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'src', 'worker.js'), 'utf8');
  ok('R8-11: … and the gate is still the discard rather than a branch around the statements — the row is dropped after the reads, not instead of them',
     /const row = blocked \? null : found;/.test(workerSrc8), 'gate expression present');

  resetLimits(); emails.length = 0;
}

console.log('\n── The seat claim against a real SQL engine (security review round 3, 2026-09-08) ──');
{
  // The fake D1 above answers the Worker's queries in JavaScript, so every seat assertion in this file exercises the JS
  // and not the predicate. test-seat-claim-sqlite.mjs lifts the two statements out of src/worker.js, loads schema.sql
  // into sqlite and replays the race. No engine = a FAILURE here, never a quiet skip.
  const { runSeatClaimSql } = await import('./test-seat-claim-sqlite.mjs');
  const sqlOut = await runSeatClaimSql();
  if (sqlOut.skipped) ok('the seat claim is proved against a real SQL engine', false, 'SKIPPED: ' + sqlOut.skipped);
  else {
    console.log('  (engine: ' + sqlOut.engine + ')');
    for (const r of sqlOut.results) ok(r.name, r.pass, r.detail);
  }
}

console.log('\n── The pending-sign-up statements against a real SQL engine (security review round 5, 2026-09-09) ──');
{
  // Same reason as the block above: the fake D1 answers these queries in JavaScript, so an INSERT OR REPLACE that did
  // not replace, or a WHERE NOT EXISTS that guarded nothing, would pass every assertion in this file.
  const { runAccountSql } = await import('./test-account-sqlite.mjs');
  const sqlOut = await runAccountSql();
  if (sqlOut.skipped) ok('the pending-sign-up statements are proved against a real SQL engine', false, 'SKIPPED: ' + sqlOut.skipped);
  else {
    console.log('  (engine: ' + sqlOut.engine + ')');
    for (const r of sqlOut.results) ok(r.name, r.pass, r.detail);
  }
}

console.log('\n── CRM + marketing (owner, 2026-09-06: "CRM should collect data - and much more") ──');
{
  const { buildProfiles, audienceCsv, md5, nextCourse, mailchimpOnPayment, runJourneys, journeyText, participantLines, _resetSchemaMemo } = await import('./src/crm.js');
  const { directionsAttachment, directionsPdf, DIRECTIONS_FILENAME } = await import('./src/directions.js');
  const { createHash } = await import('node:crypto');
  _resetSchemaMemo();
  const get = (path, key, extra = {}) => worker.fetch(new Request('https://api.test' + path, { headers: Object.assign(key ? { 'X-Admin-Key': key } : {}, extra.headers || {}) }), env, ctx);

  // Data collection: a contact request is stored as a lead with its attribution before the email goes out.
  contacts.length = 0; events.length = 0; emails.length = 0;
  const attribution = { visitor: 'v_abc', utm_source: 'instagram', utm_medium: 'social', utm_campaign: 'fall-dates', referrer: 'https://l.instagram.com/', landing_page: 'https://atlasglinn.com/mastsolutions.html?utm_source=instagram', first_touch_at: '2026-09-01T12:00:00Z', page: 'https://atlasglinn.com/mastsolutions.html' };
  const lead = await post('/contact', { kind: 'contact', request_type: 'gear', company: 'HCSO', name: 'Lee Quinn', email: 'lee@example.com', phone: '713 555 0101', message: 'Gear quote request — IWA-M12 × 6', attribution });
  ok('a gear quote request is stored as a lead (kind gear, company, UTM, visitor) and emailed', lead.status === 200 && contacts.length === 1 && contacts[0].kind === 'gear' && contacts[0].company === 'HCSO' && contacts[0].utm_source === 'instagram' && contacts[0].visitor === 'v_abc' && contacts[0].emailed === 1, JSON.stringify(contacts[0] || {}).slice(0, 240));
  ok('… and the beacon logs a gear_request event for the same visitor', events.some(e => e.action === 'gear_request' && e.visitor === 'v_abc' && e.utm_source === 'instagram'), JSON.stringify(events));
  const noMail = await worker.fetch(new Request('https://api.test/contact', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://mastsolutions.com' }, body: JSON.stringify({ name: 'No Mail', email: 'nomail@example.com', message: 'hello there' }) }), { ...env, RESEND_API_KEY: '' }, ctx);
  ok('without Resend the lead is still stored (503 to the visitor, emailed = 0)', noMail.status === 503 && contacts.some(c => c.email === 'nomail@example.com' && c.emailed === 0));

  // Beacon: known actions only.
  const ev = await post('/event', { action: 'open_class', sku: 'MAST-HG-FUND', label: 'Handgun Fundamentals', attribution });
  const bad = await post('/event', { action: 'drop table', attribution });
  ok('POST /event stores a known action and rejects an unknown one', ev.status === 200 && bad.status === 400 && events.some(e => e.action === 'open_class' && e.sku === 'MAST-HG-FUND'));

  // Newsletter: consent is the tick.
  const noConsent = await post('/subscribe', { email: 'news@example.com', name: 'Newsy Person' });
  const sub = await post('/subscribe', { email: 'News@Example.com', name: 'Newsy Person', consent: true, source: 'footer', attribution });
  const subLead = contacts.find(c => c.kind === 'subscribe');
  ok('POST /subscribe needs consent:true, then stores the sign-up with opt-in and the consent wording', noConsent.status === 400 && sub.status === 200 && subLead && subLead.email === 'news@example.com' && subLead.newsletter_opt_in === 1 && /Unsubscribe any time/.test(subLead.consent_text), JSON.stringify(subLead || {}).slice(0, 200));
  ok('honeypot on /subscribe → 200 and nothing stored', (await post('/subscribe', { email: 'bot@example.com', consent: true, website: 'x' })).status === 200 && !contacts.some(c => c.email === 'bot@example.com'));

  // Registration carries attribution and Stripe metadata carries the UTM (so the order gets it).
  stripeCalls.length = 0;
  const good = goodReg();
  const regRes = await post('/register', { ...good, sku: 'MAST-HG-FUND', customer: { ...good.customer, name: 'Ann Lee', email: 'ann@example.com' }, newsletter_opt_in: true, attribution });
  const annReg = [...registrations.values()].find(r => r.customer_email === 'ann@example.com') || {};
  const sd = annReg.session_date || '2026-09-26';
  const dayAt = (k) => new Date(Date.parse(sd + 'T09:17:00Z') + k * 86400000);   // the class day plus k days, at cron time
  ok('registration stores utm_source / landing page / visitor, and Stripe metadata carries the UTM', regRes.status === 200 && annReg && annReg.utm_source === 'instagram' && annReg.landing_page === attribution.landing_page && annReg.visitor === 'v_abc' && stripeCalls[0] && stripeCalls[0].get('metadata[utm_source]') === 'instagram', 'status=' + regRes.status + ' ' + JSON.stringify(annReg || {}).slice(0, 120) + ' ' + (await regRes.clone().text()).slice(0, 120));

  // Pay it through the webhook: the order stores the UTM; Mailchimp is not configured, so nothing goes out.
  mailchimpCalls.length = 0;
  const paidEvent = { id: 'evt_crm_1', type: 'checkout.session.completed', data: { object: { id: 'cs_crm_1', mode: 'payment', amount_total: 22500, currency: 'usd', customer_email: 'ann@example.com', metadata: { kind: 'class_booking', registration_id: annReg.id, sku: 'MAST-HG-FUND', class_name: 'Handgun Fundamentals', qty: '1', session_date: sd, customer_name: 'Ann Lee', utm_source: 'instagram', utm_medium: 'social', utm_campaign: 'fall-dates', first_touch_at: '2026-09-01T12:00:00Z' } } } };
  const tsN = Math.floor(Date.now() / 1000); const sig = 't=' + tsN + ',v1=' + (await sign(JSON.stringify(paidEvent), tsN));
  const wh = await worker.fetch(new Request('https://api.test/webhook', { method: 'POST', headers: { 'stripe-signature': sig }, body: JSON.stringify(paidEvent) }), env, ctx);
  const annOrder = orderRows.find(o => o.stripe_session_id === 'cs_crm_1');
  ok('the paid order carries utm_source / campaign / first touch', wh.status === 200 && annOrder && annOrder.utm_source === 'instagram' && annOrder.utm_campaign === 'fall-dates' && annOrder.first_touch_at === '2026-09-01T12:00:00Z', JSON.stringify(annOrder || {}).slice(0, 200));
  ok('Mailchimp not configured → no call even though Ann opted in', mailchimpCalls.length === 0);

  // The CRM view.
  ok('/admin/crm without the key → 401', (await get('/admin/crm')).status === 401);
  const snap = await (await get('/admin/crm', 'super-secret-admin-key')).json();
  const ann = (snap.customers || []).find(p => p.email === 'ann@example.com');
  const leeP = (snap.customers || []).find(p => p.email === 'lee@example.com');
  ok('profiles merge orders, registrations and leads by email; Ann is opted in, fundamentals-only, from instagram', ann && ann.opt_in && ann.spend_cents === 22500 && ann.classes.length === 1 && ann.flags.includes('fundamentals_only') && ann.utm_source === 'instagram', JSON.stringify(ann || {}).slice(0, 300));
  ok('Lee is a lead (asked for gear, never booked), agency, no opt-in', leeP && leeP.flags.includes('lead') && leeP.flags.includes('gear') && leeP.segment === 'agency' && !leeP.opt_in, JSON.stringify(leeP || {}).slice(0, 200));
  ok('stats: leads by kind, revenue by source, funnel from the beacon', snap.stats.leads.by_kind.some(b => b.key === 'gear') && snap.stats.revenue_by_source_cents.some(b => b.key === 'instagram' && b.value === 22500) && snap.stats.funnel.opened_class >= 1 && snap.stats.funnel.started_registration >= 1, JSON.stringify(snap.stats).slice(0, 300));
  const summary = await (await get('/admin/crm?view=summary', 'super-secret-admin-key')).json();
  ok('view=summary carries counts only — no customers, no leads', summary.stats && !summary.customers && !summary.leads);
  const csv = await (await get('/admin/audience.csv', 'super-secret-admin-key')).text();
  ok('audience CSV holds the opted-in only (Ann via registration, Newsy via subscribe; not Lee)', /ann@example.com/.test(csv) && /news@example.com/.test(csv) && !/lee@example.com/.test(csv) && /via_registration/.test(csv), csv.slice(0, 300));
  ok('eligibility answers never appear in the CRM payload or the CSV', !/us_citizen|felony/i.test(JSON.stringify(snap) + csv));

  // Mailchimp, once configured: sync pushes the opted-in only, with merge fields and tags, to the member's MD5 id.
  const envMc = { ...env, MAILCHIMP_API_KEY: 'abc123-us21', MAILCHIMP_AUDIENCE_ID: 'list9' };
  const sync = await (await worker.fetch(new Request('https://api.test/admin/sync', { method: 'POST', headers: { 'X-Admin-Key': 'super-secret-admin-key' } }), envMc, ctx)).json();
  const annCall = mailchimpCalls.find(c => c.url.endsWith('/' + createHash('md5').update('ann@example.com').digest('hex')));
  ok('sync → PUT per opted-in profile at us21.api.mailchimp.com/3.0/lists/list9/members/<md5>, FNAME/LNAME/SEGMENT/LASTCLASS + tags, none for Lee', sync.configured && sync.ok === 2 && annCall && /us21\.api\.mailchimp\.com\/3\.0\/lists\/list9\/members\//.test(annCall.url) && annCall.method === 'PUT' && annCall.body.merge_fields.FNAME === 'Ann' && annCall.body.merge_fields.LASTCLASS === 'Handgun Fundamentals' && annCall.body.tags.includes('MAST-HG-FUND') && !mailchimpCalls.some(c => c.url.endsWith('/' + createHash('md5').update('lee@example.com').digest('hex'))), JSON.stringify(sync) + ' ' + JSON.stringify(annCall || {}).slice(0, 200));
  mailchimpCalls.length = 0;
  ok('syncOnPayment: opted-in → one Mailchimp upsert; not opted-in → lists skipped', (await mailchimpOnPayment(envMc, { ...annReg, newsletter_opt_in: 1 }, { customer_email: 'ann@example.com', amount_total: 22500 })).mailchimp.ok && mailchimpCalls.length === 1 && (await mailchimpOnPayment(envMc, { ...annReg, newsletter_opt_in: 0 }, {})).lists === 'not_opted_in' && mailchimpCalls.length === 1);
  ok('md5 matches Node for the member id', md5('Ann@Example.com') === createHash('md5').update('Ann@Example.com').digest('hex'));
  // Brevo (opted-in only) and HubSpot (every profile: a CRM record is a business record; consent is a separate matter)
  hubspotCalls.length = 0; brevoCalls.length = 0; mailchimpCalls.length = 0;
  const envAll = { ...env, MAILCHIMP_API_KEY: 'abc123-us21', MAILCHIMP_AUDIENCE_ID: 'list9', BREVO_API_KEY: 'xkeysib-test', BREVO_LIST_ID: '7', HUBSPOT_TOKEN: 'pat-na1-test' };
  const syncAll = await (await worker.fetch(new Request('https://api.test/admin/sync', { method: 'POST', headers: { 'X-Admin-Key': 'super-secret-admin-key' } }), envAll, ctx)).json();
  const hsEmails = hubspotCalls.map(c => c.body.inputs[0].id), brEmails = brevoCalls.map(c => c.body.email);
  const leeHs = hubspotCalls.find(c => c.body.inputs[0].id === 'lee@example.com'), annHs = hubspotCalls.find(c => c.body.inputs[0].id === 'ann@example.com');
  ok('sync with all three: HubSpot gets every profile (Lee as lead, Ann as customer), Brevo and Mailchimp only the opted-in', syncAll.configured.hubspot && syncAll.hubspot.ok === syncAll.hubspot.attempted && hsEmails.includes('lee@example.com') && leeHs.body.inputs[0].properties.lifecyclestage === 'lead' && annHs.body.inputs[0].properties.lifecyclestage === 'customer' && annHs.body.inputs[0].idProperty === 'email' && brEmails.includes('ann@example.com') && brEmails.includes('news@example.com') && !brEmails.includes('lee@example.com') && brevoCalls[0].body.listIds[0] === 7 && brevoCalls[0].key === 'xkeysib-test' && leeHs.auth === 'Bearer pat-na1-test', JSON.stringify(syncAll) + ' hs=' + hsEmails.join(',') + ' br=' + brEmails.join(','));
  hubspotCalls.length = 0; brevoCalls.length = 0;
  const leadNow = await worker.fetch(new Request('https://api.test/contact', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://mastsolutions.com' }, body: JSON.stringify({ name: 'Cap Tain', email: 'cap@example.com', company: 'Port PD', message: 'Team block for eight.', request_type: 'private' }) }), envAll, ctx);
  ok('a new contact-form lead reaches HubSpot at once (lifecyclestage lead, company kept) and no marketing list', leadNow.status === 200 && hubspotCalls.length === 1 && hubspotCalls[0].body.inputs[0].properties.company === 'Port PD' && hubspotCalls[0].body.inputs[0].properties.lifecyclestage === 'lead' && brevoCalls.length === 0, JSON.stringify(hubspotCalls[0] || {}).slice(0, 200));
  hubspotCalls.length = 0; brevoCalls.length = 0;
  const subNow = await worker.fetch(new Request('https://api.test/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://mastsolutions.com' }, body: JSON.stringify({ email: 'sub2@example.com', name: 'Sub Two', consent: true, source: 'footer' }) }), envAll, ctx);
  const subBody = await subNow.json();
  ok('a consented sign-up reaches HubSpot, Brevo and Mailchimp; the response names what synced', subNow.status === 200 && subBody.synced.hubspot === 'synced' && subBody.synced.brevo === 'synced' && subBody.synced.mailchimp === 'synced' && brevoCalls.length === 1 && hubspotCalls.length === 1, JSON.stringify(subBody));

  // Journeys: T−7 / T−1 / T+1 from the daily cron, one per participant, class and kind. Only Ann's registration stays paid here.
  for (const [id, r] of [...registrations]) if (r.customer_email !== 'ann@example.com' && (r.status === 'paid' || r.status === 'completed')) r.status = 'completed_elsewhere';
  emails.length = 0; emailLog.length = 0;
  const sendSpy = (m) => { emails.push(m); return Promise.resolve(); };
  const now7 = dayAt(-7);   // Ann's class is seven days out
  // The range settings are Worker secrets; here they are stand-ins. The PDF is rendered from them (src/directions.js).
  const envJ = { ...env, RANGE_ADDRESS: '1 Range Road, Somewhere, TX 77000', RANGE_COORDS: '30.1000, -95.2000', RANGE_DIRECTIONS: '# From Houston\n- I-45 north to the county road\n- Left at the second gate; the sign says MAST\n\nGate code comes by text the day before. The last 2 miles are gravel — allow 15 minutes.' };
  let j = await runJourneys(envJ, { send: sendSpy, now: now7, catalog: [{ sku: 'MAST-HG-OP', name: 'Handgun Operator', price_cents: 45000 }] });
  const t7 = emails[0] || {};
  ok('T−7: one reminder to the participant, no BCC, range address in it', j.t7.sent === 1 && emails.length === 1 && t7.to[0] === 'ann@example.com' && t7.bcc === false && /One week out/.test(t7.subject) && /Range: 1 Range Road/.test(t7.text), JSON.stringify(j) + ' ' + JSON.stringify(t7).slice(0, 160));
  ok("T−7 is the owner's text: PARTICIPANTS list (1. Ann …), BRING line with the restaurants, both phone numbers, Details matter", /PARTICIPANTS\n1\. Ann /.test(t7.text) && /BRING: eye and ear protection, a hat, closed-toe boots, water, and a packed lunch, or eat at restaurants 20 minutes away/.test(t7.text) && /\(281\) 654-8100, 281-415-1023/.test(t7.text) && /Weather: we train in it; dress for the forecast; only lightning stops a range\./.test(t7.text) && /MAST Solutions · Details matter\.$/.test(t7.text) && !/Seats:/.test(t7.text), t7.text);
  ok('T−7 carries the range-directions PDF (one attachment, a real PDF) and says so', Array.isArray(t7.attachments) && t7.attachments.length === 1 && t7.attachments[0].filename === DIRECTIONS_FILENAME && /^JVBERi0/.test(t7.attachments[0].content) && /Directions: the PDF attached to this email/.test(t7.text), JSON.stringify((t7.attachments || []).map(a => ({ f: a.filename, n: (a.content || '').length }))));
  const { PDFDocument: PDFDoc } = await import('pdf-lib');
  const dirPdf = await PDFDoc.load(await directionsPdf(envJ));
  const dirSize = dirPdf.getPage(0).getSize();
  ok('the PDF is one US Letter page, titled, with the address and the Markdown rendered (a long text with an en dash and a non-Latin glyph still renders)', dirPdf.getPageCount() === 1 && dirSize.width === 612 && dirSize.height === 792 && dirPdf.getTitle() === 'MAST Solutions · Range directions' && (await PDFDoc.load(await directionsPdf({ ...envJ, RANGE_DIRECTIONS: ('Проверка – ' + 'a long line of directions that must wrap onto more than one line without losing a word ').repeat(60) }))).getPageCount() >= 2, JSON.stringify(dirSize) + ' pages=' + dirPdf.getPageCount());
  ok('two seats → seat 2 reads "name pending" with the ask; one seat → one line', participantLines({ ...annReg, qty: 2 }).length === 2 && /^2\. Seat 2: name pending — reply with the name and email/.test(participantLines({ ...annReg, qty: 2 })[1]) && participantLines(annReg).length === 1);
  ok('without RANGE_* on the Worker: no attachment, and the text points at the booking confirmation', (await directionsAttachment({})).length === 0 && /Directions: in your booking confirmation\./.test(journeyText('t7', annReg, { REPLY_TO: 'x@example.com' }, []).text) && /Range: the address is in your booking confirmation\./.test(journeyText('t7', annReg, {}, []).text));
  j = await runJourneys(envJ, { send: sendSpy, now: now7, catalog: [] });
  ok('the same day again → nothing sent twice (email_log)', j.t7.sent === 0 && j.t7.skipped === 1 && emails.length === 1);
  j = await runJourneys(envJ, { send: sendSpy, now: dayAt(-1), catalog: [] });
  ok('T−1: the final reminder, with the PDF, both numbers on the running-late line and the participant list', j.t1.sent === 1 && /Tomorrow/.test(emails[1].subject) && emails[1].attachments && emails[1].attachments[0].filename === DIRECTIONS_FILENAME && /Running late or unable to make it\? Call \(281\) 654-8100 or 281-415-1023 before the start; the refund and transfer terms/.test(emails[1].text) && /PARTICIPANTS\n1\. Ann /.test(emails[1].text), (emails[1] || {}).text);
  j = await runJourneys(env, { send: sendSpy, now: dayAt(1), catalog: [{ sku: 'MAST-HG-OP', name: 'Handgun Operator', price_cents: 45000 }] });
  ok('T+1: thank-you with the review ask, the next course (Handgun Operator after Handgun Fundamentals), the Instagram link, no attachment', j.thanks.sent === 1 && /Thank you/.test(emails[2].subject) && /Handgun Operator/.test(emails[2].text) && /instagram\.com\/atlasglinn_mastsolutions/.test(emails[2].text) && /quote it|REVIEW/i.test(emails[2].text) && emails[2].attachments === undefined, (emails[2] || {}).text);
  const failing = async () => { throw new Error('Resend 500: down'); };
  emailLog.length = 0;
  j = await runJourneys(env, { send: failing, now: now7, catalog: [] });
  ok('a failed send is logged as failed, not counted as sent', j.t7.failed === 1 && emailLog[0].status === 'failed');
  ok('nextCourse: FUND → OP, P1 → P2, P2 → Team P2, unknown → null', nextCourse('MAST-CAR-FUND', [{ sku: 'MAST-CAR-OP', name: 'Carbine Operator', price_cents: 45000 }]).sku === 'MAST-CAR-OP' && nextCourse('MAST-SF-P1', [{ sku: 'MAST-SF-P2', name: 'SF P2', price_cents: 95000 }]).sku === 'MAST-SF-P2' && nextCourse('MAST-NVG-P2', [{ sku: 'MAST-TEAM-P2', name: 'Team P2', price_cents: 47500 }]).sku === 'MAST-TEAM-P2' && nextCourse('MAST-GEAR', []) === null);
  const crmJson = await (await worker.fetch(new Request('https://api.test/admin/crm', { headers: { 'X-Admin-Key': 'super-secret-admin-key' } }), env, ctx)).json();
  ok('the CRM reports the journeys log', crmJson.stats.journeys.t7 && crmJson.stats.journeys.t7.failed === 1);
  const page = await get('/admin');
  ok('GET /admin serves the staff page, noindex, no-store', page.status === 200 && /text\/html/.test(page.headers.get('Content-Type')) && page.headers.get('X-Robots-Tag') === 'noindex, nofollow' && /MAST · CRM/.test(await page.text()));

  // Sealed range directions (src/sealed.js): the Worker's RSA key pair lives in D1, the public half is served, the sealed file
  // on main is decrypted at send time and preferred over the secrets render. The plaintext PDF is never in git.
  const { seal, unseal, _resetSealedMemo } = await import('./src/sealed.js');
  const { _resetDirectionsMemo } = await import('./src/directions.js');
  const hget = (p) => worker.fetch(new Request('https://api.test' + p, { headers: { Origin: 'https://mastsolutions.com' } }), env, ctx);
  _resetSealedMemo(); _resetDirectionsMemo(); sealedJson = null;
  const k1 = await (await hget('/directions-key')).json();
  const k2 = await (await hget('/directions-key')).json();
  ok('GET /directions-key publishes an RSA-OAEP public key (JWK, no private part) with a stable key_id kept in D1', k1.public_jwk && k1.public_jwk.kty === 'RSA' && k1.public_jwk.n && !k1.public_jwk.d && k1.key_id.length === 16 && k2.key_id === k1.key_id && workerKeys.size === 1 && !JSON.stringify(k1).includes('"d"'), JSON.stringify(k1).slice(0, 120));
  const realPdf = await directionsPdf({ RANGE_ADDRESS: 'The real PDF stands in here', RANGE_DIRECTIONS: '# Real route' });
  sealedJson = await seal(k1.public_jwk, realPdf, { filename: 'MAST-Range-Directions.pdf' });
  ok('the sealed file carries ciphertext only: no plaintext, the AES key wrapped to the Worker key, the sha256 and size of the PDF', sealedJson.key_id === k1.key_id && !JSON.stringify(sealedJson).includes('stands in here') && !Buffer.from(sealedJson.ciphertext, 'base64').toString('latin1').includes('%PDF') && sealedJson.wrapped_key.length > 300 && sealedJson.bytes === realPdf.length && /^[0-9a-f]{64}$/.test(sealedJson.sha256), JSON.stringify(Object.keys(sealedJson)));
  _resetSealedMemo(); _resetDirectionsMemo();
  const health = await (await hget('/health')).json();
  const att = await directionsAttachment(envJ);
  ok('/health reports directions: sealed, and the attachment IS the sealed PDF (byte-identical), preferred over the secrets render', health.directions === 'sealed' && health.crm === true && att.length === 1 && Buffer.compare(Buffer.from(att[0].content, 'base64'), Buffer.from(realPdf)) === 0, JSON.stringify(health) + ' att=' + att.length);
  const priv = JSON.parse(workerKeys.get('directions').private_jwk);
  ok('unseal with the D1 private key round-trips; a tampered ciphertext is rejected', Buffer.compare(Buffer.from(await unseal(priv, sealedJson)), Buffer.from(realPdf)) === 0 && await unseal(priv, { ...sealedJson, ciphertext: sealedJson.ciphertext.slice(0, -8) + 'AAAAAAAA' }).then(() => false, () => true));
  sealedJson = { ...sealedJson, key_id: 'deadbeefdeadbeef' };
  _resetSealedMemo(); _resetDirectionsMemo();
  const h2 = await (await hget('/health')).json();
  const att2 = await directionsAttachment(envJ);
  ok('a sealed file for another key: /health says sealed-key-mismatch, and the secrets render is the fallback (never silence)', h2.directions === 'sealed-key-mismatch' && att2.length === 1 && Buffer.compare(Buffer.from(att2[0].content, 'base64'), Buffer.from(realPdf)) !== 0, JSON.stringify(h2));
  sealedJson = null; _resetSealedMemo(); _resetDirectionsMemo();
  ok('no sealed file (404) and no secrets: /health says none and nothing is attached', (await (await hget('/health')).json()).directions === 'none' && (await directionsAttachment({ DB: env.DB })).length === 0);
  sealedJson = await seal(k1.public_jwk, realPdf); _resetSealedMemo(); _resetDirectionsMemo(); emails.length = 0; emailLog.length = 0;
  j = await runJourneys(envJ, { send: sendSpy, now: now7, catalog: [] });
  ok('T−7 attaches the sealed (real) PDF when it exists', j.t7.sent === 1 && emails[0].attachments && emails[0].attachments[0].filename === 'MAST-Range-Directions.pdf' && Buffer.compare(Buffer.from(emails[0].attachments[0].content, 'base64'), Buffer.from(realPdf)) === 0);
  sealedJson = null; _resetSealedMemo(); _resetDirectionsMemo();
}

console.log('\n── Monday CRM digest (owner, 2026-09-08: "weekly CRM Emails to matthew@atlasglinn.com + Matthew@mastsolutions.com") ──');
{
  const { weeklyDigestText, weeklyDigestPeriod } = await import('./src/crm.js');
  const now = new Date('2026-09-07T09:17:00Z');   // a Monday, the hour the daily cron fires
  const day = (n) => new Date(now.getTime() - n * 86400000).toISOString();
  const fixture = {
    contacts: [
      { created_at: day(1), kind: 'gear', request_type: 'gear', name: 'Lee Quinn', email: 'lee@example.com', emailed: 1 },
      { created_at: day(3), kind: 'gear', request_type: 'gear', name: 'Sam Ortiz', email: 'sam@example.com', emailed: 0 },
      { created_at: day(5), kind: 'contact', request_type: 'private', name: 'Pat Rivera', email: 'pat@example.com', emailed: 1 },
      { created_at: day(2), kind: 'subscribe', email: 'news@example.com', emailed: 0 },      // a sign-up is not a lead
      { created_at: day(2), kind: 'smoke', request_type: 'smoke', email: 'runner@example.com', emailed: 0 },   // nor is the runner's probe
      { created_at: day(9), kind: 'gear', request_type: 'gear', name: 'Old Gear', email: 'old@example.com', emailed: 1 },
      { created_at: '2026-08-01T00:00:00Z', kind: 'contact', request_type: 'private', name: 'Dana Webb', email: 'dana@example.com', emailed: 0 },
    ],
    orders: [
      { created_at: day(1), status: 'paid', sku: 'MAST-DA', item_name: 'Direct Action', qty: 2, amount_total: 139000 },
      { created_at: day(4), status: 'paid', sku: 'MAST-HG-FUND', item_name: 'Handgun Fundamentals', qty: 1, amount_total: 22500 },
      { created_at: day(2), status: 'refunded', sku: 'MAST-DA', item_name: 'Direct Action', qty: 1, amount_total: 50000 },
      { created_at: day(10), status: 'paid', sku: 'MAST-DA', item_name: 'Direct Action', qty: 1, amount_total: 69500 },
      { created_at: day(3), status: 'paid', kind: 'membership', sku: 'MAST-MEM-RED', item_name: 'Red Team', qty: 1, amount_total: 25000 },
    ],
    registrations: [{ created_at: day(1) }, { created_at: day(4) }, { created_at: day(9) }],
    accounts: [{ created_at: day(2), verified_at: day(2) }, { created_at: day(3) }, { created_at: day(8), verified_at: day(8) }, { created_at: day(11), verified_at: day(11) },
               { created_at: day(9), verified_at: day(1) }],   // signed up last week, verified this one
  };
  const text = weeklyDigestText(fixture, now);
  ok('the period is the seven days ending at the run, with its ISO week', weeklyDigestPeriod(now) === '2026-08-31 → 2026-09-07 · 2026-W36', weeklyDigestPeriod(now));
  ok('new leads count this week against last, and sign-ups and smoke probes are not leads', /New leads:\s+3\s+\(prev 1\)/.test(text), text);
  ok('leads break down by request type with last week beside them', /\n {2}gear\s+2\s+\(prev 1\)/.test(text) && /\n {2}private\s+1\s+\(prev 0\)/.test(text), text);
  ok('accounts count in the week they verified, not the week they signed up (and the unverified one the purge deletes counts in neither), registrations carry their own week-on-week',
     /Accounts verified:\s+2\s+\(prev 2\)/.test(text) && !/New verified accounts:/.test(text) && !/New accounts:/.test(text) && /Registrations:\s+2\s+\(prev 1\)/.test(text), text);
  ok('revenue is the paid orders only, membership included, formatted as dollars', /Revenue:\s+\$1,865\.00\s+\(prev \$695\.00\)/.test(text) && !text.includes('$500.00'), text);
  ok('paid orders and seats counted, the refunded order excluded', /Paid orders:\s+3\s+\(prev 1\)/.test(text) && /Seats sold:\s+3\s+\(prev 1\)/.test(text), text);
  ok('a membership is revenue and its own row carrying its own cash, never a seat and never a class booked', /Memberships:\s+1 · \$250\.00\s+\(prev 0 · \$0\.00\)/.test(text) && !text.includes('Red Team'), text);
  ok('top classes booked list seats and revenue per class', /Direct Action\s+2 seats\s+\$1,390\.00/.test(text) && /Handgun Fundamentals\s+1 seat\s+\$225\.00/.test(text), text);
  ok('the open list is titled for what the flag measures — the office inbox, not a reply — oldest first',
     /OFFICE NOT NOTIFIED — 2 open, oldest first/.test(text) && !/emailed back/i.test(text) && text.indexOf('Dana Webb') < text.indexOf('Sam Ortiz'), text);
  ok('the summary row names how many of this week never reached the office', /Office not notified:\s+1 of 3 new/.test(text), text);
  {
    const openLines = text.split('\n').filter((l) => /^ {2}\d{4}-\d\d-\d\d {2}/.test(l));
    ok('the type column lines up whatever the address is (P2-I)', openLines.length === 2 && new Set(openLines.map((l) => l.indexOf('('))).size === 1, JSON.stringify(openLines));
  }
  ok('without a snapshot there is no invented LIFETIME block', !text.includes('LIFETIME'));
  const withStats = weeklyDigestText({ ...fixture, stats: {
    profiles: 88, leads: { total: 41, last_30_days: 12, unemailed: 2 }, subscribers: 17,
    accounts: { total: 22, verified: 19 }, registrations: { total: 31, by_status: { paid: 24, pending: 4, abandoned: 3 } },
    orders: { total: 26, paid: 24 }, revenue_cents: { total: 1668000, last_30_days: 208500 }, seats_upcoming: [{ key: '2026-10-10', value: 6 }],
  } }, now);
  ok('the lifetime leads row names the flag for what it is', /Leads:\s+41\s+\(30 days: 12, office not notified: 2\)/.test(withStats), withStats);
  ok('with the snapshot the lifetime totals are appended, money formatted the same way', /LIFETIME/.test(withStats) && /Revenue:\s+\$16,680\.00\s+\(30 days: \$2,085\.00\)/.test(withStats) && /Registrations:\s+31\s+\(paid 24 · pending 4 · abandoned 3\)/.test(withStats) && /Seats upcoming:\s+2026-10-10: 6/.test(withStats), withStats);

  // Gating: the daily cron carries the digest — Monday, or the Tuesday/Wednesday retry — once per ISO week, never at the purge's expense.
  const runCron = async (event, en) => { const queued = []; await worker.scheduled(event, en, { waitUntil: (p) => queued.push(p) }); await Promise.all(queued); };
  const digestEnv = { ...env, CRM_DIGEST_TO: 'matthew@atlasglinn.com,matthew@mastsolutions.com' };
  const monday = Date.UTC(2026, 8, 7, 9, 17), tuesday = Date.UTC(2026, 8, 8, 9, 17), wednesday = Date.UTC(2026, 8, 9, 9, 17), thursday = Date.UTC(2026, 8, 10, 9, 17);
  const stale = (id) => { registrations.set(id, { id, status: 'pending', created_at: '2020-01-01T00:00:00Z' }); return id; };
  const digestRows = () => emailLog.filter((l) => l.kind === 'digest');
  emails.length = 0; emailLog.length = 0;

  stale('reg_thu');
  await runCron({ scheduledTime: thursday }, digestEnv);
  ok('a Thursday cron sends no digest even with the week unlogged, and still abandons the stale registration', emails.length === 0 && registrations.get('reg_thu').status === 'abandoned', 'emails=' + emails.length);
  stale('reg_none');
  await runCron({}, digestEnv);
  ok('scheduled() with no scheduledTime sends no digest and still runs the purge', emails.length === 0 && registrations.get('reg_none').status === 'abandoned', 'emails=' + emails.length);

  stale('reg_mon');
  await runCron({ scheduledTime: monday }, digestEnv);
  ok('the Monday cron sends exactly one digest to both of his inboxes, and the purge still ran', emails.length === 1 && emails[0].to.join(',') === 'matthew@atlasglinn.com,matthew@mastsolutions.com' && registrations.get('reg_mon').status === 'abandoned', JSON.stringify(emails.map((e) => e.to)) + ' emails=' + emails.length);
  ok('the subject names the week it covers', /^MAST CRM weekly — \d{4}-\d\d-\d\d → \d{4}-\d\d-\d\d · \d{4}-W\d\d$/.test(emails[0].subject), emails[0].subject);
  ok('the digest is not also blind-copied to the same two addresses', !emails[0].bcc, JSON.stringify(emails[0].bcc));
  ok('the sent body is the digest, sections and lifetime totals', /^MAST CRM WEEKLY/.test(emails[0].text) && /LAST 7 DAYS/.test(emails[0].text) && /LIFETIME/.test(emails[0].text), emails[0].text.slice(0, 200));
  ok('the week is claimed in email_log before the send — one row, ISO week, kind digest, keyed on the week and not on the recipients — and flipped to sent after', digestRows().length === 1 && digestRows()[0].ref === '2026-W36' && digestRows()[0].status === 'sent' && digestRows()[0].email === 'crm-digest', JSON.stringify(digestRows()));

  await runCron({ scheduledTime: monday }, digestEnv);
  ok('a second Monday fire in the same week mails nothing — one row, one email', emails.length === 1 && digestRows().length === 1, 'emails=' + emails.length);
  await runCron({ scheduledTime: tuesday }, digestEnv);
  ok('the Tuesday slot is a no-op once that week has gone out', emails.length === 1 && digestRows().length === 1, 'emails=' + emails.length);

  // A Resend outage on Monday used to cost the week its digest: nothing is claimed, so Tuesday carries it.
  emails.length = 0; emailLog.length = 0;
  resendStatus = 500;
  stale('reg_mon2');
  await runCron({ scheduledTime: monday }, digestEnv);
  ok('a Monday Resend 500 mails nothing, claims no week, and still abandons the stale registration', emails.length === 0 && digestRows().length === 0 && registrations.get('reg_mon2').status === 'abandoned', 'emails=' + emails.length);
  resendStatus = 200;
  stale('reg_tue2');
  await runCron({ scheduledTime: tuesday }, digestEnv);
  ok('the Tuesday cron then sends the week that failed — exactly one — and purged on both days', emails.length === 1 && digestRows().length === 1 && registrations.get('reg_tue2').status === 'abandoned', 'emails=' + emails.length);

  emails.length = 0; emailLog.length = 0;
  await runCron({ scheduledTime: monday }, { ...digestEnv, JOURNEYS_ENABLED: '1' });
  ok('a Monday with the journeys switched on still sends exactly one digest', emails.filter((e) => /^MAST CRM weekly/.test(e.subject)).length === 1 && digestRows().length === 1, JSON.stringify(emails.map((e) => e.subject)));

  // Wednesday is the last retry slot: nothing to do after a Monday that went out, the week itself after a Monday and a Tuesday that did not.
  emails.length = 0; emailLog.length = 0;
  stale('reg_wed1');
  await runCron({ scheduledTime: monday }, digestEnv);
  await runCron({ scheduledTime: wednesday }, digestEnv);
  ok('the Wednesday slot is a no-op once the Monday digest has gone out', emails.length === 1 && digestRows().length === 1 && digestRows()[0].status === 'sent' && registrations.get('reg_wed1').status === 'abandoned', 'emails=' + emails.length);

  emails.length = 0; emailLog.length = 0;
  resendStatus = 500;
  await runCron({ scheduledTime: monday }, digestEnv);
  await runCron({ scheduledTime: tuesday }, digestEnv);
  ok('a Monday and a Tuesday both refused by Resend mail nothing and leave no claim behind', emails.length === 0 && digestRows().length === 0, 'emails=' + emails.length + ' rows=' + digestRows().length);
  resendStatus = 200;
  stale('reg_wed2');
  await runCron({ scheduledTime: wednesday }, digestEnv);
  ok('the Wednesday cron then carries the week both earlier slots lost — exactly one, and purged on all three days', emails.length === 1 && digestRows().length === 1 && digestRows()[0].status === 'sent' && registrations.get('reg_wed2').status === 'abandoned', 'emails=' + emails.length);

  // The claim keys on the week, not on the recipients: a reordered CRM_DIGEST_TO used to read as an unclaimed week.
  emails.length = 0; emailLog.length = 0;
  await runCron({ scheduledTime: monday }, digestEnv);
  await runCron({ scheduledTime: tuesday }, { ...digestEnv, CRM_DIGEST_TO: 'matthew@mastsolutions.com,matthew@atlasglinn.com' });
  ok('the recipients reordered between Monday and Tuesday still send one digest for the week', emails.length === 1 && digestRows().length === 1, 'emails=' + emails.length);

  // Claim before send, fail closed: a dedupe read or a claim write that fails sends nothing — a fail-open read is how a week gets mailed twice.
  emails.length = 0; emailLog.length = 0;
  await runCron({ scheduledTime: monday }, digestEnv);
  const brokenLogRead = (sql) => (/FROM email_log/.test(sql) ? { bind: () => ({ first: async () => { throw new Error('D1_ERROR: reads are down'); } }) } : DB.prepare(sql));
  await runCron({ scheduledTime: tuesday }, { ...digestEnv, DB: { prepare: brokenLogRead } });
  ok('a Tuesday whose email_log read fails sends nothing — the week already mailed is not mailed a second time', emails.length === 1 && digestRows().length === 1, 'emails=' + emails.length);

  emails.length = 0; emailLog.length = 0;
  const brokenLogWrite = (sql) => (sql.startsWith('INSERT OR IGNORE INTO email_log') ? { bind: () => ({ run: async () => { throw new Error('D1_ERROR: writes are down'); } }) } : DB.prepare(sql));
  stale('reg_claim');
  await runCron({ scheduledTime: monday }, { ...digestEnv, DB: { prepare: brokenLogWrite } });
  ok('a Monday that cannot write its claim sends nothing and still runs the purge', emails.length === 0 && digestRows().length === 0 && registrations.get('reg_claim').status === 'abandoned', 'emails=' + emails.length);

  emails.length = 0; emailLog.length = 0;
  const noDbLogged = [];
  const realErrorNoDb = console.error;
  console.error = (...a) => { noDbLogged.push(a.map(String).join(' ')); };
  await runCron({ scheduledTime: monday }, { ...digestEnv, DB: undefined });
  console.error = realErrorNoDb;
  ok('without the D1 binding there is no week to claim, so the digest is skipped and said so rather than mailed unclaimed', emails.length === 0 && noDbLogged.some((l) => l.startsWith('[Digest] no DB binding')), JSON.stringify(noDbLogged.slice(-3)) + ' emails=' + emails.length);

  // A 'sending' row is a run in flight; one older than half an hour is a run that crashed, and the week is still owed.
  emails.length = 0; emailLog.length = 0;
  emailLog.push({ created_at: new Date(tuesday - 5 * 60000).toISOString(), email: 'crm-digest', ref: '2026-W36', kind: 'digest', status: 'sending' });
  await runCron({ scheduledTime: tuesday }, digestEnv);
  ok('a claim still in flight holds the week — the run beside it mails nothing', emails.length === 0 && digestRows().length === 1 && digestRows()[0].status === 'sending', 'emails=' + emails.length);

  emails.length = 0; emailLog.length = 0;
  emailLog.push({ created_at: new Date(monday).toISOString(), email: 'crm-digest', ref: '2026-W36', kind: 'digest', status: 'sending' });
  await runCron({ scheduledTime: tuesday }, digestEnv);
  ok('a claim left sending by a crashed run is taken over the next day and the week goes out once', emails.length === 1 && digestRows().length === 1 && digestRows()[0].status === 'sent', 'emails=' + emails.length + ' ' + JSON.stringify(digestRows()));

  // A D1 read that fails must reject, not mail a week of zeros (rowsStrict).
  emails.length = 0; emailLog.length = 0;
  const logged = [];
  const realError = console.error;
  console.error = (...a) => { logged.push(a.map(String).join(' ')); };
  const brokenRead = (st) => ({ bind: (...a) => brokenRead(st.bind(...a)), first: (...a) => st.first(...a), run: (...a) => st.run(...a), all: async () => { throw new Error('D1_ERROR: reads are down'); } });
  stale('reg_d1');
  await runCron({ scheduledTime: monday }, { ...digestEnv, DB: { prepare: (sql) => brokenRead(DB.prepare(sql)) } });
  console.error = realError;
  ok('a D1 read failure sends no digest, claims no week, is logged, and the retention purge still ran',
     emails.length === 0 && digestRows().length === 0 && logged.some((l) => l.startsWith('[Digest] failed')) && registrations.get('reg_d1').status === 'abandoned',
     JSON.stringify(logged.slice(-3)) + ' emails=' + emails.length);

  // The LIFETIME block comes from crmSnapshot, whose reads used to swallow their errors: real weekly numbers over a
  // lifetime of zeros went out as a normal-looking digest. Strict now — only the snapshot's own contacts SELECT breaks here.
  emails.length = 0; emailLog.length = 0;
  const snapLogged = [];
  console.error = (...a) => { snapLogged.push(a.map(String).join(' ')); };
  stale('reg_snap');
  await runCron({ scheduledTime: monday }, { ...digestEnv, DB: { prepare: (sql) => (/FROM contacts/.test(sql) && /landing_page/.test(sql) ? brokenRead(DB.prepare(sql)) : DB.prepare(sql)) } });
  console.error = realError;
  ok('a failed snapshot read sends no digest either — no LIFETIME of zeros — releases the week for the retry, and the purge still ran',
     emails.length === 0 && digestRows().length === 0 && snapLogged.some((l) => l.startsWith('[Digest] failed')) && registrations.get('reg_snap').status === 'abandoned',
     JSON.stringify(snapLogged.slice(-3)) + ' emails=' + emails.length);

  emails.length = 0; emailLog.length = 0;
  await runCron({ scheduledTime: monday }, { ...env, CRM_DIGEST_TO: '' });
  ok('without CRM_DIGEST_TO the Monday cron sends nothing (logged and skipped, like the review notice)', emails.length === 0, 'emails=' + emails.length);

  // The same text without the mailbox, behind the key that already guards /admin.
  const weekly = await worker.fetch(new Request('https://api.test/admin/crm?view=weekly', { headers: { 'X-Admin-Key': 'super-secret-admin-key' } }), env, ctx);
  const weeklyText = await weekly.text();
  ok('GET /admin/crm?view=weekly serves the digest as text/plain', weekly.status === 200 && /text\/plain/.test(weekly.headers.get('Content-Type')) && weeklyText.startsWith('MAST CRM WEEKLY') && /LIFETIME/.test(weeklyText), weekly.status + ' ' + weeklyText.slice(0, 120));
  ok('… and without the key it is 401, like the rest of /admin', (await worker.fetch(new Request('https://api.test/admin/crm?view=weekly'), env, ctx)).status === 401);
  ok('view=weekly did not change what view=summary answers', (await (await worker.fetch(new Request('https://api.test/admin/crm?view=summary', { headers: { 'X-Admin-Key': 'super-secret-admin-key' } }), env, ctx)).json()).stats.profiles >= 1);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

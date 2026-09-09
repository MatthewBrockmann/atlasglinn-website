import worker, { taxTimeoutMs, checkoutTimeoutMs, stripeApiVersion, setTaxReadGuard, TAX_SCHEMAS } from './src/worker.js';
import { runTaxShapeFuzz, taxShapeMutations } from './scripts/fuzz-tax-shapes.mjs';
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
// The operator scripts are shipped artifacts too, and nothing else in this suite would ever load one.
const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'scripts');
for (const f of readdirSync(SCRIPTS).filter(n => n.endsWith('.mjs') || n.endsWith('.js')).sort()) {
  let err = '';
  try { execFileSync(process.execPath, ['--check', path.join(SCRIPTS, f)], { stdio: ['ignore', 'ignore', 'pipe'] }); } catch (e) { err = String(e.stderr || e.message).split('\n').slice(0, 3).join(' | '); }
  ok(`parses: scripts/${f}`, !err, err);
}
const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoFile = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

// ── fake env ──
const stripeCalls = [];
const stripeCallHeaders = [];   // the headers each Checkout Session create went out with (the Stripe-Version pin)
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
const stripeTaxCalls = [];        // /v1/tax/settings and /v1/tax/registrations (POST /admin/tax/setup)
let fakeTaxSettings = { status: 'pending', head_office: null, defaults: {} };   // what GET /v1/tax/settings answers
let fakeTaxRegistrations = [];    // tax registration objects "in Stripe"
let taxFail = null;               // { on: <substring of the url>, method, status, body } to make one tax call refuse
                                  // `raw` instead of `body` sends the string verbatim, so a 200 that is not JSON at all
                                  // (a proxy's HTML error page) can be staged — JSON.stringify cannot produce one.
let fakeTaxHasMore = false;       // what GET /v1/tax/registrations says about a second page
// ROUND 8. The two bodies, VERBATIM — the stub above assembles a well-formed envelope, which is exactly the shape the
// fuzz has to be able to break. Set either of these and the corresponding GET answers it byte for byte.
let fakeTaxSettingsBody, fakeTaxListBody;
let taxHang = null;               // a promise that never settles: Stripe accepts the tax call and never answers it
let priceHang = null;             // the same, for /v1/prices: the membership Price call is the other customer-blocking Stripe call
let sessionFail = null;           // { n, status, body }: make the next n Checkout Session creations refuse (the tax-fallback tests).
                                  // `when(params)` narrows it to bodies that match — the double-fault probe needs a
                                  // Stripe that refuses ONLY automatic_tax bodies and accepts the tax-off retry.
let taxRegSeq = 0;
let fakeDefaultCard = null;         // what GET /v1/customers/<id>?expand=... returns as the default payment method
const fakePrices = [];         // prices "in Stripe" ({ id, lookup_key })
let stripeGate = null;         // a promise, or a function of the attempt number, held before the Checkout Session answers
                               // (the oversell race, and round 5's shared budget across the two Session attempts)
let customerHang = null;       // the same for /v1/customers: the Customer create and the saved-card read were raw fetch
                               // with no AbortController until round 5, on the customer's own blocking path
let sealedJson = null;         // what raw.githubusercontent.com serves for the sealed range directions (null = 404)
const workerKeys = new Map();  // worker_keys rows (the sealing key pair)
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes('raw.githubusercontent.com')) return sealedJson ? new Response(JSON.stringify(sealedJson), { status: 200 }) : new Response('404: Not Found', { status: 404 });
  if (u.includes('api.stripe.com/v1/prices')) {
    const method = (init && init.method) || 'GET';
    stripePriceCalls.push({ method, url: u, body: init && init.body ? new URLSearchParams(init.body) : null });
    if (priceHang) await priceHang;   // never settles: only the Worker's own clock can end this one

    if (method === 'GET') return new Response(JSON.stringify({ data: fakePrices.filter(p => u.includes(encodeURIComponent(p.lookup_key))) }), { status: 200 });
    const b = new URLSearchParams(init.body); const price = { id: 'price_new_' + b.get('lookup_key'), lookup_key: b.get('lookup_key') }; fakePrices.push(price);
    return new Response(JSON.stringify(price), { status: 200 });
  }
  if (u.includes('api.stripe.com/v1/customers')) {
    const method = (init && init.method) || 'GET';
    stripeCustomerCalls.push({ method, url: u, body: init && init.body ? new URLSearchParams(init.body) : null });
    if (customerHang) await customerHang;   // never settles: only the Worker's own clock can end this one
    if (method === 'POST' && /\/v1\/customers$/.test(u)) return new Response(JSON.stringify({ id: 'cus_test_1' }), { status: 200 });
    if (method === 'GET') return new Response(JSON.stringify({ id: 'cus_test_1', invoice_settings: { default_payment_method: fakeDefaultCard } }), { status: 200 });
    return new Response(JSON.stringify({ id: 'cus_test_1' }), { status: 200 });
  }
  if (u.includes('api.stripe.com/v1/setup_intents')) return new Response(JSON.stringify({ id: 'seti_1', payment_method: 'pm_saved_1' }), { status: 200 });
  if (u.includes('api.stripe.com/v1/tax/')) {
    const method = (init && init.method) || 'GET';
    const body = init && init.body ? new URLSearchParams(init.body) : null;
    stripeTaxCalls.push({ method, url: u, body, headers: (init && init.headers) || {} });
    if (taxHang) await taxHang;   // never settles: the Worker's own clock is the only thing that can end this call
    if (taxFail && u.includes(taxFail.on) && method === (taxFail.method || 'GET')) {
      return new Response(taxFail.raw !== undefined ? taxFail.raw : JSON.stringify(taxFail.body), { status: taxFail.status });
    }
    if (u.includes('/v1/tax/settings')) {
      if (method === 'POST') {
        fakeTaxSettings = {
          status: 'active',
          head_office: { address: { line1: body.get('head_office[address][line1]'), line2: body.get('head_office[address][line2]'), city: body.get('head_office[address][city]'), state: body.get('head_office[address][state]'), postal_code: body.get('head_office[address][postal_code]'), country: body.get('head_office[address][country]') } },
          defaults: { tax_behavior: body.get('defaults[tax_behavior]'), tax_code: body.get('defaults[tax_code]') },
        };
      }
      return new Response(JSON.stringify(fakeTaxSettingsBody === undefined ? fakeTaxSettings : fakeTaxSettingsBody), { status: 200 });
    }
    if (method === 'POST') {
      const reg = { id: 'taxreg_' + (++taxRegSeq), object: 'tax.registration', status: 'active', country: body.get('country'), country_options: { us: { type: body.get('country_options[us][type]'), state: body.get('country_options[us][state]') } } };
      fakeTaxRegistrations.push(reg);
      return new Response(JSON.stringify(reg), { status: 200 });
    }
    const want = new URL(u).searchParams.get('status');
    if (fakeTaxListBody !== undefined) return new Response(JSON.stringify(want === 'scheduled' ? { object: 'list', has_more: false, data: [] } : fakeTaxListBody), { status: 200 });
    return new Response(JSON.stringify({ object: 'list', has_more: fakeTaxHasMore, data: fakeTaxRegistrations.filter((r) => r.status === want) }), { status: 200 });
  }
  if (u.includes('api.stripe.com')) {
    stripeCalls.push(new URLSearchParams(init.body));
    stripeCallHeaders.push((init && init.headers) || {});
    // A function form so a test can hold ONE attempt open and not the other: the two Session attempts share a single
    // ceiling, which can only be measured by making the first slow and the second never answer.
    if (stripeGate) await (typeof stripeGate === 'function' ? stripeGate(stripeCalls.length) : stripeGate);
    // Stripe refusing a Checkout Session: the tax-fallback tests need the FIRST creation to fail and the retry to pass,
    // so the refusal is consumed rather than latched.
    if (sessionFail && sessionFail.n > 0 && (!sessionFail.when || sessionFail.when(stripeCalls[stripeCalls.length - 1]))) {
      sessionFail.n--; return new Response(JSON.stringify(sessionFail.body), { status: sessionFail.status || 400 });
    }
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
const rateLimits = new Map();      // rate_limits rows: key -> { key, window_start, count }
// What the fake D1 was ASKED to change, so "read-only" can be measured instead of asserted. taxRowWrites counts every
// INSERT/UPDATE/DELETE binding a tax: key (the 'tax:%' purge exemption pattern is not one); sqlDeletes counts DELETEs,
// which is how the five-minute tick is shown not to be running the daily retention work.
let taxRowWrites = 0, sqlDeletes = 0;
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
            if (sql.includes('FROM rate_limits')) { if (rateFail) throw new Error('D1_ERROR: rate_limits unavailable'); const row = rateLimits.get(args[0]); return row ? { ...row } : null; }
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
            if (sql.includes('FROM accounts WHERE email')) { for (const a of accounts.values()) if (a.email === args[0]) return { ...a }; return null; }
            if (sql.includes('FROM accounts WHERE id')) return accounts.has(args[0]) ? { ...accounts.get(args[0]) } : null;
            return null;
          },
          async run() {
            if (/^(INSERT|UPDATE|DELETE)/.test(sql) && args.some((a) => typeof a === 'string' && a.startsWith('tax:') && !a.endsWith('%'))) taxRowWrites++;
            if (/^DELETE FROM/.test(sql)) sqlDeletes++;
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
            if (sql.includes('rate_limits')) {
              if (rateFail) throw new Error('D1_ERROR: rate_limits unavailable');
              if (sql.startsWith('INSERT OR IGNORE INTO rate_limits')) { const [key, window_start, count] = args; if (rateLimits.has(key)) return { meta: { changes: 0 } }; rateLimits.set(key, { key, window_start, count }); return { meta: { changes: 1 } }; }
              // tax:last_run carries TWO independent things in one row — the heartbeat in window_start, the consecutive
              // tax_fallback streak in count — so each has a statement that touches only its own column. These three
              // must be matched BEFORE the generic upsert below, which writes both.
              if (sql.startsWith('INSERT INTO rate_limits') && sql.endsWith('ON CONFLICT(key) DO UPDATE SET window_start = excluded.window_start')) {
                const [key, window_start] = args; const r = rateLimits.get(key);
                if (r) r.window_start = window_start; else rateLimits.set(key, { key, window_start, count: 0 });
                return { meta: { changes: 1 } };
              }
              if (sql.startsWith('INSERT INTO rate_limits') && sql.endsWith('ON CONFLICT(key) DO UPDATE SET window_start = excluded.window_start, count = 0')) {
                const [key, window_start] = args; const r = rateLimits.get(key);
                if (r) { r.window_start = window_start; r.count = 0; } else rateLimits.set(key, { key, window_start, count: 0 });
                return { meta: { changes: 1 } };
              }
              if (sql.startsWith('INSERT INTO rate_limits') && sql.endsWith('ON CONFLICT(key) DO UPDATE SET count = rate_limits.count + 1')) {
                const [key, window_start] = args; const r = rateLimits.get(key);
                if (r) r.count = (Number(r.count) || 0) + 1; else rateLimits.set(key, { key, window_start, count: 1 });
                return { meta: { changes: 1 } };
              }
              if (sql.startsWith('UPDATE rate_limits SET count = 0 WHERE key = ? AND count <> 0')) {
                const r = rateLimits.get(args[0]); if (!r || !Number(r.count)) return { meta: { changes: 0 } };
                r.count = 0; return { meta: { changes: 1 } };
              }
              // The Stripe Tax state rows (tax:ready, tax:last_run) are written with an UPSERT: one statement whether the row is there or not.
              if (sql.startsWith('INSERT INTO rate_limits') && sql.includes('ON CONFLICT(key) DO UPDATE')) { const [key, window_start, count] = args; rateLimits.set(key, { key, window_start, count }); return { meta: { changes: 1 } }; }
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
              if (sql.startsWith('DELETE FROM rate_limits')) {
                // The daily purge, with the tax: state rows exempted (the second bind is the NOT LIKE pattern).
                const skip = args[1] ? new RegExp('^' + args[1].split('%').map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$') : null;
                let n = 0; for (const [k, r] of [...rateLimits]) if (r.window_start < args[0] && !(skip && skip.test(k))) { rateLimits.delete(k); n++; }
                return { meta: { changes: n } };
              }
              return { meta: { changes: 0 } };
            }
            if (sql.startsWith('UPDATE accounts SET failed_logins = failed_logins + 1')) { const row = accounts.get(args[0]); if (!row) return { meta: { changes: 0 } }; row.failed_logins = (row.failed_logins || 0) + 1; return { meta: { changes: 1 } }; }
            if (sql.startsWith('UPDATE accounts SET locked_until = ?') && sql.includes('locked_until IS NULL OR locked_until <')) { const [until, id, floor] = args; const row = accounts.get(id); if (!row || (row.locked_until && !(row.locked_until < floor))) return { meta: { changes: 0 } }; row.locked_until = until; return { meta: { changes: 1 } }; }
            if (/^(CREATE TABLE|CREATE INDEX|ALTER TABLE)/.test(sql)) return { meta: { changes: 0 } };
            if (sql.includes('INSERT INTO eligibility_outcomes')) { outcomes.push(args); if (onEligibilityInsert) { const f = onEligibilityInsert; onEligibilityInsert = null; f(); } return { meta: { last_row_id: outcomes.length, changes: 1 } }; }
            if (sql.includes('INSERT INTO eligibility_answers')) { answers.push(args); return { meta: { last_row_id: answers.length, changes: 1 } }; }
            if (sql.startsWith('INSERT INTO accounts')) { const cols = sql.slice(sql.indexOf('(') + 1, sql.indexOf(')')).split(',').map(c => c.trim()); const row = Object.fromEntries(cols.map((c, i) => [c, args[i]])); accounts.set(row.id, row); return { meta: { changes: 1 } }; }
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
// Stripe Tax has two halves and the tests have to be able to set both: what STRIPE answers (the account), and what the
// WORKER remembers about it (tax:ready / tax:lock / tax:last_run, rows in rate_limits). A test that only sets the first
// measures a cache.
const TX_LIVE = { id: 'taxreg_live', object: 'tax.registration', status: 'active', country: 'US', country_options: { us: { type: 'state_sales_tax', state: 'TX' } } };
const taxAccountReady = () => {
  fakeTaxSettings = { status: 'active', head_office: { address: { line1: '2450 Fondren Rd' } }, defaults: { tax_behavior: 'exclusive', tax_code: 'txcd_20030000' } };
  fakeTaxRegistrations.length = 0; fakeTaxRegistrations.push({ ...TX_LIVE }); fakeTaxHasMore = false;
};
const taxAccountBlank = () => { fakeTaxSettings = { status: 'pending', head_office: null, defaults: {} }; fakeTaxRegistrations.length = 0; fakeTaxHasMore = false; };
const forgetTaxState = () => { for (const k of [...rateLimits.keys()]) if (k.startsWith('tax:')) rateLimits.delete(k); };
// A checkout reads the readiness ROW and never Stripe, so a test about the BODY has to seed that row — exactly as the
// cron, the admin route or a background refresh would have left it. count: 1 ready · 0 measured not-ready · 2 unmeasured.
const cacheTaxReady = (count = 1, note = count === 1 ? 'active' : 'not_ready') =>
  rateLimits.set('tax:ready', { key: 'tax:ready', window_start: new Date().toISOString() + '|' + note, count });
const taxStateRow = (k) => rateLimits.get(k);
// The lock row outlives a run by a minute on purpose. A test that wants the NEXT refresh to be allowed expires it,
// which is the minute passing — not a shortcut around the ceiling it exists to impose.
const expireTaxWindow = () => { const r = rateLimits.get('tax:lock'); if (r) r.window_start = new Date(Date.now() - 1000).toISOString(); };
// R8-3: a registration create needs TWO witnesses to the absence — a prior validated, complete read that also found no
// US/TX state_sales_tax row, at least 30 s earlier — plus a create ledger with no attempt inside the last 30 days. So a
// test that is about what a create WRITES seeds that first witness exactly as a previous run would have left it, and a
// test that is about the RULE (the R8-3 block) does not, and watches the first run defer instead.
const witnessTaxAbsence = (ageMs = 45000) =>
  rateLimits.set('tax:registration_witness', { key: 'tax:registration_witness', window_start: new Date(Date.now() - ageMs).toISOString() + '|absent/rows_0', count: 1 });
const ageTaxState = (k, ms) => { const r = rateLimits.get(k); if (!r) return false; const [at, note] = String(r.window_start).split('|'); r.window_start = new Date(Date.parse(at) - ms).toISOString() + '|' + (note || ''); return true; };
// Everything the Worker logs during one call, so "one structured tax_skipped line" can be asserted rather than assumed.
const captureLogs = async (fn) => { const real = console.log; const lines = []; console.log = (...a) => lines.push(a.map(String).join(' ')); try { await fn(); } finally { console.log = real; } return lines; };
// Both streams, because the raw Stripe body a failed checkout prints goes to console.error, and "none of these shapes
// echo anywhere" is a claim about every line the Worker writes, not about the half of them that are console.log.
const captureAll = async (fn) => { const rl = console.log, re = console.error; const lines = []; const grab = (...a) => lines.push(a.map(String).join(' ')); console.log = grab; console.error = grab; try { await fn(); } finally { console.log = rl; console.error = re; } return lines; };
// Every request comes from its own address unless a test pins one: the per-IP limits and the per-IP seat-hold cap are
// real controls, so they are exercised in the block that is about them rather than tripping every other block.
let ipSeq = 0;
const nextIp = () => '203.0.113.' + ((ipSeq++ % 250) + 1);
// The two trigger strings from wrangler.toml [triggers]. scheduled() branches on both BY NAME (round 5): an event that
// is neither runs the cheap tax tick, so a test that wants the daily work has to say which trigger fired. Every call
// below used to pass {} and get the daily branch by default — the same default that would have run the retention
// purge, the journeys and the digest 288 times a day off the five-minute trigger.
const DAILY_CRON = '17 9 * * *', TICK_CRON = '*/5 * * * *';
const raw = (path, body, origin = 'https://mastsolutions.com', ip = nextIp()) =>
  worker.fetch(new Request('https://api.test' + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, 'CF-Connecting-IP': ip }, body: JSON.stringify(body),
  }), env, ctx);
const post = async (...a) => { const res = await raw(...a); await drain(); return res; };

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
  const roster = (path, key) => worker.fetch(new Request('https://api.test' + path, { headers: key ? { 'X-Admin-Key': key } : {} }), env, ctx);
  ok('no key rejected', (await roster('/roster')).status === 401);
  ok('wrong key rejected', (await roster('/roster', 'guess')).status === 401);
  ok('correct key accepted', (await roster('/roster', 'super-secret-admin-key')).status === 200);
  // The ?key= form was removed 2026-09-09: a key in a URL lands in browser history, in a Referer and in every log
  // between here and Cloudflare, and one route behind this guard makes a Stripe write that is not undoable.
  ok('the RIGHT key in the query string is still 401 — the staff key travels in a header, only', (await roster('/roster?key=super-secret-admin-key')).status === 401);
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
  let ran = null; await worker.scheduled({ cron: DAILY_CRON }, env, { waitUntil: (p) => { ran = p; } }); await ran;
  ok('expired answers purged, current ones kept', answers.length === keep && !answers.some(a => a[4] < '2021'));
  ok('stale pending registration marked abandoned', registrations.get('reg_old').status === 'abandoned');
  ok('outcomes untouched by the purge', outcomes.length >= 2);
}
{
  const res = await worker.fetch(new Request('https://api.test/roster?view=registrations', { headers: { 'X-Admin-Key': 'super-secret-admin-key' } }), env, ctx); const body = await res.json();
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
  let acctRow = rowFor('student@example.com');
  ok('the password is stored as a PBKDF2 hash, never in clear', acctRow && /^pbkdf2-sha256\$100000\$/.test(acctRow.password_hash) && !acctRow.password_hash.includes('correct horse'), acctRow && acctRow.password_hash.slice(0, 30));
  ok('the code is stored hashed and the account is unverified', acctRow && acctRow.verify_code_hash && !acctRow.verify_code_hash.includes(code1) && !acctRow.verified_at);
  const early = await post('/account/login', { email: 'student@example.com', password: 'correct horse battery' });
  ok('login before verifying → 403 unverified, no token', early.status === 403 && (await early.json()).code === 'unverified');
  const wrongCode = await post('/account/verify', { email: 'student@example.com', code: code1 === '000000' ? '000001' : '000000' });
  ok('verify with a wrong code → 400 and the try is counted', wrongCode.status === 400 && rowFor('student@example.com').verify_attempts === 1, String(wrongCode.status));
  const ver = await post('/account/verify', { email: 'student@example.com', code: code1 }); const r1 = await ver.json();
  ok('verify with the emailed code → 200 with a token and the account (email normalised)', ver.status === 200 && typeof r1.token === 'string' && r1.token.includes('.') && r1.account.email === 'student@example.com' && r1.account.name === 'Jane Doe', JSON.stringify(r1).slice(0, 160));
  acctRow = accounts.get(r1.account.id);
  ok('verified_at is set and the code is cleared', !!acctRow.verified_at && !acctRow.verify_code_hash);
  ok('verify on an already-verified address → the same generic 400 bad_code, never a 409 that confirms it', (await post('/account/verify', { email: 'student@example.com', code: code1 })).status === 400);
  emails.length = 0;
  rowFor('student@example.com').verify_sent_at = new Date(Date.now() - 120000).toISOString();   // the sign-up code went out a while ago
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
  // squatting: a sign-up for someone else's address sees nothing and is taken over by the real owner
  emails.length = 0;
  const squat = await post('/account/register', { email: 'victim@example.com', password: 'attacker password 1', name: 'Mallory' });
  const squatCode = codeIn(emails[0]);
  ok('a sign-up for another address gets no token, only a code sent to that address', squat.status === 202 && emails.length === 1 && emails[0].to[0] === 'victim@example.com');
  ok('the squatter (right password, unverified) cannot sign in → 403', (await post('/account/login', { email: 'victim@example.com', password: 'attacker password 1' })).status === 403);
  emails.length = 0;
  const soon = await post('/account/register', { email: 'victim@example.com', password: 'the real owner pw', name: 'Vic Owner' });
  ok('a second sign-up within a minute → the same 202 envelope with no second email, never a 429 that confirms the address', soon.status === 202 && (await soon.json()).pending === true && emails.length === 0, String(soon.status) + ' emails=' + emails.length);
  rowFor('victim@example.com').verify_sent_at = new Date(Date.now() - 120000).toISOString();   // a minute later
  emails.length = 0;
  const owner = await post('/account/register', { email: 'victim@example.com', password: 'the real owner pw', name: 'Vic Owner' });
  const ownerCode = codeIn(emails[0]);
  // Round 3: a second sign-up NEVER writes over an existing row's credentials. It re-sends the code and touches nothing
  // else, which is what stops a stranger setting the password on an address whose owner started but did not finish —
  // and then reading the answer off /account/login, where that password used to come back 403 'unverified'.
  ok('a second sign-up re-sends the code and changes nothing on the row: not the password, not the name', owner.status === 202 && !!ownerCode && rowFor('victim@example.com').name === 'Mallory' && (await post('/account/login', { email: 'victim@example.com', password: 'the real owner pw' })).status === 401, JSON.stringify({ status: owner.status, name: rowFor('victim@example.com').name }));
  ok("the squatter's code is dead", squatCode === ownerCode || (await post('/account/verify', { email: 'victim@example.com', code: squatCode })).status === 400);
  ok('an unknown address and a wrong code answer byte for byte the same 400', await (async () => {
    const a = await post('/account/verify', { email: 'nobody-at-all@example.com', code: '123456' });
    const b = await post('/account/verify', { email: 'victim@example.com', code: ownerCode === '654321' ? '123456' : '654321' });
    return a.status === b.status && a.status === 400 && JSON.stringify(await a.json()) === JSON.stringify(await b.json());
  })(), 'unknown vs wrong code must be indistinguishable');
  const ownerIn = await post('/account/verify', { email: 'victim@example.com', code: ownerCode });
  ok('the emailed code verifies the address', ownerIn.status === 200, String(ownerIn.status));
  // Whoever holds the MAILBOX takes the address, not whoever typed a password first: Forgot password serves an
  // unverified account now, and a successful reset sets the password and marks the address verified in one act.
  emails.length = 0;
  rowFor('victim@example.com').verify_sent_at = new Date(Date.now() - 120000).toISOString();
  const backIn = await post('/account/forgot', { email: 'victim@example.com' });
  const backCode = codeIn(emails[0]);
  const reclaimed = await post('/account/reset', { email: 'victim@example.com', code: backCode, password: 'the real owner pw' });
  ok("the real owner reclaims the address through the mailbox, and the squatter's password stops working", backIn.status === 200 && !!backCode && reclaimed.status === 200 && !!rowFor('victim@example.com').verified_at && (await post('/account/login', { email: 'victim@example.com', password: 'attacker password 1' })).status === 401 && (await post('/account/login', { email: 'victim@example.com', password: 'the real owner pw' })).status === 200, String(reclaimed.status));
  // lockout and re-send
  emails.length = 0;
  await post('/account/register', { email: 'locked@example.com', password: 'a long enough password' });
  const lockCode = codeIn(emails[0]); const statuses = [];
  // Round 3: five wrong codes from ONE connection refuse that connection and leave the code alone. The fifth used to
  // burn it outright, so a stranger holding nothing but an address could reach into the owner's inbox and invalidate the
  // code sitting in it — silently, once round 2 made every wrong answer identical. Answers stay identical; what changed
  // is that the owner's code survives.
  const STRANGER_IP = '198.51.100.200';
  const wrongFrom = (ip) => post('/account/verify', { email: 'locked@example.com', code: lockCode === '111111' ? '222222' : '111111' }, 'https://mastsolutions.com', ip);
  for (let i = 0; i < 5; i++) statuses.push((await wrongFrom(STRANGER_IP)).status);
  const sixthGuess = await wrongFrom(STRANGER_IP);
  ok("five wrong codes from one connection answer the same 400, refuse that connection, and do NOT burn the owner's code", statuses.join() === '400,400,400,400,400' && sixthGuess.status === 400 && !!rowFor('locked@example.com').verify_code_hash && rowFor('locked@example.com').verify_attempts === 5, statuses.join() + ' then ' + sixthGuess.status + ' attempts=' + rowFor('locked@example.com').verify_attempts);
  emails.length = 0;
  ok('resend within a minute → the same 200 and no email (no account enumeration)', (await post('/account/resend', { email: 'locked@example.com' })).status === 200 && emails.length === 0);
  rowFor('locked@example.com').verify_sent_at = new Date(Date.now() - 120000).toISOString();
  ok('resend after a minute → 200 and a new code email', (await post('/account/resend', { email: 'locked@example.com' })).status === 200 && emails.length === 1);
  ok('resend for an unknown email → 200 and no email (no account enumeration)', (await post('/account/resend', { email: 'nobody@example.com' })).status === 200 && emails.length === 1);
  ok('the new code works', (await post('/account/verify', { email: 'locked@example.com', code: codeIn(emails[0]) })).status === 200);
  // parallel guesses cannot share an attempt count (Codex on PR #11, P1): eight at once, at most five are ever compared
  emails.length = 0;
  await post('/account/register', { email: 'raced@example.com', password: 'a long enough password' });
  const raceCode = codeIn(emails[0]);
  const raced = await Promise.all(Array.from({ length: 8 }, (_, i) => post('/account/verify', { email: 'raced@example.com', code: String(900000 + i) === raceCode ? '000000' : String(900000 + i) })));
  const raceStatuses = raced.map((r) => r.status);
  const raceBodies = new Set(await Promise.all(raced.map((r) => r.clone().text())));
  // The claim-first UPDATE inside checkCode still bounds the comparisons at five however many arrive at once; what
  // changed is that all eight answers are now one answer, so the count cannot be read off the status codes either.
  ok('eight concurrent wrong guesses answer 400 with one identical body, and each try is claimed exactly once', raceStatuses.every((s) => s === 400) && raceBodies.size === 1 && rowFor('raced@example.com').verify_attempts === 8 && !!rowFor('raced@example.com').verify_code_hash, raceStatuses.join() + ' bodies=' + raceBodies.size + ' attempts=' + rowFor('raced@example.com').verify_attempts);
  ok('… and the right code still works afterwards: eight wrong tries is not twenty', (await post('/account/verify', { email: 'raced@example.com', code: raceCode })).status === 200);
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
  let ran2 = null; await worker.scheduled({ cron: DAILY_CRON }, env, { waitUntil: (p) => { ran2 = p; } }); await ran2;
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
  await post('/account/verify', { email: 'lockme@example.com', code: lockCode });
  ok('lockout fixture: the account is verified and starts with no failures', !!rowFor('lockme@example.com').verified_at && !rowFor('lockme@example.com').failed_logins);

  resetLimits();
  const wrong = [];
  for (let i = 0; i < LOGIN_FAILURES_PER_LOCK; i++) wrong.push((await post('/account/login', { email: 'lockme@example.com', password: 'not the password ' + i })).status);
  ok('five wrong passwords all answer the plain 401 — the fifth does not announce that the address exists', wrong.join() === '401,401,401,401,401', wrong.join());
  ok('… and the fifth failure set a lock 15 minutes out', rowFor('lockme@example.com').failed_logins === 5 && Date.parse(rowFor('lockme@example.com').locked_until) - Date.now() > 14 * 60000, JSON.stringify({ n: rowFor('lockme@example.com').failed_logins, until: rowFor('lockme@example.com').locked_until }));
  const sixth = await post('/account/login', { email: 'lockme@example.com', password: 'not the password 6' }); const sb = await sixth.json();
  ok('the sixth attempt → 429 locked with retry_after and a Retry-After header', sixth.status === 429 && sb.code === 'locked' && sb.retry_after > 0 && sixth.headers.get('Retry-After') === String(sb.retry_after), String(sixth.status) + ' ' + JSON.stringify(sb));
  ok('a locked account is refused BEFORE the password is hashed: the RIGHT password is refused too', (await post('/account/login', { email: 'lockme@example.com', password: 'a long enough password' })).status === 429);
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
  let ranRate = null; await worker.scheduled({ cron: DAILY_CRON }, env, { waitUntil: (p) => { ranRate = p; } }); await ranRate;
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
    await post('/account/verify', { email, code });
    return rowFor(email);
  };
  const GHOST = 'no-such-person-at-all@example.com';
  // No live code — what every real account looks like when nobody has just asked for one. This is the state that used to
  // answer 'expired' where an invented address answered 'bad_code'.
  const clearCodeOn = (email) => Object.assign(rowFor(email), { verify_kind: null, verify_code_hash: null, verify_expires_at: null, verify_attempts: 0 });

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
  await clearCodeOn('unverified-real@example.com');   // a real, unverified account with NO live code — the ordinary state
  const vKnown = await post('/account/verify', { email: 'unverified-real@example.com', code: '123456' });
  const vGhost = await post('/account/verify', { email: GHOST, code: '123456' });
  ok('verify against a REAL unverified address with no live code answers what an unknown address answers, byte for byte', await same(vKnown, vGhost) && vKnown.status === 400 && (await vKnown.clone().json()).code === 'bad_code', vKnown.status + ' ' + (await vKnown.clone().text()) + '  vs  ' + vGhost.status + ' ' + (await vGhost.clone().text()));
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
  ok('the SIXTH answers 429 locked for both — an invented address locks exactly as a real one does', sixReal.status === 429 && sixGhost.status === 429 && (await sixReal.clone().json()).code === 'locked' && (await sixGhost.clone().json()).code === 'locked' && (await same(sixReal, sixGhost)), sixReal.status + ' ' + (await sixReal.clone().text()) + '  vs  ' + sixGhost.status + ' ' + (await sixGhost.clone().text()));
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
  resetLimits();
  const notTooSoon = rowFor('holdshut@example.com'); notTooSoon.signup_notice_sent_at = new Date(Date.now() - 120000).toISOString();
  resendStatus = 500;
  const failNew = await from('/account/register', { email: 'brand-new-address@example.com', password: 'a long enough password' }, '198.51.100.83');
  const failKnown = await from('/account/register', { email: 'holdshut@example.com', password: 'the attackers password' }, '198.51.100.84');
  resendStatus = 200;
  ok('a Resend outage answers identically for a new address and a verified one — 502 email_failed either way', failNew.status === 502 && (await failNew.clone().json()).code === 'email_failed' && (await same(failNew, failKnown)), failNew.status + ' ' + (await failNew.clone().text()) + '  vs  ' + failKnown.status + ' ' + (await failKnown.clone().text()));
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
  const flaky = { DB: { prepare(sql) { return { async run() { seen.push(sql); if (breakOnce && /signup_notice_sent_at/.test(sql)) { breakOnce = false; throw new Error('D1_ERROR: database is locked'); } return { meta: { changes: 0 } }; } }; } } };
  const firstRun = await ensureRateSchema(flaky); const afterFirst = seen.length;
  const secondRun = await ensureRateSchema(flaky);
  ok('a failed schema step answers false and is NOT memoised: the next request retries every statement', firstRun === false && secondRun === true && afterFirst === RATE_SCHEMA.length && seen.length === RATE_SCHEMA.length * 2, JSON.stringify({ firstRun, secondRun, afterFirst, total: seen.length, steps: RATE_SCHEMA.length }));
  const thirdRun = await ensureRateSchema(flaky);
  ok('… and once every statement has succeeded it IS memoised: no third run', thirdRun === true && seen.length === RATE_SCHEMA.length * 2, String(seen.length));
  _resetRateSchemaMemo();
  const dup = []; const already = { DB: { prepare(sql) { return { async run() { dup.push(sql); throw new Error('duplicate column name: failed_logins'); } }; } } };
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
  await post('/account/verify', { email: 'r3owner@example.com', code: codeIn(emails[0]) });
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
    if (route === '/account/resend') { await post('/account/register', { email: realAddr, password: 'a long enough password' }); rowFor(realAddr).verify_sent_at = new Date(Date.now() - 120000).toISOString(); }
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

  /* ── H3-2: /account/register never writes over an existing row's credentials ── */
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
  ok("… and the row kept its own password and its own name: nothing a stranger typed reached it", (await post('/account/login', { email: 'r3half@example.com', password: 'the owners half-done password' })).status === 403 && rowFor('r3half@example.com').password_hash === rowFor('r3half@example.com').password_hash, 'unverified owner sign-in should answer 403 unverified');

  /* ── H3-3: five wrong codes from a stranger no longer burn what is in the owner's inbox ── */
  resetLimits(); emails.length = 0;
  await post('/account/register', { email: 'r3burn@example.com', password: 'a long enough password' });
  const burnCode3 = codeIn(emails[0]);
  const liveHash = rowFor('r3burn@example.com').verify_code_hash;
  const ATT_IP = '198.51.100.210';
  const strangerTries = [];
  for (let i = 0; i < 6; i++) strangerTries.push((await from('/account/verify', { email: 'r3burn@example.com', code: burnCode3 === '111111' ? '222222' : '111111' }, ATT_IP)).status);
  ok("five wrong codes from one connection refuse that connection and leave the code live — the stranger cannot reach into the owner's inbox", strangerTries.join() === '400,400,400,400,400,400' && rowFor('r3burn@example.com').verify_code_hash === liveHash && rowFor('r3burn@example.com').verify_attempts === 5, strangerTries.join() + ' attempts=' + rowFor('r3burn@example.com').verify_attempts);
  ok('… and the sixth cost the code nothing: it never reached checkCode, so the global count did not move either', rowFor('r3burn@example.com').verify_attempts === 5);
  ok('… and the owner, on their own connection, signs in with the code that was in their inbox all along', (await from('/account/verify', { email: 'r3burn@example.com', code: burnCode3 }, '198.51.100.211')).status === 200);

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
  emails.length = 0;
  const wrongCodes = []; for (let n = 200000; wrongCodes.length < 20; n++) if (String(n) !== globalCode) wrongCodes.push(String(n));
  const globalStatuses = [];
  for (const w of wrongCodes) globalStatuses.push((await post('/account/verify', { email: 'r3global@example.com', code: w })).status);
  const burned = rowFor('r3global@example.com');
  ok('twenty wrong tries in total, from twenty connections, DO burn the code — six digits against twenty tries is a 0.002% chance', globalStatuses.every((s) => s === 400) && !burned.verify_code_hash, globalStatuses.length + ' tries, code live=' + !!burned.verify_code_hash);
  ok('… and the owner is emailed exactly once that it happened, with no code in the notice', emails.length === 1 && emails[0].to[0] === 'r3global@example.com' && /invalidated/i.test(emails[0].subject) && !/\b\d{6}\b/.test(emails[0].text), emails.length + ' ' + (emails[0] && emails[0].subject));
  emails.length = 0;
  const replacement = await post('/account/resend', { email: 'r3global@example.com' });
  ok('… and the one-a-minute throttle is lifted with the burn, so the owner asks for a replacement at once', burned.verify_sent_at === null || (replacement.status === 200 && emails.length === 1), 'sent_at=' + burned.verify_sent_at + ' emails=' + emails.length);

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
  const anonHash = rowFor('r3anon@example.com').verify_code_hash;
  for (let i = 0; i < 6; i++) await noIp('/account/verify', { email: 'r3anon@example.com', code: anonCode === '111111' ? '222222' : '111111' });
  ok('… and the code-guess counter uses the same bucket: five wrong codes with no address refuse that bucket and leave the code live', rowFor('r3anon@example.com').verify_attempts === 5 && rowFor('r3anon@example.com').verify_code_hash === anonHash && [...rateLimits.keys()].some((k) => k.startsWith('codeguess:unknown:')), 'attempts=' + rowFor('r3anon@example.com').verify_attempts + ' keys=' + [...rateLimits.keys()].filter((k) => k.startsWith('codeguess:')).length);

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
  await post('/account/verify', { email: 'r4real@example.com', code: codeIn(emails[0]) });
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
  await post('/account/verify', { email: 'r4login@example.com', code: codeIn(emails[0]) });
  resetLimits();
  const realCosts = [], ghostCosts = [];
  for (let i = 0; i < 5; i++) realCosts.push((await cost('/account/login', { email: 'r4login@example.com', password: 'wrong password ' + i }, '198.51.100.61')).statements);
  for (let i = 0; i < 5; i++) ghostCosts.push((await cost('/account/login', { email: 'r4-no-such-account@example.com', password: 'wrong password ' + i }, '198.51.100.62')).statements);
  ok('five wrong passwords cost an invented address exactly what they cost a real one, try by try',
     realCosts.join() === ghostCosts.join(), 'real ' + realCosts.join() + ' vs invented ' + ghostCosts.join());
  ok('… and the fifth try costs more than the fourth on BOTH paths: the lock write is what the twin had to spend too',
     realCosts[4] > realCosts[3] && ghostCosts[4] === realCosts[4], 'real ' + realCosts.join() + ' invented ' + ghostCosts.join());

  /* ── R4-3: the twenty-try burn fires even when the attacker interleaves a reissue ──
     issueCode zeroed verify_attempts AND dropped every connection's guess counter, and /account/register,
     /account/forgot and /account/resend all reach it UNAUTHENTICATED. One reissue between every five guesses therefore
     bought an endless run of five-guess batches and deferred the global burn for ever: the probe ran 25 wrong codes
     across five connections with a sign-up between each batch, and the code was still live with no notice sent. */
  resetLimits(); emails.length = 0;
  await post('/account/register', { email: 'r4burn@example.com', password: 'a long enough password' });
  const burnRow = rowFor('r4burn@example.com');
  // Every reissue mails a NEW code, so the wrong guess is chosen against the live one each time — a fixed string would
  // eventually BE the code and pass.
  let liveCode = codeIn(emails[0]);
  const wrongNow = () => (liveCode === '111111' ? '222222' : '111111');
  emails.length = 0;
  const burnIps = ['198.51.100.71', '198.51.100.72', '198.51.100.73', '198.51.100.74'];
  const burnStatuses = [];
  let sixthAfterReissue = null;
  for (let b = 0; b < burnIps.length; b++) {
    for (let i = 0; i < 5; i++) burnStatuses.push((await from('/account/verify', { email: 'r4burn@example.com', code: wrongNow() }, burnIps[b])).status);
    if (b < burnIps.length - 1) {
      // the interleaved UNAUTHENTICATED reissue — the whole primitive
      burnRow.verify_sent_at = new Date(Date.now() - 120000).toISOString();
      emails.length = 0;
      await from('/account/resend', { email: 'r4burn@example.com' }, '198.51.100.7' + (5 + b));
      liveCode = codeIn(emails[emails.length - 1]) || liveCode;
      if (b === 0) sixthAfterReissue = rateLimits.get('codeguess:' + burnIps[0] + ':' + burnRow.id);
    }
  }
  ok('a reissue does not hand a refused connection a fresh budget: its counter still stands at five afterwards',
     !!sixthAfterReissue && sixthAfterReissue.count === 5, JSON.stringify(sixthAfterReissue));
  ok('twenty wrong codes with an unauthenticated reissue between every five STILL burn the code — the global count is no longer resettable by a stranger',
     burnStatuses.every((st) => st === 400) && !rowFor('r4burn@example.com').verify_code_hash,
     burnStatuses.length + ' tries, code live=' + !!rowFor('r4burn@example.com').verify_code_hash);
  ok('… and the owner is emailed once that it happened, which is the notice the reissue used to suppress entirely',
     emails.filter((m) => /invalidated/i.test(m.subject)).length === 1 && emails.filter((m) => /invalidated/i.test(m.subject))[0].to[0] === 'r4burn@example.com',
     emails.map((m) => m.subject).join(' | '));

  /* ── R4-4: three unauthenticated code mails an hour at any one address ──
     The 60-second reissue throttle and a 5-per-window-per-IP limit left the ADDRESS uncapped: twelve connections spaced
     past the throttle delivered twelve mails to one mailbox, out of the firm's own sending domain. */
  resetLimits(); emails.length = 0;
  const MAILTARGET = 'r4real@example.com';
  const mailStatuses = [], mailCosts = [];
  for (let i = 0; i < 4; i++) {
    rowFor(MAILTARGET).verify_sent_at = new Date(Date.now() - 120000).toISOString();
    const c = await cost('/account/forgot', { email: MAILTARGET }, '198.51.100.8' + i);
    mailStatuses.push(c.res.status); mailCosts.push(c.statements);
  }
  ok('four unauthenticated /account/forgot from four connections mail one address THREE times, not four',
     emails.filter((m) => m.to[0] === MAILTARGET).length === 3 && rateLimits.get('codemail:' + MAILTARGET).count === 3,
     emails.length + ' mails, counter=' + JSON.stringify(rateLimits.get('codemail:' + MAILTARGET)));
  ok('… and being over the budget changes nothing a caller can see: same 200, same statement count as the mails that went',
     mailStatuses.join() === '200,200,200,200' && mailCosts.every((n) => n === mailCosts[0]), mailStatuses.join() + ' stmts ' + mailCosts.join());
  const ghostMail = await cost('/account/forgot', { email: 'r4-mail-ghost@example.com' }, '198.51.100.89');
  ok('… and an invented address still costs what the real one costs, over budget or under it',
     ghostMail.res.status === 200 && ghostMail.statements === mailCosts[3], 'ghost ' + ghostMail.statements + ' vs over-budget real ' + mailCosts[3]);

  /* ── R4-5: what POST /account/register actually costs, measured, because the README has to say a number ──
     The round-3 residual called it "one extra statement". It is a three-way split, and the doc now states what this
     prints rather than what reads well. */
  resetLimits(); emails.length = 0;
  await post('/account/register', { email: 'r4taken-unverified@example.com', password: 'a long enough password' });
  const regBranch = async (email) => {
    const row = rowFor(email);
    if (row) { row.verify_sent_at = new Date(Date.now() - 120000).toISOString(); row.signup_notice_sent_at = null; }
    resetLimits();
    return (await cost('/account/register', { email, password: 'a long enough password' }, '198.51.100.90')).statements;
  };
  const regNew = await regBranch('r4brand-new@example.com');
  const regUnverified = await regBranch('r4taken-unverified@example.com');
  const regVerified = await regBranch('r4real@example.com');
  console.log('  (register branch cost — brand-new ' + regNew + ', existing-unverified ' + regUnverified + ', existing-verified ' + regVerified + ' statements)');
  ok('POST /account/register costs 6 / 5 / 5 statements for brand-new / existing-unverified / existing-verified — the number the README states',
     regNew === 6 && regUnverified === 5 && regVerified === 5, [regNew, regUnverified, regVerified].join());

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
  const runCron = async (event, en) => { const queued = []; await worker.scheduled({ cron: DAILY_CRON, ...event }, en, { waitUntil: (p) => queued.push(p) }); await Promise.all(queued); };
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


console.log('\n── Stripe Tax: Houston, Texas (owner 2026-09-08; Texas Sales and Use Tax Permit confirmed 2026-09-09) ──');
{
  const taxKey = { 'X-Admin-Key': 'super-secret-admin-key' };
  const setup = (q = '', method = 'POST', headers = taxKey) =>
    worker.fetch(new Request('https://api.test/admin/tax/setup' + q, { method, headers }), env, ctx);
  const posts = () => stripeTaxCalls.filter((c) => c.method === 'POST');
  const resetTax = () => { stripeTaxCalls.length = 0; fakeTaxRegistrations.length = 0; fakeTaxSettings = { status: 'pending', head_office: null, defaults: {} }; taxFail = null; forgetTaxState(); witnessTaxAbsence(); };

  // ── the gate, first: this route reaches Stripe with the live key, so it must be as closed as the rest of /admin ──
  resetTax();
  ok('/admin/tax/setup without the key → 401, like the other /admin routes', (await setup('', 'POST', {})).status === 401);
  ok('… and a wrong key is 401 too', (await setup('', 'POST', { 'X-Admin-Key': 'not-the-key' })).status === 401);
  ok('… and neither unauthorised call reached Stripe', stripeTaxCalls.length === 0, JSON.stringify(stripeTaxCalls.map((c) => c.url)));

  // ── nothing set up yet: settings and the TX registration are both created, and only those two ──
  resetTax();
  const first = await setup();
  const f = await first.json();
  ok('setup on a fresh account → 200', first.status === 200, JSON.stringify(f));
  ok('… writes exactly TWO things: the settings and the registration', posts().length === 2, 'POSTs=' + posts().length + ' ' + JSON.stringify(posts().map((c) => c.url)));
  const wroteSettings = posts().find((c) => c.url.includes('/tax/settings'));
  ok('… the head office is the Houston address, line 2 and all', wroteSettings.body.get('head_office[address][line1]') === '2450 Fondren Rd'
     && wroteSettings.body.get('head_office[address][line2]') === 'Suite 255' && wroteSettings.body.get('head_office[address][city]') === 'Houston'
     && wroteSettings.body.get('head_office[address][state]') === 'TX' && wroteSettings.body.get('head_office[address][postal_code]') === '77063'
     && wroteSettings.body.get('head_office[address][country]') === 'US', wroteSettings.body.toString());
  ok('… tax is EXCLUSIVE — added on top of the listed price, never folded into it', wroteSettings.body.get('defaults[tax_behavior]') === 'exclusive');
  ok('… and the default tax code is the services code', wroteSettings.body.get('defaults[tax_code]') === 'txcd_20030000', wroteSettings.body.get('defaults[tax_code]'));
  const wroteReg = posts().find((c) => c.url.includes('/tax/registrations'));
  ok('… the registration is a US Texas state sales tax registration, active from now', wroteReg.body.get('country') === 'US'
     && wroteReg.body.get('country_options[us][type]') === 'state_sales_tax' && wroteReg.body.get('country_options[us][state]') === 'TX'
     && wroteReg.body.get('active_from') === 'now', wroteReg.body.toString());
  ok('… both statuses were READ before anything was created (a scheduled registration is not an absent one)',
     stripeTaxCalls.some((c) => c.method === 'GET' && c.url.includes('status=active')) && stripeTaxCalls.some((c) => c.method === 'GET' && c.url.includes('status=scheduled')));
  ok('… and the answer is the shape the CI gate reads: active settings, a registration id, created_now true',
     f.settings.status === 'active' && f.settings.head_office_set === true && /^taxreg_/.test(f.registration.id) && f.registration.status === 'active' && f.registration.created_now === true,
     JSON.stringify(f));

  // ── idempotency: the whole point. Running it twice must not create a second Texas registration ──
  // The lock window is cleared first, so this measures IDEMPOTENCY and not the throttle: a second run inside the
  // window is turned away without reading Stripe at all, which is a different property and is pinned further down.
  stripeTaxCalls.length = 0; forgetTaxState();
  const again = await setup();
  const a2 = await again.json();
  ok('run it a second time → 200 and NOTHING is written (0 POSTs)', again.status === 200 && posts().length === 0, 'POSTs=' + posts().length);
  ok('… it reports the registration it found, not one it made', a2.registration.created_now === false && a2.registration.id === f.registration.id, JSON.stringify(a2.registration));
  ok('… and Stripe still holds exactly one registration', fakeTaxRegistrations.length === 1, 'registrations=' + fakeTaxRegistrations.length);
  ok('… the notes say what it did rather than leaving it to be guessed', a2.notes.some((n) => /settings: already active/.test(n)) && a2.notes.some((n) => /state_sales_tax already active/.test(n)), JSON.stringify(a2.notes));

  // ── a registration that has not started yet is 'scheduled'; creating a second one for TX is not undoable ──
  resetTax();
  fakeTaxSettings = { status: 'active', head_office: { address: { line1: '2450 Fondren Rd' } }, defaults: {} };
  fakeTaxRegistrations.push({ id: 'taxreg_sched', status: 'scheduled', country: 'US', country_options: { us: { type: 'state_sales_tax', state: 'TX' } } });
  const sched = await (await setup()).json();
  ok('a SCHEDULED Texas registration counts as present — no duplicate is created', posts().length === 0 && sched.registration.id === 'taxreg_sched' && sched.registration.created_now === false, 'POSTs=' + posts().length);

  // ── another state's registration is not Texas, and is never touched ──
  resetTax();
  fakeTaxSettings = { status: 'active', head_office: { address: { line1: '2450 Fondren Rd' } }, defaults: {} };
  fakeTaxRegistrations.push({ id: 'taxreg_ca', status: 'active', country: 'US', country_options: { us: { type: 'state_sales_tax', state: 'CA' } } });
  const ca = await (await setup()).json();
  ok('a registration for another state does NOT satisfy Texas — TX is created beside it', posts().length === 1 && ca.registration.created_now === true && ca.registration.id !== 'taxreg_ca');
  ok('… and the other state is left exactly as it was', fakeTaxRegistrations.find((r) => r.id === 'taxreg_ca').country_options.us.state === 'CA' && fakeTaxRegistrations.length === 2);

  // ── Stripe's refusal comes back verbatim, named by the step, and nothing is retried ──
  resetTax();
  taxFail = { on: '/tax/registrations', method: 'POST', status: 402, body: { error: { type: 'invalid_request_error', code: 'tax_registration_invalid', message: 'You must accept the Stripe Tax terms before creating a registration.' } } };
  const bad = await setup();
  const b = await bad.json();
  ok('a Stripe refusal is a 502, not a cheerful 200', bad.status === 502, bad.status + ' ' + JSON.stringify(b));
  ok('… and Stripe\'s own error object comes back VERBATIM, so the message is the one Stripe wrote',
     b.error.message === 'You must accept the Stripe Tax terms before creating a registration.' && b.error.code === 'tax_registration_invalid' && b.stripe_status === 402, JSON.stringify(b));
  ok('… named by the step that hit it', b.step === 'registrations.write', b.step);
  ok('… and it was tried ONCE — nothing is retried blindly', posts().filter((c) => c.url.includes('/tax/registrations')).length === 1);
  taxFail = null;

  // ── dry=1 and GET are read-only FOR REAL: no Stripe call, no D1 row. This is the form the smoke workflow runs
  //    against the LIVE Worker, and through round 3 it re-measured the account and rewrote the readiness row every
  //    checkout gates on — while four shipped strings called it read-only. ──
  resetTax();
  taxRowWrites = 0;
  const dry = await (await setup('?dry=1')).json();
  ok('dry=1 makes NO Stripe call at all — not merely no POST', stripeTaxCalls.length === 0, JSON.stringify(stripeTaxCalls.map((c) => c.url)));
  ok('… and writes no tax row either: the readiness a checkout reads is untouched by looking at it', taxRowWrites === 0, 'tax row writes=' + taxRowWrites);
  ok('… it says so, and says where the live read is', dry.dry === true && dry.read_only === true && dry.notes.some((n) => /read-only/.test(n) && /POST \/admin\/tax\/setup is the live read/.test(n)), JSON.stringify(dry.notes));
  ok('… and it reports no account fields, because it did not read the account', dry.settings === null && dry.registration === null, JSON.stringify({ settings: dry.settings, registration: dry.registration }));
  resetTax();
  taxRowWrites = 0;
  const getOnly = await (await setup('', 'GET')).json();
  ok('a GET is read-only too, without needing dry=1', stripeTaxCalls.length === 0 && taxRowWrites === 0 && getOnly.dry === true, 'taxCalls=' + stripeTaxCalls.length + ' writes=' + taxRowWrites);
  ok('… with nothing measured yet it says exactly that, rather than guessing',
     getOnly.tax_ready === false && getOnly.tax_ready_reason === 'never_measured' && getOnly.tax_ready_cache.cached === false, JSON.stringify(getOnly));
  // Ten reports in a row cost ten D1 reads and nothing else — the ceiling the lock imposes on the WRITING path is not
  // needed here, because there is nothing to throttle.
  resetTax(); taxRowWrites = 0;
  for (let i = 0; i < 10; i++) await setup('?dry=1');
  ok('… and ten reports still cost zero Stripe calls and zero writes, so the report needs no lock to be bounded',
     stripeTaxCalls.length === 0 && taxRowWrites === 0, 'taxCalls=' + stripeTaxCalls.length + ' writes=' + taxRowWrites);

  // ── a Worker with no D1: the rate limiter fails closed FIRST (src/ratelimit.js catch → 429), before any route runs.
  //    Written down because it is the opposite of what the route's own shape suggests — /admin/tax/setup reads no
  //    database and sits above handleAdmin's DB check, and it still never executes here. What matters is the
  //    consequence: a degraded Worker writes NOTHING to Stripe's tax settings.
  resetTax();
  const { DB: _dropped, ...noDb } = env;
  const nodb = await worker.fetch(new Request('https://api.test/admin/tax/setup', { method: 'POST', headers: taxKey }), noDb, ctx);
  ok('with D1 unbound the rate limiter fails closed at 429 before /admin/tax/setup is reached', nodb.status === 429, nodb.status);
  ok('… so a degraded Worker writes nothing to Stripe', stripeTaxCalls.length === 0, JSON.stringify(stripeTaxCalls.map((c) => c.url)));

  // ── no Stripe key: a clear 503, not a crash ──
  const { STRIPE_SECRET_KEY: _k, ...noKey } = env;
  ok('without STRIPE_SECRET_KEY the setup route is a 503 that names the missing secret',
     (await worker.fetch(new Request('https://api.test/admin/tax/setup', { method: 'POST', headers: taxKey }), noKey, ctx)).status === 503);
}

console.log('\n── Stripe Tax: the switch, and the bodies on either side of it ──');
{
  // The exact body the pre-change Worker sent for this request, MEASURED by replaying it against the worker.js at HEAD
  // (mast-backend-hardening, df05ff3) — not recalled. If a future edit moves a parameter, reorders one, or lets a tax
  // field leak in with the switch off, this string stops matching and the build fails. That is the whole job of it.
  const PRE_BOOKING = 'mode=payment&customer_email=a%40b.com&line_items%5B0%5D%5Bprice_data%5D%5Bcurrency%5D=usd&line_items%5B0%5D%5Bprice_data%5D%5Bproduct_data%5D%5Bname%5D=MAST+Solutions+%E2%80%94+Handgun+Fundamentals&line_items%5B0%5D%5Bprice_data%5D%5Bproduct_data%5D%5Bdescription%5D=SKU%3A+MAST-HG-FUND&line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=22500&line_items%5B0%5D%5Bquantity%5D=1&success_url=https%3A%2F%2Fmastsolutions.com%2Fmastsolutions.html%3Fcheckout%3Dsuccess&cancel_url=https%3A%2F%2Fmastsolutions.com%2Fmastsolutions.html%3Fcheckout%3Dcancelled&payment_method_types%5B0%5D=card&billing_address_collection=required&phone_number_collection%5Benabled%5D=true&metadata%5Bkind%5D=class_booking&metadata%5Bsku%5D=MAST-HG-FUND&metadata%5Bclass_name%5D=Handgun+Fundamentals&metadata%5Bqty%5D=1&metadata%5Bsession_date%5D=&metadata%5Bsession_label%5D=&metadata%5Bcustomer_name%5D=&metadata%5Borganization%5D=&metadata%5Bnotes%5D=&metadata%5Bsource%5D=mastsolutions&metadata%5Butm_source%5D=&metadata%5Butm_medium%5D=&metadata%5Butm_campaign%5D=&metadata%5Bfirst_touch_at%5D=';
  // The same body with the two tax fields appended, which is all applyTax adds. Named once so the tax-fallback retry
  // can be pinned as "exactly PRE_BOOKING again" rather than "something without automatic_tax in it".
  const TAXED_BOOKING = PRE_BOOKING + '&automatic_tax%5Benabled%5D=true&line_items%5B0%5D%5Bprice_data%5D%5Bproduct_data%5D%5Btax_code%5D=txcd_20030000';
  const booking = { sku: 'MAST-HG-FUND', customer_email: 'a@b.com', qty: 1 };

  stripeCalls.length = 0;
  await post('/create-booking', booking);
  ok('STRIPE_TAX unset: the booking body is BYTE-IDENTICAL to the pre-change one', stripeCalls[0].toString() === PRE_BOOKING, stripeCalls[0].toString());
  ok('… no automatic_tax and no tax_code anywhere in it', !/automatic_tax|tax_code/.test(stripeCalls[0].toString()));

  stripeCalls.length = 0;
  const off = { ...env, STRIPE_TAX: '0' };
  await worker.fetch(new Request('https://api.test/create-booking', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://mastsolutions.com', 'CF-Connecting-IP': nextIp() }, body: JSON.stringify(booking) }), off, ctx);
  ok('STRIPE_TAX="0" is the same byte-identical body — "off" is anything that is not "1"', stripeCalls[0].toString() === PRE_BOOKING, stripeCalls[0].toString());

  stripeCalls.length = 0;
  const on = { ...env, STRIPE_TAX: '1' };
  // The switch alone no longer buys anything: automatic_tax rides only on an account MEASURED as collecting, so the
  // account is made ready here and the readiness row a checkout reads is seeded fresh. The not-ready half is the
  // block below, and the row is seeded rather than measured because a checkout never measures anything.
  taxAccountReady(); forgetTaxState(); cacheTaxReady();
  const taxPost = (p, b) => worker.fetch(new Request('https://api.test' + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://mastsolutions.com', 'CF-Connecting-IP': nextIp() }, body: JSON.stringify(b) }), on, ctx);
  await taxPost('/create-booking', booking);
  const sent = stripeCalls[0].toString();
  ok('STRIPE_TAX="1": the body is the pre-change one PLUS the two tax fields, appended, nothing else moved',
     sent === TAXED_BOOKING, sent);
  ok('… Stripe is asked to compute the tax', stripeCalls[0].get('automatic_tax[enabled]') === 'true');
  ok('… the line carries the services tax code', stripeCalls[0].get('line_items[0][price_data][product_data][tax_code]') === 'txcd_20030000');
  ok('… and the server price is untouched: tax goes ON TOP of $225, it is not carved out of it', stripeCalls[0].get('line_items[0][price_data][unit_amount]') === '22500');
  ok('… no customer_update on a guest session — Stripe rejects it without a customer', !sent.includes('customer_update'));

  // A signed-in checkout attaches a Stripe Customer, and Stripe REFUSES automatic_tax on a Customer session unless it is
  // told it may write the collected address back — without customer_update[address] there is nothing to compute against.
  const codeIn = (m) => (/\b(\d{6})\b/.exec((m && m.text) || '') || [])[1];
  emails.length = 0;
  await post('/account/register', { email: 'tax-card@example.com', password: 'correct horse battery', name: 'Tax Card' });
  const taxToken = (await (await post('/account/verify', { email: 'tax-card@example.com', code: codeIn(emails[0]) })).json()).token;
  stripeCalls.length = 0;
  await taxPost('/create-booking', { ...booking, account_token: taxToken });
  ok('a signed-in, tax-enabled booking goes through the Stripe Customer', stripeCalls[0].get('customer') === 'cus_test_1' && !stripeCalls[0].has('customer_email'), stripeCalls[0].toString().slice(0, 160));
  ok('… and carries customer_update[address]=auto, which Stripe requires before it will compute tax on a Customer session',
     stripeCalls[0].get('customer_update[address]') === 'auto' && stripeCalls[0].get('automatic_tax[enabled]') === 'true', stripeCalls[0].toString());

  // Registration is the second creator, and the one that reaches Stripe after screening and the agreement.
  stripeCalls.length = 0;
  // A weekend and an address no earlier block has touched, so the seat-hold caps and the capacity tests cannot
  // decide what this one proves.
  await taxPost('/register', goodReg({ session_date: '2027-04-24', customer: { name: 'Tax Test', email: 'tax-test@example.com', phone: '(713) 555-0177', organization: '' } }));
  await drain();
  ok('/register carries automatic_tax and the tax code too', stripeCalls.length === 1 && stripeCalls[0].get('automatic_tax[enabled]') === 'true'
     && stripeCalls[0].get('line_items[0][price_data][product_data][tax_code]') === 'txcd_20030000', stripeCalls.length + ' ' + (stripeCalls[0] && stripeCalls[0].toString().slice(0, 200)));

  // Membership is the third: a SAVED price, so the code cannot ride on the session — it is on the Price.
  stripeCalls.length = 0;
  await taxPost('/create-membership', { plan: 'range_member', email: 'a@b.com', seats: 1 });
  ok('/create-membership carries automatic_tax', stripeCalls[0].get('automatic_tax[enabled]') === 'true');
  ok('… and NO line-item tax code: a Session cannot override a saved Price, so setting one there would be a lie',
     !stripeCalls[0].toString().includes('tax_code'), stripeCalls[0].toString());

  // The membership Price provisions itself on first join; that is the one moment its tax code can be set.
  stripePriceCalls.length = 0; fakePrices.length = 0;
  delete fakePlans.red_team.stripe_price_id;
  await taxPost('/create-membership', { plan: 'red_team', email: 'a@b.com', seats: 1 });
  const created = stripePriceCalls.find((c) => c.method === 'POST');
  ok('a membership Price created with the switch on carries the services tax code', created && created.body.get('product_data[tax_code]') === 'txcd_20030000', created && created.body.toString());

  stripePriceCalls.length = 0; fakePrices.length = 0; delete fakePlans.red_team.stripe_price_id;
  await post('/create-membership', { plan: 'red_team', email: 'a@b.com', seats: 1 });
  const createdOff = stripePriceCalls.find((c) => c.method === 'POST');
  ok('… and with the switch off the Price body is untouched — no tax field reaches Stripe at all',
     createdOff && !createdOff.body.toString().includes('tax_code'), createdOff && createdOff.body.toString());

  console.log('\n── Stripe Tax: the readiness gate, the self-setup, the heartbeat ──');
  // The Worker is tax-SELF-SUFFICIENT: automatic_tax rides only on an account it has MEASURED as collecting, and an
  // account that is not collecting is repaired by the Worker itself — from the cron, or from the first checkout that
  // finds it. No repository secret, no Dashboard, no hand-run curl anywhere in that loop.
  const adminTax = (q = '', method = 'POST') =>
    worker.fetch(new Request('https://api.test/admin/tax/setup' + q, { method, headers: { 'X-Admin-Key': 'super-secret-admin-key', 'CF-Connecting-IP': nextIp() } }), on, ctx);

  // ── the switch is ON and the account is NOT collecting: the checkout must be the tax-off checkout, byte for byte ──
  taxAccountBlank(); forgetTaxState(); stripeCalls.length = 0; stripeTaxCalls.length = 0;
  const skipLines = await captureLogs(() => taxPost('/create-booking', booking));
  ok('STRIPE_TAX="1" but the account is not collecting: the body is BYTE-IDENTICAL to the tax-off one',
     stripeCalls[0].toString() === PRE_BOOKING, stripeCalls[0].toString());
  const skipped = skipLines.filter((l) => l.includes('tax_skipped'));
  ok('… and exactly ONE structured line says why — no measurement has been made, and making one is not this request\'s job',
     skipped.length === 1 && JSON.parse(skipped[0]).tax_skipped === 'never_measured', JSON.stringify(skipped));
  await drain();   // let the refresh THAT checkout enqueued finish, so the probe below measures only itself
  // Everything Stripe-facing on this path lives in the enqueued half. Hand the same request a ctx with no waitUntil
  // and the Stripe calls do not merely move — there are none, because applyTax itself makes none.
  taxAccountBlank(); forgetTaxState(); stripeCalls.length = 0; stripeTaxCalls.length = 0;
  await worker.fetch(new Request('https://api.test/create-booking', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://mastsolutions.com', 'CF-Connecting-IP': nextIp() }, body: JSON.stringify(booking) }), on, {});
  ok('… with the background hook removed the checkout still completes tax-off and asks Stripe about tax ZERO times: applyTax itself never calls it',
     stripeCalls[0].toString() === PRE_BOOKING && stripeTaxCalls.length === 0, JSON.stringify(stripeTaxCalls.map((c) => c.url)));
  taxAccountBlank(); forgetTaxState(); witnessTaxAbsence(); stripeCalls.length = 0; stripeTaxCalls.length = 0;
  await taxPost('/create-booking', booking);
  ok('… the customer did not wait for the repair: nothing had been written to Stripe when the response came back',
     fakeTaxRegistrations.length === 0, 'registrations=' + fakeTaxRegistrations.length);
  await drain();
  ok('… and the checkout KICKED THE SETUP OFF: one set of writes lands behind the response',
     stripeTaxCalls.filter((c) => c.method === 'POST').length === 2 && fakeTaxRegistrations.length === 1,
     'POSTs=' + stripeTaxCalls.filter((c) => c.method === 'POST').length + ' registrations=' + fakeTaxRegistrations.length);
  stripeCalls.length = 0;
  await taxPost('/create-booking', booking);
  ok('… so the NEXT checkout carries the tax fields — the Worker repaired the account with no CI and no ADMIN_KEY',
     stripeCalls[0].get('automatic_tax[enabled]') === 'true' && stripeCalls[0].get('line_items[0][price_data][product_data][tax_code]') === 'txcd_20030000', stripeCalls[0].toString());
  await drain();

  // ── two runs at once: the D1 lock decides, and the Idempotency-Keys are the belt to its braces ──
  taxAccountBlank(); forgetTaxState(); witnessTaxAbsence(); stripeTaxCalls.length = 0;
  const concurrent = await Promise.all([adminTax(), adminTax()]);
  const setupPosts = stripeTaxCalls.filter((c) => c.method === 'POST');
  ok('two concurrent setup runs write ONE set of POSTs, not two', setupPosts.length === 2, 'POSTs=' + setupPosts.length + ' ' + JSON.stringify(setupPosts.map((c) => c.url)));
  ok('… and Stripe holds exactly one Texas registration', fakeTaxRegistrations.length === 1, 'registrations=' + fakeTaxRegistrations.length);
  ok('… both runs answered 200 — the one that lost the lock reports the account rather than failing', concurrent.every((r) => r.status === 200), JSON.stringify(concurrent.map((r) => r.status)));
  ok('… the settings POST carries the deterministic Idempotency-Key, so a retry cannot write twice',
     setupPosts.find((c) => c.url.includes('/tax/settings')).headers['Idempotency-Key'] === 'mast-tax-settings-v1',
     JSON.stringify(setupPosts.find((c) => c.url.includes('/tax/settings')).headers));
  ok('… and so does the registration POST, which is the write that is not undoable',
     setupPosts.find((c) => c.url.includes('/tax/registrations')).headers['Idempotency-Key'] === 'mast-tax-reg-us-tx-v1',
     JSON.stringify(setupPosts.find((c) => c.url.includes('/tax/registrations')).headers));
  // The lock row is NOT deleted at the end of a run any more. Deleting it made the real window "one run's duration",
  // which is no ceiling at all — round 2 drove 51 Stripe tax POSTs through it from 50 rotating IPs.
  ok('… and the window is HELD for its full minute afterwards, which is what makes it a ceiling rather than a mutex',
     !!taxStateRow('tax:lock') && Date.parse(taxStateRow('tax:lock').window_start) > Date.now(), JSON.stringify(taxStateRow('tax:lock')));

  // A lock that is genuinely held: the run reports and writes nothing. A lock left behind by a crashed run expires.
  taxAccountBlank(); forgetTaxState(); stripeTaxCalls.length = 0;
  rateLimits.set('tax:lock', { key: 'tax:lock', window_start: new Date(Date.now() + 60000).toISOString(), count: 1 });
  const lockedOut = await (await adminTax()).json();
  ok('a setup run that cannot take the lock writes NOTHING and says so', stripeTaxCalls.filter((c) => c.method === 'POST').length === 0
     && lockedOut.locked_out === true && lockedOut.notes.some((n) => /holds the lock/.test(n)), JSON.stringify(lockedOut.notes));
  rateLimits.set('tax:lock', { key: 'tax:lock', window_start: new Date(Date.now() - 1000).toISOString(), count: 1 });
  witnessTaxAbsence();
  const afterExpiry = await (await adminTax()).json();
  ok('… and a lock left behind by a crashed run expires, so the next run is not blocked forever',
     afterExpiry.locked_out === false && afterExpiry.registration.created_now === true, JSON.stringify(afterExpiry.registration));

  // ── a SCHEDULED Texas registration is registered-but-not-collecting. It is not readiness, and it is not a duplicate. ──
  forgetTaxState(); stripeTaxCalls.length = 0;
  fakeTaxSettings = { status: 'active', head_office: { address: { line1: '2450 Fondren Rd' } }, defaults: {} };
  fakeTaxRegistrations.length = 0;
  fakeTaxRegistrations.push({ id: 'taxreg_future', status: 'scheduled', country: 'US', active_from: '2027-01-01', country_options: { us: { type: 'state_sales_tax', state: 'TX' } } });
  // The LIVE read is the POST — the report form reads D1 and nothing else now — so the account is measured here and
  // the read-only report is checked against the row that measurement left.
  const sched2 = await (await adminTax()).json();
  ok('a SCHEDULED Texas registration does NOT make the account ready', sched2.tax_ready === false && sched2.tax_ready_reason === 'no_active_tx_state_sales_tax', JSON.stringify({ ready: sched2.tax_ready, why: sched2.tax_ready_reason }));
  ok('… and the report says it in words: registered, not collecting yet',
     sched2.registration.status === 'scheduled' && sched2.registration.collecting === false && sched2.notes.some((n) => /NOT collecting yet/.test(n)), JSON.stringify(sched2.notes));
  ok('… and no second Texas registration was created to get there', stripeTaxCalls.filter((c) => c.method === 'POST').length === 0 && fakeTaxRegistrations.length === 1, 'POSTs=' + stripeTaxCalls.filter((c) => c.method === 'POST').length);
  const schedReport = await (await adminTax('?dry=1', 'GET')).json();
  ok('… and the read-only report hands back that measurement from D1, without asking Stripe again',
     schedReport.tax_ready === false && schedReport.tax_ready_reason === 'no_active_tx_state_sales_tax' && schedReport.tax_ready_cache.cached === true, JSON.stringify({ ready: schedReport.tax_ready, cache: schedReport.tax_ready_cache }));
  forgetTaxState(); stripeCalls.length = 0;
  await taxPost('/create-booking', booking);
  ok('… a checkout against it sends the tax-off body', stripeCalls[0].toString() === PRE_BOOKING, stripeCalls[0].toString());
  stripeTaxCalls.length = 0;
  await drain();
  ok('… and the setup it kicks off creates NO second Texas registration — a duplicate is not undoable',
     stripeTaxCalls.filter((c) => c.method === 'POST').length === 0 && fakeTaxRegistrations.length === 1, 'registrations=' + fakeTaxRegistrations.length);

  // ── a Texas registration of another TYPE is not a sales-tax registration (the round-1 hole) ──
  forgetTaxState(); stripeTaxCalls.length = 0;
  fakeTaxSettings = { status: 'active', head_office: { address: { line1: '2450 Fondren Rd' } }, defaults: {} };
  fakeTaxRegistrations.length = 0;
  fakeTaxRegistrations.push({ id: 'taxreg_lease', status: 'active', country: 'US', country_options: { us: { type: 'local_lease_tax', state: 'TX' } } });
  // Stripe refuses the repair, so the run measures the account and writes the readiness row without the wrong-type
  // registration being replaced — which is the state this is about.
  taxFail = { on: '/tax/registrations', method: 'POST', status: 402, body: { error: { type: 'invalid_request_error', code: 'tax_registration_invalid', message: 'You must accept the Stripe Tax terms before creating a registration.' } } };
  await adminTax();
  taxFail = null;
  const wrongType = await (await adminTax('?dry=1', 'GET')).json();
  ok('a Texas registration of ANOTHER TYPE does not satisfy Texas', wrongType.tax_ready === false && wrongType.tax_ready_reason === 'tx_registration_wrong_type', JSON.stringify({ ready: wrongType.tax_ready, why: wrongType.tax_ready_reason }));
  forgetTaxState(); witnessTaxAbsence();
  const madeSales = await (await adminTax()).json();
  ok('… and the setup creates the state_sales_tax registration beside it', madeSales.registration.created_now === true
     && madeSales.registration.type === 'state_sales_tax' && madeSales.tax_ready === true, JSON.stringify(madeSales.registration));
  ok('… leaving the other registration exactly as it was', fakeTaxRegistrations.find((r) => r.id === 'taxreg_lease').country_options.us.type === 'local_lease_tax'
     && fakeTaxRegistrations.length === 2, JSON.stringify(fakeTaxRegistrations.map((r) => r.id)));

  // ── the error mirror is redacted AT THE SOURCE, so every consumer gets the scrubbed answer, not just CI.
  //    The key shape is assembled at runtime: a literal one in this file is a credential pattern, and the repo's own
  //    guards block it — correctly. ──
  const KEY_SHAPE = ['sk', 'live', '51NoTaReAlKeY0123456789'].join('_');
  taxAccountBlank(); forgetTaxState(); witnessTaxAbsence();
  taxFail = { on: '/tax/registrations', method: 'POST', status: 402, body: { error: { type: 'invalid_request_error', code: 'tax_registration_invalid',
    message: 'Refused: key ' + KEY_SHAPE + ' with admin key super-secret-admin-key', request_log_url: 'https://dashboard.stripe.com/logs/req_1' } } };
  const leaked = await adminTax();
  const leakedBody = await leaked.text();
  ok('a Stripe error carrying key shapes comes back REDACTED by the WORKER, not by the workflow that prints it',
     leaked.status === 502 && !leakedBody.includes(KEY_SHAPE) && !leakedBody.includes('super-secret-admin-key') && leakedBody.includes('[redacted]'), leakedBody.slice(0, 300));
  const leakedJson = JSON.parse(leakedBody);
  ok('… and it is four named fields, never Stripe\'s raw error object',
     leakedJson.step === 'registrations.write' && Object.keys(leakedJson.error).join(',') === 'type,code,message'
     && leakedJson.error.code === 'tax_registration_invalid' && leakedJson.stripe_status === 402, JSON.stringify(leakedJson));
  taxFail = null;

  // ── the cron is the other trigger, and it is the one that runs when nobody is buying anything ──
  taxAccountBlank(); forgetTaxState(); witnessTaxAbsence(); stripeTaxCalls.length = 0;
  const cron1 = []; await worker.scheduled({ cron: DAILY_CRON }, on, { waitUntil: (p) => cron1.push(p) }); await Promise.all(cron1);
  ok('the daily cron sets the account up when the switch is on and the account is not collecting',
     stripeTaxCalls.filter((c) => c.method === 'POST').length === 2 && fakeTaxRegistrations.length === 1, 'POSTs=' + stripeTaxCalls.filter((c) => c.method === 'POST').length);
  ok('… and stamps the heartbeat with the trigger that ran it', /\|cron\/created$/.test(String((taxStateRow('tax:last_run') || {}).window_start)), JSON.stringify(taxStateRow('tax:last_run')));
  stripeTaxCalls.length = 0;
  const cron2 = []; await worker.scheduled({ cron: DAILY_CRON }, on, { waitUntil: (p) => cron2.push(p) }); await Promise.all(cron2);
  ok('… and a cron run against a ready account asks Stripe nothing at all — the cached measurement answers', stripeTaxCalls.length === 0, JSON.stringify(stripeTaxCalls.map((c) => c.url)));

  // ── the heartbeat: wired ≠ firing, so a loop that stopped running has to be visible without opening a run log ──
  taxAccountBlank(); forgetTaxState(); witnessTaxAbsence();
  await adminTax();
  const beat = taxStateRow('tax:last_run');
  ok('every setup run that holds the lock leaves a heartbeat row in D1', !!beat && /\|admin\/created$/.test(String(beat.window_start)), JSON.stringify(beat));
  const report = await (await adminTax('?dry=1', 'GET')).json();
  ok('… and the report prints it with its age and whether it is stale',
     report.last_run && report.last_run.outcome === 'admin/created' && report.last_run.stale === false && report.last_run.age_hours < 1, JSON.stringify(report.last_run));
  ok('… beside the readiness the checkout actually gates on, and how old that measurement is',
     report.tax_ready === true && typeof report.tax_ready_cache.age_seconds === 'number' && report.tax_ready_cache.ttl_seconds === 600, JSON.stringify({ ready: report.tax_ready, cache: report.tax_ready_cache }));
  ageTaxState('tax:last_run', 26 * 3600000);
  const purgeRun = []; await worker.scheduled({ cron: DAILY_CRON }, env, { waitUntil: (p) => purgeRun.push(p) }); await Promise.all(purgeRun);
  ok('the daily purge does NOT eat the tax state rows — a heartbeat deleted at 24h could never be reported stale at 25h', !!taxStateRow('tax:last_run'), JSON.stringify([...rateLimits.keys()].filter((k) => k.startsWith('tax:'))));
  const stale = await (await adminTax('?dry=1', 'GET')).json();
  ok('… so a run that last fired 26 hours ago is REPORTED stale', stale.last_run.stale === true && stale.last_run.age_hours >= 25, JSON.stringify(stale.last_run));

  // ── the cache IS the readiness: it is written off-path, it is the only thing a checkout reads, and it expires ──
  taxAccountReady(); forgetTaxState(); stripeCalls.length = 0; stripeTaxCalls.length = 0;
  await taxPost('/create-booking', booking);
  ok('the FIRST checkout against an empty cache is tax-off even though the account IS collecting — measuring is not on the customer\'s path',
     stripeCalls[0].toString() === PRE_BOOKING, stripeCalls[0].toString());
  await drain();
  ok('… and the refresh it enqueued behind the response is what caches the account ready', (taxStateRow('tax:ready') || {}).count === 1, JSON.stringify(taxStateRow('tax:ready')));
  taxFail = { on: '/tax/settings', method: 'GET', status: 500, body: { error: { message: 'Stripe is having a moment' } } };
  stripeCalls.length = 0; stripeTaxCalls.length = 0;
  await taxPost('/create-booking', booking);
  ok('… the next checkout reads that row and asks Stripe nothing at all — a Stripe outage cannot touch it',
     stripeTaxCalls.length === 0 && stripeCalls[0].get('automatic_tax[enabled]') === 'true', 'taxCalls=' + stripeTaxCalls.length);
  ageTaxState('tax:ready', 11 * 60000); expireTaxWindow();
  stripeCalls.length = 0;
  await taxPost('/create-booking', booking);
  ok('… past the 10-minute TTL the measurement is DUE, not void: it said ready, so the order is taxed on it and the re-measurement runs behind the response',
     stripeCalls[0].toString() === TAXED_BOOKING, stripeCalls[0].toString());
  const rowBefore = JSON.stringify(taxStateRow('tax:ready'));
  await drain();
  // ROUND 5, R5-1. This assertion used to read the other way — "a Stripe error is cached as UNMEASURED (count 2)" —
  // and that write is what destroyed the 24-hour grace on the first failed tick, because taxReadyCached grants the
  // grace only to a row that says READY. A failure is not an answer about the account.
  ok('… and a re-measurement that FAILS leaves the ready row exactly as it was: silence is not evidence, so the grace survives the outage',
     JSON.stringify(taxStateRow('tax:ready')) === rowBefore && (taxStateRow('tax:ready') || {}).count === 1, JSON.stringify(taxStateRow('tax:ready')));
  stripeCalls.length = 0; stripeTaxCalls.length = 0;
  await taxPost('/create-booking', booking); await drain();
  ok('… so the NEXT checkout through the same outage is still taxed, and the held window means it costs no Stripe call',
     stripeTaxCalls.length === 0 && stripeCalls[0].toString() === TAXED_BOOKING, 'taxCalls=' + stripeTaxCalls.length + ' body=' + stripeCalls[0].toString());

  // The other half of the same rule: with NO ready measurement to protect, a failure still writes UNMEASURED on the
  // short negative TTL — which is what stops the next checkout re-triggering it, and what fails closed.
  forgetTaxState(); expireTaxWindow();
  stripeCalls.length = 0; stripeTaxCalls.length = 0;
  await taxPost('/create-booking', booking); await drain();
  ok('… while a failure with no ready row behind it IS cached as UNMEASURED (count 2): fail-closed is unchanged where there is nothing to grace',
     (taxStateRow('tax:ready') || {}).count === 2 && /\|settings_read_failed$/.test(String((taxStateRow('tax:ready') || {}).window_start)), JSON.stringify(taxStateRow('tax:ready')));
  stripeCalls.length = 0; stripeTaxCalls.length = 0;
  await taxPost('/create-booking', booking); await drain();
  ok('… and that negative cache is what stops the NEXT checkout re-triggering it: zero Stripe calls inside the 60-second retry TTL',
     stripeTaxCalls.length === 0 && stripeCalls[0].toString() === PRE_BOOKING, 'taxCalls=' + stripeTaxCalls.length);
  ageTaxState('tax:ready', 61000); expireTaxWindow();
  stripeCalls.length = 0; stripeTaxCalls.length = 0;
  await taxPost('/create-booking', booking); await drain();
  ok('… but only for a minute: past the retry TTL the refresh is allowed again, so a Stripe outage costs ten minutes of tax, not one',
     stripeTaxCalls.length > 0, 'taxCalls=' + stripeTaxCalls.length);
  taxFail = null;
  await drain();

  // ── the P1 from round 2, pinned: a burst of anonymous checkouts is bounded by STATE, not by how many arrive ──
  // Round 2 measured 10 sequential not-ready checkouts driving 11 Stripe tax POSTs and 61 GETs, and 50 requests from 50
  // addresses driving 51 POSTs — an unauthenticated visitor could spend the Stripe rate budget the Checkout Session
  // itself needs. The account here is the realistic stuck one: Stripe refuses the registration until somebody accepts
  // the Tax terms, so it never becomes ready and nothing decays the trigger except the cache and the lock window.
  const stuckAccount = () => {
    taxAccountBlank();
    taxFail = { on: '/tax/registrations', method: 'POST', status: 402, body: { error: { type: 'invalid_request_error',
      code: 'tax_registration_invalid', message: 'You must accept the Stripe Tax terms before creating a registration.' } } };
  };
  const burstPost = (i) => worker.fetch(new Request('https://api.test/create-booking', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://mastsolutions.com', 'CF-Connecting-IP': '192.0.2.' + ((i % 250) + 1) },
    body: JSON.stringify(booking) }), on, ctx);

  stuckAccount(); forgetTaxState(); witnessTaxAbsence(); stripeCalls.length = 0; stripeTaxCalls.length = 0;
  await burstPost(0); await drain();
  const oneTrigger = stripeTaxCalls.length, onePosts = stripeTaxCalls.filter((c) => c.method === 'POST').length;

  stuckAccount(); forgetTaxState(); witnessTaxAbsence(); stripeCalls.length = 0; stripeTaxCalls.length = 0;
  const burst = await captureLogs(async () => { for (let i = 1; i <= 100; i++) await burstPost(i); });
  await drain();
  ok('100 not-ready checkouts from 100 addresses cost the SAME Stripe sequence that ONE costs — the trigger is bound to the lock window, not to traffic',
     stripeTaxCalls.length === oneTrigger, 'burst=' + stripeTaxCalls.length + ' single=' + oneTrigger);
  ok('… exactly ONE setup attempt reaches Stripe across all 100: one settings write, one registration write',
     stripeTaxCalls.filter((c) => c.method === 'POST').length === onePosts && onePosts === 2,
     'POSTs=' + JSON.stringify(stripeTaxCalls.filter((c) => c.method === 'POST').map((c) => c.url)));
  ok('… and all 100 got the tax-off body, byte for byte, not one of them a slower one',
     stripeCalls.length === 100 && stripeCalls.every((b) => b.toString() === PRE_BOOKING), 'bodies=' + stripeCalls.length);
  ok('… with one structured tax_skipped line each — 100 of them, none silent',
     burst.filter((l) => l.includes('tax_skipped')).length === 100, 'lines=' + burst.filter((l) => l.includes('tax_skipped')).length);

  // ── a stale cache with the window already held: the refresh runs and does NOTHING, no Stripe call at all ──
  stuckAccount(); forgetTaxState(); stripeCalls.length = 0; stripeTaxCalls.length = 0;
  cacheTaxReady(0, 'settings_status:pending'); ageTaxState('tax:ready', 11 * 60000);
  rateLimits.set('tax:lock', { key: 'tax:lock', window_start: new Date(Date.now() + 60000).toISOString(), count: 1 });
  await taxPost('/create-booking', booking); await drain();
  ok('a stale measurement plus a held window = ZERO Stripe calls: somebody else is already measuring, so this request does not',
     stripeTaxCalls.length === 0 && stripeCalls[0].toString() === PRE_BOOKING, JSON.stringify(stripeTaxCalls.map((c) => c.url)));
  taxFail = null;

  // ── Stripe hangs: the customer never feels it, and the measurement dies on the Worker's own clock ──
  const hangEnv = { ...on, STRIPE_TAX_TIMEOUT_MS: '120' };
  taxAccountBlank(); forgetTaxState(); stripeCalls.length = 0; stripeTaxCalls.length = 0;
  taxHang = new Promise(() => {});   // Stripe accepts the tax call and never answers it
  const startedAt = Date.now();
  await worker.fetch(new Request('https://api.test/create-booking', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://mastsolutions.com', 'CF-Connecting-IP': nextIp() },
    body: JSON.stringify(booking) }), hangEnv, ctx);
  const elapsed = Date.now() - startedAt;
  ok('with Stripe\'s tax endpoint hung the checkout still completes immediately and tax-off — round 2 measured it blocked past 1500ms',
     elapsed < 50 && stripeCalls[0].toString() === PRE_BOOKING, 'elapsed=' + elapsed + 'ms');
  await drain();
  ok('… the measurement behind it dies on the Worker\'s clock instead of hanging forever',
     (taxStateRow('tax:ready') || {}).count === 2 && /\|timeout$/.test(String((taxStateRow('tax:ready') || {}).window_start)), JSON.stringify(taxStateRow('tax:ready')));
  ok('… the heartbeat records the outcome as timeout, so a Stripe that is up but unanswering is visible in the report',
     /\|checkout\/timeout$/.test(String((taxStateRow('tax:last_run') || {}).window_start)), JSON.stringify(taxStateRow('tax:last_run')));
  ok('… and nothing was WRITTEN to an account that could not be read', stripeTaxCalls.filter((c) => c.method === 'POST').length === 0,
     JSON.stringify(stripeTaxCalls.map((c) => c.method + ' ' + c.url)));
  taxHang = null;

  // ── the success path is scrubbed too, not just the error path (round-2 probe read a key back out of settings.status) ──
  const PLANTED = ['sk', 'live', '51NoTaReAlKeY0123456789'].join('_');
  forgetTaxState(); stripeTaxCalls.length = 0;
  fakeTaxSettings = { status: 'pending_' + PLANTED, head_office: null, defaults: {} };
  fakeTaxRegistrations.length = 0;
  // The report form no longer reads Stripe, so the success-path redaction is exercised where a Stripe-controlled string
  // still reaches a response: a POST that finds the window held reports the account (taxRun read-only) and writes nothing.
  rateLimits.set('tax:lock', { key: 'tax:lock', window_start: new Date(Date.now() + 60000).toISOString(), count: 1 });
  const planted = await (await adminTax()).text();
  // ROUND 5, R5-5, RE-ROUTED BY ROUND 7 — and the change of route is the point, so it is written down rather than
  // quietly edited. R5-5 asserted that a key planted in settings.status came back as '[unexpected]': the value reached
  // the report and taxEnum replaced it whole. Round 7's settings validator asks the SHAPE question one step earlier —
  // 'pending_sk_live_…' is not enum-shaped, so it is not a status this Worker can decide on — and the run now refuses
  // before any of it is reported. The property R5-5 pinned (a Stripe-controlled string never reaches the report
  // verbatim) is strictly stronger here: nothing Stripe said is in this response at all. taxEnum's own allow-list is
  // pinned directly below, on the field that still reaches the report.
  ok('a key shape planted in a SUCCESS field (settings.status) never reaches the report: it is not enum-shaped, so it is a SHAPE failure and the run refuses before reporting anything Stripe said',
     !planted.includes(PLANTED) && !planted.includes('pending_')
     && JSON.parse(planted).step === 'settings.read' && JSON.parse(planted).error.code === 'settings_status_invalid'
     && JSON.parse(planted).error.type === 'unparseable_response', planted.slice(0, 300));
  ok('… and that report wrote nothing to Stripe: it is the locked-out form, which reads and reports', stripeTaxCalls.filter((c) => c.method === 'POST').length === 0, JSON.stringify(stripeTaxCalls.map((c) => c.method + ' ' + c.url)));

  // The allow-list itself, on a field that IS reported: a registration id is `taxreg_` plus alphanumerics, and a key
  // shape is neither. Same assertion R5-5 made, on the route round 7 leaves open.
  forgetTaxState(); stripeTaxCalls.length = 0;
  fakeTaxSettings = { status: 'active', head_office: { address: { line1: '2450 Fondren Rd' } }, defaults: {} };
  fakeTaxRegistrations.length = 0;
  fakeTaxRegistrations.push({ id: 'taxreg_' + PLANTED, object: 'tax.registration', status: 'active', country: 'US', country_options: { us: { type: 'state_sales_tax', state: 'TX' } } });
  rateLimits.set('tax:lock', { key: 'tax:lock', window_start: new Date(Date.now() + 60000).toISOString(), count: 1 });
  const plantedId = await (await adminTax()).text();
  ok('… and a key shape planted in a reported ENUM field (registration.id) is replaced WHOLE, not scrubbed of the shapes a denylist knows',
     !plantedId.includes(PLANTED) && JSON.parse(plantedId).registration.id === '[unexpected]', plantedId.slice(0, 300));
  ok('… including the copy of it that rides inside tax_ready_reason and the notes',
     !JSON.stringify(JSON.parse(plantedId).notes).includes(PLANTED) && !String(JSON.parse(plantedId).tax_ready_reason).includes(PLANTED),
     JSON.stringify({ reason: JSON.parse(plantedId).tax_ready_reason, notes: JSON.parse(plantedId).notes.slice(0, 2) }));
  forgetTaxState(); fakeTaxRegistrations.length = 0;

  // ── a Stripe answer nothing can parse: NAMED, not thrown — and the throw path is still there behind it ──
  // Round 2 fed it a settings body of literal null and got HTTP 500 with no tax:last_run row and no redaction. Round 2's
  // fix caught the TypeError; ROUND 7 stops it being a TypeError at all — a body of `null` fails validateTaxSettings,
  // which is a named shape failure with the same 502, the same redaction and the same heartbeat. That is the whole
  // claim of doctrine 1 stated as a test: after it, no Stripe BODY can throw in this run, because no field is read off
  // one until a validator has said it is there.
  taxAccountBlank(); forgetTaxState(); stripeTaxCalls.length = 0;
  const settingsWas = fakeTaxSettings;
  fakeTaxSettings = null;   // 200, body `null` — round 2 read fields off it and threw
  const threw = await adminTax();
  const threwBody = await threw.json();
  ok('a 200 whose body is literal null is a NAMED shape failure now, not a caught TypeError: same 502, and it says which shape',
     threw.status === 502 && threwBody.step === 'settings.read' && threwBody.error.code === 'settings_not_an_object'
     && Object.keys(threwBody.error).join(',') === 'type,code,message', JSON.stringify(threwBody).slice(0, 240));
  ok('… and it still leaves the heartbeat, so a loop dying this way is visible in the report',
     /\|admin\/error:settings\.read$/.test(String((taxStateRow('tax:last_run') || {}).window_start)), JSON.stringify(taxStateRow('tax:last_run')));
  ok('… and the window is still held afterwards: a failed run does not free the ceiling either',
     !!taxStateRow('tax:lock') && Date.parse(taxStateRow('tax:lock').window_start) > Date.now(), JSON.stringify(taxStateRow('tax:lock')));

  // The exception path is no longer reachable from a Stripe body, so it is fired from the other side — a field of env
  // that blows up mid-run — rather than declared dead. A backstop nothing can trigger is a backstop nobody can trust.
  forgetTaxState(); stripeTaxCalls.length = 0;
  fakeTaxSettings = settingsWas; taxAccountReady();
  const boomEnv = new Proxy(on, { get(t, k) { if (k === 'STRIPE_TAX') throw new Error('the run blew up: ' + PLANTED); return t[k]; } });
  const boom = await worker.fetch(new Request('https://api.test/admin/tax/setup', { method: 'POST', headers: { 'X-Admin-Key': 'super-secret-admin-key', 'CF-Connecting-IP': nextIp() } }), boomEnv, ctx);
  const boomBody = await boom.json();
  ok('a run that throws for any other reason is still the redacted 502 named exception, with the heartbeat and the held window',
     boom.status === 502 && boomBody.step === 'exception' && !JSON.stringify(boomBody).includes(PLANTED)
     && /\|admin\/error:exception$/.test(String((taxStateRow('tax:last_run') || {}).window_start))
     && !!taxStateRow('tax:lock') && Date.parse(taxStateRow('tax:lock').window_start) > Date.now(),
     JSON.stringify(boomBody).slice(0, 240));
  forgetTaxState(); taxAccountBlank(); fakeTaxSettings = null;
  forgetTaxState();
  const blindReport = await adminTax('?dry=1', 'GET');
  ok('… while the read-only report answers 200 from D1 through the same outage — it never calls Stripe, so Stripe cannot break it',
     blindReport.status === 200 && (await blindReport.json()).tax_ready === false, blindReport.status);
  fakeTaxSettings = settingsWas;

  // ── the staff key travels in a header, and only in a header, on every route behind ADMIN_KEY ──
  const viaQuery = async (path, method = 'GET') =>
    (await worker.fetch(new Request('https://api.test' + path + (path.includes('?') ? '&' : '?') + 'key=super-secret-admin-key',
      { method, headers: { 'CF-Connecting-IP': nextIp() } }), on, ctx)).status;
  const queryRoutes = [['/roster'], ['/admin/crm'], ['/admin/audience.csv'], ['/admin/tax/setup', 'GET'], ['/admin/tax/setup', 'POST'], ['/admin/sync', 'POST'], ['/admin/journeys', 'POST']];
  const queryStatuses = [];
  for (const [path, method] of queryRoutes) queryStatuses.push(path + ' ' + (method || 'GET') + '=' + await viaQuery(path, method));
  ok('the RIGHT key in ?key= is 401 on every admin route — browser history, Referer and proxy logs are not places for it',
     queryStatuses.every((r) => r.endsWith('=401')), queryStatuses.join(' · '));
  ok('… and the header form still works, so nothing legitimate was locked out',
     (await adminTax('?dry=1', 'GET')).status === 200);

  taxFail = null; taxHang = null;
  taxAccountReady(); forgetTaxState();
}

console.log('\n── Stripe Tax kept warm: the five-minute trigger, the 24-hour grace, and the fallback under it ──');
{
  // Round 3 paired a ten-minute readiness TTL with a DAILY cron, so the measurement was fresh for 10 minutes out of
  // 1440 and a business selling one order an hour sold almost every one of them UNTAXED (measured in review: 20
  // isolated orders, 0 taxed). A completed Checkout Session cannot be re-taxed afterwards. Two halves to the fix, and
  // both are pinned here: a trigger that fires more often than the measurement expires, and a measurement that said
  // READY still counting for 24 hours while nothing re-measures.
  const on = { ...env, STRIPE_TAX: '1' };
  const booking = { sku: 'MAST-HG-FUND', customer_email: 'a@b.com', qty: 1 };
  const bookWith = (c, e = on) => worker.fetch(new Request('https://api.test/create-booking', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://mastsolutions.com', 'CF-Connecting-IP': nextIp() },
    body: JSON.stringify(booking) }), e, c);
  // NO ctx.waitUntil: a checkout that cannot enqueue anything cannot be the thing keeping the cache warm, so what these
  // orders measure is the CRON and nothing else.
  const bookAlone = () => bookWith({});

  // Both bodies are MEASURED here rather than copied: one checkout with the switch off is the tax-off body, and the
  // taxed one is that string plus the two fields applyTax appends.
  stripeCalls.length = 0;
  await bookWith({}, { ...env, STRIPE_TAX: '0' });
  const OFF_BODY = stripeCalls[0].toString();
  const TAXED_BODY = OFF_BODY + '&automatic_tax%5Benabled%5D=true&line_items%5B0%5D%5Bprice_data%5D%5Bproduct_data%5D%5Btax_code%5D=txcd_20030000';

  // The clock the Worker reads. Everything in the tax design is an age — a TTL, a grace, a lock window — and none of it
  // can be tested by waiting, so time is virtual for this block and real again after it.
  const RealDate = Date;
  let skew = 0;
  class VirtualDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(RealDate.now() + skew); else super(...a); }
    static now() { return RealDate.now() + skew; }
  }
  const advance = (ms) => { skew += ms; };
  globalThis.Date = VirtualDate;

  try {
    const tick = async (cron = '*/5 * * * *') => {
      const q = [];
      await worker.scheduled({ cron, scheduledTime: Date.now() }, on, { waitUntil: (p) => q.push(Promise.resolve(p).catch(() => {})) });
      await Promise.all(q);
    };

    // ── three simulated hours, a tick every five minutes, an order after each one ──
    taxAccountReady(); forgetTaxState(); stripeTaxCalls.length = 0;
    let taxed = 0, untaxed = 0;
    for (let i = 0; i < 36; i++) {
      await tick();
      stripeCalls.length = 0;
      await bookAlone();
      if (stripeCalls[0].toString() === TAXED_BODY) taxed++; else untaxed++;
      advance(5 * 60000);
    }
    ok('a trigger every five minutes keeps the measurement warm: 36 orders across three simulated hours, EVERY one taxed',
       taxed === 36 && untaxed === 0, 'taxed=' + taxed + ' untaxed=' + untaxed);
    ok('… and it costs 2 Stripe reads per re-measurement, not per tick and not per order: 18 measurements in three hours',
       stripeTaxCalls.length === 36 && stripeTaxCalls.every((c) => c.method === 'GET'), 'tax calls=' + stripeTaxCalls.length);

    // ── the tick is the tax loop and nothing else ──
    sqlDeletes = 0;
    await tick();
    const tickDeletes = sqlDeletes;
    sqlDeletes = 0;
    await tick('17 9 * * *');   // the OTHER trigger in wrangler.toml: the daily one, which does carry the daily work
    ok('the five-minute tick runs the tax loop ONLY — the retention purge stays on the daily trigger instead of running 288 times a day',
       tickDeletes === 0 && sqlDeletes > 0, 'tick deletes=' + tickDeletes + ' daily deletes=' + sqlDeletes);
    const offTick = await captureLogs(() => worker.scheduled({ cron: '*/5 * * * *' }, { ...env, STRIPE_TAX: '0' }, ctx));
    ok('… and with the switch off it does nothing at all, out loud', offTick.some((l) => l.includes('"tax_tick":"skipped"')), JSON.stringify(offTick));

    // ── the trigger goes quiet: last-known-ready holds for a day, then fails closed ──
    taxAccountReady(); forgetTaxState(); cacheTaxReady(); stripeTaxCalls.length = 0; stripeCalls.length = 0;
    advance(23 * 3600000);
    await bookAlone();
    ok('nothing re-measured for 23 hours and the order is STILL taxed — a stale measurement that said ready is not a measurement that says no',
       stripeCalls[0].toString() === TAXED_BODY, stripeCalls[0].toString());
    ok('… and it cost the customer nothing: zero Stripe tax calls on that path', stripeTaxCalls.length === 0, JSON.stringify(stripeTaxCalls.map((c) => c.url)));

    taxAccountReady(); forgetTaxState(); cacheTaxReady(); stripeTaxCalls.length = 0; stripeCalls.length = 0;
    advance(25 * 3600000);
    const expired = await captureLogs(() => bookWith(ctx));
    ok('at 25 hours it fails CLOSED: tax comes off rather than trusting a day-old reading of somebody else\'s account',
       stripeCalls[0].toString() === OFF_BODY, stripeCalls[0].toString());
    ok('… and the log names which kind of no it is', expired.some((l) => l.includes('"tax_skipped":"measurement_expired"')), JSON.stringify(expired.filter((l) => l.includes('tax_skipped'))));
    await drain();
    ok('… while that same first checkout re-triggered the measurement behind its own response',
       stripeTaxCalls.length > 0 && (taxStateRow('tax:ready') || {}).count === 1, 'tax calls=' + stripeTaxCalls.length + ' row=' + JSON.stringify(taxStateRow('tax:ready')));
    stripeCalls.length = 0;
    await bookAlone();
    ok('… so the one after it is taxed again, with no cron run in between', stripeCalls[0].toString() === TAXED_BODY, stripeCalls[0].toString());

    // ── the price of trusting a stale measurement: Stripe refuses the Session, and the customer must not feel it ──
    // ROUND 5, R5-2. The refusal keeps the checkout alive and buys ONE thing beyond that: a measurement, behind the
    // response, under the lock. It does NOT write the readiness row any more. That write was reachable by an anonymous
    // request with no lock and no rate limit, on any non-ok body whose free text matched /automatic_tax|tax|
    // registration/ — so a string Stripe echoes back (an email local part, a description, a URL path) turned tax off
    // for every other buyer, and a completed Session cannot be re-taxed. The message planted below is exactly that:
    // attacker-controlled text carrying the trigger words, and a key shape for the redactor to eat.
    const KEY_SHAPE = ['sk', 'live', '51NoTaReAlKeY0123456789'].join('_');
    const ECHOED = 'tax-registration+automatic_tax@evil.example';
    taxAccountReady(); forgetTaxState(); cacheTaxReady(); stripeCalls.length = 0; stripeTaxCalls.length = 0;
    sessionFail = { n: 1, status: 400, body: { error: { type: 'invalid_request_error', code: 'parameter_invalid_string_empty', param: 'customer_email',
      message: 'Invalid email address: ' + ECHOED + ' (key ' + KEY_SHAPE + ') — no such customer, and automatic_tax needs a registration.' } } };
    const fbQ = [];
    const fbCtx = { waitUntil: (p) => { fbQ.push(Promise.resolve(p).catch(() => {})); return p; } };
    const rowBeforeRefusal = JSON.stringify(taxStateRow('tax:ready'));
    let fallbackRes;
    const fbLines = await captureLogs(async () => { fallbackRes = await bookWith(fbCtx); });
    ok('Stripe refuses a Session for a TAX reason and the customer still gets a checkout URL: one retry, without the tax fields',
       fallbackRes.status === 200 && stripeCalls.length === 2, fallbackRes.status + ' attempts=' + stripeCalls.length);
    ok('… the first attempt carried tax and the retry is the tax-off body, byte for byte',
       stripeCalls[0].toString() === TAXED_BODY && stripeCalls[1].toString() === OFF_BODY, stripeCalls[1].toString());
    const fb = fbLines.filter((l) => l.includes('tax_fallback'));
    ok('… exactly one tax_fallback line, carrying Stripe\'s own code and neither the planted key nor the string the caller chose',
       fb.length === 1 && !fb[0].includes(KEY_SHAPE) && !fb[0].includes(ECHOED) && JSON.parse(fb[0]).fields_dropped === 2 && JSON.parse(fb[0]).retried === true, JSON.stringify(fb));
    ok('… and the readiness row is UNTOUCHED by the refusal, byte for byte: no attacker-influenced string flips the gate every other buyer reads',
       JSON.stringify(taxStateRow('tax:ready')) === rowBeforeRefusal, JSON.stringify(taxStateRow('tax:ready')));
    ok('… what it enqueued instead is exactly ONE background measurement, behind the response',
       fbQ.length === 1, 'enqueued=' + fbQ.length);
    const fbBg = await captureLogs(async () => { await Promise.all(fbQ); });
    ok('… and that measurement takes the lock and ASKS STRIPE rather than inferring anything from the message',
       stripeTaxCalls.length > 0 && fbBg.filter((l) => l.includes('"trigger":"session_refused"')).length === 1,
       'taxCalls=' + stripeTaxCalls.length + ' lines=' + JSON.stringify(fbBg.filter((l) => l.includes('tax_setup'))));
    ok('… Stripe said the account IS collecting, so the row still says ready — the refusal cost nobody their tax',
       (taxStateRow('tax:ready') || {}).count === 1, JSON.stringify(taxStateRow('tax:ready')));
    stripeCalls.length = 0;
    for (let i = 0; i < 5; i++) await bookAlone();
    ok('… and the five buyers behind that one are ALL taxed: round 4 sold every one of them untaxed on a string a stranger chose',
       stripeCalls.length === 5 && stripeCalls.every((b) => b.toString() === TAXED_BODY), 'bodies=' + stripeCalls.length + ' taxed=' + stripeCalls.filter((b) => b.toString() === TAXED_BODY).length);

    // ── a 5xx is not a refusal: Stripe did not read the body and say no, it failed to answer about it ──
    taxAccountReady(); forgetTaxState(); cacheTaxReady(); stripeCalls.length = 0; stripeTaxCalls.length = 0;
    const rowBefore5xx = JSON.stringify(taxStateRow('tax:ready'));
    const q5 = []; const ctx5 = { waitUntil: (p) => { q5.push(Promise.resolve(p).catch(() => {})); return p; } };
    sessionFail = { n: 1, status: 500, body: { error: { type: 'api_error', message: 'automatic_tax is temporarily unavailable' } } };
    let serverErr;
    const lines5 = await captureLogs(async () => { serverErr = await bookWith(ctx5); });
    ok('a 5xx mentioning tax is NOT retried: one attempt, one 502, and no second charge attempt on a Stripe that is already struggling',
       serverErr.status === 502 && stripeCalls.length === 1, serverErr.status + ' attempts=' + stripeCalls.length);
    ok('… no tax_fallback line, nothing enqueued, and the readiness row untouched',
       !lines5.some((l) => l.includes('tax_fallback')) && q5.length === 0 && JSON.stringify(taxStateRow('tax:ready')) === rowBefore5xx, JSON.stringify(taxStateRow('tax:ready')));
    sessionFail = null;

    // ── and nothing else is ever retried ──
    taxAccountReady(); forgetTaxState(); cacheTaxReady(); stripeCalls.length = 0;
    sessionFail = { n: 1, status: 402, body: { error: { type: 'card_error', code: 'card_declined', message: 'Your card was declined.' } } };
    let declinedRes;
    const declinedLines = await captureLogs(async () => { declinedRes = await bookAlone(); });
    ok('a refusal that is NOT about tax is not retried: one attempt, one 502, no second charge attempt',
       declinedRes.status === 502 && stripeCalls.length === 1, declinedRes.status + ' attempts=' + stripeCalls.length);
    ok('… no tax_fallback line, and the readiness row is untouched — a declined card says nothing about the Stripe account',
       !declinedLines.some((l) => l.includes('tax_fallback')) && (taxStateRow('tax:ready') || {}).count === 1, JSON.stringify(taxStateRow('tax:ready')));
    sessionFail = null;

    // ── tax_ready_cache: the field a workflow prints, describing the row a checkout reads ──
    const reportGet = async () => (await (await worker.fetch(new Request('https://api.test/admin/tax/setup?dry=1', { method: 'GET', headers: { 'X-Admin-Key': 'super-secret-admin-key', 'CF-Connecting-IP': nextIp() } }), on, ctx)).json());
    forgetTaxState(); cacheTaxReady(); ageTaxState('tax:ready', 5 * 60000);
    const c1 = (await reportGet()).tax_ready_cache;
    ok('tax_ready_cache is the row itself: when it was measured, how old, its TTL, its grace, and whether a re-measurement is due',
       c1.cached === true && Math.abs(c1.age_seconds - 300) <= 2 && c1.ttl_seconds === 600 && c1.grace_seconds === 86400
       && c1.stale === false && Date.parse(c1.measured_at) > 0, JSON.stringify(c1));
    ageTaxState('tax:ready', 20 * 60000);
    const r2 = await reportGet();
    ok('… a measurement past its TTL reads back STALE and still READY — that pair is the whole design, and round 3 could report neither',
       r2.tax_ready_cache.stale === true && r2.tax_ready_cache.age_seconds > 600 && r2.tax_ready === true && r2.tax_ready_reason === 'last_known_ready', JSON.stringify(r2.tax_ready_cache));
    forgetTaxState(); cacheTaxReady(2, 'timeout');
    const r3 = await reportGet();
    ok('… and a measurement that could not be MADE reports its own 60-second negative TTL, not the ten-minute one',
       r3.tax_ready_cache.ttl_seconds === 60 && r3.tax_ready === false, JSON.stringify(r3.tax_ready_cache));

    // ── the membership Price: the last tax field on a customer path, now behind the same gate and the same clock ──
    const joinRed = (e = on) => worker.fetch(new Request('https://api.test/create-membership', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://mastsolutions.com', 'CF-Connecting-IP': nextIp() },
      body: JSON.stringify({ plan: 'red_team', email: 'a@b.com', seats: 1 }) }), e, ctx);
    const freshPrice = () => { stripePriceCalls.length = 0; fakePrices.length = 0; delete fakePlans.red_team.stripe_price_id; };
    taxAccountReady(); forgetTaxState(); cacheTaxReady(0, 'settings_status:pending'); freshPrice();
    await joinRed();
    const notReadyPrice = stripePriceCalls.find((c) => c.method === 'POST');
    ok('a membership Price created while the account is NOT measured collecting carries no tax code — the same gate the Session uses, not the switch alone',
       notReadyPrice && !notReadyPrice.body.toString().includes('tax_code'), notReadyPrice && notReadyPrice.body.toString());
    forgetTaxState(); cacheTaxReady(); freshPrice();
    await joinRed();
    const readyPrice = stripePriceCalls.find((c) => c.method === 'POST');
    ok('… and carries it when the cached measurement says the account IS collecting',
       readyPrice && readyPrice.body.get('product_data[tax_code]') === 'txcd_20030000', readyPrice && readyPrice.body.toString());
    freshPrice();
    priceHang = new Promise(() => {});   // Stripe accepts the price call and never answers it
    const startedAt = RealDate.now();
    const hungJoin = await joinRed({ ...on, STRIPE_TAX_TIMEOUT_MS: '500' });
    const joinMs = RealDate.now() - startedAt;
    ok('a hung /v1/prices no longer holds a membership join open: both calls die on the Worker\'s own clock and the join answers cleanly',
       joinMs < 4000 && hungJoin.status === 400, 'elapsed=' + joinMs + 'ms status=' + hungJoin.status);
    priceHang = null;
    freshPrice();

    // ── ROUND 5, R5-1: a measurement that FAILED never drops a row that said ready inside the grace ──
    // Round 4 shipped the 24-hour grace and then let its own five-minute tick destroy it: taxMeasure wrote UNMEASURED
    // on any Stripe 5xx or timeout, and taxReadyCached graces only a row that says READY. Probed by the revenue lens at
    // 60 minutes of 500s — 12 orders, 11 of them untaxed — and at one bad tick, 3 of 6 buyers untaxed over 70 seconds.
    // A completed Checkout Session cannot be re-taxed, so each of those is margin the permit holder owes Texas.
    taxAccountReady(); forgetTaxState(); cacheTaxReady(); stripeTaxCalls.length = 0;
    taxFail = { on: '/tax/settings', method: 'GET', status: 500, body: { error: { message: 'Stripe is having a moment' } } };
    let outageTaxed = 0, outageUntaxed = 0;
    for (let i = 0; i < 12; i++) {
      await tick();
      stripeCalls.length = 0;
      await bookAlone();
      if (stripeCalls[0].toString() === TAXED_BODY) outageTaxed++; else outageUntaxed++;
      advance(5 * 60000);
    }
    ok('an hour of Stripe 500s with the tick firing every five minutes: 12 orders, ZERO untaxed — reverting this fix sells 10 of the 12 untaxed, measured',
       outageTaxed === 12 && outageUntaxed === 0, 'taxed=' + outageTaxed + ' untaxed=' + outageUntaxed);
    ok('… because the row is still the measurement that said ready, not an UNMEASURED one written over it by a failure',
       (taxStateRow('tax:ready') || {}).count === 1 && /\|active$/.test(String((taxStateRow('tax:ready') || {}).window_start)), JSON.stringify(taxStateRow('tax:ready')));
    ok('… with the failure recorded where a failure belongs — the heartbeat, which is what makes a dying loop visible',
       /\|tax-cron\/settings_read_failed$/.test(String((taxStateRow('tax:last_run') || {}).window_start)), JSON.stringify(taxStateRow('tax:last_run')));

    // ONE bad tick, then a burst — the shape a five-minute Stripe blip actually has. The row is aged past its TTL
    // first, or the tick reads a fresh cache and returns without measuring anything, and the probe measures nothing.
    taxAccountReady(); forgetTaxState(); cacheTaxReady(); ageTaxState('tax:ready', 11 * 60000); expireTaxWindow(); stripeTaxCalls.length = 0;
    taxFail = { on: '/tax/settings', method: 'GET', status: 500, body: { error: { message: 'Stripe is having a moment' } } };
    await tick();
    ok('(the tick really did try and really did fail)', stripeTaxCalls.length > 0 && /\|tax-cron\/settings_read_failed$/.test(String((taxStateRow('tax:last_run') || {}).window_start)),
       'taxCalls=' + stripeTaxCalls.length + ' beat=' + JSON.stringify(taxStateRow('tax:last_run')));
    taxFail = null;
    let burstTaxed = 0;
    for (let i = 0; i < 6; i++) { stripeCalls.length = 0; await bookAlone(); if (stripeCalls[0].toString() === TAXED_BODY) burstTaxed++; advance(12000); }
    ok('one failed tick, then six buyers over the next seventy seconds: all six taxed — reverting this fix sells all six untaxed',
       burstTaxed === 6, 'taxed=' + burstTaxed + '/6');

    // A MEASURED not-ready is the other direction, and it is unchanged: Stripe answered and said no.
    taxAccountReady(); forgetTaxState(); cacheTaxReady(); ageTaxState('tax:ready', 11 * 60000); expireTaxWindow();
    fakeTaxSettings = { status: 'pending', head_office: null, defaults: {} }; fakeTaxRegistrations.length = 0;
    taxFail = { on: '/tax/settings', method: 'POST', status: 402, body: { error: { type: 'invalid_request_error', code: 'tax_terms_not_accepted', message: 'Accept the Stripe Tax terms first.' } } };
    await tick();
    taxFail = null;
    ok('a MEASURED not-ready still overwrites the ready row at once: a real "no" from Stripe is evidence where its silence is not',
       (taxStateRow('tax:ready') || {}).count === 0, JSON.stringify(taxStateRow('tax:ready')));
    stripeCalls.length = 0;
    await bookAlone();
    ok('… so the very next order is the tax-off body, with no grace at all',
       stripeCalls[0].toString() === OFF_BODY, stripeCalls[0].toString());

    // And past the grace, a failure DOES overwrite — the grace protects a measurement, not a memory.
    taxAccountReady(); forgetTaxState(); cacheTaxReady(); expireTaxWindow();
    advance(25 * 3600000);
    taxFail = { on: '/tax/settings', method: 'GET', status: 500, body: { error: { message: 'Stripe is having a moment' } } };
    await tick();
    taxFail = null;
    ok('past 24 hours a failed measurement DOES replace the ready row with UNMEASURED: the grace has an end, and this is it',
       (taxStateRow('tax:ready') || {}).count === 2, JSON.stringify(taxStateRow('tax:ready')));
    stripeCalls.length = 0;
    await bookAlone();
    ok('… and 25 hours of silence still fails CLOSED, exactly as it did before',
       stripeCalls[0].toString() === OFF_BODY, stripeCalls[0].toString());

    // ── ROUND 5, R5-4: an unrecognised trigger runs the TICK, never the daily work ──
    // scheduled() branched on the tick string and treated everything else as the daily cron, so the fail direction was
    // 288 retention purges, 288 journey passes and 288 chances at the weekly digest in a day. Both strings are named now.
    taxAccountReady(); forgetTaxState(); cacheTaxReady();
    sqlDeletes = 0;
    const unknownLines = await captureLogs(() => tick('0 * * * *'));
    ok('a cron string the handler does not know runs the tax tick and nothing else: zero DELETEs, and it says so out loud',
       sqlDeletes === 0 && unknownLines.some((l) => l.includes('"unknown_cron":"0 * * * *"')),
       'deletes=' + sqlDeletes + ' ' + JSON.stringify(unknownLines.filter((l) => l.includes('cron'))));
    sqlDeletes = 0;
    await tick('');
    ok('… and an event carrying no cron string at all is the same — that is the shape round 4 defaulted into the daily branch',
       sqlDeletes === 0, 'deletes=' + sqlDeletes);
    sqlDeletes = 0;
    await tick(DAILY_CRON);
    ok('… while the daily string still does the daily work, so nothing was traded for the fix', sqlDeletes > 0, 'deletes=' + sqlDeletes);

    // ── the clock itself: bounded at BOTH ends, because a typo the other way removes it ──
    ok('STRIPE_TAX_TIMEOUT_MS is clamped above: 999999999 becomes 15000, so no override can leave a Stripe call without a clock',
       taxTimeoutMs({ STRIPE_TAX_TIMEOUT_MS: '999999999' }) === 15000 && taxTimeoutMs({ STRIPE_TAX_TIMEOUT_MS: '15001' }) === 15000,
       String(taxTimeoutMs({ STRIPE_TAX_TIMEOUT_MS: '999999999' })));
    ok('… and below: 1ms becomes 500ms, while 0, negative and nonsense still fall back to the 4s default',
       taxTimeoutMs({ STRIPE_TAX_TIMEOUT_MS: '1' }) === 500 && taxTimeoutMs({ STRIPE_TAX_TIMEOUT_MS: '4000' }) === 4000
       && taxTimeoutMs({ STRIPE_TAX_TIMEOUT_MS: '0' }) === 4000 && taxTimeoutMs({ STRIPE_TAX_TIMEOUT_MS: '-1' }) === 4000
       && taxTimeoutMs({ STRIPE_TAX_TIMEOUT_MS: 'abc' }) === 4000 && taxTimeoutMs({}) === 4000,
       JSON.stringify([1, 4000, 0, -1, 'abc'].map((v) => taxTimeoutMs({ STRIPE_TAX_TIMEOUT_MS: String(v) }))));
  } finally {
    globalThis.Date = RealDate;
    sessionFail = null; priceHang = null; taxFail = null; taxHang = null;
    taxAccountReady(); forgetTaxState();
  }
}

console.log('\n── Round 5: what is validated is what is sent, an allow-list on the enum fields, and a clock on the calls a customer waits behind ──');
{
  const on = { ...env, STRIPE_TAX: '1' };
  const bookRaw = (body, e = on, c = ctx) => worker.fetch(new Request('https://api.test/create-booking', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://mastsolutions.com', 'CF-Connecting-IP': nextIp() },
    body: JSON.stringify(body) }), e, c);

  /* ── R5-3: a field validated on a normalised copy and transmitted raw ──
     isEmail() trims before it tests, so " a@b.com " passed the check and then went to Stripe with its whitespace on.
     The approved string and the transmitted string have to be the same string. */
  taxAccountReady(); forgetTaxState(); stripeCalls.length = 0;
  await bookRaw({ sku: 'MAST-HG-FUND', customer_email: '  spaced@example.com  ', qty: 1 });
  ok('a booking email that passed validation TRIMMED is transmitted trimmed: what was approved is what Stripe receives',
     stripeCalls[0].get('customer_email') === 'spaced@example.com', JSON.stringify(stripeCalls[0].get('customer_email')));
  stripeCalls.length = 0;
  await worker.fetch(new Request('https://api.test/create-membership', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://mastsolutions.com', 'CF-Connecting-IP': nextIp() },
    body: JSON.stringify({ plan: 'range_member', email: '  spaced@example.com  ', seats: 1 }) }), on, ctx);
  ok('… and the same on a membership join, on the Session field AND the subscription metadata that becomes the CRM row',
     stripeCalls[0].get('customer_email') === 'spaced@example.com' && stripeCalls[0].get('subscription_data[metadata][email]') === 'spaced@example.com',
     JSON.stringify({ email: stripeCalls[0].get('customer_email'), meta: stripeCalls[0].get('subscription_data[metadata][email]') }));

  /* ── R5-5: the enum fields are an ALLOW-LIST, and the free-text ones learned four more shapes ──
     A denylist only removes what it has been told about; the shapes below are what turns up in a request body a
     stranger wrote, quoted back inside a Stripe error message. Planted on BOTH paths — the tax refusal and the ordinary
     one — because the raw Stripe body is printed on the second and nobody had checked it. */
  const SHAPES = {
    google: 'AIzaSy' + 'B'.repeat(33),
    aws: 'AKIA' + 'B'.repeat(16),
    slack: 'xoxb-' + '111111111111-abcdefABCDEF',
    jwt: ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxIiwibmFtZSI6IkpEIn0', 'abc_DEF-123'].join('.'),
    stripe: ['sk', 'live', '51NoTaReAlKeY0123456789'].join('_'),
  };
  const planted = Object.values(SHAPES).join(' ');
  const FILLER = ' ' + 'x'.repeat(400);   // so the 300-character cap on the raw body has something to bite on
  const echoes = (lines) => Object.entries(SHAPES).filter(([, v]) => lines.some((l) => l.includes(v))).map(([k]) => k);

  taxAccountReady(); forgetTaxState(); cacheTaxReady(); stripeCalls.length = 0;
  sessionFail = { n: 1, status: 400, body: { error: { type: 'invalid_request_error',
    message: 'automatic_tax registration refused: ' + planted + FILLER } } };
  const taxShapeLines = await captureAll(async () => { await bookRaw({ sku: 'MAST-HG-FUND', customer_email: 'a@b.com', qty: 1 }, on, { waitUntil: () => {} }); });
  ok('every planted credential shape is scrubbed out of a TAX refusal before any line is written',
     echoes(taxShapeLines).length === 0, 'echoed: ' + echoes(taxShapeLines).join(', '));

  taxAccountReady(); forgetTaxState(); cacheTaxReady(); stripeCalls.length = 0;
  sessionFail = { n: 1, status: 400, body: { error: { type: 'card_error', code: 'card_declined',
    message: 'Your card was declined: ' + planted + FILLER } } };
  const plainShapeLines = await captureAll(async () => { await bookRaw({ sku: 'MAST-HG-FUND', customer_email: 'a@b.com', qty: 1 }, on, { waitUntil: () => {} }); });
  ok('… and out of the ORDINARY error path too, which is where the whole Stripe body is printed and nobody had looked',
     echoes(plainShapeLines).length === 0, 'echoed: ' + echoes(plainShapeLines).join(', '));
  const rawLine = plainShapeLines.find((l) => l.includes('Stripe error:'));
  ok('… and that raw body is capped at 300 characters rather than mirrored whole into the log',
     !!rawLine && rawLine.endsWith('…') && rawLine.length < 360, rawLine && ('len=' + rawLine.length + ' ' + rawLine.slice(-40)));
  sessionFail = null;

  // The allow-list itself, on the three enum/id fields, through the report a POST returns when the window is held.
  const adminTax5 = (q = '', method = 'POST') => worker.fetch(new Request('https://api.test/admin/tax/setup' + q,
    { method, headers: { 'X-Admin-Key': 'super-secret-admin-key', 'CF-Connecting-IP': nextIp() } }), on, ctx);
  forgetTaxState(); stripeTaxCalls.length = 0;
  fakeTaxSettings = { status: 'active <script>alert(1)</script>', head_office: { address: { line1: '2450 Fondren Rd' } }, defaults: {} };
  fakeTaxRegistrations.length = 0;
  fakeTaxRegistrations.push({ id: 'taxreg_ok1', object: 'tax.registration', status: 'active', country: 'US', country_options: { us: { type: 'state_sales_tax', state: 'TX' } } });
  rateLimits.set('tax:lock', { key: 'tax:lock', window_start: new Date(Date.now() + 60000).toISOString(), count: 1 });
  const enumReport = await (await adminTax5()).json();
  // ROUND 7 MOVED THIS ONE FIELD EARLIER, and it is worth saying which half changed. R5-5 asserted that a status that
  // is not enum-shaped is replaced WHOLE by taxEnum in the report. The settings validator now asks the same question
  // one step before that — a status with a space and a tag in it is not a status this Worker can decide on — so the
  // run refuses and nothing Stripe said is reported at all. taxEnum's allow-list is unchanged and is pinned directly
  // on registration.id, above and below.
  ok('a settings status that is not enum-shaped does not reach the report at all now: the shape question is asked in the validator, one step before taxEnum',
     enumReport.step === 'settings.read' && enumReport.error.code === 'settings_status_invalid'
     && !JSON.stringify(enumReport).includes('<script>'), JSON.stringify(enumReport).slice(0, 240));
  forgetTaxState(); stripeTaxCalls.length = 0;
  fakeTaxSettings = { status: 'active', head_office: { address: { line1: '2450 Fondren Rd' } }, defaults: {} };
  rateLimits.set('tax:lock', { key: 'tax:lock', window_start: new Date(Date.now() + 60000).toISOString(), count: 1 });
  const enumReport2 = await (await adminTax5()).json();
  ok('… while the id and type that ARE shaped as Stripe writes them come through untouched, so the report still says something',
     enumReport2.registration.id === 'taxreg_ok1' && enumReport2.registration.type === 'state_sales_tax' && enumReport2.registration.status === 'active', JSON.stringify(enumReport2.registration));
  forgetTaxState(); taxAccountReady();

  /* ── R5-6: the three Stripe calls a customer waits behind are on a clock, and the two Session attempts share ONE ──
     ensureStripeCustomer's POST /v1/customers and stripeDefaultCard were raw fetch with no AbortController while the
     tax reads beside them were bounded; round 5's retry then made the Session create run up to twice. Two unbounded
     waits on one customer is not a ceiling. */
  ok('STRIPE_CHECKOUT_TIMEOUT_MS is clamped at both ends like the tax clock, and defaults to 8s',
     checkoutTimeoutMs({}) === 8000 && checkoutTimeoutMs({ STRIPE_CHECKOUT_TIMEOUT_MS: '999999999' }) === 15000
     && checkoutTimeoutMs({ STRIPE_CHECKOUT_TIMEOUT_MS: '1' }) === 500 && checkoutTimeoutMs({ STRIPE_CHECKOUT_TIMEOUT_MS: '0' }) === 8000
     && checkoutTimeoutMs({ STRIPE_CHECKOUT_TIMEOUT_MS: 'abc' }) === 8000,
     JSON.stringify([{}, '999999999', '1', '0', 'abc'].map((v) => checkoutTimeoutMs(typeof v === 'string' ? { STRIPE_CHECKOUT_TIMEOUT_MS: v } : v))));

  // A real account, made here so the block owns its own state: register, read the code out of the email, verify.
  emails.length = 0;
  await post('/account/register', { email: 'clock@example.com', password: 'a long enough password', name: 'Clock Test' });
  const clockCode = (/\b(\d{6})\b/.exec((emails[0] && emails[0].text) || '') || [])[1];
  const verified = await (await post('/account/verify', { email: 'clock@example.com', code: clockCode })).json();
  const authed = (path, body, e = env) => worker.fetch(new Request('https://api.test' + path, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://mastsolutions.com', Authorization: 'Bearer ' + verified.token, 'CF-Connecting-IP': nextIp() },
    body: JSON.stringify(body || {}) }), e, ctx);
  ok('(fixture) a verified account with no Stripe customer yet', typeof verified.token === 'string' && !accounts.get(verified.account.id).stripe_customer_id, JSON.stringify(verified.account && verified.account.email));

  const fastCustomer = { ...env, STRIPE_CHECKOUT_TIMEOUT_MS: '400' };
  customerHang = new Promise(() => {});
  let cardStart = Date.now();
  const hungCard = await authed('/account/setup-payment', {}, fastCustomer);
  const cardMs = Date.now() - cardStart;
  ok('a hung POST /v1/customers no longer holds a signed-in checkout open: it dies on the checkout clock and answers 503',
     cardMs < 3000 && hungCard.status === 503, 'elapsed=' + cardMs + 'ms status=' + hungCard.status);
  cardStart = Date.now();
  const hungMe = await worker.fetch(new Request('https://api.test/account/me', { method: 'GET',
    headers: { Origin: 'https://mastsolutions.com', Authorization: 'Bearer ' + verified.token } }), fastCustomer, ctx);
  const meMs = Date.now() - cardStart;
  ok('… and a hung saved-card read no longer holds /account/me open either: the page loads without the card',
     meMs < 3000 && hungMe.status === 200 && (await hungMe.json()).payment_method === null, 'elapsed=' + meMs + 'ms status=' + hungMe.status);
  customerHang = null;

  // The shared budget. First attempt slow and refusing for a tax reason, second attempt never answering: if the retry
  // got its own ceiling the customer would wait for two of them.
  taxAccountReady(); forgetTaxState(); cacheTaxReady(); stripeCalls.length = 0;
  stripeGate = (n) => (n === 1 ? new Promise((r) => setTimeout(r, 700)) : new Promise(() => {}));
  sessionFail = { n: 1, status: 400, body: { error: { type: 'invalid_request_error', message: 'Stripe Tax is not active on this account (automatic_tax).' } } };
  const budgetStart = Date.now();
  const budgetRes = await bookRaw({ sku: 'MAST-HG-FUND', customer_email: 'a@b.com', qty: 1 }, { ...on, STRIPE_CHECKOUT_TIMEOUT_MS: '1000' }, { waitUntil: () => {} });
  const budgetMs = Date.now() - budgetStart;
  ok('both Session attempts live inside ONE ceiling: a 700ms refusal plus a retry that never answers costs the customer one second, not two',
     budgetMs >= 850 && budgetMs < 1500 && stripeCalls.length === 2 && budgetRes.status === 502,
     'elapsed=' + budgetMs + 'ms attempts=' + stripeCalls.length + ' status=' + budgetRes.status);

  // And with nothing left in the budget the retry is not started at all.
  taxAccountReady(); forgetTaxState(); cacheTaxReady(); stripeCalls.length = 0;
  stripeGate = (n) => (n === 1 ? new Promise((r) => setTimeout(r, 300)) : new Promise(() => {}));
  sessionFail = { n: 1, status: 400, body: { error: { type: 'invalid_request_error', message: 'Stripe Tax is not active on this account (automatic_tax).' } } };
  const noBudget = await captureAll(async () => { await bookRaw({ sku: 'MAST-HG-FUND', customer_email: 'a@b.com', qty: 1 }, { ...on, STRIPE_CHECKOUT_TIMEOUT_MS: '500' }, { waitUntil: () => {} }); });
  const fbSkipped = noBudget.filter((l) => l.includes('tax_fallback'));
  ok('… and when the first attempt has spent the budget the retry is skipped rather than started without a clock',
     stripeCalls.length === 1 && (fbSkipped.length === 0 || JSON.parse(fbSkipped[0]).retried === false),
     'attempts=' + stripeCalls.length + ' ' + JSON.stringify(fbSkipped));
  stripeGate = null; sessionFail = null; customerHang = null;
  taxAccountReady(); forgetTaxState();
}

console.log('\n── Round 6: an unparseable 200 is not a measurement, the cap the allow-list dropped, and the streak that names the double fault ──');
{
  const on = { ...env, STRIPE_TAX: '1' };
  const booking = { sku: 'MAST-HG-FUND', customer_email: 'a@b.com', qty: 1 };
  const bookWith = (c, e = on) => worker.fetch(new Request('https://api.test/create-booking', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://mastsolutions.com', 'CF-Connecting-IP': nextIp() },
    body: JSON.stringify(booking) }), e, c);
  const bookAlone = () => bookWith({});
  const adminTax6 = (q = '', method = 'POST') => worker.fetch(new Request('https://api.test/admin/tax/setup' + q,
    { method, headers: { 'X-Admin-Key': 'super-secret-admin-key', 'CF-Connecting-IP': nextIp() } }), on, ctx);

  // Measured, not copied: the tax-off body is one checkout with the switch off, and the taxed one is that plus the two
  // fields applyTax appends.
  stripeCalls.length = 0;
  await bookWith({}, { ...env, STRIPE_TAX: '0' });
  const OFF_BODY = stripeCalls[0].toString();
  const TAXED_BODY = OFF_BODY + '&automatic_tax%5Benabled%5D=true&line_items%5B0%5D%5Bprice_data%5D%5Bproduct_data%5D%5Btax_code%5D=txcd_20030000';

  const RealDate = Date;
  let skew = 0;
  class VirtualDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(RealDate.now() + skew); else super(...a); }
    static now() { return RealDate.now() + skew; }
  }
  const advance = (ms) => { skew += ms; };
  globalThis.Date = VirtualDate;

  try {
    const tick = async (cron = '*/5 * * * *') => {
      const q = [];
      await worker.scheduled({ cron, scheduledTime: Date.now() }, on, { waitUntil: (p) => q.push(Promise.resolve(p).catch(() => {})) });
      await Promise.all(q);
    };
    const beat = () => String((taxStateRow('tax:last_run') || {}).window_start || '');
    const readyRow = () => taxStateRow('tax:ready');

    /* ── R6-1: a 200 whose body cannot be understood is SILENCE, not a measured not-ready ──
       Round 5 defined a failed measurement as !res.ok, so a 200 carrying {} or a proxy's HTML, or a registrations list
       with no data array, overwrote the row that said ready — taking the whole 24-hour grace with it and selling the
       next order untaxed with no grace at all. Three shapes, each with a ready row inside the grace. */
    const UNPARSEABLE = [
      ['a 200 with an empty body', { on: '/tax/settings', method: 'GET', status: 200, body: {} }, 'settings_unparseable'],
      ['a 200 carrying a proxy\'s HTML error page', { on: '/tax/settings', method: 'GET', status: 200, raw: '<html>502 Bad Gateway</html>' }, 'settings_unparseable'],
      ['a registrations list with no data array', { on: '/tax/registrations', method: 'GET', status: 200, body: { object: 'list' } }, 'registrations_unparseable'],
    ];
    for (const [what, shape, reason] of UNPARSEABLE) {
      taxAccountReady(); forgetTaxState(); cacheTaxReady(); stripeTaxCalls.length = 0;
      taxFail = shape;
      let taxed = 0, untaxed = 0;
      for (let i = 0; i < 6; i++) {
        await tick();
        stripeCalls.length = 0;
        await bookAlone();
        if (stripeCalls[0].toString() === TAXED_BODY) taxed++; else untaxed++;
        advance(5 * 60000);
      }
      taxFail = null;
      ok('an unparseable 200 (' + what + ') keeps the grace: 6 orders over 30 minutes, ZERO untaxed — reverting this sells 4 of the 6 untaxed, measured',
         taxed === 6 && untaxed === 0, 'taxed=' + taxed + ' untaxed=' + untaxed);
      ok('… because the ready row was never overwritten: what came back was silence wearing a 200, and silence is not evidence',
         (readyRow() || {}).count === 1 && /\|active$/.test(String((readyRow() || {}).window_start)), JSON.stringify(readyRow()));
      ok('… with the failure in the heartbeat, naming the shape: ' + reason,
         new RegExp('\\|tax-cron/' + reason + '$').test(beat()), beat());

      // The other half of the same rule: with nothing to grace, an unparseable 200 still fails CLOSED.
      forgetTaxState(); taxFail = shape;
      await tick();
      taxFail = null;
      ok('… and with NO ready row behind it the same body is UNMEASURED (count 2) on the 60-second negative TTL, not a measured no',
         (readyRow() || {}).count === 2 && new RegExp('\\|' + reason + '$').test(String((readyRow() || {}).window_start)), JSON.stringify(readyRow()));
      stripeCalls.length = 0;
      await bookAlone();
      ok('… so that order is the tax-off body, byte for byte: fail-closed is unchanged where there is nothing to grace',
         stripeCalls[0].toString() === OFF_BODY, stripeCalls[0].toString());
    }

    // 200-empty and 200-garbage are the same decision and NOT the same event, and the log line has to be able to say so.
    const measureLine = (lines) => JSON.parse(lines.find((l) => l.includes('"tax_measure":"failed"')) || '{}');
    taxAccountReady(); forgetTaxState(); cacheTaxReady(); ageTaxState('tax:ready', 11 * 60000); expireTaxWindow();
    taxFail = { on: '/tax/settings', method: 'GET', status: 200, raw: '<html>502 Bad Gateway</html>' };
    const garbageLines = await captureLogs(() => tick());
    taxAccountReady(); forgetTaxState(); cacheTaxReady(); ageTaxState('tax:ready', 11 * 60000); expireTaxWindow();
    taxFail = { on: '/tax/settings', method: 'GET', status: 200, body: {} };
    const emptyLines = await captureLogs(() => tick());
    taxFail = null;
    ok('… and the log line tells 200-empty from 200-garbage apart: same decision, different event, and only one of them is a Stripe that answered',
       measureLine(garbageLines).parse_error === true && measureLine(emptyLines).parse_error === false
       && measureLine(garbageLines).reason === 'settings_unparseable' && measureLine(emptyLines).reason === 'settings_unparseable',
       JSON.stringify([measureLine(garbageLines), measureLine(emptyLines)]));

    /* ── R9-2 (supersedes R6-2): the DECIDING SCHEMA has a size as well as a shape ──
       Round 6 capped taxEnum because ^[a-z_]+$ is satisfied by a 50,000-character lowercase status, and then round 8
       wrote the SCHEMA — the thing that decides whether a body was measured at all — with no length in it. So the
       50,000-character status came back BYTE-SHAPE-VALID: measured:true, a measured `settings_status:aaa…`, and the
       ready row inside its 24-hour grace destroyed by a body no Stripe account produces. The cap downstream limited
       what got PRINTED; it never touched what got DECIDED. Every enum-shaped rule carries {0,59} now, so the boundary
       is a real pair rather than an assertion about one side of it: 60 characters is measured, 61 is unparseable. */
    const enumStatus = (n) => 'a'.repeat(n);
    taxAccountBlank(); forgetTaxState(); expireTaxWindow();
    fakeTaxSettings = { status: enumStatus(60), head_office: { address: { line1: '2450 Fondren Rd' } }, defaults: {} };
    fakeTaxRegistrations.length = 0;
    // The account must stay unrepaired, or the run's own write turns it active and the row never records the status.
    taxFail = { on: '/tax/settings', method: 'POST', status: 402, body: { error: { type: 'invalid_request_error', code: 'tax_terms_not_accepted', message: 'Accept the Stripe Tax terms first.' } } };
    await tick();
    const capNote = String((readyRow() || {}).window_start || '').split('|')[1] || '';
    ok('60 characters is the bound, and the value ON it is still a MEASURED answer: enum-shaped, inside TAX_ENUM_MAX, persisted whole and not truncated',
       (readyRow() || {}).count === 0 && capNote === 'settings_status:' + enumStatus(60),
       'count=' + (readyRow() || {}).count + ' len=' + capNote.length + ' head=' + capNote.slice(0, 24));

    // …and ONE character past it is not a smaller answer, it is NO answer: shape failure, unmeasured, grace kept.
    taxAccountReady(); forgetTaxState(); cacheTaxReady(); ageTaxState('tax:ready', 11 * 60000); expireTaxWindow();
    fakeTaxSettings = { status: enumStatus(61), head_office: { address: { line1: '2450 Fondren Rd' } }, defaults: {} };
    const overBefore = JSON.stringify(readyRow());
    await tick();
    ok('61 characters is a SHAPE failure — over-length is unmeasured, not a measured no, so the ready row inside its grace is byte-identical',
       JSON.stringify(readyRow()) === overBefore && /\|tax-cron\/settings_unparseable$/.test(beat()),
       'row=' + JSON.stringify(readyRow()) + ' beat=' + beat());
    stripeCalls.length = 0;
    await bookAlone();
    ok('… and the order behind it is still TAXED: a 100,000-character lowercase status can no longer destroy a ready row and sell the next sale untaxed',
       stripeCalls[0].toString() === TAXED_BODY, stripeCalls[0].toString());

    taxAccountReady(); forgetTaxState(); cacheTaxReady(); ageTaxState('tax:ready', 11 * 60000); expireTaxWindow();
    fakeTaxSettings = { status: enumStatus(100000), head_office: { address: { line1: '2450 Fondren Rd' } }, defaults: {} };
    const hugeBefore = JSON.stringify(readyRow());
    await tick();
    taxFail = null;
    ok('… the same at 100,000 characters, which is the shape the finding was written against',
       JSON.stringify(readyRow()) === hugeBefore, 'row=' + JSON.stringify(readyRow()));

    forgetTaxState();
    rateLimits.set('tax:lock', { key: 'tax:lock', window_start: new Date(Date.now() + 60000).toISOString(), count: 1 });
    const capRep = await (await adminTax6()).json();
    ok('… and the report of an over-length status is the named unparseable error, carrying the failing field rather than 100,000 characters of it',
       capRep.error && capRep.error.type === 'unparseable_response' && capRep.error.code === 'settings_status_invalid'
       && JSON.stringify(capRep).length < 2000,
       'bytes=' + JSON.stringify(capRep).length + ' ' + JSON.stringify(capRep.error).slice(0, 120));
    forgetTaxState(); taxAccountReady();

    /* ── R6-4: has_more is the page saying "you have not looked at all of it" ──
       The readiness read is one page deep. A Texas row past the first hundred registrations read as a MEASURED
       "no Texas registration", which turns tax off — so it is unmeasured now, and the grace applies. */
    taxAccountReady(); forgetTaxState(); cacheTaxReady(); ageTaxState('tax:ready', 11 * 60000); expireTaxWindow();
    fakeTaxRegistrations.length = 0; fakeTaxHasMore = true;
    const pagedBefore = JSON.stringify(readyRow());
    await tick();
    ok('a registrations page carrying has_more with no Texas row ON it is not a measured no: the ready row is untouched, byte for byte',
       JSON.stringify(readyRow()) === pagedBefore, JSON.stringify(readyRow()));
    ok('… and the heartbeat says which kind of not-looked it was: registrations_paged', /\|tax-cron\/registrations_paged$/.test(beat()), beat());
    stripeCalls.length = 0;
    await bookAlone();
    ok('… so an account whose Texas registration is on page two still taxes the order instead of silently not collecting',
       stripeCalls[0].toString() === TAXED_BODY, stripeCalls[0].toString());

    taxAccountReady(); forgetTaxState(); cacheTaxReady(); ageTaxState('tax:ready', 11 * 60000); expireTaxWindow();
    fakeTaxHasMore = true;   // Texas IS on this page, and there are more pages after it
    await tick();
    ok('… while a Texas row ON the page is a measurement whatever has_more says — the second page cannot unmake a hit',
       (readyRow() || {}).count === 1 && /\|active$/.test(String((readyRow() || {}).window_start)), JSON.stringify(readyRow()));

    forgetTaxState(); fakeTaxRegistrations.length = 0; fakeTaxHasMore = true; expireTaxWindow();
    await tick();
    ok('… and with no ready row behind it, has_more fails CLOSED as UNMEASURED rather than as a measured no',
       (readyRow() || {}).count === 2 && /\|registrations_paged$/.test(String((readyRow() || {}).window_start)), JSON.stringify(readyRow()));
    fakeTaxHasMore = false; taxAccountReady(); forgetTaxState();

    /* ── R6-3: the double fault, counted ──
       Tax endpoints unreadable (so the grace holds the row at READY) AND Stripe refusing every tax-carrying Session.
       Every order pays for two Session creates, every order completes UNTAXED, tax_ready keeps saying true, and for
       24 hours nothing counts it. The counter is a counter: nothing gates on it, and the readiness row is still
       unreachable from the refusal path. */
    const REFUSAL = { type: 'invalid_request_error', code: 'tax_registration_incomplete', message: 'Stripe Tax is not active on this account (automatic_tax).' };
    const taxCarrying = (params) => !!(params && params.get('automatic_tax[enabled]'));
    taxAccountReady(); forgetTaxState(); cacheTaxReady(); stripeTaxCalls.length = 0;
    const dq = [];
    const dctx = { waitUntil: (p) => { dq.push(Promise.resolve(p).catch(() => {})); return p; } };
    const rowBeforeDouble = JSON.stringify(readyRow());
    taxFail = { on: '/tax/', method: 'GET', status: 500, body: { error: { message: 'Stripe is having a moment' } } };
    sessionFail = { n: 99, status: 400, when: taxCarrying, body: { error: REFUSAL } };
    let sold = 0, soldUntaxed = 0;
    for (let i = 0; i < 6; i++) {
      stripeCalls.length = 0;
      const r = await bookWith(dctx);
      if (r.status === 200) sold++;
      if (stripeCalls.length === 2 && stripeCalls[0].toString() === TAXED_BODY && stripeCalls[1].toString() === OFF_BODY) soldUntaxed++;
      await Promise.all(dq.splice(0));
      expireTaxWindow();
      advance(11 * 60000);
    }
    sessionFail = null;
    const doubleReport = await (await adminTax6('?dry=1', 'GET')).json();
    ok('the double fault, staged: six bookings, every one sold, every one sold UNTAXED on the retry — and every one of them looks fine from the outside',
       sold === 6 && soldUntaxed === 6, 'sold=' + sold + ' untaxed=' + soldUntaxed);
    ok('… and it is COUNTED now: tax_fallback_streak 6, beside a tax_ready that still says true and a cache that still looks healthy',
       doubleReport.tax_fallback_streak === 6 && doubleReport.tax_ready === true, JSON.stringify({ streak: doubleReport.tax_fallback_streak, ready: doubleReport.tax_ready, run: doubleReport.last_run }));
    ok('… with a note in words past three in a row, because six lines in a stream nobody reads is not a signal',
       (doubleReport.notes || []).some((n) => n.includes('tax_fallback_streak is 6')), JSON.stringify(doubleReport.notes));
    ok('… and the readiness row is STILL untouched across all six: the streak is a counter with nothing behind it, not the round-4 de-tax write coming back',
       JSON.stringify(readyRow()) === rowBeforeDouble, JSON.stringify(readyRow()));

    // What clears it, half one: a tax-carrying Session that Stripe ACCEPTS. The window is held, so no measurement can
    // be the thing that cleared it.
    taxFail = null;
    rateLimits.set('tax:lock', { key: 'tax:lock', window_start: new Date(Date.now() + 60000).toISOString(), count: 1 });
    stripeCalls.length = 0; stripeTaxCalls.length = 0;
    await bookWith(dctx);
    await Promise.all(dq.splice(0));
    const afterSession = await (await adminTax6('?dry=1', 'GET')).json();
    ok('one tax-carrying Session that Stripe ACCEPTS clears the streak — and with the window held, no measurement ran at all, so that is what cleared it',
       afterSession.tax_fallback_streak === 0 && stripeTaxCalls.length === 0 && stripeCalls.length === 1 && stripeCalls[0].toString() === TAXED_BODY,
       'streak=' + afterSession.tax_fallback_streak + ' taxCalls=' + stripeTaxCalls.length + ' attempts=' + stripeCalls.length);

    // What clears it, half two: a measurement Stripe actually answers. Two more refusals with the tax reads still at
    // 500 to set it, then one clean tick.
    taxFail = { on: '/tax/', method: 'GET', status: 500, body: { error: { message: 'Stripe is having a moment' } } };
    sessionFail = { n: 2, status: 400, when: taxCarrying, body: { error: REFUSAL } };
    for (let i = 0; i < 2; i++) { await bookWith(dctx); await Promise.all(dq.splice(0)); expireTaxWindow(); advance(60000); }
    sessionFail = null;
    const midStreak = (await (await adminTax6('?dry=1', 'GET')).json()).tax_fallback_streak;
    taxFail = null; expireTaxWindow();
    await tick();
    const afterMeasure = (await (await adminTax6('?dry=1', 'GET')).json()).tax_fallback_streak;
    ok('… and a measurement Stripe answers clears it too: the streak is the double FAULT, so either half ending stops it counting',
       midStreak === 2 && afterMeasure === 0, 'mid=' + midStreak + ' after=' + afterMeasure);
    ok('… while a streak below three is reported as a number and nothing else — no note, no words, no alarm on one refused Session',
       !(((await (await adminTax6('?dry=1', 'GET')).json()).notes || []).some((n) => n.includes('tax_fallback_streak'))), 'streak=' + afterMeasure);

    /* ── R6-5: the denylist learns the canonical classes, and active_from stops being free text ── */
    const SHAPES6 = {
      github_pat: 'ghp_' + 'A'.repeat(36),
      github_oauth: 'gho_' + 'B'.repeat(36),
      github_server: 'ghs_' + 'C'.repeat(36),
      gitlab: 'glpat-' + 'D'.repeat(20),
      revenuecat: 'appl_' + 'E'.repeat(20),
      twilio_ac: 'AC' + 'a1'.repeat(16),
      twilio_sk: 'SK' + 'b2'.repeat(16),
      opaque_hex: 'api_key=' + 'f'.repeat(40),
    };
    const planted6 = Object.values(SHAPES6).join(' ');
    const echoes6 = (lines) => Object.entries(SHAPES6).filter(([, v]) => lines.some((l) => String(l).includes(v))).map(([k]) => k);
    const FILLER6 = ' ' + 'x'.repeat(400);

    taxAccountReady(); forgetTaxState(); cacheTaxReady(); stripeCalls.length = 0;
    sessionFail = { n: 1, status: 400, body: { error: { type: 'invalid_request_error', message: 'automatic_tax registration refused: ' + planted6 + FILLER6 } } };
    const taxClass6 = await captureAll(async () => { await bookWith({ waitUntil: () => {} }); });
    ok('the canonical credential classes the round-5 denylist still missed — GitHub, GitLab, RevenueCat, Twilio, an opaque hex beside its own label — are scrubbed out of a TAX refusal',
       echoes6(taxClass6).length === 0, 'echoed: ' + echoes6(taxClass6).join(', '));

    taxAccountReady(); forgetTaxState(); cacheTaxReady(); stripeCalls.length = 0;
    sessionFail = { n: 1, status: 400, body: { error: { type: 'card_error', code: 'card_declined', message: 'Your card was declined: ' + planted6 + FILLER6 } } };
    const plain6 = await captureAll(async () => { await bookWith({ waitUntil: () => {} }); });
    ok('… and out of the ordinary refusal too, which is the path that prints the whole Stripe body',
       echoes6(plain6).length === 0, 'echoed: ' + echoes6(plain6).join(', '));
    sessionFail = null;

    // active_from is a TIMESTAMP. It was the one Stripe-controlled field on the success path still going through the
    // free-text scrubber, which can only remove the shapes it has been told about.
    const schedule = (activeFrom) => {
      forgetTaxState(); stripeTaxCalls.length = 0;
      fakeTaxSettings = { status: 'active', head_office: { address: { line1: '2450 Fondren Rd' } }, defaults: {} };
      fakeTaxRegistrations.length = 0;
      fakeTaxRegistrations.push({ id: 'taxreg_sched1', object: 'tax.registration', status: 'scheduled', country: 'US',
        country_options: { us: { type: 'state_sales_tax', state: 'TX' } }, active_from: activeFrom });
      rateLimits.set('tax:lock', { key: 'tax:lock', window_start: new Date(Date.now() + 60000).toISOString(), count: 1 });
      return adminTax6().then((r) => r.text());
    };
    const plantedFrom = await schedule(planted6);
    // ROUND 6 ASSERTED taxDate REPLACED IT WHOLE; ROUND 8 NEVER GETS THERE, and the change of route is written down
    // rather than quietly edited. active_from is in the row schema now, so a value that is neither unix seconds nor an
    // ISO-8601 date-time makes the whole list unparseable and the run refuses — strictly stronger than the property
    // R6-5 pinned, because nothing Stripe said reaches the report at all. taxDate still runs on the values that pass.
    ok('a key shape planted in registration.active_from never reaches the report: the schema asks the shape question one step before taxDate, so the list is unparseable and the run refuses',
       JSON.parse(plantedFrom).error.code === 'row_0_active_from_invalid' && echoes6([plantedFrom]).length === 0, plantedFrom.slice(0, 200));
    const isoFrom = await schedule('2027-01-01T00:00:00Z');
    const unixFrom = await schedule('1798761600');
    ok('… while the two shapes a timestamp IS allowed to be come through untouched, so the report still says when it starts collecting',
       isoFrom.includes('active_from 2027-01-01T00:00:00Z') && unixFrom.includes('active_from 1798761600'),
       JSON.stringify([isoFrom.slice(0, 60), unixFrom.slice(0, 60)]));
    forgetTaxState(); taxAccountReady();
  } finally {
    globalThis.Date = RealDate;
    sessionFail = null; priceHang = null; taxFail = null; taxHang = null; fakeTaxHasMore = false;
    taxAccountReady(); forgetTaxState();
  }
}

console.log('\n── Round 7: a shape is checked at every level, every Stripe string is capped, and a redactor has no anchors ──');
{
  const on = { ...env, STRIPE_TAX: '1' };
  const booking = { sku: 'MAST-HG-FUND', customer_email: 'a@b.com', qty: 1 };
  const bookWith = (c, e = on) => worker.fetch(new Request('https://api.test/create-booking', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://mastsolutions.com', 'CF-Connecting-IP': nextIp() },
    body: JSON.stringify(booking) }), e, c);
  const bookAlone = () => bookWith({});
  const adminTax7 = (q = '', method = 'POST') => worker.fetch(new Request('https://api.test/admin/tax/setup' + q,
    { method, headers: { 'X-Admin-Key': 'super-secret-admin-key', 'CF-Connecting-IP': nextIp() } }), on, ctx);

  stripeCalls.length = 0;
  await bookWith({}, { ...env, STRIPE_TAX: '0' });
  const OFF_BODY = stripeCalls[0].toString();
  const TAXED_BODY = OFF_BODY + '&automatic_tax%5Benabled%5D=true&line_items%5B0%5D%5Bprice_data%5D%5Bproduct_data%5D%5Btax_code%5D=txcd_20030000';

  const RealDate = Date;
  let skew = 0;
  class VirtualDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(RealDate.now() + skew); else super(...a); }
    static now() { return RealDate.now() + skew; }
  }
  const advance = (ms) => { skew += ms; };
  globalThis.Date = VirtualDate;

  try {
    const tick = async (cron = '*/5 * * * *') => {
      const q = [];
      await worker.scheduled({ cron, scheduledTime: Date.now() }, on, { waitUntil: (p) => q.push(Promise.resolve(p).catch(() => {})) });
      await Promise.all(q);
    };
    const beat = () => String((taxStateRow('tax:last_run') || {}).window_start || '');
    const readyRow = () => taxStateRow('tax:ready');
    const settingsActive = () => { fakeTaxSettings = { status: 'active', head_office: { address: { line1: '2450 Fondren Rd' } }, defaults: { tax_behavior: 'exclusive', tax_code: 'txcd_20030000' } }; };
    // A ready row, measured, with the re-measurement DUE — the state every "does a bad read drop the grace" probe needs.
    const graced = () => { forgetTaxState(); cacheTaxReady(); ageTaxState('tax:ready', 11 * 60000); expireTaxWindow(); };

    /* ── R7-1: the ROW is a shape too, and it is the level round 6 stopped one short of ──
       Round 6 type-checked the containers — settings.status a string, `data` an Array — and then handed every row
       inside that Array to isTexasSalesTax, which reads five nested fields on faith. A registration whose
       country_options an API version renamed therefore came back as a confident FALSE: a MEASURED "this account has no
       Texas registration", which turns tax off for the full TTL and, through taxRun, creates a second one. */
    const DRIFTED = { id: 'taxreg_drift', object: 'tax.registration', status: 'active', country: 'US',
      jurisdiction: { us: { type: 'state_sales_tax', state: 'TX' } } };   // country_options, renamed by a version bump
    settingsActive(); graced();
    fakeTaxRegistrations.length = 0; fakeTaxRegistrations.push({ ...DRIFTED });
    const driftBefore = JSON.stringify(readyRow());
    const driftLines = await captureLogs(() => tick());
    ok('a registration row whose country_options an API version renamed is NOT a measured "no Texas registration": the ready row is untouched, byte for byte',
       JSON.stringify(readyRow()) === driftBefore, JSON.stringify(readyRow()));
    ok('… and the heartbeat says the shape failed rather than that Texas is missing', /\|tax-cron\/registrations_unparseable$/.test(beat()), beat());
    const driftLog = JSON.parse(driftLines.find((l) => l.includes('"tax_measure":"failed"')) || '{}');
    ok('… and the log line names WHICH row and WHICH field, because "unparseable" alone is not something an operator can act on',
       driftLog.shape === 'row_0_country_options_missing', JSON.stringify(driftLog));
    stripeCalls.length = 0;
    await bookAlone();
    ok('… so the next order is TAXED on the grace — reverting the row validator sells it untaxed instead',
       stripeCalls[0].toString() === TAXED_BODY, stripeCalls[0].toString());

    forgetTaxState(); expireTaxWindow();
    await tick();
    ok('… and with no ready row behind it the same row is UNMEASURED (count 2) on the short negative TTL, not a measured no',
       (readyRow() || {}).count === 2 && /\|registrations_unparseable$/.test(String((readyRow() || {}).window_start)), JSON.stringify(readyRow()));

    /* The other half of the same read, and the one that is not undoable: the SETUP path. Reverting round 6's fix was
       measured to create a SECOND Texas registration, because an unreadable list came out of the old
       `Array.isArray ? … : []` as zero rows, which is indistinguishable from "there is no Texas registration". */
    settingsActive(); forgetTaxState(); stripeTaxCalls.length = 0;
    fakeTaxRegistrations.length = 0; fakeTaxRegistrations.push({ ...DRIFTED });
    const driftedSetup = await (await adminTax7()).json();
    ok('an admin setup run against a drifted registration list creates NOTHING: a POST on an unmeasured absence is how a second, non-undoable Texas registration is made',
       stripeTaxCalls.filter((c) => c.method === 'POST').length === 0 && driftedSetup.step === 'registrations.read:active'
       && driftedSetup.error.code === 'row_0_country_options_missing' && driftedSetup.error.type === 'unparseable_response',
       JSON.stringify({ posts: stripeTaxCalls.filter((c) => c.method === 'POST').length, step: driftedSetup.step, code: driftedSetup.error && driftedSetup.error.code }));

    settingsActive(); forgetTaxState(); stripeTaxCalls.length = 0;
    fakeTaxRegistrations.length = 0; fakeTaxHasMore = true;
    const pagedSetup = await (await adminTax7()).json();
    fakeTaxHasMore = false;
    ok('… and a list with a page this run did not read creates nothing either: "I did not look" is not "there is none"',
       stripeTaxCalls.filter((c) => c.method === 'POST').length === 0
       && (pagedSetup.notes || []).some((n) => n.includes('registration: NOT created') && n.includes('has_more')),
       JSON.stringify({ posts: stripeTaxCalls.filter((c) => c.method === 'POST').length, notes: pagedSetup.notes }));

    /* ── R7-2: has_more is a BOOLEAN, and a truthy something-else is the page failing to say ── */
    for (const [what, value] of [['the string "true"', 'true'], ['the number 1', 1]]) {
      settingsActive(); graced();
      fakeTaxRegistrations.length = 0; fakeTaxHasMore = value;
      const before = JSON.stringify(readyRow());
      await tick();
      ok('has_more as ' + what + ' is not a page saying anything: unmeasured, and the ready row is untouched',
         JSON.stringify(readyRow()) === before && /\|tax-cron\/registrations_unparseable$/.test(beat()), JSON.stringify(readyRow()) + ' ' + beat());
    }
    fakeTaxHasMore = false;

    /* ── R7-3: case and whitespace on settings.status are SHAPE, not value ──
       ' active ' and 'Active' are not the enum Stripe documents. Reading either as "not active" is a measured no —
       tax off, for the full TTL — on the strength of a string this Worker does not recognise. */
    for (const [what, value] of [["a status with whitespace (' active ')", ' active '], ["a status with a capital ('Active')", 'Active']]) {
      graced();
      fakeTaxSettings = { status: value, head_office: { address: { line1: '2450 Fondren Rd' } }, defaults: {} };
      fakeTaxRegistrations.length = 0; fakeTaxRegistrations.push({ ...TX_LIVE });
      const before = JSON.stringify(readyRow());
      await tick();
      ok(what + ' is a shape failure, not a measured no: the ready row is untouched and the grace holds',
         JSON.stringify(readyRow()) === before && /\|tax-cron\/settings_unparseable$/.test(beat()), JSON.stringify(readyRow()) + ' ' + beat());
      stripeCalls.length = 0;
      await bookAlone();
      ok('… so the order is still taxed: drift in how the field is WRITTEN is not evidence the account stopped collecting',
         stripeCalls[0].toString() === TAXED_BODY, stripeCalls[0].toString());
      forgetTaxState(); expireTaxWindow();
      await tick();
      ok('… while with nothing to grace it fails CLOSED as unmeasured (count 2), which is the only direction fail-closed may go',
         (readyRow() || {}).count === 2 && /\|settings_unparseable$/.test(String((readyRow() || {}).window_start)), JSON.stringify(readyRow()));
    }
    settingsActive(); taxAccountReady();

    /* ── R7-4: the API version is pinned on every call, including the one the customer waits behind ── */
    forgetTaxState(); expireTaxWindow();
    stripeTaxCalls.length = 0; stripeCallHeaders.length = 0; stripeCalls.length = 0;
    await tick();
    await bookAlone();
    const pinned = (h) => (h || {})['Stripe-Version'] === stripeApiVersion({});
    ok('every Stripe call carries the pinned Stripe-Version — the tax reads and the Checkout Session alike, so a shape this code validates is a shape of one named version',
       stripeTaxCalls.length > 0 && stripeTaxCalls.every((c) => pinned(c.headers))
       && stripeCallHeaders.length > 0 && stripeCallHeaders.every(pinned),
       JSON.stringify({ tax: stripeTaxCalls.length, sessions: stripeCallHeaders.length, seen: [...new Set([...stripeTaxCalls.map((c) => (c.headers || {})['Stripe-Version']), ...stripeCallHeaders.map((h) => h['Stripe-Version'])])] }));
    ok('… and an override that is not version-shaped falls back to the pin instead of being sent: a typo in this one is Stripe refusing every call, checkout included',
       stripeApiVersion({}) === '2024-06-20' && stripeApiVersion({ STRIPE_API_VERSION: '2025-01-27.acacia' }) === '2025-01-27.acacia'
       && stripeApiVersion({ STRIPE_API_VERSION: 'latest' }) === '2024-06-20' && stripeApiVersion({ STRIPE_API_VERSION: 123 }) === '2024-06-20'
       && stripeApiVersion({ STRIPE_API_VERSION: '' }) === '2024-06-20',
       JSON.stringify(['latest', 123, '', '2025-01-27.acacia'].map((v) => stripeApiVersion({ STRIPE_API_VERSION: v }))));

    /* ── R7-5: DOCTRINE 2 — every Stripe-controlled string that leaves this Worker is capped ──
       Round 6 capped taxEnum and left taxError on bare taxRedact, so the one genuinely unbounded field on the tax path
       — a Stripe message, which quotes back whatever was in the request — went whole into the 502 and into every CI
       summary that prints it. Scrubbing a 200,000-character message leaves a 200,000-character message. */
    const HUGE = 'z'.repeat(200000);
    forgetTaxState();
    taxFail = { on: '/tax/settings', method: 'GET', status: 500, body: { error: { type: 'e'.repeat(500), code: 'c'.repeat(500), message: HUGE } } };
    const hugeRep = await (await adminTax7()).json();
    taxFail = null;
    ok('a 200,000-character Stripe message is 300 characters in the report, and type and code are 60: redaction and length are two questions and round 6 answered one',
       hugeRep.error.message.length === 301 && hugeRep.error.code.length === 61 && hugeRep.error.type.length === 61
       && JSON.stringify(hugeRep).length < 1500,
       JSON.stringify({ message: hugeRep.error.message.length, code: hugeRep.error.code.length, type: hugeRep.error.type.length, whole: JSON.stringify(hugeRep).length }));

    // The other end of doctrine 2: a Stripe object on its way into D1. A TEXT column has no length of its own, so the
    // ceiling is here — and it is capText, not taxSafe: the buyer's own name and address are the point of the row and
    // the redactor would corrupt them.
    const bigEvt = JSON.stringify({ id: 'evt_cap_1', type: 'checkout.session.completed', data: { object: {
      id: 'cs_cap_1', mode: 'payment', amount_total: '69500', currency: 'usd' + 'x'.repeat(50),
      customer_email: 'c'.repeat(400) + '@example.com',
      customer_details: { name: 'N'.repeat(5000), phone: 'p'.repeat(500) },
      metadata: { kind: 'class_booking', sku: 'S'.repeat(500), class_name: 'C'.repeat(5000), qty: '1', organization: 'O'.repeat(5000), notes: 'n'.repeat(9000) } } } });
    const capTs = Math.floor(Date.now() / 1000);
    const capHook = await hook(bigEvt, 't=' + capTs + ',v1=' + await sign(bigEvt, capTs));
    await Promise.all(waits.splice(0));
    const capRow = orderRows.find((o) => o.stripe_session_id === 'cs_cap_1');
    ok('a Stripe object carrying unbounded strings lands in D1 BOUNDED, field by field, with the numbers typed as numbers',
       capHook.status === 200 && !!capRow && capRow.customer_name.length === 200 && capRow.customer_email.length === 320
       && capRow.item_name.length === 200 && capRow.sku.length === 100 && capRow.customer_phone.length === 40
       && capRow.organization.length === 200 && capRow.notes.length === 2000 && capRow.currency.length === 10
       && capRow.amount_total === 69500,
       JSON.stringify(capRow && Object.fromEntries(Object.entries(capRow).map(([k, v]) => [k, typeof v === 'string' ? v.length : v]))));

    /* ── R7-6: DOCTRINE 3 — a redactor matches ANYWHERE or it does not match ──
       Every rule, four ways: bare, glued to a word character on the LEFT (which is what a Stripe message actually looks
       like — `param_…`, `settings_status_…`), glued on the right, and inside a JSON string. Round 6 removed \b from the
       prefix rules and then added three more rules WITH it, eleven lines under the comment saying not to. ENDMARK is
       the anti-vacuity guard: if the cap truncated the line instead of the redactor removing the token, the assertion
       fails rather than passing for the wrong reason. */
    const redactThrough = async (msg) => {
      forgetTaxState();
      taxFail = { on: '/tax/settings', method: 'GET', status: 500, body: { error: { type: 'api_error', code: '', message: msg } } };
      const r = await (await adminTax7()).json();
      taxFail = null;
      return String((r.error && r.error.message) || '');
    };
    const RULES = {
      stripe_secret: ['sk', 'live', '51NoTaReAlKeY0123456789'].join('_'),
      stripe_whsec: 'whsec_' + 'A'.repeat(24),
      openai_anthropic: 'sk-' + 'A'.repeat(24),
      bearer: 'Bearer ' + 'A'.repeat(24),
      google: 'AIzaSy' + 'B'.repeat(33),
      aws: 'AKIA' + 'C'.repeat(16),
      slack: 'xoxb-' + '111111111111-abcdefABCDEF',   // split, as the round-5 block splits it: a synthetic shape must not read as a literal to the credential scanner
      jwt: ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxIn0', 'abc_DEF-123'].join('.'),
      github: 'ghp_' + 'D'.repeat(36),
      gitlab: 'glpat-' + 'E'.repeat(20),
      revenuecat: 'appl_' + 'F'.repeat(20),
      twilio: 'AC' + 'a1'.repeat(16),
      hex_after_label: 'api_key=' + 'f'.repeat(40),
      hex_before_label: 'f'.repeat(40) + '_secret',
    };
    const leaked = [], truncated = [];
    for (const [name, token] of Object.entries(RULES)) {
      const out = await redactThrough('S0 ' + [token, 'param_' + token, token + 'Z', '{"p":"' + token + '"}'].join(' ') + ' ENDMARK');
      if (!out.includes('ENDMARK')) truncated.push(name);
      else if (out.includes(token)) leaked.push(name);
    }
    ok('all ' + Object.keys(RULES).length + ' redaction rules match ANYWHERE — bare, glued left, glued right, and inside a JSON string — and none of the four was merely truncated',
       leaked.length === 0 && truncated.length === 0, 'leaked: [' + leaked.join(', ') + '] truncated: [' + truncated.join(', ') + ']');

    // The other direction, and the reason the rules are not simply widened until everything matches: a redactor that
    // eats the report is a redactor nobody can read. A bare sha1 owns no label, prose is prose, and a Stripe id is the
    // thing an operator is here to look at.
    const KEEP = ['da39a3ee5e6b4b0d3255bfef95601890afd80709', 'Your card was declined. Please contact your bank about this order.',
      'cs_test_a1b2c3', 'cus_QabcDEF123', 'price_1PabcXYZ', 'txr_1Pabc9', 'taxreg_1Nabc7'];
    const kept = await redactThrough('S0 ' + KEEP.join(' ') + ' ENDMARK');
    ok('… and nothing else is: a bare 40-character sha1 with no label beside it, ordinary prose, and the Stripe ids the report exists to show all come through intact',
       kept.includes('ENDMARK') && KEEP.every((k) => kept.includes(k)), 'missing: ' + KEEP.filter((k) => !kept.includes(k)).join(', '));

    // The Session is a Stripe shape too, and it is the one handed to the customer. A 200 whose id or url is not a
    // string is a checkout that redirects the browser to `undefined` with no error behind it.
    for (const [what, body] of [['no url at all', { id: 'cs_x' }], ['a url that is not a string', { id: 'cs_x', url: 42 }],
                                ['a url that is not https', { id: 'cs_x', url: 'javascript:alert(1)' }], ['no id', { url: 'https://checkout.stripe.com/pay/x' }]]) {
      taxAccountReady(); forgetTaxState(); cacheTaxReady();
      sessionFail = { n: 1, status: 200, body };
      const bad = await bookAlone();
      sessionFail = null;
      const badBody = await bad.json();
      ok('a 200 Checkout Session with ' + what + ' is a clean 502, not a redirect to undefined',
         bad.status === 502 && badBody.error === 'Could not start checkout. Please try again or call us.', bad.status + ' ' + JSON.stringify(badBody));
    }

    /* ── R7-7: the streak is a counter of refusals, so the ALARM needs the other half of the fault measured ──
       One anonymous address can drive the streak past three on a perfectly healthy account: `a+tax-1@x.com` five
       times, zero completed orders, tax endpoints answering fine. The note round 6 printed for that asserted orders
       were completing untaxed and the endpoints were down — neither of which a counter of refused Sessions carries. */
    const REFUSAL7 = { type: 'invalid_request_error', code: 'tax_registration_incomplete', message: 'Stripe Tax is not active on this account (automatic_tax).' };
    const taxCarrying7 = (params) => !!(params && params.get('automatic_tax[enabled]'));
    taxAccountReady(); settingsActive(); forgetTaxState(); cacheTaxReady(); stripeTaxCalls.length = 0;
    // The window is held for the whole run, so the healthy account is never re-measured and the fresh ready row stands.
    rateLimits.set('tax:lock', { key: 'tax:lock', window_start: new Date(Date.now() + 60000).toISOString(), count: 1 });
    const hq = [];
    const hctx = { waitUntil: (p) => { hq.push(Promise.resolve(p).catch(() => {})); return p; } };
    sessionFail = { n: 99, status: 400, when: taxCarrying7, body: { error: REFUSAL7 } };
    for (let i = 0; i < 5; i++) { await bookWith(hctx); await Promise.all(hq.splice(0)); }
    sessionFail = null;
    const healthy = await (await adminTax7('?dry=1', 'GET')).json();
    ok('five refused tax-carrying Sessions on a HEALTHY account: the streak is reported as the number it is — 5 — beside a readiness that was measured',
       healthy.tax_fallback_streak === 5 && healthy.tax_readiness === 'measured' && healthy.tax_ready === true,
       JSON.stringify({ streak: healthy.tax_fallback_streak, readiness: healthy.tax_readiness, ready: healthy.tax_ready }));
    ok('… and NO note and NO alarm, because a counter of refusals does not carry "orders completed untaxed" or "the endpoints are down" — the second witness is missing',
       healthy.tax_fallback_alarm === false && !(healthy.notes || []).some((n) => n.includes('tax_fallback_streak')),
       JSON.stringify(healthy.notes));

    // And the alarm still fires when the second half IS measured: same streak, a readiness nothing can refresh.
    ageTaxState('tax:ready', 11 * 60000);
    const doubled = await (await adminTax7('?dry=1', 'GET')).json();
    ok('… while the same streak beside a ready row nothing has been able to refresh IS the double fault, and says so in words that claim only that',
       doubled.tax_fallback_alarm === true && doubled.tax_readiness === 'kept_ready'
       && (doubled.notes || []).some((n) => n.includes('tax_fallback_streak is 5') && n.includes('readiness is UNMEASURED') && !n.includes('completed WITHOUT tax')),
       JSON.stringify({ alarm: doubled.tax_fallback_alarm, readiness: doubled.tax_readiness, notes: doubled.notes }));
    forgetTaxState(); taxAccountReady();
  } finally {
    globalThis.Date = RealDate;
    sessionFail = null; priceHang = null; taxFail = null; taxHang = null; fakeTaxHasMore = false;
    taxAccountReady(); forgetTaxState();
  }
}

console.log('\n── Round 6: the numbers in the comments are the numbers this suite asserts, and the names are the names in the code ──');
{
  /* R6-6. Prose that no test reads drifts, and the round-4 reviewer's numbers had been carried in a source comment
     through two rounds while the suite next to it measured different ones. These are the cheapest possible guards:
     a substring, checked in the same run that produces the number. */
  const src = repoFile('mast-backend/src/worker.js');
  /* ROUND 8 (R8-7) REPLACES R6-6's HALF OF THIS. R6-6 fixed the numbers to the ones THIS suite measures, which was
     right about the arithmetic and still wrong about the claim: 10 of 12 is a property of this harness, the round-7
     reviewer's independent harness got 11 of 12 on the same revert, and a source comment that prints one figure with
     no harness beside it presents a harness-dependent measurement as the repository's fact. Both, named — or only the
     invariant both agree on, which is the pair that actually matters: unreverted, 0 of 12 and 0 of 6. */
  ok('worker.js states each revert number WITH the harness that produced it, and pins the invariant both harnesses agree on (unreverted: 0 of 12, 0 of 6)',
     src.includes("10 of 12 orders untaxed IN THIS REPO'S SUITE and 11 of 12") && src.includes("round-7 reviewer's independent harness")
     && src.includes('UNREVERTED, both report') && src.includes('0 of 12 and 0 of 6') && !src.includes('12 orders, 10 untaxed'),
     JSON.stringify((/THE REVERT NUMBER IS HARNESS-DEPENDENT[^*]*/.exec(src) || [''])[0].slice(0, 200)));
  ok('… and the fallback docstring claims only what is pinned: the READINESS ROW is unreachable by a string, not that no string does anything',
     src.includes('SAID EXACTLY') && src.includes('isTaxRefusal still reads FREE TEXT') && !src.includes('No string ever flips the gate.'),
     src.includes('No string ever flips the gate.') ? 'the overclaim is still there' : 'narrowed');

  const deploy = repoFile('.github/workflows/deploy-worker.yml');
  ok('deploy-worker.yml names the function that exists — taxReadyCached, not taxReady',
     deploy.includes('MEASURED as collecting (taxReadyCached, src/worker.js)') && !/\(taxReady,/.test(deploy),
     JSON.stringify((/MEASURED as collecting \([^)]*\)/.exec(deploy) || [''])[0]));

  const smoke = repoFile('.github/workflows/smoke-worker.yml');
  ok('smoke-worker.yml words cache.stale as a re-measurement being overdue, so a Stripe outage is not reported as a dead trigger',
     smoke.includes('** a re-measurement is overdue **') && !smoke.includes('** the 5-minute trigger is overdue **'),
     JSON.stringify((/\*\* [a-z0-9 -]*overdue \*\*/.exec(smoke) || [''])[0]));
  ok('… and it prints the double-fault streak with a warning line of its own',
     smoke.includes('tax_fallback_streak') && smoke.includes('consecutive tax-carrying Checkout Sessions'), 'tax_fallback_streak in summary');
  // R9-4: both workflows read LIVENESS from cron_last_run and keep last_run as the last measurement of any origin. A
  // summary that prints one number under two meanings is how a dead loop reads healthy on a site taking orders.
  ok('… and BOTH workflows read loop liveness from cron_last_run, keeping last_run as the last measurement of any origin',
     smoke.includes("cron = d.get('cron_last_run')") && smoke.includes('last measurement (any origin)')
     && smoke.includes('the scheduler is not firing') && !smoke.includes("if run.get('stale')")
     && deploy.includes("cron = d.get('cron_last_run')") && deploy.includes('cron loop liveness'),
     'liveness split in both workflows');
  // R9-6: three regexes in a workflow are a second layer over a body Python could not parse. Saying so is the point —
  // a reader who thinks the workflow is the control stops asking whether the Worker redacted anything.
  ok('… and smoke-worker.yml says its 3-rule scrub is a courtesy, not the control: redaction is the Worker\'s job',
     smoke.includes('COURTESY, NOT A CONTROL') && smoke.includes("REDACTION IS THE WORKER'S JOB"),
     'scrub described as a second layer');

  const probe = repoFile('mast-backend/scripts/probe-tax-refusal.mjs');
  ok('the live refusal-status probe reads its key from the environment ONLY, holds no literal, and posts to api.stripe.com and nowhere else',
     /process\.env\.STRIPE_SECRET_KEY/.test(probe) && !/readFileSync|\.p8|auth\.json/.test(probe)
     && (probe.match(/https:\/\/[a-z.]+/g) || []).every((u) => u === 'https://api.stripe.com' || u.startsWith('https://example.com'))
     && !/(sk|rk|pk)_(live|test)_[A-Za-z0-9]{4,}/.test(probe),
     JSON.stringify([...new Set(probe.match(/https:\/\/[a-z.]+/g) || [])]));
  ok('… and it is a MEASUREMENT: it exits non-zero on anything but the 400/402 the Worker\'s isStripeRefusal assumes',
     /process\.exit\(0\)/.test(probe) && /res\.status === 400 \|\| res\.status === 402/.test(probe) && /process\.exit\(1\)/.test(probe), 'exit codes present');

  const readme = repoFile('mast-backend/README.md');
  ok('the README carries the live-probe residual verbatim, with the command that answers it',
     readme.includes('Before the first live Checkout with automatic_tax, run one Session against the Stripe TEST')
     && readme.includes('node mast-backend/scripts/probe-tax-refusal.mjs'), 'residual present');

  /* ROUND 7. The same guard, on the three doctrines: prose that no test reads drifts, and the README described the
     round-6 container-only checks for as long as they were the truth and no longer. Cheapest possible assertions —
     substrings, checked in the run that produces the behaviour. */
  ok('the README states the three doctrines as the rules of this module, and names the validators',
     readme.includes('The three rules of this module') && readme.includes('at every level')
     && readme.includes('validateTaxSettings') && readme.includes('validateTaxRegistrations')
     && readme.includes('matches anywhere or it does not match'), 'doctrines present');
  ok('… and the API-version pin, with the UNVERIFIED said plainly rather than implied',
     readme.includes('Stripe-Version: 2024-06-20') && readme.includes('no Stripe version was recorded anywhere in this repository')
     && readme.includes('UNVERIFIED against the account'), 'pin present');
  ok('… and it no longer describes the readiness check as the container pair round 6 left behind, nor as round 7\'s hand-written one: it names the SCHEMAS and says country is required',
     !readme.includes('`settings.status` a\n  string, `registrations.data` an array')
     && !readme.includes('`country` a string when present')
     && readme.includes('TAX_REGISTRATION_ROW_SCHEMA') && readme.includes('`country` **REQUIRED**')
     && readme.includes('Classify or refuse'), 'row schema described');

  /* ROUND 8. The construction, the bound on the irreversible act, and the two corrections — all four are claims the
     README makes that a reader would act on, so all four are substrings checked in the run that produces them. */
  ok('the README states the read-guard CONSTRUCTION, not just the checks: an unlisted field cannot be read',
     readme.includes('Proxy whose `get`\ntrap throws on any key the schema does not list')
     && readme.includes('BECAUSE A NAMED CHECK CANNOT END THIS CLASS')
     && readme.includes('fails 24 assertions with the key named'), 'read guard described');
  ok('… and it states the bound on the create as a NUMBER an operator can act on: at most one attempt per 30 days, printed in the report',
     readme.includes('TWO WITNESSES AND A LEDGER') && readme.includes('AT MOST ONE registration create per 30\n  days')
     && readme.includes('taxreg_DUPLICATE'), 'create bound described');
  ok('… and it corrects round 7 where round 7 was wrong: three raw fetches, not one, and the Checkout URL is bounded after all',
     readme.includes('NO raw `fetch` to `api.stripe.com` left in the file') && readme.includes('there were\nthree')
     && readme.includes('bounded at 2048 — REJECTED past it, never truncated'), 'corrections present');
  // R9-6: the word, not the number. `capped` reads as "shortened", and a shortened redirect target is the one thing
  // round 7 was right to refuse; the Session is REJECTED whole. A file that describes a reject as a truncation
  // describes a different design from the one it ships.
  ok('… and it says REJECTED rather than capped, because a truncated Checkout URL is the failure round 7 named',
     !readme.includes('The Checkout URL is capped too') && readme.includes('refused whole'), 'reject wording');
  ok('… and it states the webhook log ceiling as a CEILING — the notes cap — rather than as a probe\'s longest line',
     readme.includes('longest line the webhook path can emit is ~2,000 characters')
     && readme.includes('capText(meta.notes, 2000)'), 'log ceiling stated');
  ok('… and it says a readiness write IS reachable from a checkout, and states the property that actually holds',
     readme.includes('No customer-influenced string can determine the readiness row')
     && readme.includes('once per `tax:lock` window'), 'readiness write stated');
  ok('… and it splits loop liveness (cron_last_run) from the last measurement of any origin (last_run)',
     readme.includes('`cron_last_run` + `loop_stale`') && readme.includes('last measurement of any origin')
     && readme.includes('fresh `last_run` beside a stale `cron_last_run`'), 'liveness split described');
  ok('… and it records the round-9 findings: a shape with no size, a self-contradicting row, and a zero-width blank',
     readme.includes('a shape with no SIZE in it is satisfied at any size')
     && readme.includes('A row that contradicts itself is not a decidable answer')
     && readme.includes('a blank is not only whitespace'), 'round 9 findings described');
  ok('… and it prints each revert number with the harness that produced it, and the invariant both harnesses agree on',
     readme.includes('The revert number is harness-dependent'.replace('The', '**The')) && readme.includes('11 of 12** in the round-7 reviewer')
     && readme.includes('unreverted, both\n  report 0 of 12 and 0 of 6'), 'revert numbers attributed');
  ok('… and it says the streak has its own row and why that was a defect rather than a tidy-up',
     readme.includes('`tax:fallback_streak` row') && readme.includes('writable by the public')
     && readme.includes('leave `last_run: null`'), 'streak row described');
  ok('… and it describes the fuzz as part of the suite, with its mutation count and the two invariants it pins',
     readme.includes('**' + taxShapeMutations().length + ' mutations**') && readme.includes('fuzz-tax-shapes.mjs')
     && readme.includes('byte-identical**, sells the next order **taxed**'), 'fuzz described');
  ok('… and the cache.stale line in the report table says a re-measurement is overdue, not that the trigger is dead',
     readme.includes('a `stale: true` here means a **re-measurement is overdue**')
     && !readme.includes('a `stale: true` here means the five-minute trigger is overdue'), 'stale wording');

  ok('worker.js carries no \\b in taxRedact: every rule matches anywhere, and the lookahead is what the boundary was for',
     !/\\b/.test((/function taxRedact[\s\S]*?\n}/.exec(src) || [''])[0].split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')),
     JSON.stringify(((/function taxRedact[\s\S]*?\n}/.exec(src) || [''])[0].split('\n').filter((l) => !/^\s*\/\//.test(l) && /\\b/.test(l))).slice(0, 3)));

  ok('smoke-worker.yml prints the registration-create LEDGER on every run, and the standing witness with the seconds left on it — the irreversible act is not something to reconstruct from a run log',
     smoke.includes('registration_create_ledger:') && smoke.includes('the next attempt is not allowed before')
     && smoke.includes('registration_create_witness:') && smoke.includes('a create needs a SECOND such read'.replace('a create', 'A create')),
     JSON.stringify((/registration_create_ledger[^\n]*/.exec(smoke) || [''])[0].slice(0, 120)));

  ok('smoke-worker.yml prints the streak always and warns only on the corroborated alarm the Worker reports',
     smoke.includes("d.get('tax_fallback_alarm') is True") && smoke.includes('consecutive tax-carrying Checkout Sessions')
     && !smoke.includes('Orders are being sold untaxed right now'),
     JSON.stringify((/if d\.get\('tax_fallback_alarm'\)[^\n]*/.exec(smoke) || [''])[0]));
}

console.log('\n── Round 8: an unlisted field cannot be READ, an absence needs two witnesses, and the fuzz is part of the suite ──');
{
  const on = { ...env, STRIPE_TAX: '1' };
  const booking = { sku: 'MAST-HG-FUND', customer_email: 'a@b.com', qty: 1 };
  const bookWith = (c, e = on) => worker.fetch(new Request('https://api.test/create-booking', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://mastsolutions.com', 'CF-Connecting-IP': nextIp() },
    body: JSON.stringify(booking) }), e, c);
  const bookAlone = () => bookWith({});
  const adminTax8 = (q = '', method = 'POST') => worker.fetch(new Request('https://api.test/admin/tax/setup' + q,
    { method, headers: { 'X-Admin-Key': 'super-secret-admin-key', 'CF-Connecting-IP': nextIp() } }), on, ctx);

  stripeCalls.length = 0;
  await bookWith({}, { ...env, STRIPE_TAX: '0' });
  const OFF_BODY = stripeCalls[0].toString();
  const TAXED_BODY = OFF_BODY + '&automatic_tax%5Benabled%5D=true&line_items%5B0%5D%5Bprice_data%5D%5Bproduct_data%5D%5Btax_code%5D=txcd_20030000';

  const RealDate = Date;
  let skew = 0;
  class VirtualDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(RealDate.now() + skew); else super(...a); }
    static now() { return RealDate.now() + skew; }
  }
  const advance = (ms) => { skew += ms; };
  globalThis.Date = VirtualDate;

  /* ── R8-1: THE READ GUARD. Every validated object the tax module hands back is wrapped in a Proxy whose get trap
     throws on any key the schema does not list, and then the cron, the admin setup, a booking and the whole 350-case
     fuzz below are driven THROUGH it. This is the construction the round exists for: rounds 5, 6 and 7 each wrote a
     check for the fields they had named and an independent fuzz found the next unnamed one every time — round 7's was
     `country`, optional in the validator and DECIDED ON first by isTexasSalesTax. A named check cannot end that class.
     A predicate that cannot reach an unlisted field can. */
  const guardHits = [];
  const ALWAYS_ALLOWED = new Set(['then', 'toJSON', 'constructor', 'inspect']);
  setTaxReadGuard((value, keys) => new Proxy(value, {
    get(target, prop) {
      if (typeof prop === 'symbol' || ALWAYS_ALLOWED.has(prop) || keys.has(prop)) return Reflect.get(target, prop);
      guardHits.push(String(prop) + ' (allowed: ' + [...keys].join(',') + ')');
      throw new TypeError('R8-1 read guard: the tax code read `' + String(prop) + '`, which no schema lists.');
    },
  }));

  try {
    const tick = async (cron = '*/5 * * * *') => {
      const q = [];
      await worker.scheduled({ cron, scheduledTime: Date.now() }, on, { waitUntil: (p) => q.push(Promise.resolve(p).catch(() => {})) });
      await Promise.all(q);
    };
    const readyRow = () => taxStateRow('tax:ready');
    const taxPosts = () => stripeTaxCalls.filter((c) => c.method === 'POST' && c.url.includes('/tax/registrations')).length;

    // The positive case: a well-formed account, every ordinary path, guard armed the whole way.
    taxAccountReady(); forgetTaxState(); stripeTaxCalls.length = 0; stripeCalls.length = 0;
    await tick();
    await bookAlone();
    const guardedReport = await (await adminTax8('?dry=1', 'GET')).json();
    ok('with the read guard ARMED, a cron tick, a checkout and the report all behave exactly as they do without it — and not one predicate reached for a field the schema does not list',
       guardHits.length === 0 && (readyRow() || {}).count === 1 && stripeCalls[0].toString() === TAXED_BODY && guardedReport.tax_ready === true,
       'hits: ' + JSON.stringify(guardHits.slice(0, 4)) + ' row=' + JSON.stringify(readyRow()));

    // The setup path, which is the one that WRITES: taxRun's decision code reads settings.head_office.address.line1,
    // registration.id, .status, .country_options.us.type and .active_from — all of them declared, or this throws.
    taxAccountBlank(); forgetTaxState(); witnessTaxAbsence(); stripeTaxCalls.length = 0;
    const guardedSetup = await (await adminTax8()).json();
    ok('… and neither does taxRun, on the run that writes the settings AND creates the registration — the report reads five more fields off a row and every one of them is in the schema',
       guardHits.length === 0 && guardedSetup.registration.created_now === true && guardedSetup.registration.type === 'state_sales_tax',
       'hits: ' + JSON.stringify(guardHits.slice(0, 4)) + ' ' + JSON.stringify(guardedSetup.registration));

    // NEGATIVE CONTROL, fired here rather than asserted: the guard is only worth having if it actually throws.
    let threw = '';
    try {
      const sample = new Proxy(Object.freeze({ country: 'US' }), {
        get(t, p) { if (typeof p === 'symbol' || ALWAYS_ALLOWED.has(p) || p === 'country') return Reflect.get(t, p); throw new TypeError('R8-1 read guard: the tax code read `' + String(p) + '`, which no schema lists.'); },
      });
      void sample.country;                 // declared — comes back
      void sample.country_code;            // NOT declared — the exact round-7 shape
    } catch (e) { threw = e.message; }
    ok('… and the guard is not decorative: reading one undeclared key off a validated object THROWS, naming the key',
       /read guard/.test(threw) && threw.includes('country_code'), JSON.stringify(threw));

    ok('the schemas are the declaration, and `country` is REQUIRED in the row schema — the field round 7 left optional while the predicate decided on it first',
       TAX_SCHEMAS.row.country.required === true && String(TAX_SCHEMAS.row.country.test) === '/^[A-Z]{2}$/'
       && TAX_SCHEMAS.row.status.required === true && TAX_SCHEMAS.settings.status.required === true,
       JSON.stringify(Object.keys(TAX_SCHEMAS.row)));

    /* The doctrine, swept: the validator ITERATES a schema, so there is no hand-written type chain left in the tax
       section to fall out of date with it. Every `typeof` in that section lives in the IS predicate table. */
    const src8 = repoFile('mast-backend/src/worker.js');
    const taxSection = src8.slice(src8.indexOf('ONE DECLARATIVE SCHEMA PER STRIPE SHAPE'), src8.indexOf('/* ─────────────────────────── Admin roster ─────────────────────────── */'));
    const isTable = taxSection.slice(taxSection.indexOf('const IS = {'), taxSection.indexOf('const US_ROW'));
    const strayTypeof = taxSection.split(isTable).join('').split('\n').filter((l) => l.includes('typeof') && !/^\s*(\*|\/\/)/.test(l.trim()));
    ok('the tax section carries no hand-written typeof chain: every one lives in the IS predicate table the schemas are written against',
       strayTypeof.length === 0, JSON.stringify(strayTypeof.slice(0, 3)));

    /* ── R8-3: the irreversible act, bounded structurally. Two witnesses ≥30 s apart, then a 30-day ledger. ── */
    taxAccountBlank(); forgetTaxState(); stripeTaxCalls.length = 0;
    const first = await (await adminTax8()).json();
    ok('a FIRST validated read that finds no Texas registration creates NOTHING — one reading of an account is not enough to make a registration that cannot be unmade',
       taxPosts() === 0 && first.ok !== false && (first.notes || []).some((n) => n.includes('NOT created on THIS run') && n.includes('FIRST witness')),
       'POSTs=' + taxPosts() + ' ' + JSON.stringify(first.notes));
    ok('… and the witness it recorded is in D1 and printed in the report, with how long until the second read counts',
       !!taxStateRow('tax:registration_witness') && first.registration_create_witness && first.registration_create_witness.second_witness_due_in_seconds > 0,
       JSON.stringify(first.registration_create_witness));

    advance(31000); expireTaxWindow(); stripeTaxCalls.length = 0;
    const second = await (await adminTax8()).json();
    ok('… and a SECOND independent read 31 s later, which also validates and also finds none, is what authorises the create',
       taxPosts() === 1 && second.registration.created_now === true && fakeTaxRegistrations.length === 1,
       'POSTs=' + taxPosts() + ' created=' + (second.registration || {}).created_now);
    ok('… the ledger row is written on the ATTEMPT and the witness it consumed is gone, so the same absence cannot authorise a second create',
       (taxStateRow('tax:registration_create') || {}).count === 1
       && String((taxStateRow('tax:registration_create') || {}).window_start).endsWith('|created')
       && !taxStateRow('tax:registration_witness'),
       JSON.stringify([taxStateRow('tax:registration_create'), taxStateRow('tax:registration_witness')]));
    const ledgerReport = await (await adminTax8('?dry=1', 'GET')).json();
    ok('… and the report prints the create ledger from D1: one attempt, its outcome, and the 30-day floor under the next one',
       ledgerReport.registration_create_ledger && ledgerReport.registration_create_ledger.attempts === 1
       && ledgerReport.registration_create_ledger.outcome === 'created' && ledgerReport.registration_create_ledger.cooldown_days === 30
       && ledgerReport.registration_create_witness === null,
       JSON.stringify(ledgerReport.registration_create_ledger));

    // The bound on the residual, stated as a number: even a false absence repeated forever costs ONE attempt per 30
    // days, and the report says which run withheld a create and why.
    fakeTaxRegistrations.length = 0;         // the account "loses" Texas — a false absence, twice over
    advance(2 * 3600000); expireTaxWindow(); stripeTaxCalls.length = 0;
    const withheldA = await (await adminTax8()).json();
    advance(2 * 3600000); expireTaxWindow();
    const withheldB = await (await adminTax8()).json();
    ok('a false absence read TWICE MORE, hours apart, creates nothing: the ledger holds the floor at one attempt per 30 days and the report says so in words',
       taxPosts() === 0 && [withheldA, withheldB].every((r) => (r.notes || []).some((n) => n.includes('create ledger') && n.includes('30 days'))),
       'POSTs=' + taxPosts() + ' ' + JSON.stringify((withheldB.notes || []).filter((n) => n.includes('ledger'))));

    advance(31 * 24 * 3600000); expireTaxWindow(); stripeTaxCalls.length = 0;
    await adminTax8();                        // past the cooldown: the first run past it is a witness, not a create
    ok('… and past the 30 days the rule starts over rather than firing immediately: the first run is a witness again',
       taxPosts() === 0, 'POSTs=' + taxPosts());
    advance(31000); expireTaxWindow();
    const reopened = await (await adminTax8()).json();
    ok('… and the run after that creates, with the ledger now at attempt 2',
       taxPosts() === 1 && reopened.registration.created_now === true, 'POSTs=' + taxPosts());

    // A witness is dropped the moment Texas IS seen: one left lying about is a create waiting for the next blip.
    forgetTaxState(); witnessTaxAbsence(); taxAccountReady(); expireTaxWindow(); stripeTaxCalls.length = 0;
    await adminTax8();
    ok('a run that SEES the Texas registration drops the standing witness — a witness left behind is a create waiting for the next transient absence',
       !taxStateRow('tax:registration_witness') && taxPosts() === 0, JSON.stringify(taxStateRow('tax:registration_witness')));

    /* ── R8-5: the heartbeat is written by a run, and by nothing an anonymous checkout can reach ── */
    const REFUSAL8 = { type: 'invalid_request_error', code: 'tax_registration_incomplete', message: 'Stripe Tax is not active on this account (automatic_tax).' };
    const taxCarrying8 = (params) => !!(params && params.get('automatic_tax[enabled]'));
    taxAccountReady(); forgetTaxState(); cacheTaxReady();
    rateLimits.set('tax:lock', { key: 'tax:lock', window_start: new Date(Date.now() + 60000).toISOString(), count: 1 });
    rateLimits.delete('tax:last_run');        // a Worker whose setup loop has NEVER run
    const fq = [];
    const fctx = { waitUntil: (p) => { fq.push(Promise.resolve(p).catch(() => {})); return p; } };
    sessionFail = { n: 99, status: 400, when: taxCarrying8, body: { error: REFUSAL8 } };
    for (let i = 0; i < 4; i++) { await bookWith(fctx); await Promise.all(fq.splice(0)); }
    sessionFail = null;
    const neverRan = await (await adminTax8('?dry=1', 'GET')).json();
    ok('four anonymous refused checkouts against a Worker whose loop has NEVER RUN leave the heartbeat ABSENT — round 7 let the streak bump INSERT it, so a dead loop reported itself fresh',
       !taxStateRow('tax:last_run') && neverRan.last_run === null && neverRan.tax_fallback_streak === 4,
       JSON.stringify({ beat: taxStateRow('tax:last_run'), last_run: neverRan.last_run, streak: neverRan.tax_fallback_streak }));
    ok('… the streak is on its own row, which is the whole of the fix: a public counter and a liveness stamp cannot share a column',
       (taxStateRow('tax:fallback_streak') || {}).count === 4, JSON.stringify(taxStateRow('tax:fallback_streak')));
    rateLimits.delete('tax:lock');
    ageTaxState('tax:ready', 11 * 60000);     // the re-measurement is due, which is what makes the tick measure at all
    await tick();
    const afterRun = await (await adminTax8('?dry=1', 'GET')).json();
    ok('… and a real measurement is what stamps it, and clears the streak with it',
       !!taxStateRow('tax:last_run') && afterRun.last_run !== null && afterRun.tax_fallback_streak === 0,
       JSON.stringify({ last_run: afterRun.last_run, streak: afterRun.tax_fallback_streak }));

    /* ── R8-6: every Stripe fetch in the file is bounded, and the Session URL is bounded too ── */
    const rawStripeFetch = src8.split('\n').filter((l) => /fetch\(\s*'https:\/\/api\.stripe\.com/.test(l) && !/const r = await fetch/.test(l));
    ok('there is no raw fetch to api.stripe.com left in worker.js: every Stripe call goes through boundedStripe, so every one carries the pin, the AbortController and a ceiling',
       rawStripeFetch.length === 0, JSON.stringify(rawStripeFetch.map((l) => l.trim().slice(0, 80))));

    taxAccountReady(); forgetTaxState(); cacheTaxReady();
    sessionFail = { n: 1, status: 200, body: { id: 'cs_long', url: 'https://checkout.stripe.com/c/pay/' + 'u'.repeat(2100) } };
    const longUrl = await bookAlone();
    sessionFail = null;
    ok('a 200 Checkout Session whose URL is 2,100 characters is a clean 502: the URL is scheme-checked and THEN bounded, which is the last uncapped Stripe string in this Worker',
       longUrl.status === 502, longUrl.status + ' ' + (await longUrl.clone().text()).slice(0, 120));
    stripeCalls.length = 0;
    const okUrl = await bookAlone();
    ok('… while an ordinary ~90-character Checkout URL is handed to the browser untouched — a cap that broke the purchase would be worse than none',
       okUrl.status === 200 && (await okUrl.clone().json()).checkoutUrl.startsWith('https://checkout.stripe.com/'), (await okUrl.clone().text()).slice(0, 120));

    /* ── R8-4: metadata.registration_id is Stripe-controlled and reaches a log ── */
    const bigId = 'R'.repeat(200000);
    const idEvt = JSON.stringify({ id: 'evt_regid_1', type: 'checkout.session.completed', data: { object: {
      id: 'cs_regid_1', mode: 'payment', amount_total: 22500, currency: 'usd', customer_email: 'q@example.com',
      metadata: { registration_id: bigId, kind: 'class_booking' } } } });
    const idTs = Math.floor(Date.now() / 1000);
    const idLines = await captureAll(async () => { await hook(idEvt, 't=' + idTs + ',v1=' + await sign(idEvt, idTs)); await Promise.all(waits.splice(0)); });
    ok('a 200,000-character metadata.registration_id off a webhook is capped at 64 before it reaches a log — it was the one Stripe string on that path still echoed whole',
       !idLines.some((l) => l.includes(bigId)) && idLines.every((l) => l.length <= 100),
       'longest=' + Math.max(0, ...idLines.map((l) => l.length)) + ' ' + JSON.stringify(idLines.filter((l) => l.length > 100).map((l) => l.slice(0, 60))));

    /* ── R9-1: THE WITNESS IS DROPPED BY THE MEASUREMENT, WHICH IS WHY THIS RUNS THROUGH worker.scheduled() ──
       Round 8 dropped it in taxRun, at three call sites, all of them gated on `write`. The CRON NEVER REACHES THEM on
       a collecting account: ensureTaxSetup's background branch measures first and RETURNS on `seen.ready`, so the one
       path that runs 288 times a day was the one path that could see Texas present and could not drop a witness. A
       witness lives 24 hours (TAX_WITNESS_MAX_MS), so a false absence on Tuesday and a second one on Friday met as
       two witnesses — with a week of ticks in between, every one of them MEASURING the registration present — and
       authorised a duplicate registration, which is the one act in this module that cannot be undone. Driven here
       through worker.scheduled(), not through taxRun, because taxRun is exactly the path that already worked. */
    taxAccountReady(); forgetTaxState(); witnessTaxAbsence(); stripeTaxCalls.length = 0;
    const witnessBefore = !!taxStateRow('tax:registration_witness');
    await tick();
    ok('a CRON TICK that measures the account COLLECTING drops the standing witness — the path round 8 could not reach, because a healthy tick returns before taxRun',
       witnessBefore && !taxStateRow('tax:registration_witness') && (readyRow() || {}).count === 1,
       'before=' + witnessBefore + ' after=' + JSON.stringify(taxStateRow('tax:registration_witness')) + ' row=' + JSON.stringify(readyRow()));

    fakeTaxRegistrations.length = 0;          // the account "loses" Texas: the Friday false absence
    advance(2 * 3600000); expireTaxWindow(); stripeTaxCalls.length = 0;
    const fridayA = await (await adminTax8()).json();
    ok('… so a later false absence is a FIRST witness again and creates NOTHING: the Tuesday-and-Friday pair that used to reach the POST now needs two fresh readings',
       taxPosts() === 0 && (fridayA.notes || []).some((n) => n.includes('FIRST witness')),
       'POSTs=' + taxPosts() + ' ' + JSON.stringify(fridayA.notes));

    advance(31000); expireTaxWindow();
    const fridayB = await (await adminTax8()).json();
    ok('… and the rule itself is untouched by the extra drop: two independent reads 31 s apart still authorise the create',
       taxPosts() === 1 && fridayB.registration.created_now === true, 'POSTs=' + taxPosts());

    /* ── R9-4: LOOP LIVENESS IS ITS OWN ROW, because a checkout can stamp the heartbeat ──
       tax:last_run says a measurement happened; it does not say the SCHEDULER fired, because a refused checkout
       enqueues a run and that run stamps it. On a site taking orders the heartbeat therefore stays fresh with the
       trigger dead — which is the exact failure a heartbeat exists to show. */
    const REFUSAL9 = { type: 'invalid_request_error', code: 'tax_registration_incomplete', message: 'Stripe Tax is not active on this account (automatic_tax).' };
    taxAccountReady(); forgetTaxState(); cacheTaxReady(); stripeTaxCalls.length = 0;
    const lq = [];
    const lctx = { waitUntil: (p) => { lq.push(Promise.resolve(p).catch(() => {})); return p; } };
    sessionFail = { n: 99, status: 400, when: (params) => !!(params && params.get('automatic_tax[enabled]')), body: { error: REFUSAL9 } };
    for (let i = 0; i < 4; i++) { await bookWith(lctx); await Promise.all(lq.splice(0)); }
    sessionFail = null;
    const deadLoop = await (await adminTax8('?dry=1', 'GET')).json();
    ok('four anonymous refused checkouts on a Worker whose CRON HAS NEVER FIRED leave tax:cron_last_run ABSENT and loop_stale TRUE — while last_run is fresh, because the checkouts stamped it',
       !taxStateRow('tax:cron_last_run') && deadLoop.cron_last_run === null && deadLoop.loop_stale === true && deadLoop.last_run !== null,
       JSON.stringify({ cron: deadLoop.cron_last_run, loop_stale: deadLoop.loop_stale, last_run: deadLoop.last_run }));

    rateLimits.delete('tax:lock');
    const unknownLive = await captureLogs(() => tick('0 * * * *'));
    ok('… and an UNRECOGNISED trigger does not get to write it either: a renamed schedule is a wrong wrangler.toml, not evidence the tax loop is alive',
       !taxStateRow('tax:cron_last_run') && unknownLive.some((l) => l.includes('"unknown_cron"')),
       JSON.stringify(taxStateRow('tax:cron_last_run')));

    await tick();
    const liveLoop = await (await adminTax8('?dry=1', 'GET')).json();
    ok('… one real cron tick stamps it, and the report reads liveness from THAT row: loop_stale false, the trigger named, last_run left saying what it honestly says',
       !!taxStateRow('tax:cron_last_run') && liveLoop.cron_last_run !== null && liveLoop.cron_last_run.stale === false
       && liveLoop.cron_last_run.trigger === 'tax-cron' && liveLoop.loop_stale === false,
       JSON.stringify(liveLoop.cron_last_run));

    // The healthy path is the one that matters here: a collecting account makes the tick return after ONE D1 read,
    // before ensureTaxSetup, before any measurement. A liveness row only a failing tick writes reports a working loop
    // as dead, so the stamp is at the top of the tick and this is what proves it.
    cacheTaxReady(); ageTaxState('tax:cron_last_run', 30 * 3600000); stripeTaxCalls.length = 0;
    const staleStamp = String((taxStateRow('tax:cron_last_run') || {}).window_start);
    await tick();
    ok('… and a tick that does NOTHING — a fresh ready cache, no measurement, no Stripe call at all — still stamps it: liveness that only a failing tick records is not liveness',
       stripeTaxCalls.length === 0 && String((taxStateRow('tax:cron_last_run') || {}).window_start) !== staleStamp
       && (await (await adminTax8('?dry=1', 'GET')).json()).loop_stale === false,
       'stripe calls=' + stripeTaxCalls.length + ' stamp=' + String((taxStateRow('tax:cron_last_run') || {}).window_start));

    forgetTaxState(); taxAccountReady();

    /* ── R8-8: THE FUZZ, WIRED. Not a reviewer's scratch script — it runs here, every run. ── */
    const fuzzTrial = async (settings, regs) => {
      forgetTaxState();
      fakeTaxSettingsBody = settings; fakeTaxListBody = regs;
      rateLimits.set('tax:ready', { key: 'tax:ready', window_start: new Date(Date.now() - 2 * 3600000).toISOString() + '|active', count: 1 });
      const before = JSON.stringify(readyRow());
      stripeTaxCalls.length = 0; stripeCalls.length = 0;
      await tick();
      const after = JSON.stringify(readyRow());
      const posts = taxPosts();
      stripeCalls.length = 0;
      await bookAlone();
      const body = stripeCalls[0] ? stripeCalls[0].toString() : '';
      return { measured: before !== after, rowBefore: before, rowAfter: after, taxedNext: body === TAXED_BODY, registrationPosts: posts };
    };
    const fuzz = await runTaxShapeFuzz(fuzzTrial);
    fakeTaxSettingsBody = undefined; fakeTaxListBody = undefined;
    ok('the builder fuzz runs INSIDE this suite: ' + fuzz.mutations + ' mutations of every key at every level, and measured:true happens ONLY on a byte-shape-valid body — every drifted one keeps the ready row byte-identical, sells the next order TAXED, and creates nothing',
       fuzz.mutations >= 300 && fuzz.violations.length === 0,
       fuzz.violations.slice(0, 6).map((v) => v.name + ' — ' + v.why).join(' | '));
    ok('… and it is the same generator the standalone script runs, so `node mast-backend/scripts/fuzz-tax-shapes.mjs` and the suite cannot disagree about what was tested',
       taxShapeMutations().length === fuzz.mutations, taxShapeMutations().length + ' vs ' + fuzz.mutations);
    ok('… with the READ GUARD armed across every one of them: not one predicate, on any of those shapes, reached for a field no schema lists',
       guardHits.length === 0, JSON.stringify(guardHits.slice(0, 5)));
  } finally {
    setTaxReadGuard(null);
    globalThis.Date = RealDate;
    fakeTaxSettingsBody = undefined; fakeTaxListBody = undefined;
    sessionFail = null; priceHang = null; taxFail = null; taxHang = null; fakeTaxHasMore = false;
    taxAccountReady(); forgetTaxState();
  }
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

import worker from './src/worker.js';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
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

const stripePriceCalls = [];   // GET /v1/prices?lookup_keys[] and POST /v1/prices (membership price provisioning)
const stripeCustomerCalls = [];   // /v1/customers (account cards)
let fakeDefaultCard = null;         // what GET /v1/customers/<id>?expand=... returns as the default payment method
const fakePrices = [];         // prices "in Stripe" ({ id, lookup_key })
globalThis.fetch = async (url, init) => {
  const u = String(url);
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
    return new Response(JSON.stringify({ id: 'cs_test_123', url: 'https://checkout.stripe.com/pay/cs_test_123' }), { status: 200 });
  }
  if (String(url).includes('api.resend.com')) {
    emails.push(JSON.parse(init.body));
    return new Response('{}', { status: 200 });
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
const sqlLog = [];
const REG_COLS = ['id','created_at','status','sku','item_name','qty','session_date','session_label','customer_name','customer_email','customer_phone','organization','address1','address2','emergency_name','emergency_phone','emergency_relationship','eligibility_outcome_id','eligibility_status','questions_version','agreement_version','agreement_signed_name','agreement_initials','agreement_signed_at','agreement_ip','agreement_user_agent','refund_policy_version','refund_policy_accepted_at','refund_policy_ip','newsletter_opt_in','newsletter_opted_in_at','prereq_attested'];

const DB = {
  prepare(sql) {
    sqlLog.push(sql);
    return {
      bind(...args) { return this._b(args); },
      _b(args) {
        return {
          async first() {
            if (sql.includes('SUM(qty)') && sql.includes('FROM registrations')) {
              let n = 0;
              for (const r of registrations.values()) if (r.sku === args[0] && r.session_date === args[1] && (r.status === 'paid' || (r.status === 'pending' && r.created_at > args[2]))) n += Number(r.qty || 1);
              return { n };
            }
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
            if (sql.includes('FROM accounts WHERE email')) { for (const a of accounts.values()) if (a.email === args[0]) return { ...a }; return null; }
            if (sql.includes('FROM accounts WHERE id')) return accounts.has(args[0]) ? { ...accounts.get(args[0]) } : null;
            return null;
          },
          async run() {
            if (sql.includes('INSERT INTO orders')) stored.push(args);
            if (sql.includes('INSERT INTO eligibility_outcomes')) { outcomes.push(args); return { meta: { last_row_id: outcomes.length, changes: 1 } }; }
            if (sql.includes('INSERT INTO eligibility_answers')) { answers.push(args); return { meta: { last_row_id: answers.length, changes: 1 } }; }
            if (sql.startsWith('INSERT INTO accounts')) { const cols = sql.slice(sql.indexOf('(') + 1, sql.indexOf(')')).split(',').map(c => c.trim()); const row = Object.fromEntries(cols.map((c, i) => [c, args[i]])); accounts.set(row.id, row); return { meta: { changes: 1 } }; }
            if (sql.startsWith('UPDATE accounts SET verify_attempts = verify_attempts + 1')) { const [id, kind, now, max] = args; const row = accounts.get(id); const live = !!(row && row.verify_kind === kind && row.verify_code_hash && row.verify_expires_at > now && (row.verify_attempts || 0) < max); if (live) row.verify_attempts = (row.verify_attempts || 0) + 1; return { meta: { changes: live ? 1 : 0 } }; }
            if (sql.startsWith('UPDATE accounts SET')) { const keys = [...sql.matchAll(/(\w+) = \?/g)].map((m) => m[1]); const id = args[args.length - 1]; const row = accounts.get(id); if (row) keys.forEach((k, i) => { row[k] = args[i]; }); return { meta: { changes: row ? 1 : 0 } }; }
            if (sql.includes('INSERT INTO registrations')) { const row = Object.fromEntries(REG_COLS.map((c, i) => [c, args[i]])); registrations.set(row.id, row); return { meta: { changes: 1 } }; }
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
            if (sql.includes('FROM registrations ORDER BY')) return { results: [...registrations.values()] };
            if (sql.includes('FROM registrations WHERE customer_email')) return { results: [...registrations.values()].filter(r => r.customer_email === args[0] && (r.status === 'paid' || r.status === 'completed')) };
            return { results: [] };
          },
        };
      },
      async first() { return null; },
      async run() { return { meta: { changes: 0 } }; },
      async all() { return { results: [] }; },
    };
  },
};

const env = {
  STRIPE_SECRET_KEY: 'sk_test_x',
  STRIPE_WEBHOOK_SECRET: 'whsec_testsecret',
  ALLOWED_ORIGINS: 'https://mastsolutions.com,https://mastsolutions.com',
  NOTIFY_EMAIL: 'hq@atlasglinn.com',
  RESEND_API_KEY: 're_test',
  ADMIN_KEY: 'super-secret-admin-key',
  ACCOUNT_SECRET: 'account-secret-test',
  REPLY_TO: 'replies@example.com',
  DB,
};
const ctx = { waitUntil: (p) => p };
const post = (path, body, origin = 'https://mastsolutions.com') =>
  worker.fetch(new Request('https://api.test' + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body),
  }), env, ctx);

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
  const upTo9 = await reg(goodReg({ qty: 9 - already })); const r9 = await upTo9.json();
  ok('capacity: booking up to one seat short still reaches Stripe', upTo9.status === 200, String(upTo9.status));
  const tenth = await reg(goodReg({ qty: 1 })); const r10 = await tenth.json();
  ok('capacity: the last seat still sells', tenth.status === 200, String(tenth.status));
  const over = await reg(goodReg({ qty: 1 })); const ob = await over.json();
  ok('capacity: the 11th seat is refused with 409 sold_out and 0 left', over.status === 409 && ob.code === 'sold_out' && ob.seats_left === 0, JSON.stringify(ob));
  ok('capacity: no Stripe session for the refused seat', stripeCalls.length === 2);
  const other = await reg(goodReg({ qty: 1, session_date: SECOND_WEEKEND })); const ro = await other.json();
  ok('capacity: another weekend of the same course is unaffected', other.status === 200, String(other.status));
  const tooMany = await reg(goodReg({ qty: 10, session_date: SECOND_WEEKEND }));   // 1 taken, 9 left, 10 asked
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
  const daBare = await reg(goodReg({ prerequisite: undefined })); const dab = await daBare.json();
  ok('prerequisite: a discipline without its own Fundamentals (Direct Action) has no prerequisite → 200 (owner, 2026-09-05)', daBare.status === 200, String(daBare.status) + ' ' + (dab.error || ''));
  const team = await reg(goodReg({ sku: 'MAST-TEAM-P1', prerequisite: undefined })); const tb = await team.json();
  ok('prerequisite: Team Tactics P1 is the one exception, Handgun Fundamentals first → 400', team.status === 400 && /MAST Handgun Fundamentals/.test(tb.error || '') && !/P1 course/.test(tb.error || ''), String(team.status) + ' ' + (tb.error || ''));
  const vehp2 = await reg(goodReg({ sku: 'MAST-VEH-P2', prerequisite: undefined }));
  ok('prerequisite: "Vehicular Tactics / Team Tactics P2" (Protective) has no prerequisite → 200', vehp2.status === 200, String(vehp2.status));
  const sf = await reg(goodReg({ sku: 'MAST-SF-P1', prerequisite: undefined }));
  ok('prerequisite: Select-Fire P1 has no prerequisite → 200', sf.status === 200, String(sf.status));
  const withIt = await reg(goodReg({ sku: 'MAST-HG-OP' })); const wb = await withIt.json();
  ok('prerequisite: attested → reaches Stripe', withIt.status === 200, String(withIt.status));
  const row = registrations.get(wb.registration_id);
  ok('prerequisite: attestation recorded on the registration', row && row.prereq_attested === 1, JSON.stringify(row && row.prereq_attested));
  const fund = await reg(goodReg({ sku: 'MAST-HG-FUND', prerequisite: undefined })); const fb = await fund.json();
  ok('prerequisite: Handgun Fundamentals never asks', fund.status === 200, String(fund.status));
  const fr = registrations.get(fb.registration_id);
  ok('prerequisite: Handgun Fundamentals records 0', fr && fr.prereq_attested === 0);
  const ladies = await reg(goodReg({ sku: 'MAST-HG-LADIES', prerequisite: undefined })); const lb = await ladies.json();
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
  ok('verify again → 409 already verified', (await post('/account/verify', { email: 'student@example.com', code: code1 })).status === 409);
  const dup = await post('/account/register', { email: 'student@example.com', password: 'another long password' });
  ok('register again for a verified email → 409', dup.status === 409 && (await dup.json()).code === 'exists');
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
  ok('a second sign-up within a minute → 429 too_soon', (await post('/account/register', { email: 'victim@example.com', password: 'the real owner pw', name: 'Vic Owner' })).status === 429);
  rowFor('victim@example.com').verify_sent_at = new Date(Date.now() - 120000).toISOString();   // a minute later
  emails.length = 0;
  const owner = await post('/account/register', { email: 'victim@example.com', password: 'the real owner pw', name: 'Vic Owner' });
  const ownerCode = codeIn(emails[0]);
  ok('the real owner can still sign up for the same address: the unverified slot is taken over', owner.status === 202 && rowFor('victim@example.com').name === 'Vic Owner');
  ok("the squatter's code is dead", squatCode === ownerCode || (await post('/account/verify', { email: 'victim@example.com', code: squatCode })).status === 400);
  const ownerIn = await post('/account/verify', { email: 'victim@example.com', code: ownerCode });
  ok("the owner verifies with their code → 200; the squatter's password no longer works", ownerIn.status === 200 && (await post('/account/login', { email: 'victim@example.com', password: 'attacker password 1' })).status === 401, String(ownerIn.status));
  // lockout and re-send
  emails.length = 0;
  await post('/account/register', { email: 'locked@example.com', password: 'a long enough password' });
  const lockCode = codeIn(emails[0]); const statuses = [];
  for (let i = 0; i < 5; i++) statuses.push((await post('/account/verify', { email: 'locked@example.com', code: lockCode === '111111' ? '222222' : '111111' })).status);
  ok('four wrong codes → 400, the fifth → 429 and the code is burned', statuses.join() === '400,400,400,400,429' && (await post('/account/verify', { email: 'locked@example.com', code: lockCode })).status === 400, statuses.join());
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
  ok('eight concurrent wrong guesses → at most four 400s, the rest 429, and the code is burned', raceStatuses.filter((s) => s === 400).length <= 4 && raceStatuses.filter((s) => s === 429).length >= 4 && (await post('/account/verify', { email: 'raced@example.com', code: raceCode })).status !== 200, raceStatuses.join());
  // forgotten password (Codex P2)
  emails.length = 0;
  ok('forgot for an unknown email → 200 and no email', (await post('/account/forgot', { email: 'nobody@example.com' })).status === 200 && emails.length === 0);
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

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

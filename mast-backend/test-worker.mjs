import worker from '/home/user/atlasglinn-website/mast-backend/src/worker.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra); }
};

// ── fake env ──
const stripeCalls = [];
const stored = [];
const emails = [];

globalThis.fetch = async (url, init) => {
  if (String(url).includes('api.stripe.com')) {
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
const outcomes = [];               // eligibility_outcomes rows
const answers = [];                // eligibility_answers rows
const orderUpdates = [];           // UPDATE orders ... from completeRegistration
const sqlLog = [];
const REG_COLS = ['id','created_at','status','sku','item_name','qty','session_date','session_label','customer_name','customer_email','customer_phone','organization','address1','address2','emergency_name','emergency_phone','emergency_relationship','eligibility_outcome_id','eligibility_status','questions_version','agreement_version','agreement_signed_name','agreement_initials','agreement_signed_at','agreement_ip','agreement_user_agent','refund_policy_version','refund_policy_accepted_at','refund_policy_ip','newsletter_opt_in','newsletter_opted_in_at'];

const DB = {
  prepare(sql) {
    sqlLog.push(sql);
    return {
      bind(...args) { return this._b(args); },
      _b(args) {
        return {
          async first() {
            if (sql.includes('FROM offerings')) {
              const row = { 'MAST-DA': { sku: 'MAST-DA', name: 'Direct Action', price_cents: 69500 } }[args[0]];
              return row || null;
            }
            if (sql.includes('FROM memberships')) {
              const row = { range_member: { plan_key: 'range_member', name: 'Range Member', stripe_price_id: 'price_live_rm' } }[args[0]];
              return row || null;
            }
            if (sql.includes('FROM registrations WHERE id')) return registrations.get(args[0]) || null;
            return null;
          },
          async run() {
            if (sql.includes('INSERT INTO orders')) stored.push(args);
            if (sql.includes('INSERT INTO eligibility_outcomes')) { outcomes.push(args); return { meta: { last_row_id: outcomes.length, changes: 1 } }; }
            if (sql.includes('INSERT INTO eligibility_answers')) { answers.push(args); return { meta: { last_row_id: answers.length, changes: 1 } }; }
            if (sql.includes('INSERT INTO registrations')) { const row = Object.fromEntries(REG_COLS.map((c, i) => [c, args[i]])); registrations.set(row.id, row); return { meta: { changes: 1 } }; }
            if (sql.includes("SET status = 'abandoned'")) { let n = 0; for (const r of registrations.values()) if (r.status === 'pending' && r.created_at < args[0]) { r.status = 'abandoned'; n++; } return { meta: { changes: n } }; }
            if (sql.startsWith('UPDATE registrations SET')) {
              const keys = [...sql.matchAll(/(\w+) = \?/g)].map((m) => m[1]); const id = args[args.length - 1]; const row = registrations.get(id);
              if (row) keys.forEach((k, i) => { row[k] = args[i]; });
              return { meta: { changes: row ? 1 : 0 } };
            }
            if (sql.startsWith('UPDATE orders SET refund_policy_version')) { orderUpdates.push(args); return { meta: { changes: 1 } }; }
            if (sql.startsWith('DELETE FROM eligibility_answers')) { const before = answers.length; for (let i = answers.length - 1; i >= 0; i--) if (answers[i][4] < args[0]) answers.splice(i, 1); return { meta: { changes: before - answers.length } }; }
            return { meta: { changes: 0 } };
          },
          async all() {
            if (sql.includes('FROM registrations ORDER BY')) return { results: [...registrations.values()] };
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
const { QUESTIONS_VERSION, REFUND_POLICY_VERSION, AGREEMENT_VERSION } = await import('/home/user/atlasglinn-website/mast-backend/src/worker.js');
const FIRST_WEEKEND = '2026-10-10', BLOCKED_WEEKEND = '2026-10-31'; // from the seeded training_weekends
const goodReg = (over = {}) => ({
  sku: 'MAST-DA', qty: 1, session_date: FIRST_WEEKEND, session_label: 'Sat–Sun test',
  customer: { name: 'Jane Doe', email: 'Student@Example.com', phone: '(713) 555-0100', organization: '' },
  eligibility: { us_citizen: true, felony_prohibited: false, attested: true, questions_version: QUESTIONS_VERSION },
  agreement: { version: AGREEMENT_VERSION, signed_name: 'Jane Doe', initials: 'jd', address1: '1 Main St', address2: 'Houston, TX 77002', emergency_name: 'John Doe', emergency_phone: '(713) 555-0199', emergency_relationship: 'Spouse', scrolled: true, agreed: true },
  refund: { accepted: true, version: REFUND_POLICY_VERSION },
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

console.log('\n── Agreement PDF fill (the real form, pdf-lib) ──');
{
  const { readFileSync } = await import('node:fs');
  const { createHash } = await import('node:crypto');
  const { fillAgreement } = await import('/home/user/atlasglinn-website/mast-backend/src/agreement.js');
  const { PDFDocument } = await import('pdf-lib');
  const src = readFileSync('/home/user/atlasglinn-website/mast-backend/assets/class-participation-agreement.pdf');
  ok('AGREEMENT_VERSION is the hash prefix of the shipped PDF', createHash('sha256').update(src).digest('hex').startsWith(AGREEMENT_VERSION));
  const out = await fillAgreement(src, { id: 'reg_test', customer_name: 'Jane Doe', customer_email: 'student@example.com', customer_phone: '(713) 555-0100', address1: '1 Main St', address2: 'Houston, TX 77002', emergency_name: 'John Doe', emergency_phone: '(713) 555-0199', emergency_relationship: 'Spouse', agreement_signed_name: 'Jane Doe', agreement_initials: 'JD', agreement_signed_at: '2026-09-03T22:40:11Z', agreement_ip: '203.0.113.7' });
  ok('filled PDF produced', out && out.length > 100000, 'bytes=' + (out && out.length));
  const back = await PDFDocument.load(out);
  ok('form flattened: no editable fields remain', back.getForm().getFields().length === 0, 'fields=' + back.getForm().getFields().length);
  ok('three pages preserved', back.getPageCount() === 3);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

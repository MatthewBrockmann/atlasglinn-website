/**
 * MAST Solutions — booking & membership backend.
 *
 * Cloudflare Worker handling Stripe Checkout for:
 *   - one-time class seats      POST /create-booking
 *   - recurring memberships     POST /create-membership
 *   - Stripe webhooks           POST /webhook
 *   - admin roster              GET  /roster?key=...
 *   - health                    GET  /health
 *
 * Design notes vs. the older safeguard-stripe-backend:
 *   1. PRICES ARE SERVER-SIDE. The client sends a SKU, never an amount, so a
 *      crafted request cannot buy a $695 class for $1.
 *   2. ORDERS ARE PERSISTED. Completed checkouts are written to D1 and a
 *      notification email is sent, so a paid booking is never only a log line.
 *   3. CORS IS AN ALLOWLIST, not "*".
 *   4. Webhook signatures use a constant-time compare plus a replay window.
 */

const REPLAY_WINDOW_SECONDS = 300; // reject webhook timestamps older than 5 min

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      if (url.pathname === '/health' && request.method === 'GET') {
        return json({ status: 'MAST booking backend — ONLINE', version: '1.0.0' }, 200, cors);
      }
      if (url.pathname === '/catalog' && request.method === 'GET') {
        return await handleCatalog(env, cors);
      }
      if (url.pathname === '/weekends' && request.method === 'GET') {
        return await handleWeekends(env, cors);
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
      if (url.pathname === '/roster' && request.method === 'GET') {
        return await handleRoster(request, env, cors);
      }
      return json({ error: 'Not found' }, 404, cors);
    } catch (err) {
      console.error('[Worker] Unhandled:', err.stack || err.message);
      return json({ error: 'Internal server error' }, 500, cors);
    }
  },
};

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
    'Access-Control-Allow-Headers': 'Content-Type',
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
  // GO-LIVE TEST SEAT (owner, 2026-09-03). Not in D1 and not in the public
  // catalog; reachable only by SKU from the page's #test mode. Remove after
  // the first live payment has been verified in the roster.
  { sku: 'MAST-TEST',     name: 'Live payment test seat ($1.00)',          price_cents: 100 },
];

async function lookupClass(env, sku) {
  if (env.DB) {
    try {
      const row = await env.DB.prepare(
        'SELECT sku, name, price_cents FROM offerings WHERE sku = ? AND active = 1 LIMIT 1'
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
  });

  return await createSession(payload, env, cors, 'Booking');
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
        'SELECT plan_key, name, stripe_price_id FROM memberships WHERE plan_key = ? AND active = 1 LIMIT 1'
      )
        .bind(key)
        .first();
      if (row && row.stripe_price_id) {
        return { key, name: row.name, priceId: row.stripe_price_id };
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
    'metadata[source]': 'mastsolutions',
    allow_promotion_codes: 'true',
    billing_address_collection: 'auto',
  });

  return await createSession(payload, env, cors, 'Membership');
}

/* ─────────────────────── Stripe session helper ─────────────────────── */

async function createSession(payload, env, cors, label) {
  if (!env.STRIPE_SECRET_KEY) {
    console.error('[' + label + '] STRIPE_SECRET_KEY not set');
    return json({ error: 'Payments are not configured. Please call to book.' }, 503, cors);
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
    return json({ error: 'Could not start checkout. Please try again or call us.' }, 502, cors);
  }

  console.log('[' + label + '] Session created:', session.id);
  return json({ checkoutUrl: session.url, sessionId: session.id }, 200, cors);
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
      created_at: new Date().toISOString(),
    };

    // Persist first — a stored order is what makes the money recoverable.
    const stored = await storeOrder(env, record);

    // Then notify. Never let a failing email lose the order.
    ctx.waitUntil(
      notify(env, record, stored).catch((e) => console.error('[Notify] failed:', e.message))
    );
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
  try {
    await env.DB.prepare(
      `INSERT INTO orders (
         stripe_session_id, stripe_event_id, kind, sku, item_name, session_date, session_label, qty,
         amount_total, currency, customer_email, customer_name, customer_phone,
         organization, notes, status, created_at
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'paid',?)
       ON CONFLICT(stripe_session_id) DO NOTHING`
    )
      .bind(
        r.stripe_session_id, r.stripe_event_id, r.kind, r.sku, r.item_name,
        r.session_date || null, r.session_label || null, r.qty,
        r.amount_total, r.currency, r.customer_email, r.customer_name, r.customer_phone,
        r.organization, r.notes, r.created_at
      )
      .run();
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

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + env.RESEND_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.NOTIFY_FROM || 'MAST Solutions <bookings@mastsolutions.com>',
      to: to.split(',').map((s) => s.trim()),
      reply_to: r.customer_email || undefined,
      subject,
      text,
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error('Resend ' + res.status + ': ' + detail);
  }
  console.log('[Notify] Sent to', to, '—', subject);
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

function defaultUrl(env, suffix) {
  const base = allowedOrigins(env)[0] || env.SITE_URL || 'https://mastsolutions.com';
  return base.replace(/\/$/, '/') + suffix;
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

function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

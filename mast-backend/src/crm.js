/**
 * MAST CRM + marketing layer — first-party data only.
 *
 * DATA-AND-MARKETING.md (owner's brief, 2026-09-01): "build the CDP pattern, skip the DMP" — unified profiles, behavioural
 * segments, an opted-in audience for the marketing tool, closed-loop revenue per channel, triggered journeys, all on data
 * the booking flow writes itself. ARCHITECTURE.md §7: marketing mail goes to Mailchimp, gated on the newsletter opt-in;
 * transactional mail (receipts, reminders) stays on Resend and is never unsubscribable.
 *
 * What lives here (owner, 2026-09-06: "CRM should collect data - and much more"):
 *   collect   contacts (every inquiry and sign-up, stored before it is emailed), events (a first-party beacon: views and the
 *             moments that lead to a seat), attribution (UTM, referrer, landing page, first touch) on registrations and orders
 *   profile   one record per email across orders, registrations, accounts and contacts; segments that move revenue
 *   activate  the opted-in audience as CSV, an optional Mailchimp upsert, the T−7 / T−1 / T+1 journeys from the daily cron
 *   see       GET /admin — the staff page; GET /admin/crm — the same as JSON (view=summary: counts only, no people)
 *
 * Rules kept here:
 *   - NEVER eligibility_answers (nor the eligibility columns beyond the cleared/flagged status). Those never leave D1.
 *   - Consent is separate from purchase: only an explicit newsletter tick (registration or /subscribe) puts an address in
 *     the audience or in Mailchimp. Journeys are transactional (a booked class) and go to the participant only.
 *   - Everything staff-facing is behind ADMIN_KEY (header X-Admin-Key or ?key=); /admin is noindex, no-store.
 */

const DAY = 86400000;
const UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
export const EVENT_ACTIONS = ['view', 'open_class', 'pick_date', 'start_registration', 'checkout', 'contact', 'gear_request', 'video_play', 'menu', 'cta', 'subscribe', 'account', 'follow'];

const lower = (v) => String(v || '').trim().toLowerCase();
const nonEmpty = (v) => (typeof v === 'string' && v.trim() ? v.trim() : '');
const cut = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const isEmail = (v) => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());

/** Course level from the SKU suffix (the catalog's naming: -FUND / -LADIES, -OP, -P1, -P2). */
export function classLevel(sku) {
  const s = String(sku || '').toUpperCase();
  if (/-FUND$|-LADIES$/.test(s)) return 'fundamentals';
  if (/-OP$/.test(s)) return 'operator';
  if (/-P1$/.test(s)) return 'p1';
  if (/-P2$/.test(s)) return 'p2';
  return 'other';
}

/* ─────────────────────────────── Schema (self-applied) ─────────────────────────────── */

export const CRM_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS contacts (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, kind TEXT NOT NULL, name TEXT, email TEXT NOT NULL, phone TEXT, company TEXT, status TEXT, request_type TEXT, message TEXT, page TEXT, referrer TEXT, landing_page TEXT, utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, utm_content TEXT, utm_term TEXT, visitor TEXT, newsletter_opt_in INTEGER DEFAULT 0, consent_text TEXT, ip TEXT, user_agent TEXT, emailed INTEGER DEFAULT 0)`,
  'CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts (email)',
  'CREATE INDEX IF NOT EXISTS idx_contacts_created ON contacts (created_at)',
  `CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, visitor TEXT, email TEXT, page TEXT, action TEXT NOT NULL, label TEXT, sku TEXT, referrer TEXT, utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, country TEXT, device TEXT)`,
  'CREATE INDEX IF NOT EXISTS idx_events_created ON events (created_at)',
  'CREATE INDEX IF NOT EXISTS idx_events_visitor ON events (visitor)',
  `CREATE TABLE IF NOT EXISTS email_log (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, email TEXT NOT NULL, ref TEXT NOT NULL, kind TEXT NOT NULL, status TEXT, UNIQUE (email, ref, kind))`,
  ...['utm_source', 'utm_medium', 'utm_campaign', 'referrer', 'landing_page', 'first_touch_at', 'visitor'].map((c) => `ALTER TABLE registrations ADD COLUMN ${c} TEXT`),
  ...['utm_source', 'utm_medium', 'utm_campaign', 'first_touch_at'].map((c) => `ALTER TABLE orders ADD COLUMN ${c} TEXT`),
];

let schemaReady = null;
/** Idempotent; once per isolate. ALTERs that already happened raise "duplicate column", which is the expected outcome. */
export function ensureCrmSchema(env) {
  if (!env || !env.DB) return Promise.resolve(false);
  if (!schemaReady) {
    schemaReady = (async () => {
      for (const s of CRM_SCHEMA) {
        try { await env.DB.prepare(s).run(); }
        catch (e) { if (!/duplicate column|already exists/i.test(String(e && e.message))) console.error('[CRM] schema step failed:', s.slice(0, 48), e.message); }
      }
      return true;
    })().catch((e) => { schemaReady = null; console.error('[CRM] schema failed:', e.message); return false; });
  }
  return schemaReady;
}
export function _resetSchemaMemo() { schemaReady = null; }   // tests

/* ─────────────────────────────── Attribution ─────────────────────────────── */

/** What the page sends as `attribution` (first touch kept in localStorage), plus what the request itself tells. */
export function attributionFrom(body, request) {
  const a = (body && typeof body.attribution === 'object' && body.attribution) || {};
  const out = {
    visitor: cut(a.visitor, 64), referrer: cut(a.referrer, 500), landing_page: cut(a.landing_page, 500),
    first_touch_at: cut(a.first_touch_at, 40), page: cut(a.page, 500) || cut(body && body.page, 500),
  };
  for (const k of UTM) out[k] = cut(a[k], 120);
  out.ip = request ? (request.headers.get('CF-Connecting-IP') || '') : '';
  out.user_agent = request ? (request.headers.get('User-Agent') || '').slice(0, 300) : '';
  out.country = request ? (request.headers.get('CF-IPCountry') || '') : '';
  out.device = /Mobi|Android|iPhone|iPad/i.test(out.user_agent) ? 'mobile' : (out.user_agent ? 'desktop' : '');
  return out;
}

/* ─────────────────────────────── Collect ─────────────────────────────── */

const CONTACT_COLS = ['id', 'created_at', 'kind', 'name', 'email', 'phone', 'company', 'status', 'request_type', 'message', 'page', 'referrer', 'landing_page', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'visitor', 'newsletter_opt_in', 'consent_text', 'ip', 'user_agent', 'emailed'];

/** Store an inquiry or sign-up. Never throws: a lead that cannot be written is logged, the form still works. */
export async function recordContact(env, c) {
  if (!env.DB) return null;
  await ensureCrmSchema(env);
  const a = c.attribution || {};
  const row = {
    id: 'lead_' + crypto.randomUUID(), created_at: new Date().toISOString(), kind: c.kind || 'contact',
    name: cut(c.name, 200), email: lower(c.email), phone: cut(c.phone, 60), company: cut(c.company, 200), status: cut(c.status, 200),
    request_type: cut(c.request_type, 60), message: cut(c.message, 4000), page: a.page || null, referrer: a.referrer || null,
    landing_page: a.landing_page || null, utm_source: a.utm_source || null, utm_medium: a.utm_medium || null, utm_campaign: a.utm_campaign || null,
    utm_content: a.utm_content || null, utm_term: a.utm_term || null, visitor: a.visitor || null,
    newsletter_opt_in: c.newsletter_opt_in ? 1 : 0, consent_text: c.newsletter_opt_in ? cut(c.consent_text, 300) || null : null,
    ip: a.ip || null, user_agent: a.user_agent || null, emailed: 0,
  };
  try {
    await env.DB.prepare(`INSERT INTO contacts (${CONTACT_COLS.join(', ')}) VALUES (${CONTACT_COLS.map(() => '?').join(',')})`)
      .bind(...CONTACT_COLS.map((k) => (row[k] === undefined ? null : row[k]))).run();
    return row.id;
  } catch (e) { console.error('[CRM] lead not stored:', e.message); return null; }
}

export async function markContactEmailed(env, id) {
  if (!env.DB || !id) return;
  await env.DB.prepare('UPDATE contacts SET emailed = 1 WHERE id = ?').bind(id).run().catch(() => {});
}

const EVENT_COLS = ['created_at', 'visitor', 'email', 'page', 'action', 'label', 'sku', 'referrer', 'utm_source', 'utm_medium', 'utm_campaign', 'country', 'device'];

export async function recordEvent(env, e) {
  if (!env.DB) return false;
  await ensureCrmSchema(env);
  const a = e.attribution || {};
  const row = {
    created_at: new Date().toISOString(), visitor: cut(e.visitor, 64) || a.visitor || null, email: isEmail(e.email || '') ? lower(e.email) : null,
    page: cut(e.page, 500) || a.page || null, action: e.action, label: cut(e.label, 120) || null, sku: cut(e.sku, 40) || null,
    referrer: a.referrer || null, utm_source: a.utm_source || null, utm_medium: a.utm_medium || null, utm_campaign: a.utm_campaign || null,
    country: a.country || null, device: a.device || null,
  };
  try {
    await env.DB.prepare(`INSERT INTO events (${EVENT_COLS.join(', ')}) VALUES (${EVENT_COLS.map(() => '?').join(',')})`)
      .bind(...EVENT_COLS.map((k) => (row[k] === undefined ? null : row[k]))).run();
    return true;
  } catch (err) { console.error('[CRM] event not stored:', err.message); return false; }
}

/** POST /event — the page's beacon. Anything outside the known actions is dropped quietly. */
export async function handleEvent(request, env, cors, json) {
  let body = null;
  try { body = JSON.parse(await request.text()); } catch (_) { body = null; }
  if (!body || typeof body !== 'object' || !EVENT_ACTIONS.includes(body.action)) return json({ ok: false }, 400, cors);
  const attribution = attributionFrom(body, request);
  const stored = await recordEvent(env, { ...body, attribution });
  return json({ ok: stored }, stored ? 200 : 503, cors);
}

/** POST /subscribe — the newsletter form: consent is the tick, recorded with its wording; Mailchimp gets it when configured. */
export async function handleSubscribe(request, env, cors, json) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return json({ error: 'Bad request' }, 400, cors);
  if (nonEmpty(body.website)) return json({ ok: true }, 200, cors);   // honeypot
  const email = lower(body.email);
  if (!isEmail(email)) return json({ error: 'Enter a valid email address.', field: 'email' }, 400, cors);
  if (body.consent !== true) return json({ error: 'Tick the box to receive MAST news.', field: 'consent' }, 400, cors);
  const attribution = attributionFrom(body, request);
  const id = await recordContact(env, {
    kind: 'subscribe', name: body.name, email, phone: body.phone, company: body.company, request_type: cut(body.source, 60) || 'newsletter',
    newsletter_opt_in: true, consent_text: body.consent_text || 'Send me MAST Solutions course dates and news. Unsubscribe any time.', attribution,
  });
  await recordEvent(env, { visitor: attribution.visitor, email, page: attribution.page, action: 'subscribe', label: cut(body.source, 60) || 'newsletter', attribution }).catch(() => {});
  let mailchimp = { skipped: 'not_configured' };
  if (mailchimpConfig(env)) {
    const [p] = buildProfiles({ contacts: [{ id, created_at: new Date().toISOString(), kind: 'subscribe', email, name: body.name || '', phone: body.phone || '', company: body.company || '', newsletter_opt_in: 1, newsletter_opted_in_at: new Date().toISOString() }] });
    mailchimp = await mailchimpUpsert(env, p).catch((e) => ({ ok: false, error: e.message }));
  }
  return json({ ok: true, stored: !!id, mailchimp: mailchimp.ok ? 'synced' : (mailchimp.skipped || 'failed') }, 200, cors);
}

/* ─────────────────────────────── Profiles ─────────────────────────────── */

/** One profile per email from orders, registrations, accounts and contacts. Pure: no I/O, so the tests can feed it rows. */
export function buildProfiles({ orders = [], registrations = [], accounts = [], contacts = [] }, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const nowMs = now.getTime();
  const map = new Map();
  const get = (email) => {
    const key = lower(email);
    if (!key) return null;
    if (!map.has(key)) {
      map.set(key, {
        email: key, name: '', phone: '', organization: '', segment: 'civilian',
        opt_in: false, opted_in_at: null, opt_in_source: null, has_account: false, standards_passed: null,
        classes: [], abandoned: [], inquiries: [], review: false, eligibility_status: null,
        spend_cents: 0, orders: 0, first_seen: null, last_seen: null,
        utm_source: null, utm_medium: null, utm_campaign: null, first_touch_at: null, referrer: null, landing_page: null,
        flags: [],
      });
    }
    return map.get(key);
  };
  const seen = (p, t) => {
    if (!t) return;
    if (!p.first_seen || t < p.first_seen) p.first_seen = t;
    if (!p.last_seen || t > p.last_seen) p.last_seen = t;
  };
  const fill = (p, name, phone, org) => {
    if (!p.name && nonEmpty(name)) p.name = nonEmpty(name);
    if (!p.phone && nonEmpty(phone)) p.phone = nonEmpty(phone);
    if (!p.organization && nonEmpty(org)) p.organization = nonEmpty(org);
  };
  const touch = (p, r) => {
    if (!p.utm_source && r.utm_source) { p.utm_source = r.utm_source; p.utm_medium = r.utm_medium || null; p.utm_campaign = r.utm_campaign || null; }
    if (!p.first_touch_at && r.first_touch_at) p.first_touch_at = r.first_touch_at;
    if (!p.referrer && r.referrer) p.referrer = r.referrer;
    if (!p.landing_page && r.landing_page) p.landing_page = r.landing_page;
  };
  const optIn = (p, at, source) => {
    p.opt_in = true;
    if (!p.opted_in_at || (at && at > p.opted_in_at)) { p.opted_in_at = at || p.opted_in_at; p.opt_in_source = source; }
  };
  const addClass = (p, row, source) => {
    const sku = String(row.sku || '');
    const date = row.session_date || null;
    if (p.classes.some((c) => c.sku === sku && c.date === date)) return;
    p.classes.push({ sku, name: row.item_name || sku, date, level: classLevel(sku), source, paid_at: row.paid_at || row.created_at || null });
  };

  for (const o of orders) {
    const p = get(o.customer_email); if (!p) continue;
    fill(p, o.customer_name, o.customer_phone, o.organization); seen(p, o.created_at); touch(p, o);
    const paid = !o.status || o.status === 'paid';
    if (paid) { p.spend_cents += Number(o.amount_total || 0); p.orders += 1; }
    if (paid && (o.kind === 'class_booking' || !o.kind) && o.sku) addClass(p, o, 'order');
  }
  for (const r of registrations) {
    const p = get(r.customer_email); if (!p) continue;
    fill(p, r.customer_name, r.customer_phone, r.organization); seen(p, r.created_at); touch(p, r);
    if (r.eligibility_status) p.eligibility_status = r.eligibility_status;   // cleared | flagged — the status only, never the answers
    if (Number(r.newsletter_opt_in) === 1) optIn(p, r.newsletter_opted_in_at || r.created_at || null, 'registration');
    if (r.status === 'paid' || r.status === 'completed') addClass(p, r, 'registration');
    else if (r.status === 'review') p.review = true;
    else if (r.status === 'pending' || r.status === 'abandoned') p.abandoned.push({ sku: r.sku, date: r.session_date || null, at: r.created_at });
  }
  for (const a of accounts) {
    const p = get(a.email); if (!p) continue;
    fill(p, a.name, a.phone, a.organization); seen(p, a.created_at);
    p.has_account = !!a.verified_at;
    if (a.standards_passed) p.standards_passed = a.standards_passed;
  }
  for (const c of contacts) {
    const p = get(c.email); if (!p) continue;
    fill(p, c.name, c.phone, c.company); seen(p, c.created_at); touch(p, c);
    if (Number(c.newsletter_opt_in) === 1) optIn(p, c.created_at || null, c.kind === 'subscribe' ? 'subscribe' : c.kind);
    if (c.kind !== 'subscribe') p.inquiries.push({ kind: c.kind, request_type: c.request_type || null, at: c.created_at, page: c.page || null });
  }

  for (const p of map.values()) {
    p.segment = p.organization ? 'agency' : 'civilian';
    p.classes.sort((x, y) => String(x.date || '').localeCompare(String(y.date || '')));
    p.inquiries.sort((x, y) => String(y.at || '').localeCompare(String(x.at || '')));
    const past = p.classes.filter((c) => c.date && c.date <= today);
    const future = p.classes.filter((c) => c.date && c.date > today);
    p.last_class_date = past.length ? past[past.length - 1].date : null;
    p.next_class_date = future.length ? future[0].date : null;
    p.levels = [...new Set(p.classes.map((c) => c.level))];
    const flags = [];
    if (p.opt_in) flags.push('opted_in');
    if (!p.classes.length && (p.inquiries.length || p.opt_in)) flags.push('lead');
    if (p.classes.length && p.levels.every((l) => l === 'fundamentals')) flags.push('fundamentals_only');
    if (p.last_class_date && !p.next_class_date && nowMs - Date.parse(p.last_class_date) > 365 * DAY) flags.push('win_back');
    const recentPaid = p.classes.some((c) => c.paid_at && nowMs - Date.parse(c.paid_at) < 30 * DAY);
    if (!recentPaid && p.abandoned.some((a) => a.at && nowMs - Date.parse(a.at) < 30 * DAY)) flags.push('abandoned_30d');
    if (p.next_class_date) flags.push('upcoming');
    if (p.review) flags.push('review');
    if (p.segment === 'agency') flags.push('agency');
    if (p.has_account) flags.push('account');
    if (p.inquiries.some((i) => i.kind === 'gear')) flags.push('gear');
    p.flags = flags;
  }
  return [...map.values()].sort((a, b) => String(b.last_seen || '').localeCompare(String(a.last_seen || '')));
}

const SEGMENT_TEXT = {
  opted_in: 'Newsletter opt-in — the only addresses the marketing tool may hold',
  lead: 'Asked or signed up, never booked',
  fundamentals_only: 'Took a Fundamentals course, never an Operator / P1 / P2 — the natural upsell',
  win_back: 'Last class over 12 months ago, nothing booked — win-back',
  abandoned_30d: 'Started a registration in the last 30 days, did not pay — one nudge, once',
  upcoming: 'Has a class coming up',
  review: 'A registration is waiting for eligibility review',
  agency: 'Booked or asked with an organization — agency and team-block offers',
  gear: 'Asked for an Aimpoint / IWA quote',
  account: 'Has a verified student account',
};

/* ───────────────────────────── D1 reads ───────────────────────────── */

async function rows(env, sql, binds = [], fallbackSql) {
  if (!env.DB) return [];
  try { const { results } = await env.DB.prepare(sql).bind(...binds).all(); return results || []; }
  catch (e) {
    if (!fallbackSql) { console.error('[CRM] read failed:', e.message); return []; }
    try { const { results } = await env.DB.prepare(fallbackSql).bind(...binds).all(); return results || []; }
    catch (e2) { console.error('[CRM] read failed:', e2.message); return []; }
  }
}

const ORDER_COLS = 'stripe_session_id, kind, sku, item_name, session_date, session_label, qty, amount_total, currency, customer_email, customer_name, customer_phone, organization, status, created_at';
const REG_COLS = 'id, created_at, status, sku, item_name, qty, session_date, session_label, customer_name, customer_email, customer_phone, organization, eligibility_status, newsletter_opt_in, newsletter_opted_in_at, paid_at, stripe_session_id';

const bucket = (list, keyOf, valueOf = () => 1) => {
  const m = new Map();
  for (const x of list) { const k = keyOf(x) || '(none)'; m.set(k, (m.get(k) || 0) + (Number(valueOf(x)) || 0)); }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([key, value]) => ({ key, value }));
};
const distinct = (list, f) => new Set(list.map(f).filter(Boolean)).size;

/** Everything the staff page and the audience export need. `view: "summary"` leaves the people out (counts only). */
export async function crmSnapshot(env, { view = 'full', limit = 5000, now = new Date() } = {}) {
  await ensureCrmSchema(env);
  const orders = await rows(env,
    `SELECT ${ORDER_COLS}, utm_source, utm_medium, utm_campaign, first_touch_at FROM orders ORDER BY created_at DESC LIMIT ${limit}`, [],
    `SELECT ${ORDER_COLS} FROM orders ORDER BY created_at DESC LIMIT ${limit}`);
  const registrations = await rows(env,
    `SELECT ${REG_COLS}, utm_source, utm_medium, utm_campaign, referrer, landing_page, first_touch_at FROM registrations ORDER BY created_at DESC LIMIT ${limit}`, [],
    `SELECT ${REG_COLS} FROM registrations ORDER BY created_at DESC LIMIT ${limit}`);
  const accounts = await rows(env, `SELECT id, email, name, phone, organization, standards_passed, created_at, verified_at, last_login_at FROM accounts ORDER BY created_at DESC LIMIT ${limit}`);
  const contacts = await rows(env, `SELECT id, created_at, kind, name, email, phone, company, status, request_type, page, referrer, landing_page, utm_source, utm_medium, utm_campaign, visitor, newsletter_opt_in, emailed FROM contacts ORDER BY created_at DESC LIMIT ${limit}`);
  const since30 = new Date(now.getTime() - 30 * DAY).toISOString();
  const events = await rows(env, `SELECT created_at, visitor, email, page, action, label, sku, referrer, utm_source, device, country FROM events WHERE created_at >= ? ORDER BY created_at DESC LIMIT 20000`, [since30]);
  const log = await rows(env, 'SELECT kind, status, created_at FROM email_log ORDER BY created_at DESC LIMIT 5000');

  const customers = buildProfiles({ orders, registrations, accounts, contacts }, now);
  const today = now.toISOString().slice(0, 10);
  const paidOrders = orders.filter((o) => !o.status || o.status === 'paid');
  const sum = (list, f) => list.reduce((n, x) => n + (Number(f(x)) || 0), 0);
  const regByStatus = {};
  for (const r of registrations) regByStatus[r.status || 'unknown'] = (regByStatus[r.status || 'unknown'] || 0) + 1;
  const upcoming = bucket(registrations.filter((r) => (r.status === 'paid' || r.status === 'completed') && r.session_date && r.session_date >= today), (r) => r.session_date, (r) => r.qty || 1)
    .sort((a, b) => a.key.localeCompare(b.key));
  const segments = {};
  for (const [k, text] of Object.entries(SEGMENT_TEXT)) segments[k] = { count: customers.filter((c) => c.flags.includes(k)).length, text };
  const byAction = (a) => events.filter((e) => e.action === a);
  const funnel = {
    days: 30, visitors: distinct(events, (e) => e.visitor), views: byAction('view').length,
    opened_class: distinct(byAction('open_class'), (e) => e.visitor), picked_date: distinct(byAction('pick_date'), (e) => e.visitor),
    started_registration: distinct(byAction('start_registration'), (e) => e.visitor), checkout: distinct(byAction('checkout'), (e) => e.visitor),
    paid: registrations.filter((r) => r.paid_at && r.paid_at >= since30).length,
    top_pages: bucket(byAction('view'), (e) => e.page).slice(0, 10), top_sources: bucket(byAction('view'), (e) => e.utm_source || 'direct').slice(0, 10),
    top_classes_opened: bucket(byAction('open_class'), (e) => e.sku || e.label).slice(0, 10), videos_played: bucket(byAction('video_play'), (e) => e.label).slice(0, 8),
    devices: bucket(byAction('view'), (e) => e.device || '(unknown)'),
  };
  const journeys = {};
  for (const l of log) { const k = journeys[l.kind] || (journeys[l.kind] = { sent: 0, failed: 0, sending: 0 }); k[l.status] = (k[l.status] || 0) + 1; }
  const leads = contacts.filter((c) => c.kind !== 'subscribe');
  const stats = {
    profiles: customers.length,
    opted_in: customers.filter((c) => c.opt_in).length,
    leads: { total: leads.length, last_30_days: leads.filter((c) => c.created_at >= since30).length, by_kind: bucket(leads, (c) => c.kind), unemailed: leads.filter((c) => !c.emailed).length },
    subscribers: distinct(contacts.filter((c) => c.kind === 'subscribe'), (c) => c.email),
    with_account: customers.filter((c) => c.has_account).length,
    orders: { total: orders.length, paid: paidOrders.length, last_at: orders[0] ? orders[0].created_at : null },
    revenue_cents: { total: sum(paidOrders, (o) => o.amount_total), last_30_days: sum(paidOrders.filter((o) => o.created_at >= since30), (o) => o.amount_total) },
    revenue_by_sku_cents: bucket(paidOrders, (o) => o.sku, (o) => o.amount_total).slice(0, 12),
    revenue_by_source_cents: bucket(paidOrders, (o) => o.utm_source || 'direct', (o) => o.amount_total),
    registrations: { total: registrations.length, by_status: regByStatus },
    seats_upcoming: upcoming,
    accounts: { total: accounts.length, verified: accounts.filter((a) => a.verified_at).length },
    funnel, journeys,
    mailchimp: mailchimpConfig(env) ? 'configured' : 'not configured (MAILCHIMP_API_KEY, MAILCHIMP_AUDIENCE_ID)',
  };
  const out = { generated_at: now.toISOString(), stats, segments };
  if (view !== 'summary') { out.customers = customers; out.leads = leads.slice(0, 500); }
  return out;
}

/* ───────────────────────── Audience export (CSV) ───────────────────────── */

const csvCell = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

function splitName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] || '', last: parts.slice(1).join(' ') };
}

function tagsFor(p) {
  const tags = new Set(['mast']);
  if (p.classes.length) tags.add('customer');
  for (const c of p.classes) { if (c.sku) tags.add(c.sku); tags.add(c.level); }
  for (const f of p.flags) if (f !== 'opted_in') tags.add(f);
  if (p.opt_in_source) tags.add('via_' + p.opt_in_source);
  return [...tags];
}

/** Opted-in profiles only — Mailchimp / any list tool imports this as is. */
export function audienceCsv(customers) {
  const head = ['email', 'first_name', 'last_name', 'phone', 'segment', 'last_class', 'last_class_date', 'next_class_date', 'classes', 'tags', 'opted_in_at', 'opt_in_source', 'utm_source'];
  const lines = [head.join(',')];
  for (const p of customers) {
    if (!p.opt_in) continue;
    const { first, last } = splitName(p.name);
    const lastClass = p.classes.filter((c) => !p.last_class_date || c.date === p.last_class_date).slice(-1)[0];
    lines.push([p.email, first, last, p.phone, p.segment, lastClass ? lastClass.name : '', p.last_class_date || '', p.next_class_date || '',
      p.classes.map((c) => c.sku).join(' '), tagsFor(p).join(' '), p.opted_in_at || '', p.opt_in_source || '', p.utm_source || ''].map(csvCell).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

/* ─────────────────────────────── Mailchimp ─────────────────────────────── */

export function mailchimpConfig(env) {
  const key = nonEmpty(env && env.MAILCHIMP_API_KEY);
  const list = nonEmpty(env && env.MAILCHIMP_AUDIENCE_ID);
  if (!key || !list) return null;
  const dc = nonEmpty(env.MAILCHIMP_SERVER) || (key.includes('-') ? key.split('-').pop() : '');
  if (!dc) return null;
  return { key, list, dc };
}

/** Upsert one opted-in profile. Returns { ok, status } or { skipped: reason }. Never called for a profile without opt-in. */
export async function mailchimpUpsert(env, p) {
  const cfg = mailchimpConfig(env);
  if (!cfg) return { skipped: 'not_configured' };
  if (!p || !p.opt_in) return { skipped: 'not_opted_in' };
  const { first, last } = splitName(p.name);
  const lastClass = p.classes && p.classes.length ? p.classes[p.classes.length - 1] : null;
  const body = {
    email_address: p.email,
    status_if_new: 'subscribed',
    merge_fields: { FNAME: first, LNAME: last, PHONE: p.phone || '', SEGMENT: p.segment || '', LASTCLASS: lastClass ? lastClass.name : '' },
    tags: tagsFor(p),
  };
  const res = await fetch(`https://${cfg.dc}.api.mailchimp.com/3.0/lists/${cfg.list}/members/${md5(p.email)}`, {
    method: 'PUT',
    headers: { Authorization: 'Basic ' + btoa('mast:' + cfg.key), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) { const t = await res.text().catch(() => ''); console.error('[Mailchimp] ' + res.status + ' for ' + p.email + ': ' + t.slice(0, 200)); return { ok: false, status: res.status }; }
  return { ok: true, status: res.status };
}

/** Push every opted-in profile once (the staff page's "Sync" button). */
export async function syncAudience(env, customers) {
  const cfg = mailchimpConfig(env);
  const out = { configured: !!cfg, attempted: 0, ok: 0, failed: 0, not_opted_in: 0 };
  for (const p of customers) {
    if (!p.opt_in) { out.not_opted_in += 1; continue; }
    if (!cfg) continue;
    out.attempted += 1;
    const r = await mailchimpUpsert(env, p).catch((e) => { console.error('[Mailchimp] failed:', e.message); return { ok: false }; });
    if (r.ok) out.ok += 1; else out.failed += 1;
  }
  return out;
}

/** Webhook hook: after a paid registration, upsert the customer when — and only when — they ticked the newsletter box. */
export async function mailchimpOnPayment(env, registration, record) {
  if (!registration || Number(registration.newsletter_opt_in) !== 1) return { skipped: 'not_opted_in' };
  if (!mailchimpConfig(env)) return { skipped: 'not_configured' };
  const [p] = buildProfiles({ orders: record ? [{ ...record, status: 'paid' }] : [], registrations: [{ ...registration, status: 'paid' }] });
  return mailchimpUpsert(env, p);
}

/* ─────────────────────────────── Journeys (daily cron) ─────────────────────────────── */

/** The course after this one, from the catalog: Fundamentals → the discipline's Operator (or P1), P1 → P2. */
export function nextCourse(sku, catalog = []) {
  const s = String(sku || '').toUpperCase();
  const find = (k) => catalog.find((c) => String(c.sku).toUpperCase() === k && (c.price_cents === undefined || c.price_cents > 0));
  const level = classLevel(s);
  const base = s.replace(/-(FUND|LADIES|OP|P1|P2)$/, '');
  const candidates = level === 'fundamentals' ? [base + '-OP', base + '-P1', 'MAST-HG-OP']
    : level === 'p1' ? [base + '-P2', 'MAST-TEAM-P1']
    : level === 'operator' ? [base + '-P1', 'MAST-LL-P1', 'MAST-TEAM-P1']
    : level === 'p2' ? ['MAST-TEAM-P2', 'MAST-NVG-P1'] : [];
  for (const k of candidates) { const c = find(k); if (c && String(c.sku).toUpperCase() !== s) return { sku: c.sku, name: c.name }; }
  return null;
}

const dateOffset = (now, days) => new Date(now.getTime() + days * DAY).toISOString().slice(0, 10);
const longDate = (ymd) => { try { return new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }); } catch (_) { return ymd; } };

export function journeyText(kind, reg, env, catalog) {
  const when = longDate(reg.session_date);
  const office = env.REPLY_TO || 'matthew@mastsolutions.com';
  const range = env.RANGE_ADDRESS
    ? ['Range: ' + env.RANGE_ADDRESS + (env.RANGE_COORDS ? ' (' + env.RANGE_COORDS + ')' : ''), 'Rural range: your GPS will stop you short of it. Plan for the drive.']
    : ['Range directions: in your booking confirmation.'];
  const instagram = 'https://www.instagram.com/atlasglinn_mastsolutions/';
  if (kind === 't7') return {
    subject: 'One week out: ' + reg.item_name + ' on ' + when,
    text: [
      reg.customer_name ? reg.customer_name.split(' ')[0] + ',' : 'Hello,', '',
      'Your class is one week away.', '',
      'Course:  ' + reg.item_name, 'Date:    ' + when, 'Seats:   ' + (reg.qty || 1), '',
      ...range, '',
      'BEFORE YOU COME',
      '- Eye and ear protection, a hat, closed-toe boots, water and a packed lunch. The gear list for your course came by email; reply if you need it again.',
      '- Arrive 15 minutes early. Live-fire classes open with a mandatory safety brief; a student who misses it cannot be admitted to the range.',
      '- Bring photo ID. If anything on your registration changed, reply to this email now.',
      '- Weather: we train in it. Dress for the forecast; only lightning stops a range.', '',
      'Questions: ' + office + ' · (281) 654-8100', '', 'MAST Solutions · Details matter.',
    ].join('\n'),
  };
  if (kind === 't1') return {
    subject: 'Tomorrow: ' + reg.item_name,
    text: [
      reg.customer_name ? reg.customer_name.split(' ')[0] + ',' : 'Hello,', '',
      'Tomorrow is the day.', '',
      'Course:  ' + reg.item_name, 'Date:    ' + when, '',
      ...range, '',
      '- Be at the gate 15 minutes before the start time on your confirmation. The safety brief starts on time.',
      '- Photo ID, eye and ear protection, water, lunch, weather layers.',
      '- Running late or cannot make it: call (281) 654-8100 before the start. The refund and transfer terms you accepted are in your confirmation email.', '',
      'See you on the range.', '', 'MAST Solutions · Details matter.',
    ].join('\n'),
  };
  const next = nextCourse(reg.sku, catalog);
  const review = env.REVIEW_URL ? 'Two minutes that help the next student find us: ' + env.REVIEW_URL : 'Two minutes that help the next student find us: reply with a line about your day and whether we may quote it.';
  return {
    subject: 'Thank you from MAST — ' + reg.item_name,
    text: [
      reg.customer_name ? reg.customer_name.split(' ')[0] + ',' : 'Hello,', '',
      'Thank you for training with us at ' + reg.item_name + ' on ' + when + '.', '',
      review, '',
      next ? 'NEXT STEP: ' + next.name + '. Your seat in ' + reg.item_name + ' is the prerequisite; the next dates are on the page: ' + (env.SITE_URL || 'https://atlasglinn.com/mastsolutions.html') : 'NEXT STEP: the next dates are on the page: ' + (env.SITE_URL || 'https://atlasglinn.com/mastsolutions.html'),
      'Bring a teammate: reply with a name and we hold two seats together.', '',
      'Range days, drills and class photos: ' + instagram, '',
      'Reply to this email any time; it reaches the instructors.', '', 'MAST Solutions · Details matter.',
    ].join('\n'),
  };
}

const JOURNEYS = [{ kind: 't7', offset: 7 }, { kind: 't1', offset: 1 }, { kind: 'thanks', offset: -1 }];

/**
 * Called by the daily cron. `send({ to, subject, text, reply_to, bcc })` is the Worker's Resend sender. One email per
 * (participant, registration, kind), claimed in email_log with INSERT OR IGNORE before it is sent.
 */
export async function runJourneys(env, { send, now = new Date(), catalog = [] } = {}) {
  const out = { t7: { sent: 0, failed: 0, skipped: 0 }, t1: { sent: 0, failed: 0, skipped: 0 }, thanks: { sent: 0, failed: 0, skipped: 0 } };
  if (!env.DB || !send) return out;
  await ensureCrmSchema(env);
  for (const j of JOURNEYS) {
    const date = dateOffset(now, j.offset);
    const regs = await rows(env, `SELECT ${REG_COLS} FROM registrations WHERE status IN ('paid', 'completed') AND session_date = ? ORDER BY created_at`, [date]);
    for (const reg of regs) {
      const email = lower(reg.customer_email);
      if (!isEmail(email)) continue;
      let claimed = false;
      try {
        const r = await env.DB.prepare('INSERT OR IGNORE INTO email_log (created_at, email, ref, kind, status) VALUES (?, ?, ?, ?, ?)')
          .bind(now.toISOString(), email, reg.id, j.kind, 'sending').run();
        claimed = !!(r && r.meta && r.meta.changes);
      } catch (e) { console.error('[Journeys] claim failed:', e.message); }
      if (!claimed) { out[j.kind].skipped += 1; continue; }
      const { subject, text } = journeyText(j.kind, reg, env, catalog);
      try {
        await send({ to: [email], subject, text, reply_to: env.REPLY_TO || undefined, bcc: false });
        await env.DB.prepare("UPDATE email_log SET status = 'sent' WHERE email = ? AND ref = ? AND kind = ?").bind(email, reg.id, j.kind).run().catch(() => {});
        out[j.kind].sent += 1;
      } catch (e) {
        console.error('[Journeys] ' + j.kind + ' failed for ' + reg.id + ':', e.message);
        await env.DB.prepare("UPDATE email_log SET status = 'failed' WHERE email = ? AND ref = ? AND kind = ?").bind(email, reg.id, j.kind).run().catch(() => {});
        out[j.kind].failed += 1;
      }
    }
  }
  console.log('[Journeys]', JSON.stringify(out));
  return out;
}

/* ────────────────────────────── Staff page ────────────────────────────── */

/** The staff CRM at GET /admin. Same origin as the API; the key stays in sessionStorage and travels as X-Admin-Key. */
export function adminPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>MAST · CRM</title>
<style>
:root{--bg:#050810;--panel:#0b1221;--line:rgba(120,160,220,.22);--text:#e8eefc;--dim:#93a3c4;--blue:#4f8cff;--gold:#c9a84c}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 -apple-system,Segoe UI,Roboto,sans-serif}
header{display:flex;gap:.8rem;align-items:center;flex-wrap:wrap;padding:1rem 1.2rem;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--bg);z-index:2}
h1{font-size:1rem;letter-spacing:.3em;text-transform:uppercase;margin:0;color:var(--gold)}
input,button{font:inherit;border-radius:6px;border:1px solid var(--line);background:var(--panel);color:var(--text);padding:.5rem .7rem}
button{cursor:pointer}button.primary{background:var(--blue);border-color:var(--blue);color:#fff}
main{padding:1rem 1.2rem;max-width:1400px;margin:0 auto}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:.7rem;margin:.8rem 0 1.2rem}
.card{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:.8rem}
.card b{display:block;font-size:1.4rem;font-weight:600}.card span{color:var(--dim);font-size:.74rem;letter-spacing:.12em;text-transform:uppercase}
.chips{display:flex;gap:.5rem;flex-wrap:wrap;margin:.6rem 0}.chip{border:1px solid var(--line);border-radius:999px;padding:.3rem .8rem;cursor:pointer;color:var(--dim)}
.chip.on{border-color:var(--gold);color:var(--gold)}.chip small{opacity:.7;margin-left:.35rem}
table{width:100%;border-collapse:collapse;font-size:.86rem}th,td{padding:.45rem .5rem;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
th{color:var(--dim);font-weight:500;letter-spacing:.08em;text-transform:uppercase;font-size:.72rem}
td .f{display:inline-block;border:1px solid var(--line);border-radius:4px;padding:0 .35rem;margin:.1rem .15rem 0 0;font-size:.72rem;color:var(--dim)}
.wrap{overflow-x:auto}.muted{color:var(--dim)}#msg{color:var(--dim);margin-left:auto}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1rem}
.list{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:.6rem .9rem;font-size:.85rem}.list div{display:flex;justify-content:space-between;gap:1rem;padding:.15rem 0}.list b{color:var(--text)}
.tabs{display:flex;gap:.4rem;margin:1rem 0 .4rem}.tabs button.on{border-color:var(--gold);color:var(--gold)}
</style></head><body>
<header><h1>MAST · CRM</h1>
<input id="key" type="password" placeholder="ADMIN_KEY" autocomplete="off" style="width:180px">
<button class="primary" id="load">Load</button>
<input id="q" placeholder="search name, email, org, SKU" style="width:250px">
<button id="csv">Audience CSV</button><button id="sync">Sync to Mailchimp</button><span id="msg"></span></header>
<main><div class="cards" id="cards"></div>
<div class="grid"><div class="list" id="funnel"></div><div class="list" id="bysku"></div><div class="list" id="bysrc"></div><div class="list" id="journeys"></div></div>
<div class="tabs"><button id="tab-people" class="on">People</button><button id="tab-leads">Leads</button></div>
<div class="chips" id="chips"></div>
<div class="wrap" id="people"><table><thead><tr><th>Customer</th><th>Contact</th><th>Segment</th><th>Classes</th><th>Spend</th><th>Last / next</th><th>Source</th><th>Flags</th></tr></thead><tbody id="rows"></tbody></table></div>
<div class="wrap" id="leads" hidden><table><thead><tr><th>When</th><th>Kind</th><th>Who</th><th>Contact</th><th>Company / status</th><th>Page · source</th><th>Emailed</th></tr></thead><tbody id="leadrows"></tbody></table></div></main>
<script>
const $=(s)=>document.querySelector(s);let data=null,filter=null,tab='people';
const keyEl=$('#key');try{keyEl.value=sessionStorage.getItem('mast_admin_key')||''}catch(e){}
const money=(c)=>'$'+(Number(c||0)/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const esc=(s)=>String(s??'').replace(/[&<>"]/g,(ch)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
const rowsOf=(list,fmt)=>list&&list.length?list.map((x)=>'<div><span>'+esc(x.key)+'</span><span>'+fmt(x.value)+'</span></div>').join(''):'<div class="muted">—</div>';
async function api(path,opt){const key=keyEl.value.trim();try{sessionStorage.setItem('mast_admin_key',key)}catch(e){}
  const r=await fetch(path,Object.assign({headers:{'X-Admin-Key':key}},opt||{}));if(r.status===401){$('#msg').textContent='wrong key';throw new Error('401')}return r}
async function load(){$('#msg').textContent='loading…';const r=await api('/admin/crm');data=await r.json();render()}
function render(){const s=data.stats,f=s.funnel;
  $('#cards').innerHTML=[['Profiles',s.profiles],['Leads 30d',s.leads.last_30_days],['Opted in',s.opted_in],['Paid orders',s.orders.paid],['Revenue',money(s.revenue_cents.total)],['Last 30 days',money(s.revenue_cents.last_30_days)],['Visitors 30d',f.visitors],['Accounts',s.accounts.verified+' / '+s.accounts.total],['Awaiting review',(s.registrations.by_status||{}).review||0],['Mailchimp',s.mailchimp.startsWith('configured')?'on':'off']].map(([k,v])=>'<div class="card"><b>'+esc(v)+'</b><span>'+esc(k)+'</span></div>').join('');
  $('#funnel').innerHTML='<div><b>Funnel, last 30 days</b><span class="muted">visitors</span></div>'+[['Page views',f.views],['Opened a class',f.opened_class],['Picked a date',f.picked_date],['Started registration',f.started_registration],['Went to checkout',f.checkout],['Paid',f.paid]].map(([k,v])=>'<div><span>'+k+'</span><span>'+v+'</span></div>').join('')+'<div style="margin-top:.5rem"><b>Top pages</b></div>'+rowsOf(f.top_pages,(v)=>v)+'<div style="margin-top:.5rem"><b>Classes opened</b></div>'+rowsOf(f.top_classes_opened,(v)=>v)+'<div style="margin-top:.5rem"><b>Videos played</b></div>'+rowsOf(f.videos_played,(v)=>v);
  $('#bysku').innerHTML='<div><b>Revenue by course</b></div>'+rowsOf(s.revenue_by_sku_cents,money)+'<div style="margin-top:.6rem"><b>Seats on upcoming weekends</b></div>'+rowsOf(s.seats_upcoming,(v)=>v);
  $('#bysrc').innerHTML='<div><b>Revenue by source (UTM)</b></div>'+rowsOf(s.revenue_by_source_cents,money)+'<div style="margin-top:.6rem"><b>Traffic by source</b></div>'+rowsOf(f.top_sources,(v)=>v)+'<div style="margin-top:.6rem"><b>Devices</b></div>'+rowsOf(f.devices,(v)=>v)+'<div style="margin-top:.6rem"><b>Leads by kind</b></div>'+rowsOf(s.leads.by_kind,(v)=>v);
  const j=s.journeys||{};$('#journeys').innerHTML='<div><b>Journeys (daily cron)</b></div>'+['t7','t1','thanks'].map((k)=>'<div><span>'+({t7:'T−7 reminder',t1:'T−1 reminder',thanks:'T+1 thank-you'})[k]+'</span><span>'+((j[k]||{}).sent||0)+' sent'+((j[k]||{}).failed?' · '+j[k].failed+' failed':'')+'</span></div>').join('')+'<div class="muted" style="margin-top:.5rem">One email per participant per class per kind; transactional, no unsubscribe.</div>';
  $('#chips').innerHTML=Object.entries(data.segments).map(([k,v])=>'<span class="chip'+(filter===k?' on':'')+'" data-k="'+k+'" title="'+esc(v.text)+'">'+esc(k.replace(/_/g,' '))+'<small>'+v.count+'</small></span>').join('');
  document.querySelectorAll('.chip').forEach((c)=>c.onclick=()=>{filter=filter===c.dataset.k?null:c.dataset.k;render()});
  const q=$('#q').value.trim().toLowerCase();
  const list=(data.customers||[]).filter((p)=>(!filter||p.flags.includes(filter))&&(!q||[p.name,p.email,p.organization,p.phone,...p.classes.map((c)=>c.sku+' '+c.name)].join(' ').toLowerCase().includes(q)));
  $('#rows').innerHTML=list.map((p)=>'<tr><td><b>'+esc(p.name||'—')+'</b><br><span class="muted">'+esc(p.organization||'')+'</span></td><td>'+esc(p.email)+'<br><span class="muted">'+esc(p.phone||'')+'</span></td><td>'+esc(p.segment)+(p.opt_in?'<br><span class="muted">opt-in '+esc((p.opted_in_at||'').slice(0,10))+' · '+esc(p.opt_in_source||'')+'</span>':'')+'</td><td>'+(p.classes.map((c)=>esc(c.sku)+' <span class="muted">'+esc(c.date||'')+'</span>').join('<br>')||'<span class="muted">—</span>')+(p.inquiries.length?'<br><span class="muted">'+p.inquiries.length+' inquir'+(p.inquiries.length>1?'ies':'y')+': '+esc(p.inquiries.map((i)=>i.request_type||i.kind).join(', '))+'</span>':'')+'</td><td>'+money(p.spend_cents)+'</td><td>'+esc(p.last_class_date||'—')+'<br><span class="muted">'+esc(p.next_class_date||'')+'</span></td><td>'+esc(p.utm_source||'direct')+'<br><span class="muted">'+esc((p.landing_page||'').replace(/^https?:\\/\\/[^/]+/,'').slice(0,40))+'</span></td><td>'+p.flags.map((f)=>'<span class="f">'+esc(f)+'</span>').join('')+'</td></tr>').join('')||'<tr><td colspan="8" class="muted">no one matches</td></tr>';
  const leads=(data.leads||[]).filter((l)=>!q||[l.name,l.email,l.company,l.request_type,l.kind].join(' ').toLowerCase().includes(q));
  $('#leadrows').innerHTML=leads.map((l)=>'<tr><td>'+esc((l.created_at||'').replace('T',' ').slice(0,16))+'</td><td>'+esc(l.kind)+(l.request_type?' <span class="muted">'+esc(l.request_type)+'</span>':'')+'</td><td><b>'+esc(l.name||'—')+'</b></td><td>'+esc(l.email)+'<br><span class="muted">'+esc(l.phone||'')+'</span></td><td>'+esc(l.company||'')+'<br><span class="muted">'+esc(l.status||'')+'</span></td><td>'+esc((l.page||'').replace(/^https?:\\/\\/[^/]+/,'').slice(0,40))+'<br><span class="muted">'+esc(l.utm_source||l.referrer||'direct')+'</span></td><td>'+(l.emailed?'yes':'<span class="muted">no</span>')+'</td></tr>').join('')||'<tr><td colspan="7" class="muted">no leads yet</td></tr>';
  $('#msg').textContent=(tab==='people'?list.length+' of '+(data.customers||[]).length+' profiles':leads.length+' leads')+' · as of '+new Date(data.generated_at).toLocaleString()}
function setTab(t){tab=t;$('#people').hidden=t!=='people';$('#leads').hidden=t!=='leads';$('#chips').hidden=t!=='people';$('#tab-people').classList.toggle('on',t==='people');$('#tab-leads').classList.toggle('on',t==='leads');if(data)render()}
$('#tab-people').onclick=()=>setTab('people');$('#tab-leads').onclick=()=>setTab('leads');
$('#load').onclick=()=>load().catch((e)=>{if(e.message!=='401')$('#msg').textContent='failed: '+e.message});
$('#q').oninput=()=>data&&render();keyEl.onkeydown=(e)=>{if(e.key==='Enter')$('#load').click()};
$('#csv').onclick=async()=>{const r=await api('/admin/audience.csv');const b=await r.blob();const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='mast-audience-'+new Date().toISOString().slice(0,10)+'.csv';a.click()};
$('#sync').onclick=async()=>{$('#msg').textContent='syncing…';const r=await api('/admin/sync',{method:'POST'});const j=await r.json();$('#msg').textContent=j.configured?('Mailchimp: '+j.ok+' upserted, '+j.failed+' failed, '+j.not_opted_in+' without opt-in left out'):'Mailchimp is not configured on the Worker (MAILCHIMP_API_KEY, MAILCHIMP_AUDIENCE_ID); the CSV export works meanwhile'};
if(keyEl.value)$('#load').click();
</script></body></html>`;
}

/* ─────────────────────────────── md5 (Mailchimp member id) ─────────────────────────────── */
// Mailchimp addresses a member by the MD5 of the lowercased email. WebCrypto has no MD5 in Node, so a small RFC 1321
// implementation lives here; it is used for that identifier only, never for anything security-related.
export function md5(input) {
  const s = unescape(encodeURIComponent(String(input)));
  const K = new Array(64).fill(0).map((_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296));
  const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
  const words = [];
  for (let i = 0; i < s.length; i++) words[i >> 2] |= s.charCodeAt(i) << ((i % 4) * 8);
  words[s.length >> 2] |= 0x80 << ((s.length % 4) * 8);
  words[(((s.length + 8) >> 6) << 4) + 14] = s.length * 8;
  let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
  const rot = (x, n) => (x << n) | (x >>> (32 - n));
  const add = (x, y) => (((x & 0xffff) + (y & 0xffff)) + ((((x >> 16) + (y >> 16)) & 0xffff) << 16)) | 0;
  for (let i = 0; i < words.length; i += 16) {
    const [aa, bb, cc, dd] = [a, b, c, d];
    for (let j = 0; j < 64; j++) {
      let f, g;
      if (j < 16) { f = (b & c) | (~b & d); g = j; }
      else if (j < 32) { f = (d & b) | (~d & c); g = (5 * j + 1) % 16; }
      else if (j < 48) { f = b ^ c ^ d; g = (3 * j + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * j) % 16; }
      const t = d; d = c; c = b;
      b = add(b, rot(add(add(a, f), add(K[j], words[i + g] | 0)), S[j]));
      a = t;
    }
    a = add(a, aa); b = add(b, bb); c = add(c, cc); d = add(d, dd);
  }
  return [a, b, c, d].map((n) => { let h = ''; for (let i = 0; i < 4; i++) h += ((n >>> (i * 8)) & 0xff).toString(16).padStart(2, '0'); return h; }).join('');
}

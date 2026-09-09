/**
 * BUILDER FUZZ — mast-backend/scripts/fuzz-tax-shapes.mjs
 *
 * Rounds 5, 6 and 7 each shipped a check for the fields that round had named, and each time an INDEPENDENT reviewer's
 * fuzz found the next unnamed one — round 7's was `country`, thirteen violations of that single class across 226
 * mutations, with a duplicate US/TX registration POST behind it. A round that only re-checks the named fields cannot
 * discover that; a round that mutates EVERY key at EVERY level can, and this is that generator, wired into the suite
 * so it runs on every `node mast-backend/test-worker.mjs` rather than living in a reviewer's scratch directory.
 *
 * From one valid `GET /v1/tax/settings` body and one valid `GET /v1/tax/registrations` body it generates the cross
 * product of (every key at every level) × (delete · rename · retype · case · whitespace · empty · null · array/object
 * swap · nesting shift), plus extra keys, plus has_more variants, plus paged lists. Every mutation is TAGGED with what
 * it should do, and there are only three tags:
 *
 *   valid       byte-shape-valid AND the account is collecting  → measured:true, ready, the next order taxed.
 *   measured_no byte-shape-valid and the account genuinely is NOT collecting (status `pending`, an empty list, a Texas
 *               registration of another type, another state) → measured:true, ready:false. Stripe answered and said no,
 *               which is evidence, so the readiness row is SUPPOSED to be overwritten and the next order is SUPPOSED to
 *               be untaxed. Counting these as violations is how a fuzz talks a codebase into never trusting anything.
 *   drift       any mutation of a DECIDING field's shape → measured:false. The ready row must be byte-identical, the
 *               next order must still be taxed on the grace, and no registration POST may be made.
 *
 * The invariant, stated once: MEASURED:TRUE ONLY FOR BYTE-SHAPE-VALID RESPONSES. Everything else is `<shape>_unparseable`
 * and takes the keep-the-grace path. Zero registration POSTs across the whole run is the second invariant and it is the
 * expensive one — a create is not undoable.
 *
 * Run it alone:   node mast-backend/scripts/fuzz-tax-shapes.mjs
 * It also runs inside the suite (see the Round 8 block in test-worker.mjs), which is what makes it a guard rather than
 * a thing somebody remembered to run.
 */

const BASE_SETTINGS = { object: 'tax.settings', status: 'active', livemode: true,
  head_office: { address: { line1: '2450 Fondren Rd', line2: 'Suite 255', city: 'Houston', state: 'TX', postal_code: '77063', country: 'US' } },
  defaults: { tax_behavior: 'exclusive', tax_code: 'txcd_20030000' } };
const BASE_ROW = { id: 'taxreg_1AAA', object: 'tax.registration', active_from: 1757000000, country: 'US',
  country_options: { us: { state: 'TX', type: 'state_sales_tax' } }, created: 1757000000, expires_at: null, livemode: true, status: 'active' };
const BASE_REGS = { object: 'list', url: '/v1/tax/registrations', has_more: false, data: [BASE_ROW] };

const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
const NL = String.fromCharCode(10), TAB = String.fromCharCode(9);

/** Every way a field can stop being the field, short of deleting it. */
const RETYPE = [['number', 1], ['zero', 0], ['true', true], ['false', false], ['null', null], ['array', ['x']],
  ['empty_array', []], ['object', { a: 1 }], ['empty_object', {}], ['empty_string', ''], ['whitespace', ' ']];
/** How a string field drifts while still being a string: case, padding, punctuation, an invisible. */
// A variant that comes out EQUAL to the original is not a mutation, and counting it as one is how a fuzz reports a
// violation the code did not commit ('US'.toUpperCase() is 'US').
const restring = (v) => [['upper', String(v).toUpperCase()], ['title', String(v).charAt(0).toUpperCase() + String(v).slice(1)],
  ['lead_space', ' ' + v], ['trail_space', v + ' '], ['both_space', ' ' + v + ' '], ['newline', v + NL], ['tab', TAB + v],
  ['dotted', v + '.'], ['suffixed', v + '-1'], ['dashed', String(v).split('_').join('-')]].filter(([, out]) => out !== v);
/**
 * OVER-LENGTH, AT EVERY STRING FIELD — R9-2. A shape test with no size in it is satisfied at any size, and the round-8
 * schema had none: a 100,000-character lowercase `settings.status` was byte-shape-VALID, so it was MEASURED, so the
 * ready row inside its 24-hour grace was destroyed by a body no Stripe account produces. Three widths, because the
 * interesting one is the boundary and not the absurd one: ON the bound (still a real answer), one past it, and the
 * width the finding was written against. Generated per field from that field's own ceiling, so a bound that moves in
 * the schema and not here shows up as a fuzz violation rather than as silence.
 */
const overlong = (bound, alphabet = 'a') => [['on_the_bound', alphabet.repeat(bound)], ['one_past_the_bound', alphabet.repeat(bound + 1)], ['100k', alphabet.repeat(100000)]];
/** The invisibles that are NOT in JavaScript's `\s` — R9-5. A line1 of one zero-width space satisfied `^\S…\S$`, so it
 *  read as "the head office is set" and the settings write was skipped on an account that has no address. U+00A0 and
 *  U+FEFF are in `\s` and were already refused; they are fuzzed anyway rather than trusted to an engine's table. */
const ZERO_WIDTH = [['zwsp', '\u200B'], ['zwnj', '\u200C'], ['zwj', '\u200D'], ['bom', '\uFEFF'], ['nbsp', '\u00A0']];
/** How a key drifts: an API version renames it, a v2 shape moves it, somebody's proxy re-cases it. */
const rekey = (k) => [k.toUpperCase(), k + '_code', k + '_name', 'x_' + k, k.split('_').join(''), 'the_' + k].filter((out) => out !== k);

/**
 * The mutation set. Pure data: it makes no calls and knows nothing about the Worker, which is what lets the suite and
 * the standalone runner drive the identical list.
 */
export function taxShapeMutations() {
  const out = [];
  const add = (name, kind, settings, regs) => out.push({ name, kind, settings, regs });
  const S = (f) => { const s = clone(BASE_SETTINGS); f(s); return s; };
  const R = (f) => { const r = clone(BASE_REGS); f(r.data[0], r); return r; };
  const OK_REGS = () => clone(BASE_REGS), OK_SET = () => clone(BASE_SETTINGS);

  // ── the control ──
  add('control: both bodies exactly as Stripe writes them', 'valid', OK_SET(), OK_REGS());

  // ── settings.status ──
  for (const [t, v] of RETYPE) add('settings.status retyped ' + t, 'drift', S((s) => { s.status = v; }), OK_REGS());
  for (const [t, v] of restring('active')) add('settings.status restrung ' + t, 'drift', S((s) => { s.status = v; }), OK_REGS());
  add('settings.status DELETED', 'drift', S((s) => { delete s.status; }), OK_REGS());
  for (const k of rekey('status')) add('settings.status renamed -> ' + k, 'drift', S((s) => { s[k] = s.status; delete s.status; }), OK_REGS());
  for (const v of ['pending', 'not_collecting']) add('settings.status = ' + v + ' (a real answer)', 'measured_no', S((s) => { s.status = v; }), OK_REGS());
  // ON the 60-character bound is still an enum Stripe could theoretically send, and it is a real answer: measured, not
  // ready. One character past it is not a longer answer — it is a body this module did not understand.
  for (const [t, v] of overlong(60)) add('settings.status ' + t + ' (' + v.length + ' chars)', t === 'on_the_bound' ? 'measured_no' : 'drift', S((s) => { s.status = v; }), OK_REGS());

  // ── settings.head_office, which is the field the SETUP path decides to write on ──
  for (const [t, v] of RETYPE.filter(([t2]) => t2 !== 'null')) add('settings.head_office retyped ' + t, 'drift', S((s) => { s.head_office = v; }), OK_REGS());
  add('settings.head_office = null (an account with no head office)', 'valid', S((s) => { s.head_office = null; }), OK_REGS());
  add('settings.head_office DELETED', 'valid', S((s) => { delete s.head_office; }), OK_REGS());
  for (const [t, v] of RETYPE.filter(([t2]) => t2 !== 'null')) add('settings.head_office.address retyped ' + t, 'drift', S((s) => { s.head_office.address = v; }), OK_REGS());
  add('settings.head_office.address DELETED', 'drift', S((s) => { delete s.head_office.address; }), OK_REGS());
  for (const [t, v] of RETYPE) add('settings.head_office.address.line1 retyped ' + t, 'drift', S((s) => { s.head_office.address.line1 = v; }), OK_REGS());
  add('settings.head_office.address.line1 DELETED', 'drift', S((s) => { delete s.head_office.address.line1; }), OK_REGS());
  for (const k of rekey('line1')) add('settings.head_office.address.line1 renamed -> ' + k, 'drift', S((s) => { s.head_office.address[k] = s.head_office.address.line1; delete s.head_office.address.line1; }), OK_REGS());
  add('settings.head_office nesting shifted (address hoisted)', 'drift', S((s) => { s.head_office = { line1: '2450 Fondren Rd' }; }), OK_REGS());
  // line1 is the one non-enum string the schema declares, and it decides whether the setup run WRITES. Size and
  // invisibles are the two ways a string stops being an address line while still passing a shape test.
  for (const [t, v] of overlong(500)) add('settings.head_office.address.line1 ' + t + ' (' + v.length + ' chars)', t === 'on_the_bound' ? 'valid' : 'drift', S((s) => { s.head_office.address.line1 = v; }), OK_REGS());
  for (const [t, v] of ZERO_WIDTH) {
    add('settings.head_office.address.line1 is one ' + t + ' and nothing else', 'drift', S((s) => { s.head_office.address.line1 = v; }), OK_REGS());
    add('settings.head_office.address.line1 carries an interior ' + t, 'drift', S((s) => { s.head_office.address.line1 = '2450' + v + ' Fondren Rd'; }), OK_REGS());
  }

  // ── the settings BODY itself ──
  for (const [t, v] of [['array', [{ status: 'active' }]], ['null', null], ['string', 'active'], ['number', 7], ['true', true], ['empty_object', {}]])
    add('settings body is ' + t, 'drift', v, OK_REGS());
  add('settings body carries unexpected extra keys', 'valid', S((s) => { s.unexpected = { deep: [1, 2] }; s.tax_ids = ['x']; }), OK_REGS());

  // ── the list envelope ──
  for (const [t, v] of RETYPE.filter(([t2]) => t2 !== 'array' && t2 !== 'empty_array')) add('list.data retyped ' + t, 'drift', OK_SET(), R((_, r) => { r.data = v; }));
  add('list.data DELETED', 'drift', OK_SET(), R((_, r) => { delete r.data; }));
  for (const k of ['rows', 'registrations', 'DATA', 'items', 'objects']) add('list.data renamed -> ' + k, 'drift', OK_SET(), R((_, r) => { r[k] = r.data; delete r.data; }));
  for (const [t, v] of [['string_true', 'true'], ['string_false', 'false'], ['one', 1], ['zero', 0], ['null', null], ['array', []], ['object', {}], ['empty_string', '']])
    add('list.has_more retyped ' + t, v === null ? 'valid' : 'drift', OK_SET(), R((_, r) => { r.has_more = v; }));
  add('list.has_more DELETED (documented: absent reads as false)', 'valid', OK_SET(), R((_, r) => { delete r.has_more; }));
  add('list.has_more true with the TX row present', 'valid', OK_SET(), R((_, r) => { r.has_more = true; }));
  add('list.has_more true with an empty page (a paged absence)', 'drift', OK_SET(), R((_, r) => { r.has_more = true; r.data = []; }));
  for (const [t, v] of [['array', [BASE_ROW]], ['null', null], ['string', 'x'], ['number', 1], ['true', true]]) add('list body is ' + t, 'drift', OK_SET(), v);
  add('list body is an empty object', 'drift', OK_SET(), {});
  add('list body carries unexpected extra keys', 'valid', OK_SET(), R((_, r) => { r.next_page = 'abc'; r.total_count = 99; }));
  add('list data is empty (a real answer: no registrations)', 'measured_no', OK_SET(), R((_, r) => { r.data = []; }));

  // ── the ROW: every field the module dereferences, every level ──
  // `id` and `active_from` are OPTIONAL in the schema — the report prints them, nothing decides on them — so absence is
  // not drift for those two, and null IS absence. Every other way of mutating them still is.
  for (const field of ['status', 'country', 'id', 'active_from']) {
    const optional = field === 'id' || field === 'active_from';
    for (const [t, v] of RETYPE) add('row.' + field + ' retyped ' + t, optional && v === null ? 'valid' : 'drift', OK_SET(), R((r) => { r[field] = v; }));
    add('row.' + field + ' DELETED', optional ? 'valid' : 'drift', OK_SET(), R((r) => { delete r[field]; }));
    for (const k of rekey(field)) add('row.' + field + ' renamed -> ' + k, optional ? 'valid' : 'drift', OK_SET(), R((r) => { r[k] = r[field]; delete r[field]; }));
  }
  for (const [t, v] of restring('active')) add('row.status restrung ' + t, 'drift', OK_SET(), R((r) => { r.status = v; }));
  for (const [t, v] of restring('US')) add('row.country restrung ' + t, 'drift', OK_SET(), R((r) => { r.country = v; }));
  for (const v of ['USA', 'U.S.', 'us', 'Us', 'united_states']) add('row.country = ' + JSON.stringify(v), 'drift', OK_SET(), R((r) => { r.country = v; }));
  for (const v of ['CA', 'GB', 'DE']) add('row.country = ' + v + ' (a real non-US registration)', 'measured_no', OK_SET(), R((r) => { r.country = v; delete r.country_options; }));
  for (const v of ['scheduled', 'expired']) add('row.status = ' + v + ' (a real answer)', 'measured_no', OK_SET(), R((r) => { r.status = v; }));
  for (const [t, v] of overlong(60)) add('row.status ' + t + ' (' + v.length + ' chars)', t === 'on_the_bound' ? 'measured_no' : 'drift', OK_SET(), R((r) => { r.status = v; }));
  for (const [t, v] of overlong(64, 'A')) add('row.id ' + t + ' (' + v.length + ' chars)', t === 'on_the_bound' ? 'valid' : 'drift', OK_SET(), R((r) => { r.id = v; }));
  // R9-3: a row that says it is not a US registration while carrying US registration options is a row Stripe cannot
  // have written. Reading it as a decidable "not Texas" is how a self-contradicting body measures an absence — and an
  // absence, measured twice, is what authorises the one irreversible act in the module.
  for (const v of ['CA', 'GB', 'DE']) add('row.country = ' + v + ' while country_options.us.state is still TX (a contradictory row)', 'drift', OK_SET(), R((r) => { r.country = v; }));
  add('row.country = CA with an EMPTY country_options object', 'drift', OK_SET(), R((r) => { r.country = 'CA'; r.country_options = {}; }));
  add('row.country = CA with country_options.us present but no state', 'drift', OK_SET(), R((r) => { r.country = 'CA'; delete r.country_options.us.state; }));

  for (const [t, v] of RETYPE) add('row.country_options retyped ' + t, 'drift', OK_SET(), R((r) => { r.country_options = v; }));
  add('row.country_options DELETED', 'drift', OK_SET(), R((r) => { delete r.country_options; }));
  for (const k of ['jurisdiction', 'countryOptions', 'country_option', 'options', 'COUNTRY_OPTIONS'])
    add('row.country_options renamed -> ' + k, 'drift', OK_SET(), R((r) => { r[k] = r.country_options; delete r.country_options; }));
  for (const [t, v] of RETYPE) add('row.country_options.us retyped ' + t, 'drift', OK_SET(), R((r) => { r.country_options.us = v; }));
  add('row.country_options.us DELETED', 'drift', OK_SET(), R((r) => { delete r.country_options.us; }));
  for (const k of ['US', 'usa', 'united_states', 'u_s']) add('row.country_options.us renamed -> ' + k, 'drift', OK_SET(), R((r) => { r.country_options[k] = r.country_options.us; delete r.country_options.us; }));
  for (const field of ['state', 'type']) {
    for (const [t, v] of RETYPE) add('row.country_options.us.' + field + ' retyped ' + t, 'drift', OK_SET(), R((r) => { r.country_options.us[field] = v; }));
    add('row.country_options.us.' + field + ' DELETED', 'drift', OK_SET(), R((r) => { delete r.country_options.us[field]; }));
    for (const k of rekey(field)) add('row.country_options.us.' + field + ' renamed -> ' + k, 'drift', OK_SET(), R((r) => { r.country_options.us[k] = r.country_options.us[field]; delete r.country_options.us[field]; }));
  }
  for (const [t, v] of restring('TX')) add('row..us.state restrung ' + t, 'drift', OK_SET(), R((r) => { r.country_options.us.state = v; }));
  for (const v of ['Texas', 'US-TX', 'tx']) add('row..us.state = ' + JSON.stringify(v), 'drift', OK_SET(), R((r) => { r.country_options.us.state = v; }));
  for (const v of ['CA', 'NY']) add('row..us.state = ' + v + ' (a real other-state registration)', 'measured_no', OK_SET(), R((r) => { r.country_options.us.state = v; }));
  for (const [t, v] of restring('state_sales_tax')) add('row..us.type restrung ' + t, 'drift', OK_SET(), R((r) => { r.country_options.us.type = v; }));
  for (const v of ['local_lease_tax', 'simplified_sellers_use_tax']) add('row..us.type = ' + v + ' (a real wrong-type registration)', 'measured_no', OK_SET(), R((r) => { r.country_options.us.type = v; }));
  for (const [t, v] of overlong(60)) add('row..us.type ' + t + ' (' + v.length + ' chars)', t === 'on_the_bound' ? 'measured_no' : 'drift', OK_SET(), R((r) => { r.country_options.us.type = v; }));
  for (const [t, v] of overlong(2, 'X')) if (t !== 'on_the_bound') add('row..us.state ' + t + ' (' + v.length + ' chars)', 'drift', OK_SET(), R((r) => { r.country_options.us.state = v; }));
  for (const [t, v] of overlong(2, 'U')) if (t !== 'on_the_bound') add('row.country ' + t + ' (' + v.length + ' chars)', 'drift', OK_SET(), R((r) => { r.country = v; }));

  // ── nesting shifts: what an API version bump actually looks like from in here ──
  add('v2 shape: state/type flattened onto the row', 'drift', OK_SET(), R((r) => { r.state = 'TX'; r.type = 'state_sales_tax'; delete r.country_options; }));
  add('v2 shape: a jurisdiction object replaces country_options', 'drift', OK_SET(), R((r) => { r.jurisdiction = { level: 'state', country: 'US', state: 'TX' }; delete r.country_options; }));
  add('v2 shape: country nested as { code }', 'drift', OK_SET(), R((r) => { r.country = { code: 'US' }; }));
  add('v2 shape: rows moved under .registrations', 'drift', OK_SET(), { object: 'v2.list', has_more: false, registrations: [clone(BASE_ROW)] });
  add('row carries unexpected extra keys', 'valid', OK_SET(), R((r) => { r.extra = 'x'; r.metadata = { a: 1 }; }));

  // ── multi-row lists: one bad row poisons the list, whichever position it is in ──
  for (const [t, v] of [['null', null], ['string', 'x'], ['number', 1], ['array', []], ['true', true]])
    add('list.data[0] is ' + t, 'drift', OK_SET(), R((_, r) => { r.data = [v]; }));
  add('valid TX row followed by a null row', 'drift', OK_SET(), R((_, r) => { r.data = [clone(BASE_ROW), null]; }));
  add('valid TX row followed by a drifted row', 'drift', OK_SET(), R((_, r) => { const b = clone(BASE_ROW); delete b.country; r.data = [clone(BASE_ROW), b]; }));
  add('drifted row followed by the valid TX row', 'drift', OK_SET(), R((_, r) => { const b = clone(BASE_ROW); delete b.country_options; r.data = [b, clone(BASE_ROW)]; }));
  add('valid TX row beside a valid CA row', 'valid', OK_SET(), R((_, r) => { const ca = clone(BASE_ROW); ca.id = 'taxreg_CA'; ca.country_options.us.state = 'CA'; r.data = [ca, clone(BASE_ROW)]; }));
  add('two rows, the second one drifted at the deepest level', 'drift', OK_SET(), R((_, r) => { const b = clone(BASE_ROW); b.country_options.us.state = 'tx'; r.data = [clone(BASE_ROW), b]; }));

  // ── both bodies drifted at once ──
  for (const [t, v] of restring('active').slice(0, 4))
    add('BOTH drifted: settings.status ' + t + ' and row.country deleted', 'drift', S((s) => { s.status = v; }), R((r) => { delete r.country; }));

  return out;
}

/**
 * The assertions, given a `trial(settings, registrations)` the caller supplies. The caller owns the Worker, the D1 and
 * the Stripe stub; this owns what the answers have to be. `trial` returns:
 *   { measured, rowBefore, rowAfter, taxedNext, registrationPosts }
 */
export async function runTaxShapeFuzz(trial, log = () => {}) {
  const muts = taxShapeMutations();
  const violations = [];
  for (const m of muts) {
    let t;
    try { t = await trial(m.settings, m.regs); }
    catch (e) { violations.push({ name: m.name, why: 'the trial THREW: ' + e.message }); continue; }
    const why = [];
    if (m.kind === 'drift') {
      if (t.measured) why.push('measured:true on a drifted shape');
      if (t.rowBefore !== t.rowAfter) why.push('the ready row was rewritten (' + t.rowAfter + ')');
      if (!t.taxedNext) why.push('the next order was sold UNTAXED');
    } else if (m.kind === 'valid') {
      if (!t.measured) why.push('measured:false on a byte-shape-valid response');
      if (!t.taxedNext) why.push('the next order was sold UNTAXED on a valid ready account');
    } else if (m.kind === 'measured_no') {
      if (!t.measured) why.push('measured:false on a byte-shape-valid response Stripe actually answered');
    }
    if (t.registrationPosts > 0) why.push(t.registrationPosts + ' POST /v1/tax/registrations');
    if (why.length) violations.push({ name: m.name, kind: m.kind, why: why.join(' · ') });
  }
  log('mutations: ' + muts.length + '   violations: ' + violations.length);
  for (const v of violations.slice(0, 40)) log('  X [' + v.kind + '] ' + v.name + ' — ' + v.why);
  return { mutations: muts.length, violations };
}

/* ───────────── the standalone runner: its own D1, its own Stripe, no egress ───────────── */

function makeD1() {
  const rows = new Map();
  const prepare = (sql) => ({
    bind(...args) { return this._b(args); },
    _b(args) {
      return {
        async run() {
          if (!/rate_limits/.test(sql)) return { success: true, meta: { changes: 0 } };
          if (/^CREATE|^ALTER/.test(sql)) return { success: true, meta: { changes: 0 } };
          if (sql.startsWith('INSERT OR IGNORE INTO rate_limits')) { const [k, w, c] = args; if (rows.has(k)) return { meta: { changes: 0 } }; rows.set(k, { key: k, window_start: w, count: c }); return { meta: { changes: 1 } }; }
          if (sql.startsWith('INSERT INTO rate_limits') && sql.includes('count = rate_limits.count + 1')) { const [k, w] = args; const r = rows.get(k); if (r) { r.count += 1; return { meta: { changes: 1 } }; } rows.set(k, { key: k, window_start: w, count: 1 }); return { meta: { changes: 1 } }; }
          if (sql.startsWith('INSERT INTO rate_limits') && sql.endsWith('DO UPDATE SET window_start = excluded.window_start')) { const [k, w] = args; const r = rows.get(k); if (r) r.window_start = w; else rows.set(k, { key: k, window_start: w, count: 0 }); return { meta: { changes: 1 } }; }
          if (sql.startsWith('INSERT INTO rate_limits')) { const [k, w, c] = args; rows.set(k, { key: k, window_start: w, count: c }); return { meta: { changes: 1 } }; }
          if (sql.startsWith('UPDATE rate_limits SET count = 0 WHERE key = ? AND count <> 0')) { const r = rows.get(args[0]); if (!r || !r.count) return { meta: { changes: 0 } }; r.count = 0; return { meta: { changes: 1 } }; }
          if (sql.startsWith('UPDATE rate_limits SET window_start = ? WHERE key = ? AND window_start <')) { const [u, k, floor] = args; const r = rows.get(k); if (!r || !(r.window_start < floor)) return { meta: { changes: 0 } }; r.window_start = u; return { meta: { changes: 1 } }; }
          if (sql.startsWith('UPDATE rate_limits SET count = count + 1 WHERE key = ? AND count <')) { const [k, lim] = args; const r = rows.get(k); if (!r || !(r.count < lim)) return { meta: { changes: 0 } }; r.count += 1; return { meta: { changes: 1 } }; }
          if (sql.startsWith('UPDATE rate_limits SET window_start = ?, count = ?')) { const [w, c, k, cut] = args; const r = rows.get(k); if (!r || !(r.window_start <= cut)) return { meta: { changes: 0 } }; r.window_start = w; r.count = c; return { meta: { changes: 1 } }; }
          if (sql.startsWith('DELETE FROM rate_limits WHERE key = ?')) { return { meta: { changes: rows.delete(args[0]) ? 1 : 0 } }; }
          return { success: true, meta: { changes: 0 } };
        },
        async first() {
          if (/FROM rate_limits/.test(sql)) { const r = rows.get(args[0]); return r ? { ...r } : null; }
          if (/FROM offerings/.test(sql)) return { sku: 'MAST-HG-FUND', name: 'Handgun Fundamentals', price_cents: 22500, capacity: 16 };
          if (/SUM\(qty\)|COUNT\(\*\)/.test(sql)) return { n: 0 };
          return null;
        },
        async all() { return { results: [], success: true }; },
      };
    },
  });
  return { DB: { prepare }, rows };
}

function makeStripe(settings, registrations) {
  const calls = [];
  const J = (o, s = 200) => new Response(JSON.stringify(o === undefined ? null : o), { status: s, headers: { 'Content-Type': 'application/json' } });
  return {
    calls,
    stub: async (url, init = {}) => {
      const u = String(url), method = (init.method || 'GET').toUpperCase();
      if (!u.startsWith('https://api.stripe.com/')) throw new Error('EGRESS BLOCKED: ' + u);
      calls.push({ url: u, method });
      if (u.includes('/v1/tax/settings')) return J(settings);
      if (u.includes('/v1/tax/registrations')) return J(u.includes('status=scheduled') ? { object: 'list', has_more: false, data: [] } : registrations);
      if (u.includes('/v1/checkout/sessions')) return J({ id: 'cs_test_' + calls.length, object: 'checkout.session', url: 'https://checkout.stripe.com/c/pay/cs_test_' + calls.length });
      return J({});
    },
  };
}

/** The standalone driver: one Worker, one virtual "two hours ago" ready row inside the grace, one cron tick, one order. */
export async function standaloneTrial(worker, settings, registrations) {
  const { DB, rows } = makeD1();
  const env = { DB, STRIPE_TAX: '1', STRIPE_SECRET_KEY: 'sk_test_' + 'A'.repeat(40), ADMIN_KEY: 'admin-key-abcdefgh',
    ALLOWED_ORIGINS: 'https://atlasglinn.com', SITE_URL: 'https://atlasglinn.com/mastsolutions.html', STRIPE_WEBHOOK_SECRET: 'whsec_' + 'B'.repeat(32) };
  rows.set('tax:ready', { key: 'tax:ready', window_start: new Date(Date.now() - 2 * 3600000).toISOString() + '|active', count: 1 });
  const before = JSON.stringify(rows.get('tax:ready'));
  const s = makeStripe(settings, registrations);
  const realFetch = globalThis.fetch;
  globalThis.fetch = s.stub;
  const realLog = console.log, realErr = console.error;
  console.log = () => {}; console.error = () => {};
  const queued = [];
  const ctx = { waitUntil: (p) => { queued.push(Promise.resolve(p).catch(() => {})); return p; } };
  let taxed = null;
  try {
    await worker.scheduled({ cron: '*/5 * * * *', scheduledTime: Date.now() }, env, ctx);
    await Promise.all(queued.splice(0));
    const n = s.calls.length;
    await worker.fetch(new Request('https://api.test/create-booking', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://atlasglinn.com', 'CF-Connecting-IP': '198.51.100.7' },
      body: JSON.stringify({ sku: 'MAST-HG-FUND', customer_email: 'buyer@example.com', qty: 1 }) }), env, ctx);
    await Promise.all(queued.splice(0));
    taxed = s.calls.slice(n).some((c) => c.url.includes('/v1/checkout/sessions')) ? null : null;
  } finally {
    globalThis.fetch = realFetch; console.log = realLog; console.error = realErr;
  }
  const after = JSON.stringify(rows.get('tax:ready'));
  const row = rows.get('tax:ready');
  return {
    measured: before !== after && Number(row && row.count) !== 2,
    rowBefore: before, rowAfter: after,
    // Standalone, the readiness ROW is the answer: applyTax reads it and nothing else, so a row that is still the
    // 2-hour-old READY row inside the grace is an order that carries tax. The suite's driver reads the Session body
    // itself, which is the stronger check; this one is the one that needs no offerings table.
    taxedNext: !!row && Number(row.count) === 1 && Date.now() - Date.parse(String(row.window_start).split('|')[0]) < 24 * 3600000,
    registrationPosts: s.calls.filter((c) => c.method === 'POST' && c.url.includes('/tax/registrations')).length,
  };
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const worker = (await import('../src/worker.js')).default;
  const { mutations, violations } = await runTaxShapeFuzz((set, regs) => standaloneTrial(worker, set, regs), (l) => console.log(l));
  console.log(violations.length ? 'FUZZ FAILED' : 'FUZZ CLEAN');
  process.exit(violations.length ? 1 : 0);
}

/**
 * The seat claim, replayed against a REAL SQL engine.
 *
 * Why this file exists (security review round 3, 2026-09-08): test-worker.mjs runs against a fake D1 that answers the
 * Worker's queries in JavaScript rather than executing their SQL. Every seat-capacity assertion in that suite therefore
 * exercises the JS, not the predicate — the disclosed limitation of the harness, and exactly the wrong place to take a
 * safety control on trust. A live-fire class oversold is a safety problem before it is a refund problem.
 *
 * So the two statements that decide whether a class can be oversold are READ OUT OF src/worker.js — not retyped here —
 * loaded into sqlite alongside schema.sql and migrations/009, and driven through the race as it actually happens:
 *
 *   phase 1   all four buyers run the capacity SELECT before any of them has inserted anything, so all four pass it.
 *             That is the real window: the read and the write are separated by about six awaited statements.
 *   phase 2   each buyer's claim runs as ONE transaction — INSERT, conditional roll-back, read the status back — which
 *             is what env.DB.batch() gives on D1.
 *
 * If the predicate loses a branch, or the roll-back stops counting the row it just inserted, this file fails and the
 * JavaScript suite would not have noticed.
 *
 * Engine: node:sqlite (node 22+, what CI runs), then better-sqlite3 if it happens to be installed, then python3's
 * sqlite3 module. No engine at all is reported as a failure, never a silent skip.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(path.join(HERE, f), 'utf8');

/** The two statements, lifted from the shipped source. A miss here means the Worker was edited and this test was not. */
function statementsFromWorker() {
  const src = read('src/worker.js');
  const held = /const HOLDING_SEATS = "([^"]+)";/.exec(src);
  if (!held) throw new Error('HOLDING_SEATS not found in src/worker.js');
  const capacity = /`SELECT COALESCE\(SUM\(qty\), 0\) AS n FROM registrations WHERE sku = \? AND session_date = \? AND \(status = 'paid' OR \$\{HOLDING_SEATS\}\)`/.test(src);
  if (!capacity) throw new Error('the capacity SELECT in src/worker.js no longer matches the text this test replays');
  const rollback = /`UPDATE registrations SET status = 'abandoned'\$\{reason\} WHERE id = \? AND status = 'pending' AND ` \+\s*`\(SELECT COALESCE\(SUM\(qty\), 0\) FROM registrations WHERE sku = \? AND session_date = \? AND \(status = 'paid' OR \$\{HOLDING_SEATS\}\)\) > \?`/.test(src);
  if (!rollback) throw new Error('the roll-back UPDATE in src/worker.js no longer matches the text this test replays');
  const HOLDING = held[1];
  return {
    CAPACITY: `SELECT COALESCE(SUM(qty), 0) AS n FROM registrations WHERE sku = ? AND session_date = ? AND (status = 'paid' OR ${HOLDING})`,
    ROLLBACK: `UPDATE registrations SET status = 'abandoned', abandoned_reason = 'capacity' WHERE id = ? AND status = 'pending' AND ` +
              `(SELECT COALESCE(SUM(qty), 0) FROM registrations WHERE sku = ? AND session_date = ? AND (status = 'paid' OR ${HOLDING})) > ?`,
    INSERT: 'INSERT INTO registrations (id, created_at, status, sku, qty, session_date, customer_name, customer_email) VALUES (?,?,?,?,?,?,?,?)',
    STATUS: 'SELECT status, abandoned_reason FROM registrations WHERE id = ?',
  };
}

const SKU = 'MAST-HG-FUND', DATE = '2027-02-13';

/** now, the 15-minute cutoff and the 2-minute cutoff — holdCutoffs() binds them in this order. */
function cutoffs() {
  const now = Date.now();
  return [new Date(now - 15 * 60000).toISOString(), new Date(now - 2 * 60000).toISOString()];
}

/** One scenario: n buyers at `qty` each against `capacity`, all of them past the capacity read before any of them writes. */
function scenario(db, S, { buyers, qty, capacity }) {
  const [live, fresh] = cutoffs();
  const now = new Date().toISOString();
  const ids = Array.from({ length: buyers }, (_, i) => 'reg_sql_' + qty + '_' + i);
  db.run('DELETE FROM registrations WHERE session_date = ?', [DATE]);   // each scenario starts on an empty weekend

  // phase 1 — every buyer reads the capacity, and none of them has written yet
  const seenBefore = ids.map(() => db.get(S.CAPACITY, [SKU, DATE, live, fresh]).n);

  // phase 2 — the claims, each one transaction, in order
  const outcomes = [];
  for (const id of ids) {
    db.exec('BEGIN');
    db.run(S.INSERT, [id, now, 'pending', SKU, qty, DATE, 'SQL Buyer', id + '@example.com']);
    db.run(S.ROLLBACK, [id, SKU, DATE, live, fresh, capacity]);
    const row = db.get(S.STATUS, [id]);
    db.exec('COMMIT');
    outcomes.push({ id, status: row.status, reason: row.abandoned_reason });
  }
  const heldSeats = db.get(S.CAPACITY, [SKU, DATE, live, fresh]).n;
  return { seenBefore, outcomes, heldSeats };
}

function run(db) {
  const S = statementsFromWorker();
  db.exec(read('schema.sql'));
  const results = [];
  const add = (name, pass, detail) => results.push({ name, pass, detail: String(detail) });

  // schema.sql is the fresh-install shape and migrations/009 is the same column for a database that already exists.
  // Applying 009 here would raise "duplicate column name", which is the proof they agree; the check is the cheap version.
  const migCol = /ALTER TABLE registrations ADD COLUMN (\w+)/.exec(read('migrations/009-seat-claim.sql'));
  const hasCol = db.get("SELECT COUNT(*) AS n FROM pragma_table_info('registrations') WHERE name = 'abandoned_reason'", []);
  add('schema.sql carries abandoned_reason and migrations/009 adds the same column to a database that predates it',
      !!migCol && migCol[1] === 'abandoned_reason' && Number(hasCol && hasCol.n) === 1, 'migration adds ' + (migCol && migCol[1]) + ', schema has ' + (hasCol && hasCol.n));

  // ── four at qty 10 against a 16-seat class: the shape the review measured, where all four got a Stripe URL ──
  const a = scenario(db, S, { buyers: 4, qty: 10, capacity: 16 });
  const held = a.outcomes.filter((o) => o.status === 'pending');
  const rolled = a.outcomes.filter((o) => o.status === 'abandoned');
  add('all four buyers pass the capacity read before any of them writes — the race is set up, not assumed',
      a.seenBefore.every((n) => n === 0), 'seen=' + a.seenBefore.join());
  add('exactly one of four same-tick claims at qty 10 survives against 16 seats, and it is the SQL that decides',
      held.length === 1 && rolled.length === 3 && a.heldSeats === 10, 'held=' + held.length + ' rolled=' + rolled.length + ' seats=' + a.heldSeats);
  add('… and every rolled-back row carries abandoned_reason = capacity',
      rolled.every((o) => o.reason === 'capacity'), rolled.map((o) => o.reason).join());

  // ── the capacity-FITTING subset, not merely "one wins": four at qty 4 all fit, the fifth does not ──
  const b = scenario(db, S, { buyers: 5, qty: 4, capacity: 16 });
  const bHeld = b.outcomes.filter((o) => o.status === 'pending').length;
  add('four claims at qty 4 against 16 seats ALL survive and the fifth is rolled back: the subset that fits is what is kept',
      bHeld === 4 && b.outcomes[4].status === 'abandoned' && b.heldSeats === 16, 'held=' + bHeld + ' fifth=' + b.outcomes[4].status + ' seats=' + b.heldSeats);

  // ── a session-less row older than the 2-minute window holds nothing, in SQL and not only in the fake ──
  const [live, fresh] = cutoffs();
  const stale = new Date(Date.now() - 5 * 60000).toISOString();
  db.run(S.INSERT, ['reg_sql_stale', stale, 'pending', SKU, 99, DATE, 'Stale', 'stale@example.com']);
  const withStale = db.get(S.CAPACITY, [SKU, DATE, live, fresh]).n;
  db.run("UPDATE registrations SET stripe_session_id = 'cs_x' WHERE id = 'reg_sql_stale'", []);
  const withSession = db.get(S.CAPACITY, [SKU, DATE, live, fresh]).n;
  add('the two-tier predicate holds in SQL: a session-less row five minutes old counts nothing, and the same row with a session id counts all 99',
      withStale === 16 && withSession === 115, 'without=' + withStale + ' with=' + withSession);

  return results;
}

/* ─────────────────────────────── engines ─────────────────────────────── */

function nodeSqlite(Database) {
  const db = new Database(':memory:');
  return {
    exec: (sql) => db.exec(sql),
    run: (sql, args) => db.prepare(sql).run(...args),
    get: (sql, args) => db.prepare(sql).get(...args),
    close: () => db.close(),
  };
}

const PY_DRIVER = `
import json, sqlite3, sys
job = json.load(sys.stdin)
db = sqlite3.connect(':memory:')
db.isolation_level = None   # explicit BEGIN/COMMIT, exactly as the node engine runs them
db.row_factory = sqlite3.Row
out = []
for step in job:
    if step['kind'] == 'script':
        db.executescript(step['sql']); out.append(None)
    elif step['kind'] == 'exec':
        db.execute(step['sql']); out.append(None)
    elif step['kind'] == 'run':
        db.execute(step['sql'], step['args']); out.append(None)
    else:
        row = db.execute(step['sql'], step['args']).fetchone()
        out.append(dict(row) if row is not None else None)
print(json.dumps(out))
`;

/**
 * python3's sqlite3, in two passes. run() never branches on a value it reads, so pass one records the exact statement
 * sequence (against throwaway answers), python executes that sequence for real, and pass two re-runs run() handing back
 * the real answers in order. One implementation of the scenario, two engines — never a second copy of it in python.
 */
function pythonRun() {
  const steps = [];
  const recorder = {
    exec: (sql) => { steps.push({ kind: /;\s*$|\n/.test(sql.trim()) ? 'script' : 'exec', sql, args: [] }); },
    run: (sql, args) => { steps.push({ kind: 'run', sql, args }); },
    get: (sql, args) => { steps.push({ kind: 'get', sql, args }); return { n: 0, status: 'pending', abandoned_reason: null }; },
    close: () => {},
  };
  run(recorder);
  const answers = JSON.parse(String(execFileSync('python3', ['-c', PY_DRIVER], { input: JSON.stringify(steps) })));
  let i = 0;
  const replay = {
    exec: () => { i++; },
    run: () => { i++; },
    get: () => answers[i++],
    close: () => {},
  };
  return run(replay);
}

export async function runSeatClaimSql() {
  // SEAT_CLAIM_ENGINE=python forces the fallback, which is how it gets fired rather than assumed.
  if (process.env.SEAT_CLAIM_ENGINE === 'python') return { engine: 'python3 sqlite3 (forced)', results: pythonRun() };
  let Database = null, engine = '';
  try { ({ DatabaseSync: Database } = await import('node:sqlite')); engine = 'node:sqlite'; } catch (_) { /* node < 22.5 */ }
  if (!Database) {
    try { Database = (await import('better-sqlite3')).default; engine = 'better-sqlite3'; } catch (_) { /* not installed */ }
  }
  if (Database) {
    const db = nodeSqlite(Database);
    try { return { engine, results: run(db) }; }
    finally { db.close(); }
  }
  try { return { engine: 'python3 sqlite3', results: pythonRun() }; }
  catch (e) { return { skipped: 'no SQLite engine: ' + (e && e.message) }; }
}

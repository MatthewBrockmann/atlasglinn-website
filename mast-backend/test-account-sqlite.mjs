/**
 * The pending-sign-up statements, replayed against a REAL SQL engine.
 *
 * Why this file exists (security review round 5, 2026-09-09): test-worker.mjs runs against a fake D1 that answers the
 * Worker's queries in JavaScript rather than executing their SQL. Round 5 moved account creation onto four statements
 * that suite therefore never executes — an INSERT OR REPLACE that has to replace, a claim UPDATE whose whole job is its
 * WHERE clause, and an INSERT ... SELECT ... WHERE NOT EXISTS that is the only thing standing between a verified code
 * and a second account on an address that acquired one mid-flight. A JavaScript stand-in cannot say whether any of them
 * is valid SQLite, let alone whether it does what the comment above it claims.
 *
 * The statements are READ OUT OF src/worker.js — not retyped here — loaded into sqlite alongside schema.sql, and driven
 * through the sequences that matter:
 *
 *   1  a second sign-up at the same address REPLACES the first, and one row survives            (the squat takeover)
 *   2  the claim UPDATE takes a try only while a code is live, unexpired and under the cap      (the guess counter)
 *   3  the guarded INSERT refuses to create a second account for an address that has one        (the atomic create)
 *   4  migrations/010 removes unverified accounts rows and NOT ONE verified one                 (the one-time move)
 *
 * RUN IT DIRECTLY AND IT SAYS SO: every assertion prints, and it exits 1 on any failure.
 * Engine: node:sqlite (node 22+, what CI runs), then better-sqlite3 if it is installed. No engine is a FAILURE, never a
 * silent skip — a test that cannot run is not a test that passed.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import * as SELF_HEAL from './src/ratelimit.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(path.join(HERE, f), 'utf8');

/** The statements, lifted from the shipped source. A miss here means the Worker was edited and this test was not. */
export function statementsFromWorker() {
  const src = read('src/worker.js');
  const grab = (name, re) => {
    const m = re.exec(src);
    if (!m) throw new Error(name + ' no longer matches the text this test replays — src/worker.js changed and this file did not');
    return m[1];
  };
  return {
    UPSERT: grab('PENDING_UPSERT', /const PENDING_UPSERT = '([^']+)';/),
    ISSUE: grab('PENDING_ISSUE', /const PENDING_ISSUE = '([^']+)';/),
    CLAIM: grab('the pending claim UPDATE', /prepare\('(UPDATE pending_signups SET verify_attempts = verify_attempts \+ 1 [^']+)'\)\s*\n?\s*\.bind\(row\.address_digest/),
    BURN: grab('burnPendingCode', /prepare\('(UPDATE pending_signups SET verify_code_hash = \?, verify_expires_at = \?, verify_attempts = \?, burn_cleared_at = \? WHERE address_digest = \? AND verify_code_hash IS NOT NULL)'\)/),
    READ: grab('pendingByDigest', /prepare\('(SELECT \* FROM pending_signups WHERE address_digest = \?)'\)/),
    CREATE: grab('the guarded account INSERT', /prepare\('(INSERT INTO accounts \(id, email[^']+WHERE NOT EXISTS \(SELECT 1 FROM accounts WHERE email = \?\))'\)/),
    DROP: grab('the pending DELETE', /prepare\('(DELETE FROM pending_signups WHERE address_digest = \?)'\)/),
  };
}

/** The one-time step at the bottom of migrations/010, read out of the migration rather than retyped. */
function migrationDelete() {
  const sql = read('migrations/010-pending-signups.sql');
  const m = /(DELETE FROM accounts\s+WHERE verified_at IS NULL);/.exec(sql);
  if (!m) throw new Error('migrations/010 no longer carries the one-time DELETE this test replays');
  return m[1];
}

const NOW = () => new Date().toISOString();
const LATER = (ms) => new Date(Date.now() + ms).toISOString();
const D1 = 'a'.repeat(64), D2 = 'b'.repeat(64);
/** PENDING_UPSERT's bind order, as src/worker.js binds it. */
const upsertArgs = (digest, hash, name, codeHash, expires, sentAt, ip) => [digest, hash, name, '', '', codeHash, expires, sentAt, ip, NOW()];
/** The guarded INSERT's 25 binds: 24 columns, then the address the WHERE NOT EXISTS guards on. */
const createArgs = (id, email) => {
  const now = NOW();
  return [id, email, 'pbkdf2-sha256$100000$AA==$AA=', 1, '', '', '', '', '', '', '', '', '', '[]', '', now, now, null, now, null, null, null, 0, null, email];
};

export function run(db) {
  const S = statementsFromWorker();
  db.exec(read('schema.sql'));
  const results = [];
  const add = (name, pass, detail) => results.push({ name, pass, detail: String(detail) });

  // schema.sql is the fresh-install shape; migrations/010 + 011 are the same table for a database that already exists.
  const cols = db.all("SELECT name FROM pragma_table_info('pending_signups')").map((r) => r.name);
  const migCols = [...read('migrations/010-pending-signups.sql').matchAll(/^\s{2}(\w+)\s+(TEXT|INTEGER)/gm)].map((m) => m[1])
    .concat([...read('migrations/011-pending-burn-stamp.sql').matchAll(/^ALTER TABLE pending_signups ADD COLUMN (\w+)/gm)].map((m) => m[1]));
  add('schema.sql and migrations/010 + 011 create the SAME pending_signups columns — a fresh install and an existing database agree',
      cols.length > 0 && migCols.length === cols.length && migCols.every((c) => cols.includes(c)), 'schema=' + cols.join() + ' migration=' + migCols.join());
  // The Worker self-heals the same twelve at runtime, so a deploy that lands ahead of either migration still takes
  // sign-ups — and ALTERing a table round 5 already created is the only way the twelfth column reaches such a database.
  const { RATE_SCHEMA } = SELF_HEAL;
  add('… and src/ratelimit.js self-heals every one of them, CREATE and ALTER together',
      cols.every((c) => RATE_SCHEMA.some((st) => st.includes('pending_signups') && st.includes(c))) &&
      RATE_SCHEMA.some((st) => /ALTER TABLE pending_signups ADD COLUMN burn_cleared_at/.test(st)),
      String(RATE_SCHEMA.filter((st) => st.includes('pending_signups')).length) + ' statements');

  // ── 1. a later sign-up replaces the earlier one, and there is only ever one row per address ──
  db.run(S.UPSERT, upsertArgs(D1, 'hash-of-the-strangers-password', 'Mallory', 'code-hash-1', LATER(900000), NOW(), '198.51.100.1'));
  db.run(S.UPSERT, upsertArgs(D1, 'hash-of-the-owners-password', 'Vic Owner', 'code-hash-2', LATER(900000), NOW(), '198.51.100.2'));
  const after = db.all('SELECT * FROM pending_signups WHERE address_digest = ?', [D1]);
  add('a second sign-up REPLACES the pending row rather than adding one — the credentials that become an account are the ones whose code was mailed last',
      after.length === 1 && after[0].password_hash === 'hash-of-the-owners-password' && after[0].name === 'Vic Owner',
      after.length + ' rows, hash=' + (after[0] && after[0].password_hash));

  /* R6-2, in SQL rather than in JavaScript: the UPSERT must NOT reset the twenty-try burn counter. `INSERT OR REPLACE`
     cannot preserve a column — it deletes the row and inserts a new one — so this is the assertion that says the
     statement is an ON CONFLICT upsert and not the old one. An unauthenticated /account/register resetting this to 0
     is the whole of the deferred-burn primitive. created_at and created_ip must not move either: created_at is what
     the daily purge measures. */
  db.run('UPDATE pending_signups SET verify_attempts = 19, created_at = ?, created_ip = ? WHERE address_digest = ?', ['2001-01-01T00:00:00.000Z', '198.51.100.2', D1]);
  db.run(S.UPSERT, upsertArgs(D1, 'hash-of-a-third-password', 'Third', 'code-hash-2b', LATER(900000), NOW(), '198.51.100.9'));
  const kept = db.get(S.READ, [D1]);
  add('… and the replace does NOT reset verify_attempts, created_at or created_ip — a sign-up is unauthenticated, and zeroing the counter is how the twenty-try burn was deferred for ever',
      kept.verify_attempts === 19 && kept.created_at === '2001-01-01T00:00:00.000Z' && kept.created_ip === '198.51.100.2' && kept.password_hash === 'hash-of-a-third-password',
      'attempts=' + kept.verify_attempts + ' created_at=' + kept.created_at + ' created_ip=' + kept.created_ip);
  db.run('UPDATE pending_signups SET verify_attempts = 0 WHERE address_digest = ?', [D1]);

  // ── 2. the claim UPDATE is the guess counter, and its WHERE clause is the whole control ──
  const claim = (digest, max) => db.changes(S.CLAIM, [digest, NOW(), max]);
  add('the claim takes a try while the code is live and under the cap', claim(D1, 20) === 1 && db.get(S.READ, [D1]).verify_attempts === 1, 'attempts=' + db.get(S.READ, [D1]).verify_attempts);
  add('… and takes nothing at an address with no row at all — which is what makes the absent twin cost the same and change nothing',
      claim('absent', 20) === 0, 'changes at a key no address carries');
  db.run('UPDATE pending_signups SET verify_attempts = 20 WHERE address_digest = ?', [D1]);
  add('… and takes nothing once the twenty tries are spent, however many requests arrive', claim(D1, 20) === 0 && claim(D1, 20) === 0, 'spent');
  db.run('UPDATE pending_signups SET verify_attempts = 0, verify_expires_at = ? WHERE address_digest = ?', [new Date(Date.now() - 1000).toISOString(), D1]);
  add('… and takes nothing on an expired code', claim(D1, 20) === 0, 'expired');
  db.run(S.ISSUE, ['code-hash-3', LATER(900000), NOW(), D1]);
  add('the reissue statement puts a live code back on the row and the claim takes again', db.get(S.READ, [D1]).verify_code_hash === 'code-hash-3' && claim(D1, 20) === 1, 'reissued');
  /* R6-1(a): the burn clears the code and stamps burn_cleared_at, and it LEAVES code_sent_at alone. Nulling
     code_sent_at was half of a deterministic takeover — it is the column /account/register's replace gate reads, so a
     stranger who burned the code could immediately write their own credentials onto the sign-up. */
  const beforeBurn = db.get(S.READ, [D1]).code_sent_at;
  const burnAt = NOW();
  add('the burn clears the code and stamps burn_cleared_at, and LEAVES code_sent_at exactly where it was — the replace gate cannot be moved by a stranger burning a code',
      db.changes(S.BURN, [null, null, 0, burnAt, D1]) === 1 && !db.get(S.READ, [D1]).verify_code_hash &&
      db.get(S.READ, [D1]).code_sent_at === beforeBurn && db.get(S.READ, [D1]).burn_cleared_at === burnAt,
      'code_sent_at=' + db.get(S.READ, [D1]).code_sent_at + ' burn_cleared_at=' + db.get(S.READ, [D1]).burn_cleared_at);
  add('… and burning twice reports nothing the second time — one racing guess is told it did the burning, not five',
      db.changes(S.BURN, [null, null, 0, NOW(), D1]) === 0, 'idempotent');

  // ── 3. the guarded create: one account per address, whatever arrives at once ──
  add('a verified code creates the account', db.changes(S.CREATE, createArgs('acct_1', 'owner@example.com')) === 1, 'first create');
  add('… and a SECOND create for the same address changes nothing: the account cannot be made twice, and a code held from before an account existed cannot make another one',
      db.changes(S.CREATE, createArgs('acct_2', 'owner@example.com')) === 0 && db.get('SELECT COUNT(*) AS n FROM accounts WHERE email = ?', ['owner@example.com']).n === 1,
      'accounts for that address = ' + db.get('SELECT COUNT(*) AS n FROM accounts WHERE email = ?', ['owner@example.com']).n);
  db.run(S.UPSERT, upsertArgs(D2, 'h', 'N', 'c', LATER(900000), NOW(), '198.51.100.3'));
  add('… and dropping the pending row is one statement that finds it by digest', db.changes(S.DROP, [D2]) === 1 && !db.get(S.READ, [D2]), 'dropped');

  // ── 4. migrations/010's one-time step touches no verified account ──
  db.run('UPDATE accounts SET verified_at = NULL WHERE email = ?', ['owner@example.com']);
  db.run(S.CREATE, createArgs('acct_v', 'verified@example.com'));
  const removed = db.changes(migrationDelete(), []);
  const left = db.all('SELECT email, verified_at FROM accounts');
  add('migrations/010 removes the unverified rows and NOT ONE verified one — the one-time equivalence, in SQL',
      removed === 1 && left.length === 1 && left[0].email === 'verified@example.com' && !!left[0].verified_at,
      'removed=' + removed + ' left=' + left.map((r) => r.email).join());

  return results;
}

/* ─────────────────────────────── engine ─────────────────────────────── */

function engineFor(Database) {
  const db = new Database(':memory:');
  return {
    exec: (sql) => db.exec(sql),
    run: (sql, args = []) => db.prepare(sql).run(...args),
    changes: (sql, args = []) => Number(db.prepare(sql).run(...args).changes),
    get: (sql, args = []) => db.prepare(sql).get(...args),
    all: (sql, args = []) => db.prepare(sql).all(...args),
    close: () => db.close(),
  };
}

export async function runAccountSql() {
  let Database = null, engine = '';
  try { ({ DatabaseSync: Database } = await import('node:sqlite')); engine = 'node:sqlite'; } catch (_) { /* node < 22.5 */ }
  if (!Database) {
    try { Database = (await import('better-sqlite3')).default; engine = 'better-sqlite3'; } catch (_) { /* not installed */ }
  }
  if (!Database) return { skipped: 'no SQLite engine (node:sqlite needs node 22.5+)' };
  const db = engineFor(Database);
  try { return { engine, results: run(db) }; }
  finally { db.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = await runAccountSql();
  let pass = 0, fail = 0;
  if (out.skipped) { fail++; console.log('  ✗ the account statements are proved against a real SQL engine  SKIPPED: ' + out.skipped); }
  else {
    console.log('  (engine: ' + out.engine + ')');
    for (const r of out.results) {
      if (r.pass) { pass++; console.log('  ✓ ' + r.name); }
      else { fail++; console.log('  ✗ ' + r.name + '  ' + r.detail); }
    }
  }
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}

/**
 * The pending-sign-up statements, replayed against a REAL SQL engine.
 *
 * Why this file exists (security review round 5, 2026-09-09): test-worker.mjs runs against a fake D1 that answers the
 * Worker's queries in JavaScript rather than executing their SQL. Account creation rests on statements that suite
 * therefore never executes — a claim UPDATE whose whole job is its WHERE clause, a lookup that must return at most one
 * row out of several, a DELETE whose predicate lives in its binds, and an INSERT ... SELECT ... WHERE NOT EXISTS that
 * is the only thing standing between a verified code and a second account on an address that acquired one mid-flight.
 * A JavaScript stand-in cannot say whether any of them is valid SQLite, let alone whether it does what the comment
 * above it claims.
 *
 * ROUND 7 moved the table to ONE ROW PER SIGN-UP, which is more SQL, not less: the address is no longer a key, so
 * "which row is this code's" and "which rows does a burn take" are now questions the database answers rather than the
 * JavaScript. Every one of them is driven below.
 *
 * The statements are READ OUT OF src/worker.js — not retyped here — loaded into sqlite alongside schema.sql, and driven
 * through the sequences that matter:
 *
 *   1  two sign-ups at one address are TWO rows, and neither can reach the other                (the takeover class)
 *   2  the lookup finds the row belonging to the code, among several, and only while it is live (the verification)
 *   3  the claim counts every live row at the address in one statement, and a NEW row cannot lower the count
 *   4  the burn's predicate lives in its binds: nothing below the cap, everything at it         (the statement-count tell)
 *   5  the guarded INSERT refuses a second account, and the two DELETEs clear the address       (the atomic create)
 *   6  migrations/012 recreates the table and removes unverified accounts rows, not one verified one
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
    INSERT: grab('PENDING_INSERT', /const PENDING_INSERT = '([^']+)';/),
    ISSUE: grab('PENDING_ISSUE', /const PENDING_ISSUE = '([^']+)';/),
    NEWEST: grab('PENDING_NEWEST', /const PENDING_NEWEST = '([^']+)';/),
    BY_CODE: grab('PENDING_BY_CODE', /const PENDING_BY_CODE = '([^']+)';/),
    CLAIM: grab('PENDING_CLAIM', /const PENDING_CLAIM = '([^']+)';/),
    SPENT: grab('PENDING_SPENT', /const PENDING_SPENT = '([^']+)';/),
    BURN: grab('PENDING_BURN', /const PENDING_BURN = '([^']+)';/),
    DROP: grab('PENDING_DROP', /const PENDING_DROP = '([^']+)';/),
    DROP_OTHERS: grab('PENDING_DROP_OTHERS', /const PENDING_DROP_OTHERS = '([^']+)';/),
    CREATE: grab('the guarded account INSERT', /prepare\('(INSERT INTO accounts \(id, email[^']+WHERE NOT EXISTS \(SELECT 1 FROM accounts WHERE email = \?\))'\)/),
  };
}

/** The one-time step at the bottom of migrations/012, read out of the migration rather than retyped. */
function migrationDelete() {
  const sql = read('migrations/012-pending-signup-per-row.sql');
  const m = /(DELETE FROM accounts\s+WHERE verified_at IS NULL);/.exec(sql);
  if (!m) throw new Error('migrations/012 no longer carries the one-time DELETE this test replays');
  return m[1];
}

const NOW = () => new Date().toISOString();
const LATER = (ms) => new Date(Date.now() + ms).toISOString();
const D1 = 'a'.repeat(64), D2 = 'b'.repeat(64);
const MAX = 20;   // CODE_MAX_TRIES
/** PENDING_INSERT's bind order, as src/worker.js binds it: signup_id first, verify_attempts a literal 0. */
const insertArgs = (id, digest, hash, name, codeHash, expires, ip, createdAt) => [id, digest, hash, name, '', '', codeHash, expires, createdAt || NOW(), ip];
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

  // schema.sql is the fresh-install shape; migrations/012 is the same table for a database that already exists.
  const cols = db.all("SELECT name FROM pragma_table_info('pending_signups')").map((r) => r.name);
  const migCols = [...read('migrations/012-pending-signup-per-row.sql').matchAll(/^\s{2}(\w+)\s+(TEXT|INTEGER)/gm)].map((m) => m[1]);
  add('schema.sql and migrations/012 create the SAME pending_signups columns — a fresh install and an existing database agree',
      cols.length > 0 && migCols.length === cols.length && migCols.every((c) => cols.includes(c)), 'schema=' + cols.join() + ' migration=' + migCols.join());
  add('… and signup_id is the PRIMARY KEY while address_digest is an ordinary column — the address is not a slot anybody can be in',
      db.get("SELECT COUNT(*) AS n FROM pragma_table_info('pending_signups') WHERE name = 'signup_id' AND pk = 1").n === 1 &&
      db.get("SELECT COUNT(*) AS n FROM pragma_table_info('pending_signups') WHERE name = 'address_digest' AND pk = 1").n === 0,
      'signup_id pk=' + db.get("SELECT pk FROM pragma_table_info('pending_signups') WHERE name = 'signup_id'").pk);
  // The Worker self-heals the same table at runtime, so a deploy that lands ahead of the migration still takes sign-ups.
  const { RATE_SCHEMA } = SELF_HEAL;
  add('… and src/ratelimit.js self-heals every one of them, with the (address_digest, code_hash) index /account/verify reads',
      cols.every((c) => RATE_SCHEMA.some((st) => st.includes('pending_signups') && st.includes(c))) &&
      RATE_SCHEMA.some((st) => /CREATE INDEX IF NOT EXISTS idx_pending_signups_code ON pending_signups \(address_digest, code_hash\)/.test(st)),
      String(RATE_SCHEMA.filter((st) => st.includes('pending_signups')).length) + ' statements');

  /* ── 1. two sign-ups at one address are TWO rows, and neither write can reach the other ──
     This is the round-7 change stated in SQL. Rounds 5 and 6 replaced the row here — an upsert on address_digest — and
     the entire takeover class lived in who won that replace. A row per sign-up has no winner. */
  db.run(S.INSERT, insertArgs('11'.repeat(16), D1, 'hash-of-the-strangers-password', 'Mallory', 'code-hash-stranger', LATER(900000), '198.51.100.1', '2026-09-09T10:00:00.000Z'));
  db.run(S.INSERT, insertArgs('22'.repeat(16), D1, 'hash-of-the-owners-password', 'Vic Owner', 'code-hash-owner', LATER(900000), '198.51.100.2', '2026-09-09T10:00:01.000Z'));
  const after = db.all('SELECT * FROM pending_signups WHERE address_digest = ?', [D1]);
  add('a second sign-up at the same address ADDS a row rather than replacing one — the credentials of both sign-ups survive, each with its own code',
      after.length === 2 && after.some((r) => r.password_hash === 'hash-of-the-owners-password') && after.some((r) => r.password_hash === 'hash-of-the-strangers-password'),
      after.length + ' rows: ' + after.map((r) => r.name).join('/'));
  add('… and the non-mailing branch writes to ONE constant key, so a refused sign-up rewrites a row of nothing instead of growing the table',
      (() => { db.run(S.INSERT, insertArgs('absent', 'absent', 'dummy', '', null, null, '', NOW())); db.run(S.INSERT, insertArgs('absent', 'absent', 'dummy', '', null, null, '', NOW()));
               return db.get("SELECT COUNT(*) AS n FROM pending_signups WHERE signup_id = 'absent'").n === 1 && db.all('SELECT * FROM pending_signups WHERE address_digest = ?', [D1]).length === 2; })(),
      'absent rows=' + db.get("SELECT COUNT(*) AS n FROM pending_signups WHERE signup_id = 'absent'").n);
  add('… and the newest sign-up at an address is what /account/resend can re-mail: one row, ordered, never ambiguous',
      db.get(S.NEWEST, [D1]).signup_id === '22'.repeat(16), 'newest=' + db.get(S.NEWEST, [D1]).name);

  /* ── 2. the lookup: the code selects the row, and the row carries the password that must match ── */
  const found = db.get(S.BY_CODE, [D1, 'code-hash-owner', NOW()]);
  add('the verification lookup finds the row belonging to the CODE, among several at the address, and it carries that sign-up\'s own password',
      !!found && found.password_hash === 'hash-of-the-owners-password' && found.signup_id === '22'.repeat(16),
      'found=' + (found && found.name));
  add('… and the stranger\'s code finds the stranger\'s row and nobody else\'s — the two sign-ups never cross',
      db.get(S.BY_CODE, [D1, 'code-hash-stranger', NOW()]).password_hash === 'hash-of-the-strangers-password', 'crossed=no');
  add('… and a code nobody was issued finds nothing, on the same one statement', !db.get(S.BY_CODE, [D1, 'code-hash-invented', NOW()]), 'no row');
  db.run('UPDATE pending_signups SET verify_expires_at = ? WHERE signup_id = ?', [new Date(Date.now() - 1000).toISOString(), '11'.repeat(16)]);
  add('… and an EXPIRED sign-up is not found by its own code: the lookup carries the liveness test rather than a branch after it',
      !db.get(S.BY_CODE, [D1, 'code-hash-stranger', NOW()]), 'expired row not returned');
  db.run('UPDATE pending_signups SET verify_expires_at = ? WHERE signup_id = ?', [LATER(900000), '11'.repeat(16)]);

  /* ── 3. the claim, and the count the burn reads ── */
  const claim = (digest) => db.changes(S.CLAIM, [digest, NOW(), MAX]);
  const spent = (digest) => Number(db.get(S.SPENT, [digest, NOW()]).used || 0);
  add('one claim statement counts a try against EVERY live sign-up at the address — two rows, one statement, two counts',
      claim(D1) === 2 && spent(D1) === 1, 'changes=2 used=' + spent(D1));
  add('… and it takes nothing at an address with no sign-ups, which is why the absent case needs no twin statement',
      claim('f'.repeat(64)) === 0, 'changes at an address with nothing');
  db.run(S.INSERT, insertArgs('33'.repeat(16), D1, 'hash-of-a-later-signup', 'Latecomer', 'code-hash-later', LATER(900000), '198.51.100.3', '2026-09-09T10:00:02.000Z'));
  add('A NEW SIGN-UP CANNOT LOWER THE BURN COUNT — it starts at 0 and MAX ignores it, so a stranger cannot defer the twenty-try burn by opening one (the round-4 primitive, in SQL)',
      spent(D1) === 1 && claim(D1) === 3 && spent(D1) === 2, 'used=' + spent(D1));
  db.run('UPDATE pending_signups SET verify_attempts = ? WHERE signup_id = ?', [MAX, '22'.repeat(16)]);
  add('… and a row at the cap stops being claimed while the address\'s count stands at the cap, so the burn still fires',
      claim(D1) === 2 && spent(D1) === MAX, 'used=' + spent(D1));

  /* ── 4. the burn: its predicate is in the BINDS, which is what makes every refused verification cost the same ── */
  add('the burn statement removes NOTHING when the tries are not spent — the same statement, the same one execution, on every wrong code at every address',
      db.changes(S.BURN, [D1, 5, MAX]) === 0 && db.all('SELECT * FROM pending_signups WHERE address_digest = ?', [D1]).length === 3,
      'rows still ' + db.all('SELECT * FROM pending_signups WHERE address_digest = ?', [D1]).length);
  add('… and at the cap it takes EVERY sign-up waiting at the address, in one statement, whoever made them',
      db.changes(S.BURN, [D1, MAX, MAX]) === 3 && db.all('SELECT * FROM pending_signups WHERE address_digest = ?', [D1]).length === 0, 'burned');
  add('… and burning twice reports nothing the second time — one racing guess is told it did the burning, not five',
      db.changes(S.BURN, [D1, MAX, MAX]) === 0, 'idempotent');
  db.run(S.INSERT, insertArgs('44'.repeat(16), D2, 'h', 'N', 'code-hash-2', LATER(900000), '198.51.100.4', NOW()));
  db.run(S.ISSUE, ['code-hash-2b', LATER(900000), '44'.repeat(16)]);
  add('the reissue statement moves the code of ONE sign-up, named by its signup_id — there is no statement in this Worker that can move somebody else\'s',
      db.get(S.BY_CODE, [D2, 'code-hash-2b', NOW()]).signup_id === '44'.repeat(16) && !db.get(S.BY_CODE, [D2, 'code-hash-2', NOW()]), 'reissued');

  /* ── 5. the guarded create, and the two DELETEs that settle the address ── */
  db.run(S.INSERT, insertArgs('55'.repeat(16), D2, 'h2', 'Other', 'code-hash-other', LATER(900000), '198.51.100.5', NOW()));
  add('a verified code creates the account', db.changes(S.CREATE, createArgs('acct_1', 'owner@example.com')) === 1, 'first create');
  add('… and a SECOND create for the same address changes nothing: the account cannot be made twice, and a code held from before an account existed cannot make another one',
      db.changes(S.CREATE, createArgs('acct_2', 'owner@example.com')) === 0 && db.get('SELECT COUNT(*) AS n FROM accounts WHERE email = ?', ['owner@example.com']).n === 1,
      'accounts for that address = ' + db.get('SELECT COUNT(*) AS n FROM accounts WHERE email = ?', ['owner@example.com']).n);
  add('… and the batch drops the verified sign-up by its own id and every OTHER sign-up at the address with it — no row is left that nothing can complete',
      db.changes(S.DROP, ['44'.repeat(16)]) === 1 && db.changes(S.DROP_OTHERS, [D2, '44'.repeat(16)]) === 1 && db.all('SELECT * FROM pending_signups WHERE address_digest = ?', [D2]).length === 0,
      'address settled');

  /* ── 6. migrations/012: the shape change a CREATE cannot do, and the one-time step ── */
  {
    const mig = read('migrations/012-pending-signup-per-row.sql');
    add('migrations/012 DROPs the table before creating it, because SQLite cannot ALTER a primary key from address_digest onto signup_id — the reason the file recreates rather than alters, in the file',
        /DROP TABLE IF EXISTS pending_signups;/.test(mig) && /CREATE TABLE IF NOT EXISTS pending_signups \(\s*\n\s*signup_id\s+TEXT PRIMARY KEY/.test(mig),
        'drop+create present');
  }
  db.run('UPDATE accounts SET verified_at = NULL WHERE email = ?', ['owner@example.com']);
  db.run(S.CREATE, createArgs('acct_v', 'verified@example.com'));
  const removed = db.changes(migrationDelete(), []);
  const left = db.all('SELECT email, verified_at FROM accounts');
  add('migrations/012 removes the unverified rows and NOT ONE verified one — the one-time equivalence, in SQL',
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

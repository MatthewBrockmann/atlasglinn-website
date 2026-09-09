-- 012 · pending_signups becomes ONE ROW PER SIGN-UP (security review round 7, 2026-09-09)
--
-- WHY THE TABLE IS RECREATED RATHER THAN ALTERED: rounds 5 and 6 made address_digest the PRIMARY KEY — one row per
-- address — and SQLite cannot ALTER a primary key onto or off an existing table. The new key is a random signup_id and
-- address_digest becomes an ordinary indexed column that is NOT unique.
--
-- WHAT IS DROPPED, STATED PLAINLY: every pending sign-up in the old table. They are unverified sign-ups minutes old by
-- design (a code lives fifteen minutes and the daily cron drops the rows after a day), so the cost of losing them is
-- that whoever was mid-sign-up signs up again and gets a new code. Nothing verified is touched: accounts are a
-- different table, and the only accounts row this file removes is the one described at the bottom.
--
-- WHAT IT CLOSES: one row per address is a SLOT, and six rounds of review each closed one way of contesting the slot
-- and opened the next. Round 5 let the last writer take it (a stranger took a sign-up in flight). Round 6 let the first
-- writer hold it for the code's fifteen minutes — and /account/resend re-stamped the very column that gate read, so the
-- hold renewed every sixty seconds and a stranger held an address for six hours against 51 owner attempts, with every
-- code in the owner's mailbox bound to the stranger's password. There is no slot to contest now: a sign-up inserts its
-- own row, /account/verify wants {email, code, password} and creates the account only when the code selects a row whose
-- password also matches. A stranger's row cannot be completed by the owner and the owner's cannot be completed by a
-- stranger.
--
-- THE DEPLOY GUARD FOR THIS FILE keys on signup_id + code_hash — the two columns unique to this shape. An old-shape
-- table has neither (it carries verify_code_hash), so the guard reads "apply"; a new-shape table has both, so it reads
-- "already applied". Listing the columns the two shapes SHARE would read HALF APPLIED against an old table and stop
-- every deploy. deploy-worker.yml's rows for 010 and 011 are removed for the same reason: once this file has run, their
-- columns are half-present by construction.
DROP TABLE IF EXISTS pending_signups;

CREATE TABLE IF NOT EXISTS pending_signups (
  signup_id         TEXT PRIMARY KEY,
  address_digest    TEXT NOT NULL,
  password_hash     TEXT NOT NULL,
  name              TEXT,
  phone             TEXT,
  organization      TEXT,
  code_hash         TEXT,
  verify_expires_at TEXT,
  verify_attempts   INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  created_ip        TEXT
);
CREATE INDEX IF NOT EXISTS idx_pending_signups_code ON pending_signups (address_digest, code_hash);
CREATE INDEX IF NOT EXISTS idx_pending_signups_created ON pending_signups (created_at);

-- The one-time step migrations/010 carried, moved here because 010 no longer has a guard row of its own and therefore
-- no longer runs on a fresh database. Before round 5, /account/register created an UNVERIFIED accounts row, which is
-- what let a stranger's password sit inside an account the owner later verified. No route creates one now, so this
-- removes the legacy rows and nothing else; runRetention deletes the same set daily on the 09:17 UTC cron, which is
-- what bounds the case where this file's guard reads "already applied" because a Worker created the table first.
DELETE FROM accounts
WHERE verified_at IS NULL;

-- 010 — A sign-up is not an account until a code comes back (security review round 5, 2026-09-09).
-- Run once on the live database, after 009:
--   npx wrangler d1 execute mast_bookings --remote --file=migrations/010-pending-signups.sql
-- The CREATE and the INDEX are idempotent; the DELETE at the bottom is a one-time equivalence, described below, and
-- running it twice removes nothing the first run left behind. deploy-worker.yml applies this file when pending_signups
-- has none of its columns and stops if it has some of them (a half-applied schema needs a person, not a retry).
--
-- WHAT THIS CLOSES. Until now POST /account/register INSERTed an accounts row for a brand-new address, with whatever
-- password the caller typed, and the row sat unverified until someone entered the code emailed to that address. Two
-- findings came out of that one row, and three rounds of patching the symptoms never reached either:
--
--   the squat takeover     a stranger signed up victim@; their password went onto the row; round 3's rule that a
--                          sign-up never overwrites an existing row then PROTECTED it. The owner entered the code from
--                          their OWN mailbox, verification set verified_at and never touched password_hash, and the
--                          account came up holding the stranger's password. Measured, four steps, no race.
--   register -> login      an address that had started a sign-up HAD a row, so /account/login answered 403 'unverified'
--                          for it and 401 for an address with nothing. One unauthenticated request classified any
--                          address on the internet.
--
-- A pending sign-up now lives here instead, and handleAccountVerify is what INSERTs the accounts row — atomically, and
-- only when no row for the address exists yet. A later sign-up REPLACES the pending row when it mails a code, so the
-- credentials that become an account are always the ones belonging to the code the mailbox actually received.
--
-- NO PLAINTEXT ADDRESS. The primary key is the SHA-256 digest of the normalised address, so a table of half-finished
-- sign-ups is not a list of who has typed what. Every route that needs the row has the address in hand and computes the
-- same digest; nothing needs to read one back out.
CREATE TABLE IF NOT EXISTS pending_signups (
  address_digest    TEXT PRIMARY KEY,              -- SHA-256 of the normalised address, hex. Never the address itself.
  password_hash     TEXT NOT NULL,                 -- pbkdf2-sha256$<iterations>$<salt b64>$<hash b64>, as on accounts
  name              TEXT,
  phone             TEXT,
  organization      TEXT,
  verify_code_hash  TEXT,                          -- HMAC(ACCOUNT_SECRET, digest:verify:code) — the code itself is never stored
  verify_expires_at TEXT,                          -- 15 minutes
  verify_attempts   INTEGER NOT NULL DEFAULT 0,    -- twenty wrong tries burn the code, exactly as on an account
  code_sent_at      TEXT,                          -- the one-a-minute reissue throttle
  created_ip        TEXT,                          -- CF-Connecting-IP of the sign-up that wrote this row
  created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pending_signups_created ON pending_signups (created_at);

-- THE ONE-TIME EQUIVALENCE, and why it is a DELETE rather than a move.
-- Rows that already exist and were never verified cannot be moved into the table above, because SQLite cannot compute a
-- SHA-256 digest and the digest is this table's primary key. They are removed instead, and that is an equivalence rather
-- than a loss: an unverified accounts row is a sign-up nobody has proved, the daily retention cron has been DELETing
-- exactly this set every day since migrations/005 ("DELETE FROM accounts WHERE verified_at IS NULL AND created_at <
-- <a day ago>"), and the person simply signs up again — which now costs them one email and gives them an account whose
-- password is theirs. Leaving them in place would carry both findings above forward for those addresses.
--
-- VERIFIED ACCOUNTS ARE NOT TOUCHED. The predicate is verified_at IS NULL and nothing else; there is no branch in this
-- file that can reach a row with a verified_at.
DELETE FROM accounts
WHERE verified_at IS NULL;

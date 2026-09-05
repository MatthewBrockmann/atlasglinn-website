-- 005 — Email verification and password reset for student accounts (Codex review of PR #10, 2026-09-05: P1 "verify email
-- ownership before issuing account tokens", P2 "provide a recovery path for forgotten passwords").
-- Run once on the live database, after 004:
--   wrangler d1 execute mast_bookings --remote --file=migrations/005-account-verification.sql
-- NOT idempotent (SQLite has no ADD COLUMN IF NOT EXISTS): a second run fails with "duplicate column name: verified_at",
-- which means it is already applied and nothing changed.
ALTER TABLE accounts ADD COLUMN verified_at       TEXT;                       -- set when the emailed code comes back; NULL = never verified, no token is ever issued
ALTER TABLE accounts ADD COLUMN verify_kind       TEXT;                       -- 'verify' | 'reset' — one live code per account
ALTER TABLE accounts ADD COLUMN verify_code_hash  TEXT;                       -- HMAC(ACCOUNT_SECRET, id:kind:code); the code itself is never stored
ALTER TABLE accounts ADD COLUMN verify_expires_at TEXT;                       -- 15 minutes after issue
ALTER TABLE accounts ADD COLUMN verify_attempts   INTEGER NOT NULL DEFAULT 0; -- the fifth wrong try burns the code
ALTER TABLE accounts ADD COLUMN verify_sent_at    TEXT;                       -- re-sends at most once a minute

-- 008 — Rate limiting and account lockout (security review, 2026-09-08: /account/login accepted unlimited online guessing
-- against rows holding a home address, an emergency contact and a badge number).
-- Run once on the live database, after 007:
--   npx wrangler d1 execute mast_bookings --remote --file=migrations/008-rate-limits.sql
-- The CREATE is idempotent; the two ALTERs are NOT (SQLite has no ADD COLUMN IF NOT EXISTS), so a second run fails with
-- "duplicate column name: failed_logins", which means it is already applied and nothing changed. deploy-worker.yml applies
-- this file only when BOTH columns are missing and stops with an error if only one is, rather than half-applying it.
-- src/ratelimit.js also self-heals the same three objects on first use (RATE_SCHEMA / ensureRateSchema), so a Worker
-- deployed ahead of this file still limits; the migration is what makes the state visible in the D1 console.

-- One counter row per (bucket, CF-Connecting-IP). window_start is the ISO time the current fixed window opened; the first
-- request after it has run out rolls it. Rows older than a day are dropped by the daily cron.
CREATE TABLE IF NOT EXISTS rate_limits (
  key          TEXT PRIMARY KEY,              -- '<bucket>:<ip>' — login, signup, code (forgot + resend), verify, seat, contact, event
  window_start TEXT NOT NULL,                 -- ISO time the window opened
  count        INTEGER NOT NULL DEFAULT 0     -- requests inside it; only ever moved by a conditional UPDATE
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits (window_start);

-- Consecutive wrong passwords, and the lock they earn. Cleared by any successful sign-in, verification or reset.
ALTER TABLE accounts ADD COLUMN failed_logins INTEGER NOT NULL DEFAULT 0;  -- 5 → 15 min lock, 10 → 30, 15 → 60 … capped at a day
ALTER TABLE accounts ADD COLUMN locked_until  TEXT;                        -- ISO time; while it is in the future /account/login answers 429 before any PBKDF2 runs

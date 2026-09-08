-- 007 — Law-enforcement / teacher credentials on a student account (owner, 2026-09-08: "Need to add 'CREDENTIALS' to the
-- account if LE Teacher").
-- Run once on the live database, after 006:
--   npx wrangler d1 execute mast_bookings --remote --file=migrations/007-account-credentials.sql
-- NOT idempotent (SQLite has no ADD COLUMN IF NOT EXISTS): a second run fails with "duplicate column name: credential_type",
-- which means it is already applied and nothing changed.
-- The credential itself is never verified here. The account holder types what they hold, the Worker stamps the row
-- 'pending' and emails the office; a person marks it 'verified' or 'declined' in the D1 console. The client can never
-- set the status, and only the last four characters of the number are ever sent back to the page.
ALTER TABLE accounts ADD COLUMN credential_type         TEXT;                          -- 'none' | 'le' | 'teacher'
ALTER TABLE accounts ADD COLUMN credential_org          TEXT;                          -- agency or school, up to 120 characters
ALTER TABLE accounts ADD COLUMN credential_id           TEXT;                          -- credential or badge number, up to 64, letters digits and dashes only
ALTER TABLE accounts ADD COLUMN credential_status       TEXT NOT NULL DEFAULT 'none';  -- 'none' | 'pending' | 'verified' | 'declined' — staff-set, never client-set
ALTER TABLE accounts ADD COLUMN credential_submitted_at TEXT;                          -- stamped every time the account holder changes any of the three fields

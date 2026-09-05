-- 004 — Student accounts (owner, 2026-09-05: "ADD ACCOUNT = account info to include payment method + save + classes taken +
-- placeholder for Standards Passed + other details for account + account email + password").
-- Run once on the live database:
--   wrangler d1 execute mast_bookings --remote --file=migrations/004-accounts.sql
-- Idempotent (CREATE TABLE IF NOT EXISTS). The Worker also needs the ACCOUNT_SECRET secret (README step 3) or every
-- /account/* call answers 503 "Accounts are not configured".
CREATE TABLE IF NOT EXISTS accounts (
  id                     TEXT PRIMARY KEY,             -- acct_<uuid>
  email                  TEXT NOT NULL UNIQUE,         -- normalised lowercase; links classes taken via registrations.customer_email
  password_hash          TEXT NOT NULL,                -- pbkdf2-sha256$<iterations>$<salt b64>$<hash b64>; nothing reversible is stored
  token_version          INTEGER NOT NULL DEFAULT 1,   -- bumped on password change: every issued session token dies
  name                   TEXT,
  phone                  TEXT,
  organization           TEXT,
  address1               TEXT,
  address2               TEXT,
  emergency_name         TEXT,
  emergency_phone        TEXT,
  emergency_relationship TEXT,
  stripe_customer_id     TEXT,                         -- the saved card lives on this Stripe Customer, never here
  standards_passed       TEXT NOT NULL DEFAULT '[]',   -- placeholder: JSON list the instructor fills in later
  notes                  TEXT,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL,
  last_login_at          TEXT
);
CREATE INDEX IF NOT EXISTS idx_accounts_email ON accounts(email);

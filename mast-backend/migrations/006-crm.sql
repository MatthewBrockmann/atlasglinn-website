-- 006 — CRM + marketing data collection (2026-09-06, owner: "CRM should collect data - and much more").
-- The Worker applies these statements itself on first use (crm.js ensureCrmSchema: CREATE IF NOT EXISTS, ALTERs with the
-- duplicate-column error ignored), so no console step is needed; the file is the record and the way to run it by hand:
--   wrangler d1 execute mast_bookings --remote --file=migrations/006-crm.sql

-- Every inquiry is a lead: the site contact form, capability-statement requests, private-instruction and gear quote requests,
-- newsletter sign-ups (/subscribe), the Atlas EP access form. Stored before the email goes out, so a mail failure never loses one.
CREATE TABLE IF NOT EXISTS contacts (
  id               TEXT PRIMARY KEY,
  created_at       TEXT NOT NULL,
  kind             TEXT NOT NULL,            -- contact | capability | private | gear | subscribe | ep_access
  name             TEXT,
  email            TEXT NOT NULL,
  phone            TEXT,
  company          TEXT,
  status           TEXT,                     -- the form's "status" field (e.g. "Need security"), free text
  request_type     TEXT,
  message          TEXT,
  page             TEXT,
  referrer         TEXT,
  landing_page     TEXT,
  utm_source       TEXT,
  utm_medium       TEXT,
  utm_campaign     TEXT,
  utm_content      TEXT,
  utm_term         TEXT,
  visitor          TEXT,                     -- the anonymous first-party visitor id, so pre-inquiry behaviour joins up
  newsletter_opt_in INTEGER DEFAULT 0,       -- consent is its own tick, never implied by an inquiry
  consent_text     TEXT,
  ip               TEXT,
  user_agent       TEXT,
  emailed          INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_contacts_email   ON contacts (email);
CREATE INDEX IF NOT EXISTS idx_contacts_created ON contacts (created_at);

-- First-party behaviour beacon (the CDP pattern from DATA-AND-MARKETING.md without a third party): page views and the
-- moments that lead to a seat — class opened, date picked, registration started, checkout, video played, gear request.
CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at  TEXT NOT NULL,
  visitor     TEXT,
  email       TEXT,
  page        TEXT,
  action      TEXT NOT NULL,
  label       TEXT,
  sku         TEXT,
  referrer    TEXT,
  utm_source  TEXT,
  utm_medium  TEXT,
  utm_campaign TEXT,
  country     TEXT,
  device      TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_created ON events (created_at);
CREATE INDEX IF NOT EXISTS idx_events_visitor ON events (visitor);

-- One row per (email, registration, kind): the idempotency the journeys rely on. A cron retry cannot email twice.
CREATE TABLE IF NOT EXISTS email_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at  TEXT NOT NULL,
  email       TEXT NOT NULL,
  ref         TEXT NOT NULL,                 -- registration id
  kind        TEXT NOT NULL,                 -- t7 | t1 | thanks
  status      TEXT,                          -- sending | sent | failed
  UNIQUE (email, ref, kind)
);

-- Attribution on the registration itself (orders already carry utm_* and first_touch_at).
ALTER TABLE registrations ADD COLUMN utm_source TEXT;
ALTER TABLE registrations ADD COLUMN utm_medium TEXT;
ALTER TABLE registrations ADD COLUMN utm_campaign TEXT;
ALTER TABLE registrations ADD COLUMN referrer TEXT;
ALTER TABLE registrations ADD COLUMN landing_page TEXT;
ALTER TABLE registrations ADD COLUMN first_touch_at TEXT;
ALTER TABLE registrations ADD COLUMN visitor TEXT;
-- Older orders tables (created before schema.sql carried them) get the same four columns.
ALTER TABLE orders ADD COLUMN utm_source TEXT;
ALTER TABLE orders ADD COLUMN utm_medium TEXT;
ALTER TABLE orders ADD COLUMN utm_campaign TEXT;
ALTER TABLE orders ADD COLUMN first_touch_at TEXT;

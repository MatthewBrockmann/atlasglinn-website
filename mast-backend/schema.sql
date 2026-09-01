-- MAST Solutions booking backend — D1 schema
--
-- Apply with:
--   wrangler d1 execute mast_bookings --remote --file=schema.sql

-- ── Orders: every completed Stripe checkout lands here ──────────────
CREATE TABLE IF NOT EXISTS orders (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  stripe_session_id TEXT NOT NULL UNIQUE,   -- makes webhook retries idempotent
  stripe_event_id   TEXT,
  kind              TEXT NOT NULL,          -- 'class_booking' | 'membership'
  sku               TEXT,                   -- class SKU or membership plan key
  item_name         TEXT,
  qty               INTEGER DEFAULT 1,
  amount_total      INTEGER DEFAULT 0,      -- cents, as charged by Stripe
  currency          TEXT DEFAULT 'usd',
  customer_email    TEXT,
  customer_name     TEXT,
  customer_phone    TEXT,
  organization      TEXT,
  notes             TEXT,
  status            TEXT DEFAULT 'paid',    -- 'paid' | 'cancelled' | 'refunded'
  created_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_sku     ON orders (sku);
CREATE INDEX IF NOT EXISTS idx_orders_email   ON orders (customer_email);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders (created_at DESC);

-- ── Offerings: server-authoritative class prices ────────────────────
-- The website never sends an amount; the Worker looks it up here.
CREATE TABLE IF NOT EXISTS offerings (
  sku         TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  active      INTEGER DEFAULT 1,
  sort_order  INTEGER DEFAULT 0
);

-- ⚠️ PRICES ARE ZERO ON PURPOSE — not yet supplied by the owner.
-- A zero price makes the Worker return 409 "call to enroll" instead of charging
-- a guessed amount. Set the real values before taking payments:
--   wrangler d1 execute mast_bookings --remote \
--     --command "UPDATE offerings SET price_cents = 45000 WHERE sku = 'MAST-SHOTGUN'"
INSERT OR IGNORE INTO offerings (sku, name, price_cents, sort_order) VALUES
  ('MAST-SHOTGUN', 'Shotgun Operator',           0, 1),
  ('MAST-AWO',     'Advanced Weapons Operation', 0, 2),
  ('MAST-FOF',     'Force on Force',             0, 3),
  ('MAST-DA',      'Direct Action',              0, 4),
  ('MAST-LLNO',    'Low-Light / Night Ops',      0, 5),
  ('MAST-TMED',    'Tactical Medical',           0, 6);

-- ── Memberships: plan key -> Stripe recurring Price ID ──────────────
-- Rows are added once the real tiers and Stripe Prices exist.
CREATE TABLE IF NOT EXISTS memberships (
  plan_key        TEXT PRIMARY KEY,        -- e.g. 'range_member'
  name            TEXT NOT NULL,
  stripe_price_id TEXT NOT NULL,           -- e.g. 'price_1Abc...'
  price_cents     INTEGER,                 -- display only
  interval        TEXT DEFAULT 'month',
  active          INTEGER DEFAULT 1,
  sort_order      INTEGER DEFAULT 0
);

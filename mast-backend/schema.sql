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
  sku               TEXT,
  session_id        INTEGER,                -- FK -> sessions.id
  session_date      TEXT,                   -- Saturday of the chosen training weekend (YYYY-MM-DD)
  session_label     TEXT,                   -- human label as shown at checkout, e.g. "Sat–Sun, Oct 10–11, 2026"
  item_name         TEXT,
  qty               INTEGER DEFAULT 1,
  amount_total      INTEGER DEFAULT 0,      -- cents, as charged by Stripe
  currency          TEXT DEFAULT 'usd',
  customer_email    TEXT,
  customer_name     TEXT,
  customer_phone    TEXT,
  organization      TEXT,
  notes             TEXT,
  status            TEXT DEFAULT 'paid',    -- paid | cancelled | refunded
  -- consent + attribution (see ARCHITECTURE.md / DATA-AND-MARKETING.md)
  refund_policy_version     TEXT,
  refund_policy_accepted_at TEXT,
  refund_policy_ip          TEXT,
  utm_source        TEXT,
  utm_medium        TEXT,
  utm_campaign      TEXT,
  first_touch_at    TEXT,
  created_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_sku     ON orders (sku);
CREATE INDEX IF NOT EXISTS idx_orders_session ON orders (session_id);
CREATE INDEX IF NOT EXISTS idx_orders_email   ON orders (customer_email);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders (created_at DESC);

-- ── Offerings: server-authoritative course catalog ──────────────────
-- The website never sends an amount; the Worker looks it up here.
CREATE TABLE IF NOT EXISTS offerings (
  sku         TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  price_cents INTEGER NOT NULL,   -- 0 = "call for pricing", blocks online booking
  hours       INTEGER,
  days        INTEGER,
  course_type TEXT DEFAULT 'fundamental',  -- fundamental | operator
  category    TEXT,
  capacity    INTEGER,            -- 16 one-day / 10 multi-day
  blurb       TEXT,
  active      INTEGER DEFAULT 1,
  sort_order  INTEGER DEFAULT 0
);

-- Prices confirmed by owner 2026-09-01.
-- Capacity rule (owner, 2026-09-01): fundamentals = 16, ANY P1/operator = 10.
-- Owner will adjust individual courses upward later.
INSERT OR IGNORE INTO offerings
  (sku, name, price_cents, hours, days, course_type, category, capacity, blurb, sort_order) VALUES
  -- Handgun
  ('MAST-HG-FUND','Handgun Fundamentals',            22500,  8, 1, 'fundamental','Handgun',        16, 'Grip, stance, sights, trigger. The base every other course builds on.', 10),
  -- Ladies-only Handgun (owner, 2026-09-04). Mirrors Handgun Fundamentals until he sets its hours, price and seats. Live DB: migrations/002-ladies-handgun.sql.
  ('MAST-HG-LADIES','Ladies Only Handgun Fundamentals', 22500, 8, 1, 'fundamental','Handgun',      16, 'The same fundamentals, taught in a ladies-only class.', 11),
  ('MAST-HG-OP',  'Handgun Operator',                45000, 16, 2, 'operator',   'Handgun',        10, 'Two days past the fundamentals — movement, transitions, and fighting platforms.', 12),
  -- Carbine
  ('MAST-CAR-FUND','Carbine Fundamentals',           22500,  8, 1, 'fundamental','Carbine',        16, 'Zero, manipulation, and marksmanship with the carbine.', 20),
  ('MAST-CAR-OP', 'Carbine Operator',                45000, 16, 2, 'operator',   'Carbine',        10, 'Two days of carbine work under movement and time pressure.', 21),
  -- Shotgun
  ('MAST-SG-FUND','Shotgun Fundamentals',            22500,  8, 1, 'fundamental','Shotgun',        16, 'Loading under stress, patterning, transitions, and structure work.', 30),
  -- Sub-gun
  ('MAST-SUB-FUND','Sub-Gun Fundamentals',           22500,  8, 1, 'fundamental','Sub-Gun',        16, 'MP5 and variants, 9mm carbine and variants.', 40),
  ('MAST-SUB-P1', 'Sub-Gun P1',                      25000,  8, 1, 'operator',   'Sub-Gun',        10, 'Phase one sub-gun employment.', 41),
  -- Select-fire
  ('MAST-SF-P1',  'Select-Fire M4A1 / MK18 Operator P1', 50000, 8, 1, 'operator','Select-Fire',    10, 'Select-fire employment on the M4A1 / MK18 platform.', 50),
  ('MAST-SF-P2',  'Select-Fire M4A1 / MK18 Operator P2', 95000, 16, 2, 'operator','Select-Fire',   10, 'Day one live-fire range. Day two CQB shoothouse. UTM rounds sold separately — bolts provided.', 51),
  -- Low-light / NVG
  ('MAST-LL-FUND','Low-Light Fundamentals',          22500,  8, 1, 'fundamental','Low-Light / NVG',16, 'Marksmanship and manipulation in the light you will actually have.', 60),
  ('MAST-LL-P1',  'Low-Light Operator P1',           45000, 16, 2, 'operator',   'Low-Light / NVG',10, 'Two days working the transition from low light to no light.', 61),
  ('MAST-NVG-P1', 'Low-Light / No-Light NVG Operator P1', 50000, 16, 2, 'operator','Low-Light / NVG',10, 'Night vision employment, phase one.', 62),
  ('MAST-NVG-P2', 'NVG Operator P2',                 95000, 16, 2, 'operator',   'Low-Light / NVG',10, 'Advanced night vision employment.', 63),
  -- Team tactics
  ('MAST-TEAM-P1','Team Tactics P1',                 45000, 16, 2, 'operator',   'Team Tactics',   10, 'Working as an element rather than as individuals.', 70),
  ('MAST-TEAM-P2','Team Tactics P2',                 47500, 16, 2, 'operator',   'Team Tactics',   10, 'Mechanics, movement, comms and signal.', 71),
  -- Protective
  ('MAST-HPP-P1', 'Home & Property Protection P1',   25000,  8, 1, 'fundamental','Protective',     10, 'Defending the place you live, phase one.', 80),
  ('MAST-VEH-P1', 'Vehicular Tactics P1',            22500,  8, 1, 'fundamental','Protective',     10, 'Working in and around the vehicle.', 81),
  ('MAST-VEH-P2', 'Vehicular Tactics / Team Tactics P2', 50000, 16, 2, 'operator','Protective',    10, 'Vehicle work as a team over two days.', 82),
  ('MAST-MOTOR-P1','Motorcade P1',                       0, NULL, NULL,'operator','Protective',    10, 'Motorcade operations, phase one. Call for pricing.', 83),
  ('MAST-MOTOR-P2','Motorcade P2',                       0, NULL, NULL,'operator','Protective',    10, 'Motorcade operations, phase two. Call for pricing.', 84),
  -- Gear
  ('MAST-GEAR',   'Gear & Kit Considerations',       75000, 24, 3, 'operator',   'Gear',           10, 'Go bag, shelter-in-place, urban movement, low-vis and high-vis, individual and team.', 90);


-- ── Sessions: a course on a date ────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  course_sku   TEXT NOT NULL,
  starts_at    TEXT NOT NULL,          -- ISO date, America/Chicago
  ends_at      TEXT,
  capacity     INTEGER NOT NULL,
  seats_taken  INTEGER DEFAULT 0,
  location     TEXT DEFAULT 'Wharton Range',   -- label only; address is private
  status       TEXT DEFAULT 'open',    -- open | full | cancelled | done
  notes        TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_course ON sessions (course_sku);
CREATE INDEX IF NOT EXISTS idx_sessions_start  ON sessions (starts_at);

-- ── Training weekends (owner, 2026-09-01) ───────────────────────────
-- Sep last · Oct 2nd+4th · Nov 2nd · Dec 2nd · Jan-Apr 2nd+4th,
-- PLUS the 5th weekend wherever a month has one (owner amendment).
--
-- Only two months in this window have five Saturdays: October 2026 and
-- January 2027. Every other month has exactly four.
--
-- Courses are not yet assigned to weekends — the owner is organising that.
CREATE TABLE IF NOT EXISTS training_weekends (
  saturday TEXT PRIMARY KEY,
  sunday   TEXT NOT NULL,
  label    TEXT,
  status   TEXT DEFAULT 'available',   -- available | scheduled | blocked
  note     TEXT
);
INSERT OR IGNORE INTO training_weekends (saturday, sunday, label, note) VALUES
  ('2026-09-26','2026-09-27','September — last weekend', NULL),
  ('2026-10-10','2026-10-11','October — 2nd weekend', NULL),
  ('2026-10-24','2026-10-25','October — 4th weekend', NULL),
  ('2026-10-31','2026-11-01','October — 5th weekend',
     'BLOCKED by owner — Halloween, and the weekend straddles the month.'),
  ('2026-11-14','2026-11-15','November — 2nd weekend', NULL),
  ('2026-12-12','2026-12-13','December — 2nd weekend', NULL),
  ('2027-01-09','2027-01-10','January — 2nd weekend', NULL),
  ('2027-01-23','2027-01-24','January — 4th weekend', NULL),
  ('2027-01-30','2027-01-31','January — 5th weekend', NULL),
  ('2027-02-13','2027-02-14','February — 2nd weekend', NULL),
  ('2027-02-27','2027-02-28','February — 4th weekend', NULL),
  ('2027-03-13','2027-03-14','March — 2nd weekend', NULL),
  ('2027-03-27','2027-03-28','March — 4th weekend', NULL),
  ('2027-04-10','2027-04-11','April — 2nd weekend', NULL),
  ('2027-04-24','2027-04-25','April — 4th weekend', NULL);

UPDATE training_weekends SET status = 'blocked' WHERE saturday = '2026-10-31';

-- ── Seat holds: prevents two people buying the last seat ────────────
CREATE TABLE IF NOT EXISTS seat_holds (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  INTEGER NOT NULL,
  email       TEXT NOT NULL,
  seats       INTEGER NOT NULL DEFAULT 1,
  expires_at  TEXT NOT NULL,          -- ~20 min, covers a Stripe checkout
  consumed    INTEGER DEFAULT 0,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_holds_session ON seat_holds (session_id, expires_at);

-- ── Add-ons: ammunition and rentals (owner: "later") ────────────────
-- Structure only. No rows until the owner supplies products and prices.
CREATE TABLE IF NOT EXISTS addons (
  sku          TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  price_cents  INTEGER NOT NULL,
  kind         TEXT,                  -- ammunition | rental | consumable
  applies_to   TEXT,                  -- course SKU, or NULL for any
  active       INTEGER DEFAULT 0      -- OFF until priced
);
-- Known future add-ons, deliberately not priced:
--   ammunition per course, firearm rentals, UTM rounds for MAST-SF-P2
--   (bolts are provided; rounds sold separately).

-- ── Memberships: plan key -> Stripe recurring Price ID ──────────────
CREATE TABLE IF NOT EXISTS memberships (
  plan_key        TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  stripe_price_id TEXT NOT NULL,
  price_cents     INTEGER,
  interval        TEXT DEFAULT 'month',
  active          INTEGER DEFAULT 1,
  sort_order      INTEGER DEFAULT 0
);
-- The four teams of the old site's 2014 membership sheet (owner, 2026-09-04: "Add the 4 Subscriptions"). Inactive until each
-- has a Stripe recurring Price — then: UPDATE memberships SET stripe_price_id = 'price_…', active = 1 WHERE plan_key = 'red_team';
-- Fees confirmed by the owner 2026-09-04: Red 250, Blue 450, Gold 575, Black 600 per month. Until then the page's Apply buttons are mailto (applications are
-- vetted by the established team anyway). Live DB: migrations/003-membership-teams.sql.
INSERT OR IGNORE INTO memberships (plan_key, name, stripe_price_id, price_cents, interval, active, sort_order) VALUES
  ('red_team',   'Red Team',   '', 25000, 'month', 0, 1),
  ('blue_team',  'Blue Team',  '', 45000, 'month', 0, 2),
  ('gold_team',  'Gold Team',  '', 57500, 'month', 0, 3),
  ('black_team', 'Black Team', '', 60000, 'month', 0, 4);

-- ── Registrations: screening → agreement → refund consent, one row per booking attempt ──
-- Written by POST /register before Stripe is ever called. status: pending (sent to Stripe)
-- | review (a disqualifying answer; nothing charged) | paid | abandoned.
-- The eligibility ANSWERS are not here: see eligibility_answers, which is purged on a schedule.
CREATE TABLE IF NOT EXISTS registrations (
  id                      TEXT PRIMARY KEY,        -- reg_<uuid>
  created_at              TEXT NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'pending',
  sku                     TEXT NOT NULL,
  item_name               TEXT,
  qty                     INTEGER DEFAULT 1,
  session_date            TEXT,
  session_label           TEXT,
  customer_name           TEXT NOT NULL,
  customer_email          TEXT NOT NULL,           -- normalised lowercase
  customer_phone          TEXT,
  organization            TEXT,
  address1                TEXT,
  address2                TEXT,
  emergency_name          TEXT,
  emergency_phone         TEXT,
  emergency_relationship  TEXT,
  eligibility_outcome_id  INTEGER,                 -- FK -> eligibility_outcomes.id
  eligibility_status      TEXT,                    -- cleared | flagged
  questions_version       TEXT,
  agreement_version       TEXT,                    -- hash prefix of the PDF the participant saw
  agreement_signed_name   TEXT,
  agreement_initials      TEXT,
  agreement_signed_at     TEXT,
  agreement_ip            TEXT,
  agreement_user_agent    TEXT,
  refund_policy_version   TEXT,
  refund_policy_accepted_at TEXT,
  refund_policy_ip        TEXT,
  newsletter_opt_in       INTEGER DEFAULT 0,       -- its own consent, unticked by default
  newsletter_opted_in_at  TEXT,
  prereq_attested         INTEGER NOT NULL DEFAULT 0,   -- level 2/3 courses: participant confirmed the prerequisite was completed before (migrations/001)
  stripe_session_id       TEXT,
  paid_at                 TEXT,
  documents_sent_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_reg_email   ON registrations (customer_email);
CREATE INDEX IF NOT EXISTS idx_reg_status  ON registrations (status);
CREATE INDEX IF NOT EXISTS idx_reg_session ON registrations (stripe_session_id);

-- ── Eligibility: the OUTCOME is kept, the ANSWERS are purged (RETENTION-POLICY.md) ──
CREATE TABLE IF NOT EXISTS eligibility_outcomes (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  email             TEXT NOT NULL,                 -- normalised lowercase
  full_name         TEXT,
  profile_id        TEXT,                          -- null while a guest
  registration_id   TEXT,
  outcome           TEXT NOT NULL,                 -- cleared | flagged | declined
  questions_version TEXT NOT NULL,
  decided_at        TEXT NOT NULL,
  expires_at        TEXT,                          -- cleared only; NULL = never expires
  staff_note        TEXT,
  reviewed_by       TEXT
);
CREATE INDEX IF NOT EXISTS idx_outcomes_email ON eligibility_outcomes (email);

-- Sensitive personal data (citizenship status, criminal history). Never emailed, never in an
-- event payload, never synced anywhere. The daily cron deletes rows past purge_after and
-- never touches eligibility_outcomes.
CREATE TABLE IF NOT EXISTS eligibility_answers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  outcome_id   INTEGER NOT NULL,
  answers_json TEXT NOT NULL,
  answered_ip  TEXT,
  created_at   TEXT NOT NULL,
  purge_after  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_answers_purge ON eligibility_answers (purge_after);

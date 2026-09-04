-- 003 — The four membership teams (owner, 2026-09-04: "Add the 4 Subscriptions"), from the old site's 2014 Membership sheet.
-- Run once on the live database:
--   wrangler d1 execute mast_bookings --remote --file=migrations/003-membership-teams.sql
-- Idempotent (INSERT OR IGNORE). The rows are INACTIVE: POST /create-membership refuses a plan without a Stripe recurring Price.
-- When a Price exists in Stripe: UPDATE memberships SET stripe_price_id = 'price_…', active = 1 WHERE plan_key = 'red_team';
-- Fees are the 2014 figures pending the owner's confirmation.
INSERT OR IGNORE INTO memberships (plan_key, name, stripe_price_id, price_cents, interval, active, sort_order) VALUES
  ('red_team',   'Red Team',   '', 12500, 'month', 0, 1),
  ('blue_team',  'Blue Team',  '', 20000, 'month', 0, 2),
  ('gold_team',  'Gold Team',  '', 35000, 'month', 0, 3),
  ('black_team', 'Black Team', '', 50000, 'month', 0, 4);

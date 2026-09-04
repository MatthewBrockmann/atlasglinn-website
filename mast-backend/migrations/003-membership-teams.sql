-- 003 — The four membership teams (owner, 2026-09-04: "Add the 4 Subscriptions"), from the old site's 2014 Membership sheet.
-- Run once on the live database:
--   wrangler d1 execute mast_bookings --remote --file=migrations/003-membership-teams.sql
-- Idempotent (INSERT OR IGNORE). The rows are INACTIVE: POST /create-membership refuses a plan without a Stripe recurring Price.
-- When a Price exists in Stripe: UPDATE memberships SET stripe_price_id = 'price_…', active = 1 WHERE plan_key = 'red_team';
-- Fees confirmed by the owner 2026-09-04: Red 250, Blue 450, Gold 575, Black 600 per month.
INSERT OR IGNORE INTO memberships (plan_key, name, stripe_price_id, price_cents, interval, active, sort_order) VALUES
  ('red_team',   'Red Team',   '', 25000, 'month', 0, 1),
  ('blue_team',  'Blue Team',  '', 45000, 'month', 0, 2),
  ('gold_team',  'Gold Team',  '', 57500, 'month', 0, 3),
  ('black_team', 'Black Team', '', 60000, 'month', 0, 4);

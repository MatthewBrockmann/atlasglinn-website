-- 003 — Membership teams (owner, 2026-09-04: "Add the 4 Subscriptions", then Law Enforcement and Verified Teachers at $195).
-- Run once on the live database:
--   wrangler d1 execute mast_bookings --remote --file=migrations/003-membership-teams.sql
-- Idempotent (INSERT OR IGNORE). stripe_price_id starts empty on purpose: POST /create-membership provisions each plan's Stripe
-- recurring Price on the first join (lookup_key mast_<plan_key>) and stores it on the row. Fees set by the owner 2026-09-04:
-- Red 250, Blue 450, Gold 575, Black 600, Law Enforcement 195, Verified Teachers 195 per month.
INSERT OR IGNORE INTO memberships (plan_key, name, stripe_price_id, price_cents, interval, active, sort_order) VALUES
  ('red_team',      'Red Team',          '', 25000, 'month', 1, 1),
  ('blue_team',     'Blue Team',         '', 45000, 'month', 1, 2),
  ('gold_team',     'Gold Team',         '', 57500, 'month', 1, 3),
  ('black_team',    'Black Team',        '', 60000, 'month', 1, 4),
  ('le_team',       'Law Enforcement',   '', 19500, 'month', 1, 5),
  ('teachers_team', 'Verified Teachers', '', 19500, 'month', 1, 6);

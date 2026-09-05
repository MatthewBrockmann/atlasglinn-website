-- 002 — Ladies-only Handgun class (owner, 2026-09-04: "add one selection, ladies only. Handgun.").
-- Run once on the live database after 2026-09-04:
--   wrangler d1 execute mast_bookings --remote --file=migrations/002-ladies-handgun.sql
-- Idempotent: INSERT OR IGNORE, and the sort-order move only applies while Handgun Operator still holds slot 11.
-- Hours, price and seats mirror Handgun Fundamentals until the owner sets them (UPDATE offerings ... WHERE sku = 'MAST-HG-LADIES').
INSERT OR IGNORE INTO offerings
  (sku, name, price_cents, hours, days, course_type, category, capacity, blurb, sort_order) VALUES
  ('MAST-HG-LADIES','Ladies Only Handgun Fundamentals', 22500, 8, 1, 'fundamental','Handgun', 16, 'The same fundamentals, taught in a ladies-only class.', 11);
UPDATE offerings SET sort_order = 12 WHERE sku = 'MAST-HG-OP' AND sort_order = 11;

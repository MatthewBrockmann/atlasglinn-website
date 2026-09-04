-- 2026-09-04 — Fundamentals is a gate (owner: "They MUST take Fundamentals first UNLESS they have taken it prior").
-- Level 2 and 3 registrations record the participant's attestation that the prerequisite was completed before.
-- Apply once to an existing database:  wrangler d1 execute mast_bookings --remote --file=migrations/001-prereq-attested.sql
-- Fresh databases get the column from schema.sql; re-running this file on a database that already has it fails
-- harmlessly with "duplicate column name".
ALTER TABLE registrations ADD COLUMN prereq_attested INTEGER NOT NULL DEFAULT 0;

-- 013 · the MAST News form's two questions (2026-09-16): what the visitor is here for, and where they are today.
-- Written by POST /subscribe (crm.js handleSubscribe) from the whitelists INTERESTS / LEVELS — the Mailchimp dropdown
-- choices of the INTEREST and LEVEL merge fields — so the profile carries them into the Mailchimp upsert (merge fields
-- INTEREST / LEVEL, tag interest_<x>) and the welcome journey can branch on them. Nothing else reads them.
-- The Worker applies these itself on first use (crm.js ensureCrmSchema: ALTER with the duplicate-column error ignored),
-- and deploy-worker.yml's guard row runs this file when BOTH columns are missing and skips it when both are present.
-- By hand: wrangler d1 execute mast_bookings --remote --file=migrations/013-subscribe-interest.sql
ALTER TABLE contacts ADD COLUMN interest TEXT;
ALTER TABLE contacts ADD COLUMN level TEXT;

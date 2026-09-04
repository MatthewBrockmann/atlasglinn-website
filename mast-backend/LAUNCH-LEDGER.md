# MAST Solutions — launch ledger

Consolidated 2026-09-04 from three audits of every message Brockmann sent in this project (130 messages,
2026-07-01 → 2026-09-04) against the code, plus the markdown and commit sweep of the last 38 hours. This is the
single list. Anything not here was either applied and verified or never asked for. Owner's words are quoted.
Detail files: `README.md`, `ARCHITECTURE.md`, `DATA-AND-MARKETING.md`, `RETENTION-POLICY.md`.

## A. Applied 2026-09-04 (this branch)

- Worker v1.1 **deployed** 16:52 UTC from the owner's Mac (`/health` → 1.1.0, daily purge cron scheduled).
  Secrets on the Worker: `ADMIN_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RANGE_ADDRESS`,
  `DOC_RECIPIENTS_AGREEMENT`, `NOTIFY_EMAIL`. Not set: `RESEND_API_KEY`.
- **Capacity enforced**: a course stops selling on a weekend at `offerings.capacity` (16 one-day fundamentals,
  10 two-day operator courses). Paid seats count; a pending registration holds its seats 30 minutes. 409 `sold_out`
  with `seats_left`. Needs the next deploy.
- **Privacy policy**: §10 Artificial Intelligence added verbatim from his 2026-09-03 dictation; "We do not run
  background checks"; traffic-analytics and campaign-tag bullets; profile reuse and reminder emails now described
  as "when we offer" / "as we add them" because neither is built yet. Sections after §10 renumbered.
- **Protectee line** restored to his "Should read:" sentence (typos fixed only) on the MAST page and every Atlas page.
- **Senators photograph** (Hawley and Schmitt) is now a visible framed image in the Privacy chapter, not only a
  background wash.
- **Media strip**: 16 items. Local, each with a six-second muted teaser and in-place playback: Jason Castro,
  CQB, Modern Shooter TV (the Gun Digest cut), Behind the Scenes, Vehicle Tactics, two range clips, Medical,
  Shotgun, Forge Ignition, the Atlas Glinn home film, the About film. YouTube, embedded in place: Modern Shooter
  TV full episode, Modern Shooter TV Tactical Training Feature (`OfXe_bdH6t4`, his verbatim link), Training Reel,
  Disaster Recovery. `steven.mp4` was WordPress theme demo footage, deleted.
- **Testimonials** back as chapter 08 (six client quotes from the earlier builds).
- **Refund policy** version string `2026-09-01` (was `2026-09-01-draft`, and printed that way in the customer's
  email). Page and Worker must ship together or every registration 409s `stale_policy`.
- `signup.html`: the Atlas EP admin link with its key removed from the page (the key itself still needs rotating).
- `scripts/wp-upload.sh` targets the current GoDaddy host `1127220.us12.ssh.myftpupload.com`.
- Home links on the MAST page, privacy, terms and the capability one-pager point at `/`, which resolves on
  WordPress and on Pages.
- `htmlpreview.github.io` removed from `ALLOWED_ORIGINS` (next deploy). `mast-review.py` thumbnail bug fixed.

### A2. Applied 2026-09-04, evening corrections (his review of the page)

- **Fundamentals is a gate.** Level 2 courses ask the participant to confirm at registration that they completed
  MAST Fundamentals (or an instructor-approved equivalent) before; Level 3 asks for a P1 course. Unticked stops
  the sheet at step 1; the Worker refuses without it (400 `prerequisite`) and records the attestation
  (`registrations.prereq_attested`, migration `migrations/001-prereq-attested.sql`). Badges read "FUNDAMENTALS
  REQUIRED" / "P1 REQUIRED"; the catalog intro says "Fundamentals first, unless you have taken it before."
- **Private Instruction listed first**, no price ("BY ARRANGEMENT"), no dates, a picture on each row (the hero
  shot until he chooses), and a slot for the private-instruction sheet PDF once he supplies the file.
- **Every class can carry a picture** (`img` on the course row); he supplies them.
- **Leadership tile** is the green-shirt beach drill from the About film (his "pushups, green shirts").
- **Forge Ignition removed** from the media strip; his actual MAST clip replaces it when handed off.
- **Torrey Kramer** is on the Instructors chapter with his photo from the old site and a one-line profile drafted
  from the owner's words; the documentary *A Long Recovery* embeds once he sends the link (not in the old export).
- Second round (same evening): the Gun Digest "Modern Shooter TV" cut is out of the strip ("SS1 = cut"); the gold
  shimmer intro stays for MAST (he prefers it over the blue); the "0 Shortcuts" counter is now "34 Years of
  Experience"; the media sentence reads "We don't do media. Names appear only where the media captured them
  without consent." on the MAST page and the Atlas preview; the Jason Castro video sits in the Testimonials
  chapter, not the media strip.
- Still to come from him: his new instructor portrait (JPG), the two-shooters photo for the gallery, the jumping
  "hero" photo, the private-instruction PDF, the replacement MAST clip, more pictures for the folder. *A Long
  Recovery* (YouTube `0IkEMH0LPC8`, link from him 2026-09-04) is embedded under Torrey Kramer's profile.

## B. Before launch — owner's hand, in order

1. **"merge 8"**, then **redeploy the Worker from main** (the deploy paste, which now also applies
   `migrations/001-prereq-attested.sql` once), then **run `scripts/wp-upload.sh`**.
   The page on main and the Worker must match (refund policy version, prerequisite field).
2. **`RESEND_API_KEY`** — `wrangler secret put RESEND_API_KEY --name mast-booking-backend`. Sending as
   `bookings@mastsolutions.com` needs Resend's DNS records added at GoDaddy for mastsolutions.com. Until then no
   receipt, no agreement PDF, no range address, no staff alert goes out; all are logged.
3. **Rotate the Atlas EP leads key** on the `atlas-ep-signup` Worker. It was public on `main` until today.
4. **One live test registration** with the $1 `MAST-TEST` seat, then `curl "…/roster?key=<ADMIN_KEY>"` to see it
   in D1, refund it in Stripe, and say so: the test seat and its `#test` hook are removed after that.
5. **Course → weekend map**, or accept that any course sells on any of the 15 weekends for now (he said "I will
   organize what classes on what weekends later"). Accepted hole for launch night per his 2026-09-04 message.
6. **Security pass over both sites**: Mullvad and pentAI, or an equivalent (his instruction, 2026-09-04).
7. **"rewrite main"**: authorized 2026-09-04, sequenced *after* his final content pass and approval. Purges the
   range address and a personal Gmail from git history; force-push; every clone re-clones.

## C. Open questions only he can answer

1. Instructor roster beyond himself ("add INSTRUCTORS more than Me"): names and titles.
2. Founder shot: is `founder-portrait.jpg` it, or is another photo coming?
3. Instagram: which posts, or an embedded feed?
4. Capability cards: "have it here and bring back to front" — move up the MAST page, put on the Atlas home, or
   change the content? The cards are currently absent.
5. MAST wordmark colour: blue (2026-09-02) or the gold of the cinematic design he then chose?
6. Training count: MAST says 1,701+; the Atlas preview says 729. Same metric?
7. Replacement hero copy for "34+ Years · Security, Training, Dignitary Protection" ("I'll have to send it").
8. `handcuffs.jpg` slot. "Forge Legend" vs "Forge Ignition". Better discipline photos ("I can send some later").
9. Question order: the build asks name/email/phone before the two eligibility questions so a flagged person can be
   called; he said the questions come first. Confirm the build's order is acceptable.
10. "Fundamentals first" is a cue (badges and an intro line), not a gate. Enough?
11. Membership tiers: names, prices, intervals (promised, never sent).
12. Private Instruction prices ($350 / $1,250 / $3,300) came from the progression PDF, not a message. Current?
13. `NOTIFY_EMAIL` value: if the range host is in it, the "range host gets only the signed agreement" rule breaks.
14. Mailchimp API key, audience id, server prefix. PostHog project key. DPAs with Stripe, Resend, Mailchimp.
15. Confirm "no DMP" (`DATA-AND-MARKETING.md` §Compliance): the eligibility answers are TDPSA sensitive data.

## D. After launch

- **CRM and marketing** (his 2026-09-01 brief, `DATA-AND-MARKETING.md`): consent capture and the compliance rules
  run today; unbuilt are Mailchimp sync, profiles with one-year waiver reuse (the 365-day field exists, nothing
  reads it), T−7 / T−1 / T+1 emails, PostHog and Cloudflare Web Analytics, UTM attribution (columns exist,
  nothing writes them), segments and journeys. Build order in `DATA-AND-MARKETING.md` §Build order.
- MAST page site menu (the Atlas pages have it; on WordPress the Atlas page URLs differ, so it waits for the DNS
  cutover).
- Atlas Glinn rebuild: same brand colours as the current site, every current item present and embedded, test only
  (his 2026-09-04 instruction); then the DNS move to GitHub Pages, which also needs the 22 WordPress images
  localized and the 10 WordPress-only URLs (blog, Atlas EP page, 8 articles) rebuilt as static pages.
- Docs to reconcile: `ARCHITECTURE.md` open-decisions table (prices are confirmed; range directions are text in
  the email, not a PDF), `mast-wp-theme/` is superseded by the static page + Worker + SFTP path.

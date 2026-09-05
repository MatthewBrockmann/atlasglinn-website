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
- Second round (same evening): the Gun Digest "Modern Shooter TV" cut is out of the strip ("SS1 = cut"); the MAST
  page moved to the Atlas blue palette ("Use the blue like the Atlas Glinn intro", his later call over the gold);
  "Over Two Decades" replaces 34 years on the MAST page (counter 20+, hero line); the "0 Shortcuts" counter is now "34 Years of
  Experience"; the media sentence reads "We don't do media. Names appear only where the media captured them
  without consent." on the MAST page and the Atlas preview; the Jason Castro video sits in the Testimonials
  chapter, not the media strip.
- Still to come from him: his new instructor portrait (JPG), the two-shooters photo for the gallery, the jumping
  "hero" photo, the private-instruction PDF, the replacement MAST clip, more pictures for the folder. *A Long
  Recovery* (YouTube `0IkEMH0LPC8`, link from him 2026-09-04) is embedded under Torrey Kramer's profile.
- Third round (same evening): **Fundamentals is the gate, per discipline** ("For all of the selections, you have to take the
  fundamentals class first. Where is the qualifier?" then "Still no gate to make sure that first-time students HAVE to take
  Fundamentals in all courses that have fundamentals first"): every course in a discipline with a Fundamentals course requires
  that Fundamentals (Handgun — or the ladies-only class —, Carbine, Sub-Gun, Low-Light / NVG); disciplines without their own fall
  back to Handgun Fundamentals; P2 also needs the P1. **Select Date now stops at a gate** before the calendar: "Yes, I have
  completed it" opens the calendar and pre-ticks the attestation in the sheet; "No" takes the student to the Fundamentals row and
  opens its calendar. The Worker refuses without the attestation. Nothing is checked against a roster (pre-system students are
  not in it). **Ladies Only Handgun
  Fundamentals** added (`MAST-HG-LADIES`, mirrors Handgun Fundamentals' hours, price and seats until he sets them; live DB
  via `migrations/002-ladies-handgun.sql`). **Instructors chapter in the Atlas "Meet the Team" format** with Michael Cline
  (his atlasglinn.com portrait and bio) and Torrey Kramer as portrait + bio blocks. **Training Reel first** in the strip,
  looping back before its closing "2023" card (end mark at 0:36) until the file is local. "without consent" removed from the
  media sentence. Chapter menu bold in gold; nav reads "Testimonials". **Palette settled**: blue page, gold kept on the hero
  wordmark ("This stays gold. shimmer as it was."), the class selections (catalog, calendar, registration sheet) and the
  chapter menu; the intro splash stays blue with a gold band sweeping through the wordmark. Hero wordmark ~28% smaller.
  `scripts/mac-handoff.sh` now fetches YouTube / Instagram / Vimeo pages as MP4 (yt-dlp) and `handoff-urls.txt` queues the
  Training Reel and Disaster Recovery films — both live after the merge, since the Mac reads the script from `main`.
  `preview/old-range-photos.html`: the old website's 2014–2015 uploads as numbered sheets, for him to pick from.
  **Capability one-pager**: the Print / Save-as-PDF button is gone; the bar carries the email request instead, and printing
  the page yields only the request line ("Capabilities statement cannot be printed. Remember?" — the 2026-09-03 "email, not
  print" rule, now applied on the sheet as well as the MAST page).

## B. Before launch — owner's hand, in order

1. **"merge 8"**, then **redeploy the Worker from main** (the deploy paste, which now also applies
   `migrations/001-prereq-attested.sql` and `migrations/002-ladies-handgun.sql` once), then **run `scripts/wp-upload.sh`**.
   The page on main and the Worker must match (refund policy version, prerequisite rule, the ladies-only SKU).
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

1. Instructor roster: Michael Cline is listed with his Atlas Glinn title (Chief Operating Officer) — his MAST title, if
   different. **Torrey Kramer's bio text**: not in the old-site export (only his photo), the Wayback Machine is blocked from
   the container — paste it, or hand off a file. Anyone else.
1a. ~~His instructor portrait~~ — received in chat 2026-09-04 (`images/mast/brockmann-instructor.jpg`, 1331×2000, photographer's
   mark kept) and placed on the founder block. He is adding one more tactical photo "to match instructors" (the other two
   portraits are "less tactical") — place it where he says when it lands. **Private-row photos**: the three rows share one
   picture until his three arrive (each row takes its own).
1b. **Ladies Only Handgun**: hours, price, seats (built as 8 h / $225 / 16 seats, mirroring Handgun Fundamentals).
1c. **Instagram clips**: the post URLs (after the merge the handoff paste fetches them: `... | bash -s -- <urls>`), or the
   original files into the folder before then.
1d. **Range and classroom photographs** ("The range photos are the ones that were posted on the old website, with the classroom,
   the range"): **not in the handoff**. The old-site export's media library holds only 2014/06, 2014/09, 2014/11 and 2015/01
   plus the gallery plugin's folder (the 2012–2014 shoots) — no classroom, nothing posted after January 2015. **Resolved in chat,
   2026-09-05:** he attached the range set himself (the aerial, the berm, the berm at dusk, the canopies, the classroom, the
   briefing, the pistol line, the range at night, the low-light class, the doorway entry: `images/mast/range/a01–a12.jpg`) and
   trimmed the old-site views to ten ("Delete 2, 3, 4, 6, 8, 9, 10, 11, 12, 13, 14, 15, 19, 21, 22, 23" on the 27-tile build).
   Chapter 05 now shows his eleven photographs (a second aerial, "Range photo", came at 01:18), then those ten. The sixteen he
   cut stay in the folder, out of the chapter ("can add some to gallery" — say the numbers and they go in). **Gallery:** In Action
   (chapter 09) now carries a "Photographs" grid under the films, same tile and lightbox as The Range: the five action
   photographs he sent without a caption at 01:18 (`images/mast/gallery/g01–g05.jpg`: the police line on the covered range,
   the vehicle drill in smoke, the boat drill, room clearing, the night muzzle flash; then g06–g09 at 01:24: the carbine from
   behind the car, through the smoke, the team in the truck bed, coffee in kit with an MP) plus a06/a07 (the firing line, the
   prone shot). **Class pictures** ("The photos can go into the class area that I have labeled", 01:26, with a screenshot of the
   three Private rows all carrying the casualty-carry photo): every course row in `mastsolutions-tesla.html` now carries an
   `img` — a 320-px square cut from his photographs at `images/mast/class/<SKU>.jpg` (the map and crop points are in the
   script that cut them; the labelled sheet went to him in chat). Matched by content, since the photographs arrive as pixels
   without file names: Private Session = the briefing, Foundation = the classroom, Full Progression = the aerial with the class,
   Handgun Fundamentals = the pistol line, Ladies Only = the old site's mixed line, Handgun Operator = the covered-range police
   line, Carbine = his firing line / prone shot, Shotgun = the class film's frame, Select-Fire = the old Carbine-Auto flash / the
   woods-range group, Low-Light = the range at night / the green-light class, NVG = the night muzzle flash / the old night-vision
   green, Team Tactics = the truck bed / the doorway entry, Home & Property = room clearing, Vehicular = behind the car / through
   the smoke, Motorcade = the SUV drill / the old truck, Gear = in kit. He corrects by class name. A second shotgun film,
   "Shotgun class instruction" (30 s, `images/mast/mast-shotgun-op.mp4`, the source file as sent, its moov atom already first),
   is the **Shotgun Operator** card after Shotgun in In Action.
   **01:30–01:45, his round on the backdrops:** "Reduce background brightness by 20%" → the photograph layer sits at .42
   (phones .35) in the shared shell, so both sites; "BOTH SITES?" — yes for the brightness and the contact-line shadow, which
   live in the shell; the chapter positions, the portrait, the splash font are MAST only. Standard (02) from the top so the two
   faces show; Who (03) from the bottom so the four operators on the deck show; Meet the Team (08) takes the carbine-behind-the-car
   photograph; The Range (05) backdrop is the aerial (its previous file name never existed); the founder portrait is a tall cut of the
   skyline photograph framed on his face (`images/mast/brockmann-portrait.jpg`); contact lines in full text colour with a shadow
   ("Fix the visibility of the contact"); the splash wordmark is the hero's Orbitron ("Keep this font for the splash opener — need
   the consistency"). "The Range = 'SHOW ALL' delete … just what we have for the range is good": the twelve that showed stay,
   no button; r004, r013–r015, r017, r021–r024 leave the chapter.
   **01:55–02:10:** "Wrong photo, replace with this" → Ladies Only takes the pistol-on-the-berm photograph he sent
   (`images/mast/ladies-handgun.jpg`). The combatives frame (no caption) → gallery g13, app chrome cropped. "Collapse all the
   photos … with a close open button. I'm trying to limit how much scrolling there is" → both photo grids (The Range, the
   gallery under In Action) start closed behind a "Click to View / Click to Close" button (`fold_button`, `.fold`, `toggleFold`).
   "The hero pictures are all jacked up, not all the same size. Go back to my original hero picture for instructor" → every
   portrait (founder, Cline, Kramer) is one 4:5 frame in the same column, no longer stretching with the bio (shell `.founder`,
   `.team`); the founder block is back on `brockmann-instructor.jpg` (the skyline photograph as sent), framed 66% across.
   "Put the Washington Post article right above the videos" → the Post line sits between the In Action sub and the film strip.
   **02:08, privacy statement:** the traffic-analytics bullet (Cloudflare Web Analytics, PostHog) and the campaign-tags bullet
   are out of `privacy.html`. He ordered them deleted on 2026-09-03 (with the security-posture and hosting-logs paragraphs,
   which did go); the 2026-09-04 launch pass misread them as additions and put them back. The rule is now in `CLAUDE.md`
   ("Privacy statement rule") so no session repeats it. If the WordPress copy of the policy carries the two bullets, they
   come out there too (his hand in WordPress, or the page upload).
   His **shotgun clip** (`SHOTGUN gallery vids.mp4`, 7 s) is cut together with the existing 6 s take as one Shotgun film in
   In Action (`images/mast/mast-shotgun.mp4`, new take first; poster and teaser from it).
   Earlier note — chapter 05 **The Range** (2026-09-04, "look up the range photos that we had on the other site. That
   should be enter the range"): twelve photographs from the old site's own set on the handoff branch (P.078, P.162, P.111, P.009,
   P.001, P.025, P.059, P.080, P.133, P.122, P.017, P.138 on `preview/old-range-photos.html`), as skills tiles with a lightbox.
   The old site only kept 600-px versions of most of them; larger originals would have to come from his files. Swap by number.
   Hero buttons: **Enter the Range** → chapter 05, **Classes** → chapter 06 ("Classes should be classes. Shouldn't have two
   buttons for the same action"); chapters after it renumbered to 12.
1e. **Doctrine notes** (his 2026-09-04 dump: 7 Skills, soft skills, three-year goals, five AG Leadership traits, ten Dignitary
   Protection attributes, movement / signals / smoke / PACE / loadout / DOPE / OCOKA / combat survival): "Keep this = this is
   background ... this will be separated as descriptors for certain classes." **Not committed** — this repository is public, and
   the notes are internal training doctrine. They sit in the session record; file them in the brain vault (private) or hand the
   text off, then split them into course descriptors. The 7 Skills already match the seven Disciplines tiles on the page.
1f. **"Where is the blogs"**: the eight rebuilt articles live under `articles/` (index at `articles/index.html`); the live
   WordPress blog at `/blog` is one of the ten WordPress-only URLs that must be rebuilt before the DNS cutover (§D). Neither
   the MAST page nor the Atlas preview links to the articles yet — his call where.
2. Founder shot: is `founder-portrait.jpg` it, or is another photo coming?
3. Instagram: which posts, or an embedded feed?
4. Capability cards: "have it here and bring back to front" — move up the MAST page, put on the Atlas home, or
   change the content? The cards are currently absent.
5. ~~MAST wordmark colour~~ — settled 2026-09-04: blue page, gold on the hero wordmark, the class selections and the menu.
6. Training count: MAST says 1,701+; the Atlas preview says 729. Same metric?
7. Replacement hero copy for "34+ Years · Security, Training, Dignitary Protection" ("I'll have to send it").
8. `handcuffs.jpg` slot. "Forge Legend" vs "Forge Ignition". Better discipline photos ("I can send some later").
9. Question order: the build asks name/email/phone before the two eligibility questions so a flagged person can be
   called; he said the questions come first. Confirm the build's order is acceptable.
10. ~~"Fundamentals first" is a cue, not a gate~~ — settled 2026-09-04: each discipline's Fundamentals gates its other courses
    (badge on every row, a yes/no gate at Select Date, attestation at registration, Worker refuses without it). Still open: should
    disciplines without their own Fundamentals (Select-Fire, Team Tactics, Protective, Gear) require Handgun Fundamentals, as built?
11. ~~Membership tiers~~ — chapter 06 "The Teams", six plans (2026-09-04): Red $250 (10 slots; 1 class + 25% off any 1 class for
    you or 1 friend), Blue $450 (5; 2 classes + 35% off 2 for you or 2 friends), Gold $575 (5; 3 + 45% off 3), Black $600 (5;
    unlimited + 50% off any class for you or 4 friends), **Law Enforcement $195** and **Verified Teachers $195** (Blue's benefits;
    "verified status required"), monthly; waiting list; vetted by the established team. **Join → Stripe Checkout in subscription
    mode** through `POST /create-membership`; the Worker provisions each plan's Stripe recurring Price on the first join
    (lookup_key `mast_<plan>`) and stores it in `memberships` — his "2- you can do" — so no price id is handled by anyone. Needs
    the next deploy plus `migrations/003`. **Still his:** slot counts for Red/Blue/Gold/Black are the 2014 figures; LE and
    Teachers have none; how "verified" is checked; and the sequence — the page charges at join and says the team vets new
    members, so decide whether a declined member is refunded or vetting comes first (then Join becomes an application).
11a. ~~Certificate credentials~~ — on the founder block since 2026-09-04 ("not in MASTsolutions - if not add"): Harris County
    Diplomatic Protection Unit instructor; Chief Training Officer certification co-signed by the Chief of the Texas Rangers
    (Ret.); 12+ certified instructor programs; The Houstonian. The certificate's phone and suite address are not on the page.
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

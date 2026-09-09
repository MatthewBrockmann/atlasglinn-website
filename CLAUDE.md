# Atlas Glinn Website

Static HTML site for atlasglinn.com (GitHub Pages — see `CNAME`). Pages are
hand-authored HTML files in the repo root with shared assets under `images/`.

## MAST Solutions page (decided by Brockmann 2026-09-03)

`mastsolutions.html` is the cinematic Tier 3 trailer design and it is **generated**:
edit `scripts/assemble-cinematic.py` and run `python3 scripts/assemble-cinematic.py`.
Never hand-edit the HTML; the next run overwrites it. The assembler lifts the booking
stack (catalog, calendar, checkout, quals modal, media strip) from
`mastsolutions-tesla.html`, so booking changes go there first. `mastsolutions-atlas.html`
is the earlier Atlas-frame build, kept noindex just in case; `mastsolutions-cinematic.html`
is a redirect stub for the preview links that were shared.

**Store chapter, chapter 12 (Brockmann, 2026-09-05: "Atlasglinn.com has this product = add to mastsolutions so we can sell there"):** the
Aimpoint optics and IWA International devices from his IWA inventory report are listed in `GEAR` in `mastsolutions-tesla.html`
and lifted into chapter 12 of the MAST page. They are **quote requests through the existing Request dialog** (`request_type:
'gear'` to the Worker's `/contact`), never a Stripe checkout: card networks bar weapons accessories and energetic devices from
ordinary checkout and a listing there would put the class bookings' Stripe account at risk. **Prices (Brockmann, 2026-09-06:
"look at mem - md + brain = has pricing + add to mastsolutions too"):** `GEAR_PRICE_TABLE()` in `mastsolutions-tesla.html`
carries them. Aimpoint = the MAP prices the live `atlasglinn.com/aimpoint-shop/` page embeds for the same 31 SKUs (Minimum
Advertised Price; dealer and volume pricing on request; the dealer costs in his IWA inventory report are never shown). IWA =
the shop prices in the brain vault, `04-resources/agent-memory/project_iwa_product_specs.md` (each; 3-unit minimum, 27 per
box, hazmat shipping included as a dealer). The vault also holds his standing correction (`feedback_iwa_civilian_legal.md`):
IWA training devices are **civilian-legal**, a PPC certification is what the order needs, not an agency; the dialog's required
field for devices is "agency, organization or PPC certificate number" and the office verifies before fulfilment. Quote
requests stay the mechanism on this page (the class account's Stripe must not touch energetic devices); a cart for them would
need its own merchant account, his call. Add products to `GEAR` and their price to the table; the `.gear-card` hover is the
shared one in `cinematic_shell.py`. **Aimpoint hidden (Brockmann, 2026-09-07 from the live site: "hide Aimpoint for
now"):** `GEAR_HIDDEN = ['Aimpoint']` in `mastsolutions-tesla.html` keeps the cards off (items and prices stay in `GEAR`),
the chapter reads "Store · IWA" (the Aimpoint sentence is parked in a comment beside it in `assemble-cinematic.py`), and
the Atlas Training submenu's "Aimpoint Optics" entry is commented out in `assemble-atlas.py`. Bringing it back is those
three edits on his word. **Renamed Gear → Store (Brockmann, 2026-09-08, on a screenshot of the chapter: `"GEAR"= wrong -
STORE = header + IWA + Training Devices + List price + OUT OF STOCK + link to add acutal product info
https://iwainternationalinc.com/shop/`):** the `CHAPTERS` label in `assemble-cinematic.py` carries the rail, the HUD and
the mobile menu, the brand header over the cards reads "IWA Training Devices", and the chapter is its eyebrow only —
"Store · IWA" — since the h2 repeated it (2026-09-09, below). The `<div id="gear">` anchor stays, because the Atlas pages'
Training submenu links to `mastsolutions.html#gear`. **`GEAR_OUT_OF_STOCK = true` in `mastsolutions-tesla.html`** puts an
OUT OF STOCK badge on every device card, in the product view and in the request dialog's fine print; a per-item `g.stock`
on a `GEAR` row overrides it, so flipping the constant to false is the one edit that restocks the line.

**No outbound IWA link; the product view is ours (Brockmann, 2026-09-08: "the link to IWA sends them to their store. We
need them to buy from our store, not theirs", then 2026-09-09: "What we want is the actual marketing and verbiage so that
you can click on it and see -- take request quiote off- they can click product if out of stock _ email + inventory
available"):** IWA's URLs are a SOURCE list, never a destination — and since 2026-09-09 they are **not in the browser at
all**. `SOURCE_URLS` lives in `scripts/store-intake.py`, which is the only thing that uses them; the page's old
`GEAR_SHOP` / `GEAR_PRODUCT_URL` / `gearUrl()` are deleted, because nothing called `gearUrl()` but a JS-built href is one
edit away and leaves no literal for a guard to match — which is exactly how the links he killed on 2026-09-08 were made.
`scripts/store-intake.py` reads the captured IWA product pages (`reference/desktop/live/<slug>.html` on
`claude/desktop-assets`) and writes `scripts/store-products.json` (**16,388 bytes**, 6 products, 23 image URLs) — their
title, their description sanitized to a nine-tag allowlist, `KEEP_TAGS = {'p','ul','ol','li','strong','b','em','i','br'}`
with every attribute dropped (it is assigned with `innerHTML`, so that allowlist is the only thing between their markup
and the DOM), the spec lines they publish and their photographs; `assemble-cinematic.py` splices it into the page as
`STORE_PRODUCTS`, stripping each product's `source` and `capture` fields on the way in. A click on any card (whole card, `tabindex=0`,
Enter/Space) opens `#prod` on our page with that copy, OUR list price from `GEAR_PRICE_TABLE`, OUR stock line from
`gearOut`, one control — **Email about availability**, the existing `requestGear` path — and the line "Manufacturer
information: IWA International" (text, not a link). IWA's own order/shipping policy block is cut: it describes checkout on
their site. Six devices have captures; PA-85, TH-14 and the door charge are queued in `scripts/handoff-urls.txt` (their
URLs read off the captured shop pages 2 and 4) and until they land their view shows name, price, stock and the email
control. The product photographs are still IWA's BigCommerce CDN URLs — declared, and it means IWA sees this store's traffic and
can blank all 23 by renaming a file. The next capture closes it without another edit: all **23** image URLs are queued in
`scripts/handoff-urls.txt` (verified 2026-09-09 — the file lists them without the `?c=` query, which is the form
`localise()` looks them up by), and on the next `store-intake.py` run each one that has landed in
`reference/desktop/live/` is written into `images/mast/store/<sku>-<n>.<ext>` and the JSON rewritten to that local path.
Until then the run prints one `no captured file …; the view uses IWA's CDN URL` line per image, and `images/mast/store/`
is not created at all. Re-run `store-intake.py` after a capture; the JSON is committed. Asserts at the foot of
`assemble-cinematic.py` hold all of it, including "no `href` to iwainternationalinc.com anywhere".

**One header size (Brockmann, 2026-09-08: "make all headers the same. font size. And for some, obviously, we are saying
this exact same thing. So we don't need team memberships and then team memberships in a gigantic header"):** the size is
**one token in one `:root`**, and that `:root` is MAST-only — `--head-chapter` in the `GOLD_KEEP` block of
`assemble-cinematic.py`, which is spliced after the shell's stylesheet, so `h1.mega`, `h2.section-h` and the dialogs'
`.modal h3` all end on it. `scripts/cinematic_shell.py` is **byte-identical to `main`**: it is the Atlas generator's input
too, and the first version of this put the tokens there, which changed what `assemble-atlas.py` emits for all twelve
Atlas pages. Two `:root` blocks declaring the same token at the same specificity is the defect — order decides — so the
build asserts there is exactly one, and that each heading's LAST `font-size` is the token (measured in Chromium
2026-09-09: 51.2 px on all seven headings at 1280, 28.8 px at 393). And a chapter whose h2 only repeated its eyebrow lost the h2: s5 "The Range.", s7 "Team Memberships.",
s9 "In Action.", s12 "Store." — the eyebrow stays and carries the chapter, as s6 already did. s8 (Instructors / Meet The
Team) and s10 (Testimonials / In Their Words) say the same thing in different words and stay until he says otherwise. A
guard walks every chapter and fails the build if an h2's words are a subset of its eyebrow's.

**In Action, exactly: the photo grid, not the chapter (2026-09-09).** His words — "This is a video and does not belong",
then "NOT VIDEOS" — were about `#gallery-tiles`, and that grid is now 18 tiles, every one a `.jpg`, no clip, no play
glyph, `g15`–`g17` his 2026-09-08 photographs (a build assert reads `images/mast/gallery/tiles.txt` and fails on any
`.mp4/.mov/.webm/.m4v`). **The ten `<video>` film cards above the grid are the chapter's FILM section and are still
there, unchanged since before this pass** — a separate thing from the grid, left alone on purpose rather than removed on
inference. If they should go too, that is one word from him and one edit.

**MAST → Atlas links are the approved public URLs (2026-09-09):** the footer's Atlas destinations are the WordPress slugs
the live site's own navigation uses — `https://atlasglinn.com/<slug>/` for executive-protection, residential-protection,
disaster-recovery, training, technology, cuas-aerodefense, uas, about, careers, contact, ep-app, **privacy, terms**, and
`https://atlasglinn.com/` for home (`AG_SLUG` in `assemble-cinematic.py`). They used to point at
`atlasglinn.com/<slug>.html`, the static preview builds — publicly reachable but not approved
(`00-rules/website-go-live-gate.md`), and MAST's public footer was the path into them. **The first version of this fixed
only the eleven links it knew about.** The guard walked `AG_SLUG`, so the five it did not know about were invisible to
it, and the `mastsolutions.com` copy — the one that host actually serves — promoted them all to `.html` anyway through a
blanket rewrite: Privacy, Terms, the eligibility anchor, the capability one-pager and the hidden Blogs entry. Now: the
blanket rewrite is gone; `privacy/` and `terms/` are `AG_SLUG` (the live `ep-app` page links to exactly those two, read
off the capture 2026-09-09, so they are his approved URLs); and the guard is a shape check — **no `atlasglinn.com` target
ending in `.html`, in either copy, whatever its name.** `mast-capability-statement.html` and the preview-only
`articles/index.html` are MAST's own pages with no equivalent anywhere in the live captures (grepped, 0 hits) and stay
relative. **Named gap:** `.github/workflows/pages-mastsolutions.yml` stages `index.html`, the manifest, `robots.txt`,
`sitemap.xml` and the assets its resolver finds, and that resolver skips `.html` — so `mast-capability-statement.html` is
not on the Pages host and its "View One-Pager" link 404s there until that workflow stages it.

**Experiences chapter (Brockmann, 2026-09-08: "add in Courses = 'EXPERIENCES' Couples + groups = Pics and Content coming",
then by email the four he wants):** `EXPERIENCES` in `mastsolutions-tesla.html` holds them — Couples Range Experience, Date
Night at the Range, Bachelor Party at the Range, Corporate Team Training — and `renderExperiences()` appends them to the
course catalog as one more accordion titled "Experiences", in the class-card style. They are not courses: no SKU, no D1
catalog row, no price. **They are placeholders by his direction:** *"$pricing and write-ups can be done later - Placeholder
for calendar + how to book + package details = can be emailed for details for right now."* So each card carries the name,
one line ("Package details and pricing are being finalized. Email us for details."), the calendar placeholder ("Dates
announced soon") and a How to book button that opens the same Request dialog the private-instruction rows use
(`request_type: 'experience'` to the Worker's `/contact`) with the experience name in the message. **No price, no duration,
no date and no package contents until he supplies them** — `EXPERIENCES_HIDDEN` is `false` now, and the two earlier
placeholder entries (Couples, Groups) are gone. Pricing or booking would need a catalog row and a SKU — his call.

**Every date is a waiting list (Brockmann, 2026-09-08: "Every Page should have BOOK CLASS + link to Calendar + ALL DATES
for now CLASS FILLED until i get the info to you", corrected minutes later to "Not class filled-. Join waiting list"):**
`WAITLIST_ALL_DATES` is one constant at the top of the booking script in `mastsolutions-tesla.html`. While it is `true`,
every path into checkout — the catalog row, the weekend calendar's per-class action, and both answers to the prerequisite
gate — reads **Join waiting list** and goes through `bookCourse()` to the Request dialog as `request_type: 'waitlist'`,
carrying the course name and, when a weekend was chosen in the Book a Class calendar, that weekend. **The prerequisite gate
still runs first.** `bookCourse()` is the single door, so the label and the destination cannot drift apart; the assembler
folds the action label at build time and then asserts the words "Select Date" appear nowhere in the built page. Set the
constant to `false` and the calendar → checkout path is exactly what it was (verified by diffing the built booking script
against `main`). A Worker-side `BOOKINGS_PAUSED` flag is what should replace this constant once the schedule is real — the
pause is then one deploy, not a rebuild of both pages. The Worker files an unknown `request_type` as `leadKind 'contact'`
with the "Website contact:" subject, so `'experience'` and `'waitlist'` are stored and emailed today; the nicer subject
lines are a Worker follow-up, not part of this.

**Classes chapter, Range-style (Brockmann, 2026-09-08, over a screenshot of this chapter's heading and one of the Range
chapter's CLICK TO VIEW button: "Delete this + add like the range + CLICK TO VIEW = gets rid of scrolling + Book Course =
cal+ courses show", and on the heading itself "Delete SS 2 + Course Catalog enough"):** chapter `s6` is now the eyebrow, its
one line and two controls in the Range chapter's style. **CLICK TO VIEW** opens `CATALOG_MODAL` — the same `#catalog` panel
the booking script fills, the same accordions, course rows and prerequisite gate, in a dialog of the `#dcal` / `#req` family
rather than in the page flow, so the chapter no longer scrolls. It is spliced **before** the calendar, gate and request
dialogs, which share its z-index and must paint over it. **BOOK COURSE** calls `openDCal()` and is this chapter's
Book-a-Class control (one button, not two). The backdrop is his photograph (*"For Cources - THIS BACKGROUND PIC NOT THE
SS"*): `images/mast/courses-instructor.jpg` at `background-position 50% 15%` — the file is 1024x950 and his head sits in its
top fifth, so a 16:9 cover from the centre crops it away. `courses-low-light.jpg` stays in the repo; chapter 07 still uses
it.

**Account credentials (Brockmann, 2026-09-08: "Need to add 'CREDENTIALS' to the account if LE Teacher"):** the account panel
carries a Credentials block — type (`none` / `le` / `teacher`), agency or school, credential or badge number — saved by the
same Save details button through `POST /account/update`. The Worker validates the type against the three keys, caps the org
at 120 and the number at 64 (letters, digits and dashes only), stamps `credential_status = 'pending'` and
`credential_submitted_at` on any real change, and emails NOTIFY_EMAIL once ("Credential review needed: name · type · org").
**The client can never set the status**: a person verifies with the agency or school and sets `verified` or `declined` on the
`accounts` row in the D1 console. The number is stored whole (the office needs it to verify) and returned to the page as its
last four only, so the field shows `•••• 4417` as a placeholder and blank means keep. Re-saving the same values is a no-op —
the panel posts every field on every save and must not re-notify. Columns:
`mast-backend/migrations/007-account-credentials.sql`, a manual `wrangler d1 execute` per `mast-backend/README.md`; the same
columns are in `schema.sql` for a fresh database. Nothing here is wired to a member rate yet.

**Class certificates (Brockmann, 2026-09-08: "I love this certificate so wanting to use for all classes + when paid for can
auto build to print"):** `certificates/mast-certificate-of-completion.html` is the print template, rebuilt from the auction
gift certificate so the paper, double gold border, corner flourishes, ◆ divider and signature block are the same artwork —
the auction copy (bearer and guests, rentals, ammunition, `CERTIFICATE VALUE`, `VALID THROUGH`) is deleted and `VALID
THROUGH` is now a blank INSTRUCTOR rule signed by hand. Build one with `python3 scripts/build-certificate.py` (stdlib only,
prints through headless Chrome); placeholders are `{{name}} {{course}} {{descriptor}} {{cert_no}} {{date}}` and the course
name must be verbatim from `SEED_CLASSES` in `mast-backend/src/worker.js`. **The signature PNG is not in this public
repo** — the builder reads it from `--signature` (default `~/Documents/brain/04-resources/brand/mast-signature-brockmann.png`,
the private brain repo) and exits 1 without it; built certificates are never committed for the same reason. Long names and
course names step down in size to stay on their rule. Certificate number rule and print settings are in
`certificates/README.md`. Auto-building one per paid registration is planned, not built.

## Atlas Glinn pages (decided by Brockmann 2026-09-03: "SAME front end", mobile first)

### LIVE-CONTENT MODE — what the twelve pages are today (2026-09-08, current; everything below it is history)

Brockmann, 2026-09-08 21:47 UTC, on the preview: *"Atlasglinn is not rendering correctly the main site and the should
go same font and sizes into the new design + if video - NO hallucinations just use the new frontend - side bar = take
the current site and drop into new design and see - no changes to anything."*

So the pages are no longer written from copy typed into the assembler. **Each page is the classic shell's chrome —
sticky bar with its dropdowns, mobile menu, Enter / Skip Intro splash, footer, back-to-top — wrapped around the current
atlasglinn.com page taken whole** from `reference/live/<slug>.html`: its head, its `<style>` blocks, its copy, its
photographs and its films **at their own `https://atlasglinn.com/wp-content/…` URLs**, and its own scripts. The theme
stylesheet it links is served from the repo as `vendor/atlasglinn-shared-styles.css` (same bytes as
`reference/live/shared-styles.css`), so the live type scale comes with it.

- `scripts/atlas_live.py` reads one snapshot: head facts, `<style>` blocks verbatim, the content between the live
  chrome boundaries, the tail scripts the content owns, the media list. Internal links become the sibling `.html`;
  **media URLs are left absolute on purpose** — a repo copy is a different encode (the disaster hero is 44.6 MB live
  against 3.7 MB here) and a teaser is a different film, and both are the "re-cut" he ruled out.
- `chrome_css()` cuts the shell stylesheet down to the five chrome roots (`#intro-overlay`, `#main-nav`,
  `#mobile-nav`, `footer.site-footer`, `#back-to-top`) and drops every global and content rule by name —
  `DROP_SELECTORS` fails the build if one of them is ever renamed away. The palette is declared **on those roots, not
  on `:root`**: ep-app.html's own sheet declares `--gold` on `:root` and its content reads it, so a second `:root`
  would repaint that page. Reading order is theme sheet → the page's own `<style>` blocks → the chrome sheet, so the
  live body rule, the live type scale and the live components all win.
- The shell's sound toggle is cut from its script (five live pages ship their own `#sound-toggle` and the code that
  works it, inside the content) and the live 3.5-second auto-enter is added to the splash, because the shell's waited
  for a click and that is a black screen on a phone.
- `scripts/compare-atlas.py` writes **`atlas-compare.html` at the repo root** (tracked, noindex, staged at
  `/preview/atlasglinn/atlas-compare.html`): the live page and the new page side by side, both read out by one
  extractor, with the carried text-unit and media counts above each pair. It **exits 1** if any page is short.
- Re-run after a capture: `python3 scripts/assemble-atlas.py --publish && python3 scripts/compare-atlas.py &&
  python3 scripts/check-links.py`. Refresh the snapshots from `origin/claude/desktop-assets:reference/desktop/live/`
  and update `reference/live/_captured.txt` when the live site changes.
- `--authored` still runs the hand-authored chapters described below. **Deprecated, one release only** — that copy is
  what made the preview diverge (rewritten headings, a rewritten Atlas EP price table, a 6-second re-cut in place of
  the 27-second home film). Do not fix a live-content problem by editing it.

Measured 2026-09-08 in Chromium (1440×900 and 390×844, fonts blocked on both sides, the live capture rendered the same
way as the yardstick): text parity 1257/1257 units, media parity 35/35 URLs, typography 36/36 computed snapshots per
page, hero `<video>` src equal to the live src on all twelve, zero horizontal overflow, one nav and one footer in every
DOM, and not one chrome CSS rule matching an element outside the five chrome roots.

### History — the hand-authored build (superseded by the block above)

The rebuilt `index`, `executive-protection`, `residential-protection`, `disaster-recovery`,
`training`, `technology`, `cuas-aerodefense`, `uas`, `about`, `careers` and `contact` pages are
**generated** by `scripts/assemble-atlas.py` on the same cinematic shell as the MAST page
(`scripts/cinematic_shell.py`, ATLAS blue palette, site menu overlay). Edit the assembler and
re-run it; never hand-edit the output.

**Published 2026-09-05** (Brockmann: "Publish AG preview", after the review links). The eleven pages are now the root-level
files, written by `python3 scripts/assemble-atlas.py --publish` (the default, preview mode, still writes `preview/` if anyone
needs a look without touching the live set; `preview/` is not committed any more). The previous hand-authored builds are
parked as `*-atlas.html` (noindex, canonical to the new page). `LIVE_LINKS` is False: cards and menu go to the new pages.
The pages reach atlasglinn.com through `scripts/wp-upload.sh` (its `PAGES` default carries them) by the Mac's hourly job
or the page workflow; the WordPress pages at the old permalinks (`/about/` …) still exist on the host until he retires them
in WordPress, and whether `index.html` wins over WordPress at `/` is a host setting to confirm on the first upload.
**Copy source (Brockmann, 2026-09-05: "why the content from the actual site and this new site front end are not
matching"):** the rebuild was written from the repo's April 2026 build (now `*-atlas.html`), the only copy a cloud
session can open; it carries that copy nearly word for word (204 of 208 headings, 223 of 235 paragraphs), but the big
chapter titles are the trailer shell's own and the site's headings became the small labels. No cloud session has read
the live WordPress text. Same day, `.github/workflows/capture-live.yml` (a GitHub runner has open internet; the
container does not) reads every page and file URL in `scripts/handoff-urls.txt` and commits them to
`claude/desktop-assets` under `reference/desktop/live/` (pages as `<slug>.html`, files by basename, a `_probe.txt` with
what the host serves at `/`, `/index.html` …), on request (`workflow_dispatch`) and daily; the Mac's handoff writes the
same place. The reconcile against the live copy is done (203 of 204 live headings, 224 of 230 paragraphs; the rest
are the intro menu text, a Senators figure he corrected, and "over 30 years" → decades). The live site's own assets
now count as approved imagery: `images/atlas/matt-ceo-2026.jpg` (the founder portrait the live About page shows),
`images/atlas/anthony-glover.png`, and the theme-folder films in `images/film/` (technology-hero, corporate-buildings,
careers-gallery, forge-legend-mast; plain files, not LFS, served whole because the container has no ffmpeg). The live
Training submenu (IWA Training Products, Aimpoint Optics) points at the MAST Store chapter; the live shop pages are
notify-me catalogs with no checkout. Re-run the capture before any further content pass: `actions_run_trigger`
on `capture-live.yml`, then `git fetch origin claude/desktop-assets` and read `reference/desktop/live/`.
**Brockmann, 2026-09-06: "Add all content as in the old version - just updating the front end to brand match
MASTsolutions."** So: every word, link, form field, footer entry and film of the live page is carried; only the shell
changes. Three live-site inconsistencies he settled the same day: the About portrait is the **MAST portrait**
(`images/team/brockmann.jpg`; the live page's `matt-ceo-2026.jpg` stays unused as `FOUNDER_LIVE`), the current Atlas EP
prices are the ep-app page's (**$19.99 / $49.99 / $149.99 / $199.99 / $5,000+**; the home "Choose Your Plan" names those
six tiers), and the contact address everywhere is **atlasglinn.hq@** (the live ep-app page's `atlas.hq@` was a slip).
`build()` appends the live footer (`FOOT_SITE`: four link groups, badges, rights line) to every page's last
chapter; the contact form is the live field set (the page script joins first/last name and checks the confirm email);
residential and training open on the live hero films. The two deliberate departures: "over 30 years" reads "decades"
(his 2026-09-05 instruction) and the "two sitting U.S. Senators" line is not carried (his 2026-09-04 correction).
`ep-app.html` is generated too since 2026-09-06 (the live `/ep-app/` page word for word: eight capabilities, the
six-layer comms stack, six audiences, six tiers, nine hardware items with the live Amazon links, the access form, the
legal notice; the hand-authored draft it replaced carried 10 of the live page's 42 headings). `signup.html`,
`privacy.html`, `terms.html` and the articles are hand-authored. Rebuilt forms post JSON to the booking Worker's
`POST /contact` (the Atlas EP access form sends its role as the message).

**Imagery rule (Brockmann, 2026-09-04):** an Atlas page uses only what the current
atlasglinn.com page uses in that section (the approved list at the top of
`assemble-atlas.py`). No MAST range photos, nothing from `images/mast/` or `images/gallery/`;
`build()` asserts it. The files are the site's own WordPress uploads, kept under `images/atlas/` by their WordPress names
(handed off from the Mac 2026-09-05). The About portrait is `images/team/brockmann.jpg`, the picture he approved on the
MAST Instructors chapter: the WordPress file named after him is a press-line scene ("This is not my picture from
atlasglinn.com", 2026-09-05), kept only as a backdrop. The imagery rule is moot in live-content mode — the pages carry
the live page's own media at the live page's own URLs — but `build()` still asserts it under `--authored`.

**The root switch — `wp-ops/atlas-static-root.php` (built 2026-09-08, rounds 2 and 3 the same day, NOT deployed).** The web
server hands out real files before WordPress runs, so `/index.html` and `/about.html` already serve the uploaded static
pages; `/` and the section permalinks are still WordPress, because no file is named there. This must-use plugin closes
that on `muplugins_loaded`: an allowlist of fourteen paths — `/` → `index.html` and `/<slug>` → `<slug>.html` for
about, careers, contact, cuas-aerodefense, disaster-recovery, ep-app, executive-protection, residential-protection,
technology, training, uas, privacy, terms — read straight from the docroot and exited. Those are the **14 allowlisted
pages, which is not the uploaded set**: `wp-upload.sh` uploads 17, and the three it sends that are not allowlisted —
`mastsolutions.html`, `mast-capability-statement.html`, `signup.html` — keep answering at their own `.html` names and
nowhere else. Exact and case-sensitive, so it is a prefix of nothing: **`/training` is a page, `/training/shop/` is the
live IWA shop and never matches** (three pinned cases). **The query decides as much as the path:** a page is served
only when the query is empty or every parameter name is a tracking tag (`utm_*`, `fbclid`, `gclid`, `msclkid`,
`ttclid`, `mc_cid`, `mc_eid`, `ref`, `v`) — **any other name is WordPress's**, which is what leaves
`/?wc-ajax=get_refreshed_fragments` (the shop's cart fragments), `/?s=`, `/?rest_route=`, `/?feed=`, `/?p=`,
`/?preview=true`, `/?elementor-preview=` and every other query-var route on `/` working. That is also the escape:
`?wp=1` is the documented one and `?anything=1` does the same. **Two names in that list are generic rather than
vendor-specific** and are worth knowing about: `ref` is the referrer tag half the web uses, and `v` is in the list on
purpose because the go-live probe below is `https://atlasglinn.com/?v=<unix ts>` and it has to reach the plugin past
the edge cache. That generality is the risk in the allowlist — if anything on this site ever reads a `ref` or a `v`
parameter, a static page answers it instead, and `?wp=1` is the escape until the name comes back out of the list.
`/about/` is a 301 to `/about` because the pages' asset links are relative and would 404 one directory down, and **the 301 keeps the query** (`/about/?utm_source=x` →
`/about?utm_source=x`), while `/about/?p=1` never reaches the redirect at all. **The 301 is sent only when the target
page passes the same servability check the serve path runs** (round 3): otherwise a page that is missing, zero-byte or
truncated has its own working WordPress permalink — `/privacy/`, `/careers/` — 301'd to a URL where the plugin falls
through and WordPress renders the slug, which is a loop where the host puts the trailing slash back and a 404 where it
does not. It carries `Cache-Control: public, max-age=300` and the same `Vary`, so a redirect a browser or an edge has
already stored is never more than five minutes out of reach of the two kill switches. A page that is missing, a
symlink, outside the docroot, unreadable, empty, **truncated (no closing `</html>` — the SFTP transfer that died
halfway)**, or whose bytes would leave wrapped in an output buffer that refuses to drop, falls through to WordPress
with one `error_log` line rather than putting a broken 200 or a mis-counted `Content-Length` into the CDN. It writes
nothing — no option, no cron event, no REST route — so removing the file removes the feature. **Deploy is GATED on Brockmann
replying "go"** to the review email (the brain vault's `00-rules/website-go-live-gate.md`: the root switch is a
separate, gated deploy). **Two kill switches:** `define('ATLAS_STATIC_ROOT_DISABLED', true);` in wp-config.php, or —
the one to use, since the saved login is SFTP-only — an empty file named `.atlas-static-root-off` dropped beside the
plugin in mu-plugins. **The header to look for** is `X-Atlas-Static-Root: 1.2.0;file=<name>;b=<first 8 of sha1 of the
plugin file>`; a URL without it is one WordPress answered, and `b=` is what proves a re-upload actually replaced the
bytes (the response's `ETag` is a different digest — the first 8 of sha1 of the page).
`php wp-ops/tests/atlas-static-root-test.php` is the harness (fake docroot, fake `$_SERVER`, 282 pinned cases across
five scenarios, no host and no network). **Guard detection is measured each round, not assumed: 37 mutants — one guard
deleted per mutant — run 2026-09-08, 36 detected.** 35 of them go red as root. The 36th is `is_readable()`, which uid 0
cannot make false (it reads a `chmod 000` file anyway), so the harness prints `SKIP` with that reason rather than a
pass that tests nothing, and the mutant was re-run under uid 65534 where it does go red — that one is an
**environment-only exception, not an untested guard**, and on the host PHP runs unprivileged. The 37th is an
**equivalent mutant**: dropping the `is_string()` type guard in the If-Modified-Since parser changes no result on any
value a request header can carry (10 inputs measured, 0 differing), so there is nothing for a case to detect. Running
the harness costs nothing and cleans up after itself — each child gets its own bounded `error_log` under `ulimit -f`
inside one run directory the runner deletes on the way out, including after it kills a child at the deadline. That is
not decoration: on 2026-09-08 a mutant of this suite spun, logged a notice per iteration to PHP's default unbounded
`error_log`, and put 3.47 GB into the system temp directory before anyone noticed. **CACHE — the deploy is not done
when the file lands.** GoDaddy's WPaaS/Cloudflare layer keeps serving the WordPress `/` it already cached, so `curl -sI https://atlasglinn.com/ | grep -i x-atlas-static-root`
can print **nothing while the plugin is installed and firing correctly**, and nothing purges it on its own:
`atlas-cache-watch` fingerprints the docroot's `*.html` plus `build-manifest.json` and `mast-ping.txt`, so dropping a
file into `mu-plugins` does **not** move the fingerprint and does **not** trip the watcher. So the deploy carries one
more step — re-upload `mast-ping.txt` with a fresh stamp (that moves the fingerprint and the watcher flushes within 15
min) or click Flush Cache in the dashboard — and the verification is **cache-busted URL first**
(`https://atlasglinn.com/?v=<unix ts>`, and `v` is in the tracking allowlist precisely so this probe still reaches the
plugin), **then the plain URL after the flush**. Header on the first and nothing on the second = stale edge cache, not
a broken plugin. **There is no deploy script here on purpose:** once `claude/wp-cache-watch` merges,
`scripts/wp-cache-watch-deploy.sh` is generalised to take a plugin path and sends this file the same way. Go-live
follow-up before the switch flips: the eleven slug pages plus
`privacy`/`terms` still carry `<link rel="canonical">` and `og:url` pointing at their `.html` names (only `index.html`
already says `https://atlasglinn.com/`), so `scripts/assemble-atlas.py` `meta()` — and `sitemap.xml` — want the slug
URLs, or serving `/about` with a canonical of `/about.html` splits the page in search.

## Privacy statement rule (Brockmann, 2026-09-03; repeated 2026-09-05)

`privacy.html` is his text, confirmed 2026-09-03 and carried on both sites. It **never names infrastructure, hosting,
analytics or security tooling** (no Cloudflare, Workers, D1, Supabase, PostHog, GitHub Pages, GoDaddy, no "how we stop
brute force"): "this is an invite to be hacked". Providers that receive a customer's data (payments, email, the app's
SMS) stay named in §8 and §12.3 as he confirmed them. On 2026-09-03 he ordered the security-posture paragraph, the
hosting-logs paragraph, the traffic-analytics bullet and the campaign-tags bullet **deleted**; the 2026-09-04 session
misread the last two as additions and put them back, and he had to say it again. Do not add tooling to the policy
without his words; when he pastes policy text with "Delete" in front, everything in the paste goes, and only the items
he marks as new (the AI section, "We do not run background checks") get added.

## Site consistency rule (Brockmann, 2026-09-04)

"For any card or any function on the site itself, when adding another product or membership, we don't lose the
consistency in the site." Concretely: every card on either site takes the shared hover in `scripts/cinematic_shell.py`
(the `.tile, .tier` rules: 0.45 s transition, 6 px lift) — add a new card class to those two selectors rather than writing
a new hover; a card's own rules set only its colours (membership borders carry the team colour). New chapters take the
shell's `panel` / `eyebrow` / `section-h` / `sub` structure and the chapter nav, HUD and backdrop entries in the assembler;
new booking or checkout pieces go into `mastsolutions-tesla.html` first, so the MAST page lifts them. Gold on the MAST page
lives in `GOLD_KEEP` (spliced after the palette recolor); everything else recolors to blue.

## Definition of done for a site change

A page change is done when the built file has been regenerated, driven in a browser, and seen on the plain live URL —
not when the assembler exits 0. PR #72 (merged 2026-09-07) dropped 96 dialog CSS rules because the CSS lifter swallowed
one-line `@media` queries, and every run after it still exited 0 and still published; PR #83 restored them the next day.
The assembler's asserts are the guard, so add one for each regression rather than relying on the next reader to notice.

1. **Regenerate.** `python3 scripts/assemble-cinematic.py` (or `assemble-atlas.py`). Never hand-edit `mastsolutions.html`
   or `dist/mastsolutions/index.html`; the next run overwrites them. Commit the regenerated files with the source change.
2. **Run the Chromium checklist** against a staging copy outside the repo (`index.html` plus symlinks to `vendor/` and
   `images/`), at 1280x900 and at iPhone 14 Pro: every dialog opens and lands inside the viewport; every chapter has a
   visible Book-a-Class control; no `href="/"` survives in `dist/` (on www.mastsolutions.com `/` is the MAST page itself);
   no request form is a `mailto:`; `scrollWidth === innerWidth` at 393 px; the intro dismisses on a tap; the MENU overlay
   opens below 900 px; zero console errors that are not the aborted Worker fetches.
3. **The publish re-runs the assembler.** `pages-mastsolutions.yml` rebuilds and fails on `git diff --exit-code --
   mastsolutions.html dist/mastsolutions/index.html`, so a hand-edited `dist/` cannot deploy and every assert above runs
   on the way out (`dist/mastsolutions/sitemap.xml` is out of that diff: its `<lastmod>` is today's date).
4. **Check the plain live URL after Pages publishes** — `https://www.mastsolutions.com/`, not only the cache-busted
   `?v=<sha>` one. The `?v=` link proves the origin is right; the plain URL is what a visitor gets, and it is the one
   that has been stale.

## Claude SEO toolchain (vendored)

This repo carries the [Claude SEO](https://github.com/AgriciDaniel/claude-seo)
plugin (v2.2.0, MIT) as project-scope skills so every session — local or
Claude Code on the web — loads it automatically:

- `.claude/skills/` — 31 skills (`seo` orchestrator + 30 sub-skills/extensions)
- `.claude/agents/` — 18 SEO specialist subagents
- `.claude/hooks/setup-seo.sh` — SessionStart bootstrap (venv, browser bridge,
  sandbox-proxy CA trust). Runs in the background on session start; log at
  `.claude/hooks/setup-seo.log`. Re-run manually if needed.

Usage: `/seo audit <url>`, `/seo page <url>`, `/seo technical <url>`, etc. —
full command table in `.claude/skills/seo/SKILL.md`.

Run the Python helpers with the venv interpreter:
`.claude/skills/seo/.venv/bin/python .claude/skills/seo/scripts/<script>.py`
If the venv is missing, run `bash .claude/hooks/setup-seo.sh` first — do not
fall back to system python without the dependencies.

### Local modification

`.claude/skills/seo/scripts/url_safety.py` is patched relative to upstream:
its SSRF guard exempts the hostnames named in `HTTP(S)_PROXY`/`ALL_PROXY` env
vars (see `_trusted_proxy_hosts`). Claude Code web sandboxes force all egress
through a loopback proxy, which the unpatched guard refused, breaking every
fetch. Keep this patch when updating the vendored copy.

### Connector / extension status

| Connector | Status | To finish |
|---|---|---|
| Core skills + agents | ✅ working | — |
| Page fetch / render / screenshot (Playwright) | ✅ working | — |
| Unlighthouse (site-wide Lighthouse, free) | ✅ working | — |
| Google APIs (GSC, PageSpeed, CrUX, GA4, Indexing) | ⏳ needs credentials | Run `/seo google setup` and provide OAuth client / service account / API key; stored at `~/.config/claude-seo/google-api.json` |
| Backlinks free tier (Moz, Bing Webmaster) | ⏳ needs API keys | Run `/seo backlinks setup`; stored at `~/.config/claude-seo/backlinks-api.json` |
| DataForSEO (live SERP/keyword data) | ⏳ needs login | `bash extensions/dataforseo/install.sh` from a claude-seo checkout, with DataForSEO email + password |
| Firecrawl (site crawling MCP) | ⏳ needs API key | `bash extensions/firecrawl/install.sh` with Firecrawl API key |
| Banana / image-gen (Gemini) | ⏳ needs API key | `bash extensions/banana/install.sh` with `GOOGLE_AI_API_KEY` |
| Ahrefs / SE Ranking / Profound / Bing extensions | ⏳ needs API keys | Each `extensions/<name>/install.sh` prompts for its vendor key |

⏳ items are blocked ONLY on secrets the user must supply — never invent or
stub credentials, and never mark them done until the vendor API answers a
real request.

### Claude Code web sandbox caveat

Restricted-network environments allowlist only dev infrastructure (GitHub,
npm, PyPI…). Fetching arbitrary sites — including atlasglinn.com — is blocked
at the egress proxy, so live crawls/audits need a session whose environment
network policy allows general web access. The toolchain itself still loads,
and its test suite runs offline.

## Claude marketing + CRM toolchain (Brockmann, 2026-09-06: "Look at the marketing and CRM - web site GitHub or connectors + Claude options and install")

Surveyed the same day: the website repo, the brain repo's vetted skill packs, the claude.ai connector registry, and the plugin
catalog. What runs where:

| Piece | Status | To finish |
|---|---|---|
| CRM in the Worker (`mast-backend/src/crm.js`: leads, beacon, attribution, profiles, segments, audience CSV, journeys, `/admin`) | ✅ merged, tests pass; **running after the Mac's next Worker deploy** | Flip `JOURNEYS_ENABLED` after he approves the three emails |
| Marketing skills, 29 of them, `.claude/skills/mkt-*` (vendored from the brain's vetted `coreyhaines31/marketingskills`, MIT; see `.claude/skills/MARKETING-SKILLS-NOTICE.md`) | ✅ installed and loaded (the harness lists them); ✅ run once: `/mkt-revops` wrote `mast-backend/MARKETING-PLAYBOOK.md` | — |
| Anthropic `marketing` plugin (brand-review, campaign-plan, email-sequence, performance-report…) and `small-business` plugin (lead-triage, crm-cleanup, run-campaign…) | ✅ enabled on his claude.ai org already | Their MCP servers (HubSpot, Klaviyo, Supermetrics…) connect per tool |
| **HubSpot** connector | installed on his org, **not enabled in this chat**; the Worker's `HUBSPOT_TOKEN` upsert is a no-op until the token is set | Enable in the chat's connector settings; a private-app token → `wrangler secret put HUBSPOT_TOKEN` |
| **Mailchimp**, **Brevo** (both appear in atlasglinn.com's DNS) | Worker adapters built (opt-in gated); connectors not installed | Keys → `wrangler secret put …`; the connectors are optional (campaign drafting from chat) |
| **Stripe**, **Cloudflare** connectors | installed, **need reconnect** | Reconnect in claude.ai → Connectors; Cloudflare reconnected = deploys and Worker secrets from a cloud session, no Mac |
| **Cloudflare token for the runner** (`deploy-worker.yml`) | **2026-09-07: Brockmann said "Cloudflare is in secrets for you to connect" and later "I already gave you the Cloudflare API token. There are more than one token"; two dispatches printed `present: none`** — nothing named `CLOUDFLARE_API_TOKEN` / `CF_API_TOKEN` / `CLOUDFLARE_TOKEN` (or an account id) reached the repository's Actions; the container (started 18:13 UTC that day) had no such env var; the Cloudflare MCP server still asked for auth. **Searched the same day, on his word "memory plus brain plus obsidian plus MD":** the brain vault at its 2026-09-07 07:12 CDT tip (`grep -ri` over every .md/.yml/.json for cloudflare/token), its `_ATLAS-FRONT.md`, `_connectivity-ledger.md`, the September daily notes, `security-posture-2026-08-09.md` ("Cloudflare API token: No") and `feedback_check_keychain_confirm_install.md` ("no existing cloudflared creds found: cloudflared, CF_API_TOKEN, cloudflare-api-token"); this repo; the handoff branch; the session transcripts. No record of a Cloudflare token handed to any session, and no Keychain item name for one. The token exists (his dashboard screenshot: Manage account → Account API tokens) but nothing reachable from a session holds it | The job's notice names the one place that works: Settings → Secrets and variables → Actions → **Repository secrets** → `CLOUDFLARE_API_TOKEN` (account id optional). A Mac session could also save it as a Keychain item (`cloudflare_api_token`) for `wrangler deploy` there. Whichever he chooses, a ledger line goes into the vault's `_connectivity-ledger.md` per its rule |
| PostHog / Resend connectors | not installed; the Worker's own beacon covers the funnel | Optional |
| The old WordPress site | used the theme's `yit-newsletter` (Mailchimp / MailPoet ajax subscribe), WooCommerce, Contact Form 7; the live shop pages post to `wp-json/iwa|aimpoint/v1/subscribe` (notify-me) | Whatever list those built lives in his Mailchimp / Brevo accounts; the CSV export from `/admin` is the way to merge |

Rules: keys never in git (`wrangler secret put` on the Mac, or `WORKER_<NAME>` repository secrets once the Cloudflare
secrets exist); eligibility answers never reach any provider; marketing lists get opted-in addresses only, the CRM (HubSpot)
gets every lead and customer.

## Mac → cloud handoff (the only Terminal command)

Cloud sessions run in a container and cannot see Brockmann's Mac; Cowork and a
Terminal `claude` session can. Files cross that line with **one script and one
command, never OneDrive**: `scripts/mac-handoff.sh` copies files/folders into
`reference/desktop/` on branch `claude/desktop-assets` and pushes them.

- Brockmann, from Terminal (always the same paste):
  `curl -fsSL https://raw.githubusercontent.com/MatthewBrockmann/atlasglinn-website/main/scripts/mac-handoff.sh | bash`
  (append `-s -- <paths or URLs>` to hand off more, on top of the default set;
  videos over 90 MB are compressed on the Mac to fit GitHub, LFS pointers are
  replaced by the real file)
- A Mac session (Cowork / Claude Code CLI): run it itself via `/handoff` or the
  `mac-handoff` skill. Do not hand Brockmann a step the session can run.
- A cloud session: never invent a new paste. Ask for `mac-handoff.sh` by name,
  then `git fetch origin claude/desktop-assets` and read the files from that ref
  (a fetch never touches the working tree): `git ls-tree -r --name-only
  origin/claude/desktop-assets -- reference/desktop` to list, `git show
  origin/claude/desktop-assets:reference/desktop/<file> > <copy>` to read one.
  Never merge the archive branch into a site branch.

Decided by Brockmann 2026-09-03. Mirrored to the brain vault as
`04-resources/agent-memory/reference_mac_handoff_command.md`. Address him as
**Brockmann** in replies.

## Hosting facts (Brockmann, 2026-09-05: "They are sep - i just forwarded atlas from mast - no site")

- **atlasglinn.com** is the GoDaddy Managed WordPress site (SFTP host `1127220.us12.ssh.myftpupload.com`). The MAST page is
  served from it at `atlasglinn.com/mastsolutions.html`; `scripts/wp-upload.sh` puts the page and its 113 assets there over
  SFTP. The login it asks for is **the atlasglinn.com site's** SFTP username and password (GoDaddy → My Products → Managed
  WordPress → Manage → Settings → Production Site → SFTP/SSH). Nobody but Brockmann can read them; they never pass through
  chat or git. He saves them once on the Mac with `bash scripts/wp-upload.sh --save-login` (macOS Keychain item
  `mast-wp-sftp`); after that the upload never asks. The GoDaddy connector in cloud sessions only checks domain
  availability; it cannot reach hosting.
  **Without the Mac (added 2026-09-05, "I won't be able to use terminal commands on the road"):** two GitHub Actions turn a
  merge into a deploy once their repository secrets exist. `.github/workflows/deploy-page.yml` uploads the MAST page and its
  assets over SFTP on every push to main that touches them (secrets `WP_SFTP_USER`, `WP_SFTP_PASSWORD`, the same pair as the
  Keychain item); `.github/workflows/deploy-worker.yml` runs the Worker tests and `wrangler deploy` (secrets
  `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) and pushes any `WORKER_<NAME>` repository secret to the Worker, so a key
  can be rotated from a phone. Without the secrets both jobs stop with a notice; the Mac's hourly upload stays the fallback.
- **The host's cache (probe 2026-09-06):** atlasglinn.com answers through GoDaddy's Cloudflare CDN (`server: cloudflare`; the
  nameservers are GoDaddy's `ns15/ns16.domaincontrol.com`, the A record GoDaddy's `160.153.0.38`, so it is not Brockmann's
  Cloudflare account) and marks the static pages `cache-control: public, max-age=2678400` (31 days). The plain address keeps
  serving the copy an edge cached first: on 2026-09-06 `/mastsolutions.html` was the previous day's build (`age` 77357 s,
  `cf-cache-status: HIT`) while `?x=<ts>` fetched the build uploaded twenty minutes earlier, and two runners saw two different
  copies of `/index.html`. **An upload is live only after Flush Cache** in the site's GoDaddy dashboard (Managed WordPress →
  Manage; the same button sits in wp-admin's top bar; **verified 2026-09-06 15:57 UTC:** after his flush the plain
  `/mastsolutions.html` served that day's upload at `age: 2`, so the flush clears the static files too). `wp-upload.sh` prints the plain and the cache-busted Last-Modified after
  every upload and says so when they differ; the capture probe (`_probe.txt`) records both answers with their headers. A
  cache-control override in the docroot `.htaccess` (WordPress's own file) is untested and is tried only with him.
  **Self-refresh, 2026-09-07 (Brockmann from his phone: "Can't find flush in app. Not on web"):** the flush button is not
  in the GoDaddy phone app, and his 7:06 am flush was undone by the 9:42 am upload anyway. So the pages heal themselves:
  every generated page carries its own content hash (`<meta name="build">`, stamped by `scripts/build_manifest.py` when
  the assemblers write it) and a head script fetches `build-manifest.json?<now>` (never cached) and, when the host's
  hash differs, reloads once to `?v=<hash>` (a URL the CDN has not seen). `wp-upload.sh` and `deploy-page.yml` put the
  manifest on the host last. `_probe.txt` prints `self-refresh: <page> plain build=… manifest=… fresh|stale`. Flush Cache
  is no longer a step in the WIRE; if he wants it anyway, wp-admin's top bar on any browser has the same button.
  **The flush itself is the Mac's now (2026-09-07, "You do actually have GoDaddy access"; the vault says how):**
  `04-resources/agent-memory/project_atlasglinn_wordpress.md` records the WP admin user and its application password in
  the Keychain item `wp_app_password_claude` (rotated 2026-09-03; "REST API works with app password") and that GoDaddy
  clears its cache when WordPress content changes. `scripts/wp-flush.sh` (run by `wp-upload.sh` after every upload)
  saves a private `cache-bust` page over REST with that password (WP-CLI over SSH with the `mast-wp-sftp` login *was*
  the fallback — **measured 2026-09-08 18:46 UTC, that login is SFTP-only and has no shell**, so Method B cannot run
  until SSH is switched on in the dashboard; see the watcher paragraph below), then measures the plain `/mastsolutions.html` against the cache-busted copy and writes
  `~/.cache/wp-upload/last-flush`; `mac-autopilot.sh status` shows it. Wired, NOT confirmed firing until a probe shows
  the plain URL fresh after an upload with no click. Nothing of this reaches a cloud session: the container cannot open
  the host and holds no Keychain.
  **Landed 2026-09-07 18:14 UTC** (the Mac's upload; probe 18:17: manifest on the host, every stamped page current at its
  `?v=`). The copies the CDN cached *before* that upload carry no stamp and no script (plain `/mastsolutions.html` =
  the 11:18 build cached 12:06; `/index.html` = 14:42 cached 15:26), so they cannot heal themselves: **one last flush**
  after 18:14 UTC clears them, and no flush is needed after any later upload. Probe DNS the same run: `mastsolutions.com`
  A → 15.197.225.128 / 3.33.251.168 (GoDaddy's forwarding servers), `www.mastsolutions.com` has **no record**,
  `atlasglinn.com` A 160.153.0.38, `www.atlasglinn.com` CNAME → atlasglinn.com; **neither domain has the Microsoft 365
  `selector1/selector2._domainkey` CNAMEs** (atlasglinn.com's SPF names outlook, Mailchimp `servers.mcsv.net` and Brevo;
  its DMARC is `p=none` reporting to Brevo).
  **The purge moved onto the host, 2026-09-08: `wp-ops/atlas-cache-watch.php`.** The saved login proved SFTP-only at
  18:46 UTC (no shell, so `wp eval-file` never ran) and the application password is not on this Mac, so neither remote
  method in `wp-flush.sh` can reach the cache — but the SFTP upload still lands, and WordPress on the host can see what
  it changed. `scripts/wp-cache-watch-deploy.sh` puts a must-use plugin at
  `html/wp-content/mu-plugins/atlas-cache-watch.php`. There it fingerprints **every `*.html` at the docroot root plus
  `build-manifest.json` and `mast-ping.txt`** (`name:mtime:size`, sha1 — a glob with no recursion; `wp-admin` and
  `wp-includes` are not ours) on a 15-minute WP-Cron tick — the upload cadence — and when the fingerprint moves it runs
  the dashboard button's own cascade: `WPaaS\Cache_V2` `do_ban()` + `flush_cdn()` + `flush_transients()` +
  `flush_object_cache()` through reflection, each step's result recorded, a two-minute lock against a second run (held
  in the cascade helper, so the cron tick and the page-save path share it), and `wp_cache_flush()` with `class=null`
  recorded when no WPaaS class is there (so a reader knows the CDN was *not* purged). The global that names the cache
  class is checked against an EXACT allowlist — `WPaaS\Cache_V2` or `WPaaS\Cache`, never a `WPaaS\` prefix, because
  anything that can write that global can write a WPaaS-namespaced name into it too — before anything is constructed
  from it, and a failing method is recorded as `error:<exception class>:<sha1 prefix>` — never the exception text,
  which on a CDN client can carry a token or a signed URL. `wp-flush.sh`'s own cascade heredoc, which runs the same
  four methods over SSH, carries both of those verbatim (it recorded the raw exception message until 2026-09-08). It
  also fires on `save_post_page` when the saved page's slug is `cache-bust`, which makes `wp-flush.sh`'s Method A real
  the day the application password is back.
  **Why no endpoint:** a token-protected REST route was considered and rejected — it would add a remote-control surface
  to a production site for a job that needs no caller. **The plugin adds no route of its own.** Its only remote
  reachability is stock WordPress `/wp-cron.php`, which any caller can already hit: that can advance the tick, but it
  cannot make it purge — the tick acts only when the docroot fingerprint has moved, and the fingerprint is read off the
  filesystem, never from anything a caller sends. **What it writes:** two options (`atlas_cache_watch_fp`,
  `atlas_cache_watch_last`, both `autoload=no`) plus a two-minute lock transient, and **one `error_log` line per purge**
  carrying counts and a 0/1 — not "writes nothing". No admin UI, no file writes, no requests of its own.
  **How it is seen from outside:** front-end answers carry
  `X-Atlas-Cache-Watch: <version>;b=<build>;age=<fresh|hour|day|old|never>;cdn=<ok|no|none>;fp=<0|1>;tick=<fresh|hour|day|old|never>`,
  so `curl -sI "https://www.atlasglinn.com/?atlas-watch=$(date +%s)"` says whether it is deployed and healthy — the
  query string matters, because a cached answer never runs a line of PHP and carries no header. `b` is the first 8 of
  the file's own sha1, so a deploy can prove the bytes running are the bytes it sent; `age` is the last purge and
  `tick` the last cron tick, in coarse buckets with no raw timestamp on a public response. **`fp=0;tick=never` means
  WP-Cron is not running it; `fp=1;tick=fresh` means healthy and idle.** `wp-flush.sh` prints that line on every run and
  says so plainly when the tick is stale; `wp-upload.sh` says the purge is coming.
  **The deploy fails closed** (rounds 3–5, tested): **sftp does not report per-command failure for a batch arriving on
  stdin** — OpenSSH aborts on a failed `put`/`rm` only under `-b`, and `-b` sets BatchMode, which refuses the Keychain
  askpass — so the session's exit code and its text are printed as an ADVISORY and decide nothing. **The served
  fingerprint is the proof:** the run requires the `b=<sha1-8>` the host publishes to equal the sha1 of the file it
  just sent, one retry after 15 s, then a non-zero exit with the SERVED value in the heartbeat (a same-version copy
  already on the host used to pass). **A header is only READ off a whole answer (round 5), and the rule that refused a
  claim is printed:** curl's exit code is captured and a non-zero one — `--max-redirs` exhausted (47), a timeout, a
  reset mid-chain — means **no header from that dump is parsed at all**, because curl has already printed the hops it
  followed and one of them can carry the exact fingerprint just uploaded; the status is taken **only** from curl's own
  tagged `ATLAS_HTTP_CODE:<3 digits>` write-out line (a bare `%{http_code}` tail let a header line's digits stand in as
  the status when curl printed no write-out) or the code is `000` and the read is refused; and the **FINAL block must
  be a 200** — a 3xx there is a truncated chain, and a header on any other status is not a page a reader was served.
  **`--remove` is proven by a second sftp session running a bare `ls` on the remote path — and only when that session
  PROVES it reached the host and NAMES the path** (round 4): the capture must carry the `sftp> ls` echo OpenSSH writes
  for a command read off stdin, the session must exit 0, and a line must be **sftp's own** answer — anchored on its
  `Can't ls: `/`ls: ` prefix — saying that *this* file is not found. **Round 5 tightened three things there:** a line
  LISTING the file **wins, and is read before any "gone" text** (one session can carry both a banner saying "not
  found" and the listing itself, and the listing is the fact); the name is matched **exactly**, bounded by
  start/whitespace/quote/slash on the left and quote/whitespace/end on the right, so `atlas-cache-watch.php.bak` and
  `old-atlas-cache-watch.php` are other files (a substring match claimed a removal off a neighbour's absence); and the
  capture is **stripped of carriage returns** before it is classified. The path listed back is `rm-failed`;
  **everything else is `rm-unknown` and exits non-zero** — a session that never connected, a login banner or a shell's
  own `command not found` that merely contains the words "not found", a subsystem or auth failure, a "not found" about
  another path, a non-zero exit. Searching the whole session for "not found" first (what round 3 did) meant a Mac with
  no `sftp` binary reported a successful removal, so `sftp` is now a preflight check beside the Keychain one; an
  unknown argument aborts instead of meaning "install", and the argument **COUNT** is checked before the value, so
  `--remove --install` dies before anything is sent instead of silently acting on the first word.
  The header is advisory only there, because the plugin stops sending it whenever
  `ATLAS_CACHE_WATCH_DISABLED`/`_UNINSTALL` is defined, so header-absence would report a removal that never happened.
  Every abort before the verdict stamps `aborted-<reason>` over the heartbeat, the probe follows redirects and reads
  the header from the **FINAL response block of the `-D -` chain** (a header on a 301 hop is the hop's, and crediting
  it would report a deploy from a response no reader sees), and there is no download fallback — the file always comes
  from the checkout the script runs in.
  **How to disable:** `define('ATLAS_CACHE_WATCH_DISABLED', true);` in `wp-config.php`, or
  `bash scripts/wp-cache-watch-deploy.sh --remove`. **`--remove` deletes the file but leaves the two options and the
  cron event** — a must-use plugin gets no uninstall hook. To clear those, set
  `define('ATLAS_CACHE_WATCH_UNINSTALL', true);` and load one page: the plugin then deletes both options, drops the
  lock, unschedules the tick and does nothing else. Heartbeat: `~/.cache/wp-upload/last-watch-deploy`.
  **Tests:** `php wp-ops/tests/atlas-cache-watch-test.php` (stub WordPress + stub `WPaaS\Cache_V2`, 6 scenarios, 106
  assertions) and `bash scripts/tests/wp-cache-watch-deploy-test.sh` (stub sftp/curl/security/shasum/sleep, no host
  touched, 175 cases). Every gate above is pinned by a scenario, not by a grep of the script's own source: round 5
  replaced the six `wire/*` text checks with cases only a working gate survives, and each was proved by breaking that
  gate in a scratch copy and watching the case fail (drop the listed-wins ordering and a session that lists the file
  reports `removed`, 3 cases fail; drop the argument-count check and `--remove --install` deletes the file and exits 0,
  5 cases fail; drop the exact-basename match and a `.bak` neighbour reads as `removed`, 4 cases fail). The
  aborted-chain rc gate is defence-in-depth: with real curl an aborted `-L` chain ends on a 3xx block, which the
  truncated-chain rule already refuses, so removing the rc gate alone changes no verdict — its case pins the rule NAME
  it prints, not a verdict (round-5 verifier, measured). Both carry pinned counts — a scenario that dies after
  its first assertion used to report green —
  and both run in CI on `wp-ops/**`, `scripts/wp-*.sh` or `scripts/tests/**` (`.github/workflows/wp-ops-tests.yml`,
  no secrets; the job's Syntax step is `bash -n "$s" || exit 1`, because `bash -e` does not fail on the left side of an
  `&&`, and it must NOT be made a required check while those paths filters exist — a PR that misses them never starts
  it and the context would hang pending).
  **Merged, NOT deployed:** the plugin is in the repo and nothing is on the host until the deploy script runs from the
  Mac; the header is what proves it.
- **mastsolutions.com** has no site *yet*: it is a GoDaddy domain forward to atlasglinn.com, pointed at
  `https://atlasglinn.com/mastsolutions.html` (set 2026-09-05). It still carries DNS: Resend verifies it so the Worker can send as
  bookings@mastsolutions.com, beside the existing matthew@mastsolutions.com mail.
  **2026-09-07 (his host.godaddy.com screenshot + "when I use www.mastsolutions.com it should be that url not -
  atlasglinn/ … You have access to WordPress and GoDaddy. Fix"):** he also owns a GoDaddy **Linux / cPanel hosting**
  account whose *primary domain is mastsolutions.com* and which lists atlasglinn.com too (its DKIM table shows both,
  "Enable" on each; the cPanel username is in his screenshot and deliberately not written here). **What access exists,
  measured 2026-09-07 against the brain vault (tip 7c111da), this repo, the handoff branch, the transcripts and this
  container:** (1) WordPress on atlasglinn.com — a *Mac* session has it: the admin application password in the Keychain
  item `wp_app_password_claude` and the SFTP/SSH login `mast-wp-sftp` (`project_atlasglinn_wordpress.md`; WP-CLI over
  SSH; REST works). **Corrected 2026-09-08 18:46 UTC — neither half of that survived the migration to
  `1127220.us12.ssh.myftpupload.com`:** `mast-wp-sftp` answers "This service allows sftp connections only." (no shell,
  so no WP-CLI) and `wp_app_password_claude` is **not** in this Mac's Keychain, so the REST path has no password to
  use. SFTP is the whole of the Mac's WordPress access today; SSH is Brockmann's switch in the GoDaddy dashboard. (2) GoDaddy — the API key pair `godaddy_api_key` / `godaddy_api_secret` lived in the Keychain in
  April 2026 (DNS via curl, `project_atlas_ep_open_threads_2026_04_27.md`) and went with the **2026-05-04 Keychain
  wipe** (`project_session_2026_05_04_keychain_wipe.md`); the 2026-07-04 daily, `_daily-scan-log.md:251` and
  `_tooling-requirements.md` all record "no GoDaddy API credential in Keychain" since. The cloud connector only checks
  domain availability. (3) cPanel — the word appears **nowhere** in the vault, this repo or any transcript; the account in
  his screenshot is new to every session. (4) The container cannot open atlasglinn.com, host.godaddy.com,
  api.godaddy.com or api.cloudflare.com (egress 000). So: WordPress yes, from the Mac but **over SFTP only** (`scripts/wp-upload.sh`, `scripts/wp-cache-watch-deploy.sh`;
  `scripts/wp-flush.sh` measures and reports, and its two remote methods are both blocked until SSH is enabled or the
  application password is back);
  GoDaddy DNS no, until a key pair is minted again (his browser, developer.godaddy.com; his account must still qualify
  for the Domains API) and saved as those two Keychain items; cPanel no, until its login exists somewhere a runner or the
  Mac can read. **The route that needs no login at all — GitHub Pages (2026-09-07 18:29 UTC, first run of
  `.github/workflows/pages-mastsolutions.yml`):** the runner deployed `dist/mastsolutions/` (index.html, manifest, the
  asset tree) to this repository's Pages site with its own token — deploy reported success. Two facts from that run:
  the repository *already had* a Pages site whose custom domain is **atlasglinn.com** (`cname=atlasglinn.com`,
  `status=built`; the root `CNAME` file is its trace — harmless today because atlasglinn.com's DNS points at GoDaddy,
  not GitHub, and GitHub only serves a domain whose DNS reaches it), and the workflow token **cannot change the custom
  domain** (PUT /pages → 403; a `CNAME` file in an Actions artifact is ignored). So the Pages site now holds the MAST page
  under the wrong name until one field changes by hand: **Settings → Pages → Custom domain → `mastsolutions.com`** (that
  also stops the site claiming atlasglinn.com). Order: that field first, then the GoDaddy DNS rows (four `A @` to
  185.199.108.153 / .109 / .110 / .111, `CNAME www → matthewbrockmann.github.io`, forward removed); GitHub issues the
  certificate within the hour and "Enforce HTTPS" can be ticked after. Every later merge that touches
  `dist/mastsolutions/` republishes on its own. **His taps, 2026-09-07 (from the phone, on the road):** the "Parked" A
  record had already become two `A @` rows `15.197.225.128` / `3.33.251.168` with the pencil greyed — those are
  GoDaddy's **Forwarding-managed** records, not editable while a forward exists; he deleted the forward ("FW deleted"),
  added the four A rows and the www CNAME and said the Pages field was done. **Runner probe 18:45 UTC (smoke #16 +
  Pages #2):** ns27 answers six `A @` — the four GitHub rows **plus the two forwarding rows, which deleting the forward
  did not remove** (they must be deleted by hand now that the forward is gone; with them present one request in three
  lands on GoDaddy's forwarder); `www` CNAME correct; the Pages site still `cname=atlasglinn.com` (the field was not
  saved at that minute; his phone message came before the probe); `https://mastsolutions.com/` unreachable (no
  certificate until the field holds the name). Same probe: the apex SPF of mastsolutions.com reads `v=spf1
  include:secureserver.net -all` — the Microsoft include verified on 2026-09-06 18:25 (LAUNCH-LEDGER) is **gone**, so
  M365 mail from @mastsolutions.com hard-fails SPF until the row reads `v=spf1 include:spf.protection.outlook.com -all`
  again; and `send.mastsolutions.com` has **no** SPF TXT (only GoDaddy's Domain-Connect artefact
  `dc-fd741b8612._spfm.send`, which nothing references) — Resend's row is `TXT send → v=spf1 include:amazonses.com
  ~all`. Both are one-row edits on the same GoDaddy DNS page; re-probe with `smoke-worker.yml`. (atlasglinn.com's own
  SPF, same probe: `include:servers.mcsv.net include:spf.brevo.com include:secureserver.net ~all` — no Microsoft
  include there either, softfail; the same `include:spf.protection.outlook.com` belongs in it.) **Re-probed 19:13 UTC
  (smoke #17, Pages #3, capture #19): unchanged** — six `A @`, Pages still `cname=atlasglinn.com`, both mastsolutions
  URLs unreachable; Worker `build: c5132f7`, `directions: sealed`, CRM live; no page upload since 18:14 (nothing
  page-side changed on main), so the plain `/mastsolutions.html` and `/index.html` are still the 11:18 / 14:42 cached
  copies and the Mac flush has had no upload to run after — not yet observed. **Probe 2026-09-08 00:34 UTC (smoke #18,
  Pages #4, capture #20, deploy-worker #30):** DNS, Pages field and SPF rows unchanged (he was driving); Worker
  `build: 5580986` = main's tip, deployed by the Mac; deploy-worker's Deploy step still skipped (no
  `CLOUDFLARE_API_TOKEN` in the repository secrets). **The Mac uploaded at 23:50:22 UTC with no click from him**
  (`mast-ping`), which is the first upload `wp-flush.sh` could have followed — and the plain `/mastsolutions.html` /
  `/index.html` at the edge the runner hit were **still stale** (`HIT`, the 12:26 and 15:51 builds, no `<meta
  name="build">`, so no self-heal). So the automatic flush is NOT confirmed: either the REST save did not purge the
  static files or it did not run; only the Mac's `~/.cache/wp-upload/last-flush` heartbeat can say which, and he has no
  laptop on the road. Until then the visible copies of both pages are a day old for anyone whose edge cached them; the
  one-tap fallback from a phone is wp-admin's top bar → Flush Cache (`https://www.atlasglinn.com/wp-admin/`), which
  the GoDaddy app and dashboard do not show him. **LIVE 2026-09-08 04:16 UTC (Pages run #6):** his taps on the
  phone: the two forwarding A rows could not be deleted (grey trash with a "?" even after the forward was gone), so
  the plan flipped to the www host: Forwarding `mastsolutions.com → https://www.mastsolutions.com` (301), the four
  185.199 A rows removed, `CNAME www → matthewbrockmann.github.io` kept, GitHub custom domain **www.mastsolutions.com**
  (GitHub committed it to the root `CNAME` at 04:02 UTC). Runner: `Pages: https://www.mastsolutions.com/
  cname=www.mastsolutions.com status=built https=True`; `https://mastsolutions.com/ → 301 https://www.mastsolutions.com/`;
  `https://www.mastsolutions.com/ → 200 title=[MAST Solutions | Details Matter | Tactical Training, Houston TX]`. So
  the MAST page is served at its own address with a certificate; the Pages workflow's DOMAIN is now
  `www.mastsolutions.com` and its guidance names the forward + www CNAME. The follow-up was done in the same pass:
  canonical, og:url and JSON-LD url of **both** copies read `https://www.mastsolutions.com/` (the atlasglinn.com copy
  stays online and points at the domain). **Flush, same probe:** the Mac uploaded again at 04:11 UTC with no click
  and the plain `/mastsolutions.html` / `/index.html` were still the 12:26 / 15:51 copies — two uploads, two REST
  flushes, nothing purged: the private-page save does not clear static files. `wp-flush.sh` now re-measures after the
  REST save and runs the WP-CLI path over SSH when the plain URL is still stale (#71); confirmed only when a probe
  reads fresh. What was
  built for the cPanel path (kept as the alternative; unused while Pages serves):
  `python3 scripts/assemble-cinematic.py` now also writes `dist/mastsolutions/index.html` (+ its `build-manifest.json`):
  the MAST page with canonical / og:url / JSON-LD url `https://mastsolutions.com/`, self-links `/`, Atlas links absolute
  to atlasglinn.com, assets relative; `.github/workflows/deploy-mastsolutions.yml` uploads it and the asset tree into
  that cPanel account's document root over SFTP, enables cPanel DKIM for both domains through the UAPI, and prints the
  cPanel IP against the current A records — once **three repository secrets** exist: `CPANEL_HOST`, `CPANEL_USER`,
  `CPANEL_PASSWORD`. `ALLOWED_ORIGINS` carries `https://www.mastsolutions.com` since the same day. **Still his hand:**
  the DNS (GoDaddy → Domains → mastsolutions.com → DNS: remove the forward, `A @ → <cPanel IP>`, `CNAME www →
  mastsolutions.com`; www has no record at all today) and Microsoft 365 DKIM — the smoke DNS shows *no*
  `selector1/selector2._domainkey` CNAMEs on mastsolutions.com, so M365 mail from @mastsolutions.com carries no DKIM;
  that is switched on in the M365 admin center (Defender → Email authentication → DKIM), which hands back the two
  CNAMEs for GoDaddy DNS. cPanel's "Enable" only signs mail the cPanel server itself sends. **2026-09-08 (Brockmann:
  "Enabled = NO CNAMES = u did NOT ASK FOR WHEN I ENABLED"):** the rows are now derived by `smoke-worker.yml` instead
  of asked for (block "Microsoft 365 DKIM rows" in `_worker-smoke.txt`). Exchange's public GetFederationInformation
  answers 200 but lists no domains any more, so the tenant name comes from guess-and-verify (a guess counts only when
  Microsoft publishes a DKIM key under it). **atlasglinn.com = tenant `atlasglinncom.onmicrosoft.com`** (verified 03:32
  UTC): GoDaddy rows `CNAME selector1._domainkey → selector1-atlasglinn-com._domainkey.atlasglinncom.onmicrosoft.com`
  and `CNAME selector2._domainkey → selector2-atlasglinn-com._domainkey.atlasglinncom.onmicrosoft.com` (selector1's
  key is published, selector2's not yet); then Defender → DKIM → atlasglinn.com → Enable. **mastsolutions.com** is the
  other tenant and none of the guesses (`mastsolutions`, `mastsolutionsllc`, `mastsolutionscom`) carries a key, so its
  two rows are read from that tenant's Defender DKIM flyout (security.microsoft.com → Email & collaboration → Policies
  & rules → Threat policies → Email authentication settings → DKIM → mastsolutions.com). Sent to him 03:35 UTC with the
  rest of the phone-sized list (SPF one-row edit, the two leftover A rows, Pages Source → GitHub Actions, the Cloudflare
  token path from his own dashboard, the g.page link origin); the session transcript and this file went to him as
  attachments on his "SEND MD and FULL TRANSCRIPT" (export: `/tmp/…/scratchpad/transcript-session_….md`, 129
  messages, from the session's JSONL).
- An earlier session put HTML straight into WordPress (`wp-content/themes/atlasglinn/ep-trailer.html`) from a Mac session
  with the WordPress admin. A cloud session cannot: the container has no route to atlasglinn.com and holds no credentials.
  The static page + Worker + SFTP path replaced `mast-wp-theme/`.

- **robots.txt + sitemap.xml on www.mastsolutions.com (2026-09-08):** the root `robots.txt` / `sitemap.xml` are
  atlasglinn.com's and are not staged for the Pages site, so `https://www.mastsolutions.com/robots.txt` was a 404 and
  Search Console had no sitemap to take. `scripts/assemble-cinematic.py` now writes `dist/mastsolutions/robots.txt`
  (same crawler allow-list as the root file, `Sitemap: https://www.mastsolutions.com/sitemap.xml`) and
  `dist/mastsolutions/sitemap.xml` (the one URL, `lastmod` = build date), and `pages-mastsolutions.yml` stages both
  (fails the run if either is missing). Search Console: property `mastsolutions.com` (Domain, TXT verification —
  never the GoDaddy "Domain Connect" authorization, its Gmail Setup rewrites MX) → Sitemaps → add
  `https://www.mastsolutions.com/sitemap.xml` → URL inspection → Request indexing for `https://www.mastsolutions.com/`.

## atlasglinn.com → his own Cloudflare account (R3′, workflow `cf-zone-atlasglinn.yml`)

- **Why there is a workflow at all.** R3 in the vault — "a Cloudflare WAF rate-limit rule on `/wp-login.php`, ~2 min in
  the dashboard" — was re-listed for 107 days and was never executable: the Cloudflare edge in front of atlasglinn.com is
  GoDaddy's (nameservers `ns15/ns16.domaincontrol.com`), so the zone is not in his account and the rule had nowhere to
  land. R3′ is the prerequisite — create the zone in HIS account, prove the record import, then move the nameservers.
- **NOT DISPATCHABLE UNTIL IT IS ON `main`.** GitHub does not register a `workflow_dispatch` workflow that is absent
  from the default branch — measured 2026-09-09: `GET /repos/MatthewBrockmann/atlasglinn-website/actions/workflows/
  cf-zone-atlasglinn.yml` answers **404**, and the workflows list returns 12 without it. So it cannot be run from the
  Actions UI or the API while it sits on a branch. Merging is the step that makes it exist; nothing before that is a
  "dispatch it and see."
- **`.github/workflows/cf-zone-atlasglinn.yml`, Actions → Run workflow. Two modes:**
  - **plan** (default, and it never writes) — verifies the token, probes whether it can see zones at all, and either
    reports what a create would do or, if the zone already exists, runs the full assertion set against it.
  - **create** — `POST /zones` with `jump_start: true` (Cloudflare scans GoDaddy's DNS and imports what it finds),
    polls the imported set until the count settles, then ASSERTS. An existing zone is reused, never duplicated.
  - Inputs: `domain` (default `atlasglinn.com`, regex-validated before it is echoed anywhere), `add_missing` (default
    false — the only record it will ever create is `A tak → 142.93.177.0`, unproxied, **and only when no A record
    exists at that name**), and `allow_other_mx` (default false — see the mail gate below).
- **The gate, and it is the whole point of the run.** The run FAILS with "do NOT switch nameservers" unless ALL of
  these hold: **every** apex MX row targeting Microsoft 365, `tak.atlasglinn.com` present at the expected address, an
  **A/AAAA/CNAME** on the apex, an **A/AAAA/CNAME** on `www`, the import settled before the deadline, and the record
  page not truncated. Company mail (matthew@atlasglinn.com, M365) does not migrate with the site, and a switch made
  before the MX is confirmed takes email down — a stale GoDaddy scan importing a wrong-but-present MX is the realistic
  way that happens, which is why "MX present" is no longer enough on its own. If the mail route genuinely is not M365,
  that is a business fact only he holds: re-dispatch with `allow_other_mx = true` and the run says so in the closing
  text instead of claiming mail is safe.
- **ANY is not ALL, and A/AAAA/CNAME is not "a record" — both gates were one measurement short.** The mail gate asked
  whether ANY apex MX was M365 and then printed "the apex MX records were confirmed present AND targeting Microsoft
  365" — plural, and false for the other row, on the realistic GoDaddy-to-M365 leftover of one M365 MX beside one stale
  registrar MX. It now fails on **any** non-M365 row unless `allow_other_mx` is ticked, and when it is ticked the
  closing sentence names the count: "1 of the 2 apex MX records target Microsoft 365 and 1 do NOT". Separately the
  `www` check asked only whether a record with that NAME existed — a **TXT at www satisfied it**, the run printed the
  nameservers, and www would have stopped resolving on the switch. Both names are now typed. Scenarios `mx_mixed`,
  `mx_mixed_allowed`, `www_txt_only` and `apex_txt_only` hold all of it down.
- **NO WARNING SURVIVES IN THAT FILE — every risk is fatal.** The first draft printed a caution and then printed
  "Import verified" plus the nameservers to paste, in the same log, on two paths (an import still moving at the 90 s
  deadline, and a missing `www`). The last step is now gated on a `verified` output that only the assertion step can
  set, only after every check passed, and only in create mode — so **the nameservers print only after a green create
  run**, and a red run has nothing to paste. That sentence is now true of the code, not just of this file.
- **The log is PUBLIC, so no DNS record value is ever printed.** MatthewBrockmann/atlasglinn-website is a public repo
  (measured 2026-09-09: the API answers `"private": false`) and Actions logs on a public repo are world-readable with
  no account. The run prints a record's **name, type, proxied and ttl** and a **pass/fail per assertion** — never
  content. `tak` reads "matches the expected address" / "exists with a DIFFERENT address — stop" / "missing"; MX reads
  "MX present (N) — targeting Microsoft 365: M of N". A record's content is the WordPress origin address once the site
  is proxied, i.e. exactly what the WAF rule this unlocks exists to hide. Deleting a run afterwards is not a fix —
  treat a run on a public repo as a publication. Accepted with eyes open: record NAMES are printed (a subdomain list),
  because a bare count cannot tell him which record failed; and `tak.atlasglinn.com → 142.93.177.0` is **public DNS
  today**, resolvable by anyone who asks, so the expected address is a constant in the file — it is an expectation,
  never a value read back from the API.
- **The error channel prints Cloudflare's numeric codes and never its message text.** "No record value is printed, not
  even in an error" was an absolute claim over text this workflow does not control: Cloudflare's own
  `errors[].message` was echoed verbatim at three places, and "an identical record already exists: A tak.<dom> →
  <address>" is a real shape for it. Every failure path now builds its sentence from names, types, counts and the
  numeric error code — the message string is dropped, with the code and a pointer to read the full text in the
  Cloudflare dashboard instead. The canary sweep was blind to this whole channel because every error body the emulator
  served carried fixed text; it now serves a canary **inside** `errors[].message` on three FAILING scenarios
  (`err_leak_token`, `err_leak_create`, `err_leak_tak`), so the sweep covers the error limb and not only the table.
- **Token — mint it for the run, delete it at Cloudflare after the switch.** The create needs an **account-scoped**
  `Zone:Zone:Edit + Zone:DNS:Edit` token (Cloudflare cannot scope a token to a zone that does not exist yet), stored as
  `CF_ZONE_TOKEN`; the workflow falls back to the Workers token `deploy-worker.yml` uses only so it can measure the
  scope and fail with one sentence saying it is the wrong shape. That token can edit DNS for **every zone in the
  account**, and it would sit in a public repo alongside an active agent-PR flow — so it is **never left as a standing
  repository secret**. After the nameservers are switched: Cloudflare → My Profile → API Tokens → Delete. **Removing
  the GitHub secret does not revoke it.** Follow-up work (the WAF rule) uses a token scoped to the one zone, which is
  possible once the zone exists. The token value is never printed or written to a step output; the account id is masked.
- **DNSSEC stays OFF at GoDaddy** (measured `unsigned` 2026-09-02). Signing there and then moving nameservers takes the
  domain dark until the DS record expires out of the registry, and it is not the attack vector — brute force is.
- **It is tested, and the false-success paths are the tests.** `scripts/tests/cf-zone-test.sh` extracts that
  workflow's own `run:` blocks with PyYAML and executes those exact bytes against `scripts/tests/cf-zone-emu.py`, a
  canned Cloudflare on localhost, because every call in the file goes through `$CF_API_BASE`. **118 assertions across
  26 cases** — workers-scoped token, dead token, account-owned token, zone exists, create success, a create refused
  with Cloudflare 1061 (reuse, never a second POST), import growing at the deadline, missing www, a TXT-only www, a
  TXT-only apex, MX not M365 with and without `allow_other_mx`, a mixed M365-plus-other MX set with and without it,
  tak mismatch, tak missing with and without `add_missing`, a 500 on the by-name lookup, a truncated page, no
  nameservers assigned, one nameserver where GoDaddy's form needs two, three canary-in-error-body cases, and a domain
  input carrying a `::stop-commands::` injection. The canary sweep runs over the log, the step summary **and** the step
  outputs of **every case that ran** — failing ones included — and it fails if a case ran that the sweep did not reach.
  The case count is pinned to the exact number (it was a floor with 18 assertions of slack), and the source-level
  invariants — no `::warning::`, no hardcoded API host, no AND-list under `set -e`, no `errors[].message` echo, the tak
  classifier on non-default exit codes, the `www` gate typed — each always emit a verdict rather than being skippable.
  CI job `cf-zone` in `wp-ops-tests.yml` runs it on every PR touching the workflow or the harness.
- **Nothing here has run against Cloudflare yet** — the container that wrote it has no route to `api.cloudflare.com`
  (egress 000). Every branch is proved against the emulator, which is not Cloudflare; the first green dispatch after
  the merge is the proof.

## Drop folders → gallery (Brockmann, 2026-09-05: "anytime I drop new items into the folder on my desktop, it should update in and add photos to the gallery")

- **Mac:** `~/Desktop/MAST NEW WEB 2026/gallery/` and `…/range/` are the drop folders — and since 2026-09-09
  `~/Desktop/MAST Solutions Web 2026/` beside it, the name he says aloud; both are handed off and the handoff branch keeps
  them apart as `mast-new-web-2026/` and `mast-solutions-web-2026/`. Files dropped at the top level of either folder count
  too. **The real-time watcher needed a re-install to see the second folder** — the `WatchPaths` array and the `mkdir` are
  written by `mac-autopilot.sh install` only, while the hourly job (which does sweep both) is the part that self-updates
  from `main`. Since 2026-09-09 the hourly pass repairs it: it makes both folders, and if the installed
  `com.atlasglinn.handoff` plist does not name every watched path it rewrites the plist and `launchctl bootout`/
  `bootstrap`s it, logging the folders it was not watching. Idempotent and silent when the plist is already right, so no
  paste is needed after this reaches `main`. `scripts/mac-autopilot.sh install`
  (paste: `curl -fsSL https://raw.githubusercontent.com/MatthewBrockmann/atlasglinn-website/main/scripts/mac-autopilot.sh |
  bash -s -- install`, after `wp-upload.sh --save-login`) puts two LaunchAgents on the Mac. **The hourly job runs from a
  private clone at `~/Library/Caches/atlasglinn/atlasglinn-website`, never from the Desktop clone:** the Desktop is
  iCloud-synced and iCloud evicts git objects ("mmap failed: Resource deadlock avoided", "bad object", 2026-09-05), which
  is why the first install never uploaded. `wp-upload.sh` falls back to that private clone on its own whenever the clone it
  was given cannot fetch. The agents: a watcher that hands the two
  folders off to `claude/desktop-assets` on every change (`mac-handoff.sh` web-sizes photographs to 2000 px JPEG and makes a
  poster beside every clip), and an hourly `wp-upload.sh --if-changed` that uploads the page whenever main moved and, first, runs `wrangler deploy`
  from the clone whenever `mast-backend/` moved (added 2026-09-05, "Do it yourself or figure out an easier way": with the
  Mac on, a merge becomes a running Worker and page within the hour, no paste; the LaunchAgent pulls main and runs the
  script from the clone, so script changes reach it on their own).
  `status` shows loaded state and logs; `kick` runs both now. Mac-local by physics: a cloud session cannot install, see or
  confirm them ("wired, NOT confirmed firing" until a drop is seen to land).
  **Poor-connection lesson (2026-09-06, on the road):** his `status` showed `last uploaded page: none` with "curl 56 Recv
  failure: Operation timed out" / "early EOF" — the clone could not pull the 56 MB of new objects (a 44 MB disaster film
  among them). main's tree is ~230 MB, so a fresh clone is never the fix. Now: `mac-autopilot.sh` and `wp-upload.sh` pull
  with `--filter=blob:limit=10m` (films over 10 MB stay on GitHub until a checkout needs one) and retry once over HTTP/1.1
  with a slow-link timeout; the hourly LaunchAgent fetches `mac-autopilot.sh` from raw main each run and runs its `hourly`
  command, so script fixes reach the Mac without a paste; `.github/workflows/shrink-films.yml` re-encodes any film over
  10 MB on a runner (720p, crf 30, muted) and commits it to main. The handoff agent now runs from the private clone too
  (the Desktop clone is iCloud-broken). `mac-handoff.sh` (same day) fetches the handoff branch blobless and one commit
  deep (about 3 MB instead of the 1.1 GB tip tree), opens the worktree with an empty sparse pattern (nothing
  materialised), checks what the branch holds through `git ls-tree` (`on_branch` / `branch_has`, trees only) and adds
  with `git add --sparse`; a file already on the branch under its name is not copied or downloaded again
  (`HANDOFF_REFRESH=1` forces URLs; rename a changed photograph to resend it). Mechanics verified in the container
  against the real branch: fetch 1 s / 3 MB, add + commit + identical-file no-op all pass; on the Mac it is wired, NOT
  confirmed firing until a drop is seen to land. The permanent road fix is the GitHub page upload: enter `WP_SFTP_USER`
  / `WP_SFTP_PASSWORD` exactly as the Keychain item holds them.
  **Resumable upload (2026-09-06, hotel Wi-Fi):** his log showed "Connection closed by remote host … Broken pipe" at
  file 90 of the single sftp batch, and the next hour started again from file 1, so the pages (first in the list) always
  landed and the assets at the end never did. `wp-upload.sh` now lists the host's sizes (`ls -ln` per directory), sends
  only files missing or of another size (pages always), in batches of ten files, each its own sftp session with three
  tries and keepalives, then lists again and prints what is still not there. A run that dies costs one batch; the next
  run resumes. The GitHub-Actions upload (`deploy-page.yml`) carries its own copy of the single batch; a runner's
  connection is steady, so it keeps it.
  **Shared-clone race (2026-09-06):** both LaunchAgents run in the one private clone, and `kick` starts them together. Each
  used `FETCH_HEAD` after its own fetch, so the other agent's fetch could land in between: his status showed "Worker
  deployed from 70170fc" (a handoff-branch commit; the page worktree would have been that branch's old tree) and every
  kick's hand-off ended "! [rejected] non-fast-forward" because it had been built on main's tip. Now `wp-upload.sh` fetches
  into and reads `refs/remotes/origin/main` and `mac-handoff.sh` into `refs/handoff/<branch>`; neither touches
  `FETCH_HEAD` again. Rule for any new script in that clone: name the ref you fetch into, never read `FETCH_HEAD`.

## MAST Worker checks (Brockmann, 2026-09-06: "make sure that the back end CRM and everything on the back end is working")

- **Unit tests:** `cd mast-backend && npm ci && node test-worker.mjs` (210 pass as of 2026-09-06 with the CRM block;
  `pdf-lib` must be installed first, the container starts without `node_modules`).
- **Which merge is running (2026-09-06):** both deploy paths pass `--var BUILD:<short sha>` (`scripts/wp-upload.sh` from
  the Mac's hourly job, `deploy-worker.yml` on a runner) and `/health` echoes it as `build` beside `crm: true`; a plain
  `wrangler deploy` by hand leaves `build` null. The smoke test prints `build:` and `CRM routes live:` (GET `/admin/crm`
  without a key: 401 = the CRM build, 404 = a pre-CRM build is still running) right under the health line, so "Worker
  deployed from <sha>" in his Terminal is confirmed from a runner, never assumed.
- **Live:** the container has no route to `*.workers.dev`. `.github/workflows/smoke-worker.yml` (`workflow_dispatch`)
  probes the deployed Worker from a runner: `/health`, `/catalog` (SKUs, prices, D1 or seed), `/weekends`, the CORS
  preflight, `/account/me` (503 `accounts_off` = `ACCOUNT_SECRET` not set), the mail DNS of mastsolutions.com; with
  `contact=true` (default) one labelled test message goes through `/contact` so the Resend → `NOTIFY_EMAIL` path is
  exercised for real; with `checkout=true` one unpaid Stripe Checkout Session is created for the first bookable SKU
  (nothing charged; the abandoned registration is dropped by the daily cron). Report:
  `claude/desktop-assets:reference/desktop/live/_worker-smoke.txt` and the job summary. **First run, 2026-09-06 18:03
  UTC:** everything answered as designed except `/contact`, which returned 502 (the Resend call failed) — the one blocker
  for every Worker email; ledger item B00. **18:32 UTC:** the hint reads `resend_422:validation_error field=to`: the
  `NOTIFY_EMAIL` secret on the Worker is not an email address; the fix is `wrangler secret put NOTIFY_EMAIL` on his Mac
  (nothing a cloud session can run). **18:36 UTC: resolved** — after his second re-set (one plain address) `/contact`
  answers 200 and the labelled test email went out; the whole MAST backend is verified working end to end. Lesson for
  replies: a diagnostic line in a code fence gets pasted into his Terminal ("zsh: command not found: POST"); fence only
  commands. Secrets on the Worker
  (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `NOTIFY_EMAIL`, `ACCOUNT_SECRET`, `ADMIN_KEY`) are visible
  only as behaviour; `wrangler secret list` is his Mac's.
- **CRM (built 2026-09-06, Brockmann: "CRM should collect data - and much more"; "look at all marketing CRM and webhook for
  brand and market development"):** `mast-backend/src/crm.js`, first-party only, on the plan in `DATA-AND-MARKETING.md`
  and `ARCHITECTURE.md` §7 (Mailchimp chosen; the vault holds no other CRM decision). Collects leads (`contacts`: every
  form on both sites, stored before it is emailed), a beacon (`events`, from `TRACK_JS` in `cinematic_shell.py`, on every
  generated page), attribution on registrations and orders (UTM, referrer, landing page, first touch, visitor id); builds
  one profile per email with segments; exports the opted-in audience (CSV, Mailchimp when keys exist); runs the T−7 /
  T−1 / T+1 journeys from the daily cron behind `JOURNEYS_ENABLED` (off until he approves the texts, his "show me them
  before"). **The T−7 text is his** (2026-09-06, pasted back with three changes, all built: a numbered PARTICIPANTS
  list — seat 2+ reads "name pending" because the booking stores one name; the range-directions PDF, rendered by
  `src/directions.js` from the `RANGE_ADDRESS` / `RANGE_COORDS` / `RANGE_DIRECTIONS` secrets and attached to the T−7,
  the T−1 and the booking confirmation, nothing attached when they are unset; and the second office number
  281-415-1023 beside (281) 654-8100, `OFFICE_PHONES` in `crm.js`). His paste dropped the GPS warning from the body; it
  lives in the PDF. **All three texts are his since 2026-09-06** (the T−1 and T+1 came back the same evening; T−1 says
  "Running late or unable to make it? Call (281) 654-8100 or 281-415-1023"; T+1 keeps the reply-and-quote ask and adds
  "or leave a Google review: REVIEW_URL", "we will hold two seats together", "anytime"), so `JOURNEYS_ENABLED = "1"` in
  `wrangler.toml`: the 09:17 UTC cron sends them from the next deploy on. Staff page `GET /admin` (ADMIN_KEY). The
  schema self-applies (`migrations/006-crm.sql` is the record).
- **Range directions PDF (Brockmann, 2026-09-06: "I HAVE GIVEN YOU THE ACTUAL PDF FOR RANGE DIRECTIONS"):** his
  `MAST_Range_Directions.pdf` (3 pages: address for the GPS, map pin, the route past the green house, ten steps, the
  checklist; 134 KB, sha256 `bc2960bdf4735b9d…`) arrived as a chat upload (`/root/.claude/uploads/<session>/`, this
  session only). **It never enters git in the clear: the repo is public and the address is private.** Path built the
  same day (`mast-backend/src/sealed.js`): the Worker keeps an RSA-OAEP key pair in D1 (`worker_keys`, made on first
  use), `GET /directions-key` serves the public half (the smoke test saves it as
  `reference/desktop/live/_directions-key.json` on the handoff branch), `node mast-backend/seal-directions.mjs <pdf>
  <that json>` writes `mast-backend/assets/range-directions.sealed.json` (ciphertext only; the script refuses a PDF
  inside the repo; `.gitignore` blocks the plaintext), and the Worker fetches that file from main at send time,
  decrypts it and attaches it to the confirmation, the T−7 and the T−1 — preferred over the `RANGE_*` render. `/health`
  says `directions: sealed | secrets | none | sealed-key-mismatch`. **Done 2026-09-06 20:32 UTC:** the Mac's hourly job
  deployed `0e9c9c2` (smoke 20:31: `build: 0e9c9c2`, `directions: secrets`, key `b9104a7374d4c1d9`), the PDF was
  sealed to that key and merged in #57; the Worker picks the file up on its next fetch (memo 5 min on a miss, 1 h on
  a hit). A new PDF = he hands it to a session, the session re-seals and merges. **Do not ask him for the PDF
  again**; if the upload is gone, the sealed file on main is the copy the Worker uses (the Worker's D1 key opens it;
  no one else can).
- **Google review link (Brockmann, 2026-09-06: "add to email as click + link + add to website"):** derived from the
  Business Profile link he pasted (its `stick=` token decodes to feature id `0x8640c3cb2d0755df:0x3e9cfce1d8a7b9f7`,
  CID 4511758973651106295): `REVIEW_URL` in `wrangler.toml` (T+1 email), `GOOGLE_REVIEW_URL` / `REVIEW_LINK` in
  `cinematic_shell.py` (every Atlas footer, the MAST footer, a "Review us on Google" button in the MAST Testimonials
  chapter, the Maps CID URL in both JSON-LD `sameAs`). **2026-09-07, from his phone: "The google review is wrong."** The
  `#lrd=<ftid>,3` search-dialog link built from that id did not open the right thing, so both constants and
  `REVIEW_URL` now carry the Maps Search URL by name and address
  (`google.com/maps/search/?api=1&query=Atlas+Glinn,+2450+Fondren+Rd+Suite+255,+Houston,+TX+77063`): it always lands on
  the listing, where "Write a review" is one tap. The container cannot reach Google; `capture-live.yml` fetches the Maps
  search page and the CID page from a runner and prints any `ChIJ…` place id and whether "Atlas Glinn" appears — a
  verified place id turns into the one-tap `search.google.com/local/writereview?placeid=…` link. **Probe 2026-09-07
  15:55 UTC:** the CID page (`maps?cid=4511758973651106295`) does not mention Atlas Glinn at all — that decoded id was
  some other listing, which is why his phone called the link wrong; the address search page names Atlas Glinn but
  exposes no `ChIJ` id to a runner (JS shell). So the address link stands until he pastes the g.page link. The short
  `g.page/r/…/review` link from his Business Profile ("Ask for reviews") is the other way to one tap; take it when he
  pastes it. Never build a review link from a decoded id again without a runner check that names the business.
  Rules: eligibility answers never appear anywhere in it; consent is the tick, never the purchase; fence only commands.
- **Mailboxes:** the Claude Microsoft 365 connector in a cloud session is signed in as matthew@atlasglinn.com. The
  mastsolutions.com tenant (matthew@mastsolutions.com, the Worker's `REPLY_TO`) is a different tenant and answers
  "invalid user" from it; its mail cannot be read from a cloud session unless he connects that account too.
- **Cloud (the hourly check-in):** `python3 scripts/photo-intake.py` imports what is new on the handoff ref into
  `images/mast/gallery/` (gNN) or `images/mast/range/` (aNN), appends to `images/mast/<kind>/tiles.txt` and records the
  source in `intake.json`; then `python3 scripts/assemble-cinematic.py`, commit, PR. The assembler reads the two `tiles.txt`
  files; a person reorders or removes tiles by editing them. The merge of that PR is the one hand left.
  **What counts as a drop (fixed 2026-09-09, re-measured the same day):** a file **added in a commit after the dump
  baseline** — `DUMP_BASELINE = e5b4c0c92b262ce356d2ced7e4fcd34f81b13e3b` in `scripts/photo-intake.py`, the root commit of
  `claude/desktop-assets` (2026-09-08 04:16 UTC), whose tree already holds **16,386** of the folder's files. Measured on
  `a729d42`: without it, **4,433** top-level candidates of which **4,424** are dump files; with it, **9** candidates and
  **0** dump files. The two earlier rules are both dead ends and both were tried: a date floor separates nothing (every
  commit on that branch is after it), and the `Hand off from Mac:` subject is not a stable fact either — the branch has
  been rebuilt as an orphan once already. A SHA does not move when a filter is edited, which is the point: the previous
  guard read its oracle through the same constant it guarded, so emptying that constant made it report OK on all 4,433.
  `--check` **fails closed** — exit 1, not a silent OK, when the handoff ref does not resolve, when the baseline is not
  in the clone, or when the baseline is not an ancestor of the ref — and stamps every run under `_check` in
  `images/mast/gallery/intake.json` (time, ref, head, baseline, counts, result), so a check that never ran is
  distinguishable from one that found nothing. `main()` runs it before copying a single file. Clips in a drop folder are
  listed and skipped: In Action is photographs only. **Not claimed:** the baseline is one commit for both roots, and
  `mast-solutions-web-2026` does not exist at it, so a WordPress dump copied into *that* folder would still import.
- **Clips seen while still copying (2026-09-06):** his `CQB-P3.MOV` (370 MB, dropped in the top-level folder) reached
  the handoff branch only as a line in `reference/desktop/SKIPPED.txt`: the watcher fired while the file was still
  being written, avconvert failed, and nothing retried it. Now `mac-handoff.sh` waits for a stable size (up to 90 s),
  records avconvert's reason in SKIPPED.txt, tries `PresetLowQuality` last, and takes a lock (`$TMPDIR/atlasglinn-
  handoff.lock`); `mac-autopilot.sh hourly` runs a handoff pass over the drop folders after the page upload, so a
  skipped clip lands within the hour with no paste (the hourly job fetches the script from main). **Confirmed firing
  2026-09-06 20:23 UTC:** the hourly pass handed off `CQB-P3-web.mp4` (5.4 MB, compressed on the Mac) and cleared
  SKIPPED.txt; photo-intake made it gallery tile g14 (#57). It has no poster: the container cannot make one (the
  Playwright Chromium has no H.264, and `/opt/pw-browsers/ffmpeg-*/ffmpeg-linux` has no mp4 demuxer), and the Mac made
  none because the top-level folder was not a drop dir and a compressed clip's poster carried the source stem
  (`CQB-P3-poster.png`, never paired with `CQB-P3-web.mp4`). Fixed the same evening: `make_poster` names the poster
  after the stored clip, makes it for clips already on the branch, and the top-level folder counts as a drop dir;
  `photo-intake.py` pairs a poster that lands after its clip. **Confirmed 2026-09-06 22:33 UTC:** the next hourly pass
  handed off 16 posters (`CQB-P3-web-poster.png` among them, plus one for every older top-level clip) and the 22:45
  check-in paired `g14-poster.png`. The whole drop-folder loop — drop → Mac compresses and posters → handoff branch →
  cloud intake → page → Mac upload — has now fired end to end with artifacts seen at every step; only the Flush Cache
  click stays a hand.

## Reply format (Brockmann, 2026-09-05: "always bring back to bottom_ wire")

Every reply ends with a **WIRE** block: the exact `YOU RUN THIS` commands that turn what is merged into what is running
(Worker migration/secret/deploy, the page upload), followed by the open questions carried forward. Reorder or shorten the
text above it; never drop the block. Every review link carries a fresh `?v=<sha>` (he has reviewed stale cached builds).
**Pending items are the very last thing in the reply** (Brockmann, 2026-09-06: "Always list pending items at the very
bottom so I'm not scrolling to the top trying to figure out what needs to be done"): the `YOU RUN THIS` label sits outside
the fence, the fence holds only commands (a fenced diagnostic line got pasted into his zsh), and the numbered pending list
closes the message; nothing follows it. Ask nothing already done, and nothing unless it is broken and only he can fix it.
**Before asking for any file or fact (Brockmann, 2026-09-06: "ask me to show you exactly what I did three or four days
ago … not cost effective"):** look in this file, `mast-backend/LAUNCH-LEDGER.md`, the handoff branch
(`git ls-tree -r --name-only origin/claude/desktop-assets`), the session uploads (`/root/.claude/uploads/<session>/`) and
the vault memory he points at. A thing he handed over once is recorded here with where it went; asking for it again is
the failure he is paying for.

## Memory Rules

### Installation completeness (Matthew, 2026-07-18)

Any new download or install must be driven to a fully working state in the
same session — never left pending or half-configured:

1. **Installed** — all files in place, dependencies resolved.
2. **Loaded** — skills/agents/tools verifiably discovered by the harness
   (check the skills list; don't assume).
3. **Run** — exercised end-to-end at least once (test suite and/or a real
   smoke run) with output verified.
4. **Nothing silently pending** — any step that genuinely cannot be completed
   (missing user secret, environment/network-policy limit) must be surfaced
   explicitly with the exact command or action that finishes it, both in the
   final report and in this file's status tables.

## ATLAS — the one agent (added 2026-08-07)

Brockmann speaks to **ONE** agent: **ATLAS**. Everything else is a worker ATLAS
dispatches. He should never have to name a sub-agent, pick a model, or remind a
session to read the rules.

**ATLAS is defined in the `brain` repo, not here.** That repo is the source of
truth and this file is a pointer, deliberately — duplicating the definitions
across repos is how they drift, which is the failure class the brain vault exists
to kill.

| What | Where (in `MatthewBrockmann/brain`) |
|---|---|
| Entry point / doctrine | `.claude/skills/atlas/SKILL.md` |
| Worker fleet (7 agents) | `.claude/agents/atlas-*.md` |
| Locked rules, re-injected every turn | `00-rules/prime-directives.md` |
| Cloud-readable memory (442 files) | `04-resources/agent-memory/` |
| Merged-vs-running dashboard | `04-resources/Deployment-Status.md` |
| Current work queue | `04-resources/ATLAS-session-plan-2026-08-07.md` |

**Model split** (Brockmann, 2026-08-07): main loop = **Fable 5** or **Opus 5**.
Workers are routed by task with the model passed **explicitly** on every call,
never inherited — **Sonnet** for `atlas-scout` (recon) and `atlas-scribe`
(record-keeping); **Opus** for `atlas-architect`, `atlas-builder`, `atlas-ops`,
`atlas-verifier`, and `atlas-security`. The security tier is **never** downgraded.
The point is rate of return: cheap models absorb the mechanical volume so the
expensive ones are spent on judgment.

**Rules that bind sessions in this repo too:**
- **Never claim a Mac-only action from a cloud session.** Hooks, LaunchAgents, the
  local RAG and the canonical memory store are Mac-local by physics.
- **No live credentials anywhere git can see** — `[Keychain <name>]` references only.
  A real-looking secret in a tracked file is a bug to report, never to use.
- **Say who acts.** Label every command block `ALREADY RUN BY CLAUDE — do not paste`
  or `YOU RUN THIS — copy-paste into Terminal`. An unlabelled block is the violation.
- **Wired ≠ firing.** An automation is done only when it is wired, fired-observed
  with an artifact seen, has a heartbeat, has every referenced path verified to
  exist, and has its "why" captured. Until then say "wired, NOT confirmed firing."
- **Deploy-or-don't-declare-done.** Merged is not running. Say which one it is.

⚠️ **Known open item on this site:** `AtlasGlinn_WireGuard_Page.html` (in the
AtlasEP repo) advertises "military-grade WireGuard VPN tunnels" and no WireGuard
implementation exists in any repo — no config, no `.conf`, no `wg0`. Either it is
hosted entirely outside git or the claim is unsupported. Resolve before any SEO or
content work amplifies that page.

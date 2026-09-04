# MAST registration, waiver, and lifecycle — architecture

Status: **v1 of the flow is BUILT (2026-09-03)** — `POST /register` in
`src/worker.js`: details → two eligibility questions → agreement (scroll-gated,
typed attestation, PDF filled and flattened by `src/agreement.js`) → refund-policy
checkbox → Stripe → webhook links the registration, copies the consent onto the
order, emails the participant (with the range address and the signed PDF) and the
agreement recipients (PDF only). Daily cron purges answers. Guest checkout only:
profiles, one-year reuse, Mailchimp and the T−7/T−1 emails are still unbuilt.
Storage is **D1** (decision #2 below), not Supabase. Originally written 2026-09-01
from the owner's requirements. Decisions marked ⚠️ are his to make.

---

## 1. The flow — SPECIFIED BY OWNER (2026-09-01)

```
1.  Click a class
2.  Create a profile — OR CONTINUE AS GUEST        ← profile is optional
3.  Eligibility questions (Y/N)  ────────┐
      all No + citizen Yes  → continue   │  any Yes → FOLLOW-UP,
                                         │            not a rejection
4.  Range Participation Agreement — sign ┘
5.  Refund / cancellation — agree checkbox
6.  Payment (Stripe)
7.  Receipt → customer
    All completed documents → MAST + range
    Newsletter opt-in → Mailchimp
8.  T−7 reminder → T−1 reminder → post-class follow-up
```

Screening before signature before payment. You cannot take money for a class
someone may not be able to attend, and a refund afterwards is worse than a gate
before.

**Checkout is no longer three clicks, and should not be.** Three was right for a
seat with no prerequisites; it is wrong for a live-fire class carrying a
negligence waiver.

### Two owner decisions that change the earlier design

**Profile is OPTIONAL — guest checkout is allowed.** Earlier drafts assumed an
account was required. It is not.

The consequence worth designing around: **the one-year waiver reuse only works
for someone with a profile.** A guest has no identity to attach it to, so a guest
signs again every time. That is not a drawback — it is the single most honest
reason to create an account, and the checkout should say so in one line:

> *Create a profile and you won't sign this again for a year.*

Guests still get a record; it is keyed on email rather than an account, and is
promoted to the profile if they later register with the same address.

**A "Yes" answer is a FOLLOW-UP, not a rejection.** This is the owner's call and
it is the right one — a yes can have an explanation (an expunged record, a
resolved order, a misunderstanding of the question). Auto-rejecting turns a
phone call into a lost customer and an angry one.

So a Yes:
- Stops the flow before signature and before payment — **nothing is charged**
- Creates a **review item** for staff, with the participant's contact details
- Shows the participant a neutral message: their registration needs a brief
  conversation before it can be completed, and someone will contact them
- Never states which question triggered it, and never emails the reason

```sql
CREATE TABLE eligibility_reviews (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL,
  profile_id    TEXT,                    -- null for guests
  session_id    INTEGER,
  session_date  TEXT,     -- Saturday of the training weekend chosen in the calendar (added 2026-09-02)
  session_label TEXT,     -- e.g. "Sat–Sun, Oct 10–11, 2026", as shown at checkout
  flagged_q     TEXT NOT NULL,           -- which question(s), staff-eyes only
  status        TEXT DEFAULT 'pending',  -- pending | cleared | declined
  staff_note    TEXT,
  reviewed_by   TEXT,
  created_at    TEXT NOT NULL,
  reviewed_at   TEXT
);
```

Cleared → a one-time resume link puts them back at the agreement step. Declined →
a neutral message, and the reason stays in the staff note, never in an email.

---

## 2. The hard blocker: there are no class dates

Nothing in the site, the vault, or the backend holds a **course date**. The
catalog has courses, not sessions.

Every one of these depends on dates existing:

- "T−7 days" and "T−1 day" reminder emails — no date, no send time
- Seats remaining / sold out
- A roster for a specific class day
- "Book your seat" meaning anything more specific than "contact us"

**This is the first thing to build**, and it needs owner input (which courses
run when, and capacity per session).

**Capacity is set (owner, 2026-09-01):**

| Course type | Seats |
|---|---|
| Fundamental — 1 day | **16** |
| Operator — 2 day | **10** |

```sql
CREATE TABLE sessions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  course_sku    TEXT NOT NULL,              -- FK -> offerings.sku
  starts_at     TEXT NOT NULL,              -- ISO 8601, America/Chicago
  ends_at       TEXT,
  capacity      INTEGER NOT NULL,           -- 16 fundamental / 10 operator
  location      TEXT DEFAULT 'Wharton Range',
  status        TEXT DEFAULT 'open',        -- open | full | cancelled | done
  notes         TEXT
);

-- course_type drives the capacity default; store it on the offering
ALTER TABLE offerings ADD COLUMN course_type TEXT DEFAULT 'fundamental';
                                             -- fundamental | operator
```

A booking then references a **session**, not just a course.

**Seats must be held atomically.** Two people paying for the last seat at the
same moment is a real failure on a 10-seat live-fire class, not a theoretical
one. Reserve the seat when checkout starts, with a short expiry, and release it
if payment does not complete:

```sql
CREATE TABLE seat_holds (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  INTEGER NOT NULL,
  profile_id  TEXT NOT NULL,
  seats       INTEGER NOT NULL DEFAULT 1,
  expires_at  TEXT NOT NULL,      -- ~20 min, covers a Stripe checkout
  consumed    INTEGER DEFAULT 0   -- set on successful payment
);
```

Seats available = `capacity − confirmed − live holds`.

---

## 3. Profiles and login

⚠️ **Decision: Supabase Auth, or hand-rolled magic links on the Worker?**

**Recommendation: Supabase.** It is already in the stack (project
`huiqzhzvhdzkqwccffzd`, currently **INACTIVE** — needs resuming). It gives
magic-link and password auth, Postgres with row-level security, and a dashboard
where staff can see registrations without anyone writing an admin UI.

The reason not to hand-roll: this store holds full name, home address, phone,
emergency contacts, and a signed liability waiver. Authentication bugs on that
data are not recoverable by apology. Session handling, token rotation, and reset
flows are exactly where hand-rolled auth fails.

The Cloudflare Worker stays as the Stripe and email edge. Supabase owns identity
and records.

```
profiles
  id (uuid, = auth.users.id)   email   full_name
  phone   address_1   address_2   city   state   postal
  emergency_name   emergency_phone   emergency_relationship
  segment            -- military | le | civilian
  marketing_opt_in   created_at
```

---

## 4. Waiver: signed once, valid one year

```
waivers
  id   profile_id   signed_at   expires_at        -- signed_at + 1 year
  agreement_version                                -- see below
  pdf_url            -- stored copy of the filled, signed PDF
  signature_name     -- typed name as entered
  signature_ip   user_agent                        -- attestation evidence
  initials_p1  initials_p2  initials_p3
```

On booking: `SELECT … WHERE profile_id = ? AND expires_at > now()`. A hit skips
the agreement step entirely — the owner's "do not sign again for 1 year".

**⚠️ Version the agreement.** If the PDF's terms change, prior signatures do not
cover the new terms. `agreement_version` (hash of the source PDF; current: `81961f2a07675eff`) means
a terms change automatically re-prompts everyone, instead of silently relying on
consent nobody gave. This is the single most important line in this document.

### The PDF has no signature field

Confirmed by inspection: 15 fillable fields, none over the signature line on
page 3.

**DECIDED (owner, 2026-09-01): typed attestation with timestamp + IP.**

This is also the best answer for the end user, which is worth noting because the
two criteria usually pull apart and here they do not:

| | Typed attestation | E-sign service | Draw-with-finger |
|---|---|---|---|
| Time to complete | ~10 seconds | 1–3 min, often an email round-trip | 30–60 s |
| Leaves the site | No | Yes — redirect, sometimes a return email | No |
| Mobile | One-handed, a text input | Painful — tag-clicking on a small screen | Worst — finger scrawl |
| Third-party account | No | Sometimes | No |
| Legal weight | Sufficient under E-SIGN/UETA with a retained evidence record | Strongest (certificate of completion) | No stronger than typed |
| Cost | None | Per-envelope | None |

An e-sign redirect is the worst option here specifically because it interrupts a
purchase. Every redirect out of a checkout loses people, and this one lands them
in an unfamiliar UI mid-transaction.

Drawing a signature *feels* more official and is not. It is legally no stronger
than typed, and on a phone it produces an illegible scrawl.

### What makes typed attestation hold up

The signature is not the evidence; the record around it is. Capture and retain:

- Typed full name, exactly as entered
- UTC timestamp, plus the client's local time
- IP address and user agent
- `agreement_version` (currently `81961f2a07675eff`) — proves *which* terms were agreed
- **Scroll-to-end enforcement**: the Agree control stays disabled until the
  participant has actually scrolled the agreement. This is the single strongest
  rebuttal to "I never saw that clause", and it costs nothing
- An explicit checkbox distinct from the name field: *"I have read and agree…"*
- The rendered, filled PDF stored immutably, with the attestation block stamped
  onto the signature line

### Making it fast for the participant

- **Pre-fill from the profile.** 13 of the 15 PDF fields map onto `profiles`, so a
  returning participant confirms rather than retypes.
- **One initials entry, applied to all three pages.** The PDF has three initials
  boxes; asking three times is friction with no added legal value once the
  scroll-gate and the checkbox are in place.
- **The one-year reuse rule is the real UX win.** A returning student signs
  nothing at all — the fastest form is the one that never renders.

### Field map (extracted from the supplied PDF)

DocHub named the fields opaquely, so these were mapped by page coordinates:

| Field ID | Page | Meaning |
|---|---|---|
| `dhFormfield-6088230960` | 1 | Participant name (consideration clause) |
| `dhFormfield-6088233145` | 1 | Initials |
| `dhFormfield-6088233457` | 2 | Initials |
| `dhFormfield-6088234140` | 3 | Date — day |
| `dhFormfield-6107630987` | 3 | Date — month |
| `dhFormfield-6107639317` | 3 | Date — year (2-digit, follows "20") |
| `dhFormfield-6107632850` | 3 | Name of Participant |
| `dhFormfield-6107633604` | 3 | Address line 1 |
| `dhFormfield-6107633880` | 3 | Address line 2 |
| `dhFormfield-6107637887` | 3 | Phone Number |
| `dhFormfield-6107637899` | 3 | Email Address |
| `dhFormfield-6107637940` | 3 | Emergency Contact Name |
| `dhFormfield-6107648038` | 3 | Emergency Contact Number |
| `dhFormfield-6107650114` | 3 | Relationship to Participant |
| `dhFormfield-6107651202` | 3 | Initials |
| *(none)* | 3 | **SIGNATURE — no field exists** |

Most of these are already in `profiles`, so a returning participant's PDF fills
itself and they confirm rather than retype.

---

## 5. Eligibility screening — SPECIFIED

ATF Form 4473 is the federal firearms **transfer** record. MAST is not
transferring firearms, so this is not a 4473 and must not be labelled one. It is
4473-**derived** prohibited-person screening, which is a reasonable gate for a
live-fire class.

**Owner decided (2026-09-03): TWO questions only.** This supersedes the
2026-09-01 selection of six 4473 items. His words: *"the only two questions are:
1. Are you a US citizen? 2. Do you have a felony that would prevent you from
using or handling a firearm? Check box Y/N."* Purpose, in his words earlier:
*"this is for our safety — they can lie, and we are not running background
checks. This protects us — not to deny."* Two attestations, read and answered,
beat seven skimmed.

**Order: this form comes FIRST, then the range waiver.** Screening before a
signature means an ineligible applicant never signs anything and never pays.

### The two questions, as they will appear

Numbered, Yes/No check boxes, both required. `expected` is the answer that
lets the flow continue.

| # | Question | Expected |
|---|---|---|
| 1 | Are you a citizen of the United States? | **Yes** |
| 2 | Do you have a felony conviction that prevents you from using or handling a firearm? | **No** |

Below the two boxes, one line of attestation the participant ticks:
*"I confirm these answers are true. I understand MAST Solutions relies on them
to admit me to a live-fire course."*

**Age is not a question.** The agreement itself warrants the signer is "at
least eighteen years of age", so the waiver step enforces 18+ (date of birth
field, blocked under 18) rather than asking it here.

### Handling

- Any disqualifying answer → stop before the waiver, before payment. Show a
  neutral message with a phone number; do not state which question failed.
- **Never auto-email a rejection listing the reason.** A record saying "declined:
  domestic violence conviction" sitting in an inbox is a liability of its own.
- Store answers with `questions_version` (same discipline as the agreement), the
  timestamp, and IP.

⚠️ **This is criminal-history data.** It is sensitive personal information and
must be: encrypted at rest, restricted to staff who need it, retained under a
stated policy rather than forever, and never synced to Mailchimp or any
analytics tool. Route it to Supabase with row-level security — never into the
PostHog event stream.

- **Guests sign too.** "I am responsible for ensuring that any guest I bring has
  signed" — a booking for more than one seat needs screening and an agreement
  **per attendee**, not one for the buyer.

---

## 6. Email lifecycle

Cloudflare **Cron Trigger** on the Worker, running daily; Resend for delivery.

| When | Trigger | Contents |
|---|---|---|
| On payment | Stripe webhook | Receipt, class date/time, **range directions attached**, what to bring, signed agreement copy |
| T−7 days | cron | Reminder, what to bring, directions |
| T−1 day | cron | Final reminder, directions, gate reminders, weather note |
| T+1 day | cron | Thank you, review request, next course |
| Abandoned | cron | Started checkout, never paid — one nudge only |

```
email_log
  id   profile_id   session_id   kind   sent_at   provider_id
  UNIQUE (profile_id, session_id, kind)   -- makes cron re-runs idempotent
```

That UNIQUE constraint is what stops a cron retry from emailing everyone twice.

**Range directions** (`MAST_Range_Directions.md`) render to PDF and attach.
Worth keeping in the email body as well as the attachment — the document itself
says *"Screenshot this page. Cell service drops off well before you get there."*
An attachment someone never opened is no use on a dirt road with no bars.

### The range address is NOT public (owner, 2026-09-01)

**Decided.** `[secret RANGE_ADDRESS]` (`[secret RANGE_COORDS]`) is
released **only after a completed registration**, in the confirmation email.

This has to be enforced in more places than the obvious one:

- The public site shows **Houston** (2450 Fondren Rd) only — never Wharton
- **JSON-LD / schema.org must not carry the range address.** Structured data is
  machine-readable by design; putting it there publishes it to search engines
  more effectively than a paragraph would
- The `sessions.location` field stores `Wharton Range` as a label, and the full
  address lives in one place used only by the confirmation and reminder emails
- Range directions are **not** a public URL — serve them from a signed,
  expiring link tied to the booking, or attach the PDF. A guessable
  `/range-directions.pdf` is a public address with extra steps
- The T−7 and T−1 reminders may repeat it; marketing email never does

---

## 6a. Document distribution — SPECIFIED BY OWNER

Recipients:

| # | Name | Address |
|---|---|---|
| 1 | Alex Albert (range host) | `[secret — first address in DOC_RECIPIENTS_AGREEMENT]` |
| 2 | Atlas Glinn HQ | `atlasglinn.hq@atlasglinn.com` ⚠️ see note |
| 3 | Matthew Brockmann | `Matthew@mastsolutions.com` |
| 4 | Anthony Glover | `a.glover@atlasglinn.com` |

| Document | 1 Alex | 2 HQ | 3 Matthew | 4 Glover | Customer |
|---|:--:|:--:|:--:|:--:|:--:|
| **Signed range agreement** | ✅ | ✅ | ✅ | ✅ | ✅ |
| Booking / payment receipt | ❌ | ✅ | ✅ | ✅ | ✅ |
| Eligibility answers | ❌ | ⚠️ see below | ⚠️ | ⚠️ | ❌ |
| Range address + directions | ❌ | ❌ | ❌ | ❌ | ✅ |
| Roster before class | ❌ | ✅ | ✅ | ✅ | ❌ |

**Alex Albert receives the signed range agreement and nothing else.**

### ⚠️ Two flags on this

**1. `atlasglinn.hq@atlasglinn.com` — confirmed by owner 2026-09-01.** An earlier
draft carried a stray `w`; corrected everywhere.

**2. Do not email the eligibility answers to anyone.** The owner's instinct to
keep Alex off everything but the waiver is right, and the same logic extends
further: these are criminal-history responses. Emailing them creates permanent,
uncontrolled copies in four mailboxes, outside row-level security, un-deletable,
and outside the retention policy.

**Recommended instead:** the notification says *"Registration #1234 needs
eligibility review"* with a link. The answers are read in the admin, under access
control, and the record stays in one place.

This matters beyond hygiene: under the TDPSA, sensitive personal data is the one
category the small-business exemption does not fully cover
(see `DATA-AND-MARKETING.md`). Scattering it across inboxes — one of them a
personal Gmail — is the opposite of the containment that keeps the exemption
intact.

**3. Alex's address is a personal Gmail**, and signed agreements carry full name,
home address, phone and emergency contacts. That is real PII leaving
organisational control. Worth confirming it is intended, and worth considering an
`@atlasglinn.com` address instead.

### Config

```toml
# wrangler.toml — non-secret routing, kept out of code so it can change
# without a redeploy
DOC_RECIPIENTS_AGREEMENT = "[secret] range host + the three internal addresses"
DOC_RECIPIENTS_INTERNAL  = "[secret] atlasglinn.hq@, Matthew@mastsolutions.com, a.glover@"
```

Two lists, not one with exclusions — an exclusion list is a bug waiting to
happen the first time someone adds a recipient in the wrong place.

---

## 7. Mailchimp

On successful payment, upsert the contact:

- Merge fields: `FNAME`, `LNAME`, `PHONE`, `SEGMENT`, `LASTCLASS`, `WAIVEREXP`
- Tags: course SKU, session date, segment, `customer`
- `marketing_opt_in` gates it — a transactional purchase is not marketing consent

**Blocked:** memory records no Mailchimp API key in Keychain. Needed:
`MAILCHIMP_API_KEY`, audience ID, and server prefix (e.g. `us21`).

Keep transactional mail on **Resend** and marketing on **Mailchimp**. Mixing them
risks a marketing unsubscribe silently killing someone's class reminders.

---

## 8. Analytics — what to actually use

The ask was "clicks + how long on site + anything else".

| Tool | Cost | Gives you | Verdict |
|---|---|---|---|
| **PostHog** | Free to 1M events/mo | Autocaptured clicks, funnels, session replay, retention, feature flags | **Recommended** — the only one that answers "where do people drop out" |
| **Cloudflare Web Analytics** | Free | Pageviews, referrers, Core Web Vitals, no cookie banner | **Also add** — free, privacy-first, already on Cloudflare |
| GA4 | Free | Ubiquitous, ad integration | Weaker funnels, needs a cookie banner |
| Plausible / Fathom | ~$9–14/mo | Clean, privacy-first | Good, but PostHog free tier does more here |

**Run PostHog + Cloudflare Web Analytics.** Cloudflare gives an honest traffic
baseline with no consent banner; PostHog answers the question that actually
matters — which step loses the booking.

### The funnel to instrument

Named events, so the drop-off is legible rather than inferred:

```
course_viewed        → sku
enroll_clicked       → sku, session_id
profile_started      → new vs returning
waiver_viewed        → reused existing (bool)
waiver_signed        → seconds_spent
eligibility_passed / eligibility_failed → reason
checkout_started     → amount
purchase_completed   → amount, sku
```

`enroll_clicked → purchase_completed` is the number to watch. If `waiver_signed`
is where people vanish, the agreement step needs shortening — and the one-year
reuse rule is exactly the fix for repeat customers.

Also capture **UTM parameters at registration** and store them on the booking, so
"which channel sold this seat" is answerable without guessing.

---

## 9. Things worth adding that were not asked for

- **Seats remaining / sold out.** Capacity exists in `sessions`; showing "3 seats
  left" is honest urgency and prevents overbooking a live-fire class.
- **Waitlist** when a session is full — captures demand instead of losing it.
- **Instructor roster export.** A CSV per session with names, phones, and
  **emergency contacts**. This is a range-day safety artifact, not a marketing
  report — the agreement makes emergency contacts mandatory, so they should be in
  the instructor's hand, on paper, offline. Cell service does not reach the range.
- **Refund and cancellation policy.** The waiver covers liability, not money.
  What happens on a no-show, a weather cancellation, a student cancelling at
  T−2 days? Needs a stated policy before the first sale.
- **Guest agreements** — see §5. One booking, several attendees, one agreement
  each.
- **Waiver expiry nudge** — email at 11 months so a returning student re-signs
  before booking rather than during.

---

## 10. Build order

1. **Sessions + dates** — nothing else works without them
2. Supabase project resumed; `profiles` + `waivers` + auth
3. PDF fill and store; signature method decided
4. Eligibility questions (owner supplies text)
5. Booking flow rewired: profile → screening → waiver → Stripe
6. Transactional email + range directions attachment
7. Cron reminders (T−7, T−1, T+1) with the idempotency constraint
8. Mailchimp sync
9. PostHog + Cloudflare Web Analytics, funnel instrumented
10. Roster export, waitlist, seats-remaining

Steps 1–6 are the minimum for a real booking. 7–10 are the compounding layer.

---

## Open decisions (owner)

| # | Decision | Status | Blocks |
|---|---|---|---|
| 1 | Class dates per course | ⏳ owner working on it | Everything downstream |
| 1b | Capacity | ✅ 16 fundamentals / **10 for any P1 or operator** — owner adjusting individually later | — |
| 2 | Supabase vs hand-rolled auth | ⚠️ still open for **profiles/login**. For **eligibility storage** v1 uses **D1** (the Worker's existing database, the Worker is its only reader, answers split from outcomes and purged by cron) — the same isolation the Supabase paragraphs ask for, without a second vendor. Revisit only if profiles land on Supabase Auth. | Profiles |
| 3 | Signature method | ✅ typed attestation + timestamp + IP | — |
| 4 | Eligibility questions | ✅ **two only** (owner 2026-09-03): U.S. citizen Y/N, disqualifying felony Y/N. Age enforced at the waiver | — |
| 5 | Range address public, or post-booking? | ⚠️ open | Site copy |
| 6 | Six course prices | ⏳ owner listing with dates | Payment |
| 7 | Refund / cancellation policy | ✅ **approved as drafted** — adjustable later | — |
| 8 | Mailchimp key, audience ID, server prefix | ⚠️ open — no key on file | Marketing sync |
| 10 | Eligibility retention | ✅ outcomes kept, answers purged. **Purpose is attestation/protection, not denial** — see `RETENTION-POLICY.md` | — |
| 12 | Oct 31 weekend | ✅ **blocked** | — |
| 11 | Document routing + private range address | ✅ specified — see §6a | — |
| 9 | Where signed agreements are emailed | ✅ four recipients, `atlasglinn.hq@` confirmed | — |

See `REFUND-POLICY-DRAFT.md` for #7.

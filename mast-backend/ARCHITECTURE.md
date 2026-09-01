# MAST registration, waiver, and lifecycle — architecture

Status: **proposal, nothing built.** Written 2026-09-01 from the owner's
requirements. Decisions marked ⚠️ are his to make before build starts.

---

## 1. What changed

The original flow was *pick a course → pay*. The new requirement inserts
screening and a signed legal agreement **before** money changes hands:

```
Browse → pick course+date → PROFILE (create or log in)
       → eligibility questions → sign the Participation Agreement
       → pay (Stripe) → confirmation email + range directions
       → T−7 reminder → T−1 reminder → post-class follow-up
```

This is the right order. You cannot take payment for a class someone is
ineligible to attend, and a refund after the fact is worse than a block before.

It has one consequence worth stating plainly: **checkout is no longer three
clicks**, and it should not be. Three clicks was correct for a seat with no
prerequisites; it is wrong for a live-fire class with a negligence waiver.

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

```sql
CREATE TABLE sessions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  course_sku    TEXT NOT NULL,              -- FK -> offerings.sku
  starts_at     TEXT NOT NULL,              -- ISO 8601, America/Chicago
  ends_at       TEXT,
  capacity      INTEGER NOT NULL DEFAULT 12,
  location      TEXT DEFAULT 'Wharton Range',
  status        TEXT DEFAULT 'open',        -- open | full | cancelled | done
  notes         TEXT
);
```

A booking then references a **session**, not just a course.

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

## 5. Eligibility screening

The owner referenced "a 4473" — ATF Form 4473 is the federal firearms
**transfer** record. MAST is not transferring firearms, so 4473 itself does not
apply; what is wanted is 4473-style **prohibited-person screening**.

⚠️ **The exact question list is the owner's to supply** — these are legal
attestations and must not be invented. Two constraints come from the agreement
itself and are not optional:

- **18 or older.** The agreement warrants the signer is "at least eighteen years
  of age". The form must enforce it, not just ask.
- **Guests sign too.** "I am responsible for ensuring that any guest I bring
  has signed" — so a booking for more than one seat needs an agreement per
  attendee, not one for the buyer.

Store each answer with its version, same reasoning as the waiver.

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

⚠️ **The site currently shows only the Houston office.** Training is at
**4159 County Road 161, Wharton, TX 77488** (29.339959, -96.046542). Decide
whether the range address is public or released only after booking.

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

| # | Decision | Blocks |
|---|---|---|
| 1 | Class dates + capacity per session | Everything |
| 2 | Supabase vs hand-rolled auth | Profiles |
| 3 | Typed attestation vs e-sign service | Waiver |
| 4 | Eligibility question text (verbatim) | Screening |
| 5 | Range address public, or post-booking only? | Site copy |
| 6 | Six course prices | Payment |
| 7 | Refund / cancellation policy | First sale |
| 8 | Mailchimp API key, audience ID, server prefix | Marketing sync |

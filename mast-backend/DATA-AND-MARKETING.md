# Data platform, marketing automation, and compliance

Written 2026-09-01 against the owner's brief on DMP/CDP, personalisation, CRM
integration, analytics and compliance.

**Status: recommendation. Nothing built.**

---

## The honest headline

The brief describes an enterprise martech stack — DMP, third-party data
aggregation, hyper-personalisation at scale. **MAST should not build that**, and
not because of budget. Two reasons:

**1. Third-party data is a dying asset.** DMPs exist to rent third-party audience
segments assembled from cookies. Those cookies are gone or going, and the segments
were always low-precision. Buying them in 2026 is buying a depreciating asset.

**2. MAST's first-party data is dramatically better than anything a DMP sells.**
You will know: which course someone took, on what date, whether they are military,
LE or civilian, whether they came back, whether their waiver is expiring, what
they clicked before booking, and what they abandoned. No third-party segment comes
close to "took Force on Force in March, waiver expires in six weeks." That is the
asset. It should be protected and used, not diluted with rented data.

So: **build the CDP pattern, skip the DMP.** Unified profiles, behavioural
segmentation, triggered journeys, closed-loop analytics — all of it — on
first-party data you already collect at registration.

---

## The stack

| Layer | Tool | Why |
|---|---|---|
| **System of record** | **Supabase** (Postgres) | Profiles, waivers, eligibility, bookings. Row-level security. Already in the stack. |
| **Behaviour / product analytics** | **PostHog** | Autocaptured clicks, time on page, funnels, session replay. Free to 1M events. Person profiles unify anonymous → known on identify. |
| **Traffic baseline** | **Cloudflare Web Analytics** | Free, no cookie banner, already on Cloudflare. |
| **Email — transactional** | **Resend** | Receipts, agreements, range directions, T−7/T−1. Must never be unsubscribable. |
| **Email — marketing** | **Mailchimp** | Newsletter, journeys, re-engagement. Owner already chose it. |
| **Payments** | **Stripe** | Already specified. |
| Event router (Segment/RudderStack) | **Not yet** | Adds cost and a hop. Revisit past ~50k events/month. |

**Supabase is the CDP.** A CDP is a unified customer profile with segmentation
and activation — Postgres with good schema design does that at this volume, and
you own the data rather than renting it back.

### Keep transactional and marketing separate

Resend sends receipts and class reminders. Mailchimp sends the newsletter.

They must not be merged. If they are, someone who unsubscribes from the newsletter
stops receiving **class reminders and range directions** — and then arrives at the
wrong time, or not at all. Transactional mail is not marketing and has no
unsubscribe.

---

## The unified profile

```
profile
  identity      email, name, phone, address
  segment       military | le | civilian
  commercial    courses taken, dates, total spend, first/last seen
  lifecycle     waiver_expires_at, eligibility_status
  behaviour     (PostHog) pages, clicks, funnel position, abandoned checkouts
  consent       marketing_opt_in, opted_in_at, source, refund_policy_version
```

Anonymous browsing is stitched to the known person at registration via PostHog's
`identify()`, so the pre-purchase behaviour of a customer is attached to them
retroactively. That answers "what did people who actually bought look at first?"
— which is the question worth having.

### Segments worth having on day one

Behaviour, not demographics — these are the ones that move revenue:

- **Waiver expiring in 60 days** → "re-sign and book" (a returning student is the
  cheapest sale there is)
- **Took a fundamental, never took an operator course** → the natural upsell
- **Abandoned checkout in the last 30 days** → one nudge, once
- **Attended >12 months ago, no booking since** → win-back
- **Military / LE** → agency and team-block offers
- **Never attended, on the newsletter >90 days** → different content entirely

---

## Triggered journeys

Every one of these fires off an event the backend already produces:

| Trigger | Message | Channel |
|---|---|---|
| Payment succeeds | Receipt + signed docs + **range directions** + what to bring | Resend |
| T−7 days | Reminder, gear, directions | Resend |
| T−1 day | Final reminder, gate instructions, weather | Resend |
| T+1 day | Thank you, review request, next course | Resend → then Mailchimp tag |
| Checkout abandoned 24h | One nudge, once | Mailchimp |
| Waiver expires in 60d | Re-sign + rebook | Mailchimp |
| 12 months since last class | Win-back | Mailchimp |
| Newsletter opt-in | Welcome + course overview | Mailchimp |

**Every automated send checks `email_log` first** — the
`UNIQUE(profile, session, kind)` constraint is what stops a cron retry from
emailing a customer twice.

---

## Closed-loop attribution

Capture UTM parameters on first touch, persist them to the booking, and the
question "which channel actually sold seats" becomes answerable in SQL rather
than in a dashboard that only counts clicks:

```sql
ALTER TABLE orders ADD COLUMN utm_source TEXT;
ALTER TABLE orders ADD COLUMN utm_medium TEXT;
ALTER TABLE orders ADD COLUMN utm_campaign TEXT;
ALTER TABLE orders ADD COLUMN first_touch_at TEXT;
```

Revenue per channel, not clicks per channel. That is the whole point of the
"performance optimisation and ROI" line in the brief, and it needs exactly these
four columns rather than a platform.

---

## Compliance — and the one real trap

### Which law actually applies

**Not GDPR** unless MAST markets to EU residents — it does not. **Not CCPA** —
that needs $25M revenue, 100k consumers, or 50%+ revenue from selling data.

**The one that applies is the Texas Data Privacy and Security Act (TDPSA).**

MAST is almost certainly inside the TDPSA's **small-business exemption** (SBA
definition, under 500 employees). But the TDPSA is unusual, and this is the part
that matters:

> Even an otherwise-exempt small business **may not sell sensitive personal data
> without consent.**

### Why that lands directly on the DMP idea

**Criminal-history answers and citizenship status are sensitive personal data.**

Feeding registration data into a DMP or any third-party audience platform that
shares or monetises it can constitute a **sale** — and it is precisely the one
thing the small-business exemption does not cover. The enterprise pattern in the
brief is the single path that could take a compliant small business and make it
non-compliant.

**The rule, and it is not negotiable:**

> Eligibility answers never leave Supabase. Not to Mailchimp, not to PostHog, not
> to any analytics or advertising platform, not into an event payload, not into a
> support ticket. Staff read them in the admin, under row-level security.

This is not caution for its own sake. It is a one-line rule that keeps a small
business inside an exemption it would otherwise lose.

### Practical requirements

- **Consent is separate from purchase.** Buying a class is not newsletter consent.
  Unticked checkbox, its own line, `opted_in_at` + source recorded.
- **Universal opt-out signals** — as of 2025 controllers must honour them, and a
  dozen states require it in 2026. Respect Global Privacy Control; PostHog and
  Mailchimp both support suppression.
- **Encryption at rest** for profiles, waivers, eligibility — Supabase provides it;
  restrict with RLS so staff roles see only what they need.
- **Retention policy, stated.** Waivers have a real reason to be kept (limitations
  periods). Eligibility answers do not need to be kept forever — decide a term and
  enforce it. "We keep everything" is a liability, not a strategy.
- **Privacy policy** covering what is collected, why, who it goes to (Stripe,
  Resend, Mailchimp, PostHog), and how to request deletion.
- **DPAs** with each processor. All four offer standard ones.

---

## Build order

1. Bookings write clean first-party records (profiles, orders, consent) — this is
   the foundation and nothing works without it
2. PostHog + Cloudflare Web Analytics; instrument the funnel
3. Resend transactional: receipt, docs, range directions
4. Mailchimp sync on payment, **gated on the opt-in flag**
5. Cron journeys: T−7, T−1, T+1, abandoned checkout
6. Lifecycle segments: waiver-expiring, win-back, upsell
7. UTM capture → revenue-per-channel reporting
8. Consent management + privacy policy + retention enforcement

Steps 1–4 are the working system. 5–8 are the compounding layer, and each one
pays for itself before the next is needed.

---

## Open items

| # | Item | Owner action |
|---|---|---|
| 1 | Mailchimp API key, audience ID, server prefix (e.g. `us21`) | No key on file |
| 2 | Newsletter opt-in wording | Approve copy |
| 3 | Retention period for eligibility answers | Decide a term |
| 4 | Privacy policy | Draft + counsel review |
| 5 | Where completed documents are emailed — "MAST + range" | Exact addresses |

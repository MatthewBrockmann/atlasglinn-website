# MAST Solutions — booking backend

Cloudflare Worker behind MAST registration: eligibility screening, the Class
Participation and Use of Property Agreement (filled and flattened as a PDF),
refund-policy consent, Stripe Checkout, D1 persistence, and Resend email to the
participant, the range host and staff.

**Status (2026-09-04): v1.1 (`POST /register`, `POST /contact`, the agreement PDF,
the daily retention cron) is DEPLOYED** from the owner's machine; `/health` answered
`"version":"1.1.0"` at 16:52 UTC and the cron is scheduled. Secrets on the Worker:
`ADMIN_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RANGE_ADDRESS`,
`DOC_RECIPIENTS_AGREEMENT`. Not set: `NOTIFY_EMAIL` and `RESEND_API_KEY`, so every
email (participant confirmation, agreement PDF, staff alerts, contact form) is
logged, not sent, until both exist. Check what is actually running with
`curl …/health`; do not trust this line over that answer.

---

## Why this exists (vs. `safeguard-stripe-backend`)

The existing Worker is shared with the SafeGuard app and has three problems for
a class-booking business:

| Problem in the old Worker | Fixed here |
|---|---|
| **Paid orders were only `console.log`ged** — no database write, no email. A booking took the money and told nobody. | Every completed checkout is written to D1 and emailed. Storage happens *before* notification, so a mail failure can't lose the order. |
| **The client sent its own `price_cents`** — a crafted request could buy a $695 class for $1. | The client sends only a SKU. The Worker looks the price up in D1. |
| Membership plans hardcoded to 4 SafeGuard keys | Plans resolve from D1, falling back to `STRIPE_PRICE_<KEY>` env vars. New tiers need no redeploy. |

Also hardened: CORS allowlist instead of `*`, constant-time webhook signature
comparison, a 5-minute replay window, and Stripe return URLs validated against
the allowlist so checkout can't be redirected off-site.

The old Worker is left untouched — it still serves SafeGuard.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness check |
| `GET` | `/catalog` | Classes and prices the server considers authoritative |
| `GET` | `/weekends` | Training weekends the calendar may offer |
| `POST` | `/register` | **The registration flow**: details → two eligibility questions → agreement → refund consent → Stripe Checkout |
| `POST` | `/create-booking` | Legacy one-time seat with no screening (kept for the WordPress theme) |
| `POST` | `/create-membership` | Recurring tier → Stripe Checkout |
| `POST` | `/contact` | Site contact form and capability-statement requests (honeypot, validation, one email to `NOTIFY_EMAIL` with reply-to the sender) |
| `POST` | `/webhook` | Stripe events; persists orders, links registrations, sends the documents |
| `GET` | `/roster?key=…` | Admin: recent bookings (`&sku=MAST-DA`), or `&view=registrations` for the screening → payment records, review items first |
| cron | daily 09:17 UTC | Purges eligibility answers past `purge_after`; marks day-old unpaid registrations abandoned |

`POST /register` body — the page sends what the participant saw; there is **no
price field**, and the three `version` values must match the Worker's
`QUESTIONS_VERSION`, `AGREEMENT_VERSION` and `REFUND_POLICY_VERSION` or the
request is refused with 409 (stale terms):

```json
{ "sku": "MAST-HG-FUND", "qty": 1, "session_date": "2026-10-10", "session_label": "Sat, Oct 10, 2026",
  "customer": { "name": "Jane Doe", "email": "jane@example.com", "phone": "(713) 555-0100", "organization": "" },
  "eligibility": { "us_citizen": true, "felony_prohibited": false, "attested": true, "questions_version": "2q-2026-09-03" },
  "agreement": { "version": "81961f2a07675eff", "signed_name": "Jane Doe", "initials": "JD",
                 "address1": "1 Main St", "address2": "Houston, TX 77002",
                 "emergency_name": "John Doe", "emergency_phone": "(713) 555-0199", "emergency_relationship": "Spouse",
                 "scrolled": true, "agreed": true },
  "refund": { "accepted": true, "version": "2026-09-01-draft" },
  "newsletter_opt_in": false, "success_url": "…", "cancel_url": "…" }
```

Responses: `200 {checkoutUrl, sessionId, registration_id}` — the participant is
cleared and goes to Stripe; `202 {review: true, registration_id, message}` — a
disqualifying answer stopped the flow **before payment**, staff were notified
(name, course, registration id; never the answers or which question), nothing was
charged; `400/404/409` with `error` and a `field` hint.

What is stored where: `registrations` (who, what, the agreement attestation with
time/IP/user agent, the refund-policy acceptance, newsletter opt-in);
`eligibility_outcomes` (cleared/flagged, kept); `eligibility_answers` (the two
booleans, purged by the cron: cleared = class date + 7 days, flagged = 30 days).
The answers are never emailed, never in Stripe metadata, never in a log line.

After payment the webhook marks the registration paid, copies the refund consent
onto the `orders` row, fills the agreement PDF (`src/agreement.js`, pdf-lib,
flattened, attestation stamped on the signature line) and sends: the participant
a confirmation with the range address (`RANGE_ADDRESS`, sent nowhere else) and
the PDF; `DOC_RECIPIENTS_AGREEMENT` the PDF and nothing else. Staff get the usual
roster notice at `NOTIFY_EMAIL`.

## Deploy

> **YOU RUN THIS — copy-paste into Terminal.** Steps 1, 3 (the first five
> secrets) and 5 were run on 2026-09-03 for v1.0. For v1.1 (registration) run
> steps 0, 2, the three new secrets in 3, and 4 again.

```bash
cd mast-backend
npm install -g wrangler   # if not already installed
wrangler login

# 0. Dependencies (pdf-lib fills the agreement; wrangler bundles it)
npm install

# 1. Create the database, then paste the printed database_id into wrangler.toml
wrangler d1 create mast_bookings

# 2. Create the tables and seed the class catalog (idempotent: CREATE TABLE IF NOT EXISTS)
wrangler d1 execute mast_bookings --remote --file=schema.sql

# 3. Secrets (never commit these)
wrangler secret put STRIPE_SECRET_KEY        # sk_test_… first, sk_live_… when ready
wrangler secret put STRIPE_WEBHOOK_SECRET    # whsec_… from step 5
wrangler secret put RESEND_API_KEY           # re_… from resend.com
wrangler secret put NOTIFY_EMAIL             # where booking alerts and review notices go
wrangler secret put ADMIN_KEY                # long random string for /roster
wrangler secret put RANGE_ADDRESS            # street address of the range; only ever emailed to a paid participant
wrangler secret put RANGE_COORDS             # "lat, lon" for the directions line (optional)
wrangler secret put DOC_RECIPIENTS_AGREEMENT # comma-separated: range host + staff who receive the signed agreement

# 4. Deploy
wrangler deploy

# 5. In the Stripe dashboard, add a webhook endpoint:
#      https://mast-booking-backend.<subdomain>.workers.dev/webhook
#    Events: checkout.session.completed, customer.subscription.deleted,
#            invoice.payment_failed
#    Copy the signing secret into STRIPE_WEBHOOK_SECRET (step 3), redeploy.
```

Then confirm it is actually running — merged and deployed are different things:

```bash
curl https://mast-booking-backend.<subdomain>.workers.dev/health
curl https://mast-booking-backend.<subdomain>.workers.dev/catalog
wrangler tail                      # watch a live test booking arrive
```

## Setting the real prices

The seed prices in `schema.sql` are **unconfirmed placeholders**. Stripe charges
exactly what the `offerings` table says.

```bash
wrangler d1 execute mast_bookings --remote \
  --command "UPDATE offerings SET price_cents = 45000 WHERE sku = 'MAST-HG-OP'"

wrangler d1 execute mast_bookings --remote \
  --command "SELECT sku, name, price_cents FROM offerings ORDER BY sort_order"
```

Keep the display prices on the site in step with this table — the page shows
`price_cents` from its own config, while the charge comes from D1.

## Adding a membership tier

1. Create a recurring Price in Stripe → copy its `price_…` ID.
2. Insert the tier:

```bash
wrangler d1 execute mast_bookings --remote --command \
  "INSERT INTO memberships (plan_key, name, stripe_price_id, price_cents, interval, sort_order)
   VALUES ('range_member', 'Range Member', 'price_1Abc…', 9900, 'month', 1)"
```

3. Publish a matching Membership in WordPress with **Stripe plan key** =
   `range_member`. The Memberships section appears once a tier exists.

## Pulling a class roster

```bash
curl "https://mast-booking-backend.<subdomain>.workers.dev/roster?key=$ADMIN_KEY&sku=MAST-DA"
```

## Tests

```bash
node test-worker.mjs
```

90 assertions, all passing as committed (the first three parse every file under
`src/` with `node --check`, because the PDF asset module is never imported by the
tests and a syntax error there once reached `wrangler deploy`): server-side pricing (an injected
`price_cents` is ignored), unknown SKU and bad email rejection, qty clamping,
off-origin redirect rejection, training-weekend validation, membership plan
resolution, webhook signature acceptance/forgery/replay/tamper, order
persistence, notification send, roster auth, CORS origin echoing; and for the
registration flow: a cleared participant reaches Stripe with the registration id
in metadata, a disqualifying answer stops with 202 and no Stripe call, the staff
notice carries neither the answers nor the question, every missing field and
every stale version is refused before Stripe, the webhook links the registration
and copies the refund consent onto the order, the confirmation email names the
course and the refund terms and no email carries the answers, the retention cron
purges only expired answers, and the real agreement PDF fills and flattens.

The suite stubs Stripe, Resend, and D1 — it never touches a live service, so it
is safe to run anywhere and proves logic, not deployment. (It needs
`npm install` once, for pdf-lib.)

## Configuration reference

| Name | Kind | Purpose |
|---|---|---|
| `ALLOWED_ORIGINS` | var | Comma-separated CORS + redirect allowlist |
| `SITE_URL` | var | Fallback base for return URLs |
| `NOTIFY_FROM` | var | From address on notification emails |
| `DB` | D1 binding | `mast_bookings` database |
| `STRIPE_SECRET_KEY` | secret | Stripe API key |
| `STRIPE_WEBHOOK_SECRET` | secret | Webhook signature verification |
| `RESEND_API_KEY` | secret | All email: staff notices, participant confirmation, agreement delivery |
| `NOTIFY_EMAIL` | secret | Staff recipient(s) for booking alerts and eligibility-review notices, comma-separated |
| `ADMIN_KEY` | secret | Guards `GET /roster` |
| `RANGE_ADDRESS` | secret | Range street address; emailed only to a paid participant, never on the site |
| `RANGE_COORDS` | secret | Optional "lat, lon" for the directions line |
| `DOC_RECIPIENTS_AGREEMENT` | secret | Range host + staff who receive the signed agreement PDF (and nothing else) |
| `STRIPE_PRICE_<PLAN>` | secret | Optional per-plan fallback price ID |

## Behaviour when something is missing

Deliberately loud rather than silently broken:

- **No `STRIPE_SECRET_KEY`** → checkout returns 503 "call to book", nothing charged.
- **D1 unbound** → the order is logged at `error` level with full details so it
  can be recovered from `wrangler tail`, and the notification email carries a
  warning that the record did not persist.
- **Email unconfigured** → the order is still stored; the details are logged at
  `error` level.
- **Plan key with no Price ID** → 400 naming the exact env var to set.

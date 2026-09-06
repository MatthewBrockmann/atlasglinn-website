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
| `GET` | `/health` | Liveness check; `build` = the commit the running deploy was made from (`wrangler deploy --var BUILD:<sha>`, set by `scripts/wp-upload.sh` and `deploy-worker.yml`; `null` after a plain `wrangler deploy`), `crm: true` since the CRM build, `directions` = `sealed` (the owner's range PDF decrypts on this Worker) · `secrets` (rendered from `RANGE_*`) · `none` · a `sealed-*` failure |
| `GET` | `/directions-key` | The public half of the Worker's sealing key (RSA-OAEP, made on first use, private half only in D1). `node mast-backend/seal-directions.mjs <pdf> <this json>` turns the private range-directions PDF into `assets/range-directions.sealed.json` (ciphertext only, committed to main); the Worker fetches and decrypts it at send time. The plaintext PDF is never in git |
| `GET` | `/catalog` | Classes and prices the server considers authoritative |
| `GET` | `/weekends` | Training weekends the calendar may offer |
| `POST` | `/register` | **The registration flow**: details → two eligibility questions → agreement → refund consent → Stripe Checkout |
| `POST` | `/create-booking` | Legacy one-time seat with no screening (kept for the WordPress theme) |
| `POST` | `/create-membership` | Recurring tier → Stripe Checkout |
| `POST` | `/contact` | Site contact form and capability-statement requests (honeypot, validation, one email to `NOTIFY_EMAIL` with reply-to the sender) |
| `POST` | `/webhook` | Stripe events; persists orders, links registrations, sends the documents |
| `GET` | `/roster?key=…` | Admin: recent bookings (`&sku=MAST-DA`), or `&view=registrations` for the screening → payment records, review items first |
| `POST` | `/event` | First-party beacon from the pages (`action` in a fixed list: view, open_class, pick_date, start_registration, checkout, contact, gear_request, video_play, follow…), with the visitor id and first-touch attribution; feeds the CRM funnel |
| `POST` | `/subscribe` | Newsletter sign-up: `{email, name?, consent: true, source?, attribution?}`; stored as a lead with the consent wording, upserted to Mailchimp when configured |
| `GET` | `/admin` | The staff CRM page (noindex, no-store); the key goes in the page and travels as `X-Admin-Key` |
| `GET` | `/admin/crm?key=…` | Profiles (orders + registrations + accounts + leads merged by email), segments, funnel, revenue by course and by UTM source, journeys log; `&view=summary` = counts only |
| `GET` | `/admin/audience.csv?key=…` | The opted-in audience as CSV (Mailchimp / any list tool imports it) |
| `POST` | `/admin/sync?key=…` | Push every opted-in profile to Mailchimp (no-op until `MAILCHIMP_*` exist) |
| `POST` | `/admin/journeys?key=…` | Run today's T−7 / T−1 / T+1 emails now (idempotent through `email_log`) |
| `POST` | `/account/register` | Student account sign-up (email, password ≥ 10, name, phone). Answers **202 pending** and emails a 6-digit code; no token until the code comes back. An unverified address can be signed up again (the slot is taken over), so nobody can squat a student's email |
| `POST` | `/account/verify` | `{email, code}` → the account goes live; answers the sign-in token. 15-minute codes, five tries, one at a time |
| `POST` | `/account/resend` | New verification code (at most once a minute); always 200 so it does not reveal which emails have accounts |
| `POST` | `/account/login` | `{email, password}` → token. A right password on an unverified email answers 403 `unverified` and re-sends the code |
| `POST` | `/account/forgot` / `/account/reset` | Forgotten password: `forgot {email}` emails a reset code (always 200); `reset {email, code, password}` sets the new password, signs every other session out and answers a token |
| `GET` | `/account/me` | Bearer token → profile, classes taken (paid/completed registrations under the account email), saved card (brand, last four, expiry) |
| `POST` | `/account/update` / `/account/password` / `/account/setup-payment` | Bearer token → profile details; password change (needs the current one); Stripe Checkout in setup mode to save a card on the account's Stripe Customer |
| cron | daily 09:17 UTC | Purges eligibility answers past `purge_after`; marks day-old unpaid registrations abandoned; removes day-old unverified accounts |

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
  "refund": { "accepted": true, "version": "2026-09-01" },
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

> **Automatic since 2026-09-05:** `.github/workflows/deploy-worker.yml` runs the tests and `wrangler deploy` on every
> push to `main` that touches `mast-backend/`, once the repository secrets `CLOUDFLARE_API_TOKEN` and
> `CLOUDFLARE_ACCOUNT_ID` exist (Settings → Secrets and variables → Actions). Until they do, the job runs the tests and
> stops with a notice. A repository secret named `WORKER_RESEND_API_KEY`, `WORKER_ACCOUNT_SECRET` or `WORKER_NOTIFY_EMAIL`
> is pushed to the Worker after each deploy (rotate a key from a phone: set the repository secret, run the workflow).
> Other Worker secrets and D1 migrations (steps 2 and 3 below) stay manual.

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
wrangler d1 execute mast_bookings --remote --file=migrations/001-prereq-attested.sql   # once, on a database created before 2026-09-04
wrangler d1 execute mast_bookings --remote --file=migrations/002-ladies-handgun.sql    # once: the ladies-only Handgun class
wrangler d1 execute mast_bookings --remote --file=migrations/003-membership-teams.sql  # once: the six membership teams (the Worker creates each plan's Stripe Price on the first join)
wrangler d1 execute mast_bookings --remote --file=migrations/004-accounts.sql          # once: student accounts (owner, 2026-09-05)
wrangler d1 execute mast_bookings --remote --file=migrations/005-account-verification.sql  # once, after 004: email verification + password reset columns (a second run fails with "duplicate column", which means it is already applied)

# 3. Secrets (never commit these)
wrangler secret put STRIPE_SECRET_KEY        # sk_test_… first, sk_live_… when ready
wrangler secret put STRIPE_WEBHOOK_SECRET    # whsec_… from step 5
wrangler secret put RESEND_API_KEY           # re_… from resend.com
wrangler secret put NOTIFY_EMAIL             # where booking alerts, review notices, contact requests and membership credentials go
# Every email is also blind-copied to matthew@atlasglinn.com and matthew@mastsolutions.com (owner, 2026-09-05);
# set BCC_ALWAYS in wrangler.toml [vars] to change the list, or to "" to stop the copies.
wrangler secret put ADMIN_KEY                # long random string for /roster
wrangler secret put RANGE_ADDRESS            # street address of the range; only ever emailed to a paid participant
wrangler secret put RANGE_COORDS             # "lat, lon" for the directions line (optional)
wrangler secret put RANGE_DIRECTIONS         # the driving directions as Markdown; rendered to the PDF attached to the confirmation and the T−7 / T−1 emails
wrangler secret put DOC_RECIPIENTS_AGREEMENT # comma-separated: range host + staff who receive the signed agreement
wrangler secret put ACCOUNT_SECRET           # long random string (e.g. `openssl rand -base64 48`) that signs student sign-in tokens and the
                                             # emailed verification / reset codes; without it every /account/* route answers 503 and the page
                                             # hides nothing but cannot sign anyone in. Rotating it signs everyone out and voids any code in
                                             # flight; nothing else is lost (passwords are salted PBKDF2 hashes in D1). Sign-up, verification
                                             # and password reset also need RESEND_API_KEY (the code is emailed); without it they answer 503.

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

105 assertions, all passing as committed (the first three parse every file under
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


## CRM and marketing (2026-09-06)

`src/crm.js` — first-party only, per `DATA-AND-MARKETING.md` ("build the CDP pattern, skip the DMP"):

- **Collects** every inquiry as a lead in `contacts` (contact form, capability statement, private instruction, gear quotes, the
  Atlas EP access form, newsletter sign-ups) *before* it is emailed, with UTM, referrer, landing page, first touch and the
  visitor id the pages keep in localStorage; a beacon (`/event`) records views and the moments that lead to a seat; the
  registration and the order carry the same attribution (revenue per channel in SQL).
- **Profiles** one record per email across orders, registrations, accounts and leads; segments: opted_in, lead,
  fundamentals_only, win_back, abandoned_30d, upcoming, review, agency, gear, account.
- **Activates** the opted-in audience as CSV or to Mailchimp (gated on the tick, never on a purchase), and the journeys from
  the daily cron: T−7 and T−1 reminders, T+1 thank-you with the review ask, the next course and the Instagram link — one
  per participant, class and kind (`email_log`), transactional, no unsubscribe.
- **Never** eligibility answers: not in the CRM payload, the CSV, Mailchimp or the beacon.
- Schema (`migrations/006-crm.sql`) is applied by the Worker itself on first use.

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
| `ADMIN_KEY` | secret | Guards `GET /roster` and everything under `/admin` |
| `MAILCHIMP_API_KEY` | secret | Marketing list (ARCHITECTURE §7). With `MAILCHIMP_AUDIENCE_ID` (and `MAILCHIMP_SERVER` when the key carries no `-usNN` suffix) the opted-in profiles are upserted on payment, on sign-up and by `/admin/sync`; without them the CSV export is the path |
| `BREVO_API_KEY` | secret | The other list tool on the domain (atlasglinn.com's DNS carries Brevo). Opted-in profiles are upserted to Brevo the same way as Mailchimp; optional numeric `BREVO_LIST_ID` puts them on one list |
| `HUBSPOT_TOKEN` | secret | HubSpot private-app token (`crm.objects.contacts` write). With it every profile and every new lead is upserted as a HubSpot contact by email (`lifecyclestage` lead or customer) — a CRM record, not marketing consent, so it is not gated on the newsletter tick |
| `JOURNEYS_ENABLED` | var | `"1"` switches the daily T−7 / T−1 / T+1 emails on; `"0"` (the default) until the owner approves the texts |
| `REVIEW_URL` | var | Optional review link in the T+1 email; without it the email asks for a reply that may be quoted |
| `BUILD` | var (deploy flag) | Not in `wrangler.toml`: passed as `--var BUILD:<short sha>` by the two deploy paths and echoed by `/health` so a runner can tell which merge is running |
| `RANGE_ADDRESS` | secret | Range street address; emailed only to a paid participant, never on the site |
| `RANGE_COORDS` | secret | Optional "lat, lon" for the directions line |
| `RANGE_DIRECTIONS` | secret | The driving directions as Markdown (`#` headings, `-` bullets, plain paragraphs; a few KB). `src/directions.js` renders it with the address and coords into `MAST-Range-Directions.pdf`, attached to the booking confirmation and the T−7 / T−1 reminders (owner, 2026-09-06: "ADD THE PDF WITH DIRECTIONS"). Unset = no attachment; the emails then point at the confirmation |
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

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
| `GET` | `/roster` | Admin (`X-Admin-Key` header — every admin route, header only): recent bookings (`&sku=MAST-DA`), or `&view=registrations` for the screening → payment records, review items first |
| `POST` | `/admin/tax/setup` | Admin: run the Stripe Tax setup for Houston, Texas now, or report it. Idempotent — reads before it writes, holds a D1 lock, sends deterministic `Idempotency-Key`s. The Worker also runs this itself (a cron every five minutes, the daily cron, and a refresh enqueued behind a checkout that finds the measurement due — never on the customer's path), so nothing depends on it being called. `?dry=1`, and any `GET`, report `tax_ready`, the readiness cache and the setup heartbeat **from D1 alone** — no Stripe call, no row written, so they report no `settings` or `registration`. See **Sales tax (Texas)** |
| `POST` | `/event` | First-party beacon from the pages (`action` in a fixed list: view, open_class, pick_date, start_registration, checkout, contact, gear_request, video_play, follow…), with the visitor id and first-touch attribution; feeds the CRM funnel |
| `POST` | `/subscribe` | Newsletter sign-up: `{email, name?, consent: true, source?, attribution?}`; stored as a lead with the consent wording, upserted to Mailchimp when configured |
| `GET` | `/admin` | The staff CRM page (noindex, no-store); the key goes in the page and travels as `X-Admin-Key` |
| `GET` | `/admin/crm` | Profiles (orders + registrations + accounts + leads merged by email), segments, funnel, revenue by course and by UTM source, journeys log; `&view=summary` = counts only |
| `GET` | `/admin/audience.csv` | The opted-in audience as CSV (Mailchimp / any list tool imports it) |
| `POST` | `/admin/sync` | Push every opted-in profile to Mailchimp (no-op until `MAILCHIMP_*` exist) |
| `POST` | `/admin/journeys` | Run today's T−7 / T−1 / T+1 emails now (idempotent through `email_log`) |
| `POST` | `/account/register` | Student account sign-up (email, password ≥ 10, name, phone). Answers **202 pending** and emails a 6-digit code; no token until the code comes back. An unverified address can be signed up again (the slot is taken over), so nobody can squat a student's email |
| `POST` | `/account/verify` | `{email, code}` → the account goes live; answers the sign-in token. 15-minute codes, one at a time, five wrong guesses per connection and twenty in total |
| `POST` | `/account/resend` | New verification code (at most once a minute); always 200 so it does not reveal which emails have accounts |
| `POST` | `/account/login` | `{email, password}` → token. A right password on an unverified email answers 403 `unverified` and re-sends the code |
| `POST` | `/account/forgot` / `/account/reset` | Forgotten password: `forgot {email}` emails a reset code (always 200); `reset {email, code, password}` sets the new password, signs every other session out and answers a token |
| `GET` | `/account/me` | Bearer token → profile, classes taken (paid/completed registrations under the account email), saved card (brand, last four, expiry) |
| `POST` | `/account/update` / `/account/password` / `/account/setup-payment` | Bearer token → profile details; password change (needs the current one); Stripe Checkout in setup mode to save a card on the account's Stripe Customer |
| `GET` | `/admin/crm?view=weekly` | The Monday digest as `text/plain`, exactly as it is emailed |
| cron | daily 09:17 UTC | Purges eligibility answers past `purge_after`; marks day-old unpaid registrations abandoned; removes day-old unverified accounts; **on Monday** (or the Tuesday/Wednesday retry if Monday failed) also emails the CRM digest; and runs the Stripe Tax loop |
| cron | every 5 min | Stripe Tax only: re-measure the account when the cached measurement is due and run the idempotent self-setup when it is not collecting. `scheduled()` branches on `event.cron`, so the daily work above stays daily. See **Sales tax (Texas)** |

Every `/admin` route and `/roster` take the key in the **`X-Admin-Key` header**.
The `?key=` query form was removed 2026-09-09 and now answers 401 on every one of
them: a key in a URL lands in browser history, in a `Referer`, and in every log
between the browser and Cloudflare. The staff page at `/admin` already sends the
header, and so do both workflows.

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
wrangler d1 execute mast_bookings --remote --file=migrations/007-account-credentials.sql   # once, after 005: LE / teacher credential columns (006 is applied by the Worker itself)
wrangler d1 execute mast_bookings --remote --file=migrations/008-rate-limits.sql           # once, after 007: rate_limits table, the sign-in lockout columns and accounts.signup_notice_sent_at

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

## Sales tax (Texas)

Owner, 2026-09-08: *"Also, a stripe taken out sales tax for Houston, Texas"*, and
on 2026-09-09, asked directly whether the business holds a Texas Sales and Use Tax
Permit: **"yes"**. That permit is the thing that makes collecting lawful, and it is
his statement — this repo does not hold the permit number and does not need it.

**What is collected.** Texas state and local sales tax on sales sourced to the
Houston head office, computed by Stripe Tax at checkout. Collection is
**exclusive**: the tax is added **on top of** the listed price and shown as its own
line. A $695 class stays $695 on the page. Tax is never folded into the price.

**Nobody sets this up. The Worker does — and never while a customer is waiting.**
Two conditions decide whether a checkout asks Stripe for tax, and the second one is
a cached measurement, not a setting and not a live call:

1. `STRIPE_TAX = "1"` in `wrangler.toml` — the owner's switch.
2. `taxReadyCached()` — **one D1 read** of the `tax:ready` row, written off-path by
   something that read `GET /v1/tax/settings` and
   `GET /v1/tax/registrations?status=active` and found the settings `active` **and**
   an **active** `US` / `TX` / `state_sales_tax` registration.

Both, or the Checkout Session body is byte-identical to the pre-tax one and a
single structured line says why (`{"tax_skipped":"…"}`). So `automatic_tax` can
never reach an account that is not collecting, whatever CI did or did not run.

**STRIPE IS NEVER CALLED ON THE CUSTOMER'S PATH.** That is the design rule, and it
is the round-2 security finding it exists to close: measuring on the path let ten
anonymous checkouts drive eleven Stripe tax POSTs and sixty-one GETs — no dedupe,
no ceiling, rotating IPs defeating the per-IP limit — against the same Stripe rate
budget the Checkout Session itself needs, and a tax endpoint that merely *hung*
held every checkout open behind it. Now:

* **A checkout reads the cache and nothing else.** It asks that row two separate
  questions, and conflating them is what sold orders untaxed through round 3:
  *is a re-measurement due* (fresh: ≤10 min, or ≤60 s for a measurement that
  failed), and *does the last measurement say the account is collecting*. A
  measurement that said **ready** is trusted for **24 hours** — LAST-KNOWN-READY —
  so a stale one still taxes the order while the loop catches up. **A measured
  not-ready, a measurement that could not be made, or nothing measured inside a
  day → tax off**, byte-identical body, one `tax_skipped` line naming which.
* **The measurement it did not make is enqueued behind the response**
  (`ctx.waitUntil`), and that refresh **does nothing at all unless it can take the
  `tax:lock` row**. A held lock means someone is already measuring — no Stripe
  call, at all. So an unauthenticated burst of any size costs **at most one
  measurement and one setup attempt per lock window (60 seconds)**, not one per
  request. A test drives 100 checkouts through it and pins the Stripe call count to
  the count a single checkout costs.
* **A fresh measurement that says NOT ready enqueues nothing.** The cron and the
  next stale window are what retry. That is what stops an account nobody can repair
  — Stripe Tax terms not accepted, say — from being retried on every checkout
  forever.
* **The trigger that keeps it warm is a cron every five minutes**
  (`wrangler.toml [triggers]`, `*/5 * * * *`; `scheduled()` branches on
  `event.cron` so the daily work stays daily). It re-measures only when the
  measurement is due, so a ready account costs one D1 read per tick and two Stripe
  GETs per ten minutes — about 288 reads a day, no writes. **This is the fix for
  the design's worst bug.** Round 3 paired the ten-minute TTL with a daily cron, so
  the measurement was fresh for 10 minutes out of 1440 and clustered orders were
  taxed while isolated ones never were — measured in review as **20 isolated
  orders, 0 taxed**. A completed Checkout Session cannot be re-taxed afterwards,
  and the permit holder owes Texas the difference out of margin.
* **The daily cron still runs the same tax work**, so the two triggers cover each
  other, and neither needs a repository secret.

**What silence costs, exactly.** Trigger firing → every order taxed. Trigger quiet
for up to 24 hours → orders keep being taxed on the last measurement that said
ready, and each checkout enqueues the refresh behind its own response. Past 24
hours → **fail closed**: tax comes off rather than trusting a day-old reading of an
account that may have changed, and the first checkout after that re-triggers the
measurement. Tests simulate all three against a virtual clock.

**And if last-known-ready is ever WRONG, the customer never sees it.** Stripe
refuses a Session carrying `automatic_tax` when Tax is not active on the account.
That refusal is retried **once**, with the tax fields removed — the byte-identical
pre-tax body — the readiness row is written back as *unmeasured* on its 60-second
negative TTL so the next checkouts do not repeat the failure, and one
`{"tax_fallback":…}` line records it with the reason redacted. **Tax-class refusals
only** (`automatic_tax`, `tax`, `registration` in the code or message), and only
when the body actually carried tax fields: a declined card is an answer, and
re-sending it would be a second charge attempt.

**Every Stripe call in the tax path is on a clock** (`STRIPE_TAX_TIMEOUT_MS`,
default 4 s, **clamped to 500 ms – 15 s**). A timeout is not a measurement: it is
cached as *unmeasured* with a short **60-second** negative TTL, so the next checkout
neither re-triggers it immediately nor waits ten minutes for recovery, and the
heartbeat records the outcome as `timeout`. **An account that could not be READ is
never WRITTEN to.** The clamp is why the sentence "nothing in the tax path outlives
the clock" is true of the clock itself: an operator typo of `999999999` used to
remove it entirely, freeing the lock after its minute while the previous fetch was
still open, so a new orphaned Stripe request could start every minute forever.

**The membership Price call is on the same clock and behind the same gate.**
`ensureMembershipPrice` provisions a Stripe Price on the first join of a plan; both
of its calls now go through the bounded `stripeCall`, so a hung `/v1/prices` can no
longer hold a membership join open (measured at 3.1 s against a 3 s stub before
this change; the join now answers the same clean 400 it answers for a plan with no
price). `product_data[tax_code]` rides on it only when the **cached measurement
says the account is collecting** — the same gate the Session uses, not the switch
alone as it was through round 3.

One writing run at a time: the `tax:lock` row in D1 (INSERT-if-absent with an
expiry, so a crashed run frees itself), **held for a further 60 s after the run
finishes** rather than deleted — deleting it made the real window "one run's
duration", which is no ceiling at all. Both POSTs carry deterministic
`Idempotency-Key` headers — `mast-tax-settings-v1` and `mast-tax-reg-us-tx-v1`.
Being exact about which control does what: **the Idempotency-Key is what makes a
duplicate Texas registration impossible** (an expired-lock takeover can legitimately
run beside a stalled holder); the lock is a **throttle** on the work. Saying it the
other way round, as this file used to, overstated the lock.

**Precondition, stated because it is not rhetorical: D1 must be writable.** No D1 =
no lock = no run, and no readiness row = no tax. A degraded Worker sells untaxed;
it does not write to Stripe.

**The manual trigger, over the API, with no Dashboard.** The owner is locked out of
the Stripe Dashboard, so every step is an API call the Worker's own key already
authorises, behind `ADMIN_KEY`. Nothing depends on this being run:

```
curl -sS -X POST -H "X-Admin-Key: <the Worker's ADMIN_KEY>" \
  https://mast-booking-backend.matthew-221.workers.dev/admin/tax/setup
```

It is **idempotent**. Each step reads before it writes:

1. `GET /v1/tax/settings` → if the head office is missing or the status is not
   `active`, `POST` the Houston origin address (2450 Fondren Rd, Suite 255,
   Houston, TX 77063, US) with `defaults[tax_behavior]=exclusive` and the services
   tax code.
2. `GET /v1/tax/registrations` for `active` **and** `scheduled` → if none is
   `country=US`, `country_options.us.state=TX` **and
   `country_options.us.type=state_sales_tax`**, `POST` one (`active_from=now`). A
   registration for another state is not Texas; a Texas registration of another
   **type** (say `local_lease_tax`) is not a sales-tax registration and does not
   satisfy it either — that hole is why the type is checked. A *scheduled* Texas
   sales-tax registration blocks a duplicate (creating a second one is not
   undoable) but is reported as **registered, not collecting yet** and does **not**
   make the account ready. No other registration is ever touched.
3. Re-read the settings, so the reported status is the one the account ended on.

Run it twice and the second run writes nothing and says so. A Stripe error comes
back named by the step that hit it, with a 502, as `{step, type, code, message}` —
**redacted in the Worker**, so every consumer gets the scrubbed answer rather than
just the two workflows that happen to print it. Nothing is retried.

**To just look, without changing anything:** add `?dry=1`, or use `GET`. That form
reads **D1 and nothing else** — no Stripe call, no row written — so looking at the
readiness cannot change it. (Through round 3 it re-measured the account and rewrote
the row every checkout gates on, while four shipped strings called it read-only; a
smoke run that caught a Stripe timeout left the next minute of checkouts untaxed.
That is also why it needs no lock: ten reports cost ten D1 SELECTs.) It therefore
reports no `settings` or `registration` — **the live read of the account is the
`POST`**, which deploy-worker.yml runs after every deploy. The *Smoke-test the MAST
Worker* workflow runs the read-only form; the result lands in that run's job summary
under "Stripe Tax — Houston, Texas":

| field | what it tells you |
|---|---|
| `tax_ready` + `tax_ready_reason` | the exact boolean every checkout gates on, and why (`active`, `last_known_ready`, `measurement_expired`, `settings_status:…`, `never_measured`…) |
| `tax_ready_cache` | the row itself: `measured_at`, `age_seconds`, `ttl_seconds` (600, or 60 for a measurement that failed), `grace_seconds` (86400) and `stale` — a `stale: true` here means the five-minute trigger is overdue |
| `last_run` | the heartbeat: when a setup run last held the lock, its outcome, its age, and `stale: true` past 25 hours |

**What CI does, and what it does not.** `deploy-worker.yml`'s tax step is a
**report, not a gate**. With a repository secret `ADMIN_KEY` it runs the setup
immediately instead of waiting for the cron, prints the report, and fails the job
only if `tax_ready` is still false afterwards — a *revenue* condition (Texas tax is
not being charged), never a broken-checkout one. Without `ADMIN_KEY` it prints a
`::notice::` and exits 0, and that exit is honest: the Worker cannot enable
`automatic_tax` on an account it has not measured, so a deploy with no secret
cannot produce a tax-broken checkout. It will simply not collect tax until the
next cron run, or until the refresh behind a checkout repairs the account.

**To turn it off.** Set `STRIPE_TAX = "0"` in `wrangler.toml` and redeploy (push to
`main`, or run *Deploy MAST Worker*). Every request body then goes back to being
byte-identical to the pre-tax one — a test pins that exact string against the body
measured from the pre-change Worker. Nothing on the Stripe account needs undoing;
the Worker simply stops asking.

**Tax codes — verified.** `txcd_20030000` "General - Services" for everything sold
today: training courses, private instruction, experiences and memberships.
`txcd_99999999` "General - Physical Goods" (any tangible or physical good; the
standard rate applies) is defined for IWA devices should gear ever be sold through
Checkout; **no route sells goods today**, so nothing carries it. Both ids read
2026-09-09 00:52 UTC from Stripe's published list,
<https://docs.stripe.com/tax/tax-codes>. That page does not open from inside the
build container — the agent proxy answers 403 to CONNECT — so the in-account
confirmation, if you want a second one against the live key, is:

```
curl -sS -u "<STRIPE_SECRET_KEY>:" "https://api.stripe.com/v1/tax_codes?limit=100"
```

**The one body that was not byte-identical — closed.** The claim above is about the
**Checkout Session** body. `POST /v1/prices`, the call that provisions a membership
Price on its first join, used to carry `product_data[tax_code]` whenever
`STRIPE_TAX` was `"1"`, gated on the switch alone. It is now behind the same cached
readiness as the Session, so with the account not measured collecting **every** body
this Worker sends Stripe is byte-identical to the pre-tax one. The residual that
motivated it — whether Stripe accepts `product_data[tax_code]` on a Price create
while Tax is inactive on the account — remains **UNVERIFIABLE FROM HERE**
(`api.stripe.com` answers `CONNECT tunnel failed, response 403` through this build
container), and the gate makes the question moot rather than answering it. The cost
is the migration gap below: a Price created during a not-ready window carries no
tax code until its Product is updated.

**Price migration — the one real gap.** A Checkout Session cannot override the tax
code of a *saved* Price, so a membership's code is set on its Product the single
time `ensureMembershipPrice` creates it. **Membership Prices that already exist —
created before this change, while `STRIPE_TAX` was not `"1"`, or while the account
was not measured collecting — keep whatever code Stripe defaulted them to.** Class bookings and registrations are unaffected:
they build `price_data` per session and carry the code every time. To migrate a
membership Price, set the code on its Product:

```
curl -sS -X POST https://api.stripe.com/v1/products/<product_id> \
  -u "<STRIPE_SECRET_KEY>:" -d tax_code=txcd_20030000
```

The product id is on the Price: `GET /v1/prices?lookup_keys[]=mast_<plan_key>`.

**Watch item on the first live membership join.** `/create-membership` sends
`billing_address_collection=auto` and this change did not alter it, because
changing it was not asked for. Stripe should collect the address it needs once
`automatic_tax` is on — if a membership checkout ever errors for a missing address,
that parameter is the first place to look.

**What Stripe does, and what still needs him.** Stripe calculates the tax, adds it
to the session and records it per transaction; `/admin/crm` and `/roster` show the
orders. **Stripe does not file the return.** The Texas Comptroller filing still
needs him (or his accountant): the taxable-sales and tax-collected figures come
from Stripe's tax reporting for the period, and the permit, the filing frequency
and the payment are his. Nothing in this repo files anything.

## Pulling a class roster

```bash
curl -H "X-Admin-Key: $ADMIN_KEY" \
  "https://mast-booking-backend.<subdomain>.workers.dev/roster?sku=MAST-DA"
```

## Tests

```bash
node test-worker.mjs               # the suite: 398 assertions, 0 failing as committed
node test-seat-claim-sqlite.mjs    # the seat claim against a real SQL engine, on its own
```

**398 assertions**, all passing as committed — the number is what the run printed, not a number from the last time
somebody looked (it read `105` until round 4, when the suite was at 383). The seat-claim file is imported by the suite
*and* runs on its own: run it directly and it prints every assertion and a summary line and **exits 1 on any failure**.
Until round 4 it printed nothing and exited 0 however it went, which is the exact shape of a test that looks like it
passed. `SEAT_CLAIM_ENGINE=python node test-worker.mjs` forces the python3 sqlite fallback, so that path is fired rather
than assumed.

The assertions cover (the first three parse every file under
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

**Weekly digest (owner, 2026-09-08: "Add to CRM backend + weekly CRM Emails to matthew@atlasglinn.com +
Matthew@mastsolutions.com").** The same daily cron checks the weekday and, on Monday (or the Tuesday/Wednesday retry
if Monday failed), emails one plain-text digest to `CRM_DIGEST_TO` — the last seven days beside the seven before
them: new leads by request type, accounts verified (counted in the week they verified, not the week they signed up),
registrations, paid orders with seats, memberships with their cash and revenue, the classes booked, and the leads that
never reached the office inbox (the `emailed` flag `POST /contact` sets when the notification to `NOTIFY_EMAIL`
goes out — it records that the office was told, not that anyone answered), then the lifetime totals from the
`crmSnapshot` summary. There is no second trigger to keep in step, and the digest is queued alongside the purge, in
its own promise with its own catch; a digest failure cannot reach the purge. Every read is strict — the `crmSnapshot`
summary behind the lifetime block included — so a D1 error rejects rather than mailing a week of zeros.
**Once per ISO week, claim before send:** the run writes its `email_log` row (`kind` `digest`, `ref` the week, e.g.
`2026-W36`, `email` the fixed literal `crm-digest` — the row claims the week, and the recipients are not its identity)
as `sending` *before* it calls Resend and flips it to `sent` after, so a week already claimed is never mailed twice while its claim row survives (a lost flip-to-`sent` write costs one duplicate, not the week)
however the run ends; a run that fails deletes its own claim, a claim it cannot write or read sends nothing at all, and
a `sending` row older than 30 minutes is a crashed run the next cron takes over. So a doubled Monday fire sends once,
while a Monday that failed is retried by the Tuesday or Wednesday cron. Unset `CRM_DIGEST_TO` (or no
`RESEND_API_KEY`) logs the digest and skips the send.
`GET /admin/crm?view=weekly` (X-Admin-Key header) returns the identical text for a runner reading it without the mailbox.
The contact notification no longer carries a `Page:` line (same instruction) — the page is still stored on the lead
row and still drives attribution.

## Rate limiting, lockout and seat holds (security review, 2026-09-08)

Everything below is D1 only — no new Cloudflare binding, nothing to provision. `migrations/008-rate-limits.sql` is the
schema — the `rate_limits` table, the two sign-in lockout columns and `accounts.signup_notice_sent_at`, with
`migrations/009-seat-claim.sql` adding `registrations.abandoned_reason` for the atomic seat claim; `src/ratelimit.js`
also self-heals the same objects on first use, so a Worker deployed ahead of the migration still limits. **Only a run in
which every statement succeeded is memoised** (round 2): a step that genuinely failed leaves the memo unset so the next
request retries it, where it used to record "done" and never try again for the life of the isolate. A `duplicate column`
error is the already-applied case and counts as success.

**Per account.** Five wrong passwords lock the account for 15 minutes, doubling at every further five up to a day. A
locked account is answered **before** the PBKDF2 runs, so guess six costs the Worker nothing — and the right password is
refused too, which is the point. Any successful sign-in, verification or reset clears the counter and the lock. The
failing attempt itself always answers the plain 401; the lock shows on the next one, so the fifth wrong password does not
announce that the address exists.

**Per (connection, address) — and this is what makes the lock symmetric** (round 2). The per-account lock cannot fire for
an address that has no account row, so the *sixth* wrong password used to answer `429 locked` for a real address and
`401` for an invented one: five throwaway guesses bought a definitive yes-or-no on any address. A second counter, keyed
on `(CF-Connecting-IP, normalised address)` and kept in `rate_limits`, now locks an unknown address on exactly the
attempt a known one locks on, with the same body — and both paths return before any hashing, so the refusal costs the
same time as well.

**And the wrong-password path costs the same too, since round 4.** `noteFailedLogin` ran only `if (acct)`, so a wrong
password at a real address spent an `UPDATE` and a read-back that an invented address did not, and a third statement on
every fifth try where the lock is written: 10 statements against 8, and 12 against 9 on the fifth. The 100k-iteration
PBKDF2 both branches run buried that in wall clock, which is why it was a broken parity claim rather than a usable
oracle — and why it is now measured in statements rather than milliseconds. `dummyFailedLogin` spends the same
statements against an id no row carries, laddered on the `(IP, address)` count. The residual, stated: that count is per
connection and `accounts.failed_logins` is global, so an address sprayed from several connections at once can put the
two ladders out of step by one statement on a fifth try. It is noise an attacker cannot aim, not a signal.

**What is still not symmetric, stated rather than claimed away:** the account lock is global and this one is per
connection, so five failures from one address followed by a sixth from *another* still answers 429 for a real account and
401 for an invented one. The remaining probe costs six requests from two addresses against a 20-per-window sign-in limit.

**Why it is left, corrected in round 4.** Round 3 wrote: *"the fix still hands a stranger the power to lock a paying
customer out of their own account, which is worse than the leak."* **That reason is wrong, and the shipped code
disproves it in six requests.** `noteFailedLogin` writes `accounts.locked_until` — a *global* per-account lock — on every
wrong password from *any* address, and `handleAccountLogin` reads it before the password is checked: five wrong
passwords from a stranger, and the owner's own correct password from their own untouched connection answers
`429 locked`. The system already hands a stranger that power. The honest reason to leave the cross-connection asymmetry
is narrower: a per-address lock would not remove the stranger-induced lockout that already exists, it would widen its
window and let an attacker grow `rate_limits` with addresses they invent. What keeps the existing lock a 15-minute
denial rather than a lockout is the escape hatch — `POST /account/forgot` → `POST /account/reset` both work on a locked
account, and a successful reset clears `locked_until`. Scoping the account lock so a guessing connection cannot spend
the owner's failure budget is the real fix, and it is not in this round.

**Per IP**, in 10-minute windows. The address is `CF-Connecting-IP` **and nothing else** (round 2): the old
`X-Forwarded-For` fallback was a header the caller sets, so rotating it bought a fresh window and stepped out of every
limit below. A request without the Cloudflare header shares the single `unknown` bucket.

| Route | Per window |
|---|---|
| `POST /account/login` | 20 |
| `POST /account/register` | 5 |
| `POST /account/forgot` + `POST /account/resend` + `POST /account/reset` | 20 **shared** — one password-reset budget: two of them mail a code to whatever address is posted and the third spends guesses against one. forgot and resend stop at 5 within it |
| the same two, **per posted address** | 3 an hour, whoever asks and from wherever (round 4) — see below |
| `POST /account/verify` | 20 |
| `POST /register` + `POST /create-booking` + `POST /create-membership` | 10 **shared** — all three open a Stripe Checkout Session, which costs money; the two legacy routes were unlimited until round 2 |
| `POST /contact` | 30 |
| `POST /subscribe` | 10 |
| `GET /roster` + **every** `/admin` route | 60 **shared** — matched by path PREFIX, so a route added under `/admin` is limited the day it is added rather than the day someone remembers to list it |
| `POST /event` | 60 |

**`/event` is back in the table (round 3), and the round-2 rationale for taking it out was wrong.** That rationale — a
counter in D1 turns every page view into a D1 write, so the counter costs more than the route it guards — is true about
the counter and beside the point about the route: **`/event` is itself an unauthenticated D1 INSERT.** Leaving it out
did not save a write; it removed the only bound on how many an anonymous caller could ask for, and a route that answers
`{ok:true}` and writes a row is a page-view beacon to a browser and a free write endpoint to anybody else. One counter
row per address per window against one row per beacon is the cheaper half of that trade, and a beacon answering 429
costs a visitor nothing. `failOpen` stayed gone: **every limited route fails CLOSED (429) when D1 fails**, `/event`
included, because a booking or a beacon refused for a minute is recoverable and an unmetered window is not.

**Per ADDRESS, on the two routes that mail one (round 4).** Every limit above is per IP, and that left the *mailbox*
uncapped: `codeTooSoon()` allows one code a minute and the `code` bucket allows five per window per connection, so
twelve connections spaced past the 60 seconds delivered twelve emails to one address — a ceiling of about 1,440 a day at
any mailbox on earth, sent from the firm's own Resend sending domain. That is a deliverability and sender-reputation
problem for a protection firm before it is anything else. `noteCodeMail` now spends a `codemail:<address>` budget of
**three an hour** in `rate_limits`, independent of the caller's address, on `POST /account/forgot` and
`POST /account/resend`. Over the budget the route answers the **same `200 {ok:true}`**, spends the **same statements**
and sends no mail — a refusal that changed the answer would be the oracle this whole surface exists to close. The
password-proved leg of `/account/login` does not spend it: that caller has already authenticated. The counter is keyed
on the address rather than a digest of it, because a throttle only works if the next request for the same mailbox finds
it; every value in it is an address someone posted to a public route, and the daily purge drops the rows.

Over the limit answers `429 {code:'rate_limited', retry_after}` with a `Retry-After` header. Every increment is a single
conditional UPDATE, so concurrent requests can neither share nor skip a count. The daily cron drops counter rows older
than a day.

One consequence worth naming rather than discovering: because `reset` shares the `code` bucket, spending guesses on wrong
codes eats the same window as asking for a new code, so a caller who burns five wrong codes cannot request a fresh one
until the window rolls.

**Seat holds.** A pending registration holds its seats for one of two windows, and nothing outside them:

| Row | Holds for |
|---|---|
| pending, **with** a Stripe session id | 15 minutes (it was 30) |
| pending, **without** one | 2 minutes from `created_at` |

Round 1 made the session id the whole condition. That closed a free denial of service — a row that never reached Stripe
used to hold seats for 30 minutes, so two requests at `qty: 10` emptied a class for nothing — but it opened an oversell
race the width of a full Stripe round trip: the row is written *before* the Checkout Session is created and stamped
*after*, so between those two points it held nothing and honest simultaneous buyers all passed the capacity check. The
short window is that gap plus room for a slow API call. The Stripe call did not move; a row that has not been stamped in
two minutes is a request that failed, and it goes back to holding nothing.

**One predicate, used everywhere.** Capacity, both hold caps and the atomic claim's roll-back ask the same question, so
a stale session-less row neither holds a seat nor counts against anybody.

**The claim is atomic, and the read in front of it is only a fast path** (round 3). Rounds 1 and 2 both left the capacity
`SELECT` and the `INSERT` separated by about six awaited statements with no transaction around them, so **four POSTs on
the same tick at `qty: 10` against a 16-seat class all passed the check and all got a Stripe URL — 40 seats held on 16.**
Shortening the hold windows could not fix that; the windows govern how long a row counts, not who counts first. The
registration now lands in ONE `env.DB.batch()`, which D1 runs in order inside a single implicit transaction:

1. `INSERT` the pending row;
2. `UPDATE … SET status='abandoned', abandoned_reason='capacity' WHERE id=<this row> AND status='pending' AND (<the
   holding-seats SUM over this course and weekend, **including the row just inserted**>) > capacity`;
3. `SELECT status` back — `abandoned` answers `409 {code:'sold_out', seats_left}` and makes **no Stripe call**.

Nothing can land between the count and the row that made the count wrong, because they are the same statement. The
`SELECT` before it stays, because refusing an obviously full class before the eligibility write, the agreement write and
a Stripe round trip is worth one read — but it decides nothing, and a request that passes it can still lose. On a
live-fire range an oversell is a safety problem before it is a refund problem, which is why the authority moved into the
transaction.

`abandoned_reason` (`migrations/009`) is what tells the two kinds of abandonment apart afterwards: `capacity` is a claim
the batch rolled back in milliseconds and told the buyer about; `NULL` is the daily cron expiring a checkout nobody
finished. A database without the column still refuses the oversell — `runSeatClaim` drops the assignment and rolls the
row back regardless — so the migration changes what you can see, never whether a class can be oversold.

**Proved against a real SQL engine, not against the fake.** `test-worker.mjs` runs on a fake D1 that answers these
queries in JavaScript, so every seat assertion in it exercises the JS and not the predicate — the wrong place to take a
safety control on trust. `test-seat-claim-sqlite.mjs` lifts the two statements **out of `src/worker.js`** (a mismatch is
a hard failure, not a silent skip), loads `schema.sql` into SQLite and replays the race: four buyers past the capacity
read before any of them writes, then their claims one transaction each. One of four at `qty 10` survives against 16
seats; all four at `qty 4` survive and the fifth does not. It runs inside `node test-worker.mjs`, so CI runs it.

Two live holds at a time per connection, and two under one address **from that connection**; a third answers
`429 {code:'too_many_holds'}`. The address half is bound to the pair (round 2) because `customer_email` is typed by
whoever posts the form: a cap on the address alone let a stranger take two holds under a known customer's address and
answer that customer's own booking with a 429. The trade is that holds under one address from *different* connections no
longer add up — the per-connection cap and the 10-per-window seat limit are what bound those. Because the pair is a
subset of the connection and both caps are 2, the connection cap is what actually refuses today; the pair is counted
separately so that raising the connection cap later cannot silently uncap one address. The paid path and the webhook are
unchanged.

**A request with no `CF-Connecting-IP` is inside every cap, in one shared bucket** (round 3). It used to be outside two
of them: `clientIp()` returned an empty string, `concurrentHolds` counts nothing for an empty value, and the rows it
wrote carried an empty `agreement_ip` — so a caller Cloudflare gave no address for was bounded by the per-window limiter
and by neither hold cap. `clientIp()` now returns the literal `unknown`, the limiter, both hold caps and the code-guess
counter all key on that one value, and `agreement_ip` records `unknown` rather than an empty string. That is a
placeholder in a signed-agreement field, deliberately: `unknown` is what was observed, an empty string is the same fact
written in a way that silently switched a cap off. In front of Cloudflare the header is always present, so this is the
behaviour of a misconfiguration, not of a visitor.

**No account oracle** — with one residual named at the end of this section, because it is real and it is not closed.

`POST /account/register` answers the same `202 {pending:true}` envelope for a new address, an unverified one and a
**verified** one — the old `409 exists` and `429 too_soon` each turned the route into an address checker. When the
address already has an account nothing on it changes and its real owner is emailed *"someone tried to create an account
with this address — sign in instead"* (no code, throttled to one a minute).

**Round 3 — an existing row's credentials are immovable.** The unverified slot used to be handed to whoever signed up
next: `POST /account/register` overwrote `password_hash` on an existing unverified row. Two requests then read the
database — sign up with password *X*, sign in with *X*, and `403 unverified` came back for an address that had a row
where `401` came back for a verified one — and the same overwrite let a stranger set the password on an address whose
owner had started and not finished. Now **nothing on an existing row is written**: verified or not, the row keeps its
password, its name and its token version, and the sign-up only re-sends the code (throttled). The password the stranger
typed never authenticates **while the row is unverified**, so `/account/login` answers them `401 bad_login`, exactly as a
verified address does — but see the residual below for what happens the moment the owner verifies it, because "never"
was the wrong word and it was written here for a round. The
same PBKDF2 hash is computed and discarded on that path, so the branch that stores nothing costs what the branches that
store something cost.

**The residual, as measured rather than as it read.** Round 3 called this *"one extra statement"* and implied the two
existing-address branches cost the same. They did not: measured, `POST /account/register` cost **7 statements
brand-new, 6 existing-unverified, 5 existing-verified** — a three-way split that separated *verified* from *unverified*
as well, in one request. Round 4 measures **6 / 5 / 5** (`test-worker.mjs` asserts those three numbers and prints them,
so the sentence cannot drift from the code again). The two existing-address branches are no longer distinguishable by
statement count: `issueCode` lost the counter-clearing `DELETE` it used to run, which is what the unverified branch
spent over the verified one. What remains is the brand-new branch's own `INSERT` — one statement, inside a PBKDF2 hash
and a Resend round trip that both branches await either way. It is still a difference, and it is still the reason the
statement-count parity claimed above is claimed for `/account/forgot`, `/account/resend`, `/account/reset` and
`/account/verify` and not for `/account/register`.

**Which raises the obvious question — how does the real owner get their address back?** Through the mailbox, which is the
only evidence of ownership this system has. `POST /account/forgot` now serves **unverified** accounts as well, and a
successful `POST /account/reset` sets the password **and** marks the address verified in one act. It also removes a
state branch from a route whose entire job is not to have any.

**⚠ Read that with the residual below it.** Round 3 finished the paragraph *"so the address belongs to whoever can read
the mail sent to it, not to whoever typed a password first"*, and **that sentence is only true of the reset route**.
`POST /account/verify` sets `verified_at` and never touches `password_hash`, so an owner who does the obvious thing —
enter the code that arrived in their mailbox — verifies the address **under the password a stranger typed first**, and
that stranger's password is then the one that signs in. Reset is the way back, not verify. Measured four-step probe,
what it costs and the two fixes: **What is NOT closed**, below.

**Round 3 — the code routes are uniform in time and in statement count, not only in body.** Round 2 made the body
identical and left two ways to tell the paths apart, both measured:

- the Resend round trip was **awaited inline only when the account existed** — 165 ms against 34 ms, a one-request
  existence oracle sitting inside a route written to be uniform;
- when Resend refused, the real address got `502 email_failed` and the invented one got `200`.

Both are gone. `/account/forgot` and `/account/resend` always answer the same `200 {ok:true}`; the mail leg runs in
`ctx.waitUntil()`, so it is never awaited before the response and can never change it (a refusing provider is a log line
now); and the absent-account path performs the **same D1 statements** as the real one — a dummy `issueCode`-shaped write
bound to an id no row carries. `/account/reset` and `/account/verify` got the same treatment for the guess path: the
absent-account branch runs the same claim `UPDATE` and the same read-back as `checkCode` does, so an invented address
costs what a real one costs. The tests measure this rather than asserting it — identical status, identical body,
identical statement count, and the response demonstrably returned while the mail call was still parked.

**Round 4 — and it was true only on a connection that had not spent its guesses.** The parity above held exactly as
written, and the per-connection guess cap round 3 added in front of it re-opened the oracle it closed: the cap was keyed
on the **constant absent id**, so every invented address on the internet shared one counter row. Five wrong codes at one
throwaway address armed it, and from the sixth request on the refusal returned **before** the twin statements ran — an
invented address cost **5 statements where a real one cost 9**, with the same `400` and the same body, one request per
address tested. Eight unknown addresses probed from one connection cost `9,9,9,9,9,5,5,5`: every address after the
fifth was free to classify. The absent branch is now keyed on the address —
`codeguess:<ip>:absent:<first 16 hex of SHA-256 over the normalised address>` — so a ghost gets its own five-guess
budget exactly as a real account does, an attacker rotating invented addresses can neither exhaust one shared row nor
spend a real account's budget, and a real address never shares a counter with ghosts. A digest rather than the address,
so the table never becomes a list of the addresses strangers have typed. **The round-3 assertion measured only a fresh
counter, which is the one state the leak did not live in**; the round-4 test measures with the counter already at five,
and with eight addresses in a row.

**Round 3 — five wrong codes no longer burn the code in the owner's inbox.** A stranger holding nothing but an address
could spend five wrong guesses on `/account/reset` or `/account/verify`, invalidate the live code, and `codeTooSoon()`
would then refuse the owner a replacement for the next minute — a denial of service built out of a safety feature, and
silent since round 2 made every wrong answer identical. Tries are counted twice now:

| Counter | Limit | What it does |
|---|---|---|
| per `(connection, account)` in `rate_limits` | 5 | that connection is refused, with the same `bad_code` body; the code stays live for **everyone else** and the global count does not move |
| global, on `accounts.verify_attempts` | 20 | the code is burned — twenty tries against six digits is a 0.002% chance, so the burn costs the attacker far more than the owner |

When the global burn fires the owner is emailed a plain notice (*"your code was invalidated after repeated wrong
attempts; ask for a new one"* — no code in it, sent once however many guesses raced), and the same act clears
`verify_sent_at`, so the one-a-minute throttle is lifted and the owner can request a replacement immediately.

**Round 4 — a reissue no longer clears either counter, because a stranger can ask for one.** Round 3 had `issueCode`
zero `verify_attempts` *and* drop every connection's guess counter for the account, described as the convenience that
un-refuses a customer who mistyped five times. It is also the primitive that made the twenty-try burn unreachable:
`/account/register`, `/account/forgot` and `/account/resend` all reach `issueCode` **unauthenticated**, so one request
between every five guesses bought an attacker an endless run of five-guess batches and deferred the global burn
indefinitely — 25 wrong codes across five connections with a sign-up between each batch left the code live and sent the
owner nothing. The counters are now cleared by a **correct code**, and by **the owner signing in with their password**,
which are the two things a stranger cannot do. `verify_attempts` therefore counts wrong tries against the *address*
across however many codes were issued, and the twentieth wrong try burns whatever code is live and mails the owner —
which the test drives with a reissue between every batch of five. The burn itself resets the count (it always did), so
the replacement the owner asks for afterwards carries a full twenty again. The mistyping customer's way back is the same one it
always was, minus the stranger's copy of it: sign in, or use another connection, or wait for the daily purge.

Round 2 closed the three ways that answer could still be told apart:

- **`expired` was the oracle, and the comment claiming otherwise was wrong.** `POST /account/verify` and
  `POST /account/reset` used to answer `400 {code:'expired'}` where an unknown address got `400 {code:'bad_code'}`, on
  the stated grounds that *"both need a live code to reach"*. `checkCode` returns `expired` precisely when there is **no**
  live code — the ordinary state of every account — so one unauthenticated request against `/account/reset` separated a
  real verified address from an invented one, with no code and, until this round, no rate limit on the route at all.
  `locked` went the same way: only an address that has an account could ever produce it. Both routes now answer one
  `400 {code:'bad_code'}` for every outcome but success. The code is still burned on the fifth wrong try; it no longer
  says so. (The *message* still reads "or it has expired" — that advice is now given to every caller, including one
  holding an address with no account.)
- **The sign-up notice no longer shares a throttle column with the code path.** It stamps
  `accounts.signup_notice_sent_at`, never `verify_sent_at`. Writing the shared column meant a stranger POSTing
  `/account/register` at a verified address suppressed *that owner's* own `/account/forgot` and `/account/resend` for the
  next minute — 200 with no mail — which held the password reset shut, and the reset is the documented way out of a
  sign-in lockout.
- **A refusing mail provider answers the same on both paths.** When Resend fails, a new address and a verified one both
  get `502 {code:'email_failed'}`, and a retry inside the throttle window gets `202` on both. Previously the new address
  got 502 and the verified one 202, which said exactly what the rest of the route was built to hide.

**Repository-side guards changed in the same round.** They are not Worker code, but they are the reason a finding about
this backend reaches a person, so they belong with it:

- **The smoke report stopped eating its own headline.** `.github/workflows/smoke-worker.yml` redacts business figures out
  of `_worker-smoke.txt` before it is committed to a branch. Its pattern carried a bare `\$[0-9]` alternative, which
  matched **every line of the catalog price table** — `MAST-DA  Direct Action  $695.00` — and redacted the
  server-side-pricing invariant, the first thing this backend exists to prove, out of the committed file. The pattern is
  now anchored to the CRM fields by name (`revenue`, `funnel`, `segments`, `leads`, `profiles`, `orders`, `subscribers`,
  `opted_in`, `registrations`, plus `revenue total=` and `last30=`, whose words are separated by a space). Fired against
  samples built from the workflow's own `printf` formats: every price line survives, every CRM figure line is redacted.
  **Round 3: the CRM block prints FIVE lines and that list covered four** — `journeys=… providers=…` went through
  untouched. `journeys`, `providers` and `accounts` are named now, and the rule is that adding a print to that block
  means adding its name here. Re-fired against the same samples: 3 of 3 price lines survive, 5 of 5 CRM lines redacted.
- **`.github/scripts/ci_cred_scan.py` learned four classes and stopped truncating.** Added: fine-grained GitHub PATs
  (`github_pat_…`), `-----BEGIN … PRIVATE KEY-----` blocks, Cloudflare API tokens (40 characters of `[A-Za-z0-9_-]` with
  no prefix of their own, so the context word is the anchor) and AWS secret access keys (40 base64 characters beside
  `aws_secret` / `secret_access_key`). Lines are no longer cut at 8,000 characters — they are scanned whole, in
  overlapping 8,000-character windows, so a secret in a minified bundle or a one-line JSON blob is looked at instead of
  skipped. The one `ALLOW` entry is anchored on the elided key body `\n...\n` in a documentation file rather than on the
  file, so pasting a real key into that same file still fires.
- **`deploy-mastsolutions.yml` declares `permissions: contents: read`.** Nothing in that job writes to the repository, and
  declaring the block at all is what drops every other scope to none.

## What is NOT closed — the open residuals, named

Two of them, both on the sign-up surface, and they have the same two fixes. Neither is closed in round 4: the first
needs a schema the front end also reads from, and the second is a front-end change this round was not allowed to make.

**1. Verifying a squatted address does not take it back — the stranger's password is what signs in. (Worse than the
oracle below; measured, not inherited.)** Round 3 stopped `POST /account/register` overwriting an existing row's
`password_hash`, and this file has said since then that *"an existing row's credentials are immovable"* and that
*"mailbox control, not who typed a password first, is what decides who owns an account."* **The first is true and the
second is false, and the four-step probe that shows it takes three requests:**

1. a stranger signs up with `victim@example.com` and a password they choose → `202`, the code goes to the victim's mailbox;
2. the victim signs up with the same address and their own password → `202`, identical envelope, and **the row keeps the stranger's password**;
3. the victim enters the code **from their own mailbox** → `200`, a token, `verified_at` set;
4. the victim signs in with **their own** password → `401 bad_login`. The stranger signs in with the password **they** chose → `200`, **token issued**.

`handleAccountVerify` writes `verified_at` and nothing else — it never touches `password_hash` — so verification
promotes whichever password reached the row first. The victim's own journey is exactly this path: the page opens its
code box on the `202` and posts `/account/verify`. `POST /account/password` needs the current password, so the signed-in
victim cannot repair it either. What is *not* true is that the account is lost: `POST /account/forgot` →
`POST /account/reset` sets the password and marks the address verified, and that path is tested and works — so this is a
takeover the owner can undo, by a route they have no reason to think they need. The daily purge of unverified rows only
re-arms it every day, at five sign-ups per ten minutes per connection.

**2. `POST /account/register` followed by `POST /account/login` with the same password** still separates *"this address
had no account"* (`403 unverified` — the sign-up created one, and the caller knows its password) from *"this address
already had one"* (`401 bad_login` — the row kept its own credentials, verified or not). Two requests, deterministic, no
timing needed, and the branch that answers `403` is also the branch that mails nobody an alarm — so the interesting
answer for an enumerator is the silent one.

**The two ways out, and what each costs.**

- **Stop materialising an `accounts` row until the code comes back** — a `pending_signups` table keyed on
  `(email, code hash, expiry)`, promoted to an account by the code that matches it. This closes **both** residuals at
  once and is the only one that closes the first: `/account/login` has nothing to answer about for an address that has
  only a pending sign-up, and the password promoted on verification is the one belonging to the sign-up whose code was
  in the mailbox — which is what "mailbox control decides ownership" was supposed to mean. Cost: a migration (a new
  table, a deploy-guard row, the `ratelimit.js` self-heal shape), a rewrite of `handleAccountRegister` and
  `handleAccountVerify`, the daily purge moved onto the new table, and a decision about what `/account/login` answers
  for a pending sign-up — which is the front-end coupling below. Two to three hours of careful work, not a patch.
- **Stop answering `403 unverified` at all** — closes the second residual only, and cheaply, but `mastsolutions.html`
  posts `/account/login` and opens its code box on exactly that `403` (`mastsolutions.html:1617`). Changing it without
  the page in the same commit signs the user out of a route they can still reach, so it is a two-repo change; the front
  end was out of scope this round. It does nothing at all about the first residual.

**Interim, if neither lands soon:** mail the address on **both** login branches so an enumerator cannot pick a silent
one, and drop `email` from the `403` body. That narrows the oracle without a schema or a page change — it does not touch
the takeover.

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
| `ADMIN_KEY` | secret | Guards `GET /roster` and everything under `/admin`. Sent in the **`X-Admin-Key` header, only** — the `?key=` query form was removed 2026-09-09, because a key in a URL lands in browser history, in the `Referer` of anything the page links to and in every log between the browser and Cloudflare, and one route behind it makes a Stripe write that is not undoable |
| `MAILCHIMP_API_KEY` | secret | Marketing list (ARCHITECTURE §7). With `MAILCHIMP_AUDIENCE_ID` (and `MAILCHIMP_SERVER` when the key carries no `-usNN` suffix) the opted-in profiles are upserted on payment, on sign-up and by `/admin/sync`; without them the CSV export is the path |
| `BREVO_API_KEY` | secret | The other list tool on the domain (atlasglinn.com's DNS carries Brevo). Opted-in profiles are upserted to Brevo the same way as Mailchimp; optional numeric `BREVO_LIST_ID` puts them on one list |
| `HUBSPOT_TOKEN` | secret | HubSpot private-app token (`crm.objects.contacts` write). With it every profile and every new lead is upserted as a HubSpot contact by email (`lifecyclestage` lead or customer) — a CRM record, not marketing consent, so it is not gated on the newsletter tick |
| `CRM_DIGEST_TO` | var | Comma-separated recipients of the Monday CRM digest (`matthew@atlasglinn.com,matthew@mastsolutions.com`). Unset = the digest is logged and not sent |
| `JOURNEYS_ENABLED` | var | `"1"` switches the daily T−7 / T−1 / T+1 emails on; `"0"` (the default) until the owner approves the texts |
| `STRIPE_TAX` | var | `"1"` (set) lets a Checkout Session ask Stripe to compute sales tax — but only when a measurement cached in D1 says the account is collecting (`taxReadyCached`, last-known-ready for 24 h); anything else and **every** body this Worker sends Stripe is byte-identical to the pre-tax one. (The `POST /v1/prices` exception disclosed on 2026-09-09 is closed: that call is behind the same readiness gate now.) Safe to ship on an unconfigured Stripe account: the Worker sets the account up itself, off the customer's path. See **Sales tax (Texas)** |
| `STRIPE_TAX_TIMEOUT_MS` | var (optional) | The clock on every Stripe call in the tax path — measurement, setup, and the membership Price provisioning; never the Checkout Session. Default `4000`, **clamped to 500–15000**, so a typo cannot remove it. A tax endpoint that is up but not answering costs one timed-out measurement per lock window and nothing else |
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
- **`STRIPE_TAX="1"` but Stripe Tax not active on the account** → the checkout
  is **not** affected: the Worker sends the pre-tax Session body, logs one
  `{"tax_skipped":"…"}` line, and enqueues the setup behind the response. Texas
  tax is simply not charged until the account is repaired. If the account stops
  collecting between two measurements, Stripe refuses the Session and the Worker
  retries it once without the tax fields (`{"tax_fallback":…}`), so the customer
  still checks out. `deploy-worker.yml`'s
  tax step is a **report** of that state, not the thing that prevents it — with no
  `ADMIN_KEY` repository secret it prints a `::notice::` and exits 0. *(Corrected
  2026-09-09: this paragraph used to say "Stripe refuses the session and checkout
  fails", which was true only of the pre-`taxReady` Worker and contradicted both
  the code and `wrangler.toml`'s own comment.)*

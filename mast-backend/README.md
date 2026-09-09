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
| `POST` | `/account/register` | Student account sign-up (email, password ≥ 10, name, phone). Answers **202 pending** and emails a 6-digit code. **It creates no account** — it writes a `pending_signups` row of its OWN, keyed on a random `signup_id` and carrying the address as a digest. It replaces nothing and is refused on account of nothing (round 7); how many sign-ups an address may hold is bounded by the mail budgets alone |
| `POST` | `/account/verify` | `{email, code, password}` → **this is what creates the account**, in one batch, and only if the address has none; answers the sign-in token. The code selects the sign-up and the **password proves it is yours** (round 7), so a code that reached your mailbox from somebody else's sign-up cannot create your account. Any miss — wrong code, wrong password, unknown address, address already taken — is one `401 bad_code`. 15-minute codes, five wrong guesses per connection and twenty per address in total |
| `POST` | `/account/resend` | New verification code for the newest sign-up at the address **if this connection is the one that started it** (round 7); always 200 so it does not reveal which addresses have one. Anyone else — and any caller whose connection has changed — signs up again instead, which always mails |
| `POST` | `/account/login` | `{email, password}` → token. An address that has only started a sign-up answers exactly what an address with nothing answers — `401 bad_login`, same body, same statement count |
| `POST` | `/account/forgot` / `/account/reset` | Forgotten password: `forgot {email}` emails a reset code (always 200); `reset {email, code, password}` sets the new password, signs every other session out and answers a token |
| `GET` | `/account/me` | Bearer token → profile, classes taken (paid/completed registrations under the account email), saved card (brand, last four, expiry) |
| `POST` | `/account/update` / `/account/password` / `/account/setup-payment` | Bearer token → profile details; password change (needs the current one); Stripe Checkout in setup mode to save a card on the account's Stripe Customer |
| `GET` | `/admin/crm?key=…&view=weekly` | The Monday digest as `text/plain`, exactly as it is emailed |
| cron | daily 09:17 UTC | Purges eligibility answers past `purge_after`; marks day-old unpaid registrations abandoned; drops day-old pending sign-ups (and any unverified account row left from before `migrations/012`); **on Monday** (or the Tuesday/Wednesday retry if Monday failed) also emails the CRM digest |

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

## Pulling a class roster

```bash
curl "https://mast-booking-backend.<subdomain>.workers.dev/roster?key=$ADMIN_KEY&sku=MAST-DA"
```

## Tests

```bash
node test-worker.mjs               # the suite: 486 assertions, 0 failing as committed
node test-seat-claim-sqlite.mjs    # the seat claim against a real SQL engine, on its own
node test-account-sqlite.mjs       # the pending-sign-up statements against a real SQL engine, on its own
```

**486 assertions**, all passing as committed — the number is what the run printed, not a number from the last time
somebody looked. It read `105` until round 4, when the suite was at 383; it read `431` through the whole of round 6,
when the suite printed `466`, in the same commit whose own summary quoted 466 — which is exactly the failure this
sentence claims immunity from, so the number is now re-read from the run at the end of every round. Two files are imported by the suite and also
run directly: `test-seat-claim-sqlite.mjs` and, since round 5, `test-account-sqlite.mjs`. Both are imported by the suite
*and* run on their own, printing every assertion and a summary line and **exiting 1 on any failure**. Until round 4 the
seat-claim file printed nothing and exited 0 however it went, which is the exact shape of a test that looks like it
passed. `SEAT_CLAIM_ENGINE=python node test-worker.mjs` forces the python3 sqlite fallback, so that path is fired rather
than assumed.

`test-account-sqlite.mjs` exists for the same reason the seat file does: the fake D1 answers queries in JavaScript and
executes none of their SQL, and account creation rests on statements whose whole meaning is a `WHERE` clause. Round 7
added more of them, not fewer: a lookup that must return **the one row belonging to a code** out of however many
sign-ups an address is holding, a claim `UPDATE` that must count a try against **every live row at the address in one
statement** while a row created later cannot lower the count, a burn whose predicate lives in its **binds** so that the
twentieth wrong code costs what the first one costs, and an `INSERT … WHERE NOT EXISTS` that is the only thing between a
verified code and a second account on an address that acquired one mid-flight. Like the seat file it **lifts the statements out of `src/worker.js`** rather than retyping them,
so editing the Worker without editing the test fails loudly instead of silently replaying last week's SQL.

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
`GET /admin/crm?key=…&view=weekly` returns the identical text for a runner reading it without the mailbox.
The contact notification no longer carries a `Page:` line (same instruction) — the page is still stored on the lead
row and still drives attribution.

## Rate limiting, lockout and seat holds (security review, 2026-09-08)

> **Line citations in this section point at the SHIPPED files at this commit** — the `src/`, `migrations/` and
> `test-worker.mjs` in this tree, read while writing the sentence, not at the pre-round versions the reviews were
> written against. Round 5's notes cited positions in the file as it stood *before* that round, which read as current
> and were not; where a number here would be ambiguous the assertion is quoted instead, because the quote survives a
> re-numbering and the number does not.

Everything below is D1 only — no new Cloudflare binding, nothing to provision. `migrations/008-rate-limits.sql` is the
schema — the `rate_limits` table, the two sign-in lockout columns and `accounts.signup_notice_sent_at`, with
`migrations/009-seat-claim.sql` adding `registrations.abandoned_reason` for the atomic seat claim; `src/ratelimit.js`
also self-heals the same objects on first use, so a Worker deployed ahead of the migration still limits. **Only a run in
which every statement succeeded is memoised** (round 2): a step that genuinely failed leaves the memo unset so the next
request retries it, where it used to record "done" and never try again for the life of the isolate. A `duplicate column`
error is the already-applied case and counts as success.

**Per account.** Five wrong passwords lock the account for 15 minutes, doubling at every further five up to a day. A
locked account answers the **same `401 bad_login`** every other refusal answers — and the right password is refused too,
which is the point and, since round 6, the only thing the lock says. Any successful sign-in, verification or reset clears
the counter and the lock. The failing attempt itself always answers the plain 401; the lock shows on the next one, so
the fifth wrong password does not announce that the address exists.

**Round 6 removed the `429 locked` answer, and the reason is that the lock is global.** It used to be answered *before*
any PBKDF2, which saved the CPU on guess six — and cost the whole property this section is about at six requests rather
than one. `accounts.locked_until` is per-account and not per-connection, so five wrong passwords from any five
connections made the sixth request, **from anywhere**, answer `429` in 5 statements and 0.7 ms where an absent address
answered `401` in 10 statements and 45.7 ms. That is an account-existence oracle on status, statement count *and* time,
at the price of five throwaway guesses. The lock now runs the dummy hash and the same statements the absent path runs.
The two costs, named: the hashing CPU is spent on refused requests (the 20-per-window `login` bucket is what bounds
that), and a locked-out customer sees the plain `401` rather than a message naming the lock — the recovery it used to
name, `forgot` → `reset`, is on the page either way. Measured at 21 samples per class in `test-worker.mjs:1992`.

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
connection. Through round 5 that meant five failures from one address followed by a sixth from *another* answered `429`
for a real account and `401` for an invented one — six requests to classify any address. Round 6 answers both with the
same `401`, on the same statements and after the same PBKDF2, so what is left of the asymmetry is that the *ladders* run
on different counters: an address sprayed from several connections can put them out of step by one statement on a fifth
try, which is noise an attacker cannot aim.

**Why it is left, corrected in round 4 and priced in round 5.** Round 3 wrote: *"the fix still hands a stranger the power
to lock a paying customer out of their own account, which is worse than the leak."* **That reason is wrong, and the
shipped code disproves it in six requests.** `noteFailedLogin` writes `accounts.locked_until` — a *global* per-account
lock — on every wrong password from *any* address, and `handleAccountLogin` reads it before deciding the answer: five
wrong passwords from a stranger, and the owner's own correct password from their own untouched connection is refused.
The system already hands a stranger that power. (It answered `429 locked` until round 6; it answers the plain `401`
now, which changes who can *see* the lock, not who can cause it.)

**The escape hatch is what makes that a 15-minute denial rather than a lockout — and in round 4 it was not there.**
`POST /account/forgot` → `POST /account/reset` both work on a locked account and a successful reset clears
`locked_until`, which this file asserted; round 4's per-address mail budget then let three unauthenticated requests
close `forgot` for an hour, so the sentence was false in the same commit that wrote it. Round 5's budgets are per
connection, and **the whole chain is now driven end to end in the suite**: three strangers spend their own budgets, a
fourth locks the account with five wrong passwords, the owner's correct password is refused (`401` since round 6), and
the owner's own `forgot` from their own connection still mails a reset code that signs them back in. The claim is a test
now, not a sentence.

**Scoping the account lock per `(connection, account)` is still the real fix, and it is still not in this round.** What
it costs: `accounts.locked_until` is the only *global* brake on an attacker spreading guesses across many connections,
so removing it trades a stranger-induced 15-minute lockout for an unbounded distributed guess rate against PBKDF2 —
bounded then only by 20 sign-ins per connection per ten minutes. That trade needs its own measurement (how many
connections a guesser must rent to beat a 100k-iteration hash) and it moves `noteFailedLogin` and its absent twin, whose
statement-for-statement parity round 4 had just established. Doing it beside a rewrite of account creation would put
two unmeasured changes in one commit. It is named here, with its cost, rather than done badly.

**Per IP**, in 10-minute windows. The address is `CF-Connecting-IP` **and nothing else** (round 2): the old
`X-Forwarded-For` fallback was a header the caller sets, so rotating it bought a fresh window and stepped out of every
limit below. A request without the Cloudflare header shares the single `unknown` bucket.

| Route | Per window |
|---|---|
| `POST /account/login` | 20 |
| `POST /account/register` | 5 |
| `POST /account/forgot` + `POST /account/resend` + `POST /account/reset` | 20 **shared** — one password-reset budget: two of them mail a code to whatever address is posted and the third spends guesses against one. forgot and resend stop at 5 within it |
| the three routes that MAIL a code — `forgot`, `resend`, `register` — **per (connection, posted address)** | 3 an hour (round 5) — see below |
| the same three, **per connection, across every address** | 30 an hour (round 5) — see below |
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

**Code mail: budgets a stranger cannot spend on the owner's behalf (round 5).** Every route limit above is per IP, and
that left the *mailbox* uncapped: `codeTooSoon()` allows one code a minute and the `code` bucket allows five per window
per connection, so twelve connections spaced past the 60 seconds delivered twelve emails to one address — about 1,440 a
day at any mailbox on earth, out of the firm's own Resend sending domain. Round 4 answered that with **one counter per
address, three an hour, whoever asked**, and got two things wrong that this round had to undo:

- **A counter keyed on the address alone is a counter a stranger spends for the owner.** Three unauthenticated
  `POST /account/forgot` from any three connections, in under a second, and the owner's own reset answered
  `200 {ok:true}` with no mail for the rest of the hour — closing the only documented way out of a sign-in lock, which
  the paragraph above asserted was open. That is a denial of service anyone on the internet could hold, for the price of
  three requests.
- **It was wired to two of the three unauthenticated mailers.** `POST /account/register` mails the posted address too —
  a code for an address with no account, a *"someone tried to sign up"* notice for one that has — and spent no budget at
  all, so the ~1,440-a-day ceiling the fix was written to lower did not move.

**What ships instead.** `noteCodeMail` spends **two** budgets, both keyed on the caller's own connection, and
`POST /account/register` spends them with `forgot` and `resend`:

| Key | Budget | What it bounds |
|---|---|---|
| `codemail:<ip>:<digest of the address>` | 3 an hour | what one connection can mail to one mailbox — about 72 **code mails** a day, and up to ~144 messages once each is turned into a burn notice |
| `codemailtotal:<ip>` | 30 an hour | what one connection can mail to every address it can invent |

A stranger spends their own three at the owner's address and their own thirty everywhere else. The owner's next request
arrives on a different connection with an untouched budget, so **recovery cannot be closed from outside**. Over either
budget the route answers the **same `200 {ok:true}`** (or the same `202` on `register`), spends the **same statements**
and sends no mail — a refusal that changed the answer would be the oracle this whole surface exists to close. A slot is
taken **only when a mail actually goes**: `sending` is decided from state the route has already read and bound into the
taking `UPDATE` as its limit, so a throttled or refused branch runs the identical statements and takes nothing. Round 4
spent the slot before deciding, which meant a customer tapping *resend* three times in ninety seconds spent their whole
hour on two mails that were never sent. The password-proved leg of `/account/login` consults neither budget: that caller
has already authenticated.

**There is deliberately no global per-address cap, and that is a trade rather than an omission.** Any counter keyed on
the address alone is, by construction, spendable by a stranger — the P1 above. So the ceiling at one mailbox is priced
in connections instead: 3 an hour each. Stated at the 2x that counts the unmetered burn notice, which is the number
that reaches the mailbox: an attacker who rents twenty addresses can still reach roughly **2,880 a day** at one mailbox,
while a single host drops from ~1,440 to **~144**. (This paragraph and the table above it said ~72 and ~1,440 — the 1x
code-mail figures — through round 6, while the residual below said ~144 and ~2,880. Two numbers for one quantity in one
document is the defect; the 2x pair is the true one.) That residual is listed under **What is NOT closed** rather than
claimed shut.

**Every key in `rate_limits` carries a digest now, never the address.** `codemail:`, `codeguess:` and `loginfail:` — the
last of which had stored the plaintext address since round 2, while the comment three functions above it claimed *"the
table never holds a list of the addresses strangers have typed."* A digest finds the same row the next request finds,
which is the only property a counter needs, so there was never anything to trade for it. `test-worker.mjs` asserts that
no key in the table contains an `@`.

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

**No account oracle.**

`POST /account/register` answers the same `202 {pending:true}` envelope for a brand-new address, one with a sign-up
already in progress and one that already has an account — the old `409 exists` and `429 too_soon` each turned the route
into an address checker. When the address already has an account nothing on it changes and its real owner is emailed
*"someone tried to create an account with this address — sign in instead"* (no code, throttled to one a minute).

**Round 5 — a sign-up creates no account, and that one change closes both of round 4's residuals.** Rounds 3 and 4 kept
patching the consequences of one design decision: `POST /account/register` INSERTed an `accounts` row for a brand-new
address, holding whatever password the caller typed, and it sat unverified until someone entered the code emailed to
that address. Two findings came out of that row.

*The squat takeover.* A stranger signed up `victim@example.com`; their password went onto the row; round 3's rule that a
sign-up never overwrites an existing row then **protected** it. The victim entered the code from their **own** mailbox,
`handleAccountVerify` wrote `verified_at` and never touched `password_hash`, and the account came up holding the
stranger's password — `401` for the owner, `200` and a token for the stranger. Four steps, three requests, no race. It
was recoverable through `forgot` → `reset`, by a route the owner had no reason to think they needed.

*The register → login oracle.* An address mid-sign-up **had** a row, so `/account/login` answered `403 unverified` for
it and `401 bad_login` for an address with nothing. One unauthenticated request classified any address, and the `403`
branch was also the branch that mailed nobody an alarm.

**What ships.** `POST /account/register` writes a `pending_signups` row and nothing else. `POST /account/verify` is what
INSERTs the `accounts` row — in one `env.DB.batch()` with the `DELETE` of the pending rows, under
`WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE email = ?)` so it cannot land on an address that acquired an account
while the request was in flight. A later sign-up **replaced** the pending row (round 5), and then replaced it only once
the earlier code had run out (round 6); **since round 7 it replaces nothing — it writes a row of its own** and the
password decides at verification. On the *account* side there is no writer at all until a code comes back.

- The credentials that become an account are the ones belonging to the code the mailbox received — **and, since round 7,
  to the password posted with it**. The four-step probe is in `test-worker.mjs`, and its last assertion is the one that
  used to fail. **This paragraph read "the takeover is impossible by construction" until round 6, and that was wrong**:
  the round-6 section below measured a deterministic takeover against exactly this code at 21 requests from 5
  connections, and the round-6 review then measured another against the fix. The sentence is only true from round 7,
  where it does not rest on who won a race for a row.
- `/account/login` has nothing to say about an address that has only started a sign-up, so it says what it says about an
  address with nothing: `401 bad_login`, **same body and same statement count**, both asserted. The `403 unverified`
  answer is gone from the source, and the suite reads `src/worker.js` to check that it stays gone — the behaviour is
  closed by the *absence* of a row, so putting the branch back would pass every request-level assertion until something
  else wrote one.

**The pending row holds no plaintext address.** It carries the SHA-256 digest of the normalised address — as its primary
key through rounds 5 and 6, as an ordinary indexed column since round 7 — so a table of half-finished sign-ups is not a
list of who has typed what; every route that needs it has the address in hand.
The daily cron drops rows a day old, which is where the old *"unverified accounts are purged after a day"* behaviour
went.

**Register now costs the same on every branch.** Round 3 called the difference *"one extra statement"* and implied the
two existing-address branches cost the same; measured, it was **7 / 6 / 5**, and round 4 got it to **6 / 5 / 5** — still
a three-way split's worth of signal in one request, since the brand-new branch's `INSERT` was the tell. Round 5 ran two
reads, one mail budget and exactly one write on every branch; round 7 dropped one of the two reads, because the pending
read existed only to feed the replace gate that is now gone. `test-worker.mjs` prints the numbers and asserts they are
equal rather than asserting a constant, because the constant is an implementation detail and the equality is the
property — and it now measures **four** classes rather than three, the fourth being an address a *stranger* has sign-ups
at, which is a state rounds 5 and 6 could not produce.

**How does the real owner get their address back?** Through the mailbox, which is the only evidence of ownership this
system has — and now the *ordinary* path is the one that works. Verifying a sign-up creates the account under the
password belonging to that sign-up. `POST /account/forgot` → `POST /account/reset` remains what moves a password on an
account that already exists. An address with only a pending sign-up is served by `POST /account/resend`, not by
`forgot`: `forgot` answers it exactly what it answers an address with nothing, which is the point of `forgot`.

**Round 6 — the pending row was still takeable, and the burn was the key to it.** *(Superseded by round 7 below: the
gate and the two columns described in this section no longer exist. Kept because the failure is the argument for what
replaced it — every fix here was correct about the mechanism and wrong about the shape.)* Round 5's claim above —
*"the takeover is impossible by construction"* — was refuted against the shipped code, deterministically and without a
race, in **21 requests from 5 connections**:

1. the owner signs up; a code goes to their mailbox and `pending_signups` carries their `password_hash`;
2. a stranger spends **20 wrong codes across 4 connections** (five each, the per-connection cap) and the code burns;
3. `burnPendingCode` set `code_sent_at = NULL` — and `code_sent_at` is the exact column `POST /account/register` read to
   decide whether a later sign-up may replace the row. The stranger's twenty-first request is therefore un-throttled and
   writes **their** `password_hash`, name, phone and organization onto the sign-up;
4. `badCode()` tells the owner to *"request a new one"* and the burn notice tells them to *"ask for a new verification
   code"*. `POST /account/resend` re-mints a code against **whatever row exists** — the stranger's;
5. the owner enters the code from their own mailbox. `handleAccountVerify` builds the account out of
   `pending.password_hash`. **The owner's password answers 401 and the stranger's issues a token**, which then reads
   `GET /account/me` — the classes taken under that address, since `/account/me` matches registrations on `customer_email`.

Two orderings reached the same end state with **no burn at all**: a stranger posting the address a minute after the
owner's sign-up simply replaced it, and a stranger who signed up *first* left the only live code in the owner's mailbox.

**What ships.** Two changes, and the suite proves each is load-bearing by mutating it back on its own:

- **The burn keeps the throttle stamp.** `burnPendingCode` no longer touches `code_sent_at`. The owner's exemption — a
  burn they did not cause must not also cost them the minute before they can ask for a replacement — moved to its own
  column, `burn_cleared_at` (`migrations/011-pending-burn-stamp.sql`), which `pendingTooSoon()` reads and the replace
  decision does not. Mutating this one line back: the takeover reproduces, `owner=401 stranger=200`.
- **The replace is gated on the AGE of `code_sent_at`, not on whether the code is still alive.** `pendingHeld()` refuses
  to replace a pending row whose code was sent within `CODE_TTL_MS`. The refusal lands on the branch that already binds
  `PENDING_ABSENT`, so it answered the same `202` with the same statement count and the same single write — no new
  branch, no new oracle. (This line read *"the same nine statements"*; the suite printed **12**. The round-6 review
  called it out, and the lesson is the one at the head of this section: cite the assertion, not a number typed from
  memory. Round 7's equivalent line quotes what the run prints.) Mutating this one line back to round 5's sixty
  seconds: the takeover reproduces, and so does the no-burn ordering. **Its own review then found that
  `/account/resend` re-stamped `code_sent_at`, so the gate renewed every sixty seconds and the hold was unbounded** —
  which is the finding round 7 answers by removing the gate, the column and the single row together.

**And `POST /account/register` no longer resets the burn counter.** `PENDING_UPSERT` was
`INSERT OR REPLACE … verify_attempts … VALUES (…, 0, …)` — a literal zero, written by an **unauthenticated** route. That
is round 4's deferred-burn primitive, alive again on the round-5 pending path: a sign-up between every five guesses
deferred the twenty-try burn, and the owner's *"your code was invalidated"* notice with it, for ever. `INSERT OR REPLACE`
cannot preserve a column, so the statement is now an `ON CONFLICT(address_digest) DO UPDATE` naming every column a later
sign-up may move — `verify_attempts`, `created_at` and `created_ip` are not among them. The regression test that was
supposed to catch this drove its reissue through `/account/resend` only, the one of the three named routes that was
safe; it runs **register, resend and forgot** now, and each must burn by try 20 and mail the owner exactly one notice.

**The sign-in lock no longer classifies an address.** `lockedFor()` reads `accounts.locked_until`, which is **global**,
so five wrong passwords from any five connections made the sixth answer `429 locked` in **5 statements and 0.7 ms**
where an absent address and an address with only a pending sign-up both answered `401` in **10 statements and 45.7 ms**.
Round 5's *"the register → login oracle is closed"* was true at one request and false at six — a three-way classifier on
status, statement count and time. A lock now runs the dummy PBKDF2 and the same statements the absent path runs and
answers the same `401 bad_login`; what a lock is *for* is unchanged, which is that a **correct** password is refused
while it holds. Two consequences, both deliberate: a locked account no longer saves the hashing CPU (the 20-per-window
route limit is what bounds that), and requests the lock refuses take the absent branch, so a guesser can no longer walk
a customer's lock up to its 24-hour cap by typing at it. Measured with 21 samples per class — same status, same body,
same statement set, medians inside the noise floor instead of 65x apart.

**Round 7 — the row was the bug. Six rounds argued over who should hold it; this one deletes the question.**

Rounds 3, 5 and 6 each closed a takeover and opened the next, and the reason is one line long: **an address had exactly
one pending row, so a sign-up was a slot, and a slot is something a stranger can be in.** Round 5 let the last writer
take the slot — a stranger replaced a sign-up in flight. Round 6 gave it to the first writer and gated the replace on
the code's age, which turned the slot into a **hold** — and `/account/resend` re-stamped the very column that gate read,
so the hold renewed every sixty seconds. The round-6 review held an address for **six hours against 51 consecutive owner
sign-ups**, with 26 codes reaching the owner's mailbox and every one of them bound to the attacker's password.

**What ships: one row per SIGN-UP, and verification takes the triple.**

- `pending_signups` is keyed on a random 128-bit `signup_id`. `address_digest` is an ordinary indexed column and is
  **not unique**. `POST /account/register` only ever INSERTs its own row: it reads no pending row, replaces nothing, and
  is refused on account of nothing. How many rows an address may hold is bounded by the mail budgets alone — a stranger
  spends a stranger's three an hour to make one, and it reaches nothing of the owner's.
- `POST /account/verify` takes `{email, code, password}`. One indexed `SELECT` on `(address_digest, code_hash)` returns
  at most one row; `verifyPassword` then runs **exactly once**, against that row's hash or against `DUMMY_PASSWORD_HASH`
  when there is no row. The account is created only when the code selected a row *and* its password matched.
- The consequence, stated as the two attacks it kills: **an owner who receives a stranger's code cannot complete the
  stranger's sign-up** (the password is not theirs) and **a stranger cannot complete the owner's** (the code is not
  theirs). Neither can wait the other out, because neither is holding anything the other needs. Both orderings, plus the
  burn ordering and the six-hour hold script, are in `test-worker.mjs` and each fails on a one-line mutation back.
- `POST /account/resend` re-mails the newest sign-up at the address **only if this connection created it**
  (`created_ip`) and its code is still live. It is unauthenticated, so that is the strongest test available to it. It
  moves one row, named by `signup_id`. **Nothing renews anything of anybody else's, and there is no hold to renew.**
  The cost, stated: a visitor whose connection has changed since they signed up gets no re-send. They sign up again,
  which always mails — that is the whole recovery, and the page says so where the button is.
- The burn deletes every sign-up waiting at the address and mails the owner one notice, as before. What is gone is the
  throttle exemption the owner used to need afterwards: there is no row for them to reclaim.

**And it costs the same in every class, which is the property the last four rounds were built on.** The suite measures
four classes now — a brand-new address, one with a sign-up waiting, one with an account, and one a *stranger* has
sign-ups at, which is a state rounds 5 and 6 could not produce. The run prints:

```
(/account/verify — brand-new 11, pending 11, account 11, stranger-rows 11 statements)
(/account/resend — brand-new 12, pending 12, account 12, stranger-rows 12 statements)
(/account/register — brand-new 11, pending 11, account 11, stranger-rows 11 statements)
```

Every statement on the verify path is keyed on the caller's own digest and runs unconditionally, so there is no absent
twin to keep in step — there is no absent *branch*. That also closes the round-6 P2: the burn used to run only when it
was due, which spent one statement more on the twentieth guess at a real address than at an invented one (`10 ×19 then
11` against `10 ×20`), classifying an address for the price of twenty requests. `PENDING_BURN` now runs on every refused
verification with its predicate in the **binds** — `DELETE FROM pending_signups WHERE address_digest = ? AND ? >= ?` —
and the suite drives the burning request against a ghost's twentieth guess and asserts the counts are equal.

**One refusal, one status.** Every miss on `/account/verify` — wrong code, wrong password, unknown address, an address
that already has an account, a spent budget — is `401 {code:'bad_code'}`, after the same statements and the same single
PBKDF2. It answered `400` through round 6; the request now carries a credential, so a refusal is an authentication
failure. `/account/reset` keeps its `400`: it proves the mailbox, not a password.

**The migration is a DROP, and that is deliberate.** A primary key cannot be ALTERed, so
`migrations/012-pending-signup-per-row.sql` recreates the table. **Every pending sign-up in the old table is dropped** —
they are unverified sign-ups minutes old by design, so the cost is that whoever was mid-sign-up signs up again. Nothing
verified is touched. Two consequences worth reading before deploying:

- the deploy guard for 012 keys on `signup_id,code_hash` — the columns **unique** to the new shape — because listing the
  columns the two shapes share would read `HALF APPLIED` against an old table and stop every deploy. `010` and `011`
  lose their GUARDS rows for the same reason, and 010's one-time `DELETE FROM accounts WHERE verified_at IS NULL` moved
  into 012 with them.
- the Worker heals the shape itself. `healPendingSignups()` drops a `pending_signups` that exists **without**
  `signup_id`, and only that, before `ensureRateSchema` runs its `CREATE`. This exists because one of the two live
  deploy paths applies no migrations at all (residual 5), so "the migration will have run first" is not something this
  Worker may assume. Driven three ways in the suite: old shape → dropped, new shape → untouched, no table → untouched.

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

**Round 5 — on `/account/verify` the counter is keyed on the address whether or not a sign-up exists there.** With
sign-ups living in `pending_signups`, keying it on *whether the row is present* would have handed a spent connection five
fresh guesses for the price of one `POST /account/register` — a state the caller can create. `codeguess:<ip>:pending:<digest>`
is one budget per `(connection, address)` on that route, entered from the same point whether the address has a sign-up in
progress or nothing at all. `/account/reset` keeps the account-id / `absent:<digest>` pair described above, because the
thing it guesses against is an account.

**Round 3 — five wrong codes no longer burn the code in the owner's inbox.** A stranger holding nothing but an address
could spend five wrong guesses on `/account/reset` or `/account/verify`, invalidate the live code, and `codeTooSoon()`
would then refuse the owner a replacement for the next minute — a denial of service built out of a safety feature, and
silent since round 2 made every wrong answer identical. Tries are counted twice now:

| Counter | Limit | What it does |
|---|---|---|
| per `(connection, address or account)` in `rate_limits` | 5 | that connection is refused, with the same `bad_code` body; the code stays live for **everyone else** and the global count does not move |
| global, on `verify_attempts` — `accounts` for a reset code, `pending_signups` for a sign-up code | 20 | the code is burned — twenty tries against six digits is a 0.002% chance, so the burn costs the attacker far more than the owner |

When the global burn fires the owner is emailed a plain notice (*"your code was invalidated after repeated wrong
attempts; ask for a new one"* — no code in it, sent once however many guesses raced). On the `accounts` path the same
act clears `verify_sent_at`, so the owner is not also made to wait a minute for a replacement they did not cost
themselves. **On the pending path there is no longer anything to lift**, and that is round 7's doing rather than a
simplification: rounds 5 and 6 had to hand the owner an exemption because one row per address meant they had to get
*that row* back, and the first version of the exemption — nulling `code_sent_at` — was half of a deterministic account
takeover, because that was the column the replace gate read. A burn now deletes the sign-ups at the address and the
owner's way on is the ordinary one, signing up again, which always mails.

The burn notice is **outside** the two mail budgets, deliberately: metering it would put six budget statements on the
burning request and nowhere else, which is a statement-count tell on a route whose whole design is that every wrong code
costs the same, and it would let an attacker suppress a security notice by pre-spending a connection's allowance. It is
bounded by construction instead — the burn `DELETE` reports the rows it removed, so exactly one burn fires per live
code and a live code exists only because a mail passed `noteCodeMail`. **Burn notices ≤ code mails**, which is why every
per-mailbox ceiling in this file is stated at 2x.

**Round 4 — a reissue no longer clears either counter, because a stranger can ask for one.** Round 3 had `issueCode`
zero `verify_attempts` *and* drop every connection's guess counter for the account, described as the convenience that
un-refuses a customer who mistyped five times. It is also the primitive that made the twenty-try burn unreachable:
`/account/register`, `/account/forgot` and `/account/resend` all reach `issueCode` **unauthenticated**, so one request
between every five guesses bought an attacker an endless run of five-guess batches and deferred the global burn
indefinitely — 25 wrong codes across five connections with a sign-up between each batch left the code live and sent the
owner nothing. The counters are now cleared by a **correct code**, and by **the owner signing in with their password**,
which are the two things a stranger cannot do. `verify_attempts` therefore counts wrong tries against the *address*
across however many codes were issued — on `accounts` for a reset code, and on `pending_signups` for a sign-up code
since round 5, with the same claim-first `UPDATE`, the same five per connection and the same twenty in total — and the
twentieth wrong try burns whatever code is live and mails the owner —
which the test drives with a reissue between every batch of five, **through all three of the named routes since round
6.** It drove `/account/resend` alone until then, and that is the one of the three that never touched the counter:
the statement `/account/register` wrote bound `verify_attempts` to a literal `0` and reset it on every unauthenticated
sign-up, so the sentence above was false on the pending path for the whole of round 5. Round 6 made it an
`ON CONFLICT … DO UPDATE` that did not name the column; round 7 makes the question different rather than answered
differently — a sign-up writes a NEW row, which starts at 0 because it is new, and the count the burn reads is
`MAX(verify_attempts)` across the live rows at the address, which a new row cannot lower. Driven in SQL as well as in
JavaScript, because "MAX ignores a fresh row" is a claim about SQLite and not about this Worker. The burn itself resets the count (it always did), so
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
- **A refusing mail provider answers the same on both paths — and since round 5 it is not a status code at all.**
  Round 2 made both branches answer `502 {code:'email_failed'}`, which was symmetric but still said the mail leg had
  run. Round 5 put `/account/register`'s send on `ctx.waitUntil()` and deleted the helper: `email_failed` appears
  nowhere in `src/` but in a comment recording its removal, and a Resend outage answers the ordinary **`202` on every
  branch**, as does a retry inside the throttle window. Asserted at `test-worker.mjs:1256` — *"a Resend outage answers
  identically for a new address and one that has an account — the ordinary 202 both ways, never a 502 that names the
  mail leg."* (This bullet still claimed the 502 in the present tense through round 5; corrected in round 6.)

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

Round 4 listed two, both on the sign-up surface. Round 5 declared both closed and both were still reachable. Round 6
closed those two and its own review found a third — a **renewable hold** that let a stranger squat an address for six
hours — plus two statement-count tells. Round 7 removes the structure all of them lived in rather than gating it again.
What a round declares closed is worth exactly the probe that was run against it, which is why the probes are in the
suite rather than in this paragraph.

What is genuinely open after round 7:

**1. The per-mailbox mail ceiling is priced in connections, not closed — and the figure is 2x, because the burn notice
is not metered.** The two budgets are per connection on purpose — a counter keyed on the address alone is one a stranger
spends on the owner's behalf, which is exactly the denial of service round 4 shipped. The burn notice sits outside them
by design (see the burn section above: metering it is a statement-count tell on the guess route, and a suppressible
security notice), and it is bounded at **one per live code**, so every budgeted code mail can be turned into a second
message at the same mailbox. The consequence, at the corrected number and now stated the same way everywhere in this
file: **one host gets 3 code mails an hour at one address plus up to 3 burn notices — ~144 a day — where it used to get
~1,440, and an attacker with twenty addresses can still reach ~2,880 a day at one mailbox.** Driven and counted in the
suite: three code mails from one connection, three burns, six messages, and a fourth burn attempt that sends nothing.
**Round 7 widens the ROWS, not the mails**: a stranger can now create as many pending rows as their budget allows, and
that budget is the same three an hour it was — the rows are cheap (one small row, purged daily) and reach nothing of the
owner's, which is the trade the whole design rests on. For a firm sending from its own Resend domain this is a
deliverability and sender-reputation exposure, not an account-security one. The honest fixes are outside this file: a
per-address cap a *proved* owner can bypass (which needs a signal of ownership an unauthenticated route does not have),
or moving code mail to a sending domain whose reputation is not the firm's.

**2. A stranger can still cost the owner one code mail per minute of the mailbox's attention, and can still burn a live
code.** What they can no longer do is take, hold or renew anything. Twenty wrong codes across four connections still
delete the sign-ups waiting at an address and still mail the owner the notice; the owner's answer is to sign up again,
which mails immediately — no throttle exemption, no fifteen minutes, no row to reclaim. **The delay this used to impose
is gone, and with it the residual that bought every takeover from round 5 on.** The cost that remains is noise in a
mailbox, bounded by residual 1.

**3. `/account/resend` is unauthenticated, so it can only match on the connection — and a visitor whose connection
changed loses the button.** A phone that moves between wifi and cell between signing up and tapping *Resend code* is
answered the same `200` and mailed nothing. This is a real usability cost and it is on the page rather than hidden: the
note under the button says to use *Create account* again, which always mails. The alternative — re-mailing whatever row
the address holds, whoever made it — is the round-6 P1, and it is not coming back. A resend that carried the password
would be strictly better and is the obvious round-8 candidate; it was left out here because the mandate for this round
was the structural change and because the page's *Resend* button does not currently hold a password when a returning
visitor taps it.

**4. The sign-in lock is still global, so a stranger can still cost the owner 15 minutes of sign-in.** Five wrong
passwords from any connection write `accounts.locked_until`, and the owner's own correct password then answers the plain
`401` (round 6 — it answered `429 locked`, which classified the address; see the lockout section). The documented way
out works: `forgot` → `reset` from the owner's own connection mails a code and a successful reset clears the lock,
driven end to end in the suite; and refusals no longer feed the ladder, so the lock cannot be walked past its first 15
minutes by continued guessing. Scoping the lock per `(connection, account)` is still the real fix; its cost is written
out in the lockout section above. Named, priced, not done.

**5. Two statement-count tells remain, both on the ACCOUNTS path, both inherited and both now measured.** Round 7 closed
the pending-side one (the burn branch) because it rewrote that path; it did not rewrite the accounts path, and saying so
is cheaper than implying a clean sweep:

- **`/account/reset`, the burning request.** `burnCode()` runs only when the burn is due and `dummyCheckCode()` has no
  twin for it, so the twentieth wrong reset code at an address with an account costs **11 statements where the first
  nineteen cost 9**, and an address that has never been seen costs **9 for all twenty** (round-6 review, probe
  `p8-resetburn`). Same status, same body, same timing. The fix is the one round 7 used on the pending side: move the
  predicate into the binds so the statement always runs.
- **`/account/login`, the lock write.** `noteFailedLogin()`'s conditional `UPDATE … SET locked_until` fires on the fifth
  failure, and `dummyFailedLogin()`'s twin is laddered on the per-`(IP, address)` count, which is 1 on a fresh
  connection. So the fifth wrong password at one address from five **fresh** connections costs **11 statements** if the
  address has an account and **10** if it does not (round-6 review, probe `p2d`: real `10 10 10 10 11`, ghost
  `10 10 10 10 10`). Probe 2b samples absent / pending / verified-**locked** and never a verified-**unlocked** account,
  which is why its "one statement set" result is true of the three classes it measures and not of the fourth.

Both cost an attacker five to twenty requests per address tested and neither leaks a credential. They are listed here
with their measured numbers so the next round can pick them up with the measurement already done.

**6. Nothing here is deployed, and there are TWO live deploy paths — only one of them applies migrations. Round 7 raises
the stakes on that.** `migrations/012` is merged, not applied.

- **`.github/workflows/deploy-worker.yml`** — applies migrations in the step *before* the deploy, guarded per file by a
  `PRAGMA table_info` column check, and `set -e` stops the job on a half-applied schema. A normal merge to `main` does
  both in the right order.
- **`scripts/wp-upload.sh`**, run hourly by the LaunchAgent in `scripts/mac-autopilot.sh` — runs `wrangler deploy` from
  the owner's Mac whenever `mast-backend/` has moved, and its own comment says *"Secrets and D1 migrations are
  untouched."* **It deploys code without applying a single migration.**

Through round 6 that was survivable because `ensureRateSchema` created the same table the migration created. Round 7
changes the table's **primary key**, and a `CREATE TABLE IF NOT EXISTS` is a no-op against the old shape — so a Worker
landing on a round-5/6 database would write `signup_id` into a table with no such column and every sign-up would fail
silently. That is why `healPendingSignups()` exists: it drops a `pending_signups` that has no `signup_id` and only that,
before the `CREATE`, on the first request of an isolate. The Mac path therefore converges by itself; what it still does
**not** do is 012's one-time `DELETE FROM accounts WHERE verified_at IS NULL`, and the guard cannot see the difference
because for a file that CREATEs a table the columns are not evidence the file ran. Bounded, not zero: `runRetention`
deletes the same set daily on the 09:17 UTC cron. Fixing that properly means a marker the running Worker cannot create
(a `schema_migrations` row); until then this paragraph is the record.

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
| `CRM_DIGEST_TO` | var | Comma-separated recipients of the Monday CRM digest (`matthew@atlasglinn.com,matthew@mastsolutions.com`). Unset = the digest is logged and not sent |
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

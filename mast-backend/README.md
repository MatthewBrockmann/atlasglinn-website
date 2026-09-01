# MAST Solutions — booking backend

Cloudflare Worker handling Stripe Checkout for class bookings and memberships,
storing every paid order in D1 and emailing a notification when one lands.

**Status: built and tested, NOT deployed.** Nothing in this directory is running
until the deploy steps below are run against the Cloudflare account.

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
| `POST` | `/create-booking` | One-time class seat → Stripe Checkout |
| `POST` | `/create-membership` | Recurring tier → Stripe Checkout |
| `POST` | `/webhook` | Stripe events; persists orders, sends notifications |
| `GET` | `/roster?key=…` | Admin: recent bookings, optionally `&sku=MAST-DA` |

`POST /create-booking` body — note there is **no price field**:

```json
{ "sku": "MAST-DA", "qty": 2, "customer_email": "student@example.com",
  "customer_name": "Jane Doe", "success_url": "…", "cancel_url": "…" }
```

## Deploy

> **YOU RUN THIS — copy-paste into Terminal.** None of it has been run; the
> Worker does not exist in the Cloudflare account yet.

```bash
cd mast-backend
npm install -g wrangler   # if not already installed
wrangler login

# 1. Create the database, then paste the printed database_id into wrangler.toml
wrangler d1 create mast_bookings

# 2. Create the tables and seed the class catalog
wrangler d1 execute mast_bookings --remote --file=schema.sql

# 3. Secrets (never commit these)
wrangler secret put STRIPE_SECRET_KEY        # sk_test_… first, sk_live_… when ready
wrangler secret put STRIPE_WEBHOOK_SECRET    # whsec_… from step 5
wrangler secret put RESEND_API_KEY           # re_… from resend.com
wrangler secret put NOTIFY_EMAIL             # where booking alerts go
wrangler secret put ADMIN_KEY                # long random string for /roster

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

26 assertions covering the security-critical paths, all passing as committed:
server-side pricing (an injected `price_cents` is ignored), unknown SKU and bad
email rejection, qty clamping, off-origin redirect rejection, membership plan
resolution, webhook signature acceptance/forgery/replay/tamper, order
persistence, notification send, roster auth, and CORS origin echoing.

The suite stubs Stripe, Resend, and D1 — it never touches a live service, so it
is safe to run anywhere and proves logic, not deployment.

## Configuration reference

| Name | Kind | Purpose |
|---|---|---|
| `ALLOWED_ORIGINS` | var | Comma-separated CORS + redirect allowlist |
| `SITE_URL` | var | Fallback base for return URLs |
| `NOTIFY_FROM` | var | From address on notification emails |
| `DB` | D1 binding | `mast_bookings` database |
| `STRIPE_SECRET_KEY` | secret | Stripe API key |
| `STRIPE_WEBHOOK_SECRET` | secret | Webhook signature verification |
| `RESEND_API_KEY` | secret | Booking notification email |
| `NOTIFY_EMAIL` | secret | Recipient(s), comma-separated |
| `ADMIN_KEY` | secret | Guards `GET /roster` |
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

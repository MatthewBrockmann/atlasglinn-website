# MAST Solutions — WordPress theme

Tactical training site for MAST Solutions (Houston, TX) with a 3-click Stripe
checkout for both **one-time class seats** and **recurring memberships**.

**No WooCommerce, no Subscriptions plugin, no plugin licenses.** Payments run
through the existing `safeguard-stripe-backend` Cloudflare Worker, which already
supports both one-time and subscription Checkout Sessions.

---

## Install

1. Zip the `mast-wp-theme/` folder (or upload it to `wp-content/themes/`).
2. **Appearance → Themes → Add New → Upload Theme** → activate **MAST Solutions**.
3. **Settings → Reading → Your homepage displays → A static page**, and pick any
   page as the homepage. The theme's `front-page.php` renders the full site.
4. Optional: **Appearance → Menus** — create a menu assigned to *Primary* to
   override the default anchor nav. **Appearance → Customize → Site Identity**
   to upload a logo (replaces the MASTSOLUTIONS wordmark).

## Editing classes and prices

**Classes** in the admin sidebar. Each class has:

| Field | Notes |
|---|---|
| Title | Class name on the card |
| Content | Description paragraph |
| Price per seat | **Dollars** (e.g. `395.00`) — stored as cents, charged by Stripe |
| Category chip | Small orange label, e.g. `Firearms · Tactics` |
| Duration / level | e.g. `2 days · All levels` |
| SKU | Sent to Stripe as order metadata |

Order the cards with **Page Attributes → Order**.

> **Until you publish your first Class**, the theme falls back to a built-in
> seed catalog (Handgun Operator, AWO, Force on Force, Direct Action, Low-Light /
> Night Ops, Long Range Rifle, Tactical Medical, NRA RSO). **⚠️ Those seed prices
> are placeholders and have NOT been confirmed.** Publish real Classes — or edit
> `inc/catalog.php` — before taking live payments.

A class with **no price set** renders an "Enquire" mailto button instead of
"Enroll", so it can never charge $0. The dashboard shows a warning listing any
published offering missing a price.

## Setting up memberships (recurring)

The Memberships section **stays hidden until you publish at least one tier**, so
the site never advertises a plan that doesn't exist.

For each tier, two things must line up:

**1. In WordPress** — **Memberships → Add New**:

| Field | Notes |
|---|---|
| Price | Display price only |
| Billing interval | month / year / quarter (display only) |
| **Stripe plan key** | lowercase key, e.g. `range_member` |
| Included features | one per line, rendered as a checklist |
| Highlight | marks the tier "Most Popular" |

**2. In Stripe + the Worker** — create a recurring Price in Stripe, then set the
matching env var on the `safeguard-stripe-backend` Worker:

```
plan key `range_member`  →  Worker env var  STRIPE_PRICE_RANGE_MEMBER = price_1AbC...
plan key `operator`      →  Worker env var  STRIPE_PRICE_OPERATOR     = price_1DeF...
```

The Worker reads `PRICE_IDS[plan]` from `STRIPE_PRICE_<PLAN>`. If a plan key has
no matching env var, the Worker returns a clear error and the checkout sheet
shows it rather than failing silently.

> The Worker currently ships with `personal`, `professional`, `team`, and
> `enterprise` keys wired up. Either reuse those key names for your tiers, or add
> the new `STRIPE_PRICE_*` vars — whichever you prefer.

## Checkout flow

```
Click 1  Enroll / Join            → sheet opens (modal desktop, bottom sheet mobile)
Click 2  Continue to Secure Checkout → Worker creates a Stripe Checkout Session
Click 3  Pay                       → Stripe's hosted page
```

Return lands back on the homepage with a success or cancelled banner.

| Mode | Endpoint | Payload |
|---|---|---|
| One-time class | `POST /create-store-checkout` | `product_name`, `price_cents`, `qty`, `customer_email`, `sku` |
| Membership | `POST /create-checkout` | `email`, `plan`, `seats` |

Point the theme at a different Worker in `wp-config.php`:

```php
define( 'MAST_CHECKOUT_BASE', 'https://your-worker.workers.dev' );
```

## Customizing without editing templates

All of these are filters — put them in a child theme's `functions.php` or a
small site plugin:

```php
add_filter( 'mast_contact', fn( $v, $k ) => 'phone' === $k ? '(281) 555-0000' : $v, 10, 2 );
add_filter( 'mast_socials', fn( $s ) => $s + [ 'YouTube' => 'https://youtube.com/@…' ] );
add_filter( 'mast_videos', fn( $v ) => $v );            // YouTube embed IDs
add_filter( 'mast_press_url', fn( $u ) => $u );          // Washington Post feature
add_filter( 'mast_reviews', fn( $r ) => $r );            // testimonials
add_filter( 'mast_instructor_photo', fn( $u ) => $u );
```

## Before going live — checklist

- [ ] **Confirm every class price.** Seed values are unverified placeholders.
- [ ] Publish real membership tiers and set their `STRIPE_PRICE_*` env vars.
- [ ] Verify the Worker's `STRIPE_SECRET_KEY` is the intended live (not test) key.
- [ ] Set `STRIPE_WEBHOOK_SECRET` so order webhooks validate.
- [ ] Run one real test transaction in each mode (class + membership).
- [ ] Confirm the success/cancel URLs return to the live domain.

## File map

```
mast-wp-theme/
├── style.css                  theme header + all styles
├── functions.php              setup, assets, contact/socials, schema, admin columns
├── front-page.php             assembles the single-page site
├── index.php                  fallback for posts/pages/404
├── header.php / footer.php    chrome + checkout sheet markup
├── inc/catalog.php            CPTs, meta boxes, seed catalog, price helper
├── template-parts/            hero, classes, memberships, skills,
│                              instructor, media, reviews, contact
└── assets/js/checkout.js      3-click checkout, both modes
```

## Content sources

Every factual claim (bio, credentials, client list, testimonials, press) comes
from existing Atlas Glinn / MAST material. Class names and descriptions come from
the published course pages on mastsolutions.com. Nothing is invented — but
**prices and membership tiers require owner confirmation** before launch.

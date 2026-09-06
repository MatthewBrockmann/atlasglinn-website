# MAST Solutions — lead lifecycle and marketing playbook

Written 2026-09-06 with the `mkt-revops` skill against the CRM in `src/crm.js`, for a one-owner business: Brockmann sells,
the office (atlasglinn.hq@) answers, the Worker keeps the records. Everything here reads from what the CRM already collects;
nothing needs a new tool to start. Where a paid tool helps later, it is named once.

The rule that shapes all of it: **MAST is not SaaS.** A lead is a person who wants to shoot better and can prove they may;
the "deal" is a seat on a weekend; the "expansion" is the next course in the ladder (Fundamentals → Operator → P1 → P2) and
the teammate they bring. Speed and a human voice win; automation only carries what a human would forget.

---

## 1. Stages

| Stage | Who is in it | Enters when | Leaves when | Owner |
|---|---|---|---|---|
| **Visitor** | anonymous | first page view (`events.view`, visitor id) | leaves an email | — |
| **Subscriber** | `contacts.kind = subscribe` | newsletter tick (`/subscribe`) | books or asks | Marketing list |
| **Lead** | `contacts` of kind contact / capability / private / gear / ep_access; segment `lead` | any form on either site | booked, or 90 days quiet | Brockmann |
| **Registered** | `registrations.status = pending` | started the registration flow | paid, or 24 h → `abandoned` | Worker |
| **Under review** | `registrations.status = review` (eligibility flagged); segment `review` | one of the two questions answered the wrong way | Brockmann's decision (cleared → pay link, or declined) | Brockmann, within 24 h |
| **Booked** | `registrations.status = paid`; segment `upcoming` | Stripe webhook | the class day | Worker journeys (T−7, T−1) |
| **Trained** | class date passed | T+1 | next booking, or 12 months → `win_back` | Worker (T+1), then Brockmann |
| **Repeat / advocate** | two or more classes, referrals, a quote we may use | second payment or a teammate booked | — | Brockmann |

Every stage above is derivable from the tables the Worker already writes; the staff page shows the counts under the chips.

## 2. Scoring — the segments are the score

No 100-point model. Ten flags, computed live, ranked here by what they are worth to a one-owner calendar:

| Priority | Segment | Why it matters | The move |
|---|---|---|---|
| 1 | `review` | A paying customer is waiting on a human | Decide within 24 h; the Worker sends the pay link when cleared |
| 2 | `gear` (a quote request) | Highest ticket per minute (Aimpoint, IWA, hazmat) | Quote within 4 business hours by email; agencies get the dealer line |
| 3 | `agency` | Team blocks, repeat business, the capability statement | Call the same day; offer a block of 8–10 seats and a date |
| 4 | `abandoned_30d` | Started, did not pay; the reason is usually a question | One email or call, once, within 48 h; ask the question back ("what stopped you?") |
| 5 | `upcoming` | Already sold; protect the show-up rate | Journeys do it (T−7, T−1); a personal note if the weekend is under 8 |
| 6 | `fundamentals_only` | The upsell that pays for the marketing | T+1 names the next course; a call or text before the next weekend with seats |
| 7 | `win_back` | Trained 12+ months ago, nothing since | One email a quarter with real dates; a second only if they open |
| 8 | `lead` (contact form, capability, private) | Warm, not yet qualified | Reply the same day; private instruction gets a price and two date options |
| 9 | `opted_in` | The only people the newsletter may go to | One send a month, dates first, then a range-day photo |
| 10 | `account` | Verified student account | No action; a signal the person plans to come back |

Negative signals: `honeypot` hits never reach the CRM; `kind = smoke` rows are the runner's test messages and are left out
of the lead counts; an address that bounces twice at Resend is marked in the provider, not chased.

## 3. Routing — who does what, when

One owner, one office. Routing is a rota, not a decision tree.

| Signal | To | Within | How the CRM tells you |
|---|---|---|---|
| Gear quote, private instruction, capability statement | Brockmann | 4 business hours | The staff alert email (reply-to the customer) + the Leads tab, `emailed = yes` |
| Contact form (Atlas or MAST) | Office, escalate to Brockmann if agency or EP | same day | Leads tab; the page and UTM columns say where they came from |
| Eligibility review | Brockmann only | 24 h | `review` chip; the roster view lists them first |
| Abandoned registration | Office | 48 h, once | `abandoned_30d` chip; email and phone on the profile |
| Booked, class within 7 days | Worker | automatic | Journeys log on the page (T−7, T−1) |
| Trained yesterday | Worker, then Brockmann for anyone worth a call | automatic + weekly | T+1 sent; the People table sorted by last class |
| Newsletter sign-up | nobody calls | — | Goes to the list (Mailchimp / Brevo) on consent; a lead only if they also ask something |

Fallback: anything with `emailed = no` on the Leads tab older than one business day is the first thing to clear on Monday.

## 4. Data hygiene

- **One record per email.** The CRM merges orders, registrations, accounts and leads by lowercase email; nothing else is
  a key. Ask for the same email on every form; the page already lowercases it.
- **Consent is a column, not a vibe.** `newsletter_opt_in` with `newsletter_opted_in_at` and the consent wording. A purchase
  or an inquiry never becomes a subscription. The audience export and the list adapters read that column and nothing else.
- **Eligibility answers never leave D1.** They are not in the CRM payload, the CSV, HubSpot, Mailchimp or Brevo. The
  status (cleared / flagged) is all a human sees outside the D1 console.
- **Attribution at first touch.** The pages keep UTM, referrer, landing page and a visitor id in the browser and send them
  with every form; the registration and the order carry them; revenue by source is a query, not an estimate. Every link
  posted anywhere carries `?utm_source=instagram&utm_medium=social&utm_campaign=<what-you-posted>`.
- **Retention.** Eligibility answers purge on the daily cron (RETENTION-POLICY.md); abandoned registrations are marked
  after 24 h; unverified accounts go after a day. Leads and events stay a year, then a review (a person's request to be
  forgotten is a `DELETE ... WHERE email = ?` in the D1 console, three tables).
- **Test traffic.** The runner's smoke test writes leads of kind `smoke` and events from the runner; both are excluded from
  counts. Never test with a real customer's address.
- **Outside systems.** HubSpot gets every lead and customer (a business record); Mailchimp / Brevo get opted-in addresses
  only. If the same person exists in the old WordPress list (Mailchimp or Brevo, via the theme's newsletter box), the CSV
  export is how the two are reconciled; the CRM's record wins for name, phone and organization.

## 5. The weekly cadence (about an hour a week)

**Monday, 15 minutes — clear the queue.** Open `/admin`. Leads tab: anything `emailed = no`, and anything from the weekend.
People tab → `review` chip: decide each one. `abandoned_30d`: send the one email. Write down the seat count per upcoming
weekend (the card list on the left).

**Wednesday, 20 minutes — fill the weekends.** For each weekend under 8 seats within four weeks: `fundamentals_only` and
`win_back` people whose ladder points at that course get a personal email or text with the date and the price. One
Instagram post from the last range day, link with UTM. If a newsletter is due (once a month), it goes now: dates first.

**Friday, 10 minutes — look at the numbers.** The funnel card (views → opened a class → picked a date → started → checkout
→ paid), revenue by course, revenue by source, seats on upcoming weekends. Two questions only: where did people stop
this week, and which source paid.

**Monthly.** Audience export → the list tool (or the Sync button once the keys are on the Worker). Win-back email to the
quarter's cohort. Read the T+1 replies: the quotes go to the Testimonials chapter with permission.

**Quarterly.** Recalibrate: are the segments still the right ten? DPAs with Stripe, Resend and the list tool on file.
Retention terms enforced. Prices and the ladder reviewed against what actually sold.

## 6. The numbers that matter

| Metric | Where | Good looks like |
|---|---|---|
| Speed to lead | Leads tab, `emailed` and your reply time | Same business day; 4 h for gear and agencies |
| Lead → booked | People with classes ÷ people with inquiries | 20–30 % for private / agency, lower for the contact form |
| Registration → paid | `registrations.by_status` | Above 70 %; below that, the form or the price is asking too much |
| Seats per weekend | Seats on upcoming weekends | 12+ of 16 on Fundamentals, 8 of 10 on Operator |
| Ladder rate | `fundamentals_only` shrinking over a season | A third of Fundamentals students book an Operator course within 12 months |
| Opt-in rate | `opted_in` ÷ profiles | 40 %+ of registrants tick the box when the wording is honest |
| Revenue by source | The card | Instagram and referrals should outgrow "direct"; if not, the links are missing UTMs |
| Show-up rate | Roster vs attendance (manual) | 95 %+ with T−7 and T−1 on |

## 7. What to add later, in order

1. `REVIEW_URL` (the Google review link) so the T+1 email asks for a public review rather than a reply.
2. Mailchimp or Brevo keys on the Worker: sign-ups and paid opt-ins sync themselves; the monthly export goes away.
3. `HUBSPOT_TOKEN` if he wants the pipeline view HubSpot gives (deals for agency blocks); the Worker keeps feeding it.
4. A referral line on the T+1 email that carries a code (`?ref=<id>`) — the beacon already records UTM, so a referral
   becomes a source in the same revenue-by-source card.
5. Lead magnets that fit the audience: the gear list PDF per course (email-gated), the "first range day" checklist.
6. Paid: retargeting the `open_class` and `pick_date` visitors on Instagram once the funnel shows where they drop.

Related skills in this repo: `/mkt-email-sequence` (the nurture after a lead magnet), `/mkt-lead-magnets`,
`/mkt-referral-program`, `/mkt-page-cro` (the registration flow), `/mkt-social-content` (Instagram), `/mkt-pricing-strategy`.

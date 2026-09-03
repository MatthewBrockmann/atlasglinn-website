# Cancellation and Refund Policy — DRAFT

**Status: draft for owner review. Not legal advice — have counsel read it before
it goes on the site.** Written 2026-09-01 at the owner's request, benchmarked
against the industry.

---

## What the industry does

| Academy | ≥14 days out | <14 days out | No-show |
|---|---|---|---|
| [Gunsite](https://www.gunsite.com/about-us/cancellation-policy/) | Full refund or transfer | 1/3 of tuition non-refundable; remainder refundable/transferable | — |
| [SIG Sauer Academy](https://sigsaueracademy.com/cancelation-policy) | Full refund incl. pre-purchased ammo | 75% of tuition, 100% of ammo, 0% of screening fees | — |
| Common across smaller schools | Full refund or credit | Credit only, or partial | **No refund, no credit** |

**14 days is the industry pivot**, and both of the most recognised names use it.
Matching it is defensible; being materially harsher than Gunsite invites
chargebacks and complaints.

---

## Recommended policy

Deliberately slightly more generous than Gunsite at the <14-day mark, because
MAST runs small classes where a transfer is easy to accommodate and goodwill with
returning students is worth more than a partial forfeiture.

### Cancellation by the student

| When you cancel | What happens |
|---|---|
| **15 or more days** before class | Full refund, or transfer to any future class at no charge |
| **7–14 days** before class | Transfer to any future class at no charge, **or** refund less 25% |
| **48 hours – 6 days** before class | Transfer to any future class **once**, at no charge. No refund |
| **Under 48 hours**, or no-show | No refund and no transfer |

### Transferring your seat to someone else

You may send someone in your place at no charge with at least **48 hours**
notice, provided they complete the eligibility screening and the Participation
Agreement before class. Give us their name, email and phone.

### Arriving late

Live-fire classes open with a mandatory safety brief. **A student who misses the
safety brief cannot be admitted to the range**, and is treated as a no-show. Plan
for the drive — the range is rural and your GPS will stop you short of it.

### If MAST cancels

If we cancel a class for any reason — including weather, range conditions, or
instructor availability — you choose: **a full refund, or a transfer to any
future class.** We will tell you as early as we can.

Weather calls on an outdoor range are made in the interest of safety. We do not
cancel for rain alone; we do cancel for lightning, flooding, or unsafe range
conditions.

### Medical and emergencies

Serious illness, injury, family emergency, or military or law-enforcement
deployment: contact us. We will transfer your seat to a future class at no
charge, whatever the notice. We may ask for documentation for a deployment.

### How refunds are issued

Refunds go back to the original payment method within 5–10 business days of
approval. We do not refund to a different card or by cash.

---

## Notes for the owner

- **The 48-hour line is where the money is.** Under 48 hours a seat almost never
  resells on a 10- or 16-seat class, so the forfeiture is real cost recovery, not
  a penalty. That is worth saying plainly on the page — students accept a rule
  they understand.
- **The medical/deployment carve-out costs almost nothing and buys a lot.** MAST
  trains military and LE; a deployment clause signals you understand the
  clientele.
- **Consider a non-refundable deposit model** if no-shows become a problem:
  e.g. $100 deposit non-refundable inside 14 days, balance refundable. Gunsite's
  1/3 rule is effectively this. Do not add it pre-emptively — add it if the data
  shows a no-show problem.
- **Chargebacks:** a clear, agreed policy is your defence. That is precisely why
  the checkbox below matters — Stripe will ask for evidence the customer agreed,
  and a timestamped acceptance is that evidence.

---

## Consent capture

Per the owner: **a checkbox that they agree.**

- Rendered at checkout, above the pay button, **unticked by default** — a
  pre-ticked box is not consent and is unenforceable in several jurisdictions.
- Label: *"I have read and agree to the Cancellation and Refund Policy."* with
  the policy linked, opening in place rather than navigating away from checkout.
- Store on the booking: `refund_policy_version`, `accepted_at`, `ip`.
- Version it for the same reason the agreement is versioned — if the policy
  changes, past acceptances do not cover the new terms, and a chargeback dispute
  turns on which version the customer actually saw.

```sql
ALTER TABLE orders ADD COLUMN refund_policy_version TEXT;
ALTER TABLE orders ADD COLUMN refund_policy_accepted_at TEXT;
ALTER TABLE orders ADD COLUMN refund_policy_ip TEXT;
```

---

## Open questions

1. Is 25% the right retention at 7–14 days, or match Gunsite's 1/3?
2. Should a transfer be unlimited, or once per booking as drafted?
3. Any course where a deposit is non-refundable from the moment of booking
   (e.g. an ammunition-inclusive or contracted-instructor course)?
4. Do LE/agency block bookings get different terms? They usually need a PO and
   30-day cancellation.

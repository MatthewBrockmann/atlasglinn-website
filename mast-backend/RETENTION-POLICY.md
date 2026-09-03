# Data retention — eligibility screening

**Decided by owner, 2026-09-01.** The requirement, in his words:

> *"If they have an account, it would be filled out once, and then it would not be
> populated for the next class. We don't wanna keep everything. We just want to
> store users who are not activating accounts so we can be sure we are not
> training people who are not allowed."*

And his clarification of what the screening is FOR:

> *"This is for our safety — they can lie, and we are not running background
> checks. This protects us — not to deny, as we can decide on-site if they get
> refunded per our judgment."*

**That reframes the whole thing.** The eligibility form is not a gate; it is a
signed attestation. Its job is to put the participant on record. If they lie,
the liability shifts to them — which is exactly the protection MAST needs given
no background check is run. On-site judgment remains the real decision, and the
refund policy already gives the instructor that latitude.

**Decided 2026-09-03: two questions only.** (1) Are you a U.S. citizen? (2) Do you
have a felony that would prevent you from using or handling a firearm? Yes/No
check boxes. Two well-chosen attestations are stronger than seven — a short form
gets read.

Two goals that pull against each other, and one design that satisfies both.

---

## The key distinction

**Storing a decision is not storing criminal history.**

| This | Is |
|---|---|
| *"This person may not train. Reviewed 2026-09-01."* | An operational safety record |
| *"This person answered Yes to the domestic-violence question."* | Sensitive personal data |

The first achieves the entire safety goal. The second carries nearly all of the
liability and adds nothing operationally once the decision is made.

**So: keep outcomes indefinitely. Purge the underlying answers.**

That is the whole policy, and it resolves the tension — the safety list stays
complete forever, while the sensitive data has a short life.

---

## Retention by case

| Case | What is kept | How long |
|---|---|---|
| **Account holder — cleared** | Answers on the profile | **12 months**, then purged and re-asked. Matches the waiver cycle so both renew together |
| **Guest — cleared** | Booking record + `eligibility: cleared` + date + version. **Answers purged after the class** | Outcome kept 12 months; answers gone within days |
| **Anyone — flagged or declined** | Identity + outcome + staff note. **Raw answers purged once reviewed** | **Indefinite** — this is the safety list |

### Account holders: filled once, reused

Exactly as specified. Screening is answered once and reused for 12 months, so a
returning student books without re-answering anything.

Aligning it to the waiver's 12 months matters more than it looks: both expire the
same day, so a returning student has **one** renewal moment, not two staggered
ones. Two separate expiries is how you get a customer who re-signs a waiver and
then hits a screening wall on the next screen.

### Guests: the actual requirement

The concern is real — a guest who is flagged must not be able to return as a
fresh guest, answer differently, and get onto a live-fire range.

So for guests, after the decision:

- **Cleared** → keep the booking and the word "cleared". Purge the answers.
- **Flagged or declined** → keep them on the review list **indefinitely**, checked
  by email on every future registration.

```sql
CREATE TABLE eligibility_outcomes (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  email          TEXT NOT NULL,           -- normalised lowercase
  full_name      TEXT,
  profile_id     TEXT,                    -- null while a guest
  outcome        TEXT NOT NULL,           -- cleared | flagged | declined
  questions_version TEXT NOT NULL,
  decided_at     TEXT NOT NULL,
  expires_at     TEXT,                    -- cleared only; NULL = never expires
  staff_note     TEXT,                    -- staff-written, minimal
  reviewed_by    TEXT
);
CREATE INDEX idx_outcomes_email ON eligibility_outcomes (email);

-- Raw answers live separately and are purged on a schedule.
CREATE TABLE eligibility_answers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  outcome_id   INTEGER NOT NULL,
  answers_json TEXT NOT NULL,             -- the Y/N set
  created_at   TEXT NOT NULL,
  purge_after  TEXT NOT NULL              -- see schedule below
);
```

Separating the two tables is the point. The purge job empties
`eligibility_answers` and never touches `eligibility_outcomes`, so the safety
list cannot be lost by a retention rule.

### Purge schedule (daily cron)

```sql
DELETE FROM eligibility_answers WHERE purge_after < now();
```

`purge_after` is set at write time:

| Situation | purge_after |
|---|---|
| Cleared, guest | class date + 7 days |
| Cleared, account holder | decided_at + 12 months (mirrors the reuse window) |
| Flagged / declined | reviewed_at + 30 days — long enough to handle an appeal, then gone |

The 30-day window on a flagged record is deliberate: staff need the answers while
the follow-up conversation is live, and do not need them afterwards. The
**outcome** survives; the answers do not.

### Guest → account promotion

When a guest later registers with the same email, their outcome row is claimed by
setting `profile_id`. History carries forward — a cleared guest is not re-screened
from scratch, and a flagged one cannot escape the list by creating an account.

---

## What this does not do

Worth stating plainly so the list is not over-trusted:

**It catches the honest and the repeat attempt. It does not catch fraud.**
Someone determined to get onto the range can use a different email address and a
different name and answer No. No self-attestation system prevents that; a
background check would, and that is a different product with different cost and
consent requirements.

What the list genuinely prevents: a person who has already been flagged quietly
trying again through the same front door. That is the realistic failure mode, and
this closes it.

The instructor's judgment on the day remains the real control. This reduces what
reaches him; it does not replace him.

---

## Why this is also the compliant answer

Under the TDPSA, criminal-history responses are **sensitive personal data**
(see `DATA-AND-MARKETING.md`). Three principles line up with what the owner
already wants:

- **Data minimisation** — keep what serves a purpose, and once a decision is made
  the answers no longer serve one
- **Purpose limitation** — collected to decide eligibility, used for nothing else,
  never routed to marketing or analytics
- **Storage limitation** — a stated term, enforced by a job, not by intention

"We don't wanna keep everything" is not just the owner's preference here; it is
the position that carries the least risk. The version that keeps every answer
forever would be both more exposed and no safer.

---

## Access

- `eligibility_answers` — readable only by an admin role, under row-level
  security. Never emailed. Never in an event payload.
- `eligibility_outcomes` — readable by staff handling registrations.
- Every read of either table is logged: who, when, which record.
- Neither table syncs to Mailchimp, PostHog, or any third party. Ever.

---

## Open

| # | Question | Why it matters |
|---|---|---|
| 1 | Should a **declined** person be told they are on the list if they try again? | Silently failing repeatedly is worse for them and generates support load |
| 2 | Who may clear a flag — Matthew only, or any of the four recipients? | Determines the admin role model |
| 3 | Is 30 days the right appeal window on a flagged record? | Longer keeps sensitive data alive; shorter risks purging mid-conversation |

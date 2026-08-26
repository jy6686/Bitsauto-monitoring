# Billing Policy

**Status: FROZEN — 2026-08-26. Owner-decided.**

The business rules every finance module follows: CDR import, rating, DMR, reconciliation, invoice
generation, finance reports. Where a rule is already implemented this document points at the code
rather than restating it — a policy that exists in two places drifts.

Companion: `docs/BILLING-RECONCILIATION-CONTRACT.md` (the pre-invoice gate).

---

## 1. Time standard

**UTC (GMT+00:00) is the only billing clock.** CDR timestamps · tariff effective times · billing
periods · invoice periods · reconciliation windows · certification windows · scheduled generation.
No local timezone conversion anywhere in billing.

### 1.1 Periods are half-open, never `23:59:59`

```
[start 00:00 UTC, end 00:00 UTC)
```

The owner's statement of the cycles used `23:59:59` as the closing bound. **This document adopts
the half-open form instead**, because the platform already settled it and the reason is recorded in
`server/billing-periods.ts`:

> `cdr_start_time <= '2026-08-31'` is lexically FALSE for '2026-08-31 14:00:00', so it drops the
> entire last day. The correct form is `>= start AND < endExclusive`, which needs no truncation and
> has no 23:59:59 case to get wrong.

`23:59:59` also silently discards the final second of every period. The two forms express the same
business intent; only one of them is safe to implement. `BillingPeriod` therefore carries both an
inclusive `end` (what the invoice *prints*) and an `endExclusive` (what every *query* compares
against).

**The seeder does not yet follow this, and it is worse than an off-by-one-second.**
`server/routes.ts:32718` builds `${periodStart}T00:00:00` with **no offset**. That string reaches
`toSippyDate` (`server/sippy.ts:3565`), which does `new Date(s)` — ES parses an offsetless
date-time as LOCAL — then reads `getUTC*` and labels the output **"GMT"**. Measured:
`TZ=Asia/Karachi node -e "new Date('2026-08-16T00:00:00')"` yields `2026-08-15T19:00:00Z`, a five-hour
shift, mislabelled GMT. `/api/finance/pipeline-trace` builds its switch probe the same way
(`routes.ts:33893`).

**Owner decision 2026-08-27: this is a PREREQUISITE, not a follow-up.** Unlike a defect confined to
one report, it moves the window for imports, certification, billing periods, reconciliation and
invoices alike — every time-bounded operation on the platform — and the policy above is frozen on
UTC. No production comparison can be trusted until every component shares one period convention.
Latent on a UTC host; silent on any other. See §8.

---

## 2. Destination identity — the Catalogue owns it

The Destination Catalogue is the single source of truth for:

Country · Destination · Breakout Destination · Customer Billing Name · Prefix mapping ·
Commercial mapping

**Once a CDR resolves to a Breakout Destination, every downstream finance object uses that value.**
DMR · invoice · finance reports · customer statements · reconciliation. No component re-derives a
customer-facing name from the raw Sippy string — `Pakistan FIXED`, `PK FIXED` and `92 FIXED` must
not appear as three rows on one invoice.

---

## 3. Billing rules — the Tariff owns them

The tariff is the single source of truth for:

Rate · Interval1 · IntervalN · Grace · Connect Fee · Surcharge · Effective From · Effective To

**Intervals do not come from the Destination Catalogue.** The owner raised and then corrected this
in the same message, and the correction is right: the catalogue says *what* the destination is, the
tariff says *how it is billed*. This restates the rule already set on 2026-08-26 — *"catalogue =
identity only; tariff = billing contract; rating engine = executor. No interpretation. No derived
intervals. No catalogue lookups."*

The separation matters most exactly where the owner raised it: a destination's identity is stable
while its price may change several times in a day. Identity and price cannot share an owner.

---

## 4. Rate changes inside a billing period

Every call is rated using the tariff **effective when the switch billed that call**. If Sippy
changes a rate four times in a day, BitsAuto preserves the same effective history, so a historical
invoice reproduces what Sippy actually charged.

```
09:00  0.035
11:30  0.032
14:00  0.030
18:15  0.028
```

Two prohibitions follow, and both have been observed as real failure modes:

- **Never the latest rate.** A call at 09:30 is billed at 0.035 even though the tariff now reads
  0.041. This is exactly what `resolveRate` does today — §4.1.
- **Never an average.** A blended rate reconciles against nothing, because Sippy's own summary
  reports each price separately.

An invoice therefore carries **one breakout row per rate**, not a blended average:

| Breakout Destination | Rate | Minutes | Amount |
|---|---|---|---|
| Pakistan Fixed | 0.035 | 120.50 | 4.22 |
| Pakistan Fixed | 0.032 | 95.25 | 3.05 |
| Pakistan Fixed | 0.030 | 80.10 | 2.40 |

### 4.1 This rule is not implementable today — see §8

Effective dating exists at the **tariff version** level: `tariff_versions.effective_from` /
`effective_to` are `timestamp` columns (migration 074), so sub-day changes are representable and no
schema change is needed.

It does **not** exist at the **rate row** level. `resolveRate`
(`server/services/sippy/sippy-rating-verification.service.ts:124`) filters by prefix and returns the
longest match. It never reads the row's activation or expiration:

```ts
const matches = rates.filter(r => normalized.startsWith(prefix));
if (!matches.length) return null;
return matches.reduce((best, curr) =>
  (curr.prefix?.length ?? 0) > (best.prefix?.length ?? 0) ? curr : best);
```

Among equal-length prefixes the reduce keeps the **first array element**, so the row chosen depends
on the order Sippy happened to serialise the snapshot — not on when the call started. With four
same-prefix rows, three of the four rate periods would be billed wrong.

This was classified as technical debt on 2026-08-26, correctly at the time: the one observed case
(prefix 165, a five-second correction in a test SBC) carried no traffic, and the effective row sat
at the lower index by luck. **Freezing §4 promotes it to a prerequisite.** A policy that says rates
may change four times a day rests entirely on the resolver reading dates.

The fix is bounded — filter `matches` by the call's start time against each row's activation and
expiration before choosing the longest prefix. No migration.

---

## 5. Invoice breakout identity

```
(Customer, Breakout Destination, Prefix, Rate, Currency)
```

Rate is part of the row's identity, not a display attribute derived after grouping — settled in
`bd978ad8`. §4 is why: blend two rates into one row and a mid-period change becomes invisible on the
document, and unreconcilable against Sippy, whose own summary groups by "Prefix and Price".

The reconciliation uses this same identity (`BILLING-RECONCILIATION-CONTRACT.md` §4), so DMR,
invoice, reconciliation and finance reports all aggregate the same business entity.

---

## 6. Billing cycles

**Already implemented and frozen** in `server/billing-periods.ts`. Do not restate these rules in
new code; call the module.

| Term | Period | Generated |
|---|---|---|
| `weekly` | Monday 00:00 UTC → next Monday 00:00 UTC | After the week closes |
| `semi_monthly` | 1st → 16th, and 16th → 1st of next month | 16th, and 1st of next month |
| `monthly` | 1st → 1st of next month | 1st of the following month |

`semi_monthly` is used rather than "bi-monthly" deliberately — in business English bi-monthly can
mean twice a month *or* every two months, and a billing cycle cannot carry that ambiguity.

### 6.1 The calendar month outranks the cycle

> No customer invoice may span two accounting months.

A Monday–Sunday week crossing month-end is split: 29–31 Jan closes January, 1–2 Feb opens February.
`splitAtMonthEnd()` implements this, and the one-day invoice it can produce is intended, not a
degenerate case — the alternative is a document carrying revenue from two accounting months, which
month-end close, VAT and account reconciliation would then have to apportion.

---

## 7. Sequencing

```
Sippy CDR → Import → Destination Catalogue → Tariff → Rating
    → Certification (call level) → DMR
    → Billing Reconciliation (invoice level) → PASS → Invoice
```

Three layers, three questions, and they run in this order because each one's answer is
meaningless without the one before it:

| Layer | Question | Customer-facing |
|---|---|---|
| Certification | Does each imported call reproduce what the switch charged? | No |
| Billing Reconciliation | Does the bill match Sippy's own summary for the period? | The gate |
| Financial Reconciliation (F3) | Are our own financial snapshots internally consistent? | After billing, independent |

Reconciliation starts report-only and becomes a gate per the rollout in
`BILLING-RECONCILIATION-CONTRACT.md` §11. Invoice generation additionally requires the billing
period to be closed (`isPeriodClosed`, `isAccountingMonthClosed`).

---

## 8. Implementation status

Honest as of 2026-08-26. Freezing a policy does not implement it.

| Rule | Status |
|---|---|
| §1 UTC everywhere | `billing-periods.ts` is UTC-only by construction |
| §1.1 Half-open periods | Implemented in `billing-periods.ts`; **the seeder still uses `T23:59:59`** |
| §2 Catalogue owns identity | Enforced in the invoice PDF renderer; **not verified across DMR, finance reports, customer statements** |
| §3 Tariff owns billing rules | Holds |
| §4 Rate effective at call time | **Version level yes (074). Row level NO — §4.1. Blocker.** |
| §5 Breakout identity includes rate | `bd978ad8` |
| §6 Cycles | `billing-periods.ts`, tested |
| §6.1 Month-end precedence | `splitAtMonthEnd()`, tested |
| §7 Reconciliation gate | Specified, not built. NB five reconciliation subsystems already exist; this is a new TYPE inside Revenue Assurance, not a sixth system |

Three items need work before this policy is true end to end: the row-level rate resolver (§4.1),
the seeder's period bound (§1.1), and an audit of which downstream surfaces still read raw Sippy
destination strings (§2).

---

## 9. Provenance

Owner decisions, 2026-08-26: UTC as the only billing clock · Destination Catalogue owns
customer-facing identity, tariff owns billing rules · intervals come from the tariff, not the
catalogue (raised and self-corrected in the same message) · effective rate history mirrored from
Sippy including multiple changes per day · breakout grouped by destination + rate · weekly
Monday–Sunday, semi-monthly 1–15 / 16–end, monthly · calendar month outranks the weekly cycle ·
invoice only after the period closes and reconciliation passes or an override is recorded.

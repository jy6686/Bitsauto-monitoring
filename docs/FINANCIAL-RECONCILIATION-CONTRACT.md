# Financial Reconciliation Contract

**Status: FROZEN — 2026-08-26. Owner-decided. No code before this document is agreed.**

A specification, not an implementation plan. Every rule here was decided by the owner during the
CAP-003 investigation on 2026-08-26 and is recorded so that the reasoning survives the decision.

---

## 1. Why this exists

On 2026-08-26 the platform produced a correctly formatted invoice, for the correct customer, with
every per-call amount taken from the switch's own `actual_cost` — and the invoice was still wrong,
because it covered roughly one percent of the traffic.

Sippy's own Customer Summary for `Acct. asterisk`, 2026-08-16 → 2026-08-23:

| Prefix | Country | Rate | Billed Duration | Charged |
|--------|---------|------|-----------------|---------|
| 192 | Pakistan | 0.0350 | 16,226:18 | 567.9205 |
| 1880 | Bangladesh | 0.0098 *(bills 0.00985)* | 854:02 | 8.4122 |
| | | | **17,080:20** | **576.3327** |

BitsAuto's certification over the same window saw 179.12 minutes and $5.42.

No unit test could have caught this. Every individual value was right. The **population** was
wrong, and nothing in the pipeline compared the total against anything outside itself.

**The rule this establishes:** an invoice may not be issued because BitsAuto produced a number. It
may be issued because BitsAuto demonstrated that its number matches the system that actually billed
the customer.

---

## 2. Terminology — two distinct gates

These have been used interchangeably and must not be.

| | Certification | Financial Reconciliation |
|---|---|---|
| **Question** | Does our rating engine compute what the switch computed, per call? | Does the bill we are about to issue match the switch's own summary? |
| **Compares** | `reproducedCost` vs `actual_cost`, call by call | BitsAuto DMR vs Sippy Customer Summary, row by row |
| **Reference** | The CDR's own cost field — already inside BitsAuto | An independently produced Sippy report |
| **Proves** | The engine is correct | The bill is complete and correct |
| **Exists today** | Yes | No |

Certification cannot detect a missing population: it only inspects calls that were imported.
Reconciliation cannot detect a per-call rating error that cancels out in aggregate.

**An invoice requires both.** Neither subsumes the other.

---

## 3. The reference must be independent

The reconciliation compares BitsAuto against a summary **computed by Sippy**. It must never
compare BitsAuto against a re-aggregation of the CDRs BitsAuto imported — that answers a different
question (is our arithmetic self-consistent?) and always passes.

The codebase already learned this once, at `server/routes.ts:32917`:

> copying the switch cost into both the reproduced and actual columns made the invoice's difference
> zero by construction. A reconciliation that cannot fail is not a reconciliation

This is the constraint most likely to be lost during implementation, because summing
`raw_sippy_cdrs` is easy and produces a green result.

### 3.1 The adapter

The engine must not know how the reference was obtained.

```
FinancialReferenceProvider
  getCustomerSummary(customer, period) -> ReferenceResult

ReferenceResult =
  | { available: true,  rows: CustomerBillingRow[], source, retrievedAt }
  | { available: false, reason: string, source, attemptedAt }

CustomerBillingRow
  prefix          string        exact, as the switch reports it
  destination     string
  rate            decimal       FULL stored precision — never the displayed value
  currency        string
  billedSeconds   integer
  chargedAmount   decimal
  calls           integer       informational only (see §5)
```

**Availability is part of the return type, not an exception and not an empty array.** An adapter
that returns zero rows on failure turns a Sippy outage into "the switch says you billed nothing",
which reconciles as a total mismatch and reads as a rating catastrophe. This is the same
distinction the platform already enforces elsewhere: *observation failed* is not *the thing failed*.

### 3.2 First implementation

`customer_reports.php` — the Customer Summary — via its **CSV export**, not the rendered HTML table.

Two reasons, both load-bearing:

1. **Precision.** The page displays rates to 4dp. Bangladesh renders `0.0098`; the switch bills
   `0.00985` (`8.4122 ÷ 854.0333`). Reconciling against the displayed value fails on correct data.
2. **Stability.** The existing P&L scraper carries "flexible column detection: maps header text
   patterns rather than fixed column indices" — hardening added because the fixed-index version
   broke. A financial gate should not inherit that failure mode.

### 3.3 Why not the Profit/Loss report

Not a question of ownership. `scrapeProfitLossReport()` (`server/sippy.ts:1657`) takes portal
credentials and a date range — **no customer parameter** — and returns one row per day:
`{ date, calls, durationSec, revenue, cost, profit, margin }`.

Four of the seven fields the gate compares are absent, including the customer dimension. It could
not scope to one customer before it got as far as prefixes. Different query, different module.

The P&L report is **not modified by this work.**

---

## 4. Comparison identity

Rows are matched on:

```
(customer, period, prefix, rate, currency)
```

**Not prefix. Not destination.**

Sippy's own report groups by "Prefix and Price" — price is part of the key, not an attribute of the
group. This is not cosmetic: prefix 165 in tariff 32 carries two rows because a rate was corrected
mid-period. Grouping by prefix alone leaves one BitsAuto row facing two Sippy rows with no correct
rate to compare, and a mid-period tariff change becomes structurally unreconcilable.

Consistent with `bd978ad8` — *"Rate is part of a breakout row's identity, not a derived display
value."* The reconciliation identity and the invoice breakout identity must be the same, or the two
cannot be compared row for row.

Rows present on one side only are reported as **unmatched**, never silently dropped, and never
netted against each other.

---

## 5. Fields and tolerances

### Mandatory — these gate the invoice

| Field | Rule |
|---|---|
| Prefix | Exact string match |
| Destination | Exact match after Destination Catalogue normalisation |
| Rate | Exact, at full stored precision |
| Billed seconds | Exact integer match |
| Charged amount | Absolute difference ≤ **$0.01** per row |
| Invoice total | Absolute difference ≤ **$0.01**, against **Sippy's own printed total** |

The invoice total is compared against the total Sippy reports (`576.3327` on the reference above),
**never against a sum of the rows that matched.** A total derived from matched rows passes whenever
the rows pass and validates nothing — the same "cannot fail" shape §3 rejects. Comparing against
Sippy's independently computed total is what catches rows present on only one side.

**No percentage tolerances.** Finance audits money, not ratios. A percentage band scales the
permitted error with the invoice, which is exactly backwards: a large invoice does not license a
large error.

### Informational — reported, never gating

`calls` · average call duration · ASR · ACD

**Why calls is not a gate.** Sippy's "Number of Calls" counts *attempts*. Proof from the reference
itself: Bangladesh shows 59,104 calls against 51,242 billed seconds. With `interval1 ≥ 1s` every
billed call bills at least one second, so a call count exceeding billed seconds is only possible if
unbilled attempts are included. BitsAuto counts billable calls. Both are correct; they measure
different sets. Gating on them would produce permanent false failures.

If a calls comparison is wanted later, it must first agree a definition on both sides. Until then
it is a diagnostic.

**Conditionally reopenable.** The owner subsequently asked for connected/billable calls to gate.
The obstacle is the reference, not the policy: the Customer Summary carries **one** calls column
and it counts attempts. Deriving connected calls from the imported CDRs and comparing them to
BitsAuto's DMR is the self-referential check §3 forbids — both sides computed from the same rows.

There may be a path. The report screen carries a `Show call records` filter, and the CDR API
exposes `'all' | 'non_zero' | 'non_zero_and_errors' | 'complete' | 'incomplete' | 'errors'`
(`server/sippy.ts:4491`). **If the report offers the same filters, a second pull with a
connected-only filter yields an independently computed connected-call count, and this field becomes
gateable exactly as asked.** Unverified. Until it is, calls stay informational — the frozen
decision stands, and this note records why it may change rather than changing it silently.

---

## 6. Period convention

```
UTC, half-open: [start, end)
```

`2026-08-16 00:00:00 UTC ≤ call < 2026-08-23 00:00:00 UTC`

This mirrors Sippy's own report boundary exactly.

**The existing seeder does not follow this.** `server/routes.ts:32719` builds
`endIso = ${periodEnd}T23:59:59` — end-inclusive, timezone unstated, and it drops the final second
of the period. Mixing `23:59:59` with `00:00` eventually bills the last second twice, or never.

Aligning the seeder is a prerequisite for the gate and is a **behavioural change to billing
ingestion** — it must ship on its own, with its own evidence, not inside the reconciliation module.

---

## 7. Three outcomes

```
PASS                   Reference obtained · comparison completed · all mandatory fields within tolerance
FAIL                   Reference obtained · comparison completed · differences detected
REFERENCE UNAVAILABLE  No comparison was possible
```

`REFERENCE UNAVAILABLE` is **not** `FAIL` and must never be rendered as one. It states: *the Sippy
reference could not be obtained; reconciliation was not performed.* The remedies are unrelated —
one is a billing investigation, the other is a connectivity problem — and conflating them sends
Finance to audit numbers that were never compared.

It is equally not a PASS. An invoice may not proceed on an unavailable reference except by override.

### 7.1 What a FAIL leads to

Reconciliation is read-only (§9): it reports a disagreement, it never corrects the DMR. So a FAIL
holds the invoice and changes nothing else, and without a defined exit every failure becomes a
permanent hold. The loop back to PASS is:

```
FAIL
  ↓
Classify the difference
  ↓
  ├── population — rows or minutes missing on the BitsAuto side
  │        ↓ re-run ingestion for the period, then re-reconcile
  │
  ├── rating — same population, amounts differ
  │        ↓ certification investigation; the DMR is not re-rated to force agreement
  │
  ├── identity — prefix, rate or destination unmatched
  │        ↓ commercial mapping / catalogue, then re-reconcile
  │
  └── reference — Sippy's own figure is believed wrong
           ↓ override (§8); never "adjust BitsAuto until it matches"
```

Each re-reconciliation is a **new run**, never an edit of the previous one — same discipline as
`snapshot_verification_runs` (migration 070), where a re-run creates a row rather than rewriting
history. A period's reconciliation history is part of the audit trail, including the failures.

**The forbidden remediation:** adjusting BitsAuto's stored figures so the comparison passes. That
converts the gate into a mechanism for manufacturing agreement, which is worse than not having it.
Ingestion may be re-run; results may not be edited.

---

## 8. Override

An override is an approved exception, not a dismissed warning.

**Requires:** Finance Director or Commercial Director · a written reason · both recorded.

**The invoice document itself carries the stamp** — not only the audit log:

```
Certification:  Override Approved
Reason:         Customer requested early invoice
Approved by:    J. Qadeer
Approved:       2026-08-26 15:41 UTC
```

Six months later, someone holding only the PDF must be able to see that it was issued under an
exception. An audit log in a database the reader does not have access to does not achieve that.

This is the **only** write this module makes outside its own tables (§9).

**Why an override exists at all:** "no reconciliation, no invoice" means a Sippy outage stops
billing entirely, and the predictable response to that at month-end is someone switching the gate
off permanently. Blocked-by-default with an audited exception survives contact with a deadline.
Blocked-absolutely does not.

---

## 9. Additive guarantee

**Nothing in the existing reporting or billing pipeline changes.** Hard requirement.

Unchanged: DMR generation and reports · Profit/Loss report · existing invoices · existing APIs ·
rating engine · destination mapping · tariff logic · certification.

The reconciliation module **reads** BitsAuto's DMR and the Sippy reference, compares them, and
records a result. It never updates the DMR, invoice amounts, tariffs, CDRs, or certification.

**One precision on "read-only", because taken literally it makes the gate unbuildable:** the module
writes to exactly two places.

1. **Its own result tables** — a reconciliation run must be persisted or the invoice flow has
   nothing to read, and a financial control that is not durable is not a control.
2. **The override stamp on the invoice** (§8) — a provenance field, never an amount.

Everything else is read-only. Any pull request that widens this list is out of contract.

### 9.1 Surfaces — no new pages

**Owner decision: reconciliation adds no page and no navigation item.** It appears as a step inside
the workflow Finance already uses, on screens they already know.

| Existing surface | Addition |
|---|---|
| DMR / Billing | A reconciliation status panel after DMR generation — per-field ✓/✗ and an overall status |
| Billing | A section or tab alongside DMR and Invoices — **not** a sibling page |
| Invoice generation | The reconciliation result shown at the point of generation, with the reason when it blocks |
| Invoice PDF | A provenance block: status, what it was verified against, when, by whom — or the override stamp (§8) |

Untouched: Profit/Loss · margin reports · finance dashboard · DMR reports · billing reports ·
customer statements · analytics. No report logic is replaced, no navigation is restructured, and no
existing query is rewritten. Every one of these keeps reading the same BitsAuto tables it reads
today.

No duplicate billing tables. Reconciliation persists its own results (§9, write 1) and nothing else.

---

## 10. Blocking prerequisite — money is stored as `float4`

**The $0.01 tolerance is currently tighter than the storage type can deliver.** This is not a
theoretical concern; it was measured.

Every money column in the billing chain is `real` (single precision, ~7 significant digits):

- `raw_sippy_cdrs.cost`
- `rating_verifications.sippy_actual_cost`, `.reproduced_cost`, `.delta_amount`
- `invoice_cdr_snapshots.reproduced_cost`, `.actual_cost`, `.delta`
- `invoice_line_items.reproduced_cost`, `.actual_cost`, `.delta`
- `invoices.total_reproduced`, `.total_actual`, `.total_delta`

Postgres sums `real` in `real`. Measured on PostgreSQL 16 with per-call amounts of the same shape
as this customer's traffic:

| Rows | `sum(real)` | `sum(col::numeric)` | Error |
|------|-------------|---------------------|-------|
| 165,323 | 626.7809 | 626.852957998 | **+$0.072** |
| 1,653,232 | 6272.048 | 6268.498079977 | **−$3.552** |

Seven times the tolerance at the smaller scale, 355× at the larger — and the sign flips, so it is
not a bias that could be corrected for.

This already affects production. `server/services/invoice-pdf.service.ts:85` sums in `real` and
casts afterwards:

```sql
coalesce(sum(li.actual_cost), 0)::numeric AS amount
```

**Two remedies, in order:**

1. **Cast before summing** — `sum(col::numeric)` — everywhere money is aggregated. Cheap,
   non-breaking, and removes the question. Required before the gate can be evaluated at all.
2. **Migrate the money columns to `numeric`.** Class D — needs production evidence and its own
   change. Until then, remedy 1 is load-bearing rather than tidy.

Neither belongs inside the reconciliation module. Both must land before Phase 3.

---

## 11. Rollout

Behind a feature flag, default **OFF**, per house pattern.

**Two independent axes. Do not collapse them.** *Where* the result appears and *whether* it blocks
are separate decisions, and the surfaces may all ship while enforcement stays off.

### 11.1 Enforcement — when it starts blocking

| Phase | Behaviour | Exit criterion |
|---|---|---|
| **1 — Observe** | Runs and is visible on every surface. Blocks nothing. Invoice generation is byte-for-byte what it is today. | The backtest below is answered |
| **2 — Soft enforcement** | A failure is prominent and routes the invoice to Finance approval; a director override is recorded with its reason. Invoices can still be issued. | No false failures across a full billing cycle |
| **3 — Hard enforcement** | FAIL blocks generation. The audited override path (§8) remains. | — |

Phase 1 produces the evidence that the reconciliation logic is right *before* it can stop anyone
from invoicing. A gate that blocks correct invoices will be switched off and never switched back on.

**Phase 1's deliverable is a backtest, not a screen.** Run the reconciliation over periods already
invoiced and answer one question:

> If reconciliation had been mandatory today, how many invoices would have failed — and why?

Every failure is then classified per §7.1. A phase that produces only a status panel has not
validated anything; the retrospective failure report is what earns Phase 2.

**This sequencing is load-bearing, not caution.** Three known sources of false failure exist right
now: `float4` summation (§10), the period boundary mismatch (§6), and rate display precision (§3.2).
Enforcing before those are closed blocks correct invoices on day one.

### 11.2 Surfaces — where it appears

Independently, and in any order: the DMR/Billing status panel · the Billing section · the invoice
generation screen · the invoice PDF provenance block (§9.1).

A surface showing `FAIL` while enforcement is at Phase 1 is correct and intended: Finance sees the
disagreement and decides, without the platform refusing to invoice.

### 11.3 Build order

Owner-set. Reconciliation cannot be trusted until the pipeline feeding it is:

1. **Prove CDR completeness** — the population question. Until BitsAuto imports the full set, every
   reconciliation fails for one reason and teaches nothing about the others. Affects invoice
   accuracy directly.
2. **Correct rating verification** — so reproduced values match the switch per call. Affects
   certification accuracy.
3. **Standardise money aggregation** (§10) — so the tolerance means something. **Affects every
   financial total on the platform, not only reconciliation**, which is why it is not deferred into
   the reconciliation build.
4. **Reconciliation inside the existing Billing workflow** — no new pages (§9.1), report-only.
5. **Enable enforcement** — only after Phase 1 has demonstrated stability on production data.

Steps 1–3 are prerequisites, not parallel work.

**Hard enforcement additionally requires all five closed:** CDR population completeness verified ·
rating verification matching Sippy · money aggregation consistent (§10) · period boundaries aligned
(§6) · rate precision handled at full stored precision (§3.2) — plus the reconciliation installed at
a single chokepoint.

### Single chokepoint

There are three invoice entry points. One of them enforced neither certification nor period close
until `7bacdd19` this month. **A gate installed at two of three is not a gate.** Phase 3 must
identify the single point every invoice passes through, or create one.

---

## 12. Open — not decided by this contract

- Whether `customer_reports.php` CSV export is reachable with the credentials the platform holds.
  The whole design rests on it; unverified.
- Destination normalisation between Sippy's `Country` column and the Destination Catalogue. Sippy
  reports `PAKISTAN`; the catalogue is the naming authority. Matching rule undefined.
- Retention of reconciliation runs. Certification runs are immutable and re-runs create new rows
  (`snapshot_verification_runs`, migration 070). Reconciliation should follow, but is unstated.
- Multi-currency. `currency` is in the identity key; behaviour when a period spans currencies is
  undefined.

---

## 13. Provenance

Owner decisions, 2026-08-26, in sequence: reconciliation as a mandatory pre-invoice gate ·
separate module from Profit/Loss · adapter interface for the reference · identity is
`(customer, prefix, rate, currency)` · calls informational, not gating · absolute $0.01, no
percentages · UTC half-open periods · override requires director approval, a reason, and a stamp on
the document · three outcomes · additive only, nothing existing changes · three-phase rollout.

Evidence gathered in support: the Sippy Customer Summary above · the 1% population gap · the
Bangladesh attempts-vs-billed-seconds proof · the 0.00985 rate precision proof · the measured
`float4` summation error.

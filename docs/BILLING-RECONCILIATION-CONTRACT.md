# Billing Reconciliation Contract

> **Named deliberately.** `Financial Reconciliation` is already taken by F3
> (`/finance/reconciliation`), which reads `financial_snapshot` only and never leaves BitsAuto's
> own data. This document specifies **Billing Reconciliation** — the comparison against an
> independent Sippy reference — as a new reconciliation *type* inside the existing Revenue
> Assurance framework. See §2 and §9.2.

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

## 2. Terminology — three things called reconciliation

These have been used interchangeably and must not be. Two of them gate an invoice; one does not.

| | Certification | Billing Reconciliation | Financial Reconciliation (F3) |
|---|---|---|---|
| **Question** | Does our rating engine compute what the switch computed, per call? | Does the bill we are about to issue match the switch's own summary? | Are BitsAuto's own financial snapshots internally consistent? |
| **Compares** | `reproducedCost` vs `actual_cost`, call by call | BitsAuto DMR vs Sippy Customer Summary, row by row | `financial_snapshot` against itself, with AI anomaly detection |
| **Reference** | The CDR's own cost field — already inside BitsAuto | An independently produced Sippy report | None external — by contract, reads `financial_snapshot` ONLY |
| **Proves** | The engine is correct | The bill is complete and correct | Nothing about completeness against the switch |
| **Gates invoicing** | Yes | Yes, once enforced (§11) | No |
| **Exists today** | Yes | No | Yes |

### 2.1 Which engine is authoritative

Owner decision, 2026-08-27, after finding three live components that each present themselves as
reconciliation. Three engines determining "truth" independently is how they come to disagree.

| Engine | Role | Authority |
|---|---|---|
| **Certification** | Technical validator — the rating engine reproduces the switch, per call | Authoritative on ARITHMETIC |
| **Billing Reconciliation** | Commercial validator — the bill matches the switch's own summary | **Authoritative on WHETHER AN INVOICE MAY ISSUE** |
| **Financial Reconciliation (F3)** | Accounting verification after billing | Authoritative on nothing pre-invoice |
| **DMR** | Presentation / report | Not a validator — see below |
| **Carrier reconciliation** | Vendor dispute | Out of the customer-invoice path |

**The DMR becomes a report, not a control.** It currently *reports informational parity rather than
independent reconciliation*: `sippy-dmr.service.ts:277-278` sets `platDur = sipDur` and
`platAmt = sipAmt`, and every other row-construction path in that function does the same, so
`driftDuration`, `driftAmount` and `discrepancyType` are structurally fixed and `missing_cdr`
("Sippy shows usage, platform sees none") can never fire. That is the precise description: the
comparison was written as a placeholder awaiting a tariff-snapshot wire-up that never came, and it
has been serving as a control in the meantime. Its own field names are what mislead — a report that
says `verificationStatus: 'verified'` over a number compared with itself.

Nothing about the DMR changes until Billing Reconciliation is proven. It keeps generating, keeps
emailing, keeps its page. What changes is what anyone is entitled to conclude from it.

**F3 is not a substitute and was never intended as one.** Its own contract rule — *"Read
`financial_snapshot` ONLY"* — is what makes it unable to detect the failure that motivated this
document: a population that is internally consistent and 99% incomplete. Both engines are correct
at what they do. Only one of them ever looks outside BitsAuto.

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

**And no sixth reconciliation system.** Five already exist, all routed: `/finance/reconciliation`
(F3) · `/client-reconciliation` · `/carrier-reconciliation` · `/cdr-reconciliation` · `/recon-lab`,
with migration 031 registering several under Finance → **Revenue Assurance**. Billing
Reconciliation is a reconciliation *type* within that framework — a tab beside the existing ones,
not a sibling application.

| Existing surface | Addition |
|---|---|
| Revenue Assurance | Billing Reconciliation as a type alongside Financial / Client / Carrier / CDR |
| DMR / Billing | A status panel after DMR generation — per-field ✓/✗ and an overall status |
| Invoice generation | The result shown at the point of generation, with the reason when it blocks |
| Invoice PDF | A provenance block: status, what it was verified against, when, by whom — or the override stamp (§8) |

Untouched: Profit/Loss · margin reports · finance dashboard · DMR reports · billing reports ·
customer statements · analytics. No report logic is replaced, no navigation is restructured, and no
existing query is rewritten. Every one of these keeps reading the same BitsAuto tables it reads
today.

No duplicate billing tables. Reconciliation persists its own results (§9, write 1) and nothing else.

### 9.2 Share the framework — only the comparison is new

One framework, several engines. **Only the comparison logic differs**; everything around it is
already built and must be reused rather than reimplemented:

append-only reconciliation runs · audit history · export engine · scheduling · email delivery ·
result storage · evidence attachments · version stamping

F3 is the pattern to follow, from its own contract:

- **Append-only** — no `UPDATE` to result rows; a re-run creates a new run
- **`reason_code` non-null on every discrepancy** — a difference with no classification is not a
  finding, it is a number
- **Findings link their run and their record**, so any conclusion traces to the row that produced it
- **Version-stamped reproducibility** — *same reference + same engine version → identical result.*
  For Billing Reconciliation the reference is external, so the retrieved summary must be stored
  with the run; re-running against a re-fetched summary is a different run, not a repeat of the
  same one.

The last point is the one that does not carry over unchanged from F3, and it matters: F3's input is
a local snapshot that cannot move under it. Ours is a report fetched over the network, which can.
Reproducibility therefore requires **persisting the reference as retrieved**, not just its verdict.

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
4. **Consolidate CSV/XLSX import and export into one shared library** — so identity fields survive a
   round trip and exports carry stored rather than display precision (§12).
5. **Billing Reconciliation inside the existing Revenue Assurance framework** — no new pages, no
   sixth system (§9.1, §9.2), report-only.
6. **Enable enforcement** — only after Phase 1 has demonstrated stability on production data.

Steps 1–4 are prerequisites, not parallel work.

**Hard enforcement additionally requires all five closed:** CDR population completeness verified ·
rating verification matching Sippy · money aggregation consistent (§10) · period boundaries aligned
(§6) · rate precision handled at full stored precision (§3.2) — plus the reconciliation installed at
a single chokepoint.

### Single chokepoint

There are three invoice entry points. One of them enforced neither certification nor period close
until `7bacdd19` this month. **A gate installed at two of three is not a gate.** Phase 3 must
identify the single point every invoice passes through, or create one.

---

## 12. Data interchange — CSV and XLSX

**CSV and XLSX are the platform's data formats; PDF is for customer-facing documents only.** Import
and export both, everywhere finance data moves: rate cards · destination catalogue · accounts ·
commercial mapping · tariffs · DMR · billing reports · invoice breakout · reconciliation · customer
statements · rating verification · margin · P&L.

Conventions: UTF-8 · header row · UTC timestamps · `.` decimal separator · `YYYY-MM-DD` dates ·
`YYYY-MM-DD HH:MM:SS UTC` datetimes · one worksheet per dataset · **stable column order** ·
declared validation rules.

Column order is part of the contract, not a rendering detail: an export whose columns move between
releases breaks every saved import mapping and makes two exports of the same dataset undiffable.
New columns are appended; existing ones do not move.

**One shared library.** Today there are 48 export/import sites across 14 files and no shared
server-side helper — `buildXLSXBuffer` in `server/services/billing/reconciliation-export.ts` and
`client/src/lib/export-excel.ts` are two competing implementations, with more in `sippy.ts`,
`rate-matrix.ts` and `destination-workbook.ts`. Consolidating them is build-order step 4 because
two rules cannot be enforced piecemeal:

**1. Identity columns must survive a round trip.** Prefix is part of the billing identity
(`BILLING-POLICY.md` §5). Opened in Excel, a CSV turns `0044` into `44` — export, edit, re-import,
and the destination a rate belongs to has silently changed. Prefixes, account ids, tariff ids and
CDR ids are written as **text**, and importers must not coerce them.

**2. Exports carry stored precision, never display precision.** The same defect as §3.2: Sippy
renders `0.0098` for a rate that bills `0.00985`. Export a rate card at display precision, re-import
it, and every rate on it changes. Exports intended as data — as opposed to a rendered document —
carry the full stored value.

Both rules exist because the platform has already been bitten by the display-vs-stored distinction
in a different place this month. They are not hypothetical.

---

## 13. Open — not decided by this contract

- Whether `customer_reports.php` CSV export is reachable with the credentials the platform holds.
  The whole design rests on it; unverified.
- Destination normalisation between Sippy's `Country` column and the Destination Catalogue. Sippy
  reports `PAKISTAN`; the catalogue is the naming authority. Matching rule undefined.
- Retention of reconciliation runs. Certification runs are immutable and re-runs create new rows
  (`snapshot_verification_runs`, migration 070). Reconciliation should follow, but is unstated.
- Multi-currency. `currency` is in the identity key; behaviour when a period spans currencies is
  undefined.

---

## 15. AMENDMENT 2026-08-31 — reconciliation is a PLATFORM control, not an invoice check

Owner-set, on production evidence. This amends §9.1 (surfaces) and elevates the
scope of the whole document.

**The governing rule.** No financial report, dashboard, invoice, customer
statement, vendor statement or profit-and-loss figure may be treated as FINAL
unless reconciliation against the switch has passed for the entire billing
period.

### 15.1 Why it moved

Invoice C-2608-0009 billed $167.5063 of a $683.3934 week. Every internal check
passed — period closed, certified, snapshotted, DMR reporting zero
discrepancies — because each compares BitsAuto against BitsAuto. `internal-ptcl`
was 43% of that week and produced no discrepancy anywhere, because it produced
nothing at all.

**Certification must therefore run over EVERY SIPPY ACCOUNT, not over the
accounts someone selected for invoicing.** A customer missing from the platform
is invisible to any check that iterates the platform's own records — which is
every check that existed before this one. That is the requirement this amendment
exists to state.

### 15.2 BLOCKED versus WARNING — the distinction is load-bearing

A gate that darkens the whole platform on failure will be overridden, and an
overridden gate is not a gate. So the consequence differs by what the surface
*does*, not by how important it looks:

**BLOCKED — anything that leaves the building or asserts finality:**
invoice number · invoice PDF · customer statement · vendor statement · automatic
email · approval · forecast published as fact.

**WARNING, labelled provisional — anything an operator needs in order to FIX
the failure:** P&L · margin · revenue dashboards · AI alerts · operational
reports.

Blocking the diagnostic surfaces removes exactly the visibility required to
clear the failure, and turns a billing problem into an outage. Provisional
figures with an honest label are more useful than no figures.

### 15.3 Reconciliation does NOT wait for `rateCall`

Worth stating because the sequencing looks otherwise. The two measure different
things on different axes:

| Control | Question | Column |
|---|---|---|
| Reconciliation | did we BILL what the switch billed? | `actual_cost` vs Sippy charged |
| Rating verification | can we REPRODUCE the switch's arithmetic? | reproduced cost vs `actual_cost` |

Sippy's *Charged Amount* and the invoice's *Billed Amount* are the same basis —
both are the switch's own figure. The 60× rating defect lives entirely in the
reproduction, which reconciliation never reads.

**So the money control can be enforced immediately.** It does not depend on
`rateCall`, and `rateCall` does not depend on it.

### 15.3b The reference provider already exists — and is discarded

**Observed 2026-08-31, `sippy-dmr.service.ts`.** The DMR already fetches the
switch's own per-account figures every day via `getSippyPerAccountStats` —
name, duration, amount, calls, ASR, ACD, for clients *and* vendors. That is the
independent reference this contract has been waiting for.

It is then thrown away, in three lines that say so:

```js
// Platform side: for initial build, use billableCalls-weighted estimate
// (In future: pull from CDR aggregation or tariff snapshot reproduction)
const platDur = sipDur;   // start with same — drift is detected via amount
const platAmt = sipAmt;   // will diverge when tariff snapshot comparison is wired
```

The platform side is a placeholder copying the reference. That is the whole
mechanism behind "DMR reports zero discrepancies" — not a bug in the
comparison, but a comparison that was never finished, running in production for
months while reporting clean.

**Consequence for build order.** Account-level reconciliation needs NO new Sippy
integration. The fetch runs daily already; what is missing is a platform figure
to compare it against and the refusal to proceed when they differ. And
account-level alone would have caught **every dollar** of this week's $515.89 —
`internal-ptcl` absent entirely, `internal-eritrea` absent entirely, `asterisk`
short by $199.14.

Two tiers, therefore:

| Tier | Identity | Reference source | Catches |
|---|---|---|---|
| 1 · account | (customer, currency) | `getSippyPerAccountStats` — **already running** | missing customers, period totals |
| 2 · line | (customer, prefix, rate, currency) — contract §4 | Customer Summary report | rate and prefix-level drift |

Tier 1 first. It is nearly free and it is the tier that would have prevented
what happened.

**One hazard to close while wiring it.** When Sippy's stats are unavailable the
DMR falls back to the local CDR cache and continues (line ~203). That fallback
must NEVER feed the reference side: it substitutes our own data for the
switch's and would let the platform certify against itself while appearing to
have a reference. Unavailable means `REFERENCE_UNAVAILABLE` — an outcome the
comparison core already returns and which is explicitly not PASS.

### 15.3c Certification is per (account, period) — never one platform flag

Owner-set 2026-08-31. The certification state is keyed
`(iAccount, periodStart, periodEnd)`, not a single platform-wide boolean.

| Account | Period | Status |
|---|---|---|
| 315 | 2026-08-24 → 08-30 | PASS |
| 588 | 2026-08-24 → 08-30 | FAIL |
| 77  | 2026-08-24 → 08-30 | PASS |

So the platform reports **"22 of 25 accounts certified for the week"** rather
than `NOT CERTIFIED`. The first is actionable; the second sends someone hunting.

**This is also what keeps the gate from becoming an outage** — the same
reasoning as the BLOCKED/WARNING split in §15.2. A platform-wide flag would
block all twenty-five invoices because one account failed, twenty-two customers
would be billed late for a fault that had nothing to do with them, and the
pressure to override would arrive immediately. A gate that is routinely
overridden has stopped being a gate.

Per-account state also gives investigation and retry their natural grain: one
account is re-collected, re-certified and released while the rest of the week
proceeds untouched. And it makes certification *historically* readable — the
same account can be certified for one week and failed for the next, which a
single flag cannot express at all.

### 15.3d Every certification result is persisted as evidence

Owner-set 2026-08-31. A verdict that can only be reproduced by recomputing it is
not an audit trail. Six months from now, *"why was C-2608-0009 blocked?"* must
be answerable from a row, not from a re-run against data that has since changed.

`finance_certifications`, keyed as §15.3c: `i_account`, `period_start`,
`period_end`, `reference_revenue`, `platform_revenue`, `difference`, `status`,
`reason`, `certified_at`, `algorithm_version`.

**`algorithm_version` is the field most likely to be dropped as ceremony, and it
is the one that makes the rest trustworthy.** A verdict is only meaningful
alongside the rules that produced it. When the tolerance changes, or tier 2
identity replaces tier 1, or a defect in the comparison is fixed, every historic
row silently acquires a new meaning unless it records which version judged it.
Without the version, a re-run that disagrees with the stored verdict is
unexplainable — you cannot tell whether the data changed or the rules did.

Two consequences that follow from treating these rows as evidence:

- They are **written for every outcome**, not only failures. A PASS is the
  evidence that the invoice was allowed to leave, and it is the row someone will
  want when a customer disputes a bill that was correctly certified.
- They are **append-only**. A re-certification writes a new row; it never
  overwrites the earlier verdict. The history of a period's certification is
  itself financial evidence — a period that failed twice and then passed is not
  the same thing as a period that passed.

This is the §9b **Audited** disposition applied to the engine's own output: the
verdict is retained because it may become evidence, not because something
computes with it.

### 15.3e Call counts are NOT comparable — only money is

**Observed 2026-08-31.** Sippy's Customer Summary for 2026-08-24 → 08-30 reports
asterisk at **564,861 calls / $366.6442**. The repository holds **20,454 calls**
for four of those days. The gap is not the missing days — four sevenths of the
week would be roughly 320,000.

The two sides count different populations, deliberately:

| | population |
|---|---|
| Sippy summary | EVERY call — answered, unanswered, and 22,221 `external_translation_error` attempts at $0 |
| Repository | `type: non_zero` — billable calls only (BILLING-POLICY §7.4) |

So `callsDelta` on a correct period will read around **−544,000** and mean
nothing whatever. Anyone reading that as a failure will "fix" a system that is
working.

**Money remains comparable**, because the calls the repository omits are charged
zero. That is why contract §5 gates on money and treats calls and minutes as
informational — a decision made before this evidence existed, and this is the
evidence for it.

**The one caveat, and it is real:** a zero-duration call can still carry a
CONNECT FEE, which `non_zero` would never fetch. Such a call charges money the
repository has no record of. It would show up exactly where it should — as a
money difference the gate refuses — so the control catches it; but the cause
would be an ingestion filter, not a rating error, and an investigator should
know to look there. BILLING-POLICY §7.4 records the same caveat from the
capture side.

**Consequence for the UI:** never place the reference's call count beside the
repository's as though they measure the same thing. Either label the populations
or omit the column.

### 15.4 Rollout still applies

§11's three phases are not waived by this amendment. Report-only first, so the
gate's own failure modes surface against real periods before it can refuse a
legitimate invoice; then soft; then hard. A control that has never been observed
being right is not yet a control.

---

## 14. Provenance

Owner decisions, 2026-08-26, in sequence: reconciliation as a mandatory pre-invoice gate ·
separate module from Profit/Loss · adapter interface for the reference · identity is
`(customer, prefix, rate, currency)` · calls informational, not gating · absolute $0.01, no
percentages · UTC half-open periods · override requires director approval, a reason, and a stamp on
the document · three outcomes · additive only, nothing existing changes · three-phase rollout.

Evidence gathered in support: the Sippy Customer Summary above · the 1% population gap · the
Bangladesh attempts-vs-billed-seconds proof · the 0.00985 rate precision proof · the measured
`float4` summation error.

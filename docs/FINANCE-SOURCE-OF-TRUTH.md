# Finance — Source of Truth

**Status:** audit findings + governance rule. Audited 2026-08-28 by code trace.
**Companion to:** `BILLING-POLICY.md`, `BILLING-RECONCILIATION-CONTRACT.md`, `BILLING-VALIDATION-RUNBOOK.md`.

This document exists because the platform has **more than one** financial
implementation. That is more dangerous than having none: independent pipelines
can silently disagree, and nothing currently reconciles them.

Evidence is labelled **Observed** (read from the code or measured in
production) or **Inference** (consistent with the evidence, not established).

---

## 1. What exists today

**Observed.** Three separate margin/P&L implementations, none sharing a source.

| Surface | Data source | Consumers |
|---|---|---|
| `/api/margin/*` → `services/sippy/sippy-margin.service.ts` | `financial_snapshot` (materialised from DMR rows) | `margin-intelligence.tsx`, `finance-cockpit.tsx` |
| `/api/analytics/pnl` → in-memory `pnlCache` | Sippy `exportVendorsCDRsMera` — per-call **vendor** CDRs | `analytics.tsx` |
| `/api/analytics/margin`, `/api/analytics/revenue` | computed inline in `routes.ts` | `analytics.tsx`, `reports.tsx`, `dashboard.tsx` |
| `/api/sippy/pnl` | `pnlCache` | **none — dead endpoint** |

`revenue-heatmap.tsx` (673 lines) and `margin-intelligence.tsx` (448 lines) are
substantial existing UI. The remaining work is **consolidation, not
construction**.

---

## 2. Finding 1 — vendor CDRs are captured and thrown away

**Observed.** `exportVendorsCDRsMera` fetches per-call vendor CDRs with cost
every 10 minutes. The result is written to a `Map` in process memory
(`routes.ts` ~6665), evicted at 48 hours, and **never persisted** — there is no
insert anywhere in that function.

This process is recycled routinely by autoscale, so most of what is fetched
never survives to be read.

**Why it matters more than it looks:** the question "where would vendor cost
come from for a repository-based P&L" is already answered. The fetcher exists
and works. Repository-backed P&L does not need a vendor ingestion subsystem
designed from scratch — it needs an existing feed written to a table.

This is the *captured but never delivered* defect class (see
[[audit-before-building]]): capability that runs, produces correct data, and
discards it before anything can use it.

---

## 3. Finding 2 — `/api/analytics/pnl` reports zero revenue and zero profit

**Observed.** There is exactly one writer to `pnlCache`, and it sets:

```js
{ …, cost: Number(row.cost) || 0, revenue: 0, profit: 0, margin: 0 }
```

The endpoint then sums `r.revenue` and `r.profit` across those rows. Both are
structurally zero. **Cost is the only real figure that page displays.** Revenue
and profit are sums of literal zeros — not calculations that happened to come
out empty.

**Inference (not verified):** the comment above the fetcher still describes a
CSV from `profit_loss_report.php` while the code uses XML-RPC. Revenue was
probably lost when the source was switched, and nobody noticed because **zero is
a plausible-looking number**. A financial figure that is wrong in a way that
looks like a real answer is the hardest kind to catch, which is why it survived.

Treat as a live production defect, not future work.

---

## 4. Finding 3 — margin inherits the DMR's structural parity

**Observed.** `sellAmount`/`buyAmount` → `financial_snapshot` → materialisation
→ DMR rows. And per the conformance probe, every DMR row path sets the platform
side equal to the Sippy side, so drift is structurally zero and `missing_cdr`
cannot fire.

Margin Intelligence is therefore a faithful **restatement of what Sippy
believes**, not an independent computation. That is useful operationally and it
is not an error — but its figures cannot disagree with the switch, because
nothing in the chain is capable of disagreeing.

Consequence: moving P&L onto the repository is a change in **what the numbers
mean**, not merely where they are read from.

---

## 5. Target architecture

The producer of a financial figure must not also be its validator.

```
                      Sippy
          Customer CDR      Vendor CDR
                │               │
                └───────┬───────┘
                        ▼
              Raw CDR Repository            ← canonical evidence
                        │
            ┌───────────┼────────────┐
            ▼           ▼            ▼
         Rating   Reconciliation    DMR      ← independent checks
            │           │
            └─────┬─────┘
                  ▼
          Financial Snapshot
                  ▼
             Profit & Loss
                  ▼
          Dashboards / Reports
```

DMR becomes a **validation layer**, not the producer of the financial data it is
meant to validate.

---

## 6. Financial Source of Truth Matrix

Owner-set, 2026-08-28. **Before adding any financial figure to any surface, find
it in this table.** If it is not here, it does not get computed a fourth way —
the table is extended first.

| Metric | Source | Status |
|---|---|---|
| Revenue | Raw CDR Repository | Canonical |
| Vendor cost | Raw CDR Repository | Canonical (**blocked on §2**) |
| Customer cost | Raw CDR Repository | Canonical |
| Invoice amount | Repository → snapshot → `actual_cost` | Canonical |
| Margin | Financial Snapshot | Derived |
| DMR variance | Reconciliation | Validation |
| Rating verification | `rateCall` | Certification |

**The rule this table exists to enforce:** no new financial pipeline. A figure
computed in a route handler because it was quicker than reading the canonical
source is how three implementations became four.

---

## 7. Repository Quality — the permanent answer

Owner-set. Rather than answering "does the repository contain enough to support
downstream finance?" with a one-off query at wiring time, it is measured
continuously and reported alongside completeness:

```
Repository Quality
  Vendor identified          n / N   (%)
  Connection identified      n / N   (%)
  Destination resolved       n / N   (%)
  Account mapped             n / N   (%)
  Tariff resolved            n / N   (%)
  Duplicate CDR ids          n
  Missing cost               n
  Missing duration           n
  Missing ANI / DNIS         n
  Unknown country            n
```

**Why vendor coverage specifically gates §5:** `raw_sippy_cdrs` has `vendor` and
`i_connection` columns, but a comment in this codebase records that
`getAccountCDRs` *often omits* both. If coverage is near 100%, repository-backed
P&L is straightforward. If it is 20–30%, vendor-side ingestion (§2) is a hard
prerequisite. **Unmeasured as of 2026-08-28** — decide with the number, not the
assumption.

---

## 8. Priority order

**REVISED BY THE OWNER 2026-08-31 — the Reconciliation Gate moves to FIRST.**
This reverses the 08-28 ordering below, and it was reversed by production
evidence, which is the only thing permitted to reopen a frozen decision.

**The evidence.** Sippy's Customer Summary for 2026-08-24 → 2026-08-30 — the
first independent reference this platform has ever been given — against what
was actually invoiced:

| Customer | Sippy charged | Invoiced | Gap |
|---|---:|---:|---:|
| asterisk | 366.6442 | 167.5063 | −199.14 |
| internal-ptcl | 295.9650 | — | −295.97 |
| internal-eritrea | 20.7842 | — | −20.78 |
| PUSHTOTALK | 0.0000 | — | 0 |
| Route-Inspector | 0.0000 | — | 0 |
| **Total** | **683.3934** | **167.5063** | **−515.89** |

**75% of the week was never invoiced, and every internal check passed** —
period closed, certified, snapshotted, DMR reporting zero discrepancies. They
all passed because each compares BitsAuto against BitsAuto, and $295.97 of
internal-ptcl produced no discrepancy anywhere for the simple reason that it
produced nothing at all. **An absence cannot create a discrepancy in a
comparison that only walks what it has.**

Nothing else in this list would have caught it. The coverage gate (§2b of the
billing chain) would have refused the incomplete week, but not the missing
customer. Owner's instruction, verbatim: *"before generating invoice we will
compare BitsAuto record with Sippy summary — without comparison no invoice
would be generated."*

**Revised order:**

1. **Billing Reconciliation Gate** — MANDATORY and BLOCKING before any invoice
   leaves Draft. `server/billing-reconciliation.ts` (the comparison core) is
   built and tested against the week above; the reference provider and the
   chain wiring remain.
2. `rateCall` parity
3. Repository Quality metrics (§7)
4. Persist vendor CDRs (§2)
5. Repository-backed P&L
6. Consolidation

**Superseded 2026-08-28 order, kept for the record:**

1. **`rateCall` parity** — remove the 60× divergence; certification cannot pass
   while it stands
2. **Repository Quality metrics** (§7) — read-only additions to the completeness
   service: vendor coverage, freshness, duplicate rate, import latency
3. **Persist vendor CDRs** (§2) — move the existing feed from memory to the
   repository, scoped by what (2) measured
4. **Repository-backed P&L** — rewire the existing module to read from the
   repository
5. **Consolidation** — retire `/api/sippy/pnl`, fix or retire the zero-valued
   analytics P&L, collapse the three margin computations onto one source
6. **Billing Reconciliation Gate** — PASS / FAIL / REFERENCE UNAVAILABLE,
   $0.01 absolute tolerance, director override, before invoice release

Measure before building: (2) precedes (3) deliberately, and (4) must not start
before (2) has produced numbers.

**Consequence of the Gate sitting at (6), recorded so it is a decision and not
an oversight:** steps (4) and (5) put repository-backed P&L and consolidated
dashboards in front of management *before* anything can prove BitsAuto agrees
with Sippy. Those figures will be internally consistent and externally
unverified. Until (6) exists, every completeness verdict reads `no_reference` —
the platform compared against itself — and no financial output may be described
as *certified*, however green the dashboards look.

---

## 9. The Observability Rule

Owner-set, 2026-08-28. A companion to §6: the Source of Truth rule governs where
a number comes from; this one governs whether anyone can tell when it is wrong.

> **A financial process must never communicate health through silence or
> plausible defaults. Every automated process must make success, failure and
> uncertainty explicitly observable.**

This rule was not written from theory. Five independent defects found in a
single week shared one shape — none of them crashed, and every one produced a
believable result:

| Area | Looked healthy | Reality |
|---|---|---|
| CDR ingestion | `done, errors 0` | repository stored nothing for four days |
| Error reporting | `getCustomerCDRs HTTP 401` | the real `getAccountCDRs` timeout was overwritten |
| Scheduler | no log output | the collector had never executed |
| Analytics P&L | `revenue = 0` | zeros were structural, never measured |
| DMR | no drift detected | platform and reference were the same data |

A crash is easy to find. A plausible answer is not — which is precisely why
these survived, some of them for months.

**In practice:**

- A collector does not go quiet; it reports its state and what it intends to do
  next (`observe-only · not due: every day since … collected`).
- A reconciliation states whether its reference is independent, and refuses to
  imply agreement when it compared a thing against itself (`no_reference`).
- A report does not display `$0.00` unless zero was measured.
- A cap that truncates says so; it never lets `created: 1000` read as a count.

**Every figure carries its epistemic status**, not just its value:

`measured` · `derived` · `estimated` · `reference unavailable` · `not yet collected`

That vocabulary already exists in this codebase — `policy-conformance.ts`
defines `Provenance = 'measured' | 'derived' | 'declared'`, and the completeness
verdict already emits `no_reference`. **Reuse it. Do not invent a second
vocabulary**, for the same reason §6 forbids a fourth pipeline.

---

## 9b. The Disposition Rule

Owner-set 2026-08-31, and earned: **three separate cases were found in three
days where valuable data was fetched from Sippy and then discarded before
anything could use it.**

| What was fetched | What happened to it | Cost |
|---|---|---|
| Vendor CDRs, every 10 min | into a `Map`, evicted at 48h, never persisted | P&L has no vendor side |
| Per-account reference, daily | copied into BOTH DMR columns | "zero discrepancies" for months |
| Account ids, in every portal row | destroyed by a tag-strip one line before the name was kept | reconciliation could only match on names |

None was a bug in the ordinary sense. Each was working code that obtained
correct data and dropped it, and in every case the loss was invisible because
what remained still looked like an answer.

> **No identifier or financial reference retrieved from Sippy may be discarded
> before it reaches the repository or an auditable intermediate model.**

Every parsed field carries an explicit disposition:

- **Persisted** — stored for later use
- **Consumed** — used immediately in a calculation, and the result is stored
- **Audited** — retained as evidence even though nothing computes with it
- **Discarded** — deliberately, *with the reason written down*

**Audited is not a synonym for Consumed**, and the distinction is why the
account id was lost. A field can be genuinely unused today and still be the
thing a future control needs to identify a party, reproduce a figure, or prove
what the switch said at the time. `scrapeAsrAcdRows` consumed the name and
discarded everything else, which was correct for the DMR and catastrophic for a
reconciliation that did not yet exist. Evidence is retained because it is
evidence, not because a caller has been written for it.

A field that is none of the four is a defect, whether or not anything has
noticed yet. The review question is not "does this work?" but **"where does this
value end up, and if nowhere, why?"**

The corollary, which is what makes it enforceable: a scraper or parser must not
narrow its output to what today's caller happens to need. `scrapeAsrAcdRows`
returned a name because the DMR only wanted a name — and that decision, made
long before reconciliation existed, is what made reconciliation impossible to
key correctly.

---

## 10. Provenance

Audit performed 2026-08-28 by direct code trace: service exports, route
registrations, cache writers and readers, and the consumer map from
`client/src/pages`. No production data was queried; §7's coverage figures are
explicitly recorded as unmeasured.

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

Owner-set, 2026-08-28:

1. **Persist vendor CDRs** — small change, unlocks repository-backed P&L
2. **`rateCall` parity** — certification cannot pass while rating is 60× out
3. **Billing Reconciliation Gate** — nothing is "certified" until this exists
4. **Repository-backed P&L** — gated on (1) and the §7 coverage numbers
5. **Consolidation** — retire `/api/sippy/pnl`, fix or retire the zero-valued
   analytics P&L, collapse the three margin computations onto one source

(1) and (2) are independent and can proceed in parallel. (4) must not start
before §7 has been measured.

---

## 9. Provenance

Audit performed 2026-08-28 by direct code trace: service exports, route
registrations, cache writers and readers, and the consumer map from
`client/src/pages`. No production data was queried; §7's coverage figures are
explicitly recorded as unmeasured.

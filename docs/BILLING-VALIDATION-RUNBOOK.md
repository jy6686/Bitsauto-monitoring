# Billing Validation Runbook

**Status: the operating document of the validation phase, opened 2026-08-27.**

The architecture is FROZEN (owner declaration, 2026-08-27). No new capability is added until the
five reconciliations below hold for one complete billing period on production data. The milestone
is not more code; it is the demonstration:

```
1.  Sippy CDRs          =  Repository
2.  Repository          =  Certification
3.  Certification       =  DMR            (operational agreement only)
4.  DMR                 =  Sippy Customer Summary
5.  Approved Snapshot   =  Invoice
```

Every phase states: what to run, what evidence settles it, what it is EXPECTED to show today, and
what blocks it. An expected divergence is written down before the run, per the working agreement —
a measurement that cannot return "no" is not evidence.

**Prerequisite for everything: deploy.** Not one commit of the strict-fetch arc, the diagnostics,
or the probes is on the running instance. First act after publish: `GET /api/build` and compare its
database fingerprint against the psql prompt you will use — six investigations have been lost to
the workspace/production database split.

---

## Phase A — Sippy = Repository (completeness)

**Run:** for the target account and a closed period (half-open, UTC):

```
GET /api/finance/cdr-repository/completeness
      ?iAccount=<N>&from=YYYY-MM-DD&to=YYYY-MM-DD
      &refMinutes=<billed minutes>&refCalls=<calls>&refCost=<charged amount>
```

`ref*` come from Sippy's own Customer Summary for the SAME half-open window (its end bound is
exclusive, like ours). Use the CSV export, not the rendered page — the page rounds rates to 4dp.
`refCost` is **Charged Amount**, never the vendor-side **Cost** column. `refCalls` is attempts and
is informational — it does not gate.

**Evidence:** `verdict.status = complete`, with `environment.database` matching `/api/build` and
`environment.clock.utc` noted. If `incomplete`: `verdict.lossStage` names the first lossy
transition and `lossyDimensions` names what was lost — that transition, not the total, is the
finding. `identityCollision` tests the repeated-call-id hypothesis in the same response.

**Expected today:** unknown — the production repository has never been measured. If the repository
is EMPTY the verdict says so explicitly and distinguishes it from data loss.

**Blocked by:** deployment; the operator reading three numbers off the Customer Summary.

**If A fails, run one seed** (`POST /api/rating-snapshots/seed-from-portal` or the invoice
pipeline) and re-measure. The seeder now fails LOUDLY on a fetch fault — `status: 'error'`, never
"Complete" — so a re-run that still comes up short is a real finding, not a silent one.

---

## Phase B — Repository = Certification

**Run:** the same completeness response's `repository → verified` transition, plus the
per-destination matrix:

```
GET /api/finance/certification/destinations?iTariff=<T>&periodStart=&periodEnd=
```

**Evidence:** minutes and calls retained ≈ 100% across `repository → verified`; the matrix agrees
with the repository per (prefix, rate) on minutes and billed seconds.

**Expected today, stated before the run:** minutes MATCH; **amounts diverge ~60×** on every tariff
whose intervals are not 60/60. That is the pinned rating-units defect (`policy-conformance.ts`
probe: *diverges, 60.0x*), and its fix — wiring `rateCall` into `reproduceCost` — is authorised
work waiting on the owner's word, deliberately not folded into this validation. When it is wired,
the probe flips to *conforms*, its test fails loudly, and Phase B is re-run — the flip plus a clean
re-run IS the acceptance of the fix.

**Known instrument caveat:** the matrix covers only successfully-rated calls
(`rating_verifications.prefix` is NULL for unrated rows), so it cannot see a mapping failure on
calls that never rated. The completeness transition covers that side.

---

## Phase C — DMR is operational only

**Evidence, already in hand (code, not runtime):** the DMR cannot rerate, certify, or approve —
its platform side is set equal to its Sippy side in every row path (`sippy-dmr.service.ts:277`),
so it is a parity report. The conformance register records this as a measured-adjacent declared
divergence and the reclassification is frozen in the reconciliation contract §2.1.

**Runtime check:** generate one day's DMR post-deploy; confirm the email renders and its Sippy-side
totals agree with the P&L for the day. That validates the OPERATIONAL function, which is the only
function it now has.

**RESOLVED (owner, 2026-08-27) — transitional technical debt, documented, not removed:**
`/api/invoices/generate` carries a "DMR governance gate" (`hasDMRVerifiedForPeriod`) requiring
every period day to have a verified DMR row — but every DMR row is `verified` by construction
(`exact_match`, platform set equal to Sippy), so the gate tests row EXISTENCE while presenting as
verification. It stays, understood as an existence check and nothing more, until Billing
Reconciliation replaces it as the financial gate — at which point it retires. DMR must never
become a financial approval mechanism.

---

## Phase D — DMR = Sippy Customer Summary (the financial gate, run by hand)

The Billing Reconciliation module is specified (BILLING-RECONCILIATION-CONTRACT.md) and NOT built —
and its build is itself gated behind this validation phase. Phase D therefore runs as the
contract's Phase-1 backtest, manually:

**Run:** export the Customer Summary CSV for the customer and period. Compare against the DMR /
invoice breakout for the same half-open window, row-matched on **(prefix, rate)** — rate at full
stored precision, never the displayed 4dp.

**Evidence:** per row — billed minutes exact, charged amount within **$0.01 absolute** (never a
percentage); the period total against Sippy's own printed total, same band. Rows on one side only
are findings, never netted.

**Expected today:** FAIL on population (Phase A's gap, if unresolved) and nothing else new — which
is the point: D inherits A, and running it before A passes attributes every difference to the
wrong cause. **Run D only after A holds.**

**Also settles two open contract assumptions:** whether the Customer Summary CSV export is
reachable with the platform's credentials (§3.2), and whether the report's call-records filter can
supply a connected-calls count (§5).

---

## Phase E — Approved Snapshot = Invoice

**Run:** for a certified, closed period: generate through the chain (any generation surface — all
delegate to it now), then:

```sql
SELECT round(sum(actual_cost::numeric), 4)  AS snapshot_actual,
       count(*)                             AS snapshot_rows
  FROM invoice_cdr_snapshots
 WHERE i_tariff = '<T>'
   AND left(cdr_start_time, 10) >= '<start>' AND left(cdr_start_time, 10) <= '<end>';
```

**Evidence:** the chain's `totalsCheck.ok = true`; the invoice's `total_actual` equals the
snapshot sum; the PDF's total equals both. Then regenerate the document and confirm it is
IDENTICAL — reproducibility is the property the snapshot architecture buys, so it is the property
this phase tests.

**Expected today:** holds by construction for the chain path — every generation surface now reads
snapshots only. A failure here is a real defect in the generator, not in ingestion.

---

## The permanent engineering rule (owner, final form)

> **Every validation must identify both independent data sources being compared. If either side is
> derived from the other, it is not a validation.**

At code review, every reconciliation answers five questions:

1. What is Source A?
2. What is Source B?
3. Are they independently produced?
4. Can they legitimately disagree?
5. If not, why is this implemented as a validation?

The four instances this rule would have prevented are listed in BILLING-POLICY.md §7.3.

---

## Deployment discipline

**Nothing in this runbook is marked complete from workspace evidence.** Every phase:

```
1. Deploy   2. Execute against production   3. Capture evidence
4. Record PASS / FAIL   5. Only then move to the next phase
```

A phase without captured production evidence is not run, whatever the workspace showed.

## Requirements freeze — how new findings are triaged

With the architecture frozen, a newly discovered issue never prompts an architectural change.
It is classified into exactly one bucket:

| Bucket | Meaning | Action |
|---|---|---|
| **Validation defect** | The architecture is correct; implementation or data does not conform to it | Fix within the frozen design, re-run the phase |
| **Implementation defect** | A code bug inside the frozen architecture | Fix, with the phase's evidence as the regression test |
| **Enhancement** | Anything else | **Defer until the runbook passes** |

The DMR-gate finding above is the worked example: classified transitional debt, not a redesign.

## Order and dependencies

```
Deploy → fingerprint check → A → B (amounts after rateCall) → C runtime → D → E
```

A before D (D inherits A's population). B's amounts wait on the rateCall wiring, which is a
one-line change plus the deliberate deletion of its tripwire test, on the owner's word. C's
decision (the DMR gate) can be taken any time. E last, on a period the earlier phases passed.

When all five hold for one complete period, the pipeline is operationally sound and financially
auditable — and the build queue (Billing Reconciliation module, period lifecycle, invoice lock)
reopens on top of validated ground.

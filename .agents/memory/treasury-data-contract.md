---
name: Treasury Data Contract
description: Full 8-section KPI/lineage/state-machine contract for Treasury modules T1–T6
---

## The Rule

Every Treasury KPI has one source, one calculation, one owner. Full contract at
`.local/governance/TREASURY-DATA-CONTRACT.md`. All T1–T6 builds must conform.

**Why:** Same governance discipline that kept Finance coherent — contract before implementation.

## Key Invariants

- `settlements.due_date` = `invoice_job.approved_at::date + due_days` — calculated once, stored, never recalculated
- `settlements.due_days` snapshotted from `client_payment_terms` at creation
- Settlement carries 4 Finance lineage FKs at creation: `invoice_batch_id`, `invoice_job_id`, `snapshot_run_id`, `recon_run_id`
- `cash_ledger_entries` is append-only — reversals are new rows, never edits
- Treasury never writes to Finance tables

## Settlement State Machine (LOCKED)

```
PENDING → SCHEDULED → PARTIALLY_PAID → PAID → CLOSED
Exceptional: PENDING→DISPUTED, SCHEDULED→CANCELLED, any→WRITTEN_OFF
```

## Payment State Machine (LOCKED)

```
CREATED → POSTED → RECONCILED
Exceptional: POSTED→REVERSED, RECONCILED→REVERSED (new ledger entry)
```

## T1 KPI Sources

| KPI | Table | Calc |
|-----|-------|------|
| Outstanding Receivables | settlements + payments | SUM(amount - paid) WHERE not CLOSED/WRITTEN_OFF |
| Due Today | settlements | due_date = CURRENT_DATE AND balance > 0 |
| Due This Week | settlements | CURRENT_DATE ≤ due_date ≤ +7 AND balance > 0 |
| Overdue | settlements | due_date < CURRENT_DATE AND balance > 0 |
| Cash Position | cash_ledger_entries | Latest running_balance |

## Certification Gates

T1: every KPI traces to this contract; no Finance metric recalculated; lineage FKs all populated; due_days snapshotted; Sippy balance labelled reference-only.
T2: full settlement state machine + exceptional paths; due_date immutable post-creation.
T3: payment lifecycle; all 5 scenarios (full/partial/over/short/write-off); reversal = new record.

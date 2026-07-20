---
name: Treasury Data Contract
description: KPI definitions, source of truth, and prohibited patterns for all Treasury modules T1–T6
---

## The Rule

Every Treasury KPI has one source, one calculation, one owner. The full contract is in `.local/governance/TREASURY-DATA-CONTRACT.md`.

**Why:** Same governance discipline that made Finance coherent — agree on the data contract before building dashboards.

## Key Invariants

- `settlements.due_date` = `invoice_job.approved_at::date + due_days` — calculated once at settlement creation, never recalculated
- `settlements.due_days` snapshotted from `client_payment_terms` at creation — client terms may change later
- `cash_ledger_entries` is append-only — reversals are new rows, never edits
- Treasury never writes to Finance tables (`invoice_batches`, `invoice_jobs`, `financial_snapshot`, etc.)
- `client_identity_map.id` is always the identity key — never use raw `client_name` strings

## T1 KPI Sources

| KPI | Table | Calc |
|-----|-------|------|
| Outstanding Receivables | settlements | SUM(settlement_amount - paid_amount) WHERE not closed/written-off |
| Due Today | settlements | due_date = CURRENT_DATE AND balance > 0 |
| Due This Week | settlements | CURRENT_DATE ≤ due_date ≤ +7 AND balance > 0 |
| Overdue | settlements | due_date < CURRENT_DATE AND balance > 0 |
| Cash Position | cash_ledger_entries | Latest running_balance |
| Sippy Balance | Sippy API | Display only — not authoritative |

## Settlement Lifecycle

AWAITING_PAYMENT → PAID → CLOSED (full payment)
AWAITING_PAYMENT → DISPUTED (frozen from aging)
AWAITING_PAYMENT → WRITTEN_OFF (new ledger entry)

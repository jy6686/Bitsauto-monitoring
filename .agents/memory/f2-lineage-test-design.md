---
name: F2 lineage integration test design
description: How to write a robust end-to-end lineage test for the rolling-snapshot finance pipeline
---

## The Rule

Integration tests for the finance pipeline must be **self-contained and rolling-snapshot aware**.

**Why:** `financial_snapshot` is a rolling table — background F1 jobs overwrite it continuously. Any test that assumes a specific `snapshot_run_id` still has data in `financial_snapshot` will fail as soon as a new F1 run fires. Similarly, `reconciliation_runs` for old `snapshot_run_id` values cannot be validated via `EXISTS (SELECT 1 FROM financial_snapshot ...)` since that data is gone.

## How to Apply

1. **Resolve current snapshot at test start**: `SELECT snapshot_run_id FROM financial_snapshot WHERE row_type='client' ORDER BY snapshot_run_id DESC LIMIT 1`
2. **Run reconciliation if none exists for that snapshot**: call `runReconciliation(actor, currentSnapId)` — idempotent if already done
3. **Update batch FK pointers if needed**: use `UPDATE invoice_batches SET recon_run_id=N, snapshot_run_id=M WHERE id=(subquery)` — NOT `UPDATE ... ORDER BY LIMIT` (PostgreSQL rejects that syntax)
4. **Use batch metadata as audit evidence**: `batch.clients_found` and `batch.estimated_revenue` record what was in the snapshot at generation time — they are the canonical audit evidence, not a re-join to `financial_snapshot`
5. **4-table lineage JOIN**: `invoice_jobs → invoice_batches → reconciliation_runs → materialization_runs` — do NOT join `financial_snapshot` from historical mat_run_id (data may be overwritten)

## Canonical 4-table JOIN

```sql
SELECT ...
FROM invoice_jobs ij
JOIN invoice_batches      ib ON ib.id = ij.batch_id
JOIN reconciliation_runs  rr ON rr.id = ib.recon_run_id
JOIN materialization_runs mr ON mr.id = ib.snapshot_run_id
WHERE ij.id = $jobId
```

This JOIN is always resolvable because:
- `materialization_runs` rows are never deleted
- `reconciliation_runs` rows are never deleted
- `invoice_batches.recon_run_id` and `snapshot_run_id` are FKs to those stable tables

## Result (2026-07-20)

Script `_f2_lineage_final.ts` — 25/25 assertions passed across 5 steps (F1 snapshot, F3 recon, F2 batch FKs, job lifecycle PENDING→REVIEW→APPROVED→SENT, 4-table JOIN).

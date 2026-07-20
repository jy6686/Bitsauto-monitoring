---
name: F1 snapshot overwrite semantics
description: financial_snapshot table stores only the latest materialization run's data; snapshot_run_id in reconciliation_runs can become stale.
---

# F1 Snapshot Overwrite Semantics

## The Rule
`financial_snapshot` is a **rolling snapshot** — each materialization run deletes the old rows and inserts fresh ones under a new `snapshot_run_id`. Only **one snapshot_run_id** has live data at any moment (the most recent materialization run).

## Why This Matters
`reconciliation_runs.snapshot_run_id` points to whatever was the latest materialization run **at the time the recon was triggered**. As newer F1 runs execute, the old `snapshot_run_id` becomes empty. Any service that reads `financial_snapshot` by joining through `reconciliation_runs` must verify the `snapshot_run_id` still has rows.

## How to Apply
When querying `financial_snapshot` via a reconciliation_run pointer, always add an `EXISTS` subquery or a direct count check:

```sql
SELECT rr.id, rr.snapshot_run_id
FROM reconciliation_runs rr
WHERE rr.status = 'success'
  AND EXISTS (
    SELECT 1 FROM financial_snapshot fs
    WHERE fs.snapshot_run_id = rr.snapshot_run_id
    AND fs.row_type = 'client'
  )
ORDER BY rr.id DESC LIMIT 1
```

Fallback: if no certified recon run has live snapshot data, find the latest `snapshot_run_id` directly from `financial_snapshot WHERE row_type='client' AND sell_amount > 0 ORDER BY snapshot_run_id DESC LIMIT 1`.

This is implemented in `server/services/finance/invoice-batch.service.ts` → `getLatestReconRun()`.

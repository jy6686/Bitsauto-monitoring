---
name: F2 duplicate batch handling
description: Policy and implementation for blocking duplicate invoice batches for the same billing period, including cancel-and-rerun mechanics.
---

# F2 Duplicate Batch Handling

## The Rule
Block `generateInvoiceBatch()` if an active batch (status: `active`, `generating`, `closed`) with `clients_found > 0` already covers the same `period_start`/`period_end`.

Empty batches (`clients_found = 0`) are excluded from the block — they result from misconfiguration (e.g. snapshot-pointer bug before fix) and shouldn't permanently lock a period.

## Cancel-and-Rerun Mechanics
When re-running after a cancel, the new batch must cancel stale `PENDING/GENERATED/REVIEW` jobs from cancelled batches for the same billing period BEFORE inserting new jobs. This is required because `invoice_jobs` has a partial unique index: `UNIQUE (client_name, billing_period) WHERE status <> 'CANCELLED'`. Without cancelling stale jobs first, re-insertion fails with a unique constraint violation.

## FK Safety Rule
When inserting into `invoice_batches`, use `|| 'NULL'` (falsy check) not `?? 'NULL'` (nullish check) for FK columns (`snapshot_run_id`, `recon_run_id`). The fallback branch of `getLatestReconRun()` returns `reconRunId: null`, and JavaScript `null || 'NULL'` = `'NULL'`, but `0 || 'NULL'` = `'NULL'` too — so falsy is the safe operator here.

**Why:** `?? 'NULL'` passes `0` through unchanged since 0 is not null/undefined, causing a FK violation when the value `0` doesn't exist in the referenced table.

## How to Apply
In `findActiveBatchForPeriod()`: filter with `AND ib.clients_found > 0` to ignore empty batches.

In `generateInvoiceBatch()`: run the stale-job cancellation UPDATE before the INSERT loop:
```sql
UPDATE invoice_jobs SET status = 'CANCELLED'
WHERE billing_period = '${billingPeriod}'
  AND batch_id <> ${batchId}
  AND status IN ('PENDING','GENERATED','REVIEW')
  AND batch_id IN (
    SELECT id FROM invoice_batches
    WHERE period_start = '${period.start}' AND period_end = '${period.end}'
      AND status IN ('cancelled','superseded')
  )
```

Use `ON CONFLICT DO NOTHING` on the INSERT as a safety net (the stale-job cancel above should make it unnecessary, but belt-and-suspenders).

## Certified Paths (2026-07-20)
- Path A: Preview returns `blocked=true` + `existingBatch` info ✅
- Path B: Generate returns `status=failed` + `conflictBatch` ✅
- Path C: Empty batch (`clients_found=0`) does not block ✅
- Path D: Re-run after cancel: 5 stale jobs auto-cancelled, 5 new jobs created ✅
- Path E: Second immediate re-run blocked by newly created batch ✅

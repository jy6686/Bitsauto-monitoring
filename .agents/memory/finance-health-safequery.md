---
name: Finance Health safeQuery column mismatch
description: materialization_runs.rows_written vs rows_processed — wrong column causes all Finance Health warnings to fire incorrectly
---

## Rule
The `materialization_runs` table uses `rows_written` (not `rows_processed`). Any query that selects `rows_processed` will throw a "column does not exist" error.

## What went wrong
The Finance Health endpoint (`GET /api/finance/health`) ran a safeQuery selecting `rows_processed` from `materialization_runs`. PostgreSQL threw a column-not-found error. `safeQuery` caught it silently and returned `{ rows: [], missing: true }`. With `runsR.missing = true`, the health endpoint reported:
- schedulerStatus = 'never'
- Every warning fired: "Never Built", "Scheduler Not Configured", all Finance Health metrics showed 0%

This single column typo made the entire Finance Health dashboard appear as if F1 had never been built.

**Why:** The correct column name is `rows_written` (matches the Drizzle schema and all INSERT/UPDATE statements in sippy-snapshot.service.ts).

## How to apply
- Any query touching `materialization_runs` must use `rows_written`, not `rows_processed`
- The frontend (`finance-health.tsx`) must also use `rows_written` in display, CSV export, and run history
- safeQuery returns `{missing: true}` on ANY exception — always verify column names before querying

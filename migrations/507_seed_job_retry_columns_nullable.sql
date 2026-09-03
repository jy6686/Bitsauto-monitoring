-- Unmeasured is not zero.
--
-- Migration 504 added retries_total and backoff_ms as NOT NULL DEFAULT 0,
-- which backfilled every job that ran BEFORE the instrumentation existed with
-- a confident 0. The panel then rendered those runs as "Waiting 0s ·
-- Productive 100% · no retries — the switch answered every slice first time",
-- which is exactly the plausible-looking non-fact this codebase is built to
-- refuse. Nothing was measured for those rows. They must say so.
--
-- The columns become nullable, and rows that could not have passed through
-- the instrumented loop are set back to NULL. The boundary is the UTC moment
-- 504 was authored (2026-09-03 ~13:10 UTC); a conservative cut at 13:00 UTC
-- catches every pre-instrumentation row and cannot touch a genuine
-- post-instrumentation zero, because none existed before the migration did.
ALTER TABLE seed_jobs ALTER COLUMN retries_total DROP NOT NULL;
ALTER TABLE seed_jobs ALTER COLUMN retries_total DROP DEFAULT;
ALTER TABLE seed_jobs ALTER COLUMN backoff_ms    DROP NOT NULL;
ALTER TABLE seed_jobs ALTER COLUMN backoff_ms    DROP DEFAULT;

UPDATE seed_jobs
   SET retries_total = NULL, backoff_ms = NULL
 WHERE retry_causes IS NULL
   AND pace_verdict IS NULL
   AND updated_at < TIMESTAMPTZ '2026-09-03 13:00:00+00';

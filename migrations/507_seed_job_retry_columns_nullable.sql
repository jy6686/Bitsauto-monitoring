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

-- The boundary is this migration's own execution, not a guessed timestamp.
-- A hand-picked cut (13:00 UTC) sat BEFORE 504 actually landed (13:34 UTC) and
-- before it deployed, so every row written in between kept its backfilled 0 and
-- still rendered "Productive 100% · no retries". Every row that exists when 507
-- runs predates the instrumented loop by definition; every row written after it
-- carries an explicit measured value, because the loop's first progress write
-- now sets retries_total and backoff_ms rather than relying on a column
-- default. `updated_at < now()` is therefore exact rather than approximate.
--
-- retry_causes / pace_verdict are checked too: they are only ever written by
-- the instrumented loop, so a row carrying either was measured and must keep
-- its numbers.
UPDATE seed_jobs
   SET retries_total = NULL, backoff_ms = NULL
 WHERE retry_causes IS NULL
   AND pace_verdict IS NULL
   AND updated_at < now();

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
-- the instrumented loop are set back to NULL. The boundary is this migration's
-- OWN execution — see the note above the UPDATE. An earlier draft used a
-- hand-picked 13:00 UTC cut, which sat before 504 actually landed and left
-- every row written in between still claiming a measured zero.

BEGIN;

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

DO $$
DECLARE bad text;
BEGIN
  -- Both the NOT NULL and the DEFAULT must be gone. Either one left behind
  -- reinstates the confident zero this migration exists to remove.
  SELECT string_agg(column_name || ' (nullable=' || is_nullable ||
                    ', default=' || coalesce(column_default,'none') || ')', '; ')
    INTO bad
    FROM information_schema.columns
   WHERE table_name='seed_jobs'
     AND column_name IN ('retries_total','backoff_ms')
     AND (is_nullable <> 'YES' OR column_default IS NOT NULL);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION '507: retry columns still constrained: %', bad;
  END IF;
  RAISE NOTICE '507: unmeasured retry accounting now reads NULL, not 0.';
END$$;

COMMIT;

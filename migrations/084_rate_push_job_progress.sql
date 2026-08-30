-- 084_rate_push_job_progress.sql
--
-- Push History could only say how many operations were done, never which one was running
-- or what it was doing. The information existed but was packed into `notes` as prose, so
-- reading it back meant parsing free text — fine for a human squinting at psql, useless
-- for the UI and useless for aggregation.
--
-- These columns give each in-flight push a current position (client, prefix, step) and a
-- first-class error field. `notes` stays as the human summary; nothing parses it any more.
--
-- last_step_at exists so "how long has it been in this step" is answerable. started_at
-- alone gives total elapsed, which cannot distinguish a slow upload from a slow verify —
-- and that distinction is the whole reason these columns are being added.

BEGIN;

ALTER TABLE rate_push_jobs
  ADD COLUMN IF NOT EXISTS started_at    TIMESTAMP,
  ADD COLUMN IF NOT EXISTS last_client   VARCHAR(160),
  ADD COLUMN IF NOT EXISTS last_prefix   VARCHAR(32),
  ADD COLUMN IF NOT EXISTS last_step     VARCHAR(24),
  ADD COLUMN IF NOT EXISTS last_step_at  TIMESTAMP,
  ADD COLUMN IF NOT EXISTS error_message TEXT;

COMMENT ON COLUMN rate_push_jobs.last_step IS
  'queued | token | uploading | polling | verifying | fallback | completed | failed. '
  'Written from inside the Sippy client at real phase boundaries, not guessed by the route.';

-- Existing rows predate the instrumentation. Leaving started_at NULL would make "elapsed"
-- render as nonsense, so seed it from created_at, which is when those pushes did start.
UPDATE rate_push_jobs SET started_at = created_at WHERE started_at IS NULL;

-- Finished rows get a terminal step so the UI never shows a completed job as "in progress".
UPDATE rate_push_jobs
   SET last_step = CASE WHEN status = 'completed' THEN 'completed' ELSE 'failed' END
 WHERE last_step IS NULL AND status IN ('completed', 'failed');

DO $$
DECLARE missing TEXT;
BEGIN
  SELECT string_agg(c, ', ') INTO missing
    FROM unnest(ARRAY['started_at','last_client','last_prefix','last_step','last_step_at','error_message']) AS c
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns
      WHERE table_name = 'rate_push_jobs' AND column_name = c);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION '084: rate_push_jobs is missing column(s): %', missing;
  END IF;

  IF EXISTS (SELECT 1 FROM rate_push_jobs WHERE started_at IS NULL) THEN
    RAISE EXCEPTION '084: started_at backfill left NULL rows';
  END IF;
END $$;

COMMIT;

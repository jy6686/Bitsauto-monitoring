-- Which subsystem caused the retries, and where a job's time actually went.
--
-- Migration 504 recorded that the 2026-09-03 job spent ~50 of its 90 minutes
-- asleep. It could not say what it was sleeping BECAUSE of, and that is the
-- question that decides who fixes it: a switch that times out, a switch
-- returning 500, a rate limiter, an expired credential and a database fault
-- all produce the same "66 retries, 50m backoff" line and need five different
-- people.
--
-- retry_causes is a {cause: count} object plus one sample message per cause,
-- classified by server/retry-classify.ts. Stored rather than derived so the
-- distribution survives the log rotation it was previously trapped in.

BEGIN;

ALTER TABLE seed_jobs ADD COLUMN IF NOT EXISTS retry_causes JSONB;

-- Worker attribution, for the move to 4-5 concurrent workers. With one worker
-- a slow job is a slow job; with five, "slow" has four possible locations and
-- these three columns separate them: queue_wait_ms is the scheduler's
-- backlog, the execution span is the worker's own, and retry/backoff (504)
-- belong to the remote switch.
ALTER TABLE seed_jobs ADD COLUMN IF NOT EXISTS worker_id     VARCHAR(32);
ALTER TABLE seed_jobs ADD COLUMN IF NOT EXISTS queued_at     TIMESTAMPTZ;
ALTER TABLE seed_jobs ADD COLUMN IF NOT EXISTS queue_wait_ms INTEGER;

DO $$
DECLARE missing text;
BEGIN
  SELECT string_agg(c, ', ') INTO missing
    FROM unnest(ARRAY['retry_causes','worker_id','queued_at','queue_wait_ms']) AS c
   WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_name='seed_jobs' AND column_name=c);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION '505: columns missing after apply: %', missing;
  END IF;
  RAISE NOTICE '505: retry causes and worker attribution recorded on the job row.';
END$$;

COMMIT;

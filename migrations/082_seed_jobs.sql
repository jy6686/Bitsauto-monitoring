-- 082_seed_jobs.sql
--
-- Slice-level progress for CDR imports (owner-approved design, 2026-08-27).
--
-- NOT a durable job engine — deliberately. The owner's Phase 2 scope:
-- "simply enough to know which slice completed, which slice failed, and where
-- to restart manually if necessary." Resumable offsets, queues and retry
-- policy remain Phase 3, gated on production evidence that slicing alone is
-- insufficient.
--
-- Why it exists at all: imports run in-process on autoscale. The in-memory
-- job registry dies with the process (10-minute GC besides), so when the
-- 2026-08-27 day-import was killed by a mid-run republish there was no record
-- of how far it got — the operator's only evidence was a log viewer. This
-- table survives the process.
--
-- Rows are operational metadata, not billing evidence. The import NEVER fails
-- because a progress write failed; writers are best-effort by contract.

BEGIN;

CREATE TABLE IF NOT EXISTS seed_jobs (
  job_id           varchar(64) PRIMARY KEY,
  i_account        integer,
  i_tariff         varchar(64),
  period_start     varchar(32) NOT NULL,
  period_end       varchar(32) NOT NULL,
  slice_minutes    integer     NOT NULL,
  total_slices     integer     NOT NULL,
  completed_slices integer     NOT NULL DEFAULT 0,
  -- Label of the slice being fetched (or the one that failed), e.g.
  -- "2026-08-18 10:00-10:30Z". Text, because it is for a human restarting work.
  current_slice    varchar(64),
  status           varchar(16) NOT NULL DEFAULT 'running',  -- running | done | error
  last_error       text,
  fetched_total    integer     NOT NULL DEFAULT 0,
  stored_total     integer     NOT NULL DEFAULT 0,
  started_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz
);

CREATE INDEX IF NOT EXISTS idx_seed_jobs_started ON seed_jobs (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_seed_jobs_account_period
  ON seed_jobs (i_account, period_start, period_end);

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM seed_jobs;
  RAISE NOTICE '082: seed_jobs ready — % existing job record(s).', n;
END $$;

COMMIT;

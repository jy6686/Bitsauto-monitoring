-- 081_finance_pipeline_runs.sql
--
-- Ledger for the nightly finance pipeline.
--
-- Two things forced this table.
--
-- 1. Catch-up scheduling. materialization_runs shows the deployed process
--    restarting often and sleeping for multi-hour stretches (24 Aug 19:02 ->
--    25 Aug 08:34 is a single gap). A 24-hour setTimeout needs the process
--    alive for a full day and therefore never fires reliably; a short-interval
--    check that asks "has today's run finished?" does. That question can only
--    be asked of persisted state, so the ledger is what makes the schedule
--    work, not merely what records it.
--
-- 2. Observability. The DMR email currently reports success or failure to
--    console only. Once logs roll, "did the DMR go out on the 24th, and to
--    whom?" is unanswerable. Every stage writes its outcome here instead.
--
-- target_date is the BUSINESS date processed (normally yesterday UTC), not the
-- date the run happened — a catch-up run on the 26th for the 24th must be
-- recognisable as the 24th's run, or the scheduler would repeat it forever.

BEGIN;

CREATE TABLE IF NOT EXISTS finance_pipeline_runs (
  id            SERIAL PRIMARY KEY,
  target_date   DATE        NOT NULL,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ,
  -- running  — in flight (or abandoned by a killed process; see the stale check)
  -- success  — every stage that ran succeeded
  -- partial  — at least one stage failed, at least one succeeded
  -- failed   — nothing useful completed
  status        VARCHAR(16) NOT NULL DEFAULT 'running',
  triggered_by  VARCHAR(24) NOT NULL DEFAULT 'scheduler',
  -- [{ stage, status, durationMs, detail?, error? }] — one entry per stage, in
  -- execution order. jsonb rather than a child table: it is written once as a
  -- unit, read whole for the dashboard, and never queried by stage.
  stages        JSONB       NOT NULL DEFAULT '[]'::jsonb,
  duration_ms   INTEGER,
  error         TEXT
);

-- The scheduler's only hot query: "runs for this target_date, newest first".
CREATE INDEX IF NOT EXISTS idx_finance_pipeline_runs_target
  ON finance_pipeline_runs (target_date DESC, started_at DESC);

-- The dashboard's query: recent runs regardless of business date.
CREATE INDEX IF NOT EXISTS idx_finance_pipeline_runs_started
  ON finance_pipeline_runs (started_at DESC);

COMMIT;

-- 073_certification_supersession.sql
--
-- Certification history: a re-certified period supersedes its predecessor
-- rather than erasing it.
--
-- Re-verifying a billing period previously left no trace of what the earlier
-- verification had found. The audit questions that matter after the fact —
-- what did Finance approve originally, why was it run again, which
-- certification did a given invoice actually use — need both runs on record,
-- with the link between them.
--
-- Runs are never deleted and never edited except to mark supersession, which
-- is a one-way transition: superseded_at is set once, when a successor run
-- replaces it.
--
-- A run with superseded_at IS NULL is CURRENT for its tariff and period.

BEGIN;

ALTER TABLE snapshot_verification_runs ADD COLUMN IF NOT EXISTS superseded_at        TIMESTAMPTZ;
ALTER TABLE snapshot_verification_runs ADD COLUMN IF NOT EXISTS superseded_by_run_id INTEGER;
ALTER TABLE snapshot_verification_runs ADD COLUMN IF NOT EXISTS supersede_reason     TEXT;
ALTER TABLE snapshot_verification_runs ADD COLUMN IF NOT EXISTS superseded_by        VARCHAR(128);

CREATE INDEX IF NOT EXISTS idx_svr_current
  ON snapshot_verification_runs (i_tariff, period_start, period_end)
  WHERE superseded_at IS NULL;

DO $$
BEGIN
  RAISE NOTICE '073: certification supersession columns ensured (history preserved).';
END $$;

COMMIT;

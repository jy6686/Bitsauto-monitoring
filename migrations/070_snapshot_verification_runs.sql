-- 070_snapshot_verification_runs.sql
--
-- Persist the outcome of each billing verification run.
--
-- Billing ingestion now rates every CDR independently before it can be
-- invoiced (see the rating verification engine). That run produces exactly the
-- facts Finance needs in order to approve or reject a billing period: how many
-- calls reproduced exactly, how many differed and by how much, and how many
-- could not be priced at all and were therefore EXCLUDED from the invoice.
--
-- Until now those facts existed only in server logs and as per-CDR rows in
-- rating_verifications. Logs rotate, and per-CDR rows carry no notion of a
-- "run" — nobody could answer, three months later, what the billing run for a
-- given customer and period actually found, who triggered it, or which tariff
-- versions it priced against.
--
-- One row per ingestion run. Immutable once completed: a later re-run creates
-- a new row rather than editing history.
--
-- status: ok      — everything priced, nothing excluded, no differences
--         warning — priced, but differences and/or exclusions to review
--         error   — the run itself failed

BEGIN;

CREATE TABLE IF NOT EXISTS snapshot_verification_runs (
  id                 SERIAL PRIMARY KEY,
  i_tariff           VARCHAR(64)  NOT NULL,
  i_account          INTEGER,
  customer_name      VARCHAR(256),
  period_start       VARCHAR(32),
  period_end         VARCHAR(32),

  started_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  completed_at       TIMESTAMPTZ,
  duration_ms        INTEGER,
  triggered_by       VARCHAR(128),

  cdrs_fetched       INTEGER      NOT NULL DEFAULT 0,
  cdrs_skipped       INTEGER      NOT NULL DEFAULT 0,   -- already snapshotted
  verified           INTEGER      NOT NULL DEFAULT 0,   -- reproduced exactly
  discrepancies      INTEGER      NOT NULL DEFAULT 0,   -- reproduced, differs
  unrated            INTEGER      NOT NULL DEFAULT 0,   -- no tariff version
  missing_rate       INTEGER      NOT NULL DEFAULT 0,   -- no matching rate
  excluded           INTEGER      NOT NULL DEFAULT 0,   -- unrated + missing_rate
  snapshots_created  INTEGER      NOT NULL DEFAULT 0,

  total_delta        NUMERIC(14,6),
  max_delta          NUMERIC(14,6),
  tariff_versions    TEXT,                              -- JSON array of ids used

  status             VARCHAR(16)  NOT NULL DEFAULT 'ok',
  error              TEXT,
  engine_version     VARCHAR(32)
);

CREATE INDEX IF NOT EXISTS idx_svr_tariff_period
  ON snapshot_verification_runs (i_tariff, period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_svr_started
  ON snapshot_verification_runs (started_at DESC);

DO $$
BEGIN
  RAISE NOTICE '070: snapshot_verification_runs created (billing verification audit trail).';
END $$;

COMMIT;

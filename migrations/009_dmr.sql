-- Layer: Daily Minutes Report (DMR) — telecom operational economics
-- Append-only daily economics truth. Recalculate creates new version, never overwrites.
-- Run via: psql $DATABASE_URL -f migrations/009_dmr.sql

BEGIN;

CREATE TABLE IF NOT EXISTS daily_minutes_reports (
  id                   SERIAL PRIMARY KEY,
  report_date          DATE          NOT NULL,
  dmr_version          INTEGER       NOT NULL DEFAULT 1,
  parent_dmr_id        INTEGER REFERENCES daily_minutes_reports(id) ON DELETE SET NULL,

  -- Account / Vendor identity
  account_id           VARCHAR(64),
  account_name         VARCHAR(256),
  vendor_id            VARCHAR(64),
  vendor_name          VARCHAR(256),
  destination          VARCHAR(256),
  prefix               VARCHAR(32),

  -- Sippy-reported economics (source of execution truth)
  sippy_duration       REAL,          -- billed seconds
  sippy_amount         REAL,          -- USD sell/revenue
  sippy_calls          INTEGER,

  -- Platform-reproduced economics (BitsAuto independent calculation)
  platform_duration    REAL,
  platform_amount      REAL,
  platform_calls       INTEGER,

  -- Buy / Sell / Margin
  buy_amount           REAL,
  sell_amount          REAL,
  margin_amount        REAL,
  margin_pct           REAL,

  -- Deltas (Sippy minus Platform)
  drift_duration       REAL,
  drift_amount         REAL,

  -- QoS metrics
  total_calls          INTEGER,
  asr                  REAL,
  acd                  REAL,
  pdd                  REAL,

  -- Governance
  tariff_version_id    INTEGER REFERENCES tariff_versions(id) ON DELETE SET NULL,
  discrepancy_type     VARCHAR(32)   NOT NULL DEFAULT 'exact_match',
  -- 'exact_match' | 'duration_drift' | 'amount_drift' | 'tariff_mismatch' | 'missing_cdr' | 'duplicate_cdr'
  verification_status  VARCHAR(32)   NOT NULL DEFAULT 'pending',
  -- 'pending' | 'verified' | 'drifted' | 'critical'
  source               VARCHAR(32)   NOT NULL DEFAULT 'daily_summary',
  -- 'daily_summary' | 'client_cdr' | 'vendor_cdr' | 'manual'
  notes                TEXT,

  -- Recalculation lineage
  recalculated_at      TIMESTAMPTZ,
  generated_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dmr_report_date         ON daily_minutes_reports (report_date);
CREATE INDEX IF NOT EXISTS idx_dmr_account_id          ON daily_minutes_reports (account_id)  WHERE account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dmr_discrepancy_type    ON daily_minutes_reports (discrepancy_type);
CREATE INDEX IF NOT EXISTS idx_dmr_verification_status ON daily_minutes_reports (verification_status);
CREATE INDEX IF NOT EXISTS idx_dmr_version             ON daily_minutes_reports (report_date, dmr_version);

COMMENT ON TABLE daily_minutes_reports IS
  'Daily telecom operational economics. Append-only — recalculation creates new dmr_version rows. Never silently mutates historical economics. Used for revenue assurance, drift detection, and invoice confidence validation.';

COMMIT;

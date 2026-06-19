-- Layer 4B: Rating Verification Engine
-- Also adds Layer 4A enhancement columns (version_hash, change_source, notification_sent, etc.)
-- Run via: psql $DATABASE_URL -f migrations/005_rating_verification.sql

BEGIN;

-- ── 4A enhancements ──────────────────────────────────────────────────────────
ALTER TABLE tariff_versions
  ADD COLUMN IF NOT EXISTS version_hash   VARCHAR(64),
  ADD COLUMN IF NOT EXISTS change_source  VARCHAR(32) DEFAULT 'MANUAL';

COMMENT ON COLUMN tariff_versions.version_hash IS
  'SHA-256 of snapshot_json — used for tamper detection and audit defense.';
COMMENT ON COLUMN tariff_versions.change_source IS
  'MANUAL | AUTO_SYNC | WORKFLOW | AI_RECOMMENDATION | IMPORT';

ALTER TABLE tariff_change_events
  ADD COLUMN IF NOT EXISTS notification_sent  BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS acknowledged       BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS impact_score       REAL;

COMMENT ON COLUMN tariff_change_events.notification_sent IS
  'True when a commercial notification has been dispatched for this change.';
COMMENT ON COLUMN tariff_change_events.acknowledged IS
  'True when the change has been acknowledged by an operator or counterparty.';
COMMENT ON COLUMN tariff_change_events.impact_score IS
  'Estimated monthly traffic impact in USD — populated by the impact analysis engine.';

-- ── 4B: Rating Verification ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rating_verifications (
  id                  SERIAL PRIMARY KEY,
  cdr_call_id         VARCHAR(128),
  cdr_start_time      VARCHAR(64),
  prefix              VARCHAR(32),
  destination         VARCHAR(256),
  i_tariff            VARCHAR(64),
  tariff_version_id   INTEGER REFERENCES tariff_versions(id) ON DELETE SET NULL,
  duration_secs       INTEGER,
  billed_secs         INTEGER,
  sippy_actual_cost   REAL,
  reproduced_cost     REAL,
  delta_amount        REAL,
  delta_pct           REAL,
  discrepancy_type    VARCHAR(64)  NOT NULL DEFAULT 'unrated',
  verification_status VARCHAR(32)  NOT NULL DEFAULT 'pending',
  severity            VARCHAR(16)  NOT NULL DEFAULT 'none',
  verification_source VARCHAR(32)  NOT NULL DEFAULT 'auto',
  verified_at         TIMESTAMPTZ,
  notes               TEXT,
  rate_snapshot       TEXT,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rv_cdr_call_id         ON rating_verifications (cdr_call_id);
CREATE INDEX IF NOT EXISTS idx_rv_i_tariff             ON rating_verifications (i_tariff);
CREATE INDEX IF NOT EXISTS idx_rv_discrepancy_type     ON rating_verifications (discrepancy_type);
CREATE INDEX IF NOT EXISTS idx_rv_severity             ON rating_verifications (severity);
CREATE INDEX IF NOT EXISTS idx_rv_verification_status  ON rating_verifications (verification_status);
CREATE INDEX IF NOT EXISTS idx_rv_created_at           ON rating_verifications (created_at DESC);

COMMENT ON TABLE rating_verifications IS
  'Layer 4B: Per-CDR telecom rating reproduction and discrepancy classification. Read-only against Sippy — never modifies ratings.';

COMMENT ON COLUMN rating_verifications.discrepancy_type IS
  'exact_match | overbilled | underbilled | interval_mismatch | connect_fee_mismatch | grace_period_mismatch | surcharge_mismatch | missing_rate | unrated';

COMMENT ON COLUMN rating_verifications.rate_snapshot IS
  'JSON snapshot of the rate row used for reproduction — immutable audit record.';

COMMIT;

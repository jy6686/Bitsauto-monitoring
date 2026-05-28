-- AI Revenue Assurance Layer + Adjustment Ledger
-- ai_revenue_alerts: anomaly alerts produced by the assurance engine
-- ai_scan_runs: audit log of each scan execution
-- adjustment_ledger: double-entry style ledger for all credit/debit adjustments
-- Run via: psql $DATABASE_URL -f migrations/018_ai_assurance.sql

BEGIN;

CREATE TABLE IF NOT EXISTS ai_revenue_alerts (
  id                 SERIAL PRIMARY KEY,
  alert_type         VARCHAR(64)   NOT NULL,
  -- margin_collapse | asr_drop | revenue_drop | reconciliation_drift | credit_note_clustering | duration_spike | cost_spike
  severity           VARCHAR(16)   NOT NULL DEFAULT 'medium',
  -- low | medium | high | critical
  anomaly_score      INTEGER       NOT NULL DEFAULT 0,   -- 0-100
  client_name        VARCHAR(256),
  vendor_name        VARCHAR(256),
  billing_period     VARCHAR(7),
  baseline_value     REAL,
  current_value      REAL,
  deviation_pct      REAL,
  evidence           JSONB,
  recommended_action TEXT,
  status             VARCHAR(32)   NOT NULL DEFAULT 'OPEN',
  -- OPEN | REVIEWING | DISMISSED | RESOLVED
  reviewed_by        VARCHAR(128),
  reviewed_at        TIMESTAMPTZ,
  resolved_at        TIMESTAMPTZ,
  dismissed_reason   TEXT,
  detected_on        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_scan_runs (
  id              SERIAL PRIMARY KEY,
  triggered_by    VARCHAR(128),
  alerts_created  INTEGER         NOT NULL DEFAULT 0,
  detectors_ran   INTEGER         NOT NULL DEFAULT 0,
  duration_ms     INTEGER,
  status          VARCHAR(32)     NOT NULL DEFAULT 'running',
  -- running | completed | failed
  error           TEXT,
  started_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS adjustment_ledger (
  id               SERIAL PRIMARY KEY,
  client_name      VARCHAR(256)   NOT NULL,
  reference_type   VARCHAR(32)    NOT NULL,
  -- credit_note | invoice | dispute | manual | write_off | carry_forward
  reference_id     VARCHAR(64)    NOT NULL,
  debit_usd        REAL,
  credit_usd       REAL,
  balance_after_usd REAL,
  description      TEXT,
  actor_name       VARCHAR(128),
  created_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ara_status      ON ai_revenue_alerts (status);
CREATE INDEX IF NOT EXISTS idx_ara_severity    ON ai_revenue_alerts (severity);
CREATE INDEX IF NOT EXISTS idx_ara_alert_type  ON ai_revenue_alerts (alert_type);
CREATE INDEX IF NOT EXISTS idx_ara_client_name ON ai_revenue_alerts (client_name);
CREATE INDEX IF NOT EXISTS idx_ara_detected_on ON ai_revenue_alerts (detected_on);
CREATE INDEX IF NOT EXISTS idx_al_client_name  ON adjustment_ledger (client_name);
CREATE INDEX IF NOT EXISTS idx_al_ref_type_id  ON adjustment_ledger (reference_type, reference_id);

COMMENT ON TABLE ai_revenue_alerts IS
  'Anomaly alerts produced by the AI Revenue Assurance engine. Advisory-only — no auto-actions.';
COMMENT ON TABLE ai_scan_runs IS
  'Audit log of every assurance scan run, with alert counts and timing.';
COMMENT ON TABLE adjustment_ledger IS
  'Immutable ledger of all credit/debit adjustments linked to credit notes, invoices, and disputes.';

COMMIT;

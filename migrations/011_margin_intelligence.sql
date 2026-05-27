-- Layer 7: Margin Intelligence — telecom commercial profitability analytics
-- Materialized from DMR + reconciliation data. Pre-computed per day.
-- Run via: psql $DATABASE_URL -f migrations/011_margin_intelligence.sql

BEGIN;

CREATE TABLE IF NOT EXISTS margin_analytics_daily (
  id              SERIAL PRIMARY KEY,
  date            DATE          NOT NULL,
  dimension_type  VARCHAR(16)   NOT NULL,   -- 'client' | 'vendor' | 'aggregate'
  dimension_id    VARCHAR(64),
  dimension_name  VARCHAR(256)  NOT NULL,

  revenue_usd     REAL,
  cost_usd        REAL,
  margin_usd      REAL,
  margin_pct      REAL,

  duration_sec    REAL,
  calls           INTEGER,
  asr             REAL,
  acd             REAL,

  source          VARCHAR(32)   NOT NULL DEFAULT 'dmr',
  computed_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS margin_alerts (
  id              SERIAL PRIMARY KEY,
  alert_type      VARCHAR(32)   NOT NULL,
  -- 'negative_margin' | 'margin_drop' | 'threshold_breach' | 'vendor_cost_spike'
  dimension_type  VARCHAR(16)   NOT NULL,
  dimension_name  VARCHAR(256)  NOT NULL,
  date            DATE          NOT NULL,

  threshold_pct   REAL,
  actual_pct      REAL,
  delta_pct       REAL,
  amount_usd      REAL,

  severity        VARCHAR(16)   NOT NULL DEFAULT 'medium',
  message         TEXT,

  acknowledged    BOOLEAN       NOT NULL DEFAULT FALSE,
  acknowledged_by VARCHAR(128),
  acknowledged_at TIMESTAMPTZ,
  triggered_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mad_date           ON margin_analytics_daily (date);
CREATE INDEX IF NOT EXISTS idx_mad_dimension_type ON margin_analytics_daily (dimension_type);
CREATE INDEX IF NOT EXISTS idx_mad_dimension_name ON margin_analytics_daily (dimension_name);
CREATE INDEX IF NOT EXISTS idx_mad_date_type      ON margin_analytics_daily (date, dimension_type);

CREATE INDEX IF NOT EXISTS idx_malerts_date       ON margin_alerts (date);
CREATE INDEX IF NOT EXISTS idx_malerts_acked      ON margin_alerts (acknowledged);
CREATE INDEX IF NOT EXISTS idx_malerts_severity   ON margin_alerts (severity);

COMMENT ON TABLE margin_analytics_daily IS
  'Pre-computed margin analytics by client, vendor, and aggregate. Materialized from DMR rows. Used for profitability ranking, trend analysis, and commercial intelligence.';
COMMENT ON TABLE margin_alerts IS
  'Margin threshold breach alerts generated during materialization. Negative margin, margin drops, and vendor cost spikes trigger entries here.';

COMMIT;

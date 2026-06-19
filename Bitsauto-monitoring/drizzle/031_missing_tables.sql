-- Migration 031: Tables defined in shared/schema.ts that were missing from the live DB
-- Discovered automatically by runSchemaCheck() after switching to schema-derived verification.

CREATE TABLE IF NOT EXISTS cdr_anomaly_batches (
  id              SERIAL PRIMARY KEY,
  run_date        VARCHAR(12)  NOT NULL,
  account         VARCHAR(128) NOT NULL,
  metric          VARCHAR(32)  NOT NULL,
  baseline        REAL         NOT NULL,
  observed        REAL         NOT NULL,
  deviation_sigma REAL         NOT NULL,
  severity        VARCHAR(16)  NOT NULL,
  created_at      TIMESTAMP    DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invoice_email_deliveries (
  id            SERIAL PRIMARY KEY,
  invoice_id    INTEGER      NOT NULL,
  recipients    TEXT         NOT NULL,
  cc_addresses  TEXT         DEFAULT '[]',
  subject       VARCHAR(512) NOT NULL,
  body_text     TEXT,
  sent_by       VARCHAR(255),
  status        VARCHAR(32)  NOT NULL DEFAULT 'sent',
  error_message TEXT,
  sent_at       TIMESTAMP    DEFAULT NOW(),
  created_at    TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reconciliation_report_schedules (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(128) NOT NULL,
  report_type   VARCHAR(20)  NOT NULL DEFAULT 'carrier',
  recipients    TEXT         NOT NULL,
  format        VARCHAR(10)  NOT NULL DEFAULT 'pdf',
  frequency     VARCHAR(20)  NOT NULL DEFAULT 'monthly',
  day_of_month  INTEGER      DEFAULT 1,
  day_of_week   INTEGER,
  cron_hour     INTEGER      NOT NULL DEFAULT 8,
  carrier_tariff VARCHAR(64),
  enabled       BOOLEAN      NOT NULL DEFAULT true,
  last_sent_at  TIMESTAMP,
  next_due_at   TIMESTAMP,
  created_at    TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rtp_quality_history (
  id              SERIAL PRIMARY KEY,
  vendor_id       VARCHAR(128) NOT NULL,
  avg_mos         REAL,
  p10_mos         REAL,
  avg_jitter_ms   REAL,
  avg_pkt_loss_pct REAL,
  avg_latency_ms  REAL,
  sample_count    INTEGER      NOT NULL DEFAULT 0,
  snapped_at      TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rqh_vendor_snapped
  ON rtp_quality_history (vendor_id, snapped_at DESC);

-- vendor_health_scores and route_health_scores were in drizzle/024 but that file
-- was never applied automatically — adding them here so runSafeMigrations covers them.
CREATE TABLE IF NOT EXISTS vendor_health_scores (
  id                SERIAL PRIMARY KEY,
  vendor_name       VARCHAR(128) NOT NULL,
  scored_at         TIMESTAMP    NOT NULL DEFAULT NOW(),
  overall_score     REAL         NOT NULL,
  quality_score     REAL,
  reliability_score REAL,
  fraud_score       REAL,
  margin_score      REAL,
  trend             VARCHAR(16),
  trend_delta       REAL,
  details           JSONB
);

CREATE INDEX IF NOT EXISTS idx_vhs_vendor_scored
  ON vendor_health_scores (vendor_name, scored_at DESC);

CREATE TABLE IF NOT EXISTS route_health_scores (
  id                  SERIAL PRIMARY KEY,
  routing_group_id    VARCHAR(64)  NOT NULL,
  routing_group_name  VARCHAR(256) NOT NULL,
  scored_at           TIMESTAMP    NOT NULL DEFAULT NOW(),
  overall_score       REAL         NOT NULL,
  vendor_count        INTEGER      NOT NULL DEFAULT 0,
  lowest_vendor_score REAL,
  details             JSONB
);

CREATE INDEX IF NOT EXISTS idx_rhs_group_scored
  ON route_health_scores (routing_group_id, scored_at DESC);

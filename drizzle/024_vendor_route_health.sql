-- Migration 024: Vendor & Route Health Scores
-- Unified 0-100 vendor health scoring engine tables

CREATE TABLE IF NOT EXISTS vendor_health_scores (
  id               SERIAL PRIMARY KEY,
  vendor_name      VARCHAR(128) NOT NULL,
  scored_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  overall_score    REAL NOT NULL,
  quality_score    REAL,
  reliability_score REAL,
  fraud_score      REAL,
  margin_score     REAL,
  trend            VARCHAR(16),
  trend_delta      REAL,
  details          JSONB
);

CREATE INDEX IF NOT EXISTS idx_vhs_vendor_scored
  ON vendor_health_scores (vendor_name, scored_at DESC);

CREATE TABLE IF NOT EXISTS route_health_scores (
  id                  SERIAL PRIMARY KEY,
  routing_group_id    VARCHAR(64) NOT NULL,
  routing_group_name  VARCHAR(256) NOT NULL,
  scored_at           TIMESTAMP NOT NULL DEFAULT NOW(),
  overall_score       REAL NOT NULL,
  vendor_count        INTEGER NOT NULL DEFAULT 0,
  lowest_vendor_score REAL,
  details             JSONB
);

CREATE INDEX IF NOT EXISTS idx_rhs_group_scored
  ON route_health_scores (routing_group_id, scored_at DESC);

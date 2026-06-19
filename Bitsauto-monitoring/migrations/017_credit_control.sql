-- Collections & Credit Control
-- credit_control_rules: per-client or global threshold configuration
-- collection_events: immutable timeline of all credit control actions
-- Run via: psql $DATABASE_URL -f migrations/017_credit_control.sql

BEGIN;

CREATE TABLE IF NOT EXISTS credit_control_rules (
  id                     SERIAL PRIMARY KEY,
  client_name            VARCHAR(256),      -- NULL = global default rule
  client_id              VARCHAR(128),
  is_global              BOOLEAN           NOT NULL DEFAULT FALSE,
  warning_threshold_usd  REAL,              -- outstanding balance → warning
  suspend_threshold_usd  REAL,              -- outstanding balance → suspension
  grace_period_days      INTEGER           NOT NULL DEFAULT 3,
  auto_suspend           BOOLEAN           NOT NULL DEFAULT FALSE,
  notify_on_warning      BOOLEAN           NOT NULL DEFAULT TRUE,
  credit_limit_usd       REAL,
  risk_score             INTEGER,           -- 0-100
  notes                  TEXT,
  created_at             TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ       NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS collection_events (
  id                     SERIAL PRIMARY KEY,
  client_name            VARCHAR(256)      NOT NULL,
  client_id              VARCHAR(128),
  event_type             VARCHAR(32)       NOT NULL,
  -- warning | suspension | grace_start | grace_end | recovery | write_off | reinstated
  outstanding_amount_usd REAL,
  threshold_breached     VARCHAR(32),       -- warning | suspend
  action_taken           TEXT,
  resolved_at            TIMESTAMPTZ,
  actor_name             VARCHAR(128),
  notes                  TEXT,
  created_at             TIMESTAMPTZ       NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ccr_client_name ON credit_control_rules (client_name) WHERE client_name IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ccr_global      ON credit_control_rules (is_global) WHERE is_global = TRUE;
CREATE INDEX IF NOT EXISTS idx_ce_client_name         ON collection_events (client_name);
CREATE INDEX IF NOT EXISTS idx_ce_event_type          ON collection_events (event_type);
CREATE INDEX IF NOT EXISTS idx_ce_created_at          ON collection_events (created_at);

COMMENT ON TABLE credit_control_rules IS
  'Per-client or global credit threshold configuration. Controls warning/suspend thresholds, grace periods, and auto-suspend behavior.';
COMMENT ON TABLE collection_events IS
  'Immutable timeline of all credit control and collection actions per client.';

COMMIT;

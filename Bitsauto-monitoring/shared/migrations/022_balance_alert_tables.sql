-- Migration 022: Balance Alert Threshold Tables
-- Creates balance_alert_thresholds and balance_alert_events tables
-- and seeds global defaults (warning=$100, urgent=$50, critical=$10).

CREATE TABLE IF NOT EXISTS balance_alert_thresholds (
  id           SERIAL PRIMARY KEY,
  account_id   VARCHAR(32),            -- NULL = global default; non-null = per-account override
  account_name VARCHAR(128),           -- denormalized display name
  threshold_usd REAL NOT NULL,         -- USD amount that triggers the alert
  severity     VARCHAR(16) NOT NULL DEFAULT 'warning', -- warning | urgent | critical
  created_at   TIMESTAMP DEFAULT NOW(),
  updated_at   TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS balance_alert_events (
  id              SERIAL PRIMARY KEY,
  account_id      VARCHAR(32) NOT NULL,
  account_name    VARCHAR(128),
  threshold_usd   REAL NOT NULL,
  severity        VARCHAR(16) NOT NULL, -- warning | urgent | critical
  current_balance REAL NOT NULL,
  triggered_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  resolved_at     TIMESTAMP,           -- NULL = still open; set when balance recovers
  checked_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Seed global defaults if not already present
INSERT INTO balance_alert_thresholds (account_id, account_name, threshold_usd, severity)
SELECT NULL, NULL, 100, 'warning'
WHERE NOT EXISTS (
  SELECT 1 FROM balance_alert_thresholds WHERE account_id IS NULL AND severity = 'warning'
);
INSERT INTO balance_alert_thresholds (account_id, account_name, threshold_usd, severity)
SELECT NULL, NULL, 50, 'urgent'
WHERE NOT EXISTS (
  SELECT 1 FROM balance_alert_thresholds WHERE account_id IS NULL AND severity = 'urgent'
);
INSERT INTO balance_alert_thresholds (account_id, account_name, threshold_usd, severity)
SELECT NULL, NULL, 10, 'critical'
WHERE NOT EXISTS (
  SELECT 1 FROM balance_alert_thresholds WHERE account_id IS NULL AND severity = 'critical'
);

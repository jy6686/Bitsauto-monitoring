-- Migration 026: Reconciliation Report Schedules
-- Tracks recurring email delivery schedules for carrier and client reconciliation reports.

CREATE TABLE IF NOT EXISTS reconciliation_report_schedules (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(128)  NOT NULL,
  report_type   VARCHAR(20)   NOT NULL DEFAULT 'carrier',
  recipients    TEXT          NOT NULL,
  format        VARCHAR(10)   NOT NULL DEFAULT 'pdf',
  frequency     VARCHAR(20)   NOT NULL DEFAULT 'monthly',
  day_of_month  INTEGER       DEFAULT 1,
  day_of_week   INTEGER,
  cron_hour     INTEGER       NOT NULL DEFAULT 8,
  carrier_tariff VARCHAR(64),
  enabled       BOOLEAN       NOT NULL DEFAULT true,
  last_sent_at  TIMESTAMPTZ,
  next_due_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recon_schedules_type    ON reconciliation_report_schedules (report_type);
CREATE INDEX IF NOT EXISTS idx_recon_schedules_enabled ON reconciliation_report_schedules (enabled);
CREATE INDEX IF NOT EXISTS idx_recon_schedules_due     ON reconciliation_report_schedules (next_due_at);

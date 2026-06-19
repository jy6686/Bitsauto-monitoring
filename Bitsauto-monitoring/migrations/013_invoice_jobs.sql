-- Finance Governance Phase 1: Invoice Delivery Automation
-- invoice_jobs orchestrates the full invoice delivery lifecycle.
-- status lifecycle: PENDING → GENERATED → REVIEW → APPROVED → SENT / FAILED → RETRYING → CANCELLED
-- Run via: psql $DATABASE_URL -f migrations/013_invoice_jobs.sql

BEGIN;

CREATE TABLE IF NOT EXISTS invoice_jobs (
  id              SERIAL PRIMARY KEY,
  client_id       VARCHAR(128),
  client_name     VARCHAR(256)  NOT NULL,
  billing_period  VARCHAR(7)    NOT NULL,   -- YYYY-MM
  invoice_id      INTEGER,
  status          VARCHAR(32)   NOT NULL DEFAULT 'PENDING',
  scheduled_at    TIMESTAMPTZ,
  generated_at    TIMESTAMPTZ,
  approved_at     TIMESTAMPTZ,
  approved_by     VARCHAR(128),
  sent_at         TIMESTAMPTZ,
  failed_at       TIMESTAMPTZ,
  retry_count     INTEGER       NOT NULL DEFAULT 0,
  last_error      TEXT,
  notes           TEXT,
  created_by      VARCHAR(128),
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoice_jobs_status         ON invoice_jobs (status);
CREATE INDEX IF NOT EXISTS idx_invoice_jobs_billing_period ON invoice_jobs (billing_period);
CREATE INDEX IF NOT EXISTS idx_invoice_jobs_client_name    ON invoice_jobs (client_name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_jobs_client_period
  ON invoice_jobs (client_name, billing_period)
  WHERE status NOT IN ('CANCELLED');

COMMENT ON TABLE invoice_jobs IS
  'Invoice delivery automation jobs. One job per client per billing period. Tracks the full lifecycle from draft generation through finance approval to SMTP dispatch.';

COMMIT;

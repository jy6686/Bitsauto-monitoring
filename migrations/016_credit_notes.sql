-- Credit Notes & Settlement Engine
-- credit_notes: formal credit adjustments against invoices
-- status lifecycle: DRAFT → APPROVED → APPLIED | VOID
-- Run via: psql $DATABASE_URL -f migrations/016_credit_notes.sql

BEGIN;

CREATE TABLE IF NOT EXISTS credit_notes (
  id                 SERIAL PRIMARY KEY,
  reference_id       VARCHAR(32)   NOT NULL UNIQUE,   -- CRN-YYYY-NNN
  credit_type        VARCHAR(32)   NOT NULL,
  -- partial_credit | full_credit | adjustment | write_off | carry_forward
  client_name        VARCHAR(256)  NOT NULL,
  client_id          VARCHAR(128),
  invoice_id         INTEGER,
  dispute_case_id    INTEGER,
  billing_period     VARCHAR(7),
  amount_usd         REAL          NOT NULL,
  applied_amount_usd REAL,
  reason             VARCHAR(512)  NOT NULL,
  description        TEXT,
  status             VARCHAR(32)   NOT NULL DEFAULT 'DRAFT',
  approved_by        VARCHAR(128),
  approved_at        TIMESTAMPTZ,
  applied_at         TIMESTAMPTZ,
  voided_at          TIMESTAMPTZ,
  voided_reason      TEXT,
  created_by         VARCHAR(128),
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cn_status      ON credit_notes (status);
CREATE INDEX IF NOT EXISTS idx_cn_client_name ON credit_notes (client_name);
CREATE INDEX IF NOT EXISTS idx_cn_invoice_id  ON credit_notes (invoice_id);
CREATE INDEX IF NOT EXISTS idx_cn_dispute_id  ON credit_notes (dispute_case_id);

COMMENT ON TABLE credit_notes IS
  'Formal credit adjustments (partial, full, write-off, carry-forward) against invoices. Governed lifecycle: DRAFT → APPROVED → APPLIED | VOID.';

COMMIT;

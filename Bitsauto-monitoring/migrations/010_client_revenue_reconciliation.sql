-- Layer 6C: Client Revenue Reconciliation — bilateral telecom finance truth
-- Compares client-submitted billing vs BitsAuto invoice vs DMR.
-- Append-only version pattern consistent with DMR.
-- Run via: psql $DATABASE_URL -f migrations/010_client_revenue_reconciliation.sql

BEGIN;

CREATE TABLE IF NOT EXISTS client_revenue_reconciliations (
  id                     SERIAL PRIMARY KEY,
  billing_period         VARCHAR(7)    NOT NULL,   -- YYYY-MM
  version                INTEGER       NOT NULL DEFAULT 1,
  parent_id              INTEGER REFERENCES client_revenue_reconciliations(id) ON DELETE SET NULL,

  -- Client identity
  client_account_id      VARCHAR(64),
  client_name            VARCHAR(256)  NOT NULL,

  -- Client-submitted economics
  client_duration_sec    REAL,          -- seconds billed per client's own records
  client_amount_usd      REAL,          -- USD per client's own records
  client_calls           INTEGER,

  -- BitsAuto computed economics (from invoice)
  bitsauto_duration_sec  REAL,
  bitsauto_amount_usd    REAL,
  bitsauto_calls         INTEGER,

  -- DMR source figures (Sippy-verified operational truth)
  dmr_duration_sec       REAL,
  dmr_amount_usd         REAL,

  -- Deltas (Client minus BitsAuto)
  delta_duration_sec     REAL,
  delta_amount_usd       REAL,
  delta_pct              REAL,          -- percentage delta of amount

  -- Classification
  discrepancy_type       VARCHAR(32)   NOT NULL DEFAULT 'no_client_data',
  -- 'exact_match' | 'duration_drift' | 'amount_drift' | 'both_drift' | 'no_client_data' | 'no_bitsauto_data'
  severity               VARCHAR(16)   NOT NULL DEFAULT 'clean',
  -- 'clean' | 'low' | 'medium' | 'high' | 'critical'
  status                 VARCHAR(32)   NOT NULL DEFAULT 'pending',
  -- 'pending' | 'in_review' | 'reconciled' | 'disputed' | 'approved'

  -- Links
  invoice_id             INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
  source                 VARCHAR(32)   NOT NULL DEFAULT 'manual',
  -- 'manual' | 'csv' | 'api'
  raw_import             JSONB,
  notes                  TEXT,

  -- Workflow
  reviewed_by            VARCHAR(128),
  reviewed_at            TIMESTAMPTZ,
  reconciled_at          TIMESTAMPTZ,
  created_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crr_billing_period   ON client_revenue_reconciliations (billing_period);
CREATE INDEX IF NOT EXISTS idx_crr_client_account   ON client_revenue_reconciliations (client_account_id) WHERE client_account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crr_status           ON client_revenue_reconciliations (status);
CREATE INDEX IF NOT EXISTS idx_crr_severity         ON client_revenue_reconciliations (severity);
CREATE INDEX IF NOT EXISTS idx_crr_version          ON client_revenue_reconciliations (billing_period, version);

COMMENT ON TABLE client_revenue_reconciliations IS
  'Customer-side revenue reconciliation. Compares client-submitted billing data against BitsAuto invoice and DMR operational truth. Append-only version pattern — recalculate creates a new version row, never overwrites history. Completes bilateral telecom finance triangulation: vendor-us-customer.';

COMMIT;

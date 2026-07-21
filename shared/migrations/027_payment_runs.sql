-- ============================================================
-- Migration 027: Payment Runs
-- CAP-003 Phase 4 — Treasury, Sprint T2
--
-- payment_runs      — batch payment run header (PR-YYYY-NNNN)
-- payment_run_items — individual bill selections within a run
--
-- Lifecycle:
--   draft → reviewed → approved → executed → completed
--                                          → cancelled (from any pre-executed state)
--
-- On execute:
--   Each item creates a vendor_payment + vendor_payment_allocation.
--   Treasury account balance is reduced by total_amount.
--   Item.vendor_payment_id is set to the created payment.
-- ============================================================

CREATE TABLE IF NOT EXISTS payment_runs (
  id                  SERIAL PRIMARY KEY,

  -- Identity
  run_number          VARCHAR(30)  UNIQUE NOT NULL,     -- PR-YYYY-NNNN
  name                VARCHAR(255) NOT NULL,

  -- Source treasury account
  treasury_account_id INTEGER NOT NULL
                      REFERENCES treasury_accounts(id) ON DELETE RESTRICT,

  -- Totals (denormalised — updated when items change)
  currency            VARCHAR(10)  NOT NULL DEFAULT 'USD',
  total_amount        NUMERIC(14,4) NOT NULL DEFAULT 0,
  item_count          INTEGER       NOT NULL DEFAULT 0,

  -- Lifecycle status
  status              VARCHAR(20) NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','reviewed','approved','executed','completed','cancelled')),

  -- Execution fields (status-only for Phase 4; extensible for API/blockchain adapters later)
  execution_mode      VARCHAR(20) NOT NULL DEFAULT 'manual'
                      CHECK (execution_mode IN ('manual','api','blockchain')),
  executed_at         TIMESTAMPTZ,
  executed_by         VARCHAR(255),
  external_reference  VARCHAR(255),
  execution_notes     TEXT,

  -- Scheduling
  scheduled_date      DATE,

  -- Notes
  notes               TEXT,

  -- Audit trail
  created_by          VARCHAR(255) NOT NULL,
  reviewed_by         VARCHAR(255),
  reviewed_at         TIMESTAMPTZ,
  approved_by         VARCHAR(255),
  approved_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pr_account    ON payment_runs (treasury_account_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pr_status     ON payment_runs (status)              WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pr_date       ON payment_runs (scheduled_date)      WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pr_deleted_at ON payment_runs (deleted_at);

-- ── Payment Run Items ────────────────────────────────────────────────────────
-- Each item links one vendor_bill to the run and records the amount to pay.
-- vendor_payment_id is populated when the run is executed.

CREATE TABLE IF NOT EXISTS payment_run_items (
  id                  SERIAL PRIMARY KEY,

  payment_run_id      INTEGER NOT NULL
                      REFERENCES payment_runs(id)      ON DELETE CASCADE,
  vendor_bill_id      INTEGER NOT NULL
                      REFERENCES vendor_bills(id)      ON DELETE RESTRICT,
  business_partner_id INTEGER NOT NULL
                      REFERENCES business_partners(id) ON DELETE RESTRICT,

  amount              NUMERIC(14,4) NOT NULL,   -- amount to pay (may be partial)
  currency            VARCHAR(10)   NOT NULL,

  item_status         VARCHAR(20) NOT NULL DEFAULT 'included'
                      CHECK (item_status IN ('included','excluded','paid')),

  -- Set when run is executed (links to the created vendor_payment)
  vendor_payment_id   INTEGER
                      REFERENCES vendor_payments(id) ON DELETE SET NULL,

  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (payment_run_id, vendor_bill_id)
);

CREATE INDEX IF NOT EXISTS idx_pri_run_id  ON payment_run_items (payment_run_id);
CREATE INDEX IF NOT EXISTS idx_pri_bill_id ON payment_run_items (vendor_bill_id);
CREATE INDEX IF NOT EXISTS idx_pri_partner ON payment_run_items (business_partner_id);

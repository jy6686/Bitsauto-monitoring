-- Migration 024: Vendor Payments + Allocations
-- Sprint A3 — CAP-003 Phase 3
-- Creates: vendor_payments, vendor_payment_allocations
-- Conventions: IF NOT EXISTS guards, idx_{abbrev}_{field} index names,
--   NUMERIC(14,4) for money, deleted_at soft-delete on vendor_payments,
--   CASCADE delete on allocations, no triggers, no seed data.

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: vendor_payments
-- Outbound payments made to vendors against one or more approved bills.
-- Status: posted (default) | reversed
-- deleted_at: soft delete — active when NULL.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vendor_payments (
  id                   SERIAL PRIMARY KEY,
  payment_number       VARCHAR(64)    NOT NULL UNIQUE,            -- VP-YYYY-NNNN
  business_partner_id  INTEGER        NOT NULL REFERENCES business_partners(id) ON DELETE RESTRICT,
  payment_date         DATE           NOT NULL,
  currency             VARCHAR(8)     NOT NULL DEFAULT 'USD',
  amount               NUMERIC(14,4)  NOT NULL,
  payment_method       VARCHAR(32)    NOT NULL DEFAULT 'bank_transfer',
    -- bank_transfer | cheque | card | direct_debit | cash | other
  reference            VARCHAR(128),                              -- bank tx ID / cheque number
  notes                TEXT,
  status               VARCHAR(20)    NOT NULL DEFAULT 'posted',  -- posted | reversed
  reversed_at          TIMESTAMP,
  reversed_by          VARCHAR(128),
  -- Audit
  created_by           VARCHAR(128),
  created_at           TIMESTAMP      NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMP      NOT NULL DEFAULT NOW(),
  deleted_at           TIMESTAMP                                  -- NULL = active

  ,CONSTRAINT chk_vp_amount_positive CHECK (amount > 0)
  ,CONSTRAINT chk_vp_status          CHECK (status IN ('posted', 'reversed'))
);

-- Indexes — vendor_payments
CREATE INDEX IF NOT EXISTS idx_vp_partner    ON vendor_payments (business_partner_id);
CREATE INDEX IF NOT EXISTS idx_vp_status     ON vendor_payments (status);
CREATE INDEX IF NOT EXISTS idx_vp_date       ON vendor_payments (payment_date DESC);
CREATE INDEX IF NOT EXISTS idx_vp_deleted_at ON vendor_payments (deleted_at) WHERE deleted_at IS NULL;
-- payment_number covered by UNIQUE constraint

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: vendor_payment_allocations
-- Maps a payment to the bills it settles (one-to-many).
-- A single payment may be split across multiple bills (multi-bill allocation).
-- CASCADE: allocations are removed when the parent payment is hard-deleted.
-- No soft delete — allocations follow their parent payment's lifecycle.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vendor_payment_allocations (
  id                 SERIAL PRIMARY KEY,
  vendor_payment_id  INTEGER        NOT NULL REFERENCES vendor_payments(id) ON DELETE CASCADE,
  vendor_bill_id     INTEGER        NOT NULL REFERENCES vendor_bills(id)    ON DELETE RESTRICT,
  allocated_amount   NUMERIC(14,4)  NOT NULL,
  created_at         TIMESTAMP      NOT NULL DEFAULT NOW()

  ,CONSTRAINT chk_vpa_amount_positive CHECK (allocated_amount > 0)
  ,CONSTRAINT uq_vpa_payment_bill     UNIQUE  (vendor_payment_id, vendor_bill_id)
);

-- Indexes — vendor_payment_allocations
CREATE INDEX IF NOT EXISTS idx_vpa_payment_id ON vendor_payment_allocations (vendor_payment_id);
CREATE INDEX IF NOT EXISTS idx_vpa_bill_id    ON vendor_payment_allocations (vendor_bill_id);

-- Migration 025: Vendor Adjustments
-- Sprint A3 — CAP-003 Phase 3
-- Creates: vendor_adjustments
-- Conventions: IF NOT EXISTS guards, idx_{abbrev}_{field} index names,
--   NUMERIC(14,4) for money, deleted_at soft-delete, no triggers, no seed data.

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: vendor_adjustments
-- Credit notes, debit notes and write-offs raised against vendors.
-- Type axis:
--   credit_note  — reduces amount owed to the vendor (vendor owes us money back)
--   debit_note   — increases amount owed to the vendor (we owe vendor more)
--   write_off    — closes outstanding balance without payment
-- Status lifecycle: draft → posted → reversed
-- vendor_bill_id is optional: adjustments may be standalone or linked to a bill.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vendor_adjustments (
  id                   SERIAL PRIMARY KEY,
  adjustment_number    VARCHAR(64)    NOT NULL UNIQUE,            -- VA-YYYY-NNNN
  business_partner_id  INTEGER        NOT NULL REFERENCES business_partners(id) ON DELETE RESTRICT,
  vendor_bill_id       INTEGER                REFERENCES vendor_bills(id) ON DELETE RESTRICT,  -- optional
  type                 VARCHAR(20)    NOT NULL DEFAULT 'credit_note',
    -- credit_note | debit_note | write_off
  adjustment_date      DATE           NOT NULL,
  currency             VARCHAR(8)     NOT NULL DEFAULT 'USD',
  amount               NUMERIC(14,4)  NOT NULL,
  reason               VARCHAR(256)   NOT NULL,
  description          TEXT,
  status               VARCHAR(20)    NOT NULL DEFAULT 'draft',   -- draft | posted | reversed
  posted_at            TIMESTAMP,
  posted_by            VARCHAR(128),
  reversed_at          TIMESTAMP,
  reversed_by          VARCHAR(128),
  -- Audit
  created_by           VARCHAR(128),
  created_at           TIMESTAMP      NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMP      NOT NULL DEFAULT NOW(),
  deleted_at           TIMESTAMP                                  -- NULL = active

  ,CONSTRAINT chk_va_amount_positive CHECK (amount > 0)
  ,CONSTRAINT chk_va_type   CHECK (type   IN ('credit_note', 'debit_note', 'write_off'))
  ,CONSTRAINT chk_va_status CHECK (status IN ('draft', 'posted', 'reversed'))
);

-- Indexes — vendor_adjustments
CREATE INDEX IF NOT EXISTS idx_va_partner    ON vendor_adjustments (business_partner_id);
CREATE INDEX IF NOT EXISTS idx_va_bill       ON vendor_adjustments (vendor_bill_id);
CREATE INDEX IF NOT EXISTS idx_va_type       ON vendor_adjustments (type);
CREATE INDEX IF NOT EXISTS idx_va_status     ON vendor_adjustments (status);
CREATE INDEX IF NOT EXISTS idx_va_date       ON vendor_adjustments (adjustment_date DESC);
CREATE INDEX IF NOT EXISTS idx_va_deleted_at ON vendor_adjustments (deleted_at) WHERE deleted_at IS NULL;
-- adjustment_number covered by UNIQUE constraint

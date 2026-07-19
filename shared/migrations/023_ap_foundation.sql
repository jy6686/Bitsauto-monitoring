-- Migration 023: Accounts Payable Foundation
-- Sprint A1 — CAP-003 Phase 3
-- Creates: business_partners, vendor_bills, vendor_bill_lines
-- Conventions: IF NOT EXISTS guards, idx_{abbrev}_{field} index names,
--   NUMERIC(14,4) for money, NUMERIC(14,6) for unit prices,
--   deleted_at soft-delete on master entities, no triggers, no seed data.

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: business_partners
-- Unified Finance entity for payable parties (vendors, clients, carriers).
-- Intentionally excludes telecom fields; optional FKs link to existing
-- telecom-domain records where the same organisation exists in both contexts.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS business_partners (
  id                          SERIAL PRIMARY KEY,
  name                        VARCHAR(256)  NOT NULL,
  type                        VARCHAR(20)   NOT NULL DEFAULT 'vendor',       -- vendor | client | carrier
  status                      VARCHAR(20)   NOT NULL DEFAULT 'active',       -- active | inactive | suspended
  tax_id                      VARCHAR(64),
  currency                    VARCHAR(8)    NOT NULL DEFAULT 'USD',
  payment_terms_days          INTEGER       NOT NULL DEFAULT 30,
  bank_name                   VARCHAR(128),
  bank_account_number         VARCHAR(64),
  bank_iban                   VARCHAR(64),
  bank_swift                  VARCHAR(32),
  contact_name                VARCHAR(128),
  contact_email               VARCHAR(255),
  contact_phone               VARCHAR(32),
  address_line1               VARCHAR(255),
  address_line2               VARCHAR(255),
  city                        VARCHAR(100),
  country                     VARCHAR(64),
  notes                       TEXT,
  -- Optional cross-domain linkage (nullable; no telecom data pulled through)
  linked_client_profile_id    INTEGER       REFERENCES client_profiles(id)   ON DELETE SET NULL,
  linked_canonical_vendor_id  INTEGER       REFERENCES canonical_vendors(id) ON DELETE SET NULL,
  -- Audit
  created_by                  VARCHAR(128),
  created_at                  TIMESTAMP     NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMP     NOT NULL DEFAULT NOW(),
  deleted_at                  TIMESTAMP                                      -- NULL = active
);

-- Indexes — business_partners
CREATE INDEX IF NOT EXISTS idx_bp_name       ON business_partners (name);
CREATE INDEX IF NOT EXISTS idx_bp_type       ON business_partners (type);
CREATE INDEX IF NOT EXISTS idx_bp_status     ON business_partners (status);
CREATE INDEX IF NOT EXISTS idx_bp_deleted_at ON business_partners (deleted_at) WHERE deleted_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: vendor_bills
-- AP invoices received from vendors. Status and approval_status are separate
-- axes: status tracks lifecycle, approval_status tracks the approval audit trail.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vendor_bills (
  id                   SERIAL PRIMARY KEY,
  bill_number          VARCHAR(64)    NOT NULL UNIQUE,  -- VB-YYYY-NNNN; DRAFT-{uuid} until submitted
  business_partner_id  INTEGER        NOT NULL REFERENCES business_partners(id) ON DELETE RESTRICT,
  vendor_reference     VARCHAR(128),                    -- vendor's own invoice/reference number
  bill_date            DATE           NOT NULL,
  due_date             DATE           NOT NULL,
  currency             VARCHAR(8)     NOT NULL DEFAULT 'USD',
  subtotal             NUMERIC(14,4)  NOT NULL DEFAULT 0,
  tax_amount           NUMERIC(14,4)  NOT NULL DEFAULT 0,
  total                NUMERIC(14,4)  NOT NULL DEFAULT 0,
  outstanding          NUMERIC(14,4)  NOT NULL DEFAULT 0,
  status               VARCHAR(32)    NOT NULL DEFAULT 'draft',
    -- draft | submitted | under_review | approved | partially_paid | paid | disputed | void
  approval_status      VARCHAR(32)    NOT NULL DEFAULT 'pending',
    -- pending | approved | rejected
  attachment_url       TEXT,
  notes                TEXT,
  -- Audit
  created_by           VARCHAR(128),
  approved_by          VARCHAR(128),
  approved_at          TIMESTAMP,
  created_at           TIMESTAMP      NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMP      NOT NULL DEFAULT NOW(),
  deleted_at           TIMESTAMP                                             -- NULL = active

  -- Constraints
  ,CONSTRAINT chk_vb_total_positive      CHECK (total      >= 0)
  ,CONSTRAINT chk_vb_outstanding_bounded CHECK (outstanding >= 0 AND outstanding <= total)
  ,CONSTRAINT chk_vb_due_after_bill      CHECK (due_date   >= bill_date)
);

-- Indexes — vendor_bills
CREATE INDEX IF NOT EXISTS idx_vb_partner    ON vendor_bills (business_partner_id);
CREATE INDEX IF NOT EXISTS idx_vb_status     ON vendor_bills (status);
CREATE INDEX IF NOT EXISTS idx_vb_approval   ON vendor_bills (approval_status);
CREATE INDEX IF NOT EXISTS idx_vb_bill_date  ON vendor_bills (bill_date DESC);
CREATE INDEX IF NOT EXISTS idx_vb_due_date   ON vendor_bills (due_date);
CREATE INDEX IF NOT EXISTS idx_vb_deleted_at ON vendor_bills (deleted_at) WHERE deleted_at IS NULL;
-- bill_number already covered by the UNIQUE constraint; no separate index needed.

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: vendor_bill_lines
-- Line items for vendor_bills. Cascade-deleted with their parent bill.
-- No soft delete — lines follow their parent's lifecycle.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vendor_bill_lines (
  id              SERIAL PRIMARY KEY,
  vendor_bill_id  INTEGER        NOT NULL REFERENCES vendor_bills(id) ON DELETE CASCADE,
  line_number     INTEGER        NOT NULL,
  description     VARCHAR(512)   NOT NULL,
  quantity        NUMERIC(12,4)  NOT NULL DEFAULT 1,
  unit_price      NUMERIC(14,6)  NOT NULL DEFAULT 0,  -- higher precision before rounding
  amount          NUMERIC(14,4)  NOT NULL DEFAULT 0,  -- quantity × unit_price, rounded
  tax_rate        NUMERIC(6,4)   NOT NULL DEFAULT 0,  -- e.g. 0.0500 = 5 %
  tax_amount      NUMERIC(14,4)  NOT NULL DEFAULT 0,
  gl_code         VARCHAR(32),
  created_at      TIMESTAMP      NOT NULL DEFAULT NOW()

  ,CONSTRAINT chk_vbl_quantity_positive   CHECK (quantity   > 0)
  ,CONSTRAINT chk_vbl_unit_price_positive CHECK (unit_price >= 0)
  ,CONSTRAINT chk_vbl_tax_rate_bounded    CHECK (tax_rate   >= 0 AND tax_rate <= 1)
  ,CONSTRAINT uq_vbl_line_number          UNIQUE (vendor_bill_id, line_number)
);

-- Indexes — vendor_bill_lines
CREATE INDEX IF NOT EXISTS idx_vbl_bill_id ON vendor_bill_lines (vendor_bill_id);

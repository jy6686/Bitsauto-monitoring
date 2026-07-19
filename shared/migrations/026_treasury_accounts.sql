-- ============================================================
-- Migration 026: Treasury Accounts
-- CAP-003 Phase 4 — Treasury, Sprint T1
--
-- Generic treasury account abstraction covering:
--   bank     — traditional bank accounts (current, savings, etc.)
--   wallet   — crypto/stablecoin wallets (custodial or on-chain)
--   cash     — petty cash or cash-in-hand accounts
--   escrow   — escrowed funds
--
-- Bank Accounts and Wallets are filtered UI views of this table.
-- Payment Runs, Bank Reconciliation and Cash Position all
-- reference treasury_account_id rather than type-specific FKs.
-- ============================================================

CREATE TABLE IF NOT EXISTS treasury_accounts (
  id                  SERIAL PRIMARY KEY,

  -- Identity
  account_number      VARCHAR(30)  UNIQUE NOT NULL,   -- TA-YYYY-NNNN
  name                VARCHAR(255) NOT NULL,
  type                VARCHAR(20)  NOT NULL DEFAULT 'bank'
                      CHECK (type IN ('bank','wallet','cash','escrow')),

  -- Wallet-specific: how the asset is held
  custody_type        VARCHAR(20)
                      CHECK (custody_type IN ('custodial','on_chain') OR custody_type IS NULL),

  -- Currency / instrument
  currency            VARCHAR(10)  NOT NULL DEFAULT 'USD',

  -- Institution / counter-party
  institution_name    VARCHAR(255),                   -- bank name or exchange name (Binance, OKX…)

  -- Account identifier: account number, IBAN, or wallet address
  account_identifier  VARCHAR(500),

  -- Blockchain network (on-chain wallets only): TRC20, ERC20, BEP20, SOL, etc.
  network             VARCHAR(50),

  -- Balances
  opening_balance     NUMERIC(14,4) NOT NULL DEFAULT 0,
  current_balance     NUMERIC(14,4) NOT NULL DEFAULT 0,

  -- Flags
  is_default          BOOLEAN NOT NULL DEFAULT FALSE,
  status              VARCHAR(20)  NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','inactive','frozen')),

  -- Metadata
  notes               TEXT,

  -- Audit
  created_by          VARCHAR(255) NOT NULL,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

-- Indexes (all partial on active records)
CREATE INDEX IF NOT EXISTS idx_ta_type           ON treasury_accounts (type)         WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ta_status         ON treasury_accounts (status)       WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ta_currency       ON treasury_accounts (currency)     WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ta_custody_type   ON treasury_accounts (custody_type) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ta_is_default     ON treasury_accounts (is_default)   WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ta_deleted_at     ON treasury_accounts (deleted_at);

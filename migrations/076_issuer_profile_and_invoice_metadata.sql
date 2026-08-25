-- 076_issuer_profile_and_invoice_metadata.sql
--
-- Completes the issuer profile (075) into the one object every invoice,
-- email and future statement reads, and gives invoices the two things an
-- audit of the live code showed they lack:
--
--   1. A due date. The `invoices` table had none, so the Finance Cockpit's
--      "overdue" KPI compared against a field that never existed and reported
--      zero forever. Populated at generation from the shared terms rule;
--      NULLABLE because an unconfigured profile must read as unconfigured.
--
--   2. A UNIQUE invoice number. Three generation sites shared one global
--      count(*)+1 counter with no constraint — two concurrent generations
--      could mint the same number and the database accepted it silently.
--      Existing duplicates (if any) are suffixed -DUP<id> keeping the oldest
--      row untouched, then the unique index goes on. Numbers already issued
--      to customers are never rewritten: the oldest bearer keeps the number.
--
-- Invoice metadata (number format, decimals, date format, footer text) is
-- configuration, not code, so customer formatting requests stop requiring a
-- renderer change. All columns nullable; the renderer states its defaults.

BEGIN;

-- ── Issuer identity, completed ────────────────────────────────────────────────
ALTER TABLE settings ADD COLUMN IF NOT EXISTS billing_trading_name        VARCHAR(256);
ALTER TABLE settings ADD COLUMN IF NOT EXISTS billing_registration_number VARCHAR(64);
ALTER TABLE settings ADD COLUMN IF NOT EXISTS billing_vat_number          VARCHAR(64);
ALTER TABLE settings ADD COLUMN IF NOT EXISTS billing_support_email       VARCHAR(255);
ALTER TABLE settings ADD COLUMN IF NOT EXISTS billing_dispute_email       VARCHAR(255);

-- Commercial defaults. billing_default_payment_term is a DELIBERATE default a
-- finance user configures ("our standard terms are Net 30") — distinct from
-- the code inventing 30. Precedence stays: company > partner > this > nothing.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS billing_default_payment_term VARCHAR(32);
ALTER TABLE settings ADD COLUMN IF NOT EXISTS billing_default_currency     VARCHAR(8);

-- ── Remittance, completed ─────────────────────────────────────────────────────
ALTER TABLE settings ADD COLUMN IF NOT EXISTS remit_bank_branch        VARCHAR(256);
ALTER TABLE settings ADD COLUMN IF NOT EXISTS remit_correspondent_bank VARCHAR(256);

-- ── Invoice document metadata ─────────────────────────────────────────────────
-- invoice_number_format tokens: {PREFIX} {YYYY} {YY} {MM} {SEQ:n}.
-- Unset → the renderer's stated default '{PREFIX}-{YY}{MM}-{SEQ:4}', prefix 'C',
-- which reproduces the dominant existing series exactly.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS invoice_number_prefix  VARCHAR(16);
ALTER TABLE settings ADD COLUMN IF NOT EXISTS invoice_number_format  VARCHAR(64);
ALTER TABLE settings ADD COLUMN IF NOT EXISTS invoice_decimal_places INTEGER;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS invoice_date_format    VARCHAR(16);
ALTER TABLE settings ADD COLUMN IF NOT EXISTS invoice_footer_note    TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS invoice_terms_note     TEXT;

-- ── Invoices: the due date that never existed ─────────────────────────────────
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS due_date            DATE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_terms_label VARCHAR(64);

-- ── Invoices: number uniqueness ───────────────────────────────────────────────
-- Suffix later duplicates before constraining. The oldest row keeps its
-- number: it was issued first and may already be in a customer's hands.
DO $$
DECLARE n integer;
BEGIN
  UPDATE invoices i
     SET invoice_number = i.invoice_number || '-DUP' || i.id
   WHERE EXISTS (
     SELECT 1 FROM invoices e
      WHERE e.invoice_number = i.invoice_number AND e.id < i.id);
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN
    RAISE NOTICE '076: % duplicate invoice number(s) suffixed -DUP<id>; oldest bearer kept each number.', n;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_invoice_number ON invoices (invoice_number);

DO $$
BEGIN
  RAISE NOTICE '076: issuer profile completed, invoice metadata config added, invoices.due_date added, invoice_number now UNIQUE.';
END $$;

COMMIT;

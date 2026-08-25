-- 075_company_billing_profile.sql
--
-- One authoritative record of who issues the invoice and how to pay it.
--
-- Invoices need the issuer's legal identity and remittance details, and neither
-- existed anywhere. company_bank_accounts and business_partners both hold the
-- COUNTERPARTY's banking — a customer's or a vendor's — so an invoice reading
-- from either would print somebody else's account. Until now the issuer's name
-- and address were literals inside the renderer, and there were no payment
-- instructions at all.
--
-- Held on settings because there is exactly one issuing company, and every
-- invoice must read the same values. Nullable throughout: an unconfigured
-- profile makes the invoice say so rather than print a blank cheque.

BEGIN;

-- Legal identity of the issuer
ALTER TABLE settings ADD COLUMN IF NOT EXISTS billing_legal_name       VARCHAR(256);
ALTER TABLE settings ADD COLUMN IF NOT EXISTS billing_registered_address TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS billing_tax_id           VARCHAR(64);
ALTER TABLE settings ADD COLUMN IF NOT EXISTS billing_contact_email    VARCHAR(255);
ALTER TABLE settings ADD COLUMN IF NOT EXISTS billing_website          VARCHAR(255);

-- Remittance
ALTER TABLE settings ADD COLUMN IF NOT EXISTS remit_beneficiary_name   VARCHAR(256);
ALTER TABLE settings ADD COLUMN IF NOT EXISTS remit_bank_name          VARCHAR(256);
ALTER TABLE settings ADD COLUMN IF NOT EXISTS remit_bank_address       TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS remit_account_number     VARCHAR(64);
ALTER TABLE settings ADD COLUMN IF NOT EXISTS remit_iban               VARCHAR(64);
ALTER TABLE settings ADD COLUMN IF NOT EXISTS remit_swift              VARCHAR(32);
ALTER TABLE settings ADD COLUMN IF NOT EXISTS remit_currency           VARCHAR(8);
ALTER TABLE settings ADD COLUMN IF NOT EXISTS remit_notes              TEXT;

DO $$
BEGIN
  RAISE NOTICE '075: issuer billing profile + remittance columns ensured (all nullable).';
END $$;

COMMIT;

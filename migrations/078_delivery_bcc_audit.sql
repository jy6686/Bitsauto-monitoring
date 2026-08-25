-- 078_delivery_bcc_audit.sql
--
-- 077 introduced real BCC delivery on invoice emails (issuer's blind copies).
-- A blind copy the audit log doesn't record is a delivery that officially
-- never happened — the review that caught this is right that every address
-- an invoice went to must be reconstructable from the delivery row.

BEGIN;

ALTER TABLE invoice_email_deliveries ADD COLUMN IF NOT EXISTS bcc_addresses TEXT DEFAULT '[]';

DO $$
BEGIN
  RAISE NOTICE '078: invoice_email_deliveries.bcc_addresses ensured — BCC deliveries are now audited.';
END $$;

COMMIT;

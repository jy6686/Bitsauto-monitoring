-- 067_delivery_smtp_lineage.sql
--
-- Complete the invoice email audit lineage (Finance R1, verification
-- scenario 8): Invoice → Job → Delivery → SMTP response → Message-ID.
-- invoice_email_deliveries recorded status and error but not what the SMTP
-- server actually said, so a delivery could not be traced to a provider-side
-- message. Nodemailer returns both on every send; now they are kept.

BEGIN;

ALTER TABLE invoice_email_deliveries ADD COLUMN IF NOT EXISTS message_id VARCHAR(256);
ALTER TABLE invoice_email_deliveries ADD COLUMN IF NOT EXISTS smtp_response VARCHAR(512);

DO $$ BEGIN RAISE NOTICE '067: delivery SMTP lineage columns ensured.'; END $$;

COMMIT;

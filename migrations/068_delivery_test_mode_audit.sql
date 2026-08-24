-- 068_delivery_test_mode_audit.sql
--
-- Test-mode redirection must be first-class in the delivery audit (owner spec):
-- Original Recipient | Actual Recipient | Test Mode | SMTP Response | Message-ID.
-- Until now a redirected send logged only the test mailbox, with the intended
-- client addresses buried in body text — unqueryable. Now the row itself says
-- who SHOULD have received the invoice and that the redirect happened.

BEGIN;

ALTER TABLE invoice_email_deliveries ADD COLUMN IF NOT EXISTS test_mode BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE invoice_email_deliveries ADD COLUMN IF NOT EXISTS intended_recipients TEXT;

DO $$ BEGIN RAISE NOTICE '068: delivery test-mode audit columns ensured.'; END $$;

COMMIT;

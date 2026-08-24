-- 066_invoice_email_test_mode.sql
--
-- Invoice Email Test Mode (Finance sprint R1 safety net).
--
-- While the new dispatch pipeline is validated, Finance needs to run the FULL
-- flow — approve, send, attachment, delivery log, retry — without any risk of
-- a real customer receiving a test invoice. With test mode ON, every invoice
-- email is redirected to the configured test mailbox, the subject is prefixed
-- [TEST], and the body names the intended recipients that were NOT used.
--
-- Default OFF: the manual send path is live in production today, and flipping
-- its behaviour by migration would silently reroute real operator sends. The
-- operator turns test mode on deliberately, in Settings → Invoice Email
-- Delivery, and off again after validation.

BEGIN;

ALTER TABLE settings ADD COLUMN IF NOT EXISTS invoice_email_test_mode BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS invoice_email_test_recipient VARCHAR(255);

DO $$
BEGIN
  RAISE NOTICE '066: invoice email test mode columns ensured (default OFF).';
END $$;

COMMIT;

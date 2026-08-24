-- 069_delivery_sender_identity.sql
--
-- Record WHICH sender identity delivered each invoice email.
--
-- invoice_email_deliveries captured the recipient side in full (actual,
-- intended, test mode, Message-ID, SMTP response) but never the From address
-- the message was actually sent as. That matters for two reasons:
--
--   * The transporter falls back to the alert Gmail account when dedicated
--     invoice SMTP is incomplete, silently changing the sender identity. The
--     audit row gave no way to tell which path a delivery took.
--   * CAP-003 acceptance requires evidencing the sender alongside the
--     recipient, so a controlled run can prove the mail left under the
--     intended identity and not a fallback.
--
-- Stored as the full RFC 5322 From value ("Display Name" <address>) — the
-- exact string handed to the SMTP server, not a reconstruction.
--
-- Nullable with no default: rows written before this migration genuinely do
-- not know their sender, and backfilling a guess would fabricate audit
-- evidence.

BEGIN;

ALTER TABLE invoice_email_deliveries ADD COLUMN IF NOT EXISTS sender VARCHAR(320);

DO $$
BEGIN
  RAISE NOTICE '069: invoice_email_deliveries.sender ensured (nullable, no backfill).';
END $$;

COMMIT;

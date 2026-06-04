-- Migration 028: OTP retry scheduling + Flow verification columns on sms_messages
-- retry_count / next_retry_at support automatic retry scheduling.
-- flow_token / verified_at support Meta WhatsApp Flow OTP verification.

ALTER TABLE sms_messages
  ADD COLUMN IF NOT EXISTS retry_count   INTEGER   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS flow_token    VARCHAR(64),
  ADD COLUMN IF NOT EXISTS verified_at   TIMESTAMP;

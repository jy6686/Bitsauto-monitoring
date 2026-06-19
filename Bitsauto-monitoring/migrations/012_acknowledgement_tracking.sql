-- Layer 7C: Acknowledgement Tracking — commercial defensibility infrastructure
-- Adds email tracking (opened_at) and acknowledgement (acknowledged_at) to notification recipients.
-- tracking_token is auto-generated UUID per recipient — used for pixel tracking and acknowledge endpoint.
-- Run via: psql $DATABASE_URL -f migrations/012_acknowledgement_tracking.sql

BEGIN;

ALTER TABLE commercial_notification_recipients
  ADD COLUMN IF NOT EXISTS tracking_token VARCHAR(64) UNIQUE DEFAULT (gen_random_uuid()::text),
  ADD COLUMN IF NOT EXISTS opened_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS open_count      INTEGER NOT NULL DEFAULT 0;

-- Backfill existing rows that have no token
UPDATE commercial_notification_recipients
  SET tracking_token = gen_random_uuid()::text
  WHERE tracking_token IS NULL;

CREATE INDEX IF NOT EXISTS idx_cnr_tracking_token
  ON commercial_notification_recipients (tracking_token)
  WHERE tracking_token IS NOT NULL;

COMMENT ON COLUMN commercial_notification_recipients.tracking_token IS
  'UUID token embedded in tracking pixel URL. Unique per recipient row.';
COMMENT ON COLUMN commercial_notification_recipients.opened_at IS
  'Timestamp of first email open (via 1x1 tracking pixel hit).';
COMMENT ON COLUMN commercial_notification_recipients.acknowledged_at IS
  'Timestamp of explicit acknowledgement by recipient (via acknowledge endpoint).';
COMMENT ON COLUMN commercial_notification_recipients.open_count IS
  'Total number of times the tracking pixel was loaded.';

COMMIT;

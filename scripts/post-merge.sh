#!/bin/bash
set -e
npm install
# Use direct SQL for schema migrations — db:push is interactive and times out.
# Add new ALTER TABLE statements here as new tasks land.
psql "$DATABASE_URL" -c "
  -- Task #1: WhatsApp OTP & Messaging Channel
  ALTER TABLE sms_messages
    ADD COLUMN IF NOT EXISTS channel VARCHAR(16) DEFAULT 'sms',
    ADD COLUMN IF NOT EXISTS provider VARCHAR(32),
    ADD COLUMN IF NOT EXISTS fallback_from INTEGER REFERENCES sms_messages(id),
    ADD COLUMN IF NOT EXISTS latency_ms INTEGER;
  ALTER TABLE settings
    ADD COLUMN IF NOT EXISTS otp_channel_policy TEXT;
  -- Task #2: WhatsApp OTP retry intelligence
  ALTER TABLE sms_messages
    ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;
" 2>&1 || true

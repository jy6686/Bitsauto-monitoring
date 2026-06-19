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

psql "$DATABASE_URL" -c "
  -- Task #33: Meta WhatsApp Flows — OTP Verification (Phase 1)
  ALTER TABLE settings
    ADD COLUMN IF NOT EXISTS meta_phone_number_id VARCHAR(64),
    ADD COLUMN IF NOT EXISTS meta_access_token VARCHAR(512),
    ADD COLUMN IF NOT EXISTS meta_flow_id VARCHAR(64),
    ADD COLUMN IF NOT EXISTS meta_waba_id VARCHAR(64),
    ADD COLUMN IF NOT EXISTS meta_flows_enabled BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS meta_flows_public_key TEXT;
" 2>&1 || true

psql "$DATABASE_URL" -c "
  -- Call Governance: AMI-triggered vendor BYE + replay engine
  CREATE TABLE IF NOT EXISTS call_governance_rules (
    id SERIAL PRIMARY KEY,
    connection_name VARCHAR(128) NOT NULL,
    channel_pattern VARCHAR(255),
    cap_sec INTEGER NOT NULL DEFAULT 120,
    jitter_sec INTEGER NOT NULL DEFAULT 15,
    enabled BOOLEAN NOT NULL DEFAULT false,
    action VARCHAR(32) NOT NULL DEFAULT 'cap_and_replay',
    scenario VARCHAR(32) NOT NULL DEFAULT 'time_cap',
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS governed_calls (
    id SERIAL PRIMARY KEY,
    unique_id VARCHAR(128),
    channel_a VARCHAR(255),
    channel_b VARCHAR(255),
    caller VARCHAR(64),
    callee VARCHAR(64),
    connection_name VARCHAR(128),
    rule_id INTEGER REFERENCES call_governance_rules(id),
    cap_sec INTEGER,
    start_time TIMESTAMP DEFAULT NOW(),
    bye_sent_at TIMESTAMP,
    playback_started_at TIMESTAMP,
    completed_at TIMESTAMP,
    recording_path VARCHAR(512),
    trigger_reason VARCHAR(64),
    status VARCHAR(32) NOT NULL DEFAULT 'active'
  );
  CREATE TABLE IF NOT EXISTS call_governance_log (
    id SERIAL PRIMARY KEY,
    governed_call_id INTEGER REFERENCES governed_calls(id),
    event_type VARCHAR(64) NOT NULL,
    channel VARCHAR(255),
    details TEXT,
    created_at TIMESTAMP DEFAULT NOW()
  );
" 2>&1 || true

-- Migration 025: Meta WhatsApp Flows columns on settings
-- Adds the WhatsApp Flows interactive OTP fields that were applied ad-hoc.

ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS meta_flow_id          VARCHAR(64),
  ADD COLUMN IF NOT EXISTS meta_waba_id          VARCHAR(64),
  ADD COLUMN IF NOT EXISTS meta_flows_enabled    BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS meta_flows_public_key TEXT;

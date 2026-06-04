-- Migration 030: Invoice SMTP + SIP error alert threshold on settings
-- These columns were defined in shared/schema.ts but never codified as a
-- numbered migration. Their absence caused getSettings() to fail and blocked
-- Sippy auto-connect on every startup in fresh environments.

ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS invoice_smtp_host         VARCHAR(255),
  ADD COLUMN IF NOT EXISTS invoice_smtp_port         INTEGER DEFAULT 587,
  ADD COLUMN IF NOT EXISTS invoice_smtp_secure       BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS invoice_smtp_user         VARCHAR(255),
  ADD COLUMN IF NOT EXISTS invoice_smtp_pass         VARCHAR(512),
  ADD COLUMN IF NOT EXISTS invoice_smtp_from_name    VARCHAR(255) DEFAULT 'Bitsauto Finance',
  ADD COLUMN IF NOT EXISTS invoice_smtp_from_email   VARCHAR(255),
  ADD COLUMN IF NOT EXISTS sip_error_alert_threshold REAL DEFAULT 15;

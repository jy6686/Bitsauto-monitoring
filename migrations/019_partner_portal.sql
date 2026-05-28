-- Partner Operations Portal
-- partner_profiles: maps an access code to a specific clientName in the system
-- Run via: psql $DATABASE_URL -f migrations/019_partner_portal.sql

BEGIN;

CREATE TABLE IF NOT EXISTS partner_profiles (
  id                   SERIAL PRIMARY KEY,
  client_name          VARCHAR(256)  NOT NULL,
  -- must exactly match clientName used across invoices, disputes, credit_notes
  company_display_name VARCHAR(256),
  contact_email        VARCHAR(256),
  access_code_hash     VARCHAR(256)  NOT NULL,
  -- bcrypt hash of the access code shown to the partner
  access_code_prefix   VARCHAR(8)    NOT NULL,
  -- first 4 chars of raw code for display/hint only
  logo_url             TEXT,
  welcome_message      TEXT,
  active               BOOLEAN       NOT NULL DEFAULT TRUE,
  last_login_at        TIMESTAMPTZ,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pp_client_name   ON partner_profiles (client_name);
CREATE INDEX        IF NOT EXISTS idx_pp_active        ON partner_profiles (active);
CREATE INDEX        IF NOT EXISTS idx_pp_contact_email ON partner_profiles (contact_email);

COMMENT ON TABLE partner_profiles IS
  'Partner portal access profiles — maps hashed access codes to a clientName for read-only portal access.';

COMMIT;

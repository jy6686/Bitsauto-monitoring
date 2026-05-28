-- Multi-Template Invoice Rendering
-- invoice_templates: per-client or global rendering/delivery rules
-- client_branding_profiles: branding, banking, payment terms per client
-- Run via: psql $DATABASE_URL -f migrations/015_invoice_templates_branding.sql

BEGIN;

CREATE TABLE IF NOT EXISTS invoice_templates (
  id                       SERIAL PRIMARY KEY,
  template_name            VARCHAR(256)  NOT NULL,
  template_type            VARCHAR(32)   NOT NULL DEFAULT 'standard',
  -- standard | prefix_breakdown | destination_summary | summary_only | white_label
  detail_level             VARCHAR(32)   NOT NULL DEFAULT 'full',
  -- full | summary | minimal
  client_name              VARCHAR(256),   -- NULL = global/default template
  show_prefix_breakdown    BOOLEAN       NOT NULL DEFAULT FALSE,
  show_destination_summary BOOLEAN       NOT NULL DEFAULT FALSE,
  show_call_level_details  BOOLEAN       NOT NULL DEFAULT FALSE,
  header_override          TEXT,
  footer_override          TEXT,
  filename_pattern         VARCHAR(256),  -- e.g. INV_{PERIOD}_{CLIENT}_{DATE}
  subject_line_pattern     VARCHAR(512),  -- e.g. Invoice {PERIOD} for {CLIENT}
  attach_pdf_enabled       BOOLEAN       NOT NULL DEFAULT TRUE,
  is_default               BOOLEAN       NOT NULL DEFAULT FALSE,
  branding_profile_id      INTEGER,
  created_at               TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS client_branding_profiles (
  id                   SERIAL PRIMARY KEY,
  client_name          VARCHAR(256),      -- NULL = global default
  company_name         VARCHAR(256),
  logo_url             TEXT,
  primary_color        VARCHAR(7),        -- hex #RRGGBB
  secondary_color      VARCHAR(7),
  banking_details      TEXT,              -- free-text banking block
  bank_name            VARCHAR(256),
  account_number       VARCHAR(128),
  iban                 VARCHAR(64),
  swift                VARCHAR(16),
  payment_terms_days   INTEGER           NOT NULL DEFAULT 30,
  payment_instructions TEXT,
  invoice_footer_text  TEXT,
  tax_id               VARCHAR(64),
  address_line1        VARCHAR(256),
  address_line2        VARCHAR(256),
  city                 VARCHAR(128),
  country              VARCHAR(64),
  created_at           TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ       NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_it_client_name  ON invoice_templates (client_name);
CREATE INDEX IF NOT EXISTS idx_it_is_default   ON invoice_templates (is_default);
CREATE INDEX IF NOT EXISTS idx_cbp_client_name ON client_branding_profiles (client_name);

COMMENT ON TABLE invoice_templates IS
  'Per-client or global invoice rendering templates. Controls detail level, branding, filename patterns, and email subject lines.';
COMMENT ON TABLE client_branding_profiles IS
  'Client branding and banking profiles for invoice rendering. Includes logo, colors, banking details, and payment terms.';

COMMIT;

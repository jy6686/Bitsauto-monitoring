-- 034_portal_module_overrides.sql
-- Phase 3: portal_module_overrides table + NOC domain additions + sealed seed.
--
-- Sources (frozen):
--   NAV-WORKSPACE-MODEL.md §5  — table shape: (portal_slug, module_key, visibility, reason)
--   NOC-WORKSPACE-SPEC.md      — sealed Phase 3 deliverable: intelligence + security
--                                domain assignments, 23 override rows (2 read-only, 21 hidden)
--
-- Visibility semantics: 'read-only' | 'hidden'; no row = operational (default).
-- hidden    → module absent from workspace navigation tree AND search index
-- read-only → module present with visibility flag passed to UI; edit authority elsewhere
--
-- Prerequisites: 031, 032, 033 applied (all module_keys kebab-case).
-- Idempotent: CREATE IF NOT EXISTS + ON CONFLICT upserts; re-run is safe.

BEGIN;

-- ── 1. Table (frozen shape) ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS portal_module_overrides (
  portal_slug TEXT NOT NULL REFERENCES portal_definitions(slug)        ON DELETE CASCADE,
  module_key  TEXT NOT NULL REFERENCES navigation_modules(module_key)  ON DELETE CASCADE,
  visibility  TEXT NOT NULL CHECK (visibility IN ('read-only', 'hidden')),
  reason      TEXT NOT NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (portal_slug, module_key)
);

-- ── 2. Pre-flight: required domains must exist ────────────────────────────────
DO $$
BEGIN
  IF (SELECT COUNT(*) FROM navigation_domains WHERE id IN ('intelligence','security')) <> 2 THEN
    RAISE EXCEPTION 'missing navigation_domains: intelligence and/or security — run 031 first';
  END IF;
END $$;

-- ── 3. NOC domain additions (sealed spec) ─────────────────────────────────────
INSERT INTO portal_domain_assignments (portal_slug, domain_id, display_order) VALUES
  ('noc', 'intelligence', 5),
  ('noc', 'security',     6)
ON CONFLICT (portal_slug, domain_id) DO NOTHING;

-- ── 4. Pre-seed validation: every override key must resolve ───────────────────
-- (The FK also enforces this; this block reports ALL dangling keys at once
--  instead of failing on the first insert.)
DO $$
DECLARE
  dangling TEXT;
BEGIN
  SELECT string_agg(o.module_key, ', ') INTO dangling
  FROM (VALUES
    ('routing-manager'), ('call-recordings'), ('call-governance'), ('auth-studio'),
    ('comm-policies'), ('commercial-notifications'), ('sender-profiles'),
    ('executive-reports'), ('revenue-heatmap'), ('cdr-rerate'), ('codec-analytics'),
    ('cost-optimisation'), ('intelligence-validation'), ('route-optimisation'),
    ('simulation-sandbox'), ('number-intelligence'), ('stir-shaken'),
    ('approvals'), ('approval-settings'), ('rbac'), ('mfa-setup'),
    ('compliance'), ('audit-log')
  ) AS o(module_key)
  LEFT JOIN navigation_modules m ON m.module_key = o.module_key
  WHERE m.module_key IS NULL;

  IF dangling IS NOT NULL THEN
    RAISE EXCEPTION 'dangling override key(s) — not in navigation_modules: %', dangling;
  END IF;
END $$;

-- ── 5. Sealed seed (23 rows: 2 read-only, 21 hidden) ──────────────────────────
INSERT INTO portal_module_overrides (portal_slug, module_key, visibility, reason) VALUES
  -- read-only: visible in nav and search; edit controls deferred to IAM/permissions program
  ('noc', 'routing-manager',          'read-only', 'NOC needs routing group visibility; edit authority stays with Operations team'),
  ('noc', 'call-recordings',          'read-only', 'NOC uses for disputed-call verification; manage authority stays with Compliance'),
  -- hidden: absent from nav tree AND search index
  ('noc', 'call-governance',          'hidden', 'Owner confirmed: not for NOC portal'),
  ('noc', 'auth-studio',              'hidden', 'Provisioning tool; not a NOC task'),
  ('noc', 'comm-policies',            'hidden', 'Admin alert-routing config; not NOC'),
  ('noc', 'commercial-notifications', 'hidden', 'Billing notification queue; Finance/Billing scope'),
  ('noc', 'sender-profiles',          'hidden', 'SMTP identity admin; not NOC'),
  ('noc', 'executive-reports',        'hidden', 'C-suite reporting; not a NOC surface'),
  ('noc', 'revenue-heatmap',          'hidden', 'Revenue visualisation; Finance scope'),
  ('noc', 'cdr-rerate',               'hidden', 'CDR re-rate engine; Finance/Revenue Assurance scope'),
  ('noc', 'codec-analytics',          'hidden', 'Not daily NOC; quality RCA covered by BitsEye 2.0 and RTP/MOS'),
  ('noc', 'cost-optimisation',        'hidden', 'Route cost engine; commercial scope, not NOC'),
  ('noc', 'intelligence-validation',  'hidden', 'Data quality/trust scoring; data-engineering scope, not L1 NOC'),
  ('noc', 'route-optimisation',       'hidden', 'Advisory carrier recommendations; Ops scope'),
  ('noc', 'simulation-sandbox',       'hidden', 'Traffic shift modelling; analyst scope'),
  ('noc', 'number-intelligence',      'hidden', 'Number-level analysis; not core NOC'),
  ('noc', 'stir-shaken',              'hidden', 'STIR/SHAKEN attestation; compliance scope, not daily NOC'),
  ('noc', 'approvals',                'hidden', 'Approval queue; governance admin, not NOC'),
  ('noc', 'approval-settings',        'hidden', 'Approval rule config; admin scope'),
  ('noc', 'rbac',                     'hidden', 'Permission matrix; Platform admin scope'),
  ('noc', 'mfa-setup',                'hidden', 'MFA setup; Platform admin scope'),
  ('noc', 'compliance',               'hidden', 'Regulatory compliance; Legal/Compliance scope'),
  ('noc', 'audit-log',                'hidden', 'Platform audit trail; admin scope')
ON CONFLICT (portal_slug, module_key) DO UPDATE SET
  visibility = EXCLUDED.visibility,
  reason     = EXCLUDED.reason;

-- ── 6. Verify ─────────────────────────────────────────────────────────────────
DO $$
DECLARE
  total INT; ro INT; hid INT; noc_domains INT;
BEGIN
  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE visibility = 'read-only'),
         COUNT(*) FILTER (WHERE visibility = 'hidden')
    INTO total, ro, hid
    FROM portal_module_overrides WHERE portal_slug = 'noc';

  SELECT COUNT(*) INTO noc_domains
    FROM portal_domain_assignments WHERE portal_slug = 'noc';

  IF total <> 23 OR ro <> 2 OR hid <> 21 THEN
    RAISE EXCEPTION 'override seed mismatch: total=% (want 23), read-only=% (want 2), hidden=% (want 21)', total, ro, hid;
  END IF;

  IF noc_domains <> 6 THEN
    RAISE EXCEPTION 'noc domain assignments=% (want 6: live-network, operations, telemetry, analytics, intelligence, security)', noc_domains;
  END IF;
END $$;

COMMIT;

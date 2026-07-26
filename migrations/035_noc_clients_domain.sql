-- 035_noc_clients_domain.sql
-- Adds the Clients domain (domain_id 'company') to the NOC portal's workspace nav.
--
-- Background: NOC-WORKSPACE-SPEC.md (sealed 2026-07-24) originally classified Clients
-- as REMOVE ("KAM/Sales scope, not NOC"). That decision has been revisited and Clients
-- is now in scope for NOC. See NOC-WORKSPACE-SPEC.md addendum (2026-07-26) for the
-- updated Test 1 domain table.
--
-- Scope of this migration: ONLY the Clients (company) domain assignment. The 23
-- existing portal_module_overrides rows from migration 034 (Auth Studio, Compliance,
-- STIR/SHAKEN, Approvals, etc.) are untouched — those exclusions were not revisited
-- and remain in force.
--
-- Submenu scope: matched to the live main-platform Clients cascade (verified via
-- screenshot, not the full DOMAINS[] source list) — 8 of the 11 company-domain
-- modules. 3 modules that exist in navigation_modules but are not part of the
-- live main-platform cascade are hidden for NOC: client_portal, reseller, dids.
--
-- Prerequisites: 031, 032, 033, 034 applied.
-- Idempotent: ON CONFLICT DO NOTHING / DO UPDATE; re-run is safe.

BEGIN;

-- ── 1. Pre-flight: company domain must exist ──────────────────────────────────
DO $$
BEGIN
  IF (SELECT COUNT(*) FROM navigation_domains WHERE id = 'company') <> 1 THEN
    RAISE EXCEPTION 'missing navigation_domains row: company — run 031 first';
  END IF;
END $$;

-- ── 2. NOC domain addition ────────────────────────────────────────────────────
INSERT INTO portal_domain_assignments (portal_slug, domain_id, display_order) VALUES
  ('noc', 'company', 7)
ON CONFLICT (portal_slug, domain_id) DO NOTHING;

-- ── 3. Hide the 3 modules not present in the live main-platform Clients cascade ─
INSERT INTO portal_module_overrides (portal_slug, module_key, visibility, reason) VALUES
  ('noc', 'client_portal', 'hidden', 'Not part of the live main-platform Clients cascade'),
  ('noc', 'reseller',      'hidden', 'Not part of the live main-platform Clients cascade'),
  ('noc', 'dids',          'hidden', 'Not part of the live main-platform Clients cascade')
ON CONFLICT (portal_slug, module_key) DO UPDATE SET
  visibility = EXCLUDED.visibility,
  reason     = EXCLUDED.reason;

-- ── 4. Verify ──────────────────────────────────────────────────────────────────
DO $$
DECLARE
  noc_domains INT;
  company_modules INT;
  company_hidden INT;
BEGIN
  SELECT COUNT(*) INTO noc_domains
    FROM portal_domain_assignments WHERE portal_slug = 'noc';

  IF noc_domains <> 7 THEN
    RAISE EXCEPTION 'noc domain assignments=% (want 7: live-network, operations, telemetry, analytics, intelligence, security, company)', noc_domains;
  END IF;

  SELECT COUNT(*) INTO company_modules
    FROM navigation_modules WHERE domain_id = 'company';

  IF company_modules <> 11 THEN
    RAISE EXCEPTION 'company domain module count=% (want 11)', company_modules;
  END IF;

  SELECT COUNT(*) INTO company_hidden
    FROM portal_module_overrides
    WHERE portal_slug = 'noc' AND visibility = 'hidden'
      AND module_key IN ('client_portal', 'reseller', 'dids');

  IF company_hidden <> 3 THEN
    RAISE EXCEPTION 'company hidden overrides=% (want 3: client_portal, reseller, dids)', company_hidden;
  END IF;
END $$;

COMMIT;

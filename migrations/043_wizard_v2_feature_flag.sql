-- 043_wizard_v2_feature_flag.sql
-- Onboarding 2.0 — Sprint 2.1 rollout switch.
--
-- Registers the Customer Preparation Wizard 2.0 behind the EXISTING platform flag
-- mechanism (platform_feature_flags + GET /api/platform/flags) rather than a new one.
--
-- Default FALSE: /client-wizard keeps serving the production-certified legacy wizard
-- until an admin turns this on. The freeze was lifted under Exit Criterion 3 for the
-- redesign, not for an unannounced swap of a live workflow.
-- Idempotent.

BEGIN;

INSERT INTO platform_feature_flags (key, enabled, owner_role, reason)
VALUES (
  'customer_preparation_wizard_v2',
  FALSE,
  'admin',
  'Onboarding 2.0 Sprint 2.1 — serves the Customer Preparation Wizard at /client-wizard. OFF until validated; legacy wizard remains the fallback.'
)
ON CONFLICT (key) DO NOTHING;

DO $$
DECLARE ok BOOLEAN;
BEGIN
  SELECT enabled INTO ok FROM platform_feature_flags WHERE key = 'customer_preparation_wizard_v2';
  IF ok IS NULL THEN
    RAISE EXCEPTION 'customer_preparation_wizard_v2 flag was not registered';
  END IF;
  -- Deliberately NOT asserting FALSE: if an admin has already enabled it, re-running
  -- this migration must not silently switch a live workflow back off.
END $$;

COMMIT;

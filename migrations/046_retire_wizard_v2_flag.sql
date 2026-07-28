-- 046_retire_wizard_v2_flag.sql
-- Retires customer_preparation_wizard_v2.
--
-- The v2 parallel wizard and its flag switch were removed 2026-07-28: the remaining work
-- is wiring the existing wizard to configuration the backend already resolves, not
-- maintaining a second UI. Nothing reads this flag any more.
--
-- A flag no code consults is worse than no flag: an operator can toggle it, observe no
-- effect, and reasonably conclude the feature is broken rather than absent.
-- Idempotent.

BEGIN;

DELETE FROM platform_feature_flags WHERE key = 'customer_preparation_wizard_v2';

DO $$
DECLARE remaining INTEGER;
BEGIN
  SELECT COUNT(*) INTO remaining FROM platform_feature_flags WHERE key = 'customer_preparation_wizard_v2';
  IF remaining > 0 THEN
    RAISE EXCEPTION 'customer_preparation_wizard_v2 flag still present';
  END IF;
END $$;

COMMIT;

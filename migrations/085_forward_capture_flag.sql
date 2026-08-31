-- 085_forward_capture_flag.sql
-- CAP-003 — move the unattended-collection arm off an environment variable.
--
-- WHY. Arming lived in process.env.FORWARD_CAPTURE, read once at boot. Ten
-- republishes were spent trying to arm it and every one returned observe_only:
-- on Replit a deployment's secrets are a DIFFERENT store from the workspace
-- Secrets that were being edited, so the deployed process never saw the value.
-- Confirmed 2026-08-31T18:29Z, envValueSeen = "(not set in this process)".
--
-- The variable was the wrong control surface regardless. It needs a republish
-- to change (forbidden while a seed import is running), it is invisible to the
-- operator, and it records nothing about who armed production data collection,
-- when, or why. This row does all three: platform_feature_flags already carries
-- prev_state / changed_by / changed_at / reason, and PATCH /api/platform/flags/:key
-- is already gated to admin + super_admin.
--
-- Default FALSE. Registering the switch is not arming it — the deployment keeps
-- observing until an operator deliberately turns this on. The environment
-- variable continues to work as an override; either source arms.
-- Idempotent.

BEGIN;

INSERT INTO platform_feature_flags (key, enabled, owner_role, reason)
VALUES (
  'forward_capture',
  FALSE,
  'super_admin',
  'CAP-003 forward capture — arms the nightly catch-up collector to actually fetch CDRs '
  || 'instead of only reporting what it would fetch. OFF until an operator arms it. '
  || 'Takes effect within one scheduler tick (10 min); no republish required.'
)
ON CONFLICT (key) DO NOTHING;

DO $$
DECLARE present BOOLEAN;
BEGIN
  SELECT TRUE INTO present FROM platform_feature_flags WHERE key = 'forward_capture';
  IF present IS NULL THEN
    RAISE EXCEPTION 'forward_capture flag was not registered';
  END IF;
  -- Deliberately NOT asserting FALSE: once an operator has armed collection, a
  -- re-run of this migration must never silently disarm it. The 043 precedent.
END $$;

COMMIT;

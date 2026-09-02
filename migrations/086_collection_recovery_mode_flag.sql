-- 086_collection_recovery_mode_flag.sql
-- CAP-003 — the audited override for the off-peak collection window.
--
-- WHY. Collection now starts only inside the 02:00–06:00 UTC window, because a
-- daytime fetch loads a switch carrying live calls: on 2026-09-02 an owed day
-- was pulled from Sippy between 15:46 and 17:08, through the business
-- afternoon. That rule is right for normal operation and wrong for an
-- exceptional one — after a multi-day outage, waiting for tonight can mean
-- waiting past the switch's own CDR retention, and unfetched CDRs that age out
-- are gone permanently.
--
-- So there is an override, and it is deliberately NOT automatic. A scheduler
-- that decides for itself when the load rule no longer applies has no rule at
-- all; the whole point is that a human accepts the daytime load on Sippy,
-- knowingly, for a stated reason. platform_feature_flags already records
-- prev_state / changed_by / changed_at / reason and PATCH
-- /api/platform/flags/:key is already gated to admin + super_admin, so
-- enabling this is auditable without building anything.
--
-- OPERATOR NOTE, and it is the reason this is a flag rather than a setting:
-- recovery mode should be turned OFF once the backlog is clear. Left on, it
-- silently reverts the platform to fetching at any hour, and the next person
-- to look will find daytime collection with no explanation of why it was
-- allowed. The reason field is where that explanation lives.
--
-- Default FALSE. Idempotent.

BEGIN;

INSERT INTO platform_feature_flags (key, enabled, owner_role, reason)
VALUES (
  'collection_recovery_mode',
  FALSE,
  'super_admin',
  'CAP-003 recovery mode — allows CDR collection to run OUTSIDE the 02:00–06:00 UTC '
  || 'off-peak window. For recovering a multi-day backlog after an outage, where waiting '
  || 'for the next window risks the switch ageing out CDRs that cannot then be recovered. '
  || 'Loads Sippy during business hours: turn OFF once the backlog is clear. '
  || 'Takes effect within one scheduler tick (10 min); no republish required.'
)
ON CONFLICT (key) DO NOTHING;

DO $$
DECLARE present BOOLEAN;
BEGIN
  SELECT TRUE INTO present FROM platform_feature_flags WHERE key = 'collection_recovery_mode';
  IF present IS NULL THEN
    RAISE EXCEPTION 'collection_recovery_mode flag was not registered';
  END IF;
  -- Not asserting FALSE, per the 085/043 precedent: a re-run must never
  -- silently change a state an operator deliberately set.
END $$;

COMMIT;

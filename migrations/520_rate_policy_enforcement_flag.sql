-- 520: the switch for the rate-change policy, created OFF.
--
-- The policy layer (migration 519, commit 5f514998) is wired into push-batch behind
-- platform_feature_flags.rate_policy_enforcement. Until now the row did not exist, and "off"
-- was an absence convention: the route reads no row and treats that as disabled. That is safe,
-- but it is not explicit. This row makes OFF a recorded fact — versioned here, owned, with a
-- reason — so that the flags UI can manage it and enabling it is a deliberate, attributed act on
-- an existing row rather than the creation of one.
--
-- Nothing changes commercially. The row is FALSE; the route behaves exactly as before.
-- Enabling it is the first point at which the policy can affect a real rate push, and is done
-- through the flags UI with a stated reason, never by migration.
BEGIN;

INSERT INTO platform_feature_flags (key, enabled, owner_role, reason)
VALUES (
  'rate_policy_enforcement',
  FALSE,
  'super_admin',
  'Rate-change policy enforcement on push-batch. When ON, every operation is evaluated per '
  || 'client and department against the CLIENT thresholds and that client''s own Sippy tariff '
  || 'before any Sippy write: violations are refused before write, unresolved questions are '
  || 'refused as undecided, and a client with no declared policy or no department is refused '
  || 'rather than guessed. When OFF, push-batch behaves as before the policy layer existed. '
  || 'Takes effect on the next push; no republish required.'
)
ON CONFLICT (key) DO NOTHING;

DO $$
DECLARE present BOOLEAN;
BEGIN
  SELECT TRUE INTO present FROM platform_feature_flags WHERE key = 'rate_policy_enforcement';
  IF present IS NULL THEN
    RAISE EXCEPTION 'rate_policy_enforcement flag was not registered';
  END IF;
END $$;

COMMIT;

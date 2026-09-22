-- 526: the switch for automatic rate-notification delivery, created OFF.
--
-- The drain (server/services/rates/rate-notification-auto.ts, commit b78a17ed) reads
-- platform_feature_flags.rate_notifications_auto after every certified push and on boot. Until
-- now the row did not exist, and "off" was an absence convention: the drain reads no row and
-- treats that as disabled. That is safe, but it is not explicit, and the audited flag route
-- (PATCH /api/platform/flags/:key) refuses to touch a row that does not exist. This row makes
-- OFF a recorded fact — versioned here, owned, with a reason — so that enabling it is a
-- deliberate, attributed act on an existing row rather than the creation of one.
--
-- Nothing is sent by this migration. The row is FALSE; the drain behaves exactly as before.
-- Enabling it is the first point at which a rate push emails a customer, and is done through
-- the flags route with a stated reason, never by migration — and only after the accumulated
-- pending obligations have been read and decided on, because the first enabled drain delivers
-- whatever is already owed, not merely the next push.
BEGIN;

INSERT INTO platform_feature_flags (key, enabled, owner_role, reason)
VALUES (
  'rate_notifications_auto',
  FALSE,
  'admin',
  'Automatic delivery of rate-change notifications to a company''s commercial and rates '
  || 'contacts after each certified Rate Manager push, and on boot for anything a restart left '
  || 'pending or failed. When OFF, obligations are recorded in rate_push_notifications and '
  || 'nothing is sent. When ON, each obligation is attempted at most five times and an exhausted '
  || 'one stays failed with its last error. Takes effect on the next push or boot; no republish '
  || 'required. Provisioning-time notifications and the manual resend are separate and unaffected.'
)
ON CONFLICT (key) DO NOTHING;

DO $$
DECLARE present BOOLEAN;
BEGIN
  SELECT TRUE INTO present FROM platform_feature_flags WHERE key = 'rate_notifications_auto';
  IF present IS NULL THEN
    RAISE EXCEPTION 'rate_notifications_auto flag was not registered';
  END IF;
END $$;

COMMIT;

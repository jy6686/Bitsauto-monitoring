-- 042_rename_welcome_rates_event.sql
-- Onboarding 2.0 — event naming.
--
-- 'default_rate_available' described an internal system state. By the time this fires the
-- customer is already provisioned and priced; what they receive is their initial price
-- list. Event keys are read by whoever configures the Communication Center, so they should
-- name the customer-facing communication, not our bookkeeping.
--
--   default_rate_available  →  customer_welcome_rates
--   rate_notification       →  customer_rate_update
--
-- Separate migration rather than an edit to 041: 041 may already be applied elsewhere,
-- and renaming in place would leave those environments on the old key.
-- Idempotent.

BEGIN;

-- SEED-THEN-RENAME IS NOT REPLAYABLE — this migration originally assumed the new keys
-- could not already exist, and skipped the rename when they did. That assumption broke on
-- 2026-07-29: 042 had been applied by hand, then the file runner replayed 039 and 041
-- from an empty ledger. Their `ON CONFLICT (event_key) DO NOTHING` guards only skip when
-- the OLD key is present, and 042 had renamed it away — so both old keys were re-seeded.
-- 042 then found the new keys already there, skipped, and its own verify correctly
-- refused with "2 stale rate event key(s) remain". Every later migration was halted
-- behind it, including 049, whose column the running code selects on every request.
--
-- A rename must therefore handle BOTH shapes: rename when the target is absent, and
-- DELETE the redundant old row when the target already exists. Delete-then-update gives
-- that in either order — one of the two statements always no-ops.

-- Subscriptions first: they carry event_key, and a row left pointing at a deleted route
-- is the orphan the verify block below refuses.
DELETE FROM notification_profile_events old
 USING notification_profile_events new
 WHERE old.event_key = 'default_rate_available'
   AND new.profile_id = old.profile_id
   AND new.event_key  = 'customer_welcome_rates';

UPDATE notification_profile_events SET event_key = 'customer_welcome_rates'
 WHERE event_key = 'default_rate_available';

DELETE FROM notification_profile_events old
 USING notification_profile_events new
 WHERE old.event_key = 'rate_notification'
   AND new.profile_id = old.profile_id
   AND new.event_key  = 'customer_rate_update';

UPDATE notification_profile_events SET event_key = 'customer_rate_update'
 WHERE event_key = 'rate_notification';

-- Routes: drop the stale row when the renamed one already exists, otherwise rename it.
DELETE FROM notification_event_routing
 WHERE event_key = 'default_rate_available'
   AND EXISTS (SELECT 1 FROM notification_event_routing r
                WHERE r.event_key = 'customer_welcome_rates');

UPDATE notification_event_routing
   SET event_key   = 'customer_welcome_rates',
       description = 'Initial price list issued to the customer at provisioning (OUTBOUND)'
 WHERE event_key = 'default_rate_available';

DELETE FROM notification_event_routing
 WHERE event_key = 'rate_notification'
   AND EXISTS (SELECT 1 FROM notification_event_routing r
                WHERE r.event_key = 'customer_rate_update');

UPDATE notification_event_routing
   SET event_key   = 'customer_rate_update',
       description = 'Negotiated price list sent from Rate Manager (OUTBOUND)'
 WHERE event_key = 'rate_notification';

-- Rate policy resolution, recorded so the indirection is not re-invented:
--   provisioning_profiles.rate_policy → rate_cards.name (card_type='client') → entries
-- Commercial replaces the standard sheet by pointing the policy at a different card.
COMMENT ON COLUMN provisioning_profiles.rate_policy IS
  'Rate policy name. Resolves to rate_cards.name where card_type=''client''. Commercial swaps the default sheet by changing which card the policy names — provisioning logic is never edited. If cards ever need swapping without renaming, add a rate_policies pointer table; do not hardcode a card id here.';

-- ── Verify ──────────────────────────────────────────────────────────────────
DO $$
DECLARE
  stale INTEGER;
  orph  INTEGER;
BEGIN
  SELECT COUNT(*) INTO stale FROM notification_event_routing
   WHERE event_key IN ('default_rate_available', 'rate_notification');
  IF stale > 0 THEN
    RAISE EXCEPTION '% stale rate event key(s) remain', stale;
  END IF;

  -- A subscription whose event has no route would be raised with nowhere to send from.
  SELECT COUNT(*) INTO orph FROM notification_profile_events e
   WHERE NOT EXISTS (SELECT 1 FROM notification_event_routing r WHERE r.event_key = e.event_key);
  IF orph > 0 THEN
    RAISE EXCEPTION '% notification_profile_events left without a sender route', orph;
  END IF;
END $$;

COMMIT;

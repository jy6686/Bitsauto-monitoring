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

UPDATE notification_event_routing
   SET event_key   = 'customer_welcome_rates',
       description = 'Initial price list issued to the customer at provisioning (OUTBOUND)'
 WHERE event_key = 'default_rate_available'
   AND NOT EXISTS (SELECT 1 FROM notification_event_routing WHERE event_key = 'customer_welcome_rates');

UPDATE notification_event_routing
   SET event_key   = 'customer_rate_update',
       description = 'Negotiated price list sent from Rate Manager (OUTBOUND)'
 WHERE event_key = 'rate_notification'
   AND NOT EXISTS (SELECT 1 FROM notification_event_routing WHERE event_key = 'customer_rate_update');

-- Keep the profile subscriptions pointing at the renamed events.
UPDATE notification_profile_events SET event_key = 'customer_welcome_rates'
 WHERE event_key = 'default_rate_available'
   AND NOT EXISTS (
     SELECT 1 FROM notification_profile_events x
      WHERE x.profile_id = notification_profile_events.profile_id
        AND x.event_key  = 'customer_welcome_rates');

UPDATE notification_profile_events SET event_key = 'customer_rate_update'
 WHERE event_key = 'rate_notification'
   AND NOT EXISTS (
     SELECT 1 FROM notification_profile_events x
      WHERE x.profile_id = notification_profile_events.profile_id
        AND x.event_key  = 'customer_rate_update');

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

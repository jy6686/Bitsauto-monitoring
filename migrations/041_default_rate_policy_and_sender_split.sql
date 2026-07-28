-- 041_default_rate_policy_and_sender_split.sql
-- Onboarding 2.0 — rate upload leaves the wizard; inbound/outbound rate senders split.
--
-- Two things this corrects or adds:
--
-- 1. SENDER SPLIT (corrects data seeded by 039).
--    039 routed rate_notification → 'rates'. That conflates two opposite directions:
--      rates@   = INBOUND  — vendor rate sheets arriving from suppliers
--      pricing@ = OUTBOUND — our approved price lists going to customers
--    A customer receiving their price list from rates@ would be replying into the
--    vendor-ingest mailbox.
--
-- 2. RATE POLICY. The wizard no longer collects rates at all. The provisioning engine
--    applies a default rate card at provision time, resolved through a POLICY NAME rather
--    than a literal card: replacing the standard wholesale rates then updates one row
--    instead of the engine.
--
-- Uses the existing rate_cards / rate_card_entries tables — a default rate sheet is a
-- rate card, not a new concept. Idempotent.

BEGIN;

-- ── 1. Sender split ─────────────────────────────────────────────────────────
UPDATE notification_event_routing
   SET communication_type = 'pricing',
       description        = 'Customer price list / rate update (OUTBOUND)'
 WHERE event_key = 'rate_notification';

INSERT INTO notification_event_routing (event_key, communication_type, description) VALUES
  ('default_rate_available', 'pricing', 'Default rate sheet issued at provisioning (OUTBOUND)'),
  ('vendor_rate_received',   'rates',   'Vendor rate sheet received from supplier (INBOUND)')
ON CONFLICT (event_key) DO NOTHING;

-- Roles for the new outbound event; inbound vendor mail has no customer recipient.
UPDATE notification_profile_events SET recipient_roles = 'kam,primary_contact'
 WHERE event_key = 'default_rate_available';

-- ── 2. Rate policy on the provisioning profile ──────────────────────────────
-- A policy NAME, not a rate-card id: the policy resolves to whichever card is current,
-- so replacing the standard wholesale rates never touches the profile or the engine.
ALTER TABLE provisioning_profiles
  ADD COLUMN IF NOT EXISTS rate_policy         VARCHAR(64),
  ADD COLUMN IF NOT EXISTS vendor_rate_policy  VARCHAR(64);

COMMENT ON COLUMN provisioning_profiles.rate_policy IS
  'Customer rate policy name (e.g. Standard Wholesale). Resolved to the current rate card at provision time — never a hardcoded card id.';

UPDATE provisioning_profiles SET rate_policy = 'Standard Wholesale' WHERE company_type = 'wholesale' AND rate_policy IS NULL;
UPDATE provisioning_profiles SET rate_policy = 'Standard Retail'    WHERE company_type = 'retail'    AND rate_policy IS NULL;

-- ── 3. Rate status on the company ───────────────────────────────────────────
-- Visible state instead of "were rates uploaded?":
--   default — provisioned with the standard sheet
--   custom  — a negotiated card assigned via Rate Manager
--   pending — a card prepared but not yet pushed to Sippy
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS rate_status VARCHAR(16) NOT NULL DEFAULT 'default';

-- ── 4. Default wholesale rate card (owner-supplied 2026-07-28) ──────────────
INSERT INTO rate_cards (vendor_name, name, card_type, currency)
SELECT 'BitsAuto', 'Standard Wholesale', 'client', 'USD'
 WHERE NOT EXISTS (SELECT 1 FROM rate_cards WHERE name = 'Standard Wholesale' AND card_type = 'client');

INSERT INTO rate_card_entries (rate_card_id, prefix, country, breakout, rate_per_min)
SELECT c.id, v.prefix, v.country, v.breakout, v.rate
  FROM (SELECT id FROM rate_cards WHERE name = 'Standard Wholesale' AND card_type = 'client' LIMIT 1) c
 CROSS JOIN (VALUES
  ('880',    'Bangladesh', 'BANGLADESH FIXED',              0.0200),
  ('88031',  'Bangladesh', 'BANGLADESH FIXED CHITTAGONG',   0.0200),
  ('8802',   'Bangladesh', 'BANGLADESH FIXED DHAKA',        0.0200),
  ('880821', 'Bangladesh', 'BANGLADESH FIXED SYLHET',       0.0200),
  ('8801',   'Bangladesh', 'BANGLADESH MOBILE',             0.0200),
  ('91',     'India',      'INDIA FIXED',                   0.0200),
  ('9160',   'India',      'INDIA MOBILE',                  0.0200),
  ('9162',   'India',      'INDIA MOBILE',                  0.0200),
  ('9163',   'India',      'INDIA MOBILE',                  0.0200),
  ('9168',   'India',      'INDIA MOBILE',                  0.0200),
  ('9169',   'India',      'INDIA MOBILE',                  0.0200),
  ('9170',   'India',      'INDIA MOBILE',                  0.0200),
  ('9172',   'India',      'INDIA MOBILE',                  0.0200),
  ('9173',   'India',      'INDIA MOBILE',                  0.0200),
  ('9174',   'India',      'INDIA MOBILE',                  0.0200),
  ('9175',   'India',      'INDIA MOBILE',                  0.0200),
  ('9176',   'India',      'INDIA MOBILE',                  0.0200),
  ('9177',   'India',      'INDIA MOBILE',                  0.0200),
  ('9178',   'India',      'INDIA MOBILE',                  0.0200),
  ('9179',   'India',      'INDIA MOBILE',                  0.0200),
  ('918',    'India',      'INDIA MOBILE',                  0.0200),
  ('919',    'India',      'INDIA MOBILE',                  0.0200),
  ('92',     'Pakistan',   'PAKISTAN FIXED',                0.0400),
  ('9258',   'Pakistan',   'PAKISTAN FIXED KASHMIR',        0.0400),
  ('923',    'Pakistan',   'PAKISTAN MOBILE',               0.0400),
  ('9230',   'Pakistan',   'PAKISTAN MOBILE MOBILINK',      0.0400),
  ('9235',   'Pakistan',   'PAKISTAN MOBILE SCOM',          0.0400),
  ('9234',   'Pakistan',   'PAKISTAN MOBILE TELENOR',       0.0400),
  ('9233',   'Pakistan',   'PAKISTAN MOBILE UFONE',         0.0400),
  ('9232',   'Pakistan',   'PAKISTAN MOBILE WARID',         0.0400),
  ('9231',   'Pakistan',   'PAKISTAN MOBILE ZONG',          0.0400),
  ('9237',   'Pakistan',   'PAKISTAN MOBILE ZONG',          0.0400)
 ) AS v(prefix, country, breakout, rate)
 WHERE NOT EXISTS (
   SELECT 1 FROM rate_card_entries e WHERE e.rate_card_id = c.id AND e.prefix = v.prefix
 );

UPDATE rate_cards SET entry_count = (
  SELECT COUNT(*) FROM rate_card_entries e WHERE e.rate_card_id = rate_cards.id
) WHERE name = 'Standard Wholesale' AND card_type = 'client';

-- ── Verify ──────────────────────────────────────────────────────────────────
DO $$
DECLARE
  n_entries INTEGER;
  outbound  TEXT;
  inbound   TEXT;
BEGIN
  SELECT COUNT(*) INTO n_entries FROM rate_card_entries e
    JOIN rate_cards c ON c.id = e.rate_card_id
   WHERE c.name = 'Standard Wholesale' AND c.card_type = 'client';
  IF n_entries <> 32 THEN
    RAISE EXCEPTION 'Standard Wholesale entries=% (want 32)', n_entries;
  END IF;

  -- The whole point of the split: these must NOT be the same mailbox type.
  SELECT communication_type INTO outbound FROM notification_event_routing WHERE event_key = 'rate_notification';
  SELECT communication_type INTO inbound  FROM notification_event_routing WHERE event_key = 'vendor_rate_received';
  IF outbound <> 'pricing' THEN
    RAISE EXCEPTION 'outbound rate_notification routes to % (want pricing)', outbound;
  END IF;
  IF inbound <> 'rates' THEN
    RAISE EXCEPTION 'inbound vendor_rate_received routes to % (want rates)', inbound;
  END IF;
END $$;

COMMIT;

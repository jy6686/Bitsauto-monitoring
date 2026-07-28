-- 047_company_capacity_and_media.sql
-- Capacity and media become CUSTOMER settings, not per-trunk ones.
--
-- A customer has one commercial capacity agreement regardless of how many trunks they
-- use. Holding max_cps on every trunk row makes three trunks each claiming 10 CPS
-- ambiguous, and three trunks claiming 10/20/15 unanswerable — the provisioning engine
-- would have to guess which is authoritative.
--
-- The provisioning profile supplies the DEFAULT at company creation. From then on the
-- COMPANY row is authoritative for that customer: editing a platform default must not
-- retroactively change existing customers, the same rule as routing and notifications
-- (migration 044).
--
-- Trunks keep only genuinely trunk-specific settings: name, authentication, IPs,
-- transport, port, CLI rules, direction.
-- Idempotent.

BEGIN;

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS max_cps      INTEGER,
  ADD COLUMN IF NOT EXISTS max_sessions INTEGER,
  ADD COLUMN IF NOT EXISTS codec        VARCHAR(32),
  ADD COLUMN IF NOT EXISTS media_relay  VARCHAR(16);

COMMENT ON COLUMN companies.max_cps IS
  'Account-level capacity. Seeded from the provisioning profile at creation; the company row is authoritative thereafter. NOT stored per trunk.';
COMMENT ON COLUMN companies.max_sessions IS
  'Account-level concurrent sessions. Seeded from the provisioning profile at creation; authoritative thereafter.';

-- Backfill from each company's assigned profile. Companies with no profile keep NULL and
-- are reported by pre-provision validation rather than silently defaulted here — a value
-- invented by a migration is indistinguishable from one an operator chose.
UPDATE companies c
   SET max_cps      = COALESCE(c.max_cps,      p.max_cps),
       max_sessions = COALESCE(c.max_sessions, p.max_sessions),
       codec        = COALESCE(c.codec,        p.codec_preference),
       media_relay  = COALESCE(c.media_relay,  p.media_relay)
  FROM provisioning_profiles p
 WHERE c.provisioning_profile_id = p.id;

DO $$
DECLARE unseeded INTEGER;
BEGIN
  SELECT COUNT(*) INTO unseeded
    FROM companies c
   WHERE c.provisioning_profile_id IS NOT NULL AND c.max_cps IS NULL;
  IF unseeded > 0 THEN
    RAISE EXCEPTION '% companies have a profile but no capacity after backfill', unseeded;
  END IF;
END $$;

COMMIT;

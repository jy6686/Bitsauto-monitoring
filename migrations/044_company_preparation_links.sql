-- 044_company_preparation_links.sql
-- Onboarding 2.0 — make the configuration layer actually apply.
--
-- Migrations 038-042 built provisioning profiles, routing packages, notification profiles
-- and rate policies, but nothing referenced them: creating a company attached none of it,
-- so the tables were inert and onboarding still felt entirely manual. This links them.
--
-- Assignment COPIES the resolved ids onto the company rather than reading through the
-- profile at use time. A live customer's routing must not change retroactively because an
-- admin edited a default six months later — same reasoning as company_provisioning_snapshot.
-- Changing a default affects the NEXT customer, never an existing one.
--
-- Still nothing in Sippy. This is BitsAuto-side preparation only.
-- Idempotent.

BEGIN;

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS provisioning_profile_id  INTEGER REFERENCES provisioning_profiles(id),
  ADD COLUMN IF NOT EXISTS routing_package_id       INTEGER REFERENCES routing_packages(id),
  ADD COLUMN IF NOT EXISTS notification_profile_id  INTEGER REFERENCES notification_profiles(id),
  ADD COLUMN IF NOT EXISTS rate_policy              VARCHAR(64),
  -- Set when the preparation package has been applied, so the company card can show
  -- readiness instead of "complete the wizard to enable provisioning".
  ADD COLUMN IF NOT EXISTS prepared_at              TIMESTAMP;

COMMENT ON COLUMN companies.provisioning_profile_id IS
  'Resolved at company creation from company_type. Copied, not read through — editing a default must not retroactively change existing customers.';

-- ── Backfill existing companies ─────────────────────────────────────────────
-- Match on company_type; fall back to the default profile for types with no dedicated
-- profile (carrier, enterprise) so no company is left unprepared.
UPDATE companies c
   SET provisioning_profile_id = p.id,
       routing_package_id      = p.routing_package_id,
       notification_profile_id = p.notification_profile_id,
       rate_policy             = p.rate_policy,
       prepared_at             = COALESCE(c.prepared_at, NOW())
  FROM provisioning_profiles p
 WHERE c.provisioning_profile_id IS NULL
   AND p.id = (
     SELECT id FROM provisioning_profiles
      WHERE active
        AND (company_type = c.company_type OR is_default)
      ORDER BY (company_type = c.company_type) DESC, is_default DESC
      LIMIT 1
   );

-- ── Verify ──────────────────────────────────────────────────────────────────
DO $$
DECLARE
  unlinked  INTEGER;
  incoherent INTEGER;
BEGIN
  SELECT COUNT(*) INTO unlinked FROM companies WHERE provisioning_profile_id IS NULL;
  IF unlinked > 0 THEN
    RAISE EXCEPTION '% companies still have no provisioning profile after backfill', unlinked;
  END IF;

  -- A company linked to a profile but missing routing or notifications would provision
  -- with neither, and would look prepared while being incomplete.
  SELECT COUNT(*) INTO incoherent FROM companies
   WHERE provisioning_profile_id IS NOT NULL
     AND (routing_package_id IS NULL OR notification_profile_id IS NULL);
  IF incoherent > 0 THEN
    RAISE EXCEPTION '% companies linked to a profile but missing routing/notification', incoherent;
  END IF;
END $$;

COMMIT;

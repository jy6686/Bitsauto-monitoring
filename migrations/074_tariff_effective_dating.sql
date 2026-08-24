-- 074_tariff_effective_dating.sql
--
-- Make tariff versions resolve by WHEN THEY APPLIED, not when they were typed.
--
-- The rating resolver selected the newest tariff version whose created_at was
-- at or before a call's connect time. effective_from existed on the table, was
-- written by the versioning service, and was never read. The consequence was
-- that a call which could not be priced — because no version existed covering
-- its time — could never be fixed: any version added afterwards carries a
-- created_at later than the call, so the resolver ignores it forever. The
-- ordinary remedy for an unpriceable call, adding the missing rate, was
-- structurally impossible.
--
-- This migration makes the existing data explicit before the resolver starts
-- reading it. Every version without an effective_from is stamped with its
-- created_at, which is exactly the date the old resolver used — so behaviour is
-- IDENTICAL for every call already rated, and only backdated corrections
-- entered from here on change anything.
--
-- Without this backfill the resolver change would find effective_from null
-- everywhere and price nothing at all.
--
-- Issued invoices are unaffected: verified calls are deduplicated by snapshot
-- and never re-rated on their own. A corrected tariff changes an already-billed
-- period only through an explicit re-certification, which refuses while a live
-- invoice draws on that period.

BEGIN;

UPDATE tariff_versions
   SET effective_from = created_at
 WHERE effective_from IS NULL;

ALTER TABLE tariff_versions ALTER COLUMN effective_from SET DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_tariff_versions_effective
  ON tariff_versions (i_tariff, effective_from DESC);

DO $$
DECLARE stamped INTEGER;
BEGIN
  SELECT count(*) INTO stamped FROM tariff_versions WHERE effective_from IS NOT NULL;
  RAISE NOTICE '074: tariff effective dating ready — % version(s) carry an effective_from.', stamped;
END $$;

COMMIT;

-- Which id space product_rates.destination_id belongs to.
--
-- THE DEFECT THIS CLOSES.
-- `destination_id` is a bare INTEGER with no foreign key and no marker saying
-- what it points at, and two readers already disagree about it:
--
--   rates.step.ts:139   takes it as a global_destinations.id — it builds its
--                       destination set `.from(globalDestinations)` and hands
--                       the value straight to generateRateMatrix.
--   Product Rates       as of 03977848 writes it as a commercial_destinations.id.
--
-- Same column, two id spaces, no discriminator. A catalogue id that happens to
-- collide with a global_destinations id would be silently attached to the wrong
-- destination and uploaded as that destination's price. This is precisely the
-- failure that produced the mess migration 514 exists to escape: 052/053 wrote
-- assignments against global_destinations, 059 moved the id space and left a map
-- expecting a migration 060 to translate, and 060 was never written.
--
-- It is not reachable yet — eligibility is empty, so no catalogue-keyed rate can
-- exist — and 03977848 is unpublished. It is closed here before it can be.
--
-- WHAT THE COLUMN MEANS.
--   NULL     destination_id is NOT a catalogue reference. Either the row is
--            prefix-only, or its destination_id is a legacy global_destinations
--            id. Existing rows are all of this kind, and their behaviour is
--            unchanged: they price the single prefix in `prefix`.
--   NOT NULL destination_id is a commercial_destinations.id IN THIS VERSION, and
--            the price covers every prefix that destination holds.
--
-- Every existing row therefore keeps exactly the meaning it had. Nothing is
-- backfilled, because there is no mapping from global_destinations ids to
-- catalogue ids and inventing one by name or prefix is the fuzzy matching that
-- caused this in the first place.
--
-- WHY IT ALSO ANSWERS THE VERSION QUESTION.
-- A destination's prefix set belongs to a catalogue version — a re-import can
-- keep a destination's name while changing what it covers. Recording the version
-- a price was set against makes a version change DETECTABLE at expansion time,
-- so a rate priced against V1 is refused rather than quietly re-expanded to V2's
-- different prefix set. The eligibility layer already refuses implicit rollover;
-- this is the pricing layer refusing it too, for the same reason.
--
-- NO FOREIGN KEY, DELIBERATELY, FOR TWO REASONS.
--  1. A price is a commercial record. An FK to catalogue_versions invites an
--     ON DELETE CASCADE that would erase price history when a version is cleaned
--     up. A dangling version id must be REPORTED, not resolved by deletion.
--  2. catalogue_versions is created by runFileMigrations and is absent from
--     schema.ts and the drizzle snapshot. A constraint between a snapshotted
--     table and a non-snapshotted one is exactly what makes Replit's publish diff
--     propose destructive DDL.
-- A version id that names no live version is handled by the resolver as
-- `unknown_destination`, which is visible, rather than by the database, which
-- would be silent.

BEGIN;

ALTER TABLE product_rates
  ADD COLUMN IF NOT EXISTS catalogue_version_id INTEGER;

COMMENT ON COLUMN product_rates.catalogue_version_id IS
  'NULL = destination_id is NOT a catalogue reference (prefix-only row, or a legacy '
  'global_destinations id) and the price covers the single prefix in `prefix`. NOT NULL = '
  'destination_id is a commercial_destinations.id in THIS catalogue version and the price covers '
  'every prefix that destination holds in that version. Never backfilled: there is no mapping from '
  'legacy ids to catalogue ids. Set by the Rate Manager write path; read by rate-prefix-expansion.ts.';

COMMENT ON COLUMN product_rates.destination_id IS
  'Id space is declared by catalogue_version_id — read that first. This column alone is ambiguous, '
  'and reading it without the version is the defect migration 515 closes.';

-- The expansion reads priced rows for a product and needs their catalogue rows.
CREATE INDEX IF NOT EXISTS product_rates_catalogue_ix
  ON product_rates (catalogue_version_id, destination_id)
  WHERE catalogue_version_id IS NOT NULL;

DO $$
DECLARE
  mislabelled INTEGER;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'product_rates' AND column_name = 'catalogue_version_id') THEN
    RAISE EXCEPTION '515: catalogue_version_id missing after apply.';
  END IF;

  -- Every pre-existing row must read as legacy. A non-null value here could only
  -- come from a backfill, and a backfill would be a claim that a legacy
  -- destination_id is a catalogue id — which is the thing this migration exists
  -- to make impossible to assert by accident.
  SELECT count(*) INTO mislabelled FROM product_rates WHERE catalogue_version_id IS NOT NULL;
  IF mislabelled <> 0 THEN
    RAISE EXCEPTION '515: % pre-existing row(s) claim a catalogue version. Nothing may be '
                    'backfilled: there is no mapping from global_destinations ids to '
                    'commercial_destinations ids.', mislabelled;
  END IF;

  RAISE NOTICE '515: product_rates.destination_id now declares its id space. Existing rows keep '
               'their meaning and price a single prefix; catalogue-keyed rows expand to a '
               'destination''s full prefix set within the version they were priced against.';
END$$;

COMMIT;

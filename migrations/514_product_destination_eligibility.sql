-- Which catalogue destinations each product is sold on.
--
-- The commercial catalogue is deliberately product-neutral — migration 500's
-- header says so, and no endpoint on it accepts a product. Product eligibility
-- has to live somewhere else, and until now the only thing that looked like it
-- was `product_destination_assignments`: 52 rows written by migration 052,
-- thirteen destinations assigned to all four products uniformly. That expresses
-- zero product differentiation, so it never was an eligibility matrix.
--
-- Worse, its `destination_id` has moved twice. 052/053 wrote it against
-- `global_destinations`; 059 merged that table into `destinations` and left a
-- map, expecting a migration 060 to translate the assignments; 060 was never
-- written; and 064 and 065 then repointed those ids into the `destinations` id
-- space anyway. Meanwhile /api/commercial-destinations still joins
-- `global_destinations`, so the ids match nothing and the Product Rates screen
-- shows zero assigned destinations — which is why provisioning reports "No
-- prices effective today" while priced rows exist.
--
-- Those 52 rows are NOT migrated here. There is no mapping from `destinations`
-- ids to `commercial_destinations` ids and none can be reconstructed: the
-- catalogue carries no legacy id column and its identity is (version_id, name),
-- a versioned commercial identity unrelated to the tree's serials. Re-matching
-- by name or prefix is the same fuzzy identity matching that produced the
-- global_destinations residue in the first place. And it would carry a fiction
-- across an unsafe join, because uniform seed data cannot answer the question
-- this table exists to answer.
--
-- So the legacy table is kept and marked non-authoritative rather than emptied.
-- Its rows stay readable as an audit trail and a rollback reference; nothing new
-- consumes them.
--
-- VERSION SCOPING, WHICH IS A REAL OPERATIONAL CONSEQUENCE.
-- `commercial_destinations.id` is scoped to a catalogue version — `9230` may
-- exist once in V1 and once in V2 as different rows. Eligibility declared
-- against V1 therefore does NOT carry into V2 by itself. That is the honest
-- behaviour: a new catalogue version is a new commercial fact set, and whether
-- last version's eligibility still applies is a commercial judgement, not a
-- join. `version_id` is stored alongside so "what is eligible in the active
-- version" is answerable without walking the catalogue, and so a rollover can
-- be reported rather than silently losing rows.
--
-- NOTHING IS POPULATED HERE. Which destinations each product sells is a
-- commercial decision. Seeding it from the 13 legacy destinations, or assuming
-- every destination belongs to every product, would manufacture an answer
-- nobody gave.

BEGIN;

CREATE TABLE IF NOT EXISTS product_destination_eligibility (
  id             SERIAL PRIMARY KEY,

  -- Product identity is the registry ROW, never the trunk prefix: Wholesale and
  -- Retail deliberately share trunks (First Class Wholesale and Premium are both
  -- trunk 1), so a trunk identifies a family and cannot identify a product.
  -- Wholesale vs Retail comes from product_registry.segment.
  product_id     INTEGER NOT NULL REFERENCES product_registry(id) ON DELETE CASCADE,

  -- Destination identity is the versioned catalogue row.
  destination_id INTEGER NOT NULL REFERENCES commercial_destinations(id) ON DELETE CASCADE,
  -- Denormalised from the destination so the active-version question is cheap and
  -- a version rollover is visible. Kept honest by the trigger below.
  version_id     INTEGER NOT NULL REFERENCES catalogue_versions(id) ON DELETE CASCADE,

  -- Soft state, so withdrawing eligibility is attributable rather than a DELETE.
  status         TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'withdrawn')),

  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by     TEXT,
  withdrawn_at   TIMESTAMPTZ,
  withdrawn_by   TEXT,
  notes          TEXT,

  -- One row per product per destination. Re-granting flips status back rather
  -- than inserting a second row, so history stays on one line.
  UNIQUE (product_id, destination_id),

  -- Withdrawal must be attributable, for the same reason a rate resolution must
  -- be: "no longer sold here" is a commercial claim someone made.
  CONSTRAINT product_destination_eligibility_withdrawal_ck CHECK (
    status <> 'withdrawn'
    OR (withdrawn_at IS NOT NULL AND withdrawn_by IS NOT NULL)
  )
);

-- The two reads this exists to serve: "what does this product sell in the active
-- version", and "which products sell this destination".
CREATE INDEX IF NOT EXISTS pde_product_version_ix
  ON product_destination_eligibility (product_id, version_id)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS pde_destination_ix
  ON product_destination_eligibility (destination_id)
  WHERE status = 'active';

-- version_id must equal the destination's own version. Enforced rather than
-- trusted, because a wrong value here would make "eligible in the active
-- version" quietly answer with rows from another one.
CREATE OR REPLACE FUNCTION pde_version_matches_destination() RETURNS TRIGGER AS $$
DECLARE
  dest_version INTEGER;
BEGIN
  SELECT version_id INTO dest_version FROM commercial_destinations WHERE id = NEW.destination_id;
  IF dest_version IS NULL THEN
    RAISE EXCEPTION 'product_destination_eligibility: destination % does not exist', NEW.destination_id;
  END IF;
  IF NEW.version_id <> dest_version THEN
    RAISE EXCEPTION 'product_destination_eligibility: version_id % does not match destination %''s version %',
      NEW.version_id, NEW.destination_id, dest_version;
  END IF;
  RETURN NEW;
END$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS pde_version_matches ON product_destination_eligibility;
CREATE TRIGGER pde_version_matches
  BEFORE INSERT OR UPDATE ON product_destination_eligibility
  FOR EACH ROW EXECUTE FUNCTION pde_version_matches_destination();

-- ── Retire the legacy table in place ────────────────────────────────────────
-- Marked, not emptied. Its 52 rows remain readable; nothing new reads them.
COMMENT ON TABLE product_destination_assignments IS
  'LEGACY / NON-AUTHORITATIVE as of migration 514. Its destination_id has moved id space twice '
  '(global_destinations -> destinations via 059/064/065, with the intended translation in 060 never '
  'written) and it holds uniform seed data expressing no product differentiation. Preserved as an '
  'audit trail and rollback reference. Product eligibility is product_destination_eligibility. '
  'Do NOT read this table for eligibility, and do NOT remap its ids.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_name = 'product_destination_eligibility') THEN
    RAISE EXCEPTION '514: product_destination_eligibility missing after apply.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                  WHERE table_name = 'product_destination_eligibility'
                    AND constraint_name = 'product_destination_eligibility_withdrawal_ck') THEN
    RAISE EXCEPTION '514: the withdrawal CHECK is missing — withdrawing eligibility could then be '
                    'recorded with no operator and no time, which is indistinguishable from a row '
                    'that was never granted.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'pde_version_matches') THEN
    RAISE EXCEPTION '514: the version-consistency trigger is missing — eligibility could then claim '
                    'a version its destination does not belong to.';
  END IF;

  IF (SELECT count(*) FROM product_destination_eligibility) <> 0 THEN
    RAISE EXCEPTION '514: the table must be created EMPTY. Which destinations each product sells is '
                    'a commercial decision; seeding it would manufacture an answer nobody gave.';
  END IF;

  RAISE NOTICE '514: product eligibility now references the versioned commercial catalogue, and is '
               'empty until somebody says what each product sells.';
END$$;

COMMIT;

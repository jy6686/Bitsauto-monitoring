-- 502_commercial_name.sql
--
-- Gives the catalogue a name that belongs to BitsAuto rather than to the supplier.
--
--   name             the supplier's, immutable, never displayed to a customer
--   commercial_name  ours, set during review, what every commercial module shows
--
-- The problem this solves: adopting supplier names permanently means inheriting every
-- supplier's naming quirks forever. `PAKISTAN - MOBILE MOBILINK` is accurate and is not what
-- the pricing team, the customer, or a rate notification should say. Renaming at import was
-- never an option — Principle 5 forbids it and immutability enforces it — so the business name
-- has to live in a second column that the import never touches.
--
-- Display is COALESCE(commercial_name, name): a destination nobody has renamed still shows
-- something, so the catalogue is usable from the moment it is imported rather than after
-- 1,344 renames.
--
-- ── One commercial name = one identity ────────────────────────────────────────────────
-- Enforced, per the owner's rule. Two destinations sharing a commercial name would put two
-- indistinguishable rows in a picker pointing at different prefixes — which is precisely the
-- defect this whole catalogue replaces, re-created by hand instead of inherited.

BEGIN;

ALTER TABLE commercial_destinations ADD COLUMN IF NOT EXISTS commercial_name TEXT;
ALTER TABLE commercial_destinations ADD COLUMN IF NOT EXISTS renamed_by      TEXT;
ALTER TABLE commercial_destinations ADD COLUMN IF NOT EXISTS renamed_at      TIMESTAMPTZ;

COMMENT ON COLUMN commercial_destinations.commercial_name IS
  'BitsAuto''s name for this destination. NULL means "use the supplier name". Mutable — unlike name, which is supplier data and is refused on UPDATE.';

-- Unique within a version, ignoring the un-renamed. A partial index rather than a constraint
-- so the 1,344 NULLs do not collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS cd_commercial_name_unique
  ON commercial_destinations (version_id, lower(commercial_name))
  WHERE commercial_name IS NOT NULL;

-- Stamp who renamed it and when, the same way 501 made approval metadata trigger-owned:
-- a caller that must remember three fields will remember two.
CREATE OR REPLACE FUNCTION stamp_commercial_rename() RETURNS TRIGGER
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.commercial_name IS DISTINCT FROM OLD.commercial_name THEN
    NEW.commercial_name := NULLIF(btrim(NEW.commercial_name), '');
    NEW.renamed_by := CASE WHEN NEW.commercial_name IS NULL THEN NULL
                           ELSE COALESCE(NULLIF(NEW.renamed_by, ''), current_user) END;
    NEW.renamed_at := CASE WHEN NEW.commercial_name IS NULL THEN NULL ELSE NOW() END;
    NEW.updated_at := NOW();
  END IF;
  RETURN NEW;
END$fn$;
DROP TRIGGER IF EXISTS trg_cd_rename_stamp ON commercial_destinations;
CREATE TRIGGER trg_cd_rename_stamp BEFORE UPDATE ON commercial_destinations
  FOR EACH ROW EXECUTE FUNCTION stamp_commercial_rename();

-- ── What consumers read ────────────────────────────────────────────────────────────────
-- display_name is the only name a commercial module should ever render. Exposing both would
-- invite one screen to show the supplier's and another the business's, which is the same
-- one-entity-two-names problem in a new costume.
-- DROP then CREATE, not CREATE OR REPLACE: replacing a view cannot rename its columns, and
-- `name` becomes `supplier_name` here. Safe because nothing in the database depends on these
-- views — the only readers are runtime queries, which pick up the new shape on their next call.
DROP VIEW IF EXISTS v_catalogue_sellable_prefixes;
DROP VIEW IF EXISTS v_catalogue_sellable;

CREATE VIEW v_catalogue_sellable AS
  SELECT d.id, d.name AS supplier_name, COALESCE(d.commercial_name, d.name) AS display_name,
         d.version_id, v.label AS version_label
    FROM commercial_destinations d
    JOIN catalogue_versions v ON v.id = d.version_id AND v.status = 'active'
   WHERE d.approval_status = 'approved';

CREATE VIEW v_catalogue_sellable_prefixes AS
  SELECT p.destination_id,
         COALESCE(d.commercial_name, d.name) AS display_name,
         d.name AS supplier_name,
         p.prefix, p.billing_increment
    FROM commercial_destination_prefixes p
    JOIN commercial_destinations d ON d.id = p.destination_id
    JOIN catalogue_versions v      ON v.id = d.version_id AND v.status = 'active'
   WHERE d.approval_status = 'approved';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name='commercial_destinations' AND column_name='commercial_name') THEN
    RAISE EXCEPTION '502: commercial_name was not added.';
  END IF;
  RAISE NOTICE '502: commercial_name added. Display is COALESCE(commercial_name, name); the supplier name stays immutable and is kept for traceability and for carrying names forward to the next version.';
END$$;

COMMIT;

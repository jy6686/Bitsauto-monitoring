-- 500_commercial_destination_catalogue.sql
--
-- The versioned master commercial destination catalogue. Created ALONGSIDE whatever exists
-- today: nothing is dropped, no FK is re-pointed, no existing row is touched.
--
-- ── Why versions, and not just tables ─────────────────────────────────────────────────
-- A supplier catalogue is replaced periodically, and the replacement must be importable,
-- reviewable and testable while the CURRENT one is still serving live rate pushes. Without
-- versions, a second import either collides with the first or has to destroy it — which is
-- how "import the new codes" becomes "make a mess".
--
--   Supplier Catalogue V1   status = active     <- everything commercial reads this
--   Supplier Catalogue V2   status = draft      <- imported, being reviewed, invisible
--
-- Uniqueness is scoped PER VERSION. `9230` may exist once in V1 and once in V2 and they do
-- not collide, because they are not the same catalogue. Within a version it may exist
-- exactly once, which is the invariant that stops two identities competing for one prefix.
--
-- Cutover is therefore a status flip, not a data migration — and it is reversible by
-- flipping back. See activate_catalogue_version() at the end.
--
-- ── The governing rule this schema enforces (Principle 5) ─────────────────────────────
-- The uploaded catalogue is authoritative. The importer stores names, prefixes, billing
-- increments and effective dates exactly as supplied; it does not rename, normalise, expand
-- prefixes, or infer commercial relationships. Every destination is created UNAPPROVED and
-- without product assignment.
--
-- That is why columns you might expect are ABSENT rather than nullable:
--   country / service_type / operator — deriving these from `PAKISTAN - MOBILE ZONG` is
--     inference. The convention parses at 90.85%: enough to propose an enrichment, not
--     enough to store as fact. Hierarchy is built AFTER import, from the imported rows, and
--     never by editing them.
--   parent_id — the file carries no hierarchy. Inventing one at import is the defect this
--     catalogue replaces.
--   product / trunk prefix — the product is chosen in Rate Manager and the trunk digit is
--     derived at push time (client/src/pages/rate-manager.tsx:2218).
--
-- ── Measured against `Destination catalogue New.xlsx`, 2026-08-28 ─────────────────────
--   19,160 data rows -> 1,344 destinations + 19,160 prefixes
--   1,344 distinct names; 19,160 distinct codes; zero duplicate codes
--   0 of 1,344 identities carry more than one rate — the full name IS the pricing unit
-- The UNIQUE constraints below are those measured facts promoted to constraints, so a later
-- upload that breaks one FAILS rather than silently creating the ambiguity this replaces.

BEGIN;

-- ── Versions ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS catalogue_versions (
  id           SERIAL PRIMARY KEY,
  label        TEXT NOT NULL UNIQUE,
  status       TEXT NOT NULL DEFAULT 'draft'
               CHECK (status IN ('draft', 'pending', 'active', 'archived')),
  source_file  TEXT,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activated_at TIMESTAMPTZ,
  activated_by TEXT
);

-- Exactly one active version, enforced by the database rather than by convention.
CREATE UNIQUE INDEX IF NOT EXISTS catalogue_versions_one_active
  ON catalogue_versions ((status)) WHERE status = 'active';

-- ── Provenance: which upload produced which rows ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS catalogue_import_batches (
  id           SERIAL PRIMARY KEY,
  version_id   INTEGER NOT NULL REFERENCES catalogue_versions(id) ON DELETE CASCADE,
  source_file  TEXT NOT NULL,
  sheet_name   TEXT NOT NULL,
  file_sha256  TEXT NOT NULL,
  header_row   INTEGER NOT NULL,
  data_rows    INTEGER NOT NULL,
  destinations INTEGER NOT NULL,
  prefixes     INTEGER NOT NULL,
  imported_by  TEXT,
  imported_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes        TEXT,
  UNIQUE (version_id, file_sha256)   -- the same file cannot load twice into one version
);

-- ── The commercial identity ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS commercial_destinations (
  id              SERIAL PRIMARY KEY,
  version_id      INTEGER NOT NULL REFERENCES catalogue_versions(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,                 -- EXACTLY as supplied. The identity.
  approval_status TEXT NOT NULL DEFAULT 'unapproved'
                  CHECK (approval_status IN ('unapproved', 'approved', 'blocked')),
  approved_by     TEXT,
  approved_at     TIMESTAMPTZ,
  import_batch_id INTEGER REFERENCES catalogue_import_batches(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (version_id, name)
);
COMMENT ON COLUMN commercial_destinations.name IS
  'The supplier name, byte-for-byte. Not normalised, not title-cased, not renamed. If a later file says JAZZ where this one says MOBILINK, the next version reflects that.';

-- ── The prefixes behind it ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS commercial_destination_prefixes (
  id                 SERIAL PRIMARY KEY,
  version_id         INTEGER NOT NULL REFERENCES catalogue_versions(id) ON DELETE CASCADE,
  destination_id     INTEGER NOT NULL REFERENCES commercial_destinations(id) ON DELETE CASCADE,
  prefix             TEXT NOT NULL,
  supplier_rate      NUMERIC(12,6),
  billing_increment  TEXT,          -- as supplied: '1/1', '60/1', '60/60', '30/6', '6/6'
  effective_date_raw TEXT,          -- as supplied: '27/Aug/26'. Parsing chooses a century — deferred.
  source_row         INTEGER,       -- sheet row, so any value traces back to the file
  import_batch_id    INTEGER REFERENCES catalogue_import_batches(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (version_id, prefix)
);
COMMENT ON COLUMN commercial_destination_prefixes.prefix IS
  'UNIQUE WITHIN A VERSION. A prefix owned by two identities in the same catalogue means two destinations compete for the same traffic and the rate applied depends on which row a resolver reaches first. Across versions it may repeat — that is the point of versions.';
COMMENT ON COLUMN commercial_destination_prefixes.supplier_rate IS
  'The rate AS SUPPLIED — provenance, not a sellable price. Commercial pricing lives in the rate tables, per product and per customer.';

CREATE INDEX IF NOT EXISTS cdp_destination_id_idx ON commercial_destination_prefixes (destination_id);
CREATE INDEX IF NOT EXISTS cdp_version_idx        ON commercial_destination_prefixes (version_id);
CREATE INDEX IF NOT EXISTS cd_version_status_idx  ON commercial_destinations (version_id, approval_status);

-- ── Approval history ───────────────────────────────────────────────────────────────────
-- approved_by/approved_at on the row carry the CURRENT state only. "Who un-approved Pakistan
-- Mobile Zong last Tuesday, and why" is a different question, and the row cannot answer it.
CREATE TABLE IF NOT EXISTS commercial_destination_approvals (
  id             SERIAL PRIMARY KEY,
  destination_id INTEGER NOT NULL REFERENCES commercial_destinations(id) ON DELETE CASCADE,
  from_status    TEXT NOT NULL,
  to_status      TEXT NOT NULL,
  actor          TEXT,
  reason         TEXT,
  changed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS cda_destination_idx ON commercial_destination_approvals (destination_id, changed_at DESC);

CREATE OR REPLACE FUNCTION log_commercial_destination_approval() RETURNS TRIGGER
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.approval_status IS DISTINCT FROM OLD.approval_status THEN
    INSERT INTO commercial_destination_approvals (destination_id, from_status, to_status, actor)
    VALUES (OLD.id, OLD.approval_status, NEW.approval_status, COALESCE(NEW.approved_by, current_user));
    NEW.updated_at := NOW();
  END IF;
  RETURN NEW;
END$fn$;
DROP TRIGGER IF EXISTS trg_cd_approval_history ON commercial_destinations;
CREATE TRIGGER trg_cd_approval_history BEFORE UPDATE ON commercial_destinations
  FOR EACH ROW EXECUTE FUNCTION log_commercial_destination_approval();

-- ── Immutability of supplier data ──────────────────────────────────────────────────────
-- "The uploaded catalogue is authoritative" is a convention until the database enforces it.
-- Approval state is OURS and stays mutable; the supplier's name, code, rate, increment and
-- effective date are THEIRS and cannot be edited after import. A correction means the
-- supplier issues a new file and it becomes a new version — which is what makes a version
-- immutable, and therefore what makes rollback mean something.
CREATE OR REPLACE FUNCTION reject_supplier_field_edit() RETURNS TRIGGER
LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_TABLE_NAME = 'commercial_destinations' THEN
    IF NEW.name IS DISTINCT FROM OLD.name OR NEW.version_id IS DISTINCT FROM OLD.version_id THEN
      RAISE EXCEPTION 'commercial_destinations.% is supplier data and is immutable. Import a new catalogue version instead.',
        CASE WHEN NEW.name IS DISTINCT FROM OLD.name THEN 'name' ELSE 'version_id' END;
    END IF;
  ELSE
    IF NEW.prefix IS DISTINCT FROM OLD.prefix
       OR NEW.supplier_rate IS DISTINCT FROM OLD.supplier_rate
       OR NEW.billing_increment IS DISTINCT FROM OLD.billing_increment
       OR NEW.effective_date_raw IS DISTINCT FROM OLD.effective_date_raw
       OR NEW.destination_id IS DISTINCT FROM OLD.destination_id
       OR NEW.version_id IS DISTINCT FROM OLD.version_id THEN
      RAISE EXCEPTION 'commercial_destination_prefixes carries supplier data and is immutable. Import a new catalogue version instead.';
    END IF;
  END IF;
  RETURN NEW;
END$fn$;
DROP TRIGGER IF EXISTS trg_cd_immutable  ON commercial_destinations;
DROP TRIGGER IF EXISTS trg_cdp_immutable ON commercial_destination_prefixes;
CREATE TRIGGER trg_cd_immutable  BEFORE UPDATE ON commercial_destinations
  FOR EACH ROW EXECUTE FUNCTION reject_supplier_field_edit();
CREATE TRIGGER trg_cdp_immutable BEFORE UPDATE ON commercial_destination_prefixes
  FOR EACH ROW EXECUTE FUNCTION reject_supplier_field_edit();

-- ── What consumers read ────────────────────────────────────────────────────────────────
-- Two views, because "in the catalogue" and "sellable" are different questions.
-- v_catalogue_sellable is the ONLY thing a commercial picker should query: an unapproved row,
-- or a row from a version that is not live, cannot leak through it.
CREATE OR REPLACE VIEW v_catalogue_active AS
  SELECT d.*, v.label AS version_label
    FROM commercial_destinations d
    JOIN catalogue_versions v ON v.id = d.version_id AND v.status = 'active';

CREATE OR REPLACE VIEW v_catalogue_sellable AS
  SELECT d.id, d.name, d.version_id, v.label AS version_label
    FROM commercial_destinations d
    JOIN catalogue_versions v ON v.id = d.version_id AND v.status = 'active'
   WHERE d.approval_status = 'approved';

CREATE OR REPLACE VIEW v_catalogue_sellable_prefixes AS
  SELECT p.destination_id, d.name, p.prefix, p.billing_increment
    FROM commercial_destination_prefixes p
    JOIN commercial_destinations d ON d.id = p.destination_id
    JOIN catalogue_versions v      ON v.id = d.version_id AND v.status = 'active'
   WHERE d.approval_status = 'approved';

-- ── Cutover as one reversible statement ────────────────────────────────────────────────
-- Archives whatever is active and activates the target, in one transaction, so there is
-- never a moment with zero active versions. Rollback is the same call naming the old label.
CREATE OR REPLACE FUNCTION activate_catalogue_version(p_label TEXT, p_by TEXT DEFAULT NULL)
RETURNS TEXT LANGUAGE plpgsql AS $fn$
DECLARE v_id INTEGER; v_prev TEXT; n_unapproved INTEGER;
BEGIN
  SELECT id INTO v_id FROM catalogue_versions WHERE label = p_label;
  IF v_id IS NULL THEN RAISE EXCEPTION 'catalogue version "%" does not exist', p_label; END IF;

  SELECT count(*) INTO n_unapproved FROM commercial_destinations
   WHERE version_id = v_id AND approval_status = 'unapproved';
  IF n_unapproved > 0 THEN
    RAISE NOTICE 'activating "%" with % destination(s) still UNAPPROVED — they stay hidden from commercial modules until approved.', p_label, n_unapproved;
  END IF;

  SELECT label INTO v_prev FROM catalogue_versions WHERE status = 'active';
  UPDATE catalogue_versions SET status = 'archived' WHERE status = 'active';
  UPDATE catalogue_versions
     SET status = 'active', activated_at = NOW(), activated_by = COALESCE(p_by, current_user)
   WHERE id = v_id;
  RETURN format('active: %s (was: %s)', p_label, COALESCE(v_prev, 'none'));
END$fn$;

-- ── Verify ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.catalogue_versions') IS NULL
     OR to_regclass('public.commercial_destinations') IS NULL
     OR to_regclass('public.commercial_destination_prefixes') IS NULL
     OR to_regclass('public.catalogue_import_batches') IS NULL THEN
    RAISE EXCEPTION '500: one or more catalogue tables were not created.';
  END IF;
  IF to_regclass('public.v_catalogue_sellable') IS NULL THEN
    RAISE EXCEPTION '500: v_catalogue_sellable missing — without it an unapproved row can reach a commercial module.';
  END IF;
  RAISE NOTICE '500: versioned commercial catalogue ready, EMPTY. Load with scripts/import-supplier-catalogue.ts. Legacy destinations/global_destinations untouched.';
END$$;

COMMIT;

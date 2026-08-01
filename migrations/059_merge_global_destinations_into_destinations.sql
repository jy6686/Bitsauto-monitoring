-- 059_merge_global_destinations_into_destinations.sql
--
-- Merges global_destinations into `destinations` and records an id map. Data only — no FK
-- is re-pointed, no view is changed, no application code is affected. That is 060.
--
-- ── The decision this implements ───────────────────────────────────────────────
-- `destinations` is canonical. Three rounds of diagnostics in 058 established it: the real
-- catalogue is there (150,408 rows, imported 2026-07-04), global_destinations holds 2,697
-- rows that are largely residue of the Bulk Import parser defect, and no production row
-- depends exclusively on a global_destinations id. Full report in
-- docs/DESTINATION-MIGRATION-REPORT.md.
--
-- The merge therefore runs toward the LARGER table. Moving 2,697 rows into 150,408 is two
-- orders of magnitude less data movement than the reverse, and it ends at the store Phase 1
-- was designed around rather than at the one it exists to retire.
--
-- ── Why an id map, and why it outlives this migration ──────────────────────────
-- product_destination_assignments holds 52 rows written by 053 against global_destinations
-- ids. The diagnostic classified all 52 as resolving in BOTH tables, which reads as safe and
-- is the opposite. Only ~149 of 2,697 rows share an identity across the two tables, so an id
-- that exists in both almost certainly names a DIFFERENT destination in each. Re-pointing
-- those assignments without translation would silently attach products to the wrong
-- countries — no FK violation, no error, wrong routing.
--
-- So the mapping is not a temporary variable inside a migration. It is written to
-- destination_id_map and kept:
--
--   - 060 translates the 52 assignments through it
--   - anything discovered later that stored a gd id can still be translated
--   - "which destination was gd id 1500?" stays answerable after global_destinations is gone
--
-- ── Matching rule ──────────────────────────────────────────────────────────────
-- (lower(trim(name)), coalesce(dial_prefix,'')) — the same identity 058 compared on, so the
-- counts it reported and the rows this inserts are the same population. A gd row that
-- matches an existing destination maps to it and inserts nothing. One that does not is
-- inserted and maps to the new row.
--
-- Deliberately NOT matching on dial_prefix alone. 052 NULLed 1,135 IBIS codes out of
-- dial_prefix, so 2,421 of the 2,697 rows now have no prefix at all; prefix-only matching
-- would collapse them into a single bucket.
--
-- ── What is preserved ──────────────────────────────────────────────────────────
-- commercial_status, blocked_reason, notes, country_code, operator_name, sort_order —
-- carried across as-is. Approvals recorded in global_destinations survive the move even
-- though only 35 of 2,697 rows are approved. The IBIS codes 052 parked in `notes` come with
-- them, so the vendor sheet mapping is still reconstructible afterwards.
--
-- parent_id is remapped through the map in a second pass, because a parent may itself be a
-- row this migration is inserting and its new id is not known until it exists.
--
-- `level` is NOT copied. It is the one column in the intersection that describes a row's
-- position in a tree rather than the destination itself, and this migration moves the row
-- into a different tree. It is recomputed from the final parent in a third pass.
--
-- ── Column handling ────────────────────────────────────────────────────────────
-- The two tables were created by different migrations and are not guaranteed to have the
-- same columns. Rather than hardcode a list that is right on one database and wrong on the
-- other, the copy uses the INTERSECTION of the two column sets, and refuses up front if
-- `destinations` has a NOT NULL column with no default that global_destinations cannot fill.
-- Guessing a value for such a column is how a migration invents data.
--
-- Idempotent: a gd row already present in destination_id_map is skipped, so a re-run inserts
-- nothing and re-reports the same totals.

BEGIN;

-- ── The map ───────────────────────────────────────────────────────────────────
-- Not dropped at the end of Phase A. See the header: it is the only remaining answer to
-- "which destination was this id" once global_destinations is retired.
CREATE TABLE IF NOT EXISTS destination_id_map (
  gd_id          INTEGER PRIMARY KEY,
  destination_id INTEGER NOT NULL,
  matched_by     VARCHAR(16) NOT NULL,   -- 'identity' | 'inserted'
  gd_name        VARCHAR(128),
  gd_dial_prefix VARCHAR(32),
  created_at     TIMESTAMP NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE destination_id_map IS
  'global_destinations.id -> destinations.id, written by migration 059. Kept permanently: 060 translates product_destination_assignments through it, and it is the only way to resolve a legacy id after global_destinations is retired.';

DO $$
DECLARE
  cols        TEXT;
  missing     TEXT;
  n_identity  INTEGER := 0;
  n_inserted  INTEGER := 0;
  n_parents   INTEGER := 0;
  n_dupes     INTEGER := 0;
  n_levels    INTEGER := 0;
  n_level_total INTEGER := 0;
  root_level  INTEGER;
  i           INTEGER;
  n_total     INTEGER := 0;
BEGIN
  IF to_regclass('public.global_destinations') IS NULL THEN
    RAISE NOTICE '059: no global_destinations on this database — nothing to merge.';
    RETURN;
  END IF;
  IF to_regclass('public.destinations') IS NULL THEN
    RAISE EXCEPTION '059: `destinations` does not exist. It is the canonical store this merge targets — Phase 1 Step 1 has not run on this database.';
  END IF;

  EXECUTE 'SELECT count(*) FROM global_destinations' INTO n_total;

  -- Refuse before touching anything if the target has a column this migration cannot fill.
  -- A NOT NULL column with no default, absent from global_destinations, has no correct value
  -- and inventing one is worse than stopping.
  SELECT string_agg(d.column_name, ', ') INTO missing
    FROM information_schema.columns d
   WHERE d.table_schema = 'public' AND d.table_name = 'destinations'
     AND d.is_nullable = 'NO' AND d.column_default IS NULL
     AND d.column_name <> 'id'
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns g
                      WHERE g.table_schema = 'public' AND g.table_name = 'global_destinations'
                        AND g.column_name = d.column_name);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION '059: `destinations` requires column(s) global_destinations cannot supply: %. Add a default, or extend this migration with an explicit value — do not let it guess.', missing;
  END IF;

  -- The columns both tables share, excluding the ones handled separately: id is assigned by
  -- the target, parent_id is remapped in the second pass.
  SELECT string_agg(quote_ident(g.column_name), ', ' ORDER BY g.column_name) INTO cols
    FROM information_schema.columns g
    JOIN information_schema.columns d
      ON d.table_schema = 'public' AND d.table_name = 'destinations'
     AND d.column_name = g.column_name
   WHERE g.table_schema = 'public' AND g.table_name = 'global_destinations'
     AND g.column_name NOT IN ('id', 'parent_id');
  RAISE NOTICE '059: copying columns — %', cols;

  -- ── Pass 1: match or insert, recording the mapping for every row ─────────────
  -- SET-BASED, in three statements. The first draft looped row by row with a lookup per
  -- row, which is tolerable against the deployment's 2,697 rows and unusable against the
  -- development workspace's 150,422 — it had not finished after two minutes. A migration
  -- that only completes on one of the two databases is not a migration.

  -- The identity lookup is an expression, so without a matching expression index every
  -- probe is a sequential scan of 150,408 rows. Measured: 22 seconds for the deployment's
  -- 2,697 rows, and the workspace has 150,422 to match. Built once here, and KEPT — the
  -- catalogue is matched by (name, dial_prefix) in the merge, in 060, and in every
  -- duplicate hunt afterwards.
  CREATE INDEX IF NOT EXISTS destinations_identity_idx
    ON destinations (lower(trim(name)), coalesce(dial_prefix, ''));

  -- 1a. Rows whose identity already exists in `destinations` map to it and insert nothing.
  EXECUTE '
    INSERT INTO destination_id_map (gd_id, destination_id, matched_by, gd_name, gd_dial_prefix)
    SELECT g.id, d.id, ''identity'', g.name, g.dial_prefix
      FROM global_destinations g
      JOIN LATERAL (SELECT dd.id FROM destinations dd
                     WHERE lower(trim(dd.name)) = lower(trim(g.name))
                       AND coalesce(dd.dial_prefix,'''') = coalesce(g.dial_prefix,'''')
                     ORDER BY dd.id LIMIT 1) d ON TRUE
     WHERE NOT EXISTS (SELECT 1 FROM destination_id_map m WHERE m.gd_id = g.id)';
  GET DIAGNOSTICS n_identity = ROW_COUNT;

  -- 1b. What remains is genuinely new. DISTINCT ON identity, because global_destinations can
  -- hold the same (name, dial_prefix) twice — 052 NULLed 1,135 prefixes, which collapsed a
  -- number of rows onto the same identity — and inserting each of them would import that
  -- duplication into the canonical table.
  --
  -- Ids are drawn from the sequence up front rather than left to the default, so the same
  -- staged rows can be written to `destinations` and to the map without having to correlate
  -- an INSERT ... RETURNING back to its source row.
  CREATE TEMP TABLE _059_new ON COMMIT DROP AS
    SELECT DISTINCT ON (lower(trim(name)), coalesce(dial_prefix,'')) *
      FROM global_destinations g
     WHERE NOT EXISTS (SELECT 1 FROM destination_id_map m WHERE m.gd_id = g.id)
     ORDER BY lower(trim(name)), coalesce(dial_prefix,''), id;
  ALTER TABLE _059_new ADD COLUMN new_id INTEGER;
  EXECUTE format('UPDATE _059_new SET new_id = nextval(%L)', pg_get_serial_sequence('destinations','id'));

  EXECUTE format('INSERT INTO destinations (id, %s) SELECT new_id, %s FROM _059_new', cols, cols);
  GET DIAGNOSTICS n_inserted = ROW_COUNT;

  INSERT INTO destination_id_map (gd_id, destination_id, matched_by, gd_name, gd_dial_prefix)
  SELECT id, new_id, 'inserted', name, dial_prefix FROM _059_new;

  -- 1c. The duplicates 1b deduplicated still need a mapping — onto the row 1b just inserted.
  -- Without this they would be left unmapped and the verify below would refuse.
  EXECUTE '
    INSERT INTO destination_id_map (gd_id, destination_id, matched_by, gd_name, gd_dial_prefix)
    SELECT g.id, d.id, ''identity'', g.name, g.dial_prefix
      FROM global_destinations g
      JOIN LATERAL (SELECT dd.id FROM destinations dd
                     WHERE lower(trim(dd.name)) = lower(trim(g.name))
                       AND coalesce(dd.dial_prefix,'''') = coalesce(g.dial_prefix,'''')
                     ORDER BY dd.id LIMIT 1) d ON TRUE
     WHERE NOT EXISTS (SELECT 1 FROM destination_id_map m WHERE m.gd_id = g.id)';
  GET DIAGNOSTICS n_dupes = ROW_COUNT;
  n_identity := n_identity + n_dupes;

  -- ── Pass 2: parent_id, now that every id is known ────────────────────────────
  -- Only for rows this migration inserted. A row matched by identity already existed in
  -- `destinations` with its own parentage, and overwriting that would let the legacy tree
  -- rewrite the canonical one.
  EXECUTE '
    UPDATE destinations d
       SET parent_id = pm.destination_id
      FROM destination_id_map m
      JOIN global_destinations g ON g.id = m.gd_id
      JOIN destination_id_map pm ON pm.gd_id = g.parent_id
     WHERE d.id = m.destination_id
       AND m.matched_by = ''inserted''
       AND g.parent_id IS NOT NULL
       AND d.parent_id IS DISTINCT FROM pm.destination_id';
  GET DIAGNOSTICS n_parents = ROW_COUNT;

  -- ── Pass 3: level, which is the one copied column that is not an attribute ───
  -- Nine of the copied columns describe the destination — name, prefix, status, notes.
  -- `level` describes its POSITION IN A TREE, and this migration moves it to a different
  -- tree. A gd row at level 3 whose parent maps to a destinations row at level 5 would
  -- arrive claiming depth 3 under a depth-5 parent, and every walk of the hierarchy after
  -- that disagrees with parent_id.
  --
  -- Recomputed from the final parent rather than carried across. Bounded loop because a
  -- chain of inserted rows resolves one level per statement — global_destinations is three
  -- deep, so this settles in three passes; the bound is there so a cycle cannot hang a
  -- deployment boot.
  FOR i IN 1..12 LOOP
    UPDATE destinations d
       SET level = p.level + 1
      FROM destination_id_map m, destinations p
     WHERE d.id = m.destination_id
       AND m.matched_by = 'inserted'
       AND d.parent_id = p.id
       AND d.level IS DISTINCT FROM p.level + 1;
    GET DIAGNOSTICS n_levels = ROW_COUNT;
    n_level_total := n_level_total + n_levels;
    EXIT WHEN n_levels = 0;
  END LOOP;

  -- Merged rows with no parent are roots in the canonical tree, whatever depth they claimed
  -- in the legacy one. 2,399 of the 2,697 are roots, so this is most of them.
  SELECT COALESCE(min(level), 1) INTO root_level FROM destinations WHERE parent_id IS NULL;
  UPDATE destinations d
     SET level = root_level
    FROM destination_id_map m
   WHERE d.id = m.destination_id AND m.matched_by = 'inserted'
     AND d.parent_id IS NULL AND d.level IS DISTINCT FROM root_level;
  GET DIAGNOSTICS n_levels = ROW_COUNT;
  n_level_total := n_level_total + n_levels;

  RAISE NOTICE '059: % global_destinations row(s) — % matched an existing destination by identity, % inserted, % parent link(s) remapped, % level(s) recomputed from the canonical tree.',
               n_total, n_identity, n_inserted, n_parents, n_level_total;
  IF n_dupes > 0 THEN
    RAISE NOTICE '059: % of the matched row(s) were duplicate identities within global_destinations itself, mapped onto the single canonical row rather than imported twice.', n_dupes;
  END IF;
END $$;

-- ── Verify ────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  unmapped   INTEGER;
  dangling   INTEGER;
  orphan_par INTEGER;
  assigns    INTEGER;
  by_status  TEXT;
BEGIN
  IF to_regclass('public.global_destinations') IS NULL THEN RETURN; END IF;

  -- Every legacy id must be translatable. 060 depends on this being total, not partial.
  SELECT count(*) INTO unmapped FROM global_destinations g
   WHERE NOT EXISTS (SELECT 1 FROM destination_id_map m WHERE m.gd_id = g.id);
  IF unmapped > 0 THEN
    RAISE EXCEPTION '059: % global_destinations row(s) have no mapping. 060 would silently leave their references pointing at the wrong destination.', unmapped;
  END IF;

  -- Every mapping must resolve. A map entry naming a destination that does not exist is
  -- worse than no map at all, because 060 would trust it.
  SELECT count(*) INTO dangling FROM destination_id_map m
   WHERE NOT EXISTS (SELECT 1 FROM destinations d WHERE d.id = m.destination_id);
  IF dangling > 0 THEN
    RAISE EXCEPTION '059: % mapping(s) point at a destinations row that does not exist.', dangling;
  END IF;

  -- Inserted rows must not have carried a legacy parent_id across untranslated. That would
  -- attach a merged row to whatever happens to hold that id in the canonical tree.
  SELECT count(*) INTO orphan_par FROM destinations d
    JOIN destination_id_map m ON m.destination_id = d.id AND m.matched_by = 'inserted'
   WHERE d.parent_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM destinations p WHERE p.id = d.parent_id);
  IF orphan_par > 0 THEN
    RAISE EXCEPTION '059: % merged row(s) have a parent_id that resolves to nothing.', orphan_par;
  END IF;

  -- Reported, not enforced: this is what 060 has to translate, and seeing the number here
  -- means the cutover is not the first time anyone counts it.
  SELECT count(*) INTO assigns FROM product_destination_assignments;

  SELECT COALESCE(string_agg(commercial_status || ' ' || n, ', ' ORDER BY n DESC), 'none') INTO by_status
    FROM (SELECT COALESCE(commercial_status,'(null)') AS commercial_status, count(*) AS n
            FROM destinations GROUP BY 1) s;

  RAISE NOTICE '059 verified: every legacy id maps, every mapping resolves. destinations now % rows (%). product_destination_assignments to translate in 060: %.',
    (SELECT count(*) FROM destinations), by_status, assigns;
END $$;

COMMIT;

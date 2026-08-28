-- ER-002 — legacy-id audit across every table holding a destination_id
--
-- Instrument for the pre-Phase-4 task named in
-- docs/DESTINATION-COMMERCIAL-HIERARCHY-PROPOSAL.md:410 ("run, not listed"). ER-001
-- classified `product_rates` alone; this classifies every table, and it must complete
-- before 060/061/062, because retiring `global_destinations` re-points ids whose id space
-- is currently assumed rather than measured.
--
-- Claim:     tables carrying destination_id hold legacy global_destinations ids that must
--            be translated through destination_id_map before their FK is re-pointed.
-- Falsifier: if every value is already a canonical destinations.id, no translation is
--            needed and 060/061 reduce to an FK swap. Per-table, not global — the claim
--            can be true of one table and false of another, and section E reports each
--            separately for exactly that reason.
--
-- ── Two databases, and this script cannot tell you which one you want ────────────────
-- ER-001 established that workspace and production are DIFFERENT stores in different
-- migration states:
--
--     workspace  heliumdb   destinations 150,422   global_destinations 150,422
--     production            destinations 152,950   global_destinations ~2,697
--
-- ER-001's own open item 1a is that it was run against the workspace, where product_rates
-- holds 12 rows with destination_id entirely NULL — a development fixture, not a rate
-- table. The measurement that matters is PRODUCTION. Section A records which database
-- answered, and no result from this script should be carried into a migration decision
-- without that line attached to it.
--
-- ── Discovery, not a hardcoded list ─────────────────────────────────────────────────
-- The proposal's table list was derived from shared/schema.ts and therefore misses
-- `destination_status_history`, which server/routes.ts:38878 creates at RUNTIME with
-- `REFERENCES global_destinations(id) ON DELETE CASCADE`. Section C discovers tables from
-- information_schema instead, so a table created outside Drizzle — or added since this was
-- written — is caught rather than assumed absent.
--
-- ── Pre-written decision rule (registered BEFORE execution) ─────────────────────────
-- Per table:
--   all Canonical                      -> re-point the FK, translate nothing
--   all Legacy                         -> translate every row through destination_id_map
--   mixed Canonical + Legacy           -> translation must be per-row and conditional;
--                                         a blanket UPDATE corrupts the canonical rows
--   any AMBIGUOUS                      -> STOP. This is the 059 trap: an id valid in both
--                                         spaces naming a different destination in each.
--                                         No migration is written until each is resolved
--                                         by hand.
--   any Orphaned                       -> STOP. The id resolves nowhere; translating it
--                                         invents a reference.
--   column entirely NULL               -> UNFALSIFIABLE on this database, as ER-001 found
--                                         for product_rates. Not "no work needed".
-- Recording the rule here is the point: it is fixed before the numbers are seen, so the
-- numbers cannot select the branch.


-- ══ A. Which database is this? ═══════════════════════════════════════════════════════
-- Read this before anything below it. See the header.
SELECT current_database(), current_user, inet_server_addr() AS host, version();


-- ══ B. Populations ═══════════════════════════════════════════════════════════════════
SELECT 'destinations'         AS table_name, count(*) FROM destinations
UNION ALL SELECT 'global_destinations', count(*) FROM global_destinations
UNION ALL SELECT 'destination_id_map',  count(*) FROM destination_id_map;

-- Sequence position — ER-001 used this to prove the two stores are different id spaces.
SELECT pg_get_serial_sequence('destinations','id') AS seq,
       (SELECT max(id) FROM destinations)          AS max_id,
       pg_sequence_last_value(pg_get_serial_sequence('destinations','id')::regclass) AS last_value;


-- ══ C. GATE — destination_id_map semantics ═══════════════════════════════════════════
-- ER-001 found `duplicate_identity` ABSENT on the workspace and could not separate two
-- explanations: the live map predates commit 197f313e, or there were no collapsed
-- duplicates. That ambiguity is unresolved. If it is absent here too, section E's
-- 'Legacy' and 'AMBIGUOUS' counts are still valid — they depend only on gd_id presence —
-- but any 060 that reasons about PROVENANCE must resolve it first.
SELECT matched_by, count(*) AS rows
  FROM destination_id_map GROUP BY matched_by ORDER BY rows DESC;

-- Discovery: every table carrying a destination_id, however it was created.
-- destination_id_map is excluded because its own destination_id column IS the canonical
-- space by construction — classifying it would be circular.
SELECT table_name, is_nullable, data_type
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND column_name  = 'destination_id'
   AND table_name  <> 'destination_id_map'
 ORDER BY table_name;


-- ══ D. Foreign keys still pointing at global_destinations ════════════════════════════
-- 062 cannot drop the table while any of these stand. destination_status_history is
-- expected here and is the one absent from the proposal's list; ON DELETE CASCADE means a
-- careless drop takes the status history with it rather than refusing.
SELECT tc.table_name, kcu.column_name, tc.constraint_name, rc.delete_rule
  FROM information_schema.table_constraints  tc
  JOIN information_schema.key_column_usage   kcu ON kcu.constraint_name = tc.constraint_name
  JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
  JOIN information_schema.referential_constraints rc  ON rc.constraint_name  = tc.constraint_name
 WHERE tc.constraint_type = 'FOREIGN KEY'
   AND ccu.table_name = 'global_destinations'
 ORDER BY tc.table_name;


-- ══ E. The classification, per table ═════════════════════════════════════════════════
-- Method is ER-001's, unchanged: the facts are computed INDEPENDENTLY, then classified. A
-- priority CASE over EXISTS would short-circuit on the canonical branch and make AMBIGUOUS
-- unreachable — the condition being hunted would report as clean.
--
-- ADDED vs ER-001: `in_global`. On the workspace, `destinations` and `global_destinations`
-- were both 150,422 rows, so it carried no information. On production global_destinations
-- holds ~2,697, and it is what separates "orphaned — resolves nowhere" from "legacy id
-- whose gd row still exists".
-- pg_temp-qualified: an unqualified DROP would resolve to a permanent table of the same
-- name if one existed, which is a WRITE on a database this script is only meant to read.
DROP TABLE IF EXISTS pg_temp.er002_report;
CREATE TEMP TABLE er002_report (
  table_name     TEXT,
  population     TEXT,
  classification TEXT,
  n              BIGINT
);

DO $$
DECLARE
  t   TEXT;
  sqlstmt TEXT;
BEGIN
  FOR t IN
    SELECT table_name FROM information_schema.columns
     WHERE table_schema = 'public' AND column_name = 'destination_id'
       AND table_name <> 'destination_id_map'
     ORDER BY table_name
  LOOP
    sqlstmt := format($f$
      WITH ids AS (
        SELECT DISTINCT destination_id AS id FROM %1$I WHERE destination_id IS NOT NULL
      ),
      facts AS (
        SELECT i.id,
               EXISTS (SELECT 1 FROM destinations        d WHERE d.id    = i.id) AS in_destinations,
               EXISTS (SELECT 1 FROM destination_id_map  m WHERE m.gd_id = i.id) AS in_map_as_legacy,
               EXISTS (SELECT 1 FROM global_destinations g WHERE g.id    = i.id) AS in_global,
               (SELECT m.destination_id FROM destination_id_map m WHERE m.gd_id = i.id) AS maps_to
          FROM ids i
      ),
      classified AS (
        SELECT id, in_global,
               CASE
                 WHEN NOT in_destinations AND NOT in_map_as_legacy THEN 'Orphaned'
                 WHEN     in_destinations AND NOT in_map_as_legacy THEN 'Canonical'
                 WHEN NOT in_destinations AND     in_map_as_legacy THEN 'Legacy'
                 WHEN     in_destinations AND     in_map_as_legacy
                      AND maps_to = id                            THEN 'Canonical (already translated)'
                 ELSE                                                  'AMBIGUOUS'
               END AS classification
          FROM facts
      )
      INSERT INTO er002_report
      SELECT %1$L, 'A: identities', classification, count(*) FROM classified GROUP BY 3
      UNION ALL
      SELECT %1$L, 'A: identities',
             classification || ' [gd row still present]', count(*)
        FROM classified WHERE in_global GROUP BY 3
      UNION ALL
      SELECT %1$L, 'B: rows', c.classification, count(*)
        FROM %1$I x JOIN classified c ON c.id = x.destination_id GROUP BY 3
      UNION ALL
      SELECT %1$L, 'B: rows', 'NULL destination_id', count(*)
        FROM %1$I WHERE destination_id IS NULL
    $f$, t);
    EXECUTE sqlstmt;
  END LOOP;
END$$;

-- The report. A table whose only line is 'NULL destination_id' is UNFALSIFIABLE here, not
-- clean — that is the outcome ER-001 recorded for product_rates on the workspace.
SELECT * FROM er002_report
 WHERE n > 0
 ORDER BY table_name, population, n DESC;


-- ══ F. Detail — only where E reported AMBIGUOUS or Orphaned ══════════════════════════
-- Both stop the sprint under the pre-written rule. This is what to look at, and the
-- map_target_name column is the whole point: for an AMBIGUOUS id it names the OTHER
-- destination the same integer refers to.
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT DISTINCT table_name FROM er002_report
            WHERE classification IN ('AMBIGUOUS','Orphaned') AND n > 0
  LOOP
    RAISE NOTICE 'ER-002: % has AMBIGUOUS or Orphaned ids — run the detail query below against it.', t;
  END LOOP;
END$$;

-- Substitute the table name reported above. Deliberately not automated: each row here is
-- resolved by hand, and a loop that printed 200 rows per table would read as a report
-- rather than as the stop condition it is.
--
-- WITH ids AS (SELECT DISTINCT destination_id AS id FROM <table> WHERE destination_id IS NOT NULL)
-- SELECT i.id,
--        d.name            AS destinations_name,
--        g.name            AS global_destinations_name,
--        m.destination_id  AS map_points_to,
--        m2.name           AS map_target_name,
--        m.matched_by
--   FROM ids i
--   LEFT JOIN destinations        d  ON d.id    = i.id
--   LEFT JOIN global_destinations g  ON g.id    = i.id
--   LEFT JOIN destination_id_map  m  ON m.gd_id = i.id
--   LEFT JOIN destinations        m2 ON m2.id   = m.destination_id
--  WHERE d.id IS NULL OR (m.gd_id IS NOT NULL AND m.destination_id <> i.id)
--  ORDER BY i.id LIMIT 200;

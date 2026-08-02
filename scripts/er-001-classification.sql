-- ER-001 — product_rates.destination_id id-space classification
--
-- Run in order. Sections A-C are Environment Validation and MUST be read before
-- section D is trusted: D's classification depends on destination_id_map semantics
-- that migration 059 has drifted away from (recorded ccb74bf97f9f3304, now
-- 28c3fd361fbcc978).
--
-- Claim:     product_rates.destination_id stores legacy global_destinations ids.
-- Falsifier: if the values are already canonical destinations.id values needing no
--            translation through destination_id_map, the claim is false.


-- ══ A. Which database is this? ═══════════════════════════════════════════════
SELECT current_database(), current_user, version();


-- ══ B. Populations ═══════════════════════════════════════════════════════════
-- The design documents cite 152,950 destinations rows; the startup log says
-- 150,422. This settles which population the Sprint 1 target actually is.
SELECT 'destinations'        AS table_name, count(*) FROM destinations
UNION ALL SELECT 'global_destinations',      count(*) FROM global_destinations
UNION ALL SELECT 'destination_id_map',       count(*) FROM destination_id_map
UNION ALL SELECT 'product_rates',            count(*) FROM product_rates;


-- ══ C. GATE — destination_id_map semantics ═══════════════════════════════════
-- If 'duplicate_identity' is ABSENT, the live map was built before commit
-- 197f313e introduced that distinction, and section D must be revised before it
-- is run. This is go/no-go, not a reporting line.
SELECT matched_by, count(*) AS rows
  FROM destination_id_map
 GROUP BY matched_by
 ORDER BY rows DESC;

-- Column assumptions D relies on. Confirm gd_id and destination_id exist as named.
SELECT table_name, column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name IN ('destination_id_map', 'product_rates', 'destinations')
 ORDER BY table_name, ordinal_position;


-- ══ C2. Hierarchy shape — run this in BOTH environments and compare ══════════
-- Workspace measured 2026-08-03: 363 / 11 / 0 / 36 / 150,047.
-- The design documents describe a population with 1,497 / 1,145, which is a
-- DIFFERENT database. 1,497 - 363 = 1,134, and 1,134 + 11 = 1,145: the two
-- reconcile exactly, with 352 countries identical in both. Whichever database
-- this runs against, record which one before reading the numbers.
SELECT count(*) FILTER (WHERE d.level = 1)                             AS level1_total,
       count(*) FILTER (WHERE d.level = 1 AND d.country_code IS NULL)  AS level1_non_country,
       count(*) FILTER (WHERE d.level = 1 AND d.country_code IS NOT NULL) AS level1_countries,
       count(*) FILTER (WHERE d.level = 1 AND m.gd_id IS NOT NULL)     AS hidden_by_mitigation,
       count(*) FILTER (WHERE d.level = 2 AND d.parent_id IS NOT NULL) AS level2_parented,
       count(*) FILTER (WHERE d.level = 2)                             AS level2_total
  FROM destinations d
  LEFT JOIN destination_id_map m ON m.destination_id = d.id AND m.matched_by = 'inserted';

-- What the country picker actually lists today, and what the shipped filter removes.
-- If level1_non_country is large while hidden_by_mitigation is near zero, the
-- filter in rate-manager.tsx:1643 is not what is holding the picker together.
SELECT d.id, d.name, d.country_code, d.dial_prefix, d.commercial_status,
       (m.gd_id IS NOT NULL) AS merged_from_legacy
  FROM destinations d
  LEFT JOIN destination_id_map m ON m.destination_id = d.id AND m.matched_by = 'inserted'
 WHERE d.level = 1 AND d.country_code IS NULL
 ORDER BY d.id
 LIMIT 40;


-- ══ D. The classification ════════════════════════════════════════════════════
-- The two facts are computed INDEPENDENTLY in `facts`, then classified. A
-- priority CASE over EXISTS would short-circuit on the canonical branch and make
-- AMBIGUOUS unreachable — the condition being hunted would report as clean.
WITH ids AS (
  SELECT DISTINCT destination_id AS id
    FROM product_rates
   WHERE destination_id IS NOT NULL
),
facts AS (
  SELECT i.id,
         EXISTS (SELECT 1 FROM destinations       d WHERE d.id    = i.id) AS in_destinations,
         EXISTS (SELECT 1 FROM destination_id_map m WHERE m.gd_id = i.id) AS in_map_as_legacy,
         (SELECT m.destination_id FROM destination_id_map m WHERE m.gd_id = i.id) AS maps_to
    FROM ids i
),
classified AS (
  SELECT id,
         CASE
           WHEN NOT in_destinations AND NOT in_map_as_legacy               THEN 'Orphaned'
           WHEN     in_destinations AND NOT in_map_as_legacy               THEN 'Canonical'
           WHEN NOT in_destinations AND     in_map_as_legacy               THEN 'Legacy'
           WHEN     in_destinations AND     in_map_as_legacy
                AND maps_to = id                                          THEN 'Canonical (already translated)'
           ELSE                                                                'AMBIGUOUS'
         END AS classification
    FROM facts
)
-- Population A — distinct destination identities. The decision rule consumes this.
SELECT 'A: identities' AS population, classification, count(*) AS n
  FROM classified
 GROUP BY classification

UNION ALL
-- Population B — product_rates rows. Blast radius on the certified rate engine.
SELECT 'B: product_rates rows', c.classification, count(*)
  FROM product_rates pr
  JOIN classified c ON c.id = pr.destination_id
 GROUP BY c.classification

UNION ALL
-- Rows with no destination at all, which belong to neither population above.
SELECT 'B: product_rates rows', 'NULL destination_id', count(*)
  FROM product_rates WHERE destination_id IS NULL

 ORDER BY 1, 3 DESC;


-- ══ E. Only if AMBIGUOUS or Orphaned is non-zero ═════════════════════════════
-- The decision rule stops the sprint on either. This lists what to look at.
WITH ids AS (
  SELECT DISTINCT destination_id AS id FROM product_rates WHERE destination_id IS NOT NULL
)
SELECT i.id,
       d.name  AS destinations_name,
       m.destination_id AS map_points_to,
       m2.name AS map_target_name,
       m.matched_by
  FROM ids i
  LEFT JOIN destinations       d  ON d.id  = i.id
  LEFT JOIN destination_id_map m  ON m.gd_id = i.id
  LEFT JOIN destinations       m2 ON m2.id = m.destination_id
 WHERE d.id IS NULL                                  -- orphaned or legacy
    OR (m.gd_id IS NOT NULL AND m.destination_id <> i.id)  -- ambiguous
 ORDER BY i.id
 LIMIT 200;

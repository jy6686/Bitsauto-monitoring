-- 062_pakistan_mobile_commercial_hierarchy.sql
--
-- Pakistan Mobile: connect the commercial operator rows to the tree.
--
-- Numbered 062 because 060 is reserved (see 060_RESERVED.md) and 061 is taken.
-- This is an early, single-country, owner-approved slice of the 063A/B hierarchy
-- repair — approved 2026-08-03 with an explicit target shape:
--
--   Pakistan
--   └── Mobile                          (service type, level 2 — already exists)
--       ├── Pakistan Mobile Jazz  9230  (level 3 — operator)
--       │     └── Jazz 92300            (level 4 — routing series)
--       ├── Pakistan Mobile Jazz  9232  (Legacy Warid — kept separate BY DECISION:
--       │                                customers must see the acquired range)
--       ├── Pakistan Mobile Zong  9231 / 9237
--       │     └── Zong 92310
--       ├── Pakistan Mobile Ufone 9233
--       │     └── Ufone 92333 · Pakistan Mobile 92335718
--       ├── Pakistan Mobile Telenor 9234
--       │     └── Telenor 92345
--       └── Pakistan Mobile SCO 9235 · Pakistan Mobile 9236 · 92391
--
-- ── Why ───────────────────────────────────────────────────────────────────────
-- The commercial rows (`Pakistan Mobile Jazz` 9230 …) have parent_id NULL. They
-- are attached to no tree, so no picker walk can reach them; the Send Rate
-- operator dropdown could only offer the routing series (Jazz 92300), and
-- queueing "Jazz" resolved to 92300 — a rate that covers one tenth of Jazz and
-- silently splits pricing against the 9230 row already in customer tariffs.
--
-- ── Rules ─────────────────────────────────────────────────────────────────────
-- 1. Rows are matched by IDENTITY (name + dial_prefix), never by id. The
--    workspace and the deployment are different id spaces (docs/evidence/ER-001):
--    id 375979 names a different destination in each. An id list that is right
--    on one database is wrong on the other.
-- 2. Prefix containment is arithmetic, not name inference: 92300 goes under 9230
--    because '92300' extends '9230', not because both say "Jazz".
-- 3. No renames. Destination names feed rate notifications and workbooks;
--    changing them is a separate, owner-visible decision.
-- 4. No deletions. The 923 umbrella row, the mis-parented UFONE level-2 node,
--    and the Fixed tier are deliberately untouched — 063 proper.
-- 5. Idempotent: every write is guarded so a second run changes zero rows.
--
-- The RAISE NOTICE lines are the report. On a deployment they appear in the boot
-- log, which is how the production result is read (there is no shell there).

BEGIN;

DO $$
DECLARE
  mobile_id INTEGER;
  n_ops     INTEGER := 0;
  n_series  INTEGER := 0;
  n_notes   INTEGER := 0;
BEGIN
  -- The service-type node: a level-2 `Mobile` under a level-1 `Pakistan`.
  -- Both Pakistan roots are considered; only the ISO root has a Mobile child
  -- today, but this must not depend on which twin carries it.
  SELECT m.id INTO mobile_id
    FROM destinations m
    JOIN destinations p ON p.id = m.parent_id AND p.level = 1
   WHERE lower(trim(m.name)) = 'mobile'
     AND lower(trim(p.name)) = 'pakistan'
   ORDER BY m.id
   LIMIT 1;

  IF mobile_id IS NULL THEN
    RAISE NOTICE '062: no Pakistan -> Mobile node on this database — nothing to repair.';
    RETURN;
  END IF;

  -- ── Pass 1: orphaned commercial rows become operators under Mobile ──────────
  -- The prefix list is the owner-approved commercial set. `9236`, `92391` and
  -- `92335718` carry no operator in their name; they are still Pakistan-mobile
  -- commercial rows and belong under the service type — which operator owns
  -- them (if any) is a later decision, not a guess made here.
  UPDATE destinations d
     SET parent_id = mobile_id,
         level     = 3,
         updated_at = now()
   WHERE d.parent_id IS NULL
     AND lower(trim(d.name)) LIKE 'pakistan mobile%'
     AND d.dial_prefix IN ('9230','9231','9232','9233','9234','9235','9236','9237','92391','92335718');
  GET DIAGNOSTICS n_ops = ROW_COUNT;

  -- ── Pass 2: routing series move under the operator whose prefix they extend ─
  -- Candidates are the rows now sitting directly under Mobile whose dial_prefix
  -- strictly extends another such row's dial_prefix. Longest containing prefix
  -- wins; ties broken by id for determinism. This is what places Jazz 92300
  -- under Jazz 9230 (and 92335718 under Ufone 9233) without reading a name.
  WITH siblings AS (
    SELECT id, dial_prefix
      FROM destinations
     WHERE parent_id = mobile_id AND dial_prefix IS NOT NULL
  ),
  moves AS (
    SELECT s.id AS series_id,
           (SELECT o.id
              FROM siblings o
             WHERE s.dial_prefix LIKE o.dial_prefix || '%'
               AND length(s.dial_prefix) > length(o.dial_prefix)
             ORDER BY length(o.dial_prefix) DESC, o.id
             LIMIT 1) AS operator_id
      FROM siblings s
  )
  UPDATE destinations d
     SET parent_id  = m.operator_id,
         level      = 4,
         updated_at = now()
    FROM moves m
   WHERE d.id = m.series_id
     AND m.operator_id IS NOT NULL
     AND d.parent_id IS DISTINCT FROM m.operator_id;
  GET DIAGNOSTICS n_series = ROW_COUNT;

  -- ── Pass 3: record the Warid provenance where the owner decided it ──────────
  -- Annotation only, never clobbering an existing note.
  UPDATE destinations
     SET notes = 'Legacy Warid range — acquired by Jazz. Kept as a separate commercial prefix by owner decision (2026-08-03): customers must see the acquired range under the Jazz name.'
   WHERE parent_id = mobile_id
     AND dial_prefix = '9232'
     AND notes IS NULL;
  GET DIAGNOSTICS n_notes = ROW_COUNT;

  RAISE NOTICE '062: % commercial row(s) parented under Mobile (level 3), % routing series row(s) moved to the prefix tier (level 4), % Warid note(s) written.',
               n_ops, n_series, n_notes;

  IF n_ops = 0 AND n_series = 0 THEN
    RAISE NOTICE '062: nothing moved — already repaired, or this database holds no matching orphans. Both are fine; the report above is the evidence either way.';
  END IF;
END $$;

-- ── Verify: the shape is readable from the boot log ───────────────────────────
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT o.name AS operator, o.dial_prefix AS prefix, o.level,
           count(s.id) AS series
      FROM destinations p
      JOIN destinations m ON m.parent_id = p.id AND lower(trim(m.name)) = 'mobile'
      JOIN destinations o ON o.parent_id = m.id
      LEFT JOIN destinations s ON s.parent_id = o.id
     WHERE p.level = 1 AND lower(trim(p.name)) = 'pakistan'
     GROUP BY o.id, o.name, o.dial_prefix, o.level
     ORDER BY o.dial_prefix
  LOOP
    RAISE NOTICE '062:   Mobile -> % [%] level=% series_children=%', r.operator, r.prefix, r.level, r.series;
  END LOOP;
END $$;

COMMIT;

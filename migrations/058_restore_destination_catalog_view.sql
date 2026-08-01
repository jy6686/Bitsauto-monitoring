-- 058_restore_destination_catalog_view.sql
--
-- RECOVERY MIGRATION. Re-points destinations_v at global_destinations.
--
-- ── READ THIS FIRST: what the deployment actually reported ─────────────────────
-- On 2026-08-01 this migration refused on the deployment with:
--
--     global_destinations : 2697 rows,    ids 1-2777
--     destinations        : 150408 rows,  ids 1-375977
--       differ by id       : 149547
--       differ by identity : 150255
--
-- That inverts the assumption the rest of this file was written under. It is not that
-- `destinations` is a stale backfill of a healthy global_destinations — on the deployment
-- global_destinations holds 2,697 rows and the operational catalogue lives in
-- `destinations`. Re-pointing the view there would cut the catalogue by 98%.
--
-- It also explains the disappearing approvals exactly. The UI lists rows from
-- destinations_v -> destinations (ids up to 375,977), the operator clicks Approve, and the
-- endpoint runs UPDATE global_destinations ... WHERE id = <that id> against a table whose
-- ids stop at 2,777. Zero rows updated, no error raised.
--
-- And company_markets.destination_id REFERENCES global_destinations(id) (migration 054),
-- so on this database no customer can have a market recorded at all: the wizard sends ids
-- from the catalogue, the FK rejects them, and the insert is caught by a non-fatal handler.
--
-- global_destinations is still the right canonical store — every stored destination id on
-- this database is one of its ids, by FK and by construction. The defect is that it is
-- incompletely populated here. Populating it is migration 059; re-pointing the view is 060.
--
-- WHAT THIS FILE DOES NOW: it refuses, and its refusal carries the composition of those
-- 2,697 rows, so 059 can be written against evidence rather than a guess about what they
-- are. RAISE NOTICE would go to the log pane; the refusal text is what /api/admin/migrations
-- surfaces in lastRun.failed.error, which is the channel proven to work on this deployment.
--
-- ── Why ────────────────────────────────────────────────────────────────────────
-- Phase 1 of the destination migration introduced a canonical `destinations` table
-- (Step 1), backfilled it from global_destinations (Step 2), and created destinations_v
-- as a compatibility view over it (Step 3). Step 3's own instructions were explicit:
--
--     "Next step: Deploy. 24-48h read soak before switching any consumers."
--     "DO NOT switch any read consumer until after soak completes."
--     "DO NOT proceed to FK repoint or write migration until soak is confirmed clean."
--
-- Eight read consumers were switched to destinations_v anyway. The write migration that
-- was supposed to follow never happened, so today:
--
--     WRITES  ->  global_destinations   11 sites in routes.ts
--                 destinations           0 sites
--     READS   <-  destinations_v         8 sites  ->  SELECT ... FROM destinations
--                 global_destinations    2 sites
--
-- Every approval, block, status change and edit lands in global_destinations. The
-- catalogue reads a table that has received nothing since the backfill. That is why the
-- UI reports 0 destinations, why bulk-reset appeared to do nothing, and why approvals
-- "disappear" — they are written to a table nobody reads.
--
-- ── What this does, and does not, do ───────────────────────────────────────────
-- Re-points the view at the table that actually holds the writes. That is all.
--
--   - No data moves. `destinations` is left exactly as it is.
--   - No application code changes. The view keeps the same 11-column interface, so all
--     eight read consumers work unchanged.
--   - Reversible: point the same view back at `destinations`.
--
-- This is a TEMPORARY RESTORATION, not the end state. Phase 1 remains the plan: finish
-- the write migration, move all 11 write sites onto `destinations`, run the soak the
-- design asked for, then retire this view. Re-pointing simply returns the system to the
-- pre-switch state Step 3 intended, so the migration can be completed deliberately rather
-- than under an outage.
--
-- ── The condition this is only safe under ──────────────────────────────────────
-- It is safe if `destinations` has received no independent writes — i.e. it holds a
-- subset of global_destinations and nothing of its own. If it has rows global_destinations
-- does not, re-pointing would HIDE them, and this migration REFUSES to run rather than
-- do that quietly. The check is here rather than in a runbook because a check in a runbook
-- is a check somebody skips.
--
-- Idempotent.

BEGIN;

DO $$
DECLARE
  has_dest   BOOLEAN;
  gd_count   BIGINT;
  d_count    BIGINT := NULL;
  orphans    BIGINT := 0;
  gd_only    BIGINT := 0;
  shared_n   BIGINT := 0;
  by_identity BIGINT := 0;
  d_min BIGINT; d_max BIGINT; g_min BIGINT; g_max BIGINT;
  gd_shape   TEXT;
  gd_prefix  TEXT;
  gd_origin  TEXT;
  gd_age     TEXT;
  d_age      TEXT;
  fk_to_dest TEXT;
  refs       TEXT := '';
  t          RECORD;
  n_only_d   BIGINT;
  n_total    BIGINT;
BEGIN
  IF to_regclass('public.global_destinations') IS NULL THEN
    RAISE EXCEPTION 'global_destinations does not exist — this database is not in the state 058 expects.';
  END IF;
  EXECUTE 'SELECT count(*) FROM global_destinations' INTO gd_count;

  has_dest := to_regclass('public.destinations') IS NOT NULL;

  IF has_dest THEN
    EXECUTE 'SELECT count(*) FROM destinations' INTO d_count;

    -- Rows that exist ONLY in destinations. Any of these would become invisible the
    -- moment the view is re-pointed, so their presence means this is no longer a simple
    -- rollback and needs a real reconciliation.
    EXECUTE 'SELECT count(*) FROM destinations d
              WHERE NOT EXISTS (SELECT 1 FROM global_destinations g WHERE g.id = d.id)'
       INTO orphans;

    IF orphans > 0 THEN
      -- REPORT ENOUGH TO DECIDE, not just enough to stop. The first run of this guard
      -- said only "destinations holds 149547 row(s) that global_destinations does not",
      -- which is true and does not distinguish the two cases that matter:
      --
      --   ids preserved   -> the tables genuinely hold different populations
      --   ids renumbered  -> the same destinations exist in both under different ids,
      --                      and an id-based comparison means nothing
      --
      -- Step 2 used a backfill this migration cannot see, so the second is entirely
      -- possible. Comparing on (name, dial_prefix) as well as on id separates them, and
      -- there is no way to run that query by hand against this database.
      EXECUTE 'SELECT count(*) FROM (
                 SELECT lower(trim(name)) n, coalesce(dial_prefix,'''') p FROM destinations
                 EXCEPT
                 SELECT lower(trim(name)) n, coalesce(dial_prefix,'''') p FROM global_destinations) x'
         INTO by_identity;
      EXECUTE 'SELECT min(id), max(id) FROM destinations'         INTO d_min, d_max;
      EXECUTE 'SELECT min(id), max(id) FROM global_destinations'  INTO g_min, g_max;

      -- ── WHAT the small table is made of ─────────────────────────────────────
      -- 059 has to insert ~150k rows into global_destinations, and what it must NOT do is
      -- duplicate or displace whatever is already there. Three questions decide that, and
      -- none of them can be answered from outside this database.

      -- 1. Shape. A commercial-only tree looks nothing like a partial catalogue import:
      --    the first is a handful of levels with every row approved, the second is one
      --    level with mixed status.
      EXECUTE $q$
        SELECT COALESCE(string_agg(txt, ', ' ORDER BY lvl, txt), 'none') FROM (
          SELECT COALESCE(level, -1) AS lvl,
                 'L' || COALESCE(level::TEXT,'?') || '/' || COALESCE(commercial_status,'(null)')
                   || ' ' || count(*) AS txt
            FROM global_destinations GROUP BY level, commercial_status) s
      $q$ INTO gd_shape;

      -- 2. Prefixes vs hierarchy nodes. Rows with no dial_prefix are structure; rows with
      --    one are sellable. The ratio says whether this is a tree or a price list.
      EXECUTE $q$
        SELECT 'with prefix ' || count(*) FILTER (WHERE dial_prefix IS NOT NULL)
            || ', without ' || count(*) FILTER (WHERE dial_prefix IS NULL)
            || ', roots '   || count(*) FILTER (WHERE parent_id IS NULL)
          FROM global_destinations
      $q$ INTO gd_prefix;

      -- 3. Provenance. 053 stamps its rows in notes, and anything else with a note is a
      --    row somebody touched deliberately. Both must survive 059 untouched.
      EXECUTE $q$
        SELECT 'from migration 053: ' || count(*) FILTER (WHERE notes LIKE '%migration 053%')
            || ', IBIS cleared by 052: ' || count(*) FILTER (WHERE notes LIKE '%IBIS code:%')
            || ', other noted: ' || count(*) FILTER (WHERE notes IS NOT NULL
                                                       AND notes NOT LIKE '%migration 053%'
                                                       AND notes NOT LIKE '%IBIS code:%')
          FROM global_destinations
      $q$ INTO gd_origin;

      -- WHEN each table was written. If global_destinations stopped receiving rows on the
      -- day `destinations` was populated, the import went to the wrong table; if it is
      -- still being written today, both are live and 059 is riskier than it looks.
      EXECUTE $q$SELECT COALESCE(min(created_at)::DATE || ' .. ' || max(created_at)::DATE, 'no created_at values')
                   FROM global_destinations$q$ INTO gd_age;
      BEGIN
        EXECUTE $q$SELECT COALESCE(min(created_at)::DATE || ' .. ' || max(created_at)::DATE, 'no created_at values')
                     FROM destinations$q$ INTO d_age;
      EXCEPTION WHEN undefined_column THEN d_age := 'no created_at column';
      END;

      -- ── Is `destinations` ALREADY an identity anybody stores? ────────────────
      -- The whole case for populating global_destinations rather than switching to
      -- destinations rests on nothing storing a destinations id. That is an assumption
      -- until it is counted. Declared FKs first —
      EXECUTE $q$
        SELECT COALESCE(string_agg(DISTINCT conrelid::regclass || '.' || a.attname, ', '), 'none')
          FROM pg_constraint c
          JOIN unnest(c.conkey) WITH ORDINALITY k(attnum, ord) ON TRUE
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
         WHERE c.contype = 'f' AND c.confrelid = 'destinations'::regclass
      $q$ INTO fk_to_dest;

      -- — and then the data itself, which is what actually matters. A column with no FK can
      -- still be full of ids that only resolve in `destinations`, and every one of those is
      -- a row 059 would have to remap. Counted per table so the answer names the work.
      FOR t IN
        SELECT c.table_name AS tbl
          FROM information_schema.columns c
         WHERE c.table_schema = 'public' AND c.column_name = 'destination_id'
           AND c.table_name <> 'destinations'
         ORDER BY c.table_name
      LOOP
        EXECUTE format(
          'SELECT count(*), count(*) FILTER (WHERE destination_id IS NOT NULL
             AND EXISTS (SELECT 1 FROM destinations d WHERE d.id = destination_id)
             AND NOT EXISTS (SELECT 1 FROM global_destinations g WHERE g.id = destination_id))
             FROM %I', t.tbl) INTO n_total, n_only_d;
        IF n_only_d > 0 THEN
          refs := refs || format(E'\n    %s : %s of %s rows resolve ONLY in destinations', t.tbl, n_only_d, n_total);
        END IF;
      END LOOP;
      IF refs = '' THEN refs := E'\n    none — every stored destination_id resolves in global_destinations'; END IF;

      RAISE EXCEPTION E'Cannot re-point the view — the two tables disagree.\n'
        '  global_destinations : % rows, ids %-%, created %\n'
        '  destinations        : % rows, ids %-%, created %\n'
        '  rows in destinations with an id global_destinations lacks   : %\n'
        '  rows in destinations with a (name, dial_prefix) it lacks     : %\n\n'
        'COMPOSITION of global_destinations — what 059 must not disturb:\n'
        '  shape      : %\n'
        '  prefixes   : %\n'
        '  provenance : %\n\n'
        'IS `destinations` ALREADY AN IDENTITY?\n'
        '  declared FKs to destinations : %\n'
        '  stored ids that resolve only in destinations :%\n\n'
        'If the last section is empty, global_destinations is the sole identity store and 059 '
        'can populate it additively. If it is not, those rows must be remapped first and 059 '
        'is no longer a simple insert.',
        gd_count, g_min, g_max, gd_age,
        d_count, d_min, d_max, d_age,
        orphans, by_identity,
        gd_shape, gd_prefix, gd_origin,
        fk_to_dest, refs;
    END IF;

    -- Both directions, recorded even though only one of them can block. In six months
    -- somebody will ask what exactly differed at the moment of the switch, and the answer
    -- should be in the migration log rather than reconstructed from two tables that have
    -- moved on since.
    EXECUTE 'SELECT count(*) FROM global_destinations g
              WHERE NOT EXISTS (SELECT 1 FROM destinations d WHERE d.id = g.id)'
       INTO gd_only;
    shared_n := gd_count - gd_only;

    RAISE NOTICE 'Diff at switch — global_destinations %, destinations %; shared %, only in global % (written since the backfill), only in destinations % (would be hidden).',
                 gd_count, d_count, shared_n, gd_only, orphans;
  ELSE
    RAISE NOTICE 'No `destinations` table on this database — Phase 1 Steps 1-2 never ran here. The view will be created over global_destinations, which is the correct source either way.';
  END IF;
END $$;

-- DROP then CREATE, not CREATE OR REPLACE. Replace requires identical column types, and
-- the two tables differ (country_code is varchar(4) on global_destinations, varchar(3) as
-- the view currently presents it) — replace would fail with "cannot change data type of
-- view column". No CASCADE: if something depends on this view, this migration should stop
-- and say so rather than drop the dependent object.
DROP VIEW IF EXISTS destinations_v;

-- TWELVE columns, not eleven. This file said "exactly the 11 columns Step 3 defined" and
-- asserted 11 below, but shared/destinations-view.ts declares TWELVE — the eleven plus
-- created_at. Drizzle's .existing() means nothing validates that at build time, so the
-- mismatch would have surfaced as a runtime error on any consumer selecting createdAt, or
-- as this migration failing its own verify. Caught before it ever applied; the interface
-- the read consumers actually use is the one that has to be reproduced here.
CREATE VIEW destinations_v AS
SELECT
  id,
  parent_id,
  level,
  name,
  country_code,
  dial_prefix,
  operator_name,
  commercial_status,
  sort_order,
  notes,
  blocked_reason,
  created_at
FROM global_destinations;

COMMENT ON VIEW destinations_v IS
  'Compatibility view over global_destinations. TEMPORARY: Phase 1 moves the canonical store to `destinations`, at which point this is re-pointed there and then retired. Re-pointed to global_destinations by migration 058 because all 11 write sites target it while the reads had already been switched — see the migration for the full history.';

-- ── Verify ────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_count BIGINT;
  n_cols  INTEGER;
  by_stat TEXT;
BEGIN
  EXECUTE 'SELECT count(*) FROM destinations_v' INTO v_count;
  SELECT count(*) INTO n_cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'destinations_v';

  IF n_cols <> 12 THEN
    RAISE EXCEPTION 'destinations_v has % columns, expected 12 (the 11 of Step 3 plus created_at, which shared/destinations-view.ts declares) — the read consumers depend on this exact interface.', n_cols;
  END IF;

  -- The status breakdown the catalogue header will now show, recorded here so validating
  -- the deployment is reading a log line rather than clicking through a UI. Aggregated
  -- rather than five hardcoded counters, so a status nobody anticipated still appears.
  EXECUTE $q$
    SELECT COALESCE(string_agg(commercial_status || ' ' || n, ', ' ORDER BY n DESC), 'none')
      FROM (SELECT COALESCE(commercial_status,'(null)') AS commercial_status, count(*) AS n
              FROM destinations_v GROUP BY 1) s
  $q$ INTO by_stat;

  RAISE NOTICE 'destinations_v now reads global_destinations: % rows, % columns. The catalogue shows what the writes actually did.', v_count, n_cols;
  RAISE NOTICE 'Status breakdown: %', by_stat;
END $$;

COMMIT;

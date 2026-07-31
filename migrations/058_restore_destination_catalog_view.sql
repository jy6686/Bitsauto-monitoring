-- 058_restore_destination_catalog_view.sql
--
-- RECOVERY MIGRATION. Re-points destinations_v at global_destinations.
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
      RAISE EXCEPTION
        'destinations holds % row(s) that global_destinations does not. Re-pointing the view would hide them. This needs a reconciliation, not a rollback — compare the two tables before proceeding.', orphans;
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

-- Exactly the 11 columns Step 3 defined. Not ten, not twelve — the whole point of the
-- shim is that Drizzle read consumers need zero changes.
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
  blocked_reason
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

  IF n_cols <> 11 THEN
    RAISE EXCEPTION 'destinations_v has % columns, expected 11 — the read consumers depend on this exact interface.', n_cols;
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

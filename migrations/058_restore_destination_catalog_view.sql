-- 058_restore_destination_catalog_view.sql
--
-- ABANDONED. This migration proposed re-pointing destinations_v at global_destinations.
-- It was wrong, it never applied, and it is retained as a no-op because its refusal is
-- what produced the evidence the rest of Phase A is built on.
--
-- KEPT UNDER ITS ORIGINAL NAME DELIBERATELY. The runner identifies migrations by filename,
-- and this file may already be recorded as applied on the development workspace — where the
-- guard passed, because there global_destinations legitimately is a superset. Renaming it
-- would make that database run the replacement as if it had never seen it. Keeping the name
-- means a database that already applied 058 skips it, and 060 corrects the view there.
--
-- ── What it wanted to do, and why that was backwards ───────────────────────────
-- The premise was that global_destinations holds the writes and `destinations` is a stale
-- Phase 1 backfill, so the catalogue could be restored by pointing the view back. Three
-- rounds of diagnostics on the deployment said otherwise:
--
--     global_destinations : 2,697 rows,   created 2026-06-05 .. 2026-08-01
--     destinations        : 150,408 rows, created 2026-07-04 only
--     shape       : 35 approved of 2,697; 2,421 rows carry no dial prefix
--     provenance  : 1,135 rows had an IBIS code cleared from dial_prefix by 052
--     identity    : only 149 of the 2,697 exist in `destinations`
--
-- The July 4 bulk import went into `destinations` and never into global_destinations, which
-- has since received only migration and UI writes and is substantially the residue of the
-- Bulk Import parser defect. Applying this migration would have cut the visible catalogue
-- from 150,408 rows to 2,697 — a 98% loss, silently, with no error.
--
-- The guard is the reason that did not happen. It is worth more than the migration was.
--
-- ── What the diagnostics settled ───────────────────────────────────────────────
-- `destinations` is canonical. It is Phase 1's intended store, it holds the real catalogue,
-- and no production row depends exclusively on a global_destinations id:
--
--     every destination_id column : gd-only 0, dest-only 0, orphan 0
--     with data                   : product_destination_assignments 52 (both), nothing else
--     empty                       : company_markets, destination_aliases, destination_product_rates,
--                                   destination_status_history, product_destination_mappings,
--                                   destination_group_members, destination_health
--     no triggers, no functions, no materialised views, no scheduled jobs
--
-- "both 52" is the one hazard, and it is not a safe bucket — an earlier comment in this file
-- called it "safe either way", which was wrong. Those ids resolve in BOTH tables, and since
-- only ~150 rows share an identity across the two, id 1500 in one is a different destination
-- from id 1500 in the other. 053 wrote those 52 rows against global_destinations. Moving
-- canonical without remapping them re-points every one at a different destination, with no
-- FK violation to announce it. 059 builds the id map; 060 applies it.
--
-- The full report is frozen in docs/DESTINATION-MIGRATION-REPORT.md.
--
-- ── Why a no-op rather than a deletion ─────────────────────────────────────────
-- The runner halts on the first failure, so leaving this file refusing would block 059, 060
-- and everything after it — the same trap 051-after-049 and 059-after-053 fell into twice
-- this week. Deleting it instead would leave a gap in the numbering and erase the record of
-- a decision that took a day to reach. It succeeds, records itself, and explains itself.

BEGIN;

DO $$
BEGIN
  RAISE NOTICE '058 is a no-op. Re-pointing destinations_v at global_destinations was abandoned: the deployment holds 2,697 rows there against 150,408 in `destinations`, and applying it would have cut the catalogue by 98%%. `destinations` is canonical — see docs/DESTINATION-MIGRATION-REPORT.md. The merge is 059, the cutover is 060.';
END $$;

COMMIT;

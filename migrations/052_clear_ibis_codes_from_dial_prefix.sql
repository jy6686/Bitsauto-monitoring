-- 052_clear_ibis_codes_from_dial_prefix.sql
--
-- A dial prefix is digits. Some rows hold a vendor's IBIS code instead.
--
-- ── Why 052 and not 059 ────────────────────────────────────────────────────────
-- This was written as 059 and could never have run. The runner HALTS on the first
-- failure, so 053 fails, 054-059 are never reached, and the migration that makes 053
-- pass sits permanently behind the migration it fixes. Exactly the trap 051 fell into
-- against 049 earlier in the same week: "051 exists to repair this and can never help,
-- because the runner halts at 049."
--
-- A repair has to sort BEFORE the check it satisfies. Files are identified by NAME, not
-- by number — there are already two 030_ files — so this takes 052 and sorts ahead of
-- 052_seed_commercial_destinations.sql on the 'c' < 's', which is harmless: that file is
-- already in the ledger and is skipped. The runner then reaches 053 with the data clean.
--
-- Rule worth keeping: if a migration exists to unblock another, its number must be lower.
-- The ledger will not save you — an unreachable file is never recorded as failed either.
--
-- ── What happened ──────────────────────────────────────────────────────────────
-- 053 halts the deployment with:
--
--   1 dial_prefix value(s) have more than one approved catalogue entry:
--     PAK -> 1872 PAK Pakistan | 1874 PAK Fixed SCOGSM | 1876 PAK Islamabad
--            | 1878 PAK Karachi | 1880 PAK Lahore | 1882 PAK Mobile
--            | 1884 PAK Mobile MOBLIN Pakistan Mobile Jazz | 1886 PAK Mobile SCOGSM
--            | 1888 PAK Mobile TELNOR | 1890 PAK Mobile UFONE
--            | 1892 PAK Mobile PAKTEL Pakistan Mobile Zong
--
-- `PAK` is not a dial prefix. It is the IBIS code from column A of the carrier price
-- list — the same column that carries `AFG Mobile AWCC`. An import mapped it into
-- dial_prefix. Eleven consecutive even ids point at one batch and one wrong mapping.
--
-- The Bulk Import screen is still capable of doing this: its preview currently reads a
-- rate-offer cover letter as destinations, offering "CITIC Telecom Tower" as a prefix.
-- This migration cleans up the instance already in the data; the parser is Vendor Sheets
-- Sprint 2 and is what stops it recurring.
--
-- ── Why NULL rather than a guess ───────────────────────────────────────────────
-- These are real destinations — Jazz, Telenor, Ufone, Zong — wearing the wrong prefix.
-- Deprecating them would remove live Pakistani operators from the catalogue over a data
-- entry error. Inventing prefixes (Jazz = 92300?) would be this migration deciding
-- commercial routing, which is exactly what 050 refused to do and for the same reason:
-- a wrong prefix silently misroutes calls, and being confidently wrong is worse than
-- being explicitly unknown.
--
-- NULL says "no prefix recorded", which is true. The destinations stay approved and
-- visible; 053's guard skips NULL; someone enters the real prefixes as a deliberate
-- commercial act.
--
-- THE IBIS CODE IS NOT DISCARDED. It moves to notes, so the mapping back to the vendor's
-- sheet survives and the real prefixes can be reconstructed from it later.
--
-- ── Scope ──────────────────────────────────────────────────────────────────────
-- Every row whose dial_prefix is not purely digits, not just PAK. Only PAK tripped the
-- guard because only it has more than one APPROVED row; a single-approved IBIS code
-- passes 053 and is equally wrong. Fixing the class costs nothing extra and means this
-- cannot resurface as a different country next week.
--
-- Idempotent: rows already cleared have a NULL prefix and are not matched again.

BEGIN;

DO $$
DECLARE
  r          RECORD;
  changed    INTEGER := 0;
  listed     INTEGER := 0;
BEGIN
  IF to_regclass('public.global_destinations') IS NULL THEN
    RAISE NOTICE 'global_destinations absent — nothing to clean.';
    RETURN;
  END IF;

  -- Name them before changing them. A migration that edits commercial data should leave
  -- a record of exactly which rows it touched, in the deployment log, where an operator
  -- reviewing the change afterwards will actually look.
  FOR r IN
    SELECT id, name, dial_prefix, commercial_status
      FROM global_destinations
     WHERE dial_prefix IS NOT NULL AND dial_prefix !~ '^[0-9]+$'
     ORDER BY dial_prefix, id
     LIMIT 50
  LOOP
    RAISE NOTICE '  clearing %  id=%  %  (%)', r.dial_prefix, r.id, r.name, r.commercial_status;
    listed := listed + 1;
  END LOOP;

  UPDATE global_destinations
     SET notes = CASE
                   WHEN notes IS NULL OR notes = '' THEN 'IBIS code: ' || dial_prefix || ' (moved from dial_prefix by migration 059)'
                   ELSE notes || E'\nIBIS code: ' || dial_prefix || ' (moved from dial_prefix by migration 059)'
                 END,
         dial_prefix = NULL
   WHERE dial_prefix IS NOT NULL AND dial_prefix !~ '^[0-9]+$';
  GET DIAGNOSTICS changed = ROW_COUNT;

  IF changed = 0 THEN
    RAISE NOTICE 'No non-numeric dial_prefix values — nothing to clean (this database is already correct, or 059 has run).';
  ELSE
    RAISE NOTICE '% row(s) cleared%. The IBIS code is preserved in notes. These destinations remain approved with no prefix recorded — enter the real prefixes in the Destination Catalogue as a commercial task.',
                 changed, CASE WHEN listed < changed THEN ' (' || listed || ' listed above)' ELSE '' END;
  END IF;
END $$;

-- ── Verify ────────────────────────────────────────────────────────────────────
-- Confirms the specific condition 053 halts on, so the two migrations cannot disagree
-- about whether the database is ready.
DO $$
DECLARE
  bad    INTEGER;
  dupes  INTEGER;
BEGIN
  SELECT count(*) INTO bad
    FROM global_destinations
   WHERE dial_prefix IS NOT NULL AND dial_prefix !~ '^[0-9]+$';
  IF bad > 0 THEN
    RAISE EXCEPTION '% non-numeric dial_prefix value(s) remain after the update', bad;
  END IF;

  SELECT count(*) INTO dupes FROM (
    SELECT dial_prefix FROM global_destinations
     WHERE commercial_status = 'approved' AND dial_prefix IS NOT NULL
     GROUP BY dial_prefix HAVING count(*) > 1) d;

  IF dupes > 0 THEN
    -- Not fatal here: 053 owns that check and will name them. Said now so the next halt
    -- is expected rather than a surprise.
    RAISE NOTICE 'Note: % dial_prefix value(s) still have more than one approved entry — NUMERIC duplicates, a different problem from IBIS codes. 053 will name them.', dupes;
  ELSE
    RAISE NOTICE 'No duplicate approved dial_prefix values remain. 053 should now pass.';
  END IF;
END $$;

COMMIT;

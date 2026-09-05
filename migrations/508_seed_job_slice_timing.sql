-- Where a slice's wall clock goes, recorded AS THE RUN GOES.
--
-- The collector already timed each slice and each XML-RPC page, but both lived
-- in memory and were summarised only after all 48 slices finished. A job that
-- died at slice 3 produced nothing — and dying part-way is the failure mode
-- under investigation, so the telemetry was missing from exactly the runs that
-- needed it. recon-2026-09-03-685 stopped at 2/48 and left no timing at all.
--
-- Its absence was then filled by a number that looked like a measurement: the
-- panel showed "2.0h elapsed, 2/48 slices", which was read as sixty minutes a
-- slice. That was the reaper's sweep interval, not work.
--
-- One JSONB column, rewritten at every slice boundary by the same progress()
-- call that already updates completed_slices — so a killed job keeps whatever
-- it had measured up to its last write. Holds the fetch/store/other split, the
-- slowest slice so far, and which phase dominates.
--
-- Nullable and unwritten by older rows: a run that predates this column has no
-- timing, and must say so rather than report zeros. Same rule as 507.

BEGIN;

ALTER TABLE seed_jobs ADD COLUMN IF NOT EXISTS slice_timing JSONB;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'seed_jobs' AND column_name = 'slice_timing') THEN
    RAISE EXCEPTION '508: seed_jobs.slice_timing missing after apply.';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'seed_jobs' AND column_name = 'slice_timing'
                AND (is_nullable <> 'YES' OR column_default IS NOT NULL)) THEN
    RAISE EXCEPTION '508: slice_timing must be nullable with no default — a run '
                    'that recorded nothing must not report zeros.';
  END IF;
  RAISE NOTICE '508: slice timing is recorded per slice, so a killed job keeps it.';
END$$;

COMMIT;

-- Two events that were collapsed into one timestamp.
--
-- When a run is killed, two distinct things happen at two distinct times:
-- work stops, and — up to ninety minutes later — the reaper notices. The
-- reaper wrote finished_at = now() and updated_at = now(), so both events
-- collapsed onto the sweep, and every consumer computed
-- elapsed = sweep − started.
--
-- recon-2026-09-03-685 then read as "2.0h elapsed · 2.0h working · 100%
-- productive · 2/48 slices", and that was reported as sixty minutes per slice
-- (2026-09-05). The job had not worked for two hours. The reaper had been
-- running for two hours since the job's last write, and the panel rendered the
-- sweep interval as a measurement.
--
-- Commit 6647d286 set finished_at = updated_at, which recovers the work window
-- but overloads one column: for a completed job finished_at is the real
-- finish, for a reaped one it is last-progress, and nothing distinguishes them
-- without also reading status. Two columns say it plainly instead.
--
--   last_progress_at  the last slice that actually completed. Written by
--                     progress(), never by the reaper.
--   reaped_at         when the sweep declared the job dead. Written only by
--                     the reaper, so its presence IS the "was killed" flag.
--
-- Both nullable and unwritten by older rows: a run that predates them has no
-- such record and must say so rather than report a zero or a borrowed time.
-- Same rule as 507 and 508.

BEGIN;

ALTER TABLE seed_jobs ADD COLUMN IF NOT EXISTS last_progress_at TIMESTAMPTZ;
ALTER TABLE seed_jobs ADD COLUMN IF NOT EXISTS reaped_at        TIMESTAMPTZ;

DO $$
DECLARE missing text;
BEGIN
  SELECT string_agg(c, ', ') INTO missing
    FROM unnest(ARRAY['last_progress_at','reaped_at']) AS c
   WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_name = 'seed_jobs' AND column_name = c);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION '509: columns missing after apply: %', missing;
  END IF;

  -- Nullable with no default, for the same reason 507 removed one: a run that
  -- recorded nothing must not report a value it never measured.
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'seed_jobs'
                AND column_name IN ('last_progress_at','reaped_at')
                AND (is_nullable <> 'YES' OR column_default IS NOT NULL)) THEN
    RAISE EXCEPTION '509: both columns must be nullable with no default.';
  END IF;

  RAISE NOTICE '509: last progress and the reaper sweep are now separate facts.';
END$$;

COMMIT;

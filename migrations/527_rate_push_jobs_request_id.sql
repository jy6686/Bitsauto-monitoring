-- 527: the submission a job belongs to, and a rate_type wide enough for the values already stored.
--
-- TWO CORRECTIONS TO THE SAME TABLE, both additive, neither touching a stored value.
--
-- 1. `rate_type` WIDENS TO 64. The declaration has been wrong, not the data. `shared/schema.ts`
--    and `migrations/0000_robust_iron_man.sql` both declare varchar(16), while the
--    change-client-rates route writes the literal 'change-client-rate' — EIGHTEEN characters.
--    Production and DEV are both varchar(64) by undocumented drift, so that route works there by
--    accident rather than by contract. Any environment built from the migrations gets 16 and
--    breaks on the first change push, and the PGlite fixtures use 64, so no test catches it.
--    The fix has exactly one safe direction: the declaration comes UP to the live width. Bringing
--    the live column DOWN to 16 would break production and make the stored 'change-client-rate'
--    rows unrepresentable. On both live databases this statement is therefore a NO-OP — that is
--    the intended successful outcome. It exists so that a fresh install and a live database stop
--    disagreeing about what this column is.
--
-- 2. `request_id` IS ADDED, nullable. One Send Rate submission currently becomes one job row even
--    when it targets several accounts, so one status, one Retry and one error message have to
--    stand for outcomes that are already independent in execution (job-1790249867200: aura 6/6
--    confirmed, test-31 0/6, collapsed into a single "Partial" row an operator cannot act on
--    per account). The record boundary is what is wrong, not the isolation. `request_id` is the
--    key that lets one submission become N sibling job rows that can be found, polled and
--    reported together while succeeding or failing separately.
--
--    This migration adds the column and its index ONLY. No route writes it yet; nothing reads it
--    yet. The per-account split is a separate, behavioural change that lands afterwards.
--
--    EXISTING ROWS STAY NULL, deliberately. There is no backfill and none should be added later:
--    a NULL request_id means "submitted before submissions had identity", which is true, and
--    inventing a synthetic one per historical job would fabricate a grouping that never existed.
--    NULL is the clean boundary between the two eras.
--
-- The index is NON-UNIQUE — siblings share a request_id, that is its entire purpose — and partial,
-- so the legacy NULL rows cost nothing. Contrast 525's `client_request_id`, which is the CALLER's
-- own idempotency key and is uniquely indexed because a repeat must resolve to one job.
BEGIN;

ALTER TABLE rate_push_jobs ALTER COLUMN rate_type TYPE VARCHAR(64);

ALTER TABLE rate_push_jobs ADD COLUMN IF NOT EXISTS request_id VARCHAR(64);

CREATE INDEX IF NOT EXISTS rate_push_jobs_request_id_idx
  ON rate_push_jobs (request_id)
  WHERE request_id IS NOT NULL;

DO $$
DECLARE rate_type_width INTEGER;
DECLARE request_id_width INTEGER;
BEGIN
  SELECT character_maximum_length INTO rate_type_width
    FROM information_schema.columns
    WHERE table_name = 'rate_push_jobs' AND column_name = 'rate_type';
  IF rate_type_width IS NULL OR rate_type_width < 64 THEN
    RAISE EXCEPTION 'rate_push_jobs.rate_type is not at least 64 wide after migration 527';
  END IF;

  SELECT character_maximum_length INTO request_id_width
    FROM information_schema.columns
    WHERE table_name = 'rate_push_jobs' AND column_name = 'request_id';
  IF request_id_width IS NULL THEN
    RAISE EXCEPTION 'rate_push_jobs.request_id was not created by migration 527';
  END IF;
END $$;

COMMIT;

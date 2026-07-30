-- 055_provisioning_step_detail.sql
-- Give a provisioning step somewhere to record WHAT IT DID.
--
-- Every executor already builds one. rates.step reports the row count, the per-product
-- breakdown and that the prices are effective immediately; authentication.step reports the
-- planned set, how many were reused and how many created. The runner assembles it, appends
-- "read-back: verified", logs it once — to a console saturated with AMI events — and then
-- writes status, result, reason_code, error and trace_id to provisioning_steps. Not detail.
-- There was no column for it.
--
-- So a successful step could say nothing but "✓ Authentication & IP Authorisation · 4.1s",
-- and a failed one only the single `error` sentence. The operator's question after a run is
-- not "did it pass" — the tick answers that — it is "what exists on the switch now", and
-- the answer was already written and then discarded.
--
-- TEXT holding a JSON array of strings, matching `result`. Not JSONB and not a child table:
-- these are display lines, read as a block by one panel, never queried by element.
--
-- Idempotent. Additive and nullable — existing rows keep their history and simply have no
-- detail, which is true of them.

BEGIN;

ALTER TABLE provisioning_steps ADD COLUMN IF NOT EXISTS detail TEXT;

COMMENT ON COLUMN provisioning_steps.detail IS
  'JSON array of operator-facing lines describing what this step did — counts, identifiers, reused-vs-created, read-back outcome. Display text, not machine state; machine state is result.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'provisioning_steps' AND column_name = 'detail'
  ) THEN
    RAISE EXCEPTION 'provisioning_steps.detail was not created';
  END IF;
  RAISE NOTICE 'provisioning_steps.detail ready — step detail is persisted from this run onward. Runs before this one have none.';
END $$;

COMMIT;

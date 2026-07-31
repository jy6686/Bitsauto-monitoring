-- 056_provisioning_step_metrics.sql
-- Countable outcomes per step, separate from the lines an operator reads.
--
-- WHY NOT JUST PARSE detail. 055 gave a step somewhere to say what it did, and that is the
-- right home for a sentence. It is the wrong home for a number. "Rules verified: 12 of 12"
-- is authored by the step, in the step's own words, and rewording it is a display change
-- that should cost nothing — but a dashboard that regex-matches it would break, silently,
-- and stay broken until someone noticed the rate had gone flat. Text is for reading; a
-- column is for counting.
--
-- A SHARED VOCABULARY IS THE POINT. "Authentication verification success rate" is only
-- answerable if `verified` and `requested` mean the same thing in every step that emits
-- them. types.ts defines the common keys; steps add their own alongside. Without that
-- agreement this is just a second free-form blob.
--
-- JSONB, not TEXT: it is queried by key. Deliberately NO index — provisioning_steps grows
-- by about ten rows per provisioning run, so a sequential scan costs nothing, and choosing
-- an index before a query exists is a guess about which one.
--
-- Idempotent. Additive and nullable. Runs before this have no metrics, which is true of
-- them; a rate computed over history must count only rows that have the key, not treat a
-- NULL as a zero.

BEGIN;

ALTER TABLE provisioning_steps ADD COLUMN IF NOT EXISTS metrics JSONB;

COMMENT ON COLUMN provisioning_steps.metrics IS
  'Countable outcomes for this step: requested/created/reused/verified/failed/skipped plus step-specific keys, and failures[] as {cause, count}. Machine-readable counterpart to detail — never parse detail for numbers. NULL means the step predates migration 056 or emitted none; that is not zero.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'provisioning_steps' AND column_name = 'metrics'
  ) THEN
    RAISE EXCEPTION 'provisioning_steps.metrics was not created';
  END IF;
  RAISE NOTICE 'provisioning_steps.metrics ready — steps are countable from this run onward. Earlier runs have NULL, which means unknown, not zero.';
END $$;

COMMIT;

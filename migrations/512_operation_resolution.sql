-- An operator's finding about an unknown outcome, recorded BESIDE that outcome.
--
-- An operation that ends `indeterminate` means the write may or may not have
-- landed. Only a person who reads the tariff can settle it. This records what
-- they found — and deliberately does NOT change `status`.
--
-- The original verdict is a historical fact: at the time, nobody could
-- establish what happened. Overwriting it with the later finding would erase
-- that the system was once blind, and the blindness is the thing worth keeping.
-- So `status` stays `indeterminate` forever and `resolution` is a separate,
-- later, attributable fact.
--
--   resolution = 'not_applied'  the operator read Sippy and the requested
--                               mutation is absent
--   resolution = 'applied'      the operator read Sippy and it is present
--   resolution IS NULL          nobody has looked yet
--
-- The constraints exist so that a "resolve" button cannot come to mean "I did
-- not check":
--
--   * only an `indeterminate` operation can be resolved — there is nothing to
--     settle about an outcome that was established;
--   * a resolution must carry who and when;
--   * a resolution must carry a note of real length. An operator who read the
--     tariff can say what they saw; one who did not, cannot.
--
-- Deliberately NOT added here: any enforcement that an unresolved operation
-- blocks further writes to its tariff. That predicate becomes safe only once
-- this workflow exists, and turning it on is a separate decision.

BEGIN;

ALTER TABLE rate_push_operations ADD COLUMN IF NOT EXISTS resolution       VARCHAR(24);
ALTER TABLE rate_push_operations ADD COLUMN IF NOT EXISTS resolved_by      VARCHAR(128);
ALTER TABLE rate_push_operations ADD COLUMN IF NOT EXISTS resolved_at      TIMESTAMP;
ALTER TABLE rate_push_operations ADD COLUMN IF NOT EXISTS resolution_note  TEXT;
-- What the operator actually observed in Sippy, in their words. Evidence, not a verdict.
ALTER TABLE rate_push_operations ADD COLUMN IF NOT EXISTS observed_state   TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                  WHERE table_name = 'rate_push_operations'
                    AND constraint_name = 'rate_push_operations_resolution_ck') THEN
    ALTER TABLE rate_push_operations ADD CONSTRAINT rate_push_operations_resolution_ck CHECK (
      resolution IS NULL
      OR (
        resolution IN ('not_applied', 'applied')
        -- Only an unestablished outcome can be settled by a person.
        AND status = 'indeterminate'
        -- Attributable, timed, and explained. No silent clearing.
        AND resolved_by IS NOT NULL
        AND resolved_at IS NOT NULL
        AND length(btrim(coalesce(resolution_note, ''))) >= 10
      )
    );
  END IF;
END$$;

-- The blocking predicate this exists to serve: "does tariff N still hold an
-- operation nobody has settled?" Answering it must stay cheap.
CREATE INDEX IF NOT EXISTS rate_push_operations_unresolved_ix
  ON rate_push_operations (i_tariff)
  WHERE status = 'indeterminate' AND resolution IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'rate_push_operations' AND column_name = 'resolution') THEN
    RAISE EXCEPTION '512: rate_push_operations.resolution missing after apply.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                  WHERE table_name = 'rate_push_operations'
                    AND constraint_name = 'rate_push_operations_resolution_ck') THEN
    RAISE EXCEPTION '512: the resolution CHECK is missing — without it a resolution could be '
                    'recorded with no operator, no time and no note, which is indistinguishable '
                    'from nobody having looked.';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'rate_push_operations' AND column_name = 'status'
                AND column_default IS DISTINCT FROM '''pending''::character varying') THEN
    RAISE NOTICE '512: note — status default is not the expected ''pending''.';
  END IF;

  RAISE NOTICE '512: an unknown outcome can now be settled by a person, beside the original '
               'verdict rather than on top of it.';
END$$;

COMMIT;

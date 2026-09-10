-- What the push actually did, kept instead of thrown away.
--
-- `setSippyRateEntry` already records its own account of an upload attempt: the
-- getUploadToken response, the token and URL it received, the size and result of
-- the binary upload, what getUploadStatus said, and the verification read-back.
-- None of it reached the caller. It went to console.log and nowhere else, and
-- the operation row kept only the final classified message.
--
-- The cost of that was four production pushes. Jobs #44 through #47 each held
-- the answer for about fifty seconds and discarded it; the durable record said
-- only "Portal CSV: Rate add refused: Sippy's add form did not return an i_rate
-- field", which describes the LAST thing that happened and nothing about the
-- upload that preceded it. The investigation then stalled waiting on a
-- deployment console that could not be reached, and no amount of reasoning
-- about the code could substitute for evidence the code had deleted.
--
-- So the array the push already builds is now returned and stored. Oldest entry
-- first, each prefixed with milliseconds since the operation began, because
-- latency has repeatedly turned out to be evidence here: a tariff read measured
-- 36 s on 2026-09-09 while a token call measured under 2 s.
--
-- JSONB rather than TEXT so the entries stay addressable as a list, and
-- nullable because every row written before this column existed has no trace and
-- must say so rather than appear to have recorded an empty one.

BEGIN;

ALTER TABLE rate_push_operations ADD COLUMN IF NOT EXISTS trace JSONB;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'rate_push_operations' AND column_name = 'trace') THEN
    RAISE EXCEPTION '513: rate_push_operations.trace missing after apply.';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'rate_push_operations' AND column_name = 'trace'
                AND (is_nullable <> 'YES' OR column_default IS NOT NULL)) THEN
    RAISE EXCEPTION '513: trace must be nullable with no default — an operation that ran before '
                    'this column existed has no trace, and must not read as one that recorded '
                    'nothing.';
  END IF;

  RAISE NOTICE '513: a push now keeps its own account of what it did, so the next failure '
               'explains itself from the record rather than from a console nobody can reach.';
END$$;

COMMIT;

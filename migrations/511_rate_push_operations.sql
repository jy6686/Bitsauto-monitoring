-- One durable row per rate operation, so a batch can say what it did.
--
-- rate_push_jobs is a single flat row per push. Its i_tariff, full_prefix,
-- old_rate and new_rate columns describe only the FIRST result in a batch, and
-- the per-operation outcomes lived in an in-memory array that the finalising
-- UPDATE collapsed into two counters. A push of 19,160 prefixes across many
-- customer tariffs therefore had no durable record of which prefix reached
-- which tariff, and a process restart mid-run lost the lot. This process
-- restarts often.
--
-- That matters most for the outcome nobody can see. On 2026-09-09 job #43
-- reported "this rate was not applied" while the tariff had in fact been
-- rewritten and a live rate destroyed. An operation whose outcome could not be
-- established is not a failure and must never be recorded as one, because the
-- next person to read the row decides from it whether to write again.
--
-- So `status` keeps four terminal states apart, and the difference between them
-- is whether the TARIFF'S STATE IS KNOWN:
--
--   succeeded       read back; the tariff holds what we wrote
--   failed          the tariff is provably unchanged — either the read-back
--                   showed the rate absent, or the push declined before
--                   issuing any mutating request
--   indeterminate   NOT established. The write may have landed, and on Sippy's
--                   GET-based form it may have landed on a different rate.
--                   Never retried, never aggregated away
--   not_attempted   never ran: its lane was halted, or it was refused at
--                   planning for an unresolved tariff or a duplicate target
--
-- and two non-terminal ones, `pending` and `running`. `running` is load-bearing
-- for recovery: a row still marked running when no execution is in flight
-- belongs to a process that died mid-operation, which is the definition of an
-- unestablished outcome. Recovery reclassifies it to indeterminate rather than
-- retrying it.
--
-- refused_before_write is deliberately three-valued. TRUE means no mutating
-- request was ever sent; FALSE means one was; NULL means nobody established
-- which, and NULL must not be read as FALSE.
--
-- The parent's status is derived from these rows, never from a counter kept
-- alongside them, so the summary cannot drift from the evidence.

BEGIN;

CREATE TABLE IF NOT EXISTS rate_push_operations (
  id                    SERIAL PRIMARY KEY,

  -- Parent. rate_push_jobs.job_id is the unique business key the route already
  -- uses; ON DELETE CASCADE so a removed job cannot leave orphaned operations.
  job_id                VARCHAR(64)  NOT NULL REFERENCES rate_push_jobs(job_id) ON DELETE CASCADE,
  operation_key         VARCHAR(128) NOT NULL,

  -- Submission order, and position within the tariff's serial lane.
  sequence              INTEGER      NOT NULL,
  lane_position         INTEGER,

  -- What was asked for.
  account_name          VARCHAR(160) NOT NULL,
  product_name          VARCHAR(64),
  trunk_prefix          VARCHAR(8),
  dial_prefix           VARCHAR(64),
  full_prefix           VARCHAR(32)  NOT NULL,
  destination_name      VARCHAR(256),
  requested_rate        NUMERIC(18, 6),
  interval_1            INTEGER,
  interval_n            INTEGER,
  effective_from        VARCHAR(32),
  effective_till        VARCHAR(32),

  -- Where it was actually aimed. NULL i_tariff means resolution failed, which
  -- is a refusal reason and never an executable operation.
  i_account             INTEGER,
  i_tariff              INTEGER,

  -- What happened.
  status                VARCHAR(24)  NOT NULL DEFAULT 'pending',
  attempts              INTEGER      NOT NULL DEFAULT 0,
  i_rate                INTEGER,
  push_method           VARCHAR(32),
  verification_result   VARCHAR(32),
  refused_before_write  BOOLEAN,
  message               TEXT,

  created_at            TIMESTAMP    NOT NULL DEFAULT NOW(),
  started_at            TIMESTAMP,
  completed_at          TIMESTAMP,

  CONSTRAINT rate_push_operations_status_ck CHECK (
    status IN ('pending', 'running', 'succeeded', 'failed', 'indeterminate', 'not_attempted')
  )
);

-- An operation key identifies one operation within one job, and is what a
-- result is written back against.
CREATE UNIQUE INDEX IF NOT EXISTS rate_push_operations_job_key_uq
  ON rate_push_operations (job_id, operation_key);

-- The two reads this table exists to serve: every operation of a job in order,
-- and "what is unresolved on this tariff" when deciding whether to write again.
CREATE INDEX IF NOT EXISTS rate_push_operations_job_seq_ix
  ON rate_push_operations (job_id, sequence);
CREATE INDEX IF NOT EXISTS rate_push_operations_tariff_status_ix
  ON rate_push_operations (i_tariff, status);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_name = 'rate_push_operations') THEN
    RAISE EXCEPTION '511: rate_push_operations missing after apply.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'rate_push_operations' AND column_name = 'refused_before_write'
                    AND is_nullable = 'YES') THEN
    RAISE EXCEPTION '511: refused_before_write must be nullable — NULL means nobody established '
                    'whether a mutating request was sent, and that is not the same as FALSE.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                  WHERE table_name = 'rate_push_operations'
                    AND constraint_name = 'rate_push_operations_status_ck') THEN
    RAISE EXCEPTION '511: the status CHECK is missing — an unknown status would let an '
                    'unestablished outcome be recorded as a failure.';
  END IF;

  RAISE NOTICE '511: a rate push now keeps one durable row per operation, and an outcome '
               'nobody established is recorded as such rather than as a failure.';
END$$;

COMMIT;

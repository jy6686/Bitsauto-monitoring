-- What a client is owed after a rate push actually landed.
--
-- SEPARATE FROM billing_increment_notifications, DELIBERATELY. That table hangs off
-- billing_increment_changes and announces "the increment changes from X to Y on DATE" — a
-- commitment about a future date. This one announces "these rates changed, and they are live
-- now", derived from operations the switch confirmed. Different source facts, different lineage,
-- different legal meaning. Sharing a table would let one be manufactured from the other's record,
-- which is precisely what must not be possible.
--
-- THE ROWS ARE FROZEN HERE, ON PURPOSE.
-- `rows_json` holds the destinations, prefixes and rates exactly as they were certified. The
-- notification is NOT reconstructed later from product_rates: that table describes the current
-- matrix, and after a push it can disagree with what landed — a refused operation, an
-- indeterminate one — so rebuilding from it would send a customer rates the switch does not hold.
-- What was true at certification is what the customer is told.
--
-- IDEMPOTENCE IS STRUCTURAL, NOT PROCEDURAL.
-- UNIQUE (job_id, client_name, product_code) is the whole recovery story. A push that certifies
-- and then dies before writing its obligation leaves durable operation records behind; recovery
-- re-derives from those and inserts. If the obligation already exists, the insert is a no-op
-- rather than a second announcement. "Process the same completion twice" and "recover from a
-- crash" therefore have the same safe answer, because neither depends on remembering anything.

BEGIN;

CREATE TABLE IF NOT EXISTS rate_push_notifications (
  id            SERIAL PRIMARY KEY,

  -- The certified push this is owed for. Text because job ids in this platform are strings.
  job_id        VARCHAR(128) NOT NULL,
  client_name   VARCHAR(256) NOT NULL,
  product_code  VARCHAR(64)  NOT NULL,
  product_label VARCHAR(128) NOT NULL,

  -- CHANGES for a post-push notice. FULL exists only so a mislabelled row is representable and
  -- therefore auditable; nothing in the post-push path may write it, because under FULL every
  -- destination the sheet omits reads as deleted.
  notification_type VARCHAR(16) NOT NULL DEFAULT 'CHANGES'
                    CHECK (notification_type IN ('CHANGES', 'FULL')),

  -- The certified facts. Frozen at creation; never re-derived from product_rates.
  rows_json     JSONB NOT NULL,
  row_count     INTEGER NOT NULL,
  dial_format   VARCHAR(128),

  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','sent','failed','suppressed')),

  attempts        INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  sent_at         TIMESTAMPTZ,
  last_error      TEXT,
  recipients      TEXT,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- 'push' when written by the completing push, 'recovery' when re-derived afterwards. Worth
  -- distinguishing: a rising recovery count means completions are dying before they record.
  created_via   VARCHAR(16) NOT NULL DEFAULT 'push'
                CHECK (created_via IN ('push', 'recovery')),

  -- ONE obligation per push per client per product. The recovery guarantee depends on this.
  UNIQUE (job_id, client_name, product_code),

  -- An obligation with no rows would send a customer an empty rate sheet, which under any label
  -- is a statement about their prices.
  CONSTRAINT rpn_has_rows CHECK (row_count > 0),
  CONSTRAINT rpn_sent_has_time  CHECK (status <> 'sent'   OR sent_at IS NOT NULL),
  CONSTRAINT rpn_failed_has_why CHECK (status <> 'failed' OR last_error IS NOT NULL)
);

-- The delivery worker's read.
CREATE INDEX IF NOT EXISTS rpn_pending_ix
  ON rate_push_notifications (status, created_at)
  WHERE status IN ('pending', 'failed');

-- Recovery's read: which jobs already have obligations.
CREATE INDEX IF NOT EXISTS rpn_job_ix ON rate_push_notifications (job_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_name = 'rate_push_notifications') THEN
    RAISE EXCEPTION '518: rate_push_notifications missing after apply.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE tablename = 'rate_push_notifications'
                    AND indexdef ILIKE '%UNIQUE%job_id%client_name%product_code%') THEN
    RAISE EXCEPTION '518: the uniqueness constraint is missing. Without it a crashed push that is '
                    'recovered would announce the same rate change to the same client twice, and '
                    'recovery would be unsafe by construction.';
  END IF;

  IF (SELECT count(*) FROM rate_push_notifications) <> 0 THEN
    RAISE EXCEPTION '518: the table must be created EMPTY. Every row is a rate change announced to '
                    'a real customer; none may be manufactured by a migration.';
  END IF;

  RAISE NOTICE '518: post-push notification obligations are frozen at certification and unique per '
               'job/client/product, so recovery and double-processing have the same safe answer.';
END$$;

COMMIT;

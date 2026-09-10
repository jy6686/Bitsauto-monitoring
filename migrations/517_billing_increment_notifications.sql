-- One row per recipient per billing-increment change: the promise that a client will be told.
--
-- THIS IS A TRANSACTIONAL OUTBOX, AND THAT IS THE ENTIRE POINT.
--
-- The failure this prevents is the worst one available here: a client receives "30/6 effective
-- 20 September" while the platform never committed the change. That happens whenever an email
-- is sent from inside the request that also writes the record — the send succeeds, the
-- transaction then rolls back, and the customer holds a commitment the platform has no memory
-- of. So nothing is ever SENT here. Rows are COMMITTED in the same transaction as the change
-- itself, and a separate worker delivers them afterwards.
--
-- The opposite failure is guarded too. A delivery that fails must not take the commercial change
-- with it: the change is already committed and stays committed, and the failure lives on THIS
-- row as an observable status with an attempt count and the last error. "We owe this client an
-- email" is a durable fact with a retry path, not an exception that vanished into a log.
--
-- WHY NOT REUSE rate_notification_jobs. That table is keyed to a rate-notification TEMPLATE and
-- describes a send composed from one. This is a different commitment — a specific increment
-- change on a specific date — and needs to point at the change row so the two can never drift.
-- Delivery still goes through the existing notification machinery; only the commitment is
-- recorded separately.

BEGIN;

CREATE TABLE IF NOT EXISTS billing_increment_notifications (
  id               SERIAL PRIMARY KEY,

  -- The commitment this discharges. ON DELETE CASCADE because a notification for a change that
  -- does not exist is not a thing anyone should be able to hold.
  change_id        INTEGER NOT NULL REFERENCES billing_increment_changes(id) ON DELETE CASCADE,

  client_name      VARCHAR(256) NOT NULL,
  recipient_email  VARCHAR(320) NOT NULL,
  -- Which configured source supplied the address, so a wrong recipient is traceable to the
  -- setting that produced it rather than guessed at.
  recipient_source VARCHAR(32)  NOT NULL
                   CHECK (recipient_source IN ('rate_notification_template', 'company_invoice_email')),

  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','sent','failed','suppressed')),

  -- Delivery, tracked here so a failure is observable and retryable rather than lost.
  attempts         INTEGER NOT NULL DEFAULT 0,
  last_attempt_at  TIMESTAMPTZ,
  sent_at          TIMESTAMPTZ,
  last_error       TEXT,

  -- The exact sentence the client was told, frozen at commit time. If the change record is later
  -- amended, this still shows what was actually promised on the day.
  message          TEXT NOT NULL,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- A sent row must say when. A failed row must say why. Either without its evidence is
  -- indistinguishable from a row nobody has touched.
  CONSTRAINT bin_sent_has_time  CHECK (status <> 'sent'   OR sent_at IS NOT NULL),
  CONSTRAINT bin_failed_has_why CHECK (status <> 'failed' OR last_error IS NOT NULL),

  -- One notification per recipient per change. Retrying delivery must update this row, never
  -- insert a second one, or a client gets the same announcement twice.
  UNIQUE (change_id, recipient_email)
);

-- The worker's read: what is still owed.
CREATE INDEX IF NOT EXISTS bin_pending_ix
  ON billing_increment_notifications (status, created_at)
  WHERE status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS bin_change_ix
  ON billing_increment_notifications (change_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_name = 'billing_increment_notifications') THEN
    RAISE EXCEPTION '517: billing_increment_notifications missing after apply.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                  WHERE constraint_name = 'bin_failed_has_why') THEN
    RAISE EXCEPTION '517: the failure CHECK is missing — a failed delivery with no reason cannot '
                    'be retried intelligently and cannot be distinguished from an untouched row.';
  END IF;

  IF (SELECT count(*) FROM billing_increment_notifications) <> 0 THEN
    RAISE EXCEPTION '517: the table must be created EMPTY. Every row is a message owed to a real '
                    'customer; none may be manufactured by a migration.';
  END IF;

  RAISE NOTICE '517: increment-change notifications are an outbox. Rows commit with the change '
               'and a worker delivers them, so no client is ever told about a change the '
               'platform did not commit.';
END$$;

COMMIT;

-- An effective-dated change to a destination's billing increment.
--
-- WHY THIS IS NOT AN EDIT TO THE CATALOGUE.
-- `commercial_destination_prefixes.billing_increment` is imported from supplier rate sheets and
-- is replaced on every re-import. An increment edited there would be silently reverted by the
-- next import — AFTER clients had been emailed a commitment about it. A commercial commitment
-- cannot live in a table whose contents are overwritten by a vendor file.
--
-- WHY IT IS NOT A COLUMN ON product_rates EITHER.
-- The requirement is a promise about the FUTURE: "this increment changes on 20 September". A
-- single column can hold what is true now or what will be true later, never both, and the whole
-- point is that both must be knowable at once — the current increment stays in force on the
-- switch until the effective date, while the notification already states the new one.
--
-- THE INVARIANT THIS TABLE EXISTS TO KEEP.
--   before effective_date : the PREVIOUS increment is in force
--   on/after effective_date: the NEW increment is in force
-- and the email that went to clients names the same date as the switch mutation. A change that
-- is emailed but never applied, or applied on a different day from the one promised, is a broken
-- commercial contract, not merely a bug.
--
-- COMMERCIAL TRUTH AND SWITCH STATE ARE TRACKED SEPARATELY, ON PURPOSE.
-- `effective_date` says what SHOULD be in force. `applied_at` says whether Sippy actually holds
-- it. Collapsing them would make "we promised this and have not delivered it" unrepresentable,
-- and that gap is precisely what an operator needs to see.

BEGIN;

CREATE TABLE IF NOT EXISTS billing_increment_changes (
  id                   SERIAL PRIMARY KEY,

  -- What is affected. Same identity the rest of the commercial layer uses: a product and a
  -- destination in a specific catalogue version, never a bare prefix.
  product_id           INTEGER NOT NULL REFERENCES product_registry(id) ON DELETE CASCADE,
  destination_id       INTEGER NOT NULL REFERENCES commercial_destinations(id) ON DELETE CASCADE,
  catalogue_version_id INTEGER NOT NULL,

  -- Canonical "N/M". `previous_increment` is stored rather than looked up so the record stays
  -- truthful after a catalogue re-import changes the supplier value underneath it.
  previous_increment   VARCHAR(16),
  new_increment        VARCHAR(16) NOT NULL,

  -- The commercial contract date. The notification names it and the switch mutation must use it.
  effective_date       DATE NOT NULL,

  -- FIVE states, and `needs_review` is not a luxury. Folding an unproven application into
  -- 'failed' would say nothing happened when something may have; that is the exact conflation
  -- that let an indeterminate rate upload be retried as though it were a clean failure.
  --   accepted     scheduled, clients not yet told
  --   notified     clients told, effective date may or may not have arrived
  --   applied      the switch holds it AND a read-back proved it
  --   needs_review a mutation was sent and the result could not be established
  --   failed       refused before any mutation, or positively established as not applied
  --   cancelled    withdrawn; never reaches the switch
  status               TEXT NOT NULL DEFAULT 'accepted'
                       CHECK (status IN ('accepted','notified','applied','needs_review','cancelled','failed')),

  -- Notification. `notified_at` is set only when clients have actually been told.
  notified_at          TIMESTAMPTZ,
  notified_count       INTEGER,
  notification_ref     VARCHAR(128),

  -- Switch state, deliberately separate from the commercial dates above.
  -- Earned ONLY by authoritative read-back. A client notification and a commercial commitment
  -- are not proof that the switch changed.
  applied_at           TIMESTAMPTZ,
  applied_by           VARCHAR(128),
  applied_increment    VARCHAR(16),
  prefixes_verified    INTEGER,
  failure_reason       TEXT,
  last_attempt_at      TIMESTAMPTZ,
  attempts             INTEGER NOT NULL DEFAULT 0,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by           VARCHAR(128) NOT NULL,
  cancelled_at         TIMESTAMPTZ,
  cancelled_by         VARCHAR(128),
  notes                TEXT,

  -- A change must actually change something. Recording 60/1 -> 60/1 would email clients about
  -- nothing and schedule a mutation that alters nothing.
  CONSTRAINT bic_actually_changes CHECK (previous_increment IS DISTINCT FROM new_increment),

  -- Every terminal state must say who and when. Same rule the eligibility withdrawal keeps:
  -- a commercial act with no operator is indistinguishable from one that never happened.
  CONSTRAINT bic_applied_attributable CHECK (
    status <> 'applied' OR (applied_at IS NOT NULL AND applied_by IS NOT NULL)),
  CONSTRAINT bic_cancelled_attributable CHECK (
    status <> 'cancelled' OR (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL)),
  CONSTRAINT bic_failed_explained CHECK (
    status <> 'failed' OR failure_reason IS NOT NULL),
  -- An unproven application must say what is unknown, or it is indistinguishable from a change
  -- nobody has attempted.
  CONSTRAINT bic_review_explained CHECK (
    status <> 'needs_review' OR failure_reason IS NOT NULL),
  -- `applied` requires the evidence, not just the status.
  CONSTRAINT bic_applied_proven CHECK (
    status <> 'applied' OR (applied_increment IS NOT NULL AND prefixes_verified IS NOT NULL))
);

-- "What is in force for this product/destination today" is the read on every push.
CREATE INDEX IF NOT EXISTS bic_resolve_ix
  ON billing_increment_changes (product_id, destination_id, effective_date DESC)
  WHERE status <> 'cancelled';

-- "What is due to be applied to the switch" is the read the scheduler needs.
CREATE INDEX IF NOT EXISTS bic_due_ix
  ON billing_increment_changes (effective_date)
  WHERE status IN ('accepted','notified');

-- What a person must look at: sent, and not established.
CREATE INDEX IF NOT EXISTS bic_review_ix
  ON billing_increment_changes (last_attempt_at)
  WHERE status = 'needs_review';

-- ONE live change per pairing per date. Two changes for the same destination on the same day
-- would make "what is in force" ambiguous, and would email clients twice about one date.
CREATE UNIQUE INDEX IF NOT EXISTS bic_one_per_date_ux
  ON billing_increment_changes (product_id, destination_id, effective_date)
  WHERE status <> 'cancelled';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_name = 'billing_increment_changes') THEN
    RAISE EXCEPTION '516: billing_increment_changes missing after apply.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                  WHERE constraint_name = 'bic_actually_changes') THEN
    RAISE EXCEPTION '516: the no-op CHECK is missing — a change from an increment to itself '
                    'would notify clients about nothing and schedule a mutation that alters '
                    'nothing.';
  END IF;

  IF (SELECT count(*) FROM billing_increment_changes) <> 0 THEN
    RAISE EXCEPTION '516: the table must be created EMPTY. Every row is a commitment made to a '
                    'customer on a date; none may be manufactured by a migration.';
  END IF;

  RAISE NOTICE '516: billing increment changes are effective-dated. The increment in force before '
               'the effective date is unchanged, and the date clients are told is the date the '
               'switch is changed.';
END$$;

COMMIT;

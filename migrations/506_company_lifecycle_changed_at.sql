-- When a customer's lifecycle last changed.
--
-- Needed to make one business rule actually terminate. The owner's rule:
-- "if an account becomes Inactive after generating traffic, finish collecting
-- and billing the outstanding business day before excluding it from future
-- collection." Without a change date, "outstanding" means every day never
-- collected — so a Dormant account would be queued every night forever, which
-- is the opposite of excluding it.
--
-- With this column the rule is exact: a non-Active account is collected only
-- for unsealed days ON OR BEFORE the day its lifecycle changed. That both
-- preserves the billable history and terminates.

BEGIN;

ALTER TABLE companies ADD COLUMN IF NOT EXISTS lifecycle_changed_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name='companies' AND column_name='lifecycle_changed_at') THEN
    RAISE EXCEPTION '506: companies.lifecycle_changed_at missing after apply.';
  END IF;
  RAISE NOTICE '506: the outstanding-day rule can now terminate.';
END$$;

COMMIT;

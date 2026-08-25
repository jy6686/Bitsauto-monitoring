-- 079_invoice_accounting_month.sql
--
-- Which accounting month an invoice belongs to, stored rather than derived.
--
-- Every consumer — finance dashboard, GL export, revenue and margin reports,
-- customer statements — otherwise has to recompute it from period_start, and
-- each one would have to independently get the month-boundary rule right.
-- Under that rule (no invoice spans two accounting months) the answer is
-- unambiguous at generation time, so it is recorded once there.
--
-- Backfill uses period_start's month, which is correct for every existing row:
-- the splitting rule guarantees start and end share a month, and rows created
-- before the rule are single-period invoices whose start month is their month.

BEGIN;

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS accounting_month VARCHAR(7);

DO $$
DECLARE n integer;
BEGIN
  UPDATE invoices
     SET accounting_month = left(period_start, 7)
   WHERE accounting_month IS NULL
     AND period_start IS NOT NULL
     AND period_start ~ '^\d{4}-\d{2}';
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '079: accounting_month backfilled on % invoice(s) from period_start.', n;
END $$;

CREATE INDEX IF NOT EXISTS idx_invoices_accounting_month ON invoices (accounting_month);

COMMIT;

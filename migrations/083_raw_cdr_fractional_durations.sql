-- 083_raw_cdr_fractional_durations.sql
--
-- Sippy reports a call's real duration fractionally. raw_sippy_cdrs declared
-- total_secs and billed_secs as INTEGER, so from the moment the repository
-- went live EVERY write failed with:
--
--     invalid input syntax for type integer: "7.697271466"
--
-- Postgres rejected the whole 500-row chunk, and the seeder's
-- billing-continues contract — which correctly refuses to let a storage fault
-- block invoicing — swallowed the exception. Jobs reported "done, errors 0"
-- while storing nothing. Four days of CDR evidence were lost to a column type.
-- (Job sj-1787842082071-moe8dx, 2026-08-26.)
--
-- These two columns are MEASUREMENTS: the switch's own record of how long a
-- call ran and how long it was billed for. The Raw CDR Repository is the
-- untouched evidence that Billing Reconciliation compares against, so a
-- measurement is not narrowed on the way in. Rounding at ingestion would edit
-- the evidence before anyone had read it.
--
-- NUMERIC, not double precision: an exact decimal has no representation
-- question, matches the ::numeric summation idiom already used for money, and
-- costs nothing here — the table is effectively empty precisely because of
-- this bug, so the rewrite is instant and takes no meaningful lock.
--
-- free_seconds, grace_period, interval_1 and interval_n stay INTEGER. They
-- echo tariff CONFIGURATION, which Sippy models in whole seconds. The importer
-- now rounds them explicitly (server/cdr-column-coercion.ts) rather than
-- trusting that they are always whole — that assumption is what caused this.

BEGIN;

ALTER TABLE raw_sippy_cdrs
  ALTER COLUMN total_secs  TYPE numeric(14,6) USING total_secs::numeric,
  ALTER COLUMN billed_secs TYPE numeric(14,6) USING billed_secs::numeric;

DO $$
DECLARE t text; b text;
BEGIN
  SELECT data_type INTO t FROM information_schema.columns
    WHERE table_name = 'raw_sippy_cdrs' AND column_name = 'total_secs';
  SELECT data_type INTO b FROM information_schema.columns
    WHERE table_name = 'raw_sippy_cdrs' AND column_name = 'billed_secs';
  RAISE NOTICE '083: raw_sippy_cdrs.total_secs=%, billed_secs=% (both must read "numeric")', t, b;
END $$;

COMMIT;

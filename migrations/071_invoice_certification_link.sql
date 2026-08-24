-- 071_invoice_certification_link.sql
--
-- Bind every invoice to the verification run that certified its data.
--
-- An invoice is the final output of a certified billing dataset. Until now it
-- recorded its own totals but not which reconciliation produced them, so the
-- question "which run certified this invoice, and what did that run find?"
-- could not be answered after the fact — the two lived in unrelated tables with
-- nothing joining them.
--
-- verification_run_id points at snapshot_verification_runs (migration 070).
-- Nullable: invoices generated before this migration genuinely have no
-- certification, and inventing one would fabricate an audit chain.
--
-- certification_status records the state AT GENERATION TIME, not now. A run
-- re-read later may have been superseded; what matters for audit is what
-- Finance was told when the invoice was created.
--   certified — the run priced every call, nothing excluded, no differences
--   override  — the run raised exceptions and an authorised user proceeded
--               anyway, with a reason recorded below
--
-- override_reason / overridden_by are required by application logic whenever
-- status is 'override'. Enforced there rather than by constraint so a failed
-- override attempt returns a clear message instead of a database error.

BEGIN;

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS verification_run_id  INTEGER;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS certification_status VARCHAR(16);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS override_reason      TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS overridden_by        VARCHAR(128);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS certified_at         TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_invoices_verification_run
  ON invoices (verification_run_id);

DO $$
BEGIN
  RAISE NOTICE '071: invoice → verification run certification link ensured.';
END $$;

COMMIT;

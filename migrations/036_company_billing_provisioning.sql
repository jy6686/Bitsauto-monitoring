-- 036_company_billing_provisioning.sql
-- Persists Sippy billing-object provisioning state (Tariff + Service Plan) on the
-- company record, so Company Profile Setup's output is durable instead of being
-- returned to the browser and discarded.
--
-- Governed by docs/ACCOUNT-WIZARD-GOVERNANCE-PHASE1.md.
-- This is the approved freeze-safe slice: additive columns only. NOTHING in the
-- Account Wizard or POST /api/companies/:id/provision is touched, and no existing
-- column changes meaning. Consumption of these values by the wizard is explicitly
-- DEFERRED to Exit Criterion 2.
--
-- ── Why a separate namespace, not the existing provisioning_* columns ──────────
-- companies.provisioning_status already exists and is the ACCOUNT provisioning
-- state machine owned by the wizard. Two branches gate on it:
--   server/routes.ts  POST /api/companies/:id/provision  -> 409 "already provisioned"
--   server/routes.ts  POST /api/client-wizard/submit     -> short-circuits the draft save
-- Writing that column from Company Profile Setup could therefore BLOCK the wizard
-- from provisioning an account — a freeze violation by side-effect. Billing-object
-- provisioning gets its own billing_* columns so the two state machines never
-- interfere. Same reasoning for provisioned_at / provisioned_by.
--
-- Likewise `currency` is an existing business attribute of the company; the currency
-- actually used to create the Sippy tariff is recorded separately as
-- sippy_tariff_currency so a provisioning action never silently rewrites business data.
--
-- companies.sippy_i_tariff already exists (written today only by the wizard's
-- provision endpoint, at the END of provisioning) and is reused as-is.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS. Re-run is safe.

BEGIN;

-- ── Sippy billing object IDs ──────────────────────────────────────────────────
-- Service Plan / billing plan ID (i_billing_plan). No such column existed before:
-- the only service_plan_id in the schema is on rate_notification_jobs, which is a
-- per-job snapshot, unrelated to the company record.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS sippy_i_billing_plan INTEGER;

-- Numeric Sippy billing cycle used when the plan was created. Distinct from
-- client_billing_cycle, which is a business term ('weekly_cutoff' etc), not Sippy's enum.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS sippy_billing_cycle INTEGER;

-- Currency used for the Sippy tariff. Recorded, not merged into companies.currency.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS sippy_tariff_currency VARCHAR(8);

-- ── Billing provisioning state (separate from account provisioning) ───────────
-- 'success' — tariff + plan created/reused in Sippy and IDs persisted
-- 'manual'  — automation fell back; operator must create the plan in Sippy
-- 'failed'  — provisioning attempt errored
ALTER TABLE companies ADD COLUMN IF NOT EXISTS billing_provision_status VARCHAR(16);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS billing_provisioned_at   TIMESTAMP;

-- Diagnostics, aligned with the reasonCode / correlationId instrumentation added
-- in commit bc765382 so a failed run can be traced from the company record to the
-- exact server log line.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS billing_provision_reason_code VARCHAR(48);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS billing_provision_error       TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS billing_provision_trace_id    VARCHAR(64);

-- ── Verify ────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  added INT;
BEGIN
  SELECT COUNT(*) INTO added
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name   = 'companies'
     AND column_name IN (
       'sippy_i_billing_plan', 'sippy_billing_cycle', 'sippy_tariff_currency',
       'billing_provision_status', 'billing_provisioned_at',
       'billing_provision_reason_code', 'billing_provision_error',
       'billing_provision_trace_id'
     );

  IF added <> 8 THEN
    RAISE EXCEPTION 'companies billing-provisioning columns present=% (want 8)', added;
  END IF;

  -- Guard the freeze: the wizard's own state machine must be untouched by this migration.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'companies'
       AND column_name = 'provisioning_status'
  ) THEN
    RAISE EXCEPTION 'provisioning_status missing — wizard state machine must remain intact';
  END IF;
END $$;

COMMIT;

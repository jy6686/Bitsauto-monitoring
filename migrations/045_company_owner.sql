-- 045_company_owner.sql
-- Onboarding 2.0 — Sprint 2.3, task 1: one owner per customer.
--
-- companies.kam names a KAM and cannot express "Ali (NOC) owns this". Preparation is now
-- owned by a named PERSON who may be NOC or KAM, so ownership needs its own reference.
--
-- Stores a USER REFERENCE, not a role snapshot: a stored role goes stale the moment that
-- user's permissions change, and RBAC already knows their role. owner_department is
-- display/reporting only and is explicitly NOT used for authorisation.
-- Idempotent.

BEGIN;

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS owner_user_id    VARCHAR(255),
  ADD COLUMN IF NOT EXISTS owner_department VARCHAR(64);

COMMENT ON COLUMN companies.owner_user_id IS
  'The single accountable owner of this customer''s preparation. A user reference, never a role snapshot — authorisation always comes from RBAC, not from this column.';
COMMENT ON COLUMN companies.owner_department IS
  'Display/reporting only (e.g. NOC, KAM). MUST NOT be used for permission decisions.';

CREATE INDEX IF NOT EXISTS idx_companies_owner ON companies (owner_user_id);

-- Lifecycle values this program uses, recorded so the string set is not re-invented:
--   draft → prepared → ready_for_provision → provisioning → provisioned
-- Deliberately NOT a CHECK constraint: provisioning_status is shared with the frozen
-- Account Wizard state machine, and constraining values it already writes could reject a
-- legitimate existing state mid-flight.
COMMENT ON COLUMN companies.provisioning_status IS
  'draft | prepared | ready_for_provision | provisioning | provisioned. Shared with the Account Wizard state machine — do not constrain without auditing every writer.';

COMMIT;

-- 037_provisioning_orchestration.sql
-- Orchestration layer for the automated onboarding workflow.
--
-- One provisioning_run per onboarding; many ordered, individually retryable
-- provisioning_steps beneath it. Replaces the "one long HTTP request runs 12
-- sequential Sippy calls" model, which cannot survive a browser refresh, offers
-- no per-step retry, and is the most likely cause of the plain-text
-- "Internal Server Error" seen from the proxy on long provisioning calls.
--
-- ── Why NOT extend provisioning_jobs ──────────────────────────────────────────
-- provisioning_jobs already models a LATER-STAGE, per-product execution unit:
--     i_account   INTEGER NOT NULL
--     product_id  INTEGER NOT NULL
-- Both are unavailable at the start of a run — under the target ordering the
-- Tariff and Service Plan steps execute BEFORE any Sippy account exists, so a
-- row could not be written at all. Its grain is also one-job-per-product, while
-- a run spans many products and many non-product steps.
--
-- Forcing orchestration into it would require nullable keys or placeholder
-- values, redefining the meaning of an existing production table. Instead:
--     provisioning_runs / provisioning_steps  = orchestration (this migration)
--     provisioning_jobs                       = product/rate execution (unchanged)
-- The orchestrator CREATES provisioning_jobs rows when a run reaches rate
-- generation, so the mature rate pipeline is reused rather than reimplemented.
-- provisioning_jobs is not touched by this migration.
--
-- ── Per-step `blocking` flag ──────────────────────────────────────────────────
-- Whether a failed step halts the run is DATA, not code. This exists because the
-- Service Plan step's feasibility is currently unknown (see
-- docs/ACCOUNT-WIZARD-GOVERNANCE-PHASE1.md §6 — the reasonCode has not yet been
-- captured from a live run). It is seeded non-blocking, matching today's
-- behaviour where service plan failure is explicitly non-fatal and account
-- creation proceeds regardless.
--
-- Once the reasonCode is known and the step is proven reliable, it becomes
-- blocking by flipping one boolean — no code change, no re-ordering of a
-- production-tested pipeline.
--
-- Governance: docs/ACCOUNT-WIZARD-GOVERNANCE-PHASE1.md.
-- The frozen Account Wizard and POST /api/companies/:id/provision are NOT
-- touched. This adds a parallel orchestration capability alongside them.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS. Re-run is safe.

BEGIN;

-- ── Runs ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS provisioning_runs (
  id           SERIAL PRIMARY KEY,
  -- Human-quotable reference, e.g. 'PROV-20260727-A1B2'. Surfaced in the UI and
  -- written to the server log so a screenshot is enough to locate a run.
  run_ref      VARCHAR(32)  NOT NULL UNIQUE,
  company_id   INTEGER      NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  -- Provisioning profile (Phase 2 — "Wholesale Customer" => FC/BC/SB/SC + routing
  -- + session defaults). Nullable until profiles exist.
  profile_id   INTEGER,
  -- pending | running | completed | completed_with_warnings | failed | awaiting_ip_approval | cancelled
  -- 'completed_with_warnings' is the state a run reaches when every blocking step
  -- succeeded but a non-blocking one (today: service_plan) did not.
  status       VARCHAR(32)  NOT NULL DEFAULT 'pending',
  current_step VARCHAR(48),
  started_at   TIMESTAMP,
  completed_at TIMESTAMP,
  error        TEXT,
  -- JSON: the submitted onboarding form (products, destinations, routing template,
  -- IP, contacts). Frozen at run creation so a retry replays identical inputs.
  input        TEXT,
  created_by   VARCHAR(128),
  created_at   TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prov_runs_company ON provisioning_runs (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prov_runs_status  ON provisioning_runs (status) WHERE status IN ('pending', 'running');

-- ── Steps ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS provisioning_steps (
  id           SERIAL PRIMARY KEY,
  run_id       INTEGER      NOT NULL REFERENCES provisioning_runs(id) ON DELETE CASCADE,
  -- Stable machine key: company | tariff | service_plan | account | assign_plan |
  -- products | rates | rate_push | routing | credentials | email | await_ip
  step_key     VARCHAR(48)  NOT NULL,
  step_order   INTEGER      NOT NULL,
  label        VARCHAR(128),
  -- pending | running | success | failed | skipped
  status       VARCHAR(16)  NOT NULL DEFAULT 'pending',
  -- FALSE => a failure is recorded and the run continues (see header note).
  blocking     BOOLEAN      NOT NULL DEFAULT TRUE,
  attempt      INTEGER      NOT NULL DEFAULT 0,
  started_at   TIMESTAMP,
  completed_at TIMESTAMP,
  -- Same vocabulary as createSippyServicePlan()'s reasonCode
  -- (PROVISIONING_NOT_CONFIGURED / _LOGIN_FAILED / _PERMISSION_DENIED / UNKNOWN_ERROR)
  -- so failures are classifiable and countable per class, not free text.
  reason_code  VARCHAR(48),
  error        TEXT,
  -- Correlation ID written to the server log at the moment of failure.
  trace_id     VARCHAR(64),
  -- JSON: identifiers produced by this step (i_tariff, i_billing_plan, i_account,
  -- i_routing_group...). Lets a later step consume an earlier step's output on retry
  -- without re-deriving it from Sippy.
  result       TEXT,
  UNIQUE (run_id, step_key)
);

CREATE INDEX IF NOT EXISTS idx_prov_steps_run ON provisioning_steps (run_id, step_order);

-- ── Verify ────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  runs_cols  INT;
  steps_cols INT;
  jobs_ia_notnull BOOLEAN;
BEGIN
  SELECT COUNT(*) INTO runs_cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'provisioning_runs';
  IF runs_cols < 12 THEN
    RAISE EXCEPTION 'provisioning_runs columns=% (want >=12)', runs_cols;
  END IF;

  SELECT COUNT(*) INTO steps_cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'provisioning_steps';
  IF steps_cols < 14 THEN
    RAISE EXCEPTION 'provisioning_steps columns=% (want >=14)', steps_cols;
  END IF;

  -- Guard: provisioning_jobs must be untouched by this migration. If i_account
  -- has become nullable, something altered the execution table's contract.
  SELECT (is_nullable = 'NO') INTO jobs_ia_notnull
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'provisioning_jobs'
     AND column_name  = 'i_account';
  IF jobs_ia_notnull IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'provisioning_jobs.i_account NOT NULL constraint changed — execution table must remain untouched';
  END IF;
END $$;

COMMIT;

/**
 * types.ts — the ProvisioningStep contract.
 *
 * The orchestration engine knows nothing about HOW any step is performed. It
 * only knows that a step can be executed, may be retried, may be rolled back,
 * and reports a structured outcome.
 *
 * This matters concretely, not theoretically. As of 2026-07-27 the Service Plan
 * executor is blocked by the Sippy deployment: no XML-RPC method exists on this
 * build (all candidates return UNKNOWN_METHOD, including the documented
 * createServicePlan, which requires Softswitch 2025+) and the portal INSERT is
 * refused for the provisioning account. See
 * docs/ACCOUNT-WIZARD-GOVERNANCE-PHASE1.md §6.
 *
 * Behind this interface that is a property of ONE executor. When the permission
 * is granted, or Sippy is upgraded, only ServicePlanStep.execute() changes — the
 * runner, the persistence, the retry logic and the other nine steps are
 * untouched. That is the whole point of the seam.
 */

/** Mirrors provisioning_steps.status (migration 037). */
export type StepStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped';

/** Frozen snapshot of the onboarding form. Stored on the run so a retry replays
 *  identical input rather than re-reading mutable state. */
export interface ProvisioningInput {
  companyName:   string;
  currency:      string;
  /** Sippy numeric cycle: 1 = weekly, 2 = bi-weekly, 3 = monthly.
   *  Confirmed against Sippy's XML-RPC docs — note this contradicts a stale
   *  comment in the frozen wizard that labels 3 as "Weekly" (DEFECT-CP-004). */
  billingCycle?: number;
  planName?:     string;
  [k: string]: unknown;
}

export interface StepContext {
  runId:     number;
  companyId: number;
  input:     ProvisioningInput;
  /** Outputs of previously-succeeded steps, keyed by step key. Lets a later step
   *  consume an earlier one's identifiers (e.g. service_plan needs iTariff from
   *  tariff) without re-deriving them from Sippy on every retry. */
  results:   Record<string, Record<string, unknown>>;
  actor:     string;
  sippy: {
    username:   string;
    password:   string;
    portalUrl:  string;
    adminUser:  string;
    adminPass:  string;
    portalUser: string;
    portalPass: string;
    adminWebPassword?: string;
  };
}

export interface StepOutcome {
  status: 'success' | 'failed' | 'skipped';
  /** Identifiers produced, merged into ctx.results under this step's key. */
  result?: Record<string, unknown>;
  /** Stable classification. Shares vocabulary with createSippyServicePlan()'s
   *  reasonCode so failures stay countable per class rather than free text. */
  reasonCode?: string;
  error?: string;
  traceId?: string;
  /** Diagnostic breadcrumbs surfaced to the UI, e.g. XML-RPC attempt outcomes. */
  detail?: string[];
}

/**
 * What a verify() may report. The bare `string | null` form is unchanged and still
 * correct for a step whose check has nothing to say beyond pass or fail.
 */
export interface VerifyReport {
  /** A reason when the check failed; null or omitted when it passed. */
  reason?: string | null;
  /** Lines describing what was checked and what was found. Appended to the step's detail
   *  on PASS as well as on failure — a check that proves something should say what. */
  detail?: string[];
}

export type VerifyOutcome = string | null | VerifyReport;

export interface ProvisioningStep {
  /** Stable machine key. Matches provisioning_steps.step_key. Never renamed. */
  key:   string;
  label: string;
  order: number;
  /**
   * Seed value for provisioning_steps.blocking. FALSE means a failure is
   * recorded and the run continues.
   *
   * `service_plan` ships false deliberately. Making it a hard gate ahead of
   * account creation was proposed and rejected: on this deployment it always
   * fails, so gating on it would break account provisioning entirely. The DB
   * column is authoritative at runtime, so this flips without a code change
   * once the Sippy blocker clears.
   */
  blocking: boolean;

  execute(ctx: StepContext): Promise<StepOutcome>;

  /**
   * Read-back verification. Re-reads the object FROM SIPPY and confirms it is in
   * the expected state. Return null when verified, or a reason string when not.
   *
   * Mandatory in spirit, optional in type only so a step with genuinely nothing
   * to read back need not fake one. A step that changes Sippy and declares no
   * verify() is asserting that its own return value is proof — which this
   * platform has twice shown it is not: the Tariff-33 restore reported success
   * on an empty tariff, and Service Plan creation reported a permission failure
   * for a plan that had in fact been created. Both were caught only by reading
   * the switch afterwards.
   *
   * Runs AFTER execute() succeeds. A verify failure marks the step failed even
   * though execute() returned success — that is the entire point.
   *
   * A step whose check is worth describing may return a VerifyReport instead, and its
   * lines join the step's detail whether the check passed or failed. "12 requested, 12
   * created, 12 verified via listAuthRules + getAuthRuleInfo" is what an operator needs
   * from a PASS; a bare tick tells them a check ran, not what it proved.
   */
  verify?(ctx: StepContext, result: Record<string, unknown>): Promise<VerifyOutcome>;

  /** Optional pre-flight. Return an error string to fail fast without side
   *  effects; return null to proceed. */
  validate?(ctx: StepContext): Promise<string | null>;

  /** Optional compensation. Deliberately NOT wired into the runner yet —
   *  automatic rollback of live Sippy objects is destructive and the platform's
   *  own guidance is deactivate-then-archive rather than delete. Present so
   *  executors can declare it; invoking it stays a separate, explicit decision. */
  rollback?(ctx: StepContext): Promise<void>;
}

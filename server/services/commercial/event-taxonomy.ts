/**
 * Commercial Workflow — Canonical Event Taxonomy
 * ================================================
 * Single source of truth for all event_type strings written to workflow_events.
 *
 * Rules (frozen with Execution Layer Phase 1):
 *   1. Every event_type MUST be defined here before use.
 *   2. Format is dot-notation: "{subject_type}.{verb_past_tense}"
 *   3. No string literals in routes or domain code — always import from here.
 *   4. Extend each namespace as D2–D5 workstreams are built; never remove entries.
 *
 * Subject types: rate_job | account | quality_alert | balance_alert | followup | workflow
 */

// ── Rate Job Lifecycle (D1 + D2) ──────────────────────────────────────────────
export const RATE_JOB = {
  /** A new rate push job has been created and is pending activation */
  CREATED:              'rate_job.created',
  /** A KAM or admin approved the rate notification for sending */
  APPROVED:             'rate_job.approved',
  /** A KAM or admin rejected the rate notification */
  REJECTED:             'rate_job.rejected',
  /** Rate was successfully activated in Sippy (tariff updated) */
  ACTIVATED:            'rate_job.activated',
  /** Post-activation spot-check passed — rates confirmed live */
  VERIFICATION_PASSED:  'rate_job.verification_passed',
  /** Post-activation spot-check failed — rates may not be live */
  VERIFICATION_FAILED:  'rate_job.verification_failed',
  /** Notification email/sheet sent to the customer */
  CUSTOMER_NOTIFIED:    'rate_job.customer_notified',
  /** Job was dismissed without action */
  DISMISSED:            'rate_job.dismissed',
  /** Approval request was re-submitted after rejection */
  RESUBMITTED:          'rate_job.resubmitted',
} as const;

// ── Follow-up Tracking (D4) ───────────────────────────────────────────────────
export const FOLLOWUP = {
  /** A new follow-up task was created (from an Action Center item) */
  CREATED:   'followup.created',
  /** Work on this follow-up has started */
  STARTED:   'followup.started',
  /** Follow-up completed successfully */
  COMPLETED: 'followup.completed',
  /** Follow-up was dismissed without further action */
  DISMISSED: 'followup.dismissed',
  /** Follow-up was assigned to a team member */
  ASSIGNED:  'followup.assigned',
  /** Follow-up is blocked — waiting on external input */
  WAITING:   'followup.waiting',
} as const;

// ── Quality Events ─────────────────────────────────────────────────────────────
export const QUALITY = {
  /** A quality/MOS alert was acknowledged by a team member */
  ALERT_ACKNOWLEDGED: 'quality.alert_acknowledged',
  /** A quality alert was escalated for urgent action */
  ALERT_ESCALATED:    'quality.alert_escalated',
} as const;

// ── Balance Events ────────────────────────────────────────────────────────────
export const BALANCE = {
  /** A low-balance warning was acknowledged */
  WARNING_ACKNOWLEDGED: 'balance.warning_acknowledged',
} as const;

// ── Traffic Events ────────────────────────────────────────────────────────────
export const TRAFFIC = {
  /** A traffic drop alert was acknowledged */
  DROP_ACKNOWLEDGED: 'traffic.drop_acknowledged',
} as const;

// ── Generic Workflow Events ───────────────────────────────────────────────────
export const WORKFLOW = {
  /** A freeform note was added to a workflow item */
  NOTE_ADDED: 'workflow.note_added',
} as const;

// ── Rate Lifecycle State Machine ──────────────────────────────────────────────
//
// Declarative definition of ALL legal state transitions for the rate push
// lifecycle.  This map knows nothing about SQL, permissions, or business rules.
//
// Responsibility: "Is this transition legal?"
// Permissions:   enforced by the CALLER (business module) before calling execute
// SQL:           handled by the execution engine and projection layer
//
// State flow:
//
//   pending_rates → awaiting_approval
//                ↘ dismissed
//
//   awaiting_approval → approved
//                     → rejected → awaiting_approval  (re-submit)
//                     → dismissed
//
//   approved → activated
//            → dismissed
//
//   activated → verification_passed
//             → verification_failed → activated  (retry)
//                                   → dismissed
//
//   verification_passed → complete
//   complete            → (terminal)
//   dismissed           → (terminal)
//
export const RATE_LIFECYCLE_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  pending_rates:        ['awaiting_approval', 'dismissed'],
  awaiting_approval:    ['approved', 'rejected', 'dismissed'],
  approved:             ['activated', 'dismissed'],
  activated:            ['verification_passed', 'verification_failed'],
  verification_passed:  ['complete'],
  verification_failed:  ['activated', 'dismissed'],
  rejected:             ['awaiting_approval'],  // re-submit path
  complete:             [],
  dismissed:            [],
} as const;

// Terminal states — no further transitions are legal
export const RATE_LIFECYCLE_TERMINAL: ReadonlySet<string> = new Set(['complete', 'dismissed']);

/**
 * Validate a state transition against the rate lifecycle state machine.
 *
 * Single responsibility: is the transition legal?
 * Throws a domain error if the hop is illegal — callers should surface this
 * to the user as a validation failure, not a 500.
 *
 * Permission checks (can THIS user make this transition?) belong in the
 * business module BEFORE calling this function.
 */
export function validateRateTransition(from: string, to: string): void {
  const legal = RATE_LIFECYCLE_TRANSITIONS[from] ?? [];
  if (!(legal as readonly string[]).includes(to)) {
    const allowed = (RATE_LIFECYCLE_TRANSITIONS[from] ?? []).join(', ') || 'none';
    throw new RateTransitionError(
      `Illegal rate lifecycle transition: "${from}" → "${to}". ` +
      `Legal transitions from "${from}": [${allowed}]`
    );
  }
}

/** Domain error for illegal lifecycle transitions — distinct from system errors */
export class RateTransitionError extends Error {
  readonly isDomainError = true;
  constructor(message: string) {
    super(message);
    this.name = 'RateTransitionError';
  }
}

// ── Rate status → event_type mapping ─────────────────────────────────────────
// Maps a rate_notification_jobs.status value to its corresponding event_type.
// Used by deriveJobState() when rebuilding projection from the event stream.
export const RATE_STATUS_TO_EVENT: Readonly<Record<string, string>> = {
  pending_rates:        RATE_JOB.CREATED,
  awaiting_approval:    RATE_JOB.APPROVED,       // closest event
  approved:             RATE_JOB.APPROVED,
  rejected:             RATE_JOB.REJECTED,
  activated:            RATE_JOB.ACTIVATED,
  verification_passed:  RATE_JOB.VERIFICATION_PASSED,
  verification_failed:  RATE_JOB.VERIFICATION_FAILED,
  complete:             RATE_JOB.CUSTOMER_NOTIFIED,
  dismissed:            RATE_JOB.DISMISSED,
} as const;

// Reverse map: event_type → status string for projection rebuilding
export const RATE_EVENT_TO_STATUS: Readonly<Record<string, string>> = {
  [RATE_JOB.CREATED]:             'pending_rates',
  [RATE_JOB.RESUBMITTED]:         'awaiting_approval',
  [RATE_JOB.APPROVED]:            'approved',
  [RATE_JOB.REJECTED]:            'rejected',
  [RATE_JOB.ACTIVATED]:           'activated',
  [RATE_JOB.VERIFICATION_PASSED]: 'verification_passed',
  [RATE_JOB.VERIFICATION_FAILED]: 'verification_failed',
  [RATE_JOB.CUSTOMER_NOTIFIED]:   'complete',
  [RATE_JOB.DISMISSED]:           'dismissed',
} as const;

// ── Convenience union type ────────────────────────────────────────────────────
// Enables TypeScript narrowing on event_type strings from workflow_events rows.
export type RateJobEvent   = typeof RATE_JOB[keyof typeof RATE_JOB];
export type FollowupEvent  = typeof FOLLOWUP[keyof typeof FOLLOWUP];
export type QualityEvent   = typeof QUALITY[keyof typeof QUALITY];
export type BalanceEvent   = typeof BALANCE[keyof typeof BALANCE];
export type TrafficEvent   = typeof TRAFFIC[keyof typeof TRAFFIC];
export type WorkflowEvent  = typeof WORKFLOW[keyof typeof WORKFLOW];

export type AnyEventType =
  | RateJobEvent
  | FollowupEvent
  | QualityEvent
  | BalanceEvent
  | TrafficEvent
  | WorkflowEvent;

// ── Subject types (canonical) ─────────────────────────────────────────────────
export const SUBJECT_TYPE = {
  RATE_JOB:      'rate_job',
  ACCOUNT:       'account',
  QUALITY_ALERT: 'quality_alert',
  BALANCE_ALERT: 'balance_alert',
  FOLLOWUP:      'followup',
} as const;

export type SubjectType = typeof SUBJECT_TYPE[keyof typeof SUBJECT_TYPE];

// ── Correlation ID helpers ────────────────────────────────────────────────────
// Convention: "{subject_type}_{subject_id}"
// This keeps correlation IDs stable, human-readable, and queryable.
export function makeCorrelationId(subjectType: SubjectType, subjectId: string | number): string {
  return `${subjectType}_${subjectId}`;
}

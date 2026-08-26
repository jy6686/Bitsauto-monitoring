/**
 * cdr-completeness.ts — where calls are lost between the switch and a snapshot.
 *
 * On 2026-08-26 an invoice was issued for roughly one percent of a customer's
 * traffic. Every per-call amount on it was correct; the population was not.
 * Nothing in the pipeline compared its own totals against anything outside
 * itself, so the gap was invisible until Sippy's own summary was read by hand.
 *
 * This turns that comparison into a measurement. Given the counts at each
 * stage it names the FIRST stage that lost calls, because that is the only
 * stage worth investigating — every later shortfall is inherited.
 *
 * ── The pipeline being measured ──────────────────────────────────────────────
 *
 *   sippy_reference   what the switch says it billed (Customer Summary)
 *         ↓           fetch · account filter · insert-dedup on i_cdr
 *   repository        raw_sippy_cdrs
 *         ↓           skip of already-snapshotted cdr ids
 *   verified          rating_verifications
 *         ↓           lockBatch drops unrated / no-rate calls
 *   snapshotted       invoice_cdr_snapshots — what an invoice can bill
 *
 * ── Minutes are authoritative, calls are not ─────────────────────────────────
 * Sippy's "Number of Calls" counts ATTEMPTS. Proof from the reference itself:
 * Bangladesh reported 59,104 calls against 51,242 billed seconds, and with
 * interval1 >= 1s every billed call bills at least one second, so a call count
 * above billed seconds can only include unbilled attempts. BitsAuto counts
 * billable calls. Both are right; they measure different sets.
 *
 * So the reference comparison is made on MINUTES, and its call figure is
 * carried for information only. Comparing calls there would report a permanent
 * false shortfall on a complete import. Between BitsAuto's own stages calls are
 * comparable, because both sides then count the same thing.
 *
 * Dependency-free so the rule is pinned by tests rather than by a database.
 */

export type StageName =
  | 'sippy_reference'
  | 'repository'
  | 'verified'
  | 'snapshotted';

/** Stage order is the pipeline order. Losses are attributed to transitions. */
export const STAGE_ORDER: StageName[] = [
  'sippy_reference',
  'repository',
  'verified',
  'snapshotted',
];

export interface StageCount {
  stage: StageName;
  /** Rows at this stage. null when the stage was not measured. */
  calls: number | null;
  /** Billed minutes at this stage. null when not measured. */
  billedMinutes: number | null;
}

export interface Transition {
  from: StageName;
  to:   StageName;
  /** Minutes kept, as a percentage. null when either side is unmeasured. */
  minutesRetainedPct: number | null;
  minutesLost:        number | null;
  /**
   * Calls kept. Deliberately null across sippy_reference → repository: the two
   * sides count different things there (see the header), and a number that
   * cannot be compared is worse than no number.
   */
  callsRetainedPct: number | null;
  callsLost:        number | null;
  /** True when this transition lost more than the tolerance allows. */
  lossy: boolean;
}

/**
 * Repeated call ids in the repository. Not a loss in itself — a PREDICTOR of
 * one, because the snapshot stage skips any cdr id it has already snapshotted
 * for the tariff, with no period bound. Duplicate ids there mean calls are
 * being discarded as "already seen" when they are distinct calls.
 */
export interface IdentityCollision {
  rows:              number;
  distinctCallIds:   number;
  duplicateCallIds:  number;
  /** Share of rows whose call id is not unique. */
  duplicatePct:      number;
}

export type CompletenessStatus =
  | 'complete'       // every measured transition within tolerance
  | 'incomplete'     // at least one transition lost calls
  | 'no_reference';  // nothing external to compare against — see below

export interface CompletenessVerdict {
  status: CompletenessStatus;
  /**
   * The first lossy transition. Investigate this one; later shortfalls are
   * inherited from it and say nothing new.
   */
  lossStage: Transition | null;
  transitions: Transition[];
  identityCollision: IdentityCollision | null;
  /** Plain statements of what was and was not measured. */
  notes: string[];
}

/** Below this, a difference is rounding rather than loss. */
export const DEFAULT_TOLERANCE_PCT = 0.5;

function pct(part: number, whole: number): number {
  if (whole === 0) return part === 0 ? 100 : 0;
  return +((part / whole) * 100).toFixed(4);
}

function round(n: number): number {
  return +n.toFixed(4);
}

function transition(
  from: StageCount,
  to: StageCount,
  tolerancePct: number,
): Transition {
  // Calls are only comparable once both sides count billable calls. Across the
  // reference boundary they do not — see the header.
  const callsComparable = from.stage !== 'sippy_reference';

  const minutesMeasured =
    from.billedMinutes !== null && to.billedMinutes !== null;
  const callsMeasured =
    callsComparable && from.calls !== null && to.calls !== null;

  const minutesRetainedPct = minutesMeasured
    ? pct(to.billedMinutes!, from.billedMinutes!)
    : null;
  const callsRetainedPct = callsMeasured
    ? pct(to.calls!, from.calls!)
    : null;

  // A stage that GAINED rows is not lossy. It is a different problem — and one
  // this function deliberately does not classify, because a gain means the two
  // stages are not measuring the same period or account, which no retention
  // percentage can express.
  const lossy =
    (minutesRetainedPct !== null && minutesRetainedPct < 100 - tolerancePct) ||
    (callsRetainedPct   !== null && callsRetainedPct   < 100 - tolerancePct);

  return {
    from: from.stage,
    to:   to.stage,
    minutesRetainedPct,
    minutesLost: minutesMeasured
      ? round(from.billedMinutes! - to.billedMinutes!)
      : null,
    callsRetainedPct,
    callsLost: callsMeasured ? from.calls! - to.calls! : null,
    lossy,
  };
}

/**
 * Classify a period's ingestion.
 *
 * Stages may be passed in any order and may be omitted; only adjacent measured
 * stages are compared. Omitting sippy_reference is not an error — it yields
 * `no_reference`, which is a distinct outcome from `complete`. A pipeline that
 * agrees with itself has demonstrated nothing about whether it saw everything,
 * and reporting that as "complete" would repeat the original defect in a new
 * place.
 */
export function assessCompleteness(
  stages: StageCount[],
  opts: { tolerancePct?: number; identity?: IdentityCollision | null } = {},
): CompletenessVerdict {
  const tolerancePct = opts.tolerancePct ?? DEFAULT_TOLERANCE_PCT;
  const notes: string[] = [];

  const byStage = new Map<StageName, StageCount>();
  for (const s of stages) byStage.set(s.stage, s);

  const present = STAGE_ORDER.filter(s => byStage.has(s));
  const transitions: Transition[] = [];
  for (let i = 0; i + 1 < present.length; i++) {
    transitions.push(
      transition(byStage.get(present[i])!, byStage.get(present[i + 1])!, tolerancePct),
    );
  }

  const hasReference = byStage.has('sippy_reference');
  if (!hasReference) {
    notes.push(
      'No Sippy reference supplied — this compares BitsAuto against itself and ' +
      'cannot detect calls the platform never imported.',
    );
  }

  for (const s of STAGE_ORDER) {
    const c = byStage.get(s);
    if (c && c.billedMinutes === null) {
      notes.push(`Stage "${s}" reported no billed minutes; comparisons against it use calls only.`);
    }
  }

  const identity = opts.identity ?? null;
  if (identity && identity.duplicateCallIds > 0) {
    notes.push(
      `${identity.duplicateCallIds} repeated call id(s) in the repository ` +
      `(${identity.duplicatePct}% of rows). The snapshot stage skips ids it has ` +
      `already snapshotted for the tariff, with no period bound, so repeats are ` +
      `discarded as duplicates even when the calls are distinct.`,
    );
  }

  const lossStage = transitions.find(t => t.lossy) ?? null;

  const status: CompletenessStatus =
    !hasReference ? 'no_reference' : lossStage ? 'incomplete' : 'complete';

  return { status, lossStage, transitions, identityCollision: identity, notes };
}

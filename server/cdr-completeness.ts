/**
 * cdr-completeness.ts — where calls, minutes and money are lost between the
 * switch and a snapshot.
 *
 * On 2026-08-26 an invoice was issued for roughly one percent of a customer's
 * traffic. Every per-call amount on it was correct; the population was not.
 * Nothing in the pipeline compared its own totals against anything outside
 * itself, so the gap was invisible until Sippy's own summary was read by hand.
 *
 * This turns that comparison into a measurement. Given the counts at each stage
 * it names the FIRST stage that lost anything, because that is the only stage
 * worth investigating — every later shortfall is inherited.
 *
 * ── Three dimensions, because they fail differently ──────────────────────────
 * Calls, minutes and cost are compared separately and a transition records
 * WHICH of them it lost. The distinction is diagnostic, not cosmetic:
 *
 *   calls and minutes short, cost proportional  → population: rows never arrived
 *   calls and minutes intact, cost short        → rating or mapping: rows arrived unpriced
 *   cost short only at one stage                → an exclusion rule dropped priced calls
 *
 * A single "complete / incomplete" verdict cannot express that, and the three
 * causes have nothing in common but their symptom.
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
 * ── Minutes are authoritative across the reference boundary; calls are not ───
 * Sippy's "Number of Calls" counts ATTEMPTS. Proof from the reference itself:
 * Bangladesh reported 59,104 calls against 51,242 billed seconds, and with
 * interval1 >= 1s every billed call bills at least one second, so a call count
 * above billed seconds can only include unbilled attempts. BitsAuto counts
 * billable calls. Both are right; they measure different sets.
 *
 * So calls are NOT compared across that boundary and the reference's call
 * figure is carried for information only. Comparing it would report a permanent
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

/** What a stage can lose. Each fails for different reasons — see the header. */
export type Dimension = 'calls' | 'minutes' | 'cost';

export const DIMENSIONS: Dimension[] = ['calls', 'minutes', 'cost'];

export interface StageCount {
  stage: StageName;
  /** Rows at this stage. null when the stage was not measured. */
  calls: number | null;
  /** Billed minutes at this stage. null when not measured. */
  billedMinutes: number | null;
  /**
   * Money at this stage, ALWAYS the switch's own figure.
   *
   * Never the reproduced cost. The rating engine currently over-reports by up
   * to 60x on tariffs whose intervals are not 60/60, so a stage measured on
   * reproduced cost would appear to GAIN money and mask a real shortfall. The
   * comparison is only meaningful between figures that mean the same thing.
   */
  cost: number | null;
}

export interface Transition {
  from: StageName;
  to:   StageName;
  /** Percentage kept, per dimension. null when that dimension is not comparable here. */
  retained: Record<Dimension, number | null>;
  /** Absolute amount lost, per dimension. Negative means the stage grew. */
  lost: Record<Dimension, number | null>;
  /** Which dimensions fell below tolerance. Empty when none did. */
  lossyDimensions: Dimension[];
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
  | 'incomplete'     // at least one transition lost something
  | 'no_reference';  // nothing external to compare against — see below

export interface CompletenessVerdict {
  status: CompletenessStatus;
  /**
   * The first lossy transition. Investigate this one; later shortfalls are
   * inherited from it and say nothing new.
   */
  lossStage: Transition | null;
  /** Every measured stage, in pipeline order — not only the lossy ones. */
  stages: StageCount[];
  transitions: Transition[];
  identityCollision: IdentityCollision | null;
  /** Plain statements of what was and was not measured. */
  notes: string[];
}

/** Below this, a COUNT difference is rounding rather than loss. Calls and minutes only. */
export const DEFAULT_TOLERANCE_PCT = 0.5;

/**
 * Money is judged on an absolute band, never a percentage.
 *
 * BILLING-RECONCILIATION-CONTRACT.md §5: "No percentage tolerances. Finance
 * audits money, not ratios. A percentage band scales the permitted error with
 * the invoice, which is exactly backwards." A 0.5% band on the contract's own
 * worked reference of $576.3327 hides $2.88 where §5 permits one cent.
 *
 * Reachable here only because every money aggregate in this module casts to
 * numeric before summing (§10 remedy 1); summing the underlying float4 columns
 * as `real` accumulates dollars of error at this scale and no cent-level band
 * would survive it.
 */
export const DEFAULT_MONEY_TOLERANCE_USD = 0.01;

/** null when there is no base to be a fraction OF — not 100%. */
function pct(part: number, whole: number): number | null {
  if (whole === 0) return null;
  return +((part / whole) * 100).toFixed(4);
}

function round(n: number): number {
  return +n.toFixed(6);
}

const valueOf = (s: StageCount, d: Dimension): number | null =>
  d === 'calls' ? s.calls : d === 'minutes' ? s.billedMinutes : s.cost;

function transition(
  from: StageCount,
  to: StageCount,
  tolerancePct: number,
  moneyToleranceUsd: number,
): Transition {
  const retained = {} as Record<Dimension, number | null>;
  const lost     = {} as Record<Dimension, number | null>;
  const lossyDimensions: Dimension[] = [];

  for (const d of DIMENSIONS) {
    // Calls only become comparable once both sides count billable calls.
    // Across the reference boundary they do not — see the header.
    const comparable = !(d === 'calls' && from.stage === 'sippy_reference');
    const a = valueOf(from, d);
    const b = valueOf(to, d);

    if (!comparable || a === null || b === null) {
      retained[d] = null;
      lost[d]     = null;
      continue;
    }

    retained[d] = pct(b, a);
    lost[d]     = round(a - b);

    // A stage that GAINED is not lossy. It is a different problem, and one this
    // function deliberately does not classify: a gain means the two stages are
    // not measuring the same period or account, which no retention percentage
    // can express. The negative `lost` value says so without pretending to
    // explain it.
    //
    // Money is judged absolutely, counts proportionally. A zero base yields a
    // null retention and cannot be lossy: nothing was there to lose, and
    // reporting 100% retained for 0 → 0 would render an account that imported
    // nothing as a clean run.
    const lossy = d === 'cost'
      ? lost[d]! > moneyToleranceUsd
      : retained[d] !== null && retained[d]! < 100 - tolerancePct;
    if (lossy) lossyDimensions.push(d);
  }

  return {
    from: from.stage,
    to:   to.stage,
    retained,
    lost,
    lossyDimensions,
    lossy: lossyDimensions.length > 0,
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
  opts: {
    tolerancePct?: number;
    moneyToleranceUsd?: number;
    identity?: IdentityCollision | null;
  } = {},
): CompletenessVerdict {
  const tolerancePct      = opts.tolerancePct ?? DEFAULT_TOLERANCE_PCT;
  const moneyToleranceUsd = opts.moneyToleranceUsd ?? DEFAULT_MONEY_TOLERANCE_USD;
  const notes: string[] = [];

  const byStage = new Map<StageName, StageCount>();
  for (const s of stages) byStage.set(s.stage, s);

  const ordered = STAGE_ORDER.filter(s => byStage.has(s)).map(s => byStage.get(s)!);

  const transitions: Transition[] = [];
  for (let i = 0; i + 1 < ordered.length; i++) {
    transitions.push(transition(ordered[i], ordered[i + 1], tolerancePct, moneyToleranceUsd));
  }

  const hasReference = byStage.has('sippy_reference');
  if (!hasReference) {
    notes.push(
      'No Sippy reference supplied — this compares BitsAuto against itself and ' +
      'cannot detect calls the platform never imported.',
    );
  }

  for (const s of ordered) {
    const missing = DIMENSIONS.filter(d => valueOf(s, d) === null);
    if (missing.length) {
      notes.push(`Stage "${s.stage}" did not report ${missing.join(', ')}; those are not compared against it.`);
    }
    // An empty stage is a finding in itself, and it is invisible in the
    // transitions: 0 → 0 yields a null retention, not a loss. Without this note
    // an account that imported nothing reads as "no lossy transition".
    const measured = DIMENSIONS.filter(d => valueOf(s, d) !== null);
    if (measured.length && measured.every(d => valueOf(s, d) === 0)) {
      notes.push(`Stage "${s.stage}" is EMPTY — every measured dimension is zero. Transitions out of an empty stage cannot show loss.`);
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

  if (lossStage) {
    const d = lossStage.lossyDimensions;
    const populationLost = d.includes('calls') || d.includes('minutes');
    notes.push(
      populationLost
        ? `Lost ${d.join(' and ')} at ${lossStage.from} → ${lossStage.to}: rows did not survive this stage.`
        : `Minutes intact but money short at ${lossStage.from} → ${lossStage.to}: ` +
          `the calls arrived and were not priced. This is a rating or mapping ` +
          `problem, not a population problem.`,
    );
  }

  const status: CompletenessStatus =
    !hasReference ? 'no_reference' : lossStage ? 'incomplete' : 'complete';

  return {
    status,
    lossStage,
    stages: ordered,
    transitions,
    identityCollision: identity,
    notes,
  };
}

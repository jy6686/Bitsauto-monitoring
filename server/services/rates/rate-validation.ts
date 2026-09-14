/**
 * rate-validation.ts — the commercial rules a rate change must satisfy BEFORE any Sippy mutation.
 *
 * `docs/RATE-CHANGE-POLICY.md` is the authority. This module implements the ratified shape of that
 * policy and REFUSES TO IMPLEMENT the parts it records as unresolved.
 *
 * THE SHAPE, which is not the obvious one:
 *
 *   - **Thresholds are GLOBAL.** The 50% alerts, the 7/14-day date bounds, the pending-increase
 *     limit: one set of numbers for the platform, from Configuration Values.
 *   - **Outcomes are PER CLIENT AND PER DEPARTMENT.** The same violation is `IGNORE` for one
 *     client and `REJECT DESTINATION` for another. A platform-wide "50% rule" would be the wrong
 *     shape — there is no single rule to duplicate.
 *   - **A rejection has three blast radii**: the whole rate sheet, one country, or one
 *     destination. A violating rate does not necessarily fail the push; it can drop only itself.
 *
 * WHAT THIS MODULE WILL NOT DO.
 *
 *   - **It will not invent RELEASE.** The owner stated release is the mechanism permitting a
 *     >50% decrease and that it must come from the old system rather than be invented. Nothing
 *     read so far defines it, and there is evidence AGAINST equating it with the `Pending` status
 *     codes or with `REJECT DESTINATION`. The word does not appear in this implementation.
 *   - **It will not decide the 50% boundary.** Whether the rule is `>50%` or `>=50%` is
 *     unresolved, so a change landing EXACTLY on the threshold is returned as `undecidable` — not
 *     passed, not refused. Guessing would decide real money on a coin flip.
 *   - **It will not choose a comparison base.** What "the currently offered rate" is remains
 *     open (live Sippy rate, `product_rates`, or the issued offer — and the two tariff-resolution
 *     paths already disagree for 22 of 26 companies). The caller states the base it used and
 *     where it came from; this module never picks one.
 *
 * AND IT MUTATES NOTHING. No database, no Sippy, no clock of its own. Every refusal it produces
 * carries `refusedBeforeWrite: true`, structurally true because nothing here can send anything.
 */

/** The six rules, exactly as the old system's rule engine names them. */
export type RuleId =
  | 'rate_increase_notice_violation'
  | 'suspect_rate_increase'
  | 'suspect_rate_decrease'
  | 'pending_increases_exceeded'
  | 'effective_date_greater_than_limit'
  | 'effective_date_older_than_limit';

/** The six configurable outcomes. */
export type Outcome =
  | 'IGNORE'
  | 'REJECT_RATE_SHEET'
  | 'REJECT_COUNTRY'
  | 'REJECT_DESTINATION'
  | 'APPROVAL_REQD'
  | 'AUTO_ADJUST_EFFECTIVE_DATE';

/**
 * `AUTO_ADJUST_EFFECTIVE_DATE` is offered on the notice-violation rule ONLY — the other five rows
 * do not have that column enabled. Configuring it elsewhere is a configuration error, not a
 * silently-downgraded outcome.
 */
export const AUTO_ADJUST_ALLOWED_ON: ReadonlyArray<RuleId> = ['rate_increase_notice_violation'];

/** Global thresholds, from Configuration Values. Every one is optional; absent means unconfigured. */
export interface Thresholds {
  /** Percent. A decrease beyond this is a suspect decrease. */
  rateDecreaseAlertPct?: number;
  /** Percent. Symmetric with the decrease alert in the old system. */
  rateIncreaseAlertPct?: number;
  /** Days of notice an increase requires. */
  increaseNoticePeriodDays?: number;
  /** Days. How far forward an effective date may be set. */
  futureEffectiveDateDays?: number;
  /** Days. How far back an effective date may be set. */
  oldEffectiveDateDays?: number;
  /** How many pending increases are tolerated. */
  acceptablePendingIncreases?: number;
}

/** One client+department's outcome for each rule. A rule with no entry is not configured. */
export interface RuleConfig {
  clientName: string;
  department: string;
  outcomes: Partial<Record<RuleId, Outcome>>;
}

export interface RateChange {
  /** Stable key for reporting. */
  key: string;
  destinationId: number | null;
  destinationName: string;
  /**
   * The country this destination belongs to. Supplied, never parsed out of the name here: a
   * `REJECT_COUNTRY` that guessed the country from a string would drop the wrong destinations.
   * Absent makes a country-wide rejection undecidable rather than quietly destination-wide.
   */
  country?: string | null;
  /** The rate being requested. */
  newRate: number;
  /**
   * The rate being compared against, and WHERE IT CAME FROM. Null means there is no prior rate.
   * The source is carried because the policy records that candidate sources disagree, and a
   * decision made against an unstated base cannot be audited.
   */
  priorRate: number | null;
  priorRateSource: 'sippy_tariff' | 'product_rates' | 'issued_offer' | 'none' | 'unknown';
  /** ISO day the change is requested to take effect. */
  effectiveDate: string;
  /** ISO day the request is being evaluated on. Injected, never read from the machine clock. */
  today: string;
  /** Pending increases already outstanding for this client, when the caller knows. */
  pendingIncreases?: number;
  /** A billing-increment change riding along with the rate change, for reporting. */
  incrementChange?: { from: string | null; to: string | null } | null;
}

export type Direction = 'increase' | 'decrease' | 'unchanged' | 'first_rate';

/**
 * Not one of the six rules: the PRECONDITION for asking any of them. With no usable base there is
 * no percentage, so "is this suspect?" cannot be put at all — which is a different thing from
 * putting it and getting "no".
 */
export type FindingSubject = RuleId | 'no_comparison_base';

export interface Finding {
  rule: FindingSubject;
  /** What the data says happened. */
  detail: string;
  /** The configured consequence, or null when this client+department configures none. */
  outcome: Outcome | null;
  /**
   * True when the rule FIRED but the policy cannot say what follows. The caller must not treat
   * this as a pass; it is an open question with a name.
   */
  undecidable?: boolean;
  undecidedBecause?: string;
}

export interface Assessment {
  key: string;
  destinationId: number | null;
  destinationName: string;
  country: string | null;
  direction: Direction;
  /** Signed percent change against the stated base. Null when there is no base to compare to. */
  changePct: number | null;
  priorRate: number | null;
  priorRateSource: RateChange['priorRateSource'];
  newRate: number;
  effectiveDate: string;
  /** An effective date the policy moved, and why. Null when it was not adjusted. */
  adjustedEffectiveDate: { from: string; to: string; rule: RuleId } | null;
  incrementChange: { from: string | null; to: string | null } | null;
  findings: Finding[];
  /** Every refusal this module produces is pre-write, structurally: it cannot send anything. */
  refusedBeforeWrite: true;
}

/**
 * The threshold each rule is measured against. A rule cannot be evaluated without its threshold,
 * and a rule that cannot be evaluated must not pass — see `unmeasurableRules`.
 */
export const THRESHOLD_FOR_RULE: Record<RuleId, keyof Thresholds> = {
  suspect_rate_decrease:             'rateDecreaseAlertPct',
  suspect_rate_increase:             'rateIncreaseAlertPct',
  rate_increase_notice_violation:    'increaseNoticePeriodDays',
  effective_date_greater_than_limit: 'futureEffectiveDateDays',
  effective_date_older_than_limit:   'oldEffectiveDateDays',
  pending_increases_exceeded:        'acceptablePendingIncreases',
};

const DAY = 86_400_000;
const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

const addDays = (iso: string, days: number): string =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

const pctChange = (prior: number, next: number): number => ((next - prior) / prior) * 100;

/**
 * Assess ONE rate change. Pure: same inputs, same answer, no clock and no database.
 *
 * The percentage is computed against the base the CALLER states. This module does not choose
 * between the live Sippy rate, `product_rates` and the issued offer, because the policy records
 * that they disagree and that the choice is unresolved.
 */
export function assessRateChange(
  change: RateChange,
  thresholds: Thresholds,
  config: RuleConfig | null,
): Assessment {
  const findings: Finding[] = [];
  const outcomeFor = (rule: RuleId): Outcome | null => config?.outcomes?.[rule] ?? null;

  const direction: Direction =
    change.priorRate === null ? 'first_rate'
    : change.newRate > change.priorRate ? 'increase'
    : change.newRate < change.priorRate ? 'decrease'
    : 'unchanged';

  // A zero prior rate has no meaningful percentage — dividing by it yields Infinity, which would
  // then compare as "beyond every threshold" and refuse on arithmetic rather than on policy.
  const changePct =
    change.priorRate === null || change.priorRate === 0
      ? null
      : pctChange(change.priorRate, change.newRate);

  // ── Suspect increase / decrease ────────────────────────────────────────────
  const magnitude = changePct === null ? null : Math.abs(changePct);
  const alert = direction === 'decrease' ? thresholds.rateDecreaseAlertPct
              : direction === 'increase' ? thresholds.rateIncreaseAlertPct
              : undefined;
  const suspectRule: RuleId | null =
    direction === 'decrease' ? 'suspect_rate_decrease'
    : direction === 'increase' ? 'suspect_rate_increase'
    : null;

  // No usable base. Reported whether or not a direction could be determined, because the gap is
  // the same either way and a row that fires nothing proceeds — which is the silent outcome policy
  // gap 5 exists to prevent.
  if (magnitude === null
      && (thresholds.rateDecreaseAlertPct !== undefined || thresholds.rateIncreaseAlertPct !== undefined)) {
    findings.push({
      rule: 'no_comparison_base',
      detail: change.priorRate === null
        ? `No prior rate for ${change.destinationName} (base: ${change.priorRateSource}), so there is nothing to compare against.`
        : `The prior rate for ${change.destinationName} is 0, which has no percentage change.`,
      outcome: null,
      undecidable: true,
      undecidedBecause:
        'The policy does not state whether a rate with no usable comparison base is constrained. '
      + 'Sourcing that is open work; it is not decided here.',
    });
  }

  if (suspectRule && alert !== undefined && magnitude !== null) {
    if (magnitude === alert) {
      // THE BOUNDARY. `>50%` and `>=50%` disagree precisely here, and which one governs is
      // unresolved. Returning a verdict would decide real money by guess.
      findings.push({
        rule: suspectRule,
        detail: `${change.destinationName}: ${changePct!.toFixed(2)}% is exactly the ${alert}% threshold.`,
        outcome: outcomeFor(suspectRule),
        undecidable: true,
        undecidedBecause:
          `Whether the threshold is "greater than ${alert}%" or "${alert}% or more" is not `
        + 'established. A change landing exactly on it is not decided until the authoritative '
        + 'calculation is read.',
      });
    } else if (magnitude > alert) {
      findings.push({
        rule: suspectRule,
        detail: `${change.destinationName}: ${changePct!.toFixed(2)}% against the ${alert}% threshold `
              + `(${change.priorRate} → ${change.newRate}, base: ${change.priorRateSource}).`,
        outcome: outcomeFor(suspectRule),
      });
    }
  }

  // ── A CONFIGURED RULE WITH NO THRESHOLD CANNOT BE EVALUATED ────────────────
  //
  // The same failure as an unconfigured outcome, one dimension over. A client who configured
  // REJECT DESTINATION for suspect decreases, against a threshold absent from
  // `configuration_values`, would otherwise have every decrease PROCEED — including a −98% one —
  // because the rule simply never fires. Silence in the threshold is not permission either.
  //
  // Scoped to rules this change could actually breach: a missing decrease threshold is irrelevant
  // to an increase, and reporting it would bury the real findings in noise.
  const relevant: RuleId[] = [
    'effective_date_greater_than_limit',
    'effective_date_older_than_limit',
    ...(direction === 'decrease' ? ['suspect_rate_decrease'] as RuleId[] : []),
    ...(direction === 'increase' ? ['suspect_rate_increase', 'rate_increase_notice_violation'] as RuleId[] : []),
    ...(change.pendingIncreases !== undefined ? ['pending_increases_exceeded'] as RuleId[] : []),
  ];
  for (const rule of relevant) {
    // Only when the client DECLARED a consequence. A rule nobody configured is already undecided
    // if it fires, and a missing threshold for it adds nothing.
    if (outcomeFor(rule) === null) continue;
    if (thresholds[THRESHOLD_FOR_RULE[rule]] !== undefined) continue;
    findings.push({
      rule,
      detail: `${change.destinationName}: ${config?.clientName ?? 'this client'} configures `
            + `${outcomeFor(rule)} for ${rule}, but its threshold (${THRESHOLD_FOR_RULE[rule]}) is not configured.`,
      outcome: outcomeFor(rule),
      undecidable: true,
      undecidedBecause:
        'The rule cannot be evaluated without the value it is measured against. Treating that as '
      + 'a pass would let a declared consequence go unenforced silently.',
    });
  }

  // ── Effective-date bounds ──────────────────────────────────────────────────
  const offset = daysBetween(change.today, change.effectiveDate);

  if (thresholds.futureEffectiveDateDays !== undefined && offset > thresholds.futureEffectiveDateDays) {
    findings.push({
      rule: 'effective_date_greater_than_limit',
      detail: `Effective ${change.effectiveDate} is ${offset} days ahead; the limit is ${thresholds.futureEffectiveDateDays}.`,
      outcome: outcomeFor('effective_date_greater_than_limit'),
    });
  }
  if (thresholds.oldEffectiveDateDays !== undefined && offset < -thresholds.oldEffectiveDateDays) {
    findings.push({
      rule: 'effective_date_older_than_limit',
      detail: `Effective ${change.effectiveDate} is ${-offset} days in the past; the limit is ${thresholds.oldEffectiveDateDays}.`,
      outcome: outcomeFor('effective_date_older_than_limit'),
    });
  }

  // ── Increase notice period ─────────────────────────────────────────────────
  // The only rule that may carry AUTO_ADJUST_EFFECTIVE_DATE, which is how an increase can be
  // "immediate" from the operator's side while a notice period still exists.
  let adjusted: Assessment['adjustedEffectiveDate'] = null;
  if (direction === 'increase' && thresholds.increaseNoticePeriodDays !== undefined
      && offset < thresholds.increaseNoticePeriodDays) {
    const outcome = outcomeFor('rate_increase_notice_violation');
    const required = addDays(change.today, thresholds.increaseNoticePeriodDays);
    findings.push({
      rule: 'rate_increase_notice_violation',
      detail: `An increase effective ${change.effectiveDate} gives ${offset} days' notice; `
            + `${thresholds.increaseNoticePeriodDays} are required (earliest ${required}).`,
      outcome,
    });
    if (outcome === 'AUTO_ADJUST_EFFECTIVE_DATE') {
      adjusted = { from: change.effectiveDate, to: required, rule: 'rate_increase_notice_violation' };
    }
  }

  // ── Pending increases ──────────────────────────────────────────────────────
  if (thresholds.acceptablePendingIncreases !== undefined && change.pendingIncreases !== undefined
      && change.pendingIncreases > thresholds.acceptablePendingIncreases) {
    findings.push({
      rule: 'pending_increases_exceeded',
      detail: `${change.pendingIncreases} pending increases outstanding; the limit is ${thresholds.acceptablePendingIncreases}.`,
      outcome: outcomeFor('pending_increases_exceeded'),
    });
  }

  // A rule that fired with no configured outcome is not a pass. The client+department simply has
  // no entry, and treating silence as IGNORE would make an unconfigured client the most permissive
  // one on the platform.
  for (const f of findings) {
    if (f.rule === 'no_comparison_base') continue;   // already carries its own explanation
    if (f.outcome === null && !f.undecidable) {
      f.undecidable = true;
      f.undecidedBecause = config === null
        ? `No validation rules are configured for this client and department, so what follows from this violation is unknown.`
        : `${config.clientName} / ${config.department} configures no outcome for this rule.`;
    }
    // Configuring AUTO_ADJUST on a rule that does not offer it is a configuration error. Applying
    // it anyway would move an effective date on a rule the old system never allowed it for.
    if (f.outcome === 'AUTO_ADJUST_EFFECTIVE_DATE' && !AUTO_ADJUST_ALLOWED_ON.includes(f.rule as RuleId)) {
      f.undecidable = true;
      f.undecidedBecause =
        `AUTO ADJUST EFFECTIVE DATE is offered on ${AUTO_ADJUST_ALLOWED_ON.join(', ')} only. `
      + `Configuring it on ${f.rule} is a configuration error, not an instruction.`;
    }
  }

  return {
    key: change.key,
    destinationId: change.destinationId,
    destinationName: change.destinationName,
    country: change.country ?? null,
    direction,
    changePct,
    priorRate: change.priorRate,
    priorRateSource: change.priorRateSource,
    newRate: change.newRate,
    effectiveDate: adjusted ? adjusted.to : change.effectiveDate,
    adjustedEffectiveDate: adjusted,
    incrementChange: change.incrementChange ?? null,
    findings,
    refusedBeforeWrite: true,
  };
}

export type Disposition =
  /** Nothing fired, or everything that fired is configured IGNORE. */
  | 'proceed'
  /** Dropped, and by which blast radius. */
  | 'dropped_destination'
  | 'dropped_country'
  | 'dropped_rate_sheet'
  /** A rule fired whose consequence is not established. Never a pass. */
  | 'undecided'
  /** A configured outcome requires a person. */
  | 'approval_required';

export interface ValidatedRow {
  assessment: Assessment;
  disposition: Disposition;
  /** Why, in words a run report can print. */
  reason: string | null;
}

export interface ValidationResult {
  rows: ValidatedRow[];
  /** True when the whole sheet was rejected by any one row. */
  rateSheetRejected: boolean;
  /** Countries dropped entirely. */
  rejectedCountries: string[];
  proceeding: ValidatedRow[];
  /** Everything not proceeding — dropped, undecided or awaiting approval. */
  withheld: ValidatedRow[];
  refusedBeforeWrite: true;
}

/**
 * Apply the outcomes across a whole batch, honouring the three blast radii.
 *
 * Radius matters here rather than per row: `REJECT_RATE_SHEET` on one destination withholds every
 * OTHER destination too, and `REJECT_COUNTRY` withholds that country's siblings. A per-row
 * evaluation cannot express either, which is why "reject the push" was too coarse.
 */
export function validateRateChanges(
  changes: RateChange[],
  thresholds: Thresholds,
  config: RuleConfig | null,
): ValidationResult {
  const assessments = changes.map(c => assessRateChange(c, thresholds, config));

  let rateSheetRejected = false;
  let rateSheetReason: string | null = null;
  const rejectedCountries = new Map<string, string>();
  const undecidedCountryWide: string[] = [];

  for (const a of assessments) {
    for (const f of a.findings) {
      if (f.undecidable) continue;             // an open question decides nothing
      if (f.outcome === 'REJECT_RATE_SHEET') {
        rateSheetRejected = true;
        rateSheetReason ??= `${f.detail} (${f.rule} → REJECT RATE-SHEET on ${a.destinationName})`;
      }
      if (f.outcome === 'REJECT_COUNTRY') {
        if (a.country) rejectedCountries.set(a.country, `${f.detail} (${f.rule} → REJECT COUNTRY)`);
        // Without a country the radius cannot be applied. Narrowing it to this destination would
        // let the rest of the country through on a rule that said to drop it.
        else undecidedCountryWide.push(a.key);
      }
    }
  }

  const rows: ValidatedRow[] = assessments.map(a => {
    if (rateSheetRejected) {
      return { assessment: a, disposition: 'dropped_rate_sheet', reason: rateSheetReason };
    }
    if (a.country && rejectedCountries.has(a.country)) {
      return { assessment: a, disposition: 'dropped_country', reason: rejectedCountries.get(a.country)! };
    }
    if (undecidedCountryWide.includes(a.key)) {
      return {
        assessment: a, disposition: 'undecided',
        reason: `A country-wide rejection fired for ${a.destinationName}, but no country is recorded for it, `
              + `so the rejection cannot be applied to the right set of destinations.`,
      };
    }

    const fired = a.findings;
    const undecided = fired.find(f => f.undecidable);
    if (undecided) {
      return { assessment: a, disposition: 'undecided', reason: `${undecided.detail} ${undecided.undecidedBecause ?? ''}`.trim() };
    }
    const approval = fired.find(f => f.outcome === 'APPROVAL_REQD');
    if (approval) {
      return { assessment: a, disposition: 'approval_required', reason: `${approval.detail} (${approval.rule} → APPROVAL REQD)` };
    }
    const dropped = fired.find(f => f.outcome === 'REJECT_DESTINATION');
    if (dropped) {
      return { assessment: a, disposition: 'dropped_destination', reason: `${dropped.detail} (${dropped.rule} → REJECT DESTINATION)` };
    }
    return { assessment: a, disposition: 'proceed', reason: null };
  });

  return {
    rows,
    rateSheetRejected,
    rejectedCountries: [...rejectedCountries.keys()],
    proceeding: rows.filter(r => r.disposition === 'proceed'),
    withheld: rows.filter(r => r.disposition !== 'proceed'),
    refusedBeforeWrite: true,
  };
}

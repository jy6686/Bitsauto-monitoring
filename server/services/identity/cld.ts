/**
 * Called-number (CLD) transformation verification — CAP-023 §9.
 *
 * The PASS surfaced three representations of the same called number:
 *
 *   requested   922132803137          what the operator asked for
 *   dialled     22211922132803137     tech prefix 22211 applied by us
 *   observed    1922132803137         what Sippy's CDR recorded
 *
 * The call completed and rated correctly as Pakistan/Karachi, so this is
 * operational. It is also not the transformation we would have predicted, and
 * "it worked" is not the same as "it did what we configured".
 *
 * The point of this module is to stop that being a judgement call. Each stage
 * is classified against what was configured, so an unexpected transformation
 * becomes a recorded WARNING with the difference spelled out rather than
 * something a person has to notice in a screenshot.
 *
 * Same contract as CLI verification: observation only. Whether a given
 * transformation is acceptable depends on the Sippy translation rules in force,
 * which live outside this platform — so nothing here returns PASS/FAIL on
 * intent, only on whether the observation matches the configured expectation.
 *
 * Pure functions, no I/O. CAP-021 L3.
 */

import { normalizeCli, type CliEvidenceLevel, type CliConfidence } from './cli.js';

export type CldObservation =
  /** Observed exactly what was requested — no transformation at this stage. */
  | 'UNCHANGED'
  /** The configured prefix was applied, and nothing else changed. */
  | 'PREFIX_APPLIED'
  /** An applied prefix was fully removed, leaving the requested number. */
  | 'PREFIX_STRIPPED'
  /** Part of the applied prefix survived — the case this platform hit. */
  | 'PREFIX_RESIDUAL'
  /** Digits unrelated to the configured prefix were prepended. */
  | 'DIGITS_PREPENDED'
  /** The requested number is no longer intact at the end of the value. */
  | 'TRUNCATED'
  /** The requested number is not present at all. */
  | 'REWRITTEN'
  /** Not observed. Never a score input. */
  | 'UNKNOWN';

export interface CldComparison {
  observation: CldObservation;
  /** Human name of the point that recorded this, e.g. 'Sippy ingress'. */
  stage: string;
  evidenceLevel: CliEvidenceLevel;
  confidence: CliConfidence;
  /** True when the observation matches what the configuration predicts. */
  asConfigured: boolean | null;
  requested: string;
  observed: string | null;
  /** The digits added or left in front of the requested number, if any. */
  residual: string | null;
  /**
   * Does the observed value still parse as a dialable number? A CDR CLD that
   * is not a valid number anywhere is a strong sign it is an intermediate,
   * pre-translation form rather than what was sent to the carrier.
   */
  observedIsDialableNumber: boolean | null;
  reason: string;
}

export interface CompareCldInput {
  /** What the operator asked to call, in the form they entered it. */
  requestedCld: string;
  /** What we actually dialled, prefix included. Omit if not known. */
  dialledCld?: string | null;
  /** What this stage recorded. null = not observed. */
  observedCld: string | null | undefined;
  /** The tech prefix we are configured to apply, e.g. '22211'. */
  configuredPrefix?: string | null;
  /**
   * Whether this stage is expected to still carry the prefix. Asterisk egress
   * should; Sippy after tech-prefix routing should not.
   */
  expectPrefix: boolean;
  /**
   * Where this was recorded, in words. Several stages share one evidence level
   * — Asterisk egress and Sippy ingress are both O2 — so the level alone
   * cannot name the point in the path.
   */
  stage: string;
  destinationCountry?: string | null;
  evidenceLevel: CliEvidenceLevel;
}

const digitsOf = (s: string | null | undefined): string => String(s ?? '').replace(/\D/g, '');

export function compareCld(input: CompareCldInput): CldComparison {
  const {
    requestedCld, dialledCld, observedCld, configuredPrefix,
    expectPrefix, stage, destinationCountry, evidenceLevel,
  } = input;

  const requested = digitsOf(requestedCld);
  const prefix    = digitsOf(configuredPrefix);

  const base = {
    stage,
    evidenceLevel,
    requested,
    observed: null,
    residual: null,
    observedIsDialableNumber: null,
    asConfigured: null,
  } as const;

  if (observedCld == null || digitsOf(observedCld) === '') {
    return {
      ...base,
      observation: 'UNKNOWN',
      confidence: 'insufficient',
      reason: `No called number was captured at ${stage}, so no transformation can be described.`,
    };
  }

  const observed = digitsOf(observedCld);

  // Is the observed value a number anyone could dial? Used as corroboration,
  // never as the verdict — an intermediate routing form failing this check is
  // expected, not a fault.
  const parsedObserved = normalizeCli({ cli: observed, destinationCountry });
  const observedIsDialableNumber =
    parsedObserved.e164 != null && parsedObserved.callbackDialable === true;

  const shared = { ...base, observed, observedIsDialableNumber };

  // ── The requested number survives at the tail ────────────────────────────
  if (observed.endsWith(requested)) {
    const residual = observed.slice(0, observed.length - requested.length);

    if (residual === '') {
      const asConfigured = !expectPrefix;
      return {
        ...shared,
        observation: prefix && dialledCld ? 'PREFIX_STRIPPED' : 'UNCHANGED',
        confidence: 'high',
        asConfigured,
        residual: null,
        reason: expectPrefix
          ? `Expected the ${prefix || 'configured'} prefix to still be present here, but the number arrived bare.`
          : prefix
            ? `The ${prefix} prefix was fully removed, leaving the requested number intact.`
            : 'Delivered unchanged.',
      };
    }

    if (prefix && residual === prefix) {
      const asConfigured = expectPrefix;
      return {
        ...shared,
        observation: 'PREFIX_APPLIED',
        confidence: 'high',
        asConfigured,
        residual,
        reason: expectPrefix
          ? `The configured ${prefix} prefix was applied and the requested number is intact behind it.`
          : `The ${prefix} prefix is still present at this stage — it was expected to have been removed by now.`,
      };
    }

    // Part of the prefix survived. This is the observed BitsAuto case:
    // dialled 22211…, Sippy recorded 1… — four of five digits stripped.
    if (prefix && prefix.endsWith(residual)) {
      const stripped = prefix.slice(0, prefix.length - residual.length);
      return {
        ...shared,
        observation: 'PREFIX_RESIDUAL',
        // The string relationship is certain; the mechanism producing it is
        // not, so this never claims 'high'.
        confidence: 'medium',
        asConfigured: false,
        residual,
        reason:
          `Only ${stripped.length} of the ${prefix.length} configured prefix digits were removed ` +
          `("${stripped}" stripped, "${residual}" left in front of the requested number). ` +
          `The call still completed, so the translation is operational — but it is not the ` +
          `full removal the configured ${prefix} prefix implies, and the Sippy translation ` +
          `rule should be confirmed rather than assumed.`,
      };
    }

    return {
      ...shared,
      observation: 'DIGITS_PREPENDED',
      confidence: 'medium',
      asConfigured: false,
      residual,
      reason:
        `"${residual}" was prepended to the requested number, and it does not correspond to the ` +
        `configured ${prefix || 'tech'} prefix.`,
    };
  }

  // ── The requested number does not survive at the tail ────────────────────
  if (requested.length > 4 && observed.includes(requested.slice(0, -1))) {
    return {
      ...shared,
      observation: 'TRUNCATED',
      confidence: 'medium',
      asConfigured: false,
      residual: null,
      reason: `The requested number appears but is not intact at the end — digits were lost from the tail.`,
    };
  }

  return {
    ...shared,
    observation: 'REWRITTEN',
    confidence: parsedObserved.confidence === 'insufficient' ? 'low' : 'medium',
    asConfigured: false,
    residual: null,
    reason: `The requested number ${requested} is not present in the recorded value ${observed}.`,
  };
}

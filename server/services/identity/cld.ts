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

/**
 * Where a configured expectation came from — TD-010.
 *
 * Observations have carried provenance from the start; the values they are
 * compared against did not. Recording one rigorously and the other casually
 * produces confident findings about the wrong thing, which is how the
 * PREFIX_PARTIAL result on the Golden Reference was reported as a probable
 * switch misconfiguration when the expected prefix had only ever been inferred
 * from a dialplan trace.
 */
export type ExpectationSource =
  | 'verified-from-switch'  // read from the switch configuration
  | 'operator-supplied'     // stated by someone who runs it
  | 'inferred'              // derived from an observation — a guess with a reason
  | 'unknown';              // no provenance recorded

export interface Expectation {
  value: string;
  source: ExpectationSource;
  /** ISO timestamp of when it was verified, for the two verified sources. */
  verifiedAt?: string;
}

/** A bare string carries no provenance, so it is treated as unknown. */
function asExpectation(v: string | Expectation | null | undefined): Expectation {
  if (v == null) return { value: '', source: 'unknown' };
  return typeof v === 'string' ? { value: v, source: 'unknown' } : v;
}

const TRUSTED: ExpectationSource[] = ['verified-from-switch', 'operator-supplied'];

/**
 * An unverified expectation may produce an observation. It may not produce an
 * anomaly — `asConfigured: false` is a claim about the configuration, and you
 * cannot claim a value does not match a configuration you never read.
 */
function verdictOnConfiguration(e: Expectation, matched: boolean): boolean | null {
  if (matched) return TRUSTED.includes(e.source) ? true : null;
  return TRUSTED.includes(e.source) ? false : null;
}

function expectationCaveat(e: Expectation): string {
  if (TRUSTED.includes(e.source)) return '';
  return e.source === 'inferred'
    ? ' The expected prefix here was inferred from an observation, never read from the switch, ' +
      'so this is recorded as a difference and not as a misconfiguration.'
    : ' The expected prefix here has no recorded provenance, so this is a difference, not a ' +
      'misconfiguration.';
}

export type CldObservation =
  /** Observed exactly what was requested — no transformation at this stage. */
  | 'UNCHANGED'
  /** The configured prefix was applied, and nothing else changed. */
  | 'PREFIX_APPLIED'
  /** An applied prefix was fully removed, leaving the requested number. */
  | 'PREFIX_STRIPPED'
  /**
   * The observed value carries digits in front of the requested number that
   * match the tail of the configured prefix.
   *
   * Named for the string relationship, not a mechanism. It was once
   * PREFIX_RESIDUAL, which asserted the digits were a leftover — one of at
   * least six readings (service selector, routing class, carrier
   * discriminator, national access digit, part of the destination, leftover).
   * The engine cannot distinguish them, so it must not name one.
   */
  | 'PREFIX_PARTIAL'
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
  /**
   * True when the observation matches what the configuration predicts.
   * **null when the expectation's provenance does not support a claim** — an
   * unverified expected value cannot establish a misconfiguration (TD-010).
   */
  asConfigured: boolean | null;
  /** Where the expected value came from, and how far it may be trusted. */
  expectation: Expectation;
  requested: string;
  observed: string | null;
  /** The digits added or left in front of the requested number, if any. */
  residual: string | null;
  /**
   * Digits OUR dial string carried between the configured prefix and the
   * requested number. Non-empty means we send more than the prefix — a finding
   * about our own configuration, not the switch's behaviour.
   */
  dialledExtra: string | null;
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
  /**
   * The tech prefix we are configured to apply. Pass an `Expectation` to record
   * where the value came from; a bare string is treated as provenance-unknown
   * and cannot produce an `asConfigured: false` verdict.
   */
  configuredPrefix?: string | Expectation | null;
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

  const requested   = digitsOf(requestedCld);
  const expectation = asExpectation(configuredPrefix as string | Expectation | null);
  const prefix      = digitsOf(expectation.value);

  const base = {
    stage,
    expectation,
    evidenceLevel,
    requested,
    observed: null,
    residual: null,
    dialledExtra: null,
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

  // ── What we actually dialled, when we know it ───────────────────────────
  // Without this the prefix is inferred from `observed` alone, which cannot
  // distinguish "the switch left a digit behind" from "we sent a digit the
  // prefix never covered". Those are findings about different systems.
  const dialled = digitsOf(dialledCld);
  const dialledExtra =
    dialled && prefix && dialled.startsWith(prefix) && dialled.endsWith(requested)
      ? dialled.slice(prefix.length, dialled.length - requested.length)
      : null;

  if (dialledExtra !== null) {
    const expected = expectPrefix ? dialled : dialledExtra + requested;
    const extraNote = dialledExtra
      ? ` Note that our own dial string carries "${dialledExtra}" between the configured ` +
        `${prefix} prefix and the destination — the switch did not add it, we did, and its ` +
        `purpose is not recorded anywhere in this platform.`
      : '';

    if (observed === expected) {
      return {
        ...shared,
        observation: expectPrefix ? 'PREFIX_APPLIED' : 'PREFIX_STRIPPED',
        confidence: 'high',
        asConfigured: verdictOnConfiguration(expectation, true),
        residual: dialledExtra || null,
        dialledExtra,
        reason:
          (expectPrefix
            ? `The configured ${prefix} prefix is present, as expected at this stage.`
            : `The configured ${prefix} prefix was removed exactly as the rule implies.`) +
          extraNote + expectationCaveat(expectation),
      };
    }

    return {
      ...shared,
      observation: 'DIGITS_PREPENDED',
      confidence: 'medium',
      asConfigured: verdictOnConfiguration(expectation, false),
      residual: observed.endsWith(requested)
        ? observed.slice(0, observed.length - requested.length)
        : null,
      dialledExtra,
      reason:
        `We dialled ${dialled}; ${expected} was expected here and ${observed} was recorded.` +
        extraNote + expectationCaveat(expectation),
    };
  }

  // ── The requested number survives at the tail ────────────────────────────
  if (observed.endsWith(requested)) {
    const residual = observed.slice(0, observed.length - requested.length);

    if (residual === '') {
      const asConfigured = verdictOnConfiguration(expectation, !expectPrefix);
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
      const asConfigured = verdictOnConfiguration(expectation, expectPrefix);
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

    // Digits in front of the requested number that match the tail of the
    // configured prefix. What they ARE is a separate question the engine
    // cannot answer — see the PREFIX_PARTIAL note above.
    if (prefix && prefix.endsWith(residual)) {
      const accounted = prefix.slice(0, prefix.length - residual.length);
      return {
        ...shared,
        observation: 'PREFIX_PARTIAL',
        // The string relationship is certain; the mechanism producing it is
        // not, so this never claims 'high'.
        confidence: 'medium',
        asConfigured: verdictOnConfiguration(expectation, false),
        residual,
        reason:
          `The recorded value is "${residual}" followed by the requested number. ` +
          `"${accounted}" of the configured ${prefix} prefix is accounted for; the purpose of ` +
          `"${residual}" is unknown — it may be a service selector, a routing class, a carrier ` +
          `discriminator, an access digit, or an unremoved part of the prefix. The call ` +
          `completed, so the translation is operational. Establishing which reading is correct ` +
          `requires the switch configuration, not more capture.` +
          expectationCaveat(expectation),
      };
    }

    return {
      ...shared,
      observation: 'DIGITS_PREPENDED',
      confidence: 'medium',
      asConfigured: verdictOnConfiguration(expectation, false),
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
      asConfigured: verdictOnConfiguration(expectation, false),
      residual: null,
      reason: `The requested number appears but is not intact at the end — digits were lost from the tail.`,
    };
  }

  return {
    ...shared,
    observation: 'REWRITTEN',
    confidence: parsedObserved.confidence === 'insufficient' ? 'low' : 'medium',
    asConfigured: verdictOnConfiguration(expectation, false),
    residual: null,
    reason: `The requested number ${requested} is not present in the recorded value ${observed}.`,
  };
}

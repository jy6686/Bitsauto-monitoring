/**
 * Destination-aware CLI normalization — CAP-023 §7, Phase 1 Step 2.
 *
 * The naive form of this is `strip('+') && compare`. That produces false
 * PASSes, because a national-format number has no meaning until you say whose
 * dial plan to read it under:
 *
 *   03224861153 delivered to Pakistan  → the subscriber can return the call
 *   03224861153 delivered to the UK    → undialable there; the CLI is broken
 *
 * Both normalise to the same E.164. String comparison scores them identically.
 * So the destination country is an input, not an inference, and the real test
 * is whether the presented form is dialable *from where it was delivered*.
 *
 * Interpretation runs under the DESTINATION's plan throughout, because that is
 * the plan the receiving handset will dial back under.
 *
 * Uses libphonenumber-js, already a dependency — the dial plans are Google's
 * metadata, not a table we maintain.
 *
 * Pure functions, no I/O. Layer 3 in the CAP-021 model: recomputable derived
 * analysis. Re-running this over stored evidence must never mutate it.
 */

import { parsePhoneNumberFromString, getCountryCallingCode, type PhoneNumber } from 'libphonenumber-js';

/** How the value was presented on the wire, before any interpretation. */
export type CliPresentation =
  | 'international'   // carried its own country code (+, or 00, or full E.164)
  | 'national'        // national/trunk format — meaningless without a plan
  | 'anonymous'       // positively withheld: Anonymous, Private, Restricted…
  | 'short'           // too short to be a subscriber number (service/short code)
  | 'alphanumeric'    // alpha sender id — never dialable
  | 'absent'          // no value at all
  | 'unparseable';    // present, but not a number under any reading

/**
 * Deliberately an enum, not a percentage.
 *
 * A "98%" would be a number with no computation behind it, and CAP-023 exists
 * precisely so that a claim never outruns its evidence. These four levels each
 * correspond to a stated, checkable condition — see `reason` on every result.
 */
export type CliConfidence =
  | 'high'          // parsed and valid under a known plan
  | 'medium'        // parsed, plausible length/range, not confirmed valid
  | 'low'           // interpreted under an assumed plan, or ambiguous
  | 'insufficient'; // nothing can be concluded

export interface CliNormalization {
  /** Exactly what was handed in, untouched. */
  input: string;
  /** E.164 without '+', or null when it could not be resolved. */
  e164: string | null;
  presentation: CliPresentation;
  /** ISO-3166-2 country the number belongs to, when determinable. */
  country: string | null;
  /** MOBILE / FIXED_LINE / … when libphonenumber can tell. */
  numberType: string | null;
  /** The plan used to interpret the value. null = none supplied. */
  destinationCountry: string | null;
  /**
   * Can a subscriber in `destinationCountry` return this call as presented?
   * null means undetermined — never treat null as false.
   */
  callbackDialable: boolean | null;
  confidence: CliConfidence;
  /** Why this result, in one sentence. Always populated. */
  reason: string;
}

/**
 * Values carriers use to signal a withheld CLI. Matched case-insensitively
 * against the whole trimmed value — never as a substring, or a legitimate
 * alpha sender id containing "private" would be misread as suppression.
 */
const ANONYMITY_TOKENS = new Set([
  'anonymous', 'private', 'restricted', 'unavailable', 'unknown',
  'withheld', 'blocked', 'not available', 'no caller id', 'unassigned',
]);

const ISO2 = /^[A-Z]{2}$/;

function normaliseCountry(c: string | null | undefined): string | null {
  if (!c) return null;
  const up = c.trim().toUpperCase();
  return ISO2.test(up) ? up : null;
}

function digitsOnly(s: string): string {
  return s.replace(/\D/g, '');
}

export interface NormalizeCliInput {
  cli: string | null | undefined;
  /** ISO-3166-2 of where the call was delivered. Omit only if truly unknown. */
  destinationCountry?: string | null;
}

export function normalizeCli({ cli, destinationCountry }: NormalizeCliInput): CliNormalization {
  const dest = normaliseCountry(destinationCountry);
  const raw  = (cli ?? '').trim();

  const base = {
    input: raw,
    e164: null,
    country: null,
    numberType: null,
    destinationCountry: dest,
    callbackDialable: null,
  } as const;

  // ── Nothing to read ──────────────────────────────────────────────────────
  if (raw === '') {
    return {
      ...base,
      presentation: 'absent',
      confidence: 'insufficient',
      reason: 'No CLI value was present.',
    };
  }

  // ── Positively withheld ──────────────────────────────────────────────────
  if (ANONYMITY_TOKENS.has(raw.toLowerCase())) {
    return {
      ...base,
      presentation: 'anonymous',
      callbackDialable: false,
      confidence: 'high',
      reason: `Caller identity was positively withheld ("${raw}").`,
    };
  }

  // ── Alpha sender id ──────────────────────────────────────────────────────
  if (/[A-Za-z]/.test(raw)) {
    return {
      ...base,
      presentation: 'alphanumeric',
      callbackDialable: false,
      confidence: 'high',
      reason: 'Alphanumeric sender id — carries identity but cannot be dialled back.',
    };
  }

  const digits = digitsOnly(raw);
  if (digits === '') {
    return {
      ...base,
      presentation: 'unparseable',
      confidence: 'insufficient',
      reason: 'Value contains no digits and is not a recognised anonymity token.',
    };
  }

  // ── Does it carry its own country code? ──────────────────────────────────
  // '+' is explicit. '00' is the international access prefix in most of the
  // world, so treat it as international intent and hand libphonenumber the '+'
  // form it expects.
  const explicitIntl = raw.startsWith('+');
  const zeroZeroIntl = !explicitIntl && raw.startsWith('00') && digits.length > 5;
  const intlCandidate = explicitIntl ? raw : zeroZeroIntl ? `+${digits.slice(2)}` : null;

  if (intlCandidate) {
    const parsed = parsePhoneNumberFromString(intlCandidate);
    if (parsed) return fromParsed(raw, parsed, dest, 'international');
    return {
      ...base,
      presentation: 'international',
      confidence: 'low',
      reason: 'Presented in international format but does not resolve to any country code.',
    };
  }

  // ── Bare digits: too short to carry a country code ───────────────────────
  if (digits.length <= 6) {
    return {
      ...base,
      e164: digits,
      presentation: 'short',
      callbackDialable: false,
      confidence: 'high',
      reason: 'Too short to be a subscriber number — service or short code.',
    };
  }

  // ── Bare digits are ambiguous ────────────────────────────────────────────
  // '923224861153' can be E.164 with the '+' dropped (how CLI usually arrives
  // on SIP) or a national number. Resolve by trying the international reading
  // FIRST and accepting it only when it is genuinely valid.
  //
  // Getting this order wrong is not cosmetic: read as national under a GB
  // destination, '923224861153' becomes '+44923224861153' — a number that does
  // not exist — and every comparison against it is then meaningless.
  const asIntl = parsePhoneNumberFromString(`+${digits}`);
  if (asIntl?.isValid()) return fromParsed(raw, asIntl, dest, 'international');

  // Not a valid international number, so it must be read under a national
  // plan — and that requires knowing whose.
  if (!dest) {
    // The honest stopping point. '03224861153' is Pakistan mobile only if you
    // already assume Pakistan; the same digits mean different things elsewhere.
    // A guess here is what manufactures a false PASS downstream.
    return {
      ...base,
      presentation: 'national',
      confidence: 'insufficient',
      reason:
        'Presented in national format with no destination country supplied — ' +
        'a national number cannot be resolved without knowing whose dial plan applies.',
    };
  }

  // Read the presented digits under the DESTINATION's plan: that is the plan
  // the receiving handset dials back under.
  const parsedNational = parsePhoneNumberFromString(raw, dest as any);
  if (parsedNational) return fromParsed(raw, parsedNational, dest, 'national');

  // Unreadable under the destination's plan. It may be perfectly valid
  // somewhere else — which is exactly the defect: it is not dialable *here*.
  return {
    ...base,
    presentation: 'unparseable',
    callbackDialable: false,
    confidence: 'medium',
    reason: `Not readable as a number under the ${dest} dial plan, so a ${dest} subscriber cannot return the call.`,
  };
}

/**
 * Is the parsed number inside the destination's numbering plan?
 *
 * By calling code rather than ISO country: several countries share a plan
 * (+44 → GB/GG/JE/IM, +1 → all NANP, +7 → RU/KZ) and numbers within a shared
 * plan are mutually dialable in national format.
 */
function sharesNumberingPlan(parsed: PhoneNumber, dest: string | null): boolean {
  if (!dest) return false;
  try {
    return parsed.countryCallingCode === getCountryCallingCode(dest as any);
  } catch {
    return parsed.country === dest; // unknown region — fall back to exact match
  }
}

function fromParsed(
  input: string,
  parsed: PhoneNumber,
  dest: string | null,
  presentation: 'international' | 'national',
): CliNormalization {
  const country = normaliseCountry(parsed.country ?? null);
  const valid   = parsed.isValid();
  const possible = parsed.isPossible();
  const e164    = parsed.number.replace(/^\+/, '');
  const type    = (parsed.getType?.() as string | undefined) ?? null;

  // Short codes are a distinct presentation, not a malformed subscriber number.
  if (!valid && e164.length <= 6) {
    return {
      input, e164, presentation: 'short', country, numberType: type,
      destinationCountry: dest, callbackDialable: false, confidence: 'medium',
      reason: 'Too short to be a subscriber number — service or short code.',
    };
  }

  // ── Callback dialability ────────────────────────────────────────────────
  let callbackDialable: boolean | null;
  let confidence: CliConfidence;
  let reason: string;

  if (!dest) {
    // We know what the number is, but not where it landed, so we cannot say
    // whether the recipient could dial it.
    callbackDialable = null;
    confidence = valid ? 'medium' : 'low';
    reason = valid
      ? `Valid ${country ?? 'international'} number; no destination supplied, so callback dialability is undetermined.`
      : 'Parsed but not confirmed valid, and no destination supplied.';
  } else if (presentation === 'international') {
    // Full international form is dialable from anywhere, provided it is real.
    callbackDialable = valid;
    confidence = valid ? 'high' : possible ? 'medium' : 'low';
    reason = valid
      ? `Valid ${country ?? 'international'} number in international format — dialable from ${dest}.`
      : `International format but not a valid number${country ? ` under the ${country} plan` : ''}.`;
  } else if (sharesNumberingPlan(parsed, dest)) {
    // National format, and the number sits in the destination's numbering plan:
    // this is correct localization — the recipient can dial it as presented.
    //
    // Compared by CALLING CODE, not ISO country. +44 covers GB/GG/JE/IM and +1
    // covers all of NANP; a UK mobile in a Guernsey range is dialable from
    // London, and comparing ISO codes would have called it a rewrite on two of
    // the busiest destinations we carry.
    callbackDialable = valid;
    confidence = valid ? 'high' : possible ? 'medium' : 'low';
    reason = valid
      ? `National format for ${dest} and valid there — correctly localized, dialable as presented.`
      : `National format for ${dest} but not a valid ${dest} number.`;
  } else {
    // National format read under the destination's plan resolved to a
    // DIFFERENT country. The digits are not dialable where they were
    // delivered — this is the UK-receives-0322 case.
    callbackDialable = false;
    confidence = valid ? 'medium' : 'low';
    reason =
      `Presented in national format but resolves to ${country ?? 'another country'} under the ` +
      `${dest} dial plan — a ${dest} subscriber cannot return this call as presented.`;
  }

  return {
    input, e164, presentation, country, numberType: type,
    destinationCountry: dest, callbackDialable, confidence, reason,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Comparison — CAP-023 §8 taxonomy
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Observation only. Whether an outcome is acceptable is an L4 rule-pack
 * decision keyed to destination × vendor contract — REWRITTEN and SUPPRESSED
 * are legitimate on routes subject to regulatory CLI substitution or
 * attestation regimes, so nothing here returns PASS or FAIL.
 */
export type CliObservation =
  | 'EXACT'        // same identity, international form
  | 'LOCALIZED'    // same identity, destination's national form, dialable there
  | 'REWRITTEN'    // a different, well-formed number was presented
  | 'SUPPRESSED'   // positive evidence of withheld identity
  | 'MALFORMED'    // presented value is not usable under the destination's plan
  | 'UNKNOWN';     // no observation exists — never a score input

/**
 * Where the observed value was captured. CAP-023 §4.
 *
 * Carried on every verdict so that analytics, dashboards and the copilot
 * cannot accidentally read an origination-side observation as if it described
 * what the subscriber saw.
 */
export type CliEvidenceLevel =
  | 'O1'  // requested only — nothing was observed
  | 'O2'  // what left our network (INVITE / switch record)
  | 'O3'  // what arrived at a terminating SIP endpoint we control
  | 'O4'; // what the handset displayed

export interface CliComparison {
  observation: CliObservation;
  evidenceLevel: CliEvidenceLevel;
  confidence: CliConfidence;
  requested: CliNormalization;
  observed: CliNormalization | null;
  reason: string;
}

export interface CompareCliInput {
  requestedCli: string | null | undefined;
  /** null/undefined = not observed. Distinct from an observed empty value. */
  observedCli: string | null | undefined;
  destinationCountry?: string | null;
  evidenceLevel: CliEvidenceLevel;
}

export function compareCli(input: CompareCliInput): CliComparison {
  const { requestedCli, observedCli, destinationCountry, evidenceLevel } = input;
  const requested = normalizeCli({ cli: requestedCli, destinationCountry });

  // Not observed at all. This is the single most important branch: an absent
  // observation is UNKNOWN, never SUPPRESSED. Collapsing the two manufactures
  // carrier accusations out of missing data.
  if (observedCli == null) {
    return {
      observation: 'UNKNOWN',
      evidenceLevel,
      confidence: 'insufficient',
      requested,
      observed: null,
      reason:
        evidenceLevel === 'O1'
          ? 'Only the requested CLI is known — no observation was made at any point in the path.'
          : `No CLI was captured at ${evidenceLevel}, so nothing can be concluded about what was presented.`,
    };
  }

  const observed = normalizeCli({ cli: observedCli, destinationCountry });

  if (observed.presentation === 'anonymous' || observed.presentation === 'absent') {
    // Positive evidence: the call arrived, and it arrived with no identity.
    return {
      observation: 'SUPPRESSED',
      evidenceLevel,
      confidence: observed.presentation === 'anonymous' ? 'high' : 'medium',
      requested, observed,
      reason: observed.reason,
    };
  }

  const sameIdentity =
    requested.e164 != null && observed.e164 != null && requested.e164 === observed.e164;

  if (sameIdentity) {
    if (observed.presentation === 'international') {
      return {
        observation: 'EXACT', evidenceLevel, confidence: observed.confidence,
        requested, observed,
        reason: 'Delivered unchanged in international format.',
      };
    }
    if (observed.callbackDialable === true) {
      return {
        observation: 'LOCALIZED', evidenceLevel, confidence: observed.confidence,
        requested, observed,
        reason: observed.reason,
      };
    }
    // Same number, presented in a form the recipient cannot dial. The identity
    // survived and the usability did not — that is a defect, not a match.
    return {
      observation: 'MALFORMED', evidenceLevel, confidence: observed.confidence,
      requested, observed,
      reason: `Identity preserved but the presented form is not dialable from ${observed.destinationCountry ?? 'the destination'}. ${observed.reason}`,
    };
  }

  // A different number that the recipient cannot dial is MALFORMED, not
  // REWRITTEN. REWRITTEN means a *usable* substitute was presented — which is
  // legitimate on some routes — whereas an undialable value is a defect
  // regardless of what it was substituted for. Keeping them apart matters:
  // they carry different commercial consequences.
  if (
    observed.e164 == null ||
    observed.presentation === 'unparseable' ||
    observed.callbackDialable === false
  ) {
    return {
      observation: 'MALFORMED', evidenceLevel,
      confidence: observed.confidence, requested, observed,
      reason: observed.reason,
    };
  }

  // A different, well-formed number. Legitimate on some routes — the verdict
  // on whether it breaches the agreement is not made here.
  return {
    observation: 'REWRITTEN', evidenceLevel,
    // Cannot claim high confidence in a rewrite when we could not resolve what
    // was asked for in the first place.
    confidence: requested.e164 == null ? 'low' : observed.confidence,
    requested, observed,
    reason:
      `Presented ${observed.e164} instead of ${requested.e164 ?? 'the requested CLI'}` +
      `${observed.country ? ` (a ${observed.country} number)` : ''}.`,
  };
}

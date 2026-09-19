/**
 * readback-outcome.ts
 *
 * What a verification read established, and what an upload may conclude from it.
 *
 * THE DEFECT THIS REPLACES. `verifySippyRate` used to answer `confirmed: false` for two opposite
 * situations — "the tariff was read and does not hold the rate" and "the tariff could not be read
 * at all". After a successful upload the caller turned either into `verificationResult:
 * 'mismatch'`, which `verdict.ts` maps to `failure`: the one verdict the batch engine may retry,
 * reported to the operator as "rate unchanged". So while Sippy reads were taking 70+ seconds and
 * resetting (2026-09-19), a push that HAD landed would have been recorded as failed, and the
 * message invited a second write. An unreadable tariff could also send the single-rate path on to
 * the XML-RPC guesses and the portal fallback — a second mutation caused by a read that never
 * happened.
 *
 * Two rules fix it, and both live here so they can be proven without a switch:
 *
 *   ABSENCE IS A CLAIM ABOUT THE TARIFF, and only a read that SUCCEEDED may make it. Everything
 *   else is `unavailable` — not evidence, and never a failure.
 *
 *   THE FALLBACK IS PERMISSION, NOT AN ELSE. `uploadVerdict` says whether another write path may
 *   be tried at all. After `unavailable` it never may: the file is already on the switch and may
 *   still be processing.
 *
 * A read is idempotent, so retrying it is always safe — unlike anything on the write side. That
 * asymmetry is the whole reason the retry policy below applies to `unavailable` alone.
 */
import { selectVerificationRow } from '../../sippy';

/**
 * The timeout for a VERIFICATION read, distinct from the 20 s default the rest of the Sippy
 * client uses.
 *
 * Secondary to the classification above, and deliberately modest. Healthy tariff reads are 1–3 s;
 * the degraded ones seen on 2026-09-19 were 70 s+ or reset outright, so a longer window converts
 * some `unavailable` results into slow successes and nothing more. It is NOT an explanation of
 * that 72–76 s behaviour: `sippyPost`'s value is a socket INACTIVITY timeout rather than a
 * deadline, and a 76 s successful read is not consistent with it being the binding limit. Why
 * that is so belongs to the Sippy incident investigation, not to this constant.
 */
export const READBACK_TIMEOUT_MS = 45_000;

/** Attempts at the READ (never at the write). Three is enough to ride out a single reset. */
export const READBACK_MAX_ATTEMPTS = 3;

export type ReadbackOutcome =
  /** The tariff was read and holds what was written. */
  | 'confirmed'
  /** The tariff was read and does NOT hold it. A claim about the tariff — evidence. */
  | 'absent'
  /** The tariff could not be read. NOT a claim about the tariff. */
  | 'unavailable';

/** Why a rate list could not be produced. Kept distinct so a reset is not read as "no such rate". */
export type RateListFailureKind =
  | 'transport'    // connection reset, refused, DNS, socket hang-up
  | 'timeout'      // the read exceeded its window
  | 'fault'        // Sippy answered with an XML-RPC fault
  | 'unsupported'  // no rate-list method on this build answered
  | 'unknown';

export interface RateListRead {
  ok: boolean;
  rates?: Array<{ prefix: string; rate: number; effectiveFrom?: string }>;
  failure?: { kind: RateListFailureKind; message: string };
}

/** What a thrown transport error was. Pure, so the mapping itself is testable. */
export function rateListFailureKind(message: string): RateListFailureKind {
  if (/timed out|ETIMEDOUT/i.test(message)) return 'timeout';
  if (/ECONNRESET|ECONNREFUSED|EPIPE|socket hang up|ENOTFOUND|EAI_AGAIN/i.test(message)) return 'transport';
  return 'unknown';
}

/**
 * A fault that says the method does not exist is `unsupported` — the legacy names in the rate-list
 * ladder always fault on a modern build, and reporting that as the reason would hide a real fault.
 */
export function faultFailureKind(faultString: string): RateListFailureKind {
  return /unknown method|not supported|no such method/i.test(faultString) ? 'unsupported' : 'fault';
}

export interface VerificationWant {
  tariffId: string | number;
  prefix: string;
  rate: number;
  /** "YYYY-MM-DD HH:MM:SS" — selects the scheduled row rather than the live one (SMP-006). */
  effectiveFrom?: string;
}

export interface VerificationReading {
  outcome: ReadbackOutcome;
  message: string;
  foundRate?: number;
}

const RATE_TOLERANCE = 0.000001;

/** What one read of the tariff established. */
export function classifyVerificationRead(read: RateListRead, want: VerificationWant): VerificationReading {
  if (!read?.ok || !Array.isArray(read.rates)) {
    const f = read?.failure;
    const kind = f?.kind ?? 'unknown';
    const detail = f?.message ?? 'the read returned no rate list';
    return { outcome: 'unavailable', message: `tariff ${want.tariffId} could not be read [${kind}]: ${detail}` };
  }

  const size = `tariff holds ${read.rates.length} rate(s)`;
  const { row, reason } = selectVerificationRow(read.rates, want.prefix, want.effectiveFrom);
  if (!row) {
    return { outcome: 'absent', message: `prefix ${want.prefix} not found in tariff ${want.tariffId} (${size})` };
  }
  const when = row.effectiveFrom ? ` activation=${row.effectiveFrom}` : '';
  if (Math.abs(row.rate - want.rate) < RATE_TOLERANCE) {
    return { outcome: 'confirmed', foundRate: row.rate, message: `tariff ${want.tariffId} prefix ${want.prefix} rate=${row.rate}${when} (${reason}; ${size})` };
  }
  return {
    outcome: 'absent', foundRate: row.rate,
    message: `tariff ${want.tariffId} prefix ${want.prefix} holds ${row.rate}${when} where ${want.rate} was requested (${reason}; ${size})`,
  };
}

/** The wire value the verdict layer already understands. `skip` + a crossed boundary = indeterminate. */
export function verificationResultFor(outcome: ReadbackOutcome): 'confirmed' | 'mismatch' | 'skip' {
  if (outcome === 'confirmed') return 'confirmed';
  if (outcome === 'absent')    return 'mismatch';
  return 'skip';
}

/** Retry the READ, and only while it has established nothing. A settled read is an answer. */
export function shouldRetryRead(outcome: ReadbackOutcome, attempt: number): boolean {
  return outcome === 'unavailable' && attempt < READBACK_MAX_ATTEMPTS;
}

/** How long to wait before the attempt after this one. Zero once there are no more. */
export function readRetryDelayMs(attempt: number): number {
  if (attempt >= READBACK_MAX_ATTEMPTS) return 0;
  return attempt === 1 ? 1_000 : 3_000;
}

export interface UploadVerdictInput {
  /** Sippy's own word for the import: DONE, FAIL, FILE_UPLOADED, or anything it sends. */
  uploadStatus: string;
  outcome: ReadbackOutcome;
  /** The reading's message, carried into the operator-facing sentence. */
  readMessage: string;
  want: VerificationWant;
  /** The importer's report, when Sippy named one. */
  reportUrl?: string | null;
}

export interface UploadVerdict {
  success: boolean;
  verificationResult: 'confirmed' | 'mismatch' | 'skip';
  /**
   * Whether ANOTHER write path (the XML-RPC guesses, the portal form) may be attempted.
   *
   * False after `unavailable`, always: the workbook is on the switch and may still be processing,
   * so a second write could double-apply what the first one is about to land.
   */
  fallbackAllowed: boolean;
  message: string;
}

export function uploadVerdict(input: UploadVerdictInput): UploadVerdict {
  const { uploadStatus, outcome, readMessage, want } = input;
  const report = input.reportUrl ? ` Report: ${input.reportUrl}.` : '';
  const what = `${want.prefix} @ ${want.rate}`;

  if (outcome === 'unavailable') {
    // Says what is true — the file was sent and the tariff could not be read — and nothing more.
    return {
      success: false, verificationResult: 'skip', fallbackAllowed: false,
      message: `Upload status ${uploadStatus}: the workbook was sent, but tariff ${want.tariffId} could not be read back (${readMessage}), so whether ${what} is live is UNKNOWN. Read the tariff before writing to it again; nothing further was attempted.${report}`,
    };
  }

  if (outcome === 'confirmed') {
    return {
      success: true, verificationResult: 'confirmed', fallbackAllowed: false,
      message: uploadStatus === 'FAIL'
        ? `Sippy reported FAIL but the tariff holds the requested rate (${readMessage}).${report}`
        : `Rate ${what} verified on tariff ${want.tariffId} — upload status ${uploadStatus} (${readMessage}).${report}`,
    };
  }

  // Absent: the tariff WAS read and does not hold it. The established case, unchanged in meaning.
  if (uploadStatus === 'FAIL') {
    return {
      success: false, verificationResult: 'mismatch', fallbackAllowed: false,
      message: `Sippy's importer refused the upload (FAIL) and the tariff was read back without ${what} — nothing was applied (${readMessage}).${report}`,
    };
  }
  if (uploadStatus === 'DONE') {
    return {
      success: false, verificationResult: 'mismatch', fallbackAllowed: false,
      message: `Upload status DONE, but the tariff does not hold ${what} (${readMessage}) — nothing was applied; check tariff permissions or prefix mapping.${report}`,
    };
  }
  // An unsettled status (FILE_UPLOADED and friends) with a read that saw the tariff: the existing
  // behaviour is to try another method, and this build deliberately preserves it. RESIDUAL RISK,
  // documented rather than silently widened: the import may still be queued, so a fallback write
  // can double-apply when it completes. Narrowing this is its own decision.
  return {
    success: false, verificationResult: 'mismatch', fallbackAllowed: true,
    message: `Upload status ${uploadStatus}, and the tariff does not hold ${what} (${readMessage}).${report}`,
  };
}

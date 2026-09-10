/**
 * verdict.ts
 *
 * Maps what the Sippy push primitive returns onto the engine's three verdicts.
 *
 * This is deliberately a separate, tested module rather than a few conditionals at the call site,
 * because the mapping is where a batch decides whether it is safe to keep writing to a tariff. Get
 * it wrong in the permissive direction and the engine retries a mutation it cannot see; get it
 * wrong in the strict direction and every ordinary rejection halts a customer's whole rate card.
 *
 * THE RULE. The tariff read-back decides, exactly as it does for a single push:
 *
 *   confirmed  the tariff was read and holds what we wrote          -> success
 *   mismatch   the tariff was read and does NOT hold it             -> failure
 *   skip       no read-back happened                                -> see below
 *
 * A KNOWN GAP IN THE PRIMITIVE, STATED RATHER THAN PAPERED OVER.
 *
 * `verificationResult: 'skip'` is currently returned for two opposite situations:
 *
 *   (a) the push refused BEFORE mutating anything — for example the add path declining to guess an
 *       i_rate, which is the safety check that stopped jobs #44 and #45. Nothing was written, so
 *       this is a plain `failure`; halting the tariff over it would be wrong.
 *   (b) the push submitted a request and could not then establish the outcome. This is
 *       `indeterminate`: the write may have landed, and on Sippy's GET-based form it may have
 *       landed on a DIFFERENT rate.
 *
 * The return shape cannot tell those apart, so this module takes an explicit `refusedBeforeWrite`
 * signal and defaults to `indeterminate` when it is absent. Defaulting the other way would let an
 * unverified mutation be retried, which is the one outcome the September incidents rule out. The
 * lasting fix is for the primitive to report whether it reached the mutating request at all;
 * until it does, callers that KNOW a refusal happened before any request must say so.
 */
import type { OperationOutcome } from "./batch-execute";

/** The subset of the push primitive's result this mapping depends on. */
export interface PushPrimitiveResult {
  success: boolean;
  message: string;
  method?: string;
  iRate?: number;
  /** 'confirmed' | 'mismatch' | 'skip' — anything else is treated as no read-back. */
  verificationResult?: string;
  /**
   * True when the push declined before issuing any mutating request, so the tariff is
   * provably untouched. Absent means "not established" and is treated as such.
   */
  refusedBeforeWrite?: boolean;
  /** The push's own account of what it did. Carried through untouched. */
  trace?: string[];
}

export function verdictFromPush(result: PushPrimitiveResult): OperationOutcome {
  const carried = { method: result.method, iRate: result.iRate, trace: result.trace };

  if (result.verificationResult === 'confirmed' && result.success) {
    return { verdict: 'success', message: result.message, ...carried };
  }

  // The read-back ran and positively showed the rate is not there as intended. Nothing was
  // applied, so this is safe to report as a failure and safe to attempt again.
  if (result.verificationResult === 'mismatch') {
    return { verdict: 'failure', message: result.message, ...carried };
  }

  // 'confirmed' alongside success:false is a contradiction in the primitive. Trust neither.
  if (result.verificationResult === 'confirmed' && !result.success) {
    return {
      verdict: 'indeterminate',
      message: `${result.message} (the push reported failure while its read-back reported the rate confirmed — the two disagree, so the outcome is not established)`,
      ...carried,
    };
  }

  // No read-back. The only thing that makes this safe is knowing no request was ever sent.
  if (result.refusedBeforeWrite === true) {
    return {
      verdict: 'failure',
      message: `${result.message} (declined before any request was sent, so the tariff is unchanged)`,
      ...carried,
    };
  }

  return {
    verdict: 'indeterminate',
    message: `${result.message} (no read-back established the outcome; this path can mutate before it can report, so the tariff must be read before anything further is written to it)`,
    ...carried,
  };
}

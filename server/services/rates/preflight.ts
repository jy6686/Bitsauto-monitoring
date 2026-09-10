/**
 * preflight.ts
 *
 * Decides, before any Sippy call, whether an operation may be attempted at all.
 *
 * WHY THIS IS A SEPARATE STEP RATHER THAN A CHECK INSIDE THE PUSH.
 *
 * `pushRateToSippy` reports whether it crossed the mutation boundary, and the executor uses that
 * to decide whether an outcome is safe to treat as a proven non-event. But the XML-RPC rate-write
 * probes sit near the top of the push and cross the boundary before the portal path's own guards
 * are reached. Anything refused after that point therefore reports `refusedBeforeWrite: false` and
 * is treated as unestablished, which halts the tariff — the right response to a possible mutation
 * and much too strong for a check that could have been made without contacting Sippy at all.
 *
 * So every deterministic, read-only prerequisite is evaluated here, ahead of the primitive. A
 * refusal from this module is `refusedBeforeWrite: true` by construction: no request has been
 * built, let alone sent.
 *
 * WHAT IS AND IS NOT IN SCOPE.
 *
 * Only checks that are pure and complete on data the caller already holds. Each reuses the guard
 * that already owns it — `checkTariffIntegrity` for the tariff, `parseBillingIncrement` for the
 * increment — rather than restating the rule and letting the two drift apart.
 *
 * Anything that needs a network read to decide (whether the portal session has rates permission,
 * what i_rate the add form offers) stays inside the push. Those are not deterministic from here,
 * and guessing them is what this codebase has repeatedly paid for.
 *
 * The semantics match what the push-batch route already enforces, deliberately. The route refuses
 * the WHOLE request when any account fails these checks; this module returns a decision per
 * operation, which is what a batch needs so one bad account cannot cancel five hundred good ones.
 */
import { checkTariffIntegrity } from './tariff-integrity';
import { parseBillingIncrement } from './billing-increment';

export type PreflightCode =
  | 'unresolved_tariff'
  | 'no_stored_tariff'
  | 'tariff_mismatch'
  | 'increment_unreadable'
  | 'invalid_rate'
  | 'invalid_prefix'
  /**
   * The product is not declared eligible for this destination.
   *
   * Pricing and pushing are not commercial decisions; declaring what a product sells is. Without
   * this the push path is a complete bypass of eligibility — an operator picks any destination in
   * the catalogue and it goes to the switch, whatever anybody declared.
   */
  | 'not_eligible';

export interface PreflightOperation {
  operationKey: string;
  accountName: string;
  /** `company.sippyITariff` — what provisioning built for this customer. */
  storedITariff: number | string | null | undefined;
  /** What the caller resolved from Sippy (account -> billing plan -> tariff). */
  resolvedITariff: number | string | null | undefined;
  /** trunk prefix + dial prefix, exactly as it will be written. */
  fullPrefix: string;
  rate: number;
  /**
   * Raw `billing_increment` from the active catalogue, e.g. "60/1".
   * `null`/`undefined` means the prefix is not in the catalogue, which is NOT a refusal — the push
   * keeps the tariff's existing increment, defaulting to 1/1. Only an unreadable VALUE is refused.
   */
  rawIncrement?: string | null;
  /**
   * Whether the product is declared eligible for this destination.
   *
   * OPTIONAL, and undefined is meaningful: it means the caller did not establish eligibility, and
   * preflight then leaves the question alone rather than refusing on an answer nobody gave. Only
   * an explicit `false` is a refusal. Callers with no product context keep their behaviour.
   */
  eligible?: boolean;
}

export interface PreflightPass {
  ok: true;
  operationKey: string;
  iTariff: number;
  /** Undefined when the prefix is not in the catalogue; the push then leaves the increment alone. */
  interval1?: number;
  intervalN?: number;
}

export interface PreflightRefusal {
  ok: false;
  operationKey: string;
  code: PreflightCode;
  message: string;
  /** Always true. Nothing here builds or sends a request, so the tariff is provably untouched. */
  refusedBeforeWrite: true;
}

export type PreflightDecision = PreflightPass | PreflightRefusal;

const refuse = (operationKey: string, code: PreflightCode, message: string): PreflightRefusal =>
  ({ ok: false, operationKey, code, message, refusedBeforeWrite: true });

const TARIFF_CODE: Record<string, PreflightCode> = {
  unresolved:       'unresolved_tariff',
  no_stored_tariff: 'no_stored_tariff',
  mismatch:         'tariff_mismatch',
};

export function preflightOperation(op: PreflightOperation): PreflightDecision {
  // ── Is this product even sold here? ─────────────────────────────────────────
  // FIRST, because it is the most fundamental refusal available: whether the prefix is
  // well-formed or the rate is sane does not matter for a destination the product does not sell.
  // Only an explicit `false` refuses — `undefined` means the caller did not establish
  // eligibility, and refusing on an answer nobody gave would break every caller that has no
  // product context.
  if (op.eligible === false) {
    return refuse(op.operationKey, 'not_eligible',
      `${op.fullPrefix} → ${op.accountName}: this product is not declared eligible for that destination. `
    + `Declare it on the Eligibility screen, or remove it from this push.`);
  }

  // ── The prefix, which is the thing being written ────────────────────────────
  const prefix = String(op.fullPrefix ?? '').trim();
  if (!/^\d+$/.test(prefix)) {
    return refuse(op.operationKey, 'invalid_prefix',
      `${op.accountName}: "${op.fullPrefix}" is not a usable dialling prefix, so there is nothing well-formed to write.`);
  }

  // ── The price ───────────────────────────────────────────────────────────────
  // Zero is allowed: a destination can legitimately be free. Negative and non-finite are not.
  if (!Number.isFinite(op.rate) || op.rate < 0) {
    return refuse(op.operationKey, 'invalid_rate',
      `${prefix} → ${op.accountName}: ${JSON.stringify(op.rate)} is not a usable rate.`);
  }

  // ── The target, via the guard that already owns this rule ───────────────────
  const verdict = checkTariffIntegrity({
    accountName:     op.accountName,
    storedITariff:   op.storedITariff as any,
    resolvedITariff: op.resolvedITariff,
  });
  if (!verdict.safe) {
    return refuse(op.operationKey, TARIFF_CODE[verdict.reason] ?? 'unresolved_tariff', verdict.message);
  }

  // ── The billing terms ───────────────────────────────────────────────────────
  // Absent from the catalogue is not a refusal; present and unreadable is, because billing a
  // destination per second by default is a commercial decision nobody made.
  let interval1: number | undefined;
  let intervalN: number | undefined;
  if (op.rawIncrement !== null && op.rawIncrement !== undefined && String(op.rawIncrement).trim() !== '') {
    const parsed = parseBillingIncrement(op.rawIncrement);
    if (!parsed) {
      return refuse(op.operationKey, 'increment_unreadable',
        `${prefix} → ${op.accountName}: the catalogue's billing increment ${JSON.stringify(op.rawIncrement)} cannot be read, and pushing would bill this destination on terms nobody chose.`);
    }
    interval1 = parsed.interval1;
    intervalN = parsed.intervalN;
  }

  return { ok: true, operationKey: op.operationKey, iTariff: verdict.resolvedITariff as number, interval1, intervalN };
}

export interface PreflightOutcome {
  cleared: PreflightPass[];
  refused: PreflightRefusal[];
}

/**
 * Per operation, not per batch: a batch must be able to push the operations that are sound and
 * report the ones that are not, rather than cancelling everything because one account is
 * misprovisioned.
 */
export function preflightOperations(ops: ReadonlyArray<PreflightOperation>): PreflightOutcome {
  const cleared: PreflightPass[] = [];
  const refused: PreflightRefusal[] = [];
  for (const op of ops) {
    const d = preflightOperation(op);
    if (d.ok) cleared.push(d); else refused.push(d);
  }
  return { cleared, refused };
}

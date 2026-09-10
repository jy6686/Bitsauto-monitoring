/**
 * increment-apply.ts — giving the switch the increment on the day it was promised.
 *
 * THE ORDER IS THE SAFETY, and it is not negotiable:
 *
 *   effective date reached
 *     -> resolve the COMMERCIAL increment (never a fresh read of supplier data)
 *       -> tariff integrity, re-checked here and not trusted from earlier
 *         -> tariff lock, so a concurrent rate push cannot race this
 *           -> MUTATION BOUNDARY
 *             -> authoritative read-back, including the increment
 *               -> only now, applied_at
 *
 * WHAT THIS MODULE WILL NOT DO.
 *
 *   - Apply before the effective date. The date is the contract clients were given.
 *   - Re-read the supplier catalogue for the value. The commitment is `new_increment` on the
 *     change; a vendor file that landed in between must not silently redirect what is applied.
 *   - Claim `applied` on the strength of the mutation returning cheerfully. Sippy accepting a
 *     write is not evidence the tariff holds it — that is the whole reason read-back exists.
 *   - Retry an unproven outcome. A mutation that was sent and could not be verified is
 *     INDETERMINATE, and re-sending it is how a rate gets written twice.
 *
 * Every refusal before the mutation carries `refusedBeforeWrite: true` because of WHERE it
 * happens, not because someone remembered to set it: nothing above the boundary contacts Sippy.
 */
import { checkTariffIntegrity } from './tariff-integrity';
import { acquireTariff, type TariffLockProvider, type AcquireOptions } from './tariff-lock';
import { parseBillingIncrement, formatBillingIncrement } from './billing-increment';
import type { IncrementChange } from './increment-change';

export type ApplyOutcome =
  /** Sippy holds the new increment, and a read-back proved it. */
  | { verdict: 'applied'; changeId: number; increment: string; prefixesVerified: number; refusedBeforeWrite: false }
  /** Nothing was sent. Safe to attempt again once the cause is fixed. */
  | { verdict: 'refused'; changeId: number; code: RefusalCode; message: string; refusedBeforeWrite: true }
  /**
   * A mutation WAS sent and the result could not be proved. Not applied, not failed, and
   * explicitly not retryable without a human reading the tariff first.
   */
  | { verdict: 'needs_review'; changeId: number; message: string; refusedBeforeWrite: false };

export type RefusalCode =
  | 'not_yet_effective'
  | 'cancelled'
  | 'already_applied'
  | 'previously_failed'
  | 'unreadable_increment'
  | 'tariff_integrity'
  | 'lock_unavailable'
  | 'no_prefixes';

export interface ApplyDeps {
  /** Every prefix the change covers, resolved from the catalogue destination. */
  prefixesFor(change: IncrementChange): Promise<string[]>;
  /** The customer's tariff, as this platform stores it and as Sippy resolves it. */
  tariffFor(change: IncrementChange): Promise<{ accountName: string; storedITariff: number | null; resolvedITariff: number | string | null }>;
  lock: TariffLockProvider;
  /**
   * THE MUTATION. Everything above this is a read. Implementations must set their own
   * MutationBoundary immediately before the request leaves the process.
   */
  writeIncrement(input: { iTariff: number; prefixes: string[]; interval1: number; intervalN: number }):
    Promise<{ sent: boolean; message: string }>;
  /**
   * Authoritative read-back: what the tariff ACTUALLY holds now, per prefix. Returning null for
   * a prefix means "could not be established" — which is not the same as "wrong", and is
   * treated as unproven rather than as failure.
   */
  readBack(input: { iTariff: number; prefixes: string[] }):
    Promise<Map<string, { interval1: number; intervalN: number } | null>>;
  /** Persist the terminal state. Called only after the outcome is decided. */
  record(changeId: number, outcome: ApplyOutcome): Promise<void>;
  lockOptions?: AcquireOptions;
}

const refuse = (changeId: number, code: RefusalCode, message: string): ApplyOutcome =>
  ({ verdict: 'refused', changeId, code, message, refusedBeforeWrite: true });

/**
 * Apply one change, if today is its day and everything else holds.
 *
 * `asOf` is injected rather than read from the clock so the date rule is testable and does not
 * depend on which machine ran the worker.
 */
export async function applyIncrementChange(
  deps: ApplyDeps,
  change: IncrementChange,
  asOf: string,
): Promise<ApplyOutcome> {
  const id = change.id ?? 0;

  // ── State, before anything else ─────────────────────────────────────────────
  if (change.status === 'cancelled') {
    return finish(deps, refuse(id, 'cancelled', 'This change was cancelled and must never reach the switch.'));
  }
  if (change.status === 'applied') {
    // Idempotence. Re-applying would be a second write of something already proven present.
    return finish(deps, refuse(id, 'already_applied', 'Already applied and verified; not re-sending.'));
  }
  if (change.status === 'failed') {
    return finish(deps, refuse(id, 'previously_failed',
      'This change is marked failed. Resolve why before attempting it again.'));
  }

  // ── The date is the contract ────────────────────────────────────────────────
  if (change.effectiveDate > asOf) {
    return finish(deps, refuse(id, 'not_yet_effective',
      `Effective ${change.effectiveDate}; today is ${asOf}. Clients were told that date and the switch must not change before it.`));
  }

  // ── The increment comes from the COMMITMENT, never a fresh supplier read ────
  const parsed = parseBillingIncrement(change.newIncrement);
  if (!parsed) {
    return finish(deps, refuse(id, 'unreadable_increment',
      `The recorded increment "${change.newIncrement}" cannot be parsed, so there is nothing well-formed to send.`));
  }

  const prefixes = await deps.prefixesFor(change);
  if (prefixes.length === 0) {
    return finish(deps, refuse(id, 'no_prefixes',
      'The destination holds no prefixes, so this change would reach nothing.'));
  }

  // ── Tariff integrity, re-checked HERE ───────────────────────────────────────
  // Not trusted from whenever the change was scheduled: a customer's billing plan can move
  // between the promise and the day it falls due, and a rate landing on the wrong tariff is the
  // failure this check exists for.
  const t = await deps.tariffFor(change);
  const integrity = checkTariffIntegrity({
    accountName: t.accountName, storedITariff: t.storedITariff, resolvedITariff: t.resolvedITariff,
  });
  if (!integrity.safe) {
    return finish(deps, refuse(id, 'tariff_integrity', `${integrity.message} (${integrity.reason})`));
  }
  const iTariff = integrity.resolvedITariff;

  // ── Serialise on the tariff ─────────────────────────────────────────────────
  const release = await acquireTariff(deps.lock, iTariff, deps.lockOptions);
  if (!release) {
    // Another mutation holds this tariff. Refusing is correct and safe: nothing was sent, and
    // the change stays due for the next run.
    return finish(deps, refuse(id, 'lock_unavailable',
      `Tariff ${iTariff} is busy with another rate mutation. Nothing was sent; this remains due.`));
  }

  try {
    // ── THE MUTATION BOUNDARY ─────────────────────────────────────────────────
    let sent: { sent: boolean; message: string };
    try {
      sent = await deps.writeIncrement({ iTariff, prefixes, interval1: parsed.interval1, intervalN: parsed.intervalN });
    } catch (e: any) {
      // A throw here is NOT proof nothing was sent — a request that times out has still left the
      // process. Unknown, therefore needs review, never a clean retry.
      return finish(deps, {
        verdict: 'needs_review', changeId: id, refusedBeforeWrite: false,
        message: `The increment write threw (${e?.message ?? e}). It may have reached tariff ${iTariff}. Read the tariff back before retrying.`,
      });
    }

    if (!sent.sent) {
      // The implementation states positively that nothing left the process.
      return finish(deps, refuse(id, 'tariff_integrity', `The write was not sent: ${sent.message}`));
    }

    // ── Authoritative read-back ───────────────────────────────────────────────
    // Sippy accepting a write is not evidence the tariff holds it.
    let held: Map<string, { interval1: number; intervalN: number } | null>;
    try {
      held = await deps.readBack({ iTariff, prefixes });
    } catch (e: any) {
      return finish(deps, {
        verdict: 'needs_review', changeId: id, refusedBeforeWrite: false,
        message: `The write was sent to tariff ${iTariff} but the read-back failed (${e?.message ?? e}). What the tariff holds is unknown.`,
      });
    }

    const want = formatBillingIncrement(parsed);
    const unproven: string[] = [];
    const wrong: string[] = [];
    for (const p of prefixes) {
      const actual = held.get(p);
      if (actual === undefined || actual === null) { unproven.push(p); continue; }
      if (actual.interval1 !== parsed.interval1 || actual.intervalN !== parsed.intervalN) {
        wrong.push(`${p}=${actual.interval1}/${actual.intervalN}`);
      }
    }

    if (wrong.length > 0) {
      // The tariff holds something, and it is not what was promised. Reporting this as failure
      // would imply nothing happened; something did.
      return finish(deps, {
        verdict: 'needs_review', changeId: id, refusedBeforeWrite: false,
        message: `Tariff ${iTariff} does not hold ${want} after the write: ${wrong.slice(0, 5).join(', ')}. Clients were told ${want} from ${change.effectiveDate}.`,
      });
    }
    if (unproven.length > 0) {
      return finish(deps, {
        verdict: 'needs_review', changeId: id, refusedBeforeWrite: false,
        message: `The write was sent, but ${unproven.length} of ${prefixes.length} prefix(es) could not be read back (${unproven.slice(0, 5).join(', ')}). Not claiming applied on an unproven result.`,
      });
    }

    return finish(deps, {
      verdict: 'applied', changeId: id, increment: want,
      prefixesVerified: prefixes.length, refusedBeforeWrite: false,
    });
  } finally {
    await release();
  }
}

async function finish(deps: ApplyDeps, outcome: ApplyOutcome): Promise<ApplyOutcome> {
  await deps.record(outcome.changeId, outcome);
  return outcome;
}

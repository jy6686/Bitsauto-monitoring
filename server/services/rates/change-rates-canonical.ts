/**
 * change-rates-canonical.ts — the Rate Analysis rate change, routed through the canonical seam.
 *
 * WHAT THIS REPLACES. The `change-client-rates` handler builds its own operation rows and then runs
 * `for (const [opIdx, prefix] of prefixes.entries())`, calling `sippy.setSippyRateEntry` /
 * `sippy.pushRateToSippy` directly. It reaches neither `runRateBatch` nor the tariff advisory lock.
 * So the two entry points can write ONE tariff concurrently, and this one can write while a batch
 * holds the lock, because it never asks for it — the exact failure `batch-plan` exists to prevent
 * (jobs #37–#45, "Tariff N is locked — processing of uploaded file is in progress").
 *
 * THE INVARIANT THIS SATISFIES:
 *
 *   No production rate mutation may reach `setSippyRateEntry` or `pushRateToSippy`
 *   except through the canonical `runRateBatch` seam.
 *
 * This module names neither primitive. The transport arrives as `deps.push`, which `runRateBatch`
 * invokes INSIDE the lock it holds — the same shape `push-batch` already uses via `pushFor(jobId)`.
 * `canonical-seam-guard.ts` asserts that mechanically against this file's own source.
 *
 * WHAT IT DOES NOT DO, ON PURPOSE.
 *
 *  - It does not reshape `batch-plan` or `batch-runner`. Those are certified; this is a second
 *    ORIGIN feeding them, not a variant engine.
 *  - It does not resolve the tariff itself. The caller supplies a resolver, because the resolution
 *    is a database and Sippy question and this has to stay provable without either.
 *  - It does not re-implement operation recording, readback or terminal-status handling. Those come
 *    from the engine. The duplicated plumbing in the old handler is discarded, not carried over —
 *    it was duplication, not stronger behaviour.
 *  - It does not use `stage-failure.ts`. That wiring is a separate, later decision.
 *
 * THE ONE BEHAVIOUR WORTH RESCUING FROM THE OLD HANDLER is its explicit log when the TERMINAL
 * operation update itself fails — the operation stays pending and the job is not terminalised,
 * which keeps `job-terminalization.ts`'s invariant true. That lives in the engine's recording path
 * for both entry points; `onTerminalUpdateFailure` is here so the caller can still surface it.
 *
 * TWO DECLARED BEHAVIOUR CHANGES when this is eventually wired, neither of which may ship quietly:
 *   1. a change waits on the tariff lock it currently ignores;
 *   2. an ineligible destination is refused where it currently succeeds.
 */
import type { RunnerOperation, BatchRunnerDeps, BatchRunInput, BatchRunOutcome } from './batch-runner';
import { buildLiteralPrefixOperations, type LiteralPrefixRefusal } from './literal-prefix-origin';

/** Server-side resolution. The request's `iTariff` is a claim and is never used in its place. */
export interface TariffResolution {
  readonly storedITariff: number | string | null | undefined;
  readonly resolvedITariff: number | string | null | undefined;
  readonly iAccount?: number | null;
  readonly clientId?: number | null;
  readonly clientName?: string | null;
}

export interface ChangeRatesRequest {
  readonly jobId: string;
  readonly accountName: string;
  /** From the request body — a CLAIM about the tariff. */
  readonly iTariff: number | string | null | undefined;
  readonly prefixes: readonly string[];
  readonly rate: number;
  readonly effectiveFrom?: string;
  readonly effectiveTill?: string;
  readonly productId?: number | null;
  readonly productName?: string | null;
  readonly trunkPrefix?: string | null;
  readonly concurrency?: number;
}

export interface ChangeRatesDeps {
  /** Everything `runRateBatch` needs, passed straight through — transport included. */
  readonly batch: BatchRunnerDeps;
  readonly runBatch: (deps: BatchRunnerDeps, input: BatchRunInput) => Promise<BatchRunOutcome>;
  readonly resolveTariff: (accountName: string) => Promise<TariffResolution>;
  /** null when the lookup did not answer — absence is not permission, and not a refusal. */
  readonly listEligiblePrefixes?: (productId: number) => Promise<ReadonlySet<string> | null>;
  readonly rawIncrementFor?: (prefixes: readonly string[]) => Promise<ReadonlyMap<string, string | null>>;
  /** Recorded AFTER execution; a failure here never fails the push, it is re-derived later. */
  readonly createObligations?: (jobId: string, operations: readonly RunnerOperation[]) => Promise<unknown>;
  readonly onObligationError?: (e: unknown) => void;
  readonly onTerminalUpdateFailure?: (detail: { jobId: string; operationKey: string }) => void;
}

export type ChangeRatesResult =
  | { readonly ok: false; readonly refusal: LiteralPrefixRefusal }
  | { readonly ok: true; readonly outcome: BatchRunOutcome; readonly obligationRecorded: boolean };

export async function changeClientRatesCanonical(
  deps: ChangeRatesDeps,
  req: ChangeRatesRequest,
): Promise<ChangeRatesResult> {
  // 1. The tariff is resolved by the SERVER. The request's value is only ever checked against it.
  const resolution = await deps.resolveTariff(req.accountName);

  // 2. Eligibility, resolved defensively: a lookup that does not answer leaves it UNDEFINED rather
  //    than false, exactly as push-batch does. Preflight inside the engine does the refusing.
  let eligiblePrefixes: ReadonlySet<string> | null = null;
  if (deps.listEligiblePrefixes && req.productId != null) {
    try {
      eligiblePrefixes = await deps.listEligiblePrefixes(Number(req.productId));
    } catch {
      eligiblePrefixes = null;
    }
  }

  const rawIncrementByPrefix = deps.rawIncrementFor ? await deps.rawIncrementFor(req.prefixes) : undefined;

  // 3. Adapt the literal-prefix contract into canonical operations, or refuse before anything runs.
  const built = buildLiteralPrefixOperations(
    {
      accountName: req.accountName,
      claimedITariff: req.iTariff,
      prefixes: req.prefixes,
      rate: req.rate,
      ...(req.effectiveFrom ? { effectiveFrom: req.effectiveFrom } : {}),
      ...(req.effectiveTill ? { effectiveTill: req.effectiveTill } : {}),
    },
    {
      storedITariff: resolution.storedITariff,
      resolvedITariff: resolution.resolvedITariff,
      eligiblePrefixes,
      iAccount: resolution.iAccount ?? null,
      clientId: resolution.clientId ?? null,
      clientName: resolution.clientName ?? null,
      productName: req.productName ?? null,
      trunkPrefix: req.trunkPrefix ?? null,
      ...(rawIncrementByPrefix ? { rawIncrementByPrefix } : {}),
    },
  );
  if (!built.ok) return { ok: false, refusal: built.refusal };

  // 4. The canonical seam. Lock, lane, preflight, mutation, recording, readback — all of it here.
  const outcome = await deps.runBatch(deps.batch, {
    jobId: req.jobId,
    operations: built.operations,
    productName: req.productName ?? null,
    trunkPrefix: req.trunkPrefix ?? null,
    ...(req.concurrency != null ? { concurrency: req.concurrency } : {}),
  });

  // 5. The obligation, after execution. An obligation that was not recorded is re-derived by the
  //    recovery sweep, so failing here must not fail a push that already mutated Sippy.
  let obligationRecorded = false;
  if (deps.createObligations) {
    try {
      await deps.createObligations(req.jobId, built.operations);
      obligationRecorded = true;
    } catch (e) {
      deps.onObligationError?.(e);
    }
  }

  return { ok: true, outcome, obligationRecorded };
}

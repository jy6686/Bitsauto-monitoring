/**
 * tariff-schedule.ts — running per-account jobs without losing the one-writer-per-tariff rule.
 *
 * THE PROPERTY THIS PROTECTS, AND WHY IT IS NOT A TUNING KNOB. `batch-plan.ts` groups operations
 * into one lane per tariff and runs lanes through a bounded pool, so two operations against one
 * tariff never overlap. That rule is a defect expressed as scheduling: between 2026-09-07 and
 * 09-09 jobs #37–#45 failed in sequence with "Tariff N is locked — processing of uploaded file is
 * in progress", and tariff 64's only writer in its whole history was job #43 — each push renewed
 * the lock it then tripped over.
 *
 * SPLITTING A SUBMISSION BY ACCOUNT THREATENS THAT RULE. A tariff resolves per ACCOUNT, not per
 * destination, so one account is always exactly one lane — that direction is safe. The danger is
 * the reverse: two accounts sharing a tariff are ONE lane today, strictly serialised by the
 * planner. Give each its own job and they take two pool slots and both go for that tariff. The
 * advisory lock would still prevent a simultaneous write, but the guarantee would have quietly
 * downgraded from planned ordering to contention with a timeout — and a timeout fails, where
 * today the second account simply waited its turn and succeeded.
 *
 * So the scheduling rule moves up a level rather than being abandoned: one active job per tariff,
 * `concurrency` tariffs at once. That is the same envelope `batch-plan` enforces one level down,
 * which is why the Sippy-facing load is unchanged by the split.
 *
 * Pure of everything but the runner it is given: no database, no Sippy, no clock. The caller
 * supplies `run`, so the ordering can be proven without a switch.
 */

export interface TariffJob<T> {
  /**
   * The tariff this job writes. NULL when the account's tariff never resolved — such a job still
   * runs, because its operations must be RECORDED as refused rather than silently dropped, but it
   * writes nothing and so contends with nobody. Each is given its own chain rather than being
   * herded into a shared one, which would serialise jobs that cannot collide.
   */
  iTariff: number | null;
  job: T;
}

export type ScheduleOutcome<R> =
  | { ok: true; value: R }
  /** `run` threw. The rest of THIS tariff's chain is skipped; other tariffs are unaffected. */
  | { ok: false; error: string; skipped: false }
  /** Never attempted, because an earlier job on the same tariff threw. */
  | { ok: false; error: string; skipped: true };

/**
 * Run jobs so that no two touching the same tariff overlap, at most `concurrency` tariffs at once.
 *
 * Results come back in INPUT order regardless of completion order, because the caller's response
 * and the operator's screen list accounts in the order they were submitted.
 *
 * A throw stops that tariff's chain and no other, mirroring `batch-execute`: "this lane stops;
 * other lanes are unaffected". The remaining jobs on that tariff are reported as skipped rather
 * than silently omitted — an operator who is not told an account was never attempted will read
 * its absence as success.
 */
export async function runTariffExclusive<T, R>(
  jobs: readonly TariffJob<T>[],
  opts: { concurrency: number; run: (job: T) => Promise<R> },
): Promise<Array<ScheduleOutcome<R>>> {
  const list = jobs ?? [];
  const results: Array<ScheduleOutcome<R>> = new Array(list.length);
  if (list.length === 0) return results;

  // One chain per tariff; an unresolved tariff gets a chain of its own, keyed so it cannot
  // collide with a real tariff id.
  const chains = new Map<string, number[]>();
  list.forEach((entry, index) => {
    const key = entry?.iTariff === null || entry?.iTariff === undefined
      ? `unresolved:${index}`
      : `tariff:${entry.iTariff}`;
    const chain = chains.get(key) ?? [];
    chain.push(index);
    chains.set(key, chain);
  });

  // Never more workers than chains: extra workers buy nothing and would overstate the parallelism.
  const queue = [...chains.values()];
  const width = Math.max(1, Math.min(Number(opts?.concurrency) || 1, queue.length));

  const workers = Array.from({ length: width }, async () => {
    for (;;) {
      const chain = queue.shift();
      if (!chain) return;

      let aborted: string | null = null;
      for (const index of chain) {
        if (aborted !== null) {
          results[index] = { ok: false, error: `Not attempted: an earlier job on this tariff failed (${aborted}).`, skipped: true };
          continue;
        }
        try {
          results[index] = { ok: true, value: await opts.run(list[index].job) };
        } catch (e: any) {
          aborted = String(e?.message ?? e);
          results[index] = { ok: false, error: aborted, skipped: false };
        }
      }
    }
  });

  await Promise.all(workers);
  return results;
}

/**
 * seed-single-flight.ts — refusing a second import of work already in flight.
 *
 * Production 2026-08-27: two imports of the SAME account, tariff and day were
 * accepted and ran concurrently — 48 slices walked twice, against one Sippy
 * credential, on an instance that had already lost its API three times under
 * import load. The idempotent insert meant no data was harmed; the cost was
 * pure duplicated pressure on the exact dependency implicated in the failures.
 *
 * Nothing refused it because nothing was asking. The seeder had no notion of
 * "this work is already running".
 *
 * The check is deliberately against IN-PROCESS state, not the seed_jobs table.
 * A row reading 'running' in the database usually means a process was killed
 * mid-run — this instance is recycled routinely — and such a row must NOT block
 * a fresh attempt forever. What this guard exists to stop is the live case: an
 * operator (or a retry) starting the same day twice while the first is still
 * working. When the process restarts, the old job is genuinely gone and a new
 * one is genuinely correct.
 *
 * Dependency-free so the matching rule is pinned by tests.
 */

export interface SeedRequestKey {
  iAccount:    number | string;
  iTariff:     string | number;
  periodStart: string;
  /** Absent means a single day — the seeder's own contract. */
  periodEnd?:  string | null;
}

export interface RunningSeedJob {
  jobId:   string;
  status:  string;
  request?: SeedRequestKey;
}

/**
 * Canonical form of a request, so `'32'` and `32` — or an omitted periodEnd and
 * one spelled out as the same day — are recognised as the same work. Loose
 * comparison matters here: a guard that misses a duplicate because the operator
 * typed a number instead of a string is no guard at all.
 */
export function seedRequestKey(r: SeedRequestKey): string {
  const account = String(Number(r.iAccount));
  const tariff  = String(r.iTariff ?? '').trim();
  const start   = String(r.periodStart ?? '').trim();
  const end     = String(r.periodEnd ?? r.periodStart ?? '').trim();
  return `${account}|${tariff}|${start}|${end}`;
}

export function sameSeedRequest(a: SeedRequestKey, b: SeedRequestKey): boolean {
  return seedRequestKey(a) === seedRequestKey(b);
}

/**
 * The running job covering this exact request, if one exists.
 *
 * Only 'running' counts. A finished job — done or error — must never block a
 * re-run: re-running a failed day is the documented recovery, and re-running a
 * completed one is a cheap no-op the idempotent insert absorbs.
 *
 * A job whose request was not recorded is treated as NOT matching. Blocking on
 * an unknown would refuse legitimate work to protect against a duplicate we
 * cannot demonstrate.
 */
export function findRunningDuplicate(
  jobs: Iterable<RunningSeedJob>,
  request: SeedRequestKey,
): RunningSeedJob | null {
  const key = seedRequestKey(request);
  for (const j of jobs) {
    if (j.status !== 'running') continue;
    if (!j.request) continue;
    if (seedRequestKey(j.request) === key) return j;
  }
  return null;
}

/**
 * credential-memory.ts — which Sippy credentials are worth asking again.
 *
 * MEASURED IN PRODUCTION, 2026-09-07, four accounts in one night:
 *
 *   asif #55      192 pages, 144 failed, 0 rows, 48 slices, 18.1 min
 *   aircel #4     192 pages, 144 failed, 0 rows, 48 slices, 18.8 min
 *   acmetel #58   192 pages, 144 failed, 0 rows, 48 slices, 12.6 min
 *   asterisk #315 111 pages,  63 failed, 3,101 rows
 *
 * Exactly four pages per empty slice: three fail, one returns cleanly empty.
 * The same three failed on all 48 slices, because the credential ladder is
 * rebuilt inside the per-slice fetch. `sippyXmlCredsPairs` filters to
 * admin-username pairs only, so every surviving pair carries the SAME username
 * and differs only by password — three wrong passwords, re-tried 48 times a
 * night, each costing a timeout (worst single page observed: 69.6s).
 *
 * ── What this does NOT touch ────────────────────────────────────────────────
 *
 * The silent-auth guard. A credential answering cleanly EMPTY does not end the
 * fetch loop; the remaining credentials are still asked, because a credential
 * that silently returns zero rows instead of an auth fault is precisely what
 * that guard exists to catch. Every pair that has not PROVEN itself broken is
 * still offered on every slice.
 *
 * ── What it does ────────────────────────────────────────────────────────────
 *
 * Retires a pair that has failed `retireAfter` times within one account's run.
 * A wrong password does not become right on the third slice. Two failures,
 * not one, so a single transient blip cannot retire a working credential.
 *
 * Two independent recovery paths, because being unable to authenticate must
 * look like a failed fetch and never like an empty window:
 *   1. a pair that has ever succeeded is never retired, whatever it does later
 *   2. if retiring would leave nothing, the whole ladder comes back
 *
 * Pure: no clock, no network, no settings. The caller supplies the ladder and
 * the memory; this decides order and eligibility.
 */

export interface CredPair {
  username: string;
  password: string;
}

export interface CredChoice extends CredPair {
  /** Stable identity for this rung. Carries no password material. */
  key: string;
  /** Human-facing name for logs and telemetry. Also password-free. */
  label: string;
}

export interface CredMemory {
  /** Keys that have completed a fetch without failing. */
  proven: ReadonlySet<string>;
  /** Key → consecutive failures within this run. */
  failures: ReadonlyMap<string, number>;
  /** Failures tolerated before a pair stops being asked. */
  retireAfter?: number;
}

export const DEFAULT_RETIRE_AFTER = 2;

/**
 * Identity of a ladder rung. The index is what distinguishes pairs, since the
 * admin-username filter means they all share one username — and the password
 * must never reach a log line, a telemetry row or an error message.
 */
export const credKeyFor = (index: number, username: string) => `${index}:${username}`;
export const credLabelFor = (index: number, username: string) => `${username}#${index + 1}`;

/**
 * The credentials to try for one slice, in order.
 *
 * Proven pairs first — the one that authenticated last slice is overwhelmingly
 * the one that will authenticate this slice, and trying it first means a slice
 * with rows returns after a single page instead of after the ladder.
 */
export function selectCredentials(
  pairs: readonly CredPair[],
  memory: CredMemory,
): CredChoice[] {
  const retireAfter = memory.retireAfter ?? DEFAULT_RETIRE_AFTER;

  const ladder: CredChoice[] = pairs.map((p, i) => ({
    ...p,
    key:   credKeyFor(i, p.username),
    label: credLabelFor(i, p.username),
  }));

  const live = ladder.filter(c =>
    memory.proven.has(c.key) || (memory.failures.get(c.key) ?? 0) < retireAfter);

  // Retiring everything would turn an authentication outage into a silent
  // "empty window", which is the one outcome this whole path must never
  // produce. When nothing survives, everything is offered again.
  const candidates = live.length > 0 ? live : ladder;

  // Stable within each group: ties keep ladder order, which is the deliberate
  // priority in sippyXmlCredsPairs (explicit admin creds before recovery
  // combinations before the platform default).
  return candidates
    .map((c, i) => ({ c, i }))
    .sort((a, b) => {
      const pa = Number(memory.proven.has(a.c.key));
      const pb = Number(memory.proven.has(b.c.key));
      return pb - pa || a.i - b.i;
    })
    .map(x => x.c);
}

/**
 * Pages this run will spend on credentials across a whole account. Exists so
 * the saving is arithmetic rather than a hope, and so a test pins it against
 * the production numbers.
 *
 * The two cases behave differently and the difference is the silent-auth
 * guard, so the model carries it rather than averaging it away:
 *
 *   hasRows  the fetch loop RETURNS at the first credential that yields rows,
 *            so ordering proven-first is what saves pages
 *   empty    the loop asks EVERY live credential even after one answers
 *            cleanly empty, so only retirement saves pages — and which rung
 *            works makes no difference to the total
 */
export function pagesForRun(opts: {
  slices: number; rungs: number; workingRung: number;
  hasRows?: boolean; retireAfter?: number;
}): number {
  const retireAfter = opts.retireAfter ?? DEFAULT_RETIRE_AFTER;
  const proven = new Set<string>();
  const failures = new Map<string, number>();
  const pairs = Array.from({ length: opts.rungs },
    (_, i) => ({ username: 'u', password: `p${i}` }));
  const workingKey = credKeyFor(opts.workingRung, 'u');
  let pages = 0;

  for (let s = 0; s < opts.slices; s++) {
    for (const c of selectCredentials(pairs, { proven, failures, retireAfter })) {
      pages++;
      if (c.key !== workingKey) {
        failures.set(c.key, (failures.get(c.key) ?? 0) + 1);
        continue;
      }
      proven.add(c.key); failures.delete(c.key);
      if (opts.hasRows) break;   // the loop returns; later rungs are not asked
    }
  }
  return pages;
}

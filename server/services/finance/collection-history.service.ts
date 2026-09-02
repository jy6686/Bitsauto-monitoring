/**
 * collection-history.service.ts — the planner's memory, from the ledger that
 * already exists.
 *
 * NO NEW TABLE. `seed_jobs` has persisted exactly this since migration 082:
 * one durable row per (day, account) carrying i_account, started_at,
 * finished_at, fetched_total, stored_total and status. It survives restarts and
 * deployments, it is written on every account of every run, and it already
 * holds weeks of history. A dedicated account_runtime_history table would be a
 * second copy of data the collector writes anyway — and a second copy is a
 * thing that can disagree with the first.
 *
 * Learning is therefore CONTINUOUS by construction: every completed account
 * appends a row, so the next night's plan is computed from the latest evidence
 * without anyone updating a statistic. When the fetch fix lands and a heavy
 * account starts costing 8 minutes instead of 20, three runs are enough for the
 * planner to notice and re-size itself.
 *
 * Read-only.
 */
import { db } from '../../db';
import { sql } from 'drizzle-orm';
import type { AccountHistory } from '../../collection-queue';

/**
 * @param lookbackDays how far back to learn from. Long enough for a stable
 *        median, short enough that a fixed collector is reflected quickly —
 *        history from before a performance fix describes a platform that no
 *        longer exists.
 * @param maxRunsPerAccount most recent N runs per account.
 */
export async function collectionHistory(opts?: {
  lookbackDays?: number;
  maxRunsPerAccount?: number;
}): Promise<AccountHistory[]> {
  const days = Math.max(1, opts?.lookbackDays ?? 14);
  const cap  = Math.max(1, opts?.maxRunsPerAccount ?? 10);

  const rows: any = await db.execute(sql`
    WITH runs AS (
      SELECT j.i_account,
             EXTRACT(EPOCH FROM (j.finished_at - j.started_at)) * 1000 AS duration_ms,
             j.fetched_total,
             row_number() OVER (PARTITION BY j.i_account ORDER BY j.started_at DESC) AS rn
        FROM seed_jobs j
       WHERE j.i_account IS NOT NULL
         AND j.status = 'done'
         AND j.finished_at IS NOT NULL
         AND j.started_at >= now() - (${days} || ' days')::interval
         -- A run that finished before it started, or instantly, is a clock
         -- artefact rather than a measurement. Learning from it would poison
         -- the median it is supposed to inform.
         AND j.finished_at > j.started_at
    )
    SELECT r.i_account, r.duration_ms, r.fetched_total,
           (SELECT c.name FROM companies c
             WHERE c.sippy_i_account = r.i_account
             ORDER BY c.name LIMIT 1) AS name
      FROM runs r
     WHERE r.rn <= ${cap}
     ORDER BY r.i_account
  `);

  const byAccount = new Map<number, AccountHistory>();
  for (const r of ((rows.rows ?? []) as any[])) {
    const id = Number(r.i_account);
    if (!byAccount.has(id)) {
      byAccount.set(id, { iAccount: id, name: r.name ?? null, runs: [] });
    }
    byAccount.get(id)!.runs.push({
      durationMs: Number(r.duration_ms) || 0,
      fetched:    Number(r.fetched_total) || 0,
    });
  }
  return [...byAccount.values()];
}

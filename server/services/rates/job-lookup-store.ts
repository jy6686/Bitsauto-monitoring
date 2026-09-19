/**
 * job-lookup-store.ts
 *
 * The two reads behind the submit guards and the by-request lookup. Raw SQL on the same
 * `OperationQueryable` surface as operation-store.ts, so both are proven against real Postgres
 * (PGlite) with the real 525 migration and no live database. Read-only: nothing here writes.
 */
import { sql } from 'drizzle-orm';
import type { OperationQueryable } from './operation-store';
import type { LiveJob } from './submit-guards';

const rows = (r: any): any[] => (Array.isArray(r) ? r : (r?.rows ?? []));
const asDate = (v: any): Date | null => (v === null || v === undefined ? null : (v instanceof Date ? v : new Date(v)));
const asNum = (v: any): number | null => (v === null || v === undefined ? null : Number(v));
const asStr = (v: any): string | null => (v === null || v === undefined ? null : String(v));

export interface JobByRequest {
  jobId: string;
  status: string;
  iTariff: number | null;
  clientNames: string | null;
  lastStep: string | null;
  lastStepAt: Date | null;
  createdAt: Date | null;
  completedAt: Date | null;
  errorMessage: string | null;
}

/** The job recorded under a client request id. A NULL key never matches anything. */
export async function findJobByClientRequestId(db: OperationQueryable, clientRequestId: string): Promise<JobByRequest | null> {
  if (!clientRequestId) return null;
  const r = rows(await db.execute(sql`
    SELECT job_id, status, i_tariff, client_names, last_step, last_step_at, created_at, completed_at, error_message
      FROM rate_push_jobs
     WHERE client_request_id = ${clientRequestId}
     LIMIT 1`))[0];
  if (!r) return null;
  return {
    jobId: String(r.job_id), status: String(r.status), iTariff: asNum(r.i_tariff), clientNames: asStr(r.client_names),
    lastStep: asStr(r.last_step), lastStepAt: asDate(r.last_step_at), createdAt: asDate(r.created_at),
    completedAt: asDate(r.completed_at), errorMessage: asStr(r.error_message),
  };
}

/** Non-terminal jobs on the given tariffs, carrying both clocks the stale rule needs. */
export async function listNonTerminalJobsForTariffs(db: OperationQueryable, tariffs: ReadonlyArray<number>): Promise<LiveJob[]> {
  const ids = [...new Set(tariffs.filter(t => Number.isFinite(t)))];
  if (ids.length === 0) return [];
  const list = sql.join(ids.map(t => sql`${t}`), sql`, `);
  return rows(await db.execute(sql`
    SELECT job_id, status, i_tariff, last_step_at, created_at
      FROM rate_push_jobs
     WHERE status IN ('pending', 'processing')
       AND i_tariff IN (${list})`))
    .map((r: any) => ({
      jobId: String(r.job_id), status: String(r.status), iTariff: asNum(r.i_tariff),
      lastStepAt: asDate(r.last_step_at), createdAt: asDate(r.created_at) ?? new Date(0),
    }));
}

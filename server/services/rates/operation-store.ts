/**
 * operation-store.ts
 *
 * Durable execution state for a rate push: one row per operation, and a parent status DERIVED
 * from those rows rather than kept alongside them.
 *
 * WHY THE PARENT STATUS IS DERIVED. The batch route used to count successes in an in-memory array
 * and write two integers onto the job row at the end. Anything that ended the process early — and
 * this one restarts often — left a job that had done real work looking like a job that had done
 * nothing, with no way to tell which operations had run. A counter maintained beside the evidence
 * can disagree with it; a status computed from the evidence cannot.
 *
 * RESTART AND RECOVERY, STATED BEFORE ANY EXECUTION IS WIRED.
 *
 * `running` is the state that makes recovery possible. A row still marked running when nothing is
 * executing belongs to a process that died mid-operation. Its request may have reached Sippy and
 * may have changed the tariff, so:
 *
 *   1. every interrupted `running` row becomes `indeterminate` — never `failed`, and never retried;
 *   2. every `pending` row in a tariff that now holds an indeterminate outcome becomes
 *      `not_attempted`, which is the live lane-halt rule applied to a crash: that tariff's state is
 *      unknown, so nothing further may be written to it;
 *   3. `pending` rows in unaffected tariffs are LEFT pending. They were never started, so they
 *      remain resumable, and this module reports them rather than deciding their fate.
 *
 * Recovery reclassifies and reports. It never resumes, never retries, and never writes to Sippy.
 */
import { sql } from 'drizzle-orm';
import type { BatchPlan } from './batch-plan';
import type { OperationResult } from './batch-execute';

/** Same minimal injection point the catalogue lookup uses, so PGlite can drive it in tests. */
export interface OperationQueryable {
  execute(query: any): Promise<any>;
}

export type OperationStatus =
  | 'pending' | 'running' | 'succeeded' | 'failed' | 'indeterminate' | 'not_attempted';

/** Parent status derived from children. `needs_review` outranks the rest: it needs a person. */
export type JobStatus =
  | 'pending' | 'processing' | 'completed' | 'partial' | 'failed' | 'needs_review';

export interface OperationCounts {
  pending: number; running: number; succeeded: number;
  failed: number; indeterminate: number; not_attempted: number;
  total: number;
}

export interface JobSummary {
  status: JobStatus;
  counts: OperationCounts;
  /** Tariffs left in an unknown state. Nothing further may be written to these without a read. */
  tariffsNeedingReview: number[];
  /**
   * True when something is still waiting for a PERSON. False once every unestablished outcome has
   * been resolved — which is not the same as `status`, that stays historical.
   */
  requiresReview: boolean;
  /** Operations still `indeterminate` with no resolution recorded. */
  unresolvedCount: number;
}

/** Job-level facts every operation of a batch shares. */
export interface PersistContext {
  productName?: string | null;
  trunkPrefix?: string | null;
  /** Per-operation extras the plan does not carry, keyed by operationKey. */
  extras?: Record<string, {
    dialPrefix?: string | null;
    destinationName?: string | null;
    iAccount?: number | null;
  }>;
}

const rows = (r: any): any[] => (Array.isArray(r) ? r : (r?.rows ?? []));
const num = (v: any): number => (v === null || v === undefined ? 0 : Number(v));

/**
 * Writes every operation of a plan, executable and refused alike, in one statement.
 *
 * A refused operation is stored as `not_attempted` with `refused_before_write = TRUE`: planning
 * rejected it before any request existed, so its tariff is certainly untouched. That is the one
 * case where the flag can be asserted rather than left unestablished.
 */
export async function persistPlan(
  db: OperationQueryable,
  jobId: string,
  plan: BatchPlan,
  ctx: PersistContext = {},
): Promise<number> {
  type Row = {
    key: string; seq: number; lanePos: number | null; account: string; iTariff: number | null;
    prefix: string; rate: number; i1?: number; iN?: number; from?: string; till?: string;
    status: OperationStatus; refusedBeforeWrite: boolean | null; message: string | null;
  };
  const out: Row[] = [];
  let seq = 0;

  for (const lane of plan.lanes) {
    lane.operations.forEach((op, lanePos) => {
      out.push({
        key: op.operationKey, seq: seq++, lanePos, account: op.accountName, iTariff: lane.iTariff,
        prefix: op.prefix, rate: op.rate, i1: op.interval1, iN: op.intervalN,
        from: op.effectiveFrom, till: op.effectiveTill,
        status: 'pending', refusedBeforeWrite: null, message: null,
      });
    });
  }
  for (const r of plan.refused) {
    out.push({
      key: r.operation.operationKey, seq: seq++, lanePos: null, account: r.operation.accountName,
      iTariff: r.operation.iTariff ?? null, prefix: r.operation.prefix, rate: r.operation.rate,
      i1: r.operation.interval1, iN: r.operation.intervalN,
      from: r.operation.effectiveFrom, till: r.operation.effectiveTill,
      status: 'not_attempted', refusedBeforeWrite: true, message: `Refused (${r.code}): ${r.message}`,
    });
  }
  if (out.length === 0) return 0;

  const values = sql.join(
    out.map(r => sql`(${jobId}, ${r.key}, ${r.seq}, ${r.lanePos}, ${r.account},
                      ${ctx.productName ?? null}, ${ctx.trunkPrefix ?? null},
                      ${ctx.extras?.[r.key]?.dialPrefix ?? null}, ${r.prefix},
                      ${ctx.extras?.[r.key]?.destinationName ?? null}, ${String(r.rate)},
                      ${r.i1 ?? null}, ${r.iN ?? null}, ${r.from ?? null}, ${r.till ?? null},
                      ${ctx.extras?.[r.key]?.iAccount ?? null}, ${r.iTariff},
                      ${r.status}, ${r.refusedBeforeWrite}, ${r.message})`),
    sql`, `,
  );

  // Explicit column list and an explicit VALUES list: no array parameter, which is the shape that
  // returned 500 on every push when the catalogue lookup shipped with `= ANY(array)`.
  await db.execute(sql`
    INSERT INTO rate_push_operations
      (job_id, operation_key, sequence, lane_position, account_name,
       product_name, trunk_prefix, dial_prefix, full_prefix,
       destination_name, requested_rate, interval_1, interval_n, effective_from, effective_till,
       i_account, i_tariff, status, refused_before_write, message)
    VALUES ${values}`);
  return out.length;
}

/** Marks an operation in flight. The row is now recoverable evidence that a request may exist. */
export async function markOperationRunning(
  db: OperationQueryable, jobId: string, operationKey: string,
): Promise<void> {
  await db.execute(sql`
    UPDATE rate_push_operations
       SET status = 'running', started_at = COALESCE(started_at, NOW())
     WHERE job_id = ${jobId} AND operation_key = ${operationKey}`);
}

const STATUS_FOR_VERDICT: Record<OperationResult['verdict'], OperationStatus> = {
  success: 'succeeded',
  failure: 'failed',
  indeterminate: 'indeterminate',
  not_attempted: 'not_attempted',
};

/** Records a settled outcome. `refusedBeforeWrite` stays NULL unless the caller established it. */
export async function recordOperationResult(
  db: OperationQueryable,
  jobId: string,
  result: OperationResult,
  extra: { verificationResult?: string | null; refusedBeforeWrite?: boolean | null; trace?: string[] | null } = {},
): Promise<void> {
  await db.execute(sql`
    UPDATE rate_push_operations
       SET status               = ${STATUS_FOR_VERDICT[result.verdict]},
           attempts             = ${result.attempts},
           message              = ${result.message},
           push_method          = ${result.method ?? null},
           i_rate               = ${result.iRate ?? null},
           verification_result  = ${extra.verificationResult ?? null},
           refused_before_write = ${extra.refusedBeforeWrite ?? null},
           -- The push's own account. Stored even on failure — especially on failure.
           trace                = ${extra.trace && extra.trace.length ? JSON.stringify(extra.trace) : null}::jsonb,
           completed_at         = NOW()
     WHERE job_id = ${jobId} AND operation_key = ${result.operationKey}`);
}

/** The parent's status, computed from the rows every time it is asked for. */
export async function deriveJobStatus(db: OperationQueryable, jobId: string): Promise<JobSummary> {
  const counted = rows(await db.execute(sql`
    SELECT status, COUNT(*)::int AS n
      FROM rate_push_operations
     WHERE job_id = ${jobId}
     GROUP BY status`));

  const counts: OperationCounts = {
    pending: 0, running: 0, succeeded: 0, failed: 0, indeterminate: 0, not_attempted: 0, total: 0,
  };
  for (const r of counted) {
    const key = String(r.status) as OperationStatus;
    if (key in counts) (counts as any)[key] = num(r.n);
    counts.total += num(r.n);
  }

  // Only operations nobody has SETTLED. An operator who read the tariff and recorded what they
  // found has done the review, so it no longer needs doing — even though `status` still says
  // indeterminate, because that remains the historical fact. This filter and the one in
  // tariffHasUnresolvedOperations must agree: if a later blocking policy were built on this list
  // while it ignored resolutions, a resolved tariff would stay blocked forever, which is the exact
  // stranding the resolution workflow exists to prevent.
  const unknown = rows(await db.execute(sql`
    SELECT DISTINCT i_tariff
      FROM rate_push_operations
     WHERE job_id = ${jobId}
       AND status = 'indeterminate'
       AND resolution IS NULL
       AND i_tariff IS NOT NULL
     ORDER BY i_tariff`));
  const tariffsNeedingReview = unknown.map(r => num(r.i_tariff));

  const [{ n: unresolvedCount }] = rows(await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM rate_push_operations
     WHERE job_id = ${jobId} AND status = 'indeterminate' AND resolution IS NULL`));

  let status: JobStatus;
  if (counts.total === 0)                             status = 'pending';
  else if (counts.pending > 0 || counts.running > 0)  status = 'processing';
  // Ranked by what a person must do, so an unestablished outcome is never averaged into
  // "partial" and never reported as "failed" — which is precisely what job #43 did.
  else if (counts.indeterminate > 0)                  status = 'needs_review';
  else if (counts.succeeded === counts.total)         status = 'completed';
  else if (counts.succeeded > 0)                      status = 'partial';
  else                                                status = 'failed';

  // `status` deliberately stays historical: a job whose outcomes could not be established reports
  // needs_review forever, because that is what happened. `requiresReview` is the ACTIONABLE signal
  // and answers a different question — is there anything left for a person to do right now.
  return { status, counts, tariffsNeedingReview, requiresReview: num(unresolvedCount) > 0, unresolvedCount: num(unresolvedCount) };
}

export interface RecoveryReport {
  /** Interrupted mid-operation; their outcome was never established. */
  reclassified: Array<{ operationKey: string; iTariff: number | null }>;
  /** Halted because their tariff now holds an unestablished outcome. */
  halted: Array<{ operationKey: string; iTariff: number | null }>;
  /** Never started, in tariffs nothing is unknown about. Still resumable; untouched here. */
  resumable: number;
}

/**
 * Applies the restart rules above. Call on startup, or before reading a job that may have been
 * interrupted. Reclassifies and reports; never resumes, retries, or contacts Sippy.
 */
export async function reconcileInterruptedOperations(
  db: OperationQueryable, jobId: string,
): Promise<RecoveryReport> {
  // 1. A running row is an unestablished outcome, not a failure.
  const reclassified = rows(await db.execute(sql`
    UPDATE rate_push_operations
       SET status       = 'indeterminate',
           completed_at = NOW(),
           message      = COALESCE(message || ' ', '') ||
                          '[recovery] Execution was interrupted while this operation was in flight, so its outcome was never established. The write may have reached Sippy. Read the tariff before writing to it again; this operation will not be retried automatically.'
     WHERE job_id = ${jobId} AND status = 'running'
     RETURNING operation_key, i_tariff`));

  // 2. The live lane-halt rule, applied to a crash: a tariff whose state is unknown takes no
  //    further writes. Only tariffs, never the whole job — other lanes are separate locks.
  const halted = rows(await db.execute(sql`
    UPDATE rate_push_operations AS o
       SET status       = 'not_attempted',
           completed_at = NOW(),
           message      = '[recovery] Not attempted: tariff ' || o.i_tariff::text ||
                          ' holds an operation whose outcome was never established, so no further write to it is safe until that is resolved by reading the tariff.'
     WHERE o.job_id = ${jobId}
       AND o.status  = 'pending'
       AND o.i_tariff IS NOT NULL
       AND EXISTS (SELECT 1 FROM rate_push_operations u
                    WHERE u.job_id = o.job_id AND u.i_tariff = o.i_tariff
                      AND u.status = 'indeterminate')
     RETURNING o.operation_key, o.i_tariff`));

  // 3. What is left is genuinely untouched work.
  const [rest] = rows(await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM rate_push_operations
     WHERE job_id = ${jobId} AND status = 'pending'`));

  return {
    reclassified: reclassified.map(r => ({ operationKey: String(r.operation_key), iTariff: r.i_tariff === null ? null : num(r.i_tariff) })),
    halted:       halted.map(r => ({ operationKey: String(r.operation_key), iTariff: r.i_tariff === null ? null : num(r.i_tariff) })),
    resumable:    num(rest?.n),
  };
}

// ── Reading it back ──────────────────────────────────────────────────────────

/** One operation as an operator needs to see it: what was asked, what happened, and when. */
export interface OperationRecord {
  operationKey: string;
  sequence: number;
  lanePosition: number | null;
  accountName: string;
  iAccount: number | null;
  iTariff: number | null;
  productName: string | null;
  trunkPrefix: string | null;
  dialPrefix: string | null;
  fullPrefix: string;
  destinationName: string | null;
  requestedRate: number | null;
  interval1: number | null;
  intervalN: number | null;
  effectiveFrom: string | null;
  effectiveTill: string | null;
  status: OperationStatus;
  attempts: number;
  iRate: number | null;
  pushMethod: string | null;
  verificationResult: string | null;
  /** null means nobody established whether a mutating request was sent. NOT the same as false. */
  refusedBeforeWrite: boolean | null;
  message: string | null;
  createdAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  /** 'not_applied' | 'applied' | null. Beside `status`, never replacing it. */
  resolution: OperationResolution | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  observedState: string | null;
  /** The push's own account of what it did. Null means the row predates the column. */
  trace: string[] | null;
}

/**
 * Every operation of a job, in submission order, with the parent status derived from them.
 *
 * Read-only, and it exists because the rows were being written and never shown. During the
 * 2026-09-09 acceptance the per-operation status and `refused_before_write` were asked for and
 * could not be produced without opening Postgres by hand — durable state that no one can read is
 * only half of the recovery model.
 */
export async function getJobOperations(
  db: OperationQueryable,
  jobId: string,
): Promise<{ jobId: string; operations: OperationRecord[]; summary: JobSummary }> {
  const raw = rows(await db.execute(sql`
    SELECT operation_key, sequence, lane_position, account_name, i_account, i_tariff,
           product_name, trunk_prefix, dial_prefix, full_prefix, destination_name,
           requested_rate, interval_1, interval_n, effective_from, effective_till,
           status, attempts, i_rate, push_method, verification_result, refused_before_write,
           message, created_at, started_at, completed_at,
           resolution, resolved_by, resolved_at, resolution_note, observed_state, trace
      FROM rate_push_operations
     WHERE job_id = ${jobId}
     ORDER BY sequence`));

  const asNum = (v: any): number | null => (v === null || v === undefined ? null : Number(v));
  const asStr = (v: any): string | null => (v === null || v === undefined ? null : String(v));

  const operations: OperationRecord[] = raw.map((r: any) => ({
    operationKey:       String(r.operation_key),
    sequence:           num(r.sequence),
    lanePosition:       asNum(r.lane_position),
    accountName:        String(r.account_name),
    iAccount:           asNum(r.i_account),
    iTariff:            asNum(r.i_tariff),
    productName:        asStr(r.product_name),
    trunkPrefix:        asStr(r.trunk_prefix),
    dialPrefix:         asStr(r.dial_prefix),
    fullPrefix:         String(r.full_prefix),
    destinationName:    asStr(r.destination_name),
    requestedRate:      asNum(r.requested_rate),
    interval1:          asNum(r.interval_1),
    intervalN:          asNum(r.interval_n),
    effectiveFrom:      asStr(r.effective_from),
    effectiveTill:      asStr(r.effective_till),
    status:             String(r.status) as OperationStatus,
    attempts:           num(r.attempts),
    iRate:              asNum(r.i_rate),
    pushMethod:         asStr(r.push_method),
    verificationResult: asStr(r.verification_result),
    // Preserved as a tri-state: false and null mean different things and must not collapse.
    refusedBeforeWrite: r.refused_before_write === null || r.refused_before_write === undefined
                          ? null : Boolean(r.refused_before_write),
    message:            asStr(r.message),
    createdAt:          asStr(r.created_at),
    startedAt:          asStr(r.started_at),
    completedAt:        asStr(r.completed_at),
    resolution:         (asStr(r.resolution) as OperationResolution | null),
    resolvedBy:         asStr(r.resolved_by),
    resolvedAt:         asStr(r.resolved_at),
    resolutionNote:     asStr(r.resolution_note),
    observedState:      asStr(r.observed_state),
    // jsonb comes back parsed from node-postgres and as text from some drivers; accept both.
    trace:              r.trace === null || r.trace === undefined ? null
                          : (Array.isArray(r.trace) ? r.trace.map(String)
                            : (() => { try { const v = JSON.parse(String(r.trace)); return Array.isArray(v) ? v.map(String) : null; } catch { return null; } })()),
  }));

  return { jobId, operations, summary: await deriveJobStatus(db, jobId) };
}

// ── Operator resolution of an unknown outcome ────────────────────────────────

export type OperationResolution = 'not_applied' | 'applied';

/** The DB enforces this too; checking here lets the caller get a usable message. */
export const MIN_RESOLUTION_NOTE = 10;

export type ResolveOutcome =
  | { ok: true;  operation: OperationRecord }
  | { ok: false; code: 'not_found' | 'not_indeterminate' | 'already_resolved' | 'note_too_short'; message: string };

/**
 * Records what a person found when they read Sippy for an operation whose outcome was never
 * established.
 *
 * `status` is NOT touched. The operation remains `indeterminate` because that is what was true at
 * the time, and erasing it would erase the evidence that the system was once unable to tell. The
 * resolution sits beside it as a later, attributable fact.
 *
 * This writes to OUR database only. It never contacts Sippy and never re-runs the operation — the
 * operator has already looked, and an automatic retry of a possible mutation is the exact thing the
 * whole engine refuses to do.
 */
export async function resolveOperation(
  db: OperationQueryable,
  jobId: string,
  operationKey: string,
  input: { resolution: OperationResolution; resolvedBy: string; note: string; observedState?: string | null },
): Promise<ResolveOutcome> {
  const note = String(input.note ?? '').trim();
  if (note.length < MIN_RESOLUTION_NOTE) {
    return {
      ok: false, code: 'note_too_short',
      message: `A resolution needs a note of at least ${MIN_RESOLUTION_NOTE} characters saying what was found in Sippy. Resolving without reading the tariff is the one thing this workflow exists to prevent.`,
    };
  }

  const [existing] = rows(await db.execute(sql`
    SELECT status, resolution, resolved_by, i_tariff
      FROM rate_push_operations
     WHERE job_id = ${jobId} AND operation_key = ${operationKey}`));

  if (!existing) {
    return { ok: false, code: 'not_found', message: `No operation ${operationKey} on job ${jobId}.` };
  }
  if (String(existing.status) !== 'indeterminate') {
    return {
      ok: false, code: 'not_indeterminate',
      message: `Operation ${operationKey} is '${existing.status}', not 'indeterminate'. Only an outcome nobody could establish is open to resolution; an established one is already the record.`,
    };
  }
  if (existing.resolution !== null && existing.resolution !== undefined) {
    return {
      ok: false, code: 'already_resolved',
      message: `Operation ${operationKey} was already resolved as '${existing.resolution}' by ${existing.resolved_by ?? 'unknown'}. Re-resolving would overwrite one person's finding with another's; record a new observation instead.`,
    };
  }

  await db.execute(sql`
    UPDATE rate_push_operations
       SET resolution      = ${input.resolution},
           resolved_by     = ${input.resolvedBy},
           resolved_at     = NOW(),
           resolution_note = ${note},
           observed_state  = ${input.observedState ?? null}
     WHERE job_id = ${jobId} AND operation_key = ${operationKey}`);

  const { operations } = await getJobOperations(db, jobId);
  const operation = operations.find(o => o.operationKey === operationKey)!;
  return { ok: true, operation };
}

/**
 * Every operation still awaiting a person, newest first. This is what an operator opens to find the
 * work, and what the tariff-blocking predicate will consult once that policy is turned on.
 */
export async function listUnresolvedOperations(
  db: OperationQueryable,
  opts: { iTariff?: number } = {},
): Promise<Array<{ jobId: string; operationKey: string; iTariff: number | null; fullPrefix: string; accountName: string; message: string | null; completedAt: string | null }>> {
  const res = await db.execute(
    opts.iTariff === undefined
      ? sql`SELECT job_id, operation_key, i_tariff, full_prefix, account_name, message, completed_at
              FROM rate_push_operations
             WHERE status = 'indeterminate' AND resolution IS NULL
             ORDER BY id DESC`
      : sql`SELECT job_id, operation_key, i_tariff, full_prefix, account_name, message, completed_at
              FROM rate_push_operations
             WHERE status = 'indeterminate' AND resolution IS NULL AND i_tariff = ${opts.iTariff}
             ORDER BY id DESC`);
  return rows(res).map((r: any) => ({
    jobId: String(r.job_id), operationKey: String(r.operation_key),
    iTariff: r.i_tariff === null ? null : num(r.i_tariff),
    fullPrefix: String(r.full_prefix), accountName: String(r.account_name),
    message: r.message === null ? null : String(r.message),
    completedAt: r.completed_at === null ? null : String(r.completed_at),
  }));
}

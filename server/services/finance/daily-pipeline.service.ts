/**
 * daily-pipeline.service.ts
 *
 * The nightly finance pipeline: one run per business day, recorded in
 * finance_pipeline_runs.
 *
 * Stages RUN in this order — dmr, snapshot, dmr-email, margin, assurance,
 * billing-cycles — but they do not DEPEND on it. Execution order and the
 * dependency graph are different things, and conflating them is how an
 * advisory scan ends up blocking billing. The real graph is a star: every
 * middle stage reads daily_minutes_reports, so all four depend on `dmr` and on
 * nothing else, while billing-cycles depends on nothing at all. It is declared
 * once, from what each stage actually reads, in STAGE_PREREQUISITES.
 *
 * It STOPS at job creation. Approval and dispatch stay operator-triggered:
 * both are outward-facing (a dispatched invoice emails a real customer) and
 * automating them would remove the only human checkpoint in billing.
 *
 * ── Why catch-up scheduling, not a daily timer ───────────────────────────────
 * materialization_runs shows the deployed process restarting frequently and
 * sleeping for hours at a time — 24 Aug 19:02 to 25 Aug 08:34 is one gap, and
 * it swallows 07:00 UTC. A setTimeout 24 hours out only fires if the process
 * survives 24 hours, which this one does not. So the scheduler here holds no
 * long timer at all: it wakes every few minutes and asks the ledger whether
 * today's run is done. Whenever the process happens to be alive after the
 * scheduled hour, the run happens. This is the same mechanism that has kept
 * the reconciliation report schedules sending (nextDueAt < now) while the
 * DMR email's 24-hour timer went unnoticed for weeks.
 *
 * A consequence worth stating: the pipeline may run LATE, but it will not be
 * skipped. Lateness is recorded (started_at vs target_date) rather than hidden.
 *
 * Entry points:
 *   runDailyFinancePipeline(opts)   — execute one run; safe to call directly
 *   startFinancePipelineScheduler() — catch-up loop; call once on boot
 *   listPipelineRuns(limit)         — ledger read for the Finance Automation UI
 *   getPipelineStatus()             — per-stage last outcome + next due
 */

import { db } from '../../db';
import { sql } from 'drizzle-orm';
import { storage } from '../../storage';
import {
  decideDue, defaultTargetDate, blockedBy,
  DEFAULT_SCHEDULED_HOUR_UTC, DEFAULT_MAX_ATTEMPTS, DEFAULT_STALE_RUNNING_MS,
  type AttemptRow, type DueDecision, type StageName,
} from '../../finance-pipeline-schedule';

export { decideDue, defaultTargetDate, blockedBy, type AttemptRow, type DueDecision, type StageName };

// ── Configuration ─────────────────────────────────────────────────────────────

/** Hour (UTC) after which a business day is ready to process — see the
 *  reasoning on DEFAULT_SCHEDULED_HOUR_UTC. Override per instance. */
const SCHEDULED_HOUR_UTC = (() => {
  const raw = Number(process.env.FINANCE_PIPELINE_HOUR_UTC);
  return Number.isInteger(raw) && raw >= 0 && raw <= 23 ? raw : DEFAULT_SCHEDULED_HOUR_UTC;
})();

/** How often the catch-up loop asks the ledger whether today's run is done. */
const CHECK_INTERVAL_MS = 10 * 60 * 1000;

/** Delay before the first check, so the app finishes booting first. */
const FIRST_CHECK_DELAY_MS = 3 * 60 * 1000;

/**
 * Attempts per business date before the scheduler gives up.
 *
 * Without this a permanently failing stage would retry every 10 minutes
 * forever. Three attempts covers a transient Sippy outage; beyond that the
 * failure is structural and wants a human, not another retry.
 */
const MAX_ATTEMPTS_PER_DATE = DEFAULT_MAX_ATTEMPTS;

/** A 'running' row older than this belonged to a process that died mid-run. */
const STALE_RUNNING_MS = DEFAULT_STALE_RUNNING_MS;

/** Distinct from the snapshot service's 42001 — these must not block each other. */
const ADVISORY_LOCK_KEY = 42002;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StageOutcome {
  stage:      StageName;
  status:     'success' | 'failed' | 'skipped';
  durationMs: number;
  /** One human-readable line: what this stage actually did. */
  detail?:    string;
  error?:     string;
}

export interface PipelineRunResult {
  runId:      number | null;
  targetDate: string;
  status:     'success' | 'partial' | 'failed' | 'skipped';
  stages:     StageOutcome[];
  durationMs: number;
  error?:     string;
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function isIsoDate(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v);
}

// ── Stage runner ──────────────────────────────────────────────────────────────

/**
 * Runs one stage, unless something it depends on has failed.
 *
 * Failure is contained rather than propagated: a stage only skips when a
 * prerequisite it genuinely READS has failed (see STAGE_PREREQUISITES, which
 * is a star around `dmr`, not a chain). A failed margin computation is not a
 * reason to skip billing-cycle detection — they read different data, and a
 * fault in one says nothing about the other.
 *
 * A blocked stage is recorded as 'skipped' NAMING its blocker, so the ledger
 * distinguishes "did not run because DMR failed" from "ran and failed" and
 * from "had nothing to do". Those three look identical in a log line and want
 * three different responses.
 */
async function runStage(
  stage: StageName,
  completed: StageOutcome[],
  fn: () => Promise<{ detail?: string; skipped?: boolean }>,
): Promise<StageOutcome> {
  const blocker = blockedBy(stage, completed);
  if (blocker) {
    console.warn(`[finance-pipeline] ${stage}: skipped — prerequisite '${blocker}' failed`);
    return { stage, status: 'skipped', durationMs: 0, detail: `blocked by failed '${blocker}'` };
  }

  const t0 = Date.now();
  try {
    const r = await fn();
    const outcome: StageOutcome = {
      stage,
      status:     r.skipped ? 'skipped' : 'success',
      durationMs: Date.now() - t0,
      ...(r.detail ? { detail: r.detail } : {}),
    };
    console.log(`[finance-pipeline] ${stage}: ${outcome.status}${r.detail ? ` — ${r.detail}` : ''} (${outcome.durationMs}ms)`);
    return outcome;
  } catch (e: any) {
    const message = e?.message ?? String(e);
    console.warn(`[finance-pipeline] ${stage}: FAILED — ${message}`);
    return { stage, status: 'failed', durationMs: Date.now() - t0, error: message };
  }
}

// ── Sippy config ──────────────────────────────────────────────────────────────

async function sippyConfig(): Promise<{
  portalUrl: string; username: string; password: string; adminWebPassword: string;
} | null> {
  const s = await storage.getSippySettings();
  if (!s?.portalUrl) return null;
  return {
    portalUrl:        s.portalUrl,
    username:         s.portalUsername  ?? s.apiAdminUsername ?? '',
    password:         s.portalPassword  ?? s.apiAdminPassword ?? '',
    adminWebPassword: s.adminWebPassword ?? '',
  };
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function runDailyFinancePipeline(opts: {
  targetDate?:  string;
  triggeredBy?: 'scheduler' | 'api' | 'manual';
  /** Skip the outbound email — for re-running the computation stages safely. */
  skipEmail?:   boolean;
} = {}): Promise<PipelineRunResult> {

  const targetDate  = opts.targetDate && isIsoDate(opts.targetDate)
    ? opts.targetDate
    : defaultTargetDate();
  const triggeredBy = opts.triggeredBy ?? 'manual';
  const t0 = Date.now();

  // One run at a time across every instance. A second instance that wakes up
  // mid-run must not start the same business date again.
  const lockRes = await db.execute(sql.raw(`SELECT pg_try_advisory_lock(${ADVISORY_LOCK_KEY}) AS locked`));
  if (!((lockRes as any).rows?.[0]?.locked ?? false)) {
    console.log('[finance-pipeline] another run holds the lock — skipping');
    return { runId: null, targetDate, status: 'skipped', stages: [], durationMs: Date.now() - t0 };
  }

  let runId: number | null = null;
  const stages: StageOutcome[] = [];

  try {
    const ins = await db.execute(sql`
      INSERT INTO finance_pipeline_runs (target_date, status, triggered_by)
      VALUES (${targetDate}::date, 'running', ${triggeredBy})
      RETURNING id
    `);
    runId = Number((ins as any).rows?.[0]?.id);
    console.log(`[finance-pipeline] run #${runId} started — target ${targetDate}, by ${triggeredBy}`);

    // ── 1. DMR ────────────────────────────────────────────────────────────────
    // First, because everything downstream reads daily_minutes_reports. The
    // user-facing pipeline diagram put snapshot first; that order cannot work,
    // since materialization transforms DMR rows that would not exist yet.
    stages.push(await runStage('dmr', stages, async () => {
      const existing = await storage.listDMRReports({ reportDate: targetDate, latestVersionOnly: true });
      if (existing.length > 0) {
        return { skipped: true, detail: `${existing.length} row(s) already present for ${targetDate}` };
      }
      const config = await sippyConfig();
      if (!config) throw new Error('Sippy portal settings are not configured');
      const { generateDMR } = await import('../sippy/index');
      const r = await generateDMR(config, new Date(`${targetDate}T00:00:00Z`), {
        notes: 'Auto-generated by daily finance pipeline',
      });
      if (r.errors?.length) console.warn(`[finance-pipeline] dmr warnings: ${r.errors.join('; ')}`);
      return { detail: `${r.rowsInserted} rows — matched=${r.matched} drifted=${r.drifted} critical=${r.critical}` };
    }));

    // ── 2. Snapshot materialization ───────────────────────────────────────────
    stages.push(await runStage('snapshot', stages, async () => {
      const { runMaterialization } = await import('../sippy/index');
      const r = await runMaterialization('scheduler', [targetDate]);
      if (r.status !== 'success') throw new Error(r.error ?? 'materialization reported failure');
      return { detail: `${r.rowsWritten} rows, ${r.clientsProcessed} clients, ${r.vendorsProcessed} vendors` };
    }));

    // ── 3. DMR email ──────────────────────────────────────────────────────────
    // The only outbound step in the pipeline, and the only one whose result was
    // previously invisible once logs rolled. Recipients are recorded here.
    stages.push(await runStage('dmr-email', stages, async () => {
      if (opts.skipEmail) return { skipped: true, detail: 'skipEmail requested' };
      const { scheduledDispatchAllowed, alertEmailConfigured } = await import('../../email');
      if (!scheduledDispatchAllowed()) {
        return { skipped: true, detail: 'scheduled dispatch disabled on this instance (FP-03)' };
      }
      // Not configured is a SKIP, not a failure. The first production run
      // proved why: with no alert transport set up, this stage failed, which
      // made the whole run 'partial', which made the date look retryable — so
      // the scheduler would re-run snapshot, margin and assurance every ten
      // minutes, burn all three attempts on a condition no retry can change,
      // and end at "needs investigation" though everything but the email had
      // succeeded. Absent configuration is not a transient fault.
      if (!(await alertEmailConfigured())) {
        return { skipped: true, detail: 'alert email transport not configured — set it up in Settings' };
      }
      const { sendDailyDMREmail } = await import('../email/dmr-email.service');
      const r = await sendDailyDMREmail({ date: targetDate });
      if (!r.ok) throw new Error(r.error ?? 'send reported failure');
      return { detail: `${r.rowCount} rows to ${r.recipients.length} recipient(s): ${r.recipients.join(', ')}` };
    }));

    // ── 4. Margin ─────────────────────────────────────────────────────────────
    stages.push(await runStage('margin', stages, async () => {
      const { materializeMargin } = await import('../sippy/index');
      const r = await materializeMargin(new Date(`${targetDate}T00:00:00Z`));
      if (r.errors?.length) console.warn(`[finance-pipeline] margin warnings: ${r.errors.join('; ')}`);
      // aggregateMargin is `totalSell - totalBuy` — a USD AMOUNT, not a ratio.
      // The first production run printed "margin 862.01%" because this
      // multiplied $8.62 by 100 and called it a percentage. The field name
      // reads like a rate; it is not one.
      const margin = r.aggregateMargin != null ? `$${r.aggregateMargin.toFixed(2)}` : 'n/a';
      return { detail: `${r.clientRows} client / ${r.vendorRows} vendor rows, margin ${margin}, ${r.alertsGenerated} alert(s)` };
    }));

    // ── 5. AI assurance ───────────────────────────────────────────────────────
    // Runs after margin, but does NOT depend on it — an earlier version of
    // this comment claimed detectMarginCollapse reads what margin wrote. It
    // does not: all five detectors read DMR reports, invoices, reconciliation
    // records and credit notes. Hence prerequisite 'dmr', not 'margin'.
    // Advisory by design, so nothing downstream waits on it either.
    stages.push(await runStage('assurance', stages, async () => {
      const { runFullScan } = await import('../sippy/index');
      const r = await runFullScan('pipeline');
      return { detail: `scan #${r.scanRunId}: ${r.totalAlerts} alert(s) from ${r.detectorResults.length} detector(s)` };
    }));

    // ── 6. Billing cycle detection ────────────────────────────────────────────
    // The pipeline's last act. It CREATES invoice jobs in Pending; it does not
    // generate, approve, or send anything.
    stages.push(await runStage('billing-cycles', stages, async () => {
      const { detectBillingCycles } = await import('../sippy/index');
      const r = await detectBillingCycles();
      return { detail: `${r.created} job(s) created, ${r.skipped} skipped${r.detected.length ? ` — ${r.detected.join(', ')}` : ''}` };
    }));

    // ── Outcome ───────────────────────────────────────────────────────────────
    const failed    = stages.filter(s => s.status === 'failed');
    const succeeded = stages.filter(s => s.status === 'success');
    const status: PipelineRunResult['status'] =
      failed.length === 0            ? 'success'
      : succeeded.length > 0         ? 'partial'
      :                                'failed';
    const durationMs = Date.now() - t0;

    await db.execute(sql`
      UPDATE finance_pipeline_runs
         SET completed_at = now(),
             status       = ${status},
             stages       = ${JSON.stringify(stages)}::jsonb,
             duration_ms  = ${durationMs},
             error        = ${failed.length ? failed.map(f => `${f.stage}: ${f.error}`).join(' | ') : null}
       WHERE id = ${runId}
    `);

    console.log(`[finance-pipeline] run #${runId} ${status} — ${succeeded.length}/${stages.length} stages ok, ${durationMs}ms`);
    return {
      runId, targetDate, status, stages, durationMs,
      ...(failed.length ? { error: failed.map(f => `${f.stage}: ${f.error}`).join(' | ') } : {}),
    };

  } catch (e: any) {
    // Reaching here means the harness itself failed, not a stage — the stage
    // runner absorbs stage errors. Record it so the row never stays 'running'.
    const message = e?.message ?? String(e);
    console.error(`[finance-pipeline] run #${runId} aborted: ${message}`);
    if (runId) {
      await db.execute(sql`
        UPDATE finance_pipeline_runs
           SET completed_at = now(), status = 'failed',
               stages = ${JSON.stringify(stages)}::jsonb,
               duration_ms = ${Date.now() - t0}, error = ${message}
         WHERE id = ${runId}
      `).catch(() => {});
    }
    return { runId, targetDate, status: 'failed', stages, durationMs: Date.now() - t0, error: message };

  } finally {
    await db.execute(sql.raw(`SELECT pg_advisory_unlock(${ADVISORY_LOCK_KEY})`)).catch(() => {});
  }
}

// ── Due check ─────────────────────────────────────────────────────────────────

/**
 * Whether the pipeline should run right now, decided entirely from the ledger.
 *
 * Exported because the Finance Automation UI shows the same answer, and two
 * implementations of "is it due" would drift apart. The rule itself lives in
 * finance-pipeline-schedule.ts, where it can be tested without a database.
 */
export async function isPipelineDue(now = new Date()): Promise<DueDecision> {
  const targetDate = defaultTargetDate(now);

  // Cheap guard before touching the database: for most of the day the answer
  // is "not yet", and this runs every ten minutes.
  if (now.getUTCHours() < SCHEDULED_HOUR_UTC) {
    return decideDue([], now, { scheduledHourUtc: SCHEDULED_HOUR_UTC });
  }

  const res = await db.execute(sql`
    SELECT id, status, started_at
      FROM finance_pipeline_runs
     WHERE target_date = ${targetDate}::date
     ORDER BY started_at DESC
  `);
  const rows = ((res as any).rows ?? []).map((r: any) => ({
    id: Number(r.id), status: String(r.status), startedAt: r.started_at,
  })) as AttemptRow[];

  return decideDue(rows, now, {
    scheduledHourUtc: SCHEDULED_HOUR_UTC,
    maxAttempts:      MAX_ATTEMPTS_PER_DATE,
    staleRunningMs:   STALE_RUNNING_MS,
  });
}

// ── Catch-up scheduler ────────────────────────────────────────────────────────

let _schedulerStarted = false;
let _busy = false;
/** Suppresses repeating the same "not due" line every 10 minutes. */
let _lastSkipReason = '';

/**
 * Starts the catch-up loop. Idempotent — a second call is ignored.
 *
 * Holds no timer longer than CHECK_INTERVAL_MS by design: see the note at the
 * top of this file about the deployed process's uptime.
 */
export function startFinancePipelineScheduler(): void {
  if (_schedulerStarted) return;
  _schedulerStarted = true;

  const tick = async () => {
    if (_busy) return;
    _busy = true;
    try {
      const decision = await isPipelineDue();
      if (!decision.due) {
        if (decision.reason !== _lastSkipReason) {
          console.log(`[finance-pipeline] not due (${decision.targetDate}): ${decision.reason}`);
          _lastSkipReason = decision.reason;
        }
        return;
      }
      _lastSkipReason = '';
      console.log(`[finance-pipeline] due for ${decision.targetDate}: ${decision.reason}`);
      await runDailyFinancePipeline({ targetDate: decision.targetDate, triggeredBy: 'scheduler' });
    } catch (e: any) {
      console.error('[finance-pipeline] scheduler tick error:', e?.message ?? e);
    } finally {
      _busy = false;
    }
  };

  setTimeout(() => { tick(); setInterval(tick, CHECK_INTERVAL_MS); }, FIRST_CHECK_DELAY_MS);
  console.log(
    `[finance-pipeline] catch-up scheduler registered — checks every ${CHECK_INTERVAL_MS / 60000} min, ` +
    `runs once per business day after ${String(SCHEDULED_HOUR_UTC).padStart(2, '0')}:00 UTC`,
  );
}

// ── Ledger reads ──────────────────────────────────────────────────────────────

export interface PipelineRunRow {
  id:          number;
  targetDate:  string;
  startedAt:   string;
  completedAt: string | null;
  status:      string;
  triggeredBy: string;
  stages:      StageOutcome[];
  durationMs:  number | null;
  error:       string | null;
}

export async function listPipelineRuns(limit = 30): Promise<PipelineRunRow[]> {
  const capped = Math.min(Math.max(Number(limit) || 30, 1), 200);
  const res = await db.execute(sql`
    SELECT id, target_date::text AS target_date, started_at, completed_at,
           status, triggered_by, stages, duration_ms, error
      FROM finance_pipeline_runs
     ORDER BY started_at DESC
     LIMIT ${capped}
  `);
  return ((res as any).rows ?? []).map((r: any) => ({
    id:          Number(r.id),
    targetDate:  r.target_date,
    startedAt:   r.started_at,
    completedAt: r.completed_at,
    status:      r.status,
    triggeredBy: r.triggered_by,
    stages:      Array.isArray(r.stages) ? r.stages : [],
    durationMs:  r.duration_ms != null ? Number(r.duration_ms) : null,
    error:       r.error,
  }));
}

export interface PipelineStatus {
  scheduledHourUtc: number;
  due:              DueDecision;
  lastRun:          PipelineRunRow | null;
  /** Most recent outcome per stage, across runs — what the dashboard shows. */
  stages: Array<StageOutcome & { targetDate: string; at: string }>;
}

/**
 * One call that answers "is finance automation healthy?" without reading logs
 * or querying tables by hand.
 */
export async function getPipelineStatus(): Promise<PipelineStatus> {
  const runs = await listPipelineRuns(30);
  const lastRun = runs[0] ?? null;

  const latestByStage = new Map<StageName, StageOutcome & { targetDate: string; at: string }>();
  for (const run of runs) {                 // newest first
    for (const s of run.stages) {
      if (!latestByStage.has(s.stage)) {
        latestByStage.set(s.stage, { ...s, targetDate: run.targetDate, at: run.startedAt });
      }
    }
  }

  const ORDER: StageName[] = ['dmr', 'snapshot', 'dmr-email', 'margin', 'assurance', 'billing-cycles'];
  return {
    scheduledHourUtc: SCHEDULED_HOUR_UTC,
    due:              await isPipelineDue(),
    lastRun,
    stages:           ORDER.map(n => latestByStage.get(n)).filter(Boolean) as PipelineStatus['stages'],
  };
}

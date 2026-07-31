/**
 * runner.ts — the provisioning orchestrator.
 *
 * Creates a run, seeds its steps, executes them in order, and persists each
 * outcome to provisioning_runs / provisioning_steps (migration 037).
 *
 * Design notes that are decisions, not defaults:
 *
 * • The runner knows NOTHING about Sippy. It executes ProvisioningStep objects.
 *   The Service Plan executor is currently blocked by the Sippy deployment; that
 *   is invisible here and stays that way when it is unblocked.
 *
 * • `blocking` is read from the DATABASE row, not from the step definition. The
 *   definition only seeds it. So the service_plan step can be promoted to
 *   blocking with a single UPDATE once Sippy permits creation — no code change,
 *   no redeploy, and no re-ordering of a production-tested pipeline.
 *
 * • A non-blocking failure does not fail the run; it lands it in
 *   'completed_with_warnings'. That state exists precisely so "account
 *   provisioned, service plan pending" is representable as a first-class
 *   outcome rather than an ambiguous success or a misleading failure.
 *
 * • Steps are resumable and individually retryable: results of prior steps are
 *   reloaded from the DB, so retrying step N never re-executes steps 1..N-1 and
 *   never creates duplicate Sippy objects.
 *
 * • rollback() is intentionally NOT invoked automatically. Deleting live Sippy
 *   objects on a partial failure is destructive and hurts troubleshooting;
 *   deactivate-then-archive is the platform's stated preference. Executors may
 *   declare rollback; calling it remains an explicit, separate decision.
 */
import { db } from "../../db";
import { provisioningRuns, provisioningSteps } from "../../../shared/schema";
import { eq, and, asc } from "drizzle-orm";
import { storage } from "../../storage";
import type { ProvisioningStep, StepContext, ProvisioningInput } from "./types";

type SippySettings = Awaited<ReturnType<typeof storage.getSippySettings>>;

/** Credential resolution, matching the pattern used elsewhere in the codebase
 *  (see services/route-tester.ts). Kept local so the provisioning subsystem does
 *  not depend on routes.ts internals. */
function resolveSippy(s: NonNullable<SippySettings>): StepContext['sippy'] {
  const any = s as any;
  return {
    username:   any.apiAdminUsername || any.portalUsername || '',
    password:   any.apiAdminPassword || any.portalPassword || '',
    portalUrl:  (any.portalUrl as string | undefined) || 'https://191.101.30.107',
    adminUser:  any.apiAdminUsername || any.portalUsername || '',
    adminPass:  any.apiAdminPassword || any.portalPassword || '',
    portalUser: any.portalUsername || '',
    portalPass: any.portalPassword || '',
    adminWebPassword: any.adminWebPassword || undefined,
  };
}

function newRunRef(): string {
  const d = new Date();
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  return `PROV-${ymd}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

/** Create a run and seed one row per step. Returns the run id. */
export async function createRun(opts: {
  companyId: number;
  input:     ProvisioningInput;
  steps:     ProvisioningStep[];
  actor:     string;
  profileId?: number | null;
}): Promise<{ runId: number; runRef: string }> {
  const runRef = newRunRef();
  const [run] = await db.insert(provisioningRuns).values({
    runRef,
    companyId: opts.companyId,
    profileId: opts.profileId ?? null,
    status:    'pending',
    input:     JSON.stringify(opts.input),
    createdBy: opts.actor,
  }).returning();

  const ordered = [...opts.steps].sort((a, b) => a.order - b.order);
  await db.insert(provisioningSteps).values(
    ordered.map(s => ({
      runId:     run.id,
      stepKey:   s.key,
      stepOrder: s.order,
      label:     s.label,
      status:    'pending' as const,
      blocking:  s.blocking, // seed only — the DB row is authoritative from here
    })),
  );

  console.log(`[provisioning] ${runRef} created — company=${opts.companyId} steps=${ordered.length}`);
  return { runId: run.id, runRef };
}

/** Rebuild the results map from previously-succeeded steps so retries and
 *  resumes see the identifiers earlier steps produced. */
async function loadPriorResults(runId: number): Promise<Record<string, Record<string, unknown>>> {
  const rows = await db.select().from(provisioningSteps)
    .where(and(eq(provisioningSteps.runId, runId), eq(provisioningSteps.status, 'success')));
  const out: Record<string, Record<string, unknown>> = {};
  for (const r of rows) {
    if (!r.result) continue;
    try { out[r.stepKey] = JSON.parse(r.result); } catch { /* ignore malformed */ }
  }
  return out;
}

/**
 * Execute a run. `only` restricts execution to a single step key (retry).
 * Safe to call repeatedly: steps already in 'success' are skipped.
 */
export async function executeRun(
  runId: number,
  registry: ProvisioningStep[],
  opts: { only?: string; actor?: string } = {},
): Promise<{ status: string; steps: Array<{ key: string; status: string; error?: string }> }> {
  const [run] = await db.select().from(provisioningRuns).where(eq(provisioningRuns.id, runId));
  if (!run) throw new Error(`provisioning run ${runId} not found`);

  const settings = await storage.getSippySettings();
  if (!settings) throw new Error('Sippy settings are not configured.');

  const input: ProvisioningInput = run.input ? JSON.parse(run.input) : ({} as ProvisioningInput);
  const ctx: StepContext = {
    runId,
    companyId: run.companyId,
    input,
    results:   await loadPriorResults(runId),
    actor:     opts.actor ?? run.createdBy ?? 'system',
    sippy:     resolveSippy(settings),
  };

  await db.update(provisioningRuns)
    .set({ status: 'running', startedAt: run.startedAt ?? new Date() })
    .where(eq(provisioningRuns.id, runId));

  const stepRows = await db.select().from(provisioningSteps)
    .where(eq(provisioningSteps.runId, runId))
    .orderBy(asc(provisioningSteps.stepOrder));

  const summary: Array<{ key: string; status: string; error?: string }> = [];
  let halted = false;
  let sawNonBlockingFailure = false;

  for (const row of stepRows) {
    if (opts.only && row.stepKey !== opts.only) {
      summary.push({ key: row.stepKey, status: row.status });
      if (row.status === 'failed' && row.blocking) halted = true;
      if (row.status === 'failed' && !row.blocking) sawNonBlockingFailure = true;
      continue;
    }
    if (row.status === 'success') { summary.push({ key: row.stepKey, status: 'success' }); continue; }
    if (halted)                   { summary.push({ key: row.stepKey, status: 'skipped' }); continue; }

    const def = registry.find(s => s.key === row.stepKey);
    if (!def) {
      // A step row with no executor — misconfiguration, not a Sippy problem.
      await db.update(provisioningSteps).set({
        status: 'failed', error: `No executor registered for step "${row.stepKey}"`,
        reasonCode: 'NO_EXECUTOR', completedAt: new Date(),
      }).where(eq(provisioningSteps.id, row.id));
      summary.push({ key: row.stepKey, status: 'failed', error: 'no executor' });
      if (row.blocking) halted = true;
      continue;
    }

    await db.update(provisioningSteps)
      .set({ status: 'running', startedAt: new Date(), attempt: (row.attempt ?? 0) + 1 })
      .where(eq(provisioningSteps.id, row.id));
    await db.update(provisioningRuns).set({ currentStep: row.stepKey }).where(eq(provisioningRuns.id, runId));

    try {
      const gate = def.validate ? await def.validate(ctx) : null;
      if (gate) {
        await db.update(provisioningSteps).set({
          status: 'failed', error: gate, reasonCode: 'VALIDATION_FAILED', completedAt: new Date(),
        }).where(eq(provisioningSteps.id, row.id));
        summary.push({ key: row.stepKey, status: 'failed', error: gate });
        if (row.blocking) halted = true; else sawNonBlockingFailure = true;
        continue;
      }

      let outcome = await def.execute(ctx);

      // ── Read-back verification ────────────────────────────────────────────
      // A step that reports success has not proved anything until the object is
      // read back from Sippy. This platform has twice been misled by a return
      // value: the Tariff-33 restore reported success on a tariff with no rates,
      // and Service Plan creation reported PERMISSION_DENIED for a plan it had
      // actually created. Both were only caught by reading the switch after.
      //
      // A verify failure DOWNGRADES a successful execute to failed. That is the
      // point — "we asked and it said yes" is not evidence.
      if (outcome.status === 'success' && def.verify) {
        try {
          // Two shapes. A bare string is a failure reason and null is a pass — unchanged.
          // A VerifyReport also carries lines describing what the check looked at, and
          // those are kept whether it passed or failed: what a check PROVED is as much
          // use to an operator as why it failed.
          const report = await def.verify(ctx, outcome.result ?? {});
          const reason      = typeof report === 'string' ? report : report?.reason ?? null;
          const verifyLines = typeof report === 'string' || !report ? [] : report.detail ?? [];
          // Verify's counts win over execute's. `verified` and `failures` describe what
          // was read back from Sippy; execute() only knows what it asked for.
          const verifyMetrics = typeof report === 'string' || !report ? null : report.metrics ?? null;
          if (verifyMetrics) outcome = { ...outcome, metrics: { ...(outcome.metrics ?? {}), ...verifyMetrics } };

          if (reason) {
            outcome = {
              ...outcome,
              status: 'failed',
              reasonCode: outcome.reasonCode ?? 'VERIFY_FAILED',
              error: `Executed but read-back failed: ${reason}`,
              detail: [...(outcome.detail ?? []), ...verifyLines, `read-back: ${reason}`],
            };
          } else {
            outcome = {
              ...outcome,
              detail: [...(outcome.detail ?? []), ...verifyLines,
                       ...(verifyLines.length ? [] : ['read-back: verified'])],
            };
          }
        } catch (ve: any) {
          // An unreadable object is NOT a pass. Treating a failed check as
          // success is precisely the assumption this whole mechanism exists to
          // remove.
          outcome = {
            ...outcome,
            status: 'failed',
            reasonCode: 'VERIFY_THREW',
            error: `Executed but read-back could not complete: ${ve?.message ?? 'unknown error'}`,
          };
        }
      }

      await db.update(provisioningSteps).set({
        status:      outcome.status,
        result:      outcome.result ? JSON.stringify(outcome.result) : null,
        // Persisted (migration 055). Every executor built this and it went nowhere but a
        // console line — so a step could pass having created twelve authentication rules
        // and report only a tick and a duration.
        detail:      outcome.detail?.length ? JSON.stringify(outcome.detail) : null,
        // JSONB — drizzle serialises the object. NULL when a step emitted none, which
        // means unknown; a rate computed over history must not read that as zero.
        metrics:     outcome.metrics && Object.keys(outcome.metrics).length ? outcome.metrics : null,
        reasonCode:  outcome.reasonCode ?? null,
        error:       outcome.error ?? null,
        traceId:     outcome.traceId ?? null,
        completedAt: new Date(),
      }).where(eq(provisioningSteps.id, row.id));

      if (outcome.status === 'success' && outcome.result) {
        ctx.results[row.stepKey] = outcome.result;
      }
      summary.push({ key: row.stepKey, status: outcome.status, error: outcome.error });

      if (outcome.status === 'failed') {
        console.warn(`[provisioning] ${run.runRef} step=${row.stepKey} FAILED reasonCode=${outcome.reasonCode ?? 'n/a'} blocking=${row.blocking} — ${outcome.error ?? ''}${outcome.detail?.length ? ` | ${outcome.detail.join(' ; ')}` : ''}`);
        if (row.blocking) halted = true; else sawNonBlockingFailure = true;
      } else {
        console.log(`[provisioning] ${run.runRef} step=${row.stepKey} ${outcome.status}`);
      }
    } catch (e: any) {
      // An executor throwing is a bug in that executor, never a reason to leave
      // the run in 'running' forever.
      await db.update(provisioningSteps).set({
        status: 'failed', error: e?.message ?? 'unknown error',
        reasonCode: 'EXECUTOR_THREW', completedAt: new Date(),
      }).where(eq(provisioningSteps.id, row.id));
      summary.push({ key: row.stepKey, status: 'failed', error: e?.message });
      if (row.blocking) halted = true; else sawNonBlockingFailure = true;
    }
  }

  // A SKIPPED stage is also a warning, not a clean pass. "Provision complete" while
  // capacity was silently skipped tells an operator the customer is fully configured
  // when Sippy defaults are still in force — the summary must say so.
  const sawSkipped = summary.some(s => s.status === 'skipped');
  const finalStatus = halted
    ? 'failed'
    : (sawNonBlockingFailure || sawSkipped) ? 'completed_with_warnings' : 'completed';

  await db.update(provisioningRuns).set({
    status: finalStatus,
    completedAt: finalStatus === 'failed' ? new Date() : new Date(),
    currentStep: null,
  }).where(eq(provisioningRuns.id, runId));

  console.log(`[provisioning] ${run.runRef} → ${finalStatus}`);
  return { status: finalStatus, steps: summary };
}

/** Run + steps, for a status/progress endpoint. */
export async function getRun(runId: number) {
  const [run] = await db.select().from(provisioningRuns).where(eq(provisioningRuns.id, runId));
  if (!run) return null;
  const steps = await db.select().from(provisioningSteps)
    .where(eq(provisioningSteps.runId, runId))
    .orderBy(asc(provisioningSteps.stepOrder));
  return { run, steps };
}

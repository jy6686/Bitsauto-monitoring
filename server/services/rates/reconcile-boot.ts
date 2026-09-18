/**
 * Boot-time reconciliation — the real dependency wiring (DB + Sippy). This is the only file in
 * the feature that touches a database or the switch; the decisions and the orchestration are in
 * reconcile-core.ts and reconcile-sweep.ts, tested without either.
 *
 * SHIPS OFF. It runs only when `RATE_RECONCILE_ON_BOOT=1`. A new mechanism that reads back tariffs
 * and writes terminal states on every boot must be proven against fixtures and then turned on
 * deliberately — the same discipline as `rate_policy_enforcement`. With the flag unset this module
 * makes zero DB queries and zero Sippy calls.
 *
 * Even enabled, a boot with no orphaned jobs costs exactly ONE indexed DB query and ZERO Sippy
 * calls: Sippy is touched only when a stranded job actually exists.
 */
import { and, inArray, sql, asc } from 'drizzle-orm';
import { db } from '../../db';
import { ratePushJobs } from '../../../shared/schema';
import { storage } from '../../storage';
import * as sippy from '../../sippy';
import {
  isOrphanEligible,
  RECONCILE_STATE,
  type RateIntent,
  type ReconcileVerdict,
  type NonTerminalStatus,
} from './reconcile-core';
import {
  runReconcileSweep,
  type ReconcileDeps,
  type ReconcileJob,
  type ReadbackResult,
} from './reconcile-sweep';

/** 2× the 15-min upload-token processing window: never read back a job Sippy may still process. */
const STALE_MS = 30 * 60_000;
const UNAVAILABLE_CEILING = 6; // ~6 unreachable boots before a job is escalated to human review
const READBACK_LIMIT = 1000;   // rows.length >= this ⇒ a truncated read ⇒ classifier says indeterminate

const DEFAULT_SIPPY_USERNAME = 'ssp-root';

/** Split a job row's stored fields into per-prefix intents. Conservative: per-prefix oldRate is
 *  only trusted for a single-prefix job (the row stores one oldRate); multi-prefix ⇒ oldRate null,
 *  which makes the classifier fall back to indeterminate rather than risk a wrong `failure`. */
function parseIntents(row: { fullPrefix: string | null; newRate: string | null; oldRate: string | null }): RateIntent[] {
  const prefixes = String(row.fullPrefix ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const newRate = row.newRate != null ? parseFloat(row.newRate) : NaN;
  if (!prefixes.length || !Number.isFinite(newRate)) return [];
  const single = prefixes.length === 1;
  const oldRate = single && row.oldRate != null && row.oldRate !== '' ? parseFloat(row.oldRate) : null;
  return prefixes.map(prefix => ({ prefix, newRate, oldRate: single ? oldRate : null }));
}

async function loadStaleJobs(now: Date): Promise<ReconcileJob[]> {
  // Non-terminal AND stale by the effective clock (last_step_at, else created_at). The pure
  // isOrphanEligible re-confirms below so the SQL predicate and the decision logic cannot drift.
  const cutoff = new Date(now.getTime() - STALE_MS);
  const rows = await db.select().from(ratePushJobs).where(and(
    inArray(ratePushJobs.status, ['pending', 'processing']),
    sql`COALESCE(${ratePushJobs.lastStepAt}, ${ratePushJobs.createdAt}) <= ${cutoff}`,
  )).orderBy(asc(sql`COALESCE(${ratePushJobs.lastStepAt}, ${ratePushJobs.createdAt})`));

  return rows
    .filter(r => isOrphanEligible(
      { status: r.status, lastStepAt: r.lastStepAt ?? null, createdAt: r.createdAt },
      now, STALE_MS,
    ))
    .map(r => ({
      jobId: r.jobId,
      status: r.status as NonTerminalStatus,
      verificationResult: r.verificationResult ?? null,
      iTariff: r.iTariff ?? null,
      intents: parseIntents(r),
    }));
}

/** Conditional terminal write — the logical claim. Only lands while the row is still non-terminal,
 *  so a concurrent boot's write no-ops rather than overwriting a verdict already recorded. */
async function writeVerdict(jobId: string, verdict: ReconcileVerdict): Promise<void> {
  const state = RECONCILE_STATE[verdict];
  await db.update(ratePushJobs)
    .set({
      status: state.status,
      verificationResult: state.verificationResult,
      completedAt: new Date(),
      errorMessage: `boot reconciliation: ${verdict} (verified by read-back)`,
    })
    .where(and(
      sql`${ratePushJobs.jobId} = ${jobId}`,
      inArray(ratePushJobs.status, ['pending', 'processing']),
    ));
}

async function writeUnavailable(
  job: ReconcileJob,
  outcome: { status: string; verificationResult: string; escalate: boolean },
): Promise<void> {
  // Also conditional on non-terminal: if another boot already escalated or verdicted this row,
  // this write must not resurrect it.
  const patch: Record<string, unknown> = { verificationResult: outcome.verificationResult };
  if (outcome.escalate) { patch.status = outcome.status; patch.completedAt = new Date(); }
  await db.update(ratePushJobs)
    .set(patch)
    .where(and(
      sql`${ratePushJobs.jobId} = ${job.jobId}`,
      inArray(ratePushJobs.status, ['pending', 'processing']),
    ));
}

/** Read back one job's tariff. reachable:false on any transport/fault error (an unreachable read
 *  is NOT evidence about the mutation — the sweep defers it, never calls it indeterminate). */
function makeReadback(username: string, password: string, portalUrl: string) {
  return async (job: ReconcileJob): Promise<ReadbackResult> => {
    if (job.iTariff == null) {
      // Reachable, but there is no tariff to read → unverifiable → the classifier says indeterminate.
      return { reachable: true, readback: { ok: false, complete: false, rows: [] } };
    }
    try {
      const rows = await sippy.getTariffRatesListFull(username, password, job.iTariff, 0, READBACK_LIMIT, undefined, portalUrl);
      return {
        reachable: true,
        readback: {
          ok: true,
          complete: rows.length < READBACK_LIMIT,
          rows: rows.map((r: any) => ({ prefix: String(r.prefix), price1: Number(r.price1) })),
        },
      };
    } catch {
      return { reachable: false };
    }
  };
}

/**
 * Entry point, called once at startup. No-op unless RATE_RECONCILE_ON_BOOT=1. Fetches orphans with
 * one query; if there are none it returns without touching Sippy.
 */
export async function reconcileOrphanedRatePushesOnBoot(): Promise<void> {
  if (process.env.RATE_RECONCILE_ON_BOOT !== '1') return;
  try {
    const now = new Date();
    const jobs = await loadStaleJobs(now);
    if (jobs.length === 0) {
      console.log('[rate-reconcile] no stale rate-push jobs — nothing to reconcile');
      return;
    }
    console.log(`[rate-reconcile] found ${jobs.length} stale non-terminal rate-push job(s)`);

    const settings: any = await storage.getSettings();
    const username = settings.apiAdminUsername || settings.portalUsername || DEFAULT_SIPPY_USERNAME;
    const password = settings.apiAdminPassword || settings.portalPassword || '';
    const portalUrl = settings.portalUrl || '';
    const probeTariff = jobs.find(j => j.iTariff != null)?.iTariff ?? null;

    const deps: ReconcileDeps = {
      now: () => now,
      staleMs: STALE_MS,
      unavailableCeiling: UNAVAILABLE_CEILING,
      probeSippy: async () => {
        if (probeTariff == null) return true; // nothing to read against; jobs will classify indeterminate
        try { await sippy.getTariffRatesListFull(username, password, probeTariff, 0, 1, undefined, portalUrl); return true; }
        catch { return false; }
      },
      listStaleJobs: async () => jobs,
      readbackTariff: makeReadback(username, password, portalUrl),
      writeVerdict,
      writeUnavailable,
      log: (m: string) => console.log(m),
    };

    const summary = await runReconcileSweep(deps);
    console.log('[rate-reconcile] summary', JSON.stringify(summary));
  } catch (e: any) {
    // Reconciliation is a safety net, not a boot dependency — its failure must never block startup.
    console.error('[rate-reconcile] failed (non-fatal):', e?.message ?? e);
  }
}

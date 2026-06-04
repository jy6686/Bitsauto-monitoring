/**
 * Route Testing Engine — scheduled proactive test-call service.
 *
 * Fires real Sippy calls through selected vendor routes on a per-job schedule,
 * records ASR/PDD/SIP-code metrics, and emits WebSocket events so the UI refreshes live.
 */

import { db } from "../db";
import { routeTestJobs, routeTestResults } from "../../shared/schema";
import { eq, desc, gte, and } from "drizzle-orm";
import { storage } from "../storage";

// ── Sippy credential helper (replicated from routes.ts pattern) ─────────────
// We import storage to get settings then invoke makeCall from sippy.
import * as sippy from "../sippy";

type SippySettings = Awaited<ReturnType<typeof storage.getSippySettings>>;

function sippyXmlCreds(s: NonNullable<SippySettings>) {
  const u = (s as any).apiAdminUsername || (s as any).portalUsername || '';
  const p = (s as any).apiAdminPassword || (s as any).portalPassword || '';
  return { username: u, password: p };
}

function sippyPortalUrl(s: NonNullable<SippySettings>): string {
  return ((s as any).portalUrl as string | undefined) || 'https://191.101.30.107';
}

// ── Job scheduler state ─────────────────────────────────────────────────────
let _schedulerTimer: NodeJS.Timeout | null = null;
let _running = false;

// WebSocket broadcast hook (injected from routes.ts)
let _broadcastFn: ((event: string, data: any) => void) | null = null;

export function setRouteTestBroadcast(fn: (event: string, data: any) => void) {
  _broadcastFn = fn;
}

function broadcast(event: string, data: any) {
  if (_broadcastFn) {
    try { _broadcastFn(event, data); } catch { /* non-fatal */ }
  }
}

// ── Execute a single test job ───────────────────────────────────────────────
export async function executeRouteTestJob(jobId: number): Promise<{ ran: number; failed: number }> {
  const [job] = await db.select().from(routeTestJobs).where(eq(routeTestJobs.id, jobId));
  if (!job) throw new Error(`Route test job ${jobId} not found`);

  const settings = await storage.getSippySettings();
  if (!settings) {
    console.warn('[route-tester] No Sippy settings found — skipping job', jobId);
    return { ran: 0, failed: 0 };
  }

  const { username, password } = sippyXmlCreds(settings);
  const portalUrl = sippyPortalUrl(settings);

  if (!username) {
    console.warn('[route-tester] No Sippy credentials configured — skipping job', jobId);
    return { ran: 0, failed: 0 };
  }

  const vendors: Array<{ id: string; name: string }> = [];
  if (job.vendorNames && job.vendorNames.length > 0) {
    for (let i = 0; i < job.vendorNames.length; i++) {
      vendors.push({
        id:   job.vendorIds[i] ?? String(i),
        name: job.vendorNames[i],
      });
    }
  } else {
    vendors.push({ id: 'default', name: 'Default (LCR)' });
  }

  // ── Pre-loop connectivity pre-flight ─────────────────────────────────────
  // Use a lightweight system.listMethods probe (zero-cost, no real call) to
  // detect if Sippy XML-RPC is reachable before iterating vendors.
  // If unreachable: update scheduling timestamps only — do NOT insert failed
  // quality results that would corrupt route health signals.
  const sippyReachable = await sippy.testSippyConnectivity(username, password, portalUrl)
    .catch(() => false);

  if (!sippyReachable) {
    console.warn(`[route-tester] job=${jobId} — Sippy unreachable, updating schedule timestamps only`);
    const now = new Date();
    const nextRun = job.scheduleMinutes > 0
      ? new Date(now.getTime() + job.scheduleMinutes * 60_000) : null;
    await db.update(routeTestJobs)
      .set({ lastRunAt: now, nextRunAt: nextRun ?? undefined })
      .where(eq(routeTestJobs.id, jobId));
    return { ran: 0, failed: 0 };
  }

  let ran = 0; let failed = 0;
  const resultIds: number[] = [];

  for (const vendor of vendors) {
    const startedAt = new Date();
    const startMs   = Date.now();

    let connected   = false;
    let sipCode: number | undefined;
    let pddMs: number | undefined;
    let durationMs: number | null = null;
    let notes: string | undefined;
    let rawResponse: any;

    try {
      const cld = job.destinationPrefix;
      // makeTestCall: initiates call, polls listActiveCalls to measure real PDD + ACD.
      // Routing through a specific vendor is determined by Sippy's LCR plan for this CLD.
      // The job's vendor list is an organizational label for attribution — it identifies
      // which vendor route is expected to carry this destination prefix per the routing plan.
      // Sippy's makeCall XML-RPC does not expose a per-vendor selector; routing follows LCR.
      const result = await sippy.makeTestCall(username, password, {
        cli: '100',
        cld,
        maxDuration: 10,
      }, portalUrl);

      if (result == null) {
        console.warn(`[route-tester] job=${jobId} vendor=${vendor.name} — null result after pre-flight, skipping`);
        continue;
      }

      // actualVendorName is extracted from VENDOR_NAME in the listActiveCalls XML struct —
      // this is Sippy's authoritative record of which carrier handled the call.
      // vendor.name is the expected/target vendor set when the job was created.
      const resolvedVendorName = result.actualVendorName || vendor.name;
      const resolvedVendorId   = result.actualVendorId   || vendor.id;

      rawResponse = {
        ...result,
        _targetVendor:    vendor.name,
        _targetVendorId:  vendor.id,
        _actualVendor:    result.actualVendorName ?? null,
        _actualVendorId:  result.actualVendorId   ?? null,
        _vendorMismatch:  result.actualVendorName != null && result.actualVendorName !== vendor.name,
      };

      if (result.connected) {
        connected  = true;
        sipCode    = result.sipCode ?? 200;
        pddMs      = result.pdd    ?? Math.round(Date.now() - startMs);
        durationMs = result.duration != null ? result.duration * 1000 : null;
        const acdNote = durationMs != null ? `, ACD ${(durationMs / 1000).toFixed(1)}s` : '';
        const vendorNote = result.actualVendorName && result.actualVendorName !== vendor.name
          ? ` (via ${result.actualVendorName}, expected ${vendor.name})`
          : ` via ${resolvedVendorName}`;
        notes = `Connected${vendorNote}${acdNote}, PDD ${pddMs}ms`;
      } else {
        connected = false;
        sipCode   = result.sipCode ?? 503;
        pddMs     = result.pdd    ?? Math.round(Date.now() - startMs);
        if (sipCode === 401)  notes = `Auth failed (expected ${vendor.name})`;
        else if (sipCode === 501) notes = `Call origination not available (expected ${vendor.name})`;
        else if (sipCode === 408) notes = `No active-call confirmation received — listActiveCalls may be restricted (expected ${vendor.name})`;
        else notes = `Call failed SIP ${sipCode} (expected ${vendor.name})`;
      }
      ran++;
    } catch (err: any) {
      connected = false;
      sipCode   = 500;
      notes     = err.message;
      rawResponse = { error: err.message, _targetVendor: vendor.name };
      failed++;
    }

    // resolvedVendorName/Id: prefer actual carrier from Sippy telemetry, fall back to target label
    const finalVendorName = (rawResponse as any)?._actualVendor || vendor.name;
    const finalVendorId   = (rawResponse as any)?._actualVendorId || vendor.id;

    const [inserted] = await db.insert(routeTestResults).values({
      jobId:       job.id,
      vendorId:    finalVendorId,
      vendorName:  finalVendorName,
      destination: job.destinationPrefix,
      startedAt,
      connected,
      sipCode,
      pddMs,
      durationMs,
      notes,
      rawResponse,
    }).returning({ id: routeTestResults.id });

    if (inserted) resultIds.push(inserted.id);

    console.log(`[route-tester] job=${jobId} vendor=${vendor.name} cld=${job.destinationPrefix} connected=${connected} sip=${sipCode} pdd=${pddMs}ms`);
  }

  // Update job timestamps
  const now = new Date();
  const nextRun = job.scheduleMinutes > 0
    ? new Date(now.getTime() + job.scheduleMinutes * 60_000)
    : null;

  await db.update(routeTestJobs)
    .set({ lastRunAt: now, nextRunAt: nextRun ?? undefined })
    .where(eq(routeTestJobs.id, jobId));

  broadcast('route-test:completed', { jobId, resultIds, ran, failed });

  return { ran, failed };
}

// ── Background scheduler tick ────────────────────────────────────────────────
async function _schedulerTick(): Promise<void> {
  if (_running) return;
  _running = true;
  try {
    const now = new Date();
    const jobs = await db.select().from(routeTestJobs)
      .where(and(eq(routeTestJobs.enabled, true)));

    const due = jobs.filter(j =>
      j.scheduleMinutes > 0 &&
      j.nextRunAt != null &&
      j.nextRunAt <= now
    );

    for (const j of due) {
      try {
        await executeRouteTestJob(j.id);
      } catch (err: any) {
        console.warn(`[route-tester] job ${j.id} failed:`, err.message);
      }
    }

    // For newly-created scheduled jobs with no nextRunAt, seed it now
    const unseeded = jobs.filter(j => j.scheduleMinutes > 0 && j.nextRunAt == null);
    for (const j of unseeded) {
      const nextRun = new Date(now.getTime() + j.scheduleMinutes * 60_000);
      await db.update(routeTestJobs).set({ nextRunAt: nextRun }).where(eq(routeTestJobs.id, j.id));
    }
  } catch (err: any) {
    console.warn('[route-tester] scheduler tick error:', err.message);
  } finally {
    _running = false;
  }
}

// ── Public init ─────────────────────────────────────────────────────────────
export function initRouteTestScheduler(): void {
  if (_schedulerTimer) return;
  _schedulerTimer = setInterval(_schedulerTick, 60_000); // check every minute
  setTimeout(_schedulerTick, 5_000); // first check after 5s
  console.log('[route-tester] Scheduler started — checking every 60s');
}

// ── Load test evidence for Copilot ──────────────────────────────────────────
export interface RouteTestEvidence {
  jobId: number;
  jobName: string;
  vendorName: string;
  destination: string;
  totalTests: number;
  successCount: number;
  failCount: number;
  recentSipCodes: number[];
  avgPddMs: number | null;
  passRate: number;
}

export async function loadRouteTestEvidence(sinceHours = 6): Promise<RouteTestEvidence[]> {
  const since = new Date(Date.now() - sinceHours * 60 * 60_000);
  const results = await db.select().from(routeTestResults)
    .where(gte(routeTestResults.startedAt, since))
    .orderBy(desc(routeTestResults.startedAt));

  const jobs = await db.select().from(routeTestJobs);
  const jobMap = new Map(jobs.map(j => [j.id, j]));

  const grouped = new Map<string, typeof results>();
  for (const r of results) {
    const key = `${r.jobId}:${r.vendorName}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(r);
  }

  const evidence: RouteTestEvidence[] = [];
  for (const [, rows] of grouped) {
    const first    = rows[0];
    const job      = first.jobId ? jobMap.get(first.jobId) : null;
    const success  = rows.filter(r => r.connected).length;
    const fail     = rows.length - success;
    const pddVals  = rows.filter(r => r.pddMs != null).map(r => r.pddMs as number);
    const avgPdd   = pddVals.length > 0 ? Math.round(pddVals.reduce((a, b) => a + b, 0) / pddVals.length) : null;
    const sipCodes = [...new Set(rows.filter(r => r.sipCode).map(r => r.sipCode as number))].slice(0, 5);

    evidence.push({
      jobId:       first.jobId ?? 0,
      jobName:     job?.name ?? 'Unknown',
      vendorName:  first.vendorName ?? 'Unknown',
      destination: first.destination ?? '',
      totalTests:  rows.length,
      successCount: success,
      failCount:   fail,
      recentSipCodes: sipCodes,
      avgPddMs:    avgPdd,
      passRate:    rows.length > 0 ? Math.round((success / rows.length) * 100) : 0,
    });
  }

  return evidence.sort((a, b) => a.passRate - b.passRate);
}

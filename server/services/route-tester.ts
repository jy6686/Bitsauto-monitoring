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
import { compareCli, type CliComparison } from "./identity/cli";
import { compareCld, type CldComparison } from "./identity/cld";
import { detectCountry } from "../cdr-enrichment";

/**
 * Destination country for a dial prefix, so CLI can be read under the right
 * dial plan (CAP-023 §7). Returns null when the prefix is too short or too
 * ambiguous to place — the normalizer treats null as "undetermined" and stops
 * rather than guessing.
 */
function destinationCountryOf(prefix: string | null | undefined): string | null {
  const digits = String(prefix ?? '').replace(/\D/g, '');
  if (digits.length < 4) return null;
  return detectCountry(digits);
}

type SippySettings = Awaited<ReturnType<typeof storage.getSippySettings>>;

function sippyXmlCreds(s: NonNullable<SippySettings>) {
  const u = (s as any).apiAdminUsername || (s as any).portalUsername || '';
  const p = (s as any).apiAdminPassword || (s as any).portalPassword || '';
  return { username: u, password: p };
}

function sippyPortalUrl(s: NonNullable<SippySettings>): string {
  return ((s as any).portalUrl as string | undefined) || 'https://191.101.30.107';
}

// ── CDR lookup hook (injected from routes.ts which owns the cdrCache) ────────
// Used for ORIGINATION-side CLI verification only. After a test call we probe
// the CDR cache and read `cli` — the A-number of our own originating leg, as
// Sippy recorded it.
//
// CAP-023 §3: Sippy records the CLI it received from us and forwarded. It has
// no feedback path from a vendor's network, so this can only ever detect a
// rewrite by our own dialplan or by Sippy's translation rules. It is evidence
// level O2 (proxy), never O3/O4, and must not be read as vendor behaviour.
//
// callId is the SIP Call-ID from makeTestCall — used as primary match key.
// Falls back to exact CLD + time-window matching when callId is unavailable.
type CdrLookupFn = (opts: {
  callId?: string;
  cld: string;
  afterMs: number;
  windowMs: number;
}) => Promise<{ cli?: string; cld?: string } | null>;

let _cdrLookupFn: CdrLookupFn | null = null;

export function setCdrLookupForCliVerification(fn: CdrLookupFn): void {
  _cdrLookupFn = fn;
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

  // ── CLI verification config ────────────────────────────────────────────────
  // Use the job's configured CLI if set, otherwise fall back to '100'.
  const cliToSend = job.cliToSend?.trim() || '100';
  const wantCliVerification = !!(job.cliToSend?.trim());

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

    // CLI verification fields — origination leg only (CAP-023 §3)
    let cliReceived: string | undefined;
    let originationCliMatch: string | undefined;
    let cliEvidence: CliComparison | undefined;
    let cldEvidence: CldComparison | undefined;

    try {
      const cld = job.destinationPrefix;
      const result = await sippy.makeTestCall(username, password, {
        cli: cliToSend,
        cld,
        maxDuration: 10,
      }, portalUrl);

      if (result == null) {
        console.warn(`[route-tester] job=${jobId} vendor=${vendor.name} — null result after pre-flight, skipping`);
        continue;
      }

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

        // ── Origination CLI verification: probe CDR cache ────────────────────
        // Observes our own leg only. See the CdrLookupFn note above and
        // CAP-023 §3 before using this for anything vendor-shaped.
        if (wantCliVerification && _cdrLookupFn) {
          try {
            // Allow 5s for the CDR to appear in the cache after the call ends
            await new Promise(r => setTimeout(r, 3000));
            const cdrHit = await _cdrLookupFn({
              callId:   result.callId,        // primary: exact SIP Call-ID match
              cld:      job.destinationPrefix, // fallback: exact CLD + time window
              afterMs:  startMs - 2000,        // allow 2s pre-call tolerance
              windowMs: 90_000,                // search within 90s of call start
            });
            cliReceived = cdrHit?.cli ?? undefined;
            // The called number is transformed by our own configuration on the
            // way out, so it needs the same evidence chain as the caller id —
            // "the call completed" does not establish that the transformation
            // was the one we configured. CAP-023 §9.
            cldEvidence = compareCld({
              requestedCld:       job.destinationPrefix,
              observedCld:        cdrHit?.cld ?? null,
              expectPrefix:       false, // Sippy should have consumed the tech prefix by now
              stage:              'Sippy ingress',
              destinationCountry: destinationCountryOf(job.destinationPrefix),
              evidenceLevel:      'O2',
            });
            cliEvidence = compareCli({
              requestedCli:       cliToSend,
              // null (not '') when nothing was found: an absent observation is
              // UNKNOWN, never SUPPRESSED.
              observedCli:        cdrHit?.cli ?? null,
              destinationCountry: destinationCountryOf(job.destinationPrefix),
              evidenceLevel:      'O2',
            });
            originationCliMatch = cliEvidence.observation === 'UNKNOWN' ? 'unknown'
              : cliEvidence.observation === 'EXACT' || cliEvidence.observation === 'LOCALIZED' ? 'match'
              : 'mismatch';
            console.log(
              `[route-tester] job=${jobId} vendor=${vendor.name} origination CLI ` +
              `${cliToSend}→${cliReceived ?? 'not captured'} = ${cliEvidence.observation} ` +
              `(O2, ${cliEvidence.confidence})`,
            );
          } catch (cliErr: any) {
            originationCliMatch = 'unknown';
            console.warn(`[route-tester] origination CLI probe failed (non-fatal):`, cliErr.message);
          }
        } else if (wantCliVerification) {
          originationCliMatch = 'unknown'; // CDR lookup not available
        }
      } else {
        connected = false;
        sipCode   = result.sipCode ?? 503;
        pddMs     = result.pdd    ?? Math.round(Date.now() - startMs);
        if (sipCode === 401)  notes = `Auth failed (expected ${vendor.name})`;
        else if (sipCode === 501) notes = `Call origination not available (expected ${vendor.name})`;
        else if (sipCode === 408) notes = `No active-call confirmation received — listActiveCalls may be restricted (expected ${vendor.name})`;
        else notes = `Call failed SIP ${sipCode} (expected ${vendor.name})`;
        // CLI verification only possible on connected calls
        if (wantCliVerification) originationCliMatch = 'unknown';
      }
      ran++;
    } catch (err: any) {
      connected = false;
      sipCode   = 500;
      notes     = err.message;
      rawResponse = { error: err.message, _targetVendor: vendor.name };
      if (wantCliVerification) originationCliMatch = 'unknown';
      failed++;
    }

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
      cliSent:     wantCliVerification ? cliToSend : undefined,
      cliReceived: cliReceived ?? undefined,
      originationCliMatch: originationCliMatch ?? undefined,
      cliEvidence: cliEvidence ?? undefined,
      cldEvidence: cldEvidence ?? undefined,
      notes,
      rawResponse,
    }).returning({ id: routeTestResults.id });

    if (inserted) resultIds.push(inserted.id);

    console.log(`[route-tester] job=${jobId} vendor=${vendor.name} cld=${job.destinationPrefix} connected=${connected} sip=${sipCode} pdd=${pddMs}ms origination-cli=${originationCliMatch ?? 'n/a'}`);
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
/**
 * Per-vendor evidence. Deliberately carries NO CLI fields.
 *
 * CAP-023 §3: the only CLI signal this service produces is origination-side —
 * our own leg as Sippy recorded it, which no vendor ever touched. Grouping it
 * by vendor and handing it to the copilot let a vendor be described as
 * rewriting CLI on evidence that never observed that vendor.
 *
 * Origination CLI integrity is published separately and unattributed by
 * `loadOriginationCliIntegrity()`. It returns here only when a terminating-side
 * observation exists (CAP-023 O3/O4) and vendor targeting is bound (CAP-022).
 */
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

// ── Origination CLI integrity (7-day window) ────────────────────────────────
/**
 * Platform-wide, and deliberately NOT broken down by vendor.
 *
 * This measures one thing: did the CLI we asked Sippy to present survive our
 * own origination path? The observation comes from `cdrCache`, which holds the
 * A-number of our own leg as Sippy recorded it (CAP-023 §3). No vendor is
 * anywhere in that measurement, so no vendor may be named next to it.
 *
 * `unknown` rows are reported and excluded from the rate. An observation that
 * was never made is not evidence in either direction — CAP-021's completeness
 * rule, applied here.
 */
export interface OriginationCliIntegrity {
  /** What this number actually describes. Rendered verbatim in the UI. */
  scope: string;
  evidenceLevel: 'O2';
  total: number;
  match: number;
  mismatch: number;
  unknown: number;
  /** match / (match + mismatch). null when nothing was resolved. */
  matchRate: number | null;
  /** Distribution of the structured CAP-023 observations, when present. */
  observations: Record<string, number>;
}

export async function loadOriginationCliIntegrity(): Promise<OriginationCliIntegrity> {
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60_000);
  const rows = await db.select().from(routeTestResults)
    .where(gte(routeTestResults.startedAt, since7d))
    .orderBy(desc(routeTestResults.startedAt));

  // Only rows where CLI verification was configured
  const cliRows = rows.filter(r => r.cliSent != null);

  let match = 0, mismatch = 0, unknown = 0;
  const observations: Record<string, number> = {};

  for (const r of cliRows) {
    if (r.originationCliMatch === 'match')         match++;
    else if (r.originationCliMatch === 'mismatch') mismatch++;
    else                                           unknown++;

    const obs = (r.cliEvidence as CliComparison | null)?.observation;
    if (obs) observations[obs] = (observations[obs] ?? 0) + 1;
  }

  const resolved = match + mismatch;
  return {
    scope:
      'Requested CLI vs the CLI Sippy recorded on our own originating leg. ' +
      'Does not observe any vendor — a rewrite downstream of Sippy is invisible here.',
    evidenceLevel: 'O2',
    total: cliRows.length,
    match,
    mismatch,
    unknown,
    matchRate: resolved > 0 ? Math.round((match / resolved) * 100) : null,
    observations,
  };
}

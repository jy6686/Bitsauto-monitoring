/**
 * SIP OPTIONS Vendor Probe Routes & Background Scheduler
 *
 * Provides real-time vendor reachability intelligence via SIP OPTIONS probes.
 * Probes run every 5 minutes for all cached connections; results are stored in
 * vendor_probe_results and surface in the Routing Manager UI.
 *
 * API:
 *   GET  /api/vendors/probe-status          → current status snapshot (all vendors)
 *   GET  /api/vendors/:id/probe-history     → last-24h probe history for one vendor
 *   POST /api/vendors/:id/probe-now         → on-demand manual probe
 *   GET  /api/vendors/probe-unreachable-count → count of currently unreachable vendors (for Fix Button)
 */

import type { Express } from 'express';
import { db } from './db';
import { pool } from './db';
import { probeEndpoint, parseHostPort } from './sip-probe';
import { nocIncidents } from '../shared/schema';
import { eq, and } from 'drizzle-orm';

// ── In-memory state ──────────────────────────────────────────────────────────

// vendorId → { reachable, incidentId, lastChange }
const vendorState = new Map<string, { reachable: boolean; incidentId: number | null; lastChange: Date }>();

let _probeRunning = false;
let _probeTimer: ReturnType<typeof setTimeout> | null = null;

const PROBE_INTERVAL_MS = 5 * 60_000;  // 5 minutes
const STAGGER_MS        = 400;          // ms between individual connection probes
const MAX_ROWS_PER_VENDOR = 2000;

// ── Helpers ──────────────────────────────────────────────────────────────────

interface CachedConn {
  i_connection: number;
  name:         string;
  i_vendor:     number | null;
  vendor_name:  string | null;
  host:         string | null;
}

async function getCachedConnections(): Promise<CachedConn[]> {
  try {
    const { rows } = await pool.query<CachedConn>(`
      SELECT i_connection, name, i_vendor, vendor_name, host
      FROM   connection_vendor_cache2
      WHERE  host IS NOT NULL AND host <> ''
      ORDER  BY i_vendor, i_connection
    `);
    return rows;
  } catch {
    return [];
  }
}

async function insertProbeResult(row: {
  vendorId:        string;
  vendorName:      string | null;
  connectionId:    string;
  connectionName:  string;
  host:            string;
  port:            number;
  latencyMs:       number | null;
  sipResponseCode: number | null;
  reachable:       boolean;
  error:           string | null;
}): Promise<void> {
  await pool.query(`
    INSERT INTO vendor_probe_results
      (vendor_id, vendor_name, connection_id, connection_name, host, port, probed_at, latency_ms, sip_response_code, reachable, error)
    VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8, $9, $10)
  `, [
    row.vendorId, row.vendorName, row.connectionId, row.connectionName,
    row.host, row.port, row.latencyMs, row.sipResponseCode, row.reachable, row.error,
  ]);
}

async function pruneOldProbeResults(vendorId: string): Promise<void> {
  try {
    await pool.query(`
      DELETE FROM vendor_probe_results
      WHERE  vendor_id = $1
        AND  id NOT IN (
          SELECT id FROM vendor_probe_results
          WHERE  vendor_id = $1
          ORDER  BY probed_at DESC
          LIMIT  $2
        )
    `, [vendorId, MAX_ROWS_PER_VENDOR]);
  } catch { /* non-fatal */ }
}

// ── NOC incident management ──────────────────────────────────────────────────

async function openVendorIncident(vendorId: string, vendorName: string, host: string): Promise<number | null> {
  try {
    // Check for existing open incident for this vendor first
    const existing = await db.select().from(nocIncidents)
      .where(and(
        eq(nocIncidents.entityId, vendorId),
        eq(nocIncidents.entityType, 'vendor'),
        eq(nocIncidents.status, 'open'),
      ));
    if (existing.length > 0) return existing[0].id;

    const [inc] = await db.insert(nocIncidents).values({
      title:           `Vendor Unreachable: ${vendorName}`,
      type:            'vendor_unreachable',
      severity:        'high',
      status:          'open',
      entityType:      'vendor',
      entityId:        vendorId,
      entityName:      vendorName,
      description:     `SIP OPTIONS probe to ${host} timed out or returned no response. The vendor endpoint may be down or blocking ICMP/UDP.`,
      suggestedAction: `Check firewall rules at ${host}. Verify the SIP port (default 5060) is open. Contact the carrier NOC if the issue persists.`,
      source:          'sip_probe',
      tags:            ['sip-probe', 'vendor', 'reachability'],
    }).returning();
    console.log(`[sip-probe] Opened NOC incident #${inc.id} for unreachable vendor: ${vendorName}`);
    return inc.id;
  } catch (e: any) {
    console.warn('[sip-probe] Failed to open NOC incident:', e.message);
    return null;
  }
}

async function resolveVendorIncident(incidentId: number, vendorName: string): Promise<void> {
  try {
    await db.update(nocIncidents)
      .set({ status: 'resolved', resolvedAt: new Date(), updatedAt: new Date() })
      .where(eq(nocIncidents.id, incidentId));
    console.log(`[sip-probe] Auto-resolved NOC incident #${incidentId} for recovered vendor: ${vendorName}`);
  } catch (e: any) {
    console.warn('[sip-probe] Failed to resolve NOC incident:', e.message);
  }
}

// ── Core probe logic ─────────────────────────────────────────────────────────

async function probeVendorConnections(
  vendorId: string,
  vendorName: string,
  conns: CachedConn[],
  staggerMs = 0,
): Promise<void> {
  for (let i = 0; i < conns.length; i++) {
    const conn = conns[i];
    if (staggerMs > 0 && i > 0) {
      await new Promise(r => setTimeout(r, staggerMs));
    }
    const parsed = parseHostPort(conn.host);
    if (!parsed) continue;

    try {
      const result = await probeEndpoint(parsed.host, parsed.port);
      await insertProbeResult({
        vendorId,
        vendorName,
        connectionId:    String(conn.i_connection),
        connectionName:  conn.name,
        host:            parsed.host,
        port:            parsed.port,
        latencyMs:       result.latencyMs,
        sipResponseCode: result.sipResponseCode,
        reachable:       result.reachable,
        error:           result.error,
      });
    } catch (e: any) {
      await insertProbeResult({
        vendorId, vendorName,
        connectionId:   String(conn.i_connection),
        connectionName: conn.name,
        host:           parsed.host,
        port:           parsed.port,
        latencyMs:      null, sipResponseCode: null,
        reachable:      false,
        error:          e.message,
      });
    }
  }
}

/** Compute aggregate reachability for a vendor from its latest per-connection probes */
async function getVendorLatestStatus(vendorId: string): Promise<{
  reachable: boolean; latencyMs: number | null; lastProbed: Date | null;
}> {
  const { rows } = await pool.query<{
    reachable: boolean; latency_ms: number | null; probed_at: Date;
  }>(`
    WITH latest AS (
      SELECT DISTINCT ON (connection_id)
        reachable, latency_ms, probed_at
      FROM  vendor_probe_results
      WHERE vendor_id = $1
      ORDER BY connection_id, probed_at DESC
    )
    SELECT reachable, latency_ms, probed_at
    FROM   latest
    ORDER  BY probed_at DESC
    LIMIT  20
  `, [vendorId]);

  if (!rows.length) return { reachable: false, latencyMs: null, lastProbed: null };

  const anyReachable = rows.some(r => r.reachable);
  const latencies    = rows.filter(r => r.latency_ms != null).map(r => r.latency_ms as number);
  const avgLatency   = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null;
  return {
    reachable:  anyReachable,
    latencyMs:  avgLatency,
    lastProbed: rows[0]?.probed_at ?? null,
  };
}

/** Triggered after probing a vendor: manages NOC incident lifecycle */
async function handleVendorStateChange(vendorId: string, vendorName: string, host: string): Promise<void> {
  const { reachable } = await getVendorLatestStatus(vendorId);
  const prev = vendorState.get(vendorId);

  if (!prev) {
    vendorState.set(vendorId, { reachable, incidentId: null, lastChange: new Date() });
    return;
  }

  if (prev.reachable && !reachable) {
    // Flipped → unreachable: open NOC incident
    const incidentId = await openVendorIncident(vendorId, vendorName, host);
    vendorState.set(vendorId, { reachable: false, incidentId, lastChange: new Date() });
  } else if (!prev.reachable && reachable) {
    // Recovered: resolve NOC incident
    if (prev.incidentId) {
      await resolveVendorIncident(prev.incidentId, vendorName);
    }
    vendorState.set(vendorId, { reachable: true, incidentId: null, lastChange: new Date() });
  }
}

// ── Background scheduler ─────────────────────────────────────────────────────

async function runProbeRound(): Promise<void> {
  if (_probeRunning) return;
  _probeRunning = true;
  const t0 = Date.now();

  try {
    const allConns = await getCachedConnections();
    if (!allConns.length) {
      console.log('[sip-probe] No cached connections to probe — skipping round');
      return;
    }

    // Group by vendor
    const byVendor = new Map<string, { vendorName: string; conns: CachedConn[] }>();
    for (const conn of allConns) {
      const vid  = String(conn.i_vendor ?? 'unknown');
      const name = conn.vendor_name ?? `Vendor#${vid}`;
      if (!byVendor.has(vid)) byVendor.set(vid, { vendorName: name, conns: [] });
      byVendor.get(vid)!.conns.push(conn);
    }

    console.log(`[sip-probe] Probe round: ${byVendor.size} vendor(s), ${allConns.length} connection(s)`);

    for (const [vendorId, { vendorName, conns }] of byVendor) {
      await probeVendorConnections(vendorId, vendorName, conns, STAGGER_MS);
      await pruneOldProbeResults(vendorId);
      const firstHost = parseHostPort(conns[0]?.host ?? null);
      if (firstHost) {
        await handleVendorStateChange(vendorId, vendorName, firstHost.host);
      }
    }

    console.log(`[sip-probe] Round complete in ${Date.now() - t0}ms`);
  } catch (e: any) {
    console.warn('[sip-probe] Probe round error:', e.message);
  } finally {
    _probeRunning = false;
  }
}

function scheduleNext() {
  _probeTimer = setTimeout(async () => {
    await runProbeRound();
    scheduleNext();
  }, PROBE_INTERVAL_MS);
}

export function initVendorProbeScheduler() {
  // Initial run after 30 seconds (let the server finish starting)
  setTimeout(async () => {
    await runProbeRound();
    scheduleNext();
  }, 30_000);
  console.log('[sip-probe] Scheduler initialised — first probe in 30 s, then every 5 min');
}

// ── Route registration ────────────────────────────────────────────────────────

export function registerVendorProbeRoutes(app: Express) {

  // GET /api/vendors/probe-status
  // Returns current reachability snapshot for all vendors that have been probed.
  app.get('/api/vendors/probe-status', async (_req: any, res: any) => {
    try {
      const { rows } = await pool.query<{
        vendor_id:         string;
        vendor_name:       string | null;
        reachable:         boolean;
        latency_ms:        number | null;
        sip_response_code: number | null;
        probed_at:         Date;
        connection_count:  string;
        reachable_count:   string;
      }>(`
        WITH latest_per_conn AS (
          SELECT DISTINCT ON (vendor_id, connection_id)
            vendor_id, vendor_name, connection_id,
            reachable, latency_ms, sip_response_code, probed_at
          FROM  vendor_probe_results
          ORDER BY vendor_id, connection_id, probed_at DESC
        ),
        agg AS (
          SELECT
            vendor_id, vendor_name,
            bool_or(reachable)                    AS reachable,
            ROUND(AVG(latency_ms))::int           AS latency_ms,
            MAX(sip_response_code)                AS sip_response_code,
            MAX(probed_at)                        AS probed_at,
            COUNT(*)::text                        AS connection_count,
            COUNT(*) FILTER (WHERE reachable)::text AS reachable_count
          FROM   latest_per_conn
          GROUP  BY vendor_id, vendor_name
        )
        SELECT * FROM agg ORDER BY vendor_name
      `);

      // Compute 24h uptime % per vendor
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 3600_000);
      const { rows: histRows } = await pool.query<{
        vendor_id: string;
        total:     string;
        up:        string;
      }>(`
        SELECT vendor_id,
               COUNT(*)                              AS total,
               COUNT(*) FILTER (WHERE reachable)     AS up
        FROM   vendor_probe_results
        WHERE  probed_at >= $1
        GROUP  BY vendor_id
      `, [twentyFourHoursAgo]);

      const uptimeMap = new Map(histRows.map(r => [r.vendor_id, {
        uptimePct: r.total === '0' ? 100 : Math.round((parseInt(r.up) / parseInt(r.total)) * 100),
      }]));

      const vendors = rows.map(r => ({
        vendorId:        r.vendor_id,
        vendorName:      r.vendor_name ?? r.vendor_id,
        reachable:       r.reachable,
        latencyMs:       r.latency_ms,
        sipResponseCode: r.sip_response_code,
        lastProbed:      r.probed_at,
        connectionCount: parseInt(r.connection_count ?? '0'),
        reachableCount:  parseInt(r.reachable_count ?? '0'),
        uptimePct24h:    uptimeMap.get(r.vendor_id)?.uptimePct ?? 100,
        status:          r.reachable
          ? (r.latency_ms != null && r.latency_ms > 500 ? 'degraded' : 'reachable')
          : 'unreachable',
      }));

      res.json({ vendors, generatedAt: new Date().toISOString() });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/vendors/:id/probe-history
  // Returns last-24h probe results for a single vendor.
  app.get('/api/vendors/:id/probe-history', async (req: any, res: any) => {
    const vendorId = req.params.id as string;
    try {
      const since = new Date(Date.now() - 24 * 3600_000);
      const { rows } = await pool.query(`
        SELECT probed_at, latency_ms, sip_response_code, reachable, error, connection_name, host
        FROM   vendor_probe_results
        WHERE  vendor_id = $1
          AND  probed_at >= $2
        ORDER  BY probed_at ASC
        LIMIT  2000
      `, [vendorId, since]);

      // Compute 24h uptime %
      const total = rows.length;
      const up    = rows.filter((r: any) => r.reachable).length;
      const uptimePct = total === 0 ? null : Math.round((up / total) * 100);

      res.json({ history: rows, uptimePct24h: uptimePct, vendorId });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/vendors/:id/probe-now
  // Immediately probe all connections of a vendor (on-demand).
  app.post('/api/vendors/:id/probe-now', async (req: any, res: any) => {
    const vendorId = req.params.id as string;
    try {
      const allConns = await getCachedConnections();
      const vendorConns = allConns.filter(c => String(c.i_vendor) === vendorId);

      if (!vendorConns.length) {
        return res.json({ success: false, message: 'No cached connections found for this vendor. Sync the routing cache first.' });
      }

      const vendorName = vendorConns[0].vendor_name ?? `Vendor#${vendorId}`;
      await probeVendorConnections(vendorId, vendorName, vendorConns, 0);
      await pruneOldProbeResults(vendorId);
      const firstHost = parseHostPort(vendorConns[0]?.host ?? null);
      if (firstHost) await handleVendorStateChange(vendorId, vendorName, firstHost.host);

      const status = await getVendorLatestStatus(vendorId);
      res.json({
        success:  true,
        probed:   vendorConns.length,
        reachable: status.reachable,
        latencyMs: status.latencyMs,
        lastProbed: status.lastProbed,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/vendors/probe-unreachable-count
  // Used by the Fix Button diagnostic to surface unreachable vendor count.
  app.get('/api/vendors/probe-unreachable-count', async (_req: any, res: any) => {
    try {
      const { rows } = await pool.query<{ vendor_id: string; reachable: boolean }>(`
        WITH latest_per_vendor AS (
          SELECT DISTINCT ON (vendor_id)
            vendor_id, reachable
          FROM   vendor_probe_results
          ORDER  BY vendor_id, probed_at DESC
        )
        SELECT vendor_id, reachable FROM latest_per_vendor
      `);

      const total       = rows.length;
      const unreachable = rows.filter(r => !r.reachable).length;
      const reachable   = total - unreachable;

      res.json({ total, reachable, unreachable, hasData: total > 0 });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
}

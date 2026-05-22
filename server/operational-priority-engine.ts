/**
 * Operational Priority Engine
 * Computes normalised urgency scores (0–100) for workspaces and cards
 * from existing DB signals — no new polling, read-only.
 */
import { db } from './db';
import {
  consoleIncidents, fasEvents, carrierQualityScores, approvalRequests,
} from '../shared/schema';
import { gte, eq } from 'drizzle-orm';

// ── Public types ───────────────────────────────────────────────────────────────
export interface WorkspaceUrgency {
  score:    number;        // 0–100 normalised
  dominant: string | null; // human-readable driver
}

export interface UrgencySnapshot {
  workspaces: Record<string, WorkspaceUrgency>;
  cards:      Record<string, number>;  // href → 0–100
  signals: {
    activeIncidents: { critical: number; high: number; total: number };
    fasEvents24h:    number;
    degradedCarriers: number;
    criticalCarriers: number;
    pendingApprovals: number;
  };
  computedAt: string;
}

// ── In-memory cache (30 s TTL) ─────────────────────────────────────────────────
let _cache: UrgencySnapshot | null = null;
let _cacheTs = 0;
const CACHE_TTL_MS = 30_000;

function clamp(n: number): number {
  return Math.min(100, Math.max(0, Math.round(n)));
}

// ── Engine ─────────────────────────────────────────────────────────────────────
export async function getUrgencyScores(forceRefresh = false): Promise<UrgencySnapshot> {
  if (!forceRefresh && _cache && Date.now() - _cacheTs < CACHE_TTL_MS) {
    return _cache;
  }

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Parallel DB reads — all from existing tables, read-only
  const [incidents, fasEvts, carriers, pending] = await Promise.all([
    db.select({ status: consoleIncidents.status, severity: consoleIncidents.severity })
      .from(consoleIncidents)
      .catch(() => [] as { status: string; severity: string }[]),

    db.select({ vendor: fasEvents.vendor, detectedAt: fasEvents.detectedAt })
      .from(fasEvents)
      .where(gte(fasEvents.detectedAt, since24h))
      .catch(() => [] as { vendor: string; detectedAt: Date }[]),

    db.select({ stabilityScore: carrierQualityScores.stabilityScore, carrierName: carrierQualityScores.carrierName })
      .from(carrierQualityScores)
      .catch(() => [] as { stabilityScore: number | null; carrierName: string }[]),

    db.select({ id: approvalRequests.id })
      .from(approvalRequests)
      .where(eq(approvalRequests.status, 'pending'))
      .catch(() => [] as { id: number }[]),
  ]);

  // ── Derived signals ────────────────────────────────────────────────────────
  const active   = incidents.filter(i => i.status === 'active' || i.status === 'open');
  const critical = active.filter(i => i.severity === 'critical').length;
  const high     = active.filter(i => i.severity === 'high').length;
  const medium   = active.filter(i => i.severity === 'medium').length;
  const fas24h   = fasEvts.length;

  const degraded  = carriers.filter(c => (c.stabilityScore ?? 100) < 55);
  const critCars  = carriers.filter(c => (c.stabilityScore ?? 100) < 30);
  const pendCount = pending.length;

  // ── Raw workspace scores (un-normalised) ──────────────────────────────────
  const incRaw  = critical * 35 + high * 20 + medium * 10;
  const fasRaw  = Math.min(fas24h * 5, 25);
  const degRaw  = degraded.length * 15 + critCars.length * 20;
  const pendRaw = Math.min(pendCount * 10, 30);

  const rawMap: Record<string, number> = {
    'live-ops':     incRaw + (fas24h > 0 ? 5 : 0),
    'vendors':      degRaw + fasRaw,
    'security':     incRaw * 0.8 + fasRaw * 1.2 + pendRaw,
    'intelligence': incRaw * 0.7 + degRaw * 0.5,
    'finance':      pendRaw + (pendCount > 2 ? 10 : 0),
    'clients':      pendRaw * 0.6,
    'analytics':    degraded.length * 5 + (active.length > 0 ? 5 : 0),
    'settings':     0,
  };

  // Normalise to 0–100 relative to current max
  const maxRaw = Math.max(...Object.values(rawMap), 1);

  const workspaces: Record<string, WorkspaceUrgency> = {};
  for (const [id, raw] of Object.entries(rawMap)) {
    const score = clamp((raw / maxRaw) * 100);
    let dominant: string | null = null;
    if (id === 'vendors'      && degraded.length > 0)   dominant = `${degraded.length} degraded`;
    if (id === 'security'     && critical > 0)           dominant = `${critical} critical`;
    if (id === 'security'     && pendCount > 0 && !dominant) dominant = `${pendCount} pending`;
    if (id === 'live-ops'     && active.length > 0)      dominant = `${active.length} active`;
    if (id === 'intelligence' && critical > 0)           dominant = `${critical} anomalies`;
    if (id === 'finance'      && pendCount > 0)          dominant = `${pendCount} pending`;
    workspaces[id] = { score, dominant };
  }

  // ── Card urgency scores (by href) ─────────────────────────────────────────
  const cards: Record<string, number> = {
    '/vendor-rca':                  clamp(degraded.length * 25 + critCars.length * 20),
    '/fraud':                       clamp(fas24h * 15 + critical * 10),
    '/approvals':                   clamp(pendCount * 12),
    '/noc-command':                 clamp(critical * 30 + high * 15),
    '/ai-ops':                      clamp(critical * 20 + degraded.length * 8),
    '/intelligence':                clamp(critical * 15 + degraded.length * 6),
    '/vendor-stability-timeline':   clamp(degraded.length * 18),
    '/carrier-intelligence':        clamp(degraded.length * 14 + critCars.length * 10),
    '/alerts':                      clamp(critical * 25 + high * 12 + medium * 6),
    '/bitseye2':                    clamp(critical * 10 + active.length * 5),
    '/balance':                     clamp(pendCount * 8),
    '/routing-intelligence':        clamp(degraded.length * 12 + critical * 8),
    '/vendor-prefix-intelligence':  clamp(degraded.length * 10),
    '/carrier-scoring':             clamp(degraded.length * 8),
    '/billing':                     clamp(pendCount * 10),
  };

  const snapshot: UrgencySnapshot = {
    workspaces,
    cards,
    signals: {
      activeIncidents:  { critical, high, total: active.length },
      fasEvents24h:     fas24h,
      degradedCarriers: degraded.length,
      criticalCarriers: critCars.length,
      pendingApprovals: pendCount,
    },
    computedAt: new Date().toISOString(),
  };

  _cache   = snapshot;
  _cacheTs = Date.now();
  return snapshot;
}

export function invalidateUrgencyCache() {
  _cacheTs = 0;
}

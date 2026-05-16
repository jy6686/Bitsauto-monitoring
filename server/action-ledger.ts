// server/action-ledger.ts
// ── Unified Action Contract Layer — append-only cross-system audit spine ──────
//
// Design: One row per EVENT, not per action. Every mutation system (C2 account
// actions and routing approvals) writes here via thin adapters. The source
// tables (account_actions, approval_requests) remain the domain source of truth.
// This ledger is the CORRELATED audit view — the place where correlated intent
// becomes visible across domains.
//
// Append semantics: never UPDATE rows in this table. Each state transition
// appends a new event row sharing the same ledger_id.
//
// Intent grouping: intent_id is a business-level grouping above ledger_id.
// Multiple ledger threads (different actions, possibly different domains) that
// serve the same operational objective share the same intent_id.
// Examples: "carrier-failure-mitigation", "cost-optimisation-2024-Q2"

import { Pool } from 'pg';
import { randomUUID } from 'crypto';

function getPool() {
  return new Pool({ connectionString: process.env.DATABASE_URL });
}

// ── Canonical event shape ─────────────────────────────────────────────────────

export type LedgerScope        = 'account' | 'routing' | 'system';
export type LedgerSourceSystem = 'C2' | 'ROUTING' | 'MANUAL';
export type LedgerEventType    =
  | 'created'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'snoozed'
  | 'executed'
  | 'execution_failed'
  | 'rolled_back'
  | 'verified';

export type LedgerApprovalState    = 'pending' | 'approved' | 'rejected' | 'snoozed';
export type LedgerExecutionState   = 'not_executed' | 'executing' | 'executed' | 'failed' | 'rolled_back';
export type LedgerVerificationState = 'not_applicable' | 'SUCCESS_CONFIRMED' | 'FAILED_CONFIRMED' | 'UNKNOWN_PENDING';

export interface LedgerEvent {
  ledgerId:           string;
  scope:              LedgerScope;
  sourceSystem:       LedgerSourceSystem;
  actionType:         string;
  entityId?:          string | null;
  entityName?:        string | null;
  payload?:           Record<string, unknown> | null;
  idempotencyKey?:    string | null;
  riskIndexSnapshot?: number | null;
  approvalState:      LedgerApprovalState;
  executionState:     LedgerExecutionState;
  verificationState:  LedgerVerificationState;
  sourceRecordId?:    string | null;
  eventType:          LedgerEventType;
  requestedBy?:       string | null;
  requestedByName?:   string | null;
  actorId?:           string | null;
  actorName?:         string | null;
  note?:              string | null;
  // Business-level grouping — groups multiple ledger threads under one objective
  intentId?:          string | null;
  intentLabel?:       string | null;
}

// ── Core append function ──────────────────────────────────────────────────────

export async function appendToLedger(event: LedgerEvent): Promise<void> {
  const pool = getPool();
  try {
    await pool.query(`
      INSERT INTO action_ledger
        (ledger_id, scope, source_system, action_type, entity_id, entity_name,
         payload, idempotency_key, risk_index_snapshot,
         approval_state, execution_state, verification_state,
         source_record_id, event_type,
         requested_by, requested_by_name, actor_id, actor_name, note,
         intent_id, intent_label,
         created_at)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,NOW())
    `, [
      event.ledgerId,
      event.scope,
      event.sourceSystem,
      event.actionType,
      event.entityId   ?? null,
      event.entityName ?? null,
      event.payload    ? JSON.stringify(event.payload) : null,
      event.idempotencyKey    ?? null,
      event.riskIndexSnapshot ?? null,
      event.approvalState,
      event.executionState,
      event.verificationState,
      event.sourceRecordId ?? null,
      event.eventType,
      event.requestedBy     ?? null,
      event.requestedByName ?? null,
      event.actorId         ?? null,
      event.actorName       ?? null,
      event.note            ?? null,
      event.intentId        ?? null,
      event.intentLabel     ?? null,
    ]);
  } catch (e: any) {
    // Ledger writes are best-effort — never block the primary mutation path
    console.error('[action-ledger] append failed (non-fatal):', e.message);
  } finally {
    await pool.end();
  }
}

// ── ledgerIdForC2Action ───────────────────────────────────────────────────────
// Deterministic ledger_id for C2 account actions: uses idempotency key when
// present (so re-runs of the same action share the same ledger thread),
// otherwise falls back to a fresh UUID.
export function ledgerIdForC2Action(idempotencyKey?: string | null): string {
  return idempotencyKey ? `c2:${idempotencyKey}` : `c2:${randomUUID()}`;
}

// ── ledgerIdForApproval ───────────────────────────────────────────────────────
// Each approval request gets a stable ledger_id based on its DB id so that
// all subsequent events (approved, rejected, rolled_back) share the same thread.
export function ledgerIdForApproval(requestId: number | string): string {
  return `routing:${requestId}`;
}

// ── Query helpers (used by the /api/action-ledger endpoint) ──────────────────

export interface LedgerQueryFilters {
  scope?:        LedgerScope;
  sourceSystem?: LedgerSourceSystem;
  entityId?:     string;
  ledgerId?:     string;
  eventType?:    LedgerEventType;
  fromIso?:      string;
  intentId?:     string;
  limit?:        number;
}

export async function queryLedger(filters: LedgerQueryFilters = {}): Promise<any[]> {
  const pool = getPool();
  try {
    const params: unknown[] = [];
    const conds: string[] = [];

    if (filters.scope)        { conds.push(`scope = $${params.length+1}`);         params.push(filters.scope); }
    if (filters.sourceSystem) { conds.push(`source_system = $${params.length+1}`); params.push(filters.sourceSystem); }
    if (filters.entityId)     { conds.push(`entity_id = $${params.length+1}`);     params.push(filters.entityId); }
    if (filters.ledgerId)     { conds.push(`ledger_id = $${params.length+1}`);     params.push(filters.ledgerId); }
    if (filters.eventType)    { conds.push(`event_type = $${params.length+1}`);    params.push(filters.eventType); }
    if (filters.fromIso)      { conds.push(`created_at >= $${params.length+1}`);   params.push(filters.fromIso); }
    if (filters.intentId)     { conds.push(`intent_id = $${params.length+1}`);     params.push(filters.intentId); }

    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const limit = Math.min(filters.limit ?? 200, 500);

    const r = await pool.query(
      `SELECT * FROM action_ledger ${where} ORDER BY created_at DESC LIMIT ${limit}`,
      params,
    );
    return r.rows;
  } finally {
    await pool.end();
  }
}

export async function queryLedgerStats(): Promise<any> {
  const pool = getPool();
  try {
    const [byScope, bySource, byEvent, recent, byIntent] = await Promise.all([
      pool.query(`SELECT scope, COUNT(*) AS cnt FROM action_ledger GROUP BY scope ORDER BY cnt DESC`),
      pool.query(`SELECT source_system, COUNT(*) AS cnt FROM action_ledger GROUP BY source_system ORDER BY cnt DESC`),
      pool.query(`SELECT event_type, COUNT(*) AS cnt FROM action_ledger GROUP BY event_type ORDER BY cnt DESC`),
      pool.query(`SELECT COUNT(*) AS total FROM action_ledger WHERE created_at >= NOW() - INTERVAL '24 hours'`),
      pool.query(`SELECT intent_id, intent_label, COUNT(*) AS cnt FROM action_ledger WHERE intent_id IS NOT NULL GROUP BY intent_id, intent_label ORDER BY cnt DESC LIMIT 20`),
    ]);
    return {
      byScope:        byScope.rows,
      bySourceSystem: bySource.rows,
      byEventType:    byEvent.rows,
      last24hEvents:  Number(recent.rows[0]?.total ?? 0),
      byIntent:       byIntent.rows,
    };
  } finally {
    await pool.end();
  }
}

// ── Correlation view ──────────────────────────────────────────────────────────
// Returns a structured view of all ledger activity for a given entity in a time
// window. Produces three lenses:
//   1. threads   — one entry per ledger_id showing the full event sequence
//   2. intentGroups — one entry per intent_id (business objective grouping)
//   3. clusters  — temporal bursts: sets of events across different ledger_ids
//                  that occurred within CLUSTER_GAP_SECONDS of each other

const CLUSTER_GAP_SECONDS = 300; // 5 minutes — events closer than this are "same cluster"

export interface LedgerThread {
  ledgerId:    string;
  sourceSystem: string;
  actionType:  string;
  events:      any[];
  startedAt:   Date;
  lastEventAt: Date;
}

export interface LedgerCluster {
  clusterIndex: number;
  startAt:      Date;
  endAt:        Date;
  ledgerIds:    string[];
  systems:      string[];
  eventCount:   number;
  events:       any[];
}

export interface LedgerIntentGroup {
  intentId:    string;
  intentLabel: string | null;
  ledgerIds:   string[];
  systems:     string[];
  eventCount:  number;
  events:      any[];
}

export interface LedgerCorrelationView {
  entityId:      string;
  windowMinutes: number;
  totalEvents:   number;
  threads:       LedgerThread[];
  clusters:      LedgerCluster[];
  intentGroups:  LedgerIntentGroup[];
  crossSystemThreadIds: string[];  // ledger_ids that span >1 source_system
}

export async function queryLedgerCorrelation(opts: {
  entityId:       string;
  windowMinutes?: number;
  limit?:         number;
}): Promise<LedgerCorrelationView> {
  const { entityId, windowMinutes = 30, limit = 500 } = opts;
  const pool = getPool();

  try {
    const since = new Date(Date.now() - windowMinutes * 60 * 1000);
    const r = await pool.query(
      `SELECT * FROM action_ledger
       WHERE entity_id = $1 AND created_at >= $2
       ORDER BY created_at ASC
       LIMIT $3`,
      [entityId, since.toISOString(), Math.min(limit, 500)],
    );
    const rows: any[] = r.rows;

    // ── 1. Thread grouping (by ledger_id) ──────────────────────────────────
    const threadMap = new Map<string, LedgerThread>();
    for (const row of rows) {
      const lid = row.ledger_id as string;
      if (!threadMap.has(lid)) {
        threadMap.set(lid, {
          ledgerId:    lid,
          sourceSystem: row.source_system,
          actionType:  row.action_type,
          events:      [],
          startedAt:   new Date(row.created_at),
          lastEventAt: new Date(row.created_at),
        });
      }
      const t = threadMap.get(lid)!;
      t.events.push(row);
      const ts = new Date(row.created_at);
      if (ts > t.lastEventAt) t.lastEventAt = ts;
    }
    const threads = [...threadMap.values()].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());

    // ── 2. Intent grouping (by intent_id) ──────────────────────────────────
    const intentMap = new Map<string, LedgerIntentGroup>();
    for (const row of rows) {
      if (!row.intent_id) continue;
      if (!intentMap.has(row.intent_id)) {
        intentMap.set(row.intent_id, {
          intentId:    row.intent_id,
          intentLabel: row.intent_label ?? null,
          ledgerIds:   [],
          systems:     [],
          eventCount:  0,
          events:      [],
        });
      }
      const g = intentMap.get(row.intent_id)!;
      g.events.push(row);
      g.eventCount++;
      if (!g.ledgerIds.includes(row.ledger_id)) g.ledgerIds.push(row.ledger_id);
      if (!g.systems.includes(row.source_system)) g.systems.push(row.source_system);
    }
    const intentGroups = [...intentMap.values()];

    // ── 3. Temporal cluster detection ──────────────────────────────────────
    // Walk events in time order; start a new cluster when the gap to the
    // previous event exceeds CLUSTER_GAP_SECONDS.
    const clusters: LedgerCluster[] = [];
    if (rows.length > 0) {
      let currentCluster: LedgerCluster = {
        clusterIndex: 0,
        startAt:      new Date(rows[0].created_at),
        endAt:        new Date(rows[0].created_at),
        ledgerIds:    [],
        systems:      [],
        eventCount:   0,
        events:       [],
      };

      for (const row of rows) {
        const ts      = new Date(row.created_at);
        const gapSecs = (ts.getTime() - currentCluster.endAt.getTime()) / 1000;

        if (gapSecs > CLUSTER_GAP_SECONDS && currentCluster.eventCount > 0) {
          clusters.push(currentCluster);
          currentCluster = {
            clusterIndex: clusters.length,
            startAt:      ts,
            endAt:        ts,
            ledgerIds:    [],
            systems:      [],
            eventCount:   0,
            events:       [],
          };
        }

        currentCluster.endAt = ts;
        currentCluster.eventCount++;
        currentCluster.events.push(row);
        if (!currentCluster.ledgerIds.includes(row.ledger_id)) currentCluster.ledgerIds.push(row.ledger_id);
        if (!currentCluster.systems.includes(row.source_system)) currentCluster.systems.push(row.source_system);
      }
      if (currentCluster.eventCount > 0) clusters.push(currentCluster);
    }

    // ── 4. Cross-system thread IDs ─────────────────────────────────────────
    const crossSystemThreadIds = threads
      .filter(t => {
        const allSystems = new Set(t.events.map((e: any) => e.source_system));
        return allSystems.size > 1;
      })
      .map(t => t.ledgerId);

    return {
      entityId,
      windowMinutes,
      totalEvents: rows.length,
      threads,
      clusters,
      intentGroups,
      crossSystemThreadIds,
    };
  } finally {
    await pool.end();
  }
}

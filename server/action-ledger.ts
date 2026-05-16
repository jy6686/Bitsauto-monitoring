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
         created_at)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,NOW())
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
    const [byScope, bySource, byEvent, recent] = await Promise.all([
      pool.query(`SELECT scope, COUNT(*) AS cnt FROM action_ledger GROUP BY scope ORDER BY cnt DESC`),
      pool.query(`SELECT source_system, COUNT(*) AS cnt FROM action_ledger GROUP BY source_system ORDER BY cnt DESC`),
      pool.query(`SELECT event_type, COUNT(*) AS cnt FROM action_ledger GROUP BY event_type ORDER BY cnt DESC`),
      pool.query(`SELECT COUNT(*) AS total FROM action_ledger WHERE created_at >= NOW() - INTERVAL '24 hours'`),
    ]);
    return {
      byScope:      byScope.rows,
      bySourceSystem: bySource.rows,
      byEventType:  byEvent.rows,
      last24hEvents: Number(recent.rows[0]?.total ?? 0),
    };
  } finally {
    await pool.end();
  }
}

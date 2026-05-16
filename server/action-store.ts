// server/action-store.ts
// ── C2 Action Store — DB CRUD for account_actions + Unified Ledger adapter ───
//
// Every state transition writes to account_actions (source of truth) AND
// appends an event to action_ledger (cross-system audit spine) via the thin
// action-ledger module. Ledger writes are best-effort and never block the
// primary mutation path.

import { Pool } from 'pg';
import {
  appendToLedger,
  ledgerIdForC2Action,
  type LedgerApprovalState,
  type LedgerExecutionState,
  type LedgerVerificationState,
} from './action-ledger';

type AuditEntry = {
  timestamp: string;
  event:     string;
  userId?:   string;
  userName?: string;
  details?:  string;
};

function getPool() {
  return new Pool({ connectionString: process.env.DATABASE_URL });
}

export async function listActions(filters: { accountId?: string; status?: string }) {
  const pool = getPool();
  try {
    let query = 'SELECT * FROM account_actions';
    const params: unknown[] = [];
    const conds: string[] = [];
    if (filters.accountId) { conds.push(`account_id = $${params.length + 1}`); params.push(filters.accountId); }
    if (filters.status)    { conds.push(`status = $${params.length + 1}`);     params.push(filters.status);    }
    if (conds.length) query += ' WHERE ' + conds.join(' AND ');
    query += ' ORDER BY created_at DESC LIMIT 200';
    const r = await pool.query(query, params);
    return r.rows;
  } finally { await pool.end(); }
}

// ── createAction with idempotency guard ───────────────────────────────────────
// If idempotencyKey already exists for a non-terminal action, returns that action
// instead of creating a duplicate. Terminal statuses (rejected/rolled_back) allow
// a new action with the same key (different hour bucket anyway).
export async function createAction(data: {
  accountId:         string;
  accountName:       string;
  actionType:        string;
  primaryAction:     string;
  recommendationRef: Record<string, unknown>;
  sippyParams:       Record<string, unknown>;
  requestedBy:       string;
  requestedByName:   string;
  idempotencyKey?:   string;
}) {
  const pool = getPool();
  try {
    // Idempotency check — return existing action if key already used in a live state
    if (data.idempotencyKey) {
      const existing = await pool.query(
        `SELECT * FROM account_actions
         WHERE idempotency_key = $1
           AND status NOT IN ('rejected','rolled_back')
         ORDER BY created_at DESC LIMIT 1`,
        [data.idempotencyKey],
      );
      if (existing.rows.length > 0) {
        return { ...existing.rows[0], _idempotent: true };
      }
    }

    const trail: AuditEntry[] = [{
      timestamp: new Date().toISOString(),
      event:     'created',
      userId:    data.requestedBy,
      userName:  data.requestedByName,
      details:   `Action created for ${data.accountName}`,
    }];
    const r = await pool.query(`
      INSERT INTO account_actions
        (account_id, account_name, action_type, status, execution_mode, primary_action,
         recommendation_ref, sippy_params, requested_by, requested_by_name, audit_trail,
         idempotency_key, verification_state, created_at, updated_at)
      VALUES ($1,$2,$3,'pending','dry_run',$4,$5,$6,$7,$8,$9,$10,'not_applicable',NOW(),NOW())
      RETURNING *
    `, [
      data.accountId, data.accountName, data.actionType, data.primaryAction,
      JSON.stringify(data.recommendationRef), JSON.stringify(data.sippyParams),
      data.requestedBy, data.requestedByName, JSON.stringify(trail),
      data.idempotencyKey ?? null,
    ]);
    const action = r.rows[0];

    // ── Ledger: created event ─────────────────────────────────────────────────
    await appendToLedger({
      ledgerId:          ledgerIdForC2Action(data.idempotencyKey),
      scope:             'account',
      sourceSystem:      'C2',
      actionType:        data.actionType,
      entityId:          data.accountId,
      entityName:        data.accountName,
      payload:           { primaryAction: data.primaryAction, sippyParams: data.sippyParams },
      idempotencyKey:    data.idempotencyKey ?? null,
      riskIndexSnapshot: null,
      approvalState:     'pending',
      executionState:    'not_executed',
      verificationState: 'not_applicable',
      sourceRecordId:    String(action.id),
      eventType:         'created',
      requestedBy:       data.requestedBy,
      requestedByName:   data.requestedByName,
      note:              `C2 action created for ${data.accountName}`,
    });

    return action;
  } finally { await pool.end(); }
}

export async function getAction(id: number) {
  const pool = getPool();
  try {
    const r = await pool.query('SELECT * FROM account_actions WHERE id = $1', [id]);
    return r.rows[0] ?? null;
  } finally { await pool.end(); }
}

export async function approveAction(
  id:                number,
  userId:            string,
  userName:          string,
  sippyResult:       Record<string, unknown>,
  newStatus:         string,
  verificationState: string,
) {
  const pool = getPool();
  try {
    const ex = await pool.query('SELECT * FROM account_actions WHERE id = $1', [id]);
    if (!ex.rows.length) return null;
    const row = ex.rows[0];
    const trail: AuditEntry[] = Array.isArray(row.audit_trail) ? row.audit_trail : [];
    trail.push({
      timestamp: new Date().toISOString(),
      event:     'approved',
      userId,
      userName,
      details:   newStatus === 'executed'
        ? `Approved and executed against Sippy — verification: ${verificationState}`
        : 'Dry-run approved — action recorded in audit ledger only',
    });
    const r = await pool.query(`
      UPDATE account_actions
      SET status=$1, approved_by=$2, approved_by_name=$3,
          sippy_result=$4, audit_trail=$5, verification_state=$6, updated_at=NOW()
      WHERE id=$7 RETURNING *
    `, [newStatus, userId, userName, JSON.stringify(sippyResult), JSON.stringify(trail), verificationState, id]);
    const updated = r.rows[0] ?? null;

    if (updated) {
      // ── Ledger: approved / executed event ──────────────────────────────────
      const execState: LedgerExecutionState = newStatus === 'executed' ? 'executed' : 'not_executed';
      const isExecFailed = newStatus === 'failed';
      await appendToLedger({
        ledgerId:          ledgerIdForC2Action(row.idempotency_key),
        scope:             'account',
        sourceSystem:      'C2',
        actionType:        row.action_type,
        entityId:          row.account_id,
        entityName:        row.account_name,
        payload:           { sippyResult },
        idempotencyKey:    row.idempotency_key,
        riskIndexSnapshot: row.risk_index ?? null,
        approvalState:     'approved',
        executionState:    isExecFailed ? 'failed' : execState,
        verificationState: verificationState as LedgerVerificationState,
        sourceRecordId:    String(id),
        eventType:         isExecFailed ? 'execution_failed' : (newStatus === 'executed' ? 'executed' : 'approved'),
        actorId:           userId,
        actorName:         userName,
        requestedBy:       row.requested_by,
        requestedByName:   row.requested_by_name,
        note:              isExecFailed
          ? `Execution failed — ${(sippyResult as any)?.error ?? 'unknown error'}`
          : newStatus === 'executed'
            ? `Executed against Sippy — verification: ${verificationState}`
            : 'Dry-run approval recorded',
      });
    }

    return updated;
  } finally { await pool.end(); }
}

export async function rejectAction(id: number, userId: string, userName: string, reason: string) {
  const pool = getPool();
  try {
    const ex = await pool.query('SELECT * FROM account_actions WHERE id = $1', [id]);
    if (!ex.rows.length) return null;
    const row = ex.rows[0];
    const trail: AuditEntry[] = Array.isArray(row.audit_trail) ? row.audit_trail : [];
    trail.push({ timestamp: new Date().toISOString(), event: 'rejected', userId, userName, details: reason || 'No reason provided' });
    const r = await pool.query(`
      UPDATE account_actions
      SET status='rejected', rejected_by=$1, rejection_reason=$2, audit_trail=$3, updated_at=NOW()
      WHERE id=$4 RETURNING *
    `, [userId, reason || null, JSON.stringify(trail), id]);
    const updated = r.rows[0] ?? null;

    if (updated) {
      // ── Ledger: rejected event ────────────────────────────────────────────
      await appendToLedger({
        ledgerId:          ledgerIdForC2Action(row.idempotency_key),
        scope:             'account',
        sourceSystem:      'C2',
        actionType:        row.action_type,
        entityId:          row.account_id,
        entityName:        row.account_name,
        idempotencyKey:    row.idempotency_key,
        riskIndexSnapshot: row.risk_index ?? null,
        approvalState:     'rejected',
        executionState:    'not_executed',
        verificationState: 'not_applicable',
        sourceRecordId:    String(id),
        eventType:         'rejected',
        actorId:           userId,
        actorName:         userName,
        requestedBy:       row.requested_by,
        requestedByName:   row.requested_by_name,
        note:              reason || 'No reason provided',
      });
    }

    return updated;
  } finally { await pool.end(); }
}

export async function snoozeAction(id: number, userId: string, userName: string, hours: number) {
  const pool = getPool();
  try {
    const snoozedUntil = new Date(Date.now() + hours * 60 * 60 * 1000);
    const ex = await pool.query('SELECT * FROM account_actions WHERE id = $1', [id]);
    if (!ex.rows.length) return null;
    const row = ex.rows[0];
    const trail: AuditEntry[] = Array.isArray(row.audit_trail) ? row.audit_trail : [];
    trail.push({ timestamp: new Date().toISOString(), event: 'snoozed', userId, userName, details: `Snoozed for ${hours}h until ${snoozedUntil.toISOString()}` });
    const r = await pool.query(`
      UPDATE account_actions
      SET status='snoozed', snoozed_until=$1, audit_trail=$2, updated_at=NOW()
      WHERE id=$3 RETURNING *
    `, [snoozedUntil.toISOString(), JSON.stringify(trail), id]);
    const updated = r.rows[0] ?? null;

    if (updated) {
      // ── Ledger: snoozed event ─────────────────────────────────────────────
      await appendToLedger({
        ledgerId:          ledgerIdForC2Action(row.idempotency_key),
        scope:             'account',
        sourceSystem:      'C2',
        actionType:        row.action_type,
        entityId:          row.account_id,
        entityName:        row.account_name,
        idempotencyKey:    row.idempotency_key,
        riskIndexSnapshot: row.risk_index ?? null,
        approvalState:     'snoozed',
        executionState:    'not_executed',
        verificationState: 'not_applicable',
        sourceRecordId:    String(id),
        eventType:         'snoozed',
        actorId:           userId,
        actorName:         userName,
        requestedBy:       row.requested_by,
        requestedByName:   row.requested_by_name,
        note:              `Snoozed for ${hours}h until ${snoozedUntil.toISOString()}`,
      });
    }

    return updated;
  } finally { await pool.end(); }
}

export async function rollbackAction(id: number, userId: string, userName: string) {
  const pool = getPool();
  try {
    const ex = await pool.query('SELECT * FROM account_actions WHERE id = $1', [id]);
    if (!ex.rows.length) return null;
    const row = ex.rows[0];
    const trail: AuditEntry[] = Array.isArray(row.audit_trail) ? row.audit_trail : [];
    trail.push({ timestamp: new Date().toISOString(), event: 'rolled_back', userId, userName, details: 'Action manually rolled back' });
    const r = await pool.query(`
      UPDATE account_actions
      SET status='rolled_back', audit_trail=$1, updated_at=NOW()
      WHERE id=$2 RETURNING *
    `, [JSON.stringify(trail), id]);
    const updated = r.rows[0] ?? null;

    if (updated) {
      // ── Ledger: rolled_back event ─────────────────────────────────────────
      await appendToLedger({
        ledgerId:          ledgerIdForC2Action(row.idempotency_key),
        scope:             'account',
        sourceSystem:      'C2',
        actionType:        row.action_type,
        entityId:          row.account_id,
        entityName:        row.account_name,
        idempotencyKey:    row.idempotency_key,
        riskIndexSnapshot: row.risk_index ?? null,
        approvalState:     'rejected',
        executionState:    'rolled_back',
        verificationState: 'not_applicable',
        sourceRecordId:    String(id),
        eventType:         'rolled_back',
        actorId:           userId,
        actorName:         userName,
        requestedBy:       row.requested_by,
        requestedByName:   row.requested_by_name,
        note:              'Action manually rolled back',
      });
    }

    return updated;
  } finally { await pool.end(); }
}

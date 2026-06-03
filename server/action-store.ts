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

// ── listPendingApproval ───────────────────────────────────────────────────────
// Returns all actions awaiting a second operator sign-off.
export async function listPendingApproval() {
  const pool = getPool();
  try {
    const r = await pool.query(
      `SELECT * FROM account_actions WHERE status = 'pending_approval' ORDER BY created_at DESC LIMIT 100`,
    );
    return r.rows;
  } finally { await pool.end(); }
}

// ── setPendingApproval ────────────────────────────────────────────────────────
// Transitions an action to pending_approval — written immediately after
// createAction for high-risk types when C2_EXECUTION_ENABLED=true.
export async function setPendingApproval(
  id:          number,
  userId:      string,
  userName:    string,
) {
  const pool = getPool();
  try {
    const ex = await pool.query('SELECT * FROM account_actions WHERE id = $1', [id]);
    if (!ex.rows.length) return null;
    const row = ex.rows[0];
    const trail: AuditEntry[] = Array.isArray(row.audit_trail) ? row.audit_trail : [];
    trail.push({
      timestamp: new Date().toISOString(),
      event:     'pending_approval',
      userId,
      userName,
      details:   'High-risk action submitted — awaiting second operator approval',
    });
    const r = await pool.query(`
      UPDATE account_actions
      SET status='pending_approval', audit_trail=$1, updated_at=NOW()
      WHERE id=$2 RETURNING *
    `, [JSON.stringify(trail), id]);
    const updated = r.rows[0] ?? null;

    if (updated) {
      await appendToLedger({
        ledgerId:          ledgerIdForC2Action(row.idempotency_key),
        scope:             'account',
        sourceSystem:      'C2',
        actionType:        row.action_type,
        entityId:          row.account_id,
        entityName:        row.account_name,
        payload:           { note: 'Awaiting second operator approval (four-eyes rule)' },
        idempotencyKey:    row.idempotency_key,
        riskIndexSnapshot: row.risk_index ?? null,
        approvalState:     'pending',
        executionState:    'not_executed',
        verificationState: 'not_applicable',
        sourceRecordId:    String(id),
        eventType:         'submitted',
        actorId:           userId,
        actorName:         userName,
        requestedBy:       row.requested_by,
        requestedByName:   row.requested_by_name,
        note:              'High-risk action submitted — awaiting second operator approval',
      });
    }

    return updated;
  } finally { await pool.end(); }
}

// ── atomicClaimPendingApproval ────────────────────────────────────────────────
// Atomically transitions an action from pending_approval → approving so only
// one concurrent operator can proceed to execution. Returns the claimed row, or
// null if the action no longer exists / is no longer in pending_approval state.
// This prevents two approvers racing to execute the same Sippy write.
export async function atomicClaimPendingApproval(
  id:       number,
  userId:   string,
  userName: string,
) {
  const pool = getPool();
  try {
    // Conditional UPDATE — only succeeds if status is still 'pending_approval'.
    // No SELECT before UPDATE, so the state-check and transition are atomic.
    const r = await pool.query(`
      UPDATE account_actions
      SET status='approving', approved_by=$1, approved_by_name=$2, updated_at=NOW()
      WHERE id=$3 AND status='pending_approval'
      RETURNING *
    `, [userId, userName, id]);
    return r.rows[0] ?? null;
  } finally { await pool.end(); }
}

// ── secondaryApproveAction ────────────────────────────────────────────────────
// Called after atomicClaimPendingApproval succeeds. Writes the final execution
// outcome (executed / dry_run_approved / failed) and appends ledger event.
export async function secondaryApproveAction(
  id:          number,
  userId:      string,
  userName:    string,
  sippyResult: Record<string, unknown>,
  newStatus:   string,
  verSt:       string,
) {
  const pool = getPool();
  try {
    // At this point the action is in 'approving' state (claimed by this caller).
    // Read the full row for audit_trail and ledger fields.
    const ex = await pool.query('SELECT * FROM account_actions WHERE id = $1', [id]);
    if (!ex.rows.length) return null;
    const row = ex.rows[0];

    const trail: AuditEntry[] = Array.isArray(row.audit_trail) ? row.audit_trail : [];
    trail.push({
      timestamp: new Date().toISOString(),
      event:     'secondary_approved',
      userId,
      userName,
      details:   newStatus === 'executed'
        ? `Second approval granted — executed against Sippy (verification: ${verSt})`
        : `Second approval granted (dry-run) — no live write`,
    });
    const r = await pool.query(`
      UPDATE account_actions
      SET status=$1, approved_by=$2, approved_by_name=$3,
          sippy_result=$4, audit_trail=$5, verification_state=$6, updated_at=NOW()
      WHERE id=$7 RETURNING *
    `, [newStatus, userId, userName, JSON.stringify(sippyResult), JSON.stringify(trail), verSt, id]);
    const updated = r.rows[0] ?? null;

    if (updated) {
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
        verificationState: verSt as LedgerVerificationState,
        sourceRecordId:    String(id),
        eventType:         isExecFailed ? 'execution_failed' : (newStatus === 'executed' ? 'executed' : 'approved'),
        actorId:           userId,
        actorName:         userName,
        requestedBy:       row.requested_by,
        requestedByName:   row.requested_by_name,
        note:              isExecFailed
          ? `Secondary approval: execution failed — ${(sippyResult as any)?.error ?? 'unknown'}`
          : newStatus === 'executed'
            ? `Secondary approval: executed against Sippy — verification: ${verSt}`
            : 'Secondary approval: dry-run recorded',
      });
    }

    return updated;
  } finally { await pool.end(); }
}

// ── secondaryRejectAction ─────────────────────────────────────────────────────
// Called when the second operator rejects a pending_approval action.
export async function secondaryRejectAction(
  id:       number,
  userId:   string,
  userName: string,
  reason:   string,
) {
  const pool = getPool();
  try {
    const ex = await pool.query('SELECT * FROM account_actions WHERE id = $1', [id]);
    if (!ex.rows.length) return null;
    const row = ex.rows[0];
    if (row.status !== 'pending_approval') return null;

    const trail: AuditEntry[] = Array.isArray(row.audit_trail) ? row.audit_trail : [];
    trail.push({
      timestamp: new Date().toISOString(),
      event:     'secondary_rejected',
      userId,
      userName,
      details:   reason || 'Second operator rejected — no reason provided',
    });
    const r = await pool.query(`
      UPDATE account_actions
      SET status='rejected', rejected_by=$1, rejection_reason=$2, audit_trail=$3, updated_at=NOW()
      WHERE id=$4 RETURNING *
    `, [userId, reason || null, JSON.stringify(trail), id]);
    const updated = r.rows[0] ?? null;

    if (updated) {
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
        note:              `Second operator rejected: ${reason || 'no reason provided'}`,
      });
    }

    return updated;
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

// ── createRollbackEntry ───────────────────────────────────────────────────────
// Inserts a sibling ROLLBACK row in account_actions and appends a ledger event.
// The original action is updated to rolled_back status by rollbackAction() after
// this call. The sibling row carries action_type='ROLLBACK' and references the
// original via recommendation_ref.originalActionId.
export async function createRollbackEntry(data: {
  originalActionId: number;
  accountId:        string;
  accountName:      string;
  rollbackNote:     string;
  sippyResult:      Record<string, unknown>;
  executedBy:       string;
  executedByName:   string;
  verificationState: string;
  reason?:          string;
}) {
  const pool = getPool();
  try {
    const reasonSuffix = data.reason ? ` — Reason: ${data.reason}` : '';
    const trail: AuditEntry[] = [{
      timestamp: new Date().toISOString(),
      event:     'rollback_executed',
      userId:    data.executedBy,
      userName:  data.executedByName,
      details:   `Rollback of action #${data.originalActionId}: ${data.rollbackNote}${reasonSuffix}`,
    }];
    const r = await pool.query(`
      INSERT INTO account_actions
        (account_id, account_name, action_type, status, execution_mode, primary_action,
         recommendation_ref, sippy_params, requested_by, requested_by_name, audit_trail,
         idempotency_key, verification_state, created_at, updated_at)
      VALUES ($1,$2,'ROLLBACK','executed','dry_run',$3,$4,$5,$6,$7,$8,NULL,$9,NOW(),NOW())
      RETURNING *
    `, [
      data.accountId,
      data.accountName,
      data.rollbackNote,
      JSON.stringify({ originalActionId: data.originalActionId, sippyResult: data.sippyResult }),
      JSON.stringify({}),
      data.executedBy,
      data.executedByName,
      JSON.stringify(trail),
      data.verificationState,
    ]);
    const sibling = r.rows[0];

    // ── Ledger: rollback executed event ───────────────────────────────────────
    await appendToLedger({
      ledgerId:          `c2:rollback:${data.originalActionId}:${Date.now()}`,
      scope:             'account',
      sourceSystem:      'C2',
      actionType:        'ROLLBACK',
      entityId:          data.accountId,
      entityName:        data.accountName,
      payload:           { originalActionId: data.originalActionId, sippyResult: data.sippyResult, note: data.rollbackNote, reason: data.reason ?? null },
      idempotencyKey:    null,
      riskIndexSnapshot: null,
      approvalState:     'approved',
      executionState:    'executed',
      verificationState: data.verificationState as LedgerVerificationState,
      sourceRecordId:    String(sibling.id),
      eventType:         'rolled_back',
      actorId:           data.executedBy,
      actorName:         data.executedByName,
      requestedBy:       data.executedBy,
      requestedByName:   data.executedByName,
      note:              `Rollback of action #${data.originalActionId}: ${data.rollbackNote}${reasonSuffix}`,
    });

    return sibling;
  } finally { await pool.end(); }
}

// ── verifyAction — re-reads Sippy state for UNKNOWN_PENDING actions ────────────
// Attempts getAccountInfo to confirm whether the previously executed write
// was actually applied. Only re-verifies when verification_state = UNKNOWN_PENDING.
export async function verifyAction(id: number, userId: string, userName: string): Promise<any | null> {
  const pool = getPool();
  try {
    const ex = await pool.query('SELECT * FROM account_actions WHERE id = $1', [id]);
    if (!ex.rows.length) return null;
    const row = ex.rows[0];

    if (row.verification_state !== 'UNKNOWN_PENDING') {
      return row;
    }

    const sippyResult = (row.sippy_result ?? {}) as Record<string, unknown>;
    const sippyMethod  = (sippyResult.sippyMethod ?? row.sippy_params?.method ?? '') as string;
    const sippyParams  = (row.sippy_params ?? {}) as Record<string, unknown>;

    let newVerificationState: string = 'UNKNOWN_PENDING';
    let reVerifyData: Record<string, unknown> = {
      reVerifiedAt:  new Date().toISOString(),
      reVerifiedBy:  userName,
      previousState: 'UNKNOWN_PENDING',
    };

    if (sippyMethod === 'updateAccount' || sippyMethod === 'customer.updateAccount') {
      const iAccountRaw = sippyParams.i_account;
      if (iAccountRaw !== undefined && iAccountRaw !== null) {
        const { callSippyXmlRpc } = await import('./sippy');
        const verifyResult = await callSippyXmlRpc('getAccountInfo', {
          i_account: parseInt(String(iAccountRaw), 10),
        });
        newVerificationState = verifyResult.success ? 'SUCCESS_CONFIRMED' : 'FAILED_CONFIRMED';
        reVerifyData = {
          ...reVerifyData,
          sippySuccess: verifyResult.success,
          sippyStatus:  verifyResult.statusCode ?? null,
          preview:      verifyResult.rawBody?.slice(0, 300) ?? null,
        };
      }
    }

    const trail: AuditEntry[] = Array.isArray(row.audit_trail) ? row.audit_trail : [];
    trail.push({
      timestamp: new Date().toISOString(),
      event:     're_verified',
      userId,
      userName,
      details:   `Re-verification result: ${newVerificationState}`,
    });

    const updatedSippyResult = { ...sippyResult, reVerify: reVerifyData };

    const r = await pool.query(`
      UPDATE account_actions
      SET verification_state=$1, sippy_result=$2, audit_trail=$3, updated_at=NOW()
      WHERE id=$4 RETURNING *
    `, [newVerificationState, JSON.stringify(updatedSippyResult), JSON.stringify(trail), id]);

    const updated = r.rows[0] ?? null;

    if (updated) {
      await appendToLedger({
        ledgerId:          ledgerIdForC2Action(row.idempotency_key),
        scope:             'account',
        sourceSystem:      'C2',
        actionType:        row.action_type,
        entityId:          row.account_id,
        entityName:        row.account_name,
        idempotencyKey:    row.idempotency_key,
        riskIndexSnapshot: row.risk_index ?? null,
        approvalState:     'approved',
        executionState:    'executed',
        verificationState: newVerificationState as LedgerVerificationState,
        sourceRecordId:    String(id),
        eventType:         'verified',
        actorId:           userId,
        actorName:         userName,
        requestedBy:       row.requested_by,
        requestedByName:   row.requested_by_name,
        note:              `Re-verification: ${newVerificationState}`,
      });
    }

    return updated;
  } finally { await pool.end(); }
}

export async function rollbackAction(id: number, userId: string, userName: string, reason?: string) {
  const pool = getPool();
  try {
    const ex = await pool.query('SELECT * FROM account_actions WHERE id = $1', [id]);
    if (!ex.rows.length) return null;
    const row = ex.rows[0];
    const trail: AuditEntry[] = Array.isArray(row.audit_trail) ? row.audit_trail : [];
    const details = reason ? `Action manually rolled back — Reason: ${reason}` : 'Action manually rolled back';
    trail.push({ timestamp: new Date().toISOString(), event: 'rolled_back', userId, userName, details });
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
        note:              reason ? `Action manually rolled back — Reason: ${reason}` : 'Action manually rolled back',
      });
    }

    return updated;
  } finally { await pool.end(); }
}

// ── getApprovalTtlMinutes ─────────────────────────────────────────────────────
// Reads the dual-approval TTL from the settings table first; falls back to the
// DUAL_APPROVAL_TTL_MINUTES environment variable, then to the hard-coded default
// of 30 minutes.  Clamped to the range [5, 480].
export async function getApprovalTtlMinutes(): Promise<number> {
  const pool = getPool();
  try {
    const r = await pool.query(
      `SELECT dual_approval_ttl_minutes FROM settings ORDER BY id LIMIT 1`,
    );
    if (r.rows.length > 0 && r.rows[0].dual_approval_ttl_minutes != null) {
      const dbVal = parseInt(r.rows[0].dual_approval_ttl_minutes, 10);
      if (Number.isFinite(dbVal) && dbVal >= 5) {
        return Math.min(dbVal, 480);
      }
    }
  } catch {
    // Non-fatal — fall through to env var / default
  } finally {
    await pool.end();
  }
  // Fallback: env var → hard default (also clamp to [5, 480])
  const rawEnv = parseInt(process.env.DUAL_APPROVAL_TTL_MINUTES ?? '30', 10);
  return Number.isFinite(rawEnv) && rawEnv >= 5 ? Math.min(rawEnv, 480) : 30;
}

// ── expireStaleApprovals ──────────────────────────────────────────────────────
// Background job helper — expires pending_approval actions older than
// the configured TTL (DB setting → env var → 30 min). Each expired action is
// transitioned to 'rejected' with a system audit trail entry and a ledger event.
// Returns the count of actions expired in this sweep.
export async function expireStaleApprovals(): Promise<number> {
  const ttlMinutes = await getApprovalTtlMinutes();

  const pool = getPool();
  try {
    const stale = await pool.query(
      `SELECT * FROM account_actions
       WHERE status = 'pending_approval'
         AND updated_at < NOW() - ($1 || ' minutes')::interval
       ORDER BY updated_at ASC`,
      [ttlMinutes],
    );

    if (stale.rows.length === 0) return 0;

    const REASON = 'Approval expired — no second operator action taken';
    const now = new Date().toISOString();
    let expiredCount = 0;

    for (const row of stale.rows) {
      const trail: AuditEntry[] = Array.isArray(row.audit_trail) ? row.audit_trail : [];
      trail.push({
        timestamp: now,
        event:     'auto_expired',
        userId:    'system',
        userName:  'System (auto-expiry)',
        details:   `${REASON} after ${ttlMinutes} minute TTL`,
      });

      // Atomic conditional UPDATE — only transitions if still in pending_approval.
      // rowCount=0 means a concurrent approve/reject already claimed this row.
      const result = await pool.query(
        `UPDATE account_actions
         SET status='rejected', rejected_by='system',
             rejection_reason=$1, audit_trail=$2, updated_at=NOW()
         WHERE id=$3 AND status='pending_approval'`,
        [REASON, JSON.stringify(trail), row.id],
      );

      if ((result.rowCount ?? 0) === 0) {
        // Race: another operator acted between SELECT and UPDATE — skip ledger.
        console.debug(`[approval-expiry] Action #${row.id} already resolved (skipped)`);
        continue;
      }

      expiredCount++;
      console.log(`[approval-expiry] Action #${row.id} (${row.account_name}) expired after ${ttlMinutes}m TTL`);

      appendToLedger({
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
        sourceRecordId:    String(row.id),
        eventType:         'rejected',
        actorId:           'system',
        actorName:         'System (auto-expiry)',
        requestedBy:       row.requested_by,
        requestedByName:   row.requested_by_name,
        note:              `${REASON} after ${ttlMinutes}m TTL`,
      }).catch((e: any) =>
        console.warn(`[approval-expiry] Ledger append failed for action ${row.id}:`, e.message),
      );
    }

    return expiredCount;
  } finally {
    await pool.end();
  }
}

// server/action-store.ts
// ── C2 Action Ledger — DB CRUD for account_actions ───────────────────────────

import { Pool } from 'pg';

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

export async function createAction(data: {
  accountId:         string;
  accountName:       string;
  actionType:        string;
  primaryAction:     string;
  recommendationRef: Record<string, unknown>;
  sippyParams:       Record<string, unknown>;
  requestedBy:       string;
  requestedByName:   string;
}) {
  const pool = getPool();
  try {
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
         created_at, updated_at)
      VALUES ($1,$2,$3,'pending','dry_run',$4,$5,$6,$7,$8,$9,NOW(),NOW())
      RETURNING *
    `, [
      data.accountId, data.accountName, data.actionType, data.primaryAction,
      JSON.stringify(data.recommendationRef), JSON.stringify(data.sippyParams),
      data.requestedBy, data.requestedByName, JSON.stringify(trail),
    ]);
    return r.rows[0];
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
  id:         number,
  userId:     string,
  userName:   string,
  sippyResult: unknown,
  newStatus:  string,
) {
  const pool = getPool();
  try {
    const ex = await pool.query('SELECT audit_trail FROM account_actions WHERE id = $1', [id]);
    if (!ex.rows.length) return null;
    const trail: AuditEntry[] = Array.isArray(ex.rows[0].audit_trail) ? ex.rows[0].audit_trail : [];
    trail.push({
      timestamp: new Date().toISOString(),
      event:     'approved',
      userId,
      userName,
      details:   newStatus === 'executed'
        ? 'Approved and executed against Sippy'
        : 'Dry-run approved — action recorded in audit ledger only',
    });
    const r = await pool.query(`
      UPDATE account_actions
      SET status=$1, approved_by=$2, approved_by_name=$3,
          sippy_result=$4, audit_trail=$5, updated_at=NOW()
      WHERE id=$6 RETURNING *
    `, [newStatus, userId, userName, JSON.stringify(sippyResult), JSON.stringify(trail), id]);
    return r.rows[0] ?? null;
  } finally { await pool.end(); }
}

export async function rejectAction(id: number, userId: string, userName: string, reason: string) {
  const pool = getPool();
  try {
    const ex = await pool.query('SELECT audit_trail FROM account_actions WHERE id = $1', [id]);
    if (!ex.rows.length) return null;
    const trail: AuditEntry[] = Array.isArray(ex.rows[0].audit_trail) ? ex.rows[0].audit_trail : [];
    trail.push({ timestamp: new Date().toISOString(), event: 'rejected', userId, userName, details: reason || 'No reason provided' });
    const r = await pool.query(`
      UPDATE account_actions
      SET status='rejected', rejected_by=$1, rejection_reason=$2, audit_trail=$3, updated_at=NOW()
      WHERE id=$4 RETURNING *
    `, [userId, reason || null, JSON.stringify(trail), id]);
    return r.rows[0] ?? null;
  } finally { await pool.end(); }
}

export async function snoozeAction(id: number, userId: string, userName: string, hours: number) {
  const pool = getPool();
  try {
    const snoozedUntil = new Date(Date.now() + hours * 60 * 60 * 1000);
    const ex = await pool.query('SELECT audit_trail FROM account_actions WHERE id = $1', [id]);
    if (!ex.rows.length) return null;
    const trail: AuditEntry[] = Array.isArray(ex.rows[0].audit_trail) ? ex.rows[0].audit_trail : [];
    trail.push({ timestamp: new Date().toISOString(), event: 'snoozed', userId, userName, details: `Snoozed for ${hours}h until ${snoozedUntil.toISOString()}` });
    const r = await pool.query(`
      UPDATE account_actions
      SET status='snoozed', snoozed_until=$1, audit_trail=$2, updated_at=NOW()
      WHERE id=$3 RETURNING *
    `, [snoozedUntil.toISOString(), JSON.stringify(trail), id]);
    return r.rows[0] ?? null;
  } finally { await pool.end(); }
}

export async function rollbackAction(id: number, userId: string, userName: string) {
  const pool = getPool();
  try {
    const ex = await pool.query('SELECT audit_trail FROM account_actions WHERE id = $1', [id]);
    if (!ex.rows.length) return null;
    const trail: AuditEntry[] = Array.isArray(ex.rows[0].audit_trail) ? ex.rows[0].audit_trail : [];
    trail.push({ timestamp: new Date().toISOString(), event: 'rolled_back', userId, userName, details: 'Action manually rolled back' });
    const r = await pool.query(`
      UPDATE account_actions
      SET status='rolled_back', audit_trail=$1, updated_at=NOW()
      WHERE id=$2 RETURNING *
    `, [JSON.stringify(trail), id]);
    return r.rows[0] ?? null;
  } finally { await pool.end(); }
}

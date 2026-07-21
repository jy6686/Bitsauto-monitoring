/**
 * Commercial Workspace — Execution Engine  (D1.1)
 * ================================================
 * Single entry point for ALL Commercial Workspace mutations.
 *
 * Pipeline:
 *   Business Module
 *       ↓
 *   validateRateTransition()   ← caller's responsibility, before this function
 *       ↓
 *   executeWorkflowAction()
 *       ↓
 *   BEGIN
 *       ↓
 *   INSERT workflow_events  (seq computed atomically)
 *       ↓
 *   projectFn(client)       ← optional projection: rate_notification_jobs etc.
 *       ↓
 *   COMMIT
 *
 * Governance rules (permanent):
 *   1. No route writes directly to workflow_events.
 *   2. workflow_events is append-only — never UPDATE or DELETE.
 *   3. Business modules never update lifecycle projections directly.
 *      Only projectFn (called from here) may do so.
 *   4. Event is written BEFORE the projection inside one transaction.
 *      If the projection update fails, both roll back.
 *   5. deriveJobState() is a recovery function — normal runtime trusts the
 *      projection; recovery trusts the event stream.
 */

import { pool } from '../../db';
import type { PoolClient } from 'pg';
import { RATE_EVENT_TO_STATUS } from './event-taxonomy';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ExecuteOptions {
  subjectType:    'rate_job' | 'account' | 'quality_alert' | 'balance_alert' | 'followup' | string;
  subjectId:      string;
  eventType:      string;
  status?:        'pending' | 'completed' | 'failed';
  workspace?:     string;
  performedBy?:   string;
  assignedTo?:    string;
  correlationId?: string;
  parentEventId?: number;
  metadata?:      Record<string, unknown>;
}

export interface WorkflowEventRecord {
  id:            number;
  subjectType:   string;
  subjectId:     string;
  eventType:     string;
  status:        string;
  workspace:     string | null;
  performedBy:   string | null;
  assignedTo:    string | null;
  occurredAt:    Date;
  completedAt:   Date | null;
  metadata:      unknown;
  correlationId: string | null;
  parentEventId: number | null;
  seq:           number | null;
}

export interface EventQuery {
  subjectType?:   string;
  subjectId?:     string;
  correlationId?: string;
  eventType?:     string;
  workspace?:     string;
  performedBy?:   string;
  since?:         Date;
  limit?:         number;
  offset?:        number;
}

/** Called inside the same transaction as the event insert — used for projections */
export type ProjectFn = (client: PoolClient) => Promise<void>;

// ── Table initialisation (idempotent) ─────────────────────────────────────────

export async function initWorkflowEventsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workflow_events (
      id              SERIAL PRIMARY KEY,
      subject_type    VARCHAR(64)  NOT NULL,
      subject_id      VARCHAR(128) NOT NULL,
      event_type      VARCHAR(64)  NOT NULL,
      status          VARCHAR(32)  NOT NULL DEFAULT 'completed',
      workspace       VARCHAR(64)           DEFAULT 'commercial',
      performed_by    VARCHAR(128),
      assigned_to     VARCHAR(128),
      occurred_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      completed_at    TIMESTAMPTZ,
      metadata        JSONB,
      correlation_id  VARCHAR(128),
      parent_event_id INTEGER,
      seq             INTEGER
    )
  `);

  // Add seq column to existing tables that were created before D1.1
  await pool.query(`
    ALTER TABLE workflow_events ADD COLUMN IF NOT EXISTS seq INTEGER
  `);

  // Indices for the most common read patterns
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_workflow_events_subject
      ON workflow_events (subject_type, subject_id, occurred_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_workflow_events_correlation
      ON workflow_events (correlation_id, seq ASC NULLS LAST)
      WHERE correlation_id IS NOT NULL
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_workflow_events_workspace
      ON workflow_events (workspace, occurred_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_workflow_events_event_type
      ON workflow_events (event_type, occurred_at DESC)
  `);
}

// ── Execution Engine ──────────────────────────────────────────────────────────

/**
 * The single write entry point for ALL Commercial Workspace execution actions.
 *
 * When `projectFn` is provided it runs inside the same DB transaction as the
 * event INSERT — either both commit or both roll back.
 *
 * Usage (rate lifecycle example):
 *
 *   // 1. Business module validates the transition (permission + legal state)
 *   validateRateTransition(job.status, 'approved');
 *
 *   // 2. Execute — engine writes event + calls projection inside one txn
 *   const event = await executeWorkflowAction(
 *     {
 *       subjectType:   'rate_job',
 *       subjectId:     String(job.id),
 *       eventType:     RATE_JOB.APPROVED,
 *       performedBy:   req.user?.name,
 *       correlationId: makeCorrelationId('rate_job', job.id),
 *       metadata:      { jobRef: job.jobRef, clientName: job.clientName },
 *     },
 *     async (client) => projectRateLifecycle(job.id, 'approved', client)
 *   );
 */
export async function executeWorkflowAction(
  opts:      ExecuteOptions,
  projectFn?: ProjectFn,
): Promise<WorkflowEventRecord> {

  if (!opts.subjectType?.trim()) throw new Error('executeWorkflowAction: subjectType is required');
  if (!opts.subjectId?.trim())   throw new Error('executeWorkflowAction: subjectId is required');
  if (!opts.eventType?.trim())   throw new Error('executeWorkflowAction: eventType is required');

  const status    = opts.status    ?? 'completed';
  const workspace = opts.workspace ?? 'commercial';

  if (projectFn) {
    // ── Transactional path: event + projection in one atomic commit ────────
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // seq is scoped per correlationId — computed atomically inside the txn
      const seqSql = opts.correlationId
        ? `(SELECT COALESCE(MAX(seq), 0) + 1 FROM workflow_events WHERE correlation_id = $9)`
        : `NULL`;

      const insertSql = `
        INSERT INTO workflow_events
          (subject_type, subject_id, event_type, status, workspace,
           performed_by, assigned_to, occurred_at,
           metadata, correlation_id, parent_event_id, seq)
        VALUES
          ($1, $2, $3, $4, $5,
           $6, $7, NOW(),
           $8, $9, $10, ${seqSql})
        RETURNING
          id,
          subject_type    AS "subjectType",
          subject_id      AS "subjectId",
          event_type      AS "eventType",
          status, workspace,
          performed_by    AS "performedBy",
          assigned_to     AS "assignedTo",
          occurred_at     AS "occurredAt",
          completed_at    AS "completedAt",
          metadata,
          correlation_id  AS "correlationId",
          parent_event_id AS "parentEventId",
          seq
      `;

      const result = await client.query<WorkflowEventRecord>(insertSql, [
        opts.subjectType,
        opts.subjectId,
        opts.eventType,
        status,
        workspace,
        opts.performedBy   ?? null,
        opts.assignedTo    ?? null,
        opts.metadata      ? JSON.stringify(opts.metadata) : null,
        opts.correlationId ?? null,
        opts.parentEventId ?? null,
      ]);

      const event = result.rows[0];

      // Projection runs AFTER event is written, BEFORE commit
      await projectFn(client);

      await client.query('COMMIT');
      return event;

    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

  } else {
    // ── Non-transactional path: event only (no projection needed) ─────────
    const seqSubquery = opts.correlationId
      ? `(SELECT COALESCE(MAX(seq), 0) + 1 FROM workflow_events WHERE correlation_id = $9)`
      : `NULL`;

    const result = await pool.query<WorkflowEventRecord>(`
      INSERT INTO workflow_events
        (subject_type, subject_id, event_type, status, workspace,
         performed_by, assigned_to, occurred_at,
         metadata, correlation_id, parent_event_id, seq)
      VALUES
        ($1, $2, $3, $4, $5,
         $6, $7, NOW(),
         $8, $9, $10, ${seqSubquery})
      RETURNING
        id,
        subject_type    AS "subjectType",
        subject_id      AS "subjectId",
        event_type      AS "eventType",
        status, workspace,
        performed_by    AS "performedBy",
        assigned_to     AS "assignedTo",
        occurred_at     AS "occurredAt",
        completed_at    AS "completedAt",
        metadata,
        correlation_id  AS "correlationId",
        parent_event_id AS "parentEventId",
        seq
    `, [
      opts.subjectType,
      opts.subjectId,
      opts.eventType,
      status,
      workspace,
      opts.performedBy   ?? null,
      opts.assignedTo    ?? null,
      opts.metadata      ? JSON.stringify(opts.metadata) : null,
      opts.correlationId ?? null,
      opts.parentEventId ?? null,
    ]);

    return result.rows[0];
  }
}

// ── Query helpers (read projections) ─────────────────────────────────────────

export async function queryWorkflowEvents(
  q: EventQuery
): Promise<WorkflowEventRecord[]> {

  const conditions: string[] = [];
  const params:     unknown[] = [];
  let   idx = 1;

  if (q.subjectType) { conditions.push(`subject_type = $${idx++}`); params.push(q.subjectType); }
  if (q.subjectId)   { conditions.push(`subject_id = $${idx++}`);   params.push(q.subjectId); }
  if (q.correlationId) { conditions.push(`correlation_id = $${idx++}`); params.push(q.correlationId); }
  if (q.eventType) {
    if (q.eventType.endsWith('.')) {
      conditions.push(`event_type LIKE $${idx++}`);
      params.push(`${q.eventType}%`);
    } else {
      conditions.push(`event_type = $${idx++}`);
      params.push(q.eventType);
    }
  }
  if (q.workspace)   { conditions.push(`workspace = $${idx++}`);    params.push(q.workspace); }
  if (q.performedBy) { conditions.push(`performed_by = $${idx++}`); params.push(q.performedBy); }
  if (q.since)       { conditions.push(`occurred_at >= $${idx++}`); params.push(q.since); }

  const where  = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit  = Math.min(q.limit  ?? 50, 500);
  const offset = q.offset ?? 0;

  const res = await pool.query<WorkflowEventRecord>(`
    SELECT
      id,
      subject_type    AS "subjectType",
      subject_id      AS "subjectId",
      event_type      AS "eventType",
      status, workspace,
      performed_by    AS "performedBy",
      assigned_to     AS "assignedTo",
      occurred_at     AS "occurredAt",
      completed_at    AS "completedAt",
      metadata,
      correlation_id  AS "correlationId",
      parent_event_id AS "parentEventId",
      seq
    FROM  workflow_events
    ${where}
    ORDER BY COALESCE(seq, 0) ASC, occurred_at ASC
    LIMIT  $${idx++}
    OFFSET $${idx}
  `, [...params, limit, offset]);

  return res.rows;
}

/** Full lifecycle for one workflow instance — ordered by seq, then occurred_at */
export async function getWorkflowTimeline(
  correlationId: string
): Promise<WorkflowEventRecord[]> {
  return queryWorkflowEvents({ correlationId, limit: 200 });
}

/** History for a specific subject — most recent first */
export async function getSubjectHistory(
  subjectType: string,
  subjectId:   string,
  limit = 50
): Promise<WorkflowEventRecord[]> {
  const res = await pool.query<WorkflowEventRecord>(`
    SELECT
      id, subject_type AS "subjectType", subject_id AS "subjectId",
      event_type AS "eventType", status, workspace,
      performed_by AS "performedBy", assigned_to AS "assignedTo",
      occurred_at AS "occurredAt", completed_at AS "completedAt",
      metadata, correlation_id AS "correlationId",
      parent_event_id AS "parentEventId", seq
    FROM  workflow_events
    WHERE subject_type = $1 AND subject_id = $2
    ORDER BY occurred_at DESC
    LIMIT $3
  `, [subjectType, subjectId, Math.min(limit, 200)]);

  return res.rows;
}

// ── Recovery: deriveJobState ──────────────────────────────────────────────────
//
// ADMINISTRATIVE / RECOVERY function — NOT used in the normal runtime path.
//
// Normal runtime: trust the projection (rate_notification_jobs.status)
// Recovery path:  trust the event stream (workflow_events)
//
// Usage:
//   const derivedState = await deriveJobState(jobId);
//   if (derivedState) await projectRateLifecycle(jobId, derivedState);

/**
 * Reconstruct the current rate job state from the event stream.
 * Returns null if no events exist for the job.
 *
 * The state is the status mapped from the highest-seq (or latest occurred_at)
 * lifecycle event found in workflow_events for this job.
 */
export async function deriveJobState(jobId: number): Promise<string | null> {
  const res = await pool.query<{ event_type: string; seq: number | null; occurred_at: Date }>(`
    SELECT event_type, seq, occurred_at
    FROM   workflow_events
    WHERE  subject_type = 'rate_job'
      AND  subject_id   = $1
    ORDER  BY COALESCE(seq, 0) DESC, occurred_at DESC
    LIMIT  1
  `, [String(jobId)]);

  if (!res.rows.length) return null;

  const latestEventType = res.rows[0].event_type;
  return RATE_EVENT_TO_STATUS[latestEventType] ?? null;
}

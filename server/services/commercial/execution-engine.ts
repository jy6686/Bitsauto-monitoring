/**
 * Commercial Workspace — Execution Engine
 * ========================================
 * Phase 1 of the Execution Layer (Commercial Workspace v2).
 *
 * Every mutation in the Commercial Workspace must pass through
 * executeWorkflowAction().  No route writes directly to workflow_events.
 *
 * Pipeline:
 *   validate()  →  perform()  →  writeEvent()  →  return event
 *
 * All Timeline, Audit, Follow-up, and Action Center views are READ projections
 * over the workflow_events table — they never write directly.
 *
 * Canonical event taxonomy (extend here when adding new workflows):
 *
 *   rate_job.*
 *     rate_job.created | rate_job.approved | rate_job.rejected
 *     rate_job.activated | rate_job.verification_passed
 *     rate_job.verification_failed | rate_job.customer_notified
 *
 *   followup.*
 *     followup.created | followup.started | followup.completed
 *     followup.dismissed | followup.assigned
 *
 *   quality.*
 *     quality.alert_acknowledged | quality.alert_escalated
 *
 *   balance.*
 *     balance.warning_acknowledged
 *
 *   workflow.*
 *     workflow.note_added
 */

import { pool } from '../../db';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ExecuteOptions {
  /** The object being acted upon — must match a canonical subject_type */
  subjectType:    'rate_job' | 'account' | 'quality_alert' | 'balance_alert' | string;
  /** Primary key or synthetic UUID of the subject */
  subjectId:      string;
  /** Dot-notation event descriptor — e.g. "rate_job.approved" */
  eventType:      string;
  /** Initial status; defaults to 'completed' for synchronous actions */
  status?:        'pending' | 'completed' | 'failed';
  /** Workspace context; defaults to 'commercial' */
  workspace?:     string;
  /** Replit username or internal actor identifier */
  performedBy?:   string;
  /** Assignee for follow-up events */
  assignedTo?:    string;
  /** Groups all events in a single workflow instance */
  correlationId?: string;
  /** Optional parent event for chaining within a workflow */
  parentEventId?: number;
  /** Free-form payload — all workflow-specific detail goes here */
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
}

export interface EventQuery {
  subjectType?:    string;
  subjectId?:      string;
  correlationId?:  string;
  eventType?:      string;
  workspace?:      string;
  performedBy?:    string;
  since?:          Date;
  limit?:          number;
  offset?:         number;
}

// ── Table initialisation ───────────────────────────────────────────────────────
// Called once at server startup from registerCommercialRoutes().
// Uses CREATE TABLE IF NOT EXISTS — fully idempotent.

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
      parent_event_id INTEGER
    )
  `);

  // Indices for the most common read patterns
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_workflow_events_subject
      ON workflow_events (subject_type, subject_id, occurred_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_workflow_events_correlation
      ON workflow_events (correlation_id, occurred_at DESC)
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
 * The single entry point for ALL Commercial Workspace mutations.
 *
 * Usage:
 *   const event = await executeWorkflowAction({
 *     subjectType:   'rate_job',
 *     subjectId:     String(job.id),
 *     eventType:     'rate_job.approved',
 *     performedBy:   req.user?.name ?? 'system',
 *     correlationId: `rate_job_${job.id}`,
 *     metadata:      { jobRef: job.jobRef, clientName: job.clientName },
 *   });
 */
export async function executeWorkflowAction(
  opts: ExecuteOptions
): Promise<WorkflowEventRecord> {

  // ── 1. Validate ─────────────────────────────────────────────────────────────
  if (!opts.subjectType?.trim()) throw new Error('executeWorkflowAction: subjectType is required');
  if (!opts.subjectId?.trim())   throw new Error('executeWorkflowAction: subjectId is required');
  if (!opts.eventType?.trim())   throw new Error('executeWorkflowAction: eventType is required');

  const status    = opts.status    ?? 'completed';
  const workspace = opts.workspace ?? 'commercial';

  // ── 2. Perform (caller supplies the side-effect; engine writes the record) ──
  //    The engine itself has no side-effects beyond writing to workflow_events.
  //    Callers perform their domain action BEFORE calling this function and pass
  //    any resulting metadata here.

  // ── 3. Write event ───────────────────────────────────────────────────────────
  const result = await pool.query<WorkflowEventRecord>(`
    INSERT INTO workflow_events
      (subject_type, subject_id, event_type, status, workspace,
       performed_by, assigned_to, occurred_at,
       metadata, correlation_id, parent_event_id)
    VALUES
      ($1, $2, $3, $4, $5,
       $6, $7, NOW(),
       $8, $9, $10)
    RETURNING
      id, subject_type AS "subjectType", subject_id AS "subjectId",
      event_type AS "eventType", status, workspace,
      performed_by AS "performedBy", assigned_to AS "assignedTo",
      occurred_at AS "occurredAt", completed_at AS "completedAt",
      metadata, correlation_id AS "correlationId",
      parent_event_id AS "parentEventId"
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

// ── Query helpers (for read projections) ─────────────────────────────────────

/**
 * Read events matching a set of filters.
 * Used by Timeline, Audit, Follow-up, and Action Center projections.
 */
export async function queryWorkflowEvents(
  q: EventQuery
): Promise<WorkflowEventRecord[]> {

  const conditions: string[] = [];
  const params:     unknown[] = [];
  let   idx = 1;

  if (q.subjectType) {
    conditions.push(`subject_type = $${idx++}`);
    params.push(q.subjectType);
  }
  if (q.subjectId) {
    conditions.push(`subject_id = $${idx++}`);
    params.push(q.subjectId);
  }
  if (q.correlationId) {
    conditions.push(`correlation_id = $${idx++}`);
    params.push(q.correlationId);
  }
  if (q.eventType) {
    // Support prefix matching: "rate_job." matches all rate_job events
    if (q.eventType.endsWith('.')) {
      conditions.push(`event_type LIKE $${idx++}`);
      params.push(`${q.eventType}%`);
    } else {
      conditions.push(`event_type = $${idx++}`);
      params.push(q.eventType);
    }
  }
  if (q.workspace) {
    conditions.push(`workspace = $${idx++}`);
    params.push(q.workspace);
  }
  if (q.performedBy) {
    conditions.push(`performed_by = $${idx++}`);
    params.push(q.performedBy);
  }
  if (q.since) {
    conditions.push(`occurred_at >= $${idx++}`);
    params.push(q.since);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(q.limit ?? 50, 500);
  const offset = q.offset ?? 0;

  const res = await pool.query<WorkflowEventRecord>(`
    SELECT
      id,
      subject_type    AS "subjectType",
      subject_id      AS "subjectId",
      event_type      AS "eventType",
      status,
      workspace,
      performed_by    AS "performedBy",
      assigned_to     AS "assignedTo",
      occurred_at     AS "occurredAt",
      completed_at    AS "completedAt",
      metadata,
      correlation_id  AS "correlationId",
      parent_event_id AS "parentEventId"
    FROM  workflow_events
    ${where}
    ORDER BY occurred_at DESC
    LIMIT  $${idx++}
    OFFSET $${idx}
  `, [...params, limit, offset]);

  return res.rows;
}

/**
 * Fetch all events in a correlation group — i.e. one complete workflow lifecycle.
 */
export async function getWorkflowTimeline(
  correlationId: string
): Promise<WorkflowEventRecord[]> {
  return queryWorkflowEvents({ correlationId, limit: 200 });
}

/**
 * Fetch events for a specific subject (e.g. all events on rate_job #2847).
 */
export async function getSubjectHistory(
  subjectType: string,
  subjectId:   string,
  limit = 50
): Promise<WorkflowEventRecord[]> {
  return queryWorkflowEvents({ subjectType, subjectId, limit });
}

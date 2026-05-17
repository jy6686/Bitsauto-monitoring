/**
 * Approval Workflow Engine
 * 
 * Handles creation, review, and execution of pending routing/connection change requests.
 * All routing mutations (RG, DS, members, routes) pass through this gate — the
 * approver executes the Sippy call only after explicit approval.
 *
 * RBAC policy (see APPROVAL_POLICY in shared/schema.ts):
 *   super_admin  — submit + approve-all + self-approve (flagged in audit)
 *   admin        — submit + approve-all, cannot approve own
 *   team_lead    — cannot submit + approve-team only
 *   noc_operator — submit only
 *   management   — submit only
 *   viewer       — neither submit nor approve
 */

import { storage } from "./storage";
import * as sippy from "./sippy";
import { type Role, type ApprovalRequest, type InsertApprovalRequest, APPROVAL_POLICY } from "@shared/schema";
import { db as _db } from "./db";
import { approvalRequests as _arTable, aiOpsEvents as _aiOpsEventsTable } from "../shared/schema";
import { mapExecToSignals } from "./aiops/signal-mapper";
import { appendToLedger, ledgerIdForApproval } from "./action-ledger";

// ─── Operation type registry ────────────────────────────────────────────────

export type OperationType =
  | 'routing_group.create'
  | 'routing_group.update'
  | 'routing_group.delete'
  | 'routing_group_member.add'
  | 'routing_group_member.update'
  | 'routing_group_member.delete'
  | 'destination_set.create'
  | 'destination_set.update'
  | 'destination_set.delete'
  | 'ds_route.add'
  | 'ds_route.update'
  | 'ds_route.delete'
  | 'ds_route.delete_all';

export type ApprovalSource = 'manual' | 'rule_engine' | 'rollback';

export const OPERATION_LABELS: Record<OperationType, string> = {
  'routing_group.create':          'Create Routing Group',
  'routing_group.update':          'Update Routing Group',
  'routing_group.delete':          'Delete Routing Group',
  'routing_group_member.add':      'Add Routing Group Member',
  'routing_group_member.update':   'Update Routing Group Member',
  'routing_group_member.delete':   'Remove Routing Group Member',
  'destination_set.create':        'Create Destination Set',
  'destination_set.update':        'Update Destination Set',
  'destination_set.delete':        'Delete Destination Set',
  'ds_route.add':                  'Add Route to Destination Set',
  'ds_route.update':               'Update Route in Destination Set',
  'ds_route.delete':               'Delete Route from Destination Set',
  'ds_route.delete_all':           'Delete ALL Routes from Destination Set',
};

// ─── Permission helpers ──────────────────────────────────────────────────────

export function canSubmit(role: Role): boolean {
  return APPROVAL_POLICY[role]?.canSubmit ?? false;
}

export function canApprove(
  request: ApprovalRequest,
  actorId: string,
  actorRole: Role,
  actorTeamId: string | null,
): { allowed: boolean; isSelfApproval: boolean; reason?: string } {
  const policy = APPROVAL_POLICY[actorRole];
  if (!policy) return { allowed: false, isSelfApproval: false, reason: 'Unknown role' };

  if (policy.approveScope === 'none') {
    return { allowed: false, isSelfApproval: false, reason: 'Your role cannot approve requests' };
  }

  const isSelf = request.requestedBy === actorId;

  if (policy.approveScope === 'team') {
    if (!actorTeamId || request.teamId !== actorTeamId) {
      return { allowed: false, isSelfApproval: false, reason: 'You can only approve requests from your team' };
    }
    return { allowed: true, isSelfApproval: false };
  }

  // approveScope === 'all'
  if (isSelf && !policy.selfApproval) {
    return { allowed: false, isSelfApproval: true, reason: 'You cannot approve your own requests' };
  }

  return { allowed: true, isSelfApproval: isSelf };
}

// ─── Submit a new approval request ──────────────────────────────────────────

export async function submitApprovalRequest(params: {
  operationType: OperationType;
  action: 'create' | 'update' | 'delete';
  entityId?: string | number;
  entityName?: string;
  payloadBefore?: any;
  payloadAfter?: any;
  requestedBy: string;
  requestedByName?: string;
  teamId?: string | null;
  source?: ApprovalSource;
  ruleId?: number | null;
  rollbackOf?: number | null;
}): Promise<ApprovalRequest> {
  const data: InsertApprovalRequest = {
    operationType: params.operationType,
    action: params.action,
    entityId: params.entityId !== undefined ? String(params.entityId) : undefined,
    entityName: params.entityName,
    payloadBefore: params.payloadBefore ?? null,
    payloadAfter: params.payloadAfter ?? null,
    requestedBy: params.requestedBy,
    requestedByName: params.requestedByName,
    teamId: params.teamId ?? null,
    status: 'pending',
    selfApproval: false,
    source: params.source ?? 'manual',
    ruleId: params.ruleId ?? null,
    rollbackOf: params.rollbackOf ?? null,
  };

  const request = await storage.createApprovalRequest(data);

  await storage.addApprovalAuditEntry({
    requestId: request.id,
    action: 'submitted',
    actorId: params.requestedBy,
    actorName: params.requestedByName ?? null,
    actorRole: null,
    note: `Request submitted for ${OPERATION_LABELS[params.operationType]}`,
  });

  // ── Ledger: submitted event ───────────────────────────────────────────────
  await appendToLedger({
    ledgerId:       ledgerIdForApproval(request.id),
    scope:          'routing',
    sourceSystem:   'ROUTING',
    actionType:     params.operationType,
    entityId:       params.entityId !== undefined ? String(params.entityId) : null,
    entityName:     params.entityName ?? null,
    payload:        { before: params.payloadBefore, after: params.payloadAfter },
    approvalState:  'pending',
    executionState: 'not_executed',
    verificationState: 'not_applicable',
    sourceRecordId: String(request.id),
    eventType:      'submitted',
    requestedBy:    params.requestedBy,
    requestedByName: params.requestedByName ?? null,
    note:           `Routing request submitted: ${OPERATION_LABELS[params.operationType]}${params.source !== 'manual' ? ` (source: ${params.source})` : ''}`,
  });

  // ── Notification: write an alert so the approval surfaces in the Alerts page ─
  try {
    const label = OPERATION_LABELS[params.operationType] ?? params.operationType;
    const who   = params.requestedByName ?? params.requestedBy;
    await storage.createAlert({
      type:     'approval_pending',
      severity: 'info',
      message:  `Approval required: ${label}${params.entityName ? ` — "${params.entityName}"` : ''} (submitted by ${who}, request #${request.id})`,
      resolved: false,
    } as any);
  } catch { /* non-critical — don't fail the approval creation */ }

  return request;
}

// ─── Execution timeout wrapper ────────────────────────────────────────────────

const EXEC_TIMEOUT_MS = 8_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Sippy XML-RPC timed out after ${ms / 1000}s (${label})`)),
      ms,
    );
    promise.then(
      v => { clearTimeout(timer); resolve(v); },
      e => { clearTimeout(timer); reject(e); },
    );
  });
}

// ─── Approve a request (execute + mark) ─────────────────────────────────────

export async function approveRequest(
  requestId: number,
  actor: { id: string; name?: string; role: Role; teamId: string | null },
): Promise<{ success: boolean; error?: string; result?: any }> {
  const requestReceivedAt = new Date();

  const request = await storage.getApprovalRequestById(requestId);
  if (!request) return { success: false, error: 'Approval request not found' };
  if (request.status !== 'pending') return { success: false, error: `Request is already ${request.status}` };

  const { allowed, isSelfApproval, reason } = canApprove(request, actor.id, actor.role, actor.teamId);
  if (!allowed) return { success: false, error: reason };

  // Execute the operation against Sippy (with hard 8s timeout)
  // All results are normalized into a single contract shape before touching the DB.
  let execResult: {
    success: boolean;
    status: 'success' | 'failed';
    message: string;
    method: string;
    durationMs: number;
    raw: any;
  };
  let executionFailed = false;

  const execStart = Date.now();
  const execStartedAt = new Date();
  let execCompletedAt = new Date();

  try {
    const rawResult = await withTimeout(
      executeApprovedOperation(request),
      EXEC_TIMEOUT_MS,
      request.operationType,
    );

    const durationMs = Date.now() - execStart;
    execCompletedAt = new Date();

    if (!rawResult.success) {
      executionFailed = true;
      const msg = rawResult.error ?? rawResult.message ?? 'Sippy returned a failure response';
      execResult = {
        success: false,
        status: 'failed',
        message: msg,
        method: request.operationType,
        durationMs,
        raw: rawResult,
      };
    } else {
      execResult = {
        success: true,
        status: 'success',
        message: 'Operation completed successfully',
        method: request.operationType,
        durationMs,
        raw: rawResult,
      };
    }
  } catch (err: any) {
    const durationMs = Date.now() - execStart;
    execCompletedAt = new Date();
    executionFailed = true;
    execResult = {
      success: false,
      status: 'failed',
      message: err.message ?? 'Execution failed',
      method: request.operationType,
      durationMs,
      raw: err instanceof Error ? { name: err.name, message: err.message } : err,
    };
  }

  // Emit AI Ops signals — capture evaluation outcome for trace (silent on failure)
  const signalEval: { evaluated: boolean; signalsEmitted: number; types: string[]; skippedReason: string } = {
    evaluated: false, signalsEmitted: 0, types: [], skippedReason: '',
  };
  try {
    const signals = mapExecToSignals(execResult, request.operationType, requestId);
    signalEval.evaluated = true;
    signalEval.signalsEmitted = signals.length;
    signalEval.types = signals.map(s => s.type);
    if (signals.length === 0) {
      signalEval.skippedReason = execResult.success
        ? 'execution succeeded with normal latency — signals emit only on failure or latency >6s'
        : 'execution failed but mapper returned no signals (unexpected)';
    }
    if (signals.length > 0) {
      await _db.insert(_aiOpsEventsTable).values(signals);
    }
  } catch (_e) {
    signalEval.skippedReason = 'signal emission threw during DB insert (silent)';
    /* intentionally silent */
  }

  // Attach execution trace to execResult before persisting
  (execResult as any).trace = {
    requestReceivedAt: requestReceivedAt.toISOString(),
    execStartedAt:     execStartedAt.toISOString(),
    execCompletedAt:   execCompletedAt.toISOString(),
    signalEval,
  };

  if (executionFailed) {
    // Persist 'failed' status so it's visible in the UI and audit trail
    await storage.updateApprovalRequest(requestId, {
      status: 'failed' as any,
      reviewedBy: actor.id,
      reviewedByName: actor.name,
      reviewedAt: new Date(),
      selfApproval: isSelfApproval,
      execResult,
    });
    await storage.addApprovalAuditEntry({
      requestId,
      action: 'approved',
      actorId: actor.id,
      actorName: actor.name ?? null,
      actorRole: actor.role,
      note: `Execution FAILED: ${execResult.message}`,
    });
    // ── Ledger: execution_failed event ──────────────────────────────────────
    await appendToLedger({
      ledgerId:          ledgerIdForApproval(requestId),
      scope:             'routing',
      sourceSystem:      'ROUTING',
      actionType:        request.operationType,
      entityId:          request.entityId ?? null,
      entityName:        request.entityName ?? null,
      payload:           { execResult },
      approvalState:     'approved',
      executionState:    'failed',
      verificationState: 'FAILED_CONFIRMED',
      sourceRecordId:    String(requestId),
      eventType:         'execution_failed',
      requestedBy:       request.requestedBy,
      requestedByName:   request.requestedByName ?? null,
      actorId:           actor.id,
      actorName:         actor.name ?? null,
      note:              `Sippy execution FAILED: ${execResult.message}`,
    });
    return { success: false, error: `Sippy execution failed: ${execResult.message}` };
  }

  // Mark as approved and store Sippy execution result
  await storage.updateApprovalRequest(requestId, {
    status: 'approved',
    reviewedBy: actor.id,
    reviewedByName: actor.name,
    reviewedAt: new Date(),
    selfApproval: isSelfApproval,
    execResult: execResult ?? null,
  });

  await storage.addApprovalAuditEntry({
    requestId,
    action: 'approved',
    actorId: actor.id,
    actorName: actor.name ?? null,
    actorRole: actor.role,
    note: isSelfApproval ? '[SELF-APPROVAL — emergency override]' : null,
  });

  // ── Ledger: approved + executed event ────────────────────────────────────
  await appendToLedger({
    ledgerId:          ledgerIdForApproval(requestId),
    scope:             'routing',
    sourceSystem:      'ROUTING',
    actionType:        request.operationType,
    entityId:          request.entityId ?? null,
    entityName:        request.entityName ?? null,
    payload:           { execResult },
    approvalState:     'approved',
    executionState:    'executed',
    verificationState: 'SUCCESS_CONFIRMED',
    sourceRecordId:    String(requestId),
    eventType:         'executed',
    requestedBy:       request.requestedBy,
    requestedByName:   request.requestedByName ?? null,
    actorId:           actor.id,
    actorName:         actor.name ?? null,
    note:              isSelfApproval
      ? `Approved + executed [SELF-APPROVAL — emergency override] (${execResult.durationMs}ms)`
      : `Approved + executed against Sippy (${execResult.durationMs}ms)`,
  });

  // Auto-resolve the approval_pending alert that was created when this request was submitted
  try {
    const { alerts: alertsT } = await import('../shared/schema');
    const { and: andD, eq: eqD, ilike } = await import('drizzle-orm');
    const [openAlert] = await _db.select({ id: alertsT.id }).from(alertsT)
      .where(andD(eqD(alertsT.type, 'approval_pending'), eqD(alertsT.resolved, false), ilike(alertsT.message, `%request #${requestId}%`)))
      .limit(1);
    if (openAlert) {
      await _db.update(alertsT).set({ resolved: true, resolvedAt: new Date() }).where(eqD(alertsT.id, openAlert.id));
    }
  } catch { /* non-critical */ }

  return { success: true, result: execResult };
}

// ─── Reject a request ───────────────────────────────────────────────────────

export async function rejectRequest(
  requestId: number,
  actor: { id: string; name?: string; role: Role; teamId: string | null },
  reason: string,
): Promise<{ success: boolean; error?: string }> {
  const request = await storage.getApprovalRequestById(requestId);
  if (!request) return { success: false, error: 'Approval request not found' };
  if (request.status !== 'pending') return { success: false, error: `Request is already ${request.status}` };

  const { allowed, reason: denyReason } = canApprove(request, actor.id, actor.role, actor.teamId);
  if (!allowed) return { success: false, error: denyReason };

  await storage.updateApprovalRequest(requestId, {
    status: 'rejected',
    reviewedBy: actor.id,
    reviewedByName: actor.name,
    reviewedAt: new Date(),
    rejectionReason: reason,
    selfApproval: false,
  });

  await storage.addApprovalAuditEntry({
    requestId,
    action: 'rejected',
    actorId: actor.id,
    actorName: actor.name ?? null,
    actorRole: actor.role,
    note: reason,
  });

  // ── Ledger: rejected event ────────────────────────────────────────────────
  await appendToLedger({
    ledgerId:          ledgerIdForApproval(requestId),
    scope:             'routing',
    sourceSystem:      'ROUTING',
    actionType:        request.operationType,
    entityId:          request.entityId ?? null,
    entityName:        request.entityName ?? null,
    approvalState:     'rejected',
    executionState:    'not_executed',
    verificationState: 'not_applicable',
    sourceRecordId:    String(requestId),
    eventType:         'rejected',
    requestedBy:       request.requestedBy,
    requestedByName:   request.requestedByName ?? null,
    actorId:           actor.id,
    actorName:         actor.name ?? null,
    note:              reason || 'No reason provided',
  });

  // Auto-resolve the approval_pending alert created when this request was submitted
  try {
    const { alerts: alertsT } = await import('../shared/schema');
    const { and: andD, eq: eqD, ilike } = await import('drizzle-orm');
    const [openAlert] = await _db.select({ id: alertsT.id }).from(alertsT)
      .where(andD(eqD(alertsT.type, 'approval_pending'), eqD(alertsT.resolved, false), ilike(alertsT.message, `%request #${requestId}%`)))
      .limit(1);
    if (openAlert) {
      await _db.update(alertsT).set({ resolved: true, resolvedAt: new Date() }).where(eqD(alertsT.id, openAlert.id));
    }
  } catch { /* non-critical */ }

  return { success: true };
}

// ─── Create a rollback request (swap before ↔ after) ────────────────────────

export async function submitRollback(
  originalId: number,
  actor: { id: string; name?: string },
): Promise<{ success: boolean; request?: ApprovalRequest; error?: string }> {
  const original = await storage.getApprovalRequestById(originalId);
  if (!original) return { success: false, error: 'Original request not found' };
  if (original.status !== 'approved') return { success: false, error: 'Can only rollback approved requests' };
  if (!original.payloadBefore) return { success: false, error: 'No payloadBefore to rollback to' };
  if ((original as any).rollbackOf) return { success: false, error: 'Cannot rollback a rollback request' };

  const req = await submitApprovalRequest({
    operationType: original.operationType as OperationType,
    action: 'update',
    entityId: original.entityId ?? undefined,
    entityName: `[ROLLBACK] ${original.entityName ?? `Request #${originalId}`}`,
    payloadBefore: original.payloadAfter,
    payloadAfter:  original.payloadBefore,
    requestedBy:   actor.id,
    requestedByName: actor.name,
    teamId: original.teamId,
    source: 'rollback',
    rollbackOf: originalId,
  });

  // ── Ledger: rolled_back event on the ORIGINAL request ────────────────────
  // The new rollback request gets its own ledger thread via submitApprovalRequest above.
  await appendToLedger({
    ledgerId:          ledgerIdForApproval(originalId),
    scope:             'routing',
    sourceSystem:      'ROUTING',
    actionType:        original.operationType,
    entityId:          original.entityId ?? null,
    entityName:        original.entityName ?? null,
    approvalState:     'approved',
    executionState:    'rolled_back',
    verificationState: 'not_applicable',
    sourceRecordId:    String(originalId),
    eventType:         'rolled_back',
    requestedBy:       original.requestedBy,
    requestedByName:   original.requestedByName ?? null,
    actorId:           actor.id,
    actorName:         actor.name ?? null,
    note:              `Rollback initiated — new request #${req.id} created`,
  });

  return { success: true, request: req };
}

// ─── Execute approved operation ──────────────────────────────────────────────

async function executeApprovedOperation(request: ApprovalRequest): Promise<{ success: boolean; message?: string; error?: string; [key: string]: any }> {
  const settings = await storage.getSippySettings();
  if (!settings) throw new Error('Sippy not configured');

  const { username, password } = sippyXmlCreds(settings);
  const portalUrl = sippyPortalUrl(settings);
  const p: any = request.payloadAfter ?? {};

  switch (request.operationType as OperationType) {
    // ── Routing Groups ──────────────────────────────────────────────────────
    case 'routing_group.create': {
      const { name, policy, ...rest } = p;
      return await sippy.addRoutingGroup(username, password, name, policy, { ...rest, portalUrl });
    }
    case 'routing_group.update': {
      const iRG = parseInt(request.entityId!, 10);
      return await sippy.updateRoutingGroup(username, password, iRG, { ...p, portalUrl });
    }
    case 'routing_group.delete': {
      const iRG = parseInt(request.entityId!, 10);
      return await sippy.delRoutingGroup(username, password, iRG, { portalUrl });
    }

    // ── Routing Group Members ──────────────────────────────────────────────
    case 'routing_group_member.add': {
      const { iRoutingGroup, iDestinationSet, preference, iConnection, iConnectionGroup, ...rest } = p;
      return await sippy.addRoutingGroupMember(
        username, password, iRoutingGroup,
        iDestinationSet, preference,
        { iConnection, iConnectionGroup, ...rest, portalUrl },
      );
    }
    case 'routing_group_member.update': {
      const { iRoutingGroupMember, iRoutingGroup, ...rest } = p;
      return await sippy.updateRoutingGroupMember(username, password, iRoutingGroupMember, {
        iRoutingGroup,
        ...rest,
        portalUrl,
      });
    }
    case 'routing_group_member.delete': {
      const { iRoutingGroupMember, iRoutingGroup } = p;
      return await sippy.delRoutingGroupMember(username, password, iRoutingGroupMember, {
        iRoutingGroup,
        portalUrl,
      });
    }

    // ── Destination Sets ───────────────────────────────────────────────────
    case 'destination_set.create': {
      const { name, currency, ...rest } = p;
      return await sippy.addDestinationSet(username, password, { name, currency, ...rest, portalUrl });
    }
    case 'destination_set.update': {
      const iDS = parseInt(request.entityId!, 10);
      return await sippy.updateDestinationSet(username, password, iDS, { ...p, portalUrl });
    }
    case 'destination_set.delete': {
      const iDS = parseInt(request.entityId!, 10);
      return await sippy.deleteDestinationSet(username, password, iDS, { portalUrl });
    }

    // ── DS Routes ──────────────────────────────────────────────────────────
    case 'ds_route.add': {
      const { iDestinationSet, prefix, ...rest } = p;
      return await sippy.addRouteToDestinationSet(username, password, iDestinationSet, prefix, { ...rest, portalUrl });
    }
    case 'ds_route.update': {
      const { iDestinationSet, prefix, ...rest } = p;
      return await sippy.updateRouteInDestinationSet(username, password, iDestinationSet, prefix, { ...rest, portalUrl });
    }
    case 'ds_route.delete': {
      const { iDestinationSet, prefix } = p;
      return await sippy.delRouteFromDestinationSet(username, password, iDestinationSet, prefix, { portalUrl });
    }
    case 'ds_route.delete_all': {
      const iDS = parseInt(request.entityId!, 10);
      return await sippy.deleteAllRoutesInDestinationSet(username, password, iDS, { portalUrl });
    }

    default:
      throw new Error(`Unknown operation type: ${request.operationType}`);
  }
}

// ─── Credential helpers (mirrors routes.ts) ───────────────────────────────────

const DEFAULT_SIPPY_URL      = 'https://191.101.30.107';
const DEFAULT_SIPPY_USERNAME = 'ssp-root';
const DEFAULT_SIPPY_PASSWORD = '!chiaan1';

type SippyCreds = {
  portalUrl?: string | null;
  apiAdminUsername?: string | null;
  apiAdminPassword?: string | null;
  portalUsername?: string | null;
  portalPassword?: string | null;
};

function sippyXmlCreds(s: SippyCreds): { username: string; password: string } {
  return {
    username: s.apiAdminUsername || s.portalUsername || DEFAULT_SIPPY_USERNAME,
    password: s.apiAdminPassword || s.portalPassword || DEFAULT_SIPPY_PASSWORD,
  };
}

function sippyPortalUrl(s: { portalUrl?: string | null }): string {
  return s.portalUrl || DEFAULT_SIPPY_URL;
}

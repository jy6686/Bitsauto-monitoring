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

  return request;
}

// ─── Approve a request (execute + mark) ─────────────────────────────────────

export async function approveRequest(
  requestId: number,
  actor: { id: string; name?: string; role: Role; teamId: string | null },
): Promise<{ success: boolean; error?: string; result?: any }> {
  const request = await storage.getApprovalRequestById(requestId);
  if (!request) return { success: false, error: 'Approval request not found' };
  if (request.status !== 'pending') return { success: false, error: `Request is already ${request.status}` };

  const { allowed, isSelfApproval, reason } = canApprove(request, actor.id, actor.role, actor.teamId);
  if (!allowed) return { success: false, error: reason };

  // Execute the operation against Sippy
  let execResult: any;
  try {
    execResult = await executeApprovedOperation(request);
    if (!execResult.success) {
      return { success: false, error: `Sippy execution failed: ${execResult.error ?? execResult.message ?? 'Unknown error'}` };
    }
  } catch (err: any) {
    return { success: false, error: `Execution error: ${err.message}` };
  }

  // Mark as approved
  await storage.updateApprovalRequest(requestId, {
    status: 'approved',
    reviewedBy: actor.id,
    reviewedByName: actor.name,
    reviewedAt: new Date(),
    selfApproval: isSelfApproval,
  });

  await storage.addApprovalAuditEntry({
    requestId,
    action: 'approved',
    actorId: actor.id,
    actorName: actor.name ?? null,
    actorRole: actor.role,
    note: isSelfApproval ? '[SELF-APPROVAL — emergency override]' : null,
  });

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

  return { success: true };
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

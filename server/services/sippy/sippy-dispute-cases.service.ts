/**
 * sippy-dispute-cases.service.ts
 *
 * Formal Dispute Workflow Engine
 *
 * Governs the complete dispute case lifecycle with:
 *   - Structured status transitions (validated)
 *   - Immutable event timeline on every action
 *   - SLA tracking from case open to resolution
 *   - Assignment and escalation support
 *   - Linked finance evidence (invoice, reconciliation, DMR)
 *
 * Status lifecycle:
 *   OPEN → INVESTIGATING → CUSTOMER_PENDING → RESOLVED → CREDIT_ISSUED → CLOSED
 *                                           → REJECTED → CLOSED
 *
 * All transitions append to dispute_case_events (append-only audit trail).
 */

import { storage } from '../../storage';
import type { DisputeCase, InsertDisputeCase, DisputeCaseEvent } from '@shared/schema';

// ── Status transition graph ────────────────────────────────────────────────────
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  OPEN:             ['INVESTIGATING', 'REJECTED', 'CLOSED'],
  INVESTIGATING:    ['CUSTOMER_PENDING', 'RESOLVED', 'REJECTED'],
  CUSTOMER_PENDING: ['INVESTIGATING', 'RESOLVED', 'REJECTED'],
  RESOLVED:         ['CREDIT_ISSUED', 'CLOSED'],
  CREDIT_ISSUED:    ['CLOSED'],
  REJECTED:         ['CLOSED', 'OPEN'],  // can re-open
  CLOSED:           [],
};

const TERMINAL_STATUSES = new Set(['CLOSED']);
const RESOLUTION_STATUSES = new Set(['RESOLVED', 'CREDIT_ISSUED', 'REJECTED', 'CLOSED']);

// ── Open a new dispute case ────────────────────────────────────────────────────

export interface OpenCaseInput {
  disputeType:      string;
  clientName:       string;
  clientId?:        string;
  billingPeriod?:   string;
  invoiceId?:       number;
  reconciliationId?: number;
  severity?:        string;
  disputedAmount?:  number;
  description?:     string;
  assignedTo?:      string;
  slaHours?:        number;
  actorName?:       string;
}

export async function openCase(input: OpenCaseInput): Promise<DisputeCase> {
  const referenceId = await generateReferenceId();
  const slaHours    = input.slaHours ?? 72;
  const slaDueAt    = new Date(Date.now() + slaHours * 3600000);

  const created = await storage.createDisputeCase({
    referenceId,
    disputeType:      input.disputeType,
    clientName:       input.clientName,
    clientId:         input.clientId,
    billingPeriod:    input.billingPeriod,
    invoiceId:        input.invoiceId,
    reconciliationId: input.reconciliationId,
    severity:         input.severity ?? 'medium',
    status:           'OPEN',
    disputedAmount:   input.disputedAmount,
    description:      input.description,
    assignedTo:       input.assignedTo,
    slaHours,
    slaDueAt,
  });

  await storage.addDisputeCaseEvent({
    caseId:    created.id,
    eventType: 'status_change',
    fromStatus: null,
    toStatus:  'OPEN',
    message:   `Case opened. Disputed amount: ${input.disputedAmount != null ? `$${input.disputedAmount.toFixed(2)}` : 'not specified'}`,
    actorName: input.actorName ?? 'operator',
  });

  if (input.assignedTo) {
    await storage.addDisputeCaseEvent({
      caseId:    created.id,
      eventType: 'assignment',
      message:   `Assigned to ${input.assignedTo}`,
      actorName: input.actorName ?? 'operator',
    });
  }

  console.log(`[dispute-cases] Opened ${referenceId} — ${input.clientName} (${input.disputeType})`);
  return created;
}

// ── Transition status ─────────────────────────────────────────────────────────

export async function transitionStatus(
  caseId:    number,
  toStatus:  string,
  opts: { actorName?: string; message?: string; resolvedAmount?: number } = {},
): Promise<DisputeCase> {
  const cas = await requireCase(caseId);
  const allowed = ALLOWED_TRANSITIONS[cas.status] ?? [];

  if (!allowed.includes(toStatus)) {
    throw new Error(`Cannot transition from ${cas.status} → ${toStatus}. Allowed: ${allowed.join(', ') || 'none'}`);
  }

  const updates: Partial<DisputeCase> = {
    status:    toStatus,
    updatedAt: new Date(),
  } as any;

  if (RESOLUTION_STATUSES.has(toStatus) && !cas.resolvedAt) {
    (updates as any).resolvedAt = new Date();
    if (opts.resolvedAmount != null) (updates as any).resolvedAmount = opts.resolvedAmount;
  }
  if (TERMINAL_STATUSES.has(toStatus) && !cas.closedAt) {
    (updates as any).closedAt = new Date();
  }

  const updated = await storage.updateDisputeCase(caseId, updates);

  await storage.addDisputeCaseEvent({
    caseId,
    eventType:  'status_change',
    fromStatus: cas.status,
    toStatus,
    message:    opts.message ?? `Status changed to ${toStatus}`,
    actorName:  opts.actorName ?? 'operator',
  });

  return updated;
}

// ── Assign to user ────────────────────────────────────────────────────────────

export async function assignCase(
  caseId:     number,
  assignedTo: string,
  actorName?: string,
): Promise<DisputeCase> {
  const cas = await requireCase(caseId);
  const prevAssignee = cas.assignedTo ?? 'Unassigned';

  const updated = await storage.updateDisputeCase(caseId, {
    assignedTo,
    updatedAt: new Date(),
  } as any);

  await storage.addDisputeCaseEvent({
    caseId,
    eventType: 'assignment',
    message:   `Reassigned from ${prevAssignee} to ${assignedTo}`,
    actorName: actorName ?? 'operator',
  });

  return updated;
}

// ── Add note ──────────────────────────────────────────────────────────────────

export async function addNote(
  caseId:    number,
  message:   string,
  actorName: string = 'operator',
  isInternal = false,
): Promise<DisputeCaseEvent> {
  await requireCase(caseId);
  return storage.addDisputeCaseEvent({
    caseId,
    eventType: 'note',
    message:   isInternal ? `[Internal] ${message}` : message,
    actorName,
  });
}

// ── Get case with full timeline ───────────────────────────────────────────────

export interface CaseDetail {
  case:         DisputeCase;
  events:       DisputeCaseEvent[];
  slaStatus:    'on_track' | 'at_risk' | 'breached';
  slaRemainingH: number | null;
  allowedTransitions: string[];
  linkedInvoice?:         any;
  linkedReconciliation?:  any;
}

export async function getCaseDetail(caseId: number): Promise<CaseDetail> {
  const cas = await requireCase(caseId);
  const events = await storage.listDisputeCaseEvents(caseId);

  const now = Date.now();
  let slaStatus: CaseDetail['slaStatus'] = 'on_track';
  let slaRemainingH: number | null = null;

  if (cas.slaDueAt && !RESOLUTION_STATUSES.has(cas.status)) {
    const dueMs     = new Date(cas.slaDueAt).getTime();
    const remainingH = (dueMs - now) / 3600000;
    slaRemainingH = remainingH;
    if (remainingH < 0)  slaStatus = 'breached';
    else if (remainingH < 12) slaStatus = 'at_risk';
  }

  let linkedInvoice: any;
  let linkedReconciliation: any;
  try { if (cas.invoiceId) linkedInvoice = await storage.getInvoice?.(cas.invoiceId); } catch {}
  try { if (cas.reconciliationId) linkedReconciliation = await storage.getClientReconciliation?.(cas.reconciliationId); } catch {}

  return {
    case:               cas,
    events:             events.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    slaStatus,
    slaRemainingH,
    allowedTransitions: ALLOWED_TRANSITIONS[cas.status] ?? [],
    linkedInvoice,
    linkedReconciliation,
  };
}

// ── Reference ID generation ───────────────────────────────────────────────────

async function generateReferenceId(): Promise<string> {
  const year  = new Date().getFullYear();
  const all   = await storage.listDisputeCases({ year: String(year) });
  const seq   = String(all.length + 1).padStart(3, '0');
  return `DSP-${year}-${seq}`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function requireCase(id: number): Promise<DisputeCase> {
  const cas = await storage.getDisputeCase(id);
  if (!cas) throw new Error(`Dispute case #${id} not found`);
  return cas;
}

/**
 * sippy-credit-notes.service.ts
 *
 * Credit Notes & Settlement Engine
 *
 * Manages formal credit adjustments against invoices and dispute cases.
 *
 * Credit Types:
 *   partial_credit   — partial credit against an invoice
 *   full_credit      — full credit (cancels invoice balance)
 *   adjustment       — manual billing adjustment
 *   write_off        — irrecoverable write-off
 *   carry_forward    — balance carried forward to next period
 *
 * Status Lifecycle:
 *   DRAFT → APPROVED → APPLIED
 *         → VOID
 *
 * All operations are snapshot-safe — no live tariff lookups.
 */

import { storage } from '../../storage';
import type { CreditNote, InsertCreditNote } from '@shared/schema';

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  DRAFT:    ['APPROVED', 'VOID'],
  APPROVED: ['APPLIED', 'VOID'],
  APPLIED:  [],
  VOID:     [],
};

// ── Create a new credit note ───────────────────────────────────────────────────

export async function createCreditNote(input: {
  creditType:     string;
  clientName:     string;
  clientId?:      string;
  invoiceId?:     number;
  disputeCaseId?: number;
  billingPeriod?: string;
  amountUsd:      number;
  reason:         string;
  description?:   string;
  createdBy?:     string;
}): Promise<CreditNote> {
  const referenceId = await generateReferenceId();
  const note = await storage.createCreditNote({
    referenceId,
    creditType:     input.creditType,
    clientName:     input.clientName,
    clientId:       input.clientId,
    invoiceId:      input.invoiceId,
    disputeCaseId:  input.disputeCaseId,
    billingPeriod:  input.billingPeriod,
    amountUsd:      input.amountUsd,
    reason:         input.reason,
    description:    input.description,
    status:         'DRAFT',
    createdBy:      input.createdBy ?? 'operator',
  });
  console.log(`[credit-notes] Created ${referenceId} — ${input.clientName} — $${input.amountUsd.toFixed(2)} (${input.creditType})`);
  return note;
}

// ── Approve credit note ────────────────────────────────────────────────────────

export async function approveCreditNote(id: number, approvedBy: string): Promise<CreditNote> {
  const note = await requireNote(id, ['DRAFT']);
  return storage.updateCreditNote(id, {
    status:     'APPROVED',
    approvedBy,
    approvedAt: new Date(),
    updatedAt:  new Date(),
  });
}

// ── Apply credit note (marks as applied against invoice) ──────────────────────

export async function applyCreditNote(
  id:               number,
  appliedAmountUsd: number,
): Promise<CreditNote> {
  const note = await requireNote(id, ['APPROVED']);
  if (appliedAmountUsd > note.amountUsd) {
    throw new Error(`Applied amount $${appliedAmountUsd} exceeds note amount $${note.amountUsd}`);
  }
  return storage.updateCreditNote(id, {
    status:           'APPLIED',
    appliedAmountUsd,
    appliedAt:        new Date(),
    updatedAt:        new Date(),
  });
}

// ── Void credit note ────────────────────────────────────────────────────────────

export async function voidCreditNote(id: number, reason: string): Promise<CreditNote> {
  const note = await requireNote(id, ['DRAFT', 'APPROVED']);
  return storage.updateCreditNote(id, {
    status:       'VOID',
    voidedAt:     new Date(),
    voidedReason: reason,
    updatedAt:    new Date(),
  });
}

// ── Get credit summary for a client ───────────────────────────────────────────

export async function getClientCreditSummary(clientName: string): Promise<{
  totalIssued:   number;
  totalApplied:  number;
  totalPending:  number;
  totalWrittenOff: number;
  notes:         CreditNote[];
}> {
  const notes = await storage.listCreditNotes({ clientName });
  const active = notes.filter(n => n.status !== 'VOID');
  return {
    totalIssued:    active.reduce((s, n) => s + n.amountUsd, 0),
    totalApplied:   active.filter(n => n.status === 'APPLIED').reduce((s, n) => s + (n.appliedAmountUsd ?? n.amountUsd), 0),
    totalPending:   active.filter(n => ['DRAFT', 'APPROVED'].includes(n.status)).reduce((s, n) => s + n.amountUsd, 0),
    totalWrittenOff: active.filter(n => n.creditType === 'write_off').reduce((s, n) => s + n.amountUsd, 0),
    notes,
  };
}

// ── Reference ID generation ────────────────────────────────────────────────────

async function generateReferenceId(): Promise<string> {
  const year = new Date().getFullYear();
  const all  = await storage.listCreditNotes({ year: String(year) });
  const seq  = String(all.length + 1).padStart(3, '0');
  return `CRN-${year}-${seq}`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function requireNote(id: number, allowedStatuses: string[]): Promise<CreditNote> {
  const note = await storage.getCreditNote(id);
  if (!note) throw new Error(`Credit note #${id} not found`);
  if (!allowedStatuses.includes(note.status)) {
    throw new Error(`Credit note #${id} is ${note.status} — expected: ${allowedStatuses.join(', ')}`);
  }
  return note;
}

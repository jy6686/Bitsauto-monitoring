/**
 * sippy-credit-control.service.ts
 *
 * Collections & Credit Control Engine
 *
 * Monitors client outstanding balances against configured thresholds.
 * Creates collection events (warning, suspension, grace, recovery) as
 * immutable timeline entries.
 *
 * Key operations:
 *   upsertRule(clientName, thresholds) — set or update credit control thresholds
 *   evaluateClient(clientName)         — check outstanding balance vs thresholds
 *   logEvent(clientName, eventType)    — add a collection event
 *   runSweep()                         — evaluate all clients with rules
 *   getClientStatus(clientName)        — current status + history
 */

import { storage } from '../../storage';
import type { CreditControlRule, CollectionEvent } from '@shared/schema';

export type CreditStatus = 'ok' | 'warning' | 'suspended' | 'grace' | 'collections' | 'unknown';

export interface ClientCreditStatus {
  clientName:          string;
  status:              CreditStatus;
  outstandingAmountUsd: number | null;
  rule:                CreditControlRule | null;
  recentEvents:        CollectionEvent[];
  thresholdBreached:   string | null;
  graceDaysRemaining:  number | null;
}

// ── Upsert credit control rule ─────────────────────────────────────────────────

export async function upsertRule(
  clientName: string | null,
  updates: Partial<CreditControlRule>,
): Promise<CreditControlRule> {
  if (clientName) {
    const existing = await storage.getCreditControlRuleByClient(clientName);
    if (existing) {
      return storage.updateCreditControlRule(existing.id, {
        ...updates,
        updatedAt: new Date(),
      } as any);
    }
    return storage.createCreditControlRule({
      clientName,
      isGlobal: false,
      gracePeriodDays: 3,
      autoSuspend: false,
      notifyOnWarning: true,
      ...updates,
    } as any);
  }
  // Global rule
  const existingGlobal = await storage.getGlobalCreditControlRule();
  if (existingGlobal) {
    return storage.updateCreditControlRule(existingGlobal.id, { ...updates, updatedAt: new Date() } as any);
  }
  return storage.createCreditControlRule({
    isGlobal: true,
    gracePeriodDays: 3,
    autoSuspend: false,
    notifyOnWarning: true,
    ...updates,
  } as any);
}

// ── Evaluate a client's outstanding balance against thresholds ─────────────────

export async function evaluateClient(
  clientName:          string,
  outstandingAmountUsd: number,
  actorName:           string = 'system',
): Promise<{ status: CreditStatus; eventCreated: boolean; event?: CollectionEvent }> {
  // Resolve rule: client-specific > global > none
  let rule = await storage.getCreditControlRuleByClient(clientName);
  if (!rule) rule = await storage.getGlobalCreditControlRule();

  if (!rule) return { status: 'unknown', eventCreated: false };

  const { warningThresholdUsd, suspendThresholdUsd, autoSuspend } = rule;

  let status: CreditStatus = 'ok';
  let thresholdBreached: string | null = null;

  if (suspendThresholdUsd != null && outstandingAmountUsd >= suspendThresholdUsd) {
    status = 'suspended';
    thresholdBreached = 'suspend';
  } else if (warningThresholdUsd != null && outstandingAmountUsd >= warningThresholdUsd) {
    status = 'warning';
    thresholdBreached = 'warning';
  }

  if (thresholdBreached) {
    // Create collection event
    const event = await storage.createCollectionEvent({
      clientName,
      eventType:           status === 'suspended' ? 'suspension' : 'warning',
      outstandingAmountUsd,
      thresholdBreached,
      actionTaken:         status === 'suspended'
        ? (autoSuspend ? 'Auto-suspension triggered' : 'Suspension threshold breached — manual action required')
        : 'Warning threshold breached — notification recommended',
      actorName,
    });
    console.log(`[credit-control] ${clientName}: ${status} — $${outstandingAmountUsd.toFixed(2)} vs threshold $${thresholdBreached === 'suspend' ? suspendThresholdUsd : warningThresholdUsd}`);
    return { status, eventCreated: true, event };
  }

  return { status, eventCreated: false };
}

// ── Log a manual collection event ─────────────────────────────────────────────

export async function logEvent(
  clientName:  string,
  eventType:   string,
  opts: {
    clientId?:            string;
    outstandingAmountUsd?: number;
    thresholdBreached?:   string;
    actionTaken?:         string;
    notes?:               string;
    actorName?:           string;
    resolvedAt?:          Date;
  } = {},
): Promise<CollectionEvent> {
  return storage.createCollectionEvent({
    clientName,
    clientId:             opts.clientId,
    eventType,
    outstandingAmountUsd: opts.outstandingAmountUsd,
    thresholdBreached:    opts.thresholdBreached,
    actionTaken:          opts.actionTaken,
    notes:                opts.notes,
    actorName:            opts.actorName ?? 'operator',
    resolvedAt:           opts.resolvedAt,
  });
}

// ── Run sweep across all clients with rules ────────────────────────────────────

export interface SweepResult {
  evaluated:  number;
  warnings:   number;
  suspended:  number;
  ok:         number;
}

export async function runSweep(actorName = 'system'): Promise<SweepResult> {
  const rules = await storage.listCreditControlRules({ isGlobal: false });
  let warnings = 0, suspended = 0, ok = 0;

  for (const rule of rules) {
    if (!rule.clientName) continue;
    // Outstanding = sum of pending invoice amounts for this client
    // This is a simplified estimate — in production, query unpaid invoices
    const invoices = await storage.listInvoices({ clientName: rule.clientName, status: 'approved' }).catch(() => []);
    const outstanding = invoices.reduce((s: number, inv: any) => s + (inv.totalAmountUsd ?? 0), 0);
    const result = await evaluateClient(rule.clientName, outstanding, actorName);
    if (result.status === 'suspended') suspended++;
    else if (result.status === 'warning') warnings++;
    else ok++;
  }

  console.log(`[credit-control] sweep: evaluated=${rules.length}, warnings=${warnings}, suspended=${suspended}, ok=${ok}`);
  return { evaluated: rules.length, warnings, suspended, ok };
}

// ── Get full client status ─────────────────────────────────────────────────────

export async function getClientStatus(clientName: string): Promise<ClientCreditStatus> {
  let rule = await storage.getCreditControlRuleByClient(clientName);
  if (!rule) rule = await storage.getGlobalCreditControlRule();

  const recentEvents = await storage.listCollectionEvents({ clientName, limit: 20 });

  // Derive current status from most recent event
  const lastEvent = recentEvents[0];
  let status: CreditStatus = 'ok';
  let thresholdBreached: string | null = null;

  if (lastEvent) {
    if (['suspension'].includes(lastEvent.eventType) && !lastEvent.resolvedAt) status = 'suspended';
    else if (['warning'].includes(lastEvent.eventType) && !lastEvent.resolvedAt) status = 'warning';
    else if (['grace_start'].includes(lastEvent.eventType) && !lastEvent.resolvedAt) status = 'grace';
    else if (['collections'].includes(lastEvent.eventType) && !lastEvent.resolvedAt) status = 'collections';
    thresholdBreached = lastEvent.thresholdBreached ?? null;
  }

  // Outstanding from recent invoices (approved/pending)
  const invoices = await storage.listInvoices({ clientName, status: 'approved' }).catch(() => []);
  const outstandingAmountUsd = invoices.reduce((s: number, inv: any) => s + (inv.totalAmountUsd ?? 0), 0);

  // Grace days remaining
  let graceDaysRemaining: number | null = null;
  if (status === 'grace' && lastEvent?.createdAt && rule?.gracePeriodDays) {
    const graceEnd = new Date(lastEvent.createdAt).getTime() + rule.gracePeriodDays * 86400000;
    graceDaysRemaining = Math.max(0, Math.ceil((graceEnd - Date.now()) / 86400000));
  }

  return {
    clientName,
    status,
    outstandingAmountUsd: outstandingAmountUsd || null,
    rule,
    recentEvents,
    thresholdBreached,
    graceDaysRemaining,
  };
}

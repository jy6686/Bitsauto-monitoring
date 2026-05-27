/**
 * sippy-comm-policy.service.ts
 *
 * Communication Policies Engine
 *
 * Orchestration glue between telecom economics events and
 * commercial notification drafts.
 *
 * Governance rule (IMMUTABLE):
 *   auto_draft = true always on first deploy.
 *   This service ONLY creates draft notifications.
 *   It NEVER dispatches. Humans dispatch.
 *
 * Flow:
 *   Tariff Change Event / Invoice / Reconciliation Drift
 *     → matchPolicies(triggerType, severity)
 *     → for each matching policy:
 *         ① check cooldown
 *         ② substitute template variables
 *         ③ insert draft commercial_notification
 *         ④ mark tariff_change_event.notification_sent = true (if applicable)
 *
 * All functions are async, non-blocking, fire-and-forget safe.
 * Failures are logged but never thrown — the economics event is always primary.
 */

import { storage } from '../../storage';
import type {
  CommunicationPolicy,
  TariffChangeEvent,
  InsertCommercialNotification,
} from '@shared/schema';

// ── Trigger types ─────────────────────────────────────────────────────────────

export type CommPolicyTrigger =
  | 'rate_change'
  | 'interval_change'
  | 'tariff_added'
  | 'tariff_removed'
  | 'invoice_generated'
  | 'reconciliation_drift'
  | 'qos_advisory'
  | 'fraud_advisory'
  | 'executive_report';

export type CommPolicySeverity = 'all' | 'minor' | 'major' | 'critical';

// Map tariff_change_event.changeType → policy trigger type
const CHANGE_TYPE_TO_TRIGGER: Record<string, CommPolicyTrigger> = {
  rate_changed:      'rate_change',
  interval_changed:  'interval_change',
  surcharge_changed: 'rate_change',
  added:             'tariff_added',
  removed:           'tariff_removed',
  modified:          'rate_change',
};

// ── Template variable substitution ───────────────────────────────────────────

function substitute(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

function buildVarsFromChangeEvent(event: TariffChangeEvent): Record<string, string> {
  const fmt = (n: number | null | undefined) => n != null ? n.toFixed(6) : '—';
  return {
    destination:    event.destination ?? event.prefix ?? '—',
    prefix:         event.prefix ?? '—',
    old_rate:       fmt(event.oldPrice1),
    new_rate:       fmt(event.newPrice1),
    old_interval:   event.oldInterval1 != null ? `${event.oldInterval1}/${event.oldIntervalN ?? event.oldInterval1}` : '—',
    new_interval:   event.newInterval1 != null ? `${event.newInterval1}/${event.newIntervalN ?? event.newInterval1}` : '—',
    old_connect_fee: fmt(event.oldConnectFee),
    new_connect_fee: fmt(event.newConnectFee),
    old_surcharge:  fmt(event.oldSurcharge),
    new_surcharge:  fmt(event.newSurcharge),
    effective_date: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
    i_tariff:       event.iTariff ?? '—',
    client_name:    'Valued Customer',
    change_type:    event.changeType.replace(/_/g, ' '),
  };
}

// ── Default notification subjects/bodies per trigger type ─────────────────────
// These are used when no template_type override is set on the policy.
// They mirror the existing commercial_notifications template system.

const TRIGGER_DEFAULTS: Record<string, { subject: string; body: string }> = {
  rate_change: {
    subject: 'Rate Notification — {{destination}} Rate Change effective {{effective_date}}',
    body: `Dear {{client_name}},

Please be advised that effective {{effective_date}}, the rate for {{destination}} (prefix {{prefix}}) will change.

Change Summary:
  Previous Rate: {{old_rate}} per minute
  New Rate:      {{new_rate}} per minute
  Effective Date: {{effective_date}}

All billing and invoicing generated after the effective date will apply the updated rate.

No action is required from your side unless you wish to review your routing strategy.

If you have any questions, please contact our commercial team.

[Auto-generated draft — requires operator review before dispatch]`,
  },
  interval_change: {
    subject: 'Rate Notification — {{destination}} Billing Interval Change effective {{effective_date}}',
    body: `Dear {{client_name}},

Please be advised that effective {{effective_date}}, the billing interval for {{destination}} (prefix {{prefix}}) will change.

Change Summary:
  Previous Billing Interval: {{old_interval}}
  New Billing Interval:      {{new_interval}}
  Effective Date:            {{effective_date}}

This change may impact the effective billed duration and realized call cost, particularly for short-duration calls.

All billing and invoicing generated after the effective date will automatically apply the updated interval configuration.

[Auto-generated draft — requires operator review before dispatch]`,
  },
  tariff_added: {
    subject: 'Route Update — {{destination}} Added effective {{effective_date}}',
    body: `Dear {{client_name}},

Please be advised that effective {{effective_date}}, the destination {{destination}} (prefix {{prefix}}) has been added to your tariff.

Rate: {{new_rate}} per minute
Billing Interval: {{new_interval}}

[Auto-generated draft — requires operator review before dispatch]`,
  },
  tariff_removed: {
    subject: 'Route Update — {{destination}} Removed effective {{effective_date}}',
    body: `Dear {{client_name}},

Please be advised that effective {{effective_date}}, the destination {{destination}} (prefix {{prefix}}) has been removed from your tariff.

Please ensure your routing does not direct traffic to this destination after the effective date.

[Auto-generated draft — requires operator review before dispatch]`,
  },
  reconciliation_drift: {
    subject: 'Finance Alert — Carrier Reconciliation Discrepancy Detected {{effective_date}}',
    body: `Finance Team,

A carrier invoice reconciliation discrepancy has been detected requiring review.

Please log in to BitsAuto → Carrier Reconciliation to review the full analysis and recommendations.

[Auto-generated draft — requires operator review before dispatch]`,
  },
  invoice_generated: {
    subject: 'Invoice Generated — Draft Ready for Review {{effective_date}}',
    body: `Finance Team,

A new invoice draft has been generated and is ready for your review.

Please log in to BitsAuto → Invoices to review the draft before approval.

[Auto-generated draft — requires operator review before dispatch]`,
  },
  executive_report: {
    subject: 'Executive Report Ready — {{effective_date}}',
    body: `Management Team,

Your monthly executive intelligence report has been generated and is ready for review.

Please log in to BitsAuto → Executive Reports to view the full report.

[Auto-generated draft — requires operator review before dispatch]`,
  },
};

// ── Cooldown enforcement ──────────────────────────────────────────────────────

const _lastTriggered: Map<string, number> = new Map();

function isOnCooldown(policyId: number, cooldownMinutes: number): boolean {
  if (cooldownMinutes <= 0) return false;
  const key  = String(policyId);
  const last = _lastTriggered.get(key);
  if (!last) return false;
  return (Date.now() - last) < cooldownMinutes * 60 * 1000;
}

function markTriggered(policyId: number): void {
  _lastTriggered.set(String(policyId), Date.now());
}

// ── Core dispatcher ───────────────────────────────────────────────────────────

export interface PolicyDispatchResult {
  policiesMatched:  number;
  draftsCreated:    number;
  skipped:          number;
  notificationIds:  number[];
}

/**
 * Match enabled communication policies to a trigger event and auto-create
 * draft commercial_notification records for each match.
 *
 * This is FIRE-AND-FORGET safe — errors are caught and logged, never thrown.
 * The caller's economics transaction is never affected.
 */
export async function dispatchPoliciesForEvent(opts: {
  triggerType:        CommPolicyTrigger;
  severity?:          CommPolicySeverity;
  changeEvent?:       TariffChangeEvent;
  extraVars?:         Record<string, string>;
  sourceDescription?: string;
}): Promise<PolicyDispatchResult> {
  const result: PolicyDispatchResult = {
    policiesMatched: 0,
    draftsCreated:   0,
    skipped:         0,
    notificationIds: [],
  };

  try {
    const policies = await storage.listCommunicationPolicies({ enabled: true, triggerType: opts.triggerType });
    result.policiesMatched = policies.length;

    const severity = opts.severity ?? 'all';
    const templateVars: Record<string, string> = {
      effective_date: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
      client_name:    'Valued Customer',
      ...(opts.changeEvent ? buildVarsFromChangeEvent(opts.changeEvent) : {}),
      ...(opts.extraVars ?? {}),
    };

    for (const policy of policies) {
      // Severity filter — 'all' always matches; otherwise exact match required
      if (policy.severityFilter !== 'all' && policy.severityFilter !== severity) {
        result.skipped++;
        continue;
      }

      // Cooldown
      if (isOnCooldown(policy.id, policy.cooldownMinutes)) {
        result.skipped++;
        continue;
      }

      const tmplKey = policy.templateType ?? opts.triggerType;
      const tmpl    = TRIGGER_DEFAULTS[tmplKey] ?? TRIGGER_DEFAULTS['rate_change'];

      const draft: InsertCommercialNotification = {
        type:               policy.templateType ?? opts.triggerType,
        destination:        templateVars.destination,
        prefix:             opts.changeEvent?.prefix ?? undefined,
        oldValue:           opts.changeEvent?.oldPrice1 != null
                              ? String(opts.changeEvent.oldPrice1)
                              : undefined,
        newValue:           opts.changeEvent?.newPrice1 != null
                              ? String(opts.changeEvent.newPrice1)
                              : undefined,
        effectiveDate:      templateVars.effective_date,
        subject:            substitute(tmpl.subject, templateVars),
        body:               substitute(tmpl.body, templateVars),
        audienceType:       policy.recipientGroup,
        senderProfileId:    policy.senderProfileId ?? undefined,
        tariffChangeEventId: opts.changeEvent?.id ?? undefined,
        policyId:           policy.id,
        createdBy:          'comm-policy-engine',
        status:             'draft',
      };

      const notification = await storage.createCommercialNotification(draft);
      result.notificationIds.push(notification.id);
      result.draftsCreated++;
      markTriggered(policy.id);
    }
  } catch (err: any) {
    console.error('[comm-policy] dispatchPoliciesForEvent error:', err.message);
  }

  if (result.draftsCreated > 0) {
    console.log(
      `[comm-policy] ${opts.triggerType}: ${result.draftsCreated} draft(s) created, ` +
      `${result.skipped} skipped (cooldown/severity)`
    );
  }

  return result;
}

/**
 * Dispatch policies for a batch of tariff change events.
 * Called after snapshotAndDetect() creates change events.
 * Non-blocking — errors do not affect the caller.
 */
export async function dispatchPoliciesForChangeEvents(
  changeEvents: TariffChangeEvent[],
): Promise<void> {
  for (const event of changeEvents) {
    const trigger = CHANGE_TYPE_TO_TRIGGER[event.changeType];
    if (!trigger) continue;

    await dispatchPoliciesForEvent({
      triggerType:  trigger,
      changeEvent:  event,
    }).catch(err => {
      console.error(`[comm-policy] event #${event.id} (${event.changeType}) dispatch failed:`, err.message);
    });
  }
}

// ── CRUD thin wrappers ────────────────────────────────────────────────────────

export async function listPolicies(): Promise<CommunicationPolicy[]> {
  return storage.listCommunicationPolicies({});
}

export async function createPolicy(data: Omit<CommunicationPolicy, 'id' | 'createdAt'>): Promise<CommunicationPolicy> {
  return storage.createCommunicationPolicy(data);
}

export async function updatePolicy(id: number, updates: Partial<CommunicationPolicy>): Promise<CommunicationPolicy> {
  return storage.updateCommunicationPolicy(id, updates);
}

export async function deletePolicy(id: number): Promise<void> {
  return storage.deleteCommunicationPolicy(id);
}

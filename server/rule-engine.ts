/**
 * Route Execution Engine
 *
 * Evaluates enabled routing rules every 5 minutes against live CDR cache metrics.
 * When a rule condition is satisfied and the cooldown has expired:
 *   • alert         — logs the event and updates lastTriggeredAt
 *   • deprioritise  — fetches current RG member state, submits updateRoutingGroupMember
 *                     (+1 preference) to the Approval Queue with a before/after diff
 *   • flag_approval — same as deprioritise but labelled for human review
 *   • block         — submits updateRoutingGroupMember (preference=999) to Approval Queue
 *
 * actionPayload JSON (required for route-modifying actions):
 *   { "iRoutingGroup": 123, "iRoutingGroupMember": 456, "preferenceStep": 1 }
 *
 * One-click rollback: POST /api/approvals/:id/rollback swaps payloadBefore ↔ payloadAfter
 * and creates a new approval request linked via rollbackOf.
 */

import { storage } from "./storage";
import * as sippy from "./sippy";
import { submitApprovalRequest } from "./approvals";
import type { RoutingRule } from "@shared/schema";

export type SippyCDR = Awaited<ReturnType<typeof sippy.getSippyCDRs>>[0];

export interface RuleEvalResult {
  ruleId:   number;
  ruleName: string;
  fired:    boolean;
  metric:   string;
  current:  number | null;
  threshold: number;
  action:   string;
  message:  string;
  approvalRequestId?: number;
}

// ─── Credential helpers ───────────────────────────────────────────────────────

const DEFAULT_SIPPY_URL      = 'https://191.101.30.107';
const DEFAULT_SIPPY_USERNAME = 'ssp-root';
const DEFAULT_SIPPY_PASSWORD = '!chiaan1';

type SippySettings = {
  portalUrl?: string | null;
  apiAdminUsername?: string | null;
  apiAdminPassword?: string | null;
  portalUsername?: string | null;
  portalPassword?: string | null;
};

function sippyCreds(s: SippySettings): { username: string; password: string } {
  return {
    username: s.apiAdminUsername || s.portalUsername || DEFAULT_SIPPY_USERNAME,
    password: s.apiAdminPassword || s.portalPassword || DEFAULT_SIPPY_PASSWORD,
  };
}

function sippyBase(s: { portalUrl?: string | null }): string {
  return s.portalUrl || DEFAULT_SIPPY_URL;
}

// ─── Metric computation ───────────────────────────────────────────────────────

function computeMetrics(
  cdrs: SippyCDR[],
  windowMs: number,
  scopeVendor?: string | null,
  liveCalls?: any[],
): Record<string, number | null> {
  const cutoff = Date.now() - windowMs;

  const window = cdrs.filter(c => {
    const ts = c.startTime ? new Date(c.startTime).getTime() : 0;
    if (ts < cutoff) return false;
    if (scopeVendor) {
      const vendorMatch =
        (c.vendor && c.vendor.toLowerCase().includes(scopeVendor.toLowerCase()));
      if (!vendorMatch) return false;
    }
    return true;
  });

  const total = window.length;
  if (total === 0) return { asr: null, acd: null, pdd: null, concurrent_calls: null };

  const answered = window.filter(c => {
    const result = String(c.result ?? '').toUpperCase();
    return result === 'NORMAL_CLEARING' || result === '200' || Number(c.duration) > 0;
  });

  const asr = total > 0 ? (answered.length / total) * 100 : null;

  const durations = answered.map(c => Number(c.duration ?? 0)).filter(d => d > 0);
  const acd = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : null;

  const pdds = window.map(c => Number(c.pdd ?? 0)).filter(p => p > 0);
  const pdd = pdds.length > 0 ? pdds.reduce((a, b) => a + b, 0) / pdds.length : null;

  let concurrentCalls: number | null = null;
  if (liveCalls) {
    const filtered = scopeVendor
      ? liveCalls.filter((c: any) =>
          (c.vendor && String(c.vendor).toLowerCase().includes(scopeVendor.toLowerCase())) ||
          (c.connectionName && String(c.connectionName).toLowerCase().includes(scopeVendor.toLowerCase()))
        )
      : liveCalls;
    concurrentCalls = filtered.length;
  }

  return { asr, acd, pdd, concurrent_calls: concurrentCalls };
}

// ─── Condition evaluation ─────────────────────────────────────────────────────

function evalCondition(value: number, operator: string, threshold: number): boolean {
  switch (operator) {
    case 'lt':  return value < threshold;
    case 'gt':  return value > threshold;
    case 'lte': return value <= threshold;
    case 'gte': return value >= threshold;
    default:    return false;
  }
}

// ─── Rule evaluation engine ───────────────────────────────────────────────────

export async function evaluateRules(
  cdrCache: Map<string, SippyCDR>,
  liveCallsCache: { calls: any[]; ts: number },
): Promise<RuleEvalResult[]> {
  const { db } = await import('./db');
  const { routingRules, approvalRequests } = await import('../shared/schema');
  const { eq, and, gte, desc } = await import('drizzle-orm');

  const rules: RoutingRule[] = await db
    .select()
    .from(routingRules)
    .then(rows => rows.filter(r => r.enabled));

  if (rules.length === 0) return [];

  const settings = await storage.getSippySettings();
  const { username, password } = sippyCreds(settings ?? {});
  const portalUrl = sippyBase(settings ?? {});

  const cdrs = Array.from(cdrCache.values());
  const liveCalls = liveCallsCache.ts > 0 ? liveCallsCache.calls : [];

  const results: RuleEvalResult[] = [];

  for (const rule of rules) {
    const windowMs = (rule.conditionDurationMin ?? 5) * 60 * 1000;
    const metrics = computeMetrics(cdrs, windowMs, rule.scopeVendor, liveCalls);

    const metricValue = metrics[rule.conditionMetric] ?? null;

    if (metricValue === null) {
      results.push({
        ruleId: rule.id, ruleName: rule.name, fired: false,
        metric: rule.conditionMetric, current: null,
        threshold: rule.conditionThreshold, action: rule.actionType,
        message: `No data for metric "${rule.conditionMetric}" — skipped`,
      });
      continue;
    }

    const conditionMet = evalCondition(metricValue, rule.conditionOperator, rule.conditionThreshold);

    if (!conditionMet) {
      results.push({
        ruleId: rule.id, ruleName: rule.name, fired: false,
        metric: rule.conditionMetric, current: metricValue,
        threshold: rule.conditionThreshold, action: rule.actionType,
        message: `Condition not met (${metricValue.toFixed(2)} vs ${rule.conditionThreshold})`,
      });
      continue;
    }

    // Cooldown: don't re-fire within conditionDurationMin minutes
    if (rule.lastTriggeredAt) {
      const lastMs = new Date(rule.lastTriggeredAt).getTime();
      const cooldownMs = windowMs;
      if (Date.now() - lastMs < cooldownMs) {
        results.push({
          ruleId: rule.id, ruleName: rule.name, fired: false,
          metric: rule.conditionMetric, current: metricValue,
          threshold: rule.conditionThreshold, action: rule.actionType,
          message: `Condition met but in cooldown until ${new Date(lastMs + cooldownMs).toISOString()}`,
        });
        continue;
      }
    }

    // Check for duplicate pending approval from this rule
    const pending = await db.select({ id: approvalRequests.id })
      .from(approvalRequests)
      .where(and(
        eq(approvalRequests.ruleId, rule.id),
        eq(approvalRequests.status, 'pending'),
      ))
      .limit(1);

    if (pending.length > 0) {
      results.push({
        ruleId: rule.id, ruleName: rule.name, fired: false,
        metric: rule.conditionMetric, current: metricValue,
        threshold: rule.conditionThreshold, action: rule.actionType,
        message: `Condition met but approval #${pending[0].id} is already pending`,
      });
      continue;
    }

    // Update lastTriggeredAt and triggerCount
    await db.update(routingRules)
      .set({
        lastTriggeredAt: new Date(),
        triggerCount: (rule.triggerCount ?? 0) + 1,
      })
      .where(eq(routingRules.id, rule.id));

    if (rule.actionType === 'alert') {
      console.log(`[rule-engine] ALERT fired: rule="${rule.name}" metric=${rule.conditionMetric}=${metricValue.toFixed(2)} threshold=${rule.conditionThreshold}`);
      results.push({
        ruleId: rule.id, ruleName: rule.name, fired: true,
        metric: rule.conditionMetric, current: metricValue,
        threshold: rule.conditionThreshold, action: 'alert',
        message: `Alert: ${rule.conditionMetric}=${metricValue.toFixed(2)} ${rule.conditionOperator} ${rule.conditionThreshold}`,
      });
      continue;
    }

    // For route-modifying actions we need actionPayload to specify the target member
    let actionConfig: { iRoutingGroup?: number; iRoutingGroupMember?: number; preferenceStep?: number } = {};
    try {
      if (rule.actionPayload) actionConfig = JSON.parse(rule.actionPayload);
    } catch {
      results.push({
        ruleId: rule.id, ruleName: rule.name, fired: false,
        metric: rule.conditionMetric, current: metricValue,
        threshold: rule.conditionThreshold, action: rule.actionType,
        message: `Cannot parse actionPayload JSON: ${rule.actionPayload}`,
      });
      continue;
    }

    const { iRoutingGroup, iRoutingGroupMember, preferenceStep = 1 } = actionConfig;

    // ── Auto-discover RG member if not in actionPayload ─────────────────────
    let memberInfo: { iRoutingGroupMember: number; iRoutingGroup: number; preference: number | null; label: string } | null = null;

    if (iRoutingGroupMember && iRoutingGroup) {
      // Directly specified — fetch current preference from Sippy
      let fetchedPreference: number | null = null;
      try {
        const membersResult = await sippy.listRoutingGroupMembers(username, password, iRoutingGroup, { portalUrl });
        if (membersResult.members) {
          const m = membersResult.members.find((m: any) => m.iRoutingGroupMember === iRoutingGroupMember);
          if (m) fetchedPreference = m.preference ?? null;
        }
      } catch (e: any) {
        console.warn(`[rule-engine] Failed to fetch RG member for rule "${rule.name}":`, e.message);
      }
      memberInfo = {
        iRoutingGroupMember,
        iRoutingGroup,
        preference: fetchedPreference,
        label: rule.scopeVendor ?? `Member #${iRoutingGroupMember}`,
      };
    } else if (iRoutingGroup && rule.scopeVendor) {
      // Auto-discover by scanning the specified RG — match by iVendor name via connectionVendorCache
      try {
        const membersResult = await sippy.listRoutingGroupMembers(username, password, iRoutingGroup, { portalUrl });
        if (membersResult.members && membersResult.members.length > 0) {
          // Pick the first member since we can't filter by name without the cache
          const m = membersResult.members[0];
          if (m && m.iRoutingGroupMember != null) {
            memberInfo = {
              iRoutingGroupMember: m.iRoutingGroupMember as number,
              iRoutingGroup,
              preference: m.preference ?? null,
              label: rule.scopeVendor,
            };
          }
        }
      } catch (e: any) {
        console.warn(`[rule-engine] Auto-discover failed for rule "${rule.name}":`, e.message);
      }
    }

    if (!memberInfo) {
      results.push({
        ruleId: rule.id, ruleName: rule.name, fired: false,
        metric: rule.conditionMetric, current: metricValue,
        threshold: rule.conditionThreshold, action: rule.actionType,
        message: `Cannot determine target RG member. Set actionPayload: {"iRoutingGroup":NNN,"iRoutingGroupMember":NNN} on the rule.`,
      });
      continue;
    }

    // ── Compute before/after payloads ────────────────────────────────────────
    const currentPreference = memberInfo.preference ?? 10;
    let newPreference: number;

    if (rule.actionType === 'block') {
      newPreference = 999;
    } else {
      // deprioritise or flag_approval
      newPreference = currentPreference + preferenceStep;
    }

    const payloadBefore = {
      iRoutingGroupMember: memberInfo.iRoutingGroupMember,
      iRoutingGroup: memberInfo.iRoutingGroup,
      preference: currentPreference,
      label: memberInfo.label,
    };

    const payloadAfter = {
      iRoutingGroupMember: memberInfo.iRoutingGroupMember,
      iRoutingGroup: memberInfo.iRoutingGroup,
      preference: newPreference,
      label: memberInfo.label,
    };

    const actionLabel = rule.actionType === 'block'
      ? 'Block (preference=999)'
      : rule.actionType === 'flag_approval'
        ? 'Flag for Approval'
        : `Deprioritise (preference ${currentPreference}→${newPreference})`;

    const entityName = `[${actionLabel}] ${memberInfo.label} — RG #${memberInfo.iRoutingGroup}`;

    try {
      const req = await submitApprovalRequest({
        operationType: 'routing_group_member.update',
        action: 'update',
        entityId: String(memberInfo.iRoutingGroupMember),
        entityName,
        payloadBefore,
        payloadAfter,
        requestedBy: 'rule-engine',
        requestedByName: `Rule Engine — ${rule.name}`,
        teamId: null,
        source: 'rule_engine',
        ruleId: rule.id,
      });

      console.log(`[rule-engine] FIRED rule="${rule.name}" action=${rule.actionType} metric=${rule.conditionMetric}=${metricValue.toFixed(2)} → approval #${req.id}`);

      results.push({
        ruleId: rule.id, ruleName: rule.name, fired: true,
        metric: rule.conditionMetric, current: metricValue,
        threshold: rule.conditionThreshold, action: rule.actionType,
        message: `${actionLabel}: preference ${currentPreference}→${newPreference} — submitted as Approval #${req.id}`,
        approvalRequestId: req.id,
      });
    } catch (e: any) {
      console.error(`[rule-engine] Failed to submit approval for rule "${rule.name}":`, e.message);
      results.push({
        ruleId: rule.id, ruleName: rule.name, fired: false,
        metric: rule.conditionMetric, current: metricValue,
        threshold: rule.conditionThreshold, action: rule.actionType,
        message: `Failed to submit approval: ${e.message}`,
      });
    }
  }

  return results;
}

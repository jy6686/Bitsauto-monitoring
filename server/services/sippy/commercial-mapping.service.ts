/**
 * commercial-mapping.service.ts
 *
 * ONE implementation of "what is this Sippy account's commercial mapping?",
 * and one implementation of writing it down.
 *
 * Before this existed the account -> billing plan -> tariff walk lived inline
 * in GET /api/sippy/accounts/:id/info and nowhere else, so it informed a screen
 * and was then thrown away. POST /api/sippy/sync/pull fetched the same account
 * and stored only `status`. The result was a company that knew its Sippy
 * account number but not its tariff, which is precisely what blocks invoicing.
 *
 * ── Read-only toward Sippy ───────────────────────────────────────────────────
 * Nothing here writes to Sippy. It reads getAccountInfo and, when the account
 * carries no direct tariff, listSippyBillingPlans. Service Plans, Tariffs,
 * Rates and Billing Plans are Sippy's to own; BitsAuto mirrors them and never
 * edits them.
 *
 * ── Discovery is not authority ───────────────────────────────────────────────
 * What is discovered here NEVER overrides what is already stored — see
 * planMappingPersistence in ../../commercial-mapping. Invoice generation keeps
 * validating against the stored company record and keeps refusing when it is
 * absent; this service exists so the record stops being absent, not so billing
 * can resolve tariffs live.
 */

import * as sippy from '../../sippy';
import { storage } from '../../storage';
import {
  planMappingPersistence, describeMappingPlan,
  type MappingPlan, type DiscoveredMapping,
} from '../../commercial-mapping';

/**
 * Credentials are passed in rather than resolved here.
 *
 * The helpers that build them (sippyPortalUrl / sippyXmlCredsPairs) live in
 * routes.ts; importing routes from a service would invert the dependency and
 * risk a cycle. Callers already hold them.
 */
export interface SippyAccess {
  portalUrl: string;
  /** Tried in order — instances differ in which credential pair can read accounts. */
  credPairs: Array<{ username: string; password: string }>;
}

export interface DiscoveryResult extends DiscoveredMapping {
  iAccount:      number;
  iRoutingGroup: number | null;
  username:      string | null;
  description:   string | null;
  /** Live telemetry, carried for callers that reported it — never persisted. */
  balance:       number | null;
  blocked:       boolean;
  /** How the tariff was found — an audit fact, not a value to store. */
  tariffSource:  'account' | 'billing_plan' | 'unresolved';
  /** Non-fatal problems: a billing-plan lookup that failed, a plan not found. */
  warnings:      string[];
}

/**
 * Walks account -> billing plan -> tariff.
 *
 * Some Sippy instances assign the tariff directly on the account; others assign
 * a Service Plan (billing plan) that carries it, in which case getAccountInfo
 * returns an empty i_tariff and a populated i_billing_plan. Both shapes are
 * normal, so an empty i_tariff is not an error until the plan lookup also
 * fails.
 *
 * Returns null only when the account itself cannot be read — a missing tariff
 * comes back as a result with iTariff null and tariffSource 'unresolved', so
 * the caller can tell "Sippy is unreachable" from "Sippy has no tariff here".
 * Those need different operator responses and must not collapse into one.
 */
export async function discoverCommercialMapping(
  iAccount: number,
  access: SippyAccess,
): Promise<DiscoveryResult | null> {
  const warnings: string[] = [];

  let info: any = null;
  for (const { username, password } of access.credPairs) {
    try {
      info = await sippy.getAccountInfo(username, password, access.portalUrl, iAccount);
      if (info) break;
    } catch { /* try the next credential pair */ }
  }
  if (!info) return null;

  let iTariff: number | null = info.iTariff != null ? Number(info.iTariff) : null;
  let tariffSource: DiscoveryResult['tariffSource'] = iTariff != null ? 'account' : 'unresolved';

  if (iTariff == null && info.iBillingPlan != null && access.credPairs.length > 0) {
    try {
      const { plans } = await sippy.listSippyBillingPlans(
        access.credPairs[0].username, access.credPairs[0].password, access.portalUrl,
      );
      const plan = plans.find((p: any) =>
        Number(p.id) === Number(info.iBillingPlan) ||
        Number(p.iBillingPlan) === Number(info.iBillingPlan),
      );
      if (plan?.iTariff != null) {
        iTariff = Number(plan.iTariff);
        tariffSource = 'billing_plan';
      } else {
        warnings.push(`billing plan ${info.iBillingPlan} carries no tariff`);
      }
    } catch (e: any) {
      warnings.push(`billing plan lookup failed: ${e.message}`);
    }
  }

  return {
    iAccount:      Number(info.iAccount ?? iAccount),
    iTariff,
    iBillingPlan:  info.iBillingPlan != null ? Number(info.iBillingPlan) : null,
    iRoutingGroup: info.iRoutingGroup != null ? Number(info.iRoutingGroup) : null,
    currency:      info.baseCurrency ?? null,
    username:      info.username ?? null,
    description:   info.description ?? null,
    balance:       info.balance != null ? Number(info.balance) : null,
    blocked:       !!info.blocked,
    tariffSource,
    warnings,
  };
}

export interface PersistResult {
  plan:      MappingPlan;
  /** True when at least one column was written. */
  persisted: boolean;
  summary:   string;
}

/**
 * Writes only what the company does not already know.
 *
 * Deliberately does NOT touch routingGroupId: that column records what the
 * routing PACKAGE resolved during preparation — provisioning intent, not a
 * mirror of Sippy — so overwriting it from a live account would replace a
 * decision with an observation.
 *
 * A conflict writes nothing and is surfaced, not resolved. Billing continues on
 * the stored value.
 */
export async function persistCommercialMapping(
  companyId: number,
  companyName: string,
  stored: { sippyITariff?: number | null; sippyIBillingPlan?: number | null; sippyTariffCurrency?: string | null },
  discovered: DiscoveredMapping,
): Promise<PersistResult> {
  const plan    = planMappingPersistence(stored, discovered);
  const summary = describeMappingPlan(companyName, plan);

  const hasUpdates = Object.keys(plan.updates).length > 0;
  if (hasUpdates) {
    await storage.updateCompany(companyId, plan.updates as any);
  }

  if (plan.conflicts.length) console.warn(`[commercial-mapping] ${summary}`);
  else if (hasUpdates)       console.log(`[commercial-mapping] ${summary}`);

  return { plan, persisted: hasUpdates, summary };
}

/**
 * Discover and persist in one step — what both sync endpoints call.
 *
 * Returns null when the account could not be read, so the caller can answer
 * 502 rather than reporting a successful sync that learned nothing.
 */
export async function syncCommercialMapping(
  company: { id: number; name: string; sippyIAccount?: number | null;
             sippyITariff?: number | null; sippyIBillingPlan?: number | null;
             sippyTariffCurrency?: string | null },
  access: SippyAccess,
): Promise<{ discovery: DiscoveryResult; persist: PersistResult } | null> {
  if (!company.sippyIAccount) return null;

  const discovery = await discoverCommercialMapping(company.sippyIAccount, access);
  if (!discovery) return null;

  const persist = await persistCommercialMapping(
    company.id, company.name,
    {
      sippyITariff:        company.sippyITariff,
      sippyIBillingPlan:   company.sippyIBillingPlan,
      sippyTariffCurrency: company.sippyTariffCurrency,
    },
    discovery,
  );

  for (const w of discovery.warnings) {
    console.warn(`[commercial-mapping] ${company.name} (account ${company.sippyIAccount}): ${w}`);
  }

  return { discovery, persist };
}

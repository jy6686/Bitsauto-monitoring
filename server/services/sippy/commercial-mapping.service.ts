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
  planMappingPersistence, describeMappingPlan, mappingStatus,
  type MappingPlan, type MappingStatus, type DiscoveredMapping,
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
      // Matched on `id` alone: listSippyBillingPlans builds
      // { id, name, currency, iTariff } and never sets iBillingPlan, so the
      // second half of what used to be an `||` here compared NaN to a number
      // on every call — dead code that implied a fallback which cannot fire.
      const plan = plans.find((p: any) => Number(p.id) === Number(info.iBillingPlan));
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
  /**
   * What happened, in one word. Read this rather than `persisted`: a re-sync
   * of an already-correct company writes nothing, so `persisted:false` alone
   * cannot be told apart from a sync that discovered nothing.
   */
  status:    MappingStatus;
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
  else                       console.log(`[commercial-mapping] ${summary}`);

  return { plan, persisted: hasUpdates, status: mappingStatus(plan), summary };
}

// ── Estate-wide preview and apply ─────────────────────────────────────────────

/** A company as these functions need it. */
export interface MappableCompany {
  id: number;
  name: string;
  sippyIAccount?: number | null;
  sippyITariff?: number | null;
  sippyIBillingPlan?: number | null;
  sippyTariffCurrency?: string | null;
}

/**
 * `unreachable` is deliberately NOT one of MappingStatus's four values.
 *
 * "Sippy has no tariff for this account" and "we could not read this account"
 * look identical in a results table and mean opposite things: the first is a
 * data gap on the switch, the second is a failed read that should be retried.
 * Collapsing them would put a transient outage in the same column as a real
 * commercial gap.
 */
export type PreviewAction = MappingStatus | 'unreachable';

export interface MappingPreviewRow {
  companyId:          number;
  companyName:        string;
  sippyIAccount:      number;
  storedITariff:      number | null;
  liveITariff:        number | null;
  storedIBillingPlan: number | null;
  liveIBillingPlan:   number | null;
  action:             PreviewAction;
  tariffSource?:      string;
  conflicts:          MappingPlan['conflicts'];
  warnings:           string[];
  error?:             string;
}

/**
 * What a sync WOULD do across a set of companies. Writes nothing.
 *
 * Sequential rather than parallel: this is 25+ XML-RPC round trips to a live
 * production switch, and BitsAuto has no business opening 25 concurrent
 * connections to it to save a few seconds on a screen nobody is watching.
 */
export async function previewCommercialMappings(
  companies: MappableCompany[],
  access: SippyAccess,
  opts: { pauseMs?: number } = {},
): Promise<MappingPreviewRow[]> {
  const pauseMs = opts.pauseMs ?? 60;
  const rows: MappingPreviewRow[] = [];

  for (const [i, c] of companies.entries()) {
    if (!c.sippyIAccount) continue;
    const base = {
      companyId: c.id, companyName: c.name, sippyIAccount: c.sippyIAccount,
      storedITariff: c.sippyITariff ?? null,
      storedIBillingPlan: c.sippyIBillingPlan ?? null,
    };
    try {
      const d = await discoverCommercialMapping(c.sippyIAccount, access);
      if (!d) {
        rows.push({
          ...base, liveITariff: null, liveIBillingPlan: null,
          action: 'unreachable', conflicts: [], warnings: [],
          error: 'Sippy account could not be read',
        });
      } else {
        const plan = planMappingPersistence(
          { sippyITariff: c.sippyITariff, sippyIBillingPlan: c.sippyIBillingPlan,
            sippyTariffCurrency: c.sippyTariffCurrency },
          d,
        );
        rows.push({
          ...base,
          liveITariff: d.iTariff ?? null, liveIBillingPlan: d.iBillingPlan ?? null,
          action: mappingStatus(plan), tariffSource: d.tariffSource,
          conflicts: plan.conflicts, warnings: d.warnings,
        });
      }
    } catch (e: any) {
      rows.push({
        ...base, liveITariff: null, liveIBillingPlan: null,
        action: 'unreachable', conflicts: [], warnings: [], error: e?.message ?? String(e),
      });
    }
    if (pauseMs && i < companies.length - 1) await new Promise(r => setTimeout(r, pauseMs));
  }

  return rows;
}

export interface ApplyRow {
  companyId:   number;
  companyName: string;
  action:      PreviewAction;
  filled:      string[];
  conflicts:   MappingPlan['conflicts'];
  error?:      string;
}

export interface ApplyResult {
  requested: number;
  rows:      ApplyRow[];
  summary:   Record<PreviewAction, number>;
}

/**
 * Apply the fill-only sync to an explicitly named set of companies.
 *
 * Continues past failures: one unreadable account must not abandon the other
 * twenty-four. Every company appears in `rows` whatever happened to it, so the
 * report is complete rather than "the ones that worked".
 */
export async function applyCommercialMappings(
  companies: MappableCompany[],
  access: SippyAccess,
  opts: { pauseMs?: number } = {},
): Promise<ApplyResult> {
  const pauseMs = opts.pauseMs ?? 60;
  const rows: ApplyRow[] = [];

  for (const [i, c] of companies.entries()) {
    try {
      const r = await syncCommercialMapping(c, access);
      if (!r) {
        rows.push({
          companyId: c.id, companyName: c.name, action: 'unreachable',
          filled: [], conflicts: [], error: 'Sippy account could not be read',
        });
      } else {
        rows.push({
          companyId: c.id, companyName: c.name, action: r.persist.status,
          filled: r.persist.plan.filled, conflicts: r.persist.plan.conflicts,
        });
      }
    } catch (e: any) {
      rows.push({
        companyId: c.id, companyName: c.name, action: 'unreachable',
        filled: [], conflicts: [], error: e?.message ?? String(e),
      });
    }
    if (pauseMs && i < companies.length - 1) await new Promise(r => setTimeout(r, pauseMs));
  }

  const summary = { filled: 0, already_current: 0, conflict: 0, nothing_discovered: 0, unreachable: 0 } as Record<PreviewAction, number>;
  for (const r of rows) summary[r.action] = (summary[r.action] ?? 0) + 1;

  return { requested: companies.length, rows, summary };
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

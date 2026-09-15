/**
 * auth-rule-set-breakout.ts — authentication rules per priced prefix ("breakout" mode).
 *
 * WHY. On 2026-09-15 tariff 68 (1global, account 1069) held the Afghanistan First Class
 * prefixes 19370 and 19371 while the account's twelve rules covered only the country codes
 * 880, 91 and 92. A call to a priced destination failed authentication before it could be
 * rated. The frozen planner's unit is a routing package cell (country, product); it cannot
 * see a breakout. This planner's unit is a priced prefix, taken from the SAME catalogue
 * expansion that produced the tariff rows, so one rule holds by construction:
 *
 *     a prefix loaded into the customer's tariff has an authentication rule,
 *     and a prefix that is not priced never gets one.
 *
 * WHAT IT DOES NOT DO. It never invents routing. The routing group for a prefix is the
 * package cell of the prefix's country and product — the same cell the country planner
 * uses. A prefix whose country has no cell, or whose cell has no routing group, is a GAP
 * that names the prefix, the destination and the remedy; the stage refuses to push a
 * partial set, exactly as the country planner does. Nothing here deletes a rule.
 *
 * Selected explicitly per company (companies.auth_rule_mode = 'breakout', migration 521).
 * The frozen planner dispatches here; every existing customer stays on 'country'.
 */
import { and, inArray, or, sql } from "drizzle-orm";
import { db, pool } from "../../db";
import { companyProducts, productRegistry, productRates } from "@shared/schema";
import { buildAuthRuleFields } from "./account-prefix";
import { COUNTRY_CODE, PRODUCT_DIGIT_BY_NAME } from "./auth-rule-vocab";
import { expandRates, activeCatalogueVersionId, type Expansion, type ExpandableRate } from "../rates/rate-prefix-expansion";
import type { AuthRuleSetPlan, PlannedAuthRule, AuthRuleSetGap } from "./auth-rule-set";

export type BreakoutProduct = { id: number; code: string; name: string; trunkPrefix: string };
export type BreakoutPrice = ExpandableRate & { productId: number };
export type BreakoutCell = { country: string; product: string; iRoutingGroup: number | null; routingGroupName: string | null };

export interface BreakoutPlanInput {
  accountPrefix: string;
  ips: string[];
  products: BreakoutProduct[];
  expansions: Array<Expansion<BreakoutPrice>>;
  cells: BreakoutCell[];
}

/** The country part of a catalogue name — "PAKISTAN - MOBILE ZONG" → "Pakistan" — for messages only. */
function countryLabel(destinationName: string | null, prefix: string): string {
  const n = (destinationName ?? "").trim();
  const i = n.indexOf(" - ");
  const head = (i > 0 ? n.slice(0, i) : n).trim();
  if (head) return head.charAt(0) + head.slice(1).toLowerCase();
  for (const [name, code] of Object.entries(COUNTRY_CODE)) if (prefix.startsWith(code)) return name.charAt(0).toUpperCase() + name.slice(1);
  return `prefix ${prefix}`;
}

/**
 * Pure. Rules = approved IPs × (product digit, priced prefix), routing group from the
 * package cell whose country code is the longest match for the prefix.
 */
export function planBreakoutRules(input: BreakoutPlanInput): AuthRuleSetPlan {
  const accountPrefix = input.accountPrefix;
  const ips = Array.from(new Set(input.ips.map(s => s.trim()).filter(Boolean)));
  const rules: PlannedAuthRule[] = [];
  const gaps: AuthRuleSetGap[] = [];
  const seenRule = new Set<string>();
  // Gaps are collected per (country, product) and name every affected destination with its
  // prefixes, so an operator reads one line per missing cell rather than one per prefix.
  type GapAcc = { country: string; product: string; byDestination: Map<string, string[]> };
  const missingCell = new Map<string, GapAcc>();
  const noGroup = new Map<string, GapAcc>();
  const note = (acc: Map<string, GapAcc>, country: string, product: string, destination: string, prefix: string) => {
    const k = `${country}|${product}`;
    const g = acc.get(k) ?? { country, product, byDestination: new Map() };
    const list = g.byDestination.get(destination) ?? [];
    if (!list.includes(prefix)) list.push(prefix);
    g.byDestination.set(destination, list); acc.set(k, g);
  };
  const describe = (g: GapAcc) => Array.from(g.byDestination, ([d, ps]) => `${d} (${ps.join(', ')})`).join(', ');

  const productById = new Map(input.products.map(p => [p.id, p]));
  // cells indexed by product digit, each with its country code, longest code first
  const cellsByDigit = new Map<string, Array<BreakoutCell & { code: string }>>();
  for (const c of input.cells) {
    const digit = PRODUCT_DIGIT_BY_NAME[c.product.trim().toLowerCase()];
    const code = COUNTRY_CODE[c.country.trim().toLowerCase()];
    if (!digit || !code) continue; // the country planner reports these; a breakout can only use a resolvable cell
    if (!cellsByDigit.has(digit)) cellsByDigit.set(digit, []);
    cellsByDigit.get(digit)!.push({ ...c, code });
  }
  for (const list of cellsByDigit.values()) list.sort((a, b) => b.code.length - a.code.length);

  const badDigit = new Set<string>();

  for (const e of input.expansions) {
    if (e.verdict !== "catalogue" && e.verdict !== "legacy_prefix") continue; // refused → never reached the tariff
    const product = productById.get(e.row.productId);
    if (!product) continue;
    const digit = String(product.trunkPrefix ?? "").trim();
    if (!/^\d+$/.test(digit)) {
      if (!badDigit.has(product.name)) { badDigit.add(product.name); gaps.push({ country: "-", product: product.name, reason: `Product "${product.name}" has no numeric product digit.` }); }
      continue;
    }

    for (const raw of e.prefixes) {
      const prefix = String(raw).trim();
      if (!/^\d+$/.test(prefix)) continue;
      const destination = e.destinationName ?? prefix;
      const cell = (cellsByDigit.get(digit) ?? []).find(c => prefix.startsWith(c.code));
      if (!cell) { note(missingCell, countryLabel(e.destinationName, prefix), product.name, destination, prefix); continue; }
      if (cell.iRoutingGroup == null) { note(noGroup, cell.country, cell.product, destination, prefix); continue; }
      const fields = buildAuthRuleFields(accountPrefix, digit, prefix);
      for (const ip of ips) {
        const k = `${ip} ${fields.incomingCld}`;
        if (seenRule.has(k)) continue;
        seenRule.add(k);
        rules.push({
          remoteIp: ip, country: cell.country, product: cell.product,
          incomingCld: fields.incomingCld, cldTranslationRule: fields.cldTranslationRule,
          iRoutingGroup: cell.iRoutingGroup, routingGroupName: cell.routingGroupName,
          prefix, destination: e.destinationName ?? null,
        });
      }
    }
  }

  for (const g of missingCell.values()) {
    gaps.push({ country: g.country, product: g.product,
      reason: `No routing cell covers ${describe(g)} for ${g.product} — add the row ${g.country} / ${g.product} to the routing package and map it to a Sippy routing group.` });
  }
  for (const g of noGroup.values()) {
    gaps.push({ country: g.country, product: g.product,
      reason: `No routing group is mapped for ${g.country} / ${g.product} — ${describe(g)} cannot be authenticated without one.` });
  }

  rules.sort((a, b) => a.remoteIp.localeCompare(b.remoteIp) || a.incomingCld.localeCompare(b.incomingCld, undefined, { numeric: true }));
  return { rules, gaps, ips, accountPrefix };
}

/**
 * Database-backed: the company's products, today's effective prices, their catalogue
 * expansion (the same call rates.step makes), and the package cells — then the pure planner.
 */
export async function planBreakoutAuthRuleSet(companyId: number, approvedIps: string[]): Promise<AuthRuleSetPlan> {
  const ips = Array.from(new Set(approvedIps.map(s => s.trim()).filter(Boolean)));
  const { rows: companyRows } = await pool.query<{ account_prefix: string | null; routing_package_id: number | null }>(
    `SELECT account_prefix, routing_package_id FROM companies WHERE id = $1`, [companyId]);
  const company = companyRows[0];
  const accountPrefix = company?.account_prefix ?? null;
  if (!company)       return { rules: [], gaps: [{ country: "-", product: "-", reason: `Company ${companyId} not found.` }], ips, accountPrefix };
  if (!accountPrefix) return { rules: [], gaps: [{ country: "-", product: "-", reason: "Company has no account prefix — every CLD rule derives from it." }], ips, accountPrefix };
  if (company.routing_package_id == null)
    return { rules: [], gaps: [{ country: "-", product: "-", reason: "Company has no routing package — preparation assigns it from the provisioning profile." }], ips, accountPrefix };

  const { rows: cellRows } = await pool.query<{ country: string; product: string; i_routing_group: number | null; routing_group_name: string | null }>(
    `SELECT country, product, i_routing_group, routing_group_name
       FROM routing_package_entries WHERE package_id = $1 AND active ORDER BY priority, country, product`,
    [company.routing_package_id]);
  const cells: BreakoutCell[] = cellRows.map(r => ({ country: r.country, product: r.product, iRoutingGroup: r.i_routing_group, routingGroupName: r.routing_group_name }));

  // What the customer bought — same source and same fallback as rates.step.
  const chosen = await db.select({ productId: companyProducts.productId }).from(companyProducts).where(sql`${companyProducts.companyId} = ${companyId}`);
  const productIds = chosen.map(r => r.productId);
  const products: BreakoutProduct[] = (await db
    .select({ id: productRegistry.id, code: productRegistry.code, name: productRegistry.name, trunkPrefix: productRegistry.trunkPrefix })
    .from(productRegistry)
    .where(productIds.length ? inArray(productRegistry.id, productIds) : inArray(productRegistry.status, ["active", "commercial"])))
    .map(p => ({ id: p.id, code: String(p.code), name: String(p.name), trunkPrefix: String(p.trunkPrefix ?? "") }));
  if (!products.length) return { rules: [], gaps: [{ country: "-", product: "-", reason: "The company has no products, so there is nothing to authenticate." }], ips, accountPrefix };

  // Prices effective today — the same filter rates.step and Rate Manager use.
  const asOf = new Date().toISOString().slice(0, 10);
  const priced: BreakoutPrice[] = (await db
    .select({ destinationId: productRates.destinationId, productId: productRates.productId, prefix: productRates.prefix, catalogueVersionId: productRates.catalogueVersionId })
    .from(productRates)
    .where(and(
      inArray(productRates.productId, products.map(p => p.id)),
      sql`${productRates.effectiveFrom} <= ${asOf}`,
      or(sql`${productRates.effectiveTo} IS NULL`, sql`${productRates.effectiveTo} >= ${asOf}`),
    )))
    .map(r => ({ destinationId: r.destinationId, productId: Number(r.productId), prefix: r.prefix, catalogueVersionId: r.catalogueVersionId }));
  if (!priced.length) return { rules: [], gaps: [{ country: "-", product: "-", reason: "No price is effective today for this company's products — breakout rules follow priced prefixes, so there is nothing to authenticate yet. Load prices in Rate Manager first." }], ips, accountPrefix };

  const activeVersionId = await activeCatalogueVersionId(db as any, sql as any);
  const expansions = await expandRates(db as any, priced, activeVersionId, sql as any);

  return planBreakoutRules({ accountPrefix, ips, products, expansions, cells });
}

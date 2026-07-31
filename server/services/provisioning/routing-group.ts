// 🔒 FROZEN — Provisioning Freeze v1.0, 2026-07-31. Critical fixes only; see
// docs/PROVISIONING-FREEZE-V1.md for the change-control block a commit must carry.
/**
 * routing-group.ts — resolve the Sippy routing group for a (company, country, product).
 *
 * Routing group is the field that decides where an authenticated call actually goes.
 * Without it Sippy falls back to the account default, which is the documented cause of
 * "No Route Found" on this platform. So this resolver never guesses: it either returns a
 * mapped group or says why it cannot.
 *
 * RESOLUTION IS A LOOKUP, NOT AN INFERENCE
 *
 *   company.routing_package_id
 *        → routing_package_entries (country, product)
 *        → i_routing_group                              (migration 050)
 *
 * Auth Studio's filterRgsByDest() narrows the 23 cached groups by matching a destination
 * keyword against the group NAME. That is a UI convenience, not a decision procedure —
 * "Pakistan" matches Pakistan, Pakistan First Class, and Pakistan First Class TALK. Which
 * of those carries a customer's First Class traffic is a commercial routing decision, so
 * the keyword match is exposed here only as suggestRoutingGroups(), for a human filling
 * the mapping grid. It is never used to resolve.
 *
 * Reading from routing_groups_cache rather than Sippy is deliberate: the cache is synced
 * every 15 minutes and provisioning should not add switch load, nor fail because a portal
 * lookup timed out mid-run.
 */
import { pool } from "../../db";

/** Destination keyword table — mirrors DESTINATIONS in client/src/pages/auth-studio.tsx.
 *  Used ONLY for suggestions. */
const DESTINATION_KEYWORDS: Record<string, string[]> = {
  Pakistan:      ["pakistan", "pk-", "pk ", "_pk"],
  UK:            ["uk", "united kingdom", "britain", " uk "],
  Bangladesh:    ["bangladesh", "bangla", "_bd", "bd-"],
  India:         ["india", " in ", "_in-"],
  UAE:           ["uae", "emirates", "dubai"],
  "USA / Canada":["usa", "canada", "nanp", "us-"],
  Afghanistan:   ["afghan", "afg"],
  "Saudi Arabia":["saudi", "ksa"],
  Kenya:         ["kenya"],
  Nigeria:       ["nigeria", "nig"],
};

export type RoutingGroupResolution =
  | { ok: true;  iRoutingGroup: number; name: string | null }
  | { ok: false; reason: string; remedy: string };

/**
 * Resolve the routing group for one (country, product) cell of a company's package.
 * Every failure names what is missing and what to do — a run that halts here must tell an
 * operator which cell to fill, not merely that routing was unavailable.
 */
export async function resolveRoutingGroup(
  companyId: number,
  country: string,
  product: string,
): Promise<RoutingGroupResolution> {
  const { rows } = await pool.query<{
    routing_package_id: number | null;
    i_routing_group: number | null;
    routing_group_name: string | null;
  }>(
    `SELECT c.routing_package_id, e.i_routing_group, e.routing_group_name
       FROM companies c
       LEFT JOIN routing_package_entries e
         ON e.package_id = c.routing_package_id
        AND e.country    = $2
        AND e.product    = $3
        AND e.active
      WHERE c.id = $1`,
    [companyId, country, product],
  );

  const row = rows[0];
  if (!row) {
    return { ok: false, reason: `Company ${companyId} not found.`, remedy: 'Check the company id.' };
  }
  if (row.routing_package_id == null) {
    return {
      ok: false,
      reason: 'The company has no routing package.',
      remedy: 'Preparation assigns the routing package from the provisioning profile. Re-run preparation for this company.',
    };
  }
  if (row.i_routing_group == null) {
    return {
      ok: false,
      reason: `No routing group is mapped for ${country} / ${product}.`,
      remedy: `Map the ${country} / ${product} cell of routing package ${row.routing_package_id} to a Sippy routing group. Candidates are suggested from the routing cache, but the choice is a routing decision.`,
    };
  }
  return { ok: true, iRoutingGroup: row.i_routing_group, name: row.routing_group_name };
}

/**
 * Candidate groups for a (country, product) cell, ranked. A SUGGESTION for a human filling
 * the mapping grid — deliberately not wired into resolveRoutingGroup(). Ranking is a
 * convenience; a lower-ranked group is not a wrong group.
 */
export async function suggestRoutingGroups(
  country: string,
  product?: string,
): Promise<Array<{ iRoutingGroup: number; name: string; score: number }>> {
  const { rows } = await pool.query<{ i_routing_group: number; name: string }>(
    `SELECT i_routing_group, name FROM routing_groups_cache ORDER BY name`,
  );

  const keywords = DESTINATION_KEYWORDS[country] ?? [country.toLowerCase()];
  const productWords = product ? product.toLowerCase().split(/\s+/).filter(Boolean) : [];

  return rows
    .map(r => {
      const name = r.name.toLowerCase();
      // Destination match is the gate — a group for another country is never a candidate.
      if (!keywords.some(k => name.includes(k))) return null;
      // Product words only rank among groups that already match the destination.
      const hits = productWords.filter(w => name.includes(w)).length;
      return { iRoutingGroup: r.i_routing_group, name: r.name, score: 1 + hits };
    })
    .filter((x): x is { iRoutingGroup: number; name: string; score: number } => x !== null)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

/**
 * Every unmapped cell in a company's routing package. Preflight calls this so a run is
 * blocked before it starts rather than failing part-way through rule creation, with a
 * customer already half-configured on the switch.
 */
export async function unmappedRoutingCells(
  companyId: number,
): Promise<Array<{ country: string; product: string }>> {
  const { rows } = await pool.query<{ country: string; product: string }>(
    `SELECT e.country, e.product
       FROM companies c
       JOIN routing_package_entries e ON e.package_id = c.routing_package_id
      WHERE c.id = $1 AND e.active AND e.i_routing_group IS NULL
      ORDER BY e.country, e.product`,
    [companyId],
  );
  return rows;
}

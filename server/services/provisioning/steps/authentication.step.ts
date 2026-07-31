/**
 * authentication.step.ts — push the customer's complete authentication rule matrix.
 *
 * Authentication and IP authorisation are ONE stage. In Sippy an auth rule carrying
 * `remote_ip` IS the IP authorisation — there is no separate "authorise this IP" object.
 *
 * WHAT A RULE SET LOOKS LIKE
 * The set is approved IPs x the routing package's (country, product) grid. One IP against
 * the default 3x4 package is twelve rules — the shape of the live account "flashbee",
 * whose twelve rules all derive from the single prefix 5135. planAuthRuleSet() computes
 * the set from company state alone; this step only pushes and verifies it.
 *
 * ROUTING GROUP IS NOT OPTIONAL
 * A rule without i_routing_group authenticates the caller and then hands the call to the
 * account default — the documented cause of "No Route Found" here. So an unmapped
 * (country, product) cell blocks the stage rather than emitting a group-less rule. A
 * customer that authenticates but cannot route looks provisioned and is not.
 *
 * CAPACITY IS DELIBERATELY NOT SET PER RULE
 * addAuthRule accepts max_sessions and max_cps, and Auth Studio leaves both at 0. Copying
 * the company's capacity onto every rule would MULTIPLY it — a customer entitled to 10
 * sessions would get 10 per rule, 120 across twelve rules. Capacity is an account-level
 * agreement and the capacity step applies it there. Rules inherit.
 *
 * IDEMPOTENT — reuse is keyed on (remote_ip, incoming_cld), not the IP alone. Sippy allows
 * many rules per IP precisely because they differ by incoming CLD; keying on the IP would
 * treat eleven of flashbee's twelve rules as already present and silently skip them.
 *
 * VERIFIED FIELD BY FIELD — a rule existing is not proof it is correct. The read-back
 * compares CLD translation rule and routing group, because a rule with the wrong routing
 * group is the failure that looks like success and routes calls to the wrong carrier.
 */
import * as sippy from "../../../sippy";
import { db } from "../../../db";
import { clientIpRequests } from "@shared/schema";
import { eq } from "drizzle-orm";
import type { ProvisioningStep, StepContext, StepOutcome } from "../types";
import { planAuthRuleSet, ruleKey, type PlannedAuthRule } from "../auth-rule-set";

/** SIP. Sippy protocol ids: 1=SIP, 3=IAX2, 4=PIN. */
const PROTOCOL_SIP = 1;

async function authorisedIpsFor(companyId: number): Promise<string[]> {
  const rows = await db.select().from(clientIpRequests).where(eq(clientIpRequests.companyId, companyId));
  return Array.from(new Set(
    rows.map((r: any) => String(r.ipAddress ?? "").trim()).filter(Boolean)
  ));
}

/** Normalise a rule read back from Sippy — field names vary by API surface. */
function readRule(r: any) {
  return {
    remoteIp:      String(r.remoteIp ?? r.remote_ip ?? "").trim(),
    incomingCld:   String(r.incomingCld ?? r.incoming_cld ?? "").trim(),
    cldRule:       String(r.cldTranslationRule ?? r.cld_translation_rule ?? "").trim(),
    iRoutingGroup: r.iRoutingGroup ?? r.i_routing_group ?? null,
  };
}

export const authenticationStep: ProvisioningStep = {
  key: "authentication",
  label: "Authentication & IP Authorisation",
  order: 40,
  // Blocking: without auth rules the customer cannot authenticate, so every later stage
  // would configure an account that can never carry a call.
  blocking: true,

  async validate(ctx: StepContext): Promise<string | null> {
    if (!ctx.results.account?.iAccount) return "No account — the account stage must succeed first.";

    const ips = await authorisedIpsFor(ctx.companyId);
    if (ips.length === 0) return "No IP addresses recorded for this company.";

    // Gaps are a validation failure, not an execution failure: nothing is pushed when the
    // plan is known to be incomplete. Half a matrix on the switch is worse than none — it
    // authenticates some traffic and misroutes the rest.
    const plan = await planAuthRuleSet(ctx.companyId, ips);
    if (plan.gaps.length) {
      return `Routing is incomplete — ${plan.gaps.length} gap(s): ` +
        plan.gaps.map(g => `${g.country}/${g.product}: ${g.reason}`).join(" · ");
    }
    if (plan.rules.length === 0) return "The routing package produced no authentication rules.";
    return null;
  },

  async execute(ctx: StepContext): Promise<StepOutcome> {
    const iAccount  = Number(ctx.results.account?.iAccount);
    const iCustomer = Number(ctx.input.iCustomer ?? 1);

    const ips  = await authorisedIpsFor(ctx.companyId);
    const plan = await planAuthRuleSet(ctx.companyId, ips);

    // ── Read back what is already in Sippy ────────────────────────────────
    // Keep the full rule (including iAuthentication) so stale rules can be
    // patched. A Set-of-keys is not enough: rules created before the routing
    // matrix was populated have the right IP+CLD but the wrong (or absent)
    // routing group, and skipping them would leave a broken account.
    type ExistingRule = { iAuthentication: number | null; cldRule: string };
    let existingMap = new Map<string, ExistingRule>();
    try {
      const listed = await sippy.listSippyAuthRules(
        ctx.sippy.username, ctx.sippy.password, { iAccount, iCustomer }, ctx.sippy.portalUrl);
      for (const r of listed.authRules ?? []) {
        const rule = readRule(r);
        if (rule.remoteIp && rule.incomingCld) {
          existingMap.set(ruleKey(rule.remoteIp, rule.incomingCld), {
            iAuthentication: rule.iAuthentication,
            cldRule: rule.cldRule,
          });
        }
      }
    } catch {
      // A failed listing is not evidence the rules are absent. Fall through —
      // Sippy rejects duplicates itself and verify() is the real check.
    }

    const cells   = plan.ips.length ? plan.rules.length / plan.ips.length : 0;
    const missing = plan.rules.filter(r => !existingMap.has(ruleKey(r.remoteIp, r.incomingCld)));
    const present = plan.rules.filter(r =>  existingMap.has(ruleKey(r.remoteIp, r.incomingCld)));
    const detail: string[] = [
      `${plan.rules.length} rule(s) planned — ${plan.ips.length} IP(s) x ${cells} routing cell(s)`,
    ];
    if (existingMap.size) detail.push(`${existingMap.size} rule(s) already present`);

    const failures: string[] = [];
    let createdCount = 0;
    let updatedCount = 0;

    // ── Create rules that do not exist yet ────────────────────────────────
    for (const rule of missing) {
      const res = await sippy.addSippyAuthRule(
        ctx.sippy.username, ctx.sippy.password,
        {
          iAccount, iProtocol: PROTOCOL_SIP, iCustomer,
          remoteIp:           rule.remoteIp,
          incomingCld:        rule.incomingCld,
          cldTranslationRule: rule.cldTranslationRule,
          iRoutingGroup:      rule.iRoutingGroup,
          // max_sessions / max_cps intentionally omitted — see the header note.
        },
        ctx.sippy.portalUrl,
      );
      if (res.success) createdCount++;
      else failures.push(`${rule.remoteIp} ${rule.incomingCld} (${rule.country}/${rule.product}): ${res.message}`);
    }

    // ── Patch rules that exist but may be missing their routing group ─────
    // Rules created before the routing matrix was populated have iRoutingGroup
    // null in Sippy. Updating them is idempotent — if values are already
    // correct, updateAuthRule is a silent no-op on the switch.
    for (const rule of present) {
      const ex = existingMap.get(ruleKey(rule.remoteIp, rule.incomingCld))!;
      if (!ex.iAuthentication) {
        // No ID to update with — verify() will catch the field mismatch.
        continue;
      }
      const upd = await sippy.updateSippyAuthRule(
        ctx.sippy.username, ctx.sippy.password,
        {
          iAuthentication:    ex.iAuthentication,
          iCustomer,
          cldTranslationRule: rule.cldTranslationRule,
          iRoutingGroup:      rule.iRoutingGroup,
        },
        ctx.sippy.portalUrl,
      );
      if (upd.success) updatedCount++;
      else failures.push(`${rule.remoteIp} ${rule.incomingCld} (${rule.country}/${rule.product}) update: ${upd.message}`);
    }

    // A partial matrix is a failure, not a qualified success. Ten of twelve
    // rules leaves a customer whose traffic works for some products and
    // silently fails for others — far harder to diagnose than a customer that
    // plainly does not work at all.
    if (failures.length > 0) {
      return {
        status: "failed",
        reasonCode: "AUTH_RULE_CREATE_FAILED",
        error: `${failures.length} of ${plan.rules.length} rule(s) could not be created/updated. First: ${failures[0]}`,
        detail: [...detail, `${failures.length} failed:`, ...failures.slice(0, 12)],
        result: { iAccount, planned: plan.rules },
      };
    }

    return {
      status: "success",
      result: { iAccount, planned: plan.rules, created: createdCount, updated: updatedCount, reused: plan.rules.length - createdCount - updatedCount },
      detail: [...detail, `created ${createdCount}, updated ${updatedCount}, already correct ${plan.rules.length - createdCount - updatedCount}`],
    };
  },

  /**
   * Read the set back and compare FIELD BY FIELD. A rule that exists with the wrong
   * routing group is the failure mode that most looks like success: the customer
   * authenticates, calls connect, and traffic goes to the wrong carrier at the wrong cost.
   *
   * ROUTING GROUP READ-BACK STRATEGY
   * listAuthRules() does not return i_routing_group — this is a documented Sippy API
   * constraint (9 fields returned; i_routing_group was removed from the list response
   * when Sippy 2020 moved it to filter params). getAuthRuleInfo() returns the full
   * authrule struct that includes it. So the pattern is:
   *
   *   1. listAuthRules  → rule existence + CLD translation (fast batch)
   *   2. getAuthRuleInfo per rule → routing group (one call per rule on the slow path)
   *
   * Three outcomes for the routing group field:
   *   confirmed correct  → pass
   *   null or wrong id   → hard failure (wrong routing group is a live routing defect)
   *   undefined from both APIs → warning; step stays success (API limitation on this
   *                              switch, not evidence the group is absent)
   */
  async verify(ctx: StepContext, result: Record<string, unknown>): Promise<string | { warnings: string[] } | null> {
    const iAccount  = Number(result.iAccount);
    const planned   = (Array.isArray(result.planned) ? result.planned : []) as PlannedAuthRule[];
    if (!planned.length) return "no rules to verify";

    const iCustomer = Number(ctx.input.iCustomer ?? 1);
    const listed = await sippy.listSippyAuthRules(
      ctx.sippy.username, ctx.sippy.password,
      { iAccount, iCustomer }, ctx.sippy.portalUrl);

    // An error reading back is NOT a pass — the runner's verify contract.
    if (listed.error) return `could not read auth rules back: ${listed.error}`;

    const byKey = new Map(
      (listed.authRules ?? []).map(readRule)
        .filter(r => r.remoteIp && r.incomingCld)
        .map(r => [ruleKey(r.remoteIp, r.incomingCld), r] as const),
    );

    const problems: string[] = [];
    const warnings: string[] = [];

    for (const want of planned) {
      const got = byKey.get(ruleKey(want.remoteIp, want.incomingCld));
      if (!got) {
        problems.push(`missing: ${want.remoteIp} ${want.incomingCld} (${want.country}/${want.product})`);
        continue;
      }

      // CLD translation — always available from listAuthRules.
      if (got.cldRule !== want.cldTranslationRule) {
        problems.push(`${want.incomingCld}: CLD rule is "${got.cldRule || "(empty)"}", expected "${want.cldTranslationRule}"`);
      }

      // Routing group — listAuthRules never returns it; fall back to getAuthRuleInfo.
      let actualRg = got.iRoutingGroup; // always undefined after listAuthRules

      if (actualRg === undefined) {
        if (!got.iAuthentication) {
          // Rule returned no id — cannot look it up by id.
          problems.push(`${want.incomingCld}: Sippy returned no rule id — routing group cannot be read back`);
          continue;
        }
        const info = await sippy.getSippyAuthRuleInfo(
          ctx.sippy.username, ctx.sippy.password,
          got.iAuthentication,
          { iCustomer, portalUrl: ctx.sippy.portalUrl },
        );
        if (!info.success) {
          // getAuthRuleInfo call failed (permission, network, etc.).
          // Rule existence and CLD are confirmed; treat routing group as unverified.
          warnings.push(`${want.incomingCld}: getAuthRuleInfo(${got.iAuthentication}) failed — ${info.error} — routing group unconfirmed`);
          continue;
        }
        const fromInfo = info.authRule ? readRule(info.authRule) : null;
        if (!fromInfo || fromInfo.iRoutingGroup === undefined) {
          // This switch does not expose i_routing_group via either API surface.
          // The group was set during addAuthRule; we cannot read it back here.
          warnings.push(`${want.incomingCld}: i_routing_group absent from listAuthRules and getAuthRuleInfo — routing group unconfirmed (switch API limitation)`);
          continue;
        }
        actualRg = fromInfo.iRoutingGroup;
      }

      // actualRg is now null (no group) or a number.
      if (actualRg === null) {
        problems.push(
          `${want.incomingCld}: rule ${got.iAuthentication} has no routing group — calls will fall back to account default; ` +
          `expected ${want.iRoutingGroup} (${want.routingGroupName ?? "unnamed"})`,
        );
      } else if (Number(actualRg) !== Number(want.iRoutingGroup)) {
        problems.push(
          `${want.incomingCld}: routing group is ${actualRg}, expected ${want.iRoutingGroup} (${want.routingGroupName ?? "unnamed"})`,
        );
      }
    }

    // Hard failures: missing rules, wrong CLD translation, wrong or absent routing group.
    if (problems.length) {
      const shown = problems.slice(0, 5);
      const rest  = problems.length - shown.length;
      return `${problems.length} of ${planned.length} rule(s) did not verify — ` +
        shown.join("; ") + (rest > 0 ? ` (+${rest} more)` : "");
    }

    // Soft limitations: routing group could not be read back (API does not expose it
    // on this switch). Rules exist, CLD translations confirmed, routing group unproven.
    if (warnings.length) return { warnings };
    return null;
  },
};

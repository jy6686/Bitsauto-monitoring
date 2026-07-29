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

    // ── Reuse before create ────────────────────────────────────────────────
    let existing = new Set<string>();
    try {
      const listed = await sippy.listSippyAuthRules(
        ctx.sippy.username, ctx.sippy.password, { iAccount, iCustomer }, ctx.sippy.portalUrl);
      existing = new Set((listed.authRules ?? [])
        .map(readRule)
        .filter(r => r.remoteIp && r.incomingCld)
        .map(r => ruleKey(r.remoteIp, r.incomingCld)));
    } catch {
      // A failed listing is not evidence the rules are absent. Fall through — Sippy
      // rejects duplicates itself, and verify() below is the real check.
    }

    const cells   = plan.ips.length ? plan.rules.length / plan.ips.length : 0;
    const missing = plan.rules.filter(r => !existing.has(ruleKey(r.remoteIp, r.incomingCld)));
    const detail: string[] = [
      `${plan.rules.length} rule(s) planned — ${plan.ips.length} IP(s) x ${cells} routing cell(s)`,
    ];
    if (existing.size) detail.push(`${existing.size} rule(s) already present`);

    const failures: string[] = [];
    let createdCount = 0;

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

    // A partial matrix is a failure, not a qualified success. Ten of twelve rules leaves a
    // customer whose traffic works for some products and silently fails for others — far
    // harder to diagnose than a customer that plainly does not work.
    if (failures.length > 0) {
      return {
        status: "failed",
        reasonCode: "AUTH_RULE_CREATE_FAILED",
        error: `${failures.length} of ${missing.length} rule(s) could not be created.`,
        detail: [...detail, ...failures.slice(0, 5)],
        result: { iAccount, planned: plan.rules },
      };
    }

    return {
      status: "success",
      result: { iAccount, planned: plan.rules, created: createdCount, reused: plan.rules.length - createdCount },
      detail: [...detail, `created ${createdCount}, reused ${plan.rules.length - createdCount}`],
    };
  },

  /**
   * Read the set back and compare FIELD BY FIELD. A rule that exists with the wrong
   * routing group is the failure mode that most looks like success: the customer
   * authenticates, calls connect, and traffic goes to the wrong carrier at the wrong cost.
   */
  async verify(ctx: StepContext, result: Record<string, unknown>): Promise<string | null> {
    const iAccount = Number(result.iAccount);
    const planned  = (Array.isArray(result.planned) ? result.planned : []) as PlannedAuthRule[];
    if (!planned.length) return "no rules to verify";

    const listed = await sippy.listSippyAuthRules(
      ctx.sippy.username, ctx.sippy.password,
      { iAccount, iCustomer: Number(ctx.input.iCustomer ?? 1) }, ctx.sippy.portalUrl);

    // An error reading back is NOT a pass — the runner's verify contract.
    if (listed.error) return `could not read auth rules back: ${listed.error}`;

    const byKey = new Map(
      (listed.authRules ?? []).map(readRule)
        .filter(r => r.remoteIp && r.incomingCld)
        .map(r => [ruleKey(r.remoteIp, r.incomingCld), r] as const),
    );

    const problems: string[] = [];
    for (const want of planned) {
      const got = byKey.get(ruleKey(want.remoteIp, want.incomingCld));
      if (!got) {
        problems.push(`missing: ${want.remoteIp} ${want.incomingCld} (${want.country}/${want.product})`);
        continue;
      }
      if (got.cldRule !== want.cldTranslationRule) {
        problems.push(`${want.incomingCld}: CLD rule is "${got.cldRule || "(empty)"}", expected "${want.cldTranslationRule}"`);
      }
      // A routing group Sippy does not return is reported as unverifiable rather than
      // assumed correct — an absent value is not a match.
      if (got.iRoutingGroup == null) {
        problems.push(`${want.incomingCld}: routing group not returned by Sippy — could not verify`);
      } else if (Number(got.iRoutingGroup) !== Number(want.iRoutingGroup)) {
        problems.push(`${want.incomingCld}: routing group is ${got.iRoutingGroup}, expected ${want.iRoutingGroup} (${want.routingGroupName ?? "unnamed"})`);
      }
    }

    // Cap the reported detail: twenty identical complaints tell an operator no more than
    // three do, and the count is what conveys the scale.
    if (problems.length) {
      const shown = problems.slice(0, 5);
      const rest  = problems.length - shown.length;
      return `${problems.length} of ${planned.length} rule(s) did not verify — ` +
        shown.join("; ") + (rest > 0 ? ` (+${rest} more)` : "");
    }
    return null;
  },
};

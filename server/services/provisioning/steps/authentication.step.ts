/**
 * authentication.step.ts — SIP authentication + IP authorisation.
 *
 * These are ONE stage, not two. In Sippy an auth rule carrying `remote_ip` IS the IP
 * authorisation — there is no separate "authorise this IP" object. Splitting them across
 * two provisioning stages would produce one real stage and one that either duplicates it
 * or does nothing, and a pipeline with a decorative stage is worse than a shorter one.
 *
 * One rule per authorised IP, so a customer with three IPs gets three rules.
 *
 * IDEMPOTENT — lists the account's existing rules and creates only the missing IPs. A
 * retry after a partial failure adds the remainder rather than duplicating what worked.
 *
 * VERIFIED — lists the rules back afterwards and confirms every expected IP is present.
 * addSippyAuthRule() returning success for each call is not proof that the set is right;
 * a partially-applied set is precisely the failure this stage can produce.
 */
import * as sippy from "../../../sippy";
import { db } from "../../../db";
import { clientIpRequests } from "@shared/schema";
import { eq } from "drizzle-orm";
import type { ProvisioningStep, StepContext, StepOutcome } from "../types";

/** SIP. Sippy protocol ids: 1=SIP, 3=IAX2, 4=PIN. */
const PROTOCOL_SIP = 1;

async function authorisedIpsFor(companyId: number): Promise<string[]> {
  const rows = await db.select().from(clientIpRequests).where(eq(clientIpRequests.companyId, companyId));
  return Array.from(new Set(
    rows.map((r: any) => String(r.ipAddress ?? "").trim()).filter(Boolean)
  ));
}

export const authenticationStep: ProvisioningStep = {
  key: "authentication",
  label: "Authentication & IP Authorisation",
  order: 40,
  // Blocking: without an auth rule the customer cannot authenticate, so every later
  // stage would configure an account that can never carry a call.
  blocking: true,

  async validate(ctx: StepContext): Promise<string | null> {
    if (!ctx.results.account?.iAccount) return "No account — the account stage must succeed first.";
    const ips = await authorisedIpsFor(ctx.companyId);
    if (ips.length === 0) return "No IP addresses recorded for this company.";
    return null;
  },

  async execute(ctx: StepContext): Promise<StepOutcome> {
    const iAccount = Number(ctx.results.account?.iAccount);
    const iCustomer = Number(ctx.input.iCustomer ?? 1);
    const wanted = await authorisedIpsFor(ctx.companyId);

    // ── Reuse before create ────────────────────────────────────────────────
    let existingIps = new Set<string>();
    try {
      const existing = await sippy.listSippyAuthRules(
        ctx.sippy.username, ctx.sippy.password, { iAccount, iCustomer });
      existingIps = new Set(
        (existing.authRules ?? []).map((r: any) => String(r.remoteIp ?? r.remote_ip ?? "").trim()).filter(Boolean));
    } catch {
      // A failed listing is not evidence the rules are absent. Fall through: Sippy
      // rejects duplicates itself, and verify() below is the real check.
    }

    const missing = wanted.filter(ip => !existingIps.has(ip));
    const detail: string[] = [];
    if (existingIps.size) detail.push(`${existingIps.size} rule(s) already present`);

    const failures: string[] = [];
    for (const ip of missing) {
      const res = await sippy.addSippyAuthRule(
        ctx.sippy.username, ctx.sippy.password,
        { iAccount, iProtocol: PROTOCOL_SIP, iCustomer, remoteIp: ip },
        ctx.sippy.portalUrl,
      );
      if (res.success) detail.push(`Authorised ${ip}${res.iAuthentication ? ` (i_authentication=${res.iAuthentication})` : ""}`);
      else failures.push(`${ip}: ${res.message}`);
    }

    // A partial application is a failure, not a qualified success. Reporting success with
    // two of three IPs authorised would leave a customer that works intermittently —
    // harder to diagnose than one that plainly does not work.
    if (failures.length > 0) {
      return {
        status: "failed",
        reasonCode: "AUTH_RULE_CREATE_FAILED",
        error: `${failures.length} of ${wanted.length} IP(s) could not be authorised.`,
        detail: [...detail, ...failures],
      };
    }

    return {
      status: "success",
      result: { iAccount, authorisedIps: wanted, created: missing.length, reused: wanted.length - missing.length },
      detail: detail.length ? detail : [`All ${wanted.length} IP(s) already authorised`],
    };
  },

  /** Read the rule set back and confirm every expected IP is present. */
  async verify(ctx: StepContext, result: Record<string, unknown>): Promise<string | null> {
    const iAccount = Number(result.iAccount);
    const expected: string[] = Array.isArray(result.authorisedIps) ? result.authorisedIps as string[] : [];
    if (!expected.length) return "no IPs to verify";

    const rules = await sippy.listSippyAuthRules(
      ctx.sippy.username, ctx.sippy.password,
      { iAccount, iCustomer: Number(ctx.input.iCustomer ?? 1) });

    // An error reading the rules back is NOT a pass — see the runner's verify contract.
    if (rules.error) return `could not read auth rules back: ${rules.error}`;

    const present = new Set(
      (rules.authRules ?? []).map((r: any) => String(r.remoteIp ?? r.remote_ip ?? "").trim()).filter(Boolean));
    const absent = expected.filter(ip => !present.has(ip));

    if (absent.length) {
      return `${absent.length} IP(s) not present after creation: ${absent.join(", ")}`;
    }
    return null;
  },
};

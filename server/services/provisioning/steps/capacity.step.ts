/**
 * capacity.step.ts — apply the customer's capacity limits to the Sippy account.
 *
 * Capacity is a CUSTOMER setting (migration 047): one agreement per customer, seeded from
 * the provisioning profile at company creation and authoritative on the company row
 * thereafter. This stage applies it; it does not decide it.
 *
 * Codec and media relay are deliberately NOT set here. updateAccountSettings() exposes
 * max_sessions, max_calls_per_second, max_credit_time, blocked, credit_limit and
 * i_routing_group — there is no codec or media-relay parameter on this call. Pretending
 * to apply them would produce a stage that reports success for settings it never sent,
 * which is the exact failure class this engine exists to prevent. They are recorded as
 * unapplied until the correct Sippy call is identified.
 */
import * as sippy from "../../../sippy";
import { db } from "../../../db";
import { companies } from "@shared/schema";
import { eq } from "drizzle-orm";
import type { ProvisioningStep, StepContext, StepOutcome } from "../types";

export const capacityStep: ProvisioningStep = {
  key: "capacity",
  label: "Capacity",
  order: 90,
  // Non-blocking: an account with default limits still carries traffic. Halting the run
  // — and leaving traffic disabled — over a capacity ceiling would be a worse outcome
  // than a provisioned customer whose limits need a follow-up.
  blocking: false,

  async validate(ctx: StepContext): Promise<string | null> {
    if (!ctx.results.account?.iAccount) return "No account — the account stage must succeed first.";
    return null;
  },

  async execute(ctx: StepContext): Promise<StepOutcome> {
    const iAccount = Number(ctx.results.account?.iAccount);
    const [company]: any[] = await db.select().from(companies).where(eq(companies.id, ctx.companyId));

    const maxSessions = company?.maxSessions ?? null;
    const maxCps      = company?.maxCps ?? null;

    if (maxSessions == null && maxCps == null) {
      // Skipped, not failed: no capacity recorded means the platform has nothing to apply,
      // and Sippy's own defaults stand. Reporting failure would imply something broke.
      return {
        status: "skipped",
        result: { iAccount },
        detail: ["No capacity recorded on the company — Sippy defaults left in place"],
      };
    }

    const res = await sippy.updateAccountSettings(
      ctx.sippy.username, ctx.sippy.password, ctx.sippy.portalUrl, iAccount,
      {
        ...(maxSessions != null ? { maxSessions: Number(maxSessions) } : {}),
        ...(maxCps      != null ? { maxCallsPerSecond: Number(maxCps) } : {}),
        iCustomer: Number(ctx.input.iCustomer ?? 1),
      },
    );

    if (!res.success) {
      return { status: "failed", reasonCode: "CAPACITY_APPLY_FAILED", error: res.message };
    }

    const notApplied = [company?.codec, company?.mediaRelay].some(Boolean)
      ? ["codec and media relay NOT applied — no parameter on updateAccountSettings; needs the correct Sippy call"]
      : [];

    return {
      status: "success",
      result: { iAccount, maxSessions, maxCps },
      detail: [
        `Applied max_sessions=${maxSessions ?? "unchanged"}, max_calls_per_second=${maxCps ?? "unchanged"}`,
        ...notApplied,
      ],
    };
  },

  /** Read the account back and confirm Sippy holds the limits we sent. */
  async verify(ctx: StepContext, result: Record<string, unknown>): Promise<string | null> {
    const iAccount = Number(result.iAccount);
    const info: any = await sippy.getAccountInfo(
      ctx.sippy.username, ctx.sippy.password, ctx.sippy.portalUrl, iAccount);
    if (!info) return `account ${iAccount} could not be read back`;

    const mismatches: string[] = [];
    const wantSessions = result.maxSessions == null ? null : Number(result.maxSessions);
    const wantCps      = result.maxCps      == null ? null : Number(result.maxCps);

    // Only compare what was actually sent. A field Sippy does not return is reported as
    // unverifiable rather than assumed correct — an absent value is not a match.
    if (wantSessions != null) {
      const got = info.maxSessions ?? info.max_sessions;
      if (got === undefined || got === null) mismatches.push("max_sessions not returned by Sippy — could not verify");
      else if (Number(got) !== wantSessions) mismatches.push(`max_sessions is ${got}, expected ${wantSessions}`);
    }
    if (wantCps != null) {
      const got = info.maxCallsPerSecond ?? info.max_calls_per_second;
      if (got === undefined || got === null) mismatches.push("max_calls_per_second not returned by Sippy — could not verify");
      else if (Number(got) !== wantCps) mismatches.push(`max_calls_per_second is ${got}, expected ${wantCps}`);
    }

    return mismatches.length ? mismatches.join("; ") : null;
  },
};

/**
 * account.step.ts — create the Sippy customer account.
 *
 * This is the first stage that creates a LIVE customer resource, and therefore the first
 * that is admin-gated (frozen principle 2, amended 2026-07-28: tariff and service plan are
 * shared commercial objects; the account is not).
 *
 * Two properties the runner depends on:
 *
 *   IDEMPOTENT — looks the account up before creating one, so a retry from a later failed
 *   stage does not mint a second account. Without this, "retry from stage 5" would create
 *   a duplicate at stage 2 every time.
 *
 *   VERIFIABLE — verify() re-reads the account from Sippy. pushAccountToSippy() returning
 *   success is not proof: this platform has twice been misled by a return value.
 */
import * as sippy from "../../../sippy";
import type { ProvisioningStep, StepContext, StepOutcome } from "../types";

export const accountStep: ProvisioningStep = {
  key: "account",
  label: "Customer Account",
  order: 30,
  // Blocking: everything after this (authentication, routing, IPs, traffic) attaches to
  // the account. Continuing without one would produce a run of cascading failures whose
  // real cause is three stages back.
  blocking: true,

  async validate(ctx: StepContext): Promise<string | null> {
    const iTariff = ctx.results.tariff?.iTariff ?? ctx.results.service_plan?.iTariff;
    if (!iTariff) return "No tariff available — the tariff stage must succeed first.";
    if (!ctx.input.companyName?.trim()) return "Company name is required.";
    return null;
  },

  async execute(ctx: StepContext): Promise<StepOutcome> {
    const name     = ctx.input.companyName.trim();
    const username = String(ctx.input.username ?? "").trim() || name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const iCustomer = Number(ctx.input.iCustomer ?? 1);

    // ── Reuse before create ────────────────────────────────────────────────
    // A retry must not produce a second account. Looked up by username, which is the
    // account's stable identity in Sippy.
    try {
      const existing = await sippy.getAccountInfo(
        ctx.sippy.username, ctx.sippy.password, ctx.sippy.portalUrl, undefined, username, iCustomer);
      if (existing?.iAccount) {
        return {
          status: "success",
          result: { iAccount: existing.iAccount, username, reused: true },
          detail: [`Reused existing account "${username}" (i_account=${existing.iAccount})`],
        };
      }
    } catch {
      // A failed lookup is not evidence the account is absent — fall through and let
      // creation decide. Sippy rejects duplicates itself.
    }

    const iBillingPlan = ctx.results.service_plan?.planId as number | undefined;
    const res = await sippy.pushAccountToSippy(
      {
        name,
        type: "client",
        username,
        voipPassword: String(ctx.input.password ?? "") || undefined,
        iCustomer,
        // Capacity and media come from the Provisioning Profile, resolved upstream. The
        // engine APPLIES decisions; it does not make them.
        maxSessions: ctx.input.maxSessions as number | undefined,
        maxCalls:    ctx.input.maxCps      as number | undefined,
        ...(iBillingPlan ? { iBillingPlan } : {}),
      } as any,
      { username: ctx.sippy.username, password: ctx.sippy.password },
      ctx.sippy.portalUrl,
    );

    if (!res.success || !res.i_account) {
      return {
        status: "failed",
        reasonCode: "ACCOUNT_CREATE_FAILED",
        error: res.message || "Account creation failed.",
        detail: res.detail ? [res.detail] : undefined,
      };
    }

    return {
      status: "success",
      result: { iAccount: res.i_account, username: res.username ?? username, reused: false },
      detail: [`Created account "${username}" (i_account=${res.i_account})${res.method ? ` via ${res.method}` : ""}`],
    };
  },

  /**
   * Read the account back from Sippy and confirm it exists with the expected identity.
   * A missing account here means execute() reported a success that did not happen —
   * exactly the Tariff-33 and Service Plan failure shape.
   */
  async verify(ctx: StepContext, result: Record<string, unknown>): Promise<string | null> {
    const iAccount = Number(result.iAccount);
    if (!Number.isFinite(iAccount) || iAccount <= 0) return "no account id returned";

    const info = await sippy.getAccountInfo(
      ctx.sippy.username, ctx.sippy.password, ctx.sippy.portalUrl, iAccount);

    if (!info) return `account ${iAccount} not found in Sippy after creation`;
    if (info.iAccount !== iAccount) {
      return `read back i_account=${info.iAccount}, expected ${iAccount}`;
    }
    return null;
  },
};

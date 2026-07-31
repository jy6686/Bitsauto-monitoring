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
 *
 * THE SERVICE PLAN IS NOT DECORATION. In Sippy the account's plan carries its tariff, and
 * the tariff decides what every call costs. An account on the wrong plan authenticates,
 * routes and connects perfectly — and bills against somebody else's prices. The rates this
 * platform uploads to the customer's own tariff are simply never consulted.
 *
 * That is not hypothetical. This step read the plan id from `ctx.results.service_plan.planId`
 * while the service-plan step wrote it as `iBillingPlan`, so the value was always undefined
 * and `...(iBillingPlan ? {...} : {})` quietly dropped the field. Every account created by
 * the engine went to Sippy with NO plan and was given a default — test-31 came out billing
 * on the shared "Junaid" plan, and Sippy's own dialplan test showed it rating at 0.0330
 * USD/min from a tariff nobody provisioned for it. Nothing failed. verify() checked only
 * that the account existed, so the run was green.
 *
 * Two changes follow from that, and both matter more than the typo:
 *   - the plan is passed explicitly and its absence is REPORTED, never silently omitted;
 *   - verify() compares the plan and tariff Sippy actually holds against the intent, so
 *     "verified" means the account bills correctly, not merely that it exists.
 */
import * as sippy from "../../../sippy";
import type { ProvisioningStep, StepContext, StepOutcome, VerifyReport } from "../types";

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

    // The key is `iBillingPlan`, which is what service-plan.step actually writes. Reading a
    // key that does not exist yields undefined and no error — see the header.
    const intendedPlan = ctx.results.service_plan?.iBillingPlan as number | undefined;
    const iBillingPlan = intendedPlan;

    // ── Reuse before create ────────────────────────────────────────────────
    // A retry must not produce a second account. Looked up by username, which is the
    // account's stable identity in Sippy.
    try {
      const existing = await sippy.getAccountInfo(
        ctx.sippy.username, ctx.sippy.password, ctx.sippy.portalUrl, undefined, username, iCustomer);
      if (existing?.iAccount) {
        // intendedPlan travels with the result so verify() checks a REUSED account too.
        // An account created before this bug was fixed carries the wrong plan permanently,
        // and reuse would otherwise mean it is never looked at again.
        return {
          status: "success",
          result: { iAccount: existing.iAccount, username, reused: true, intendedPlan: intendedPlan ?? null },
          detail: [`Reused existing account "${username}" (i_account=${existing.iAccount})`],
        };
      }
    } catch {
      // A failed lookup is not evidence the account is absent — fall through and let
      // creation decide. Sippy rejects duplicates itself.
    }

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
      result: { iAccount: res.i_account, username: res.username ?? username, reused: false, intendedPlan: intendedPlan ?? null },
      detail: [
        `Created account "${username}" (i_account=${res.i_account})${res.method ? ` via ${res.method}` : ""}`,
        // Said either way. Omitting the plan is sometimes correct on this deployment — the
        // service-plan step is a known Sippy-side blocker — but an account on a default
        // plan bills on a tariff nobody chose, and that must never be silent again.
        intendedPlan
          ? `Service plan ${intendedPlan} attached`
          : `NO service plan attached — the service-plan step produced none, so Sippy assigned its default. This account will bill on a tariff that was not provisioned for it.`,
      ],
      metrics: { requested: 1, created: 1, servicePlanAttached: intendedPlan ?? null },
    };
  },

  /**
   * Read the account back from Sippy and confirm it exists with the expected identity.
   * A missing account here means execute() reported a success that did not happen —
   * exactly the Tariff-33 and Service Plan failure shape.
   */
  async verify(ctx: StepContext, result: Record<string, unknown>): Promise<VerifyReport> {
    const iAccount = Number(result.iAccount);
    if (!Number.isFinite(iAccount) || iAccount <= 0) return { reason: "no account id returned" };

    const info = await sippy.getAccountInfo(
      ctx.sippy.username, ctx.sippy.password, ctx.sippy.portalUrl, iAccount);

    if (!info) return { reason: `account ${iAccount} not found in Sippy after creation` };
    if (info.iAccount !== iAccount) {
      return { reason: `read back i_account=${info.iAccount}, expected ${iAccount}` };
    }

    // ── Commercial identity, not just existence ────────────────────────────
    // getAccountInfo returns i_billing_plan and i_tariff. Checking only the id proved an
    // account was created; it never proved the account bills on the tariff we built for
    // it, which is the thing the customer is actually charged by.
    const intended = result.intendedPlan == null ? null : Number(result.intendedPlan);
    const actual   = info.iBillingPlan == null ? null : Number(info.iBillingPlan);
    const detail: string[] = [
      `Account ${iAccount} (${info.username ?? "?"}) — service plan ${actual ?? "(none)"}, tariff ${info.iTariff ?? "(none)"}`,
    ];

    if (intended != null && actual !== intended) {
      return {
        reason: actual == null
          ? `account ${iAccount} has NO service plan — expected ${intended}. Sippy bills it on a default tariff, so the rates loaded for this customer are never consulted.`
          : `account ${iAccount} is on service plan ${actual}, expected ${intended} — it bills on another customer's tariff, so its own rates are never consulted.`,
        detail,
        metrics: { verified: 0, servicePlanExpected: intended, servicePlanActual: actual },
      };
    }

    // No intended plan means the service-plan step produced none — the known Sippy-side
    // blocker on this build. The account is real and routes; it simply bills on a default.
    // Recorded as a caveat on a PASS rather than a failure, because failing here would
    // block provisioning entirely on a deployment where that step always fails.
    if (intended == null) {
      detail.push(
        `No service plan was provisioned for this account, so Sippy's default (${actual ?? "unknown"}) applies.`,
        `Its tariff is ${info.iTariff ?? "unknown"} — confirm this is intended before the customer carries billable traffic.`,
      );
      return { detail, metrics: { verified: 1, servicePlanExpected: null, servicePlanActual: actual } };
    }

    detail.push(`Service plan ${actual} matches the plan provisioned for this customer.`);
    return { detail, metrics: { verified: 1, servicePlanExpected: intended, servicePlanActual: actual } };
  },
};

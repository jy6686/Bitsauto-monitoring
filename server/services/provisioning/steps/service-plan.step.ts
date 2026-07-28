/**
 * service-plan.step.ts — creates the Sippy Service Plan and links it to the tariff.
 *
 * ── CURRENTLY BLOCKED BY THE SIPPY DEPLOYMENT ────────────────────────────────
 * Confirmed by live run 2026-07-27 (governance §6). Two independent blockers,
 * both Sippy-side:
 *
 *   1. No XML-RPC method on this build. Every candidate returns UNKNOWN_METHOD,
 *      including the officially documented createServicePlan(), which Sippy
 *      lists as "available since Softswitch 2025". This deployment predates it.
 *   2. Portal INSERT refused — the provisioning account authenticates but Sippy
 *      rejects the Service Plan INSERT (PROVISIONING_PERMISSION_DENIED).
 *
 * This is a TEMPORARY OPERATIONAL LIMITATION, not a design decision. The stated
 * platform goal remains zero operator interaction with Sippy. It clears when
 * either an account gains portal INSERT permission, or Sippy is upgraded to
 * 2025+ — at which point ONLY this file changes.
 *
 * `blocking: false` is therefore load-bearing, not incidental: making this a
 * hard gate ahead of account creation was proposed and rejected, because on this
 * deployment it always fails and would break account provisioning entirely.
 */
import * as sippy from "../../../sippy";
import type { ProvisioningStep, StepContext, StepOutcome } from "../types";

export const servicePlanStep: ProvisioningStep = {
  key:   'service_plan',
  label: 'Create Service Plan',
  order: 20,
  blocking: false, // see header — deliberate, and currently load-bearing

  async validate(ctx: StepContext): Promise<string | null> {
    const iTariff = ctx.results.tariff?.iTariff;
    if (!iTariff) return 'Tariff step must succeed before a Service Plan can be linked.';
    return null;
  },

  async execute(ctx: StepContext): Promise<StepOutcome> {
    const iTariff  = Number(ctx.results.tariff?.iTariff);
    const name     = ctx.input.companyName.trim();
    const planName = (ctx.input.planName ?? name).trim();

    const res = await sippy.createSippyServicePlan(
      ctx.sippy.portalUrl,
      ctx.sippy.adminUser, ctx.sippy.adminPass,
      ctx.sippy.portalUser, ctx.sippy.portalPass,
      planName,
      iTariff,
      `Auto-provisioned for ${name}`,
      ctx.input.billingCycle ?? 3, // 3 = monthly (Sippy XML-RPC docs)
      ctx.sippy.adminWebPassword,
    );

    if (res.success && res.planId) {
      return {
        status: 'success',
        result: { iBillingPlan: res.planId, planName: res.planName ?? planName, reused: !!res.alreadyExists },
        detail: [res.alreadyExists
          ? `Reused existing plan "${res.planName}" (i_billing_plan=${res.planId})`
          : `Created plan "${res.planName ?? planName}" (i_billing_plan=${res.planId})`],
      };
    }

    // Failure. Carry the classification and the XML-RPC attempt breadcrumbs
    // through unchanged — those are what distinguish "method absent on this
    // build" from "method exists but rejected us", and that distinction decides
    // whether this is fixable operationally or needs an upgrade.
    return {
      status: 'failed',
      reasonCode: res.reasonCode ?? 'UNKNOWN_ERROR',
      error: res.error ?? 'Service Plan creation failed.',
      detail: res.xmlrpcAttempts,
    };
  },
};

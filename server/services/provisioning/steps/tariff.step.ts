/**
 * tariff.step.ts — creates (or reuses) the client's Sippy tariff.
 *
 * Reuses sippy.createSippyTariff() rather than reimplementing it. This step is
 * proven to work on the live deployment — tariffs 40, 41 and 42 were all created
 * successfully during the 2026-07-27 investigation while the Service Plan step
 * was failing.
 *
 * NAMING: plain company name, no currency suffix. This is the approved standard
 * (governance §4, DEFECT-CP-001) and matches Company Profile Setup. The frozen
 * Account Wizard still writes "Company (USD)"; that inconsistency is a recorded,
 * deferred defect and is deliberately NOT replicated here — new code follows the
 * approved standard.
 */
import * as sippy from "../../../sippy";
import type { ProvisioningStep, StepContext, StepOutcome } from "../types";

export const tariffStep: ProvisioningStep = {
  key:   'tariff',
  label: 'Create Tariff',
  order: 10,
  blocking: true,

  async validate(ctx: StepContext): Promise<string | null> {
    if (!ctx.input.companyName?.trim()) return 'Company name is required.';
    if (!ctx.input.currency?.trim())    return 'Currency is required.';
    return null;
  },

  async execute(ctx: StepContext): Promise<StepOutcome> {
    const name     = ctx.input.companyName.trim();
    const currency = ctx.input.currency.trim();

    // Reuse before create: a re-run must not multiply tariffs in Sippy.
    //
    // Signature is (username, password, namePattern?: string, offset?, limit?,
    // iCustomer?) — a positional STRING pattern, and no portalUrl argument; it
    // uses the module's activeSession and throws without one. Getting this wrong
    // is easy and silent: see DEFECT-CP-008, where the frozen wizard passes an
    // object as namePattern and a URL as offset, so its reuse check can never
    // match and it creates a fresh tariff on every provision.
    try {
      const existing = await sippy.getTariffsList(ctx.sippy.username, ctx.sippy.password, name);
      const hit = existing.find(t => t.name?.toLowerCase() === name.toLowerCase());
      if (hit?.iTariff) {
        return {
          status: 'success',
          result: { iTariff: hit.iTariff, tariffName: name, reused: true },
          detail: [`Reused existing tariff "${name}" (i_tariff=${hit.iTariff})`],
        };
      }
    } catch {
      // Lookup failure is not fatal — fall through and attempt creation.
    }

    const res = await sippy.createSippyTariff(
      ctx.sippy.username, ctx.sippy.password, { name, currency }, ctx.sippy.portalUrl,
    );

    if (!res.success || !res.iTariff) {
      return {
        status: 'failed',
        reasonCode: 'TARIFF_CREATE_FAILED',
        error: res.message || 'Tariff creation failed.',
      };
    }

    return {
      status: 'success',
      result: { iTariff: res.iTariff, tariffName: name, currency, reused: false },
      detail: [`Created tariff "${name}" (i_tariff=${res.iTariff})`],
    };
  },
};

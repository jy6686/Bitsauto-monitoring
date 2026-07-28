/**
 * index.ts — the provisioning subsystem's public surface and step registry.
 *
 * Adding a new provisioning stage means writing one ProvisioningStep and adding
 * it here. The runner, persistence, retry and status API need no changes.
 *
 * Registered today: tariff, service_plan. The remaining stages from the
 * automated-onboarding spec — account, assign_plan, products, rates, rate_push,
 * routing, credentials, email, await_ip — plug in at the marked orders below.
 * Several already exist as working functions elsewhere (pushAccountToSippy,
 * addSippyAuthRule, addRoutingGroup, the rate-push pipeline) and should be
 * WRAPPED, never reimplemented.
 */
import type { ProvisioningStep } from "./types";
import { tariffStep } from "./steps/tariff.step";
import { servicePlanStep } from "./steps/service-plan.step";
import { accountStep } from "./steps/account.step";

export * from "./types";
export { createRun, executeRun, getRun } from "./runner";

/**
 * Ordered step registry. `order` values are spaced by 10 so stages can be
 * inserted between existing ones without renumbering.
 *
 *   10 tariff        ✅ implemented — proven working on the live deployment
 *   20 service_plan  ✅ implemented — blocked by the Sippy deployment, non-blocking
 *   30 account       ✅ implemented — idempotent + read-back verified
 *   40 assign_plan      → link plan to account
 *   50 products         → customer_product_assignments
 *   60 rates            → generate customer rates
 *   70 rate_push        → create provisioning_jobs rows; reuse the existing worker
 *   80 routing          → wrap addRoutingGroup() + addRoutingGroupMember()
 *   90 credentials      → generate; never persist the password
 *  100 email            → onboarding email via sendViaProfile()
 *  110 await_ip         → traffic stays blocked until IP approval
 */
export const PROVISIONING_STEPS: ProvisioningStep[] = [
  tariffStep,
  servicePlanStep,
  accountStep,
];

/** Look up a single step definition by its stable key. */
export function findStep(key: string): ProvisioningStep | undefined {
  return PROVISIONING_STEPS.find(s => s.key === key);
}

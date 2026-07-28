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
import { authenticationStep } from "./steps/authentication.step";
import { capacityStep } from "./steps/capacity.step";

export * from "./types";
export { createRun, executeRun, getRun } from "./runner";

/**
 * Ordered step registry — the CANONICAL pipeline.
 *
 * This list reflects what Sippy actually has, not an earlier design. Two planned stages
 * turned out not to exist as separate operations, and both were removed rather than built
 * as no-ops:
 *
 *   • "IP authorisation" is not separate from authentication — an auth rule carrying
 *     remote_ip IS the authorisation.
 *   • "Service plan assignment" is not a post-create step — i_billing_plan is REQUIRED at
 *     account creation since Sippy v1.8, so the account stage already assigns it.
 *
 * ── Engine stage → Sippy object ──────────────────────────────────────────────
 * Kept so nobody reintroduces a stage Sippy has no object for:
 *
 *   Tariff          → Tariff
 *   Service Plan    → Billing Plan
 *   Account         → Account (i_billing_plan included at creation)
 *   Authentication  → Auth Rule (remote_ip = the IP authorisation)
 *   Capacity        → Account Settings (max_sessions, max_calls_per_second)
 *   Routing         → Routing Group + members
 *   Rates           → Rate Card applied to the Tariff
 *   Traffic         → Account blocked/enabled state
 *
 * `order` values are spaced so stages can be inserted without renumbering.
 *
 *   10 tariff          ✅ implemented — proven on the live deployment
 *   20 service_plan    ✅ implemented — blocked by this Sippy build, non-blocking
 *   30 account         ✅ implemented — idempotent + read-back verified
 *   40 authentication  ✅ implemented — SIP auth + IP authorisation (one Sippy object)
 *   60 routing            → wrap addRoutingGroup() + addRoutingGroupMember()
 *   70 products           → customer_product_assignments
 *   80 rates              → apply the rate policy's card to the tariff
 *   90 capacity        ✅ implemented — account limits, read-back verified
 *  100 traffic            → enable; the final activation
 *  110 final_verify       → confirm the account is genuinely ready for traffic
 *
 * NOT a stage — codec and media relay have no parameter on updateAccountSettings().
 * Status: UNSUPPORTED (current API). Blocked pending authoritative Sippy information;
 * deliberately not guessed at, the same discipline that stopped the createServicePlan
 * method-name hunt.
 */
export const PROVISIONING_STEPS: ProvisioningStep[] = [
  tariffStep,
  servicePlanStep,
  accountStep,
  authenticationStep,
  capacityStep,
];

/** Look up a single step definition by its stable key. */
export function findStep(key: string): ProvisioningStep | undefined {
  return PROVISIONING_STEPS.find(s => s.key === key);
}

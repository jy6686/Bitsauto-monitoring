/**
 * identity-writeback.ts — record on the customer what provisioning built on the switch.
 *
 * WHY. Observed 2026-09-15 on 1global: runs #31 and #32 both created/reused Sippy account
 * 1069 and verified it, yet `companies.sippy_i_account` was still NULL and
 * `provisioning_status` still 'draft'. The legacy POST /api/companies/:id/provision route
 * writes those back; the job runner the Provision button now uses never did. One missing
 * write produced four separate symptoms:
 *
 *   • Rate Manager refused EVERY push for the customer with `no_stored_tariff` — push-batch
 *     finds the company by `getCompanyBySippyAccount(iAccount)`, which cannot match a NULL.
 *   • The company card's Products panel was empty: it reads assignments by Sippy account.
 *   • The rate sheet's KAM lines fell back, because kam_accounts is keyed by the account id.
 *   • The card showed a provisioned customer as un-provisioned.
 *
 * WHAT IS WRITTEN, AND ONLY THIS. Identifiers a step proved against the switch: the account
 * id and the tariff id. Never a guess, never a value a step did not return, and never a
 * clear — `null` is left alone so a re-run that skips a stage cannot erase what an earlier
 * run established. Writing is idempotent: the same value twice is a no-op.
 *
 * Pure decision here, persistence in the caller, so the mapping is testable without a
 * database or a switch.
 */

/** The company columns provisioning is allowed to set from a step result. */
export interface CompanyIdentityPatch {
  sippyIAccount?: number;
  sippyITariff?: number;
}

export interface IdentityStepResult {
  stepKey: string;
  status: string;
  result?: Record<string, unknown> | null;
}

/** Current values, so an unchanged field is never written. */
export interface CompanyIdentityNow {
  sippyIAccount?: number | null;
  sippyITariff?: number | null;
}

const posInt = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * What to write after a step succeeds. Returns an empty patch when the step proves nothing,
 * when the value is unusable, or when the company already records it.
 */
export function identityPatchFor(step: IdentityStepResult, now: CompanyIdentityNow): CompanyIdentityPatch {
  if (step.status !== 'success' || !step.result) return {};
  const patch: CompanyIdentityPatch = {};

  if (step.stepKey === 'account') {
    const iAccount = posInt(step.result.iAccount);
    if (iAccount !== null && posInt(now.sippyIAccount) !== iAccount) patch.sippyIAccount = iAccount;
  }
  if (step.stepKey === 'tariff') {
    const iTariff = posInt(step.result.iTariff);
    if (iTariff !== null && posInt(now.sippyITariff) !== iTariff) patch.sippyITariff = iTariff;
  }
  return patch;
}

export const hasPatch = (p: CompanyIdentityPatch): boolean => Object.keys(p).length > 0;

/**
 * Whether a finished run should mark the customer provisioned.
 *
 * The account is what makes a customer real on the switch, so a run that produced one has
 * provisioned them even if a later non-blocking stage was skipped —
 * 'completed_with_warnings' is a provisioned customer with follow-up work, and calling it
 * 'draft' is what hid 1global from every surface that filters on provisioned.
 */
export function shouldMarkProvisioned(
  runStatus: string,
  steps: Array<{ key: string; status: string }>,
): boolean {
  if (runStatus !== 'completed' && runStatus !== 'completed_with_warnings') return false;
  return steps.some(s => s.key === 'account' && s.status === 'success');
}

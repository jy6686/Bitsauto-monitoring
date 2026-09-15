/**
 * identity-backfill.ts — repair the customers whose Sippy identity was never recorded.
 *
 * The runner now records the account and tariff ids as each step proves them
 * (identity-writeback.ts). That fixes customers provisioned from here on; it does nothing
 * for the ones already in the broken state. On 2026-09-15 that was 14 companies holding a
 * tariff with no account id — 1global among them — plus 21 holding an account with no
 * tariff. Every one of those refuses every Rate Manager push with `no_stored_tariff`,
 * shows an empty Products panel, and loses the KAM from its rate sheets.
 *
 * THE REPAIR READS EVIDENCE, NEVER NAMES. A provisioning run names its company, and its
 * account step recorded the exact Sippy account it created or reused. That pairing is
 * authoritative and was verified against the switch when it was written. Matching a Sippy
 * account to a customer by NAME would be a guess, and a wrong one here attaches a live
 * account to the wrong customer — 1global's own account is spelled "1gloabl", which is
 * precisely the kind of near-miss a name match gets wrong.
 *
 * So: only a succeeded step of a run that belongs to that company, only ids that step
 * returned, never a value that contradicts what the company already holds, and never a
 * clear. A contradiction is reported for a human, not resolved.
 */

/** One succeeded identity step, already joined to its run's company. */
export interface BackfillEvidence {
  companyId: number;
  stepKey: string;
  status: string;
  /** provisioning_steps.result, parsed. */
  result: Record<string, unknown> | null;
  /** Newest first is not assumed; the caller supplies completedAt so ties resolve here. */
  completedAt?: string | Date | null;
}

export interface CompanyNow {
  id: number;
  name: string;
  sippyIAccount?: number | null;
  sippyITariff?: number | null;
}

export interface BackfillPatch {
  companyId: number;
  companyName: string;
  sippyIAccount?: number;
  sippyITariff?: number;
  /** One line per field, saying what evidence justified it. */
  because: string[];
}

export interface BackfillConflict {
  companyId: number;
  companyName: string;
  field: 'sippyIAccount' | 'sippyITariff';
  recorded: number;
  evidence: number;
  message: string;
}

export interface BackfillPlan {
  patches: BackfillPatch[];
  conflicts: BackfillConflict[];
  /** Companies that are already complete, for the report's denominator. */
  alreadyComplete: number;
  /** Companies still missing something because no run ever proved it. */
  noEvidence: Array<{ companyId: number; companyName: string; missing: string[] }>;
}

const posInt = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};
const time = (v: unknown): number => {
  if (!v) return 0;
  const t = v instanceof Date ? v.getTime() : Date.parse(String(v));
  return Number.isFinite(t) ? t : 0;
};

/** The id a company's latest succeeded step of that kind proved, if any. */
function latestId(evidence: BackfillEvidence[], companyId: number, stepKey: string, field: string): number | null {
  const rows = evidence
    .filter(e => e.companyId === companyId && e.stepKey === stepKey && e.status === 'success' && e.result)
    .sort((a, b) => time(b.completedAt) - time(a.completedAt));
  for (const r of rows) {
    const v = posInt(r.result![field]);
    if (v !== null) return v;
  }
  return null;
}

/**
 * What the repair would write. Pure: no database, no switch, so the report shown to an
 * operator before they approve it is computed by exactly the code that performs it.
 */
export function planIdentityBackfill(companies: CompanyNow[], evidence: BackfillEvidence[]): BackfillPlan {
  const patches: BackfillPatch[] = [];
  const conflicts: BackfillConflict[] = [];
  const noEvidence: BackfillPlan['noEvidence'] = [];
  let alreadyComplete = 0;

  for (const c of companies) {
    const haveAccount = posInt(c.sippyIAccount);
    const haveTariff  = posInt(c.sippyITariff);
    if (haveAccount !== null && haveTariff !== null) { alreadyComplete++; continue; }

    const provenAccount = latestId(evidence, c.id, 'account', 'iAccount');
    const provenTariff  = latestId(evidence, c.id, 'tariff', 'iTariff');

    // A recorded value that the evidence contradicts is never overwritten. Two different
    // live ids for one customer is a question for a person, not a field to pick between.
    if (haveAccount !== null && provenAccount !== null && haveAccount !== provenAccount) {
      conflicts.push({ companyId: c.id, companyName: c.name, field: 'sippyIAccount', recorded: haveAccount, evidence: provenAccount,
        message: `${c.name} records Sippy account ${haveAccount} but its last successful provisioning run created or reused ${provenAccount}. Not changed — one customer cannot own two accounts, so decide which is theirs.` });
    }
    if (haveTariff !== null && provenTariff !== null && haveTariff !== provenTariff) {
      conflicts.push({ companyId: c.id, companyName: c.name, field: 'sippyITariff', recorded: haveTariff, evidence: provenTariff,
        message: `${c.name} records tariff ${haveTariff} but its last successful provisioning run used ${provenTariff}. Not changed — pushing to the wrong tariff prices a customer who does not own it.` });
    }

    const patch: BackfillPatch = { companyId: c.id, companyName: c.name, because: [] };
    if (haveAccount === null && provenAccount !== null) {
      patch.sippyIAccount = provenAccount;
      patch.because.push(`Sippy account ${provenAccount} — created or reused by this company's own provisioning run and verified against the switch at the time`);
    }
    if (haveTariff === null && provenTariff !== null) {
      patch.sippyITariff = provenTariff;
      patch.because.push(`tariff ${provenTariff} — created or reused by this company's own provisioning run`);
    }
    if (patch.because.length) patches.push(patch);

    const missing: string[] = [];
    if (haveAccount === null && provenAccount === null) missing.push('Sippy account (no successful account step on any run)');
    if (haveTariff === null && provenTariff === null) missing.push('tariff (no successful tariff step on any run)');
    if (missing.length) noEvidence.push({ companyId: c.id, companyName: c.name, missing });
  }

  patches.sort((a, b) => a.companyName.localeCompare(b.companyName));
  return { patches, conflicts, alreadyComplete, noEvidence };
}

/** Parse a provisioning_steps.result cell without letting one bad row fail the repair. */
export function parseStepResult(raw: unknown): Record<string, unknown> | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  try { const v = JSON.parse(String(raw)); return v && typeof v === 'object' ? v : null; } catch { return null; }
}

/**
 * identity-inventory.ts — one answer per company: do we know who they are on the switch,
 * and is every product they bought actually configured under that identity?
 *
 * THE CONTRACT THIS REPORTS AGAINST (owner, 2026-09-15):
 *
 *     COMPANY
 *        └── ONE canonical Sippy account id        ← the customer's identity
 *              ├── First Class     → tariff, rates, routing
 *              ├── Business Class  → …
 *              └── any product added later
 *
 * The account id belongs to the COMPANY, not to a product. Adding a product later must
 * never mint a second account id, and must never require another backfill project. So this
 * report is keyed on the company, lists products beneath it, and is written so a product
 * added tomorrow appears without a code change — it reads the product registry, never a
 * hardcoded FC/BC/SB/SC list.
 *
 * WHAT IT WILL NOT DO. It never infers an account id from a name, a tariff, or a
 * resemblance. A company whose identity cannot be established from its own provisioning
 * runs is reported UNRESOLVED and sent for a controlled reconciliation. Guessing is the
 * failure this whole exercise exists to end: 1global's account is spelled "1gloabl".
 */

export type IdentityStatus =
  /** Account id recorded, and nothing contradicts it. The platform knows this customer. */
  | 'VERIFIED'
  /** No account id, but this company's own successful run recorded one. Repairable from evidence. */
  | 'REPAIRABLE'
  /** Recorded id and run evidence disagree. A person decides; nothing is written. */
  | 'CONFLICT'
  /** Something of theirs exists on the switch (a tariff) but no run proves the account. */
  | 'UNRESOLVED'
  /** Nothing recorded and no run. Not a repair — a provisioning run. */
  | 'NOT_PROVISIONED';

export interface InventoryCompany {
  id: number; name: string;
  sippyIAccount: number | null; sippyITariff: number | null;
  provisioningStatus: string | null;
}
export interface InventoryEvidence {
  companyId: number; stepKey: string; status: string;
  result: Record<string, unknown> | null; completedAt?: string | Date | null;
  /** provisioning_steps.metrics. Carries the read-back tariff on runs from 2026-09-16. */
  metrics?: Record<string, unknown> | null;
  /** provisioning_steps.detail. Older runs recorded the read-back only in this prose. */
  detail?: string[] | null;
}

/**
 * Whether the account bills on the tariff the platform stores for it.
 *
 * Separate from identity on purpose. Knowing WHICH account belongs to a customer says
 * nothing about whether that account bills on the tariff we loaded their rates into, and
 * on this deployment the service-plan step produces nothing, so Sippy assigns a default.
 * Rates loaded into a tariff the account does not bill on are never consulted.
 */
export interface BillingLink {
  /** The tariff Sippy said the account bills on, when a run recorded it. */
  switchTariff: number | null;
  /** The service plan Sippy reported. Null means Sippy's default tariff applies. */
  servicePlan: number | null;
  /** Where the number came from. Never inferred from the run's tariff step. */
  source: 'verify metrics' | 'recorded read-back line' | null;
  verdict: 'MATCHES' | 'DIFFERS' | 'NO_EVIDENCE';
  note: string;
}
export interface InventoryProduct { id: number; code: string; name: string; trunkPrefix: string | null }
/** What the customer bought — company_products, written by the onboarding wizard. */
export interface InventoryBought { companyId: number; productId: number }
/** What is recorded against the Sippy account — customer_product_assignments. */
export interface InventoryAssigned { iAccount: number; productId: number }

export interface CompanyInventory {
  companyId: number;
  companyName: string;
  identity: {
    status: IdentityStatus;
    storedAccount: number | null;
    storedTariff: number | null;
    evidenceAccount: number | null;
    evidenceTariff: number | null;
    provisioningStatus: string | null;
    note: string;
  };
  billing: BillingLink;
  products: {
    /** Product codes the customer bought. */
    bought: string[];
    /** Product codes recorded against their Sippy account. Null when the account is unknown. */
    assigned: string[] | null;
    /** Bought but not recorded against the account. */
    missing: string[];
    /** Recorded against the account but not bought. */
    unexpected: string[];
    /**
     * One state per registry product, so the answer is never read off an omission.
     * UNKNOWN is the whole point: with no account id the platform cannot see the
     * assignments, and not seeing them is not evidence they are absent on Sippy.
     */
    state: Array<{ code: string; state: ProductState }>;
  };
  nextAction: string;
}

export type ProductState =
  /** Bought, and configured under this company's account. */
  | 'CONFIGURED'
  /** Bought, account known, and NOT configured under it. A real gap. */
  | 'MISSING'
  /** The account is unresolved, so the platform cannot see any assignment at all. */
  | 'UNKNOWN'
  /** Configured under the account but never bought. */
  | 'UNEXPECTED'
  /** Not bought and not configured. Nothing owed. */
  | 'NOT_SOLD';

/**
 * One row per product in the registry — including a product added tomorrow, which appears
 * here with zeroes instead of being invisible. `priced` is platform-wide because
 * `product_rates` holds no company id: it is the default matrix every customer is sold from.
 */
export interface ProductRollup {
  code: string;
  name: string;
  /** Companies that bought it. */
  bought: number;
  /** Companies whose Sippy account has it configured. */
  assigned: number;
  /** Bought but not configured — the work queue for this product. */
  missing: number;
  /** Does the platform hold effective prices for it? Without these nothing is sendable. */
  priced: boolean;
}

export interface InventoryReport {
  generatedFor: number;
  byStatus: Record<IdentityStatus, number>;
  /** How many accounts are proven to bill on the tariff the platform stores for them. */
  billingLinks: { matches: number; differs: number; noEvidence: number };
  /** Companies whose products do not line up, regardless of identity status. */
  productGaps: number;
  products: ProductRollup[];
  companies: CompanyInventory[];
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

function provenId(evidence: InventoryEvidence[], companyId: number, stepKey: string, field: string): number | null {
  const rows = evidence
    .filter(e => e.companyId === companyId && e.stepKey === stepKey && e.status === 'success' && e.result)
    .sort((a, b) => time(b.completedAt) - time(a.completedAt));
  for (const r of rows) { const v = posInt(r.result![field]); if (v !== null) return v; }
  return null;
}

/**
 * What the account step's read-back actually said. Structured metrics first; for runs that
 * predate those, the line it printed — "Account 1069 (1gloabl) — service plan (none),
 * tariff 68" — which is a record of a real Sippy read, not an inference.
 *
 * It is never filled from the tariff step. That step proves which tariff was BUILT, which
 * is a different claim from which tariff the account BILLS ON, and conflating the two is
 * how a customer ends up charged by a tariff nobody provisioned for them.
 */
function readBillingLink(
  evidence: InventoryEvidence[], companyId: number, storedTariff: number | null,
): BillingLink {
  const rows = evidence
    .filter(e => e.companyId === companyId && e.stepKey === 'account' && e.status === 'success')
    .sort((a, b) => time(b.completedAt) - time(a.completedAt));

  let switchTariff: number | null = null;
  let servicePlan: number | null = null;
  let source: BillingLink['source'] = null;

  for (const r of rows) {
    const m = r.metrics ?? null;
    if (m && posInt(m.accountTariff) !== null) {
      switchTariff = posInt(m.accountTariff);
      servicePlan = posInt(m.accountBillingPlan);
      source = 'verify metrics';
      break;
    }
    // "Account <id> (<user>) — service plan <n|(none)>, tariff <n|(none)>"
    for (const line of r.detail ?? []) {
      const hit = /^Account\s+\d+\b.*?service plan\s+(\(none\)|\d+).*?tariff\s+(\(none\)|\d+)/i.exec(String(line));
      if (!hit) continue;
      const t = posInt(hit[2]);
      if (t === null) continue;
      switchTariff = t;
      servicePlan = posInt(hit[1]);
      source = 'recorded read-back line';
      break;
    }
    if (switchTariff !== null) break;
  }

  const noPlan = switchTariff !== null && servicePlan === null
    ? ' The account carries NO service plan, so this is Sippy\'s default rather than one provisioned for this customer.'
    : '';

  if (switchTariff === null) {
    return { switchTariff: null, servicePlan: null, source: null, verdict: 'NO_EVIDENCE',
      note: 'No run recorded which tariff Sippy bills this account on. That a tariff was built for this company is not evidence the account bills on it.' };
  }
  if (storedTariff === null) {
    return { switchTariff, servicePlan, source, verdict: 'NO_EVIDENCE',
      note: `Sippy reported this account billing on tariff ${switchTariff}, but the platform stores no tariff to compare it against.${noPlan}` };
  }
  if (switchTariff === storedTariff) {
    return { switchTariff, servicePlan, source, verdict: 'MATCHES',
      note: `Sippy reported this account billing on tariff ${switchTariff}, which is the tariff the platform stores.${noPlan}` };
  }
  return { switchTariff, servicePlan, source, verdict: 'DIFFERS',
    note: `Sippy reported this account billing on tariff ${switchTariff}, but the platform stores ${storedTariff}. Rates loaded into ${storedTariff} are never consulted for this customer's calls.${noPlan}` };
}

export function buildIdentityInventory(input: {
  companies: InventoryCompany[];
  evidence: InventoryEvidence[];
  products: InventoryProduct[];
  bought: InventoryBought[];
  assigned: InventoryAssigned[];
  /** Product codes the platform holds effective prices for today. */
  pricedProductCodes?: string[];
}): InventoryReport {
  const codeOf = new Map(input.products.map(p => [p.id, p.code]));
  const boughtBy = new Map<number, Set<number>>();
  for (const b of input.bought) {
    if (!boughtBy.has(b.companyId)) boughtBy.set(b.companyId, new Set());
    boughtBy.get(b.companyId)!.add(b.productId);
  }
  const assignedBy = new Map<number, Set<number>>();
  for (const a of input.assigned) {
    if (!assignedBy.has(a.iAccount)) assignedBy.set(a.iAccount, new Set());
    assignedBy.get(a.iAccount)!.add(a.productId);
  }
  const codes = (ids: Iterable<number>) => Array.from(ids, i => codeOf.get(i)).filter((c): c is string => !!c).sort();

  const byStatus: Record<IdentityStatus, number> =
    { VERIFIED: 0, REPAIRABLE: 0, CONFLICT: 0, UNRESOLVED: 0, NOT_PROVISIONED: 0 };
  let productGaps = 0;
  const companies: CompanyInventory[] = [];

  for (const c of input.companies) {
    const stored = posInt(c.sippyIAccount);
    const storedTariff = posInt(c.sippyITariff);
    const evAccount = provenId(input.evidence, c.id, 'account', 'iAccount');
    const evTariff  = provenId(input.evidence, c.id, 'tariff', 'iTariff');

    let status: IdentityStatus;
    let note: string;
    if (stored !== null && evAccount !== null && stored !== evAccount) {
      status = 'CONFLICT';
      note = `Records account ${stored}; this company's own run created or reused ${evAccount}. One customer cannot own two accounts — decide which is theirs before anything is written.`;
    } else if (stored !== null) {
      status = 'VERIFIED';
      note = evAccount !== null
        ? `Account ${stored}, confirmed by this company's own provisioning run.`
        : `Account ${stored} recorded. No provisioning run to corroborate it, but nothing contradicts it.`;
    } else if (evAccount !== null) {
      status = 'REPAIRABLE';
      note = `No account recorded, but this company's own successful run created or reused account ${evAccount}. Repairable from that evidence.`;
    } else if (storedTariff !== null) {
      status = 'UNRESOLVED';
      note = `Tariff ${storedTariff} is recorded, so something of theirs exists on the switch, but no run proves which account is theirs. Reconcile against Sippy — never infer the account from the tariff or the name.`;
    } else {
      status = 'NOT_PROVISIONED';
      note = 'No account, no tariff, no successful run. This needs provisioning, not a repair.';
    }
    byStatus[status]++;

    const billing = readBillingLink(input.evidence, c.id, storedTariff);

    const boughtCodes = codes(boughtBy.get(c.id) ?? []);
    const assignedCodes = stored !== null ? codes(assignedBy.get(stored) ?? []) : null;
    const missing = assignedCodes === null ? [] : boughtCodes.filter(x => !assignedCodes.includes(x));
    const unexpected = assignedCodes === null ? [] : assignedCodes.filter(x => !boughtCodes.includes(x));
    if (missing.length || unexpected.length) productGaps++;

    const state = input.products.map(p => ({
      code: p.code,
      state: (assignedCodes === null ? 'UNKNOWN'
        : assignedCodes.includes(p.code) ? (boughtCodes.includes(p.code) ? 'CONFIGURED' : 'UNEXPECTED')
        : boughtCodes.includes(p.code) ? 'MISSING'
        : 'NOT_SOLD') as ProductState,
    }));

    let nextAction: string;
    if (status === 'CONFLICT')            nextAction = 'Decide which Sippy account belongs to this customer. Nothing may be written until then.';
    else if (status === 'REPAIRABLE')     nextAction = 'Run the identity repair — it writes only the account id its own run proved.';
    else if (status === 'UNRESOLVED')     nextAction = 'Controlled reconciliation against Sippy to establish the account, then a provisioning run.';
    else if (status === 'NOT_PROVISIONED') nextAction = 'Provision this customer. The runner now records the identity as it goes.';
    // Ranked above a product gap: a customer billing on the wrong tariff is charged wrongly
    // today, whereas a missing product assignment only withholds something they bought.
    else if (billing.verdict === 'DIFFERS') nextAction = `Identity is known, but the account bills on tariff ${billing.switchTariff} while the platform stores ${storedTariff}. Settle which tariff is theirs before pushing any rate.`;
    else if (missing.length)              nextAction = `Identity is known. Products bought but not configured under it: ${missing.join(', ')}.`;
    else if (unexpected.length)           nextAction = `Identity is known. Configured under the account but not bought: ${unexpected.join(', ')}.`;
    else if (billing.verdict === 'NO_EVIDENCE') nextAction = 'Identity known and products line up. No run recorded which tariff the account bills on, so that link is unverified.';
    else                                  nextAction = 'None. Identity known, billing tariff confirmed, products line up.';

    companies.push({
      companyId: c.id, companyName: c.name,
      identity: { status, storedAccount: stored, storedTariff, evidenceAccount: evAccount, evidenceTariff: evTariff, provisioningStatus: c.provisioningStatus, note },
      billing,
      products: { bought: boughtCodes, assigned: assignedCodes, missing, unexpected, state },
      nextAction,
    });
  }

  const rank: Record<IdentityStatus, number> = { CONFLICT: 0, REPAIRABLE: 1, UNRESOLVED: 2, NOT_PROVISIONED: 3, VERIFIED: 4 };
  companies.sort((a, b) => rank[a.identity.status] - rank[b.identity.status] || a.companyName.localeCompare(b.companyName));

  // Driven by the registry, so a product added tomorrow reports itself without a code change.
  const priced = new Set(input.pricedProductCodes ?? []);
  const products: ProductRollup[] = input.products.map(p => ({
    code: p.code,
    name: p.name,
    bought:   companies.filter(c => c.products.bought.includes(p.code)).length,
    assigned: companies.filter(c => (c.products.assigned ?? []).includes(p.code)).length,
    missing:  companies.filter(c => c.products.missing.includes(p.code)).length,
    priced:   priced.has(p.code),
  }));

  const billingLinks = {
    matches:    companies.filter(c => c.billing.verdict === 'MATCHES').length,
    differs:    companies.filter(c => c.billing.verdict === 'DIFFERS').length,
    noEvidence: companies.filter(c => c.billing.verdict === 'NO_EVIDENCE').length,
  };

  return { generatedFor: input.companies.length, byStatus, billingLinks, productGaps, products, companies };
}

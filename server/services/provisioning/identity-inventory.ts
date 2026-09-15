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
  products: {
    /** Product codes the customer bought. */
    bought: string[];
    /** Product codes recorded against their Sippy account. Null when the account is unknown. */
    assigned: string[] | null;
    /** Bought but not recorded against the account. */
    missing: string[];
    /** Recorded against the account but not bought. */
    unexpected: string[];
  };
  nextAction: string;
}

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

    const boughtCodes = codes(boughtBy.get(c.id) ?? []);
    const assignedCodes = stored !== null ? codes(assignedBy.get(stored) ?? []) : null;
    const missing = assignedCodes === null ? [] : boughtCodes.filter(x => !assignedCodes.includes(x));
    const unexpected = assignedCodes === null ? [] : assignedCodes.filter(x => !boughtCodes.includes(x));
    if (missing.length || unexpected.length) productGaps++;

    let nextAction: string;
    if (status === 'CONFLICT')            nextAction = 'Decide which Sippy account belongs to this customer. Nothing may be written until then.';
    else if (status === 'REPAIRABLE')     nextAction = 'Run the identity repair — it writes only the account id its own run proved.';
    else if (status === 'UNRESOLVED')     nextAction = 'Controlled reconciliation against Sippy to establish the account, then a provisioning run.';
    else if (status === 'NOT_PROVISIONED') nextAction = 'Provision this customer. The runner now records the identity as it goes.';
    else if (missing.length)              nextAction = `Identity is known. Products bought but not configured under it: ${missing.join(', ')}.`;
    else if (unexpected.length)           nextAction = `Identity is known. Configured under the account but not bought: ${unexpected.join(', ')}.`;
    else                                  nextAction = 'None. Identity known and products line up.';

    companies.push({
      companyId: c.id, companyName: c.name,
      identity: { status, storedAccount: stored, storedTariff, evidenceAccount: evAccount, evidenceTariff: evTariff, provisioningStatus: c.provisioningStatus, note },
      products: { bought: boughtCodes, assigned: assignedCodes, missing, unexpected },
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

  return { generatedFor: input.companies.length, byStatus, productGaps, products, companies };
}

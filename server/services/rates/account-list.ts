/**
 * The Send Rate client list — Option C (owner, 2026-09-19).
 *
 * Every managed platform company with a Sippy account is listed for every product, and each row
 * says whether the selected product is assigned to it. `assigned` derives STRICTLY from an active
 * customer_product_assignments row for that product and that account — never inferred from a
 * tariff, from rates present on Sippy, or from any other product.
 *
 * Why the flag rather than a filter: the old filter was the ONLY product-assignment check in the
 * push path (push-batch verifies tariff identity, not assignment), and its data is known to be
 * incomplete — accounts configured on Sippy for a product without an assignment row were simply
 * invisible. Listing everyone and marking assignment keeps the boundary visible to the operator
 * without letting missing bookkeeping hide a customer. The push-time tariff-integrity guard is
 * untouched by this.
 *
 * Pure: no DB, no Sippy. The route supplies the two row sets.
 */

export interface ManagedCompany {
  id: number;
  name: string;
  sippyIAccount: number | null;
  /** companies.status — the customer's lifecycle: active | inactive | dormant. */
  status: string | null;
}

export interface ProductAssignment {
  productId: number;
  iAccount: number;
  customerName: string | null;
  status: string;
}

export interface ListedAccount {
  iAccount: number;
  username: string;
  lifecycle: string | null;
  /** True only when an ACTIVE customer_product_assignments row exists for this product + account. */
  assigned: boolean;
}

export function buildAccountList(
  companies: ManagedCompany[],
  assignments: ProductAssignment[],
  productId: number,
): ListedAccount[] {
  const activeForProduct = new Map<number, ProductAssignment>();
  for (const a of assignments) {
    if (a.productId === productId && String(a.status).toLowerCase() === 'active') {
      activeForProduct.set(Number(a.iAccount), a);
    }
  }

  const out: ListedAccount[] = [];
  for (const c of companies) {
    const iAccount = Number(c.sippyIAccount);
    if (!Number.isFinite(iAccount) || iAccount <= 0) continue; // not managed on Sippy → cannot be pushed to
    const assignment = activeForProduct.get(iAccount);
    out.push({
      iAccount,
      username: assignment?.customerName?.trim() || c.name,
      lifecycle: c.status ? String(c.status).toLowerCase() : null,
      assigned: assignment !== undefined,
    });
  }
  return out;
}

/**
 * Identity of a rate change, derived from the one thing the route actually receives.
 *
 * Rate Analysis sends FULL Sippy prefixes ("19230"), never the bare dial prefix — the modal is
 * explicit about it. So `dial_prefix` cannot be copied from the request body, and until it is
 * derived, an operation row written by that route carries no product and no bare prefix.
 *
 * The first characters of a full prefix ARE the product's trunk, so one split yields all three
 * facts at once:
 *
 *     "19230"  ──split──▶  trunk "1"  ──product_registry──▶  First Class
 *                          dial  "9230"
 *
 * WHAT THIS DELIBERATELY WILL NOT DO — derive anything it cannot establish. A prefix whose trunk
 * matches no product, or matches a trunk that two products share, yields all-null rather than a
 * guess. That is not caution for its own sake: `dial_prefix` is the field
 * `deriveNotificationsFromPush` uses to decide whether an operation can be announced to a
 * customer, so a wrong split here is a wrong price in someone's inbox. A null is a refusal to
 * claim, and the notification path already treats a refusal as "not announceable".
 */

/** One product's claim on a trunk, as product_registry holds it. */
export interface TrunkProduct {
  /** product_registry.trunk_prefix — the leading digits that mark the product on the switch. */
  trunkPrefix: string | null | undefined;
  /** product_registry.code, or name when code is absent. Recorded as the operation's product. */
  productName: string | null | undefined;
}

/**
 * All three facts, or none of them. Never a partial claim: a trunk without the product it
 * belongs to would say the split succeeded when nothing identified it.
 */
export interface DerivedOperationIdentity {
  trunkPrefix: string | null;
  dialPrefix:  string | null;
  productName: string | null;
}

const NOTHING: DerivedOperationIdentity = { trunkPrefix: null, dialPrefix: null, productName: null };

/**
 * Split a full Sippy prefix into trunk + dial and name the product that owns the trunk.
 *
 * Longest trunk wins, so a two-digit trunk is not shadowed by a one-digit one that happens to
 * share its first character. A trunk claimed by more than one product is ambiguous and yields
 * nothing — two products cannot both be the answer, and picking either would attach this rate
 * change to a customer product it may not belong to.
 */
export function deriveOperationIdentity(
  fullPrefix: string | null | undefined,
  products: TrunkProduct[],
): DerivedOperationIdentity {
  const full = String(fullPrefix ?? '').trim();
  if (!full) return NOTHING;

  // Only real trunks take part. A product with no trunk prefix cannot claim anything, which is
  // the same rule push-batch enforces when it refuses to push without a usable trunk.
  const candidates = products
    .map(p => ({ trunk: String(p.trunkPrefix ?? '').trim(), name: String(p.productName ?? '').trim() }))
    .filter(p => p.trunk.length > 0 && p.name.length > 0);

  // A trunk that consumes the whole prefix leaves no dial prefix, so it did not identify a
  // destination — that is not a split, it is the trunk on its own.
  const matching = candidates.filter(p => full.startsWith(p.trunk) && full.length > p.trunk.length);
  if (matching.length === 0) return NOTHING;

  const longest = Math.max(...matching.map(p => p.trunk.length));
  const winners = matching.filter(p => p.trunk.length === longest);

  // Two products sharing one trunk: ambiguous by construction, so nothing is claimed.
  const distinctNames = new Set(winners.map(w => w.name));
  if (distinctNames.size !== 1) return NOTHING;

  const trunk = winners[0].trunk;
  return {
    trunkPrefix: trunk,
    dialPrefix:  full.slice(trunk.length),
    productName: winners[0].name,
  };
}

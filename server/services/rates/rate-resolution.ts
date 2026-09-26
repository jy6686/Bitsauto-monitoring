/**
 * rate-resolution.ts — given the rows a rate lookup returned, decide whether EXACTLY ONE rate
 * applies, and refuse in both directions when it does not.
 *
 * THE ACCEPTANCE CONDITION THIS IMPLEMENTS.
 *
 *     (product, destination|prefix, effective time)  →  deterministic rate
 *                                                    →  exactly one applicable rate
 *
 *     0 matching rates   → explicit error
 *     1 matching rate    → proceed
 *     >1 matching rates  → explicit ambiguity error
 *
 * WHAT IS ALREADY DONE ELSEWHERE, AND IS NOT REBUILT HERE. Every reader of `product_rates`
 * (routes-rate-manager, rate-upload.service, provisioning preflight, auth-rule-set-breakout,
 * rates.step) already filters `effective_from <= asOf AND (effective_to IS NULL OR
 * effective_to >= asOf)`. Effective dating is not the gap. The gap is that after that filter,
 * NOTHING checks how many rows came back — so two overlapping windows for one destination both
 * match and whichever row the query happens to return first becomes the price. `product_rates`
 * carries no unique or exclusion constraint, so that state is storable today.
 *
 * WHY SILENT FIRST-ROW SELECTION IS THE WORST AVAILABLE BEHAVIOUR. It is not a crash and not a
 * warning: it is a confident wrong price, applied to a customer, with every status reading
 * success. A refusal costs one blocked push. A silent pick costs an invoice that has to be
 * withdrawn after the customer has seen it.
 *
 * THE GROUPING KEY INCLUDES catalogueVersionId, AND THAT IS NOT OPTIONAL. `destination_id` is
 * meaningless on its own — rates.step reads it as a global_destinations id, Rate Manager writes it
 * as a commercial_destinations id, and migration 515 made the space explicit precisely so two
 * readers could not disagree in silence. Two rows sharing a destination_id in DIFFERENT catalogue
 * versions are different destinations: grouping them together would invent an ambiguity, and
 * grouping across the id spaces would match the price to the wrong place.
 *
 * PURE ON PURPOSE. Rows in, verdict out. No database, no clock, no network — the caller does the
 * query and supplies `asOf`. Same reasoning as batch-plan.ts and pair-barrier.ts beside it.
 */

/** The subset of a product_rates row this decision needs. */
export interface RateCandidate {
  readonly id: number;
  readonly productId: number;
  readonly destinationId: number | null;
  /** Declares which id space `destinationId` belongs to. NULL = `prefix` carries the price. */
  readonly catalogueVersionId: number | null;
  readonly prefix: string | null;
  readonly rate: string;
  readonly currency: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
}

export type RateResolution<T extends RateCandidate = RateCandidate> =
  | { readonly ok: true; readonly rate: T }
  | { readonly ok: false; readonly reason: 'NO_RATE'; readonly key: string }
  | {
      readonly ok: false;
      readonly reason: 'AMBIGUOUS_RATE';
      readonly key: string;
      /** Every row that matched, so an operator can see what to withdraw. */
      readonly candidates: readonly T[];
    };

/**
 * The identity of a priced thing. Two rows with the same key are competing prices for the same
 * thing; two rows with different keys are unrelated and never ambiguous with each other.
 */
export function rateKey(c: RateCandidate): string {
  const target =
    c.catalogueVersionId !== null && c.destinationId !== null
      ? `dest:v${c.catalogueVersionId}:${c.destinationId}`
      : c.prefix !== null
        ? `prefix:${c.prefix}`
        : // Neither a versioned destination nor a prefix: the row prices nothing identifiable.
          `unresolved:${c.id}`;
  return `product:${c.productId}|${target}`;
}

/** True when this row's effective window covers `asOf` (inclusive both ends). */
export function coversAsOf(c: RateCandidate, asOf: string): boolean {
  if (c.effectiveFrom > asOf) return false;
  if (c.effectiveTo !== null && c.effectiveTo < asOf) return false;
  return true;
}

/**
 * Resolve one rate for one key. `candidates` may contain rows for other keys and rows outside the
 * window — both are filtered here so a caller cannot get the guard wrong by passing too much.
 */
export function resolveRate<T extends RateCandidate>(
  candidates: readonly T[],
  key: string,
  asOf: string,
): RateResolution<T> {
  const matching = candidates.filter(c => rateKey(c) === key && coversAsOf(c, asOf));
  if (matching.length === 0) return { ok: false, reason: 'NO_RATE', key };
  if (matching.length > 1) return { ok: false, reason: 'AMBIGUOUS_RATE', key, candidates: matching };
  return { ok: true, rate: matching[0] };
}

/**
 * Resolve every key present in `candidates`. Returns one verdict per key — never a partial
 * success, because a caller that pushes the rates that resolved and quietly drops the ambiguous
 * ones has applied half a rate card, which is the state batch-plan already refuses to create.
 */
export function resolveAllRates<T extends RateCandidate>(
  candidates: readonly T[],
  asOf: string,
): Map<string, RateResolution<T>> {
  const out = new Map<string, RateResolution<T>>();
  for (const c of candidates) {
    const key = rateKey(c);
    if (!out.has(key)) out.set(key, resolveRate(candidates, key, asOf));
  }
  return out;
}

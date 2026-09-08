/**
 * product-trunk.ts
 *
 * The trunk digit is which product a rate belongs to. Production Sippy stores FULL prefixes —
 * tariff 66 holds 19231 (FC), 2880 (BC), 691 (SB) and 79230 (SC) side by side — so a rate
 * pushed without its trunk is not "slightly wrong", it is a rate belonging to no product,
 * indistinguishable from every other product's rate on the same destination.
 *
 * This is the single place that decides whether a registry value is usable as a trunk. It
 * exists because the alternative — `(trunkPrefix ?? '') + prefix` — turns a missing value into
 * a bare prefix silently, which is how a live tariff acquires rates nobody can attribute.
 */

/**
 * Returns the trunk digits, or null when the value cannot serve as a trunk.
 *
 * Null is not a reason to fall back to "no trunk". It is a reason to refuse the push: the
 * caller has asked to price a product whose identity the registry cannot supply.
 */
export function validateTrunkPrefix(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return null;
  return trimmed;
}

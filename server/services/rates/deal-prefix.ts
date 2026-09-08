/**
 * deal-prefix.ts
 *
 * Deal approval pushes one rate per deal destination to the customer's Sippy tariff. The
 * prefix for each comes from a catalogue lookup — and until this guard existed, a lookup
 * that missed fell back to the destination NAME, so "PAKISTAN - MOBILE ZONG" could be
 * written into a live tariff as though it were a dial code.
 *
 * This is the only thing allowed to decide whether a looked-up value is a prefix. A
 * destination whose lookup does not produce one is reported and NOT pushed. The name is
 * never a candidate.
 */

/**
 * Returns the dial prefix Sippy should receive, or null when the value is not a prefix.
 *
 * Accepts digits only. One leading "+" is stripped because the destination tree stores
 * some prefixes that way (prefix-resolver.ts already normalises it with ltrim). Anything
 * else — blank, a name, a formatted number with spaces or dashes, a decimal — is null,
 * because pushing it would create a rate on a string no call will ever match.
 */
export function resolveDealDialPrefix(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = String(raw).trim().replace(/^\+/, '');
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return null;
  return trimmed;
}

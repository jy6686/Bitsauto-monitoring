/**
 * invoice-format.ts
 *
 * Formatting rules for customer-facing invoice documents. Dependency-free, so
 * the rules are pinned by tests and are shared by every renderer rather than
 * re-decided per surface (the PDF, the email, and later the portal).
 *
 * Both rules exist because the renderer broke them in production:
 *   - an unconfigured decimal-places column rounded every amount to whole
 *     currency units, because Number(null) is 0 rather than NaN;
 *   - raw dialled numbers reached a customer invoice's Destination column,
 *     because one generator stores the dialled string where a destination
 *     name belongs.
 */

/** Configured decimal places, or null when unset. Absence never means zero. */
export function resolveDecimalPlaces(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 6 ? n : null;
}

/**
 * Is this a name a customer should read, rather than an internal identifier?
 * Dial strings, tariff prefixes, product codes and routing ids all fail.
 * A name that merely CONTAINS digits still passes — "O2 Germany" is a real
 * operator; only values that are nothing but a number are barred.
 */
export function isCustomerFacingName(s: unknown): boolean {
  const v = String(s ?? '').trim();
  return v.length > 0 && /[A-Za-z]{2}/.test(v) && !/^\+?[\d\s()\-.]+$/.test(v);
}

/** Money and minutes as a customer reads them: grouped, fixed precision. */
export function groupedNumber(value: number, decimals: number): string {
  return Number(value ?? 0).toLocaleString('en-US', {
    minimumFractionDigits: decimals, maximumFractionDigits: decimals,
  });
}

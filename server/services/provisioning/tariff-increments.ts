/**
 * tariff-increments.ts — the billing increment a customer sheet may print, taken from
 * what the switch actually holds.
 *
 * Decided 2026-09-15 after run #32 on 1global: the sheet said AWCC 60/1 (the supplier's
 * value in the catalogue) while tariff 68 billed every row 1/1 (the upload hard-codes it).
 * A customer document must not promise an increment the switch does not enforce, and the
 * supplier's value is not a commercial commitment. So the sheet's column is derived from
 * the tariff read-back:
 *
 *     commercial increment → Sippy apply → Sippy read-back → customer sheet
 *
 * Pure. The read itself happens in the caller; this only matches rows to prefixes.
 */

/** The subset of a Sippy tariff row this needs. */
export interface TariffRateRow {
  /** Execution prefix as held by the switch, e.g. "19370" = product digit 1 + 9370. */
  prefix: string;
  interval1: number | null | undefined;
  intervalN: number | null | undefined;
  /** ISO timestamps; a row not yet active or already expired does not govern billing. */
  activationDate?: string | null;
  expirationDate?: string | null;
  forbidden?: boolean | null;
}

export interface TariffIncrementLookup {
  /** bare prefix → "60/1" for every prefix the tariff holds an active row for. */
  increments: Map<string, string>;
  /** Bare prefixes with no active row on the tariff — the switch enforces nothing for them yet. */
  missing: string[];
}

function activeAt(row: TariffRateRow, now: Date): boolean {
  if (row.forbidden) return false;
  const act = row.activationDate ? Date.parse(row.activationDate) : NaN;
  const exp = row.expirationDate ? Date.parse(row.expirationDate) : NaN;
  if (Number.isFinite(act) && act > now.getTime()) return false;
  if (Number.isFinite(exp) && exp <= now.getTime()) return false;
  return true;
}

/**
 * Match the tariff's rows to one product's bare prefixes. The switch stores
 * `${productDigit}${prefix}`; the customer sees `${prefix}`. When several rows share a
 * prefix (a future-dated change beside the live row), the active one governs; among
 * several active rows the latest activation wins, which is what the switch itself does.
 */
export function incrementsFromTariff(
  rows: TariffRateRow[],
  productDigit: string,
  prefixes: string[],
  now: Date = new Date(),
): TariffIncrementLookup {
  const digit = productDigit.trim();
  const byPrefix = new Map<string, TariffRateRow>();
  for (const r of rows) {
    const p = String(r.prefix ?? '').trim();
    if (!p.startsWith(digit) || !activeAt(r, now)) continue;
    const bare = p.slice(digit.length);
    const prior = byPrefix.get(bare);
    if (!prior) { byPrefix.set(bare, r); continue; }
    const a = Date.parse(r.activationDate ?? '') || 0;
    const b = Date.parse(prior.activationDate ?? '') || 0;
    if (a >= b) byPrefix.set(bare, r);
  }

  const increments = new Map<string, string>();
  const missing: string[] = [];
  for (const prefix of prefixes) {
    const r = byPrefix.get(String(prefix).trim());
    const i1 = Number(r?.interval1), iN = Number(r?.intervalN);
    if (r && Number.isInteger(i1) && Number.isInteger(iN) && i1 > 0 && iN > 0) increments.set(prefix, `${i1}/${iN}`);
    else missing.push(prefix);
  }
  return { increments, missing };
}

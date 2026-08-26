/**
 * commercial-mapping.ts
 *
 * What a company record may learn from Sippy, and — more importantly — what it
 * may NOT unlearn or silently change.
 *
 * Pure: no database, no Sippy, no imports. The rule below decides whether a
 * customer gets billed against tariff 32 or tariff 41, so it is arithmetic that
 * can be tested exhaustively rather than behaviour observed in production.
 *
 * ── The problem this closes ──────────────────────────────────────────────────
 * Two provisioning paths each wrote half the mapping. The wizard created a
 * tariff and stored sippyITariff but no sippyIAccount; linking an existing
 * Sippy account stored sippyIAccount but no sippyITariff. Nothing joined them.
 * So `asterisk` sat at sippyIAccount=315 / sippyITariff=NULL, and because
 * resolveInvoiceTariff() reads only the stored column, invoice generation
 * refused with a 422 — correctly, but for a value the platform could see in
 * Sippy the whole time and never wrote down.
 *
 * ── The rule, and why it is FILL-ONLY ───────────────────────────────────────
 * Persisting a discovered value is safe exactly once: when nothing is stored.
 * After that the stored value is the billing decision, and Sippy is no longer
 * allowed a vote.
 *
 *   stored empty,  discovered present            -> FILL
 *   stored present, discovered absent            -> KEEP (a failed lookup is
 *                                                   not evidence of a change)
 *   stored present, discovered equal             -> KEEP
 *   stored present, discovered DIFFERENT         -> CONFLICT: write nothing
 *
 * The last line is the point. If a customer is billed on tariff 32 and Sippy
 * now answers 41, the platform must STOP and make a human decide — silently
 * adopting 41 would re-rate a period at prices nobody approved, and silently
 * ignoring it would hide a real divergence. Neither is a billing decision code
 * gets to make. Reporting the conflict is Change 2's job; refusing to write it
 * is this module's, and it has to be here rather than there, because a
 * fill-that-overwrites would be a defect the day it shipped.
 */

/** The commercial mapping as currently stored on a company. */
export interface StoredMapping {
  sippyITariff?:        number | null;
  sippyIBillingPlan?:   number | null;
  sippyTariffCurrency?: string | null;
}

/** The same mapping as discovered live from Sippy. */
export interface DiscoveredMapping {
  iTariff?:      number | null;
  iBillingPlan?: number | null;
  currency?:     string | null;
}

export type MappingField = 'sippyITariff' | 'sippyIBillingPlan' | 'sippyTariffCurrency';

export interface MappingConflict {
  field:      MappingField;
  stored:     number | string;
  discovered: number | string;
}

export interface MappingPlan {
  /** Exactly the columns to write. Empty when there is nothing to fill. */
  updates:   Partial<Record<MappingField, number | string>>;
  /** Fields newly learned — for the operator-facing summary and the log line. */
  filled:    MappingField[];
  /** Stored and live disagree. NOT written, and never auto-resolved. */
  conflicts: MappingConflict[];
  /** Nothing to learn: already equal, or Sippy had no answer. */
  unchanged: MappingField[];
}

/** Absent means null, undefined, or blank — a stored '' must not count as known. */
function isAbsent(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

/**
 * Compares stored against discovered without coercing types loosely.
 *
 * Numeric identity is compared numerically because these values cross XML-RPC
 * and a JSON boundary — 32 and "32" are the same tariff and must not be
 * reported as a conflict. Currency is compared case-insensitively for the same
 * reason ('usd' and 'USD' are one currency, not a billing divergence).
 */
function sameValue(field: MappingField, stored: unknown, discovered: unknown): boolean {
  if (field === 'sippyTariffCurrency') {
    return String(stored).trim().toUpperCase() === String(discovered).trim().toUpperCase();
  }
  return Number(stored) === Number(discovered);
}

/**
 * Decides what to write for one company, given what is stored and what Sippy says.
 *
 * Never returns an update that overwrites an existing value. The caller can
 * apply `updates` unconditionally; safety does not depend on the caller.
 */
export function planMappingPersistence(
  stored: StoredMapping,
  discovered: DiscoveredMapping,
): MappingPlan {
  const plan: MappingPlan = { updates: {}, filled: [], conflicts: [], unchanged: [] };

  const pairs: Array<{ field: MappingField; stored: unknown; discovered: unknown }> = [
    { field: 'sippyITariff',        stored: stored.sippyITariff,        discovered: discovered.iTariff },
    { field: 'sippyIBillingPlan',   stored: stored.sippyIBillingPlan,   discovered: discovered.iBillingPlan },
    { field: 'sippyTariffCurrency', stored: stored.sippyTariffCurrency, discovered: discovered.currency },
  ];

  for (const { field, stored: s, discovered: d } of pairs) {
    if (isAbsent(d)) { plan.unchanged.push(field); continue; }

    if (isAbsent(s)) {
      plan.updates[field] = field === 'sippyTariffCurrency'
        ? String(d).trim().toUpperCase()
        : Number(d);
      plan.filled.push(field);
      continue;
    }

    if (sameValue(field, s, d)) { plan.unchanged.push(field); continue; }

    plan.conflicts.push({
      field,
      stored:     s as number | string,
      discovered: d as number | string,
    });
  }

  return plan;
}

/** One line for the operator and the log — says what changed, or that nothing did. */
export function describeMappingPlan(companyName: string, plan: MappingPlan): string {
  const parts: string[] = [];
  if (plan.filled.length) {
    parts.push(`filled ${plan.filled.map(f => `${f}=${plan.updates[f]}`).join(', ')}`);
  }
  if (plan.conflicts.length) {
    parts.push(
      `CONFLICT ${plan.conflicts.map(c => `${c.field} stored=${c.stored} live=${c.discovered}`).join('; ')} ` +
      '— not written, billing continues on the stored value',
    );
  }
  if (!parts.length) parts.push('no change');
  return `${companyName}: ${parts.join(' | ')}`;
}

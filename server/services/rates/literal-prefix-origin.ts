/**
 * literal-prefix-origin.ts — turning a Rate Analysis request into canonical operations.
 *
 * WHY A SECOND ORIGIN EXISTS AT ALL. `runRateBatch` is the canonical mutation seam: it holds the
 * tariff advisory lock, the one-writer-per-tariff lane, eligibility, operation recording, readback
 * and the post-push obligation. `push-batch` reaches it with DESTINATION-derived operations —
 * product plus catalogue destination, expanded to prefixes. `change-client-rates` is the other
 * shape: one account, one rate, literal caller-supplied prefixes, at a tariff the caller names.
 *
 * Forcing Rate Analysis through destination resolution would change what it means. A Commercial UI
 * row is a destination (`commercial-ui-destination-model`), but this path deliberately edits a
 * specific prefix. So the seam admits two ORIGINS and one execution engine — and `batch-plan` and
 * `batch-runner` are not reshaped for either.
 *
 * THE DECISION THAT MATTERS MOST HERE: A CALLER-SUPPLIED TARIFF IS A CLAIM, NOT A RESOLUTION.
 *
 * `PreflightOperation` separates two fields on purpose:
 *
 *     storedITariff    what provisioning built for this customer (company.sippyITariff)
 *     resolvedITariff  what the SERVER resolved from Sippy: account -> billing plan -> tariff
 *
 * `change-client-rates` receives `iTariff` in the request body — from a browser. Assigning it to
 * `resolvedITariff` would launder a client assertion into the field preflight trusts as
 * server-derived, and preflight would then compare a claim against itself and always agree. That
 * is the same defect class as the portal write path scraping an `i_rate` off a page and treating it
 * as authoritative (`portal-rate-write-defect`), and the opposite of the rule the account-sync fix
 * established: the server re-derives, refuses, and fails closed.
 *
 * So this module takes the claim and the server-resolved value SEPARATELY, and:
 *
 *   - both present and equal      → operation carries the resolved value; the claim is satisfied
 *   - both present and different  → REFUSED here. Never silently prefer either one.
 *   - no server-resolved value    → REFUSED. A claim alone is not a resolution.
 *
 * Preflight would refuse a mismatch too, but it must not be handed a pre-agreed pair; the check
 * belongs where the claim enters the system.
 *
 * PURE ON PURPOSE. No database, no Sippy, no clock. The caller resolves the tariff and the
 * eligibility set and passes them in, so the mapping itself is provable without either.
 */
import type { RunnerOperation } from './batch-runner';

export interface LiteralPrefixRequest {
  readonly accountName: string;
  /** From the request body. A CLAIM about which tariff to write. */
  readonly claimedITariff: number | string | null | undefined;
  readonly prefixes: readonly string[];
  readonly rate: number;
  readonly effectiveFrom?: string;
  readonly effectiveTill?: string;
}

export interface LiteralPrefixContext {
  /** `company.sippyITariff` — what provisioning built. */
  readonly storedITariff: number | string | null | undefined;
  /** What the SERVER resolved from Sippy. Required: a claim alone cannot stand in for it. */
  readonly resolvedITariff: number | string | null | undefined;
  /** Eligible prefixes for the product, or null when the lookup did not answer. */
  readonly eligiblePrefixes: ReadonlySet<string> | null;
  readonly productName?: string | null;
  readonly trunkPrefix?: string | null;
  readonly iAccount?: number | null;
  readonly clientId?: number | null;
  readonly clientName?: string | null;
  /** Raw `billing_increment` per full prefix, where the catalogue has one. */
  readonly rawIncrementByPrefix?: ReadonlyMap<string, string | null>;
}

export type LiteralPrefixRefusal =
  | { readonly reason: 'NO_RESOLVED_TARIFF' }
  | { readonly reason: 'TARIFF_CLAIM_MISMATCH'; readonly claimed: string; readonly resolved: string }
  | { readonly reason: 'NO_PREFIXES' }
  | { readonly reason: 'INVALID_RATE'; readonly rate: unknown }
  | { readonly reason: 'DUPLICATE_PREFIX'; readonly prefix: string };

export type LiteralPrefixOutcome =
  | { readonly ok: true; readonly operations: readonly RunnerOperation[] }
  | { readonly ok: false; readonly refusal: LiteralPrefixRefusal };

/** Stable, collision-free within one job: index plus the prefix it wrote. Mirrors the existing key shape. */
export function literalOperationKey(index: number, prefix: string): string {
  return `op-${index}-${prefix}`;
}

const asTariffString = (v: number | string | null | undefined): string | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : null;
};

export function buildLiteralPrefixOperations(
  req: LiteralPrefixRequest,
  ctx: LiteralPrefixContext,
): LiteralPrefixOutcome {
  const resolved = asTariffString(ctx.resolvedITariff);
  if (resolved === null) return { ok: false, refusal: { reason: 'NO_RESOLVED_TARIFF' } };

  const claimed = asTariffString(req.claimedITariff);
  if (claimed !== null && claimed !== resolved) {
    return { ok: false, refusal: { reason: 'TARIFF_CLAIM_MISMATCH', claimed, resolved } };
  }

  if (!Number.isFinite(req.rate) || req.rate < 0) {
    return { ok: false, refusal: { reason: 'INVALID_RATE', rate: req.rate } };
  }

  const prefixes = req.prefixes.map(p => String(p).trim()).filter(p => p.length > 0);
  if (prefixes.length === 0) return { ok: false, refusal: { reason: 'NO_PREFIXES' } };

  const seen = new Set<string>();
  for (const p of prefixes) {
    // Two operations writing one prefix in one tariff is what batch-plan already refuses; catching
    // it here names the duplicate instead of surfacing as an opaque plan refusal.
    if (seen.has(p)) return { ok: false, refusal: { reason: 'DUPLICATE_PREFIX', prefix: p } };
    seen.add(p);
  }

  const operations: RunnerOperation[] = prefixes.map((fullPrefix, i) => ({
    operationKey: literalOperationKey(i, fullPrefix),
    accountName: req.accountName,
    storedITariff: ctx.storedITariff,
    // The SERVER-resolved value, never the claim.
    resolvedITariff: ctx.resolvedITariff,
    fullPrefix,
    rate: req.rate,
    rawIncrement: ctx.rawIncrementByPrefix?.get(fullPrefix) ?? null,
    // null lookup stays UNDEFINED rather than false: absence is not permission, and it is not a
    // refusal either — preflight decides. Same semantics push-batch already applies.
    ...(ctx.eligiblePrefixes ? { eligible: ctx.eligiblePrefixes.has(fullPrefix) } : {}),
    ...(req.effectiveFrom ? { effectiveFrom: req.effectiveFrom } : {}),
    ...(req.effectiveTill ? { effectiveTill: req.effectiveTill } : {}),
    ...(ctx.iAccount != null ? { iAccount: ctx.iAccount } : {}),
    ...(ctx.clientId != null ? { clientId: ctx.clientId } : {}),
    ...(ctx.clientName ? { clientName: ctx.clientName } : {}),
  })) as RunnerOperation[];

  return { ok: true, operations };
}

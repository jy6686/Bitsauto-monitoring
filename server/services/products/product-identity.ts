/**
 * product-identity.ts
 *
 * What a product row must contain to be usable, checked before it is written.
 *
 * `product_registry` is the platform's product identity and there must not be a second one. This
 * module exists because the registry's write endpoints could not populate two of the fields the
 * rest of the system depends on, so a product created through the platform was born unusable:
 *
 *   - **trunk_prefix** — the digit prepended to a catalogue dial prefix to make the Sippy prefix
 *     (First Class + 9370 = 19370). `POST /api/product-registry/products` never accepted it, so a
 *     new product had none, and push-batch refuses such a product outright: "has no usable trunk
 *     prefix". The product existed and could never be sold.
 *   - **segment** — wholesale or retail. Defined on the table, populated by nothing. Existing code
 *     reads `segment === 'wholesale' || !segment`, so NULL means wholesale by accident rather than
 *     by decision, and a retail product could not be expressed at all.
 *
 * And a third, quieter one: creation defaulted `status` to `'active'`, a value nothing in the
 * codebase reads. Every query that matters filters `status = 'commercial'`. A product created
 * through the API was therefore invisible to the commercial surfaces that are supposed to list it —
 * not broken, just absent, which is harder to notice.
 *
 * IDENTITY IS THE ROW, NOT THE TRUNK PREFIX. Wholesale and Retail deliberately SHARE trunk prefixes
 * (First Class Wholesale and Premium are both trunk 1). So a trunk prefix identifies a product
 * *family*, never a product, and two products holding the same one is legitimate rather than a
 * mistake. `describeTrunkSharing()` reports it so the collision it can cause — one customer holding
 * both, and the same full prefix landing twice in one tariff — is visible at assignment time rather
 * than surfacing later as a duplicate-target refusal at push time.
 */
import { validateTrunkPrefix } from '../rates/product-trunk';

/**
 * The vocabulary, made explicit because it was not.
 *
 * `commercial` is the only value anything reads — `/api/products?status=commercial` and the
 * commercial-products query both filter on it. `draft` names the state a new product is actually in
 * (present, not yet sellable) instead of the `active` it used to get, which read as sellable and was
 * not. `retired` is the end state, kept distinct from deletion so history survives.
 */
export const PRODUCT_STATUSES = ['draft', 'commercial', 'retired'] as const;
export type ProductStatus = typeof PRODUCT_STATUSES[number];

/** NULL is not offered: it currently means "wholesale by accident" and that is what this fixes. */
export const PRODUCT_SEGMENTS = ['wholesale', 'retail'] as const;
export type ProductSegment = typeof PRODUCT_SEGMENTS[number];

/**
 * Fields a client may set. Everything else — id, createdAt, and any column added later — is refused
 * by omission rather than by a deny-list that a new column would silently slip past.
 *
 * The edit endpoint previously did `.set(req.body)`, so any column was writable by any caller,
 * including the primary key and the unique `code`.
 */
export const EDITABLE_PRODUCT_FIELDS = [
  'code', 'name', 'description', 'status', 'color', 'segment', 'trunkPrefix',
  'defaultRoutingTemplate', 'backupRoutingTemplate', 'defaultPricingTemplate',
  'minMarginPct', 'discountRangeMin', 'discountRangeMax', 'noticePeriodDays',
  'offerWindowMin', 'offerWindowTarget', 'offerWindowPremium', 'sortOrder',
] as const;
export type EditableProductField = typeof EDITABLE_PRODUCT_FIELDS[number];

export interface ProductInput {
  code?: unknown;
  name?: unknown;
  status?: unknown;
  segment?: unknown;
  trunkPrefix?: unknown;
  [k: string]: unknown;
}

export interface ProductFieldError { field: string; message: string }

export type ProductValidation =
  | { ok: true;  value: Record<string, unknown> }
  | { ok: false; errors: ProductFieldError[] };

const isBlank = (v: unknown) => v === undefined || v === null || String(v).trim() === '';

/**
 * @param input   the request body
 * @param opts.partial  an edit: only validate what was supplied, and do not require code/name
 */
export function validateProductInput(input: ProductInput, opts: { partial?: boolean } = {}): ProductValidation {
  const errors: ProductFieldError[] = [];
  const value: Record<string, unknown> = {};

  // ── Only known fields survive ───────────────────────────────────────────────
  for (const key of Object.keys(input)) {
    if (!(EDITABLE_PRODUCT_FIELDS as readonly string[]).includes(key)) continue;
    value[key] = input[key];
  }

  // ── code — the unique business key ──────────────────────────────────────────
  if ('code' in value) {
    const code = String(value.code ?? '').trim().toUpperCase();
    if (!code) errors.push({ field: 'code', message: 'code is required and cannot be blank.' });
    else if (code.length > 16) errors.push({ field: 'code', message: `code is limited to 16 characters (got ${code.length}).` });
    else if (!/^[A-Z0-9_-]+$/.test(code)) errors.push({ field: 'code', message: 'code may contain only letters, digits, hyphen and underscore.' });
    else value.code = code;
  } else if (!opts.partial) {
    errors.push({ field: 'code', message: 'code is required.' });
  }

  // ── name ────────────────────────────────────────────────────────────────────
  if ('name' in value) {
    const name = String(value.name ?? '').trim();
    if (!name) errors.push({ field: 'name', message: 'name is required and cannot be blank.' });
    else if (name.length > 64) errors.push({ field: 'name', message: `name is limited to 64 characters (got ${name.length}).` });
    else value.name = name;
  } else if (!opts.partial) {
    errors.push({ field: 'name', message: 'name is required.' });
  }

  // ── trunk_prefix — what makes the product pushable at all ──────────────────
  if ('trunkPrefix' in value) {
    if (isBlank(value.trunkPrefix)) {
      // Explicitly clearing it is allowed; the product simply stops being pushable.
      value.trunkPrefix = null;
    } else {
      const trunk = validateTrunkPrefix(value.trunkPrefix as string);
      if (!trunk) {
        errors.push({
          field: 'trunkPrefix',
          message: `trunkPrefix must be digits only (got ${JSON.stringify(value.trunkPrefix)}). It is prepended to a catalogue dial prefix to form the Sippy prefix, so a non-numeric value cannot produce one.`,
        });
      } else if (trunk.length > 8) {
        errors.push({ field: 'trunkPrefix', message: `trunkPrefix is limited to 8 digits (got ${trunk.length}).` });
      } else {
        value.trunkPrefix = trunk;
      }
    }
  }

  // ── segment ─────────────────────────────────────────────────────────────────
  if ('segment' in value) {
    if (isBlank(value.segment)) {
      value.segment = null;   // legacy rows are NULL and read as wholesale; clearing stays possible
    } else {
      const seg = String(value.segment).trim().toLowerCase();
      if (!(PRODUCT_SEGMENTS as readonly string[]).includes(seg)) {
        errors.push({ field: 'segment', message: `segment must be one of ${PRODUCT_SEGMENTS.join(', ')} (got ${JSON.stringify(value.segment)}).` });
      } else {
        value.segment = seg;
      }
    }
  }

  // ── status ──────────────────────────────────────────────────────────────────
  if ('status' in value && !isBlank(value.status)) {
    const status = String(value.status).trim().toLowerCase();
    if (!(PRODUCT_STATUSES as readonly string[]).includes(status)) {
      errors.push({
        field: 'status',
        message: `status must be one of ${PRODUCT_STATUSES.join(', ')} (got ${JSON.stringify(value.status)}). 'active' was accepted before and read by nothing, so such products were invisible to every commercial surface.`,
      });
    } else {
      value.status = status;
    }
  } else if (!opts.partial) {
    // A new product is present but not yet sellable. Naming that 'draft' is the whole point.
    value.status = 'draft';
  } else {
    delete value.status;
  }

  return errors.length ? { ok: false, errors } : { ok: true, value };
}

export interface TrunkSharingReport {
  trunkPrefix: string;
  /** Every product using it, in registry order. Two or more is legitimate, not an error. */
  products: Array<{ id: number; code: string; name: string; segment: string | null }>;
  /** True when the sharers span segments — the normal wholesale/retail pairing. */
  acrossSegments: boolean;
  /**
   * True when two sharers are in the SAME segment. That is the one shape with no legitimate
   * reading: a customer cannot hold two wholesale products on trunk 1 without the same full prefix
   * being written twice into one tariff.
   */
  withinSegment: boolean;
}

/**
 * Which products share a trunk prefix, and whether that sharing is the intended cross-segment kind.
 *
 * Reported, never refused. Wholesale and Retail sharing trunk 1 is the design. What it costs is
 * real though: if one customer holds First Class Wholesale AND Premium, catalogue destination 9370
 * becomes 19370 for both, and the batch planner refuses the second as a duplicate target at push
 * time. Surfacing it here lets that be seen when products or eligibility are configured, which is
 * where it can still be acted on.
 */
export function describeTrunkSharing(
  products: ReadonlyArray<{ id: number; code: string; name: string; segment: string | null; trunkPrefix: string | null }>,
): TrunkSharingReport[] {
  const byTrunk = new Map<string, TrunkSharingReport['products']>();
  for (const p of products) {
    const t = p.trunkPrefix === null || p.trunkPrefix === undefined ? '' : String(p.trunkPrefix).trim();
    if (!t) continue;
    const list = byTrunk.get(t) ?? [];
    list.push({ id: p.id, code: p.code, name: p.name, segment: p.segment ?? null });
    byTrunk.set(t, list);
  }

  const out: TrunkSharingReport[] = [];
  for (const [trunkPrefix, list] of [...byTrunk.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))) {
    if (list.length < 2) continue;
    // NULL segment reads as wholesale everywhere else in the codebase; keep that reading here.
    const segs = list.map(p => p.segment ?? 'wholesale');
    out.push({
      trunkPrefix,
      products: list,
      acrossSegments: new Set(segs).size > 1,
      withinSegment: segs.length !== new Set(segs).size,
    });
  }
  return out;
}

/**
 * eligibility-store.ts
 *
 * Which catalogue destinations each product is sold on.
 *
 * The catalogue is product-neutral by design and the legacy
 * `product_destination_assignments` table is non-authoritative as of migration 514 — its
 * `destination_id` moved id space twice and its 52 rows are uniform seed. Nothing here reads it,
 * and nothing here remaps it.
 *
 * TWO RULES THIS MODULE KEEPS.
 *
 * 1. **It never invents eligibility.** There is no "grant all", no seeding, no defaulting to the
 *    legacy thirteen, and no assumption that an unlisted destination is either eligible or not by
 *    implication. A product sells what somebody said it sells.
 *
 * 2. **Version scoping is surfaced, not hidden.** `commercial_destinations.id` belongs to one
 *    catalogue version, so eligibility declared against V1 does not carry into V2. That is honest:
 *    a new version is a new commercial fact set. `describeVersionRollover()` reports what would be
 *    left behind so the decision is visible instead of arriving as silently missing rows.
 */
import { sql } from 'drizzle-orm';

/** Same minimal injection point the other stores in this codebase use, so PGlite can drive it. */
export interface EligibilityQueryable {
  execute(query: any): Promise<any>;
}

export type EligibilityStatus = 'active' | 'withdrawn';

export interface EligibilityRow {
  id: number;
  productId: number;
  destinationId: number;
  versionId: number;
  status: EligibilityStatus;
  createdAt: string | null;
  createdBy: string | null;
  withdrawnAt: string | null;
  withdrawnBy: string | null;
  notes: string | null;
}

const rows = (r: any): any[] => (Array.isArray(r) ? r : (r?.rows ?? []));
const num = (v: any): number => Number(v);
const str = (v: any): string | null => (v === null || v === undefined ? null : String(v));

const toRow = (r: any): EligibilityRow => ({
  id: num(r.id),
  productId: num(r.product_id),
  destinationId: num(r.destination_id),
  versionId: num(r.version_id),
  status: String(r.status) as EligibilityStatus,
  createdAt: str(r.created_at),
  createdBy: str(r.created_by),
  withdrawnAt: str(r.withdrawn_at),
  withdrawnBy: str(r.withdrawn_by),
  notes: str(r.notes),
});

export type GrantOutcome =
  | { ok: true; row: EligibilityRow; reactivated: boolean }
  | { ok: false; code: 'unknown_destination' | 'not_attributable'; message: string };

/**
 * Declare that a product is sold on a destination.
 *
 * Idempotent: granting an already-active pairing returns it unchanged. Re-granting a withdrawn one
 * flips it back rather than inserting a second row, so one pairing keeps one line of history.
 *
 * `version_id` is read from the destination rather than accepted from the caller — a caller-supplied
 * version is a second source of truth for a fact the catalogue already owns.
 */
export async function grantEligibility(
  db: EligibilityQueryable,
  input: { productId: number; destinationId: number; grantedBy: string; notes?: string | null },
): Promise<GrantOutcome> {
  if (!input.grantedBy || !String(input.grantedBy).trim()) {
    return {
      ok: false, code: 'not_attributable',
      message: 'Eligibility must be attributable: which destinations a product sells is a commercial claim, and the record has to say who made it.',
    };
  }

  const [dest] = rows(await db.execute(sql`
    SELECT id, version_id FROM commercial_destinations WHERE id = ${input.destinationId}`));
  if (!dest) {
    return {
      ok: false, code: 'unknown_destination',
      message: `Destination ${input.destinationId} is not in the commercial catalogue. Eligibility references the versioned catalogue only — never the legacy destination tree.`,
    };
  }

  const [existing] = rows(await db.execute(sql`
    SELECT id, status FROM product_destination_eligibility
     WHERE product_id = ${input.productId} AND destination_id = ${input.destinationId}`));

  if (existing && String(existing.status) === 'active') {
    const [row] = rows(await db.execute(sql`
      SELECT * FROM product_destination_eligibility WHERE id = ${num(existing.id)}`));
    return { ok: true, row: toRow(row), reactivated: false };
  }

  if (existing) {
    const [row] = rows(await db.execute(sql`
      UPDATE product_destination_eligibility
         SET status = 'active', withdrawn_at = NULL, withdrawn_by = NULL,
             created_by = ${input.grantedBy}, created_at = NOW(),
             notes = ${input.notes ?? null}
       WHERE id = ${num(existing.id)}
       RETURNING *`));
    return { ok: true, row: toRow(row), reactivated: true };
  }

  const [row] = rows(await db.execute(sql`
    INSERT INTO product_destination_eligibility
      (product_id, destination_id, version_id, status, created_by, notes)
    VALUES (${input.productId}, ${input.destinationId}, ${num(dest.version_id)}, 'active',
            ${input.grantedBy}, ${input.notes ?? null})
    RETURNING *`));
  return { ok: true, row: toRow(row), reactivated: false };
}

export type WithdrawOutcome =
  | { ok: true; row: EligibilityRow }
  | { ok: false; code: 'not_found' | 'already_withdrawn' | 'not_attributable'; message: string };

/** Withdraw eligibility. Never a DELETE: "no longer sold here" is a claim someone made. */
export async function withdrawEligibility(
  db: EligibilityQueryable,
  input: { productId: number; destinationId: number; withdrawnBy: string; notes?: string | null },
): Promise<WithdrawOutcome> {
  if (!input.withdrawnBy || !String(input.withdrawnBy).trim()) {
    return { ok: false, code: 'not_attributable', message: 'Withdrawing eligibility must be attributable to a person.' };
  }

  const [existing] = rows(await db.execute(sql`
    SELECT id, status FROM product_destination_eligibility
     WHERE product_id = ${input.productId} AND destination_id = ${input.destinationId}`));

  if (!existing) {
    return { ok: false, code: 'not_found', message: `Product ${input.productId} was never declared eligible for destination ${input.destinationId}.` };
  }
  if (String(existing.status) === 'withdrawn') {
    return { ok: false, code: 'already_withdrawn', message: `That eligibility was already withdrawn.` };
  }

  const [row] = rows(await db.execute(sql`
    UPDATE product_destination_eligibility
       SET status = 'withdrawn', withdrawn_at = NOW(), withdrawn_by = ${input.withdrawnBy},
           notes = COALESCE(${input.notes ?? null}, notes)
     WHERE id = ${num(existing.id)}
     RETURNING *`));
  return { ok: true, row: toRow(row) };
}

export interface EligibleDestination {
  destinationId: number;
  name: string;
  versionId: number;
  approvalStatus: string;
  /** Every prefix the catalogue holds for it. A destination is a set of prefixes, not one. */
  prefixes: string[];
}

/**
 * What a product sells, resolved through the catalogue.
 *
 * Scoped to the ACTIVE catalogue version by default, because that is the only version anything is
 * sold on. Nothing is inferred: a product with no declared eligibility gets an empty list, which is
 * the truthful answer and not an error.
 */
export async function listEligibleDestinations(
  db: EligibilityQueryable,
  productId: number,
  opts: { versionId?: number } = {},
): Promise<EligibleDestination[]> {
  const res = await db.execute(
    opts.versionId === undefined
      ? sql`SELECT d.id, d.name, d.version_id, d.approval_status,
                   COALESCE(array_agg(p.prefix ORDER BY p.prefix) FILTER (WHERE p.prefix IS NOT NULL), '{}') AS prefixes
              FROM product_destination_eligibility e
              JOIN commercial_destinations d ON d.id = e.destination_id
              JOIN catalogue_versions      v ON v.id = d.version_id AND v.status = 'active'
              LEFT JOIN commercial_destination_prefixes p ON p.destination_id = d.id
             WHERE e.product_id = ${productId} AND e.status = 'active'
             GROUP BY d.id, d.name, d.version_id, d.approval_status
             ORDER BY d.name`
      : sql`SELECT d.id, d.name, d.version_id, d.approval_status,
                   COALESCE(array_agg(p.prefix ORDER BY p.prefix) FILTER (WHERE p.prefix IS NOT NULL), '{}') AS prefixes
              FROM product_destination_eligibility e
              JOIN commercial_destinations d ON d.id = e.destination_id
              LEFT JOIN commercial_destination_prefixes p ON p.destination_id = d.id
             WHERE e.product_id = ${productId} AND e.status = 'active'
               AND d.version_id = ${opts.versionId}
             GROUP BY d.id, d.name, d.version_id, d.approval_status
             ORDER BY d.name`);

  return rows(res).map((r: any) => ({
    destinationId: num(r.id),
    name: String(r.name),
    versionId: num(r.version_id),
    approvalStatus: String(r.approval_status),
    prefixes: Array.isArray(r.prefixes) ? r.prefixes.map(String)
            : String(r.prefixes ?? '').replace(/^\{|\}$/g, '').split(',').filter(Boolean),
  }));
}

export interface RolloverReport {
  fromVersionId: number;
  toVersionId: number;
  /** Eligibility that finds a same-named destination in the new version. */
  carriable: Array<{ productId: number; name: string; fromDestinationId: number; toDestinationId: number }>;
  /** Eligibility whose destination has no counterpart by name in the new version. */
  orphaned: Array<{ productId: number; name: string; fromDestinationId: number }>;
}

/**
 * What a catalogue version rollover would do to existing eligibility.
 *
 * REPORTS ONLY. It carries nothing across, because whether last version's eligibility still applies
 * is a commercial judgement — a destination can keep its name and change what it covers. Matching is
 * by the catalogue's own identity, `(version_id, name)`, and never by prefix: prefix-matching across
 * id spaces is precisely what produced the residue this whole layer exists to escape.
 */
export async function describeVersionRollover(
  db: EligibilityQueryable,
  fromVersionId: number,
  toVersionId: number,
): Promise<RolloverReport> {
  const res = await db.execute(sql`
    SELECT e.product_id, d.name, d.id AS from_id, n.id AS to_id
      FROM product_destination_eligibility e
      JOIN commercial_destinations d ON d.id = e.destination_id AND d.version_id = ${fromVersionId}
      LEFT JOIN commercial_destinations n ON n.version_id = ${toVersionId} AND n.name = d.name
     WHERE e.status = 'active'
     ORDER BY e.product_id, d.name`);

  const carriable: RolloverReport['carriable'] = [];
  const orphaned: RolloverReport['orphaned'] = [];
  for (const r of rows(res)) {
    if (r.to_id === null || r.to_id === undefined) {
      orphaned.push({ productId: num(r.product_id), name: String(r.name), fromDestinationId: num(r.from_id) });
    } else {
      carriable.push({
        productId: num(r.product_id), name: String(r.name),
        fromDestinationId: num(r.from_id), toDestinationId: num(r.to_id),
      });
    }
  }
  return { fromVersionId, toVersionId, carriable, orphaned };
}

export interface ActiveCatalogue {
  versionId: number;
  label: string;
  /** Destinations in the active version. Zero means the catalogue itself is empty. */
  destinationCount: number;
}

/**
 * The active catalogue version and how much is in it.
 *
 * Exists so a caller can tell three states apart, which matters commercially and operationally:
 *
 *   catalogue null            the catalogue could not be read, or no version is active
 *   destinationCount === 0    the catalogue is empty — nothing could be eligible
 *   count > 0, declared false the catalogue is populated and this product has no eligibility yet
 *
 * Without it, an empty eligibility list is indistinguishable from a broken catalogue, and an
 * operator cannot tell "nobody has decided yet" from "the import failed".
 */
export async function describeActiveCatalogue(db: EligibilityQueryable): Promise<ActiveCatalogue | null> {
  const [v] = rows(await db.execute(sql`
    SELECT v.id, v.label, count(d.id)::int AS destination_count
      FROM catalogue_versions v
      LEFT JOIN commercial_destinations d ON d.version_id = v.id
     WHERE v.status = 'active'
     GROUP BY v.id, v.label`));
  if (!v) return null;
  return { versionId: num(v.id), label: String(v.label), destinationCount: num(v.destination_count) };
}

/**
 * Every PREFIX a product is declared eligible for, in the active catalogue version.
 *
 * The push path works in prefixes — an operator picks destinations and the request carries dial
 * prefixes — so the eligibility question has to be answerable in that shape too. This is the same
 * declared fact as `listEligibleDestinations`, flattened to the key the push actually holds.
 *
 * An undeclared product returns an EMPTY set, and a caller must read that as "sells nothing",
 * never as "no restriction". The two are opposite and the empty set is the truthful one.
 */
export async function listEligiblePrefixes(
  db: EligibilityQueryable,
  productId: number,
): Promise<Set<string>> {
  const res = await db.execute(sql`
    SELECT p.prefix
      FROM product_destination_eligibility e
      JOIN commercial_destinations d ON d.id = e.destination_id
      JOIN catalogue_versions      v ON v.id = d.version_id AND v.status = 'active'
      JOIN commercial_destination_prefixes p ON p.destination_id = d.id
     WHERE e.product_id = ${productId} AND e.status = 'active'`);
  return new Set(rows(res).map((r: any) => String(r.prefix)));
}

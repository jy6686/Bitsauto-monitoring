/**
 * catalogue-increments.ts
 *
 * Reads `billing_increment` for a set of prefixes from the ACTIVE commercial catalogue.
 *
 * This lives in its own module for one reason: the first version of it shipped to production
 * inside a route, was covered by 92 green unit tests, and could never have worked. It used
 * `p.prefix = ANY(${jsArray})`, and Postgres answered
 *
 *     op ANY/ALL (array) requires array on right side
 *
 * on the first real request, because the driver binds a JS array as a single scalar parameter.
 * No unit test caught it, because no unit test ran a query. Extracted here so a database-backed
 * test can execute the real statement against real Postgres.
 */
import { sql } from 'drizzle-orm';

/** Minimal surface we need — anything Drizzle-shaped, so tests can pass a PGlite instance. */
export interface IncrementQueryable {
  execute(query: any): Promise<any>;
}

/**
 * Returns prefix → raw `billing_increment` for every supplied prefix that exists in the active
 * catalogue. A prefix absent from the map is absent from the catalogue — which the caller must
 * distinguish from a prefix present with an unusable value. Those are different problems: one
 * is "not ours to price", the other is "ours and unreadable".
 *
 * The predicate is an explicit IN list rather than `= ANY(array)`. Each prefix is its own bound
 * parameter, so nothing depends on how a driver serialises an array.
 */
export async function lookupCatalogueIncrements(
  db: IncrementQueryable,
  prefixes: string[],
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();

  // `IN ()` is a syntax error in Postgres, and an empty batch has nothing to ask about anyway.
  const unique = [...new Set(prefixes.filter(p => p !== null && p !== undefined && String(p).length > 0))];
  if (unique.length === 0) return out;

  const list = sql.join(unique.map(p => sql`${p}`), sql`, `);
  const result = await db.execute(sql`
    SELECT p.prefix, p.billing_increment
      FROM commercial_destination_prefixes p
      JOIN catalogue_versions v ON v.id = p.version_id AND v.status = 'active'
     WHERE p.prefix IN (${list})`);

  for (const row of ((result as any).rows ?? result ?? []) as any[]) {
    out.set(String(row.prefix), row.billing_increment ?? null);
  }
  return out;
}

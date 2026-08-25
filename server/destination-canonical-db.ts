/**
 * destination-canonical-db.ts
 *
 * Loads the destinations catalogue into the pure matcher, cached for 60s —
 * the catalogue changes through an approval workflow, not per-request, and
 * a certification pass or PDF render may call the matcher thousands of times.
 * (No write endpoint for the table exists in this repo, so there is nothing
 * to hook invalidation onto; a catalogue edit is visible within the TTL.)
 *
 * Failure semantics matter here: a load ERROR throws and is never cached —
 * an empty matcher would report every prefix unmapped, flipping certification
 * to exceptions and stripping names off documents over a connection blip.
 * Each consumer decides its own degradation: certification skips the unmapped
 * check (the pricing checks still decide), the PDF falls back to recorded
 * names, the matrix endpoint reports the catalogue unavailable. An EMPTY
 * table, by contrast, is real data and matches nothing, honestly.
 *
 * The `destinations` table predates the Drizzle schema (Phase-1 DDL; only the
 * destinations_v view is declared), so this reads it with raw SQL. Country =
 * the level-1 root ancestor's name; a row whose walk ends anywhere else gets
 * NO country rather than its own name in the Country column — the catalogue
 * defines countries, and a parentless operator row is a catalogue gap, not
 * a country called "Jazz".
 */

import { db } from './db';
import { sql } from 'drizzle-orm';
import { buildMatcher, type CatalogueEntry, type CanonicalMatch } from './destination-canonical';

let cached: { at: number; match: (p: string | null | undefined) => CanonicalMatch } | null = null;
const TTL_MS = 60_000;

/** Throws when the catalogue cannot be read; never caches a failure. */
export async function canonicalMatcher(): Promise<(p: string | null | undefined) => CanonicalMatch> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.match;
  const r = await db.execute(sql`
    WITH RECURSIVE up AS (
      SELECT id, name, parent_id, level, name AS root_name, level AS root_level
        FROM destinations WHERE parent_id IS NULL
      UNION ALL
      SELECT d.id, d.name, d.parent_id, d.level, up.root_name, up.root_level
        FROM destinations d JOIN up ON d.parent_id = up.id
    )
    SELECT d.id, d.name, d.dial_prefix,
           CASE WHEN up.root_level <= 1 THEN up.root_name ELSE '' END AS country
      FROM destinations d
      JOIN up ON up.id = d.id
     WHERE d.dial_prefix IS NOT NULL AND d.dial_prefix <> ''
     -- Deterministic duplicate resolution: most specific level first, oldest
     -- row breaking ties, so the same prefix maps identically on every reload.
     ORDER BY d.level DESC, d.id ASC`);
  const entries: CatalogueEntry[] = (((r as any).rows ?? []) as any[]).map((x) => ({
    id: Number(x.id), name: String(x.name ?? ''),
    dialPrefix: String(x.dial_prefix ?? ''), country: String(x.country ?? ''),
  }));
  const match = buildMatcher(entries);
  cached = { at: Date.now(), match };
  return match;
}

/** Test/ops hook: force a reload on the next call. */
export function invalidateCanonicalCache(): void { cached = null; }

import { db } from '../db';
import { sql } from 'drizzle-orm';

export interface MatchResult {
  normalizedPrefixId: number;
  destinationId: number | null;
  destinationName: string | null;
  matchStatus: 'matched' | 'partial' | 'unmatched';
  matchMethod: 'longest_prefix' | 'none';
  matchConfidence: number;
}

async function longestPrefixMatch(pfx: string): Promise<{
  destinationId: number;
  destinationName: string;
  matchedPrefix: string;
} | null> {
  const result = await db.execute(sql`
    SELECT
      dpr.destination_id,
      ds.name AS destination_name,
      LTRIM(dpr.dial_prefix, '+') AS matched_prefix
    FROM destination_product_rates dpr
    JOIN destination_sets ds ON ds.id = dpr.destination_set_id
    WHERE LTRIM(dpr.dial_prefix, '+') = LEFT(${pfx}, LENGTH(LTRIM(dpr.dial_prefix, '+')))
    ORDER BY LENGTH(dpr.dial_prefix) DESC
    LIMIT 1
  `);
  if (!result.rows.length) return null;
  const row = result.rows[0] as { destination_id: number; destination_name: string; matched_prefix: string };
  return { destinationId: row.destination_id, destinationName: row.destination_name, matchedPrefix: row.matched_prefix };
}

/**
 * Matches all pending normalized prefixes for a sheet against
 * destination_product_rates.dial_prefix using longest-prefix match.
 * Updates vendor_rate_normalized_prefixes in place.
 *
 * Confidence scale:
 *   100 = matched prefix length === vendor prefix length (exact)
 *    95 = longest-prefix match (shorter catalog prefix covers vendor prefix)
 *     0 = no match
 */
export async function matchSheetDestinations(sheetId: number): Promise<{
  matched: number;
  partial: number;
  unmatched: number;
  total: number;
}> {
  const pending = await db.execute(sql`
    SELECT id, normalized_prefix
    FROM vendor_rate_normalized_prefixes
    WHERE sheet_id = ${sheetId}
      AND match_status = 'pending'
    ORDER BY id
  `);

  const rows = pending.rows as { id: number; normalized_prefix: string }[];
  if (!rows.length) return { matched: 0, partial: 0, unmatched: 0, total: 0 };

  let matched = 0, partial = 0, unmatched = 0;

  const updates: {
    id: number;
    destinationId: number | null;
    matchStatus: string;
    matchMethod: string;
    matchConfidence: number;
  }[] = [];

  for (const row of rows) {
    const hit = await longestPrefixMatch(row.normalized_prefix);

    if (hit) {
      const exactMatch = hit.matchedPrefix.length === row.normalized_prefix.length;
      const confidence = exactMatch ? 100 : 95;
      const status = exactMatch ? 'matched' : 'partial';

      updates.push({
        id: row.id,
        destinationId: hit.destinationId,
        matchStatus: status,
        matchMethod: 'longest_prefix',
        matchConfidence: confidence,
      });

      if (exactMatch) matched++; else partial++;
    } else {
      updates.push({
        id: row.id,
        destinationId: null,
        matchStatus: 'unmatched',
        matchMethod: 'none',
        matchConfidence: 0,
      });
      unmatched++;
    }
  }

  // Write results in batches of 200
  for (let i = 0; i < updates.length; i += 200) {
    const batch = updates.slice(i, i + 200);
    for (const u of batch) {
      await db.execute(sql`
        UPDATE vendor_rate_normalized_prefixes
        SET destination_id   = ${u.destinationId},
            match_status     = ${u.matchStatus},
            match_method     = ${u.matchMethod},
            match_confidence = ${u.matchConfidence}
        WHERE id = ${u.id}
      `);
    }
  }

  return { matched, partial, unmatched, total: rows.length };
}

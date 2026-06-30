import { db } from '../../db';
import { sql } from 'drizzle-orm';
import { lookupAlias } from './destination-alias.service';

export type MatchMethod = 'alias' | 'canonical_name' | 'longest_prefix' | 'none';

export interface ResolvedDestination {
  destinationId: number | null;
  destinationName: string | null;
  method: MatchMethod;
  reason: string;
  confidence: number;
  matchedAliasId?: number;
}

async function resolveByCanonicalName(vendorName: string): Promise<{
  destinationId: number; destinationName: string;
} | null> {
  const result = await db.execute(sql`
    SELECT id, name FROM global_destinations
    WHERE LOWER(REGEXP_REPLACE(name, '[^a-zA-Z0-9]', '', 'g'))
        = LOWER(REGEXP_REPLACE(${vendorName}, '[^a-zA-Z0-9]', '', 'g'))
      AND commercial_status <> 'blocked'
    LIMIT 1
  `);
  if (!result.rows.length) return null;
  const row = result.rows[0] as { id: number; name: string };
  return { destinationId: row.id, destinationName: row.name };
}

async function resolveByLongestPrefix(normalizedPrefix: string): Promise<{
  destinationId: number; destinationName: string; matchedPrefix: string; isExact: boolean;
} | null> {
  const result = await db.execute(sql`
    SELECT dpr.destination_id, gd.name AS destination_name, dpr.dial_prefix
    FROM destination_product_rates dpr
    JOIN global_destinations gd ON gd.id = dpr.destination_id
    WHERE LTRIM(dpr.dial_prefix, '+') = LEFT(${normalizedPrefix}, LENGTH(LTRIM(dpr.dial_prefix, '+')))
      AND gd.commercial_status <> 'blocked'
    ORDER BY LENGTH(dpr.dial_prefix) DESC
    LIMIT 1
  `);
  if (!result.rows.length) return null;
  const row = result.rows[0] as { destination_id: number; destination_name: string; dial_prefix: string };
  const matchedPrefix = row.dial_prefix.replace(/^\+/, '');
  return {
    destinationId: row.destination_id,
    destinationName: row.destination_name,
    matchedPrefix,
    isExact: matchedPrefix === normalizedPrefix,
  };
}

export async function resolveDestination(
  vendorName: string | null,
  normalizedPrefix: string
): Promise<ResolvedDestination> {
  if (vendorName) {
    const alias = await lookupAlias(vendorName);
    if (alias) {
      return {
        destinationId: alias.destinationId,
        destinationName: alias.destinationName,
        method: 'alias',
        reason: `alias:${alias.aliasType}`,
        confidence: alias.confidence,
        matchedAliasId: alias.aliasId,
      };
    }
    const canonical = await resolveByCanonicalName(vendorName);
    if (canonical) {
      return {
        destinationId: canonical.destinationId,
        destinationName: canonical.destinationName,
        method: 'canonical_name',
        reason: 'canonical:exact',
        confidence: 95,
      };
    }
  }
  const prefixMatch = await resolveByLongestPrefix(normalizedPrefix);
  if (prefixMatch) {
    return {
      destinationId: prefixMatch.destinationId,
      destinationName: prefixMatch.destinationName,
      method: 'longest_prefix',
      reason: prefixMatch.isExact ? 'prefix:exact' : 'prefix:longest',
      confidence: prefixMatch.isExact ? 90 : 70,
    };
  }
  return { destinationId: null, destinationName: null, method: 'none', reason: 'unresolved', confidence: 0 };
}

import { db } from '../../db';
import { sql } from 'drizzle-orm';

export function normalizeAlias(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export interface AliasMatch {
  aliasId: number;
  destinationId: number;
  destinationName: string;
  aliasType: string;
  confidence: number;
}

export async function lookupAlias(vendorName: string): Promise<AliasMatch | null> {
  const key = normalizeAlias(vendorName);
  const result = await db.execute(sql`
    SELECT da.id, da.destination_id, gd.name AS destination_name,
           da.alias_type, da.confidence
    FROM destination_aliases da
    JOIN global_destinations gd ON gd.id = da.destination_id
    WHERE da.normalized_alias = ${key}
      AND da.is_active = TRUE
      AND gd.commercial_status <> 'blocked'
    ORDER BY da.confidence DESC
    LIMIT 1
  `);
  if (!result.rows.length) return null;
  const row = result.rows[0] as {
    id: number; destination_id: number; destination_name: string;
    alias_type: string; confidence: number;
  };
  db.execute(sql`
    UPDATE destination_aliases SET last_used_at = NOW() WHERE id = ${row.id}
  `).catch(() => {});
  return {
    aliasId: row.id,
    destinationId: row.destination_id,
    destinationName: row.destination_name,
    aliasType: row.alias_type,
    confidence: row.confidence,
  };
}

export async function createAlias(params: {
  destinationId: number;
  aliasText: string;
  aliasType: 'sippy' | 'vendor' | 'customer' | 'legacy' | 'manual';
  source?: string;
  confidence?: number;
  createdBy?: string;
}): Promise<{ id: number } | { conflict: true; existingDestinationId: number }> {
  const key = normalizeAlias(params.aliasText);
  const existing = await db.execute(sql`
    SELECT destination_id FROM destination_aliases
    WHERE normalized_alias = ${key} AND alias_type = ${params.aliasType}
    LIMIT 1
  `);
  if (existing.rows.length) {
    const row = existing.rows[0] as { destination_id: number };
    return { conflict: true, existingDestinationId: row.destination_id };
  }
  const inserted = await db.execute(sql`
    INSERT INTO destination_aliases
      (destination_id, alias_text, alias_type, source, confidence, created_by)
    VALUES
      (${params.destinationId}, ${params.aliasText}, ${params.aliasType},
       ${params.source ?? null}, ${params.confidence ?? 100}, ${params.createdBy ?? null})
    RETURNING id
  `);
  return { id: (inserted.rows[0] as { id: number }).id };
}

import { db } from '../../db';
import { sql } from 'drizzle-orm';
import { resolveDestination } from './destination-resolver.service';

export async function matchSheetDestinations(sheetId: number): Promise<{
  matched: number; partial: number; unmatched: number; total: number;
}> {
  const rows = await db.execute(sql`
    SELECT id, normalized_prefix, destination
    FROM vendor_rate_normalized_prefixes
    WHERE sheet_id = ${sheetId} AND match_status = 'pending'
  `);

  let matched = 0, partial = 0, unmatched = 0;

  for (let i = 0; i < rows.rows.length; i += 200) {
    const batch = rows.rows.slice(i, i + 200) as {
      id: number; normalized_prefix: string; destination: string | null;
    }[];
    // Resolve all rows in batch first, then write atomically
    const batchUpdates: Array<{
      id: number; destinationId: number | null; destinationName: string | null;
      status: string; reason: string; confidence: number;
    }> = [];
    for (const row of batch) {
      const resolved = await resolveDestination(row.destination, row.normalized_prefix);
      const status =
        resolved.confidence >= 90 ? 'matched' :
        resolved.confidence > 0   ? 'partial' : 'unmatched';
      if (status === 'matched') matched++;
      else if (status === 'partial') partial++;
      else unmatched++;
      batchUpdates.push({
        id: row.id,
        destinationId: resolved.destinationId,
        destinationName: resolved.destinationName,
        status,
        reason: resolved.reason,
        confidence: resolved.confidence,
      });
    }
    // Write batch atomically
    await db.execute(sql`BEGIN`);
    for (const u of batchUpdates) {
      await db.execute(sql`
        UPDATE vendor_rate_normalized_prefixes SET
          destination_id   = ${u.destinationId},
          destination      = ${u.destinationName},
          match_status     = ${u.status},
          match_method     = ${u.reason},
          match_confidence = ${u.confidence}
        WHERE id = ${u.id}
      `);
    }
    await db.execute(sql`COMMIT`);
  }

  return { matched, partial, unmatched, total: rows.rows.length };
}

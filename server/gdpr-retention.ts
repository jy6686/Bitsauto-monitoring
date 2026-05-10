/**
 * GDPR Data Retention — background purge job
 *
 * Runs every hour. For each enabled retention policy it deletes rows from
 * the relevant table that are older than retentionDays and updates the
 * lastPurgedAt / purgedCount stats.
 *
 * CDRs live in the in-memory cdrCache (72 h rolling window managed by the
 * CDR poller) — no DB purge needed for that data type.
 */

import { db } from './db';
import { eq, lt } from 'drizzle-orm';
import type { IStorage } from './storage';

let _storage: IStorage | null = null;
let _timer: ReturnType<typeof setInterval> | null = null;

export function initGdprRetention(storage: IStorage): void {
  _storage = storage;
  if (_timer) clearInterval(_timer);
  _timer = setInterval(_tick, 60 * 60_000); // every hour
  setTimeout(_tick, 45_000);               // first run 45 s after boot
  console.log('[gdpr-retention] Started — checking every hour');
}

async function _tick(): Promise<void> {
  if (!_storage) return;
  try {
    const policies = await _storage.getDataRetentionPolicies();
    for (const policy of policies) {
      if (!policy.enabled) continue;
      const cutoff = new Date(Date.now() - policy.retentionDays * 86400_000);
      let deleted = 0;
      try {
        deleted = await _purge(policy.dataType, cutoff);
      } catch (err: any) {
        console.error(`[gdpr-retention] Purge "${policy.dataType}" failed:`, err?.message);
        continue;
      }
      if (deleted > 0) {
        console.log(`[gdpr-retention] Purged ${deleted} rows from ${policy.dataType} (older than ${policy.retentionDays}d)`);
      }
      await _storage.updateDataRetentionPolicy(policy.dataType, {
        lastPurgedAt:  new Date(),
        purgedCount:   (policy.purgedCount ?? 0) + deleted,
        updatedAt:     new Date(),
      });
    }
  } catch (err: any) {
    console.error('[gdpr-retention] Tick error:', err?.message);
  }
}

async function _purge(dataType: string, cutoff: Date): Promise<number> {
  // Lazy imports to avoid circular schema references at module load time
  if (dataType === 'fas_events') {
    const { fasEvents } = await import('../shared/schema');
    const result = await db.delete(fasEvents).where(lt(fasEvents.detectedAt, cutoff));
    return (result as any).rowCount ?? 0;
  }
  if (dataType === 'number_lookup') {
    const { numberLookupCache } = await import('../shared/schema');
    const result = await db.delete(numberLookupCache).where(lt(numberLookupCache.lookedUpAt, cutoff));
    return (result as any).rowCount ?? 0;
  }
  if (dataType === 'audit_log') {
    const { approvalAuditLog } = await import('../shared/schema');
    const result = await db.delete(approvalAuditLog).where(lt(approvalAuditLog.createdAt, cutoff));
    return (result as any).rowCount ?? 0;
  }
  return 0;
}

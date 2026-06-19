/**
 * Vendor ACD (Average Call Duration) Cache
 *
 * Computes ACD per vendor from the in-memory CDR cache and makes it available
 * to the vendor health engine without creating a circular import chain.
 */

interface AcdEntry { totalSecs: number; count: number }
const acdMap = new Map<string, AcdEntry>();
let lastRefreshedAt: Date | null = null;

/**
 * Refresh the ACD map from the current CDR cache snapshot.
 * Call this from routes.ts after the CDR warmup and each refresh cycle.
 */
export function refreshVendorAcds(
  cdrs: Array<{ vendor?: string | null; duration?: number | null }>,
): void {
  const work = new Map<string, AcdEntry>();
  for (const cdr of cdrs) {
    if (!cdr.vendor || cdr.duration == null || cdr.duration <= 0) continue;
    const key = String(cdr.vendor);
    const e = work.get(key) ?? { totalSecs: 0, count: 0 };
    e.totalSecs += cdr.duration;
    e.count++;
    work.set(key, e);
  }
  // Replace atomically
  acdMap.clear();
  for (const [k, v] of work) acdMap.set(k, v);
  lastRefreshedAt = new Date();
}

/**
 * Return average call duration in seconds for a vendor, or null if unknown.
 */
export function getVendorAcd(vendorName: string): number | null {
  const e = acdMap.get(vendorName);
  if (!e || e.count === 0) return null;
  return e.totalSecs / e.count;
}

export function getAcdRefreshedAt(): Date | null {
  return lastRefreshedAt;
}

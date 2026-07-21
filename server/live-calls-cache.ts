/**
 * live-calls-cache.ts — Shared Live Calls Cache
 *
 * A single mutable object that the background poller in routes.ts writes to
 * and routes-commercial.ts reads from — without an HTTP round-trip.
 *
 * Usage:
 *   routes.ts           → import { sharedLiveCallsCache, updateLiveCallsCache }
 *   routes-commercial.ts → import { sharedLiveCallsCache }
 *
 * The object is mutated in-place by updateLiveCallsCache() so that any module
 * that holds a reference to it always sees the latest data.
 */

export interface LiveCallEntry {
  accountId?:   string;
  clientName?:  string;
  callStatus?:  string;
  ccState?:     string;
  cli?:         string;
  cld?:         string;
  duration?:    number;
  connection?:  string;
  vendor?:      string;
  destCountry?: string;
  destFull?:    string;
  trunkClass?:  string;
  [key: string]: unknown;
}

export interface LiveCallsCache {
  calls: LiveCallEntry[];
  ts:    number;
}

export const sharedLiveCallsCache: LiveCallsCache = { calls: [], ts: 0 };

/**
 * Replaces the cache contents in-place.
 * Call this wherever routes.ts previously did `liveCallsCache = { calls, ts }`.
 */
export function updateLiveCallsCache(data: { calls: LiveCallEntry[]; ts: number }): void {
  sharedLiveCallsCache.calls = data.calls;
  sharedLiveCallsCache.ts    = data.ts;
}

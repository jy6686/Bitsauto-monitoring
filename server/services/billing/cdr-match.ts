/**
 * cdr-match.ts — Shared 3-tier CDR matching utility
 *
 * Extracted from call-governance billing reconciliation.
 * Used by: carrier recon, rating verification, AI assurance, invoice validation.
 *
 * Tier 1 — SIP Call-ID exact match  (100% deterministic)
 * Tier 2 — Vendor IP + time window  (immune to number translation)
 * Tier 3 — CLD suffix + CLI + time  (legacy fallback)
 */

export interface CdrRecord {
  callId?:    string;
  remoteIp?:  string;
  callee?:    string;
  caller?:    string;
  startTime?: string | Date | null;
  duration?:  number | null;
  cost?:      number | null;
  [key: string]: any;
}

export interface MatchOpts {
  callId?:    string;          // SIP Call-ID from vendor leg (Tier 1)
  remoteIp?:  string;          // vendor peer IP               (Tier 2)
  cld?:       string;          // dialed number (CLD)          (Tier 3)
  cli?:       string;          // calling party (CLI)          (Tier 3 tiebreaker)
  startMs?:   number;          // call start unix ms
  windowMs?:  number;          // time window for T2/T3 (default 10 min)
}

export interface MatchResult {
  matched:   CdrRecord | null;
  tier:      0 | 1 | 2 | 3;   // 0 = no match
}

const DEFAULT_WINDOW_MS = 10 * 60 * 1000;

function normalizeCallId(s: string | undefined | null): string {
  return (s ?? '').replace(/^<|>$/g, '').trim();
}

function lastDigits(s: string | undefined | null, n: number): string {
  return (s ?? '').replace(/\D/g, '').slice(-n);
}

/**
 * Match a single call against a CDR pool using 3-tier priority.
 *
 * @param pool   Array of CDR records to search (e.g. cdrCache values)
 * @param opts   Match parameters — provide as many as available for best tier
 */
export function matchCdr(pool: CdrRecord[], opts: MatchOpts): MatchResult {
  const windowMs  = opts.windowMs ?? DEFAULT_WINDOW_MS;
  const startMs   = opts.startMs ?? null;

  // ── Tier 1: SIP Call-ID exact match ──────────────────────────────────────
  if (opts.callId) {
    const needle = normalizeCallId(opts.callId);
    const found  = pool.find(c => {
      const hay = normalizeCallId(c.callId);
      return hay && hay === needle;
    }) ?? null;
    if (found) return { matched: found, tier: 1 };
  }

  // ── Tier 2: Vendor IP + time window ──────────────────────────────────────
  if (opts.remoteIp && startMs !== null) {
    const ipCandidates = pool.filter(c => {
      if (!c.remoteIp || c.remoteIp !== opts.remoteIp) return false;
      const cdrTs = c.startTime ? new Date(c.startTime as any).getTime() : null;
      return cdrTs !== null && Math.abs(cdrTs - startMs) <= windowMs;
    });
    if (ipCandidates.length >= 1) {
      const best = ipCandidates.reduce((a, b) => {
        const da = Math.abs(new Date(a.startTime as any).getTime() - startMs);
        const db = Math.abs(new Date(b.startTime as any).getTime() - startMs);
        return da <= db ? a : b;
      });
      return { matched: best, tier: 2 };
    }
  }

  // ── Tier 3: CLD suffix + CLI tiebreaker + time window ────────────────────
  if (opts.cld) {
    const destSuffix = lastDigits(opts.cld, 9);
    const cliSuffix  = lastDigits(opts.cli, 9);

    const candidates = pool.filter(c => {
      if (startMs !== null) {
        const cdrTs = c.startTime ? new Date(c.startTime as any).getTime() : null;
        if (cdrTs !== null && Math.abs(cdrTs - startMs) > windowMs) return false;
      }
      return lastDigits(c.callee, 9) === destSuffix;
    });

    if (candidates.length > 0) {
      const cliMatch = cliSuffix.length >= 6
        ? candidates.find(c => lastDigits(c.caller, 9) === cliSuffix) ?? null
        : null;
      const best = cliMatch ?? (startMs !== null
        ? candidates.reduce((a, b) => {
            const da = Math.abs(new Date(a.startTime as any).getTime() - startMs);
            const db = Math.abs(new Date(b.startTime as any).getTime() - startMs);
            return da <= db ? a : b;
          })
        : candidates[0]);
      return { matched: best, tier: 3 };
    }
  }

  return { matched: null, tier: 0 };
}

/**
 * Match a batch of calls against a CDR pool.
 * Returns per-call results with tier information.
 */
export function matchCdrBatch(
  pool: CdrRecord[],
  calls: Array<MatchOpts & { ref: string }>,
): Array<{ ref: string; matched: CdrRecord | null; tier: 0 | 1 | 2 | 3 }> {
  return calls.map(c => {
    const { ref, ...opts } = c;
    const result = matchCdr(pool, opts);
    return { ref, ...result };
  });
}

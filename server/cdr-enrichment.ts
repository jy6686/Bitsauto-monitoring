
/**
 * CDR Enrichment — country detection, trunk class, FAS, wrong number detection
 * 
 * Trunk class rules (by callee prefix):
 *   1x  → First Class
 *   2x  → Business Class
 *   7x  → Charlie
 *   else → Unknown
 *
 * FAS detection (any of):
 *   - answered (SIP 200) but PDD > fasMinPddSecs
 *   - answered (SIP 200) but billable duration < fasMaxBillSecs
 *   - vendor consistently shows answer with no real voice (pattern-based)
 *
 * Wrong number / invalid detection:
 *   - SIP 404 = wrong number
 *   - SIP 480 = switched off / temporarily unavailable
 *   - SIP 486 = busy (not wrong number — skip)
 *   - SIP 484 / 488 = invalid number / codec
 *   - Short billed duration < 3s with 200 = likely billed but no real answer
 */

import { parsePhoneNumberFromString } from 'libphonenumber-js';
import type { TrunkClass } from '@shared/schema';

// ── Trunk Class ────────────────────────────────────────────────────────────

export function detectTrunkClass(callee: string): TrunkClass {
  // Strip leading + if present, then check prefix digit
  const digits = callee.replace(/^\+/, '');
  if (digits.startsWith('1')) return 'first';
  if (digits.startsWith('2')) return 'business';
  if (digits.startsWith('7')) return 'charlie';
  return 'unknown';
}

// ── Country Detection ──────────────────────────────────────────────────────

export function detectCountry(number: string): string | null {
  if (!number) return null;
  try {
    // Ensure E.164 format for parsing
    const e164 = number.startsWith('+') ? number : `+${number}`;
    const parsed = parsePhoneNumberFromString(e164);
    if (parsed?.country) return parsed.country;
    return null;
  } catch {
    return null;
  }
}

// ── SIP Code → Fail Reason ─────────────────────────────────────────────────

export type FailReason = 'wrong_number' | 'switched_off' | 'invalid' | 'busy' | null;

export function sipCodeToFailReason(sipCode: number | null | undefined): FailReason {
  if (!sipCode) return null;
  if (sipCode === 404) return 'wrong_number';
  if (sipCode === 480 || sipCode === 408) return 'switched_off';
  if (sipCode === 484 || sipCode === 488 || sipCode === 503) return 'invalid';
  if (sipCode === 486 || sipCode === 600) return 'busy';
  return null;
}

// ── FAS Detection ──────────────────────────────────────────────────────────

export type FasResult = {
  isFas: boolean;
  reason: string;
};

export function detectFas(opts: {
  sipCode: number | null | undefined;
  pddSecs: number | null | undefined;
  billSecs: number | null | undefined;
  fasMinPddSecs: number;
  fasMaxBillSecs: number;
}): FasResult {
  const { sipCode, pddSecs, billSecs, fasMinPddSecs, fasMaxBillSecs } = opts;
  const isAnswered = sipCode === 200;

  if (!isAnswered) return { isFas: false, reason: '' };

  const reasons: string[] = [];

  if (pddSecs != null && pddSecs > fasMinPddSecs) {
    reasons.push(`high_pdd (${pddSecs.toFixed(1)}s > ${fasMinPddSecs}s)`);
  }
  if (billSecs != null && billSecs < fasMaxBillSecs && billSecs > 0) {
    reasons.push(`short_billed (${billSecs}s < ${fasMaxBillSecs}s)`);
  }

  return {
    isFas: reasons.length > 0,
    reason: reasons.join(', '),
  };
}

// ── Callback Detection ─────────────────────────────────────────────────────
// A "callback" is when: callee matches a recent caller in a short window

export function detectCallback(caller: string, callee: string, recentCallers: Set<string>): boolean {
  return recentCallers.has(callee) || recentCallers.has(caller);
}

// ── Enrich a single CDR row ────────────────────────────────────────────────

export type EnrichedCdr = {
  originCountry: string | null;
  termCountry: string | null;
  trunkClass: TrunkClass;
  failReason: FailReason;
  isFas: boolean;
  fasReason: string;
};

export function enrichCdr(opts: {
  caller: string;
  callee: string;
  sipCode?: number | null;
  pddSecs?: number | null;
  billSecs?: number | null;
  fasMinPddSecs: number;
  fasMaxBillSecs: number;
}): EnrichedCdr {
  const { caller, callee, sipCode, pddSecs, billSecs, fasMinPddSecs, fasMaxBillSecs } = opts;

  const originCountry = detectCountry(caller);
  const termCountry = detectCountry(callee);
  const trunkClass = detectTrunkClass(callee);
  const failReason = sipCodeToFailReason(sipCode);
  const { isFas, reason: fasReason } = detectFas({ sipCode, pddSecs, billSecs, fasMinPddSecs, fasMaxBillSecs });

  return { originCountry, termCountry, trunkClass, failReason, isFas, fasReason };
}

// ── Revenue / Cost / Profit ────────────────────────────────────────────────

export type RevenueSummary = {
  revenue: number;
  cost: number;
  profit: number;
  margin: number; // %
};

export function calcRevenueSummary(opts: {
  billSecs: number;
  clientRatePerMin: number;
  vendorRatePerMin: number;
}): RevenueSummary {
  const minutes = opts.billSecs / 60;
  const revenue = minutes * opts.clientRatePerMin;
  const cost = minutes * opts.vendorRatePerMin;
  const profit = revenue - cost;
  const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
  return { revenue, cost, profit, margin };
}

// ── ASR / ACD / PDD / Call-back ratio calculation ─────────────────────────

export type CallStats = {
  totalCalls: number;
  answeredCalls: number;
  asr: number;             // %
  acdSeconds: number;
  avgPdd: number;
  callbackRatio: number;  // %
  fasCount: number;
  wrongNumberCount: number;
  switchedOffCount: number;
};

export type CdrRow = {
  sipCode?: number | null;
  billSecs?: number | null;
  pddSecs?: number | null;
  isCallback?: boolean;
  isFas?: boolean;
  failReason?: string | null;
};

export function calcCallStats(cdrs: CdrRow[]): CallStats {
  const total = cdrs.length;
  const answered = cdrs.filter(c => c.sipCode === 200).length;
  const totalBillSecs = cdrs.reduce((s, c) => s + (c.billSecs ?? 0), 0);
  const totalPdd = cdrs.reduce((s, c) => s + (c.pddSecs ?? 0), 0);
  const callbacks = cdrs.filter(c => c.isCallback).length;
  const fas = cdrs.filter(c => c.isFas).length;
  const wrong = cdrs.filter(c => c.failReason === 'wrong_number').length;
  const switchedOff = cdrs.filter(c => c.failReason === 'switched_off').length;

  return {
    totalCalls: total,
    answeredCalls: answered,
    asr: total > 0 ? (answered / total) * 100 : 0,
    acdSeconds: answered > 0 ? totalBillSecs / answered : 0,
    avgPdd: total > 0 ? totalPdd / total : 0,
    callbackRatio: total > 0 ? (callbacks / total) * 100 : 0,
    fasCount: fas,
    wrongNumberCount: wrong,
    switchedOffCount: switchedOff,
  };
}

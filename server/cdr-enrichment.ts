
/**
 * CDR Enrichment — country detection, trunk class, FAS, wrong number detection
 * 
 * Trunk class rules (by Sippy account ID first digit):
 *   1xx → First Class  (e.g. account 192)
 *   2xx → Business Class (e.g. account 292)
 *   7xx → Charlie      (e.g. account 792)
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

/**
 * Detect trunk class from Sippy account ID (i_account).
 * The first digit of the account number determines the class:
 *   1xx → First Class   (e.g. account 192)
 *   2xx → Business Class (e.g. account 292)
 *   7xx → Charlie       (e.g. account 792)
 */
export function detectTrunkClass(accountId: string | number | null | undefined): TrunkClass {
  const s = String(accountId ?? '').trim();
  if (!s) return 'unknown';
  if (s.startsWith('1')) return 'first';
  if (s.startsWith('2')) return 'business';
  if (s.startsWith('7')) return 'charlie';
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
  fraudScore: number; // 0-100 composite score (higher = more suspicious)
};

/**
 * Composite FAS score formula (CDR-only adaptation of the reference document):
 *   40pts — zero_billed  : answered (200) but 0 seconds billed
 *   30pts — high_pdd     : PDD > fasMinPddSecs (suspiciously slow answer)
 *   20pts — short_billed : billed < fasMaxBillSecs but > 0 (nearly instant hang-up)
 *   15pts — early_answer : PDD < fasEarlyAnswerSecs (suspiciously instant answer — pre-answer billing)
 *   10pts — short_call   : billed < fasShortCallSecs (short call, minor indicator)
 * Max = 100 (capped).
 */
export function detectFas(opts: {
  sipCode: number | null | undefined;
  pddSecs: number | null | undefined;
  billSecs: number | null | undefined;
  fasMinPddSecs: number;
  fasMaxBillSecs: number;
  fasEarlyAnswerSecs?: number;
  fasShortCallSecs?: number;
}): FasResult {
  const {
    sipCode, pddSecs, billSecs, fasMinPddSecs, fasMaxBillSecs,
    fasEarlyAnswerSecs = 2, fasShortCallSecs = 10,
  } = opts;
  const isAnswered = sipCode === 200;

  if (!isAnswered) return { isFas: false, reason: '', fraudScore: 0 };

  const reasons: string[] = [];
  let score = 0;

  // Zero billed: 200 OK but 0 or null billing duration — strongest indicator
  if (billSecs != null && billSecs <= 0) {
    reasons.push('zero_billed');
    score += 40;
  }
  // High PDD: too slow to answer — wholesaler may be injecting fake ringback
  if (pddSecs != null && pddSecs > fasMinPddSecs) {
    reasons.push(`high_pdd`);
    score += 30;
  }
  // Short billed: answered but disconnected almost immediately
  if (billSecs != null && billSecs > 0 && billSecs < fasMaxBillSecs) {
    reasons.push('short_billed');
    score += 20;
  }
  // Early answer: PDD suspiciously low — possible pre-answer billing
  if (pddSecs != null && pddSecs < fasEarlyAnswerSecs && pddSecs >= 0) {
    reasons.push('early_answer');
    score += 15;
  }
  // Short call: not a hard FAS indicator but adds to pattern
  if (billSecs != null && billSecs > 0 && billSecs < fasShortCallSecs &&
      !reasons.includes('short_billed')) {
    reasons.push('short_call');
    score += 10;
  }

  const fraudScore = Math.min(100, score);
  return {
    isFas: reasons.some(r => ['zero_billed', 'high_pdd', 'short_billed'].includes(r)),
    reason: reasons.join(','),
    fraudScore,
  };
}

// ── Vendor Fraud Score ──────────────────────────────────────────────────────

export type VendorFraudStats = {
  vendor: string;
  totalCalls: number;
  answeredCalls: number;
  fasCount: number;        // hard FAS events
  zeroBilledCount: number;
  earlyAnswerCount: number;
  shortCallCount: number;
  highPddCount: number;
  avgPdd: number;
  avgBillSecs: number;
  fasRate: number;         // %
  shortCallRate: number;   // %
  zeroBilledRate: number;  // %
  earlyAnswerRate: number; // %
  fraudScore: number;      // 0-100 vendor-level aggregate
  riskLevel: 'green' | 'yellow' | 'red';
};

export function calcVendorFraudStats(
  vendor: string,
  cdrs: Array<{ sipCode?: number | null; pddSecs?: number | null; billSecs?: number | null; reason?: string; isFas?: boolean; fraudScore?: number }>,
): VendorFraudStats {
  const total = cdrs.length;
  const answered = cdrs.filter(c => c.sipCode === 200).length;
  const fasCount = cdrs.filter(c => c.isFas).length;
  const zeroBilledCount = cdrs.filter(c => c.reason?.includes('zero_billed')).length;
  const earlyAnswerCount = cdrs.filter(c => c.reason?.includes('early_answer')).length;
  const shortCallCount = cdrs.filter(c => c.reason?.includes('short_call') || c.reason?.includes('short_billed')).length;
  const highPddCount = cdrs.filter(c => c.reason?.includes('high_pdd')).length;
  const totalPdd = cdrs.reduce((s, c) => s + (c.pddSecs ?? 0), 0);
  const totalBill = cdrs.reduce((s, c) => s + (c.billSecs ?? 0), 0);
  const avgFraudScore = total > 0 ? cdrs.reduce((s, c) => s + (c.fraudScore ?? 0), 0) / total : 0;

  const fasRate = answered > 0 ? (fasCount / answered) * 100 : 0;
  const shortCallRate = answered > 0 ? (shortCallCount / answered) * 100 : 0;
  const zeroBilledRate = answered > 0 ? (zeroBilledCount / answered) * 100 : 0;
  const earlyAnswerRate = answered > 0 ? (earlyAnswerCount / answered) * 100 : 0;

  // Vendor-level fraud score (weighted average of per-call scores, boosted by high rates)
  let vendorScore = avgFraudScore;
  if (fasRate > 30) vendorScore = Math.min(100, vendorScore + 20);
  if (zeroBilledRate > 20) vendorScore = Math.min(100, vendorScore + 15);
  vendorScore = Math.min(100, Math.round(vendorScore));

  const riskLevel: 'green' | 'yellow' | 'red' =
    vendorScore >= 50 ? 'red' : vendorScore >= 20 ? 'yellow' : 'green';

  return {
    vendor, totalCalls: total, answeredCalls: answered,
    fasCount, zeroBilledCount, earlyAnswerCount, shortCallCount, highPddCount,
    avgPdd: total > 0 ? totalPdd / total : 0,
    avgBillSecs: total > 0 ? totalBill / total : 0,
    fasRate, shortCallRate, zeroBilledRate, earlyAnswerRate,
    fraudScore: vendorScore, riskLevel,
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
  fraudScore: number;
};

export function enrichCdr(opts: {
  caller: string;
  callee: string;
  accountId?: string | number | null;
  sipCode?: number | null;
  pddSecs?: number | null;
  billSecs?: number | null;
  fasMinPddSecs: number;
  fasMaxBillSecs: number;
  fasEarlyAnswerSecs?: number;
  fasShortCallSecs?: number;
}): EnrichedCdr {
  const { caller, callee, accountId, sipCode, pddSecs, billSecs,
          fasMinPddSecs, fasMaxBillSecs, fasEarlyAnswerSecs, fasShortCallSecs } = opts;

  const originCountry = detectCountry(caller);
  const termCountry = detectCountry(callee);
  const trunkClass = detectTrunkClass(accountId);
  const failReason = sipCodeToFailReason(sipCode);
  const { isFas, reason: fasReason, fraudScore } = detectFas({
    sipCode, pddSecs, billSecs, fasMinPddSecs, fasMaxBillSecs, fasEarlyAnswerSecs, fasShortCallSecs,
  });

  return { originCountry, termCountry, trunkClass, failReason, isFas, fasReason, fraudScore };
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

// ── IRSF Detection ────────────────────────────────────────────────────────────
// International Revenue Share Fraud: calls to premium-rate / satellite / high-risk destinations
// where a fraudster earns a share of the termination revenue.
//
// Source of truth: GSMA IRSF Intelligence Sharing, i3Forum, known fraud destination lists.

export const IRSF_RISK_PREFIXES: Array<{
  prefix: string; country: string; breakout: string; riskLevel: 1|2|3
}> = [
  // === Satellite Numbers (level 3 — Highest Risk) ===
  { prefix: '870',  country: 'Inmarsat Satellite',    breakout: 'Satellite',        riskLevel: 3 },
  { prefix: '8816', country: 'Iridium Satellite',     breakout: 'Satellite',        riskLevel: 3 },
  { prefix: '8817', country: 'Iridium Satellite',     breakout: 'Satellite',        riskLevel: 3 },
  { prefix: '8818', country: 'Globalstar Satellite',  breakout: 'Satellite',        riskLevel: 3 },
  { prefix: '8819', country: 'Globalstar Satellite',  breakout: 'Satellite',        riskLevel: 3 },
  { prefix: '8821', country: 'Globalstar Satellite',  breakout: 'Satellite',        riskLevel: 3 },
  { prefix: '881',  country: 'Global Mobile Sat.',    breakout: 'Satellite',        riskLevel: 3 },
  // === Pacific Island Nations (level 3) ===
  { prefix: '674',  country: 'Nauru',                 breakout: 'Pacific Islands',  riskLevel: 3 },
  { prefix: '676',  country: 'Tonga',                 breakout: 'Pacific Islands',  riskLevel: 3 },
  { prefix: '678',  country: 'Vanuatu',               breakout: 'Pacific Islands',  riskLevel: 3 },
  { prefix: '680',  country: 'Palau',                 breakout: 'Pacific Islands',  riskLevel: 3 },
  { prefix: '682',  country: 'Cook Islands',          breakout: 'Pacific Islands',  riskLevel: 3 },
  { prefix: '683',  country: 'Niue',                  breakout: 'Pacific Islands',  riskLevel: 3 },
  { prefix: '686',  country: 'Kiribati',              breakout: 'Pacific Islands',  riskLevel: 3 },
  { prefix: '688',  country: 'Tuvalu',                breakout: 'Pacific Islands',  riskLevel: 3 },
  { prefix: '690',  country: 'Tokelau',               breakout: 'Pacific Islands',  riskLevel: 3 },
  { prefix: '692',  country: 'Marshall Islands',      breakout: 'Pacific Islands',  riskLevel: 3 },
  { prefix: '685',  country: 'Samoa',                 breakout: 'Pacific Islands',  riskLevel: 2 },
  { prefix: '691',  country: 'Micronesia',            breakout: 'Pacific Islands',  riskLevel: 2 },
  // === Africa High-Risk (level 2–3) ===
  { prefix: '239',  country: 'São Tomé & Príncipe',   breakout: 'Africa',           riskLevel: 3 },
  { prefix: '252',  country: 'Somalia',               breakout: 'Africa',           riskLevel: 3 },
  { prefix: '269',  country: 'Comoros',               breakout: 'Africa',           riskLevel: 3 },
  { prefix: '231',  country: 'Liberia',               breakout: 'Africa',           riskLevel: 2 },
  { prefix: '232',  country: 'Sierra Leone',          breakout: 'Africa',           riskLevel: 2 },
  { prefix: '245',  country: 'Guinea-Bissau',         breakout: 'Africa',           riskLevel: 2 },
  { prefix: '253',  country: 'Djibouti',              breakout: 'Africa',           riskLevel: 2 },
  { prefix: '291',  country: 'Eritrea',               breakout: 'Africa',           riskLevel: 2 },
  // === Caribbean Premium (level 1–2) ===
  { prefix: '1264', country: 'Anguilla',              breakout: 'Caribbean',        riskLevel: 2 },
  { prefix: '1649', country: 'Turks & Caicos',        breakout: 'Caribbean',        riskLevel: 2 },
  { prefix: '1664', country: 'Montserrat',            breakout: 'Caribbean',        riskLevel: 3 },
  { prefix: '1473', country: 'Grenada',               breakout: 'Caribbean',        riskLevel: 1 },
  { prefix: '1767', country: 'Dominica',              breakout: 'Caribbean',        riskLevel: 1 },
  { prefix: '1784', country: 'St. Vincent',           breakout: 'Caribbean',        riskLevel: 1 },
  // === Other High-Risk ===
  { prefix: '850',  country: 'North Korea',           breakout: 'Other',            riskLevel: 3 },
  { prefix: '53',   country: 'Cuba',                  breakout: 'Other',            riskLevel: 2 },
  { prefix: '679',  country: 'Fiji (premium)',         breakout: 'Pacific Islands',  riskLevel: 1 },
  { prefix: '677',  country: 'Solomon Islands',       breakout: 'Pacific Islands',  riskLevel: 2 },
];

export type IrsfResult = {
  isIrsf: boolean;
  riskPrefix: string | null;
  country: string | null;
  breakout: string | null;
  riskLevel: number;
  fraudScore: number;
};

/**
 * Check if a callee number matches a known IRSF-prone prefix.
 * Prefixes are sorted longest-first to ensure most-specific match wins.
 */
export function detectIrsf(callee: string): IrsfResult {
  const none: IrsfResult = { isIrsf: false, riskPrefix: null, country: null, breakout: null, riskLevel: 0, fraudScore: 0 };
  if (!callee) return none;
  // Strip leading + and non-digits, then re-normalize
  const digits = callee.replace(/^\+/, '').replace(/\D/g, '');
  if (!digits) return none;
  // Sort longest prefix first for most-specific match
  const sorted = [...IRSF_RISK_PREFIXES].sort((a, b) => b.prefix.length - a.prefix.length);
  for (const entry of sorted) {
    if (digits.startsWith(entry.prefix)) {
      const fraudScore = entry.riskLevel === 3 ? 90 : entry.riskLevel === 2 ? 65 : 40;
      return {
        isIrsf: true,
        riskPrefix: entry.prefix,
        country: entry.country,
        breakout: entry.breakout,
        riskLevel: entry.riskLevel,
        fraudScore,
      };
    }
  }
  return none;
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

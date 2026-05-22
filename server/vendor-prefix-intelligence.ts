// server/vendor-prefix-intelligence.ts
// Destination Prefix Intelligence — computes Q-scores per vendor × destination bucket
// using the in-memory CDR cache. Zero additional Sippy calls.

import { db } from "./db";
import { fasEvents } from "@shared/schema";
import { gte } from "drizzle-orm";
import type { SippyCDR } from "./sippy";

// ── E.164 Prefix Table ─────────────────────────────────────────────────────────
// Sorted longest-prefix-first at module load for greedy matching.
// Each entry: { prefix (digits only, no +), country, iso2, type, flag emoji }

interface PrefixEntry {
  prefix: string;
  country: string;
  iso2: string;
  type: 'mobile' | 'fixed' | 'special';
  flag: string;
}

const RAW_PREFIXES: PrefixEntry[] = [
  // ── United Kingdom ──
  { prefix: '447', country: 'United Kingdom', iso2: 'GB', type: 'mobile', flag: '🇬🇧' },
  { prefix: '44',  country: 'United Kingdom', iso2: 'GB', type: 'fixed',  flag: '🇬🇧' },
  // ── Pakistan ──
  { prefix: '923', country: 'Pakistan',       iso2: 'PK', type: 'mobile', flag: '🇵🇰' },
  { prefix: '92',  country: 'Pakistan',       iso2: 'PK', type: 'fixed',  flag: '🇵🇰' },
  // ── Bangladesh ──
  { prefix: '8801', country: 'Bangladesh',    iso2: 'BD', type: 'mobile', flag: '🇧🇩' },
  { prefix: '880',  country: 'Bangladesh',    iso2: 'BD', type: 'fixed',  flag: '🇧🇩' },
  // ── India ──
  { prefix: '917', country: 'India',          iso2: 'IN', type: 'mobile', flag: '🇮🇳' },
  { prefix: '918', country: 'India',          iso2: 'IN', type: 'mobile', flag: '🇮🇳' },
  { prefix: '919', country: 'India',          iso2: 'IN', type: 'mobile', flag: '🇮🇳' },
  { prefix: '91',  country: 'India',          iso2: 'IN', type: 'fixed',  flag: '🇮🇳' },
  // ── USA / Canada ──
  { prefix: '1',   country: 'North America',  iso2: 'US', type: 'fixed',  flag: '🇺🇸' },
  // ── Nigeria ──
  { prefix: '2347', country: 'Nigeria',       iso2: 'NG', type: 'mobile', flag: '🇳🇬' },
  { prefix: '2348', country: 'Nigeria',       iso2: 'NG', type: 'mobile', flag: '🇳🇬' },
  { prefix: '234',  country: 'Nigeria',       iso2: 'NG', type: 'fixed',  flag: '🇳🇬' },
  // ── UAE ──
  { prefix: '9715', country: 'UAE',           iso2: 'AE', type: 'mobile', flag: '🇦🇪' },
  { prefix: '971',  country: 'UAE',           iso2: 'AE', type: 'fixed',  flag: '🇦🇪' },
  // ── Saudi Arabia ──
  { prefix: '9665', country: 'Saudi Arabia',  iso2: 'SA', type: 'mobile', flag: '🇸🇦' },
  { prefix: '966',  country: 'Saudi Arabia',  iso2: 'SA', type: 'fixed',  flag: '🇸🇦' },
  // ── Afghanistan ──
  { prefix: '937', country: 'Afghanistan',    iso2: 'AF', type: 'mobile', flag: '🇦🇫' },
  { prefix: '938', country: 'Afghanistan',    iso2: 'AF', type: 'mobile', flag: '🇦🇫' },
  { prefix: '939', country: 'Afghanistan',    iso2: 'AF', type: 'mobile', flag: '🇦🇫' },
  { prefix: '93',  country: 'Afghanistan',    iso2: 'AF', type: 'fixed',  flag: '🇦🇫' },
  // ── Germany ──
  { prefix: '4915', country: 'Germany',       iso2: 'DE', type: 'mobile', flag: '🇩🇪' },
  { prefix: '4916', country: 'Germany',       iso2: 'DE', type: 'mobile', flag: '🇩🇪' },
  { prefix: '4917', country: 'Germany',       iso2: 'DE', type: 'mobile', flag: '🇩🇪' },
  { prefix: '49',   country: 'Germany',       iso2: 'DE', type: 'fixed',  flag: '🇩🇪' },
  // ── France ──
  { prefix: '336', country: 'France',         iso2: 'FR', type: 'mobile', flag: '🇫🇷' },
  { prefix: '337', country: 'France',         iso2: 'FR', type: 'mobile', flag: '🇫🇷' },
  { prefix: '33',  country: 'France',         iso2: 'FR', type: 'fixed',  flag: '🇫🇷' },
  // ── Netherlands ──
  { prefix: '316', country: 'Netherlands',    iso2: 'NL', type: 'mobile', flag: '🇳🇱' },
  { prefix: '31',  country: 'Netherlands',    iso2: 'NL', type: 'fixed',  flag: '🇳🇱' },
  // ── Italy ──
  { prefix: '393', country: 'Italy',          iso2: 'IT', type: 'mobile', flag: '🇮🇹' },
  { prefix: '39',  country: 'Italy',          iso2: 'IT', type: 'fixed',  flag: '🇮🇹' },
  // ── Spain ──
  { prefix: '346', country: 'Spain',          iso2: 'ES', type: 'mobile', flag: '🇪🇸' },
  { prefix: '347', country: 'Spain',          iso2: 'ES', type: 'mobile', flag: '🇪🇸' },
  { prefix: '34',  country: 'Spain',          iso2: 'ES', type: 'fixed',  flag: '🇪🇸' },
  // ── Australia ──
  { prefix: '614', country: 'Australia',      iso2: 'AU', type: 'mobile', flag: '🇦🇺' },
  { prefix: '61',  country: 'Australia',      iso2: 'AU', type: 'fixed',  flag: '🇦🇺' },
  // ── China ──
  { prefix: '861', country: 'China',          iso2: 'CN', type: 'mobile', flag: '🇨🇳' },
  { prefix: '862', country: 'China',          iso2: 'CN', type: 'mobile', flag: '🇨🇳' },
  { prefix: '86',  country: 'China',          iso2: 'CN', type: 'fixed',  flag: '🇨🇳' },
  // ── Turkey ──
  { prefix: '905', country: 'Turkey',         iso2: 'TR', type: 'mobile', flag: '🇹🇷' },
  { prefix: '90',  country: 'Turkey',         iso2: 'TR', type: 'fixed',  flag: '🇹🇷' },
  // ── Ethiopia ──
  { prefix: '2519', country: 'Ethiopia',      iso2: 'ET', type: 'mobile', flag: '🇪🇹' },
  { prefix: '251',  country: 'Ethiopia',      iso2: 'ET', type: 'fixed',  flag: '🇪🇹' },
  // ── Kenya ──
  { prefix: '2547', country: 'Kenya',         iso2: 'KE', type: 'mobile', flag: '🇰🇪' },
  { prefix: '254',  country: 'Kenya',         iso2: 'KE', type: 'fixed',  flag: '🇰🇪' },
  // ── South Africa ──
  { prefix: '277', country: 'South Africa',   iso2: 'ZA', type: 'mobile', flag: '🇿🇦' },
  { prefix: '278', country: 'South Africa',   iso2: 'ZA', type: 'mobile', flag: '🇿🇦' },
  { prefix: '279', country: 'South Africa',   iso2: 'ZA', type: 'mobile', flag: '🇿🇦' },
  { prefix: '27',  country: 'South Africa',   iso2: 'ZA', type: 'fixed',  flag: '🇿🇦' },
  // ── Egypt ──
  { prefix: '201', country: 'Egypt',          iso2: 'EG', type: 'mobile', flag: '🇪🇬' },
  { prefix: '20',  country: 'Egypt',          iso2: 'EG', type: 'fixed',  flag: '🇪🇬' },
  // ── Iraq ──
  { prefix: '9647', country: 'Iraq',          iso2: 'IQ', type: 'mobile', flag: '🇮🇶' },
  { prefix: '964',  country: 'Iraq',          iso2: 'IQ', type: 'fixed',  flag: '🇮🇶' },
  // ── Sweden ──
  { prefix: '467', country: 'Sweden',         iso2: 'SE', type: 'mobile', flag: '🇸🇪' },
  { prefix: '46',  country: 'Sweden',         iso2: 'SE', type: 'fixed',  flag: '🇸🇪' },
  // ── Norway ──
  { prefix: '474', country: 'Norway',         iso2: 'NO', type: 'mobile', flag: '🇳🇴' },
  { prefix: '479', country: 'Norway',         iso2: 'NO', type: 'mobile', flag: '🇳🇴' },
  { prefix: '47',  country: 'Norway',         iso2: 'NO', type: 'fixed',  flag: '🇳🇴' },
  // ── Denmark ──
  { prefix: '454', country: 'Denmark',        iso2: 'DK', type: 'mobile', flag: '🇩🇰' },
  { prefix: '455', country: 'Denmark',        iso2: 'DK', type: 'mobile', flag: '🇩🇰' },
  { prefix: '45',  country: 'Denmark',        iso2: 'DK', type: 'fixed',  flag: '🇩🇰' },
  // ── Russia ──
  { prefix: '79',  country: 'Russia',         iso2: 'RU', type: 'mobile', flag: '🇷🇺' },
  { prefix: '7',   country: 'Russia',         iso2: 'RU', type: 'fixed',  flag: '🇷🇺' },
  // ── Israel ──
  { prefix: '9725', country: 'Israel',        iso2: 'IL', type: 'mobile', flag: '🇮🇱' },
  { prefix: '972',  country: 'Israel',        iso2: 'IL', type: 'fixed',  flag: '🇮🇱' },
  // ── Thailand ──
  { prefix: '668', country: 'Thailand',       iso2: 'TH', type: 'mobile', flag: '🇹🇭' },
  { prefix: '66',  country: 'Thailand',       iso2: 'TH', type: 'fixed',  flag: '🇹🇭' },
  // ── Malaysia ──
  { prefix: '601', country: 'Malaysia',       iso2: 'MY', type: 'mobile', flag: '🇲🇾' },
  { prefix: '60',  country: 'Malaysia',       iso2: 'MY', type: 'fixed',  flag: '🇲🇾' },
  // ── Indonesia ──
  { prefix: '628', country: 'Indonesia',      iso2: 'ID', type: 'mobile', flag: '🇮🇩' },
  { prefix: '62',  country: 'Indonesia',      iso2: 'ID', type: 'fixed',  flag: '🇮🇩' },
  // ── Philippines ──
  { prefix: '639', country: 'Philippines',    iso2: 'PH', type: 'mobile', flag: '🇵🇭' },
  { prefix: '63',  country: 'Philippines',    iso2: 'PH', type: 'fixed',  flag: '🇵🇭' },
  // ── Sri Lanka ──
  { prefix: '947', country: 'Sri Lanka',      iso2: 'LK', type: 'mobile', flag: '🇱🇰' },
  { prefix: '94',  country: 'Sri Lanka',      iso2: 'LK', type: 'fixed',  flag: '🇱🇰' },
  // ── Morocco ──
  { prefix: '2126', country: 'Morocco',       iso2: 'MA', type: 'mobile', flag: '🇲🇦' },
  { prefix: '212',  country: 'Morocco',       iso2: 'MA', type: 'fixed',  flag: '🇲🇦' },
  // ── Brazil ──
  { prefix: '55',  country: 'Brazil',         iso2: 'BR', type: 'fixed',  flag: '🇧🇷' },
  // ── Mexico ──
  { prefix: '52',  country: 'Mexico',         iso2: 'MX', type: 'fixed',  flag: '🇲🇽' },
  // ── Portugal ──
  { prefix: '3519', country: 'Portugal',      iso2: 'PT', type: 'mobile', flag: '🇵🇹' },
  { prefix: '351',  country: 'Portugal',      iso2: 'PT', type: 'fixed',  flag: '🇵🇹' },
  // ── Belgium ──
  { prefix: '324', country: 'Belgium',        iso2: 'BE', type: 'mobile', flag: '🇧🇪' },
  { prefix: '32',  country: 'Belgium',        iso2: 'BE', type: 'fixed',  flag: '🇧🇪' },
  // ── Switzerland ──
  { prefix: '417', country: 'Switzerland',    iso2: 'CH', type: 'mobile', flag: '🇨🇭' },
  { prefix: '41',  country: 'Switzerland',    iso2: 'CH', type: 'fixed',  flag: '🇨🇭' },
  // ── Poland ──
  { prefix: '486', country: 'Poland',         iso2: 'PL', type: 'mobile', flag: '🇵🇱' },
  { prefix: '48',  country: 'Poland',         iso2: 'PL', type: 'fixed',  flag: '🇵🇱' },
];

// Sort longest-prefix-first for greedy matching
const PREFIX_TABLE = [...RAW_PREFIXES].sort((a, b) => b.prefix.length - a.prefix.length);

// ── Prefix resolver ────────────────────────────────────────────────────────────
function normalizeE164(raw: string): string {
  // Strip leading zeros, +, spaces, dashes
  return raw.replace(/^\+/, '').replace(/\D/g, '');
}

export function matchPrefix(callee: string): (PrefixEntry & { label: string }) | null {
  const digits = normalizeE164(callee);
  if (digits.length < 7) return null;
  for (const entry of PREFIX_TABLE) {
    if (digits.startsWith(entry.prefix)) {
      const label = `${entry.flag} ${entry.country} ${entry.type === 'mobile' ? 'Mobile' : entry.type === 'fixed' ? 'Fixed' : 'Special'}`;
      return { ...entry, label };
    }
  }
  return null;
}

// ── Q-Score computation ───────────────────────────────────────────────────────
function computeQ(asr: number, ner: number, fasRate: number, avgPdd: number): {
  q: number;
  components: { asr: number; ner: number; fas: number; pdd: number };
  status: 'pass' | 'warn' | 'fail';
} {
  const asrPts  = Math.round((asr  / 100) * 40);
  const nerPts  = Math.round((ner  / 100) * 30);
  // FAS inverted: 0% FAS = full 20pts, 100% FAS = 0pts
  const fasPts  = Math.round((1 - Math.min(1, fasRate)) * 20);
  // PDD: <2s perfect, ≥20s zero
  const pddNorm = Math.max(0, Math.min(1, 1 - (avgPdd - 2) / 18));
  const pddPts  = Math.round(pddNorm * 10);
  const q       = asrPts + nerPts + fasPts + pddPts;
  const status  = q >= 65 ? 'pass' : q >= 40 ? 'warn' : 'fail';
  return { q, components: { asr: asrPts, ner: nerPts, fas: fasPts, pdd: pddPts }, status };
}

// ── Types ─────────────────────────────────────────────────────────────────────
export interface PrefixBucketResult {
  label: string;
  country: string;
  iso2: string;
  flag: string;
  type: string;
  calls: number;
  answered: number;
  asr: number;
  ner: number;
  avgPdd: number;
  fasEvents: number;
  fasRate: number;
  q: number;
  components: { asr: number; ner: number; fas: number; pdd: number };
  status: 'pass' | 'warn' | 'fail';
  insufficient: boolean;
}

export interface VendorPrefixRow {
  vendor: string;
  totalCalls: number;
  overallQ: number;
  prefixes: PrefixBucketResult[];
}

export interface PrefixIntelligenceResult {
  generatedAt: string;
  windowHours: number;
  cdrCount: number;
  vendors: VendorPrefixRow[];
  heatmap: {
    countries: string[];
    countryFlags: Record<string, string>;
    rows: Array<{ vendor: string; scores: Record<string, number | null> }>;
  };
}

// ── Main computation ──────────────────────────────────────────────────────────
export async function computeVendorPrefixIntelligence(
  cdrCache: Map<string, SippyCDR>,
): Promise<PrefixIntelligenceResult> {
  const now    = Date.now();
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000);

  // ── Step 1: Load recent FAS events keyed by (vendor, prefix bucket) ─────────
  const recentFas = await db.select({
    vendor:   fasEvents.vendor,
    callee:   fasEvents.callee,
  }).from(fasEvents).where(gte(fasEvents.detectedAt, dayAgo));

  // FAS count per (vendor, country+type key)
  const fasMap = new Map<string, number>();
  for (const ev of recentFas) {
    if (!ev.vendor || !ev.callee) continue;
    const bucket = matchPrefix(ev.callee);
    if (!bucket) continue;
    const key = `${ev.vendor}||${bucket.country}||${bucket.type}`;
    fasMap.set(key, (fasMap.get(key) ?? 0) + 1);
  }

  // ── Step 2: Bucket CDRs by vendor × prefix ───────────────────────────────
  interface Accumulator {
    calls: number;
    answered: number;
    nerAnswered: number;  // answered && duration > 5s
    pddSum: number;
    pddCount: number;
    country: string;
    iso2: string;
    flag: string;
    type: string;
    label: string;
  }

  // key: "vendorName||country||type"
  const buckets = new Map<string, Accumulator>();
  // key: vendorName → total calls
  const vendorTotals = new Map<string, number>();

  let cdrCount = 0;
  const sinceMs = now - 24 * 60 * 60 * 1000;

  for (const c of Array.from(cdrCache.values())) {
    // Time filter (last 24h)
    const ts = c.startTime
      ? (typeof (c as any).startTime === 'number'
          ? (c as any).startTime * 1000
          : new Date(c.startTime as any).getTime())
      : 0;
    if (!ts || ts < sinceMs) continue;

    const vendor = (c as any).vendor as string | undefined;
    if (!vendor || vendor === 'Unknown') continue;

    const callee = c.callee ?? c.calleeIn ?? '';
    const bucket = matchPrefix(callee);
    if (!bucket) continue;

    const isAnswered = String(c.result) === '0' || Number(c.result) === 0;
    const dur        = Number(c.totalDuration ?? c.duration ?? 0);
    const pdd        = Number(c.pdd1xx ?? c.pdd ?? 0);

    const key = `${vendor}||${bucket.country}||${bucket.type}`;
    const acc = buckets.get(key) ?? {
      calls: 0, answered: 0, nerAnswered: 0, pddSum: 0, pddCount: 0,
      country: bucket.country, iso2: bucket.iso2, flag: bucket.flag,
      type: bucket.type, label: bucket.label,
    };

    acc.calls++;
    if (isAnswered) {
      acc.answered++;
      if (dur > 5) acc.nerAnswered++;
    }
    if (pdd > 0 && pdd < 60) { acc.pddSum += pdd; acc.pddCount++; }
    buckets.set(key, acc);

    vendorTotals.set(vendor, (vendorTotals.get(vendor) ?? 0) + 1);
    cdrCount++;
  }

  // ── Step 3: Build vendor × prefix results ───────────────────────────────
  const vendorMap = new Map<string, PrefixBucketResult[]>();

  for (const [key, acc] of Array.from(buckets) as Array<[string, Accumulator]>) {
    const parts  = key.split('||');
    const vendor = parts[0];
    const asr    = acc.calls > 0 ? Math.round((acc.answered / acc.calls) * 1000) / 10 : 0;
    const ner    = acc.calls > 0 ? Math.round((acc.nerAnswered / acc.calls) * 1000) / 10 : 0;
    const avgPdd = acc.pddCount > 0 ? Math.round((acc.pddSum / acc.pddCount) * 10) / 10 : 0;
    const fasCount = fasMap.get(key) ?? 0;
    const fasRate  = acc.calls > 0 ? fasCount / acc.calls : 0;
    const insufficient = acc.calls < 5;

    const qResult = computeQ(asr, ner, fasRate, avgPdd);

    const row: PrefixBucketResult = {
      label:       acc.label,
      country:     acc.country,
      iso2:        acc.iso2,
      flag:        acc.flag,
      type:        acc.type,
      calls:       acc.calls,
      answered:    acc.answered,
      asr,
      ner,
      avgPdd,
      fasEvents:   fasCount,
      fasRate:     Math.round(fasRate * 1000) / 10,
      q:           insufficient ? 0 : qResult.q,
      components:  qResult.components,
      status:      insufficient ? 'warn' : qResult.status,
      insufficient,
    };

    const existing = vendorMap.get(vendor) ?? [];
    existing.push(row);
    vendorMap.set(vendor, existing);
  }

  // ── Step 4: Assemble per-vendor rows ────────────────────────────────────
  const vendors: VendorPrefixRow[] = [];
  for (const [vendor, prefixes] of Array.from(vendorMap.entries())) {
    prefixes.sort((a, b) => b.calls - a.calls);
    const sufficientPrefixes = prefixes.filter(p => !p.insufficient);
    const totalCalls = vendorTotals.get(vendor) ?? 0;
    const overallQ = sufficientPrefixes.length > 0
      ? Math.round(sufficientPrefixes.reduce((s, p) => s + p.q * p.calls, 0) / sufficientPrefixes.reduce((s, p) => s + p.calls, 0))
      : 0;
    vendors.push({ vendor, totalCalls, overallQ, prefixes });
  }
  vendors.sort((a, b) => b.totalCalls - a.totalCalls);

  // ── Step 5: Build heatmap ────────────────────────────────────────────────
  // Top countries by total call volume across all vendors
  const countryVolume = new Map<string, number>();
  const countryFlags  = new Map<string, string>();
  for (const v of vendors) {
    for (const p of v.prefixes) {
      countryVolume.set(p.country, (countryVolume.get(p.country) ?? 0) + p.calls);
      countryFlags.set(p.country, p.flag);
    }
  }
  const topCountries = Array.from(countryVolume.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([c]) => c);

  const heatmapRows = vendors.map(v => {
    const scores: Record<string, number | null> = {};
    for (const country of topCountries) {
      const matching = v.prefixes.filter(p => p.country === country && !p.insufficient);
      if (matching.length === 0) {
        scores[country] = null;
      } else {
        const totalCalls = matching.reduce((s, p) => s + p.calls, 0);
        scores[country] = Math.round(matching.reduce((s, p) => s + p.q * p.calls, 0) / totalCalls);
      }
    }
    return { vendor: v.vendor, scores };
  });

  const flagsRecord: Record<string, string> = {};
  Array.from(countryFlags.entries()).forEach(([c, f]) => { flagsRecord[c] = f; });

  return {
    generatedAt: new Date().toISOString(),
    windowHours: 24,
    cdrCount,
    vendors,
    heatmap: {
      countries: topCountries,
      countryFlags: flagsRecord,
      rows: heatmapRows,
    },
  };
}

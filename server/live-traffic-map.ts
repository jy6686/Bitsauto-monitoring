// server/live-traffic-map.ts
// Carrier-grade live global telecom traffic map engine.
// Aggregates CDR cache → country-pair operational flows.
// NO new Sippy calls. Read-only against in-memory cache + DB.

import { matchPrefix } from "./vendor-prefix-intelligence";

// ── Country centroids [lon, lat] ───────────────────────────────────────────────
export const COUNTRY_COORDS: Record<string, [number, number]> = {
  GB: [-1.5,   53.0],  PK: [69.3,   30.4],  BD: [90.4,   23.7],
  IN: [78.9,   20.6],  US: [-97.0,  38.0],  NG: [8.7,    9.1],
  AE: [53.8,   23.4],  SA: [45.1,   23.9],  AF: [67.7,   33.9],
  DE: [10.5,   51.2],  FR: [2.2,    46.2],  NL: [5.3,    52.1],
  IT: [12.6,   42.5],  ES: [-3.7,   40.4],  AU: [133.8, -25.3],
  CN: [104.2,  35.9],  TR: [35.2,   38.9],  ET: [40.5,    9.1],
  KE: [37.9,   -0.8],  ZA: [25.1,  -29.0],  EG: [30.8,   26.8],
  IQ: [43.7,   33.2],  SE: [15.0,   60.1],  NO: [8.5,    60.5],
  DK: [10.0,   56.3],  RU: [105.3,  61.5],  IL: [34.9,   31.5],
  TH: [100.9,  15.9],  MY: [109.7,   4.2],  ID: [117.3,  -2.5],
  PH: [122.0,  12.9],  LK: [80.7,    7.9],  MA: [-7.1,   31.8],
  BR: [-54.8, -10.3],  MX: [-102.6, 23.6],  PT: [-8.2,   39.4],
  BE: [4.5,    50.5],  CH: [8.2,    46.8],  PL: [19.1,   52.1],
};

// ── Types ─────────────────────────────────────────────────────────────────────
export interface TrafficFlow {
  from:              string;
  to:                string;
  fromCode:          string;
  toCode:            string;
  fromLat:           number;
  fromLon:           number;
  toLat:             number;
  toLon:             number;
  destinationType:   string;
  direction:         string;          // "UK → Pakistan Mobile · Callntalk"
  calls:             number;
  concurrentCalls:   number;
  cps:               number;
  asr:               number;
  acd:               number;
  pdd:               number;
  qScore:            number;
  fasRisk:           number;          // 0–100 %
  fraudRisk:         boolean;
  degraded:          boolean;
  unstable:          boolean;
  health:            'healthy' | 'warning' | 'degraded' | 'fraud-risk' | 'unstable';
  topVendor:         string;
  vendorContribution: number;         // % of calls via topVendor
  topPrefix:         string;
  revenue:           number;
  trend:             'rising' | 'stable' | 'falling' | 'volatile';
  updatedAt:         string;
}

export interface TrafficMapResponse {
  flows:     TrafficFlow[];
  totals: {
    totalCalls:      number;
    totalRevenue:    number;
    avgAsr:          number;
    avgQScore:       number;
    degradedFlows:   number;
    fraudRiskFlows:  number;
  };
  updatedAt: string;
}

// ── 30-second in-memory cache ─────────────────────────────────────────────────
let _cache: TrafficMapResponse | null = null;
let _cacheAt = 0;
const CACHE_TTL = 30_000;

// ── Rolling call-count history for trend detection (6 windows = ~3 min) ───────
const _history = new Map<string, number[]>();
const MAX_HIST = 6;

// ── Q-Score formula — identical to vendor-prefix-intelligence computeQ ────────
function qScore(asr: number, ner: number, fasRate: number, avgPdd: number): number {
  const asrPts = Math.round((asr  / 100) * 40);
  const nerPts = Math.round((ner  / 100) * 30);
  const fasPts = Math.round((1 - Math.min(1, fasRate)) * 20);
  const pddN   = Math.max(0, Math.min(1, 1 - (avgPdd - 2) / 18));
  const pddPts = Math.round(pddN * 10);
  return asrPts + nerPts + fasPts + pddPts;
}

// ── Backend health classification ─────────────────────────────────────────────
function classifyHealth(q: number, fasRisk: number, fraudRisk: boolean): TrafficFlow['health'] {
  if (fraudRisk || fasRisk >= 30) return 'fraud-risk';
  if (q < 40)                     return 'degraded';
  if (q < 65 || fasRisk >= 15)    return 'warning';
  return 'healthy';
}

// ── Trend from rolling call-count history ─────────────────────────────────────
function trend(key: string, current: number): TrafficFlow['trend'] {
  const h = _history.get(key) ?? [];
  h.push(current);
  if (h.length > MAX_HIST) h.shift();
  _history.set(key, h);
  if (h.length < 3) return 'stable';
  const r  = h.slice(-3);
  const d1 = r[1] - r[0];
  const d2 = r[2] - r[1];
  const thr = Math.max(1, r[0] * 0.1);
  if (d1 > thr && d2 > thr)                     return 'rising';
  if (d1 < -thr && d2 < -thr)                   return 'falling';
  if (Math.sign(d1) !== Math.sign(d2) && Math.abs(d1) > thr) return 'volatile';
  return 'stable';
}

// ── Main aggregation function ─────────────────────────────────────────────────
export async function aggregateTrafficFlows(
  cdrCache:      Map<string, any>,
  vendorLookup:  (iConn: string | undefined) => string,
  fasEvtList:    any[],
): Promise<TrafficMapResponse> {
  const now = Date.now();
  if (_cache && now - _cacheAt < CACHE_TTL) return _cache;

  const TWO_HOURS = 2 * 60 * 60 * 1000;
  const cutoff    = now - TWO_HOURS;

  // Build FAS call-id set for fast lookup
  const fasCallIds = new Set<string>(
    fasEvtList.map((e: any) => e.callId ?? e.call_id).filter(Boolean),
  );

  type Acc = {
    fromCountry: string; toCountry: string; fromCode: string; toCode: string;
    destType: string;
    calls: number; answered: number;
    totalDuration: number; totalPdd: number; totalRevenue: number;
    vendors: Map<string, number>; prefixes: Map<string, number>;
    fasCount: number;
  };
  const flowMap = new Map<string, Acc>();

  for (const cdr of cdrCache.values()) {
    // Normalise Sippy timestamp "20240523T142500.000" → ISO
    const raw = cdr.startTime ?? '';
    const iso = raw.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/, '$1-$2-$3T$4:$5:$6');
    const ts  = iso ? new Date(iso).getTime() : 0;
    if (!ts || ts < cutoff) continue;

    const cli = (cdr.caller ?? cdr.callerIn ?? '').toString();
    const cld = (cdr.callee ?? cdr.calleeIn ?? '').toString();
    if (!cli || !cld) continue;

    const origin      = matchPrefix(cli);
    const destination = matchPrefix(cld);
    if (!origin || !destination) continue;
    if (!COUNTRY_COORDS[origin.iso2] || !COUNTRY_COORDS[destination.iso2]) continue;
    if (origin.iso2 === destination.iso2) continue; // skip domestic

    const key = `${origin.iso2}:${destination.iso2}:${destination.type}`;
    let acc = flowMap.get(key);
    if (!acc) {
      acc = {
        fromCountry: origin.country, toCountry: destination.country,
        fromCode: origin.iso2,       toCode: destination.iso2,
        destType: destination.type,
        calls: 0, answered: 0, totalDuration: 0, totalPdd: 0, totalRevenue: 0,
        vendors: new Map(), prefixes: new Map(), fasCount: 0,
      };
      flowMap.set(key, acc);
    }

    acc.calls++;
    const dur = cdr.duration ?? 0;
    if (dur > 0) acc.answered++;
    acc.totalDuration += dur;
    acc.totalPdd     += (cdr.pdd ?? 0);
    acc.totalRevenue += (cdr.cost ?? 0);

    const vendor = vendorLookup(cdr.iConnection != null ? String(cdr.iConnection) : undefined);
    acc.vendors.set(vendor, (acc.vendors.get(vendor) ?? 0) + 1);

    const pfx = cld.replace(/\D/g, '').slice(0, 6);
    acc.prefixes.set(pfx, (acc.prefixes.get(pfx) ?? 0) + 1);

    if (fasCallIds.has(cdr.callId)) acc.fasCount++;
  }

  const flows: TrafficFlow[] = [];

  for (const [key, acc] of flowMap) {
    if (acc.calls < 2) continue; // skip noise

    const [fromLon, fromLat] = COUNTRY_COORDS[acc.fromCode]!;
    const [toLon,   toLat  ] = COUNTRY_COORDS[acc.toCode]!;

    const asr     = acc.calls > 0 ? Math.round((acc.answered / acc.calls) * 100) : 0;
    const acd     = acc.answered > 0 ? Math.round(acc.totalDuration / acc.answered) : 0;
    const avgPdd  = acc.calls > 0 ? parseFloat((acc.totalPdd / acc.calls).toFixed(2)) : 0;
    const fasRate = acc.calls > 0 ? acc.fasCount / acc.calls : 0;
    const ner     = Math.min(100, asr + 5);
    const q       = qScore(asr, ner, fasRate, avgPdd);
    const fasRisk = Math.round(fasRate * 100);
    const fraudRisk = fasRisk >= 30;
    const health  = classifyHealth(q, fasRisk, fraudRisk);

    const topVendorEntry       = [...acc.vendors.entries()].sort((a, b) => b[1] - a[1])[0];
    const topVendor            = topVendorEntry?.[0] ?? 'Unknown';
    const vendorContribution   = topVendorEntry ? Math.round((topVendorEntry[1] / acc.calls) * 100) : 0;
    const topPrefixEntry       = [...acc.prefixes.entries()].sort((a, b) => b[1] - a[1])[0];
    const topPrefix            = topPrefixEntry?.[0] ?? '';

    const concurrentCalls = Math.max(1, Math.round(acc.calls * (5 / 120)));
    const cps             = parseFloat((concurrentCalls / 60).toFixed(2));

    const t = trend(key, acc.calls);

    const destLabel = acc.destType === 'mobile' ? 'Mobile' : acc.destType === 'fixed' ? 'Fixed' : 'Special';
    const direction = `${acc.fromCountry} → ${acc.toCountry} ${destLabel} · ${topVendor}`;

    flows.push({
      from: acc.fromCountry, to: acc.toCountry,
      fromCode: acc.fromCode, toCode: acc.toCode,
      fromLat, fromLon, toLat, toLon,
      destinationType: acc.destType,
      direction,
      calls: acc.calls,
      concurrentCalls,
      cps,
      asr,
      acd,
      pdd: avgPdd,
      qScore: q,
      fasRisk,
      fraudRisk,
      degraded:  health === 'degraded' || health === 'fraud-risk',
      unstable:  health === 'unstable' || health === 'warning',
      health,
      topVendor,
      vendorContribution,
      topPrefix,
      revenue: parseFloat(acc.totalRevenue.toFixed(4)),
      trend: t,
      updatedAt: new Date().toISOString(),
    });
  }

  flows.sort((a, b) => b.calls - a.calls);
  const topFlows = flows.slice(0, 100);

  const totals = {
    totalCalls:     topFlows.reduce((s, f) => s + f.calls, 0),
    totalRevenue:   parseFloat(topFlows.reduce((s, f) => s + f.revenue, 0).toFixed(4)),
    avgAsr:         topFlows.length > 0 ? Math.round(topFlows.reduce((s, f) => s + f.asr, 0)    / topFlows.length) : 0,
    avgQScore:      topFlows.length > 0 ? Math.round(topFlows.reduce((s, f) => s + f.qScore, 0) / topFlows.length) : 0,
    degradedFlows:  topFlows.filter(f => f.degraded).length,
    fraudRiskFlows: topFlows.filter(f => f.fraudRisk).length,
  };

  const result: TrafficMapResponse = { flows: topFlows, totals, updatedAt: new Date().toISOString() };
  _cache   = result;
  _cacheAt = now;
  return result;
}

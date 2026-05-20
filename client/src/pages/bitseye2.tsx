import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar,
} from "recharts";
import { ComposableMap, Geographies, Geography, Marker } from "react-simple-maps";
import { geoMercator } from "d3-geo";
import {
  Radio, Users, Wifi, Globe, Phone, GitBranch, Briefcase,
  BarChart2, ChevronDown, ChevronRight, RefreshCw,
  Activity, TrendingUp, Zap, ExternalLink, Map as MapIcon,
  Search, Star, Maximize2, Minimize2,
  AlertTriangle, Bell, BellOff, X as XIcon, Layers,
} from "lucide-react";
import { useLocation } from "wouter";

// ── Types ────────────────────────────────────────────────────────────────────
interface EntityRow {
  name: string; active: number; connected: number; routing: number; connectRate: number;
  lastSeen?: number; idle?: boolean; peakToday?: number; topVendor?: string; topVendorShare?: number; topVendorCount?: number;
}
interface IncidentAlert {
  id: number; entityType: string; entityName: string | null; severity: string;
  title: string; status: string; openedAt: string;
}
interface AnomalyAlert {
  id: number; vendor: string | null; metric: string; severity: string;
  currentValue: number; baselineMean: number; deviationSigma: number;
  resolved: boolean; detectedAt: string;
}
interface LiveSliceResponse {
  groupBy: string; entities: EntityRow[]; total: number; stale: boolean; lastUpdated: number;
}
interface CrossRow {
  name: string; active: number; connected: number; connectRate: number;
}
interface KamLiveEntry {
  id: number; name: string; orgRole: string | null;
  active: number; connected: number; routing: number; connectRate: number;
  clientCount: number;
  topClients: CrossRow[]; topVendors: CrossRow[]; topCountries: CrossRow[];
}
interface KamLiveResponse {
  kams: KamLiveEntry[]; stale: boolean; lastUpdated: number;
}
interface DestLookupResult {
  code: string; country: string; breakout: string; destination: string;
  activeCalls: number; connected: number;
}
interface TrafficEvent {
  ts: number; type: string; message: string; entity: string; dim: string; delta: number;
}
interface EntityDetail {
  dim: string; name: string;
  active: number; connected: number; routing: number; connectRate: number;
  topClients: CrossRow[]; topVendors: CrossRow[];
  topCountries: CrossRow[]; topDestinations: CrossRow[];
  entityHistory: { ts: number; count: number; connected: number; routing: number }[];
  lastSeen?: number; peakToday?: number; idle?: boolean;
  stale: boolean; lastUpdated: number;
}
interface LiveSummary {
  total: number; connected: number; routing: number;
  liveConnectRatio: number; avgCallAgeSecs: number;
  stale: boolean; lastUpdated: number;
}
interface ConcurrentPoint {
  ts: number; label: string; active: number; connected: number; routing: number;
}
interface ConcurrentTrend {
  points: ConcurrentPoint[];
  summary: {
    peakActive: number; currentActive: number; currentConnected: number;
    currentRouting: number; hasHistory: boolean;
  };
}

// ── World Map constants ───────────────────────────────────────────────────────
const GEO_URL = "/maps/world-110m.json";

const COUNTRY_COORDS: Record<string, [number, number]> = {
  'BANGLADESH':             [90.4,  23.8],
  'PAKISTAN':               [69.3,  30.4],
  'INDIA':                  [78.9,  20.6],
  'UNITED ARAB EMIRATES':   [53.8,  23.4],
  'UNITED KINGDOM':         [-1.5,  52.4],
  'SAUDI ARABIA':           [45.1,  23.9],
  'AFGHANISTAN':            [67.7,  33.9],
  'EGYPT':                  [30.8,  26.8],
  'NIGERIA':                [8.7,    9.1],
  'KENYA':                  [37.9,   0.0],
  'GHANA':                  [-1.0,   7.9],
  'ETHIOPIA':               [40.5,   9.1],
  'TANZANIA':               [34.9,  -6.4],
  'SOUTH AFRICA':           [25.1, -28.5],
  'ZIMBABWE':               [29.2, -19.0],
  'PHILIPPINES':            [121.8, 12.9],
  'INDONESIA':              [113.9, -0.8],
  'MALAYSIA':               [109.7,  4.2],
  'SRI LANKA':              [80.7,   7.9],
  'NEPAL':                  [84.1,  28.4],
  'MYANMAR':                [95.9,  17.1],
  'CAMBODIA':               [104.9, 12.6],
  'VIETNAM':                [108.3, 14.1],
  'THAILAND':               [100.5, 15.9],
  'TURKEY':                 [35.2,  38.9],
  'IRAN':                   [53.7,  32.4],
  'IRAQ':                   [43.7,  33.2],
  'JORDAN':                 [36.2,  31.2],
  'CHINA':                  [104.2, 35.9],
  'RUSSIA':                 [105.3, 61.5],
  'GERMANY':                [10.5,  51.2],
  'FRANCE':                 [2.3,   46.2],
  'UNITED STATES':          [-95.7, 37.1],
  'CANADA':                 [-96.8, 56.1],
  'AUSTRALIA':              [133.8,-25.3],
  'BRAZIL':                 [-51.9,-14.2],
  'MEXICO':                 [-102.5, 23.6],
  'OMAN':                   [57.6,  21.5],
  'KUWAIT':                 [47.5,  29.4],
  'BAHRAIN':                [50.5,  26.2],
  'QATAR':                  [51.2,  25.4],
  'LIBYA':                  [17.2,  26.3],
  'SUDAN':                  [30.0,  15.6],
  'SOMALIA':                [46.2,   6.1],
  'ANGOLA':                 [17.9, -11.2],
  'ZAMBIA':                 [27.8, -13.1],
  'MALAWI':                 [34.3, -13.3],
  'MOZAMBIQUE':             [35.5, -18.7],
  'SENEGAL':                [-14.5, 14.5],
  'CAMEROON':               [12.4,   5.7],
  'IVORY COAST':            [-5.6,   7.5],
  'GUINEA':                 [-11.8,  11.0],
  'SIERRA LEONE':           [-11.8,   8.6],
};

const GEO_TO_API: Record<string, string> = {
  'United States of America': 'UNITED STATES',
  'Korea, Republic of':       'SOUTH KOREA',
  'Viet Nam':                 'VIETNAM',
  'Russian Federation':       'RUSSIA',
  'Iran (Islamic Republic of)':'IRAN',
  'Syrian Arab Republic':     'SYRIA',
  'Lao PDR':                  'LAOS',
  'Myanmar':                  'MYANMAR',
  "Côte d'Ivoire":            'IVORY COAST',
  'Congo, Dem. Rep.':         'DEM. REP. CONGO',
  'Tanzania, United Rep. of': 'TANZANIA',
};

function getCountryColor(count: number): string {
  if (count === 0) return '#E8EDF5';
  if (count <= 2)  return '#FEF3C7';
  if (count <= 5)  return '#FCD34D';
  if (count <= 15) return '#F59E0B';
  if (count <= 40) return '#EF4444';
  return '#7C3AED';
}

// ── Animated rolling counter ──────────────────────────────────────────────────
function AnimatedNumber({ value }: { value: number }) {
  const [display, setDisplay] = useState(value);
  const displayRef = useRef(value);
  const rafRef     = useRef<number | null>(null);

  useEffect(() => {
    const from = displayRef.current;
    if (value === from) return;
    let startTs: number | null = null;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    function tick(now: number) {
      if (startTs === null) startTs = now;
      const t    = Math.min((now - startTs) / 520, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      const next = Math.round(from + (value - from) * ease);
      displayRef.current = next;
      setDisplay(next);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [value]);

  return <>{display}</>;
}

// ── Mini sparkline (sidebar entity rows) ─────────────────────────────────────
function MiniSparkline({ data, color, idle = false }: { data: number[]; color: string; idle?: boolean }) {
  if (data.length < 3) return null;
  const W = 38, H = 14;
  const max   = Math.max(...data) || 1;
  const min   = Math.min(...data);
  const range = (max - min) || 1;
  const pts   = data.map((v, i) => {
    const x = (i / (data.length - 1)) * W;
    const y = H - ((v - min) / range) * (H - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const tail   = data[data.length - 1] - data[Math.max(0, data.length - 4)];
  // Idle entities: always grey to signal "was active, now silent"
  // Active entities: green if climbing, red if falling, section color if stable
  const stroke = idle ? '#9CA3AF' : (tail > 0 ? '#16A34A' : tail < 0 ? '#EF4444' : color);
  const opacity = idle ? 0.45 : 0.85;
  // Last point pulse dot (only for active entities with history)
  const lastPt = data.length >= 2 ? pts.split(' ').pop()! : null;
  const [lx, ly] = lastPt ? lastPt.split(',').map(Number) : [W, H / 2];
  return (
    <svg width={W} height={H} style={{ flexShrink: 0, overflow: 'visible' }}>
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" opacity={opacity} />
      {!idle && data[data.length - 1] > 0 && (
        <circle cx={lx} cy={ly} r={2} fill={stroke} opacity={0.9}>
          <animate attributeName="opacity" values="0.9;0.3;0.9" dur="2s" repeatCount="indefinite" />
          <animate attributeName="r" values="2;3;2" dur="2s" repeatCount="indefinite" />
        </circle>
      )}
    </svg>
  );
}

// ── World Map ─────────────────────────────────────────────────────────────────
// Hub coordinate: Gulf/UAE — common carrier hub for South Asia VoIP traffic
const MAP_HUB: [number, number] = [55, 25];

function formatArcAge(lastSeen: number): string {
  const secs = Math.floor((Date.now() - lastSeen) / 1000);
  if (secs < 60)    return `${secs}s ago`;
  if (secs < 3600)  return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

// Routing concentration badge — derived from top-vendor share + vendor count
function diversityBadge(share?: number, vendorCount?: number): { label: string; color: string; bg: string } | null {
  if (share === undefined || !vendorCount) return null;
  if (vendorCount === 1 || share >= 88)   return { label: 'Single-route', color: '#F87171', bg: 'rgba(239,68,68,0.12)' };
  if (share >= 65)                         return { label: 'Dominant',     color: '#FBBF24', bg: 'rgba(251,191,36,0.12)' };
  if (share >= 35)                         return { label: 'Balanced',     color: '#34D399', bg: 'rgba(52,211,153,0.12)' };
  return                                          { label: 'Fragmented',   color: '#94A3B8', bg: 'rgba(148,163,184,0.12)' };
}

function WorldMap({
  entities, height = 360, onCountryClick,
}: {
  entities: EntityRow[]; height?: number; onCountryClick?: (name: string) => void;
}) {
  const [tooltip, setTooltip]       = useState<{ name: string; data?: EntityRow } | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [arcTooltip, setArcTooltip] = useState<{
    name: string; active: number; peak: number; cr: number; lastSeen?: number;
    topVendor?: string; topVendorShare?: number; topVendorCount?: number; state: 'active' | 'warm' | 'cooling' | 'historical';
  } | null>(null);
  const [mapError, setMapError]     = useState(false);
  const [mapWidth, setMapWidth]     = useState(800);
  const mapContainerRef             = useRef<HTMLDivElement>(null);

  // Track container width for accurate arc projection
  useEffect(() => {
    const el = mapContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setMapWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Pre-check that the local map file is reachable; show fallback if not
  useEffect(() => {
    fetch(GEO_URL, { method: 'HEAD' })
      .then(r => { if (!r.ok) setMapError(true); })
      .catch(() => setMapError(true));
  }, []);

  const countryMap = useMemo(() => {
    const m = new Map<string, EntityRow>();
    for (const e of entities) m.set(e.name.toUpperCase(), e);
    return m;
  }, [entities]);

  const pulseMarkers = useMemo(() =>
    entities
      .filter(e => e.active > 0)
      .map(e => ({ name: e.name, coords: COUNTRY_COORDS[e.name.toUpperCase()] ?? null, count: e.active, cr: e.connectRate }))
      .filter(m => m.coords !== null) as { name: string; coords: [number, number]; count: number; cr: number }[],
    [entities],
  );

  // Compute traffic flow arcs: hub → all country entities across full lifecycle
  const arcData = useMemo(() => {
    const proj = geoMercator().scale(120).center([20, 12]).translate([mapWidth / 2, height / 2]);
    const hub  = proj(MAP_HUB);
    if (!hub) return [];
    const now = Date.now();
    return entities.map(e => {
      const coords = COUNTRY_COORDS[e.name.toUpperCase()];
      if (!coords) return null;
      const dest = proj(coords as [number, number]);
      if (!dest) return null;
      const [sx, sy] = hub;
      const [dx, dy] = dest;
      const mx   = (sx + dx) / 2;
      const dist = Math.sqrt((dx - sx) ** 2 + (dy - sy) ** 2);
      const my   = (sy + dy) / 2 - dist * 0.28;
      const d    = `M ${sx.toFixed(1)} ${sy.toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${dx.toFixed(1)} ${dy.toFixed(1)}`;
      const arcLen = Math.round(dist * 1.3 + 40);
      // Thickness memory: blend current concurrency with historical peak
      // Prevents instant visual collapse when route goes idle
      const peak         = e.peakToday ?? e.active;
      const effectiveW   = e.active * 0.7 + peak * 0.3;
      const strokeWidth  = effectiveW <= 3 ? 0.8 : effectiveW <= 10 ? 1.3 : effectiveW <= 25 ? 1.9 : 2.8;
      // Lifecycle state classification
      const idleSecs = e.idle && e.lastSeen ? (now - e.lastSeen) / 1000 : 0;
      const state: 'active' | 'warm' | 'cooling' | 'historical' =
        e.active > 0   ? 'active'   :
        idleSecs < 1800  ? 'warm'     :   // < 30 min
        idleSecs < 7200  ? 'cooling'  :   // 30 min – 2 h
                           'historical';
      // Active arcs: colored by connect-rate; idle arcs: grey lifecycle
      const cr = e.connectRate;
      const strokeColor = state === 'active'
        ? (cr >= 70 ? '#10B981' : cr >= 40 ? '#F59E0B' : '#EF4444')
        : '#9CA3AF';
      return { name: e.name, d, strokeColor, strokeWidth, arcLen, count: e.active, cr, state, peak, lastSeen: e.lastSeen, topVendor: e.topVendor, topVendorShare: e.topVendorShare, topVendorCount: e.topVendorCount };
    }).filter(Boolean) as {
      name: string; d: string; strokeColor: string; strokeWidth: number;
      arcLen: number; count: number; cr: number; peak: number; lastSeen?: number;
      topVendor?: string; topVendorShare?: number; topVendorCount?: number; state: 'active' | 'warm' | 'cooling' | 'historical';
    }[];
  }, [entities, mapWidth, height]);

  const totalActive     = entities.reduce((s, e) => s + e.active, 0);
  const activeCountries = entities.filter(e => e.active > 0).length;

  return (
    <div
      ref={mapContainerRef}
      style={{ position: 'relative', background: '#F0F4FB', borderRadius: 16, border: '1px solid #E6EAF0', overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}
      onMouseMove={e => {
        const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
        setTooltipPos({ x: e.clientX - rect.left + 14, y: e.clientY - rect.top + 14 });
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px 0', position: 'absolute', top: 0, left: 0, right: 0, zIndex: 5 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <MapIcon style={{ width: 13, height: 13, color: '#6B7280' }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: '#374151' }}>Live Traffic Map</span>
          <span style={{ fontSize: 11, color: '#F59E0B', fontWeight: 700, marginLeft: 4 }}>
            {totalActive} calls · {activeCountries} {activeCountries === 1 ? 'country' : 'countries'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
          {[{ color: '#FCD34D', label: '1–5' }, { color: '#F59E0B', label: '6–15' }, { color: '#EF4444', label: '16–40' }, { color: '#7C3AED', label: '40+' }].map(({ color, label }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 9, color: '#9CA3AF' }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: color }} />{label}
            </div>
          ))}
        </div>
      </div>

      {mapError ? (
        /* Fallback: map file unavailable — show country counters only */
        <div style={{ height, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <div style={{ fontSize: 12, color: '#9CA3AF', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 16 }}>⚠</span> Map layer unavailable
          </div>
          {entities.filter(e => e.active > 0).length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 6, justifyContent: 'center', maxWidth: 400 }}>
              {entities.filter(e => e.active > 0).map(e => (
                <div
                  key={e.name}
                  onClick={() => onCountryClick?.(e.name)}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: '4px 10px', cursor: onCountryClick ? 'pointer' : 'default', fontSize: 11 }}
                >
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: getCountryColor(e.active), display: 'inline-block' }} />
                  <span style={{ color: '#374151', fontWeight: 600 }}>{e.name}</span>
                  <span style={{ color: '#6B7280' }}>{e.active}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <ComposableMap
          projection="geoMercator"
          projectionConfig={{ scale: 120, center: [20, 12] }}
          style={{ width: '100%', height }}
        >
          <Geographies geography={GEO_URL}>
            {({ geographies }) =>
              geographies.map(geo => {
                const geoName  = (geo.properties.name as string) ?? '';
                const apiName  = GEO_TO_API[geoName] ?? geoName.toUpperCase();
                const data     = countryMap.get(apiName);
                const count    = data?.active ?? 0;
                const isActive = count > 0;
                return (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    fill={getCountryColor(count)}
                    stroke={isActive ? '#fff' : '#D1D9E6'}
                    strokeWidth={isActive ? 1.2 : 0.35}
                    style={{
                      default: { outline: 'none' },
                      hover:   { outline: 'none', fill: isActive ? '#7C3AED' : '#CDD5E0', cursor: isActive ? 'pointer' : 'default' },
                      pressed: { outline: 'none', fill: '#6D28D9' },
                    }}
                    onMouseEnter={() => setTooltip({ name: geoName, data })}
                    onMouseLeave={() => setTooltip(null)}
                    onClick={() => { if (data && onCountryClick) onCountryClick(data.name); }}
                  />
                );
              })
            }
          </Geographies>

          {/* ── Traffic flow arcs: hub → destination countries (full lifecycle) ── */}
          <g>
            {arcData.map((arc, i) => {
              const { state, d, strokeColor, strokeWidth, arcLen } = arc;

              // Shared hover handlers — fired on the invisible hit-area path
              const hoverProps = {
                onMouseEnter: () => setArcTooltip({ name: arc.name, active: arc.count, peak: arc.peak, cr: arc.cr, lastSeen: arc.lastSeen, topVendor: arc.topVendor, topVendorShare: arc.topVendorShare, topVendorCount: arc.topVendorCount, state }),
                onMouseLeave: () => setArcTooltip(null),
              };

              if (state === 'historical') {
                // Very faint residual trace — non-interactive
                return (
                  <g key={arc.name} style={{ pointerEvents: 'none' }}>
                    <path d={d} fill="none" stroke="#9CA3AF" strokeWidth={0.6}
                      opacity={0.1} strokeLinecap="round" strokeDasharray="2 9" />
                  </g>
                );
              }

              if (state === 'cooling') {
                return (
                  <g key={arc.name} style={{ cursor: 'crosshair' }} {...hoverProps}>
                    <path d={d} fill="none" stroke="#9CA3AF" strokeWidth={strokeWidth * 0.55}
                      opacity={0.22} strokeLinecap="round" strokeDasharray="4 6" />
                    {/* Transparent wide hit-area for easy hover */}
                    <path d={d} fill="none" stroke="transparent" strokeWidth={12} />
                  </g>
                );
              }

              if (state === 'warm') {
                return (
                  <g key={arc.name} style={{ cursor: 'crosshair' }} {...hoverProps}>
                    <path d={d} fill="none" stroke="#9CA3AF" strokeWidth={strokeWidth * 0.75}
                      opacity={0.35} strokeLinecap="round" strokeDasharray="6 5" />
                    <path d={d} fill="none" stroke="#9CA3AF"
                      strokeWidth={strokeWidth * 0.85} opacity={0.6} strokeLinecap="round"
                      strokeDasharray={`${Math.max(8, Math.round(arcLen * 0.08))} ${arcLen}`}
                      style={{ animation: `be2-arc-flow ${4.8 + (i % 5) * 0.5}s linear infinite` }}
                    />
                    <path d={d} fill="none" stroke="transparent" strokeWidth={12} />
                  </g>
                );
              }

              // Active — full 3-layer: glow halo + base line + animated particle
              return (
                <g key={arc.name} style={{ cursor: 'crosshair' }} {...hoverProps}>
                  <path d={d} fill="none" stroke={strokeColor}
                    strokeWidth={strokeWidth + 1.5} opacity={0.08} strokeLinecap="round" />
                  <path d={d} fill="none" stroke={strokeColor}
                    strokeWidth={strokeWidth} opacity={0.38} strokeLinecap="round" />
                  <path d={d} fill="none" stroke={strokeColor}
                    strokeWidth={strokeWidth + 0.6} opacity={0.9} strokeLinecap="round"
                    strokeDasharray={`${Math.max(10, Math.round(arcLen * 0.12))} ${arcLen}`}
                    style={{ animation: `be2-arc-flow ${2.8 + (i % 5) * 0.35}s linear infinite` }}
                  />
                  <path d={d} fill="none" stroke="transparent" strokeWidth={14} />
                </g>
              );
            })}
          </g>

          {pulseMarkers.map(({ name, coords, count, cr }) => {
            const r1       = count <= 2 ? 3 : count <= 10 ? 5 : count <= 30 ? 7 : 10;
            const dotColor = cr >= 70 ? '#16A34A' : cr >= 40 ? '#F59E0B' : '#EF4444';
            return (
              <Marker key={name} coordinates={coords}>
                <circle r={r1 * 2} fill={dotColor} opacity={0.18} style={{ animation: `be2-pulse ${1.8 + (count % 5) * 0.2}s infinite` }} />
                <circle r={r1}     fill={dotColor} opacity={0.85} style={{ animation: `be2-pulse ${1.8 + (count % 5) * 0.2}s infinite` }} />
                {count > 3 && (
                  <text textAnchor="middle" y={-(r1 + 5)} style={{ fontSize: 9, fontWeight: 700, fill: '#1F2937', paintOrder: 'stroke', stroke: '#fff', strokeWidth: 2 }}>
                    {count}
                  </text>
                )}
              </Marker>
            );
          })}
        </ComposableMap>
      )}

      {/* Country / geography hover tooltip */}
      <AnimatePresence>
        {tooltip && (
          <motion.div
            initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.1 }}
            style={{ position: 'absolute', left: tooltipPos.x, top: tooltipPos.y, background: '#1F2937', color: '#fff', borderRadius: 10, padding: '8px 12px', fontSize: 12, pointerEvents: 'none', zIndex: 20, minWidth: 155, boxShadow: '0 4px 20px rgba(0,0,0,0.25)' }}
          >
            <div style={{ fontWeight: 700, marginBottom: 4 }}>{tooltip.name}</div>
            {tooltip.data
              ? <>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <span style={{ color: '#60A5FA', fontWeight: 600 }}>{tooltip.data.active} active</span>
                    <span style={{ color: '#34D399' }}>✓ {tooltip.data.connected}</span>
                    <span style={{ color: '#FCD34D' }}>⟳ {tooltip.data.routing}</span>
                  </div>
                  <div style={{ color: '#9CA3AF', marginTop: 2 }}>{tooltip.data.connectRate}% connected{onCountryClick ? ' · click to drill in' : ''}</div>
                </>
              : <div style={{ color: '#6B7280' }}>No active traffic</div>
            }
          </motion.div>
        )}
      </AnimatePresence>

      {/* Arc hover card — route detail for active / warm / cooling arcs */}
      <AnimatePresence>
        {arcTooltip && !tooltip && (
          <motion.div
            key={arcTooltip.name}
            initial={{ opacity: 0, scale: 0.92, y: -4 }}
            animate={{ opacity: 1,  scale: 1,    y: 0 }}
            exit={{ opacity: 0, scale: 0.92 }}
            transition={{ duration: 0.12 }}
            style={{
              position: 'absolute', left: tooltipPos.x, top: tooltipPos.y,
              background: '#111827', color: '#fff', borderRadius: 12,
              padding: '11px 14px', fontSize: 12, pointerEvents: 'none',
              zIndex: 25, minWidth: 195, boxShadow: '0 6px 28px rgba(0,0,0,0.40)',
              border: '1px solid rgba(255,255,255,0.07)',
            }}
          >
            {/* Header: name + state badge */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 }}>
              <span style={{ fontWeight: 700, fontSize: 13 }}>{arcTooltip.name}</span>
              <span style={{
                fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6,
                padding: '2px 7px', borderRadius: 5,
                color:      arcTooltip.state === 'active'  ? '#10B981' : arcTooltip.state === 'warm' ? '#F59E0B' : '#9CA3AF',
                background: arcTooltip.state === 'active'  ? 'rgba(16,185,129,0.13)' : arcTooltip.state === 'warm' ? 'rgba(245,158,11,0.13)' : 'rgba(156,163,175,0.13)',
              }}>{arcTooltip.state}</span>
            </div>

            {/* Metrics grid */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#6B7280' }}>Concurrent</span>
                <span style={{ fontWeight: 700, color: arcTooltip.active > 0 ? '#60A5FA' : '#4B5563', fontVariantNumeric: 'tabular-nums' }}>
                  {arcTooltip.active > 0 ? arcTooltip.active : '—'}
                </span>
              </div>
              {arcTooltip.peak > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: '#6B7280' }}>Peak today</span>
                  <span style={{ fontWeight: 600, color: '#A78BFA', fontVariantNumeric: 'tabular-nums' }}>{arcTooltip.peak}</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#6B7280' }}>Connect rate</span>
                <span style={{
                  fontWeight: 600, fontVariantNumeric: 'tabular-nums',
                  color: arcTooltip.cr >= 70 ? '#10B981' : arcTooltip.cr >= 40 ? '#F59E0B' : '#EF4444',
                }}>{arcTooltip.cr}%</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#6B7280' }}>Last active</span>
                <span style={{ fontWeight: 600, color: arcTooltip.active > 0 ? '#10B981' : '#E5E7EB' }}>
                  {arcTooltip.active > 0 ? 'now' : arcTooltip.lastSeen ? formatArcAge(arcTooltip.lastSeen) : '—'}
                </span>
              </div>
              {arcTooltip.topVendor && (() => {
                const badge = diversityBadge(arcTooltip.topVendorShare, arcTooltip.topVendorCount);
                return (
                  <>
                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', margin: '4px 0' }} />
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ color: '#6B7280' }}>Top vendor</span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5, maxWidth: 140, justifyContent: 'flex-end' }}>
                        <span style={{ fontWeight: 600, color: '#93C5FD', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {arcTooltip.topVendor}
                        </span>
                        {arcTooltip.topVendorShare !== undefined && (
                          <span style={{
                            fontSize: 9, fontWeight: 700, color: '#6366F1', flexShrink: 0,
                            background: 'rgba(99,102,241,0.15)', padding: '1px 5px', borderRadius: 4,
                            fontVariantNumeric: 'tabular-nums',
                          }}>{arcTooltip.topVendorShare}%</span>
                        )}
                      </span>
                    </div>
                    {badge && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 3 }}>
                        <span style={{ color: '#6B7280' }}>Concentration</span>
                        <span style={{
                          fontSize: 9, fontWeight: 800, letterSpacing: '0.06em',
                          color: badge.color, background: badge.bg,
                          padding: '1px 6px', borderRadius: 4, flexShrink: 0,
                        }}>{badge.label.toUpperCase()}</span>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Sidebar sections ──────────────────────────────────────────────────────────
type SectionId = 'noc' | 'clients' | 'vendors' | 'countries' | 'destinations' | 'routing' | 'kam';

// Which cross-dimension to show when a sidebar entity is expanded (live-only, from entity-detail)
const CROSS_DIM: Record<string, { rows: (d: EntityDetail) => CrossRow[]; targetSec: SectionId; label: string }> = {
  client:      { rows: d => d.topCountries,    targetSec: 'countries',    label: 'Countries' },
  vendor:      { rows: d => d.topClients,      targetSec: 'clients',      label: 'Clients'   },
  country:     { rows: d => d.topVendors,      targetSec: 'vendors',      label: 'Vendors'   },
  destination: { rows: d => d.topClients,      targetSec: 'clients',      label: 'Clients'   },
};

const SECTIONS: { id: SectionId; label: string; icon: any; dim: string | null; href?: string; color: string }[] = [
  { id: 'noc',          label: 'NOC Overview', icon: Radio,     dim: null,           color: '#2563EB' },
  { id: 'clients',      label: 'Clients',       icon: Users,     dim: 'client',       color: '#7C3AED' },
  { id: 'vendors',      label: 'Vendors',       icon: Wifi,      dim: 'vendor',       color: '#0891B2' },
  { id: 'countries',    label: 'Countries',     icon: Globe,     dim: 'country',      color: '#059669' },
  { id: 'destinations', label: 'Destinations',  icon: Phone,     dim: 'destination',  color: '#D97706' },
  { id: 'routing',      label: 'Routing',       icon: GitBranch, dim: null, href: '/routing-manager', color: '#6B7280' },
  { id: 'kam',          label: 'KAM View',      icon: Briefcase, dim: null,                           color: '#8B5CF6' },
];

function fmtDuration(secs: number) {
  if (!secs) return '—';
  const m = Math.floor(secs / 60), s = secs % 60;
  return `${m}m ${s}s`;
}
function fmtLastSeen(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 60_000);
  if (diff < 1)  return 'just now';
  if (diff < 60) return `${diff}m ago`;
  const h = Math.floor(diff / 60);
  if (h < 24)    return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Live Pill ─────────────────────────────────────────────────────────────────
function LivePill({ count, color }: { count: number; color: string }) {
  return (
    <motion.span
      key={count} initial={{ scale: count > 0 ? 1.22 : 1 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 380, damping: 22 }}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 3,
        background: count > 0 ? `${color}15` : '#F3F4F6',
        border: `1px solid ${count > 0 ? `${color}35` : '#E5E7EB'}`,
        borderRadius: 99, padding: '1px 7px', fontSize: 11, fontWeight: 700,
        color: count > 0 ? color : '#9CA3AF', minWidth: 26, justifyContent: 'center',
      }}
    >
      {count > 0 && <span style={{ width: 5, height: 5, borderRadius: '50%', background: color, display: 'inline-block', animation: 'be2-pulse 2.2s ease-in-out infinite' }} />}
      {count}
    </motion.span>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, color, icon: Icon, delay = 0, numericValue }: {
  label: string; value: string; sub?: string; color: string; icon: any; delay?: number; numericValue?: number;
}) {
  const suffix = numericValue !== undefined ? value.replace(/^[\d.]+/, '') : '';
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.28 }}
      whileHover={{ y: -2, boxShadow: '0 8px 24px rgba(0,0,0,0.09)' }}
      style={{ background: '#fff', border: '1px solid #E6EAF0', borderRadius: 14, padding: '14px 18px', flex: 1, minWidth: 0, boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
        <div style={{ width: 28, height: 28, borderRadius: 8, background: `${color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon style={{ width: 14, height: 14, color }} />
        </div>
        <span style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase' as const, letterSpacing: '0.07em' }}>{label}</span>
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color, letterSpacing: '-0.02em', lineHeight: 1 }}>
        {numericValue !== undefined
          ? <><AnimatedNumber value={Math.round(numericValue)} />{suffix}</>
          : value
        }
      </div>
      {sub && <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 3 }}>{sub}</div>}
    </motion.div>
  );
}

// ── Entity Card (grid view) ───────────────────────────────────────────────────
function EntityCard({ entity, color, onClick, selected = false, pinned = false, onPin, alertSeverity, alertLabel }: {
  entity: EntityRow; color: string; onClick: () => void; selected?: boolean; pinned?: boolean; onPin?: () => void;
  alertSeverity?: string; alertLabel?: string;
}) {
  const [hov, setHov] = useState(false);
  const alertColor = alertSeverity === 'critical' ? '#EF4444' : alertSeverity === 'high' ? '#F59E0B' : undefined;
  return (
    <motion.div
      whileHover={{ y: -2, boxShadow: '0 8px 20px rgba(0,0,0,0.09)' }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: selected ? `${color}07` : alertColor ? `${alertColor}08` : '#fff',
        border: `1.5px solid ${selected ? color : alertColor ? alertColor : '#E6EAF0'}`,
        borderRadius: 14, padding: '14px 16px', cursor: 'pointer',
        boxShadow: alertColor ? `0 0 0 1px ${alertColor}33, 0 2px 8px rgba(0,0,0,0.04)` : '0 2px 8px rgba(0,0,0,0.04)',
        position: 'relative',
      }}
    >
      {/* Alert badge */}
      {alertSeverity && alertColor && (
        <span
          title={alertLabel}
          style={{
            position: 'absolute', top: 8, left: 8,
            display: 'flex', alignItems: 'center', gap: 3,
            fontSize: 9, fontWeight: 700, color: alertColor,
            background: `${alertColor}18`, border: `1px solid ${alertColor}44`,
            borderRadius: 4, padding: '1px 5px', textTransform: 'uppercase' as const, letterSpacing: '0.04em',
          }}
        >
          <AlertTriangle style={{ width: 7, height: 7 }} />
          {alertSeverity}
        </span>
      )}
      {onPin && (hov || pinned) && (
        <button
          onClick={e => { e.stopPropagation(); onPin(); }}
          title={pinned ? 'Unpin' : 'Pin to top'}
          style={{ position: 'absolute', top: 8, right: 8, background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'flex' }}
        >
          <Star style={{ width: 12, height: 12, color: pinned ? '#F59E0B' : '#D1D5DB', fill: pinned ? '#F59E0B' : 'none' }} />
        </button>
      )}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, marginTop: alertSeverity ? 14 : 0 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#1F2937', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, maxWidth: 155 }}>
          {pinned && <span style={{ color: '#F59E0B', marginRight: 3, fontSize: 10 }}>★</span>}
          {entity.name}
        </span>
        <LivePill count={entity.active} color={color} />
      </div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 5, background: '#F0FDF4', color: '#16A34A', fontWeight: 600 }}>✓ {entity.connected}</span>
        <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 5, background: '#FFF7ED', color: '#D97706', fontWeight: 600 }}>⟳ {entity.routing}</span>
      </div>
      <div style={{ background: '#F3F4F6', borderRadius: 99, height: 4, overflow: 'hidden' }}>
        <motion.div
          initial={{ width: 0 }} animate={{ width: `${entity.connectRate}%` }} transition={{ duration: 0.6, ease: 'easeOut' }}
          style={{ height: '100%', borderRadius: 99, background: entity.connectRate >= 70 ? '#16A34A' : entity.connectRate >= 45 ? '#F59E0B' : '#EF4444' }}
        />
      </div>
      <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 4, textAlign: 'right' as const }}>{entity.connectRate}% connected</div>
    </motion.div>
  );
}

// ── Concurrent Chart ──────────────────────────────────────────────────────────
function ConcurrentChart({ points, color = '#2563EB', title, sub, height = 140 }: {
  points: ConcurrentPoint[]; color?: string; title?: string; sub?: string; height?: number;
}) {
  const gradId = `grad-${color.replace('#', '')}`;
  return (
    <div style={{ background: '#fff', border: '1px solid #E6EAF0', borderRadius: 16, padding: '16px 20px', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#1F2937' }}>{title ?? 'Concurrent Call Stream'}</div>
        {sub && <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>{sub}</div>}
      </div>
      {points.length === 0
        ? <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#D1D5DB', fontSize: 13 }}>Building live history…</div>
        : <ResponsiveContainer width="100%" height={height}>
            <AreaChart data={points} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={color} stopOpacity={0.22} />
                  <stop offset="95%" stopColor={color} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#9CA3AF' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10, fill: '#9CA3AF' }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ background: '#fff', border: '1px solid #E6EAF0', borderRadius: 10, fontSize: 12 }}
                formatter={(val: any, name: string) => [val, name === 'active' ? 'Active' : 'Connected']} />
              <Area type="monotone" dataKey="active"    stroke={color}   strokeWidth={2}   fill={`url(#${gradId})`} dot={false} isAnimationActive animationDuration={800} animationEasing="ease-out" />
              <Area type="monotone" dataKey="connected" stroke="#16A34A" strokeWidth={1.5} fill="transparent"       dot={false} strokeDasharray="4 2" isAnimationActive animationDuration={800} animationEasing="ease-out" />
            </AreaChart>
          </ResponsiveContainer>
      }
    </div>
  );
}

// ── Entity Intelligence Chart ─────────────────────────────────────────────────
// Replaces bare ConcurrentChart in entity detail view.
// Adds: Graph Span (LIVE / DAILY / WEEKLY), Graph Type (CALLS / ASR / MINUTES / COST / ACD),
//       historical bucket aggregation via /api/bitseye/entity-history, and a stats table.
const HIST_SPANS = [
  { id: 'live',   label: 'LIVE'   },
  { id: 'daily',  label: 'DAILY'  },
  { id: 'weekly', label: 'WEEKLY' },
] as const;
const HIST_TYPES = [
  { id: 'calls',   label: 'CALLS'   },
  { id: 'asr',     label: 'ASR'     },
  { id: 'minutes', label: 'MINUTES' },
  { id: 'cost',    label: 'COST'    },
  { id: 'acd',     label: 'ACD'     },
] as const;

type HistSpan = (typeof HIST_SPANS)[number]['id'];
type HistType = (typeof HIST_TYPES)[number]['id'];

interface HistPoint {
  ts: number; label: string;
  total: number; connected: number; routing?: number;
  asr: number; minutes: number; cost: number; acd: number;
}
interface HistResponse {
  points: HistPoint[];
  stats: { cur: number; min: number; max: number; avg: number };
  span: string; type: string;
}

function EntityIntelligenceChart({
  dim, entity, color = '#2563EB', livePoints,
}: {
  dim: string; entity: string; color?: string; livePoints: ConcurrentPoint[];
}) {
  const [span, setSpan] = useState<HistSpan>('live');
  const [type, setType] = useState<HistType>('calls');
  const gradId = `ent-grad-${color.replace('#', '')}`;

  const { data: hist, isFetching: histFetching } = useQuery<HistResponse>({
    queryKey: ['/api/bitseye/entity-history', dim, entity, span, type],
    queryFn: () =>
      fetch(`/api/bitseye/entity-history?dim=${dim}&entity=${encodeURIComponent(entity)}&span=${span}&type=${type}`)
        .then(r => r.json()),
    staleTime: span === 'live' ? 20_000 : 90_000,
    refetchInterval: span === 'live' ? 30_000 : 300_000,
    enabled: span !== 'live',  // live reads livePoints passed in — no fetch needed
  });

  const metricLabel = type === 'calls' ? 'Calls' : type === 'asr' ? 'ASR %' : type === 'minutes' ? 'Minutes' : type === 'cost' ? 'Cost ($)' : 'ACD (s)';

  // For LIVE span use passed-in ConcurrentPoints; for others map hist.points to chart-friendly shape
  const chartData = useMemo(() => {
    if (span === 'live') {
      return livePoints.map(p => ({ ...p, value: p.active, secondary: p.connected }));
    }
    return (hist?.points ?? []).map((p: HistPoint) => ({
      ts: p.ts, label: p.label,
      value:     type === 'calls' ? p.total : type === 'asr' ? p.asr : type === 'minutes' ? p.minutes : type === 'cost' ? p.cost : p.acd,
      secondary: type === 'calls' ? p.connected : undefined,
    }));
  }, [span, type, livePoints, hist]);

  const stats = span !== 'live' ? hist?.stats : null;
  const subLabel = span === 'live'
    ? (livePoints.length > 0 ? `${livePoints.length} snapshots · 45s interval` : 'Building live history…')
    : span === 'daily' ? 'Last 24h · hourly buckets' : 'Last 72h · 6h buckets';

  const isEmpty = chartData.length === 0;

  return (
    <div style={{ background: '#fff', border: '1px solid #E6EAF0', borderRadius: 16, padding: '16px 20px', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
      {/* ── Header row: title + selectors ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 12, flexWrap: 'wrap' as const }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#1F2937' }}>{entity} — {metricLabel}</div>
          <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>{subLabel}{histFetching && span !== 'live' ? ' · refreshing…' : ''}</div>
        </div>
        {/* Span pill group */}
        <div style={{ display: 'flex', gap: 1, background: '#F3F4F6', borderRadius: 8, padding: 2, flexShrink: 0 }}>
          {HIST_SPANS.map(s => (
            <button
              key={s.id}
              onClick={() => setSpan(s.id)}
              data-testid={`btn-hist-span-${s.id}`}
              style={{
                fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6, border: 'none', cursor: 'pointer',
                background: span === s.id ? '#fff' : 'transparent',
                color: span === s.id ? color : '#9CA3AF',
                boxShadow: span === s.id ? '0 1px 3px rgba(0,0,0,0.10)' : 'none',
                transition: 'all 0.15s',
              }}
            >{s.label}</button>
          ))}
        </div>
        {/* Type pill group */}
        <div style={{ display: 'flex', gap: 1, background: '#F3F4F6', borderRadius: 8, padding: 2, flexShrink: 0 }}>
          {HIST_TYPES.map(t => (
            <button
              key={t.id}
              onClick={() => { setType(t.id); if (span === 'live') setSpan('daily'); }}
              data-testid={`btn-hist-type-${t.id}`}
              style={{
                fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6, border: 'none', cursor: 'pointer',
                background: type === t.id ? '#fff' : 'transparent',
                color: type === t.id ? color : '#9CA3AF',
                boxShadow: type === t.id ? '0 1px 3px rgba(0,0,0,0.10)' : 'none',
                transition: 'all 0.15s',
              }}
            >{t.label}</button>
          ))}
        </div>
      </div>

      {/* ── Chart area ── */}
      {isEmpty
        ? (
          <div style={{ height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#D1D5DB', fontSize: 13 }}>
            {span === 'live' ? 'Building live history…' : histFetching ? 'Loading…' : 'No data for this period'}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={140}>
            <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={color} stopOpacity={0.22} />
                  <stop offset="95%" stopColor={color} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#9CA3AF' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10, fill: '#9CA3AF' }} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{ background: '#fff', border: '1px solid #E6EAF0', borderRadius: 10, fontSize: 12 }}
                formatter={(val: any, name: string) => [val, name === 'value' ? metricLabel : name === 'secondary' ? 'Connected' : name]}
              />
              <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2}
                fill={`url(#${gradId})`} dot={false} isAnimationActive animationDuration={600} animationEasing="ease-out" />
              {(type === 'calls') && (
                <Area type="monotone" dataKey="secondary" stroke="#16A34A" strokeWidth={1.5}
                  fill="transparent" dot={false} strokeDasharray="4 2" isAnimationActive animationDuration={600} animationEasing="ease-out" />
              )}
            </AreaChart>
          </ResponsiveContainer>
        )
      }

      {/* ── Stats table — shown for daily/weekly spans ── */}
      {stats && !isEmpty && (
        <div style={{ marginTop: 10, borderTop: '1px solid #F3F4F6', paddingTop: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr 1fr 1fr 1fr', gap: '4px 12px', fontSize: 11 }}>
            <div style={{ color: '#9CA3AF', fontWeight: 600 }}></div>
            {['Cur', 'Min', 'Max', 'Avg'].map(h => (
              <div key={h} style={{ color: '#9CA3AF', fontWeight: 600, textAlign: 'right' as const }}>{h}</div>
            ))}
            <div style={{ color: '#374151', fontWeight: 600 }}>{metricLabel}</div>
            {[stats.cur, stats.min, stats.max, stats.avg].map((v, i) => (
              <div key={i} style={{ color: '#1F2937', textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' }}>{v}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── CPS Chart ─────────────────────────────────────────────────────────────────
function CpsChart({ points, height = 100 }: { points: ConcurrentPoint[]; height?: number }) {
  const cpsData = useMemo(() =>
    points.slice(-20).map((p, i, arr) => {
      if (i === 0) return { label: p.label, cps: 0 };
      const prev   = arr[i - 1];
      const deltaMs = p.ts - prev.ts;
      const cps    = deltaMs > 0 ? parseFloat((Math.max(0, p.active - prev.active) / (deltaMs / 1000)).toFixed(2)) : 0;
      return { label: p.label, cps };
    }), [points]);

  return (
    <div style={{ background: '#fff', border: '1px solid #E6EAF0', borderRadius: 16, padding: '16px 20px', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#1F2937', marginBottom: 2 }}>CPS Monitor</div>
      <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 10 }}>Calls per second · surge detection</div>
      {cpsData.length < 2
        ? <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#D1D5DB', fontSize: 12 }}>Building CPS history…</div>
        : <ResponsiveContainer width="100%" height={height}>
            <BarChart data={cpsData} margin={{ top: 0, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#9CA3AF' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 9, fill: '#9CA3AF' }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ background: '#fff', border: '1px solid #E6EAF0', borderRadius: 8, fontSize: 11 }} formatter={(v: any) => [`${v} /s`, 'CPS']} />
              <Bar dataKey="cps" fill="#F59E0B" radius={[3, 3, 0, 0]} maxBarSize={20} isAnimationActive animationDuration={600} />
            </BarChart>
          </ResponsiveContainer>
      }
    </div>
  );
}

// ── Top-N mini table ──────────────────────────────────────────────────────────
function TopTable({ title, rows, color, onSeeAll }: {
  title: string; rows: { name: string; active: number }[]; color: string; onSeeAll: () => void;
}) {
  return (
    <div style={{ background: '#fff', border: '1px solid #E6EAF0', borderRadius: 14, padding: '14px 16px', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#374151' }}>{title}</span>
        <button onClick={onSeeAll} style={{ fontSize: 10, color, fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer' }}>See all →</button>
      </div>
      {rows.length === 0
        ? <div style={{ fontSize: 12, color: '#D1D5DB', textAlign: 'center' as const, padding: '12px 0' }}>No active calls</div>
        : rows.map((r, i) => {
            const pct = Math.round(r.active / (rows[0]?.active || 1) * 100);
            return (
              <div key={r.name} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: '#D1D5DB', minWidth: 14 }}>{i + 1}</span>
                <span style={{ fontSize: 12, color: '#374151', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{r.name}</span>
                <div style={{ width: 40, height: 3, background: '#F3F4F6', borderRadius: 99 }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 99 }} />
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, color, minWidth: 20, textAlign: 'right' as const }}>{r.active}</span>
              </div>
            );
          })
      }
    </div>
  );
}

// ── Cross-dimension table ─────────────────────────────────────────────────────
function CrossTable({ title, rows, color, onRowClick }: {
  title: string; rows: CrossRow[]; color: string; onRowClick?: (name: string) => void;
}) {
  if (rows.length === 0) return null;
  const max = rows[0]?.active || 1;
  return (
    <div style={{ background: '#fff', border: '1px solid #E6EAF0', borderRadius: 14, padding: '14px 16px', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 10 }}>{title}</div>
      {rows.map((r, i) => {
        const pct     = Math.round(r.active / max * 100);
        const crColor = r.connectRate >= 70 ? '#16A34A' : r.connectRate >= 45 ? '#F59E0B' : '#EF4444';
        return (
          <div
            key={r.name}
            onClick={() => onRowClick?.(r.name)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, cursor: onRowClick ? 'pointer' : 'default', padding: '3px 0', borderRadius: 6 }}
          >
            <span style={{ fontSize: 10, fontWeight: 700, color: '#D1D5DB', minWidth: 14 }}>{i + 1}</span>
            <span style={{ fontSize: 12, color: '#1F2937', flex: 1, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{r.name}</span>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: crColor, display: 'inline-block', flexShrink: 0 }} />
            <div style={{ width: 44, height: 3, background: '#F3F4F6', borderRadius: 99, flexShrink: 0 }}>
              <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 99 }} />
            </div>
            <span style={{ fontSize: 11, fontWeight: 700, color, minWidth: 22, textAlign: 'right' as const }}>{r.active}</span>
          </div>
        );
      })}
      <div style={{ fontSize: 10, color: '#D1D5DB', marginTop: 4 }}>
        Dot = connect-rate: <span style={{ color: '#16A34A' }}>■</span> ≥70%  <span style={{ color: '#F59E0B' }}>■</span> ≥45%  <span style={{ color: '#EF4444' }}>■</span> low
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function BitsEye2Page() {
  const [, navigate] = useLocation();
  const [activeSection, setActiveSection] = useState<SectionId>('noc');
  const [selectedEntity, setSelectedEntity] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<SectionId>>(
    new Set(['noc', 'clients', 'vendors', 'countries', 'destinations']),
  );

  // ── Feature state ─────────────────────────────────────────────────────────
  const [sidebarSearch, setSidebarSearch] = useState('');
  const [isFullscreen, setIsFullscreen]       = useState(false);
  const [attentionMode, setAttentionMode]     = useState(false);
  const [dismissedAlerts, setDismissedAlerts] = useState<Set<number>>(() => new Set());
  const [alertBarOpen, setAlertBarOpen]       = useState(true);
  const [destLookupQ, setDestLookupQ]         = useState('');
  const [wallboardSlide, setWallboardSlide]   = useState(0);
  const [sidebarExpanded, setSidebarExpanded] = useState<{ dim: string; name: string; sectionId: string } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Pinned entities per dimension — persisted in localStorage
  const [pins, setPins] = useState<Record<string, Set<string>>>(() => {
    try {
      const raw = localStorage.getItem('be2-pins');
      if (raw) {
        const obj = JSON.parse(raw) as Record<string, string[]>;
        return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, new Set(v)]));
      }
    } catch {}
    return { client: new Set<string>(), vendor: new Set<string>(), country: new Set<string>(), destination: new Set<string>() };
  });

  const togglePin = useCallback((dim: string, name: string) => {
    setPins(prev => {
      const dimSet = new Set(prev[dim] ?? []);
      dimSet.has(name) ? dimSet.delete(name) : dimSet.add(name);
      const next = { ...prev, [dim]: dimSet };
      try {
        localStorage.setItem('be2-pins', JSON.stringify(
          Object.fromEntries(Object.entries(next).map(([k, v]) => [k, [...v]]))
        ));
      } catch {}
      return next;
    });
  }, []);

  // Local entity history for sparklines (accumulated across poll cycles)
  const [entityHistLocal, setEntityHistLocal] = useState<Map<string, number[]>>(() => new Map());

  function toggleExpand(id: SectionId) {
    setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  // Fullscreen API
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  // Wallboard auto-rotation — cycles through Countries/Vendors/Clients/KAMs every 15s
  useEffect(() => {
    if (!isFullscreen) { setWallboardSlide(0); return; }
    const t = setInterval(() => setWallboardSlide(s => (s + 1) % 4), 15_000);
    return () => clearInterval(t);
  }, [isFullscreen]);

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }

  // ── Queries ───────────────────────────────────────────────────────────────
  const { data: liveSummary, isFetching: fetchSum } = useQuery<LiveSummary>({
    queryKey: ['/api/bitseye/live-summary'],
    queryFn: () => fetch('/api/bitseye/live-summary').then(r => r.json()),
    staleTime: 25_000, refetchInterval: 30_000,
  });
  const { data: concTrend, isFetching: fetchConc } = useQuery<ConcurrentTrend>({
    queryKey: ['/api/bitseye/concurrent-trend', 4],
    queryFn: () => fetch('/api/bitseye/concurrent-trend?hours=4&bucket=5').then(r => r.json()),
    staleTime: 25_000, refetchInterval: 30_000,
  });
  const { data: clientSlice } = useQuery<LiveSliceResponse>({
    queryKey: ['/api/bitseye/live-slice', 'client'],
    queryFn: () => fetch('/api/bitseye/live-slice?groupBy=client').then(r => r.json()),
    staleTime: 25_000, refetchInterval: 30_000,
  });
  const { data: vendorSlice } = useQuery<LiveSliceResponse>({
    queryKey: ['/api/bitseye/live-slice', 'vendor'],
    queryFn: () => fetch('/api/bitseye/live-slice?groupBy=vendor').then(r => r.json()),
    staleTime: 25_000, refetchInterval: 30_000,
  });
  const { data: countrySlice } = useQuery<LiveSliceResponse>({
    queryKey: ['/api/bitseye/live-slice', 'country'],
    queryFn: () => fetch('/api/bitseye/live-slice?groupBy=country').then(r => r.json()),
    staleTime: 25_000, refetchInterval: 30_000,
  });
  const { data: destSlice } = useQuery<LiveSliceResponse>({
    queryKey: ['/api/bitseye/live-slice', 'destination'],
    queryFn: () => fetch('/api/bitseye/live-slice?groupBy=destination').then(r => r.json()),
    staleTime: 25_000, refetchInterval: 30_000,
  });
  const { data: kamLive } = useQuery<KamLiveResponse>({
    queryKey: ['/api/bitseye/kam-live'],
    queryFn: () => fetch('/api/bitseye/kam-live').then(r => r.json()),
    staleTime: 25_000, refetchInterval: 30_000,
  });
  const { data: destLookup } = useQuery<{ results: DestLookupResult[] }>({
    queryKey: ['/api/bitseye/destination-lookup', destLookupQ],
    queryFn: () => fetch(`/api/bitseye/destination-lookup?q=${encodeURIComponent(destLookupQ)}`).then(r => r.json()),
    staleTime: 60_000,
    enabled: destLookupQ.trim().length >= 2,
  });
  const { data: trafficEvents } = useQuery<{ events: TrafficEvent[]; ts: number }>({
    queryKey: ['/api/bitseye/traffic-events'],
    queryFn: () => fetch('/api/bitseye/traffic-events').then(r => r.json()),
    staleTime: 40_000, refetchInterval: 45_000,
  });
  const { data: sidebarEntityDetail, isFetching: sidebarDetailFetching } = useQuery<EntityDetail>({
    queryKey: ['/api/bitseye/entity-detail', sidebarExpanded?.dim, sidebarExpanded?.name],
    queryFn: () => fetch(`/api/bitseye/entity-detail?dim=${sidebarExpanded!.dim}&name=${encodeURIComponent(sidebarExpanded!.name)}`).then(r => r.json()),
    staleTime: 25_000, refetchInterval: 30_000,
    enabled: !!sidebarExpanded,
  });

  const { data: incidentRows } = useQuery<IncidentAlert[]>({
    queryKey: ['/api/incidents'],
    queryFn: () => fetch('/api/incidents').then(r => r.json()),
    staleTime: 30_000, refetchInterval: 60_000,
  });
  const { data: anomalyRows } = useQuery<AnomalyAlert[]>({
    queryKey: ['/api/anomalies'],
    queryFn: () => fetch('/api/anomalies').then(r => r.json()),
    staleTime: 55_000, refetchInterval: 60_000,
  });

  const activeSec = SECTIONS.find(s => s.id === activeSection)!;

  const { data: entityDetail, isFetching: fetchDetail } = useQuery<EntityDetail>({
    queryKey: ['/api/bitseye/entity-detail', activeSec.dim, selectedEntity],
    queryFn: () =>
      fetch(`/api/bitseye/entity-detail?dim=${activeSec.dim}&name=${encodeURIComponent(selectedEntity!)}`).then(r => r.json()),
    staleTime: 20_000, refetchInterval: 30_000,
    enabled: !!selectedEntity && !!activeSec.dim,
  });

  const dimToSlice: Record<string, LiveSliceResponse | undefined> = {
    client: clientSlice, vendor: vendorSlice, country: countrySlice, destination: destSlice,
  };
  const activeDim  = activeSec.dim ? dimToSlice[activeSec.dim] : undefined;
  const cs         = concTrend?.summary;
  const concPoints = concTrend?.points ?? [];
  const isFetching = fetchSum || fetchConc || fetchDetail;

  // Accumulate local sparkline history on each poll cycle
  useEffect(() => {
    if (!clientSlice && !vendorSlice && !countrySlice && !destSlice) return;
    setEntityHistLocal(prev => {
      const next  = new Map(prev);
      const pairs: [string, LiveSliceResponse | undefined][] = [
        ['client', clientSlice], ['vendor', vendorSlice],
        ['country', countrySlice], ['destination', destSlice],
      ];
      let changed = false;
      for (const [dim, slice] of pairs) {
        if (!slice) continue;
        for (const ent of slice.entities) {
          const key  = `${dim}:${ent.name}`;
          const hist = next.get(key) ?? [];
          if (hist[hist.length - 1] === ent.active && hist.length > 0) continue;
          next.set(key, [...hist.slice(-7), ent.active]);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [clientSlice, vendorSlice, countrySlice, destSlice]);

  // Entity history → chart points
  const entityHistoryPts: ConcurrentPoint[] = useMemo(() =>
    (entityDetail?.entityHistory ?? []).map(p => ({
      ts: p.ts,
      label: new Date(p.ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
      active: p.count, connected: p.connected, routing: p.routing,
    })), [entityDetail],
  );

  // ── Alert / Anomaly derived state ─────────────────────────────────────────
  const RANK = (s: string) => s === 'critical' ? 3 : s === 'high' ? 2 : s === 'medium' ? 1 : 0;

  // Active (non-dismissed) incidents of severity critical or high
  const activeAlerts = useMemo(() =>
    (incidentRows ?? []).filter(r =>
      r.status === 'active' &&
      (r.severity === 'critical' || r.severity === 'high') &&
      !dismissedAlerts.has(r.id)
    ),
    [incidentRows, dismissedAlerts],
  );

  // Vendor name → worst unresolved anomaly in the last 4 h
  const anomalyByVendor = useMemo(() => {
    const cutoff = Date.now() - 4 * 60 * 60_000;
    const m = new Map<string, AnomalyAlert>();
    for (const a of anomalyRows ?? []) {
      if (a.resolved || !a.vendor) continue;
      if (new Date(a.detectedAt).getTime() < cutoff) continue;
      const ex = m.get(a.vendor);
      if (!ex || RANK(a.severity) > RANK(ex.severity)) m.set(a.vendor, a);
    }
    return m;
  }, [anomalyRows]);

  // Entity name (lowercased) → worst active incident
  const incidentByEntity = useMemo(() => {
    const m = new Map<string, IncidentAlert>();
    for (const inc of incidentRows ?? []) {
      if (inc.status !== 'active' || !inc.entityName) continue;
      const key = inc.entityName.toLowerCase();
      const ex  = m.get(key);
      if (!ex || RANK(inc.severity) > RANK(ex.severity)) m.set(key, inc);
    }
    return m;
  }, [incidentRows]);

  // Attention score: higher = float to top in Attention Mode
  function attentionScore(dim: string, name: string, active: number): number {
    const anomaly  = dim === 'vendor' ? anomalyByVendor.get(name) : undefined;
    const incident = incidentByEntity.get(name.toLowerCase());
    return (RANK(anomaly?.severity ?? '') + RANK(incident?.severity ?? '')) * 1000 + active;
  }

  // Sorted entity list for the grid panel when Attention Mode is on
  const sortedActiveDimEntities = useMemo(() => {
    const ents = activeDim?.entities ?? [];
    if (!attentionMode) return ents;
    return [...ents].sort((a, b) =>
      attentionScore(activeSec.dim ?? '', b.name, b.active) -
      attentionScore(activeSec.dim ?? '', a.name, a.active)
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDim, attentionMode, anomalyByVendor, incidentByEntity, activeSec]);

  // Cross-dim navigation
  function drillCross(dim: string, name: string) {
    const s = SECTIONS.find(s => s.dim === dim);
    if (s) { setActiveSection(s.id); setSelectedEntity(name); }
  }

  // Search across all dims
  const searchQuery = sidebarSearch.trim().toLowerCase();
  const searchResults = useMemo(() => {
    if (!searchQuery) return null;
    const out: { dim: string; sec: typeof SECTIONS[0]; entity: EntityRow }[] = [];
    for (const sec of SECTIONS) {
      if (!sec.dim) continue;
      const slice = dimToSlice[sec.dim];
      if (!slice) continue;
      for (const ent of slice.entities) {
        if (ent.name.toLowerCase().includes(searchQuery)) {
          out.push({ dim: sec.dim, sec, entity: ent });
        }
      }
    }
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, clientSlice, vendorSlice, countrySlice, destSlice]);

  // ── Sidebar ───────────────────────────────────────────────────────────────
  const sidebar = (
    <div style={{ width: 232, flexShrink: 0, borderRight: '1px solid #E6EAF0', background: '#FAFBFC', display: 'flex', flexDirection: 'column', overflowY: 'auto' as const }}>
      {/* Live counter header */}
      <div style={{ padding: '16px 14px 10px', borderBottom: '1px solid #E6EAF0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#16A34A', display: 'inline-block', animation: 'be2-pulse 2.2s ease-in-out infinite' }} />
          <span style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase' as const, letterSpacing: '0.08em' }}>BitsEye 2 · Live</span>
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, color: '#1F2937', letterSpacing: '-0.02em' }}>
          {cs?.currentActive !== undefined || liveSummary?.total !== undefined
            ? <AnimatedNumber value={cs?.currentActive ?? liveSummary?.total ?? 0} />
            : '—'
          }
          <span style={{ fontSize: 12, fontWeight: 500, color: '#9CA3AF', marginLeft: 5 }}>active calls</span>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          <span style={{ fontSize: 11, color: '#16A34A', fontWeight: 600 }}>✓ {cs?.currentConnected ?? liveSummary?.connected ?? '—'}</span>
          <span style={{ fontSize: 11, color: '#F59E0B', fontWeight: 600 }}>⟳ {cs?.currentRouting ?? liveSummary?.routing ?? '—'}</span>
        </div>
      </div>

      {/* Search box */}
      <div style={{ padding: '8px 10px', borderBottom: '1px solid #F3F4F6' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#F3F4F6', borderRadius: 8, padding: '5px 8px' }}>
          <Search style={{ width: 12, height: 12, color: '#9CA3AF', flexShrink: 0 }} />
          <input
            value={sidebarSearch}
            onChange={e => setSidebarSearch(e.target.value)}
            placeholder="Search entities…"
            data-testid="input-sidebar-search"
            style={{ border: 'none', background: 'none', outline: 'none', fontSize: 11, color: '#374151', width: '100%' }}
          />
          {sidebarSearch && (
            <button onClick={() => setSidebarSearch('')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', color: '#9CA3AF' }}>
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Nav list */}
      <div style={{ flex: 1, padding: '4px 0', overflowY: 'auto' as const }}>
        {searchResults ? (
          /* Search results */
          <>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', padding: '6px 14px 3px', textTransform: 'uppercase' as const, letterSpacing: '0.06em' }}>
              {searchResults.length} result{searchResults.length !== 1 ? 's' : ''}
            </div>
            {searchResults.length === 0 && (
              <div style={{ fontSize: 12, color: '#D1D5DB', padding: '16px 14px' }}>No entities found</div>
            )}
            {searchResults.map(({ dim, sec, entity }) => (
              <motion.div
                key={`${dim}:${entity.name}`} whileHover={{ background: '#F3F4F6' }}
                onClick={() => { setActiveSection(sec.id); setSelectedEntity(entity.name); setSidebarSearch(''); }}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', cursor: 'pointer' }}
              >
                <sec.icon style={{ width: 11, height: 11, color: sec.color, flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: '#374151', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{entity.name}</span>
                <MiniSparkline data={entityHistLocal.get(`${dim}:${entity.name}`) ?? []} color={sec.color} idle={entity.idle} />
                <LivePill count={entity.active} color={sec.color} />
              </motion.div>
            ))}
          </>
        ) : (
          /* Normal navigation */
          SECTIONS.map(sec => {
            const slice      = sec.dim ? dimToSlice[sec.dim] : undefined;
            const total      = slice?.total ?? 0;
            const isActive   = activeSection === sec.id;
            const isExpanded = expanded.has(sec.id);
            const Icon       = sec.icon;
            const dimPins    = sec.dim ? (pins[sec.dim] ?? new Set<string>()) : new Set<string>();
            const allEnts    = slice?.entities ?? [];

            // ── KAM View special rendering ─────────────────────────────────
            if (sec.id === 'kam') {
              const kamTotal = (kamLive?.kams ?? []).reduce((s, k) => s + k.active, 0);
              return (
                <div key="kam">
                  <motion.div
                    whileHover={{ background: '#F3F4F6' }}
                    onClick={() => { setActiveSection('kam'); setSelectedEntity(null); toggleExpand('kam'); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 7, padding: '8px 12px', cursor: 'pointer',
                      background: isActive ? `${sec.color}0C` : 'transparent',
                      borderLeft: `3px solid ${isActive ? sec.color : 'transparent'}`,
                    }}
                  >
                    <Icon style={{ width: 14, height: 14, color: isActive ? sec.color : '#6B7280', flexShrink: 0 }} />
                    <span style={{ fontSize: 12, fontWeight: isActive ? 700 : 500, color: isActive ? sec.color : '#374151', flex: 1 }}>KAM View</span>
                    <LivePill count={kamTotal} color={sec.color} />
                    <ChevronDown style={{ width: 11, height: 11, color: '#9CA3AF', transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.2s', flexShrink: 0 }} />
                  </motion.div>
                  <AnimatePresence initial={false}>
                    {isExpanded && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22 }} style={{ overflow: 'hidden' }}>
                        {/* All KAM row */}
                        <motion.div
                          whileHover={{ background: '#F0F1F3' }}
                          onClick={() => { setActiveSection('kam'); setSelectedEntity(null); }}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px 4px 26px', cursor: 'pointer',
                            background: activeSection === 'kam' && !selectedEntity ? `${sec.color}0C` : 'transparent',
                            borderLeft: activeSection === 'kam' && !selectedEntity ? `2px solid ${sec.color}` : '2px solid transparent',
                          }}
                        >
                          <span style={{ fontSize: 11, fontWeight: 600, color: activeSection === 'kam' && !selectedEntity ? sec.color : '#6B7280', flex: 1 }}>All KAMs</span>
                          <LivePill count={kamTotal} color={sec.color} />
                        </motion.div>
                        {(kamLive?.kams ?? []).map(kam => (
                          <motion.div
                            key={kam.id} whileHover={{ background: '#F0F1F3' }}
                            onClick={() => { setActiveSection('kam'); setSelectedEntity(kam.name); }}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px 4px 26px', cursor: 'pointer',
                              background: selectedEntity === kam.name && isActive ? `${sec.color}0C` : 'transparent',
                            }}
                          >
                            <Briefcase style={{ width: 9, height: 9, color: sec.color, flexShrink: 0 }} />
                            <span style={{ fontSize: 11, color: '#374151', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{kam.name}</span>
                            <span style={{ fontSize: 9, color: '#9CA3AF', flexShrink: 0 }}>{kam.clientCount}c</span>
                            <LivePill count={kam.active} color={sec.color} />
                          </motion.div>
                        ))}
                        {(kamLive?.kams ?? []).length === 0 && (
                          <div style={{ fontSize: 11, color: '#D1D5DB', padding: '6px 14px 6px 26px' }}>No KAMs configured</div>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            }
            const pinnedEnts     = allEnts.filter(e => dimPins.has(e.name));
            const unpinnedEnts   = allEnts.filter(e => !dimPins.has(e.name));
            const sortedUnpinned = attentionMode
              ? [...unpinnedEnts].sort((a, b) =>
                  attentionScore(sec.dim!, b.name, b.active) - attentionScore(sec.dim!, a.name, a.active))
              : unpinnedEnts;
            const orderedEnts    = [...pinnedEnts, ...sortedUnpinned].slice(0, 10);

            return (
              <div key={sec.id}>
                <motion.div
                  whileHover={{ background: '#F3F4F6' }}
                  onClick={() => {
                    if (sec.href) { navigate(sec.href); return; }
                    setActiveSection(sec.id); setSelectedEntity(null);
                    if (sec.dim) toggleExpand(sec.id);
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 7, padding: '8px 12px', cursor: 'pointer',
                    background: isActive ? `${sec.color}0C` : 'transparent',
                    borderLeft: `3px solid ${isActive ? sec.color : 'transparent'}`,
                  }}
                >
                  <Icon style={{ width: 14, height: 14, color: isActive ? sec.color : '#6B7280', flexShrink: 0 }} />
                  <span style={{ fontSize: 12, fontWeight: isActive ? 700 : 500, color: isActive ? sec.color : '#374151', flex: 1, minWidth: 0 }}>{sec.label}</span>
                  {sec.href
                    ? <ExternalLink style={{ width: 10, height: 10, color: '#D1D5DB' }} />
                    : sec.dim
                      ? <>
                          <LivePill count={total} color={sec.color} />
                          <ChevronDown style={{ width: 11, height: 11, color: '#9CA3AF', transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.2s', flexShrink: 0 }} />
                        </>
                      : null
                  }
                </motion.div>

                <AnimatePresence initial={false}>
                  {sec.dim && isExpanded && slice && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22 }} style={{ overflow: 'hidden' }}>
                      {/* All [Section] row */}
                      <motion.div
                        whileHover={{ background: '#F0F1F3' }}
                        onClick={() => { setActiveSection(sec.id); setSelectedEntity(null); }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px 4px 26px', cursor: 'pointer',
                          background: activeSection === sec.id && !selectedEntity ? `${sec.color}0C` : 'transparent',
                          borderLeft: activeSection === sec.id && !selectedEntity ? `2px solid ${sec.color}` : '2px solid transparent',
                        }}
                        data-testid={`sidebar-all-${sec.id}`}
                      >
                        <span style={{ fontSize: 11, fontWeight: 600, color: activeSection === sec.id && !selectedEntity ? sec.color : '#6B7280', flex: 1 }}>All {sec.label}</span>
                        <LivePill count={total} color={sec.color} />
                      </motion.div>
                      {orderedEnts.map(ent => {
                        const isPinned      = dimPins.has(ent.name);
                        const sparkData     = entityHistLocal.get(`${sec.dim}:${ent.name}`) ?? [];
                        const isSelected    = selectedEntity === ent.name && activeSection === sec.id;
                        const cdCfg         = sec.dim ? CROSS_DIM[sec.dim] : null;
                        const isTreeOpen    = sidebarExpanded?.name === ent.name && sidebarExpanded?.sectionId === sec.id;
                        const subRows       = isTreeOpen && sidebarEntityDetail ? cdCfg!.rows(sidebarEntityDetail).slice(0, 6) : [];
                        return (
                          <div key={ent.name}>
                            <motion.div
                              whileHover={{ background: '#F0F1F3' }}
                              onClick={() => { setActiveSection(sec.id); setSelectedEntity(ent.name); }}
                              style={{
                                display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px 4px 26px', cursor: 'pointer',
                                background: isSelected ? `${sec.color}0C` : 'transparent',
                              }}
                            >
                              {/* Pin star */}
                              <button
                                onClick={e => { e.stopPropagation(); togglePin(sec.dim!, ent.name); }}
                                title={isPinned ? 'Unpin' : 'Pin to top'}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', flexShrink: 0 }}
                              >
                                <Star style={{ width: 9, height: 9, color: isPinned ? '#F59E0B' : '#E5E7EB', fill: isPinned ? '#F59E0B' : 'none' }} />
                              </button>
                              <span style={{ fontSize: 11, color: ent.idle ? '#9CA3AF' : '#374151', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{ent.name}</span>
                              {/* Anomaly / incident indicator dot */}
                              {(() => {
                                const anomaly  = sec.dim === 'vendor' ? anomalyByVendor.get(ent.name) : undefined;
                                const incident = incidentByEntity.get(ent.name.toLowerCase());
                                const sev      = anomaly?.severity ?? incident?.severity;
                                if (!sev) return null;
                                const c = sev === 'critical' ? '#EF4444' : sev === 'high' ? '#F59E0B' : '#6B7280';
                                const label = anomaly ? `${anomaly.metric.toUpperCase()} anomaly` : incident?.title ?? 'Incident';
                                return (
                                  <span
                                    title={label}
                                    style={{ width: 6, height: 6, borderRadius: '50%', background: c, flexShrink: 0, boxShadow: `0 0 0 2px ${c}44`, animation: sev === 'critical' ? 'be2-pulse 1.5s ease-in-out infinite' : undefined }}
                                  />
                                );
                              })()}
                              <MiniSparkline data={sparkData} color={sec.color} idle={ent.idle} />
                              <LivePill count={ent.active} color={sec.color} />
                              {/* Expand sub-tree toggle */}
                              {cdCfg && (
                                <button
                                  onClick={e => {
                                    e.stopPropagation();
                                    setSidebarExpanded(prev =>
                                      prev?.name === ent.name && prev?.sectionId === sec.id
                                        ? null
                                        : { dim: sec.dim!, name: ent.name, sectionId: sec.id }
                                    );
                                  }}
                                  title={isTreeOpen ? `Collapse ${cdCfg.label}` : `Show ${cdCfg.label}`}
                                  data-testid={`btn-tree-expand-${ent.name}`}
                                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', flexShrink: 0 }}
                                >
                                  <ChevronRight style={{
                                    width: 9, height: 9,
                                    color: isTreeOpen ? sec.color : '#D1D5DB',
                                    transform: isTreeOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                                    transition: 'transform 0.2s, color 0.2s',
                                  }} />
                                </button>
                              )}
                            </motion.div>

                            {/* Animated sub-tree: cross-dimensional live entities */}
                            <AnimatePresence initial={false}>
                              {isTreeOpen && cdCfg && (
                                <motion.div
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: 'auto', opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  transition={{ duration: 0.22 }}
                                  style={{ overflow: 'hidden' }}
                                >
                                  {/* Connecting line + label */}
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 10px 3px 36px' }}>
                                    <div style={{ width: 1, height: 10, background: `${sec.color}44`, flexShrink: 0 }} />
                                    <span style={{ fontSize: 9, fontWeight: 700, color: sec.color, textTransform: 'uppercase' as const, letterSpacing: '0.06em' }}>
                                      {cdCfg.label}
                                      {sidebarDetailFetching && <span style={{ color: '#D1D5DB', marginLeft: 4 }}>↻</span>}
                                    </span>
                                  </div>
                                  {subRows.length === 0 && !sidebarDetailFetching && (
                                    <div style={{ fontSize: 10, color: '#D1D5DB', padding: '2px 10px 4px 44px' }}>
                                      {ent.idle ? `No ${cdCfg.label.toLowerCase()} history` : `No active ${cdCfg.label.toLowerCase()}`}
                                    </div>
                                  )}
                                  {subRows.map((sub, idx) => {
                                    const subIdle = sub.active === 0;
                                    return (
                                    <motion.div
                                      key={sub.name}
                                      initial={{ opacity: 0, x: -6 }}
                                      animate={{ opacity: 1, x: 0 }}
                                      transition={{ delay: idx * 0.03 }}
                                      whileHover={{ background: '#F0F1F3' }}
                                      onClick={() => { setActiveSection(cdCfg.targetSec); setSelectedEntity(sub.name); }}
                                      data-testid={`tree-sub-${sub.name}`}
                                      style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 10px 3px 44px', cursor: 'pointer', opacity: subIdle ? 0.7 : 1 }}
                                    >
                                      {/* Tree branch line */}
                                      <div style={{ width: 8, height: 1, background: subIdle ? '#D1D5DB' : `${sec.color}33`, flexShrink: 0 }} />
                                      <span style={{ fontSize: 10, color: subIdle ? '#9CA3AF' : '#6B7280', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{sub.name}</span>
                                      <LivePill count={sub.active} color={sec.color} />
                                    </motion.div>
                                    );
                                  })}
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        );
                      })}
                      {allEnts.length > 10 && (
                        <div style={{ fontSize: 10, color: '#9CA3AF', padding: '2px 12px 4px 26px' }}>+{allEnts.length - 10} more</div>
                      )}
                      {/* Global destination search — only in the Destinations section */}
                      {sec.id === 'destinations' && (
                        <div style={{ padding: '6px 10px 6px 12px', borderTop: '1px solid #F3F4F6' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: '#F3F4F6', borderRadius: 6, padding: '4px 8px', marginBottom: 4 }}>
                            <Search style={{ width: 10, height: 10, color: '#9CA3AF', flexShrink: 0 }} />
                            <input
                              value={destLookupQ}
                              onChange={e => setDestLookupQ(e.target.value)}
                              onClick={e => e.stopPropagation()}
                              placeholder="Search all destinations…"
                              data-testid="input-dest-search"
                              style={{ border: 'none', background: 'none', outline: 'none', fontSize: 10, color: '#374151', width: '100%' }}
                            />
                            {destLookupQ && (
                              <button onClick={e => { e.stopPropagation(); setDestLookupQ(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#9CA3AF', fontSize: 10, lineHeight: 1 }}>✕</button>
                            )}
                          </div>
                          {destLookupQ.trim().length >= 2 && (
                            <div>
                              {(destLookup?.results ?? []).length === 0 ? (
                                <div style={{ fontSize: 10, color: '#D1D5DB', padding: '2px 4px' }}>No matches found</div>
                              ) : (
                                (destLookup?.results ?? []).map(r => (
                                  <motion.div
                                    key={r.destination}
                                    whileHover={{ background: '#F0F1F3' }}
                                    onClick={() => { setActiveSection('destinations'); setSelectedEntity(r.destination); setDestLookupQ(''); }}
                                    style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 4px', cursor: 'pointer', borderRadius: 4 }}
                                  >
                                    <Globe style={{ width: 9, height: 9, color: '#D97706', flexShrink: 0 }} />
                                    <span style={{ fontSize: 10, color: '#374151', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{r.destination}</span>
                                    {r.activeCalls > 0 && <LivePill count={r.activeCalls} color="#D97706" />}
                                  </motion.div>
                                ))
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })
        )}
      </div>

      <div style={{ padding: '8px 12px', borderTop: '1px solid #E6EAF0', fontSize: 10, color: '#9CA3AF' }}>
        {isFetching
          ? '↻ Refreshing…'
          : liveSummary?.lastUpdated ? `Updated ${Math.round((Date.now() - liveSummary.lastUpdated) / 1000)}s ago` : 'Polling every 30s'}
      </div>
    </div>
  );

  // ── NOC Overview panel ────────────────────────────────────────────────────
  const nocPanel = (
    <div style={{ flex: 1, overflow: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 10 }}>
        <KpiCard label="Active Channels" value={String(cs?.currentActive ?? liveSummary?.total ?? 0)}           numericValue={cs?.currentActive ?? liveSummary?.total ?? 0}          color="#2563EB" icon={Activity}   delay={0.00} />
        <KpiCard label="Connected"        value={String(liveSummary?.connected ?? cs?.currentConnected ?? 0)}   numericValue={liveSummary?.connected ?? cs?.currentConnected ?? 0}    color="#16A34A" icon={TrendingUp} delay={0.05} />
        <KpiCard label="Routing"          value={String(liveSummary?.routing ?? cs?.currentRouting ?? 0)}       numericValue={liveSummary?.routing ?? cs?.currentRouting ?? 0}        color="#F59E0B" icon={Zap}        delay={0.10} />
        <KpiCard
          label="Connect Rate" value={liveSummary ? `${liveSummary.liveConnectRatio}%` : '—'}
          numericValue={liveSummary?.liveConnectRatio}
          color={liveSummary ? (liveSummary.liveConnectRatio >= 70 ? '#16A34A' : liveSummary.liveConnectRatio >= 45 ? '#F59E0B' : '#EF4444') : '#9CA3AF'}
          icon={BarChart2} delay={0.15}
        />
        <KpiCard label="Avg Duration" value={fmtDuration(liveSummary?.avgCallAgeSecs ?? 0)} color="#7C3AED" icon={Radio}      delay={0.20} sub="live ACD proxy" />
        <KpiCard label="Peak (4h)"    value={String(cs?.peakActive ?? 0)} numericValue={cs?.peakActive ?? 0}    color="#6B7280" icon={TrendingUp} delay={0.25} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
        <ConcurrentChart points={concPoints} title="Concurrent Call Stream" sub="5-min buckets · 4h window" height={isFullscreen ? 180 : 140} />
        <CpsChart points={concPoints} height={isFullscreen ? 180 : 100} />
      </div>

      <WorldMap
        entities={countrySlice?.entities ?? []}
        height={isFullscreen ? 360 : 280}
        onCountryClick={name => { setActiveSection('countries'); setSelectedEntity(name); }}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        <TopTable title="Top Clients"      rows={clientSlice?.entities?.slice(0, 5).map(e => ({ name: e.name, active: e.active })) ?? []} color="#7C3AED" onSeeAll={() => { setActiveSection('clients');      setSelectedEntity(null); }} />
        <TopTable title="Top Vendors"      rows={vendorSlice?.entities?.slice(0, 5).map(e => ({ name: e.name, active: e.active })) ?? []} color="#0891B2" onSeeAll={() => { setActiveSection('vendors');      setSelectedEntity(null); }} />
        <TopTable title="Top Destinations" rows={destSlice?.entities?.slice(0, 5).map(e => ({ name: e.name, active: e.active })) ?? []}   color="#D97706" onSeeAll={() => { setActiveSection('destinations'); setSelectedEntity(null); }} />
      </div>

      {/* ── Live Traffic Stream ticker ── */}
      {(trafficEvents?.events ?? []).length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #E6EAF0', borderRadius: 10, padding: '10px 14px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase' as const, letterSpacing: '0.08em', marginBottom: 8 }}>Live Traffic Stream</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {(trafficEvents?.events ?? []).slice(0, 6).map((ev, i) => (
              <motion.div
                key={`${ev.ts}-${ev.entity}`}
                initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}
                style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11 }}
              >
                <span style={{
                  fontSize: 10, fontWeight: 800,
                  color: ev.delta > 0 ? '#16A34A' : '#EF4444',
                  background: ev.delta > 0 ? '#F0FDF4' : '#FEF2F2',
                  border: `1px solid ${ev.delta > 0 ? '#BBF7D0' : '#FECACA'}`,
                  borderRadius: 4, padding: '1px 5px', flexShrink: 0, minWidth: 28, textAlign: 'center' as const,
                }}>
                  {ev.delta > 0 ? '+' : ''}{ev.delta}
                </span>
                <span style={{ color: '#374151', flex: 1 }}>{ev.message}</span>
                <span style={{ fontSize: 10, color: '#D1D5DB', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                  {Math.round((Date.now() - ev.ts) / 1000)}s ago
                </span>
              </motion.div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  // ── Entity dimension panel ────────────────────────────────────────────────
  const activeDimPins = activeSec.dim ? (pins[activeSec.dim] ?? new Set<string>()) : new Set<string>();

  const entityPanel = (
    <div style={{ flex: 1, overflow: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
        <button
          onClick={() => setSelectedEntity(null)}
          style={{ fontWeight: 700, color: activeSec.color, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          {activeSec.label}
        </button>
        {selectedEntity && (
          <>
            <ChevronRight style={{ width: 12, height: 12, color: '#9CA3AF' }} />
            <span style={{ color: '#1F2937', fontWeight: 700, fontSize: 13 }}>{selectedEntity}</span>
            <button onClick={() => setSelectedEntity(null)} style={{ marginLeft: 6, fontSize: 10, color: '#9CA3AF', background: 'none', border: 'none', cursor: 'pointer' }}>✕ back</button>
          </>
        )}
        {fetchDetail && <span style={{ fontSize: 10, color: '#9CA3AF', marginLeft: 4 }}>↻ refreshing…</span>}
      </div>

      {selectedEntity && entityDetail ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* ── Quick links ── */}
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => navigate(`/asr-acd-report?vendor=${encodeURIComponent(selectedEntity ?? '')}&from=90&to=0`)}
              data-testid="button-quicklink-asr-report"
              style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: '#2563EB', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 6, padding: '5px 10px', cursor: 'pointer' }}
            >
              <BarChart2 style={{ width: 11, height: 11 }} /> ASR/ACD Report
            </button>
            <button
              onClick={() => navigate(`/cdrs?vendor=${encodeURIComponent(selectedEntity ?? '')}`)}
              data-testid="button-quicklink-cdrs"
              style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: '#6B7280', background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 6, padding: '5px 10px', cursor: 'pointer' }}
            >
              <ExternalLink style={{ width: 11, height: 11 }} /> View CDRs
            </button>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <KpiCard label="Active"       value={String(entityDetail.active)}    numericValue={entityDetail.active}    color={activeSec.color} icon={Activity}   delay={0} />
            <KpiCard label="Connected"    value={String(entityDetail.connected)} numericValue={entityDetail.connected} color="#16A34A"         icon={TrendingUp} delay={0.05} />
            <KpiCard label="Routing"      value={String(entityDetail.routing)}   numericValue={entityDetail.routing}   color="#F59E0B"         icon={Zap}        delay={0.10} />
            <KpiCard
              label="Connect Rate" value={`${entityDetail.connectRate}%`}
              numericValue={entityDetail.connectRate}
              color={entityDetail.connectRate >= 70 ? '#16A34A' : entityDetail.connectRate >= 45 ? '#F59E0B' : '#EF4444'}
              icon={BarChart2} delay={0.15}
            />
          </div>

          <EntityIntelligenceChart
            dim={activeSec.dim ?? 'client'}
            entity={selectedEntity}
            color={activeSec.color}
            livePoints={entityHistoryPts.length > 0 ? entityHistoryPts : concPoints}
          />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {entityDetail.topClients.length > 0 && (
                <CrossTable title="Top Clients" rows={entityDetail.topClients} color="#7C3AED" onRowClick={name => drillCross('client', name)} />
              )}
              {entityDetail.topVendors.length > 0 && (
                <CrossTable title="Top Vendors" rows={entityDetail.topVendors} color="#0891B2" onRowClick={name => drillCross('vendor', name)} />
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {entityDetail.topCountries.length > 0 && (
                <CrossTable title="Top Countries" rows={entityDetail.topCountries} color="#059669" onRowClick={name => drillCross('country', name)} />
              )}
              {entityDetail.topDestinations.length > 0 && (
                <CrossTable title="Top Destinations" rows={entityDetail.topDestinations} color="#D97706" onRowClick={name => drillCross('destination', name)} />
              )}
            </div>
          </div>

          {entityDetail.active === 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 8, padding: '10px 14px' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#9CA3AF', flexShrink: 0 }} />
              <div>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#6B7280' }}>Idle</span>
                {entityDetail.lastSeen && (
                  <span style={{ fontSize: 11, color: '#9CA3AF', marginLeft: 6 }}>· last seen {fmtLastSeen(entityDetail.lastSeen)}</span>
                )}
                {(entityDetail.peakToday ?? 0) > 0 && (
                  <span style={{ fontSize: 11, color: '#9CA3AF', marginLeft: 6 }}>· peak today: {entityDetail.peakToday}</span>
                )}
              </div>
            </div>
          )}
        </div>
      ) : selectedEntity ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: '#9CA3AF', fontSize: 13 }}>
          Loading {selectedEntity}…
        </div>
      ) : (
        <>
          {activeSection === 'countries' && (
            <WorldMap entities={countrySlice?.entities ?? []} height={300} onCountryClick={setSelectedEntity} />
          )}
          <motion.div
            style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}
            variants={{ show: { transition: { staggerChildren: 0.04 } } }}
            initial="hidden" animate="show"
          >
            {/* Pinned first */}
            {sortedActiveDimEntities.filter(e => activeDimPins.has(e.name)).map(ent => {
              const anomaly  = activeSec.dim === 'vendor' ? anomalyByVendor.get(ent.name) : undefined;
              const incident = incidentByEntity.get(ent.name.toLowerCase());
              const sev      = anomaly?.severity ?? incident?.severity;
              const lbl      = anomaly ? `${anomaly.metric.toUpperCase()} anomaly — ${ent.name}` : incident?.title;
              return (
                <motion.div key={`pin-${ent.name}`} variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}>
                  <EntityCard
                    entity={ent} color={activeSec.color}
                    onClick={() => setSelectedEntity(ent.name)}
                    pinned onPin={() => togglePin(activeSec.dim!, ent.name)}
                    alertSeverity={sev} alertLabel={lbl}
                  />
                </motion.div>
              );
            })}
            {/* Unpinned */}
            {sortedActiveDimEntities.filter(e => !activeDimPins.has(e.name)).map(ent => {
              const anomaly  = activeSec.dim === 'vendor' ? anomalyByVendor.get(ent.name) : undefined;
              const incident = incidentByEntity.get(ent.name.toLowerCase());
              const sev      = anomaly?.severity ?? incident?.severity;
              const lbl      = anomaly ? `${anomaly.metric.toUpperCase()} anomaly — ${ent.name}` : incident?.title;
              return (
                <motion.div key={ent.name} variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}>
                  <EntityCard
                    entity={ent} color={activeSec.color}
                    onClick={() => setSelectedEntity(ent.name)}
                    pinned={false} onPin={activeSec.dim ? () => togglePin(activeSec.dim!, ent.name) : undefined}
                    alertSeverity={sev} alertLabel={lbl}
                  />
                </motion.div>
              );
            })}
            {(!activeDim || activeDim.entities.length === 0) && (
              <div style={{ gridColumn: '1/-1', textAlign: 'center' as const, padding: '60px 0', color: '#9CA3AF', fontSize: 14 }}>
                No active calls in this dimension right now
              </div>
            )}
          </motion.div>
        </>
      )}
    </div>
  );

  // ── KAM panel ──────────────────────────────────────────────────────────────
  const KAM_COLOR = '#8B5CF6';
  const selectedKamData = selectedEntity ? (kamLive?.kams ?? []).find(k => k.name === selectedEntity) : null;

  const kamPanel = (
    <div style={{ flex: 1, overflow: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
        <button onClick={() => setSelectedEntity(null)} style={{ fontWeight: 700, color: KAM_COLOR, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>KAM View</button>
        {selectedEntity && (
          <>
            <ChevronRight style={{ width: 12, height: 12, color: '#9CA3AF' }} />
            <span style={{ color: '#1F2937', fontWeight: 700, fontSize: 13 }}>{selectedEntity}</span>
            <button onClick={() => setSelectedEntity(null)} style={{ marginLeft: 6, fontSize: 10, color: '#9CA3AF', background: 'none', border: 'none', cursor: 'pointer' }}>✕ back</button>
          </>
        )}
      </div>

      {selectedKamData ? (
        /* ── KAM drilldown ── */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Quick links */}
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => navigate(`/asr-acd-report`)}
              data-testid="button-kam-asr-report"
              style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: '#2563EB', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 6, padding: '5px 10px', cursor: 'pointer' }}
            >
              <BarChart2 style={{ width: 11, height: 11 }} /> ASR/ACD Report
            </button>
            <button
              onClick={() => navigate(`/cdrs`)}
              data-testid="button-kam-cdrs"
              style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: '#6B7280', background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 6, padding: '5px 10px', cursor: 'pointer' }}
            >
              <ExternalLink style={{ width: 11, height: 11 }} /> View CDRs
            </button>
          </div>

          {/* KPI row */}
          <div style={{ display: 'flex', gap: 10 }}>
            <KpiCard label="Active Calls"   value={String(selectedKamData.active)}   numericValue={selectedKamData.active}   color={KAM_COLOR} icon={Activity}   delay={0}    />
            <KpiCard label="Connected"       value={String(selectedKamData.connected)} numericValue={selectedKamData.connected} color="#16A34A"  icon={TrendingUp} delay={0.05} />
            <KpiCard label="Routing"         value={String(selectedKamData.routing)}   numericValue={selectedKamData.routing}   color="#F59E0B"  icon={Zap}        delay={0.10} />
            <KpiCard
              label="Connect Rate" value={`${selectedKamData.connectRate}%`}
              numericValue={selectedKamData.connectRate}
              color={selectedKamData.connectRate >= 70 ? '#16A34A' : selectedKamData.connectRate >= 45 ? '#F59E0B' : '#EF4444'}
              icon={BarChart2} delay={0.15}
            />
            <KpiCard label="Clients"         value={String(selectedKamData.clientCount)} numericValue={selectedKamData.clientCount} color="#6B7280" icon={Users} delay={0.20} />
          </div>

          {/* Cross-dim tables */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <CrossTable
              title="Active Clients" rows={selectedKamData.topClients} color="#7C3AED"
              onRowClick={name => drillCross('client', name)}
            />
            <CrossTable
              title="Top Vendors" rows={selectedKamData.topVendors} color="#0891B2"
              onRowClick={name => drillCross('vendor', name)}
            />
            <CrossTable
              title="Top Countries" rows={selectedKamData.topCountries} color="#059669"
              onRowClick={name => drillCross('country', name)}
            />
          </div>

          {selectedKamData.active === 0 && (
            <div style={{ textAlign: 'center' as const, padding: '40px 0', color: '#9CA3AF', fontSize: 14 }}>
              No active calls for <strong>{selectedEntity}</strong> at this moment.
            </div>
          )}
        </div>
      ) : (
        /* ── KAM list overview ── */
        <>
          {(kamLive?.kams ?? []).length === 0 ? (
            <div style={{ textAlign: 'center' as const, padding: '60px 0', color: '#9CA3AF', fontSize: 14 }}>
              No KAMs configured — add KAMs in the Team section to see live traffic per account manager.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
              {(kamLive?.kams ?? []).map(kam => (
                <motion.div
                  key={kam.id}
                  whileHover={{ scale: 1.01, boxShadow: '0 4px 16px rgba(139,92,246,0.12)' }}
                  onClick={() => setSelectedEntity(kam.name)}
                  data-testid={`card-kam-${kam.id}`}
                  style={{ background: '#fff', border: `1.5px solid ${kam.active > 0 ? '#DDD6FE' : '#E5E7EB'}`, borderRadius: 10, padding: '14px 16px', cursor: 'pointer', transition: 'border-color 0.15s' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: `${KAM_COLOR}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Briefcase style={{ width: 15, height: 15, color: KAM_COLOR }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#1F2937', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{kam.name}</div>
                      <div style={{ fontSize: 10, color: '#9CA3AF' }}>{kam.orgRole ?? 'KAM'} · {kam.clientCount} client{kam.clientCount !== 1 ? 's' : ''}</div>
                    </div>
                    <LivePill count={kam.active} color={KAM_COLOR} />
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {[
                      { label: 'Connected', value: kam.connected, color: '#16A34A' },
                      { label: 'Routing',   value: kam.routing,   color: '#F59E0B' },
                      { label: 'Rate',      value: `${kam.connectRate}%`, color: kam.connectRate >= 70 ? '#16A34A' : kam.connectRate >= 45 ? '#F59E0B' : '#EF4444' },
                    ].map(m => (
                      <div key={m.label} style={{ flex: 1, background: '#F9FAFB', borderRadius: 6, padding: '5px 6px', textAlign: 'center' as const }}>
                        <div style={{ fontSize: 9, color: '#9CA3AF', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: 2 }}>{m.label}</div>
                        <div style={{ fontSize: 15, fontWeight: 800, color: m.color }}>{m.value}</div>
                      </div>
                    ))}
                  </div>
                  {kam.topClients.length > 0 && (
                    <div style={{ marginTop: 8, fontSize: 10, color: '#6B7280' }}>
                      <span style={{ color: '#9CA3AF' }}>Active: </span>
                      {kam.topClients.slice(0, 3).map(c => c.name).join(', ')}
                      {kam.topClients.length > 3 && ` +${kam.topClients.length - 3}`}
                    </div>
                  )}
                </motion.div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );

  // ── Wallboard Panel (fullscreen NOC mode) ────────────────────────────────
  const wbSlides = [
    { label: 'Countries', color: '#059669', data: (countrySlice?.entities ?? []).slice(0, 8) },
    { label: 'Vendors',   color: '#0891B2', data: (vendorSlice?.entities ?? []).slice(0, 8)  },
    { label: 'Clients',   color: '#7C3AED', data: (clientSlice?.entities ?? []).slice(0, 8)  },
    { label: 'KAMs',      color: '#8B5CF6', data: (kamLive?.kams ?? []).slice(0, 8).map(k => ({ name: k.name, active: k.active, connected: k.connected, routing: k.routing, connectRate: k.connectRate })) },
  ];
  const wbCurrent = wbSlides[wallboardSlide];

  const wallboardPanel = (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#FAFBFC', overflow: 'hidden' }}>
      {/* KPI Strip */}
      <div style={{ display: 'flex', flexShrink: 0, borderBottom: '1px solid #E6EAF0', background: '#fff' }}>
        <KpiCard label="Active Calls"  value={String(cs?.currentActive ?? liveSummary?.total ?? 0)}         numericValue={cs?.currentActive ?? liveSummary?.total ?? 0}       color="#2563EB" icon={Activity}   delay={0} />
        <KpiCard label="Connected"     value={String(liveSummary?.connected ?? cs?.currentConnected ?? 0)}  numericValue={liveSummary?.connected ?? cs?.currentConnected ?? 0}  color="#16A34A" icon={TrendingUp} delay={0} />
        <KpiCard label="Routing"       value={String(liveSummary?.routing ?? cs?.currentRouting ?? 0)}      numericValue={liveSummary?.routing ?? cs?.currentRouting ?? 0}      color="#F59E0B" icon={Zap}        delay={0} />
        <KpiCard
          label="Connect Rate" value={liveSummary ? `${liveSummary.liveConnectRatio}%` : '—'}
          numericValue={liveSummary?.liveConnectRatio}
          color={liveSummary ? (liveSummary.liveConnectRatio >= 70 ? '#16A34A' : liveSummary.liveConnectRatio >= 45 ? '#F59E0B' : '#EF4444') : '#9CA3AF'}
          icon={BarChart2} delay={0}
        />
        <KpiCard label="Avg Duration"  value={fmtDuration(liveSummary?.avgCallAgeSecs ?? 0)}                color="#7C3AED" icon={Radio}      delay={0} sub="live ACD proxy" />
        <KpiCard label="Peak (4h)"     value={String(cs?.peakActive ?? 0)}                                  numericValue={cs?.peakActive ?? 0}                                  color="#6B7280" icon={TrendingUp} delay={0} />
      </div>

      {/* Middle: Concurrent chart + World map */}
      <div style={{ display: 'flex', flex: 3, minHeight: 0, borderBottom: '1px solid #E6EAF0' }}>
        <div style={{ flex: 3, padding: '14px 20px', display: 'flex', flexDirection: 'column', borderRight: '1px solid #E6EAF0', background: '#fff' }}>
          <ConcurrentChart points={concPoints} title="Concurrent Call Stream" sub="5-min buckets · 4h window" height={200} />
        </div>
        <div style={{ flex: 2, padding: '14px 16px', display: 'flex', flexDirection: 'column', background: '#fff' }}>
          <WorldMap entities={countrySlice?.entities ?? []} height={200} onCountryClick={() => {}} />
        </div>
      </div>

      {/* Bottom: Auto-rotating entity grid */}
      <div style={{ flex: 2, minHeight: 0, display: 'flex', flexDirection: 'column', background: '#fff' }}>
        {/* Slide header + progress bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 20px', borderBottom: '1px solid #F3F4F6', flexShrink: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: wbCurrent.color, minWidth: 80 }}>{wbCurrent.label}</span>
          <div style={{ flex: 1, display: 'flex', gap: 4, alignItems: 'center' }}>
            {wbSlides.map((s, i) => (
              <div
                key={s.label}
                onClick={() => setWallboardSlide(i)}
                data-testid={`wallboard-tab-${s.label.toLowerCase()}`}
                style={{ flex: 1, height: 3, borderRadius: 99, cursor: 'pointer', background: i === wallboardSlide ? wbCurrent.color : '#E5E7EB', transition: 'background 0.4s' }}
              />
            ))}
          </div>
          <span style={{ fontSize: 10, color: '#D1D5DB' }}>auto · 15s</span>
        </div>
        {/* Entity cards */}
        <AnimatePresence mode="wait">
          <motion.div
            key={wallboardSlide}
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3 }}
            style={{ flex: 1, padding: '12px 20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10, overflow: 'auto', alignContent: 'start' }}
          >
            {wbCurrent.data.length === 0 ? (
              <div style={{ color: '#9CA3AF', fontSize: 13, gridColumn: '1 / -1', paddingTop: 20 }}>No active {wbCurrent.label.toLowerCase()} at this moment</div>
            ) : (
              wbCurrent.data.map(e => (
                <div key={e.name} style={{ background: '#FAFBFC', border: `1.5px solid ${wbCurrent.color}22`, borderRadius: 8, padding: '10px 12px' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{e.name}</div>
                  <div style={{ fontSize: 30, fontWeight: 900, color: wbCurrent.color, lineHeight: 1 }}>{e.active}</div>
                  <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 3 }}>{e.connectRate}% rate</div>
                </div>
              ))
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );

  const rightPanel = isFullscreen ? wallboardPanel
    : activeSection === 'noc' ? nocPanel
    : activeSection === 'kam' ? kamPanel
    : activeSec.dim ? entityPanel
    : nocPanel;

  // ── Layout ────────────────────────────────────────────────────────────────
  return (
    <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#F7F9FC' }}>
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 20px', background: '#fff', borderBottom: '1px solid #E6EAF0', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 9, background: 'linear-gradient(135deg, #2563EB 0%, #7C3AED 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Radio style={{ width: 16, height: 16, color: '#fff' }} />
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#1F2937', letterSpacing: '-0.01em' }}>BitsEye 2</div>
            <div style={{ fontSize: 10, color: '#9CA3AF', fontWeight: 500 }}>Live Traffic Visibility</div>
          </div>
          <span style={{ marginLeft: 8, display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, color: '#16A34A', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 99, padding: '2px 8px' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#16A34A', display: 'inline-block', animation: 'be2-pulse 2.2s ease-in-out infinite' }} />
            LIVE
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {isFetching && <RefreshCw style={{ width: 14, height: 14, color: '#2563EB', animation: 'be2-spin 1s linear infinite' }} />}
          {!isFullscreen && <span style={{ fontSize: 11, color: '#D1D5DB' }}>30s refresh</span>}

          {/* Alert Bell — re-opens the alert bar */}
          {!isFullscreen && (incidentRows ?? []).some(r => r.status === 'active' && (r.severity === 'critical' || r.severity === 'high')) && (
            <button
              onClick={() => { setAlertBarOpen(true); setDismissedAlerts(new Set()); }}
              title="Show active alerts"
              data-testid="button-alert-bell"
              style={{
                position: 'relative', display: 'flex', alignItems: 'center', gap: 5,
                fontSize: 11, fontWeight: 600,
                color: (incidentRows ?? []).some(r => r.status === 'active' && r.severity === 'critical') ? '#EF4444' : '#D97706',
                background: (incidentRows ?? []).some(r => r.status === 'active' && r.severity === 'critical') ? '#FEF2F2' : '#FFFBEB',
                border: `1px solid ${(incidentRows ?? []).some(r => r.status === 'active' && r.severity === 'critical') ? '#FECACA' : '#FDE68A'}`,
                borderRadius: 6, padding: '5px 10px', cursor: 'pointer',
              }}
            >
              <Bell style={{ width: 12, height: 12 }} />
              {activeAlerts.length > 0 ? activeAlerts.length : ''}
            </button>
          )}

          {/* Attention Mode toggle */}
          {!isFullscreen && (
            <button
              onClick={() => setAttentionMode(p => !p)}
              title={attentionMode ? 'Attention Mode ON — most urgent entities first' : 'Attention Mode — sort by alert severity'}
              data-testid="button-attention-mode"
              style={{
                display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600,
                color: attentionMode ? '#7C3AED' : '#6B7280',
                background: attentionMode ? '#F5F3FF' : '#F9FAFB',
                border: `1px solid ${attentionMode ? '#DDD6FE' : '#E6EAF0'}`,
                borderRadius: 6, padding: '5px 10px', cursor: 'pointer', transition: 'all 0.15s',
              }}
            >
              <Layers style={{ width: 12, height: 12 }} />
              Attention
              {attentionMode && (anomalyByVendor.size + incidentByEntity.size) > 0 && (
                <span style={{ background: '#7C3AED', color: '#fff', borderRadius: 99, fontSize: 9, fontWeight: 700, padding: '0 4px', minWidth: 14, textAlign: 'center' as const }}>
                  {anomalyByVendor.size + incidentByEntity.size}
                </span>
              )}
            </button>
          )}

          {/* Wallboard / fullscreen toggle */}
          <button
            onClick={toggleFullscreen}
            title={isFullscreen ? 'Exit wallboard' : 'NOC Wallboard — fullscreen'}
            data-testid="button-wallboard"
            style={{
              display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600,
              color: isFullscreen ? '#2563EB' : '#6B7280',
              background: isFullscreen ? '#EFF6FF' : '#F9FAFB',
              border: `1px solid ${isFullscreen ? '#BFDBFE' : '#E6EAF0'}`,
              borderRadius: 6, padding: '5px 10px', cursor: 'pointer', transition: 'all 0.15s',
            }}
          >
            {isFullscreen
              ? <><Minimize2 style={{ width: 12, height: 12 }} /> Exit</>
              : <><Maximize2 style={{ width: 12, height: 12 }} /> Wallboard</>
            }
          </button>
          {!isFullscreen && (
            <a href="/bitseye" style={{ fontSize: 11, color: '#9CA3AF', textDecoration: 'none', padding: '5px 10px', border: '1px solid #E6EAF0', borderRadius: 6 }}>← BitsEye v1</a>
          )}
        </div>
      </div>

      {/* ── Sticky Alert Bar ── */}
      <AnimatePresence>
        {!isFullscreen && activeAlerts.length > 0 && alertBarOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
            style={{ overflow: 'hidden', flexShrink: 0 }}
          >
            <div style={{
              background: activeAlerts.some(a => a.severity === 'critical') ? '#FEF2F2' : '#FFFBEB',
              borderBottom: `1px solid ${activeAlerts.some(a => a.severity === 'critical') ? '#FECACA' : '#FDE68A'}`,
              padding: '0 20px',
            }}>
              {/* Header row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0 4px' }}>
                <AlertTriangle style={{ width: 13, height: 13, color: activeAlerts.some(a => a.severity === 'critical') ? '#EF4444' : '#D97706', flexShrink: 0 }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: activeAlerts.some(a => a.severity === 'critical') ? '#B91C1C' : '#92400E', flex: 1 }}>
                  {activeAlerts.length} active alert{activeAlerts.length !== 1 ? 's' : ''}
                  {activeAlerts.some(a => a.severity === 'critical') ? ' — CRITICAL' : ' — HIGH'}
                </span>
                <button
                  onClick={() => setDismissedAlerts(new Set(activeAlerts.map(a => a.id)))}
                  style={{ fontSize: 10, color: '#9CA3AF', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px', borderRadius: 4, whiteSpace: 'nowrap' as const }}
                >
                  Dismiss all
                </button>
                <button
                  onClick={() => setAlertBarOpen(false)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'flex', color: '#9CA3AF' }}
                >
                  <XIcon style={{ width: 12, height: 12 }} />
                </button>
              </div>
              {/* Alert rows — up to 5 */}
              <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 2, paddingBottom: 6 }}>
                {activeAlerts.slice(0, 5).map(alert => {
                  const isCrit = alert.severity === 'critical';
                  const color  = isCrit ? '#EF4444' : '#F59E0B';
                  const ageMs  = Date.now() - new Date(alert.openedAt).getTime();
                  const ageStr = ageMs < 60_000 ? 'just now' : ageMs < 3_600_000 ? `${Math.round(ageMs / 60_000)}m ago` : `${Math.round(ageMs / 3_600_000)}h ago`;
                  const canJump = !!alert.entityName;
                  const dimMap: Record<string, SectionId> = { client: 'clients', vendor: 'vendors', country: 'countries', destination: 'destinations' };
                  return (
                    <div key={alert.id}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, borderRadius: 5, padding: '1px 0', cursor: canJump ? 'pointer' : 'default' }}
                      onClick={() => {
                        if (!canJump) return;
                        setActiveSection(dimMap[alert.entityType] ?? 'vendors');
                        setSelectedEntity(alert.entityName!);
                        setAlertBarOpen(false);
                      }}
                      title={canJump ? `View live traffic for ${alert.entityName}` : undefined}
                    >
                      <span style={{
                        fontSize: 9, fontWeight: 700, color, background: `${color}18`,
                        border: `1px solid ${color}44`, borderRadius: 3, padding: '1px 5px',
                        textTransform: 'uppercase' as const, letterSpacing: '0.04em', flexShrink: 0,
                      }}>
                        {alert.severity}
                      </span>
                      {alert.entityName && (
                        <span style={{ fontSize: 11, fontWeight: 600, color: '#374151', flexShrink: 0 }}>{alert.entityName}</span>
                      )}
                      <span style={{ fontSize: 11, color: '#6B7280', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{alert.title}</span>
                      <span style={{ fontSize: 10, color: '#9CA3AF', flexShrink: 0 }}>{ageStr}</span>
                      <button
                        onClick={e => { e.stopPropagation(); setDismissedAlerts(prev => new Set([...prev, alert.id])); }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 1, display: 'flex', color: '#D1D5DB', flexShrink: 0 }}
                      >
                        <XIcon style={{ width: 10, height: 10 }} />
                      </button>
                    </div>
                  );
                })}
                {activeAlerts.length > 5 && (
                  <div style={{ fontSize: 10, color: '#9CA3AF', paddingLeft: 2 }}>+{activeAlerts.length - 5} more — see Alerts page</div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Body */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {!isFullscreen && sidebar}
        <AnimatePresence mode="wait">
          <motion.div
            key={activeSection + (selectedEntity ?? '') + String(isFullscreen)}
            initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -6 }}
            transition={{ duration: 0.18 }}
            style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
          >
            {rightPanel}
          </motion.div>
        </AnimatePresence>
      </div>

      <style>{`
        @keyframes be2-arc-flow {
          from { stroke-dashoffset: 0; }
          to   { stroke-dashoffset: -400; }
        }
        @keyframes be2-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.3; transform: scale(0.88); }
        }
        @keyframes be2-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar,
} from "recharts";
import {
  ComposableMap, Geographies, Geography, Marker,
} from "react-simple-maps";
import {
  Radio, Users, Wifi, Globe, Phone, GitBranch, Briefcase,
  BarChart2, ChevronDown, ChevronRight, RefreshCw,
  Activity, TrendingUp, Zap, ExternalLink, Map,
} from "lucide-react";
import { useLocation } from "wouter";

// ── Types ────────────────────────────────────────────────────────────────────
interface EntityRow {
  name: string; active: number; connected: number; routing: number; connectRate: number;
}
interface LiveSliceResponse {
  groupBy: string; entities: EntityRow[]; total: number; stale: boolean; lastUpdated: number;
}
interface CrossRow {
  name: string; active: number; connected: number; connectRate: number;
}
interface EntityDetail {
  dim: string; name: string;
  active: number; connected: number; routing: number; connectRate: number;
  topClients: CrossRow[]; topVendors: CrossRow[];
  topCountries: CrossRow[]; topDestinations: CrossRow[];
  entityHistory: { ts: number; count: number; connected: number; routing: number }[];
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
const GEO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

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
  'Côte d\'Ivoire':           'IVORY COAST',
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

// ── World Map ─────────────────────────────────────────────────────────────────
function WorldMap({
  entities, height = 360, onCountryClick,
}: {
  entities: EntityRow[]; height?: number; onCountryClick?: (name: string) => void;
}) {
  const [tooltip, setTooltip] = useState<{ name: string; data?: EntityRow } | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

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

  const totalActive    = entities.reduce((s, e) => s + e.active, 0);
  const activeCountries = entities.filter(e => e.active > 0).length;

  return (
    <div
      style={{ position: 'relative', background: '#F0F4FB', borderRadius: 16, border: '1px solid #E6EAF0', overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}
      onMouseMove={e => {
        const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
        setTooltipPos({ x: e.clientX - rect.left + 14, y: e.clientY - rect.top + 14 });
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px 0', position: 'absolute', top: 0, left: 0, right: 0, zIndex: 5 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Map style={{ width: 13, height: 13, color: '#6B7280' }} />
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

      <ComposableMap
        projection="geoMercator"
        projectionConfig={{ scale: 120, center: [20, 12] }}
        style={{ width: '100%', height }}
      >
        <Geographies geography={GEO_URL}>
          {({ geographies }) =>
            geographies.map(geo => {
              const geoName = geo.properties.name as string ?? '';
              const apiName = GEO_TO_API[geoName] ?? geoName.toUpperCase();
              const data    = countryMap.get(apiName);
              const count   = data?.active ?? 0;
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
                    hover: { outline: 'none', fill: isActive ? '#7C3AED' : '#CDD5E0', cursor: isActive ? 'pointer' : 'default' },
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

        {pulseMarkers.map(({ name, coords, count, cr }) => {
          const r1 = count <= 2 ? 3 : count <= 10 ? 5 : count <= 30 ? 7 : 10;
          const dotColor = cr >= 70 ? '#16A34A' : cr >= 40 ? '#F59E0B' : '#EF4444';
          return (
            <Marker key={name} coordinates={coords}>
              <circle r={r1 * 2} fill={dotColor} opacity={0.18} style={{ animation: `be2-pulse ${1.8 + (count % 5) * 0.2}s infinite` }} />
              <circle r={r1} fill={dotColor} opacity={0.85} style={{ animation: `be2-pulse ${1.8 + (count % 5) * 0.2}s infinite` }} />
              {count > 3 && (
                <text textAnchor="middle" y={-(r1 + 5)} style={{ fontSize: 9, fontWeight: 700, fill: '#1F2937', paintOrder: 'stroke', stroke: '#fff', strokeWidth: 2 }}>
                  {count}
                </text>
              )}
            </Marker>
          );
        })}
      </ComposableMap>

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
    </div>
  );
}

// ── Sidebar sections ──────────────────────────────────────────────────────────
type SectionId = 'noc' | 'clients' | 'vendors' | 'countries' | 'destinations' | 'routing' | 'kam';

const SECTIONS: { id: SectionId; label: string; icon: any; dim: string | null; href?: string; color: string }[] = [
  { id: 'noc',          label: 'NOC Overview', icon: Radio,     dim: null,           color: '#2563EB' },
  { id: 'clients',      label: 'Clients',       icon: Users,     dim: 'client',       color: '#7C3AED' },
  { id: 'vendors',      label: 'Vendors',       icon: Wifi,      dim: 'vendor',       color: '#0891B2' },
  { id: 'countries',    label: 'Countries',     icon: Globe,     dim: 'country',      color: '#059669' },
  { id: 'destinations', label: 'Destinations',  icon: Phone,     dim: 'destination',  color: '#D97706' },
  { id: 'routing',      label: 'Routing',       icon: GitBranch, dim: null, href: '/routing-manager', color: '#6B7280' },
  { id: 'kam',          label: 'KAM View',      icon: Briefcase, dim: null, href: '/bitseye',         color: '#6B7280' },
];

function fmtDuration(secs: number) {
  if (!secs) return '—';
  const m = Math.floor(secs / 60), s = secs % 60;
  return `${m}m ${s}s`;
}

// ── Live Pill ─────────────────────────────────────────────────────────────────
function LivePill({ count, color }: { count: number; color: string }) {
  return (
    <motion.span
      key={count} initial={{ scale: count > 0 ? 1.25 : 1 }} animate={{ scale: 1 }} transition={{ duration: 0.2 }}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 3,
        background: count > 0 ? `${color}15` : '#F3F4F6',
        border: `1px solid ${count > 0 ? `${color}35` : '#E5E7EB'}`,
        borderRadius: 99, padding: '1px 7px', fontSize: 11, fontWeight: 700,
        color: count > 0 ? color : '#9CA3AF', minWidth: 26, justifyContent: 'center',
      }}
    >
      {count > 0 && <span style={{ width: 5, height: 5, borderRadius: '50%', background: color, display: 'inline-block', animation: 'be2-pulse 2s infinite' }} />}
      {count}
    </motion.span>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, color, icon: Icon, delay = 0 }: {
  label: string; value: string; sub?: string; color: string; icon: any; delay?: number;
}) {
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
      <div style={{ fontSize: 26, fontWeight: 800, color, letterSpacing: '-0.02em', lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 3 }}>{sub}</div>}
    </motion.div>
  );
}

// ── Entity Card (grid view) ───────────────────────────────────────────────────
function EntityCard({ entity, color, onClick, selected = false }: {
  entity: EntityRow; color: string; onClick: () => void; selected?: boolean;
}) {
  return (
    <motion.div
      whileHover={{ y: -2, boxShadow: '0 8px 20px rgba(0,0,0,0.09)' }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      style={{
        background: selected ? `${color}07` : '#fff', border: `1.5px solid ${selected ? color : '#E6EAF0'}`,
        borderRadius: 14, padding: '14px 16px', cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#1F2937', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, maxWidth: 165 }}>{entity.name}</span>
        <LivePill count={entity.active} color={color} />
      </div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 5, background: '#F0FDF4', color: '#16A34A', fontWeight: 600 }}>✓ {entity.connected}</span>
        <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 5, background: '#FFF7ED', color: '#D97706', fontWeight: 600 }}>⟳ {entity.routing}</span>
      </div>
      <div style={{ background: '#F3F4F6', borderRadius: 99, height: 4, overflow: 'hidden' }}>
        <motion.div
          initial={{ width: 0 }} animate={{ width: `${entity.connectRate}%` }} transition={{ duration: 0.55, ease: 'easeOut' }}
          style={{ height: '100%', borderRadius: 99, background: entity.connectRate >= 70 ? '#16A34A' : entity.connectRate >= 45 ? '#F59E0B' : '#EF4444' }}
        />
      </div>
      <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 4, textAlign: 'right' as const }}>{entity.connectRate}% connected</div>
    </motion.div>
  );
}

// ── Concurrent Chart ──────────────────────────────────────────────────────────
function ConcurrentChart({ points, color = '#2563EB', title, sub }: {
  points: ConcurrentPoint[]; color?: string; title?: string; sub?: string;
}) {
  const gradId = `grad-${color.replace('#', '')}`;
  return (
    <div style={{ background: '#fff', border: '1px solid #E6EAF0', borderRadius: 16, padding: '16px 20px', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#1F2937' }}>{title ?? 'Concurrent Call Stream'}</div>
        {sub && <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>{sub}</div>}
      </div>
      {points.length === 0
        ? <div style={{ height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#D1D5DB', fontSize: 13 }}>Building live history…</div>
        : <ResponsiveContainer width="100%" height={140}>
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
              <Area type="monotone" dataKey="active"    stroke={color}   strokeWidth={2}   fill={`url(#${gradId})`} dot={false} />
              <Area type="monotone" dataKey="connected" stroke="#16A34A" strokeWidth={1.5} fill="transparent"       dot={false} strokeDasharray="4 2" />
            </AreaChart>
          </ResponsiveContainer>
      }
    </div>
  );
}

// ── CPS Chart ─────────────────────────────────────────────────────────────────
function CpsChart({ points }: { points: ConcurrentPoint[] }) {
  const cpsData = useMemo(() =>
    points.slice(-20).map((p, i, arr) => {
      if (i === 0) return { label: p.label, cps: 0 };
      const prev = arr[i - 1];
      const deltaMs = p.ts - prev.ts;
      const cps = deltaMs > 0 ? parseFloat((Math.max(0, p.active - prev.active) / (deltaMs / 1000)).toFixed(2)) : 0;
      return { label: p.label, cps };
    }), [points]);

  return (
    <div style={{ background: '#fff', border: '1px solid #E6EAF0', borderRadius: 16, padding: '16px 20px', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#1F2937', marginBottom: 2 }}>CPS Monitor</div>
      <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 10 }}>Calls per second · surge detection</div>
      {cpsData.length < 2
        ? <div style={{ height: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#D1D5DB', fontSize: 12 }}>Building CPS history…</div>
        : <ResponsiveContainer width="100%" height={100}>
            <BarChart data={cpsData} margin={{ top: 0, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#9CA3AF' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 9, fill: '#9CA3AF' }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ background: '#fff', border: '1px solid #E6EAF0', borderRadius: 8, fontSize: 11 }} formatter={(v: any) => [`${v} /s`, 'CPS']} />
              <Bar dataKey="cps" fill="#F59E0B" radius={[3, 3, 0, 0]} maxBarSize={20} />
            </BarChart>
          </ResponsiveContainer>
      }
    </div>
  );
}

// ── Top-N mini table (NOC Overview) ──────────────────────────────────────────
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

// ── Cross-dimension table (used in entity drilldown) ──────────────────────────
function CrossTable({ title, rows, color, onRowClick }: {
  title: string; rows: CrossRow[]; color: string; onRowClick?: (name: string) => void;
}) {
  if (rows.length === 0) return null;
  const max = rows[0]?.active || 1;
  return (
    <div style={{ background: '#fff', border: '1px solid #E6EAF0', borderRadius: 14, padding: '14px 16px', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 10 }}>{title}</div>
      {rows.map((r, i) => {
        const pct = Math.round(r.active / max * 100);
        const crColor = r.connectRate >= 70 ? '#16A34A' : r.connectRate >= 45 ? '#F59E0B' : '#EF4444';
        return (
          <div
            key={r.name}
            onClick={() => onRowClick?.(r.name)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, cursor: onRowClick ? 'pointer' : 'default', padding: '3px 0', borderRadius: 6 }}
          >
            <span style={{ fontSize: 10, fontWeight: 700, color: '#D1D5DB', minWidth: 14 }}>{i + 1}</span>
            <span style={{ fontSize: 12, color: '#1F2937', flex: 1, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{r.name}</span>
            {/* Connect-rate dot */}
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: crColor, display: 'inline-block', flexShrink: 0 }} />
            {/* Bar */}
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

  function toggleExpand(id: SectionId) {
    setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
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

  const activeSec = SECTIONS.find(s => s.id === activeSection)!;

  // Entity detail — fires only when drilled in
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

  // Convert entity history to chart points
  const entityHistoryPts: ConcurrentPoint[] = useMemo(() =>
    (entityDetail?.entityHistory ?? []).map(p => ({
      ts: p.ts,
      label: new Date(p.ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
      active: p.count, connected: p.connected, routing: p.routing,
    })), [entityDetail],
  );

  // ── Navigate helper: cross-dim click ─────────────────────────────────────
  function drillCross(dim: string, name: string) {
    const s = SECTIONS.find(s => s.dim === dim);
    if (s) { setActiveSection(s.id); setSelectedEntity(name); }
  }

  // ── Sidebar ───────────────────────────────────────────────────────────────
  const sidebar = (
    <div style={{ width: 220, flexShrink: 0, borderRight: '1px solid #E6EAF0', background: '#FAFBFC', display: 'flex', flexDirection: 'column', overflowY: 'auto' as const }}>
      <div style={{ padding: '16px 14px 12px', borderBottom: '1px solid #E6EAF0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#16A34A', display: 'inline-block', animation: 'be2-pulse 2s infinite' }} />
          <span style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase' as const, letterSpacing: '0.08em' }}>BitsEye 2 · Live</span>
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, color: '#1F2937', letterSpacing: '-0.02em' }}>
          {cs?.currentActive ?? liveSummary?.total ?? '—'}
          <span style={{ fontSize: 12, fontWeight: 500, color: '#9CA3AF', marginLeft: 5 }}>active calls</span>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          <span style={{ fontSize: 11, color: '#16A34A', fontWeight: 600 }}>✓ {cs?.currentConnected ?? liveSummary?.connected ?? '—'}</span>
          <span style={{ fontSize: 11, color: '#F59E0B', fontWeight: 600 }}>⟳ {cs?.currentRouting ?? liveSummary?.routing ?? '—'}</span>
        </div>
      </div>

      <div style={{ flex: 1, padding: '6px 0' }}>
        {SECTIONS.map(sec => {
          const slice      = sec.dim ? dimToSlice[sec.dim] : undefined;
          const total      = slice?.total ?? 0;
          const isActive   = activeSection === sec.id;
          const isExpanded = expanded.has(sec.id);
          const Icon = sec.icon;
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
                    {slice.entities.slice(0, 8).map(ent => (
                      <motion.div
                        key={ent.name} whileHover={{ background: '#F9FAFB' }}
                        onClick={() => { setActiveSection(sec.id); setSelectedEntity(ent.name); }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px 5px 30px', cursor: 'pointer',
                          background: selectedEntity === ent.name && activeSection === sec.id ? `${sec.color}0C` : 'transparent',
                        }}
                      >
                        <span style={{ fontSize: 11, color: '#374151', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{ent.name}</span>
                        <LivePill count={ent.active} color={sec.color} />
                      </motion.div>
                    ))}
                    {slice.entities.length > 8 && (
                      <div style={{ fontSize: 10, color: '#9CA3AF', padding: '2px 12px 4px 30px' }}>+{slice.entities.length - 8} more</div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

      <div style={{ padding: '8px 12px', borderTop: '1px solid #E6EAF0', fontSize: 10, color: '#9CA3AF' }}>
        {isFetching
          ? '↻ Refreshing…'
          : liveSummary?.lastUpdated ? `Updated ${Math.round((Date.now() - liveSummary.lastUpdated) / 1000)}s ago` : 'Polling every 30s'}
      </div>
    </div>
  );

  // ── NOC Overview ──────────────────────────────────────────────────────────
  const nocPanel = (
    <div style={{ flex: 1, overflow: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 10 }}>
        <KpiCard label="Active Channels" value={String(cs?.currentActive ?? liveSummary?.total ?? '—')}           color="#2563EB" icon={Activity}   delay={0.00} />
        <KpiCard label="Connected"        value={String(liveSummary?.connected ?? cs?.currentConnected ?? '—')}  color="#16A34A" icon={TrendingUp} delay={0.05} />
        <KpiCard label="Routing"          value={String(liveSummary?.routing ?? cs?.currentRouting ?? '—')}      color="#F59E0B" icon={Zap}        delay={0.10} />
        <KpiCard
          label="Connect Rate" value={liveSummary ? `${liveSummary.liveConnectRatio}%` : '—'}
          color={liveSummary ? (liveSummary.liveConnectRatio >= 70 ? '#16A34A' : liveSummary.liveConnectRatio >= 45 ? '#F59E0B' : '#EF4444') : '#9CA3AF'}
          icon={BarChart2} delay={0.15}
        />
        <KpiCard label="Avg Duration" value={fmtDuration(liveSummary?.avgCallAgeSecs ?? 0)} color="#7C3AED" icon={Radio}      delay={0.20} sub="live ACD proxy" />
        <KpiCard label="Peak (4h)"    value={String(cs?.peakActive ?? '—')}                 color="#6B7280" icon={TrendingUp} delay={0.25} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
        <ConcurrentChart points={concPoints} title="Concurrent Call Stream" sub="5-min buckets · 4h window" />
        <CpsChart points={concPoints} />
      </div>

      <WorldMap
        entities={countrySlice?.entities ?? []}
        height={280}
        onCountryClick={name => { setActiveSection('countries'); setSelectedEntity(name); }}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        <TopTable title="Top Clients"      rows={clientSlice?.entities?.slice(0, 5).map(e => ({ name: e.name, active: e.active })) ?? []} color="#7C3AED" onSeeAll={() => { setActiveSection('clients');      setSelectedEntity(null); }} />
        <TopTable title="Top Vendors"      rows={vendorSlice?.entities?.slice(0, 5).map(e => ({ name: e.name, active: e.active })) ?? []} color="#0891B2" onSeeAll={() => { setActiveSection('vendors');      setSelectedEntity(null); }} />
        <TopTable title="Top Destinations" rows={destSlice?.entities?.slice(0, 5).map(e => ({ name: e.name, active: e.active })) ?? []}   color="#D97706" onSeeAll={() => { setActiveSection('destinations'); setSelectedEntity(null); }} />
      </div>
    </div>
  );

  // ── Entity dimension panel ────────────────────────────────────────────────
  const entityPanel = (
    <div style={{ flex: 1, overflow: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Breadcrumb */}
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

      {/* ── Drilldown view ── */}
      {selectedEntity && entityDetail ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* KPI strip */}
          <div style={{ display: 'flex', gap: 10 }}>
            <KpiCard label="Active"       value={String(entityDetail.active)}    color={activeSec.color} icon={Activity}   delay={0} />
            <KpiCard label="Connected"    value={String(entityDetail.connected)} color="#16A34A"         icon={TrendingUp} delay={0.05} />
            <KpiCard label="Routing"      value={String(entityDetail.routing)}   color="#F59E0B"         icon={Zap}        delay={0.10} />
            <KpiCard
              label="Connect Rate" value={`${entityDetail.connectRate}%`}
              color={entityDetail.connectRate >= 70 ? '#16A34A' : entityDetail.connectRate >= 45 ? '#F59E0B' : '#EF4444'}
              icon={BarChart2} delay={0.15}
            />
          </div>

          {/* Concurrent trend */}
          <ConcurrentChart
            points={entityHistoryPts.length > 0 ? entityHistoryPts : concPoints}
            color={activeSec.color}
            title={`${selectedEntity} — Concurrent Calls`}
            sub={entityHistoryPts.length > 0 ? `${entityHistoryPts.length} snapshots · 45s interval` : 'Global chart shown — entity history building…'}
          />

          {/* Cross-dimensional breakdown */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {/* Left column */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {entityDetail.topClients.length > 0 && (
                <CrossTable
                  title="Top Clients"
                  rows={entityDetail.topClients}
                  color="#7C3AED"
                  onRowClick={name => drillCross('client', name)}
                />
              )}
              {entityDetail.topVendors.length > 0 && (
                <CrossTable
                  title="Top Vendors"
                  rows={entityDetail.topVendors}
                  color="#0891B2"
                  onRowClick={name => drillCross('vendor', name)}
                />
              )}
            </div>
            {/* Right column */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {entityDetail.topCountries.length > 0 && (
                <CrossTable
                  title="Top Countries"
                  rows={entityDetail.topCountries}
                  color="#059669"
                  onRowClick={name => drillCross('country', name)}
                />
              )}
              {entityDetail.topDestinations.length > 0 && (
                <CrossTable
                  title="Top Destinations"
                  rows={entityDetail.topDestinations}
                  color="#D97706"
                  onRowClick={name => drillCross('destination', name)}
                />
              )}
            </div>
          </div>

          {entityDetail.active === 0 && (
            <div style={{ textAlign: 'center' as const, padding: '40px 0', color: '#9CA3AF', fontSize: 14 }}>
              No active calls for <strong>{selectedEntity}</strong> at this moment.
              <br /><span style={{ fontSize: 12 }}>Cross-dimensional data will appear when calls are live.</span>
            </div>
          )}
        </div>
      ) : selectedEntity ? (
        /* Loading state */
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: '#9CA3AF', fontSize: 13 }}>
          Loading {selectedEntity}…
        </div>
      ) : (
        /* Entity grid view */
        <>
          {activeSection === 'countries' && (
            <WorldMap
              entities={countrySlice?.entities ?? []}
              height={300}
              onCountryClick={setSelectedEntity}
            />
          )}
          <motion.div
            style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}
            variants={{ show: { transition: { staggerChildren: 0.04 } } }}
            initial="hidden" animate="show"
          >
            {activeDim?.entities?.map(ent => (
              <motion.div key={ent.name} variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}>
                <EntityCard entity={ent} color={activeSec.color} onClick={() => setSelectedEntity(ent.name)} />
              </motion.div>
            ))}
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

  const rightPanel = activeSection === 'noc' ? nocPanel : activeSec.dim ? entityPanel : nocPanel;

  // ── Layout ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#F7F9FC' }}>
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
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#16A34A', display: 'inline-block', animation: 'be2-pulse 2s infinite' }} />
            LIVE
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {isFetching && <RefreshCw style={{ width: 14, height: 14, color: '#2563EB', animation: 'be2-spin 1s linear infinite' }} />}
          <span style={{ fontSize: 11, color: '#D1D5DB' }}>30s refresh</span>
          <a href="/bitseye" style={{ fontSize: 11, color: '#9CA3AF', textDecoration: 'none', padding: '4px 10px', border: '1px solid #E6EAF0', borderRadius: 6 }}>← BitsEye v1</a>
        </div>
      </div>

      {/* Body */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {sidebar}
        <AnimatePresence mode="wait">
          <motion.div
            key={activeSection + (selectedEntity ?? '')}
            initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -6 }}
            transition={{ duration: 0.18 }}
            style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
          >
            {rightPanel}
          </motion.div>
        </AnimatePresence>
      </div>

      <style>{`
        @keyframes be2-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
        @keyframes be2-spin  { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

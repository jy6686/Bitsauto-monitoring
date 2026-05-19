import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar,
} from "recharts";
import {
  Radio, Users, Wifi, Globe, Phone, GitBranch, Briefcase, Shield,
  BarChart2, Cpu, ChevronDown, ChevronRight, RefreshCw,
  Activity, TrendingUp, Zap, ExternalLink,
} from "lucide-react";
import { useLocation } from "wouter";

// ── Types ────────────────────────────────────────────────────────────────────
interface EntityRow {
  name: string; active: number; connected: number; routing: number; connectRate: number;
}
interface LiveSliceResponse {
  groupBy: string; entities: EntityRow[]; total: number; stale: boolean; lastUpdated: number;
  entityHistory?: { ts: number; count: number; connected: number; routing: number }[];
}
interface LiveSummary {
  total: number; connected: number; routing: number;
  liveConnectRatio: number; avgCallAgeSecs: number; cps: number;
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

// ── Sidebar config ────────────────────────────────────────────────────────────
type SectionId = 'noc' | 'clients' | 'vendors' | 'countries' | 'destinations'
  | 'routing' | 'kam' | 'fraud' | 'quality' | 'aiops';

const SECTIONS: {
  id: SectionId; label: string; icon: any; dim: string | null;
  href?: string; color: string; badge?: string;
}[] = [
  { id: 'noc',          label: 'NOC Overview',   icon: Radio,     dim: null,           color: '#2563EB' },
  { id: 'clients',      label: 'Clients',         icon: Users,     dim: 'client',       color: '#7C3AED' },
  { id: 'vendors',      label: 'Vendors',         icon: Wifi,      dim: 'vendor',       color: '#0891B2' },
  { id: 'countries',    label: 'Countries',       icon: Globe,     dim: 'country',      color: '#059669' },
  { id: 'destinations', label: 'Destinations',    icon: Phone,     dim: 'destination',  color: '#D97706' },
  { id: 'routing',      label: 'Routing',         icon: GitBranch, dim: null, href: '/routing-manager', color: '#6B7280' },
  { id: 'kam',          label: 'KAM',             icon: Briefcase, dim: null, href: '/bitseye',          color: '#6B7280' },
  { id: 'fraud',        label: 'Fraud Monitor',   icon: Shield,    dim: null, href: '/fraud',            color: '#EF4444' },
  { id: 'quality',      label: 'Quality',         icon: BarChart2, dim: null, href: '/',                 color: '#6B7280', badge: 'NOC' },
  { id: 'aiops',        label: 'AI Ops',          icon: Cpu,       dim: null,           color: '#8B5CF6', badge: 'Soon' },
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
      key={count}
      initial={{ scale: count > 0 ? 1.25 : 1 }}
      animate={{ scale: 1 }}
      transition={{ duration: 0.2 }}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 3,
        background: count > 0 ? `${color}15` : '#F3F4F6',
        border: `1px solid ${count > 0 ? `${color}35` : '#E5E7EB'}`,
        borderRadius: 99, padding: '1px 7px', fontSize: 11, fontWeight: 700,
        color: count > 0 ? color : '#9CA3AF', minWidth: 26, justifyContent: 'center',
      }}
    >
      {count > 0 && (
        <span style={{
          width: 5, height: 5, borderRadius: '50%', background: color,
          display: 'inline-block', animation: 'be2-pulse 2s infinite',
        }} />
      )}
      {count}
    </motion.span>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────────
function KpiCard({
  label, value, sub, color, icon: Icon, delay = 0,
}: {
  label: string; value: string; sub?: string; color: string; icon: any; delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.28 }}
      whileHover={{ y: -2, boxShadow: '0 8px 24px rgba(0,0,0,0.09)' }}
      style={{
        background: '#fff', border: '1px solid #E6EAF0', borderRadius: 14,
        padding: '14px 18px', flex: 1, minWidth: 0,
        boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
        <div style={{
          width: 28, height: 28, borderRadius: 8, background: `${color}15`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon style={{ width: 14, height: 14, color }} />
        </div>
        <span style={{
          fontSize: 10, fontWeight: 700, color: '#9CA3AF',
          textTransform: 'uppercase', letterSpacing: '0.07em',
        }}>{label}</span>
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color, letterSpacing: '-0.02em', lineHeight: 1 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 3 }}>{sub}</div>}
    </motion.div>
  );
}

// ── Entity Card ───────────────────────────────────────────────────────────────
function EntityCard({
  entity, color, onClick, selected = false,
}: {
  entity: EntityRow; color: string; onClick: () => void; selected?: boolean;
}) {
  return (
    <motion.div
      whileHover={{ y: -2, boxShadow: '0 8px 20px rgba(0,0,0,0.09)' }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      style={{
        background: selected ? `${color}07` : '#fff',
        border: `1.5px solid ${selected ? color : '#E6EAF0'}`,
        borderRadius: 14, padding: '14px 16px', cursor: 'pointer',
        transition: 'border-color 0.2s',
        boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{
          fontSize: 13, fontWeight: 700, color: '#1F2937',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 165,
        }}>{entity.name}</span>
        <LivePill count={entity.active} color={color} />
      </div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 5, background: '#F0FDF4', color: '#16A34A', fontWeight: 600 }}>
          ✓ {entity.connected}
        </span>
        <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 5, background: '#FFF7ED', color: '#D97706', fontWeight: 600 }}>
          ⟳ {entity.routing}
        </span>
      </div>
      <div style={{ background: '#F3F4F6', borderRadius: 99, height: 4, overflow: 'hidden' }}>
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${entity.connectRate}%` }}
          transition={{ duration: 0.55, ease: 'easeOut' }}
          style={{
            height: '100%', borderRadius: 99,
            background: entity.connectRate >= 70 ? '#16A34A' : entity.connectRate >= 45 ? '#F59E0B' : '#EF4444',
          }}
        />
      </div>
      <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 4, textAlign: 'right' }}>
        {entity.connectRate}% connected
      </div>
    </motion.div>
  );
}

// ── Concurrent Chart ──────────────────────────────────────────────────────────
function ConcurrentChart({
  points, color = '#2563EB', title, sub,
}: {
  points: ConcurrentPoint[]; color?: string; title?: string; sub?: string;
}) {
  const gradId = `grad-${color.replace('#', '')}`;
  return (
    <div style={{ background: '#fff', border: '1px solid #E6EAF0', borderRadius: 16, padding: '16px 20px', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#1F2937' }}>{title ?? 'Concurrent Call Stream'}</div>
        {sub && <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>{sub}</div>}
      </div>
      {points.length === 0 ? (
        <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#D1D5DB', fontSize: 13 }}>
          Building live history…
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={160}>
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
            <Tooltip
              contentStyle={{ background: '#fff', border: '1px solid #E6EAF0', borderRadius: 10, fontSize: 12 }}
              formatter={(val: any, name: string) => [val, name === 'active' ? 'Active' : name === 'connected' ? 'Connected' : 'Routing']}
            />
            <Area type="monotone" dataKey="active"    stroke={color}    strokeWidth={2}   fill={`url(#${gradId})`} dot={false} />
            <Area type="monotone" dataKey="connected" stroke="#16A34A"  strokeWidth={1.5} fill="transparent"       dot={false} strokeDasharray="4 2" />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// ── CPS Chart ─────────────────────────────────────────────────────────────────
function CpsChart({ points }: { points: ConcurrentPoint[] }) {
  const cpsData = useMemo(() => {
    return points.slice(-20).map((p, i, arr) => {
      if (i === 0) return { label: p.label, cps: 0 };
      const prev = arr[i - 1];
      const deltaMs = p.ts - prev.ts;
      const delta   = Math.max(0, p.active - prev.active);
      const cps = deltaMs > 0 ? parseFloat((delta / (deltaMs / 1000)).toFixed(2)) : 0;
      return { label: p.label, cps };
    });
  }, [points]);

  return (
    <div style={{ background: '#fff', border: '1px solid #E6EAF0', borderRadius: 16, padding: '16px 20px', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#1F2937', marginBottom: 2 }}>CPS Monitor</div>
      <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 10 }}>Calls per second · surge detection</div>
      {cpsData.length < 2 ? (
        <div style={{ height: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#D1D5DB', fontSize: 12 }}>
          Building CPS history…
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={100}>
          <BarChart data={cpsData} margin={{ top: 0, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#9CA3AF' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 9, fill: '#9CA3AF' }} tickLine={false} axisLine={false} />
            <Tooltip
              contentStyle={{ background: '#fff', border: '1px solid #E6EAF0', borderRadius: 8, fontSize: 11 }}
              formatter={(v: any) => [`${v} /s`, 'CPS']}
            />
            <Bar dataKey="cps" fill="#F59E0B" radius={[3, 3, 0, 0]} maxBarSize={20} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// ── Top-N mini table ──────────────────────────────────────────────────────────
function TopTable({
  title, rows, color, onSeeAll,
}: {
  title: string; rows: { name: string; active: number }[]; color: string; onSeeAll: () => void;
}) {
  return (
    <div style={{ background: '#fff', border: '1px solid #E6EAF0', borderRadius: 14, padding: '14px 16px', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#374151' }}>{title}</span>
        <button
          onClick={onSeeAll}
          style={{ fontSize: 10, color, fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer' }}
        >
          See all →
        </button>
      </div>
      {rows.length === 0
        ? <div style={{ fontSize: 12, color: '#D1D5DB', textAlign: 'center', padding: '12px 0' }}>No active calls</div>
        : rows.map((r, i) => {
          const pct = Math.round(r.active / (rows[0]?.active || 1) * 100);
          return (
            <div key={r.name} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: '#D1D5DB', minWidth: 14 }}>{i + 1}</span>
              <span style={{ fontSize: 12, color: '#374151', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
              <div style={{ width: 40, height: 3, background: '#F3F4F6', borderRadius: 99 }}>
                <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 99 }} />
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, color, minWidth: 20, textAlign: 'right' }}>{r.active}</span>
            </div>
          );
        })
      }
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function BitsEye2Page() {
  const [, navigate] = useLocation();
  const [activeSection, setActiveSection] = useState<SectionId>('noc');
  const [selectedEntity, setSelectedEntity]   = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<SectionId>>(
    new Set(['noc', 'clients', 'vendors', 'countries', 'destinations']),
  );

  function toggleExpand(id: SectionId) {
    setExpanded(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  // ── Data queries ─────────────────────────────────────────────────────────
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

  // Per-entity history when a specific entity is drilled into
  const activeSec = SECTIONS.find(s => s.id === activeSection)!;
  const { data: entitySlice } = useQuery<LiveSliceResponse>({
    queryKey: ['/api/bitseye/live-slice', activeSec.dim, selectedEntity],
    queryFn: () =>
      fetch(`/api/bitseye/live-slice?groupBy=${activeSec.dim}&entity=${encodeURIComponent(selectedEntity!)}`).then(r => r.json()),
    staleTime: 20_000, refetchInterval: 30_000,
    enabled: !!selectedEntity && !!activeSec.dim,
  });

  const dimToSlice: Record<string, LiveSliceResponse | undefined> = {
    client: clientSlice, vendor: vendorSlice, country: countrySlice, destination: destSlice,
  };

  const cs          = concTrend?.summary;
  const concPoints  = concTrend?.points ?? [];
  const isFetching  = fetchSum || fetchConc;
  const activeDim   = activeSec.dim ? dimToSlice[activeSec.dim] : undefined;

  const entityHistoryPts: ConcurrentPoint[] = useMemo(() =>
    (entitySlice?.entityHistory ?? []).map(p => ({
      ts: p.ts, label: new Date(p.ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
      active: p.count, connected: p.connected, routing: p.routing,
    })),
    [entitySlice],
  );

  // ── Sidebar ───────────────────────────────────────────────────────────────
  const sidebar = (
    <div style={{
      width: 224, flexShrink: 0, borderRight: '1px solid #E6EAF0',
      background: '#FAFBFC', display: 'flex', flexDirection: 'column', overflowY: 'auto',
    }}>
      {/* Sidebar header — live total */}
      <div style={{ padding: '16px 14px 12px', borderBottom: '1px solid #E6EAF0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#16A34A', display: 'inline-block', animation: 'be2-pulse 2s infinite' }} />
          <span style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.08em' }}>BitsEye 2 · Live</span>
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

      {/* Section list */}
      <div style={{ flex: 1, padding: '6px 0' }}>
        {SECTIONS.map(sec => {
          const slice   = sec.dim ? dimToSlice[sec.dim] : undefined;
          const total   = slice?.total ?? 0;
          const isActive   = activeSection === sec.id;
          const isExpanded = expanded.has(sec.id);
          const Icon = sec.icon;

          return (
            <div key={sec.id}>
              <motion.div
                whileHover={{ background: '#F3F4F6' }}
                onClick={() => {
                  if (sec.href) { navigate(sec.href); return; }
                  setActiveSection(sec.id);
                  setSelectedEntity(null);
                  if (sec.dim) toggleExpand(sec.id);
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 7,
                  padding: '8px 12px', cursor: 'pointer',
                  background: isActive ? `${sec.color}0C` : 'transparent',
                  borderLeft: `3px solid ${isActive ? sec.color : 'transparent'}`,
                  transition: 'background 0.15s',
                }}
              >
                <Icon style={{ width: 14, height: 14, color: isActive ? sec.color : '#6B7280', flexShrink: 0 }} />
                <span style={{ fontSize: 12, fontWeight: isActive ? 700 : 500, color: isActive ? sec.color : '#374151', flex: 1, minWidth: 0 }}>
                  {sec.label}
                </span>
                {sec.badge ? (
                  <span style={{ fontSize: 9, fontWeight: 700, background: '#F3F4F6', color: '#9CA3AF', padding: '1px 5px', borderRadius: 4 }}>
                    {sec.badge}
                  </span>
                ) : sec.href ? (
                  <ExternalLink style={{ width: 10, height: 10, color: '#D1D5DB' }} />
                ) : sec.dim ? (
                  <>
                    <LivePill count={total} color={sec.color} />
                    <ChevronDown style={{
                      width: 11, height: 11, color: '#9CA3AF',
                      transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)',
                      transition: 'transform 0.2s', flexShrink: 0,
                    }} />
                  </>
                ) : null}
              </motion.div>

              {/* Entity sub-list */}
              <AnimatePresence initial={false}>
                {sec.dim && isExpanded && slice && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.22 }}
                    style={{ overflow: 'hidden' }}
                  >
                    {slice.entities.slice(0, 8).map(ent => (
                      <motion.div
                        key={ent.name}
                        whileHover={{ background: '#F9FAFB' }}
                        onClick={() => { setActiveSection(sec.id); setSelectedEntity(ent.name); }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 6,
                          padding: '5px 12px 5px 30px', cursor: 'pointer',
                          background: selectedEntity === ent.name && activeSection === sec.id
                            ? `${sec.color}0C` : 'transparent',
                        }}
                      >
                        <span style={{ fontSize: 11, color: '#374151', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {ent.name}
                        </span>
                        <LivePill count={ent.active} color={sec.color} />
                      </motion.div>
                    ))}
                    {slice.entities.length > 8 && (
                      <div style={{ fontSize: 10, color: '#9CA3AF', padding: '2px 12px 4px 30px' }}>
                        +{slice.entities.length - 8} more
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div style={{ padding: '8px 12px', borderTop: '1px solid #E6EAF0', fontSize: 10, color: '#9CA3AF' }}>
        {isFetching
          ? '↻ Refreshing…'
          : liveSummary?.lastUpdated
            ? `Updated ${Math.round((Date.now() - liveSummary.lastUpdated) / 1000)}s ago`
            : 'Polling every 30s'}
      </div>
    </div>
  );

  // ── NOC Overview panel ────────────────────────────────────────────────────
  const nocPanel = (
    <div style={{ flex: 1, overflow: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* KPI strip */}
      <div style={{ display: 'flex', gap: 10 }}>
        <KpiCard label="Active Channels" value={String(cs?.currentActive ?? liveSummary?.total ?? '—')}          color="#2563EB" icon={Activity}   delay={0.00} />
        <KpiCard label="Connected"        value={String(liveSummary?.connected ?? cs?.currentConnected ?? '—')} color="#16A34A" icon={TrendingUp} delay={0.05} />
        <KpiCard label="Routing"          value={String(liveSummary?.routing   ?? cs?.currentRouting   ?? '—')} color="#F59E0B" icon={Zap}        delay={0.10} />
        <KpiCard
          label="Connect Rate"
          value={liveSummary ? `${liveSummary.liveConnectRatio}%` : '—'}
          color={liveSummary ? (liveSummary.liveConnectRatio >= 70 ? '#16A34A' : liveSummary.liveConnectRatio >= 45 ? '#F59E0B' : '#EF4444') : '#9CA3AF'}
          icon={BarChart2} delay={0.15}
        />
        <KpiCard label="Avg Duration"     value={fmtDuration(liveSummary?.avgCallAgeSecs ?? 0)}                color="#7C3AED" icon={Radio}      delay={0.20} sub="live ACD proxy" />
        <KpiCard label="Peak (4h)"        value={String(cs?.peakActive ?? '—')}                               color="#6B7280" icon={TrendingUp} delay={0.25} />
      </div>

      {/* Charts row */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
        <ConcurrentChart
          points={concPoints}
          title="Concurrent Call Stream"
          sub="avg concurrent · live · 5-min buckets"
        />
        <CpsChart points={concPoints} />
      </div>

      {/* Top-N tables */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        <TopTable
          title="Top Clients"
          rows={clientSlice?.entities?.slice(0, 5).map(e => ({ name: e.name, active: e.active })) ?? []}
          color="#7C3AED"
          onSeeAll={() => { setActiveSection('clients'); setSelectedEntity(null); }}
        />
        <TopTable
          title="Top Vendors"
          rows={vendorSlice?.entities?.slice(0, 5).map(e => ({ name: e.name, active: e.active })) ?? []}
          color="#0891B2"
          onSeeAll={() => { setActiveSection('vendors'); setSelectedEntity(null); }}
        />
        <TopTable
          title="Top Countries"
          rows={countrySlice?.entities?.slice(0, 5).map(e => ({ name: e.name, active: e.active })) ?? []}
          color="#059669"
          onSeeAll={() => { setActiveSection('countries'); setSelectedEntity(null); }}
        />
      </div>
    </div>
  );

  // ── Entity dimension panel (Clients / Vendors / Countries / Destinations) ──
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
            <span style={{ color: '#374151', fontWeight: 600 }}>{selectedEntity}</span>
            <button
              onClick={() => setSelectedEntity(null)}
              style={{ marginLeft: 6, fontSize: 10, color: '#9CA3AF', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              ✕
            </button>
          </>
        )}
      </div>

      {/* Single entity drill-down */}
      {selectedEntity ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {(() => {
            const e = activeDim?.entities?.find(x => x.name === selectedEntity);
            if (!e) return null;
            return (
              <div style={{ display: 'flex', gap: 10 }}>
                <KpiCard label="Active"       value={String(e.active)}    color={activeSec.color} icon={Activity}   delay={0.00} />
                <KpiCard label="Connected"    value={String(e.connected)} color="#16A34A"          icon={TrendingUp} delay={0.05} />
                <KpiCard label="Routing"      value={String(e.routing)}   color="#F59E0B"          icon={Zap}        delay={0.10} />
                <KpiCard
                  label="Connect Rate" value={`${e.connectRate}%`}
                  color={e.connectRate >= 70 ? '#16A34A' : e.connectRate >= 45 ? '#F59E0B' : '#EF4444'}
                  icon={BarChart2} delay={0.15}
                />
              </div>
            );
          })()}
          <ConcurrentChart
            points={entityHistoryPts.length > 0 ? entityHistoryPts : concPoints}
            color={activeSec.color}
            title={`${selectedEntity} — Concurrent Calls`}
            sub={entityHistoryPts.length > 0 ? 'per-entity live history' : 'global chart (entity history building…)'}
          />
        </div>
      ) : (
        /* Entity card grid */
        <motion.div
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}
          variants={{ show: { transition: { staggerChildren: 0.04 } } }}
          initial="hidden" animate="show"
        >
          {activeDim?.entities?.map(ent => (
            <motion.div
              key={ent.name}
              variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}
            >
              <EntityCard
                entity={ent}
                color={activeSec.color}
                onClick={() => setSelectedEntity(ent.name)}
              />
            </motion.div>
          ))}
          {(!activeDim || activeDim.entities.length === 0) && (
            <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '60px 0', color: '#9CA3AF', fontSize: 14 }}>
              No active calls in this dimension right now
            </div>
          )}
        </motion.div>
      )}
    </div>
  );

  // ── AI Ops placeholder ────────────────────────────────────────────────────
  const aiPanel = (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16, padding: 40 }}>
      <div style={{ width: 64, height: 64, borderRadius: 18, background: '#F3E8FF', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Cpu style={{ width: 32, height: 32, color: '#8B5CF6' }} />
      </div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: '#1F2937' }}>AI Ops</div>
        <div style={{ fontSize: 14, color: '#9CA3AF', marginTop: 6, maxWidth: 320 }}>
          Anomaly detection, auto-route suggestions and traffic forecasting.
          <br /><span style={{ color: '#8B5CF6', fontWeight: 600 }}>Coming in the next phase.</span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', maxWidth: 380 }}>
        {['Live Anomalies', 'Route Recommendations', 'Carrier Scoring', 'Traffic Forecast', 'Auto-Heal Alerts'].map(f => (
          <span key={f} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 99, border: '1px solid #E9D5FF', color: '#7C3AED', background: '#FAFAFE' }}>
            {f}
          </span>
        ))}
      </div>
    </div>
  );

  const rightPanel = activeSection === 'noc'   ? nocPanel
    : activeSection === 'aiops' ? aiPanel
    : activeSec.dim             ? entityPanel
    : nocPanel;

  // ── Page layout ───────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#F7F9FC' }}>
      {/* Top bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 20px', background: '#fff', borderBottom: '1px solid #E6EAF0', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 9,
            background: 'linear-gradient(135deg, #2563EB 0%, #7C3AED 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Radio style={{ width: 16, height: 16, color: '#fff' }} />
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#1F2937', letterSpacing: '-0.01em' }}>BitsEye 2</div>
            <div style={{ fontSize: 10, color: '#9CA3AF', fontWeight: 500 }}>Live Telecom Operations Intelligence</div>
          </div>
          <span style={{
            marginLeft: 8, display: 'flex', alignItems: 'center', gap: 5,
            fontSize: 11, fontWeight: 600, color: '#16A34A',
            background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 99, padding: '2px 8px',
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#16A34A', display: 'inline-block', animation: 'be2-pulse 2s infinite' }} />
            LIVE
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {isFetching && <RefreshCw style={{ width: 14, height: 14, color: '#2563EB', animation: 'be2-spin 1s linear infinite' }} />}
          <span style={{ fontSize: 11, color: '#D1D5DB' }}>30s refresh</span>
          <a
            href="/bitseye"
            style={{ fontSize: 11, color: '#9CA3AF', textDecoration: 'none', padding: '4px 10px', border: '1px solid #E6EAF0', borderRadius: 6 }}
          >
            ← BitsEye v1
          </a>
        </div>
      </div>

      {/* Body */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {sidebar}
        <AnimatePresence mode="wait">
          <motion.div
            key={activeSection + (selectedEntity ?? '')}
            initial={{ opacity: 0, x: 6 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -6 }}
            transition={{ duration: 0.18 }}
            style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
          >
            {rightPanel}
          </motion.div>
        </AnimatePresence>
      </div>

      <style>{`
        @keyframes be2-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
        @keyframes be2-spin  { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

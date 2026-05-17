import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, CheckCircle2, ShieldAlert, TrendingDown, Eye, Ban, RefreshCw, ChevronDown, Filter, Info } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Connection {
  id: number;
  connectionName: string;
  totalCalls: number;
  connectedCalls: number;
  asr: number;
  acd: number;
  pdd: number;
  cost: number;
  healthScore: number;
  healthBand: 'excellent' | 'stable' | 'warning' | 'critical' | 'unscored';
  state: 'HEALTHY' | 'STABLE' | 'DEGRADED' | 'CRITICAL' | 'FAS_RISK' | 'UNSCORED';
  fasSeverity: 'CRITICAL' | 'MEDIUM' | 'LOW' | null;
  confidenceLevel: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  recommendation: string | null;
  flags: string[];
}

interface CiSummary {
  total: number; healthy: number; stable: number;
  degraded: number; critical: number; fasRisk: number;
  unscored: number; needsAction: number;
}

interface CiResponse {
  ok: boolean; period: string; fetchedAt: string;
  summary: CiSummary; connections: Connection[];
}

// ── State config ──────────────────────────────────────────────────────────────
const STATE_CFG: Record<string, { label: string; bg: string; text: string; border: string; dot: string }> = {
  HEALTHY:   { label: 'Healthy',   bg: '#F0FDF4', text: '#15803D', border: '#BBF7D0', dot: '#22C55E' },
  STABLE:    { label: 'Stable',    bg: '#F0F9FF', text: '#0369A1', border: '#BAE6FD', dot: '#38BDF8' },
  DEGRADED:  { label: 'Degraded',  bg: '#FFFBEB', text: '#B45309', border: '#FDE68A', dot: '#F59E0B' },
  CRITICAL:  { label: 'Critical',  bg: '#FEF2F2', text: '#B91C1C', border: '#FECACA', dot: '#EF4444' },
  FAS_RISK:  { label: 'FAS Risk',  bg: '#FDF4FF', text: '#7E22CE', border: '#E9D5FF', dot: '#A855F7' },
  UNSCORED:  { label: 'Unscored',  bg: '#F9FAFB', text: '#6B7280', border: '#E5E7EB', dot: '#9CA3AF' },
};

const FAS_CFG: Record<string, { label: string; bg: string; text: string }> = {
  CRITICAL: { label: 'FAS Critical', bg: '#FDF4FF', text: '#7E22CE' },
  MEDIUM:   { label: 'FAS Medium',   bg: '#FFF7ED', text: '#C2410C' },
  LOW:      { label: 'FAS Low',      bg: '#FFFBEB', text: '#B45309' },
};

const REC_CFG: Record<string, { label: string; icon: typeof ShieldAlert; color: string }> = {
  INVESTIGATE_FAS:  { label: 'Investigate FAS',   icon: ShieldAlert,    color: '#7E22CE' },
  MONITOR_FAS:      { label: 'Monitor FAS',        icon: Eye,            color: '#B45309' },
  SUPPRESS_ROUTE:   { label: 'Suppress Route',     icon: Ban,            color: '#B91C1C' },
  PENALIZE_PRIORITY:{ label: 'Penalise Priority',  icon: TrendingDown,   color: '#B45309' },
  MONITOR_CLOSELY:  { label: 'Monitor Closely',    icon: Eye,            color: '#0369A1' },
};

const CONF_CLR: Record<string, string> = {
  HIGH: '#15803D', MEDIUM: '#B45309', LOW: '#6B7280', NONE: '#D1D5DB',
};

const PERIODS = [
  { label: '30m',  value: 30  },
  { label: '90m',  value: 90  },
  { label: '4h',   value: 240 },
  { label: '24h',  value: 1440},
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtAcd(secs: number) {
  if (!secs) return '—';
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}
function asrColor(asr: number) {
  if (asr === 0) return '#DC2626';
  if (asr >= 60) return '#16A34A';
  if (asr >= 35) return '#D97706';
  return '#DC2626';
}

// ── Health Score Bar ──────────────────────────────────────────────────────────
function HealthBar({ score }: { score: number }) {
  const clr = score >= 75 ? '#22C55E' : score >= 55 ? '#38BDF8' : score >= 35 ? '#F59E0B' : score > 0 ? '#EF4444' : '#D1D5DB';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ flex: 1, height: 5, background: '#F3F4F6', borderRadius: 99, overflow: 'hidden', minWidth: 60 }}>
        <div style={{ width: `${score}%`, height: '100%', background: clr, borderRadius: 99, transition: 'width 0.4s' }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 700, color: clr, minWidth: 26, textAlign: 'right' }}>{score || '—'}</span>
    </div>
  );
}

// ── State Badge ───────────────────────────────────────────────────────────────
function StateBadge({ state }: { state: string }) {
  const cfg = STATE_CFG[state] ?? STATE_CFG.UNSCORED;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '2px 9px', borderRadius: 99, fontSize: 10.5, fontWeight: 700,
      background: cfg.bg, color: cfg.text, border: `1px solid ${cfg.border}`,
      whiteSpace: 'nowrap',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: cfg.dot, flexShrink: 0 }} />
      {cfg.label}
    </span>
  );
}

// ── Recommendation Chip ───────────────────────────────────────────────────────
function RecChip({ rec }: { rec: string | null }) {
  if (!rec) return <span style={{ color: '#D1D5DB', fontSize: 11 }}>—</span>;
  const cfg = REC_CFG[rec];
  if (!cfg) return <span style={{ fontSize: 10.5, color: '#6B7280' }}>{rec}</span>;
  const Icon = cfg.icon;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 6, fontSize: 10.5, fontWeight: 600,
      background: cfg.color + '14', color: cfg.color, border: `1px solid ${cfg.color}30`,
      whiteSpace: 'nowrap',
    }}>
      <Icon style={{ width: 11, height: 11 }} />
      {cfg.label}
    </span>
  );
}

// ── Summary Tile ──────────────────────────────────────────────────────────────
function SummaryTile({ label, value, color, bg }: { label: string; value: number; color: string; bg: string }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '14px 10px', borderRadius: 12, background: bg, border: `1px solid ${color}25`,
      minWidth: 80, flex: 1, gap: 3,
    }}>
      <span style={{ fontSize: 24, fontWeight: 800, color, lineHeight: 1 }}>{value}</span>
      <span style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: color + 'AA' }}>{label}</span>
    </div>
  );
}

// ── Recommendation Card ───────────────────────────────────────────────────────
function RecommendationCard({ conn }: { conn: Connection }) {
  const [open, setOpen] = useState(false);
  const rec = REC_CFG[conn.recommendation ?? ''];
  const fas = conn.fasSeverity ? FAS_CFG[conn.fasSeverity] : null;
  const stateCfg = STATE_CFG[conn.state] ?? STATE_CFG.UNSCORED;

  const reasons: string[] = [];
  if (conn.totalCalls >= 30 && conn.asr === 0)       reasons.push(`${conn.totalCalls} calls with 0% ASR — complete route failure`);
  if (conn.fasSeverity === 'CRITICAL')               reasons.push(`ASR ${conn.asr.toFixed(1)}% with ACD ${fmtAcd(conn.acd)} — high-confidence FAS pattern`);
  if (conn.fasSeverity === 'MEDIUM')                 reasons.push(`ASR ${conn.asr.toFixed(1)}% with ACD ${fmtAcd(conn.acd)} — probable FAS behaviour`);
  if (conn.fasSeverity === 'LOW')                    reasons.push(`ASR ${conn.asr.toFixed(1)}% with ACD ${fmtAcd(conn.acd)} — suspicious quality`);
  if (conn.state === 'CRITICAL' && conn.asr > 0)     reasons.push(`Health score ${conn.healthScore}/100 — critically degraded`);
  if (conn.state === 'DEGRADED')                     reasons.push(`Health score ${conn.healthScore}/100 — below operational threshold`);
  if (conn.confidenceLevel === 'LOW')                reasons.push(`Low confidence — only ${conn.totalCalls} calls sampled`);
  if (reasons.length === 0)                          reasons.push(`Anomalous behaviour detected — manual review recommended`);

  return (
    <div style={{
      background: '#FFFFFF', border: `1px solid ${stateCfg.border}`,
      borderLeft: `4px solid ${stateCfg.dot}`, borderRadius: 12,
      overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px' }}>
        <StateBadge state={conn.state} />
        {fas && (
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 99,
            background: fas.bg, color: fas.text,
          }}>{fas.label}</span>
        )}
        <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {conn.connectionName}
        </span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
          <span style={{ fontSize: 10.5, color: '#6B7280' }}>
            {conn.totalCalls} calls · ASR <span style={{ fontWeight: 700, color: asrColor(conn.asr) }}>{conn.asr.toFixed(1)}%</span> · ACD {fmtAcd(conn.acd)}
          </span>
          <button
            onClick={() => setOpen(o => !o)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: '#9CA3AF' }}
          >
            <ChevronDown style={{ width: 14, height: 14, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
          </button>
        </div>
      </div>

      {/* Recommendation + Actions */}
      <div style={{ padding: '0 16px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <RecChip rec={conn.recommendation} />
        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
          {(['Investigate', 'Penalise', 'Suppress 15m', 'Monitor'] as const).slice(0, conn.state === 'HEALTHY' ? 1 : 3).map(action => (
            <button
              key={action}
              style={{
                padding: '4px 10px', borderRadius: 6, fontSize: 10.5, fontWeight: 600, cursor: 'pointer',
                background: '#F9FAFB', border: '1px solid #E5E7EB', color: '#374151',
              }}
            >
              {action}
            </button>
          ))}
        </div>
      </div>

      {/* Expandable reason block */}
      {open && (
        <div style={{ padding: '10px 16px 14px', borderTop: '1px solid #F3F4F6', background: '#FAFAFA' }}>
          <p style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
            Reason
          </p>
          {reasons.map((r, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 7, marginBottom: 4 }}>
              <span style={{ color: stateCfg.dot, fontSize: 10, marginTop: 2 }}>•</span>
              <span style={{ fontSize: 11.5, color: '#374151' }}>{r}</span>
            </div>
          ))}
          <div style={{ marginTop: 10, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {[
              { label: 'Health Score', value: `${conn.healthScore}/100` },
              { label: 'Confidence',   value: conn.confidenceLevel },
              { label: 'PDD',          value: conn.pdd > 0 ? `${conn.pdd.toFixed(1)}s` : '—' },
              { label: 'Cost',         value: conn.cost > 0 ? `$${conn.cost.toFixed(4)}` : '—' },
            ].map(item => (
              <div key={item.label}>
                <span style={{ fontSize: 9, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block' }}>{item.label}</span>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: '#1F2937' }}>{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function CarrierIntelligencePage() {
  const [period, setPeriod]     = useState(90);
  const [tab, setTab]           = useState<'matrix' | 'recommendations'>('matrix');
  const [stateFilter, setStateFilter] = useState<string>('ALL');
  const [searchQ, setSearchQ]   = useState('');

  const { data, isFetching, refetch } = useQuery<CiResponse>({
    queryKey: ['/api/carrier-intelligence', period],
    queryFn: async () => {
      const r = await fetch(`/api/carrier-intelligence?period=${period}`);
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    staleTime:       55_000,
    refetchInterval: 120_000,
  });

  const connections = useMemo(() => data?.connections ?? [], [data]);
  const summary     = useMemo(() => data?.summary ?? {} as CiSummary, [data]);

  const filtered = useMemo(() => {
    let rows = connections;
    if (stateFilter !== 'ALL') rows = rows.filter(c => c.state === stateFilter);
    if (searchQ.trim()) {
      const q = searchQ.toLowerCase();
      rows = rows.filter(c => c.connectionName.toLowerCase().includes(q));
    }
    return rows;
  }, [connections, stateFilter, searchQ]);

  const recommendations = useMemo(
    () => connections.filter(c => c.recommendation !== null),
    [connections],
  );

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1400, margin: '0 auto', fontFamily: 'Inter, system-ui, sans-serif' }}>

      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24 }}>
        <div style={{ background: 'linear-gradient(135deg,#7C3AED,#4F46E5)', borderRadius: 12, padding: 10, flexShrink: 0 }}>
          <Activity style={{ width: 20, height: 20, color: '#FFFFFF' }} />
        </div>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: '#111827', margin: 0 }}>Carrier Intelligence</h1>
          <p style={{ fontSize: 12, color: '#6B7280', margin: '2px 0 0' }}>
            Route health scoring · FAS detection · Zero-ASR suppression recommendations
          </p>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Period selector */}
          <div style={{ display: 'flex', gap: 2, background: '#F3F4F6', padding: 3, borderRadius: 8 }}>
            {PERIODS.map(p => (
              <button key={p.value} onClick={() => setPeriod(p.value)} style={{
                padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: 'none',
                background: period === p.value ? '#FFFFFF' : 'transparent',
                color: period === p.value ? '#111827' : '#6B7280',
                boxShadow: period === p.value ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              }}>{p.label}</button>
            ))}
          </div>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8,
              background: '#F9FAFB', border: '1px solid #E5E7EB', color: '#374151',
              fontSize: 11, fontWeight: 600, cursor: 'pointer',
            }}
          >
            <RefreshCw style={{ width: 13, height: 13, animation: isFetching ? 'spin 1s linear infinite' : 'none' }} />
            Refresh
          </button>
        </div>
      </div>

      {/* Summary tiles */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 24, flexWrap: 'wrap' }}>
        <SummaryTile label="Total Routes"   value={summary.total      ?? 0} color="#6B7280" bg="#F9FAFB" />
        <SummaryTile label="Healthy"        value={summary.healthy    ?? 0} color="#15803D" bg="#F0FDF4" />
        <SummaryTile label="Stable"         value={summary.stable     ?? 0} color="#0369A1" bg="#F0F9FF" />
        <SummaryTile label="Degraded"       value={summary.degraded   ?? 0} color="#B45309" bg="#FFFBEB" />
        <SummaryTile label="Critical"       value={summary.critical   ?? 0} color="#B91C1C" bg="#FEF2F2" />
        <SummaryTile label="FAS Risk"       value={summary.fasRisk    ?? 0} color="#7E22CE" bg="#FDF4FF" />
        <SummaryTile label="Needs Action"   value={summary.needsAction?? 0} color="#7C3AED" bg="#F5F3FF" />
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '2px solid #F3F4F6', marginBottom: 20, gap: 0 }}>
        {[
          { id: 'matrix',          label: 'Route Health Matrix', count: connections.length },
          { id: 'recommendations', label: 'Recommendations',     count: recommendations.length },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id as any)}
            style={{
              padding: '10px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer', border: 'none', background: 'none',
              color: tab === t.id ? '#7C3AED' : '#6B7280',
              borderBottom: tab === t.id ? '2px solid #7C3AED' : '2px solid transparent',
              marginBottom: -2,
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            {t.label}
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 99,
              background: tab === t.id ? '#7C3AED20' : '#F3F4F6',
              color: tab === t.id ? '#7C3AED' : '#9CA3AF',
            }}>{t.count}</span>
          </button>
        ))}
      </div>

      {/* ── TAB 1: Route Health Matrix ─────────────────────────────────────── */}
      {tab === 'matrix' && (
        <>
          {/* Filters */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <input
                placeholder="Search connection..."
                value={searchQ}
                onChange={e => setSearchQ(e.target.value)}
                style={{
                  padding: '7px 12px 7px 32px', borderRadius: 8, border: '1px solid #E5E7EB',
                  fontSize: 12, color: '#374151', outline: 'none', width: 200, background: '#FAFAFA',
                }}
              />
              <Filter style={{ width: 13, height: 13, position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#9CA3AF' }} />
            </div>
            {['ALL', 'CRITICAL', 'FAS_RISK', 'DEGRADED', 'STABLE', 'HEALTHY', 'UNSCORED'].map(s => {
              const cfg = s === 'ALL' ? null : STATE_CFG[s];
              return (
                <button key={s} onClick={() => setStateFilter(s)} style={{
                  padding: '5px 12px', borderRadius: 99, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                  border: `1px solid ${stateFilter === s ? (cfg?.border ?? '#E5E7EB') : '#E5E7EB'}`,
                  background: stateFilter === s ? (cfg?.bg ?? '#F3F4F6') : '#FFFFFF',
                  color: stateFilter === s ? (cfg?.text ?? '#374151') : '#6B7280',
                }}>
                  {s === 'ALL' ? 'All States' : STATE_CFG[s].label}
                </button>
              );
            })}
          </div>

          {/* Table */}
          {isFetching && connections.length === 0 ? (
            <div style={{ display: 'grid', gap: 8 }}>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} style={{ height: 48, background: '#F9FAFB', borderRadius: 8, animation: 'pulse 2s infinite' }} />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 0', color: '#9CA3AF', fontSize: 14 }}>
              {connections.length === 0 ? 'No vendor connection data available for this period.' : 'No routes match the current filter.'}
            </div>
          ) : (
            <div style={{ background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 14, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#FAFAFA', borderBottom: '1px solid #F3F4F6' }}>
                    {[
                      { label: 'Connection',    align: 'left',  w: '22%' },
                      { label: 'State',         align: 'left',  w: '10%' },
                      { label: 'Calls',         align: 'right', w: '7%'  },
                      { label: 'Connected',     align: 'right', w: '8%'  },
                      { label: 'ASR',           align: 'right', w: '7%'  },
                      { label: 'ACD',           align: 'right', w: '8%'  },
                      { label: 'PDD',           align: 'right', w: '6%'  },
                      { label: 'Health Score',  align: 'left',  w: '12%' },
                      { label: 'Confidence',    align: 'center',w: '8%'  },
                      { label: 'FAS',           align: 'center',w: '6%'  },
                      { label: 'Recommendation',align: 'left',  w: '16%' },
                    ].map(col => (
                      <th key={col.label} style={{
                        padding: '9px 14px', textAlign: col.align as any,
                        fontSize: 9, fontWeight: 700, color: '#9CA3AF',
                        textTransform: 'uppercase', letterSpacing: '0.06em',
                        width: col.w,
                      }}>{col.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((conn, idx) => {
                    const stCfg = STATE_CFG[conn.state] ?? STATE_CFG.UNSCORED;
                    const isProblematic = conn.state === 'CRITICAL' || conn.state === 'FAS_RISK';
                    return (
                      <tr key={conn.id} style={{
                        borderBottom: idx < filtered.length - 1 ? '1px solid #F9FAFB' : 'none',
                        background: isProblematic ? stCfg.bg + '55' : 'transparent',
                        transition: 'background 0.1s',
                      }}>
                        {/* Connection name */}
                        <td style={{ padding: '10px 14px' }}>
                          <span style={{
                            fontSize: 12, fontWeight: 600, color: '#1F2937',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            display: 'block', maxWidth: 280,
                          }} title={conn.connectionName}>{conn.connectionName}</span>
                          {conn.flags.includes('ZERO_ASR') && (
                            <span style={{ fontSize: 9, color: '#DC2626', fontWeight: 600 }}>ZERO ASR</span>
                          )}
                        </td>
                        {/* State */}
                        <td style={{ padding: '10px 14px' }}><StateBadge state={conn.state} /></td>
                        {/* Calls */}
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: 12, fontWeight: 600, color: '#374151', fontVariantNumeric: 'tabular-nums' }}>
                          {conn.totalCalls > 0 ? conn.totalCalls.toLocaleString() : <span style={{ color: '#D1D5DB' }}>—</span>}
                        </td>
                        {/* Connected */}
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: 12, color: '#374151', fontVariantNumeric: 'tabular-nums' }}>
                          {conn.connectedCalls > 0 ? conn.connectedCalls.toLocaleString() : <span style={{ color: '#D1D5DB' }}>—</span>}
                        </td>
                        {/* ASR */}
                        <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                          <span style={{ fontSize: 12, fontWeight: 800, color: asrColor(conn.asr), fontVariantNumeric: 'tabular-nums' }}>
                            {conn.totalCalls > 0 ? `${conn.asr.toFixed(1)}%` : '—'}
                          </span>
                        </td>
                        {/* ACD */}
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: 12, color: '#374151', fontVariantNumeric: 'tabular-nums' }}>
                          {fmtAcd(conn.acd)}
                        </td>
                        {/* PDD */}
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: 12, color: '#6B7280', fontVariantNumeric: 'tabular-nums' }}>
                          {conn.pdd > 0 ? `${conn.pdd.toFixed(1)}s` : '—'}
                        </td>
                        {/* Health Score bar */}
                        <td style={{ padding: '10px 14px' }}><HealthBar score={conn.healthScore} /></td>
                        {/* Confidence */}
                        <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: CONF_CLR[conn.confidenceLevel] ?? '#D1D5DB' }}>
                            {conn.confidenceLevel === 'NONE' ? '—' : conn.confidenceLevel}
                          </span>
                        </td>
                        {/* FAS */}
                        <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                          {conn.fasSeverity ? (
                            <span style={{
                              fontSize: 9.5, fontWeight: 700, padding: '2px 6px', borderRadius: 99,
                              background: FAS_CFG[conn.fasSeverity].bg, color: FAS_CFG[conn.fasSeverity].text,
                            }}>{conn.fasSeverity}</span>
                          ) : (
                            <span style={{ color: '#E5E7EB', fontSize: 12 }}>—</span>
                          )}
                        </td>
                        {/* Recommendation */}
                        <td style={{ padding: '10px 14px' }}><RecChip rec={conn.recommendation} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div style={{ padding: '8px 14px', borderTop: '1px solid #F9FAFB', fontSize: 9, color: '#D1D5DB', display: 'flex', justifyContent: 'space-between' }}>
                <span>{filtered.length} routes · {data?.period} window</span>
                <span>Updated {data?.fetchedAt ? new Date(data.fetchedAt).toLocaleTimeString() : '—'}</span>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── TAB 2: Recommendations ────────────────────────────────────────── */}
      {tab === 'recommendations' && (
        <>
          {isFetching && recommendations.length === 0 ? (
            <div style={{ display: 'grid', gap: 10 }}>
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} style={{ height: 88, background: '#F9FAFB', borderRadius: 12, animation: 'pulse 2s infinite' }} />
              ))}
            </div>
          ) : recommendations.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 0' }}>
              <CheckCircle2 style={{ width: 36, height: 36, color: '#22C55E', margin: '0 auto 12px' }} />
              <p style={{ fontSize: 14, fontWeight: 600, color: '#374151', margin: 0 }}>No action required</p>
              <p style={{ fontSize: 12, color: '#9CA3AF', marginTop: 4 }}>All routes are within normal operational parameters.</p>
            </div>
          ) : (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, padding: '10px 14px', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 10 }}>
                <AlertTriangle style={{ width: 14, height: 14, color: '#B45309', flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: '#B45309', fontWeight: 500 }}>
                  {recommendations.length} route{recommendations.length !== 1 ? 's' : ''} require attention. All actions are advisory — review before applying.
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {recommendations.map(conn => (
                  <RecommendationCard key={conn.id} conn={conn} />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Legend */}
      <div style={{ marginTop: 28, padding: '12px 16px', background: '#F9FAFB', border: '1px solid #F3F4F6', borderRadius: 10, display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Info style={{ width: 12, height: 12, color: '#9CA3AF' }} />
          <span style={{ fontSize: 10.5, color: '#6B7280', fontWeight: 600 }}>Health Score formula:</span>
        </div>
        {[
          'ASR 35%', 'ACD 30%', 'PDD 15%', 'Volume confidence 20%',
        ].map(l => (
          <span key={l} style={{ fontSize: 10.5, color: '#9CA3AF' }}>{l}</span>
        ))}
        <span style={{ fontSize: 10.5, color: '#9CA3AF', marginLeft: 'auto' }}>
          FAS: ASR&gt;55% + ACD&lt;30s = Critical · ASR&gt;45% + ACD&lt;45s = Medium · ASR&gt;35% + ACD&lt;60s = Low
        </span>
      </div>
    </div>
  );
}

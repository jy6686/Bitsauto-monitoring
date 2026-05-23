import { useState, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  ComposableMap, Geographies, Geography, Line, Marker,
} from "react-simple-maps";
import {
  Globe, Activity, AlertTriangle, TrendingUp, TrendingDown,
  Minus, BarChart2, ShieldAlert, ChevronRight, ExternalLink,
  RefreshCw, Layers, ArrowRight, Users, Radio, DollarSign,
  ZapOff, Zap,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Link as WouterLink } from "wouter";

const GEO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

type Layer = 'traffic' | 'asr' | 'fas' | 'stability' | 'revenue' | 'cps';
type Health = 'healthy' | 'warning' | 'degraded' | 'fraud-risk' | 'unstable';

const HEALTH_COLOR: Record<Health, string> = {
  'healthy':    '#10b981',
  'warning':    '#f59e0b',
  'degraded':   '#ef4444',
  'fraud-risk': '#8b5cf6',
  'unstable':   '#f97316',
};

const HEALTH_LABEL: Record<Health, string> = {
  'healthy':    'Healthy',
  'warning':    'Warning',
  'degraded':   'Degraded',
  'fraud-risk': 'Fraud Risk',
  'unstable':   'Unstable',
};

const HEALTH_BG: Record<Health, string> = {
  'healthy':    'bg-emerald-500/10 text-emerald-400 border-emerald-500/25',
  'warning':    'bg-amber-500/10 text-amber-400 border-amber-500/25',
  'degraded':   'bg-red-500/10 text-red-400 border-red-500/25',
  'fraud-risk': 'bg-violet-500/10 text-violet-400 border-violet-500/25',
  'unstable':   'bg-orange-500/10 text-orange-400 border-orange-500/25',
};

const TREND_ICON = {
  rising:   <TrendingUp className="w-3 h-3 text-emerald-400" />,
  falling:  <TrendingDown className="w-3 h-3 text-rose-400" />,
  stable:   <Minus className="w-3 h-3 text-muted-foreground" />,
  volatile: <Activity className="w-3 h-3 text-amber-400" />,
};

interface TrafficFlow {
  from: string; to: string;
  fromCode: string; toCode: string;
  fromLat: number; fromLon: number;
  toLat: number;   toLon: number;
  destinationType: string;
  direction: string;
  calls: number; concurrentCalls: number; cps: number;
  asr: number; acd: number; pdd: number;
  qScore: number; fasRisk: number;
  fraudRisk: boolean; degraded: boolean; unstable: boolean;
  health: Health;
  topVendor: string; vendorContribution: number; topPrefix: string;
  revenue: number;
  trend: 'rising' | 'stable' | 'falling' | 'volatile';
  updatedAt: string;
}

interface MapResponse {
  flows: TrafficFlow[];
  totals: {
    totalCalls: number; totalRevenue: number;
    avgAsr: number; avgQScore: number;
    degradedFlows: number; fraudRiskFlows: number;
  };
  updatedAt: string;
}

function arcColor(flow: TrafficFlow, layer: Layer): string {
  if (layer === 'fas')       return flow.fasRisk > 20 ? '#8b5cf6' : flow.fasRisk > 10 ? '#f59e0b' : '#10b981';
  if (layer === 'asr')       return flow.asr < 40 ? '#ef4444' : flow.asr < 65 ? '#f59e0b' : '#10b981';
  if (layer === 'stability') return flow.qScore < 40 ? '#ef4444' : flow.qScore < 65 ? '#f59e0b' : '#10b981';
  if (layer === 'revenue')   return '#10b981';
  if (layer === 'cps')       return flow.cps > 2 ? '#3b82f6' : '#64748b';
  return HEALTH_COLOR[flow.health];
}

function arcWidth(concurrent: number): number {
  return Math.min(6, Math.max(1.5, 0.6 + Math.log2(concurrent + 1)));
}

const LAYER_OPTIONS: { value: Layer; label: string; icon: typeof Activity }[] = [
  { value: 'traffic',   label: 'Traffic Volume',    icon: Activity },
  { value: 'asr',       label: 'ASR Quality',       icon: BarChart2 },
  { value: 'fas',       label: 'FAS Risk',          icon: ShieldAlert },
  { value: 'stability', label: 'Vendor Stability',  icon: Radio },
  { value: 'revenue',   label: 'Revenue',           icon: DollarSign },
  { value: 'cps',       label: 'CPS Bursts',        icon: Zap },
];

export default function LiveTrafficMapPage() {
  const [, navigate] = useLocation();
  const [layer, setLayer]           = useState<Layer>('traffic');
  const [tooltip, setTooltip]       = useState<{ flow: TrafficFlow; x: number; y: number } | null>(null);
  const [selected, setSelected]     = useState<TrafficFlow | null>(null);
  const [showDrawer, setShowDrawer] = useState(false);
  const mapRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, dataUpdatedAt, refetch, isFetching } = useQuery<MapResponse>({
    queryKey: ['/api/live-traffic-map'],
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
  });

  const flows   = data?.flows   ?? [];
  const totals  = data?.totals  ?? { totalCalls: 0, totalRevenue: 0, avgAsr: 0, avgQScore: 0, degradedFlows: 0, fraudRiskFlows: 0 };
  const updatedAt = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';

  const topRoutes       = [...flows].slice(0, 10);
  const riskDests       = [...flows].filter(f => f.degraded || f.fraudRisk || f.fasRisk >= 15).slice(0, 8);
  const revenueRoutes   = [...flows].sort((a, b) => b.revenue - a.revenue).slice(0, 8);

  const vendorMap = new Map<string, { calls: number; revenue: number; health: Health }>();
  for (const f of flows) {
    const e = vendorMap.get(f.topVendor) ?? { calls: 0, revenue: 0, health: 'healthy' as Health };
    e.calls   += f.calls;
    e.revenue += f.revenue;
    if (f.health === 'degraded' || f.health === 'fraud-risk') e.health = f.health;
    else if (f.health === 'warning' && e.health === 'healthy') e.health = 'warning';
    vendorMap.set(f.topVendor, e);
  }
  const topVendors = [...vendorMap.entries()].sort((a, b) => b[1].calls - a[1].calls).slice(0, 8);

  const handleArcEnter = useCallback((e: React.MouseEvent, flow: TrafficFlow) => {
    setTooltip({ flow, x: e.clientX, y: e.clientY });
  }, []);

  const handleArcLeave = useCallback(() => {
    setTooltip(null);
  }, []);

  const handleArcClick = useCallback((flow: TrafficFlow) => {
    setSelected(flow);
    setShowDrawer(true);
    setTooltip(null);
  }, []);

  return (
    <div className="flex flex-col h-full bg-background">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 border-b border-border/50 bg-card/50 px-6 py-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/20">
              <Globe className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold">Live Global Traffic Map</h1>
                <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  LIVE
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {flows.length} active route{flows.length !== 1 ? 's' : ''} · {totals.totalCalls} calls · ASR {totals.avgAsr}% · Q {totals.avgQScore}
                {totals.degradedFlows > 0 && <span className="text-rose-400 ml-2">· {totals.degradedFlows} degraded</span>}
                {totals.fraudRiskFlows > 0 && <span className="text-violet-400 ml-2">· {totals.fraudRiskFlows} fraud risk</span>}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Layer selector */}
            <div className="flex items-center gap-0.5 bg-muted/30 rounded-lg p-0.5 border border-border/40">
              {LAYER_OPTIONS.map(opt => {
                const Icon = opt.icon;
                return (
                  <button
                    key={opt.value}
                    onClick={() => setLayer(opt.value)}
                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded text-[10px] font-semibold transition-colors whitespace-nowrap ${
                      layer === opt.value
                        ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                    data-testid={`btn-layer-${opt.value}`}
                    title={opt.label}
                  >
                    <Icon className="w-3 h-3" />
                    <span className="hidden sm:inline">{opt.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground/60">
                {isFetching ? 'Refreshing…' : `Updated ${updatedAt}`}
              </span>
              <button
                onClick={() => refetch()}
                className="p-1.5 rounded-lg hover:bg-muted/40 transition-colors text-muted-foreground hover:text-foreground"
                data-testid="btn-refresh-map"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Body: Map + Sidebar ──────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* ── Map ──────────────────────────────────────────────────────────── */}
        <div className="flex-1 relative overflow-hidden bg-slate-950" ref={mapRef}>

          {/* Legend */}
          <div className="absolute top-3 left-3 z-10 flex flex-col gap-1.5 bg-card/80 backdrop-blur-sm border border-border/40 rounded-lg px-3 py-2.5">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              {LAYER_OPTIONS.find(o => o.value === layer)?.label}
            </p>
            {layer === 'traffic' && (
              <>
                {(['healthy','warning','degraded','fraud-risk'] as Health[]).map(h => (
                  <div key={h} className="flex items-center gap-2 text-[10px]">
                    <div className="w-4 h-1.5 rounded-full" style={{ background: HEALTH_COLOR[h] }} />
                    <span className="text-muted-foreground">{HEALTH_LABEL[h]}</span>
                  </div>
                ))}
              </>
            )}
            {layer === 'asr' && (
              <>
                <div className="flex items-center gap-2 text-[10px]"><div className="w-4 h-1.5 rounded-full bg-emerald-500" /><span className="text-muted-foreground">ASR ≥ 65%</span></div>
                <div className="flex items-center gap-2 text-[10px]"><div className="w-4 h-1.5 rounded-full bg-amber-500" /><span className="text-muted-foreground">ASR 40–65%</span></div>
                <div className="flex items-center gap-2 text-[10px]"><div className="w-4 h-1.5 rounded-full bg-red-500" /><span className="text-muted-foreground">ASR &lt; 40%</span></div>
              </>
            )}
            {layer === 'fas' && (
              <>
                <div className="flex items-center gap-2 text-[10px]"><div className="w-4 h-1.5 rounded-full bg-emerald-500" /><span className="text-muted-foreground">Low risk</span></div>
                <div className="flex items-center gap-2 text-[10px]"><div className="w-4 h-1.5 rounded-full bg-amber-500" /><span className="text-muted-foreground">Moderate</span></div>
                <div className="flex items-center gap-2 text-[10px]"><div className="w-4 h-1.5 rounded-full bg-violet-500" /><span className="text-muted-foreground">High FAS</span></div>
              </>
            )}
            <div className="mt-1 pt-1 border-t border-border/30 text-[9px] text-muted-foreground/50">
              Arc width = concurrent calls
            </div>
          </div>

          {isLoading ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <Globe className="w-10 h-10 text-blue-400/30 mx-auto mb-3 animate-pulse" />
                <p className="text-sm text-muted-foreground">Loading traffic data…</p>
              </div>
            </div>
          ) : flows.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <ZapOff className="w-10 h-10 text-muted-foreground/20 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No traffic flows in last 2 hours</p>
                <p className="text-xs text-muted-foreground/50 mt-1">Connect a softswitch to see live routes</p>
              </div>
            </div>
          ) : null}

          <ComposableMap
            projectionConfig={{ scale: 160, center: [10, 15] }}
            style={{ width: '100%', height: '100%' }}
          >
            <Geographies geography={GEO_URL}>
              {({ geographies }) =>
                geographies.map(geo => (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    fill="#1e293b"
                    stroke="#334155"
                    strokeWidth={0.4}
                    style={{
                      default: { outline: 'none' },
                      hover:   { fill: '#334155', outline: 'none' },
                      pressed: { outline: 'none' },
                    }}
                  />
                ))
              }
            </Geographies>

            {/* Country dots for active endpoints */}
            {Array.from(
              new Set(flows.flatMap(f => [f.fromCode, f.toCode]))
            ).map(code => {
              const coords = flows.find(f => f.fromCode === code || f.toCode === code);
              if (!coords) return null;
              const isFrom = flows.some(f => f.fromCode === code);
              const [lon, lat] = isFrom
                ? [flows.find(f => f.fromCode === code)!.fromLon, flows.find(f => f.fromCode === code)!.fromLat]
                : [flows.find(f => f.toCode === code)!.toLon,   flows.find(f => f.toCode === code)!.toLat];
              return (
                <Marker key={code} coordinates={[lon, lat]}>
                  <circle r={3} fill="#3b82f6" stroke="#1e3a5f" strokeWidth={1} opacity={0.8} />
                </Marker>
              );
            })}

            {/* Traffic arcs */}
            {flows.map((flow, i) => {
              const color = arcColor(flow, layer);
              const width = arcWidth(flow.concurrentCalls);
              return (
                <Line
                  key={`${flow.fromCode}-${flow.toCode}-${flow.destinationType}-${i}`}
                  from={[flow.fromLon, flow.fromLat]}
                  to={[flow.toLon,   flow.toLat]}
                  stroke={color}
                  strokeWidth={width}
                  strokeLinecap="round"
                  strokeOpacity={0.75}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={(e: any) => handleArcEnter(e, flow)}
                  onMouseLeave={handleArcLeave}
                  onClick={() => handleArcClick(flow)}
                />
              );
            })}
          </ComposableMap>

          {/* Tooltip */}
          {tooltip && (
            <div
              className="fixed z-50 pointer-events-none"
              style={{ left: tooltip.x + 12, top: tooltip.y - 10 }}
            >
              <div className="bg-card border border-border/60 rounded-xl shadow-2xl p-4 min-w-[240px] max-w-[280px]">
                {/* Direction */}
                <p className="text-xs font-bold mb-3 text-foreground leading-snug">{tooltip.flow.direction}</p>
                <div className="space-y-1.5">
                  {[
                    ['Calls',       tooltip.flow.calls],
                    ['Concurrent',  tooltip.flow.concurrentCalls],
                    ['CPS',         tooltip.flow.cps.toFixed(2)],
                    ['ASR',         `${tooltip.flow.asr}%`],
                    ['ACD',         `${tooltip.flow.acd}s`],
                    ['Q-Score',     tooltip.flow.qScore],
                    ['FAS Risk',    `${tooltip.flow.fasRisk}%`],
                    ['Revenue',     `$${tooltip.flow.revenue.toFixed(2)}`],
                    ['Top Vendor',  tooltip.flow.topVendor],
                  ].map(([k, v]) => (
                    <div key={String(k)} className="flex items-center justify-between gap-3">
                      <span className="text-[11px] text-muted-foreground">{k}</span>
                      <span className="text-[11px] font-semibold text-foreground">{v}</span>
                    </div>
                  ))}
                </div>
                <div className={`mt-3 px-2 py-0.5 rounded-full border text-[10px] font-semibold w-fit ${HEALTH_BG[tooltip.flow.health]}`}>
                  {HEALTH_LABEL[tooltip.flow.health]}
                </div>
                <p className="text-[10px] text-muted-foreground/50 mt-2">Click to open RCA</p>
              </div>
            </div>
          )}
        </div>

        {/* ── Right Sidebar ─────────────────────────────────────────────────── */}
        <div className="w-[300px] flex-shrink-0 border-l border-border/50 bg-card overflow-y-auto">

          {/* Top Routes */}
          <SidePanel title="Top Routes" icon={Activity} count={topRoutes.length} href="/live-traffic-map">
            {topRoutes.length === 0 ? (
              <EmptyPanel message="No active routes" />
            ) : topRoutes.map((f, i) => (
              <button
                key={i}
                className="w-full flex items-start gap-3 px-4 py-3 border-b border-border/30 hover:bg-muted/20 transition-colors text-left group"
                onClick={() => { setSelected(f); setShowDrawer(true); }}
                data-testid={`row-route-${i}`}
              >
                <div className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ background: HEALTH_COLOR[f.health] }} />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-semibold truncate group-hover:text-foreground transition-colors">
                    {f.from} → {f.to}
                  </p>
                  <p className="text-[10px] text-muted-foreground truncate">
                    {f.destinationType} · {f.topVendor}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-[11px] font-bold tabular-nums">{f.calls}</p>
                  <p className="text-[10px] text-muted-foreground">calls</p>
                </div>
              </button>
            ))}
          </SidePanel>

          {/* High Risk Destinations */}
          <SidePanel title="High Risk Destinations" icon={ShieldAlert} count={riskDests.length} variant="rose">
            {riskDests.length === 0 ? (
              <EmptyPanel message="No degraded routes" good />
            ) : riskDests.map((f, i) => (
              <button
                key={i}
                className="w-full flex items-start gap-3 px-4 py-3 border-b border-border/30 hover:bg-muted/20 transition-colors text-left group"
                onClick={() => { setSelected(f); setShowDrawer(true); }}
                data-testid={`row-risk-${i}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <p className="text-[11px] font-semibold truncate">{f.to} {f.destinationType}</p>
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border flex-shrink-0 ${HEALTH_BG[f.health]}`}>
                      {HEALTH_LABEL[f.health]}
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    ASR {f.asr}% · FAS {f.fasRisk}% · Q {f.qScore}
                  </p>
                </div>
                {TREND_ICON[f.trend]}
              </button>
            ))}
          </SidePanel>

          {/* Top Vendors */}
          <SidePanel title="Top Vendors" icon={Radio} count={topVendors.length}>
            {topVendors.map(([vendor, stats], i) => (
              <Link
                key={i}
                href={`/vendor-rca?vendor=${encodeURIComponent(vendor)}`}
                data-testid={`row-vendor-${i}`}
              >
                <div className="flex items-center gap-3 px-4 py-3 border-b border-border/30 hover:bg-muted/20 transition-colors cursor-pointer">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: HEALTH_COLOR[stats.health] }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-semibold truncate">{vendor}</p>
                    <p className="text-[10px] text-muted-foreground">${stats.revenue.toFixed(2)} revenue</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-[11px] font-bold tabular-nums">{stats.calls}</p>
                    <p className="text-[10px] text-muted-foreground">calls</p>
                  </div>
                </div>
              </Link>
            ))}
          </SidePanel>

          {/* Revenue Routes */}
          <SidePanel title="Revenue Routes" icon={DollarSign} count={revenueRoutes.length} variant="emerald">
            {revenueRoutes.map((f, i) => (
              <button
                key={i}
                className="w-full flex items-start gap-3 px-4 py-3 border-b border-border/30 hover:bg-muted/20 transition-colors text-left group"
                onClick={() => { setSelected(f); setShowDrawer(true); }}
                data-testid={`row-rev-${i}`}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-semibold truncate group-hover:text-foreground">{f.from} → {f.to}</p>
                  <p className="text-[10px] text-muted-foreground">{f.topVendor}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-[11px] font-bold text-emerald-400 tabular-nums">${f.revenue.toFixed(2)}</p>
                  <p className="text-[10px] text-muted-foreground">{f.calls} calls</p>
                </div>
              </button>
            ))}
          </SidePanel>

        </div>
      </div>

      {/* ── RCA Drilldown Drawer ─────────────────────────────────────────────── */}
      <Sheet open={showDrawer} onOpenChange={setShowDrawer}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader className="pb-4 border-b border-border/40">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-blue-400" />
              <SheetTitle>Route Intelligence</SheetTitle>
            </div>
            {selected && (
              <SheetDescription className="font-medium text-foreground/80 text-sm mt-1">
                {selected.direction}
              </SheetDescription>
            )}
          </SheetHeader>

          {selected && (
            <div className="py-5 space-y-5">
              {/* Health badge + trend */}
              <div className="flex items-center gap-3">
                <span className={`text-sm font-semibold px-3 py-1 rounded-full border ${HEALTH_BG[selected.health]}`}>
                  {HEALTH_LABEL[selected.health]}
                </span>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  {TREND_ICON[selected.trend]}
                  <span className="capitalize">{selected.trend}</span>
                </div>
                {selected.fraudRisk && (
                  <span className="text-xs text-violet-400 font-semibold flex items-center gap-1">
                    <ShieldAlert className="w-3 h-3" /> Fraud Risk
                  </span>
                )}
              </div>

              {/* Stats grid */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Calls',    value: selected.calls,              sub: 'total' },
                  { label: 'ASR',      value: `${selected.asr}%`,         sub: 'connect rate' },
                  { label: 'Q-Score',  value: selected.qScore,            sub: 'quality' },
                  { label: 'ACD',      value: `${selected.acd}s`,         sub: 'avg duration' },
                  { label: 'PDD',      value: `${selected.pdd}s`,         sub: 'setup delay' },
                  { label: 'FAS Risk', value: `${selected.fasRisk}%`,     sub: 'fraud signal' },
                  { label: 'CPS',      value: selected.cps.toFixed(2),   sub: 'calls/sec' },
                  { label: 'Revenue',  value: `$${selected.revenue.toFixed(2)}`, sub: 'total' },
                  { label: 'Vendor %', value: `${selected.vendorContribution}%`, sub: selected.topVendor },
                ].map(({ label, value, sub }) => (
                  <div key={label} className="rounded-lg bg-muted/30 border border-border/40 p-3">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
                    <p className="text-base font-bold tabular-nums">{value}</p>
                    <p className="text-[10px] text-muted-foreground/60 truncate">{sub}</p>
                  </div>
                ))}
              </div>

              {/* Direction details */}
              <div className="rounded-xl border border-border/50 overflow-hidden">
                {[
                  { label: 'Origination',     value: selected.from },
                  { label: 'Termination',     value: `${selected.to} ${selected.destinationType}` },
                  { label: 'Direction',       value: selected.direction },
                  { label: 'Top Vendor',      value: `${selected.topVendor} (${selected.vendorContribution}% contribution)` },
                  { label: 'Top Prefix',      value: selected.topPrefix || '—' },
                  { label: 'From ISO2',       value: selected.fromCode },
                  { label: 'To ISO2',         value: selected.toCode },
                ].map(row => (
                  <div key={row.label} className="flex items-start gap-3 px-4 py-2.5 border-b border-border/40 last:border-0">
                    <span className="text-xs text-muted-foreground w-32 flex-shrink-0 pt-0.5">{row.label}</span>
                    <span className="text-xs font-medium">{row.value}</span>
                  </div>
                ))}
              </div>

              {/* RCA action links */}
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Investigate</p>
                <div className="flex flex-wrap gap-2">
                  <Link
                    href={`/vendor-rca?vendor=${encodeURIComponent(selected.topVendor)}`}
                    onClick={() => setShowDrawer(false)}
                  >
                    <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/25 text-xs font-medium hover:bg-blue-500/20 transition-colors" data-testid="btn-drawer-vendor-rca">
                      <Radio className="w-3 h-3" /> Vendor RCA
                    </button>
                  </Link>
                  <Link
                    href={`/vendor-prefix-intelligence?prefix=${encodeURIComponent(selected.topPrefix)}`}
                    onClick={() => setShowDrawer(false)}
                  >
                    <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-500/10 text-violet-400 border border-violet-500/25 text-xs font-medium hover:bg-violet-500/20 transition-colors" data-testid="btn-drawer-prefix">
                      <Globe className="w-3 h-3" /> Prefix Intelligence
                    </button>
                  </Link>
                  <Link
                    href={`/routing-intelligence?from=${encodeURIComponent(selected.fromCode)}&to=${encodeURIComponent(selected.toCode)}`}
                    onClick={() => setShowDrawer(false)}
                  >
                    <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 text-xs font-medium hover:bg-emerald-500/20 transition-colors" data-testid="btn-drawer-routing">
                      <Activity className="w-3 h-3" /> Routing Intelligence
                    </button>
                  </Link>
                  <Link href="/fraud-engine" onClick={() => setShowDrawer(false)}>
                    <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/25 text-xs font-medium hover:bg-rose-500/20 transition-colors" data-testid="btn-drawer-fraud">
                      <ShieldAlert className="w-3 h-3" /> FAS Analysis
                    </button>
                  </Link>
                </div>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

    </div>
  );
}

// ── Helper components ─────────────────────────────────────────────────────────

function SidePanel({
  title, icon: Icon, count, href, variant, children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  count?: number;
  href?: string;
  variant?: 'rose' | 'emerald';
  children: React.ReactNode;
}) {
  const borderCls = variant === 'rose' ? 'border-rose-500/15' : variant === 'emerald' ? 'border-emerald-500/15' : 'border-border/50';
  const iconCls   = variant === 'rose' ? 'text-rose-400' : variant === 'emerald' ? 'text-emerald-400' : 'text-blue-400';
  return (
    <div className={`border-b ${borderCls}`}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
        <div className="flex items-center gap-2">
          <Icon className={`w-3.5 h-3.5 ${iconCls}`} />
          <span className="text-[11px] font-bold uppercase tracking-wider text-foreground/80">{title}</span>
          {count != null && count > 0 && (
            <span className="text-[10px] bg-muted/50 text-muted-foreground rounded-full px-1.5 py-0.5">{count}</span>
          )}
        </div>
        {href && (
          <Link href={href} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">
            <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        )}
      </div>
      {children}
    </div>
  );
}

function EmptyPanel({ message, good }: { message: string; good?: boolean }) {
  return (
    <div className="px-4 py-6 text-center">
      {good
        ? <Activity className="w-5 h-5 text-emerald-400/30 mx-auto mb-1.5" />
        : <ZapOff className="w-5 h-5 text-muted-foreground/20 mx-auto mb-1.5" />}
      <p className="text-[11px] text-muted-foreground/50">{message}</p>
    </div>
  );
}

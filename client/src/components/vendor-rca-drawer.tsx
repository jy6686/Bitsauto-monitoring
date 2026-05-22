import { useQuery } from "@tanstack/react-query";
import {
  X, TrendingUp, TrendingDown, Minus, AlertTriangle, CheckCircle2,
  Clock, Shield, Zap, Globe, Activity, RefreshCw, ChevronRight,
  ArrowRight, BarChart2, Map,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";

// ── Types ──────────────────────────────────────────────────────────────────────
interface RcaVerdict {
  currentQ: number; previousQ: number | null; deltaQ: number;
  stability: string; trend: string; trendPts: number;
  callCount: number; prevCallCount: number;
  severity: string; urgency: string; signals: string[];
}

interface RcaDecomposition {
  asr: { cur: number; prev: number | null; pts: number; prevPts: number | null; delta: number | null };
  ner: { cur: number; prev: number | null; pts: number; prevPts: number | null; delta: number | null };
  fas: { cur: number; prev: number | null; pts: number; prevPts: number | null; delta: number | null };
  pdd: { cur: number; prev: number | null; pts: number; prevPts: number | null; delta: number | null };
}

interface RcaRecommendation {
  type: string; title: string; confidence: number; confidencePct: number;
  ruleDescription: string; urgency: string;
}

interface RcaIncidentEvent {
  ts: string | null; fromState: string | null; toState: string; note: string | null;
}

interface RcaIncident {
  incidentId: number; type: string; severity: string; title: string;
  state: string | null; events: RcaIncidentEvent[];
}

interface RcaFas {
  totalEvents: number; last24h: number; affectedPrefixes: string[];
  topCallee: string | null;
}

interface VendorRcaPayload {
  vendor: string; generatedAt: string; hasData: boolean;
  verdict: RcaVerdict;
  decomposition: RcaDecomposition | null;
  prefixes: any[];
  timeline: any[];
  recommendation: RcaRecommendation | null;
  incidents: RcaIncident[];
  fas: RcaFas;
}

// ── Style helpers ──────────────────────────────────────────────────────────────
const qColor = (q: number) =>
  q >= 75 ? 'text-emerald-400' : q >= 55 ? 'text-sky-400' : q >= 35 ? 'text-amber-400' : 'text-rose-400';

const qBg = (q: number) =>
  q >= 75 ? 'bg-emerald-500/10 border-emerald-500/20' :
  q >= 55 ? 'bg-sky-500/10 border-sky-500/20' :
  q >= 35 ? 'bg-amber-500/10 border-amber-500/20' :
  'bg-rose-500/10 border-rose-500/20';

const urgencyCfg: Record<string, { cls: string; label: string }> = {
  immediate: { cls: 'bg-rose-500/15 border-rose-500/30 text-rose-300',      label: 'Immediate' },
  today:     { cls: 'bg-amber-500/15 border-amber-500/30 text-amber-300',    label: 'Today'     },
  monitor:   { cls: 'bg-sky-500/10 border-sky-500/20 text-sky-300',          label: 'Monitor'   },
  healthy:   { cls: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300', label: 'Healthy' },
};

const stabCfg: Record<string, string> = {
  stable:      'text-emerald-400', recovering: 'text-sky-400',
  oscillating: 'text-amber-400',  degrading:  'text-rose-400',
  insufficient:'text-muted-foreground', unknown: 'text-muted-foreground',
};

const incidentSev: Record<string, string> = {
  critical: 'text-rose-400', high: 'text-orange-400',
  medium:   'text-amber-400', low: 'text-sky-400',
};

const stateColor: Record<string, string> = {
  open: 'text-amber-400', escalated: 'text-rose-400',
  resolved: 'text-emerald-400', reopened: 'text-orange-400',
};

function relTime(ts: string | null) {
  if (!ts) return '—';
  const d = Math.floor((Date.now() - new Date(ts).getTime()) / 60_000);
  return d < 60 ? `${d}m ago` : d < 1440 ? `${Math.floor(d/60)}h ago` : `${Math.floor(d/1440)}d ago`;
}

// ── Sub-sections ──────────────────────────────────────────────────────────────
function SectionHeader({ icon, title, count }: { icon: React.ReactNode; title: string; count?: number }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-xs font-semibold text-foreground/80">{title}</span>
      {count !== undefined && (
        <span className="ml-auto text-[10px] text-muted-foreground/50">{count} item{count !== 1 ? 's' : ''}</span>
      )}
    </div>
  );
}

function DecompRow({
  label, weight, cur, prev, pts, prevPts, delta, unit = '%', lowerIsBetter = false,
}: {
  label: string; weight: string;
  cur: number; prev: number | null;
  pts: number; prevPts: number | null;
  delta: number | null;
  unit?: string; lowerIsBetter?: boolean;
}) {
  const improved = delta !== null && (lowerIsBetter ? delta > 0 : delta > 0);
  const degraded = delta !== null && (lowerIsBetter ? delta < 0 : delta < 0);
  const barPct = Math.max(0, Math.min(100, (pts / (parseFloat(weight) / 100 * 100)) * 100));

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-mono font-semibold text-foreground/80 w-8">{label}</span>
        <span className="text-[9px] text-muted-foreground/50">{weight}</span>
        <div className="flex-1 h-1.5 bg-muted/20 rounded-full overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all", improved ? 'bg-emerald-500' : degraded ? 'bg-rose-500' : 'bg-sky-500')}
            style={{ width: `${barPct}%` }}
          />
        </div>
        <span className="text-[10px] font-mono text-muted-foreground/70 w-10 text-right">
          {pts.toFixed(1)}pts
        </span>
        {delta !== null && (
          <span className={cn("text-[9px] font-mono w-12 text-right", improved ? 'text-emerald-400' : degraded ? 'text-rose-400' : 'text-muted-foreground')}>
            {delta > 0 ? '+' : ''}{delta.toFixed(1)}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1 pl-8">
        <span className={cn("text-[10px] font-mono font-semibold", lowerIsBetter ? (cur > 15 ? 'text-rose-400' : cur > 5 ? 'text-amber-400' : 'text-emerald-400') : qColor(cur))}>
          {cur.toFixed(unit === 's' ? 2 : 1)}{unit}
        </span>
        {prev !== null && (
          <>
            <ArrowRight className="w-2.5 h-2.5 text-muted-foreground/30" />
            <span className="text-[9px] text-muted-foreground/50">was {prev.toFixed(unit === 's' ? 2 : 1)}{unit}</span>
          </>
        )}
      </div>
    </div>
  );
}

function ChartTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-card border border-border/60 rounded-lg shadow-xl p-2 text-[10px] space-y-0.5">
      <p className="text-muted-foreground font-mono">
        {new Date(d.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </p>
      <p className={cn("font-mono font-bold", qColor(d.qScore))}>Q{d.qScore}</p>
      {d.asr !== null && <p className="text-muted-foreground">ASR {d.asr}%</p>}
    </div>
  );
}

// ── Main drawer ───────────────────────────────────────────────────────────────
interface VendorRcaDrawerProps {
  vendor: string | null;
  onClose: () => void;
}

export function VendorRcaDrawer({ vendor, onClose }: VendorRcaDrawerProps) {
  const { data, isLoading, error } = useQuery<VendorRcaPayload>({
    queryKey: ['/api/vendor-rca', vendor],
    queryFn: async () => {
      const r = await fetch(`/api/vendor-rca/${encodeURIComponent(vendor!)}`);
      if (!r.ok) throw new Error('Failed to load RCA');
      return r.json();
    },
    enabled: !!vendor,
    staleTime: 3 * 60_000,
    refetchInterval: 5 * 60_000,
  });

  if (!vendor) return null;

  const vd  = data?.verdict;
  const urg = urgencyCfg[vd?.urgency ?? 'healthy'] ?? urgencyCfg.healthy;
  const chartColor = vd ? (vd.currentQ >= 75 ? '#34d399' : vd.currentQ >= 55 ? '#38bdf8' : vd.currentQ >= 35 ? '#fbbf24' : '#f87171') : '#38bdf8';

  return (
    <>
      {/* ── Overlay ── */}
      <div
        className="fixed inset-0 bg-black/50 z-40 backdrop-blur-sm"
        onClick={onClose}
        data-testid="rca-overlay"
      />

      {/* ── Panel ── */}
      <div
        className="fixed top-0 right-0 h-full w-[480px] max-w-[95vw] bg-card border-l border-border/60 z-50 flex flex-col shadow-2xl"
        data-testid="rca-drawer"
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border/40 bg-muted/10 flex-shrink-0">
          <div className="p-1.5 rounded bg-violet-500/10 border border-violet-500/20">
            <BarChart2 className="w-4 h-4 text-violet-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-foreground truncate">{vendor}</p>
            <p className="text-[10px] text-muted-foreground">Root Cause Analysis</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-muted/20 text-muted-foreground hover:text-foreground transition-colors"
            data-testid="btn-close-rca"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center px-6">
              <RefreshCw className="w-8 h-8 text-muted-foreground/30 animate-spin" />
              <p className="text-sm text-muted-foreground">Assembling RCA for {vendor}…</p>
            </div>
          ) : error ? (
            <div className="flex items-center gap-2 text-sm text-rose-400 px-4 py-8">
              <AlertTriangle className="w-4 h-4" /> Failed to load RCA data
            </div>
          ) : !data ? null : (
            <div className="divide-y divide-border/20">

              {/* ── 1. Verdict ── */}
              <div className="px-4 py-4 space-y-3">
                <div className="flex items-center gap-3">
                  {/* Q badge */}
                  <div className={cn("flex items-center justify-center w-14 h-14 rounded-xl border-2 flex-shrink-0", qBg(vd!.currentQ))}>
                    <span className={cn("text-xl font-bold font-mono", qColor(vd!.currentQ))}>Q{vd!.currentQ}</span>
                  </div>
                  <div className="flex-1 min-w-0 space-y-1.5">
                    {/* Urgency + stability */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={cn("text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border", urg.cls)}>
                        {urg.label}
                      </span>
                      <span className={cn("text-[10px] font-semibold capitalize", stabCfg[vd!.stability])}>
                        {vd!.stability}
                      </span>
                      {vd!.trend !== 'flat' && (
                        vd!.trend === 'up'
                          ? <span className="text-emerald-400 text-[10px] font-mono">▲ +{vd!.trendPts}pts / 48h</span>
                          : <span className="text-rose-400 text-[10px] font-mono">▼ {vd!.trendPts}pts / 48h</span>
                      )}
                    </div>
                    {/* Metrics row */}
                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground/70">
                      <span>{vd!.callCount} calls (1h)</span>
                      {vd!.previousQ !== null && (
                        <span>
                          was Q{vd!.previousQ}
                          <span className={cn("ml-1 font-semibold", vd!.deltaQ >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
                            ({vd!.deltaQ >= 0 ? '+' : ''}{vd!.deltaQ})
                          </span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Signals */}
                {vd!.signals.length > 0 && (
                  <div className="space-y-1">
                    {vd!.signals.map((s, i) => (
                      <div key={i} className="flex items-start gap-1.5 text-[10px]">
                        <AlertTriangle className="w-3 h-3 text-amber-400 flex-shrink-0 mt-0.5" />
                        <span className="text-foreground/70">{s}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ── 2. Recommendation ── */}
              {data.recommendation && (
                <div className="px-4 py-3">
                  <SectionHeader icon={<Zap className="w-3.5 h-3.5" />} title="Recommendation" />
                  <div className={cn("rounded-lg border px-3 py-2.5 space-y-1", urgencyCfg[data.recommendation.urgency]?.cls ?? '')}>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] font-mono font-bold bg-background/20 px-1.5 py-0.5 rounded">
                        {data.recommendation.type}
                      </span>
                      <span className="text-[10px] font-semibold">{data.recommendation.title}</span>
                    </div>
                    <p className="text-[9px] text-current/70">{data.recommendation.ruleDescription}</p>
                    <div className="flex items-center gap-1.5 pt-0.5">
                      <div className="flex-1 h-1 bg-background/20 rounded-full">
                        <div className="h-full bg-current/50 rounded-full" style={{ width: `${data.recommendation.confidencePct}%` }} />
                      </div>
                      <span className="text-[9px] font-mono">{data.recommendation.confidencePct}% confidence</span>
                    </div>
                  </div>
                </div>
              )}

              {/* ── 3. Q-Timeline chart ── */}
              {data.timeline.length >= 2 && (
                <div className="px-4 py-3">
                  <SectionHeader icon={<Activity className="w-3.5 h-3.5" />} title="Q-Score History (48h)" />
                  <ResponsiveContainer width="100%" height={100}>
                    <AreaChart data={data.timeline} margin={{ top: 2, right: 4, left: -30, bottom: 0 }}>
                      <defs>
                        <linearGradient id="rcaGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor={chartColor} stopOpacity={0.3} />
                          <stop offset="95%" stopColor={chartColor} stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="ts" hide />
                      <YAxis domain={[0, 100]} tick={{ fill: '#666', fontSize: 8 }} tickLine={false} axisLine={false} tickFormatter={v => `Q${v}`} />
                      <Tooltip content={<ChartTooltip />} />
                      <ReferenceLine y={75} stroke={`${chartColor}30`} strokeDasharray="3 3" />
                      <ReferenceLine y={40} stroke="#f8717130" strokeDasharray="3 3" />
                      <Area type="monotone" dataKey="qScore" stroke={chartColor} strokeWidth={1.5} fill="url(#rcaGrad)" dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                  {data.timeline.length > 0 && (
                    <p className="text-[9px] text-muted-foreground/40 text-right mt-1 font-mono">
                      {new Date(data.timeline[0].ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} →{' '}
                      {new Date(data.timeline[data.timeline.length - 1].ts).toLocaleString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  )}
                </div>
              )}

              {/* ── 4. Degradation Decomposition ── */}
              {data.decomposition && (
                <div className="px-4 py-3">
                  <SectionHeader icon={<BarChart2 className="w-3.5 h-3.5" />} title="Q-Score Decomposition" />
                  <div className="space-y-3">
                    <DecompRow label="ASR" weight="40%" cur={data.decomposition.asr.cur} prev={data.decomposition.asr.prev} pts={data.decomposition.asr.pts} prevPts={data.decomposition.asr.prevPts} delta={data.decomposition.asr.delta} unit="%" />
                    <DecompRow label="NER" weight="30%" cur={data.decomposition.ner.cur} prev={data.decomposition.ner.prev} pts={data.decomposition.ner.pts} prevPts={data.decomposition.ner.prevPts} delta={data.decomposition.ner.delta} unit="%" />
                    <DecompRow label="FAS" weight="20%" cur={data.decomposition.fas.cur} prev={data.decomposition.fas.prev} pts={data.decomposition.fas.pts} prevPts={data.decomposition.fas.prevPts} delta={data.decomposition.fas.delta} unit="%" lowerIsBetter />
                    <DecompRow label="PDD" weight="10%" cur={data.decomposition.pdd.cur} prev={data.decomposition.pdd.prev} pts={data.decomposition.pdd.pts} prevPts={data.decomposition.pdd.prevPts} delta={data.decomposition.pdd.delta} unit="s" lowerIsBetter />
                  </div>
                  <p className="text-[9px] text-muted-foreground/40 mt-2">
                    Bars show contribution toward Q-score. Delta = change vs prev 60-min window.
                  </p>
                </div>
              )}

              {/* ── 5. Prefix breakdown ── */}
              {data.prefixes.length > 0 && (
                <div className="px-4 py-3">
                  <SectionHeader icon={<Globe className="w-3.5 h-3.5" />} title="Prefix Quality Breakdown" count={data.prefixes.length} />
                  <div className="space-y-1">
                    {data.prefixes.slice(0, 12).map((p: any, i: number) => (
                      <div
                        key={i}
                        className={cn(
                          "flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-[10px]",
                          p.status === 'fail' ? 'border-rose-500/20 bg-rose-500/5' :
                          p.status === 'warn' ? 'border-amber-500/15 bg-amber-500/5' :
                          'border-border/20 bg-muted/5'
                        )}
                        data-testid={`prefix-row-${i}`}
                      >
                        <span className="text-base leading-none">{p.flag}</span>
                        <div className="flex-1 min-w-0">
                          <span className="font-semibold text-foreground/80">{p.label}</span>
                          {p.insufficient && <span className="ml-1 text-[8px] text-muted-foreground/50">(low sample)</span>}
                        </div>
                        <div className="flex items-center gap-3 text-muted-foreground/60">
                          <span>ASR {p.asr}%</span>
                          {p.fasRate > 0 && <span className="text-rose-400">FAS {p.fasRate}%</span>}
                          <span>{p.calls} calls</span>
                        </div>
                        <span className={cn("font-mono font-bold ml-1", qColor(p.q))}>Q{p.q}</span>
                      </div>
                    ))}
                    {data.prefixes.length > 12 && (
                      <p className="text-[9px] text-muted-foreground/40 text-center pt-1">
                        +{data.prefixes.length - 12} more prefixes
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* ── 6. FAS summary ── */}
              {(data.fas.last24h > 0 || data.fas.totalEvents > 0) && (
                <div className="px-4 py-3">
                  <SectionHeader icon={<Shield className="w-3.5 h-3.5" />} title="FAS / Fraud Signals" />
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <div className="rounded-lg border border-border/30 bg-muted/5 px-3 py-2 text-center">
                      <p className="text-[9px] text-muted-foreground/60 uppercase tracking-wider">Last 24h</p>
                      <p className={cn("text-lg font-bold font-mono", data.fas.last24h > 0 ? 'text-rose-400' : 'text-emerald-400')}>
                        {data.fas.last24h}
                      </p>
                    </div>
                    <div className="rounded-lg border border-border/30 bg-muted/5 px-3 py-2 text-center">
                      <p className="text-[9px] text-muted-foreground/60 uppercase tracking-wider">All time</p>
                      <p className="text-lg font-bold font-mono text-foreground/80">{data.fas.totalEvents}</p>
                    </div>
                  </div>
                  {data.fas.topCallee && (
                    <p className="text-[10px] text-muted-foreground/60">
                      Top callee: <span className="font-mono text-foreground/80">{data.fas.topCallee}</span>
                    </p>
                  )}
                  {data.fas.affectedPrefixes.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {data.fas.affectedPrefixes.map((pfx, i) => (
                        <span key={i} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-rose-500/10 border border-rose-500/20 text-rose-300">
                          +{pfx}…
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── 7. Incident timeline ── */}
              <div className="px-4 py-3">
                <SectionHeader icon={<Clock className="w-3.5 h-3.5" />} title="Incident Timeline" count={data.incidents.length} />
                {data.incidents.length === 0 ? (
                  <p className="text-[10px] text-muted-foreground/50 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> No incidents linked to this vendor
                  </p>
                ) : (
                  <div className="space-y-2">
                    {data.incidents.map((inc, i) => (
                      <div key={i} className={cn(
                        "rounded-lg border px-3 py-2 space-y-1.5",
                        inc.severity === 'critical' ? 'border-rose-500/20 bg-rose-500/5' :
                        inc.severity === 'high' ? 'border-orange-500/20 bg-orange-500/5' :
                        'border-border/30 bg-muted/5'
                      )} data-testid={`incident-${i}`}>
                        <div className="flex items-start gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-[9px] font-mono bg-muted/20 px-1.5 py-0.5 rounded">{inc.type}</span>
                              <span className={cn("text-[9px] font-semibold uppercase", incidentSev[inc.severity] ?? 'text-muted-foreground')}>{inc.severity}</span>
                              {inc.state && <span className={cn("text-[9px]", stateColor[inc.state] ?? 'text-muted-foreground')}>● {inc.state}</span>}
                            </div>
                            <p className="text-[10px] font-semibold text-foreground/80 mt-0.5">{inc.title}</p>
                          </div>
                          <span className="text-[9px] text-muted-foreground/40 font-mono flex-shrink-0">#{inc.incidentId}</span>
                        </div>
                        {inc.events.length > 0 && (
                          <div className="border-t border-border/20 pt-1.5 space-y-0.5">
                            {inc.events.slice(-4).map((ev, j) => (
                              <div key={j} className="flex items-center gap-1.5 text-[9px]">
                                <div className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", stateColor[ev.toState] ? '' : 'bg-muted')}
                                  style={{ backgroundColor: ev.toState === 'open' ? '#fbbf24' : ev.toState === 'escalated' ? '#f87171' : ev.toState === 'resolved' ? '#34d399' : '#6b7280' }} />
                                <span className={cn("font-semibold capitalize", stateColor[ev.toState] ?? 'text-muted-foreground')}>{ev.toState}</span>
                                {ev.fromState && (
                                  <span className="text-muted-foreground/40">from {ev.fromState}</span>
                                )}
                                {ev.note && <span className="text-muted-foreground/50 truncate">— {ev.note}</span>}
                                <span className="ml-auto text-muted-foreground/30 flex-shrink-0">{relTime(ev.ts)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="px-4 py-3 text-[9px] text-muted-foreground/30 text-center">
                Generated {data?.generatedAt ? new Date(data.generatedAt).toLocaleTimeString() : '—'} · Zero Sippy calls
              </div>

            </div>
          )}
        </div>
      </div>
    </>
  );
}

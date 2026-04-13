import { useState, useEffect } from "react";
import { useDashboardStats } from "@/hooks/use-dashboard";
import { useCalls } from "@/hooks/use-calls";
import { useSettings } from "@/hooks/use-settings";
import { StatCard } from "@/components/stat-card";
import { MosBadge } from "@/components/mos-badge";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { 
  Activity, 
  Server, 
  AlertTriangle, 
  PhoneCall, 
  ArrowRight,
  BarChart2,
  RefreshCw,
  Clock,
  Timer,
  PhoneMissed,
  PhoneOff,
  Signal,
  CheckCircle2,
  Globe,
  DollarSign,
  PhoneIncoming,
  Settings,
  ShieldAlert,
  Eye,
  TrendingUp,
  TrendingDown,
  Zap,
  Users,
  Award,
  Radio,
  ArrowUpRight,
  Minus,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { 
  ComposedChart,
  Area, 
  Bar,
  BarChart,
  Line,
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Cell,
} from "recharts";
import { formatUTC } from "@/lib/date-utils";
import { cn } from "@/lib/utils";
import { lookupCountry } from "@/lib/country-lookup";

// Parses Sippy's non-standard timestamp "20260411T20:20:32.055" → ms since epoch
function parseSippyTime(setupTime: string): number | null {
  const normalized = setupTime.replace(/^(\d{4})(\d{2})(\d{2})T/, '$1-$2-$3T');
  const t = new Date(normalized).getTime();
  return isNaN(t) ? null : t;
}

function fmtDur(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// Row component so each live-call row has its own ticking duration state
function LiveCallRow({ call, index }: { call: any; index: number }) {
  const [elapsed, setElapsed] = useState<number>(() => {
    if (call.setupTime) {
      const start = parseSippyTime(call.setupTime);
      if (start !== null) return Math.max(0, Math.floor((Date.now() - start) / 1000));
    }
    return parseFloat(call.duration ?? 0);
  });

  useEffect(() => {
    const start = call.setupTime ? parseSippyTime(call.setupTime) : null;
    if (start !== null) {
      const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - start) / 1000)));
      tick();
      const id = setInterval(tick, 1000);
      return () => clearInterval(id);
    } else {
      setElapsed(parseFloat(call.duration ?? 0));
      const id = setInterval(() => setElapsed(v => v + 1), 1000);
      return () => clearInterval(id);
    }
  }, [call.setupTime]);

  const isConnected = call.callStatus === 'connected';
  const durLabel = elapsed > 0 ? fmtDur(elapsed) : '0s';
  let answerType: { label: string; cls: string; title: string };
  if (!isConnected) {
    answerType = { label: 'Routing', cls: 'bg-amber-500/15 text-amber-400', title: 'Call is being routed — not yet answered' };
  } else if (elapsed < 3) {
    answerType = { label: 'FAS Risk', cls: 'bg-red-500/15 text-red-400', title: `Connected in ${durLabel} — possible False Answer Supervision` };
  } else {
    answerType = { label: 'Real Answer', cls: 'bg-emerald-500/15 text-emerald-400', title: `Answered after ${durLabel} — genuine human answer` };
  }

  return (
    <tr key={index} className="hover:bg-muted/30 transition-colors" data-testid={`row-live-call-${index}`}>
      <td className="px-6 py-3 font-mono text-xs">{call.caller || '—'}</td>
      <td className="px-6 py-3 font-mono text-xs">{call.callee || '—'}</td>
      <td className="px-6 py-3 text-xs text-violet-400">{call.clientName || call.accountId || '—'}</td>
      <td className="px-6 py-3 text-xs">
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
          isConnected ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'
        }`}>{call.ccState || call.status || '—'}</span>
      </td>
      <td className={`px-6 py-3 text-xs font-mono ${isConnected && elapsed < 3 ? 'text-red-400 font-semibold' : 'text-muted-foreground'}`}>
        {durLabel}
      </td>
      <td className="px-6 py-3 text-xs">
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${answerType.cls}`} title={answerType.title}>
          {answerType.label}
        </span>
      </td>
      <td className="px-6 py-3 text-xs text-muted-foreground">
        {call.setupTime ? call.setupTime.replace(/^(\d{4})(\d{2})(\d{2})T/, '$1-$2-$3 ').replace(/\.\d+$/, '') : '—'}
      </td>
    </tr>
  );
}

export default function DashboardPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: stats } = useDashboardStats();
  const { data: recentCalls } = useCalls(5);
  const { data: settings } = useSettings();
  const [trendHours, setTrendHours] = useState(1);



  // Sippy session
  const { data: sippySession } = useQuery<{ active: boolean; username?: string; connectedAt?: string; portalUrl?: string }>({
    queryKey: ['/api/sippy/session'],
    refetchInterval: 30000,
  });
  // Sippy live calls — always polled; server uses hardcoded defaults so no session needed
  const { data: sippyLiveCalls } = useQuery<{ calls: any[]; connected?: boolean; error?: string }>({
    queryKey: ['/api/sippy/live-calls'],
    refetchInterval: 5000,
  });
  // Sippy real-time dashboard stats — ASR, ACD, PDD, active calls direct from Sippy switch
  const { data: sippyStats, isLoading: sippyStatsLoading, dataUpdatedAt: statsUpdatedAt } = useQuery<{
    asr: number; acd: number;
    connected: boolean;
    // CK stats from CDRs
    ckRatio?: number;
    ckBreakdown?: { connected: number; wrongNumber: number; switchedOff: number; untraceable: number; total: number };
    cdrCount?: number;
    // MOS estimate from E-model
    estimatedMos?: number | null;
    // CPS — from monitoring graph or CDR fallback
    cps?: number;
    cpsSource?: 'monitoring' | 'cdr';
  }>({
    queryKey: ['/api/sippy/dashboard-stats'],
    refetchInterval: 20000,
  });
  const isSippyReachable = sippyLiveCalls?.connected === true || !!sippySession?.active || sippyStats?.connected === true;
  // Sippy ASR/ACD report — CDR-based revenue & margin stats for last 90 min
  const { data: sippyFinancials, refetch: refetchFinancials, isRefetching: financialsRefetching } = useQuery<{
    ok: boolean; period: string;
    origination: { totalCalls: number; billableCalls: number; totalDurationSec: number; acd: number; asr: number; avgPdd: number; revenue: number };
    termination: { totalCalls: number; billableCalls: number; totalDurationSec: number; acd: number; asr: number; avgPdd: number; cost: number };
    margin: number;
  }>({
    queryKey: ['/api/sippy/asr-acd-stats'],
    refetchInterval: 120000,
    staleTime: 0,
    enabled: isSippyReachable,
  });

  const { data: fasEventsData } = useQuery<{ events: any[] }>({
    queryKey: ['/api/fas-events'],
    refetchInterval: 30000,
  });
  const recentFasEvents = (fasEventsData?.events ?? []).slice(0, 5);

  const { data: qualityTrend } = useQuery<{ ok: boolean; points: { ts: number; asr: number; acd: number }[] }>({
    queryKey: ['/api/sippy/monitoring/acd-asr', trendHours],
    queryFn: async () => {
      const res = await fetch(`/api/sippy/monitoring/acd-asr?hours=${trendHours}&interval=300`);
      if (!res.ok) throw new Error('Failed to fetch quality trend');
      return res.json();
    },
    refetchInterval: 60000,
    enabled: isSippyReachable,
  });

  // Downsample monitoring points to ~30 for clean chart display
  const chartData = (() => {
    const pts = qualityTrend?.points ?? [];
    if (!pts.length) return [];
    const step = Math.max(1, Math.ceil(pts.length / 30));
    return pts
      .filter((_, i) => i % step === 0 || i === pts.length - 1)
      .map(p => ({
        time: formatUTC(new Date(p.ts * 1000), 'HH:mm'),
        asr: parseFloat(p.asr.toFixed(1)),
        acd: parseFloat(p.acd.toFixed(0)),
      }));
  })();


  const simulationOff = settings && !settings.simulationEnabled;
  // anyPortalActive: true as soon as any Sippy endpoint confirms reachability
  const anyPortalActive = isSippyReachable;
  const notConnected = simulationOff && !anyPortalActive;


  const liveCalls = sippyLiveCalls?.calls ?? [];

  // When Sippy is connected, use Sippy switch data for all KPI cards.
  // activeCalls + PDD come from /api/sippy/live-calls (5-second poll) — NOT dashboard-stats,
  // to avoid concurrent XML-RPC requests that throttle Sippy and break the Live Calls page.
  const displayActiveCalls = anyPortalActive ? liveCalls.length : (stats?.activeCalls ?? 0);
  const displayAsr = anyPortalActive ? (sippyStats?.asr ?? 0) : (stats?.asr ?? 0);
  // ACD: Sippy returns seconds; format for display separately
  const displayAcd = anyPortalActive ? (sippyStats?.acd ?? 0) : (stats?.acd ?? 0);
  const displayPdd = anyPortalActive
    ? (() => {
        const routing = liveCalls.filter((c: any) => c.delay && c.delay > 0);
        return routing.length > 0
          ? parseFloat((routing.reduce((s: number, c: any) => s + c.delay, 0) / routing.length).toFixed(2))
          : 0;
      })()
    : (stats?.pdd ?? 0);

  // MOS: when Sippy is connected, use E-model estimate from probe latency; fall back to local DB
  const displayMos = anyPortalActive
    ? (sippyStats?.estimatedMos ?? null)
    : (stats?.avgMos ?? null);
  const mosLabel = anyPortalActive && sippyStats?.estimatedMos != null ? 'est.' : '';

  // CK ratio: when Sippy is connected, use CDR-derived stats; fall back to local DB
  const displayCkRatio     = anyPortalActive && sippyStats?.ckBreakdown != null
    ? (sippyStats.ckRatio ?? 0)
    : (stats?.ckRatio ?? 0);
  const displayCkBreakdown = anyPortalActive && sippyStats?.ckBreakdown != null
    ? sippyStats.ckBreakdown
    : stats?.ckBreakdown;

  // ── Traffic Quality Score (0–100 composite) ───────────────────────────────
  // Weighted: ASR 45% + MOS 30% + CK ratio 15% + PDD penalty 10%
  const trafficScore = anyPortalActive ? Math.min(100, Math.max(0, Math.round(
    displayAsr * 0.45 +
    (displayMos != null ? (displayMos / 5) * 30 : 25) +
    displayCkRatio * 0.15 +
    (displayPdd > 0 ? Math.max(0, (4 - Math.min(displayPdd, 4)) / 4 * 10) : 10)
  ))) : 0;
  const scoreLabel = trafficScore >= 80 ? 'Excellent' : trafficScore >= 60 ? 'Good' : trafficScore >= 40 ? 'Fair' : 'Poor';
  const scoreBorder = trafficScore >= 80 ? 'border-emerald-500/20' : trafficScore >= 60 ? 'border-blue-500/20' : trafficScore >= 40 ? 'border-amber-500/20' : (notConnected ? 'border-border/50' : 'border-rose-500/20');
  const scoreTextCls = trafficScore >= 80 ? 'text-emerald-400' : trafficScore >= 60 ? 'text-blue-400' : trafficScore >= 40 ? 'text-amber-400' : 'text-rose-400';

  // ── Call rate (calls / min) from CDR count over last 1 hr ─────────────────
  const callRatePerMin = sippyStats?.cdrCount && sippyStats.cdrCount > 0
    ? parseFloat((sippyStats.cdrCount / 60).toFixed(1))
    : 0;


  // ── Last refreshed countdown ──────────────────────────────────────────────
  // statsUpdatedAt changes on every successful fetch (even if data is identical),
  // so the timer resets every 20 s — not just when Sippy returns different values.
  const [secsAgo, setSecsAgo] = useState(0);
  useEffect(() => {
    setSecsAgo(0);
    const t = setInterval(() => setSecsAgo(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [statsUpdatedAt]);

  if (!stats) return <div className="p-8">Loading dashboard...</div>;

  return (
    <div className="space-y-6">
      {/* ── Page Header ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold tracking-tight">Network Operations Center</h2>
            {anyPortalActive && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                LIVE
              </span>
            )}
          </div>
          <p className="text-muted-foreground text-sm mt-1">
            Sippy Softswitch · iEnvironment=5 · <span className="font-mono text-xs">{sippySession?.username ?? 'not connected'}</span>
            {anyPortalActive && secsAgo < 60 && (
              <span className="ml-2 text-muted-foreground/60">· refreshed {secsAgo}s ago</span>
            )}
          </p>
        </div>
        {/* Inline key metrics strip */}
        {anyPortalActive && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-card border border-border/50">
              <Radio className="w-3 h-3 text-blue-400" />
              <span className="text-muted-foreground">Active:</span>
              <span className="font-bold text-blue-400">{displayActiveCalls}</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-card border border-border/50" title="Call attempts per minute — average over the last hour, computed from CDR records">
              <Zap className="w-3 h-3 text-violet-400" />
              <span className="text-muted-foreground">Call Rate:</span>
              <span className="font-bold text-violet-400">{callRatePerMin}/min</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-card border border-border/50">
              <BarChart2 className="w-3 h-3 text-emerald-400" />
              <span className="text-muted-foreground">ASR:</span>
              <span className={`font-bold ${displayAsr >= 10 ? 'text-emerald-400' : displayAsr > 0 ? 'text-amber-400' : 'text-rose-400'}`}>{displayAsr.toFixed(1)}%</span>
            </div>
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-card border border-border/50`}>
              <Award className="w-3 h-3 text-amber-400" />
              <span className="text-muted-foreground">Score:</span>
              <span className={`font-bold ${scoreTextCls}`}>{trafficScore}/100</span>
            </div>
          </div>
        )}
      </div>

      {/* Connection required banner */}
      {notConnected && (
        <div className="rounded-xl border-2 border-dashed border-violet-500/40 bg-violet-500/5 p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-full bg-violet-500/15 flex items-center justify-center flex-shrink-0">
              <Globe className="w-5 h-5 text-violet-400" />
            </div>
            <div>
              <p className="font-semibold text-sm">No live data source connected</p>
              <p className="text-xs text-muted-foreground mt-1">
                Simulation is disabled. Connect to your Sippy softswitch to see real call data, CDR records, and traffic stats here.
              </p>
            </div>
          </div>
          <Link href="/settings"
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-500 transition-colors whitespace-nowrap flex-shrink-0">
            <Settings className="w-3.5 h-3.5" />
            Connect Softswitch
          </Link>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Active Calls + call rate badge */}
        <div className={cn(
          "bg-card border border-blue-500/20 rounded-xl p-5 shadow-lg shadow-black/5 hover:border-blue-500/40 transition-all duration-300 relative overflow-hidden group"
        )}>
          <div className="absolute top-0 right-0 p-4 opacity-[0.03] group-hover:opacity-[0.07] transition-opacity duration-500">
            <PhoneCall className="w-24 h-24" />
          </div>
          <div className="flex items-center justify-between mb-3 relative z-10">
            <h3 className="text-sm font-medium text-muted-foreground">Active Calls</h3>
            <div className="p-2 bg-secondary/50 rounded-lg group-hover:bg-blue-500/10 transition-colors">
              <PhoneCall className="w-4 h-4 text-foreground group-hover:text-blue-400" />
            </div>
          </div>
          <div className="relative z-10">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold tracking-tight tabular-nums">
                {notConnected ? '—' : displayActiveCalls}
              </span>
              {anyPortalActive && callRatePerMin > 0 && (
                <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-violet-400/10 text-violet-400 cursor-help" title={`Call rate: ${callRatePerMin} calls per minute — 1-hour CDR average`}>
                  {callRatePerMin}/min
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {anyPortalActive ? "Live concurrent calls on Sippy" : "Currently connected sessions"}
            </p>
          </div>
        </div>

        {/* Average MOS */}
        <StatCard 
          title="Avg MOS"
          value={notConnected ? '—' : displayMos != null ? `${displayMos.toFixed(2)}` : '—'}
          icon={Activity}
          className={displayMos != null && displayMos > 4 ? "border-emerald-500/20" : "border-amber-500/20"}
          description={anyPortalActive && mosLabel ? "E-model estimate · Sippy" : "Mean Opinion Score (5.0 scale)"}
          trend={anyPortalActive && displayMos != null ? {
            value: Math.round((displayMos / 5 - 0.8) * 100),
            isPositive: displayMos >= 4
          } : undefined}
        />

        {/* Traffic Quality Score */}
        <div className={cn(
          "bg-card border rounded-xl p-5 shadow-lg shadow-black/5 hover:border-opacity-60 transition-all duration-300 relative overflow-hidden group",
          scoreBorder
        )}>
          <div className="absolute top-0 right-0 p-4 opacity-[0.03] group-hover:opacity-[0.07] transition-opacity duration-500">
            <Award className="w-24 h-24" />
          </div>
          <div className="flex items-center justify-between mb-3 relative z-10">
            <h3 className="text-sm font-medium text-muted-foreground">Traffic Score</h3>
            <div className="p-2 bg-secondary/50 rounded-lg group-hover:bg-amber-500/10 transition-colors">
              <Award className="w-4 h-4 text-foreground group-hover:text-amber-400" />
            </div>
          </div>
          <div className="relative z-10">
            <div className="flex items-baseline gap-2">
              <span className={cn("text-3xl font-bold tracking-tight tabular-nums", notConnected ? 'text-muted-foreground/40' : scoreTextCls)}>
                {notConnected ? '—' : trafficScore}
              </span>
              {!notConnected && <span className="text-sm text-muted-foreground">/100</span>}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {notConnected ? 'Connect to see quality score' : `${scoreLabel} · ASR+MOS+CK composite`}
            </p>
          </div>
          {/* Score bar */}
          {!notConnected && (
            <div className="mt-3 h-1 rounded-full bg-muted/40 overflow-hidden relative z-10">
              <div
                className={cn("h-full rounded-full transition-all duration-700",
                  trafficScore >= 80 ? 'bg-emerald-500' : trafficScore >= 60 ? 'bg-blue-500' : trafficScore >= 40 ? 'bg-amber-500' : 'bg-rose-500'
                )}
                style={{ width: `${trafficScore}%` }}
              />
            </div>
          )}
        </div>

        {/* Live CPS */}
        {(() => {
          const cps = anyPortalActive ? (sippyStats?.cps ?? 0) : 0;
          const cpsSource = sippyStats?.cpsSource ?? 'cdr';
          const cpsColor = cps === 0
            ? 'text-muted-foreground/50'
            : cps < 1 ? 'text-blue-400'
            : cps < 10 ? 'text-emerald-400'
            : cps < 30 ? 'text-amber-400'
            : 'text-rose-400';
          const cpsBorder = cps === 0
            ? 'border-border/50'
            : cps < 1 ? 'border-blue-500/20'
            : cps < 10 ? 'border-emerald-500/20'
            : cps < 30 ? 'border-amber-500/20'
            : 'border-rose-500/30';
          const srcLabel = cpsSource === 'monitoring' ? '5-min avg · Sippy monitor' : '1-hr avg · CDR estimate';
          const cpsLabel = cps === 0 ? 'No CDR data yet'
            : cps < 1 ? `Low traffic · ${srcLabel}`
            : cps < 10 ? `Normal load · ${srcLabel}`
            : cps < 30 ? `Moderate load · ${srcLabel}`
            : `High load · ${srcLabel}`;
          return (
            <div className={`bg-card border ${cpsBorder} rounded-xl p-5 shadow-lg shadow-black/5 hover:border-opacity-60 transition-all duration-300 relative overflow-hidden group`} title="Calls Per Second — how many new calls are being attempted per second">
              <div className="absolute top-0 right-0 p-4 opacity-[0.03] group-hover:opacity-[0.07] transition-opacity duration-500">
                <Zap className="w-24 h-24" />
              </div>
              <div className="flex items-center justify-between mb-3 relative z-10">
                <h3 className="text-sm font-medium text-muted-foreground">Calls/sec (CPS)</h3>
                <div className="p-2 bg-secondary/50 rounded-lg group-hover:bg-amber-500/10 transition-colors">
                  <Zap className={`w-4 h-4 ${cps > 0 ? cpsColor : 'text-foreground'} group-hover:text-amber-400`} />
                </div>
              </div>
              <div className="relative z-10">
                <div className="flex items-baseline gap-1.5">
                  <span className={`text-3xl font-bold tracking-tight tabular-nums ${notConnected ? 'text-muted-foreground/40' : cpsColor}`}>
                    {notConnected ? '—' : (sippyStatsLoading && !sippyStats) ? '…' : cps > 0 ? cps.toFixed(2) : '0.00'}
                  </span>
                  {!notConnected && <span className="text-sm text-muted-foreground">/s</span>}
                </div>
                <p className="text-xs text-muted-foreground mt-1">{notConnected ? 'Connect to see CPS' : cpsLabel}</p>
              </div>
              {!notConnected && cps > 0 && (
                <div className="mt-3 h-1 rounded-full bg-muted/40 overflow-hidden relative z-10">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${cps < 1 ? 'bg-blue-500' : cps < 10 ? 'bg-emerald-500' : cps < 30 ? 'bg-amber-500' : 'bg-rose-500'}`}
                    style={{ width: `${Math.min(100, (cps / 2) * 100)}%` }}
                  />
                </div>
              )}
            </div>
          );
        })()}

      </div>


      {/* ── Revenue / Cost / Margin Strip ──────────────────────────────────── */}
      {anyPortalActive && (
        <div className="rounded-xl border border-border/50 bg-card/40 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-2.5 border-b border-border/40 bg-muted/10">
            <div className="flex items-center gap-2">
              <DollarSign className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Revenue &amp; Cost — 90→30 min ago (settled CDRs)</span>
            </div>
            <button
              onClick={() => refetchFinancials()}
              disabled={financialsRefetching}
              className="flex items-center gap-1 text-[10px] text-muted-foreground/70 hover:text-muted-foreground transition-colors px-2 py-1 rounded hover:bg-muted/30 disabled:opacity-50"
              title="Refresh revenue & cost data"
              data-testid="button-refresh-financials"
            >
              <RefreshCw className={`w-3 h-3 ${financialsRefetching ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">{financialsRefetching ? 'Refreshing…' : 'Refresh'}</span>
            </button>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-6 divide-x divide-border/40">
            {/* Orig calls */}
            <div className="px-4 py-3 text-center">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Total Calls</p>
              <p className="text-xl font-bold tabular-nums">{sippyFinancials?.origination.totalCalls ?? '—'}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{sippyFinancials ? `${sippyFinancials.origination.billableCalls} billable` : '…'}</p>
            </div>
            {/* ASR orig */}
            <div className="px-4 py-3 text-center">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">ASR</p>
              <p className={`text-xl font-bold tabular-nums ${(sippyFinancials?.origination.asr ?? 0) >= 30 ? 'text-emerald-400' : (sippyFinancials?.origination.asr ?? 0) > 0 ? 'text-amber-400' : 'text-muted-foreground'}`}>
                {sippyFinancials?.origination.totalCalls ? `${sippyFinancials.origination.asr}%` : '—'}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">ACD: {sippyFinancials?.origination.acd ? `${sippyFinancials.origination.acd}s` : '—'}</p>
            </div>
            {/* Revenue */}
            <div className="px-4 py-3 text-center bg-emerald-500/5">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Revenue</p>
              <p className={`text-xl font-bold tabular-nums ${(sippyFinancials?.origination.revenue ?? 0) > 0 ? 'text-emerald-400' : 'text-muted-foreground'}`} data-testid="fin-revenue">
                {sippyFinancials?.origination.revenue != null ? `$${sippyFinancials.origination.revenue.toFixed(4)}` : '—'}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Customer billed</p>
            </div>
            {/* Term calls */}
            <div className="px-4 py-3 text-center">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Term Calls</p>
              <p className="text-xl font-bold tabular-nums">{sippyFinancials?.termination.totalCalls ?? '—'}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{sippyFinancials ? `${sippyFinancials.termination.billableCalls} billable` : '…'}</p>
            </div>
            {/* Cost */}
            <div className="px-4 py-3 text-center bg-rose-500/5">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Cost</p>
              <p className={`text-xl font-bold tabular-nums ${(sippyFinancials?.termination.cost ?? 0) > 0 ? 'text-rose-400' : 'text-muted-foreground'}`} data-testid="fin-cost">
                {sippyFinancials?.termination.cost != null ? `$${sippyFinancials.termination.cost.toFixed(4)}` : '—'}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Vendor cost</p>
            </div>
            {/* Margin */}
            <div className={`px-4 py-3 text-center ${(sippyFinancials?.margin ?? 0) > 0 ? 'bg-emerald-500/10' : (sippyFinancials?.margin ?? 0) < 0 ? 'bg-rose-500/10' : ''}`}>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Margin</p>
              <p className={`text-xl font-bold tabular-nums flex items-center justify-center gap-1 ${(sippyFinancials?.margin ?? 0) > 0 ? 'text-emerald-400' : (sippyFinancials?.margin ?? 0) < 0 ? 'text-rose-400' : 'text-muted-foreground'}`} data-testid="fin-margin">
                {(sippyFinancials?.margin ?? 0) > 0 ? <TrendingUp className="w-4 h-4" /> : (sippyFinancials?.margin ?? 0) < 0 ? <TrendingDown className="w-4 h-4" /> : <Minus className="w-4 h-4" />}
                {sippyFinancials?.margin != null ? `$${Math.abs(sippyFinancials.margin).toFixed(4)}` : '—'}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Revenue − Cost</p>
            </div>
          </div>
        </div>
      )}


      {/* Active Calls Table — Sippy live when connected, local DB otherwise */}
      <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="p-6 border-b border-border/50 flex items-center justify-between">
          <h3 className="font-semibold flex items-center gap-2">
            <PhoneCall className="w-4 h-4 text-blue-500" />
            {anyPortalActive ? `Live Calls on Sippy (${liveCalls.length})` : 'Recent Active Calls'}
          </h3>
          <Link href="/calls" className="inline-flex items-center text-sm font-medium text-primary hover:text-primary/80 transition-colors">
            View All Calls <ArrowRight className="ml-1 w-4 h-4" />
          </Link>
        </div>
        <div className="overflow-x-auto">
          {anyPortalActive ? (
            liveCalls.length === 0 ? (
              <div className="px-6 py-12 text-center text-sm text-muted-foreground">No active calls on Sippy right now.</div>
            ) : (
              <table className="w-full text-sm text-left">
                <thead className="bg-muted/50 text-muted-foreground font-medium">
                  <tr>
                    <th className="px-6 py-3">Caller</th>
                    <th className="px-6 py-3">Callee</th>
                    <th className="px-6 py-3">Account</th>
                    <th className="px-6 py-3">State</th>
                    <th className="px-6 py-3">Duration</th>
                    <th className="px-6 py-3">Answer Type</th>
                    <th className="px-6 py-3">Setup Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {liveCalls.slice(0, 20).map((call: any, i: number) => (
                    <LiveCallRow key={call.callId || i} call={call} index={i} />
                  ))}
                </tbody>
              </table>
            )
          ) : (
            <table className="w-full text-sm text-left">
              <thead className="bg-muted/50 text-muted-foreground font-medium">
                <tr>
                  <th className="px-6 py-3">Caller</th>
                  <th className="px-6 py-3">Callee</th>
                  <th className="px-6 py-3">Started</th>
                  <th className="px-6 py-3">MOS Score</th>
                  <th className="px-6 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {recentCalls?.map((call) => {
                  const calleeCountry = lookupCountry(call.callee);
                  return (
                    <tr key={call.id} className="hover:bg-muted/30 transition-colors group">
                      <td className="px-6 py-4 font-mono text-xs">{call.caller}</td>
                      <td className="px-6 py-4">
                        <span className="font-mono text-xs">{call.callee}</span>
                        {calleeCountry && (
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {calleeCountry.flag} {calleeCountry.name}
                          </p>
                        )}
                      </td>
                      <td className="px-6 py-4 text-muted-foreground">
                        {call.startTime ? formatUTC(new Date(call.startTime), 'HH:mm:ss') : '-'}
                      </td>
                      <td className="px-6 py-4">
                        <MosBadge value={call.latestMetric?.mos || 0} />
                      </td>
                      <td className="px-6 py-4 text-right">
                        <Link href={`/calls/${call.id}`} className="text-primary hover:underline opacity-0 group-hover:opacity-100 transition-opacity">
                          Details
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── Graphs Row: ASR/ACD Trend + Call Back Ratio ─────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">

        {/* ASR & ACD Trend */}
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold flex items-center gap-2">
                <Activity className="w-4 h-4 text-primary" />
                ASR &amp; ACD Trend
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">Answer-Seizure Ratio (%) + Avg Call Duration (s)</p>
            </div>
            <div className="flex items-center gap-2">
              {chartData.length > 0 && (
                <div className="hidden sm:flex items-center gap-3 text-xs mr-2">
                  <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-emerald-500 rounded-full inline-block" /> ASR</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-violet-400 rounded-full inline-block" style={{borderTop: '2px dashed #a78bfa'}} /> ACD</span>
                </div>
              )}
              <select
                className="bg-background border border-border rounded-md text-xs px-2 py-1"
                value={trendHours}
                onChange={e => setTrendHours(Number(e.target.value))}
                data-testid="select-trend-window"
              >
                <option value={1}>Last 1h</option>
                <option value={6}>Last 6h</option>
                <option value={24}>Last 24h</option>
              </select>
            </div>
          </div>
          <div className="h-[260px] w-full">
            {chartData.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center gap-3 text-muted-foreground">
                <Activity className="w-8 h-8 opacity-30" />
                <p className="text-sm">{notConnected ? 'Connect to softswitch to see live trends.' : 'Loading trend data…'}</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 4, right: 40, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorAsrG" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.25}/>
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" vertical={false} />
                  <XAxis dataKey="time" stroke="#555" fontSize={10} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis yAxisId="asr" orientation="left" stroke="#555" fontSize={10} tickLine={false} axisLine={false} domain={[0, 100]} tickFormatter={(v) => `${v}%`} width={36} />
                  <YAxis yAxisId="acd" orientation="right" stroke="#555" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}s`} width={36} />
                  <Tooltip contentStyle={{ backgroundColor: '#0f0f0f', borderColor: '#2a2a2a', borderRadius: '8px', fontSize: '11px' }} itemStyle={{ color: '#ccc' }} formatter={(value: any, name: string) => name === 'asr' ? [`${value}%`, 'ASR'] : [`${value}s`, 'ACD']} />
                  <Area yAxisId="asr" type="monotone" dataKey="asr" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#colorAsrG)" dot={false} />
                  <Line yAxisId="acd" type="monotone" dataKey="acd" stroke="#a78bfa" strokeWidth={1.5} strokeDasharray="4 3" dot={false} activeDot={{ r: 3, fill: '#a78bfa' }} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Call Back Ratio — FAS Deduction */}
        <div className="rounded-xl border border-border/50 bg-card/60 overflow-hidden">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4 px-6 py-4 border-b border-border/50">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-sm tracking-wide uppercase text-muted-foreground">Call Back Ratio</h3>
              <span className="text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-400 border border-violet-500/20">
                FAS Deduction
              </span>
            </div>
            <p className="text-xs text-muted-foreground/70">
              Calls answered by the actual user ÷ total call attempts · Failed calls (wrong number, switched off, untraceable) are deducted
            </p>
          </div>
          <div className="flex flex-col items-end gap-0.5">
            <span
              data-testid="text-ck-ratio"
              className={`text-4xl font-bold font-mono tabular-nums ${
                notConnected ? 'text-muted-foreground/40' :
                displayCkRatio >= 80 ? 'text-emerald-400' :
                displayCkRatio >= 60 ? 'text-amber-400' : 'text-rose-400'
              }`}
            >
              {notConnected ? '—' : `${displayCkRatio.toFixed(1)}%`}
            </span>
            <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">
              {anyPortalActive && sippyStats?.ckBreakdown != null ? 'last 2 hr · sippy cdrs' : 'connection rate today'}
            </span>
          </div>
        </div>

        {notConnected ? (
          <div className="flex items-center justify-center py-10 text-sm text-muted-foreground gap-2">
            <Globe className="w-4 h-4" />
            Connect to your softswitch to see call breakdown data
          </div>
        ) : (
        <>{/* Breakdown columns */}
        <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-border/50">
          {/* Connected */}
          <div className="flex flex-col items-center gap-1.5 py-5 px-4">
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Connected</span>
            <span data-testid="text-ck-connected" className="text-2xl font-bold text-emerald-400 tabular-nums">
              {(displayCkBreakdown?.connected ?? 0).toLocaleString()}
            </span>
            <span className="text-xs text-center text-muted-foreground">Answered by user</span>
          </div>
          {/* Wrong Number */}
          <div className="flex flex-col items-center gap-1.5 py-5 px-4">
            <PhoneMissed className="w-5 h-5 text-rose-400" />
            <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Wrong Number</span>
            <span data-testid="text-ck-wrong" className="text-2xl font-bold text-rose-400 tabular-nums">
              {(displayCkBreakdown?.wrongNumber ?? 0).toLocaleString()}
            </span>
            <span className="text-xs text-center text-muted-foreground">Invalid / misrouted</span>
          </div>
          {/* Switched Off */}
          <div className="flex flex-col items-center gap-1.5 py-5 px-4">
            <PhoneOff className="w-5 h-5 text-orange-400" />
            <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Switched Off</span>
            <span data-testid="text-ck-off" className="text-2xl font-bold text-orange-400 tabular-nums">
              {(displayCkBreakdown?.switchedOff ?? 0).toLocaleString()}
            </span>
            <span className="text-xs text-center text-muted-foreground">Device unreachable</span>
          </div>
          {/* Untraceable */}
          <div className="flex flex-col items-center gap-1.5 py-5 px-4">
            <Signal className="w-5 h-5 text-amber-400" />
            <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Untraceable</span>
            <span data-testid="text-ck-untraceable" className="text-2xl font-bold text-amber-400 tabular-nums">
              {(displayCkBreakdown?.untraceable ?? 0).toLocaleString()}
            </span>
            <span className="text-xs text-center text-muted-foreground">No network / signal</span>
          </div>
        </div>

        {/* Progress bar + legend */}
        {(displayCkBreakdown?.total ?? 0) > 0 && (
          <div className="px-6 pb-5 pt-2 space-y-2">
            <div className="h-2.5 rounded-full overflow-hidden bg-muted/30 flex">
              <div
                className="bg-emerald-500 h-full transition-all duration-500"
                style={{ width: `${(displayCkBreakdown?.connected ?? 0) / (displayCkBreakdown?.total ?? 1) * 100}%` }}
              />
              <div
                className="bg-rose-500 h-full transition-all duration-500"
                style={{ width: `${(displayCkBreakdown?.wrongNumber ?? 0) / (displayCkBreakdown?.total ?? 1) * 100}%` }}
              />
              <div
                className="bg-orange-500 h-full transition-all duration-500"
                style={{ width: `${(displayCkBreakdown?.switchedOff ?? 0) / (displayCkBreakdown?.total ?? 1) * 100}%` }}
              />
              <div
                className="bg-amber-500 h-full transition-all duration-500"
                style={{ width: `${(displayCkBreakdown?.untraceable ?? 0) / (displayCkBreakdown?.total ?? 1) * 100}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground/60">
              <span>
                <span className="text-muted-foreground font-medium">{(displayCkBreakdown?.total ?? 0).toLocaleString()}</span>
                {' '}{anyPortalActive && sippyStats?.ckBreakdown != null ? 'calls last hour (Sippy CDRs)' : 'total attempts today'}
              </span>
              <span>
                Failed: <span className="text-rose-400 font-medium">
                  {((displayCkBreakdown?.total ?? 0) - (displayCkBreakdown?.connected ?? 0)).toLocaleString()}
                </span>
              </span>
            </div>
          </div>
        )}
        </>
        )}
      </div>

      </div>{/* ── end Graphs Row grid ─── */}

      {/* ── FAS Events + Stats ───────────────────────────────────────────────── */}
      {(fasEventsData?.events ?? []).length > 0 && (() => {
        const fasAll = fasEventsData!.events;
        const zeroBilled  = fasAll.filter((e: any) => (e.reason ?? '').includes('zero_billed')).length;
        const highPdd     = fasAll.filter((e: any) => (e.reason ?? '').includes('high_pdd')).length;
        const shortBilled = fasAll.filter((e: any) => (e.reason ?? '').includes('short_billed')).length;
        const earlyAnswer = fasAll.filter((e: any) => (e.reason ?? '').includes('early_answer')).length;
        const fasBarData = [
          { name: 'Zero Billed', count: zeroBilled,  fill: '#ef4444' },
          { name: 'High PDD',    count: highPdd,     fill: '#f97316' },
          { name: 'Short Billed',count: shortBilled, fill: '#a855f7' },
          { name: 'Early Answer',count: earlyAnswer, fill: '#eab308' },
        ];
        return (
          <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-2 px-5 py-3 border-b border-rose-500/15">
              <ShieldAlert className="w-4 h-4 text-rose-400" />
              <h3 className="font-semibold text-sm text-rose-300">FAS Detections</h3>
              <span className="ml-1 text-xs text-rose-400/70">— False Answer Supervision analysis</span>
              <Link href="/fraud" className="ml-auto text-xs text-rose-400 hover:text-rose-300 flex items-center gap-1">
                View all <ArrowRight className="w-3 h-3" />
              </Link>
            </div>

            {/* Stats + Chart row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-0 divide-y md:divide-y-0 md:divide-x divide-rose-500/15">
              {/* Stat chips */}
              <div className="grid grid-cols-2 divide-x divide-y divide-rose-500/10">
                {[
                  { label: 'Zero Billed',  count: zeroBilled,  cls: 'text-red-400',    bg: 'bg-red-500/10'    },
                  { label: 'High PDD',     count: highPdd,     cls: 'text-orange-400', bg: 'bg-orange-500/10' },
                  { label: 'Short Billed', count: shortBilled, cls: 'text-violet-400', bg: 'bg-violet-500/10' },
                  { label: 'Early Answer', count: earlyAnswer, cls: 'text-yellow-400', bg: 'bg-yellow-500/10' },
                ].map(s => (
                  <div key={s.label} className={`flex flex-col items-center justify-center py-5 px-3 ${s.bg}`}>
                    <span className={`text-2xl font-bold tabular-nums ${s.cls}`}>{s.count}</span>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1 text-center">{s.label}</span>
                  </div>
                ))}
              </div>
              {/* Bar chart */}
              <div className="p-4">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Reason Breakdown</p>
                <div className="h-[140px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={fasBarData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }} barCategoryGap="30%">
                      <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" vertical={false} />
                      <XAxis dataKey="name" stroke="#555" fontSize={9} tickLine={false} axisLine={false} />
                      <YAxis stroke="#555" fontSize={9} tickLine={false} axisLine={false} allowDecimals={false} />
                      <Tooltip contentStyle={{ backgroundColor: '#0f0f0f', borderColor: '#2a2a2a', borderRadius: '8px', fontSize: '11px' }} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                      <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                        {fasBarData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.fill} fillOpacity={0.8} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* Events feed */}
            <div className="divide-y divide-rose-500/10 border-t border-rose-500/15">
              {recentFasEvents.map((ev: any) => {
                const reasons: string[] = (ev.reason ?? '').split(',').map((r: string) => r.trim()).filter(Boolean);
                return (
                  <div key={ev.id} className="flex items-center gap-4 px-5 py-2.5 text-xs hover:bg-rose-500/5">
                    <div className="flex-shrink-0 text-muted-foreground/60 w-28">
                      {formatUTC(new Date(ev.detectedAt), 'dd MMM HH:mm:ss')}
                    </div>
                    <div className="flex-shrink-0 min-w-[90px]">
                      <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary/80 font-medium">
                        {ev.clientName || 'Unknown'}
                      </span>
                    </div>
                    <div className="flex-shrink-0">
                      {ev.vendor ? (
                        <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 font-medium">
                          <Server className="h-2.5 w-2.5" />{ev.vendor}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/40">—</span>
                      )}
                    </div>
                    <div className="font-mono text-muted-foreground truncate">
                      {ev.caller ?? '—'} <span className="text-muted-foreground/40">→</span> {ev.callee ?? '—'}
                    </div>
                    <div className="ml-auto flex items-center gap-1.5 flex-shrink-0">
                      {reasons.map(r => (
                        <span key={r} className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${
                          r === 'high_pdd'    ? 'bg-orange-500/15 text-orange-400' :
                          r === 'zero_billed' ? 'bg-red-500/15 text-red-400' :
                          r === 'short_billed'? 'bg-violet-500/15 text-violet-400' :
                          r === 'early_answer'? 'bg-yellow-500/15 text-yellow-400' :
                          'bg-muted/30 text-muted-foreground'
                        }`}>
                          {r.replace(/_/g, ' ')}
                        </span>
                      ))}
                      <span className="ml-1 text-rose-400 font-bold">Score {ev.fraudScore ?? 0}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

    </div>
  );
}

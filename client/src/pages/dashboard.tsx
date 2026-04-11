import { useState } from "react";
import { useDashboardStats } from "@/hooks/use-dashboard";
import { useCalls } from "@/hooks/use-calls";
import { useAlerts } from "@/hooks/use-alerts";
import { useSettings } from "@/hooks/use-settings";
import { StatCard } from "@/components/stat-card";
import { MosBadge } from "@/components/mos-badge";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { 
  Activity, 
  Server, 
  AlertTriangle, 
  PhoneCall, 
  ArrowRight,
  Wifi,
  WifiOff,
  RefreshCw,
  BarChart2,
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
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer 
} from "recharts";
import { formatUTC } from "@/lib/date-utils";
import { cn } from "@/lib/utils";
import { lookupCountry } from "@/lib/country-lookup";

type ProbeEntry = {
  label: string;
  ip: string;
  latency: number;
  reachable: boolean;
  port?: number;
  timestamp: string;
};

type ProbeStatus = {
  ip: string | null;
  latency: number;
  reachable: boolean;
  timestamp: string;
  port?: number;
  probes?: ProbeEntry[];
};

export default function DashboardPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: stats } = useDashboardStats();
  const { data: recentCalls } = useCalls(5);
  const { data: recentAlerts } = useAlerts();
  const { data: settings } = useSettings();
  const [trendHours, setTrendHours] = useState(1);


  const { data: probe, isLoading: probeLoading } = useQuery<ProbeStatus>({
    queryKey: ['/api/probe/status'],
    refetchInterval: 15000,
  });

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
  const { data: sippyStats, isLoading: sippyStatsLoading } = useQuery<{
    activeCalls: number; totalCalls: number; answeredCalls: number;
    asr: number; acd: number; pdd: number; totalMinutes: number;
    connected: boolean; liveCount: number; rawFields: Record<string, string>;
    // CK stats from CDRs
    ckRatio?: number;
    ckBreakdown?: { connected: number; wrongNumber: number; switchedOff: number; untraceable: number; total: number };
    cdrCount?: number;
    // MOS estimate from E-model
    estimatedMos?: number | null;
  }>({
    queryKey: ['/api/sippy/dashboard-stats'],
    refetchInterval: 15000,
  });
  // Sippy CDR records — poll once connected
  const isSippyReachable = sippyLiveCalls?.connected === true || !!sippySession?.active || sippyStats?.connected === true;
  const { data: sippyCdr } = useQuery<{ cdrs: any[]; error?: string }>({
    queryKey: ['/api/sippy/cdr'],
    refetchInterval: 60000,
    enabled: isSippyReachable,
  });
  // Sippy ASR/ACD report — CDR-based revenue & margin stats for last 90 min
  const { data: sippyFinancials } = useQuery<{
    ok: boolean; period: string;
    origination: { totalCalls: number; billableCalls: number; totalDurationSec: number; acd: number; asr: number; avgPdd: number; revenue: number };
    termination: { totalCalls: number; billableCalls: number; totalDurationSec: number; acd: number; asr: number; avgPdd: number; cost: number };
    margin: number;
  }>({
    queryKey: ['/api/sippy/asr-acd-stats'],
    refetchInterval: 120000,
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

  const probeMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/probe/run'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/probe/status'] }),
  });

  const simulationOff = settings && !settings.simulationEnabled;
  // anyPortalActive: true as soon as any Sippy endpoint confirms reachability
  const anyPortalActive = isSippyReachable;
  const notConnected = simulationOff && !anyPortalActive;


  const liveCalls = sippyLiveCalls?.calls ?? [];

  // When Sippy is connected, use Sippy switch data for all KPI cards.
  // sippyStats.activeCalls comes from call_control.getCountersStats (real concurrent count).
  // Fall back to liveCount (snapshot) or local DB when Sippy stats not yet loaded.
  const displayActiveCalls = anyPortalActive
    ? (sippyStats?.activeCalls ?? sippyStats?.liveCount ?? liveCalls.length)
    : (stats?.activeCalls ?? 0);
  const displayAsr = anyPortalActive ? (sippyStats?.asr ?? 0) : (stats?.asr ?? 0);
  // ACD: Sippy returns seconds; format for display separately
  const displayAcd = anyPortalActive ? (sippyStats?.acd ?? 0) : (stats?.acd ?? 0);
  const displayPdd = anyPortalActive ? (sippyStats?.pdd ?? 0) : (stats?.pdd ?? 0);

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

  if (!stats) return <div className="p-8">Loading dashboard...</div>;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">System Overview</h2>
        <p className="text-muted-foreground mt-2">Real-time monitoring of VoIP infrastructure via Sippy Softswitch.</p>
      </div>

      {/* Connection required banner — shown when simulation is off and portal not connected */}
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

      {/* Connected source badge — shown when Sippy session is active */}
      {anyPortalActive && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-5 py-3 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <p className="text-sm text-emerald-400 font-medium">
              Live data — connected to <span className="font-semibold">Sippy</span> as{' '}
              <span className="font-mono">{sippySession?.username}</span>
            </p>
          </div>
          <span className="text-xs text-muted-foreground ml-auto">All stats below reflect your real switch traffic</span>
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <StatCard 
          title="Active Calls" 
          value={notConnected ? '—' : displayActiveCalls} 
          icon={PhoneCall}
          className="border-blue-500/20"
          description={anyPortalActive ? "Live calls on Sippy" : "Currently connected sessions"}
        />
        <StatCard 
          title="Average MOS"
          value={notConnected ? '—' : displayMos != null ? `${displayMos.toFixed(2)}${mosLabel ? ` (${mosLabel})` : ''}` : '—'}
          icon={Activity}
          className={displayMos != null && displayMos > 4 ? "border-emerald-500/20" : "border-amber-500/20"}
          description={anyPortalActive && mosLabel ? "E-model est. from probe latency" : "Mean Opinion Score (5.0 scale)"}
        />
        <StatCard 
          title="System Health"
          value={notConnected ? '—' : stats.systemHealth}
          icon={Server}
          className={stats.systemHealth === 'Healthy' ? "border-emerald-500/20" : "border-rose-500/20"}
          description="Infrastructure status"
        />
        <StatCard 
          title="Alerts Today"
          value={notConnected ? '—' : stats.alertsToday}
          icon={AlertTriangle}
          className={stats.alertsToday > 5 ? "border-rose-500/20" : "border-border/50"}
          description="Threshold breaches detected"
        />
      </div>

      {/* Telecom KPI Row */}
      <div className="grid gap-6 md:grid-cols-3">
        <StatCard
          title="ASR"
          value={notConnected ? '—' : (sippyStatsLoading && !sippyStats) ? '…' : `${displayAsr.toFixed(1)}%`}
          icon={BarChart2}
          className={displayAsr >= 70 ? "border-emerald-500/20" : displayAsr >= 50 ? "border-amber-500/20" : (notConnected ? "border-border/50" : "border-rose-500/20")}
          description="Answer-Seizure Ratio — calls answered vs attempted"
        />
        <StatCard
          title="ACD"
          value={notConnected ? '—' : (sippyStatsLoading && !sippyStats) ? '…' : (() => {
            const acd = displayAcd;
            return acd >= 60 ? `${Math.floor(acd / 60)}m ${acd % 60}s` : `${acd}s`;
          })()}
          icon={Clock}
          className="border-violet-500/20"
          description="Avg Call Duration — mean length of completed calls"
        />
        <StatCard
          title="PDD"
          value={notConnected ? '—' : (sippyStatsLoading && !sippyStats) ? '…' : (displayPdd > 0 ? `${displayPdd.toFixed(2)}s` : '—')}
          icon={Timer}
          className={displayPdd > 0 && displayPdd <= 1.5 ? "border-emerald-500/20" : displayPdd > 1.5 ? "border-amber-500/20" : "border-border/50"}
          description="Post-Dial Delay — avg time from dial to first ringback"
        />
      </div>

      {/* Call Back Ratio — FAS Deduction Panel */}
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
              {anyPortalActive && sippyStats?.ckBreakdown != null ? 'last 1 hr · sippy cdrs' : 'connection rate today'}
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

      {/* FAS Recent Events Panel */}
      {recentFasEvents.length > 0 && (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-3 border-b border-rose-500/15">
            <ShieldAlert className="w-4 h-4 text-rose-400" />
            <h3 className="font-semibold text-sm text-rose-300">FAS Detections</h3>
            <span className="ml-1 text-xs text-rose-400/70">— False Answer Supervision events from last analysis</span>
            <Link href="/fraud" className="ml-auto text-xs text-rose-400 hover:text-rose-300 flex items-center gap-1">
              View all <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="divide-y divide-rose-500/10">
            {recentFasEvents.map((ev: any) => {
              const reasons: string[] = (ev.reason ?? '').split(',').map((r: string) => r.trim()).filter(Boolean);
              return (
                <div key={ev.id} className="flex items-center gap-4 px-5 py-2.5 text-xs hover:bg-rose-500/5">
                  <div className="flex-shrink-0 text-muted-foreground/60 w-28">
                    {formatUTC(new Date(ev.detectedAt), 'dd MMM HH:mm:ss')}
                  </div>
                  <div className="flex-shrink-0 min-w-[90px]">
                    <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary/80 font-medium">
                      {ev.clientName || ev.vendor || 'Unknown'}
                    </span>
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
      )}

      {/* Network Probe Panel — shows all monitored IPs */}
      {(() => {
        const entries: ProbeEntry[] = probe?.probes && probe.probes.length > 0
          ? probe.probes
          : probe?.ip
            ? [{ label: 'Live Source', ip: probe.ip, latency: probe.latency, reachable: probe.reachable, port: probe.port, timestamp: probe.timestamp }]
            : [];
        const allReachable = entries.length > 0 && entries.every(e => e.reachable);
        const anyReachable = entries.some(e => e.reachable);
        if (entries.length === 0 && !probeLoading) {
          return (
            <div className="rounded-xl border border-border/50 bg-muted/10 p-4 text-sm text-muted-foreground flex items-center gap-2">
              <WifiOff className="w-4 h-4" />
              No monitored IP configured. Set one in Settings.
            </div>
          );
        }
        if (entries.length === 0) return null;
        return (
          <div className={`rounded-xl border p-4 ${
            allReachable ? 'border-emerald-500/30 bg-emerald-500/5' : anyReachable ? 'border-amber-500/30 bg-amber-500/5' : 'border-rose-500/30 bg-rose-500/5'
          }`}>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex flex-col gap-3 flex-1">
                {entries.map((entry, idx) => (
                  <div key={entry.ip + idx} className={`flex items-center gap-3 ${idx > 0 ? 'pt-3 border-t border-border/40' : ''}`}>
                    {entry.reachable ? (
                      <Wifi className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    ) : (
                      <WifiOff className="w-4 h-4 text-rose-400 flex-shrink-0" />
                    )}
                    <div className="min-w-[100px]">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">{entry.label}</p>
                      <p className="font-mono text-sm font-semibold" data-testid={`text-probe-ip-${idx}`}>
                        {entry.ip}
                        {entry.port && <span className="ml-1 text-xs text-muted-foreground font-normal">:{entry.port}</span>}
                      </p>
                    </div>
                    <div className="h-6 w-px bg-border/50" />
                    <div>
                      <p className="text-xs text-muted-foreground">Status</p>
                      <p className={`text-sm font-semibold ${entry.reachable ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {entry.reachable ? 'Reachable' : 'Unreachable'}
                      </p>
                    </div>
                    {entry.reachable && (
                      <>
                        <div className="h-6 w-px bg-border/50" />
                        <div>
                          <p className="text-xs text-muted-foreground">Latency</p>
                          <p className="text-sm font-semibold font-mono" data-testid={idx === 0 ? 'text-probe-latency' : undefined}>
                            {entry.latency.toFixed(0)} ms
                          </p>
                        </div>
                      </>
                    )}
                    {entry.timestamp && (
                      <>
                        <div className="h-6 w-px bg-border/50" />
                        <div>
                          <p className="text-xs text-muted-foreground">Last Checked</p>
                          <p className="text-xs text-muted-foreground/80">{formatUTC(new Date(entry.timestamp), 'HH:mm:ss')}</p>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
              <button
                data-testid="button-probe-refresh"
                onClick={() => probeMutation.mutate()}
                disabled={probeMutation.isPending}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-card border border-border hover:bg-muted/50 transition-colors disabled:opacity-50 self-start"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${probeMutation.isPending ? 'animate-spin' : ''}`} />
                Probe All
              </button>
            </div>
          </div>
        );
      })()}

      <div className="grid gap-6 md:grid-cols-7">
        {/* Main Chart Area */}
        <div className="col-span-4 rounded-xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="font-semibold flex items-center gap-2">
                <Activity className="w-4 h-4 text-primary" />
                ASR Trend
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">Answer-Seizure Ratio — live from Sippy switch</p>
            </div>
            <select
              className="bg-background border border-border rounded-md text-xs px-2 py-1"
              value={trendHours}
              onChange={e => setTrendHours(Number(e.target.value))}
              data-testid="select-trend-window"
            >
              <option value={1}>Last Hour</option>
              <option value={6}>Last 6 Hours</option>
              <option value={24}>Last 24 Hours</option>
            </select>
          </div>
          <div className="h-[300px] w-full">
            {chartData.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center gap-3 text-muted-foreground">
                <Activity className="w-8 h-8 opacity-30" />
                <p className="text-sm">{notConnected ? 'Connect to your softswitch to see live ASR trends.' : 'Loading ASR trend data…'}</p>
              </div>
            ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="colorAsr" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                <XAxis dataKey="time" stroke="#666" fontSize={11} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis
                  stroke="#666"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  domain={[0, 100]}
                  tickFormatter={(v) => `${v}%`}
                  width={38}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: '#111', borderColor: '#333', borderRadius: '6px' }}
                  itemStyle={{ color: '#fff' }}
                  formatter={(value: any, name: string) =>
                    name === 'asr' ? [`${value}%`, 'ASR'] : [`${value}s`, 'ACD']
                  }
                />
                <Area
                  type="monotone"
                  dataKey="asr"
                  stroke="#10b981"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#colorAsr)"
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Recent Alerts Feed */}
        <div className="col-span-3 rounded-xl border border-border bg-card p-6 shadow-sm flex flex-col">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-semibold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              Recent Alerts
            </h3>
            <Link href="/alerts" className="text-xs text-primary hover:underline">View All</Link>
          </div>
          <div className="space-y-4 flex-1 overflow-auto pr-2 custom-scrollbar">
            {recentAlerts?.slice(0, 5).map((alert) => (
              <div key={alert.id} className="flex gap-3 items-start p-3 rounded-lg bg-muted/30 border border-border/50 hover:bg-muted/50 transition-colors">
                <div className={cn(
                  "mt-1 w-2 h-2 rounded-full flex-shrink-0",
                  alert.severity === 'critical' ? 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]' : 'bg-amber-500'
                )} />
                <div className="space-y-1">
                  <p className="text-sm font-medium leading-none">{alert.type.replace('_', ' ').toUpperCase()}</p>
                  <p className="text-xs text-muted-foreground line-clamp-2">{alert.message}</p>
                  <p className="text-[10px] text-muted-foreground/60">
                    {formatUTC(new Date(alert.createdAt!), 'MMM d, HH:mm:ss')}
                  </p>
                </div>
              </div>
            ))}
            {(!recentAlerts || recentAlerts.length === 0) && (
              <div className="text-center py-8 text-muted-foreground text-sm">
                No active alerts. System healthy.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Sippy Live Data */}
      <div className="rounded-xl border overflow-hidden bg-card shadow-sm" style={{ borderColor: sippySession?.active ? 'rgb(139 92 246 / 0.3)' : undefined }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 bg-muted/20">
          <div className="flex items-center gap-3">
            <Globe className={`w-4 h-4 ${sippySession?.active ? 'text-violet-400' : 'text-muted-foreground'}`} />
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-sm">Sippy Live Data</h3>
                {sippySession?.active ? (
                  <span className="text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-400 border border-violet-500/20">Live</span>
                ) : (
                  <span className="text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">Not Connected</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {sippySession?.active
                  ? `Live calls & CDR from Sippy — logged in as ${sippySession.username}`
                  : 'Connect via Settings → Switch Configuration to see real call data here'}
              </p>
            </div>
          </div>
          {!sippySession?.active && (
            <Link href="/settings"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
              <Settings className="w-3 h-3" />
              Connect
            </Link>
          )}
        </div>

        {anyPortalActive ? (
          <div className="p-6 space-y-6">
            {/* Real-time Sippy switch KPIs */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-lg bg-muted/30 border border-border/40 px-4 py-3 text-center">
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Active Calls</p>
                {sippyStatsLoading && !sippyStats ? (
                  <div className="h-8 w-12 mx-auto bg-muted/60 rounded animate-pulse" />
                ) : (
                  <p className="text-2xl font-bold text-foreground tabular-nums">{displayActiveCalls}</p>
                )}
                <p className="text-[10px] text-violet-400 mt-0.5">Live snapshot</p>
              </div>
              <div className="rounded-lg bg-muted/30 border border-border/40 px-4 py-3 text-center">
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">ASR</p>
                {sippyStatsLoading && !sippyStats ? (
                  <div className="h-8 w-20 mx-auto bg-muted/60 rounded animate-pulse" />
                ) : (
                  <p className={`text-2xl font-bold tabular-nums ${displayAsr >= 10 ? 'text-emerald-400' : displayAsr > 0 ? 'text-amber-400' : 'text-rose-400'}`}>
                    {displayAsr.toFixed(2)}%
                  </p>
                )}
                <p className="text-[10px] text-muted-foreground mt-0.5">Last hour</p>
              </div>
              <div className="rounded-lg bg-muted/30 border border-border/40 px-4 py-3 text-center">
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">ACD</p>
                {sippyStatsLoading && !sippyStats ? (
                  <div className="h-8 w-16 mx-auto bg-muted/60 rounded animate-pulse" />
                ) : (
                  <p className="text-2xl font-bold text-foreground tabular-nums">
                    {sippyStats ? (displayAcd >= 60 ? `${Math.floor(displayAcd/60)}m ${displayAcd%60}s` : `${displayAcd}s`) : '—'}
                  </p>
                )}
                <p className="text-[10px] text-muted-foreground mt-0.5">Avg call duration</p>
              </div>
              <div className="rounded-lg bg-muted/30 border border-border/40 px-4 py-3 text-center">
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">PDD</p>
                {sippyStatsLoading && !sippyStats ? (
                  <div className="h-8 w-16 mx-auto bg-muted/60 rounded animate-pulse" />
                ) : (
                  <p className={`text-2xl font-bold tabular-nums ${displayPdd > 0 && displayPdd <= 2 ? 'text-emerald-400' : displayPdd > 2 ? 'text-amber-400' : 'text-muted-foreground'}`}>
                    {displayPdd > 0 ? `${displayPdd.toFixed(2)}s` : '—'}
                  </p>
                )}
                <p className="text-[10px] text-muted-foreground mt-0.5">Post-dial delay</p>
              </div>
            </div>

            {/* Revenue / Cost / Margin panel — from CDR API (90 min window) */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <DollarSign className="w-3.5 h-3.5" />
                  Revenue &amp; Cost (last 90 min — CDR data)
                </h4>
                {sippyFinancials && sippyFinancials.origination.totalCalls === 0 && (
                  <span className="text-[10px] text-muted-foreground/60 italic">No completed calls in the last 90 min — active calls appear here after they end</span>
                )}
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {/* Origination: calls, billable, ASR */}
                <div className="rounded-lg bg-muted/30 border border-border/40 px-3 py-2.5 text-center">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Calls (Orig)</p>
                  <p className="text-lg font-bold text-foreground tabular-nums" data-testid="fin-orig-calls">
                    {sippyFinancials?.origination.totalCalls ?? '—'}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {sippyFinancials ? `${sippyFinancials.origination.billableCalls} billable` : 'Loading...'}
                  </p>
                </div>
                <div className="rounded-lg bg-muted/30 border border-border/40 px-3 py-2.5 text-center">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">ASR (Orig)</p>
                  <p className={`text-lg font-bold tabular-nums ${
                    (sippyFinancials?.origination.asr ?? 0) >= 30 ? 'text-emerald-400' :
                    (sippyFinancials?.origination.asr ?? 0) > 0 ? 'text-amber-400' : 'text-muted-foreground'
                  }`} data-testid="fin-orig-asr">
                    {sippyFinancials?.origination.totalCalls ? `${sippyFinancials.origination.asr}%` : '—'}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    ACD: {sippyFinancials?.origination.acd ? `${sippyFinancials.origination.acd}s` : '—'}
                  </p>
                </div>
                <div className="rounded-lg bg-muted/20 border border-emerald-500/20 px-3 py-2.5 text-center">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Revenue</p>
                  <p className={`text-lg font-bold tabular-nums ${(sippyFinancials?.origination.revenue ?? 0) > 0 ? 'text-emerald-400' : 'text-muted-foreground'}`} data-testid="fin-revenue">
                    {sippyFinancials?.origination.revenue != null
                      ? `$${sippyFinancials.origination.revenue.toFixed(4)}`
                      : '—'}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Customer billed</p>
                </div>
                <div className="rounded-lg bg-muted/30 border border-border/40 px-3 py-2.5 text-center">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Calls (Term)</p>
                  <p className="text-lg font-bold text-foreground tabular-nums" data-testid="fin-term-calls">
                    {sippyFinancials?.termination.totalCalls ?? '—'}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {sippyFinancials ? `${sippyFinancials.termination.billableCalls} billable` : 'Loading...'}
                  </p>
                </div>
                <div className="rounded-lg bg-muted/20 border border-rose-500/20 px-3 py-2.5 text-center">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Cost</p>
                  <p className={`text-lg font-bold tabular-nums ${(sippyFinancials?.termination.cost ?? 0) > 0 ? 'text-rose-400' : 'text-muted-foreground'}`} data-testid="fin-cost">
                    {sippyFinancials?.termination.cost != null
                      ? `$${sippyFinancials.termination.cost.toFixed(4)}`
                      : '—'}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Vendor cost</p>
                </div>
                <div className={`rounded-lg border px-3 py-2.5 text-center ${
                  (sippyFinancials?.margin ?? 0) > 0
                    ? 'bg-emerald-500/10 border-emerald-500/30'
                    : (sippyFinancials?.margin ?? 0) < 0
                    ? 'bg-rose-500/10 border-rose-500/30'
                    : 'bg-muted/20 border-border/40'
                }`}>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Margin</p>
                  <p className={`text-lg font-bold tabular-nums ${
                    (sippyFinancials?.margin ?? 0) > 0 ? 'text-emerald-400' :
                    (sippyFinancials?.margin ?? 0) < 0 ? 'text-rose-400' : 'text-muted-foreground'
                  }`} data-testid="fin-margin">
                    {sippyFinancials?.margin != null
                      ? `${sippyFinancials.margin > 0 ? '+' : ''}$${sippyFinancials.margin.toFixed(4)}`
                      : '—'}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Revenue − Cost</p>
                </div>
              </div>
            </div>

            {/* Recent CDRs */}
            {(sippyCdr?.cdrs?.length ?? 0) > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  Recent CDR Records ({sippyCdr!.cdrs.length})
                </h4>
                <div className="overflow-x-auto rounded-lg border border-border/50">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-muted/30 text-muted-foreground text-xs">
                      <tr>
                        <th className="px-4 py-2">Start Time</th>
                        <th className="px-4 py-2">Caller (CLI)</th>
                        <th className="px-4 py-2">Callee (CLD)</th>
                        <th className="px-4 py-2">Country</th>
                        <th className="px-4 py-2">Duration</th>
                        <th className="px-4 py-2">PDD</th>
                        <th className="px-4 py-2">Cost</th>
                        <th className="px-4 py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/30">
                      {sippyCdr!.cdrs.slice(0, 10).map((rec: any, i: number) => {
                        const isAnswered = (rec.duration > 0) || /^(200|ok|answered|success)/i.test(rec.result || '');
                        const durSec = Number(rec.duration) || 0;
                        return (
                          <tr key={i} className="hover:bg-muted/20 transition-colors">
                            <td className="px-4 py-2 text-xs text-muted-foreground whitespace-nowrap">
                              {rec.startTime || rec.connectTime || '—'}
                            </td>
                            <td className="px-4 py-2 font-mono text-xs">{rec.caller || '—'}</td>
                            <td className="px-4 py-2 font-mono text-xs">{rec.callee || '—'}</td>
                            <td className="px-4 py-2 text-xs text-muted-foreground">{rec.country || rec.areaName || '—'}</td>
                            <td className="px-4 py-2 text-xs">
                              {durSec > 0 ? `${Math.floor(durSec / 60)}m ${durSec % 60}s` : '0s'}
                            </td>
                            <td className="px-4 py-2 text-xs text-muted-foreground">
                              {rec.pdd != null ? `${Number(rec.pdd).toFixed(2)}s` : '—'}
                            </td>
                            <td className="px-4 py-2 text-xs text-amber-400">
                              {rec.cost != null && rec.cost > 0 ? `$${Number(rec.cost).toFixed(4)}` : '—'}
                            </td>
                            <td className="px-4 py-2 text-xs">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                isAnswered
                                  ? 'bg-emerald-500/15 text-emerald-400'
                                  : 'bg-rose-500/15 text-rose-400'
                              }`}>
                                {isAnswered ? 'Answered' : (rec.result || '—')}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="p-6 text-center text-sm text-muted-foreground py-8">
            <Globe className="w-8 h-8 mx-auto mb-3 opacity-20" />
            <p>Sippy not connected.</p>
            <p className="text-xs mt-1">Go to <Link href="/settings" className="text-primary hover:underline">Settings → Switch Configuration</Link> and enter your Sippy credentials.</p>
          </div>
        )}
      </div>

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
                  {liveCalls.slice(0, 20).map((call: any, i: number) => {
                    const isConnected = call.callStatus === 'connected';
                    const dur = parseFloat(call.duration ?? 0);
                    const durMins = Math.floor(dur / 60);
                    const durSecs = Math.round(dur % 60);
                    const durLabel = dur > 0 ? (durMins > 0 ? `${durMins}m ${durSecs}s` : `${durSecs}s`) : '0s';

                    // FAS detection: Connected call with duration < 3s = likely False Answer Supervision
                    // Not-yet-answered (routing): ARComplete/WaitRoute etc.
                    // Real answer: Connected with duration >= 3s
                    let answerType: { label: string; cls: string; title: string };
                    if (!isConnected) {
                      answerType = { label: 'Routing', cls: 'bg-amber-500/15 text-amber-400', title: 'Call is being routed — not yet answered' };
                    } else if (dur < 3) {
                      answerType = { label: 'FAS Risk', cls: 'bg-red-500/15 text-red-400', title: `Connected in ${durLabel} — possible False Answer Supervision (billing started before real answer)` };
                    } else {
                      answerType = { label: 'Real Answer', cls: 'bg-emerald-500/15 text-emerald-400', title: `Answered after ${durLabel} — genuine human answer` };
                    }

                    return (
                      <tr key={i} className="hover:bg-muted/30 transition-colors" data-testid={`row-live-call-${i}`}>
                        <td className="px-6 py-3 font-mono text-xs">{call.caller || '—'}</td>
                        <td className="px-6 py-3 font-mono text-xs">{call.callee || '—'}</td>
                        <td className="px-6 py-3 text-xs text-violet-400">{call.clientName || call.accountId || '—'}</td>
                        <td className="px-6 py-3 text-xs">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                            isConnected ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'
                          }`}>{call.ccState || call.status || '—'}</span>
                        </td>
                        <td className={`px-6 py-3 text-xs font-mono ${isConnected && dur < 3 ? 'text-red-400 font-semibold' : 'text-muted-foreground'}`}>
                          {durLabel}
                        </td>
                        <td className="px-6 py-3 text-xs">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${answerType.cls}`} title={answerType.title}>
                            {answerType.label}
                          </span>
                        </td>
                        <td className="px-6 py-3 text-xs text-muted-foreground">
                          {call.setupTime ? call.setupTime.replace('T', ' ').replace(/\.\d+$/, '') : '—'}
                        </td>
                      </tr>
                    );
                  })}
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
    </div>
  );
}

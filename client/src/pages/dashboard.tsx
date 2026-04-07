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
  TrendingUp,
  DollarSign,
  PhoneIncoming,
  Settings,
} from "lucide-react";
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer 
} from "recharts";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { lookupCountry } from "@/lib/country-lookup";

type ProbeStatus = {
  ip: string | null;
  latency: number;
  reachable: boolean;
  timestamp: string;
};

export default function DashboardPage() {
  const queryClient = useQueryClient();
  const { data: stats } = useDashboardStats();
  const { data: recentCalls } = useCalls(5);
  const { data: recentAlerts } = useAlerts();
  const { data: settings } = useSettings();

  const { data: probe, isLoading: probeLoading } = useQuery<ProbeStatus>({
    queryKey: ['/api/probe/status'],
    refetchInterval: 15000,
  });

  // VOS3000 portal data
  const { data: portalSession } = useQuery<{ active: boolean; username?: string; loggedInAt?: string }>({
    queryKey: ['/api/portal/session'],
    refetchInterval: 30000,
  });
  // Sippy session
  const { data: sippySession } = useQuery<{ active: boolean; username?: string; connectedAt?: string; portalUrl?: string }>({
    queryKey: ['/api/sippy/session'],
    refetchInterval: 30000,
  });
  const { data: portalStats } = useQuery<{
    totalCalls: number; successCalls: number; failedCalls: number;
    totalMinutes: number; totalCost: number; asr: number; error?: string;
  }>({
    queryKey: ['/api/portal/stats'],
    refetchInterval: 60000,
    enabled: !!portalSession?.active,
  });
  const { data: portalLiveCalls } = useQuery<{ calls: any[]; error?: string }>({
    queryKey: ['/api/portal/live-calls'],
    refetchInterval: 15000,
    enabled: !!portalSession?.active,
  });
  // Sippy live calls — polled when Sippy session is active
  const { data: sippyLiveCalls } = useQuery<{ calls: any[]; error?: string }>({
    queryKey: ['/api/sippy/live-calls'],
    refetchInterval: 15000,
    enabled: !!sippySession?.active,
  });
  const { data: portalCdr } = useQuery<{ records: any[]; error?: string }>({
    queryKey: ['/api/portal/cdr'],
    refetchInterval: 60000,
    enabled: !!portalSession?.active,
  });

  const probeMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/probe/run'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/probe/status'] }),
  });

  const simulationOff = settings && !settings.simulationEnabled;
  const anyPortalActive = !!portalSession?.active || !!sippySession?.active;
  const notConnected = simulationOff && !anyPortalActive;

  // Build chart data from recent call metrics (real or simulated)
  const chartData = (recentCalls ?? [])
    .filter((c: any) => c.latestMetric)
    .map((c: any) => ({
      time: format(new Date(c.startTime), 'HH:mm'),
      mos: parseFloat((c.latestMetric?.mos ?? 0).toFixed(2)),
    }))
    .reverse();

  // Use portal stats for main cards when portal is active (prefer Sippy when both connected)
  const liveCalls = sippySession?.active
    ? (sippyLiveCalls?.calls ?? [])
    : (portalLiveCalls?.calls ?? []);

  const displayActiveCalls = anyPortalActive
    ? (liveCalls.length ?? stats?.activeCalls ?? 0)
    : (stats?.activeCalls ?? 0);
  const displayAsr = portalSession?.active
    ? (portalStats?.asr ?? stats?.asr ?? 0)
    : (stats?.asr ?? 0);
  const displayAcd = portalSession?.active
    ? (portalStats ? Math.round(portalStats.totalMinutes * 60 / Math.max(portalStats.successCalls, 1)) : (stats?.acd ?? 0))
    : (stats?.acd ?? 0);

  if (!stats) return <div className="p-8">Loading dashboard...</div>;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">System Overview</h2>
        <p className="text-muted-foreground mt-2">Real-time monitoring of VoIP infrastructure.</p>
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
                Simulation is disabled. Connect to your VOS3000 or Sippy softswitch to see real call data, CDR records, and traffic stats here.
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

      {/* Connected source badge — shown when any switch is active */}
      {anyPortalActive && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-5 py-3 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            {sippySession?.active && (
              <p className="text-sm text-emerald-400 font-medium">
                Live data — connected to <span className="font-semibold">Sippy</span> as{' '}
                <span className="font-mono">{sippySession.username}</span>
              </p>
            )}
            {portalSession?.active && (
              <p className="text-sm text-emerald-400 font-medium">
                {sippySession?.active ? '·' : ''} <span className="font-semibold">VOS3000</span> as{' '}
                <span className="font-mono">{portalSession.username}</span>
              </p>
            )}
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
          description={anyPortalActive ? "Live calls on portal" : "Currently connected sessions"}
        />
        <StatCard 
          title={anyPortalActive ? "Total Calls (24h)" : "Average MOS"}
          value={anyPortalActive
            ? (portalStats?.totalCalls?.toLocaleString() ?? liveCalls.length.toString())
            : (notConnected ? '—' : stats.avgMos.toFixed(2))}
          icon={anyPortalActive ? PhoneCall : Activity}
          className={anyPortalActive ? "border-blue-500/20" : (stats.avgMos > 4 ? "border-emerald-500/20" : "border-amber-500/20")}
          description={anyPortalActive ? "Total call attempts in last 24h" : "Mean Opinion Score (5.0 scale)"}
        />
        <StatCard 
          title={anyPortalActive ? "Answered" : "System Health"}
          value={anyPortalActive
            ? (portalStats?.successCalls?.toLocaleString() ?? '—')
            : (notConnected ? '—' : stats.systemHealth)}
          icon={anyPortalActive ? CheckCircle2 : Server}
          className={anyPortalActive ? "border-emerald-500/20" : (stats.systemHealth === 'Healthy' ? "border-emerald-500/20" : "border-rose-500/20")}
          description={anyPortalActive ? "Successfully answered calls" : "Infrastructure status"}
        />
        <StatCard 
          title={anyPortalActive ? "Total Minutes" : "Alerts Today"}
          value={anyPortalActive
            ? (portalStats?.totalMinutes?.toLocaleString() ?? '—')
            : (notConnected ? '—' : stats.alertsToday)}
          icon={anyPortalActive ? Clock : AlertTriangle}
          className={anyPortalActive ? "border-violet-500/20" : (stats.alertsToday > 5 ? "border-rose-500/20" : "border-border/50")}
          description={anyPortalActive ? "Total call minutes in last 24h" : "Threshold breaches detected"}
        />
      </div>

      {/* Telecom KPI Row */}
      <div className="grid gap-6 md:grid-cols-3">
        <StatCard
          title="ASR"
          value={notConnected ? '—' : `${displayAsr.toFixed(1)}%`}
          icon={BarChart2}
          className={displayAsr >= 70 ? "border-emerald-500/20" : displayAsr >= 50 ? "border-amber-500/20" : (notConnected ? "border-border/50" : "border-rose-500/20")}
          description="Answer-Seizure Ratio — calls answered vs attempted"
        />
        <StatCard
          title="ACD"
          value={notConnected ? '—' : (() => {
            const acd = displayAcd;
            return acd >= 60 ? `${Math.floor(acd / 60)}m ${acd % 60}s` : `${acd}s`;
          })()}
          icon={Clock}
          className="border-violet-500/20"
          description="Avg Call Duration — mean length of completed calls"
        />
        <StatCard
          title="PDD"
          value={notConnected ? '—' : ((stats.pdd ?? 0) > 0 ? `${(stats.pdd ?? 0).toFixed(2)}s` : '—')}
          icon={Timer}
          className={(stats.pdd ?? 0) > 0 && (stats.pdd ?? 0) <= 1.5 ? "border-emerald-500/20" : (stats.pdd ?? 0) > 1.5 ? "border-amber-500/20" : "border-border/50"}
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
                (stats.ckRatio ?? 0) >= 80 ? 'text-emerald-400' :
                (stats.ckRatio ?? 0) >= 60 ? 'text-amber-400' : 'text-rose-400'
              }`}
            >
              {notConnected ? '—' : `${(stats.ckRatio ?? 0).toFixed(1)}%`}
            </span>
            <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">connection rate today</span>
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
              {(stats.ckBreakdown?.connected ?? 0).toLocaleString()}
            </span>
            <span className="text-xs text-center text-muted-foreground">Answered by user</span>
          </div>
          {/* Wrong Number */}
          <div className="flex flex-col items-center gap-1.5 py-5 px-4">
            <PhoneMissed className="w-5 h-5 text-rose-400" />
            <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Wrong Number</span>
            <span data-testid="text-ck-wrong" className="text-2xl font-bold text-rose-400 tabular-nums">
              {(stats.ckBreakdown?.wrongNumber ?? 0).toLocaleString()}
            </span>
            <span className="text-xs text-center text-muted-foreground">Invalid / misrouted</span>
          </div>
          {/* Switched Off */}
          <div className="flex flex-col items-center gap-1.5 py-5 px-4">
            <PhoneOff className="w-5 h-5 text-orange-400" />
            <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Switched Off</span>
            <span data-testid="text-ck-off" className="text-2xl font-bold text-orange-400 tabular-nums">
              {(stats.ckBreakdown?.switchedOff ?? 0).toLocaleString()}
            </span>
            <span className="text-xs text-center text-muted-foreground">Device unreachable</span>
          </div>
          {/* Untraceable */}
          <div className="flex flex-col items-center gap-1.5 py-5 px-4">
            <Signal className="w-5 h-5 text-amber-400" />
            <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Untraceable</span>
            <span data-testid="text-ck-untraceable" className="text-2xl font-bold text-amber-400 tabular-nums">
              {(stats.ckBreakdown?.untraceable ?? 0).toLocaleString()}
            </span>
            <span className="text-xs text-center text-muted-foreground">No network / signal</span>
          </div>
        </div>

        {/* Progress bar + legend */}
        {(stats.ckBreakdown?.total ?? 0) > 0 && (
          <div className="px-6 pb-5 pt-2 space-y-2">
            <div className="h-2.5 rounded-full overflow-hidden bg-muted/30 flex">
              <div
                className="bg-emerald-500 h-full transition-all duration-500"
                style={{ width: `${(stats.ckBreakdown?.connected ?? 0) / (stats.ckBreakdown?.total ?? 1) * 100}%` }}
              />
              <div
                className="bg-rose-500 h-full transition-all duration-500"
                style={{ width: `${(stats.ckBreakdown?.wrongNumber ?? 0) / (stats.ckBreakdown?.total ?? 1) * 100}%` }}
              />
              <div
                className="bg-orange-500 h-full transition-all duration-500"
                style={{ width: `${(stats.ckBreakdown?.switchedOff ?? 0) / (stats.ckBreakdown?.total ?? 1) * 100}%` }}
              />
              <div
                className="bg-amber-500 h-full transition-all duration-500"
                style={{ width: `${(stats.ckBreakdown?.untraceable ?? 0) / (stats.ckBreakdown?.total ?? 1) * 100}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground/60">
              <span>
                <span className="text-muted-foreground font-medium">{(stats.ckBreakdown?.total ?? 0).toLocaleString()}</span> total attempts today
              </span>
              <span>
                FAS deductions: <span className="text-rose-400 font-medium">
                  {((stats.ckBreakdown?.total ?? 0) - (stats.ckBreakdown?.connected ?? 0)).toLocaleString()}
                </span>
              </span>
            </div>
          </div>
        )}
        </>
        )}
      </div>

      {/* Live IP Source Panel */}
      {probe?.ip && (
        <div className={`rounded-xl border p-4 flex items-center justify-between gap-4 ${
          probe.reachable
            ? 'border-emerald-500/30 bg-emerald-500/5'
            : 'border-rose-500/30 bg-rose-500/5'
        }`}>
          <div className="flex items-center gap-3">
            {probe.reachable ? (
              <Wifi className="w-5 h-5 text-emerald-400 flex-shrink-0" />
            ) : (
              <WifiOff className="w-5 h-5 text-rose-400 flex-shrink-0" />
            )}
            <div>
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Live Source</p>
              <p className="font-mono text-sm font-semibold" data-testid="text-live-ip">
                {probe.ip}
                {(probe as any).port && (
                  <span className="ml-1 text-xs text-muted-foreground font-normal">:{(probe as any).port}</span>
                )}
              </p>
            </div>
            <div className="h-8 w-px bg-border/50 mx-2" />
            <div>
              <p className="text-xs text-muted-foreground">Status</p>
              <p className={`text-sm font-semibold ${probe.reachable ? 'text-emerald-400' : 'text-rose-400'}`}>
                {probe.reachable ? 'Reachable' : 'Unreachable'}
              </p>
              {!probe.reachable && (
                <p className="text-[10px] text-muted-foreground/60 mt-0.5">No open ports found</p>
              )}
            </div>
            {probe.reachable && (
              <>
                <div className="h-8 w-px bg-border/50 mx-2" />
                <div>
                  <p className="text-xs text-muted-foreground">Probe Latency</p>
                  <p className="text-sm font-semibold font-mono" data-testid="text-probe-latency">
                    {probe.latency.toFixed(0)} ms
                  </p>
                </div>
              </>
            )}
            {probe.timestamp && (
              <>
                <div className="h-8 w-px bg-border/50 mx-2" />
                <div>
                  <p className="text-xs text-muted-foreground">Last Checked</p>
                  <p className="text-xs text-muted-foreground/80">
                    {format(new Date(probe.timestamp), 'HH:mm:ss')}
                  </p>
                </div>
              </>
            )}
          </div>
          <button
            data-testid="button-probe-refresh"
            onClick={() => probeMutation.mutate()}
            disabled={probeMutation.isPending}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-card border border-border hover:bg-muted/50 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${probeMutation.isPending ? 'animate-spin' : ''}`} />
            Probe Now
          </button>
        </div>
      )}
      {!probe?.ip && !probeLoading && (
        <div className="rounded-xl border border-border/50 bg-muted/10 p-4 text-sm text-muted-foreground flex items-center gap-2">
          <WifiOff className="w-4 h-4" />
          No monitored IP configured. Set one in Settings.
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-7">
        {/* Main Chart Area */}
        <div className="col-span-4 rounded-xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-semibold flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" />
              Network Quality Trend
            </h3>
            <select className="bg-background border border-border rounded-md text-xs px-2 py-1">
              <option>Last Hour</option>
              <option>Last 24 Hours</option>
            </select>
          </div>
          <div className="h-[300px] w-full">
            {chartData.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center gap-3 text-muted-foreground">
                <Activity className="w-8 h-8 opacity-30" />
                <p className="text-sm">No quality trend data yet.</p>
                <p className="text-xs opacity-60">{notConnected ? 'Connect to your softswitch to see live MOS trends.' : 'Data will appear as calls are processed.'}</p>
              </div>
            ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="colorMos" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                <XAxis dataKey="time" stroke="#666" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="#666" fontSize={12} tickLine={false} axisLine={false} domain={[1, 5]} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#111', borderColor: '#333' }}
                  itemStyle={{ color: '#fff' }}
                />
                <Area 
                  type="monotone" 
                  dataKey="mos" 
                  stroke="#10b981" 
                  strokeWidth={2}
                  fillOpacity={1} 
                  fill="url(#colorMos)" 
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
                    {format(new Date(alert.createdAt!), 'MMM d, HH:mm:ss')}
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

      {/* VOS3000 Portal Live Data — temporarily disabled */}
      <div className="hidden"><div className="rounded-xl border overflow-hidden bg-card shadow-sm" style={{ borderColor: portalSession?.active ? 'rgb(139 92 246 / 0.3)' : undefined }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 bg-muted/20">
          <div className="flex items-center gap-3">
            <Globe className={`w-4 h-4 ${portalSession?.active ? 'text-violet-400' : 'text-muted-foreground'}`} />
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-sm">VOS3000 Portal Data</h3>
                {portalSession?.active ? (
                  <span className="text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-400 border border-violet-500/20">
                    Live
                  </span>
                ) : (
                  <span className="text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
                    Not Connected
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {portalSession?.active
                  ? `Live CDR & stats from VOS3000 — logged in as ${portalSession.username}`
                  : 'Connect via Settings → Portal Sign-In to see real call data here'}
              </p>
            </div>
          </div>
          {!portalSession?.active && (
            <Link href="/settings"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
              <Settings className="w-3 h-3" />
              Connect
            </Link>
          )}
        </div>

        {portalSession?.active ? (
          <div className="p-6 space-y-6">
            {/* Stats strip */}
            {portalStats && !portalStats.error && (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                {[
                  { label: 'Total Calls (24h)', value: portalStats.totalCalls.toLocaleString(), icon: PhoneCall, color: 'text-blue-400' },
                  { label: 'Answered', value: portalStats.successCalls.toLocaleString(), icon: CheckCircle2, color: 'text-emerald-400' },
                  { label: 'Failed', value: portalStats.failedCalls.toLocaleString(), icon: PhoneOff, color: 'text-rose-400' },
                  { label: 'Total Minutes', value: portalStats.totalMinutes.toLocaleString(), icon: Clock, color: 'text-violet-400' },
                  { label: 'ASR', value: `${portalStats.asr}%`, icon: TrendingUp, color: portalStats.asr >= 70 ? 'text-emerald-400' : 'text-amber-400' },
                ].map(({ label, value, icon: Icon, color }) => (
                  <div key={label} className="bg-muted/30 rounded-lg p-3 border border-border/50">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Icon className={`w-3 h-3 ${color}`} />
                      <span className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</span>
                    </div>
                    <span className={`text-xl font-bold font-mono ${color}`}>{value}</span>
                  </div>
                ))}
              </div>
            )}
            {portalStats?.error && (
              <p className="text-sm text-amber-400 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" /> {portalStats.error}
              </p>
            )}

            {/* Live calls from portal */}
            {(portalLiveCalls?.calls?.length ?? 0) > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  Active Calls on Portal ({portalLiveCalls!.calls.length})
                </h4>
                <div className="overflow-x-auto rounded-lg border border-border/50">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-muted/30 text-muted-foreground text-xs">
                      <tr>
                        <th className="px-4 py-2">Client</th>
                        <th className="px-4 py-2">Caller</th>
                        <th className="px-4 py-2">Callee</th>
                        <th className="px-4 py-2">Gateway</th>
                        <th className="px-4 py-2">Duration</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/30">
                      {portalLiveCalls!.calls.slice(0, 10).map((call: any, i: number) => (
                        <tr key={i} className="hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-2 text-xs">
                            {call.clientName
                              ? <span className="text-violet-400 font-medium">{call.clientName}</span>
                              : <span className="text-muted-foreground/50">—</span>
                            }
                          </td>
                          <td className="px-4 py-2 font-mono text-xs">{call.caller || '—'}</td>
                          <td className="px-4 py-2 font-mono text-xs">{call.callee || '—'}</td>
                          <td className="px-4 py-2 text-xs text-muted-foreground">{call.gateway || '—'}</td>
                          <td className="px-4 py-2 text-xs text-muted-foreground">{call.duration > 0 ? `${Math.floor(call.duration / 60)}m ${call.duration % 60}s` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Recent CDRs from portal */}
            {(portalCdr?.records?.length ?? 0) > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  Recent CDR Records from Portal ({portalCdr!.records.length})
                </h4>
                <div className="overflow-x-auto rounded-lg border border-border/50">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-muted/30 text-muted-foreground text-xs">
                      <tr>
                        <th className="px-4 py-2">Client</th>
                        <th className="px-4 py-2">Start Time</th>
                        <th className="px-4 py-2">Caller</th>
                        <th className="px-4 py-2">Callee</th>
                        <th className="px-4 py-2">Duration</th>
                        <th className="px-4 py-2">Status</th>
                        <th className="px-4 py-2">Gateway</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/30">
                      {portalCdr!.records.slice(0, 10).map((rec: any, i: number) => (
                        <tr key={i} className="hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-2 text-xs">
                            {rec.clientName
                              ? <span className="text-violet-400 font-medium">{rec.clientName}</span>
                              : <span className="text-muted-foreground/50">—</span>
                            }
                          </td>
                          <td className="px-4 py-2 text-xs text-muted-foreground">{rec.startTime || '—'}</td>
                          <td className="px-4 py-2 font-mono text-xs">{rec.caller || '—'}</td>
                          <td className="px-4 py-2 font-mono text-xs">{rec.callee || '—'}</td>
                          <td className="px-4 py-2 text-xs">{rec.duration > 0 ? `${Math.floor(rec.duration / 60)}m ${rec.duration % 60}s` : '0s'}</td>
                          <td className="px-4 py-2 text-xs">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                              rec.status?.toLowerCase().includes('answer') || rec.status === '200' || rec.cause === '16'
                                ? 'bg-emerald-500/15 text-emerald-400'
                                : 'bg-rose-500/15 text-rose-400'
                            }`}>
                              {rec.status || rec.cause || '—'}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-xs text-muted-foreground">{rec.gateway || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* No data yet */}
            {!portalStats?.error && (portalCdr?.records?.length ?? 0) === 0 && (portalLiveCalls?.calls?.length ?? 0) === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                Fetching data from VOS3000… This may take a moment on the first load.
              </p>
            )}
          </div>
        ) : (
          <div className="p-6 text-center text-sm text-muted-foreground py-8">
            <Globe className="w-8 h-8 mx-auto mb-3 opacity-20" />
            <p>No portal session active.</p>
            <p className="text-xs mt-1">Go to <Link href="/settings" className="text-primary hover:underline">Settings → Portal Sign-In</Link> to connect to your VOS3000 carrier portal.</p>
          </div>
        )}
      </div></div>

      {/* Active Calls Table */}
      <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="p-6 border-b border-border/50 flex items-center justify-between">
          <h3 className="font-semibold flex items-center gap-2">
            <PhoneCall className="w-4 h-4 text-blue-500" />
            Recent Active Calls
          </h3>
          <Link href="/calls" className="inline-flex items-center text-sm font-medium text-primary hover:text-primary/80 transition-colors">
            View All Calls <ArrowRight className="ml-1 w-4 h-4" />
          </Link>
        </div>
        <div className="overflow-x-auto">
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
                      {call.startTime ? format(new Date(call.startTime), 'HH:mm:ss') : '-'}
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
        </div>
      </div>
    </div>
  );
}

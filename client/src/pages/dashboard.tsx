import { useDashboardStats } from "@/hooks/use-dashboard";
import { useCalls } from "@/hooks/use-calls";
import { useAlerts } from "@/hooks/use-alerts";
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
  CheckCircle2
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

  const { data: probe, isLoading: probeLoading } = useQuery<ProbeStatus>({
    queryKey: ['/api/probe/status'],
    refetchInterval: 15000,
  });

  const probeMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/probe/run'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/probe/status'] }),
  });

  // Mock data for the chart since we don't have historical aggregates in this simple MVP schema yet
  const chartData = [
    { time: '10:00', mos: 4.2 },
    { time: '10:05', mos: 4.1 },
    { time: '10:10', mos: 3.8 },
    { time: '10:15', mos: 4.3 },
    { time: '10:20', mos: 4.4 },
    { time: '10:25', mos: 4.2 },
    { time: '10:30', mos: 4.5 },
  ];

  if (!stats) return <div className="p-8">Loading dashboard...</div>;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">System Overview</h2>
        <p className="text-muted-foreground mt-2">Real-time monitoring of VoIP infrastructure.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <StatCard 
          title="Active Calls" 
          value={stats.activeCalls} 
          icon={PhoneCall}
          className="border-blue-500/20"
          description="Currently connected sessions"
        />
        <StatCard 
          title="Average MOS" 
          value={stats.avgMos.toFixed(2)} 
          icon={Activity}
          className={stats.avgMos > 4 ? "border-emerald-500/20" : "border-amber-500/20"}
          description="Mean Opinion Score (5.0 scale)"
        />
        <StatCard 
          title="System Health" 
          value={stats.systemHealth} 
          icon={Server}
          className={stats.systemHealth === 'Healthy' ? "border-emerald-500/20" : "border-rose-500/20"}
          description="Infrastructure status"
        />
        <StatCard 
          title="Alerts Today" 
          value={stats.alertsToday} 
          icon={AlertTriangle}
          className={stats.alertsToday > 5 ? "border-rose-500/20" : "border-border/50"}
          description="Threshold breaches detected"
        />
      </div>

      {/* Telecom KPI Row */}
      <div className="grid gap-6 md:grid-cols-3">
        <StatCard
          title="ASR"
          value={`${(stats.asr ?? 0).toFixed(1)}%`}
          icon={BarChart2}
          className={(stats.asr ?? 0) >= 70 ? "border-emerald-500/20" : (stats.asr ?? 0) >= 50 ? "border-amber-500/20" : "border-rose-500/20"}
          description="Answer-Seizure Ratio — calls answered vs attempted"
        />
        <StatCard
          title="ACD"
          value={(() => {
            const acd = stats.acd ?? 0;
            return acd >= 60 ? `${Math.floor(acd / 60)}m ${acd % 60}s` : `${acd}s`;
          })()}
          icon={Clock}
          className="border-violet-500/20"
          description="Avg Call Duration — mean length of completed calls"
        />
        <StatCard
          title="PDD"
          value={(stats.pdd ?? 0) > 0 ? `${(stats.pdd ?? 0).toFixed(2)}s` : '—'}
          icon={Timer}
          className={(stats.pdd ?? 0) > 0 && (stats.pdd ?? 0) <= 1.5 ? "border-emerald-500/20" : (stats.pdd ?? 0) > 1.5 ? "border-amber-500/20" : "border-border/50"}
          description="Post-Dial Delay — avg time from dial to first ringback"
        />
      </div>

      {/* CK Ratio — Connection Rate Panel */}
      <div className="rounded-xl border border-border/50 bg-card/60 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/50">
          <div>
            <h3 className="font-semibold text-sm tracking-wide uppercase text-muted-foreground">CK Ratio — Connection Rate</h3>
            <p className="text-xs text-muted-foreground/70 mt-0.5">Confirmed connected calls vs total attempted (today)</p>
          </div>
          <div className="flex items-center gap-2">
            <span
              data-testid="text-ck-ratio"
              className={`text-3xl font-bold font-mono ${
                (stats.ckRatio ?? 0) >= 80 ? 'text-emerald-400' :
                (stats.ckRatio ?? 0) >= 60 ? 'text-amber-400' : 'text-rose-400'
              }`}
            >
              {(stats.ckRatio ?? 0).toFixed(1)}%
            </span>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-border/50">
          {/* Connected */}
          <div className="flex flex-col items-center gap-1.5 py-5 px-4">
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Connected</span>
            <span data-testid="text-ck-connected" className="text-2xl font-bold text-emerald-400">
              {(stats.ckBreakdown?.connected ?? 0).toLocaleString()}
            </span>
            <span className="text-xs text-muted-foreground">Answered by user</span>
          </div>
          {/* Wrong Number */}
          <div className="flex flex-col items-center gap-1.5 py-5 px-4">
            <PhoneMissed className="w-5 h-5 text-rose-400" />
            <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Wrong Number</span>
            <span data-testid="text-ck-wrong" className="text-2xl font-bold text-rose-400">
              {(stats.ckBreakdown?.wrongNumber ?? 0).toLocaleString()}
            </span>
            <span className="text-xs text-muted-foreground">Invalid destination</span>
          </div>
          {/* Switched Off */}
          <div className="flex flex-col items-center gap-1.5 py-5 px-4">
            <PhoneOff className="w-5 h-5 text-orange-400" />
            <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Switched Off</span>
            <span data-testid="text-ck-off" className="text-2xl font-bold text-orange-400">
              {(stats.ckBreakdown?.switchedOff ?? 0).toLocaleString()}
            </span>
            <span className="text-xs text-muted-foreground">Device unreachable</span>
          </div>
          {/* Untraceable */}
          <div className="flex flex-col items-center gap-1.5 py-5 px-4">
            <Signal className="w-5 h-5 text-amber-400" />
            <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Untraceable</span>
            <span data-testid="text-ck-untraceable" className="text-2xl font-bold text-amber-400">
              {(stats.ckBreakdown?.untraceable ?? 0).toLocaleString()}
            </span>
            <span className="text-xs text-muted-foreground">No network signal</span>
          </div>
        </div>
        {/* Progress bar showing connected vs failed */}
        {(stats.ckBreakdown?.total ?? 0) > 0 && (
          <div className="px-6 pb-4">
            <div className="h-2 rounded-full overflow-hidden bg-muted/30 flex">
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
            <div className="flex justify-between mt-1.5 text-xs text-muted-foreground/60">
              <span>{(stats.ckBreakdown?.total ?? 0).toLocaleString()} total attempts today</span>
              <span>{(stats.ckBreakdown?.total ?? 0) - (stats.ckBreakdown?.connected ?? 0)} failed</span>
            </div>
          </div>
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
              <p className="font-mono text-sm font-semibold" data-testid="text-live-ip">{probe.ip}</p>
            </div>
            <div className="h-8 w-px bg-border/50 mx-2" />
            <div>
              <p className="text-xs text-muted-foreground">Status</p>
              <p className={`text-sm font-semibold ${probe.reachable ? 'text-emerald-400' : 'text-rose-400'}`}>
                {probe.reachable ? 'Reachable' : 'Unreachable'}
              </p>
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

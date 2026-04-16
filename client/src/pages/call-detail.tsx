import { useRoute, Link } from "wouter";
import { useCall, useCallMetrics } from "@/hooks/use-calls";
import { MosBadge } from "@/components/mos-badge";
import { ArrowLeft, Phone, Clock, Activity, Signal, AlertTriangle } from "lucide-react";
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Legend
} from "recharts";
import { BseTooltip, BSE_GRID_PROPS, BSE_AXIS_PROPS, BSE_CURSOR, bseActiveDot } from "@/components/bse-chart";
import { formatUTC } from "@/lib/date-utils";
import { cn } from "@/lib/utils";
import { lookupCountry } from "@/lib/country-lookup";

export default function CallDetailPage() {
  const [, params] = useRoute("/calls/:id");
  const callId = Number(params?.id);
  
  const { data: call, isLoading: callLoading } = useCall(callId);
  const { data: metrics, isLoading: metricsLoading } = useCallMetrics(callId);

  if (callLoading || metricsLoading) return <div className="p-8">Loading analysis...</div>;
  if (!call) return <div className="p-8">Call not found</div>;

  const callerCountry = lookupCountry(call.caller);
  const calleeCountry = lookupCountry(call.callee);

  // Transform metrics for the chart
  const chartData = metrics?.map(m => ({
    time: m.timestamp ? formatUTC(new Date(m.timestamp), 'mm:ss') : '',
    jitter: m.jitter,
    latency: m.latency,
    packetLoss: m.packetLoss * 10, // Scale up for visibility
    mos: m.mos
  })) || [];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center gap-4">
        <Link href="/calls" className="p-2 rounded-lg hover:bg-muted/50 transition-colors">
          <ArrowLeft className="w-5 h-5 text-muted-foreground" />
        </Link>
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Call Analysis</h2>
          <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
            <span className="font-mono text-foreground">{call.caller}</span>
            {callerCountry && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                {callerCountry.flag} {callerCountry.name}
              </span>
            )}
            <span>→</span>
            <span className="font-mono text-foreground">{call.callee}</span>
            {calleeCountry && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                {calleeCountry.flag} {calleeCountry.name}
              </span>
            )}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <div className="px-3 py-1 bg-secondary rounded-full text-xs font-medium flex items-center gap-2">
            <Clock className="w-3 h-3" />
            {call.startTime && formatUTC(new Date(call.startTime), 'HH:mm:ss')}
          </div>
          <MosBadge value={metrics?.[metrics.length - 1]?.mos || 0} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Jitter Chart */}
        <div className="lg:col-span-2 rounded-xl border border-border bg-card p-6 shadow-sm">
          <h3 className="font-semibold mb-6 flex items-center gap-2">
            <Activity className="w-4 h-4 text-blue-500" />
            Technical Metrics
          </h3>
          <div className="h-[350px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 6, right: 8, left: -8, bottom: 0 }}>
                <CartesianGrid {...BSE_GRID_PROPS} />
                <XAxis dataKey="time" {...BSE_AXIS_PROPS} />
                <YAxis yAxisId="left" {...BSE_AXIS_PROPS} />
                <YAxis yAxisId="right" orientation="right" {...BSE_AXIS_PROPS} />
                <Tooltip content={<BseTooltip />} cursor={BSE_CURSOR} />
                <Legend wrapperStyle={{ fontSize: 10, color: 'rgba(148,163,184,0.7)' }} />
                <Line yAxisId="left" type="monotone" dataKey="jitter" name="Jitter (ms)" stroke="#f59e0b" strokeWidth={2} dot={false} activeDot={bseActiveDot('#f59e0b')} strokeLinecap="round" />
                <Line yAxisId="left" type="monotone" dataKey="latency" name="Latency (ms)" stroke="#3b82f6" strokeWidth={2} dot={false} activeDot={bseActiveDot('#3b82f6')} strokeLinecap="round" />
                <Line yAxisId="right" type="monotone" dataKey="packetLoss" name="Packet Loss (x10 %)" stroke="#f43f5e" strokeWidth={2} dot={false} activeDot={bseActiveDot('#f43f5e')} strokeLinecap="round" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Current Stats Sidebar */}
        <div className="space-y-6">
          <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
            <h3 className="font-semibold mb-4 text-sm uppercase tracking-wider text-muted-foreground">Current Status</h3>
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-amber-500/10 text-amber-500">
                    <Activity className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Jitter</p>
                    <p className="text-xs text-muted-foreground">Variation in packet delay</p>
                  </div>
                </div>
                <span className="text-xl font-bold font-mono">{metrics?.[metrics.length - 1]?.jitter.toFixed(1)}ms</span>
              </div>
              
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-blue-500/10 text-blue-500">
                    <Clock className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Latency</p>
                    <p className="text-xs text-muted-foreground">Round trip time</p>
                  </div>
                </div>
                <span className="text-xl font-bold font-mono">{metrics?.[metrics.length - 1]?.latency.toFixed(0)}ms</span>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-rose-500/10 text-rose-500">
                    <Signal className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Packet Loss</p>
                    <p className="text-xs text-muted-foreground">Data integrity</p>
                  </div>
                </div>
                <span className="text-xl font-bold font-mono">{metrics?.[metrics.length - 1]?.packetLoss.toFixed(2)}%</span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
             <h3 className="font-semibold mb-4 text-sm uppercase tracking-wider text-muted-foreground">Signal Quality</h3>
             <div className="relative pt-4">
                <div className="h-4 w-full bg-secondary rounded-full overflow-hidden">
                   <div 
                      className={cn(
                        "h-full transition-all duration-500",
                        (metrics?.[metrics.length - 1]?.mos || 0) > 4 ? "bg-emerald-500" : "bg-amber-500"
                      )}
                      style={{ width: `${((metrics?.[metrics.length - 1]?.mos || 0) / 5) * 100}%` }}
                   />
                </div>
                <div className="flex justify-between mt-2 text-xs font-mono text-muted-foreground">
                   <span>1.0</span>
                   <span>5.0</span>
                </div>
                <p className="mt-4 text-sm text-center font-medium">
                   Current MOS: <span className="text-foreground font-bold text-lg">{(metrics?.[metrics.length - 1]?.mos || 0).toFixed(2)}</span>
                </p>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
}

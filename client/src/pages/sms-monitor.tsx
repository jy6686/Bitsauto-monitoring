import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MessageCircle, CheckCircle2, AlertTriangle, XCircle, RefreshCw, TrendingUp, TrendingDown, Clock, BarChart3, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface SmsRoute {
  id: number;
  name: string;
  carrier: string;
  status: 'active' | 'degraded' | 'down';
  deliveryRate: number;
  latencyMs: number;
  tps: number;
  maxTps: number;
  lastChecked: string;
}

interface SmsStats {
  sentToday: number;
  deliveredToday: number;
  failedToday: number;
  avgLatencyMs: number;
  deliveryRate: number;
}

const MOCK_ROUTES: SmsRoute[] = [
  { id: 1, name: "Tier-1 A2P Route",  carrier: "Twilio",      status: 'active',   deliveryRate: 98.2, latencyMs: 420,  tps: 12,  maxTps: 100, lastChecked: new Date().toISOString() },
  { id: 2, name: "Bulk SMS Route",    carrier: "Vonage",      status: 'active',   deliveryRate: 96.7, latencyMs: 680,  tps: 5,   maxTps: 50,  lastChecked: new Date().toISOString() },
  { id: 3, name: "Pakistan Direct",   carrier: "Telenor PK",  status: 'degraded', deliveryRate: 81.0, latencyMs: 1240, tps: 2,   maxTps: 20,  lastChecked: new Date().toISOString() },
  { id: 4, name: "Fallback Route",    carrier: "Bandwidth",   status: 'active',   deliveryRate: 94.1, latencyMs: 550,  tps: 0,   maxTps: 30,  lastChecked: new Date().toISOString() },
];

const MOCK_STATS: SmsStats = { sentToday: 4821, deliveredToday: 4694, failedToday: 127, avgLatencyMs: 598, deliveryRate: 97.4 };

function StatusDot({ status }: { status: string }) {
  const color = status === 'active' ? 'bg-emerald-400' : status === 'degraded' ? 'bg-amber-400' : 'bg-rose-400';
  return <span className={cn("inline-block h-2 w-2 rounded-full", color)} />;
}

function TpsBar({ current, max }: { current: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (current / max) * 100) : 0;
  const color = pct > 80 ? 'bg-rose-500' : pct > 60 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted/30 rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] text-muted-foreground font-mono w-16 text-right">{current}/{max} TPS</span>
    </div>
  );
}

export default function SmsMonitorPage() {
  const [timeRange, setTimeRange] = useState('today');
  const stats = MOCK_STATS;
  const routes = MOCK_ROUTES;

  const activeCount   = routes.filter(r => r.status === 'active').length;
  const degradedCount = routes.filter(r => r.status === 'degraded').length;
  const downCount     = routes.filter(r => r.status === 'down').length;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">

        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-sky-500/10 border border-sky-500/20">
              <MessageCircle className="h-5 w-5 text-sky-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold">SMS / A2P Monitor</h1>
              <p className="text-sm text-muted-foreground">SMPP gateway status, delivery rates and A2P messaging throughput</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Select value={timeRange} onValueChange={setTimeRange}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="7d">7 days</SelectItem>
                <SelectItem value="30d">30 days</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" data-testid="button-refresh-sms">
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: "Sent", value: stats.sentToday.toLocaleString(), color: "text-foreground" },
            { label: "Delivered", value: stats.deliveredToday.toLocaleString(), color: "text-emerald-400" },
            { label: "Failed", value: stats.failedToday.toLocaleString(), color: "text-rose-400" },
            { label: "Delivery Rate", value: `${stats.deliveryRate}%`, color: stats.deliveryRate >= 95 ? "text-emerald-400" : "text-amber-400" },
            { label: "Avg Latency", value: `${stats.avgLatencyMs}ms`, color: "text-cyan-400" },
          ].map(s => (
            <div key={s.label} className="bg-card border border-border rounded-xl p-4 text-center">
              <p className={cn("text-xl font-bold", s.color)}>{s.value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Route status bar */}
        <div className="flex items-center gap-4 text-sm">
          <span className="text-muted-foreground text-xs font-medium">Routes:</span>
          <span className="flex items-center gap-1.5 text-xs"><StatusDot status="active" /> {activeCount} active</span>
          {degradedCount > 0 && <span className="flex items-center gap-1.5 text-xs text-amber-400"><StatusDot status="degraded" /> {degradedCount} degraded</span>}
          {downCount > 0 && <span className="flex items-center gap-1.5 text-xs text-rose-400"><StatusDot status="down" /> {downCount} down</span>}
        </div>

        {/* Route cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {routes.map(route => (
            <div key={route.id} className={cn(
              "bg-card border rounded-xl p-5 space-y-4",
              route.status === 'active' ? "border-border" : route.status === 'degraded' ? "border-amber-500/30" : "border-rose-500/30"
            )}>
              <div className="flex items-start gap-2">
                <StatusDot status={route.status} />
                <div className="flex-1">
                  <p className="font-semibold text-sm">{route.name}</p>
                  <p className="text-xs text-muted-foreground">{route.carrier}</p>
                </div>
                <Badge variant="outline" className={cn("text-[10px]", route.status === 'active' ? 'text-emerald-400 border-emerald-500/30' : route.status === 'degraded' ? 'text-amber-400 border-amber-500/30' : 'text-rose-400 border-rose-500/30')}>
                  {route.status}
                </Badge>
              </div>

              <div className="grid grid-cols-3 gap-3 text-center">
                {[
                  { label: "Delivery", value: `${route.deliveryRate}%`, color: route.deliveryRate >= 95 ? 'text-emerald-400' : route.deliveryRate >= 85 ? 'text-amber-400' : 'text-rose-400' },
                  { label: "Latency", value: `${route.latencyMs}ms`, color: route.latencyMs < 500 ? 'text-emerald-400' : route.latencyMs < 1000 ? 'text-amber-400' : 'text-rose-400' },
                  { label: "Active TPS", value: String(route.tps), color: "text-foreground" },
                ].map(m => (
                  <div key={m.label} className="bg-muted/20 rounded-lg px-2 py-2">
                    <p className={cn("text-base font-bold", m.color)}>{m.value}</p>
                    <p className="text-[10px] text-muted-foreground">{m.label}</p>
                  </div>
                ))}
              </div>

              <div className="space-y-1">
                <p className="text-[10px] text-muted-foreground">Throughput capacity</p>
                <TpsBar current={route.tps} max={route.maxTps} />
              </div>

              <p className="text-[10px] text-muted-foreground/60">
                <Clock className="h-3 w-3 inline mr-1" />
                Checked {new Date(route.lastChecked).toLocaleTimeString()}
              </p>
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4 flex items-start gap-3">
          <Info className="h-4 w-4 text-blue-400 mt-0.5 shrink-0" />
          <p className="text-xs text-muted-foreground">
            SMS routing data shown here is simulated. Live integration requires connecting to your SMPP gateway or SMS provider API 
            (Twilio, Vonage, Bandwidth, or your own SMPP proxy). Configure SMS gateway credentials in Settings to enable live monitoring.
          </p>
        </div>
      </div>
    </div>
  );
}

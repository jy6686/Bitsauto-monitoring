
import { useQuery } from "@tanstack/react-query";
import { ShieldAlert, AlertTriangle, Clock, Phone, Server, RefreshCw, TrendingUp, Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { queryClient } from "@/lib/queryClient";

type FasEvent = {
  id: number;
  callId: string;
  caller: string | null;
  callee: string | null;
  vendor: string | null;
  pddSecs: number | null;
  billSecs: number | null;
  sipCode: number | null;
  reason: string | null;
  detectedAt: string;
  alertSent: boolean;
};

function reasonBadge(reason: string | null) {
  if (!reason) return null;
  if (reason.includes('high_pdd')) return <Badge variant="outline" className="border-orange-500/40 text-orange-400 text-xs">High PDD</Badge>;
  if (reason.includes('short_billed')) return <Badge variant="outline" className="border-red-500/40 text-red-400 text-xs">Short Billed</Badge>;
  return <Badge variant="outline" className="border-yellow-500/40 text-yellow-400 text-xs">Suspicious</Badge>;
}

export default function FraudPage() {
  const { data, isLoading, refetch, isFetching } = useQuery<{ events: FasEvent[] }>({
    queryKey: ['/api/fas-events'],
    refetchInterval: 30000,
  });

  const events = data?.events ?? [];

  // Stats
  const totalFas = events.length;
  const alertsSent = events.filter(e => e.alertSent).length;
  const highPdd = events.filter(e => e.reason?.includes('high_pdd')).length;
  const shortBill = events.filter(e => e.reason?.includes('short_billed')).length;

  // Vendor breakdown
  const vendorMap: Record<string, number> = {};
  for (const e of events) {
    if (e.vendor) vendorMap[e.vendor] = (vendorMap[e.vendor] ?? 0) + 1;
  }
  const topVendors = Object.entries(vendorMap).sort((a, b) => b[1] - a[1]).slice(0, 5);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShieldAlert className="h-6 w-6 text-red-400" />
            Fraud &amp; FAS Detection
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            False Answer Supervision events detected from CDR analysis
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          data-testid="button-refresh-fraud"
          className="gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total FAS Events", value: totalFas, icon: ShieldAlert, color: "text-red-400" },
          { label: "Alerts Sent", value: alertsSent, icon: AlertTriangle, color: "text-orange-400" },
          { label: "High PDD", value: highPdd, icon: Clock, color: "text-yellow-400" },
          { label: "Short Billed", value: shortBill, icon: TrendingUp, color: "text-violet-400" },
        ].map(stat => (
          <div key={stat.label} className="bg-card rounded-xl border border-border p-4">
            <div className="flex items-center gap-2 mb-1">
              <stat.icon className={`h-4 w-4 ${stat.color}`} />
              <span className="text-xs text-muted-foreground">{stat.label}</span>
            </div>
            <p className={`text-2xl font-bold ${stat.color}`} data-testid={`stat-${stat.label.toLowerCase().replace(/\s+/g,'-')}`}>{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* FAS Events Table */}
        <div className="lg:col-span-2 bg-card rounded-xl border border-border overflow-hidden">
          <div className="p-4 border-b border-border flex items-center gap-2">
            <Eye className="h-4 w-4 text-muted-foreground" />
            <h2 className="font-semibold text-sm">FAS Event Log</h2>
            <span className="ml-auto text-xs text-muted-foreground">{events.length} records</span>
          </div>
          {isLoading ? (
            <div className="flex items-center justify-center h-48">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : events.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-2 text-muted-foreground">
              <ShieldAlert className="h-10 w-10 opacity-20" />
              <p className="text-sm">No FAS events detected yet</p>
              <p className="text-xs opacity-60">Events appear when CDRs are analyzed via the Reports page</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="px-4 py-3 text-left">Time</th>
                    <th className="px-4 py-3 text-left">Caller → Callee</th>
                    <th className="px-4 py-3 text-left">Vendor</th>
                    <th className="px-4 py-3 text-right">PDD</th>
                    <th className="px-4 py-3 text-right">Billed</th>
                    <th className="px-4 py-3 text-left">Reason</th>
                    <th className="px-4 py-3 text-center">Alert</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map(event => (
                    <tr key={event.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors" data-testid={`row-fas-${event.id}`}>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(event.detectedAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-mono text-xs">
                          <span className="text-muted-foreground">{event.caller ?? '—'}</span>
                          <span className="mx-1 text-muted-foreground/40">→</span>
                          <span>{event.callee ?? '—'}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs">{event.vendor ?? '—'}</td>
                      <td className="px-4 py-3 text-right">
                        {event.pddSecs != null ? (
                          <span className={`font-mono text-xs ${event.pddSecs > 10 ? 'text-orange-400' : ''}`}>
                            {event.pddSecs.toFixed(1)}s
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {event.billSecs != null ? (
                          <span className={`font-mono text-xs ${event.billSecs < 5 ? 'text-red-400' : ''}`}>
                            {event.billSecs}s
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3">{reasonBadge(event.reason)}</td>
                      <td className="px-4 py-3 text-center">
                        {event.alertSent
                          ? <span className="text-green-400 text-xs">✓ Sent</span>
                          : <span className="text-muted-foreground text-xs">Pending</span>
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Vendor Pattern Panel */}
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="p-4 border-b border-border flex items-center gap-2">
            <Server className="h-4 w-4 text-muted-foreground" />
            <h2 className="font-semibold text-sm">Vendor Patterns</h2>
          </div>
          {topVendors.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-muted-foreground text-xs">No data yet</div>
          ) : (
            <div className="p-4 space-y-3">
              {topVendors.map(([vendor, count]) => {
                const pct = totalFas > 0 ? Math.round((count / totalFas) * 100) : 0;
                return (
                  <div key={vendor} data-testid={`vendor-pattern-${vendor}`}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="truncate text-xs font-mono">{vendor}</span>
                      <span className="text-red-400 font-bold text-xs ml-2">{count}</span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-red-500/60 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
              <p className="text-xs text-muted-foreground pt-2">
                High occurrence vendors may require routing review or traffic suspension.
              </p>
            </div>
          )}

          {/* Detection Rules Info */}
          <div className="p-4 border-t border-border space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Detection Rules</p>
            <div className="space-y-1.5 text-xs text-muted-foreground">
              <div className="flex items-start gap-2">
                <Clock className="h-3 w-3 mt-0.5 text-orange-400 flex-shrink-0" />
                <span>PDD &gt; threshold with SIP 200 (answered but delayed)</span>
              </div>
              <div className="flex items-start gap-2">
                <Phone className="h-3 w-3 mt-0.5 text-red-400 flex-shrink-0" />
                <span>Billed duration &lt; threshold despite answered status</span>
              </div>
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-3 w-3 mt-0.5 text-yellow-400 flex-shrink-0" />
                <span>Vendor consistently shows answered, no real voice path</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground/60 pt-1">
              Thresholds configurable in Settings → Alert Configuration
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

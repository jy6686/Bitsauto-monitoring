import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldAlert, RefreshCw, Download, CheckCircle2, Clock, AlertTriangle, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface SlaBreachEntry {
  id: number;
  vendorId: string;
  vendorName: string;
  metric: string;
  threshold: number;
  actualValue: number;
  breachStart: string;
  breachEnd: string | null;
  durationMinutes: number | null;
  resolved: boolean;
  createdAt: string;
}

function MetricBadge({ metric }: { metric: string }) {
  const cfg: Record<string, { label: string; cls: string }> = {
    asr: { label: "ASR", cls: "bg-blue-500/15 text-blue-400 border-blue-500/25" },
    acd: { label: "ACD", cls: "bg-purple-500/15 text-purple-400 border-purple-500/25" },
    pdd: { label: "PDD", cls: "bg-amber-500/15 text-amber-400 border-amber-500/25" },
    ner: { label: "NER", cls: "bg-cyan-500/15 text-cyan-400 border-cyan-500/25" },
  };
  const c = cfg[metric] ?? { label: metric.toUpperCase(), cls: "bg-muted/20 text-muted-foreground" };
  return <span className={cn("inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold border", c.cls)}>{c.label}</span>;
}

function formatDuration(minutes: number | null): string {
  if (minutes == null) return "—";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}h ${m}m`;
}

function fmtValue(metric: string, val: number): string {
  if (metric === "asr" || metric === "ner") return `${val.toFixed(1)}%`;
  if (metric === "acd") return `${val.toFixed(0)}s`;
  if (metric === "pdd") return `${val.toFixed(1)}s`;
  return String(val);
}

function fmtThreshold(metric: string, threshold: number): string {
  if (metric === "asr" || metric === "ner") return `<${threshold}%`;
  if (metric === "acd") return `<${threshold}s`;
  if (metric === "pdd") return `>${threshold}s`;
  return String(threshold);
}

function exportPdf(breaches: SlaBreachEntry[]) {
  const rows = breaches.map(b =>
    `${new Date(b.breachStart).toLocaleString()} | ${b.vendorName} | ${b.metric.toUpperCase()} | Actual: ${fmtValue(b.metric, b.actualValue)} vs SLA ${fmtThreshold(b.metric, b.threshold)} | ${b.resolved ? 'Resolved' : 'Ongoing'} | ${formatDuration(b.durationMinutes)}`
  ).join('\n');

  const content = `VoIP Watcher — SLA Breach Log\nExported: ${new Date().toUTCString()}\n${'─'.repeat(80)}\n\n${rows || 'No breaches found.'}`;
  const blob = new Blob([content], { type: 'text/plain' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `sla-breaches-${Date.now()}.txt`;
  a.click(); URL.revokeObjectURL(url);
}

export default function SlaBreachesPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"all" | "open" | "resolved">("all");
  const [metricFilter, setMetricFilter] = useState<string>("all");

  const { data: breaches = [], isLoading } = useQuery<SlaBreachEntry[]>({
    queryKey: ["/api/sla-breaches"],
    refetchInterval: 2 * 60 * 1000,
  });

  const filtered = breaches.filter(b => {
    if (filter === "open"     && b.resolved)  return false;
    if (filter === "resolved" && !b.resolved) return false;
    if (metricFilter !== "all" && b.metric !== metricFilter) return false;
    return true;
  });

  const openCount     = breaches.filter(b => !b.resolved).length;
  const resolvedCount = breaches.filter(b => b.resolved).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <ShieldAlert className="w-6 h-6 text-rose-400" />
            <h2 className="text-2xl font-bold tracking-tight">SLA Breach Log</h2>
          </div>
          <p className="text-muted-foreground text-sm mt-1">
            Automatic threshold violation events · monitored every 5 minutes
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <Select value={filter} onValueChange={v => setFilter(v as any)}>
            <SelectTrigger className="w-32 h-8 text-xs" data-testid="select-sla-filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="open">Open only</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
            </SelectContent>
          </Select>
          <Select value={metricFilter} onValueChange={setMetricFilter}>
            <SelectTrigger className="w-28 h-8 text-xs" data-testid="select-sla-metric"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All metrics</SelectItem>
              <SelectItem value="asr">ASR</SelectItem>
              <SelectItem value="acd">ACD</SelectItem>
              <SelectItem value="pdd">PDD</SelectItem>
              <SelectItem value="ner">NER</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => exportPdf(filtered)} data-testid="button-export-sla">
            <Download className="w-4 h-4 mr-2" /> Export
          </Button>
          <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ["/api/sla-breaches"] })} disabled={isLoading} data-testid="button-refresh-sla">
            <RefreshCw className={cn("w-4 h-4 mr-2", isLoading && "animate-spin")} /> Refresh
          </Button>
        </div>
      </div>

      {/* Summary chips */}
      <div className="flex items-center gap-3">
        {openCount > 0 && (
          <span className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-rose-500/10 border border-rose-500/25 text-rose-400 text-xs font-semibold">
            <AlertTriangle className="w-3.5 h-3.5" /> {openCount} open breach{openCount > 1 ? 'es' : ''}
          </span>
        )}
        {resolvedCount > 0 && (
          <span className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-xs font-semibold">
            <CheckCircle2 className="w-3.5 h-3.5" /> {resolvedCount} resolved
          </span>
        )}
        {breaches.length === 0 && !isLoading && (
          <span className="text-xs text-muted-foreground">No breaches recorded yet. The watcher checks every 5 minutes.</span>
        )}
      </div>

      <div className="text-xs text-muted-foreground flex items-start gap-1.5 p-3 rounded-lg bg-blue-500/5 border border-blue-500/15">
        <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-blue-400" />
        <span>Thresholds: ASR &lt;40%, ACD &lt;30s, PDD &gt;10s. Breaches auto-resolve when metrics recover.</span>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center h-32 text-muted-foreground">
          <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading…
        </div>
      )}

      {!isLoading && filtered.length > 0 && (
        <div className="rounded-xl border border-border/50 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-border/50 bg-muted/10">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">Vendor</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">Metric</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">Actual</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">SLA</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">Breach Start</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">Duration</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((b, i) => (
                <tr key={b.id} className={cn("border-b border-border/30 hover:bg-muted/10", i % 2 === 0 ? "" : "bg-muted/5")} data-testid={`row-sla-${b.id}`}>
                  <td className="px-4 py-3 font-medium text-foreground">{b.vendorName}</td>
                  <td className="px-4 py-3"><MetricBadge metric={b.metric} /></td>
                  <td className="px-4 py-3 font-mono font-semibold text-rose-400">{fmtValue(b.metric, b.actualValue)}</td>
                  <td className="px-4 py-3 font-mono text-muted-foreground">{fmtThreshold(b.metric, b.threshold)}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{new Date(b.breachStart).toLocaleString()}</td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {b.resolved ? formatDuration(b.durationMinutes) : (
                      <span className="flex items-center gap-1 text-rose-400"><Clock className="w-3 h-3" /> ongoing</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {b.resolved
                      ? <span className="flex items-center gap-1 text-emerald-400 text-xs font-semibold"><CheckCircle2 className="w-3.5 h-3.5" /> Resolved</span>
                      : <span className="flex items-center gap-1 text-rose-400 text-xs font-semibold"><AlertTriangle className="w-3.5 h-3.5" /> Open</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!isLoading && filtered.length === 0 && breaches.length > 0 && (
        <p className="text-center text-muted-foreground py-8">No breaches match the current filter.</p>
      )}
    </div>
  );
}

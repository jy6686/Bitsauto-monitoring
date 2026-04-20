import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, RefreshCw, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";

interface HeatmapRow { dest: string; hour: number; calls: number; value: number; }
interface HeatmapResponse { rows: HeatmapRow[]; topDests: string[]; metric: string; hours: number; }

const HOURS_LABELS = ["00", "01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11",
  "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23"];

function asrColor(val: number): string {
  if (val >= 70) return "bg-emerald-500/80";
  if (val >= 50) return "bg-yellow-500/80";
  if (val >= 30) return "bg-orange-500/80";
  if (val > 0)   return "bg-rose-500/80";
  return "bg-muted/20";
}

function acdColor(val: number): string {
  if (val >= 90) return "bg-emerald-500/80";
  if (val >= 45) return "bg-yellow-500/80";
  if (val >= 15) return "bg-orange-500/80";
  if (val > 0)   return "bg-rose-500/80";
  return "bg-muted/20";
}

function Legend({ metric }: { metric: string }) {
  const items = metric === "asr"
    ? [{ color: "bg-emerald-500/80", label: "≥70%" }, { color: "bg-yellow-500/80", label: "50–69%" }, { color: "bg-orange-500/80", label: "30–49%" }, { color: "bg-rose-500/80", label: "<30%" }, { color: "bg-muted/20", label: "No calls" }]
    : [{ color: "bg-emerald-500/80", label: "≥90s" }, { color: "bg-yellow-500/80", label: "45–89s" }, { color: "bg-orange-500/80", label: "15–44s" }, { color: "bg-rose-500/80", label: "<15s" }, { color: "bg-muted/20", label: "No calls" }];
  return (
    <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
      <span className="font-medium">Legend:</span>
      {items.map(i => (
        <span key={i.label} className="flex items-center gap-1">
          <span className={cn("w-3 h-3 rounded-sm inline-block", i.color)} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

export default function QosHeatmapPage() {
  const qc = useQueryClient();
  const [metric, setMetric] = useState("asr");
  const [hours, setHours]   = useState("168");
  const [prefixLen, setPrefixLen] = useState("3");

  const { data, isLoading } = useQuery<HeatmapResponse>({
    queryKey: ["/api/stats/heatmap", metric, hours, prefixLen],
    queryFn: () => fetch(`/api/stats/heatmap?metric=${metric}&hours=${hours}&prefixLen=${prefixLen}`).then(r => r.json()),
    refetchInterval: 5 * 60 * 1000,
  });

  const topDests = data?.topDests ?? [];
  const rowMap = new Map<string, Map<number, HeatmapRow>>();
  for (const r of (data?.rows ?? [])) {
    if (!rowMap.has(r.dest)) rowMap.set(r.dest, new Map());
    rowMap.get(r.dest)!.set(r.hour, r);
  }

  const colorFn = metric === "asr" ? asrColor : acdColor;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <Activity className="w-6 h-6 text-purple-400" />
            <h2 className="text-2xl font-bold tracking-tight">Route QoS Heatmap</h2>
          </div>
          <p className="text-muted-foreground text-sm mt-1">Destination prefix × hour-of-day quality matrix</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Label className="text-xs whitespace-nowrap">Metric</Label>
            <Select value={metric} onValueChange={setMetric}>
              <SelectTrigger className="w-24 h-8 text-xs" data-testid="select-heatmap-metric"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="asr">ASR %</SelectItem>
                <SelectItem value="acd">ACD (s)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-xs whitespace-nowrap">Window</Label>
            <Select value={hours} onValueChange={setHours}>
              <SelectTrigger className="w-24 h-8 text-xs" data-testid="select-heatmap-hours"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="24">24h</SelectItem>
                <SelectItem value="72">3 days</SelectItem>
                <SelectItem value="168">7 days</SelectItem>
                <SelectItem value="720">30 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-xs whitespace-nowrap">Prefix length</Label>
            <Select value={prefixLen} onValueChange={setPrefixLen}>
              <SelectTrigger className="w-20 h-8 text-xs" data-testid="select-heatmap-prefix"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="2">2 digits</SelectItem>
                <SelectItem value="3">3 digits</SelectItem>
                <SelectItem value="4">4 digits</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ["/api/stats/heatmap"] })} disabled={isLoading} data-testid="button-refresh-heatmap">
            <RefreshCw className={cn("w-4 h-4 mr-2", isLoading && "animate-spin")} />Refresh
          </Button>
        </div>
      </div>

      <Legend metric={metric} />

      {isLoading && (
        <div className="flex items-center justify-center h-48 text-muted-foreground">
          <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading heatmap…
        </div>
      )}

      {!isLoading && topDests.length === 0 && (
        <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-2">
          <Info className="w-8 h-8 opacity-40" />
          <p>No CDR data available for the selected window.</p>
          <p className="text-xs opacity-60">CDR cache must be populated from Sippy.</p>
        </div>
      )}

      {!isLoading && topDests.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border/50">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-border/50">
                <th className="sticky left-0 z-10 bg-card px-3 py-2 text-left font-semibold text-muted-foreground whitespace-nowrap">Destination</th>
                {HOURS_LABELS.map(h => (
                  <th key={h} className="px-1 py-2 text-center font-mono text-[10px] text-muted-foreground w-8">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {topDests.map(dest => (
                <tr key={dest} className="border-b border-border/30 hover:bg-muted/10">
                  <td className="sticky left-0 z-10 bg-card px-3 py-1.5 font-mono font-semibold text-foreground whitespace-nowrap" data-testid={`text-dest-${dest}`}>+{dest}</td>
                  {Array.from({ length: 24 }, (_, h) => {
                    const cell = rowMap.get(dest)?.get(h);
                    const val = cell?.value ?? 0;
                    const calls = cell?.calls ?? 0;
                    return (
                      <td key={h} className="px-0.5 py-1" title={calls > 0 ? `${val}${metric === 'asr' ? '%' : 's'} · ${calls} calls` : 'No calls'}>
                        <div className={cn("w-7 h-6 rounded-sm flex items-center justify-center text-[9px] font-bold text-white/90 transition-all", colorFn(val))}>
                          {calls > 0 ? (metric === 'asr' ? Math.round(val) : Math.round(val)) : ''}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Top 30 destinations by call volume · Hover cells for detail · Hour labels are UTC
      </p>
    </div>
  );
}

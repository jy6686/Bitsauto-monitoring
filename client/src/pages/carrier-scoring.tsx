import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Activity, RefreshCw, TrendingUp, TrendingDown, Minus,
  ChevronDown, ChevronUp, AlertTriangle, CheckCircle2, XCircle,
  Clock, BarChart3, Wifi, Filter
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type CarrierScore = {
  id: number;
  carrierId: string;
  carrierName: string;
  windowHours: number;
  sampleCount: number;
  connectedCount: number;
  failedCount: number;
  rollingAsr: number | null;
  avgPddMs: number | null;
  p95PddMs: number | null;
  failureRate: number | null;
  stabilityScore: number | null;
  trend: "improving" | "stable" | "degrading" | null;
  lastComputedAt: string;
};

type RouteTrace = {
  id: number;
  campaignId: number | null;
  runId: number | null;
  cld: string;
  cli: string | null;
  selectedCarrier: string | null;
  selectedCarrierId: number | null;
  candidateRoutes: string | null;
  decisionReason: string | null;
  outcome: string | null;
  sipCode: number | null;
  pddMs: number | null;
  durationSec: number | null;
  failureCategory: string | null;
  createdAt: string;
};

function stabilityColor(score: number | null) {
  if (score == null) return "text-muted-foreground";
  if (score >= 80) return "text-green-500";
  if (score >= 60) return "text-yellow-500";
  if (score >= 40) return "text-orange-500";
  return "text-red-500";
}

function stabilityBg(score: number | null) {
  if (score == null) return "bg-muted";
  if (score >= 80) return "bg-green-500/10 border-green-500/20";
  if (score >= 60) return "bg-yellow-500/10 border-yellow-500/20";
  if (score >= 40) return "bg-orange-500/10 border-orange-500/20";
  return "bg-red-500/10 border-red-500/20";
}

function TrendIcon({ trend }: { trend: string | null }) {
  if (trend === "improving") return <TrendingUp className="h-4 w-4 text-green-500" />;
  if (trend === "degrading") return <TrendingDown className="h-4 w-4 text-red-500" />;
  return <Minus className="h-4 w-4 text-muted-foreground" />;
}

function StabilityBar({ score }: { score: number | null }) {
  const s = score ?? 0;
  const color = s >= 80 ? "bg-green-500" : s >= 60 ? "bg-yellow-500" : s >= 40 ? "bg-orange-500" : "bg-red-500";
  return (
    <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${s}%` }} />
    </div>
  );
}

function OutcomeBadge({ outcome, sipCode }: { outcome: string | null; sipCode: number | null }) {
  if (outcome === "connected") return <Badge className="bg-green-500/15 text-green-500 border-green-500/20 text-xs">Connected</Badge>;
  if (sipCode) return <Badge className="bg-red-500/15 text-red-500 border-red-500/20 text-xs">SIP {sipCode}</Badge>;
  return <Badge className="bg-muted text-muted-foreground text-xs">Failed</Badge>;
}

export default function CarrierScoringPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [window24, setWindow24] = useState<24 | 168>(24);
  const [expandedCarrier, setExpandedCarrier] = useState<string | null>(null);
  const [traceFilter, setTraceFilter] = useState<string>("");

  const { data: scores = [], isLoading: scoresLoading } = useQuery<CarrierScore[]>({
    queryKey: ["/api/carrier-scores", window24],
    queryFn: () => fetch(`/api/carrier-scores?window=${window24}`).then(r => r.json()),
    refetchInterval: 120_000,
  });

  const { data: traces = [], isLoading: tracesLoading } = useQuery<RouteTrace[]>({
    queryKey: ["/api/route-traces"],
    queryFn: () => fetch("/api/route-traces?limit=100").then(r => r.json()),
    refetchInterval: 60_000,
  });

  const recompute = useMutation({
    mutationFn: () => apiRequest("POST", "/api/carrier-scores/recompute"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/carrier-scores"] });
      toast({ title: "Carrier scores recomputed" });
    },
    onError: () => toast({ title: "Recompute failed", variant: "destructive" }),
  });

  const filteredTraces = traceFilter
    ? traces.filter(t =>
        t.selectedCarrier?.toLowerCase().includes(traceFilter.toLowerCase()) ||
        t.cld.includes(traceFilter) ||
        t.failureCategory?.toLowerCase().includes(traceFilter.toLowerCase())
      )
    : traces;

  const totalCalls    = traces.length;
  const connectedAll  = traces.filter(t => t.outcome === "connected").length;
  const overallAsr    = totalCalls > 0 ? ((connectedAll / totalCalls) * 100).toFixed(1) : "—";
  const highPddCount  = traces.filter(t => t.pddMs != null && t.pddMs > 5000).length;
  const failedCount   = traces.filter(t => t.outcome === "failed").length;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-indigo-400" />
            Carrier Quality Scoring
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Automated quality metrics derived from synthetic test calls — ASR, PDD, stability index
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-border overflow-hidden text-sm">
            {([24, 168] as const).map(w => (
              <button
                key={w}
                data-testid={`window-${w}`}
                onClick={() => setWindow24(w)}
                className={`px-3 py-1.5 transition-colors ${
                  window24 === w ? "bg-indigo-500/20 text-indigo-400" : "text-muted-foreground hover:bg-muted/50"
                }`}
              >
                {w === 24 ? "24h" : "7d"}
              </button>
            ))}
          </div>
          <Button
            data-testid="btn-recompute"
            variant="outline"
            size="sm"
            onClick={() => recompute.mutate()}
            disabled={recompute.isPending}
            className="gap-1.5"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${recompute.isPending ? "animate-spin" : ""}`} />
            Recompute
          </Button>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Overall ASR", value: `${overallAsr}%`, icon: Activity,       color: "text-green-400" },
          { label: "High PDD (>5s)", value: String(highPddCount), icon: Clock,   color: "text-yellow-400" },
          { label: "Failed Calls",   value: String(failedCount),  icon: XCircle,  color: "text-red-400"    },
          { label: "Carriers Scored", value: String(scores.length), icon: Wifi,  color: "text-indigo-400" },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label} className="border-border/50">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className={`text-2xl font-bold mt-0.5 ${color}`}>{value}</p>
                </div>
                <Icon className={`h-7 w-7 opacity-20 ${color}`} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Carrier Score Cards */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-indigo-400" />
            Carrier Rankings
            <span className="text-xs font-normal text-muted-foreground ml-1">
              — computed from synthetic test calls, window: {window24 === 24 ? "last 24h" : "last 7 days"}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {scoresLoading ? (
            <div className="text-sm text-muted-foreground py-8 text-center">Loading carrier scores…</div>
          ) : scores.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center">
              No carrier scores yet. Scores are computed 15 s after startup and every 30 min thereafter. Run a synthetic test campaign to populate data.
            </div>
          ) : (
            <div className="space-y-3">
              {scores.map((s, i) => {
                const isExpanded = expandedCarrier === s.carrierId;
                const carrierTraces = traces.filter(t => t.selectedCarrier === s.carrierName).slice(0, 10);
                return (
                  <div
                    key={s.carrierId}
                    data-testid={`carrier-row-${s.id}`}
                    className={`rounded-lg border p-4 transition-all ${stabilityBg(s.stabilityScore)}`}
                  >
                    <div className="flex items-center gap-4 cursor-pointer" onClick={() => setExpandedCarrier(isExpanded ? null : s.carrierId)}>
                      {/* Rank */}
                      <div className="w-7 h-7 rounded-full bg-background/60 border border-border flex items-center justify-center text-xs font-semibold text-muted-foreground shrink-0">
                        {i + 1}
                      </div>

                      {/* Name + trend */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm truncate">{s.carrierName}</span>
                          <TrendIcon trend={s.trend} />
                        </div>
                        <div className="text-xs text-muted-foreground">{s.sampleCount} calls sampled</div>
                      </div>

                      {/* Stability score */}
                      <div className="text-center shrink-0">
                        <div className={`text-lg font-bold ${stabilityColor(s.stabilityScore)}`}>
                          {s.stabilityScore?.toFixed(0) ?? "—"}
                        </div>
                        <div className="text-xs text-muted-foreground">stability</div>
                      </div>

                      {/* ASR */}
                      <div className="text-center shrink-0">
                        <div className="text-lg font-bold">{s.rollingAsr?.toFixed(1) ?? "—"}%</div>
                        <div className="text-xs text-muted-foreground">ASR</div>
                      </div>

                      {/* Avg PDD */}
                      <div className="text-center shrink-0">
                        <div className="text-base font-semibold">{s.avgPddMs != null ? `${s.avgPddMs.toFixed(0)}ms` : "—"}</div>
                        <div className="text-xs text-muted-foreground">avg PDD</div>
                      </div>

                      {/* Failure rate */}
                      <div className="text-center shrink-0">
                        <div className="text-base font-semibold">{s.failureRate != null ? `${s.failureRate.toFixed(1)}%` : "—"}</div>
                        <div className="text-xs text-muted-foreground">fail rate</div>
                      </div>

                      {/* Bar */}
                      <StabilityBar score={s.stabilityScore} />

                      {/* Expand toggle */}
                      {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
                    </div>

                    {/* Expanded: recent traces for this carrier */}
                    {isExpanded && (
                      <div className="mt-4 border-t border-border/30 pt-4">
                        <div className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wide">Recent route decision traces</div>
                        {carrierTraces.length === 0 ? (
                          <div className="text-xs text-muted-foreground">No traces for this carrier yet</div>
                        ) : (
                          <div className="space-y-2">
                            {carrierTraces.map(t => (
                              <div key={t.id} className="flex items-start gap-3 text-xs rounded-md bg-background/40 px-3 py-2">
                                <OutcomeBadge outcome={t.outcome} sipCode={t.sipCode} />
                                <div className="flex-1 min-w-0">
                                  <span className="font-mono text-muted-foreground">{t.cld}</span>
                                  {t.decisionReason && (
                                    <span className="text-muted-foreground ml-2">— {t.decisionReason}</span>
                                  )}
                                </div>
                                {t.pddMs != null && t.pddMs > 0 && (
                                  <span className={`shrink-0 ${t.pddMs > 5000 ? "text-yellow-400" : "text-muted-foreground"}`}>
                                    {t.pddMs.toFixed(0)}ms PDD
                                  </span>
                                )}
                                <span className="text-muted-foreground/60 shrink-0">
                                  {new Date(t.createdAt).toLocaleTimeString()}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Metric sub-grid */}
                        <div className="grid grid-cols-3 gap-3 mt-4">
                          <div className="rounded-md bg-background/40 p-3 text-center">
                            <div className="text-lg font-bold">{s.connectedCount}</div>
                            <div className="text-xs text-muted-foreground">Connected</div>
                          </div>
                          <div className="rounded-md bg-background/40 p-3 text-center">
                            <div className="text-lg font-bold">{s.failedCount}</div>
                            <div className="text-xs text-muted-foreground">Failed</div>
                          </div>
                          <div className="rounded-md bg-background/40 p-3 text-center">
                            <div className="text-base font-bold">{s.p95PddMs != null ? `${s.p95PddMs.toFixed(0)}ms` : "—"}</div>
                            <div className="text-xs text-muted-foreground">P95 PDD</div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Route Decision Trace Table */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-4">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4 text-violet-400" />
              Route Decision Traces
              <span className="text-xs font-normal text-muted-foreground ml-1">— last 100 synthetic calls</span>
            </CardTitle>
            <div className="flex items-center gap-2">
              <Filter className="h-3.5 w-3.5 text-muted-foreground" />
              <input
                data-testid="input-trace-filter"
                type="text"
                placeholder="Filter by carrier, CLD, failure…"
                value={traceFilter}
                onChange={e => setTraceFilter(e.target.value)}
                className="h-8 rounded-md border border-border bg-transparent px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring w-56"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {tracesLoading ? (
            <div className="text-sm text-muted-foreground py-6 text-center">Loading traces…</div>
          ) : filteredTraces.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">
              No route traces yet. Traces are recorded automatically when scheduled test campaigns execute.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/40 text-xs text-muted-foreground uppercase tracking-wide">
                    <th className="pb-2 text-left font-medium pr-4">Outcome</th>
                    <th className="pb-2 text-left font-medium pr-4">CLD</th>
                    <th className="pb-2 text-left font-medium pr-4">Selected Carrier</th>
                    <th className="pb-2 text-left font-medium pr-4">Decision Reason</th>
                    <th className="pb-2 text-right font-medium pr-4">PDD</th>
                    <th className="pb-2 text-right font-medium pr-4">Failure Category</th>
                    <th className="pb-2 text-right font-medium">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/20">
                  {filteredTraces.map(t => (
                    <tr key={t.id} data-testid={`trace-row-${t.id}`} className="hover:bg-muted/20 transition-colors">
                      <td className="py-2 pr-4">
                        <OutcomeBadge outcome={t.outcome} sipCode={t.sipCode} />
                      </td>
                      <td className="py-2 pr-4 font-mono text-xs">{t.cld}</td>
                      <td className="py-2 pr-4 text-xs">{t.selectedCarrier ?? <span className="text-muted-foreground/50">unknown</span>}</td>
                      <td className="py-2 pr-4 text-xs text-muted-foreground max-w-xs truncate">{t.decisionReason ?? "—"}</td>
                      <td className="py-2 pr-4 text-right text-xs">
                        {t.pddMs != null && t.pddMs > 0
                          ? <span className={t.pddMs > 5000 ? "text-yellow-400 font-medium" : ""}>{t.pddMs.toFixed(0)}ms</span>
                          : <span className="text-muted-foreground/40">—</span>}
                      </td>
                      <td className="py-2 pr-4 text-right text-xs">
                        {t.failureCategory
                          ? <Badge variant="outline" className="text-xs">{t.failureCategory}</Badge>
                          : <span className="text-muted-foreground/40">—</span>}
                      </td>
                      <td className="py-2 text-right text-xs text-muted-foreground">
                        {new Date(t.createdAt).toLocaleTimeString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

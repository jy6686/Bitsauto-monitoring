import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  RefreshCw,
  Shield,
  Zap,
  BarChart3,
  DollarSign,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  CheckCircle2,
  Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface VendorHealthScore {
  vendorName: string;
  overallScore: number;
  qualityScore: number;
  reliabilityScore: number;
  fraudScore: number;
  marginScore: number;
  trend: "improving" | "stable" | "declining";
  trendDelta: number;
  scoredAt: string;
  details: {
    asr?: number | null;
    acd?: number | null;
    pddMs?: number | null;
    optionsUptimePct?: number | null;
    sipErrorRate503?: number | null;
    sipErrorRate408?: number | null;
    fasCount24h?: number | null;
    blacklistHits?: number | null;
    marginPct?: number | null;
  };
}

interface VendorHistoryPoint {
  scoredAt: string;
  overallScore: number;
  qualityScore: number;
  reliabilityScore: number;
  fraudScore: number;
  marginScore: number;
}

interface RouteHealthScore {
  routingGroupId: string;
  routingGroupName: string;
  overallScore: number;
  vendorCount: number;
  lowestVendorScore: number | null;
  scoredAt: string;
  details: Array<{ vendorName: string; score: number; weight: number }>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 75) return "text-emerald-400";
  if (score >= 50) return "text-yellow-400";
  return "text-red-400";
}

function scoreBg(score: number): string {
  if (score >= 75) return "bg-emerald-500/15 border-emerald-500/30";
  if (score >= 50) return "bg-yellow-500/15 border-yellow-500/30";
  return "bg-red-500/15 border-red-500/30";
}

function progressColor(score: number): string {
  if (score >= 75) return "bg-emerald-500";
  if (score >= 50) return "bg-yellow-500";
  return "bg-red-500";
}

function scoreLabel(score: number): string {
  if (score >= 90) return "Excellent";
  if (score >= 75) return "Good";
  if (score >= 50) return "Fair";
  if (score >= 25) return "Poor";
  return "Critical";
}

function TrendIcon({ trend, delta }: { trend: string; delta: number }) {
  if (trend === "improving") return <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />;
  if (trend === "declining") return <TrendingDown className="h-3.5 w-3.5 text-red-400" />;
  return <Minus className="h-3.5 w-3.5 text-slate-400" />;
}

// ── Sub-score bar ─────────────────────────────────────────────────────────────

function SubScore({
  label,
  score,
  weight,
  icon: Icon,
}: {
  label: string;
  score: number;
  weight: number;
  icon: React.ElementType;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-1 text-slate-400">
          <Icon className="h-3 w-3" />
          {label}
          <span className="text-slate-600">({weight}%)</span>
        </span>
        <span className={cn("font-mono font-semibold", scoreColor(score))}>
          {score.toFixed(0)}
        </span>
      </div>
      <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-700", progressColor(score))}
          style={{ width: `${Math.min(100, score)}%` }}
        />
      </div>
    </div>
  );
}

// ── Score Ring ────────────────────────────────────────────────────────────────

function ScoreRing({ score }: { score: number }) {
  const r = 28;
  const circ = 2 * Math.PI * r;
  const fill = circ * (score / 100);
  const strokeColor =
    score >= 75 ? "#10b981" : score >= 50 ? "#eab308" : "#ef4444";

  return (
    <svg width="72" height="72" viewBox="0 0 72 72" className="flex-shrink-0">
      <circle
        cx="36" cy="36" r={r}
        fill="none" stroke="#1e293b" strokeWidth="6"
      />
      <circle
        cx="36" cy="36" r={r}
        fill="none"
        stroke={strokeColor}
        strokeWidth="6"
        strokeDasharray={`${fill} ${circ}`}
        strokeLinecap="round"
        transform="rotate(-90 36 36)"
        className="transition-all duration-700"
      />
      <text x="36" y="40" textAnchor="middle" fontSize="14" fontWeight="700" fill={strokeColor}>
        {Math.round(score)}
      </text>
    </svg>
  );
}

// ── Vendor Card ───────────────────────────────────────────────────────────────

function VendorHistoryChart({ vendorName }: { vendorName: string }) {
  const { data, isLoading } = useQuery<{ current: VendorHealthScore | null; history: VendorHistoryPoint[] }>({
    queryKey: ["/api/vendor-health", vendorName],
    queryFn: () => fetch(`/api/vendor-health/${encodeURIComponent(vendorName)}`).then(r => r.json()),
    staleTime: 5 * 60 * 1000,
  });

  const history = data?.history ?? [];

  if (isLoading) {
    return <div className="h-28 flex items-center justify-center text-xs text-slate-600">Loading history…</div>;
  }
  if (history.length < 2) {
    return <div className="h-10 text-[11px] text-slate-600 italic">Score history builds after 2+ compute cycles (every 15 min).</div>;
  }

  const chartData = history.map(p => ({
    label: new Date(p.scoredAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    score: p.overallScore,
    quality: p.qualityScore,
    reliability: p.reliabilityScore,
  }));

  return (
    <div className="mt-3 col-span-full" data-testid={`history-chart-${vendorName.replace(/\s+/g, "-")}`}>
      <div className="text-[10px] text-slate-500 mb-1 uppercase tracking-wide">7-Day Score History</div>
      <ResponsiveContainer width="100%" height={90}>
        <LineChart data={chartData} margin={{ top: 4, right: 8, left: -28, bottom: 0 }}>
          <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#64748b" }} tickLine={false} axisLine={false} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 9, fill: "#64748b" }} tickLine={false} axisLine={false} />
          <ReferenceLine y={75} stroke="#10b981" strokeDasharray="3 3" strokeOpacity={0.4} />
          <ReferenceLine y={50} stroke="#eab308" strokeDasharray="3 3" strokeOpacity={0.4} />
          <RechartsTooltip
            contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 6, fontSize: 11 }}
            labelStyle={{ color: "#94a3b8" }}
            formatter={(val: number, name: string) => [val.toFixed(1), name.charAt(0).toUpperCase() + name.slice(1)]}
          />
          <Line type="monotone" dataKey="score" stroke="#6366f1" strokeWidth={2} dot={{ r: 2, fill: "#6366f1" }} name="Overall" />
          <Line type="monotone" dataKey="quality" stroke="#10b981" strokeWidth={1.5} dot={false} name="Quality" strokeDasharray="4 2" />
          <Line type="monotone" dataKey="reliability" stroke="#3b82f6" strokeWidth={1.5} dot={false} name="Reliability" strokeDasharray="4 2" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function VendorCard({ vendor }: { vendor: VendorHealthScore }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={cn(
        "rounded-lg border p-4 transition-all duration-200",
        scoreBg(vendor.overallScore),
        "hover:border-opacity-60",
      )}
      data-testid={`vendor-health-card-${vendor.vendorName.replace(/\s+/g, "-")}`}
    >
      {/* Header row */}
      <div className="flex items-start gap-3">
        <ScoreRing score={vendor.overallScore} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="font-semibold text-slate-100 truncate"
              data-testid="vendor-health-name"
            >
              {vendor.vendorName}
            </span>
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] font-semibold px-1.5 py-0 border-0",
                vendor.overallScore >= 75
                  ? "bg-emerald-500/20 text-emerald-300"
                  : vendor.overallScore >= 50
                  ? "bg-yellow-500/20 text-yellow-300"
                  : "bg-red-500/20 text-red-300",
              )}
            >
              {scoreLabel(vendor.overallScore)}
            </Badge>
            <span className="flex items-center gap-0.5 text-xs">
              <TrendIcon trend={vendor.trend} delta={vendor.trendDelta} />
              <span
                className={cn(
                  "text-xs",
                  vendor.trend === "improving"
                    ? "text-emerald-400"
                    : vendor.trend === "declining"
                    ? "text-red-400"
                    : "text-slate-500",
                )}
              >
                {vendor.trendDelta !== 0
                  ? `${vendor.trendDelta > 0 ? "+" : ""}${vendor.trendDelta.toFixed(1)} 24h`
                  : "stable"}
              </span>
            </span>
          </div>

          {/* Sub-dimension scores */}
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
            <SubScore label="Quality"     score={vendor.qualityScore}     weight={35} icon={BarChart3} />
            <SubScore label="Reliability" score={vendor.reliabilityScore} weight={30} icon={Activity} />
            <SubScore label="Fraud"       score={vendor.fraudScore}       weight={20} icon={Shield} />
            <SubScore label="Margin"      score={vendor.marginScore}      weight={15} icon={DollarSign} />
          </div>
        </div>

        <button
          data-testid={`btn-expand-${vendor.vendorName.replace(/\s+/g, "-")}`}
          onClick={() => setExpanded(v => !v)}
          className="p-1 rounded hover:bg-white/10 text-slate-500 hover:text-slate-300 transition-colors flex-shrink-0"
        >
          {expanded ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="mt-4 pt-3 border-t border-white/10 grid grid-cols-2 sm:grid-cols-3 gap-3">
          {vendor.details.asr != null && (
            <DetailStat label="ASR" value={`${vendor.details.asr.toFixed(1)}%`} good={vendor.details.asr >= 60} />
          )}
          {vendor.details.acd != null && (
            <DetailStat label="Avg ACD" value={`${vendor.details.acd.toFixed(0)}s`} good={vendor.details.acd >= 30} />
          )}
          {vendor.details.pddMs != null && (
            <DetailStat label="Avg PDD" value={`${(vendor.details.pddMs / 1000).toFixed(2)}s`} good={vendor.details.pddMs < 3000} />
          )}
          {vendor.details.optionsUptimePct != null && (
            <DetailStat label="OPTIONS Uptime" value={`${vendor.details.optionsUptimePct.toFixed(1)}%`} good={vendor.details.optionsUptimePct >= 95} />
          )}
          {vendor.details.sipErrorRate503 != null && (
            <DetailStat label="503 Rate" value={`${vendor.details.sipErrorRate503.toFixed(1)}%`} good={vendor.details.sipErrorRate503 < 5} />
          )}
          {vendor.details.sipErrorRate408 != null && (
            <DetailStat label="408 Rate" value={`${vendor.details.sipErrorRate408.toFixed(1)}%`} good={vendor.details.sipErrorRate408 < 5} />
          )}
          {vendor.details.fasCount24h != null && (
            <DetailStat label="FAS Events 24h" value={String(vendor.details.fasCount24h)} good={vendor.details.fasCount24h === 0} />
          )}
          {vendor.details.blacklistHits != null && (
            <DetailStat label="Blacklist Hits" value={String(vendor.details.blacklistHits)} good={vendor.details.blacklistHits === 0} />
          )}
          {vendor.details.marginPct != null && (
            <DetailStat label="Margin" value={`${vendor.details.marginPct.toFixed(1)}%`} good={vendor.details.marginPct >= 10} />
          )}
          <div className="text-[10px] text-slate-600 col-span-full">
            Scored {new Date(vendor.scoredAt).toLocaleString()}
          </div>
          {/* 7-day score history chart */}
          <VendorHistoryChart vendorName={vendor.vendorName} />
        </div>
      )}
    </div>
  );
}

function DetailStat({
  label,
  value,
  good,
}: {
  label: string;
  value: string;
  good: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-slate-500">{label}</span>
      <span
        className={cn(
          "text-xs font-mono font-semibold",
          good ? "text-emerald-400" : "text-red-400",
        )}
      >
        {value}
      </span>
    </div>
  );
}

// ── Route Health Table ────────────────────────────────────────────────────────

function RouteHealthTable({ scores }: { scores: RouteHealthScore[] }) {
  if (scores.length === 0) {
    return (
      <div className="text-center py-16 text-slate-500 text-sm">
        No routing group health data available yet.
        <br />
        Scores are computed every 15 minutes after vendors are scored.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-800">
            <th className="text-left py-2 px-3 text-xs text-slate-500 font-medium">Routing Group</th>
            <th className="text-center py-2 px-3 text-xs text-slate-500 font-medium">Score</th>
            <th className="text-center py-2 px-3 text-xs text-slate-500 font-medium">Vendors</th>
            <th className="text-center py-2 px-3 text-xs text-slate-500 font-medium">Weakest</th>
            <th className="text-right py-2 px-3 text-xs text-slate-500 font-medium">Computed</th>
          </tr>
        </thead>
        <tbody>
          {scores
            .sort((a, b) => a.overallScore - b.overallScore)
            .map(r => (
              <tr
                key={r.routingGroupId}
                className="border-b border-slate-800/60 hover:bg-slate-800/30 transition-colors"
                data-testid={`route-health-row-${r.routingGroupId}`}
              >
                <td className="py-2.5 px-3 text-slate-200 font-medium">{r.routingGroupName}</td>
                <td className="py-2.5 px-3 text-center">
                  <span className={cn("font-mono font-bold", scoreColor(r.overallScore))}>
                    {r.overallScore.toFixed(0)}
                  </span>
                  <div className="h-1 w-16 mx-auto mt-1 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className={cn("h-full rounded-full", progressColor(r.overallScore))}
                      style={{ width: `${r.overallScore}%` }}
                    />
                  </div>
                </td>
                <td className="py-2.5 px-3 text-center text-slate-400">{r.vendorCount}</td>
                <td className="py-2.5 px-3 text-center">
                  {r.lowestVendorScore != null ? (
                    <span className={cn("font-mono text-xs", scoreColor(r.lowestVendorScore))}>
                      {r.lowestVendorScore.toFixed(0)}
                    </span>
                  ) : (
                    <span className="text-slate-600">—</span>
                  )}
                </td>
                <td className="py-2.5 px-3 text-right text-[11px] text-slate-500">
                  {new Date(r.scoredAt).toLocaleTimeString()}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Summary KPIs ──────────────────────────────────────────────────────────────

function SummaryKpis({ scores }: { scores: VendorHealthScore[] }) {
  const total    = scores.length;
  const critical = scores.filter(s => s.overallScore < 50).length;
  const fair     = scores.filter(s => s.overallScore >= 50 && s.overallScore < 75).length;
  const good     = scores.filter(s => s.overallScore >= 75).length;
  const avgScore = total > 0 ? scores.reduce((s, v) => s + v.overallScore, 0) / total : 0;
  const improving = scores.filter(s => s.trend === "improving").length;
  const declining = scores.filter(s => s.trend === "declining").length;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
      <KpiTile label="Total Vendors"  value={String(total)}                color="text-slate-200" />
      <KpiTile label="Avg Score"      value={avgScore.toFixed(0)}          color={scoreColor(avgScore)} />
      <KpiTile label="Good (≥75)"     value={String(good)}                 color="text-emerald-400" />
      <KpiTile label="Fair (50–74)"   value={String(fair)}                 color="text-yellow-400" />
      <KpiTile label="Critical (<50)" value={String(critical)}             color={critical > 0 ? "text-red-400" : "text-slate-500"} />
      <KpiTile
        label="Trends"
        value={`↑${improving} ↓${declining}`}
        color={declining > 0 ? "text-red-400" : "text-emerald-400"}
      />
    </div>
  );
}

function KpiTile({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-lg px-3 py-2.5 flex flex-col gap-0.5">
      <span className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</span>
      <span className={cn("text-xl font-bold font-mono", color)}>{value}</span>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function VendorHealthPage() {
  const qc = useQueryClient();
  const [filterMin, setFilterMin] = useState<number>(0);
  const [sortBy, setSortBy] = useState<"score" | "name" | "trend">("score");

  const { data: vendorData, isLoading: vendorLoading } = useQuery<{
    scores: VendorHealthScore[];
    lastRunAt: string | null;
  }>({
    queryKey: ["/api/vendor-health"],
    refetchInterval: 5 * 60_000,
  });

  const { data: routeData } = useQuery<{
    scores: RouteHealthScore[];
    lastRunAt: string | null;
  }>({
    queryKey: ["/api/route-health"],
    refetchInterval: 5 * 60_000,
  });

  const recompute = useMutation({
    mutationFn: () => apiRequest("POST", "/api/vendor-health/recompute"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/vendor-health"] });
      qc.invalidateQueries({ queryKey: ["/api/route-health"] });
    },
  });

  const vendorScores = (vendorData?.scores ?? [])
    .filter(s => s.overallScore >= filterMin)
    .sort((a, b) => {
      if (sortBy === "name")  return a.vendorName.localeCompare(b.vendorName);
      if (sortBy === "trend") {
        const t = { declining: 0, stable: 1, improving: 2 };
        return (t[a.trend] ?? 1) - (t[b.trend] ?? 1);
      }
      return a.overallScore - b.overallScore; // ascending: worst first
    });

  const routeScores = routeData?.scores ?? [];

  return (
    <TooltipProvider>
      <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
              <Activity className="h-6 w-6 text-cyan-400" />
              Vendor Health Engine
            </h1>
            <p className="text-sm text-slate-400 mt-0.5">
              Unified 0–100 health score · Quality 35% · Reliability 30% · Fraud 20% · Margin 15%
            </p>
          </div>
          <div className="flex items-center gap-2">
            {vendorData?.lastRunAt && (
              <span className="text-xs text-slate-500">
                Last scored {new Date(vendorData.lastRunAt).toLocaleTimeString()}
              </span>
            )}
            <Button
              data-testid="btn-recompute-vendor-health"
              size="sm"
              variant="outline"
              onClick={() => recompute.mutate()}
              disabled={recompute.isPending}
              className="gap-1.5"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", recompute.isPending && "animate-spin")} />
              {recompute.isPending ? "Computing…" : "Recompute"}
            </Button>
          </div>
        </div>

        {/* KPI summary strip */}
        {vendorScores.length > 0 && (
          <SummaryKpis scores={vendorData?.scores ?? []} />
        )}

        {/* Tabs: Vendors / Routes */}
        <Tabs defaultValue="vendors">
          <TabsList className="bg-slate-900 border border-slate-800">
            <TabsTrigger value="vendors" data-testid="tab-vendors">
              Vendors
              {(vendorData?.scores ?? []).length > 0 && (
                <span className="ml-1.5 text-xs bg-slate-700 px-1.5 py-0.5 rounded">
                  {(vendorData?.scores ?? []).length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="routes" data-testid="tab-routes">
              Routing Groups
              {routeScores.length > 0 && (
                <span className="ml-1.5 text-xs bg-slate-700 px-1.5 py-0.5 rounded">
                  {routeScores.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          {/* Vendors tab */}
          <TabsContent value="vendors" className="mt-4 space-y-3">
            {/* Filter / sort bar */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-500">Filter:</span>
              {[
                { label: "All",      min: 0  },
                { label: "≥50 Fair", min: 50 },
                { label: "≥75 Good", min: 75 },
                { label: "<50 Critical", min: -1 },
              ].map(opt => (
                <button
                  key={opt.label}
                  data-testid={`filter-score-${opt.label.replace(/[^a-z0-9]/gi, "-")}`}
                  onClick={() => setFilterMin(opt.min === -1 ? 0 : opt.min)}
                  className={cn(
                    "text-xs px-2 py-1 rounded border transition-colors",
                    filterMin === (opt.min === -1 ? 0 : opt.min) && opt.min !== -1
                      ? "bg-cyan-500/20 border-cyan-500/40 text-cyan-300"
                      : "border-slate-700 text-slate-400 hover:border-slate-600",
                  )}
                >
                  {opt.label}
                </button>
              ))}
              <div className="ml-auto flex items-center gap-2">
                <span className="text-xs text-slate-500">Sort:</span>
                {(["score", "name", "trend"] as const).map(s => (
                  <button
                    key={s}
                    data-testid={`sort-${s}`}
                    onClick={() => setSortBy(s)}
                    className={cn(
                      "text-xs px-2 py-1 rounded border capitalize transition-colors",
                      sortBy === s
                        ? "bg-slate-700 border-slate-600 text-slate-200"
                        : "border-slate-800 text-slate-500 hover:border-slate-700",
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {vendorLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-36 rounded-lg bg-slate-900/60 border border-slate-800 animate-pulse"
                  />
                ))}
              </div>
            ) : vendorScores.length === 0 ? (
              <div className="text-center py-20">
                <Activity className="h-12 w-12 text-slate-700 mx-auto mb-3" />
                <p className="text-slate-500 text-sm">No vendor health scores yet.</p>
                <p className="text-slate-600 text-xs mt-1">
                  Scores compute every 15 minutes after startup. Click Recompute to run now.
                </p>
                <Button
                  data-testid="btn-recompute-empty"
                  size="sm"
                  variant="outline"
                  className="mt-4"
                  onClick={() => recompute.mutate()}
                  disabled={recompute.isPending}
                >
                  <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", recompute.isPending && "animate-spin")} />
                  Run Now
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {vendorScores.map(v => (
                  <VendorCard key={v.vendorName} vendor={v} />
                ))}
              </div>
            )}
          </TabsContent>

          {/* Routes tab */}
          <TabsContent value="routes" className="mt-4">
            <Card className="bg-slate-900/60 border-slate-800">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold text-slate-300">
                  Routing Group Health
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <RouteHealthTable scores={routeScores} />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </TooltipProvider>
  );
}

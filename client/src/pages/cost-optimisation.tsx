import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  DollarSign, TrendingUp, AlertTriangle, Zap, Shield, Target, Lightbulb,
  RefreshCw, Download, ChevronDown, ChevronRight, BarChart2, Clock, CheckCircle2,
  XCircle, ArrowRight, Sparkles, BrainCircuit, Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatInTz } from "@/lib/date-utils";
import { useTimezone } from "@/context/timezone-context";
import * as XLSX from "xlsx";

// ── Types ───────────────────────────────────────────────────────────────────

type Metric = { label: string; value: string };
type Recommendation = {
  id: string;
  category: string;
  priority: "high" | "medium" | "low";
  title: string;
  description: string;
  vendor?: string;
  metrics: Metric[];
  estimatedMonthlySavings: number;
  confidence: number;
  actions: string[];
};
type Summary = {
  totalSpend: number;
  estimatedMonthlySpend: number;
  totalPotentialMonthlySavings: number;
  cdrCount: number;
  vendorCount: number;
  analysisDays: number;
  portfolioCPM: number;
  lowestCPM: number | null;
};
type AnalysisResult = {
  recommendations: Recommendation[];
  summary: Summary;
  hours: number;
  generatedAt: string;
};

// ── Constants ────────────────────────────────────────────────────────────────

const TIME_OPTIONS = [
  { label: "24 h", hours: 24 },
  { label: "7 days", hours: 168 },
  { label: "14 days", hours: 336 },
  { label: "30 days", hours: 720 },
];

const CATEGORY_META: Record<string, { label: string; icon: typeof DollarSign; color: string; bg: string; border: string }> = {
  cost_reduction: { label: "Cost Reduction",  icon: DollarSign,   color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
  quality_alert:  { label: "Quality Alert",   icon: AlertTriangle, color: "text-orange-400", bg: "bg-orange-500/10",  border: "border-orange-500/20" },
  risk:           { label: "Risk",             icon: Shield,        color: "text-red-400",    bg: "bg-red-500/10",    border: "border-red-500/20" },
  opportunity:    { label: "Opportunity",      icon: TrendingUp,    color: "text-blue-400",   bg: "bg-blue-500/10",   border: "border-blue-500/20" },
  anomaly:        { label: "Anomaly",          icon: Zap,           color: "text-yellow-400", bg: "bg-yellow-500/10", border: "border-yellow-500/20" },
  strategy:       { label: "Strategy",         icon: Target,        color: "text-violet-400", bg: "bg-violet-500/10", border: "border-violet-500/20" },
};

const PRIORITY_META: Record<string, { label: string; dot: string; text: string }> = {
  high:   { label: "High",   dot: "bg-red-500",    text: "text-red-400"    },
  medium: { label: "Medium", dot: "bg-yellow-500", text: "text-yellow-400" },
  low:    { label: "Low",    dot: "bg-slate-500",  text: "text-slate-400"  },
};

const FILTER_TABS = [
  { key: "all",           label: "All" },
  { key: "cost_reduction",label: "Cost" },
  { key: "quality_alert", label: "Quality" },
  { key: "risk",          label: "Risk" },
  { key: "opportunity",   label: "Opportunity" },
  { key: "anomaly",       label: "Anomaly" },
  { key: "strategy",      label: "Strategy" },
];

// ── Sub-components ───────────────────────────────────────────────────────────

function SummaryCard({ icon: Icon, label, value, sub, accent }: { icon: typeof DollarSign; label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-border/50 bg-card/70 p-5">
      <div className="flex items-start justify-between mb-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
        <div className={cn("p-1.5 rounded-lg", accent || "bg-muted/30")}>
          <Icon className="w-4 h-4 text-muted-foreground" />
        </div>
      </div>
      <p className={cn("text-2xl font-bold font-mono tracking-tight", accent ? "text-foreground" : "text-foreground")}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}

function ConfidenceBar({ value }: { value: number }) {
  const color = value >= 80 ? "bg-emerald-500" : value >= 60 ? "bg-yellow-500" : "bg-slate-400";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted/40 rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${value}%` }} />
      </div>
      <span className="text-xs font-mono text-muted-foreground/70 w-8 text-right">{value}%</span>
    </div>
  );
}

function RecCard({ rec }: { rec: Recommendation }) {
  const [expanded, setExpanded] = useState(false);
  const cat = CATEGORY_META[rec.category] || CATEGORY_META.strategy;
  const pri = PRIORITY_META[rec.priority] || PRIORITY_META.low;
  const CatIcon = cat.icon;
  const hasSavings = rec.estimatedMonthlySavings > 0;

  return (
    <div
      data-testid={`card-rec-${rec.id}`}
      className={cn(
        "rounded-xl border bg-card/60 overflow-hidden transition-all",
        rec.priority === "high" ? "border-border/70" : "border-border/40"
      )}
    >
      {/* Header row */}
      <div className="flex items-start gap-4 p-5">
        {/* Category icon */}
        <div className={cn("flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center", cat.bg, cat.border, "border")}>
          <CatIcon className={cn("w-5 h-5", cat.color)} />
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1.5">
            {/* Priority badge */}
            <span className="flex items-center gap-1.5 text-xs font-semibold">
              <span className={cn("w-2 h-2 rounded-full inline-block", pri.dot)} />
              <span className={pri.text}>{pri.label} Priority</span>
            </span>
            {/* Category badge */}
            <span className={cn("px-2 py-0.5 rounded-md text-xs font-medium border", cat.bg, cat.border, cat.color)}>
              {cat.label}
            </span>
            {/* Vendor tag */}
            {rec.vendor && (
              <span className="px-2 py-0.5 rounded-md text-xs bg-muted/40 border border-border/40 text-muted-foreground">
                {rec.vendor}
              </span>
            )}
          </div>
          <h3 className="font-semibold text-sm leading-snug mb-1">{rec.title}</h3>
          <p className="text-xs text-muted-foreground leading-relaxed">{rec.description}</p>

          {/* Metrics pills */}
          <div className="flex flex-wrap gap-2 mt-3">
            {rec.metrics.map(m => (
              <div key={m.label} className="bg-muted/30 rounded-md px-2.5 py-1 text-xs">
                <span className="text-muted-foreground">{m.label}: </span>
                <span className="font-mono font-medium">{m.value}</span>
              </div>
            ))}
          </div>

          {/* Confidence */}
          <div className="mt-3">
            <p className="text-xs text-muted-foreground/60 mb-1">Analysis confidence</p>
            <ConfidenceBar value={rec.confidence} />
          </div>
        </div>

        {/* Right: savings */}
        <div className="flex-shrink-0 text-right ml-2">
          {hasSavings ? (
            <>
              <p className="text-xs text-muted-foreground/60 whitespace-nowrap">Est. savings</p>
              <p className="text-lg font-bold font-mono text-emerald-400">
                ${rec.estimatedMonthlySavings.toFixed(0)}
              </p>
              <p className="text-xs text-muted-foreground/60">/month</p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground/40 italic whitespace-nowrap">Risk / hygiene</p>
          )}
        </div>
      </div>

      {/* Actions toggle */}
      <button
        data-testid={`button-expand-${rec.id}`}
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-2 px-5 py-2.5 border-t border-border/30 text-xs text-muted-foreground hover:bg-muted/20 transition-colors text-left"
      >
        {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        <span>{expanded ? "Hide" : "Show"} recommended actions</span>
      </button>

      {/* Action steps */}
      {expanded && (
        <div className="px-5 pb-4 border-t border-border/30 bg-muted/10">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mt-3 mb-2">Action Steps</p>
          <ol className="space-y-2">
            {rec.actions.map((action, i) => (
              <li key={i} className="flex items-start gap-2.5 text-xs text-foreground/80">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center font-bold mt-0.5">
                  {i + 1}
                </span>
                <span className="leading-relaxed">{action}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function CostOptimisationPage() {
  const { tz, tzAbbr } = useTimezone();
  const [hours, setHours] = useState(168);
  const [activeFilter, setActiveFilter] = useState("all");
  const [fetchEnabled, setFetchEnabled] = useState(true);

  const { data, isLoading, isFetching, refetch, dataUpdatedAt } = useQuery<AnalysisResult>({
    queryKey: ["/api/cost-optimisation/analyse", hours],
    queryFn: () => fetch(`/api/cost-optimisation/analyse?hours=${hours}`).then(r => r.json()),
    enabled: fetchEnabled,
    staleTime: 5 * 60 * 1000,
  });

  const recs = data?.recommendations ?? [];
  const summary = data?.summary;

  const filtered = useMemo(() => {
    if (activeFilter === "all") return recs;
    return recs.filter(r => r.category === activeFilter);
  }, [recs, activeFilter]);

  const countByCategory = useMemo(() => {
    const counts: Record<string, number> = { all: recs.length };
    for (const r of recs) counts[r.category] = (counts[r.category] || 0) + 1;
    return counts;
  }, [recs]);

  function handleRunAnalysis() {
    setFetchEnabled(true);
    refetch();
  }

  function exportCSV() {
    if (!recs.length) return;
    const rows = [
      ["Priority", "Category", "Vendor", "Title", "Est. Monthly Savings ($)", "Confidence (%)", "Actions"].join(","),
      ...recs.map(r => [
        r.priority, r.category, r.vendor || "", `"${r.title.replace(/"/g, '""')}"`,
        r.estimatedMonthlySavings.toFixed(2), r.confidence,
        `"${r.actions.join("; ").replace(/"/g, '""')}"`,
      ].join(",")),
    ];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv" }));
    a.download = `cost_optimisation_${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
  }

  const savingsPct = summary && summary.estimatedMonthlySpend > 0
    ? ((summary.totalPotentialMonthlySavings / summary.estimatedMonthlySpend) * 100).toFixed(1)
    : null;

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <Lightbulb className="w-5 h-5 text-primary" />
            <h1 className="text-xl font-bold">Cost Optimisation Engine</h1>
            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-primary/10 text-primary border border-primary/20">
              <BrainCircuit className="w-3 h-3" />
              Smart Analysis
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            Multi-factor analysis of vendor costs, quality and routing to surface actionable savings opportunities
          </p>
          {summary && (
            <p className="text-xs text-muted-foreground/60 mt-1 flex items-center gap-1.5">
              <BarChart2 className="w-3 h-3" />
              {summary.cdrCount.toLocaleString()} CDRs · {summary.vendorCount} vendors · {summary.analysisDays}d window
              {dataUpdatedAt > 0 && (
                <span className="ml-1">· Analysed {formatInTz(new Date(dataUpdatedAt), "HH:mm:ss", tz)} {tzAbbr}</span>
              )}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Time window */}
          <div className="flex items-center gap-1 bg-muted/30 rounded-lg p-1">
            {TIME_OPTIONS.map(opt => (
              <button
                key={opt.hours}
                data-testid={`time-${opt.hours}h`}
                onClick={() => setHours(opt.hours)}
                className={cn(
                  "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                  hours === opt.hours
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
              >{opt.label}</button>
            ))}
          </div>
          {/* Actions */}
          <button
            data-testid="button-run-analysis"
            onClick={handleRunAnalysis}
            disabled={isLoading || isFetching}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", (isLoading || isFetching) && "animate-spin")} />
            {isLoading || isFetching ? "Analysing…" : "Run Analysis"}
          </button>
          <button
            data-testid="button-export-csv"
            onClick={exportCSV}
            disabled={!recs.length}
            className="flex items-center gap-2 px-3.5 py-2 rounded-lg border border-border bg-card text-sm font-medium hover:bg-muted/30 transition-colors disabled:opacity-40"
          >
            <Download className="w-3.5 h-3.5" />
            Export
          </button>
        </div>
      </div>

      {/* ── Loading skeleton ── */}
      {(isLoading || isFetching) && (
        <div className="rounded-xl border border-border/40 bg-card/50 p-8 flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          <p className="text-sm font-medium">Running smart analysis across {hours >= 168 ? `${hours / 24} days` : `${hours}h`} of CDR data…</p>
          <p className="text-xs text-muted-foreground">Evaluating vendor costs, quality metrics, routing patterns and rate cards</p>
        </div>
      )}

      {/* ── Summary cards ── */}
      {!isLoading && summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard
            icon={DollarSign}
            label="Est. Monthly Spend"
            value={`$${summary.estimatedMonthlySpend.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            sub={`$${summary.totalSpend.toFixed(4)} over ${summary.analysisDays}d`}
            accent="bg-muted/30"
          />
          <SummaryCard
            icon={TrendingUp}
            label="Potential Savings"
            value={`$${summary.totalPotentialMonthlySavings.toFixed(0)}/mo`}
            sub={savingsPct ? `${savingsPct}% of monthly spend` : undefined}
            accent="bg-emerald-500/10"
          />
          <SummaryCard
            icon={Sparkles}
            label="Recommendations"
            value={String(recs.length)}
            sub={`${recs.filter(r => r.priority === "high").length} high priority`}
            accent="bg-primary/10"
          />
          <SummaryCard
            icon={BarChart2}
            label="Portfolio CPM"
            value={summary.portfolioCPM > 0 ? `$${summary.portfolioCPM.toFixed(5)}` : "—"}
            sub={summary.lowestCPM !== null ? `Best: $${summary.lowestCPM.toFixed(5)}` : undefined}
            accent="bg-blue-500/10"
          />
        </div>
      )}

      {/* ── Empty state (no CDR data) ── */}
      {!isLoading && !isFetching && summary && summary.cdrCount === 0 && (
        <div className="rounded-xl border border-border/40 bg-card/50 p-10 flex flex-col items-center text-center gap-3">
          <Info className="w-10 h-10 text-muted-foreground/30" />
          <p className="font-semibold text-muted-foreground">No CDR data in the selected window</p>
          <p className="text-sm text-muted-foreground/60">The CDR cache may still be populating. Try expanding the time window or wait a few minutes for data to load.</p>
        </div>
      )}

      {/* ── Recommendations panel ── */}
      {!isLoading && recs.length > 0 && (
        <div className="rounded-xl border border-border/50 bg-card/40 overflow-hidden">
          {/* Filter tabs */}
          <div className="flex items-center gap-1 px-4 py-3 border-b border-border/40 bg-muted/10 overflow-x-auto">
            {FILTER_TABS.map(tab => (
              <button
                key={tab.key}
                data-testid={`filter-${tab.key}`}
                onClick={() => setActiveFilter(tab.key)}
                className={cn(
                  "flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                  activeFilter === tab.key
                    ? "bg-primary/10 text-primary border border-primary/20"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                )}
              >
                {tab.label}
                {(countByCategory[tab.key] ?? 0) > 0 && (
                  <span className={cn(
                    "px-1.5 py-0.5 rounded-full text-xs font-bold min-w-[18px] text-center",
                    activeFilter === tab.key ? "bg-primary/20 text-primary" : "bg-muted/50 text-muted-foreground"
                  )}>
                    {countByCategory[tab.key] ?? 0}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Rec list */}
          <div className="p-4 space-y-3">
            {filtered.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-8">No recommendations in this category for the selected window.</p>
            ) : (
              filtered.map(rec => <RecCard key={rec.id} rec={rec} />)
            )}
          </div>
        </div>
      )}

      {/* ── Methodology footer ── */}
      {!isLoading && recs.length > 0 && (
        <div className="rounded-xl border border-border/30 bg-muted/10 px-5 py-4 flex items-start gap-3">
          <BrainCircuit className="w-4 h-4 text-primary/60 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-muted-foreground/70 leading-relaxed">
            <span className="font-semibold text-muted-foreground">Smart Analysis Engine</span> — Recommendations are generated by a multi-factor scoring algorithm that evaluates vendor cost-per-minute against portfolio benchmarks (mean ± σ), ASR/ACD/PDD quality thresholds, traffic concentration ratios, rate card coverage, and temporal routing patterns. Estimated savings figures are extrapolated from the analysis window. Confidence scores reflect statistical data volume and rule certainty.
          </div>
        </div>
      )}
    </div>
  );
}

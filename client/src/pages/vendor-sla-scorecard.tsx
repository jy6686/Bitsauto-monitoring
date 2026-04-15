import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, TrendingUp, TrendingDown, ChevronDown, ChevronRight, Download, RefreshCw, AlertTriangle, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

// ── Types ────────────────────────────────────────────────────────────────────

interface VendorRow {
  vendor: string;
  totalCalls: number;
  answeredCalls: number;
  asr: number;
  acdSec: number;
  avgPddSec: number;
  mos: number | null;
  totalMinutes: number;
  totalCost: number;
  costPerMin: number;
  asrGrade: string;
  acdGrade: string;
  pddGrade: string;
  mosGrade: string;
  overallGrade: string;
  topCountries: { country: string; count: number }[];
}

interface ScorecardResponse {
  rows: VendorRow[];
  total: number;
  hours: number;
  cdrCacheSize: number;
  updatedAt: string | null;
}

// ── Grade helpers ─────────────────────────────────────────────────────────────

const GRADE_COLORS: Record<string, string> = {
  A: "text-emerald-400 bg-emerald-500/15 border-emerald-500/30",
  B: "text-sky-400 bg-sky-500/15 border-sky-500/30",
  C: "text-amber-400 bg-amber-500/15 border-amber-500/30",
  D: "text-orange-400 bg-orange-500/15 border-orange-500/30",
  F: "text-red-400 bg-red-500/15 border-red-500/30",
  "N/A": "text-muted-foreground bg-muted/20 border-border/30",
};

const GRADE_BAR_BG: Record<string, string> = {
  A: "bg-emerald-500",
  B: "bg-sky-500",
  C: "bg-amber-500",
  D: "bg-orange-500",
  F: "bg-red-500",
  "N/A": "bg-muted-foreground/30",
};

function GradeBadge({ grade, size = "sm" }: { grade: string; size?: "sm" | "lg" }) {
  const cls = GRADE_COLORS[grade] ?? GRADE_COLORS["N/A"];
  return (
    <span
      className={`inline-flex items-center justify-center rounded border font-bold ${size === "lg" ? "text-xl px-3 py-1" : "text-xs px-2 py-0.5"} ${cls}`}
      data-testid={`grade-badge-${grade}`}
    >
      {grade}
    </span>
  );
}

function MetricCell({ value, grade, fmt }: { value: string | number | null; grade: string; fmt?: string }) {
  const bar = GRADE_BAR_BG[grade] ?? GRADE_BAR_BG["N/A"];
  const gradeScore = grade === 'A' ? 100 : grade === 'B' ? 75 : grade === 'C' ? 50 : grade === 'D' ? 25 : grade === 'F' ? 10 : 0;
  return (
    <div className="flex flex-col gap-0.5 items-end">
      <span className="font-mono text-sm font-medium tabular-nums">
        {value == null || value === 0 ? <span className="text-muted-foreground/40">—</span> : `${value}${fmt ?? ''}`}
      </span>
      <div className="w-16 h-1 rounded-full bg-muted/30 overflow-hidden">
        <div className={`h-full rounded-full transition-all ${bar}`} style={{ width: `${gradeScore}%` }} />
      </div>
    </div>
  );
}

// ── Summary Card ─────────────────────────────────────────────────────────────

function SummaryCard({ label, value, sub, icon: Icon, color }: {
  label: string; value: string | number; sub?: string;
  icon: React.ComponentType<{ className?: string }>; color: string;
}) {
  return (
    <div className="rounded-xl border border-border/50 bg-card/60 px-5 py-4 flex gap-4 items-start">
      <div className={`rounded-lg p-2.5 ${color}`}>
        <Icon className="h-4 w-4 text-white" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
        <p className="text-xl font-bold mt-0.5 truncate" data-testid={`summary-${label.toLowerCase().replace(/\s+/g, '-')}`}>{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ── SLA Legend ───────────────────────────────────────────────────────────────

const SLA_THRESHOLDS = [
  { metric: "ASR",  A: "≥ 65%",  B: "50–65%",  C: "35–50%",  D: "20–35%",  F: "< 20%"  },
  { metric: "ACD",  A: "≥ 180s", B: "60–180s",  C: "30–60s",  D: "10–30s",  F: "< 10s"  },
  { metric: "PDD",  A: "≤ 1s",   B: "1–2s",    C: "2–4s",    D: "4–6s",    F: "> 6s"   },
  { metric: "MOS",  A: "≥ 4.0",  B: "3.5–4.0", C: "3.0–3.5", D: "2.5–3.0", F: "< 2.5"  },
];

function SLALegend() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        data-testid="button-sla-legend"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        SLA Thresholds
      </button>
      {open && (
        <div className="mt-2 rounded-lg border border-border/40 bg-muted/20 overflow-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/30">
                <th className="px-3 py-2 text-left text-muted-foreground font-medium">Metric</th>
                {['A','B','C','D','F'].map(g => (
                  <th key={g} className={`px-3 py-2 text-center font-bold ${GRADE_COLORS[g]}`}>{g}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SLA_THRESHOLDS.map(row => (
                <tr key={row.metric} className="border-b border-border/20 last:border-0">
                  <td className="px-3 py-1.5 font-medium">{row.metric}</td>
                  {['A','B','C','D','F'].map(g => (
                    <td key={g} className="px-3 py-1.5 text-center text-muted-foreground">{(row as any)[g]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

const TIME_RANGES = [
  { label: "1h",  hours: 1  },
  { label: "6h",  hours: 6  },
  { label: "24h", hours: 24 },
  { label: "48h", hours: 48 },
  { label: "72h", hours: 72 },
];

type SortKey = "vendor" | "totalCalls" | "asr" | "acdSec" | "avgPddSec" | "mos" | "totalMinutes" | "costPerMin" | "overallGrade";

export default function VendorSlaScorecardPage() {
  const [hours, setHours] = useState(24);
  const [expandedVendor, setExpandedVendor] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("totalCalls");
  const [sortAsc, setSortAsc] = useState(false);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<ScorecardResponse>({
    queryKey: ["/api/vendor-sla/scorecard", hours],
    queryFn: () => fetch(`/api/vendor-sla/scorecard?hours=${hours}`).then(r => r.json()),
    refetchInterval: 5 * 60 * 1000,
  });

  const sorted = useMemo(() => {
    if (!data?.rows) return [];
    return [...data.rows].sort((a, b) => {
      const av = a[sortKey] as number | string | null;
      const bv = b[sortKey] as number | string | null;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return sortAsc ? cmp : -cmp;
    });
  }, [data, sortKey, sortAsc]);

  const summary = useMemo(() => {
    if (!data?.rows || data.rows.length === 0) return null;
    const rows = data.rows;
    const avgASR = rows.reduce((s, r) => s + r.asr, 0) / rows.length;
    const best = rows.reduce((best, r) => {
      const score = (r.overallGrade === 'A' ? 4 : r.overallGrade === 'B' ? 3 : r.overallGrade === 'C' ? 2 : r.overallGrade === 'D' ? 1 : 0);
      const bestScore = (best.overallGrade === 'A' ? 4 : best.overallGrade === 'B' ? 3 : best.overallGrade === 'C' ? 2 : best.overallGrade === 'D' ? 1 : 0);
      return score > bestScore ? r : best;
    }, rows[0]);
    const worst = rows.reduce((worst, r) => {
      const score = (r.overallGrade === 'A' ? 4 : r.overallGrade === 'B' ? 3 : r.overallGrade === 'C' ? 2 : r.overallGrade === 'D' ? 1 : 0);
      const worstScore = (worst.overallGrade === 'A' ? 4 : worst.overallGrade === 'B' ? 3 : worst.overallGrade === 'C' ? 2 : worst.overallGrade === 'D' ? 1 : 0);
      return score < worstScore ? r : worst;
    }, rows[0]);
    const totalCalls = rows.reduce((s, r) => s + r.totalCalls, 0);
    return { avgASR, best, worst, totalCalls };
  }, [data]);

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(a => !a);
    else { setSortKey(key); setSortAsc(false); }
  }

  function SortIcon({ k }: { k: SortKey }) {
    if (sortKey !== k) return <span className="text-muted-foreground/30 ml-0.5">↕</span>;
    return <span className="text-primary ml-0.5">{sortAsc ? '↑' : '↓'}</span>;
  }

  function downloadCSV() {
    if (!data?.rows) return;
    const headers = ["Vendor","Calls","Answered","ASR%","ASR Grade","ACD(s)","ACD Grade","PDD(s)","PDD Grade","Est MOS","MOS Grade","Minutes","Cost","Cost/Min","Overall Grade"];
    const lines = data.rows.map(r => [
      r.vendor, r.totalCalls, r.answeredCalls, r.asr, r.asrGrade,
      r.acdSec, r.acdGrade, r.avgPddSec, r.pddGrade,
      r.mos ?? 'N/A', r.mosGrade, r.totalMinutes, r.totalCost, r.costPerMin, r.overallGrade,
    ].join(","));
    const csv = [headers.join(","), ...lines].join("\n");
    const a = document.createElement("a");
    a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
    a.download = `vendor_sla_scorecard_${hours}h.csv`;
    a.click();
  }

  const fmtSec = (s: number) => {
    if (!s) return "—";
    if (s < 60) return `${s.toFixed(0)}s`;
    const m = Math.floor(s / 60), sec = Math.round(s % 60);
    return `${m}m${sec > 0 ? ` ${sec}s` : ""}`;
  };

  const thCls = "px-3 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide cursor-pointer hover:text-foreground select-none whitespace-nowrap";
  const thRCls = "px-3 py-2.5 text-right text-xs font-medium text-muted-foreground uppercase tracking-wide cursor-pointer hover:text-foreground select-none whitespace-nowrap";

  return (
    <div className="flex flex-col gap-6 p-6 min-h-0">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-indigo-500/15 p-2.5">
            <ShieldCheck className="h-6 w-6 text-indigo-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Vendor SLA Scorecard</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              A–F grades per carrier · ASR · ACD · PDD · Est. MOS · Cost/min
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Time range */}
          <div className="flex rounded-lg border border-border/50 overflow-hidden" data-testid="time-range-selector">
            {TIME_RANGES.map(t => (
              <button
                key={t.hours}
                onClick={() => setHours(t.hours)}
                data-testid={`button-range-${t.label}`}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  hours === t.hours
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted/50 text-muted-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <Button
            variant="outline" size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="button-refresh"
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button
            variant="outline" size="sm"
            onClick={downloadCSV}
            disabled={!data?.rows?.length}
            data-testid="button-export-csv"
          >
            <Download className="h-3.5 w-3.5 mr-1.5" />
            CSV
          </Button>
        </div>
      </div>

      {/* Summary strip */}
      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
      ) : summary ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <SummaryCard label="Vendors Tracked" value={data?.total ?? 0} sub={`from ${data?.cdrCacheSize ?? 0} CDRs`} icon={ShieldCheck} color="bg-indigo-500" />
          <SummaryCard label="Avg ASR" value={`${summary.avgASR.toFixed(1)}%`} sub={`over last ${hours}h`} icon={TrendingUp} color="bg-emerald-600" />
          <SummaryCard label="Best Performer" value={summary.best.vendor} sub={`Overall ${summary.best.overallGrade} · ASR ${summary.best.asr.toFixed(1)}%`} icon={TrendingUp} color="bg-sky-600" />
          <SummaryCard label="Needs Attention" value={summary.worst.vendor} sub={`Overall ${summary.worst.overallGrade} · ASR ${summary.worst.asr.toFixed(1)}%`} icon={TrendingDown} color="bg-rose-600" />
        </div>
      ) : null}

      {/* SLA legend */}
      <SLALegend />

      {/* Scorecard table */}
      <div className="rounded-xl border border-border/50 bg-card/60 overflow-auto">
        {isLoading ? (
          <div className="p-8 flex flex-col gap-3">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 rounded-lg" />)}
          </div>
        ) : isError ? (
          <div className="p-10 flex flex-col items-center gap-2 text-center">
            <AlertTriangle className="h-8 w-8 text-destructive" />
            <p className="text-sm font-medium">Failed to load scorecard</p>
            <p className="text-xs text-muted-foreground">{(error as Error)?.message ?? "Unknown error"}</p>
          </div>
        ) : sorted.length === 0 ? (
          <div className="p-10 flex flex-col items-center gap-2 text-center text-muted-foreground">
            <ShieldCheck className="h-8 w-8 opacity-30" />
            <p className="text-sm">No vendor CDR data in the last {hours}h window.</p>
            <p className="text-xs opacity-70">CDR cache refreshes every 5 minutes. Make sure CDRs have a vendor field populated.</p>
          </div>
        ) : (
          <table className="w-full text-sm" data-testid="vendor-scorecard-table">
            <thead className="border-b border-border/40 bg-muted/20">
              <tr>
                <th className={thCls} onClick={() => handleSort("vendor")}>Vendor <SortIcon k="vendor" /></th>
                <th className={thRCls} onClick={() => handleSort("totalCalls")}>Calls <SortIcon k="totalCalls" /></th>
                <th className={thRCls} onClick={() => handleSort("asr")}>ASR % <SortIcon k="asr" /></th>
                <th className={thRCls} onClick={() => handleSort("acdSec")}>ACD <SortIcon k="acdSec" /></th>
                <th className={thRCls} onClick={() => handleSort("avgPddSec")}>PDD <SortIcon k="avgPddSec" /></th>
                <th className={thRCls} onClick={() => handleSort("mos")}>Est. MOS <SortIcon k="mos" /></th>
                <th className={thRCls} onClick={() => handleSort("totalMinutes")}>Minutes <SortIcon k="totalMinutes" /></th>
                <th className={thRCls} onClick={() => handleSort("costPerMin")}>Cost/min <SortIcon k="costPerMin" /></th>
                <th className="px-3 py-2.5 text-center text-xs font-medium text-muted-foreground uppercase tracking-wide whitespace-nowrap">Overall</th>
                <th className="px-3 py-2.5 w-6" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {sorted.map(row => {
                const isExpanded = expandedVendor === row.vendor;
                return (
                  <>
                    <tr
                      key={row.vendor}
                      className="hover:bg-muted/20 transition-colors cursor-pointer"
                      onClick={() => setExpandedVendor(isExpanded ? null : row.vendor)}
                      data-testid={`row-vendor-${row.vendor}`}
                    >
                      {/* Vendor name + overall bar */}
                      <td className="px-3 py-3 font-medium whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span>{row.vendor}</span>
                        </div>
                      </td>
                      {/* Calls */}
                      <td className="px-3 py-3 text-right font-mono tabular-nums">{row.totalCalls.toLocaleString()}</td>
                      {/* ASR */}
                      <td className="px-3 py-3 text-right">
                        <div className="flex flex-col items-end gap-1">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono tabular-nums">{row.asr.toFixed(1)}%</span>
                            <GradeBadge grade={row.asrGrade} />
                          </div>
                          <div className="w-20 h-1 rounded-full bg-muted/30 overflow-hidden">
                            <div
                              className={`h-full rounded-full ${GRADE_BAR_BG[row.asrGrade] ?? 'bg-muted'}`}
                              style={{ width: `${Math.min(100, row.asr)}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      {/* ACD */}
                      <td className="px-3 py-3 text-right">
                        <MetricCell value={row.acdSec > 0 ? fmtSec(row.acdSec) : null} grade={row.acdGrade} />
                      </td>
                      {/* PDD */}
                      <td className="px-3 py-3 text-right">
                        <MetricCell value={row.avgPddSec > 0 ? `${row.avgPddSec.toFixed(2)}s` : null} grade={row.pddGrade} />
                      </td>
                      {/* MOS */}
                      <td className="px-3 py-3 text-right">
                        <MetricCell value={row.mos} grade={row.mosGrade} />
                      </td>
                      {/* Minutes */}
                      <td className="px-3 py-3 text-right font-mono tabular-nums text-muted-foreground">
                        {row.totalMinutes > 0 ? row.totalMinutes.toLocaleString(undefined, { maximumFractionDigits: 1 }) : "—"}
                      </td>
                      {/* Cost/min */}
                      <td className="px-3 py-3 text-right font-mono tabular-nums">
                        {row.costPerMin > 0 ? (
                          <span className="text-amber-400">{row.costPerMin.toFixed(5)}</span>
                        ) : "—"}
                      </td>
                      {/* Overall grade */}
                      <td className="px-3 py-3 text-center">
                        <GradeBadge grade={row.overallGrade} size="sm" />
                      </td>
                      {/* Expand */}
                      <td className="px-3 py-3 text-muted-foreground">
                        {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </td>
                    </tr>

                    {/* Expanded detail row */}
                    {isExpanded && (
                      <tr key={`${row.vendor}-detail`} className="bg-muted/10">
                        <td colSpan={10} className="px-6 py-4">
                          <div className="flex flex-wrap gap-8">
                            {/* Metric breakdown */}
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Metric Grades</p>
                              <div className="flex gap-3 flex-wrap">
                                {[
                                  { label: "ASR",      grade: row.asrGrade, val: `${row.asr.toFixed(1)}%` },
                                  { label: "ACD",      grade: row.acdGrade, val: row.acdSec > 0 ? fmtSec(row.acdSec) : "N/A" },
                                  { label: "PDD",      grade: row.pddGrade, val: row.avgPddSec > 0 ? `${row.avgPddSec.toFixed(2)}s` : "N/A" },
                                  { label: "Est. MOS", grade: row.mosGrade, val: row.mos != null ? row.mos.toFixed(2) : "N/A" },
                                ].map(m => (
                                  <div key={m.label} className="flex flex-col items-center gap-1 min-w-[70px]">
                                    <GradeBadge grade={m.grade} size="lg" />
                                    <span className="text-xs font-medium">{m.label}</span>
                                    <span className="text-xs text-muted-foreground font-mono">{m.val}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                            {/* Volume */}
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Volume</p>
                              <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                                <dt className="text-muted-foreground">Total Calls</dt><dd className="font-mono tabular-nums">{row.totalCalls.toLocaleString()}</dd>
                                <dt className="text-muted-foreground">Answered</dt><dd className="font-mono tabular-nums">{row.answeredCalls.toLocaleString()}</dd>
                                <dt className="text-muted-foreground">Total Minutes</dt><dd className="font-mono tabular-nums">{row.totalMinutes.toLocaleString(undefined, { maximumFractionDigits: 1 })}</dd>
                                <dt className="text-muted-foreground">Total Cost</dt><dd className="font-mono tabular-nums text-amber-400">{row.totalCost.toFixed(4)}</dd>
                                <dt className="text-muted-foreground">Cost / Min</dt><dd className="font-mono tabular-nums text-amber-400">{row.costPerMin > 0 ? row.costPerMin.toFixed(5) : "—"}</dd>
                              </dl>
                            </div>
                            {/* Top destinations */}
                            {row.topCountries.length > 0 && (
                              <div>
                                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                                  <Globe className="inline h-3 w-3 mr-1" />Top Destinations
                                </p>
                                <div className="flex flex-col gap-1">
                                  {row.topCountries.map(({ country, count }) => (
                                    <div key={country} className="flex items-center gap-2 text-xs">
                                      <div className="w-24 truncate text-muted-foreground">{country}</div>
                                      <div className="flex-1 min-w-[80px]">
                                        <div className="h-1.5 rounded-full bg-muted/30 overflow-hidden">
                                          <div
                                            className="h-full rounded-full bg-indigo-500/60"
                                            style={{ width: `${(count / row.topCountries[0].count) * 100}%` }}
                                          />
                                        </div>
                                      </div>
                                      <span className="font-mono tabular-nums w-8 text-right">{count}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        )}

        {/* Footer */}
        {data && (
          <div className="px-4 py-2.5 border-t border-border/30 bg-muted/10 flex items-center justify-between text-xs text-muted-foreground">
            <span data-testid="text-scorecard-footer">
              {data.total} vendor{data.total !== 1 ? "s" : ""} · {data.cdrCacheSize.toLocaleString()} CDRs in cache · last {hours}h window
            </span>
            {data.updatedAt && (
              <span>Cache updated {new Date(data.updatedAt).toLocaleTimeString()}</span>
            )}
          </div>
        )}
      </div>

      {/* MOS note */}
      <p className="text-xs text-muted-foreground/60">
        * Est. MOS is approximated from average PDD using a simplified E-model (ITU-T G.107).
        For accurate MOS, enable RTCP-XR reporting on your Sippy Softswitch.
        Overall grade weights ASR ×2 vs ACD, PDD, and MOS equally.
      </p>
    </div>
  );
}

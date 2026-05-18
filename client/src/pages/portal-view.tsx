import { useState } from "react";
import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Globe, Phone, TrendingUp, DollarSign, Clock,
  CheckCircle2, AlertTriangle, Download, BarChart3,
  RefreshCw, XCircle, CreditCard, FileText, Zap,
  Activity, Signal, Wifi,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface DailyEntry { date: string; calls: number; minutes: number; cost: number; }

interface PortalQuality {
  asr:      number;
  acd:      number;
  pdd:      number;
  mos:      number;
  mosGrade: string;
  ner:      number | null;
  breakdown: {
    answered: number; failed: number; rna: number;
    subscriberSide: number; networkFail: number; total: number;
  };
}

interface PortalDestination {
  country: string; calls: number; minutes: number; asr: number; pct: number;
}

interface PortalData {
  accountName:    string;
  accountId:      string;
  cdrs:           Array<{
    caller?: string; callee?: string; startTime?: string;
    duration?: number; result?: string | number; cost?: number;
  }>;
  balance?:       number | null;
  creditLimit?:   number | null;
  currency?:      string | null;
  permissions?:   string[];
  totalCalls?:    number;
  connectedCalls?: number;
  totalMinutes?:  number;
  asr?:           number;
  totalBilling?:  number;
  ratePerMin?:    number;
  daily?:         DailyEntry[];
  quality?:       PortalQuality;
  destinations?:  PortalDestination[];
  error?:         string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDur(s?: number) {
  if (!s) return "—";
  const m = Math.floor(s / 60); const ss = s % 60;
  return `${m}:${String(ss).padStart(2, "0")}`;
}

function fmtMin(min: number) {
  return min >= 60
    ? `${(min / 60).toFixed(1)} hr`
    : `${min.toFixed(1)} min`;
}

function dateRangeStr(range: string): { startDate: string; endDate: string } {
  const now   = new Date();
  const end   = now.toISOString().slice(0, 19).replace("T", " ");
  const start = new Date(now);
  if (range === "today")    start.setHours(0, 0, 0, 0);
  else if (range === "7d")  start.setDate(start.getDate() - 7);
  else                      start.setDate(start.getDate() - 30);
  return { startDate: start.toISOString().slice(0, 19).replace("T", " "), endDate: end };
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv  = rows.map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ── Stat Card ─────────────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, sub, color }: {
  icon: any; label: string; value: string; sub?: string; color: string;
}) {
  return (
    <div className="bg-white dark:bg-card border border-gray-200 dark:border-border rounded-xl p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-gray-500 dark:text-muted-foreground">{label}</p>
          <p className={cn("text-2xl font-bold mt-1", color)}>{value}</p>
          {sub && <p className="text-[10px] text-gray-400 dark:text-muted-foreground/60 mt-0.5">{sub}</p>}
        </div>
        <div className="p-2.5 rounded-xl bg-gray-100 dark:bg-muted/30">
          <Icon className={cn("h-5 w-5", color)} />
        </div>
      </div>
    </div>
  );
}

// ── Mini Bar Chart ────────────────────────────────────────────────────────────

function MiniBarChart({ data, valueKey, color }: {
  data: DailyEntry[]; valueKey: "calls" | "minutes" | "cost"; color: string;
}) {
  if (!data.length) return <p className="text-xs text-gray-400 py-4 text-center">No data for this period.</p>;
  const max = Math.max(...data.map(d => d[valueKey]), 1);
  return (
    <div className="flex items-end gap-1 h-20 mt-2">
      {data.map(d => {
        const pct = (d[valueKey] / max) * 100;
        return (
          <div key={d.date} className="flex-1 flex flex-col items-center justify-end" title={`${d.date}: ${d[valueKey].toFixed(1)}`}>
            <div
              className={cn("w-full rounded-t transition-all", color)}
              style={{ height: `${Math.max(4, pct)}%` }}
            />
          </div>
        );
      })}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type Tab = "overview" | "calls" | "billing";

export default function PortalViewPage() {
  const params = useParams<{ token: string }>();
  const token  = params?.token ?? "";
  const [timeRange, setTimeRange] = useState("30d");
  const [tab, setTab] = useState<Tab>("overview");

  const { startDate, endDate } = dateRangeStr(timeRange);

  const { data, isLoading, isError, refetch } = useQuery<PortalData>({
    queryKey: ["/api/portal/view", token, timeRange],
    queryFn: () =>
      fetch(`/api/portal/view?token=${encodeURIComponent(token)}&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`)
        .then(async r => {
          const j = await r.json();
          if (!r.ok) throw new Error(j.error ?? "Access denied");
          return j;
        }),
    staleTime: 60_000,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-background flex items-center justify-center">
        <div className="text-center space-y-3">
          <RefreshCw className="h-8 w-8 text-blue-400 animate-spin mx-auto" />
          <p className="text-sm text-gray-500">Loading your portal…</p>
        </div>
      </div>
    );
  }

  if (isError || data?.error) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-background flex items-center justify-center">
        <div className="text-center space-y-4 max-w-sm">
          <div className="p-3 rounded-full bg-rose-500/10 w-fit mx-auto">
            <XCircle className="h-8 w-8 text-rose-400" />
          </div>
          <h1 className="text-xl font-bold">Access Denied</h1>
          <p className="text-sm text-gray-500">This portal link is invalid or has been revoked. Please contact your account manager for a new link.</p>
        </div>
      </div>
    );
  }

  const perms        = data?.permissions ?? ["cdrs", "usage", "billing"];
  const cdrs         = data?.cdrs ?? [];
  const currency     = data?.currency ?? "USD";
  const totalCalls   = data?.totalCalls   ?? cdrs.length;
  const connected    = data?.connectedCalls ?? cdrs.filter(c => (c.duration ?? 0) > 0).length;
  const asr          = data?.asr          ?? (totalCalls > 0 ? Math.round((connected / totalCalls) * 100) : 0);
  const totalMin     = data?.totalMinutes ?? cdrs.reduce((s, c) => s + (c.duration ?? 0), 0) / 60;
  const totalBilling = data?.totalBilling ?? 0;
  const ratePerMin   = data?.ratePerMin   ?? 0.025;
  const daily        = data?.daily        ?? [];
  const balance      = data?.balance;

  function handleExport() {
    downloadCsv(`cdrs-${timeRange}-${new Date().toISOString().slice(0, 10)}.csv`, [
      ["Time", "CLI", "CLD", "Duration", "Outcome", "Cost"],
      ...cdrs.map(r => [
        r.startTime ? new Date(r.startTime).toLocaleString() : "—",
        r.caller ?? "—", r.callee ?? "—",
        fmtDur(r.duration), (r.duration ?? 0) > 0 ? "connected" : "failed",
        (r.cost ?? 0).toFixed(4),
      ]),
    ]);
  }

  const balanceColor = balance == null ? "text-gray-400" : balance > 50 ? "text-emerald-500" : balance > 10 ? "text-amber-500" : "text-rose-500";
  const asrColor     = asr >= 60 ? "text-emerald-500" : asr >= 40 ? "text-amber-500" : "text-rose-500";

  const tabs: { id: Tab; label: string; icon: any; perm?: string }[] = [
    { id: "overview", label: "Overview",      icon: Zap },
    { id: "calls",    label: "Call History",  icon: Phone,      perm: "cdrs" },
    { id: "billing",  label: "Billing",       icon: CreditCard, perm: "billing" },
  ].filter(t => !t.perm || perms.includes(t.perm));

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-background">

      {/* ── Top bar ── */}
      <div className="bg-white dark:bg-card border-b border-gray-200 dark:border-border px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/20">
              <Globe className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <h1 className="text-base font-bold">{data?.accountName ?? "My Portal"}</h1>
              <p className="text-xs text-gray-400">Account #{data?.accountId} · Self-service portal</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select
              className="text-xs bg-gray-100 dark:bg-muted border border-gray-200 dark:border-border rounded-lg px-2 py-1.5 focus:outline-none"
              value={timeRange}
              onChange={e => setTimeRange(e.target.value)}
              data-testid="select-time-range"
            >
              <option value="today">Today</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
            </select>
            <Button variant="ghost" size="sm" onClick={() => refetch()} data-testid="btn-refresh">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">

        {/* ── Balance banner ── */}
        {balance != null && (
          <div className={cn(
            "rounded-xl border px-5 py-3 flex items-center justify-between",
            balance > 50 ? "bg-emerald-50 dark:bg-emerald-500/5 border-emerald-200 dark:border-emerald-500/20"
              : balance > 10 ? "bg-amber-50 dark:bg-amber-500/5 border-amber-200 dark:border-amber-500/20"
              : "bg-rose-50 dark:bg-rose-500/5 border-rose-200 dark:border-rose-500/20",
          )}>
            <div className="flex items-center gap-2">
              {balance <= 10 && <AlertTriangle className="h-4 w-4 text-rose-500" />}
              <span className="text-sm font-medium">
                Account Balance:{" "}
                <span className={cn("font-bold", balanceColor)}>${balance.toFixed(2)} {currency}</span>
              </span>
              {data?.creditLimit != null && (
                <span className="text-xs text-gray-400">/ ${data.creditLimit.toFixed(2)} limit</span>
              )}
            </div>
            {balance <= 10 && (
              <Badge className="bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/25 text-[10px]">Low Balance</Badge>
            )}
          </div>
        )}

        {/* ── Tabs ── */}
        <div className="flex border-b border-gray-200 dark:border-border gap-1">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              data-testid={`tab-${t.id}`}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
                tab === t.id
                  ? "border-blue-500 text-blue-600 dark:text-blue-400"
                  : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-foreground",
              )}
            >
              <t.icon className="h-4 w-4" />{t.label}
            </button>
          ))}
        </div>

        {/* ── Overview Tab ── */}
        {tab === "overview" && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <StatCard icon={Phone}      label="Total Calls"    value={totalCalls.toLocaleString()}  color="text-blue-500" />
              <StatCard icon={CheckCircle2} label="Connected"    value={connected.toLocaleString()}   color="text-emerald-500" />
              <StatCard icon={TrendingUp} label="ASR"            value={`${asr.toFixed(1)}%`}          color={asrColor} sub="Answer Seizure Ratio" />
              <StatCard icon={Clock}      label="Total Duration" value={fmtMin(totalMin)}             color="text-violet-500" />
            </div>

          {/* ── Quality Section ── */}
          {data?.quality && data.quality.breakdown.total > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-foreground flex items-center gap-2">
                <Activity className="h-4 w-4 text-violet-500" /> Call Quality Metrics
              </h3>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <div className="bg-white dark:bg-card border border-gray-200 dark:border-border rounded-xl p-4 shadow-sm text-center">
                  <p className="text-[10px] text-gray-500 dark:text-muted-foreground uppercase tracking-wide mb-1">ASR</p>
                  <p className={cn("text-xl font-bold",
                    data.quality.asr >= 70 ? "text-emerald-500" : data.quality.asr >= 50 ? "text-amber-500" : "text-rose-500"
                  )}>{data.quality.asr.toFixed(1)}%</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">Answer Rate</p>
                </div>

                <div className="bg-white dark:bg-card border border-gray-200 dark:border-border rounded-xl p-4 shadow-sm text-center">
                  <p className="text-[10px] text-gray-500 dark:text-muted-foreground uppercase tracking-wide mb-1">ACD</p>
                  <p className={cn("text-xl font-bold",
                    data.quality.acd >= 90 ? "text-emerald-500" : data.quality.acd >= 45 ? "text-amber-500" : "text-rose-500"
                  )}>
                    {data.quality.acd > 0
                      ? `${Math.floor(data.quality.acd / 60)}:${String(data.quality.acd % 60).padStart(2, "0")}`
                      : "—"}
                  </p>
                  <p className="text-[10px] text-gray-400 mt-0.5">Avg Call Duration</p>
                </div>

                <div
                  className="bg-white dark:bg-card border border-gray-200 dark:border-border rounded-xl p-4 shadow-sm text-center"
                  title="Network Effectiveness Ratio — measures whether calls reached their destination. High NER with low ASR means the called party is not answering, not a network problem."
                >
                  <p className="text-[10px] text-gray-500 dark:text-muted-foreground uppercase tracking-wide mb-1">NER ⓘ</p>
                  <p className={cn("text-xl font-bold",
                    data.quality.ner == null ? "text-gray-400"
                    : data.quality.ner >= 90 ? "text-emerald-500"
                    : data.quality.ner >= 80 ? "text-amber-500" : "text-rose-500"
                  )}>
                    {data.quality.ner != null ? `${data.quality.ner.toFixed(1)}%` : "—"}
                  </p>
                  <p className="text-[10px] text-gray-400 mt-0.5">Network Delivery</p>
                </div>

                <div className="bg-white dark:bg-card border border-gray-200 dark:border-border rounded-xl p-4 shadow-sm text-center">
                  <p className="text-[10px] text-gray-500 dark:text-muted-foreground uppercase tracking-wide mb-1">MOS</p>
                  <div className="flex items-baseline justify-center gap-1.5">
                    <p className={cn("text-xl font-bold",
                      data.quality.mos >= 4.0 ? "text-emerald-500" : data.quality.mos >= 3.5 ? "text-amber-500" : "text-rose-500"
                    )}>{data.quality.mos.toFixed(2)}</p>
                    <Badge className={cn("text-[10px] px-1 py-0 h-4",
                      data.quality.mosGrade === 'A' ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400"
                      : data.quality.mosGrade === 'B' ? "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400"
                      : data.quality.mosGrade === 'C' ? "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400"
                      : "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-400"
                    )}>Grade {data.quality.mosGrade}</Badge>
                  </div>
                  <p className="text-[10px] text-gray-400 mt-0.5">Voice Quality (est.)</p>
                </div>

                <div className="bg-white dark:bg-card border border-gray-200 dark:border-border rounded-xl p-4 shadow-sm text-center">
                  <p className="text-[10px] text-gray-500 dark:text-muted-foreground uppercase tracking-wide mb-1">PDD</p>
                  <p className={cn("text-xl font-bold",
                    data.quality.pdd < 2 ? "text-emerald-500" : data.quality.pdd < 4 ? "text-amber-500" : "text-rose-500"
                  )}>
                    {data.quality.pdd > 0 ? `${data.quality.pdd.toFixed(2)}s` : "—"}
                  </p>
                  <p className="text-[10px] text-gray-400 mt-0.5">Post-Dial Delay</p>
                </div>
              </div>

              <div className="bg-white dark:bg-card border border-gray-200 dark:border-border rounded-xl p-4 shadow-sm">
                <p className="text-xs font-medium text-gray-500 dark:text-muted-foreground mb-3">Call Breakdown</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center text-xs">
                  {[
                    { label: "Connected",     value: data.quality.breakdown.answered,       color: "text-emerald-600 dark:text-emerald-400" },
                    { label: "Not Answered",  value: data.quality.breakdown.rna,            color: "text-amber-600 dark:text-amber-400" },
                    { label: "Subscriber",    value: data.quality.breakdown.subscriberSide, color: "text-blue-600 dark:text-blue-400" },
                    { label: "Net Failure",   value: data.quality.breakdown.networkFail,    color: "text-rose-600 dark:text-rose-400" },
                  ].map(b => (
                    <div key={b.label}>
                      <p className={cn("text-lg font-bold", b.color)}>{b.value}</p>
                      <p className="text-gray-400 text-[10px]">{b.label}</p>
                    </div>
                  ))}
                </div>
              </div>

              {data.destinations && data.destinations.length > 0 && (
                <div className="bg-white dark:bg-card border border-gray-200 dark:border-border rounded-xl p-4 shadow-sm">
                  <p className="text-xs font-medium text-gray-500 dark:text-muted-foreground mb-3 flex items-center gap-1.5">
                    <Signal className="h-3.5 w-3.5" /> Traffic by Destination
                  </p>
                  <div className="space-y-2">
                    {data.destinations.map(d => (
                      <div key={d.country}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-gray-600 dark:text-foreground font-medium">{d.country}</span>
                          <span className="text-gray-400">{d.calls} calls · {d.pct}%</span>
                        </div>
                        <div className="h-1.5 bg-gray-100 dark:bg-muted/30 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-400 dark:bg-blue-500 rounded-full" style={{ width: `${d.pct}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

            {perms.includes("usage") && daily.length > 0 && (
              <div className="bg-white dark:bg-card border border-gray-200 dark:border-border rounded-xl p-5 shadow-sm">
                <div className="flex items-center gap-2 mb-1">
                  <BarChart3 className="h-4 w-4 text-blue-500" />
                  <h3 className="text-sm font-semibold">Daily Call Volume</h3>
                </div>
                <MiniBarChart data={daily} valueKey="calls" color="bg-blue-400 dark:bg-blue-500" />
              </div>
            )}

            {perms.includes("billing") && (
              <div className="bg-white dark:bg-card border border-gray-200 dark:border-border rounded-xl p-5 shadow-sm">
                <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-emerald-500" />Billing Summary
                </h3>
                <div className="grid grid-cols-3 gap-4 text-center">
                  {[
                    { label: "Minutes Used",    value: fmtMin(totalMin),                           color: "text-violet-600 dark:text-violet-400" },
                    { label: "Rate / Minute",   value: `$${ratePerMin.toFixed(4)}`,                color: "text-gray-800 dark:text-foreground" },
                    { label: "Estimated Total", value: `$${totalBilling.toFixed(2)} ${currency}`,  color: "text-emerald-600 dark:text-emerald-400" },
                  ].map(({ label, value, color }) => (
                    <div key={label}>
                      <p className="text-xs text-gray-500 dark:text-muted-foreground">{label}</p>
                      <p className={cn("text-xl font-bold mt-1", color)}>{value}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Call History Tab ── */}
        {tab === "calls" && perms.includes("cdrs") && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm text-gray-500">{cdrs.length} record{cdrs.length === 1 ? "" : "s"} in this period</p>
              <Button variant="outline" size="sm" onClick={handleExport} disabled={cdrs.length === 0} data-testid="btn-export-csv">
                <Download className="h-4 w-4 mr-1.5" />Export CSV
              </Button>
            </div>
            {cdrs.length === 0 ? (
              <div className="bg-white dark:bg-card border border-gray-200 dark:border-border rounded-xl p-8 text-center shadow-sm">
                <Phone className="h-8 w-8 text-gray-300 dark:text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-gray-500">No calls found for the selected time period.</p>
              </div>
            ) : (
              <div className="bg-white dark:bg-card border border-gray-200 dark:border-border rounded-xl overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 dark:bg-muted/30">
                      <tr>
                        {["Time", "CLI", "CLD", "Duration", "Outcome", "Cost"].map(h => (
                          <th key={h} className="px-4 py-2.5 text-left text-gray-500 dark:text-muted-foreground font-medium">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {cdrs.slice(0, 100).map((r, i) => {
                        const ok = (r.duration ?? 0) > 0;
                        return (
                          <tr key={i} className="border-t border-gray-100 dark:border-border/20 hover:bg-gray-50 dark:hover:bg-muted/10">
                            <td className="px-4 py-2 text-gray-400 font-mono whitespace-nowrap">
                              {r.startTime ? new Date(r.startTime).toLocaleString() : "—"}
                            </td>
                            <td className="px-4 py-2 font-mono text-gray-700 dark:text-foreground">{r.caller ?? "—"}</td>
                            <td className="px-4 py-2 font-mono text-gray-700 dark:text-foreground">{r.callee ?? "—"}</td>
                            <td className="px-4 py-2 font-mono">{fmtDur(r.duration)}</td>
                            <td className="px-4 py-2">
                              <span className={cn(
                                "px-1.5 py-0.5 rounded text-[10px] font-semibold",
                                ok ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400"
                                   : "bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400",
                              )}>
                                {ok ? "connected" : "failed"}
                              </span>
                            </td>
                            <td className="px-4 py-2 font-mono">${(r.cost ?? 0).toFixed(4)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {cdrs.length > 100 && (
                  <div className="px-4 py-2.5 border-t border-gray-100 dark:border-border/20 flex items-center justify-between">
                    <p className="text-xs text-gray-400">Showing 100 of {cdrs.length} — export CSV for all.</p>
                    <Button variant="ghost" size="sm" onClick={handleExport} className="text-xs">
                      <Download className="h-3.5 w-3.5 mr-1" />Export All
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Billing Tab ── */}
        {tab === "billing" && perms.includes("billing") && (
          <div className="space-y-5">
            <div className="grid grid-cols-3 gap-4">
              <StatCard icon={Clock}      label="Minutes Used"    value={fmtMin(totalMin)}              color="text-violet-500" />
              <StatCard icon={FileText}   label="Rate / Minute"   value={`$${ratePerMin.toFixed(4)}`}   color="text-blue-500" />
              <StatCard icon={DollarSign} label="Estimated Total" value={`$${totalBilling.toFixed(2)}`} sub={currency}
                color={totalBilling > 0 ? "text-emerald-500" : "text-gray-400"} />
            </div>

            {daily.length > 0 ? (
              <div className="bg-white dark:bg-card border border-gray-200 dark:border-border rounded-xl p-5 shadow-sm">
                <div className="flex items-center gap-2 mb-1">
                  <BarChart3 className="h-4 w-4 text-emerald-500" />
                  <h3 className="text-sm font-semibold">Daily Cost</h3>
                </div>
                <MiniBarChart data={daily} valueKey="cost" color="bg-emerald-400 dark:bg-emerald-500" />
                <div className="mt-5 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-500 dark:text-muted-foreground border-b border-gray-100 dark:border-border/40">
                        {["Date", "Calls", "Minutes", "Cost"].map(h => (
                          <th key={h} className={cn("pb-2 font-medium", h === "Date" ? "text-left" : "text-right")}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {daily.slice(-14).reverse().map(d => (
                        <tr key={d.date} className="border-t border-gray-50 dark:border-border/20">
                          <td className="py-1.5 font-mono">{d.date}</td>
                          <td className="py-1.5 text-right font-mono">{d.calls}</td>
                          <td className="py-1.5 text-right font-mono">{d.minutes.toFixed(1)}</td>
                          <td className="py-1.5 text-right font-mono text-emerald-600 dark:text-emerald-400">${d.cost.toFixed(4)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="bg-white dark:bg-card border border-gray-200 dark:border-border rounded-xl p-8 text-center shadow-sm">
                <p className="text-sm text-gray-400">No billing data for this period.</p>
              </div>
            )}

            <div className="bg-blue-50 dark:bg-blue-500/5 border border-blue-200 dark:border-blue-500/20 rounded-xl p-4 text-xs text-blue-700 dark:text-blue-300">
              <p className="font-medium mb-0.5">Billing Note</p>
              <p>Amounts shown are estimates based on your contracted rate of ${ratePerMin.toFixed(4)}/min. Final invoiced amounts may differ based on rounding, adjustments, or minimum charges. Contact your account manager for a formal invoice.</p>
            </div>
          </div>
        )}

        {/* ── Footer ── */}
        <p className="text-center text-xs text-gray-400 pb-4">
          Powered by Bitsauto Monitoring Platform · Data refreshes every 5 minutes
        </p>
      </div>
    </div>
  );
}

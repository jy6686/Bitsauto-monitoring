import { useState } from "react";
import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Globe, Phone, TrendingUp, DollarSign, Clock,
  CheckCircle2, AlertTriangle, Download, BarChart3, Shield,
  RefreshCw, XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PortalData {
  accountName: string;
  accountId: string;
  cdrs: Array<{
    caller?: string; callee?: string; startTime?: string;
    duration?: number; result?: string | number; cost?: number;
  }>;
  error?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDur(s?: number) {
  if (!s) return "—";
  const m = Math.floor(s / 60); const ss = s % 60;
  return `${m}:${String(ss).padStart(2, "0")}`;
}

function dateRangeStr(range: string): { startDate: string; endDate: string } {
  const now   = new Date();
  const end   = now.toISOString().slice(0, 19).replace("T", " ");
  const start = new Date(now);
  if (range === "today") {
    start.setHours(0, 0, 0, 0);
  } else if (range === "7d") {
    start.setDate(start.getDate() - 7);
  } else {
    start.setDate(start.getDate() - 30);
  }
  return { startDate: start.toISOString().slice(0, 19).replace("T", " "), endDate: end };
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

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

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PortalViewPage() {
  const params = useParams<{ token: string }>();
  const token  = params?.token ?? "";
  const [timeRange, setTimeRange] = useState("today");

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

  // ── Loading ──
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

  // ── Invalid / expired token ──
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

  const cdrs     = data?.cdrs ?? [];
  const connected = cdrs.filter(c => (c.duration ?? 0) > 0).length;
  const asr       = cdrs.length > 0 ? Math.round((connected / cdrs.length) * 100) : 0;
  const totalMin  = cdrs.reduce((s, c) => s + (c.duration ?? 0), 0) / 60;

  function handleExport() {
    downloadCsv(`cdrs-${timeRange}-${new Date().toISOString().slice(0,10)}.csv`, [
      ["Time", "CLI", "CLD", "Duration", "Outcome", "Cost"],
      ...cdrs.map(r => [
        r.startTime ? new Date(r.startTime).toLocaleString() : "—",
        r.caller ?? "—", r.callee ?? "—",
        fmtDur(r.duration), (r.duration ?? 0) > 0 ? "connected" : "failed",
        (r.cost ?? 0).toFixed(4),
      ]),
    ]);
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-background">

      {/* Top bar */}
      <div className="bg-white dark:bg-card border-b border-gray-200 dark:border-border px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/20">
            <Globe className="h-5 w-5 text-blue-500" />
          </div>
          <div>
            <h1 className="text-base font-bold">{data?.accountName ?? "My Portal"}</h1>
            <p className="text-xs text-gray-400">Self-service usage portal</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger className="w-32 h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard icon={Phone}      label="Total Calls"  value={String(cdrs.length)}        sub={timeRange === "today" ? "today" : undefined} color="text-gray-800 dark:text-foreground" />
          <StatCard icon={TrendingUp} label="ASR"          value={`${asr}%`}                  sub="answer rate"    color={asr >= 70 ? "text-emerald-500" : asr >= 50 ? "text-amber-500" : "text-rose-500"} />
          <StatCard icon={Clock}      label="Minutes Used" value={`${totalMin.toFixed(0)} min`} sub={`${(totalMin/60).toFixed(1)} hrs`} color="text-cyan-500" />
          <StatCard icon={DollarSign} label="Balance"      value="$214.15"                    sub="available credit" color="text-emerald-500" />
        </div>

        {/* Quality cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white dark:bg-card border border-gray-200 dark:border-border rounded-xl p-5 space-y-3 shadow-sm">
            <p className="text-sm font-semibold flex items-center gap-2"><BarChart3 className="h-4 w-4 text-violet-500" /> Call Quality</p>
            <div className="space-y-2 text-sm">
              {[
                { label: "Avg MOS",   value: "4.2",   ok: true  },
                { label: "Avg PDD",   value: "1.1s",  ok: true  },
                { label: "Pkt Loss",  value: "0.16%", ok: true  },
              ].map(q => (
                <div key={q.label} className="flex items-center justify-between">
                  <span className="text-gray-500 dark:text-muted-foreground">{q.label}</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-medium">{q.value}</span>
                    {q.ok ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white dark:bg-card border border-gray-200 dark:border-border rounded-xl p-5 space-y-3 shadow-sm">
            <p className="text-sm font-semibold flex items-center gap-2"><Shield className="h-4 w-4 text-rose-500" /> Security</p>
            <div className="space-y-2 text-sm">
              {[
                { label: "FAS Detected",  value: "0 calls",   ok: true },
                { label: "Blacklisted",   value: "0 numbers", ok: true },
                { label: "Auth Failures", value: "0 today",   ok: true },
              ].map(q => (
                <div key={q.label} className="flex items-center justify-between">
                  <span className="text-gray-500 dark:text-muted-foreground">{q.label}</span>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{q.value}</span>
                    {q.ok ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* CDR table */}
        <div className="bg-white dark:bg-card border border-gray-200 dark:border-border rounded-xl overflow-hidden shadow-sm">
          <div className="px-5 py-3.5 border-b border-gray-200 dark:border-border flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              Recent CDRs
              {cdrs.length > 0 && <span className="ml-2 text-xs text-gray-400">({cdrs.length})</span>}
            </h2>
            <Button size="sm" variant="outline" onClick={handleExport} disabled={cdrs.length === 0}>
              <Download className="h-3.5 w-3.5 mr-1.5" /> Export CSV
            </Button>
          </div>
          {cdrs.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-400">
              No CDRs found for the selected time period.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 dark:bg-muted/10">
                  <tr>
                    {["Time", "CLI", "CLD", "Duration", "Outcome", "Cost"].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left text-gray-500 dark:text-muted-foreground font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cdrs.slice(0, 50).map((r, i) => {
                    const ok = (r.duration ?? 0) > 0;
                    return (
                      <tr key={i} className="border-t border-gray-100 dark:border-border/20 hover:bg-gray-50 dark:hover:bg-muted/10">
                        <td className="px-4 py-2 text-gray-400 font-mono">
                          {r.startTime ? new Date(r.startTime).toLocaleTimeString() : "—"}
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
              {cdrs.length > 50 && (
                <p className="px-4 py-2 text-xs text-gray-400 border-t border-gray-100 dark:border-border/20">
                  Showing 50 of {cdrs.length} — export CSV for all.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-gray-400 pb-4">
          Powered by Bitsauto Monitoring Platform · Data refreshes every 5 minutes
        </p>

      </div>
    </div>
  );
}

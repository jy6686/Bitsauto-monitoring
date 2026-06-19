import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useLocation, useSearch } from "wouter";
import {
  Server, Wifi, WifiOff, AlertTriangle, CheckCircle, Clock, RefreshCw,
  Activity, HardDrive, Cpu, MemoryStick, Radio, Bell, Trash2, Plus,
  TrendingDown, Shield, ShieldAlert, Database, ArrowUp, ArrowDown, Minus,
  BarChart2 as BarChartIcon, Table2, PlusCircle, Pencil, Mail,
  LayoutDashboard, ExternalLink, Settings2, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, BarChart, Bar, Cell, Legend
} from "recharts";
import { BseTooltip, BSE_GRID_PROPS, BSE_AXIS_PROPS, BSE_CURSOR, BseGradStops } from "@/components/bse-chart";
import type { AlertRule } from "@shared/schema";

const TABS = [
  { id: "reachability",  label: "Reachability",    icon: Wifi },
  { id: "bandwidth",     label: "Bandwidth",        icon: Activity },
  { id: "disk-memory",   label: "Disk & Memory",    icon: HardDrive },
  { id: "carrier-asr",   label: "Carrier ASR",      icon: TrendingDown },
  { id: "alert-rules",   label: "Alert Rules",      icon: Bell },
  { id: "registrations", label: "Reg Storm",        icon: Radio },
  { id: "sip-options",   label: "SIP Trunk Health", icon: Shield },
  { id: "grafana",       label: "Grafana Graphs",   icon: LayoutDashboard },
] as const;

type TabId = typeof TABS[number]["id"];

function fmtDuration(secs: number | null | undefined) {
  if (!secs) return "—";
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
}

function fmtTs(ts: string | Date | null | undefined) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function statSummary(vals: number[]) {
  if (!vals.length) return { min: 0, max: 0, avg: 0, latest: 0 };
  return {
    min: Math.min(...vals),
    max: Math.max(...vals),
    avg: parseFloat((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2)),
    latest: vals[vals.length - 1],
  };
}

// ── Shared view-mode toggle ────────────────────────────────────────────────────
function ViewToggle({ view, setView }: { view: "chart" | "table" | "both"; setView: (v: "chart" | "table" | "both") => void }) {
  return (
    <div className="flex items-center gap-0.5 bg-muted/20 rounded-lg p-0.5 border border-border/40">
      {(["both", "chart", "table"] as const).map(v => (
        <button
          key={v}
          onClick={() => setView(v)}
          className={cn(
            "flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md transition-colors",
            view === v ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          )}
          data-testid={`view-${v}`}
        >
          {v === "chart" && <BarChartIcon className="w-3 h-3" />}
          {v === "table" && <Table2 className="w-3 h-3" />}
          {v === "both"  && <><BarChartIcon className="w-3 h-3" /><Table2 className="w-3 h-3" /></>}
          <span className="capitalize">{v === "both" ? "Both" : v}</span>
        </button>
      ))}
    </div>
  );
}

// ── Stat badge row ─────────────────────────────────────────────────────────────
function StatRow({ items }: { items: { label: string; value: string | number; color?: string }[] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
      {items.map((s, i) => (
        <div key={i} className="rounded-lg border border-border/40 bg-muted/10 px-4 py-2.5">
          <p className="text-xs text-muted-foreground">{s.label}</p>
          <p className={cn("text-base font-bold tabular-nums mt-0.5", s.color ?? "text-foreground")}>{s.value}</p>
        </div>
      ))}
    </div>
  );
}

// ── Host type badge colours ────────────────────────────────────────────────────
const HOST_TYPE_COLOR: Record<string, string> = {
  vendor:  "bg-violet-500/15 text-violet-400",
  carrier: "bg-blue-500/15 text-blue-400",
  server:  "bg-amber-500/15 text-amber-400",
};

// ── Reachability Tab ───────────────────────────────────────────────────────────
function ReachabilityTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [view, setView] = useState<"chart" | "table" | "both">("both");
  const [showAddForm, setShowAddForm] = useState(false);
  const [editHost, setEditHost] = useState<null | { id: number; label: string; ip: string; type: string; ports: string; notifyEmail: string }>(null);
  const [form, setForm] = useState({ label: "", ip: "", type: "vendor", ports: "", notifyEmail: "" });
  const [selectedHostId, setSelectedHostId] = useState<number | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  // Live diagnostics — only fetched on demand
  const { data: diagData, isLoading: diagLoading, refetch: refetchDiag } = useQuery<{
    host: string;
    summary: string;
    ts: string;
    checks: { name: string; ok: boolean; latencyMs?: number; detail: string }[];
  }>({
    queryKey: ["/api/monitoring/diagnostics"],
    enabled: showDiagnostics,
    staleTime: 0,
    refetchInterval: showDiagnostics ? 30000 : false,
  });

  const { data, isLoading, refetch, isRefetching } = useQuery<{
    up: boolean; checkedAt: string; cause?: string; uptimePct: number;
    monitoredHost?: string;
    outageLog: { id: number; downAt: string; recoveredAt?: string; durationSec?: number; cause?: string }[];
  }>({
    queryKey: ["/api/monitoring/status"],
    refetchInterval: 15000,
    staleTime: 0,
  });

  // Monitored hosts list with live probe status
  const { data: hostsData, refetch: refetchHosts } = useQuery<{
    hosts: Array<{
      id: number; label: string; ip: string; type: string; ports: string | null;
      notifyEmail: string | null; enabled: boolean; createdAt: string;
      status: { up: boolean | null; latency?: number; port?: number; cause?: string; checkedAt: Date | null };
    }>
  }>({
    queryKey: ["/api/monitoring/hosts"],
    refetchInterval: 30000,
    staleTime: 0,
  });

  // Per-host outage log
  const { data: hostOutagesData } = useQuery<{
    outageLog: { id: number; hostId: number; hostLabel: string; hostIp: string; downAt: string; recoveredAt?: string; durationSec?: number; cause?: string }[];
  }>({
    queryKey: ["/api/monitoring/hosts/outages/all"],
    refetchInterval: 30000,
    staleTime: 0,
  });

  const createHost = useMutation({
    mutationFn: (body: typeof form) => apiRequest("POST", "/api/monitoring/hosts", body),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/monitoring/hosts"] }); setShowAddForm(false); setForm({ label: "", ip: "", type: "vendor", ports: "", notifyEmail: "" }); toast({ title: "Host added", description: "Monitoring will begin within 60 seconds." }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateHost = useMutation({
    mutationFn: ({ id, ...body }: { id: number } & Partial<typeof form>) => apiRequest("PUT", `/api/monitoring/hosts/${id}`, body),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/monitoring/hosts"] }); setEditHost(null); toast({ title: "Host updated" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteHost = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/monitoring/hosts/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/monitoring/hosts"] }); queryClient.invalidateQueries({ queryKey: ["/api/monitoring/hosts/outages/all"] }); toast({ title: "Host removed" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const toggleHost = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) => apiRequest("PUT", `/api/monitoring/hosts/${id}`, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/monitoring/hosts"] }),
  });

  // Build daily uptime chart from outage log (last 7 days)
  const dailyUptime = (() => {
    const days: { day: string; pct: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const label = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      const dayMs = 86_400_000;
      const dayStart = new Date(d.toDateString()).getTime();
      const dayEnd   = dayStart + dayMs;
      const downMs = (data?.outageLog ?? []).reduce((acc, e) => {
        const from = new Date(e.downAt).getTime();
        const to   = e.recoveredAt ? new Date(e.recoveredAt).getTime() : Date.now();
        const overlap = Math.max(0, Math.min(to, dayEnd) - Math.max(from, dayStart));
        return acc + overlap;
      }, 0);
      days.push({ day: label, pct: parseFloat((100 - (downMs / dayMs) * 100).toFixed(2)) });
    }
    return days;
  })();

  const totalOutages   = data?.outageLog?.length ?? 0;
  const totalDownSec   = (data?.outageLog ?? []).reduce((a, e) => a + (e.durationSec ?? 0), 0);
  const longestDownSec = Math.max(0, ...(data?.outageLog ?? []).map(e => e.durationSec ?? 0));

  return (
    <div className="space-y-5">
      {/* Status banner */}
      <div className={cn(
        "rounded-xl border p-5 flex items-center gap-4 flex-wrap",
        isLoading ? "border-border/50 bg-card"
        : data?.up ? "border-emerald-500/30 bg-emerald-500/5"
        : "border-rose-500/40 bg-rose-500/8 animate-pulse"
      )}>
        {isLoading ? <RefreshCw className="w-9 h-9 text-muted-foreground animate-spin" />
          : data?.up ? <CheckCircle className="w-9 h-9 text-emerald-400 flex-shrink-0" />
          : <WifiOff className="w-9 h-9 text-rose-400 flex-shrink-0" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <span className={cn("text-xl font-bold", isLoading ? "text-muted-foreground" : data?.up ? "text-emerald-400" : "text-rose-400")}>
              {isLoading ? "Checking…" : data?.up ? "Sippy Server ONLINE" : "Sippy Server OFFLINE"}
            </span>
            {!isLoading && data?.up && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-mono font-bold">
                {data?.uptimePct ?? 100}% uptime (7d)
              </span>
            )}
            {!isLoading && !data?.up && data?.cause && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 font-mono">{data.cause}</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">Last checked: {fmtTs(data?.checkedAt)} · polls every 30 s</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {!isLoading && !data?.up && (
            <button
              onClick={() => { setShowDiagnostics(v => !v); if (!showDiagnostics) refetchDiag(); }}
              data-testid="button-run-diagnostics"
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-rose-500/15 text-rose-400 border border-rose-500/30 hover:bg-rose-500/25 transition-colors font-medium"
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              {showDiagnostics ? "Hide Diagnostics" : "Why is it down?"}
            </button>
          )}
          <button onClick={() => refetch()} disabled={isRefetching}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border/50 hover:bg-muted/30 transition-colors disabled:opacity-50"
            data-testid="button-refresh-reachability">
            <RefreshCw className={cn("w-3.5 h-3.5", isRefetching && "animate-spin")} />
            {isRefetching ? "Checking…" : "Check now"}
          </button>
        </div>
      </div>

      {/* ── Diagnostics Panel ────────────────────────────────────────────────── */}
      {showDiagnostics && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-3 border-b border-rose-500/20 bg-rose-500/8">
            <AlertTriangle className="w-4 h-4 text-rose-400" />
            <h3 className="text-sm font-semibold text-rose-300">Live Diagnostics — {diagData?.host ?? "Sippy Server"}</h3>
            <button onClick={() => refetchDiag()} disabled={diagLoading} className="ml-auto text-xs px-2 py-1 rounded border border-rose-500/30 hover:bg-rose-500/20 text-rose-400 flex items-center gap-1 transition-colors">
              <RefreshCw className={cn("w-3 h-3", diagLoading && "animate-spin")} />
              Re-run
            </button>
          </div>

          {diagLoading && !diagData ? (
            <div className="px-5 py-8 text-center text-muted-foreground text-sm">
              <RefreshCw className="w-5 h-5 mx-auto mb-2 animate-spin" />
              Running connectivity probes… (may take up to 15s)
            </div>
          ) : diagData ? (
            <div className="p-5 space-y-4">
              {/* Summary — color-coded by severity */}
              {(() => {
                const xmlOk = diagData.checks?.find((c: any) => c.name === 'XML-RPC API')?.ok;
                const httpOk = diagData.checks?.find((c: any) => c.name === 'HTTP portal')?.ok;
                const xmlAuthFailed = diagData.xmlAuthFailed;
                const isOperational = xmlOk;
                const isAuthWarn = !xmlOk && xmlAuthFailed;
                const isCritical = !xmlOk && !xmlAuthFailed;
                return (
                  <div className={cn(
                    "px-4 py-3 rounded-lg border",
                    isCritical ? "bg-rose-500/10 border-rose-500/30" :
                    isAuthWarn || (isOperational && !httpOk) ? "bg-amber-500/10 border-amber-500/30" :
                    "bg-emerald-500/10 border-emerald-500/30"
                  )}>
                    <p className={cn(
                      "text-sm font-medium",
                      isCritical ? "text-rose-300" :
                      isAuthWarn || (isOperational && !httpOk) ? "text-amber-300" :
                      "text-emerald-300"
                    )}>{diagData.summary}</p>
                    <p className="text-xs text-muted-foreground mt-1">Probed at {new Date(diagData.ts).toLocaleTimeString()}</p>
                  </div>
                );
              })()}

              {/* Per-check results */}
              <div className="space-y-2">
                {diagData.checks.map((c: any, i: number) => {
                  const isAuthWarnRow = c.name === 'XML-RPC API' && diagData.xmlAuthFailed && !c.ok;
                  return (
                  <div key={i} className={cn(
                    "flex items-start gap-3 px-4 py-3 rounded-lg border",
                    c.ok ? "border-emerald-500/20 bg-emerald-500/5" :
                    isAuthWarnRow ? "border-amber-500/20 bg-amber-500/5" :
                    "border-rose-500/20 bg-rose-500/5"
                  )} data-testid={`diag-check-${i}`}>
                    <div className={cn("mt-0.5 flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center",
                      c.ok ? "bg-emerald-500/20" : isAuthWarnRow ? "bg-amber-500/20" : "bg-rose-500/20")}>
                      {c.ok
                        ? <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                        : isAuthWarnRow
                          ? <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                          : <WifiOff className="w-3.5 h-3.5 text-rose-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{c.name}</span>
                        {c.ok && c.latencyMs !== undefined && (
                          <span className={cn("text-xs font-mono px-1.5 py-0.5 rounded",
                            c.latencyMs < 50 ? "bg-emerald-500/15 text-emerald-400" : c.latencyMs < 150 ? "bg-amber-500/15 text-amber-400" : "bg-rose-500/15 text-rose-400")}>
                            {c.latencyMs}ms
                          </span>
                        )}
                        <span className={cn("ml-auto text-xs font-bold px-2 py-0.5 rounded-full",
                          c.ok ? "bg-emerald-500/15 text-emerald-400" :
                          isAuthWarnRow ? "bg-amber-500/15 text-amber-400" :
                          "bg-rose-500/15 text-rose-400")}>
                          {c.ok ? "PASS" : isAuthWarnRow ? "WARN" : "FAIL"}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{c.detail}</p>
                    </div>
                  </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* Summary stats */}
      <StatRow items={[
        { label: "7-Day Uptime",    value: `${data?.uptimePct ?? 100}%`,     color: (data?.uptimePct ?? 100) >= 99 ? "text-emerald-400" : "text-amber-400" },
        { label: "Total Outages",   value: totalOutages,                      color: totalOutages === 0 ? "text-emerald-400" : "text-rose-400" },
        { label: "Total Down Time", value: fmtDuration(totalDownSec),         color: totalDownSec === 0 ? "text-emerald-400" : "text-amber-400" },
        { label: "Longest Outage",  value: fmtDuration(longestDownSec),       color: longestDownSec === 0 ? "text-emerald-400" : "text-rose-400" },
      ]} />

      {/* View toggle */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-muted-foreground">7-Day Uptime History</h3>
        <ViewToggle view={view} setView={setView} />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        {/* Chart */}
        {(view === "chart" || view === "both") && (
          <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-3 border-b border-border/40 bg-muted/10">
              <BarChartIcon className="w-3.5 h-3.5 text-emerald-400" />
              <h4 className="text-sm font-semibold">Daily Uptime % (bar chart)</h4>
            </div>
            <div className="p-5">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={dailyUptime} barCategoryGap="30%">
                  <CartesianGrid {...BSE_GRID_PROPS} />
                  <XAxis dataKey="day" {...BSE_AXIS_PROPS} />
                  <YAxis {...BSE_AXIS_PROPS} domain={[90, 100]} tickFormatter={v => `${v}%`} width={42} />
                  <Tooltip content={<BseTooltip formatter={(v) => [`${v}%`, 'Uptime']} />} cursor={BSE_CURSOR} />
                  <Bar dataKey="pct" radius={[4, 4, 0, 0]}>
                    {dailyUptime.map((d, i) => (
                      <Cell key={i} fill={d.pct >= 99.9 ? "#34d399" : d.pct >= 99 ? "#f59e0b" : "#f43f5e"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Table */}
        {(view === "table" || view === "both") && (
          <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-3 border-b border-border/40 bg-muted/10">
              <Table2 className="w-3.5 h-3.5 text-muted-foreground" />
              <h4 className="text-sm font-semibold">Daily Uptime % (table)</h4>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-muted/20 text-muted-foreground text-xs">
                <tr>
                  <th className="text-left px-4 py-2">Day</th>
                  <th className="text-right px-4 py-2">Uptime %</th>
                  <th className="text-right px-4 py-2">SLA</th>
                </tr>
              </thead>
              <tbody>
                {dailyUptime.map((d, i) => (
                  <tr key={i} className="border-t border-border/30 hover:bg-muted/20">
                    <td className="px-4 py-2.5 font-medium text-xs">{d.day}</td>
                    <td className={cn("px-4 py-2.5 text-right font-bold font-mono text-xs", d.pct >= 99.9 ? "text-emerald-400" : d.pct >= 99 ? "text-amber-400" : "text-rose-400")}>
                      {d.pct}%
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium",
                        d.pct >= 99.9 ? "bg-emerald-500/10 text-emerald-400"
                        : d.pct >= 99  ? "bg-amber-500/10 text-amber-400"
                        : "bg-rose-500/10 text-rose-400"
                      )}>
                        {d.pct >= 99.9 ? "5-Nines" : d.pct >= 99 ? "Good" : "Below SLA"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Sippy Outage log */}
      <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-3 border-b border-border/40 bg-muted/10">
          <Clock className="w-3.5 h-3.5 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Sippy Server — Outage Event Log</h3>
          <span className="text-xs text-muted-foreground ml-auto">last 30 events</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/20 text-muted-foreground text-xs">
              <tr>
                <th className="text-left px-4 py-2">#</th>
                <th className="text-left px-4 py-2">IP / Host</th>
                <th className="text-left px-4 py-2">Down At</th>
                <th className="text-left px-4 py-2">Recovered At</th>
                <th className="text-left px-4 py-2">Duration</th>
                <th className="text-left px-4 py-2">Cause</th>
                <th className="text-right px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {!data?.outageLog?.length ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground text-xs">No outages recorded — server has been continuously reachable</td></tr>
              ) : (
                data.outageLog.map((e, i) => (
                  <tr key={e.id} className="border-t border-border/30 hover:bg-muted/20">
                    <td className="px-4 py-2.5 text-xs text-muted-foreground font-mono">{i + 1}</td>
                    <td className="px-4 py-2.5">
                      {data.monitoredHost ? (
                        <button
                          onClick={() => { setShowDiagnostics(true); refetchDiag(); }}
                          title="Click to run live diagnostics"
                          className="inline-flex items-center gap-1.5 text-xs font-mono px-2 py-0.5 rounded bg-rose-500/10 text-rose-300 border border-rose-500/20 hover:bg-rose-500/20 hover:text-rose-200 transition-colors cursor-pointer"
                          data-testid="btn-diag-from-ip"
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-400 inline-block flex-shrink-0 animate-pulse" />
                          {data.monitoredHost}
                          <AlertTriangle className="w-3 h-3 ml-0.5 opacity-70" />
                        </button>
                      ) : <span className="text-xs text-muted-foreground/40">—</span>}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-rose-400">{fmtTs(e.downAt)}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-emerald-400">{e.recoveredAt ? fmtTs(e.recoveredAt) : <span className="text-rose-400 font-semibold">Still down</span>}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">{fmtDuration(e.durationSec)}</td>
                    <td className="px-4 py-2.5"><span className="text-xs px-2 py-0.5 rounded bg-muted/40 font-mono">{e.cause ?? "unknown"}</span></td>
                    <td className="px-4 py-2.5 text-right">
                      {e.recoveredAt
                        ? <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400">Resolved</span>
                        : <span className="text-xs px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 animate-pulse">Active</span>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Vendor / Carrier Multi-IP Monitoring ─────────────────────────────── */}
      <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-3 border-b border-border/40 bg-muted/10">
          <Wifi className="w-3.5 h-3.5 text-blue-400" />
          <h3 className="text-sm font-semibold">Vendor / Carrier IP Monitoring</h3>
          <span className="text-xs text-muted-foreground">· probed every 60 s</span>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => refetchHosts()} className="text-xs px-2 py-1 rounded border border-border/50 hover:bg-muted/30 transition-colors flex items-center gap-1">
              <RefreshCw className="w-3 h-3" /> Refresh
            </button>
            <button
              onClick={() => { setShowAddForm(v => !v); setEditHost(null); }}
              data-testid="button-add-host"
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 border border-blue-500/30 transition-colors font-medium"
            >
              <PlusCircle className="w-3.5 h-3.5" /> Add Host
            </button>
          </div>
        </div>

        {/* Add / Edit form */}
        {(showAddForm || editHost) && (
          <div className="px-5 py-4 border-b border-border/40 bg-muted/5 space-y-3">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {editHost ? "Edit Host" : "Add New Host"}
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Label *</label>
                <input
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500/50"
                  placeholder="e.g. Callntalk Gateway"
                  value={editHost ? editHost.label : form.label}
                  onChange={e => editHost ? setEditHost({...editHost, label: e.target.value}) : setForm({...form, label: e.target.value})}
                  data-testid="input-host-label"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">IP / Hostname *</label>
                <input
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500/50"
                  placeholder="e.g. 104.245.246.110"
                  value={editHost ? editHost.ip : form.ip}
                  onChange={e => editHost ? setEditHost({...editHost, ip: e.target.value}) : setForm({...form, ip: e.target.value})}
                  data-testid="input-host-ip"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Type</label>
                <select
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500/50"
                  value={editHost ? editHost.type : form.type}
                  onChange={e => editHost ? setEditHost({...editHost, type: e.target.value}) : setForm({...form, type: e.target.value})}
                  data-testid="select-host-type"
                >
                  <option value="vendor">Vendor</option>
                  <option value="carrier">Carrier</option>
                  <option value="server">Server</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Custom Ports <span className="opacity-50">(comma-separated)</span></label>
                <input
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500/50"
                  placeholder="5060,443,80 (optional)"
                  value={editHost ? editHost.ports : form.ports}
                  onChange={e => editHost ? setEditHost({...editHost, ports: e.target.value}) : setForm({...form, ports: e.target.value})}
                  data-testid="input-host-ports"
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-muted-foreground mb-1 block">Notify Email <span className="opacity-50">(alert on down/up)</span></label>
                <input
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500/50"
                  placeholder="vendor@example.com (optional)"
                  value={editHost ? editHost.notifyEmail : form.notifyEmail}
                  onChange={e => editHost ? setEditHost({...editHost, notifyEmail: e.target.value}) : setForm({...form, notifyEmail: e.target.value})}
                  data-testid="input-host-email"
                />
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => editHost
                  ? updateHost.mutate({ id: editHost.id, label: editHost.label, ip: editHost.ip, type: editHost.type, ports: editHost.ports, notifyEmail: editHost.notifyEmail })
                  : createHost.mutate(form)
                }
                disabled={createHost.isPending || updateHost.isPending}
                data-testid="button-save-host"
                className="flex items-center gap-1.5 text-xs px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors font-medium"
              >
                {(createHost.isPending || updateHost.isPending) ? <RefreshCw className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
                {editHost ? "Save Changes" : "Add Host"}
              </button>
              <button
                onClick={() => { setShowAddForm(false); setEditHost(null); }}
                className="text-xs px-4 py-2 rounded-lg border border-border/50 hover:bg-muted/30 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Host status cards */}
        <div className="p-4">
          {!hostsData?.hosts?.length ? (
            <div className="py-10 text-center text-muted-foreground">
              <Wifi className="w-8 h-8 mx-auto mb-2 opacity-20" />
              <p className="text-sm">No hosts added yet.</p>
              <p className="text-xs mt-1 opacity-60">Click <strong>Add Host</strong> to start monitoring vendor or carrier IPs.</p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {hostsData.hosts.map(host => {
                const st = host.status;
                const isUp   = st.up === true;
                const isDown = st.up === false;
                const isPending = st.up === null;
                return (
                  <div
                    key={host.id}
                    className={cn(
                      "rounded-xl border p-4 transition-all cursor-pointer",
                      !host.enabled ? "opacity-50 border-border/30 bg-card/50"
                      : isDown ? "border-rose-500/40 bg-rose-500/5"
                      : isUp   ? "border-emerald-500/25 bg-emerald-500/3"
                      : "border-border/50 bg-card",
                      selectedHostId === host.id && "ring-2 ring-blue-500/30"
                    )}
                    onClick={() => setSelectedHostId(selectedHostId === host.id ? null : host.id)}
                    data-testid={`card-host-${host.id}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide", HOST_TYPE_COLOR[host.type] ?? "bg-muted/30 text-muted-foreground")}>
                            {host.type}
                          </span>
                          <span className="font-semibold text-sm truncate">{host.label}</span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-1">
                          <span className="font-mono text-xs text-muted-foreground">{host.ip}</span>
                          {host.status.port && <span className="text-[10px] text-muted-foreground/50">:{host.status.port}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {/* Toggle enabled */}
                        <button
                          onClick={ev => { ev.stopPropagation(); toggleHost.mutate({ id: host.id, enabled: !host.enabled }); }}
                          title={host.enabled ? "Disable monitoring" : "Enable monitoring"}
                          className={cn("w-7 h-4 rounded-full transition-colors relative", host.enabled ? "bg-emerald-500/60" : "bg-muted/40")}
                          data-testid={`toggle-host-${host.id}`}
                        >
                          <span className={cn("absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-all", host.enabled ? "left-3.5" : "left-0.5")} />
                        </button>
                        {/* Edit */}
                        <button onClick={ev => { ev.stopPropagation(); setEditHost({ id: host.id, label: host.label, ip: host.ip, type: host.type, ports: host.ports ?? "", notifyEmail: host.notifyEmail ?? "" }); setShowAddForm(false); }} className="p-1.5 rounded hover:bg-muted/40 text-muted-foreground hover:text-foreground transition-colors" data-testid={`btn-edit-host-${host.id}`}>
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        {/* Delete */}
                        <button onClick={ev => { ev.stopPropagation(); if (confirm(`Remove "${host.label}"?`)) deleteHost.mutate(host.id); }} className="p-1.5 rounded hover:bg-rose-500/10 text-muted-foreground hover:text-rose-400 transition-colors" data-testid={`btn-delete-host-${host.id}`}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Status row */}
                    <div className="flex items-center gap-3 mt-3 flex-wrap">
                      {isPending && <span className="text-xs text-muted-foreground/50">Pending first probe…</span>}
                      {!isPending && (
                        <>
                          <span className={cn("inline-flex items-center gap-1.5 text-xs font-semibold",
                            isDown ? "text-rose-400" : "text-emerald-400")}>
                            <span className={cn("w-2 h-2 rounded-full", isDown ? "bg-rose-400 animate-pulse" : "bg-emerald-400")} />
                            {isDown ? "DOWN" : "UP"}
                          </span>
                          {isUp && st.latency !== undefined && (
                            <span className={cn("text-xs", st.latency < 50 ? "text-emerald-400" : st.latency < 150 ? "text-amber-400" : "text-rose-400")}>
                              {st.latency} ms
                            </span>
                          )}
                          {isDown && st.cause && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-muted/40 font-mono text-rose-300">{st.cause}</span>
                          )}
                          {st.checkedAt && (
                            <span className="text-[10px] text-muted-foreground/40 ml-auto">{fmtTs(st.checkedAt.toString())}</span>
                          )}
                        </>
                      )}
                      {host.notifyEmail && (
                        <span className="text-[10px] text-muted-foreground/40 flex items-center gap-1 ml-auto">
                          <Mail className="w-2.5 h-2.5" />{host.notifyEmail}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Per-host Outage Log ───────────────────────────────────────────────── */}
      {(hostOutagesData?.outageLog?.length ?? 0) > 0 && (
        <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-3 border-b border-border/40 bg-muted/10">
            <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
            <h3 className="text-sm font-semibold">Vendor / Carrier — Outage History</h3>
            <span className="text-xs text-muted-foreground ml-auto">last 100 events</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/20 text-muted-foreground text-xs">
                <tr>
                  <th className="text-left px-4 py-2">#</th>
                  <th className="text-left px-4 py-2">Host</th>
                  <th className="text-left px-4 py-2">IP</th>
                  <th className="text-left px-4 py-2">Down At</th>
                  <th className="text-left px-4 py-2">Recovered At</th>
                  <th className="text-left px-4 py-2">Duration</th>
                  <th className="text-right px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {hostOutagesData!.outageLog.map((e, i) => (
                  <tr key={e.id} className="border-t border-border/30 hover:bg-muted/20">
                    <td className="px-4 py-2.5 text-xs text-muted-foreground font-mono">{i + 1}</td>
                    <td className="px-4 py-2.5 text-xs font-medium">{e.hostLabel ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-1.5 text-xs font-mono px-2 py-0.5 rounded bg-rose-500/10 text-rose-300 border border-rose-500/20">
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-400 inline-block" />
                        {e.hostIp ?? "—"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-rose-400">{fmtTs(e.downAt)}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-emerald-400">{e.recoveredAt ? fmtTs(e.recoveredAt) : <span className="text-rose-400 font-semibold">Still down</span>}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">{fmtDuration(e.durationSec)}</td>
                    <td className="px-4 py-2.5 text-right">
                      {e.recoveredAt
                        ? <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400">Resolved</span>
                        : <span className="text-xs px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 animate-pulse">Active</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Bandwidth Tab ──────────────────────────────────────────────────────────────
function BandwidthTab() {
  const [view, setView] = useState<"chart" | "table" | "both">("both");
  const { data, isLoading, refetch, isRefetching } = useQuery<{ ok: boolean; points: any[]; error?: string }>({
    queryKey: ["/api/monitoring/bandwidth"],
    refetchInterval: 60000,
    staleTime: 0,
  });

  const chartData = (data?.points ?? []).map((p, i) => ({
    idx: i + 1,
    time: new Date(p.ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    bw: parseFloat(((p.col1 ?? p.bandwidth ?? p.cps ?? 0) / 1024).toFixed(2)),
    raw: p.col1 ?? p.bandwidth ?? p.cps ?? 0,
  }));

  const stats = statSummary(chartData.map(p => p.bw));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-cyan-400" />
          <h3 className="text-sm font-semibold">RTP Bandwidth — last 12 hours</h3>
          <span className="text-xs text-muted-foreground font-mono">(5-min intervals)</span>
        </div>
        <div className="flex items-center gap-2">
          <ViewToggle view={view} setView={setView} />
          <button onClick={() => refetch()} disabled={isRefetching}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border/50 hover:bg-muted/30 disabled:opacity-50"
            data-testid="button-refresh-bandwidth">
            <RefreshCw className={cn("w-3.5 h-3.5", isRefetching && "animate-spin")} />
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="h-48 flex items-center justify-center text-muted-foreground text-sm"><RefreshCw className="w-4 h-4 animate-spin mr-2" />Loading…</div>
      ) : !chartData.length ? (
        <div className="rounded-xl border border-border/50 bg-card p-10 flex flex-col items-center gap-3 text-muted-foreground">
          <Database className="w-10 h-10 opacity-20" />
          <p className="text-sm font-medium">No bandwidth data from Sippy monitoring graph</p>
          <p className="text-xs opacity-60">Requires Sippy v4.5+ with <code>bandwidth_total</code> monitoring enabled.</p>
        </div>
      ) : (
        <>
          <StatRow items={[
            { label: "Current",  value: `${stats.latest} KB/s`, color: "text-cyan-400" },
            { label: "Average",  value: `${stats.avg} KB/s` },
            { label: "Peak",     value: `${stats.max} KB/s`, color: "text-amber-400" },
            { label: "Minimum",  value: `${stats.min} KB/s` },
          ]} />

          <div className={cn("grid gap-5", view === "both" ? "xl:grid-cols-2" : "grid-cols-1")}>
            {/* Chart */}
            {(view === "chart" || view === "both") && (
              <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
                <div className="px-5 py-3 border-b border-border/40 bg-muted/10 flex items-center gap-2">
                  <BarChartIcon className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="text-sm font-semibold">Bandwidth Trend</span>
                </div>
                <div className="p-5">
                  <ResponsiveContainer width="100%" height={230}>
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient id="bwGrad" x1="0" y1="0" x2="0" y2="1">
                          <BseGradStops color="#06b6d4" />
                        </linearGradient>
                      </defs>
                      <CartesianGrid {...BSE_GRID_PROPS} />
                      <XAxis dataKey="time" {...BSE_AXIS_PROPS} interval="preserveStartEnd" />
                      <YAxis {...BSE_AXIS_PROPS} tickFormatter={v => `${v}KB/s`} width={58} />
                      <Tooltip content={<BseTooltip formatter={(v) => [`${v} KB/s`, 'Bandwidth']} />} cursor={BSE_CURSOR} />
                      <Area type="monotone" dataKey="bw" stroke="#06b6d4" strokeWidth={2.5} fill="url(#bwGrad)" dot={false} activeDot={bseActiveDot('#06b6d4')} strokeLinejoin="round" strokeLinecap="round" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Table */}
            {(view === "table" || view === "both") && (
              <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
                <div className="px-5 py-3 border-b border-border/40 bg-muted/10 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Table2 className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-sm font-semibold">Data Points ({chartData.length})</span>
                  </div>
                </div>
                <div className="overflow-y-auto max-h-[310px]">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/20 text-muted-foreground text-xs sticky top-0">
                      <tr>
                        <th className="text-left px-4 py-2">#</th>
                        <th className="text-left px-4 py-2">Time</th>
                        <th className="text-right px-4 py-2">KB/s</th>
                        <th className="text-right px-4 py-2">vs Avg</th>
                      </tr>
                    </thead>
                    <tbody>
                      {chartData.map(r => (
                        <tr key={r.idx} className="border-t border-border/30 hover:bg-muted/20">
                          <td className="px-4 py-2 text-xs text-muted-foreground font-mono">{r.idx}</td>
                          <td className="px-4 py-2 font-mono text-xs">{r.time}</td>
                          <td className={cn("px-4 py-2 text-right font-bold font-mono text-xs",
                            r.bw >= stats.max * 0.9 ? "text-rose-400" : r.bw >= stats.avg ? "text-cyan-400" : "text-muted-foreground"
                          )}>{r.bw}</td>
                          <td className="px-4 py-2 text-right">
                            {r.bw > stats.avg
                              ? <span className="inline-flex items-center gap-1 text-xs text-rose-400"><ArrowUp className="w-2.5 h-2.5" />{Math.abs(parseFloat((r.bw - stats.avg).toFixed(2)))}</span>
                              : r.bw < stats.avg
                              ? <span className="inline-flex items-center gap-1 text-xs text-emerald-400"><ArrowDown className="w-2.5 h-2.5" />{Math.abs(parseFloat((stats.avg - r.bw).toFixed(2)))}</span>
                              : <span className="text-xs text-muted-foreground"><Minus className="w-2.5 h-2.5 inline" /></span>
                            }
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-5 py-3 flex items-start gap-3">
        <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground">
          <span className="text-amber-400 font-medium">Note: </span>
          The <code>bandwidth_total</code> graph requires Sippy 4.5+. Contact Sippysoft to enable it if data is missing.
        </p>
      </div>
    </div>
  );
}

// ── Disk & Memory Tab ──────────────────────────────────────────────────────────
function DiskMemoryTab() {
  const [view, setView] = useState<"chart" | "table" | "both">("both");
  const { data, isLoading, refetch, isRefetching } = useQuery<{
    results: { type: string; ok: boolean; points: any[] }[]; error?: string;
  }>({
    queryKey: ["/api/monitoring/disk-memory"],
    refetchInterval: 60000,
    staleTime: 0,
  });

  const META: Record<string, { label: string; color: string; icon: any; unit: string }> = {
    disk_usage:   { label: "Disk Usage",    color: "#f59e0b", icon: HardDrive,   unit: "%" },
    cpu_load:     { label: "CPU Load",      color: "#a78bfa", icon: Cpu,         unit: "%" },
    memory_usage: { label: "Memory Usage",  color: "#34d399", icon: MemoryStick, unit: "%" },
  };

  const results = (data?.results ?? []).map(r => ({
    ...r,
    meta: META[r.type] ?? { label: r.type, color: "#6b7280", icon: Activity, unit: "" },
    chartData: r.points.map((p, i) => ({
      idx: i + 1,
      time: new Date(p.ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      val:  parseFloat((p.col1 ?? p.cps ?? 0).toFixed(1)),
    })),
  }));
  const hasData = results.some(r => r.points.length > 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <HardDrive className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-semibold">System Resources — last 12 hours</h3>
        </div>
        <div className="flex items-center gap-2">
          <ViewToggle view={view} setView={setView} />
          <button onClick={() => refetch()} disabled={isRefetching}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border/50 hover:bg-muted/30 disabled:opacity-50"
            data-testid="button-refresh-disk-memory">
            <RefreshCw className={cn("w-3.5 h-3.5", isRefetching && "animate-spin")} />
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="h-48 flex items-center justify-center text-muted-foreground text-sm"><RefreshCw className="w-4 h-4 animate-spin mr-2" />Loading…</div>
      ) : !hasData ? (
        <div className="rounded-xl border border-border/50 bg-card p-10 flex flex-col items-center gap-3 text-muted-foreground">
          <HardDrive className="w-10 h-10 opacity-20" />
          <p className="text-sm font-medium">No disk/CPU/memory data from Sippy monitoring</p>
          <p className="text-xs opacity-60 text-center max-w-md">Requires <code>disk_usage</code>, <code>cpu_load</code>, <code>memory_usage</code> monitoring types in Sippy.</p>
          <button onClick={() => refetch()} disabled={isRefetching}
            className="mt-1 flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border/50 hover:bg-muted/30 disabled:opacity-50">
            <RefreshCw className={cn("w-3.5 h-3.5", isRefetching && "animate-spin")} />Retry
          </button>
        </div>
      ) : (
        results.filter(r => r.points.length > 0).map(r => {
          const s = statSummary(r.chartData.map(p => p.val));
          const alertLevel = s.latest > 85 ? "rose" : s.latest > 70 ? "amber" : "emerald";
          return (
            <div key={r.type} className="space-y-3">
              {/* Metric header */}
              <div className="flex items-center gap-2">
                <r.meta.icon className="w-4 h-4" style={{ color: r.meta.color }} />
                <h4 className="text-sm font-semibold">{r.meta.label}</h4>
                <span className={cn("ml-auto text-base font-bold tabular-nums",
                  alertLevel === "rose" ? "text-rose-400" : alertLevel === "amber" ? "text-amber-400" : "text-emerald-400"
                )}>{s.latest}{r.meta.unit}</span>
                {alertLevel === "rose" && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 font-medium animate-pulse">HIGH</span>
                )}
              </div>

              <StatRow items={[
                { label: "Current", value: `${s.latest}${r.meta.unit}`, color: alertLevel === "rose" ? "text-rose-400" : alertLevel === "amber" ? "text-amber-400" : "text-emerald-400" },
                { label: "Average", value: `${s.avg}${r.meta.unit}` },
                { label: "Peak",    value: `${s.max}${r.meta.unit}`, color: s.max > 85 ? "text-rose-400" : "text-foreground" },
                { label: "Min",     value: `${s.min}${r.meta.unit}` },
              ]} />

              <div className={cn("grid gap-5", view === "both" ? "xl:grid-cols-2" : "grid-cols-1")}>
                {(view === "chart" || view === "both") && (
                  <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
                    <div className="px-5 py-3 border-b border-border/40 bg-muted/10 flex items-center gap-2">
                      <BarChartIcon className="w-3.5 h-3.5" style={{ color: r.meta.color }} />
                      <span className="text-sm font-semibold">{r.meta.label} Trend</span>
                    </div>
                    <div className="p-5">
                      <ResponsiveContainer width="100%" height={180}>
                        <AreaChart data={r.chartData}>
                          <defs>
                            <linearGradient id={`grad-${r.type}`} x1="0" y1="0" x2="0" y2="1">
                              <BseGradStops color={r.meta.color} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid {...BSE_GRID_PROPS} />
                          <XAxis dataKey="time" {...BSE_AXIS_PROPS} interval="preserveStartEnd" />
                          <YAxis {...BSE_AXIS_PROPS} tickFormatter={v => `${v}${r.meta.unit}`} width={38} />
                          <Tooltip content={<BseTooltip formatter={(v) => [`${v}${r.meta.unit}`, r.meta.label]} />} cursor={BSE_CURSOR} />
                          <Area type="monotone" dataKey="val" stroke={r.meta.color} strokeWidth={2.5} fill={`url(#grad-${r.type})`} dot={false} activeDot={bseActiveDot(r.meta.color)} strokeLinejoin="round" strokeLinecap="round" />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                {(view === "table" || view === "both") && (
                  <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
                    <div className="px-5 py-3 border-b border-border/40 bg-muted/10 flex items-center gap-2">
                      <Table2 className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="text-sm font-semibold">Data Points ({r.chartData.length})</span>
                    </div>
                    <div className="overflow-y-auto max-h-[260px]">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/20 text-muted-foreground text-xs sticky top-0">
                          <tr>
                            <th className="text-left px-4 py-2">#</th>
                            <th className="text-left px-4 py-2">Time</th>
                            <th className="text-right px-4 py-2">Value</th>
                            <th className="text-right px-4 py-2">Level</th>
                          </tr>
                        </thead>
                        <tbody>
                          {r.chartData.map(row => {
                            const lvl = row.val > 85 ? "rose" : row.val > 70 ? "amber" : "emerald";
                            return (
                              <tr key={row.idx} className={cn("border-t border-border/30 hover:bg-muted/20", lvl === "rose" && "bg-rose-500/5")}>
                                <td className="px-4 py-1.5 text-xs text-muted-foreground font-mono">{row.idx}</td>
                                <td className="px-4 py-1.5 font-mono text-xs">{row.time}</td>
                                <td className={cn("px-4 py-1.5 text-right font-bold font-mono text-xs",
                                  lvl === "rose" ? "text-rose-400" : lvl === "amber" ? "text-amber-400" : "text-foreground"
                                )}>{row.val}{r.meta.unit}</td>
                                <td className="px-4 py-1.5 text-right">
                                  <span className={cn("text-xs px-2 py-0.5 rounded-full",
                                    lvl === "rose"   ? "bg-rose-500/10 text-rose-400"   :
                                    lvl === "amber"  ? "bg-amber-500/10 text-amber-400" :
                                    "bg-emerald-500/10 text-emerald-400"
                                  )}>
                                    {lvl === "rose" ? "High" : lvl === "amber" ? "Warn" : "OK"}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>

              {alertLevel === "rose" && (
                <div className="flex items-center gap-2 text-xs text-rose-400 bg-rose-500/10 px-4 py-2.5 rounded-lg border border-rose-500/20">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                  {r.meta.label} is critically high ({s.latest}%) — investigate immediately
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

// ── Carrier ASR Tab ────────────────────────────────────────────────────────────
function CarrierAsrTab() {
  const [view, setView] = useState<"chart" | "table" | "both">("both");
  const { data, isLoading, refetch, isRefetching } = useQuery<{
    carriers: { carrier: string; total: number; answered: number; asr: number; acd: number; alert: boolean }[];
    period: string; cdrs: number; error?: string;
  }>({
    queryKey: ["/api/monitoring/carrier-asr"],
    refetchInterval: 60000,
    staleTime: 0,
  });

  const carriers = data?.carriers ?? [];
  const alertCount = carriers.filter(c => c.alert).length;
  const avgAsr = carriers.length ? parseFloat((carriers.reduce((a, c) => a + c.asr, 0) / carriers.length).toFixed(1)) : 0;
  const totalCalls = carriers.reduce((a, c) => a + c.total, 0);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <TrendingDown className="w-4 h-4 text-violet-400" />
          <h3 className="text-sm font-semibold">Per-Carrier ASR &middot; {data?.period ?? "last 3 hours"}</h3>
          {(data?.cdrs ?? 0) > 0 && <span className="text-xs text-muted-foreground font-mono">{data?.cdrs} CDRs</span>}
        </div>
        <div className="flex items-center gap-2">
          <ViewToggle view={view} setView={setView} />
          <button onClick={() => refetch()} disabled={isRefetching}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border/50 hover:bg-muted/30 disabled:opacity-50"
            data-testid="button-refresh-carrier-asr">
            <RefreshCw className={cn("w-3.5 h-3.5", isRefetching && "animate-spin")} />
          </button>
        </div>
      </div>

      <StatRow items={[
        { label: "Carriers Tracked", value: carriers.length },
        { label: "Carriers Alerting", value: alertCount, color: alertCount > 0 ? "text-rose-400" : "text-emerald-400" },
        { label: "Average ASR",      value: `${avgAsr}%`, color: avgAsr >= 50 ? "text-emerald-400" : avgAsr >= 20 ? "text-amber-400" : "text-rose-400" },
        { label: "Total Calls",      value: totalCalls },
      ]} />

      {isLoading ? (
        <div className="h-40 flex items-center justify-center text-muted-foreground text-sm"><RefreshCw className="w-4 h-4 animate-spin mr-2" />Loading CDR data…</div>
      ) : !carriers.length ? (
        <div className="rounded-xl border border-border/50 bg-card p-10 flex flex-col items-center gap-2 text-muted-foreground">
          <Database className="w-8 h-8 opacity-20" />
          <p className="text-sm">No CDR data for the last 3 hours</p>
        </div>
      ) : (
        <div className={cn("grid gap-5", view === "both" ? "xl:grid-cols-2" : "grid-cols-1")}>
          {/* Bar chart */}
          {(view === "chart" || view === "both") && (
            <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
              <div className="px-5 py-3 border-b border-border/40 bg-muted/10 flex items-center gap-2">
                <BarChartIcon className="w-3.5 h-3.5 text-violet-400" />
                <span className="text-sm font-semibold">ASR per Carrier</span>
              </div>
              <div className="p-5">
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={carriers} layout="vertical" barCategoryGap="20%">
                    <CartesianGrid {...BSE_GRID_PROPS} horizontal={false} vertical={true} />
                    <XAxis type="number" domain={[0, 100]} {...BSE_AXIS_PROPS} tickFormatter={v => `${v}%`} />
                    <YAxis type="category" dataKey="carrier" {...BSE_AXIS_PROPS} width={80} />
                    <Tooltip content={<BseTooltip formatter={(v) => [`${v}%`, 'ASR']} />} cursor={BSE_CURSOR} />
                    <Bar dataKey="asr" radius={[0, 4, 4, 0]}>
                      {carriers.map((c, i) => (
                        <Cell key={i} fill={c.asr >= 50 ? "#34d399" : c.asr >= 20 ? "#f59e0b" : "#f43f5e"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                {/* ACD bar chart */}
                <p className="text-xs text-muted-foreground mt-4 mb-2 font-medium">ACD (Avg Call Duration) per Carrier</p>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={carriers} layout="vertical" barCategoryGap="20%">
                    <CartesianGrid {...BSE_GRID_PROPS} horizontal={false} vertical={true} />
                    <XAxis type="number" {...BSE_AXIS_PROPS} tickFormatter={v => `${v}s`} />
                    <YAxis type="category" dataKey="carrier" {...BSE_AXIS_PROPS} width={80} />
                    <Tooltip content={<BseTooltip formatter={(v) => [`${v}s`, 'ACD']} />} cursor={BSE_CURSOR} />
                    <Bar dataKey="acd" fill="#a78bfa" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Table */}
          {(view === "table" || view === "both") && (
            <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
              <div className="px-5 py-3 border-b border-border/40 bg-muted/10 flex items-center gap-2">
                <Table2 className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-sm font-semibold">Carrier Detail Table</span>
              </div>
              <div className="overflow-x-auto overflow-y-auto max-h-[480px]">
                <table className="w-full text-sm">
                  <thead className="bg-muted/20 text-muted-foreground text-xs sticky top-0">
                    <tr>
                      <th className="text-left px-4 py-2">Carrier</th>
                      <th className="text-right px-4 py-2">Calls</th>
                      <th className="text-right px-4 py-2">Ans</th>
                      <th className="text-right px-4 py-2">ASR</th>
                      <th className="text-right px-4 py-2">ACD</th>
                      <th className="text-right px-4 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {carriers.map((c, i) => (
                      <tr key={i} className={cn("border-t border-border/30 hover:bg-muted/20", c.alert && "bg-rose-500/5")}>
                        <td className="px-4 py-2.5 font-medium text-xs">{c.carrier}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs">{c.total}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs">{c.answered}</td>
                        <td className={cn("px-4 py-2.5 text-right font-bold font-mono text-xs",
                          c.asr >= 50 ? "text-emerald-400" : c.asr >= 20 ? "text-amber-400" : "text-rose-400"
                        )}>{c.asr}%</td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs">
                          {c.acd >= 60 ? `${Math.floor(c.acd/60)}m ${c.acd%60}s` : `${c.acd}s`}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {c.alert
                            ? <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 font-medium"><ShieldAlert className="w-3 h-3" />Alert</span>
                            : <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400"><CheckCircle className="w-3 h-3" />OK</span>
                          }
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="rounded-xl border border-border/40 bg-muted/10 px-5 py-3 text-xs text-muted-foreground">
        <Shield className="w-3.5 h-3.5 inline mr-1.5 text-violet-400" />
        Alert fires when ASR &lt; 20% with ≥ 10 calls. Data from Sippy CDRs grouped by termination party.
      </div>
    </div>
  );
}

// ── Alert Rules Tab ────────────────────────────────────────────────────────────
const METRIC_OPTIONS = [
  { value: "server_down",  label: "Server Down",              unit: "",    placeholder: "1 (always fires)" },
  { value: "asr_drop",     label: "ASR Drop (global %)",      unit: "%",   placeholder: "e.g. 30" },
  { value: "cps_spike",    label: "CPS Spike",                unit: "/s",  placeholder: "e.g. 50" },
  { value: "disk_full",    label: "Disk Usage",               unit: "%",   placeholder: "e.g. 85" },
  { value: "reg_storm",    label: "Registration Storm ratio", unit: "x",   placeholder: "e.g. 2" },
  { value: "bandwidth",    label: "Bandwidth (KB/s)",         unit: "KB/s",placeholder: "e.g. 1000" },
];

function AlertRulesTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: rules = [], isLoading } = useQuery<AlertRule[]>({
    queryKey: ["/api/monitoring/alert-rules"],
  });

  const [form, setForm] = useState({
    metric: "server_down", label: "", threshold: "", comparison: "gt",
    emailEnabled: false, webhookEnabled: false, webhookUrl: "",
  });
  const [showForm, setShowForm] = useState(false);

  const createMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/monitoring/alert-rules", {
      metric: form.metric,
      label: form.label || METRIC_OPTIONS.find(m => m.value === form.metric)?.label,
      threshold: parseFloat(form.threshold) || 1,
      comparison: form.comparison,
      emailEnabled: form.emailEnabled,
      webhookEnabled: form.webhookEnabled,
      webhookUrl: form.webhookUrl || null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/monitoring/alert-rules"] });
      setShowForm(false);
      setForm({ metric: "server_down", label: "", threshold: "", comparison: "gt", emailEnabled: false, webhookEnabled: false, webhookUrl: "" });
      toast({ title: "Alert rule created" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      apiRequest("PATCH", `/api/monitoring/alert-rules/${id}`, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/monitoring/alert-rules"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/monitoring/alert-rules/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/monitoring/alert-rules"] }); toast({ title: "Rule deleted" }); },
  });

  const selMeta = METRIC_OPTIONS.find(m => m.value === form.metric);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Alert Rules</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Configure thresholds for email / webhook notifications</p>
        </div>
        <button onClick={() => setShowForm(v => !v)}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-500 transition-colors"
          data-testid="button-add-alert-rule">
          <Plus className="w-3.5 h-3.5" />New Rule
        </button>
      </div>

      {showForm && (
        <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-5 space-y-4">
          <h4 className="text-sm font-semibold text-violet-400">New Alert Rule</h4>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Metric</label>
              <select value={form.metric} onChange={e => setForm(f => ({ ...f, metric: e.target.value }))}
                className="w-full bg-background border border-border/60 rounded-lg px-3 py-2 text-sm" data-testid="select-metric">
                {METRIC_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Label (optional)</label>
              <input value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                placeholder={selMeta?.label}
                className="w-full bg-background border border-border/60 rounded-lg px-3 py-2 text-sm" data-testid="input-alert-label" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Condition</label>
              <div className="flex gap-2">
                <select value={form.comparison} onChange={e => setForm(f => ({ ...f, comparison: e.target.value }))}
                  className="bg-background border border-border/60 rounded-lg px-3 py-2 text-sm" data-testid="select-comparison">
                  <option value="gt">Greater than (&gt;)</option>
                  <option value="lt">Less than (&lt;)</option>
                </select>
                <input value={form.threshold} onChange={e => setForm(f => ({ ...f, threshold: e.target.value }))}
                  placeholder={selMeta?.placeholder ?? "threshold"} type="number"
                  className="flex-1 bg-background border border-border/60 rounded-lg px-3 py-2 text-sm" data-testid="input-threshold" />
                {selMeta?.unit && <span className="flex items-center text-xs text-muted-foreground">{selMeta.unit}</span>}
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground block">Notification channels</label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={form.emailEnabled} onChange={e => setForm(f => ({ ...f, emailEnabled: e.target.checked }))} className="rounded" data-testid="checkbox-email" />
                Email (via Gmail SMTP in Settings)
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={form.webhookEnabled} onChange={e => setForm(f => ({ ...f, webhookEnabled: e.target.checked }))} className="rounded" data-testid="checkbox-webhook" />
                Webhook / Slack / Teams
              </label>
            </div>
            {form.webhookEnabled && (
              <div className="sm:col-span-2">
                <label className="text-xs text-muted-foreground mb-1 block">Webhook URL</label>
                <input value={form.webhookUrl} onChange={e => setForm(f => ({ ...f, webhookUrl: e.target.value }))}
                  placeholder="https://hooks.slack.com/services/…"
                  className="w-full bg-background border border-border/60 rounded-lg px-3 py-2 text-sm" data-testid="input-webhook-url" />
              </div>
            )}
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowForm(false)} className="text-xs px-3 py-1.5 rounded-lg border border-border/50 hover:bg-muted/30">Cancel</button>
            <button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}
              className="text-xs px-3 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-50" data-testid="button-save-alert-rule">
              {createMutation.isPending ? "Saving…" : "Save Rule"}
            </button>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
        {isLoading ? (
          <div className="py-10 text-center text-muted-foreground text-sm"><RefreshCw className="w-4 h-4 animate-spin inline mr-2" />Loading…</div>
        ) : !rules.length ? (
          <div className="py-10 text-center text-muted-foreground text-sm">
            <Bell className="w-8 h-8 opacity-20 mx-auto mb-2" />
            No alert rules yet. Create one to start receiving notifications.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/20 text-muted-foreground text-xs">
              <tr>
                <th className="text-left px-4 py-2">Rule</th>
                <th className="text-left px-4 py-2">Condition</th>
                <th className="text-left px-4 py-2">Channels</th>
                <th className="text-center px-4 py-2">Status</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rules.map(r => (
                <tr key={r.id} className="border-t border-border/30 hover:bg-muted/20">
                  <td className="px-4 py-3">
                    <p className="font-medium text-xs">{r.label ?? r.metric}</p>
                    <p className="text-xs text-muted-foreground font-mono">{r.metric}</p>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{r.comparison === "gt" ? ">" : "<"} {r.threshold}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1 flex-wrap">
                      {r.emailEnabled && <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400">Email</span>}
                      {r.webhookEnabled && <span className="text-xs px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-400">Webhook</span>}
                      {!r.emailEnabled && !r.webhookEnabled && <span className="text-xs text-muted-foreground">none</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button onClick={() => toggleMutation.mutate({ id: r.id, enabled: !r.enabled })}
                      className={cn("text-xs px-2 py-0.5 rounded-full font-medium transition-colors",
                        r.enabled ? "bg-emerald-500/10 text-emerald-400 hover:bg-rose-500/10 hover:text-rose-400"
                        : "bg-muted/40 text-muted-foreground hover:bg-emerald-500/10 hover:text-emerald-400"
                      )}
                      data-testid={`button-toggle-rule-${r.id}`}>
                      {r.enabled ? "Active" : "Paused"}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => deleteMutation.mutate(r.id)}
                      className="text-muted-foreground hover:text-rose-400 transition-colors"
                      data-testid={`button-delete-rule-${r.id}`}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── Registrations Tab ──────────────────────────────────────────────────────────
function RegistrationsTab() {
  const [view, setView] = useState<"chart" | "table" | "both">("both");
  const { data, isLoading, refetch, isRefetching } = useQuery<{
    ok: boolean; points: any[]; stormDetected: boolean; stormRatio: number; error?: string;
  }>({
    queryKey: ["/api/monitoring/registrations"],
    refetchInterval: 60000,
    staleTime: 0,
  });

  const chartData = (data?.points ?? []).map((p, i) => ({
    idx: i + 1,
    time: new Date(p.ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    regs: p.col1 ?? p.cps ?? 0,
  }));

  const stats = statSummary(chartData.map(p => p.regs));

  return (
    <div className="space-y-5">
      {data?.stormDetected && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/8 px-5 py-4 flex items-center gap-3 animate-pulse">
          <AlertTriangle className="w-5 h-5 text-rose-400 flex-shrink-0" />
          <div>
            <p className="text-sm font-bold text-rose-400">Registration Storm Detected!</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Current rate is <span className="text-rose-400 font-bold">{data.stormRatio}×</span> above recent average — possible brute-force or mass re-registration event.
            </p>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Radio className="w-4 h-4 text-cyan-400" />
          <h3 className="text-sm font-semibold">SIP Registration Events — last 6 hours</h3>
          {data?.stormDetected && <span className="text-xs px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 font-medium animate-pulse">STORM</span>}
        </div>
        <div className="flex items-center gap-2">
          <ViewToggle view={view} setView={setView} />
          <button onClick={() => refetch()} disabled={isRefetching}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border/50 hover:bg-muted/30 disabled:opacity-50"
            data-testid="button-refresh-registrations">
            <RefreshCw className={cn("w-3.5 h-3.5", isRefetching && "animate-spin")} />
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="h-40 flex items-center justify-center text-muted-foreground text-sm"><RefreshCw className="w-4 h-4 animate-spin mr-2" />Loading…</div>
      ) : !chartData.length ? (
        <div className="rounded-xl border border-border/50 bg-card p-10 flex flex-col items-center gap-2 text-muted-foreground">
          <Radio className="w-8 h-8 opacity-20" />
          <p className="text-sm">No SIP registration data from Sippy <code>sip_reg_total</code> monitoring graph</p>
        </div>
      ) : (
        <>
          <StatRow items={[
            { label: "Current (5-min)",  value: stats.latest, color: data?.stormDetected ? "text-rose-400" : "text-cyan-400" },
            { label: "Average",          value: stats.avg },
            { label: "Peak",             value: stats.max, color: stats.max > stats.avg * 2 ? "text-rose-400" : "text-foreground" },
            { label: "Storm Ratio",      value: `${data?.stormRatio ?? 0}×`, color: (data?.stormRatio ?? 0) > 2 ? "text-rose-400" : "text-emerald-400" },
          ]} />

          <div className={cn("grid gap-5", view === "both" ? "xl:grid-cols-2" : "grid-cols-1")}>
            {(view === "chart" || view === "both") && (
              <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
                <div className="px-5 py-3 border-b border-border/40 bg-muted/10 flex items-center gap-2">
                  <BarChartIcon className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="text-sm font-semibold">Registration Trend</span>
                </div>
                <div className="p-5">
                  <ResponsiveContainer width="100%" height={230}>
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient id="regGrad" x1="0" y1="0" x2="0" y2="1">
                          <BseGradStops color={data?.stormDetected ? "#f43f5e" : "#a78bfa"} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid {...BSE_GRID_PROPS} />
                      <XAxis dataKey="time" {...BSE_AXIS_PROPS} interval="preserveStartEnd" />
                      <YAxis {...BSE_AXIS_PROPS} width={36} />
                      <Tooltip content={<BseTooltip formatter={(v) => [v, 'Registrations']} />} cursor={BSE_CURSOR} />
                      <Area type="monotone" dataKey="regs" stroke={data?.stormDetected ? "#f43f5e" : "#a78bfa"} strokeWidth={2.5} fill="url(#regGrad)" dot={false} activeDot={bseActiveDot(data?.stormDetected ? "#f43f5e" : "#a78bfa")} strokeLinejoin="round" strokeLinecap="round" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {(view === "table" || view === "both") && (
              <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
                <div className="px-5 py-3 border-b border-border/40 bg-muted/10 flex items-center gap-2">
                  <Table2 className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-sm font-semibold">Data Points ({chartData.length})</span>
                </div>
                <div className="overflow-y-auto max-h-[310px]">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/20 text-muted-foreground text-xs sticky top-0">
                      <tr>
                        <th className="text-left px-4 py-2">#</th>
                        <th className="text-left px-4 py-2">Time</th>
                        <th className="text-right px-4 py-2">Registrations</th>
                        <th className="text-right px-4 py-2">vs Avg</th>
                      </tr>
                    </thead>
                    <tbody>
                      {chartData.map(r => {
                        const ratio = stats.avg > 0 ? r.regs / stats.avg : 0;
                        const isSpike = ratio > 2;
                        return (
                          <tr key={r.idx} className={cn("border-t border-border/30 hover:bg-muted/20", isSpike && "bg-rose-500/5")}>
                            <td className="px-4 py-2 text-xs text-muted-foreground font-mono">{r.idx}</td>
                            <td className="px-4 py-2 font-mono text-xs">{r.time}</td>
                            <td className={cn("px-4 py-2 text-right font-bold font-mono text-xs", isSpike ? "text-rose-400" : r.regs >= stats.avg ? "text-cyan-400" : "text-muted-foreground")}>
                              {r.regs}
                            </td>
                            <td className="px-4 py-2 text-right">
                              {isSpike
                                ? <span className="inline-flex items-center gap-1 text-xs text-rose-400 font-bold"><ArrowUp className="w-2.5 h-2.5" />{ratio.toFixed(1)}×</span>
                                : r.regs > stats.avg
                                ? <span className="inline-flex items-center gap-1 text-xs text-amber-400"><ArrowUp className="w-2.5 h-2.5" /></span>
                                : <span className="inline-flex items-center gap-1 text-xs text-emerald-400"><ArrowDown className="w-2.5 h-2.5" /></span>
                              }
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      <div className="rounded-xl border border-border/40 bg-muted/10 px-5 py-3 text-xs text-muted-foreground">
        <Shield className="w-3.5 h-3.5 inline mr-1.5 text-cyan-400" />
        Storm detection fires when current 5-min count exceeds 2× the 5-minute moving average and is above 10 registrations.
      </div>
    </div>
  );
}

// ── SIP OPTIONS / Trunk Health Tab ─────────────────────────────────────────────
type SipOption = {
  host: string;
  port: number;
  status: "up" | "down" | "timeout";
  rttMs: number | null;
  probeTs: string | null;
  responseCode: number | null;
};

function SipOptionsTab() {
  const { data, isLoading, refetch, isFetching, dataUpdatedAt } = useQuery<SipOption[]>({
    queryKey: ["/api/monitoring/sip-options"],
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });

  const results = data ?? [];
  const upCount   = results.filter(r => r.status === "up").length;
  const downCount = results.filter(r => r.status === "down").length;
  const toCount   = results.filter(r => r.status === "timeout").length;
  const updatedAt = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : null;

  return (
    <div className="space-y-5">
      {/* Summary row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-card border border-border rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-emerald-400">{upCount}</div>
          <div className="text-xs text-muted-foreground mt-0.5">Trunks Up</div>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-red-400">{downCount}</div>
          <div className="text-xs text-muted-foreground mt-0.5">Trunks Down</div>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-amber-400">{toCount}</div>
          <div className="text-xs text-muted-foreground mt-0.5">Timeout</div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm font-medium flex items-center gap-2">
          <Shield className="h-4 w-4 text-blue-400" />
          SIP OPTIONS Probe Results
          {updatedAt && <span className="text-xs text-muted-foreground">— polled at {updatedAt}</span>}
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          data-testid="btn-refresh-sip-options"
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-lg border border-border hover:bg-muted/40 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
          {isFetching ? "Probing…" : "Re-probe"}
        </button>
      </div>

      {isLoading ? (
        <div className="text-center text-muted-foreground py-12">Probing SIP trunks…</div>
      ) : results.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-8 text-center text-muted-foreground">
          <Shield className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <div className="font-medium mb-1">No SIP hosts configured</div>
          <div className="text-sm">Add Sippy switch IPs in Settings → Switches. The monitor probes each IP on port 5060.</div>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="px-4 py-3 text-left">Host / IP</th>
                <th className="px-4 py-3 text-left">Port</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-right">RTT</th>
                <th className="px-4 py-3 text-right">SIP Code</th>
                <th className="px-4 py-3 text-right">Last Probe</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={i} className="border-b border-border/40 hover:bg-muted/20 transition-colors" data-testid={`row-sip-${r.host}`}>
                  <td className="px-4 py-3 font-mono text-xs">{r.host}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{r.port}</td>
                  <td className="px-4 py-3">
                    {r.status === "up" ? (
                      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                        <CheckCircle className="h-3 w-3" /> UP
                      </span>
                    ) : r.status === "down" ? (
                      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/30">
                        <WifiOff className="h-3 w-3" /> DOWN
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">
                        <Clock className="h-3 w-3" /> TIMEOUT
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs">
                    {r.rttMs != null ? `${r.rttMs} ms` : "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground">
                    {r.responseCode ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                    {r.probeTs ? fmtTs(r.probeTs) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="rounded-xl border border-border/40 bg-muted/10 px-5 py-3 text-xs text-muted-foreground">
        <Shield className="w-3.5 h-3.5 inline mr-1.5 text-blue-400" />
        SIP OPTIONS probes use TCP on port 5060. Any SIP/2.0 response (200, 405, 404, etc.) is counted as UP. No response within 5 s = TIMEOUT. Probes run every 60 s.
      </div>
    </div>
  );
}

// ── Grafana Embed Tab ──────────────────────────────────────────────────────────
type TimeRange = { value: string; label: string; from: string };
const TIME_RANGES: TimeRange[] = [
  { value: "1h",  label: "Last 1 hour",   from: "now-1h"  },
  { value: "3h",  label: "Last 3 hours",  from: "now-3h"  },
  { value: "6h",  label: "Last 6 hours",  from: "now-6h"  },
  { value: "24h", label: "Last 24 hours", from: "now-24h" },
  { value: "7d",  label: "Last 7 days",   from: "now-7d"  },
  { value: "30d", label: "Last 30 days",  from: "now-30d" },
];

function buildGrafanaUrl(base: string, from: string, height: number): string {
  try {
    const url = new URL(base);
    url.searchParams.set("from", from);
    url.searchParams.set("to", "now");
    url.searchParams.set("theme", "dark");
    // Ensure panel-only render if it's a d-solo link
    if (!url.pathname.includes("d-solo") && !url.searchParams.has("panelId")) {
      url.searchParams.set("kiosk", "tv"); // hides nav bars for full-dashboard links
    }
    return url.toString();
  } catch {
    return base;
  }
}

function GrafanaTab() {
  const { data: settings, isLoading } = useQuery<any>({
    queryKey: ["/api/settings"],
  });

  const grafanaUrl: string      = settings?.grafanaUrl          ?? "";
  const defaultRange: string    = settings?.grafanaDefaultRange ?? "1h";
  const panelHeight: number     = settings?.grafanaPanelHeight  ?? 480;

  const [range, setRange] = useState<string>(defaultRange);
  const [iframeKey, setIframeKey] = useState(0); // force-reload the iframe

  const selectedRange = TIME_RANGES.find(r => r.value === range) ?? TIME_RANGES[0];
  const embedUrl = grafanaUrl ? buildGrafanaUrl(grafanaUrl, selectedRange.from, panelHeight) : "";

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground gap-2">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm">Loading settings…</span>
      </div>
    );
  }

  if (!grafanaUrl) {
    return (
      <div className="rounded-xl border border-border/50 bg-card p-8 flex flex-col items-center text-center gap-4 max-w-xl mx-auto mt-6">
        <div className="p-4 rounded-full bg-primary/10">
          <LayoutDashboard className="h-8 w-8 text-primary" />
        </div>
        <div>
          <h3 className="font-semibold text-lg">Grafana not configured</h3>
          <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
            Paste a Grafana panel or dashboard URL in Settings to embed live call graphs directly here.
            Supports both single-panel embed URLs (<code className="font-mono text-xs bg-muted px-1 rounded">d-solo/…?panelId=N</code>) and full dashboard URLs.
          </p>
        </div>
        <div className="w-full rounded-lg bg-muted/30 border border-border/40 p-4 text-xs text-left space-y-2 text-muted-foreground">
          <p className="font-semibold text-foreground/70">How to get a Grafana embed URL:</p>
          <ol className="list-decimal list-inside space-y-1">
            <li>Open your Grafana dashboard</li>
            <li>Click the panel title → <strong>Share</strong> → <strong>Embed</strong></li>
            <li>Copy the <code className="font-mono bg-muted px-1 rounded">src</code> URL from the iframe snippet</li>
            <li>Paste it into <strong>Settings → Grafana</strong> below</li>
          </ol>
          <p className="mt-2 text-amber-400">
            ⚠️ The panel must be accessible without login (anonymous access or a public snapshot).
          </p>
        </div>
        <a
          href="/settings?tab=integrations"
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
          <Settings2 className="h-4 w-4" />
          Open Settings to configure
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Controls bar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <LayoutDashboard className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Grafana Panel</span>
          <span className="text-xs text-muted-foreground font-mono truncate max-w-[300px]" title={grafanaUrl}>
            {grafanaUrl.length > 60 ? grafanaUrl.slice(0, 60) + "…" : grafanaUrl}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Time range picker */}
          <div className="flex gap-1 bg-muted/40 rounded-lg p-0.5">
            {TIME_RANGES.map(r => (
              <button
                key={r.value}
                data-testid={`grafana-range-${r.value}`}
                onClick={() => { setRange(r.value); setIframeKey(k => k + 1); }}
                className={cn(
                  "px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors",
                  range === r.value
                    ? "bg-card text-foreground shadow-sm border border-border/50"
                    : "text-muted-foreground hover:text-foreground"
                )}>
                {r.label.replace("Last ", "")}
              </button>
            ))}
          </div>
          <button
            data-testid="btn-grafana-refresh"
            onClick={() => setIframeKey(k => k + 1)}
            title="Reload panel"
            className="p-1.5 rounded-md hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors">
            <RefreshCw className="h-4 w-4" />
          </button>
          <a
            href={embedUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="btn-grafana-open"
            title="Open in Grafana"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-muted/40 hover:bg-muted/70 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ExternalLink className="h-3.5 w-3.5" />
            Open full
          </a>
        </div>
      </div>

      {/* iframe */}
      <div
        className="rounded-xl border border-border/50 overflow-hidden bg-[#161719]"
        style={{ height: `${panelHeight}px` }}>
        <iframe
          key={iframeKey}
          src={embedUrl}
          data-testid="grafana-iframe"
          className="w-full h-full border-0"
          title="Grafana Dashboard"
          allowFullScreen
        />
      </div>

      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
        <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
        If the panel shows a login screen, enable anonymous access on your Grafana instance or use a public snapshot URL.
        Panel URL and height can be changed in <a href="/settings" className="text-primary hover:underline">Settings</a>.
      </p>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function ServerMonitoringPage() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const activeTab = ((new URLSearchParams(search)).get("tab") ?? "reachability") as TabId;
  const setTab = (id: TabId) => navigate(`/server-monitoring?tab=${id}`);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2.5 bg-blue-500/10 rounded-xl">
          <Server className="w-5 h-5 text-blue-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Server Monitoring</h1>
          <p className="text-xs text-muted-foreground">Sippy Softswitch health, resource usage, and alert rules — graphs &amp; tables</p>
        </div>
      </div>

      <div className="flex gap-1 flex-wrap border-b border-border/50">
        {TABS.map(tab => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button key={tab.id} onClick={() => setTab(tab.id)} data-testid={`tab-${tab.id}`}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 transition-all duration-150",
                active ? "border-blue-500 text-blue-400 bg-blue-500/5" : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/30"
              )}>
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      <div>
        {activeTab === "reachability"  && <ReachabilityTab />}
        {activeTab === "bandwidth"     && <BandwidthTab />}
        {activeTab === "disk-memory"   && <DiskMemoryTab />}
        {activeTab === "carrier-asr"   && <CarrierAsrTab />}
        {activeTab === "alert-rules"   && <AlertRulesTab />}
        {activeTab === "registrations" && <RegistrationsTab />}
        {activeTab === "sip-options"   && <SipOptionsTab />}
        {activeTab === "grafana"       && <GrafanaTab />}
      </div>
    </div>
  );
}

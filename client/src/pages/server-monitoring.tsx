import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useLocation } from "wouter";
import {
  Server, Wifi, WifiOff, AlertTriangle, CheckCircle, Clock, RefreshCw,
  Activity, HardDrive, Cpu, MemoryStick, Radio, Bell, BellOff, Trash2, Plus,
  Zap, TrendingDown, Shield, ShieldAlert, Database
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import type { AlertRule } from "@shared/schema";

const TABS = [
  { id: "reachability", label: "Reachability", icon: Wifi },
  { id: "bandwidth",    label: "Bandwidth",    icon: Activity },
  { id: "disk-memory",  label: "Disk & Memory", icon: HardDrive },
  { id: "carrier-asr",  label: "Carrier ASR",  icon: TrendingDown },
  { id: "alert-rules",  label: "Alert Rules",  icon: Bell },
  { id: "registrations",label: "Reg Storm",    icon: Radio },
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

// ── Reachability Tab ──────────────────────────────────────────────────────────
function ReachabilityTab() {
  const { data, isLoading, refetch, isRefetching } = useQuery<{
    up: boolean; checkedAt: string; cause?: string; uptimePct: number;
    outageLog: { id: number; downAt: string; recoveredAt?: string; durationSec?: number; cause?: string }[];
  }>({
    queryKey: ["/api/monitoring/status"],
    refetchInterval: 15000,
    staleTime: 0,
  });

  return (
    <div className="space-y-6">
      {/* Status card */}
      <div className={cn(
        "rounded-xl border p-6 flex items-center gap-5",
        isLoading ? "border-border/50 bg-card" :
        data?.up ? "border-emerald-500/30 bg-emerald-500/5" : "border-rose-500/40 bg-rose-500/8 animate-pulse"
      )}>
        {isLoading ? (
          <RefreshCw className="w-10 h-10 text-muted-foreground animate-spin" />
        ) : data?.up ? (
          <CheckCircle className="w-10 h-10 text-emerald-400 flex-shrink-0" />
        ) : (
          <WifiOff className="w-10 h-10 text-rose-400 flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <span className={cn("text-2xl font-bold", isLoading ? "text-muted-foreground" : data?.up ? "text-emerald-400" : "text-rose-400")}>
              {isLoading ? "Checking…" : data?.up ? "Sippy Server ONLINE" : "Sippy Server OFFLINE"}
            </span>
            {!isLoading && data?.up && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-mono">
                {data?.uptimePct ?? 100}% uptime (7d)
              </span>
            )}
            {!isLoading && !data?.up && data?.cause && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 font-mono">
                {data.cause}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Last checked: {fmtTs(data?.checkedAt)} · polls every 30 s
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isRefetching}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border/50 hover:bg-muted/30 transition-colors disabled:opacity-50"
          data-testid="button-refresh-reachability"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", isRefetching && "animate-spin")} />
          {isRefetching ? "Checking…" : "Check now"}
        </button>
      </div>

      {/* Outage log */}
      <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-3 border-b border-border/40 bg-muted/10">
          <Clock className="w-3.5 h-3.5 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Outage History</h3>
          <span className="text-xs text-muted-foreground ml-auto">last 30 events</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/20 text-muted-foreground text-xs">
              <tr>
                <th className="text-left px-4 py-2">Down At</th>
                <th className="text-left px-4 py-2">Recovered At</th>
                <th className="text-left px-4 py-2">Duration</th>
                <th className="text-left px-4 py-2">Cause</th>
              </tr>
            </thead>
            <tbody>
              {!data?.outageLog?.length ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground text-xs">No outages recorded — server has been continuously reachable</td></tr>
              ) : (
                data.outageLog.map(e => (
                  <tr key={e.id} className="border-t border-border/30 hover:bg-muted/20">
                    <td className="px-4 py-2.5 font-mono text-xs text-rose-400">{fmtTs(e.downAt)}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-emerald-400">{e.recoveredAt ? fmtTs(e.recoveredAt) : <span className="text-rose-400 font-semibold">Still down</span>}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">{fmtDuration(e.durationSec)}</td>
                    <td className="px-4 py-2.5"><span className="text-xs px-2 py-0.5 rounded bg-muted/40 font-mono">{e.cause ?? "unknown"}</span></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Bandwidth Tab ─────────────────────────────────────────────────────────────
function BandwidthTab() {
  const { data, isLoading, refetch, isRefetching } = useQuery<{ ok: boolean; points: any[]; error?: string }>({
    queryKey: ["/api/monitoring/bandwidth"],
    refetchInterval: 60000,
    staleTime: 0,
  });
  const chartData = (data?.points ?? []).map(p => ({
    time: new Date(p.ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    bw: parseFloat(((p.col1 ?? p.bandwidth ?? p.cps ?? 0) / 1024).toFixed(2)),
  }));

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border/40 bg-muted/10">
          <div className="flex items-center gap-2">
            <Activity className="w-3.5 h-3.5 text-cyan-400" />
            <h3 className="text-sm font-semibold">RTP Bandwidth (12 h)</h3>
          </div>
          <button onClick={() => refetch()} disabled={isRefetching} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border/50 hover:bg-muted/30 disabled:opacity-50" data-testid="button-refresh-bandwidth">
            <RefreshCw className={cn("w-3.5 h-3.5", isRefetching && "animate-spin")} />
          </button>
        </div>
        <div className="p-5">
          {isLoading ? (
            <div className="h-48 flex items-center justify-center text-muted-foreground text-sm"><RefreshCw className="w-4 h-4 animate-spin mr-2" />Loading…</div>
          ) : !chartData.length ? (
            <div className="h-48 flex flex-col items-center justify-center gap-2 text-muted-foreground">
              <Database className="w-8 h-8 opacity-30" />
              <p className="text-sm">No bandwidth data available from Sippy monitoring graph.</p>
              <p className="text-xs opacity-60">Requires Sippy v4.5+ with <code>bandwidth_total</code> monitoring enabled.</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="bwGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
                <XAxis dataKey="time" stroke="#555" fontSize={10} tickLine={false} />
                <YAxis stroke="#555" fontSize={10} tickLine={false} axisLine={false} tickFormatter={v => `${v} KB/s`} width={60} />
                <Tooltip contentStyle={{ backgroundColor: "#0f0f0f", borderColor: "#2a2a2a", borderRadius: "8px", fontSize: "11px" }} formatter={(v: any) => [`${v} KB/s`, "Bandwidth"]} />
                <Area type="monotone" dataKey="bw" stroke="#06b6d4" strokeWidth={2} fill="url(#bwGrad)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-5 py-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-400">Bandwidth monitoring depends on Sippy version</p>
            <p className="text-xs text-muted-foreground mt-1">The <code>bandwidth_total</code> monitoring graph is available in Sippy 4.5+. If your server returns no data, this metric is not enabled. Contact Sippysoft support to enable it.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Disk & Memory Tab ─────────────────────────────────────────────────────────
function DiskMemoryTab() {
  const { data, isLoading, refetch, isRefetching } = useQuery<{
    results: { type: string; ok: boolean; points: any[] }[]; error?: string;
  }>({
    queryKey: ["/api/monitoring/disk-memory"],
    refetchInterval: 60000,
    staleTime: 0,
  });

  const metaFor = (type: string) => ({
    disk_usage:    { label: "Disk Usage",     color: "#f59e0b", icon: HardDrive, unit: "%" },
    cpu_load:      { label: "CPU Load",       color: "#a78bfa", icon: Cpu,       unit: "%" },
    memory_usage:  { label: "Memory Usage",   color: "#34d399", icon: MemoryStick, unit: "%" },
  }[type] ?? { label: type, color: "#6b7280", icon: Activity, unit: "" });

  const results = data?.results ?? [];
  const hasData = results.some(r => r.points.length > 0);

  return (
    <div className="space-y-6">
      {isLoading ? (
        <div className="h-48 flex items-center justify-center text-muted-foreground text-sm"><RefreshCw className="w-4 h-4 animate-spin mr-2" />Loading…</div>
      ) : !hasData ? (
        <div className="rounded-xl border border-border/50 bg-card p-10 flex flex-col items-center gap-3 text-muted-foreground">
          <HardDrive className="w-10 h-10 opacity-20" />
          <p className="text-sm font-medium">No disk/CPU/memory data from Sippy monitoring graph</p>
          <p className="text-xs opacity-60 text-center max-w-md">Sippy must have <code>disk_usage</code>, <code>cpu_load</code>, and <code>memory_usage</code> monitoring types enabled. These are server-version dependent.</p>
          <button onClick={() => refetch()} disabled={isRefetching} className="mt-2 flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border/50 hover:bg-muted/30 disabled:opacity-50">
            <RefreshCw className={cn("w-3.5 h-3.5", isRefetching && "animate-spin")} />Retry
          </button>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-1">
          {results.filter(r => r.points.length > 0).map(r => {
            const meta = metaFor(r.type);
            const chartData = r.points.map(p => ({
              time: new Date(p.ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
              val: parseFloat((p.col1 ?? p.cps ?? 0).toFixed(1)),
            }));
            const latest = chartData[chartData.length - 1]?.val ?? 0;
            const alertLevel = latest > 85 ? "rose" : latest > 70 ? "amber" : "emerald";
            return (
              <div key={r.type} className="rounded-xl border border-border/50 bg-card overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3 border-b border-border/40 bg-muted/10">
                  <div className="flex items-center gap-2">
                    <meta.icon className="w-3.5 h-3.5" style={{ color: meta.color }} />
                    <h3 className="text-sm font-semibold">{meta.label}</h3>
                  </div>
                  <span className={cn("text-lg font-bold tabular-nums", alertLevel === "rose" ? "text-rose-400" : alertLevel === "amber" ? "text-amber-400" : "text-emerald-400")}>
                    {latest}{meta.unit}
                  </span>
                </div>
                <div className="p-5">
                  <ResponsiveContainer width="100%" height={160}>
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient id={`grad-${r.type}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={meta.color} stopOpacity={0.3} />
                          <stop offset="95%" stopColor={meta.color} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
                      <XAxis dataKey="time" stroke="#555" fontSize={9} tickLine={false} />
                      <YAxis stroke="#555" fontSize={9} tickLine={false} axisLine={false} tickFormatter={v => `${v}${meta.unit}`} width={40} />
                      <Tooltip contentStyle={{ backgroundColor: "#0f0f0f", borderColor: "#2a2a2a", borderRadius: "8px", fontSize: "11px" }} formatter={(v: any) => [`${v}${meta.unit}`, meta.label]} />
                      <Area type="monotone" dataKey="val" stroke={meta.color} strokeWidth={2} fill={`url(#grad-${r.type})`} dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                  {alertLevel === "rose" && (
                    <div className="mt-3 flex items-center gap-2 text-xs text-rose-400 bg-rose-500/10 px-3 py-2 rounded-lg">
                      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                      {meta.label} above 85% — investigate immediately
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Carrier ASR Tab ───────────────────────────────────────────────────────────
function CarrierAsrTab() {
  const { data, isLoading, refetch, isRefetching } = useQuery<{
    carriers: { carrier: string; total: number; answered: number; asr: number; acd: number; alert: boolean }[];
    period: string; cdrs: number; error?: string;
  }>({
    queryKey: ["/api/monitoring/carrier-asr"],
    refetchInterval: 60000,
    staleTime: 0,
  });

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border/40 bg-muted/10">
          <div className="flex items-center gap-2">
            <TrendingDown className="w-3.5 h-3.5 text-violet-400" />
            <h3 className="text-sm font-semibold">Per-Carrier ASR</h3>
            <span className="text-xs text-muted-foreground">&middot; {data?.period ?? "last 3 hours"}</span>
          </div>
          <div className="flex items-center gap-2">
            {(data?.cdrs ?? 0) > 0 && <span className="text-xs text-muted-foreground">{data?.cdrs} CDRs</span>}
            <button onClick={() => refetch()} disabled={isRefetching} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border/50 hover:bg-muted/30 disabled:opacity-50" data-testid="button-refresh-carrier-asr">
              <RefreshCw className={cn("w-3.5 h-3.5", isRefetching && "animate-spin")} />
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/20 text-muted-foreground text-xs">
              <tr>
                <th className="text-left px-4 py-2">Carrier / Trunk</th>
                <th className="text-right px-4 py-2">Total</th>
                <th className="text-right px-4 py-2">Answered</th>
                <th className="text-right px-4 py-2">ASR</th>
                <th className="text-right px-4 py-2">ACD</th>
                <th className="text-right px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-xs"><RefreshCw className="w-3.5 h-3.5 animate-spin inline mr-2" />Loading CDR data…</td></tr>
              ) : !data?.carriers?.length ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-xs">No CDR data available for the last 3 hours</td></tr>
              ) : (
                data.carriers.map((c, i) => (
                  <tr key={i} className={cn("border-t border-border/30 hover:bg-muted/20", c.alert && "bg-rose-500/5")}>
                    <td className="px-4 py-2.5 font-medium text-xs">{c.carrier}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs">{c.total}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs">{c.answered}</td>
                    <td className={cn("px-4 py-2.5 text-right font-bold font-mono text-xs", c.asr >= 50 ? "text-emerald-400" : c.asr >= 20 ? "text-amber-400" : "text-rose-400")}>
                      {c.asr}%
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs">
                      {c.acd >= 60 ? `${Math.floor(c.acd/60)}m ${c.acd%60}s` : `${c.acd}s`}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {c.alert ? (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 font-medium">
                          <ShieldAlert className="w-3 h-3" />Down
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400">
                          <CheckCircle className="w-3 h-3" />OK
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div className="rounded-xl border border-border/40 bg-muted/10 px-5 py-3 text-xs text-muted-foreground">
        <Shield className="w-3.5 h-3.5 inline mr-1.5 text-violet-400" />
        A carrier is flagged as <span className="text-rose-400">Down</span> when ASR &lt; 20% with at least 10 calls in the window. Data sourced from Sippy CDRs grouped by termination party.
      </div>
    </div>
  );
}

// ── Alert Rules Tab ───────────────────────────────────────────────────────────
const METRIC_OPTIONS = [
  { value: "server_down",  label: "Server Down",              unit: "",   placeholder: "1 (always fires)" },
  { value: "asr_drop",     label: "ASR Drop (global %)",      unit: "%",  placeholder: "e.g. 30" },
  { value: "cps_spike",    label: "CPS Spike",                unit: "/s", placeholder: "e.g. 50" },
  { value: "disk_full",    label: "Disk Usage",               unit: "%",  placeholder: "e.g. 85" },
  { value: "reg_storm",    label: "Registration Storm ratio", unit: "x",  placeholder: "e.g. 2" },
  { value: "bandwidth",    label: "Bandwidth (KB/s)",         unit: "KB/s", placeholder: "e.g. 1000" },
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/monitoring/alert-rules"] });
      toast({ title: "Rule deleted" });
    },
  });

  const selMeta = METRIC_OPTIONS.find(m => m.value === form.metric);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Alert Rules</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Configure thresholds for email/webhook notifications</p>
        </div>
        <button
          onClick={() => setShowForm(v => !v)}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-500 transition-colors"
          data-testid="button-add-alert-rule"
        >
          <Plus className="w-3.5 h-3.5" />New Rule
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-5 space-y-4">
          <h4 className="text-sm font-semibold text-violet-400">New Alert Rule</h4>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Metric</label>
              <select
                value={form.metric}
                onChange={e => setForm(f => ({ ...f, metric: e.target.value }))}
                className="w-full bg-background border border-border/60 rounded-lg px-3 py-2 text-sm"
                data-testid="select-metric"
              >
                {METRIC_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Label (optional)</label>
              <input
                value={form.label}
                onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                placeholder={selMeta?.label}
                className="w-full bg-background border border-border/60 rounded-lg px-3 py-2 text-sm"
                data-testid="input-alert-label"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Condition</label>
              <div className="flex gap-2">
                <select
                  value={form.comparison}
                  onChange={e => setForm(f => ({ ...f, comparison: e.target.value }))}
                  className="bg-background border border-border/60 rounded-lg px-3 py-2 text-sm"
                  data-testid="select-comparison"
                >
                  <option value="gt">Greater than (&gt;)</option>
                  <option value="lt">Less than (&lt;)</option>
                </select>
                <input
                  value={form.threshold}
                  onChange={e => setForm(f => ({ ...f, threshold: e.target.value }))}
                  placeholder={selMeta?.placeholder ?? "threshold"}
                  type="number"
                  className="flex-1 bg-background border border-border/60 rounded-lg px-3 py-2 text-sm"
                  data-testid="input-threshold"
                />
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
                <input
                  value={form.webhookUrl}
                  onChange={e => setForm(f => ({ ...f, webhookUrl: e.target.value }))}
                  placeholder="https://hooks.slack.com/services/..."
                  className="w-full bg-background border border-border/60 rounded-lg px-3 py-2 text-sm"
                  data-testid="input-webhook-url"
                />
              </div>
            )}
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowForm(false)} className="text-xs px-3 py-1.5 rounded-lg border border-border/50 hover:bg-muted/30">Cancel</button>
            <button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending}
              className="text-xs px-3 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-50"
              data-testid="button-save-alert-rule"
            >
              {createMutation.isPending ? "Saving…" : "Save Rule"}
            </button>
          </div>
        </div>
      )}

      {/* Rules list */}
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
                  <td className="px-4 py-3 font-mono text-xs">
                    {r.comparison === "gt" ? ">" : "<"} {r.threshold}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      {r.emailEnabled && <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400">Email</span>}
                      {r.webhookEnabled && <span className="text-xs px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-400">Webhook</span>}
                      {!r.emailEnabled && !r.webhookEnabled && <span className="text-xs text-muted-foreground">none</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => toggleMutation.mutate({ id: r.id, enabled: !r.enabled })}
                      className={cn("text-xs px-2 py-0.5 rounded-full font-medium transition-colors", r.enabled ? "bg-emerald-500/10 text-emerald-400 hover:bg-rose-500/10 hover:text-rose-400" : "bg-muted/40 text-muted-foreground hover:bg-emerald-500/10 hover:text-emerald-400")}
                      data-testid={`button-toggle-rule-${r.id}`}
                    >
                      {r.enabled ? "Active" : "Paused"}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => deleteMutation.mutate(r.id)}
                      className="text-muted-foreground hover:text-rose-400 transition-colors"
                      data-testid={`button-delete-rule-${r.id}`}
                    >
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

// ── Registrations Tab ─────────────────────────────────────────────────────────
function RegistrationsTab() {
  const { data, isLoading, refetch, isRefetching } = useQuery<{
    ok: boolean; points: any[]; stormDetected: boolean; stormRatio: number; error?: string;
  }>({
    queryKey: ["/api/monitoring/registrations"],
    refetchInterval: 60000,
    staleTime: 0,
  });
  const chartData = (data?.points ?? []).map(p => ({
    time: new Date(p.ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    regs: p.col1 ?? p.cps ?? 0,
  }));

  return (
    <div className="space-y-5">
      {data?.stormDetected && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-5 py-4 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-rose-400 flex-shrink-0" />
          <div>
            <p className="text-sm font-bold text-rose-400">Registration Storm Detected!</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Current registration rate is <span className="text-rose-400 font-bold">{data.stormRatio}×</span> higher than the recent average. This may indicate a brute-force attack or mass PBX re-registration.
            </p>
          </div>
        </div>
      )}
      <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border/40 bg-muted/10">
          <div className="flex items-center gap-2">
            <Radio className="w-3.5 h-3.5 text-cyan-400" />
            <h3 className="text-sm font-semibold">SIP Registrations (6 h)</h3>
            {data?.stormDetected && <span className="text-xs px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 font-medium animate-pulse">STORM</span>}
          </div>
          <button onClick={() => refetch()} disabled={isRefetching} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border/50 hover:bg-muted/30 disabled:opacity-50" data-testid="button-refresh-registrations">
            <RefreshCw className={cn("w-3.5 h-3.5", isRefetching && "animate-spin")} />
          </button>
        </div>
        <div className="p-5">
          {isLoading ? (
            <div className="h-48 flex items-center justify-center text-muted-foreground text-sm"><RefreshCw className="w-4 h-4 animate-spin mr-2" />Loading…</div>
          ) : !chartData.length ? (
            <div className="h-48 flex flex-col items-center justify-center gap-2 text-muted-foreground">
              <Radio className="w-8 h-8 opacity-20" />
              <p className="text-sm">No SIP registration data from Sippy monitoring graph.</p>
              <p className="text-xs opacity-60">Requires Sippy <code>sip_reg_total</code> monitoring type.</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="regGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#a78bfa" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
                <XAxis dataKey="time" stroke="#555" fontSize={10} tickLine={false} />
                <YAxis stroke="#555" fontSize={10} tickLine={false} axisLine={false} width={40} />
                <Tooltip contentStyle={{ backgroundColor: "#0f0f0f", borderColor: "#2a2a2a", borderRadius: "8px", fontSize: "11px" }} formatter={(v: any) => [v, "Registrations"]} />
                <Area type="monotone" dataKey="regs" stroke="#a78bfa" strokeWidth={2} fill="url(#regGrad)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
      <div className="rounded-xl border border-border/40 bg-muted/10 px-5 py-3 text-xs text-muted-foreground">
        <Shield className="w-3.5 h-3.5 inline mr-1.5 text-cyan-400" />
        Storm detection: fires when current 5-min registration count exceeds 2× the previous 5-minute moving average and is above 10 registrations. Data sourced from Sippy <code>sip_reg_total</code> monitoring graph.
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ServerMonitoringPage() {
  const [location, setLocation] = useLocation();
  const params = new URLSearchParams(location.split("?")[1] ?? "");
  const activeTab = (params.get("tab") ?? "reachability") as TabId;

  const setTab = (id: TabId) => setLocation(`/server-monitoring?tab=${id}`);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2.5 bg-blue-500/10 rounded-xl">
          <Server className="w-5 h-5 text-blue-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Server Monitoring</h1>
          <p className="text-xs text-muted-foreground">Sippy Softswitch health, outages, and alert rules</p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 flex-wrap border-b border-border/50 pb-0">
        {TABS.map(tab => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setTab(tab.id)}
              data-testid={`tab-${tab.id}`}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 transition-all duration-150",
                active
                  ? "border-blue-500 text-blue-400 bg-blue-500/5"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/30"
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div>
        {activeTab === "reachability"  && <ReachabilityTab />}
        {activeTab === "bandwidth"     && <BandwidthTab />}
        {activeTab === "disk-memory"   && <DiskMemoryTab />}
        {activeTab === "carrier-asr"   && <CarrierAsrTab />}
        {activeTab === "alert-rules"   && <AlertRulesTab />}
        {activeTab === "registrations" && <RegistrationsTab />}
      </div>
    </div>
  );
}

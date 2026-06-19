import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Maximize2, Minimize, Activity, AlertTriangle, CheckCircle2,
  XCircle, Phone, Wifi, Clock, Zap, Radio, Shield, BarChart3,
  Eye, ShieldCheck, TrendingUp, DollarSign, GitBranch, Cpu,
  ArrowRight, BrainCircuit, Layers, Siren, RefreshCw, Moon, Sun,
} from "lucide-react";
import { PanelHeader, FreshnessIndicator } from "@/components/freshness-indicator";
import { cn } from "@/lib/utils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Alert } from "@shared/schema";

// ── Types ──────────────────────────────────────────────────────────────────────

interface CarrierScore {
  id: number; carrierId: string; carrierName: string;
  stabilityScore: number | null; rollingAsr: number | null;
  avgPddMs: number | null; trend: string | null;
  sampleCount: number; failureRate: number | null;
}

interface AiOpsIncident {
  id: number; severity: string; title: string;
  status: string; entity: string | null; entityName: string | null;
  signalCount: number; createdAt: string;
}

interface LiveSummary { totalActiveCalls: number; connected?: boolean; }
interface VendorBalance { name: string; balance: number; }
interface VendorBalanceSnapshot { vendors: VendorBalance[]; ts: string | null; snapshotCount: number; }
interface Anomaly { id: number; metric: string; severity: string; resolvedAt: string | null; }

// ── Live pulse dot ─────────────────────────────────────────────────────────────

function Pulse({ color = "green", size = 2 }: { color?: "green" | "amber" | "red"; size?: number }) {
  const c = { green: ["bg-green-500", "bg-green-400"], amber: ["bg-amber-500", "bg-amber-400"], red: ["bg-red-500", "bg-red-400"] }[color];
  return (
    <span className="relative inline-flex">
      <motion.span
        className={cn("absolute rounded-full", c[1])}
        style={{ width: size * 4, height: size * 4, top: 0, left: 0 }}
        animate={{ scale: [1, 2.5, 1], opacity: [0.6, 0, 0.6] }}
        transition={{ duration: 2.2, repeat: Infinity, ease: "easeOut" }}
      />
      <span className={cn("relative rounded-full", c[0])} style={{ width: size * 4, height: size * 4 }} />
    </span>
  );
}

function stabilityColor(score: number | null): "green" | "amber" | "red" {
  if (score == null || score < 45) return "red";
  if (score < 70) return "amber";
  return "green";
}

// ── Incident ticker ────────────────────────────────────────────────────────────

function IncidentTicker({ incidents }: { incidents: AiOpsIncident[] }) {
  const active = incidents.filter(i => i.status === "active" || i.status === "open");
  if (active.length === 0) return (
    <div className="flex items-center gap-2 text-green-600 text-xs font-mono">
      <CheckCircle2 className="h-3.5 w-3.5" />
      All systems nominal — no active incidents
    </div>
  );
  return (
    <div className="flex items-center gap-3 overflow-hidden">
      <span className="text-[10px] font-bold uppercase tracking-widest text-red-600 flex-shrink-0 flex items-center gap-1">
        <Pulse color="red" size={1} /> INCIDENT
      </span>
      <div className="overflow-hidden flex-1">
        <motion.div
          className="flex gap-8 whitespace-nowrap"
          animate={{ x: ["0%", "-50%"] }}
          transition={{ duration: 20, repeat: Infinity, ease: "linear", repeatType: "loop" }}
        >
          {[...active, ...active].map((inc, i) => (
            <span key={`${inc.id}-${i}`} className={cn("text-xs font-mono flex-shrink-0", inc.severity === "critical" ? "text-red-600" : "text-amber-600")}>
              [{inc.severity.toUpperCase()}] {inc.title}
            </span>
          ))}
        </motion.div>
      </div>
    </div>
  );
}

// ── Carrier health card ───────────────────────────────────────────────────────

function CarrierCard({ score, index }: { score: CarrierScore; index: number }) {
  const color = stabilityColor(score.stabilityScore);
  const s = score.stabilityScore ?? 0;
  const barColor = { green: "bg-green-500", amber: "bg-amber-500", red: "bg-red-500" }[color];
  const cardStyle = {
    green: "bg-green-50 dark:bg-green-500/5 border-green-200 dark:border-green-500/20",
    amber: "bg-amber-50 dark:bg-amber-500/5 border-amber-200 dark:border-amber-500/20",
    red:   "bg-red-50 dark:bg-red-500/5 border-red-200 dark:border-red-500/20",
  }[color];
  const glowStyle = {
    green: "bg-green-300",
    amber: "bg-amber-300",
    red:   "bg-red-300",
  }[color];
  const scoreColor = {
    green: "text-green-600",
    amber: "text-amber-600",
    red:   "text-red-600",
  }[color];
  const statusLabel = { green: "healthy", amber: "degraded", red: "critical" }[color];
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06 }}
      className={cn("rounded-xl border p-4 relative overflow-hidden", cardStyle)}
    >
      <div className={cn("absolute inset-0 opacity-[0.04] blur-xl", glowStyle)} />
      <div className="relative">
        <div className="flex items-start justify-between mb-3">
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wide font-mono truncate max-w-[120px]">{score.carrierName}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <Pulse color={color} size={1} />
              <span className="text-[10px] text-slate-500 capitalize">{statusLabel}</span>
            </div>
          </div>
          <motion.div key={s} initial={{ scale: 0.8 }} animate={{ scale: 1 }}
            className={cn("text-2xl font-black tabular-nums", scoreColor)}>
            {s.toFixed(0)}
          </motion.div>
        </div>
        <div className="h-1 bg-slate-200 rounded-full overflow-hidden mb-3">
          <motion.div className={cn("h-full rounded-full", barColor)}
            initial={{ width: 0 }} animate={{ width: `${s}%` }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }} />
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div><p className="text-slate-400 text-[10px]">ASR</p><p className="font-bold tabular-nums text-slate-700">{score.rollingAsr?.toFixed(1) ?? "—"}%</p></div>
          <div><p className="text-slate-400 text-[10px]">PDD</p><p className="font-bold tabular-nums text-slate-700">{score.avgPddMs != null ? `${score.avgPddMs.toFixed(0)}ms` : "—"}</p></div>
          <div>
            <p className="text-slate-400 text-[10px]">Fail Rate</p>
            <p className={cn("font-bold tabular-nums", score.failureRate != null && score.failureRate > 20 ? "text-red-600" : "text-slate-700")}>
              {score.failureRate?.toFixed(1) ?? "—"}%
            </p>
          </div>
          <div><p className="text-slate-400 text-[10px]">Samples</p><p className="font-bold tabular-nums text-slate-700">{score.sampleCount}</p></div>
        </div>
      </div>
    </motion.div>
  );
}

// ── Big metric ─────────────────────────────────────────────────────────────────

function BigMetric({ label, value, icon: Icon, color, sub }: {
  label: string; value: string; icon: React.ComponentType<{ className?: string }>; color: string; sub?: string;
}) {
  return (
    <motion.div
      className="flex flex-col items-center justify-center gap-1 p-4 rounded-xl bg-white dark:bg-white/[0.02] border border-slate-200 dark:border-white/[0.06] shadow-sm dark:shadow-none"
      animate={{ scale: [1, 1.01, 1] }}
      transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
    >
      <Icon className={cn("h-5 w-5 opacity-70", color)} />
      <p className={cn("text-3xl font-black tabular-nums", color)}>{value}</p>
      <p className="text-[10px] text-slate-400 dark:text-muted-foreground/40 uppercase tracking-widest font-mono">{label}</p>
      {sub && <p className="text-[9px] text-slate-400 dark:text-muted-foreground/40 font-mono">{sub}</p>}
    </motion.div>
  );
}

// ── Alert card in NOC ─────────────────────────────────────────────────────────

function NocAlertRow({ alert, onAck, onResolve, pending }: {
  alert: Alert; onAck: () => void; onResolve: () => void; pending: boolean;
}) {
  const isAcked = !!alert.acknowledgedAt;
  return (
    <motion.div
      initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }}
      className={cn(
        "flex items-start gap-2 p-2.5 rounded-lg border text-xs",
        alert.severity === "critical" ? "bg-red-50 dark:bg-red-500/5 border-red-200 dark:border-red-500/20" : "bg-amber-50 dark:bg-amber-500/5 border-amber-200 dark:border-amber-500/20"
      )}
    >
      <AlertTriangle className={cn("h-3.5 w-3.5 flex-shrink-0 mt-0.5",
        alert.severity === "critical" ? "text-red-500" : "text-amber-500")} />
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate text-slate-800 dark:text-slate-200">{alert.type.split("_").join(" ").toUpperCase()}</p>
        <p className="text-slate-500 dark:text-muted-foreground/60 text-[10px] truncate">{alert.message}</p>
        {(alert as any).vendor && (
          <p className="text-[9px] text-slate-400 font-mono mt-0.5">via {(alert as any).vendor}</p>
        )}
      </div>
      <div className="flex gap-1 flex-shrink-0">
        {!isAcked && (
          <button
            data-testid={`noc-ack-${alert.id}`}
            disabled={pending}
            onClick={onAck}
            className="p-1 rounded hover:bg-amber-100 text-amber-600 disabled:opacity-40 transition-colors"
            title="Acknowledge"
          >
            <Eye className="h-3 w-3" />
          </button>
        )}
        <button
          data-testid={`noc-resolve-${alert.id}`}
          disabled={pending}
          onClick={onResolve}
          className="p-1 rounded hover:bg-green-100 text-green-600 disabled:opacity-40 transition-colors"
          title="Resolve"
        >
          <ShieldCheck className="h-3 w-3" />
        </button>
      </div>
    </motion.div>
  );
}

// ── Clock ──────────────────────────────────────────────────────────────────────

function LiveClock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="font-mono text-sm text-slate-500 tabular-nums">
      {time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
    </span>
  );
}

// ── Quick action links ─────────────────────────────────────────────────────────

const QUICK_LINKS = [
  { href: "/analytics",       label: "Analytics",    icon: BarChart3,   color: "text-violet-600" },
  { href: "/routing-manager", label: "Routing",      icon: GitBranch,   color: "text-cyan-600"   },
  { href: "/bitseye",         label: "BitsEye",      icon: Activity,    color: "text-emerald-600" },
  { href: "/fraud",           label: "Fraud",        icon: Siren,       color: "text-rose-600"   },
  { href: "/alerts",          label: "All Alerts",   icon: AlertTriangle, color: "text-amber-600" },
  { href: "/aiops",           label: "AIOps",        icon: BrainCircuit, color: "text-sky-600"   },
  { href: "/live-traffic",    label: "Live Traffic", icon: Layers,      color: "text-teal-600"   },
  { href: "/server-monitoring", label: "Servers",    icon: Cpu,         color: "text-purple-600" },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function NocCommandPage() {
  const [fullscreen, setFullscreen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [pendingAlertId, setPendingAlertId] = useState<number | null>(null);

  useEffect(() => {
    if (darkMode) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
    return () => { document.documentElement.classList.remove('dark'); };
  }, [darkMode]);

  const { data: scores = [], dataUpdatedAt: scoresUpdatedAt, isFetching: scoresFetching } = useQuery<CarrierScore[]>({
    queryKey: ["/api/carrier-scores", 24],
    queryFn: () => fetch("/api/carrier-scores?window=24").then(r => r.json()),
    refetchInterval: 60_000,
  });

  const { data: incidents = [], isError: incidentsError, dataUpdatedAt: incidentsUpdatedAt, isFetching: incidentsFetching } = useQuery<AiOpsIncident[]>({
    queryKey: ["/api/aiops/incidents"],
    refetchInterval: 30_000,
  });

  const { data: liveSummary, dataUpdatedAt: liveUpdatedAt, isFetching: liveFetching } = useQuery<LiveSummary>({
    queryKey: ["/api/sippy/live-calls"],
    refetchInterval: 15_000,
  });

  const { data: alertsData = [], dataUpdatedAt: alertsUpdatedAt, isFetching: alertsFetching } = useQuery<Alert[]>({
    queryKey: ["/api/alerts"],
    refetchInterval: 20_000,
  });

  const { data: balancesData, dataUpdatedAt: balancesUpdatedAt, isFetching: balancesFetching } = useQuery<VendorBalanceSnapshot>({
    queryKey: ["/api/vendors/current-balances"],
    refetchInterval: 60_000,
  });

  const { data: anomalies = [], isError: anomaliesError, dataUpdatedAt: anomaliesUpdatedAt, isFetching: anomaliesFetching } = useQuery<Anomaly[]>({
    queryKey: ["/api/anomalies"],
    refetchInterval: 30_000,
  });

  const acknowledgeMutation = useMutation({
    mutationFn: (id: number) => { setPendingAlertId(id); return apiRequest("POST", `/api/alerts/${id}/acknowledge`); },
    onSettled: () => { setPendingAlertId(null); queryClient.invalidateQueries({ queryKey: ["/api/alerts"] }); },
  });

  const resolveMutation = useMutation({
    mutationFn: (id: number) => { setPendingAlertId(id); return apiRequest("POST", `/api/alerts/${id}/resolve`); },
    onSettled: () => { setPendingAlertId(null); queryClient.invalidateQueries({ queryKey: ["/api/alerts"] }); },
  });

  const activeIncidents   = incidents.filter(i => i.status === "active" || i.status === "open");
  const criticalCount     = activeIncidents.filter(i => i.severity === "critical").length;
  const healthyCarriers   = scores.filter(s => (s.stabilityScore ?? 0) >= 70).length;
  const activeAlerts      = alertsData.filter(a => !a.resolved);
  const ackedAlerts       = activeAlerts.filter(a => !!a.acknowledgedAt);
  const openAlerts        = activeAlerts.filter(a => !a.acknowledgedAt);
  const activeAnomalies   = anomalies.filter(a => !a.resolvedAt);
  const switchConnected   = liveSummary?.connected !== false;

  const toggleFullscreen = () => {
    if (!fullscreen) document.documentElement.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.().catch(() => {});
    setFullscreen(v => !v);
  };

  return (
    <div className={cn("bg-slate-50 text-slate-900 dark:bg-[#06080f] dark:text-slate-100 min-h-screen flex flex-col", fullscreen && "fixed inset-0 z-[9999]")}>
      {/* Top bar */}
      <div className="border-b border-slate-200 dark:border-white/[0.06] px-6 py-3 flex items-center gap-4 flex-shrink-0 bg-white dark:bg-[#0d1117] shadow-sm dark:shadow-none">
        <div className="flex items-center gap-2">
          <div className="bg-violet-100 p-1.5 rounded-lg">
            <Radio className="h-4 w-4 text-violet-600" />
          </div>
          <div>
            <p className="text-xs font-bold tracking-widest uppercase text-violet-700 font-mono">Bitsauto NOC</p>
            <p className="text-[9px] text-slate-400 font-mono">Unified Operations Console · v2.6</p>
          </div>
        </div>

        <div className="flex-1 border border-slate-200 dark:border-white/[0.06] rounded-lg px-4 py-2 bg-slate-50 dark:bg-white/[0.03]">
          <IncidentTicker incidents={incidents} />
        </div>

        <div className="flex items-center gap-3">
          <LiveClock />
          <button
            data-testid="btn-dark-mode"
            onClick={() => setDarkMode(v => !v)}
            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 transition-colors text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
            title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
          >
            {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <button
            data-testid="btn-fullscreen"
            onClick={toggleFullscreen}
            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 transition-colors text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
          >
            {fullscreen ? <Minimize className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Main grid */}
      <div className="flex-1 p-5 grid grid-cols-12 gap-4 overflow-auto">

        {/* ── Left: Carrier health + KPIs — 8 cols ── */}
        <div className="col-span-12 lg:col-span-8 space-y-4">

          {/* KPI row — 6 metrics */}
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
            <BigMetric label="Live Calls" value={String(liveSummary?.totalActiveCalls ?? 0)} icon={Phone} color="text-cyan-600" />
            <BigMetric label="Open Alerts" value={String(openAlerts.length)}
              icon={AlertTriangle} color={openAlerts.length > 0 ? "text-red-600" : "text-green-600"} />
            <BigMetric label="Acknowledged" value={String(ackedAlerts.length)}
              icon={Eye} color={ackedAlerts.length > 0 ? "text-amber-600" : "text-slate-400"} />
            <BigMetric label="Anomalies" value={String(activeAnomalies.length)}
              icon={Zap} color={activeAnomalies.length > 0 ? "text-orange-600" : "text-slate-400"} />
            <BigMetric label="Healthy Carriers" value={`${healthyCarriers}/${scores.length}`}
              icon={Shield} color="text-green-600" />
            <BigMetric label="Active Incidents" value={String(activeIncidents.length)}
              icon={TrendingUp} color={activeIncidents.length > 0 ? (criticalCount > 0 ? "text-red-600" : "text-amber-600") : "text-slate-400"}
              sub={criticalCount > 0 ? `${criticalCount} critical` : undefined} />
          </div>

          {/* Carrier cards */}
          <div>
            <PanelHeader label="Carrier Health Matrix" updatedAt={scoresUpdatedAt} intervalMs={60_000} isFetching={scoresFetching}>
              <Pulse color="green" size={1} />
            </PanelHeader>
            {scores.length === 0 ? (
              <div className="text-center text-slate-400 dark:text-slate-500 text-xs py-8 border border-slate-200 dark:border-white/[0.06] rounded-xl bg-white dark:bg-white/[0.02]">
                No carrier scores yet — run a synthetic test campaign to populate
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {scores.map((s, i) => <CarrierCard key={s.carrierId} score={s} index={i} />)}
              </div>
            )}
          </div>

          {/* Quick Access */}
          <div className="rounded-xl border border-slate-200 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] p-4 shadow-sm dark:shadow-none">
            <p className="text-[10px] uppercase tracking-widest text-slate-400 dark:text-muted-foreground/40 font-mono mb-3">Quick Access</p>
            <div className="grid grid-cols-4 gap-2">
              {QUICK_LINKS.map(({ href, label, icon: Icon, color }) => (
                <Link key={href} href={href}>
                  <a data-testid={`noc-link-${label.toLowerCase().replace(/\s/g,'-')}`}
                    className="flex items-center gap-2 p-2.5 rounded-lg border border-slate-200 dark:border-white/[0.06] bg-slate-50 dark:bg-white/[0.02] hover:bg-slate-100 dark:hover:bg-white/[0.05] hover:border-slate-300 dark:hover:border-white/10 transition-all group cursor-pointer">
                    <Icon className={cn("h-4 w-4 flex-shrink-0", color)} />
                    <span className="text-xs text-slate-500 dark:text-muted-foreground/60 group-hover:text-slate-800 dark:group-hover:text-slate-200 transition-colors truncate">{label}</span>
                    <ArrowRight className="h-3 w-3 text-slate-300 dark:text-muted-foreground/30 ml-auto group-hover:text-slate-500 dark:group-hover:text-muted-foreground transition-colors flex-shrink-0" />
                  </a>
                </Link>
              ))}
            </div>
          </div>
        </div>

        {/* ── Right panel — 4 cols ── */}
        <div className="col-span-12 lg:col-span-4 flex flex-col gap-4">

          {/* System Status — live */}
          <div className="rounded-xl border border-slate-200 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] p-4 shadow-sm dark:shadow-none">
            <PanelHeader label="System Status" updatedAt={liveUpdatedAt} intervalMs={15_000} isFetching={liveFetching} />
            <div className="space-y-2">
              {[
                { label: "Sippy Switch",     ok: switchConnected },
                { label: "AI Ops Engine",    ok: !incidentsError },
                { label: "Scoring Engine",   ok: scores.length > 0 },
                { label: "Anomaly Engine",   ok: !anomaliesError },
                { label: "Correlation Pass", ok: !incidentsError && !anomaliesError },
              ].map(({ label, ok }) => (
                <div key={label} className="flex items-center gap-2 text-xs">
                  <Pulse color={ok ? "green" : "red"} size={1} />
                  <span className="flex-1 text-slate-500 dark:text-muted-foreground/60">{label}</span>
                  <span className={ok ? "text-green-600 font-semibold" : "text-red-600 font-semibold"}>{ok ? "Online" : "Offline"}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Vendor Balances */}
          <div className="rounded-xl border border-slate-200 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] p-4 shadow-sm dark:shadow-none">
            <PanelHeader label="Vendor Balances" updatedAt={balancesUpdatedAt} intervalMs={60_000} isFetching={balancesFetching}>
              <DollarSign className="h-3 w-3 text-slate-400" />
            </PanelHeader>
            {!balancesData?.vendors?.length ? (
              <p className="text-xs text-slate-400 dark:text-muted-foreground/40 text-center py-2">No balance data yet</p>
            ) : (
              <div className="space-y-1.5">
                {balancesData.vendors.map(v => (
                  <div key={v.name} className="flex items-center gap-2 text-xs">
                    <span className="flex-1 text-slate-500 dark:text-muted-foreground/60 truncate font-mono">{v.name}</span>
                    <span className={cn("font-bold tabular-nums", v.balance < 10 ? "text-red-600" : v.balance < 50 ? "text-amber-600" : "text-green-600")}>
                      ${v.balance.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Active System Alerts — with inline Acknowledge/Resolve */}
          <div className="rounded-xl border border-slate-200 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] p-4 flex-1 shadow-sm dark:shadow-none">
            <PanelHeader label="System Alerts" updatedAt={alertsUpdatedAt} intervalMs={20_000} isFetching={alertsFetching}>
              <Pulse color={openAlerts.length > 0 ? "red" : "green"} size={1} />
              {openAlerts.length > 0 && (
                <span className="text-[9px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full font-bold">
                  {openAlerts.length} OPEN
                </span>
              )}
              {openAlerts.length === 0 && activeAlerts.length === 0 && (
                <span className="text-[9px] bg-green-100 text-green-600 px-1.5 py-0.5 rounded-full font-bold">CLEAR</span>
              )}
            </PanelHeader>
            {activeAlerts.length === 0 ? (
              <div className="text-center text-slate-400 dark:text-muted-foreground/40 text-xs py-4 flex flex-col items-center gap-2">
                <CheckCircle2 className="h-6 w-6 text-green-500/60" />
                All alerts resolved
              </div>
            ) : (
              <div className="space-y-2 max-h-52 overflow-y-auto pr-0.5">
                <AnimatePresence>
                  {activeAlerts.map(alert => (
                    <NocAlertRow
                      key={alert.id}
                      alert={alert}
                      pending={pendingAlertId === alert.id}
                      onAck={() => acknowledgeMutation.mutate(alert.id)}
                      onResolve={() => resolveMutation.mutate(alert.id)}
                    />
                  ))}
                </AnimatePresence>
              </div>
            )}
            <Link href="/alerts">
              <a className="mt-3 flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-muted-foreground/40 hover:text-slate-600 dark:hover:text-muted-foreground transition-colors font-mono">
                <ArrowRight className="h-3 w-3" /> View all alerts
              </a>
            </Link>
          </div>

          {/* AIOps incident feed */}
          <div className="rounded-xl border border-slate-200 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] p-4 shadow-sm dark:shadow-none">
            <PanelHeader label="AI Ops Feed" updatedAt={incidentsUpdatedAt} intervalMs={30_000} isFetching={incidentsFetching}>
              <Pulse color={activeIncidents.length > 0 ? "red" : "green"} size={1} />
              {activeIncidents.length > 0 && (
                <span className="text-[9px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full font-bold">
                  {activeIncidents.length} ACTIVE
                </span>
              )}
            </PanelHeader>
            {incidents.length === 0 ? (
              <div className="text-center text-slate-400 text-xs py-3">No incidents detected</div>
            ) : (
              <div className="space-y-2 max-h-44 overflow-y-auto">
                <AnimatePresence>
                  {incidents.slice(0, 6).map((inc, i) => (
                    <motion.div key={inc.id} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06 }}
                      className={cn("flex items-start gap-2 p-2 rounded-lg border text-xs",
                        inc.severity === "critical" ? "bg-red-50 border-red-200" :
                        inc.severity === "high"     ? "bg-orange-50 border-orange-200" :
                                                     "bg-yellow-50 border-yellow-200")}>
                      <AlertTriangle className={cn("h-3.5 w-3.5 flex-shrink-0 mt-0.5",
                        inc.severity === "critical" ? "text-red-500" : inc.severity === "high" ? "text-orange-500" : "text-yellow-600")} />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate text-slate-800">{inc.title}</p>
                        <p className="text-slate-500 text-[10px]">{inc.entityName ?? inc.entity ?? "Platform"} · {new Date(inc.createdAt).toLocaleTimeString()}</p>
                      </div>
                      <span className={cn("flex-shrink-0 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full",
                        inc.status === "active" ? "bg-red-100 text-red-600" : "bg-green-100 text-green-600")}>
                        {inc.status}
                      </span>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-slate-200 dark:border-white/[0.06] px-6 py-2 flex items-center gap-4 text-[10px] text-slate-400 dark:text-muted-foreground/40 font-mono flex-shrink-0 bg-white dark:bg-[#0d1117]">
        <span>BITSAUTO MONITORING PLATFORM v2.6.0-stable</span>
        <span className="flex-1" />
        {balancesData?.snapshotCount != null && (
          <span className="flex items-center gap-1">
            <RefreshCw className="h-2.5 w-2.5" /> {balancesData.snapshotCount} balance snapshots
          </span>
        )}
        <span className="flex items-center gap-1"><Pulse color="green" size={1} /> LIVE</span>
      </div>
    </div>
  );
}

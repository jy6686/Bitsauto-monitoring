import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import {
  Maximize2, Minimize2, Activity, AlertTriangle, CheckCircle2,
  XCircle, Phone, Wifi, Clock, Zap, Radio, TrendingDown, TrendingUp,
  Shield, Globe, BarChart3, Minimize,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────────

interface CarrierScore {
  id: number;
  carrierId: string;
  carrierName: string;
  stabilityScore: number | null;
  rollingAsr: number | null;
  avgPddMs: number | null;
  trend: string | null;
  sampleCount: number;
  failureRate: number | null;
}

interface AiOpsIncident {
  id: number;
  severity: string;
  title: string;
  status: string;
  entityName: string | null;
  signalCount: number;
  createdAt: string;
}

interface LiveSummary {
  totalActiveCalls: number;
  connected?: boolean;
}

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
    <div className="flex items-center gap-2 text-green-400 text-xs font-mono">
      <CheckCircle2 className="h-3.5 w-3.5" />
      All systems nominal — no active incidents
    </div>
  );

  return (
    <div className="flex items-center gap-3 overflow-hidden">
      <span className="text-[10px] font-bold uppercase tracking-widest text-red-400 flex-shrink-0 flex items-center gap-1">
        <Pulse color="red" size={1} /> INCIDENT
      </span>
      <div className="overflow-hidden flex-1">
        <motion.div
          className="flex gap-8 whitespace-nowrap"
          animate={{ x: ["0%", "-50%"] }}
          transition={{ duration: 20, repeat: Infinity, ease: "linear", repeatType: "loop" }}
        >
          {[...active, ...active].map((inc, i) => (
            <span key={`${inc.id}-${i}`} className={cn("text-xs font-mono flex-shrink-0", inc.severity === "critical" ? "text-red-400" : "text-amber-400")}>
              [{inc.severity.toUpperCase()}] {inc.title} — {inc.entityName ?? "unknown entity"}
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

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06 }}
      className={cn(
        "rounded-xl border p-4 relative overflow-hidden",
        color === "green" ? "bg-green-500/5 border-green-500/20" :
        color === "amber" ? "bg-amber-500/5 border-amber-500/20" :
                            "bg-red-500/5 border-red-500/20"
      )}
    >
      {/* Background glow */}
      <div className={cn("absolute inset-0 opacity-5 blur-xl",
        color === "green" ? "bg-green-400" : color === "amber" ? "bg-amber-400" : "bg-red-400"
      )} />

      <div className="relative">
        <div className="flex items-start justify-between mb-3">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-mono truncate max-w-[120px]">{score.carrierName}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <Pulse color={color} size={1} />
              <span className="text-[10px] text-muted-foreground capitalize">{color === "green" ? "healthy" : color === "amber" ? "degraded" : "critical"}</span>
            </div>
          </div>
          <motion.div
            key={s}
            initial={{ scale: 0.8 }}
            animate={{ scale: 1 }}
            className={cn("text-2xl font-black tabular-nums",
              color === "green" ? "text-green-400" : color === "amber" ? "text-amber-400" : "text-red-400")}
          >
            {s.toFixed(0)}
          </motion.div>
        </div>

        {/* Stability bar */}
        <div className="h-1 bg-black/30 rounded-full overflow-hidden mb-3">
          <motion.div
            className={cn("h-full rounded-full", barColor)}
            initial={{ width: 0 }}
            animate={{ width: `${s}%` }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          />
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <p className="text-muted-foreground/60 text-[10px]">ASR</p>
            <p className="font-bold tabular-nums">{score.rollingAsr?.toFixed(1) ?? "—"}%</p>
          </div>
          <div>
            <p className="text-muted-foreground/60 text-[10px]">PDD</p>
            <p className="font-bold tabular-nums">{score.avgPddMs != null ? `${score.avgPddMs.toFixed(0)}ms` : "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground/60 text-[10px]">Fail Rate</p>
            <p className={cn("font-bold tabular-nums", score.failureRate != null && score.failureRate > 20 ? "text-red-400" : "")}>
              {score.failureRate?.toFixed(1) ?? "—"}%
            </p>
          </div>
          <div>
            <p className="text-muted-foreground/60 text-[10px]">Samples</p>
            <p className="font-bold tabular-nums">{score.sampleCount}</p>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ── Big metric ─────────────────────────────────────────────────────────────────

function BigMetric({ label, value, icon: Icon, color }: {
  label: string; value: string; icon: React.ComponentType<{ className?: string }>; color: string;
}) {
  return (
    <motion.div
      className="flex flex-col items-center justify-center gap-1 p-4 rounded-xl bg-white/[0.03] border border-white/[0.07]"
      animate={{ scale: [1, 1.01, 1] }}
      transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
    >
      <Icon className={cn("h-5 w-5 opacity-60", color)} />
      <p className={cn("text-3xl font-black tabular-nums", color)}>{value}</p>
      <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-mono">{label}</p>
    </motion.div>
  );
}

// ── Scrolling AI feed ──────────────────────────────────────────────────────────

function AiFeed({ incidents }: { incidents: AiOpsIncident[] }) {
  return (
    <div className="space-y-2 max-h-64 overflow-hidden relative">
      <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-background to-transparent z-10" />
      <AnimatePresence>
        {incidents.slice(0, 8).map((inc, i) => (
          <motion.div
            key={inc.id}
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.08 }}
            className={cn(
              "flex items-start gap-2 p-2 rounded-lg border text-xs",
              inc.severity === "critical" ? "bg-red-500/8 border-red-500/20" :
              inc.severity === "high"     ? "bg-orange-500/8 border-orange-500/20" :
                                           "bg-yellow-500/8 border-yellow-500/20"
            )}
          >
            <AlertTriangle className={cn("h-3.5 w-3.5 flex-shrink-0 mt-0.5",
              inc.severity === "critical" ? "text-red-400" : inc.severity === "high" ? "text-orange-400" : "text-yellow-400")} />
            <div className="min-w-0">
              <p className="font-medium truncate">{inc.title}</p>
              <p className="text-muted-foreground text-[10px]">{inc.entityName} · {new Date(inc.createdAt).toLocaleTimeString()}</p>
            </div>
            <span className={cn("flex-shrink-0 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full",
              inc.status === "active" ? "bg-red-500/20 text-red-400" : "bg-green-500/20 text-green-400")}>
              {inc.status}
            </span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
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
    <span className="font-mono text-sm text-muted-foreground tabular-nums">
      {time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
    </span>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function NocCommandPage() {
  const [fullscreen, setFullscreen] = useState(false);

  const { data: scores = [] } = useQuery<CarrierScore[]>({
    queryKey: ["/api/carrier-scores", 24],
    queryFn: () => fetch("/api/carrier-scores?window=24").then(r => r.json()),
    refetchInterval: 60_000,
  });

  const { data: incidents = [] } = useQuery<AiOpsIncident[]>({
    queryKey: ["/api/aiops/incidents"],
    refetchInterval: 30_000,
  });

  const { data: liveSummary } = useQuery<LiveSummary>({
    queryKey: ["/api/sippy/live-calls"],
    refetchInterval: 15_000,
  });

  const activeIncidents   = incidents.filter(i => i.status === "active" || i.status === "open");
  const criticalCount     = activeIncidents.filter(i => i.severity === "critical").length;
  const healthyCarriers   = scores.filter(s => (s.stabilityScore ?? 0) >= 70).length;
  const scores24          = scores;

  const toggleFullscreen = () => {
    if (!fullscreen) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
    setFullscreen(v => !v);
  };

  return (
    <div className={cn("bg-[#06080f] text-white min-h-screen flex flex-col", fullscreen && "fixed inset-0 z-[9999]")}>
      {/* Top bar */}
      <div className="border-b border-white/[0.06] px-6 py-3 flex items-center gap-4 flex-shrink-0">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <div className="bg-violet-600/20 p-1.5 rounded-lg">
            <Radio className="h-4 w-4 text-violet-400" />
          </div>
          <div>
            <p className="text-xs font-bold tracking-widest uppercase text-violet-300 font-mono">Bitsauto NOC</p>
            <p className="text-[9px] text-muted-foreground font-mono">Command Center · v2.5</p>
          </div>
        </div>

        {/* Incident ticker */}
        <div className="flex-1 border border-white/[0.06] rounded-lg px-4 py-2 bg-black/20">
          <IncidentTicker incidents={incidents} />
        </div>

        {/* Clock + fullscreen */}
        <div className="flex items-center gap-3">
          <LiveClock />
          <button
            data-testid="btn-fullscreen"
            onClick={toggleFullscreen}
            className="p-1.5 rounded-lg hover:bg-white/[0.06] transition-colors text-muted-foreground hover:text-white"
          >
            {fullscreen ? <Minimize className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Main grid */}
      <div className="flex-1 p-6 grid grid-cols-12 gap-4 overflow-auto">

        {/* Carrier health grid — 8 cols */}
        <div className="col-span-12 lg:col-span-8 space-y-4">
          {/* KPI row */}
          <div className="grid grid-cols-4 gap-3">
            <BigMetric
              label="Live Calls"
              value={String(liveSummary?.totalActiveCalls ?? 0)}
              icon={Phone}
              color="text-cyan-400"
            />
            <BigMetric
              label="Active Incidents"
              value={String(activeIncidents.length)}
              icon={AlertTriangle}
              color={activeIncidents.length > 0 ? "text-red-400" : "text-green-400"}
            />
            <BigMetric
              label="Critical"
              value={String(criticalCount)}
              icon={Zap}
              color={criticalCount > 0 ? "text-red-400" : "text-muted-foreground"}
            />
            <BigMetric
              label="Healthy Carriers"
              value={`${healthyCarriers}/${scores24.length}`}
              icon={Shield}
              color="text-green-400"
            />
          </div>

          {/* Carrier cards */}
          <div>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground/50 font-mono mb-3 flex items-center gap-2">
              <Pulse color="green" size={1} /> Carrier Health Matrix
            </p>
            {scores24.length === 0 ? (
              <div className="text-center text-muted-foreground text-xs py-8 border border-white/[0.06] rounded-xl">
                No carrier scores yet — run a synthetic test campaign to populate
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {scores24.map((s, i) => <CarrierCard key={s.carrierId} score={s} index={i} />)}
              </div>
            )}
          </div>
        </div>

        {/* Right panel — 4 cols */}
        <div className="col-span-12 lg:col-span-4 flex flex-col gap-4">
          {/* System status */}
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground/50 font-mono mb-3">System Status</p>
            <div className="space-y-2">
              {[
                { label: "Sippy Switch",      ok: true  },
                { label: "AI Ops Engine",     ok: true  },
                { label: "Scoring Engine",    ok: true  },
                { label: "Narration Engine",  ok: true  },
                { label: "Correlation Pass",  ok: true  },
              ].map(({ label, ok }) => (
                <div key={label} className="flex items-center gap-2 text-xs">
                  <Pulse color={ok ? "green" : "red"} size={1} />
                  <span className="flex-1 text-muted-foreground">{label}</span>
                  <span className={ok ? "text-green-400" : "text-red-400"}>{ok ? "Online" : "Offline"}</span>
                </div>
              ))}
            </div>
          </div>

          {/* AI Ops feed */}
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 flex-1">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground/50 font-mono mb-3 flex items-center gap-2">
              <Pulse color={activeIncidents.length > 0 ? "red" : "green"} size={1} />
              AI Ops Feed
              {activeIncidents.length > 0 && (
                <span className="ml-auto text-[9px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded-full font-bold">
                  {activeIncidents.length} ACTIVE
                </span>
              )}
            </p>
            {incidents.length === 0 ? (
              <div className="text-center text-muted-foreground text-xs py-4">No incidents detected</div>
            ) : (
              <AiFeed incidents={incidents} />
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-white/[0.04] px-6 py-2 flex items-center gap-4 text-[10px] text-muted-foreground/40 font-mono flex-shrink-0">
        <span>BITSAUTO MONITORING PLATFORM v2.5.0-stable</span>
        <span className="flex-1" />
        <span className="flex items-center gap-1"><Pulse color="green" size={1} /> LIVE</span>
      </div>
    </div>
  );
}

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import {
  Play, Pause, RotateCcw, ChevronDown, ChevronUp, CheckCircle2,
  XCircle, AlertTriangle, Clock, Rewind, Filter, RefreshCw,
  Zap, Phone, Radio,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────────

interface RouteTrace {
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
}

interface RunGroup {
  runId: number | null;
  campaignId: number | null;
  legs: RouteTrace[];
  firstAt: number;
  lastAt: number;
  finalOutcome: "connected" | "failed" | "unknown";
  carrierCount: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function groupByRun(traces: RouteTrace[]): RunGroup[] {
  const map = new Map<string, RouteTrace[]>();
  for (const t of traces) {
    const key = t.runId != null ? String(t.runId) : `norun-${t.id}`;
    const arr = map.get(key) ?? [];
    arr.push(t);
    map.set(key, arr);
  }

  const groups: RunGroup[] = [];
  for (const [, legs] of map) {
    const sorted = [...legs].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    const finalLeg = sorted[sorted.length - 1];
    groups.push({
      runId: sorted[0].runId,
      campaignId: sorted[0].campaignId,
      legs: sorted,
      firstAt: new Date(sorted[0].createdAt).getTime(),
      lastAt: new Date(finalLeg.createdAt).getTime(),
      finalOutcome:
        finalLeg.outcome === "connected" ? "connected" : finalLeg.outcome === "failed" ? "failed" : "unknown",
      carrierCount: new Set(sorted.map((l) => l.selectedCarrier).filter(Boolean)).size,
    });
  }

  return groups.sort((a, b) => b.firstAt - a.firstAt);
}

function parseCandidates(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((c: any) =>
        typeof c === "string" ? c : c.name ?? c.carrierId ?? JSON.stringify(c),
      );
    }
  } catch { /* no-op */ }
  return [];
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

// ── Step icon & colour ─────────────────────────────────────────────────────────

const OUTCOME_ICON: Record<string, React.ReactNode> = {
  connected: <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0" />,
  failed:    <XCircle      className="h-4 w-4 text-red-400   shrink-0" />,
  unknown:   <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />,
};

const OUTCOME_BG: Record<string, string> = {
  connected: "bg-green-500/10 border-green-500/20",
  failed:    "bg-red-500/10   border-red-500/20",
  unknown:   "bg-amber-500/10 border-amber-500/20",
};

const OUTCOME_TEXT: Record<string, string> = {
  connected: "text-green-400",
  failed:    "text-red-400",
  unknown:   "text-amber-400",
};

// ── Leg Step Row ───────────────────────────────────────────────────────────────

interface LegStepProps {
  leg: RouteTrace;
  index: number;
  total: number;
  visible: boolean;
  active: boolean;
}

function LegStep({ leg, index, total, visible, active }: LegStepProps) {
  const outcome = (leg.outcome ?? "unknown") as "connected" | "failed" | "unknown";
  const candidates = parseCandidates(leg.candidateRoutes);

  return (
    <motion.div
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: visible ? 1 : 0.12, x: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="flex items-start gap-3"
    >
      {/* Timeline connector */}
      <div className="flex flex-col items-center shrink-0 pt-0.5">
        <div
          className={cn(
            "w-7 h-7 rounded-full border-2 flex items-center justify-center text-xs font-bold transition-all duration-300",
            active
              ? "border-violet-500 bg-violet-500/20 text-violet-300"
              : outcome === "connected"
              ? "border-green-500/60 bg-green-500/10 text-green-400"
              : outcome === "failed"
              ? "border-red-500/60 bg-red-500/10 text-red-400"
              : "border-border bg-muted/30 text-muted-foreground",
          )}
        >
          {active ? (
            <motion.div
              animate={{ scale: [1, 1.3, 1] }}
              transition={{ duration: 0.6, repeat: Infinity }}
              className="w-2 h-2 rounded-full bg-violet-400"
            />
          ) : (
            index + 1
          )}
        </div>
        {index < total - 1 && (
          <div
            className={cn(
              "w-px mt-1 transition-all duration-500",
              visible ? "h-full min-h-[32px] bg-border/60" : "h-4 bg-border/20",
            )}
          />
        )}
      </div>

      {/* Content */}
      <div
        className={cn(
          "flex-1 rounded-xl border p-3 mb-3 transition-all duration-300",
          active ? "border-violet-500/40 bg-violet-500/5 shadow-[0_0_12px_rgba(139,92,246,0.1)]" : OUTCOME_BG[outcome],
        )}
      >
        {/* Row 1: carrier + outcome + SIP */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm">
            {leg.selectedCarrier ?? "Unknown Carrier"}
          </span>
          {OUTCOME_ICON[outcome]}
          {leg.sipCode && (
            <Badge className="bg-muted/40 text-muted-foreground border-border text-[10px] px-1.5 py-0">
              SIP {leg.sipCode}
            </Badge>
          )}
          {leg.pddMs != null && leg.pddMs > 0 && (
            <span className={cn("text-xs flex items-center gap-1", leg.pddMs > 5000 ? "text-amber-400" : "text-muted-foreground")}>
              <Clock className="h-3 w-3" />
              {formatDuration(leg.pddMs)} PDD
            </span>
          )}
          {leg.durationSec != null && leg.durationSec > 0 && (
            <span className="text-xs text-green-400 flex items-center gap-1">
              <Phone className="h-3 w-3" />
              {leg.durationSec}s
            </span>
          )}
          <span className="ml-auto text-[10px] text-muted-foreground/50">
            {new Date(leg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
        </div>

        {/* Row 2: CLD + CLI */}
        <div className="text-xs text-muted-foreground mt-1 font-mono">
          {leg.cld}
          {leg.cli && <span className="text-muted-foreground/40"> ← {leg.cli}</span>}
        </div>

        {/* Row 3: Decision reason */}
        {leg.decisionReason && (
          <div className="text-[11px] text-muted-foreground/70 mt-1.5 italic">
            "{leg.decisionReason}"
          </div>
        )}

        {/* Row 4: Failure category */}
        {leg.failureCategory && (
          <div className="mt-1.5 flex items-center gap-1.5">
            <AlertTriangle className="h-3 w-3 text-red-400" />
            <span className="text-[11px] text-red-400">{leg.failureCategory}</span>
          </div>
        )}

        {/* Row 5: Candidates */}
        {candidates.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {candidates.map((c, ci) => (
              <span
                key={ci}
                className={cn(
                  "text-[10px] px-1.5 py-0.5 rounded border",
                  c === (leg.selectedCarrier ?? "") ? "bg-violet-500/20 border-violet-500/40 text-violet-300" : "bg-muted/30 border-border text-muted-foreground",
                )}
              >
                {c}
              </span>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ── Run card with animation engine ────────────────────────────────────────────

interface RunCardProps {
  group: RunGroup;
  initialExpanded?: boolean;
}

function RunCard({ group, initialExpanded = false }: RunCardProps) {
  const [expanded, setExpanded] = useState(initialExpanded);
  const [playing, setPlaying] = useState(false);
  const [activeStep, setActiveStep] = useState(-1);
  const [visibleCount, setVisibleCount] = useState(group.legs.length); // all visible by default
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const totalLegs = group.legs.length;
  const STEP_MS = 700;

  const stopPlayback = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setPlaying(false);
    setActiveStep(-1);
  }, []);

  const startPlayback = useCallback(() => {
    setExpanded(true);
    setVisibleCount(0);
    setActiveStep(0);
    setPlaying(true);

    for (let i = 0; i < totalLegs; i++) {
      const t = setTimeout(() => {
        setVisibleCount(i + 1);
        setActiveStep(i);
      }, i * STEP_MS);
      if (i === 0) timerRef.current = t;
    }

    setTimeout(() => {
      setActiveStep(-1);
      setPlaying(false);
      setVisibleCount(totalLegs);
    }, totalLegs * STEP_MS + 200);
  }, [totalLegs]);

  const reset = useCallback(() => {
    stopPlayback();
    setVisibleCount(totalLegs);
  }, [stopPlayback, totalLegs]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const outcomeLabel = group.finalOutcome === "connected" ? "Connected" : group.finalOutcome === "failed" ? "Failed" : "Unknown";
  const outcomeBadge = group.finalOutcome === "connected"
    ? "bg-green-500/15 text-green-400 border-green-500/30"
    : group.finalOutcome === "failed"
    ? "bg-red-500/15 text-red-400 border-red-500/30"
    : "bg-amber-500/15 text-amber-400 border-amber-500/30";

  return (
    <Card
      data-testid={`replay-run-${group.runId ?? "norun"}`}
      className={cn(
        "border transition-all duration-300",
        group.finalOutcome === "connected" ? "border-green-500/20" :
        group.finalOutcome === "failed"    ? "border-red-500/20"   : "border-border/50",
        playing && "shadow-[0_0_24px_rgba(139,92,246,0.12)]",
      )}
    >
      {/* Card header */}
      <CardHeader className="pb-3">
        <div
          className="flex items-center gap-3 cursor-pointer select-none"
          onClick={() => !playing && setExpanded(v => !v)}
        >
          {/* Run ID badge */}
          <div className="w-10 h-10 rounded-xl bg-violet-500/10 border border-violet-500/20 flex flex-col items-center justify-center shrink-0">
            <span className="text-[9px] text-violet-400/60 font-mono uppercase tracking-widest leading-none">Run</span>
            <span className="text-sm font-bold text-violet-400 leading-none">{group.runId ?? "—"}</span>
          </div>

          {/* Meta */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm truncate">
                {group.legs[0]?.cld ?? "Unknown destination"}
              </span>
              <Badge className={cn("text-[10px] px-1.5 py-0 border", outcomeBadge)}>
                {outcomeLabel}
              </Badge>
              {group.legs.length > 1 && (
                <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/20 text-[10px] px-1.5 py-0">
                  {group.legs.length} legs
                </Badge>
              )}
              {group.campaignId && (
                <span className="text-[10px] text-muted-foreground/50 font-mono">
                  camp #{group.campaignId}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
              <span>{group.carrierCount} carrier{group.carrierCount !== 1 ? "s" : ""} evaluated</span>
              <span>·</span>
              <span>{relativeTime(group.firstAt)}</span>
              {group.legs[0]?.cli && (
                <>
                  <span>·</span>
                  <span className="font-mono">{group.legs[0].cli}</span>
                </>
              )}
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
            {playing ? (
              <Button
                variant="outline"
                size="sm"
                onClick={stopPlayback}
                data-testid={`btn-pause-${group.runId}`}
                className="gap-1 border-violet-500/40 text-violet-400 bg-violet-500/8 hover:bg-violet-500/20 h-8"
              >
                <Pause className="h-3.5 w-3.5" /> Pause
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={startPlayback}
                data-testid={`btn-play-${group.runId}`}
                className="gap-1 h-8"
              >
                <Play className="h-3.5 w-3.5" /> Replay
              </Button>
            )}
            {(visibleCount < totalLegs || activeStep >= 0) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={reset}
                data-testid={`btn-reset-${group.runId}`}
                className="h-8 w-8 p-0"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            )}
            {!playing && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setExpanded(v => !v)}
                className="h-8 w-8 p-0 text-muted-foreground"
              >
                {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </Button>
            )}
          </div>
        </div>

        {/* Animated progress bar */}
        {playing && (
          <div className="mt-3 h-1 bg-muted rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-violet-500 rounded-full"
              initial={{ width: "0%" }}
              animate={{ width: `${((activeStep + 1) / totalLegs) * 100}%` }}
              transition={{ duration: 0.3, ease: "easeOut" }}
            />
          </div>
        )}
      </CardHeader>

      {/* Expanded timeline */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
          >
            <CardContent className="pt-0 pb-4">
              <div className="border-t border-border/40 pt-4">
                {group.legs.map((leg, i) => (
                  <LegStep
                    key={leg.id}
                    leg={leg}
                    index={i}
                    total={totalLegs}
                    visible={i < visibleCount}
                    active={i === activeStep}
                  />
                ))}
              </div>
            </CardContent>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}

// ── Stat pill ──────────────────────────────────────────────────────────────────

function Stat({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="rounded-xl border border-border/50 px-4 py-3 text-center">
      <p className={cn("text-2xl font-bold tabular-nums", color ?? "text-foreground")}>{value}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
    </div>
  );
}

// ── Live pulse dot ─────────────────────────────────────────────────────────────

function LiveDot() {
  return (
    <span className="relative inline-flex">
      <motion.span
        className="absolute inline-flex rounded-full bg-violet-400/30 h-2 w-2"
        animate={{ scale: [1, 2.2, 1], opacity: [0.6, 0, 0.6] }}
        transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
      />
      <span className="relative inline-flex rounded-full bg-violet-500 h-2 w-2" />
    </span>
  );
}

// ── Filter bar ─────────────────────────────────────────────────────────────────

type OutcomeFilter = "all" | "connected" | "failed";

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ReplayEnginePage() {
  const [filter, setFilter] = useState<OutcomeFilter>("all");
  const [runIdFilter, setRunIdFilter] = useState("");

  const { data: traces = [], isLoading, refetch, isFetching } = useQuery<RouteTrace[]>({
    queryKey: ["/api/route-traces"],
    queryFn: () => fetch("/api/route-traces?limit=200").then(r => r.json()),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const allGroups = groupByRun(traces);

  const filteredGroups = allGroups.filter(g => {
    if (filter === "connected" && g.finalOutcome !== "connected") return false;
    if (filter === "failed" && g.finalOutcome !== "failed") return false;
    if (runIdFilter && g.runId != null && !String(g.runId).includes(runIdFilter)) return false;
    return true;
  });

  const totalRuns      = allGroups.length;
  const connectedRuns  = allGroups.filter(g => g.finalOutcome === "connected").length;
  const failedRuns     = allGroups.filter(g => g.finalOutcome === "failed").length;
  const multiLegRuns   = allGroups.filter(g => g.legs.length > 1).length;
  const connRate       = totalRuns > 0 ? Math.round((connectedRuns / totalRuns) * 100) : 0;

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2.5">
            <Rewind className="h-6 w-6 text-violet-400" />
            Replay Engine
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-400 border border-violet-500/30 tracking-wide">New</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5 flex items-center gap-2">
            <LiveDot />
            Animated fallback-chain replay — every routing decision, leg by leg
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          data-testid="btn-refresh-replay"
          className="gap-1.5"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Stat label="Total Runs"       value={totalRuns}           />
        <Stat label="Connection Rate"  value={`${connRate}%`}      color="text-green-400" />
        <Stat label="Connected"        value={connectedRuns}        color="text-green-400" />
        <Stat label="Failed"           value={failedRuns}           color="text-red-400"   />
        <Stat label="Multi-Leg"        value={multiLegRuns}         color="text-amber-400" />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
          {(["all", "connected", "failed"] as OutcomeFilter[]).map(f => (
            <button
              key={f}
              data-testid={`filter-${f}`}
              onClick={() => setFilter(f)}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-medium transition-colors capitalize",
                filter === f
                  ? f === "connected" ? "bg-green-500/15 text-green-400"
                  : f === "failed"    ? "bg-red-500/15 text-red-400"
                  : "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {f}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5 border border-border rounded-lg px-3 py-1.5 text-sm">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Filter by run ID…"
            value={runIdFilter}
            onChange={e => setRunIdFilter(e.target.value)}
            data-testid="input-run-filter"
            className="bg-transparent text-xs outline-none placeholder:text-muted-foreground/50 w-32"
          />
        </div>

        {filteredGroups.length !== allGroups.length && (
          <span className="text-xs text-muted-foreground">
            Showing {filteredGroups.length} of {allGroups.length} runs
          </span>
        )}
      </div>

      {/* Run list */}
      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-24 rounded-xl border border-border bg-muted/10 animate-pulse" />
          ))}
        </div>
      ) : filteredGroups.length === 0 ? (
        <div className="rounded-2xl border border-border/50 bg-card p-16 text-center space-y-3">
          <div className="w-14 h-14 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center mx-auto">
            <Radio className="h-6 w-6 text-violet-400" />
          </div>
          <p className="text-sm font-medium">No route traces found</p>
          <p className="text-xs text-muted-foreground max-w-xs mx-auto">
            Route decision traces are recorded when synthetic test campaigns run. Start a test campaign to generate replay data.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <AnimatePresence initial={false}>
            {filteredGroups.slice(0, 50).map((group, i) => (
              <motion.div
                key={group.runId ?? `norun-${group.legs[0]?.id}`}
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, delay: Math.min(i * 0.04, 0.3) }}
              >
                <RunCard group={group} initialExpanded={i === 0 && filteredGroups.length === 1} />
              </motion.div>
            ))}
          </AnimatePresence>
          {filteredGroups.length > 50 && (
            <p className="text-xs text-muted-foreground text-center py-2">
              Showing first 50 of {filteredGroups.length} runs — use filters to narrow down
            </p>
          )}
        </div>
      )}
    </div>
  );
}

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import {
  Play, Pause, RotateCcw, ChevronDown, ChevronRight,
  CheckCircle2, XCircle, AlertTriangle, Clock, Zap,
  ArrowDown, Filter, BarChart3, Activity, Rewind,
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
  candidateRoutes: string | null;
  decisionReason: string | null;
  outcome: string | null;
  sipCode: number | null;
  pddMs: number | null;
  durationSec: number | null;
  failureCategory: string | null;
  createdAt: string;
}

interface ReplayStep {
  id: string;
  label: string;
  detail: string;
  type: "engine" | "evaluate" | "select" | "transmit" | "success" | "fail" | "fallback" | "pdd";
  carrier?: string;
  sipCode?: number | null;
}

// ── Step builder ──────────────────────────────────────────────────────────────

function buildSteps(traces: RouteTrace[]): ReplayStep[] {
  const steps: ReplayStep[] = [];

  steps.push({
    id: "engine",
    label: "LCR Engine",
    detail: `Routing decision initiated for ${traces[0]?.cld ?? "unknown"} — evaluating ${traces.length > 1 ? "with fallbacks" : "carrier"}`,
    type: "engine",
  });

  // Parse candidates from first trace
  const candidates = parseCandidates(traces[0]?.candidateRoutes);
  if (candidates.length > 0) {
    steps.push({
      id: "eval",
      label: "Candidate Evaluation",
      detail: `${candidates.length} route${candidates.length === 1 ? "" : "s"} evaluated: ${candidates.slice(0, 5).join(" · ")}${candidates.length > 5 ? ` +${candidates.length - 5} more` : ""}`,
      type: "evaluate",
    });
  }

  // Build each trace as a hop
  traces.forEach((t, idx) => {
    const isFallback = idx > 0;

    if (isFallback) {
      steps.push({
        id: `fallback-${idx}`,
        label: "Fallback Triggered",
        detail: `Carrier ${traces[idx - 1].selectedCarrier ?? "unknown"} rejected — trying next route`,
        type: "fallback",
      });
    }

    if (t.selectedCarrier) {
      steps.push({
        id: `select-${idx}`,
        label: isFallback ? `Fallback Carrier #${idx + 1}` : "Carrier Selected",
        detail: `${t.selectedCarrier}${t.decisionReason ? ` — ${t.decisionReason}` : ""}`,
        type: "select",
        carrier: t.selectedCarrier,
      });
    }

    if (t.pddMs != null && t.pddMs > 0) {
      steps.push({
        id: `pdd-${idx}`,
        label: "Post-Dial Delay",
        detail: `${t.pddMs.toFixed(0)} ms${t.pddMs > 5000 ? " ⚠ elevated" : " — normal"}`,
        type: "pdd",
      });
    }

    if (t.outcome === "connected") {
      steps.push({
        id: `success-${idx}`,
        label: "Call Connected",
        detail: `Duration: ${t.durationSec != null && t.durationSec > 0 ? `${t.durationSec}s` : "—"} · via ${t.selectedCarrier ?? "—"}`,
        type: "success",
      });
    } else {
      const cat = t.failureCategory ? ` [${t.failureCategory}]` : "";
      steps.push({
        id: `fail-${idx}`,
        label: idx < traces.length - 1 ? "Carrier Rejected" : "Call Failed",
        detail: `SIP ${t.sipCode ?? "—"}${cat}`,
        type: idx < traces.length - 1 ? "fallback" : "fail",
        sipCode: t.sipCode,
      });
    }
  });

  return steps;
}

function parseCandidates(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    if (Array.isArray(arr)) return arr.map((c: any) => typeof c === "string" ? c : (c.name ?? c.carrierId ?? "?"));
  } catch { /* no-op */ }
  return [];
}

// ── Step icon + colours ───────────────────────────────────────────────────────

const TYPE_STYLE: Record<string, { icon: React.ReactNode; dot: string; line: string; label: string }> = {
  engine:   { icon: <Zap className="h-3.5 w-3.5" />,           dot: "bg-violet-500 text-white",    line: "bg-violet-500/30", label: "text-violet-300" },
  evaluate: { icon: <BarChart3 className="h-3.5 w-3.5" />,     dot: "bg-blue-500 text-white",      line: "bg-blue-500/30",   label: "text-blue-300"   },
  select:   { icon: <Activity className="h-3.5 w-3.5" />,      dot: "bg-indigo-500 text-white",    line: "bg-indigo-500/30", label: "text-indigo-300" },
  transmit: { icon: <ArrowDown className="h-3.5 w-3.5" />,     dot: "bg-cyan-500 text-white",      line: "bg-cyan-500/30",   label: "text-cyan-300"   },
  pdd:      { icon: <Clock className="h-3.5 w-3.5" />,         dot: "bg-amber-500 text-black",     line: "bg-amber-500/30",  label: "text-amber-300"  },
  fallback: { icon: <AlertTriangle className="h-3.5 w-3.5" />, dot: "bg-orange-500 text-white",    line: "bg-orange-500/30", label: "text-orange-300" },
  success:  { icon: <CheckCircle2 className="h-3.5 w-3.5" />,  dot: "bg-green-500 text-white",     line: "bg-green-500/30",  label: "text-green-300"  },
  fail:     { icon: <XCircle className="h-3.5 w-3.5" />,       dot: "bg-red-500 text-white",       line: "bg-red-500/30",    label: "text-red-300"    },
};

// ── Replay timeline component ─────────────────────────────────────────────────

function ReplayTimeline({ traces }: { traces: RouteTrace[] }) {
  const steps = buildSteps(traces);
  const [visibleCount, setVisibleCount] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<300 | 500 | 800>(500);

  function startReplay() {
    setPlaying(true);
    setVisibleCount(0);
    steps.forEach((_, i) => {
      setTimeout(() => {
        setVisibleCount(i + 1);
        if (i === steps.length - 1) setPlaying(false);
      }, i * speed);
    });
  }

  function resetReplay() {
    setPlaying(false);
    setVisibleCount(0);
  }

  const finalOutcome = traces[traces.length - 1]?.outcome;

  return (
    <div>
      {/* Controls */}
      <div className="flex items-center gap-3 mb-5">
        <Button
          data-testid="replay-play-btn"
          size="sm"
          onClick={startReplay}
          disabled={playing}
          className="gap-1.5 bg-violet-600 hover:bg-violet-700 text-white"
        >
          <Play className="h-3.5 w-3.5" />
          {playing ? "Playing…" : "Play Replay"}
        </Button>
        <Button size="sm" variant="outline" onClick={resetReplay} disabled={playing} className="gap-1.5">
          <RotateCcw className="h-3.5 w-3.5" /> Reset
        </Button>
        <div className="flex items-center gap-1 text-xs text-muted-foreground ml-2">
          Speed:
          {([300, 500, 800] as const).map(s => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              className={cn("px-2 py-0.5 rounded border text-xs transition-colors",
                speed === s ? "border-violet-500/50 bg-violet-500/10 text-violet-400" : "border-border text-muted-foreground hover:bg-muted/40")}
            >
              {s === 300 ? "Fast" : s === 500 ? "Normal" : "Slow"}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {finalOutcome === "connected" ? (
          <Badge className="bg-green-500/15 text-green-400 border-green-500/20">Connected</Badge>
        ) : (
          <Badge className="bg-red-500/15 text-red-400 border-red-500/20">Failed</Badge>
        )}
      </div>

      {/* Show all steps dimmed if not started yet */}
      <div className="space-y-0">
        {steps.map((step, i) => {
          const style = TYPE_STYLE[step.type] ?? TYPE_STYLE.engine;
          const visible = visibleCount > i;
          const isLast = i === steps.length - 1;
          return (
            <div key={step.id} className="flex items-start gap-3">
              <div className="flex flex-col items-center">
                <motion.div
                  animate={{ opacity: visible ? 1 : 0.15, scale: visible ? 1 : 0.85 }}
                  transition={{ duration: 0.2 }}
                  className={cn("w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0", style.dot)}
                >
                  {style.icon}
                </motion.div>
                {!isLast && (
                  <motion.div
                    animate={{ opacity: visible ? 0.5 : 0.1 }}
                    className={cn("w-0.5 flex-1 my-1 min-h-[16px]", style.line)}
                  />
                )}
              </div>
              <motion.div
                animate={{ opacity: visible ? 1 : 0.2, x: visible ? 0 : -4 }}
                transition={{ duration: 0.25 }}
                className="flex-1 pb-4 min-w-0"
              >
                <p className={cn("text-sm font-semibold leading-tight", style.label)}>{step.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{step.detail}</p>
              </motion.div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Group traces by runId ─────────────────────────────────────────────────────

function groupByRun(traces: RouteTrace[]): Map<string, RouteTrace[]> {
  const map = new Map<string, RouteTrace[]>();
  for (const t of traces) {
    const key = t.runId != null ? `run:${t.runId}` : `single:${t.id}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(t);
  }
  return map;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ReplayEnginePage() {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const { data: traces = [], isLoading } = useQuery<RouteTrace[]>({
    queryKey: ["/api/route-traces"],
    queryFn: () => fetch("/api/route-traces?limit=200").then(r => r.json()),
    refetchInterval: 60_000,
  });

  const groups = groupByRun(traces);
  const keys   = Array.from(groups.keys());

  const filtered = filter
    ? keys.filter(k => {
        const ts = groups.get(k)!;
        return ts.some(t =>
          t.selectedCarrier?.toLowerCase().includes(filter.toLowerCase()) ||
          t.cld.includes(filter) ||
          t.failureCategory?.toLowerCase().includes(filter.toLowerCase())
        );
      })
    : keys;

  const selectedTraces = selectedKey ? (groups.get(selectedKey) ?? []) : null;

  // Auto-select first on load
  useEffect(() => {
    if (!selectedKey && keys.length > 0) setSelectedKey(keys[0]);
  }, [keys.length]);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Rewind className="h-6 w-6 text-violet-400" />
          Route Decision Replay Engine
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-400 border border-violet-500/30 tracking-wide">New</span>
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Step-by-step visual reconstruction of routing decisions, carrier selection, fallback chains, and call outcomes
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
        {/* Left: session list */}
        <Card className="border-border/50 h-fit lg:sticky lg:top-4">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="h-4 w-4 text-violet-400" />
              Route Sessions
              <span className="ml-auto text-xs font-normal text-muted-foreground">{filtered.length} sessions</span>
            </CardTitle>
            <div className="flex items-center gap-2 mt-1">
              <Filter className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
              <input
                data-testid="input-replay-filter"
                type="text"
                placeholder="Filter by carrier or CLD…"
                value={filter}
                onChange={e => setFilter(e.target.value)}
                className="flex-1 h-7 rounded border border-border bg-transparent px-2 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="space-y-2 p-4">
                {[1,2,3].map(i => <div key={i} className="h-12 bg-muted/20 rounded animate-pulse" />)}
              </div>
            ) : filtered.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6">No route sessions yet</p>
            ) : (
              <div className="max-h-[calc(100vh-320px)] overflow-y-auto">
                {filtered.map(k => {
                  const ts = groups.get(k)!;
                  const last = ts[ts.length - 1];
                  const hasFallback = ts.length > 1;
                  const isSelected = selectedKey === k;
                  return (
                    <button
                      key={k}
                      data-testid={`replay-session-${k}`}
                      onClick={() => setSelectedKey(k)}
                      className={cn(
                        "w-full text-left px-4 py-3 border-b border-border/30 hover:bg-muted/30 transition-colors",
                        isSelected && "bg-violet-500/10 border-l-2 border-l-violet-500"
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-medium truncate flex-1">{ts[0].cld}</span>
                        {last.outcome === "connected"
                          ? <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
                          : <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-muted-foreground truncate">
                          {ts[0].selectedCarrier ?? "unknown"}
                          {hasFallback && <span className="text-orange-400 ml-1">→ +{ts.length - 1} fallback</span>}
                        </span>
                        <span className="text-[10px] text-muted-foreground/60 ml-auto flex-shrink-0">
                          {new Date(ts[0].createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right: replay timeline */}
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Play className="h-4 w-4 text-violet-400" />
              {selectedTraces ? (
                <>
                  Replay: <span className="font-mono">{selectedTraces[0].cld}</span>
                  {selectedTraces.length > 1 && (
                    <Badge className="bg-orange-500/15 text-orange-400 border-orange-500/20 text-xs ml-1">
                      {selectedTraces.length} hops
                    </Badge>
                  )}
                </>
              ) : "Select a session to replay"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!selectedTraces ? (
              <div className="text-center py-12 text-muted-foreground text-sm">
                Select a route session from the list to see its animated replay
              </div>
            ) : (
              <ReplayTimeline traces={selectedTraces} />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

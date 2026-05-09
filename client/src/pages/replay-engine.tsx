import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import {
  Play, Pause, RotateCcw, ChevronDown, ChevronRight,
  CheckCircle2, XCircle, AlertTriangle, Clock, Zap,
  ArrowDown, Filter, BarChart3, Activity, Rewind, GitBranch, List,
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
    detail: `Routing initiated for ${traces[0]?.cld ?? "unknown"} — ${traces.length > 1 ? "fallback chain engaged" : "single attempt"}`,
    type: "engine",
  });
  const candidates = parseCandidates(traces[0]?.candidateRoutes);
  if (candidates.length > 0) {
    steps.push({
      id: "eval",
      label: "Candidate Evaluation",
      detail: `${candidates.length} route${candidates.length === 1 ? "" : "s"} evaluated: ${candidates.slice(0, 5).join(" · ")}${candidates.length > 5 ? ` +${candidates.length - 5} more` : ""}`,
      type: "evaluate",
    });
  }
  traces.forEach((t, idx) => {
    const isFallback = idx > 0;
    if (isFallback) {
      steps.push({
        id: `fallback-${idx}`,
        label: "Fallback Triggered",
        detail: `${traces[idx - 1].selectedCarrier ?? "previous carrier"} rejected — routing to next candidate`,
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
    if ((t.pddMs ?? 0) > 0) {
      steps.push({
        id: `pdd-${idx}`,
        label: "Post-Dial Delay",
        detail: `${t.pddMs?.toFixed(0)} ms${(t.pddMs ?? 0) > 5000 ? " ⚠ elevated" : " — within range"}`,
        type: "pdd",
      });
    }
    if (t.outcome === "connected") {
      steps.push({
        id: `success-${idx}`,
        label: "Call Connected",
        detail: `Duration: ${t.durationSec && t.durationSec > 0 ? `${t.durationSec}s` : "—"} · via ${t.selectedCarrier ?? "—"}`,
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

// ── Step style lookup ─────────────────────────────────────────────────────────

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

// ── SVG: Animated edge ────────────────────────────────────────────────────────

function AnimatedEdge({
  x1, y1, x2, y2,
  color = "#6366f1",
  visible = true,
  dashed = false,
  opacity = 0.65,
  delay = 0,
}: {
  x1: number; y1: number; x2: number; y2: number;
  color?: string; visible?: boolean; dashed?: boolean;
  opacity?: number; delay?: number;
}) {
  return (
    <motion.path
      d={`M ${x1} ${y1} L ${x2} ${y2}`}
      stroke={color}
      strokeWidth={1.8}
      strokeDasharray={dashed ? "5 4" : undefined}
      fill="none"
      strokeLinecap="round"
      initial={{ pathLength: 0, opacity: 0 }}
      animate={{ pathLength: visible ? 1 : 0, opacity: visible ? opacity : 0 }}
      transition={{ duration: 0.38, delay, ease: "easeOut" }}
    />
  );
}

// ── SVG: Branching Graph ──────────────────────────────────────────────────────

function BranchingGraph({ traces, steps, visibleCount }: {
  traces: RouteTrace[];
  steps: ReplayStep[];
  visibleCount: number;
}) {
  const candidates   = parseCandidates(traces[0]?.candidateRoutes);
  const visibleIds   = new Set(steps.slice(0, visibleCount).map(s => s.id));

  // Layout
  const W          = 460;
  const CX         = W / 2;
  const HUB_R      = 24;
  const HUB_Y      = 44;
  const EVAL_Y     = 112;
  const CAND_Y     = candidates.length > 0 ? 168 : EVAL_Y;
  const CHIP_W     = 76;
  const CHIP_H     = 22;
  const CHIP_GAP   = 6;
  const FIRST_HOP_Y = candidates.length > 0 ? CAND_Y + CHIP_H + 52 : EVAL_Y + 52;
  const HOP_H      = 130;
  const SVG_H      = FIRST_HOP_Y + traces.length * HOP_H + 55;

  // Visibility helpers
  const hubVis  = visibleIds.has("engine");
  const evalVis = visibleIds.has("eval") || (candidates.length === 0 && hubVis);
  const candVis = evalVis;

  const hopVis     = (i: number) => visibleIds.has(`select-${i}`);
  const pddVis     = (i: number) => visibleIds.has(`pdd-${i}`);
  const outVis     = (i: number) => visibleIds.has(`success-${i}`) || visibleIds.has(`fail-${i}`);
  const fbVis      = (i: number) => visibleIds.has(`fallback-${i}`) || hopVis(i + 1);

  const hopY       = (i: number) => FIRST_HOP_Y + i * HOP_H;
  const pddYFor    = (i: number) => hopY(i) + 58;
  const outcomeYFor = (i: number) => {
    const hasPdd = (traces[i]?.pddMs ?? 0) > 0;
    return hasPdd ? pddYFor(i) + 48 : hopY(i) + 58;
  };

  const carrierColor = (i: number) => {
    if (i < traces.length - 1 && traces[i].outcome !== "connected") return "#ef4444";
    return traces[i].outcome === "connected" ? "#22c55e" : "#ef4444";
  };

  // Candidate chips
  const displayCands  = candidates.slice(0, 6);
  const totalCandW    = displayCands.length * CHIP_W + (displayCands.length - 1) * CHIP_GAP;
  const candStartX    = CX - totalCandW / 2;

  // Selected candidate chip X for edge routing
  const selCandIdx = displayCands.findIndex(c =>
    (traces[0]?.selectedCarrier ?? "").toLowerCase().includes(c.toLowerCase()) ||
    c.toLowerCase().includes((traces[0]?.selectedCarrier ?? "").toLowerCase())
  );
  const selCandCX = selCandIdx >= 0
    ? candStartX + selCandIdx * (CHIP_W + CHIP_GAP) + CHIP_W / 2
    : CX;

  return (
    <div className="overflow-x-auto flex justify-center">
      <svg
        width={W}
        height={SVG_H}
        viewBox={`0 0 ${W} ${SVG_H}`}
        style={{ fontFamily: "'JetBrains Mono', monospace" }}
      >
        {/* Defs */}
        <defs>
          <radialGradient id="rg-hub" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#7c3aed" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="rg-success" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#22c55e" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#22c55e" stopOpacity="0" />
          </radialGradient>
          <pattern id="bg-grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(255,255,255,0.025)" strokeWidth="0.5" />
          </pattern>
          <filter id="f-glow">
            <feGaussianBlur stdDeviation="3" result="coloredBlur" />
            <feMerge><feMergeNode in="coloredBlur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* Background */}
        <rect width={W} height={SVG_H} fill="rgba(10,12,22,0.95)" rx={12} />
        <rect width={W} height={SVG_H} fill="url(#bg-grid)" rx={12} />

        {/* ── Hub ── */}
        {hubVis && (
          <>
            <motion.circle
              cx={CX} cy={HUB_Y} r={44}
              fill="url(#rg-hub)"
              animate={{ r: [40, 52, 40] }}
              transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.g
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              style={{ transformOrigin: `${CX}px ${HUB_Y}px` }}
              transition={{ type: "spring", stiffness: 320, damping: 22 }}
            >
              <circle cx={CX} cy={HUB_Y} r={HUB_R} fill="#13082a" stroke="#7c3aed" strokeWidth={2} />
              <motion.circle
                cx={CX} cy={HUB_Y} r={HUB_R + 5}
                fill="none" stroke="#7c3aed" strokeWidth={0.8}
                animate={{ r: [HUB_R + 3, HUB_R + 10, HUB_R + 3], opacity: [0.6, 0, 0.6] }}
                transition={{ duration: 2.6, repeat: Infinity }}
              />
              <text x={CX} y={HUB_Y - 4} textAnchor="middle" fontSize={8} fill="#a78bfa" fontWeight="bold">LCR</text>
              <text x={CX} y={HUB_Y + 8} textAnchor="middle" fontSize={7} fill="#7c3aed">Engine</text>
            </motion.g>
          </>
        )}

        {/* ── Hub → Eval edge ── */}
        <AnimatedEdge x1={CX} y1={HUB_Y + HUB_R} x2={CX} y2={EVAL_Y - 16} color="#7c3aed" visible={hubVis && evalVis} />

        {/* ── Eval node ── */}
        {evalVis && (
          <motion.g initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
            <rect x={CX - 82} y={EVAL_Y - 16} width={164} height={32} rx={6}
              fill="#0a1628" stroke="#3b82f6" strokeWidth={1.5} />
            <text x={CX} y={EVAL_Y - 2} textAnchor="middle" fontSize={8.5} fill="#93c5fd" fontWeight="bold">
              {candidates.length > 0 ? `${candidates.length} candidates evaluated` : "Direct routing"}
            </text>
            <text x={CX} y={EVAL_Y + 9} textAnchor="middle" fontSize={7.5} fill="#60a5fa" opacity={0.65}>
              LCR policy applied
            </text>
          </motion.g>
        )}

        {/* ── Candidate chips ── */}
        {candVis && displayCands.map((cand, ci) => {
          const chipX  = candStartX + ci * (CHIP_W + CHIP_GAP);
          const chipCX = chipX + CHIP_W / 2;
          const isSelected = ci === selCandIdx ||
            (traces[0]?.selectedCarrier ?? "").toLowerCase().includes(cand.toLowerCase()) ||
            cand.toLowerCase().includes((traces[0]?.selectedCarrier ?? "").toLowerCase());
          const isRejected = traces.some(t => t.selectedCarrier && !isSelected &&
            (t.selectedCarrier.toLowerCase().includes(cand.toLowerCase()) || cand.toLowerCase().includes(t.selectedCarrier.toLowerCase()))
          );
          return (
            <motion.g key={ci}
              initial={{ opacity: 0, scale: 0.75 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: ci * 0.055, type: "spring", stiffness: 280, damping: 22 }}
            >
              <AnimatedEdge
                x1={CX} y1={EVAL_Y + 16}
                x2={chipCX} y2={CAND_Y}
                color={isSelected ? "#22c55e" : "#1e293b"}
                opacity={isSelected ? 0.7 : 0.2}
                visible
              />
              <rect x={chipX} y={CAND_Y} width={CHIP_W} height={CHIP_H} rx={11}
                fill={isSelected ? "rgba(34,197,94,0.12)" : "rgba(30,41,59,0.5)"}
                stroke={isSelected ? "#22c55e" : "#334155"}
                strokeWidth={isSelected ? 1.5 : 0.8}
              />
              <text x={chipCX} y={CAND_Y + CHIP_H / 2 + 4} textAnchor="middle"
                fontSize={7} fill={isSelected ? "#86efac" : "#475569"}
                fontWeight={isSelected ? "bold" : "normal"}
              >
                {cand.slice(0, 11)}
              </text>
              {isSelected && (
                <text x={chipX + CHIP_W - 6} y={CAND_Y + 8} textAnchor="middle" fontSize={9} fill="#22c55e">✓</text>
              )}
            </motion.g>
          );
        })}

        {/* ── Hop nodes ── */}
        {traces.map((t, i) => {
          const cColor      = carrierColor(i);
          const hasPdd      = (t.pddMs ?? 0) > 0;
          const isLast      = i === traces.length - 1;
          const failed      = t.outcome !== "connected";
          const cY          = hopY(i);
          const pY          = pddYFor(i);
          const oY          = outcomeYFor(i);

          // Source Y for edge to this carrier
          const srcY = i === 0
            ? (candidates.length > 0 ? CAND_Y + CHIP_H : EVAL_Y + 16)
            : outcomeYFor(i - 1) + 16;
          const srcX = i === 0 ? (selCandIdx >= 0 ? selCandCX : CX) : CX;

          return (
            <g key={i}>
              {/* Edge into this carrier */}
              {hopVis(i) && (
                <AnimatedEdge
                  x1={srcX} y1={srcY} x2={CX} y2={cY - 22}
                  color={i > 0 ? "#f97316" : (failed ? "#ef4444" : "#22c55e")}
                  dashed={i > 0}
                  visible
                />
              )}

              {/* Fallback label on edge */}
              {i > 0 && hopVis(i) && (
                <motion.text
                  x={CX + 8} y={srcY + (cY - 22 - srcY) / 2}
                  fontSize={7.5} fill="#f97316" opacity={0.8}
                  initial={{ opacity: 0 }} animate={{ opacity: 0.8 }} transition={{ delay: 0.2 }}
                >
                  fallback
                </motion.text>
              )}

              {/* Carrier circle */}
              {hopVis(i) && (
                <motion.g
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  style={{ transformOrigin: `${CX}px ${cY}px` }}
                  transition={{ type: "spring", stiffness: 280, damping: 20 }}
                >
                  {!failed && (
                    <motion.circle cx={CX} cy={cY} r={30}
                      fill="url(#rg-success)"
                      animate={{ r: [28, 36, 28] }}
                      transition={{ duration: 2.2, repeat: Infinity }}
                      filter="url(#f-glow)"
                    />
                  )}
                  <circle cx={CX} cy={cY} r={22}
                    fill={failed ? "rgba(239,68,68,0.08)" : "rgba(34,197,94,0.08)"}
                    stroke={cColor} strokeWidth={2}
                    filter={!failed ? "url(#f-glow)" : undefined}
                  />
                  <text x={CX} y={cY - 6} textAnchor="middle" fontSize={7.5} fill={cColor} fontWeight="bold">
                    {i > 0 ? `Fallback ${i}` : "Selected"}
                  </text>
                  <text x={CX} y={cY + 5} textAnchor="middle" fontSize={7}
                    fill={failed ? "#fca5a5" : "#86efac"}>
                    {(t.selectedCarrier ?? "unknown").slice(0, 14)}
                  </text>
                  <text x={CX + 18} y={cY - 18} textAnchor="middle" fontSize={11}
                    fill={failed ? "#ef4444" : "#22c55e"} filter="url(#f-glow)">
                    {failed ? "✗" : "✓"}
                  </text>
                </motion.g>
              )}

              {/* PDD badge */}
              {hasPdd && pddVis(i) && (
                <motion.g initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.25 }}>
                  <AnimatedEdge x1={CX} y1={cY + 22} x2={CX} y2={pY - 11} color="#f59e0b" visible />
                  <rect x={CX - 48} y={pY - 11} width={96} height={22} rx={4}
                    fill="rgba(245,158,11,0.08)" stroke="#f59e0b" strokeWidth={1} />
                  <text x={CX} y={pY + 4} textAnchor="middle" fontSize={8} fill="#fbbf24">
                    PDD: {t.pddMs?.toFixed(0)}ms{(t.pddMs ?? 0) > 4500 ? " ⚠" : ""}
                  </text>
                </motion.g>
              )}

              {/* Outcome box */}
              {outVis(i) && (
                <motion.g
                  initial={{ scale: 0.85, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  style={{ transformOrigin: `${CX}px ${oY}px` }}
                  transition={{ type: "spring", stiffness: 260, damping: 22 }}
                >
                  <AnimatedEdge
                    x1={CX}
                    y1={hasPdd ? pY + 11 : cY + 22}
                    x2={CX} y2={oY - 16}
                    color={failed ? "#ef4444" : "#22c55e"}
                    visible
                  />
                  {!failed && (
                    <motion.rect
                      x={CX - 74} y={oY - 17} width={148} height={34} rx={8}
                      fill="rgba(34,197,94,0.12)"
                      animate={{ opacity: [0.12, 0.28, 0.12] }}
                      transition={{ duration: 2, repeat: Infinity }}
                    />
                  )}
                  <rect x={CX - 72} y={oY - 16} width={144} height={32} rx={8}
                    fill={failed ? "rgba(239,68,68,0.08)" : "rgba(34,197,94,0.08)"}
                    stroke={failed ? "#ef4444" : "#22c55e"}
                    strokeWidth={1.5}
                    filter={!failed ? "url(#f-glow)" : undefined}
                  />
                  <text x={CX} y={oY - 2} textAnchor="middle" fontSize={9}
                    fill={failed ? "#fca5a5" : "#86efac"} fontWeight="bold">
                    {failed ? "Call Failed" : "Connected ✓"}
                  </text>
                  <text x={CX} y={oY + 9} textAnchor="middle" fontSize={7.5}
                    fill={failed ? "#fca5a5" : "#86efac"} opacity={0.65}>
                    {failed
                      ? `SIP ${t.sipCode ?? "—"}${t.failureCategory ? ` · ${t.failureCategory}` : ""}`
                      : t.durationSec && t.durationSec > 0 ? `${t.durationSec}s · ${t.selectedCarrier ?? ""}` : (t.selectedCarrier ?? "")}
                  </text>
                </motion.g>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ── Step-list timeline (existing, kept as "Steps" tab) ────────────────────────

function ReplayTimeline({ traces, steps }: { traces: RouteTrace[]; steps: ReplayStep[] }) {
  const [visibleCount, setVisibleCount] = useState(0);
  const [playing, setPlaying]           = useState(false);
  const [speed, setSpeed]               = useState<300 | 500 | 800>(500);

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
  function resetReplay() { setPlaying(false); setVisibleCount(0); }

  const finalOutcome = traces[traces.length - 1]?.outcome;

  return (
    <div>
      <div className="flex items-center gap-3 mb-5">
        <Button size="sm" onClick={startReplay} disabled={playing}
          className="gap-1.5 bg-violet-600 hover:bg-violet-700 text-white" data-testid="replay-play-btn">
          <Play className="h-3.5 w-3.5" />
          {playing ? "Playing…" : "Play Replay"}
        </Button>
        <Button size="sm" variant="outline" onClick={resetReplay} disabled={playing} className="gap-1.5">
          <RotateCcw className="h-3.5 w-3.5" /> Reset
        </Button>
        <div className="flex items-center gap-1 text-xs text-muted-foreground ml-2">
          Speed:
          {([300, 500, 800] as const).map(s => (
            <button key={s} onClick={() => setSpeed(s)}
              className={cn("px-2 py-0.5 rounded border text-xs transition-colors",
                speed === s ? "border-violet-500/50 bg-violet-500/10 text-violet-400" : "border-border text-muted-foreground hover:bg-muted/40")}>
              {s === 300 ? "Fast" : s === 500 ? "Normal" : "Slow"}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {finalOutcome === "connected"
          ? <Badge className="bg-green-500/15 text-green-400 border-green-500/20">Connected</Badge>
          : <Badge className="bg-red-500/15 text-red-400 border-red-500/20">Failed</Badge>}
      </div>
      <div className="space-y-0">
        {steps.map((step, i) => {
          const style   = TYPE_STYLE[step.type] ?? TYPE_STYLE.engine;
          const visible = visibleCount > i;
          const isLast  = i === steps.length - 1;
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
                  <motion.div animate={{ opacity: visible ? 0.5 : 0.1 }}
                    className={cn("w-0.5 flex-1 my-1 min-h-[16px]", style.line)} />
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

// ── Graph replay (own play state) ─────────────────────────────────────────────

function GraphReplay({ traces, steps }: { traces: RouteTrace[]; steps: ReplayStep[] }) {
  const [visibleCount, setVisibleCount] = useState(0);
  const [playing, setPlaying]           = useState(false);
  const [speed, setSpeed]               = useState<300 | 500 | 800>(500);

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
  function resetReplay() { setPlaying(false); setVisibleCount(0); }

  const finalOutcome = traces[traces.length - 1]?.outcome;

  return (
    <div>
      {/* Graph controls */}
      <div className="flex items-center gap-3 mb-4">
        <Button size="sm" onClick={startReplay} disabled={playing}
          className="gap-1.5 bg-violet-600 hover:bg-violet-700 text-white" data-testid="graph-play-btn">
          <Play className="h-3.5 w-3.5" />
          {playing ? "Animating…" : "Animate Graph"}
        </Button>
        <Button size="sm" variant="outline" onClick={resetReplay} disabled={playing} className="gap-1.5">
          <RotateCcw className="h-3.5 w-3.5" /> Reset
        </Button>
        <div className="flex items-center gap-1 text-xs text-muted-foreground ml-2">
          Speed:
          {([300, 500, 800] as const).map(s => (
            <button key={s} onClick={() => setSpeed(s)}
              className={cn("px-2 py-0.5 rounded border text-xs transition-colors",
                speed === s ? "border-violet-500/50 bg-violet-500/10 text-violet-400" : "border-border text-muted-foreground hover:bg-muted/40")}>
              {s === 300 ? "Fast" : s === 500 ? "Normal" : "Slow"}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {finalOutcome === "connected"
          ? <Badge className="bg-green-500/15 text-green-400 border-green-500/20">Connected</Badge>
          : <Badge className="bg-red-500/15 text-red-400 border-red-500/20">Failed</Badge>}
      </div>

      {/* SVG graph */}
      <BranchingGraph traces={traces} steps={steps} visibleCount={visibleCount} />

      {/* Legend */}
      <div className="flex items-center gap-4 mt-3 text-[10px] text-muted-foreground/60 font-mono flex-wrap">
        {[
          { color: "bg-violet-500", label: "LCR Engine" },
          { color: "bg-blue-500",   label: "Evaluation" },
          { color: "bg-green-500",  label: "Selected / Connected" },
          { color: "bg-red-500",    label: "Failed / Rejected" },
          { color: "bg-amber-500",  label: "PDD delay" },
          { color: "bg-orange-500", label: "Fallback path" },
        ].map(l => (
          <span key={l.label} className="flex items-center gap-1.5">
            <span className={cn("w-2 h-2 rounded-full flex-shrink-0", l.color)} />
            {l.label}
          </span>
        ))}
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
  const [selectedKey, setSelectedKey]   = useState<string | null>(null);
  const [filter, setFilter]             = useState("");
  const [activeTab, setActiveTab]       = useState<"graph" | "steps">("graph");

  const { data: traces = [], isLoading } = useQuery<RouteTrace[]>({
    queryKey: ["/api/route-traces"],
    queryFn: () => fetch("/api/route-traces?limit=200").then(r => r.json()),
    refetchInterval: 60_000,
  });

  const groups  = groupByRun(traces);
  const keys    = Array.from(groups.keys());

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
  const selectedSteps  = selectedTraces ? buildSteps(selectedTraces) : [];

  useEffect(() => {
    if (!selectedKey && keys.length > 0) setSelectedKey(keys[0]);
  }, [keys.length]);

  // Reset tab animation state when session changes
  useEffect(() => {
    setActiveTab("graph");
  }, [selectedKey]);

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
          Animated SVG branching graph of routing decisions, carrier selection, fallback chains, and call outcomes
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6">
        {/* Left: session list */}
        <Card className="border-border/50 h-fit lg:sticky lg:top-4">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="h-4 w-4 text-violet-400" />
              Route Sessions
              <span className="ml-auto text-xs font-normal text-muted-foreground">{filtered.length}</span>
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
                  const ts       = groups.get(k)!;
                  const last     = ts[ts.length - 1];
                  const hasFb    = ts.length > 1;
                  const isSelected = selectedKey === k;
                  return (
                    <button key={k} data-testid={`replay-session-${k}`}
                      onClick={() => setSelectedKey(k)}
                      className={cn(
                        "w-full text-left px-4 py-3 border-b border-border/30 hover:bg-muted/30 transition-colors",
                        isSelected && "bg-violet-500/10 border-l-2 border-l-violet-500"
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-medium truncate flex-1">{ts[0].cld}</span>
                        <span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0",
                          last.outcome === "connected" ? "bg-green-500" : "bg-red-500")} />
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-muted-foreground truncate">
                          {ts[0].selectedCarrier ?? "unknown"}
                          {hasFb && <span className="text-orange-400 ml-1">→ +{ts.length - 1} fallback</span>}
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

        {/* Right: replay view */}
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <CardTitle className="text-sm flex items-center gap-2 flex-1">
                {activeTab === "graph"
                  ? <GitBranch className="h-4 w-4 text-violet-400" />
                  : <List className="h-4 w-4 text-violet-400" />}
                {selectedTraces ? (
                  <>
                    {activeTab === "graph" ? "Routing Decision Graph" : "Step-by-Step Replay"}
                    <span className="font-mono text-muted-foreground text-xs ml-1">{selectedTraces[0].cld}</span>
                    {selectedTraces.length > 1 && (
                      <Badge className="bg-orange-500/15 text-orange-400 border-orange-500/20 text-xs">
                        {selectedTraces.length} hops
                      </Badge>
                    )}
                  </>
                ) : "Select a session"}
              </CardTitle>

              {/* Tab switcher */}
              {selectedTraces && (
                <div className="flex rounded-lg border border-border overflow-hidden text-xs">
                  {(["graph", "steps"] as const).map(tab => (
                    <button key={tab} onClick={() => setActiveTab(tab)}
                      className={cn("px-3 py-1.5 flex items-center gap-1.5 transition-colors capitalize",
                        activeTab === tab ? "bg-violet-500/20 text-violet-400" : "text-muted-foreground hover:bg-muted/50")}>
                      {tab === "graph" ? <GitBranch className="h-3 w-3" /> : <List className="h-3 w-3" />}
                      {tab === "graph" ? "Graph" : "Steps"}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </CardHeader>

          <CardContent>
            {!selectedTraces ? (
              <div className="text-center py-12 text-muted-foreground text-sm">
                Select a route session from the list to begin
              </div>
            ) : (
              <AnimatePresence mode="wait">
                {activeTab === "graph" ? (
                  <motion.div key="graph"
                    initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 6 }} transition={{ duration: 0.2 }}
                  >
                    <GraphReplay traces={selectedTraces} steps={selectedSteps} />
                  </motion.div>
                ) : (
                  <motion.div key="steps"
                    initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -6 }} transition={{ duration: 0.2 }}
                  >
                    <ReplayTimeline traces={selectedTraces} steps={selectedSteps} />
                  </motion.div>
                )}
              </AnimatePresence>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

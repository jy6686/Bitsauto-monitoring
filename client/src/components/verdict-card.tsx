import { cn } from "@/lib/utils";
import { ShieldCheck, ShieldAlert, AlertTriangle, HelpCircle, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";

export type VerdictState = "HEALTHY" | "STABLE" | "AT_RISK" | "CRITICAL" | "UNSCORED";
export type CiState = "HEALTHY" | "STABLE" | "DEGRADED" | "CRITICAL" | "FAS_RISK" | "UNSCORED";
export type Confidence = "HIGH" | "MEDIUM" | "LOW" | "NONE";
export type Corroboration = "YES" | "PARTIAL" | "NONE";

export interface VerdictCardData {
  connection: string;
  ci: {
    state: CiState;
    healthScore: number;
    confidence: Confidence;
    asr: number;
    totalCalls: number;
  };
  aiOps: {
    recentEvents: Array<{ severity: string; type: string; message: string; ts: string }>;
    corroborationLevel: Corroboration;
  };
  overlayVerdict: {
    state: VerdictState;
    reasoning: string[];
  };
}

const VERDICT_CFG: Record<VerdictState, { label: string; icon: React.ReactNode; ring: string; badge: string }> = {
  HEALTHY:  { label: "Healthy",  icon: <ShieldCheck className="w-4 h-4" />, ring: "ring-emerald-500/30", badge: "bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border-emerald-500/30" },
  STABLE:   { label: "Stable",   icon: <ShieldCheck className="w-4 h-4" />, ring: "ring-blue-500/30",    badge: "bg-blue-500/10 text-blue-500 dark:text-blue-400 border-blue-500/30"       },
  AT_RISK:  { label: "At Risk",  icon: <AlertTriangle className="w-4 h-4" />, ring: "ring-amber-500/30",badge: "bg-amber-500/10 text-amber-500 dark:text-amber-400 border-amber-500/30"   },
  CRITICAL: { label: "Critical", icon: <ShieldAlert className="w-4 h-4" />, ring: "ring-red-500/40",    badge: "bg-red-500/10 text-red-500 dark:text-red-400 border-red-500/30"           },
  UNSCORED: { label: "Unscored", icon: <HelpCircle className="w-4 h-4" />, ring: "ring-muted",          badge: "bg-muted/50 text-muted-foreground border-muted"                           },
};

const CI_STATE_COLOR: Record<CiState, string> = {
  HEALTHY:  "text-emerald-500 dark:text-emerald-400",
  STABLE:   "text-blue-500 dark:text-blue-400",
  DEGRADED: "text-amber-500 dark:text-amber-400",
  CRITICAL: "text-red-500 dark:text-red-400",
  FAS_RISK: "text-purple-500 dark:text-purple-400",
  UNSCORED: "text-muted-foreground",
};

const CONF_COLOR: Record<Confidence, string> = {
  HIGH:   "text-emerald-500 dark:text-emerald-400",
  MEDIUM: "text-amber-500 dark:text-amber-400",
  LOW:    "text-red-500 dark:text-red-400",
  NONE:   "text-muted-foreground",
};

const CORROB_COLOR: Record<Corroboration, string> = {
  YES:     "text-red-500 dark:text-red-400",
  PARTIAL: "text-amber-500 dark:text-amber-400",
  NONE:    "text-muted-foreground",
};

function HealthRing({ score }: { score: number }) {
  const r = 18;
  const circ = 2 * Math.PI * r;
  const fill = Math.max(0, Math.min(1, score / 100));
  const color = score >= 70 ? "#10B981" : score >= 50 ? "#3B82F6" : score >= 30 ? "#F59E0B" : "#EF4444";
  return (
    <svg width={44} height={44} viewBox="0 0 44 44" className="shrink-0">
      <circle cx={22} cy={22} r={r} fill="none" stroke="currentColor" strokeWidth={3.5} className="text-muted/30" />
      <circle
        cx={22} cy={22} r={r} fill="none" stroke={color} strokeWidth={3.5}
        strokeDasharray={circ} strokeDashoffset={circ * (1 - fill)}
        strokeLinecap="round" transform="rotate(-90 22 22)"
        style={{ transition: "stroke-dashoffset 0.4s ease" }}
      />
      <text x={22} y={26} textAnchor="middle" fontSize={10} fontWeight={700} fill={color}>
        {score}
      </text>
    </svg>
  );
}

interface VerdictCardProps {
  data: VerdictCardData;
  compact?: boolean;
}

export function VerdictCard({ data, compact = false }: VerdictCardProps) {
  const [expanded, setExpanded] = useState(false);
  const vs = data.overlayVerdict.state as VerdictState;
  const cfg = VERDICT_CFG[vs] ?? VERDICT_CFG.UNSCORED;

  return (
    <div
      data-testid={`card-verdict-${data.connection.replace(/\s+/g, '-').toLowerCase()}`}
      className={cn(
        "rounded-xl border bg-card ring-1 transition-all",
        cfg.ring,
        compact ? "p-3" : "p-4",
      )}
    >
      {/* Header row */}
      <div className="flex items-start gap-3">
        <HealthRing score={data.ci.healthScore} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm truncate" title={data.connection}>
              {data.connection}
            </span>
            <span className={cn("inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium", cfg.badge)}>
              {cfg.icon}
              {cfg.label}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
            <span>
              CI: <span className={cn("font-medium", CI_STATE_COLOR[data.ci.state])}>{data.ci.state}</span>
            </span>
            <span>
              ASR: <span className="font-medium text-foreground">{data.ci.asr.toFixed(1)}%</span>
            </span>
            <span>
              Calls: <span className="font-medium text-foreground">{data.ci.totalCalls.toLocaleString()}</span>
            </span>
            <span>
              Conf: <span className={cn("font-medium", CONF_COLOR[data.ci.confidence])}>{data.ci.confidence}</span>
            </span>
            <span>
              AI Ops: <span className={cn("font-medium", CORROB_COLOR[data.aiOps.corroborationLevel])}>{data.aiOps.corroborationLevel}</span>
            </span>
          </div>
        </div>
        {/* Expand toggle */}
        <button
          onClick={() => setExpanded(v => !v)}
          data-testid={`btn-verdict-expand-${data.connection.replace(/\s+/g, '-').toLowerCase()}`}
          className="shrink-0 p-1 rounded hover:bg-muted/40 text-muted-foreground transition-colors"
        >
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {/* Expanded reasoning */}
      {expanded && (
        <div className="mt-3 pt-3 border-t space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Reasoning</p>
          <ul className="space-y-1">
            {data.overlayVerdict.reasoning.map((r, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <span className="mt-0.5 w-1 h-1 rounded-full bg-muted-foreground/50 shrink-0" />
                {r}
              </li>
            ))}
          </ul>
          {data.aiOps.recentEvents.length > 0 && (
            <div className="mt-2 pt-2 border-t space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Recent AI Ops Events</p>
              {data.aiOps.recentEvents.slice(0, 3).map((e, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <span className={cn("mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase",
                    e.severity === 'critical' || e.severity === 'high' ? "bg-red-500/10 text-red-500" :
                    e.severity === 'medium' ? "bg-amber-500/10 text-amber-500" : "bg-muted/50 text-muted-foreground"
                  )}>
                    {e.severity}
                  </span>
                  <span className="text-muted-foreground">{e.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

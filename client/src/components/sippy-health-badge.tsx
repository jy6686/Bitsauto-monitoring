import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Activity, AlertTriangle, WifiOff, Gauge, HelpCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface SippyHealthResponse {
  status: "healthy" | "slow" | "degraded" | "unhealthy" | "unconfigured" | "unknown";
  auth: "valid" | "invalid" | "unknown";
  latency_ms: number | null;
  last_success_call: string | null;
  error: string | null;
  error_rate: string;
  uptime_rate: string;
  total_checks: number;
  consecutive_failures: number;
  recent_checks: Array<{ at: string; ok: boolean; latencyMs: number; status: string }>;
  checked_at: string | null;
}

const STATUS_META: Record<
  SippyHealthResponse["status"],
  { label: string; dot: string; text: string; icon: typeof Activity }
> = {
  healthy:       { label: "Healthy",       dot: "bg-emerald-500",      text: "text-emerald-400", icon: Activity     },
  slow:          { label: "Slow",          dot: "bg-amber-400",        text: "text-amber-400",   icon: Gauge        },
  degraded:      { label: "Degraded",      dot: "bg-amber-500",        text: "text-amber-400",   icon: AlertTriangle},
  unhealthy:     { label: "Down",          dot: "bg-red-500",          text: "text-red-400",     icon: WifiOff      },
  unconfigured:  { label: "Not Configured",dot: "bg-slate-500",        text: "text-slate-400",   icon: HelpCircle   },
  unknown:       { label: "Checking…",     dot: "bg-slate-400 animate-pulse", text: "text-slate-400", icon: Activity },
};

interface Props {
  collapsed?: boolean;
}

export function SippyHealthBadge({ collapsed = false }: Props) {
  const { data, isLoading } = useQuery<SippyHealthResponse>({
    queryKey: ["/api/sippy/health"],
    refetchInterval: 60_000,
    staleTime:       30_000,
    retry:           false,
  });

  const status = isLoading ? "unknown" : (data?.status ?? "unknown");
  const meta   = STATUS_META[status];
  const Icon   = meta.icon;

  const latencyLabel = data?.latency_ms != null ? `${data.latency_ms} ms` : "—";
  const lastSeen     = data?.last_success_call
    ? formatDistanceToNow(new Date(data.last_success_call), { addSuffix: true })
    : null;
  const checkedLabel = data?.checked_at
    ? formatDistanceToNow(new Date(data.checked_at), { addSuffix: true })
    : null;

  const miniBar = data?.recent_checks?.slice(-10) ?? [];

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            data-testid="sippy-health-badge"
            className={cn(
              "flex items-center cursor-default select-none transition-colors",
              collapsed
                ? "justify-center p-1"
                : "gap-2 px-2 py-1.5 rounded-lg hover:bg-muted/40"
            )}
          >
            {/* Animated dot */}
            <span className="relative flex items-center justify-center flex-shrink-0">
              <span
                className={cn(
                  "h-2 w-2 rounded-full flex-shrink-0",
                  meta.dot,
                  status === "healthy" && "shadow-[0_0_6px_1px] shadow-emerald-500/60"
                )}
              />
              {status === "healthy" && (
                <span className="absolute h-2 w-2 rounded-full bg-emerald-500 animate-ping opacity-60" />
              )}
            </span>

            {/* Text (hidden when collapsed) */}
            {!collapsed && (
              <div className="flex flex-col min-w-0">
                <span className={cn("text-[10px] font-semibold leading-none truncate", meta.text)}>
                  Sippy API
                </span>
                <span className="text-[9px] text-muted-foreground/60 leading-tight font-mono mt-0.5 truncate">
                  {meta.label}{data?.latency_ms != null ? ` · ${latencyLabel}` : ""}
                </span>
              </div>
            )}
          </div>
        </TooltipTrigger>

        <TooltipContent
          side="right"
          align="end"
          className="w-64 p-0 overflow-hidden rounded-xl border border-border bg-card shadow-xl"
          data-testid="sippy-health-tooltip"
        >
          {/* Header */}
          <div className={cn(
            "flex items-center gap-2 px-3 py-2.5 border-b border-border/60",
            status === "healthy"   && "bg-emerald-500/10",
            status === "slow"      && "bg-amber-500/10",
            status === "degraded"  && "bg-amber-600/10",
            status === "unhealthy" && "bg-red-500/10",
          )}>
            <Icon className={cn("h-4 w-4 flex-shrink-0", meta.text)} />
            <div className="flex-1 min-w-0">
              <p className={cn("text-xs font-bold leading-none", meta.text)}>
                Sippy Softswitch API
              </p>
              <p className="text-[10px] text-muted-foreground/70 mt-0.5 font-mono">
                {meta.label}
              </p>
            </div>
            <span
              className={cn(
                "text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide",
                status === "healthy"      && "bg-emerald-500/20 text-emerald-300",
                status === "slow"         && "bg-amber-500/20   text-amber-300",
                status === "degraded"     && "bg-amber-600/20   text-amber-300",
                status === "unhealthy"    && "bg-red-500/20     text-red-300",
                (status === "unknown" || status === "unconfigured") && "bg-slate-500/20 text-slate-300",
              )}
            >
              {meta.label}
            </span>
          </div>

          {/* Metrics grid */}
          <div className="grid grid-cols-2 gap-0 divide-x divide-y divide-border/40 border-b border-border/40">
            <MetricCell label="Latency"    value={latencyLabel} />
            <MetricCell label="Auth"       value={data?.auth === "valid" ? "Valid ✓" : data?.auth === "invalid" ? "Invalid ✗" : "—"} />
            <MetricCell label="Error Rate" value={data?.error_rate ?? "—"} />
            <MetricCell label="Uptime"     value={data?.uptime_rate ?? "—"} />
          </div>

          {/* Recent checks mini-bar */}
          {miniBar.length > 0 && (
            <div className="px-3 py-2 border-b border-border/40">
              <p className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-1.5 font-semibold">
                Last {miniBar.length} checks
              </p>
              <div className="flex items-end gap-0.5 h-5">
                {miniBar.map((c, i) => (
                  <div
                    key={i}
                    title={`${c.ok ? "OK" : "FAIL"} — ${c.latencyMs}ms`}
                    style={{ height: c.ok ? `${Math.min(100, Math.round((c.latencyMs / 3000) * 100) + 30)}%` : "100%" }}
                    className={cn(
                      "flex-1 rounded-sm min-h-[4px]",
                      c.ok ? "bg-emerald-500/70" : "bg-red-500/70"
                    )}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="px-3 py-2 space-y-0.5">
            {data?.error && (
              <p className="text-[10px] text-red-400 font-mono truncate" data-testid="health-error-text">
                ⚠ {data.error}
              </p>
            )}
            {lastSeen && (
              <p className="text-[9px] text-muted-foreground/50 font-mono">
                Last OK: {lastSeen}
              </p>
            )}
            {checkedLabel && (
              <p className="text-[9px] text-muted-foreground/40 font-mono">
                Checked: {checkedLabel}
              </p>
            )}
            <p className="text-[9px] text-muted-foreground/30 font-mono">
              Total probes: {data?.total_checks ?? 0}  ·  Refreshes every 60 s
            </p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 px-3 py-1.5">
      <span className="text-[9px] text-muted-foreground/50 uppercase tracking-widest font-semibold">{label}</span>
      <span className="text-xs font-mono font-bold text-foreground/90">{value}</span>
    </div>
  );
}

import { useState, useEffect } from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

type FreshnessStatus = "live" | "fresh" | "aging" | "stale";

function getFreshnessStatus(ageMs: number, intervalMs: number): FreshnessStatus {
  if (ageMs < intervalMs * 0.5) return "live";
  if (ageMs < intervalMs * 1.2) return "fresh";
  if (ageMs < intervalMs * 2.5) return "aging";
  return "stale";
}

function formatAge(ageMs: number): string {
  const s = Math.floor(ageMs / 1000);
  if (s < 5)  return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

const STATUS_STYLES: Record<FreshnessStatus, { dot: string; text: string; label: string }> = {
  live:   { dot: "bg-green-500",  text: "text-green-400",              label: "LIVE"   },
  fresh:  { dot: "bg-green-400",  text: "text-green-400/70",           label: "FRESH"  },
  aging:  { dot: "bg-amber-400",  text: "text-amber-400/80",           label: "AGING"  },
  stale:  { dot: "bg-red-500",    text: "text-red-400",                label: "STALE"  },
};

interface FreshnessIndicatorProps {
  updatedAt: number | null | undefined;
  intervalMs: number;
  isFetching?: boolean;
  className?: string;
  showLabel?: boolean;
}

export function FreshnessIndicator({
  updatedAt,
  intervalMs,
  isFetching = false,
  className,
  showLabel = false,
}: FreshnessIndicatorProps) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);

  if (!updatedAt) return null;

  const ageMs  = now - updatedAt;
  const status = getFreshnessStatus(ageMs, intervalMs);
  const styles = STATUS_STYLES[status];

  return (
    <span
      className={cn("inline-flex items-center gap-1.5 font-mono", className)}
      title={`Data age: ${formatAge(ageMs)}`}
    >
      {isFetching ? (
        <RefreshCw className="w-2.5 h-2.5 text-cyan-400 animate-spin" />
      ) : (
        <span className="relative inline-flex">
          {status === "live" && (
            <span
              className={cn("absolute rounded-full animate-ping opacity-70", styles.dot)}
              style={{ width: 6, height: 6, top: 0, left: 0 }}
            />
          )}
          <span className={cn("relative rounded-full", styles.dot)} style={{ width: 6, height: 6 }} />
        </span>
      )}
      <span className={cn("text-[10px] tracking-wide", styles.text)}>
        {showLabel
          ? `${styles.label} · ${formatAge(ageMs)}`
          : formatAge(ageMs)}
      </span>
    </span>
  );
}

interface PanelHeaderProps {
  label: string;
  updatedAt?: number | null;
  intervalMs?: number;
  isFetching?: boolean;
  children?: React.ReactNode;
  className?: string;
}

export function PanelHeader({
  label,
  updatedAt,
  intervalMs = 30_000,
  isFetching,
  children,
  className,
}: PanelHeaderProps) {
  return (
    <div className={cn("flex items-center justify-between mb-3", className)}>
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground/50 font-mono">
        {label}
      </p>
      <div className="flex items-center gap-3">
        {children}
        {updatedAt != null && (
          <FreshnessIndicator
            updatedAt={updatedAt}
            intervalMs={intervalMs}
            isFetching={isFetching}
          />
        )}
      </div>
    </div>
  );
}

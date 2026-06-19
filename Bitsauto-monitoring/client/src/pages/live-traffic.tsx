import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useLiveTrafficWs } from "@/hooks/use-live-traffic-ws";
import type { LiveTrafficSnapshot, LiveTrafficRow } from "@/types/live-traffic";
import { Activity, TrendingUp, TrendingDown, Minus, Users, Network, Wifi, WifiOff } from "lucide-react";

const WINDOWS = ["1m", "5m", "15m", "1h"] as const;
type WindowKey = typeof WINDOWS[number];

const WINDOW_LABELS: Record<WindowKey, string> = {
  "1m":  "Last 1 min",
  "5m":  "Last 5 min",
  "15m": "Last 15 min",
  "1h":  "Last 1 hour",
};

function asrColor(asr: number): string {
  if (asr === 0) return "text-muted-foreground";
  if (asr < 40)  return "text-red-500 dark:text-red-400 font-semibold";
  if (asr < 65)  return "text-amber-500 dark:text-amber-400";
  return "text-emerald-500 dark:text-emerald-400";
}

function asrRowBg(asr: number): string {
  if (asr === 0) return "";
  if (asr < 40)  return "bg-red-500/5 dark:bg-red-500/10";
  if (asr < 65)  return "bg-amber-500/5 dark:bg-amber-500/10";
  return "";
}

function DeltaBadge({ delta }: { delta: number | null }) {
  if (delta === null) return <span className="text-muted-foreground text-xs">—</span>;
  if (Math.abs(delta) < 0.1) return (
    <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
      <Minus className="w-3 h-3" /> 0.0%
    </span>
  );
  if (delta > 0) return (
    <span className="inline-flex items-center gap-0.5 text-xs text-emerald-500 dark:text-emerald-400 font-medium">
      <TrendingUp className="w-3 h-3" />+{delta.toFixed(1)}%
    </span>
  );
  return (
    <span className="inline-flex items-center gap-0.5 text-xs text-red-500 dark:text-red-400 font-medium">
      <TrendingDown className="w-3 h-3" />{delta.toFixed(1)}%
    </span>
  );
}

function fmtAcd(sec: number): string {
  if (!sec) return "0s";
  if (sec < 60) return `${sec.toFixed(0)}s`;
  return `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`;
}

function fmtAge(iso: string): string {
  const secs = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 5) return "just now";
  if (secs < 60) return `${secs}s ago`;
  return `${Math.floor(secs / 60)}m ago`;
}

interface TrafficTableProps {
  title: string;
  icon: React.ReactNode;
  rows: LiveTrafficRow[];
  emptyMsg: string;
  testIdPrefix: string;
}

function TrafficTable({ title, icon, rows, emptyMsg, testIdPrefix }: TrafficTableProps) {
  return (
    <div className="flex flex-col min-h-0 border rounded-xl bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b bg-muted/40">
        {icon}
        <span className="font-semibold text-sm">{title}</span>
        <Badge variant="secondary" className="ml-auto text-xs" data-testid={`badge-count-${testIdPrefix}`}>
          {rows.length} entities
        </Badge>
      </div>
      <div className="overflow-auto flex-1">
        {rows.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
            {emptyMsg}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-muted-foreground text-xs">
                <th className="text-left px-4 py-2 font-medium">Name</th>
                <th className="text-right px-3 py-2 font-medium">Calls</th>
                <th className="text-right px-3 py-2 font-medium">Billable</th>
                <th className="text-right px-3 py-2 font-medium">ASR</th>
                <th className="text-right px-3 py-2 font-medium">ACD</th>
                <th className="text-right px-4 py-2 font-medium">Δ ASR</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={row.name}
                  data-testid={`row-${testIdPrefix}-${i}`}
                  className={cn(
                    "border-b last:border-0 hover:bg-muted/40 transition-colors",
                    asrRowBg(row.asr),
                  )}
                >
                  <td className="px-4 py-2 font-medium truncate max-w-[180px]" title={row.name}>
                    {row.iConnection ? (
                      <Link
                        href={`/routing-manager?tab=connections&iConnection=${row.iConnection}`}
                        className="hover:text-primary hover:underline transition-colors"
                        data-testid={`link-traffic-conn-${row.iConnection}`}
                      >
                        {row.name}
                      </Link>
                    ) : row.name}
                  </td>
                  <td className="text-right px-3 py-2 tabular-nums">{row.calls.toLocaleString()}</td>
                  <td className="text-right px-3 py-2 tabular-nums">{row.billable.toLocaleString()}</td>
                  <td className={cn("text-right px-3 py-2 tabular-nums", asrColor(row.asr))}>
                    {row.asr.toFixed(1)}%
                  </td>
                  <td className="text-right px-3 py-2 tabular-nums text-muted-foreground">
                    {fmtAcd(row.acd)}
                  </td>
                  <td className="text-right px-4 py-2">
                    <DeltaBadge delta={row.delta} />
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

export default function LiveTrafficPage() {
  const [window, setWindow] = useState<WindowKey>("5m");

  const { data: initialData } = useQuery<LiveTrafficSnapshot>({
    queryKey: ["/api/live-traffic/snapshot"],
  });

  const { snapshot: wsSnapshot, connected } = useLiveTrafficWs();

  const snapshot = wsSnapshot ?? initialData ?? null;
  const winData = snapshot?.windows?.[window] ?? null;

  const origRows = useMemo(() => winData?.origination ?? [], [winData]);
  const termRows = useMemo(() => winData?.termination ?? [], [winData]);

  return (
    <div className="flex flex-col gap-5 p-4 md:p-6 h-full min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-emerald-500/10 text-emerald-500 dark:text-emerald-400">
            <Activity className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold leading-tight">Live Traffic Intelligence</h1>
            <p className="text-xs text-muted-foreground">
              Rolling ASR/ACD — CDR-cache computed, no Sippy polling overhead
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Live status */}
          <div
            className={cn(
              "flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border",
              connected
                ? "border-emerald-500/30 text-emerald-500 dark:text-emerald-400 bg-emerald-500/10"
                : "border-muted text-muted-foreground bg-muted/40",
            )}
            data-testid="status-live-connection"
          >
            {connected ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
            {connected ? "Live" : "Connecting…"}
          </div>
          {/* Last updated */}
          {snapshot?.computedAt && (
            <span className="text-xs text-muted-foreground" data-testid="text-computed-at">
              Updated {fmtAge(snapshot.computedAt)}
            </span>
          )}
        </div>
      </div>

      {/* Overall stats strip */}
      {winData && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Total Calls", value: winData.totalCalls.toLocaleString(), id: "total-calls" },
            { label: "Billable", value: winData.totalBillable.toLocaleString(), id: "total-billable" },
            {
              label: "Overall ASR",
              value: `${winData.overallAsr.toFixed(1)}%`,
              id: "overall-asr",
              colored: true,
              asr: winData.overallAsr,
            },
          ].map(s => (
            <div
              key={s.id}
              data-testid={`stat-${s.id}`}
              className="border rounded-lg bg-card px-4 py-3"
            >
              <p className="text-xs text-muted-foreground mb-0.5">{s.label}</p>
              <p className={cn("text-xl font-bold tabular-nums", s.colored ? asrColor(s.asr ?? 0) : "")}>
                {s.value}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Window selector */}
      <div className="flex items-center gap-1 bg-muted/40 rounded-lg p-1 w-fit border" role="group">
        {WINDOWS.map(w => (
          <button
            key={w}
            data-testid={`btn-window-${w}`}
            onClick={() => setWindow(w)}
            className={cn(
              "px-3 py-1.5 rounded-md text-sm font-medium transition-all",
              window === w
                ? "bg-background shadow text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {w}
          </button>
        ))}
        <span className="ml-2 text-xs text-muted-foreground pr-1">{WINDOW_LABELS[window]}</span>
      </div>

      {/* Tables */}
      {!snapshot ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          <Activity className="w-5 h-5 animate-pulse mr-2" />
          Loading traffic data…
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 flex-1 min-h-0">
          <TrafficTable
            title="Origination"
            icon={<Users className="w-4 h-4 text-blue-500 dark:text-blue-400" />}
            rows={origRows}
            emptyMsg={`No origination calls in the last ${window}`}
            testIdPrefix="orig"
          />
          <TrafficTable
            title="Termination"
            icon={<Network className="w-4 h-4 text-purple-500 dark:text-purple-400" />}
            rows={termRows}
            emptyMsg={`No termination data in the last ${window}`}
            testIdPrefix="term"
          />
        </div>
      )}
    </div>
  );
}

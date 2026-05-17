import { useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  DollarSign, ArrowLeft, PhoneCall, Clock, TrendingUp,
  BarChart2, FileText, RefreshCw, AlertTriangle, CheckCircle2,
  Minus, ExternalLink,
} from "lucide-react";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from "recharts";
import { cn } from "@/lib/utils";
import { BSE_GRID_PROPS, BSE_AXIS_PROPS, BseTooltip, BseGradStops, bseActiveDot } from "@/components/bse-chart";
import { Skeleton } from "@/components/ui/skeleton";

// ── Types ────────────────────────────────────────────────────────────────────

interface BillingData {
  connId: number;
  connName: string;
  vendorName: string;
  totalCalls: number;
  billableCalls: number;
  totalMinutes: number;
  totalCost: number;
  avgCostPerMin: number;
  asr: number;
  daily: { date: string; calls: number; cost: number; minutes: number }[];
  recent: {
    callId: string;
    cli: string;
    cld: string;
    setupTime: string;
    duration: number;
    cost: number;
    result: string;
  }[];
  updatedAt: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtUSD(n: number) {
  return `$${n.toFixed(4)}`;
}

function fmtMins(mins: number) {
  if (mins < 60) return `${mins.toFixed(1)} min`;
  return `${(mins / 60).toFixed(2)} hr`;
}

function fmtDur(secs: number) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function ResultBadge({ result }: { result: string }) {
  const ok = String(result) === "0";
  return (
    <span className={cn(
      "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold",
      ok ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"
    )}>
      {ok
        ? <><CheckCircle2 className="w-2.5 h-2.5" />OK</>
        : <><AlertTriangle className="w-2.5 h-2.5" />Fail</>}
    </span>
  );
}

// ── Summary card ─────────────────────────────────────────────────────────────

function SummaryCard({
  icon: Icon, iconColor, label, value, sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-border/50 bg-card p-4 space-y-2" data-testid={`card-billing-${label.toLowerCase().replace(/\s+/g, '-')}`}>
      <div className="flex items-center gap-1.5">
        <Icon className={cn("w-3.5 h-3.5", iconColor)} />
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      {sub && <p className="text-xs text-muted-foreground/70">{sub}</p>}
    </div>
  );
}

// ── Skeleton loader ───────────────────────────────────────────────────────────

function PageSkeleton() {
  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <Skeleton className="h-8 w-64" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
      </div>
      <Skeleton className="h-56 rounded-xl" />
      <Skeleton className="h-72 rounded-xl" />
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function BillingPage() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const connectionId = parseInt(params.get("connection") ?? "", 10);

  const { data, isLoading, isError, refetch, isFetching } = useQuery<BillingData>({
    queryKey: ["/api/billing/connection", connectionId],
    queryFn: () => fetch(`/api/billing/connection/${connectionId}`).then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    }),
    enabled: !isNaN(connectionId),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  if (isNaN(connectionId)) {
    return (
      <div className="max-w-5xl mx-auto py-20 text-center text-muted-foreground">
        <AlertTriangle className="w-8 h-8 mx-auto mb-3 text-amber-400" />
        <p className="font-medium">No connection ID provided.</p>
        <Link href="/routing-manager" className="text-indigo-400 text-sm hover:underline mt-2 inline-block">← Back to Routing Manager</Link>
      </div>
    );
  }

  if (isLoading) return <PageSkeleton />;

  if (isError || !data) {
    return (
      <div className="max-w-5xl mx-auto py-20 text-center text-muted-foreground">
        <AlertTriangle className="w-8 h-8 mx-auto mb-3 text-rose-400" />
        <p className="font-medium">Could not load billing data for connection {connectionId}.</p>
        <button onClick={() => refetch()} className="text-indigo-400 text-sm hover:underline mt-2">Retry</button>
      </div>
    );
  }

  const chartColor = "#6366f1";

  return (
    <div className="max-w-5xl mx-auto space-y-6">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/routing-manager"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-2"
            data-testid="link-back-routing-manager"
          >
            <ArrowLeft className="w-3 h-3" /> Routing Manager
          </Link>
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-2xl font-bold tracking-tight">{data.connName}</h2>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/25">
              {data.vendorName}
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Connection #{data.connId} · Billing overview from CDR cache
            {data.updatedAt && (
              <span className="ml-2 text-muted-foreground/60">
                · updated {new Date(data.updatedAt).toLocaleTimeString()}
              </span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="button-refresh-billing"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border/50 bg-card/60 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", isFetching && "animate-spin")} />
            Refresh
          </button>
          <Link
            href="/billing-disputes"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border/50 bg-card/60 text-xs text-muted-foreground hover:text-foreground transition-colors"
            data-testid="link-billing-disputes"
          >
            <FileText className="w-3.5 h-3.5" />
            Billing Disputes
            <ExternalLink className="w-3 h-3" />
          </Link>
        </div>
      </div>

      {/* ── Summary strip ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard
          icon={DollarSign}
          iconColor="text-emerald-400"
          label="Total Cost"
          value={fmtUSD(data.totalCost)}
          sub="billable CDRs only"
        />
        <SummaryCard
          icon={Clock}
          iconColor="text-blue-400"
          label="Total Minutes"
          value={fmtMins(data.totalMinutes)}
          sub={`${data.billableCalls} billable calls`}
        />
        <SummaryCard
          icon={PhoneCall}
          iconColor="text-violet-400"
          label="Total Calls"
          value={String(data.totalCalls)}
          sub={`ASR ${data.asr}%`}
        />
        <SummaryCard
          icon={TrendingUp}
          iconColor="text-amber-400"
          label="Avg Cost / Min"
          value={`$${data.avgCostPerMin.toFixed(5)}`}
          sub="per billable minute"
        />
      </div>

      {/* ── Daily cost chart ────────────────────────────────────────────────── */}
      {data.daily.length > 0 && (
        <div className="rounded-xl border border-border/50 bg-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <BarChart2 className="w-4 h-4 text-indigo-400" />
            <h3 className="text-sm font-semibold">Daily Cost Trend</h3>
            <span className="text-xs text-muted-foreground/60">({data.daily.length} days)</span>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={data.daily} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="billingGrad" x1="0" y1="0" x2="0" y2="1">
                  <BseGradStops color={chartColor} />
                </linearGradient>
              </defs>
              <CartesianGrid {...BSE_GRID_PROPS} />
              <XAxis dataKey="date" {...BSE_AXIS_PROPS}
                tickFormatter={(v: string) => v.slice(5)}
              />
              <YAxis {...BSE_AXIS_PROPS}
                tickFormatter={(v: number) => `$${v.toFixed(2)}`}
                width={52}
              />
              <Tooltip
                content={<BseTooltip formatter={(v: number) => [`$${v.toFixed(4)}`, "Cost"]} />}
              />
              <Area
                type="monotone"
                dataKey="cost"
                stroke={chartColor}
                strokeWidth={2}
                fill="url(#billingGrad)"
                activeDot={bseActiveDot(chartColor)}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Call volume bar chart ────────────────────────────────────────────── */}
      {data.daily.length > 0 && (
        <div className="rounded-xl border border-border/50 bg-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <PhoneCall className="w-4 h-4 text-violet-400" />
            <h3 className="text-sm font-semibold">Daily Call Volume</h3>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={data.daily} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid {...BSE_GRID_PROPS} />
              <XAxis dataKey="date" {...BSE_AXIS_PROPS} tickFormatter={(v: string) => v.slice(5)} />
              <YAxis {...BSE_AXIS_PROPS} width={36} />
              <Tooltip content={<BseTooltip formatter={(v: number) => [v, "Calls"]} />} />
              <Bar dataKey="calls" fill="#8b5cf6" radius={[3, 3, 0, 0]} maxBarSize={32} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Recent CDRs table ───────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border/40 flex items-center gap-2">
          <FileText className="w-4 h-4 text-muted-foreground/60" />
          <h3 className="text-sm font-semibold">Recent CDRs</h3>
          <span className="text-xs text-muted-foreground/60">last {data.recent.length} records</span>
        </div>

        {data.recent.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground/60">
            <Minus className="w-6 h-6 mx-auto mb-2 opacity-40" />
            <p className="text-sm">No CDRs in cache for this connection yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/30 bg-muted/20">
                  {["Time", "CLI", "CLD", "Duration", "Cost", "Status"].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left font-semibold text-muted-foreground/70 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.recent.map((cdr, i) => (
                  <tr
                    key={cdr.callId || i}
                    className="border-b border-border/20 last:border-0 hover:bg-muted/20 transition-colors"
                    data-testid={`row-cdr-${i}`}
                  >
                    <td className="px-4 py-2.5 font-mono text-muted-foreground whitespace-nowrap">
                      {cdr.setupTime
                        ? new Date(cdr.setupTime).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })
                        : "—"}
                    </td>
                    <td className="px-4 py-2.5 font-mono">{cdr.cli || "—"}</td>
                    <td className="px-4 py-2.5 font-mono">{cdr.cld || "—"}</td>
                    <td className="px-4 py-2.5 tabular-nums text-right font-mono">{cdr.duration > 0 ? fmtDur(cdr.duration) : "—"}</td>
                    <td className="px-4 py-2.5 tabular-nums text-right font-mono text-emerald-400">{cdr.cost > 0 ? `$${cdr.cost.toFixed(5)}` : "—"}</td>
                    <td className="px-4 py-2.5"><ResultBadge result={cdr.result} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
}

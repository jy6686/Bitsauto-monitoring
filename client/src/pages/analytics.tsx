import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  TrendingUp, TrendingDown, DollarSign, BarChart2, RefreshCw, Building2,
  Zap, Target, Globe, Phone, Clock, AlertTriangle, Upload, FileSpreadsheet,
  CheckCircle2, ChevronUp, ChevronDown, Minus, Info, Search,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { BseTooltip, BSE_GRID_PROPS, BSE_AXIS_PROPS, BSE_CURSOR, BseGradStops, bseActiveDot } from "@/components/bse-chart";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

// ── Types ──────────────────────────────────────────────────────────────────────
type DayPnL = { date: string; revenue: number; cost: number; profit: number; calls: number };
type ClientRow = { name: string; calls: number; minutes: number; revenue: number; cost: number; profit: number; margin: number };
type DestRow   = { country: string; breakout: string; calls: number; minutes: number; revenue: number; cost: number; profit: number; margin: number; vendorRate: number | null; asr: number; acd: number };
type RateCard  = { id: number; name: string; vendorName: string; cardType: string; entryCount: number };
type MarginData = {
  period: { days: number; since: string };
  summary: { totalRevenue: number; totalCost: number; totalProfit: number; margin: number; totalCalls: number; totalMinutes: number };
  daily: DayPnL[];
  byClient: ClientRow[];
  byDestination: DestRow[];
  worstRoutes: DestRow[];
  rateCards: RateCard[];
  selectedVendorCardId: number | null;
  vendorDataLimited: boolean;
  _source: string;
  _cdrCount?: number;
  _cacheSize?: number;
};

// ── Helpers ────────────────────────────────────────────────────────────────────
const fmt$ = (n: number) => `$${n.toFixed(2)}`;
const fmtPct = (n: number) => `${n.toFixed(1)}%`;
const fmtN = (n: number) => n.toLocaleString();
const PERIOD_OPTS = [{ label: "7d", days: 7 }, { label: "30d", days: 30 }, { label: "60d", days: 60 }, { label: "90d", days: 90 }];
const TABS = ["Overview", "By Client", "By Destination", "Worst Routes", "Rate Import", "P&L Report"] as const;
type Tab = typeof TABS[number];

type PnlRow = {
  date: string;
  calls: number;
  durationSec: number;
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
};
type PnlReport = {
  ok: boolean;
  period: string;
  fetchedAt: string;
  rows: PnlRow[];
  totals: PnlRow;
};

const CHART_COLORS = { revenue: "#10b981", cost: "#ef4444", profit: "#3b82f6" };
const BAR_COLORS = ["#10b981","#3b82f6","#8b5cf6","#f59e0b","#ef4444","#06b6d4","#ec4899","#84cc16","#f97316","#a855f7"];

function marginColor(m: number) {
  if (m >= 20) return "bg-emerald-500/20 text-emerald-400";
  if (m >= 10) return "bg-yellow-500/20 text-yellow-400";
  if (m >= 0)  return "bg-orange-500/20 text-orange-400";
  return "bg-red-500/20 text-red-400";
}
function marginTextColor(m: number) {
  if (m >= 20) return "text-emerald-400";
  if (m >= 10) return "text-yellow-400";
  if (m >= 0)  return "text-orange-400";
  return "text-red-400";
}

// ── Sub-components ─────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, icon, color }: { label: string; value: string; sub?: string; icon: React.ReactNode; color: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
      <div className={`${color} opacity-70 shrink-0`}>{icon}</div>
      <div className="min-w-0">
        <div className={`text-xl font-bold truncate ${color}`}>{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
        {sub && <div className="text-xs text-muted-foreground/60 mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

function SortIcon({ active, asc }: { active: boolean; asc: boolean }) {
  return active ? (asc ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />) : <Minus className="h-3 w-3 opacity-20" />;
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function AnalyticsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("Overview");
  const [days, setDays] = useState(30);
  const [vendorCardId, setVendorCardId] = useState<string>("");
  const [threshold, setThreshold] = useState(10);
  const [destSearch, setDestSearch] = useState("");
  const [clientSort, setClientSort] = useState<{ col: keyof ClientRow; asc: boolean }>({ col: "revenue", asc: false });
  const [destSort, setDestSort] = useState<{ col: keyof DestRow; asc: boolean }>({ col: "revenue", asc: false });

  // Rate import state
  const [importCardId, setImportCardId] = useState<string>("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<{ inserted: number; skipped: number; cardId: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // P&L Report state
  const today = new Date().toISOString().slice(0, 10);
  const thirtyAgo = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString().slice(0, 10);
  const [pnlFrom, setPnlFrom] = useState(thirtyAgo);
  const [pnlTo,   setPnlTo]   = useState(today);
  const [pnlFetch, setPnlFetch] = useState(false);

  const { data: pnlData, isLoading: pnlLoading, error: pnlError, refetch: pnlRefetch } = useQuery<PnlReport>({
    queryKey: ["/api/analytics/pnl", pnlFrom, pnlTo],
    queryFn: async () => {
      const params = new URLSearchParams({ from: pnlFrom, to: pnlTo });
      const r = await fetch(`/api/analytics/pnl?${params}`);
      const json = await r.json();
      if (!r.ok) throw new Error(json.message ?? "P&L fetch failed");
      return json;
    },
    enabled: pnlFetch,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const queryKey = ["/api/analytics/margin", days, vendorCardId, threshold];

  const { data, isLoading, isFetching, refetch, error } = useQuery<MarginData>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({ days: String(days), threshold: String(threshold) });
      if (vendorCardId) params.set("vendorCardId", vendorCardId);
      const r = await fetch(`/api/analytics/margin?${params}`);
      const json = await r.json();
      if (!r.ok) throw new Error(json.message ?? "Failed to load margin analytics");
      return json;
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const summary   = data?.summary;
  const daily     = data?.daily     ?? [];
  const byClient  = data?.byClient  ?? [];
  const byDest    = data?.byDestination ?? [];
  const worst     = data?.worstRoutes   ?? [];
  const rateCards = data?.rateCards ?? [];
  const vendorCards = rateCards.filter(c => c.cardType === "vendor");

  // Sorted client rows
  const sortedClients = [...byClient].sort((a, b) => {
    const v = clientSort.asc ? 1 : -1;
    const av = a[clientSort.col] as number; const bv = b[clientSort.col] as number;
    return typeof av === "number" ? (av - bv) * v : String(av).localeCompare(String(bv)) * v;
  });
  function toggleClientSort(col: keyof ClientRow) {
    setClientSort(s => s.col === col ? { col, asc: !s.asc } : { col, asc: false });
  }

  // Filtered + sorted destination rows
  const filteredDest = byDest.filter(d =>
    !destSearch || d.country.toLowerCase().includes(destSearch.toLowerCase()) ||
    (d.breakout || "").toLowerCase().includes(destSearch.toLowerCase())
  );
  const sortedDest = [...filteredDest].sort((a, b) => {
    const v = destSort.asc ? 1 : -1;
    const av = a[destSort.col] as number; const bv = b[destSort.col] as number;
    return typeof av === "number" ? (av - bv) * v : String(av).localeCompare(String(bv)) * v;
  });
  function toggleDestSort(col: keyof DestRow) {
    setDestSort(s => s.col === col ? { col, asc: !s.asc } : { col, asc: false });
  }

  // Chart data
  const dailyChartData = daily.map(d => ({
    date: d.date.slice(5),
    Revenue: d.revenue,
    Cost: d.cost,
    Profit: d.profit,
  }));
  const clientBarData = sortedClients.slice(0, 10).map((c, i) => ({
    name: c.name.length > 14 ? c.name.slice(0, 12) + "…" : c.name,
    Revenue: +c.revenue.toFixed(2),
    Cost: +c.cost.toFixed(2),
    Profit: +c.profit.toFixed(2),
    color: BAR_COLORS[i % BAR_COLORS.length],
  }));

  // File upload mutation
  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!importCardId || !importFile) throw new Error("Select a rate card and file first");
      const res = await fetch(`/api/rate-cards/${importCardId}/upload`, {
        method: "POST",
        headers: { "Content-Type": importFile.name.endsWith(".csv") ? "text/csv" : "application/octet-stream" },
        body: importFile,
        credentials: "include",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? "Upload failed");
      return json;
    },
    onSuccess: (json) => {
      setImportResult({ inserted: json.inserted, skipped: json.skipped ?? 0, cardId: Number(importCardId) });
      setImportFile(null);
      if (fileRef.current) fileRef.current.value = "";
      toast({ title: "Rate card imported", description: `${json.inserted} entries loaded successfully.` });
      qc.invalidateQueries({ queryKey: ["/api/rate-cards"] });
    },
    onError: (e: any) => {
      toast({ title: "Import failed", description: e.message, variant: "destructive" });
    },
  });

  const loading = isLoading || isFetching;

  // Dest table columns
  const DEST_COLS: Array<{ key: keyof DestRow; label: string }> = [
    { key: "country", label: "Country" },
    { key: "breakout", label: "Breakout" },
    { key: "calls", label: "Calls" },
    { key: "minutes", label: "Minutes" },
    { key: "asr", label: "ASR %" },
    { key: "acd", label: "ACD (s)" },
    { key: "revenue", label: "Revenue" },
    { key: "cost", label: "Cost" },
    { key: "profit", label: "Profit" },
    { key: "margin", label: "Margin %" },
    { key: "vendorRate", label: "Vendor ¢/min" },
  ];
  const asrColor = (asr: number) =>
    asr >= 50 ? "text-emerald-400" : asr >= 30 ? "text-amber-400" : "text-red-400";

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap gap-3 items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <TrendingUp className="h-6 w-6 text-emerald-400" />
            Revenue &amp; Margin Analytics
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Financial overlay on CDR traffic — cost vs. sell rates by client, route, and destination
          </p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          {/* Period */}
          <div className="flex gap-1 bg-muted/30 rounded-lg p-1">
            {PERIOD_OPTS.map(p => (
              <button
                key={p.days}
                data-testid={`period-${p.days}`}
                onClick={() => setDays(p.days)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${days === p.days ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {/* Vendor rate card selector */}
          <select
            data-testid="select-vendor-card"
            value={vendorCardId}
            onChange={e => setVendorCardId(e.target.value)}
            className="bg-card border border-border rounded-lg px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="">Cost method: proportional</option>
            {vendorCards.map(c => (
              <option key={c.id} value={String(c.id)}>
                {c.vendorName} — {c.name} ({c.entryCount} prefixes)
              </option>
            ))}
          </select>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={loading} data-testid="button-refresh" className="gap-1.5">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* CDR cache data source notice — shown when analytics falls back to in-memory CDR cache */}
      {data?._source?.includes('cdr-cache') && !error && (
        <div className="flex items-start gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 text-blue-400 px-4 py-3 text-xs">
          <Info className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <span className="font-medium">CDR cache data — </span>
            live analytics based on the last 72 hours of cached CDRs ({data?._cdrCount ?? 0} records).
            Sippy's date-filtered API returned no data for this period — the cache is used as a real-time fallback.
          </div>
        </div>
      )}

      {/* Source + vendor data notice */}
      {data?.vendorDataLimited && !error && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-400 px-4 py-3 text-xs">
          <Info className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <span className="font-medium">Proportional cost allocation — </span>
            vendor cost data unavailable. For precise per-route cost, upload a vendor rate card in{" "}
            <span className="font-medium">Rate Cards</span> then select it above.
          </div>
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 text-red-400 px-4 py-3 text-sm">
          <span className="font-medium">Error: </span>{(error as Error).message}
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-border">
        <div className="flex gap-0 -mb-px">
          {TABS.map(t => (
            <button
              key={t}
              data-testid={`tab-${t.toLowerCase().replace(/ /g, "-")}`}
              onClick={() => setTab(t)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                tab === t
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t}
              {t === "Worst Routes" && worst.length > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 text-xs rounded-full bg-red-500/20 text-red-400">{worst.length}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── OVERVIEW ─────────────────────────────────────────────────────────── */}
      {tab === "Overview" && (
        <div className="space-y-5">
          {isLoading ? (
            <div className="text-center text-muted-foreground py-20">Loading analytics…</div>
          ) : !summary ? (
            <div className="text-center text-muted-foreground py-20 bg-card border border-border rounded-xl">
              <BarChart2 className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <div className="font-medium mb-1">No data available</div>
              <div className="text-sm">Ensure Sippy is connected and CDRs are being captured</div>
            </div>
          ) : (
            <>
              {/* KPI Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <KpiCard label="Total Revenue"  value={fmt$(summary.totalRevenue)}  sub={`Last ${days} days`} icon={<DollarSign className="h-5 w-5" />}  color="text-emerald-400" />
                <KpiCard label="Total Cost"     value={fmt$(summary.totalCost)}     sub="Vendor interconnect"  icon={<TrendingDown className="h-5 w-5" />} color="text-red-400" />
                <KpiCard label="Gross Profit"   value={fmt$(summary.totalProfit)}   icon={<Zap className="h-5 w-5" />} color={summary.totalProfit >= 0 ? "text-blue-400" : "text-red-400"} />
                <KpiCard label="Margin"         value={fmtPct(summary.margin)}      icon={<Target className="h-5 w-5" />} color={marginTextColor(summary.margin)} />
                <KpiCard label="Total Calls"    value={fmtN(summary.totalCalls)}    sub="CDRs in period"       icon={<Phone className="h-5 w-5" />}       color="text-violet-400" />
                <KpiCard label="Total Minutes"  value={fmtN(summary.totalMinutes)}  sub="Billed minutes"       icon={<Clock className="h-5 w-5" />}        color="text-cyan-400" />
              </div>

              {/* Daily P&L Chart */}
              {dailyChartData.length > 0 && (
                <div className="bg-card border border-border rounded-xl p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <TrendingUp className="h-4 w-4 text-emerald-400" />
                    <h2 className="font-semibold text-sm">Rolling {days}-Day P&amp;L</h2>
                    <span className="text-xs text-muted-foreground ml-auto">
                      Source: {data?._source ?? "CDR"}
                    </span>
                  </div>
                  <ResponsiveContainer width="100%" height={260}>
                    <AreaChart data={dailyChartData} margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="gRev" x1="0" y1="0" x2="0" y2="1">
                          <BseGradStops color={CHART_COLORS.revenue} />
                        </linearGradient>
                        <linearGradient id="gCost" x1="0" y1="0" x2="0" y2="1">
                          <BseGradStops color={CHART_COLORS.cost} primaryOpacity={0.35} />
                        </linearGradient>
                        <linearGradient id="gProfit" x1="0" y1="0" x2="0" y2="1">
                          <BseGradStops color={CHART_COLORS.profit} primaryOpacity={0.35} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid {...BSE_GRID_PROPS} />
                      <XAxis dataKey="date" {...BSE_AXIS_PROPS} interval="preserveStartEnd" />
                      <YAxis {...BSE_AXIS_PROPS} tickFormatter={v => `$${v}`} width={52} />
                      <Tooltip content={<BseTooltip formatter={(v: number, key) => [fmt$(v), key]} />} cursor={BSE_CURSOR} />
                      <Legend wrapperStyle={{ fontSize: 10, color: 'rgba(148,163,184,0.7)' }} />
                      <Area type="monotone" dataKey="Revenue" stroke={CHART_COLORS.revenue} fill="url(#gRev)" strokeWidth={2.5} dot={false} activeDot={bseActiveDot(CHART_COLORS.revenue)} strokeLinejoin="round" strokeLinecap="round" />
                      <Area type="monotone" dataKey="Cost"    stroke={CHART_COLORS.cost}    fill="url(#gCost)"   strokeWidth={2} dot={false} activeDot={bseActiveDot(CHART_COLORS.cost)} strokeLinejoin="round" strokeLinecap="round" />
                      <Area type="monotone" dataKey="Profit"  stroke={CHART_COLORS.profit}  fill="url(#gProfit)" strokeWidth={2} dot={false} activeDot={bseActiveDot(CHART_COLORS.profit)} strokeLinejoin="round" strokeLinecap="round" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Client margin summary */}
              {byClient.length > 0 && (
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                  <div className="px-5 py-3 border-b border-border flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-primary" />
                    <span className="font-semibold text-sm">Client P&amp;L Summary</span>
                    <span className="text-xs text-muted-foreground ml-auto">Top {Math.min(byClient.length, 8)}</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border text-muted-foreground">
                          <th className="px-4 py-2 text-left">Client</th>
                          <th className="px-4 py-2 text-right">Revenue</th>
                          <th className="px-4 py-2 text-right">Cost</th>
                          <th className="px-4 py-2 text-right">Profit</th>
                          <th className="px-4 py-2 text-right">Margin</th>
                          <th className="px-4 py-2 text-right">Minutes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {byClient.slice(0, 8).map(c => (
                          <tr key={c.name} className="border-b border-border/40 hover:bg-muted/20" data-testid={`row-client-${c.name}`}>
                            <td className="px-4 py-2 font-medium max-w-[160px] truncate">{c.name}</td>
                            <td className="px-4 py-2 text-right font-mono text-emerald-400">{fmt$(c.revenue)}</td>
                            <td className="px-4 py-2 text-right font-mono text-red-400">{fmt$(c.cost)}</td>
                            <td className={`px-4 py-2 text-right font-mono ${c.profit >= 0 ? "text-blue-400" : "text-red-400"}`}>{fmt$(c.profit)}</td>
                            <td className="px-4 py-2 text-right"><Badge className={`text-xs border-0 ${marginColor(c.margin)}`}>{fmtPct(c.margin)}</Badge></td>
                            <td className="px-4 py-2 text-right text-muted-foreground">{fmtN(c.minutes)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── BY CLIENT ────────────────────────────────────────────────────────── */}
      {tab === "By Client" && (
        <div className="space-y-5">
          {clientBarData.length > 0 && (
            <div className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <Building2 className="h-4 w-4 text-primary" />
                <h2 className="font-semibold text-sm">Revenue vs Cost by Client (Top 10)</h2>
              </div>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={clientBarData} barGap={2}>
                  <CartesianGrid {...BSE_GRID_PROPS} />
                  <XAxis dataKey="name" {...BSE_AXIS_PROPS} />
                  <YAxis {...BSE_AXIS_PROPS} tickFormatter={v => `$${v}`} />
                  <Tooltip content={<BseTooltip formatter={(v: number) => [fmt$(v), '']} />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                  <Legend wrapperStyle={{ fontSize: 10, color: 'rgba(148,163,184,0.7)' }} />
                  <Bar dataKey="Revenue" fill="#10b981" radius={[3,3,0,0]} fillOpacity={0.85} />
                  <Bar dataKey="Cost"    fill="#ef4444" radius={[3,3,0,0]} fillOpacity={0.85} />
                  <Bar dataKey="Profit"  fill="#3b82f6" radius={[3,3,0,0]} fillOpacity={0.85} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-border flex items-center gap-2">
              <Building2 className="h-4 w-4 text-primary" />
              <span className="font-semibold text-sm">All Clients — P&amp;L Detail</span>
              <span className="text-xs text-muted-foreground ml-auto">{byClient.length} clients</span>
            </div>
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground text-sm">Loading…</div>
            ) : byClient.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">No client data for this period</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      {(["name","calls","minutes","revenue","cost","profit","margin"] as Array<keyof ClientRow>).map(col => (
                        <th key={col} className="px-4 py-2 text-left cursor-pointer select-none hover:text-foreground whitespace-nowrap" onClick={() => toggleClientSort(col)}>
                          <span className="flex items-center gap-1">
                            {col.charAt(0).toUpperCase() + col.slice(1)}
                            <SortIcon active={clientSort.col === col} asc={clientSort.asc} />
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedClients.map(c => (
                      <tr key={c.name} className="border-b border-border/40 hover:bg-muted/20" data-testid={`row-client-detail-${c.name}`}>
                        <td className="px-4 py-2 font-medium max-w-[180px] truncate">{c.name}</td>
                        <td className="px-4 py-2 font-mono text-muted-foreground">{fmtN(c.calls)}</td>
                        <td className="px-4 py-2 font-mono text-muted-foreground">{fmtN(c.minutes)}</td>
                        <td className="px-4 py-2 font-mono text-emerald-400">{fmt$(c.revenue)}</td>
                        <td className="px-4 py-2 font-mono text-red-400">{fmt$(c.cost)}</td>
                        <td className={`px-4 py-2 font-mono ${c.profit >= 0 ? "text-blue-400" : "text-red-400"}`}>{fmt$(c.profit)}</td>
                        <td className="px-4 py-2"><Badge className={`text-xs border-0 ${marginColor(c.margin)}`}>{fmtPct(c.margin)}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── BY DESTINATION ───────────────────────────────────────────────────── */}
      {tab === "By Destination" && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                data-testid="input-dest-search"
                value={destSearch}
                onChange={e => setDestSearch(e.target.value)}
                placeholder="Filter by country or breakout…"
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-card border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <span className="text-xs text-muted-foreground">{filteredDest.length} routes</span>
          </div>
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-border flex items-center gap-2">
              <Globe className="h-4 w-4 text-blue-400" />
              <span className="font-semibold text-sm">Margin per Destination / Breakout</span>
              {!vendorCardId && (
                <span className="text-xs text-amber-400 ml-2">proportional cost</span>
              )}
            </div>
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground text-sm">Loading…</div>
            ) : filteredDest.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">No destination data for this period</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      {DEST_COLS.map(({ key, label }) => (
                        <th key={key} className="px-3 py-2 text-left cursor-pointer select-none hover:text-foreground whitespace-nowrap" onClick={() => toggleDestSort(key as keyof DestRow)}>
                          <span className="flex items-center gap-1">
                            {label}
                            <SortIcon active={destSort.col === key} asc={destSort.asc} />
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedDest.map((d, i) => (
                      <tr key={i} className="border-b border-border/40 hover:bg-muted/20" data-testid={`row-dest-${d.country}-${i}`}>
                        <td className="px-3 py-2 font-medium whitespace-nowrap">{d.country}</td>
                        <td className="px-3 py-2 text-muted-foreground max-w-[160px] truncate">{d.breakout || "—"}</td>
                        <td className="px-3 py-2 font-mono text-muted-foreground">{fmtN(d.calls)}</td>
                        <td className="px-3 py-2 font-mono text-muted-foreground">{fmtN(d.minutes)}</td>
                        <td className={`px-3 py-2 font-mono font-semibold ${asrColor(d.asr ?? 0)}`}>{d.asr != null ? `${d.asr.toFixed(1)}%` : "—"}</td>
                        <td className="px-3 py-2 font-mono text-sky-400">{d.acd != null && d.acd > 0 ? `${d.acd.toFixed(0)}s` : "—"}</td>
                        <td className="px-3 py-2 font-mono text-emerald-400">{fmt$(d.revenue)}</td>
                        <td className="px-3 py-2 font-mono text-red-400">{fmt$(d.cost)}</td>
                        <td className={`px-3 py-2 font-mono ${d.profit >= 0 ? "text-blue-400" : "text-red-400"}`}>{fmt$(d.profit)}</td>
                        <td className="px-3 py-2"><Badge className={`text-xs border-0 ${marginColor(d.margin)}`}>{fmtPct(d.margin)}</Badge></td>
                        <td className="px-3 py-2 font-mono text-muted-foreground">
                          {d.vendorRate !== null ? `${(d.vendorRate * 100).toFixed(4)}¢` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── WORST ROUTES ─────────────────────────────────────────────────────── */}
      {tab === "Worst Routes" && (
        <div className="space-y-4">
          {/* Threshold control */}
          <div className="bg-card border border-border rounded-xl p-4 flex flex-wrap gap-4 items-center">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              <span className="text-sm font-medium">Margin threshold</span>
            </div>
            <div className="flex items-center gap-3">
              <input
                data-testid="input-threshold"
                type="range" min="0" max="30" step="1" value={threshold}
                onChange={e => setThreshold(Number(e.target.value))}
                className="w-32 accent-primary"
              />
              <span className="text-sm font-mono font-bold text-amber-400 w-10">{threshold}%</span>
            </div>
            <span className="text-xs text-muted-foreground">Routes with margin below this are flagged</span>
          </div>

          {/* Alert summary */}
          {worst.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex items-center gap-3">
                <AlertTriangle className="h-5 w-5 text-red-400 shrink-0" />
                <div>
                  <div className="text-xl font-bold text-red-400">{worst.length}</div>
                  <div className="text-xs text-muted-foreground">Routes below {threshold}%</div>
                </div>
              </div>
              <div className="bg-orange-500/10 border border-orange-500/30 rounded-xl p-4 flex items-center gap-3">
                <DollarSign className="h-5 w-5 text-orange-400 shrink-0" />
                <div>
                  <div className="text-xl font-bold text-orange-400">{fmt$(worst.reduce((s, d) => s + d.revenue, 0))}</div>
                  <div className="text-xs text-muted-foreground">Revenue at risk</div>
                </div>
              </div>
              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 flex items-center gap-3">
                <TrendingDown className="h-5 w-5 text-yellow-400 shrink-0" />
                <div>
                  <div className="text-xl font-bold text-yellow-400">{fmt$(worst.reduce((s, d) => s + d.profit, 0))}</div>
                  <div className="text-xs text-muted-foreground">Total P&amp;L on worst routes</div>
                </div>
              </div>
            </div>
          )}

          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-border flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-400" />
              <span className="font-semibold text-sm">Worst-Performing Routes</span>
              <span className="text-xs text-muted-foreground ml-auto">Margin below {threshold}% · sorted worst first</span>
            </div>
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground text-sm">Loading…</div>
            ) : worst.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">
                <CheckCircle2 className="h-8 w-8 text-emerald-400 mx-auto mb-2" />
                <div className="font-medium text-emerald-400">All routes above {threshold}% margin</div>
                <div className="mt-1">Try lowering the threshold to see more routes</div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="px-3 py-2 text-left">Country</th>
                      <th className="px-3 py-2 text-left">Breakout</th>
                      <th className="px-3 py-2 text-right">Calls</th>
                      <th className="px-3 py-2 text-right">Minutes</th>
                      <th className="px-3 py-2 text-right">ASR %</th>
                      <th className="px-3 py-2 text-right">ACD (s)</th>
                      <th className="px-3 py-2 text-right">Revenue</th>
                      <th className="px-3 py-2 text-right">Cost</th>
                      <th className="px-3 py-2 text-right">Profit</th>
                      <th className="px-3 py-2 text-right">Margin %</th>
                      <th className="px-3 py-2 text-right">Vendor ¢/min</th>
                    </tr>
                  </thead>
                  <tbody>
                    {worst.map((d, i) => (
                      <tr key={i} className="border-b border-border/40 hover:bg-muted/20" data-testid={`row-worst-${i}`}>
                        <td className="px-3 py-2 font-medium">{d.country}</td>
                        <td className="px-3 py-2 text-muted-foreground max-w-[140px] truncate">{d.breakout || "—"}</td>
                        <td className="px-3 py-2 text-right font-mono text-muted-foreground">{fmtN(d.calls)}</td>
                        <td className="px-3 py-2 text-right font-mono text-muted-foreground">{fmtN(d.minutes)}</td>
                        <td className={`px-3 py-2 text-right font-mono font-semibold ${asrColor(d.asr ?? 0)}`}>{d.asr != null ? `${d.asr.toFixed(1)}%` : "—"}</td>
                        <td className="px-3 py-2 text-right font-mono text-sky-400">{d.acd != null && d.acd > 0 ? `${d.acd.toFixed(0)}s` : "—"}</td>
                        <td className="px-3 py-2 text-right font-mono text-emerald-400">{fmt$(d.revenue)}</td>
                        <td className="px-3 py-2 text-right font-mono text-red-400">{fmt$(d.cost)}</td>
                        <td className={`px-3 py-2 text-right font-mono ${d.profit >= 0 ? "text-blue-400" : "text-red-400"}`}>{fmt$(d.profit)}</td>
                        <td className="px-3 py-2 text-right"><Badge className={`text-xs border-0 ${marginColor(d.margin)}`}>{fmtPct(d.margin)}</Badge></td>
                        <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                          {d.vendorRate !== null ? `${(d.vendorRate * 100).toFixed(4)}¢` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── RATE IMPORT ──────────────────────────────────────────────────────── */}
      {tab === "Rate Import" && (
        <div className="space-y-5 max-w-2xl">
          <div className="bg-card border border-border rounded-xl p-6 space-y-5">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-cyan-400" />
              <h2 className="font-semibold">Upload Rate Card (CSV or Excel)</h2>
            </div>
            <p className="text-xs text-muted-foreground">
              Import a vendor or client rate sheet. Expected columns: <span className="font-mono text-foreground">prefix</span> (or <span className="font-mono text-foreground">code</span>),{" "}
              <span className="font-mono text-foreground">country</span>, <span className="font-mono text-foreground">breakout</span>, and{" "}
              <span className="font-mono text-foreground">rate</span> (or <span className="font-mono text-foreground">price</span>). Column names are auto-detected.
            </p>

            {/* Rate card selector */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Target rate card</label>
              <select
                data-testid="select-import-card"
                value={importCardId}
                onChange={e => { setImportCardId(e.target.value); setImportResult(null); }}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">— Select a rate card —</option>
                {rateCards.map(c => (
                  <option key={c.id} value={String(c.id)}>
                    [{c.cardType === "vendor" ? "Vendor" : "Client"}] {c.vendorName} — {c.name}
                    {c.entryCount > 0 ? ` (${c.entryCount} prefixes)` : " (empty)"}
                  </option>
                ))}
              </select>
              {rateCards.length === 0 && (
                <p className="text-xs text-amber-400">No rate cards found. Create one in the <span className="font-medium">Rate Cards</span> page first.</p>
              )}
            </div>

            {/* File picker */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Rate sheet file</label>
              <div
                data-testid="zone-file-drop"
                onClick={() => fileRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${importFile ? "border-cyan-500/50 bg-cyan-500/5" : "border-border hover:border-primary/50 hover:bg-muted/20"}`}
              >
                <Upload className={`h-8 w-8 mx-auto mb-2 ${importFile ? "text-cyan-400" : "text-muted-foreground/50"}`} />
                {importFile ? (
                  <div>
                    <div className="text-sm font-medium text-cyan-400">{importFile.name}</div>
                    <div className="text-xs text-muted-foreground mt-1">{(importFile.size / 1024).toFixed(1)} KB — click to change</div>
                  </div>
                ) : (
                  <div>
                    <div className="text-sm font-medium">Click to select or drop a file</div>
                    <div className="text-xs text-muted-foreground mt-1">Supports .csv, .xls, .xlsx</div>
                  </div>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="hidden"
                  data-testid="input-rate-file"
                  onChange={e => { setImportFile(e.target.files?.[0] ?? null); setImportResult(null); }}
                />
              </div>
            </div>

            {/* Import result */}
            {importResult && (
              <div className="flex items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
                <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
                <div>
                  <div className="text-sm font-medium text-emerald-400">{importResult.inserted} entries imported successfully</div>
                  {importResult.skipped > 0 && (
                    <div className="text-xs text-muted-foreground">{importResult.skipped} rows skipped (invalid prefix or rate)</div>
                  )}
                </div>
              </div>
            )}

            <Button
              data-testid="button-upload-rates"
              onClick={() => uploadMutation.mutate()}
              disabled={!importCardId || !importFile || uploadMutation.isPending}
              className="gap-2 bg-cyan-600 hover:bg-cyan-700 text-white"
            >
              <Upload className="h-4 w-4" />
              {uploadMutation.isPending ? "Importing…" : "Import Rate Sheet"}
            </Button>
          </div>

          {/* Existing rate cards */}
          {rateCards.length > 0 && (
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-border flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4 text-cyan-400" />
                <span className="font-semibold text-sm">Existing Rate Cards</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="px-4 py-2 text-left">Name</th>
                      <th className="px-4 py-2 text-left">Vendor / Client</th>
                      <th className="px-4 py-2 text-left">Type</th>
                      <th className="px-4 py-2 text-right">Prefixes</th>
                      <th className="px-4 py-2 text-left">Currency</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rateCards.map(c => (
                      <tr key={c.id} className="border-b border-border/40 hover:bg-muted/20" data-testid={`row-ratecard-${c.id}`}>
                        <td className="px-4 py-2 font-medium">{c.name}</td>
                        <td className="px-4 py-2 text-muted-foreground">{c.vendorName}</td>
                        <td className="px-4 py-2">
                          <Badge className={`text-xs border-0 ${c.cardType === "vendor" ? "bg-blue-500/20 text-blue-400" : "bg-violet-500/20 text-violet-400"}`}>
                            {c.cardType}
                          </Badge>
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-muted-foreground">{c.entryCount}</td>
                        <td className="px-4 py-2 text-muted-foreground">{(c as any).currency ?? "USD"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── P&L REPORT ────────────────────────────────────────────────────────── */}
      {tab === "P&L Report" && (
        <div className="space-y-5">
          {/* Date range controls */}
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground font-medium">From</label>
                <input
                  type="date"
                  value={pnlFrom}
                  max={pnlTo}
                  onChange={e => setPnlFrom(e.target.value)}
                  data-testid="input-pnl-from"
                  className="text-sm bg-background border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground font-medium">To</label>
                <input
                  type="date"
                  value={pnlTo}
                  min={pnlFrom}
                  max={today}
                  onChange={e => setPnlTo(e.target.value)}
                  data-testid="input-pnl-to"
                  className="text-sm bg-background border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              {/* Quick range presets */}
              {([7, 14, 30, 60, 90] as const).map(d => (
                <Button
                  key={d}
                  variant="outline"
                  size="sm"
                  data-testid={`button-pnl-preset-${d}`}
                  onClick={() => {
                    const t = new Date().toISOString().slice(0, 10);
                    const f = new Date(Date.now() - d * 24 * 60 * 60_000).toISOString().slice(0, 10);
                    setPnlFrom(f); setPnlTo(t);
                  }}
                  className="text-xs h-9"
                >
                  {d}d
                </Button>
              ))}
              <Button
                data-testid="button-pnl-fetch"
                onClick={() => { setPnlFetch(true); pnlRefetch(); }}
                disabled={pnlLoading}
                className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white h-9"
              >
                {pnlLoading
                  ? <><RefreshCw className="h-4 w-4 animate-spin" /> Fetching…</>
                  : <><TrendingUp className="h-4 w-4" /> Fetch P&amp;L</>}
              </Button>
              {pnlData && (
                <Button
                  variant="ghost"
                  size="sm"
                  data-testid="button-pnl-refresh"
                  onClick={() => pnlRefetch()}
                  disabled={pnlLoading}
                  className="h-9 gap-2 text-muted-foreground"
                >
                  <RefreshCw className={`h-4 w-4 ${pnlLoading ? "animate-spin" : ""}`} />
                  Refresh
                </Button>
              )}
            </div>
            {pnlData && (
              <p className="text-xs text-muted-foreground mt-3">
                Fetched from Sippy portal · Period: {pnlData.period} · as of {new Date(pnlData.fetchedAt).toLocaleTimeString()}
              </p>
            )}
          </div>

          {/* Error state */}
          {pnlError && (
            <div className="flex items-center gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3">
              <AlertTriangle className="h-5 w-5 text-red-400 shrink-0" />
              <div>
                <div className="text-sm font-medium text-red-400">P&amp;L Report Error</div>
                <div className="text-xs text-muted-foreground">{(pnlError as Error).message}</div>
              </div>
            </div>
          )}

          {/* Prompt to fetch */}
          {!pnlFetch && !pnlData && !pnlLoading && (
            <div className="text-center text-muted-foreground py-16 bg-card border border-border rounded-xl">
              <TrendingUp className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <div className="font-medium mb-1">P&amp;L Report</div>
              <div className="text-sm">Select a date range and click <strong>Fetch P&amp;L</strong> to scrape live data from the Sippy portal.</div>
            </div>
          )}

          {/* Loading skeleton */}
          {pnlLoading && (
            <div className="text-center text-muted-foreground py-16 bg-card border border-border rounded-xl">
              <RefreshCw className="h-8 w-8 mx-auto mb-3 animate-spin opacity-40" />
              <div className="text-sm">Scraping Sippy portal for P&amp;L data…</div>
            </div>
          )}

          {/* Results */}
          {pnlData && pnlData.rows.length > 0 && (
            <>
              {/* KPI summary */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <KpiCard label="Revenue"    value={fmt$(pnlData.totals.revenue)}    icon={<DollarSign className="h-5 w-5" />}    color="text-emerald-400" />
                <KpiCard label="Cost"       value={fmt$(pnlData.totals.cost)}       icon={<TrendingDown className="h-5 w-5" />}  color="text-red-400" />
                <KpiCard label="Profit"     value={fmt$(pnlData.totals.profit)}     icon={<Zap className="h-5 w-5" />}           color={pnlData.totals.profit >= 0 ? "text-blue-400" : "text-red-400"} />
                <KpiCard label="Margin"     value={fmtPct(pnlData.totals.margin)}   icon={<Target className="h-5 w-5" />}        color={marginTextColor(pnlData.totals.margin)} />
                <KpiCard label="Calls"      value={fmtN(pnlData.totals.calls)}      icon={<Phone className="h-5 w-5" />}         color="text-violet-400" />
                <KpiCard label="Minutes"    value={fmtN(Math.round(pnlData.totals.durationSec / 60))} icon={<Clock className="h-5 w-5" />} color="text-cyan-400" />
              </div>

              {/* Area chart */}
              <div className="bg-card border border-border rounded-xl p-5">
                <div className="flex items-center gap-2 mb-4">
                  <TrendingUp className="h-4 w-4 text-emerald-400" />
                  <h2 className="font-semibold text-sm">Daily P&amp;L — {pnlData.period}</h2>
                </div>
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={pnlData.rows.map(r => ({ date: r.date, Revenue: r.revenue, Cost: r.cost, Profit: r.profit }))} margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gPnlRev" x1="0" y1="0" x2="0" y2="1">
                        <BseGradStops color={CHART_COLORS.revenue} />
                      </linearGradient>
                      <linearGradient id="gPnlCost" x1="0" y1="0" x2="0" y2="1">
                        <BseGradStops color={CHART_COLORS.cost} primaryOpacity={0.35} />
                      </linearGradient>
                      <linearGradient id="gPnlProfit" x1="0" y1="0" x2="0" y2="1">
                        <BseGradStops color={CHART_COLORS.profit} primaryOpacity={0.35} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid {...BSE_GRID_PROPS} />
                    <XAxis dataKey="date" {...BSE_AXIS_PROPS} interval="preserveStartEnd" />
                    <YAxis {...BSE_AXIS_PROPS} tickFormatter={v => `$${v}`} width={56} />
                    <Tooltip content={<BseTooltip formatter={(v: number, key) => [fmt$(v), key]} />} cursor={BSE_CURSOR} />
                    <Legend wrapperStyle={{ fontSize: 10, color: 'rgba(148,163,184,0.7)' }} />
                    <Area type="monotone" dataKey="Revenue" stroke={CHART_COLORS.revenue} fill="url(#gPnlRev)"    strokeWidth={2.5} dot={false} activeDot={bseActiveDot(CHART_COLORS.revenue)} strokeLinejoin="round" strokeLinecap="round" />
                    <Area type="monotone" dataKey="Cost"    stroke={CHART_COLORS.cost}    fill="url(#gPnlCost)"   strokeWidth={2}   dot={false} activeDot={bseActiveDot(CHART_COLORS.cost)}    strokeLinejoin="round" strokeLinecap="round" />
                    <Area type="monotone" dataKey="Profit"  stroke={CHART_COLORS.profit}  fill="url(#gPnlProfit)" strokeWidth={2}   dot={false} activeDot={bseActiveDot(CHART_COLORS.profit)}  strokeLinejoin="round" strokeLinecap="round" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              {/* Detailed table */}
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="px-5 py-3 border-b border-border flex items-center gap-2">
                  <BarChart2 className="h-4 w-4 text-emerald-400" />
                  <span className="font-semibold text-sm">Daily Breakdown</span>
                  <span className="text-xs text-muted-foreground ml-auto">{pnlData.rows.length} days</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground">
                        <th className="px-4 py-2 text-left">Date</th>
                        <th className="px-4 py-2 text-right">Calls</th>
                        <th className="px-4 py-2 text-right">Minutes</th>
                        <th className="px-4 py-2 text-right">Revenue</th>
                        <th className="px-4 py-2 text-right">Cost</th>
                        <th className="px-4 py-2 text-right">Profit</th>
                        <th className="px-4 py-2 text-right">Margin</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pnlData.rows.map((r, i) => (
                        <tr key={r.date} className="border-b border-border/40 hover:bg-muted/20" data-testid={`row-pnl-${i}`}>
                          <td className="px-4 py-2 font-mono text-xs">{r.date}</td>
                          <td className="px-4 py-2 text-right text-muted-foreground">{fmtN(r.calls)}</td>
                          <td className="px-4 py-2 text-right text-muted-foreground">{fmtN(Math.round(r.durationSec / 60))}</td>
                          <td className="px-4 py-2 text-right text-emerald-400 font-medium">{fmt$(r.revenue)}</td>
                          <td className="px-4 py-2 text-right text-red-400">{fmt$(r.cost)}</td>
                          <td className={`px-4 py-2 text-right font-semibold ${r.profit >= 0 ? "text-blue-400" : "text-red-400"}`}>{fmt$(r.profit)}</td>
                          <td className="px-4 py-2 text-right">
                            <Badge className={`text-xs border-0 ${marginColor(r.margin)}`}>{fmtPct(r.margin)}</Badge>
                          </td>
                        </tr>
                      ))}
                      {/* Totals row */}
                      <tr className="border-t-2 border-border bg-muted/30 font-semibold">
                        <td className="px-4 py-2">Total</td>
                        <td className="px-4 py-2 text-right">{fmtN(pnlData.totals.calls)}</td>
                        <td className="px-4 py-2 text-right">{fmtN(Math.round(pnlData.totals.durationSec / 60))}</td>
                        <td className="px-4 py-2 text-right text-emerald-400">{fmt$(pnlData.totals.revenue)}</td>
                        <td className="px-4 py-2 text-right text-red-400">{fmt$(pnlData.totals.cost)}</td>
                        <td className={`px-4 py-2 text-right ${pnlData.totals.profit >= 0 ? "text-blue-400" : "text-red-400"}`}>{fmt$(pnlData.totals.profit)}</td>
                        <td className="px-4 py-2 text-right">
                          <Badge className={`text-xs border-0 ${marginColor(pnlData.totals.margin)}`}>{fmtPct(pnlData.totals.margin)}</Badge>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

import { useState } from "react";
import { useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import {
  Globe, Phone, TrendingUp, DollarSign, Clock,
  CheckCircle2, AlertTriangle, Download, BarChart3,
  RefreshCw, XCircle, CreditCard, FileText, Zap,
  Activity, Signal, Wifi, MessageSquare, Send, ChevronRight, Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface DailyEntry { date: string; calls: number; minutes: number; cost: number; }

interface PortalQuality {
  asr:      number;
  acd:      number;
  pdd:      number;
  mos:      number;
  mosGrade: string;
  ner:      number | null;
  breakdown: {
    answered: number; failed: number; rna: number;
    subscriberSide: number; networkFail: number; total: number;
  };
}

interface PortalDestination {
  country: string; calls: number; minutes: number; asr: number; pct: number;
}

interface PortalData {
  accountName:    string;
  accountId:      string;
  cdrs:           Array<{
    caller?: string; callee?: string; startTime?: string;
    duration?: number; result?: string | number; cost?: number;
  }>;
  balance?:       number | null;
  creditLimit?:   number | null;
  currency?:      string | null;
  permissions?:   string[];
  totalCalls?:    number;
  connectedCalls?: number;
  totalMinutes?:  number;
  asr?:           number;
  totalBilling?:  number;
  ratePerMin?:    number;
  daily?:         DailyEntry[];
  quality?:       PortalQuality;
  destinations?:  PortalDestination[];
  error?:         string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDur(s?: number) {
  if (!s) return "—";
  const m = Math.floor(s / 60); const ss = s % 60;
  return `${m}:${String(ss).padStart(2, "0")}`;
}

function fmtMin(min: number) {
  return min >= 60
    ? `${(min / 60).toFixed(1)} hr`
    : `${min.toFixed(1)} min`;
}

function dateRangeStr(range: string): { startDate: string; endDate: string } {
  const now   = new Date();
  const end   = now.toISOString().slice(0, 19).replace("T", " ");
  const start = new Date(now);
  if (range === "today")    start.setHours(0, 0, 0, 0);
  else if (range === "7d")  start.setDate(start.getDate() - 7);
  else                      start.setDate(start.getDate() - 30);
  return { startDate: start.toISOString().slice(0, 19).replace("T", " "), endDate: end };
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv  = rows.map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ── Stat Card ─────────────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, sub, color }: {
  icon: any; label: string; value: string; sub?: string; color: string;
}) {
  return (
    <div className="bg-white dark:bg-card border border-gray-200 dark:border-border rounded-xl p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-gray-500 dark:text-muted-foreground">{label}</p>
          <p className={cn("text-2xl font-bold mt-1", color)}>{value}</p>
          {sub && <p className="text-[10px] text-gray-400 dark:text-muted-foreground/60 mt-0.5">{sub}</p>}
        </div>
        <div className="p-2.5 rounded-xl bg-gray-100 dark:bg-muted/30">
          <Icon className={cn("h-5 w-5", color)} />
        </div>
      </div>
    </div>
  );
}

// ── Mini Bar Chart ────────────────────────────────────────────────────────────

function MiniBarChart({ data, valueKey, color }: {
  data: DailyEntry[]; valueKey: "calls" | "minutes" | "cost"; color: string;
}) {
  if (!data.length) return <p className="text-xs text-gray-400 py-4 text-center">No data for this period.</p>;
  const max = Math.max(...data.map(d => d[valueKey]), 1);
  return (
    <div className="flex items-end gap-1 h-20 mt-2">
      {data.map(d => {
        const pct = (d[valueKey] / max) * 100;
        return (
          <div key={d.date} className="flex-1 flex flex-col items-center justify-end" title={`${d.date}: ${d[valueKey].toFixed(1)}`}>
            <div
              className={cn("w-full rounded-t transition-all", color)}
              style={{ height: `${Math.max(4, pct)}%` }}
            />
          </div>
        );
      })}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type Tab = "overview" | "calls" | "billing" | "support";

export default function PortalViewPage() {
  const params = useParams<{ token: string }>();
  const token  = params?.token ?? "";
  const [timeRange, setTimeRange] = useState("30d");
  const [tab, setTab] = useState<Tab>("overview");

  // Support ticket state
  const qc = useQueryClient();
  const [selectedTicketId, setSelectedTicketId] = useState<number | null>(null);
  const [ticketCategory, setTicketCategory]     = useState("quality");
  const [ticketSubject, setTicketSubject]       = useState("");
  const [ticketBody, setTicketBody]             = useState("");
  const [showNewTicket, setShowNewTicket]       = useState(false);
  const [clientReply, setClientReply]           = useState("");

  const { startDate, endDate } = dateRangeStr(timeRange);

  const { data, isLoading, isError, refetch, dataUpdatedAt } = useQuery<PortalData>({
    queryKey: ["/api/portal/view", token, timeRange],
    queryFn: () =>
      fetch(`/api/portal/view?token=${encodeURIComponent(token)}&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`)
        .then(async r => {
          const j = await r.json();
          if (!r.ok) throw new Error(j.error ?? "Access denied");
          return j;
        }),
    staleTime: 60_000,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-background flex items-center justify-center">
        <div className="text-center space-y-3">
          <RefreshCw className="h-8 w-8 text-blue-400 animate-spin mx-auto" />
          <p className="text-sm text-gray-500">Loading your portal…</p>
        </div>
      </div>
    );
  }

  if (isError || data?.error) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-background flex items-center justify-center">
        <div className="text-center space-y-4 max-w-sm">
          <div className="p-3 rounded-full bg-rose-500/10 w-fit mx-auto">
            <XCircle className="h-8 w-8 text-rose-400" />
          </div>
          <h1 className="text-xl font-bold">Access Denied</h1>
          <p className="text-sm text-gray-500">This portal link is invalid or has been revoked. Please contact your account manager for a new link.</p>
        </div>
      </div>
    );
  }

  const perms        = data?.permissions ?? ["cdrs", "usage", "billing"];
  const cdrs         = data?.cdrs ?? [];
  const currency     = data?.currency ?? "USD";
  const totalCalls   = data?.totalCalls   ?? cdrs.length;
  const connected    = data?.connectedCalls ?? cdrs.filter(c => (c.duration ?? 0) > 0).length;
  const asr          = data?.asr          ?? (totalCalls > 0 ? Math.round((connected / totalCalls) * 100) : 0);
  const totalMin     = data?.totalMinutes ?? cdrs.reduce((s, c) => s + (c.duration ?? 0), 0) / 60;
  const totalBilling = data?.totalBilling ?? 0;
  const ratePerMin   = data?.ratePerMin   ?? 0.025;
  const daily        = data?.daily        ?? [];
  const balance      = data?.balance;

  function isExportAllowed(): boolean {
    const h = new Date().getUTCHours();
    return h >= 22 || h < 6;
  }

  function exportWindowInfo(): { allowed: boolean; hint: string } {
    const now = new Date();
    const h   = now.getUTCHours();
    if (h >= 22 || h < 6) return { allowed: true, hint: "Export window open (22:00–06:00 UTC)" };
    const minsToOpen = ((22 - h - 1) * 60) + (60 - now.getUTCMinutes());
    const hrs  = Math.floor(minsToOpen / 60);
    const mins = minsToOpen % 60;
    return {
      allowed: false,
      hint: `Exports open at 22:00 UTC · opens in ${hrs > 0 ? `${hrs}h ` : ""}${mins}m`,
    };
  }

  function fmtUtc(iso?: string): string {
    if (!iso) return "—";
    return new Date(iso).toISOString().replace("T", " ").slice(0, 19) + " UTC";
  }

  function handleExport() {
    downloadCsv(`cdrs-${timeRange}-${new Date().toISOString().slice(0, 10)}.csv`, [
      ["Time (UTC)", "CLI", "CLD", "Duration", "Outcome", "Cost (USD)"],
      ...cdrs.map(r => [
        fmtUtc(r.startTime),
        r.caller ?? "—", r.callee ?? "—",
        fmtDur(r.duration), (r.duration ?? 0) > 0 ? "connected" : "failed",
        (r.cost ?? 0).toFixed(4),
      ]),
      [],
      ["Billing note: amounts are estimates based on contracted rate. Final invoiced amounts may differ."],
    ]);
  }

  function handleExcelExport() {
    const rows = [
      ["Time (UTC)", "CLI", "CLD", "Duration (s)", "Outcome", "Cost (USD)"],
      ...cdrs.map(r => [
        fmtUtc(r.startTime),
        r.caller ?? "", r.callee ?? "",
        r.duration ?? 0,
        (r.duration ?? 0) > 0 ? "connected" : "failed",
        parseFloat((r.cost ?? 0).toFixed(4)),
      ]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 22 }, { wch: 18 }, { wch: 18 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "CDRs");
    const note = XLSX.utils.aoa_to_sheet([["Billing note: amounts are estimates based on contracted rate. Final invoiced amounts may differ."]]);
    XLSX.utils.book_append_sheet(wb, note, "Notes");
    XLSX.writeFile(wb, `cdrs-${timeRange}-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  // ── Ticket queries and mutations ──────────────────────────────────────────────
  const { data: ticketsResp, refetch: refetchTickets } = useQuery<{ tickets: any[] }>({
    queryKey: ["/api/portal/tickets", token],
    queryFn: () => fetch(`/api/portal/tickets?token=${encodeURIComponent(token)}`).then(r => r.json()),
    enabled: !!token,
    staleTime: 15_000,
  });
  const myTickets: any[] = ticketsResp?.tickets ?? [];

  const { data: threadData, refetch: refetchThread } = useQuery<{ ticket: any; messages: any[] }>({
    queryKey: ["/api/portal/tickets", token, selectedTicketId],
    queryFn: () =>
      fetch(`/api/portal/tickets/${selectedTicketId}?token=${encodeURIComponent(token)}`).then(r => r.json()),
    enabled: selectedTicketId !== null,
    staleTime: 10_000,
  });

  const createTicketMut = useMutation({
    mutationFn: () =>
      fetch("/api/portal/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, category: ticketCategory, subject: ticketSubject, body: ticketBody }),
      }).then(r => r.json()),
    onSuccess: (t: any) => {
      qc.invalidateQueries({ queryKey: ["/api/portal/tickets", token] });
      setTicketSubject(""); setTicketBody(""); setShowNewTicket(false);
      setSelectedTicketId(t.id);
    },
  });

  const clientReplyMut = useMutation({
    mutationFn: (body: string) =>
      fetch(`/api/portal/tickets/${selectedTicketId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, body }),
      }).then(r => r.json()),
    onSuccess: () => {
      setClientReply("");
      qc.invalidateQueries({ queryKey: ["/api/portal/tickets", token, selectedTicketId] });
      qc.invalidateQueries({ queryKey: ["/api/portal/tickets", token] });
    },
  });

  const balanceColor = balance == null ? "text-gray-400" : balance > 50 ? "text-emerald-500" : balance > 10 ? "text-amber-500" : "text-rose-500";
  const asrColor     = asr >= 60 ? "text-emerald-500" : asr >= 40 ? "text-amber-500" : "text-rose-500";

  const tabs: { id: Tab; label: string; icon: any; perm?: string }[] = [
    { id: "overview", label: "Overview",      icon: Zap },
    { id: "calls",    label: "Call History",  icon: Phone,      perm: "cdrs" },
    { id: "billing",  label: "Billing",       icon: CreditCard, perm: "billing" },
    { id: "support",  label: "Support",       icon: MessageSquare },
  ].filter(t => !t.perm || perms.includes(t.perm));

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-background">

      {/* ── Top bar ── */}
      <div className="bg-white dark:bg-card border-b border-gray-200 dark:border-border px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/20">
              <Globe className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <h1 className="text-base font-bold">{data?.accountName ?? "My Portal"}</h1>
              <p className="text-xs text-gray-400">Account #{data?.accountId} · Self-service portal</p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-2">
              <select
                className="text-xs bg-gray-100 dark:bg-muted border border-gray-200 dark:border-border rounded-lg px-2 py-1.5 focus:outline-none"
                value={timeRange}
                onChange={e => setTimeRange(e.target.value)}
                data-testid="select-time-range"
              >
                <option value="today">Today</option>
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
              </select>
              <Button variant="ghost" size="sm" onClick={() => refetch()} data-testid="btn-refresh">
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
            {dataUpdatedAt > 0 && (
              <p className="text-[10px] text-gray-400 dark:text-muted-foreground/60">
                Updated {new Date(dataUpdatedAt).toISOString().replace("T", " ").slice(0, 19)} UTC
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">

        {/* ── Balance banner ── */}
        {balance != null && (
          <div className={cn(
            "rounded-xl border px-5 py-3 flex items-center justify-between",
            balance > 50 ? "bg-emerald-50 dark:bg-emerald-500/5 border-emerald-200 dark:border-emerald-500/20"
              : balance > 10 ? "bg-amber-50 dark:bg-amber-500/5 border-amber-200 dark:border-amber-500/20"
              : "bg-rose-50 dark:bg-rose-500/5 border-rose-200 dark:border-rose-500/20",
          )}>
            <div className="flex items-center gap-2">
              {balance <= 10 && <AlertTriangle className="h-4 w-4 text-rose-500" />}
              <span className="text-sm font-medium">
                Account Balance:{" "}
                <span className={cn("font-bold", balanceColor)}>${balance.toFixed(2)} {currency}</span>
              </span>
              {data?.creditLimit != null && (
                <span className="text-xs text-gray-400">/ ${data.creditLimit.toFixed(2)} limit</span>
              )}
            </div>
            {balance <= 10 && (
              <Badge className="bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/25 text-[10px]">Low Balance</Badge>
            )}
          </div>
        )}

        {/* ── Tabs ── */}
        <div className="flex border-b border-gray-200 dark:border-border gap-1">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              data-testid={`tab-${t.id}`}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
                tab === t.id
                  ? "border-blue-500 text-blue-600 dark:text-blue-400"
                  : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-foreground",
              )}
            >
              <t.icon className="h-4 w-4" />{t.label}
            </button>
          ))}
        </div>

        {/* ── Overview Tab ── */}
        {tab === "overview" && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <StatCard icon={Phone}      label="Total Calls"    value={totalCalls.toLocaleString()}  color="text-blue-500" />
              <StatCard icon={CheckCircle2} label="Connected"    value={connected.toLocaleString()}   color="text-emerald-500" />
              <StatCard icon={TrendingUp} label="ASR"            value={`${asr.toFixed(1)}%`}          color={asrColor} sub="Answer Seizure Ratio" />
              <StatCard icon={Clock}      label="Total Duration" value={fmtMin(totalMin)}             color="text-violet-500" />
            </div>

          {/* ── Quality Section ── */}
          {data?.quality && data.quality.breakdown.total > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-foreground flex items-center gap-2">
                <Activity className="h-4 w-4 text-violet-500" /> Call Quality Metrics
              </h3>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <div className="bg-white dark:bg-card border border-gray-200 dark:border-border rounded-xl p-4 shadow-sm text-center">
                  <p className="text-[10px] text-gray-500 dark:text-muted-foreground uppercase tracking-wide mb-1">ASR</p>
                  <p className={cn("text-xl font-bold",
                    data.quality.asr >= 70 ? "text-emerald-500" : data.quality.asr >= 50 ? "text-amber-500" : "text-rose-500"
                  )}>{data.quality.asr.toFixed(1)}%</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">Answer Rate</p>
                </div>

                <div className="bg-white dark:bg-card border border-gray-200 dark:border-border rounded-xl p-4 shadow-sm text-center">
                  <p className="text-[10px] text-gray-500 dark:text-muted-foreground uppercase tracking-wide mb-1">ACD</p>
                  <p className={cn("text-xl font-bold",
                    data.quality.acd >= 90 ? "text-emerald-500" : data.quality.acd >= 45 ? "text-amber-500" : "text-rose-500"
                  )}>
                    {data.quality.acd > 0
                      ? `${Math.floor(data.quality.acd / 60)}:${String(data.quality.acd % 60).padStart(2, "0")}`
                      : "—"}
                  </p>
                  <p className="text-[10px] text-gray-400 mt-0.5">Avg Call Duration</p>
                </div>

                <div
                  className="bg-white dark:bg-card border border-gray-200 dark:border-border rounded-xl p-4 shadow-sm text-center"
                  title="Network Effectiveness Ratio — measures whether calls reached their destination. High NER with low ASR means the called party is not answering, not a network problem."
                >
                  <p className="text-[10px] text-gray-500 dark:text-muted-foreground uppercase tracking-wide mb-1">NER ⓘ</p>
                  <p className={cn("text-xl font-bold",
                    data.quality.ner == null ? "text-gray-400"
                    : data.quality.ner >= 90 ? "text-emerald-500"
                    : data.quality.ner >= 80 ? "text-amber-500" : "text-rose-500"
                  )}>
                    {data.quality.ner != null ? `${data.quality.ner.toFixed(1)}%` : "—"}
                  </p>
                  <p className="text-[10px] text-gray-400 mt-0.5">Network Delivery</p>
                </div>

                <div className="bg-white dark:bg-card border border-gray-200 dark:border-border rounded-xl p-4 shadow-sm text-center">
                  <p className="text-[10px] text-gray-500 dark:text-muted-foreground uppercase tracking-wide mb-1">MOS</p>
                  <div className="flex items-baseline justify-center gap-1.5">
                    <p className={cn("text-xl font-bold",
                      data.quality.mos >= 4.0 ? "text-emerald-500" : data.quality.mos >= 3.5 ? "text-amber-500" : "text-rose-500"
                    )}>{data.quality.mos.toFixed(2)}</p>
                    <Badge className={cn("text-[10px] px-1 py-0 h-4",
                      data.quality.mosGrade === 'A' ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400"
                      : data.quality.mosGrade === 'B' ? "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400"
                      : data.quality.mosGrade === 'C' ? "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400"
                      : "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-400"
                    )}>Grade {data.quality.mosGrade}</Badge>
                  </div>
                  <p className="text-[10px] text-gray-400 mt-0.5">Voice Quality (est.)</p>
                </div>

                <div className="bg-white dark:bg-card border border-gray-200 dark:border-border rounded-xl p-4 shadow-sm text-center">
                  <p className="text-[10px] text-gray-500 dark:text-muted-foreground uppercase tracking-wide mb-1">PDD</p>
                  <p className={cn("text-xl font-bold",
                    data.quality.pdd < 2 ? "text-emerald-500" : data.quality.pdd < 4 ? "text-amber-500" : "text-rose-500"
                  )}>
                    {data.quality.pdd > 0 ? `${data.quality.pdd.toFixed(2)}s` : "—"}
                  </p>
                  <p className="text-[10px] text-gray-400 mt-0.5">Post-Dial Delay</p>
                </div>
              </div>

              <div className="bg-white dark:bg-card border border-gray-200 dark:border-border rounded-xl p-4 shadow-sm">
                <p className="text-xs font-medium text-gray-500 dark:text-muted-foreground mb-3">Call Breakdown</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center text-xs">
                  {[
                    { label: "Connected",     value: data.quality.breakdown.answered,       color: "text-emerald-600 dark:text-emerald-400" },
                    { label: "Not Answered",  value: data.quality.breakdown.rna,            color: "text-amber-600 dark:text-amber-400" },
                    { label: "Subscriber",    value: data.quality.breakdown.subscriberSide, color: "text-blue-600 dark:text-blue-400" },
                    { label: "Net Failure",   value: data.quality.breakdown.networkFail,    color: "text-rose-600 dark:text-rose-400" },
                  ].map(b => (
                    <div key={b.label}>
                      <p className={cn("text-lg font-bold", b.color)}>{b.value}</p>
                      <p className="text-gray-400 text-[10px]">{b.label}</p>
                    </div>
                  ))}
                </div>
              </div>

              {data.destinations && data.destinations.length > 0 && (
                <div className="bg-white dark:bg-card border border-gray-200 dark:border-border rounded-xl p-4 shadow-sm">
                  <p className="text-xs font-medium text-gray-500 dark:text-muted-foreground mb-3 flex items-center gap-1.5">
                    <Signal className="h-3.5 w-3.5" /> Traffic by Destination
                  </p>
                  <div className="space-y-2">
                    {data.destinations.map(d => (
                      <div key={d.country}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-gray-600 dark:text-foreground font-medium">{d.country}</span>
                          <span className="text-gray-400">{d.calls} calls · {d.pct}%</span>
                        </div>
                        <div className="h-1.5 bg-gray-100 dark:bg-muted/30 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-400 dark:bg-blue-500 rounded-full" style={{ width: `${d.pct}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

            {perms.includes("usage") && daily.length > 0 && (
              <div className="bg-white dark:bg-card border border-gray-200 dark:border-border rounded-xl p-5 shadow-sm">
                <div className="flex items-center gap-2 mb-1">
                  <BarChart3 className="h-4 w-4 text-blue-500" />
                  <h3 className="text-sm font-semibold">Daily Call Volume</h3>
                </div>
                <MiniBarChart data={daily} valueKey="calls" color="bg-blue-400 dark:bg-blue-500" />
              </div>
            )}

            {perms.includes("billing") && (
              <div className="bg-white dark:bg-card border border-gray-200 dark:border-border rounded-xl p-5 shadow-sm">
                <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-emerald-500" />Billing Summary
                </h3>
                <div className="grid grid-cols-3 gap-4 text-center">
                  {[
                    { label: "Minutes Used",    value: fmtMin(totalMin),                           color: "text-violet-600 dark:text-violet-400" },
                    { label: "Rate / Minute",   value: `$${ratePerMin.toFixed(4)}`,                color: "text-gray-800 dark:text-foreground" },
                    { label: "Estimated Total", value: `$${totalBilling.toFixed(2)} ${currency}`,  color: "text-emerald-600 dark:text-emerald-400" },
                  ].map(({ label, value, color }) => (
                    <div key={label}>
                      <p className="text-xs text-gray-500 dark:text-muted-foreground">{label}</p>
                      <p className={cn("text-xl font-bold mt-1", color)}>{value}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Call History Tab ── */}
        {tab === "calls" && perms.includes("cdrs") && (
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
              <div>
                <p className="text-sm text-gray-500">{cdrs.length} record{cdrs.length === 1 ? "" : "s"} in this period</p>
                {(() => {
                  const win = exportWindowInfo();
                  return (
                    <p className={cn("text-[10px] mt-0.5", win.allowed ? "text-emerald-500" : "text-amber-500")}>
                      {win.hint}
                    </p>
                  );
                })()}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline" size="sm"
                  onClick={handleExport}
                  disabled={cdrs.length === 0 || !isExportAllowed()}
                  title={!isExportAllowed() ? exportWindowInfo().hint : undefined}
                  data-testid="btn-export-csv"
                >
                  <Download className="h-4 w-4 mr-1.5" />CSV
                </Button>
                <Button
                  variant="outline" size="sm"
                  onClick={handleExcelExport}
                  disabled={cdrs.length === 0 || !isExportAllowed()}
                  title={!isExportAllowed() ? exportWindowInfo().hint : undefined}
                  data-testid="btn-export-excel"
                >
                  <FileText className="h-4 w-4 mr-1.5" />Excel
                </Button>
              </div>
            </div>
            {cdrs.length === 0 ? (
              <div className="bg-white dark:bg-card border border-gray-200 dark:border-border rounded-xl p-8 text-center shadow-sm">
                <Phone className="h-8 w-8 text-gray-300 dark:text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-gray-500">No calls found for the selected time period.</p>
              </div>
            ) : (
              <div className="bg-white dark:bg-card border border-gray-200 dark:border-border rounded-xl overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 dark:bg-muted/30">
                      <tr>
                        {["Time", "CLI", "CLD", "Duration", "Outcome", "Cost"].map(h => (
                          <th key={h} className="px-4 py-2.5 text-left text-gray-500 dark:text-muted-foreground font-medium">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {cdrs.slice(0, 100).map((r, i) => {
                        const ok = (r.duration ?? 0) > 0;
                        return (
                          <tr key={i} className="border-t border-gray-100 dark:border-border/20 hover:bg-gray-50 dark:hover:bg-muted/10">
                            <td className="px-4 py-2 text-gray-400 font-mono whitespace-nowrap">
                              {r.startTime ? new Date(r.startTime).toLocaleString() : "—"}
                            </td>
                            <td className="px-4 py-2 font-mono text-gray-700 dark:text-foreground">{r.caller ?? "—"}</td>
                            <td className="px-4 py-2 font-mono text-gray-700 dark:text-foreground">{r.callee ?? "—"}</td>
                            <td className="px-4 py-2 font-mono">{fmtDur(r.duration)}</td>
                            <td className="px-4 py-2">
                              <span className={cn(
                                "px-1.5 py-0.5 rounded text-[10px] font-semibold",
                                ok ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400"
                                   : "bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400",
                              )}>
                                {ok ? "connected" : "failed"}
                              </span>
                            </td>
                            <td className="px-4 py-2 font-mono">${(r.cost ?? 0).toFixed(4)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {cdrs.length > 100 && (
                  <div className="px-4 py-2.5 border-t border-gray-100 dark:border-border/20 flex items-center justify-between">
                    <p className="text-xs text-gray-400">Showing 100 of {cdrs.length} — export CSV for all.</p>
                    <Button variant="ghost" size="sm" onClick={handleExport} className="text-xs">
                      <Download className="h-3.5 w-3.5 mr-1" />Export All
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Billing Tab ── */}
        {tab === "billing" && perms.includes("billing") && (
          <div className="space-y-5">
            <div className="grid grid-cols-3 gap-4">
              <StatCard icon={Clock}      label="Minutes Used"    value={fmtMin(totalMin)}              color="text-violet-500" />
              <StatCard icon={FileText}   label="Rate / Minute"   value={`$${ratePerMin.toFixed(4)}`}   color="text-blue-500" />
              <StatCard icon={DollarSign} label="Estimated Total" value={`$${totalBilling.toFixed(2)}`} sub={currency}
                color={totalBilling > 0 ? "text-emerald-500" : "text-gray-400"} />
            </div>

            {daily.length > 0 ? (
              <div className="bg-white dark:bg-card border border-gray-200 dark:border-border rounded-xl p-5 shadow-sm">
                <div className="flex items-center gap-2 mb-1">
                  <BarChart3 className="h-4 w-4 text-emerald-500" />
                  <h3 className="text-sm font-semibold">Daily Cost</h3>
                </div>
                <MiniBarChart data={daily} valueKey="cost" color="bg-emerald-400 dark:bg-emerald-500" />
                <div className="mt-5 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-500 dark:text-muted-foreground border-b border-gray-100 dark:border-border/40">
                        {["Date", "Calls", "Minutes", "Cost"].map(h => (
                          <th key={h} className={cn("pb-2 font-medium", h === "Date" ? "text-left" : "text-right")}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {daily.slice(-14).reverse().map(d => (
                        <tr key={d.date} className="border-t border-gray-50 dark:border-border/20">
                          <td className="py-1.5 font-mono">{d.date}</td>
                          <td className="py-1.5 text-right font-mono">{d.calls}</td>
                          <td className="py-1.5 text-right font-mono">{d.minutes.toFixed(1)}</td>
                          <td className="py-1.5 text-right font-mono text-emerald-600 dark:text-emerald-400">${d.cost.toFixed(4)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="bg-white dark:bg-card border border-gray-200 dark:border-border rounded-xl p-8 text-center shadow-sm">
                <p className="text-sm text-gray-400">No billing data for this period.</p>
              </div>
            )}

            <div className="bg-blue-50 dark:bg-blue-500/5 border border-blue-200 dark:border-blue-500/20 rounded-xl p-4 text-xs text-blue-700 dark:text-blue-300">
              <p className="font-medium mb-0.5">Billing Note</p>
              <p>Amounts shown are estimates based on your contracted rate of ${ratePerMin.toFixed(4)}/min. Final invoiced amounts may differ based on rounding, adjustments, or minimum charges. Contact your account manager for a formal invoice.</p>
            </div>
          </div>
        )}

        {/* ── Support Tab ── */}
        {tab === "support" && (
          <div className="space-y-4">

            {/* Ticket list + new ticket header */}
            {!selectedTicketId && (
              <>
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-700 dark:text-foreground flex items-center gap-1.5">
                    <MessageSquare className="h-4 w-4 text-blue-500" /> My Tickets
                  </h3>
                  <Button size="sm" onClick={() => setShowNewTicket(v => !v)} data-testid="btn-new-ticket">
                    <Plus className="h-3.5 w-3.5 mr-1.5" />{showNewTicket ? "Cancel" : "Open Ticket"}
                  </Button>
                </div>

                {/* New ticket form */}
                {showNewTicket && (
                  <div className="bg-white dark:bg-card border border-gray-200 dark:border-border rounded-xl p-5 space-y-4 shadow-sm">
                    <p className="text-sm font-semibold">New Support Ticket</p>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-gray-600 dark:text-muted-foreground">Category</label>
                        <select
                          value={ticketCategory}
                          onChange={e => setTicketCategory(e.target.value)}
                          className="w-full text-xs bg-gray-50 dark:bg-muted border border-gray-200 dark:border-border rounded-lg px-2.5 py-1.5 focus:outline-none"
                          data-testid="select-ticket-category"
                        >
                          <option value="quality">Call Quality</option>
                          <option value="traffic">Traffic Issue</option>
                          <option value="billing">Billing</option>
                          <option value="routing">Routing</option>
                          <option value="other">Other</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-gray-600 dark:text-muted-foreground">Subject</label>
                        <input
                          type="text"
                          value={ticketSubject}
                          onChange={e => setTicketSubject(e.target.value)}
                          placeholder="Brief summary…"
                          maxLength={200}
                          className="w-full text-xs bg-gray-50 dark:bg-muted border border-gray-200 dark:border-border rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          data-testid="input-ticket-subject"
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-medium text-gray-600 dark:text-muted-foreground">Description</label>
                      <textarea
                        value={ticketBody}
                        onChange={e => setTicketBody(e.target.value)}
                        placeholder="Describe the issue — include affected numbers, time range, and any error codes if known…"
                        rows={4}
                        className="w-full text-xs bg-gray-50 dark:bg-muted border border-gray-200 dark:border-border rounded-xl px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-blue-500"
                        data-testid="textarea-ticket-body"
                      />
                    </div>

                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        onClick={() => createTicketMut.mutate()}
                        disabled={!ticketSubject.trim() || !ticketBody.trim() || createTicketMut.isPending}
                        data-testid="btn-submit-ticket"
                      >
                        <Send className="h-3.5 w-3.5 mr-1.5" />
                        {createTicketMut.isPending ? "Submitting…" : "Submit Ticket"}
                      </Button>
                    </div>
                  </div>
                )}

                {/* Ticket list */}
                {myTickets.length === 0 ? (
                  <div className="bg-white dark:bg-card border border-gray-200 dark:border-border rounded-xl p-10 text-center shadow-sm">
                    <MessageSquare className="h-8 w-8 text-gray-300 dark:text-muted-foreground mx-auto mb-2" />
                    <p className="text-sm text-gray-500">No tickets yet. Open one if you have a question or issue.</p>
                  </div>
                ) : (
                  <div className="bg-white dark:bg-card border border-gray-200 dark:border-border rounded-xl overflow-hidden shadow-sm divide-y divide-gray-100 dark:divide-border/20">
                    {myTickets.map((t: any) => {
                      const statusCfg: Record<string, { label: string; cls: string }> = {
                        open:           { label: "Open",           cls: "bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400" },
                        in_progress:    { label: "In Progress",    cls: "bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400" },
                        waiting_client: { label: "Reply Needed",   cls: "bg-purple-50 text-purple-600 dark:bg-purple-500/15 dark:text-purple-400" },
                        resolved:       { label: "Resolved",       cls: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400" },
                      };
                      const s = statusCfg[t.status] ?? statusCfg.open;
                      return (
                        <button
                          key={t.id}
                          onClick={() => setSelectedTicketId(t.id)}
                          className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-muted/10 text-left"
                          data-testid={`ticket-row-${t.id}`}
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium truncate">{t.subject}</span>
                              <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium", s.cls)}>{s.label}</span>
                              {t.status === "waiting_client" && (
                                <span className="text-[10px] text-purple-500 animate-pulse font-semibold">● Action needed</span>
                              )}
                            </div>
                            <p className="text-[11px] text-gray-400 mt-0.5 capitalize">{t.category.replace(/_/g, " ")} · #{t.id} · {new Date(t.updatedAt).toLocaleDateString()}</p>
                          </div>
                          <ChevronRight className="h-4 w-4 text-gray-400 shrink-0 ml-2" />
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            )}

            {/* Thread view */}
            {selectedTicketId && threadData && (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setSelectedTicketId(null)} data-testid="btn-back-tickets">
                    ← Back
                  </Button>
                  <span className="text-sm font-semibold">{threadData.ticket?.subject}</span>
                  <span className={cn(
                    "text-[10px] px-1.5 py-0.5 rounded font-medium",
                    threadData.ticket?.status === "resolved"
                      ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400"
                      : threadData.ticket?.status === "waiting_client"
                      ? "bg-purple-100 text-purple-600 dark:bg-purple-500/15 dark:text-purple-400"
                      : "bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400",
                  )}>
                    {threadData.ticket?.status?.replace(/_/g, " ")}
                  </span>
                </div>

                {/* Messages */}
                <div className="bg-white dark:bg-card border border-gray-200 dark:border-border rounded-xl overflow-hidden shadow-sm divide-y divide-gray-100 dark:divide-border/20">
                  {(threadData.messages ?? []).map((m: any) => (
                    <div key={m.id} className={cn(
                      "px-4 py-3",
                      m.author === "operator"
                        ? "bg-blue-50 dark:bg-blue-500/5"
                        : "bg-white dark:bg-transparent",
                    )}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] font-semibold text-gray-600 dark:text-muted-foreground">
                          {m.author === "operator" ? "Support Team" : "You"}
                        </span>
                        <span className="text-[10px] text-gray-400">
                          {new Date(m.createdAt).toISOString().replace("T", " ").slice(0, 16)} UTC
                        </span>
                      </div>
                      <p className="text-sm whitespace-pre-wrap">{m.body}</p>
                    </div>
                  ))}
                </div>

                {/* Reply box (disabled if resolved) */}
                {threadData.ticket?.status !== "resolved" && (
                  <div className="flex gap-2">
                    <textarea
                      value={clientReply}
                      onChange={e => setClientReply(e.target.value)}
                      placeholder="Write a reply…"
                      rows={2}
                      className="flex-1 text-xs bg-white dark:bg-card border border-gray-200 dark:border-border rounded-xl px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-blue-500"
                      data-testid="textarea-client-reply"
                    />
                    <Button
                      size="sm"
                      onClick={() => clientReplyMut.mutate(clientReply)}
                      disabled={!clientReply.trim() || clientReplyMut.isPending}
                      data-testid="btn-send-reply"
                    >
                      <Send className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
                {threadData.ticket?.status === "resolved" && (
                  <p className="text-center text-xs text-gray-400 py-2">This ticket has been resolved. Open a new ticket if you have further questions.</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Data Notice ── */}
        <div className="bg-blue-50 dark:bg-blue-500/5 border border-blue-200 dark:border-blue-500/20 rounded-xl px-4 py-3 text-[11px] text-blue-700 dark:text-blue-300 flex items-start gap-2">
          <Wifi className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>Data is estimated from live usage records sourced directly from the switch. Figures refresh automatically — use the refresh button for the latest snapshot. Timestamps are in UTC.</span>
        </div>

        {/* ── Footer ── */}
        <p className="text-center text-xs text-gray-400 pb-4">
          Powered by Bitsauto Monitoring Platform · Data refreshes every 5 minutes
        </p>
      </div>
    </div>
  );
}

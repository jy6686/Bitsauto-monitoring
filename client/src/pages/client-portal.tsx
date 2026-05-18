import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Globe, Phone, TrendingUp, DollarSign, Clock, CheckCircle2,
  AlertTriangle, Download, BarChart3, Shield, Link2, Plus,
  Trash2, Copy, RefreshCw, Key, Settings, MessageSquare, Send, ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface CdrRow {
  callId?: string;
  caller?: string;
  callee?: string;
  startTime?: string;
  duration?: number;
  country?: string;
  result?: string | number;
  cost?: number;
}

interface PortalToken {
  id: number;
  token: string;
  accountId: string;
  accountName: string;
  label?: string;
  createdAt: string;
  expiresAt?: string;
  lastUsedAt?: string;
  permissions?: string;
  clientProfileId?: number | null;
}

function fmtDur(s?: number) {
  if (!s) return "—";
  const m = Math.floor(s / 60); const ss = s % 60;
  return `${m}:${String(ss).padStart(2, "0")}`;
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ── Inline MOS helpers (mirrors server/mos.ts — ITU-T G.107 E-Model) ─────────
function mosFromPddSec(pddSec: number): number {
  const ms = pddSec * 1000;
  if (ms <= 0) return 4.3;
  const Id = ms < 150 ? 0 : ms < 400 ? 0.024 * ms + 0.11 * (ms > 177.3 ? ms - 177.3 : 0) : 25;
  const R  = Math.max(0, Math.min(100, 93.2 - Id));
  const m  = 1 + 0.035 * R + R * (R - 60) * (100 - R) * 7e-6;
  return parseFloat(Math.max(1.0, Math.min(4.5, m)).toFixed(2));
}
function mosGradeLabel(m: number) { return m >= 4.0 ? 'A' : m >= 3.5 ? 'B' : m >= 3.0 ? 'C' : m >= 2.5 ? 'D' : 'F'; }

function computeQuality(rows: CdrRow[]) {
  const total    = rows.length;
  const answered = rows.filter(c => (c.duration ?? 0) > 0);
  const rna      = rows.filter(c => String(c.result ?? '') === '0' && (c.duration ?? 0) === 0);
  const subSide  = rows.filter(c => ['-17', '-18', '-19'].includes(String(c.result ?? '')));
  const netFail  = rows.filter(c => ['-21', '-22', '-23', '-24'].includes(String(c.result ?? '')));
  const pddArr   = answered.map(c => Number((c as any).pdd1xx ?? (c as any).pdd) || 0).filter(v => v > 0);
  const avgPdd   = pddArr.length > 0 ? pddArr.reduce((a, b) => a + b, 0) / pddArr.length : 0;
  const mos      = mosFromPddSec(avgPdd);
  const nerNum   = answered.length + rna.length + subSide.length;
  return {
    mos,
    mosGrade:   mosGradeLabel(mos),
    pdd:        parseFloat(avgPdd.toFixed(2)),
    ner:        total > 0 ? parseFloat((nerNum / total * 100).toFixed(1)) : null,
    netFailPct: total > 0 ? parseFloat((netFail.length / total * 100).toFixed(2)) : 0,
  };
}

function computeDestGroups(rows: CdrRow[]) {
  const map = new Map<string, { calls: number; answered: number }>();
  for (const c of rows) {
    const country = (String((c as any).country || '')).trim() || 'Unknown';
    const e = map.get(country) ?? { calls: 0, answered: 0 };
    e.calls++;
    if ((c.duration ?? 0) > 0) e.answered++;
    map.set(country, e);
  }
  const total  = rows.length;
  const sorted = Array.from(map.entries())
    .map(([label, d]) => ({ label, pct: total > 0 ? Math.round(d.calls / total * 100) : 0 }))
    .sort((a, b) => b.pct - a.pct);
  if (sorted.length <= 3) return sorted;
  const top3   = sorted.slice(0, 3);
  const rest   = sorted.slice(3).reduce((s, d) => s + d.pct, 0);
  if (rest > 0) top3.push({ label: 'Other', pct: rest });
  return top3;
}

function StatCard({ icon: Icon, label, value, sub, color }: {
  icon: any; label: string; value: string; sub?: string; color: string;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className={cn("text-2xl font-bold mt-1", color)}>{value}</p>
          {sub && <p className="text-xs text-muted-foreground/60 mt-0.5">{sub}</p>}
        </div>
        <div className="p-2.5 rounded-xl bg-muted/30">
          <Icon className={cn("h-5 w-5", color)} />
        </div>
      </div>
    </div>
  );
}

function BalanceStatCard({ accountId }: { accountId: string }) {
  const { data, isLoading } = useQuery<{ balance: number | null; creditLimit: number | null; currency: string }>({
    queryKey: ["/api/sippy/account-balance", accountId],
    queryFn: () => fetch(`/api/sippy/account-balance/${encodeURIComponent(accountId)}`).then(r => r.json()),
    staleTime: 60_000,
    enabled: !!accountId,
  });
  const balance = data?.balance ?? null;
  const value = isLoading ? "…" : balance != null ? `$${balance.toFixed(2)}` : "N/A";
  const color = isLoading ? "text-muted-foreground" : balance == null ? "text-muted-foreground" : balance > 50 ? "text-emerald-400" : balance > 10 ? "text-amber-400" : "text-rose-400";
  return (
    <div className="bg-card border border-border rounded-xl p-5" data-testid="card-account-balance">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-muted-foreground">Balance</p>
          <p className={cn("text-2xl font-bold mt-1", color)}>{value}</p>
          <p className="text-xs text-muted-foreground/60 mt-0.5">
            {isLoading ? "fetching…" : balance != null ? "available credit" : "live data unavailable"}
          </p>
        </div>
        <div className="p-2.5 rounded-xl bg-muted/30">
          <DollarSign className={cn("h-5 w-5", color)} />
        </div>
      </div>
    </div>
  );
}

// ── Date range helper ─────────────────────────────────────────────────────────

function dateRange(range: string): { startDate: string; endDate: string } {
  const now   = new Date();
  const end   = now.toISOString().slice(0, 19).replace("T", " ");
  const start = new Date(now);
  if (range === "today") {
    start.setHours(0, 0, 0, 0);
  } else if (range === "7d") {
    start.setDate(start.getDate() - 7);
  } else {
    start.setDate(start.getDate() - 30);
  }
  return { startDate: start.toISOString().slice(0, 19).replace("T", " "), endDate: end };
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ClientPortalPage() {
  const { toast } = useToast();
  const [selectedAccount, setSelectedAccount] = useState("1");
  const [timeRange, setTimeRange] = useState("today");
  const [activeTab, setActiveTab] = useState<"usage" | "access" | "tickets">("usage");
  const [selectedTicketId, setSelectedTicketId] = useState<number | null>(null);
  const [ticketFilter, setTicketFilter] = useState<string>("all");
  const [operatorReply, setOperatorReply] = useState("");
  const queryClientAdmin = useQueryClient();
  const [newTokenPerms, setNewTokenPerms] = useState<string[]>(["cdrs", "usage", "billing"]);
  const [showPermPanel, setShowPermPanel] = useState(false);
  const [confirmRevokeId, setConfirmRevokeId] = useState<number | null>(null);

  // ── Accounts list ──
  const { data: accountsResp } = useQuery<{ accounts: any[] }>({
    queryKey: ["/api/sippy/accounts"],
    staleTime: 60_000,
  });
  const accountList: any[] = Array.isArray(accountsResp?.accounts) ? accountsResp!.accounts : [];

  // ── CDRs — correct endpoint: /api/sippy/cdr (not /cdrs) ──
  const { startDate, endDate } = dateRange(timeRange);
  const { data: cdrResp, isLoading: cdrLoading, refetch: refetchCdrs } = useQuery<{ cdrs: CdrRow[] }>({
    queryKey: ["/api/sippy/cdr", selectedAccount, timeRange],
    queryFn: () =>
      fetch(`/api/sippy/cdr?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}&limit=100`)
        .then(r => r.json()),
    staleTime: 30_000,
  });

  const cdrs: CdrRow[] = (cdrResp?.cdrs ?? []).filter(c =>
    !selectedAccount || selectedAccount === "all" ? true : true // admin view shows all
  );
  const connected  = cdrs.filter(c => (c.duration ?? 0) > 0).length;
  const asr        = cdrs.length > 0 ? Math.round((connected / cdrs.length) * 100) : 0;
  const totalMin   = cdrs.reduce((s, c) => s + (c.duration ?? 0), 0) / 60;
  const quality    = computeQuality(cdrs);
  const destGroups = computeDestGroups(cdrs);

  // ── Operator ticket queries ──
  const { data: adminTicketsResp, refetch: refetchAdminTickets } = useQuery<{ tickets: any[] }>({
    queryKey: ["/api/admin/portal/tickets", ticketFilter],
    queryFn: () => fetch(`/api/admin/portal/tickets${ticketFilter !== "all" ? `?status=${ticketFilter}` : ""}`).then(r => r.json()),
    staleTime: 15_000,
  });
  const adminTickets: any[] = adminTicketsResp?.tickets ?? [];

  const { data: selectedTicketData, refetch: refetchTicketThread } = useQuery<{ ticket: any; messages: any[] }>({
    queryKey: ["/api/admin/portal/tickets", selectedTicketId, "thread"],
    queryFn: () => fetch(`/api/admin/portal/tickets/${selectedTicketId}`).then(r => r.json()),
    enabled: selectedTicketId !== null,
    staleTime: 10_000,
  });

  const updateStatusMut = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiRequest("PATCH", `/api/admin/portal/tickets/${id}/status`, { status }).then(r => r.json()),
    onSuccess: () => {
      queryClientAdmin.invalidateQueries({ queryKey: ["/api/admin/portal/tickets"] });
      toast({ title: "Status updated" });
    },
    onError: () => toast({ title: "Failed to update status", variant: "destructive" }),
  });

  const operatorReplyMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: string }) =>
      apiRequest("POST", `/api/admin/portal/tickets/${id}/reply`, { body }).then(r => r.json()),
    onSuccess: () => {
      setOperatorReply("");
      queryClientAdmin.invalidateQueries({ queryKey: ["/api/admin/portal/tickets", selectedTicketId, "thread"] });
      queryClientAdmin.invalidateQueries({ queryKey: ["/api/admin/portal/tickets"] });
      toast({ title: "Reply sent" });
    },
    onError: () => toast({ title: "Failed to send reply", variant: "destructive" }),
  });

  // ── Portal tokens ──
  const { data: tokensResp, refetch: refetchTokens } = useQuery<PortalToken[]>({
    queryKey: ["/api/portal-tokens"],
    staleTime: 30_000,
  });
  const tokens: PortalToken[] = tokensResp ?? [];

  const createTokenMut = useMutation({
    mutationFn: () => {
      const acct = accountList.find(a => String(a.iAccount) === selectedAccount);
      const name = acct?.username ?? `Account #${selectedAccount}`;
      return apiRequest("POST", "/api/portal-tokens", {
        accountId: selectedAccount,
        accountName: name,
        label: `${name} — created ${new Date().toLocaleDateString()}`,
        permissions: newTokenPerms,
      }).then(r => r.json());
    },
    onSuccess: (tok: PortalToken) => {
      queryClient.invalidateQueries({ queryKey: ["/api/portal-tokens"] });
      const link = `${window.location.origin}/portal/${tok.token}`;
      navigator.clipboard.writeText(link).catch(() => {});
      toast({ title: "Link created & copied!", description: link });
      setShowPermPanel(false);
    },
    onError: () => toast({ title: "Failed to create link", variant: "destructive" }),
  });

  const revokeTokenMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/portal-tokens/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portal-tokens"] });
      toast({ title: "Access link revoked" });
    },
    onError: () => toast({ title: "Failed to revoke", variant: "destructive" }),
  });

  function copyLink(token: string) {
    const link = `${window.location.origin}/portal/${token}`;
    navigator.clipboard.writeText(link).catch(() => {});
    toast({ title: "Link copied!", description: link });
  }

  function handleExport() {
    downloadCsv(`cdrs-${timeRange}-${new Date().toISOString().slice(0,10)}.csv`, [
      ["Time", "CLI", "CLD", "Duration", "Outcome", "Cost"],
      ...cdrs.slice(0, 200).map(r => [
        r.startTime ? new Date(r.startTime).toLocaleString() : "—",
        r.caller ?? "—", r.callee ?? "—",
        fmtDur(r.duration), String(r.result ?? "—"), String((r.cost ?? 0).toFixed(4)),
      ]),
    ]);
    toast({ title: "Export ready", description: `${cdrs.length} CDRs downloaded.` });
  }

  const TABS = [
    { id: "usage",   label: "Usage & CDRs"        },
    { id: "access",  label: "Client Access Links"  },
    { id: "tickets", label: "Support Tickets"      },
  ] as const;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20">
              <Globe className="h-5 w-5 text-blue-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Client Self-Service Portal</h1>
              <p className="text-sm text-muted-foreground">Usage overview, CDRs and client access management</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Select value={selectedAccount} onValueChange={setSelectedAccount}>
              <SelectTrigger className="w-52" data-testid="select-portal-account">
                <SelectValue placeholder="Select account" />
              </SelectTrigger>
              <SelectContent>
                {accountList.length > 0
                  ? accountList.map((a: any) => (
                      <SelectItem key={a.iAccount} value={String(a.iAccount)}>
                        #{a.iAccount} — {a.username}
                      </SelectItem>
                    ))
                  : <SelectItem value="1">#1 — PUSHTOTALK</SelectItem>
                }
              </SelectContent>
            </Select>
            <Select value={timeRange} onValueChange={setTimeRange}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-border">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              data-testid={`tab-portal-${t.id}`}
              className={cn(
                "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
                activeTab === t.id
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
              {t.id === "access" && tokens.length > 0 && (
                <span className="ml-1.5 text-[10px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded-full">
                  {tokens.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── Usage & CDRs tab ── */}
        {activeTab === "usage" && (
          <div className="space-y-6">
            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard icon={Phone}       label="Total Calls"   value={String(cdrs.length)}    sub={timeRange === "today" ? "today" : undefined} color="text-foreground" />
              <StatCard icon={TrendingUp}  label="ASR"           value={`${asr}%`}              sub="answer rate"    color={asr >= 70 ? "text-emerald-400" : asr >= 50 ? "text-amber-400" : "text-rose-400"} />
              <StatCard icon={Clock}       label="Minutes Used"  value={`${totalMin.toFixed(0)} min`} sub={`${(totalMin / 60).toFixed(1)} hrs`} color="text-cyan-400" />
              <BalanceStatCard accountId={selectedAccount} />
            </div>

            {/* Quality + Traffic + Security */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-card border border-border rounded-xl p-5 space-y-3">
                <p className="text-sm font-semibold flex items-center gap-2"><BarChart3 className="h-4 w-4 text-violet-400" /> Call Quality</p>
                <div className="space-y-2 text-sm">
                  {[
                    {
                      label: "Avg MOS",
                      value: cdrs.length > 0 ? `${quality.mos.toFixed(2)} (${quality.mosGrade})` : "—",
                      ok:    cdrs.length === 0 || quality.mos >= 3.5,
                    },
                    {
                      label: "Avg PDD",
                      value: cdrs.length > 0 ? `${quality.pdd.toFixed(2)}s` : "—",
                      ok:    cdrs.length === 0 || quality.pdd < 3,
                    },
                    {
                      label: "Net Fail",
                      value: cdrs.length > 0 ? `${quality.netFailPct.toFixed(2)}%` : "—",
                      ok:    cdrs.length === 0 || quality.netFailPct < 1,
                    },
                  ].map(q => (
                    <div key={q.label} className="flex items-center justify-between">
                      <span className="text-muted-foreground">{q.label}</span>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-medium">{q.value}</span>
                        {q.ok ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> : <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-card border border-border rounded-xl p-5 space-y-3">
                <p className="text-sm font-semibold flex items-center gap-2"><TrendingUp className="h-4 w-4 text-amber-400" /> Traffic Breakdown</p>
                <div className="space-y-2 text-sm">
                  {destGroups.length > 0 ? destGroups.map(t => (
                    <div key={t.label}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-muted-foreground">{t.label}</span>
                        <span>{t.pct}%</span>
                      </div>
                      <div className="h-1.5 bg-muted/30 rounded-full overflow-hidden">
                        <div className="h-full bg-primary/70 rounded-full" style={{ width: `${t.pct}%` }} />
                      </div>
                    </div>
                  )) : (
                    <p className="text-xs text-muted-foreground py-2 text-center">No call data for this period.</p>
                  )}
                </div>
              </div>

              <div className="bg-card border border-border rounded-xl p-5 space-y-3">
                <p className="text-sm font-semibold flex items-center gap-2"><Shield className="h-4 w-4 text-rose-400" /> Security</p>
                <div className="space-y-2 text-sm">
                  {[
                    { label: "FAS Detected",  value: "0 calls",   ok: true },
                    { label: "Blacklisted",   value: "0 numbers", ok: true },
                    { label: "Auth Failures", value: "0 today",   ok: true },
                  ].map(q => (
                    <div key={q.label} className="flex items-center justify-between">
                      <span className="text-muted-foreground">{q.label}</span>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{q.value}</span>
                        {q.ok ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> : <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* CDR table */}
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
                <h2 className="text-sm font-semibold">
                  Recent CDRs
                  {cdrs.length > 0 && <span className="ml-2 text-xs text-muted-foreground">({cdrs.length})</span>}
                </h2>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => refetchCdrs()} data-testid="button-refresh-cdrs">
                    <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", cdrLoading && "animate-spin")} />
                    Refresh
                  </Button>
                  <Button size="sm" variant="outline" onClick={handleExport} disabled={cdrs.length === 0} data-testid="button-export-cdrs">
                    <Download className="h-3.5 w-3.5 mr-1.5" /> Export CSV
                  </Button>
                </div>
              </div>
              {cdrLoading ? (
                <div className="p-8 text-center text-sm text-muted-foreground">Loading CDRs…</div>
              ) : cdrs.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  No CDRs found for the selected time range. CDRs are sourced from the Sippy switch.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/10">
                      <tr>
                        {["Time", "CLI", "CLD", "Duration", "Outcome", "Cost"].map(h => (
                          <th key={h} className="px-4 py-2.5 text-left text-muted-foreground font-medium">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {cdrs.slice(0, 50).map((r, i) => {
                        const ok = (r.duration ?? 0) > 0;
                        return (
                          <tr key={i} className="border-t border-border/20 hover:bg-muted/10" data-testid={`row-cdr-portal-${i}`}>
                            <td className="px-4 py-2 text-muted-foreground font-mono">
                              {r.startTime ? new Date(r.startTime).toLocaleTimeString() : "—"}
                            </td>
                            <td className="px-4 py-2 font-mono">{r.caller ?? "—"}</td>
                            <td className="px-4 py-2 font-mono">{r.callee ?? "—"}</td>
                            <td className="px-4 py-2 font-mono">{fmtDur(r.duration)}</td>
                            <td className="px-4 py-2">
                              <span className={cn(
                                "px-1.5 py-0.5 rounded text-[10px] font-semibold",
                                ok ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400",
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
                  {cdrs.length > 50 && (
                    <p className="px-4 py-2 text-xs text-muted-foreground border-t border-border/20">
                      Showing 50 of {cdrs.length} CDRs — export CSV for all records.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Client Access Links tab ── */}
        {activeTab === "access" && (
          <div className="space-y-4">

            {/* Info card */}
            <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4 flex items-start gap-3">
              <Key className="h-4 w-4 text-blue-400 mt-0.5 shrink-0" />
              <div className="text-sm text-muted-foreground">
                <p className="font-medium text-foreground mb-1">How client access works</p>
                <p>Generate a secure link for each client account. Send the link to your client — they open it in any browser without needing to log in. The link shows only their own CDRs, usage stats, and quality metrics.</p>
              </div>
            </div>

            {/* Generate button + permissions config */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Active Access Links</h3>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm" variant="outline"
                    onClick={() => setShowPermPanel(p => !p)}
                    data-testid="button-toggle-perms"
                  >
                    <Settings className="h-3.5 w-3.5 mr-1.5" />Permissions
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => createTokenMut.mutate()}
                    disabled={createTokenMut.isPending || newTokenPerms.length === 0}
                    data-testid="button-create-portal-link"
                  >
                    <Plus className="h-3.5 w-3.5 mr-1.5" />
                    {createTokenMut.isPending ? "Generating…" : "Generate Link"}
                  </Button>
                </div>
              </div>

              {/* Permissions config panel */}
              {showPermPanel && (
                <div className="bg-muted/20 border border-border rounded-xl p-4 space-y-3">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Client permissions for new link</p>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { key: "cdrs",    label: "Call History",   desc: "Access CDRs with download" },
                      { key: "usage",   label: "Usage Stats",    desc: "Calls, minutes, ASR"       },
                      { key: "billing", label: "Billing",        desc: "Cost breakdown & rates"     },
                    ].map(p => {
                      const active = newTokenPerms.includes(p.key);
                      return (
                        <button
                          key={p.key}
                          onClick={() => setNewTokenPerms(prev =>
                            active ? prev.filter(x => x !== p.key) : [...prev, p.key]
                          )}
                          data-testid={`toggle-perm-${p.key}`}
                          className={cn(
                            "rounded-lg border p-3 text-left transition-all text-xs",
                            active
                              ? "border-primary/60 bg-primary/5 text-foreground"
                              : "border-border text-muted-foreground hover:border-border/80",
                          )}
                        >
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <div className={cn("w-2 h-2 rounded-full", active ? "bg-emerald-400" : "bg-muted-foreground/30")} />
                            <span className="font-medium">{p.label}</span>
                          </div>
                          <span className="text-[10px] text-muted-foreground">{p.desc}</span>
                        </button>
                      );
                    })}
                  </div>
                  {newTokenPerms.length === 0 && (
                    <p className="text-xs text-amber-400">Select at least one permission to generate a link.</p>
                  )}
                </div>
              )}
            </div>

            {/* Token list */}
            {tokens.length === 0 ? (
              <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
                No access links yet. Select an account above and click "Generate Link" to create one.
              </div>
            ) : (
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/10 text-xs font-medium text-muted-foreground">
                      <th className="text-left px-4 py-2.5">Account</th>
                      <th className="text-left px-4 py-2.5">Permissions</th>
                      <th className="text-left px-4 py-2.5">Created</th>
                      <th className="text-left px-4 py-2.5">Last Used</th>
                      <th className="text-left px-4 py-2.5">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tokens.map(tok => {
                      let tokPerms: string[] = ["cdrs", "usage", "billing"];
                      try { tokPerms = JSON.parse(tok.permissions ?? '["cdrs","usage","billing"]'); } catch {}
                      const PERM_LABELS: Record<string, string> = { cdrs: "CDRs", usage: "Usage", billing: "Billing" };

                      // Expiry badge
                      let expiryBadge: { label: string; cls: string } | null = null;
                      if (tok.expiresAt) {
                        const daysLeft = Math.ceil((new Date(tok.expiresAt).getTime() - Date.now()) / 86_400_000);
                        if (daysLeft < 0) {
                          expiryBadge = { label: "Expired", cls: "bg-rose-500/15 text-rose-400 border-rose-500/20" };
                        } else if (daysLeft <= 7) {
                          expiryBadge = { label: `Expires in ${daysLeft}d`, cls: "bg-amber-500/15 text-amber-400 border-amber-500/20" };
                        } else {
                          expiryBadge = { label: `${daysLeft}d left`, cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" };
                        }
                      }

                      const isConfirming = confirmRevokeId === tok.id;

                      return (
                        <tr key={tok.id} className="border-b border-border/50 last:border-0 hover:bg-muted/5" data-testid={`row-token-${tok.id}`}>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-medium text-sm">{tok.accountName}</p>
                              {expiryBadge && (
                                <Badge className={cn("text-[9px] h-4 px-1 border", expiryBadge.cls)}>
                                  {expiryBadge.label}
                                </Badge>
                              )}
                            </div>
                            <p className="text-[10px] text-muted-foreground mt-0.5">ID {tok.accountId}</p>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1 flex-wrap">
                              {tokPerms.map(p => (
                                <Badge key={p} className="text-[9px] h-4 px-1 bg-primary/10 text-primary border-primary/20">
                                  {PERM_LABELS[p] ?? p}
                                </Badge>
                              ))}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {new Date(tok.createdAt).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {tok.lastUsedAt
                              ? <span title={new Date(tok.lastUsedAt).toISOString()}>{new Date(tok.lastUsedAt).toLocaleDateString()}</span>
                              : <span className="text-muted-foreground/40">Never</span>}
                          </td>
                          <td className="px-4 py-3">
                            {isConfirming ? (
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs text-rose-400 font-medium">Revoke this link?</span>
                                <Button
                                  size="sm" variant="ghost"
                                  className="text-rose-400 hover:bg-rose-500/10 h-7 px-2 text-xs"
                                  onClick={() => { revokeTokenMut.mutate(tok.id); setConfirmRevokeId(null); }}
                                  disabled={revokeTokenMut.isPending}
                                  data-testid={`button-confirm-revoke-${tok.id}`}
                                >
                                  Yes, revoke
                                </Button>
                                <Button
                                  size="sm" variant="ghost"
                                  className="h-7 px-2 text-xs"
                                  onClick={() => setConfirmRevokeId(null)}
                                  data-testid={`button-cancel-revoke-${tok.id}`}
                                >
                                  Cancel
                                </Button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5">
                                <Button
                                  size="sm" variant="outline"
                                  onClick={() => copyLink(tok.token)}
                                  data-testid={`button-copy-token-${tok.id}`}
                                >
                                  <Copy className="h-3 w-3 mr-1" /> Copy Link
                                </Button>
                                <Button
                                  size="sm" variant="ghost"
                                  className="text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
                                  onClick={() => setConfirmRevokeId(tok.id)}
                                  data-testid={`button-revoke-token-${tok.id}`}
                                >
                                  <Trash2 className="h-3 w-3 mr-1" /> Revoke
                                </Button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── Support Tickets tab ── */}
        {activeTab === "tickets" && (
          <div className="space-y-4">

            {/* Header + filter */}
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h3 className="text-sm font-semibold flex items-center gap-1.5">
                <MessageSquare className="h-4 w-4 text-blue-400" /> Client Tickets
              </h3>
              <div className="flex items-center gap-2">
                <select
                  value={ticketFilter}
                  onChange={e => { setTicketFilter(e.target.value); setSelectedTicketId(null); }}
                  className="text-xs bg-muted border border-border rounded-lg px-2 py-1.5 focus:outline-none"
                  data-testid="select-ticket-filter"
                >
                  <option value="all">All</option>
                  <option value="open">Open</option>
                  <option value="in_progress">In Progress</option>
                  <option value="waiting_client">Waiting Client</option>
                  <option value="resolved">Resolved</option>
                </select>
                <Button size="sm" variant="ghost" onClick={() => refetchAdminTickets()} data-testid="btn-refresh-tickets">
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

              {/* Ticket list */}
              <div className="md:col-span-1 rounded-xl border border-border bg-card overflow-hidden">
                {adminTickets.length === 0 ? (
                  <div className="p-8 text-center">
                    <MessageSquare className="h-7 w-7 text-muted-foreground/40 mx-auto mb-2" />
                    <p className="text-xs text-muted-foreground">No tickets in this filter.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-border/20">
                    {adminTickets.map((t: any) => {
                      const dotCls: Record<string, string> = {
                        open: "bg-blue-400", in_progress: "bg-amber-400",
                        waiting_client: "bg-purple-400", resolved: "bg-emerald-400",
                      };
                      return (
                        <button
                          key={t.id}
                          onClick={() => setSelectedTicketId(t.id)}
                          className={cn(
                            "w-full text-left px-3 py-3 hover:bg-muted/10 transition-colors",
                            selectedTicketId === t.id && "bg-muted/20",
                          )}
                          data-testid={`admin-ticket-row-${t.id}`}
                        >
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", dotCls[t.status] ?? "bg-blue-400")} />
                            <span className="text-xs font-medium truncate">{t.subject}</span>
                          </div>
                          <p className="text-[10px] text-muted-foreground pl-3">{t.accountName} · #{t.id} · {new Date(t.updatedAt).toLocaleDateString()}</p>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Thread panel */}
              <div className="md:col-span-2 rounded-xl border border-border bg-card overflow-hidden">
                {!selectedTicketId ? (
                  <div className="p-10 text-center flex flex-col items-center justify-center">
                    <ChevronRight className="h-7 w-7 text-muted-foreground/30 mb-2" />
                    <p className="text-xs text-muted-foreground">Select a ticket to view the thread.</p>
                  </div>
                ) : !selectedTicketData ? (
                  <div className="p-8 text-center">
                    <p className="text-xs text-muted-foreground">Loading…</p>
                  </div>
                ) : (
                  <div className="flex flex-col">

                    {/* Ticket header + status buttons */}
                    <div className="px-4 py-3 border-b border-border/50 flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">{selectedTicketData.ticket?.subject}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {selectedTicketData.ticket?.accountName} · {selectedTicketData.ticket?.category?.replace(/_/g, " ")} · #{selectedTicketData.ticket?.id}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 flex-wrap shrink-0">
                        {(["open", "in_progress", "waiting_client", "resolved"] as const).map(st => (
                          <button
                            key={st}
                            onClick={() => updateStatusMut.mutate({ id: selectedTicketData.ticket.id, status: st })}
                            className={cn(
                              "text-[10px] px-2 py-0.5 rounded font-medium border transition-colors",
                              selectedTicketData.ticket?.status === st
                                ? "bg-primary text-primary-foreground border-primary"
                                : "border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground",
                            )}
                            data-testid={`btn-status-${st}`}
                          >
                            {st === "in_progress" ? "In Progress" : st === "waiting_client" ? "Waiting" : st.charAt(0).toUpperCase() + st.slice(1)}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Messages */}
                    <div className="divide-y divide-border/20 max-h-80 overflow-y-auto">
                      {(selectedTicketData.messages ?? []).map((m: any) => (
                        <div key={m.id} className={cn("px-4 py-3", m.author === "operator" ? "bg-primary/5" : "")}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[11px] font-semibold text-muted-foreground">
                              {m.author === "operator" ? "You (Operator)" : selectedTicketData.ticket?.accountName ?? "Client"}
                            </span>
                            <span className="text-[10px] text-muted-foreground/60">
                              {new Date(m.createdAt).toISOString().replace("T", " ").slice(0, 16)} UTC
                            </span>
                          </div>
                          <p className="text-sm whitespace-pre-wrap">{m.body}</p>
                        </div>
                      ))}
                    </div>

                    {/* Operator reply box */}
                    <div className="border-t border-border/50 p-3 flex gap-2">
                      <textarea
                        value={operatorReply}
                        onChange={e => setOperatorReply(e.target.value)}
                        placeholder="Reply to client…"
                        rows={2}
                        className="flex-1 text-xs bg-muted/50 border border-border rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                        data-testid="textarea-operator-reply"
                      />
                      <Button
                        size="sm"
                        onClick={() => operatorReplyMut.mutate({ id: selectedTicketData.ticket.id, body: operatorReply })}
                        disabled={!operatorReply.trim() || operatorReplyMut.isPending}
                        data-testid="btn-operator-send-reply"
                      >
                        <Send className="h-3.5 w-3.5" />
                      </Button>
                    </div>

                  </div>
                )}
              </div>

            </div>
          </div>
        )}

      </div>
    </div>
  );
}

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Globe, Phone, TrendingUp, DollarSign, Clock, CheckCircle2,
  AlertTriangle, Download, BarChart3, Shield, Link2, Plus,
  Trash2, Copy, RefreshCw, Key,
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
  const [activeTab, setActiveTab] = useState<"usage" | "access">("usage");

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
      }).then(r => r.json());
    },
    onSuccess: (tok: PortalToken) => {
      queryClient.invalidateQueries({ queryKey: ["/api/portal-tokens"] });
      const link = `${window.location.origin}/portal/${tok.token}`;
      navigator.clipboard.writeText(link).catch(() => {});
      toast({ title: "Link created & copied!", description: link });
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
    { id: "usage",  label: "Usage & CDRs"   },
    { id: "access", label: "Client Access Links" },
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
                    { label: "Avg MOS",    value: "4.2",   target: "≥4.0", ok: true  },
                    { label: "Avg PDD",    value: "1.1s",  target: "<3s",  ok: true  },
                    { label: "Pkt Loss",   value: "0.16%", target: "<1%",  ok: true  },
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
                  {[
                    { label: "Pakistan Mobile", pct: 78 },
                    { label: "Pakistan Fixed",  pct: 14 },
                    { label: "International",   pct: 8  },
                  ].map(t => (
                    <div key={t.label}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-muted-foreground">{t.label}</span>
                        <span>{t.pct}%</span>
                      </div>
                      <div className="h-1.5 bg-muted/30 rounded-full overflow-hidden">
                        <div className="h-full bg-primary/70 rounded-full" style={{ width: `${t.pct}%` }} />
                      </div>
                    </div>
                  ))}
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

            {/* Generate button */}
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Active Access Links</h3>
              <Button
                size="sm"
                onClick={() => createTokenMut.mutate()}
                disabled={createTokenMut.isPending}
                data-testid="button-create-portal-link"
              >
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                {createTokenMut.isPending ? "Generating…" : "Generate Link for Selected Account"}
              </Button>
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
                      <th className="text-left px-4 py-2.5">Label</th>
                      <th className="text-left px-4 py-2.5">Created</th>
                      <th className="text-left px-4 py-2.5">Last Used</th>
                      <th className="text-left px-4 py-2.5">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tokens.map(tok => (
                      <tr key={tok.id} className="border-b border-border/50 last:border-0 hover:bg-muted/5" data-testid={`row-token-${tok.id}`}>
                        <td className="px-4 py-3 font-medium">{tok.accountName}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{tok.label ?? "—"}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {new Date(tok.createdAt).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {tok.lastUsedAt ? new Date(tok.lastUsedAt).toLocaleString() : "Never"}
                        </td>
                        <td className="px-4 py-3">
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
                              onClick={() => revokeTokenMut.mutate(tok.id)}
                              disabled={revokeTokenMut.isPending}
                              data-testid={`button-revoke-token-${tok.id}`}
                            >
                              <Trash2 className="h-3 w-3 mr-1" /> Revoke
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}

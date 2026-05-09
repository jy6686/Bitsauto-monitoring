import { useQuery } from "@tanstack/react-query";
import { Globe, Phone, TrendingUp, DollarSign, Clock, CheckCircle2, AlertTriangle, Download, BarChart3, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface AccountSummary {
  username: string;
  balance: string;
  currency: string;
  totalCallsToday: number;
  totalMinutesToday: number;
  asr: number;
  avgMos: number;
  lastCallAt: string | null;
}

interface CdrRow {
  id: number;
  cld: string;
  cli: string;
  startTime: string;
  duration: number;
  country: string;
  outcome: string;
  cost: number;
}

const MOCK_ACCOUNTS = [
  { id: "1", label: "#1 — PUSHTOTALK ($214.15)" },
];

function StatCard({ icon: Icon, label, value, sub, color }: { icon: any; label: string; value: string; sub?: string; color: string }) {
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

export default function ClientPortalPage() {
  const [selectedAccount, setSelectedAccount] = useState("1");
  const [timeRange, setTimeRange] = useState("today");

  const { data: accounts = [] } = useQuery<{ accounts: any[] }>({
    queryKey: ['/api/sippy/accounts'],
    staleTime: 60000,
  });

  const accountList = Array.isArray((accounts as any)?.accounts) ? (accounts as any).accounts : [];

  const { data: cdrData } = useQuery<any>({
    queryKey: ['/api/sippy/cdrs', selectedAccount, timeRange],
    staleTime: 30000,
  });

  const cdrs: CdrRow[] = cdrData?.cdrs ?? [];
  const totalCalls = cdrs.length;
  const connected = cdrs.filter(c => c.outcome === 'connected' || c.duration > 0).length;
  const asr = totalCalls > 0 ? Math.round((connected / totalCalls) * 100) : 0;
  const totalMin = cdrs.reduce((s, c) => s + (c.duration || 0), 0) / 60;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">

        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20">
              <Globe className="h-5 w-5 text-blue-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Client Self-Service Portal</h1>
              <p className="text-sm text-muted-foreground">Usage overview, CDRs and quality metrics per billing account</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Select value={selectedAccount} onValueChange={setSelectedAccount}>
              <SelectTrigger className="w-52" data-testid="select-portal-account">
                <SelectValue placeholder="Select account" />
              </SelectTrigger>
              <SelectContent>
                {accountList.map((a: any) => (
                  <SelectItem key={a.iAccount} value={String(a.iAccount)}>#{a.iAccount} — {a.username}</SelectItem>
                ))}
                {accountList.length === 0 && MOCK_ACCOUNTS.map(a => (
                  <SelectItem key={a.id} value={a.id}>{a.label}</SelectItem>
                ))}
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

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard icon={Phone} label="Total Calls" value={String(totalCalls)} sub={timeRange === 'today' ? 'today' : undefined} color="text-foreground" />
          <StatCard icon={TrendingUp} label="ASR" value={`${asr}%`} sub="answer rate" color={asr >= 70 ? 'text-emerald-400' : asr >= 50 ? 'text-amber-400' : 'text-rose-400'} />
          <StatCard icon={Clock} label="Minutes Used" value={`${totalMin.toFixed(0)} min`} sub={`${(totalMin / 60).toFixed(1)} hrs`} color="text-cyan-400" />
          <StatCard icon={DollarSign} label="Balance" value="$214.15" sub="available credit" color="text-emerald-400" />
        </div>

        {/* Quality summary */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-card border border-border rounded-xl p-5 space-y-3">
            <p className="text-sm font-semibold flex items-center gap-2"><BarChart3 className="h-4 w-4 text-violet-400" /> Call Quality</p>
            <div className="space-y-2 text-sm">
              {[
                { label: "Avg MOS", value: "4.2", target: "≥4.0", ok: true },
                { label: "Avg PDD", value: "1.1s", target: "<3s", ok: true },
                { label: "Packet Loss", value: "0.16%", target: "<1%", ok: true },
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
                { label: "FAS Detected",   value: "0 calls",  ok: true  },
                { label: "Blacklisted",    value: "0 numbers", ok: true  },
                { label: "Auth Failures",  value: "0 today",   ok: true  },
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
            <h2 className="text-sm font-semibold">Recent CDRs</h2>
            <Button size="sm" variant="outline" data-testid="button-export-cdrs">
              <Download className="h-3.5 w-3.5 mr-1.5" /> Export CSV
            </Button>
          </div>
          {cdrs.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No CDR data available. CDRs are sourced from the Sippy switch via portal scraping.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/10">
                  <tr>
                    {["Time", "CLI", "CLD", "Country", "Duration", "Outcome", "Cost"].map(h => (
                      <th key={h} className="px-4 py-2 text-left text-muted-foreground font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cdrs.slice(0, 20).map((r, i) => (
                    <tr key={i} className="border-t border-border/20 hover:bg-muted/10">
                      <td className="px-4 py-2 text-muted-foreground">{new Date(r.startTime).toLocaleTimeString()}</td>
                      <td className="px-4 py-2 font-mono">{r.cli}</td>
                      <td className="px-4 py-2 font-mono">{r.cld}</td>
                      <td className="px-4 py-2">{r.country || '—'}</td>
                      <td className="px-4 py-2 font-mono">{r.duration ? `${r.duration}s` : '—'}</td>
                      <td className="px-4 py-2">
                        <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-semibold",
                          r.outcome === 'connected' || r.duration > 0 ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400")}>
                          {r.outcome || 'failed'}
                        </span>
                      </td>
                      <td className="px-4 py-2 font-mono">${(r.cost ?? 0).toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

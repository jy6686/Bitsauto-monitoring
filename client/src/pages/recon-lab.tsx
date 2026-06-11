import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  FlaskConical, RefreshCw, CheckCircle2, XCircle, AlertTriangle,
  FileAudio, Database, Search, Clock, Shield, Download, ChevronRight,
  Fingerprint, FileSearch, Activity,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

// ── Tab IDs ───────────────────────────────────────────────────────────────────
type TabId = "recording" | "cdr" | "identity";

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(n: number | null | undefined, decimals = 4) {
  if (n === null || n === undefined) return "—";
  return n.toFixed(decimals);
}
function fmtTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", { hour12: false, timeZone: "UTC" }).replace(",", "");
}
function fmtBytes(bytes: number | null) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
function pct(num: number, den: number) {
  if (!den) return "—";
  return `${Math.round((num / den) * 100)}%`;
}

// ── Status Badges ─────────────────────────────────────────────────────────────
function FileStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    ok:        { label: "File OK",    cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
    missing:   { label: "Missing",   cls: "bg-red-500/15 text-red-400 border-red-500/30" },
    empty:     { label: "Empty",     cls: "bg-orange-500/15 text-orange-400 border-orange-500/30" },
    no_path:   { label: "No Path",   cls: "bg-slate-500/15 text-slate-400 border-slate-500/30" },
    unchecked: { label: "Unchecked", cls: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
  };
  const m = map[status] ?? { label: status, cls: "bg-slate-500/15 text-slate-400" };
  return <span className={cn("text-xs px-2 py-0.5 rounded-full border font-mono", m.cls)}>{m.label}</span>;
}

function MatchBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    matched: { label: "Matched",  cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
    partial: { label: "Partial",  cls: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30" },
    missing: { label: "Missing",  cls: "bg-red-500/15 text-red-400 border-red-500/30" },
    pending: { label: "Pending",  cls: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
  };
  const m = map[status] ?? { label: status, cls: "bg-slate-500/15 text-slate-400" };
  return <span className={cn("text-xs px-2 py-0.5 rounded-full border font-mono", m.cls)}>{m.label}</span>;
}

function Check({ v }: { v: boolean }) {
  return v
    ? <CheckCircle2 className="w-4 h-4 text-emerald-400 mx-auto" />
    : <XCircle className="w-4 h-4 text-slate-600 mx-auto" />;
}

// ── Summary Card ─────────────────────────────────────────────────────────────
function SummaryCard({ label, value, sub, color = "text-white" }: {
  label: string; value: string | number; sub?: string; color?: string;
}) {
  return (
    <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg p-4 flex flex-col gap-1">
      <span className="text-xs text-slate-400">{label}</span>
      <span className={cn("text-2xl font-bold tabular-nums", color)}>{value}</span>
      {sub && <span className="text-xs text-slate-500">{sub}</span>}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ReconciliationLabPage() {
  const [activeTab, setActiveTab] = useState<TabId>("recording");
  const [days, setDays]           = useState(7);
  const [search, setSearch]       = useState("");
  const { toast } = useToast();

  // ── Queries ──────────────────────────────────────────────────────────────
  const recordingQ = useQuery<any>({
    queryKey: ["/api/recon-lab/recording-integrity", days],
    queryFn: () => fetch(`/api/recon-lab/recording-integrity?days=${days}`).then(r => r.json()),
    staleTime: 60_000,
  });
  const cdrQ = useQuery<any>({
    queryKey: ["/api/recon-lab/cdr-reconciliation", days],
    queryFn: () => fetch(`/api/recon-lab/cdr-reconciliation?days=${days}`).then(r => r.json()),
    staleTime: 60_000,
  });
  const identityQ = useQuery<any>({
    queryKey: ["/api/recon-lab/identity-audit"],
    queryFn: () => fetch(`/api/recon-lab/identity-audit?limit=100`).then(r => r.json()),
    staleTime: 120_000,
  });

  const activeQ = activeTab === "recording" ? recordingQ : activeTab === "cdr" ? cdrQ : identityQ;

  function refresh() {
    recordingQ.refetch();
    cdrQ.refetch();
    identityQ.refetch();
    toast({ title: "Refreshed", description: "Recon Lab data reloaded." });
  }

  // ── Filter helpers ────────────────────────────────────────────────────────
  const recCalls: any[] = (recordingQ.data?.calls ?? []).filter((c: any) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return String(c.id).includes(s) || (c.caller ?? "").includes(s) || (c.callee ?? "").includes(s);
  });
  const cdrCalls: any[] = (cdrQ.data?.calls ?? []).filter((c: any) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return String(c.id).includes(s) || (c.caller ?? "").includes(s) || (c.callee ?? "").includes(s);
  });
  const idCalls: any[] = (identityQ.data?.calls ?? []).filter((c: any) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return String(c.id).includes(s) || (c.caller ?? "").includes(s) || (c.callee ?? "").includes(s);
  });

  // ── Tabs ──────────────────────────────────────────────────────────────────
  const tabs: { id: TabId; label: string; icon: any; desc: string }[] = [
    { id: "recording", label: "Recording Integrity", icon: FileAudio, desc: "File existence, size and SSH reachability per governed call" },
    { id: "cdr",       label: "CDR Reconciliation",  icon: Database,  desc: "Customer CDR + Vendor CDR + P&L unified match view" },
    { id: "identity",  label: "Identity Audit",       icon: Fingerprint, desc: "Which fields (Call-ID, UniqueID, CLD) survive the full call lifecycle" },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Header */}
      <div className="border-b border-slate-800 bg-slate-900/60 px-6 py-4">
        <div className="max-w-screen-2xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-violet-500/15 border border-violet-500/30 flex items-center justify-center">
              <FlaskConical className="w-4 h-4 text-violet-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-semibold text-white">Reconciliation Lab</h1>
                <Badge className="text-xs bg-violet-500/15 text-violet-300 border-violet-500/30 border">Admin Only</Badge>
              </div>
              <p className="text-xs text-slate-400">Sprint 1 diagnostics — recording, CDR, and identity validation</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={days}
              onChange={e => setDays(Number(e.target.value))}
              className="bg-slate-800 border border-slate-700 text-sm text-slate-300 rounded-md px-2 py-1.5"
            >
              <option value={1}>Last 24 h</option>
              <option value={3}>Last 3 days</option>
              <option value={7}>Last 7 days</option>
              <option value={14}>Last 14 days</option>
              <option value={30}>Last 30 days</option>
            </select>
            <Button variant="outline" size="sm" onClick={refresh} disabled={activeQ.isFetching}
              className="border-slate-700 text-slate-300 hover:text-white">
              <RefreshCw className={cn("w-3.5 h-3.5 mr-1.5", activeQ.isFetching && "animate-spin")} />
              Refresh
            </Button>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="border-b border-slate-800 bg-slate-900/30 px-6">
        <div className="max-w-screen-2xl mx-auto flex gap-0">
          {tabs.map(t => (
            <button
              key={t.id}
              data-testid={`tab-${t.id}`}
              onClick={() => setActiveTab(t.id)}
              className={cn(
                "flex items-center gap-2 px-4 py-3 text-sm border-b-2 transition-colors",
                activeTab === t.id
                  ? "border-violet-500 text-violet-300"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              )}
            >
              <t.icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="max-w-screen-2xl mx-auto px-6 py-6 space-y-5">

        {/* ── Tab 1: Recording Integrity ─────────────────────────────────── */}
        {activeTab === "recording" && (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
              <SummaryCard label="Completed Calls" value={recordingQ.data?.summary?.total ?? "…"} />
              <SummaryCard label="Has Recording Path" value={recordingQ.data?.summary?.hasPath ?? "…"}
                color="text-blue-300" />
              <SummaryCard label="No Path" value={recordingQ.data?.summary?.noPath ?? "…"}
                color="text-slate-400" />
              <SummaryCard label="File OK" value={recordingQ.data?.summary?.fileOk ?? "…"}
                color="text-emerald-400" />
              <SummaryCard label="File Missing" value={recordingQ.data?.summary?.fileMissing ?? "…"}
                color="text-red-400" />
              <SummaryCard label="Empty (0 B)" value={recordingQ.data?.summary?.fileEmpty ?? "…"}
                color="text-orange-400" />
              <SummaryCard label="Success Rate" value={`${recordingQ.data?.summary?.successPct ?? "…"}%`}
                color={
                  (recordingQ.data?.summary?.successPct ?? 0) >= 90 ? "text-emerald-400" :
                  (recordingQ.data?.summary?.successPct ?? 0) >= 60 ? "text-yellow-400" : "text-red-400"
                } />
            </div>

            {/* Search */}
            <div className="relative w-80">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <Input
                placeholder="Search by call ID, CLI, CLD…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9 bg-slate-800/60 border-slate-700 text-sm"
                data-testid="input-recording-search"
              />
            </div>

            {/* Table */}
            <div className="rounded-lg border border-slate-800 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-800/80 text-slate-400 text-xs">
                    <tr>
                      <th className="text-left px-3 py-2.5 font-medium">#</th>
                      <th className="text-left px-3 py-2.5 font-medium">CLI</th>
                      <th className="text-left px-3 py-2.5 font-medium">CLD</th>
                      <th className="text-left px-3 py-2.5 font-medium">Start (UTC)</th>
                      <th className="text-left px-3 py-2.5 font-medium">Recording Path</th>
                      <th className="text-left px-3 py-2.5 font-medium">Status</th>
                      <th className="text-left px-3 py-2.5 font-medium">Size</th>
                      <th className="text-left px-3 py-2.5 font-medium">Stream</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {recordingQ.isLoading && (
                      <tr><td colSpan={8} className="text-center text-slate-500 py-8">Loading…</td></tr>
                    )}
                    {!recordingQ.isLoading && recCalls.length === 0 && (
                      <tr><td colSpan={8} className="text-center text-slate-500 py-8">No completed calls in window</td></tr>
                    )}
                    {recCalls.map((c: any) => (
                      <tr key={c.id} className="hover:bg-slate-800/30 transition-colors" data-testid={`row-recording-${c.id}`}>
                        <td className="px-3 py-2.5 font-mono text-xs text-slate-400">{c.id}</td>
                        <td className="px-3 py-2.5 font-mono text-xs text-slate-300">{c.caller ?? "—"}</td>
                        <td className="px-3 py-2.5 font-mono text-xs text-slate-300">{c.callee ?? "—"}</td>
                        <td className="px-3 py-2.5 text-xs text-slate-400">{fmtTime(c.startTime)}</td>
                        <td className="px-3 py-2.5 font-mono text-xs text-slate-500 max-w-xs truncate" title={c.recordingPath ?? ""}>
                          {c.recordingPath ?? <span className="text-slate-600">none</span>}
                        </td>
                        <td className="px-3 py-2.5"><FileStatusBadge status={c.fileStatus} /></td>
                        <td className="px-3 py-2.5 text-xs text-slate-400">{fmtBytes(c.fileSize)}</td>
                        <td className="px-3 py-2.5">
                          {c.recordingPath ? (
                            <a
                              href={`/api/call-governance/recordings/stream?path=${encodeURIComponent(c.recordingPath)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                              data-testid={`link-stream-${c.id}`}
                            >
                              <Download className="w-3 h-3" />
                              Stream
                            </a>
                          ) : (
                            <span className="text-slate-600 text-xs">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {recCalls.length > 0 && (
              <p className="text-xs text-slate-500">
                Showing {recCalls.length} completed calls · SSH file-stat checks performed for up to 100 calls with a recording path
              </p>
            )}
          </>
        )}

        {/* ── Tab 2: CDR Reconciliation ──────────────────────────────────── */}
        {activeTab === "cdr" && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
              <SummaryCard label="Total Calls" value={cdrQ.data?.summary?.total ?? "…"} />
              <SummaryCard label="Completed" value={cdrQ.data?.summary?.completed ?? "…"} color="text-blue-300" />
              <SummaryCard label="Matched" value={cdrQ.data?.summary?.matched ?? "…"} color="text-emerald-400" />
              <SummaryCard label="Missing" value={cdrQ.data?.summary?.missing ?? "…"} color="text-red-400" />
              <SummaryCard label="Partial" value={cdrQ.data?.summary?.partial ?? "…"} color="text-yellow-400" />
              <SummaryCard label="Pending" value={cdrQ.data?.summary?.pending ?? "…"} color="text-slate-400" />
              <SummaryCard label="Match Rate" value={`${cdrQ.data?.summary?.matchRatePct ?? "…"}%`}
                color={
                  (cdrQ.data?.summary?.matchRatePct ?? 0) >= 90 ? "text-emerald-400" :
                  (cdrQ.data?.summary?.matchRatePct ?? 0) >= 60 ? "text-yellow-400" : "text-red-400"
                } />
            </div>

            <div className="relative w-80">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <Input
                placeholder="Search by call ID, CLI, CLD…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9 bg-slate-800/60 border-slate-700 text-sm"
                data-testid="input-cdr-search"
              />
            </div>

            <div className="rounded-lg border border-slate-800 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-800/80 text-slate-400 text-xs">
                    <tr>
                      <th className="text-left px-3 py-2.5 font-medium">#</th>
                      <th className="text-left px-3 py-2.5 font-medium">CLI</th>
                      <th className="text-left px-3 py-2.5 font-medium">CLD</th>
                      <th className="text-left px-3 py-2.5 font-medium">Start (UTC)</th>
                      <th className="text-left px-3 py-2.5 font-medium">Match</th>
                      <th className="text-left px-3 py-2.5 font-medium">Customer CDR</th>
                      <th className="text-left px-3 py-2.5 font-medium">P&amp;L Cost</th>
                      <th className="text-left px-3 py-2.5 font-medium">P&amp;L Revenue</th>
                      <th className="text-left px-3 py-2.5 font-medium">Vendor</th>
                      <th className="text-left px-3 py-2.5 font-medium">Duration</th>
                      <th className="text-left px-3 py-2.5 font-medium">Checked</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {cdrQ.isLoading && (
                      <tr><td colSpan={11} className="text-center text-slate-500 py-8">Loading…</td></tr>
                    )}
                    {!cdrQ.isLoading && cdrCalls.length === 0 && (
                      <tr><td colSpan={11} className="text-center text-slate-500 py-8">No calls in window</td></tr>
                    )}
                    {cdrCalls.map((c: any) => (
                      <tr key={c.id} className="hover:bg-slate-800/30 transition-colors" data-testid={`row-cdr-${c.id}`}>
                        <td className="px-3 py-2 font-mono text-xs text-slate-400">{c.id}</td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-300">{c.caller ?? "—"}</td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-300">{c.callee ?? "—"}</td>
                        <td className="px-3 py-2 text-xs text-slate-400">{fmtTime(c.startTime)}</td>
                        <td className="px-3 py-2"><MatchBadge status={c.matchStatus} /></td>
                        <td className="px-3 py-2">
                          {c.customerCdrFound
                            ? <span className="text-xs text-emerald-400 font-mono">Found</span>
                            : <span className="text-xs text-slate-600">—</span>}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-300">{fmt(c.cdrCost)}</td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-300">{fmt(c.cdrVendorCost)}</td>
                        <td className="px-3 py-2 text-xs text-slate-400 max-w-32 truncate" title={c.cdrVendorName ?? ""}>{c.cdrVendorName ?? "—"}</td>
                        <td className="px-3 py-2 text-xs text-slate-400">{c.cdrDuration != null ? `${c.cdrDuration}s` : "—"}</td>
                        <td className="px-3 py-2 text-xs text-slate-500">{fmtTime(c.cdrCheckedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {cdrCalls.length > 0 && (
              <p className="text-xs text-slate-500">
                Showing {cdrCalls.length} calls · Customer CDR presence checked against live cdrCache · P&amp;L data from Track 2b
              </p>
            )}
          </>
        )}

        {/* ── Tab 3: Identity Audit ──────────────────────────────────────── */}
        {activeTab === "identity" && (
          <>
            {/* Recommendation banner */}
            {identityQ.data?.summary?.recommendation && (
              <div className="flex items-start gap-3 rounded-lg border border-violet-500/30 bg-violet-500/10 px-4 py-3">
                <Fingerprint className="w-4 h-4 text-violet-400 mt-0.5 shrink-0" />
                <div>
                  <div className="text-xs font-semibold text-violet-300 mb-0.5">Reconciliation Key Recommendation</div>
                  <div className="text-xs text-violet-200">{identityQ.data.summary.recommendation}</div>
                </div>
              </div>
            )}

            {/* Coverage matrix */}
            {identityQ.data?.summary && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {/* SIP Call-ID */}
                <div className="rounded-lg border border-slate-700/50 bg-slate-800/40 p-4 space-y-3">
                  <div className="text-xs font-semibold text-slate-300 flex items-center gap-2">
                    <Activity className="w-3.5 h-3.5 text-blue-400" /> SIP Call-ID Coverage
                  </div>
                  {[
                    { label: "Governed Call", count: identityQ.data.summary.callIdCoverage.governedCall },
                    { label: "Customer CDR (cdrCache)", count: identityQ.data.summary.callIdCoverage.customerCdr },
                    { label: "P&L (resolved)", count: identityQ.data.summary.callIdCoverage.pnl },
                  ].map(row => (
                    <div key={row.label} className="flex items-center justify-between">
                      <span className="text-xs text-slate-400">{row.label}</span>
                      <span className={cn("text-xs font-mono font-semibold",
                        row.count / Math.max(identityQ.data.summary.total, 1) > 0.8 ? "text-emerald-400" :
                        row.count > 0 ? "text-yellow-400" : "text-slate-600"
                      )}>
                        {row.count} / {identityQ.data.summary.total} ({pct(row.count, identityQ.data.summary.total)})
                      </span>
                    </div>
                  ))}
                </div>

                {/* CLD Coverage */}
                <div className="rounded-lg border border-slate-700/50 bg-slate-800/40 p-4 space-y-3">
                  <div className="text-xs font-semibold text-slate-300 flex items-center gap-2">
                    <FileSearch className="w-3.5 h-3.5 text-amber-400" /> Original CLD Coverage
                  </div>
                  {[
                    { label: "Customer CDR (suffix-10 match)", count: identityQ.data.summary.cldCoverage.customerCdr },
                  ].map(row => (
                    <div key={row.label} className="flex items-center justify-between">
                      <span className="text-xs text-slate-400">{row.label}</span>
                      <span className={cn("text-xs font-mono font-semibold",
                        row.count / Math.max(identityQ.data.summary.total, 1) > 0.8 ? "text-emerald-400" :
                        row.count > 0 ? "text-yellow-400" : "text-slate-600"
                      )}>
                        {row.count} / {identityQ.data.summary.total} ({pct(row.count, identityQ.data.summary.total)})
                      </span>
                    </div>
                  ))}
                  <div className="text-xs text-slate-500 pt-1">
                    Note: CLD match uses last-10-digit suffix — cross-product collisions possible (see roadmap).
                  </div>
                </div>

                {/* CLI Coverage */}
                <div className="rounded-lg border border-slate-700/50 bg-slate-800/40 p-4 space-y-3">
                  <div className="text-xs font-semibold text-slate-300 flex items-center gap-2">
                    <Shield className="w-3.5 h-3.5 text-emerald-400" /> CLI Coverage
                  </div>
                  {[
                    { label: "Customer CDR (exact CLI match)", count: identityQ.data.summary.cliCoverage.customerCdr },
                  ].map(row => (
                    <div key={row.label} className="flex items-center justify-between">
                      <span className="text-xs text-slate-400">{row.label}</span>
                      <span className={cn("text-xs font-mono font-semibold",
                        row.count / Math.max(identityQ.data.summary.total, 1) > 0.8 ? "text-emerald-400" :
                        row.count > 0 ? "text-yellow-400" : "text-slate-600"
                      )}>
                        {row.count} / {identityQ.data.summary.total} ({pct(row.count, identityQ.data.summary.total)})
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="relative w-80">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <Input
                placeholder="Search by call ID, CLI, CLD…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9 bg-slate-800/60 border-slate-700 text-sm"
                data-testid="input-identity-search"
              />
            </div>

            <div className="rounded-lg border border-slate-800 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-800/80 text-slate-400 text-xs">
                    <tr>
                      <th className="text-left px-3 py-2.5 font-medium">#</th>
                      <th className="text-left px-3 py-2.5 font-medium">CLI</th>
                      <th className="text-left px-3 py-2.5 font-medium">CLD</th>
                      <th className="text-left px-3 py-2.5 font-medium">Product</th>
                      <th className="text-left px-3 py-2.5 font-medium">SIP Call-ID</th>
                      <th className="text-center px-3 py-2.5 font-medium">GC has ID</th>
                      <th className="text-center px-3 py-2.5 font-medium">Cust CDR</th>
                      <th className="text-center px-3 py-2.5 font-medium">P&amp;L</th>
                      <th className="text-center px-3 py-2.5 font-medium">CLD match</th>
                      <th className="text-center px-3 py-2.5 font-medium">CLI match</th>
                      <th className="text-left px-3 py-2.5 font-medium">CDR Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {identityQ.isLoading && (
                      <tr><td colSpan={11} className="text-center text-slate-500 py-8">Loading…</td></tr>
                    )}
                    {!identityQ.isLoading && idCalls.length === 0 && (
                      <tr><td colSpan={11} className="text-center text-slate-500 py-8">No completed calls in last 7 days</td></tr>
                    )}
                    {idCalls.map((c: any) => (
                      <tr key={c.id} className="hover:bg-slate-800/30 transition-colors" data-testid={`row-identity-${c.id}`}>
                        <td className="px-3 py-2 font-mono text-xs text-slate-400">{c.id}</td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-300">{c.caller ?? "—"}</td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-300">{c.callee ?? "—"}</td>
                        <td className="px-3 py-2 text-xs">
                          <span className={cn("font-mono px-1.5 py-0.5 rounded text-xs",
                            c.productPrefix.startsWith("1") ? "bg-blue-500/15 text-blue-300" :
                            c.productPrefix.startsWith("2") ? "bg-cyan-500/15 text-cyan-300" :
                            c.productPrefix.startsWith("6") ? "bg-purple-500/15 text-purple-300" :
                            c.productPrefix.startsWith("7") ? "bg-amber-500/15 text-amber-300" :
                            "bg-slate-500/15 text-slate-400"
                          )}>
                            {c.productPrefix}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-500 max-w-40 truncate" title={c.vendorCallId ?? ""}>
                          {c.vendorCallId ? c.vendorCallId.slice(0, 20) + "…" : <span className="text-slate-700">none</span>}
                        </td>
                        <td className="px-3 py-2 text-center"><Check v={c.callIdInGovernedCall} /></td>
                        <td className="px-3 py-2 text-center"><Check v={c.callIdInCustomerCdr} /></td>
                        <td className="px-3 py-2 text-center"><Check v={c.callIdInPnl} /></td>
                        <td className="px-3 py-2 text-center"><Check v={c.cldInCustomerCdr} /></td>
                        <td className="px-3 py-2 text-center"><Check v={c.cliInCustomerCdr} /></td>
                        <td className="px-3 py-2">
                          {c.cdrStatus ? <MatchBadge status={c.cdrStatus === "ok" ? "matched" : c.cdrStatus === "no_cdr" ? "missing" : "partial"} /> : <span className="text-slate-600 text-xs">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {idCalls.length > 0 && (
              <p className="text-xs text-slate-500">
                Showing {idCalls.length} completed calls from last 7 days · Call-ID checked against live cdrCache · P&amp;L presence = cdr_status ok
              </p>
            )}

            {/* Frozen notice */}
            <div className="rounded-lg border border-slate-700/40 bg-slate-800/30 p-4 text-xs text-slate-400 space-y-1">
              <div className="font-semibold text-slate-300 mb-1">P2.5 Audit — Next Steps</div>
              <div>If <span className="text-blue-300">Call-ID spans Governed + Customer CDR (&gt;80%)</span> → adopt as master reconciliation key. CCI build scope shrinks significantly.</div>
              <div>If <span className="text-amber-300">Call-ID does not span reliably</span> → CCI (call_uuid + product_code + original_cld) must be built as new master key.</div>
              <div className="text-slate-500 pt-1">Phase 2 (Vendor Cost Validation) and Phase 3 (Commercial Identity Audit) are deferred until this matrix is stable.</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

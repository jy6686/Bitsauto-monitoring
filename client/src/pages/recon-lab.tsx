import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  FlaskConical, RefreshCw, CheckCircle2, XCircle,
  FileAudio, Database, Search, Shield, Download,
  Fingerprint, FileSearch, Activity, TrendingUp, Tag,
  AlertTriangle, Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

// ── Tab IDs ───────────────────────────────────────────────────────────────────
type TabId = "recording" | "cdr" | "identity" | "vendor" | "commercial";

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(n: number | null | undefined, decimals = 6) {
  if (n === null || n === undefined) return "—";
  return n.toFixed(decimals);
}
function fmtRate(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return n.toFixed(4);
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

// ── Status components ─────────────────────────────────────────────────────────
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

function ConfidenceBadge({ v }: { v: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    confirmed:           { label: "Confirmed",    cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
    resolved_no_prefix:  { label: "No Prefix",    cls: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30" },
    "no_p&l_match":      { label: "No P&L",       cls: "bg-red-500/15 text-red-400 border-red-500/30" },
    pending:             { label: "Pending",       cls: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
  };
  const m = map[v] ?? { label: v, cls: "bg-slate-500/15 text-slate-400" };
  return <span className={cn("text-xs px-2 py-0.5 rounded-full border font-mono", m.cls)}>{m.label}</span>;
}

function ProductBadge({ code, name }: { code: string | null; name: string | null }) {
  if (!code) return <span className="text-slate-600 text-xs">—</span>;
  const colorMap: Record<string, string> = {
    FC: "bg-blue-500/15 text-blue-300 border-blue-500/30",
    BC: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
    SB: "bg-purple-500/15 text-purple-300 border-purple-500/30",
    SC: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  };
  return (
    <span className={cn("text-xs px-2 py-0.5 rounded-full border font-mono", colorMap[code] ?? "bg-slate-500/15 text-slate-400")}>
      {code} · {name}
    </span>
  );
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

// ── Alert banner ──────────────────────────────────────────────────────────────
function AlertBanner({ icon: Icon, color, title, body }: {
  icon: any; color: string; title: string; body: string;
}) {
  return (
    <div className={cn("flex items-start gap-3 rounded-lg border px-4 py-3", color)}>
      <Icon className="w-4 h-4 mt-0.5 shrink-0" />
      <div>
        <div className="text-xs font-semibold mb-0.5">{title}</div>
        <div className="text-xs opacity-80">{body}</div>
      </div>
    </div>
  );
}

// ── Search box ────────────────────────────────────────────────────────────────
function SearchBox({ value, onChange, testId }: { value: string; onChange: (v: string) => void; testId: string }) {
  return (
    <div className="relative w-80">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
      <Input
        placeholder="Search by call ID, CLI, CLD…"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="pl-9 bg-slate-800/60 border-slate-700 text-sm"
        data-testid={testId}
      />
    </div>
  );
}

// ── Table shell ───────────────────────────────────────────────────────────────
function TableShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-800 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">{children}</table>
      </div>
    </div>
  );
}

function TH({ children, center }: { children: React.ReactNode; center?: boolean }) {
  return (
    <th className={cn("px-3 py-2.5 font-medium text-slate-400 text-xs", center ? "text-center" : "text-left")}>
      {children}
    </th>
  );
}

function TD({ children, mono, center, muted, clamp }: {
  children: React.ReactNode; mono?: boolean; center?: boolean; muted?: boolean; clamp?: boolean;
}) {
  return (
    <td className={cn(
      "px-3 py-2",
      mono && "font-mono",
      "text-xs",
      center && "text-center",
      muted ? "text-slate-400" : "text-slate-300",
      clamp && "max-w-40 truncate",
    )}>
      {children}
    </td>
  );
}

function EmptyRow({ cols, loading }: { cols: number; loading: boolean }) {
  return (
    <tr>
      <td colSpan={cols} className="text-center text-slate-500 py-8">
        {loading ? "Loading…" : "No data in window"}
      </td>
    </tr>
  );
}

// ── Filter helper ─────────────────────────────────────────────────────────────
function filterCalls(calls: any[], search: string) {
  if (!search) return calls;
  const s = search.toLowerCase();
  return calls.filter((c: any) =>
    String(c.id).includes(s) ||
    (c.caller ?? "").includes(s) ||
    (c.callee ?? "").includes(s) ||
    (c.cdrCallee ?? "").includes(s)
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
  const vendorQ = useQuery<any>({
    queryKey: ["/api/recon-lab/vendor-cost", days],
    queryFn: () => fetch(`/api/recon-lab/vendor-cost?days=${days}`).then(r => r.json()),
    staleTime: 60_000,
  });
  const commercialQ = useQuery<any>({
    queryKey: ["/api/recon-lab/commercial-identity", days],
    queryFn: () => fetch(`/api/recon-lab/commercial-identity?days=${days}`).then(r => r.json()),
    staleTime: 60_000,
  });

  const activeQ = { recording: recordingQ, cdr: cdrQ, identity: identityQ, vendor: vendorQ, commercial: commercialQ }[activeTab];

  function refresh() {
    recordingQ.refetch(); cdrQ.refetch(); identityQ.refetch(); vendorQ.refetch(); commercialQ.refetch();
    toast({ title: "Refreshed", description: "All Recon Lab data reloaded." });
  }

  // ── Filtered call lists ───────────────────────────────────────────────────
  const recCalls      = filterCalls(recordingQ.data?.calls ?? [], search);
  const cdrCalls      = filterCalls(cdrQ.data?.calls ?? [], search);
  const idCalls       = filterCalls(identityQ.data?.calls ?? [], search);
  const vendorCalls   = filterCalls(vendorQ.data?.calls ?? [], search);
  const commercialCalls = filterCalls(commercialQ.data?.calls ?? [], search);

  // ── Tab definitions ───────────────────────────────────────────────────────
  const tabs: { id: TabId; label: string; icon: any }[] = [
    { id: "recording",  label: "Recording Integrity",   icon: FileAudio   },
    { id: "cdr",        label: "CDR Reconciliation",    icon: Database    },
    { id: "identity",   label: "Identity Audit",        icon: Fingerprint },
    { id: "vendor",     label: "Vendor Cost Validation", icon: TrendingUp  },
    { id: "commercial", label: "Commercial Identity",   icon: Tag         },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-white">

      {/* ── Header ────────────────────────────────────────────────────────── */}
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
              <p className="text-xs text-slate-400">
                5-question diagnostic — recording · CDR · identity · vendor cost · commercial product
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={days}
              onChange={e => { setDays(Number(e.target.value)); setSearch(""); }}
              className="bg-slate-800 border border-slate-700 text-sm text-slate-300 rounded-md px-2 py-1.5"
              data-testid="select-days"
            >
              <option value={1}>Last 24 h</option>
              <option value={3}>Last 3 days</option>
              <option value={7}>Last 7 days</option>
              <option value={14}>Last 14 days</option>
              <option value={30}>Last 30 days</option>
            </select>
            <Button variant="outline" size="sm" onClick={refresh} disabled={activeQ.isFetching}
              className="border-slate-700 text-slate-300 hover:text-white" data-testid="btn-refresh">
              <RefreshCw className={cn("w-3.5 h-3.5 mr-1.5", activeQ.isFetching && "animate-spin")} />
              Refresh
            </Button>
          </div>
        </div>
      </div>

      {/* ── Tab bar ───────────────────────────────────────────────────────── */}
      <div className="border-b border-slate-800 bg-slate-900/30 px-6">
        <div className="max-w-screen-2xl mx-auto flex gap-0 overflow-x-auto">
          {tabs.map(t => (
            <button
              key={t.id}
              data-testid={`tab-${t.id}`}
              onClick={() => { setActiveTab(t.id); setSearch(""); }}
              className={cn(
                "flex items-center gap-2 px-4 py-3 text-sm border-b-2 transition-colors whitespace-nowrap shrink-0",
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

      {/* ── Content ───────────────────────────────────────────────────────── */}
      <div className="max-w-screen-2xl mx-auto px-6 py-6 space-y-5">

        {/* ════════════════════════════════════════════════════════════════════
            TAB 1 · Recording Integrity
        ════════════════════════════════════════════════════════════════════ */}
        {activeTab === "recording" && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
              <SummaryCard label="Completed Calls"   value={recordingQ.data?.summary?.total     ?? "…"} />
              <SummaryCard label="Has Path"          value={recordingQ.data?.summary?.hasPath   ?? "…"} color="text-blue-300" />
              <SummaryCard label="No Path"           value={recordingQ.data?.summary?.noPath    ?? "…"} color="text-slate-400" />
              <SummaryCard label="File OK"           value={recordingQ.data?.summary?.fileOk    ?? "…"} color="text-emerald-400" />
              <SummaryCard label="File Missing"      value={recordingQ.data?.summary?.fileMissing ?? "…"} color="text-red-400" />
              <SummaryCard label="Empty (0 B)"       value={recordingQ.data?.summary?.fileEmpty ?? "…"} color="text-orange-400" />
              <SummaryCard label="Success Rate"      value={`${recordingQ.data?.summary?.successPct ?? "…"}%`}
                color={(recordingQ.data?.summary?.successPct ?? 0) >= 90 ? "text-emerald-400" :
                       (recordingQ.data?.summary?.successPct ?? 0) >= 60 ? "text-yellow-400" : "text-red-400"} />
            </div>

            {(recordingQ.data?.summary?.fileMissing ?? 0) > 0 && (
              <AlertBanner icon={AlertTriangle} color="border-red-500/30 bg-red-500/10 text-red-300"
                title="Recording files missing on Asterisk"
                body={`${recordingQ.data.summary.fileMissing} recording(s) have a path recorded in the DB but the file does not exist on the Asterisk server. This is a live production defect — investigate before enabling billing verification.`} />
            )}

            <SearchBox value={search} onChange={setSearch} testId="input-recording-search" />

            <TableShell>
              <thead className="bg-slate-800/80">
                <tr>
                  <TH>#</TH><TH>CLI</TH><TH>CLD</TH><TH>Start (UTC)</TH>
                  <TH>Recording Path</TH><TH>Status</TH><TH>Size</TH><TH>Stream</TH>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {recordingQ.isLoading || recCalls.length === 0
                  ? <EmptyRow cols={8} loading={recordingQ.isLoading} />
                  : recCalls.map((c: any) => (
                    <tr key={c.id} className="hover:bg-slate-800/30" data-testid={`row-recording-${c.id}`}>
                      <TD mono muted>{c.id}</TD>
                      <TD mono>{c.caller ?? "—"}</TD>
                      <TD mono>{c.callee ?? "—"}</TD>
                      <TD muted>{fmtTime(c.startTime)}</TD>
                      <td className="px-3 py-2 font-mono text-xs text-slate-500 max-w-xs truncate" title={c.recordingPath ?? ""}>
                        {c.recordingPath ?? <span className="text-slate-700">none</span>}
                      </td>
                      <td className="px-3 py-2"><FileStatusBadge status={c.fileStatus} /></td>
                      <TD muted>{fmtBytes(c.fileSize)}</TD>
                      <td className="px-3 py-2">
                        {c.recordingPath
                          ? <a href={`/api/call-governance/recordings/stream?path=${encodeURIComponent(c.recordingPath)}`}
                              target="_blank" rel="noopener noreferrer"
                              className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                              data-testid={`link-stream-${c.id}`}>
                              <Download className="w-3 h-3" />Stream
                            </a>
                          : <span className="text-slate-600 text-xs">—</span>}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </TableShell>
            {recCalls.length > 0 && (
              <p className="text-xs text-slate-500">
                {recCalls.length} completed calls · SSH file-stat checks via SFTP for up to 100 recording paths
              </p>
            )}
          </>
        )}

        {/* ════════════════════════════════════════════════════════════════════
            TAB 2 · CDR Reconciliation
        ════════════════════════════════════════════════════════════════════ */}
        {activeTab === "cdr" && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
              <SummaryCard label="Total Calls"   value={cdrQ.data?.summary?.total       ?? "…"} />
              <SummaryCard label="Completed"     value={cdrQ.data?.summary?.completed   ?? "…"} color="text-blue-300" />
              <SummaryCard label="Matched"       value={cdrQ.data?.summary?.matched     ?? "…"} color="text-emerald-400" />
              <SummaryCard label="Missing"       value={cdrQ.data?.summary?.missing     ?? "…"} color="text-red-400" />
              <SummaryCard label="Partial"       value={cdrQ.data?.summary?.partial     ?? "…"} color="text-yellow-400" />
              <SummaryCard label="Pending"       value={cdrQ.data?.summary?.pending     ?? "…"} color="text-slate-400" />
              <SummaryCard label="Match Rate"    value={`${cdrQ.data?.summary?.matchRatePct ?? "…"}%`}
                color={(cdrQ.data?.summary?.matchRatePct ?? 0) >= 90 ? "text-emerald-400" :
                       (cdrQ.data?.summary?.matchRatePct ?? 0) >= 60 ? "text-yellow-400" : "text-red-400"} />
            </div>

            {(cdrQ.data?.summary?.matchRatePct ?? 0) < 90 && cdrQ.data?.summary?.completed > 0 && (
              <AlertBanner icon={AlertTriangle} color="border-yellow-500/30 bg-yellow-500/10 text-yellow-300"
                title="Match rate below 90% target"
                body={`Current match rate is ${cdrQ.data.summary.matchRatePct}%. Billing Verification should not be trusted until this reaches ≥90%.`} />
            )}

            <SearchBox value={search} onChange={setSearch} testId="input-cdr-search" />

            <TableShell>
              <thead className="bg-slate-800/80">
                <tr>
                  <TH>#</TH><TH>CLI</TH><TH>CLD</TH><TH>Start (UTC)</TH>
                  <TH>Match</TH><TH>Cust CDR</TH><TH>P&amp;L Cost</TH>
                  <TH>Vendor Cost</TH><TH>Vendor</TH><TH>Dur</TH><TH>Checked</TH>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {cdrQ.isLoading || cdrCalls.length === 0
                  ? <EmptyRow cols={11} loading={cdrQ.isLoading} />
                  : cdrCalls.map((c: any) => (
                    <tr key={c.id} className="hover:bg-slate-800/30" data-testid={`row-cdr-${c.id}`}>
                      <TD mono muted>{c.id}</TD>
                      <TD mono>{c.caller ?? "—"}</TD>
                      <TD mono>{c.callee ?? "—"}</TD>
                      <TD muted>{fmtTime(c.startTime)}</TD>
                      <td className="px-3 py-2"><MatchBadge status={c.matchStatus} /></td>
                      <td className="px-3 py-2">
                        {c.customerCdrFound
                          ? <span className="text-xs text-emerald-400 font-mono">Found</span>
                          : <span className="text-xs text-slate-600">—</span>}
                      </td>
                      <TD mono>{fmt(c.cdrCost)}</TD>
                      <TD mono>{fmt(c.cdrVendorCost)}</TD>
                      <td className="px-3 py-2 text-xs text-slate-400 max-w-32 truncate" title={c.cdrVendorName ?? ""}>{c.cdrVendorName ?? "—"}</td>
                      <TD muted>{c.cdrDuration != null ? `${c.cdrDuration}s` : "—"}</TD>
                      <TD muted>{fmtTime(c.cdrCheckedAt)}</TD>
                    </tr>
                  ))}
              </tbody>
            </TableShell>
            {cdrCalls.length > 0 && (
              <p className="text-xs text-slate-500">
                {cdrCalls.length} calls · Customer CDR checked against live cdrCache · P&amp;L from Track 2b
              </p>
            )}
          </>
        )}

        {/* ════════════════════════════════════════════════════════════════════
            TAB 3 · Identity Audit
        ════════════════════════════════════════════════════════════════════ */}
        {activeTab === "identity" && (
          <>
            {identityQ.data?.summary?.recommendation && (
              <AlertBanner icon={Fingerprint} color="border-violet-500/30 bg-violet-500/10 text-violet-200"
                title="Reconciliation Key Recommendation"
                body={identityQ.data.summary.recommendation} />
            )}

            {identityQ.data?.summary && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="rounded-lg border border-slate-700/50 bg-slate-800/40 p-4 space-y-3">
                  <div className="text-xs font-semibold text-slate-300 flex items-center gap-2">
                    <Activity className="w-3.5 h-3.5 text-blue-400" /> SIP Call-ID Coverage
                  </div>
                  {[
                    { label: "Governed Call",           count: identityQ.data.summary.callIdCoverage.governedCall },
                    { label: "Customer CDR (cdrCache)", count: identityQ.data.summary.callIdCoverage.customerCdr },
                    { label: "P&L (resolved)",          count: identityQ.data.summary.callIdCoverage.pnl },
                  ].map(row => (
                    <div key={row.label} className="flex items-center justify-between">
                      <span className="text-xs text-slate-400">{row.label}</span>
                      <span className={cn("text-xs font-mono font-semibold",
                        row.count / Math.max(identityQ.data.summary.total, 1) > 0.8 ? "text-emerald-400" :
                        row.count > 0 ? "text-yellow-400" : "text-slate-600"
                      )}>
                        {row.count}/{identityQ.data.summary.total} ({pct(row.count, identityQ.data.summary.total)})
                      </span>
                    </div>
                  ))}
                </div>
                <div className="rounded-lg border border-slate-700/50 bg-slate-800/40 p-4 space-y-3">
                  <div className="text-xs font-semibold text-slate-300 flex items-center gap-2">
                    <FileSearch className="w-3.5 h-3.5 text-amber-400" /> CLD Coverage (suffix-10)
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-400">Customer CDR</span>
                    <span className={cn("text-xs font-mono font-semibold",
                      identityQ.data.summary.cldCoverage.customerCdr / Math.max(identityQ.data.summary.total, 1) > 0.8
                        ? "text-emerald-400" : "text-yellow-400"
                    )}>
                      {identityQ.data.summary.cldCoverage.customerCdr}/{identityQ.data.summary.total}&nbsp;
                      ({pct(identityQ.data.summary.cldCoverage.customerCdr, identityQ.data.summary.total)})
                    </span>
                  </div>
                  <p className="text-xs text-slate-600">Suffix-10 match — cross-product collision risk exists</p>
                </div>
                <div className="rounded-lg border border-slate-700/50 bg-slate-800/40 p-4 space-y-3">
                  <div className="text-xs font-semibold text-slate-300 flex items-center gap-2">
                    <Shield className="w-3.5 h-3.5 text-emerald-400" /> CLI Coverage
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-400">Customer CDR (exact)</span>
                    <span className={cn("text-xs font-mono font-semibold",
                      identityQ.data.summary.cliCoverage.customerCdr / Math.max(identityQ.data.summary.total, 1) > 0.8
                        ? "text-emerald-400" : "text-yellow-400"
                    )}>
                      {identityQ.data.summary.cliCoverage.customerCdr}/{identityQ.data.summary.total}&nbsp;
                      ({pct(identityQ.data.summary.cliCoverage.customerCdr, identityQ.data.summary.total)})
                    </span>
                  </div>
                </div>
              </div>
            )}

            <SearchBox value={search} onChange={setSearch} testId="input-identity-search" />

            <TableShell>
              <thead className="bg-slate-800/80">
                <tr>
                  <TH>#</TH><TH>CLI</TH><TH>CLD</TH><TH>Product</TH><TH>SIP Call-ID</TH>
                  <TH center>GC ID</TH><TH center>Cust CDR</TH><TH center>P&amp;L</TH>
                  <TH center>CLD</TH><TH center>CLI</TH><TH>CDR</TH>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {identityQ.isLoading || idCalls.length === 0
                  ? <EmptyRow cols={11} loading={identityQ.isLoading} />
                  : idCalls.map((c: any) => (
                    <tr key={c.id} className="hover:bg-slate-800/30" data-testid={`row-identity-${c.id}`}>
                      <TD mono muted>{c.id}</TD>
                      <TD mono>{c.caller ?? "—"}</TD>
                      <TD mono>{c.callee ?? "—"}</TD>
                      <td className="px-3 py-2 text-xs">
                        <span className={cn("font-mono px-1.5 py-0.5 rounded text-xs",
                          c.productPrefix.startsWith("1") ? "bg-blue-500/15 text-blue-300" :
                          c.productPrefix.startsWith("2") ? "bg-cyan-500/15 text-cyan-300" :
                          c.productPrefix.startsWith("6") ? "bg-purple-500/15 text-purple-300" :
                          c.productPrefix.startsWith("7") ? "bg-amber-500/15 text-amber-300" :
                          "bg-slate-500/15 text-slate-400"
                        )}>{c.productPrefix}</span>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-500 max-w-40 truncate" title={c.vendorCallId ?? ""}>
                        {c.vendorCallId ? c.vendorCallId.slice(0, 22) + "…" : <span className="text-slate-700">none</span>}
                      </td>
                      <td className="px-3 py-2 text-center"><Check v={c.callIdInGovernedCall} /></td>
                      <td className="px-3 py-2 text-center"><Check v={c.callIdInCustomerCdr} /></td>
                      <td className="px-3 py-2 text-center"><Check v={c.callIdInPnl} /></td>
                      <td className="px-3 py-2 text-center"><Check v={c.cldInCustomerCdr} /></td>
                      <td className="px-3 py-2 text-center"><Check v={c.cliInCustomerCdr} /></td>
                      <td className="px-3 py-2">
                        {c.cdrStatus
                          ? <MatchBadge status={c.cdrStatus === "ok" ? "matched" : c.cdrStatus === "no_cdr" ? "missing" : "partial"} />
                          : <span className="text-slate-600 text-xs">—</span>}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </TableShell>

            <div className="rounded-lg border border-slate-700/40 bg-slate-800/30 p-4 text-xs text-slate-400 space-y-1">
              <div className="font-semibold text-slate-300 mb-1">Decision gate — when to proceed</div>
              <div>If <span className="text-blue-300">Call-ID spans Governed + Customer CDR (&gt;80%)</span> → use Call-ID as master reconciliation key. CCI build scope shrinks significantly.</div>
              <div>If <span className="text-amber-300">nothing spans all systems reliably</span> → CCI (call_uuid + product_code + original_cld) must be built before Billing Verification.</div>
            </div>
          </>
        )}

        {/* ════════════════════════════════════════════════════════════════════
            TAB 4 · Vendor Cost Validation
        ════════════════════════════════════════════════════════════════════ */}
        {activeTab === "vendor" && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
              <SummaryCard label="P&L Matched Calls"   value={vendorQ.data?.summary?.resolved      ?? "…"} />
              <SummaryCard label="With Vendor Cost"    value={vendorQ.data?.summary?.withVendorCost ?? "…"}
                color={vendorQ.data?.summary?.vendorCostPopulated ? "text-emerald-400" : "text-red-400"} />
              <SummaryCard label="Vendor Cost Gap"     value={vendorQ.data?.summary?.vendorCostGap  ?? "…"}
                color={(vendorQ.data?.summary?.vendorCostGap ?? 0) > 0 ? "text-orange-400" : "text-emerald-400"} />
              <SummaryCard label="Negative Margin"     value={vendorQ.data?.summary?.negativeMargin ?? "…"}
                color={(vendorQ.data?.summary?.negativeMargin ?? 0) > 0 ? "text-red-400" : "text-emerald-400"} />
              <SummaryCard label="Avg Margin %"
                value={vendorQ.data?.summary?.avgMarginPct != null ? `${vendorQ.data.summary.avgMarginPct}%` : "—"}
                color="text-blue-300" />
              <SummaryCard label="Vendor Cost Status"
                value={vendorQ.data?.summary?.vendorCostPopulated ? "Populated" : "Missing"}
                color={vendorQ.data?.summary?.vendorCostPopulated ? "text-emerald-400" : "text-red-400"} />
            </div>

            {!vendorQ.data?.summary?.vendorCostPopulated && vendorQ.data?.summary?.gapReason && (
              <AlertBanner icon={Info} color="border-orange-500/30 bg-orange-500/10 text-orange-200"
                title="Vendor cost not yet extracted"
                body={vendorQ.data.summary.gapReason} />
            )}

            {vendorQ.data?.summary?.vendorCostPopulated && (vendorQ.data?.summary?.negativeMargin ?? 0) > 0 && (
              <AlertBanner icon={AlertTriangle} color="border-red-500/30 bg-red-500/10 text-red-300"
                title={`${vendorQ.data.summary.negativeMargin} calls have negative margin`}
                body="Revenue is below vendor cost for these calls. Stop all margin-related work until this is resolved." />
            )}

            <SearchBox value={search} onChange={setSearch} testId="input-vendor-search" />

            <TableShell>
              <thead className="bg-slate-800/80">
                <tr>
                  <TH>#</TH><TH>CLI</TH><TH>P&amp;L CLD</TH><TH>Start (UTC)</TH>
                  <TH>P&amp;L Status</TH><TH>Revenue (USD)</TH><TH>Vendor Cost</TH>
                  <TH>Margin</TH><TH>Margin %</TH><TH>Eff. Rate/min</TH><TH>Dur</TH><TH>Vendor/Conn</TH>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {vendorQ.isLoading || vendorCalls.length === 0
                  ? <EmptyRow cols={12} loading={vendorQ.isLoading} />
                  : vendorCalls.map((c: any) => (
                    <tr key={c.id} className="hover:bg-slate-800/30" data-testid={`row-vendor-${c.id}`}>
                      <TD mono muted>{c.id}</TD>
                      <TD mono>{c.caller ?? "—"}</TD>
                      <TD mono>{c.cdrCallee ?? c.callee ?? "—"}</TD>
                      <TD muted>{fmtTime(c.startTime)}</TD>
                      <td className="px-3 py-2"><MatchBadge status={c.cdrStatus === "ok" ? "matched" : c.cdrStatus === "no_cdr" ? "missing" : "pending"} /></td>
                      <TD mono>{fmt(c.cdrCost)}</TD>
                      <td className="px-3 py-2">
                        {c.cdrVendorCost !== null
                          ? <span className="font-mono text-xs text-slate-300">{fmt(c.cdrVendorCost)}</span>
                          : <span className="text-xs text-slate-600 italic">not extracted</span>}
                      </td>
                      <td className="px-3 py-2">
                        {c.margin !== null
                          ? <span className={cn("font-mono text-xs", c.marginFlag === "negative" ? "text-red-400" : "text-emerald-400")}>
                              {c.margin >= 0 ? "+" : ""}{fmt(c.margin)}
                            </span>
                          : <span className="text-xs text-slate-600">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        {c.marginPct !== null
                          ? <span className={cn("font-mono text-xs", c.marginFlag === "negative" ? "text-red-400" : "text-emerald-400")}>
                              {c.marginPct.toFixed(1)}%
                            </span>
                          : <span className="text-xs text-slate-600">—</span>}
                      </td>
                      <TD mono>{fmtRate(c.effectiveRatePerMin)}</TD>
                      <TD muted>{c.cdrDuration != null ? `${c.cdrDuration}s` : "—"}</TD>
                      <td className="px-3 py-2 text-xs text-slate-500 max-w-36 truncate" title={c.cdrVendorName ?? ""}>{c.cdrVendorName ?? "—"}</td>
                    </tr>
                  ))}
              </tbody>
            </TableShell>

            <div className="rounded-lg border border-emerald-700/40 bg-emerald-900/20 p-4 text-xs text-slate-300 space-y-1">
              <div className="font-semibold text-emerald-300 mb-1">P3.1 Fix Applied ✓</div>
              <div>
                The P&amp;L scraper now correctly reads both columns:
                <span className="text-emerald-300 font-mono ml-1">Revenue, USD</span> → <code className="text-slate-300">cdrCost</code> (customer billing) and
                <span className="text-amber-300 font-mono ml-1">Cost, USD</span> → <code className="text-slate-300">cdrVendorCost</code> (vendor buying cost).
              </div>
              <div>All calls resolved <span className="font-semibold">from this point forward</span> will have both values populated and margin will compute correctly.</div>
              <div className="text-slate-500 pt-1">
                Historical calls (resolved before P3.1) have <code>cdrVendorCost = NULL</code> and their <code>cdrCost</code> contains the old Cost column value — they cannot be backfilled via the portal (beyond the 2-hour visibility window).
                Use the forced billing-backfill endpoint only for calls within the last 2 hours if you want to correct recent ones.
              </div>
            </div>
          </>
        )}

        {/* ════════════════════════════════════════════════════════════════════
            TAB 5 · Commercial Identity Audit
        ════════════════════════════════════════════════════════════════════ */}
        {activeTab === "commercial" && (
          <>
            {/* Product breakdown */}
            {commercialQ.data?.summary && (
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
                <SummaryCard label="Completed Calls" value={commercialQ.data.summary.total ?? "…"} />
                <SummaryCard label="Product Confirmed" value={commercialQ.data.summary.confirmed ?? "…"} color="text-emerald-400"
                  sub={`${pct(commercialQ.data.summary.confirmed, commercialQ.data.summary.total)} of completed`} />
                <SummaryCard label="Resolved, No Prefix" value={commercialQ.data.summary.resolvedNoPrefix ?? "…"} color="text-yellow-400" />
                <SummaryCard label="No P&L Match" value={commercialQ.data.summary.noPnlMatch ?? "…"} color="text-red-400" />
                <SummaryCard label="FC (First Class)"
                  value={commercialQ.data.summary.productBreakdown?.FC ?? 0} color="text-blue-300" />
                <SummaryCard label="BC (Business)"
                  value={commercialQ.data.summary.productBreakdown?.BC ?? 0} color="text-cyan-300" />
                <SummaryCard label="SC (Charlie)"
                  value={commercialQ.data.summary.productBreakdown?.SC ?? 0} color="text-amber-300" />
              </div>
            )}

            {/* Effective rate by product */}
            {commercialQ.data?.summary?.avgEffectiveRateByProduct &&
              Object.keys(commercialQ.data.summary.avgEffectiveRateByProduct).length > 0 && (
              <div className="rounded-lg border border-slate-700/50 bg-slate-800/40 p-4">
                <div className="text-xs font-semibold text-slate-300 mb-3">Average Effective Rate / min by Product</div>
                <div className="flex flex-wrap gap-4">
                  {Object.entries(commercialQ.data.summary.avgEffectiveRateByProduct).map(([code, rate]: any) => (
                    <div key={code} className="flex items-center gap-2">
                      <ProductBadge code={code} name={code} />
                      <span className="font-mono text-sm text-white">{fmtRate(rate)}</span>
                      <span className="text-xs text-slate-400">USD/min</span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-slate-500 mt-2">
                  Effective rate = P&L revenue ÷ duration in minutes · Requires cdrStatus = ok
                </p>
              </div>
            )}

            {(commercialQ.data?.summary?.noPnlMatch ?? 0) > 0 && (
              <AlertBanner icon={AlertTriangle} color="border-red-500/30 bg-red-500/10 text-red-300"
                title={`${commercialQ.data.summary.noPnlMatch} calls have no P&L match — product unknown`}
                body="These calls completed but were not found in the P&L report. Product prefix cannot be determined. Invoice automation must not proceed until this gap is closed." />
            )}

            {(commercialQ.data?.summary?.resolvedNoPrefix ?? 0) > 0 && (
              <AlertBanner icon={Info} color="border-yellow-500/30 bg-yellow-500/10 text-yellow-200"
                title={`${commercialQ.data.summary.resolvedNoPrefix} calls resolved in P&L but product prefix undetected`}
                body="P&L CLD (cdrCallee) does not start with a known trunk prefix (1/2/6/7). These calls may use a different billing schema or the CLD was modified in transit." />
            )}

            <SearchBox value={search} onChange={setSearch} testId="input-commercial-search" />

            <TableShell>
              <thead className="bg-slate-800/80">
                <tr>
                  <TH>#</TH><TH>CLI</TH><TH>Raw CLD</TH><TH>P&amp;L CLD</TH>
                  <TH>Prefix</TH><TH>Product</TH><TH>Confidence</TH>
                  <TH>Eff. Rate/min</TH><TH>P&amp;L Revenue</TH><TH>Dur</TH><TH>Min Margin</TH>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {commercialQ.isLoading || commercialCalls.length === 0
                  ? <EmptyRow cols={11} loading={commercialQ.isLoading} />
                  : commercialCalls.map((c: any) => (
                    <tr key={c.id} className="hover:bg-slate-800/30" data-testid={`row-commercial-${c.id}`}>
                      <TD mono muted>{c.id}</TD>
                      <TD mono>{c.caller ?? "—"}</TD>
                      <TD mono muted clamp>{c.callee ?? "—"}</TD>
                      <td className="px-3 py-2 font-mono text-xs text-slate-300 max-w-36 truncate" title={c.cdrCallee ?? ""}>
                        {c.cdrCallee ?? <span className="text-slate-600">—</span>}
                      </td>
                      <td className="px-3 py-2 text-xs font-mono">
                        {c.detectedPrefix
                          ? <span className="text-emerald-400">{c.detectedPrefix}</span>
                          : <span className="text-slate-600">?</span>}
                      </td>
                      <td className="px-3 py-2">
                        <ProductBadge code={c.productCode} name={c.productName} />
                      </td>
                      <td className="px-3 py-2">
                        <ConfidenceBadge v={c.confidence} />
                      </td>
                      <TD mono>{fmtRate(c.effectiveRatePerMin)}</TD>
                      <TD mono>{fmt(c.cdrCost)}</TD>
                      <TD muted>{c.cdrDuration != null ? `${c.cdrDuration}s` : "—"}</TD>
                      <TD muted>{c.minMarginPct != null ? `${c.minMarginPct}%` : "—"}</TD>
                    </tr>
                  ))}
              </tbody>
            </TableShell>

            <div className="rounded-lg border border-slate-700/40 bg-slate-800/30 p-4 text-xs text-slate-400 space-y-1">
              <div className="font-semibold text-slate-300 mb-1">Commercial Identity — Decision gates</div>
              <div>
                <span className="text-slate-300">Product Registry authority</span> — Invoice automation is blocked until every completed call in this tab has a <span className="text-emerald-300">Confirmed</span> confidence. No partial or unknown products.
              </div>
              <div>
                <span className="text-slate-300">Rate integrity</span> — Effective rate per product must be stable across calls of the same product. Cross-product rate bleed (e.g. SC call billed at FC rate) is a commercial risk.
              </div>
              <div>
                <span className="text-slate-300">Min margin floor</span> — Effective rate must exceed the product's min margin threshold at all times. Check column "Min Margin" vs "Eff. Rate/min".
              </div>
            </div>
          </>
        )}

      </div>
    </div>
  );
}

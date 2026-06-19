import { useState, useCallback } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  ShieldCheck, ShieldAlert, ShieldX,
  CheckCircle2, AlertTriangle, XCircle, MinusCircle,
  RefreshCw, Download, Phone,
  AlertOctagon, Lock, Mic, FileText, Scale, Clock, Activity,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────────

type CheckStatus = "ok" | "warn" | "fail" | "na";

interface ComplianceCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  category: string;
}

interface ComplianceMetrics {
  totalCalls24h: number;
  answeredCalls24h: number;
  asr24h: number;
  fas24h: number;
  fas7d: number;
  fasRate: number;
  fasTotal: number;
  activeBlacklist: number;
  totalBlacklist: number;
  blacklistHits: number;
  hasRecordingServer: boolean;
  recordingHttps: boolean;
  carrierAsr: number | null;
  carrierStability: number | null;
  carrierName: string | null;
  cdrCacheSize: number;
  sippyActive: boolean;
}

interface ComplianceReport {
  checkedAt: string;
  metrics: ComplianceMetrics;
  checks: ComplianceCheck[];
}

// ── Status config ──────────────────────────────────────────────────────────────

const STATUS_CFG: Record<CheckStatus, {
  icon: React.ReactNode; badge: string; label: string; row: string;
}> = {
  ok:   { icon: <CheckCircle2  className="h-4 w-4 text-green-400 shrink-0" />,           badge: "bg-green-500/15 text-green-400 border-green-500/30",  label: "OK",   row: "border-green-500/15  bg-green-500/3"  },
  warn: { icon: <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />,           badge: "bg-amber-500/15 text-amber-400 border-amber-500/30",  label: "Warn", row: "border-amber-500/15  bg-amber-500/3"  },
  fail: { icon: <XCircle       className="h-4 w-4 text-red-400   shrink-0" />,           badge: "bg-red-500/15   text-red-400   border-red-500/30",    label: "Fail", row: "border-red-500/15    bg-red-500/3"    },
  na:   { icon: <MinusCircle   className="h-4 w-4 text-muted-foreground shrink-0" />,   badge: "bg-muted/40 text-muted-foreground border-border",       label: "N/A",  row: "border-border/30"                      },
};

const CAT_ICONS: Record<string, React.ReactNode> = {
  "STIR/SHAKEN":    <ShieldCheck  className="h-4 w-4 text-violet-400"  />,
  "Call Recording": <Mic          className="h-4 w-4 text-blue-400"    />,
  "GDPR / Privacy": <Lock         className="h-4 w-4 text-emerald-400" />,
  "Regulatory":     <Scale        className="h-4 w-4 text-orange-400"  />,
};

// ── Overall status helper ─────────────────────────────────────────────────────

function overallStatus(checks: ComplianceCheck[]): "ok" | "warn" | "fail" {
  if (checks.some(c => c.status === "fail")) return "fail";
  if (checks.some(c => c.status === "warn")) return "warn";
  return "ok";
}

// ── Metric card ───────────────────────────────────────────────────────────────

function MetricCard({ label, value, sub, color, icon }: {
  label: string; value: string | number; sub?: string; color?: string; icon: React.ReactNode;
}) {
  return (
    <Card className="border-border/50">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground mb-1">{label}</p>
            <p className={cn("text-2xl font-bold tabular-nums", color ?? "text-foreground")}>{value}</p>
            {sub && <p className="text-[11px] text-muted-foreground/70 mt-0.5">{sub}</p>}
          </div>
          <div className="w-9 h-9 rounded-xl bg-muted/30 border border-border/50 flex items-center justify-center shrink-0 ml-3">
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Check row ─────────────────────────────────────────────────────────────────

function CheckRow({ check }: { check: ComplianceCheck }) {
  const cfg = STATUS_CFG[check.status];
  return (
    <div
      data-testid={`check-${check.id}`}
      className={cn("flex items-start gap-3 p-3 rounded-xl border transition-colors", cfg.row)}
    >
      <div className="mt-0.5">{cfg.icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium">{check.label}</span>
          <Badge className={cn("text-[10px] px-1.5 py-0 border shrink-0", cfg.badge)}>
            {cfg.label}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{check.detail}</p>
      </div>
    </div>
  );
}

// ── Category section ──────────────────────────────────────────────────────────

function CategorySection({ category, checks }: { category: string; checks: ComplianceCheck[] }) {
  const ok   = checks.filter(c => c.status === "ok").length;
  const warn = checks.filter(c => c.status === "warn").length;
  const fail = checks.filter(c => c.status === "fail").length;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {CAT_ICONS[category] ?? <FileText className="h-4 w-4 text-muted-foreground" />}
          <h3 className="text-sm font-semibold">{category}</h3>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          {ok   > 0 && <span className="text-green-400">{ok} ok</span>}
          {warn > 0 && <span className="text-amber-400">{warn} warn</span>}
          {fail > 0 && <span className="text-red-400">{fail} fail</span>}
        </div>
      </div>
      <div className="space-y-1.5">
        {checks.map(c => <CheckRow key={c.id} check={c} />)}
      </div>
    </div>
  );
}

// ── Status banner ─────────────────────────────────────────────────────────────

function StatusBanner({ report }: { report: ComplianceReport }) {
  const status = overallStatus(report.checks);
  const m = report.metrics;
  const ok   = report.checks.filter(c => c.status === "ok").length;
  const warn = report.checks.filter(c => c.status === "warn").length;
  const fail = report.checks.filter(c => c.status === "fail").length;

  const cfg = {
    ok:   { icon: <ShieldCheck className="h-8 w-8 text-green-400" />,  border: "border-green-500/25 bg-green-500/8",  text: "text-green-400",  title: "Compliant",     sub: "All critical checks passed"  },
    warn: { icon: <ShieldAlert className="h-8 w-8 text-amber-400" />,  border: "border-amber-500/25 bg-amber-500/8",  text: "text-amber-400",  title: "Attention",     sub: "Some checks need review"     },
    fail: { icon: <ShieldX     className="h-8 w-8 text-red-400"   />,  border: "border-red-500/25   bg-red-500/8",    text: "text-red-400",    title: "Non-compliant", sub: "Critical issues detected"    },
  }[status];

  return (
    <div
      data-testid="compliance-status-banner"
      className={cn("rounded-2xl border p-5 flex items-center gap-5 flex-wrap", cfg.border)}
    >
      {cfg.icon}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className={cn("text-xl font-bold", cfg.text)}>{cfg.title}</h2>
          <span className="text-sm text-muted-foreground">{cfg.sub}</span>
        </div>
        <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground flex-wrap">
          <span className="text-green-400 font-medium">{ok} passing</span>
          {warn > 0 && <span className="text-amber-400 font-medium">{warn} warnings</span>}
          {fail > 0 && <span className="text-red-400 font-medium">{fail} failing</span>}
          <span>·</span>
          <span>Switch {m.sippyActive ? "active" : "offline"} · CDR cache: {m.cdrCacheSize.toLocaleString()} records</span>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground/50 shrink-0">
        Checked {new Date(report.checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
      </p>
    </div>
  );
}

// ── Retention section ─────────────────────────────────────────────────────────

function RetentionSection({ m }: { m: ComplianceMetrics }) {
  const rows = [
    { label: "CDR Cache",       hours: 72,    note: `${m.cdrCacheSize.toLocaleString()} records`,         pct: 1,     color: "bg-blue-500"   },
    { label: "FAS Audit Trail", hours: 87600, note: `${m.fasTotal.toLocaleString()} events — permanent`,  pct: 100,   color: "bg-violet-500" },
    { label: "Blacklist Rules", hours: 87600, note: `${m.totalBlacklist} rules — permanent`,               pct: 100,   color: "bg-orange-500" },
  ];
  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          Data Retention
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {rows.map(r => (
          <div key={r.label} className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="font-medium">{r.label}</span>
              <span className="text-muted-foreground">{r.note}</span>
            </div>
            <div className="h-1.5 bg-muted/30 rounded-full overflow-hidden">
              <div className={cn("h-full rounded-full", r.color)} style={{ width: `${r.pct}%`, opacity: 0.8 }} />
            </div>
            <p className="text-[10px] text-muted-foreground/50">
              {r.hours < 1000 ? `${r.hours}h rolling` : "Permanent — never purged"}
            </p>
          </div>
        ))}
        <p className="text-[11px] text-muted-foreground/60 border-t border-border/40 pt-3">
          CDRs auto-purge after 72 h. FAS events and blacklist rules are permanently retained for regulatory audit.
        </p>
      </CardContent>
    </Card>
  );
}

// ── FAS activity card ─────────────────────────────────────────────────────────

function FasCard({ m }: { m: ComplianceMetrics }) {
  const risk      = m.fasRate < 1 ? "Low" : m.fasRate < 5 ? "Medium" : "High";
  const riskColor = m.fasRate < 1 ? "text-green-400" : m.fasRate < 5 ? "text-amber-400" : "text-red-400";
  const riskBg    = m.fasRate < 1 ? "bg-green-500/10 border-green-500/20" : m.fasRate < 5 ? "bg-amber-500/10 border-amber-500/20" : "bg-red-500/10 border-red-500/20";

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <AlertOctagon className="h-4 w-4 text-muted-foreground" />
          FAS / Fraud Activity
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className={cn("rounded-xl border p-3", riskBg)}>
          <p className={cn("text-lg font-bold", riskColor)}>{risk} Risk</p>
          <p className="text-xs text-muted-foreground">{m.fasRate.toFixed(2)}% flagged call rate (24h)</p>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "24h",  value: m.fas24h,  color: m.fas24h > 0 ? "text-amber-400" : "text-green-400" },
            { label: "7d",   value: m.fas7d,   color: "text-foreground" },
            { label: "Total",value: m.fasTotal, color: "text-foreground" },
          ].map(s => (
            <div key={s.label} className="rounded-lg border border-border/50 p-2 text-center">
              <p className={cn("text-xl font-bold tabular-nums", s.color)}>{s.value}</p>
              <p className="text-[10px] text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </div>

        <div className="rounded-lg border border-border/40 p-3 space-y-1.5 text-xs">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Active blacklist rules</span>
            <span className="font-medium">{m.activeBlacklist}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Total rules</span>
            <span className="font-medium">{m.totalBlacklist}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Lifetime hits</span>
            <span className="font-medium">{m.blacklistHits.toLocaleString()}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── CSV export ────────────────────────────────────────────────────────────────

function exportCsv(r: ComplianceReport) {
  const m = r.metrics;
  const lines = [
    "Bitsauto Compliance Report",
    `Generated:,${new Date(r.checkedAt).toLocaleString()}`,
    "",
    "METRICS",
    "Metric,Value",
    `Total Calls (24h),${m.totalCalls24h}`,
    `Answered Calls (24h),${m.answeredCalls24h}`,
    `ASR (24h),${m.asr24h}%`,
    `FAS Events (24h),${m.fas24h}`,
    `FAS Events (7d),${m.fas7d}`,
    `FAS Events Total,${m.fasTotal}`,
    `Flagged Rate (24h),${m.fasRate}%`,
    `Active Blacklist Rules,${m.activeBlacklist}`,
    `Total Blacklist Rules,${m.totalBlacklist}`,
    `Blacklist Hits (lifetime),${m.blacklistHits}`,
    `Recording Server,${m.hasRecordingServer ? "Configured" : "Not configured"}`,
    `Recording HTTPS,${m.recordingHttps ? "Yes" : "No"}`,
    `Carrier Name,${m.carrierName ?? "—"}`,
    `Carrier ASR,${m.carrierAsr != null ? m.carrierAsr.toFixed(1) + "%" : "—"}`,
    `Carrier Stability,${m.carrierStability != null ? m.carrierStability + "/100" : "—"}`,
    `CDR Cache Size,${m.cdrCacheSize}`,
    "",
    "COMPLIANCE CHECKS",
    "Category,Check,Status,Detail",
    ...r.checks.map(c => `"${c.category}","${c.label}","${c.status.toUpperCase()}","${c.detail.replace(/"/g, '""')}"`),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url;
  a.download = `compliance-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CompliancePage() {
  const [exporting, setExporting] = useState(false);

  const { data: report, isLoading, refetch, isFetching } = useQuery<ComplianceReport>({
    queryKey: ["/api/compliance/report"],
    queryFn: () => fetch("/api/compliance/report").then(r => r.json()),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const handleExport = useCallback(() => {
    if (!report) return;
    setExporting(true);
    try { exportCsv(report); } finally { setTimeout(() => setExporting(false), 800); }
  }, [report]);

  const categories = report
    ? Array.from(new Set(report.checks.map(c => c.category))).map(cat => ({
        name: cat,
        checks: report.checks.filter(c => c.category === cat),
      }))
    : [];

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2.5">
            <ShieldCheck className="h-6 w-6 text-emerald-400" />
            Compliance Dashboard
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            STIR/SHAKEN · Call Recording · GDPR · Regulatory — live computed from your switch data
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline" size="sm"
            onClick={() => refetch()} disabled={isFetching}
            data-testid="btn-refresh-compliance"
            className="gap-1.5"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
            Refresh
          </Button>
          <Button
            variant="outline" size="sm"
            onClick={handleExport} disabled={!report || exporting}
            data-testid="btn-export-compliance"
            className="gap-1.5"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Loading skeleton */}
      {isLoading && (
        <div className="space-y-4">
          <div className="h-24 rounded-2xl border border-border/50 bg-muted/10 animate-pulse" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[1,2,3,4].map(i => <div key={i} className="h-24 rounded-xl border border-border/50 bg-muted/10 animate-pulse" />)}
          </div>
          <div className="h-96 rounded-xl border border-border/50 bg-muted/10 animate-pulse" />
        </div>
      )}

      {/* Error */}
      {!isLoading && !report && (
        <div className="rounded-xl border border-border/50 p-12 text-center">
          <ShieldAlert className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-muted-foreground">Unable to load compliance data</p>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="mt-3">Retry</Button>
        </div>
      )}

      {/* Main content */}
      {report && (
        <>
          <StatusBanner report={report} />

          {/* Metric cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MetricCard
              label="Calls (24h)"
              value={report.metrics.totalCalls24h.toLocaleString()}
              sub={`ASR ${report.metrics.asr24h}% · ${report.metrics.answeredCalls24h} answered`}
              icon={<Phone className="h-4 w-4 text-blue-400" />}
            />
            <MetricCard
              label="FAS Events (24h)"
              value={report.metrics.fas24h}
              sub={`${report.metrics.fasRate.toFixed(2)}% flagged rate`}
              color={report.metrics.fas24h > 0 ? "text-amber-400" : "text-green-400"}
              icon={<AlertTriangle className="h-4 w-4 text-amber-400" />}
            />
            <MetricCard
              label="Blacklist Rules"
              value={report.metrics.activeBlacklist}
              sub={`${report.metrics.totalBlacklist} total · ${report.metrics.blacklistHits} hits`}
              icon={<ShieldX className="h-4 w-4 text-red-400" />}
            />
            <MetricCard
              label="Recording Server"
              value={report.metrics.hasRecordingServer ? "Active" : "Not Set"}
              sub={report.metrics.hasRecordingServer
                ? (report.metrics.recordingHttps ? "HTTPS encrypted" : "HTTP — unencrypted")
                : <Link to="/settings?tab=monitoring" className="text-primary hover:underline">Configure in Settings →</Link>}
              color={report.metrics.hasRecordingServer
                ? (report.metrics.recordingHttps ? "text-green-400" : "text-amber-400")
                : "text-muted-foreground"}
              icon={<Mic className="h-4 w-4 text-blue-400" />}
            />
          </div>

          {/* Carrier quality strip */}
          {report.metrics.carrierName && (
            <div className="rounded-xl border border-border/50 bg-muted/10 p-4 flex items-center gap-5 flex-wrap text-sm">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-violet-400" />
                <span className="font-medium">{report.metrics.carrierName}</span>
                <Badge className="bg-violet-500/10 text-violet-400 border-violet-500/20 text-[10px]">Primary Carrier</Badge>
              </div>
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                {report.metrics.carrierAsr != null && (
                  <span>ASR <span className="font-semibold text-foreground">{report.metrics.carrierAsr.toFixed(1)}%</span></span>
                )}
                {report.metrics.carrierStability != null && (
                  <span>Stability <span className="font-semibold text-foreground">{report.metrics.carrierStability}/100</span></span>
                )}
              </div>
              <span className="ml-auto text-[11px] text-muted-foreground/50">Carrier quality from scoring engine</span>
            </div>
          )}

          {/* Checks + sidebar */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              {categories.map(cat => (
                <CategorySection key={cat.name} category={cat.name} checks={cat.checks} />
              ))}
            </div>

            <div className="space-y-4">
              <FasCard m={report.metrics} />
              <RetentionSection m={report.metrics} />
              <Card className="border-border/50">
                <CardContent className="p-4">
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    All metrics are computed live from your CDR cache, FAS audit trail, blacklist rules,
                    carrier quality scores and switch settings. Refreshes every 60 seconds.
                    Export the full report as CSV for regulatory submissions or internal audits.
                  </p>
                  <p className="text-[11px] text-muted-foreground/50 mt-2">
                    Last checked: {new Date(report.checkedAt).toLocaleString()}
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

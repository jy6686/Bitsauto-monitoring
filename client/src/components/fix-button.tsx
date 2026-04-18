import { useState, useCallback, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Wrench, X, CheckCircle2, AlertTriangle, XCircle, Loader2, ChevronRight, RefreshCw, Database, Wifi, HardDrive, Shield, Zap, AlertCircle, Clock, History, Cpu, CheckCheck, Terminal, Camera, Expand, Copy, CopyCheck, Bot } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";

// ── Page name map ────────────────────────────────────────────────────────────
const PAGE_NAMES: Record<string, string> = {
  "/":                   "Dashboard",
  "/calls":              "Live Calls",
  "/cdrs":               "CDR Viewer",
  "/analytics":          "Analytics",
  "/fraud":              "Fraud Detection",
  "/reports":            "Reports",
  "/billing":            "Billing",
  "/rate-cards":         "Rate Cards",
  "/lcr":                "LCR Analyser",
  "/products":           "Product Classification",
  "/bitseye":            "BitsEye",
  "/team":               "Team Management",
  "/settings":           "Settings",
  "/server-monitoring":  "Server Monitoring",
  "/multi-switch":       "Multi-Switch View",
  "/p-and-l":            "P&L Report",
  "/click-to-call":      "Click-to-Call",
};

function getPageName(path: string): string {
  const base = path.split("?")[0].split("#")[0];
  for (const [prefix, label] of Object.entries(PAGE_NAMES)) {
    if (base === prefix || (prefix !== "/" && base.startsWith(prefix))) return label;
  }
  return base.replace(/^\//, "").replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()) || "Unknown Page";
}

// ── Types ────────────────────────────────────────────────────────────────────
type CheckStatus = "ok" | "warn" | "fail" | "skip";
type IssueSeverity = "critical" | "warning" | "info";
type Tab = "diagnose" | "history" | "rules";

interface PastFix {
  action: string;
  outcome: string;
  performedBy: string | null;
  createdAt: string;
}

interface DiagCheck {
  id: string;
  name: string;
  status: CheckStatus;
  detail: string;
  durationMs: number;
}
interface DiagIssue {
  type: string;
  severity: IssueSeverity;
  component: string;
  message: string;
  suggestion: string;
  autoFix: string | null;
  pastFix?: PastFix | null;
}
interface DiagResult {
  status: "ok" | "warning" | "critical";
  checks: DiagCheck[];
  issues: DiagIssue[];
  summary: { total: number; passed: number; warnings: number; failed: number; skipped: number };
  cdrCacheSize: number;
  cdrCacheAgeMs: number | null;
  autoRecovery: { consecutiveFailures: number; lastAutoFixAt: string | null; totalAutoFixes: number };
  diagnosedAt: string;
  durationMs: number;
}
interface FixResult {
  ok: boolean;
  message: string;
  durationMs: number;
}
interface HistoryRow {
  id: number;
  page: string | null;
  issueType: string;
  component: string | null;
  fixAction: string | null;
  outcome: string;
  outcomeMessage: string | null;
  triggeredBy: string;
  performedBy: string | null;
  hasScreenshot?: boolean;
  createdAt: string;
}
interface AutoRule {
  id: string;
  name: string;
  trigger: string;
  enabled: boolean;
  description: string;
}

// ── Step definitions ─────────────────────────────────────────────────────────
const STEPS = [
  { id: 1, label: "Detect Context",    icon: Zap },
  { id: 2, label: "Collect Logs",      icon: Database },
  { id: 3, label: "Check API",         icon: Wifi },
  { id: 4, label: "Classify Issue",    icon: AlertCircle },
  { id: 5, label: "Run Auto Fixes",    icon: RefreshCw },
  { id: 6, label: "Re-check Status",   icon: CheckCircle2 },
  { id: 7, label: "AI Analysis",       icon: Shield },
  { id: 8, label: "Admin Review",      icon: HardDrive },
  { id: 9, label: "Apply Fix",         icon: Wrench },
  { id: 10, label: "Final Validation", icon: Clock },
];

// ── Small helpers ────────────────────────────────────────────────────────────
function statusIcon(s: CheckStatus, cls = "h-4 w-4") {
  if (s === "ok")   return <CheckCircle2 className={cn(cls, "text-emerald-400")} />;
  if (s === "warn") return <AlertTriangle className={cn(cls, "text-amber-400")} />;
  if (s === "fail") return <XCircle className={cn(cls, "text-red-400")} />;
  return <ChevronRight className={cn(cls, "text-muted-foreground/40")} />;
}
function severityBadge(s: IssueSeverity) {
  if (s === "critical") return <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-4">Critical</Badge>;
  if (s === "warning")  return <Badge className="text-[10px] px-1.5 py-0 h-4 bg-amber-500/20 text-amber-300 border-amber-500/30 hover:bg-amber-500/30">Warning</Badge>;
  return <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">Info</Badge>;
}
function issueTypeBadge(t: string) {
  const COLORS: Record<string, string> = {
    API_FAILURE:   "bg-red-500/15 text-red-300 border-red-500/30",
    AUTH_ERROR:    "bg-orange-500/15 text-orange-300 border-orange-500/30",
    TIMEOUT:       "bg-amber-500/15 text-amber-300 border-amber-500/30",
    NO_DATA:       "bg-blue-500/15 text-blue-300 border-blue-500/30",
    DATA_MISMATCH: "bg-purple-500/15 text-purple-300 border-purple-500/30",
    BACKEND_ERROR: "bg-red-500/15 text-red-300 border-red-500/30",
    UI_ERROR:      "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
    UNKNOWN:       "bg-muted/30 text-muted-foreground border-border/40",
  };
  return (
    <span className={cn("text-[10px] font-mono px-1.5 py-0.5 rounded border", COLORS[t] ?? COLORS.UNKNOWN)}>
      {t}
    </span>
  );
}
function outcomeColor(o: string) {
  if (o === "success") return "text-emerald-400";
  if (o === "failure") return "text-red-400";
  if (o === "auto")    return "text-violet-400";
  return "text-muted-foreground/60";
}
function outcomeIcon(o: string) {
  if (o === "success") return <CheckCheck className="h-3 w-3 text-emerald-400" />;
  if (o === "failure") return <XCircle className="h-3 w-3 text-red-400" />;
  if (o === "auto")    return <Cpu className="h-3 w-3 text-violet-400" />;
  return <Clock className="h-3 w-3 text-muted-foreground/40" />;
}

// ── AI-rule engine ───────────────────────────────────────────────────────────
function buildAiSuggestion(issues: DiagIssue[]): string | null {
  if (issues.length === 0) return null;
  const primary = issues.find(i => i.severity === "critical") ?? issues[0];
  const suggestions: Record<string, string> = {
    API_FAILURE:   "Root cause is likely a Sippy XML-RPC connectivity failure. Confirm the Sippy server IP/hostname in Settings matches the actual server. Check that port 9900 (or your configured XML-RPC port) is open in the firewall. If using HTTPS, verify the certificate is valid. Run 'Retry Sippy API' to re-establish the session without restarting the full server.",
    AUTH_ERROR:    "Root cause is credential rejection. Sippy admin accounts require the 'admin' flag set in Sippy's administration panel. Verify the username/password are correct for this exact Sippy build. Note: Sippy Python 2 softswitch is case-sensitive for credentials. Re-enter them in Settings → General Settings.",
    TIMEOUT:       "Root cause is a network-level timeout before Sippy responds. This usually indicates: (1) the Sippy server is overloaded, (2) a firewall is silently dropping packets, or (3) the XML-RPC port is blocked. Check server load on the Sippy host. Try increasing the timeout in Settings or whitelist the app server IP in Sippy's firewall.",
    NO_DATA:       "Root cause is the CDR background job has not yet run or cannot retrieve CDRs. This may be caused by a Sippy account with insufficient CDR read permissions, or a date range filter returning no results. Check that the Sippy admin account has the 'showcdrs' permission flag enabled. The CDR job runs every 3 minutes automatically.",
    DATA_MISMATCH: "Root cause is the CDR cache has gone stale — the background job is failing silently. Check server logs for '[cdr-cache] ERROR' lines. A common cause is the Sippy CDR API returning an XML parse error due to malformed CDR data. Identify the specific CDR causing the parse failure and exclude it by adjusting the date range.",
    BACKEND_ERROR: "Root cause is a PostgreSQL connectivity failure. Verify DATABASE_URL is correctly set in the environment secrets. Check that the PostgreSQL service is running and accepting connections. If this is intermittent, it may be a connection pool exhaustion issue — restart the application server.",
  };
  return suggestions[primary.type] ?? primary.suggestion;
}

// ── Fix button action labels ─────────────────────────────────────────────────
const FIX_ACTION_LABELS: Record<string, string> = {
  retry_sippy:      "Retry Sippy API",
  warm_cdr_cache:   "Warm CDR Cache",
  check_db:         "Test DB Connection",
  refresh_accounts: "Refresh Accounts",
  refresh_vendors:  "Refresh Vendors",
};

// ── Build a structured AI-ready fix report ───────────────────────────────────
function buildFixReport(
  pageName: string,
  url: string,
  diag: DiagResult,
  frontendErrors: string[],
  hasScreenshot: boolean,
  fixResults: Record<string, FixResult>,
): string {
  const ts = new Date().toLocaleString();
  const status = diag.status.toUpperCase();
  const issueLines = diag.issues.map((iss, i) =>
    `  ${i + 1}. [${iss.type}] ${iss.description} — severity: ${iss.severity}${iss.suggestedFix ? `\n     Suggested fix: ${iss.suggestedFix}` : ""}`
  ).join("\n");

  const checkLines = diag.checks.map(c =>
    `  ${c.status === "ok" ? "✓" : c.status === "warn" ? "⚠" : c.status === "skip" ? "–" : "✗"} ${c.name}${c.detail ? ": " + c.detail : ""}`
  ).join("\n");

  const fixResultLines = Object.entries(fixResults).map(([action, r]) =>
    `  ${r.ok ? "✓" : "✗"} ${action}: ${r.message}`
  ).join("\n");

  const appliedFixes = Object.keys(fixResults).length;
  const resolvedFixes = Object.values(fixResults).filter(r => r.ok).length;

  let report = `🔧 Fix Report — ${pageName}
${"─".repeat(50)}
Page:    ${pageName}
URL:     ${url}
Time:    ${ts}
Status:  ${status}  (${diag.issues.length} issue${diag.issues.length !== 1 ? "s" : ""} detected)

`;

  if (diag.issues.length > 0) {
    report += `ISSUES DETECTED:\n${issueLines}\n\n`;
  } else {
    report += `No issues detected by automated checks.\n\n`;
  }

  report += `SYSTEM CHECKS:\n${checkLines || "  No checks recorded"}\n\n`;

  report += `SYSTEM METRICS:\n`;
  report += `  Active Calls:       ${diag.activeCalls ?? "unknown"}\n`;
  report += `  CDR Cache:          ${diag.cdrCacheSize?.toLocaleString() ?? "?"} records`;
  if (diag.cdrCacheAgeMs !== null && diag.cdrCacheAgeMs !== undefined) {
    report += ` (${Math.round(diag.cdrCacheAgeMs / 1000)}s old)`;
  }
  report += `\n`;
  report += `  JS Errors Captured: ${frontendErrors.length}\n`;
  report += `  Auto Fixes Run:     ${diag.autoRecovery?.totalAutoFixes ?? 0}\n`;
  report += `  Sippy Failures:     ${diag.autoRecovery?.consecutiveFailures ?? 0} consecutive\n`;
  report += `  Screenshot:         ${hasScreenshot ? "Captured ✓" : "Not captured"}\n\n`;

  if (frontendErrors.length > 0) {
    report += `BROWSER ERRORS:\n${frontendErrors.slice(0, 5).map(e => `  • ${e}`).join("\n")}\n\n`;
  }

  if (appliedFixes > 0) {
    report += `AUTO-FIX ATTEMPTS (${resolvedFixes}/${appliedFixes} resolved):\n${fixResultLines}\n\n`;
  }

  if (diag.module) {
    report += `MODULE: ${diag.module}\n\n`;
  }

  if (diag.issues.length > 0 && resolvedFixes < diag.issues.length) {
    report += `${"─".repeat(50)}
⚠ Issues remain after automated fix attempts.
Please analyze the ${pageName} page/module and fix the root cause.
Focus on: ${diag.issues.filter(i => i.severity === "critical").map(i => i.type).join(", ") || diag.issues[0]?.type || "the issues listed above"}.
`;
  }

  return report;
}

// ── Main component ───────────────────────────────────────────────────────────
export function FixButton() {
  const { user } = useAuth();
  const role = (user as any)?.role as string | undefined;
  const [open, setOpen]       = useState(false);
  const [tab, setTab]         = useState<Tab>("diagnose");
  const [activeStep, setActiveStep] = useState(0);
  const [appliedActions, setAppliedActions] = useState<Set<string>>(new Set());
  const [fixResults, setFixResults]         = useState<Record<string, FixResult>>({});
  const [screenshotLoading, setScreenshotLoading] = useState(false);
  const [screenshotExpanded, setScreenshotExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [location] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const pageName = getPageName(location);

  // Stores the base64 JPEG captured when Fix button is clicked (before modal opens)
  const screenshotRef = useRef<string | null>(null);

  // ── Frontend error capture (Step 2: Collect Logs) ───────────────────────
  const frontendErrorsRef = useRef<string[]>([]);
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      const msg = `[JS] ${e.message} @ ${e.filename?.split("/").pop() ?? "?"}:${e.lineno}`;
      frontendErrorsRef.current = [msg, ...frontendErrorsRef.current].slice(0, 20);
    };
    const onUnhandled = (e: PromiseRejectionEvent) => {
      const msg = `[Promise] ${e.reason}`;
      frontendErrorsRef.current = [msg, ...frontendErrorsRef.current].slice(0, 20);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandled);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandled);
    };
  }, []);

  if (!role || role === "viewer") return null;

  const moduleParam  = encodeURIComponent(pageName);
  const diagnoseBase = `/api/fix/diagnose?module=${moduleParam}`;

  // ── Diagnose query (module-aware, errors injected at fetch time) ─────────
  const {
    data: diag,
    isLoading,
    refetch,
    isFetching,
  } = useQuery<DiagResult>({
    queryKey: [diagnoseBase],
    enabled: open && tab === "diagnose",
    staleTime: 0,
    refetchOnMount: true,
    queryFn: async () => {
      const errs = frontendErrorsRef.current.slice(0, 10);
      const url  = errs.length
        ? `${diagnoseBase}&errors=${encodeURIComponent(JSON.stringify(errs))}`
        : diagnoseBase;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json() as Promise<DiagResult>;
    },
  });

  // ── History query ────────────────────────────────────────────────────────
  const {
    data: historyData,
    isLoading: histLoading,
    refetch: refetchHistory,
  } = useQuery<{ history: HistoryRow[]; total: number }>({
    queryKey: ["/api/fix/history"],
    enabled: open && tab === "history",
    staleTime: 30 * 1000,
  });

  // ── Auto-rules query ─────────────────────────────────────────────────────
  const {
    data: rulesData,
  } = useQuery<{ rules: AutoRule[]; consecutiveSippyFailures: number; totalAutoFixes: number; lastEvent: string | null }>({
    queryKey: ["/api/fix/auto-rules"],
    enabled: open && tab === "rules",
    staleTime: 10 * 1000,
  });

  // ── Fix mutation ─────────────────────────────────────────────────────────
  const fixMutation = useMutation({
    mutationFn: async ({ action, issueType, component }: { action: string; issueType?: string; component?: string }) => {
      const res = await apiRequest("POST", "/api/fix/attempt", {
        action, page: pageName, issueType, component,
        screenshot: screenshotRef.current ?? undefined,
      });
      return res.json() as Promise<FixResult>;
    },
    onSuccess: (data, vars) => {
      setFixResults(prev => ({ ...prev, [vars.action]: data }));
      setAppliedActions(prev => new Set(Array.from(prev).concat(vars.action)));
      if (data.ok) {
        toast({ title: "Fix applied", description: data.message });
        queryClient.invalidateQueries({ queryKey: [diagnoseBase] });
        queryClient.invalidateQueries({ queryKey: ["/api/fix/history"] });
        queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
        queryClient.invalidateQueries({ queryKey: ["/api/cdrs"] });
      } else {
        toast({ title: "Fix failed", description: data.message, variant: "destructive" });
      }
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleOpen = useCallback(async () => {
    // Capture page screenshot BEFORE opening modal (captures the broken/current UI state)
    screenshotRef.current = null;
    setScreenshotLoading(true);
    setScreenshotExpanded(false);
    setOpen(true);
    setTab("diagnose");
    setActiveStep(1);
    setAppliedActions(new Set());
    setFixResults({});
    // Non-blocking screenshot capture after modal opens
    try {
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(document.body, {
        scale: 0.35,
        useCORS: false,
        allowTaint: true,
        logging: false,
        backgroundColor: "#000",
        ignoreElements: (el) => el.getAttribute("data-testid") === "dialog-fix-modal",
      });
      screenshotRef.current = canvas.toDataURL("image/jpeg", 0.55);
    } catch {
      screenshotRef.current = null;
    } finally {
      setScreenshotLoading(false);
    }
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
    setActiveStep(0);
  }, []);

  const runDiagnosis = useCallback(() => {
    setAppliedActions(new Set());
    setFixResults({});
    setActiveStep(1);
    refetch().then(() => setActiveStep(4));
  }, [refetch]);

  const currentStep = isLoading || isFetching ? 2 : !diag ? 0 : diag.issues.length ? 4 : 6;
  const aiSuggestion = diag ? buildAiSuggestion(diag.issues) : null;
  const overallOk = diag?.status === "ok";

  const dotColor = overallOk
    ? "bg-emerald-500"
    : diag?.status === "warning" ? "bg-amber-500"
    : diag?.status === "critical" ? "bg-red-500"
    : "bg-muted-foreground/30";

  return (
    <>
      {/* ── Floating Fix Button ── */}
      <button
        onClick={handleOpen}
        data-testid="button-global-fix"
        className={cn(
          "fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-2.5 rounded-full shadow-lg",
          "bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95",
          "transition-all duration-150 font-medium text-sm border border-primary/20"
        )}
        title="Global Fix — Diagnose &amp; Repair"
      >
        <Wrench className="h-4 w-4 flex-shrink-0" />
        <span>Fix</span>
        {diag && !overallOk && (
          <span className={cn("h-2 w-2 rounded-full flex-shrink-0", dotColor)} />
        )}
      </button>

      {/* ── Fix Modal ── */}
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent
          className="max-w-2xl w-full max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden"
          data-testid="dialog-fix-modal"
        >
          {/* Header */}
          <DialogHeader className="px-6 pt-5 pb-4 border-b border-border/50 flex-shrink-0">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Wrench className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <DialogTitle className="text-base font-semibold">Global Fix System</DialogTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Page: <span className="font-medium text-foreground">{pageName}</span>
                  {" · "}Role: <span className="font-medium text-foreground capitalize">{role}</span>
                  {diag?.autoRecovery && diag.autoRecovery.totalAutoFixes > 0 && (
                    <> · <span className="text-violet-400">{diag.autoRecovery.totalAutoFixes} auto-fix(es)</span></>
                  )}
                </p>
              </div>
              {diag && (
                <Badge
                  data-testid="badge-fix-status"
                  className={cn(
                    "text-xs px-2.5 py-1 capitalize border",
                    overallOk
                      ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                      : diag.status === "warning"
                      ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
                      : "bg-red-500/15 text-red-300 border-red-500/30"
                  )}
                >
                  {overallOk ? "All Systems OK" : diag.status === "warning" ? "Warning" : "Issues Detected"}
                </Badge>
              )}
            </div>
          </DialogHeader>

          {/* Tab bar */}
          <div className="flex items-center gap-0.5 px-6 pt-3 pb-0 border-b border-border/30 flex-shrink-0">
            {(["diagnose", "history", "rules"] as Tab[]).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                data-testid={`tab-fix-${t}`}
                className={cn(
                  "px-3 py-2 text-xs font-medium rounded-t-lg transition-colors border-b-2 -mb-px capitalize",
                  tab === t
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {t === "diagnose" && <Wrench className="h-3 w-3 inline mr-1 -mt-0.5" />}
                {t === "history"  && <History className="h-3 w-3 inline mr-1 -mt-0.5" />}
                {t === "rules"    && <Cpu className="h-3 w-3 inline mr-1 -mt-0.5" />}
                {t === "diagnose" ? "Diagnose" : t === "history" ? "Fix History" : "Auto Rules"}
              </button>
            ))}
          </div>

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto">

            {/* ══ DIAGNOSE TAB ══════════════════════════════════════════════════ */}
            {tab === "diagnose" && (
              <>
                {/* Screenshot evidence strip */}
                {(screenshotLoading || screenshotRef.current) && (
                  <div className="px-6 pt-3 pb-0">
                    <div className="flex items-center gap-2 bg-muted/20 border border-border/30 rounded-lg px-3 py-2">
                      <Camera className={cn("h-3.5 w-3.5 flex-shrink-0", screenshotLoading ? "text-muted-foreground/50 animate-pulse" : "text-primary/70")} />
                      <span className="text-[10px] text-muted-foreground/60 font-medium flex-1">
                        {screenshotLoading ? "Capturing page evidence…" : "Page screenshot captured at click time"}
                      </span>
                      {!screenshotLoading && screenshotRef.current && (
                        <>
                          <button
                            data-testid="button-screenshot-toggle"
                            onClick={() => setScreenshotExpanded(v => !v)}
                            className="flex items-center gap-1 text-[10px] text-primary/70 hover:text-primary transition-colors px-1.5 py-0.5 rounded hover:bg-primary/10"
                          >
                            <Expand className="h-3 w-3" />
                            {screenshotExpanded ? "Hide" : "View"}
                          </button>
                        </>
                      )}
                    </div>
                    {screenshotExpanded && screenshotRef.current && (
                      <div className="mt-2 rounded-lg overflow-hidden border border-border/40 shadow-lg">
                        <img
                          src={screenshotRef.current}
                          alt="Page state when Fix was clicked"
                          data-testid="img-fix-screenshot"
                          className="w-full object-cover"
                          style={{ maxHeight: "220px", objectPosition: "top" }}
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* 10-step progress */}
                <div className="px-6 pt-4 pb-3 border-b border-border/20">
                  <div className="flex items-center gap-0.5 overflow-x-auto pb-1">
                    {STEPS.map((step, idx) => {
                      const reached = currentStep >= step.id;
                      const active  = currentStep === step.id;
                      const Icon = step.icon;
                      return (
                        <div key={step.id} className="flex items-center flex-shrink-0">
                          <div className={cn(
                            "flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-medium transition-all",
                            active  && "bg-primary/15 text-primary border border-primary/30",
                            !active && reached  && "text-muted-foreground",
                            !reached && "text-muted-foreground/30"
                          )}>
                            <Icon className="h-3 w-3 flex-shrink-0" />
                            <span className="hidden sm:inline whitespace-nowrap">{step.label}</span>
                            <span className="sm:hidden">{step.id}</span>
                          </div>
                          {idx < STEPS.length - 1 && (
                            <ChevronRight className={cn("h-3 w-3 flex-shrink-0 mx-0.5", reached ? "text-muted-foreground/50" : "text-muted-foreground/15")} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="px-6 py-4 space-y-5">
                  {/* Loading */}
                  {(isLoading || isFetching) && (
                    <div className="flex items-center gap-3 py-6 justify-center text-muted-foreground">
                      <Loader2 className="h-5 w-5 animate-spin text-primary" />
                      <span className="text-sm">Running diagnostics…</span>
                    </div>
                  )}

                  {/* Not yet run */}
                  {!diag && !isLoading && !isFetching && (
                    <div className="text-center py-8 space-y-3">
                      <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
                        <Wrench className="h-6 w-6 text-primary" />
                      </div>
                      <p className="text-sm text-muted-foreground">Click <strong>Run Diagnostics</strong> to analyse all systems on the current page.</p>
                    </div>
                  )}

                  {diag && !isLoading && !isFetching && (
                    <>
                      {/* KPI summary */}
                      <div className="grid grid-cols-4 gap-2">
                        {[
                          { label: "Passed",   value: diag.summary.passed,   color: "text-emerald-400" },
                          { label: "Warnings", value: diag.summary.warnings,  color: "text-amber-400"   },
                          { label: "Failed",   value: diag.summary.failed,    color: "text-red-400"     },
                          { label: "Skipped",  value: diag.summary.skipped,   color: "text-muted-foreground" },
                        ].map(k => (
                          <div key={k.label} className="bg-muted/30 rounded-lg p-2.5 text-center border border-border/30">
                            <div className={cn("text-xl font-bold tabular-nums", k.color)}>{k.value}</div>
                            <div className="text-[10px] text-muted-foreground mt-0.5">{k.label}</div>
                          </div>
                        ))}
                      </div>

                      {/* Checks */}
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/60 mb-2">System Checks</p>
                        <div className="space-y-1.5">
                          {diag.checks.map(check => (
                            <div key={check.id} data-testid={`check-${check.id}`}
                              className="flex items-start gap-2.5 bg-muted/20 rounded-lg px-3 py-2 border border-border/30">
                              <div className="mt-0.5 flex-shrink-0">{statusIcon(check.status)}</div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium">{check.name}</span>
                                  <span className="text-[10px] text-muted-foreground/50 font-mono ml-auto">{check.durationMs}ms</span>
                                </div>
                                <p className="text-xs text-muted-foreground mt-0.5 truncate">{check.detail}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Issues */}
                      {diag.issues.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/60 mb-2">Issues ({diag.issues.length})</p>
                          <div className="space-y-3">
                            {diag.issues.map((issue, idx) => (
                              <div key={idx} data-testid={`issue-${idx}`}
                                className={cn("rounded-xl border p-4 space-y-3",
                                  issue.severity === "critical" ? "border-red-500/25 bg-red-500/5" : "border-amber-500/25 bg-amber-500/5")}>
                                <div className="flex items-start gap-2 flex-wrap">
                                  {severityBadge(issue.severity)}
                                  {issueTypeBadge(issue.type)}
                                  <span className="text-xs text-muted-foreground ml-auto">{issue.component}</span>
                                </div>

                                <p className="text-sm font-medium">{issue.message}</p>

                                {/* Phase 3: Past similar fix badge */}
                                {issue.pastFix && (
                                  <div className="flex items-center gap-2 bg-violet-500/10 border border-violet-500/25 rounded-lg px-3 py-2">
                                    <History className="h-3.5 w-3.5 text-violet-400 flex-shrink-0" />
                                    <div className="flex-1 min-w-0">
                                      <span className="text-[11px] font-semibold text-violet-300">Previously resolved</span>
                                      <span className="text-[11px] text-muted-foreground">
                                        {" "}via <strong>{FIX_ACTION_LABELS[issue.pastFix.action] ?? issue.pastFix.action}</strong>
                                        {issue.pastFix.performedBy && <> by {issue.pastFix.performedBy}</>}
                                        {" · "}{new Date(issue.pastFix.createdAt).toLocaleDateString()}
                                      </span>
                                    </div>
                                    <span className={cn("text-[10px] font-mono capitalize", outcomeColor(issue.pastFix.outcome))}>
                                      {issue.pastFix.outcome}
                                    </span>
                                  </div>
                                )}

                                <div className="bg-background/50 rounded-lg p-3 border border-border/40">
                                  <p className="text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide mb-1">Suggestion</p>
                                  <p className="text-xs text-muted-foreground leading-relaxed">{issue.suggestion}</p>
                                </div>

                                {/* Auto-fix button */}
                                {issue.autoFix && (
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <Button size="sm" variant="outline"
                                      data-testid={`button-fix-${issue.autoFix}`}
                                      disabled={fixMutation.isPending || appliedActions.has(issue.autoFix!)}
                                      onClick={() => fixMutation.mutate({ action: issue.autoFix!, issueType: issue.type, component: issue.component })}
                                      className="h-7 text-xs gap-1.5">
                                      {fixMutation.isPending && !appliedActions.has(issue.autoFix!)
                                        ? <Loader2 className="h-3 w-3 animate-spin" />
                                        : <Wrench className="h-3 w-3" />}
                                      {FIX_ACTION_LABELS[issue.autoFix!] ?? issue.autoFix}
                                    </Button>
                                    {fixResults[issue.autoFix!] && (
                                      <span className={cn("text-xs font-medium", fixResults[issue.autoFix!].ok ? "text-emerald-400" : "text-red-400")}>
                                        {fixResults[issue.autoFix!].ok ? "✓" : "✗"} {fixResults[issue.autoFix!].message}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* All clear */}
                      {overallOk && (
                        <div className="flex items-center gap-3 bg-emerald-500/10 border border-emerald-500/25 rounded-xl p-4">
                          <CheckCircle2 className="h-5 w-5 text-emerald-400 flex-shrink-0" />
                          <div>
                            <p className="text-sm font-semibold text-emerald-300">All systems healthy</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Sippy API connected · CDR cache active · Database responding · {diag.durationMs}ms
                            </p>
                          </div>
                        </div>
                      )}

                      {/* AI analysis — Step 7 */}
                      {aiSuggestion && (
                        <div className="rounded-xl border border-violet-500/25 bg-violet-500/5 p-4 space-y-2">
                          <div className="flex items-center gap-2">
                            <Shield className="h-4 w-4 text-violet-400 flex-shrink-0" />
                            <p className="text-sm font-semibold text-violet-300">Diagnostic Analysis — Step 7</p>
                            <Badge className="text-[10px] px-1.5 py-0 h-4 bg-violet-500/20 text-violet-300 border-violet-500/30 ml-auto">Rule Engine</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground leading-relaxed">{aiSuggestion}</p>
                        </div>
                      )}

                      {/* Admin extended actions — Steps 8-9 */}
                      {role === "admin" && diag.issues.length > 0 && (
                        <div className="rounded-xl border border-border/40 bg-muted/15 p-4 space-y-3">
                          <div className="flex items-center gap-2">
                            <HardDrive className="h-4 w-4 text-blue-400 flex-shrink-0" />
                            <p className="text-sm font-semibold">Admin Fix Actions — Steps 8–9</p>
                            <Badge className="text-[10px] px-1.5 py-0 h-4 ml-auto bg-blue-500/15 text-blue-300 border-blue-500/30">Admin Only</Badge>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {(["retry_sippy", "refresh_accounts", "refresh_vendors", "check_db"] as const).map(action => (
                              <Button key={action} size="sm" variant="outline"
                                data-testid={`button-admin-fix-${action}`}
                                disabled={fixMutation.isPending}
                                onClick={() => fixMutation.mutate({ action })}
                                className="h-7 text-xs gap-1.5">
                                {fixMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wrench className="h-3 w-3" />}
                                {FIX_ACTION_LABELS[action]}
                              </Button>
                            ))}
                          </div>
                          {Object.entries(fixResults).filter(([, r]) => r).map(([action, r]) => (
                            <div key={action} className={cn("text-xs rounded-lg px-3 py-2 border",
                              r.ok ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/25" : "bg-red-500/10 text-red-300 border-red-500/25")}>
                              <span className="font-mono font-semibold">{FIX_ACTION_LABELS[action] ?? action}: </span>{r.message}
                              <span className="text-muted-foreground/50 ml-1 tabular-nums">({r.durationMs}ms)</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Frontend errors captured (Step 2) */}
                      {frontendErrorsRef.current.length > 0 && (
                        <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4 space-y-2">
                          <div className="flex items-center gap-2">
                            <Terminal className="h-4 w-4 text-amber-400 flex-shrink-0" />
                            <p className="text-sm font-semibold text-amber-300">Step 2 — Browser Console Errors ({frontendErrorsRef.current.length})</p>
                          </div>
                          <div className="space-y-1 max-h-28 overflow-y-auto">
                            {frontendErrorsRef.current.map((err, i) => (
                              <p key={i} className="text-[10px] font-mono text-amber-300/80 bg-amber-500/10 rounded px-2 py-1 break-all">{err}</p>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* "Send to AI agent" callout — shown when issues remain unresolved */}
                      {diag.issues.length > 0 && (() => {
                        const resolved = Object.values(fixResults).filter(r => r.ok).length;
                        const hasUnresolved = resolved < diag.issues.length;
                        if (!hasUnresolved) return null;
                        return (
                          <div className="rounded-xl border border-violet-500/30 bg-violet-500/8 p-4 space-y-2.5">
                            <div className="flex items-center gap-2">
                              <Bot className="h-4 w-4 text-violet-400 flex-shrink-0" />
                              <p className="text-sm font-semibold text-violet-200">Auto-fix could not resolve all issues</p>
                            </div>
                            <p className="text-xs text-muted-foreground leading-relaxed">
                              Click <strong className="text-foreground">"Copy Report for AI"</strong> below, then paste it into the
                              {" "}<strong className="text-foreground">Replit Agent chat</strong>. The agent will receive the full page context,
                              issue list, checks, and system metrics — and will start working specifically on
                              {" "}<strong className="text-foreground">{pageName}</strong> to diagnose and fix the root cause in the code.
                            </p>
                            <div className="flex flex-wrap gap-2 pt-0.5">
                              <button
                                data-testid="button-copy-report-inline"
                                onClick={() => {
                                  const report = buildFixReport(
                                    pageName, window.location.href, diag,
                                    frontendErrorsRef.current, !!screenshotRef.current, fixResults,
                                  );
                                  navigator.clipboard.writeText(report).then(() => {
                                    setCopied(true);
                                    toast({ title: "Report copied to clipboard", description: "Paste into Replit Agent chat." });
                                    setTimeout(() => setCopied(false), 3000);
                                  });
                                }}
                                className={cn(
                                  "flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors",
                                  copied
                                    ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
                                    : "bg-violet-500/20 text-violet-200 border-violet-500/40 hover:bg-violet-500/30"
                                )}
                              >
                                {copied ? <CopyCheck className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                                {copied ? "Report Copied!" : "Copy Report for AI"}
                              </button>
                              <span className="text-[10px] text-muted-foreground/50 self-center">
                                Includes: page context · issue list · checks · metrics · browser errors{screenshotRef.current ? " · screenshot status" : ""}
                              </span>
                            </div>
                          </div>
                        );
                      })()}

                      {/* Step 10: Final validation */}
                      <div className="rounded-xl border border-border/40 bg-muted/10 p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <Clock className="h-3.5 w-3.5 text-muted-foreground/60" />
                          <p className="text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Step 10 — Final Status</p>
                        </div>
                        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-muted-foreground">
                          <span>Module:</span>
                          <span className="font-mono text-foreground">{(diag as any).module || pageName}</span>
                          <span>CDR Cache:</span>
                          <span className="font-mono text-foreground">{diag.cdrCacheSize.toLocaleString()} records</span>
                          <span>Cache Age:</span>
                          <span className="font-mono text-foreground">
                            {diag.cdrCacheAgeMs !== null ? `${Math.round(diag.cdrCacheAgeMs / 1000)}s` : "unknown"}
                          </span>
                          <span>JS Errors Captured:</span>
                          <span className={cn("font-mono", frontendErrorsRef.current.length > 0 ? "text-amber-400" : "text-foreground")}>
                            {(diag as any).frontendErrorsReceived ?? 0}
                          </span>
                          <span>Auto Fixes:</span>
                          <span className="font-mono text-foreground">{diag.autoRecovery.totalAutoFixes} triggered</span>
                          <span>Consecutive Failures:</span>
                          <span className={cn("font-mono", diag.autoRecovery.consecutiveFailures > 0 ? "text-amber-400" : "text-foreground")}>
                            {diag.autoRecovery.consecutiveFailures}
                          </span>
                          <span>Diagnosed At:</span>
                          <span className="font-mono text-foreground">{new Date(diag.diagnosedAt).toLocaleTimeString()}</span>
                          <span>Duration:</span>
                          <span className="font-mono text-foreground">{diag.durationMs}ms</span>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </>
            )}

            {/* ══ HISTORY TAB ════════════════════════════════════════════════════ */}
            {tab === "history" && (
              <div className="px-6 py-4 space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/60">Fix History — Last 50 Events</p>
                  <Button size="sm" variant="ghost" onClick={() => refetchHistory()} className="h-6 text-xs gap-1">
                    <RefreshCw className="h-3 w-3" /> Refresh
                  </Button>
                </div>

                {histLoading && (
                  <div className="flex items-center gap-2 py-6 justify-center text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    <span className="text-sm">Loading history…</span>
                  </div>
                )}

                {!histLoading && (!historyData?.history?.length) && (
                  <div className="text-center py-8">
                    <History className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">No fix history yet. Run a diagnostic and apply a fix to start building history.</p>
                  </div>
                )}

                {historyData?.history && historyData.history.length > 0 && (
                  <div className="space-y-2">
                    {historyData.history.map(row => (
                      <div key={row.id} data-testid={`history-row-${row.id}`}
                        className="flex items-start gap-3 bg-muted/20 rounded-lg px-3 py-2.5 border border-border/30">
                        <div className="mt-0.5 flex-shrink-0">{outcomeIcon(row.outcome)}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            {issueTypeBadge(row.issueType)}
                            <span className="text-xs font-medium truncate">
                              {FIX_ACTION_LABELS[row.fixAction ?? ""] ?? row.fixAction ?? "N/A"}
                            </span>
                            <span className={cn("text-xs font-medium ml-auto capitalize", outcomeColor(row.outcome))}>{row.outcome}</span>
                          </div>
                          {row.outcomeMessage && (
                            <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{row.outcomeMessage}</p>
                          )}
                          <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground/50">
                            <span>{row.page ?? "system"}</span>
                            {row.triggeredBy === "auto" && (
                              <span className="text-violet-400/70 flex items-center gap-0.5"><Cpu className="h-2.5 w-2.5" /> auto</span>
                            )}
                            {row.performedBy && <span>by {row.performedBy}</span>}
                            {row.hasScreenshot && (
                              <a
                                href={`/api/fix/screenshot/${row.id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                data-testid={`link-screenshot-${row.id}`}
                                className="flex items-center gap-0.5 text-primary/60 hover:text-primary transition-colors"
                                title="View captured screenshot"
                              >
                                <Camera className="h-2.5 w-2.5" />screenshot
                              </a>
                            )}
                            <span className="ml-auto">{new Date(row.createdAt).toLocaleString()}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ══ AUTO RULES TAB ═════════════════════════════════════════════════ */}
            {tab === "rules" && (
              <div className="px-6 py-4 space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/60">Phase 4 — Auto Recovery Rules</p>
                  {rulesData && (
                    <div className="text-xs text-muted-foreground">
                      <span className="text-violet-400 font-medium">{rulesData.totalAutoFixes}</span> auto-fix(es) triggered
                    </div>
                  )}
                </div>

                {rulesData?.consecutiveSippyFailures !== undefined && rulesData.consecutiveSippyFailures > 0 && (
                  <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/25 rounded-lg px-3 py-2">
                    <AlertTriangle className="h-4 w-4 text-amber-400 flex-shrink-0" />
                    <p className="text-xs text-amber-300">
                      <strong>{rulesData.consecutiveSippyFailures}</strong> consecutive Sippy API failure(s) detected.
                      {rulesData.consecutiveSippyFailures >= 3 && " Auto-retry rule will fire on next interval."}
                    </p>
                  </div>
                )}

                {rulesData?.lastEvent && (
                  <div className="bg-muted/30 rounded-lg px-3 py-2 border border-border/30">
                    <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide mb-0.5">Last Auto Event</p>
                    <p className="text-xs text-muted-foreground">{rulesData.lastEvent}</p>
                  </div>
                )}

                <div className="space-y-3">
                  {(rulesData?.rules ?? []).map(rule => (
                    <div key={rule.id} className="rounded-xl border border-border/40 bg-muted/15 p-4 space-y-2">
                      <div className="flex items-center gap-2">
                        <div className={cn("h-2 w-2 rounded-full flex-shrink-0", rule.enabled ? "bg-emerald-400" : "bg-muted-foreground/30")} />
                        <p className="text-sm font-medium">{rule.name}</p>
                        <Badge className={cn("text-[10px] px-1.5 py-0 h-4 ml-auto border",
                          rule.enabled ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" : "bg-muted/30 text-muted-foreground border-border/30")}>
                          {rule.enabled ? "Enabled" : "Disabled"}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono bg-muted/40 px-1.5 py-0.5 rounded border border-border/30 text-muted-foreground">{rule.trigger}</span>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">{rule.description}</p>
                    </div>
                  ))}
                </div>

                <div className="rounded-xl border border-border/30 bg-muted/10 p-4 space-y-1 text-xs text-muted-foreground">
                  <p className="font-semibold text-foreground/80 mb-2">Planned Rules (Phase 4 Roadmap)</p>
                  {[
                    "ASR Drop Alert — Notify when ASR falls below configured threshold",
                    "No Data Auto Reload — Trigger CDR reload when analytics returns empty",
                    "API Fail 3× → Auto Fix — Already implemented above",
                    "Balance Threshold Alert — Trigger when vendor balance drops critically",
                  ].map(r => (
                    <div key={r} className="flex items-center gap-2 opacity-50">
                      <ChevronRight className="h-3 w-3 flex-shrink-0" />
                      <span>{r}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-border/50 flex items-center gap-2 flex-shrink-0 bg-background/50 flex-wrap">
            {tab === "diagnose" && (
              <>
                <Button onClick={runDiagnosis} disabled={isLoading || isFetching} data-testid="button-run-diagnostics" className="gap-2" size="sm">
                  {isLoading || isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  {diag ? "Re-run Diagnostics" : "Run Diagnostics"}
                </Button>
                {diag && !overallOk && (
                  <Button variant="outline" size="sm" data-testid="button-invalidate-cache"
                    onClick={() => { queryClient.invalidateQueries(); toast({ title: "Query cache cleared", description: "All data will refresh on next navigation." }); }}
                    className="gap-2 text-xs">
                    <RefreshCw className="h-3.5 w-3.5" /> Clear Cache
                  </Button>
                )}
                {diag && (
                  <Button
                    variant="outline"
                    size="sm"
                    data-testid="button-copy-fix-report"
                    onClick={() => {
                      const report = buildFixReport(
                        pageName,
                        window.location.href,
                        diag,
                        frontendErrorsRef.current,
                        !!screenshotRef.current,
                        fixResults,
                      );
                      navigator.clipboard.writeText(report).then(() => {
                        setCopied(true);
                        toast({ title: "Report copied", description: "Paste it into the Replit Agent chat to get code-level help." });
                        setTimeout(() => setCopied(false), 3000);
                      });
                    }}
                    className={cn(
                      "gap-1.5 text-xs transition-colors",
                      copied
                        ? "border-emerald-500/50 text-emerald-400 bg-emerald-500/10"
                        : "border-violet-500/40 text-violet-300 hover:bg-violet-500/10"
                    )}
                  >
                    {copied ? <CopyCheck className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
                    {copied ? "Copied!" : "Copy Report for AI"}
                  </Button>
                )}
              </>
            )}
            {tab === "history" && (
              <Button variant="outline" size="sm" onClick={() => { setTab("diagnose"); runDiagnosis(); }} className="gap-2 text-xs">
                <Wrench className="h-3.5 w-3.5" /> Run New Diagnostic
              </Button>
            )}
            <div className="flex-1" />
            <Button variant="ghost" size="sm" onClick={handleClose} data-testid="button-fix-close" className="text-muted-foreground">
              <X className="h-4 w-4 mr-1" /> Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

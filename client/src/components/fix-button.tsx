import { useState, useCallback } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Wrench, X, CheckCircle2, AlertTriangle, XCircle, Loader2, ChevronRight, RefreshCw, Database, Wifi, HardDrive, Shield, Zap, AlertCircle, Clock } from "lucide-react";
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
}
interface DiagResult {
  status: "ok" | "warning" | "critical";
  checks: DiagCheck[];
  issues: DiagIssue[];
  summary: { total: number; passed: number; warnings: number; failed: number; skipped: number };
  cdrCacheSize: number;
  cdrCacheAgeMs: number | null;
  diagnosedAt: string;
  durationMs: number;
}
interface FixResult {
  ok: boolean;
  message: string;
  durationMs: number;
}

// ── Step definitions for the 10-step flow display ───────────────────────────
const STEPS = [
  { id: 1, label: "Detect Context",     icon: Zap },
  { id: 2, label: "Collect Logs",       icon: Database },
  { id: 3, label: "Check API",          icon: Wifi },
  { id: 4, label: "Classify Issue",     icon: AlertCircle },
  { id: 5, label: "Run Auto Fixes",     icon: RefreshCw },
  { id: 6, label: "Re-check Status",    icon: CheckCircle2 },
  { id: 7, label: "AI Analysis",        icon: Shield },
  { id: 8, label: "Admin Review",       icon: HardDrive },
  { id: 9, label: "Apply Fix",          icon: Wrench },
  { id: 10, label: "Final Validation",  icon: Clock },
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
  };
  return (
    <span className={cn("text-[10px] font-mono px-1.5 py-0.5 rounded border", COLORS[t] ?? "bg-muted/30 text-muted-foreground border-border/40")}>
      {t}
    </span>
  );
}

// ── AI-rule engine (deterministic suggestions based on issue type / component) ──
function buildAiSuggestion(issues: DiagIssue[]): string | null {
  if (issues.length === 0) return null;
  const primary = issues.find(i => i.severity === "critical") ?? issues[0];
  const suggestions: Record<string, string> = {
    API_FAILURE:   "Root cause is likely a Sippy XML-RPC connectivity failure. Confirm the Sippy server IP / hostname in Settings matches the actual server. Check that port 9900 (or your configured XML-RPC port) is open in the firewall. If using HTTPS, verify the certificate is valid. Run 'Retry API' to re-establish the session without restarting the full server.",
    AUTH_ERROR:    "Root cause is credential rejection. Sippy admin accounts require the 'admin' flag set in Sippy's administration panel. Verify the username/password are correct for this exact Sippy build. Note: Sippy Python 2 softswitch is case-sensitive for credentials. Re-enter them in Settings → General Settings.",
    TIMEOUT:       "Root cause is a network-level timeout before Sippy responds. This usually indicates: (1) the Sippy server is overloaded, (2) a firewall is silently dropping packets, or (3) the XML-RPC port is blocked. Check server load on the Sippy host. Try increasing the timeout in Settings or whitelist the app server IP in Sippy's firewall.",
    NO_DATA:       "Root cause is the CDR background job has not yet run or cannot retrieve CDRs. This may be caused by a Sippy account with insufficient CDR read permissions, or a date range filter returning no results. Check that the Sippy admin account has the 'showcdrs' permission flag enabled. The CDR job runs every 3 minutes automatically.",
    DATA_MISMATCH: "Root cause is the CDR cache has gone stale, meaning the background job failed silently. Check server logs for '[cdr-cache] ERROR' lines. A common cause is the Sippy CDR API returning an XML parse error due to malformed CDR data. Identify the specific CDR causing the parse failure and exclude it by adjusting the date range.",
    BACKEND_ERROR: "Root cause is a PostgreSQL connectivity failure. Verify DATABASE_URL is correctly set in the environment secrets. Check that the PostgreSQL service is running and accepting connections. If this is intermittent, it may be a connection pool exhaustion issue — restart the application server.",
  };
  return suggestions[primary.type] ?? primary.suggestion;
}

// ── Fix button label map ─────────────────────────────────────────────────────
const FIX_ACTION_LABELS: Record<string, string> = {
  retry_sippy:      "Retry Sippy API",
  warm_cdr_cache:   "Warm CDR Cache",
  check_db:         "Test DB Connection",
  refresh_accounts: "Refresh Accounts",
  refresh_vendors:  "Refresh Vendors",
};

// ── Main component ───────────────────────────────────────────────────────────
export function FixButton() {
  const { user } = useAuth();
  const role = (user as any)?.role as string | undefined;
  const [open, setOpen] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const [appliedActions, setAppliedActions] = useState<Set<string>>(new Set());
  const [fixResults, setFixResults] = useState<Record<string, FixResult>>({});
  const [location] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const pageName = getPageName(location);

  // Viewer role: no Fix button
  if (!role || role === "viewer") return null;

  const {
    data: diag,
    isLoading,
    refetch,
    isFetching,
  } = useQuery<DiagResult>({
    queryKey: ["/api/fix/diagnose"],
    enabled: open,
    staleTime: 0,
    refetchOnMount: true,
  });

  const fixMutation = useMutation({
    mutationFn: async (action: string) => {
      const res = await apiRequest("POST", "/api/fix/attempt", { action });
      return res.json() as Promise<FixResult>;
    },
    onSuccess: (data, action) => {
      setFixResults(prev => ({ ...prev, [action]: data }));
      setAppliedActions(prev => new Set(Array.from(prev).concat(action)));
      if (data.ok) {
        toast({ title: "Fix applied", description: data.message });
        queryClient.invalidateQueries({ queryKey: ["/api/fix/diagnose"] });
        queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
        queryClient.invalidateQueries({ queryKey: ["/api/cdrs"] });
      } else {
        toast({ title: "Fix failed", description: data.message, variant: "destructive" });
      }
    },
    onError: (e: any) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const handleOpen = useCallback(() => {
    setOpen(true);
    setActiveStep(1);
    setAppliedActions(new Set());
    setFixResults({});
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
    setActiveStep(0);
  }, []);

  const runDiagnosis = useCallback(() => {
    setAppliedActions(new Set());
    setFixResults({});
    setActiveStep(1);
    refetch().then(() => setActiveStep(diag?.issues.length ? 4 : 6));
  }, [refetch, diag]);

  // Advance step as diagnosis loads
  const currentStep = isLoading || isFetching ? 2
    : !diag              ? 0
    : diag.issues.length ? 4
    : 6;

  const aiSuggestion = diag ? buildAiSuggestion(diag.issues) : null;
  const overallOk = diag?.status === "ok";

  const dotColor = overallOk
    ? "bg-emerald-500"
    : diag?.status === "warning"
    ? "bg-amber-500"
    : diag?.status === "critical"
    ? "bg-red-500"
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
          "transition-all duration-150 font-medium text-sm border border-primary/20",
          "backdrop-blur-sm"
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
                  {diag.status === "ok" ? "All Systems OK" : diag.status === "warning" ? "Warning" : "Issues Detected"}
                </Badge>
              )}
            </div>
          </DialogHeader>

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto">
            {/* ── 10-Step Progress Bar ── */}
            <div className="px-6 pt-4 pb-3 border-b border-border/30">
              <div className="flex items-center gap-0.5 overflow-x-auto pb-1">
                {STEPS.map((step, idx) => {
                  const reached = currentStep >= step.id;
                  const active  = currentStep === step.id;
                  const Icon = step.icon;
                  return (
                    <div key={step.id} className="flex items-center flex-shrink-0">
                      <div
                        className={cn(
                          "flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-medium transition-all",
                          active  && "bg-primary/15 text-primary border border-primary/30",
                          !active && reached && "text-muted-foreground",
                          !reached && "text-muted-foreground/30"
                        )}
                        title={`Step ${step.id}: ${step.label}`}
                      >
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
              {/* ── Loading state ── */}
              {(isLoading || isFetching) && (
                <div className="flex items-center gap-3 py-6 justify-center text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  <span className="text-sm">Running diagnostics across all systems…</span>
                </div>
              )}

              {/* ── Not yet run ── */}
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
                  {/* ── Summary KPIs ── */}
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

                  {/* ── System checks list ── */}
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/60 mb-2">System Checks</p>
                    <div className="space-y-1.5">
                      {diag.checks.map(check => (
                        <div
                          key={check.id}
                          data-testid={`check-${check.id}`}
                          className="flex items-start gap-2.5 bg-muted/20 rounded-lg px-3 py-2 border border-border/30"
                        >
                          <div className="mt-0.5 flex-shrink-0">{statusIcon(check.status)}</div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium">{check.name}</span>
                              <span className="text-[10px] text-muted-foreground/50 font-mono ml-auto flex-shrink-0">{check.durationMs}ms</span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5 truncate">{check.detail}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* ── Issues found ── */}
                  {diag.issues.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/60 mb-2">Issues Detected ({diag.issues.length})</p>
                      <div className="space-y-3">
                        {diag.issues.map((issue, idx) => (
                          <div
                            key={idx}
                            data-testid={`issue-${idx}`}
                            className={cn(
                              "rounded-xl border p-4 space-y-3",
                              issue.severity === "critical" ? "border-red-500/25 bg-red-500/5" : "border-amber-500/25 bg-amber-500/5"
                            )}
                          >
                            <div className="flex items-start gap-2 flex-wrap">
                              {severityBadge(issue.severity)}
                              {issueTypeBadge(issue.type)}
                              <span className="text-xs text-muted-foreground ml-auto">{issue.component}</span>
                            </div>
                            <p className="text-sm font-medium">{issue.message}</p>
                            <div className="bg-background/50 rounded-lg p-3 border border-border/40">
                              <p className="text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide mb-1">Suggestion</p>
                              <p className="text-xs text-muted-foreground leading-relaxed">{issue.suggestion}</p>
                            </div>
                            {/* Auto-fix button */}
                            {issue.autoFix && (
                              <div className="flex items-center gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  data-testid={`button-fix-${issue.autoFix}`}
                                  disabled={fixMutation.isPending || appliedActions.has(issue.autoFix!)}
                                  onClick={() => fixMutation.mutate(issue.autoFix!)}
                                  className="h-7 text-xs gap-1.5"
                                >
                                  {fixMutation.isPending && !appliedActions.has(issue.autoFix!) ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <Wrench className="h-3 w-3" />
                                  )}
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

                  {/* ── All clear ── */}
                  {overallOk && (
                    <div className="flex items-center gap-3 bg-emerald-500/10 border border-emerald-500/25 rounded-xl p-4">
                      <CheckCircle2 className="h-5 w-5 text-emerald-400 flex-shrink-0" />
                      <div>
                        <p className="text-sm font-semibold text-emerald-300">All systems healthy</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Sippy API connected · CDR cache active · Database responding ·
                          Diagnosed in {diag.durationMs}ms
                        </p>
                      </div>
                    </div>
                  )}

                  {/* ── AI Analysis (Step 7) ── */}
                  {aiSuggestion && (
                    <div className="rounded-xl border border-violet-500/25 bg-violet-500/5 p-4 space-y-2">
                      <div className="flex items-center gap-2">
                        <Shield className="h-4 w-4 text-violet-400 flex-shrink-0" />
                        <p className="text-sm font-semibold text-violet-300">Diagnostic Analysis — Step 7</p>
                        <Badge className="text-[10px] px-1.5 py-0 h-4 bg-violet-500/20 text-violet-300 border-violet-500/30 ml-auto">
                          Rule Engine
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">{aiSuggestion}</p>
                    </div>
                  )}

                  {/* ── Admin-only extra fix actions ── */}
                  {role === "admin" && diag.issues.length > 0 && (
                    <div className="rounded-xl border border-border/40 bg-muted/15 p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <HardDrive className="h-4 w-4 text-blue-400 flex-shrink-0" />
                        <p className="text-sm font-semibold">Admin Fix Actions — Steps 8–9</p>
                        <Badge className="text-[10px] px-1.5 py-0 h-4 ml-auto bg-blue-500/15 text-blue-300 border-blue-500/30">Admin Only</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">As Admin you can run additional recovery actions. All actions are targeted and non-destructive.</p>
                      <div className="flex flex-wrap gap-2">
                        {(["retry_sippy", "refresh_accounts", "refresh_vendors", "check_db"] as const).map(action => (
                          <Button
                            key={action}
                            size="sm"
                            variant="outline"
                            data-testid={`button-admin-fix-${action}`}
                            disabled={fixMutation.isPending}
                            onClick={() => fixMutation.mutate(action)}
                            className="h-7 text-xs gap-1.5"
                          >
                            {fixMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wrench className="h-3 w-3" />}
                            {FIX_ACTION_LABELS[action]}
                          </Button>
                        ))}
                      </div>
                      {Object.entries(fixResults).filter(([, r]) => r).map(([action, r]) => (
                        <div key={action} className={cn("text-xs rounded-lg px-3 py-2 border", r.ok ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/25" : "bg-red-500/10 text-red-300 border-red-500/25")}>
                          <span className="font-mono font-semibold">{FIX_ACTION_LABELS[action] ?? action}: </span>{r.message}
                          {" "}<span className="text-muted-foreground/50 tabular-nums">({r.durationMs}ms)</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* ── Step 10: Final validation summary ── */}
                  <div className="rounded-xl border border-border/40 bg-muted/10 p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Clock className="h-3.5 w-3.5 text-muted-foreground/60" />
                      <p className="text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Step 10 — Final Status</p>
                    </div>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-muted-foreground">
                      <span>CDR Cache Size:</span>
                      <span className="font-mono text-foreground">{diag.cdrCacheSize.toLocaleString()} records</span>
                      <span>CDR Cache Age:</span>
                      <span className="font-mono text-foreground">
                        {diag.cdrCacheAgeMs !== null ? `${Math.round(diag.cdrCacheAgeMs / 1000)}s` : "unknown"}
                      </span>
                      <span>Diagnosed At:</span>
                      <span className="font-mono text-foreground">{new Date(diag.diagnosedAt).toLocaleTimeString()}</span>
                      <span>Total Duration:</span>
                      <span className="font-mono text-foreground">{diag.durationMs}ms</span>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* ── Footer ── */}
          <div className="px-6 py-4 border-t border-border/50 flex items-center gap-2 flex-shrink-0 bg-background/50">
            <Button
              onClick={runDiagnosis}
              disabled={isLoading || isFetching}
              data-testid="button-run-diagnostics"
              className="gap-2"
              size="sm"
            >
              {isLoading || isFetching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              {diag ? "Re-run Diagnostics" : "Run Diagnostics"}
            </Button>
            {diag && !overallOk && (
              <Button
                variant="outline"
                size="sm"
                data-testid="button-invalidate-cache"
                onClick={() => {
                  queryClient.invalidateQueries();
                  toast({ title: "Query cache cleared", description: "All frontend data will refresh on next page load." });
                }}
                className="gap-2 text-xs"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Clear Frontend Cache
              </Button>
            )}
            <div className="flex-1" />
            <Button variant="ghost" size="sm" onClick={handleClose} data-testid="button-fix-close" className="text-muted-foreground">
              <X className="h-4 w-4 mr-1" />
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

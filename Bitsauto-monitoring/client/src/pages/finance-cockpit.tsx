import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  DollarSign, AlertTriangle, TrendingDown, TrendingUp,
  FileText, RefreshCw, ArrowRight, BrainCircuit, Scale,
  BarChart3, Activity, ShieldAlert, Users, Clock, Wallet,
  AlertOctagon, CheckCircle2, Play,
} from "lucide-react";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(n: number | undefined | null, prefix = "$") {
  if (n == null) return "—";
  return `${prefix}${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}
function fmtPct(n: number | undefined | null) {
  if (n == null) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

// ── KPI strip card ────────────────────────────────────────────────────────────
interface KpiCardProps {
  label: string;
  value: string;
  sub?: string;
  trend?: "up" | "down" | "neutral";
  icon: React.ElementType;
  accent?: "default" | "warn" | "danger" | "ok";
  href?: string;
  testId?: string;
}
function KpiCard({ label, value, sub, trend, icon: Icon, accent = "default", href, testId }: KpiCardProps) {
  const accentCls = {
    default: "text-primary",
    warn:    "text-amber-500",
    danger:  "text-red-500",
    ok:      "text-emerald-500",
  }[accent];

  const card = (
    <Card className="relative overflow-hidden">
      <CardContent className="pt-4 pb-3">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
            <p className={`text-2xl font-bold mt-1 ${accentCls}`} data-testid={testId}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
          <div className={`p-2 rounded-lg bg-muted ${accentCls}`}>
            <Icon className="w-4 h-4" />
          </div>
        </div>
        {trend && (
          <div className="mt-2 flex items-center gap-1 text-xs">
            {trend === "up"   && <TrendingUp   className="w-3 h-3 text-emerald-500" />}
            {trend === "down" && <TrendingDown  className="w-3 h-3 text-red-500" />}
          </div>
        )}
      </CardContent>
    </Card>
  );

  if (href) return <Link href={href}>{card}</Link>;
  return card;
}

// ── Collections queue item ───────────────────────────────────────────────────
function CollectionRow({ dispute }: { dispute: any }) {
  const urgency = dispute.status === "escalated" ? "danger" : dispute.status === "open" ? "warn" : "default";
  const urgencyColor = {
    danger:  "border-l-red-500",
    warn:    "border-l-amber-400",
    default: "border-l-muted",
  }[urgency];

  return (
    <div className={`border-l-4 ${urgencyColor} pl-3 py-2`}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium truncate">{dispute.clientName ?? "Unknown Client"}</p>
        <Badge
          variant={urgency === "danger" ? "destructive" : urgency === "warn" ? "outline" : "secondary"}
          className="text-xs ml-2 shrink-0"
        >
          {dispute.status}
        </Badge>
      </div>
      <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
        <span>{dispute.disputeType ?? "dispute"}</span>
        {dispute.amount != null && <span>{fmt(dispute.amount)}</span>}
        {dispute.openedAt && (
          <span className="flex items-center gap-0.5">
            <Clock className="w-2.5 h-2.5" />
            {new Date(dispute.openedAt).toLocaleDateString()}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Revenue assurance row ────────────────────────────────────────────────────
function AssuranceRow({ row, type }: { row: any; type: "dmr" | "recon" | "margin" }) {
  const icons = { dmr: Activity, recon: Scale, margin: TrendingDown };
  const Icon = icons[type];

  return (
    <div className="flex items-start gap-3 py-2">
      <div className="p-1.5 rounded bg-muted mt-0.5">
        <Icon className="w-3.5 h-3.5 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">
          {row.clientName ?? row.accountName ?? row.vendorName ?? "—"}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">{row.description ?? row.status ?? ""}</p>
      </div>
      {row.variance != null && (
        <span className={`text-xs font-medium shrink-0 ${row.variance < 0 ? "text-red-500" : "text-emerald-500"}`}>
          {fmtPct(row.variance)}
        </span>
      )}
      {row.amount != null && (
        <span className="text-xs text-muted-foreground shrink-0">{fmt(row.amount)}</span>
      )}
    </div>
  );
}

// ── AI alert row ─────────────────────────────────────────────────────────────
function AiAlertRow({ alert }: { alert: any }) {
  const severityColor: Record<string, string> = {
    critical: "text-red-500",
    high:     "text-orange-500",
    medium:   "text-amber-500",
    low:      "text-blue-500",
  };

  return (
    <div className="flex items-start gap-3 py-2">
      <BrainCircuit className={`w-4 h-4 mt-0.5 shrink-0 ${severityColor[alert.severity] ?? "text-muted-foreground"}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{alert.alertType ?? "AI Alert"}</p>
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{alert.summary ?? alert.message ?? ""}</p>
        {alert.affectedClient && (
          <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
            <Users className="w-2.5 h-2.5" />
            {alert.affectedClient}
          </p>
        )}
      </div>
      <Badge
        variant={alert.severity === "critical" || alert.severity === "high" ? "destructive" : "outline"}
        className="text-xs shrink-0"
      >
        {alert.severity ?? "info"}
      </Badge>
    </div>
  );
}

// ── Balance Alert row ─────────────────────────────────────────────────────────
const SEVERITY_CONFIG: Record<string, { color: string; badge: "destructive" | "outline" | "secondary"; label: string }> = {
  critical: { color: "text-red-500",   badge: "destructive", label: "CRITICAL" },
  urgent:   { color: "text-amber-500", badge: "outline",      label: "URGENT"   },
  warning:  { color: "text-yellow-500",badge: "secondary",    label: "WARNING"  },
};

function BalanceAlertRow({ alert: a }: { alert: any }) {
  const cfg = SEVERITY_CONFIG[a.severity] ?? SEVERITY_CONFIG.warning;
  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{a.accountName ?? `Account #${a.accountId}`}</p>
        <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2">
          <span className={cfg.color}>
            ${Number(a.currentBalance).toFixed(2)} / threshold ${Number(a.thresholdUsd).toFixed(0)}
          </span>
          <span className="text-muted-foreground/60">
            · {new Date(a.triggeredAt).toLocaleDateString()}
          </span>
        </p>
      </div>
      <Badge variant={cfg.badge} className="text-xs shrink-0 ml-2">
        {cfg.label}
      </Badge>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function FinanceCockpitPage() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: invoiceData,    isLoading: invLoading }    = useQuery<any>({ queryKey: ["/api/invoices"] });
  const { data: disputeData,    isLoading: dispLoading }   = useQuery<any>({ queryKey: ["/api/billing-disputes"] });
  const { data: dmrData,        isLoading: dmrLoading }    = useQuery<any>({ queryKey: ["/api/dmr"] });
  const { data: reconcData,     isLoading: reconLoading }  = useQuery<any>({ queryKey: ["/api/client-reconciliations"] });
  const { data: aiData,         isLoading: aiLoading }     = useQuery<any>({ queryKey: ["/api/ai-assurance/alerts"] });
  const { data: marginData,     isLoading: marginLoading } = useQuery<any>({ queryKey: ["/api/margin-intelligence/alerts"] });
  const { data: identityData }                             = useQuery<any>({ queryKey: ["/api/identity"] });
  const { data: balAlertData,   isLoading: balAlertLoading } = useQuery<any>({
    queryKey: ["/api/noc/balance-alerts"],
    refetchInterval: 5 * 60 * 1000,
  });

  const runAlertMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/noc/balance-alerts/run").then(r => r.json()),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["/api/noc/balance-alerts"] });
      toast({ title: "Balance check complete", description: `Checked ${data.checked ?? 0} accounts, ${data.triggered ?? 0} triggered, ${data.resolved ?? 0} resolved.` });
    },
    onError: (e: any) => toast({ title: "Balance check failed", description: e.message, variant: "destructive" }),
  });

  const invoices      = invoiceData?.invoices    ?? invoiceData?.data ?? [];
  const disputes      = disputeData?.disputes    ?? disputeData?.data ?? [];
  const dmrRows       = dmrData?.reports         ?? dmrData?.data     ?? [];
  const reconRows     = reconcData?.reconciliations ?? reconcData?.data ?? [];
  const aiAlerts      = aiData?.alerts           ?? aiData?.data      ?? [];
  const marginAl      = marginData?.alerts       ?? marginData?.data  ?? [];
  const identities    = identityData?.identities ?? [];
  const balAlerts     = balAlertData?.alerts     ?? [];
  const criticalBalAlerts = balAlerts.filter((a: any) => a.severity === "critical").length;
  const urgentBalAlerts   = balAlerts.filter((a: any) => a.severity === "urgent").length;

  // KPI computations
  const totalBilled    = invoices.filter((i: any) => i.status !== "void").reduce((s: number, i: any) => s + (i.totalAmount ?? 0), 0);
  const totalOverdue   = disputes.filter((d: any) => ["open","escalated"].includes(d.status)).length;
  const totalDisputed  = disputes.reduce((s: number, d: any) => s + (d.amount ?? 0), 0);
  const openAlerts     = aiAlerts.filter((a: any) => !a.resolvedAt).length;
  const criticalAlerts = aiAlerts.filter((a: any) => !a.resolvedAt && ["critical","high"].includes(a.severity)).length;
  const dmrDrift       = dmrRows.filter((r: any) => r.status === "anomaly" || r.driftPct != null && Math.abs(r.driftPct) > 10).length;
  const reconMismatch  = reconRows.filter((r: any) => r.status === "mismatch" || r.variancePct != null && Math.abs(r.variancePct) > 5).length;
  const identityCount  = identities.length;

  // Collections queue: open + escalated disputes sorted by severity
  const collectionsQueue = [...disputes]
    .filter((d: any) => ["open","escalated","reviewing"].includes(d.status))
    .sort((a: any, b: any) => {
      const rank = (s: string) => s === "escalated" ? 0 : s === "open" ? 1 : 2;
      return rank(a.status) - rank(b.status);
    })
    .slice(0, 12);

  // Revenue assurance: DMR anomalies
  const dmrAnomalies = dmrRows
    .filter((r: any) => r.status === "anomaly" || (r.driftPct != null && Math.abs(r.driftPct) > 5))
    .slice(0, 5)
    .map((r: any) => ({ ...r, description: `DMR drift ${r.driftPct != null ? fmtPct(r.driftPct) : r.status}`, variance: r.driftPct }));

  // Reconciliation mismatches
  const reconMismatches = reconRows
    .filter((r: any) => r.status === "mismatch" || (r.variancePct != null && Math.abs(r.variancePct) > 2))
    .slice(0, 5)
    .map((r: any) => ({ ...r, description: `Recon variance ${r.variancePct != null ? fmtPct(r.variancePct) : r.status}`, variance: r.variancePct }));

  // Margin anomalies
  const marginAnomalies = marginAl
    .filter((a: any) => !a.resolvedAt)
    .slice(0, 5)
    .map((a: any) => ({ ...a, description: a.alertType ?? "Margin anomaly", variance: a.marginDeltaPct }));

  // AI queue: unresolved, sorted by severity
  const severityRank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const aiQueue = [...aiAlerts]
    .filter((a: any) => !a.resolvedAt)
    .sort((a: any, b: any) => (severityRank[a.severity] ?? 4) - (severityRank[b.severity] ?? 4))
    .slice(0, 15);

  const anyLoading = invLoading || dispLoading || dmrLoading || reconLoading || aiLoading || marginLoading;

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-primary" />
            Finance Cockpit
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Unified finance operations centre — real-time billing, assurance and collections.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => window.location.reload()}
          data-testid="button-cockpit-refresh"
        >
          <RefreshCw className="w-4 h-4 mr-1" />
          Refresh
        </Button>
      </div>

      {/* ── KPI Strip ──────────────────────────────────────────────────────── */}
      {anyLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i}><CardContent className="pt-4 pb-3"><Skeleton className="h-12 w-full" /></CardContent></Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          <KpiCard
            label="Billed MTD"
            value={fmt(totalBilled)}
            icon={DollarSign}
            accent="default"
            href="/invoices"
            testId="kpi-billed-mtd"
          />
          <KpiCard
            label="Open Disputes"
            value={String(totalOverdue)}
            sub={fmt(totalDisputed) + " at risk"}
            icon={FileText}
            accent={totalOverdue > 5 ? "danger" : totalOverdue > 0 ? "warn" : "ok"}
            href="/billing-disputes"
            testId="kpi-open-disputes"
          />
          <KpiCard
            label="DMR Drift"
            value={String(dmrDrift)}
            sub={dmrDrift > 0 ? "anomalies detected" : "all clean"}
            icon={Activity}
            accent={dmrDrift > 3 ? "danger" : dmrDrift > 0 ? "warn" : "ok"}
            href="/dmr"
            testId="kpi-dmr-drift"
          />
          <KpiCard
            label="Recon Variance"
            value={String(reconMismatch)}
            sub={reconMismatch > 0 ? "mismatches" : "reconciled"}
            icon={Scale}
            accent={reconMismatch > 3 ? "danger" : reconMismatch > 0 ? "warn" : "ok"}
            href="/client-reconciliation"
            testId="kpi-recon-variance"
          />
          <KpiCard
            label="AI Alerts"
            value={String(openAlerts)}
            sub={criticalAlerts > 0 ? `${criticalAlerts} critical` : "no criticals"}
            icon={BrainCircuit}
            accent={criticalAlerts > 0 ? "danger" : openAlerts > 0 ? "warn" : "ok"}
            href="/ai-assurance"
            testId="kpi-ai-alerts"
          />
          <KpiCard
            label="Margin Alerts"
            value={String(marginAl.filter((a: any) => !a.resolvedAt).length)}
            icon={TrendingDown}
            accent={marginAl.filter((a: any) => !a.resolvedAt && a.severity === "critical").length > 0 ? "danger" : "default"}
            href="/margin-intelligence"
            testId="kpi-margin-alerts"
          />
          <KpiCard
            label="Identity Records"
            value={String(identityCount)}
            sub={identityCount === 0 ? "seed from Sippy" : "canonical identities"}
            icon={Users}
            accent={identityCount === 0 ? "warn" : "ok"}
            href="/client-identity"
            testId="kpi-identity-records"
          />
          <KpiCard
            label="Low Balance"
            value={String(balAlerts.length)}
            sub={criticalBalAlerts > 0 ? `${criticalBalAlerts} critical` : urgentBalAlerts > 0 ? `${urgentBalAlerts} urgent` : balAlerts.length === 0 ? "all healthy" : ""}
            icon={Wallet}
            accent={criticalBalAlerts > 0 ? "danger" : urgentBalAlerts > 0 ? "warn" : balAlerts.length > 0 ? "warn" : "ok"}
            href="/balance"
            testId="kpi-balance-alerts"
          />
        </div>
      )}

      {/* ── Main workspace: 3-column ──────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* LEFT — Collections Queue */}
        <Card className="flex flex-col">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-amber-500" />
                Collections Queue
              </CardTitle>
              <Link href="/billing-disputes">
                <Button variant="ghost" size="sm" className="h-7 text-xs gap-1">
                  View all <ArrowRight className="w-3 h-3" />
                </Button>
              </Link>
            </div>
            <p className="text-xs text-muted-foreground">
              {collectionsQueue.length} open / escalated
            </p>
          </CardHeader>
          <Separator />
          <CardContent className="p-0 flex-1">
            <ScrollArea className="h-[420px]">
              <div className="px-4 divide-y">
                {dispLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="py-3"><Skeleton className="h-10 w-full" /></div>
                  ))
                ) : collectionsQueue.length === 0 ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    No open disputes or collections items.
                  </div>
                ) : collectionsQueue.map((d: any, i: number) => (
                  <CollectionRow key={d.id ?? i} dispute={d} />
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* CENTRE — Revenue Assurance Grid */}
        <Card className="flex flex-col">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Activity className="w-4 h-4 text-blue-500" />
                Revenue Assurance
              </CardTitle>
            </div>
            <p className="text-xs text-muted-foreground">DMR drift · recon mismatches · margin anomalies</p>
          </CardHeader>
          <Separator />
          <CardContent className="px-4 flex-1">
            <ScrollArea className="h-[420px]">
              {dmrLoading || reconLoading || marginLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="py-2"><Skeleton className="h-10 w-full" /></div>
                ))
              ) : (
                <>
                  {/* DMR anomalies */}
                  {dmrAnomalies.length > 0 && (
                    <>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-2 pb-1">
                        DMR Drift
                      </p>
                      <div className="divide-y">
                        {dmrAnomalies.map((r: any, i: number) => (
                          <AssuranceRow key={`dmr-${i}`} row={r} type="dmr" />
                        ))}
                      </div>
                    </>
                  )}

                  {/* Reconciliation mismatches */}
                  {reconMismatches.length > 0 && (
                    <>
                      <Separator className="my-3" />
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pb-1">
                        Recon Mismatches
                      </p>
                      <div className="divide-y">
                        {reconMismatches.map((r: any, i: number) => (
                          <AssuranceRow key={`recon-${i}`} row={r} type="recon" />
                        ))}
                      </div>
                    </>
                  )}

                  {/* Margin anomalies */}
                  {marginAnomalies.length > 0 && (
                    <>
                      <Separator className="my-3" />
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pb-1">
                        Margin Anomalies
                      </p>
                      <div className="divide-y">
                        {marginAnomalies.map((r: any, i: number) => (
                          <AssuranceRow key={`margin-${i}`} row={r} type="margin" />
                        ))}
                      </div>
                    </>
                  )}

                  {dmrAnomalies.length === 0 && reconMismatches.length === 0 && marginAnomalies.length === 0 && (
                    <div className="py-8 text-center text-sm text-muted-foreground">
                      All revenue assurance checks are clean.
                    </div>
                  )}
                </>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        {/* RIGHT — AI Assurance Queue */}
        <Card className="flex flex-col">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <BrainCircuit className="w-4 h-4 text-purple-500" />
                AI Assurance Queue
              </CardTitle>
              <Link href="/ai-assurance">
                <Button variant="ghost" size="sm" className="h-7 text-xs gap-1">
                  View all <ArrowRight className="w-3 h-3" />
                </Button>
              </Link>
            </div>
            <p className="text-xs text-muted-foreground">
              Human-reviewed · {criticalAlerts} critical · {openAlerts} unresolved
            </p>
          </CardHeader>
          <Separator />
          <CardContent className="p-0 flex-1">
            <ScrollArea className="h-[420px]">
              <div className="px-4 divide-y">
                {aiLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="py-3"><Skeleton className="h-12 w-full" /></div>
                  ))
                ) : aiQueue.length === 0 ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    No unresolved AI alerts.
                  </div>
                ) : aiQueue.map((a: any, i: number) => (
                  <AiAlertRow key={a.id ?? i} alert={a} />
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* ── Balance Alerts panel ──────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Wallet className="w-4 h-4 text-amber-500" />
              Balance Alerts
              {balAlerts.length > 0 && (
                <Badge variant={criticalBalAlerts > 0 ? "destructive" : "outline"} className="text-xs">
                  {balAlerts.length} active
                </Badge>
              )}
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={() => runAlertMutation.mutate()}
                disabled={runAlertMutation.isPending}
                data-testid="button-run-balance-check"
              >
                {runAlertMutation.isPending
                  ? <RefreshCw className="w-3 h-3 animate-spin" />
                  : <Play className="w-3 h-3" />
                }
                Run check
              </Button>
              <Link href="/balance">
                <Button variant="ghost" size="sm" className="h-7 text-xs gap-1">
                  Balance Monitor <ArrowRight className="w-3 h-3" />
                </Button>
              </Link>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Accounts below configured thresholds · auto-refreshes every 5 min
          </p>
        </CardHeader>
        <Separator />
        <CardContent className="p-0">
          {balAlertLoading ? (
            <div className="px-4 py-3 space-y-2">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : balAlerts.length === 0 ? (
            <div className="flex items-center gap-3 px-4 py-5 text-sm text-muted-foreground">
              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
              All monitored accounts are above their balance thresholds.
            </div>
          ) : (
            <ScrollArea className="max-h-[280px]">
              <div className="px-4 divide-y">
                {[...balAlerts]
                  .sort((a: any, b: any) => {
                    const rank: Record<string, number> = { critical: 0, urgent: 1, warning: 2 };
                    return (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3);
                  })
                  .map((a: any, i: number) => (
                    <BalanceAlertRow key={a.id ?? i} alert={a} />
                  ))
                }
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* ── Finance navigation shortcuts ──────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm text-muted-foreground uppercase tracking-wide font-medium">
            Finance Modules
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {[
              { href: "/invoices",               label: "Invoices" },
              { href: "/invoice-jobs",           label: "Invoice Queue" },
              { href: "/credit-notes",           label: "Credit Notes" },
              { href: "/billing-disputes",       label: "Disputes" },
              { href: "/dispute-cases",          label: "Dispute Cases" },
              { href: "/credit-control",         label: "Credit Control" },
              { href: "/client-reconciliation",  label: "Client Reconciliation" },
              { href: "/carrier-reconciliation", label: "Carrier Reconciliation" },
              { href: "/dmr",                    label: "Daily Minutes Report" },
              { href: "/ai-assurance",           label: "AI Assurance" },
              { href: "/margin-intelligence",    label: "Margin Intelligence" },
              { href: "/client-identity",        label: "Client Identity Map" },
              { href: "/executive-reports",      label: "Executive Reports" },
              { href: "/balance",                label: "Balance Monitor" },
            ].map(m => (
              <Link key={m.href} href={m.href}>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs h-8"
                  data-testid={`shortcut-${m.label.toLowerCase().replace(/\W+/g, "-")}`}
                >
                  {m.label}
                </Button>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  DollarSign, AlertTriangle, TrendingDown, TrendingUp,
  FileText, RefreshCw, ArrowRight, Scale,
  BarChart3, Activity, ShieldAlert, Clock,
  CheckCircle2, Bell, ReceiptText, Banknote, Plus,
} from "lucide-react";
import { Link } from "wouter";

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmt(n: number | undefined | null, prefix = "$") {
  if (n == null) return "—";
  return `${prefix}${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}
function fmtPct(n: number | undefined | null) {
  if (n == null) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}
function fmtDate(d: string | undefined | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ── KPI card ──────────────────────────────────────────────────────────────────
interface KpiCardProps {
  label: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  accent?: "default" | "warn" | "danger" | "ok";
  href?: string;
  testId?: string;
}
function KpiCard({ label, value, sub, icon: Icon, accent = "default", href, testId }: KpiCardProps) {
  const accentCls = {
    default: "text-primary",
    warn:    "text-amber-500",
    danger:  "text-red-500",
    ok:      "text-emerald-500",
  }[accent];

  const card = (
    <Card className="relative overflow-hidden hover:shadow-md transition-shadow">
      <CardContent className="pt-4 pb-3">
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
            <p className={`text-2xl font-bold mt-1 ${accentCls}`} data-testid={testId}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
          <div className={`p-2 rounded-lg bg-muted ${accentCls} shrink-0`}>
            <Icon className="w-4 h-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );

  if (href) return <Link href={href}>{card}</Link>;
  return card;
}

// ── Panel header ──────────────────────────────────────────────────────────────
function PanelHeader({ icon: Icon, iconCls, title, href }: {
  icon: React.ElementType; iconCls?: string; title: string; href?: string;
}) {
  return (
    <>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Icon className={`w-4 h-4 ${iconCls ?? "text-muted-foreground"}`} />
            {title}
          </CardTitle>
          {href && (
            <Link href={href}>
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1">
                View all <ArrowRight className="w-3 h-3" />
              </Button>
            </Link>
          )}
        </div>
      </CardHeader>
      <Separator />
    </>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────
function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 py-8 justify-center text-sm text-muted-foreground">
      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
      {message}
    </div>
  );
}

// ── Invoice row ───────────────────────────────────────────────────────────────
function InvoiceRow({ inv }: { inv: any }) {
  const statusColor: Record<string, string> = {
    paid:     "text-emerald-500",
    approved: "text-blue-500",
    sent:     "text-blue-400",
    overdue:  "text-red-500",
    void:     "text-muted-foreground",
    draft:    "text-muted-foreground",
  };
  const color = statusColor[inv.status] ?? "text-muted-foreground";
  return (
    <div className="flex items-center justify-between py-2 gap-2">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{inv.clientName ?? inv.accountName ?? `Invoice #${inv.id}`}</p>
        <p className="text-xs text-muted-foreground">{fmtDate(inv.createdAt ?? inv.issueDate)}</p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-medium">{fmt(inv.totalAmount ?? inv.amount)}</p>
        <Badge variant="outline" className={`text-xs ${color}`}>{inv.status}</Badge>
      </div>
    </div>
  );
}

// ── Reminder row ──────────────────────────────────────────────────────────────
function ReminderRow({ rem }: { rem: any }) {
  return (
    <div className="flex items-center justify-between py-2 gap-2">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{rem.clientName ?? rem.accountName ?? "Client"}</p>
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <Clock className="w-2.5 h-2.5" />
          {rem.nextSendAt ? fmtDate(rem.nextSendAt) : rem.template ?? "Payment reminder"}
        </p>
      </div>
      {rem.amount != null && (
        <p className="text-sm font-medium text-amber-500 shrink-0">{fmt(rem.amount)}</p>
      )}
    </div>
  );
}

// ── Margin alert row ──────────────────────────────────────────────────────────
function MarginAlertRow({ alert: a }: { alert: any }) {
  const severityColor: Record<string, string> = {
    critical: "text-red-500",
    high:     "text-orange-500",
    medium:   "text-amber-500",
    low:      "text-blue-400",
  };
  const color = severityColor[a.severity] ?? "text-muted-foreground";
  return (
    <div className="flex items-start justify-between py-2 gap-2">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{a.alertType ?? "Margin alert"}</p>
        <p className="text-xs text-muted-foreground line-clamp-1">
          {a.summary ?? a.message ?? a.affectedClient ?? ""}
        </p>
      </div>
      <div className="shrink-0 text-right">
        {a.marginDeltaPct != null && (
          <p className={`text-sm font-medium ${color}`}>{fmtPct(a.marginDeltaPct)}</p>
        )}
        <Badge
          variant={a.severity === "critical" ? "destructive" : "outline"}
          className="text-xs"
        >
          {a.severity ?? "info"}
        </Badge>
      </div>
    </div>
  );
}

// ── Reconciliation row ────────────────────────────────────────────────────────
function ReconRow({ row }: { row: any }) {
  const statusColor: Record<string, string> = {
    matched:      "text-emerald-500",
    reconciled:   "text-emerald-500",
    mismatch:     "text-red-500",
    pending:      "text-amber-500",
    in_progress:  "text-blue-400",
  };
  const color = statusColor[row.status] ?? "text-muted-foreground";
  return (
    <div className="flex items-center justify-between py-2 gap-2">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{row.clientName ?? row.accountName ?? "Client"}</p>
        <p className="text-xs text-muted-foreground">{row.period ?? fmtDate(row.createdAt)}</p>
      </div>
      <div className="shrink-0 text-right">
        {row.variancePct != null && (
          <p className={`text-sm font-medium ${Math.abs(row.variancePct) > 2 ? "text-red-500" : "text-emerald-500"}`}>
            {fmtPct(row.variancePct)}
          </p>
        )}
        <Badge variant="outline" className={`text-xs ${color}`}>{row.status ?? "pending"}</Badge>
      </div>
    </div>
  );
}

// ── Credit event row ──────────────────────────────────────────────────────────
function CreditEventRow({ event: ev }: { event: any }) {
  const isAlert = ["breach", "suspended"].includes(ev.eventType);
  return (
    <div className="flex items-center justify-between py-2 gap-2">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{ev.clientName ?? ev.accountName ?? "Client"}</p>
        <p className="text-xs text-muted-foreground">{fmtDate(ev.createdAt ?? ev.triggeredAt)}</p>
      </div>
      <Badge variant={isAlert ? "destructive" : "outline"} className="text-xs shrink-0">
        {ev.eventType ?? "event"}
      </Badge>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function FinanceCockpitPage() {

  // ── Data fetches ─────────────────────────────────────────────────────────────
  const { data: invoiceData,   isLoading: invLoading }    = useQuery<any>({ queryKey: ["/api/invoices"] });
  const { data: disputeData,   isLoading: dispLoading }   = useQuery<any>({ queryKey: ["/api/disputes"] });
  const { data: snapshotSummary, isLoading: snapLoading } = useQuery<any>({ queryKey: ["/api/finance/snapshot/summary"] });
  const { data: reconcData,    isLoading: reconLoading }  = useQuery<any>({ queryKey: ["/api/client-reconciliation"] });
  const { data: marginData,    isLoading: marginLoading } = useQuery<any>({ queryKey: ["/api/margin/alerts"] });
  const { data: remindersData, isLoading: remLoading }    = useQuery<any>({ queryKey: ["/api/payment-reminders"] });
  const { data: creditData,    isLoading: ccLoading }     = useQuery<any>({ queryKey: ["/api/credit-control/events"] });

  // ── Data normalization ────────────────────────────────────────────────────────
  const invoices     = invoiceData?.invoices        ?? invoiceData?.data     ?? [];
  const disputes     = disputeData?.disputes        ?? disputeData?.data     ?? [];
  const snapSummary  = snapshotSummary ?? null;
  const reconRows    = reconcData?.reconciliations  ?? reconcData?.data      ?? [];
  const marginAl     = marginData?.alerts           ?? marginData?.data      ?? [];
  const reminders    = remindersData?.reminders     ?? remindersData?.data   ?? (Array.isArray(remindersData) ? remindersData : []);
  const creditEvents = creditData?.events           ?? creditData?.data      ?? (Array.isArray(creditData)    ? creditData    : []);

  // ── KPI computations ──────────────────────────────────────────────────────────
  const nowDate    = new Date();
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);

  // Total Receivables: approved / sent / overdue invoices not yet collected
  const outstandingInvoices = invoices.filter((i: any) =>
    ["approved", "sent", "overdue"].includes(i.status)
  );
  const totalReceivables = outstandingInvoices.reduce(
    (s: number, i: any) => s + (i.totalAmount ?? i.amount ?? 0), 0
  );

  // Overdue Receivables: past due date and not settled
  const overdueInvoices = invoices.filter((i: any) => {
    if (["paid", "void", "cancelled", "draft"].includes(i.status)) return false;
    return i.dueDate && new Date(i.dueDate) < nowDate;
  });
  const overdueCount  = overdueInvoices.length;
  const overdueAmount = overdueInvoices.reduce((s: number, i: any) => s + (i.totalAmount ?? 0), 0);

  // Current Billing Period: revenue from latest financial snapshot (period-first)
  const currentPeriodRevenue = snapSummary?.totalRevenue ?? snapSummary?.revenue ?? 0;
  const currentPeriodLabel   = snapSummary?.reportDate
    ? new Date(snapSummary.reportDate).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    : 'Current Period';
  const invoicesReady = invoices.filter((i: any) => ['draft','generated','review','approved'].includes(i.status)).length;

  // Margin Alerts: unresolved
  const activeMarginAlerts = marginAl.filter((a: any) => !a.resolvedAt);
  const marginAlertCount   = activeMarginAlerts.length;
  const marginImpact       = activeMarginAlerts.reduce(
    (s: number, a: any) => s + Math.abs(a.marginDeltaUsd ?? a.amount ?? 0), 0
  );

  // Open Disputes
  const openDisputeCount = disputes.filter((d: any) => ["open", "escalated"].includes(d.status)).length;
  const disputedAmount   = disputes
    .filter((d: any) => ["open", "escalated"].includes(d.status))
    .reduce((s: number, d: any) => s + (d.amount ?? 0), 0);

  // Pending Reconciliations
  const pendingReconCount = reconRows.filter((r: any) =>
    !["matched", "reconciled", "closed", "approved"].includes(r.status)
  ).length;

  // ── Panel data ────────────────────────────────────────────────────────────────
  const recentInvoices = [...invoices]
    .sort((a: any, b: any) =>
      new Date(b.createdAt ?? b.issueDate ?? 0).getTime() -
      new Date(a.createdAt ?? a.issueDate ?? 0).getTime()
    )
    .slice(0, 6);

  const pendingReminders = [...reminders]
    .filter((r: any) => r.enabled !== false)
    .slice(0, 6);

  const activeMarginList = activeMarginAlerts.slice(0, 6);


  const recentRecon = [...reconRows].slice(0, 6);

  const recentCreditEvents = [...creditEvents]
    .sort((a: any, b: any) =>
      new Date(b.createdAt ?? b.triggeredAt ?? 0).getTime() -
      new Date(a.createdAt ?? a.triggeredAt ?? 0).getTime()
    )
    .slice(0, 6);

  const kpiLoading = invLoading || dispLoading || marginLoading || reconLoading;

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-primary" />
            Finance Cockpit
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            What does the Finance team need to act on right now?
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

      {/* ── Executive KPI Strip (6 cards) ───────────────────────────────────── */}
      {kpiLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="pt-4 pb-3"><Skeleton className="h-12 w-full" /></CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiCard
            label="Total Receivables"
            value={fmt(totalReceivables)}
            sub={`${outstandingInvoices.length} outstanding`}
            icon={DollarSign}
            accent="default"
            href="/invoices"
            testId="kpi-total-receivables"
          />
          <KpiCard
            label="Overdue Receivables"
            value={fmt(overdueAmount)}
            sub={overdueCount > 0 ? `${overdueCount} overdue` : "none overdue"}
            icon={AlertTriangle}
            accent={overdueCount > 5 ? "danger" : overdueCount > 0 ? "warn" : "ok"}
            href="/invoices"
            testId="kpi-overdue-receivables"
          />
          <KpiCard
            label="Current Billing Period"
            value={fmt(currentPeriodRevenue)}
            sub={invoicesReady > 0 ? `${invoicesReady} invoices ready` : currentPeriodLabel}
            icon={TrendingUp}
            accent={currentPeriodRevenue > 0 ? "ok" : "default"}
            href="/invoice-jobs"
            testId="kpi-current-period"
          />
          <KpiCard
            label="Margin Alerts"
            value={String(marginAlertCount)}
            sub={marginImpact > 0 ? `${fmt(marginImpact)} at risk` : "no active alerts"}
            icon={TrendingDown}
            accent={marginAlertCount > 0 ? "warn" : "ok"}
            href="/margin-intelligence"
            testId="kpi-margin-alerts"
          />
          <KpiCard
            label="Open Disputes"
            value={String(openDisputeCount)}
            sub={disputedAmount > 0 ? `${fmt(disputedAmount)} at risk` : "no open disputes"}
            icon={ShieldAlert}
            accent={openDisputeCount > 3 ? "danger" : openDisputeCount > 0 ? "warn" : "ok"}
            href="/billing-disputes"
            testId="kpi-open-disputes"
          />
          <KpiCard
            label="Pending Reconciliations"
            value={String(pendingReconCount)}
            sub={pendingReconCount > 0 ? "require action" : "all reconciled"}
            icon={Scale}
            accent={pendingReconCount > 3 ? "danger" : pendingReconCount > 0 ? "warn" : "ok"}
            href="/client-reconciliation"
            testId="kpi-pending-reconciliations"
          />
        </div>
      )}

      {/* ── Operational Work Queue (2 rows × 3 panels) ──────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

        {/* Panel 1 — Recent Invoices */}
        <Card className="flex flex-col">
          <PanelHeader icon={ReceiptText} iconCls="text-blue-500" title="Recent Invoices" href="/invoices" />
          <CardContent className="p-0 flex-1">
            <ScrollArea className="h-[280px]">
              <div className="px-4 divide-y">
                {invLoading
                  ? Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="py-3"><Skeleton className="h-8 w-full" /></div>
                    ))
                  : recentInvoices.length === 0
                  ? <EmptyState message="No invoices found." />
                  : recentInvoices.map((inv: any, i: number) => (
                      <InvoiceRow key={inv.id ?? i} inv={inv} />
                    ))
                }
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Panel 2 — Payment Reminders */}
        <Card className="flex flex-col">
          <PanelHeader icon={Bell} iconCls="text-amber-500" title="Payment Reminders" href="/payment-reminders" />
          <CardContent className="p-0 flex-1">
            <ScrollArea className="h-[280px]">
              <div className="px-4 divide-y">
                {remLoading
                  ? Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="py-3"><Skeleton className="h-8 w-full" /></div>
                    ))
                  : pendingReminders.length === 0
                  ? <EmptyState message="No pending reminders." />
                  : pendingReminders.map((r: any, i: number) => (
                      <ReminderRow key={r.id ?? i} rem={r} />
                    ))
                }
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Panel 3 — Margin Alerts */}
        <Card className="flex flex-col">
          <PanelHeader icon={TrendingDown} iconCls="text-orange-500" title="Margin Alerts" href="/margin-intelligence" />
          <CardContent className="p-0 flex-1">
            <ScrollArea className="h-[280px]">
              <div className="px-4 divide-y">
                {marginLoading
                  ? Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="py-3"><Skeleton className="h-8 w-full" /></div>
                    ))
                  : activeMarginList.length === 0
                  ? <EmptyState message="No active margin alerts." />
                  : activeMarginList.map((a: any, i: number) => (
                      <MarginAlertRow key={a.id ?? i} alert={a} />
                    ))
                }
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Panel 4 — Financial Snapshot */}
        <Card className="flex flex-col">
          <PanelHeader icon={Activity} iconCls="text-blue-400" title="Financial Snapshot" href="/finance-health" />
          <CardContent className="p-4 flex-1">
            {snapLoading
              ? Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="mb-3"><Skeleton className="h-6 w-full" /></div>
                ))
              : !snapSummary || snapSummary.latestDate === null
              ? <EmptyState message="No snapshot data yet. Materialization runs every 30 min." />
              : (
                <div className="space-y-3" data-testid="snapshot-summary-panel">
                  <div className="flex items-center justify-between text-xs text-muted-foreground pb-1 border-b">
                    <span>Date: <span className="font-medium text-foreground">{snapSummary.latestDate ?? "—"}</span></span>
                    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${snapSummary.lastRunStatus === 'success' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' : 'bg-amber-500/10 text-amber-400 border-amber-500/30'}`}>
                      {snapSummary.lastRunStatus ?? "pending"}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label: "Revenue", value: `$${(snapSummary.totalSell ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`, cls: "text-emerald-400" },
                      { label: "Cost",    value: `$${(snapSummary.totalBuy  ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`, cls: "text-red-400" },
                      { label: "Margin",  value: `$${(snapSummary.totalMargin ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`, cls: "text-blue-400" },
                      { label: "Margin%", value: `${(snapSummary.marginPercent ?? 0).toFixed(1)}%`, cls: "text-purple-400" },
                    ].map(({ label, value, cls }) => (
                      <div key={label} className="rounded bg-muted/40 px-2 py-1.5">
                        <p className="text-[10px] text-muted-foreground">{label}</p>
                        <p className={`text-sm font-semibold ${cls}`}>{value}</p>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
                    <span>{snapSummary.clientCount ?? 0} clients · {snapSummary.vendorCount ?? 0} vendors</span>
                    <span>{(snapSummary.totalCalls ?? 0).toLocaleString()} calls</span>
                  </div>
                </div>
              )
            }
          </CardContent>
        </Card>

        {/* Panel 5 — Client Reconciliation */}
        <Card className="flex flex-col">
          <PanelHeader icon={Scale} iconCls="text-emerald-500" title="Client Reconciliation" href="/client-reconciliation" />
          <CardContent className="p-0 flex-1">
            <ScrollArea className="h-[280px]">
              <div className="px-4 divide-y">
                {reconLoading
                  ? Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="py-3"><Skeleton className="h-8 w-full" /></div>
                    ))
                  : recentRecon.length === 0
                  ? <EmptyState message="No reconciliation records." />
                  : recentRecon.map((r: any, i: number) => (
                      <ReconRow key={r.id ?? i} row={r} />
                    ))
                }
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Panel 6 — Credit Control */}
        <Card className="flex flex-col">
          <PanelHeader icon={Banknote} iconCls="text-red-400" title="Credit Control" href="/credit-control" />
          <CardContent className="p-0 flex-1">
            <ScrollArea className="h-[280px]">
              <div className="px-4 divide-y">
                {ccLoading
                  ? Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="py-3"><Skeleton className="h-8 w-full" /></div>
                    ))
                  : recentCreditEvents.length === 0
                  ? <EmptyState message="No credit events." />
                  : recentCreditEvents.map((ev: any, i: number) => (
                      <CreditEventRow key={ev.id ?? i} event={ev} />
                    ))
                }
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

      </div>

      {/* ── Quick Actions ────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm text-muted-foreground uppercase tracking-wide font-medium">
            Quick Actions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Link href="/invoices">
              <Button variant="outline" size="sm" className="text-xs h-8 gap-1.5" data-testid="qa-create-invoice">
                <Plus className="w-3 h-3" /> Create Invoice
              </Button>
            </Link>
            <Link href="/billing-disputes">
              <Button variant="outline" size="sm" className="text-xs h-8 gap-1.5" data-testid="qa-view-disputes">
                <ShieldAlert className="w-3 h-3" /> View Disputes
              </Button>
            </Link>
            <Link href="/dmr">
              <Button variant="outline" size="sm" className="text-xs h-8 gap-1.5" data-testid="qa-run-dmr">
                <Activity className="w-3 h-3" /> Run DMR
              </Button>
            </Link>
            <Link href="/client-reconciliation">
              <Button variant="outline" size="sm" className="text-xs h-8 gap-1.5" data-testid="qa-open-reconciliation">
                <Scale className="w-3 h-3" /> Open Reconciliation
              </Button>
            </Link>
            <Link href="/invoice-templates">
              <Button variant="outline" size="sm" className="text-xs h-8 gap-1.5" data-testid="qa-finance-settings">
                <FileText className="w-3 h-3" /> Finance Settings
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>

    </div>
  );
}

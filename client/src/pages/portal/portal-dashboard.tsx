import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import PortalShell from "@/components/portal-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText, Shield, ReceiptText, BarChart2, TrendingUp, Clock } from "lucide-react";
import { Link } from "wouter";

interface PortalSummary {
  clientName: string;
  companyDisplayName?: string;
  invoices: { total: number; unpaid: number; totalAmountUsd: number };
  disputes: { total: number; open: number };
  creditNotes: { total: number; approved: number; totalCreditUsd: number };
  reconciliation: { lastPeriod?: string; status?: string; varianceUsd?: number };
}

export default function PortalDashboardPage() {
  const { data: summary, isLoading } = useQuery<PortalSummary>({
    queryKey: ["/api/portal/summary"],
    queryFn: () => apiRequest("GET", "/api/portal/summary").then(r => r.json()),
    refetchInterval: 60000,
  });

  const company = summary?.companyDisplayName ?? summary?.clientName ?? "Your Account";

  return (
    <PortalShell>
      <div className="p-6 space-y-6 max-w-5xl mx-auto">
        <div>
          <h1 className="text-2xl font-bold">Welcome, {company}</h1>
          <p className="text-muted-foreground text-sm mt-1">Account overview — all figures are read-only snapshots</p>
        </div>

        {/* Stat Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Link href="/portal/invoices">
            <a data-testid="stat-invoices">
              <Card className="hover:bg-muted/20 transition-colors cursor-pointer">
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center justify-between mb-2">
                    <FileText className="h-4 w-4 text-sky-400" />
                    {(summary?.invoices.unpaid ?? 0) > 0 && (
                      <Badge variant="outline" className="text-xs text-amber-400 border-amber-400/30">{summary!.invoices.unpaid} unpaid</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">Invoices</p>
                  <p className="text-2xl font-bold text-sky-400">{isLoading ? "…" : summary?.invoices.total ?? 0}</p>
                  {summary && summary.invoices.totalAmountUsd > 0 && (
                    <p className="text-xs text-muted-foreground mt-0.5">${summary.invoices.totalAmountUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                  )}
                </CardContent>
              </Card>
            </a>
          </Link>

          <Link href="/portal/disputes">
            <a data-testid="stat-disputes">
              <Card className="hover:bg-muted/20 transition-colors cursor-pointer">
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center justify-between mb-2">
                    <Shield className="h-4 w-4 text-orange-400" />
                    {(summary?.disputes.open ?? 0) > 0 && (
                      <Badge variant="outline" className="text-xs text-orange-400 border-orange-400/30">{summary!.disputes.open} open</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">Disputes</p>
                  <p className="text-2xl font-bold text-orange-400">{isLoading ? "…" : summary?.disputes.total ?? 0}</p>
                </CardContent>
              </Card>
            </a>
          </Link>

          <Link href="/portal/credit-notes">
            <a data-testid="stat-credit-notes">
              <Card className="hover:bg-muted/20 transition-colors cursor-pointer">
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center justify-between mb-2">
                    <ReceiptText className="h-4 w-4 text-emerald-400" />
                    {(summary?.creditNotes.approved ?? 0) > 0 && (
                      <Badge variant="outline" className="text-xs text-emerald-400 border-emerald-400/30">{summary!.creditNotes.approved} available</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">Credit Notes</p>
                  <p className="text-2xl font-bold text-emerald-400">{isLoading ? "…" : summary?.creditNotes.total ?? 0}</p>
                  {summary && summary.creditNotes.totalCreditUsd > 0 && (
                    <p className="text-xs text-muted-foreground mt-0.5">${summary.creditNotes.totalCreditUsd.toFixed(2)} credit</p>
                  )}
                </CardContent>
              </Card>
            </a>
          </Link>

          <Link href="/portal/reconciliation">
            <a data-testid="stat-reconciliation">
              <Card className="hover:bg-muted/20 transition-colors cursor-pointer">
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center justify-between mb-2">
                    <BarChart2 className="h-4 w-4 text-purple-400" />
                  </div>
                  <p className="text-xs text-muted-foreground">Reconciliation</p>
                  <p className="text-sm font-bold text-purple-400 mt-1">{isLoading ? "…" : summary?.reconciliation.lastPeriod ?? "—"}</p>
                  {summary?.reconciliation.status && (
                    <Badge variant="outline" className="text-xs mt-1">{summary.reconciliation.status}</Badge>
                  )}
                </CardContent>
              </Card>
            </a>
          </Link>
        </div>

        {/* Quick links */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Clock className="h-4 w-4" />Quick Access
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {[
                { href: "/portal/invoices",       icon: FileText,    label: "View all invoices",            sub: "Track invoice status and history" },
                { href: "/portal/disputes",        icon: Shield,      label: "Check dispute status",         sub: "View open and resolved disputes" },
                { href: "/portal/credit-notes",    icon: ReceiptText, label: "View credit notes",            sub: "Applied and available credits" },
                { href: "/portal/reconciliation",  icon: BarChart2,   label: "Reconciliation summaries",     sub: "Monthly billing reconciliation" },
              ].map(item => {
                const Icon = item.icon;
                return (
                  <Link key={item.href} href={item.href}>
                    <a className="flex items-start gap-3 p-3 rounded-lg border hover:bg-muted/30 transition-colors group">
                      <Icon className="h-5 w-5 text-muted-foreground group-hover:text-primary mt-0.5 shrink-0" />
                      <div>
                        <p className="text-sm font-medium">{item.label}</p>
                        <p className="text-xs text-muted-foreground">{item.sub}</p>
                      </div>
                    </a>
                  </Link>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <p className="text-xs text-center text-muted-foreground flex items-center justify-center gap-1.5">
          <TrendingUp className="h-3 w-3" />
          This portal is read-only. Contact your account manager for any changes or queries.
        </p>
      </div>
    </PortalShell>
  );
}

import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import PortalShell from "@/components/portal-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { BarChart2 } from "lucide-react";

interface PortalRecon {
  id: number; billingPeriod?: string; status: string; billedAmountUsd?: number;
  verifiedAmountUsd?: number; varianceUsd?: number; variancePct?: number; severity?: string; createdAt: string;
}

const STATUS_CFG: Record<string, string> = {
  pending:      "text-amber-400 border-amber-400/30",
  in_progress:  "text-sky-400 border-sky-400/30",
  reconciled:   "text-emerald-400 border-emerald-400/30",
  disputed:     "text-red-400 border-red-400/30",
  failed:       "text-red-400 border-red-400/30",
};

const SEVERITY_CFG: Record<string, string> = {
  low:      "text-sky-400 border-sky-400/30",
  medium:   "text-amber-400 border-amber-400/30",
  high:     "text-orange-400 border-orange-400/30",
  critical: "text-red-400 border-red-400/30",
};

export default function PortalReconciliationPage() {
  const { data: records = [], isLoading } = useQuery<PortalRecon[]>({
    queryKey: ["/api/portal/reconciliation"],
    queryFn: () => apiRequest("GET", "/api/portal/reconciliation").then(r => r.json()),
  });

  const lastReconciled = records.find(r => r.status === "reconciled");
  const totalVariance  = records.reduce((s, r) => s + Math.abs(r.varianceUsd ?? 0), 0);

  return (
    <PortalShell>
      <div className="p-6 space-y-5 max-w-5xl mx-auto">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2"><BarChart2 className="h-5 w-5 text-purple-400" />Reconciliation</h1>
          <p className="text-muted-foreground text-sm mt-1">Monthly billing reconciliation summaries</p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">Last Reconciled</p>
              <p className="text-lg font-bold text-purple-400">{lastReconciled?.billingPeriod ?? "—"}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">Total Records</p>
              <p className="text-2xl font-bold">{records.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">Total Variance</p>
              <p className={`text-2xl font-bold ${totalVariance > 0 ? "text-amber-400" : "text-emerald-400"}`}>
                ${totalVariance.toFixed(2)}
              </p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Billed</TableHead>
                  <TableHead>Verified</TableHead>
                  <TableHead>Variance</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
                )}
                {!isLoading && records.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-12">
                      <BarChart2 className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                      <p className="text-muted-foreground">No reconciliation records found</p>
                    </TableCell>
                  </TableRow>
                )}
                {records.map(r => (
                  <TableRow key={r.id} data-testid={`row-recon-${r.id}`}>
                    <TableCell className="font-medium">{r.billingPeriod ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-xs ${STATUS_CFG[r.status] ?? ""}`}>
                        {r.status.replace("_", " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="tabular-nums text-sm">
                      {r.billedAmountUsd != null ? `$${r.billedAmountUsd.toFixed(2)}` : "—"}
                    </TableCell>
                    <TableCell className="tabular-nums text-sm">
                      {r.verifiedAmountUsd != null ? `$${r.verifiedAmountUsd.toFixed(2)}` : "—"}
                    </TableCell>
                    <TableCell className={`tabular-nums text-sm font-medium ${Math.abs(r.varianceUsd ?? 0) > 0 ? "text-amber-400" : "text-emerald-400"}`}>
                      {r.varianceUsd != null ? `$${Math.abs(r.varianceUsd).toFixed(2)}` : "—"}
                      {r.variancePct != null && <span className="text-xs text-muted-foreground ml-1">({r.variancePct.toFixed(1)}%)</span>}
                    </TableCell>
                    <TableCell>
                      {r.severity ? (
                        <Badge variant="outline" className={`text-xs capitalize ${SEVERITY_CFG[r.severity] ?? ""}`}>{r.severity}</Badge>
                      ) : <span className="text-muted-foreground text-sm">—</span>}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(r.createdAt).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </PortalShell>
  );
}

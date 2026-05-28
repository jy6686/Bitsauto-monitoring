import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import PortalShell from "@/components/portal-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Search, FileText } from "lucide-react";

interface PortalInvoice {
  id: number; invoiceNumber: string; billingPeriod?: string; status: string;
  totalAmountUsd?: number; customerName?: string; issuedAt?: string; dueDate?: string;
  paidAt?: string;
}

const STATUS_CFG: Record<string, string> = {
  draft:     "text-slate-400 border-slate-400/30",
  review:    "text-amber-400 border-amber-400/30",
  approved:  "text-sky-400 border-sky-400/30",
  sent:      "text-blue-400 border-blue-400/30",
  paid:      "text-emerald-400 border-emerald-400/30",
  overdue:   "text-red-400 border-red-400/30",
  cancelled: "text-slate-500 border-slate-500/30",
};

export default function PortalInvoicesPage() {
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");

  const { data: invoices = [], isLoading } = useQuery<PortalInvoice[]>({
    queryKey: ["/api/portal/invoices"],
    queryFn: () => apiRequest("GET", "/api/portal/invoices").then(r => r.json()),
  });

  const filtered = invoices.filter(i => {
    const matchStatus = filterStatus === "all" || i.status === filterStatus;
    const matchSearch = !search ||
      (i.invoiceNumber ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (i.billingPeriod ?? "").includes(search);
    return matchStatus && matchSearch;
  });

  const totalUnpaid = invoices
    .filter(i => ["sent", "overdue"].includes(i.status))
    .reduce((s, i) => s + (i.totalAmountUsd ?? 0), 0);

  return (
    <PortalShell>
      <div className="p-6 space-y-5 max-w-5xl mx-auto">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2"><FileText className="h-5 w-5 text-sky-400" />Invoices</h1>
            {totalUnpaid > 0 && (
              <p className="text-sm text-amber-400 mt-0.5">${totalUnpaid.toFixed(2)} outstanding balance</p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative max-w-xs flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search invoices…" className="pl-8" value={search}
              onChange={e => setSearch(e.target.value)} data-testid="input-search" />
          </div>
          <div className="flex gap-1 flex-wrap">
            {["all", "sent", "paid", "overdue", "approved"].map(s => (
              <Button key={s} size="sm" variant={filterStatus === s ? "default" : "outline"} className="h-8 text-xs capitalize"
                onClick={() => setFilterStatus(s)}>{s}</Button>
            ))}
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Issued</TableHead>
                  <TableHead>Due Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
                )}
                {!isLoading && filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-12">
                      <FileText className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                      <p className="text-muted-foreground">No invoices found</p>
                    </TableCell>
                  </TableRow>
                )}
                {filtered.map(inv => (
                  <TableRow key={inv.id} data-testid={`row-invoice-${inv.id}`}
                    className={inv.status === "overdue" ? "bg-red-500/5" : ""}>
                    <TableCell className="font-mono text-sm font-medium">{inv.invoiceNumber}</TableCell>
                    <TableCell className="text-sm">{inv.billingPeriod ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-xs capitalize ${STATUS_CFG[inv.status] ?? ""}`}>
                        {inv.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium tabular-nums">
                      {inv.totalAmountUsd != null ? `$${inv.totalAmountUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {inv.issuedAt ? new Date(inv.issuedAt).toLocaleDateString() : "—"}
                    </TableCell>
                    <TableCell className={`text-sm ${inv.status === "overdue" ? "text-red-400 font-medium" : "text-muted-foreground"}`}>
                      {inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : "—"}
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

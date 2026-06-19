import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import PortalShell from "@/components/portal-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ReceiptText, TrendingDown } from "lucide-react";

interface PortalCreditNote {
  id: number; referenceId: string; creditType: string; amountUsd: number;
  reason?: string; status: string; issuedAt?: string; appliedAt?: string; createdAt: string;
}

const STATUS_CFG: Record<string, string> = {
  DRAFT:    "text-slate-400 border-slate-400/30",
  APPROVED: "text-amber-400 border-amber-400/30",
  APPLIED:  "text-emerald-400 border-emerald-400/30",
  VOID:     "text-red-400 border-red-400/30",
};

const TYPE_LABELS: Record<string, string> = {
  partial_credit: "Partial Credit",
  full_credit:    "Full Credit",
  write_off:      "Write-Off",
  debit_note:     "Debit Note",
  carry_forward:  "Carry Forward",
};

export default function PortalCreditNotesPage() {
  const { data: notes = [], isLoading } = useQuery<PortalCreditNote[]>({
    queryKey: ["/api/portal/credit-notes"],
    queryFn: () => apiRequest("GET", "/api/portal/credit-notes").then(r => r.json()),
  });

  const available = notes.filter(n => n.status === "APPROVED").reduce((s, n) => s + n.amountUsd, 0);
  const applied   = notes.filter(n => n.status === "APPLIED").reduce((s, n) => s + n.amountUsd, 0);

  return (
    <PortalShell>
      <div className="p-6 space-y-5 max-w-5xl mx-auto">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2"><ReceiptText className="h-5 w-5 text-emerald-400" />Credit Notes</h1>
          <p className="text-muted-foreground text-sm mt-1">Your credit balance and adjustment history</p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">Available Credit</p>
              <p className="text-2xl font-bold text-emerald-400">${available.toFixed(2)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">approved, not yet applied</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">Applied Credits</p>
              <p className="text-2xl font-bold text-sky-400">${applied.toFixed(2)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">settled against invoices</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">Total Notes</p>
              <p className="text-2xl font-bold">{notes.length}</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reference</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Issued</TableHead>
                  <TableHead>Applied</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
                )}
                {!isLoading && notes.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-12">
                      <ReceiptText className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                      <p className="text-muted-foreground">No credit notes on your account</p>
                    </TableCell>
                  </TableRow>
                )}
                {notes.map(n => (
                  <TableRow key={n.id} data-testid={`row-credit-note-${n.id}`}>
                    <TableCell className="font-mono text-sm font-medium">{n.referenceId}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{TYPE_LABELS[n.creditType] ?? n.creditType}</Badge>
                    </TableCell>
                    <TableCell className="font-medium tabular-nums text-emerald-400">${n.amountUsd.toFixed(2)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[180px]">
                      <p className="truncate">{n.reason ?? "—"}</p>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-xs ${STATUS_CFG[n.status] ?? ""}`}>{n.status}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {n.issuedAt ? new Date(n.issuedAt).toLocaleDateString() : "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {n.appliedAt ? new Date(n.appliedAt).toLocaleDateString() : "—"}
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

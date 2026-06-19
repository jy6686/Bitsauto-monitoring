import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  BookOpen, DollarSign, TrendingUp, TrendingDown, Plus, ArrowUpRight, ArrowDownLeft,
  FileText, CreditCard, FileSpreadsheet,
} from "lucide-react";
import { exportToExcel } from "@/lib/export-excel";

interface Company { id: number; name: string; shortCode: string; }
interface LedgerEntry {
  id:          number;
  type:        "invoice" | "payment";
  date:        string;
  description: string;
  debit:       number;
  credit:      number;
  balance:     number;
  status:      string;
  reference?:  string;
}
interface StatementData {
  company:     Company;
  entries:     LedgerEntry[];
  totalDebit:  number;
  totalCredit: number;
  balance:     number;
}
interface Payment {
  id: number; companyId: number | null; companyName: string | null;
  invoiceId: number | null; amount: number; currency: string;
  paymentDate: string; paymentMethod: string | null; reference: string | null;
  notes: string | null; status: string; createdAt: string;
}

const METHODS = ["bank_transfer", "credit_card", "cheque", "cash", "wire", "other"];

function toISO(d: Date) { return d.toISOString().slice(0, 10); }

export default function AccountStatementPage() {
  const { toast }   = useToast();
  const queryClient = useQueryClient();

  const [companyId, setCompanyId] = useState("");
  const [showAddPayment, setShowAddPayment] = useState(false);
  const [payForm, setPayForm] = useState({
    amount: "", currency: "USD", paymentDate: toISO(new Date()),
    paymentMethod: "bank_transfer", reference: "", notes: "",
  });

  const { data: companies = [] } = useQuery<Company[]>({
    queryKey: ["/api/companies"],
    queryFn: () => apiRequest("GET", "/api/companies").then(r => r.json()).then((d: any) => d.companies ?? []),
    staleTime: 60_000,
  });

  const { data: statement, isLoading } = useQuery<StatementData>({
    queryKey: ["/api/billing/account-statement", companyId],
    queryFn: () => apiRequest("GET", `/api/billing/account-statement?companyId=${companyId}`).then(r => r.json()),
    enabled: !!companyId,
    staleTime: 30_000,
  });

  const addPayment = useMutation({
    mutationFn: () => apiRequest("POST", "/api/payments", {
      companyId:     Number(companyId),
      companyName:   companies.find(c => String(c.id) === companyId)?.name ?? "",
      amount:        parseFloat(payForm.amount),
      currency:      payForm.currency,
      paymentDate:   payForm.paymentDate,
      paymentMethod: payForm.paymentMethod,
      reference:     payForm.reference || null,
      notes:         payForm.notes || null,
      status:        "received",
    }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/billing/account-statement"] });
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
      setShowAddPayment(false);
      setPayForm({ amount: "", currency: "USD", paymentDate: toISO(new Date()), paymentMethod: "bank_transfer", reference: "", notes: "" });
      toast({ title: "Payment recorded" });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const selectedCompany = companies.find(c => String(c.id) === companyId);

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BookOpen className="h-6 w-6 text-primary" />
            Account Statement
          </h1>
          <p className="text-muted-foreground mt-1">Running ledger — invoices issued and payments received per client.</p>
        </div>
        {companyId && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              data-testid="button-export-statement"
              onClick={() => {
                const entries = statement?.entries ?? [];
                const rows = entries.map(e => ({
                  "Date":        e.date,
                  "Description": e.description,
                  "Type":        e.type,
                  "Debit ($)":   e.debit  > 0 ? e.debit.toFixed(4)  : "",
                  "Credit ($)":  e.credit > 0 ? e.credit.toFixed(4) : "",
                  "Balance ($)": e.balance.toFixed(4),
                  "Status":      e.status,
                  "Reference":   e.reference ?? "",
                }));
                const company = statement?.company?.name ?? companyId;
                exportToExcel([{ name: "Statement", rows }], `Statement-${company}-${new Date().toISOString().slice(0,10)}`);
              }}
              disabled={!statement || statement.entries.length === 0}
            >
              <FileSpreadsheet className="h-4 w-4 mr-2" />Export
            </Button>
            <Button data-testid="button-add-payment" onClick={() => setShowAddPayment(true)}>
              <Plus className="h-4 w-4 mr-2" />Record Payment
            </Button>
          </div>
        )}
      </div>

      {/* Company picker */}
      <Card>
        <CardContent className="pt-4">
          <Label className="text-xs mb-1.5 block">Select Client</Label>
          <Select value={companyId} onValueChange={setCompanyId}>
            <SelectTrigger data-testid="select-statement-company" className="max-w-sm">
              <SelectValue placeholder="Choose a client company…" />
            </SelectTrigger>
            <SelectContent>
              {companies.map(c => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.name} <span className="text-muted-foreground text-xs ml-1">({c.shortCode})</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {companyId && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {[
              { label: "Total Invoiced",  value: `$${(statement?.totalDebit ?? 0).toFixed(2)}`,  icon: <TrendingUp className="h-4 w-4 text-red-400" /> },
              { label: "Total Received",  value: `$${(statement?.totalCredit ?? 0).toFixed(2)}`, icon: <TrendingDown className="h-4 w-4 text-emerald-400" /> },
              { label: "Outstanding",     value: `$${(statement?.balance ?? 0).toFixed(2)}`,     icon: <DollarSign className="h-4 w-4 text-amber-400" /> },
            ].map(s => (
              <Card key={s.label}>
                <CardContent className="pt-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{s.label}</span>
                    {s.icon}
                  </div>
                  <p className="text-2xl font-bold mt-1 font-mono">{s.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Ledger */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                Ledger — {selectedCompany?.name}
              </CardTitle>
              <CardDescription className="text-xs">
                All invoices (debits) and payments (credits) in chronological order
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="text-center py-8 text-muted-foreground">Loading…</div>
              ) : !statement?.entries?.length ? (
                <div className="text-center py-10 text-muted-foreground">
                  <BookOpen className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p>No transactions yet for this client.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Reference</TableHead>
                        <TableHead className="text-right">Debit</TableHead>
                        <TableHead className="text-right">Credit</TableHead>
                        <TableHead className="text-right">Balance</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {statement.entries.map(e => (
                        <TableRow key={`${e.type}-${e.id}`} data-testid={`row-ledger-${e.type}-${e.id}`}>
                          <TableCell className="font-mono text-xs">{e.date}</TableCell>
                          <TableCell>
                            {e.type === "invoice"
                              ? <span className="flex items-center gap-1 text-xs text-red-400"><ArrowUpRight className="h-3 w-3" />Invoice</span>
                              : <span className="flex items-center gap-1 text-xs text-emerald-400"><ArrowDownLeft className="h-3 w-3" />Payment</span>
                            }
                          </TableCell>
                          <TableCell className="text-sm max-w-48 truncate">{e.description}</TableCell>
                          <TableCell className="text-xs text-muted-foreground font-mono">{e.reference ?? "—"}</TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {e.debit > 0 ? <span className="text-red-400">${e.debit.toFixed(2)}</span> : "—"}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {e.credit > 0 ? <span className="text-emerald-400">${e.credit.toFixed(2)}</span> : "—"}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm font-semibold">
                            <span className={e.balance > 0 ? "text-amber-400" : "text-emerald-400"}>
                              ${e.balance.toFixed(2)}
                            </span>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs capitalize">{e.status}</Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Add Payment dialog */}
      <Dialog open={showAddPayment} onOpenChange={setShowAddPayment}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" /> Record Payment
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs mb-1.5 block">Amount (USD)</Label>
                <Input
                  data-testid="input-payment-amount"
                  type="number"
                  step="0.01"
                  value={payForm.amount}
                  onChange={e => setPayForm(f => ({ ...f, amount: e.target.value }))}
                  placeholder="0.00"
                />
              </div>
              <div>
                <Label className="text-xs mb-1.5 block">Payment Date</Label>
                <Input
                  data-testid="input-payment-date"
                  type="date"
                  value={payForm.paymentDate}
                  onChange={e => setPayForm(f => ({ ...f, paymentDate: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Method</Label>
              <Select value={payForm.paymentMethod} onValueChange={v => setPayForm(f => ({ ...f, paymentMethod: v }))}>
                <SelectTrigger data-testid="select-payment-method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {METHODS.map(m => (
                    <SelectItem key={m} value={m}>{m.replace("_", " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Reference / Transaction ID</Label>
              <Input
                data-testid="input-payment-reference"
                value={payForm.reference}
                onChange={e => setPayForm(f => ({ ...f, reference: e.target.value }))}
                placeholder="Bank ref, wire ID, cheque #…"
              />
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Notes</Label>
              <Textarea
                data-testid="input-payment-notes"
                value={payForm.notes}
                onChange={e => setPayForm(f => ({ ...f, notes: e.target.value }))}
                rows={2}
                placeholder="Optional notes…"
              />
            </div>
            <Button
              data-testid="button-save-payment"
              className="w-full"
              onClick={() => addPayment.mutate()}
              disabled={!payForm.amount || !payForm.paymentDate || addPayment.isPending}
            >
              {addPayment.isPending ? "Saving…" : "Record Payment"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

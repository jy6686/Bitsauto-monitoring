import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { FileText, Play, Eye, CheckCircle, AlertTriangle, DollarSign, Hash } from "lucide-react";

interface Invoice {
  id:              number;
  invoiceNumber:   string;
  iTariff?:        string;
  customerName?:   string;
  periodStart?:    string;
  periodEnd?:      string;
  totalReproduced?: number;
  totalActual?:    number;
  totalDelta?:     number;
  lineCount?:      number;
  status:          string;
  generatedAt?:    string;
  approvedAt?:     string;
  sentAt?:         string;
  notes?:          string;
  htmlContent?:    string;
  createdAt:       string;
}

interface SippyTariff { iTariff: string | number; name: string; }

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, string> = {
    draft:    "bg-slate-500/15 text-slate-400 border-slate-500/30",
    review:   "bg-blue-500/15 text-blue-400 border-blue-500/30",
    approved: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    sent:     "bg-green-500/15 text-green-400 border-green-500/30",
    void:     "bg-red-500/15 text-red-400 border-red-500/30",
  };
  return (
    <Badge variant="outline" className={`capitalize text-xs ${cfg[status] ?? cfg.draft}`}>
      {status}
    </Badge>
  );
}

export default function InvoicesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [showGenerate, setShowGenerate]     = useState(false);
  const [previewId, setPreviewId]           = useState<number | null>(null);
  const [approveId, setApproveId]           = useState<number | null>(null);
  const [filterStatus, setFilterStatus]     = useState("all");
  const [form, setForm] = useState({
    iTariff: "", customerName: "", periodStart: "", periodEnd: "", notes: "",
  });

  const { data: tariffs = [] } = useQuery<SippyTariff[]>({ queryKey: ["/api/sippy/tariffs"] });

  const { data: invoices = [], isLoading } = useQuery<Invoice[]>({
    queryKey: ["/api/invoices", filterStatus],
    queryFn: () => {
      const params = new URLSearchParams();
      if (filterStatus !== "all") params.set("status", filterStatus);
      return apiRequest("GET", `/api/invoices?${params}`).then(r => r.json());
    },
  });

  const { data: preview } = useQuery<Invoice>({
    queryKey: ["/api/invoices", previewId],
    queryFn: () => apiRequest("GET", `/api/invoices/${previewId}`).then(r => r.json()),
    enabled: previewId != null,
  });

  const generateMutation = useMutation({
    mutationFn: (data: typeof form) => apiRequest("POST", "/api/invoices/generate", data).then(r => r.json()),
    onSuccess: (data: { invoice: Invoice; lineCount: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      setShowGenerate(false);
      setPreviewId(data.invoice.id);
      toast({ title: `Invoice ${data.invoice.invoiceNumber} generated (DRAFT)`, description: `${data.lineCount} line items from locked snapshots.` });
    },
    onError: (err: any) => {
      toast({ title: "Generation failed", description: err.message, variant: "destructive" });
    },
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/invoices/${id}/approve`).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      setApproveId(null);
      toast({ title: "Invoice approved" });
    },
    onError: (err: any) => {
      toast({ title: "Approval failed", description: err.message, variant: "destructive" });
    },
  });

  const stats = {
    total:    invoices.length,
    draft:    invoices.filter(i => i.status === 'draft').length,
    approved: invoices.filter(i => i.status === 'approved').length,
    totalValue: invoices.reduce((s, i) => s + (i.totalReproduced ?? 0), 0),
  };

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileText className="h-6 w-6 text-primary" />
            Invoices
          </h1>
          <p className="text-muted-foreground mt-1">
            Invoice engine sourced exclusively from immutable rating snapshots. Draft → Review → Approve → Send.
          </p>
        </div>
        <Button data-testid="button-generate-invoice" onClick={() => setShowGenerate(true)}>
          <Play className="h-4 w-4 mr-2" />Generate Invoice
        </Button>
      </div>

      {/* Warning banner for draft mode */}
      <div className="flex items-start gap-3 bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
        <AlertTriangle className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-amber-400">Draft Mode — Finance Review Required</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            All invoices start as DRAFT. Finance approval is required before sending. Never auto-send on first deploy.
            Invoices source exclusively from locked immutable snapshots.
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total Invoices", value: stats.total,    icon: <Hash className="h-4 w-4 text-blue-400" /> },
          { label: "Draft",          value: stats.draft,    icon: <FileText className="h-4 w-4 text-slate-400" /> },
          { label: "Approved",       value: stats.approved, icon: <CheckCircle className="h-4 w-4 text-emerald-400" /> },
          { label: "Total Value",    value: `$${stats.totalValue.toFixed(2)}`, icon: <DollarSign className="h-4 w-4 text-slate-400" /> },
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

      {/* Invoice list */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-base">Invoice Register</CardTitle>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger data-testid="select-filter-status" className="w-36 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["all","draft","review","approved","sent","void"].map(s => (
                  <SelectItem key={s} value={s}>{s === "all" ? "All statuses" : s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <CardDescription className="text-xs">{invoices.length} invoice(s)</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading…</div>
          ) : invoices.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <FileText className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p>No invoices yet. Generate one from locked rating snapshots.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead>Lines</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map(inv => (
                    <TableRow key={inv.id} data-testid={`row-invoice-${inv.id}`}>
                      <TableCell className="font-mono text-sm">{inv.invoiceNumber}</TableCell>
                      <TableCell className="text-sm">{inv.customerName ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground font-mono">
                        {inv.periodStart ?? "—"} → {inv.periodEnd ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm">{inv.lineCount?.toLocaleString() ?? "—"}</TableCell>
                      <TableCell className="font-mono text-sm">
                        ${(inv.totalReproduced ?? 0).toFixed(4)}
                      </TableCell>
                      <TableCell><StatusBadge status={inv.status} /></TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            data-testid={`button-view-${inv.id}`}
                            variant="ghost" size="sm"
                            onClick={() => setPreviewId(inv.id)}
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          {(inv.status === 'draft' || inv.status === 'review') && (
                            <Button
                              data-testid={`button-approve-${inv.id}`}
                              variant="ghost" size="sm"
                              onClick={() => setApproveId(inv.id)}
                            >
                              <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Generate dialog */}
      <Dialog open={showGenerate} onOpenChange={setShowGenerate}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Generate Invoice</DialogTitle>
            <DialogDescription>
              Creates a DRAFT invoice from locked immutable rating snapshots. Never sources live tariffs.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs mb-1.5 block">Tariff</Label>
              <Select
                value={form.iTariff}
                onValueChange={v => {
                  const t = tariffs.find(x => String(x.iTariff) === v);
                  setForm(f => ({ ...f, iTariff: v, customerName: t ? t.name : f.customerName }));
                }}
              >
                <SelectTrigger data-testid="select-inv-tariff">
                  <SelectValue placeholder="Select tariff" />
                </SelectTrigger>
                <SelectContent>
                  {tariffs.map(t => (
                    <SelectItem key={String(t.iTariff)} value={String(t.iTariff)}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Customer Name</Label>
              <Input
                data-testid="input-customer-name"
                value={form.customerName}
                onChange={e => setForm(f => ({ ...f, customerName: e.target.value }))}
                placeholder="Auto-filled from tariff, or type manually"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs mb-1.5 block">Period Start</Label>
                <Input
                  data-testid="input-period-start"
                  type="date"
                  value={form.periodStart}
                  onChange={e => setForm(f => ({ ...f, periodStart: e.target.value }))}
                />
              </div>
              <div>
                <Label className="text-xs mb-1.5 block">Period End</Label>
                <Input
                  data-testid="input-period-end"
                  type="date"
                  value={form.periodEnd}
                  onChange={e => setForm(f => ({ ...f, periodEnd: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Notes (optional)</Label>
              <Input
                data-testid="input-notes"
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Payment terms, references…"
              />
            </div>
            <Button
              data-testid="button-confirm-generate"
              className="w-full"
              onClick={() => generateMutation.mutate(form)}
              disabled={generateMutation.isPending || !form.iTariff || !form.periodStart || !form.periodEnd}
            >
              {generateMutation.isPending ? "Generating…" : "Generate Draft Invoice"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Preview dialog */}
      <Dialog open={previewId != null} onOpenChange={open => !open && setPreviewId(null)}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>{preview?.invoiceNumber ?? "Invoice"}</DialogTitle>
            {preview && <StatusBadge status={preview.status} />}
          </DialogHeader>
          <div className="flex-1 overflow-auto rounded border border-border">
            {preview?.htmlContent ? (
              <iframe
                data-testid="iframe-invoice-preview"
                srcDoc={preview.htmlContent}
                className="w-full min-h-[600px]"
                title="Invoice Preview"
                sandbox="allow-same-origin"
              />
            ) : (
              <div className="text-center py-10 text-muted-foreground">Loading invoice…</div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Approve confirm */}
      <AlertDialog open={approveId != null} onOpenChange={open => !open && setApproveId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve Invoice?</AlertDialogTitle>
            <AlertDialogDescription>
              This marks the invoice as approved. It will not be sent automatically — you will need to trigger delivery separately.
              Approved invoices cannot be reverted to draft.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-approve"
              onClick={() => approveId && approveMutation.mutate(approveId)}
            >
              Approve Invoice
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

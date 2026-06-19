import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FileText, Plus, Pencil, Trash2, RefreshCw, CheckCircle2, Clock, AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

interface BillingDispute {
  id: number;
  vendorName: string;
  periodStart: string;
  periodEnd: string;
  ourAmount: number;
  vendorAmount: number;
  discrepancy: number;
  currency: string;
  status: "open" | "under_review" | "resolved";
  resolution: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

const STATUS_LABELS: Record<string, { label: string; cls: string; icon: any }> = {
  open:         { label: "Open",         cls: "bg-rose-500/15 text-rose-400 border-rose-500/25",   icon: AlertTriangle },
  under_review: { label: "Under Review", cls: "bg-amber-500/15 text-amber-400 border-amber-500/25", icon: Clock },
  resolved:     { label: "Resolved",     cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25", icon: CheckCircle2 },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_LABELS[status] ?? STATUS_LABELS.open;
  const Icon = cfg.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border", cfg.cls)}>
      <Icon className="w-3 h-3" />{cfg.label}
    </span>
  );
}

function fmt(n: number, currency = "USD") {
  return `${currency} ${n.toFixed(2)}`;
}

const EMPTY_FORM = {
  vendorName: "", periodStart: "", periodEnd: "",
  ourAmount: "", vendorAmount: "", currency: "USD",
  status: "open", resolution: "", notes: "",
};

function DisputeModal({ dispute, onClose }: { dispute?: BillingDispute | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState(dispute ? {
    vendorName:   dispute.vendorName,
    periodStart:  dispute.periodStart.slice(0, 10),
    periodEnd:    dispute.periodEnd.slice(0, 10),
    ourAmount:    String(dispute.ourAmount),
    vendorAmount: String(dispute.vendorAmount),
    currency:     dispute.currency,
    status:       dispute.status,
    resolution:   dispute.resolution != null ? String(dispute.resolution) : "",
    notes:        dispute.notes ?? "",
  } : { ...EMPTY_FORM });

  const f = (k: string) => (e: any) => setForm(p => ({ ...p, [k]: e.target.value }));

  const isEdit = !!dispute;

  const mutation = useMutation({
    mutationFn: (body: any) => isEdit
      ? apiRequest("PATCH", `/api/disputes/${dispute!.id}`, body)
      : apiRequest("POST", "/api/disputes", body),
    onSuccess: () => {
      toast({ title: isEdit ? "Dispute updated" : "Dispute created" });
      qc.invalidateQueries({ queryKey: ["/api/disputes"] });
      onClose();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function handleSubmit() {
    if (!form.vendorName || !form.periodStart || !form.periodEnd) {
      toast({ title: "Fill in vendor name and period dates", variant: "destructive" }); return;
    }
    mutation.mutate({
      vendorName:   form.vendorName,
      periodStart:  form.periodStart,
      periodEnd:    form.periodEnd,
      ourAmount:    Number(form.ourAmount || 0),
      vendorAmount: Number(form.vendorAmount || 0),
      currency:     form.currency,
      status:       form.status,
      resolution:   form.resolution ? Number(form.resolution) : null,
      notes:        form.notes || null,
    });
  }

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{isEdit ? "Edit Dispute" : "New Billing Dispute"}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label className="text-xs mb-1 block">Vendor Name</Label>
            <Input data-testid="input-dispute-vendor" placeholder="e.g. Carrier ABC" value={form.vendorName} onChange={f("vendorName")} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs mb-1 block">Period Start</Label>
              <Input type="date" data-testid="input-dispute-start" value={form.periodStart} onChange={f("periodStart")} />
            </div>
            <div>
              <Label className="text-xs mb-1 block">Period End</Label>
              <Input type="date" data-testid="input-dispute-end" value={form.periodEnd} onChange={f("periodEnd")} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs mb-1 block">Our Amount</Label>
              <Input type="number" step="0.01" data-testid="input-dispute-our" placeholder="0.00" value={form.ourAmount} onChange={f("ourAmount")} />
            </div>
            <div>
              <Label className="text-xs mb-1 block">Vendor Amount</Label>
              <Input type="number" step="0.01" data-testid="input-dispute-vendor-amount" placeholder="0.00" value={form.vendorAmount} onChange={f("vendorAmount")} />
            </div>
            <div>
              <Label className="text-xs mb-1 block">Currency</Label>
              <Input data-testid="input-dispute-currency" placeholder="USD" value={form.currency} onChange={f("currency")} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs mb-1 block">Status</Label>
              <Select value={form.status} onValueChange={v => setForm(p => ({ ...p, status: v }))}>
                <SelectTrigger data-testid="select-dispute-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="under_review">Under Review</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.status === "resolved" && (
              <div>
                <Label className="text-xs mb-1 block">Settlement Amount</Label>
                <Input type="number" step="0.01" data-testid="input-dispute-resolution" placeholder="0.00" value={form.resolution} onChange={f("resolution")} />
              </div>
            )}
          </div>
          <div>
            <Label className="text-xs mb-1 block">Notes</Label>
            <Textarea data-testid="input-dispute-notes" placeholder="Notes, reference numbers, CDR ranges…" value={form.notes} onChange={f("notes")} rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}><X className="w-4 h-4 mr-1" />Cancel</Button>
          <Button onClick={handleSubmit} disabled={mutation.isPending} data-testid="button-dispute-save">
            {mutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : null}
            {isEdit ? "Save Changes" : "Create Dispute"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function BillingDisputesPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing]   = useState<BillingDispute | null>(null);

  const { data: disputes = [], isLoading } = useQuery<BillingDispute[]>({
    queryKey: ["/api/disputes"],
    staleTime: 5 * 60_000,
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/disputes/${id}`),
    onSuccess: () => { toast({ title: "Dispute deleted" }); qc.invalidateQueries({ queryKey: ["/api/disputes"] }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const totalDiscrepancy = disputes.reduce((s, d) => s + d.discrepancy, 0);
  const openCount        = disputes.filter(d => d.status === "open").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <FileText className="w-6 h-6 text-amber-400" />
            <h2 className="text-2xl font-bold tracking-tight">Billing Dispute Tracker</h2>
          </div>
          <p className="text-muted-foreground text-sm mt-1">Track CDR discrepancies between your Sippy billing and vendor invoices</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ["/api/disputes"] })} disabled={isLoading} data-testid="button-refresh-disputes">
            <RefreshCw className={cn("w-4 h-4 mr-2", isLoading && "animate-spin")} />Refresh
          </Button>
          <Button size="sm" onClick={() => { setEditing(null); setShowModal(true); }} data-testid="button-new-dispute">
            <Plus className="w-4 h-4 mr-2" />New Dispute
          </Button>
        </div>
      </div>

      {/* Summary */}
      {disputes.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-xl border border-border/50 bg-card p-4">
            <p className="text-xs text-muted-foreground">Total Disputes</p>
            <p className="text-2xl font-bold mt-1" data-testid="text-total-disputes">{disputes.length}</p>
          </div>
          <div className="rounded-xl border border-rose-500/25 bg-rose-500/5 p-4">
            <p className="text-xs text-muted-foreground">Open</p>
            <p className="text-2xl font-bold text-rose-400 mt-1" data-testid="text-open-disputes">{openCount}</p>
          </div>
          <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4">
            <p className="text-xs text-muted-foreground">Total Discrepancy (USD)</p>
            <p className={cn("text-2xl font-bold font-mono mt-1", totalDiscrepancy > 0 ? "text-amber-400" : totalDiscrepancy < 0 ? "text-rose-400" : "text-muted-foreground")} data-testid="text-total-discrepancy">
              {totalDiscrepancy >= 0 ? "+" : ""}{totalDiscrepancy.toFixed(2)}
            </p>
          </div>
        </div>
      )}

      {isLoading && <div className="flex items-center justify-center h-32 text-muted-foreground"><RefreshCw className="w-5 h-5 animate-spin mr-2" />Loading…</div>}

      {!isLoading && disputes.length === 0 && (
        <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2">
          <FileText className="w-10 h-10 opacity-30" />
          <p>No disputes logged yet. Click "New Dispute" to log a discrepancy.</p>
        </div>
      )}

      {!isLoading && disputes.length > 0 && (
        <div className="rounded-xl border border-border/50 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-border/50 bg-muted/10">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">Vendor</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">Period</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground">Our Amount</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground">Vendor Amount</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground">Discrepancy</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">Notes</th>
                <th className="px-4 py-3 text-xs font-semibold text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {disputes.map((d, i) => (
                <tr key={d.id} className={cn("border-b border-border/30 hover:bg-muted/10", i % 2 === 0 ? "" : "bg-muted/5")} data-testid={`row-dispute-${d.id}`}>
                  <td className="px-4 py-3 font-medium">{d.vendorName}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {d.periodStart.slice(0, 10)} → {d.periodEnd.slice(0, 10)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs">{fmt(d.ourAmount, d.currency)}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs">{fmt(d.vendorAmount, d.currency)}</td>
                  <td className={cn("px-4 py-3 text-right font-mono font-semibold text-xs", d.discrepancy > 0 ? "text-emerald-400" : d.discrepancy < 0 ? "text-rose-400" : "text-muted-foreground")}>
                    {d.discrepancy >= 0 ? "+" : ""}{d.discrepancy.toFixed(2)}
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={d.status} /></td>
                  <td className="px-4 py-3 text-xs text-muted-foreground max-w-[200px] truncate" title={d.notes ?? undefined}>{d.notes || "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="w-7 h-7" onClick={() => { setEditing(d); setShowModal(true); }} data-testid={`button-edit-dispute-${d.id}`}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="w-7 h-7 text-rose-400 hover:text-rose-300" onClick={() => { if (confirm("Delete this dispute?")) deleteMut.mutate(d.id); }} data-testid={`button-delete-dispute-${d.id}`}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && <DisputeModal dispute={editing} onClose={() => { setShowModal(false); setEditing(null); }} />}
    </div>
  );
}

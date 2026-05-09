import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layers, Plus, Trash2, Edit2, CheckCircle2, XCircle, DollarSign, Users, TrendingUp, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

interface Reseller {
  id: number;
  name: string;
  contactEmail: string | null;
  markupPercent: number;
  iCustomer: number | null;
  brandName: string | null;
  active: boolean;
  notes: string | null;
  createdAt: string;
}

const EMPTY_FORM = { name: '', contactEmail: '', markupPercent: 10, iCustomer: '', brandName: '', notes: '' };

export default function ResellerPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showDialog, setShowDialog] = useState(false);
  const [editing, setEditing] = useState<Reseller | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  const { data: resellers = [], isLoading } = useQuery<Reseller[]>({
    queryKey: ['/api/resellers'],
    staleTime: 30000,
  });

  function openCreate() { setEditing(null); setForm({ ...EMPTY_FORM }); setShowDialog(true); }
  function openEdit(r: Reseller) {
    setEditing(r);
    setForm({ name: r.name, contactEmail: r.contactEmail ?? '', markupPercent: r.markupPercent, iCustomer: r.iCustomer ? String(r.iCustomer) : '', brandName: r.brandName ?? '', notes: r.notes ?? '' });
    setShowDialog(true);
  }

  const saveMutation = useMutation({
    mutationFn: (body: typeof form) => {
      const payload = { ...body, iCustomer: body.iCustomer ? Number(body.iCustomer) : null };
      return editing
        ? apiRequest('PATCH', `/api/resellers/${editing.id}`, payload)
        : apiRequest('POST', '/api/resellers', payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/resellers'] });
      setShowDialog(false);
      toast({ title: editing ? "Reseller updated" : "Reseller created", description: form.name });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) => apiRequest('PATCH', `/api/resellers/${id}`, { active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/api/resellers'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/resellers/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['/api/resellers'] }); toast({ title: "Reseller deleted" }); },
  });

  const activeCount = resellers.filter(r => r.active).length;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20">
              <Layers className="h-5 w-5 text-amber-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Reseller Management</h1>
              <p className="text-sm text-muted-foreground">Manage wholesale resellers, markup rules and white-label configurations</p>
            </div>
          </div>
          <Button onClick={openCreate} data-testid="button-new-reseller">
            <Plus className="h-4 w-4 mr-2" /> New Reseller
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "Total Resellers", value: resellers.length, icon: Users, color: "text-foreground" },
            { label: "Active", value: activeCount, icon: CheckCircle2, color: "text-emerald-400" },
            { label: "Avg Markup", value: resellers.length ? `${(resellers.reduce((s, r) => s + r.markupPercent, 0) / resellers.length).toFixed(1)}%` : "—", icon: TrendingUp, color: "text-amber-400" },
          ].map(s => (
            <div key={s.label} className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
              <s.icon className={cn("h-5 w-5 shrink-0", s.color)} />
              <div>
                <p className={cn("text-xl font-bold", s.color)}>{s.value}</p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4 flex items-start gap-3">
          <Info className="h-4 w-4 text-blue-400 mt-0.5 shrink-0" />
          <p className="text-xs text-muted-foreground">
            Resellers are linked to Sippy customers via <strong className="text-foreground/80">i_customer</strong>. 
            Markup % is applied on top of your base rate when generating reseller invoices. 
            Each reseller can have their own brand name for white-label invoice templates.
          </p>
        </div>

        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border">
            <h2 className="text-sm font-semibold">Resellers ({resellers.length})</h2>
          </div>

          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Loading…</div>
          ) : resellers.length === 0 ? (
            <div className="p-12 text-center space-y-3">
              <div className="mx-auto w-12 h-12 rounded-2xl bg-muted/30 flex items-center justify-center">
                <Layers className="h-6 w-6 text-muted-foreground/40" />
              </div>
              <p className="text-sm text-muted-foreground">No resellers yet. Add your wholesale partners to manage their markup and branding.</p>
              <Button size="sm" variant="outline" onClick={openCreate}>Add First Reseller</Button>
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {resellers.map(r => (
                <div key={r.id} className={cn("px-5 py-4 flex items-center gap-4", !r.active && "opacity-60")}>
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{r.name}</span>
                      {r.brandName && <Badge variant="outline" className="text-[10px]">{r.brandName}</Badge>}
                      {r.active ? (
                        <span className="text-[10px] text-emerald-400 font-semibold">Active</span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground/60 font-semibold">Inactive</span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      {r.contactEmail && <span>{r.contactEmail}</span>}
                      {r.iCustomer && <span>Sippy Customer #{r.iCustomer}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-right">
                      <p className="text-sm font-bold text-amber-400">+{r.markupPercent}%</p>
                      <p className="text-[10px] text-muted-foreground">markup</p>
                    </div>
                    <button onClick={() => openEdit(r)} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
                      <Edit2 className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => toggleMutation.mutate({ id: r.id, active: !r.active })} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
                      {r.active ? <XCircle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                    </button>
                    <button onClick={() => deleteMutation.mutate(r.id)} className="p-1.5 rounded-lg text-muted-foreground/40 hover:text-rose-400 hover:bg-rose-500/10 transition-colors">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit: ${editing.name}` : "New Reseller"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Company Name</label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} data-testid="input-reseller-name" />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Brand / White-Label Name</label>
                <Input value={form.brandName} onChange={e => setForm(f => ({ ...f, brandName: e.target.value }))} placeholder="optional" />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Contact Email</label>
              <Input type="email" value={form.contactEmail} onChange={e => setForm(f => ({ ...f, contactEmail: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Markup (%)</label>
                <Input type="number" min={0} max={500} step={0.5} value={form.markupPercent} onChange={e => setForm(f => ({ ...f, markupPercent: Number(e.target.value) }))} data-testid="input-markup" />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Sippy Customer ID</label>
                <Input type="number" value={form.iCustomer} onChange={e => setForm(f => ({ ...f, iCustomer: e.target.value }))} placeholder="optional" />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Notes</label>
              <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="min-h-[80px]" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
            <Button onClick={() => saveMutation.mutate(form)} disabled={!form.name || saveMutation.isPending} data-testid="button-save-reseller">
              {editing ? "Save Changes" : "Create Reseller"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

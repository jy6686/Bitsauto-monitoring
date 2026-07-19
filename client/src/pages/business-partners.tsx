import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Card, CardContent, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Form, FormField, FormItem, FormLabel, FormControl, FormMessage,
} from "@/components/ui/form";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Building2, Plus, Search, Mail, Phone, Trash2, Loader2,
} from "lucide-react";

// ── types ─────────────────────────────────────────────────────────────────────
interface BusinessPartner {
  id: number;
  name: string;
  type: string;
  status: string;
  currency: string;
  paymentTermsDays: number;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  taxId?: string;
  notes?: string;
  createdBy?: string;
  createdAt: string;
}

// ── constants ─────────────────────────────────────────────────────────────────
const TYPE_CFG: Record<string, { label: string; color: string }> = {
  vendor:  { label: 'Vendor',  color: 'text-sky-400   bg-sky-400/10   border-sky-400/30'   },
  client:  { label: 'Client',  color: 'text-violet-400 bg-violet-400/10 border-violet-400/30' },
  carrier: { label: 'Carrier', color: 'text-amber-400 bg-amber-400/10 border-amber-400/30' },
};

const STATUS_CFG: Record<string, { label: string; color: string }> = {
  active:    { label: 'Active',    color: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30' },
  inactive:  { label: 'Inactive',  color: 'text-slate-400   bg-slate-400/10   border-slate-400/30'   },
  suspended: { label: 'Suspended', color: 'text-red-400     bg-red-400/10     border-red-400/30'     },
};

// ── create form schema ────────────────────────────────────────────────────────
const createSchema = z.object({
  name:             z.string().min(1, 'Name is required'),
  type:             z.enum(['vendor', 'client', 'carrier']),
  status:           z.enum(['active', 'inactive', 'suspended']),
  currency:         z.string().min(1, 'Currency required'),
  paymentTermsDays: z.string().min(1, 'Payment terms required'),
  contactName:      z.string().optional(),
  contactEmail:     z.string().email('Invalid email').optional().or(z.literal('')),
  contactPhone:     z.string().optional(),
  taxId:            z.string().optional(),
  notes:            z.string().optional(),
});

type CreateForm = z.infer<typeof createSchema>;

// ── helper components ─────────────────────────────────────────────────────────
function TypeBadge({ type }: { type: string }) {
  const cfg = TYPE_CFG[type] ?? TYPE_CFG.vendor;
  return <Badge variant="outline" className={`text-xs ${cfg.color}`}>{cfg.label}</Badge>;
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CFG[status] ?? STATUS_CFG.active;
  return <Badge variant="outline" className={`text-xs ${cfg.color}`}>{cfg.label}</Badge>;
}

// ── page ──────────────────────────────────────────────────────────────────────
export default function BusinessPartnersPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [search, setSearch]     = useState('');
  const [typeFilter, setType]   = useState('all');
  const [createOpen, setCreate] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  // ── data ──────────────────────────────────────────────────────────────────
  const { data: partners = [], isLoading } = useQuery<BusinessPartner[]>({
    queryKey: ['/api/business-partners'],
    queryFn:  () => apiRequest('GET', '/api/business-partners').then(r => r.json()),
    refetchInterval: 60_000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['/api/business-partners'] });

  // ── create ────────────────────────────────────────────────────────────────
  const form = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      name: '', type: 'vendor', status: 'active', currency: 'USD',
      paymentTermsDays: '30', contactName: '', contactEmail: '',
      contactPhone: '', taxId: '', notes: '',
    },
  });

  const createMutation = useMutation({
    mutationFn: (d: CreateForm) => apiRequest('POST', '/api/business-partners', {
      ...d,
      paymentTermsDays: parseInt(d.paymentTermsDays, 10),
      contactName:  d.contactName  || undefined,
      contactEmail: d.contactEmail || undefined,
      contactPhone: d.contactPhone || undefined,
      taxId:        d.taxId        || undefined,
      notes:        d.notes        || undefined,
    }).then(r => r.json()),
    onSuccess: () => {
      invalidate();
      setCreate(false);
      form.reset();
      toast({ title: 'Business partner created' });
    },
    onError: (e: any) => toast({ title: 'Create failed', description: e.message, variant: 'destructive' }),
  });

  // ── delete ────────────────────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/business-partners/${id}`).then(r => r.json()),
    onSuccess: () => {
      invalidate();
      setDeleteId(null);
      toast({ title: 'Business partner removed' });
    },
    onError: (e: any) => toast({ title: 'Delete failed', description: e.message, variant: 'destructive' }),
  });

  // ── filtered view ─────────────────────────────────────────────────────────
  const visible = partners.filter(p => {
    if (typeFilter !== 'all' && p.type !== typeFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        p.contactEmail?.toLowerCase().includes(q) ||
        p.contactName?.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="p-6 space-y-5">

      {/* Header */}
      <div className="flex items-center gap-3">
        <Building2 className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Business Partners</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Master directory of vendors, clients and carriers — the foundation for AP bills, payments and statements.
          </p>
        </div>
        <Button className="ml-auto gap-2" onClick={() => setCreate(true)}>
          <Plus className="h-4 w-4" /> New Partner
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, email or contact…"
            className="pl-9"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <Select value={typeFilter} onValueChange={setType}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="vendor">Vendor</SelectItem>
            <SelectItem value="client">Client</SelectItem>
            <SelectItem value="carrier">Carrier</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground ml-1">
          {visible.length} of {partners.length}
        </span>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center h-40 text-muted-foreground gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Loading…</span>
            </div>
          ) : visible.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2">
              <Building2 className="h-8 w-8 opacity-30" />
              <p className="text-sm">
                {partners.length === 0
                  ? 'No business partners yet — add your first vendor to start raising bills.'
                  : 'No partners match the current filter.'}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Currency</TableHead>
                  <TableHead>Payment Terms</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map(p => (
                  <TableRow key={p.id} className="group">
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell><TypeBadge type={p.type} /></TableCell>
                    <TableCell><StatusBadge status={p.status} /></TableCell>
                    <TableCell className="text-sm text-muted-foreground">{p.currency}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">Net {p.paymentTermsDays}</TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        {p.contactName && (
                          <span className="text-sm">{p.contactName}</span>
                        )}
                        {p.contactEmail && (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Mail className="h-3 w-3" />{p.contactEmail}
                          </span>
                        )}
                        {p.contactPhone && (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Phone className="h-3 w-3" />{p.contactPhone}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost" size="icon"
                        className="opacity-0 group-hover:opacity-100 h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => setDeleteId(p.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreate}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New Business Partner</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(d => createMutation.mutate(d))} className="space-y-4">

              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Name <span className="text-destructive">*</span></FormLabel>
                  <FormControl><Input placeholder="Acme Telecom Ltd" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="type" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type <span className="text-destructive">*</span></FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="vendor">Vendor</SelectItem>
                        <SelectItem value="client">Client</SelectItem>
                        <SelectItem value="carrier">Carrier</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="status" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="inactive">Inactive</SelectItem>
                        <SelectItem value="suspended">Suspended</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="currency" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Currency <span className="text-destructive">*</span></FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="USD">USD</SelectItem>
                        <SelectItem value="EUR">EUR</SelectItem>
                        <SelectItem value="GBP">GBP</SelectItem>
                        <SelectItem value="AED">AED</SelectItem>
                        <SelectItem value="SAR">SAR</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="paymentTermsDays" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Payment Terms (days) <span className="text-destructive">*</span></FormLabel>
                    <FormControl><Input type="number" min={0} max={365} placeholder="30" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <div className="border-t pt-4 space-y-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Contact (optional)</p>
                <FormField control={form.control} name="contactName" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contact Name</FormLabel>
                    <FormControl><Input placeholder="Jane Smith" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="contactEmail" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl><Input type="email" placeholder="ap@vendor.com" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="contactPhone" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Phone</FormLabel>
                      <FormControl><Input placeholder="+1 555 000 0000" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
              </div>

              <FormField control={form.control} name="taxId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Tax ID / VAT Number</FormLabel>
                  <FormControl><Input placeholder="GB123456789" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setCreate(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createMutation.isPending} className="gap-2">
                  {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Create Partner
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={deleteId !== null} onOpenChange={o => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove business partner?</AlertDialogTitle>
            <AlertDialogDescription>
              The record will be soft-deleted and removed from all AP dropdowns. Bills linked to this
              partner are retained and unaffected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteId !== null && deleteMutation.mutate(deleteId)}
            >
              {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Remove'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

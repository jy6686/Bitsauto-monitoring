import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form, FormField, FormItem, FormLabel, FormControl, FormMessage, FormDescription,
} from "@/components/ui/form";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import {
  FileText, Plus, Edit2, Trash2, Star, Palette, Building2,
  CreditCard, FileCode2, Eye, Globe,
} from "lucide-react";

interface InvoiceTemplate {
  id: number; templateName: string; templateType: string; detailLevel: string;
  clientName?: string; showPrefixBreakdown: boolean; showDestinationSummary: boolean;
  showCallLevelDetails: boolean; filenamePattern?: string; subjectLinePattern?: string;
  attachPdfEnabled: boolean; isDefault: boolean; brandingProfileId?: number;
  createdAt: string;
}

interface BrandingProfile {
  id: number; clientName?: string; companyName?: string; logoUrl?: string;
  primaryColor?: string; secondaryColor?: string; bankingDetails?: string;
  bankName?: string; accountNumber?: string; iban?: string; swift?: string;
  paymentTermsDays: number; paymentInstructions?: string; invoiceFooterText?: string;
  taxId?: string; addressLine1?: string; addressLine2?: string; city?: string; country?: string;
  createdAt: string;
}

const TEMPLATE_TYPES = [
  { value: 'standard',            label: 'Standard'            },
  { value: 'prefix_breakdown',    label: 'Prefix Breakdown'    },
  { value: 'destination_summary', label: 'Destination Summary' },
  { value: 'summary_only',        label: 'Summary Only'        },
  { value: 'white_label',         label: 'White Label'         },
];
const DETAIL_LEVELS = [
  { value: 'full',    label: 'Full (calls + rates + prefixes)' },
  { value: 'summary', label: 'Summary (totals by service)'     },
  { value: 'minimal', label: 'Minimal (amount only)'           },
];

const templateSchema = z.object({
  templateName:           z.string().min(1, 'Name required'),
  templateType:           z.string().min(1),
  detailLevel:            z.string().min(1),
  clientName:             z.string().optional(),
  filenamePattern:        z.string().optional(),
  subjectLinePattern:     z.string().optional(),
  showPrefixBreakdown:    z.boolean().default(false),
  showDestinationSummary: z.boolean().default(false),
  showCallLevelDetails:   z.boolean().default(false),
  attachPdfEnabled:       z.boolean().default(true),
  isDefault:              z.boolean().default(false),
});

const brandingSchema = z.object({
  clientName:          z.string().optional(),
  companyName:         z.string().optional(),
  primaryColor:        z.string().optional(),
  secondaryColor:      z.string().optional(),
  bankName:            z.string().optional(),
  accountNumber:       z.string().optional(),
  iban:                z.string().optional(),
  swift:               z.string().optional(),
  paymentTermsDays:    z.number().default(30),
  bankingDetails:      z.string().optional(),
  paymentInstructions: z.string().optional(),
  invoiceFooterText:   z.string().optional(),
  taxId:               z.string().optional(),
  addressLine1:        z.string().optional(),
  city:                z.string().optional(),
  country:             z.string().optional(),
});

function TypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    standard:            'text-sky-400 border-sky-400/30 bg-sky-400/10',
    prefix_breakdown:    'text-purple-400 border-purple-400/30 bg-purple-400/10',
    destination_summary: 'text-amber-400 border-amber-400/30 bg-amber-400/10',
    summary_only:        'text-emerald-400 border-emerald-400/30 bg-emerald-400/10',
    white_label:         'text-pink-400 border-pink-400/30 bg-pink-400/10',
  };
  const label = TEMPLATE_TYPES.find(t => t.value === type)?.label ?? type;
  return <Badge variant="outline" className={`text-xs ${colors[type] ?? ''}`}>{label}</Badge>;
}

export default function InvoiceTemplatesPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState('templates');
  const [templateOpen, setTemplateOpen] = useState(false);
  const [brandingOpen, setBrandingOpen] = useState(false);
  const [editTemplate, setEditTemplate] = useState<InvoiceTemplate | null>(null);
  const [editBranding, setEditBranding] = useState<BrandingProfile | null>(null);

  const { data: templates = [], isLoading: tLoading } = useQuery<InvoiceTemplate[]>({
    queryKey: ['/api/invoice-templates'],
    queryFn:  () => apiRequest('GET', '/api/invoice-templates').then(r => r.json()),
  });

  const { data: profiles = [], isLoading: pLoading } = useQuery<BrandingProfile[]>({
    queryKey: ['/api/branding-profiles'],
    queryFn:  () => apiRequest('GET', '/api/branding-profiles').then(r => r.json()),
  });

  const tForm = useForm({ resolver: zodResolver(templateSchema),
    defaultValues: { templateName: '', templateType: 'standard', detailLevel: 'full', clientName: '', filenamePattern: 'INV_{PERIOD}_{CLIENT}', subjectLinePattern: 'Invoice {PERIOD} — {CLIENT}', showPrefixBreakdown: false, showDestinationSummary: false, showCallLevelDetails: false, attachPdfEnabled: true, isDefault: false },
  });

  const bForm = useForm({ resolver: zodResolver(brandingSchema),
    defaultValues: { clientName: '', companyName: '', primaryColor: '#1a6e3c', secondaryColor: '#0f4c2a', bankName: '', accountNumber: '', iban: '', swift: '', paymentTermsDays: 30, bankingDetails: '', paymentInstructions: '', invoiceFooterText: '', taxId: '', addressLine1: '', city: '', country: '' },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['/api/invoice-templates'] });
    qc.invalidateQueries({ queryKey: ['/api/branding-profiles'] });
  };

  const tMutation = useMutation({
    mutationFn: (d: any) => editTemplate
      ? apiRequest('PATCH', `/api/invoice-templates/${editTemplate.id}`, d).then(r => r.json())
      : apiRequest('POST', '/api/invoice-templates', d).then(r => r.json()),
    onSuccess: () => { invalidate(); setTemplateOpen(false); setEditTemplate(null); tForm.reset(); toast({ title: editTemplate ? 'Template updated' : 'Template created' }); },
    onError: (e: any) => toast({ title: 'Failed', description: e.message, variant: 'destructive' }),
  });

  const bMutation = useMutation({
    mutationFn: (d: any) => editBranding
      ? apiRequest('PATCH', `/api/branding-profiles/${editBranding.id}`, d).then(r => r.json())
      : apiRequest('POST', '/api/branding-profiles', d).then(r => r.json()),
    onSuccess: () => { invalidate(); setBrandingOpen(false); setEditBranding(null); bForm.reset(); toast({ title: editBranding ? 'Profile updated' : 'Profile created' }); },
    onError: (e: any) => toast({ title: 'Failed', description: e.message, variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: ({ type, id }: { type: 'template' | 'branding'; id: number }) =>
      apiRequest('DELETE', type === 'template' ? `/api/invoice-templates/${id}` : `/api/branding-profiles/${id}`).then(r => r.json()),
    onSuccess: () => { invalidate(); toast({ title: 'Deleted' }); },
    onError: (e: any) => toast({ title: 'Delete failed', description: e.message, variant: 'destructive' }),
  });

  const openEditTemplate = (t: InvoiceTemplate) => {
    setEditTemplate(t);
    tForm.reset({ ...t, clientName: t.clientName ?? '' });
    setTemplateOpen(true);
  };

  const openEditBranding = (p: BrandingProfile) => {
    setEditBranding(p);
    bForm.reset({ ...p, clientName: p.clientName ?? '', paymentTermsDays: p.paymentTermsDays });
    setBrandingOpen(true);
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileText className="h-6 w-6 text-primary" />Invoice Templates & Branding
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Per-client invoice rendering templates, branding profiles, and banking details
          </p>
        </div>
        <div className="flex gap-2">
          {tab === 'templates' ? (
            <Dialog open={templateOpen} onOpenChange={o => { setTemplateOpen(o); if (!o) { setEditTemplate(null); tForm.reset(); } }}>
              <DialogTrigger asChild>
                <Button size="sm" data-testid="button-new-template"><Plus className="h-4 w-4 mr-1.5" />New Template</Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader><DialogTitle>{editTemplate ? 'Edit Template' : 'New Invoice Template'}</DialogTitle></DialogHeader>
                <Form {...tForm}>
                  <form onSubmit={tForm.handleSubmit(d => tMutation.mutate(d))} className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
                    <FormField control={tForm.control} name="templateName" render={({ field }) => (
                      <FormItem><FormLabel>Template Name</FormLabel><FormControl><Input data-testid="input-template-name" placeholder="Standard Wholesale" {...field} /></FormControl><FormMessage /></FormItem>
                    )} />
                    <div className="grid grid-cols-2 gap-3">
                      <FormField control={tForm.control} name="templateType" render={({ field }) => (
                        <FormItem><FormLabel>Type</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                            <SelectContent>{TEMPLATE_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                          </Select><FormMessage /></FormItem>
                      )} />
                      <FormField control={tForm.control} name="detailLevel" render={({ field }) => (
                        <FormItem><FormLabel>Detail Level</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                            <SelectContent>{DETAIL_LEVELS.map(d => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}</SelectContent>
                          </Select><FormMessage /></FormItem>
                      )} />
                    </div>
                    <FormField control={tForm.control} name="clientName" render={({ field }) => (
                      <FormItem><FormLabel>Client Override (blank = global)</FormLabel><FormControl><Input placeholder="Leave blank for global default" {...field} /></FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField control={tForm.control} name="filenamePattern" render={({ field }) => (
                      <FormItem><FormLabel>Filename Pattern</FormLabel><FormControl><Input placeholder="INV_{PERIOD}_{CLIENT}" {...field} /></FormControl>
                        <FormDescription className="text-xs">Tokens: {'{PERIOD}'} {'{CLIENT}'} {'{DATE}'} {'{ID}'}</FormDescription><FormMessage /></FormItem>
                    )} />
                    <FormField control={tForm.control} name="subjectLinePattern" render={({ field }) => (
                      <FormItem><FormLabel>Email Subject Pattern</FormLabel><FormControl><Input placeholder="Invoice {PERIOD} — {CLIENT}" {...field} /></FormControl><FormMessage /></FormItem>
                    )} />
                    <div className="space-y-2">
                      {[
                        { name: 'showPrefixBreakdown', label: 'Show Prefix Breakdown' },
                        { name: 'showDestinationSummary', label: 'Show Destination Summary' },
                        { name: 'showCallLevelDetails', label: 'Show Call-Level Details' },
                        { name: 'attachPdfEnabled', label: 'Attach PDF' },
                        { name: 'isDefault', label: 'Set as Default Template' },
                      ].map(f => (
                        <FormField key={f.name} control={tForm.control} name={f.name as any} render={({ field }) => (
                          <FormItem className="flex items-center justify-between rounded border px-3 py-2">
                            <FormLabel className="font-normal cursor-pointer">{f.label}</FormLabel>
                            <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                          </FormItem>
                        )} />
                      ))}
                    </div>
                    <div className="flex gap-2 justify-end pt-2">
                      <Button type="button" variant="outline" onClick={() => setTemplateOpen(false)}>Cancel</Button>
                      <Button type="submit" disabled={tMutation.isPending}>{tMutation.isPending ? 'Saving…' : (editTemplate ? 'Update' : 'Create')}</Button>
                    </div>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          ) : (
            <Dialog open={brandingOpen} onOpenChange={o => { setBrandingOpen(o); if (!o) { setEditBranding(null); bForm.reset(); } }}>
              <DialogTrigger asChild>
                <Button size="sm" data-testid="button-new-branding"><Plus className="h-4 w-4 mr-1.5" />New Profile</Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader><DialogTitle>{editBranding ? 'Edit Branding Profile' : 'New Branding Profile'}</DialogTitle></DialogHeader>
                <Form {...bForm}>
                  <form onSubmit={bForm.handleSubmit(d => bMutation.mutate({ ...d, paymentTermsDays: Number(d.paymentTermsDays) }))} className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
                    <div className="grid grid-cols-2 gap-3">
                      <FormField control={bForm.control} name="clientName" render={({ field }) => (
                        <FormItem><FormLabel>Client (blank = global)</FormLabel><FormControl><Input placeholder="Global default" {...field} /></FormControl><FormMessage /></FormItem>
                      )} />
                      <FormField control={bForm.control} name="companyName" render={({ field }) => (
                        <FormItem><FormLabel>Company Name</FormLabel><FormControl><Input placeholder="Acme Telecom Ltd" {...field} /></FormControl><FormMessage /></FormItem>
                      )} />
                      <FormField control={bForm.control} name="primaryColor" render={({ field }) => (
                        <FormItem><FormLabel>Primary Color</FormLabel><FormControl><Input type="color" {...field} /></FormControl><FormMessage /></FormItem>
                      )} />
                      <FormField control={bForm.control} name="secondaryColor" render={({ field }) => (
                        <FormItem><FormLabel>Secondary Color</FormLabel><FormControl><Input type="color" {...field} /></FormControl><FormMessage /></FormItem>
                      )} />
                      <FormField control={bForm.control} name="taxId" render={({ field }) => (
                        <FormItem><FormLabel>Tax / VAT ID</FormLabel><FormControl><Input placeholder="GB123456789" {...field} /></FormControl><FormMessage /></FormItem>
                      )} />
                      <FormField control={bForm.control} name="paymentTermsDays" render={({ field }) => (
                        <FormItem><FormLabel>Payment Terms (days)</FormLabel><FormControl><Input type="number" {...field} onChange={e => field.onChange(Number(e.target.value))} /></FormControl><FormMessage /></FormItem>
                      )} />
                    </div>
                    <p className="text-xs font-medium text-muted-foreground pt-1">Banking Details</p>
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { name: 'bankName', label: 'Bank Name', placeholder: 'HSBC' },
                        { name: 'accountNumber', label: 'Account No.', placeholder: '12345678' },
                        { name: 'iban', label: 'IBAN', placeholder: 'GB29NWBK...' },
                        { name: 'swift', label: 'SWIFT / BIC', placeholder: 'NWBKGB2L' },
                      ].map(f => (
                        <FormField key={f.name} control={bForm.control} name={f.name as any} render={({ field }) => (
                          <FormItem><FormLabel>{f.label}</FormLabel><FormControl><Input placeholder={f.placeholder} {...field} /></FormControl><FormMessage /></FormItem>
                        )} />
                      ))}
                    </div>
                    <FormField control={bForm.control} name="bankingDetails" render={({ field }) => (
                      <FormItem><FormLabel>Banking Block (free text override)</FormLabel><FormControl><Textarea rows={3} placeholder="Multi-line banking instructions…" {...field} /></FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField control={bForm.control} name="addressLine1" render={({ field }) => (
                      <FormItem><FormLabel>Address</FormLabel><FormControl><Input placeholder="123 Business Road" {...field} /></FormControl><FormMessage /></FormItem>
                    )} />
                    <div className="grid grid-cols-2 gap-3">
                      <FormField control={bForm.control} name="city" render={({ field }) => (
                        <FormItem><FormLabel>City</FormLabel><FormControl><Input placeholder="London" {...field} /></FormControl><FormMessage /></FormItem>
                      )} />
                      <FormField control={bForm.control} name="country" render={({ field }) => (
                        <FormItem><FormLabel>Country</FormLabel><FormControl><Input placeholder="United Kingdom" {...field} /></FormControl><FormMessage /></FormItem>
                      )} />
                    </div>
                    <FormField control={bForm.control} name="invoiceFooterText" render={({ field }) => (
                      <FormItem><FormLabel>Invoice Footer Text</FormLabel><FormControl><Textarea rows={2} placeholder="Thank you for your business." {...field} /></FormControl><FormMessage /></FormItem>
                    )} />
                    <div className="flex gap-2 justify-end pt-2">
                      <Button type="button" variant="outline" onClick={() => setBrandingOpen(false)}>Cancel</Button>
                      <Button type="submit" disabled={bMutation.isPending}>{bMutation.isPending ? 'Saving…' : (editBranding ? 'Update' : 'Create')}</Button>
                    </div>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="templates"><FileCode2 className="h-4 w-4 mr-1.5" />Templates ({templates.length})</TabsTrigger>
          <TabsTrigger value="branding"><Palette className="h-4 w-4 mr-1.5" />Branding Profiles ({profiles.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="templates" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Detail Level</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Filename Pattern</TableHead>
                    <TableHead>Options</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tLoading && <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>}
                  {!tLoading && templates.length === 0 && (
                    <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground">No templates yet. Create one to customize invoice rendering.</TableCell></TableRow>
                  )}
                  {templates.map(t => (
                    <TableRow key={t.id} data-testid={`row-template-${t.id}`}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {t.isDefault && <Star className="h-3.5 w-3.5 text-amber-400 fill-amber-400" />}
                          <span className="font-medium text-sm">{t.templateName}</span>
                        </div>
                      </TableCell>
                      <TableCell><TypeBadge type={t.templateType} /></TableCell>
                      <TableCell className="text-sm capitalize text-muted-foreground">{t.detailLevel}</TableCell>
                      <TableCell className="text-sm">
                        {t.clientName ? <span className="text-foreground">{t.clientName}</span> : <span className="text-muted-foreground flex items-center gap-1"><Globe className="h-3.5 w-3.5" />Global</span>}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{t.filenamePattern ?? '—'}</TableCell>
                      <TableCell>
                        <div className="flex gap-1 flex-wrap">
                          {t.showPrefixBreakdown && <Badge variant="outline" className="text-xs">Prefix</Badge>}
                          {t.showDestinationSummary && <Badge variant="outline" className="text-xs">Dest.</Badge>}
                          {t.attachPdfEnabled && <Badge variant="outline" className="text-xs">PDF</Badge>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1.5">
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEditTemplate(t)} data-testid={`button-edit-template-${t.id}`}><Edit2 className="h-3.5 w-3.5" /></Button>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-400 hover:text-red-500" onClick={() => deleteMutation.mutate({ type: 'template', id: t.id })} data-testid={`button-delete-template-${t.id}`}><Trash2 className="h-3.5 w-3.5" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="branding" className="mt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {pLoading && <div className="col-span-3 text-center py-10 text-muted-foreground">Loading…</div>}
            {!pLoading && profiles.length === 0 && (
              <div className="col-span-3 text-center py-10 text-muted-foreground">No branding profiles yet. Create one to customize invoice appearance.</div>
            )}
            {profiles.map(p => (
              <Card key={p.id} data-testid={`card-branding-${p.id}`} className="relative">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        {p.primaryColor && <div className="h-4 w-4 rounded-full border" style={{ background: p.primaryColor }} />}
                        <CardTitle className="text-sm">{p.companyName ?? p.clientName ?? 'Global Default'}</CardTitle>
                      </div>
                      <CardDescription className="text-xs mt-0.5">
                        {p.clientName ? p.clientName : <span className="flex items-center gap-1"><Globe className="h-3 w-3" />Global</span>}
                      </CardDescription>
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEditBranding(p)}><Edit2 className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-400 hover:text-red-500" onClick={() => deleteMutation.mutate({ type: 'branding', id: p.id })}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 space-y-1">
                  {p.bankName && <div className="text-xs text-muted-foreground"><CreditCard className="inline h-3 w-3 mr-1" />{p.bankName}{p.iban ? ` · ${p.iban}` : ''}</div>}
                  {p.paymentTermsDays && <div className="text-xs text-muted-foreground">Net {p.paymentTermsDays} days</div>}
                  {p.taxId && <div className="text-xs text-muted-foreground">Tax: {p.taxId}</div>}
                  {p.city && <div className="text-xs text-muted-foreground">{[p.city, p.country].filter(Boolean).join(', ')}</div>}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

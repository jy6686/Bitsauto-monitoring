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
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
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
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import {
  ShieldAlert, Plus, Search, AlertTriangle, Ban, CheckCircle2,
  Activity, TrendingUp, Globe, Zap, Clock, XCircle,
} from "lucide-react";

interface CreditControlRule {
  id: number; clientName?: string; clientId?: string; isGlobal: boolean;
  warningThresholdUsd?: number; suspendThresholdUsd?: number; gracePeriodDays: number;
  autoSuspend: boolean; notifyOnWarning: boolean; creditLimitUsd?: number;
  riskScore?: number; notes?: string; createdAt: string;
}

interface CollectionEvent {
  id: number; clientName: string; clientId?: string; eventType: string;
  outstandingAmountUsd?: number; thresholdBreached?: string; actionTaken?: string;
  resolvedAt?: string; actorName?: string; notes?: string; createdAt: string;
}

const EVENT_CFG: Record<string, { color: string; label: string; icon: any }> = {
  warning:    { color: 'text-amber-400 bg-amber-400/10 border-amber-400/30',   label: 'Warning',    icon: AlertTriangle  },
  suspension: { color: 'text-red-400 bg-red-400/10 border-red-400/30',         label: 'Suspended',  icon: Ban            },
  grace_start:{ color: 'text-purple-400 bg-purple-400/10 border-purple-400/30',label: 'Grace Start',icon: Clock          },
  grace_end:  { color: 'text-purple-400 bg-purple-400/10 border-purple-400/30',label: 'Grace End',  icon: Clock          },
  recovery:   { color: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30', label: 'Recovery', icon: CheckCircle2  },
  write_off:  { color: 'text-red-400 bg-red-400/10 border-red-400/30',         label: 'Write-Off',  icon: XCircle        },
  reinstated: { color: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30', label: 'Reinstated', icon: CheckCircle2 },
  collections:{ color: 'text-orange-400 bg-orange-400/10 border-orange-400/30',label: 'Collections',icon: TrendingUp     },
};

const ruleSchema = z.object({
  clientName:           z.string().optional(),
  isGlobal:             z.boolean().default(false),
  warningThresholdUsd:  z.string().optional(),
  suspendThresholdUsd:  z.string().optional(),
  gracePeriodDays:      z.number().default(3),
  autoSuspend:          z.boolean().default(false),
  notifyOnWarning:      z.boolean().default(true),
  creditLimitUsd:       z.string().optional(),
  riskScore:            z.number().optional(),
  notes:                z.string().optional(),
});

const eventSchema = z.object({
  clientName:           z.string().min(1, 'Client required'),
  eventType:            z.string().min(1, 'Event type required'),
  outstandingAmountUsd: z.string().optional(),
  actionTaken:          z.string().optional(),
  notes:                z.string().optional(),
});

function EventBadge({ type }: { type: string }) {
  const cfg = EVENT_CFG[type] ?? { color: 'text-muted-foreground', label: type, icon: Activity };
  const Icon = cfg.icon;
  return <Badge variant="outline" className={`text-xs gap-1 ${cfg.color}`}><Icon className="h-3 w-3" />{cfg.label}</Badge>;
}

export default function CreditControlPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState('rules');
  const [ruleOpen, setRuleOpen] = useState(false);
  const [eventOpen, setEventOpen] = useState(false);
  const [search, setSearch] = useState('');

  const { data: rules = [], isLoading: rLoading } = useQuery<CreditControlRule[]>({
    queryKey: ['/api/credit-control/rules'],
    queryFn:  () => apiRequest('GET', '/api/credit-control/rules').then(r => r.json()),
  });

  const { data: events = [], isLoading: eLoading } = useQuery<CollectionEvent[]>({
    queryKey: ['/api/credit-control/events'],
    queryFn:  () => apiRequest('GET', '/api/credit-control/events').then(r => r.json()),
    refetchInterval: 30000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['/api/credit-control/rules'] });
    qc.invalidateQueries({ queryKey: ['/api/credit-control/events'] });
  };

  const ruleForm = useForm({ resolver: zodResolver(ruleSchema),
    defaultValues: { clientName: '', isGlobal: false, warningThresholdUsd: '', suspendThresholdUsd: '', gracePeriodDays: 3, autoSuspend: false, notifyOnWarning: true, creditLimitUsd: '', notes: '' },
  });

  const eventForm = useForm({ resolver: zodResolver(eventSchema),
    defaultValues: { clientName: '', eventType: 'warning', outstandingAmountUsd: '', actionTaken: '', notes: '' },
  });

  const ruleMutation = useMutation({
    mutationFn: (d: any) => apiRequest('POST', '/api/credit-control/rules', {
      ...d,
      warningThresholdUsd: d.warningThresholdUsd ? parseFloat(d.warningThresholdUsd) : undefined,
      suspendThresholdUsd: d.suspendThresholdUsd ? parseFloat(d.suspendThresholdUsd) : undefined,
      creditLimitUsd:      d.creditLimitUsd      ? parseFloat(d.creditLimitUsd)      : undefined,
    }).then(r => r.json()),
    onSuccess: () => { invalidate(); setRuleOpen(false); ruleForm.reset(); toast({ title: 'Rule saved' }); },
    onError: (e: any) => toast({ title: 'Failed', description: e.message, variant: 'destructive' }),
  });

  const eventMutation = useMutation({
    mutationFn: (d: any) => apiRequest('POST', '/api/credit-control/events', {
      ...d,
      outstandingAmountUsd: d.outstandingAmountUsd ? parseFloat(d.outstandingAmountUsd) : undefined,
    }).then(r => r.json()),
    onSuccess: () => { invalidate(); setEventOpen(false); eventForm.reset(); toast({ title: 'Event logged' }); },
    onError: (e: any) => toast({ title: 'Failed', description: e.message, variant: 'destructive' }),
  });

  const sweepMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/credit-control/sweep', {}).then(r => r.json()),
    onSuccess: (d) => { invalidate(); toast({ title: `Sweep complete: ${d.warnings} warnings, ${d.suspended} suspensions, ${d.ok} OK` }); },
    onError: (e: any) => toast({ title: 'Sweep failed', description: e.message, variant: 'destructive' }),
  });

  const resolveEventMutation = useMutation({
    mutationFn: (id: number) => apiRequest('PATCH', `/api/credit-control/events/${id}/resolve`, {}).then(r => r.json()),
    onSuccess: () => { invalidate(); toast({ title: 'Event resolved' }); },
    onError: (e: any) => toast({ title: 'Failed', description: e.message, variant: 'destructive' }),
  });

  const filteredEvents = events.filter(e => !search || e.clientName.toLowerCase().includes(search.toLowerCase()));

  const counts = {
    warnings:   events.filter(e => e.eventType === 'warning'    && !e.resolvedAt).length,
    suspended:  events.filter(e => e.eventType === 'suspension' && !e.resolvedAt).length,
    grace:      events.filter(e => e.eventType === 'grace_start'&& !e.resolvedAt).length,
    rules:      rules.length,
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShieldAlert className="h-6 w-6 text-primary" />Collections & Credit Control
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Threshold monitoring, auto-suspension rules, grace periods, and collection event timeline
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => sweepMutation.mutate()} disabled={sweepMutation.isPending} data-testid="button-sweep">
            <Zap className="h-4 w-4 mr-1.5" />{sweepMutation.isPending ? 'Sweeping…' : 'Run Sweep'}
          </Button>
          <Dialog open={eventOpen} onOpenChange={setEventOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" data-testid="button-log-event"><Activity className="h-4 w-4 mr-1.5" />Log Event</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Log Collection Event</DialogTitle></DialogHeader>
              <Form {...eventForm}>
                <form onSubmit={eventForm.handleSubmit(d => eventMutation.mutate(d))} className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <FormField control={eventForm.control} name="clientName" render={({ field }) => (
                      <FormItem><FormLabel>Client Name</FormLabel><FormControl><Input data-testid="input-event-client" placeholder="Acme Telecom" {...field} /></FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField control={eventForm.control} name="eventType" render={({ field }) => (
                      <FormItem><FormLabel>Event Type</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                          <SelectContent>
                            {Object.entries(EVENT_CFG).map(([v, c]) => <SelectItem key={v} value={v}>{c.label}</SelectItem>)}
                          </SelectContent>
                        </Select><FormMessage /></FormItem>
                    )} />
                    <FormField control={eventForm.control} name="outstandingAmountUsd" render={({ field }) => (
                      <FormItem><FormLabel>Outstanding Amount ($)</FormLabel><FormControl><Input type="number" step="0.01" placeholder="0.00" {...field} /></FormControl><FormMessage /></FormItem>
                    )} />
                  </div>
                  <FormField control={eventForm.control} name="actionTaken" render={({ field }) => (
                    <FormItem><FormLabel>Action Taken</FormLabel><FormControl><Input placeholder="Describe the action…" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={eventForm.control} name="notes" render={({ field }) => (
                    <FormItem><FormLabel>Notes</FormLabel><FormControl><Input placeholder="Additional notes…" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <div className="flex gap-2 justify-end">
                    <Button type="button" variant="outline" onClick={() => setEventOpen(false)}>Cancel</Button>
                    <Button type="submit" disabled={eventMutation.isPending}>Log Event</Button>
                  </div>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
          <Dialog open={ruleOpen} onOpenChange={setRuleOpen}>
            <DialogTrigger asChild>
              <Button size="sm" data-testid="button-new-rule"><Plus className="h-4 w-4 mr-1.5" />New Rule</Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader><DialogTitle>Credit Control Rule</DialogTitle></DialogHeader>
              <Form {...ruleForm}>
                <form onSubmit={ruleForm.handleSubmit(d => ruleMutation.mutate(d))} className="space-y-3">
                  <FormField control={ruleForm.control} name="clientName" render={({ field }) => (
                    <FormItem><FormLabel>Client Name (blank = global)</FormLabel><FormControl><Input data-testid="input-rule-client" placeholder="Leave blank for global rule" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <div className="grid grid-cols-2 gap-3">
                    <FormField control={ruleForm.control} name="warningThresholdUsd" render={({ field }) => (
                      <FormItem><FormLabel>Warning Threshold ($)</FormLabel><FormControl><Input type="number" step="0.01" placeholder="500.00" {...field} /></FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField control={ruleForm.control} name="suspendThresholdUsd" render={({ field }) => (
                      <FormItem><FormLabel>Suspend Threshold ($)</FormLabel><FormControl><Input type="number" step="0.01" placeholder="1000.00" {...field} /></FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField control={ruleForm.control} name="creditLimitUsd" render={({ field }) => (
                      <FormItem><FormLabel>Credit Limit ($)</FormLabel><FormControl><Input type="number" step="0.01" placeholder="5000.00" {...field} /></FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField control={ruleForm.control} name="gracePeriodDays" render={({ field }) => (
                      <FormItem><FormLabel>Grace Period (days)</FormLabel><FormControl><Input type="number" {...field} onChange={e => field.onChange(Number(e.target.value))} /></FormControl><FormMessage /></FormItem>
                    )} />
                  </div>
                  <div className="space-y-2">
                    {[
                      { name: 'autoSuspend', label: 'Auto-suspend at threshold' },
                      { name: 'notifyOnWarning', label: 'Notify on warning breach' },
                      { name: 'isGlobal', label: 'Apply as global default rule' },
                    ].map(f => (
                      <FormField key={f.name} control={ruleForm.control} name={f.name as any} render={({ field }) => (
                        <FormItem className="flex items-center justify-between rounded border px-3 py-2">
                          <FormLabel className="font-normal cursor-pointer">{f.label}</FormLabel>
                          <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                        </FormItem>
                      )} />
                    ))}
                  </div>
                  <FormField control={ruleForm.control} name="notes" render={({ field }) => (
                    <FormItem><FormLabel>Notes</FormLabel><FormControl><Input placeholder="Any notes…" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <div className="flex gap-2 justify-end">
                    <Button type="button" variant="outline" onClick={() => setRuleOpen(false)}>Cancel</Button>
                    <Button type="submit" disabled={ruleMutation.isPending}>{ruleMutation.isPending ? 'Saving…' : 'Save Rule'}</Button>
                  </div>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Active Warnings',    count: counts.warnings,  color: 'text-amber-400'  },
          { label: 'Suspended Accounts', count: counts.suspended, color: 'text-red-400'    },
          { label: 'In Grace Period',    count: counts.grace,     color: 'text-purple-400' },
          { label: 'Rules Configured',   count: counts.rules,     color: 'text-sky-400'    },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className={`text-2xl font-bold ${s.color}`}>{s.count}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="events"><Activity className="h-4 w-4 mr-1.5" />Event Timeline ({events.length})</TabsTrigger>
          <TabsTrigger value="rules"><ShieldAlert className="h-4 w-4 mr-1.5" />Rules ({rules.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="events" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="relative max-w-xs">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search events…" className="pl-8" value={search} onChange={e => setSearch(e.target.value)} data-testid="input-search-events" />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Client</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Outstanding</TableHead>
                    <TableHead>Action Taken</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Resolved</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {eLoading && <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>}
                  {!eLoading && filteredEvents.length === 0 && (
                    <TableRow><TableCell colSpan={8} className="text-center py-10 text-muted-foreground">No collection events yet. Run a sweep or log an event.</TableCell></TableRow>
                  )}
                  {filteredEvents.map(e => (
                    <TableRow key={e.id} data-testid={`row-event-${e.id}`} className={!e.resolvedAt && ['warning', 'suspension'].includes(e.eventType) ? 'bg-amber-500/5' : ''}>
                      <TableCell className="font-medium text-sm">{e.clientName}</TableCell>
                      <TableCell><EventBadge type={e.eventType} /></TableCell>
                      <TableCell className="tabular-nums text-sm">{e.outstandingAmountUsd != null ? `$${e.outstandingAmountUsd.toFixed(2)}` : '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">{e.actionTaken ?? '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{e.actorName ?? '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{new Date(e.createdAt).toLocaleString()}</TableCell>
                      <TableCell>
                        {e.resolvedAt
                          ? <Badge variant="outline" className="text-xs text-emerald-400 border-emerald-400/30">Resolved</Badge>
                          : <Badge variant="outline" className="text-xs text-amber-400 border-amber-400/30">Open</Badge>}
                      </TableCell>
                      <TableCell>
                        {!e.resolvedAt && (
                          <Button size="sm" variant="ghost" className="h-7 text-xs text-emerald-400" onClick={() => resolveEventMutation.mutate(e.id)} disabled={resolveEventMutation.isPending} data-testid={`button-resolve-${e.id}`}>
                            <CheckCircle2 className="h-3 w-3 mr-1" />Resolve
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rules" className="mt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {rLoading && <div className="col-span-3 text-center py-10 text-muted-foreground">Loading…</div>}
            {!rLoading && rules.length === 0 && (
              <div className="col-span-3 text-center py-10 text-muted-foreground">No rules configured. Create a global rule or per-client thresholds.</div>
            )}
            {rules.map(r => (
              <Card key={r.id} data-testid={`card-rule-${r.id}`} className={r.isGlobal ? 'ring-1 ring-primary/30' : ''}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    {r.isGlobal ? <><Globe className="h-4 w-4 text-primary" />Global Default</> : r.clientName}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1.5">
                  {r.warningThresholdUsd != null && (
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Warning at</span>
                      <span className="text-amber-400 font-medium">${r.warningThresholdUsd.toFixed(2)}</span>
                    </div>
                  )}
                  {r.suspendThresholdUsd != null && (
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Suspend at</span>
                      <span className="text-red-400 font-medium">${r.suspendThresholdUsd.toFixed(2)}</span>
                    </div>
                  )}
                  {r.creditLimitUsd != null && (
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Credit limit</span>
                      <span className="font-medium">${r.creditLimitUsd.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Grace period</span>
                    <span>{r.gracePeriodDays} days</span>
                  </div>
                  <div className="flex gap-2 mt-2 flex-wrap">
                    {r.autoSuspend && <Badge variant="outline" className="text-xs text-red-400 border-red-400/30">Auto-suspend</Badge>}
                    {r.notifyOnWarning && <Badge variant="outline" className="text-xs text-sky-400 border-sky-400/30">Notify</Badge>}
                  </div>
                  {r.notes && <p className="text-xs text-muted-foreground mt-1">{r.notes}</p>}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

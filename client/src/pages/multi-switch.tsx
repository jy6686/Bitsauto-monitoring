import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import {
  Layers, RefreshCw, Plus, Pencil, Trash2, TestTube2, CheckCircle2,
  XCircle, AlertTriangle, WifiOff, Wifi, Phone, Activity, Clock,
  BarChart2, Server, ChevronDown, ChevronUp, Eye, EyeOff, Star, Crown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Form, FormField, FormItem, FormLabel, FormControl, FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

// ── Types ──────────────────────────────────────────────────────────────────

type SwitchStatus = 'online' | 'offline' | 'error' | 'unconfigured';

interface SwitchResult {
  id: string;
  name: string;
  portalUrl: string;
  isPrimary: boolean;
  enabled: boolean;
  status: SwitchStatus;
  activeCalls: number;
  totalCalls: number;
  answeredCalls: number;
  asr: number;
  acd: number;
  totalMinutes: number;
  error?: string;
  polledAt: string;
}

interface ConsolidatedResponse {
  switches: SwitchResult[];
  aggregate: {
    totalActiveCalls: number;
    onlineSwitches: number;
    totalSwitches: number;
    overallAsr: number;
    avgAcd: number;
    totalMinutes: number;
  };
}

interface SwitchRecord {
  id: number;
  name: string;
  type: string;
  portalUrl: string | null;
  portalUsername: string | null;
  portalPassword: string | null;
  enabled: boolean | null;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  createdAt: string;
}

// ── Zod schema for add/edit form ───────────────────────────────────────────

const switchFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  portalUrl: z.string().url("Must be a valid URL (e.g. https://192.168.1.1:9000)"),
  portalUsername: z.string().min(1, "Username is required"),
  portalPassword: z.string().min(1, "Password is required"),
  enabled: z.boolean(),
});
type SwitchFormValues = z.infer<typeof switchFormSchema>;

// ── Helpers ─────────────────────────────────────────────────────────────────

function statusBadge(status: SwitchStatus) {
  switch (status) {
    case 'online':
      return <Badge className="bg-emerald-600 text-white gap-1"><Wifi className="w-3 h-3" />Online</Badge>;
    case 'offline':
      return <Badge className="bg-slate-500 text-white gap-1"><WifiOff className="w-3 h-3" />Disabled</Badge>;
    case 'error':
      return <Badge className="bg-red-600 text-white gap-1"><XCircle className="w-3 h-3" />Error</Badge>;
    case 'unconfigured':
      return <Badge className="bg-amber-500 text-white gap-1"><AlertTriangle className="w-3 h-3" />Unconfigured</Badge>;
  }
}

function fmtAcd(seconds: number) {
  if (!seconds) return '0s';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function fmtTime(iso: string) {
  try { return new Date(iso).toLocaleTimeString(); } catch { return '--'; }
}

// ── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({ icon: Icon, label, value, sub, color }: {
  icon: React.ElementType; label: string; value: string | number; sub?: string; color: string;
}) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`p-2 rounded-lg ${color}`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-xl font-bold" data-testid={`kpi-${label.replace(/\s+/g,'-').toLowerCase()}`}>{value}</p>
          {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Per-switch Card ───────────────────────────────────────────────────────────

function SwitchCard({ sw, isAdmin, onEdit }: {
  sw: SwitchResult; isAdmin: boolean; onEdit?: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isOnline = sw.status === 'online';

  return (
    <Card
      data-testid={`switch-card-${sw.id}`}
      className={`relative border-2 transition-colors ${
        sw.status === 'online'  ? 'border-emerald-500/40' :
        sw.status === 'error'   ? 'border-red-500/40' :
        sw.status === 'offline' ? 'border-slate-400/30' :
        'border-amber-400/30'
      }`}
    >
      {sw.isPrimary && (
        <div className="absolute -top-2 -right-2">
          <Badge className="bg-blue-600 text-white text-[10px] px-1 py-0 gap-0.5">
            <Star className="w-2.5 h-2.5" /> Primary
          </Badge>
        </div>
      )}

      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-base font-semibold truncate">{sw.name}</CardTitle>
            <p className="text-xs text-muted-foreground truncate">{sw.portalUrl || '(no URL)'}</p>
          </div>
          {statusBadge(sw.status)}
        </div>
      </CardHeader>

      <CardContent className="px-4 pb-3 space-y-3">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <div>
            <p className="text-muted-foreground text-xs">Active Calls</p>
            <p className="font-bold text-lg" data-testid={`sw-active-${sw.id}`}>
              {isOnline ? sw.activeCalls : '—'}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">ASR</p>
            <p className={`font-bold text-lg ${
              isOnline ? (sw.asr >= 60 ? 'text-emerald-500' : sw.asr >= 40 ? 'text-amber-500' : 'text-red-500') : 'text-muted-foreground'
            }`}>
              {isOnline ? `${sw.asr}%` : '—'}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Avg ACD</p>
            <p className="font-semibold">{isOnline ? fmtAcd(sw.acd) : '—'}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Total Calls</p>
            <p className="font-semibold">{isOnline ? sw.totalCalls.toLocaleString() : '—'}</p>
          </div>
        </div>

        {sw.status === 'error' && sw.error && (
          <div className="text-xs text-red-500 bg-red-50 dark:bg-red-950/30 rounded p-2 break-words">
            {sw.error}
          </div>
        )}

        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            Polled: {fmtTime(sw.polledAt)}
          </span>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs"
              onClick={() => setExpanded(v => !v)}
              data-testid={`btn-expand-${sw.id}`}
            >
              {expanded ? <ChevronUp className="w-3 h-3 mr-1" /> : <ChevronDown className="w-3 h-3 mr-1" />}
              {expanded ? 'Less' : 'More'}
            </Button>
            {isAdmin && !sw.isPrimary && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs"
                onClick={() => onEdit?.(sw.id)}
                data-testid={`btn-edit-card-${sw.id}`}
              >
                <Pencil className="w-3 h-3" />
              </Button>
            )}
          </div>
        </div>

        {expanded && (
          <div className="border-t pt-2 text-xs space-y-1 text-muted-foreground">
            <div className="flex justify-between">
              <span>Total Minutes (today)</span>
              <span className="font-medium text-foreground">{sw.totalMinutes.toLocaleString()} min</span>
            </div>
            <div className="flex justify-between">
              <span>Answered Calls</span>
              <span className="font-medium text-foreground">{sw.answeredCalls.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span>Portal URL</span>
              <span className="font-medium text-foreground break-all text-right max-w-[180px]">{sw.portalUrl || '—'}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Add / Edit Dialog ─────────────────────────────────────────────────────────

function SwitchFormDialog({
  open, onOpenChange, initialValues, switchId, onSuccess,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialValues?: Partial<SwitchFormValues>;
  switchId?: number;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isEdit = switchId !== undefined;
  const [showPass, setShowPass] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const form = useForm<SwitchFormValues>({
    resolver: zodResolver(switchFormSchema),
    defaultValues: {
      name: '', portalUrl: '', portalUsername: '', portalPassword: '', enabled: true,
      ...initialValues,
    },
  });

  useEffect(() => {
    if (open) {
      form.reset({ name: '', portalUrl: '', portalUsername: '', portalPassword: '', enabled: true, ...initialValues });
      setTestResult(null);
    }
  }, [open]);

  const saveMutation = useMutation({
    mutationFn: async (values: SwitchFormValues) => {
      const payload = { ...values, type: 'sippy' };
      if (isEdit) {
        return apiRequest('PATCH', `/api/switches/${switchId}`, payload);
      }
      return apiRequest('POST', '/api/switches', payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/switches'] });
      queryClient.invalidateQueries({ queryKey: ['/api/switches/consolidated'] });
      toast({ title: isEdit ? 'Switch updated' : 'Switch added', description: form.getValues('name') });
      onOpenChange(false);
      onSuccess();
    },
    onError: (err: any) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  async function handleTest() {
    if (!isEdit) { toast({ title: 'Save the switch first, then test connection.' }); return; }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await apiRequest('POST', `/api/switches/${switchId}/test`, {});
      const data = await res.json();
      setTestResult(data);
    } catch (err: any) {
      setTestResult({ success: false, message: err.message });
    } finally {
      setTesting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Switch' : 'Add Switch'}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(v => saveMutation.mutate(v))} className="space-y-4">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem>
                <FormLabel>Display Name</FormLabel>
                <FormControl><Input placeholder="e.g. Secondary Switch EU" data-testid="input-switch-name" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="portalUrl" render={({ field }) => (
              <FormItem>
                <FormLabel>Portal URL</FormLabel>
                <FormControl><Input placeholder="https://192.168.1.1:9000" data-testid="input-switch-url" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="portalUsername" render={({ field }) => (
              <FormItem>
                <FormLabel>Username</FormLabel>
                <FormControl><Input placeholder="admin" data-testid="input-switch-user" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="portalPassword" render={({ field }) => (
              <FormItem>
                <FormLabel>Password</FormLabel>
                <FormControl>
                  <div className="relative">
                    <Input
                      type={showPass ? 'text' : 'password'}
                      placeholder="••••••••"
                      data-testid="input-switch-pass"
                      {...field}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="absolute right-1 top-1 h-7 w-7 p-0"
                      onClick={() => setShowPass(v => !v)}
                    >
                      {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </Button>
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="enabled" render={({ field }) => (
              <FormItem className="flex items-center gap-3">
                <FormLabel className="mt-0">Enabled</FormLabel>
                <FormControl>
                  <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-enabled" />
                </FormControl>
              </FormItem>
            )} />

            {isEdit && (
              <div className="space-y-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleTest}
                  disabled={testing}
                  data-testid="btn-test-connection"
                  className="gap-2"
                >
                  <TestTube2 className="w-4 h-4" />
                  {testing ? 'Testing…' : 'Test Connection'}
                </Button>
                {testResult && (
                  <div className={`text-xs rounded p-2 flex items-start gap-2 ${
                    testResult.success
                      ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400'
                      : 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400'
                  }`}>
                    {testResult.success
                      ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                      : <XCircle className="w-4 h-4 shrink-0 mt-0.5" />}
                    {testResult.message}
                  </div>
                )}
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={saveMutation.isPending} data-testid="btn-save-switch">
                {saveMutation.isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Switch'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function MultiSwitchPage() {
  const { user } = useAuth();
  const role = (user as any)?.role ?? 'viewer';
  const isAdmin = role === 'admin';
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [autoRefresh, setAutoRefresh] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [editSwitch, setEditSwitch] = useState<SwitchRecord | null>(null);

  const consolidatedQuery = useQuery<ConsolidatedResponse>({
    queryKey: ['/api/switches/consolidated'],
    refetchInterval: autoRefresh ? 30000 : false,
  });

  const switchListQuery = useQuery<SwitchRecord[]>({
    queryKey: ['/api/switches'],
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/switches/${id}`, undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/switches'] });
      queryClient.invalidateQueries({ queryKey: ['/api/switches/consolidated'] });
      toast({ title: 'Switch removed' });
    },
    onError: (err: any) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const promoteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest('POST', `/api/switches/${id}/promote`, {});
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/switches'] });
      queryClient.invalidateQueries({ queryKey: ['/api/switches/consolidated'] });
      toast({ title: 'Primary switch updated', description: data.message });
    },
    onError: (err: any) => toast({ title: 'Promote failed', description: err.message, variant: 'destructive' }),
  });

  const handleRefresh = useCallback(() => {
    consolidatedQuery.refetch();
  }, [consolidatedQuery]);

  function handleEditById(id: string) {
    const sw = switchListQuery.data?.find(s => String(s.id) === id);
    if (sw) setEditSwitch(sw);
  }

  const data = consolidatedQuery.data;
  const agg = data?.aggregate;
  const switches = data?.switches ?? [];
  const switchList = switchListQuery.data ?? [];
  const secondarySwitches = switchList.filter(s => s.type === 'sippy');

  return (
    <TooltipProvider>
      <div className="p-4 md:p-6 space-y-6 max-w-[1400px] mx-auto">

        {/* ── Header ── */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-600 rounded-lg">
              <Layers className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Multi-Switch Consolidated View</h1>
              <p className="text-sm text-muted-foreground">Real-time metrics across all connected Sippy softswitches</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Auto-refresh</span>
              <Switch
                checked={autoRefresh}
                onCheckedChange={setAutoRefresh}
                data-testid="switch-auto-refresh"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={consolidatedQuery.isFetching}
              data-testid="btn-refresh"
              className="gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${consolidatedQuery.isFetching ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>

        {/* ── Global KPIs ── */}
        {consolidatedQuery.isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <Card key={i}><CardContent className="p-4"><Skeleton className="h-12 w-full" /></CardContent></Card>
            ))}
          </div>
        ) : consolidatedQuery.isError ? (
          <div className="text-sm text-red-500 bg-red-50 dark:bg-red-950/30 rounded-lg p-4">
            Failed to load consolidated data — {(consolidatedQuery.error as any)?.message}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard
              icon={Phone}
              label="Total Active Calls"
              value={agg?.totalActiveCalls ?? 0}
              sub="across all switches"
              color="bg-blue-600"
            />
            <KpiCard
              icon={Server}
              label="Switches Online"
              value={`${agg?.onlineSwitches ?? 0} / ${agg?.totalSwitches ?? 0}`}
              sub="currently reachable"
              color={agg && agg.onlineSwitches === agg.totalSwitches ? 'bg-emerald-600' : 'bg-amber-500'}
            />
            <KpiCard
              icon={Activity}
              label="Overall ASR"
              value={`${agg?.overallAsr ?? 0}%`}
              sub="avg across online switches"
              color={agg && agg.overallAsr >= 60 ? 'bg-emerald-600' : 'bg-amber-500'}
            />
            <KpiCard
              icon={Clock}
              label="Avg ACD"
              value={fmtAcd(agg?.avgAcd ?? 0)}
              sub="avg call duration"
              color="bg-indigo-600"
            />
          </div>
        )}

        {/* ── Per-Switch Cards ── */}
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Switch Status</h2>
          {consolidatedQuery.isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {[...Array(3)].map((_, i) => (
                <Card key={i}><CardContent className="p-4"><Skeleton className="h-40 w-full" /></CardContent></Card>
              ))}
            </div>
          ) : switches.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <Server className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No switches configured. Add a secondary switch below.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {switches.map(sw => (
                <SwitchCard
                  key={sw.id}
                  sw={sw}
                  isAdmin={isAdmin}
                  onEdit={handleEditById}
                />
              ))}
            </div>
          )}
        </div>

        <Separator />

        {/* ── Switch Management (Admin) ── */}
        <div className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="font-semibold">Secondary Switches</h2>
              <p className="text-xs text-muted-foreground">
                Add additional Sippy softswitch endpoints. The primary switch is configured in Settings.
              </p>
            </div>
            {isAdmin && (
              <Button
                size="sm"
                onClick={() => setAddOpen(true)}
                data-testid="btn-add-switch"
                className="gap-2"
              >
                <Plus className="w-4 h-4" />
                Add Switch
              </Button>
            )}
          </div>

          {switchListQuery.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : secondarySwitches.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              No secondary switches configured yet.
              {isAdmin && (
                <span className="ml-1">
                  Click <strong>Add Switch</strong> to connect another Sippy instance.
                </span>
              )}
            </div>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>URL</TableHead>
                    <TableHead>Username</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last Sync</TableHead>
                    {isAdmin && <TableHead className="text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {secondarySwitches.map(sw => {
                    const liveResult = switches.find(r => r.id === String(sw.id));
                    return (
                      <TableRow key={sw.id} data-testid={`row-switch-${sw.id}`}>
                        <TableCell className="font-medium">{sw.name}</TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                          {sw.portalUrl || '—'}
                        </TableCell>
                        <TableCell className="text-xs">{sw.portalUsername || '—'}</TableCell>
                        <TableCell>
                          {liveResult ? statusBadge(liveResult.status) : (
                            sw.enabled ? (
                              <Badge variant="outline" className="text-muted-foreground gap-1">
                                <Wifi className="w-3 h-3" /> Pending
                              </Badge>
                            ) : (
                              <Badge variant="secondary">Disabled</Badge>
                            )
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {sw.lastSyncAt ? new Date(sw.lastSyncAt).toLocaleString() : '—'}
                        </TableCell>
                        {isAdmin && (
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              {/* Set as Primary */}
                              <AlertDialog>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <AlertDialogTrigger asChild>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-7 w-7 p-0 text-amber-500 hover:text-amber-600"
                                        data-testid={`btn-promote-${sw.id}`}
                                        disabled={promoteMutation.isPending}
                                      >
                                        <Crown className="w-3.5 h-3.5" />
                                      </Button>
                                    </AlertDialogTrigger>
                                  </TooltipTrigger>
                                  <TooltipContent>Set as Primary</TooltipContent>
                                </Tooltip>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle className="flex items-center gap-2">
                                      <Crown className="w-4 h-4 text-amber-500" /> Set as Primary Switch?
                                    </AlertDialogTitle>
                                    <AlertDialogDescription className="space-y-2">
                                      <span className="block">
                                        This will promote <strong>{sw.name}</strong> to be the primary Sippy switch.
                                      </span>
                                      <span className="block text-sm">
                                        The current primary switch will automatically be saved as a secondary switch so no connection is lost.
                                        All app features (Live Calls, Rate Cards, CDRs, etc.) will use <strong>{sw.name}</strong> going forward.
                                      </span>
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction
                                      className="bg-amber-600 hover:bg-amber-700 text-white"
                                      onClick={() => promoteMutation.mutate(sw.id)}
                                      data-testid={`btn-confirm-promote-${sw.id}`}
                                    >
                                      <Crown className="w-3.5 h-3.5 mr-1.5" /> Set as Primary
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>

                              {/* Edit */}
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 w-7 p-0"
                                    onClick={() => setEditSwitch(sw)}
                                    data-testid={`btn-edit-${sw.id}`}
                                  >
                                    <Pencil className="w-3.5 h-3.5" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Edit</TooltipContent>
                              </Tooltip>

                              {/* Delete */}
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 w-7 p-0 text-red-500 hover:text-red-600"
                                    data-testid={`btn-delete-${sw.id}`}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Delete Switch?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      This will remove <strong>{sw.name}</strong> from the consolidated view. This cannot be undone.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction
                                      className="bg-red-600 hover:bg-red-700"
                                      onClick={() => deleteMutation.mutate(sw.id)}
                                      data-testid={`btn-confirm-delete-${sw.id}`}
                                    >
                                      Delete
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        {/* ── Info bar ── */}
        <div className="rounded-lg bg-muted/40 border p-3 text-xs text-muted-foreground space-y-1">
          <p className="font-medium text-foreground">Architecture Note</p>
          <p>
            The <strong>Primary Switch</strong> is the main Sippy instance configured in Settings → Switch Configuration.
            Secondary switches are additional Sippy softswitch instances polled in parallel via XML-RPC.
            Metrics shown are real-time from each switch's <code>call_control.getCountersStats</code> XML-RPC endpoint.
            Auto-refresh polls every 30 seconds.
          </p>
        </div>

        {/* ── Add dialog ── */}
        <SwitchFormDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          onSuccess={() => {
            consolidatedQuery.refetch();
            switchListQuery.refetch();
          }}
        />

        {/* ── Edit dialog ── */}
        {editSwitch && (
          <SwitchFormDialog
            open={!!editSwitch}
            onOpenChange={v => { if (!v) setEditSwitch(null); }}
            switchId={editSwitch.id}
            initialValues={{
              name: editSwitch.name,
              portalUrl: editSwitch.portalUrl || '',
              portalUsername: editSwitch.portalUsername || '',
              portalPassword: editSwitch.portalPassword || '',
              enabled: editSwitch.enabled ?? true,
            }}
            onSuccess={() => {
              consolidatedQuery.refetch();
              switchListQuery.refetch();
            }}
          />
        )}
      </div>
    </TooltipProvider>
  );
}

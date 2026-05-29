import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CalendarClock, Plus, Pencil, Trash2, Play, CheckCircle, XCircle, RefreshCw } from "lucide-react";

interface InvoiceSchedule {
  id: number; companyId: number | null; companyName: string | null;
  iAccount: number | null; iTariff: string | null;
  frequency: string; dayOfWeek: number | null; dayOfMonth: number | null;
  timezone: string | null; autoApprove: boolean | null; active: boolean;
  lastRunAt: string | null; nextRunAt: string | null; notes: string | null;
  createdAt: string;
}

interface SippyTariff { iTariff: number; name: string; currency: string; }
interface Company { id: number; name: string; shortCode: string; }

const FREQ_LABELS: Record<string, string> = {
  weekly: "Weekly", fortnightly: "Fortnightly", monthly: "Monthly",
};
const DAYS_OF_WEEK = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const TIMEZONES = ["Etc/UTC","Asia/Karachi","Asia/Dubai","Europe/London","America/New_York","America/Los_Angeles","Asia/Singapore","Europe/Berlin"];

const EMPTY_FORM = {
  companyId: "", companyName: "", iAccount: "", iTariff: "",
  frequency: "monthly", dayOfWeek: "1", dayOfMonth: "1",
  timezone: "Etc/UTC", autoApprove: false, active: true, notes: "",
};

export default function InvoiceSchedulesPage() {
  const { toast }   = useToast();
  const queryClient = useQueryClient();
  const [showForm,  setShowForm]  = useState(false);
  const [editId,    setEditId]    = useState<number | null>(null);
  const [deleteId,  setDeleteId]  = useState<number | null>(null);
  const [runId,     setRunId]     = useState<number | null>(null);
  const [form,      setForm]      = useState(EMPTY_FORM);
  const [running,   setRunning]   = useState<Record<number, boolean>>({});

  const { data: schedules = [], isLoading } = useQuery<InvoiceSchedule[]>({
    queryKey: ["/api/invoice-schedules"],
    queryFn: () => apiRequest("GET", "/api/invoice-schedules").then(r => r.json()),
  });

  const { data: companies = [] } = useQuery<Company[]>({
    queryKey: ["/api/companies"],
    queryFn: () => apiRequest("GET", "/api/companies").then(r => r.json()),
    staleTime: 60_000,
  });

  const { data: tariffsRaw = [] } = useQuery<SippyTariff[]>({
    queryKey: ["/api/sippy/tariffs"],
    queryFn: () => apiRequest("GET", "/api/sippy/tariffs").then(r => r.json()),
    staleTime: 120_000,
    enabled: showForm,
  });
  const tariffs: SippyTariff[] = Array.isArray(tariffsRaw) ? tariffsRaw : [];

  const saveMutation = useMutation({
    mutationFn: () => {
      const body = {
        companyId:   form.companyId   ? Number(form.companyId)   : null,
        companyName: form.companyName || null,
        iAccount:    form.iAccount    ? Number(form.iAccount)    : null,
        iTariff:     form.iTariff     || null,
        frequency:   form.frequency,
        dayOfWeek:   Number(form.dayOfWeek),
        dayOfMonth:  Number(form.dayOfMonth),
        timezone:    form.timezone,
        autoApprove: form.autoApprove,
        active:      form.active,
        notes:       form.notes || null,
      };
      return editId
        ? apiRequest("PATCH", `/api/invoice-schedules/${editId}`, body).then(r => r.json())
        : apiRequest("POST",  "/api/invoice-schedules", body).then(r => r.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoice-schedules"] });
      setShowForm(false);
      setEditId(null);
      setForm(EMPTY_FORM);
      toast({ title: editId ? "Schedule updated" : "Schedule created" });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/invoice-schedules/${id}`).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoice-schedules"] });
      setDeleteId(null);
      toast({ title: "Schedule deleted" });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  function openEdit(s: InvoiceSchedule) {
    setForm({
      companyId:   String(s.companyId ?? ""),
      companyName: s.companyName ?? "",
      iAccount:    String(s.iAccount ?? ""),
      iTariff:     s.iTariff ?? "",
      frequency:   s.frequency,
      dayOfWeek:   String(s.dayOfWeek ?? 1),
      dayOfMonth:  String(s.dayOfMonth ?? 1),
      timezone:    s.timezone ?? "Etc/UTC",
      autoApprove: s.autoApprove ?? false,
      active:      s.active,
      notes:       s.notes ?? "",
    });
    setEditId(s.id);
    setShowForm(true);
  }

  async function runNow(id: number) {
    setRunning(r => ({ ...r, [id]: true }));
    try {
      const res = await apiRequest("POST", `/api/invoice-schedules/${id}/run`).then(r => r.json());
      queryClient.invalidateQueries({ queryKey: ["/api/invoice-schedules"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      toast({ title: "Schedule run", description: `Invoice ${res.invoiceNumber ?? ""} created as draft.` });
    } catch (e: any) {
      toast({ title: "Run failed", description: e.message, variant: "destructive" });
    } finally {
      setRunning(r => ({ ...r, [id]: false }));
    }
    setRunId(null);
  }

  function onCompanySelect(id: string) {
    const c = companies.find(c => String(c.id) === id);
    setForm(f => ({ ...f, companyId: id, companyName: c?.name ?? "" }));
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CalendarClock className="h-6 w-6 text-primary" />
            Invoice Schedules
          </h1>
          <p className="text-muted-foreground mt-1">
            Configure automated invoice generation per client. Invoices are always created as DRAFT.
          </p>
        </div>
        <Button data-testid="button-add-schedule" onClick={() => { setForm(EMPTY_FORM); setEditId(null); setShowForm(true); }}>
          <Plus className="h-4 w-4 mr-2" />Add Schedule
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Total Schedules", value: schedules.length },
          { label: "Active",          value: schedules.filter(s => s.active).length },
          { label: "Paused",          value: schedules.filter(s => !s.active).length },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="pt-4">
              <span className="text-xs text-muted-foreground">{s.label}</span>
              <p className="text-2xl font-bold mt-1 font-mono">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* List */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Configured Schedules</CardTitle>
          <CardDescription className="text-xs">{schedules.length} schedule(s) registered</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading…</div>
          ) : schedules.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <CalendarClock className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p>No schedules yet. Add one to automate invoice generation.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Client</TableHead>
                    <TableHead>Tariff</TableHead>
                    <TableHead>Frequency</TableHead>
                    <TableHead>Timezone</TableHead>
                    <TableHead>Auto-Approve</TableHead>
                    <TableHead>Last Run</TableHead>
                    <TableHead>Next Run</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {schedules.map(s => (
                    <TableRow key={s.id} data-testid={`row-schedule-${s.id}`}>
                      <TableCell className="font-medium">{s.companyName ?? `Account ${s.iAccount ?? "?"}`}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{s.iTariff ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs capitalize">{FREQ_LABELS[s.frequency] ?? s.frequency}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{s.timezone ?? "UTC"}</TableCell>
                      <TableCell>
                        {s.autoApprove
                          ? <CheckCircle className="h-4 w-4 text-emerald-400" />
                          : <XCircle className="h-4 w-4 text-slate-500" />}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground font-mono">
                        {s.lastRunAt ? new Date(s.lastRunAt).toLocaleDateString() : "Never"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground font-mono">
                        {s.nextRunAt ? new Date(s.nextRunAt).toLocaleDateString() : "—"}
                      </TableCell>
                      <TableCell>
                        {s.active
                          ? <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-400 border-emerald-500/30">Active</Badge>
                          : <Badge variant="outline" className="text-xs bg-slate-500/10 text-slate-400 border-slate-500/30">Paused</Badge>}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button data-testid={`button-run-${s.id}`} variant="ghost" size="sm" onClick={() => setRunId(s.id)} disabled={running[s.id]}>
                            {running[s.id] ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5 text-blue-400" />}
                          </Button>
                          <Button data-testid={`button-edit-schedule-${s.id}`} variant="ghost" size="sm" onClick={() => openEdit(s)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button data-testid={`button-delete-schedule-${s.id}`} variant="ghost" size="sm" onClick={() => setDeleteId(s.id)}>
                            <Trash2 className="h-3.5 w-3.5 text-red-400" />
                          </Button>
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

      {/* Form Dialog */}
      <Dialog open={showForm} onOpenChange={o => { if (!o) { setShowForm(false); setEditId(null); setForm(EMPTY_FORM); } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editId ? "Edit Schedule" : "New Invoice Schedule"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs mb-1.5 block">Client</Label>
              <Select value={form.companyId} onValueChange={onCompanySelect}>
                <SelectTrigger data-testid="select-schedule-company">
                  <SelectValue placeholder="Select client…" />
                </SelectTrigger>
                <SelectContent>
                  {companies.map(c => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs mb-1.5 block">Sippy Account ID</Label>
                <Input data-testid="input-schedule-iaccount" value={form.iAccount} onChange={e => setForm(f => ({ ...f, iAccount: e.target.value }))} placeholder="e.g. 42" type="number" />
              </div>
              <div>
                <Label className="text-xs mb-1.5 block">Service Plan (Tariff)</Label>
                <Select value={form.iTariff} onValueChange={v => setForm(f => ({ ...f, iTariff: v }))}>
                  <SelectTrigger data-testid="select-schedule-tariff">
                    <SelectValue placeholder="Select tariff…" />
                  </SelectTrigger>
                  <SelectContent>
                    {tariffs.sort((a,b) => a.name.localeCompare(b.name)).map(t => (
                      <SelectItem key={t.iTariff} value={String(t.iTariff)}>
                        {t.name} <span className="text-muted-foreground text-xs">({t.currency} · {t.iTariff})</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs mb-1.5 block">Frequency</Label>
                <Select value={form.frequency} onValueChange={v => setForm(f => ({ ...f, frequency: v }))}>
                  <SelectTrigger data-testid="select-schedule-frequency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="fortnightly">Fortnightly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs mb-1.5 block">Timezone</Label>
                <Select value={form.timezone} onValueChange={v => setForm(f => ({ ...f, timezone: v }))}>
                  <SelectTrigger data-testid="select-schedule-timezone">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIMEZONES.map(tz => (
                      <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {form.frequency === "weekly" || form.frequency === "fortnightly" ? (
              <div>
                <Label className="text-xs mb-1.5 block">Day of Week (invoice cut-off)</Label>
                <Select value={form.dayOfWeek} onValueChange={v => setForm(f => ({ ...f, dayOfWeek: v }))}>
                  <SelectTrigger data-testid="select-schedule-dow">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DAYS_OF_WEEK.map((d, i) => (
                      <SelectItem key={i + 1} value={String(i + 1)}>{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div>
                <Label className="text-xs mb-1.5 block">Day of Month (invoice cut-off)</Label>
                <Input data-testid="input-schedule-dom" type="number" min={1} max={28} value={form.dayOfMonth} onChange={e => setForm(f => ({ ...f, dayOfMonth: e.target.value }))} />
              </div>
            )}
            <div className="flex items-center justify-between py-2">
              <div>
                <p className="text-sm font-medium">Auto-Approve</p>
                <p className="text-xs text-muted-foreground">Automatically approve generated invoices</p>
              </div>
              <Switch data-testid="toggle-auto-approve" checked={form.autoApprove} onCheckedChange={v => setForm(f => ({ ...f, autoApprove: v }))} />
            </div>
            <div className="flex items-center justify-between py-2">
              <div>
                <p className="text-sm font-medium">Active</p>
                <p className="text-xs text-muted-foreground">Schedule will run automatically when enabled</p>
              </div>
              <Switch data-testid="toggle-schedule-active" checked={form.active} onCheckedChange={v => setForm(f => ({ ...f, active: v }))} />
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Notes</Label>
              <Input data-testid="input-schedule-notes" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes…" />
            </div>
            <Button
              data-testid="button-save-schedule"
              className="w-full"
              onClick={() => saveMutation.mutate()}
              disabled={!form.iTariff || saveMutation.isPending}
            >
              {saveMutation.isPending ? "Saving…" : editId ? "Update Schedule" : "Create Schedule"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Run confirm */}
      <AlertDialog open={runId != null} onOpenChange={o => !o && setRunId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Run Schedule Now?</AlertDialogTitle>
            <AlertDialogDescription>
              This will generate a DRAFT invoice for the current billing period. You can review and approve it afterward.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction data-testid="button-confirm-run" onClick={() => runId && runNow(runId)}>
              Generate Invoice
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirm */}
      <AlertDialog open={deleteId != null} onOpenChange={o => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Schedule?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently remove the schedule. Past invoices are not affected.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction data-testid="button-confirm-delete-schedule" onClick={() => deleteId && deleteMutation.mutate(deleteId)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

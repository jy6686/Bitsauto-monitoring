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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Bell, Send, AlertTriangle, Clock, DollarSign, Mail, Settings, RefreshCw, CheckCircle,
} from "lucide-react";

interface OverdueInvoice {
  id:             number;
  invoiceNumber:  string;
  customerName:   string | null;
  periodStart:    string | null;
  periodEnd:      string | null;
  totalReproduced: number | null;
  status:         string;
  approvedAt:     string | null;
  daysPastGrace:  number;
}

interface ReminderConfig {
  id:                   number;
  graceDays:            number;
  reminderIntervalDays: number;
  maxReminders:         number;
  enabled:              boolean;
}

interface ReminderResult {
  overdue:   OverdueInvoice[];
  config:    ReminderConfig;
  sentCount: number;
}

export default function PaymentRemindersPage() {
  const { toast }   = useToast();
  const queryClient = useQueryClient();
  const [editConfig, setEditConfig] = useState(false);
  const [configForm, setConfigForm] = useState<Partial<ReminderConfig>>({});
  const [sending,    setSending]    = useState<Record<number, boolean>>({});

  const { data, isLoading } = useQuery<ReminderResult>({
    queryKey: ["/api/billing/payment-reminders"],
    queryFn: () => apiRequest("GET", "/api/billing/payment-reminders").then(r => r.json()),
    staleTime: 30_000,
  });

  const overdue = data?.overdue ?? [];
  const config  = data?.config;

  const saveConfig = useMutation({
    mutationFn: () => apiRequest("PATCH", "/api/billing/payment-reminders/config", configForm).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/billing/payment-reminders"] });
      setEditConfig(false);
      toast({ title: "Reminder config updated" });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const sendAll = useMutation({
    mutationFn: () => apiRequest("POST", "/api/billing/payment-reminders/send-all").then(r => r.json()),
    onSuccess: (res: { sent: number; skipped: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/billing/payment-reminders"] });
      toast({ title: `${res.sent} reminder(s) sent`, description: `${res.skipped} skipped (recently reminded).` });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  async function sendOne(id: number, customerName: string) {
    setSending(s => ({ ...s, [id]: true }));
    try {
      await apiRequest("POST", `/api/billing/payment-reminders/send/${id}`).then(r => r.json());
      queryClient.invalidateQueries({ queryKey: ["/api/billing/payment-reminders"] });
      toast({ title: `Reminder sent to ${customerName}` });
    } catch (e: any) {
      toast({ title: "Failed to send", description: e.message, variant: "destructive" });
    } finally {
      setSending(s => ({ ...s, [id]: false }));
    }
  }

  function startEditConfig() {
    setConfigForm({
      graceDays:            config?.graceDays            ?? 7,
      reminderIntervalDays: config?.reminderIntervalDays ?? 7,
      maxReminders:         config?.maxReminders         ?? 3,
      enabled:              config?.enabled              ?? false,
    });
    setEditConfig(true);
  }

  const urgencyColor = (days: number) => {
    if (days > 30) return "bg-red-500/15 text-red-400 border-red-500/30";
    if (days > 14) return "bg-amber-500/15 text-amber-400 border-amber-500/30";
    return "bg-yellow-500/15 text-yellow-400 border-yellow-500/30";
  };

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bell className="h-6 w-6 text-primary" />
            Payment Reminders
          </h1>
          <p className="text-muted-foreground mt-1">
            Monitor overdue approved invoices and trigger payment reminder emails.
          </p>
        </div>
        <div className="flex gap-2">
          <Button data-testid="button-edit-config" variant="outline" onClick={startEditConfig}>
            <Settings className="h-4 w-4 mr-2" />Config
          </Button>
          {overdue.length > 0 && (
            <Button data-testid="button-send-all" onClick={() => sendAll.mutate()} disabled={sendAll.isPending || !config?.enabled}>
              {sendAll.isPending ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
              Send All Reminders
            </Button>
          )}
        </div>
      </div>

      {/* Config summary / inline edit */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Settings className="h-4 w-4" /> Reminder Settings
            </CardTitle>
            {config && (
              <Badge variant="outline" className={config.enabled
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                : "bg-slate-500/10 text-slate-400 border-slate-500/30"}>
                {config.enabled ? "Enabled" : "Disabled"}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {!editConfig ? (
            <div className="grid grid-cols-3 gap-6 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Grace Period</p>
                <p className="font-semibold mt-0.5">{config?.graceDays ?? "—"} days after approval</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Reminder Interval</p>
                <p className="font-semibold mt-0.5">Every {config?.reminderIntervalDays ?? "—"} days</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Max Reminders</p>
                <p className="font-semibold mt-0.5">{config?.maxReminders ?? "—"} per invoice</p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs mb-1.5 block">Grace Period (days)</Label>
                  <Input
                    data-testid="input-grace-days"
                    type="number" min={0} max={90}
                    value={configForm.graceDays ?? ""}
                    onChange={e => setConfigForm(f => ({ ...f, graceDays: Number(e.target.value) }))}
                  />
                </div>
                <div>
                  <Label className="text-xs mb-1.5 block">Interval (days)</Label>
                  <Input
                    data-testid="input-interval-days"
                    type="number" min={1} max={30}
                    value={configForm.reminderIntervalDays ?? ""}
                    onChange={e => setConfigForm(f => ({ ...f, reminderIntervalDays: Number(e.target.value) }))}
                  />
                </div>
                <div>
                  <Label className="text-xs mb-1.5 block">Max Reminders</Label>
                  <Input
                    data-testid="input-max-reminders"
                    type="number" min={1} max={10}
                    value={configForm.maxReminders ?? ""}
                    onChange={e => setConfigForm(f => ({ ...f, maxReminders: Number(e.target.value) }))}
                  />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  data-testid="toggle-reminders-enabled"
                  checked={configForm.enabled ?? false}
                  onCheckedChange={v => setConfigForm(f => ({ ...f, enabled: v }))}
                />
                <Label className="text-sm">Enable automatic reminder emails</Label>
              </div>
              <div className="flex gap-2">
                <Button data-testid="button-save-config" size="sm" onClick={() => saveConfig.mutate()} disabled={saveConfig.isPending}>
                  {saveConfig.isPending ? "Saving…" : "Save Config"}
                </Button>
                <Button data-testid="button-cancel-config" size="sm" variant="outline" onClick={() => setEditConfig(false)}>Cancel</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Overdue Invoices",  value: overdue.length,                                                         icon: <AlertTriangle className="h-4 w-4 text-red-400" /> },
          { label: "Total Outstanding", value: `$${overdue.reduce((s, i) => s + (i.totalReproduced ?? 0), 0).toFixed(2)}`, icon: <DollarSign className="h-4 w-4 text-amber-400" /> },
          { label: "Avg Days Overdue",  value: overdue.length ? Math.round(overdue.reduce((s, i) => s + i.daysPastGrace, 0) / overdue.length) : 0, icon: <Clock className="h-4 w-4 text-slate-400" /> },
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

      {/* Overdue list */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Mail className="h-4 w-4" /> Overdue Invoices
          </CardTitle>
          <CardDescription className="text-xs">
            Approved invoices past the grace period · {overdue.length} invoice(s)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading…</div>
          ) : overdue.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <CheckCircle className="h-8 w-8 mx-auto mb-2 text-emerald-400 opacity-60" />
              <p>No overdue invoices — all within grace period.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Approved</TableHead>
                    <TableHead>Days Overdue</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overdue.map(inv => (
                    <TableRow key={inv.id} data-testid={`row-overdue-${inv.id}`}>
                      <TableCell className="font-mono text-sm">{inv.invoiceNumber}</TableCell>
                      <TableCell className="text-sm">{inv.customerName ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground font-mono">
                        {inv.periodStart ?? "—"} → {inv.periodEnd ?? "—"}
                      </TableCell>
                      <TableCell className="font-mono text-sm font-semibold">
                        ${(inv.totalReproduced ?? 0).toFixed(2)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {inv.approvedAt ? new Date(inv.approvedAt).toLocaleDateString() : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-xs ${urgencyColor(inv.daysPastGrace)}`}>
                          {inv.daysPastGrace}d overdue
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          data-testid={`button-remind-${inv.id}`}
                          variant="ghost"
                          size="sm"
                          onClick={() => sendOne(inv.id, inv.customerName ?? "Client")}
                          disabled={sending[inv.id] || !config?.enabled}
                          title={!config?.enabled ? "Enable reminders in config first" : undefined}
                        >
                          {sending[inv.id]
                            ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                            : <Mail className="h-3.5 w-3.5 text-blue-400" />}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

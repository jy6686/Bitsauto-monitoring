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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
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
import {
  Workflow, Plus, Pencil, Trash2, Mail, MessageSquare, ShieldCheck,
  TrendingDown, Clock, Zap, Route, Radio, Wrench, BarChart3, FileText,
  ArrowRightLeft, CheckCircle2, AlertTriangle,
} from "lucide-react";

interface CommunicationPolicy {
  id:               number;
  triggerType:      string;
  severityFilter:   string;
  senderProfileId?: number;
  templateType?:    string;
  recipientGroup:   string;
  channelType:      string;
  autoDraft:        boolean;
  cooldownMinutes:  number;
  approvalRequired: boolean;
  enabled:          boolean;
  description?:     string;
  createdAt:        string;
}

interface SenderProfile { id: number; name: string; communicationType: string; emailAddress: string; }

const TRIGGER_TYPES = [
  { value: 'rate_change',          label: 'Rate Change',            icon: TrendingDown, color: 'text-red-400'     },
  { value: 'interval_change',      label: 'Interval Change',        icon: Clock,        color: 'text-amber-400'   },
  { value: 'tariff_added',         label: 'Tariff Added',           icon: Plus,         color: 'text-emerald-400' },
  { value: 'tariff_removed',       label: 'Tariff Removed',         icon: Trash2,       color: 'text-rose-400'    },
  { value: 'invoice_generated',    label: 'Invoice Generated',      icon: FileText,     color: 'text-blue-400'    },
  { value: 'reconciliation_drift', label: 'Reconciliation Drift',   icon: ArrowRightLeft,color: 'text-orange-400' },
  { value: 'qos_advisory',         label: 'QoS Advisory',           icon: Radio,        color: 'text-purple-400'  },
  { value: 'fraud_advisory',       label: 'Fraud Advisory',         icon: ShieldCheck,  color: 'text-rose-400'    },
  { value: 'executive_report',     label: 'Executive Report Ready', icon: BarChart3,    color: 'text-violet-400'  },
];

const SEVERITY_OPTIONS = [
  { value: 'all',      label: 'All severities' },
  { value: 'minor',    label: 'Minor+' },
  { value: 'major',    label: 'Major+' },
  { value: 'critical', label: 'Critical only' },
];

const RECIPIENT_GROUPS = [
  { value: 'all_clients',   label: 'All Clients' },
  { value: 'management',    label: 'Management' },
  { value: 'finance',       label: 'Finance Team' },
  { value: 'noc',           label: 'NOC' },
  { value: 'internal_team', label: 'Internal Team' },
];

const CHANNEL_TYPES = [
  { value: 'email',            label: 'Email only' },
  { value: 'whatsapp',         label: 'WhatsApp only' },
  { value: 'email+whatsapp',   label: 'Email + WhatsApp' },
];

const TEMPLATE_TYPES = [
  { value: 'rate_change',        label: 'Rate Change Notice' },
  { value: 'interval_change',    label: 'Billing Interval Change' },
  { value: 'surcharge_added',    label: 'Surcharge Added' },
  { value: 'qos_advisory',       label: 'QoS Advisory' },
  { value: 'routing_advisory',   label: 'Routing Advisory' },
  { value: 'fraud_advisory',     label: 'Fraud Advisory' },
  { value: 'maintenance_notice', label: 'Maintenance Notice' },
];

const EMPTY_FORM = {
  triggerType:      'rate_change',
  severityFilter:   'all',
  senderProfileId:  '',
  templateType:     'rate_change',
  recipientGroup:   'all_clients',
  channelType:      'email',
  autoDraft:        true,
  cooldownMinutes:  0,
  approvalRequired: true,
  enabled:          true,
  description:      '',
};

function TriggerBadge({ type }: { type: string }) {
  const t = TRIGGER_TYPES.find(t => t.value === type);
  const Icon = t?.icon ?? Zap;
  return (
    <span className={`flex items-center gap-1.5 text-xs font-medium ${t?.color ?? 'text-slate-400'}`}>
      <Icon className="h-3.5 w-3.5" />
      {t?.label ?? type}
    </span>
  );
}

function ChannelBadge({ type }: { type: string }) {
  if (type === 'email+whatsapp') return (
    <span className="flex gap-1">
      <Badge variant="outline" className="text-xs px-1.5 bg-blue-500/10 border-blue-500/30 text-blue-400"><Mail className="h-3 w-3" /></Badge>
      <Badge variant="outline" className="text-xs px-1.5 bg-green-500/10 border-green-500/30 text-green-400"><MessageSquare className="h-3 w-3" /></Badge>
    </span>
  );
  if (type === 'whatsapp') return <Badge variant="outline" className="text-xs bg-green-500/10 border-green-500/30 text-green-400"><MessageSquare className="h-3 w-3 mr-1" />WhatsApp</Badge>;
  return <Badge variant="outline" className="text-xs bg-blue-500/10 border-blue-500/30 text-blue-400"><Mail className="h-3 w-3 mr-1" />Email</Badge>;
}

export default function CommunicationPoliciesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing]     = useState<CommunicationPolicy | null>(null);
  const [creating, setCreating]   = useState(false);
  const [deleteId, setDeleteId]   = useState<number | null>(null);
  const [form, setForm]           = useState(EMPTY_FORM);

  const { data: policies = [], isLoading } = useQuery<CommunicationPolicy[]>({
    queryKey: ["/api/communication-policies"],
    queryFn: () => apiRequest("GET", "/api/communication-policies").then(r => r.json()),
  });

  const { data: senderProfiles = [] } = useQuery<SenderProfile[]>({
    queryKey: ["/api/smtp-sender-profiles"],
    queryFn: () => apiRequest("GET", "/api/smtp-sender-profiles").then(r => r.json()),
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/communication-policies", data).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/communication-policies"] });
      setCreating(false);
      toast({ title: "Policy created" });
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: any) => apiRequest("PATCH", `/api/communication-policies/${id}`, data).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/communication-policies"] });
      setEditing(null);
      toast({ title: "Policy updated" });
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      apiRequest("PATCH", `/api/communication-policies/${id}`, { enabled }).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/communication-policies"] }),
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/communication-policies/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/communication-policies"] });
      setDeleteId(null);
      toast({ title: "Policy deleted" });
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const openCreate = () => { setForm(EMPTY_FORM); setCreating(true); };
  const openEdit = (p: CommunicationPolicy) => {
    setForm({
      triggerType:      p.triggerType,
      severityFilter:   p.severityFilter,
      senderProfileId:  p.senderProfileId != null ? String(p.senderProfileId) : '',
      templateType:     p.templateType ?? 'rate_change',
      recipientGroup:   p.recipientGroup,
      channelType:      p.channelType,
      autoDraft:        p.autoDraft,
      cooldownMinutes:  p.cooldownMinutes,
      approvalRequired: p.approvalRequired,
      enabled:          p.enabled,
      description:      p.description ?? '',
    });
    setEditing(p);
  };

  const handleSave = () => {
    const payload = {
      ...form,
      senderProfileId: form.senderProfileId ? Number(form.senderProfileId) : null,
      cooldownMinutes:  Number(form.cooldownMinutes),
    };
    if (editing) {
      updateMutation.mutate({ id: editing.id, ...payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const stats = {
    total:   policies.length,
    enabled: policies.filter(p => p.enabled).length,
    email:   policies.filter(p => p.channelType === 'email').length,
    multi:   policies.filter(p => p.channelType === 'email+whatsapp').length,
  };

  const PolicyForm = () => (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs mb-1.5 block">Trigger Event *</Label>
          <Select value={form.triggerType} onValueChange={v => setForm(f => ({ ...f, triggerType: v }))}>
            <SelectTrigger data-testid="select-trigger-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TRIGGER_TYPES.map(t => (
                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs mb-1.5 block">Severity Filter</Label>
          <Select value={form.severityFilter} onValueChange={v => setForm(f => ({ ...f, severityFilter: v }))}>
            <SelectTrigger data-testid="select-severity">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SEVERITY_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs mb-1.5 block">Sender Profile (SMTP)</Label>
          <Select
            value={form.senderProfileId || "none"}
            onValueChange={v => setForm(f => ({ ...f, senderProfileId: v === "none" ? "" : v }))}
          >
            <SelectTrigger data-testid="select-sender-profile">
              <SelectValue placeholder="None configured" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None (configure later)</SelectItem>
              {senderProfiles.map(s => (
                <SelectItem key={s.id} value={String(s.id)}>
                  {s.name} ({s.emailAddress})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs mb-1.5 block">Template Type</Label>
          <Select value={form.templateType} onValueChange={v => setForm(f => ({ ...f, templateType: v }))}>
            <SelectTrigger data-testid="select-template-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TEMPLATE_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs mb-1.5 block">Recipient Group</Label>
          <Select value={form.recipientGroup} onValueChange={v => setForm(f => ({ ...f, recipientGroup: v }))}>
            <SelectTrigger data-testid="select-recipient-group">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RECIPIENT_GROUPS.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs mb-1.5 block">Channel</Label>
          <Select value={form.channelType} onValueChange={v => setForm(f => ({ ...f, channelType: v }))}>
            <SelectTrigger data-testid="select-channel-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CHANNEL_TYPES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div>
        <Label className="text-xs mb-1.5 block">Cooldown (minutes between triggers)</Label>
        <Input
          data-testid="input-cooldown"
          type="number"
          min={0}
          value={form.cooldownMinutes}
          onChange={e => setForm(f => ({ ...f, cooldownMinutes: Number(e.target.value) }))}
        />
        <p className="text-xs text-muted-foreground mt-1">0 = no cooldown. Use 60+ for high-frequency events like tariff additions.</p>
      </div>
      <div>
        <Label className="text-xs mb-1.5 block">Description (optional)</Label>
        <Textarea
          data-testid="input-description"
          rows={2}
          value={form.description}
          onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
          placeholder="What does this policy govern?"
        />
      </div>
      <div className="flex gap-4">
        <div className="flex items-center gap-2">
          <Switch
            data-testid="switch-auto-draft"
            checked={form.autoDraft}
            onCheckedChange={v => setForm(f => ({ ...f, autoDraft: v }))}
          />
          <Label className="text-xs">Auto-draft only (never auto-send)</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            data-testid="switch-enabled"
            checked={form.enabled}
            onCheckedChange={v => setForm(f => ({ ...f, enabled: v }))}
          />
          <Label className="text-xs">Enabled</Label>
        </div>
      </div>
      {!form.autoDraft && (
        <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded p-3">
          <AlertTriangle className="h-4 w-4 text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-red-300">Auto-send is not recommended. Keep auto_draft = true until the policy is verified stable.</p>
        </div>
      )}
    </div>
  );

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Workflow className="h-6 w-6 text-primary" />
            Communication Policies
          </h1>
          <p className="text-muted-foreground mt-1">
            Event-to-draft-notification routing rules. When economics events fire, matching policies auto-create draft notifications for human review.
          </p>
        </div>
        <Button data-testid="button-create-policy" onClick={openCreate}>
          <Plus className="h-4 w-4 mr-2" />Add Policy
        </Button>
      </div>

      {/* Governance notice */}
      <div className="flex items-start gap-3 bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
        <ShieldCheck className="h-5 w-5 text-blue-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-blue-400">Draft-Only Governance</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Policies auto-create <strong>draft</strong> notifications only. No automatic dispatch. Human review and approval required before any notification is sent.
            The <code className="text-xs bg-muted/40 px-1 rounded">auto_draft = true</code> default enforces this at the engine level.
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total Policies", value: stats.total,   icon: <Workflow className="h-4 w-4 text-blue-400" /> },
          { label: "Active",         value: stats.enabled, icon: <CheckCircle2 className="h-4 w-4 text-emerald-400" /> },
          { label: "Email",          value: stats.email,   icon: <Mail className="h-4 w-4 text-blue-400" /> },
          { label: "Multi-Channel",  value: stats.multi,   icon: <MessageSquare className="h-4 w-4 text-green-400" /> },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{s.label}</span>
                {s.icon}
              </div>
              <p className="text-2xl font-bold mt-1">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Policy table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Active Policies</CardTitle>
          <CardDescription className="text-xs">
            {policies.length} policy rule(s) — seeded with 8 defaults, configure sender profiles to activate
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading…</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Trigger Event</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead>Recipients</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead>Cooldown</TableHead>
                    <TableHead>Sender</TableHead>
                    <TableHead>Active</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {policies.map(p => {
                    const profile = senderProfiles.find(s => s.id === p.senderProfileId);
                    return (
                      <TableRow key={p.id} data-testid={`row-policy-${p.id}`}>
                        <TableCell><TriggerBadge type={p.triggerType} /></TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs capitalize">
                            {p.severityFilter}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground capitalize">
                          {p.recipientGroup.replace(/_/g, ' ')}
                        </TableCell>
                        <TableCell><ChannelBadge type={p.channelType} /></TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {p.cooldownMinutes > 0 ? `${p.cooldownMinutes}m` : '—'}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {profile ? (
                            <span className="text-blue-400">{profile.name}</span>
                          ) : (
                            <span className="text-amber-400 italic">Not configured</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Switch
                            data-testid={`switch-policy-enabled-${p.id}`}
                            checked={p.enabled}
                            onCheckedChange={v => toggleMutation.mutate({ id: p.id, enabled: v })}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button
                              data-testid={`button-edit-${p.id}`}
                              variant="ghost" size="sm"
                              onClick={() => openEdit(p)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              data-testid={`button-delete-${p.id}`}
                              variant="ghost" size="sm"
                              onClick={() => setDeleteId(p.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5 text-red-400" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit dialog */}
      <Dialog open={creating || editing != null} onOpenChange={open => { if (!open) { setCreating(false); setEditing(null); } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Workflow className="h-4 w-4" />
              {editing ? "Edit Policy" : "Create Policy"}
            </DialogTitle>
            <DialogDescription>
              Configure when a draft notification is created and what template/sender/recipients it uses.
            </DialogDescription>
          </DialogHeader>
          <PolicyForm />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => { setCreating(false); setEditing(null); }}>Cancel</Button>
            <Button
              data-testid="button-save-policy"
              onClick={handleSave}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {createMutation.isPending || updateMutation.isPending ? "Saving…" : "Save Policy"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={deleteId != null} onOpenChange={open => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete policy?</AlertDialogTitle>
            <AlertDialogDescription>
              This policy will no longer auto-create draft notifications when its trigger event fires.
              Existing drafts already created by this policy are unaffected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-delete"
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import {
  Megaphone, Plus, Send, Trash2, Eye, Users, Clock, CheckCircle,
  AlertCircle, FileText, ChevronRight, Mail, Building2, RefreshCw,
  Zap, Radio, Shield, Wrench, TrendingDown, Route
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────
type CommercialNotification = {
  id: number;
  type: string;
  destination?: string;
  prefix?: string;
  oldValue?: string;
  newValue?: string;
  effectiveDate?: string;
  subject: string;
  body: string;
  audienceType: string;
  createdBy?: string;
  createdAt: string;
  status: string;
  sentCount?: number;
  failedCount?: number;
  dispatchedAt?: string;
};

type Recipient = {
  id: number;
  email: string;
  recipientName?: string;
  deliveryStatus: string;
  sentAt?: string;
  failedReason?: string;
  trackingToken?: string;
  openedAt?: string | null;
  acknowledgedAt?: string | null;
  openCount?: number;
};

// ── Notification type definitions ──────────────────────────────────────────────
const NOTIF_TYPES = [
  { value: 'interval_change',    label: 'Billing Interval Change', icon: Clock,        color: 'text-amber-400',  changeLabel: 'Interval' },
  { value: 'rate_change',        label: 'Rate Change',             icon: TrendingDown, color: 'text-red-400',    changeLabel: 'Rate (per min)' },
  { value: 'surcharge_added',    label: 'Surcharge Added',         icon: Zap,          color: 'text-orange-400', changeLabel: 'Surcharge' },
  { value: 'qos_advisory',       label: 'QoS Advisory',           icon: Radio,        color: 'text-blue-400',   changeLabel: 'QoS Level' },
  { value: 'maintenance_notice', label: 'Maintenance Notice',      icon: Wrench,       color: 'text-slate-400',  changeLabel: 'Window' },
  { value: 'fraud_advisory',     label: 'Fraud Advisory',          icon: Shield,       color: 'text-rose-400',   changeLabel: 'Type' },
  { value: 'routing_advisory',   label: 'Routing Advisory',        icon: Route,        color: 'text-purple-400', changeLabel: 'Change' },
];

// ── Default templates per notification type ────────────────────────────────────
const DEFAULT_TEMPLATES: Record<string, { subject: string; body: string }> = {
  interval_change: {
    subject: 'Rate Notification — {{destination}} Billing Interval Change effective {{effective_date}}',
    body: `Dear {{client_name}},

Please be advised that effective {{effective_date}}, the billing interval for {{destination}} destinations will change as per updated carrier/vendor tariff policies.

Change Summary:
  Previous Billing Interval: {{old_interval}}
  New Billing Interval:      {{new_interval}}
  Effective Date:            {{effective_date}}

This change may impact the effective billed duration and realized call cost for {{destination}} traffic, particularly for short-duration calls.

All billing and invoicing generated after the effective date will automatically apply the updated interval configuration.

No action is required from your side unless you wish to review your routing or pricing strategy for {{destination}} traffic.

If you have any questions, please do not hesitate to contact our commercial or support team.

Best regards,
Billing & Finance Team
Bitsauto`,
  },
  rate_change: {
    subject: 'Rate Notification — {{destination}} Rate Update effective {{effective_date}}',
    body: `Dear {{client_name}},

Please be advised that effective {{effective_date}}, the rate for {{destination}} destinations will be updated as per current carrier/vendor tariff policies.

Change Summary:
  Previous Rate: {{old_interval}}
  New Rate:      {{new_interval}}
  Effective Date: {{effective_date}}

All invoicing generated after the effective date will reflect the updated rate.

For questions, please contact our Billing & Finance team.

Best regards,
Billing & Finance Team
Bitsauto`,
  },
  qos_advisory: {
    subject: 'QoS Advisory — {{destination}} Network Notice',
    body: `Dear {{client_name}},

We wish to advise you of current quality observations affecting {{destination}} traffic.

Our network operations team is actively monitoring the situation and coordinating with carriers to restore full service quality.

We will provide further updates as the situation develops.

Best regards,
Network Operations
Bitsauto`,
  },
  maintenance_notice: {
    subject: 'Maintenance Notice — Scheduled Platform Maintenance',
    body: `Dear {{client_name}},

Please be advised that scheduled maintenance will be performed on {{effective_date}}.

During this window, intermittent service interruptions may be experienced. We recommend avoiding critical call traffic during this period.

We apologize for any inconvenience and appreciate your understanding.

Best regards,
Operations Team
Bitsauto`,
  },
  fraud_advisory: {
    subject: 'Fraud Advisory — Elevated Risk Notice for {{destination}}',
    body: `Dear {{client_name}},

Our fraud monitoring systems have detected elevated risk activity on {{destination}} destinations.

We recommend reviewing your traffic patterns and contact our fraud team if you observe unusual call volumes or abnormal answer rates.

Best regards,
Security & Fraud Team
Bitsauto`,
  },
  routing_advisory: {
    subject: 'Routing Advisory — {{destination}} Routing Update',
    body: `Dear {{client_name}},

Please be advised of a routing update affecting {{destination}} destinations effective {{effective_date}}.

Our routing team is managing this change to ensure continued service quality.

For questions, contact our operations team.

Best regards,
Routing & Operations
Bitsauto`,
  },
  surcharge_added: {
    subject: 'Rate Notification — New Surcharge for {{destination}} effective {{effective_date}}',
    body: `Dear {{client_name}},

Please be advised that effective {{effective_date}}, a new surcharge will apply to {{destination}} destinations as per updated carrier/vendor tariff policies.

Change Summary:
  Surcharge Type: {{old_interval}} → {{new_interval}}
  Effective Date: {{effective_date}}

All invoicing generated after the effective date will include this surcharge.

Best regards,
Billing & Finance Team
Bitsauto`,
  },
};

// ── Status badge ───────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  if (status === 'dispatched') return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">Dispatched</Badge>;
  if (status === 'partial')    return <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30">Partial</Badge>;
  return <Badge className="bg-slate-500/20 text-slate-400 border-slate-500/30">Draft</Badge>;
}

// ── Compose wizard ─────────────────────────────────────────────────────────────
function ComposeWizard({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [step, setStep] = useState<1|2|3>(1);
  const [form, setForm] = useState({
    type: 'interval_change',
    destination: '',
    prefix: '',
    oldValue: '',
    newValue: '',
    effectiveDate: '',
    subject: DEFAULT_TEMPLATES.interval_change.subject,
    body: DEFAULT_TEMPLATES.interval_change.body,
    audienceType: 'all_clients',
    senderProfileId: '' as string | number,
  });

  const { data: audienceData } = useQuery<{ companies: any[]; total: number; withoutEmail: number }>({
    queryKey: ['/api/commercial-notifications/audience/companies'],
  });

  const { data: profilesData } = useQuery<{ profiles: { id: number; name: string; emailAddress: string; communicationType: string }[] }>({
    queryKey: ['/api/sender-profiles'],
  });
  const senderProfiles = profilesData?.profiles ?? [];

  const saveDraft = useMutation({
    mutationFn: () => apiRequest('POST', '/api/commercial-notifications', form),
    onSuccess: async (res) => {
      const data = await res.json();
      qc.invalidateQueries({ queryKey: ['/api/commercial-notifications'] });
      toast({ title: 'Draft saved', description: `Notification #${data.notification.id} saved` });
      onSaved();
      onClose();
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const typeInfo = NOTIF_TYPES.find(t => t.value === form.type);

  function applyTemplate(type: string) {
    const tpl = DEFAULT_TEMPLATES[type] ?? DEFAULT_TEMPLATES.interval_change;
    setForm(f => ({ ...f, type, subject: tpl.subject, body: tpl.body }));
  }

  function renderBodyPreview() {
    return (form.body || '')
      .replace(/\{\{client_name\}\}/gi, 'Acme Telecom')
      .replace(/\{\{destination\}\}/gi, form.destination || '[Destination]')
      .replace(/\{\{old_interval\}\}/gi, form.oldValue || '[Previous]')
      .replace(/\{\{new_interval\}\}/gi, form.newValue || '[New]')
      .replace(/\{\{effective_date\}\}/gi, form.effectiveDate || '[Date]');
  }

  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <div className="flex items-center gap-2 text-sm">
        {[['1','Compose'], ['2','Audience'], ['3','Preview']].map(([n, label], i) => (
          <div key={n} className="flex items-center gap-2">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold
              ${step === Number(n) ? 'bg-indigo-500 text-white' : Number(n) < step ? 'bg-emerald-500 text-white' : 'bg-white/10 text-white/40'}`}>
              {Number(n) < step ? '✓' : n}
            </div>
            <span className={step === Number(n) ? 'text-white font-medium' : 'text-white/40'}>{label}</span>
            {i < 2 && <ChevronRight className="w-3 h-3 text-white/20" />}
          </div>
        ))}
      </div>

      {/* Step 1 — Compose */}
      {step === 1 && (
        <div className="space-y-4">
          <div>
            <Label className="text-white/70 text-xs mb-2 block">Notification Type</Label>
            <div className="grid grid-cols-2 gap-2">
              {NOTIF_TYPES.map(t => {
                const Icon = t.icon;
                const active = form.type === t.value;
                return (
                  <button
                    key={t.value}
                    data-testid={`type-btn-${t.value}`}
                    onClick={() => applyTemplate(t.value)}
                    className={`flex items-center gap-2 p-2.5 rounded-lg border text-left text-sm transition-all
                      ${active ? 'border-indigo-500 bg-indigo-500/10 text-white' : 'border-white/10 bg-white/5 text-white/60 hover:border-white/20'}`}
                  >
                    <Icon className={`w-4 h-4 shrink-0 ${active ? t.color : 'text-white/40'}`} />
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-white/70 text-xs mb-1 block">Destination</Label>
              <Input
                data-testid="input-destination"
                placeholder="e.g. Morocco"
                value={form.destination}
                onChange={e => setForm(f => ({ ...f, destination: e.target.value }))}
                className="bg-white/5 border-white/10 text-white text-sm"
              />
            </div>
            <div>
              <Label className="text-white/70 text-xs mb-1 block">Prefix</Label>
              <Input
                data-testid="input-prefix"
                placeholder="e.g. 212"
                value={form.prefix}
                onChange={e => setForm(f => ({ ...f, prefix: e.target.value }))}
                className="bg-white/5 border-white/10 text-white text-sm"
              />
            </div>
            <div>
              <Label className="text-white/70 text-xs mb-1 block">{typeInfo?.changeLabel ?? 'Previous Value'} (Previous)</Label>
              <Input
                data-testid="input-old-value"
                placeholder="e.g. 60/60"
                value={form.oldValue}
                onChange={e => setForm(f => ({ ...f, oldValue: e.target.value }))}
                className="bg-white/5 border-white/10 text-white text-sm"
              />
            </div>
            <div>
              <Label className="text-white/70 text-xs mb-1 block">{typeInfo?.changeLabel ?? 'New Value'} (New)</Label>
              <Input
                data-testid="input-new-value"
                placeholder="e.g. 30/6"
                value={form.newValue}
                onChange={e => setForm(f => ({ ...f, newValue: e.target.value }))}
                className="bg-white/5 border-white/10 text-white text-sm"
              />
            </div>
          </div>

          <div>
            <Label className="text-white/70 text-xs mb-1 block">Effective Date</Label>
            <Input
              data-testid="input-effective-date"
              type="date"
              value={form.effectiveDate}
              onChange={e => setForm(f => ({ ...f, effectiveDate: e.target.value }))}
              className="bg-white/5 border-white/10 text-white text-sm"
            />
          </div>

          <div>
            <Label className="text-white/70 text-xs mb-1 block">Email Subject</Label>
            <Input
              data-testid="input-subject"
              value={form.subject}
              onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
              className="bg-white/5 border-white/10 text-white text-sm"
            />
          </div>

          <div>
            <Label className="text-white/70 text-xs mb-1 block">
              Body
              <span className="ml-2 text-white/30 font-normal">Use {'{{client_name}} {{destination}} {{old_interval}} {{new_interval}} {{effective_date}}'}</span>
            </Label>
            <Textarea
              data-testid="input-body"
              value={form.body}
              onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
              className="bg-white/5 border-white/10 text-white text-sm font-mono min-h-[200px]"
            />
          </div>

          {/* Sender Profile picker */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <Label className="text-white/70 text-xs">Sender Profile</Label>
              <a href="/sender-profiles" className="text-xs text-indigo-400 hover:text-indigo-300" target="_blank">Manage profiles →</a>
            </div>
            <Select
              value={String(form.senderProfileId || '')}
              onValueChange={v => setForm(f => ({ ...f, senderProfileId: v === 'system' ? '' : Number(v) }))}
            >
              <SelectTrigger className="bg-white/5 border-white/10 text-white text-sm" data-testid="select-sender-profile">
                <SelectValue placeholder="System default (Settings → Email)" />
              </SelectTrigger>
              <SelectContent className="bg-[#1a1a2e] border-white/10">
                <SelectItem value="system" className="text-white/50 hover:bg-white/10">System default (Settings → Email)</SelectItem>
                {senderProfiles.map(p => (
                  <SelectItem key={p.id} value={String(p.id)} className="text-white hover:bg-white/10">
                    {p.name} <span className="text-white/40 text-xs ml-1">— {p.emailAddress}</span>
                  </SelectItem>
                ))}
                {senderProfiles.length === 0 && (
                  <SelectItem value="no-profiles" disabled className="text-white/30 hover:bg-white/10">
                    No profiles configured — add them in Sender Profiles
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="flex justify-end">
            <Button
              data-testid="btn-next-audience"
              onClick={() => setStep(2)}
              disabled={!form.subject.trim() || !form.body.trim()}
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              Next: Audience <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 2 — Audience */}
      {step === 2 && (
        <div className="space-y-4">
          <div>
            <Label className="text-white/70 text-xs mb-2 block">Recipient Audience</Label>
            <div className="space-y-2">
              {[
                { value: 'all_clients', label: 'All Clients', desc: 'Every company with an invoice email address' },
                { value: 'internal_team', label: 'Internal Team Only', desc: 'Send to watcher recipients / internal only' },
              ].map(opt => (
                <button
                  key={opt.value}
                  data-testid={`audience-${opt.value}`}
                  onClick={() => setForm(f => ({ ...f, audienceType: opt.value }))}
                  className={`w-full flex items-start gap-3 p-3 rounded-lg border text-left transition-all
                    ${form.audienceType === opt.value ? 'border-indigo-500 bg-indigo-500/10' : 'border-white/10 bg-white/5 hover:border-white/20'}`}
                >
                  <Users className={`w-4 h-4 mt-0.5 shrink-0 ${form.audienceType === opt.value ? 'text-indigo-400' : 'text-white/40'}`} />
                  <div>
                    <div className={`text-sm font-medium ${form.audienceType === opt.value ? 'text-white' : 'text-white/70'}`}>{opt.label}</div>
                    <div className="text-xs text-white/40">{opt.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {audienceData && (
            <div className="bg-white/5 border border-white/10 rounded-lg p-4 space-y-2">
              <div className="text-xs text-white/50 uppercase tracking-wider font-medium">Audience Preview</div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-white/70">Companies with invoice email</span>
                <span className="text-sm font-bold text-white" data-testid="audience-count">{audienceData.total}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-white/50">Missing email (will be skipped)</span>
                <span className="text-sm text-white/40">{audienceData.withoutEmail}</span>
              </div>
              {audienceData.total === 0 && (
                <div className="text-xs text-amber-400 mt-2 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> No companies have invoice email addresses set. Configure them in Client Management.
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-between">
            <Button variant="outline" onClick={() => setStep(1)} className="border-white/20 text-white/70 hover:text-white" data-testid="btn-back-compose">
              Back
            </Button>
            <Button
              data-testid="btn-next-preview"
              onClick={() => setStep(3)}
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              Next: Preview <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 3 — Preview & Save */}
      {step === 3 && (
        <div className="space-y-4">
          <div className="text-xs text-white/50 uppercase tracking-wider font-medium mb-2">Email Preview (sample recipient)</div>
          <div className="bg-[#0f0f0f] rounded-xl border border-white/10 overflow-hidden">
            <div className="bg-indigo-600 px-5 py-3">
              <div className="text-white font-semibold text-sm">📡 Bitsauto — Commercial Notice</div>
            </div>
            <div className="px-5 py-4">
              <div className="text-xs text-white/40 mb-1">Subject:</div>
              <div className="text-sm text-white font-medium mb-4">
                {form.subject
                  .replace(/\{\{destination\}\}/gi, form.destination || '[Destination]')
                  .replace(/\{\{effective_date\}\}/gi, form.effectiveDate || '[Date]')}
              </div>
              <div className="text-sm text-white/80 whitespace-pre-wrap leading-relaxed font-mono text-xs">
                {renderBodyPreview()}
              </div>
            </div>
            <div className="px-5 py-2 bg-black/30 text-xs text-white/30">
              Sent via Bitsauto Operations Platform
            </div>
          </div>

          <div className="bg-white/5 border border-white/10 rounded-lg p-3 text-sm text-white/60 space-y-1">
            <div className="flex justify-between"><span>Type</span><span className="text-white">{typeInfo?.label}</span></div>
            {form.destination && <div className="flex justify-between"><span>Destination</span><span className="text-white">{form.destination} ({form.prefix})</span></div>}
            {form.oldValue && <div className="flex justify-between"><span>Change</span><span className="text-white">{form.oldValue} → {form.newValue}</span></div>}
            {form.effectiveDate && <div className="flex justify-between"><span>Effective</span><span className="text-white">{form.effectiveDate}</span></div>}
            <div className="flex justify-between"><span>Audience</span><span className="text-white">{audienceData?.total ?? '—'} clients</span></div>
          </div>

          <div className="flex items-center justify-between">
            <Button variant="outline" onClick={() => setStep(2)} className="border-white/20 text-white/70 hover:text-white" data-testid="btn-back-audience">
              Back
            </Button>
            <Button
              data-testid="btn-save-draft"
              onClick={() => saveDraft.mutate()}
              disabled={saveDraft.isPending}
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              {saveDraft.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <FileText className="w-4 h-4 mr-2" />}
              Save Draft
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Recipient log ──────────────────────────────────────────────────────────────
function RecipientLog({ notifId, onClose }: { notifId: number; onClose: () => void }) {
  const { data } = useQuery<{ notification: CommercialNotification; recipients: Recipient[] }>({
    queryKey: ['/api/commercial-notifications', notifId],
  });

  const recipients = data?.recipients ?? [];
  const notif = data?.notification;

  return (
    <div className="space-y-4">
      {notif && (
        <div className="bg-white/5 border border-white/10 rounded-lg p-3 text-sm space-y-1 text-white/70">
          <div className="flex justify-between"><span>Status</span><StatusBadge status={notif.status} /></div>
          <div className="flex justify-between"><span>Sent</span><span className="text-emerald-400">{notif.sentCount ?? 0}</span></div>
          <div className="flex justify-between"><span>Failed</span><span className="text-red-400">{notif.failedCount ?? 0}</span></div>
          {notif.dispatchedAt && <div className="flex justify-between"><span>Dispatched</span><span className="text-white">{new Date(notif.dispatchedAt).toLocaleString()}</span></div>}
        </div>
      )}
      <div className="space-y-1 max-h-[400px] overflow-y-auto pr-1">
        {recipients.length === 0 && <div className="text-white/40 text-sm text-center py-8">No recipient records yet.</div>}
        {recipients.map(r => (
          <div key={r.id} className="bg-white/5 rounded-lg px-3 py-2 text-sm" data-testid={`recipient-row-${r.id}`}>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-white font-medium">{r.recipientName ?? r.email}</div>
                <div className="text-white/40 text-xs">{r.email}</div>
              </div>
              <div className="flex items-center gap-2">
                {r.deliveryStatus === 'sent'    && <CheckCircle className="w-4 h-4 text-emerald-400" />}
                {r.deliveryStatus === 'failed'  && <AlertCircle className="w-4 h-4 text-red-400" title={r.failedReason ?? ''} />}
                {r.deliveryStatus === 'pending' && <Clock className="w-4 h-4 text-white/30" />}
                <span className={`text-xs capitalize ${r.deliveryStatus === 'sent' ? 'text-emerald-400' : r.deliveryStatus === 'failed' ? 'text-red-400' : 'text-white/40'}`}>
                  {r.deliveryStatus}
                </span>
              </div>
            </div>
            {(r.openedAt || r.acknowledgedAt || (r.openCount != null && r.openCount > 0)) && (
              <div className="flex items-center gap-3 mt-1.5 pt-1.5 border-t border-white/5 text-xs">
                {r.openedAt ? (
                  <span className="flex items-center gap-1 text-sky-400" title={`First opened: ${new Date(r.openedAt).toLocaleString()}`}>
                    <Eye className="w-3 h-3" />
                    Opened {r.openCount != null && r.openCount > 1 ? `× ${r.openCount}` : ''}
                  </span>
                ) : (
                  <span className="text-white/20 flex items-center gap-1"><Eye className="w-3 h-3" />Not opened</span>
                )}
                {r.acknowledgedAt ? (
                  <span className="flex items-center gap-1 text-purple-400" title={`Acknowledged: ${new Date(r.acknowledgedAt).toLocaleString()}`}>
                    <Shield className="w-3 h-3" />
                    Acknowledged
                  </span>
                ) : (
                  <span className="text-white/20 flex items-center gap-1"><Shield className="w-3 h-3" />Unacknowledged</span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      <Button variant="outline" onClick={onClose} className="w-full border-white/20 text-white/70" data-testid="btn-close-recipients">
        Close
      </Button>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function CommercialNotificationsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [composeOpen, setComposeOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const { data, isLoading, refetch } = useQuery<{ notifications: CommercialNotification[] }>({
    queryKey: ['/api/commercial-notifications'],
  });

  const notifications = data?.notifications ?? [];

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/commercial-notifications/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/commercial-notifications'] });
      toast({ title: 'Deleted', description: 'Draft notification removed.' });
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const dispatchMutation = useMutation({
    mutationFn: (id: number) => apiRequest('POST', `/api/commercial-notifications/${id}/dispatch`, {}),
    onSuccess: async (res, id) => {
      const data = await res.json();
      qc.invalidateQueries({ queryKey: ['/api/commercial-notifications'] });
      toast({
        title: 'Dispatched',
        description: `${data.sent} sent, ${data.failed} failed out of ${data.total} recipients.`,
      });
      setSelectedId(id);
    },
    onError: (e: any) => toast({ title: 'Dispatch failed', description: e.message, variant: 'destructive' }),
  });

  // Stats
  const totalDispatched = notifications.filter(n => n.status === 'dispatched' || n.status === 'partial').length;
  const totalDrafts     = notifications.filter(n => n.status === 'draft').length;
  const totalSent       = notifications.reduce((s, n) => s + (n.sentCount ?? 0), 0);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <div className="border-b border-white/10 bg-black/20 px-6 py-4">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-indigo-500/20 rounded-lg flex items-center justify-center">
              <Megaphone className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white" data-testid="page-title">Commercial Notifications</h1>
              <p className="text-xs text-white/40">Tariff change alerts · QoS advisories · Client communication governance</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              className="border-white/20 text-white/70 hover:text-white"
              data-testid="btn-refresh"
            >
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Refresh
            </Button>
            <Button
              size="sm"
              onClick={() => setComposeOpen(true)}
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
              data-testid="btn-compose"
            >
              <Plus className="w-4 h-4 mr-1.5" /> New Notification
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Total Dispatched', value: totalDispatched, icon: Send,      color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
            { label: 'Drafts',           value: totalDrafts,     icon: FileText,  color: 'text-amber-400',   bg: 'bg-amber-500/10'   },
            { label: 'Emails Sent',      value: totalSent,       icon: Mail,      color: 'text-blue-400',    bg: 'bg-blue-500/10'    },
          ].map(s => {
            const Icon = s.icon;
            return (
              <Card key={s.label} className="bg-white/[0.03] border-white/10">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg ${s.bg} flex items-center justify-center shrink-0`}>
                    <Icon className={`w-5 h-5 ${s.color}`} />
                  </div>
                  <div>
                    <div className="text-xl font-bold text-white" data-testid={`stat-${s.label.toLowerCase().replace(/\s+/g,'-')}`}>{s.value}</div>
                    <div className="text-xs text-white/40">{s.label}</div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Notification list */}
        <Card className="bg-white/[0.03] border-white/10">
          <CardHeader className="border-b border-white/10 px-5 py-4">
            <CardTitle className="text-sm font-semibold text-white/80 flex items-center gap-2">
              <Megaphone className="w-4 h-4 text-indigo-400" /> All Notifications
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading && (
              <div className="flex items-center justify-center py-16 text-white/30">
                <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading…
              </div>
            )}

            {!isLoading && notifications.length === 0 && (
              <div className="text-center py-16 text-white/30">
                <Megaphone className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <div className="text-sm">No notifications yet.</div>
                <div className="text-xs mt-1">Click "New Notification" to compose your first commercial announcement.</div>
                <Button
                  size="sm"
                  onClick={() => setComposeOpen(true)}
                  className="mt-4 bg-indigo-600 hover:bg-indigo-700 text-white"
                  data-testid="btn-compose-empty"
                >
                  <Plus className="w-4 h-4 mr-1.5" /> Create Morocco Interval Change Notice
                </Button>
              </div>
            )}

            {notifications.map((n, idx) => {
              const typeInfo = NOTIF_TYPES.find(t => t.value === n.type);
              const Icon = typeInfo?.icon ?? Megaphone;
              const isDispatching = dispatchMutation.isPending && dispatchMutation.variables === n.id;

              return (
                <div key={n.id} data-testid={`notif-row-${n.id}`}
                  className={`flex items-start gap-4 px-5 py-4 transition-colors hover:bg-white/[0.03] ${idx > 0 ? 'border-t border-white/5' : ''}`}>

                  <div className={`w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center shrink-0 mt-0.5`}>
                    <Icon className={`w-4 h-4 ${typeInfo?.color ?? 'text-white/40'}`} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-semibold text-white truncate">{n.subject.replace(/\{\{[^}]+\}\}/g, '…')}</span>
                      <StatusBadge status={n.status} />
                    </div>
                    <div className="flex items-center gap-3 text-xs text-white/40">
                      <span>{typeInfo?.label ?? n.type}</span>
                      {n.destination && <><span>·</span><span>{n.destination} ({n.prefix})</span></>}
                      {n.oldValue && <><span>·</span><span>{n.oldValue} → {n.newValue}</span></>}
                      {n.effectiveDate && <><span>·</span><span>Effective {n.effectiveDate}</span></>}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-white/30 mt-1">
                      <span>By {n.createdBy}</span>
                      <span>·</span>
                      <span>{new Date(n.createdAt).toLocaleString()}</span>
                      {(n.sentCount ?? 0) > 0 && (
                        <><span>·</span>
                        <span className="text-emerald-400">{n.sentCount} sent</span>
                        {(n.failedCount ?? 0) > 0 && <span className="text-red-400">{n.failedCount} failed</span>}
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {(n.status === 'dispatched' || n.status === 'partial') && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedId(n.id)}
                        className="text-white/50 hover:text-white h-7 px-2"
                        data-testid={`btn-recipients-${n.id}`}
                      >
                        <Users className="w-3.5 h-3.5 mr-1" /> Audit
                      </Button>
                    )}
                    {n.status === 'draft' && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => dispatchMutation.mutate(n.id)}
                          disabled={isDispatching}
                          className="text-indigo-400 hover:text-indigo-300 h-7 px-2"
                          data-testid={`btn-dispatch-${n.id}`}
                        >
                          {isDispatching ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5 mr-1" />}
                          {!isDispatching && 'Dispatch'}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteMutation.mutate(n.id)}
                          className="text-white/30 hover:text-red-400 h-7 px-2"
                          data-testid={`btn-delete-${n.id}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      {/* Compose dialog */}
      <Dialog open={composeOpen} onOpenChange={setComposeOpen}>
        <DialogContent className="bg-[#0f1117] border-white/10 text-white max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-white">
              <Megaphone className="w-4 h-4 text-indigo-400" /> New Commercial Notification
            </DialogTitle>
          </DialogHeader>
          <Separator className="bg-white/10" />
          <ComposeWizard onClose={() => setComposeOpen(false)} onSaved={() => qc.invalidateQueries({ queryKey: ['/api/commercial-notifications'] })} />
        </DialogContent>
      </Dialog>

      {/* Recipient audit dialog */}
      <Dialog open={selectedId !== null} onOpenChange={open => !open && setSelectedId(null)}>
        <DialogContent className="bg-[#0f1117] border-white/10 text-white max-w-xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-white">
              <Users className="w-4 h-4 text-indigo-400" /> Delivery Audit
            </DialogTitle>
          </DialogHeader>
          <Separator className="bg-white/10" />
          {selectedId && <RecipientLog notifId={selectedId} onClose={() => setSelectedId(null)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

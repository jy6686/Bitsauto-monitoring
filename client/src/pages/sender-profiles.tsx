import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import {
  Mail, Plus, Trash2, Edit2, CheckCircle, AlertCircle, RefreshCw,
  Send, Shield, Zap, FileText, Radio, Wrench, Route, Building2, Settings
} from "lucide-react";

type SenderProfile = {
  id: number;
  name: string;
  emailAddress: string;
  replyTo?: string;
  communicationType: string;
  isDefault?: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  smtpSecure?: boolean;
  createdAt: string;
};

const COMM_TYPES = [
  { value: 'billing',  label: 'Billing',          icon: FileText, color: 'text-emerald-400', desc: 'Invoices, statements, payment notices' },
  { value: 'pricing',  label: 'Pricing / Rates',   icon: Zap,      color: 'text-amber-400',  desc: 'Rate changes, interval updates, tariff notices' },
  { value: 'rates',    label: 'Rates / Routing',   icon: Route,    color: 'text-blue-400',   desc: 'Route advisories, QoS changes' },
  { value: 'support',  label: 'Support',           icon: Wrench,   color: 'text-slate-400',  desc: 'Outages, maintenance, support incidents' },
  { value: 'noc',      label: 'NOC / Operations',  icon: Radio,    color: 'text-purple-400', desc: 'Emergency notices, operational alerts' },
  { value: 'general',  label: 'General',           icon: Mail,     color: 'text-white/50',   desc: 'General platform communications' },
];

const EMPTY_FORM = {
  name: '',
  emailAddress: '',
  replyTo: '',
  communicationType: 'billing',
  isDefault: false,
  smtpHost: 'smtp.gmail.com',
  smtpPort: 587,
  smtpUser: '',
  smtpPass: '',
  smtpSecure: false,
};

function ProfileForm({ initial, onSave, onCancel, saving }: {
  initial: typeof EMPTY_FORM & { id?: number };
  onSave: (data: typeof EMPTY_FORM) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [form, setForm] = useState(initial);
  const f = (k: keyof typeof form, v: any) => setForm(prev => ({ ...prev, [k]: v }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Label className="text-white/70 text-xs mb-1 block">Profile Name</Label>
          <Input
            data-testid="input-profile-name"
            placeholder="e.g. Billing Identity"
            value={form.name}
            onChange={e => f('name', e.target.value)}
            className="bg-white/5 border-white/10 text-white text-sm"
          />
        </div>
        <div>
          <Label className="text-white/70 text-xs mb-1 block">Sender Email Address</Label>
          <Input
            data-testid="input-email-address"
            placeholder="billing@ichbaanlogic.com"
            value={form.emailAddress}
            onChange={e => f('emailAddress', e.target.value)}
            className="bg-white/5 border-white/10 text-white text-sm"
          />
        </div>
        <div>
          <Label className="text-white/70 text-xs mb-1 block">Reply-To (optional)</Label>
          <Input
            data-testid="input-reply-to"
            placeholder="noreply@ichbaanlogic.com"
            value={form.replyTo}
            onChange={e => f('replyTo', e.target.value)}
            className="bg-white/5 border-white/10 text-white text-sm"
          />
        </div>
      </div>

      <div>
        <Label className="text-white/70 text-xs mb-1 block">Communication Type</Label>
        <Select value={form.communicationType} onValueChange={v => f('communicationType', v)}>
          <SelectTrigger className="bg-white/5 border-white/10 text-white text-sm" data-testid="select-comm-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-[#1a1a2e] border-white/10">
            {COMM_TYPES.map(t => (
              <SelectItem key={t.value} value={t.value} className="text-white hover:bg-white/10">
                {t.label} — <span className="text-white/40 text-xs">{t.desc}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Separator className="bg-white/10" />
      <div className="text-xs text-white/50 uppercase tracking-wider font-medium">SMTP Configuration</div>

      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <Label className="text-white/70 text-xs mb-1 block">SMTP Host</Label>
          <Input
            data-testid="input-smtp-host"
            value={form.smtpHost}
            onChange={e => f('smtpHost', e.target.value)}
            className="bg-white/5 border-white/10 text-white text-sm"
          />
        </div>
        <div>
          <Label className="text-white/70 text-xs mb-1 block">Port</Label>
          <Input
            data-testid="input-smtp-port"
            type="number"
            value={form.smtpPort}
            onChange={e => f('smtpPort', Number(e.target.value))}
            className="bg-white/5 border-white/10 text-white text-sm"
          />
        </div>
        <div className="col-span-2">
          <Label className="text-white/70 text-xs mb-1 block">SMTP Username</Label>
          <Input
            data-testid="input-smtp-user"
            placeholder="billing@ichbaanlogic.com"
            value={form.smtpUser}
            onChange={e => f('smtpUser', e.target.value)}
            className="bg-white/5 border-white/10 text-white text-sm"
          />
        </div>
        <div>
          <Label className="text-white/70 text-xs mb-1 block">App Password</Label>
          <Input
            data-testid="input-smtp-pass"
            type="password"
            placeholder={form.smtpPass === '••••••••' ? 'unchanged' : ''}
            value={form.smtpPass === '••••••••' ? '' : form.smtpPass}
            onChange={e => f('smtpPass', e.target.value)}
            className="bg-white/5 border-white/10 text-white text-sm"
          />
        </div>
      </div>

      <div className="text-xs text-white/40 bg-white/5 rounded-lg p-3 leading-relaxed">
        For Gmail: enable 2-step verification, then create an App Password at <span className="text-indigo-400">myaccount.google.com/apppasswords</span>. Use the 16-character app password here.
        For custom SMTP: use port 587 (STARTTLS) or 465 (SSL).
      </div>

      <div className="flex justify-between items-center">
        <Button variant="outline" onClick={onCancel} className="border-white/20 text-white/70" data-testid="btn-cancel-profile">
          Cancel
        </Button>
        <Button
          onClick={() => onSave(form)}
          disabled={saving || !form.name || !form.emailAddress || !form.smtpUser}
          className="bg-indigo-600 hover:bg-indigo-700 text-white"
          data-testid="btn-save-profile"
        >
          {saving ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle className="w-4 h-4 mr-2" />}
          Save Profile
        </Button>
      </div>
    </div>
  );
}

export default function SenderProfilesPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [addOpen, setAddOpen] = useState(false);
  const [editProfile, setEditProfile] = useState<SenderProfile | null>(null);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [testEmail, setTestEmail] = useState('');
  const [testOpen, setTestOpen] = useState(false);

  const { data, isLoading, refetch } = useQuery<{ profiles: SenderProfile[] }>({
    queryKey: ['/api/sender-profiles'],
  });
  const profiles = data?.profiles ?? [];

  const createMutation = useMutation({
    mutationFn: (d: typeof EMPTY_FORM) => apiRequest('POST', '/api/sender-profiles', d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/sender-profiles'] });
      setAddOpen(false);
      toast({ title: 'Profile created', description: 'Sender identity saved.' });
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<SenderProfile> }) =>
      apiRequest('PUT', `/api/sender-profiles/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/sender-profiles'] });
      setEditProfile(null);
      toast({ title: 'Profile updated' });
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/sender-profiles/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/sender-profiles'] });
      toast({ title: 'Profile deleted' });
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const testMutation = useMutation({
    mutationFn: ({ id, email }: { id: number; email: string }) =>
      apiRequest('POST', `/api/sender-profiles/${id}/test`, { testEmail: email }),
    onSuccess: async (res) => {
      const data = await res.json();
      if (data.ok) {
        toast({ title: 'Test sent', description: `Email dispatched via profile to ${testEmail}` });
      } else {
        toast({ title: 'Test failed', description: data.error, variant: 'destructive' });
      }
      setTestOpen(false);
      setTestEmail('');
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="border-b border-white/10 bg-black/20 px-6 py-4">
        <div className="flex items-center justify-between max-w-5xl mx-auto">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-indigo-500/20 rounded-lg flex items-center justify-center">
              <Settings className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white" data-testid="page-title">Sender Profiles</h1>
              <p className="text-xs text-white/40">Configure named SMTP identities for billing, rates, pricing, and NOC communications</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} className="border-white/20 text-white/70" data-testid="btn-refresh">
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Refresh
            </Button>
            <Button size="sm" onClick={() => setAddOpen(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white" data-testid="btn-add-profile">
              <Plus className="w-4 h-4 mr-1.5" /> Add Profile
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6 space-y-4">

        {/* Communication type guide */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { type: 'billing',  email: 'billing@ichbaanlogic.com',  label: 'Billing' },
            { type: 'pricing',  email: 'pricing@ichibaanlogic.com', label: 'Pricing / Rates' },
            { type: 'rates',    email: 'rates@ichibaanlogic.com',   label: 'Rates / Routing' },
          ].map(g => {
            const ct = COMM_TYPES.find(c => c.value === g.type)!;
            const Icon = ct.icon;
            const configured = profiles.some(p => p.communicationType === g.type);
            return (
              <div key={g.type} className={`rounded-lg border p-3 ${configured ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-white/10 bg-white/[0.02]'}`}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <Icon className={`w-3.5 h-3.5 ${ct.color}`} />
                    <span className="text-xs font-medium text-white">{g.label}</span>
                  </div>
                  {configured
                    ? <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                    : <AlertCircle className="w-3.5 h-3.5 text-white/20" />}
                </div>
                <div className="text-xs text-white/40 font-mono">{g.email}</div>
              </div>
            );
          })}
        </div>

        <Card className="bg-white/[0.03] border-white/10">
          <CardHeader className="border-b border-white/10 px-5 py-4">
            <CardTitle className="text-sm font-semibold text-white/80 flex items-center gap-2">
              <Mail className="w-4 h-4 text-indigo-400" />
              Configured Sender Identities
              <Badge className="ml-auto bg-white/10 text-white/60 border-0">{profiles.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading && (
              <div className="flex items-center justify-center py-12 text-white/30">
                <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Loading…
              </div>
            )}

            {!isLoading && profiles.length === 0 && (
              <div className="text-center py-12 text-white/30">
                <Shield className="w-10 h-10 mx-auto mb-3 opacity-20" />
                <div className="text-sm">No sender profiles yet.</div>
                <div className="text-xs mt-1">Add profiles for billing@, rates@, and pricing@ identities.</div>
                <Button size="sm" onClick={() => setAddOpen(true)} className="mt-4 bg-indigo-600 hover:bg-indigo-700 text-white" data-testid="btn-add-first">
                  <Plus className="w-4 h-4 mr-1.5" /> Add First Profile
                </Button>
              </div>
            )}

            {profiles.map((p, idx) => {
              const ct = COMM_TYPES.find(c => c.value === p.communicationType) ?? COMM_TYPES[5];
              const Icon = ct.icon;
              return (
                <div key={p.id} data-testid={`profile-row-${p.id}`}
                  className={`flex items-center gap-4 px-5 py-4 hover:bg-white/[0.03] transition-colors ${idx > 0 ? 'border-t border-white/5' : ''}`}>
                  <div className="w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center shrink-0">
                    <Icon className={`w-4 h-4 ${ct.color}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-semibold text-white">{p.name}</span>
                      <Badge className="text-xs bg-white/10 text-white/50 border-0">{ct.label}</Badge>
                      {p.isDefault && <Badge className="text-xs bg-indigo-500/20 text-indigo-400 border-indigo-500/30">Default</Badge>}
                    </div>
                    <div className="text-xs text-indigo-300 font-mono">{p.emailAddress}</div>
                    <div className="text-xs text-white/30 mt-0.5">
                      via {p.smtpHost}:{p.smtpPort} · user: {p.smtpUser}
                      {p.replyTo && ` · reply-to: ${p.replyTo}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      variant="ghost" size="sm"
                      onClick={() => { setTestingId(p.id); setTestOpen(true); }}
                      className="text-white/40 hover:text-emerald-400 h-7 px-2"
                      data-testid={`btn-test-${p.id}`}
                    >
                      <Send className="w-3.5 h-3.5 mr-1" /> Test
                    </Button>
                    <Button
                      variant="ghost" size="sm"
                      onClick={() => setEditProfile(p)}
                      className="text-white/40 hover:text-white h-7 px-2"
                      data-testid={`btn-edit-${p.id}`}
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost" size="sm"
                      onClick={() => deleteMutation.mutate(p.id)}
                      className="text-white/30 hover:text-red-400 h-7 px-2"
                      data-testid={`btn-delete-${p.id}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Auto-routing policy info */}
        <div className="bg-white/[0.02] border border-white/10 rounded-xl p-5 space-y-3">
          <div className="text-xs text-white/50 uppercase tracking-wider font-medium flex items-center gap-2">
            <Shield className="w-3.5 h-3.5 text-indigo-400" /> Auto-Sender Routing Policy
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            {[
              { notifType: 'Billing Interval Change', sender: 'pricing' },
              { notifType: 'Rate Change', sender: 'pricing' },
              { notifType: 'Surcharge Added', sender: 'pricing' },
              { notifType: 'QoS Advisory', sender: 'rates' },
              { notifType: 'Maintenance Notice', sender: 'noc' },
              { notifType: 'Fraud Advisory', sender: 'noc' },
              { notifType: 'Routing Advisory', sender: 'rates' },
              { notifType: 'Invoice', sender: 'billing' },
            ].map(row => {
              const ct = COMM_TYPES.find(c => c.value === row.sender)!;
              const configured = profiles.some(p => p.communicationType === row.sender);
              return (
                <div key={row.notifType} className="flex items-center justify-between bg-white/5 rounded-lg px-3 py-2">
                  <span className="text-white/60">{row.notifType}</span>
                  <span className={`font-mono ${configured ? ct.color : 'text-white/20'}`}>
                    {configured ? `${row.sender}@` : `${row.sender}@ (not configured)`}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="text-xs text-white/30">
            When dispatching a notification, the platform automatically selects the sender profile matching the communication type. If none is found, falls back to the system email configured in Settings.
          </div>
        </div>
      </div>

      {/* Add dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="bg-[#0f1117] border-white/10 text-white max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-white">
              <Mail className="w-4 h-4 text-indigo-400" /> New Sender Profile
            </DialogTitle>
          </DialogHeader>
          <Separator className="bg-white/10" />
          <ProfileForm
            initial={{ ...EMPTY_FORM }}
            onSave={(data) => createMutation.mutate(data)}
            onCancel={() => setAddOpen(false)}
            saving={createMutation.isPending}
          />
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editProfile} onOpenChange={open => !open && setEditProfile(null)}>
        <DialogContent className="bg-[#0f1117] border-white/10 text-white max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-white">
              <Edit2 className="w-4 h-4 text-indigo-400" /> Edit Sender Profile
            </DialogTitle>
          </DialogHeader>
          <Separator className="bg-white/10" />
          {editProfile && (
            <ProfileForm
              initial={{ ...editProfile }}
              onSave={(data) => updateMutation.mutate({ id: editProfile.id, data })}
              onCancel={() => setEditProfile(null)}
              saving={updateMutation.isPending}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Test email dialog */}
      <Dialog open={testOpen} onOpenChange={open => { if (!open) { setTestOpen(false); setTestEmail(''); } }}>
        <DialogContent className="bg-[#0f1117] border-white/10 text-white max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-white">
              <Send className="w-4 h-4 text-emerald-400" /> Send Test Email
            </DialogTitle>
          </DialogHeader>
          <Separator className="bg-white/10" />
          <div className="space-y-4 pt-2">
            <div>
              <Label className="text-white/70 text-xs mb-1 block">Recipient Email</Label>
              <Input
                data-testid="input-test-email"
                type="email"
                placeholder="you@example.com"
                value={testEmail}
                onChange={e => setTestEmail(e.target.value)}
                className="bg-white/5 border-white/10 text-white text-sm"
              />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setTestOpen(false)} className="flex-1 border-white/20 text-white/70" data-testid="btn-cancel-test">Cancel</Button>
              <Button
                onClick={() => testingId && testMutation.mutate({ id: testingId, email: testEmail })}
                disabled={!testEmail || testMutation.isPending}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                data-testid="btn-send-test"
              >
                {testMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4 mr-1.5" />}
                Send Test
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

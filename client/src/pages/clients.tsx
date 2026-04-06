import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import {
  Plus, Pencil, Trash2, Loader2, Building2, Server, X, Check,
  Globe, RefreshCw, Download, AlertTriangle,
} from "lucide-react";
import { Link } from "wouter";
import type { ClientProfile } from "@shared/schema";

interface VosClient {
  id: string;
  name: string;
  balance: number;
  status: string;
  type: string;
}

const TYPE_META = {
  client: {
    label: "Client",
    icon: Building2,
    color: "text-emerald-400",
    bg: "bg-emerald-500/10 border-emerald-500/30",
    desc: "Sends calls to you — you bill them",
  },
  vendor: {
    label: "Vendor",
    icon: Server,
    color: "text-violet-400",
    bg: "bg-violet-500/10 border-violet-500/30",
    desc: "You send calls to them — they bill you",
  },
};

const empty: Partial<ClientProfile> = { name: '', type: 'client', prefix: '', ratePerMin: 0.025, notes: '' };

function ProfileForm({
  initial,
  onSave,
  onCancel,
  isSaving,
}: {
  initial: Partial<ClientProfile>;
  onSave: (data: Partial<ClientProfile>) => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  const [form, setForm] = useState<Partial<ClientProfile>>(initial);
  const set = (k: keyof ClientProfile, v: any) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-5 bg-muted/20 rounded-xl border border-border/50">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Name *</label>
        <input
          data-testid="input-profile-name"
          value={form.name || ''}
          onChange={e => set('name', e.target.value)}
          placeholder="e.g. Acme Telecom"
          className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Type *</label>
        <select
          data-testid="select-profile-type"
          value={form.type || 'client'}
          onChange={e => set('type', e.target.value)}
          className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
        >
          <option value="client">Client (they send calls to you)</option>
          <option value="vendor">Vendor (you send calls to them)</option>
        </select>
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {form.type === 'vendor' ? 'CLD Prefix (Destination)' : 'CLI Prefix (Caller)'}
        </label>
        <input
          data-testid="input-profile-prefix"
          value={form.prefix || ''}
          onChange={e => set('prefix', e.target.value)}
          placeholder={form.type === 'vendor' ? 'e.g. +44 or +1212' : 'e.g. +1800 or +61'}
          className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
        />
        <p className="text-xs text-muted-foreground">
          Calls whose {form.type === 'vendor' ? 'destination (CLD)' : 'originator (CLI)'} starts with this prefix will be matched to this {form.type}.
        </p>
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Rate / min (USD)</label>
        <input
          data-testid="input-profile-rate"
          type="number"
          step="0.0001"
          min="0"
          value={form.ratePerMin ?? 0.025}
          onChange={e => set('ratePerMin', parseFloat(e.target.value))}
          className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
        />
      </div>
      <div className="sm:col-span-2 space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Notes</label>
        <input
          data-testid="input-profile-notes"
          value={form.notes || ''}
          onChange={e => set('notes', e.target.value)}
          placeholder="Optional notes about this party…"
          className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
        />
      </div>
      <div className="sm:col-span-2 flex gap-3 pt-1">
        <button
          data-testid="button-save-profile"
          onClick={() => onSave(form)}
          disabled={isSaving || !form.name}
          className="flex items-center gap-2 px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          Save
        </button>
        <button
          onClick={onCancel}
          className="flex items-center gap-2 px-5 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted/50 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function ClientsPage() {
  const { isManagement } = useAuth();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [importingId, setImportingId] = useState<string | null>(null);

  const { data: profiles = [], isLoading } = useQuery<ClientProfile[]>({
    queryKey: ['/api/clients'],
  });

  // VOS3000 portal queries
  const { data: portalSession } = useQuery<{ active: boolean; username?: string }>({
    queryKey: ['/api/portal/session'],
    refetchInterval: 30000,
  });
  const {
    data: vosClientsData,
    isLoading: vosClientsLoading,
    refetch: refetchVosClients,
    isFetched: vosClientsFetched,
  } = useQuery<{ clients: VosClient[]; error?: string }>({
    queryKey: ['/api/portal/clients'],
    enabled: portalSession?.active === true,
  });

  const importMut = useMutation({
    mutationFn: (vosClient: VosClient) =>
      apiRequest('POST', '/api/clients', {
        name: vosClient.name,
        type: 'client',
        prefix: '',
        ratePerMin: 0.025,
        notes: `Imported from VOS3000 — ID: ${vosClient.id}`,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/clients'] }),
    onSettled: () => setImportingId(null),
  });

  const createMut = useMutation({
    mutationFn: (data: any) => apiRequest('POST', '/api/clients', data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['/api/clients'] }); setAdding(false); },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest('PATCH', `/api/clients/${id}`, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['/api/clients'] }); setEditingId(null); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/clients/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/clients'] }),
  });

  const clients = profiles.filter(p => p.type === 'client');
  const vendors  = profiles.filter(p => p.type === 'vendor');
  const importedNames = new Set(profiles.map(p => p.name));

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Clients & Vendors</h2>
          <p className="text-muted-foreground mt-1">
            Define named parties so ASR/ACD reports show company names alongside phone numbers.
          </p>
        </div>
        {isManagement && !adding && (
          <button
            data-testid="button-add-profile"
            onClick={() => setAdding(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Profile
          </button>
        )}
      </div>

      {/* Concept explanation */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {(Object.entries(TYPE_META) as [string, typeof TYPE_META['client']][]).map(([key, m]) => (
          <div key={key} className={`rounded-xl border p-4 ${m.bg}`}>
            <div className="flex items-center gap-2 mb-2">
              <m.icon className={`w-4 h-4 ${m.color}`} />
              <span className={`font-semibold text-sm ${m.color}`}>{m.label}</span>
            </div>
            <p className="text-xs text-muted-foreground">{m.desc}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {key === 'client'
                ? 'CLI = the number they call from. Matched by prefix in reports.'
                : 'CLD = the destination number. Matched by prefix in reports.'}
            </p>
          </div>
        ))}
      </div>

      {/* Add form */}
      {adding && (
        <ProfileForm
          initial={{ ...empty }}
          onSave={(data) => createMut.mutate(data)}
          onCancel={() => setAdding(false)}
          isSaving={createMut.isPending}
        />
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
          Loading profiles…
        </div>
      ) : (
        <>
          {/* Clients */}
          <ProfileTable
            title="Clients"
            icon={Building2}
            color="text-emerald-400"
            profiles={clients}
            editingId={editingId}
            setEditingId={setEditingId}
            updateMut={updateMut}
            deleteMut={deleteMut}
            isManagement={isManagement}
            emptyNote="No clients yet. Add a client to see their name in ASR/ACD reports."
          />

          {/* Vendors */}
          <ProfileTable
            title="Vendors / Carriers"
            icon={Server}
            color="text-violet-400"
            profiles={vendors}
            editingId={editingId}
            setEditingId={setEditingId}
            updateMut={updateMut}
            deleteMut={deleteMut}
            isManagement={isManagement}
            emptyNote="No vendors yet. Add a vendor/carrier to track termination destinations."
          />
        </>
      )}

      {/* ── VOS3000 Terminal Accounts ──────────────────────────────────── */}
      <div className="rounded-xl border overflow-hidden bg-card/60"
           style={{ borderColor: portalSession?.active ? 'rgb(139 92 246 / 0.3)' : undefined }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 bg-muted/20">
          <div className="flex items-center gap-3">
            <Globe className={`w-4 h-4 ${portalSession?.active ? 'text-violet-400' : 'text-muted-foreground'}`} />
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-sm">VOS3000 Terminal Accounts</h3>
                {portalSession?.active ? (
                  <span className="text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-400 border border-violet-500/20">
                    Portal Connected
                  </span>
                ) : (
                  <span className="text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
                    Not Connected
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {portalSession?.active
                  ? 'Client accounts configured in your VOS3000 switch — import any as a local profile'
                  : 'Connect to VOS3000 in Settings to load client accounts from the switch'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {portalSession?.active && (
              <button
                data-testid="button-refresh-vos-clients"
                onClick={() => refetchVosClients()}
                disabled={vosClientsLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-3 h-3 ${vosClientsLoading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            )}
            {!portalSession?.active && (
              <Link href="/settings"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
                Connect
              </Link>
            )}
          </div>
        </div>

        {!portalSession?.active ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
            <Globe className="w-8 h-8 opacity-30" />
            <p className="text-sm">Connect to your VOS3000 portal to load terminal accounts.</p>
          </div>
        ) : vosClientsLoading ? (
          <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground text-sm">
            <RefreshCw className="w-4 h-4 animate-spin" />
            Loading terminal accounts from VOS3000…
          </div>
        ) : vosClientsData?.error ? (
          <div className="flex flex-col items-center justify-center py-10 gap-2 text-amber-400 text-sm text-center px-6">
            <AlertTriangle className="w-5 h-5" />
            <p>{vosClientsData.error}</p>
            <p className="text-xs text-muted-foreground">The portal user account may not have permission to list terminal accounts.</p>
          </div>
        ) : !vosClientsData?.clients?.length ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground text-sm">
            <Building2 className="w-7 h-7 opacity-30" />
            <p>No terminal accounts found on the portal.</p>
          </div>
        ) : (
          <div className="divide-y divide-border/30">
            {vosClientsData.clients.map((c) => {
              const alreadyImported = importedNames.has(c.name);
              return (
                <div
                  key={c.id}
                  data-testid={`row-vos-client-${c.id}`}
                  className="flex items-center justify-between px-6 py-3.5 hover:bg-muted/20 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Building2 className="w-4 h-4 text-violet-400 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{c.name}</p>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-xs text-muted-foreground font-mono">ID: {c.id}</span>
                        {c.type && <span className="text-xs text-muted-foreground">{c.type}</span>}
                        {c.balance !== 0 && (
                          <span className={`text-xs ${c.balance >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            Balance: ${c.balance.toFixed(2)}
                          </span>
                        )}
                        {c.status && (
                          <span className={`text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded ${
                            c.status.toLowerCase().includes('active') || c.status === '1' || c.status === 'enabled'
                              ? 'bg-emerald-500/10 text-emerald-400'
                              : 'bg-muted text-muted-foreground'
                          }`}>
                            {c.status.toLowerCase().includes('active') || c.status === '1' || c.status === 'enabled' ? 'Active' : c.status}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  {isManagement && (
                    alreadyImported ? (
                      <span className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium px-3 py-1.5">
                        <Check className="w-3.5 h-3.5" />
                        Imported
                      </span>
                    ) : (
                      <button
                        data-testid={`button-import-vos-${c.id}`}
                        onClick={() => { setImportingId(c.id); importMut.mutate(c); }}
                        disabled={importMut.isPending && importingId === c.id}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-violet-500/40 text-xs text-violet-400 hover:bg-violet-500/10 transition-colors disabled:opacity-50"
                      >
                        {importMut.isPending && importingId === c.id
                          ? <Loader2 className="w-3 h-3 animate-spin" />
                          : <Download className="w-3 h-3" />
                        }
                        Import
                      </button>
                    )
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function ProfileTable({
  title, icon: Icon, color, profiles, editingId, setEditingId, updateMut, deleteMut, isManagement, emptyNote,
}: any) {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-6 py-4 border-b border-border/50 bg-muted/20">
        <Icon className={`w-4 h-4 ${color}`} />
        <h3 className="font-semibold text-sm">{title}</h3>
        <span className="ml-auto text-xs text-muted-foreground">{profiles.length} profile{profiles.length !== 1 ? 's' : ''}</span>
      </div>
      {profiles.length === 0 ? (
        <div className="px-6 py-8 text-center text-sm text-muted-foreground">{emptyNote}</div>
      ) : (
        <div className="divide-y divide-border/30">
          {profiles.map((p: ClientProfile) => (
            <div key={p.id}>
              {editingId === p.id ? (
                <div className="p-4">
                  <ProfileForm
                    initial={p}
                    onSave={(data) => updateMut.mutate({ id: p.id, data })}
                    onCancel={() => setEditingId(null)}
                    isSaving={updateMut.isPending}
                  />
                </div>
              ) : (
                <div
                  data-testid={`row-profile-${p.id}`}
                  className="flex items-center justify-between px-6 py-4 hover:bg-muted/20 transition-colors"
                >
                  <div className="flex-1 min-w-0 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1">
                    <div>
                      <p className="font-medium text-sm truncate">{p.name}</p>
                      {p.notes && <p className="text-xs text-muted-foreground truncate">{p.notes}</p>}
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Prefix</p>
                      <p className="font-mono text-sm">{p.prefix || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Rate / min</p>
                      <p className="text-sm">${(p.ratePerMin ?? 0.025).toFixed(4)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Added</p>
                      <p className="text-xs text-muted-foreground">
                        {p.createdAt ? new Date(p.createdAt).toLocaleDateString() : '—'}
                      </p>
                    </div>
                  </div>
                  {isManagement && (
                    <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                      <button
                        data-testid={`button-edit-profile-${p.id}`}
                        onClick={() => setEditingId(p.id)}
                        className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        data-testid={`button-delete-profile-${p.id}`}
                        onClick={() => deleteMut.mutate(p.id)}
                        disabled={deleteMut.isPending}
                        className="p-2 rounded-lg text-muted-foreground hover:text-rose-400 hover:bg-rose-500/10 transition-colors disabled:opacity-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

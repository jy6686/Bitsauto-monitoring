import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Plus, Pencil, Trash2, Loader2, Building2, Server, X, Check } from "lucide-react";
import type { ClientProfile } from "@shared/schema";

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

  const { data: profiles = [], isLoading } = useQuery<ClientProfile[]>({
    queryKey: ['/api/clients'],
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

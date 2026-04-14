import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth, type AuthUser } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import { Link } from "wouter";
import {
  Shield, Users, Loader2, CheckCircle2, UserCog, Search,
  Crown, Eye, Briefcase, Calendar, ChevronDown, XCircle, UserCheck,
  MonitorDot, ChevronRight, Activity, BarChart2, MapPin, Bell,
  AlertTriangle, DollarSign, Phone, Route, Tv2, List,
  Mail, Plus, Trash2, Edit2, X, TrendingUp, TrendingDown,
  UserPlus, PhoneCall, LinkIcon, Unlink, ShieldAlert, Check, Server, FileText,
} from "lucide-react";
import { useState, useMemo } from "react";
import type { Role } from "@shared/schema";
import { MONITORING_ITEMS, type MonitoringItemId } from "@shared/schema";

type TeamMember = AuthUser;

// ─── KAM Types ────────────────────────────────────────────────────────────────
interface KamAccount {
  id: number;
  kamId: number;
  accountId: string;
  clientName: string | null;
  dropThreshold: number | null;
  createdAt: string;
}

interface Kam {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  title: string | null;
  active: boolean;
  createdAt: string;
  accounts: KamAccount[];
}

interface SippyAccount {
  iAccount: number;
  username: string;
  description: string;
  blocked: boolean;
  expired: boolean;
  balance: number;
  creditLimit: number;
  currency: string;
}

interface TrafficAlert {
  id: number;
  clientName: string;
  alertType: string;
  prevCalls: number | null;
  currCalls: number | null;
  emailSent: boolean | null;
  resolvedAt: string | null;
  triggeredAt: string | null;
}

// ─── KAM Form Dialog ──────────────────────────────────────────────────────────
function KamFormDialog({ onClose, editKam }: {
  onClose: () => void;
  editKam?: Kam;
}) {
  const qc = useQueryClient();
  const [name, setName]   = useState(editKam?.name  ?? '');
  const [email, setEmail] = useState(editKam?.email ?? '');
  const [phone, setPhone] = useState(editKam?.phone ?? '');
  const [title, setTitle] = useState(editKam?.title ?? '');
  const [err, setErr]     = useState('');

  // Pre-populate selected account IDs from existing assignments (edit mode)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    new Set((editKam?.accounts ?? []).map(a => String(a.accountId)))
  );

  // Fetch Sippy accounts for the client picker
  const { data: sippyData, isLoading: sippyLoading } = useQuery<{ accounts: SippyAccount[] }>({
    queryKey: ['/api/sippy/accounts'],
    staleTime: 60_000,
  });
  const sippyAccounts = sippyData?.accounts ?? [];

  function toggleAccount(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const mutation = useMutation({
    mutationFn: async () => {
      // 1. Create or update KAM
      const res = editKam
        ? await apiRequest('PATCH', `/api/kam/${editKam.id}`, { name, email, phone: phone || null, title: title || null })
        : await apiRequest('POST',  '/api/kam',               { name, email, phone: phone || null, title: title || null });
      const kamData = await res.json();
      const kamId   = editKam?.id ?? kamData.id;

      // 2. Edit mode: remove assignments for deselected accounts
      if (editKam) {
        for (const acc of editKam.accounts) {
          if (!selectedIds.has(String(acc.accountId))) {
            await apiRequest('DELETE', `/api/kam/accounts/${acc.id}`, {});
          }
        }
      }

      // 3. Add newly selected accounts (skip already-assigned ones)
      const existingIds = new Set((editKam?.accounts ?? []).map(a => String(a.accountId)));
      for (const acctId of selectedIds) {
        if (!existingIds.has(acctId)) {
          const acct = sippyAccounts.find(a => String(a.iAccount) === acctId);
          await apiRequest('POST', `/api/kam/${kamId}/accounts`, {
            accountId:     acctId,
            clientName:    acct?.username ?? acctId,
            dropThreshold: 0,
          });
        }
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['/api/kam'] }); onClose(); },
    onError:   (e: any) => setErr(e.message || 'Failed to save'),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim()) { setErr('Name and email are required'); return; }
    setErr('');
    mutation.mutate();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-2xl p-6 w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <UserCheck className="w-5 h-5 text-violet-400" />
            <h3 className="font-semibold text-lg">{editKam ? 'Edit KAM' : 'Add Key Account Manager'}</h3>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-3 overflow-y-auto min-h-0">
          {/* Name */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block font-medium">Full Name *</label>
            <input
              data-testid="input-kam-name"
              value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. John Doe"
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500/50"
            />
          </div>

          {/* Email */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block font-medium">Email Address *</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <input
                data-testid="input-kam-email"
                type="email"
                value={email} onChange={e => setEmail(e.target.value)}
                placeholder="kam@company.com"
                className="w-full pl-9 pr-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500/50"
              />
            </div>
          </div>

          {/* Phone + Title */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block font-medium">Phone</label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                <input
                  data-testid="input-kam-phone"
                  value={phone} onChange={e => setPhone(e.target.value)}
                  placeholder="+1 555 000 0000"
                  className="w-full pl-9 pr-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500/50"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block font-medium">Title / Role</label>
              <input
                data-testid="input-kam-title"
                value={title} onChange={e => setTitle(e.target.value)}
                placeholder="Account Manager"
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500/50"
              />
            </div>
          </div>

          {/* ── Assign Clients ───────────────────────────────────────────────── */}
          <div>
            <label className="text-xs text-muted-foreground mb-2 flex items-center gap-1.5 font-medium">
              <LinkIcon className="w-3.5 h-3.5" />
              Assign Clients (Sippy Accounts)
              {selectedIds.size > 0 && (
                <span className="ml-1 px-1.5 py-0.5 bg-violet-500/20 text-violet-300 rounded-full text-[10px] font-semibold border border-violet-500/30">
                  {selectedIds.size} selected
                </span>
              )}
            </label>

            {sippyLoading ? (
              <div className="flex items-center gap-2 py-4 text-muted-foreground text-xs">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Loading accounts from Sippy…
              </div>
            ) : sippyAccounts.length === 0 ? (
              <div className="text-xs text-muted-foreground/50 py-3 text-center border border-dashed border-border rounded-lg">
                No Sippy accounts found
              </div>
            ) : (
              <div className="border border-border rounded-xl overflow-hidden divide-y divide-border/40 max-h-48 overflow-y-auto">
                {sippyAccounts.map(acct => {
                  const id      = String(acct.iAccount);
                  const checked = selectedIds.has(id);
                  return (
                    <button
                      key={id}
                      type="button"
                      data-testid={`checkbox-kam-acct-${id}`}
                      onClick={() => toggleAccount(id)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                        checked ? 'bg-violet-500/10 hover:bg-violet-500/15' : 'hover:bg-muted/30'
                      }`}
                    >
                      {/* Custom checkbox */}
                      <div className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-all ${
                        checked ? 'bg-violet-500 border-violet-500' : 'border-border bg-background'
                      }`}>
                        {checked && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
                      </div>

                      {/* Account info */}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold truncate">{acct.username}</div>
                        {acct.description && (
                          <div className="text-xs text-muted-foreground truncate">{acct.description}</div>
                        )}
                      </div>

                      {/* Status + balance */}
                      <div className="flex-shrink-0 flex items-center gap-1.5">
                        {acct.blocked ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-400 border border-rose-500/20 font-medium">BLOCKED</span>
                        ) : (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 font-medium">ACTIVE</span>
                        )}
                        <span className="text-xs text-muted-foreground font-mono">${acct.balance.toFixed(0)}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {err && (
            <p className="text-xs text-rose-400 flex items-center gap-1">
              <XCircle className="w-3.5 h-3.5" />{err}
            </p>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-lg border border-border text-sm hover:bg-muted/40 transition-colors">
              Cancel
            </button>
            <button
              data-testid="button-save-kam"
              type="submit"
              disabled={mutation.isPending}
              className="flex-1 py-2.5 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-500 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {mutation.isPending
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <CheckCircle2 className="w-3.5 h-3.5" />}
              {editKam ? 'Save Changes' : 'Add KAM'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Assign Account Dialog ─────────────────────────────────────────────────────
function AssignSippyAccountDialog({ kam, sippyAccounts, existingAccountIds, onClose }: {
  kam: Kam;
  sippyAccounts: SippyAccount[];
  existingAccountIds: Set<string>;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const available = sippyAccounts.filter(a => !existingAccountIds.has(String(a.iAccount)));
  const [selected, setSelected] = useState<SippyAccount | null>(available[0] ?? null);
  const [err, setErr] = useState('');

  const mutation = useMutation({
    mutationFn: () => {
      if (!selected) throw new Error('Select an account');
      return apiRequest('POST', `/api/kam/${kam.id}/accounts`, {
        accountId: String(selected.iAccount),
        clientName: selected.username,
      });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['/api/kam'] }); onClose(); },
    onError: (e: any) => setErr(e.message || 'Failed to assign'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-sm shadow-2xl mx-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <LinkIcon className="w-4 h-4 text-emerald-400" />
            <h3 className="font-semibold">Assign Account to {kam.name}</h3>
          </div>
          <button onClick={onClose}><X className="w-4 h-4 text-muted-foreground" /></button>
        </div>

        {available.length === 0 ? (
          <div className="text-center py-6">
            <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
            <p className="text-sm font-medium">All accounts assigned</p>
            <p className="text-xs text-muted-foreground mt-1">Every Sippy account is already linked to this KAM.</p>
            <button onClick={onClose} className="mt-4 px-4 py-2 rounded-lg border border-border text-sm hover:bg-muted/40">Close</button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">Select a Sippy account to link to this KAM's watchlist.</p>
            <div className="space-y-2">
              {available.map(a => (
                <button
                  key={a.iAccount}
                  data-testid={`btn-select-account-${a.iAccount}`}
                  onClick={() => setSelected(a)}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border transition-all text-left ${
                    selected?.iAccount === a.iAccount
                      ? 'bg-violet-500/10 border-violet-500/40'
                      : 'border-border hover:bg-muted/30'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      selected?.iAccount === a.iAccount ? 'bg-violet-400' : 'bg-border'
                    }`} />
                    <div>
                      <p className="text-sm font-medium">{a.username}</p>
                      <p className="text-xs text-muted-foreground">
                        ID: {a.iAccount}
                        {a.blocked && <span className="ml-1.5 text-rose-400">(blocked)</span>}
                      </p>
                    </div>
                  </div>
                  <span className={`text-xs font-medium ${a.balance < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                    ${a.balance.toFixed(2)}
                  </span>
                </button>
              ))}
            </div>
            {err && <p className="text-xs text-rose-400">{err}</p>}
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={onClose}
                className="flex-1 py-2 rounded-lg border border-border text-sm hover:bg-muted/40">Cancel</button>
              <button
                data-testid="button-confirm-assign-account"
                onClick={() => mutation.mutate()}
                disabled={mutation.isPending || !selected}
                className="flex-1 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-500 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {mutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LinkIcon className="w-3.5 h-3.5" />}
                Assign
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── KAM Row ──────────────────────────────────────────────────────────────────
function KamRow({ kam, sippyAccounts, liveMap, onEdit, onDelete }: {
  kam: Kam;
  sippyAccounts: SippyAccount[];
  liveMap: Map<string, number>;
  onEdit: (k: Kam) => void;
  onDelete: (id: number) => void;
}) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [showAssign, setShowAssign] = useState(false);

  const existingAccountIds = new Set(kam.accounts.map(a => a.accountId));
  const totalLive = kam.accounts.reduce((s, a) => s + (liveMap.get(a.clientName ?? '') ?? 0), 0);

  const removeAssignment = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/kam/accounts/${id}`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/api/kam'] }),
  });

  return (
    <>
      {showAssign && (
        <AssignSippyAccountDialog
          kam={kam}
          sippyAccounts={sippyAccounts}
          existingAccountIds={existingAccountIds}
          onClose={() => setShowAssign(false)}
        />
      )}
      <div data-testid={`kam-row-${kam.id}`} className="border border-border/40 rounded-xl overflow-hidden">
        {/* Header Row */}
        <div className="flex items-center gap-3 px-4 py-3 bg-muted/5">
          {/* Avatar */}
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-violet-500/30 to-blue-500/30 border border-border flex items-center justify-center text-sm font-bold text-violet-300 flex-shrink-0 select-none">
            {kam.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
          </div>
          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm">{kam.name}</span>
              {kam.title && <span className="text-xs text-muted-foreground">· {kam.title}</span>}
              {totalLive > 0 && (
                <span className="text-xs px-1.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-medium">
                  {totalLive} live
                </span>
              )}
              {!kam.active && (
                <span className="text-xs px-1.5 py-0.5 rounded-full bg-muted border border-border text-muted-foreground">inactive</span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{kam.email}</span>
              {kam.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{kam.phone}</span>}
              <span className="text-muted-foreground/50">{kam.accounts.length} client{kam.accounts.length !== 1 ? 's' : ''}</span>
            </div>
          </div>
          {/* Actions */}
          <div className="flex items-center gap-1 flex-shrink-0">
            <Link
              href={`/bitseye?view=kam&kamId=${kam.id}`}
              data-testid={`link-bitseye-kam-${kam.id}`}
              title="View in BitsEye"
              className="p-1.5 rounded-lg hover:bg-violet-500/10 text-muted-foreground hover:text-violet-400 transition-colors"
            >
              <Eye className="w-3.5 h-3.5" />
            </Link>
            <button
              data-testid={`btn-edit-kam-${kam.id}`}
              onClick={() => onEdit(kam)}
              className="p-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
              title="Edit KAM"
            >
              <Edit2 className="w-3.5 h-3.5" />
            </button>
            <button
              data-testid={`btn-delete-kam-${kam.id}`}
              onClick={() => onDelete(kam.id)}
              className="p-1.5 rounded-lg hover:bg-rose-500/10 text-muted-foreground hover:text-rose-400 transition-colors"
              title="Delete KAM"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            <button
              data-testid={`btn-expand-kam-${kam.id}`}
              onClick={() => setExpanded(e => !e)}
              className="p-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground transition-colors"
            >
              <ChevronRight className={`w-3.5 h-3.5 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`} />
            </button>
          </div>
        </div>

        {/* Expanded Client Assignments */}
        {expanded && (
          <div className="border-t border-border/30 px-4 py-3 bg-background/40 space-y-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Assigned Client Accounts ({kam.accounts.length})
              </span>
              <button
                data-testid={`btn-assign-account-${kam.id}`}
                onClick={() => setShowAssign(true)}
                className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg bg-violet-600/20 border border-violet-500/30 text-violet-300 hover:bg-violet-600/30 transition-colors"
              >
                <Plus className="w-3 h-3" /> Assign Account
              </button>
            </div>

            {kam.accounts.length === 0 ? (
              <div className="flex flex-col items-center py-4 gap-2 text-muted-foreground/50">
                <Unlink className="w-6 h-6 opacity-40" />
                <p className="text-xs">No accounts assigned yet</p>
                <button
                  onClick={() => setShowAssign(true)}
                  className="text-xs text-violet-400 hover:text-violet-300"
                >
                  Assign a Sippy account →
                </button>
              </div>
            ) : (
              <div className="grid gap-1.5">
                {kam.accounts.map(a => {
                  const sippyAcc = sippyAccounts.find(s => String(s.iAccount) === a.accountId);
                  const live = liveMap.get(a.clientName ?? '') ?? 0;
                  return (
                    <div
                      key={a.id}
                      data-testid={`assignment-row-${a.id}`}
                      className="flex items-center justify-between bg-muted/20 hover:bg-muted/30 rounded-lg px-3 py-2.5 transition-colors"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${live > 0 ? 'bg-emerald-400 animate-pulse' : sippyAcc?.blocked ? 'bg-rose-400' : 'bg-muted-foreground/30'}`} />
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{a.clientName ?? a.accountId}</p>
                          <p className="text-xs text-muted-foreground">
                            iAccount: {a.accountId}
                            {sippyAcc?.blocked && <span className="ml-1.5 text-rose-400/80">blocked</span>}
                            {sippyAcc && <span className="ml-1.5 text-muted-foreground/60">· ${sippyAcc.balance.toFixed(2)}</span>}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2.5 flex-shrink-0">
                        <span className={`text-xs font-semibold tabular-nums ${live > 0 ? 'text-emerald-400' : 'text-muted-foreground/40'}`}>
                          {live > 0 ? `${live} call${live !== 1 ? 's' : ''}` : 'idle'}
                        </span>
                        <button
                          data-testid={`btn-remove-assignment-${a.id}`}
                          onClick={() => removeAssignment.mutate(a.id)}
                          disabled={removeAssignment.isPending}
                          className="p-1 rounded hover:bg-rose-500/15 text-muted-foreground/60 hover:text-rose-400 transition-colors"
                          title="Remove assignment"
                        >
                          <Unlink className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

// ─── Monitoring item visual config ───────────────────────────────────────────

const ITEM_ICON: Record<MonitoringItemId, React.ElementType> = {
  live_summary:      Tv2,
  live_details:      List,
  live_quality:      Activity,
  call_history:      Phone,
  balance_monitor:   DollarSign,
  alerts:            Bell,
  fraud_fas:         AlertTriangle,
  traffic_map:       MapPin,
  graphs:            TrendingUp,
  bitseye:           Eye,
  server_monitoring: Server,
  cdr_viewer:        FileText,
  reports:           BarChart2,
  route_quality:     Route,
  did_management:    MonitorDot,
};

const ITEM_COLOR: Record<MonitoringItemId, string> = {
  live_summary:      'text-violet-400',
  live_details:      'text-violet-400',
  live_quality:      'text-violet-400',
  call_history:      'text-violet-400',
  balance_monitor:   'text-emerald-400',
  alerts:            'text-rose-400',
  fraud_fas:         'text-orange-400',
  traffic_map:       'text-cyan-400',
  graphs:            'text-indigo-400',
  bitseye:           'text-blue-400',
  server_monitoring: 'text-slate-400',
  cdr_viewer:        'text-teal-400',
  reports:           'text-blue-400',
  route_quality:     'text-blue-400',
  did_management:    'text-amber-400',
};

const GROUP_COLOR: Record<string, string> = {
  'Live Calls':  'text-violet-400 border-violet-500/30 bg-violet-500/10',
  'Finance':     'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
  'Operations':  'text-cyan-400 border-cyan-500/30 bg-cyan-500/10',
  'Security':    'text-orange-400 border-orange-500/30 bg-orange-500/10',
  'Analytics':   'text-indigo-400 border-indigo-500/30 bg-indigo-500/10',
  'Reports':     'text-blue-400 border-blue-500/30 bg-blue-500/10',
};

// ─── Role metadata ────────────────────────────────────────────────────────────

const ROLE_META: Record<Role, {
  label: string; color: string; bg: string; border: string;
  iconColor: string; desc: string; icon: React.ElementType;
}> = {
  admin: {
    label: "Admin",
    color: "text-rose-400",
    bg: "bg-rose-500/10",
    border: "border-rose-500/30",
    iconColor: "text-rose-400",
    icon: Crown,
    desc: "Full access — all pages, settings, and team management.",
  },
  management: {
    label: "Management",
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
    iconColor: "text-amber-400",
    icon: Briefcase,
    desc: "Dashboard, calls, alerts, reports. No settings or team management.",
  },
  viewer: {
    label: "Viewer",
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/30",
    iconColor: "text-blue-400",
    icon: Eye,
    desc: "Dashboard and alerts only. Read-only access.",
  },
};

const PERMISSIONS = [
  { label: "Dashboard",          admin: true,  mgmt: true,  viewer: true  },
  { label: "Active Calls",       admin: true,  mgmt: true,  viewer: true  },
  { label: "Call History (CDR)", admin: true,  mgmt: true,  viewer: false },
  { label: "Traffic Map",        admin: true,  mgmt: true,  viewer: false },
  { label: "Alerts",             admin: true,  mgmt: true,  viewer: false },
  { label: "ASR/ACD Reports",    admin: true,  mgmt: true,  viewer: false },
  { label: "FAS / Fraud",        admin: true,  mgmt: true,  viewer: false },
  { label: "Client Profiles",    admin: true,  mgmt: true,  viewer: false },
  { label: "Vendor Profiles",    admin: true,  mgmt: true,  viewer: false },
  { label: "Calculators",        admin: true,  mgmt: true,  viewer: true  },
  { label: "Settings",           admin: true,  mgmt: false, viewer: false },
  { label: "Team Management",    admin: true,  mgmt: false, viewer: false },
];

// ─── Small reusable pieces ────────────────────────────────────────────────────

function RoleBadge({ role }: { role: Role }) {
  const m = ROLE_META[role] || ROLE_META.viewer;
  const Icon = m.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${m.bg} ${m.border} ${m.color}`}>
      <Icon className="w-3 h-3" />
      {m.label}
    </span>
  );
}

function MemberAvatar({ member }: { member: TeamMember }) {
  const initials = ((member.firstName?.[0] || '') + (member.lastName?.[0] || '')).toUpperCase()
    || member.email?.[0]?.toUpperCase() || '?';
  if (member.profileImageUrl) {
    return (
      <img
        src={member.profileImageUrl}
        alt={initials}
        className="h-10 w-10 rounded-full object-cover ring-2 ring-border flex-shrink-0"
      />
    );
  }
  return (
    <div className="h-10 w-10 rounded-full bg-gradient-to-br from-violet-500/30 to-blue-500/30 ring-2 ring-border flex items-center justify-center text-sm font-bold text-violet-300 flex-shrink-0 select-none">
      {initials}
    </div>
  );
}

function SmallAvatar({ member }: { member: TeamMember }) {
  const initials = ((member.firstName?.[0] || '') + (member.lastName?.[0] || '')).toUpperCase()
    || member.email?.[0]?.toUpperCase() || '?';
  if (member.profileImageUrl) {
    return (
      <img
        src={member.profileImageUrl}
        alt={initials}
        className="h-6 w-6 rounded-full object-cover ring-1 ring-border flex-shrink-0"
      />
    );
  }
  return (
    <div className="h-6 w-6 rounded-full bg-gradient-to-br from-violet-500/30 to-blue-500/30 ring-1 ring-border flex items-center justify-center text-[10px] font-bold text-violet-300 flex-shrink-0 select-none">
      {initials}
    </div>
  );
}

function RoleSelector({ memberId, currentRole, selfId }: {
  memberId: string; currentRole: Role; selfId: string;
}) {
  const queryClient = useQueryClient();
  const isSelf = memberId === selfId;

  const mutation = useMutation({
    mutationFn: (role: Role) => apiRequest("PATCH", `/api/team/${memberId}/role`, { role }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/team"] }),
  });

  if (isSelf) {
    return (
      <div className="flex items-center gap-2">
        <RoleBadge role={currentRole} />
        <span className="text-xs text-muted-foreground italic">(you)</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2.5">
      <div className="relative">
        <select
          data-testid={`select-role-${memberId}`}
          value={currentRole}
          disabled={mutation.isPending}
          onChange={(e) => mutation.mutate(e.target.value as Role)}
          className="appearance-none bg-background border border-border rounded-lg pl-3 pr-8 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500/60 transition-all disabled:opacity-50 cursor-pointer"
        >
          <option value="admin">Admin</option>
          <option value="management">Management</option>
          <option value="viewer">Viewer</option>
        </select>
        <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
      </div>
      {mutation.isPending && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
      {mutation.isSuccess && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
      {mutation.isError && (
        <span className="text-xs text-rose-400 flex items-center gap-1">
          <XCircle className="w-3.5 h-3.5" />
          {(mutation.error as any)?.message || "Failed"}
        </span>
      )}
    </div>
  );
}

// ─── Monitoring Assignment Panel (per-member) ─────────────────────────────────

function MonitoringAssignmentPanel({
  member,
  assignedItems,
  currentUserId,
}: {
  member: TeamMember;
  assignedItems: string[];
  currentUserId: string;
}) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [localItems, setLocalItems] = useState<Set<string>>(new Set(assignedItems));
  const [dirty, setDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const displayName = [member.firstName, member.lastName].filter(Boolean).join(' ') || member.email || member.id;

  const mutation = useMutation({
    mutationFn: (items: string[]) =>
      apiRequest('PUT', `/api/team/${member.id}/monitoring-assignments`, { items }),
    onMutate: () => setSaveStatus('saving'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/team/monitoring-assignments'] });
      setDirty(false);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2500);
    },
    onError: () => setSaveStatus('error'),
  });

  function toggle(id: string) {
    setLocalItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setDirty(true);
    setSaveStatus('idle');
  }

  function save() {
    mutation.mutate([...localItems]);
  }

  // Group items
  const groups = useMemo(() => {
    const map: Record<string, typeof MONITORING_ITEMS[number][]> = {};
    for (const item of MONITORING_ITEMS) {
      if (!map[item.group]) map[item.group] = [];
      map[item.group].push(item);
    }
    return Object.entries(map);
  }, []);

  const assignedCount = localItems.size;

  return (
    <div className="border border-border/40 rounded-xl overflow-hidden">
      {/* Row header */}
      <button
        data-testid={`btn-expand-assign-${member.id}`}
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/20 transition-colors text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <SmallAvatar member={member} />
          <div className="min-w-0">
            <p className="text-sm font-medium leading-tight truncate">{displayName}</p>
            <p className="text-xs text-muted-foreground">{member.email}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {assignedCount > 0 ? (
            <span className="text-xs px-2 py-0.5 rounded-full bg-violet-500/15 border border-violet-500/30 text-violet-300 font-medium">
              {assignedCount} item{assignedCount !== 1 ? 's' : ''}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50 italic">unassigned</span>
          )}
          <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`} />
        </div>
      </button>

      {/* Expanded checkboxes */}
      {expanded && (
        <div className="border-t border-border/40 px-4 py-4 space-y-4 bg-muted/5">
          {groups.map(([group, items]) => {
            const gc = GROUP_COLOR[group] || 'text-muted-foreground border-border bg-muted/20';
            return (
              <div key={group}>
                <p className={`text-xs font-semibold uppercase tracking-wider mb-2 px-2 py-0.5 rounded-md inline-flex items-center gap-1 border ${gc}`}>
                  {group}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {items.map(item => {
                    const Icon = ITEM_ICON[item.id as MonitoringItemId];
                    const ic = ITEM_COLOR[item.id as MonitoringItemId];
                    const checked = localItems.has(item.id);
                    return (
                      <label
                        key={item.id}
                        data-testid={`checkbox-assign-${member.id}-${item.id}`}
                        className={`flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer transition-colors border ${
                          checked
                            ? 'bg-violet-500/10 border-violet-500/30'
                            : 'border-transparent hover:bg-muted/30'
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={checked}
                          onChange={() => toggle(item.id)}
                        />
                        <div className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${
                          checked ? 'bg-violet-600 border-violet-500' : 'border-border bg-background'
                        }`}>
                          {checked && (
                            <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 10 8">
                              <path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </div>
                        <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${ic}`} />
                        <span className="text-sm leading-tight">{item.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}

          <div className="flex items-center justify-between pt-1 border-t border-border/30">
            <div className="flex items-center gap-2">
              {saveStatus === 'saved' && (
                <span className="text-xs text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Saved
                </span>
              )}
              {saveStatus === 'error' && (
                <span className="text-xs text-rose-400 flex items-center gap-1">
                  <XCircle className="w-3.5 h-3.5" /> Save failed
                </span>
              )}
            </div>
            <button
              data-testid={`btn-save-assign-${member.id}`}
              onClick={save}
              disabled={!dirty || saveStatus === 'saving'}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-medium hover:bg-violet-500 active:scale-95 transition-all disabled:opacity-40 whitespace-nowrap"
            >
              {saveStatus === 'saving'
                ? <><Loader2 className="w-3 h-3 animate-spin" /> Saving…</>
                : <><CheckCircle2 className="w-3 h-3" /> Save</>}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function TeamPage() {
  const { user, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [filterRole, setFilterRole] = useState<Role | 'all'>('all');
  const [assignEmail, setAssignEmail] = useState('');
  const [assignRole, setAssignRole] = useState<Role>('viewer');
  const [assignResult, setAssignResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [showKamDialog, setShowKamDialog] = useState(false);
  const [editKam, setEditKam] = useState<Kam | undefined>();

  const { data: members = [], isLoading } = useQuery<TeamMember[]>({
    queryKey: ["/api/team"],
    enabled: isAdmin,
  });

  const { data: allAssignments = {} } = useQuery<Record<string, string[]>>({
    queryKey: ["/api/team/monitoring-assignments"],
    enabled: isAdmin,
  });

  const { data: kams = [], isLoading: kamsLoading } = useQuery<Kam[]>({
    queryKey: ['/api/kam'],
    refetchInterval: 30_000,
  });

  const { data: sippyAccountsData } = useQuery<{ accounts: SippyAccount[] }>({
    queryKey: ['/api/sippy/accounts'],
    staleTime: 60_000,
  });
  const sippyAccounts = sippyAccountsData?.accounts ?? [];

  const { data: liveGraphs } = useQuery<{ byClient: { name: string; calls: number }[] }>({
    queryKey: ['/api/sippy/live-graphs', 1],
    queryFn: () => fetch('/api/sippy/live-graphs?hours=1').then(r => r.json()),
    refetchInterval: 30_000,
  });
  const liveMap = new Map((liveGraphs?.byClient ?? []).map(c => [c.name, c.calls]));

  const { data: trafficAlerts = [] } = useQuery<TrafficAlert[]>({
    queryKey: ['/api/traffic-alerts'],
    refetchInterval: 60_000,
  });

  const deleteKamMutation = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/kam/${id}`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/kam'] }),
  });

  const openAlerts = trafficAlerts.filter(a => !a.resolvedAt && a.alertType !== 'traffic_restored');
  const kamStats = useMemo(() => ({
    total:       kams.length,
    active:      kams.filter(k => k.active).length,
    assignments: kams.reduce((s, k) => s + k.accounts.length, 0),
    alerts:      openAlerts.length,
  }), [kams, openAlerts]);

  const stats = useMemo(() => ({
    total:      members.length,
    admin:      members.filter(m => m.role === 'admin').length,
    management: members.filter(m => m.role === 'management').length,
    viewer:     members.filter(m => m.role === 'viewer').length,
  }), [members]);

  const filtered = useMemo(() => {
    return members.filter(m => {
      const name = [m.firstName, m.lastName, m.email].filter(Boolean).join(' ').toLowerCase();
      const matchesSearch = !search || name.includes(search.toLowerCase());
      const matchesRole = filterRole === 'all' || m.role === filterRole;
      return matchesSearch && matchesRole;
    });
  }, [members, search, filterRole]);

  const assignMutation = useMutation({
    mutationFn: async () => {
      const email = assignEmail.trim().toLowerCase();
      const target = members.find(m => m.email?.toLowerCase() === email);
      if (!target) throw new Error(`No team member with email "${email}" found.`);
      await apiRequest('PATCH', `/api/team/${target.id}/role`, { role: assignRole });
      return target;
    },
    onSuccess: (target) => {
      queryClient.invalidateQueries({ queryKey: ['/api/team'] });
      setAssignResult({ ok: true, msg: `Role updated to ${ROLE_META[assignRole].label} for ${target.email}.` });
      setAssignEmail('');
    },
    onError: (err: any) => setAssignResult({ ok: false, msg: err.message || 'Failed to assign role.' }),
  });

  // Build assignment overview: item id → members assigned
  const assignmentOverview = useMemo(() => {
    const map: Record<string, TeamMember[]> = {};
    for (const item of MONITORING_ITEMS) map[item.id] = [];
    for (const member of members) {
      const items = allAssignments[member.id] ?? [];
      for (const itemId of items) {
        if (map[itemId]) map[itemId].push(member);
      }
    }
    return map;
  }, [members, allAssignments]);

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4 text-center">
        <Shield className="w-12 h-12 text-muted-foreground/40" />
        <h2 className="text-xl font-semibold">Access Restricted</h2>
        <p className="text-muted-foreground max-w-sm">
          Only Admins can manage team members and roles.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">

      {/* Header */}
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Team & KAM Management</h2>
        <p className="text-muted-foreground mt-1">
          Manage team roles, monitoring responsibilities, and Key Account Manager assignments.
        </p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total Members", value: stats.total,      icon: Users,    color: "text-violet-400", bg: "from-violet-500/10 to-violet-500/5", border: "border-violet-500/20" },
          { label: "Admins",        value: stats.admin,      icon: Crown,    color: "text-rose-400",   bg: "from-rose-500/10 to-rose-500/5",     border: "border-rose-500/20"   },
          { label: "Management",    value: stats.management, icon: Briefcase,color: "text-amber-400",  bg: "from-amber-500/10 to-amber-500/5",   border: "border-amber-500/20"  },
          { label: "Viewers",       value: stats.viewer,     icon: Eye,      color: "text-blue-400",   bg: "from-blue-500/10 to-blue-500/5",     border: "border-blue-500/20"   },
        ].map(({ label, value, icon: Icon, color, bg, border }) => (
          <div key={label} className={`rounded-xl border ${border} bg-gradient-to-br ${bg} p-4`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground font-medium">{label}</span>
              <Icon className={`w-4 h-4 ${color}`} />
            </div>
            <div className={`text-2xl font-bold ${color}`}>
              {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : value}
            </div>
          </div>
        ))}
      </div>

      {/* Two-column: Assign Role + Role Legend */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Quick Assign Role */}
        <div className="lg:col-span-3 bg-card border border-violet-500/20 rounded-xl overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-3.5 border-b border-border/50 bg-violet-500/5">
            <UserCog className="w-4 h-4 text-violet-400" />
            <h3 className="font-semibold text-sm">Assign Role</h3>
            <span className="text-xs text-muted-foreground hidden sm:block">— update a member's access level</span>
          </div>
          <div className="p-5 space-y-3">
            <div className="flex flex-col sm:flex-row gap-2.5">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <input
                  data-testid="input-assign-email"
                  type="email"
                  placeholder="member@example.com"
                  value={assignEmail}
                  onChange={e => { setAssignEmail(e.target.value); setAssignResult(null); }}
                  className="w-full pl-9 pr-4 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500/50 transition-all"
                />
              </div>
              <div className="relative">
                <select
                  data-testid="select-assign-role"
                  value={assignRole}
                  onChange={e => setAssignRole(e.target.value as Role)}
                  className="appearance-none bg-background border border-border rounded-lg pl-3 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500/50 transition-all cursor-pointer"
                >
                  <option value="admin">Admin</option>
                  <option value="management">Management</option>
                  <option value="viewer">Viewer</option>
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              </div>
              <button
                data-testid="button-assign-role"
                onClick={() => assignMutation.mutate()}
                disabled={assignMutation.isPending || !assignEmail.trim()}
                className="flex items-center justify-center gap-2 px-5 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-500 active:scale-95 transition-all disabled:opacity-50 whitespace-nowrap"
              >
                {assignMutation.isPending
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <UserCheck className="w-3.5 h-3.5" />}
                Assign
              </button>
            </div>
            {assignResult && (
              <p className={`text-sm flex items-center gap-2 ${assignResult.ok ? 'text-emerald-400' : 'text-rose-400'}`}>
                {assignResult.ok ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                {assignResult.msg}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Users must have signed in at least once to appear in the member list.
            </p>
          </div>
        </div>

        {/* Role Legend */}
        <div className="lg:col-span-2 space-y-2.5">
          {(Object.keys(ROLE_META) as Role[]).map((role) => {
            const m = ROLE_META[role];
            const Icon = m.icon;
            return (
              <div key={role} className={`rounded-xl border ${m.border} ${m.bg} p-3.5 flex items-start gap-3`}>
                <div className={`mt-0.5 p-1.5 rounded-lg ${m.bg} border ${m.border}`}>
                  <Icon className={`w-3.5 h-3.5 ${m.iconColor}`} />
                </div>
                <div>
                  <p className={`text-sm font-semibold ${m.color}`}>{m.label}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{m.desc}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Team Member List */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4 border-b border-border/50 bg-muted/20">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-muted-foreground" />
            <h3 className="font-semibold text-sm">Team Members</h3>
            {members.length > 0 && (
              <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                {filtered.length}{search || filterRole !== 'all' ? ` of ${members.length}` : ''}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <input
                data-testid="input-search-members"
                type="text"
                placeholder="Search members…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-8 pr-3 py-1.5 bg-background border border-border rounded-lg text-xs w-44 focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500/50 transition-all"
              />
            </div>
            <div className="relative">
              <select
                data-testid="select-filter-role"
                value={filterRole}
                onChange={e => setFilterRole(e.target.value as Role | 'all')}
                className="appearance-none bg-background border border-border rounded-lg pl-3 pr-7 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500/50 transition-all cursor-pointer"
              >
                <option value="all">All Roles</option>
                <option value="admin">Admin</option>
                <option value="management">Management</option>
                <option value="viewer">Viewer</option>
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-14 gap-3 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">Loading team members…</span>
          </div>
        ) : !members.length ? (
          <div className="text-center py-14 text-muted-foreground">
            <Users className="w-9 h-9 mx-auto mb-3 opacity-25" />
            <p className="text-sm font-medium">No team members yet</p>
            <p className="text-xs mt-1 opacity-70">Users appear here after they sign in for the first time.</p>
          </div>
        ) : !filtered.length ? (
          <div className="text-center py-14 text-muted-foreground">
            <Search className="w-9 h-9 mx-auto mb-3 opacity-25" />
            <p className="text-sm font-medium">No members match your search</p>
            <button
              onClick={() => { setSearch(''); setFilterRole('all'); }}
              className="text-xs mt-2 text-violet-400 hover:text-violet-300 transition-colors"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div className="divide-y divide-border/30">
            {filtered.map((member) => {
              const displayName = [member.firstName, member.lastName].filter(Boolean).join(' ') || member.email || member.id;
              const joinedDate = member.createdAt
                ? new Date(member.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                : null;
              const isSelf = member.id === user?.id;

              return (
                <div
                  key={member.id}
                  data-testid={`row-member-${member.id}`}
                  className="flex items-center justify-between px-5 py-4 hover:bg-muted/20 transition-colors gap-4"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <MemberAvatar member={member} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p data-testid={`text-member-name-${member.id}`} className="font-medium text-sm leading-tight">
                          {displayName}
                        </p>
                        {isSelf && (
                          <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-md italic">you</span>
                        )}
                      </div>
                      {member.email && (
                        <p data-testid={`text-member-email-${member.id}`} className="text-xs text-muted-foreground truncate">
                          {member.email}
                        </p>
                      )}
                      {joinedDate && (
                        <p className="text-xs text-muted-foreground/60 flex items-center gap-1 mt-0.5">
                          <Calendar className="w-3 h-3" />
                          Joined {joinedDate}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex-shrink-0">
                    <RoleSelector memberId={member.id} currentRole={member.role} selfId={user?.id ?? ''} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Monitoring Assignments ─────────────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border/50 bg-muted/20">
          <MonitorDot className="w-4 h-4 text-violet-400" />
          <div>
            <h3 className="font-semibold text-sm">Monitoring Assignments</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Select which monitoring areas each team member is responsible for. Expand a member to configure.
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12 gap-3 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">Loading…</span>
          </div>
        ) : !members.length ? (
          <div className="text-center py-12 text-muted-foreground">
            <Users className="w-9 h-9 mx-auto mb-3 opacity-25" />
            <p className="text-sm">No team members yet.</p>
          </div>
        ) : (
          <div className="p-4 space-y-2">
            {members.map(member => (
              <MonitoringAssignmentPanel
                key={member.id}
                member={member}
                assignedItems={allAssignments[member.id] ?? []}
                currentUserId={user?.id ?? ''}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Assignment Overview (item → who's watching) ───────────────────────── */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border/50 bg-muted/20">
          <Activity className="w-4 h-4 text-cyan-400" />
          <div>
            <h3 className="font-semibold text-sm">Assignment Overview</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Which team members are watching each area</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50 bg-muted/10">
                <th className="text-left px-5 py-3 text-xs text-muted-foreground font-medium uppercase tracking-wide">Monitoring Area</th>
                <th className="text-left px-5 py-3 text-xs text-muted-foreground font-medium uppercase tracking-wide">Group</th>
                <th className="text-left px-5 py-3 text-xs text-muted-foreground font-medium uppercase tracking-wide">Assigned To</th>
              </tr>
            </thead>
            <tbody>
              {MONITORING_ITEMS.map((item, i) => {
                const Icon = ITEM_ICON[item.id as MonitoringItemId];
                const ic = ITEM_COLOR[item.id as MonitoringItemId];
                const gc = GROUP_COLOR[item.group] || 'text-muted-foreground border-border bg-muted/20';
                const assigned = assignmentOverview[item.id] ?? [];
                return (
                  <tr
                    key={item.id}
                    data-testid={`row-overview-${item.id}`}
                    className={`border-b border-border/20 last:border-0 ${i % 2 === 0 ? '' : 'bg-muted/5'}`}
                  >
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <Icon className={`w-4 h-4 flex-shrink-0 ${ic}`} />
                        <span className="font-medium">{item.label}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-md border font-medium ${gc}`}>{item.group}</span>
                    </td>
                    <td className="px-5 py-3">
                      {assigned.length === 0 ? (
                        <span className="text-xs text-muted-foreground/50 italic">— unassigned</span>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {assigned.map(m => {
                            const name = [m.firstName, m.lastName].filter(Boolean).join(' ') || m.email || m.id;
                            return (
                              <div
                                key={m.id}
                                data-testid={`badge-assigned-${item.id}-${m.id}`}
                                className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-violet-500/10 border border-violet-500/30 text-violet-300 text-xs font-medium"
                              >
                                <SmallAvatar member={m} />
                                {name}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── KAM Dialogs ─────────────────────────────────────────────────────────── */}
      {(showKamDialog || editKam) && (
        <KamFormDialog
          editKam={editKam}
          onClose={() => { setShowKamDialog(false); setEditKam(undefined); }}
        />
      )}

      {/* ── KAM Stat Cards ──────────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-xl font-bold tracking-tight flex items-center gap-2">
              <UserCheck className="w-5 h-5 text-violet-400" />
              Key Account Managers (KAM)
            </h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Assign KAMs to Sippy client accounts — they receive email alerts when traffic drops.
            </p>
          </div>
          <button
            data-testid="btn-add-kam"
            onClick={() => setShowKamDialog(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-medium hover:bg-violet-500 active:scale-95 transition-all shadow-lg shadow-violet-900/30"
          >
            <UserPlus className="w-4 h-4" /> Add KAM
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          {[
            { label: 'Total KAMs',     value: kamStats.total,       icon: UserCheck,     color: 'text-violet-400', bg: 'from-violet-500/10 to-violet-500/5', border: 'border-violet-500/20' },
            { label: 'Active',         value: kamStats.active,      icon: Activity,      color: 'text-emerald-400', bg: 'from-emerald-500/10 to-emerald-500/5', border: 'border-emerald-500/20' },
            { label: 'Client Links',   value: kamStats.assignments,  icon: LinkIcon,      color: 'text-blue-400', bg: 'from-blue-500/10 to-blue-500/5', border: 'border-blue-500/20' },
            { label: 'Open Alerts',    value: kamStats.alerts,      icon: AlertTriangle, color: kamStats.alerts > 0 ? 'text-amber-400' : 'text-muted-foreground', bg: 'from-amber-500/10 to-amber-500/5', border: kamStats.alerts > 0 ? 'border-amber-500/30' : 'border-border/30' },
          ].map(({ label, value, icon: Icon, color, bg, border }) => (
            <div key={label} className={`rounded-xl border ${border} bg-gradient-to-br ${bg} p-4`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground font-medium">{label}</span>
                <Icon className={`w-4 h-4 ${color}`} />
              </div>
              <div className={`text-2xl font-bold ${color}`}>
                {kamsLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : value}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── KAM List ─────────────────────────────────────────────────────────────── */}
      <div className="bg-card border border-violet-500/20 rounded-xl overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border/50 bg-violet-500/5">
          <UserCheck className="w-4 h-4 text-violet-400" />
          <div className="flex-1">
            <h3 className="font-semibold text-sm">KAM Directory</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Expand each KAM to view and manage their assigned Sippy client accounts.
            </p>
          </div>
          {openAlerts.length > 0 && (
            <span className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 font-medium">
              <AlertTriangle className="w-3 h-3" />
              {openAlerts.length} open alert{openAlerts.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {kamsLoading ? (
          <div className="flex items-center justify-center py-14 gap-3 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">Loading KAMs…</span>
          </div>
        ) : kams.length === 0 ? (
          <div className="flex flex-col items-center py-16 gap-3 text-muted-foreground/50">
            <UserCheck className="w-12 h-12 opacity-20" />
            <p className="text-sm font-medium">No KAMs configured yet</p>
            <p className="text-xs max-w-xs text-center">Add your first Key Account Manager to start assigning client accounts and receiving traffic drop alerts.</p>
            <button
              onClick={() => setShowKamDialog(true)}
              className="mt-2 flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600/20 border border-violet-500/30 text-violet-300 text-sm hover:bg-violet-600/30 transition-colors"
            >
              <UserPlus className="w-4 h-4" /> Add first KAM
            </button>
          </div>
        ) : (
          <div className="p-4 space-y-2">
            {kams.map(k => (
              <KamRow
                key={k.id}
                kam={k}
                sippyAccounts={sippyAccounts}
                liveMap={liveMap}
                onEdit={setEditKam}
                onDelete={id => deleteKamMutation.mutate(id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Traffic Alert Log ────────────────────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border/50 bg-muted/20">
          <ShieldAlert className="w-4 h-4 text-amber-400" />
          <div className="flex-1">
            <h3 className="font-semibold text-sm">Traffic Drop Alert Log</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Recent traffic drop events — detected every 5 minutes by the background monitor</p>
          </div>
          {openAlerts.length > 0 && (
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
          )}
        </div>

        {trafficAlerts.length === 0 ? (
          <div className="flex flex-col items-center py-12 gap-2 text-muted-foreground/50">
            <Bell className="w-9 h-9 opacity-20" />
            <p className="text-sm">No traffic drop alerts yet</p>
            <p className="text-xs">Alerts appear here when a client's concurrent calls drop by &gt;50% or reach zero.</p>
          </div>
        ) : (
          <div className="divide-y divide-border/30">
            {trafficAlerts.slice(0, 30).map((alert, i) => {
              const pct = alert.prevCalls && alert.prevCalls > 0
                ? Math.round(((alert.prevCalls - (alert.currCalls ?? 0)) / alert.prevCalls) * 100) : 100;
              const isOpen = !alert.resolvedAt && alert.alertType !== 'traffic_restored';
              const typeColor = alert.alertType === 'traffic_gone' ? 'text-rose-400'
                : alert.alertType === 'traffic_restored' ? 'text-emerald-400'
                : 'text-amber-400';
              const TypeIcon = alert.alertType === 'traffic_gone' ? ShieldAlert
                : alert.alertType === 'traffic_restored' ? TrendingUp : TrendingDown;
              return (
                <div
                  key={alert.id}
                  data-testid={`alert-log-row-${alert.id}`}
                  className={`flex items-center gap-4 px-5 py-3 ${i % 2 === 0 ? '' : 'bg-muted/5'} ${isOpen ? 'bg-amber-500/5' : ''}`}
                >
                  <TypeIcon className={`w-4 h-4 flex-shrink-0 ${typeColor}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold">{alert.clientName}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full border font-medium ${
                        alert.alertType === 'traffic_gone' ? 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                        : alert.alertType === 'traffic_restored' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                        : 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                      }`}>
                        {alert.alertType === 'traffic_gone' ? 'GONE'
                          : alert.alertType === 'traffic_restored' ? 'RESTORED'
                          : `−${pct}%`}
                      </span>
                      {isOpen && (
                        <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-300">OPEN</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground flex-wrap">
                      <span>{alert.prevCalls ?? 0} → {alert.currCalls ?? 0} calls</span>
                      {alert.triggeredAt && <span>{new Date(alert.triggeredAt).toLocaleString()}</span>}
                      {alert.emailSent
                        ? <span className="flex items-center gap-1 text-emerald-400/70"><Mail className="w-3 h-3" />Email sent</span>
                        : <span className="flex items-center gap-1 text-muted-foreground/40"><Mail className="w-3 h-3" />No email</span>}
                      {alert.resolvedAt && <span className="text-emerald-400/60">Resolved {new Date(alert.resolvedAt).toLocaleTimeString()}</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Permissions Matrix */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-border/50 bg-muted/20">
          <h3 className="font-semibold text-sm">Permissions Matrix</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Which pages each role can access</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50 bg-muted/10">
                <th className="text-left px-5 py-3 text-muted-foreground font-medium text-xs uppercase tracking-wide">Page / Feature</th>
                <th className="text-center px-4 py-3 text-xs uppercase tracking-wide">
                  <span className="inline-flex items-center gap-1.5 text-rose-400 font-semibold"><Crown className="w-3.5 h-3.5" />Admin</span>
                </th>
                <th className="text-center px-4 py-3 text-xs uppercase tracking-wide">
                  <span className="inline-flex items-center gap-1.5 text-amber-400 font-semibold"><Briefcase className="w-3.5 h-3.5" />Mgmt</span>
                </th>
                <th className="text-center px-4 py-3 text-xs uppercase tracking-wide">
                  <span className="inline-flex items-center gap-1.5 text-blue-400 font-semibold"><Eye className="w-3.5 h-3.5" />Viewer</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {PERMISSIONS.map(({ label, admin, mgmt, viewer }, i) => (
                <tr key={label} className={`border-b border-border/20 last:border-0 ${i % 2 === 0 ? '' : 'bg-muted/5'}`}>
                  <td className="px-5 py-2.5 font-medium text-sm">{label}</td>
                  {[admin, mgmt, viewer].map((has, j) => (
                    <td key={j} className="text-center px-4 py-2.5">
                      {has
                        ? <CheckCircle2 className="w-4 h-4 text-emerald-400 mx-auto" />
                        : <span className="block w-4 h-0.5 bg-muted-foreground/20 mx-auto rounded-full" />}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-muted-foreground text-center pb-2">
        New users who sign in are automatically assigned the <strong>Viewer</strong> role. Promote them here at any time.
      </p>
    </div>
  );
}

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
  PieChart, CreditCard, GitBranch, Award, Zap, Layers, Settings2,
  ToggleRight, Building2,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useState, useMemo } from "react";
import type { Role, OrgRole } from "@shared/schema";
import { MONITORING_ITEMS, type MonitoringItemId, MGMT_CONFIGURABLE_FEATURES, ORG_ROLES, ORG_ROLE_RANK } from "@shared/schema";

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
  orgRole:   string | null;   // HOD|SVP|VP|Manager|TeamLead|KAM
  reportsTo: number | null;   // parent KAM id
  userId:    string | null;   // linked auth user id
  accounts: KamAccount[];
}

// Hierarchy node (from /api/org/hierarchy — includes nested children)
interface OrgNode extends Kam {
  children: OrgNode[];
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
function KamFormDialog({ onClose, editKam, allKams }: {
  onClose: () => void;
  editKam?: Kam;
  allKams?: Kam[];
}) {
  const qc = useQueryClient();
  const [name, setName]       = useState(editKam?.name  ?? '');
  const [email, setEmail]     = useState(editKam?.email ?? '');
  const [phone, setPhone]     = useState(editKam?.phone ?? '');
  const [title, setTitle]     = useState(editKam?.title ?? '');
  const [orgRole, setOrgRole] = useState<OrgRole>((editKam?.orgRole as OrgRole) ?? 'KAM');
  const [reportsTo, setReportsTo] = useState<string>(String(editKam?.reportsTo ?? ''));
  const [linkedUserId, setLinkedUserId] = useState<string>(editKam?.userId ?? '');
  const [err, setErr]         = useState('');

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

  // Fetch platform users so admin can link this KAM to a login account
  const { data: platformUsers = [] } = useQuery<TeamMember[]>({
    queryKey: ['/api/team'],
    staleTime: 120_000,
  });

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
      const payload = {
        name, email,
        phone:     phone          || null,
        title:     title          || null,
        orgRole,
        reportsTo: reportsTo      ? parseInt(reportsTo)   : null,
        userId:    linkedUserId   || null,
      };
      const res = editKam
        ? await apiRequest('PATCH', `/api/kam/${editKam.id}`, payload)
        : await apiRequest('POST',  '/api/kam',               payload);
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

          {/* ── Org Hierarchy ───────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block font-medium">Org Role *</label>
              <select
                data-testid="select-kam-org-role"
                value={orgRole}
                onChange={e => setOrgRole(e.target.value as OrgRole)}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500/50"
              >
                {ORG_ROLES.map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block font-medium">Reports To</label>
              <select
                data-testid="select-kam-reports-to"
                value={reportsTo}
                onChange={e => setReportsTo(e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500/50"
              >
                <option value="">— None (top level) —</option>
                {(allKams ?? [])
                  .filter(k => k.id !== editKam?.id)
                  .filter(k => ORG_ROLE_RANK[k.orgRole as OrgRole] > ORG_ROLE_RANK[orgRole])
                  .sort((a, b) => ORG_ROLE_RANK[b.orgRole as OrgRole] - ORG_ROLE_RANK[a.orgRole as OrgRole])
                  .map(k => (
                    <option key={k.id} value={String(k.id)}>
                      {k.name} ({k.orgRole ?? 'KAM'})
                    </option>
                  ))
                }
              </select>
            </div>
          </div>

          {/* ── Link Auth User ──────────────────────────────────────────────── */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5 font-medium">
              <LinkIcon className="w-3.5 h-3.5" />
              Link Login Account
              <span className="text-[10px] text-muted-foreground/50">(activates scope on login)</span>
            </label>
            <select
              data-testid="select-kam-user-link"
              value={linkedUserId}
              onChange={e => setLinkedUserId(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500/50"
            >
              <option value="">— No linked account —</option>
              {platformUsers.map(u => {
                const label = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || u.id;
                return <option key={u.id} value={u.id}>{label} ({u.email})</option>;
              })}
            </select>
            {linkedUserId && (
              <p className="text-[10px] text-muted-foreground/60 mt-1 flex items-center gap-1">
                <Check className="w-3 h-3 text-emerald-400" />
                When this user logs in, they will only see data within their org scope.
              </p>
            )}
          </div>

          {/* ── Assign Clients ───────────────────────────────────────────────── */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-muted-foreground flex items-center gap-1.5 font-medium">
                <LinkIcon className="w-3.5 h-3.5" />
                Assign Clients (Sippy Accounts)
                {selectedIds.size > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 bg-violet-500/20 text-violet-300 rounded-full text-[10px] font-semibold border border-violet-500/30">
                    {selectedIds.size} selected
                  </span>
                )}
              </label>
              {selectedIds.size > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedIds(new Set())}
                  className="text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                  data-testid="button-clear-accounts"
                >
                  Clear all
                </button>
              )}
            </div>

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
              <div className="border border-border/50 rounded-xl bg-muted/5 p-3 max-h-52 overflow-y-auto">
                <div className="flex flex-wrap gap-1.5">
                  {sippyAccounts.map(acct => {
                    const id      = String(acct.iAccount);
                    const checked = selectedIds.has(id);
                    return (
                      <button
                        key={id}
                        type="button"
                        data-testid={`chip-kam-acct-${id}`}
                        onClick={() => toggleAccount(id)}
                        title={acct.description ? `${acct.username} — ${acct.description} | $${acct.balance.toFixed(0)}` : `${acct.username} | $${acct.balance.toFixed(0)}`}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all ${
                          checked
                            ? 'bg-violet-500/20 border-violet-500/40 text-violet-300'
                            : acct.blocked
                              ? 'bg-muted/20 border-border/20 text-muted-foreground/30 line-through'
                              : 'bg-muted/20 border-border/30 text-muted-foreground/60 hover:border-violet-500/30 hover:text-violet-400'
                        }`}
                      >
                        {checked && <Check className="w-2.5 h-2.5 flex-shrink-0" strokeWidth={3} />}
                        <span className="truncate max-w-[140px]">{acct.username}</span>
                        {checked && (
                          <span className="text-[9px] text-violet-400/70 font-mono">${acct.balance.toFixed(0)}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
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
  live_summary:        Tv2,
  live_details:        List,
  live_quality:        Activity,
  call_history:        Phone,
  balance_monitor:     DollarSign,
  rate_cards:          CreditCard,
  cost_optimisation:   Zap,
  alerts:              Bell,
  traffic_map:         MapPin,
  server_monitoring:   Server,
  did_management:      MonitorDot,
  multi_switch:        Layers,
  test_call:           PhoneCall,
  call_flow_simulator: GitBranch,
  fraud_fas:           AlertTriangle,
  vendor_sla:          Award,
  graphs:              TrendingUp,
  bitseye:             Eye,
  analytics:           PieChart,
  lcr_analyser:        Route,
  cdr_viewer:          FileText,
  reports:             BarChart2,
  route_quality:       Activity,
};

const ITEM_COLOR: Record<MonitoringItemId, string> = {
  live_summary:        'text-violet-400',
  live_details:        'text-violet-400',
  live_quality:        'text-violet-400',
  call_history:        'text-violet-400',
  balance_monitor:     'text-emerald-400',
  rate_cards:          'text-emerald-400',
  cost_optimisation:   'text-lime-400',
  alerts:              'text-rose-400',
  traffic_map:         'text-cyan-400',
  server_monitoring:   'text-slate-400',
  did_management:      'text-amber-400',
  multi_switch:        'text-cyan-400',
  test_call:           'text-green-400',
  call_flow_simulator: 'text-sky-400',
  fraud_fas:           'text-orange-400',
  vendor_sla:          'text-yellow-400',
  graphs:              'text-indigo-400',
  bitseye:             'text-blue-400',
  analytics:           'text-purple-400',
  lcr_analyser:        'text-sky-400',
  cdr_viewer:          'text-teal-400',
  reports:             'text-blue-400',
  route_quality:       'text-blue-400',
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
    desc: "Full access to all pages, settings, team management, and controls what Management users can access.",
  },
  management: {
    label: "Management",
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
    iconColor: "text-amber-400",
    icon: Briefcase,
    desc: "Operational access to calls, analytics, reports and more. Admin defines which monitoring areas they are assigned.",
  },
  viewer: {
    label: "Viewer",
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/30",
    iconColor: "text-blue-400",
    icon: Eye,
    desc: "Dashboard and active calls always visible. Additional areas unlocked per monitoring assignment.",
  },
};

type AccessLevel = 'full' | 'configurable' | 'none';
type PermRow = { label: string; featureKey?: string; admin: AccessLevel; mgmt: AccessLevel | 'checkbox'; viewer: AccessLevel; note?: string };
type PermSection = { section: string };
type PermEntry = PermRow | PermSection;

const PERMISSIONS: PermEntry[] = [
  { section: 'Core' },
  { label: 'Dashboard',                 admin: 'full', mgmt: 'full', viewer: 'full'  },
  { label: 'Active Calls (live view)',   admin: 'full', mgmt: 'full', viewer: 'full'  },
  { label: 'Call Detail',               admin: 'full', mgmt: 'full', viewer: 'full'  },
  { label: 'Account Profile',           admin: 'full', mgmt: 'full', viewer: 'full'  },

  { section: 'Operations' },
  { label: 'Alerts',                    admin: 'full', mgmt: 'checkbox',  viewer: 'configurable', featureKey: 'alerts'             },
  { label: 'Server Monitoring',         admin: 'full', mgmt: 'checkbox',  viewer: 'configurable', featureKey: 'server_monitoring'  },
  { label: 'DID Management',            admin: 'full', mgmt: 'checkbox',  viewer: 'configurable', featureKey: 'did_management'     },
  { label: 'Test Call / Click-to-Call', admin: 'full', mgmt: 'checkbox',  viewer: 'none',         featureKey: 'test_call'          },
  { label: 'Traffic Map',               admin: 'full', mgmt: 'checkbox',  viewer: 'configurable', featureKey: 'traffic_map'        },
  { label: 'Multi-Switch View',         admin: 'full', mgmt: 'checkbox',  viewer: 'none',         featureKey: 'multi_switch'       },
  { label: 'Test Call Campaigns',       admin: 'full', mgmt: 'checkbox',  viewer: 'none',         featureKey: 'test_campaigns'     },

  { section: 'Routing' },
  { label: 'Approval Queue',            admin: 'full', mgmt: 'checkbox',  viewer: 'none',         featureKey: 'approval_queue'     },
  { label: 'LCR Analyser',              admin: 'full', mgmt: 'checkbox',  viewer: 'none',         featureKey: 'lcr_analyser'       },
  { label: 'Call Flow Simulator',       admin: 'full', mgmt: 'checkbox',  viewer: 'none',         featureKey: 'call_flow_simulator' },
  { label: 'Routing Manager',           admin: 'full', mgmt: 'checkbox',  viewer: 'none',         featureKey: 'routing_manager',   note: 'Covers Routing Groups, Destination Sets, QBR, Connection Map, On-Net Viewer & Policy Simulator' },
  { label: 'Routing Audit Trail',       admin: 'full', mgmt: 'checkbox',  viewer: 'none',         featureKey: 'routing_audit'      },
  { label: 'Prefix Coverage Checker',   admin: 'full', mgmt: 'checkbox',  viewer: 'none',         featureKey: 'tools'              },
  { label: 'Route Tester',              admin: 'full', mgmt: 'checkbox',  viewer: 'none',         featureKey: 'tools'              },
  { label: 'Translation Tester',        admin: 'full', mgmt: 'checkbox',  viewer: 'none',         featureKey: 'tools'              },

  { section: 'Analytics & Reports' },
  { label: 'Graphs',                    admin: 'full', mgmt: 'checkbox',  viewer: 'configurable', featureKey: 'graphs'             },
  { label: 'BitsEye Live Graphs',       admin: 'full', mgmt: 'checkbox',  viewer: 'configurable', featureKey: 'bitseye'            },
  { label: 'ASR / ACD Reports',         admin: 'full', mgmt: 'checkbox',  viewer: 'configurable', featureKey: 'reports'            },
  { label: 'CDR Viewer',                admin: 'full', mgmt: 'checkbox',  viewer: 'configurable', featureKey: 'cdr_viewer'         },
  { label: 'Revenue & Margin Analytics',admin: 'full', mgmt: 'checkbox',  viewer: 'none',         featureKey: 'analytics'          },
  { label: 'Route QoS Heatmap',         admin: 'full', mgmt: 'checkbox',  viewer: 'none',         featureKey: 'qos_heatmap'        },

  { section: 'Finance' },
  { label: 'Balance Monitor',           admin: 'full', mgmt: 'checkbox',  viewer: 'configurable', featureKey: 'balance_monitor'    },
  { label: 'Rate Card Management',      admin: 'full', mgmt: 'checkbox',  viewer: 'none',         featureKey: 'rate_cards'         },
  { label: 'Cost Optimisation Engine',  admin: 'full', mgmt: 'checkbox',  viewer: 'none',         featureKey: 'cost_optimisation'  },
  { label: 'Billing Dispute Tracker',   admin: 'full', mgmt: 'checkbox',  viewer: 'none',         featureKey: 'billing_disputes'   },

  { section: 'Security & Fraud' },
  { label: 'FAS / Fraud Detection',     admin: 'full', mgmt: 'checkbox',  viewer: 'configurable', featureKey: 'fraud_fas'          },
  { label: 'Vendor SLA Scorecard',      admin: 'full', mgmt: 'checkbox',  viewer: 'none',         featureKey: 'vendor_sla'         },
  { label: 'SLA Breach Log',            admin: 'full', mgmt: 'checkbox',  viewer: 'none',         featureKey: 'sla_breaches'       },
  { label: 'Firewall Manager',          admin: 'full', mgmt: 'checkbox',  viewer: 'none',         featureKey: 'firewall'           },

  { section: 'Client & Vendor' },
  { label: 'Client & Vendor Profiles',  admin: 'full', mgmt: 'checkbox',  viewer: 'none',         featureKey: 'clients'            },
  { label: 'Vendor Connections',        admin: 'full', mgmt: 'checkbox',  viewer: 'none',         featureKey: 'vendor_connections' },
  { label: 'Product Classification',    admin: 'full', mgmt: 'checkbox',  viewer: 'none',         featureKey: 'products'           },
  { label: 'Tools / Calculators',       admin: 'full', mgmt: 'checkbox',  viewer: 'none',         featureKey: 'tools'              },
  { label: 'KAM Management',            admin: 'full', mgmt: 'none',      viewer: 'none'                                           },

  { section: 'Administration' },
  { label: 'Settings',                  admin: 'full', mgmt: 'none', viewer: 'none'  },
  { label: 'Team Management',           admin: 'full', mgmt: 'none', viewer: 'none'  },
  { label: 'Approval Settings',         admin: 'full', mgmt: 'none', viewer: 'none'  },
  { label: 'Define Management Access',  admin: 'full', mgmt: 'none', viewer: 'none', note: 'Admin assigns which monitoring areas each Management user is responsible for' },
  { label: 'WhatsApp Push Alerts',      admin: 'full', mgmt: 'none', viewer: 'none'  },
  { label: 'API Keys',                  admin: 'full', mgmt: 'none', viewer: 'none'  },
];

// Descriptions and icons for each configurable management feature
const MGMT_FEATURE_META: Record<string, { desc: string; icon: React.ComponentType<{ className?: string }> }> = {
  // Monitoring
  alerts:              { desc: 'Real-time threshold breach and traffic anomaly notifications',   icon: Bell         },
  server_monitoring:   { desc: 'SNMP-based switch health and performance metrics',              icon: Server       },
  // Operations
  did_management:      { desc: 'Manage and assign DID numbers to accounts',                     icon: Phone        },
  test_call:           { desc: 'Place live test calls and measure RTP quality in real time',    icon: PhoneCall    },
  traffic_map:         { desc: 'Live geographic visualisation of call routing',                 icon: MapPin       },
  multi_switch:        { desc: 'Monitor and compare multiple softswitch instances',             icon: Layers       },
  test_campaigns:      { desc: 'Create and schedule automated test call campaigns',             icon: Activity     },
  // Routing
  routing_manager:     { desc: 'Routing groups, destination sets, connections and coverage map',icon: GitBranch    },
  approval_queue:      { desc: 'View and action pending change requests requiring approval',    icon: ShieldAlert  },
  call_flow_simulator: { desc: 'Simulate and trace SIP call flows for debugging',               icon: GitBranch    },
  lcr_analyser:        { desc: 'Least-cost routing analysis and route comparison',              icon: Route        },
  routing_audit:       { desc: 'Audit log of all routing changes with before/after state',      icon: FileText     },
  // Analytics & Reports
  graphs:              { desc: 'Traffic and quality trend charts by hour, day or week',         icon: BarChart2    },
  bitseye:             { desc: 'BitsEye drill-down live call metrics broken down by account',   icon: Activity     },
  reports:             { desc: 'ASR, ACD and route quality performance reports',                icon: FileText     },
  cdr_viewer:          { desc: 'Browse, filter and export full call detail records',            icon: List         },
  analytics:           { desc: 'Revenue, margin and profitability analytics by client/vendor',  icon: PieChart     },
  qos_heatmap:         { desc: 'Visual heatmap of route quality scored by ASR, ACD and PDD',   icon: BarChart2    },
  // Finance
  balance_monitor:     { desc: 'Live account balance tracking with low-balance alerts',         icon: DollarSign   },
  rate_cards:          { desc: 'Create, edit and manage client and vendor rate cards',          icon: CreditCard   },
  cost_optimisation:   { desc: 'AI-assisted cost reduction and optimisation recommendations',   icon: Zap          },
  billing_disputes:    { desc: 'Log, track and resolve billing disputes with carriers',         icon: FileText     },
  // Security & Fraud
  fraud_fas:           { desc: 'Detect FAS, IRSF and suspicious call patterns in real time',   icon: ShieldAlert  },
  vendor_sla:          { desc: 'Track and enforce vendor service-level agreements',             icon: Award        },
  sla_breaches:        { desc: 'Log and review SLA breach incidents and their resolutions',     icon: Bell         },
  firewall:            { desc: 'Manage IP allowlists, blocklists and firewall rules',           icon: Shield       },
  // Client & Vendor
  clients:             { desc: 'View and manage client and vendor account profiles',            icon: Users        },
  vendor_connections:  { desc: 'Create and manage vendor trunk connections and parameters',     icon: Server       },
  tools:               { desc: 'Rate calculators, prefix tools and connectivity tests',         icon: Tv2          },
  products:            { desc: 'Classify and manage product types and service categories',      icon: Layers       },
};

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

// ─── Watcher Recipients Section ───────────────────────────────────────────────

interface WatcherRecipient {
  id: number;
  email: string;
  displayName: string | null;
  userId: string | null;
  active: boolean;
  createdAt: string;
}

function WatcherRecipientsSection() {
  const qc = useQueryClient();
  const [addEmail, setAddEmail] = useState('');
  const [addName, setAddName] = useState('');

  const { data: recipients = [], isLoading } = useQuery<WatcherRecipient[]>({
    queryKey: ['/api/watcher-recipients'],
  });

  const addMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/watcher-recipients', { email: addEmail.trim(), displayName: addName.trim() || null });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/watcher-recipients'] });
      setAddEmail(''); setAddName('');
    },
  });

  const toggleMut = useMutation({
    mutationFn: async ({ id, active }: { id: number; active: boolean }) => {
      const res = await apiRequest('PATCH', `/api/watcher-recipients/${id}`, { active });
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/api/watcher-recipients'] }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest('DELETE', `/api/watcher-recipients/${id}`, {});
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/api/watcher-recipients'] }),
  });

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-border/50 bg-muted/20 flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <Bell className="h-4 w-4 text-cyan-400" />
            Sippy Watcher Alert Recipients
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            These email addresses receive all Sippy change-detection alerts
          </p>
        </div>
        <span className="text-xs bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 px-2.5 py-1 rounded-full font-medium">
          {recipients.filter(r => r.active).length} active
        </span>
      </div>
      <div className="p-5 space-y-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm py-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading recipients…
          </div>
        ) : recipients.length === 0 ? (
          <div className="text-sm text-muted-foreground/60 italic py-2 text-center">
            No alert recipients configured yet. Add one below.
          </div>
        ) : (
          <div className="space-y-2">
            {recipients.map(r => (
              <div key={r.id}
                data-testid={`row-team-recipient-${r.id}`}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg border transition-all ${r.active ? 'border-cyan-500/20 bg-cyan-500/5' : 'border-border bg-muted/10 opacity-60'}`}>
                <div className="h-8 w-8 rounded-full flex items-center justify-center bg-cyan-500/10 flex-shrink-0">
                  <Mail className="h-4 w-4 text-cyan-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{r.displayName || r.email}</p>
                  {r.displayName && <p className="text-xs text-muted-foreground font-mono truncate">{r.email}</p>}
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full border font-medium flex-shrink-0 ${r.active ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-muted border-border text-muted-foreground'}`}>
                  {r.active ? 'Active' : 'Paused'}
                </span>
                <button
                  type="button"
                  data-testid={`btn-team-toggle-${r.id}`}
                  onClick={() => toggleMut.mutate({ id: r.id, active: !r.active })}
                  disabled={toggleMut.isPending}
                  className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                >
                  {r.active ? 'Pause' : 'Enable'}
                </button>
                <button
                  type="button"
                  data-testid={`btn-team-delete-${r.id}`}
                  onClick={() => deleteMut.mutate(r.id)}
                  disabled={deleteMut.isPending}
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Add recipient form */}
        <div className="flex gap-2 pt-1">
          <input
            type="text"
            data-testid="input-team-recipient-name"
            placeholder="Display name"
            value={addName}
            onChange={e => setAddName(e.target.value)}
            className="w-40 px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/30"
          />
          <input
            type="email"
            data-testid="input-team-recipient-email"
            placeholder="Email address"
            value={addEmail}
            onChange={e => setAddEmail(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && addEmail.trim()) addMut.mutate(); }}
            className="flex-1 px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/30"
          />
          <button
            type="button"
            data-testid="btn-team-add-recipient"
            onClick={() => addMut.mutate()}
            disabled={addMut.isPending || !addEmail.trim()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/25 disabled:opacity-50 transition-colors"
          >
            {addMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
            Add Recipient
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          You can also manage these recipients in <Link href="/settings?section=watcher" className="text-cyan-400 hover:underline">Settings → Sippy Watcher</Link>.
        </p>
      </div>
    </div>
  );
}

// ─── Org Hierarchy Tree ───────────────────────────────────────────────────────

const ORG_ROLE_COLORS: Record<string, string> = {
  HOD:      'bg-amber-500/20 text-amber-300 border-amber-500/30',
  SVP:      'bg-violet-500/20 text-violet-300 border-violet-500/30',
  VP:       'bg-blue-500/20 text-blue-300 border-blue-500/30',
  Manager:  'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  TeamLead: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  KAM:      'bg-rose-500/20 text-rose-300 border-rose-500/30',
};

function OrgTreeNode({ node, depth = 0, onEdit }: { node: OrgNode; depth?: number; onEdit: (k: Kam) => void }) {
  const [open, setOpen] = useState(true);
  const hasChildren = node.children.length > 0;
  const roleColor   = ORG_ROLE_COLORS[node.orgRole ?? 'KAM'] ?? ORG_ROLE_COLORS['KAM'];

  return (
    <div>
      <div
        className={`flex items-center gap-2.5 py-2.5 px-3 rounded-xl transition-colors hover:bg-muted/30 cursor-default ${depth === 0 ? 'mt-1' : ''}`}
        style={{ marginLeft: depth * 28 }}
      >
        {/* Expand toggle */}
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className={`w-5 h-5 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors ${!hasChildren ? 'opacity-0 pointer-events-none' : ''}`}
        >
          <ChevronRight className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-90' : ''}`} />
        </button>

        {/* Avatar */}
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500/40 to-purple-600/40 flex items-center justify-center flex-shrink-0 border border-violet-500/20 text-sm font-bold text-white">
          {node.name.charAt(0).toUpperCase()}
        </div>

        {/* Name + role */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm truncate">{node.name}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-semibold ${roleColor}`}>
              {node.orgRole ?? 'KAM'}
            </span>
          </div>
          <div className="text-xs text-muted-foreground truncate">{node.email}</div>
        </div>

        {/* Client count */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="text-right">
            <div className="text-xs font-semibold text-foreground">{node.accounts.length}</div>
            <div className="text-[10px] text-muted-foreground">clients</div>
          </div>
          {/* Edit button */}
          <button
            type="button"
            data-testid={`btn-edit-org-node-${node.id}`}
            onClick={() => onEdit(node)}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-violet-400 hover:bg-violet-500/10 transition-colors"
          >
            <Edit2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Children */}
      {hasChildren && open && (
        <div className="relative">
          <div
            className="absolute top-0 bottom-0 border-l border-dashed border-border/50"
            style={{ left: depth * 28 + 22 }}
          />
          {node.children.map(child => (
            <OrgTreeNode key={child.id} node={child} depth={depth + 1} onEdit={onEdit} />
          ))}
        </div>
      )}
    </div>
  );
}

function OrgHierarchySection({ onEdit }: { onEdit: (k: Kam) => void }) {
  const { data: roots = [], isLoading } = useQuery<OrgNode[]>({
    queryKey: ['/api/org/hierarchy'],
    staleTime: 30_000,
  });

  const totalMembers = useMemo(() => {
    function count(nodes: OrgNode[]): number {
      return nodes.reduce((s, n) => s + 1 + count(n.children), 0);
    }
    return count(roots);
  }, [roots]);

  return (
    <div className="mb-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <GitBranch className="w-5 h-5 text-violet-400" />
            Organisational Hierarchy
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Role-based access tree — each level sees their scope and below.
          </p>
        </div>
        {totalMembers > 0 && (
          <div className="flex items-center gap-2">
            {Object.entries(ORG_ROLE_COLORS).map(([role, cls]) => (
              <span key={role} className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${cls}`}>
                {role}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="bg-card border border-border rounded-2xl p-4">
        {isLoading ? (
          <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading hierarchy…
          </div>
        ) : roots.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground text-sm">
            <GitBranch className="w-8 h-8 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No hierarchy configured yet.</p>
            <p className="text-xs mt-1">Add team members in the KAM section below, then set their Org Role and Reports To fields.</p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {roots.map(node => (
              <OrgTreeNode key={node.id} node={node} onEdit={onEdit} />
            ))}
          </div>
        )}
      </div>
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
  const [activeTab, setActiveTab] = useState<'members'|'role-assign'|'monitoring'|'kam'|'org'|'alerts'|'access'>('members');

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

  // Settings — for mgmt feature permissions (admin only)
  const { data: settingsData } = useQuery<{ mgmtFeaturePermissions?: string | null }>({
    queryKey: ['/api/settings'],
    enabled: isAdmin,
    staleTime: 30_000,
  });

  const mgmtEnabled = useMemo<Set<string>>(() => {
    if (!settingsData?.mgmtFeaturePermissions) return new Set<string>();
    try { return new Set(JSON.parse(settingsData.mgmtFeaturePermissions)); }
    catch { return new Set<string>(); }
  }, [settingsData]);

  const mgmtPermsMutation = useMutation({
    mutationFn: (enabledFeatures: string[]) =>
      apiRequest('PATCH', '/api/settings', { mgmtFeaturePermissions: JSON.stringify(enabledFeatures) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/settings'] });
      queryClient.invalidateQueries({ queryKey: ['/api/settings/mgmt-permissions'] });
    },
  });

  function toggleMgmtFeature(key: string) {
    const next = new Set(mgmtEnabled);
    if (next.has(key)) next.delete(key); else next.add(key);
    mgmtPermsMutation.mutate(Array.from(next));
  }

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

      {/* ── Tab Navigation ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 bg-muted/20 border border-border/50 rounded-xl p-1 overflow-x-auto" data-testid="team-tab-nav">
        {([
          { id: 'members',     label: 'Team Members',    icon: Users,       badge: stats.total    || undefined },
          { id: 'role-assign', label: 'Role Assignment', icon: UserCog,     badge: undefined                  },
          { id: 'monitoring',  label: 'Monitoring',      icon: MonitorDot,  badge: undefined                  },
          { id: 'kam',         label: 'KAM & Accounts',  icon: UserCheck,   badge: kams.length    || undefined },
          { id: 'org',         label: 'Org Hierarchy',   icon: Building2,   badge: undefined                  },
          { id: 'alerts',      label: 'Traffic Alerts',  icon: Bell,        badge: openAlerts.length || undefined },
          { id: 'access',      label: 'Access Control',  icon: ToggleRight, badge: undefined                  },
        ] as const).map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              data-testid={`tab-team-${tab.id}`}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all flex-shrink-0 ${
                isActive
                  ? 'bg-background text-foreground shadow-sm border border-border/50'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-violet-400' : ''}`} />
              {tab.label}
              {tab.badge != null && tab.badge > 0 && (
                <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-semibold ${
                  tab.id === 'alerts'
                    ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                    : 'bg-violet-500/15 text-violet-400 border border-violet-500/30'
                }`}>
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ══ Members Tab ════════════════════════════════════════════════════════ */}
      {activeTab === 'members' && (
      <div className="space-y-6">

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

      </div>)}{/* ══ end Members Tab ═══════════════════════════════════════════════════════ */}

      {/* ══ Role Assignment Tab ═════════════════════════════════════════════════ */}
      {activeTab === 'role-assign' && (
      <div className="space-y-6">

        {/* Stat strip */}
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

        {/* Quick Assign by Email */}
        <div className="bg-card border border-violet-500/20 rounded-xl overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-4 border-b border-border/50 bg-violet-500/5">
            <UserCog className="w-4 h-4 text-violet-400" />
            <div>
              <h3 className="font-semibold text-sm">Assign Role by Email</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Type a member's email address to instantly update their role</p>
            </div>
          </div>
          <div className="p-5 space-y-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <input
                  data-testid="input-role-assign-email"
                  type="email"
                  placeholder="member@example.com"
                  value={assignEmail}
                  onChange={e => { setAssignEmail(e.target.value); setAssignResult(null); }}
                  className="w-full pl-9 pr-4 py-2.5 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500/50 transition-all"
                />
              </div>
              <div className="relative">
                <select
                  data-testid="select-role-assign-role"
                  value={assignRole}
                  onChange={e => setAssignRole(e.target.value as Role)}
                  className="appearance-none bg-background border border-border rounded-lg pl-3 pr-8 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500/50 transition-all cursor-pointer h-full"
                >
                  {(['super_admin','admin','noc_operator','team_lead','management','viewer'] as Role[]).map(r => (
                    <option key={r} value={r}>{ROLE_META[r]?.label ?? r}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              </div>
              <button
                data-testid="button-role-assign-submit"
                onClick={() => assignMutation.mutate()}
                disabled={assignMutation.isPending || !assignEmail.trim()}
                className="flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-500 active:scale-95 transition-all disabled:opacity-50 whitespace-nowrap"
              >
                {assignMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserCheck className="w-4 h-4" />}
                Assign Role
              </button>
            </div>
            {assignResult && (
              <div className={`flex items-center gap-2.5 rounded-lg px-4 py-3 text-sm border ${
                assignResult.ok
                  ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-400'
                  : 'bg-rose-500/5 border-rose-500/20 text-rose-400'
              }`}>
                {assignResult.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <XCircle className="w-4 h-4 shrink-0" />}
                {assignResult.msg}
              </div>
            )}
          </div>
        </div>

        {/* Role matrix: description of each role */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-4 border-b border-border/50 bg-muted/20">
            <Shield className="w-4 h-4 text-muted-foreground" />
            <div>
              <h3 className="font-semibold text-sm">Role Reference</h3>
              <p className="text-xs text-muted-foreground mt-0.5">What each role can access</p>
            </div>
          </div>
          <div className="divide-y divide-border/30">
            {([
              { role: 'super_admin', perms: ['Full system access', 'Manage all settings', 'Approve/reject all operations', 'User & role management'] },
              { role: 'admin',       perms: ['All admin functions', 'User & role management', 'Approve operations', 'Configure system settings'] },
              { role: 'noc_operator',perms: ['View live NOC dashboard', 'Submit change requests', 'Acknowledge alerts', 'View call reports'] },
              { role: 'team_lead',   perms: ['View team dashboards', 'Submit change requests', 'Manage KAM assignments', 'View reports'] },
              { role: 'management',  perms: ['Analytics & P&L views', 'Billing dashboards', 'Rate card access', 'High-level traffic data'] },
              { role: 'viewer',      perms: ['Read-only dashboard access', 'View call stats', 'No changes or requests'] },
            ] as const).map(({ role, perms }) => {
              const meta = ROLE_META[role as Role];
              if (!meta) return null;
              return (
                <div key={role} className="flex items-start gap-4 px-5 py-4" data-testid={`role-ref-row-${role}`}>
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-full border shrink-0 ${meta.color} border-current/20`}>
                    {meta.label}
                  </span>
                  <div className="flex flex-wrap gap-1.5 items-center">
                    {perms.map(p => (
                      <span key={p} className="text-xs text-muted-foreground bg-muted/30 rounded-full px-2.5 py-0.5 border border-border/30">
                        {p}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Member table with inline role change */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-border/50 bg-muted/20">
            <div className="flex items-center gap-3">
              <Users className="w-4 h-4 text-muted-foreground" />
              <div>
                <h3 className="font-semibold text-sm">All Members</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Change any member's role inline</p>
              </div>
            </div>
          </div>
          {isLoading ? (
            <div className="flex items-center justify-center py-10 gap-2 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /><span className="text-sm">Loading members…</span>
            </div>
          ) : (
            <div className="divide-y divide-border/30">
              {members.map((member) => {
                const meta = ROLE_META[member.role as Role];
                return (
                  <div key={member.id} className="flex items-center gap-4 px-5 py-3 hover:bg-muted/5 transition-colors" data-testid={`role-member-row-${member.id}`}>
                    <div className="w-8 h-8 rounded-full bg-muted/40 border border-border/50 flex items-center justify-center shrink-0">
                      {member.profileImageUrl ? (
                        <img src={member.profileImageUrl} className="w-full h-full rounded-full object-cover" alt="" />
                      ) : (
                        <span className="text-xs font-bold text-muted-foreground">
                          {(member.firstName?.[0] ?? member.email?.[0] ?? '?').toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {member.firstName && member.lastName ? `${member.firstName} ${member.lastName}` : member.email ?? member.id}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">{member.email}</p>
                    </div>
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border shrink-0 hidden sm:block ${meta?.color ?? ''} border-current/20`}>
                      {meta?.label ?? member.role}
                    </span>
                    <RoleSelector memberId={member.id} currentRole={member.role} selfId={user?.id ?? ''} />
                  </div>
                );
              })}
              {members.length === 0 && (
                <div className="py-10 text-center text-sm text-muted-foreground">No team members found</div>
              )}
            </div>
          )}
        </div>

      </div>)}{/* ══ end Role Assignment Tab ═══════════════════════════════════════════════ */}

      {/* ══ Monitoring Tab ══════════════════════════════════════════════════════ */}
      {activeTab === 'monitoring' && (
      <div className="space-y-6">

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
            <p className="text-xs text-muted-foreground mt-0.5">
              Who is watching each area — covering all {MONITORING_ITEMS.length} monitoring areas including Live Calls, Analytics, Finance, Operations, Security, and Reports
            </p>
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

      </div>)}{/* ══ end Monitoring Tab ═════════════════════════════════════════════════ */}

      {/* ── KAM Dialog (always mounted outside tabs) ─────────────────────── */}
      {(showKamDialog || editKam) && (
        <KamFormDialog
          editKam={editKam}
          allKams={kams}
          onClose={() => { setShowKamDialog(false); setEditKam(undefined); }}
        />
      )}

      {/* ══ Org Hierarchy Tab ══════════════════════════════════════════════════ */}
      {activeTab === 'org' && (
        <OrgHierarchySection onEdit={k => { setEditKam(k); setActiveTab('kam'); }} />
      )}

      {/* ══ KAM Tab ════════════════════════════════════════════════════════════ */}
      {activeTab === 'kam' && (
      <div className="space-y-6">

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

      </div>)}{/* ══ end KAM Tab ═══════════════════════════════════════════════════════════ */}

      {/* ══ Alerts Tab ═════════════════════════════════════════════════════════ */}
      {activeTab === 'alerts' && (
      <div className="space-y-6">

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

      {/* Watcher Alert Members */}
      <WatcherRecipientsSection />

      </div>)}{/* ══ end Alerts Tab ═════════════════════════════════════════════════════ */}

      {/* ══ Access Control Tab ══════════════════════════════════════════════════ */}
      {activeTab === 'access' && (
      <div className="space-y-6">

      {/* Management Feature Access Controls */}
      {isAdmin && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-border/50 bg-amber-500/5 flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <ToggleRight className="w-4 h-4 text-amber-400" />
                <h3 className="font-semibold text-sm">Management Feature Access</h3>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 max-w-xl">
                Toggle which optional pages are accessible to the <span className="text-amber-400 font-medium">Management</span> role.
                Admins retain access regardless. Changes take effect immediately.
              </p>
            </div>
            <span className="text-xs text-muted-foreground bg-muted/40 border border-border/40 rounded-full px-2.5 py-0.5 whitespace-nowrap flex-shrink-0 mt-0.5">
              {mgmtEnabled.size} / {MGMT_CONFIGURABLE_FEATURES.length} enabled
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2">
            {MGMT_CONFIGURABLE_FEATURES.map((feat, idx) => {
              const meta = MGMT_FEATURE_META[feat.key];
              const Icon = meta?.icon ?? ToggleRight;
              const enabled = mgmtEnabled.has(feat.key);
              const total = MGMT_CONFIGURABLE_FEATURES.length;
              const isBottomRow = idx >= total - (total % 2 === 0 ? 2 : 1);
              return (
                <div
                  key={feat.key}
                  className={`flex items-center gap-3 px-5 py-4 transition-colors hover:bg-muted/5 border-border/20 ${
                    !isBottomRow ? 'border-b' : ''
                  } ${idx % 2 === 0 ? 'sm:border-r' : ''}`}
                  data-testid={`mgmt-access-row-${feat.key}`}
                >
                  <span className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                    enabled ? 'bg-amber-500/15 text-amber-400' : 'bg-muted/30 text-muted-foreground/40'
                  }`}>
                    <Icon className="w-4 h-4" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm leading-snug">{feat.label}</div>
                    <div className="text-xs text-muted-foreground leading-snug mt-0.5 truncate" title={meta?.desc}>{meta?.desc}</div>
                  </div>
                  <Switch
                    data-testid={`mgmt-access-switch-${feat.key}`}
                    checked={enabled}
                    onCheckedChange={() => toggleMgmtFeature(feat.key)}
                    disabled={mgmtPermsMutation.isPending}
                    className="flex-shrink-0 data-[state=checked]:bg-amber-500"
                  />
                </div>
              );
            })}
          </div>
          <div className="px-5 py-2.5 bg-muted/10 border-t border-border/30">
            <p className="text-[11px] text-muted-foreground/60">
              Viewer role is not affected by these toggles — use Monitoring Assignments for viewer access control.
            </p>
          </div>
        </div>
      )}

      {/* Permissions Matrix */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-border/50 bg-muted/20">
          <h3 className="font-semibold text-sm">Permissions Matrix</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Full access includes all pages. Admins define which areas Management users are assigned to monitor.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50 bg-muted/10">
                <th className="text-left px-5 py-3 text-muted-foreground font-medium text-xs uppercase tracking-wide w-1/2">Page / Feature</th>
                <th className="text-center px-4 py-3 text-xs uppercase tracking-wide w-[16%]">
                  <span className="inline-flex items-center gap-1.5 text-rose-400 font-semibold"><Crown className="w-3.5 h-3.5" />Admin</span>
                </th>
                <th className="text-center px-4 py-3 text-xs uppercase tracking-wide w-[16%]">
                  <span className="inline-flex items-center gap-1.5 text-amber-400 font-semibold"><Briefcase className="w-3.5 h-3.5" />Mgmt</span>
                </th>
                <th className="text-center px-4 py-3 text-xs uppercase tracking-wide w-[16%]">
                  <span className="inline-flex items-center gap-1.5 text-blue-400 font-semibold"><Eye className="w-3.5 h-3.5" />Viewer</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {PERMISSIONS.map((entry, i) => {
                if ('section' in entry) {
                  return (
                    <tr key={entry.section}>
                      <td colSpan={4} className="px-5 py-2 bg-muted/30 border-y border-border/30">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{entry.section}</span>
                      </td>
                    </tr>
                  );
                }
                const row = entry as PermRow;
                const { label, admin, mgmt, viewer, note, featureKey } = row;
                const renderCell = (level: AccessLevel) => {
                  if (level === 'full') return <CheckCircle2 className="w-4 h-4 text-emerald-400 mx-auto" />;
                  if (level === 'configurable') return (
                    <div className="flex items-center justify-center" title="Viewer access if assigned by Admin">
                      <Settings2 className="w-3.5 h-3.5 text-amber-400" />
                    </div>
                  );
                  return <span className="block w-4 h-0.5 bg-muted-foreground/15 mx-auto rounded-full" />;
                };
                const renderMgmtCell = () => {
                  if (mgmt === 'checkbox' && featureKey) {
                    const checked = mgmtEnabled.has(featureKey);
                    return (
                      <button
                        data-testid={`mgmt-feature-toggle-${featureKey}`}
                        onClick={() => toggleMgmtFeature(featureKey)}
                        disabled={mgmtPermsMutation.isPending}
                        title={checked ? 'Management has access — click to revoke' : 'Management has no access — click to grant'}
                        className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all mx-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 ${
                          checked
                            ? 'bg-amber-500/20 border-amber-500/60 text-amber-400 hover:bg-amber-500/30'
                            : 'bg-transparent border-border/50 text-transparent hover:border-amber-500/30 hover:bg-amber-500/5'
                        } ${mgmtPermsMutation.isPending ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                      >
                        {checked && <Check className="w-3 h-3" />}
                      </button>
                    );
                  }
                  return renderCell(mgmt as AccessLevel);
                };
                return (
                  <tr key={label} className={`border-b border-border/20 last:border-0 ${i % 2 === 0 ? '' : 'bg-muted/5'}`}>
                    <td className="px-5 py-2.5">
                      <span className="font-medium text-sm">{label}</span>
                      {note && <p className="text-[10px] text-muted-foreground/60 mt-0.5 leading-relaxed">{note}</p>}
                    </td>
                    <td className="text-center px-4 py-2.5">{renderCell(admin)}</td>
                    <td className="text-center px-4 py-2.5">{renderMgmtCell()}</td>
                    <td className="text-center px-4 py-2.5">{renderCell(viewer)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {/* Legend */}
        <div className="px-5 py-3 border-t border-border/30 bg-muted/10 flex flex-wrap gap-4">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
            Always accessible
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Settings2 className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
            Viewer access if assigned by Admin
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="w-3.5 h-3.5 rounded border-2 border-amber-500/60 bg-amber-500/20 flex items-center justify-center flex-shrink-0">
              <Check className="w-2.5 h-2.5 text-amber-400" />
            </span>
            Admin-controlled — click to grant or revoke Management access
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="w-3.5 h-0.5 bg-muted-foreground/30 rounded-full flex-shrink-0" />
            No access
          </div>
        </div>
      </div>

      </div>)}{/* ══ end Access Control Tab ══════════════════════════════════════════════ */}

    </div>
  );
}

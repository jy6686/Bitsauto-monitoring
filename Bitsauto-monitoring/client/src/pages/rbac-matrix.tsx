import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Shield, ShieldAlert, Check, X, ChevronDown, ChevronRight,
  Users, Settings, AlertTriangle, Eye, Search, RefreshCw,
  Lock, Unlock, History, Info, Zap, ArrowUpDown,
} from "lucide-react";
import { PERM_DOMAINS, RISK_CONFIG, PLATFORM_ROLES, SCOPES } from "@shared/permissions";

// ── Types ─────────────────────────────────────────────────────────────────────
interface RbacPermission {
  id: number;
  key: string;
  domain: string;
  label: string;
  description: string | null;
  riskLevel: string;
}

interface RbacRolePermission {
  id: number;
  role: string;
  permissionKey: string;
  granted: boolean;
}

interface RbacOverride {
  id: number;
  userId: string;
  permissionKey: string;
  granted: boolean;
  scope: string;
  reason: string | null;
  grantedBy: string;
  grantedAt: string;
  expiresAt: string | null;
}

interface AuditEvent {
  id: number;
  eventType: string;
  actorId: string;
  targetUserId: string | null;
  targetRole: string | null;
  permissionKey: string | null;
  beforeValue: any;
  afterValue: any;
  ipAddress: string | null;
  createdAt: string;
}

// ── Domain color map ──────────────────────────────────────────────────────────
const DOMAIN_COLORS: Record<string, string> = {
  finance:    "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  noc:        "text-blue-400 bg-blue-500/10 border-blue-500/20",
  governance: "text-indigo-400 bg-indigo-500/10 border-indigo-500/20",
  kam:        "text-purple-400 bg-purple-500/10 border-purple-500/20",
  operations: "text-slate-400 bg-slate-500/10 border-slate-500/20",
};

const ROLE_COLORS: Record<string, string> = {
  super_admin:          "text-rose-300",
  admin:                "text-orange-300",
  management:           "text-amber-300",
  destination_manager:  "text-yellow-300",
  routing_admin:        "text-lime-300",
  noc_operator:         "text-blue-300",
  team_lead:            "text-cyan-300",
  viewer:               "text-slate-400",
};

// ── Main page ─────────────────────────────────────────────────────────────────
export default function RbacMatrixPage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab]       = useState<'matrix' | 'overrides' | 'audit'>('matrix');
  const [openDomain, setOpenDomain]     = useState<string | null>(null);
  const [searchQ, setSearchQ]           = useState('');
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [riskFilter, setRiskFilter]     = useState<string | null>(null);

  const { data: permissions = [], isLoading: permsLoading, refetch } = useQuery<RbacPermission[]>({
    queryKey: ['/api/rbac/permissions'],
    staleTime: 30_000,
  });

  const { data: rolePerms = [], isLoading: rolePermsLoading } = useQuery<RbacRolePermission[]>({
    queryKey: ['/api/rbac/role-permissions'],
    staleTime: 30_000,
  });

  const { data: overrides = [] } = useQuery<RbacOverride[]>({
    queryKey: ['/api/rbac/overrides'],
    staleTime: 30_000,
  });

  const { data: auditLog = [] } = useQuery<AuditEvent[]>({
    queryKey: ['/api/rbac/audit'],
    staleTime: 30_000,
    enabled: activeTab === 'audit',
  });

  const togglePermMut = useMutation({
    mutationFn: ({ role, permissionKey, granted }: { role: string; permissionKey: string; granted: boolean }) =>
      apiRequest('PUT', '/api/rbac/role-permissions', { role, permissionKey, granted }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/rbac/role-permissions'] });
      queryClient.invalidateQueries({ queryKey: ['/api/rbac/audit'] });
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const deleteOverrideMut = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/rbac/overrides/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/rbac/overrides'] });
      queryClient.invalidateQueries({ queryKey: ['/api/rbac/audit'] });
      toast({ title: 'Override removed' });
    },
  });

  // Build lookup: role+key → granted
  const rolePermMap = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const rp of rolePerms) m.set(`${rp.role}:${rp.permissionKey}`, rp.granted);
    return m;
  }, [rolePerms]);

  // Group permissions by domain
  const byDomain = useMemo(() => {
    const filtered = permissions.filter(p => {
      const matchSearch = !searchQ || p.key.includes(searchQ) || p.label.toLowerCase().includes(searchQ.toLowerCase());
      const matchRisk   = !riskFilter || p.riskLevel === riskFilter;
      return matchSearch && matchRisk;
    });
    const groups: Record<string, RbacPermission[]> = {};
    for (const p of filtered) {
      if (!groups[p.domain]) groups[p.domain] = [];
      groups[p.domain].push(p);
    }
    return groups;
  }, [permissions, searchQ, riskFilter]);

  const displayRoles = selectedRole
    ? PLATFORM_ROLES.filter(r => r === selectedRole)
    : PLATFORM_ROLES;

  const isLoading = permsLoading || rolePermsLoading;

  const totalPerms = permissions.length;
  const criticalPerms = permissions.filter(p => p.riskLevel === 'critical').length;

  return (
    <div className="flex flex-col h-full min-h-0">

      {/* Header */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-white/[0.06]">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-rose-500/10 border border-rose-500/20">
              <Shield className="h-4 w-4 text-rose-400" />
            </div>
            <div>
              <h1 className="text-base font-semibold text-foreground">RBAC Permission Matrix</h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                {totalPerms} permissions · {criticalPerms} critical · {PLATFORM_ROLES.length} roles
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => refetch()}
              data-testid="button-refresh-rbac"
              className="p-1.5 rounded-lg text-muted-foreground/50 hover:text-foreground hover:bg-white/[0.05] transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-4">
          {[
            { key: 'matrix',    label: 'Permission Matrix', icon: ArrowUpDown },
            { key: 'overrides', label: 'User Overrides',    icon: Users       },
            { key: 'audit',     label: 'Audit Log',         icon: History     },
          ].map(tab => {
            const I = tab.icon;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as any)}
                data-testid={`tab-${tab.key}`}
                className={cn(
                  "flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium transition-colors",
                  activeTab === tab.key
                    ? "bg-white/[0.07] text-foreground"
                    : "text-muted-foreground/60 hover:text-foreground hover:bg-white/[0.04]"
                )}
              >
                <I className="h-3.5 w-3.5" /> {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden">

        {/* ── Matrix Tab ──────────────────────────────────────────────────── */}
        {activeTab === 'matrix' && (
          <div className="p-5 space-y-4">

            {/* Filter bar */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/40" />
                <input
                  className="w-full text-xs bg-white/[0.04] border border-white/[0.08] rounded-xl pl-8 pr-3 py-2 text-foreground placeholder:text-muted-foreground/30 outline-none focus:border-indigo-400/40 transition-colors"
                  placeholder="Filter permissions…"
                  value={searchQ}
                  onChange={e => setSearchQ(e.target.value)}
                  data-testid="input-perm-search"
                />
              </div>
              {/* Risk filter pills */}
              <div className="flex items-center gap-1">
                {['low', 'medium', 'high', 'critical'].map(r => {
                  const cfg = RISK_CONFIG[r];
                  return (
                    <button
                      key={r}
                      onClick={() => setRiskFilter(prev => prev === r ? null : r)}
                      data-testid={`filter-risk-${r}`}
                      className={cn(
                        "text-[9px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wide transition-all",
                        riskFilter === r
                          ? cn(cfg.color, cfg.bg, cfg.border)
                          : "text-muted-foreground/40 bg-transparent border-white/[0.07] hover:border-white/[0.12]"
                      )}
                    >
                      {r}
                    </button>
                  );
                })}
              </div>
              {/* Role filter */}
              <select
                className="text-xs bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2 text-foreground outline-none focus:border-indigo-400/40 transition-colors"
                value={selectedRole ?? ''}
                onChange={e => setSelectedRole(e.target.value || null)}
                data-testid="select-role-filter"
              >
                <option value="">All roles</option>
                {PLATFORM_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center py-20">
                <div className="h-6 w-6 border-2 border-rose-400/30 border-t-rose-400 rounded-full animate-spin" />
              </div>
            ) : permissions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <Shield className="h-8 w-8 text-muted-foreground/20" />
                <p className="text-sm text-muted-foreground/40">No permissions found. Run migration 025.</p>
              </div>
            ) : (
              Object.entries(byDomain).map(([domain, domainPerms]) => {
                const isOpen = openDomain === domain;
                const domainCfg = PERM_DOMAINS[domain] ?? { label: domain, color: 'slate' };
                const colorClass = DOMAIN_COLORS[domain] ?? "text-slate-400 bg-slate-500/10 border-slate-500/20";

                // Count granted per role for this domain
                const grantCounts: Record<string, number> = {};
                for (const role of displayRoles) {
                  grantCounts[role] = domainPerms.filter(p => rolePermMap.get(`${role}:${p.key}`)).length;
                }

                return (
                  <div key={domain} className={cn(
                    "rounded-2xl border transition-all duration-150",
                    isOpen ? "border-white/[0.10] bg-white/[0.03]" : "border-white/[0.06] bg-white/[0.02]"
                  )}>
                    {/* Domain header */}
                    <button
                      onClick={() => setOpenDomain(prev => prev === domain ? null : domain)}
                      data-testid={`expand-domain-${domain}`}
                      className={cn(
                        "w-full flex items-center gap-3 px-4 py-3 text-left rounded-2xl",
                        isOpen && "sticky top-0 z-10 bg-[#0e0e14]/95 backdrop-blur-sm border-b border-white/[0.06] rounded-t-2xl rounded-b-none"
                      )}
                    >
                      <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-md border uppercase tracking-widest", colorClass)}>
                        {domainCfg.label}
                      </span>
                      <span className="text-xs text-muted-foreground/50">
                        {domainPerms.length} permission{domainPerms.length !== 1 ? 's' : ''}
                      </span>

                      {/* Role grant summary */}
                      {!isOpen && (
                        <div className="flex-1 flex items-center gap-2 justify-end overflow-x-auto">
                          {displayRoles.slice(0, 6).map(role => (
                            <div key={role} className="flex items-center gap-1 flex-shrink-0">
                              <span className={cn("text-[9px] font-medium truncate max-w-[60px]", ROLE_COLORS[role] ?? "text-slate-400")}>
                                {role.replace('_', ' ')}
                              </span>
                              <span className={cn(
                                "text-[9px] font-bold tabular-nums",
                                grantCounts[role] === domainPerms.length ? "text-emerald-400" :
                                grantCounts[role] === 0 ? "text-muted-foreground/25" : "text-amber-400"
                              )}>
                                {grantCounts[role]}/{domainPerms.length}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                      <ChevronDown className={cn(
                        "h-4 w-4 text-muted-foreground/40 flex-shrink-0 transition-transform duration-150",
                        isOpen ? "rotate-180" : "rotate-0"
                      )} />
                    </button>

                    {/* Permission rows */}
                    {isOpen && (
                      <div className="overflow-x-auto">
                        {/* Column header row */}
                        <div className="flex items-center border-b border-white/[0.04] px-4 py-2 min-w-max">
                          <div className="w-56 flex-shrink-0">
                            <span className="text-[9px] text-muted-foreground/40 uppercase tracking-widest">Permission</span>
                          </div>
                          <div className="w-16 flex-shrink-0">
                            <span className="text-[9px] text-muted-foreground/40 uppercase tracking-widest">Risk</span>
                          </div>
                          {displayRoles.map(role => (
                            <div key={role} className="w-24 flex-shrink-0 text-center">
                              <span className={cn("text-[9px] font-semibold truncate block", ROLE_COLORS[role] ?? "text-slate-400")}>
                                {role.replace(/_/g, '\u00AD').replace(/ /g, '\u00AD')}
                              </span>
                            </div>
                          ))}
                        </div>

                        {domainPerms.map(perm => {
                          const riskCfg = RISK_CONFIG[perm.riskLevel] ?? RISK_CONFIG.low;
                          return (
                            <div
                              key={perm.key}
                              className="flex items-center px-4 py-2 border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors min-w-max"
                            >
                              {/* Permission info */}
                              <div className="w-56 flex-shrink-0">
                                <p className="text-xs font-medium text-foreground/90">{perm.label}</p>
                                <p className="text-[10px] text-muted-foreground/35 font-mono">{perm.key}</p>
                              </div>
                              {/* Risk badge */}
                              <div className="w-16 flex-shrink-0">
                                <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded-full border", riskCfg.color, riskCfg.bg, riskCfg.border)}>
                                  {perm.riskLevel}
                                </span>
                              </div>
                              {/* Role toggles */}
                              {displayRoles.map(role => {
                                const isGranted = rolePermMap.get(`${role}:${perm.key}`) === true;
                                const isToggling = togglePermMut.isPending;
                                return (
                                  <div key={role} className="w-24 flex-shrink-0 flex justify-center">
                                    <button
                                      onClick={() => togglePermMut.mutate({
                                        role, permissionKey: perm.key, granted: !isGranted,
                                      })}
                                      disabled={isToggling}
                                      data-testid={`toggle-${role}-${perm.key}`}
                                      title={`${isGranted ? 'Revoke' : 'Grant'} ${perm.key} from ${role}`}
                                      className={cn(
                                        "h-6 w-6 rounded-lg flex items-center justify-center transition-all duration-100",
                                        isGranted
                                          ? "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 border border-emerald-500/20"
                                          : "bg-white/[0.03] text-muted-foreground/15 hover:bg-white/[0.07] hover:text-muted-foreground/40 border border-white/[0.06]",
                                        perm.riskLevel === 'critical' && isGranted && "ring-1 ring-rose-500/30"
                                      )}
                                    >
                                      {isGranted
                                        ? <Check className="h-3 w-3" />
                                        : <X className="h-3 w-3" />
                                      }
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* ── Overrides Tab ────────────────────────────────────────────────── */}
        {activeTab === 'overrides' && (
          <div className="p-5 space-y-3">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">
                Per-User Permission Overrides
              </h2>
              <span className="text-[10px] text-muted-foreground/30">{overrides.length} active</span>
            </div>

            {overrides.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 rounded-2xl border border-dashed border-white/[0.07]">
                <Unlock className="h-6 w-6 text-muted-foreground/20" />
                <p className="text-sm text-muted-foreground/40 text-center">No per-user overrides configured</p>
                <p className="text-xs text-muted-foreground/25 text-center max-w-xs">
                  Overrides grant or revoke specific permissions for individual users, superseding their role defaults.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {overrides.map(ov => {
                  const riskCfg = RISK_CONFIG.medium;
                  return (
                    <div
                      key={ov.id}
                      className="flex items-center gap-3 px-4 py-3 rounded-xl border border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.03] transition-colors"
                    >
                      <div className={cn(
                        "p-1.5 rounded-lg flex-shrink-0",
                        ov.granted ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"
                      )}>
                        {ov.granted ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <p className="text-xs font-semibold text-foreground truncate">{ov.userId}</p>
                          <span className={cn(
                            "text-[9px] font-bold px-1.5 py-0.5 rounded-full border",
                            ov.granted ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" : "text-rose-400 bg-rose-500/10 border-rose-500/20"
                          )}>
                            {ov.granted ? 'GRANT' : 'REVOKE'}
                          </span>
                          <span className="text-[9px] font-mono text-muted-foreground/50">{ov.permissionKey}</span>
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground/40">
                          <span>scope: {ov.scope}</span>
                          {ov.reason && <span>· {ov.reason}</span>}
                          {ov.expiresAt && <span>· expires {new Date(ov.expiresAt).toLocaleDateString()}</span>}
                          <span>· by {ov.grantedBy}</span>
                        </div>
                      </div>
                      <button
                        onClick={() => deleteOverrideMut.mutate(ov.id)}
                        data-testid={`remove-override-${ov.id}`}
                        className="p-1.5 rounded-lg text-muted-foreground/30 hover:text-rose-400 hover:bg-rose-500/[0.07] transition-colors flex-shrink-0"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Audit Tab ────────────────────────────────────────────────────── */}
        {activeTab === 'audit' && (
          <div className="p-5 space-y-3">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">
                Permission Audit Trail
              </h2>
              <span className="text-[10px] text-muted-foreground/30">{auditLog.length} events</span>
            </div>

            {auditLog.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 rounded-2xl border border-dashed border-white/[0.07]">
                <History className="h-6 w-6 text-muted-foreground/20" />
                <p className="text-sm text-muted-foreground/40">No audit events yet</p>
              </div>
            ) : (
              <div className="space-y-1">
                {auditLog.map(ev => {
                  const isGrant = ev.eventType.includes('grant') || ev.afterValue?.granted === true;
                  return (
                    <div
                      key={ev.id}
                      className="flex items-start gap-3 px-4 py-2.5 rounded-xl hover:bg-white/[0.02] transition-colors border border-transparent hover:border-white/[0.05]"
                    >
                      <div className={cn(
                        "mt-0.5 h-5 w-5 rounded-md flex items-center justify-center flex-shrink-0",
                        isGrant ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"
                      )}>
                        {isGrant ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-foreground/80">
                          <span className="font-semibold">{ev.actorId}</span>
                          {' '}
                          <span className="text-muted-foreground/60">{ev.eventType.replace(/_/g, ' ')}</span>
                          {ev.permissionKey && (
                            <span className="font-mono text-indigo-400/80"> {ev.permissionKey}</span>
                          )}
                          {ev.targetRole && (
                            <span className="text-muted-foreground/50"> for role <span className="text-foreground/60">{ev.targetRole}</span></span>
                          )}
                          {ev.targetUserId && (
                            <span className="text-muted-foreground/50"> for user <span className="text-foreground/60">{ev.targetUserId}</span></span>
                          )}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground/30">
                          <span>{new Date(ev.createdAt).toLocaleString()}</span>
                          {ev.ipAddress && <span>· {ev.ipAddress}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

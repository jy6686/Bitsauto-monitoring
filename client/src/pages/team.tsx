import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth, type AuthUser } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import {
  Shield, Users, Loader2, CheckCircle2, UserCog, Search,
  Crown, Eye, Briefcase, Calendar, ChevronDown, XCircle, UserCheck,
} from "lucide-react";
import { useState, useMemo } from "react";
import type { Role } from "@shared/schema";

type TeamMember = AuthUser;

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

function Avatar({ member }: { member: TeamMember }) {
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

export default function TeamPage() {
  const { user, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [filterRole, setFilterRole] = useState<Role | 'all'>('all');
  const [assignEmail, setAssignEmail] = useState('');
  const [assignRole, setAssignRole] = useState<Role>('viewer');
  const [assignResult, setAssignResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const { data: members = [], isLoading } = useQuery<TeamMember[]>({
    queryKey: ["/api/team"],
    enabled: isAdmin,
  });

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
        <h2 className="text-3xl font-bold tracking-tight">Team Management</h2>
        <p className="text-muted-foreground mt-1">
          Control your team's access levels. Changes take effect immediately.
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
        {/* List Header */}
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
            {/* Search */}
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
            {/* Filter by role */}
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

        {/* List Body */}
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
                    <Avatar member={member} />
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
                    <RoleSelector
                      memberId={member.id}
                      currentRole={member.role}
                      selfId={user?.id ?? ''}
                    />
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
                  <span className="inline-flex items-center gap-1.5 text-rose-400 font-semibold">
                    <Crown className="w-3.5 h-3.5" />Admin
                  </span>
                </th>
                <th className="text-center px-4 py-3 text-xs uppercase tracking-wide">
                  <span className="inline-flex items-center gap-1.5 text-amber-400 font-semibold">
                    <Briefcase className="w-3.5 h-3.5" />Mgmt
                  </span>
                </th>
                <th className="text-center px-4 py-3 text-xs uppercase tracking-wide">
                  <span className="inline-flex items-center gap-1.5 text-blue-400 font-semibold">
                    <Eye className="w-3.5 h-3.5" />Viewer
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {PERMISSIONS.map(({ label, admin, mgmt, viewer }, i) => (
                <tr
                  key={label}
                  className={`border-b border-border/20 last:border-0 ${i % 2 === 0 ? '' : 'bg-muted/5'}`}
                >
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

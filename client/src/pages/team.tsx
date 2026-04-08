import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth, type AuthUser } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import { Shield, Users, ChevronDown, Loader2, CheckCircle2, UserCog, Search } from "lucide-react";
import { useState } from "react";
import type { Role } from "@shared/schema";

type TeamMember = AuthUser;

const ROLE_META: Record<Role, { label: string; color: string; bg: string; desc: string }> = {
  admin: {
    label: "Admin",
    color: "text-rose-400",
    bg: "bg-rose-500/10 border-rose-500/30",
    desc: "Full access — dashboard, calls, alerts, reports, settings, and team management.",
  },
  management: {
    label: "Management",
    color: "text-amber-400",
    bg: "bg-amber-500/10 border-amber-500/30",
    desc: "Dashboard, active calls, alerts, and reports. No settings or team management.",
  },
  viewer: {
    label: "Viewer",
    color: "text-blue-400",
    bg: "bg-blue-500/10 border-blue-500/30",
    desc: "Dashboard and alerts only. Read-only access.",
  },
};

function RoleBadge({ role }: { role: Role }) {
  const m = ROLE_META[role] || ROLE_META.viewer;
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${m.bg} ${m.color}`}>
      {m.label}
    </span>
  );
}

function RoleSelector({
  memberId,
  currentRole,
  selfId,
}: {
  memberId: string;
  currentRole: Role;
  selfId: string;
}) {
  const queryClient = useQueryClient();
  const isSelf = memberId === selfId;

  const mutation = useMutation({
    mutationFn: (role: Role) =>
      apiRequest("PATCH", `/api/team/${memberId}/role`, { role }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/team"] });
    },
  });

  if (isSelf) {
    return (
      <div className="flex items-center gap-2">
        <RoleBadge role={currentRole} />
        <span className="text-xs text-muted-foreground">(you)</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <div className="relative">
        <select
          data-testid={`select-role-${memberId}`}
          value={currentRole}
          disabled={mutation.isPending}
          onChange={(e) => mutation.mutate(e.target.value as Role)}
          className="appearance-none bg-background border border-border rounded-lg pl-3 pr-8 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all disabled:opacity-50 cursor-pointer"
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
        <span className="text-xs text-rose-400">
          {(mutation.error as any)?.message || "Failed"}
        </span>
      )}
    </div>
  );
}

export default function TeamPage() {
  const { user, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [assignEmail, setAssignEmail] = useState('');
  const [assignRole, setAssignRole] = useState<Role>('viewer');
  const [assignResult, setAssignResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const { data: members, isLoading } = useQuery<TeamMember[]>({
    queryKey: ["/api/team"],
    enabled: isAdmin,
  });

  const assignMutation = useMutation({
    mutationFn: async () => {
      const email = assignEmail.trim().toLowerCase();
      const target = members?.find(m => m.email?.toLowerCase() === email);
      if (!target) throw new Error(`No team member found with email "${email}".`);
      await apiRequest('PATCH', `/api/team/${target.id}/role`, { role: assignRole });
      return target;
    },
    onSuccess: (target) => {
      queryClient.invalidateQueries({ queryKey: ['/api/team'] });
      setAssignResult({ ok: true, msg: `Role updated to ${ROLE_META[assignRole].label} for ${target.email}.` });
      setAssignEmail('');
    },
    onError: (err: any) => {
      setAssignResult({ ok: false, msg: err.message || 'Failed to assign role.' });
    },
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
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Team Management</h2>
        <p className="text-muted-foreground mt-1">
          Manage your support team's access levels. Changes take effect immediately on next page load.
        </p>
      </div>

      {/* Quick Assign Role */}
      <div className="bg-card border border-violet-500/20 rounded-xl overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-border/50 bg-violet-500/5">
          <UserCog className="w-4 h-4 text-violet-400" />
          <h3 className="font-semibold text-sm">Assign Role</h3>
          <span className="text-xs text-muted-foreground">— quickly update a team member's access level</span>
        </div>
        <div className="p-6 space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <input
                data-testid="input-assign-email"
                type="email"
                placeholder="user@example.com"
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
              className="flex items-center gap-2 px-5 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-500 transition-colors disabled:opacity-50 whitespace-nowrap"
            >
              {assignMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
              Assign Role
            </button>
          </div>
          {assignResult && (
            <p className={`text-sm flex items-center gap-2 ${assignResult.ok ? 'text-emerald-400' : 'text-rose-400'}`}>
              {assignResult.ok ? <CheckCircle2 className="w-4 h-4" /> : '⚠'} {assignResult.msg}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Enter the email of an existing team member and select the role to assign. Users must have signed in at least once to appear in the list.
          </p>
        </div>
      </div>

      {/* Role legend */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {(Object.keys(ROLE_META) as Role[]).map((role) => {
          const m = ROLE_META[role];
          return (
            <div key={role} className={`rounded-xl border p-4 ${m.bg}`}>
              <div className="flex items-center gap-2 mb-2">
                <Shield className={`w-4 h-4 ${m.color}`} />
                <span className={`font-semibold text-sm ${m.color}`}>{m.label}</span>
              </div>
              <p className="text-xs text-muted-foreground">{m.desc}</p>
            </div>
          );
        })}
      </div>

      {/* Access matrix */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border/50 bg-muted/20">
          <h3 className="font-semibold text-sm">Permissions Matrix</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50">
                <th className="text-left px-6 py-3 text-muted-foreground font-medium">Page / Feature</th>
                <th className="text-center px-4 py-3 text-rose-400 font-medium">Admin</th>
                <th className="text-center px-4 py-3 text-amber-400 font-medium">Management</th>
                <th className="text-center px-4 py-3 text-blue-400 font-medium">Viewer</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Dashboard", true, true, true],
                ["Active Calls", true, true, true],
                ["Alerts", true, true, false],
                ["ASR/ACD Reports", true, true, false],
                ["Settings", true, false, false],
                ["Team Management", true, false, false],
              ].map(([page, admin, mgmt, viewer]) => (
                <tr key={page as string} className="border-b border-border/30 last:border-0">
                  <td className="px-6 py-3 font-medium">{page as string}</td>
                  {[admin, mgmt, viewer].map((has, i) => (
                    <td key={i} className="text-center px-4 py-3">
                      {has
                        ? <span className="text-emerald-400 text-base">✓</span>
                        : <span className="text-muted-foreground/40 text-base">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Team member list */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 bg-muted/20">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-muted-foreground" />
            <h3 className="font-semibold text-sm">Team Members</h3>
          </div>
          {members && (
            <span className="text-xs text-muted-foreground">{members.length} member{members.length !== 1 ? 's' : ''}</span>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12 gap-3 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span>Loading team members…</span>
          </div>
        ) : !members?.length ? (
          <div className="text-center py-12 text-muted-foreground">
            <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p>No team members yet.</p>
            <p className="text-xs mt-1">Users appear here after they sign in for the first time.</p>
          </div>
        ) : (
          <div className="divide-y divide-border/30">
            {members.map((member) => {
              const initials = ((member.firstName?.[0] || '') + (member.lastName?.[0] || '')) || member.email?.[0]?.toUpperCase() || '?';
              const displayName = [member.firstName, member.lastName].filter(Boolean).join(' ') || member.email || member.id;
              return (
                <div
                  key={member.id}
                  data-testid={`row-member-${member.id}`}
                  className="flex items-center justify-between px-6 py-4 hover:bg-muted/20 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className="h-9 w-9 rounded-full bg-gradient-to-br from-blue-500/30 to-violet-500/30 flex items-center justify-center text-sm font-bold text-blue-300 flex-shrink-0">
                      {initials}
                    </div>
                    <div>
                      <p className="font-medium text-sm">{displayName}</p>
                      {member.email && (
                        <p className="text-xs text-muted-foreground">{member.email}</p>
                      )}
                    </div>
                  </div>
                  <RoleSelector
                    memberId={member.id}
                    currentRole={member.role}
                    selfId={user?.id ?? ''}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground text-center">
        New users who sign in are automatically assigned the <strong>Viewer</strong> role. Change their role here at any time.
      </p>
    </div>
  );
}

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import {
  Shield, CheckCircle2, XCircle, AlertTriangle, Loader2,
  Settings2, Route, Server, Network, Lock, GitBranch,
  ChevronDown, Info, Save,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type ActionKey = "create" | "edit" | "delete";
type FeatureCfg = Record<ActionKey, boolean>;
type ApprovalConfig = Record<string, FeatureCfg>;

const FEATURES: {
  key: string;
  label: string;
  icon: React.ElementType;
  description: string;
  category: "routing" | "network" | "auth" | "system";
}[] = [
  {
    key: "routing_group",
    label: "Routing Group",
    icon: Route,
    description: "Create, edit or delete routing groups on the Sippy switch",
    category: "routing",
  },
  {
    key: "routing_group_member",
    label: "Routing Entries",
    icon: GitBranch,
    description: "Add, update or remove entries (connections + destination sets) within a routing group",
    category: "routing",
  },
  {
    key: "destination_set",
    label: "Destination Sets",
    icon: Server,
    description: "Create, edit or delete destination sets and their prefix routes",
    category: "routing",
  },
  {
    key: "ds_route",
    label: "DS Routes",
    icon: ChevronDown,
    description: "Add, update or delete individual prefix routes inside destination sets",
    category: "routing",
  },
  {
    key: "vendor_connection",
    label: "Vendor Connection",
    icon: Network,
    description: "Create, edit or delete vendor connections and their parameters",
    category: "network",
  },
  {
    key: "ip_management",
    label: "IP Management",
    icon: Shield,
    description: "Add, modify or remove IP allowlists, blocklists and firewall rules",
    category: "network",
  },
  {
    key: "authentication",
    label: "Authentication",
    icon: Lock,
    description: "Manage API credentials, session tokens, and authentication settings",
    category: "auth",
  },
];

const DEFAULT_CONFIG: ApprovalConfig = {
  routing_group:        { create: false, edit: true,  delete: true  },
  routing_group_member: { create: false, edit: true,  delete: true  },
  destination_set:      { create: true,  edit: true,  delete: true  },
  ds_route:             { create: true,  edit: true,  delete: true  },
  vendor_connection:    { create: false, edit: false, delete: false },
  ip_management:        { create: true,  edit: true,  delete: true  },
  authentication:       { create: true,  edit: true,  delete: true  },
};

const CATEGORY_LABELS: Record<string, string> = {
  routing: "Routing",
  network: "Network",
  auth: "Access & Auth",
  system: "System",
};
const CATEGORY_COLORS: Record<string, string> = {
  routing: "text-violet-400 bg-violet-500/10 border-violet-500/20",
  network: "text-cyan-400 bg-cyan-500/10 border-cyan-500/20",
  auth: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  system: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
};

const ACTION_LABEL: Record<ActionKey, string> = { create: "Create", edit: "Edit", delete: "Delete" };
const ACTION_COLOR: Record<ActionKey, string> = {
  create: "text-emerald-400",
  edit:   "text-amber-400",
  delete: "text-rose-400",
};

export default function ApprovalSettingsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [localCfg, setLocalCfg] = useState<ApprovalConfig | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  const { data, isLoading } = useQuery<{ settings: ApprovalConfig }>({
    queryKey: ["/api/approval-settings"],
  });

  useEffect(() => {
    if (data && !isDirty) setLocalCfg({ ...DEFAULT_CONFIG, ...data.settings });
  }, [data]);

  const saveMut = useMutation({
    mutationFn: async (cfg: ApprovalConfig) =>
      (await apiRequest("PATCH", "/api/approval-settings", { settings: cfg })).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/approval-settings"] });
      setIsDirty(false);
      toast({ title: "Approval settings saved", description: "Changes take effect immediately for new requests." });
    },
    onError: (e: any) =>
      toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const cfg = localCfg ?? (data ? { ...DEFAULT_CONFIG, ...data.settings } : DEFAULT_CONFIG);

  const toggle = (featureKey: string, action: ActionKey) => {
    const next = {
      ...cfg,
      [featureKey]: { ...cfg[featureKey], [action]: !cfg[featureKey]?.[action] },
    };
    setLocalCfg(next);
    setIsDirty(true);
  };

  const toggleSection = (cat: string) => {
    const catFeatures = FEATURES.filter(f => f.category === cat);
    const allOn = catFeatures.every(f =>
      (["create", "edit", "delete"] as ActionKey[]).every(a => cfg[f.key]?.[a])
    );
    const next = { ...cfg };
    for (const f of catFeatures) {
      next[f.key] = { create: !allOn, edit: !allOn, delete: !allOn };
    }
    setLocalCfg(next);
    setIsDirty(true);
  };

  const isSectionOn = (cat: string) => {
    const catFeatures = FEATURES.filter(f => f.category === cat);
    return catFeatures.every(f =>
      (["create", "edit", "delete"] as ActionKey[]).every(a => cfg[f.key]?.[a])
    );
  };

  const isSectionPartial = (cat: string) => {
    const catFeatures = FEATURES.filter(f => f.category === cat);
    const total = catFeatures.length * 3;
    const on = catFeatures.reduce((sum, f) =>
      sum + (["create", "edit", "delete"] as ActionKey[]).filter(a => cfg[f.key]?.[a]).length, 0);
    return on > 0 && on < total;
  };

  const totalEnabled = Object.values(cfg).reduce(
    (sum, f) => sum + Object.values(f).filter(Boolean).length,
    0,
  );

  const isAdmin = user?.role === "admin" || user?.role === "super_admin";

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4 text-center">
        <Shield className="w-12 h-12 text-muted-foreground/40" />
        <h2 className="text-xl font-semibold">Access Restricted</h2>
        <p className="text-muted-foreground max-w-sm">Only Admins can configure approval settings.</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Approval Settings</h2>
          <p className="text-muted-foreground mt-1">
            Control which actions require admin approval before being applied to the switch.
          </p>
        </div>
        {isDirty && (
          <Button
            onClick={() => saveMut.mutate(cfg)}
            disabled={saveMut.isPending}
            className="gap-2 shrink-0"
            data-testid="btn-save-approval-settings"
          >
            {saveMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Changes
          </Button>
        )}
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 bg-blue-500/5 border border-blue-500/20 rounded-xl px-5 py-4">
        <Info className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
        <div className="text-sm">
          <p className="font-medium text-blue-300">How approval works</p>
          <p className="text-muted-foreground mt-0.5 leading-relaxed">
            When <span className="text-foreground font-medium">ON</span>, the action is queued in the Approval Queue and must be approved by an Admin before it's applied.
            When <span className="text-foreground font-medium">OFF</span>, the action is applied directly to the switch with no queue step.
          </p>
        </div>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Approval Required",   value: totalEnabled,          color: "text-amber-400", icon: AlertTriangle  },
          { label: "Direct (No Approval)", value: 21 - totalEnabled,    color: "text-emerald-400", icon: CheckCircle2  },
          { label: "Total Actions",        value: 21,                   color: "text-violet-400", icon: Settings2      },
        ].map(({ label, value, color, icon: Icon }) => (
          <div key={label} className="bg-card border border-border/50 rounded-xl p-4 flex items-center gap-3">
            <Icon className={`w-5 h-5 ${color} shrink-0`} />
            <div>
              <p className="text-2xl font-bold">{value}</p>
              <p className="text-xs text-muted-foreground">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Main matrix */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">Loading settings…</span>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          {/* Column headers */}
          <div className="grid grid-cols-[1fr_repeat(3,_100px)] border-b border-border/50 bg-muted/20">
            <div className="px-5 py-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Feature / Action
            </div>
            {(["create", "edit", "delete"] as ActionKey[]).map(a => (
              <div key={a} className={`py-3 text-center text-xs font-bold uppercase tracking-widest ${ACTION_COLOR[a]}`}>
                {ACTION_LABEL[a]}
              </div>
            ))}
          </div>

          {/* Category groupings */}
          {(["routing", "network", "auth"] as const).map(cat => {
            const catFeatures = FEATURES.filter(f => f.category === cat);
            if (!catFeatures.length) return null;
            return (
              <div key={cat}>
                {/* Category header */}
                <div className="px-5 py-2.5 bg-muted/30 border-b border-border/30 flex items-center justify-between gap-2">
                  <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full border ${CATEGORY_COLORS[cat]}`}>
                    {CATEGORY_LABELS[cat]}
                  </span>
                  <button
                    data-testid={`btn-section-toggle-${cat}`}
                    onClick={() => toggleSection(cat)}
                    disabled={saveMut.isPending}
                    title={isSectionOn(cat) ? `Turn off all ${CATEGORY_LABELS[cat]} approvals` : `Turn on all ${CATEGORY_LABELS[cat]} approvals`}
                    className={`flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded-lg border transition-all ${
                      isSectionOn(cat)
                        ? "bg-amber-500/15 border-amber-500/40 text-amber-400 hover:bg-amber-500/25"
                        : isSectionPartial(cat)
                        ? "bg-muted/30 border-border/50 text-muted-foreground hover:bg-muted/50"
                        : "bg-muted/20 border-border/30 text-muted-foreground/60 hover:bg-muted/40"
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${isSectionOn(cat) ? "bg-amber-400" : isSectionPartial(cat) ? "bg-amber-400/50" : "bg-muted-foreground/30"}`} />
                    {isSectionOn(cat) ? "All Required" : isSectionPartial(cat) ? "Mixed" : "All Direct"}
                  </button>
                </div>
                {catFeatures.map((feat, idx) => {
                  const isLast = idx === catFeatures.length - 1;
                  const Icon = feat.icon;
                  return (
                    <div
                      key={feat.key}
                      className={`grid grid-cols-[1fr_repeat(3,_100px)] items-center hover:bg-muted/5 transition-colors ${
                        !isLast ? "border-b border-border/20" : ""
                      }`}
                      data-testid={`approval-row-${feat.key}`}
                    >
                      {/* Feature label */}
                      <div className="flex items-start gap-3 px-5 py-4">
                        <div className="mt-0.5 p-1.5 rounded-lg bg-muted/30 shrink-0">
                          <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                        </div>
                        <div>
                          <p className="text-sm font-medium">{feat.label}</p>
                          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{feat.description}</p>
                        </div>
                      </div>
                      {/* Toggle cells */}
                      {(["create", "edit", "delete"] as ActionKey[]).map(action => {
                        const enabled = cfg[feat.key]?.[action] ?? false;
                        return (
                          <div
                            key={action}
                            className="flex flex-col items-center justify-center py-4 gap-1.5"
                            data-testid={`approval-toggle-${feat.key}-${action}`}
                          >
                            <Switch
                              checked={enabled}
                              onCheckedChange={() => toggle(feat.key, action)}
                              disabled={saveMut.isPending}
                              className={`data-[state=checked]:${
                                action === "create" ? "bg-emerald-500" : action === "edit" ? "bg-amber-500" : "bg-rose-500"
                              }`}
                            />
                            <span className={`text-[10px] font-semibold ${enabled ? ACTION_COLOR[action] : "text-muted-foreground/40"}`}>
                              {enabled ? "Required" : "Direct"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            );
          })}

          {/* Footer */}
          <div className="px-5 py-3 bg-muted/10 border-t border-border/30 flex items-center justify-between gap-4">
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="w-3 h-3 rounded-full bg-amber-500/30 border border-amber-500/60 inline-block" />
                Required — goes to Approval Queue
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="w-3 h-3 rounded-full bg-muted/50 border border-border/50 inline-block" />
                Direct — applied immediately
              </div>
            </div>
            {isDirty && (
              <Button
                size="sm"
                onClick={() => saveMut.mutate(cfg)}
                disabled={saveMut.isPending}
                className="gap-1.5"
                data-testid="btn-save-approval-settings-footer"
              >
                {saveMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Save
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Audit note */}
      <div className="flex items-start gap-3 bg-muted/10 border border-border/30 rounded-xl px-5 py-4">
        <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
        <div className="text-sm text-muted-foreground">
          <span className="text-foreground font-medium">All changes are logged.</span>{" "}
          Every approval decision (Approve / Reject) is recorded in the Approval Audit Log with the reviewer name, timestamp, and before/after state. This setting only controls whether an action requires approval — it does not bypass audit logging.
        </div>
      </div>
    </div>
  );
}

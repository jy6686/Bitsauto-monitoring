import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { Save, RotateCcw, Loader2, Info } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

// ── Types ──────────────────────────────────────────────────────────────────────
interface EnrichedRule {
  id: number;
  scope: string;
  groupName: string;
  ruleKey: string;
  description: string;
  configCategory?: string | null;
  configKey?: string | null;
  selectedAction: string;
  sortOrder: number;
  threshold?: string | null;
  thresholdUnit?: string | null;
  thresholdLabel?: string | null;
}

interface RulesResponse {
  scope: string;
  groups: { name: string; rules: EnrichedRule[] }[];
}

// ── Constants ──────────────────────────────────────────────────────────────────
const SCOPES = [
  { key: "vendor",     label: "Vendor" },
  { key: "client",     label: "Client" },
  { key: "commercial", label: "Commercial" },
  { key: "global",     label: "Global" },
];

const ACTIONS: { key: string; label: string; short: string; color: string }[] = [
  { key: "ignore",                    label: "Ignore",               short: "Ignore",   color: "text-muted-foreground" },
  { key: "reject_rate_sheet",         label: "Reject Rate Sheet",    short: "Reject\nSheet",    color: "text-rose-400" },
  { key: "reject_country",            label: "Reject Country",       short: "Reject\nCountry",  color: "text-orange-400" },
  { key: "reject_destination",        label: "Reject Destination",   short: "Reject\nDest",     color: "text-amber-400" },
  { key: "approval_reqd",             label: "Approval Required",    short: "Approval\nReqd",   color: "text-blue-400" },
  { key: "auto_adjust_effective_date",label: "Auto Adjust Eff. Date",short: "Auto\nAdjust",     color: "text-cyan-400" },
];

function formatThreshold(value: string | null | undefined, unit: string | null | undefined): string {
  if (value == null || value === "") return "—";
  if (unit === "bool" || value === "true" || value === "false") return value === "true" ? "Yes" : "No";
  if (unit === "percent") return `${value}%`;
  if (unit === "days")    return `${value} day${value === "1" ? "" : "s"}`;
  if (unit === "hour")    return `${value} hr${value === "1" ? "" : "s"}`;
  if (unit === "mb")      return `${value} MB`;
  return value + (unit ? ` ${unit}` : "");
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function ValidationRulesPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { isManagement } = useAuth();

  const [activeScope, setActiveScope] = useState("client");
  const [drafts, setDrafts]           = useState<Record<number, string>>({});

  const { data, isLoading } = useQuery<RulesResponse>({
    queryKey: ["/api/validation-rules", activeScope],
    queryFn: () =>
      fetch(`/api/validation-rules?scope=${activeScope}`, { credentials: "include" }).then(r => r.json()),
  });

  const dirtyIds = useMemo(() => Object.keys(drafts).map(Number), [drafts]);
  const hasDirty = dirtyIds.length > 0;

  const saveMut = useMutation({
    mutationFn: () => {
      const updates = dirtyIds.map(id => ({ id, selectedAction: drafts[id] }));
      return apiRequest("PATCH", "/api/validation-rules", updates);
    },
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ["/api/validation-rules"] });
      setDrafts({});
      toast({ title: `Saved ${res?.updated ?? dirtyIds.length} rule(s)` });
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  function handleAction(id: number, action: string, current: string) {
    if (action === current && !(id in drafts)) return;
    setDrafts(prev => {
      const next = { ...prev };
      if (action === current) {
        delete next[id];
      } else {
        next[id] = action;
      }
      return next;
    });
  }

  function getEffectiveAction(rule: EnrichedRule): string {
    return drafts[rule.id] ?? rule.selectedAction;
  }

  function handleTabChange(scope: string) {
    if (hasDirty && !confirm("You have unsaved changes. Discard them?")) return;
    setActiveScope(scope);
    setDrafts({});
  }

  const groups = data?.groups ?? [];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/40">
        <div>
          <h1 className="text-base font-semibold text-foreground">Validation Rules</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Define how rate violations are handled per scope. Thresholds are sourced live from Configuration Values.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasDirty && (
            <button onClick={() => setDrafts({})}
              className="flex items-center gap-1.5 text-xs border border-border/40 text-muted-foreground hover:text-foreground px-3 py-1.5 rounded transition-colors"
              data-testid="btn-discard-rules">
              <RotateCcw className="w-3 h-3" /> Discard
            </button>
          )}
          <button
            onClick={() => saveMut.mutate()}
            disabled={!hasDirty || saveMut.isPending || !isManagement}
            data-testid="btn-update-rules"
            className={cn(
              "flex items-center gap-1.5 text-xs px-3 py-1.5 rounded transition-colors font-medium",
              hasDirty && isManagement
                ? "bg-amber-600 hover:bg-amber-500 text-white"
                : "bg-muted/30 text-muted-foreground cursor-not-allowed opacity-50",
            )}>
            {saveMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
            Update{hasDirty ? ` (${dirtyIds.length})` : ""}
          </button>
        </div>
      </div>

      {/* Scope tabs */}
      <div className="flex items-center border-b border-border/40 px-6 gap-0">
        {SCOPES.map(s => (
          <button key={s.key} onClick={() => handleTabChange(s.key)}
            data-testid={`tab-scope-${s.key}`}
            className={cn(
              "text-xs px-4 py-2.5 border-b-2 transition-colors whitespace-nowrap",
              activeScope === s.key
                ? "border-amber-400 text-amber-400 font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}>
            {s.label}
          </button>
        ))}
      </div>

      {/* Read-only note */}
      {!isManagement && (
        <div className="px-6 py-2 border-b border-border/20 bg-muted/5">
          <span className="text-[10px] text-muted-foreground/60 italic">
            Read-only — management access required to change rule actions
          </span>
        </div>
      )}

      {/* Matrix */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center gap-2 justify-center py-16 text-xs text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading rules…
          </div>
        ) : groups.length === 0 ? (
          <div className="text-center py-20 text-xs text-muted-foreground">
            No validation rules defined for the {SCOPES.find(s => s.key === activeScope)?.label} scope yet.
          </div>
        ) : (
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-border/50 bg-muted/20 sticky top-0 z-10">
                <th className="text-left py-2.5 px-4 font-medium text-muted-foreground min-w-[260px]">Rule</th>
                {ACTIONS.map(a => (
                  <th key={a.key} className="py-2 px-2 text-center font-medium text-muted-foreground min-w-[80px]">
                    <span className={cn("whitespace-pre-line leading-tight text-[10px]", a.color)}>
                      {a.short}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map(group => (
                <>
                  {/* Group header row */}
                  <tr key={`group-${group.name}`} className="bg-muted/30 border-y border-border/30">
                    <td colSpan={ACTIONS.length + 1}
                      className="px-4 py-1.5 text-[10px] font-semibold text-muted-foreground/80 uppercase tracking-wider">
                      {group.name}
                    </td>
                  </tr>

                  {/* Rule rows */}
                  {group.rules.map(rule => {
                    const effective = getEffectiveAction(rule);
                    const isDirty = rule.id in drafts;
                    return (
                      <tr key={rule.id}
                        data-testid={`row-rule-${rule.id}`}
                        className={cn(
                          "border-b border-border/20 transition-colors",
                          isDirty ? "bg-amber-500/[0.04]" : "hover:bg-muted/10",
                        )}>
                        {/* Rule description + threshold */}
                        <td className="py-3 px-4">
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-1.5">
                              <span className={cn("font-medium leading-tight", isDirty && "text-amber-300/90")}>
                                {rule.description}
                              </span>
                              {isDirty && (
                                <span className="text-[9px] text-amber-400 font-medium uppercase tracking-wide ml-1">
                                  modified
                                </span>
                              )}
                            </div>
                            {rule.threshold != null && rule.thresholdLabel && (
                              <div className="flex items-center gap-1 text-[10px] text-muted-foreground/70">
                                <Info className="w-2.5 h-2.5 flex-shrink-0 text-muted-foreground/40" />
                                <span>
                                  Threshold:{" "}
                                  <span className="text-foreground/70 font-medium tabular-nums">
                                    {formatThreshold(rule.threshold, rule.thresholdUnit)}
                                  </span>
                                  {" "}
                                  <span className="text-muted-foreground/50">
                                    ({rule.configCategory && rule.configKey
                                      ? `${rule.configCategory}.${rule.configKey.replace(/_/g, " ")}`
                                      : rule.thresholdLabel})
                                  </span>
                                </span>
                              </div>
                            )}
                          </div>
                        </td>

                        {/* Action radio cells */}
                        {ACTIONS.map(action => {
                          const selected = effective === action.key;
                          return (
                            <td key={action.key} className="py-3 px-2 text-center">
                              <button
                                type="button"
                                disabled={!isManagement}
                                onClick={() => isManagement && handleAction(rule.id, action.key, rule.selectedAction)}
                                data-testid={`radio-${rule.id}-${action.key}`}
                                className={cn(
                                  "mx-auto flex items-center justify-center w-4 h-4 rounded-full border-2 transition-all",
                                  selected
                                    ? "border-amber-400 bg-amber-400/20"
                                    : "border-border/40 hover:border-muted-foreground/40",
                                  !isManagement && "cursor-not-allowed opacity-60",
                                )}>
                                {selected && (
                                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                                )}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { Search, Save, RefreshCw, RotateCcw, Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

// ── Types ──────────────────────────────────────────────────────────────────────
interface ConfigValue {
  id: number;
  category: string;
  configKey: string;
  label: string;
  description?: string | null;
  unit?: string | null;
  value?: string | null;
  defaultValue?: string | null;
  valueType: string;
  isEditable: boolean;
  isActive: boolean;
  sortOrder: number;
}

// ── Categories ─────────────────────────────────────────────────────────────────
const CATEGORIES = [
  { key: "vendor",     label: "Vendor" },
  { key: "client",     label: "Client" },
  { key: "commercial", label: "Commercial" },
  { key: "global",     label: "Global" },
  { key: "az",         label: "A-Z" },
  { key: "bsr",        label: "BSR" },
];

// ── Value type helpers ─────────────────────────────────────────────────────────
function renderValueInput(
  row: ConfigValue,
  draft: string | null | undefined,
  onChange: (v: string | null) => void,
  readOnly: boolean,
) {
  const val = draft !== undefined ? draft : (row.value ?? "");

  if (row.valueType === "bool") {
    const checked = val === "true";
    return (
      <button
        type="button"
        disabled={readOnly || !row.isEditable}
        onClick={() => !readOnly && row.isEditable && onChange(checked ? "false" : "true")}
        data-testid={`toggle-${row.id}`}
        className={cn(
          "relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0",
          checked ? "bg-amber-500" : "bg-muted/40 border border-border/40",
          (readOnly || !row.isEditable) && "opacity-50 cursor-not-allowed",
        )}>
        <span className={cn(
          "inline-block h-3.5 w-3.5 rounded-full bg-white shadow transform transition-transform",
          checked ? "translate-x-4" : "translate-x-0.5",
        )} />
      </button>
    );
  }

  if (["number", "float", "percent", "days", "mb", "hour"].includes(row.valueType)) {
    return (
      <input
        type="number"
        step={row.valueType === "float" ? "0.0001" : "1"}
        value={val}
        disabled={readOnly || !row.isEditable}
        onChange={e => onChange(e.target.value)}
        data-testid={`input-${row.id}`}
        className={cn(
          "w-28 bg-background border border-border/40 rounded px-2 py-1 text-xs text-right tabular-nums",
          "focus:outline-none focus:ring-1 focus:ring-amber-500/50",
          (readOnly || !row.isEditable) && "opacity-50 cursor-not-allowed",
        )}
      />
    );
  }

  if (row.valueType === "email") {
    return (
      <input
        type="email"
        value={val}
        disabled={readOnly || !row.isEditable}
        onChange={e => onChange(e.target.value)}
        data-testid={`input-${row.id}`}
        placeholder="—"
        className={cn(
          "w-52 bg-background border border-border/40 rounded px-2 py-1 text-xs",
          "focus:outline-none focus:ring-1 focus:ring-amber-500/50",
          (readOnly || !row.isEditable) && "opacity-50 cursor-not-allowed",
        )}
      />
    );
  }

  // text | domain | default
  return (
    <input
      type="text"
      value={val}
      disabled={readOnly || !row.isEditable}
      onChange={e => onChange(e.target.value)}
      data-testid={`input-${row.id}`}
      placeholder="—"
      className={cn(
        "w-48 bg-background border border-border/40 rounded px-2 py-1 text-xs",
        "focus:outline-none focus:ring-1 focus:ring-amber-500/50",
        (readOnly || !row.isEditable) && "opacity-50 cursor-not-allowed",
      )}
    />
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function ConfigurationValuesPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { isManagement } = useAuth();

  const [activeTab, setActiveTab]   = useState("vendor");
  const [filter, setFilter]         = useState("");
  const [drafts, setDrafts]         = useState<Record<number, string | null>>({});

  const { data: rows = [], isLoading } = useQuery<ConfigValue[]>({
    queryKey: ["/api/configuration-values", activeTab],
    queryFn: () => fetch(`/api/configuration-values?category=${activeTab}`, { credentials: "include" }).then(r => r.json()),
  });

  const dirtyIds = useMemo(() => Object.keys(drafts).map(Number), [drafts]);
  const hasDirty = dirtyIds.length > 0;

  const filteredRows = useMemo(() =>
    filter ? rows.filter(r => r.label.toLowerCase().includes(filter.toLowerCase())) : rows,
    [rows, filter],
  );

  const saveMut = useMutation({
    mutationFn: () => {
      const updates = dirtyIds.map(id => ({ id, value: drafts[id] }));
      return apiRequest("PATCH", "/api/configuration-values", updates);
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["/api/configuration-values"] });
      setDrafts({});
      toast({ title: `Saved ${data?.updated ?? dirtyIds.length} value(s)` });
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  function handleChange(id: number, value: string | null) {
    setDrafts(prev => ({ ...prev, [id]: value }));
  }

  function handleReset() {
    setDrafts({});
  }

  // Switch tabs — discard drafts with confirmation
  function handleTabChange(tab: string) {
    if (hasDirty && !confirm("You have unsaved changes. Discard them?")) return;
    setActiveTab(tab);
    setDrafts({});
    setFilter("");
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/40">
        <div>
          <h1 className="text-base font-semibold text-foreground">Configuration Values</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Central operational parameters for rate management, scheduling, invoicing and governance.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasDirty && (
            <button onClick={handleReset}
              className="flex items-center gap-1.5 text-xs border border-border/40 text-muted-foreground hover:text-foreground px-3 py-1.5 rounded transition-colors"
              data-testid="btn-discard-changes">
              <RotateCcw className="w-3 h-3" /> Discard
            </button>
          )}
          <button
            onClick={() => saveMut.mutate()}
            disabled={!hasDirty || saveMut.isPending || !isManagement}
            data-testid="btn-update-config"
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

      {/* Category tab bar */}
      <div className="flex items-center border-b border-border/40 px-6 gap-0">
        {CATEGORIES.map(cat => (
          <button key={cat.key} onClick={() => handleTabChange(cat.key)}
            data-testid={`tab-${cat.key}`}
            className={cn(
              "text-xs px-4 py-2.5 border-b-2 transition-colors whitespace-nowrap",
              activeTab === cat.key
                ? "border-amber-400 text-amber-400 font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}>
            {cat.label}
          </button>
        ))}
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3 px-6 py-2.5 border-b border-border/30 bg-muted/5">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/50" />
          <input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Filter configuration…"
            data-testid="input-config-filter"
            className="w-full pl-7 pr-3 py-1.5 text-xs bg-background border border-border/40 rounded focus:outline-none focus:ring-1 focus:ring-amber-500/40"
          />
        </div>
        <button
          onClick={() => qc.invalidateQueries({ queryKey: ["/api/configuration-values", activeTab] })}
          className="text-muted-foreground hover:text-foreground transition-colors"
          data-testid="btn-refresh-config">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
        {!isManagement && (
          <span className="text-[10px] text-muted-foreground/60 italic">Read-only — management access required to edit</span>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center gap-2 justify-center py-16 text-xs text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="text-center py-20 text-xs text-muted-foreground">
            {filter
              ? `No configuration values match "${filter}".`
              : `No configuration values in the ${CATEGORIES.find(c => c.key === activeTab)?.label} category yet.`}
          </div>
        ) : (
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-border/50 bg-muted/20 sticky top-0">
                <th className="text-left py-2.5 px-4 font-medium text-muted-foreground">Configuration</th>
                <th className="text-left py-2.5 px-4 font-medium text-muted-foreground w-24">Unit</th>
                <th className="text-right py-2.5 px-4 font-medium text-muted-foreground">Value</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map(row => {
                const isDirty = row.id in drafts;
                const draft = drafts[row.id];
                return (
                  <tr key={row.id}
                    data-testid={`row-config-${row.id}`}
                    className={cn(
                      "border-b border-border/20 transition-colors",
                      isDirty ? "bg-amber-500/[0.04]" : "hover:bg-muted/10",
                    )}>
                    <td className="py-2.5 px-4">
                      <div className="flex flex-col gap-0.5">
                        <span className={cn("font-medium", !row.isEditable && "text-muted-foreground/60")}>
                          {row.label}
                          {!row.isEditable && <span className="ml-1.5 text-[9px] text-muted-foreground/40 uppercase tracking-wide">read-only</span>}
                        </span>
                        {row.description && (
                          <span className="text-[10px] text-muted-foreground/60 leading-tight">{row.description}</span>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 px-4 text-muted-foreground">
                      {row.unit || <span className="opacity-30">—</span>}
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="flex items-center justify-end gap-2">
                        {isDirty && (
                          <span className="text-[9px] text-amber-400 font-medium uppercase tracking-wide">modified</span>
                        )}
                        {renderValueInput(row, draft, (v) => handleChange(row.id, v), !isManagement)}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

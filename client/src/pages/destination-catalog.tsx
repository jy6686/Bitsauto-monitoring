import { useState, useMemo, useCallback, useRef } from "react";
import * as XLSX from "xlsx";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Globe, Search, ChevronRight, ChevronDown, Plus, Check, X, Shield,
  TrendingUp, Upload, RefreshCw, AlertTriangle, BarChart2, Phone,
  Edit2, Trash2, CheckCircle2, XCircle, Clock, Layers, MapPin, FileText,
  Flag, Building2, BookOpen, Filter, Download, Link2, FileSpreadsheet,
  Clipboard, Eye, Loader2, WifiOff, SkipForward,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────
interface Dest {
  id: number; parentId: number | null; level: number; name: string;
  countryCode: string | null; dialPrefix: string | null; operatorName: string | null;
  commercialStatus: string; blockedReason: string | null; notes: string | null;
  sortOrder: number | null; createdAt: string;
}
interface DestRateBilling {
  id: number; product_prefix: string; product_code: string | null; product_name: string | null;
  interval_1: number; interval_n: number; grace_period: number; free_seconds: number;
  connect_fee: string; buy_rate: string | null; sell_rate: string | null;
  approval_status: string; updated_at: string | null;
}
interface TreeNode extends Dest { children: TreeNode[]; }
type TabId = "catalog" | "approvals" | "intel" | "import" | "gds";

// ── Constants ──────────────────────────────────────────────────────────────────
const TABS: { id: TabId; label: string; icon: any }[] = [
  { id: "catalog",   label: "Destination Catalog", icon: Globe      },
  { id: "approvals", label: "Approvals",            icon: Shield     },
  { id: "gds",       label: "GDS Rates",            icon: BarChart2  },
  { id: "intel",     label: "Market Intel",         icon: TrendingUp },
  { id: "import",    label: "Bulk Import",          icon: Upload     },
];

const STATUS_COLORS: Record<string, string> = {
  approved:   "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  blocked:    "bg-rose-500/15    text-rose-400    border-rose-500/30",
  pending:    "bg-amber-500/15   text-amber-400   border-amber-500/30",
  testing:    "bg-blue-500/15    text-blue-400    border-blue-500/30",
  deprecated: "bg-slate-500/15   text-slate-400   border-slate-500/30",
  archived:        "bg-zinc-500/15    text-zinc-400    border-zinc-500/30",
  "pending_review": "bg-orange-500/15  text-orange-400  border-orange-500/30",
};
const STATUS_DOT: Record<string, string> = {
  approved: "bg-emerald-400", blocked: "bg-rose-400", pending: "bg-amber-400",
  testing: "bg-blue-400", deprecated: "bg-slate-500",
};
const LEVEL_LABELS: Record<number, string> = { 1: "Country", 2: "Type", 3: "Operator", 4: "Sub-type" };
const LEVEL_COLORS: Record<number, string> = {
  1: "text-violet-400", 2: "text-blue-400", 3: "text-cyan-400", 4: "text-teal-400",
};

// ── Helpers ────────────────────────────────────────────────────────────────────
function buildTree(nodes: Dest[], parentId: number | null = null): TreeNode[] {
  return nodes
    .filter(n => (n.parentId ?? null) === parentId)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name))
    .map(n => ({ ...n, children: buildTree(nodes, n.id) }));
}
function hasMatch(node: TreeNode, q: string): boolean {
  if (!q) return true;
  const lq = q.toLowerCase();
  if (node.name.toLowerCase().includes(lq)) return true;
  if ((node.dialPrefix ?? "").includes(q)) return true;
  if ((node.operatorName ?? "").toLowerCase().includes(lq)) return true;
  if ((node.countryCode ?? "").toLowerCase().includes(lq)) return true;
  return node.children.some(c => hasMatch(c, q));
}
function getAncestors(nodes: Dest[], id: number): Dest[] {
  const node = nodes.find(n => n.id === id);
  if (!node || !node.parentId) return node ? [node] : [];
  return [...getAncestors(nodes, node.parentId), node];
}

// ── StatusBadge ────────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn("text-xs px-2 py-0.5 rounded border font-medium capitalize", STATUS_COLORS[status] ?? STATUS_COLORS.pending)}>
      {status}
    </span>
  );
}

// ── TreeNodeRow ────────────────────────────────────────────────────────────────
function TreeNodeRow({ node, depth, selectedId, onSelect, searchQuery, expanded, onToggle }: {
  node: TreeNode; depth: number; selectedId: number | null; onSelect: (n: Dest) => void;
  searchQuery: string; expanded: Set<number>; onToggle: (id: number) => void;
}) {
  if (searchQuery && !hasMatch(node, searchQuery)) return null;
  const isExpanded = expanded.has(node.id);
  const hasChildren = node.children.length > 0;
  const isSelected = node.id === selectedId;

  return (
    <>
      <div
        className={cn(
          "flex items-center gap-1.5 py-1 cursor-pointer rounded-md text-sm transition-colors select-none group",
          isSelected ? "bg-primary/15 text-primary" : "hover:bg-muted/50 text-foreground",
        )}
        style={{ paddingLeft: `${6 + depth * 14}px`, paddingRight: "6px" }}
        onClick={() => onSelect(node)}
        data-testid={`dest-tree-node-${node.id}`}
      >
        <button
          className={cn("w-4 h-4 flex items-center justify-center shrink-0 text-muted-foreground hover:text-foreground transition-colors",
            !hasChildren && "invisible")}
          onClick={e => { e.stopPropagation(); onToggle(node.id); }}
        >
          {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </button>
        <div className={cn("w-2 h-2 rounded-full shrink-0 ring-1 ring-black/20", STATUS_DOT[node.commercialStatus] ?? "bg-muted")} />
        <span className="flex-1 truncate text-sm">
          {node.dialPrefix && <span className="font-mono text-xs text-muted-foreground mr-1.5">{node.dialPrefix}</span>}
          {node.name}
        </span>
        {node.level === 1 && node.countryCode && (
          <span className="text-[10px] font-bold text-muted-foreground uppercase opacity-50 shrink-0">{node.countryCode}</span>
        )}
        {hasChildren && (
          <span className="text-[10px] text-muted-foreground opacity-40 shrink-0">{node.children.length}</span>
        )}
      </div>
      {isExpanded && node.children.map(child => (
        <TreeNodeRow key={child.id} node={child} depth={depth + 1}
          selectedId={selectedId} onSelect={onSelect} searchQuery={searchQuery}
          expanded={expanded} onToggle={onToggle} />
      ))}
    </>
  );
}

// ── DestTree (Left Panel) ─────────────────────────────────────────────────────
function DestTree({ nodes, flatNodes, selectedId, onSelect, onAddRoot }: {
  nodes: TreeNode[]; flatNodes: Dest[]; selectedId: number | null;
  onSelect: (n: Dest) => void; onAddRoot: () => void;
}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [expanded, setExpanded] = useState<Set<number>>(() => {
    const s = new Set<number>();
    flatNodes.filter(n => n.level <= 2).forEach(n => s.add(n.id));
    return s;
  });

  const filteredNodes = useMemo(() => {
    if (statusFilter === "all") return nodes;
    function filterByStatus(ns: TreeNode[]): TreeNode[] {
      return ns.flatMap(n => {
        const children = filterByStatus(n.children);
        if (n.commercialStatus === statusFilter || children.length > 0) return [{ ...n, children }];
        return [];
      });
    }
    return filterByStatus(nodes);
  }, [nodes, statusFilter]);

  const toggle = useCallback((id: number) => {
    setExpanded(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }, []);

  const expandAll = () => setExpanded(new Set(flatNodes.map(n => n.id)));
  const collapseAll = () => setExpanded(new Set(flatNodes.filter(n => n.level === 1).map(n => n.id)));

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="p-3 space-y-2 border-b border-border flex-shrink-0">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search destinations, prefix…" className="pl-8 h-8 text-xs"
            data-testid="input-dest-search" />
        </div>
        <div className="flex items-center gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-7 text-xs flex-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="blocked">Blocked</SelectItem>
              <SelectItem value="testing">Testing</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
              <SelectItem value="pending_review">Pending Review</SelectItem>
            </SelectContent>
          </Select>
          <button onClick={expandAll} className="text-xs text-muted-foreground hover:text-foreground transition-colors">+</button>
          <button onClick={collapseAll} className="text-xs text-muted-foreground hover:text-foreground transition-colors">−</button>
        </div>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {filteredNodes.length === 0 && (
          <div className="text-center py-8 text-xs text-muted-foreground">No destinations match</div>
        )}
        {filteredNodes.map(node => (
          <TreeNodeRow key={node.id} node={node} depth={0}
            selectedId={selectedId} onSelect={onSelect} searchQuery={search}
            expanded={expanded} onToggle={toggle} />
        ))}
      </div>

      {/* Add root */}
      <div className="p-3 border-t border-border flex-shrink-0">
        <Button size="sm" variant="outline" className="w-full h-7 text-xs gap-1.5" onClick={onAddRoot}
          data-testid="btn-add-root-dest">
          <Plus className="w-3 h-3" />Add Country
        </Button>
      </div>
    </div>
  );
}

// ── ApprovedList (default right panel) ────────────────────────────────────────
function ApprovedList({ nodes, onSelect }: { nodes: Dest[]; onSelect: (n: Dest) => void }) {
  const approved = nodes.filter(n => n.commercialStatus === "approved");
  const pending  = nodes.filter(n => n.commercialStatus === "pending");
  const blocked  = nodes.filter(n => n.commercialStatus === "blocked");
  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      <div>
        <h2 className="font-semibold text-sm">Commercial Destination Status</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Overview of destinations approved for rate generation, product creation, and customer offers
        </p>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Approved",  value: approved.length, color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
          { label: "Pending",   value: pending.length,  color: "text-amber-400",   bg: "bg-amber-500/10  border-amber-500/20"   },
          { label: "Blocked",   value: blocked.length,  color: "text-rose-400",    bg: "bg-rose-500/10   border-rose-500/20"    },
        ].map(c => (
          <div key={c.label} className={cn("rounded-lg border p-4 text-center", c.bg)}>
            <div className={cn("text-2xl font-bold", c.color)}>{c.value}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{c.label}</div>
          </div>
        ))}
      </div>
      <div>
        <div className="flex items-center gap-2 mb-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <h3 className="text-sm font-semibold text-emerald-400">Approved for Commercial Use</h3>
        </div>
        {approved.length === 0 && (
          <div className="text-xs text-muted-foreground py-4 text-center">No approved destinations yet. Select a destination and click Approve.</div>
        )}
        <div className="space-y-1">
          {approved.map(n => (
            <div key={n.id} onClick={() => onSelect(n)}
              className="flex items-center gap-3 text-sm px-3 py-2 rounded-md hover:bg-muted/50 cursor-pointer transition-colors"
              data-testid={`approved-dest-${n.id}`}>
              <div className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
              <span className="flex-1">{n.name}</span>
              {n.dialPrefix && <span className="font-mono text-xs text-muted-foreground">{n.dialPrefix}</span>}
              <span className="text-xs text-muted-foreground">{LEVEL_LABELS[n.level] ?? `L${n.level}`}</span>
            </div>
          ))}
        </div>
      </div>
      {pending.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-semibold text-amber-400">Awaiting Approval</h3>
          </div>
          <div className="space-y-1">
            {pending.map(n => (
              <div key={n.id} onClick={() => onSelect(n)}
                className="flex items-center gap-3 text-sm px-3 py-2 rounded-md hover:bg-muted/50 cursor-pointer transition-colors">
                <div className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
                <span className="flex-1">{n.name}</span>
                {n.dialPrefix && <span className="font-mono text-xs text-muted-foreground">{n.dialPrefix}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── DestDetail (right panel — node selected) ──────────────────────────────────
function DestDetail({ node, flatNodes, onClose, canApprove }: {
  node: Dest; flatNodes: Dest[]; onClose: () => void; canApprove: boolean;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<Dest>>({});
  const [blockReason, setBlockReason] = useState("");

  const children = flatNodes.filter(n => n.parentId === node.id)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name));
  const ancestors = useMemo(() => getAncestors(flatNodes, node.id), [flatNodes, node.id]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["/api/product-registry/destinations"] });

  const approveMut = useMutation({
    mutationFn: () => apiRequest("POST", `/api/product-registry/destinations/${node.id}/approve`, {}),
    onSuccess: () => { invalidate(); toast({ title: `${node.name} approved` }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const blockMut = useMutation({
    mutationFn: () => apiRequest("POST", `/api/product-registry/destinations/${node.id}/block`, { reason: blockReason }),
    onSuccess: () => { invalidate(); setBlockReason(""); toast({ title: `${node.name} blocked` }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const pendingMut = useMutation({
    mutationFn: () => apiRequest("POST", `/api/product-registry/destinations/${node.id}/set-status`, { status: "pending" }),
    onSuccess: () => { invalidate(); toast({ title: "Reverted to pending" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const saveMut = useMutation({
    mutationFn: (data: Partial<Dest>) => apiRequest("PUT", `/api/product-registry/destinations/${node.id}`, data),
    onSuccess: () => { invalidate(); setEditing(false); toast({ title: "Saved" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const deleteMut = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/product-registry/destinations/${node.id}`),
    onSuccess: () => { invalidate(); onClose(); toast({ title: "Deleted" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const startEdit = () => { setForm({ ...node }); setEditing(true); };

  const F = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="space-y-1"><Label className="text-xs text-muted-foreground">{label}</Label>{children}</div>
  );

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-start gap-3 p-5 border-b border-border flex-shrink-0">
        <div className="flex-1 min-w-0">
          {/* Breadcrumb */}
          <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1.5 flex-wrap">
            {ancestors.slice(0, -1).map((a, i) => (
              <span key={a.id} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="w-3 h-3" />}
                <span>{a.name}</span>
              </span>
            ))}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="font-semibold text-base">{node.name}</h2>
            <span className={cn("text-xs font-medium", LEVEL_COLORS[node.level] ?? "text-muted-foreground")}>
              {LEVEL_LABELS[node.level] ?? `Level ${node.level}`}
            </span>
            <StatusBadge status={node.commercialStatus} />
            <span className={cn("text-xs px-1.5 py-0.5 rounded font-medium",
              readiness === "ready"      ? "text-emerald-400 bg-emerald-500/10" :
              readiness === "review"     ? "text-amber-400 bg-amber-500/10" :
                                           "text-rose-400 bg-rose-500/10"
            )}>
              {readiness === "ready" ? "🟢 Ready" : readiness === "review" ? "🟡 Review" : "🔴 Incomplete"}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {!editing && <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={startEdit} data-testid="btn-edit-dest"><Edit2 className="w-3.5 h-3.5" /></Button>}
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-rose-400" onClick={() => { if (confirm("Delete this destination?")) deleteMut.mutate(); }} data-testid="btn-delete-dest"><Trash2 className="w-3.5 h-3.5" /></Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground" onClick={onClose}><X className="w-3.5 h-3.5" /></Button>
        </div>
      </div>

      <div className="flex-1 p-5 space-y-5">
        {/* Edit form */}
        {editing ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <F label="Name"><Input value={form.name ?? ""} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="h-8 text-sm" /></F>
              <F label="Level">
                <Select value={String(form.level ?? 1)} onValueChange={v => setForm(f => ({ ...f, level: Number(v) }))}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(LEVEL_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </F>
              <F label="Dial Prefix"><Input value={form.dialPrefix ?? ""} onChange={e => setForm(f => ({ ...f, dialPrefix: e.target.value }))} className="h-8 text-sm font-mono" placeholder="e.g. 9230" /></F>
              <F label="Country Code"><Input value={form.countryCode ?? ""} onChange={e => setForm(f => ({ ...f, countryCode: e.target.value }))} className="h-8 text-sm uppercase" placeholder="PK" maxLength={4} /></F>
              <F label="Operator Name"><Input value={form.operatorName ?? ""} onChange={e => setForm(f => ({ ...f, operatorName: e.target.value }))} className="h-8 text-sm" placeholder="Jazz" /></F>
              <F label="Sort Order"><Input type="number" value={form.sortOrder ?? ""} onChange={e => setForm(f => ({ ...f, sortOrder: Number(e.target.value) }))} className="h-8 text-sm" /></F>
            </div>
            <F label="Notes"><Textarea value={form.notes ?? ""} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="text-sm" rows={2} /></F>
            <div className="flex gap-2 pt-1">
              <Button size="sm" onClick={() => saveMut.mutate(form)} disabled={saveMut.isPending} data-testid="btn-save-dest">Save</Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          </div>
        ) : (
          /* Field display */
          <div className="grid grid-cols-2 gap-4 text-sm">
            {[
              { label: "Dial Prefix",   value: node.dialPrefix,   mono: true  },
              { label: "Country Code",  value: node.countryCode,  mono: false },
              { label: "Operator",      value: node.operatorName, mono: false },
              { label: "Level",         value: LEVEL_LABELS[node.level], mono: false },
            ].map(({ label, value, mono }) => (
              <div key={label}>
                <div className="text-xs text-muted-foreground mb-0.5">{label}</div>
                <div className={cn("font-medium", mono ? "font-mono" : "")}>{value ?? <span className="text-muted-foreground italic">—</span>}</div>
              </div>
            ))}
            {node.notes && (
              <div className="col-span-2">
                <div className="text-xs text-muted-foreground mb-0.5">Notes</div>
                <div className="text-sm text-muted-foreground">{node.notes}</div>
              </div>
            )}
            {node.blockedReason && (
              <div className="col-span-2 bg-rose-500/10 border border-rose-500/20 rounded p-2">
                <div className="text-xs text-muted-foreground mb-0.5">Blocked reason</div>
                <div className="text-sm text-rose-400">{node.blockedReason}</div>
              </div>
            )}
          </div>
        )}

        {/* Billing Settings */}
        {!editing && <BillingSettingsPanel destId={node.id} />}

        {/* Approval actions */}
        {!editing && canApprove && (
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Commercial Status</div>
            <div className="flex gap-2 flex-wrap">
              {node.commercialStatus !== "approved" && (
                <>
                  <Button size="sm" className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white h-8"
                    onClick={() => approveMut.mutate()}
                    disabled={approveMut.isPending || !hasName || !hasRates || !hasBilling}
                    title={!hasName ? "Name required" : !hasRates ? "Product rates required" : !hasBilling ? "Fix billing (0/0 invalid)" : undefined}
                    data-testid="btn-approve-dest">
                    <Check className="w-3.5 h-3.5" />Approve
                  </Button>
                  {(!hasRates || !hasBilling) && (
                    <span className="text-xs text-amber-400 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      {!hasRates ? "Add product rates to enable approval" : "Fix 0/0 billing to enable approval"}
                    </span>
                  )}
                </>
              )}
              {node.commercialStatus !== "pending" && (
                <Button size="sm" variant="outline" className="gap-1.5 h-8"
                  onClick={() => pendingMut.mutate()} disabled={pendingMut.isPending}>
                  <Clock className="w-3.5 h-3.5" />Set Pending
                </Button>
              )}
              {node.commercialStatus !== "blocked" && (
                <Button size="sm" variant="outline" className="gap-1.5 h-8 border-rose-500/30 text-rose-400 hover:bg-rose-500/10"
                  onClick={() => blockMut.mutate()} disabled={blockMut.isPending} data-testid="btn-block-dest">
                  <XCircle className="w-3.5 h-3.5" />Block
                </Button>
              )}
              {node.commercialStatus !== "archived" && (
                <Button size="sm" variant="outline" className="gap-1.5 h-8 border-zinc-500/30 text-zinc-400 hover:bg-zinc-500/10"
                  onClick={() => pendingMut.mutate && apiRequest("POST", `/api/product-registry/destinations/${node.id}/set-status`, { status: "archived" }).then(() => { qc.invalidateQueries({ queryKey: ["/api/product-registry/destinations"] }); toast({ title: "Archived" }); })}
                  data-testid="btn-archive-dest">
                  <Layers className="w-3.5 h-3.5" />Archive
                </Button>
              )}
            </div>
            {node.commercialStatus !== "blocked" && (
              <div className="flex gap-2">
                <Input value={blockReason} onChange={e => setBlockReason(e.target.value)}
                  placeholder="Block reason (optional)…" className="h-7 text-xs flex-1" />
              </div>
            )}
          </div>
        )}

        {/* Children */}
        {children.length > 0 && (
          <div>
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
              Sub-destinations ({children.length})
            </div>
            <div className="space-y-1">
              {children.map(c => (
                <div key={c.id} className="flex items-center gap-2 text-sm px-2 py-1.5 rounded hover:bg-muted/40 cursor-pointer">
                  <div className={cn("w-2 h-2 rounded-full shrink-0", STATUS_DOT[c.commercialStatus] ?? "bg-muted")} />
                  {c.dialPrefix && <span className="font-mono text-xs text-muted-foreground">{c.dialPrefix}</span>}
                  <span className="flex-1">{c.name}</span>
                  <StatusBadge status={c.commercialStatus} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── AddForm (right panel — creating new) ──────────────────────────────────────
function AddForm({ parentNode, onCancel }: { parentNode: Dest | null; onClose: () => void; onCancel: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState<Partial<Dest>>({
    level: parentNode ? (parentNode.level + 1) : 1,
    parentId: parentNode?.id ?? null,
    commercialStatus: "pending",
  });

  const saveMut = useMutation({
    mutationFn: (data: Partial<Dest>) => apiRequest("POST", "/api/product-registry/destinations", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/product-registry/destinations"] });
      toast({ title: "Destination added" });
      onCancel();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const F = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="space-y-1"><Label className="text-xs text-muted-foreground">{label}</Label>{children}</div>
  );

  return (
    <div className="p-5 space-y-4">
      <div>
        <h3 className="font-semibold text-sm">
          {parentNode ? `Add under "${parentNode.name}"` : "Add Country (Level 1)"}
        </h3>
        {parentNode && (
          <p className="text-xs text-muted-foreground mt-0.5">
            This will be a Level {(parentNode.level + 1)} ({LEVEL_LABELS[parentNode.level + 1] ?? "Sub-type"}) destination
          </p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <F label="Name *"><Input value={form.name ?? ""} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="h-8 text-sm" placeholder={parentNode?.level === 1 ? "Mobile" : parentNode?.level === 2 ? "Jazz" : "Destination name"} /></F>
        <F label="Dial Prefix"><Input value={form.dialPrefix ?? ""} onChange={e => setForm(f => ({ ...f, dialPrefix: e.target.value }))} className="h-8 text-sm font-mono" placeholder="9230" /></F>
        {!parentNode && (
          <F label="Country Code"><Input value={form.countryCode ?? ""} onChange={e => setForm(f => ({ ...f, countryCode: e.target.value }))} className="h-8 text-sm uppercase" placeholder="PK" maxLength={4} /></F>
        )}
        <F label="Operator Name"><Input value={form.operatorName ?? ""} onChange={e => setForm(f => ({ ...f, operatorName: e.target.value }))} className="h-8 text-sm" placeholder="Jazz" /></F>
        <F label="Status">
          <Select value={form.commercialStatus ?? "pending"} onValueChange={v => setForm(f => ({ ...f, commercialStatus: v }))}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="testing">Testing</SelectItem>
              <SelectItem value="blocked">Blocked</SelectItem>
            </SelectContent>
          </Select>
        </F>
      </div>
      <F label="Notes"><Textarea value={form.notes ?? ""} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="text-sm" rows={2} placeholder="Trader notes…" /></F>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => saveMut.mutate(form)} disabled={saveMut.isPending || !form.name} data-testid="btn-save-new-dest">Add Destination</Button>
        <Button size="sm" variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

// ── BillingSettingsPanel ──────────────────────────────────────────────────────
function BillingSettingsPanel({ destId }: { destId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: rates = [], isLoading } = useQuery<DestRateBilling[]>({
    queryKey: [`/api/destination-catalog/product-rates/by-destination/${destId}`],
  });
  const [editRow, setEditRow] = useState<Record<number, { billing: string; grace: string; free: string; connect: string }>>({});
  const saveMut = useMutation({
    mutationFn: ({ id, billing, grace, free, connect }: any) => {
      const parts = String(billing).split("/");
      const i1 = parseInt(parts[0]) || 1;
      const iN = parseInt(parts[1]) || 1;
      return apiRequest("PATCH", `/api/destination-catalog/product-rates/${id}`, {
        interval_1: i1, interval_n: iN,
        grace_period: parseInt(grace) || 0,
        free_seconds: parseInt(free) || 0,
        connect_fee: parseFloat(connect) || 0,
      });
    },
    onSuccess: (_: any, vars: any) => {
      qc.invalidateQueries({ queryKey: [`/api/destination-catalog/product-rates/by-destination/${destId}`] });
      setEditRow(prev => { const n = { ...prev }; delete n[vars.id]; return n; });
      toast({ title: "Billing saved" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const startEdit = (r: DestRateBilling) => setEditRow(prev => ({
    ...prev,
    [r.id]: {
      billing: `${r.interval_1}/${r.interval_n}`,
      grace: String(r.grace_period),
      free: String(r.free_seconds),
      connect: parseFloat(r.connect_fee as any || "0").toFixed(6),
    }
  }));
  if (isLoading) return <div className="text-xs text-muted-foreground py-2">Loading billing settings…</div>;
  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Billing Settings</div>
      {rates.length === 0 ? (
        <div className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded px-3 py-2 flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          No product rates configured — destination cannot be approved without billing settings.
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-muted/30 border-b border-border">
              <tr>
                {["Product", "Billing", "Grace (s)", "Free Sec", "Connect Fee", ""].map(h => (
                  <th key={h} className="text-left py-2 px-3 font-medium text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rates.map(r => {
                const isEditing = !!editRow[r.id];
                const ev = editRow[r.id];
                const billingStr = `${r.interval_1}/${r.interval_n}`;
                const isInvalid = r.interval_1 === 0 || r.interval_n === 0;
                return (
                  <tr key={r.id} className="border-b border-border/40 last:border-0">
                    <td className="py-2 px-3">
                      <span className="font-medium">{r.product_code ?? r.product_prefix}</span>
                      {r.product_name && <span className="text-muted-foreground ml-1.5 text-[11px]">{r.product_name}</span>}
                    </td>
                    {isEditing ? (
                      <>
                        <td className="py-1.5 px-3"><Input value={ev.billing} onChange={e => setEditRow(p => ({...p, [r.id]: {...p[r.id], billing: e.target.value}}))} className="h-6 w-16 text-xs font-mono" placeholder="60/1" /></td>
                        <td className="py-1.5 px-3"><Input type="number" min="0" value={ev.grace} onChange={e => setEditRow(p => ({...p, [r.id]: {...p[r.id], grace: e.target.value}}))} className="h-6 w-14 text-xs" /></td>
                        <td className="py-1.5 px-3"><Input type="number" min="0" value={ev.free} onChange={e => setEditRow(p => ({...p, [r.id]: {...p[r.id], free: e.target.value}}))} className="h-6 w-14 text-xs" /></td>
                        <td className="py-1.5 px-3"><Input type="number" step="0.000001" min="0" value={ev.connect} onChange={e => setEditRow(p => ({...p, [r.id]: {...p[r.id], connect: e.target.value}}))} className="h-6 w-20 text-xs" /></td>
                        <td className="py-1.5 px-3">
                          <div className="flex gap-1">
                            <Button size="sm" className="h-6 px-2 text-xs" onClick={() => saveMut.mutate({ id: r.id, ...ev })} disabled={saveMut.isPending}>Save</Button>
                            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setEditRow(p => { const n = {...p}; delete n[r.id]; return n; })}>✕</Button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className={cn("py-2 px-3 font-mono font-medium", isInvalid ? "text-rose-400" : "")}>{billingStr}</td>
                        <td className="py-2 px-3 text-muted-foreground">{r.grace_period}s</td>
                        <td className="py-2 px-3 text-muted-foreground">{r.free_seconds}s</td>
                        <td className="py-2 px-3 font-mono text-muted-foreground">${parseFloat(r.connect_fee as any || "0").toFixed(6)}</td>
                        <td className="py-2 px-3">
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground" onClick={() => startEdit(r)}>Edit</Button>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── CatalogTab ────────────────────────────────────────────────────────────────
function CatalogTab({ flatNodes }: { flatNodes: Dest[] }) {
  const { canApprove } = useAuth() as any;
  const canApproveDestination = canApprove ?? true;
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [addingUnder, setAddingUnder] = useState<Dest | null | "root">("none" as any);
  const [creating, setCreating] = useState(false);
  const [createParent, setCreateParent] = useState<Dest | null>(null);

  const tree = useMemo(() => buildTree(flatNodes), [flatNodes]);
  const selected = flatNodes.find(n => n.id === selectedId) ?? null;

  const handleSelect = (n: Dest) => { setSelectedId(n.id); setCreating(false); };
  const handleAddRoot = () => { setCreateParent(null); setCreating(true); setSelectedId(null); };
  const handleClose = () => setSelectedId(null);

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left panel — tree */}
      <div className="w-80 xl:w-96 border-r border-border flex-shrink-0 flex flex-col bg-background/50">
        <DestTree nodes={tree} flatNodes={flatNodes} selectedId={selectedId} onSelect={handleSelect} onAddRoot={handleAddRoot} />
      </div>

      {/* Right panel */}
      <div className="flex-1 min-w-0 overflow-hidden">
        {creating ? (
          <AddForm parentNode={createParent} onClose={() => setCreating(false)} onCancel={() => setCreating(false)} />
        ) : selected ? (
          <DestDetail node={selected} flatNodes={flatNodes} onClose={handleClose} canApprove={canApproveDestination} />
        ) : (
          <ApprovedList nodes={flatNodes} onSelect={handleSelect} />
        )}
      </div>
    </div>
  );
}

// ── ApprovalsTab ──────────────────────────────────────────────────────────────
function ApprovalsTab({ flatNodes }: { flatNodes: Dest[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const pending = flatNodes.filter(n => n.commercialStatus === "pending");
  const blocked = flatNodes.filter(n => n.commercialStatus === "blocked");

  const approveMut = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/product-registry/destinations/${id}/approve`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/product-registry/destinations"] }); toast({ title: "Approved" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const blockMut = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/product-registry/destinations/${id}/block`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/product-registry/destinations"] }); toast({ title: "Blocked" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const pendingMut = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/product-registry/destinations/${id}/set-status`, { status: "pending" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/product-registry/destinations"] }); toast({ title: "Reverted to pending" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const Row = ({ n, actions }: { n: Dest; actions: React.ReactNode }) => (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-border/50 hover:bg-muted/20 text-sm">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium">{n.name}</span>
          <span className="text-xs text-muted-foreground">{LEVEL_LABELS[n.level] ?? `L${n.level}`}</span>
          {n.dialPrefix && <span className="font-mono text-xs text-muted-foreground">{n.dialPrefix}</span>}
        </div>
        {n.blockedReason && <div className="text-xs text-rose-400 mt-0.5">Blocked: {n.blockedReason}</div>}
        {n.notes && <div className="text-xs text-muted-foreground mt-0.5">{n.notes}</div>}
      </div>
      <div className="flex gap-2 shrink-0">{actions}</div>
    </div>
  );

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      <div>
        <h2 className="font-semibold">Destination Approval Queue</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Approve or block destinations for commercial use across products, rate cards, and routing
        </p>
      </div>
      {/* Bulk Actions */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2 bg-muted/30">
          <RefreshCw className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-muted-foreground">Bulk Actions</h3>
        </div>
        <div className="px-4 py-4 flex items-center gap-4">
          <div className="flex-1">
            <div className="text-sm font-medium">Reset All Approved → Pending</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Moves all currently-approved destinations back to Pending for re-validation.
              This does not affect rates or push history.
            </div>
          </div>
          <Button size="sm" variant="outline" className="gap-1.5 shrink-0 border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
            onClick={() => {
              if (!confirm(`Reset ALL approved destinations to Pending?\n\nThis will move every approved destination back into the review queue. Rates and push history are unaffected.`)) return;
              apiRequest("POST", "/api/product-registry/destinations/bulk-reset", { from_status: "approved", to_status: "pending" })
                .then(r => r.json()).then((d: any) => {
                  qc.invalidateQueries({ queryKey: ["/api/product-registry/destinations"] });
                  toast({ title: `Reset complete`, description: `${d.reset} destinations moved to Pending` });
                }).catch((e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }));
            }}
          >
            <RefreshCw className="w-3.5 h-3.5" />Reset to Pending
          </Button>
        </div>
      </div>

      {/* Pending */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2 bg-amber-500/5">
          <Clock className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-semibold text-amber-400">Pending Approval ({pending.length})</h3>
        </div>
        {pending.length === 0 && <div className="px-4 py-6 text-center text-xs text-muted-foreground">No pending destinations</div>}
        {pending.map(n => (
          <Row key={n.id} n={n} actions={<>
            <Button size="sm" className="h-7 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => approveMut.mutate(n.id)} disabled={approveMut.isPending} data-testid={`btn-approve-${n.id}`}>
              <Check className="w-3 h-3" />Approve
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1 border-rose-500/30 text-rose-400 hover:bg-rose-500/10"
              onClick={() => blockMut.mutate(n.id)} disabled={blockMut.isPending} data-testid={`btn-block-${n.id}`}>
              <XCircle className="w-3 h-3" />Block
            </Button>
          </>} />
        ))}
      </div>
      {/* Blocked */}
      {blocked.length > 0 && (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2 bg-rose-500/5">
            <XCircle className="w-4 h-4 text-rose-400" />
            <h3 className="text-sm font-semibold text-rose-400">Blocked ({blocked.length})</h3>
          </div>
          {blocked.map(n => (
            <Row key={n.id} n={n} actions={
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                onClick={() => pendingMut.mutate(n.id)} disabled={pendingMut.isPending}>
                <RefreshCw className="w-3 h-3" />Re-review
              </Button>
            } />
          ))}
        </div>
      )}
    </div>
  );
}

// ── MarketIntelTab ────────────────────────────────────────────────────────────
function MarketIntelTab({ flatNodes }: { flatNodes: Dest[] }) {
  const [search, setSearch] = useState("");
  const [levelFilter, setLevelFilter] = useState("all");
  const { data: productRates = [] } = useQuery({ queryKey: ["/api/destination-catalog/product-rates"] });
  const rateByDest = useMemo(() => { const m = new Map(); for (const r of productRates) { if (r.approval_status !== "approved") continue; const key = r.dest_name_live ?? r.destination_name ?? ""; if (!key) continue; const buy = r.buy_rate ? parseFloat(r.buy_rate) : null; const sell = r.sell_rate ? parseFloat(r.sell_rate) : null; if (!m.has(key)) { m.set(key, { buy, sell }); } else { const ex = m.get(key); if (buy !== null && (ex.buy === null || buy < ex.buy)) ex.buy = buy; if (sell !== null && (ex.sell === null || sell < ex.sell)) ex.sell = sell; } } return m; }, [productRates]);
  const approved = flatNodes.filter(n => n.commercialStatus === "approved");
  const filtered = approved.filter(n => {
    const ok = levelFilter === "all" || String(n.level) === levelFilter;
    const sq = search.toLowerCase();
    const match = !sq || n.name.toLowerCase().includes(sq) || (n.dialPrefix ?? "").includes(sq) || (n.operatorName ?? "").toLowerCase().includes(sq);
    return ok && match;
  });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border flex-shrink-0">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" className="pl-8 h-8 text-xs" />
        </div>
        <Select value={levelFilter} onValueChange={setLevelFilter}>
          <SelectTrigger className="h-8 text-xs w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All levels</SelectItem>
            {Object.entries(LEVEL_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground ml-auto">{filtered.length} destinations</span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-border bg-muted/30">
              {["Destination", "Level", "Prefix", "Country", "Operator", "Vendor Cost", "Sell Rate", "Margin", "Notes"].map(h => (
                <th key={h} className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={9} className="text-center py-8 text-xs text-muted-foreground">No approved destinations match your filters</td></tr>
            )}
            {filtered.map(n => (
              <tr key={n.id} className="border-b border-border/40 hover:bg-muted/20">
                <td className="py-2.5 px-4 font-medium">{n.name}</td>
                <td className="py-2.5 px-4">
                  <span className={cn("text-xs font-medium", LEVEL_COLORS[n.level] ?? "text-muted-foreground")}>{LEVEL_LABELS[n.level] ?? `L${n.level}`}</span>
                </td>
                <td className="py-2.5 px-4 font-mono text-xs text-muted-foreground">{n.dialPrefix ?? "—"}</td>
                <td className="py-2.5 px-4 text-xs uppercase text-muted-foreground">{n.countryCode ?? "—"}</td>
                <td className="py-2.5 px-4 text-muted-foreground">{n.operatorName ?? "—"}</td>
                <td className="py-2.5 px-4 text-muted-foreground italic text-xs">Coming soon</td>
                <td className="py-2.5 px-4 text-muted-foreground italic text-xs">Coming soon</td>
                <td className="py-2.5 px-4 text-muted-foreground italic text-xs">—</td>
                <td className="py-2.5 px-4 text-xs text-muted-foreground max-w-[160px] truncate">{n.notes ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── ImportTab ─────────────────────────────────────────────────────────────────
interface PreviewRow {
  name: string; dialPrefix: string | null; countryCode: string | null;
  countryName?: string; operatorName: string | null; operatorCategory?: string;
  level: number; rate?: number | null; _status: "new" | "exists" | "invalid"; _reason?: string;
}

function detectFormat(lines: string[]): "legacy" | "new" {
  const header = lines[0]?.toLowerCase() ?? "";
  if (header.includes("carrier") || header.includes("category") || (header.includes("country") && header.includes("code") && !header.includes("level"))) return "legacy";
  return "new";
}

function parseLegacyRow(line: string): Omit<PreviewRow, "_status"> | null {
  const parts = line.split(",").map(s => s.trim());
  if (parts.length < 5) return null;
  const [country, carrier, category, destination, code, rateStr] = parts;
  if (!code || !country || code.length < 3) return null;
  const rate = rateStr ? parseFloat(rateStr) : null;
  return {
    name: `${country} ${carrier || destination}`.trim(),
    dialPrefix: code, countryCode: null, countryName: country,
    operatorName: carrier || destination, operatorCategory: category || "Mobile",
    level: 3, rate,
  };
}

function parseNewRow(line: string): Omit<PreviewRow, "_status"> | null {
  const [name, dialPrefix, countryCode, operatorName, levelStr] = line.split(",").map(s => s.trim());
  if (!name) return null;
  const level = levelStr ? parseInt(levelStr) : (dialPrefix ? 3 : 1);
  return { name, dialPrefix: dialPrefix || null, countryCode: countryCode || null, operatorName: operatorName || null, level };
}

function ImportTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Input mode
  const [inputMode, setInputMode] = useState<"paste" | "file">("paste");
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  // Options
  const [autoApprove, setAutoApprove] = useState(false);
  const [autoParent, setAutoParent] = useState(true);

  // Preview
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [parsed, setParsed] = useState(false);
  const [detectedFormat, setDetectedFormat] = useState<"legacy" | "new">("new");

  // Legacy BitsAuto sync
  const [showLegacy, setShowLegacy] = useState(false);
  const [legacyHost, setLegacyHost] = useState("23.106.59.17:8081");
  const [legacySessionCookie, setLegacySessionCookie] = useState("");
  const [legacyClientId, setLegacyClientId] = useState("1824");
  const [legacyMaxPages, setLegacyMaxPages] = useState("10");
  const [syncing, setSyncing] = useState(false);
  const [legacyDebugHtml, setLegacyDebugHtml] = useState("");

  const loadFileContent = (file: File) => {
    setFileName(file.name);
    if (file.name.endsWith(".csv") || file.name.endsWith(".txt")) {
      const reader = new FileReader();
      reader.onload = e => { setCsv(e.target?.result as string ?? ""); setParsed(false); };
      reader.readAsText(file);
    } else if (file.name.endsWith(".xlsx") || file.name.endsWith(".xls")) {
      const reader = new FileReader();
      reader.onload = e => {
        const wb = XLSX.read(e.target?.result, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const csvData = XLSX.utils.sheet_to_csv(ws);
        setCsv(csvData); setParsed(false);
      };
      reader.readAsArrayBuffer(file);
    } else {
      toast({ title: "Unsupported file type", description: "Please use .csv, .xlsx, or .xls", variant: "destructive" });
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) loadFileContent(file);
  };

  const parse = () => {
    const lines = csv.trim().split("\n").filter(l => l.trim() && !l.startsWith("#"));
    if (lines.length === 0) return;
    const fmt = detectFormat(lines);
    setDetectedFormat(fmt);
    const dataLines = fmt === "legacy" ? lines.slice(1) : lines; // skip header for legacy
    const rows: PreviewRow[] = dataLines.map(line => {
      const parsed = fmt === "legacy" ? parseLegacyRow(line) : parseNewRow(line);
      if (!parsed) return null;
      return { ...parsed, _status: "new" as const };
    }).filter(Boolean) as PreviewRow[];
    setPreview(rows);
    setParsed(true);
  };

  const importMut = useMutation({
    mutationFn: async () => {
      const toImport = preview.filter(r => r._status === "new");
      const rawRes = await apiRequest("POST", "/api/product-registry/destinations/bulk-smart", {
        rows: toImport, autoApprove, autoParent,
      });
      return rawRes.json() as any;
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["/api/product-registry/destinations"] });
      toast({
        title: `Import complete`,
        description: `${data.created} created · ${data.skipped} skipped · ${data.failed} invalid`,
      });
      // Update preview rows with server response statuses
      if (data.results) {
        const newPreview = preview.map((r, i) => {
          const srv = data.results[i];
          if (!srv) return r;
          return { ...r, _status: srv._status === "created" ? "new" : srv._status === "exists" ? "exists" : "invalid" } as PreviewRow;
        });
        setPreview(newPreview);
      }
    },
    onError: (e: any) => toast({ title: "Import failed", description: e.message, variant: "destructive" }),
  });

  const handleLegacySync = async () => {
    if (!legacySessionCookie.trim()) { toast({ title: "Paste your BitsAuto session cookie first", variant: "destructive" }); return; }
    setSyncing(true);
    try {
      const rawRes = await apiRequest("POST", "/api/product-registry/destinations/sync-legacy", {
        host: legacyHost, sessionCookie: legacySessionCookie.trim(), clientId: legacyClientId, maxPages: parseInt(legacyMaxPages) || 10,
      });
      const res = await rawRes.json() as any;
      if (res.error) throw new Error(res.error);
      const mappedRows: PreviewRow[] = (res.rows ?? []).map((r: any) => ({
        name: r.name, dialPrefix: r.dialPrefix, countryCode: r.countryCode,
        countryName: r.countryName, operatorName: r.operatorName, operatorCategory: r.operatorCategory,
        level: r.level ?? 3, rate: r.rate, _status: "new" as const,
      }));
      setPreview(mappedRows);
      setParsed(true);
      setDetectedFormat("legacy");
      if (mappedRows.length === 0 && res._debug) {
        const d = res._debug;
        setLegacyDebugHtml(`HTTP ${d.status} — URL: ${d.url}\nHTML length: ${d.htmlLength} chars\n\n${d.html}`);
        toast({ title: "Synced 0 rows — debug info below", description: `HTTP ${d.status} · ${d.htmlLength} chars received`, variant: "destructive" });
      } else {
        setLegacyDebugHtml("");
        const pagesInfo = res.pagesScanned && res.totalPages
          ? ` (${res.pagesScanned}/${res.totalPages} pages, ${Math.round((res.elapsedMs ?? 0) / 1000)}s)`
          : "";
        const partialNote = res.partial ? " — partial (hit time limit)" : "";
        toast({ title: `Synced ${mappedRows.length} unique rows from legacy BitsAuto${pagesInfo}${partialNote}` });
      }
    } catch (e: any) {
      toast({ title: "Sync failed", description: e.message, variant: "destructive" });
    } finally { setSyncing(false); }
  };

  const newCount    = preview.filter(r => r._status === "new").length;
  const existsCount = preview.filter(r => r._status === "exists").length;
  const invalidCount = preview.filter(r => r._status === "invalid").length;

  return (
    <div className="p-6 space-y-5 overflow-y-auto h-full max-w-3xl">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="font-semibold">Bulk Import Destinations</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Upload a CSV / Excel file, paste data, or sync directly from Legacy BitsAuto.</p>
        </div>
        <Button size="sm" variant={showLegacy ? "default" : "outline"} onClick={() => setShowLegacy(v => !v)} data-testid="btn-toggle-legacy">
          <Link2 className="w-3.5 h-3.5 mr-1.5" />Legacy BitsAuto Sync
        </Button>
      </div>

      {/* ── Legacy BitsAuto Sync Panel ── */}
      {showLegacy && (
        <div className="bg-card border border-border rounded-lg p-4 space-y-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Link2 className="w-4 h-4 text-cyan-400" />
            <span>Sync from Legacy BitsAuto</span>
            <span className="text-xs text-muted-foreground font-normal ml-1">— 2FA-compatible session cookie method</span>
          </div>

          {/* Step-by-step instructions */}
          <div className="bg-muted/30 border border-border/60 rounded-md p-3 space-y-2">
            <p className="text-xs font-semibold text-foreground">How to get your session cookie:</p>
            <ol className="text-xs text-muted-foreground space-y-1 list-none">
              <li className="flex gap-2"><span className="text-cyan-400 font-bold shrink-0">1.</span><span>Open BitsAuto in your browser and log in normally (including 2FA).</span></li>
              <li className="flex gap-2"><span className="text-cyan-400 font-bold shrink-0">2.</span><span>Press <kbd className="bg-muted border border-border rounded px-1 py-0.5 text-[10px] font-mono">F12</kbd> to open DevTools → go to <strong>Application</strong> tab → <strong>Cookies</strong> → select the BitsAuto site.</span></li>
              <li className="flex gap-2"><span className="text-cyan-400 font-bold shrink-0">3.</span><span>Find the cookie named <code className="bg-muted px-1 rounded font-mono text-[10px]">sessionid</code> and copy its <strong>Value</strong>.</span></li>
              <li className="flex gap-2"><span className="text-cyan-400 font-bold shrink-0">4.</span><span>Paste the value below and click <strong>Sync Now</strong>.</span></li>
            </ol>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Host:Port</Label>
              <Input value={legacyHost} onChange={e => setLegacyHost(e.target.value)} className="h-8 text-sm font-mono" placeholder="23.106.59.17:8081" data-testid="input-legacy-host" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Client ID</Label>
              <Input value={legacyClientId} onChange={e => setLegacyClientId(e.target.value)} className="h-8 text-sm font-mono" placeholder="1824" data-testid="input-legacy-clientid" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Max Pages</Label>
              <Input value={legacyMaxPages} onChange={e => setLegacyMaxPages(e.target.value)} className="h-8 text-sm font-mono" placeholder="10" type="number" min="1" max="858" data-testid="input-legacy-maxpages" />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
              Session Cookie Value
              <span className="text-[10px] bg-amber-500/15 text-amber-400 border border-amber-500/30 rounded px-1.5 py-0.5">required</span>
            </Label>
            <Input
              value={legacySessionCookie}
              onChange={e => setLegacySessionCookie(e.target.value)}
              className="h-8 text-sm font-mono"
              placeholder="Paste sessionid value here (e.g. abc123xyz…)"
              autoComplete="off"
              data-testid="input-legacy-session-cookie"
            />
            <p className="text-[10px] text-muted-foreground">
              You can also paste the full cookie string e.g. <code className="bg-muted px-1 rounded">sessionid=abc123; csrftoken=xyz</code>
            </p>
          </div>

          <Button size="sm" onClick={handleLegacySync} disabled={syncing || !legacySessionCookie.trim()} data-testid="btn-legacy-sync">
            {syncing ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
            {syncing ? "Syncing…" : "Sync Now"}
          </Button>

          {/* Debug HTML panel — shown only when 0 rows returned */}
          {legacyDebugHtml && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-amber-400 flex items-center gap-1.5">
                <span>⚠ 0 rows parsed — raw page HTML (first 4000 chars)</span>
                <button className="text-[10px] text-muted-foreground underline ml-auto" onClick={() => setLegacyDebugHtml("")}>dismiss</button>
              </p>
              <p className="text-[10px] text-muted-foreground">Copy the snippet below and share it so the parser can be fixed to match the actual page structure.</p>
              <textarea
                readOnly
                value={legacyDebugHtml}
                className="w-full h-40 text-[10px] font-mono bg-black/40 border border-border rounded p-2 resize-y text-muted-foreground"
                onClick={e => (e.target as HTMLTextAreaElement).select()}
                data-testid="debug-legacy-html"
              />
            </div>
          )}
        </div>
      )}

      {/* ── Input Mode Tabs ── */}
      <div className="flex gap-1 border-b border-border pb-0">
        {(["paste", "file"] as const).map(m => (
          <button key={m} onClick={() => setInputMode(m)}
            className={cn("flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-t-md border border-b-0 transition-colors",
              inputMode === m ? "bg-card border-border text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            )}>
            {m === "paste" ? <Clipboard className="w-3.5 h-3.5" /> : <FileSpreadsheet className="w-3.5 h-3.5" />}
            {m === "paste" ? "Paste CSV" : "Upload File"}
          </button>
        ))}
      </div>

      {inputMode === "paste" ? (
        <div className="space-y-2">
          <div className="bg-muted/20 border border-border rounded p-3 text-xs font-mono text-muted-foreground space-y-0.5">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-foreground font-semibold text-xs">Format A — New platform</span>
              <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded">Name, DialPrefix, CountryCode, OperatorName, Level</span>
            </div>
            <div>Pakistan,,PK,,1</div>
            <div>Pakistan Mobile,,PK,,2</div>
            <div>Pakistan Jazz,9230,PK,Jazz,3</div>
            <div className="border-t border-border/50 mt-2 pt-2 text-foreground font-semibold text-xs">Format B — Legacy BitsAuto export</div>
            <div className="text-[10px] mt-0.5 mb-1">Country, Carrier, Category, Destination, Code, Rate</div>
            <div>Pakistan,UFONE,MOBILE,,9233,0.02650</div>
            <div>Pakistan,ZONG,MOBILE,,9231,0.02700</div>
          </div>
          <Textarea value={csv} onChange={e => { setCsv(e.target.value); setParsed(false); setFileName(null); }}
            rows={8} className="font-mono text-xs" placeholder="Paste CSV here…" data-testid="textarea-csv" />
        </div>
      ) : (
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            "flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-10 cursor-pointer transition-colors",
            dragging ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/40 hover:bg-muted/20"
          )}
          data-testid="dropzone-file"
        >
          <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls,.txt" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) loadFileContent(f); }} />
          <FileSpreadsheet className={cn("w-10 h-10", dragging ? "text-primary" : "text-muted-foreground")} />
          {fileName ? (
            <div className="text-center">
              <p className="text-sm font-medium text-foreground">{fileName}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{csv.split("\n").filter(Boolean).length} rows loaded — click to change</p>
            </div>
          ) : (
            <div className="text-center">
              <p className="text-sm font-medium">Drop your file here or click to browse</p>
              <p className="text-xs text-muted-foreground mt-0.5">Supports .csv, .xlsx, .xls — both new format and legacy BitsAuto exports</p>
            </div>
          )}
        </div>
      )}

      {/* ── Options ── */}
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 cursor-pointer select-none text-sm" data-testid="toggle-auto-parent">
          <div onClick={() => setAutoParent(v => !v)}
            className={cn("w-8 h-5 rounded-full transition-colors flex items-center px-0.5",
              autoParent ? "bg-primary" : "bg-muted border border-border"
            )}>
            <div className={cn("w-3.5 h-3.5 rounded-full bg-white shadow transition-transform", autoParent ? "translate-x-3.5" : "translate-x-0")} />
          </div>
          <span>Auto-create parent hierarchy</span>
          <span className="text-xs text-muted-foreground">(creates Country → Type nodes automatically)</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer select-none text-sm" data-testid="toggle-auto-approve">
          <div onClick={() => setAutoApprove(v => !v)}
            className={cn("w-8 h-5 rounded-full transition-colors flex items-center px-0.5",
              autoApprove ? "bg-emerald-500" : "bg-muted border border-border"
            )}>
            <div className={cn("w-3.5 h-3.5 rounded-full bg-white shadow transition-transform", autoApprove ? "translate-x-3.5" : "translate-x-0")} />
          </div>
          <span>Auto-approve on import</span>
          <span className="text-xs text-muted-foreground">(skip Approvals queue)</span>
        </label>
      </div>

      {/* ── Action Buttons ── */}
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={parse} disabled={!csv.trim()} data-testid="btn-parse-csv">
          <Eye className="w-3.5 h-3.5 mr-1.5" />Preview
        </Button>
        {parsed && newCount > 0 && (
          <Button size="sm" onClick={() => importMut.mutate()} disabled={importMut.isPending} data-testid="btn-import-csv">
            {importMut.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Upload className="w-3.5 h-3.5 mr-1.5" />}
            Import {newCount} destination{newCount !== 1 ? "s" : ""}
          </Button>
        )}
        {parsed && (
          <div className="flex items-center gap-3 text-xs ml-2">
            {newCount > 0 && <span className="flex items-center gap-1 text-emerald-400"><CheckCircle2 className="w-3 h-3" />{newCount} new</span>}
            {existsCount > 0 && <span className="flex items-center gap-1 text-amber-400"><SkipForward className="w-3 h-3" />{existsCount} exists</span>}
            {invalidCount > 0 && <span className="flex items-center gap-1 text-rose-400"><XCircle className="w-3 h-3" />{invalidCount} invalid</span>}
            {detectedFormat === "legacy" && <span className="flex items-center gap-1 text-cyan-400"><Link2 className="w-3 h-3" />Legacy format detected</span>}
          </div>
        )}
      </div>

      {/* ── Color-coded Preview Table ── */}
      {parsed && preview.length > 0 && (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border text-xs font-medium text-muted-foreground flex items-center gap-3">
            <span>Preview — {preview.length} rows</span>
            <span className="text-emerald-400">{newCount} new</span>
            {existsCount > 0 && <span className="text-amber-400">{existsCount} already exist</span>}
            {invalidCount > 0 && <span className="text-rose-400">{invalidCount} invalid</span>}
          </div>
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/30 backdrop-blur-sm">
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-3 font-medium text-muted-foreground w-5"></th>
                  {["Name", "Prefix", detectedFormat === "legacy" ? "Country" : "Code", "Operator", "Level"].map(h => (
                    <th key={h} className="text-left py-2 px-3 font-medium text-muted-foreground">{h}</th>
                  ))}
                  {detectedFormat === "legacy" && <th className="text-left py-2 px-3 font-medium text-muted-foreground">Rate</th>}
                </tr>
              </thead>
              <tbody>
                {preview.map((r, i) => (
                  <tr key={i} className={cn("border-b border-border/40 transition-colors",
                    r._status === "new"     ? "bg-emerald-500/5 hover:bg-emerald-500/10" :
                    r._status === "exists"  ? "bg-amber-500/5   hover:bg-amber-500/10"  :
                                              "bg-rose-500/5    hover:bg-rose-500/10"
                  )}>
                    <td className="py-1.5 px-3">
                      {r._status === "new"    && <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
                      {r._status === "exists" && <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />}
                      {r._status === "invalid"&& <div className="w-1.5 h-1.5 rounded-full bg-rose-400" />}
                    </td>
                    <td className="py-1.5 px-3 font-medium">{r.name}</td>
                    <td className="py-1.5 px-3 font-mono text-muted-foreground">{r.dialPrefix ?? "—"}</td>
                    <td className="py-1.5 px-3 uppercase text-muted-foreground">{detectedFormat === "legacy" ? (r.countryName ?? "—") : (r.countryCode ?? "—")}</td>
                    <td className="py-1.5 px-3 text-muted-foreground">{r.operatorName ?? "—"}</td>
                    <td className="py-1.5 px-3">
                      <span className={cn("font-medium", LEVEL_COLORS[r.level ?? 1])}>{LEVEL_LABELS[r.level ?? 1] ?? `L${r.level}`}</span>
                    </td>
                    {detectedFormat === "legacy" && (
                      <td className="py-1.5 px-3 font-mono text-muted-foreground text-[10px]">
                        {r.rate != null ? `$${r.rate.toFixed(5)}` : "—"}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── GDS Rates Types ────────────────────────────────────────────────────────────
interface ProductPrefix { prefix: string; product_code: string; product_name: string; }
interface DestProductRate {
  id: number; destination_id: number; product_prefix: string; dial_prefix: string | null;
  destination_name: string | null; buy_rate: string | null; sell_rate: string | null;
  currency: string; approval_status: string; approved_by: string | null; approved_at: string | null;
  source: string; source_file: string | null; notes: string | null;
  dest_name_live: string | null; dest_status: string | null;
  product_code: string | null; product_name: string | null;
}
interface ReconRow {
  _status: "new" | "update" | "unmatched" | "invalid";
  _destId?: number; _destName?: string; _destDialPrefix?: string;
  _productCode?: string; _productName?: string; _productPrefix?: string;
  _existingBuyRate?: string; _existingApprovalStatus?: string;
  _marginPct?: string | null; _reason?: string;
  dialPrefix?: string; destinationName?: string; buyRate?: number; sellRate?: number;
}

function marginColor(pct: number | null) {
  if (pct === null) return "text-muted-foreground";
  if (pct >= 20) return "text-emerald-400";
  if (pct >= 10) return "text-amber-400";
  return "text-rose-400";
}

// ── GDS Rates Tab ──────────────────────────────────────────────────────────────
function GdsRatesTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<"matrix" | "upload">("matrix");
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsedRows, setParsedRows] = useState<any[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<string>("");
  const [buyCol, setBuyCol] = useState<string>("Rate");
  const [sellCol, setSellCol] = useState<string>("");
  const [reconResult, setReconResult] = useState<{ preview: ReconRow[]; matched: number; unmatched: number; invalid: number } | null>(null);
  const [filterStatus, setFilterStatus] = useState("all");
  const [search, setSearch] = useState("");

  const { data: products = [] } = useQuery<ProductPrefix[]>({ queryKey: ["/api/product-prefixes"] });
  const { data: rates = [], isLoading: ratesLoading } = useQuery<DestProductRate[]>({ queryKey: ["/api/destination-catalog/product-rates"] });
  const { data: pendingData } = useQuery<{ count: number }>({ queryKey: ["/api/destination-catalog/product-rates/pending-count"] });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["/api/destination-catalog/product-rates"] });
    qc.invalidateQueries({ queryKey: ["/api/destination-catalog/product-rates/pending-count"] });
  };

  const reconcileMut = useMutation({
    mutationFn: (body: any) => apiRequest("POST", "/api/destination-catalog/gds-reconcile", body),
    onSuccess: async (res) => { const d = await res.json(); setReconResult(d); },
    onError: (e: any) => toast({ title: "Reconcile error", description: e.message, variant: "destructive" }),
  });

  const commitMut = useMutation({
    mutationFn: (body: any) => apiRequest("POST", "/api/destination-catalog/gds-commit", body),
    onSuccess: async (res) => {
      const d = await res.json();
      toast({ title: "Committed", description: `${d.saved} rate(s) saved — pending your approval.` });
      invalidate(); setReconResult(null); setParsedRows([]); setFileName(null);
    },
    onError: (e: any) => toast({ title: "Commit error", description: e.message, variant: "destructive" }),
  });

  const approveMut = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/destination-catalog/product-rates/${id}/approve`, {}),
    onSuccess: () => invalidate(),
  });

  const rejectMut = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason?: string }) =>
      apiRequest("POST", `/api/destination-catalog/product-rates/${id}/reject`, { reason }),
    onSuccess: () => invalidate(),
  });

  const approveAllMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/destination-catalog/product-rates/approve-all-pending", {}),
    onSuccess: async (res) => {
      const d = await res.json();
      toast({ title: "Approved", description: `${d.approved} rate(s) approved.` });
      invalidate();
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/destination-catalog/product-rates/${id}`, {}),
    onSuccess: () => { invalidate(); toast({ title: "Deleted" }); },
  });

  // ── File parsing ────────────────────────────────────────────────────────────
  function parseFile(file: File) {
    setFileName(file.name); setReconResult(null); setParsedRows([]);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
        if (rows.length < 2) return;

        const headers = (rows[0] as any[]).map((h: any) => String(h).trim());
        const prefixIdx = headers.findIndex(h => /^(prefix|code|dial|number)$/i.test(h));
        const nameIdx   = headers.findIndex(h => /^(dest|name|country|description)$/i.test(h));
        const buyIdx    = headers.findIndex(h => /^(buy|cost|buying|buy_rate)$/i.test(h));
        const sellIdx   = headers.findIndex(h => /^(sell|rate|selling|sell_rate|price)$/i.test(h));

        const pi = prefixIdx >= 0 ? prefixIdx : 0;
        const ni = nameIdx   >= 0 ? nameIdx   : 1;
        const bi = buyIdx    >= 0 ? buyIdx    : (sellIdx >= 0 ? -1 : 2);
        const si = sellIdx   >= 0 ? sellIdx   : (buyIdx  >= 0 ? -1 : 2);

        if (buyIdx >= 0) setBuyCol(headers[buyIdx]);
        if (sellIdx >= 0) setSellCol(headers[sellIdx]);
        else if (buyIdx < 0) setSellCol(headers[2] ?? "Rate");

        const parsed = rows.slice(1).filter(r => r[pi]).map(r => ({
          dialPrefix:      String(r[pi] ?? "").trim().replace(/^\+/, ""),
          destinationName: String(r[ni] ?? "").trim(),
          buyRate:  bi >= 0 ? parseFloat(String(r[bi] ?? "0")) || 0 : 0,
          sellRate: si >= 0 ? parseFloat(String(r[si] ?? "0")) || 0 : 0,
        }));
        setParsedRows(parsed);
      } catch (err: any) {
        toast({ title: "Parse error", description: err.message, variant: "destructive" });
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) parseFile(file);
  }

  function handleReconcile() {
    if (!parsedRows.length || !selectedProduct) return;
    const rows = parsedRows.map(r => ({ ...r, productPrefix: selectedProduct }));
    reconcileMut.mutate({ rows, productPrefix: selectedProduct });
  }

  function handleCommit() {
    if (!reconResult) return;
    const rows = reconResult.preview.filter(r => r._status === "new" || r._status === "update");
    commitMut.mutate({ rows, sourceFile: fileName });
  }

  // ── Rate Matrix ─────────────────────────────────────────────────────────────
  const allRates = rates;
  const pendingCount = pendingData?.count ?? 0;

  const destMap = new Map<string, { name: string; prefix: string | null; status: string | null; rates: Map<string, DestProductRate> }>();
  for (const r of allRates) {
    const key = r.dest_name_live ?? r.destination_name ?? `dest-${r.destination_id}`;
    if (!destMap.has(key)) destMap.set(key, { name: key, prefix: r.dial_prefix, status: r.dest_status, rates: new Map() });
    destMap.get(key)!.rates.set(r.product_prefix, r);
  }

  const filteredDests = [...destMap.entries()]
    .filter(([name]) => !search || name.toLowerCase().includes(search.toLowerCase()))
    .filter(([, d]) => {
      if (filterStatus === "all") return true;
      return [...d.rates.values()].some(r => r.approval_status === filterStatus);
    })
    .sort(([a], [b]) => a.localeCompare(b));

  // ── Upload View ─────────────────────────────────────────────────────────────
  if (view === "upload") return (
    <div className="p-4 space-y-4 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Upload GDS Rate Sheet</h3>
          <p className="text-xs text-muted-foreground mt-0.5">CSV or Excel with Prefix, Destination, Buy Rate, Sell Rate columns</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => { setView("matrix"); setReconResult(null); setParsedRows([]); setFileName(null); }} data-testid="btn-back-matrix">
          ← Rate Matrix
        </Button>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
        className={cn("flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 cursor-pointer transition-colors",
          dragging ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/40 hover:bg-muted/20")}
        data-testid="gds-dropzone"
      >
        <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) parseFile(f); }} />
        <FileSpreadsheet className={cn("w-9 h-9", dragging ? "text-primary" : "text-muted-foreground")} />
        {fileName ? (
          <div className="text-center">
            <p className="text-sm font-medium">{fileName}</p>
            <p className="text-xs text-muted-foreground">{parsedRows.length} rows — click to replace</p>
          </div>
        ) : (
          <div className="text-center">
            <p className="text-sm font-medium">Drop GDS file or click to browse</p>
            <p className="text-xs text-muted-foreground">CSV / XLSX — columns: Prefix, Destination, Buy Rate, Sell Rate</p>
          </div>
        )}
      </div>

      {/* Column format hint */}
      <div className="bg-muted/20 border border-border/60 rounded p-3 text-xs font-mono text-muted-foreground space-y-0.5">
        <div className="text-foreground font-semibold mb-1 font-sans">Expected column names</div>
        <div>Prefix · Code · Dial · Number → <span className="text-cyan-400">dial prefix</span></div>
        <div>Dest · Name · Country · Description → <span className="text-violet-400">destination</span></div>
        <div>Buy · Cost · Buying · Buy_Rate → <span className="text-amber-400">buy rate</span></div>
        <div>Sell · Rate · Selling · Price · Sell_Rate → <span className="text-emerald-400">sell rate</span></div>
      </div>

      {/* Product selector + reconcile */}
      {parsedRows.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Apply rates to product</Label>
              <Select value={selectedProduct} onValueChange={setSelectedProduct}>
                <SelectTrigger className="h-8 w-48 text-sm" data-testid="select-product">
                  <SelectValue placeholder="Select product…" />
                </SelectTrigger>
                <SelectContent>
                  {products.map(p => (
                    <SelectItem key={p.prefix} value={p.prefix}>
                      {p.product_code} — {p.product_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" onClick={handleReconcile} disabled={!selectedProduct || reconcileMut.isPending} data-testid="btn-reconcile">
              {reconcileMut.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
              Reconcile {parsedRows.length} rows
            </Button>
          </div>

          {/* Local parse preview */}
          {!reconResult && (
            <div className="bg-card border border-border rounded-lg overflow-hidden">
              <div className="px-3 py-2 border-b border-border text-xs font-medium text-muted-foreground">
                Parsed — {parsedRows.length} rows · {buyCol && <span className="text-amber-400 mr-2">Buy: {buyCol}</span>}{sellCol && <span className="text-emerald-400">Sell: {sellCol}</span>}
              </div>
              <div className="max-h-56 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted/30">
                    <tr className="border-b border-border">
                      {["Prefix", "Destination", "Buy Rate", "Sell Rate"].map(h => (
                        <th key={h} className="text-left py-2 px-3 font-medium text-muted-foreground">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsedRows.slice(0, 100).map((r, i) => (
                      <tr key={i} className="border-b border-border/40 hover:bg-muted/20">
                        <td className="py-1.5 px-3 font-mono">{r.dialPrefix}</td>
                        <td className="py-1.5 px-3">{r.destinationName || <span className="text-muted-foreground">—</span>}</td>
                        <td className="py-1.5 px-3 font-mono text-amber-400">{r.buyRate > 0 ? `$${r.buyRate.toFixed(5)}` : <span className="text-muted-foreground">—</span>}</td>
                        <td className="py-1.5 px-3 font-mono text-emerald-400">{r.sellRate > 0 ? `$${r.sellRate.toFixed(5)}` : <span className="text-muted-foreground">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Server reconciliation preview */}
          {reconResult && (
            <div className="space-y-3">
              <div className="flex items-center gap-4 text-xs">
                <span className="flex items-center gap-1 text-emerald-400"><CheckCircle2 className="w-3 h-3" />{reconResult.matched} matched</span>
                {reconResult.unmatched > 0 && <span className="flex items-center gap-1 text-amber-400"><AlertTriangle className="w-3 h-3" />{reconResult.unmatched} unmatched</span>}
                {reconResult.invalid > 0 && <span className="flex items-center gap-1 text-rose-400"><XCircle className="w-3 h-3" />{reconResult.invalid} invalid</span>}
                {reconResult.matched > 0 && (
                  <Button size="sm" className="ml-auto" onClick={handleCommit} disabled={commitMut.isPending} data-testid="btn-commit-rates">
                    {commitMut.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Upload className="w-3.5 h-3.5 mr-1.5" />}
                    Commit {reconResult.matched} rate{reconResult.matched !== 1 ? "s" : ""} (pending approval)
                  </Button>
                )}
              </div>
              <div className="bg-card border border-border rounded-lg overflow-hidden">
                <div className="max-h-72 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted/30">
                      <tr className="border-b border-border">
                        <th className="text-left py-2 px-2 font-medium text-muted-foreground w-4"></th>
                        {["Prefix", "Destination", "Product", "Buy Rate", "Sell Rate", "Margin"].map(h => (
                          <th key={h} className="text-left py-2 px-3 font-medium text-muted-foreground">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {reconResult.preview.map((r, i) => {
                        const mPct = r._marginPct ? parseFloat(r._marginPct) : null;
                        return (
                          <tr key={i} className={cn("border-b border-border/40",
                            r._status === "new"       ? "bg-emerald-500/5" :
                            r._status === "update"    ? "bg-blue-500/5"    :
                            r._status === "unmatched" ? "bg-amber-500/5"   : "bg-rose-500/5"
                          )}>
                            <td className="py-1.5 px-2">
                              {r._status === "new"       && <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
                              {r._status === "update"    && <div className="w-1.5 h-1.5 rounded-full bg-blue-400"    />}
                              {r._status === "unmatched" && <div className="w-1.5 h-1.5 rounded-full bg-amber-400"   />}
                              {r._status === "invalid"   && <div className="w-1.5 h-1.5 rounded-full bg-rose-400"    />}
                            </td>
                            <td className="py-1.5 px-3 font-mono text-muted-foreground">{r._destDialPrefix ?? r.dialPrefix}</td>
                            <td className="py-1.5 px-3 font-medium">{r._destName ?? <span className="text-muted-foreground">{r._reason}</span>}</td>
                            <td className="py-1.5 px-3 text-xs text-muted-foreground">{r._productCode ?? r._productPrefix}</td>
                            <td className="py-1.5 px-3 font-mono text-amber-400">{(r.buyRate ?? 0) > 0 ? `$${r.buyRate!.toFixed(5)}` : "—"}</td>
                            <td className="py-1.5 px-3 font-mono text-emerald-400">{(r.sellRate ?? 0) > 0 ? `$${r.sellRate!.toFixed(5)}` : "—"}</td>
                            <td className={cn("py-1.5 px-3 font-mono", marginColor(mPct))}>{mPct !== null ? `${mPct}%` : "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );

  // ── Matrix View ─────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-background/80 flex-shrink-0 flex-wrap gap-y-2">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search destinations…"
            className="h-7 pl-8 w-52 text-xs" data-testid="input-gds-search" />
        </div>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="h-7 w-36 text-xs" data-testid="select-filter-status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All rates</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
        {pendingCount > 0 && (
          <Button size="sm" variant="outline" onClick={() => approveAllMut.mutate()} disabled={approveAllMut.isPending}
            className="h-7 text-xs text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10" data-testid="btn-approve-all">
            {approveAllMut.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Check className="w-3 h-3 mr-1" />}
            Approve all ({pendingCount})
          </Button>
        )}
        <div className="ml-auto">
          <Button size="sm" onClick={() => setView("upload")} data-testid="btn-upload-gds">
            <Upload className="w-3.5 h-3.5 mr-1.5" />Upload GDS
          </Button>
        </div>
      </div>

      {ratesLoading ? (
        <div className="flex items-center justify-center flex-1">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : filteredDests.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-3 text-center p-8">
          <BarChart2 className="w-10 h-10 text-muted-foreground/40" />
          <div>
            <p className="text-sm font-medium text-muted-foreground">No rates uploaded yet</p>
            <p className="text-xs text-muted-foreground mt-1">Upload a GDS rate sheet to populate the rate matrix.</p>
          </div>
          <Button size="sm" onClick={() => setView("upload")} data-testid="btn-start-upload">
            <Upload className="w-3.5 h-3.5 mr-1.5" />Upload GDS Rate Sheet
          </Button>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 z-10 bg-background border-b border-border">
              <tr>
                <th className="text-left py-2.5 px-4 font-medium text-muted-foreground w-56">Destination</th>
                <th className="text-left py-2.5 px-3 font-medium text-muted-foreground w-24">Prefix</th>
                {products.map(p => (
                  <th key={p.prefix} className="text-center py-2.5 px-3 font-medium text-muted-foreground min-w-[140px]">
                    <span className="bg-primary/10 text-primary rounded px-1.5 py-0.5">{p.product_code}</span>
                    <span className="block text-[10px] text-muted-foreground/60 font-normal mt-0.5">{p.product_name}</span>
                  </th>
                ))}
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {filteredDests.map(([destKey, dest]) => (
                <tr key={destKey} className="border-b border-border/40 hover:bg-muted/20 transition-colors group">
                  <td className="py-2.5 px-4">
                    <div className="font-medium truncate max-w-[200px]" title={dest.name}>{dest.name}</div>
                    {dest.status && (
                      <span className={cn("text-[10px] rounded px-1 py-0.5 border", STATUS_COLORS[dest.status] ?? STATUS_COLORS.deprecated)}>
                        {dest.status}
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 font-mono text-muted-foreground">{dest.prefix ?? "—"}</td>
                  {products.map(p => {
                    const rate = dest.rates.get(p.prefix);
                    if (!rate) return (
                      <td key={p.prefix} className="py-2.5 px-3 text-center">
                        <span className="text-muted-foreground/30 text-[10px]">—</span>
                      </td>
                    );
                    const buy  = rate.buy_rate  ? parseFloat(rate.buy_rate)  : null;
                    const sell = rate.sell_rate ? parseFloat(rate.sell_rate) : null;
                    const margin = sell && buy ? ((sell - buy) / sell * 100) : null;
                    const st = rate.approval_status;
                    return (
                      <td key={p.prefix} className="py-2 px-3 text-center align-top">
                        <div className="space-y-1">
                          <div className="flex justify-center gap-2 text-[11px]">
                            {buy  !== null && <span className="text-amber-400  font-mono">${buy.toFixed(5)}</span>}
                            {sell !== null && <span className="text-emerald-400 font-mono">${sell.toFixed(5)}</span>}
                          </div>
                          {margin !== null && (
                            <div className={cn("text-[10px] font-mono", marginColor(margin))}>
                              {margin.toFixed(1)}% margin
                            </div>
                          )}
                          <div className="flex items-center justify-center gap-1">
                            <span className={cn("text-[10px] rounded-full px-1.5 py-0.5 border font-medium",
                              st === "approved" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" :
                              st === "rejected" ? "bg-rose-500/15    text-rose-400    border-rose-500/30"    :
                                                  "bg-amber-500/15   text-amber-400   border-amber-500/30"
                            )}>
                              {st}
                            </span>
                          </div>
                          {st === "pending" && (
                            <div className="flex justify-center gap-1">
                              <button onClick={() => approveMut.mutate(rate.id)} disabled={approveMut.isPending}
                                className="text-emerald-400 hover:text-emerald-300 rounded px-1 py-0.5 hover:bg-emerald-500/10 text-[10px] font-medium transition-colors"
                                data-testid={`btn-approve-${rate.id}`}>✓ Approve</button>
                              <button onClick={() => rejectMut.mutate({ id: rate.id })} disabled={rejectMut.isPending}
                                className="text-rose-400 hover:text-rose-300 rounded px-1 py-0.5 hover:bg-rose-500/10 text-[10px] font-medium transition-colors"
                                data-testid={`btn-reject-${rate.id}`}>✗ Reject</button>
                            </div>
                          )}
                          {st === "rejected" && (
                            <button onClick={() => approveMut.mutate(rate.id)}
                              className="text-muted-foreground hover:text-foreground text-[10px] hover:underline"
                              data-testid={`btn-re-approve-${rate.id}`}>Re-approve</button>
                          )}
                        </div>
                      </td>
                    );
                  })}
                  <td className="py-2 px-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    {[...dest.rates.values()].map(r => (
                      <button key={r.id} onClick={() => deleteMut.mutate(r.id)}
                        className="text-muted-foreground hover:text-rose-400 transition-colors block"
                        title={`Delete ${r.product_code} rate`} data-testid={`btn-delete-rate-${r.id}`}>
                        <Trash2 className="w-3 h-3" />
                      </button>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function DestinationCatalogPage() {
  const [activeTab, setActiveTab] = useState<TabId>("catalog");
  const { data: flatNodes = [], isLoading } = useQuery<Dest[]>({
    queryKey: ["/api/product-registry/destinations"],
  });
  const { data: gdsPending } = useQuery<{ count: number }>({
    queryKey: ["/api/destination-catalog/product-rates/pending-count"],
  });

  const stats = useMemo(() => ({
    total:    flatNodes.length,
    approved: flatNodes.filter(n => n.commercialStatus === "approved").length,
    pending:  flatNodes.filter(n => n.commercialStatus === "pending").length,
    blocked:  flatNodes.filter(n => n.commercialStatus === "blocked").length,
  }), [flatNodes]);

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Tab bar */}
      <div className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur-sm flex-shrink-0">
        <div className="flex items-center gap-0 px-4 h-11">
          <div className="flex items-center gap-1.5 mr-4 pr-4 border-r border-border/50 text-xs font-medium text-muted-foreground shrink-0">
            <Globe className="w-3.5 h-3.5 text-cyan-400" />
            <span className="hidden sm:inline">Destination Catalog</span>
          </div>
          <div className="flex items-center gap-0.5 flex-1">
            {TABS.map(tab => {
              const Icon = tab.icon;
              const badge = tab.id === "approvals" && stats.pending > 0 ? stats.pending
                         : tab.id === "gds"       && (gdsPending?.count ?? 0) > 0 ? gdsPending!.count
                         : null;
              return (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                  className={cn("relative flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap",
                    activeTab === tab.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                  )} data-testid={`tab-dest-${tab.id}`}>
                  <Icon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                  {badge && (
                    <span className="ml-0.5 bg-amber-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                      {badge > 9 ? "9+" : badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {/* Stats strip */}
          <div className="hidden lg:flex items-center gap-3 text-xs text-muted-foreground ml-4 pl-4 border-l border-border/50">
            <span><span className="text-foreground font-medium">{stats.total}</span> total</span>
            <span><span className="text-emerald-400 font-medium">{stats.approved}</span> approved</span>
            <span><span className="text-amber-400 font-medium">{stats.pending}</span> pending</span>
            {stats.blocked > 0 && <span><span className="text-rose-400 font-medium">{stats.blocked}</span> blocked</span>}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {activeTab === "catalog"   && <CatalogTab flatNodes={flatNodes} />}
            {activeTab === "approvals" && <div className="h-full overflow-y-auto"><ApprovalsTab flatNodes={flatNodes} /></div>}
            {activeTab === "gds"       && <div className="h-full overflow-y-auto"><GdsRatesTab /></div>}
            {activeTab === "intel"     && <MarketIntelTab flatNodes={flatNodes} />}
            {activeTab === "import"    && <div className="h-full overflow-y-auto"><ImportTab /></div>}
          </>
        )}
      </div>
    </div>
  );
}

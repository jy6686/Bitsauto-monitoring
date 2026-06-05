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
interface TreeNode extends Dest { children: TreeNode[]; }
type TabId = "catalog" | "approvals" | "intel" | "import";

// ── Constants ──────────────────────────────────────────────────────────────────
const TABS: { id: TabId; label: string; icon: any }[] = [
  { id: "catalog",   label: "Destination Catalog", icon: Globe      },
  { id: "approvals", label: "Approvals",            icon: Shield     },
  { id: "intel",     label: "Market Intel",         icon: TrendingUp },
  { id: "import",    label: "Bulk Import",          icon: Upload     },
];

const STATUS_COLORS: Record<string, string> = {
  approved:   "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  blocked:    "bg-rose-500/15    text-rose-400    border-rose-500/30",
  pending:    "bg-amber-500/15   text-amber-400   border-amber-500/30",
  testing:    "bg-blue-500/15    text-blue-400    border-blue-500/30",
  deprecated: "bg-slate-500/15   text-slate-400   border-slate-500/30",
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

        {/* Approval actions */}
        {!editing && canApprove && (
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Commercial Status</div>
            <div className="flex gap-2 flex-wrap">
              {node.commercialStatus !== "approved" && (
                <Button size="sm" className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white h-8"
                  onClick={() => approveMut.mutate()} disabled={approveMut.isPending} data-testid="btn-approve-dest">
                  <Check className="w-3.5 h-3.5" />Approve
                </Button>
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

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function DestinationCatalogPage() {
  const [activeTab, setActiveTab] = useState<TabId>("catalog");
  const { data: flatNodes = [], isLoading } = useQuery<Dest[]>({
    queryKey: ["/api/product-registry/destinations"],
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
              const badge = tab.id === "approvals" && stats.pending > 0 ? stats.pending : null;
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
            {activeTab === "intel"     && <MarketIntelTab flatNodes={flatNodes} />}
            {activeTab === "import"    && <div className="h-full overflow-y-auto"><ImportTab /></div>}
          </>
        )}
      </div>
    </div>
  );
}

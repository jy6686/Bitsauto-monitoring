import { useState, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Package, Globe, Layers, BarChart2, Network, TrendingUp,
  BookOpen, ChevronRight, ChevronDown, Plus, Check, X,
  GripVertical, Trash2, Edit2, Shield, Clock, Search,
  ArrowRight, AlertTriangle, CheckCircle2, XCircle,
  History, RefreshCw, Zap
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────
interface Product {
  id: number; code: string; name: string; description?: string;
  status: string; color?: string;
  defaultRoutingTemplate?: string; backupRoutingTemplate?: string;
  defaultPricingTemplate?: string;
  minMarginPct?: number; discountRangeMin?: number; discountRangeMax?: number;
  noticePeriodDays?: number;
  offerWindowMin?: number; offerWindowTarget?: number; offerWindowPremium?: number;
  sortOrder?: number;
}

interface Destination {
  id: number; parentId?: number | null; level: number; name: string;
  countryCode?: string; dialPrefix?: string; operatorName?: string;
  commercialStatus: string; sortOrder?: number;
}

interface DestinationNode extends Destination {
  children: DestinationNode[];
}

interface Assignment {
  id: number; productId: number; destinationId: number; status: string;
}

interface HistoryEntry {
  id: number; productId?: number; destinationId?: number;
  eventType: string; description: string;
  performedBy?: string; createdAt: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const TABS = [
  { id: "dashboard",    label: "Dashboard",         icon: BarChart2 },
  { id: "products",     label: "Product Catalog",   icon: Package },
  { id: "destinations", label: "Destination Catalog",icon: Globe },
  { id: "assignments",  label: "Assignments",        icon: Layers },
  { id: "routing",      label: "Routing Templates",  icon: Network },
  { id: "pricing",      label: "Pricing Templates",  icon: TrendingUp },
  { id: "history",      label: "History",            icon: History },
] as const;

type TabId = typeof TABS[number]["id"];

const PRODUCT_COLORS: Record<string, string> = {
  blue:   "bg-blue-500/15 text-blue-400 border-blue-500/30",
  green:  "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  amber:  "bg-amber-500/15 text-amber-400 border-amber-500/30",
  red:    "bg-rose-500/15 text-rose-400 border-rose-500/30",
  violet: "bg-violet-500/15 text-violet-400 border-violet-500/30",
  cyan:   "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
};

const STATUS_COLORS: Record<string, string> = {
  approved:   "bg-emerald-500/15 text-emerald-400",
  blocked:    "bg-rose-500/15 text-rose-400",
  testing:    "bg-cyan-500/15 text-cyan-400",
  deprecated: "bg-slate-500/15 text-slate-400",
  pending:    "bg-amber-500/15 text-amber-400",
};

// ── Tree Builder ──────────────────────────────────────────────────────────────
function buildTree(flat: Destination[]): DestinationNode[] {
  const map = new Map<number, DestinationNode>();
  flat.forEach(d => map.set(d.id, { ...d, children: [] }));
  const roots: DestinationNode[] = [];
  flat.forEach(d => {
    if (d.parentId && map.has(d.parentId)) {
      map.get(d.parentId)!.children.push(map.get(d.id)!);
    } else {
      roots.push(map.get(d.id)!);
    }
  });
  return roots;
}

// ── Destination Tree Node ─────────────────────────────────────────────────────
function DestinationTreeNode({
  node, depth = 0, selectedId, onSelect, assignedProductIds, allProducts,
  isDragOver, onDragOver, onDragLeave, onDrop, draggedProduct,
}: {
  node: DestinationNode; depth?: number; selectedId?: number;
  onSelect: (d: DestinationNode) => void;
  assignedProductIds?: Set<number>; allProducts?: Product[];
  isDragOver?: (id: number) => boolean;
  onDragOver?: (e: React.DragEvent, id: number) => void;
  onDragLeave?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent, destinationId: number) => void;
  draggedProduct?: Product | null;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = node.children.length > 0;
  const isOver = isDragOver?.(node.id) ?? false;
  const isSelected = selectedId === node.id;

  return (
    <div>
      <div
        data-testid={`dest-node-${node.id}`}
        className={cn(
          "flex items-center gap-1.5 px-2 py-1.5 rounded cursor-pointer text-sm select-none transition-colors group",
          isSelected && "bg-primary/10 text-primary",
          isOver && "bg-violet-500/20 ring-1 ring-violet-500/40",
          !isSelected && !isOver && "hover:bg-muted/60 text-foreground",
        )}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={() => onSelect(node)}
        onDragOver={e => { e.preventDefault(); onDragOver?.(e, node.id); }}
        onDragLeave={onDragLeave}
        onDrop={e => onDrop?.(e, node.id)}
      >
        <button
          onClick={e => { e.stopPropagation(); setExpanded(v => !v); }}
          className="w-4 h-4 flex items-center justify-center shrink-0"
        >
          {hasChildren
            ? (expanded ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />)
            : <span className="w-3" />}
        </button>
        <Globe className={cn("w-3.5 h-3.5 shrink-0",
          node.level === 1 ? "text-blue-400" :
          node.level === 2 ? "text-emerald-400" : "text-amber-400"
        )} />
        <span className="flex-1 truncate font-medium">{node.name}</span>
        {node.dialPrefix && (
          <span className="text-xs text-muted-foreground font-mono shrink-0">{node.dialPrefix}</span>
        )}
        <span className={cn("text-xs px-1.5 py-0.5 rounded shrink-0", STATUS_COLORS[node.commercialStatus] ?? "bg-muted text-muted-foreground")}>
          {node.commercialStatus}
        </span>
        {isOver && draggedProduct && (
          <span className="text-xs text-violet-400 shrink-0">Drop to assign</span>
        )}
      </div>
      {expanded && hasChildren && (
        <div>
          {node.children.map(child => (
            <DestinationTreeNode
              key={child.id} node={child} depth={depth + 1}
              selectedId={selectedId} onSelect={onSelect}
              assignedProductIds={assignedProductIds} allProducts={allProducts}
              isDragOver={isDragOver} onDragOver={onDragOver}
              onDragLeave={onDragLeave} onDrop={onDrop}
              draggedProduct={draggedProduct}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Dashboard Tab ─────────────────────────────────────────────────────────────
function DashboardTab({ products, assignments, destinations }: {
  products: Product[]; assignments: Assignment[]; destinations: Destination[];
}) {
  const assignedDestCount = (pid: number) =>
    assignments.filter(a => a.productId === pid && a.status === "active").length;
  const approvedDestCount = destinations.filter(d => d.commercialStatus === "approved").length;

  const riskLevel = (p: Product) => {
    const margin = p.minMarginPct ?? 0;
    if (margin >= 15) return { label: "Healthy", color: "text-emerald-400", bg: "bg-emerald-500/10" };
    if (margin >= 10) return { label: "Warning", color: "text-amber-400",   bg: "bg-amber-500/10" };
    return { label: "Risk", color: "text-rose-400", bg: "bg-rose-500/10" };
  };

  return (
    <div className="p-6 space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Products",          value: products.length,            icon: Package,  color: "text-violet-400" },
          { label: "Destinations",      value: destinations.length,        icon: Globe,    color: "text-blue-400"   },
          { label: "Approved Dests",    value: approvedDestCount,          icon: CheckCircle2, color: "text-emerald-400" },
          { label: "Total Assignments", value: assignments.filter(a => a.status === "active").length, icon: Layers, color: "text-amber-400" },
        ].map(c => (
          <div key={c.label} className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground">{c.label}</span>
              <c.icon className={cn("w-4 h-4", c.color)} />
            </div>
            <div className="text-2xl font-bold">{c.value}</div>
          </div>
        ))}
      </div>

      {/* Product risk table */}
      <div className="bg-card border border-border rounded-lg">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold">Product Portfolio Health</h3>
        </div>
        <div className="divide-y divide-border">
          {products.length === 0 && (
            <div className="p-6 text-center text-muted-foreground text-sm">No products configured yet</div>
          )}
          {products.map(p => {
            const risk = riskLevel(p);
            const assigned = assignedDestCount(p.id);
            return (
              <div key={p.id} className="px-4 py-3 flex items-center gap-4">
                <div className={cn("px-2 py-0.5 rounded text-xs font-bold border", PRODUCT_COLORS[p.color ?? "violet"])}>
                  {p.code}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">{p.name}</div>
                  {p.description && <div className="text-xs text-muted-foreground truncate">{p.description}</div>}
                </div>
                <div className="text-right text-sm">
                  <div className="font-medium">{p.minMarginPct ?? 0}%</div>
                  <div className="text-xs text-muted-foreground">min margin</div>
                </div>
                <div className="text-right text-sm">
                  <div className="font-medium">{assigned}</div>
                  <div className="text-xs text-muted-foreground">destinations</div>
                </div>
                <div className={cn("px-2 py-0.5 rounded text-xs font-medium", risk.bg, risk.color)}>
                  {risk.label}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Product Catalog Tab ───────────────────────────────────────────────────────
function ProductCatalogTab({ products, onRefresh }: { products: Product[]; onRefresh: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<Partial<Product>>({});

  const selected = products.find(p => p.id === selectedId);

  const createMut = useMutation({
    mutationFn: (data: Partial<Product>) => apiRequest("POST", "/api/product-registry/products", data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/product-registry/products"] }); setCreating(false); setForm({}); toast({ title: "Product created" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Product> }) =>
      apiRequest("PUT", `/api/product-registry/products/${id}`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/product-registry/products"] }); toast({ title: "Saved" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/product-registry/products/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/product-registry/products"] }); setSelectedId(null); toast({ title: "Deleted" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const editForm = selected ? { ...selected, ...form } : form;
  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );

  return (
    <div className="flex h-full">
      {/* Left: Product list */}
      <div className="w-64 shrink-0 border-r border-border flex flex-col">
        <div className="p-3 border-b border-border flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Products</span>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { setCreating(true); setSelectedId(null); setForm({}); }} data-testid="btn-create-product">
            <Plus className="w-4 h-4" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {products.map(p => (
            <button
              key={p.id}
              data-testid={`product-item-${p.id}`}
              className={cn("w-full text-left px-3 py-2.5 flex items-center gap-2.5 hover:bg-muted/60 transition-colors",
                selectedId === p.id && "bg-primary/10")}
              onClick={() => { setSelectedId(p.id); setCreating(false); setForm({}); }}
            >
              <div className={cn("w-8 h-8 rounded flex items-center justify-center text-xs font-bold border shrink-0",
                PRODUCT_COLORS[p.color ?? "violet"])}>
                {p.code}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{p.name}</div>
                <div className="text-xs text-muted-foreground">{p.status}</div>
              </div>
            </button>
          ))}
          {products.length === 0 && (
            <div className="p-4 text-center text-xs text-muted-foreground">No products yet</div>
          )}
        </div>
      </div>

      {/* Right: Detail / Create panel */}
      <div className="flex-1 overflow-y-auto">
        {!selected && !creating && (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-3">
            <Package className="w-10 h-10 opacity-30" />
            <p className="text-sm">Select a product or create a new one</p>
            <Button size="sm" onClick={() => setCreating(true)} data-testid="btn-create-product-empty">
              <Plus className="w-3.5 h-3.5 mr-1.5" /> New Product
            </Button>
          </div>
        )}

        {(selected || creating) && (
          <div className="p-6 space-y-6 max-w-2xl">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-lg">{creating ? "New Product" : selected?.name}</h2>
              {selected && (
                <Button size="sm" variant="destructive" onClick={() => deleteMut.mutate(selected.id)} data-testid="btn-delete-product">
                  <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Delete
                </Button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Code (e.g. FC)">
                <Input value={creating ? form.code ?? "" : editForm.code ?? ""} onChange={e => setForm(f => ({ ...f, code: e.target.value }))}
                  disabled={!creating} data-testid="input-product-code" />
              </Field>
              <Field label="Name">
                <Input value={editForm.name ?? ""} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} data-testid="input-product-name" />
              </Field>
            </div>

            <Field label="Description">
              <Textarea value={editForm.description ?? ""} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} data-testid="input-product-desc" />
            </Field>

            <div className="grid grid-cols-3 gap-4">
              <Field label="Min Margin %">
                <Input type="number" value={editForm.minMarginPct ?? 0} onChange={e => setForm(f => ({ ...f, minMarginPct: parseFloat(e.target.value) }))} data-testid="input-product-margin" />
              </Field>
              <Field label="Discount Min %">
                <Input type="number" value={editForm.discountRangeMin ?? ""} onChange={e => setForm(f => ({ ...f, discountRangeMin: parseFloat(e.target.value) }))} data-testid="input-product-discount-min" />
              </Field>
              <Field label="Discount Max %">
                <Input type="number" value={editForm.discountRangeMax ?? ""} onChange={e => setForm(f => ({ ...f, discountRangeMax: parseFloat(e.target.value) }))} data-testid="input-product-discount-max" />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Notice Period (days)">
                <Input type="number" value={editForm.noticePeriodDays ?? 7} onChange={e => setForm(f => ({ ...f, noticePeriodDays: parseInt(e.target.value) }))} data-testid="input-product-notice" />
              </Field>
              <Field label="Color Tag">
                <div className="flex gap-2 pt-1">
                  {Object.keys(PRODUCT_COLORS).map(c => (
                    <button key={c} data-testid={`color-${c}`}
                      className={cn("w-6 h-6 rounded-full transition-transform", `bg-${c}-400`,
                        editForm.color === c ? "ring-2 ring-offset-1 ring-white scale-110" : "opacity-60 hover:opacity-100"
                      )}
                      onClick={() => setForm(f => ({ ...f, color: c }))}
                    />
                  ))}
                </div>
              </Field>
            </div>

            <div className="pt-2 border-t border-border">
              <h3 className="text-sm font-semibold mb-3">KAM Offer Window</h3>
              <div className="grid grid-cols-3 gap-4">
                <Field label="Minimum Offer">
                  <Input type="number" step="0.0001" value={editForm.offerWindowMin ?? ""} onChange={e => setForm(f => ({ ...f, offerWindowMin: parseFloat(e.target.value) }))} data-testid="input-offer-min" />
                </Field>
                <Field label="Target Offer">
                  <Input type="number" step="0.0001" value={editForm.offerWindowTarget ?? ""} onChange={e => setForm(f => ({ ...f, offerWindowTarget: parseFloat(e.target.value) }))} data-testid="input-offer-target" />
                </Field>
                <Field label="Premium Offer">
                  <Input type="number" step="0.0001" value={editForm.offerWindowPremium ?? ""} onChange={e => setForm(f => ({ ...f, offerWindowPremium: parseFloat(e.target.value) }))} data-testid="input-offer-premium" />
                </Field>
              </div>
              <p className="text-xs text-muted-foreground mt-2">KAMs negotiate within this window — vendor cost and true margin are never exposed.</p>
            </div>

            <div className="pt-2 border-t border-border">
              <h3 className="text-sm font-semibold mb-3">Routing & Pricing Templates</h3>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Default Routing Template">
                  <Input value={editForm.defaultRoutingTemplate ?? ""} onChange={e => setForm(f => ({ ...f, defaultRoutingTemplate: e.target.value }))} placeholder="e.g. PK-FC-RTP" data-testid="input-routing-template" />
                </Field>
                <Field label="Backup Routing Template">
                  <Input value={editForm.backupRoutingTemplate ?? ""} onChange={e => setForm(f => ({ ...f, backupRoutingTemplate: e.target.value }))} placeholder="e.g. PK-FC-Backup" data-testid="input-backup-routing" />
                </Field>
                <Field label="Default Pricing Template">
                  <Input value={editForm.defaultPricingTemplate ?? ""} onChange={e => setForm(f => ({ ...f, defaultPricingTemplate: e.target.value }))} placeholder="e.g. Wholesale+15%" data-testid="input-pricing-template" />
                </Field>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <Button onClick={() => {
                if (creating) createMut.mutate(form);
                else if (selected) updateMut.mutate({ id: selected.id, data: form });
              }} disabled={createMut.isPending || updateMut.isPending} data-testid="btn-save-product">
                {createMut.isPending || updateMut.isPending ? <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Check className="w-3.5 h-3.5 mr-1.5" />}
                {creating ? "Create Product" : "Save Changes"}
              </Button>
              <Button variant="ghost" onClick={() => { setCreating(false); setSelectedId(null); setForm({}); }} data-testid="btn-cancel-product">
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Destination Catalog Tab ───────────────────────────────────────────────────
function DestinationCatalogTab({ destinations, products, assignments }: {
  destinations: Destination[]; products: Product[]; assignments: Assignment[];
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [selectedNode, setSelectedNode] = useState<DestinationNode | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<Partial<Destination>>({});

  const tree = buildTree(destinations);

  const filterTree = (nodes: DestinationNode[], q: string): DestinationNode[] => {
    if (!q) return nodes;
    return nodes.reduce<DestinationNode[]>((acc, node) => {
      const match = node.name.toLowerCase().includes(q.toLowerCase()) ||
                    node.dialPrefix?.includes(q);
      const children = filterTree(node.children, q);
      if (match || children.length > 0) acc.push({ ...node, children });
      return acc;
    }, []);
  };

  const visibleTree = filterTree(tree, search);

  const saveMut = useMutation({
    mutationFn: (data: Partial<Destination>) => {
      if (data.id) return apiRequest("PUT", `/api/product-registry/destinations/${data.id}`, data);
      return apiRequest("POST", "/api/product-registry/destinations", data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/product-registry/destinations"] });
      setCreating(false); setForm({});
      toast({ title: "Saved" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/product-registry/destinations/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/product-registry/destinations"] });
      setSelectedNode(null);
      toast({ title: "Deleted" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiRequest("PUT", `/api/product-registry/destinations/${id}`, { commercialStatus: status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/product-registry/destinations"] }),
  });

  const assignedProductIds = (destId: number) =>
    new Set(assignments.filter(a => a.destinationId === destId && a.status === "active").map(a => a.productId));

  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );

  const editForm = selectedNode ? { ...selectedNode, ...form } : form;

  return (
    <div className="flex h-full">
      {/* Left: Global Destination Tree */}
      <div className="w-72 shrink-0 border-r border-border flex flex-col">
        <div className="p-3 border-b border-border space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Global Catalog</span>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { setCreating(true); setSelectedNode(null); setForm({}); }} data-testid="btn-add-destination">
              <Plus className="w-4 h-4" />
            </Button>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-muted-foreground" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search destination…" className="h-8 pl-8 text-sm" data-testid="input-dest-search" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {visibleTree.map(node => (
            <DestinationTreeNode
              key={node.id} node={node}
              selectedId={selectedNode?.id}
              onSelect={n => { setSelectedNode(n); setCreating(false); setForm({}); }}
            />
          ))}
          {visibleTree.length === 0 && (
            <div className="p-4 text-center text-xs text-muted-foreground">
              {destinations.length === 0 ? "No destinations yet — add one" : "No matches"}
            </div>
          )}
        </div>
      </div>

      {/* Right: Destination Details */}
      <div className="flex-1 overflow-y-auto">
        {!selectedNode && !creating && (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-3">
            <Globe className="w-10 h-10 opacity-30" />
            <p className="text-sm">Select a destination or add a new one</p>
            <Button size="sm" onClick={() => setCreating(true)} data-testid="btn-add-dest-empty">
              <Plus className="w-3.5 h-3.5 mr-1.5" /> Add Destination
            </Button>
          </div>
        )}

        {(selectedNode || creating) && (
          <div className="p-6 space-y-5 max-w-xl">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-lg">{creating ? "New Destination" : selectedNode?.name}</h2>
              {selectedNode && (
                <Button size="sm" variant="destructive" onClick={() => deleteMut.mutate(selectedNode.id)} data-testid="btn-delete-dest">
                  <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Delete
                </Button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Name">
                <Input value={editForm.name ?? ""} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} data-testid="input-dest-name" />
              </Field>
              <Field label="Level (1=Country, 2=Type, 3=Operator)">
                <Input type="number" min={1} max={4} value={editForm.level ?? 1} onChange={e => setForm(f => ({ ...f, level: parseInt(e.target.value) }))} data-testid="input-dest-level" />
              </Field>
              <Field label="Country Code">
                <Input value={editForm.countryCode ?? ""} maxLength={4} onChange={e => setForm(f => ({ ...f, countryCode: e.target.value }))} placeholder="PK" data-testid="input-dest-cc" />
              </Field>
              <Field label="Dial Prefix">
                <Input value={editForm.dialPrefix ?? ""} onChange={e => setForm(f => ({ ...f, dialPrefix: e.target.value }))} placeholder="9230" data-testid="input-dest-prefix" />
              </Field>
              <Field label="Operator Name">
                <Input value={editForm.operatorName ?? ""} onChange={e => setForm(f => ({ ...f, operatorName: e.target.value }))} placeholder="Jazz" data-testid="input-dest-operator" />
              </Field>
              <Field label="Commercial Status">
                <select
                  value={editForm.commercialStatus ?? "pending"}
                  onChange={e => setForm(f => ({ ...f, commercialStatus: e.target.value }))}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  data-testid="select-dest-status"
                >
                  {["approved","blocked","testing","deprecated","pending"].map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </Field>
            </div>

            {!creating && selectedNode && (
              <div className="pt-3 border-t border-border">
                <h3 className="text-sm font-semibold mb-3">Product Availability Matrix</h3>
                <div className="grid grid-cols-2 gap-2">
                  {products.map(p => {
                    const assigned = assignedProductIds(selectedNode.id).has(p.id);
                    return (
                      <div key={p.id} className={cn("flex items-center gap-2 px-3 py-2 rounded border",
                        assigned ? "border-emerald-500/30 bg-emerald-500/5" : "border-border bg-muted/20")}>
                        <div className={cn("w-7 h-7 rounded flex items-center justify-center text-xs font-bold border",
                          PRODUCT_COLORS[p.color ?? "violet"])}>
                          {p.code}
                        </div>
                        <span className="text-sm flex-1">{p.name}</span>
                        {assigned
                          ? <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                          : <XCircle className="w-4 h-4 text-muted-foreground/40" />}
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Use the <strong>Assignments</strong> tab to drag & drop products onto destinations.
                </p>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <Button onClick={() => saveMut.mutate(creating ? form : { ...form, id: selectedNode?.id })}
                disabled={saveMut.isPending} data-testid="btn-save-dest">
                {saveMut.isPending ? <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Check className="w-3.5 h-3.5 mr-1.5" />}
                {creating ? "Add Destination" : "Save Changes"}
              </Button>
              <Button variant="ghost" onClick={() => { setCreating(false); setSelectedNode(null); setForm({}); }} data-testid="btn-cancel-dest">
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Assignments Tab (Drag & Drop) ─────────────────────────────────────────────
function AssignmentsTab({ products, destinations, assignments }: {
  products: Product[]; destinations: Destination[]; assignments: Assignment[];
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [draggedProduct, setDraggedProduct] = useState<Product | null>(null);
  const [overDestId, setOverDestId] = useState<number | null>(null);
  const dragLeaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const assignMut = useMutation({
    mutationFn: ({ productId, destinationId }: { productId: number; destinationId: number }) =>
      apiRequest("POST", "/api/product-registry/assignments", { productId, destinationId }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["/api/product-registry/assignments"] });
      qc.invalidateQueries({ queryKey: ["/api/product-registry/history"] });
      const prod = products.find(p => p.id === vars.productId);
      const dest = destinations.find(d => d.id === vars.destinationId);
      toast({ title: `Assigned: ${prod?.name} → ${dest?.name}` });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const removeMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/product-registry/assignments/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/product-registry/assignments"] });
      qc.invalidateQueries({ queryKey: ["/api/product-registry/history"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const tree = buildTree(destinations);

  const handleDragOver = useCallback((e: React.DragEvent, id: number) => {
    e.preventDefault();
    if (dragLeaveTimer.current) clearTimeout(dragLeaveTimer.current);
    setOverDestId(id);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    dragLeaveTimer.current = setTimeout(() => setOverDestId(null), 80);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, destinationId: number) => {
    e.preventDefault();
    setOverDestId(null);
    if (!draggedProduct) return;
    assignMut.mutate({ productId: draggedProduct.id, destinationId });
    setDraggedProduct(null);
  }, [draggedProduct, assignMut]);

  const getAssignment = (productId: number, destinationId: number) =>
    assignments.find(a => a.productId === productId && a.destinationId === destinationId && a.status === "active");

  return (
    <div className="flex h-full gap-0">
      {/* Left: draggable products */}
      <div className="w-56 shrink-0 border-r border-border flex flex-col">
        <div className="px-3 py-2.5 border-b border-border">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Products</span>
          <p className="text-xs text-muted-foreground mt-0.5">Drag onto destinations</p>
        </div>
        <div className="flex-1 overflow-y-auto py-2 space-y-1 px-2">
          {products.map(p => (
            <div
              key={p.id}
              data-testid={`draggable-product-${p.id}`}
              draggable
              onDragStart={() => setDraggedProduct(p)}
              onDragEnd={() => setDraggedProduct(null)}
              className={cn(
                "flex items-center gap-2.5 px-3 py-2.5 rounded-lg border cursor-grab active:cursor-grabbing select-none transition-all",
                PRODUCT_COLORS[p.color ?? "violet"],
                draggedProduct?.id === p.id && "opacity-50 scale-95",
              )}
            >
              <GripVertical className="w-3.5 h-3.5 opacity-50 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-bold">{p.code}</div>
                <div className="text-xs font-medium truncate">{p.name}</div>
              </div>
            </div>
          ))}
          {products.length === 0 && <div className="text-xs text-muted-foreground text-center py-4">No products</div>}
        </div>
      </div>

      {/* Right: destination tree as drop targets */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border flex items-start gap-6">
          <div>
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Destination Tree</span>
            <p className="text-xs text-muted-foreground mt-0.5">Drop a product onto any destination to assign it</p>
          </div>
          {draggedProduct && (
            <div className={cn("flex items-center gap-2 px-3 py-1.5 rounded border text-xs font-medium", PRODUCT_COLORS[draggedProduct.color ?? "violet"])}>
              <GripVertical className="w-3 h-3" />
              Dragging: {draggedProduct.name}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto py-2 px-2">
          {tree.map(node => (
            <AssignmentDestNode
              key={node.id} node={node} depth={0}
              products={products} assignments={assignments}
              overDestId={overDestId}
              draggedProduct={draggedProduct}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onRemove={id => removeMut.mutate(id)}
            />
          ))}
          {tree.length === 0 && (
            <div className="p-8 text-center text-muted-foreground">
              <Globe className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">Add destinations in the Destination Catalog tab first</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AssignmentDestNode({
  node, depth, products, assignments, overDestId, draggedProduct,
  onDragOver, onDragLeave, onDrop, onRemove,
}: {
  node: DestinationNode; depth: number;
  products: Product[]; assignments: Assignment[];
  overDestId: number | null; draggedProduct: Product | null;
  onDragOver: (e: React.DragEvent, id: number) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, id: number) => void;
  onRemove: (assignmentId: number) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = node.children.length > 0;
  const isOver = overDestId === node.id;
  const nodeAssignments = assignments.filter(a => a.destinationId === node.id && a.status === "active");

  return (
    <div>
      <div
        data-testid={`drop-dest-${node.id}`}
        className={cn(
          "flex items-center gap-2 px-2 py-2 rounded-lg transition-all mb-0.5",
          isOver ? "bg-violet-500/20 ring-1 ring-violet-500/40" : "hover:bg-muted/30",
        )}
        style={{ marginLeft: `${depth * 20}px` }}
        onDragOver={e => onDragOver(e, node.id)}
        onDragLeave={onDragLeave}
        onDrop={e => onDrop(e, node.id)}
      >
        <button onClick={() => setExpanded(v => !v)} className="w-5 h-5 flex items-center justify-center shrink-0">
          {hasChildren
            ? (expanded ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />)
            : <span className="w-3.5" />}
        </button>
        <Globe className={cn("w-3.5 h-3.5 shrink-0",
          node.level === 1 ? "text-blue-400" : node.level === 2 ? "text-emerald-400" : "text-amber-400"
        )} />
        <span className="text-sm font-medium flex-1">{node.name}</span>
        {node.dialPrefix && <span className="text-xs font-mono text-muted-foreground">{node.dialPrefix}</span>}

        {/* Assigned product badges */}
        <div className="flex items-center gap-1 ml-2">
          {nodeAssignments.map(a => {
            const prod = products.find(p => p.id === a.productId);
            if (!prod) return null;
            return (
              <span
                key={a.id}
                data-testid={`assignment-badge-${a.id}`}
                className={cn("flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-bold border", PRODUCT_COLORS[prod.color ?? "violet"])}
              >
                {prod.code}
                <button
                  onClick={() => onRemove(a.id)}
                  className="hover:text-rose-400 transition-colors ml-0.5"
                  data-testid={`remove-assignment-${a.id}`}
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </span>
            );
          })}
          {isOver && draggedProduct && (
            <span className={cn("flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-bold border opacity-60 border-dashed",
              PRODUCT_COLORS[draggedProduct.color ?? "violet"])}>
              + {draggedProduct.code}
            </span>
          )}
        </div>
      </div>
      {expanded && hasChildren && (
        <div>
          {node.children.map(child => (
            <AssignmentDestNode
              key={child.id} node={child} depth={depth + 1}
              products={products} assignments={assignments}
              overDestId={overDestId} draggedProduct={draggedProduct}
              onDragOver={onDragOver} onDragLeave={onDragLeave}
              onDrop={onDrop} onRemove={onRemove}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Routing Templates Tab ─────────────────────────────────────────────────────
function RoutingTemplatesTab({ products }: { products: Product[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState<number | null>(null);
  const [form, setForm] = useState<{ defaultRoutingTemplate?: string; backupRoutingTemplate?: string }>({});

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      apiRequest("PUT", `/api/product-registry/products/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/product-registry/products"] });
      setEditing(null); setForm({});
      toast({ title: "Routing template saved" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="p-6 space-y-4 max-w-3xl">
      <div className="space-y-1">
        <h2 className="font-semibold">Routing Templates</h2>
        <p className="text-sm text-muted-foreground">Each product owns its default and backup routing template. These become the baseline when provisioning new routes.</p>
      </div>
      <div className="bg-card border border-border rounded-lg divide-y divide-border">
        {products.map(p => (
          <div key={p.id} className="px-4 py-3">
            {editing === p.id ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 mb-2">
                  <div className={cn("w-8 h-8 rounded flex items-center justify-center text-xs font-bold border", PRODUCT_COLORS[p.color ?? "violet"])}>
                    {p.code}
                  </div>
                  <span className="font-medium">{p.name}</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">Default Routing Template</Label>
                    <Input value={form.defaultRoutingTemplate ?? p.defaultRoutingTemplate ?? ""} onChange={e => setForm(f => ({ ...f, defaultRoutingTemplate: e.target.value }))} placeholder="e.g. PK-FC-RTP" data-testid={`input-rt-default-${p.id}`} />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">Backup Routing Template</Label>
                    <Input value={form.backupRoutingTemplate ?? p.backupRoutingTemplate ?? ""} onChange={e => setForm(f => ({ ...f, backupRoutingTemplate: e.target.value }))} placeholder="e.g. PK-FC-Backup" data-testid={`input-rt-backup-${p.id}`} />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => updateMut.mutate({ id: p.id, data: form })} disabled={updateMut.isPending} data-testid={`btn-save-rt-${p.id}`}>
                    <Check className="w-3.5 h-3.5 mr-1" /> Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setEditing(null); setForm({}); }} data-testid={`btn-cancel-rt-${p.id}`}>Cancel</Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-4">
                <div className={cn("w-8 h-8 rounded flex items-center justify-center text-xs font-bold border shrink-0", PRODUCT_COLORS[p.color ?? "violet"])}>
                  {p.code}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">{p.name}</div>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="text-xs text-muted-foreground">
                      Default: <span className="font-mono text-foreground">{p.defaultRoutingTemplate || "—"}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Backup: <span className="font-mono text-foreground">{p.backupRoutingTemplate || "—"}</span>
                    </span>
                  </div>
                </div>
                <Button size="sm" variant="ghost" className="h-7" onClick={() => { setEditing(p.id); setForm({}); }} data-testid={`btn-edit-rt-${p.id}`}>
                  <Edit2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            )}
          </div>
        ))}
        {products.length === 0 && <div className="p-6 text-center text-sm text-muted-foreground">No products configured</div>}
      </div>
    </div>
  );
}

// ── Pricing Templates Tab ─────────────────────────────────────────────────────
function PricingTemplatesTab({ products }: { products: Product[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState<number | null>(null);
  const [form, setForm] = useState<Partial<Product>>({});

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      apiRequest("PUT", `/api/product-registry/products/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/product-registry/products"] });
      setEditing(null); setForm({});
      toast({ title: "Pricing template saved" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );

  return (
    <div className="p-6 space-y-4 max-w-3xl">
      <div className="space-y-1">
        <h2 className="font-semibold">Pricing Templates</h2>
        <p className="text-sm text-muted-foreground">Define margin rules and KAM offer windows per product. KAMs never see vendor cost — only the offer window.</p>
      </div>
      <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-4 py-2.5 flex items-start gap-2.5">
        <Shield className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <p className="text-xs text-amber-300">Management access only. KAMs are shown offer window (Min/Target/Premium) — never vendor cost or true margin.</p>
      </div>
      <div className="bg-card border border-border rounded-lg divide-y divide-border">
        {products.map(p => {
          const ef = { ...p, ...form };
          return (
            <div key={p.id} className="px-4 py-4">
              {editing === p.id ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <div className={cn("w-8 h-8 rounded flex items-center justify-center text-xs font-bold border", PRODUCT_COLORS[p.color ?? "violet"])}>
                      {p.code}
                    </div>
                    <span className="font-medium">{p.name}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="Min Margin %">
                      <Input type="number" value={ef.minMarginPct ?? 0} onChange={e => setForm(f => ({ ...f, minMarginPct: parseFloat(e.target.value) }))} data-testid={`input-pt-margin-${p.id}`} />
                    </Field>
                    <Field label="Discount Min %">
                      <Input type="number" value={ef.discountRangeMin ?? ""} onChange={e => setForm(f => ({ ...f, discountRangeMin: parseFloat(e.target.value) }))} data-testid={`input-pt-disc-min-${p.id}`} />
                    </Field>
                    <Field label="Discount Max %">
                      <Input type="number" value={ef.discountRangeMax ?? ""} onChange={e => setForm(f => ({ ...f, discountRangeMax: parseFloat(e.target.value) }))} data-testid={`input-pt-disc-max-${p.id}`} />
                    </Field>
                    <Field label="Offer Window Min">
                      <Input type="number" step="0.0001" value={ef.offerWindowMin ?? ""} onChange={e => setForm(f => ({ ...f, offerWindowMin: parseFloat(e.target.value) }))} data-testid={`input-pt-offer-min-${p.id}`} />
                    </Field>
                    <Field label="Offer Window Target">
                      <Input type="number" step="0.0001" value={ef.offerWindowTarget ?? ""} onChange={e => setForm(f => ({ ...f, offerWindowTarget: parseFloat(e.target.value) }))} data-testid={`input-pt-offer-target-${p.id}`} />
                    </Field>
                    <Field label="Offer Window Premium">
                      <Input type="number" step="0.0001" value={ef.offerWindowPremium ?? ""} onChange={e => setForm(f => ({ ...f, offerWindowPremium: parseFloat(e.target.value) }))} data-testid={`input-pt-offer-premium-${p.id}`} />
                    </Field>
                    <Field label="Notice Period (days)">
                      <Input type="number" value={ef.noticePeriodDays ?? 7} onChange={e => setForm(f => ({ ...f, noticePeriodDays: parseInt(e.target.value) }))} data-testid={`input-pt-notice-${p.id}`} />
                    </Field>
                    <Field label="Pricing Template">
                      <Input value={ef.defaultPricingTemplate ?? ""} onChange={e => setForm(f => ({ ...f, defaultPricingTemplate: e.target.value }))} placeholder="e.g. Wholesale+15%" data-testid={`input-pt-template-${p.id}`} />
                    </Field>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => updateMut.mutate({ id: p.id, data: form })} disabled={updateMut.isPending} data-testid={`btn-save-pt-${p.id}`}>
                      <Check className="w-3.5 h-3.5 mr-1" /> Save
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => { setEditing(null); setForm({}); }} data-testid={`btn-cancel-pt-${p.id}`}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-4">
                  <div className={cn("w-8 h-8 rounded flex items-center justify-center text-xs font-bold border shrink-0 mt-0.5", PRODUCT_COLORS[p.color ?? "violet"])}>
                    {p.code}
                  </div>
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="font-medium text-sm">{p.name}</div>
                    <div className="grid grid-cols-3 gap-x-6 gap-y-1 text-xs">
                      <span className="text-muted-foreground">Min Margin: <strong className="text-foreground">{p.minMarginPct ?? 0}%</strong></span>
                      <span className="text-muted-foreground">Discount: <strong className="text-foreground">{p.discountRangeMin ?? "—"}–{p.discountRangeMax ?? "—"}%</strong></span>
                      <span className="text-muted-foreground">Notice: <strong className="text-foreground">{p.noticePeriodDays ?? 7}d</strong></span>
                      <span className="text-muted-foreground">Offer Min: <strong className="text-foreground">{p.offerWindowMin ?? "—"}</strong></span>
                      <span className="text-muted-foreground">Target: <strong className="text-foreground">{p.offerWindowTarget ?? "—"}</strong></span>
                      <span className="text-muted-foreground">Premium: <strong className="text-foreground">{p.offerWindowPremium ?? "—"}</strong></span>
                    </div>
                    {p.defaultPricingTemplate && (
                      <div className="text-xs text-muted-foreground">Template: <span className="font-mono text-foreground">{p.defaultPricingTemplate}</span></div>
                    )}
                  </div>
                  <Button size="sm" variant="ghost" className="h-7 shrink-0" onClick={() => { setEditing(p.id); setForm({}); }} data-testid={`btn-edit-pt-${p.id}`}>
                    <Edit2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              )}
            </div>
          );
        })}
        {products.length === 0 && <div className="p-6 text-center text-sm text-muted-foreground">No products configured</div>}
      </div>
    </div>
  );
}

// ── History Tab ───────────────────────────────────────────────────────────────
function HistoryTab({ history, products, destinations }: {
  history: HistoryEntry[]; products: Product[]; destinations: Destination[];
}) {
  const EVENT_ICONS: Record<string, { icon: typeof Zap; color: string }> = {
    product_created:    { icon: Plus,           color: "text-emerald-400" },
    product_updated:    { icon: Edit2,          color: "text-blue-400"    },
    destination_created:{ icon: Globe,          color: "text-violet-400"  },
    destination_updated:{ icon: Edit2,          color: "text-blue-400"    },
    destination_assigned: { icon: ArrowRight,   color: "text-emerald-400" },
    destination_removed:  { icon: X,            color: "text-rose-400"    },
  };

  return (
    <div className="p-6 max-w-3xl space-y-4">
      <div>
        <h2 className="font-semibold">Audit History</h2>
        <p className="text-sm text-muted-foreground">All product and destination changes, chronological order</p>
      </div>
      {history.length === 0 && (
        <div className="bg-card border border-border rounded-lg p-8 text-center text-muted-foreground">
          <History className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No history yet</p>
        </div>
      )}
      <div className="relative space-y-0">
        {history.map((entry, i) => {
          const conf = EVENT_ICONS[entry.eventType] ?? { icon: Clock, color: "text-muted-foreground" };
          const Icon = conf.icon;
          return (
            <div key={entry.id} data-testid={`history-entry-${entry.id}`} className="flex gap-3 pb-4">
              <div className="flex flex-col items-center">
                <div className={cn("w-7 h-7 rounded-full border border-border bg-card flex items-center justify-center shrink-0", conf.color)}>
                  <Icon className="w-3.5 h-3.5" />
                </div>
                {i < history.length - 1 && <div className="w-px flex-1 bg-border mt-1" />}
              </div>
              <div className="flex-1 min-w-0 pt-1 pb-1">
                <div className="flex items-start gap-2">
                  <span className="text-sm">{entry.description}</span>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-muted-foreground">
                    {new Date(entry.createdAt).toLocaleString()}
                  </span>
                  {entry.performedBy && (
                    <span className="text-xs text-muted-foreground">· {entry.performedBy}</span>
                  )}
                  <Badge variant="outline" className="text-xs h-4 px-1.5">{entry.eventType.replace(/_/g, " ")}</Badge>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ProductRegistryPage() {
  const [activeTab, setActiveTab] = useState<TabId>("dashboard");

  const { data: products = [], refetch: refetchProducts } = useQuery<Product[]>({
    queryKey: ["/api/product-registry/products"],
  });
  const { data: destinations = [] } = useQuery<Destination[]>({
    queryKey: ["/api/product-registry/destinations"],
  });
  const { data: assignments = [] } = useQuery<Assignment[]>({
    queryKey: ["/api/product-registry/assignments"],
  });
  const { data: history = [] } = useQuery<HistoryEntry[]>({
    queryKey: ["/api/product-registry/history"],
    enabled: activeTab === "history",
  });

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Internal Tab Bar */}
      <div className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur-sm flex-shrink-0">
        <div className="flex items-center gap-0 px-4 h-11">
          <div className="flex items-center gap-1.5 mr-4 pr-4 border-r border-border/50 text-xs font-medium text-muted-foreground shrink-0">
            <Package className="w-3.5 h-3.5 text-violet-400" />
            <span className="hidden sm:inline">Products & Destinations</span>
          </div>
          <div className="flex items-center gap-0.5 overflow-x-auto scrollbar-none">
            {TABS.map(tab => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  data-testid={`tab-${tab.id}`}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap",
                    activeTab === tab.id
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                  )}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Tab Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === "dashboard" && (
          <div className="h-full overflow-y-auto">
            <DashboardTab products={products} assignments={assignments} destinations={destinations} />
          </div>
        )}
        {activeTab === "products" && (
          <div className="h-full overflow-hidden">
            <ProductCatalogTab products={products} onRefresh={refetchProducts} />
          </div>
        )}
        {activeTab === "destinations" && (
          <div className="h-full overflow-hidden">
            <DestinationCatalogTab destinations={destinations} products={products} assignments={assignments} />
          </div>
        )}
        {activeTab === "assignments" && (
          <div className="h-full overflow-hidden">
            <AssignmentsTab products={products} destinations={destinations} assignments={assignments} />
          </div>
        )}
        {activeTab === "routing" && (
          <div className="h-full overflow-y-auto">
            <RoutingTemplatesTab products={products} />
          </div>
        )}
        {activeTab === "pricing" && (
          <div className="h-full overflow-y-auto">
            <PricingTemplatesTab products={products} />
          </div>
        )}
        {activeTab === "history" && (
          <div className="h-full overflow-y-auto">
            <HistoryTab history={history} products={products} destinations={destinations} />
          </div>
        )}
      </div>
    </div>
  );
}

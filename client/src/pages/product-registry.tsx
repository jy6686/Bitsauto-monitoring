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
  ArrowRight, CheckCircle2, XCircle, History, RefreshCw,
  Users, LayoutGrid, GanttChart, UserCheck, Building2,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────
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
interface DestinationNode extends Destination { children: DestinationNode[]; }
interface Assignment { id: number; productId: number; destinationId: number; status: string; }
interface CustomerAssignment { id: number; productId: number; iAccount: number; customerName?: string; status: string; }
interface HistoryEntry {
  id: number; productId?: number; destinationId?: number;
  eventType: string; description: string; performedBy?: string; createdAt: string;
}
interface SippyAccount { i_account: number; id?: string; username?: string; }

// ── Constants ─────────────────────────────────────────────────────────────────
const TABS = [
  { id: "dashboard",    label: "Dashboard",            icon: BarChart2  },
  { id: "products",     label: "Product Catalog",      icon: Package    },
  { id: "destinations", label: "Destination Catalog",  icon: Globe      },
  { id: "assignments",  label: "Assignments",          icon: Layers     },
  { id: "customers",    label: "Customer Assignments", icon: Users      },
  { id: "routing",      label: "Routing Templates",    icon: Network    },
  { id: "pricing",      label: "Pricing Templates",    icon: TrendingUp },
  { id: "history",      label: "History",              icon: History    },
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

// Product lifecycle — ordered progression
const LIFECYCLE_STATES = [
  { value: "draft",      label: "Draft",       color: "bg-slate-500/15 text-slate-400 border-slate-500/30" },
  { value: "testing",    label: "Testing",     color: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30" },
  { value: "commercial", label: "Commercial",  color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  { value: "deprecated", label: "Deprecated",  color: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  { value: "retired",    label: "Retired",     color: "bg-rose-500/15 text-rose-400 border-rose-500/30" },
];

const DEST_STATUS_COLORS: Record<string, string> = {
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
    if (d.parentId && map.has(d.parentId)) map.get(d.parentId)!.children.push(map.get(d.id)!);
    else roots.push(map.get(d.id)!);
  });
  return roots;
}

function lifecycleBadge(status: string) {
  const lc = LIFECYCLE_STATES.find(s => s.value === status);
  return lc
    ? <span className={cn("text-xs px-1.5 py-0.5 rounded border", lc.color)}>{lc.label}</span>
    : <span className="text-xs px-1.5 py-0.5 rounded border bg-muted text-muted-foreground">{status}</span>;
}

// ── Destination Tree Node (shared) ────────────────────────────────────────────
function DestTreeNode({
  node, depth = 0, selectedId, onSelect,
  isDragOver, onDragOver, onDragLeave, onDrop, draggedProduct,
}: {
  node: DestinationNode; depth?: number; selectedId?: number;
  onSelect: (d: DestinationNode) => void;
  isDragOver?: (id: number) => boolean;
  onDragOver?: (e: React.DragEvent, id: number) => void;
  onDragLeave?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent, id: number) => void;
  draggedProduct?: Product | null;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const isOver = isDragOver?.(node.id) ?? false;
  const isSelected = selectedId === node.id;
  const hasChildren = node.children.length > 0;
  return (
    <div>
      <div
        data-testid={`dest-node-${node.id}`}
        className={cn(
          "flex items-center gap-1.5 px-2 py-1.5 rounded cursor-pointer text-sm select-none transition-colors",
          isSelected && "bg-primary/10 text-primary",
          isOver && "bg-violet-500/20 ring-1 ring-violet-500/40",
          !isSelected && !isOver && "hover:bg-muted/60",
        )}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={() => onSelect(node)}
        onDragOver={e => { e.preventDefault(); onDragOver?.(e, node.id); }}
        onDragLeave={onDragLeave}
        onDrop={e => onDrop?.(e, node.id)}
      >
        <button onClick={e => { e.stopPropagation(); setExpanded(v => !v); }} className="w-4 h-4 flex items-center justify-center shrink-0">
          {hasChildren ? (expanded ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />) : <span className="w-3" />}
        </button>
        <Globe className={cn("w-3.5 h-3.5 shrink-0", node.level === 1 ? "text-blue-400" : node.level === 2 ? "text-emerald-400" : "text-amber-400")} />
        <span className="flex-1 truncate font-medium">{node.name}</span>
        {node.dialPrefix && <span className="text-xs text-muted-foreground font-mono shrink-0">{node.dialPrefix}</span>}
        <span className={cn("text-xs px-1 py-0.5 rounded shrink-0", DEST_STATUS_COLORS[node.commercialStatus] ?? "bg-muted")}>{node.commercialStatus}</span>
        {isOver && draggedProduct && <span className="text-xs text-violet-400 shrink-0">Drop</span>}
      </div>
      {expanded && hasChildren && (
        <div>
          {node.children.map(c => (
            <DestTreeNode key={c.id} node={c} depth={depth + 1} selectedId={selectedId} onSelect={onSelect}
              isDragOver={isDragOver} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop} draggedProduct={draggedProduct} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Dashboard Tab ─────────────────────────────────────────────────────────────
function DashboardTab({ products, assignments, destinations, customerAssignments }: {
  products: Product[]; assignments: Assignment[]; destinations: Destination[]; customerAssignments: CustomerAssignment[];
}) {
  const assignedDest = (pid: number) => assignments.filter(a => a.productId === pid && a.status === "active").length;
  const assignedCustomers = (pid: number) => customerAssignments.filter(a => a.productId === pid && a.status === "active").length;
  const approvedDests = destinations.filter(d => d.commercialStatus === "approved").length;
  const commercialProds = products.filter(p => p.status === "commercial").length;

  const riskLevel = (p: Product) => {
    const m = p.minMarginPct ?? 0;
    if (m >= 15) return { label: "Healthy", color: "text-emerald-400", bg: "bg-emerald-500/10" };
    if (m >= 10) return { label: "Warning", color: "text-amber-400",   bg: "bg-amber-500/10" };
    return        { label: "At Risk",  color: "text-rose-400",    bg: "bg-rose-500/10" };
  };

  return (
    <div className="p-6 space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Commercial Products", value: commercialProds,       total: products.length,       icon: Package,      color: "text-violet-400" },
          { label: "Approved Destinations",value: approvedDests,        total: destinations.length,   icon: Globe,        color: "text-blue-400"   },
          { label: "Active Assignments",   value: assignments.filter(a => a.status === "active").length, total: null, icon: Layers, color: "text-emerald-400" },
          { label: "Customer Assignments", value: customerAssignments.filter(a => a.status === "active").length, total: null, icon: Users, color: "text-amber-400" },
        ].map(c => (
          <div key={c.label} className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground">{c.label}</span>
              <c.icon className={cn("w-4 h-4", c.color)} />
            </div>
            <div className="text-2xl font-bold">{c.value}</div>
            {c.total !== null && <div className="text-xs text-muted-foreground mt-0.5">of {c.total} total</div>}
          </div>
        ))}
      </div>

      {/* Hierarchy reminder */}
      <div className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
          {["Customer", "Product", "Destination", "Routing Template", "Pricing Template", "Rate", "Deal"].map((label, i, arr) => (
            <div key={label} className="flex items-center gap-2">
              <span className={cn("px-2 py-0.5 rounded border text-xs font-medium",
                i < 3 ? "border-violet-500/30 bg-violet-500/10 text-violet-400" :
                i < 5 ? "border-blue-500/30 bg-blue-500/10 text-blue-400" :
                "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
              )}>{label}</span>
              {i < arr.length - 1 && <ArrowRight className="w-3 h-3 opacity-40" />}
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-2">Commercial master-data hierarchy — master products and destinations here to power deal workspace, rate generation, and auth studio.</p>
      </div>

      {/* Product portfolio table */}
      <div className="bg-card border border-border rounded-lg">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-semibold">Product Portfolio</h3>
          <span className="text-xs text-muted-foreground">Only Commercial products appear in deal workspace & auth studio</span>
        </div>
        <div className="divide-y divide-border">
          {products.length === 0 && <div className="p-6 text-center text-muted-foreground text-sm">No products configured</div>}
          {products.map(p => {
            const risk = riskLevel(p);
            return (
              <div key={p.id} className="px-4 py-3 flex items-center gap-4">
                <div className={cn("px-2 py-0.5 rounded text-xs font-bold border", PRODUCT_COLORS[p.color ?? "violet"])}>{p.code}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{p.name}</span>
                    {lifecycleBadge(p.status)}
                  </div>
                  {p.description && <div className="text-xs text-muted-foreground truncate mt-0.5">{p.description}</div>}
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  <div className="font-medium text-foreground">{assignedDest(p.id)} dests</div>
                  <div>{assignedCustomers(p.id)} customers</div>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  <div className="font-medium text-foreground">{p.minMarginPct ?? 0}%</div>
                  <div>min margin</div>
                </div>
                <div className={cn("px-2 py-0.5 rounded text-xs font-medium", risk.bg, risk.color)}>{risk.label}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Product Catalog Tab ───────────────────────────────────────────────────────
function ProductCatalogTab({ products }: { products: Product[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<Partial<Product>>({});

  const selected = products.find(p => p.id === selectedId);
  const editForm = selected ? { ...selected, ...form } : form;

  const createMut = useMutation({
    mutationFn: (data: Partial<Product>) => apiRequest("POST", "/api/product-registry/products", data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/product-registry/products"] }); setCreating(false); setForm({}); toast({ title: "Product created" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest("PUT", `/api/product-registry/products/${id}`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/product-registry/products"] }); toast({ title: "Saved" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/product-registry/products/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/product-registry/products"] }); setSelectedId(null); toast({ title: "Deleted" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="space-y-1"><Label className="text-xs text-muted-foreground">{label}</Label>{children}</div>
  );

  return (
    <div className="flex h-full">
      {/* Left list */}
      <div className="w-64 shrink-0 border-r border-border flex flex-col">
        <div className="p-3 border-b border-border flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Products</span>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { setCreating(true); setSelectedId(null); setForm({ status: "draft" }); }} data-testid="btn-create-product">
            <Plus className="w-4 h-4" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {products.map(p => (
            <button key={p.id} data-testid={`product-item-${p.id}`}
              className={cn("w-full text-left px-3 py-2.5 flex items-center gap-2.5 hover:bg-muted/60 transition-colors", selectedId === p.id && "bg-primary/10")}
              onClick={() => { setSelectedId(p.id); setCreating(false); setForm({}); }}>
              <div className={cn("w-8 h-8 rounded flex items-center justify-center text-xs font-bold border shrink-0", PRODUCT_COLORS[p.color ?? "violet"])}>{p.code}</div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{p.name}</div>
                <div className="mt-0.5">{lifecycleBadge(p.status)}</div>
              </div>
            </button>
          ))}
          {products.length === 0 && <div className="p-4 text-center text-xs text-muted-foreground">No products yet</div>}
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 overflow-y-auto">
        {!selected && !creating && (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-3">
            <Package className="w-10 h-10 opacity-30" />
            <p className="text-sm">Select a product or create a new one</p>
            <Button size="sm" onClick={() => { setCreating(true); setForm({ status: "draft" }); }} data-testid="btn-create-product-empty">
              <Plus className="w-3.5 h-3.5 mr-1.5" /> New Product
            </Button>
          </div>
        )}
        {(selected || creating) && (
          <div className="p-6 space-y-5 max-w-2xl">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-lg">{creating ? "New Product" : selected?.name}</h2>
              {selected && <Button size="sm" variant="destructive" onClick={() => deleteMut.mutate(selected.id)} data-testid="btn-delete-product"><Trash2 className="w-3.5 h-3.5 mr-1.5" />Delete</Button>}
            </div>

            {/* Lifecycle stepper */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Product Lifecycle</Label>
              <div className="flex items-center gap-0">
                {LIFECYCLE_STATES.map((ls, i) => {
                  const current = (editForm.status ?? "draft") === ls.value;
                  return (
                    <button key={ls.value} data-testid={`lifecycle-${ls.value}`}
                      onClick={() => setForm(f => ({ ...f, status: ls.value }))}
                      className={cn("flex-1 py-1.5 text-xs font-medium border transition-colors",
                        i === 0 ? "rounded-l-md" : "", i === LIFECYCLE_STATES.length - 1 ? "rounded-r-md" : "",
                        current ? ls.color + " border-current" : "border-border text-muted-foreground hover:bg-muted/50"
                      )}>
                      {ls.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">Only <strong>Commercial</strong> products appear in deal workspace, auth studio, and rate generation.</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Code (immutable — e.g. FC)">
                <Input value={creating ? form.code ?? "" : editForm.code ?? ""} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} disabled={!creating} data-testid="input-product-code" />
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
                <Input type="number" value={editForm.discountRangeMin ?? ""} onChange={e => setForm(f => ({ ...f, discountRangeMin: parseFloat(e.target.value) }))} data-testid="input-disc-min" />
              </Field>
              <Field label="Discount Max %">
                <Input type="number" value={editForm.discountRangeMax ?? ""} onChange={e => setForm(f => ({ ...f, discountRangeMax: parseFloat(e.target.value) }))} data-testid="input-disc-max" />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Notice Period (days)">
                <Input type="number" value={editForm.noticePeriodDays ?? 7} onChange={e => setForm(f => ({ ...f, noticePeriodDays: parseInt(e.target.value) }))} data-testid="input-notice" />
              </Field>
              <Field label="Colour Tag">
                <div className="flex gap-2 pt-1">
                  {Object.keys(PRODUCT_COLORS).map(c => (
                    <button key={c} data-testid={`color-${c}`}
                      className={cn("w-6 h-6 rounded-full transition-transform shrink-0",
                        `bg-${c}-400`, editForm.color === c ? "ring-2 ring-offset-1 ring-white scale-110" : "opacity-60 hover:opacity-100")}
                      onClick={() => setForm(f => ({ ...f, color: c }))} />
                  ))}
                </div>
              </Field>
            </div>

            <div className="pt-2 border-t border-border">
              <h3 className="text-sm font-semibold mb-3">KAM Offer Window</h3>
              <div className="grid grid-cols-3 gap-4">
                <Field label="Minimum"><Input type="number" step="0.0001" value={editForm.offerWindowMin ?? ""} onChange={e => setForm(f => ({ ...f, offerWindowMin: parseFloat(e.target.value) }))} data-testid="input-offer-min" /></Field>
                <Field label="Target"> <Input type="number" step="0.0001" value={editForm.offerWindowTarget ?? ""} onChange={e => setForm(f => ({ ...f, offerWindowTarget: parseFloat(e.target.value) }))} data-testid="input-offer-target" /></Field>
                <Field label="Premium"><Input type="number" step="0.0001" value={editForm.offerWindowPremium ?? ""} onChange={e => setForm(f => ({ ...f, offerWindowPremium: parseFloat(e.target.value) }))} data-testid="input-offer-premium" /></Field>
              </div>
              <p className="text-xs text-muted-foreground mt-2">KAMs negotiate within this window — vendor cost and true margin are never exposed.</p>
            </div>

            <div className="pt-2 border-t border-border">
              <h3 className="text-sm font-semibold mb-3">Templates</h3>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Default Routing"><Input value={editForm.defaultRoutingTemplate ?? ""} onChange={e => setForm(f => ({ ...f, defaultRoutingTemplate: e.target.value }))} placeholder="e.g. PK-FC-RTP" data-testid="input-routing-tpl" /></Field>
                <Field label="Backup Routing"> <Input value={editForm.backupRoutingTemplate ?? ""} onChange={e => setForm(f => ({ ...f, backupRoutingTemplate: e.target.value }))} placeholder="e.g. PK-FC-Backup" data-testid="input-backup-tpl" /></Field>
                <Field label="Pricing Template"><Input value={editForm.defaultPricingTemplate ?? ""} onChange={e => setForm(f => ({ ...f, defaultPricingTemplate: e.target.value }))} placeholder="e.g. Wholesale+15%" data-testid="input-pricing-tpl" /></Field>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <Button onClick={() => { if (creating) createMut.mutate(form); else if (selected) updateMut.mutate({ id: selected.id, data: form }); }}
                disabled={createMut.isPending || updateMut.isPending} data-testid="btn-save-product">
                {createMut.isPending || updateMut.isPending ? <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Check className="w-3.5 h-3.5 mr-1.5" />}
                {creating ? "Create Product" : "Save Changes"}
              </Button>
              <Button variant="ghost" onClick={() => { setCreating(false); setSelectedId(null); setForm({}); }} data-testid="btn-cancel-product">Cancel</Button>
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
    return nodes.reduce<DestinationNode[]>((acc, n) => {
      const match = n.name.toLowerCase().includes(q.toLowerCase()) || n.dialPrefix?.includes(q);
      const children = filterTree(n.children, q);
      if (match || children.length > 0) acc.push({ ...n, children });
      return acc;
    }, []);
  };

  const saveMut = useMutation({
    mutationFn: (data: any) => data.id
      ? apiRequest("PUT", `/api/product-registry/destinations/${data.id}`, data)
      : apiRequest("POST", "/api/product-registry/destinations", data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/product-registry/destinations"] }); setCreating(false); setForm({}); toast({ title: "Saved" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/product-registry/destinations/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/product-registry/destinations"] }); setSelectedNode(null); toast({ title: "Deleted" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const assignedProducts = (destId: number) =>
    products.filter(p => assignments.some(a => a.productId === p.id && a.destinationId === destId && a.status === "active"));

  const editForm = selectedNode ? { ...selectedNode, ...form } : form;
  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="space-y-1"><Label className="text-xs text-muted-foreground">{label}</Label>{children}</div>
  );

  return (
    <div className="flex h-full">
      <div className="w-72 shrink-0 border-r border-border flex flex-col">
        <div className="p-3 border-b border-border space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Global Catalog</span>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { setCreating(true); setSelectedNode(null); setForm({}); }} data-testid="btn-add-destination"><Plus className="w-4 h-4" /></Button>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-muted-foreground" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" className="h-8 pl-8 text-sm" data-testid="input-dest-search" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {filterTree(tree, search).map(n => (
            <DestTreeNode key={n.id} node={n} selectedId={selectedNode?.id} onSelect={n2 => { setSelectedNode(n2); setCreating(false); setForm({}); }} />
          ))}
          {destinations.length === 0 && <div className="p-4 text-center text-xs text-muted-foreground">No destinations yet</div>}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {!selectedNode && !creating && (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-3">
            <Globe className="w-10 h-10 opacity-30" />
            <p className="text-sm">Select a destination or add a new one</p>
            <Button size="sm" onClick={() => setCreating(true)} data-testid="btn-add-dest-empty"><Plus className="w-3.5 h-3.5 mr-1.5" />Add Destination</Button>
          </div>
        )}
        {(selectedNode || creating) && (
          <div className="p-6 space-y-5 max-w-xl">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-lg">{creating ? "New Destination" : selectedNode?.name}</h2>
              {selectedNode && <Button size="sm" variant="destructive" onClick={() => deleteMut.mutate(selectedNode.id)} data-testid="btn-delete-dest"><Trash2 className="w-3.5 h-3.5 mr-1.5" />Delete</Button>}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Name"><Input value={editForm.name ?? ""} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} data-testid="input-dest-name" /></Field>
              <Field label="Level (1=Country, 2=Type, 3=Operator)"><Input type="number" min={1} max={4} value={editForm.level ?? 1} onChange={e => setForm(f => ({ ...f, level: parseInt(e.target.value) }))} data-testid="input-dest-level" /></Field>
              <Field label="Country Code"><Input value={editForm.countryCode ?? ""} maxLength={4} onChange={e => setForm(f => ({ ...f, countryCode: e.target.value }))} placeholder="PK" data-testid="input-dest-cc" /></Field>
              <Field label="Dial Prefix"><Input value={editForm.dialPrefix ?? ""} onChange={e => setForm(f => ({ ...f, dialPrefix: e.target.value }))} placeholder="9230" data-testid="input-dest-prefix" /></Field>
              <Field label="Operator Name"><Input value={editForm.operatorName ?? ""} onChange={e => setForm(f => ({ ...f, operatorName: e.target.value }))} placeholder="Jazz" data-testid="input-dest-operator" /></Field>
              <Field label="Commercial Status">
                <select value={editForm.commercialStatus ?? "pending"} onChange={e => setForm(f => ({ ...f, commercialStatus: e.target.value }))}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm" data-testid="select-dest-status">
                  {["approved","blocked","testing","deprecated","pending"].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
            </div>
            {!creating && selectedNode && (
              <div className="pt-3 border-t border-border">
                <h3 className="text-sm font-semibold mb-3">Product Availability</h3>
                <div className="grid grid-cols-2 gap-2">
                  {products.map(p => {
                    const assigned = assignments.some(a => a.productId === p.id && a.destinationId === selectedNode.id && a.status === "active");
                    return (
                      <div key={p.id} className={cn("flex items-center gap-2 px-3 py-2 rounded border",
                        assigned ? "border-emerald-500/30 bg-emerald-500/5" : "border-border bg-muted/20")}>
                        <div className={cn("w-7 h-7 rounded flex items-center justify-center text-xs font-bold border", PRODUCT_COLORS[p.color ?? "violet"])}>{p.code}</div>
                        <span className="text-sm flex-1">{p.name}</span>
                        {assigned ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <XCircle className="w-4 h-4 text-muted-foreground/40" />}
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground mt-2">Use the <strong>Assignments</strong> tab to drag & drop products onto destinations.</p>
              </div>
            )}
            <div className="flex gap-2 pt-2">
              <Button onClick={() => saveMut.mutate(creating ? form : { ...form, id: selectedNode?.id })} disabled={saveMut.isPending} data-testid="btn-save-dest">
                {saveMut.isPending ? <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Check className="w-3.5 h-3.5 mr-1.5" />}
                {creating ? "Add Destination" : "Save Changes"}
              </Button>
              <Button variant="ghost" onClick={() => { setCreating(false); setSelectedNode(null); setForm({}); }} data-testid="btn-cancel-dest">Cancel</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Assignments Tab — Drag & Drop + Matrix View ───────────────────────────────
function AssignmentsTab({ products, destinations, assignments }: {
  products: Product[]; destinations: Destination[]; assignments: Assignment[];
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [viewMode, setViewMode] = useState<"dnd" | "matrix">("dnd");
  const [draggedProduct, setDraggedProduct] = useState<Product | null>(null);
  const [overDestId, setOverDestId] = useState<number | null>(null);
  const dragLeaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const assignMut = useMutation({
    mutationFn: ({ productId, destinationId }: { productId: number; destinationId: number }) =>
      apiRequest("POST", "/api/product-registry/assignments", { productId, destinationId }),
    onSuccess: (_, v) => {
      qc.invalidateQueries({ queryKey: ["/api/product-registry/assignments"] });
      qc.invalidateQueries({ queryKey: ["/api/product-registry/history"] });
      const p = products.find(x => x.id === v.productId);
      const d = destinations.find(x => x.id === v.destinationId);
      toast({ title: `Assigned: ${p?.name} → ${d?.name}` });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const removeMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/product-registry/assignments/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/product-registry/assignments"] }); qc.invalidateQueries({ queryKey: ["/api/product-registry/history"] }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const tree = buildTree(destinations);
  const handleDragOver = useCallback((e: React.DragEvent, id: number) => { e.preventDefault(); if (dragLeaveTimer.current) clearTimeout(dragLeaveTimer.current); setOverDestId(id); }, []);
  const handleDragLeave = useCallback((_e: React.DragEvent) => { dragLeaveTimer.current = setTimeout(() => setOverDestId(null), 80); }, []);
  const handleDrop = useCallback((e: React.DragEvent, destinationId: number) => { e.preventDefault(); setOverDestId(null); if (!draggedProduct) return; assignMut.mutate({ productId: draggedProduct.id, destinationId }); setDraggedProduct(null); }, [draggedProduct, assignMut]);
  const getAssignment = (productId: number, destinationId: number) => assignments.find(a => a.productId === productId && a.destinationId === destinationId && a.status === "active");

  // Flat list of all destinations for matrix (leaf nodes preferred, but show all)
  const matrixDests = destinations.filter(d => d.level >= 2);

  return (
    <div className="flex flex-col h-full">
      {/* View toggle */}
      <div className="px-4 py-2 border-b border-border flex items-center gap-3">
        <span className="text-xs text-muted-foreground font-medium">View:</span>
        <div className="flex bg-muted rounded-md p-0.5 gap-0.5">
          <button onClick={() => setViewMode("dnd")} data-testid="view-dnd"
            className={cn("flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-colors",
              viewMode === "dnd" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
            <GanttChart className="w-3.5 h-3.5" /> Drag & Drop
          </button>
          <button onClick={() => setViewMode("matrix")} data-testid="view-matrix"
            className={cn("flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-colors",
              viewMode === "matrix" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
            <LayoutGrid className="w-3.5 h-3.5" /> Availability Matrix
          </button>
        </div>
        {viewMode === "dnd" && draggedProduct && (
          <div className={cn("flex items-center gap-2 px-3 py-1 rounded border text-xs font-medium", PRODUCT_COLORS[draggedProduct.color ?? "violet"])}>
            <GripVertical className="w-3 h-3" /> Dragging: {draggedProduct.name}
          </div>
        )}
      </div>

      {/* DnD view */}
      {viewMode === "dnd" && (
        <div className="flex flex-1 min-h-0">
          {/* Products */}
          <div className="w-56 shrink-0 border-r border-border flex flex-col">
            <div className="px-3 py-2.5 border-b border-border">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Products</span>
              <p className="text-xs text-muted-foreground mt-0.5">Drag onto destinations →</p>
            </div>
            <div className="flex-1 overflow-y-auto py-2 space-y-1.5 px-2">
              {products.map(p => (
                <div key={p.id} data-testid={`draggable-product-${p.id}`}
                  draggable onDragStart={() => setDraggedProduct(p)} onDragEnd={() => setDraggedProduct(null)}
                  className={cn("flex items-center gap-2.5 px-3 py-2.5 rounded-lg border cursor-grab active:cursor-grabbing select-none transition-all",
                    PRODUCT_COLORS[p.color ?? "violet"], draggedProduct?.id === p.id && "opacity-50 scale-95")}>
                  <GripVertical className="w-3.5 h-3.5 opacity-50 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold">{p.code}</div>
                    <div className="text-xs font-medium truncate">{p.name}</div>
                    <div className="mt-0.5">{lifecycleBadge(p.status)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          {/* Destination tree */}
          <div className="flex-1 overflow-y-auto py-2 px-2">
            {tree.map(n => (
              <AssignDndNode key={n.id} node={n} depth={0}
                products={products} assignments={assignments}
                overDestId={overDestId} draggedProduct={draggedProduct}
                onDragOver={handleDragOver} onDragLeave={handleDragLeave}
                onDrop={handleDrop} onRemove={id => removeMut.mutate(id)} />
            ))}
            {tree.length === 0 && <div className="p-8 text-center text-muted-foreground"><Globe className="w-8 h-8 mx-auto mb-2 opacity-30" /><p className="text-sm">Add destinations first</p></div>}
          </div>
        </div>
      )}

      {/* Matrix view */}
      {viewMode === "matrix" && (
        <div className="flex-1 overflow-auto p-4">
          {matrixDests.length === 0 || products.length === 0 ? (
            <div className="text-center text-muted-foreground py-8 text-sm">No data yet — add destinations and products first</div>
          ) : (
            <table className="text-sm border-collapse w-full">
              <thead>
                <tr>
                  <th className="text-left py-2 px-3 font-medium text-muted-foreground border-b border-border bg-muted/30 sticky left-0 min-w-44">Destination</th>
                  {products.map(p => (
                    <th key={p.id} className="py-2 px-3 border-b border-border bg-muted/30 whitespace-nowrap">
                      <div className="flex flex-col items-center gap-1">
                        <div className={cn("w-8 h-8 rounded flex items-center justify-center text-xs font-bold border", PRODUCT_COLORS[p.color ?? "violet"])}>{p.code}</div>
                        <div className="text-xs text-muted-foreground">{lifecycleBadge(p.status)}</div>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrixDests.map(d => (
                  <tr key={d.id} className="hover:bg-muted/20 border-b border-border/50">
                    <td className="py-1.5 px-3 font-medium sticky left-0 bg-background">
                      <div className="flex items-center gap-1.5">
                        <Globe className={cn("w-3 h-3 shrink-0", d.level === 2 ? "text-emerald-400" : "text-amber-400")} />
                        <span>{d.name}</span>
                        {d.dialPrefix && <span className="text-xs font-mono text-muted-foreground">{d.dialPrefix}</span>}
                      </div>
                    </td>
                    {products.map(p => {
                      const a = getAssignment(p.id, d.id);
                      return (
                        <td key={p.id} className="py-1.5 px-3 text-center">
                          {a ? (
                            <button onClick={() => removeMut.mutate(a.id)} data-testid={`matrix-cell-${p.id}-${d.id}`}
                              className="w-7 h-7 rounded flex items-center justify-center mx-auto bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 hover:bg-rose-500/15 hover:border-rose-500/30 hover:text-rose-400 transition-colors"
                              title="Click to remove">
                              <Check className="w-3.5 h-3.5" />
                            </button>
                          ) : (
                            <button
                              onClick={() => assignMut.mutate({ productId: p.id, destinationId: d.id })}
                              data-testid={`matrix-assign-${p.id}-${d.id}`}
                              className="w-7 h-7 rounded flex items-center justify-center mx-auto border border-border text-muted-foreground/30 hover:border-emerald-500/40 hover:text-emerald-400 transition-colors"
                              title="Click to assign">
                              <Plus className="w-3 h-3" />
                            </button>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function AssignDndNode({ node, depth, products, assignments, overDestId, draggedProduct, onDragOver, onDragLeave, onDrop, onRemove }: {
  node: DestinationNode; depth: number; products: Product[]; assignments: Assignment[];
  overDestId: number | null; draggedProduct: Product | null;
  onDragOver: (e: React.DragEvent, id: number) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, id: number) => void;
  onRemove: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const isOver = overDestId === node.id;
  const nodeAssignments = assignments.filter(a => a.destinationId === node.id && a.status === "active");
  return (
    <div>
      <div data-testid={`drop-dest-${node.id}`}
        className={cn("flex items-center gap-2 px-2 py-2 rounded-lg transition-all mb-0.5", isOver ? "bg-violet-500/20 ring-1 ring-violet-500/40" : "hover:bg-muted/30")}
        style={{ marginLeft: `${depth * 20}px` }}
        onDragOver={e => onDragOver(e, node.id)} onDragLeave={onDragLeave} onDrop={e => onDrop(e, node.id)}>
        <button onClick={() => setExpanded(v => !v)} className="w-5 h-5 flex items-center justify-center shrink-0">
          {node.children.length > 0 ? (expanded ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />) : <span className="w-3.5" />}
        </button>
        <Globe className={cn("w-3.5 h-3.5 shrink-0", node.level === 1 ? "text-blue-400" : node.level === 2 ? "text-emerald-400" : "text-amber-400")} />
        <span className="text-sm font-medium flex-1">{node.name}</span>
        {node.dialPrefix && <span className="text-xs font-mono text-muted-foreground">{node.dialPrefix}</span>}
        <div className="flex items-center gap-1 ml-2">
          {nodeAssignments.map(a => {
            const prod = products.find(p => p.id === a.productId);
            if (!prod) return null;
            return (
              <span key={a.id} data-testid={`assignment-badge-${a.id}`}
                className={cn("flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-bold border", PRODUCT_COLORS[prod.color ?? "violet"])}>
                {prod.code}
                <button onClick={() => onRemove(a.id)} data-testid={`remove-assignment-${a.id}`} className="hover:text-rose-400 ml-0.5">
                  <X className="w-2.5 h-2.5" />
                </button>
              </span>
            );
          })}
          {isOver && draggedProduct && (
            <span className={cn("flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-bold border opacity-60 border-dashed", PRODUCT_COLORS[draggedProduct.color ?? "violet"])}>
              + {draggedProduct.code}
            </span>
          )}
        </div>
      </div>
      {expanded && node.children.length > 0 && (
        <div>{node.children.map(c => <AssignDndNode key={c.id} node={c} depth={depth + 1} products={products} assignments={assignments} overDestId={overDestId} draggedProduct={draggedProduct} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop} onRemove={onRemove} />)}</div>
      )}
    </div>
  );
}

// ── Customer Assignments Tab ──────────────────────────────────────────────────
function CustomerAssignmentsTab({ products, customerAssignments }: {
  products: Product[]; customerAssignments: CustomerAssignment[];
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [selectedAccount, setSelectedAccount] = useState<SippyAccount | null>(null);

  const { data: accountsData } = useQuery<{ accounts: SippyAccount[] }>({
    queryKey: ["/api/sippy/accounts"],
  });
  const accounts = accountsData?.accounts ?? [];

  const assignMut = useMutation({
    mutationFn: ({ productId, iAccount, customerName }: { productId: number; iAccount: number; customerName: string }) =>
      apiRequest("POST", "/api/product-registry/customer-assignments", { productId, iAccount, customerName }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/product-registry/customer-assignments"] }); qc.invalidateQueries({ queryKey: ["/api/product-registry/history"] }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const removeMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/product-registry/customer-assignments/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/product-registry/customer-assignments"] }); qc.invalidateQueries({ queryKey: ["/api/product-registry/history"] }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const filteredAccounts = accounts.filter(a =>
    !search || (a.id ?? "").toLowerCase().includes(search.toLowerCase()) || String(a.i_account).includes(search)
  );

  const getAssignment = (productId: number, iAccount: number) =>
    customerAssignments.find(a => a.productId === productId && a.iAccount === iAccount && a.status === "active");

  const customerProductCount = (iAccount: number) =>
    customerAssignments.filter(a => a.iAccount === iAccount && a.status === "active").length;

  // Unique customers with assignments (even if not in Sippy list yet)
  const assignedCustomers = Array.from(
    new Map(customerAssignments.filter(a => a.status === "active").map(a => [a.iAccount, a])).values()
  );

  const commercialProducts = products.filter(p => p.status === "commercial");

  return (
    <div className="flex h-full">
      {/* Left: account list */}
      <div className="w-72 shrink-0 border-r border-border flex flex-col">
        <div className="p-3 border-b border-border space-y-2">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Customers</span>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-muted-foreground" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search account…" className="h-8 pl-8 text-sm" data-testid="input-customer-search" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {filteredAccounts.map(acct => {
            const count = customerProductCount(acct.i_account);
            return (
              <button key={acct.i_account} data-testid={`customer-item-${acct.i_account}`}
                className={cn("w-full text-left px-3 py-2.5 flex items-center gap-2.5 hover:bg-muted/60 transition-colors",
                  selectedAccount?.i_account === acct.i_account && "bg-primary/10")}
                onClick={() => setSelectedAccount(acct)}>
                <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                  <Building2 className="w-3.5 h-3.5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{acct.id || `Account ${acct.i_account}`}</div>
                  <div className="text-xs text-muted-foreground">ID: {acct.i_account}</div>
                </div>
                {count > 0 && (
                  <span className="bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs px-1.5 py-0.5 rounded font-medium">{count}</span>
                )}
              </button>
            );
          })}
          {filteredAccounts.length === 0 && (
            <div className="p-4 text-center text-xs text-muted-foreground">
              {accounts.length === 0 ? "Loading accounts from Sippy…" : "No matches"}
            </div>
          )}
        </div>
      </div>

      {/* Right: product assignment for selected customer */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!selectedAccount && (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-3">
            <UserCheck className="w-10 h-10 opacity-30" />
            <p className="text-sm">Select a customer to manage their product assignments</p>
            <p className="text-xs text-muted-foreground/60">Customer → Product → Destination → Rate</p>
          </div>
        )}

        {selectedAccount && (
          <div className="flex flex-col h-full overflow-hidden">
            {/* Header */}
            <div className="px-6 py-4 border-b border-border flex items-start gap-4">
              <div className="w-10 h-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                <Building2 className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h2 className="font-semibold">{selectedAccount.id || `Account ${selectedAccount.i_account}`}</h2>
                <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                  <span>Sippy ID: {selectedAccount.i_account}</span>
                  {selectedAccount.username && <span>· Username: {selectedAccount.username}</span>}
                  <span>· {customerProductCount(selectedAccount.i_account)} product(s) assigned</span>
                </div>
              </div>
            </div>

            {/* Product grid */}
            <div className="flex-1 overflow-y-auto p-6">
              {commercialProducts.length === 0 && (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-4 py-3 text-sm text-amber-300 mb-4">
                  No Commercial products exist yet. Set a product lifecycle to <strong>Commercial</strong> in the Product Catalog tab first.
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {products.map(p => {
                  const a = getAssignment(p.id, selectedAccount.i_account);
                  const isAssigned = !!a;
                  const isCommercial = p.status === "commercial";
                  return (
                    <div key={p.id} data-testid={`customer-product-${p.id}`}
                      className={cn("flex items-center gap-3 p-4 rounded-lg border transition-all",
                        isAssigned ? "border-emerald-500/30 bg-emerald-500/5" : "border-border bg-muted/10 opacity-70",
                        !isCommercial && "opacity-40")}>
                      <div className={cn("w-10 h-10 rounded flex items-center justify-center text-sm font-bold border shrink-0", PRODUCT_COLORS[p.color ?? "violet"])}>{p.code}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{p.name}</span>
                          {lifecycleBadge(p.status)}
                        </div>
                        {p.description && <div className="text-xs text-muted-foreground truncate mt-0.5">{p.description}</div>}
                        {!isCommercial && <div className="text-xs text-amber-400 mt-0.5">Not commercial — won't appear in offers</div>}
                      </div>
                      <button
                        data-testid={`toggle-customer-product-${p.id}`}
                        disabled={!isCommercial && !isAssigned}
                        onClick={() => {
                          if (isAssigned) removeMut.mutate(a.id);
                          else assignMut.mutate({ productId: p.id, iAccount: selectedAccount.i_account, customerName: selectedAccount.id ?? `Account ${selectedAccount.i_account}` });
                        }}
                        className={cn("w-9 h-9 rounded-full border-2 flex items-center justify-center transition-all shrink-0",
                          isAssigned
                            ? "border-emerald-500 bg-emerald-500/20 text-emerald-400 hover:border-rose-500 hover:bg-rose-500/20 hover:text-rose-400"
                            : "border-border text-muted-foreground hover:border-emerald-500/60 hover:text-emerald-400",
                          !isCommercial && !isAssigned && "cursor-not-allowed opacity-30"
                        )}>
                        {isAssigned ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Summary of Customer → Product → Destination chain */}
              {customerAssignments.filter(a => a.iAccount === selectedAccount.i_account && a.status === "active").length > 0 && (
                <div className="mt-6 pt-4 border-t border-border">
                  <h3 className="text-sm font-semibold mb-2 text-muted-foreground">Assignment chain preview</h3>
                  <div className="text-xs text-muted-foreground space-y-1">
                    {customerAssignments.filter(a => a.iAccount === selectedAccount.i_account && a.status === "active").map(a => {
                      const prod = products.find(p => p.id === a.productId);
                      if (!prod) return null;
                      return (
                        <div key={a.id} className="flex items-center gap-1.5">
                          <Building2 className="w-3 h-3 text-blue-400" />
                          <span>{selectedAccount.id}</span>
                          <ArrowRight className="w-3 h-3 opacity-40" />
                          <div className={cn("px-1.5 py-0.5 rounded text-xs font-bold border", PRODUCT_COLORS[prod.color ?? "violet"])}>{prod.code}</div>
                          <span>{prod.name}</span>
                          <ArrowRight className="w-3 h-3 opacity-40" />
                          <span className="text-muted-foreground/60">Destination → Rate (via Assignments tab)</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Right panel bottom: assigned customers overview when nothing selected */}
        {!selectedAccount && assignedCustomers.length > 0 && (
          <div className="p-6 space-y-3 overflow-y-auto">
            <h3 className="text-sm font-semibold text-muted-foreground">Customers with product assignments</h3>
            <div className="space-y-2">
              {assignedCustomers.slice(0, 20).map(a => {
                const acct = accounts.find(x => x.i_account === a.iAccount);
                const prods = products.filter(p => customerAssignments.some(ca => ca.productId === p.id && ca.iAccount === a.iAccount && ca.status === "active"));
                return (
                  <div key={a.iAccount} className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border bg-card hover:bg-muted/30 cursor-pointer"
                    onClick={() => setSelectedAccount(acct ?? { i_account: a.iAccount, id: a.customerName })}>
                    <Building2 className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span className="text-sm font-medium flex-1">{a.customerName ?? `Account ${a.iAccount}`}</span>
                    <div className="flex gap-1">
                      {prods.map(p => <span key={p.id} className={cn("text-xs px-1.5 py-0.5 rounded border font-bold", PRODUCT_COLORS[p.color ?? "violet"])}>{p.code}</span>)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Routing Templates Tab ─────────────────────────────────────────────────────
function RoutingTemplatesTab({ products }: { products: Product[] }) {
  const qc = useQueryClient(); const { toast } = useToast();
  const [editing, setEditing] = useState<number | null>(null);
  const [form, setForm] = useState<Partial<Product>>({});
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest("PUT", `/api/product-registry/products/${id}`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/product-registry/products"] }); setEditing(null); setForm({}); toast({ title: "Saved" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  return (
    <div className="p-6 space-y-4 max-w-3xl">
      <div><h2 className="font-semibold">Routing Templates</h2><p className="text-sm text-muted-foreground">Default and backup routing templates per product — baseline when provisioning new routes.</p></div>
      <div className="bg-card border border-border rounded-lg divide-y divide-border">
        {products.map(p => (
          <div key={p.id} className="px-4 py-3">
            {editing === p.id ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2"><div className={cn("w-8 h-8 rounded flex items-center justify-center text-xs font-bold border", PRODUCT_COLORS[p.color ?? "violet"])}>{p.code}</div><span className="font-medium">{p.name}</span></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label className="text-xs text-muted-foreground mb-1 block">Default Routing Template</Label><Input value={form.defaultRoutingTemplate ?? p.defaultRoutingTemplate ?? ""} onChange={e => setForm(f => ({ ...f, defaultRoutingTemplate: e.target.value }))} placeholder="e.g. PK-FC-RTP" data-testid={`input-rt-default-${p.id}`} /></div>
                  <div><Label className="text-xs text-muted-foreground mb-1 block">Backup Routing Template</Label><Input value={form.backupRoutingTemplate ?? p.backupRoutingTemplate ?? ""} onChange={e => setForm(f => ({ ...f, backupRoutingTemplate: e.target.value }))} placeholder="e.g. PK-FC-Backup" data-testid={`input-rt-backup-${p.id}`} /></div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => updateMut.mutate({ id: p.id, data: form })} disabled={updateMut.isPending} data-testid={`btn-save-rt-${p.id}`}><Check className="w-3.5 h-3.5 mr-1" />Save</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setEditing(null); setForm({}); }} data-testid={`btn-cancel-rt-${p.id}`}>Cancel</Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-4">
                <div className={cn("w-8 h-8 rounded flex items-center justify-center text-xs font-bold border shrink-0", PRODUCT_COLORS[p.color ?? "violet"])}>{p.code}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2"><span className="font-medium text-sm">{p.name}</span>{lifecycleBadge(p.status)}</div>
                  <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                    <span>Default: <span className="font-mono text-foreground">{p.defaultRoutingTemplate || "—"}</span></span>
                    <span>Backup: <span className="font-mono text-foreground">{p.backupRoutingTemplate || "—"}</span></span>
                  </div>
                </div>
                <Button size="sm" variant="ghost" className="h-7" onClick={() => { setEditing(p.id); setForm({}); }} data-testid={`btn-edit-rt-${p.id}`}><Edit2 className="w-3.5 h-3.5" /></Button>
              </div>
            )}
          </div>
        ))}
        {products.length === 0 && <div className="p-6 text-center text-sm text-muted-foreground">No products</div>}
      </div>
    </div>
  );
}

// ── Pricing Templates Tab ─────────────────────────────────────────────────────
function PricingTemplatesTab({ products }: { products: Product[] }) {
  const qc = useQueryClient(); const { toast } = useToast();
  const [editing, setEditing] = useState<number | null>(null);
  const [form, setForm] = useState<Partial<Product>>({});
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest("PUT", `/api/product-registry/products/${id}`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/product-registry/products"] }); setEditing(null); setForm({}); toast({ title: "Saved" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => <div className="space-y-1"><Label className="text-xs text-muted-foreground">{label}</Label>{children}</div>;
  return (
    <div className="p-6 space-y-4 max-w-3xl">
      <div><h2 className="font-semibold">Pricing Templates</h2><p className="text-sm text-muted-foreground">Margin rules and KAM offer windows. KAMs only see the offer window — never vendor cost.</p></div>
      <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-4 py-2.5 flex items-start gap-2.5"><Shield className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" /><p className="text-xs text-amber-300">Management access only. KAMs are shown Min/Target/Premium offer window — never vendor cost or true margin.</p></div>
      <div className="bg-card border border-border rounded-lg divide-y divide-border">
        {products.map(p => {
          const ef = { ...p, ...form };
          return (
            <div key={p.id} className="px-4 py-4">
              {editing === p.id ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-2"><div className={cn("w-8 h-8 rounded flex items-center justify-center text-xs font-bold border", PRODUCT_COLORS[p.color ?? "violet"])}>{p.code}</div><span className="font-medium">{p.name}</span></div>
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="Min Margin %"><Input type="number" value={ef.minMarginPct ?? 0} onChange={e => setForm(f => ({ ...f, minMarginPct: parseFloat(e.target.value) }))} data-testid={`input-pt-margin-${p.id}`} /></Field>
                    <Field label="Discount Min %"><Input type="number" value={ef.discountRangeMin ?? ""} onChange={e => setForm(f => ({ ...f, discountRangeMin: parseFloat(e.target.value) }))} data-testid={`input-pt-disc-min-${p.id}`} /></Field>
                    <Field label="Discount Max %"><Input type="number" value={ef.discountRangeMax ?? ""} onChange={e => setForm(f => ({ ...f, discountRangeMax: parseFloat(e.target.value) }))} data-testid={`input-pt-disc-max-${p.id}`} /></Field>
                    <Field label="Offer Min"><Input type="number" step="0.0001" value={ef.offerWindowMin ?? ""} onChange={e => setForm(f => ({ ...f, offerWindowMin: parseFloat(e.target.value) }))} data-testid={`input-pt-offer-min-${p.id}`} /></Field>
                    <Field label="Offer Target"><Input type="number" step="0.0001" value={ef.offerWindowTarget ?? ""} onChange={e => setForm(f => ({ ...f, offerWindowTarget: parseFloat(e.target.value) }))} data-testid={`input-pt-offer-target-${p.id}`} /></Field>
                    <Field label="Offer Premium"><Input type="number" step="0.0001" value={ef.offerWindowPremium ?? ""} onChange={e => setForm(f => ({ ...f, offerWindowPremium: parseFloat(e.target.value) }))} data-testid={`input-pt-offer-premium-${p.id}`} /></Field>
                    <Field label="Notice (days)"><Input type="number" value={ef.noticePeriodDays ?? 7} onChange={e => setForm(f => ({ ...f, noticePeriodDays: parseInt(e.target.value) }))} data-testid={`input-pt-notice-${p.id}`} /></Field>
                    <Field label="Pricing Template"><Input value={ef.defaultPricingTemplate ?? ""} onChange={e => setForm(f => ({ ...f, defaultPricingTemplate: e.target.value }))} placeholder="e.g. Wholesale+15%" data-testid={`input-pt-template-${p.id}`} /></Field>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => updateMut.mutate({ id: p.id, data: form })} disabled={updateMut.isPending} data-testid={`btn-save-pt-${p.id}`}><Check className="w-3.5 h-3.5 mr-1" />Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setEditing(null); setForm({}); }} data-testid={`btn-cancel-pt-${p.id}`}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-4">
                  <div className={cn("w-8 h-8 rounded flex items-center justify-center text-xs font-bold border shrink-0 mt-0.5", PRODUCT_COLORS[p.color ?? "violet"])}>{p.code}</div>
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex items-center gap-2"><span className="font-medium text-sm">{p.name}</span>{lifecycleBadge(p.status)}</div>
                    <div className="grid grid-cols-3 gap-x-6 text-xs">
                      <span className="text-muted-foreground">Min Margin: <strong className="text-foreground">{p.minMarginPct ?? 0}%</strong></span>
                      <span className="text-muted-foreground">Discount: <strong className="text-foreground">{p.discountRangeMin ?? "—"}–{p.discountRangeMax ?? "—"}%</strong></span>
                      <span className="text-muted-foreground">Notice: <strong className="text-foreground">{p.noticePeriodDays ?? 7}d</strong></span>
                      <span className="text-muted-foreground">Offer: <strong className="text-foreground">{p.offerWindowMin ?? "—"} / {p.offerWindowTarget ?? "—"} / {p.offerWindowPremium ?? "—"}</strong></span>
                    </div>
                    {p.defaultPricingTemplate && <div className="text-xs text-muted-foreground">Template: <span className="font-mono text-foreground">{p.defaultPricingTemplate}</span></div>}
                  </div>
                  <Button size="sm" variant="ghost" className="h-7 shrink-0" onClick={() => { setEditing(p.id); setForm({}); }} data-testid={`btn-edit-pt-${p.id}`}><Edit2 className="w-3.5 h-3.5" /></Button>
                </div>
              )}
            </div>
          );
        })}
        {products.length === 0 && <div className="p-6 text-center text-sm text-muted-foreground">No products</div>}
      </div>
    </div>
  );
}

// ── History Tab ───────────────────────────────────────────────────────────────
function HistoryTab({ history }: { history: HistoryEntry[] }) {
  const EVENT_ICONS: Record<string, { icon: typeof Plus; color: string }> = {
    product_created:     { icon: Plus,        color: "text-emerald-400" },
    product_updated:     { icon: Edit2,       color: "text-blue-400"   },
    destination_created: { icon: Globe,       color: "text-violet-400" },
    destination_updated: { icon: Edit2,       color: "text-blue-400"   },
    destination_assigned:{ icon: ArrowRight,  color: "text-emerald-400" },
    destination_removed: { icon: X,           color: "text-rose-400"   },
    customer_assigned:   { icon: UserCheck,   color: "text-emerald-400" },
    customer_removed:    { icon: X,           color: "text-rose-400"   },
  };
  return (
    <div className="p-6 max-w-3xl space-y-4">
      <div><h2 className="font-semibold">Audit History</h2><p className="text-sm text-muted-foreground">All product, destination, and customer assignment changes</p></div>
      {history.length === 0 && <div className="bg-card border border-border rounded-lg p-8 text-center text-muted-foreground"><History className="w-8 h-8 mx-auto mb-2 opacity-30" /><p className="text-sm">No history yet</p></div>}
      <div className="space-y-0">
        {history.map((entry, i) => {
          const conf = EVENT_ICONS[entry.eventType] ?? { icon: Clock, color: "text-muted-foreground" };
          const Icon = conf.icon;
          return (
            <div key={entry.id} data-testid={`history-entry-${entry.id}`} className="flex gap-3 pb-4">
              <div className="flex flex-col items-center">
                <div className={cn("w-7 h-7 rounded-full border border-border bg-card flex items-center justify-center shrink-0", conf.color)}><Icon className="w-3.5 h-3.5" /></div>
                {i < history.length - 1 && <div className="w-px flex-1 bg-border mt-1" />}
              </div>
              <div className="flex-1 min-w-0 pt-1">
                <div className="text-sm">{entry.description}</div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-muted-foreground">{new Date(entry.createdAt).toLocaleString()}</span>
                  {entry.performedBy && <span className="text-xs text-muted-foreground">· {entry.performedBy}</span>}
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

  const { data: products = [] } = useQuery<Product[]>({ queryKey: ["/api/product-registry/products"] });
  const { data: destinations = [] } = useQuery<Destination[]>({ queryKey: ["/api/product-registry/destinations"] });
  const { data: assignments = [] } = useQuery<Assignment[]>({ queryKey: ["/api/product-registry/assignments"] });
  const { data: customerAssignments = [] } = useQuery<CustomerAssignment[]>({ queryKey: ["/api/product-registry/customer-assignments"] });
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
                <button key={tab.id} data-testid={`tab-${tab.id}`}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap",
                    activeTab === tab.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                  )}>
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
        {activeTab === "dashboard"    && <div className="h-full overflow-y-auto"><DashboardTab products={products} assignments={assignments} destinations={destinations} customerAssignments={customerAssignments} /></div>}
        {activeTab === "products"     && <div className="h-full overflow-hidden"><ProductCatalogTab products={products} /></div>}
        {activeTab === "destinations" && <div className="h-full overflow-hidden"><DestinationCatalogTab destinations={destinations} products={products} assignments={assignments} /></div>}
        {activeTab === "assignments"  && <div className="h-full overflow-hidden"><AssignmentsTab products={products} destinations={destinations} assignments={assignments} /></div>}
        {activeTab === "customers"    && <div className="h-full overflow-hidden"><CustomerAssignmentsTab products={products} customerAssignments={customerAssignments} /></div>}
        {activeTab === "routing"      && <div className="h-full overflow-y-auto"><RoutingTemplatesTab products={products} /></div>}
        {activeTab === "pricing"      && <div className="h-full overflow-y-auto"><PricingTemplatesTab products={products} /></div>}
        {activeTab === "history"      && <div className="h-full overflow-y-auto"><HistoryTab history={history} /></div>}
      </div>
    </div>
  );
}

import { useState, useMemo } from "react";
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
  Briefcase, BarChart2, LayoutList, Sliders, CheckSquare, History,
  Plus, Trash2, Check, X, Edit2, RefreshCw, ArrowRight, Search,
  Building2, Package, Globe, TrendingUp, TrendingDown,
  AlertTriangle, ChevronRight, ChevronDown, FileText,
  Send, ThumbsUp, ThumbsDown, Clock, DollarSign, Percent,
  Activity, Info,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Deal {
  id: number; dealRef: string; iAccount: number; customerName?: string;
  productId: number; kamName?: string; status: string;
  startDate?: string; endDate?: string; gracePeriodDays?: number;
  volumeCommitment?: string; notes?: string; createdAt: string; updatedAt: string;
}
interface DealDestination {
  id?: number; dealId?: number; destinationId?: number; destinationName?: string;
  offerRate?: string; costRate?: string; volumeSplitPct?: string;
  premiumPct?: string; standardPct?: string;
  premiumRate?: string; standardRate?: string; notes?: string;
  // simulator local state
  _localId?: string;
}
interface DealApproval { id: number; dealId: number; action: string; performedBy?: string; notes?: string; createdAt: string; }
interface Product { id: number; code: string; name: string; status: string; color?: string; }
interface Destination { id: number; name: string; level: number; dialPrefix?: string; commercialStatus: string; }
interface CustomerAssignment { productId: number; iAccount: number; customerName?: string; status: string; }
interface SippyAccount { i_account: number; id?: string; username?: string; }

// ── Constants ─────────────────────────────────────────────────────────────────
const TABS = [
  { id: "dashboard",  label: "Dashboard",      icon: BarChart2   },
  { id: "board",      label: "Deal Board",     icon: LayoutList  },
  { id: "simulator",  label: "Deal Simulator", icon: Sliders     },
  { id: "approvals",  label: "Approvals",      icon: CheckSquare },
  { id: "history",    label: "History",        icon: History     },
] as const;
type TabId = typeof TABS[number]["id"];

const DEAL_STATUSES: Record<string, { label: string; color: string; bg: string; border: string }> = {
  draft:            { label: "Draft",            color: "text-slate-400",   bg: "bg-slate-500/15",   border: "border-slate-500/30"   },
  pending_approval: { label: "Pending Approval", color: "text-amber-400",   bg: "bg-amber-500/15",   border: "border-amber-500/30"   },
  active:           { label: "Active",           color: "text-emerald-400", bg: "bg-emerald-500/15", border: "border-emerald-500/30" },
  expired:          { label: "Expired",          color: "text-rose-400",    bg: "bg-rose-500/15",    border: "border-rose-500/30"    },
  rejected:         { label: "Rejected",         color: "text-rose-400",    bg: "bg-rose-500/15",    border: "border-rose-500/30"    },
  suspended:        { label: "Suspended",        color: "text-orange-400",  bg: "bg-orange-500/15",  border: "border-orange-500/30"  },
};

const PRODUCT_COLORS: Record<string, string> = {
  blue:   "bg-blue-500/15 text-blue-400 border-blue-500/30",
  green:  "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  amber:  "bg-amber-500/15 text-amber-400 border-amber-500/30",
  red:    "bg-rose-500/15 text-rose-400 border-rose-500/30",
  violet: "bg-violet-500/15 text-violet-400 border-violet-500/30",
  cyan:   "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
};

// ── P&L Calculator ────────────────────────────────────────────────────────────
interface DestPnL {
  revenue: number; cost: number; profit: number; marginPct: number;
  blendedRate: number; volumeMins: number; health: "healthy" | "warning" | "risk";
}
interface TotalPnL {
  totalRevenue: number; totalCost: number; totalProfit: number;
  overallMarginPct: number; blendedRate: number; totalVolume: number;
  health: "healthy" | "warning" | "risk";
}

function calcDestPnL(d: DealDestination, totalVolume: number): DestPnL {
  const volSplit  = parseFloat(d.volumeSplitPct ?? "100") / 100;
  const volumeMins = totalVolume * volSplit;
  const premPct   = parseFloat(d.premiumPct  ?? "50") / 100;
  const stdPct    = parseFloat(d.standardPct ?? "50") / 100;
  const offerRate = parseFloat(d.offerRate   ?? "0");
  const costRate  = parseFloat(d.costRate    ?? "0");
  const premRate  = parseFloat(d.premiumRate ?? "0");
  const stdRate   = parseFloat(d.standardRate ?? "0");
  const blendedRate = (premRate > 0 || stdRate > 0)
    ? premPct * premRate + stdPct * stdRate
    : offerRate;
  const revenue = volumeMins * blendedRate;
  const cost    = volumeMins * costRate;
  const profit  = revenue - cost;
  const marginPct = revenue > 0 ? (profit / revenue) * 100 : 0;
  const health: "healthy" | "warning" | "risk" =
    marginPct >= 20 ? "healthy" : marginPct >= 10 ? "warning" : "risk";
  return { revenue, cost, profit, marginPct, blendedRate, volumeMins, health };
}

function calcTotalPnL(dests: DealDestination[], totalVolume: number): TotalPnL {
  const pnls = dests.map(d => calcDestPnL(d, totalVolume));
  const totalRevenue = pnls.reduce((s, p) => s + p.revenue, 0);
  const totalCost    = pnls.reduce((s, p) => s + p.cost, 0);
  const totalProfit  = totalRevenue - totalCost;
  const overallMarginPct = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;
  const blendedRate = totalVolume > 0 ? totalRevenue / totalVolume : 0;
  const health: "healthy" | "warning" | "risk" =
    overallMarginPct >= 20 ? "healthy" : overallMarginPct >= 10 ? "warning" : "risk";
  return { totalRevenue, totalCost, totalProfit, overallMarginPct, blendedRate, totalVolume, health };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(n: number, dec = 4) { return n.toFixed(dec); }
function fmtCurrency(n: number)   { return `$${n.toFixed(2)}`; }
function fmtPct(n: number)        { return `${n.toFixed(2)}%`; }

function StatusBadge({ status }: { status: string }) {
  const s = DEAL_STATUSES[status] ?? DEAL_STATUSES.draft;
  return <span className={cn("text-xs px-2 py-0.5 rounded border font-medium", s.bg, s.color, s.border)}>{s.label}</span>;
}

function HealthBadge({ health, pct }: { health: "healthy" | "warning" | "risk"; pct: number }) {
  const conf = {
    healthy: { color: "text-emerald-400", bg: "bg-emerald-500/15", border: "border-emerald-500/30", icon: TrendingUp   },
    warning: { color: "text-amber-400",   bg: "bg-amber-500/15",   border: "border-amber-500/30",   icon: AlertTriangle },
    risk:    { color: "text-rose-400",    bg: "bg-rose-500/15",    border: "border-rose-500/30",    icon: TrendingDown  },
  }[health];
  const Icon = conf.icon;
  return (
    <span className={cn("flex items-center gap-1 text-xs px-2 py-0.5 rounded border font-medium", conf.bg, conf.color, conf.border)}>
      <Icon className="w-3 h-3" />{fmtPct(pct)}
    </span>
  );
}

// ── Dashboard Tab ─────────────────────────────────────────────────────────────
function DashboardTab({ deals, products }: { deals: Deal[]; products: Product[] }) {
  const counts = {
    active:  deals.filter(d => d.status === "active").length,
    pending: deals.filter(d => d.status === "pending_approval").length,
    draft:   deals.filter(d => d.status === "draft").length,
    expired: deals.filter(d => d.status === "expired" || d.status === "rejected").length,
  };

  const productDealCount = (pid: number) => deals.filter(d => d.productId === pid).length;

  return (
    <div className="p-6 space-y-6">
      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Active Deals",    value: counts.active,  icon: Activity,     color: "text-emerald-400" },
          { label: "Pending Approval",value: counts.pending, icon: Clock,        color: "text-amber-400"   },
          { label: "Drafts",          value: counts.draft,   icon: FileText,     color: "text-slate-400"   },
          { label: "Closed / Expired",value: counts.expired, icon: AlertTriangle,color: "text-rose-400"    },
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

      {/* Commercial hierarchy */}
      <div className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-center gap-3 text-sm flex-wrap">
          {["Customer", "Product", "Destination", "Offer Rate", "Volume", "Approval", "Deal"].map((label, i, arr) => (
            <div key={label} className="flex items-center gap-2">
              <span className={cn("px-2 py-0.5 rounded border text-xs font-medium",
                i < 2 ? "border-violet-500/30 bg-violet-500/10 text-violet-400" :
                i < 5 ? "border-amber-500/30 bg-amber-500/10 text-amber-400" :
                "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
              )}>{label}</span>
              {i < arr.length - 1 && <ArrowRight className="w-3 h-3 opacity-40" />}
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-2">Deal Simulator replaces Excel — input customer, product, and rates, get live P&L output with commercial health scoring.</p>
      </div>

      {/* Deals by product */}
      {products.length > 0 && (
        <div className="bg-card border border-border rounded-lg">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="text-sm font-semibold">Deals by Product</h3>
          </div>
          <div className="divide-y divide-border">
            {products.map(p => {
              const count = productDealCount(p.id);
              const active = deals.filter(d => d.productId === p.id && d.status === "active").length;
              return (
                <div key={p.id} className="px-4 py-3 flex items-center gap-4">
                  <div className={cn("w-8 h-8 rounded flex items-center justify-center text-xs font-bold border shrink-0", PRODUCT_COLORS[p.color ?? "violet"])}>{p.code}</div>
                  <div className="flex-1">
                    <div className="text-sm font-medium">{p.name}</div>
                    <div className="text-xs text-muted-foreground">{count} deal{count !== 1 ? "s" : ""} total · {active} active</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold">{count}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent deals */}
      {deals.length > 0 && (
        <div className="bg-card border border-border rounded-lg">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="text-sm font-semibold">Recent Deals</h3>
          </div>
          <div className="divide-y divide-border">
            {deals.slice(0, 8).map(d => {
              const prod = products.find(p => p.id === d.productId);
              return (
                <div key={d.id} className="px-4 py-3 flex items-center gap-3">
                  <span className="font-mono text-xs text-muted-foreground w-28 shrink-0">{d.dealRef}</span>
                  <span className="text-sm font-medium flex-1 truncate">{d.customerName ?? `Account ${d.iAccount}`}</span>
                  {prod && <span className={cn("text-xs px-1.5 py-0.5 rounded border font-bold shrink-0", PRODUCT_COLORS[prod.color ?? "violet"])}>{prod.code}</span>}
                  <StatusBadge status={d.status} />
                  <span className="text-xs text-muted-foreground shrink-0">{new Date(d.createdAt).toLocaleDateString()}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {deals.length === 0 && (
        <div className="bg-card border border-border rounded-lg p-10 text-center">
          <Briefcase className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium">No deals yet</p>
          <p className="text-xs text-muted-foreground mt-1">Use the Deal Simulator tab to build your first commercial deal</p>
        </div>
      )}
    </div>
  );
}

// ── Deal Board Tab ────────────────────────────────────────────────────────────
function DealBoardTab({ deals, products, onSelect, onDelete }: {
  deals: Deal[]; products: Product[];
  onSelect: (d: Deal) => void;
  onDelete: (id: number) => void;
}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const filtered = deals.filter(d =>
    (statusFilter === "all" || d.status === statusFilter) &&
    (!search || d.customerName?.toLowerCase().includes(search.toLowerCase()) || d.dealRef.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="flex h-full">
      {/* Status sidebar */}
      <div className="w-44 shrink-0 border-r border-border p-3 space-y-1">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Status</div>
        {[{ id: "all", label: "All Deals", count: deals.length }, ...Object.entries(DEAL_STATUSES).map(([id, s]) => ({ id, label: s.label, count: deals.filter(d => d.status === id).length }))].map(f => (
          <button key={f.id} data-testid={`filter-${f.id}`}
            onClick={() => setStatusFilter(f.id)}
            className={cn("w-full text-left px-2 py-1.5 rounded text-xs flex items-center justify-between transition-colors",
              statusFilter === f.id ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-muted/60")}>
            <span>{f.label}</span>
            <span className="text-xs opacity-60">{f.count}</span>
          </button>
        ))}
      </div>

      {/* Main list */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="p-3 border-b border-border">
          <div className="relative">
            <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-muted-foreground" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search deals…" className="h-8 pl-8 text-sm" data-testid="input-deal-search" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 && (
            <div className="p-10 text-center text-muted-foreground">
              <Briefcase className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">{deals.length === 0 ? "No deals yet — use the Simulator tab" : "No deals match this filter"}</p>
            </div>
          )}
          <table className="w-full text-sm">
            {filtered.length > 0 && (
              <thead>
                <tr className="border-b border-border bg-muted/30 sticky top-0">
                  {["Deal Ref", "Customer", "Product", "KAM", "Dates", "Volume", "Status", "Actions"].map(h => (
                    <th key={h} className="text-left py-2 px-3 text-xs font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {filtered.map(d => {
                const prod = products.find(p => p.id === d.productId);
                return (
                  <tr key={d.id} data-testid={`deal-row-${d.id}`} className="border-b border-border/50 hover:bg-muted/20">
                    <td className="py-2.5 px-3 font-mono text-xs text-muted-foreground">{d.dealRef}</td>
                    <td className="py-2.5 px-3 font-medium">{d.customerName ?? `Acct ${d.iAccount}`}</td>
                    <td className="py-2.5 px-3">
                      {prod ? <span className={cn("text-xs px-1.5 py-0.5 rounded border font-bold", PRODUCT_COLORS[prod.color ?? "violet"])}>{prod.code}</span> : "—"}
                    </td>
                    <td className="py-2.5 px-3 text-muted-foreground">{d.kamName ?? "—"}</td>
                    <td className="py-2.5 px-3 text-xs text-muted-foreground whitespace-nowrap">
                      {d.startDate ? new Date(d.startDate).toLocaleDateString() : "—"} {d.endDate ? `→ ${new Date(d.endDate).toLocaleDateString()}` : ""}
                    </td>
                    <td className="py-2.5 px-3 text-muted-foreground">{d.volumeCommitment ? `${Number(d.volumeCommitment).toLocaleString()} min` : "—"}</td>
                    <td className="py-2.5 px-3"><StatusBadge status={d.status} /></td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => onSelect(d)} data-testid={`btn-view-deal-${d.id}`}><Edit2 className="w-3 h-3" /></Button>
                        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-rose-400 hover:text-rose-400" onClick={() => onDelete(d.id)} data-testid={`btn-delete-deal-${d.id}`}><Trash2 className="w-3 h-3" /></Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Deal Simulator Tab ────────────────────────────────────────────────────────
function DealSimulatorTab({ products, destinations, customerAssignments, accounts, existingDeal }: {
  products: Product[]; destinations: Destination[];
  customerAssignments: CustomerAssignment[];
  accounts: SippyAccount[];
  existingDeal?: Deal | null;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [accountSearch, setAccountSearch] = useState("");
  const [selectedAccount, setSelectedAccount] = useState<SippyAccount | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);
  const [kamName, setKamName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [gracePeriod, setGracePeriod] = useState(0);
  const [volume, setVolume] = useState(100000); // minutes
  const [notes, setNotes] = useState("");
  const [destRows, setDestRows] = useState<DealDestination[]>([]);
  const [destSearch, setDestSearch] = useState("");
  const [showDestPicker, setShowDestPicker] = useState(false);
  const [submitNotes, setSubmitNotes] = useState("");

  // Products available for this customer
  const availableProducts = useMemo(() => {
    if (!selectedAccount) return products.filter(p => p.status === "commercial");
    const assigned = customerAssignments.filter(a => a.iAccount === selectedAccount.i_account && a.status === "active").map(a => a.productId);
    return products.filter(p => assigned.includes(p.id) && p.status === "commercial");
  }, [selectedAccount, products, customerAssignments]);

  const selectedProduct = products.find(p => p.id === selectedProductId);

  // Destinations available for selected product (via product_destination_assignments — approximate with all approved dests)
  const availableDests = useMemo(() =>
    destinations.filter(d => d.commercialStatus === "approved" && d.level >= 2 &&
      !destRows.some(r => r.destinationId === d.id) &&
      (!destSearch || d.name.toLowerCase().includes(destSearch.toLowerCase()) || d.dialPrefix?.includes(destSearch))
    ), [destinations, destRows, destSearch]);

  const saveMut = useMutation({
    mutationFn: (body: any) => apiRequest("POST", "/api/deals", body),
    onSuccess: (deal: any) => {
      qc.invalidateQueries({ queryKey: ["/api/deals"] });
      toast({ title: `Deal ${deal.dealRef} created as draft` });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const submitMut = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/deals/${id}/submit`, { notes: submitNotes }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/deals"] }); toast({ title: "Submitted for approval" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const addDest = (d: Destination) => {
    setDestRows(prev => [...prev, {
      _localId: Math.random().toString(36).slice(2),
      destinationId: d.id, destinationName: d.name,
      offerRate: "", costRate: "", volumeSplitPct: "",
      premiumPct: "50", standardPct: "50",
    }]);
    setShowDestPicker(false);
    setDestSearch("");
  };

  const updateDestRow = (localId: string, field: keyof DealDestination, value: string) => {
    setDestRows(prev => prev.map(r => r._localId === localId ? { ...r, [field]: value } : r));
  };

  const removeDestRow = (localId: string) => setDestRows(prev => prev.filter(r => r._localId !== localId));

  // Auto-balance volume splits
  const autoBalance = () => {
    if (destRows.length === 0) return;
    const each = (100 / destRows.length).toFixed(2);
    setDestRows(prev => prev.map(r => ({ ...r, volumeSplitPct: each })));
  };

  // Live P&L
  const destPnLs = useMemo(() => destRows.map(d => calcDestPnL(d, volume)), [destRows, volume]);
  const totalPnL = useMemo(() => calcTotalPnL(destRows, volume), [destRows, volume]);

  const buildPayload = () => ({
    iAccount: selectedAccount?.i_account,
    customerName: selectedAccount?.id ?? `Account ${selectedAccount?.i_account}`,
    productId: selectedProductId,
    kamName, startDate: startDate || undefined, endDate: endDate || undefined,
    gracePeriodDays: gracePeriod, volumeCommitment: volume, notes,
    destinations: destRows.map(({ _localId, ...r }) => r),
  });

  const filteredAccounts = accounts.filter(a =>
    !accountSearch || (a.id ?? "").toLowerCase().includes(accountSearch.toLowerCase()) ||
    String(a.i_account).includes(accountSearch)
  );

  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="space-y-1"><Label className="text-xs text-muted-foreground">{label}</Label>{children}</div>
  );

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: Form */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 border-r border-border">

        {/* Step 1: Customer + Product */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 rounded-full bg-violet-500/20 border border-violet-500/40 text-xs font-bold text-violet-400 flex items-center justify-center">1</div>
            <h3 className="font-semibold text-sm">Customer & Product</h3>
          </div>

          {/* Customer picker */}
          <Field label="Customer (Sippy Account)">
            <div className="relative">
              <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <Input value={accountSearch} onChange={e => setAccountSearch(e.target.value)}
                placeholder="Search customer…" className="h-8 pl-8 text-sm" data-testid="input-sim-customer" />
            </div>
            {accountSearch && filteredAccounts.length > 0 && (
              <div className="border border-border rounded-md bg-popover shadow-md max-h-40 overflow-y-auto mt-1">
                {filteredAccounts.slice(0, 8).map(a => (
                  <button key={a.i_account} data-testid={`sim-acct-${a.i_account}`}
                    className={cn("w-full text-left px-3 py-2 text-sm hover:bg-muted/60 flex items-center gap-2",
                      selectedAccount?.i_account === a.i_account && "bg-primary/10 text-primary")}
                    onClick={() => { setSelectedAccount(a); setAccountSearch(a.id ?? `Account ${a.i_account}`); setSelectedProductId(null); }}>
                    <Building2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="flex-1">{a.id || `Account ${a.i_account}`}</span>
                    <span className="text-xs text-muted-foreground">#{a.i_account}</span>
                  </button>
                ))}
              </div>
            )}
            {selectedAccount && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded border border-violet-500/30 bg-violet-500/5 text-sm mt-1">
                <Building2 className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                <span className="font-medium">{selectedAccount.id ?? `Account ${selectedAccount.i_account}`}</span>
                <span className="text-xs text-muted-foreground ml-auto">ID: {selectedAccount.i_account}</span>
                <button onClick={() => { setSelectedAccount(null); setAccountSearch(""); setSelectedProductId(null); }}><X className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" /></button>
              </div>
            )}
          </Field>

          {/* Product picker */}
          {selectedAccount && (
            <Field label="Product">
              <div className="grid grid-cols-2 gap-2">
                {availableProducts.length === 0 && (
                  <div className="col-span-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded px-3 py-2">
                    No Commercial products assigned to this customer — assign products in Product Registry first.
                  </div>
                )}
                {availableProducts.map(p => (
                  <button key={p.id} data-testid={`sim-product-${p.id}`}
                    onClick={() => setSelectedProductId(p.id)}
                    className={cn("flex items-center gap-2.5 px-3 py-2.5 rounded-lg border text-left transition-all",
                      selectedProductId === p.id ? "border-primary bg-primary/10" : "border-border hover:bg-muted/50")}>
                    <div className={cn("w-8 h-8 rounded flex items-center justify-center text-xs font-bold border shrink-0", PRODUCT_COLORS[p.color ?? "violet"])}>{p.code}</div>
                    <span className="text-sm font-medium">{p.name}</span>
                    {selectedProductId === p.id && <Check className="w-4 h-4 text-primary ml-auto shrink-0" />}
                  </button>
                ))}
              </div>
            </Field>
          )}
        </div>

        {selectedAccount && selectedProductId && (
          <>
            {/* Step 2: Deal Terms */}
            <div className="space-y-4 pt-2 border-t border-border">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-6 h-6 rounded-full bg-amber-500/20 border border-amber-500/40 text-xs font-bold text-amber-400 flex items-center justify-center">2</div>
                <h3 className="font-semibold text-sm">Deal Terms</h3>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="KAM Name"><Input value={kamName} onChange={e => setKamName(e.target.value)} placeholder="Account manager" data-testid="input-sim-kam" /></Field>
                <Field label="Volume Commitment (minutes)">
                  <Input type="number" min={0} value={volume} onChange={e => setVolume(parseInt(e.target.value) || 0)} data-testid="input-sim-volume" />
                </Field>
                <Field label="Start Date"><Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} data-testid="input-sim-start" /></Field>
                <Field label="End Date">  <Input type="date" value={endDate}   onChange={e => setEndDate(e.target.value)}   data-testid="input-sim-end"   /></Field>
                <Field label="Grace Period (days)"><Input type="number" min={0} value={gracePeriod} onChange={e => setGracePeriod(parseInt(e.target.value) || 0)} data-testid="input-sim-grace" /></Field>
              </div>
            </div>

            {/* Step 3: Destinations & Rates */}
            <div className="space-y-3 pt-2 border-t border-border">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-6 h-6 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-xs font-bold text-emerald-400 flex items-center justify-center">3</div>
                <h3 className="font-semibold text-sm">Destinations & Rates</h3>
                <div className="ml-auto flex items-center gap-2">
                  {destRows.length > 1 && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={autoBalance} data-testid="btn-auto-balance">Auto-balance splits</Button>}
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowDestPicker(v => !v)} data-testid="btn-add-dest-row">
                    <Plus className="w-3.5 h-3.5 mr-1" />Add Destination
                  </Button>
                </div>
              </div>

              {/* Destination picker dropdown */}
              {showDestPicker && (
                <div className="border border-border rounded-lg bg-card p-3 space-y-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-muted-foreground" />
                    <Input value={destSearch} onChange={e => setDestSearch(e.target.value)} placeholder="Search destinations…" className="h-8 pl-8 text-sm" data-testid="input-dest-picker" />
                  </div>
                  <div className="max-h-40 overflow-y-auto space-y-0.5">
                    {availableDests.slice(0, 20).map(d => (
                      <button key={d.id} data-testid={`dest-pick-${d.id}`}
                        onClick={() => addDest(d)}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-muted/60 rounded flex items-center gap-2">
                        <Globe className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        <span className="flex-1">{d.name}</span>
                        {d.dialPrefix && <span className="text-xs font-mono text-muted-foreground">{d.dialPrefix}</span>}
                      </button>
                    ))}
                    {availableDests.length === 0 && <div className="px-3 py-2 text-xs text-muted-foreground">No more available destinations</div>}
                  </div>
                </div>
              )}

              {/* Destination rows */}
              {destRows.length === 0 && !showDestPicker && (
                <div className="text-center py-6 border border-dashed border-border rounded-lg">
                  <Globe className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm text-muted-foreground">Add at least one destination to build the deal</p>
                </div>
              )}

              {destRows.map((row, i) => {
                const pnl = destPnLs[i];
                return (
                  <div key={row._localId} data-testid={`sim-dest-row-${i}`} className="border border-border rounded-lg p-3 space-y-3 bg-muted/10">
                    <div className="flex items-center gap-2">
                      <Globe className="w-4 h-4 text-muted-foreground shrink-0" />
                      <span className="font-medium text-sm flex-1">{row.destinationName}</span>
                      {pnl && <HealthBadge health={pnl.health} pct={pnl.marginPct} />}
                      <button onClick={() => removeDestRow(row._localId!)} data-testid={`remove-dest-row-${i}`}>
                        <X className="w-4 h-4 text-muted-foreground hover:text-rose-400" />
                      </button>
                    </div>
                    <div className="grid grid-cols-5 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Offer Rate (sell)</Label>
                        <Input type="number" step="0.000001" value={row.offerRate ?? ""} onChange={e => updateDestRow(row._localId!, "offerRate", e.target.value)} placeholder="0.0100" className="h-7 text-xs" data-testid={`input-offer-rate-${i}`} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Cost Rate (buy)</Label>
                        <Input type="number" step="0.000001" value={row.costRate ?? ""} onChange={e => updateDestRow(row._localId!, "costRate", e.target.value)} placeholder="0.0080" className="h-7 text-xs" data-testid={`input-cost-rate-${i}`} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Vol Split %</Label>
                        <Input type="number" min={0} max={100} value={row.volumeSplitPct ?? ""} onChange={e => updateDestRow(row._localId!, "volumeSplitPct", e.target.value)} placeholder="100" className="h-7 text-xs" data-testid={`input-vol-split-${i}`} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Premium %</Label>
                        <Input type="number" min={0} max={100} value={row.premiumPct ?? "50"} onChange={e => { updateDestRow(row._localId!, "premiumPct", e.target.value); updateDestRow(row._localId!, "standardPct", String(100 - parseFloat(e.target.value || "0"))); }} placeholder="50" className="h-7 text-xs" data-testid={`input-prem-pct-${i}`} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Standard %</Label>
                        <Input type="number" min={0} max={100} value={row.standardPct ?? "50"} onChange={e => { updateDestRow(row._localId!, "standardPct", e.target.value); updateDestRow(row._localId!, "premiumPct", String(100 - parseFloat(e.target.value || "0"))); }} placeholder="50" className="h-7 text-xs" data-testid={`input-std-pct-${i}`} />
                      </div>
                    </div>
                    {/* Optional split pricing row */}
                    <details className="text-xs">
                      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Split pricing (optional — Premium/Standard rates)</summary>
                      <div className="grid grid-cols-2 gap-2 mt-2">
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">Premium Rate</Label>
                          <Input type="number" step="0.000001" value={row.premiumRate ?? ""} onChange={e => updateDestRow(row._localId!, "premiumRate", e.target.value)} placeholder="0.0280" className="h-7 text-xs" data-testid={`input-prem-rate-${i}`} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">Standard Rate</Label>
                          <Input type="number" step="0.000001" value={row.standardRate ?? ""} onChange={e => updateDestRow(row._localId!, "standardRate", e.target.value)} placeholder="0.0310" className="h-7 text-xs" data-testid={`input-std-rate-${i}`} />
                        </div>
                      </div>
                    </details>
                  </div>
                );
              })}
            </div>

            {/* Notes */}
            <div className="pt-2 border-t border-border">
              <Field label="Notes">
                <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Internal notes…" data-testid="input-sim-notes" />
              </Field>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 pt-2 border-t border-border">
              <Button onClick={() => saveMut.mutate(buildPayload())} disabled={saveMut.isPending || !selectedAccount || !selectedProductId} data-testid="btn-save-deal">
                {saveMut.isPending ? <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <FileText className="w-3.5 h-3.5 mr-1.5" />}
                Save as Draft
              </Button>
              {saveMut.data && (
                <Button variant="outline" onClick={() => submitMut.mutate((saveMut.data as any).id)} disabled={submitMut.isPending} data-testid="btn-submit-deal">
                  <Send className="w-3.5 h-3.5 mr-1.5" />Submit for Approval
                </Button>
              )}
              <span className="text-xs text-muted-foreground ml-auto">Draft is saved locally — submit to trigger approval workflow</span>
            </div>
          </>
        )}

        {!selectedAccount && (
          <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground gap-3">
            <Sliders className="w-10 h-10 opacity-30" />
            <p className="text-sm font-medium">Select a customer to start building a deal</p>
            <p className="text-xs opacity-60">Customer → Product → Destinations → Rates → Live P&L</p>
          </div>
        )}
      </div>

      {/* Right: Live P&L Panel */}
      <div className="w-72 shrink-0 flex flex-col overflow-hidden bg-muted/10">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <Activity className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Live P&L</span>
          {destRows.length > 0 && <HealthBadge health={totalPnL.health} pct={totalPnL.overallMarginPct} />}
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {destRows.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <DollarSign className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-xs">Add destinations and rates to see live P&L calculations</p>
            </div>
          )}

          {/* Per-destination P&L */}
          {destPnLs.map((pnl, i) => (
            <div key={destRows[i]._localId} className="bg-card border border-border rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Globe className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="text-xs font-medium truncate flex-1">{destRows[i].destinationName}</span>
                <HealthBadge health={pnl.health} pct={pnl.marginPct} />
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <span className="text-muted-foreground">Blended Rate</span>
                <span className="font-mono text-right">{fmt(pnl.blendedRate)}</span>
                <span className="text-muted-foreground">Volume</span>
                <span className="text-right">{pnl.volumeMins.toLocaleString()} min</span>
                <span className="text-muted-foreground">Revenue</span>
                <span className="font-medium text-emerald-400 text-right">{fmtCurrency(pnl.revenue)}</span>
                <span className="text-muted-foreground">Cost</span>
                <span className="font-medium text-rose-400 text-right">{fmtCurrency(pnl.cost)}</span>
                <span className="text-muted-foreground">Profit</span>
                <span className={cn("font-bold text-right", pnl.profit >= 0 ? "text-emerald-400" : "text-rose-400")}>{fmtCurrency(pnl.profit)}</span>
                <span className="text-muted-foreground">Margin</span>
                <span className="font-bold text-right">{fmtPct(pnl.marginPct)}</span>
              </div>
            </div>
          ))}

          {/* Total P&L */}
          {destRows.length > 0 && (
            <div className={cn("border rounded-lg p-3 space-y-2",
              totalPnL.health === "healthy" ? "border-emerald-500/30 bg-emerald-500/5" :
              totalPnL.health === "warning"  ? "border-amber-500/30 bg-amber-500/5" :
              "border-rose-500/30 bg-rose-500/5")}>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold">Deal Totals</span>
                <HealthBadge health={totalPnL.health} pct={totalPnL.overallMarginPct} />
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <span className="text-muted-foreground">Blended Rate</span>
                <span className="font-mono text-right font-bold">{fmt(totalPnL.blendedRate)}</span>
                <span className="text-muted-foreground">Total Volume</span>
                <span className="text-right">{totalPnL.totalVolume.toLocaleString()} min</span>
                <span className="text-muted-foreground">Total Revenue</span>
                <span className="font-bold text-emerald-400 text-right">{fmtCurrency(totalPnL.totalRevenue)}</span>
                <span className="text-muted-foreground">Total Cost</span>
                <span className="font-bold text-rose-400 text-right">{fmtCurrency(totalPnL.totalCost)}</span>
                <span className="text-muted-foreground">Net Profit</span>
                <span className={cn("font-bold text-right text-base", totalPnL.totalProfit >= 0 ? "text-emerald-400" : "text-rose-400")}>{fmtCurrency(totalPnL.totalProfit)}</span>
                <span className="text-muted-foreground">Margin</span>
                <span className="font-bold text-right text-base">{fmtPct(totalPnL.overallMarginPct)}</span>
              </div>
              <div className={cn("text-xs px-2 py-1.5 rounded mt-1",
                totalPnL.health === "healthy" ? "bg-emerald-500/10 text-emerald-400" :
                totalPnL.health === "warning"  ? "bg-amber-500/10 text-amber-400" :
                "bg-rose-500/10 text-rose-400")}>
                {totalPnL.health === "healthy" ? "✓ Commercially healthy — margin above 20%" :
                 totalPnL.health === "warning"  ? "⚠ Acceptable — margin 10–20%, review before approval" :
                 "✗ At risk — margin below 10%, management sign-off required"}
              </div>
            </div>
          )}

          {/* Info panel */}
          <div className="bg-muted/20 border border-border/50 rounded p-3">
            <div className="flex items-start gap-2">
              <Info className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
              <div className="text-xs text-muted-foreground space-y-1">
                <p><strong>Blended rate</strong> = weighted average across Premium/Standard traffic mix.</p>
                <p><strong>Revenue</strong> = volume × blended offer rate.</p>
                <p><strong>Cost</strong> = volume × cost (buying) rate.</p>
                <p>Volume is split across destinations by Split % — use Auto-balance for equal splits.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Approvals Tab ─────────────────────────────────────────────────────────────
function ApprovalsTab({ deals, products }: { deals: Deal[]; products: Product[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const pending = deals.filter(d => d.status === "pending_approval");
  const [notes, setNotes] = useState<Record<number, string>>({});

  const approveMut = useMutation({
    mutationFn: ({ id, n }: { id: number; n: string }) => apiRequest("POST", `/api/deals/${id}/approve`, { notes: n }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/deals"] }); toast({ title: "Deal approved ✓" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const rejectMut = useMutation({
    mutationFn: ({ id, n }: { id: number; n: string }) => apiRequest("POST", `/api/deals/${id}/reject`, { notes: n }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/deals"] }); toast({ title: "Deal rejected" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="p-6 space-y-4 max-w-3xl">
      <div>
        <h2 className="font-semibold">Approval Queue</h2>
        <p className="text-sm text-muted-foreground">Deals submitted for management approval</p>
      </div>
      {pending.length === 0 && (
        <div className="bg-card border border-border rounded-lg p-8 text-center">
          <CheckSquare className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm font-medium">No deals pending approval</p>
          <p className="text-xs text-muted-foreground mt-1">Deals submitted from the Simulator will appear here</p>
        </div>
      )}
      <div className="space-y-3">
        {pending.map(d => {
          const prod = products.find(p => p.id === d.productId);
          const n = notes[d.id] ?? "";
          return (
            <div key={d.id} data-testid={`approval-card-${d.id}`} className="bg-card border border-amber-500/20 rounded-lg p-4 space-y-3">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs text-muted-foreground">{d.dealRef}</span>
                    <span className="font-semibold">{d.customerName ?? `Account ${d.iAccount}`}</span>
                    {prod && <span className={cn("text-xs px-1.5 py-0.5 rounded border font-bold", PRODUCT_COLORS[prod.color ?? "violet"])}>{prod.code} — {prod.name}</span>}
                    <StatusBadge status={d.status} />
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1 flex-wrap">
                    {d.kamName && <span>KAM: {d.kamName}</span>}
                    {d.startDate && <span>{new Date(d.startDate).toLocaleDateString()} → {d.endDate ? new Date(d.endDate).toLocaleDateString() : "Open"}</span>}
                    {d.volumeCommitment && <span>{Number(d.volumeCommitment).toLocaleString()} min</span>}
                    {d.gracePeriodDays ? <span>Grace: {d.gracePeriodDays}d</span> : null}
                  </div>
                  {d.notes && <p className="text-xs text-muted-foreground mt-1 italic">"{d.notes}"</p>}
                </div>
              </div>
              <div className="space-y-2">
                <Textarea value={n} onChange={e => setNotes(prev => ({ ...prev, [d.id]: e.target.value }))} placeholder="Approval notes (optional)…" rows={2} className="text-xs" data-testid={`approval-notes-${d.id}`} />
                <div className="flex gap-2">
                  <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white"
                    onClick={() => approveMut.mutate({ id: d.id, n })} disabled={approveMut.isPending}
                    data-testid={`btn-approve-${d.id}`}>
                    <ThumbsUp className="w-3.5 h-3.5 mr-1.5" />Approve
                  </Button>
                  <Button size="sm" variant="destructive"
                    onClick={() => rejectMut.mutate({ id: d.id, n })} disabled={rejectMut.isPending}
                    data-testid={`btn-reject-${d.id}`}>
                    <ThumbsDown className="w-3.5 h-3.5 mr-1.5" />Reject
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── History Tab ───────────────────────────────────────────────────────────────
function DealHistoryTab({ deals, products }: { deals: Deal[]; products: Product[] }) {
  const { data: allApprovals = [] } = useQuery<DealApproval[]>({ queryKey: ["/api/deals/approvals/pending"] });
  // Show all deals sorted by updatedAt as timeline
  const timeline = [...deals].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  const ACTION_CONF: Record<string, { color: string; icon: typeof Plus }> = {
    created:            { color: "text-blue-400",    icon: Plus        },
    submitted:          { color: "text-amber-400",   icon: Send        },
    approved:           { color: "text-emerald-400", icon: ThumbsUp    },
    rejected:           { color: "text-rose-400",    icon: ThumbsDown  },
    changes_requested:  { color: "text-orange-400",  icon: Edit2       },
  };

  return (
    <div className="p-6 max-w-3xl space-y-4">
      <div><h2 className="font-semibold">Deal History</h2><p className="text-sm text-muted-foreground">Chronological record of all deal activity</p></div>
      {timeline.length === 0 && (
        <div className="bg-card border border-border rounded-lg p-8 text-center">
          <History className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No deals yet</p>
        </div>
      )}
      <div className="space-y-0">
        {timeline.map((d, i) => {
          const prod = products.find(p => p.id === d.productId);
          const s = DEAL_STATUSES[d.status] ?? DEAL_STATUSES.draft;
          return (
            <div key={d.id} data-testid={`history-deal-${d.id}`} className="flex gap-3 pb-4">
              <div className="flex flex-col items-center">
                <div className={cn("w-7 h-7 rounded-full border border-border bg-card flex items-center justify-center shrink-0", s.color)}>
                  <Briefcase className="w-3.5 h-3.5" />
                </div>
                {i < timeline.length - 1 && <div className="w-px flex-1 bg-border mt-1" />}
              </div>
              <div className="flex-1 min-w-0 pt-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs text-muted-foreground">{d.dealRef}</span>
                  <span className="font-medium text-sm">{d.customerName ?? `Account ${d.iAccount}`}</span>
                  {prod && <span className={cn("text-xs px-1.5 py-0.5 rounded border font-bold", PRODUCT_COLORS[prod.color ?? "violet"])}>{prod.code}</span>}
                  <StatusBadge status={d.status} />
                </div>
                <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                  <span>{new Date(d.updatedAt).toLocaleString()}</span>
                  {d.kamName && <span>· KAM: {d.kamName}</span>}
                  {d.volumeCommitment && <span>· {Number(d.volumeCommitment).toLocaleString()} min</span>}
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
export default function DealsPage() {
  const [activeTab, setActiveTab] = useState<TabId>("dashboard");
  const [simulatorDeal, setSimulatorDeal] = useState<Deal | null>(null);

  const { data: dealList = [] }  = useQuery<Deal[]>({ queryKey: ["/api/deals"] });
  const { data: products = [] }  = useQuery<any[]>({ queryKey: ["/api/product-registry/products"] });
  const { data: destinations = [] } = useQuery<Destination[]>({ queryKey: ["/api/product-registry/destinations"] });
  const { data: custAssignments = [] } = useQuery<CustomerAssignment[]>({ queryKey: ["/api/product-registry/customer-assignments"] });
  const { data: accountsData }   = useQuery<{ accounts: SippyAccount[] }>({ queryKey: ["/api/sippy/accounts"] });
  const accounts = accountsData?.accounts ?? [];

  const qc = useQueryClient();
  const { toast } = useToast();
  const deleteMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/deals/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/deals"] }); toast({ title: "Deal deleted" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const pendingCount = dealList.filter(d => d.status === "pending_approval").length;

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Tab bar */}
      <div className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur-sm flex-shrink-0">
        <div className="flex items-center gap-0 px-4 h-11">
          <div className="flex items-center gap-1.5 mr-4 pr-4 border-r border-border/50 text-xs font-medium text-muted-foreground shrink-0">
            <Briefcase className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden sm:inline">Voice Trading</span>
          </div>
          <div className="flex items-center gap-0.5">
            {TABS.map(tab => {
              const Icon = tab.icon;
              const badge = tab.id === "approvals" && pendingCount > 0 ? pendingCount : null;
              return (
                <button key={tab.id} data-testid={`tab-${tab.id}`}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap relative",
                    activeTab === tab.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                  )}>
                  <Icon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                  {badge && (
                    <span className="ml-1 text-xs bg-amber-500 text-white rounded-full px-1.5 py-0.5 font-bold leading-none">{badge}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === "dashboard"  && <div className="h-full overflow-y-auto"><DashboardTab deals={dealList} products={products} /></div>}
        {activeTab === "board"      && <div className="h-full overflow-hidden"><DealBoardTab deals={dealList} products={products} onSelect={d => { setSimulatorDeal(d); setActiveTab("simulator"); }} onDelete={id => deleteMut.mutate(id)} /></div>}
        {activeTab === "simulator"  && <div className="h-full overflow-hidden"><DealSimulatorTab products={products} destinations={destinations} customerAssignments={custAssignments} accounts={accounts} existingDeal={simulatorDeal} /></div>}
        {activeTab === "approvals"  && <div className="h-full overflow-y-auto"><ApprovalsTab deals={dealList} products={products} /></div>}
        {activeTab === "history"    && <div className="h-full overflow-y-auto"><DealHistoryTab deals={dealList} products={products} /></div>}
      </div>
    </div>
  );
}

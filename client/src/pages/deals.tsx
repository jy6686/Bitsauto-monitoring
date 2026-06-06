import { useState, useMemo, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
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
  AlertTriangle, ChevronRight, FileText, Calendar,
  Send, ThumbsUp, ThumbsDown, Clock, DollarSign, Percent,
  Activity, Info, Timer, Flame, BarChart3, Users, Shield,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Deal {
  id: number; dealRef: string; iAccount: number; customerName?: string;
  productId: number; kamName?: string; status: string; dealType?: string;
  startDate?: string; endDate?: string; gracePeriodDays?: number;
  volumeCommitment?: string; notes?: string; createdAt: string; updatedAt: string;
}
interface DealDestination {
  id?: number; dealId?: number; destinationId?: number; destinationName?: string;
  offerRate?: string; costRate?: string; volumeSplitPct?: string;
  premiumPct?: string; standardPct?: string;
  premiumRate?: string; standardRate?: string; notes?: string;
  _localId?: string;
  deal?: Deal;
}
interface DealApproval { id: number; dealId: number; action: string; performedBy?: string; notes?: string; createdAt: string; }
interface Product { id: number; code: string; name: string; status: string; color?: string; }
interface Destination { id: number; name: string; level: number; dialPrefix?: string; commercialStatus: string; }
interface CustomerAssignment { productId: number; iAccount: number; customerName?: string; status: string; }
interface SippyAccount { i_account: number; id?: string; username?: string; }

// ── Constants ─────────────────────────────────────────────────────────────────
const TABS = [
  { id: "dashboard",     label: "Dashboard",      icon: BarChart2    },
  { id: "board",         label: "Deal Board",     icon: LayoutList   },
  { id: "simulator",     label: "Deal Simulator", icon: Sliders      },
  { id: "profitability", label: "Profitability",  icon: TrendingUp   },
  { id: "margin-truth",  label: "Margin Truth",   icon: Activity     },
  { id: "expiry",        label: "Expiry Center",  icon: Timer        },
  { id: "approvals",     label: "Approvals",      icon: CheckSquare  },
  { id: "history",       label: "History",        icon: History      },
] as const;
type TabId = typeof TABS[number]["id"];

const DEAL_STATUSES: Record<string, { label: string; color: string; bg: string; border: string }> = {
  draft:            { label: "Draft",            color: "text-slate-400",   bg: "bg-slate-500/15",   border: "border-slate-500/30"   },
  negotiating:      { label: "Negotiating",      color: "text-blue-400",    bg: "bg-blue-500/15",    border: "border-blue-500/30"    },
  pending_approval: { label: "Pending Approval", color: "text-amber-400",   bg: "bg-amber-500/15",   border: "border-amber-500/30"   },
  approved:         { label: "Approved",         color: "text-violet-400",  bg: "bg-violet-500/15",  border: "border-violet-500/30"  },
  active:           { label: "Active",           color: "text-emerald-400", bg: "bg-emerald-500/15", border: "border-emerald-500/30" },
  expiring:         { label: "Expiring",         color: "text-orange-400",  bg: "bg-orange-500/15",  border: "border-orange-500/30"  },
  expired:          { label: "Expired",          color: "text-rose-400",    bg: "bg-rose-500/15",    border: "border-rose-500/30"    },
  renewed:          { label: "Renewed",          color: "text-cyan-400",    bg: "bg-cyan-500/15",    border: "border-cyan-500/30"    },
  rejected:         { label: "Rejected",         color: "text-rose-400",    bg: "bg-rose-500/15",    border: "border-rose-500/30"    },
};

const DEAL_TYPE_OPTIONS = [
  { value: "traffic_mix",       label: "Traffic Mix",        desc: "Premium + Standard traffic blend" },
  { value: "incremental",       label: "Incremental",        desc: "Volume above existing baseline" },
  { value: "wholesale",         label: "Wholesale",          desc: "Bulk committed volume" },
  { value: "special_pricing",   label: "Special Pricing",    desc: "One-time / promotional rate" },
  { value: "volume_commitment", label: "Volume Commitment",  desc: "Guaranteed minimum minutes" },
];

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
  const volSplit   = parseFloat(d.volumeSplitPct ?? "100") / 100;
  const volumeMins = totalVolume * volSplit;
  const premPct    = parseFloat(d.premiumPct  ?? "50") / 100;
  const stdPct     = parseFloat(d.standardPct ?? "50") / 100;
  const offerRate  = parseFloat(d.offerRate   ?? "0");
  const costRate   = parseFloat(d.costRate    ?? "0");
  const premRate   = parseFloat(d.premiumRate ?? "0");
  const stdRate    = parseFloat(d.standardRate ?? "0");
  const blendedRate = (premRate > 0 || stdRate > 0)
    ? premPct * premRate + stdPct * stdRate
    : offerRate;
  const revenue  = volumeMins * blendedRate;
  const cost     = volumeMins * costRate;
  const profit   = revenue - cost;
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
function fmtCurrency(n: number)  { return `$${n.toFixed(2)}`; }
function fmtPct(n: number)       { return `${n.toFixed(2)}%`; }

function daysUntil(dateStr?: string): number | null {
  if (!dateStr) return null;
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

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
function DashboardTab({ deals, products, onNewDeal }: { deals: Deal[]; products: Product[]; onNewDeal?: () => void }) {
  const today = new Date();
  const in7d  = new Date(today); in7d.setDate(today.getDate() + 7);
  const in30d = new Date(today); in30d.setDate(today.getDate() + 30);

  const counts = {
    active:   deals.filter(d => d.status === "active").length,
    pending:  deals.filter(d => d.status === "pending_approval").length,
    draft:    deals.filter(d => ["draft", "negotiating"].includes(d.status)).length,
    expiring: deals.filter(d => {
      if (!d.endDate || !["active", "expiring"].includes(d.status)) return false;
      const end = new Date(d.endDate);
      return end >= today && end <= in30d;
    }).length,
    expired:  deals.filter(d => d.status === "expired" || d.status === "rejected").length,
  };

  const expiring7  = deals.filter(d => { if (!d.endDate || d.status !== "active") return false; const end = new Date(d.endDate); return end >= today && end <= in7d; });
  const expiring30 = deals.filter(d => { if (!d.endDate || d.status !== "active") return false; const end = new Date(d.endDate); return end >= today && end > in7d && end <= in30d; });
  const inGrace    = deals.filter(d => {
    if (!d.endDate || !(d.gracePeriodDays ?? 0)) return false;
    const end = new Date(d.endDate);
    const graceEnd = new Date(end); graceEnd.setDate(end.getDate() + (d.gracePeriodDays ?? 0));
    return end < today && graceEnd >= today;
  });

  const productDealCount = (pid: number) => deals.filter(d => d.productId === pid).length;
  const productActiveCount = (pid: number) => deals.filter(d => d.productId === pid && d.status === "active").length;

  return (
    <div className="p-6 space-y-6">
      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: "Active Deals",     value: counts.active,   icon: Activity,      color: "text-emerald-400" },
          { label: "Pending Approval", value: counts.pending,  icon: Clock,         color: "text-amber-400"   },
          { label: "Drafts / Neg.",    value: counts.draft,    icon: FileText,      color: "text-slate-400"   },
          { label: "Expiring (30d)",   value: counts.expiring, icon: Timer,         color: "text-orange-400"  },
          { label: "Closed / Expired", value: counts.expired,  icon: AlertTriangle, color: "text-rose-400"    },
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

      {/* Expiry Intelligence */}
      {(expiring7.length + expiring30.length + inGrace.length > 0) && (
        <div className="bg-card border border-border rounded-lg">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <Timer className="w-4 h-4 text-orange-400" />
            <h3 className="text-sm font-semibold">Expiry Intelligence</h3>
            <span className="ml-auto text-xs text-muted-foreground">Action required</span>
          </div>
          <div className="divide-y divide-border">
            {expiring7.length > 0 && (
              <div className="px-4 py-3">
                <div className="flex items-center gap-2 mb-2">
                  <Flame className="w-3.5 h-3.5 text-rose-400" />
                  <span className="text-xs font-semibold text-rose-400">Expiring within 7 days ({expiring7.length})</span>
                </div>
                <div className="space-y-1">
                  {expiring7.map(d => {
                    const days = daysUntil(d.endDate);
                    const prod = products.find(p => p.id === d.productId);
                    return (
                      <div key={d.id} className="flex items-center gap-3 text-xs bg-rose-500/5 border border-rose-500/20 rounded px-3 py-2">
                        <span className="font-mono text-muted-foreground w-28 shrink-0">{d.dealRef}</span>
                        <span className="font-medium flex-1 truncate">{d.customerName ?? `Acct ${d.iAccount}`}</span>
                        {prod && <span className={cn("px-1.5 py-0.5 rounded border font-bold shrink-0", PRODUCT_COLORS[prod.color ?? "violet"])}>{prod.code}</span>}
                        <span className="text-rose-400 font-semibold shrink-0">{days === 0 ? "Today" : `${days}d`}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {expiring30.length > 0 && (
              <div className="px-4 py-3">
                <div className="flex items-center gap-2 mb-2">
                  <Timer className="w-3.5 h-3.5 text-orange-400" />
                  <span className="text-xs font-semibold text-orange-400">Expiring 8–30 days ({expiring30.length})</span>
                </div>
                <div className="space-y-1">
                  {expiring30.map(d => {
                    const days = daysUntil(d.endDate);
                    const prod = products.find(p => p.id === d.productId);
                    return (
                      <div key={d.id} className="flex items-center gap-3 text-xs bg-orange-500/5 border border-orange-500/20 rounded px-3 py-2">
                        <span className="font-mono text-muted-foreground w-28 shrink-0">{d.dealRef}</span>
                        <span className="font-medium flex-1 truncate">{d.customerName ?? `Acct ${d.iAccount}`}</span>
                        {prod && <span className={cn("px-1.5 py-0.5 rounded border font-bold shrink-0", PRODUCT_COLORS[prod.color ?? "violet"])}>{prod.code}</span>}
                        <span className="text-orange-400 font-semibold shrink-0">{days}d</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {inGrace.length > 0 && (
              <div className="px-4 py-3">
                <div className="flex items-center gap-2 mb-2">
                  <Shield className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-xs font-semibold text-amber-400">In Grace Period ({inGrace.length})</span>
                </div>
                <div className="space-y-1">
                  {inGrace.map(d => {
                    const prod = products.find(p => p.id === d.productId);
                    const graceEnd = d.endDate ? new Date(d.endDate) : null;
                    if (graceEnd) graceEnd.setDate(graceEnd.getDate() + (d.gracePeriodDays ?? 0));
                    const daysLeft = graceEnd ? Math.ceil((graceEnd.getTime() - Date.now()) / 86400000) : null;
                    return (
                      <div key={d.id} className="flex items-center gap-3 text-xs bg-amber-500/5 border border-amber-500/20 rounded px-3 py-2">
                        <span className="font-mono text-muted-foreground w-28 shrink-0">{d.dealRef}</span>
                        <span className="font-medium flex-1 truncate">{d.customerName ?? `Acct ${d.iAccount}`}</span>
                        {prod && <span className={cn("px-1.5 py-0.5 rounded border font-bold shrink-0", PRODUCT_COLORS[prod.color ?? "violet"])}>{prod.code}</span>}
                        <span className="text-amber-400 font-semibold shrink-0">{daysLeft !== null ? `${daysLeft}d grace` : "Grace"}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Deals by product */}
      {products.length > 0 && (
        <div className="bg-card border border-border rounded-lg">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="text-sm font-semibold">Deals by Product</h3>
          </div>
          <div className="divide-y divide-border">
            {products.map(p => {
              const total  = productDealCount(p.id);
              const active = productActiveCount(p.id);
              return (
                <div key={p.id} className="px-4 py-3 flex items-center gap-4">
                  <div className={cn("w-8 h-8 rounded flex items-center justify-center text-xs font-bold border shrink-0", PRODUCT_COLORS[p.color ?? "violet"])}>{p.code}</div>
                  <div className="flex-1">
                    <div className="text-sm font-medium">{p.name}</div>
                    <div className="text-xs text-muted-foreground">{total} deal{total !== 1 ? "s" : ""} · {active} active</div>
                  </div>
                  <div className="text-sm font-bold">{total}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent deals */}
      {deals.length > 0 && (
        <div className="bg-card border border-border rounded-lg">
          <div className="px-4 py-3 border-b border-border"><h3 className="text-sm font-semibold">Recent Deals</h3></div>
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
          <p className="text-xs text-muted-foreground mt-2 mb-4">Use the Deal Simulator to build your first commercial deal</p>
          {onNewDeal && (
            <Button size="sm" onClick={onNewDeal} data-testid="btn-new-deal-empty">
              <Plus className="w-4 h-4 mr-1.5" />
              New Deal
            </Button>
          )}
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
                  {["Deal Ref", "Customer", "Product", "Type", "KAM", "Dates", "Volume", "Status", "Actions"].map(h => (
                    <th key={h} className="text-left py-2 px-3 text-xs font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {filtered.map(d => {
                const prod = products.find(p => p.id === d.productId);
                const typeLabel = DEAL_TYPE_OPTIONS.find(t => t.value === d.dealType)?.label ?? d.dealType ?? "—";
                return (
                  <tr key={d.id} data-testid={`deal-row-${d.id}`} className="border-b border-border/50 hover:bg-muted/20">
                    <td className="py-2.5 px-3 font-mono text-xs text-muted-foreground">{d.dealRef}</td>
                    <td className="py-2.5 px-3 font-medium">{d.customerName ?? `Acct ${d.iAccount}`}</td>
                    <td className="py-2.5 px-3">
                      {prod ? <span className={cn("text-xs px-1.5 py-0.5 rounded border font-bold", PRODUCT_COLORS[prod.color ?? "violet"])}>{prod.code}</span> : "—"}
                    </td>
                    <td className="py-2.5 px-3 text-xs text-muted-foreground">{typeLabel}</td>
                    <td className="py-2.5 px-3 text-muted-foreground">{d.kamName ?? "—"}</td>
                    <td className="py-2.5 px-3 text-xs text-muted-foreground whitespace-nowrap">
                      {d.startDate ? new Date(d.startDate).toLocaleDateString() : "—"} {d.endDate ? `→ ${new Date(d.endDate).toLocaleDateString()}` : ""}
                      {d.gracePeriodDays ? <span className="text-amber-400 ml-1">+{d.gracePeriodDays}d</span> : null}
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

// ── Expiry Center Tab ─────────────────────────────────────────────────────────
function ExpiryCenterTab({ deals, products }: { deals: Deal[]; products: Product[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const today = new Date();
  const in7d  = new Date(today); in7d.setDate(today.getDate() + 7);
  const in30d = new Date(today); in30d.setDate(today.getDate() + 30);

  const expiring7  = deals.filter(d => { if (!d.endDate || d.status !== "active") return false; const e = new Date(d.endDate); return e >= today && e <= in7d; });
  const expiring30 = deals.filter(d => { if (!d.endDate || d.status !== "active") return false; const e = new Date(d.endDate); return e >= today && e > in7d && e <= in30d; });
  const inGrace    = deals.filter(d => {
    if (!d.endDate || !(d.gracePeriodDays ?? 0)) return false;
    const end = new Date(d.endDate);
    const graceEnd = new Date(end); graceEnd.setDate(end.getDate() + (d.gracePeriodDays ?? 0));
    return end < today && graceEnd >= today;
  });
  const renewalCandidates = deals.filter(d =>
    d.status === "expired" ||
    (d.endDate && new Date(d.endDate) < today && d.status === "active")
  );

  const renewMut = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/deals/${id}/renew`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/deals"] }); toast({ title: "Deal marked as renewed" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const DealRow = ({ d, urgencyColor, extra }: { d: Deal; urgencyColor: string; extra?: ReactNode }) => {
    const prod = products.find(p => p.id === d.productId);
    const days = daysUntil(d.endDate);
    return (
      <div className={cn("flex items-center gap-3 text-sm rounded-lg border px-4 py-3", urgencyColor)}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-xs text-muted-foreground">{d.dealRef}</span>
            <span className="font-semibold">{d.customerName ?? `Acct ${d.iAccount}`}</span>
            {prod && <span className={cn("text-xs px-1.5 py-0.5 rounded border font-bold shrink-0", PRODUCT_COLORS[prod.color ?? "violet"])}>{prod.code}</span>}
            <StatusBadge status={d.status} />
            {d.kamName && <span className="text-xs text-muted-foreground">KAM: {d.kamName}</span>}
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground mt-0.5 flex-wrap">
            {d.endDate && <span>Ends {new Date(d.endDate).toLocaleDateString()}</span>}
            {d.volumeCommitment && <span>{Number(d.volumeCommitment).toLocaleString()} min committed</span>}
            {d.gracePeriodDays ? <span className="text-amber-400">+{d.gracePeriodDays}d grace</span> : null}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {extra}
          {days !== null && days > 0 ? (
            <span className={cn("text-sm font-bold px-2 py-0.5 rounded",
              days <= 7 ? "bg-rose-500/20 text-rose-400" : "bg-orange-500/20 text-orange-400"
            )}>{days}d</span>
          ) : days !== null && days <= 0 ? (
            <span className="text-sm font-bold px-2 py-0.5 rounded bg-rose-500/20 text-rose-400">Expired</span>
          ) : null}
          <Button size="sm" variant="outline" className="h-7 text-xs"
            onClick={() => renewMut.mutate(d.id)} disabled={renewMut.isPending}
            data-testid={`btn-renew-deal-${d.id}`}>
            <RefreshCw className="w-3 h-3 mr-1" />Renew
          </Button>
        </div>
      </div>
    );
  };

  const isEmpty = expiring7.length + expiring30.length + inGrace.length + renewalCandidates.length === 0;

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      <div>
        <h2 className="font-semibold">Expiry Center</h2>
        <p className="text-sm text-muted-foreground">Monitor deal expiry, grace periods, and renewal pipeline across your portfolio</p>
      </div>

      {isEmpty && (
        <div className="bg-card border border-border rounded-lg p-10 text-center">
          <Timer className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium">No expiry alerts</p>
          <p className="text-xs text-muted-foreground mt-1">All active deals have remaining term. Set end dates on deals to see alerts here.</p>
        </div>
      )}

      {/* 7-day flame alerts */}
      {expiring7.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Flame className="w-4 h-4 text-rose-400" />
            <h3 className="text-sm font-semibold text-rose-400">Critical — Expiring within 7 days</h3>
            <span className="ml-auto text-xs bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded px-2 py-0.5 font-bold">{expiring7.length}</span>
          </div>
          <div className="space-y-2">
            {expiring7.map(d => <DealRow key={d.id} d={d} urgencyColor="border-rose-500/30 bg-rose-500/5" />)}
          </div>
        </div>
      )}

      {/* 30-day warning */}
      {expiring30.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Timer className="w-4 h-4 text-orange-400" />
            <h3 className="text-sm font-semibold text-orange-400">Warning — Expiring in 8–30 days</h3>
            <span className="ml-auto text-xs bg-orange-500/20 text-orange-400 border border-orange-500/30 rounded px-2 py-0.5 font-bold">{expiring30.length}</span>
          </div>
          <div className="space-y-2">
            {expiring30.map(d => <DealRow key={d.id} d={d} urgencyColor="border-orange-500/30 bg-orange-500/5" />)}
          </div>
        </div>
      )}

      {/* Grace period */}
      {inGrace.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-semibold text-amber-400">In Grace Period</h3>
            <span className="ml-auto text-xs bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded px-2 py-0.5 font-bold">{inGrace.length}</span>
          </div>
          <div className="space-y-2">
            {inGrace.map(d => {
              const end = new Date(d.endDate!);
              const graceEnd = new Date(end); graceEnd.setDate(end.getDate() + (d.gracePeriodDays ?? 0));
              const daysLeft = Math.ceil((graceEnd.getTime() - Date.now()) / 86400000);
              return (
                <DealRow key={d.id} d={d} urgencyColor="border-amber-500/30 bg-amber-500/5"
                  extra={<span className="text-xs text-amber-400 font-semibold">{daysLeft}d grace left</span>}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Renewal candidates */}
      {renewalCandidates.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-semibold text-cyan-400">Renewal Candidates</h3>
            <span className="ml-auto text-xs bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 rounded px-2 py-0.5 font-bold">{renewalCandidates.length}</span>
          </div>
          <p className="text-xs text-muted-foreground">Expired deals or active deals past end date that should be formally renewed or closed.</p>
          <div className="space-y-2">
            {renewalCandidates.map(d => <DealRow key={d.id} d={d} urgencyColor="border-cyan-500/30 bg-cyan-500/5" />)}
          </div>
        </div>
      )}

      {/* Summary stats */}
      {!isEmpty && (
        <div className="grid grid-cols-4 gap-3 pt-2 border-t border-border">
          {[
            { label: "Critical (7d)",  value: expiring7.length,      color: "text-rose-400"   },
            { label: "Warning (30d)",  value: expiring30.length,     color: "text-orange-400" },
            { label: "In Grace",       value: inGrace.length,        color: "text-amber-400"  },
            { label: "For Renewal",    value: renewalCandidates.length, color: "text-cyan-400"  },
          ].map(c => (
            <div key={c.label} className="bg-card border border-border rounded-lg p-3 text-center">
              <div className={cn("text-2xl font-bold", c.color)}>{c.value}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{c.label}</div>
            </div>
          ))}
        </div>
      )}
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
  const { canSeeCostRate, canSeeMargin } = useAuth();
  const [accountSearch, setAccountSearch] = useState("");
  const [selectedAccount, setSelectedAccount] = useState<SippyAccount | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);
  const [dealType, setDealType] = useState("traffic_mix");
  const [kamName, setKamName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [gracePeriod, setGracePeriod] = useState(0);
  const [volume, setVolume] = useState(100000);
  const [notes, setNotes] = useState("");
  const [destRows, setDestRows] = useState<DealDestination[]>([]);
  const [destSearch, setDestSearch] = useState("");
  const [showDestPicker, setShowDestPicker] = useState(false);
  const [submitNotes, setSubmitNotes] = useState("");

  const availableProducts = useMemo(() => {
    if (!selectedAccount) return products.filter(p => p.status === "commercial");
    const assigned = customerAssignments.filter(a => a.iAccount === selectedAccount.i_account && a.status === "active").map(a => a.productId);
    return products.filter(p => assigned.includes(p.id) && p.status === "commercial");
  }, [selectedAccount, products, customerAssignments]);

  const selectedProduct = products.find(p => p.id === selectedProductId);

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

  const autoBalance = () => {
    if (destRows.length === 0) return;
    const each = (100 / destRows.length).toFixed(2);
    setDestRows(prev => prev.map(r => ({ ...r, volumeSplitPct: each })));
  };

  const destPnLs = useMemo(() => destRows.map(d => calcDestPnL(d, volume)), [destRows, volume]);
  const totalPnL = useMemo(() => calcTotalPnL(destRows, volume), [destRows, volume]);

  const buildPayload = () => ({
    iAccount: selectedAccount?.i_account,
    customerName: selectedAccount?.id ?? `Account ${selectedAccount?.i_account}`,
    productId: selectedProductId,
    dealType,
    kamName, startDate: startDate || undefined, endDate: endDate || undefined,
    gracePeriodDays: gracePeriod, volumeCommitment: volume, notes,
    destinations: destRows.map(({ _localId, deal, ...r }) => r),
  });

  const filteredAccounts = accounts.filter(a =>
    !accountSearch || (a.id ?? "").toLowerCase().includes(accountSearch.toLowerCase()) ||
    String(a.i_account).includes(accountSearch)
  );

  const Field = ({ label, children }: { label: string; children: ReactNode }) => (
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

              {/* Deal type */}
              <Field label="Deal Type">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {DEAL_TYPE_OPTIONS.map(t => (
                    <button key={t.value} data-testid={`deal-type-${t.value}`}
                      onClick={() => setDealType(t.value)}
                      className={cn("flex flex-col items-start px-3 py-2 rounded-lg border text-left transition-all",
                        dealType === t.value ? "border-amber-500/60 bg-amber-500/10" : "border-border hover:bg-muted/50")}>
                      <span className={cn("text-xs font-semibold", dealType === t.value ? "text-amber-400" : "")}>{t.label}</span>
                      <span className="text-xs text-muted-foreground leading-tight mt-0.5">{t.desc}</span>
                    </button>
                  ))}
                </div>
              </Field>

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
                    <div className={cn("grid gap-2", canSeeCostRate ? "grid-cols-5" : "grid-cols-4")}>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Offer Rate (sell)</Label>
                        <Input type="number" step="0.000001" value={row.offerRate ?? ""} onChange={e => updateDestRow(row._localId!, "offerRate", e.target.value)} placeholder="0.0100" className="h-7 text-xs" data-testid={`input-offer-rate-${i}`} />
                      </div>
                      {canSeeCostRate && (
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Cost Rate (buy)</Label>
                        <Input type="number" step="0.000001" value={row.costRate ?? ""} onChange={e => updateDestRow(row._localId!, "costRate", e.target.value)} placeholder="0.0080" className="h-7 text-xs" data-testid={`input-cost-rate-${i}`} />
                      </div>
                      )}
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
            <p className="text-xs opacity-60">Customer → Product → Deal Type → Destinations → Rates → Live P&L</p>
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
                {canSeeCostRate && <><span className="text-muted-foreground">Cost</span><span className="font-medium text-rose-400 text-right">{fmtCurrency(pnl.cost)}</span></>}
                {canSeeMargin && <><span className="text-muted-foreground">Profit</span><span className={cn("font-bold text-right", pnl.profit >= 0 ? "text-emerald-400" : "text-rose-400")}>{fmtCurrency(pnl.profit)}</span></>}
                {canSeeMargin && <><span className="text-muted-foreground">Margin</span><span className="font-bold text-right">{fmtPct(pnl.marginPct)}</span></>}
                {!canSeeMargin && <><span className="text-muted-foreground col-span-2 text-center italic opacity-60 text-xs">Margin visible to Trading Manager+</span></>}
              </div>
            </div>
          ))}

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
                {canSeeCostRate && <><span className="text-muted-foreground">Total Cost</span><span className="font-bold text-rose-400 text-right">{fmtCurrency(totalPnL.totalCost)}</span></>}
                {canSeeMargin && <><span className="text-muted-foreground">Net Profit</span><span className={cn("font-bold text-right text-base", totalPnL.totalProfit >= 0 ? "text-emerald-400" : "text-rose-400")}>{fmtCurrency(totalPnL.totalProfit)}</span></>}
                {canSeeMargin && <><span className="text-muted-foreground">Margin</span><span className="font-bold text-right text-base">{fmtPct(totalPnL.overallMarginPct)}</span></>}
              </div>
              {canSeeMargin && (
              <div className={cn("text-xs px-2 py-1.5 rounded mt-1",
                totalPnL.health === "healthy" ? "bg-emerald-500/10 text-emerald-400" :
                totalPnL.health === "warning"  ? "bg-amber-500/10 text-amber-400" :
                "bg-rose-500/10 text-rose-400")}>
                {totalPnL.health === "healthy" ? "✓ Commercially healthy — margin above 20%" :
                 totalPnL.health === "warning"  ? "⚠ Acceptable — margin 10–20%, review before approval" :
                 "✗ At risk — margin below 10%, management sign-off required"}
              </div>
              )}
              {!canSeeMargin && (
                <div className="text-xs px-2 py-1.5 rounded mt-1 bg-muted/30 text-muted-foreground text-center italic">
                  P&amp;L health visible to Trading Manager and above
                </div>
              )}
            </div>
          )}

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

// ── Profitability Tab ─────────────────────────────────────────────────────────
function ProfitabilityTab({ deals, products }: { deals: Deal[]; products: Product[] }) {
  const { canSeeCostRate, canSeeMargin, canSeeFullPnL } = useAuth();
  const { data: allDests = [], isLoading } = useQuery<DealDestination[]>({ queryKey: ["/api/deals/all-destinations"] });

  // Only include active / approved deals in portfolio analysis
  const activeDealIds = new Set(deals.filter(d => ["active", "approved", "expiring"].includes(d.status)).map(d => d.id));
  const activeDests = allDests.filter(d => d.dealId && activeDealIds.has(d.dealId));

  // Portfolio totals
  const portfolioPnL = useMemo(() => {
    let totalRevenue = 0, totalCost = 0;
    for (const row of activeDests) {
      const deal = deals.find(d => d.id === row.dealId);
      if (!deal) continue;
      const vol = parseFloat(deal.volumeCommitment ?? "0");
      const pnl = calcDestPnL(row, vol);
      totalRevenue += pnl.revenue;
      totalCost    += pnl.cost;
    }
    const totalProfit  = totalRevenue - totalCost;
    const marginPct    = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;
    return { totalRevenue, totalCost, totalProfit, marginPct };
  }, [activeDests, deals]);

  // By product
  const byProduct = useMemo(() => {
    const map = new Map<number, { revenue: number; cost: number; mins: number; dealCount: number }>();
    for (const row of activeDests) {
      const deal = deals.find(d => d.id === row.dealId);
      if (!deal) continue;
      const vol = parseFloat(deal.volumeCommitment ?? "0");
      const pnl = calcDestPnL(row, vol);
      const cur = map.get(deal.productId) ?? { revenue: 0, cost: 0, mins: 0, dealCount: 0 };
      map.set(deal.productId, {
        revenue:    cur.revenue    + pnl.revenue,
        cost:       cur.cost       + pnl.cost,
        mins:       cur.mins       + pnl.volumeMins,
        dealCount:  cur.dealCount,
      });
    }
    // Count unique deals per product
    for (const d of deals.filter(dl => activeDealIds.has(dl.id))) {
      const cur = map.get(d.productId);
      if (cur) map.set(d.productId, { ...cur, dealCount: cur.dealCount + 1 });
    }
    return Array.from(map.entries()).map(([productId, stats]) => ({
      productId,
      product: products.find(p => p.id === productId),
      ...stats,
      profit:    stats.revenue - stats.cost,
      marginPct: stats.revenue > 0 ? ((stats.revenue - stats.cost) / stats.revenue) * 100 : 0,
    })).sort((a, b) => b.revenue - a.revenue);
  }, [activeDests, deals, products]);

  // By customer (top 8)
  const byCustomer = useMemo(() => {
    const map = new Map<number, { name: string; revenue: number; cost: number; dealCount: number }>();
    for (const row of activeDests) {
      const deal = deals.find(d => d.id === row.dealId);
      if (!deal) continue;
      const vol = parseFloat(deal.volumeCommitment ?? "0");
      const pnl = calcDestPnL(row, vol);
      const cur = map.get(deal.iAccount) ?? { name: deal.customerName ?? `Acct ${deal.iAccount}`, revenue: 0, cost: 0, dealCount: 0 };
      map.set(deal.iAccount, { ...cur, revenue: cur.revenue + pnl.revenue, cost: cur.cost + pnl.cost });
    }
    for (const d of deals.filter(dl => activeDealIds.has(dl.id))) {
      const cur = map.get(d.iAccount);
      if (cur) map.set(d.iAccount, { ...cur, dealCount: cur.dealCount + 1 });
    }
    return Array.from(map.values()).map(c => ({
      ...c,
      profit:    c.revenue - c.cost,
      marginPct: c.revenue > 0 ? ((c.revenue - c.cost) / c.revenue) * 100 : 0,
    })).sort((a, b) => b.revenue - a.revenue).slice(0, 8);
  }, [activeDests, deals]);

  // By destination (top 10)
  const byDestination = useMemo(() => {
    const map = new Map<string, { revenue: number; cost: number; mins: number }>();
    for (const row of activeDests) {
      const deal = deals.find(d => d.id === row.dealId);
      if (!deal || !row.destinationName) continue;
      const vol = parseFloat(deal.volumeCommitment ?? "0");
      const pnl = calcDestPnL(row, vol);
      const key = row.destinationName;
      const cur = map.get(key) ?? { revenue: 0, cost: 0, mins: 0 };
      map.set(key, { revenue: cur.revenue + pnl.revenue, cost: cur.cost + pnl.cost, mins: cur.mins + pnl.volumeMins });
    }
    return Array.from(map.entries()).map(([name, stats]) => ({
      name, ...stats,
      profit:    stats.revenue - stats.cost,
      marginPct: stats.revenue > 0 ? ((stats.revenue - stats.cost) / stats.revenue) * 100 : 0,
    })).sort((a, b) => b.revenue - a.revenue).slice(0, 10);
  }, [activeDests, deals]);

  if (isLoading) return (
    <div className="flex items-center justify-center h-full text-muted-foreground gap-2">
      <RefreshCw className="w-4 h-4 animate-spin" /><span className="text-sm">Loading portfolio data…</span>
    </div>
  );

  const hasData = activeDests.length > 0;

  if (!hasData) return (
    <div className="p-6 max-w-3xl">
      <div className="bg-card border border-border rounded-lg p-10 text-center">
        <BarChart3 className="w-10 h-10 mx-auto mb-3 opacity-30" />
        <p className="text-sm font-medium">No active deal data yet</p>
        <p className="text-xs text-muted-foreground mt-1">Create deals in the Simulator, then approve them — profitability will appear here once active deals have destination rate data.</p>
      </div>
    </div>
  );

  const govNote = (
    <div className="flex items-start gap-2 p-3 bg-muted/30 border border-border/50 rounded-lg text-xs text-muted-foreground">
      <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
      <span><strong>Governance:</strong> True margin and vendor cost visible to Trading Manager and Management only. KAMs see offer rate, target rate, and deal status.</span>
    </div>
  );

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold">Portfolio Profitability</h2>
          <p className="text-sm text-muted-foreground">Active deal P&amp;L — based on committed volume × deal rates</p>
        </div>
        <span className="text-xs text-muted-foreground">{activeDealIds.size} active deal{activeDealIds.size !== 1 ? "s" : ""} · {activeDests.length} destination{activeDests.length !== 1 ? "s" : ""}</span>
      </div>

      {govNote}

      {/* Portfolio summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Portfolio Revenue", value: fmtCurrency(portfolioPnL.totalRevenue), color: "text-emerald-400", show: true },
          { label: "Portfolio Cost",    value: fmtCurrency(portfolioPnL.totalCost),    color: "text-rose-400",   show: canSeeCostRate },
          { label: "Net Profit",        value: fmtCurrency(portfolioPnL.totalProfit),  color: portfolioPnL.totalProfit >= 0 ? "text-emerald-400" : "text-rose-400", show: canSeeMargin },
          { label: "Overall Margin",    value: fmtPct(portfolioPnL.marginPct),         color: portfolioPnL.marginPct >= 20 ? "text-emerald-400" : portfolioPnL.marginPct >= 10 ? "text-amber-400" : "text-rose-400", show: canSeeMargin },
        ].filter(c => c.show).map(c => (
          <div key={c.label} className="bg-card border border-border rounded-lg p-4">
            <div className="text-xs text-muted-foreground mb-1">{c.label}</div>
            <div className={cn("text-xl font-bold", c.color)}>{c.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* By Product */}
        <div className="bg-card border border-border rounded-lg">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <Package className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">By Product</h3>
          </div>
          <div className="divide-y divide-border">
            {byProduct.length === 0 && <div className="px-4 py-6 text-center text-xs text-muted-foreground">No data</div>}
            {byProduct.map(row => (
              <div key={row.productId} className="px-4 py-3 flex items-center gap-3">
                {row.product && (
                  <div className={cn("w-8 h-8 rounded flex items-center justify-center text-xs font-bold border shrink-0", PRODUCT_COLORS[row.product.color ?? "violet"])}>{row.product.code}</div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{row.product?.name ?? `Product ${row.productId}`}</div>
                  <div className="text-xs text-muted-foreground">{row.dealCount} deal{row.dealCount !== 1 ? "s" : ""} · {row.mins.toLocaleString()} min</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-bold text-emerald-400">{fmtCurrency(row.revenue)}</div>
                  {canSeeMargin && <div className={cn("text-xs font-medium", row.marginPct >= 20 ? "text-emerald-400" : row.marginPct >= 10 ? "text-amber-400" : "text-rose-400")}>{fmtPct(row.marginPct)} margin</div>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* By Customer */}
        <div className="bg-card border border-border rounded-lg">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <Users className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Top Customers by Revenue</h3>
          </div>
          <div className="divide-y divide-border">
            {byCustomer.length === 0 && <div className="px-4 py-6 text-center text-xs text-muted-foreground">No data</div>}
            {byCustomer.map((row, i) => (
              <div key={i} className="px-4 py-3 flex items-center gap-3">
                <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground shrink-0">{i + 1}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{row.name}</div>
                  <div className="text-xs text-muted-foreground">{row.dealCount} active deal{row.dealCount !== 1 ? "s" : ""}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-bold text-emerald-400">{fmtCurrency(row.revenue)}</div>
                  {canSeeMargin && <div className={cn("text-xs font-medium", row.marginPct >= 20 ? "text-emerald-400" : row.marginPct >= 10 ? "text-amber-400" : "text-rose-400")}>{fmtPct(row.marginPct)}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* By Destination */}
      {byDestination.length > 0 && (
        <div className="bg-card border border-border rounded-lg">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <Globe className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Top Destinations by Revenue</h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/20">
                {["Destination", "Volume (min)", "Revenue", ...(canSeeCostRate ? ["Cost"] : []), ...(canSeeMargin ? ["Profit", "Margin"] : [])].map(h => (
                  <th key={h} className="text-left py-2 px-4 text-xs font-medium text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {byDestination.map((row, i) => (
                <tr key={i} className="border-b border-border/50 hover:bg-muted/20">
                  <td className="py-2.5 px-4 font-medium">{row.name}</td>
                  <td className="py-2.5 px-4 text-muted-foreground">{row.mins.toLocaleString()}</td>
                  <td className="py-2.5 px-4 text-emerald-400 font-medium">{fmtCurrency(row.revenue)}</td>
                  {canSeeCostRate && <td className="py-2.5 px-4 text-rose-400">{fmtCurrency(row.cost)}</td>}
                  {canSeeMargin  && <td className={cn("py-2.5 px-4 font-bold", row.profit >= 0 ? "text-emerald-400" : "text-rose-400")}>{fmtCurrency(row.profit)}</td>}
                  {canSeeMargin  && <td className="py-2.5 px-4"><span className={cn("text-xs font-bold px-2 py-0.5 rounded", row.marginPct >= 20 ? "bg-emerald-500/15 text-emerald-400" : row.marginPct >= 10 ? "bg-amber-500/15 text-amber-400" : "bg-rose-500/15 text-rose-400")}>{fmtPct(row.marginPct)}</span></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
    mutationFn: async ({ id, n }: { id: number; n: string }) => {
      const res = await apiRequest("POST", `/api/deals/${id}/approve`, { notes: n });
      return typeof res?.json === 'function' ? res.json() : res;
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["/api/deals"] });
      const rp = data?.ratePushResult;
      if (rp && !rp.skipped) {
        toast({ title: `Deal approved ✓ — Rates pushed to Sippy`, description: `${rp.pushed} rate(s) pushed${rp.failed ? `, ${rp.failed} failed` : ''}` });
      } else if (rp?.skipped) {
        toast({ title: "Deal approved ✓", description: `Rates not pushed: ${rp.skipped}` });
      } else {
        toast({ title: "Deal approved ✓" });
      }
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const rejectMut = useMutation({
    mutationFn: ({ id, n }: { id: number; n: string }) => apiRequest("POST", `/api/deals/${id}/reject`, { notes: n }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/deals"] }); toast({ title: "Deal rejected" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const negotiateMut = useMutation({
    mutationFn: ({ id, n }: { id: number; n: string }) => apiRequest("POST", `/api/deals/${id}/negotiate`, { notes: n }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/deals"] }); toast({ title: "Returned for negotiation" }); },
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
          const typeLabel = DEAL_TYPE_OPTIONS.find(t => t.value === d.dealType)?.label;
          return (
            <div key={d.id} data-testid={`approval-card-${d.id}`} className="bg-card border border-amber-500/20 rounded-lg p-4 space-y-3">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs text-muted-foreground">{d.dealRef}</span>
                    <span className="font-semibold">{d.customerName ?? `Account ${d.iAccount}`}</span>
                    {prod && <span className={cn("text-xs px-1.5 py-0.5 rounded border font-bold", PRODUCT_COLORS[prod.color ?? "violet"])}>{prod.code} — {prod.name}</span>}
                    <StatusBadge status={d.status} />
                    {typeLabel && <span className="text-xs px-1.5 py-0.5 rounded border border-border text-muted-foreground">{typeLabel}</span>}
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1 flex-wrap">
                    {d.kamName && <span>KAM: {d.kamName}</span>}
                    {d.startDate && <span>{new Date(d.startDate).toLocaleDateString()} → {d.endDate ? new Date(d.endDate).toLocaleDateString() : "Open"}</span>}
                    {d.volumeCommitment && <span>{Number(d.volumeCommitment).toLocaleString()} min</span>}
                    {d.gracePeriodDays ? <span className="text-amber-400">Grace: {d.gracePeriodDays}d</span> : null}
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
                  <Button size="sm" variant="outline"
                    onClick={() => negotiateMut.mutate({ id: d.id, n })} disabled={negotiateMut.isPending}
                    data-testid={`btn-negotiate-${d.id}`}>
                    <Edit2 className="w-3.5 h-3.5 mr-1.5" />Return for Negotiation
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
  const timeline = [...deals].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

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
          const typeLabel = DEAL_TYPE_OPTIONS.find(t => t.value === d.dealType)?.label;
          const days = daysUntil(d.endDate);
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
                  {typeLabel && <span className="text-xs text-muted-foreground border border-border rounded px-1.5 py-0.5">{typeLabel}</span>}
                </div>
                <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground flex-wrap">
                  <span>{new Date(d.updatedAt).toLocaleString()}</span>
                  {d.kamName && <span>· KAM: {d.kamName}</span>}
                  {d.volumeCommitment && <span>· {Number(d.volumeCommitment).toLocaleString()} min</span>}
                  {d.endDate && days !== null && days > 0 && <span className="text-orange-400">· {days}d remaining</span>}
                  {d.gracePeriodDays ? <span className="text-amber-400">· {d.gracePeriodDays}d grace</span> : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Margin Truth Tab ──────────────────────────────────────────────────────────
// CDR-backed actual margin vs deal-expected margin.
// Selects a deal from the list, hits /api/deals/:id/margin-truth, shows per-destination
// actual revenue/cost/margin computed from live CDR cache.
function MarginTruthTab({ deals }: { deals: Deal[] }) {
  const [selectedDealId, setSelectedDealId] = useState<number | null>(null);

  const { data, isLoading, refetch } = useQuery<any>({
    queryKey: ["/api/deals/margin-truth", selectedDealId],
    queryFn: () => selectedDealId
      ? fetch(`/api/deals/${selectedDealId}/margin-truth`).then(r => r.json())
      : null,
    enabled: selectedDealId !== null,
  });

  const HEALTH_CFG = {
    healthy: { label: "Healthy",  color: "text-emerald-400", bg: "bg-emerald-500/15", border: "border-emerald-500/30" },
    warning: { label: "Warning",  color: "text-amber-400",   bg: "bg-amber-500/15",   border: "border-amber-500/30"  },
    risk:    { label: "At Risk",  color: "text-red-400",     bg: "bg-red-500/15",     border: "border-red-500/30"    },
    no_data: { label: "No Data",  color: "text-muted-foreground", bg: "bg-muted/20",  border: "border-border/40"     },
  };

  const activeDrillDeals = deals.filter(d => ["active", "approved", "negotiating"].includes(d.status));

  return (
    <div className="flex h-full overflow-hidden">
      {/* Deal selector sidebar */}
      <div className="w-52 shrink-0 border-r border-border/50 overflow-y-auto py-2">
        <div className="px-3 py-1.5 text-[10px] font-semibold uppercase text-muted-foreground tracking-wider">Select Deal</div>
        {activeDrillDeals.length === 0 && (
          <p className="px-3 py-2 text-xs text-muted-foreground">No active/approved deals</p>
        )}
        {activeDrillDeals.map(d => (
          <button key={d.id} data-testid={`margin-truth-deal-${d.id}`}
            onClick={() => setSelectedDealId(d.id)}
            className={cn(
              "w-full text-left px-3 py-2 text-xs border-l-2 transition-colors",
              selectedDealId === d.id
                ? "border-primary bg-muted/30 text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/10",
            )}>
            <div className="font-mono text-[10px] text-muted-foreground">{d.dealRef}</div>
            <div className="truncate">{d.customerName}</div>
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {!selectedDealId ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
            <Activity className="w-8 h-8 opacity-30" />
            <p className="text-sm">Select a deal to see CDR-backed margin truth</p>
          </div>
        ) : isLoading ? (
          <div className="flex items-center gap-2 justify-center py-16 text-xs text-muted-foreground">
            <RefreshCw className="w-4 h-4 animate-spin" /> Computing margin truth from CDR cache…
          </div>
        ) : !data || data.error ? (
          <div className="text-center py-12 text-xs text-muted-foreground">{data?.error ?? "No data available"}</div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* Header summary */}
            <div className={cn(
              "rounded-md border p-4 flex flex-wrap gap-6 items-start",
              HEALTH_CFG[data.overallHealthStatus as keyof typeof HEALTH_CFG]?.bg ?? "bg-muted/10",
              HEALTH_CFG[data.overallHealthStatus as keyof typeof HEALTH_CFG]?.border ?? "border-border/40",
            )}>
              <div>
                <div className="text-[10px] text-muted-foreground mb-0.5">Deal</div>
                <div className="text-xs font-mono font-medium">{data.dealRef}</div>
                <div className="text-xs text-muted-foreground">{data.customerName}</div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground mb-0.5">CDR Window</div>
                <div className="text-xs tabular-nums">{data.cdrWindowCdrs} CDRs in cache</div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground mb-0.5">Total Revenue</div>
                <div className="text-xs tabular-nums font-mono">${Number(data.totalRevenue).toFixed(4)}</div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground mb-0.5">Total Cost</div>
                <div className="text-xs tabular-nums font-mono">${Number(data.totalCost).toFixed(4)}</div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground mb-0.5">Gross Margin</div>
                <div className="text-xs tabular-nums font-mono">${Number(data.totalMargin).toFixed(4)}</div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground mb-0.5">Margin %</div>
                <div className={cn("text-sm font-bold tabular-nums",
                  HEALTH_CFG[data.overallHealthStatus as keyof typeof HEALTH_CFG]?.color ?? "text-muted-foreground"
                )}>
                  {data.overallMarginPct !== null ? `${data.overallMarginPct.toFixed(1)}%` : "—"}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground mb-0.5">Health</div>
                <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded border",
                  HEALTH_CFG[data.overallHealthStatus as keyof typeof HEALTH_CFG]?.color,
                  HEALTH_CFG[data.overallHealthStatus as keyof typeof HEALTH_CFG]?.bg,
                  HEALTH_CFG[data.overallHealthStatus as keyof typeof HEALTH_CFG]?.border,
                )}>
                  {HEALTH_CFG[data.overallHealthStatus as keyof typeof HEALTH_CFG]?.label ?? data.overallHealthStatus}
                </span>
              </div>
              <div className="ml-auto">
                <button onClick={() => refetch()} data-testid="btn-refresh-margin-truth"
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded">
                  <RefreshCw className="w-3 h-3" /> Refresh
                </button>
                {data.computedAt && (
                  <div className="text-[10px] text-muted-foreground mt-1">
                    {new Date(data.computedAt).toLocaleTimeString()}
                  </div>
                )}
              </div>
            </div>

            {/* Per-destination table */}
            <div>
              <div className="text-xs font-medium mb-2 flex items-center gap-2">
                <Globe className="w-3.5 h-3.5 text-muted-foreground" />
                Per-Destination CDR Margin Analysis
              </div>
              {!data.destinations?.length ? (
                <p className="text-xs text-muted-foreground py-4">No destinations on this deal</p>
              ) : (
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-border/50 bg-muted/20">
                      {["Destination", "Prefix", "Rate/min", "Calls", "ASR%", "Minutes", "Revenue", "Cost", "Margin", "Margin%", "Health"].map(h => (
                        <th key={h} className="text-left py-2 px-3 font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.destinations.map((d: any, i: number) => {
                      const hcfg = HEALTH_CFG[d.healthStatus as keyof typeof HEALTH_CFG] ?? HEALTH_CFG.no_data;
                      return (
                        <tr key={i} className="border-b border-border/20 hover:bg-muted/10" data-testid={`margin-truth-row-${i}`}>
                          <td className="py-2 px-3 truncate max-w-[160px]">{d.destinationName ?? "—"}</td>
                          <td className="py-2 px-3 font-mono text-amber-400">{d.dialPrefix ?? "—"}</td>
                          <td className="py-2 px-3 font-mono tabular-nums">${Number(d.ratePerMin).toFixed(6)}</td>
                          <td className="py-2 px-3 tabular-nums">{d.totalCalls}</td>
                          <td className="py-2 px-3 tabular-nums">{d.asr !== null ? `${d.asr}%` : "—"}</td>
                          <td className="py-2 px-3 tabular-nums">{d.totalMinutes.toFixed(2)}</td>
                          <td className="py-2 px-3 font-mono tabular-nums">${d.totalRevenue.toFixed(4)}</td>
                          <td className="py-2 px-3 font-mono tabular-nums">${d.totalCost.toFixed(4)}</td>
                          <td className="py-2 px-3 font-mono tabular-nums">${d.grossMargin.toFixed(4)}</td>
                          <td className={cn("py-2 px-3 tabular-nums font-medium", hcfg.color)}>
                            {d.marginPct !== null ? `${d.marginPct.toFixed(1)}%` : "—"}
                          </td>
                          <td className="py-2 px-3">
                            <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded border", hcfg.color, hcfg.bg, hcfg.border)}>
                              {hcfg.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {data.cdrWindowCdrs === 0 && (
              <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-400/10 border border-amber-400/30 rounded-md px-3 py-2">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                No CDRs found for this customer in the current cache window. CDR cache covers the last ~24h. Check that iAccount is correctly linked to this deal.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function DealsPage() {
  const [activeTab, setActiveTab] = useState<TabId>("dashboard");
  const [simulatorDeal, setSimulatorDeal] = useState<Deal | null>(null);

  const { data: dealList = [] }         = useQuery<Deal[]>({ queryKey: ["/api/deals"] });
  const { data: products = [] }         = useQuery<any[]>({ queryKey: ["/api/product-registry/products"] });
  const { data: destinations = [] }     = useQuery<Destination[]>({ queryKey: ["/api/product-registry/destinations"] });
  const { data: custAssignments = [] }  = useQuery<CustomerAssignment[]>({ queryKey: ["/api/product-registry/customer-assignments"] });
  const { data: accountsData }          = useQuery<{ accounts: SippyAccount[] }>({ queryKey: ["/api/sippy/accounts"] });
  const accounts = accountsData?.accounts ?? [];

  const qc = useQueryClient();
  const { toast } = useToast();
  const deleteMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/deals/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/deals"] }); toast({ title: "Deal deleted" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const pendingCount = dealList.filter(d => d.status === "pending_approval").length;

  // Expiry warning count for tab badge
  const today = new Date();
  const in7d  = new Date(today); in7d.setDate(today.getDate() + 7);
  const expiringCount = dealList.filter(d => { if (!d.endDate || d.status !== "active") return false; const end = new Date(d.endDate); return end >= today && end <= in7d; }).length;

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Tab bar */}
      <div className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur-sm flex-shrink-0">
        <div className="flex items-center gap-0 px-4 h-11">
          <div className="flex items-center gap-1.5 mr-4 pr-4 border-r border-border/50 text-xs font-medium text-muted-foreground shrink-0">
            <Briefcase className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden sm:inline">Voice Trading</span>
          </div>
          <div className="flex items-center gap-0.5 overflow-x-auto flex-1">
            {TABS.map(tab => {
              const Icon = tab.icon;
              const badge =
                tab.id === "approvals"  && pendingCount   > 0 ? pendingCount   :
                tab.id === "dashboard"  && expiringCount  > 0 ? expiringCount  : null;
              return (
                <button key={tab.id} data-testid={`tab-${tab.id}`}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap relative shrink-0",
                    activeTab === tab.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                  )}>
                  <Icon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                  {badge && (
                    <span className={cn("ml-1 text-xs text-white rounded-full px-1.5 py-0.5 font-bold leading-none",
                      tab.id === "approvals" ? "bg-amber-500" : "bg-orange-500"
                    )}>{badge}</span>
                  )}
                </button>
              );
            })}
          </div>
          <Button
            data-testid="btn-new-deal"
            size="sm"
            className="ml-2 shrink-0 h-7 px-3 text-xs gap-1.5"
            onClick={() => { setSimulatorDeal(null); setActiveTab("simulator"); }}
          >
            <Plus className="w-3.5 h-3.5" />
            New Deal
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === "dashboard"     && <div className="h-full overflow-y-auto"><DashboardTab deals={dealList} products={products} onNewDeal={() => { setSimulatorDeal(null); setActiveTab("simulator"); }} /></div>}
        {activeTab === "board"         && <div className="h-full overflow-hidden"><DealBoardTab deals={dealList} products={products} onSelect={d => { setSimulatorDeal(d); setActiveTab("simulator"); }} onDelete={id => deleteMut.mutate(id)} /></div>}
        {activeTab === "simulator"     && <div className="h-full overflow-hidden"><DealSimulatorTab products={products} destinations={destinations} customerAssignments={custAssignments} accounts={accounts} existingDeal={simulatorDeal} /></div>}
        {activeTab === "profitability" && <div className="h-full overflow-hidden"><ProfitabilityTab deals={dealList} products={products} /></div>}
        {activeTab === "margin-truth"  && <div className="h-full overflow-hidden"><MarginTruthTab deals={dealList} /></div>}
        {activeTab === "expiry"        && <div className="h-full overflow-y-auto"><ExpiryCenterTab deals={dealList} products={products} /></div>}
        {activeTab === "approvals"     && <div className="h-full overflow-y-auto"><ApprovalsTab deals={dealList} products={products} /></div>}
        {activeTab === "history"       && <div className="h-full overflow-y-auto"><DealHistoryTab deals={dealList} products={products} /></div>}
      </div>
    </div>
  );
}

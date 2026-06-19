import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useState, useMemo } from "react";
import {
  Search, Users, UserCheck, UserX, Link2, Unlink, ChevronDown,
  RefreshCw, Building2, Filter, X, CheckSquare, Square, BarChart2,
  AlertCircle, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

// ── Types ─────────────────────────────────────────────────────────────────────
interface AccountEntry {
  iAccount: number;
  username: string;
  kamId:        number | null;
  kamName:      string | null;
  assignmentId: number | null;
}

interface AccountsListResponse {
  accounts: AccountEntry[];
  total: number;
}

interface KamAccount {
  id: number;
  kamId: number;
  accountId: string;
  clientName: string | null;
}

interface Kam {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  title: string | null;
  active: boolean;
  accounts: KamAccount[];
}

// ── KAM colour ring (cycles through palette) ──────────────────────────────────
const KAM_COLOURS = [
  "bg-violet-500/20 text-violet-300 border-violet-500/30",
  "bg-sky-500/20 text-sky-300 border-sky-500/30",
  "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  "bg-amber-500/20 text-amber-300 border-amber-500/30",
  "bg-rose-500/20 text-rose-300 border-rose-500/30",
  "bg-pink-500/20 text-pink-300 border-pink-500/30",
  "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
  "bg-orange-500/20 text-orange-300 border-orange-500/30",
];

// ── KAM Assign Dropdown (per row) ─────────────────────────────────────────────
function KamDropdown({
  account, kams, kamColourMap, onAssign, onUnassign,
}: {
  account: AccountEntry;
  kams: Kam[];
  kamColourMap: Map<number, string>;
  onAssign: (kamId: number) => void;
  onUnassign: () => void;
}) {
  const [open, setOpen] = useState(false);
  const colour = account.kamId ? kamColourMap.get(account.kamId) : undefined;

  return (
    <div className="relative">
      <button
        data-testid={`btn-kam-assign-${account.iAccount}`}
        onClick={() => setOpen(v => !v)}
        className={cn(
          "flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium transition-all",
          account.kamId
            ? cn(colour, "hover:brightness-110")
            : "bg-muted/30 text-muted-foreground border-border/30 hover:bg-muted/50",
        )}
      >
        {account.kamId ? (
          <><UserCheck className="w-3 h-3" />{account.kamName}</>
        ) : (
          <><UserX className="w-3 h-3 opacity-50" /><span className="opacity-50">Unassigned</span></>
        )}
        <ChevronDown className="w-3 h-3 opacity-60" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-40 bg-popover border border-border rounded-xl shadow-xl min-w-[180px] overflow-hidden">
            {/* Header */}
            <div className="px-3 py-2 border-b border-border/50 text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
              Assign to KAM
            </div>
            {/* Unassign option */}
            {account.kamId && (
              <button
                data-testid={`btn-unassign-${account.iAccount}`}
                onClick={() => { onUnassign(); setOpen(false); }}
                className="flex items-center gap-2 w-full px-3 py-2 text-xs text-rose-400 hover:bg-rose-500/10 transition-colors"
              >
                <Unlink className="w-3 h-3" />Remove assignment
              </button>
            )}
            {/* KAM list */}
            {kams.filter(k => k.active).map(k => (
              <button
                key={k.id}
                data-testid={`btn-assign-to-kam-${k.id}-${account.iAccount}`}
                onClick={() => { onAssign(k.id); setOpen(false); }}
                className={cn(
                  "flex items-center gap-2 w-full px-3 py-2 text-xs hover:bg-muted/30 transition-colors",
                  account.kamId === k.id ? "font-semibold text-foreground" : "text-muted-foreground",
                )}
              >
                <span className={cn(
                  "w-2 h-2 rounded-full flex-shrink-0",
                  kamColourMap.get(k.id)?.split(" ")[0]?.replace("/20", "/70") ?? "bg-muted",
                )} />
                {k.name}
                {account.kamId === k.id && <CheckSquare className="w-3 h-3 ml-auto text-emerald-400" />}
              </button>
            ))}
            {kams.filter(k => k.active).length === 0 && (
              <div className="px-3 py-3 text-xs text-muted-foreground text-center">No KAMs configured</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function AccountNamesPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch]       = useState("");
  const [filterKam, setFilterKam] = useState<"all" | "assigned" | "unassigned" | number>("all");
  const [selected, setSelected]   = useState<Set<number>>(new Set());

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: listData, isLoading: listLoading, refetch } =
    useQuery<AccountsListResponse>({ queryKey: ["/api/accounts-list"], staleTime: 30_000 });

  const { data: kamsData, isLoading: kamsLoading } =
    useQuery<Kam[]>({ queryKey: ["/api/kam"], staleTime: 60_000 });

  const accounts = listData?.accounts ?? [];
  const kams     = kamsData ?? [];

  // Stable KAM colour map
  const kamColourMap = useMemo(() => {
    const m = new Map<number, string>();
    kams.forEach((k, i) => m.set(k.id, KAM_COLOURS[i % KAM_COLOURS.length]));
    return m;
  }, [kams]);

  // ── Mutations ──────────────────────────────────────────────────────────────
  const assignMutation = useMutation({
    mutationFn: async ({ account, kamId }: { account: AccountEntry; kamId: number }) => {
      // Remove existing assignment first
      if (account.assignmentId) {
        await apiRequest("DELETE", `/api/kam/accounts/${account.assignmentId}`, {});
      }
      // Create new
      await apiRequest("POST", `/api/kam/${kamId}/accounts`, {
        accountId:  String(account.iAccount),
        clientName: account.username,
        dropThreshold: 0,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/accounts-list"] });
      qc.invalidateQueries({ queryKey: ["/api/kam"] });
      toast({ title: "KAM assigned", description: "Account assignment updated." });
    },
    onError: (e: any) => toast({ title: "Failed to assign", description: e.message, variant: "destructive" }),
  });

  const unassignMutation = useMutation({
    mutationFn: async (assignmentId: number) => {
      await apiRequest("DELETE", `/api/kam/accounts/${assignmentId}`, {});
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/accounts-list"] });
      qc.invalidateQueries({ queryKey: ["/api/kam"] });
      toast({ title: "Assignment removed" });
    },
    onError: (e: any) => toast({ title: "Failed to remove", description: e.message, variant: "destructive" }),
  });

  const bulkAssignMutation = useMutation({
    mutationFn: async (kamId: number) => {
      const targets = accounts.filter(a => selected.has(a.iAccount));
      for (const acct of targets) {
        if (acct.assignmentId) {
          await apiRequest("DELETE", `/api/kam/accounts/${acct.assignmentId}`, {});
        }
        await apiRequest("POST", `/api/kam/${kamId}/accounts`, {
          accountId:  String(acct.iAccount),
          clientName: acct.username,
          dropThreshold: 0,
        });
      }
    },
    onSuccess: () => {
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["/api/accounts-list"] });
      qc.invalidateQueries({ queryKey: ["/api/kam"] });
      toast({ title: `${selected.size} account(s) assigned` });
    },
    onError: (e: any) => toast({ title: "Bulk assign failed", description: e.message, variant: "destructive" }),
  });

  const bulkUnassignMutation = useMutation({
    mutationFn: async () => {
      const targets = accounts.filter(a => selected.has(a.iAccount) && a.assignmentId);
      for (const acct of targets) {
        if (acct.assignmentId) {
          await apiRequest("DELETE", `/api/kam/accounts/${acct.assignmentId}`, {});
        }
      }
    },
    onSuccess: () => {
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["/api/accounts-list"] });
      qc.invalidateQueries({ queryKey: ["/api/kam"] });
      toast({ title: "Assignments removed" });
    },
    onError: (e: any) => toast({ title: "Bulk unassign failed", description: e.message, variant: "destructive" }),
  });

  // ── Filter / search ────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = accounts;
    // Search
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(a =>
        a.username.toLowerCase().includes(q) ||
        String(a.iAccount).includes(q) ||
        (a.kamName?.toLowerCase().includes(q) ?? false),
      );
    }
    // KAM filter
    if (filterKam === "assigned")   list = list.filter(a => a.kamId !== null);
    if (filterKam === "unassigned") list = list.filter(a => a.kamId === null);
    if (typeof filterKam === "number") list = list.filter(a => a.kamId === filterKam);
    return list;
  }, [accounts, search, filterKam]);

  // ── Selection helpers ──────────────────────────────────────────────────────
  const allPageSelected = filtered.length > 0 && filtered.every(a => selected.has(a.iAccount));
  function toggleAll() {
    if (allPageSelected) {
      setSelected(prev => { const n = new Set(prev); filtered.forEach(a => n.delete(a.iAccount)); return n; });
    } else {
      setSelected(prev => { const n = new Set(prev); filtered.forEach(a => n.add(a.iAccount)); return n; });
    }
  }
  function toggleOne(id: number) {
    setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  // ── Stats ──────────────────────────────────────────────────────────────────
  const totalAccounts  = accounts.length;
  const assignedCount  = accounts.filter(a => a.kamId !== null).length;
  const unassignedCount = totalAccounts - assignedCount;

  const isLoading = listLoading || kamsLoading;

  // ── Bulk assign dropdown state ─────────────────────────────────────────────
  const [bulkOpen, setBulkOpen] = useState(false);

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 px-6 pt-6 pb-4 border-b border-border/30 bg-card/30">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Building2 className="w-6 h-6 text-violet-400" />
              Account Names
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              All Sippy accounts — assign each to a KAM for tracking and alerting
            </p>
          </div>
          <button
            data-testid="btn-refresh-accounts"
            onClick={() => refetch()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted/30 hover:bg-muted/50 border border-border/30 text-xs text-muted-foreground transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />Refresh
          </button>
        </div>

        {/* Stats strip */}
        <div className="mt-4 grid grid-cols-3 gap-3">
          {[
            { label: "Total Accounts",  value: totalAccounts,  icon: Building2,  colour: "text-foreground"       },
            { label: "Assigned to KAM", value: assignedCount,  icon: UserCheck,  colour: "text-emerald-400"      },
            { label: "Unassigned",      value: unassignedCount, icon: UserX,     colour: "text-amber-400"        },
          ].map(s => (
            <div key={s.label} className="flex items-center gap-3 bg-card border border-border/30 rounded-xl px-4 py-3">
              <s.icon className={cn("w-5 h-5", s.colour)} />
              <div>
                <div className={cn("text-2xl font-bold tabular-nums", s.colour)}>
                  {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : s.value}
                </div>
                <div className="text-[11px] text-muted-foreground">{s.label}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Toolbar ───────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 flex flex-wrap items-center gap-2 px-6 py-3 border-b border-border/20 bg-card/10">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            data-testid="input-search-accounts"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search name or ID…"
            className="w-full pl-8 pr-3 py-1.5 bg-background border border-border/40 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500/50"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* KAM filter */}
        <div className="flex items-center gap-1 flex-wrap">
          <Filter className="w-3.5 h-3.5 text-muted-foreground" />
          {[
            { label: "All",        value: "all"        },
            { label: "Assigned",   value: "assigned"   },
            { label: "Unassigned", value: "unassigned" },
          ].map(f => (
            <button
              key={f.value}
              data-testid={`btn-filter-${f.value}`}
              onClick={() => setFilterKam(f.value as any)}
              className={cn(
                "px-2.5 py-1 rounded-full text-xs font-medium transition-all",
                filterKam === f.value
                  ? "bg-violet-500/20 text-violet-300 border border-violet-500/30"
                  : "bg-muted/20 text-muted-foreground border border-border/20 hover:bg-muted/40",
              )}
            >
              {f.label}
            </button>
          ))}
          {kams.filter(k => k.active).map(k => (
            <button
              key={k.id}
              data-testid={`btn-filter-kam-${k.id}`}
              onClick={() => setFilterKam(filterKam === k.id ? "all" : k.id)}
              className={cn(
                "px-2.5 py-1 rounded-full text-xs font-medium border transition-all",
                filterKam === k.id
                  ? cn(kamColourMap.get(k.id), "opacity-100")
                  : "bg-muted/20 text-muted-foreground border-border/20 hover:bg-muted/40",
              )}
            >
              {k.name}
            </button>
          ))}
        </div>

        {/* Results count */}
        <span className="ml-auto text-xs text-muted-foreground whitespace-nowrap">
          {filtered.length} of {totalAccounts} accounts
        </span>
      </div>

      {/* ── Bulk action bar (shows when selection active) ──────────────────── */}
      {selected.size > 0 && (
        <div className="flex-shrink-0 flex items-center gap-3 px-6 py-2 bg-violet-500/10 border-b border-violet-500/20">
          <Users className="w-4 h-4 text-violet-400" />
          <span className="text-sm font-medium text-violet-300">{selected.size} selected</span>
          <div className="flex items-center gap-2 ml-auto">
            {/* Bulk assign */}
            <div className="relative">
              <button
                data-testid="btn-bulk-assign"
                onClick={() => setBulkOpen(v => !v)}
                disabled={bulkAssignMutation.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-500/20 hover:bg-violet-500/30 border border-violet-500/30 text-xs text-violet-300 font-medium transition-colors"
              >
                <Link2 className="w-3.5 h-3.5" />Assign to KAM
                <ChevronDown className="w-3 h-3" />
              </button>
              {bulkOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setBulkOpen(false)} />
                  <div className="absolute right-0 top-full mt-1 z-40 bg-popover border border-border rounded-xl shadow-xl min-w-[180px] overflow-hidden">
                    {kams.filter(k => k.active).map(k => (
                      <button
                        key={k.id}
                        data-testid={`btn-bulk-assign-to-${k.id}`}
                        onClick={() => { setBulkOpen(false); bulkAssignMutation.mutate(k.id); }}
                        className="flex items-center gap-2 w-full px-3 py-2 text-xs text-muted-foreground hover:bg-muted/30 transition-colors"
                      >
                        <span className={cn("w-2 h-2 rounded-full", kamColourMap.get(k.id)?.split(" ")[0]?.replace("/20", "/70"))} />
                        {k.name}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            {/* Bulk unassign */}
            <button
              data-testid="btn-bulk-unassign"
              onClick={() => bulkUnassignMutation.mutate()}
              disabled={bulkUnassignMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-xs text-rose-400 font-medium transition-colors"
            >
              <Unlink className="w-3.5 h-3.5" />Remove KAM
            </button>
            {/* Clear */}
            <button
              onClick={() => setSelected(new Set())}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ── Table ─────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto min-h-0">
        {isLoading ? (
          <div className="flex items-center justify-center h-48 gap-2 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">Loading accounts…</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-2 text-muted-foreground">
            <AlertCircle className="w-8 h-8 opacity-20" />
            <span className="text-sm">{accounts.length === 0 ? "No accounts found — Sippy connection may be offline" : "No accounts match your filter"}</span>
          </div>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-border/30 bg-card/30 sticky top-0 z-10">
                <th className="w-10 px-4 py-2.5 text-left">
                  <button
                    data-testid="btn-select-all"
                    onClick={toggleAll}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {allPageSelected
                      ? <CheckSquare className="w-4 h-4 text-violet-400" />
                      : <Square className="w-4 h-4" />}
                  </button>
                </th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">ID</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Account Name</th>
                <th className="px-3 py-2.5 text-right text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">KAM Assignment</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(acct => {
                const isSelected = selected.has(acct.iAccount);
                return (
                  <tr
                    key={acct.iAccount}
                    data-testid={`row-account-${acct.iAccount}`}
                    className={cn(
                      "border-b border-border/10 transition-colors",
                      isSelected ? "bg-violet-500/8" : "hover:bg-card/40",
                    )}
                  >
                    {/* Checkbox */}
                    <td className="px-4 py-2.5">
                      <button
                        data-testid={`btn-select-${acct.iAccount}`}
                        onClick={() => toggleOne(acct.iAccount)}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {isSelected
                          ? <CheckSquare className="w-4 h-4 text-violet-400" />
                          : <Square className="w-4 h-4" />}
                      </button>
                    </td>
                    {/* ID */}
                    <td className="px-3 py-2.5">
                      <span className="font-mono text-xs text-muted-foreground bg-muted/30 px-1.5 py-0.5 rounded">
                        {acct.iAccount}
                      </span>
                    </td>
                    {/* Name */}
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500/20 to-sky-500/20 border border-border/30 flex items-center justify-center flex-shrink-0">
                          <span className="text-[10px] font-bold text-muted-foreground uppercase">
                            {acct.username.slice(0, 2)}
                          </span>
                        </div>
                        <span
                          className="font-medium text-foreground"
                          data-testid={`text-account-name-${acct.iAccount}`}
                        >
                          {acct.username}
                        </span>
                      </div>
                    </td>
                    {/* KAM assignment */}
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex justify-end">
                        <KamDropdown
                          account={acct}
                          kams={kams}
                          kamColourMap={kamColourMap}
                          onAssign={kamId => assignMutation.mutate({ account: acct, kamId })}
                          onUnassign={() => acct.assignmentId && unassignMutation.mutate(acct.assignmentId)}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Footer count ──────────────────────────────────────────────────── */}
      {!isLoading && filtered.length > 0 && (
        <div className="flex-shrink-0 flex items-center justify-between px-6 py-2 border-t border-border/20 bg-card/10 text-xs text-muted-foreground">
          <span>
            {selected.size > 0 ? `${selected.size} selected · ` : ""}
            {filtered.length} account{filtered.length !== 1 ? "s" : ""}
          </span>
          <span className="flex items-center gap-1.5">
            <BarChart2 className="w-3 h-3" />
            {assignedCount}/{totalAccounts} assigned to KAM
          </span>
        </div>
      )}
    </div>
  );
}

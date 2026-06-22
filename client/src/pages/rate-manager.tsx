import { useState, useMemo, useRef, useEffect } from "react";
import { useSearch } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import {
  ChevronDown, Search, X, RefreshCw, Check, AlertTriangle, Send,
  BarChart2, Eye, Clock, ChevronRight, Loader2, CircleCheck, CircleX,
  Plus, Trash2, Bell, Building2, BellRing, TrendingUp, TrendingDown, Lightbulb,
  PackageCheck, Tag, Calendar, ShieldAlert, ExternalLink, Download, Mail,
} from "lucide-react";

// ── Display helper — strips internal product/trunk prefix digit for UI display ──
// Product trunk digits: 1=FC, 2=BC, 6=SB, 7=SC — never exposed to operators.
// Backend Sippy API calls always use the FULL prefix; this is display-layer only.
const PRODUCT_TRUNK_DIGITS = new Set(["1", "2", "6", "7"]);
function displayPrefix(sippyPrefix: string | null | undefined): string {
  if (!sippyPrefix) return "—";
  const s = String(sippyPrefix);
  return PRODUCT_TRUNK_DIGITS.has(s[0]) ? s.slice(1) : s;
}

// ── Types ──────────────────────────────────────────────────────────────────────
interface Product {
  id: number; code: string; name: string;
  trunkPrefix: string | null; status: string; color: string;
  segment?: string | null;
}
interface SippyAccount { iAccount: number; username: string; balance: number; cached?: boolean; tariffName?: string | null; }
interface DestNode {
  id: number; parentId: number | null; level: number; name: string;
  countryCode: string | null; dialPrefix: string | null; commercialStatus: string;
}
interface RateEntry {
  iRate: number; prefix: string; price1: number | null;
  activationDate: string | null; expirationDate: string | null; forbidden: boolean | null;
}

// ── MultiSelect Dropdown ───────────────────────────────────────────────────────
function MultiSelect({
  options,
  value,
  onChange,
  placeholder = "Leave blank for all",
  searchable = true,
  maxHeight = "h-48",
}: {
  options: { value: string; label: string }[];
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  searchable?: boolean;
  maxHeight?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const filtered = searchable
    ? options.filter(o => o.label.toLowerCase().includes(q.toLowerCase()))
    : options;

  const display =
    value.length === 0 ? placeholder
    : value.length === options.length ? "All selected"
    : `${value.length} of ${options.length} selected`;

  const toggle = (v: string) =>
    onChange(value.includes(v) ? value.filter(x => x !== v) : [...value, v]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-2 py-1 text-xs border border-border/60 rounded bg-background hover:bg-muted/50 text-left"
        data-testid="multiselect-trigger"
      >
        <span className="truncate text-foreground/80">{display}</span>
        <ChevronDown className="w-3 h-3 shrink-0 text-muted-foreground ml-1" />
      </button>
      {open && (
        <div className="absolute top-full left-0 right-0 z-50 bg-popover border border-border rounded shadow-xl mt-px flex flex-col" style={{ minWidth: "180px" }}>
          {searchable && (
            <div className="flex items-center gap-1 px-2 py-1 border-b border-border">
              <Search className="w-3 h-3 text-muted-foreground shrink-0" />
              <input
                className="flex-1 text-xs bg-transparent outline-none placeholder:text-muted-foreground/60"
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Search..."
                autoFocus
              />
              {q && (
                <button onClick={() => setQ("")}>
                  <X className="w-3 h-3 text-muted-foreground hover:text-foreground" />
                </button>
              )}
            </div>
          )}
          <div className="flex items-center gap-2 px-2 py-1 border-b border-border/40 bg-muted/20">
            <button
              className="text-[10px] text-muted-foreground hover:text-primary"
              onClick={() => onChange(options.map(o => o.value))}
            >✓ Check all</button>
            <span className="text-border">|</span>
            <button className="text-[10px] text-muted-foreground hover:text-primary" onClick={() => onChange([])}>
              Uncheck all
            </button>
          </div>
          <div className={cn("overflow-y-auto", maxHeight)}>
            {filtered.map(o => {
              const checked = value.includes(o.value);
              return (
                <label
                  key={o.value}
                  className={cn(
                    "flex items-center gap-2 px-2 py-1 cursor-pointer text-xs hover:bg-accent/40",
                    checked && "text-primary",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(o.value)}
                    className="w-3 h-3 accent-primary"
                  />
                  <span className="truncate">{o.label}</span>
                </label>
              );
            })}
            {filtered.length === 0 && (
              <div className="text-center text-xs text-muted-foreground py-3">No results</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Toggle Buttons ─────────────────────────────────────────────────────────────
function ToggleButtons({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex rounded overflow-hidden border border-border/60">
      {options.map(opt => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={cn(
            "flex-1 px-2 py-1 text-[10px] font-medium transition-colors",
            value === opt
              ? "bg-primary text-primary-foreground"
              : "bg-background text-muted-foreground hover:bg-muted/40",
          )}
          data-testid={`toggle-${opt.toLowerCase()}`}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

// ── Sidebar Section ────────────────────────────────────────────────────────────
function SidebarSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide px-1 pb-0.5 border-b border-border/30">
        {title}
      </div>
      {children}
    </div>
  );
}

// ── Rate Detail Panel ─────────────────────────────────────────────────────────
function RateDetailPanel({
  account,
  trunkPrefix,
  allDests,
  selectedCountries,
  selectedOperators,
  selectedCategories,
  selectedDetails,
  onClose,
}: {
  account: SippyAccount;
  trunkPrefix: string;
  allDests: DestNode[];
  selectedCountries: string[];
  selectedOperators: string[];
  selectedCategories: string[];
  selectedDetails: string[];
  onClose: () => void;
}) {
  const { data: acctInfo, isLoading: infoLoading } = useQuery<{
    iAccount: number; username: string; iTariff: number | null;
  }>({
    queryKey: [`/api/sippy/accounts/${account.iAccount}/info`],
    enabled: !!account.iAccount,
  });

  const iTariff = acctInfo?.iTariff;

  const { data: tariffData, isLoading: ratesLoading } = useQuery<RateEntry[]>({
    queryKey: [`/api/sippy/tariffs/${iTariff}/rates?limit=500`],
    enabled: !!iTariff,
  });

  // Determine which destination filter (if any) is active, deepest level wins
  const activeDestIds = selectedDetails.length > 0 ? selectedDetails
    : selectedCategories.length > 0 ? selectedCategories
    : selectedOperators.length > 0 ? selectedOperators
    : selectedCountries.length > 0 ? selectedCountries
    : [];
  // Walk the tree to collect every dialPrefix under the active selection (any level)
  const allowedPrefixes = useMemo(() => {
    if (activeDestIds.length === 0) return null; // null = no destination filter, show all
    const idSet = new Set(activeDestIds.map(Number));
    const collect = (nodeId: number, acc: Set<string>) => {
      const node = allDests.find(d => d.id === nodeId);
      if (node?.dialPrefix) acc.add(node.dialPrefix);
      allDests.filter(d => d.parentId === nodeId).forEach(child => collect(child.id, acc));
    };
    const acc = new Set<string>();
    idSet.forEach(id => collect(id, acc));
    return acc;
  }, [activeDestIds, allDests]);
  const rates = useMemo(() => {
    if (!tariffData || !Array.isArray(tariffData)) return [];
    let filtered = trunkPrefix
      ? tariffData.filter(r => String(r.prefix ?? "").startsWith(trunkPrefix))
      : tariffData;
    if (allowedPrefixes) {
      filtered = filtered.filter(r => {
        const rawPrefix = trunkPrefix ? String(r.prefix).slice(trunkPrefix.length) : String(r.prefix ?? "");
        return Array.from(allowedPrefixes).some(p => rawPrefix.startsWith(p) || p.startsWith(rawPrefix));
      });
    }
    return filtered.map(r => {
      const rawPrefix = trunkPrefix
        ? String(r.prefix).slice(trunkPrefix.length)
        : String(r.prefix ?? "");
      const dest = allDests.find(d => d.dialPrefix && (d.dialPrefix === rawPrefix || d.dialPrefix === r.prefix));
      return { ...r, rawPrefix, destName: dest?.name ?? rawPrefix };
    });
  }, [tariffData, trunkPrefix, allDests, allowedPrefixes]);

  const isLoading = infoLoading || ratesLoading;
  const [selectedRateKeys, setSelectedRateKeys] = useState<Set<string>>(new Set());
  const [changeModalOpen, setChangeModalOpen] = useState(false);
  const rateKey = (r: RateEntry & { rawPrefix?: string }, i: number) => String(r.iRate ?? `${r.prefix}-${i}`);
  const allSelected = rates.length > 0 && rates.every((r, i) => selectedRateKeys.has(rateKey(r, i)));
  const toggleAll = () => {
    if (allSelected) setSelectedRateKeys(new Set());
    else setSelectedRateKeys(new Set(rates.map((r, i) => rateKey(r, i))));
  };
  const toggleOne = (key: string) => {
    setSelectedRateKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };
  const selectedRates = rates.filter((r, i) => selectedRateKeys.has(rateKey(r, i)));

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-gradient-to-r from-muted/30 to-muted/10 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Eye className="w-3.5 h-3.5 text-primary" />
          <span className="text-sm font-semibold">{account.username}</span>
          {trunkPrefix && (
            <span className="text-[10px] text-blue-400 bg-blue-400/10 px-1.5 py-0.5 rounded font-mono">
              Prefix: {trunkPrefix}xxxxx
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground p-0.5 rounded"
          data-testid="close-rate-detail"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {isLoading ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
          <div className="grid grid-cols-2 gap-2 w-full max-w-[280px]">
            {([
              { label: "Account",  sub: "Found",   done: true,         active: false },
              { label: "Product",  sub: "Loaded",  done: !infoLoading, active: infoLoading },
              { label: "Rates",    sub: "Loading", done: false,        active: !infoLoading },
              { label: "Analysis", sub: "Pending", done: false,        active: false },
            ] as const).map((s) => (
              <div key={s.label} className={cn(
                "flex items-center gap-2 px-2.5 py-2 rounded-lg border text-[11px] transition-all",
                s.done    ? "bg-green-500/8 border-green-500/20 text-green-400"
                : s.active ? "bg-blue-500/8 border-blue-500/20 text-blue-400"
                : "bg-muted/10 border-border/20 text-muted-foreground/40"
              )}>
                {s.done    ? <Check className="w-3 h-3 shrink-0" />
                 : s.active ? <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                 : <div className="w-3 h-3 shrink-0 rounded-full border border-current opacity-30" />}
                <div>
                  <div className="font-medium text-[10px] leading-tight">{s.label}</div>
                  <div className="text-[9px] opacity-60 leading-tight">{s.sub}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="text-[10px] text-muted-foreground/40">
            {infoLoading ? "Analyzing account…" : "Loading rate sheet…"}
          </div>
        </div>
      ) : !iTariff ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-xs text-center p-4">
          <div>
            <AlertTriangle className="w-6 h-6 mx-auto mb-2 text-amber-400" />
            No rates configured for this account.
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 border-b border-border/40 bg-muted/10 flex-shrink-0">
            <span className="text-[11px] text-muted-foreground">
              {selectedRateKeys.size > 0 ? `${selectedRateKeys.size} selected` : "Select rates to change"}
            </span>
            <button
              onClick={() => setChangeModalOpen(true)}
              disabled={selectedRateKeys.size === 0}
              className="text-xs bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 disabled:from-muted/30 disabled:to-muted/30 disabled:text-muted-foreground text-white rounded-lg px-4 py-1.5 font-medium shadow-sm transition-all"
              data-testid="btn-change-client-rates"
            >
              Change Client Rates
            </button>
          </div>
          <div className="flex-1 overflow-auto">
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 bg-background/95 backdrop-blur-sm border-b border-border/50 z-10">
              <tr>
                <th className="text-left py-2 px-3 border-b border-border w-8">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} data-testid="checkbox-select-all" />
                </th>
                {["#", "Client", "KAM", "Module", "Product", "Dests", "Status", "Created", ""].map(h => (
                  <th key={h} className="text-left py-2 px-3 font-medium text-muted-foreground border-b border-border whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rates.map((r, i) => (
                <tr
                  key={r.iRate ?? i}
                  className={cn(
                    "border-b border-border/20 hover:bg-blue-500/5 transition-colors group",
                    r.forbidden ? "opacity-60" : "",
                  )}
                >
                  <td className="py-1.5 px-3">
                    <input
                      type="checkbox"
                      checked={selectedRateKeys.has(rateKey(r, i))}
                      onChange={() => toggleOne(rateKey(r, i))}
                      data-testid={`checkbox-rate-${i}`}
                    />
                  </td>
                  <td className="py-1.5 px-3 font-mono text-[11px]">{r.rawPrefix || "—"}</td>
                  <td className="py-1.5 px-3">{r.destName}</td>
                  <td className="py-1.5 px-3 font-mono text-[11px] text-blue-400/80">{r.rawPrefix || displayPrefix(r.prefix)}</td>
                  <td className="py-1.5 px-3 text-right font-mono tabular-nums">
                    {r.price1 != null ? Number(r.price1).toFixed(5) : "—"}
                  </td>
                  <td className="py-1.5 px-3 text-muted-foreground whitespace-nowrap">
                    {r.activationDate ? (() => { const d = new Date(String(r.activationDate).replace(/^(\d{4})(\d{2})(\d{2})T/, '$1-$2-$3T')); return isNaN(d.getTime()) ? String(r.activationDate).slice(0,10) : d.toLocaleDateString(); })() : "—"}
                  </td>
                  <td className="py-1.5 px-3 text-muted-foreground whitespace-nowrap">
                    {r.expirationDate ? (() => { const d = new Date(String(r.expirationDate).replace(/^(\d{4})(\d{2})(\d{2})T/, '$1-$2-$3T')); return isNaN(d.getTime()) ? String(r.expirationDate).slice(0,10) : d.toLocaleDateString(); })() : "None"}
                  </td>
                  <td className="py-1.5 px-3">
                    {r.forbidden ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium bg-red-500/10 text-red-400 border border-red-500/20 rounded-full px-2 py-0.5">● Blocked</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium bg-green-500/10 text-green-400 border border-green-500/20 rounded-full px-2 py-0.5">● Active</span>
                    )}
                  </td>
                </tr>
              ))}
              {rates.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-10 text-muted-foreground">
                    No rates found with prefix <span className="font-mono text-blue-400">"{trunkPrefix}*"</span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="px-4 py-2 text-[10px] text-muted-foreground border-t border-border/30">
            {rates.length} rate{rates.length !== 1 ? "s" : ""} shown
            {trunkPrefix ? ` matching prefix "${trunkPrefix}*"` : ""}
          </div>
          </div>
        </div>
      )}
      {changeModalOpen && (
        <ChangeClientRateModal
          account={account}
          iTariff={iTariff ?? null}
          selectedRates={selectedRates}
          onClose={() => setChangeModalOpen(false)}
          onSuccess={() => {
            setChangeModalOpen(false);
            setSelectedRateKeys(new Set());
          }}
        />
      )}
    </div>
  );
}


// ── Change Client Rate Modal ────────────────────────────────────────────────────
function ChangeClientRateModal({
  account,
  iTariff,
  selectedRates,
  onClose,
  onSuccess,
}: {
  account: SippyAccount;
  iTariff: number | null;
  selectedRates: (RateEntry & { rawPrefix?: string; destName?: string })[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [rate, setRate] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [effectiveTill, setEffectiveTill] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<{ prefix: string; success: boolean; message: string; method?: string; detail?: string }[] | null>(null);

  // Proactive probe: check if the portal rates page is accessible before the user submits.
  // This catches the common case where the Sippy account lacks "Edit Tariff Rates" permission.
  const { data: probe } = useQuery<{ ok: boolean; ratesPageOk: boolean; error?: string }>({
    queryKey: ['/api/sippy/rates/portal-probe', iTariff],
    queryFn: () => fetch(`/api/sippy/rates/portal-probe?tariffId=${iTariff}`).then(r => r.json()),
    enabled: !!iTariff,
    staleTime: 2 * 60 * 1000,
    retry: false,
  });
  const permissionBlocked = probe && probe.ok === false && !probe.ratesPageOk;

  const handleSubmit = async () => {
    const rateNum = Number(rate);
    if (!rate || isNaN(rateNum)) {
      toast({ title: "Enter a valid rate", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    setResults(null);
    try {
      // Always send the full Sippy prefix (r.prefix = e.g. "192"), NOT rawPrefix ("92").
      // rawPrefix strips the trunk prefix for display only — Sippy rate keys use the full prefix.
      const prefixes = selectedRates.map(r => String(r.prefix));
      const res = await apiRequest("POST", "/api/rate-manager/change-client-rates", {
        accountName: account.username,
        iTariff: iTariff ?? undefined,
        prefixes,
        rate: rateNum,
        effectiveFrom: effectiveFrom || undefined,
        effectiveTill: effectiveTill || undefined,
      });
      const data = await res.json();
      setResults(data.results ?? []);
      if (data.ok === prefixes.length) {
        toast({ title: `Updated ${data.ok} rate(s) successfully` });
        queryClient.invalidateQueries({ queryKey: [`/api/sippy/tariffs/${iTariff}/rates?limit=500`] });
        setTimeout(() => onSuccess(), 1200);
      } else {
        toast({ title: `${data.ok}/${prefixes.length} rate(s) updated`, description: "Some pushes failed — see details below.", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Failed to change rates", description: e.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-background border border-border rounded-lg shadow-xl w-full max-w-lg max-h-[85vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-sm font-semibold">Change Client Rates — {account.username}</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          {permissionBlocked && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/[0.08] px-3 py-2.5 text-xs text-amber-300">
              <ShieldAlert className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-400" />
              <div className="space-y-1">
                <p className="font-semibold text-amber-200">Rate push will fail — Sippy permission required</p>
                <p>The connected Sippy account (<strong>ssp-root</strong>) is a reseller and lacks the <strong>Edit Tariff Rates</strong> permission. To enable rate pushing, do one of:</p>
                <ol className="list-decimal list-inside space-y-0.5 text-amber-300/80">
                  <li>In the Sippy Admin Panel, grant <strong>ssp-root</strong> the <em>Edit Tariff Rates</em> permission.</li>
                  <li>Go to <strong>Settings → Sippy → Rate Admin Credentials</strong> and enter a separate Sippy system admin account.</li>
                </ol>
              </div>
            </div>
          )}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Selected destinations ({selectedRates.length})</label>
            <div className="max-h-32 overflow-auto border border-border/50 rounded text-xs divide-y divide-border/30">
              {selectedRates.map((r, i) => (
                <div key={i} className="px-2 py-1 flex justify-between">
                  <span className="font-mono">{String(r.rawPrefix ?? r.prefix)}</span>
                  <span className="text-muted-foreground">{r.destName ?? ""}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">New Rate (USD / min)</label>
            <input
              type="number"
              step="0.0001"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              placeholder="0.0100"
              className="w-full bg-muted/30 border border-border rounded px-2 py-1.5 text-sm"
              data-testid="input-change-rate"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Active From</label>
              <input
                type="text"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
                placeholder="YYYY-MM-DD HH:mm"
                className="w-full bg-muted/30 border border-border rounded px-2 py-1.5 text-sm font-mono"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Active Till</label>
              <input
                type="text"
                value={effectiveTill}
                onChange={(e) => setEffectiveTill(e.target.value)}
                placeholder="YYYY-MM-DD HH:mm"
                className="w-full bg-muted/30 border border-border rounded px-2 py-1.5 text-sm font-mono"
              />
            </div>
          </div>
          {results && (
            <div className="border border-border/50 rounded text-xs divide-y divide-border/30 max-h-40 overflow-auto">
              {results.map((r, i) => (
                <div key={i} className="px-2 py-1">
                  <div className="flex items-center justify-between">
                    <span className="font-mono">{displayPrefix(r.prefix)}</span>
                    <span className="flex items-center gap-1">
                      {r.success ? <Check className="w-3 h-3 text-emerald-400" /> : <X className="w-3 h-3 text-red-400" />}
                      <span className={cn("text-[10px]", r.success ? "text-emerald-400" : "text-red-400")}>
                        {r.success ? (r.method ?? r.message) : (r.message ?? r.method ?? "push failed")}
                      </span>
                    </span>
                  </div>
                  {!r.success && r.method && (
                    <div className="text-[10px] text-muted-foreground mt-0.5">via {r.method}{r.detail ? ` · ${r.detail}` : ""}</div>
                  )}
                  {!r.success && !r.method && r.detail && (
                    <div className="text-[10px] text-muted-foreground mt-0.5">{r.detail}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
          <button onClick={onClose} className="text-xs px-3 py-1.5 rounded border border-border hover:bg-muted/30">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !rate}
            className="text-xs bg-blue-600 hover:bg-blue-700 disabled:bg-muted/30 disabled:text-muted-foreground text-white rounded px-3 py-1.5 font-medium flex items-center gap-1.5"
            data-testid="btn-submit-change-rate"
          >
            {submitting && <Loader2 className="w-3 h-3 animate-spin" />}
            Submit
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Rate Analysis Tab ──────────────────────────────────────────────────────────
function AnalysisTab({
  products,
  accounts,
  allDests,
  onProductChange,
}: {
  products: Product[];
  accounts: SippyAccount[];
  allDests: DestNode[];
  onProductChange?: (productId: string) => void;
}) {
  const [mode, setMode] = useState<"client" | "vendor">("client");
  const [selectedProduct, setSelectedProduct] = useState<string>("");
  const [selectedCarriers, setSelectedCarriers] = useState<string[]>([]);
  const [format, setFormat] = useState("Default");
  const [selectedCountries, setSelectedCountries] = useState<string[]>([]);
  const [selectedOperators, setSelectedOperators] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedDetails, setSelectedDetails] = useState<string[]>([]);
  const [destInput, setDestInput] = useState("");
  const [groupBy, setGroupBy] = useState("Country");
  const [blockMode, setBlockMode] = useState("All");
  const [specialMode, setSpecialMode] = useState("All");
  const [period, setPeriod] = useState("Active");
  const [applied, setApplied] = useState(false);
  const [detailAccount, setDetailAccount] = useState<SippyAccount | null>(null);

  const product = products.find(p => String(p.id) === selectedProduct);
  const trunkPrefix = product?.trunkPrefix ?? "";

  // Destination hierarchy
  const countries = useMemo(() => allDests.filter(d => d.level === 1), [allDests]);
  const operators = useMemo(
    () => allDests.filter(d => d.level === 2 && selectedCountries.includes(String(d.parentId))),
    [allDests, selectedCountries],
  );
  const categories = useMemo(
    () => allDests.filter(d => d.level === 3 && selectedOperators.includes(String(d.parentId))),
    [allDests, selectedOperators],
  );
  const details = useMemo(
    () => allDests.filter(d => d.level === 4 && selectedCategories.includes(String(d.parentId))),
    [allDests, selectedCategories],
  );

  // Applied carriers
  const appliedCarriers = useMemo(
    () => accounts.filter(a => selectedCarriers.includes(String(a.iAccount))),
    [accounts, selectedCarriers],
  );

  const countryNames = useMemo(
    () => countries.filter(c => selectedCountries.includes(String(c.id))).map(c => c.name).join(", "),
    [countries, selectedCountries],
  );

  const handleApply = () => {
    setApplied(true);
    setDetailAccount(null);
  };
  const handleReset = () => {
    setSelectedProduct(""); setSelectedCarriers([]); setSelectedCountries([]);
    setSelectedOperators([]); setSelectedCategories([]); setSelectedDetails([]);
    setDestInput(""); setApplied(false); setDetailAccount(null);
    setFormat("Default"); setBlockMode("All"); setSpecialMode("All");
  };

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Left Sidebar */}
      <div className="w-64 flex-shrink-0 border-r border-border/60 overflow-y-auto bg-muted/5 p-3 space-y-3">
        <div className="flex rounded overflow-hidden border border-border/60">
          {(["Client", "Vendor"] as const).map(m => (
            <button
              key={m}
              onClick={() => setMode(m.toLowerCase() as "client" | "vendor")}
              className={cn(
                "flex-1 py-1.5 text-xs font-semibold transition-colors",
                mode === m.toLowerCase()
                  ? "bg-green-600 text-white"
                  : "bg-background text-muted-foreground hover:bg-muted/40",
              )}
              data-testid={`mode-${m.toLowerCase()}`}
            >
              {m}
            </button>
          ))}
        </div>

        <SidebarSection title="Product">
          <div className="grid grid-cols-2 gap-1.5 mt-0.5">
            {products.map(p => (
              <button
                key={p.id}
                type="button"
                onClick={() => { setSelectedProduct(String(p.id)); setApplied(false); setDetailAccount(null); onProductChange?.(String(p.id)); }}
                className={cn(
                  "relative text-left px-2.5 py-2 rounded-lg border transition-all",
                  selectedProduct === String(p.id)
                    ? "bg-blue-500/10 border-blue-500/50 text-blue-400 shadow-sm"
                    : "bg-background border-border/40 text-muted-foreground hover:border-blue-400/40 hover:text-foreground"
                )}
              >
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color || "#6366f1" }} />
                  <span className="text-[10px] font-medium leading-tight truncate">{p.name}</span>
                </div>
                {p.segment && <div className="text-[9px] text-muted-foreground/60 pl-3.5 truncate">{p.segment}</div>}
                {selectedProduct === String(p.id) && (
                  <span className="absolute top-1 right-1 text-blue-400 text-[8px]">✓</span>
                )}
              </button>
            ))}
          </div>
        </SidebarSection>

        <SidebarSection title="Carrier">
          <MultiSelect
            options={accounts.map(a => ({ value: String(a.iAccount), label: a.username || `Account ${a.iAccount}` }))}
            value={selectedCarriers}
            onChange={setSelectedCarriers}
            placeholder="All carriers"
          />
        </SidebarSection>

        <SidebarSection title="Format">
          <ToggleButtons options={["Default", "Partial", "Full"]} value={format} onChange={setFormat} />
        </SidebarSection>

        <SidebarSection title="Destination Selection">
          <div className="space-y-1">
            <div className="text-[10px] text-muted-foreground px-1">Country</div>
            <MultiSelect
              options={countries.map(d => ({ value: String(d.id), label: d.name }))}
              value={selectedCountries}
              onChange={v => { setSelectedCountries(v); setSelectedOperators([]); setSelectedCategories([]); setSelectedDetails([]); }}
            />
          </div>
          {selectedCountries.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] text-muted-foreground px-1">Operator Type</div>
              <MultiSelect
                options={operators.map(d => ({ value: String(d.id), label: d.name }))}
                value={selectedOperators}
                onChange={v => { setSelectedOperators(v); setSelectedCategories([]); setSelectedDetails([]); }}
              />
            </div>
          )}
          {selectedOperators.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] text-muted-foreground px-1">Category</div>
              <MultiSelect
                options={categories.map(d => ({ value: String(d.id), label: d.name }))}
                value={selectedCategories}
                onChange={v => { setSelectedCategories(v); setSelectedDetails([]); }}
              />
            </div>
          )}
          {selectedCategories.length > 0 && details.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] text-muted-foreground px-1">Detail</div>
              <MultiSelect
                options={details.map(d => ({ value: String(d.id), label: d.name }))}
                value={selectedDetails}
                onChange={setSelectedDetails}
              />
            </div>
          )}
          <div className="space-y-1">
            <div className="text-[10px] text-muted-foreground px-1">Group By</div>
            <select
              value={groupBy}
              onChange={e => setGroupBy(e.target.value)}
              className="w-full text-xs border border-border/60 rounded px-2 py-1 bg-background"
            >
              {["Country", "Operator", "Category"].map(o => <option key={o}>{o}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <div className="text-[10px] text-muted-foreground px-1">Destination</div>
            <input
              value={destInput}
              onChange={e => setDestInput(e.target.value)}
              placeholder="Filter by destination…"
              className="w-full text-xs border border-border/60 rounded px-2 py-1 bg-background placeholder:text-muted-foreground/50"
            />
          </div>
        </SidebarSection>

        <SidebarSection title="Block Destinations">
          <ToggleButtons options={["All", "Block", "Unblock"]} value={blockMode} onChange={setBlockMode} />
        </SidebarSection>

        <SidebarSection title="Special Destinations">
          <ToggleButtons options={["All", "Lock", "Unlock"]} value={specialMode} onChange={setSpecialMode} />
        </SidebarSection>

        <SidebarSection title="Rates Period">
          <select
            value={period}
            onChange={e => setPeriod(e.target.value)}
            className="w-full text-xs border border-border/60 rounded px-2 py-1 bg-background"
          >
            {["Active", "Inactive", "Dormant", "All"].map(o => <option key={o}>{o}</option>)}
          </select>
        </SidebarSection>

        <div className="flex gap-2 pt-1">
          <button
            onClick={handleReset}
            className="flex-1 py-1.5 text-xs border border-border/50 rounded-lg hover:bg-red-500/5 hover:border-red-500/30 hover:text-red-400 text-muted-foreground transition-all"
            data-testid="btn-reset-analysis"
          >
            Reset
          </button>
          <button
            onClick={handleApply}
            disabled={!selectedProduct || selectedCarriers.length === 0}
            className="flex-1 py-1.5 text-xs bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-30 text-white rounded-lg font-semibold shadow-sm transition-all"
            data-testid="btn-apply-analysis"
          >
            Apply
          </button>
        </div>
      </div>

      {/* Right Panel */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {detailAccount ? (
          <RateDetailPanel
            account={detailAccount}
            trunkPrefix={trunkPrefix}
            allDests={allDests}
            selectedCountries={selectedCountries}
            selectedOperators={selectedOperators}
            selectedCategories={selectedCategories}
            selectedDetails={selectedDetails}
            onClose={() => setDetailAccount(null)}
          />
        ) : (
          <>
            {/* Summary table header */}
            {applied && appliedCarriers.length > 0 && (
              <div className="flex items-center justify-between px-4 py-2 border-b border-border/50 bg-muted/10 flex-shrink-0">
                <div className="text-xs text-muted-foreground">
                  {appliedCarriers.length} carrier{appliedCarriers.length !== 1 ? "s" : ""}
                  {countryNames ? ` · ${countryNames}` : ""}
                  {product ? ` · ${product.name}` : ""}
                </div>
                <span className="text-[10px] text-muted-foreground italic">Click "View Details" on a carrier to change rates</span>
              </div>
            )}

            <div className="flex-1 overflow-auto">
              {!applied ? (
                <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground gap-3 p-8">
                  <BarChart2 className="w-10 h-10 opacity-20" />
                  <div>
                    <p className="text-sm font-medium">No analysis applied</p>
                    <p className="text-xs mt-1 max-w-xs">
                      Select a product and at least one carrier in the left panel, then click Apply.
                    </p>
                  </div>
                </div>
              ) : (
                <table className="w-full text-xs border-collapse">
                  <thead className="sticky top-0 bg-background/95 backdrop-blur-sm border-b border-border/50 z-10">
                    <tr>
                      {["Carrier Name", "Country", "Total Dest.", "Block Dest.", "Total Codes", "Actions"].map(h => (
                        <th key={h} className="text-left py-2 px-4 font-medium text-muted-foreground border-b border-border whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {appliedCarriers.map(acct => (
                      <tr
                        key={acct.iAccount}
                        className="border-b border-border/20 hover:bg-blue-500/5 transition-colors group"
                        data-testid={`carrier-row-${acct.iAccount}`}
                      >
                        <td className="py-2.5 px-4 font-medium">{acct.username}</td>
                        <td className="py-2.5 px-4 text-muted-foreground">
                          {countryNames || "All countries"}
                        </td>
                        <td className="py-2.5 px-4 text-muted-foreground">—</td>
                        <td className="py-2.5 px-4 text-muted-foreground">—</td>
                        <td className="py-2.5 px-4 text-muted-foreground">—</td>
                        <td className="py-2.5 px-4">
                          <button
                            onClick={() => setDetailAccount(acct)}
                            className="flex items-center gap-1 text-primary hover:underline text-xs"
                            data-testid={`btn-view-details-${acct.iAccount}`}
                          >
                            <Eye className="w-3 h-3" /> View Details
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Send Rate Tab ──────────────────────────────────────────────────────────────
type QueuedDest = {
  qid: string;
  destLabel: string;
  dialPrefix: string;  // normalized (no leading +)
  fullPrefix: string;  // trunkPrefix + dialPrefix
  rate: string;
};

function SendRateTab({
  products,
  accounts,
  allDests,
  onProductChange,
}: {
  products: Product[];
  accounts: SippyAccount[];
  allDests: DestNode[];
  onProductChange?: (productId: string) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [status, setStatus] = useState("Active");
  const [selectedProduct, setSelectedProduct] = useState<string>("");
  const [selectedClients, setSelectedClients] = useState<string[]>([]);
  const [format, setFormat] = useState("Default");
  const [rateType, setRateType] = useState("Current");

  // Destination picker state
  const [notifCountry, setNotifCountry] = useState<string>("");
  const [notifOperator, setNotifOperator] = useState<string>("");
  const [notifCategory, setNotifCategory] = useState<string>("");
  const [notifDetail, setNotifDetail] = useState<string>("");
  const [price, setPrice] = useState<string>("");
  const [effectiveDate, setEffectiveDate] = useState<string>(() => {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });

  // Multi-destination queue
  const [destQueue, setDestQueue] = useState<QueuedDest[]>([]);
  const [pushResults, setPushResults] = useState<{ accountName: string; prefix: string; rate: number; success: boolean; message: string }[] | null>(null);
  const [pushing, setPushing] = useState(false);

  const product = products.find(p => String(p.id) === selectedProduct);
  const trunkPrefix = product?.trunkPrefix ?? "";
  const stripPlus = (s: string) => s.replace(/^\+/, '');

  const countries = useMemo(() => allDests.filter(d => d.level === 1), [allDests]);
  const operators = useMemo(
    () => notifCountry ? allDests.filter(d => d.level === 2 && String(d.parentId) === notifCountry) : [],
    [allDests, notifCountry],
  );
  const categories = useMemo(
    () => notifOperator ? allDests.filter(d => d.level === 3 && String(d.parentId) === notifOperator) : [],
    [allDests, notifOperator],
  );
  const details = useMemo(
    () => notifCategory ? allDests.filter(d => d.level === 4 && String(d.parentId) === notifCategory) : [],
    [allDests, notifCategory],
  );

  // Resolve the most specific dialPrefix — normalize "+" away
  const resolvedDialPrefix = useMemo(() => {
    const detailNode = allDests.find(d => String(d.id) === notifDetail);
    if (detailNode?.dialPrefix) return stripPlus(detailNode.dialPrefix);
    const catNode = allDests.find(d => String(d.id) === notifCategory);
    if (catNode?.dialPrefix) return stripPlus(catNode.dialPrefix);
    const opNode = allDests.find(d => String(d.id) === notifOperator);
    if (opNode?.dialPrefix) return stripPlus(opNode.dialPrefix);
    const cNode = allDests.find(d => String(d.id) === notifCountry);
    if (cNode?.dialPrefix) return stripPlus(cNode.dialPrefix);
    return "";
  }, [allDests, notifCountry, notifOperator, notifCategory, notifDetail]);

  const previewFullPrefix = trunkPrefix + resolvedDialPrefix;

  const selectedClientAccounts = useMemo(
    () => accounts.filter(a => selectedClients.includes(String(a.iAccount))),
    [accounts, selectedClients],
  );

  const canAddToQueue = !!(resolvedDialPrefix && price && parseFloat(price) > 0);
  const canSubmit = !!(selectedProduct && selectedClients.length > 0 && destQueue.length > 0 && !pushing);

  const handleAddToQueue = () => {
    if (!canAddToQueue) return;
    const computedFull = trunkPrefix + resolvedDialPrefix;
    if (destQueue.some(q => q.fullPrefix === computedFull)) {
      toast({ title: "Duplicate prefix", description: `${computedFull} is already in the queue`, variant: "destructive" });
      return;
    }
    const countryName  = allDests.find(d => String(d.id) === notifCountry)?.name  ?? "";
    const operatorName = allDests.find(d => String(d.id) === notifOperator)?.name ?? "";
    const categoryName = allDests.find(d => String(d.id) === notifCategory)?.name ?? "";
    const detailName   = allDests.find(d => String(d.id) === notifDetail)?.name   ?? "";
    const destLabel = [countryName, operatorName, categoryName, detailName].filter(Boolean).join(" \u203a ");
    setDestQueue(prev => [...prev, {
      qid: `${Date.now()}-${Math.random()}`,
      destLabel,
      dialPrefix: resolvedDialPrefix,
      fullPrefix: computedFull,
      rate: price,
    }]);
    setNotifCountry(""); setNotifOperator(""); setNotifCategory(""); setNotifDetail(""); setPrice("");
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setPushing(true);
    setPushResults(null);
    try {
      const fmtToSippy: Record<string, string> = { "Default": "default", "Changes Only": "partial", "Full Sheet": "full" };
      const body = {
        accountNames: selectedClientAccounts.map(a => a.username),
        accounts: selectedClientAccounts.map(a => ({ username: a.username, iAccount: a.iAccount })),
        trunkPrefix,
        destinations: destQueue.map(q => ({ dialPrefix: q.dialPrefix, rate: parseFloat(q.rate), destinationName: q.destLabel })),
        effectiveFrom: effectiveDate || undefined,
        format: fmtToSippy[format] ?? format.toLowerCase(),
        notificationType: format,
        productName: product ? (product.segment ? `${product.name} - ${product.segment}` : product.name) : undefined,
        productId: product?.id,
        rateType: rateType.toLowerCase(),
      };
      const res = await apiRequest("POST", "/api/rate-manager/push-batch", body);
      const data = await res.json();
      setPushResults(data.results ?? []);
      qc.invalidateQueries({ queryKey: ["/api/rate-manager/jobs"] });
      toast({
        title: `Rate Push — ${data.ok}/${data.total} succeeded`,
        description: `${destQueue.length} destination${destQueue.length > 1 ? "s" : ""} × ${selectedClients.length} client${selectedClients.length > 1 ? "s" : ""}`,
        variant: data.ok === data.total ? "default" : "destructive",
      });
    } catch (e: any) {
      toast({ title: "Push failed", description: e.message, variant: "destructive" });
    } finally {
      setPushing(false);
    }
  };

  const handleReset = () => {
    setSelectedProduct(""); setSelectedClients([]); setFormat("Default"); setRateType("Current");
    setNotifCountry(""); setNotifOperator(""); setNotifCategory(""); setNotifDetail("");
    setPrice(""); setDestQueue([]); setPushResults(null);
    onProductChange?.("");
  };

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Left Sidebar */}
      <div className="w-64 flex-shrink-0 border-r border-border/60 overflow-y-auto bg-muted/5 p-3 space-y-3">
        <SidebarSection title="Status">
          <div className="space-y-1">
            <ToggleButtons options={["Active", "Inactive", "Dormant"]} value={status} onChange={setStatus} />
          </div>
        </SidebarSection>

        <SidebarSection title="Product">
          <div className="grid grid-cols-2 gap-1.5 mt-0.5">
            {products.map(p => (
              <button
                key={p.id}
                type="button"
                onClick={() => { setSelectedProduct(String(p.id)); setSelectedClients([]); onProductChange?.(String(p.id)); }}
                className={cn(
                  "relative text-left px-2.5 py-2 rounded-lg border transition-all",
                  selectedProduct === String(p.id)
                    ? "bg-green-500/10 border-green-500/50 text-green-400 shadow-sm"
                    : "bg-background border-border/40 text-muted-foreground hover:border-green-400/40 hover:text-foreground"
                )}
              >
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color || "#6366f1" }} />
                  <span className="text-[10px] font-medium leading-tight truncate">{p.name}</span>
                </div>
                {p.segment && <div className="text-[9px] text-muted-foreground/60 pl-3.5 truncate">{p.segment}</div>}
                {selectedProduct === String(p.id) && (
                  <span className="absolute top-1 right-1 text-green-400 text-[8px]">✓</span>
                )}
              </button>
            ))}
          </div>
        </SidebarSection>

        <SidebarSection title="Clients">
          <MultiSelect
            options={accounts.map(a => ({ value: String(a.iAccount), label: a.username || `Account ${a.iAccount}` }))}
            value={selectedClients}
            onChange={setSelectedClients}
            placeholder="Select clients"
          />
        </SidebarSection>

        <SidebarSection title="Notification Type">
          <ToggleButtons options={["Default", "Changes Only", "Full Sheet"]} value={format} onChange={setFormat} />
        </SidebarSection>

        <SidebarSection title="Rate Type">
          <ToggleButtons options={["Current", "Re-Rate"]} value={rateType} onChange={setRateType} />
        </SidebarSection>

        <div className="flex gap-2 pt-1">
          <button
            onClick={handleReset}
            className="flex-1 py-1.5 text-xs border border-border/50 rounded-lg hover:bg-red-500/5 hover:border-red-500/30 hover:text-red-400 text-muted-foreground transition-all"
            data-testid="btn-reset-send"
          >
            Reset
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="flex-1 py-1.5 text-xs bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 disabled:opacity-30 text-white rounded-lg font-semibold flex items-center justify-center gap-1 shadow-sm transition-all"
            data-testid="btn-submit-send"
          >
            {pushing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
            {pushing ? "Pushing…" : "Submit"}
          </button>
        </div>

        {/* Readiness checklist */}
        <div className="text-[10px] space-y-0.5 px-1 pt-0.5">
          <div className={selectedProduct ? "text-green-400/70" : "text-amber-400/80"}>
            {selectedProduct ? "✓ Product selected" : "· Select a product"}
          </div>
          <div className={selectedClients.length > 0 ? "text-green-400/70" : "text-amber-400/80"}>
            {selectedClients.length > 0 ? `✓ ${selectedClients.length} client${selectedClients.length > 1 ? "s" : ""}` : "· Select clients"}
          </div>
          <div className={destQueue.length > 0 ? "text-green-400/70" : "text-amber-400/80"}>
            {destQueue.length > 0 ? `✓ ${destQueue.length} destination${destQueue.length > 1 ? "s" : ""} queued` : "· Add at least one destination →"}
          </div>
        </div>

        {/* Selected Clients List */}
        {selectedClientAccounts.length > 0 && (
          <SidebarSection title="Selected Clients">
            <div className="space-y-0.5 max-h-40 overflow-y-auto pr-1">
              {selectedClientAccounts.map((a, i) => (
                <div key={a.iAccount} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <span className="text-primary/60 w-4 shrink-0">{i + 1}.</span>
                  <span className="truncate">{a.username}</span>
                </div>
              ))}
            </div>
          </SidebarSection>
        )}
      </div>

      {/* Right Panel */}
      <div className="flex-1 min-w-0 flex flex-col overflow-auto p-5 gap-4">

        {/* ── Destination Queue ── */}
        <div>
          <div className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Send className="w-4 h-4 text-green-400" />
            Destination Queue
            {destQueue.length > 0 && (
              <span className="ml-1 px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 text-[10px] font-medium border border-green-500/20">
                {destQueue.length} destination{destQueue.length > 1 ? "s" : ""}
              </span>
            )}
          </div>

          {destQueue.length > 0 ? (
            <div className="border border-border/50 rounded-lg overflow-hidden mb-3">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/30 bg-muted/10">
                    <th className="text-left py-2 px-3 text-muted-foreground font-medium">Destination</th>
                    <th className="text-left py-2 px-3 text-muted-foreground font-medium w-28">Dial Code</th>
                    <th className="text-left py-2 px-3 text-muted-foreground font-medium w-28">Rate ($/min)</th>
                    <th className="py-2 px-3 w-8" />
                  </tr>
                </thead>
                <tbody>
                  {destQueue.map(q => (
                    <tr key={q.qid} className="border-b border-border/20 hover:bg-muted/5">
                      <td className="py-2 px-3 text-foreground/80">{q.destLabel}</td>
                      <td className="py-2 px-3 font-mono text-blue-400">{q.dialPrefix}</td>
                      <td className="py-2 px-3 font-mono text-green-400">{parseFloat(q.rate).toFixed(5)}</td>
                      <td className="py-2 px-3">
                        <button
                          onClick={() => setDestQueue(prev => prev.filter(x => x.qid !== q.qid))}
                          className="text-muted-foreground hover:text-red-400 transition-colors"
                          title="Remove"
                          data-testid={`btn-remove-dest-${q.qid}`}
                        >
                          <CircleX className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="border border-dashed border-border/40 rounded-lg p-4 mb-3 text-xs text-muted-foreground text-center">
              No destinations queued — use the picker below to add destinations
            </div>
          )}

          {/* Push All button row */}
          <div className="flex items-center justify-between">
            <div className="text-[10px] text-muted-foreground">
              {canSubmit
                ? `Will push ${destQueue.length} destination${destQueue.length > 1 ? "s" : ""} to ${selectedClients.length} client${selectedClients.length > 1 ? "s" : ""} (${destQueue.length * selectedClients.length} total ops)`
                : "Complete the checklist on the left, then add at least one destination"}
            </div>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="shrink-0 px-5 py-1.5 text-xs bg-green-600 hover:bg-green-700 disabled:bg-muted/30 disabled:text-muted-foreground text-white rounded font-semibold flex items-center gap-1.5"
              data-testid="btn-submit-notification"
            >
              {pushing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
              {pushing ? "Pushing…" : "Push All"}
            </button>
          </div>
        </div>

        {/* ── Add Destination Picker ── */}
        <div className="bg-muted/10 border border-border/50 rounded-lg p-4 space-y-3">
          <div className="text-xs font-semibold text-foreground/70 mb-1 flex items-center gap-2">
            Add Destination
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground font-medium">Country</label>
              <select
                value={notifCountry}
                onChange={e => { setNotifCountry(e.target.value); setNotifOperator(""); setNotifCategory(""); setNotifDetail(""); }}
                className="w-full text-xs border border-border/60 rounded px-2 py-1.5 bg-background"
                data-testid="notif-country"
              >
                <option value="">Choose a country</option>
                {countries.map(d => <option key={d.id} value={String(d.id)}>{d.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground font-medium">Network / Type</label>
              <select
                value={notifOperator}
                onChange={e => { setNotifOperator(e.target.value); setNotifCategory(""); setNotifDetail(""); }}
                disabled={!notifCountry || operators.length === 0}
                className="w-full text-xs border border-border/60 rounded px-2 py-1.5 bg-background disabled:opacity-50"
                data-testid="notif-operator"
              >
                <option value="">Select network</option>
                {operators.map(d => (
                  <option key={d.id} value={String(d.id)}>
                    {d.name}{d.dialPrefix ? ` (${stripPlus(d.dialPrefix)})` : ""}
                  </option>
                ))}
              </select>
            </div>
            {categories.length > 0 && (
              <div className="space-y-1">
                <label className="text-[10px] text-muted-foreground font-medium">Operator</label>
                <select
                  value={notifCategory}
                  onChange={e => { setNotifCategory(e.target.value); setNotifDetail(""); }}
                  className="w-full text-xs border border-border/60 rounded px-2 py-1.5 bg-background"
                  data-testid="notif-category"
                >
                  <option value="">Select operator</option>
                  {categories.map(d => (
                    <option key={d.id} value={String(d.id)}>
                      {d.name}{d.dialPrefix ? ` (${stripPlus(d.dialPrefix)})` : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {details.length > 0 && (
              <div className="space-y-1">
                <label className="text-[10px] text-muted-foreground font-medium">Detail</label>
                <select
                  value={notifDetail}
                  onChange={e => setNotifDetail(e.target.value)}
                  className="w-full text-xs border border-border/60 rounded px-2 py-1.5 bg-background"
                  data-testid="notif-detail"
                >
                  <option value="">Select detail</option>
                  {details.map(d => (
                    <option key={d.id} value={String(d.id)}>
                      {d.name}{d.dialPrefix ? ` (${stripPlus(d.dialPrefix)})` : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground font-medium">Price (USD/min)</label>
              <input
                type="number"
                step="0.00001"
                min="0"
                value={price}
                onChange={e => setPrice(e.target.value)}
                placeholder="e.g. 0.02700"
                className="w-full text-xs border border-border/60 rounded px-2 py-1.5 bg-background font-mono"
                data-testid="notif-price"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground font-medium">Effective Date / Time</label>
              <input
                type="text"
                value={effectiveDate}
                onChange={e => setEffectiveDate(e.target.value)}
                placeholder="YYYY-MM-DD HH:mm"
                className="w-full text-xs border border-border/60 rounded px-2 py-1.5 bg-background font-mono"
                data-testid="notif-date"
              />
            </div>
          </div>

          {/* Pre-Push Analysis */}
          {selectedClients.length > 0 && resolvedDialPrefix && (() => {
            const countryNode = allDests.find((d: DestNode) => String(d.id) === notifCountry);
            const opNode = allDests.find((d: DestNode) =>
              String(d.id) === (notifDetail || notifCategory || notifOperator)
            );
            const destLabel = [countryNode?.name, opNode?.name].filter(Boolean).join(' — ');
            const clientNames = selectedClients
              .map(id => accounts.find((a: any) => String(a.id) === id))
              .filter(Boolean)
              .map((a: any) => a.name || a.companyName || String(a.id));
            return (
              <div className="mt-2 mb-1 rounded-lg border border-blue-500/20 bg-blue-500/5 text-xs overflow-hidden">
                <div className="px-3 py-1.5 border-b border-blue-500/15 flex items-center gap-1.5 bg-blue-500/8">
                  <span className="text-blue-400 font-semibold text-[10px] uppercase tracking-wide">
                    ⚡ Pre-Push Analysis
                  </span>
                  <span className="text-muted-foreground text-[10px]">
                    — {selectedClients.length} client{selectedClients.length !== 1 ? "s" : ""} selected
                  </span>
                </div>
                <div className="px-3 py-2 flex flex-col gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-blue-400 font-semibold">{resolvedDialPrefix}</span>
                    {destLabel && <span className="text-foreground/70">{destLabel}</span>}
                    {price && (
                      <span className="ml-auto font-semibold text-green-400">${price}/min</span>
                    )}
                  </div>
                  <div className="flex items-start gap-1.5">
                    <span className="text-green-400 mt-0.5 shrink-0">➕</span>
                    <div>
                      <span className="font-medium text-foreground/80">
                        Will be added ({clientNames.length})
                      </span>
                      <div className="text-muted-foreground mt-0.5 leading-relaxed">
                        {clientNames.join(", ")}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Prefix preview + Add button */}
          <div className="flex items-center justify-between gap-3 pt-1">
            {resolvedDialPrefix ? (
              <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                <span>Prefix:</span>
                <span className="font-mono text-blue-400 font-semibold">{resolvedDialPrefix}</span>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground/50 italic">
                Select country → network to resolve Sippy prefix
              </div>
            )}
            <button
              onClick={handleAddToQueue}
              disabled={!canAddToQueue}
              className="shrink-0 px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 disabled:bg-muted/30 disabled:text-muted-foreground text-white rounded font-semibold flex items-center gap-1.5"
              data-testid="btn-add-to-queue"
            >
              <CircleCheck className="w-3 h-3" />
              Add to Queue
            </button>
          </div>
        </div>

        {/* Push Results */}
        {pushResults && (
          <div className="border border-border/50 rounded-lg overflow-hidden">
            <div className="px-4 py-2 bg-muted/20 border-b border-border/50 text-xs font-medium flex items-center gap-2">
              <CircleCheck className="w-3.5 h-3.5 text-green-400" />
              Push Results
              <span className="ml-auto text-muted-foreground">
                {pushResults.filter(r => r.success).length}/{pushResults.length} succeeded
              </span>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/30 bg-muted/10">
                  <th className="text-left py-2 px-3 text-muted-foreground font-medium">Client</th>
                  <th className="text-left py-2 px-3 text-muted-foreground font-medium">Prefix</th>
                  <th className="text-left py-2 px-3 text-muted-foreground font-medium">Rate</th>
                  <th className="text-left py-2 px-3 text-muted-foreground font-medium">Status</th>
                  <th className="text-left py-2 px-3 text-muted-foreground font-medium">Message</th>
                </tr>
              </thead>
              <tbody>
                {pushResults.map((r, i) => (
                  <tr key={i} className="border-b border-border/20 hover:bg-muted/10">
                    <td className="py-2 px-3 font-medium">{r.accountName}</td>
                    <td className="py-2 px-3 font-mono text-blue-400">{displayPrefix(r.prefix)}</td>
                    <td className="py-2 px-3 font-mono">{Number(r.rate).toFixed(5)}</td>
                    <td className="py-2 px-3">
                      {r.success
                        ? <span className="flex items-center gap-1 text-green-400"><CircleCheck className="w-3 h-3" /> OK</span>
                        : <span className="flex items-center gap-1 text-red-400"><CircleX className="w-3 h-3" /> Fail</span>}
                    </td>
                    <td className="py-2 px-3 text-muted-foreground truncate max-w-xs">{r.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
// ── Jobs Tab ───────────────────────────────────────────────────────────────────
function PushJobDrawer({ job, onClose, statusBg }: { job: any; onClose: () => void; statusBg: Record<string, string> }) {
  const [showTech, setShowTech] = useState(false);
  const methodLabel = job.pushMethod === 'upload_token' ? 'XLSX Upload'
    : job.pushMethod === 'portal_csv' ? 'Portal CSV'
    : job.pushMethod ?? '—';
  const clientDisplay = job.clientNames || (
    job.totalClients > 0 ? `${job.pushedClients ?? 0}/${job.totalClients} client${job.totalClients > 1 ? 's' : ''}` : '—'
  );
  const moduleLabel = job.notificationType ? 'Notifications' : 'Send Rate';
  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 w-[440px] bg-background border-l border-border z-50 flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
        {/* Drawer header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 flex-shrink-0">
          <span className="font-semibold text-sm flex items-center gap-2">
            <Clock className="w-4 h-4 text-muted-foreground" />
            Job Details
            <span className="font-mono text-[10px] text-muted-foreground/50 ml-1">#{job.jobId ?? job.id}</span>
          </span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Summary */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
            <div>
              <div className="text-[9px] text-muted-foreground uppercase tracking-wide mb-0.5">Client</div>
              <div className="font-medium truncate">{clientDisplay}</div>
              {(job.failedClients ?? 0) > 0 && <div className="text-red-400 text-[10px]">{job.failedClients} failed</div>}
            </div>
            <div>
              <div className="text-[9px] text-muted-foreground uppercase tracking-wide mb-0.5">KAM</div>
              <div>{job.createdBy ?? '—'}</div>
            </div>
            <div>
              <div className="text-[9px] text-muted-foreground uppercase tracking-wide mb-0.5">Product</div>
              <div>{job.productName ?? '—'}</div>
            </div>
            <div>
              <div className="text-[9px] text-muted-foreground uppercase tracking-wide mb-0.5">Module</div>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">{moduleLabel}</span>
            </div>
            <div>
              <div className="text-[9px] text-muted-foreground uppercase tracking-wide mb-0.5">Status</div>
              <span className={cn('text-[10px] font-medium capitalize border px-1.5 py-0.5 rounded', statusBg[job.status] ?? 'text-muted-foreground')}>{job.status}</span>
            </div>
            <div>
              <div className="text-[9px] text-muted-foreground uppercase tracking-wide mb-0.5">Created</div>
              <div className="text-muted-foreground text-[10px]">
                {job.createdAt ? new Date(job.createdAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
              </div>
            </div>
            <div>
              <div className="text-[9px] text-muted-foreground uppercase tracking-wide mb-0.5">Destinations</div>
              <div className="font-medium">{job.destinationCount ?? job.pushResults?.length ?? '—'}</div>
            </div>
            <div>
              <div className="text-[9px] text-muted-foreground uppercase tracking-wide mb-0.5">Effective</div>
              <div className="text-muted-foreground text-[10px]">
                {job.effectiveAt ? new Date(job.effectiveAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
              </div>
            </div>
          </div>

          {/* Download */}
          <div className="flex gap-2">
            <button
              onClick={async () => {
                const u = `/api/rate-manager/export?format=xlsx${job.productId ? `&productId=${job.productId}` : ''}`;
                const resp = await fetch(u, { credentials: 'include' });
                const blob = await resp.blob();
                const clientPart = (job.clientNames || '').split(',')[0].trim().replace(/\s+/g,'').toUpperCase() || 'CLIENT';
                const prodPart = (job.productName || 'Product').replace(/\s+/g,'');
                const dateLabel = new Date().toISOString().slice(0,10).replace(/-/g,'');
                const fname = `${clientPart}_${prodPart}_Rates.xlsx`;
                const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fname; a.click();
              }}
              className="flex items-center gap-1.5 text-xs bg-green-500/10 hover:bg-green-500/20 text-green-400 px-3 py-1.5 rounded border border-green-500/20 transition-colors"
            >
              <Download className="w-3 h-3" /> Download Rate Sheet
            </button>
            {(['failed','partial'].includes((job.status??'').toLowerCase())) ? (
              <button
                onClick={() => apiRequest('POST', `/api/rate-manager/jobs/${job.jobId??job.job_id??job.id}/retry`).then(() => onClose())}
                className="flex items-center gap-1.5 text-xs bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 px-3 py-1.5 rounded border border-blue-500/20 transition-colors"
              >
                Re-send
              </button>
            ) : null}
          </div>
          {/* Rate changes */}
          {job.pushResults && job.pushResults.length > 0 && (
            <div>
              <div className="text-[9px] text-muted-foreground uppercase tracking-wide mb-2">
                Rate Changes ({job.pushResults.length})
              </div>
              <div className="border border-border/30 rounded-lg overflow-hidden">
                <div className="max-h-60 overflow-y-auto">
                  {job.pushResults.map((r: any, i: number) => (
                    <div key={i} className={cn(
                      'flex items-center gap-2 text-[10px] px-3 py-1.5 border-b border-border/10 last:border-0',
                      r.success ? 'text-foreground' : 'text-red-400/80'
                    )}>
                      {r.success
                        ? <Check className="w-3 h-3 text-green-400 shrink-0" />
                        : <X className="w-3 h-3 text-red-400 shrink-0" />}
                      <span className="flex-1 truncate">{r.dest || displayPrefix(r.prefix) || '—'}</span>
                      {r.oldRate && r.newRate && (
                        <span className="text-muted-foreground/60 shrink-0 font-mono">
                          {Number(r.oldRate).toFixed(4)} → <span className={r.success ? 'text-green-400' : ''}>{Number(r.newRate).toFixed(4)}</span>
                        </span>
                      )}
                      {!r.success && r.message && (
                        <span className="text-red-400/60 text-[9px] shrink-0 max-w-[120px] truncate">{r.message}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Technical details — collapsed */}
          <div className="border border-border/20 rounded-lg overflow-hidden">
            <button
              className="w-full flex items-center justify-between px-3 py-2 text-[10px] text-muted-foreground hover:bg-muted/20 transition-colors"
              onClick={() => setShowTech(v => !v)}
            >
              <span className="uppercase tracking-wide font-medium">Technical Details</span>
              <span className={cn('transition-transform text-[10px]', showTech ? 'rotate-180' : '')}>▾</span>
            </button>
            {showTech && (
              <div className="px-3 pb-3 pt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-[10px] border-t border-border/20">
                <div>
                  <div className="text-[9px] text-muted-foreground uppercase mb-0.5">Job ID (internal)</div>
                  <div className="font-mono text-muted-foreground/60">{job.jobId ?? '—'}</div>
                </div>
                <div>
                  <div className="text-[9px] text-muted-foreground uppercase mb-0.5">Push Method</div>
                  <div className="text-blue-400">{methodLabel}</div>
                </div>
                <div>
                  <div className="text-[9px] text-muted-foreground uppercase mb-0.5">Full Prefix</div>
                  <div className="font-mono text-muted-foreground/60">{job.fullPrefix ?? '—'}</div>
                </div>
                <div>
                  <div className="text-[9px] text-muted-foreground uppercase mb-0.5">Verification</div>
                  <div className={job.verificationResult === 'confirmed' ? 'text-green-400' : job.verificationResult === 'mismatch' ? 'text-red-400' : 'text-muted-foreground'}>
                    {job.verificationResult ?? '—'}
                  </div>
                </div>
                <div>
                  <div className="text-[9px] text-muted-foreground uppercase mb-0.5">Switch</div>
                  <div className="font-mono text-muted-foreground/60 truncate">{job.switchName ?? '—'}</div>
                </div>
                <div>
                  <div className="text-[9px] text-muted-foreground uppercase mb-0.5">Format</div>
                  <div className="text-muted-foreground/60">{job.format ?? '—'}</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function JobsTab() {
  const { data: jobs = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/rate-manager/jobs"] });
  const [drawerJob, setDrawerJob] = useState<any>(null);
  const STATUS_BG: Record<string, string> = {
    completed:  "bg-green-400/10 text-green-400 border-green-400/30",
    partial:    "bg-amber-400/10 text-amber-400 border-amber-400/30",
    failed:     "bg-red-400/10 text-red-400 border-red-400/30",
    pending:    "bg-muted/30 text-muted-foreground border-border",
    processing: "bg-blue-400/10 text-blue-400 border-blue-400/30",
  };
  return (
    <div className="flex-1 overflow-auto p-4 relative">
      <div className="text-sm font-semibold mb-1 flex items-center gap-2">
        <Clock className="w-4 h-4 text-muted-foreground" />
        Rate Push History
      </div>
      <p className="text-[10px] text-muted-foreground/60 mb-3">Click View to see job details</p>
      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-8 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : !jobs?.length ? (
        <div className="text-center text-xs text-muted-foreground py-12">No rate push jobs yet</div>
      ) : (
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-border/60 bg-muted/30 backdrop-blur sticky top-0">
              {["#", "Client", "KAM", "Module", "Product", "Dests", "Status", "Created", ""].map(h => (
                <th key={h} className="text-left py-2 px-3 font-medium text-muted-foreground whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {jobs.map((j: any) => {
              const clientDisplay = j.clientNames || (
                j.totalClients > 0 ? `${j.pushedClients ?? 0}/${j.totalClients} client${j.totalClients > 1 ? 's' : ''}` : '—'
              );
              const moduleLabel = j.notificationType ? 'Notifications' : 'Send Rate';
              const destCount = j.destinationCount ?? j.pushResults?.length ?? null;
              return (
                <tr
                  key={j.id}
                  className="border-b border-border/20 hover:bg-muted/10 cursor-pointer"
                  onClick={() => setDrawerJob(j)}
                  data-testid={`row-job-${j.id}`}
                >
                  <td className="py-2 px-3 font-mono text-[10px] text-muted-foreground/50 whitespace-nowrap">{j.jobId ?? j.id}</td>
                  <td className="py-2 px-3 max-w-[160px]">
                    <div className="truncate font-medium text-foreground" title={clientDisplay}>{clientDisplay}</div>
                    {(j.failedClients ?? 0) > 0 && (
                      <div className="text-red-400 text-[10px]">{j.failedClients} failed</div>
                    )}
                  </td>
                  <td className="py-2 px-3 text-muted-foreground whitespace-nowrap text-[10px]">{j.createdBy ?? '—'}</td>
                  <td className="py-2 px-3 whitespace-nowrap">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">{moduleLabel}</span>
                  </td>
                  <td className="py-2 px-3 whitespace-nowrap text-[11px]">{j.productName ?? '—'}</td>
                  <td className="py-2 px-3 text-center whitespace-nowrap">
                    <span className="font-mono tabular-nums text-[11px]">{destCount !== null ? destCount : '—'}</span>
                  </td>
                  <td className="py-2 px-3">
                    <span className={cn('text-[10px] font-medium capitalize border px-1.5 py-0.5 rounded', STATUS_BG[j.status] ?? 'text-muted-foreground')}>
                      {j.status}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-muted-foreground whitespace-nowrap text-[10px]">
                    {j.completedAt ? new Date(j.completedAt).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }) : '—'}
                  </td>
                  <td className="py-2 px-3">
                    <button
                      onClick={e => { e.stopPropagation(); setDrawerJob(j); }}
                      className="text-[10px] text-blue-400 hover:text-blue-300 border border-blue-500/30 hover:border-blue-400/50 px-2 py-0.5 rounded transition-colors whitespace-nowrap"
                    >
                      View
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {drawerJob && (
        <PushJobDrawer job={drawerJob} onClose={() => setDrawerJob(null)} statusBg={STATUS_BG} />
      )}
    </div>
  );
}

// ── Product Rates Tab ─────────────────────────────────────────────────────────
function ProductRatesTab({ products }: { products: Product[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ prefix: "", rate: "", currency: "USD", effectiveFrom: new Date().toISOString().slice(0, 10), effectiveTo: "", notes: "" });

  const { data: rates = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/product-rates", selectedProductId],
    queryFn: () => fetch(`/api/product-rates${selectedProductId ? `?productId=${selectedProductId}` : ""}`).then(r => r.json()),
    enabled: true,
  });

  const createMut = useMutation({
    mutationFn: (body: any) => apiRequest("POST", "/api/product-rates", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/product-rates"] });
      setShowForm(false);
      setForm({ prefix: "", rate: "", currency: "USD", effectiveFrom: new Date().toISOString().slice(0, 10), effectiveTo: "", notes: "" });
      toast({ title: "Rate created" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/product-rates/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/product-rates"] }); toast({ title: "Rate deleted" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleCreate = () => {
    if (!selectedProductId || !form.rate || !form.effectiveFrom) {
      toast({ title: "Select a product and fill rate + effective date", variant: "destructive" }); return;
    }
    createMut.mutate({ productId: Number(selectedProductId), ...form });
  };

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Sidebar */}
      <div className="w-48 shrink-0 border-r border-border/50 flex flex-col gap-0 overflow-y-auto py-2">
        <div className="px-3 py-1.5 text-[10px] font-semibold uppercase text-muted-foreground tracking-wider">Product</div>
        {products.map(p => (
          <button
            key={p.id}
            onClick={() => setSelectedProductId(String(p.id))}
            data-testid={`product-rate-select-${p.id}`}
            className={cn(
              "text-left px-3 py-2 text-xs flex items-center gap-2 border-l-2 transition-colors",
              selectedProductId === String(p.id) ? "border-primary bg-muted/30 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/10",
            )}
          >
            <Tag className="w-3 h-3 shrink-0" />
            <span className="truncate">{p.name}</span>
          </button>
        ))}
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-border/30 bg-muted/10">
          <div className="text-xs font-medium flex items-center gap-2">
            <PackageCheck className="w-3.5 h-3.5 text-blue-400" />
            Product Rate Repository
            {selectedProductId && <span className="text-muted-foreground">— {products.find(p => String(p.id) === selectedProductId)?.name}</span>}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { const u = `/api/rate-manager/export?format=xlsx${selectedProductId ? `&productId=${selectedProductId}` : ''}`; window.open(u,'_blank'); }}
              className="flex items-center gap-1 text-xs bg-green-500/10 hover:bg-green-500/20 text-green-400 px-2.5 py-1 rounded transition-colors"
              title="Download rate sheet as Excel"
            >
              <Download className="w-3 h-3" /> Full Sheet
            </button>
            <button
              onClick={() => { const u = `/api/rate-manager/export?format=csv${selectedProductId ? `&productId=${selectedProductId}` : ''}`; window.open(u,'_blank'); }}
              className="flex items-center gap-1 text-xs bg-green-500/10 hover:bg-green-500/20 text-green-400 px-2.5 py-1 rounded transition-colors"
              title="Download as CSV"
            >
              <Download className="w-3 h-3" /> CSV
            </button>
            <button
              onClick={() => setShowForm(v => !v)}
              data-testid="btn-add-rate"
              className="flex items-center gap-1 text-xs bg-primary/10 hover:bg-primary/20 text-primary px-2.5 py-1 rounded transition-colors"
            >
              <Plus className="w-3 h-3" /> Add Rate
            </button>
          </div>
        </div>
        {/* Product Rates KPI Strip */}
        {selectedProductId && rates.length > 0 && (() => {
          const now = new Date();
          const active    = rates.filter((r: any) => !r.effectiveTo || new Date(r.effectiveTo) >= now).length;
          const scheduled = rates.filter((r: any) => new Date(r.effectiveFrom) > now).length;
          const latestMs  = Math.max(...rates.map((r: any) => new Date(r.effectiveFrom).getTime()));
          const latest    = isFinite(latestMs) ? new Date(latestMs).toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"numeric" }) : "—";
          const tiles = [
            { label: "Destinations",  value: String(rates.length), cls: "text-blue-400   border-blue-500/20  bg-blue-500/8"   },
            { label: "Active",        value: String(active),        cls: "text-green-400  border-green-500/20 bg-green-500/8"  },
            { label: "Scheduled",     value: String(scheduled),     cls: "text-amber-400  border-amber-500/20 bg-amber-500/8"  },
            { label: "Last Effective",value: latest,                cls: "text-purple-400 border-purple-500/20 bg-purple-500/8" },
          ];
          return (
            <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border/20 flex-shrink-0 overflow-x-auto">
              {tiles.map(t => (
                <div key={t.label} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border shrink-0 ${t.cls}`}>
                  <div>
                    <div className="text-sm font-bold tabular-nums leading-tight">{t.value}</div>
                    <div className="text-[9px] text-muted-foreground uppercase tracking-wide leading-tight">{t.label}</div>
                  </div>
                </div>
              ))}
            </div>
          );
        })()}

        {showForm && (
          <div className="border-b border-border/30 bg-muted/5 px-4 py-3 flex flex-wrap gap-3 items-end">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-muted-foreground">Prefix</label>
              <input data-testid="input-rate-prefix" className="bg-muted border border-border rounded px-2 py-1 text-xs w-32 font-mono" placeholder="e.g. 9230" value={form.prefix} onChange={e => setForm(f => ({ ...f, prefix: e.target.value }))} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-muted-foreground">Rate (USD/min)</label>
              <input data-testid="input-rate-value" type="number" step="0.000001" className="bg-muted border border-border rounded px-2 py-1 text-xs w-28 font-mono" placeholder="0.000000" value={form.rate} onChange={e => setForm(f => ({ ...f, rate: e.target.value }))} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-muted-foreground">Effective From</label>
              <input data-testid="input-rate-from" type="date" className="bg-muted border border-border rounded px-2 py-1 text-xs w-36" value={form.effectiveFrom} onChange={e => setForm(f => ({ ...f, effectiveFrom: e.target.value }))} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-muted-foreground">Effective To (optional)</label>
              <input data-testid="input-rate-to" type="date" className="bg-muted border border-border rounded px-2 py-1 text-xs w-36" value={form.effectiveTo} onChange={e => setForm(f => ({ ...f, effectiveTo: e.target.value }))} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-muted-foreground">Notes</label>
              <input data-testid="input-rate-notes" className="bg-muted border border-border rounded px-2 py-1 text-xs w-48" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
            <button onClick={handleCreate} disabled={createMut.isPending} data-testid="btn-save-rate"
              className="flex items-center gap-1 text-xs bg-green-600 hover:bg-green-500 text-white px-3 py-1 rounded transition-colors disabled:opacity-50">
              {createMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Save
            </button>
            <button onClick={() => setShowForm(false)} className="text-xs text-muted-foreground hover:text-foreground px-2 py-1">Cancel</button>
          </div>
        )}

        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="flex items-center gap-2 justify-center py-12 text-xs text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
          ) : rates.length === 0 ? (
            <div className="text-center text-xs text-muted-foreground py-12">
              {selectedProductId ? "No rates configured for this product yet" : "Select a product to view its rates"}
            </div>
          ) : (
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-border/50 bg-muted/20 sticky top-0">
                  {["Prefix", "Rate (USD/min)", "Currency", "Effective From", "Effective To", "Notes", "Created By", ""].map(h => (
                    <th key={h} className="text-left py-2 px-3 font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rates.map((r: any) => (
                  <tr key={r.id} className="border-b border-border/20 hover:bg-muted/10" data-testid={`row-rate-${r.id}`}>
                    <td className="py-2 px-3 font-mono text-amber-400">{displayPrefix(r.prefix)}</td>
                    <td className="py-2 px-3 font-mono tabular-nums">{Number(r.rate).toFixed(6)}</td>
                    <td className="py-2 px-3">{r.currency}</td>
                    <td className="py-2 px-3 tabular-nums">{r.effectiveFrom}</td>
                    <td className="py-2 px-3 tabular-nums text-muted-foreground">{r.effectiveTo || "—"}</td>
                    <td className="py-2 px-3 text-muted-foreground truncate max-w-xs">{r.notes || "—"}</td>
                    <td className="py-2 px-3 text-muted-foreground">{r.createdBy || "—"}</td>
                    <td className="py-2 px-3">
                      <button onClick={() => deleteMut.mutate(r.id)} data-testid={`btn-delete-rate-${r.id}`}
                        className="text-red-400 hover:text-red-300 transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Rate Notification System ──────────────────────────────────────────────────
interface RnTemplate {
  id: number; clientName: string; productId: number; productName?: string | null;
  notificationType: string; recipients?: string | null; ccEmails?: string | null;
  trafficFormat?: string | null; status: string; createdBy?: string | null; createdAt: string;
}
interface RnDestination {
  id: number; templateId: number; country?: string | null; carrierType?: string | null;
  category?: string | null; destinationName: string; dialPrefix?: string | null;
  rate: string; baseRate?: string | null; activationDate?: string | null;
  activationTime?: string | null; createdAt: string;
}
interface RnJob {
  id: number; jobRef: string; templateId?: number | null; clientName: string;
  productName?: string | null; notificationType?: string | null; destinationCount?: number | null;
  tariffUpdated?: boolean | null; sbcMappingOk?: boolean | null; sbcUpdated?: boolean | null;
  sheetGenerated?: boolean | null; sheetGeneratedAt?: string | null;
  emailSent?: boolean | null; violatedRules?: boolean | null; approvalRequired?: boolean | null;
  templateVersion?: string | null; generatedAttachmentHash?: string | null;
  companyId?: number | null; productId?: number | null; iAccount?: number | null;
  iTariff?: number | null; servicePlanId?: string | null;
  // Approval workflow (Sprint A)
  submittedForApprovalAt?: string | null; submittedBy?: string | null;
  approvedBy?: string | null; approvedAt?: string | null;
  rejectedBy?: string | null; rejectedAt?: string | null; rejectionReason?: string | null;
  status: string; remarks?: string | null; pushResults?: any[]; createdBy?: string | null; createdAt: string;
}

const NOTIF_TYPE_LABEL: Record<string, string> = {
  default: "DEFAULT", changes_only: "CHANGES", full_sheet: "FULL",
};
const JOB_STATUS_COLOR: Record<string, string> = {
  successful: "text-green-400", partial: "text-amber-400",
  failed: "text-red-400", in_progress: "text-blue-400", pending: "text-muted-foreground",
  pending_rates: "text-amber-500", dismissed: "text-muted-foreground/40",
  awaiting_approval: "text-blue-400", approved: "text-green-400",
  activated: "text-emerald-400", rejected: "text-red-400/70",
};
const JOB_STATUS_LABEL: Record<string, string> = {
  pending_rates: "Pending Rates", in_progress: "In Progress",
  successful: "Successful", failed: "Failed", partial: "Partial",
  pending: "Pending", dismissed: "Dismissed",
  awaiting_approval: "Awaiting Approval", approved: "Approved",
  activated: "Activated", rejected: "Rejected",
};

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) + " " +
    d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

// ── Add Destination Modal ──────────────────────────────────────────────────────
function AddDestinationModal({
  templateId, onClose, onSaved,
}: { templateId: number; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    country: "", carrierType: "", category: "", destinationName: "",
    dialPrefix: "", rate: "", baseRate: "", activationDate: "", activationTime: "00:00",
  });
  const saveMut = useMutation({
    mutationFn: () => apiRequest("POST", `/api/rate-notification-templates/${templateId}/destinations`, {
      ...form,
      rate: parseFloat(form.rate) || 0,
      baseRate: form.baseRate ? parseFloat(form.baseRate) : undefined,
    }),
    onSuccess: () => { toast({ title: "Destination added" }); onSaved(); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const f = (k: keyof typeof form, v: string) => setForm(p => ({ ...p, [k]: v }));
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-background border border-border rounded-lg w-full max-w-lg flex flex-col gap-0 overflow-hidden shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
          <span className="text-sm font-semibold flex items-center gap-2"><Plus className="w-4 h-4 text-amber-400" /> Add Destination</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Destination Name *</label>
              <input data-testid="input-dest-name" className="bg-muted border border-border rounded px-2 py-1.5 text-xs"
                placeholder="Pakistan Jazz" value={form.destinationName} onChange={e => f("destinationName", e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Dial Prefix</label>
              <input data-testid="input-dest-prefix" className="bg-muted border border-border rounded px-2 py-1.5 text-xs font-mono"
                placeholder="9230" value={form.dialPrefix} onChange={e => f("dialPrefix", e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Country</label>
              <input data-testid="input-dest-country" className="bg-muted border border-border rounded px-2 py-1.5 text-xs"
                placeholder="Pakistan" value={form.country} onChange={e => f("country", e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Carrier Type</label>
              <input data-testid="input-dest-carrier" className="bg-muted border border-border rounded px-2 py-1.5 text-xs"
                placeholder="Mobile" value={form.carrierType} onChange={e => f("carrierType", e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Rate (USD/min) *</label>
              <input data-testid="input-dest-rate" type="number" step="0.000001" className="bg-muted border border-border rounded px-2 py-1.5 text-xs font-mono"
                placeholder="0.027000" value={form.rate} onChange={e => f("rate", e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Base Rate</label>
              <input data-testid="input-dest-base-rate" type="number" step="0.000001" className="bg-muted border border-border rounded px-2 py-1.5 text-xs font-mono"
                placeholder="optional" value={form.baseRate} onChange={e => f("baseRate", e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Activation Date</label>
              <input data-testid="input-dest-actdate" type="date" className="bg-muted border border-border rounded px-2 py-1.5 text-xs"
                value={form.activationDate} onChange={e => f("activationDate", e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Activation Time</label>
              <input data-testid="input-dest-acttime" type="time" className="bg-muted border border-border rounded px-2 py-1.5 text-xs font-mono"
                value={form.activationTime} onChange={e => f("activationTime", e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Category</label>
            <input data-testid="input-dest-category" className="bg-muted border border-border rounded px-2 py-1.5 text-xs"
              placeholder="Wholesale / Retail" value={form.category} onChange={e => f("category", e.target.value)} />
          </div>
        </div>
        <div className="flex gap-2 px-4 py-3 border-t border-border/50">
          <button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !form.destinationName || !form.rate}
            data-testid="btn-save-destination"
            className="flex items-center gap-1.5 text-xs bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white px-3 py-1.5 rounded transition-colors">
            {saveMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Save Destination
          </button>
          <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground px-2 py-1.5">Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── Template Detail Panel ──────────────────────────────────────────────────────
function TemplateDetail({
  tpl, products, onBack,
}: { tpl: RnTemplate; products: Product[]; onBack: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showAddDest, setShowAddDest]     = useState(false);
  const [showSendConfirm, setShowSendConfirm] = useState(false);
  const [sendResult, setSendResult]       = useState<any>(null);
  const [editMode, setEditMode]           = useState(false);
  const [editForm, setEditForm]           = useState({
    recipients: tpl.recipients ?? "",
    ccEmails:   tpl.ccEmails   ?? "",
    subject:    tpl.subject    ?? "",
    bodyTemplate: tpl.bodyTemplate ?? "",
  });

  const detailKey = ["/api/rate-notification-templates", tpl.id];
  const { data: detail, isLoading } = useQuery<RnTemplate & { destinations: RnDestination[] }>({
    queryKey: detailKey,
    queryFn: () => fetch(`/api/rate-notification-templates/${tpl.id}`).then(r => r.json()),
  });
  const destinations = detail?.destinations ?? [];

  const deletDestMut = useMutation({
    mutationFn: (destId: number) => apiRequest("DELETE", `/api/rate-notification-template-destinations/${destId}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: detailKey }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const sendMut = useMutation({
    mutationFn: () => apiRequest("POST", `/api/rate-notification-templates/${tpl.id}/send`, {}),
    onSuccess: (res: any) => {
      setSendResult(res);
      setShowSendConfirm(false);
      qc.invalidateQueries({ queryKey: ["/api/rate-notification-jobs"] });
      toast({ title: res.status === "successful" ? "Notification sent!" : `Job created — status: ${res.status}` });
    },
    onError: (e: any) => toast({ title: "Send failed", description: e.message, variant: "destructive" }),
  });

  const saveMut = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/rate-notification-templates/${tpl.id}`, {
      recipients:   editForm.recipients || null,
      ccEmails:     editForm.ccEmails   || null,
      subject:      editForm.subject    || null,
      bodyTemplate: editForm.bodyTemplate || null,
    }),
    onSuccess: () => {
      setEditMode(false);
      qc.invalidateQueries({ queryKey: ["/api/rate-notification-templates"] });
      toast({ title: "Template saved" });
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });
  const productName = products.find(p => p.id === tpl.productId)?.name ?? tpl.productName ?? `product-${tpl.productId}`;

  return (
    <div className="flex-1 overflow-auto p-4">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} data-testid="btn-back-to-templates"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <ChevronRight className="w-3 h-3 rotate-180" /> Templates
        </button>
        <span className="text-muted-foreground/50">/</span>
        <span className="text-sm font-semibold">{tpl.clientName}</span>
        <span className="text-muted-foreground/50">·</span>
        <span className="text-xs text-amber-400 font-medium">{productName}</span>
        <span className="ml-auto flex items-center gap-2">
          <span className={cn("text-[10px] px-2 py-0.5 rounded border font-medium",
            NOTIF_TYPE_LABEL[tpl.notificationType] === "FULL" ? "border-blue-400/40 text-blue-400"
              : NOTIF_TYPE_LABEL[tpl.notificationType] === "CHANGES" ? "border-amber-400/40 text-amber-400"
              : "border-border/50 text-muted-foreground"
          )}>
            {NOTIF_TYPE_LABEL[tpl.notificationType] ?? (tpl.notificationType ?? '').toUpperCase()}
          </span>
          <button onClick={() => setShowAddDest(true)} data-testid="btn-add-destination"
            className="flex items-center gap-1 text-xs bg-muted hover:bg-muted/80 border border-border/50 px-2.5 py-1 rounded transition-colors">
            <Plus className="w-3 h-3" /> Add Destination
          </button>
          <button onClick={() => setShowSendConfirm(true)} disabled={destinations.length === 0}
            data-testid="btn-send-notification"
            className="flex items-center gap-1.5 text-xs bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white px-3 py-1 rounded transition-colors">
            <Send className="w-3 h-3" /> Send Notification
          </button>
          {editMode ? (
            <>
              <button onClick={() => setEditMode(false)} className="flex items-center gap-1 text-xs border border-border/50 px-2.5 py-1 rounded text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
              <button onClick={() => saveMut.mutate()} disabled={saveMut.isPending} className="flex items-center gap-1 text-xs bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white px-2.5 py-1 rounded transition-colors">{saveMut.isPending ? "Saving…" : "Save"}</button>
            </>
          ) : (
            <button onClick={() => setEditMode(true)} className="flex items-center gap-1 text-xs border border-border/50 px-2.5 py-1 rounded text-muted-foreground hover:text-foreground transition-colors">
              <Pencil className="w-3 h-3" /> Edit
            </button>
          )}
        </span>
      </div>

      {/* Meta row — view or edit */}
      {editMode ? (
        <div className="mb-4 border border-border/40 rounded-lg p-3 bg-muted/20 grid grid-cols-1 gap-3 text-xs">
          <div><label className="text-[10px] text-muted-foreground uppercase tracking-wide block mb-1">Subject</label>
            <input value={editForm.subject} onChange={e => setEditForm(f => ({ ...f, subject: e.target.value }))} placeholder="Rate update: {{productName}}" className="w-full bg-background border border-border/50 rounded px-2 py-1.5 text-xs" /></div>
          <div><label className="text-[10px] text-muted-foreground uppercase tracking-wide block mb-1">Recipients (comma-separated)</label>
            <input value={editForm.recipients} onChange={e => setEditForm(f => ({ ...f, recipients: e.target.value }))} placeholder="billing@client.com, noc@client.com" className="w-full bg-background border border-border/50 rounded px-2 py-1.5 text-xs" /></div>
          <div><label className="text-[10px] text-muted-foreground uppercase tracking-wide block mb-1">CC (optional)</label>
            <input value={editForm.ccEmails} onChange={e => setEditForm(f => ({ ...f, ccEmails: e.target.value }))} placeholder="kam@bitsauto.com" className="w-full bg-background border border-border/50 rounded px-2 py-1.5 text-xs" /></div>
          <div><label className="text-[10px] text-muted-foreground uppercase tracking-wide block mb-1">Body Template</label>
            <textarea value={editForm.bodyTemplate} onChange={e => setEditForm(f => ({ ...f, bodyTemplate: e.target.value }))} rows={4} placeholder="Dear {{clientName}}, please find updated rates for {{productName}}…" className="w-full bg-background border border-border/50 rounded px-2 py-1.5 text-xs font-mono resize-y" /></div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-4 mb-4 text-xs text-muted-foreground">
          {tpl.recipients && <span><span className="text-foreground/60 font-medium">To:</span> {tpl.recipients}</span>}
          {tpl.ccEmails && <span><span className="text-foreground/60 font-medium">CC:</span> {tpl.ccEmails}</span>}
          {tpl.subject && <span><span className="text-foreground/60 font-medium">Subject:</span> {tpl.subject}</span>}
          {tpl.trafficFormat && <span><span className="text-foreground/60 font-medium">Format:</span> {tpl.trafficFormat}</span>}
          <span><span className="text-foreground/60 font-medium">Created:</span> {fmtDate(tpl.createdAt)}</span>
        </div>
      )}

      {/* Send result banner */}
      {sendResult && (
        <div className={cn("mb-4 border rounded-md px-4 py-3 text-xs flex flex-col gap-1",
          sendResult.status === "successful" ? "border-green-500/30 bg-green-500/5" : "border-amber-500/30 bg-amber-500/5")}>
          <div className="flex items-center gap-2 font-medium">
            {sendResult.status === "successful"
              ? <CircleCheck className="w-3.5 h-3.5 text-green-400" />
              : <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />}
            Job {sendResult.jobRef} — {sendResult.status.toUpperCase()}
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-muted-foreground mt-1">
            <span>Email: {sendResult.steps?.emailSent ? <span className="text-green-400">✓ Sent</span> : <span className="text-red-400">✗ Not sent</span>}</span>
            <span>Sippy rates: {sendResult.steps?.tariffUpdated ? <span className="text-green-400">✓ Updated</span> : <span className="text-muted-foreground">— Skipped</span>}</span>
            <span>SBC Mapping: {sendResult.steps?.sbcMappingOk ? <span className="text-green-400">✓ Available</span> : <span className="text-muted-foreground">— Skipped</span>}</span>
            <span>SBC: {sendResult.steps?.sbcUpdated ? <span className="text-green-400">✓ Updated</span> : <span className="text-muted-foreground">— Skipped</span>}</span>
          </div>
          {sendResult.remarks && <div className="text-muted-foreground mt-0.5">{sendResult.remarks}</div>}
        </div>
      )}

      {/* Destinations table */}
      {isLoading ? (
        <div className="flex items-center gap-2 justify-center py-12 text-xs text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading rate sheet…
        </div>
      ) : destinations.length === 0 ? (
        <div className="text-center py-12 text-xs text-muted-foreground border border-dashed border-border/40 rounded-lg">
          No destinations yet — click <strong>Add Destination</strong> to build the rate sheet.
        </div>
      ) : (
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-border/60 bg-muted/30 backdrop-blur">
              {["#", "Country", "Carrier", "Destination", "Prefix", "Rate (USD/min)", "Base Rate", "Effective", ""].map(h => (
                <th key={h} className="text-left py-2 px-3 font-medium text-muted-foreground whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {destinations.map((d, i) => (
              <tr key={d.id} className="border-b border-border/20 hover:bg-muted/10" data-testid={`row-dest-${d.id}`}>
                <td className="py-2 px-3 text-muted-foreground tabular-nums">{i + 1}</td>
                <td className="py-2 px-3">{d.country || "—"}</td>
                <td className="py-2 px-3 text-muted-foreground">{d.carrierType || "—"}</td>
                <td className="py-2 px-3 font-medium">{d.destinationName}</td>
                <td className="py-2 px-3 font-mono text-muted-foreground">{d.dialPrefix || "—"}</td>
                <td className="py-2 px-3 font-mono tabular-nums text-amber-400">{Number(d.rate).toFixed(6)}</td>
                <td className="py-2 px-3 font-mono tabular-nums text-muted-foreground">{d.baseRate ? Number(d.baseRate).toFixed(6) : "—"}</td>
                <td className="py-2 px-3 text-muted-foreground whitespace-nowrap">
                  {d.activationDate ? `${d.activationDate} ${d.activationTime || ""}`.trim() : "—"}
                </td>
                <td className="py-2 px-3">
                  <button onClick={() => deletDestMut.mutate(d.id)} data-testid={`btn-del-dest-${d.id}`}
                    className="text-muted-foreground hover:text-red-400 transition-colors">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showAddDest && (
        <AddDestinationModal
          templateId={tpl.id}
          onClose={() => setShowAddDest(false)}
          onSaved={() => { setShowAddDest(false); qc.invalidateQueries({ queryKey: detailKey }); }}
        />
      )}

      {/* Send confirmation dialog */}
      {showSendConfirm && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-background border border-border rounded-lg w-full max-w-md shadow-xl">
            <div className="px-5 py-4 border-b border-border/50">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <Send className="w-4 h-4 text-amber-400" /> Send Rate Notification
              </h2>
            </div>
            <div className="px-5 py-4 text-xs flex flex-col gap-2">
              <p className="text-muted-foreground">This will:</p>
              <ul className="list-disc list-inside text-muted-foreground flex flex-col gap-1 pl-2">
                <li>Update <strong className="text-foreground">{destinations.length} prefix{destinations.length !== 1 ? "es" : ""}</strong> in the client's Sippy tariff — other prefixes are <strong className="text-foreground">not touched</strong></li>
                <li>Email an Excel rate sheet to <strong className="text-foreground">{tpl.recipients || "configured recipients"}</strong></li>
                <li>Create a job record with full step tracking for audit</li>
              </ul>
              <p className="text-[10px] text-muted-foreground border border-border/30 rounded px-2.5 py-1.5 bg-muted/20 mt-1">
                <strong className="text-foreground/70">Note:</strong> The notification sheet contains only the destinations you've added to this template. It is independent of the full tariff — prefixes not in this sheet remain active in Sippy unchanged.
              </p>
              <p className="mt-1 font-medium text-foreground">
                Client: <span className="text-amber-400">{tpl.clientName}</span> &nbsp;·&nbsp;
                Product: <span className="text-amber-400">{productName}</span> &nbsp;·&nbsp;
                Type: <span className="text-amber-400">{NOTIF_TYPE_LABEL[tpl.notificationType] ?? tpl.notificationType}</span>
              </p>
            </div>
            <div className="flex gap-2 px-5 py-3 border-t border-border/50">
              <button onClick={() => sendMut.mutate()} disabled={sendMut.isPending}
                data-testid="btn-confirm-send"
                className="flex items-center gap-1.5 text-xs bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white px-4 py-1.5 rounded transition-colors">
                {sendMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                {sendMut.isPending ? "Sending…" : "Confirm Send"}
              </button>
              <button onClick={() => setShowSendConfirm(false)} className="text-xs text-muted-foreground hover:text-foreground px-2 py-1.5">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── New Template Modal ─────────────────────────────────────────────────────────
function NewTemplateModal({
  products, onClose, onSaved,
}: { products: Product[]; onClose: () => void; onSaved: (t: RnTemplate) => void }) {
  const { toast } = useToast();
  const [companySearch, setCompanySearch] = useState("");
  const [selectedCompany, setSelectedCompany] = useState<any>(null);
  const [showDrop, setShowDrop] = useState(false);
  const [recipientList, setRecipientList] = useState<string[]>([""]);
  const [ccList, setCcList] = useState<string[]>([]);
  const [testEmail, setTestEmail] = useState("");
  const [sendingTest, setSendingTest] = useState(false);
  const [form, setForm] = useState({
    clientName: "", productId: "", notificationType: "default", trafficFormat: "",
    subject: "", bodyTemplate: "", templateType: "default", scheduleType: "immediate", scheduledAt: "",
  });

  const { data: allCompanies = [] } = useQuery<any[]>({
    queryKey: ["/api/companies/all"],
    queryFn: () => fetch("/api/companies").then(r => r.json()).then((d: any) => Array.isArray(d) ? d : (d.companies ?? [])),
  });
  const companies = companySearch.length >= 1
    ? allCompanies.filter((co: any) => {
        const name = (co.name || co.companyName || "").toLowerCase();
        return name.includes(companySearch.toLowerCase());
      })
    : [];

  const selectCompany = (co: any) => {
    setSelectedCompany(co);
    setCompanySearch(co.name || co.companyName || "");
    setShowDrop(false);
    setForm(p => ({ ...p, clientName: co.name || co.companyName || "" }));
    const primary = co.email || co.primaryEmail || co.billingEmail || co.contactEmail || "";
    const rawCc = co.ccEmails || co.cc_emails || co.ccEmail || [];
    if (primary) setRecipientList([primary]);
    const ccArr = Array.isArray(rawCc) ? rawCc
      : typeof rawCc === "string" && rawCc ? rawCc.split(",").map((e: string) => e.trim()).filter(Boolean) : [];
    if (ccArr.length) setCcList(ccArr);
  };

  const saveMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/rate-notification-templates", {
      clientName: form.clientName,
      productId: Number(form.productId),
      notificationType: form.notificationType,
      trafficFormat: form.trafficFormat,
      recipients: recipientList.filter(Boolean).join(", "),
      ccEmails: ccList.filter(Boolean).join(", "),
      subject: form.subject,
      bodyTemplate: form.bodyTemplate,
      templateType: form.templateType,
      scheduleConfig: form.scheduleType === "scheduled" && form.scheduledAt
        ? { type: "scheduled", at: form.scheduledAt }
        : { type: "immediate" },
    }),
    onSuccess: (res: any) => { toast({ title: "Template created" }); onSaved(res); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleTestSend = async () => {
    if (!testEmail) return;
    setSendingTest(true);
    try {
      const r = await apiRequest("POST", "/api/rate-notification-templates/test-send-preview", {
        subject: form.subject || `Rate Notification — ${form.clientName}`,
        bodyTemplate: form.bodyTemplate,
        toEmail: testEmail,
        clientName: form.clientName,
      });
      toast({ title: "Test email queued", description: `Sent preview to ${testEmail}` });
    } catch (e: any) {
      toast({ title: "Test send failed", description: e.message, variant: "destructive" });
    } finally { setSendingTest(false); }
  };

  const TEMPLATE_TYPES = [
    { value: "default",      label: "Default",       desc: "Standard rate update",    color: "border-blue-500/40 bg-blue-500/5 text-blue-400" },
    { value: "changes_only", label: "Changes Only",  desc: "Delta / partial update",  color: "border-amber-500/40 bg-amber-500/5 text-amber-400" },
    { value: "full_sheet",   label: "Full Sheet",    desc: "Complete A–Z rate sheet", color: "border-green-500/40 bg-green-500/5 text-green-400" },
    { value: "emergency",    label: "Emergency",     desc: "Urgent rate notice",      color: "border-red-500/40 bg-red-500/5 text-red-400" },
  ] as const;

  const TOKEN_HINTS = ["{{clientName}}", "{{productName}}", "{{effectiveDate}}", "{{destinationName}}", "{{newRate}}", "{{oldRate}}"];

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={e => { if (e.target === e.currentTarget) setShowDrop(false); }}>
      <div className="bg-background border border-border rounded-lg w-full max-w-2xl overflow-hidden shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
          <span className="text-sm font-semibold flex items-center gap-2">
            <BellRing className="w-4 h-4 text-amber-400" /> New Rate Notification Template
          </span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-4 flex flex-col gap-4 max-h-[75vh] overflow-y-auto">

          {/* Template Type Cards */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Template Type</label>
            <div className="grid grid-cols-4 gap-2">
              {TEMPLATE_TYPES.map(t => (
                <button key={t.value} type="button"
                  onClick={() => setForm(p => ({ ...p, templateType: t.value }))}
                  className={`rounded-lg border p-2.5 text-left transition-all ${form.templateType === t.value ? t.color + " ring-1 ring-current/30" : "border-border/40 hover:border-border"}`}>
                  <div className="text-[11px] font-semibold">{t.label}</div>
                  <div className="text-[9px] text-muted-foreground mt-0.5 leading-tight">{t.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Client search */}
          <div className="flex flex-col gap-1 relative">
            <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Client *</label>
            <div className="relative">
              <input
                className="bg-muted border border-border rounded px-2 py-1.5 text-xs w-full pr-7 focus:outline-none focus:border-amber-500/50"
                placeholder="Search company…"
                value={companySearch}
                onChange={e => { setCompanySearch(e.target.value); setShowDrop(true); setSelectedCompany(null); setForm(p => ({ ...p, clientName: e.target.value })); }}
                onFocus={() => companySearch.length >= 1 && setShowDrop(true)}
              />
              <Search className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/50 pointer-events-none" />
            </div>
            {showDrop && companySearch.length >= 1 && companies.length > 0 && (
              <div className="absolute top-full left-0 right-0 z-50 bg-background border border-border rounded-lg shadow-xl mt-1 max-h-48 overflow-y-auto">
                {companies.slice(0, 12).map((co: any) => (
                  <button key={co.id} className="w-full text-left px-3 py-2 text-xs hover:bg-muted/50 flex items-center gap-2 border-b border-border/20 last:border-0"
                    onClick={() => selectCompany(co)}>
                    <Building2 className="w-3 h-3 text-muted-foreground/50 shrink-0" />
                    <span className="font-medium flex-1">{co.name || co.companyName}</span>
                    {(co.email || co.primaryEmail) && (
                      <span className="text-muted-foreground/50 text-[10px] truncate max-w-[150px]">{co.email || co.primaryEmail}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
            {selectedCompany && (
              <div className="text-[10px] text-green-400 flex items-center gap-1 mt-0.5">
                <Check className="w-3 h-3" /> {selectedCompany.name || selectedCompany.companyName}
                {(selectedCompany.email || selectedCompany.primaryEmail) && <span className="text-muted-foreground/60 ml-1">· emails auto-filled</span>}
              </div>
            )}
          </div>

          {/* Product + Notification Type */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Product *</label>
              <select className="bg-muted border border-border rounded px-2 py-1.5 text-xs"
                value={form.productId} onChange={e => setForm(p => ({ ...p, productId: e.target.value }))}>
                <option value="">— Select product —</option>
                {products.map(p => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Notification Type</label>
              <select className="bg-muted border border-border rounded px-2 py-1.5 text-xs"
                value={form.notificationType} onChange={e => setForm(p => ({ ...p, notificationType: e.target.value }))}>
                <option value="default">DEFAULT — standard update</option>
                <option value="changes_only">CHANGES — partial/delta only</option>
                <option value="full_sheet">FULL — complete A–Z sheet</option>
              </select>
            </div>
          </div>

          {/* Subject */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Subject Line</label>
            <input className="bg-muted border border-border rounded px-2 py-1.5 text-xs focus:outline-none focus:border-amber-500/50"
              placeholder="e.g. Rate Update — {{clientName}} — {{productName}}"
              value={form.subject} onChange={e => setForm(p => ({ ...p, subject: e.target.value }))} />
          </div>

          {/* Body Template */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Body Template</label>
              <div className="flex gap-1 flex-wrap">
                {TOKEN_HINTS.map(t => (
                  <button key={t} type="button"
                    className="text-[9px] bg-muted border border-border/40 rounded px-1 py-0.5 text-muted-foreground hover:text-foreground hover:border-border font-mono"
                    onClick={() => setForm(p => ({ ...p, bodyTemplate: p.bodyTemplate + t }))}>
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <textarea
              rows={5}
              className="bg-muted border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-amber-500/50 resize-none"
              placeholder={"Dear {{clientName}},\n\nPlease find attached the updated rate sheet for {{productName}}.\n\nEffective date: {{effectiveDate}}\n\nRegards,\nBitsAuto Network"}
              value={form.bodyTemplate}
              onChange={e => setForm(p => ({ ...p, bodyTemplate: e.target.value }))}
            />
          </div>

          {/* Recipients */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Recipients *</label>
              <button onClick={() => setRecipientList(l => [...l, ""])}
                className="text-[10px] text-amber-400 hover:text-amber-300 flex items-center gap-0.5">
                <Plus className="w-3 h-3" /> Add Recipient
              </button>
            </div>
            {recipientList.map((email, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <input className="bg-muted border border-border rounded px-2 py-1.5 text-xs flex-1 focus:outline-none focus:border-amber-500/50"
                  placeholder="email@company.com" value={email}
                  onChange={e => setRecipientList(l => l.map((x, idx) => idx === i ? e.target.value : x))} />
                {recipientList.length > 1 && (
                  <button onClick={() => setRecipientList(l => l.filter((_, idx) => idx !== i))}
                    className="text-muted-foreground/40 hover:text-red-400 p-0.5"><X className="w-3 h-3" /></button>
                )}
              </div>
            ))}
          </div>

          {/* CC */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[10px] text-muted-foreground uppercase tracking-wide">CC (optional)</label>
              <button onClick={() => setCcList(l => [...l, ""])}
                className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-0.5">
                <Plus className="w-3 h-3" /> Add CC
              </button>
            </div>
            {ccList.length === 0
              ? <div className="text-[10px] text-muted-foreground/40 italic py-0.5">None — click Add CC to add</div>
              : ccList.map((email, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <input className="bg-muted border border-border rounded px-2 py-1.5 text-xs flex-1 focus:outline-none focus:border-blue-500/50"
                    placeholder="cc@company.com" value={email}
                    onChange={e => setCcList(l => l.map((x, idx) => idx === i ? e.target.value : x))} />
                  <button onClick={() => setCcList(l => l.filter((_, idx) => idx !== i))}
                    className="text-muted-foreground/40 hover:text-red-400 p-0.5"><X className="w-3 h-3" /></button>
                </div>
              ))
            }
          </div>

          {/* Schedule */}
          <div className="flex flex-col gap-2">
            <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Send Schedule</label>
            <div className="flex gap-3">
              {(["immediate", "scheduled"] as const).map(v => (
                <label key={v} className="flex items-center gap-1.5 cursor-pointer text-xs">
                  <input type="radio" name="scheduleType" value={v} checked={form.scheduleType === v}
                    onChange={() => setForm(p => ({ ...p, scheduleType: v }))} className="accent-amber-500" />
                  {v === "immediate" ? "Send immediately" : "Schedule for later"}
                </label>
              ))}
            </div>
            {form.scheduleType === "scheduled" && (
              <input type="datetime-local"
                className="bg-muted border border-border rounded px-2 py-1.5 text-xs w-52 focus:outline-none focus:border-amber-500/50"
                value={form.scheduledAt} onChange={e => setForm(p => ({ ...p, scheduledAt: e.target.value }))} />
            )}
          </div>

          {/* Traffic Format */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Traffic Format (optional)</label>
            <input className="bg-muted border border-border rounded px-2 py-1.5 text-xs focus:outline-none focus:border-border"
              placeholder="e.g. E.164 with 9230XXXXXXX" value={form.trafficFormat}
              onChange={e => setForm(p => ({ ...p, trafficFormat: e.target.value }))} />
          </div>

          {/* Test Send */}
          <div className="border border-border/30 rounded-lg p-3 bg-muted/20">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-2">Send Test Email</div>
            <div className="flex gap-2">
              <input className="bg-muted border border-border rounded px-2 py-1.5 text-xs flex-1 focus:outline-none focus:border-amber-500/50"
                placeholder="test@example.com" value={testEmail}
                onChange={e => setTestEmail(e.target.value)} />
              <button type="button"
                disabled={!testEmail || sendingTest}
                onClick={handleTestSend}
                className="text-xs border border-border rounded px-2.5 py-1.5 hover:bg-muted disabled:opacity-40 flex items-center gap-1">
                {sendingTest ? <Loader2 className="w-3 h-3 animate-spin" /> : <Mail className="w-3 h-3" />}
                Send Test
              </button>
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="flex gap-2 px-4 py-3 border-t border-border/50">
          <button
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending || !form.clientName || !form.productId || !recipientList.some(Boolean)}
            data-testid="btn-save-template"
            className="flex items-center gap-1.5 text-xs bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white px-3 py-1.5 rounded transition-colors">
            {saveMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
            Create Template
          </button>
          <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground px-2 py-1.5">Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── Job Detail Drawer ──────────────────────────────────────────────────────────
function JobDetailDrawer({ job, onClose, onNavigateToTemplates }: {
  job: RnJob; onClose: () => void; onNavigateToTemplates?: (clientName: string, productId?: number) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { isManagement } = useAuth();
  const [downloading, setDownloading]   = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [showReject, setShowReject]     = useState(false);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["/api/rate-notification-jobs"] });

  const dismissMut = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/rate-notification-jobs/${job.id}/dismiss`),
    onSuccess: () => { invalidate(); toast({ title: "Job dismissed" }); onClose(); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const submitMut = useMutation({
    mutationFn: () => apiRequest("POST", `/api/rate-notification-jobs/${job.id}/submit-approval`),
    onSuccess: () => { invalidate(); toast({ title: "Submitted for approval" }); onClose(); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const approveMut = useMutation({
    mutationFn: () => apiRequest("POST", `/api/rate-notification-jobs/${job.id}/approve`),
    onSuccess: () => { invalidate(); toast({ title: "Job approved" }); onClose(); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const rejectMut = useMutation({
    mutationFn: () => apiRequest("POST", `/api/rate-notification-jobs/${job.id}/reject`, { rejectionReason: rejectReason }),
    onSuccess: () => { invalidate(); toast({ title: "Job rejected" }); onClose(); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  async function handleReDownload() {
    setDownloading(true);
    try {
      const resp = await fetch(`/api/rate-notification-jobs/${job.id}/sheet`, { credentials: "include" });
      if (!resp.ok) { const body = await resp.json().catch(() => ({ error: "Unknown error" })); throw new Error(body.error || `HTTP ${resp.status}`); }
      const hashMatch = resp.headers.get("X-Sheet-Hash-Match");
      const origCount = resp.headers.get("X-Original-Dest-Count");
      const newCount  = resp.headers.get("X-Destination-Count");
      const blob = await resp.blob();
      const nameMatch = (resp.headers.get("Content-Disposition") || "").match(/filename="?([^"]+)"?/);
      const filename = nameMatch ? nameMatch[1] : `rate-sheet-${job.jobRef}.xlsx`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      const source = resp.headers.get("X-Sheet-Source");
      if (hashMatch === "false") {
        const isFallback = source === "current_template";
        toast({ title: isFallback ? "Fallback rebuild — destinations may differ" : "Hash mismatch warning",
          description: isFallback ? `Sheet rebuilt from current template (${newCount} rows; original had ${origCount}).` : `Hash differs. Downloaded file (${newCount} rows) may not match the original email.`,
          variant: "destructive" });
      } else {
        toast({ title: "Sheet downloaded", description: source === "snapshot" ? "Exact copy from the frozen snapshot." : "Sheet rebuilt and hash matches." });
      }
    } catch (err: any) { toast({ title: "Download failed", description: err.message, variant: "destructive" }); }
    finally { setDownloading(false); }
  }

  // ── Shared header ────────────────────────────────────────────────────────────
  const statusColor = JOB_STATUS_COLOR[job.status] ?? "text-muted-foreground";
  const header = (
    <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
      <span className="flex items-center gap-2 text-sm font-semibold">
        <span className={cn("w-2 h-2 rounded-full inline-block",
          job.status === "pending_rates" ? "bg-amber-500" :
          job.status === "awaiting_approval" ? "bg-blue-400" :
          job.status === "approved" ? "bg-green-400" :
          job.status === "activated" ? "bg-emerald-400" :
          job.status === "rejected" ? "bg-red-400/70" : "bg-muted-foreground/40")} />
        <span className="font-mono">{job.jobRef}</span>
        <span className={cn("text-xs font-normal", statusColor)}>{JOB_STATUS_LABEL[job.status] ?? job.status}</span>
      </span>
      <button onClick={onClose} className="text-muted-foreground hover:text-foreground" data-testid="btn-close-job-drawer"><X className="w-4 h-4" /></button>
    </div>
  );

  // ── Lifecycle stepper (shown for all jobs with at least awaiting_approval) ────
  const LIFECYCLE = [
    { key: "pending_rates",    label: "Pending Rates",    ts: job.createdAt,                by: job.createdBy },
    { key: "awaiting_approval",label: "Awaiting Approval",ts: job.submittedForApprovalAt,   by: job.submittedBy },
    { key: "approved",         label: "Approved",         ts: job.approvedAt,               by: job.approvedBy },
    { key: "activated",        label: "Activated",        ts: job.sheetGeneratedAt,         by: "system" },
  ];
  const LIFECYCLE_ORDER = ["pending_rates","awaiting_approval","approved","activated"];
  const currentStepIdx = job.status === "rejected"
    ? LIFECYCLE_ORDER.indexOf("awaiting_approval")
    : LIFECYCLE_ORDER.indexOf(job.status);
  const showLifecycleStepper = ["awaiting_approval","approved","activated","rejected"].includes(job.status);

  const lifecycleStepper = showLifecycleStepper ? (
    <div className="flex items-center gap-0 mt-1 mb-2">
      {LIFECYCLE.map((step, i) => {
        const done = i < currentStepIdx || (i === currentStepIdx && job.status !== "rejected");
        const active = i === currentStepIdx;
        const rejected = job.status === "rejected" && i === currentStepIdx;
        return (
          <div key={step.key} className="flex items-center flex-1 min-w-0">
            <div className="flex flex-col items-center min-w-0">
              <div className={cn("w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0",
                rejected ? "bg-red-400/20 text-red-400 ring-1 ring-red-400/40" :
                done     ? "bg-green-500/20 text-green-400 ring-1 ring-green-500/40" :
                active   ? "bg-blue-500/20 text-blue-400 ring-1 ring-blue-400/40" :
                           "bg-muted/30 text-muted-foreground/40 ring-1 ring-border/30")}>
                {rejected ? "✗" : done ? "✓" : i + 1}
              </div>
              <div className={cn("text-[9px] text-center mt-0.5 leading-tight max-w-[60px]",
                done ? "text-green-400/70" : active ? "text-blue-400/70" : "text-muted-foreground/30")}>
                {step.label}
              </div>
              {done && step.ts && (
                <div className="text-[8px] text-muted-foreground/50 text-center max-w-[60px] leading-tight">
                  {fmtDateTime(step.ts)}
                  {step.by && <div>{step.by}</div>}
                </div>
              )}
            </div>
            {i < LIFECYCLE.length - 1 && (
              <div className={cn("h-px flex-1 mx-1 flex-shrink", done ? "bg-green-500/30" : "bg-border/20")} />
            )}
          </div>
        );
      })}
    </div>
  ) : null;

  // ── Shared meta row ───────────────────────────────────────────────────────────
  const metaRow = (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
      <span><span className="text-muted-foreground">Client:</span> <strong>{job.clientName}</strong></span>
      <span><span className="text-muted-foreground">Product:</span> <strong>{job.productName || "—"}</strong></span>
    </div>
  );

  // ── BRANCH: pending_rates ─────────────────────────────────────────────────────
  if (job.status === "pending_rates") {
    return (
      <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-4">
        <div className="bg-background border border-border rounded-lg w-full max-w-lg shadow-xl">
          {header}
          <div className="px-4 py-4 flex flex-col gap-3">
            {metaRow}
            {job.templateId ? (
              <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 px-4 py-3 text-sm text-blue-300">
                <p className="font-medium mb-1">Template linked — ready to submit for approval.</p>
                <p className="text-xs text-blue-400/70">A manager will review and approve before the rate sheet is sent to the client.</p>
              </div>
            ) : (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-300">
                <p className="font-medium mb-1">No rate notification template linked yet.</p>
                <p className="text-xs text-amber-400/70">Create a template first, then submit for approval.</p>
              </div>
            )}
            <div className="flex gap-2 mt-1">
              {job.templateId ? (
                <button onClick={() => submitMut.mutate()} disabled={submitMut.isPending}
                  className="flex-1 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-3 py-2 rounded transition-colors font-medium"
                  data-testid="btn-submit-approval">
                  {submitMut.isPending ? "Submitting…" : "Submit for Approval"}
                </button>
              ) : (
                <button onClick={() => { onClose(); onNavigateToTemplates?.(job.clientName, job.productId ?? undefined); }}
                  className="flex-1 text-xs bg-amber-600 hover:bg-amber-500 text-white px-3 py-2 rounded transition-colors font-medium"
                  data-testid="btn-create-template-from-job">
                  Create Template
                </button>
              )}
              <button onClick={() => dismissMut.mutate()} disabled={dismissMut.isPending}
                className="text-xs border border-border/50 text-muted-foreground hover:text-foreground px-3 py-2 rounded transition-colors"
                data-testid="btn-dismiss-pending-job">
                Dismiss
              </button>
            </div>
            <div className="text-[10px] text-muted-foreground">{fmtDate(job.createdAt)} · auto-created on product assignment</div>
          </div>
        </div>
      </div>
    );
  }

  // ── BRANCH: awaiting_approval ─────────────────────────────────────────────────
  if (job.status === "awaiting_approval") {
    return (
      <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-4">
        <div className="bg-background border border-border rounded-lg w-full max-w-lg shadow-xl max-h-[90vh] overflow-y-auto">
          {header}
          <div className="px-4 py-4 flex flex-col gap-3">
            {lifecycleStepper}
            {/* Manager summary card */}
            <div className="rounded-lg border border-border/40 bg-muted/10 px-4 py-3 text-xs flex flex-col gap-1.5">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-1">Approval Summary</div>
              <div className="flex flex-wrap gap-x-6 gap-y-1">
                <span><span className="text-muted-foreground">Client:</span> <strong>{job.clientName}</strong></span>
                <span><span className="text-muted-foreground">Product:</span> <strong>{job.productName || "—"}</strong></span>
                <span><span className="text-muted-foreground">Destinations:</span> <strong>{job.destinationCount ?? 0}</strong></span>
                <span><span className="text-muted-foreground">Type:</span> <strong>{NOTIF_TYPE_LABEL[job.notificationType ?? ""] ?? job.notificationType ?? "—"}</strong></span>
              </div>
              <div className="mt-1 text-[10px] text-muted-foreground">
                Submitted {fmtDateTime(job.submittedForApprovalAt)} by <strong>{job.submittedBy || "—"}</strong>
              </div>
            </div>
            {isManagement ? (
              <>
                {!showReject ? (
                  <div className="flex gap-2">
                    <button onClick={() => approveMut.mutate()} disabled={approveMut.isPending}
                      className="flex-1 text-xs bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white px-3 py-2 rounded transition-colors font-medium"
                      data-testid="btn-approve-job">
                      {approveMut.isPending ? "Approving…" : "✓ Approve"}
                    </button>
                    <button onClick={() => setShowReject(true)}
                      className="flex-1 text-xs border border-red-400/30 text-red-400 hover:bg-red-400/10 px-3 py-2 rounded transition-colors"
                      data-testid="btn-show-reject">
                      ✗ Reject
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)}
                      placeholder="Rejection reason (required)…" rows={3}
                      className="text-xs w-full bg-background border border-red-400/30 rounded px-3 py-2 text-foreground placeholder:text-muted-foreground/50 resize-none focus:outline-none focus:ring-1 focus:ring-red-400/40"
                      data-testid="input-rejection-reason" />
                    <div className="flex gap-2">
                      <button onClick={() => rejectMut.mutate()} disabled={rejectMut.isPending || !rejectReason.trim()}
                        className="flex-1 text-xs bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white px-3 py-2 rounded transition-colors font-medium"
                        data-testid="btn-confirm-reject">
                        {rejectMut.isPending ? "Rejecting…" : "Confirm Rejection"}
                      </button>
                      <button onClick={() => { setShowReject(false); setRejectReason(""); }}
                        className="text-xs border border-border/50 text-muted-foreground hover:text-foreground px-3 py-2 rounded transition-colors">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-xs text-muted-foreground text-center py-2 border border-border/20 rounded bg-muted/10">
                Waiting for manager approval
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── BRANCH: rejected ──────────────────────────────────────────────────────────
  if (job.status === "rejected") {
    return (
      <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-4">
        <div className="bg-background border border-border rounded-lg w-full max-w-lg shadow-xl">
          {header}
          <div className="px-4 py-4 flex flex-col gap-3">
            {lifecycleStepper}
            {metaRow}
            <div className="rounded-lg border border-red-400/30 bg-red-400/5 px-4 py-3 text-sm">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Rejection Reason</p>
              <p className="text-red-300 text-xs">{job.rejectionReason || "—"}</p>
              <p className="text-[10px] text-muted-foreground mt-2">
                Rejected {fmtDateTime(job.rejectedAt)} by <strong>{job.rejectedBy || "—"}</strong>
              </p>
            </div>
            <p className="text-[10px] text-muted-foreground">
              To resubmit, create a new template or update the existing one and submit a new job.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── BRANCH: normal (approved / activated / successful / failed / partial) ─────
  const steps = [
    { key: "sheetGenerated",   label: "Sheet Generated",       value: job.sheetGenerated },
    { key: "emailSent",        label: "Email Sent",            value: job.emailSent },
    { key: "sbcMappingOk",     label: "SBC Mapping Available", value: job.sbcMappingOk },
    { key: "sbcUpdated",       label: "SBC Updated",           value: job.sbcUpdated },
    { key: "tariffUpdated",    label: "Rates Updated in Sippy",        value: job.tariffUpdated },
    { key: "violatedRules",    label: "Violated Rules",        value: job.violatedRules,    warn: true },
    { key: "approvalRequired", label: "Approval Required",     value: job.approvalRequired, warn: true },
    { key: "successful",       label: "Successful",            value: job.status === "successful" || job.status === "activated" },
  ];
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-background border border-border rounded-lg w-full max-w-lg shadow-xl max-h-[90vh] overflow-y-auto">
        {header}
        <div className="px-4 py-3 flex flex-col gap-3">
          {lifecycleStepper}
          <div className="flex flex-wrap gap-4 text-xs">
            <span><span className="text-muted-foreground">Client:</span> <strong>{job.clientName}</strong></span>
            <span><span className="text-muted-foreground">Product:</span> <strong>{job.productName || "—"}</strong></span>
            <span><span className="text-muted-foreground">Type:</span> <strong>{NOTIF_TYPE_LABEL[job.notificationType ?? ""] ?? job.notificationType ?? "—"}</strong></span>
            <span><span className="text-muted-foreground">Destinations:</span> <strong>{job.destinationCount ?? 0}</strong></span>
          </div>
          {job.status === "approved" && (
            <div className="rounded-lg border border-green-500/30 bg-green-500/5 px-3 py-2 text-xs text-green-300">
              Approved by <strong>{job.approvedBy}</strong> on {fmtDateTime(job.approvedAt)} — ready to send.
            </div>
          )}
          <div className="grid grid-cols-3 gap-2">
            {steps.map(s => (
              <div key={s.key} className={cn(
                "flex items-center gap-2 text-xs px-3 py-2 rounded border",
                s.value
                  ? s.warn ? "border-red-400/30 bg-red-400/5 text-red-400" : "border-green-500/30 bg-green-500/5 text-green-400"
                  : "border-border/30 bg-muted/20 text-muted-foreground",
              )}>
                {s.value
                  ? s.warn ? <AlertTriangle className="w-3 h-3" /> : <CircleCheck className="w-3 h-3" />
                  : <CircleX className="w-3 h-3 opacity-40" />}
                {s.label}
              </div>
            ))}
          </div>
          {job.remarks && (
            <div className="text-xs text-muted-foreground bg-muted/20 rounded px-3 py-2 border border-border/30">
              {job.remarks}
            </div>
          )}
          {job.pushResults && job.pushResults.length > 0 && (
            <div className="max-h-40 overflow-auto">
              <div className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wide">Push Results</div>
              {job.pushResults.map((r: any, i: number) => (
                <div key={i} className={cn("text-xs flex items-center gap-2 py-1 border-b border-border/20",
                  r.success ? "text-green-400" : "text-red-400")}>
                  {r.success ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                  <span className="font-mono">{displayPrefix(r.prefix)}</span>
                  <span className="text-muted-foreground">{r.dest}</span>
                  {!r.success && <span className="ml-auto text-[10px]">{r.message}</span>}
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-col gap-1 text-[10px] text-muted-foreground border-t border-border/20 pt-2 mt-1">
            <div className="flex flex-wrap gap-x-4 gap-y-0.5">
              <span>{fmtDate(job.createdAt)} · by {job.createdBy || "system"}</span>
              {job.templateVersion && (
                <span><span className="opacity-60">Template ver:</span> <span className="font-mono">{job.templateVersion}</span></span>
              )}
            </div>
            {job.generatedAttachmentHash && (
              <span>
                <span className="opacity-60">SHA-256:</span>{" "}
                <span className="font-mono">{job.generatedAttachmentHash.slice(0, 12)}…</span>
                {job.sheetGeneratedAt && (
                  <span className="ml-2 opacity-60">generated {new Date(job.sheetGeneratedAt).toLocaleTimeString()}</span>
                )}
              </span>
            )}
          </div>
          {job.sheetGenerated && (
            <div className="border-t border-border/20 pt-2 mt-1">
              <button onClick={handleReDownload} disabled={downloading} data-testid="btn-redownload-sheet"
                className="flex items-center gap-1.5 text-xs bg-blue-700/80 hover:bg-blue-600 disabled:opacity-50 text-white px-3 py-1.5 rounded transition-colors">
                {downloading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                Re-generate Sheet
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Notifications Tab ─────────────────────────────────────────────────────
function NotificationsTab({ products, initialSubTab, initialStatusFilter }: {
  products: Product[];
  initialSubTab?: "templates" | "jobs";
  initialStatusFilter?: string;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [subTab, setSubTab]             = useState<"templates" | "jobs">(initialSubTab ?? "templates");
  const [selectedTpl, setSelectedTpl]   = useState<RnTemplate | null>(null);
  const [showNewTpl, setShowNewTpl]     = useState(false);
  const [selectedJob, setSelectedJob]   = useState<RnJob | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>(initialStatusFilter ?? "");

  const { data: templates = [], isLoading: tplLoading } = useQuery<RnTemplate[]>({
    queryKey: ["/api/rate-notification-templates"],
  });
  const { data: jobs = [], isLoading: jobsLoading } = useQuery<RnJob[]>({
    queryKey: ["/api/rate-notification-jobs"],
  });

  const filteredJobs = statusFilter
    ? jobs.filter(j => j.status === statusFilter)
    : jobs;

  const deleteTplMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/rate-notification-templates/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/rate-notification-templates"] });
      toast({ title: "Template deleted" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // If a template is selected, show its detail panel
  if (selectedTpl) {
    return (
      <TemplateDetail
        tpl={selectedTpl}
        products={products}
        onBack={() => setSelectedTpl(null)}
      />
    );
  }

  // ── Lifecycle counts for card strip ──────────────────────────────────────────
  const opsCards: { status: string; label: string; color: string; bg: string; border: string }[] = [
    { status: "pending_rates",    label: "Pending Rates",    color: "text-amber-400",      bg: "bg-amber-500/5",   border: "border-amber-500/25" },
    { status: "awaiting_approval",label: "Awaiting Approval",color: "text-blue-400",       bg: "bg-blue-500/5",    border: "border-blue-400/25"  },
    { status: "approved",         label: "Approved",         color: "text-green-400",      bg: "bg-green-500/5",   border: "border-green-500/25" },
    { status: "activated",        label: "Activated",        color: "text-emerald-400",    bg: "bg-emerald-500/5", border: "border-emerald-500/25"},
    { status: "rejected",         label: "Rejected",         color: "text-red-400/70",     bg: "bg-red-400/5",     border: "border-red-400/20"   },
  ];

  return (
    <div className="flex-1 overflow-auto">
      {/* Initial Rate Operations card strip */}
      {subTab === "jobs" && (
        <div className="flex gap-2 px-4 pt-3 pb-1 flex-wrap">
          {opsCards.map(card => {
            const count = jobs.filter(j => j.status === card.status).length;
            const isActive = statusFilter === card.status;
            return (
              <button key={card.status}
                onClick={() => setStatusFilter(isActive ? "" : card.status)}
                data-testid={`card-ops-${card.status}`}
                className={cn(
                  "flex flex-col items-start px-3 py-2 rounded border text-left transition-all min-w-[90px] flex-1",
                  card.bg, card.border,
                  isActive ? "ring-1 ring-offset-0 opacity-100 " + card.color.replace("text-", "ring-") : "opacity-70 hover:opacity-100",
                )}>
                <span className={cn("text-xl font-bold tabular-nums leading-none", card.color)}>{count}</span>
                <span className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{card.label}</span>
              </button>
            );
          })}
        </div>
      )}
      {/* Sub-tab bar */}
      <div className="flex items-center border-b border-border/40 px-4 gap-1">
        {(["templates", "jobs"] as const).map(tab => (
          <button key={tab} onClick={() => setSubTab(tab)} data-testid={`btn-subtab-${tab}`}
            className={cn(
              "text-xs px-3 py-2.5 border-b-2 transition-colors capitalize",
              subTab === tab
                ? "border-amber-400 text-amber-400 font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}>
            {tab === "templates" ? "Templates" : (
              <span className="flex items-center gap-1.5">
                Jobs{jobs.length ? ` (${filteredJobs.length}${statusFilter ? `/${jobs.length}` : ""})` : ""}
                {(() => { const pr = jobs.filter(j => j.status === "pending_rates").length; return pr > 0 ? (
                  <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-500 text-black text-[9px] font-bold leading-none">
                    {pr}
                  </span>
                ) : null; })()}
              </span>
            )}
          </button>
        ))}
        <div className="ml-auto py-1.5 flex items-center gap-2">
          {subTab === "jobs" && statusFilter && (
            <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400">
              Filter: {statusFilter}
              <button onClick={() => setStatusFilter("")} data-testid="btn-clear-job-filter"
                className="ml-0.5 hover:text-white transition-colors">
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          )}
          {subTab === "templates" && (
            <button onClick={() => setShowNewTpl(true)} data-testid="btn-new-template"
              className="flex items-center gap-1 text-xs bg-amber-600 hover:bg-amber-500 text-white px-2.5 py-1 rounded transition-colors">
              <Plus className="w-3 h-3" /> New Template
            </button>
          )}
        </div>
      </div>

      <div className="p-4">
        {/* ── Templates list ── */}
        {subTab === "templates" && (
          tplLoading ? (
            <div className="flex items-center gap-2 justify-center py-12 text-xs text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading templates…
            </div>
          ) : templates.length === 0 ? (
            <div className="text-center py-16 text-xs text-muted-foreground border border-dashed border-border/40 rounded-lg">
              <BellRing className="w-8 h-8 mx-auto mb-2 opacity-20" />
              <p>No templates yet.</p>
              <p className="mt-1">Click <strong>New Template</strong> to create a Rate Notification.</p>
            </div>
          ) : (
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-border/60 bg-muted/30 backdrop-blur">
                  {["Client", "Product", "Type", "Recipients", "Status", "Created", ""].map(h => (
                    <th key={h} className="text-left py-2 px-3 font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => {
                  const typeLabel = NOTIF_TYPE_LABEL[t.notificationType] ?? (t.notificationType ?? '').toUpperCase();
                  const productName = products.find(p => p.id === t.productId)?.name ?? t.productName ?? `product-${t.productId}`;
                  return (
                    <tr key={t.id} className="border-b border-border/20 hover:bg-muted/10 cursor-pointer"
                      data-testid={`row-tpl-${t.id}`}
                      onClick={() => setSelectedTpl(t)}>
                      <td className="py-2 px-3 font-medium">{t.clientName}</td>
                      <td className="py-2 px-3 text-amber-400">{productName}</td>
                      <td className="py-2 px-3">
                        <span className={cn("text-[10px] px-1.5 py-0.5 rounded border font-medium",
                          typeLabel === "FULL"    ? "border-blue-400/40 text-blue-400"
                          : typeLabel === "CHANGES" ? "border-amber-400/40 text-amber-400"
                          : "border-border/50 text-muted-foreground"
                        )}>{typeLabel}</span>
                      </td>
                      <td className="py-2 px-3 text-muted-foreground truncate max-w-xs">{t.recipients || "—"}</td>
                      <td className="py-2 px-3">
                        <span className={cn("text-[10px] capitalize",
                          t.status === "active" ? "text-green-400" : "text-muted-foreground")}>
                          {t.status}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-muted-foreground whitespace-nowrap">{fmtDate(t.createdAt)}</td>
                      <td className="py-2 px-3" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-2">
                          <button onClick={() => setSelectedTpl(t)} data-testid={`btn-edit-tpl-${t.id}`}
                            className="text-muted-foreground hover:text-foreground transition-colors">
                            <Pencil className="w-3 h-3" />
                          </button>
                          <button onClick={() => deleteTplMut.mutate(t.id)} data-testid={`btn-del-tpl-${t.id}`}
                            className="text-muted-foreground hover:text-red-400 transition-colors">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        )}

        {/* ── Jobs list ── */}
        {subTab === "jobs" && (() => {
          return (
            <>
              {/* Filter chips */}
              <div className="flex items-center gap-1.5 mb-3 flex-wrap">
                <button onClick={() => setStatusFilter("")} data-testid="btn-filter-all"
                  className={cn("text-[11px] px-2.5 py-1 rounded-full border transition-colors",
                    statusFilter === "" ? "border-amber-500 bg-amber-500/10 text-amber-400" : "border-border/40 text-muted-foreground hover:border-border")}>
                  All ({jobs.length})
                </button>
                {[
                  { status: "pending_rates",    label: "Pending Rates" },
                  { status: "awaiting_approval",label: "Awaiting Approval" },
                  { status: "approved",         label: "Approved" },
                  { status: "activated",        label: "Activated" },
                  { status: "rejected",         label: "Rejected" },
                ].map(({ status, label }) => {
                  const cnt = jobs.filter(j => j.status === status).length;
                  if (cnt === 0 && statusFilter !== status) return null;
                  return (
                    <button key={status} onClick={() => setStatusFilter(statusFilter === status ? "" : status)}
                      data-testid={`btn-filter-${status}`}
                      className={cn("text-[11px] px-2.5 py-1 rounded-full border transition-colors flex items-center gap-1",
                        statusFilter === status
                          ? "border-amber-500 bg-amber-500/10 text-amber-400"
                          : "border-border/40 text-muted-foreground hover:border-border")}>
                      {label}
                      {cnt > 0 && (
                        <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-muted/60 text-[8px] font-bold text-muted-foreground">
                          {cnt}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              {jobsLoading ? (
                <div className="flex items-center gap-2 justify-center py-12 text-xs text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading jobs…
                </div>
              ) : filteredJobs.length === 0 ? (
                <div className="text-center py-16 text-xs text-muted-foreground border border-dashed border-border/40 rounded-lg">
                  <Clock className="w-8 h-8 mx-auto mb-2 opacity-20" />
                  <p>{statusFilter === "pending_rates" ? "No clients awaiting initial rate setup." : statusFilter ? `No jobs with status "${statusFilter}".` : "No jobs yet. Send a notification from a template to create a job."}</p>
                  {statusFilter && <button onClick={() => setStatusFilter("")} className="mt-2 text-amber-400 hover:underline text-xs">Clear filter</button>}
                </div>
              ) : (
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-border/60 bg-muted/30 backdrop-blur">
                      {["Job Ref", "Client", "Product", "Type", "Dests", "Email", "Sippy", "Status", "Created"].map(h => (
                        <th key={h} className="text-left py-2 px-3 font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredJobs.map((j) => (
                      <tr key={j.id}
                        className={cn("border-b border-border/20 hover:bg-muted/10 cursor-pointer",
                          j.status === "pending_rates" && "bg-amber-500/[0.03]")}
                        data-testid={`row-job-${j.id}`}
                        onClick={() => setSelectedJob(j)}>
                        <td className="py-2 px-3 font-mono text-muted-foreground">{j.jobRef}</td>
                        <td className="py-2 px-3 font-medium">{j.clientName}</td>
                        <td className="py-2 px-3"><span className="inline-flex items-center gap-1 text-[11px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-full px-2 py-0.5">{j.productName || "—"}</span></td>
                        <td className="py-2 px-3 text-muted-foreground">{j.status === "pending_rates" ? "—" : (NOTIF_TYPE_LABEL[j.notificationType ?? ""] ?? j.notificationType ?? "—")}</td>
                        <td className="py-2 px-3 tabular-nums">{j.destinationCount ?? 0}</td>
                        <td className="py-2 px-3">
                          {j.status === "pending_rates"
                            ? <span className="text-muted-foreground/30">—</span>
                            : j.emailSent
                              ? <CircleCheck className="w-3.5 h-3.5 text-green-400" />
                              : <CircleX className="w-3.5 h-3.5 text-muted-foreground/40" />}
                        </td>
                        <td className="py-2 px-3">
                          {j.status === "pending_rates"
                            ? <span className="text-muted-foreground/30">—</span>
                            : j.tariffUpdated
                              ? <CircleCheck className="w-3.5 h-3.5 text-green-400" />
                              : <CircleX className="w-3.5 h-3.5 text-muted-foreground/40" />}
                        </td>
                        <td className="py-2 px-3">
                          {JOB_STATUS_LABEL[j.status] ?? j.status}
                        </td>
                        <td className="py-2 px-3 text-muted-foreground whitespace-nowrap">{fmtDate(j.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          );
        })()}
      </div>

      {showNewTpl && (
        <NewTemplateModal
          products={products}
          onClose={() => setShowNewTpl(false)}
          onSaved={(t) => {
            setShowNewTpl(false);
            qc.invalidateQueries({ queryKey: ["/api/rate-notification-templates"] });
            setSelectedTpl(t);
          }}
        />
      )}

      {selectedJob && (
        <JobDetailDrawer
          job={selectedJob}
          onClose={() => setSelectedJob(null)}
          onNavigateToTemplates={(_clientName, _productId) => {
            setSelectedJob(null);
            setSubTab("templates");
            setShowNewTpl(true);
          }}
        />
      )}
    </div>
  );
}

// ── Pricing Intelligence Tab ──────────────────────────────────────────────────
function PricingIntelligenceTab({ products }: { products: Product[] }) {
  const [selectedProductId, setSelectedProductId] = useState<string>("");

  const { data, isLoading, refetch } = useQuery<{ recommendations: any[]; generatedAt: string }>({
    queryKey: ["/api/pricing-intelligence", selectedProductId],
    queryFn: () => fetch(`/api/pricing-intelligence${selectedProductId ? `?productId=${selectedProductId}` : ""}`).then(r => r.json()),
  });

  const PRIORITY_CONFIG = {
    high:   { color: "text-red-400",    bg: "bg-red-400/10",   icon: TrendingUp,   label: "High Priority"   },
    medium: { color: "text-amber-400",  bg: "bg-amber-400/10", icon: TrendingDown, label: "Medium Priority" },
    low:    { color: "text-green-400",  bg: "bg-green-400/10", icon: Lightbulb,    label: "Low Priority"    },
  };

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Sidebar */}
      <div className="w-48 shrink-0 border-r border-border/50 flex flex-col gap-0 overflow-y-auto py-2">
        <div className="px-3 py-1.5 text-[10px] font-semibold uppercase text-muted-foreground tracking-wider">Filter Product</div>
        <button
          onClick={() => setSelectedProductId("")}
          className={cn(
            "text-left px-3 py-2 text-xs border-l-2 transition-colors",
            !selectedProductId ? "border-primary bg-muted/30 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/10",
          )}
          data-testid="product-intel-all"
        >
          All Products
        </button>
        {products.map(p => (
          <button
            key={p.id}
            onClick={() => setSelectedProductId(String(p.id))}
            data-testid={`product-intel-${p.id}`}
            className={cn(
              "text-left px-3 py-2 text-xs flex items-center gap-2 border-l-2 transition-colors",
              selectedProductId === String(p.id) ? "border-primary bg-muted/30 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/10",
            )}
          >
            <span className="truncate">{p.name}</span>
          </button>
        ))}
      </div>

      {/* Main */}
      <div className="flex-1 overflow-auto p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm font-semibold flex items-center gap-2">
            <Lightbulb className="w-4 h-4 text-yellow-400" />
            Pricing Intelligence
          </div>
          <button onClick={() => refetch()} data-testid="btn-refresh-intel"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1">
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 justify-center py-12 text-xs text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Analysing…</div>
        ) : !data?.recommendations?.length ? (
          <div className="text-center text-xs text-muted-foreground py-12">No commercial products found — activate products in the Product Registry first</div>
        ) : (
          <div className="flex flex-col gap-3">
            {data.generatedAt && (
              <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                <Calendar className="w-3 h-3" /> Generated {new Date(data.generatedAt).toLocaleString()}
              </div>
            )}
            {data.recommendations.map((rec: any) => {
              const cfg = PRIORITY_CONFIG[rec.priority as keyof typeof PRIORITY_CONFIG] ?? PRIORITY_CONFIG.low;
              const Icon = cfg.icon;
              return (
                <div key={rec.productId} data-testid={`intel-card-${rec.productId}`}
                  className={cn("border border-border/40 rounded-md p-3 flex flex-col gap-2", cfg.bg)}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Icon className={cn("w-3.5 h-3.5 shrink-0", cfg.color)} />
                      <span className="text-xs font-medium">{rec.productName}</span>
                      <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded", cfg.color, cfg.bg)}>{cfg.label}</span>
                    </div>
                    <div className="flex gap-4 text-[10px] text-muted-foreground shrink-0">
                      <span>{rec.rateCount} rate{rec.rateCount !== 1 ? 's' : ''}</span>
                      <span>{rec.customerCount} customer{rec.customerCount !== 1 ? 's' : ''}</span>
                      {rec.avgRate !== null && (
                        <span className="font-mono">${Number(rec.avgRate).toFixed(6)}/min avg</span>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{rec.recommendation}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}


// ── Main Page ──────────────────────────────────────────────────────────────────
export default function RateManagerPage() {
  const qc = useQueryClient();
  const searchStr = useSearch();
  const searchParams = new URLSearchParams(searchStr);
  const urlTab = searchParams.get("tab") as "analysis" | "send" | "jobs" | "product-rates" | "notifications" | "intelligence" | null;
  const urlSubTab = searchParams.get("subtab") as "templates" | "jobs" | null;
  const urlStatusFilter = searchParams.get("statusFilter") ?? "";

  const [activeTab, setActiveTab] = useState<"analysis" | "send" | "jobs" | "product-rates" | "notifications" | "intelligence">(
    urlTab ?? "analysis"
  );

  const { data: products = [], isLoading: prodLoading } = useQuery<Product[]>({
    queryKey: ["/api/rate-manager/products"],
  });

  // Use selected product from products list to filter clients
  const [activeProductId, setActiveProductId] = useState<string>("");
  const { data: accountsData, isLoading: acctLoading } = useQuery<{
    accounts: SippyAccount[]; error?: string; productName?: string;
  }>({
    queryKey: ["/api/sippy/accounts-by-product", activeProductId],
    enabled: !!activeProductId,
  });
  const accounts = accountsData?.accounts ?? [];

  const { data: destsData } = useQuery<{ destinations?: DestNode[]; items?: DestNode[] } | DestNode[]>({
    queryKey: ["/api/product-registry/destinations"],
  });
  const allDests: DestNode[] = useMemo(() => {
    if (!destsData) return [];
    if (Array.isArray(destsData)) return destsData;
    return (destsData as any).destinations ?? (destsData as any).items ?? [];
  }, [destsData]);

  const isLoading = prodLoading || acctLoading;

  const { data: kpiStats } = useQuery<any>({
    queryKey: ["/api/rate-manager/kpi"],
    queryFn: () => fetch("/api/rate-manager/kpi").then(r => r.ok ? r.json() : null).catch(() => null),
    staleTime: 60_000,
  });
  const TABS = [
    { key: "analysis"      as const, label: "Rate Analysis"   },
    { key: "send"          as const, label: "Send Rate"        },
    { key: "jobs"          as const, label: "Push History"     },
    { key: "product-rates" as const, label: "Product Rates"   },
    { key: "notifications" as const, label: "Notifications"   },
    { key: "intelligence"  as const, label: "Intelligence"    },
  ];

  return (
    <div className="h-full flex flex-col bg-background overflow-hidden">
      {/* Top bar */}
      <div className="flex-shrink-0 border-b border-border bg-background/95 flex items-center gap-0 px-4 h-10">
        <div className="flex items-center gap-2 text-xs font-semibold mr-4 pr-4 border-r border-border/40">
          <BarChart2 className="w-3.5 h-3.5 text-blue-400" />
          Rate Manager
        </div>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={cn(
              "px-4 h-full text-xs font-medium border-b-2 transition-colors",
              activeTab === t.key
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
            data-testid={`tab-${t.key}`}
          >
            {t.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          {accountsData?.productName && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 flex items-center gap-1">
              <PackageCheck className="w-3 h-3" />
              {accountsData.productName}
              {accountsData.accounts.length > 0 && (
                <span className="ml-1 text-blue-300/70">{accountsData.accounts.length} clients</span>
              )}
            </span>
          )}
          {(activeTab === "analysis" || activeTab === "send") && activeProductId && accountsData && accountsData.accounts.length === 0 && !acctLoading && (
            <span className={`text-[10px] flex items-center gap-1 ${(accountsData as any).syncing ? 'text-blue-400' : 'text-amber-400'}`}>
              {(accountsData as any).syncing
                ? <><Loader2 className="w-3 h-3 animate-spin" />Syncing rate data…</>
                : <><AlertTriangle className="w-3 h-3" />No clients assigned to this product</>
              }
            </span>
          )}
          {(accountsData?.error) && (
            <span className="text-[10px] text-amber-400 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              {accountsData.error.length > 60 ? accountsData.error.slice(0, 60) + "…" : accountsData.error}
            </span>
          )}
          {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
        </div>
      </div>

      {/* KPI Strip */}
      <div className="flex-shrink-0 border-b border-border/20 bg-muted/3 px-5 py-2 flex items-center gap-3 overflow-x-auto">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-blue-500/20 bg-blue-500/8 shrink-0">
          <div>
            <div className="text-base font-bold tabular-nums leading-tight text-blue-400">{products.length || "—"}</div>
            <div className="text-[9px] text-muted-foreground uppercase tracking-wide leading-tight">Products</div>
          </div>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-green-500/20 bg-green-500/8 shrink-0">
          <div>
            <div className="text-base font-bold tabular-nums leading-tight text-green-400">
              {kpiStats?.totalClients != null ? kpiStats.totalClients : accounts.length > 0 ? accounts.length : "—"}
            </div>
            <div className="text-[9px] text-muted-foreground uppercase tracking-wide leading-tight">Active Clients</div>
          </div>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-purple-500/20 bg-purple-500/8 shrink-0">
          <div>
            <div className="text-base font-bold tabular-nums leading-tight text-purple-400">
              {kpiStats?.totalDestinations != null
                ? Number(kpiStats.totalDestinations).toLocaleString()
                : allDests.length > 0 ? allDests.length.toLocaleString() : "—"}
            </div>
            <div className="text-[9px] text-muted-foreground uppercase tracking-wide leading-tight">Destinations</div>
          </div>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-amber-500/20 bg-amber-500/8 shrink-0">
          <div>
            <div className="text-base font-bold tabular-nums leading-tight text-amber-400">
              {kpiStats?.totalCountries != null ? kpiStats.totalCountries : allDests.filter((d: DestNode) => d.level === 1).length || "—"}
            </div>
            <div className="text-[9px] text-muted-foreground uppercase tracking-wide leading-tight">Countries</div>
          </div>
        </div>
      </div>
      {/* Tab content */}
      {activeTab === "analysis"      && <AnalysisTab products={products} accounts={accounts} allDests={allDests} onProductChange={setActiveProductId} />}
      {activeTab === "send"          && <SendRateTab products={products} accounts={accounts} allDests={allDests} onProductChange={setActiveProductId} />}
      {activeTab === "jobs"          && <JobsTab />}
      {activeTab === "product-rates" && <ProductRatesTab products={products} />}
      {activeTab === "notifications" && <NotificationsTab products={products} initialSubTab={urlSubTab ?? undefined} initialStatusFilter={urlStatusFilter || undefined} />}
      {activeTab === "intelligence"  && <PricingIntelligenceTab products={products} />}
    </div>
  );
}

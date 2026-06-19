import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import {
  Loader2, User, ShieldCheck, CheckCircle2, AlertTriangle,
  Trash2, RefreshCw, ChevronRight, ChevronsUpDown,
} from "lucide-react";
import { PRODUCT_CLASSES } from "./products";

// ── Destination presets ───────────────────────────────────────────────────────
const DESTINATIONS = [
  { label: "Pakistan",     cc: "92",  keywords: ["pakistan","pk-","pk ","_pk"] },
  { label: "UK",           cc: "44",  keywords: ["uk","united kingdom","britain"," uk "] },
  { label: "Bangladesh",   cc: "880", keywords: ["bangladesh","bangla","_bd","bd-"] },
  { label: "India",        cc: "91",  keywords: ["india"," in ","_in-"] },
  { label: "UAE",          cc: "971", keywords: ["uae","emirates","dubai"] },
  { label: "USA / Canada", cc: "1",   keywords: ["usa","canada","nanp","us-"] },
  { label: "Afghanistan",  cc: "93",  keywords: ["afghan","afg"] },
  { label: "Saudi Arabia", cc: "966", keywords: ["saudi","ksa"] },
  { label: "Kenya",        cc: "254", keywords: ["kenya"] },
  { label: "Nigeria",      cc: "234", keywords: ["nigeria","nig"] },
  { label: "Custom",       cc: "",    keywords: [] },
] as const;

type Dest = (typeof DESTINATIONS)[number];

const ACTIVE_PRODUCTS = PRODUCT_CLASSES.filter(p => p.prefix !== "other");

// ── Formula builders ──────────────────────────────────────────────────────────
// All three fields derive from the same triple: {prefix}{productCode}{CC}
// e.g. prefix=2221, product=1, CC=92  →  combined = "2221192"
//   Incoming CLD wildcard : 2221192*
//   CLD translation rule  : s/^2221192/192/
//   Incoming CLI          : 2221192   (exact match, no wildcard)

function buildCombined(prefix: string, productCode: string, cc: string) {
  return `${prefix}${productCode}${cc}`;
}
function buildCldWildcard(prefix: string, productCode: string, cc: string) {
  return buildCombined(prefix, productCode, cc) + "*";
}
function buildCldRule(prefix: string, productCode: string, cc: string) {
  const c = buildCombined(prefix, productCode, cc);
  return `s/^${c}/${productCode}${cc}/`;
}
function buildCli(prefix: string, productCode: string, cc: string) {
  return buildCombined(prefix, productCode, cc);   // no wildcard
}

// Parse prefix + product code from an existing CLD translation rule.
// Accepts 3-7 digit prefixes so it works with various client configs.
// e.g. "s/^2221192/192/"  →  { prefix: "2221", productCode: "1" }
function parseCldRule(rule: string): { prefix: string; productCode: string } {
  if (!rule) return { prefix: "", productCode: "" };
  // Format: s/^{prefix}{productCode}{digits}/{productCode}{digits}/
  const m = rule.match(/^s\/\^(\d{3,7})([1267])\d/);
  if (m) return { prefix: m[1].slice(0, 4), productCode: m[2] };
  // Fallback: grab first 4+ digits after s/^
  const m2 = rule.match(/^s\/\^(\d{4,8})/);
  if (m2) return { prefix: m2[1].slice(0, 4), productCode: "" };
  return { prefix: "", productCode: "" };
}

// Regenerate all three formula fields at once.
// Returns null when formula is incomplete (prefix < 4 digits or no destination).
function regenAll(prefix: string, productCode: string, dest: Dest | null) {
  if (prefix.length < 4 || !dest || dest.label === "Custom" || !dest.cc) return null;
  return {
    cld:     buildCldWildcard(prefix, productCode, dest.cc),
    cldRule: buildCldRule(prefix, productCode, dest.cc),
    cli:     buildCli(prefix, productCode, dest.cc),
  };
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface Account {
  iAccount: number;
  username: string;
  balance: number;
  status: "healthy" | "warning" | "critical";
  currency: string;
  allowedIps: string[] | null | undefined;
  prefix: string | null;
}

interface RoutingGroup {
  iRoutingGroup: number;
  name: string;
}

interface AuthRule {
  iAuthentication: number;
  remoteIp?: string;
  incomingCld?: string;
  incomingCli?: string;
  cldTranslationRule?: string;
  cliTranslationRule?: string;
  iRoutingGroup?: number;
  maxSessions?: number;
  maxCps?: number;
}

function statusColor(s: string) {
  if (s === "critical") return "bg-red-500/20 text-red-400 border-red-500/30";
  if (s === "warning")  return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
  return "bg-green-500/20 text-green-400 border-green-500/30";
}

function filterRgsByDest(groups: RoutingGroup[], dest: Dest | null) {
  if (!dest || dest.label === "Custom") return groups;
  return groups.filter(g => dest.keywords.some(k => g.name.toLowerCase().includes(k)));
}

// ─────────────────────────────────────────────────────────────────────────────
export default function AuthStudioPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  // Account picker combobox
  const [acctOpen, setAcctOpen]         = useState(false);
  const [acctSearch, setAcctSearch]     = useState("");
  const [selectedAcct, setSelectedAcct] = useState<Account | null>(null);

  // Step selections
  const [selectedDest, setSelectedDest]   = useState<Dest | null>(null);
  const [selectedRgId, setSelectedRgId]   = useState<string>("");
  const [pushResult, setPushResult]       = useState<{ ok: boolean; msg: string } | null>(null);

  // Right-panel form fields
  const [fRemoteIp,    setFRemoteIp]    = useState("");
  const [fCld,         setFCld]         = useState("");
  const [fCldRule,     setFCldRule]     = useState("");
  const [fCli,         setFCli]         = useState("");   // incoming CLI = combined without wildcard
  const [fMaxSess,     setFMaxSess]     = useState("0");
  const [fMaxCps,      setFMaxCps]      = useState("0");
  const [fPrefix,      setFPrefix]      = useState("");
  const [fProductCode, setFProductCode] = useState("1");
  const [fMcEnabled,   setFMcEnabled]   = useState(false);
  const [fMcProductCode, setFMcProductCode] = useState("7");

  // Routing group combobox (Step ②)
  const [rgOpen, setRgOpen] = useState(false);

  // Inline routing-group editor on existing rules table
  const [editingRuleId, setEditingRuleId] = useState<number | null>(null);
  const [editingRgId,   setEditingRgId]   = useState<string>("");
  const [editingRgOpen, setEditingRgOpen] = useState(false);

  // ── Data fetching ─────────────────────────────────────────────────────────
  const { data: acctData, isLoading: loadingAccts } = useQuery<{ accounts: Account[] }>({
    queryKey: ["/api/sippy/accounts"],
  });
  const { data: rgData, isLoading: loadingRgs } = useQuery<{ groups: RoutingGroup[] }>({
    queryKey: ["/api/routing-cache/routing-groups"],
  });
  const { data: authData, isLoading: loadingAuth, refetch: refetchAuth } = useQuery<{ authRules: AuthRule[] }>({
    queryKey: ["/api/sippy/accounts", selectedAcct?.iAccount, "auth-rules"],
    enabled: !!selectedAcct,
  });

  // ── Derived ──────────────────────────────────────────────────────────────
  const accounts  = acctData?.accounts ?? [];
  const allRgs    = rgData?.groups ?? [];
  const authRules = authData?.authRules ?? [];

  const filteredAccts = useMemo(() =>
    accounts.filter(a =>
      !acctSearch ||
      a.username.toLowerCase().includes(acctSearch.toLowerCase()) ||
      String(a.iAccount).includes(acctSearch)
    ), [accounts, acctSearch]);

  const filteredRgs  = useMemo(() => filterRgsByDest(allRgs, selectedDest), [allRgs, selectedDest]);
  const selectedRg   = allRgs.find(g => String(g.iRoutingGroup) === selectedRgId) ?? null;

  const derivedIps: string[] = authRules.length > 0
    ? [...new Set(authRules.map(r => r.remoteIp).filter((ip): ip is string => !!ip))]
    : (selectedAcct?.allowedIps ?? []);

  // ── PRIMARY auto-generator ────────────────────────────────────────────────
  // Runs after EVERY change to fPrefix, fProductCode, or selectedDest.
  // This is the single source of truth for all three formula fields.
  useEffect(() => {
    const gen = regenAll(fPrefix, fProductCode, selectedDest);
    if (gen) {
      setFCld(gen.cld);
      setFCldRule(gen.cldRule);
      setFCli(gen.cli);
    } else {
      setFCld("");
      setFCldRule("");
      setFCli("");
    }
  }, [fPrefix, fProductCode, selectedDest]);

  // ── Auto-fill prefix + IP from auth rules when they load ─────────────────
  useEffect(() => {
    if (!authData?.authRules?.length) return;
    // Auto-fill Remote IP
    if (!fRemoteIp) {
      const ip = authData.authRules.find(r => r.remoteIp)?.remoteIp;
      if (ip) setFRemoteIp(ip);
    }
    // Auto-detect prefix + product code from client's existing CLD translation rule
    if (!fPrefix) {
      const ruleWithCld = authData.authRules.find(r => r.cldTranslationRule);
      if (ruleWithCld?.cldTranslationRule) {
        const { prefix, productCode } = parseCldRule(ruleWithCld.cldTranslationRule);
        if (prefix) setFPrefix(prefix);
        if (productCode) setFProductCode(productCode);
        // CLD fields will update automatically via the PRIMARY effect above
      }
    }
  }, [authData]);

  // ── Select account ────────────────────────────────────────────────────────
  function handleSelectAcct(acct: Account) {
    setSelectedAcct(acct);
    setAcctOpen(false);
    setAcctSearch("");
    setSelectedDest(null);
    setSelectedRgId("");
    setPushResult(null);
    setFRemoteIp((acct.allowedIps ?? [])[0] ?? "");
    setFCld(""); setFCldRule(""); setFCli("");
    setFMaxSess("0"); setFMaxCps("0");
    setFMcEnabled(false);
    setFPrefix(""); setFProductCode("1");
  }

  // ── Select destination — just update state, effect handles regen ──────────
  function handleSelectDest(destLabel: string) {
    const d = DESTINATIONS.find(x => x.label === destLabel) ?? null;
    setSelectedDest(d);
    setSelectedRgId("");
    setPushResult(null);
  }

  // ── Select product code — just update state, effect handles regen ─────────
  function handleSelectProduct(code: string) {
    setFProductCode(code);
  }

  // ── Prefix change — just update state, effect handles regen ──────────────
  function handlePrefixChange(val: string) {
    setFPrefix(val.replace(/\D/g, "").slice(0, 4));
  }

  // ── Push mutation ─────────────────────────────────────────────────────────
  const pushMut = useMutation({
    mutationFn: async () => {
      if (!selectedAcct) throw new Error("No account selected.");
      const body: Record<string, unknown> = {
        iProtocol: 1,
        ...(fRemoteIp  ? { remoteIp:          fRemoteIp  } : {}),
        ...(fCld       ? { incomingCld:        fCld       } : {}),
        ...(fCli       ? { incomingCli:        fCli       } : {}),
        ...(fCldRule   ? { cldTranslationRule: fCldRule   } : {}),
        ...(selectedRg ? { iRoutingGroup: selectedRg.iRoutingGroup } : {}),
        ...(fMaxSess && fMaxSess !== "0" ? { maxSessions: parseInt(fMaxSess, 10) } : {}),
        ...(fMaxCps  && fMaxCps  !== "0" ? { maxCps:      parseInt(fMaxCps,  10) } : {}),
      };
      const r = await apiRequest("POST", `/api/sippy/accounts/${selectedAcct.iAccount}/auth-rules`, body);
      const primary = await r.json();

      if (fMcEnabled && selectedDest?.cc && fPrefix) {
        const mcBody: Record<string, unknown> = {
          iProtocol: 1,
          ...(fRemoteIp  ? { remoteIp: fRemoteIp } : {}),
          incomingCld:        buildCldWildcard(fPrefix, fMcProductCode, selectedDest.cc),
          cldTranslationRule: buildCldRule(fPrefix, fMcProductCode, selectedDest.cc),
          ...(selectedRg ? { iRoutingGroup: selectedRg.iRoutingGroup } : {}),
          ...(fMaxSess && fMaxSess !== "0" ? { maxSessions: parseInt(fMaxSess, 10) } : {}),
          ...(fMaxCps  && fMaxCps  !== "0" ? { maxCps:      parseInt(fMaxCps,  10) } : {}),
        };
        await apiRequest("POST", `/api/sippy/accounts/${selectedAcct.iAccount}/auth-rules`, mcBody);
      }
      return primary;
    },
    onSuccess: (data: any) => {
      if (data.success) {
        const extra = fMcEnabled ? " + MC rule" : "";
        setPushResult({ ok: true, msg: `Auth rule created (id=${data.iAuthentication})${extra}` });
        toast({ title: "Auth rule pushed to Sippy" });
        qc.invalidateQueries({ queryKey: ["/api/sippy/accounts", selectedAcct?.iAccount, "auth-rules"] });
        refetchAuth();
      } else {
        setPushResult({ ok: false, msg: data.message ?? "Push failed." });
        toast({ variant: "destructive", title: "Push failed", description: data.message });
      }
    },
    onError: (e: any) => {
      setPushResult({ ok: false, msg: e.message });
      toast({ variant: "destructive", title: "Error", description: e.message });
    },
  });

  const delMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/sippy/auth-rules/${id}`).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Auth rule deleted" });
      qc.invalidateQueries({ queryKey: ["/api/sippy/accounts", selectedAcct?.iAccount, "auth-rules"] });
      refetchAuth();
    },
    onError: (e: any) => toast({ variant: "destructive", title: "Delete failed", description: e.message }),
  });

  const updateRgMut = useMutation({
    mutationFn: ({ iAuthentication, iRoutingGroup }: { iAuthentication: number; iRoutingGroup: number }) =>
      apiRequest("PATCH", `/api/sippy/auth-rules/${iAuthentication}`, { iRoutingGroup }).then(r => r.json()),
    onSuccess: (data: any) => {
      if (data.success === false) {
        toast({ variant: "destructive", title: "Update failed", description: data.message });
      } else {
        toast({ title: "Routing group updated" });
        setEditingRuleId(null);
        setEditingRgId("");
        qc.invalidateQueries({ queryKey: ["/api/sippy/accounts", selectedAcct?.iAccount, "auth-rules"] });
        refetchAuth();
      }
    },
    onError: (e: any) => toast({ variant: "destructive", title: "Update failed", description: e.message }),
  });

  const bulkUpdateRgMut = useMutation({
    mutationFn: async (iRoutingGroup: number) => {
      const results = await Promise.all(
        authRules.map(rule =>
          apiRequest("PATCH", `/api/sippy/auth-rules/${rule.iAuthentication}`, { iRoutingGroup }).then(r => r.json())
        )
      );
      return results as Array<{ success: boolean; message?: string }>;
    },
    onSuccess: (results) => {
      const failed = results.filter(r => r.success === false);
      if (failed.length > 0) {
        toast({ variant: "destructive", title: `${failed.length} rule(s) failed`, description: failed[0]?.message });
      } else {
        toast({ title: `Routing group applied to all ${results.length} rule(s)` });
      }
      qc.invalidateQueries({ queryKey: ["/api/sippy/accounts", selectedAcct?.iAccount, "auth-rules"] });
      refetchAuth();
    },
    onError: (e: any) => toast({ variant: "destructive", title: "Bulk update failed", description: e.message }),
  });

  const canPush = !!selectedAcct && (!!fRemoteIp || !!fCld) && !!fPrefix;

  const steps = [
    { label: "Client",        done: !!selectedAcct },
    { label: "Destination",   done: !!selectedDest  },
    { label: "Routing Group", done: !!selectedRgId  },
  ];

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">

      {/* ── Page header ── */}
      <div className="shrink-0 px-6 py-3 border-b border-border flex items-center gap-3">
        <ShieldCheck className="h-5 w-5 text-primary" />
        <div>
          <h1 className="text-base font-semibold leading-none">Auth Studio</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Client → Destination → Routing Group → Generate &amp; Push Auth Rule
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {steps.map((s, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
              <Badge variant="outline" className={s.done
                ? "border-green-500/40 bg-green-500/10 text-green-400 text-xs"
                : "border-border text-muted-foreground text-xs"}>
                {s.done && <CheckCircle2 className="h-3 w-3 mr-1" />}
                {s.label}
              </Badge>
            </span>
          ))}
        </div>
      </div>

      {/* ── Account picker + summary strip ── */}
      <div className="shrink-0 px-6 py-3 border-b border-border space-y-3">

        {/* Combobox dropdown */}
        <div className="flex items-center gap-3">
          <Label className="text-xs text-muted-foreground whitespace-nowrap shrink-0">Select Client</Label>
          <Popover open={acctOpen} onOpenChange={setAcctOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={acctOpen}
                className="flex-1 max-w-sm justify-between h-9 text-sm font-normal"
                data-testid="btn-open-acct-picker"
              >
                {selectedAcct
                  ? <span className="truncate">{selectedAcct.username} <span className="text-muted-foreground ml-1">#{selectedAcct.iAccount}</span></span>
                  : <span className="text-muted-foreground">Search and select account…</span>}
                {loadingAccts
                  ? <Loader2 className="ml-2 h-3.5 w-3.5 animate-spin shrink-0" />
                  : <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[420px] p-0" align="start">
              <Command>
                <CommandInput
                  placeholder="Search accounts…"
                  value={acctSearch}
                  onValueChange={setAcctSearch}
                  data-testid="input-acct-search"
                />
                <CommandList className="max-h-72">
                  <CommandEmpty>No accounts found.</CommandEmpty>
                  <CommandGroup>
                    {filteredAccts.map(a => (
                      <CommandItem
                        key={a.iAccount}
                        value={`${a.username} ${a.iAccount}`}
                        onSelect={() => handleSelectAcct(a)}
                        data-testid={`item-acct-${a.iAccount}`}
                        className="flex items-center justify-between cursor-pointer"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {selectedAcct?.iAccount === a.iAccount && <CheckCircle2 className="h-3.5 w-3.5 text-green-400 shrink-0" />}
                          <span className="font-medium truncate">{a.username}</span>
                          <span className="text-muted-foreground text-xs shrink-0">#{a.iAccount}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs text-muted-foreground">{a.currency} {a.balance?.toFixed(2)}</span>
                          <Badge variant="outline" className={`text-[10px] px-1 py-0 ${statusColor(a.status)}`}>
                            {a.status}
                          </Badge>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          {selectedAcct && (
            <button onClick={() => handleSelectAcct(selectedAcct)} className="text-xs text-muted-foreground hover:text-foreground">
              clear
            </button>
          )}
        </div>

        {/* Account summary strip */}
        {selectedAcct && (
          <div className="rounded-lg border border-border bg-card/60 px-4 py-2.5 flex flex-wrap gap-x-6 gap-y-1 text-xs">
            <div><span className="text-muted-foreground">Account </span>
              <span className="font-semibold">{selectedAcct.username}</span>
              <span className="text-muted-foreground ml-1">#{selectedAcct.iAccount}</span></div>
            <div><span className="text-muted-foreground">Balance </span>
              <span className="font-medium">{selectedAcct.currency} {selectedAcct.balance?.toFixed(4)}</span></div>
            <div>
              <span className="text-muted-foreground">Registered IP </span>
              {loadingAuth
                ? <span className="text-muted-foreground inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" />loading…</span>
                : derivedIps.length > 0
                  ? <span className="font-mono text-green-400">{derivedIps.join(", ")}</span>
                  : <span className="text-muted-foreground">None registered</span>}
            </div>
            {fPrefix && (
              <div><span className="text-muted-foreground">CLD Prefix </span>
                <span className="font-mono text-orange-400">{fPrefix}</span></div>
            )}
            {fProductCode && (
              <div><span className="text-muted-foreground">Product </span>
                <span className={ACTIVE_PRODUCTS.find(p => p.prefix === fProductCode)?.color ?? "text-foreground"}>
                  {ACTIVE_PRODUCTS.find(p => p.prefix === fProductCode)?.label ?? fProductCode}
                </span></div>
            )}
          </div>
        )}
      </div>

      {/* ── Main 2-panel body ── */}
      {!selectedAcct ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
          <User className="h-12 w-12 opacity-20" />
          <p className="text-sm">Select a client account above to begin</p>
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">

          {/* ══ CENTER ════════════════════════════════════════════════════════ */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4">

            {/* ① Destination */}
            <div className="rounded-lg border border-border bg-card p-4 space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">① Select Destination</p>
              <Select value={selectedDest?.label ?? ""} onValueChange={handleSelectDest}>
                <SelectTrigger className="h-9 text-sm" data-testid="sel-destination">
                  <SelectValue placeholder="Choose destination country…" />
                </SelectTrigger>
                <SelectContent>
                  {DESTINATIONS.map(d => (
                    <SelectItem key={d.label} value={d.label}>
                      {d.label}
                      {d.cc ? <span className="ml-2 text-muted-foreground text-xs">+{d.cc}</span> : null}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedDest && selectedDest.label !== "Custom" && selectedDest.cc && fPrefix && (
                <div className="flex gap-2 flex-wrap">
                  <Badge variant="secondary" className="text-xs font-mono">
                    CLD: {buildCldWildcard(fPrefix, fProductCode, selectedDest.cc)}
                  </Badge>
                  <Badge variant="secondary" className="text-xs font-mono">
                    Rule: {buildCldRule(fPrefix, fProductCode, selectedDest.cc)}
                  </Badge>
                  <Badge variant="outline" className="text-xs text-green-400 border-green-500/30">
                    {filteredRgs.length} routing group{filteredRgs.length !== 1 ? "s" : ""} matched
                  </Badge>
                </div>
              )}
              {selectedDest && !fPrefix && (
                <p className="text-[10px] text-amber-400">
                  ⚠ No prefix found in existing rules — enter it in the right panel to generate the CLD rule
                </p>
              )}
            </div>

            {/* ② Routing Group — always shown when account is selected */}
            {selectedAcct && (
              <div className="rounded-lg border border-border bg-card p-4 space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">② Select Routing Group</p>
                {loadingRgs ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
                  </div>
                ) : (
                  <>
                    <Popover open={rgOpen} onOpenChange={setRgOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          role="combobox"
                          aria-expanded={rgOpen}
                          className="w-full justify-between h-9 text-sm font-normal"
                          data-testid="sel-routing-group"
                        >
                          {selectedRg
                            ? <span className="truncate">{selectedRg.name}</span>
                            : <span className="text-muted-foreground">
                                {filteredRgs.length > 0
                                  ? `Choose from ${filteredRgs.length} matched group${filteredRgs.length !== 1 ? "s" : ""}…`
                                  : `Choose from ${allRgs.length} group${allRgs.length !== 1 ? "s" : ""}…`}
                              </span>}
                          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[320px] p-0" align="start">
                        <Command>
                          <CommandInput placeholder="Search routing group…" className="h-8 text-sm" />
                          <CommandList>
                            <CommandEmpty>No groups found.</CommandEmpty>
                            <CommandGroup>
                              {(filteredRgs.length > 0 ? filteredRgs : allRgs).map(g => (
                                <CommandItem
                                  key={g.iRoutingGroup}
                                  value={g.name}
                                  onSelect={() => {
                                    setSelectedRgId(String(g.iRoutingGroup));
                                    setPushResult(null);
                                    setRgOpen(false);
                                  }}
                                >
                                  <CheckCircle2 className={`mr-2 h-3.5 w-3.5 ${selectedRgId === String(g.iRoutingGroup) ? "opacity-100 text-green-400" : "opacity-0"}`} />
                                  {g.name}
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                    {selectedRg ? (
                      <div className="space-y-2">
                        <Badge className="text-xs bg-green-500/10 text-green-400 border-green-500/30" variant="outline">
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          {selectedRg.name} (id={selectedRg.iRoutingGroup})
                        </Badge>
                        {authRules.length > 0 && (
                          <div className="rounded-md border border-blue-500/20 bg-blue-500/5 px-3 py-2.5 space-y-2">
                            <p className="text-[10px] text-blue-300 font-medium">Reassign routing on existing rules</p>
                            <p className="text-[10px] text-slate-400">
                              Applies <span className="text-blue-300 font-mono">{selectedRg.name}</span> to all {authRules.length} existing auth rule{authRules.length !== 1 ? "s" : ""} — authentication fields (IP, CLD, CLI, etc.) remain untouched.
                            </p>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs border-blue-500/30 text-blue-300 hover:bg-blue-500/10"
                              disabled={bulkUpdateRgMut.isPending}
                              onClick={() => bulkUpdateRgMut.mutate(selectedRg.iRoutingGroup)}
                              data-testid="btn-bulk-apply-rg"
                            >
                              {bulkUpdateRgMut.isPending
                                ? <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" />Applying…</>
                                : <>Apply to all {authRules.length} rule{authRules.length !== 1 ? "s" : ""}</>}
                            </Button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="text-[10px] text-amber-400">⚠ No routing group selected — Sippy will use account default</p>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Existing auth rules */}
            <div className="rounded-lg border border-border bg-card">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Existing Auth Rules ({loadingAuth ? "…" : authRules.length})
                </p>
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => refetchAuth()}
                  data-testid="btn-refresh-auth-rules">
                  <RefreshCw className="h-3 w-3 mr-1" /> Refresh
                </Button>
              </div>
              {loadingAuth ? (
                <div className="flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
              ) : authRules.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6">No auth rules found</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        {["#","Remote IP","Incoming CLD","CLD Rule","Routing Group","Sessions",""].map(h => (
                          <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {authRules.map((rule, i) => {
                        const resolvedRg = allRgs.find(g => g.iRoutingGroup === rule.iRoutingGroup);
                        const isEditing  = editingRuleId === rule.iAuthentication;
                        return (
                          <tr key={rule.iAuthentication} className="border-b border-border/50 hover:bg-accent/40">
                            <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
                            <td className="px-3 py-2 font-mono">{rule.remoteIp ?? "—"}</td>
                            <td className="px-3 py-2 font-mono">{rule.incomingCld ?? rule.incomingCli ?? "—"}</td>
                            <td className="px-3 py-2 font-mono text-muted-foreground">{rule.cldTranslationRule ?? "—"}</td>
                            <td className="px-3 py-2 min-w-[180px]">
                              {isEditing ? (
                                <div className="flex items-center gap-1.5">
                                  <Popover open={editingRgOpen} onOpenChange={setEditingRgOpen}>
                                    <PopoverTrigger asChild>
                                      <Button variant="outline" role="combobox"
                                        className="h-7 text-xs flex-1 justify-between font-normal min-w-[140px]"
                                        data-testid={`sel-edit-rg-${rule.iAuthentication}`}>
                                        <span className="truncate">
                                          {editingRgId
                                            ? (allRgs.find(g => String(g.iRoutingGroup) === editingRgId)?.name ?? editingRgId)
                                            : "Select RG…"}
                                        </span>
                                        <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 text-muted-foreground" />
                                      </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-[240px] p-0" align="start">
                                      <Command>
                                        <CommandInput placeholder="Search…" className="h-7 text-xs" />
                                        <CommandList>
                                          <CommandEmpty>No groups found.</CommandEmpty>
                                          <CommandGroup>
                                            {allRgs.map(g => (
                                              <CommandItem
                                                key={g.iRoutingGroup}
                                                value={g.name}
                                                onSelect={() => { setEditingRgId(String(g.iRoutingGroup)); setEditingRgOpen(false); }}
                                              >
                                                <CheckCircle2 className={`mr-2 h-3 w-3 ${editingRgId === String(g.iRoutingGroup) ? "opacity-100 text-green-400" : "opacity-0"}`} />
                                                {g.name}
                                              </CommandItem>
                                            ))}
                                          </CommandGroup>
                                        </CommandList>
                                      </Command>
                                    </PopoverContent>
                                  </Popover>
                                  <Button size="sm" className="h-7 text-xs px-2"
                                    disabled={!editingRgId || updateRgMut.isPending}
                                    onClick={() => updateRgMut.mutate({ iAuthentication: rule.iAuthentication, iRoutingGroup: parseInt(editingRgId, 10) })}
                                    data-testid={`btn-apply-rg-${rule.iAuthentication}`}>
                                    {updateRgMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Apply"}
                                  </Button>
                                  <Button variant="ghost" size="sm" className="h-7 text-xs px-2"
                                    onClick={() => { setEditingRuleId(null); setEditingRgId(""); setEditingRgOpen(false); }}>
                                    ✕
                                  </Button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-1.5">
                                  {rule.iRoutingGroup ? (
                                    <span className="text-green-400 font-mono">
                                      {resolvedRg ? resolvedRg.name : `id=${rule.iRoutingGroup}`}
                                    </span>
                                  ) : (
                                    <span className="text-amber-400">[From Account]</span>
                                  )}
                                  <button
                                    onClick={() => { setEditingRuleId(rule.iAuthentication); setEditingRgId(rule.iRoutingGroup ? String(rule.iRoutingGroup) : ""); }}
                                    className="text-[10px] text-blue-400 hover:text-blue-300 underline underline-offset-2 transition-colors"
                                    data-testid={`btn-edit-rg-${rule.iAuthentication}`}>
                                    set
                                  </button>
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2">{rule.maxSessions ?? "∞"}</td>
                            <td className="px-3 py-2">
                              <Button variant="ghost" size="icon" className="h-6 w-6"
                                onClick={() => delMut.mutate(rule.iAuthentication)}
                                disabled={delMut.isPending}
                                data-testid={`btn-del-rule-${rule.iAuthentication}`}>
                                {delMut.isPending
                                  ? <Loader2 className="h-3 w-3 animate-spin" />
                                  : <Trash2 className="h-3 w-3 text-red-400" />}
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

          </div>{/* END CENTER */}

          {/* ══ RIGHT: Generated Rule Panel ═══════════════════════════════════ */}
          <div className="w-80 shrink-0 flex flex-col border-l border-border bg-card/40">
            <div className="px-4 py-3 border-b border-border">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Generated Auth Rule</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Review all fields before pushing to Sippy</p>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">

              {/* Protocol */}
              <div>
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">Protocol</Label>
                <div className="mt-1 h-8 px-3 rounded-md border border-border bg-muted/40 flex items-center text-xs text-muted-foreground">
                  SIP (fixed)
                </div>
              </div>

              {/* Remote IP */}
              <div>
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
                  Remote IP Address <span className="text-blue-400">← client SIP IP</span>
                </Label>
                <Input value={fRemoteIp} onChange={e => setFRemoteIp(e.target.value)}
                  placeholder="e.g. 104.245.246.110"
                  className="mt-1 h-8 text-xs font-mono"
                  data-testid="input-remote-ip" />
                {derivedIps.length > 1 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {derivedIps.map(ip => (
                      <button key={ip} onClick={() => setFRemoteIp(ip)}
                        className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20 transition-colors">
                        {ip}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* ── CLD Formula ── */}
              <div className="rounded-md border border-border bg-muted/20 p-3 space-y-2.5">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                  CLD Formula <span className="text-orange-400 normal-case font-mono font-normal">= prefix + product + CC</span>
                </p>

                {/* 4-digit prefix */}
                <div>
                  <Label className="text-[10px] text-muted-foreground">
                    4-digit Prefix
                    {fPrefix
                      ? <span className="ml-1 text-green-400">← from client rules</span>
                      : <span className="ml-1 text-amber-400">← enter manually</span>}
                  </Label>
                  <Input
                    value={fPrefix}
                    onChange={e => handlePrefixChange(e.target.value)}
                    placeholder=""
                    maxLength={4}
                    className="mt-1 h-7 text-xs font-mono"
                    data-testid="input-prefix"
                  />
                </div>

                {/* Product code — clickable buttons */}
                <div>
                  <Label className="text-[10px] text-muted-foreground mb-1.5 block">Product Code</Label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {ACTIVE_PRODUCTS.map(p => {
                      const isSelected = fProductCode === p.prefix;
                      return (
                        <button
                          key={p.prefix}
                          onClick={() => handleSelectProduct(p.prefix)}
                          data-testid={`btn-product-${p.prefix}`}
                          className={`flex flex-col items-start px-2.5 py-2 rounded-md border text-left transition-all ${
                            isSelected
                              ? `${p.bg} ${p.color} border-current ring-1 ${p.ring}`
                              : "border-border bg-background text-muted-foreground hover:bg-accent"
                          }`}
                        >
                          <span className="text-[11px] font-bold font-mono leading-none">{p.prefix}</span>
                          <span className="text-[10px] leading-tight mt-0.5 truncate w-full">{p.short}</span>
                        </button>
                      );
                    })}
                  </div>
                  {(() => {
                    const sel = ACTIVE_PRODUCTS.find(p => p.prefix === fProductCode);
                    return sel ? <p className={`text-[10px] mt-1 ${sel.color}`}>{sel.label}</p> : null;
                  })()}
                </div>
              </div>

              {/* Incoming CLD */}
              <div>
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
                  Incoming CLD/DNIS <span className="text-violet-400">← destination prefix</span>
                </Label>
                <Input value={fCld} onChange={e => setFCld(e.target.value)}
                  placeholder=""
                  className="mt-1 h-8 text-xs font-mono"
                  data-testid="input-incoming-cld" />
              </div>

              {/* CLD Translation Rule */}
              <div>
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
                  CLD Tr. Rule <span className="text-orange-400">← auto-generated</span>
                </Label>
                <Input value={fCldRule} onChange={e => setFCldRule(e.target.value)}
                  placeholder=""
                  className="mt-1 h-8 text-xs font-mono"
                  data-testid="input-cld-rule" />
              </div>

              {/* Incoming CLI */}
              <div>
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
                  Incoming CLI <span className="text-cyan-400">← caller prefix match</span>
                </Label>
                <Input value={fCli} onChange={e => setFCli(e.target.value)}
                  placeholder=""
                  className="mt-1 h-8 text-xs font-mono"
                  data-testid="input-incoming-cli" />
              </div>

              {/* Routing Group display */}
              <div>
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
                  Routing Group <span className="text-green-400">← key field</span>
                </Label>
                <div className={`mt-1 h-8 px-3 rounded-md border flex items-center text-xs font-mono truncate ${
                  selectedRg
                    ? "border-green-500/40 bg-green-500/10 text-green-300"
                    : "border-border bg-muted/40 text-muted-foreground"
                }`}>
                  {selectedRg ? `${selectedRg.name}  (id=${selectedRg.iRoutingGroup})` : "— select a routing group —"}
                </div>
              </div>

              {/* Max Sessions / CPS */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">Max Sessions</Label>
                  <Input value={fMaxSess} onChange={e => setFMaxSess(e.target.value)}
                    type="number" min={0} className="mt-1 h-8 text-xs" data-testid="input-max-sessions" />
                  <p className="text-[10px] text-muted-foreground mt-0.5">0 = unlimited</p>
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">Max CPS</Label>
                  <Input value={fMaxCps} onChange={e => setFMaxCps(e.target.value)}
                    type="number" min={0} className="mt-1 h-8 text-xs" data-testid="input-max-cps" />
                  <p className="text-[10px] text-muted-foreground mt-0.5">0 = unlimited</p>
                </div>
              </div>

              {/* MC secondary rule */}
              <div className="rounded-md border border-border bg-muted/20 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">Add MC Rule</Label>
                  <button
                    onClick={() => setFMcEnabled(v => !v)}
                    data-testid="btn-toggle-mc"
                    className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${fMcEnabled ? "bg-primary" : "bg-muted"}`}>
                    <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${fMcEnabled ? "translate-x-3.5" : "translate-x-0.5"}`} />
                  </button>
                </div>
                {fMcEnabled && (
                  <>
                    <Label className="text-[10px] text-muted-foreground block">MC Product Code</Label>
                    <div className="grid grid-cols-2 gap-1.5">
                      {ACTIVE_PRODUCTS.map(p => {
                        const isSelected = fMcProductCode === p.prefix;
                        return (
                          <button key={p.prefix}
                            onClick={() => setFMcProductCode(p.prefix)}
                            data-testid={`btn-mc-product-${p.prefix}`}
                            className={`flex flex-col items-start px-2.5 py-2 rounded-md border text-left transition-all ${
                              isSelected
                                ? `${p.bg} ${p.color} border-current ring-1 ${p.ring}`
                                : "border-border bg-background text-muted-foreground hover:bg-accent"
                            }`}>
                            <span className="text-[11px] font-bold font-mono leading-none">{p.prefix}</span>
                            <span className="text-[10px] leading-tight mt-0.5 truncate w-full">{p.short}</span>
                          </button>
                        );
                      })}
                    </div>
                    {selectedDest?.cc && fPrefix ? (
                      <div className="text-[10px] font-mono space-y-0.5 bg-background/60 rounded p-1.5">
                        <p className="text-violet-400">{buildCldWildcard(fPrefix, fMcProductCode, selectedDest.cc)}</p>
                        <p className="text-orange-400">{buildCldRule(fPrefix, fMcProductCode, selectedDest.cc)}</p>
                      </div>
                    ) : (
                      <p className="text-[10px] text-muted-foreground">Select a destination first</p>
                    )}
                  </>
                )}
              </div>

              <Separator />

              {pushResult && (
                <div className={`rounded-md border p-3 text-xs flex items-start gap-2 ${
                  pushResult.ok
                    ? "border-green-500/30 bg-green-500/10 text-green-300"
                    : "border-red-500/30 bg-red-500/10 text-red-300"
                }`}>
                  {pushResult.ok
                    ? <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    : <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />}
                  <span>{pushResult.msg}</span>
                </div>
              )}

              {!fPrefix && (
                <p className="text-[10px] text-amber-400 text-center">⚠ Enter 4-digit prefix to enable Push</p>
              )}

              <Button
                onClick={() => pushMut.mutate()}
                disabled={!canPush || pushMut.isPending}
                className="w-full h-10 text-sm font-semibold bg-green-600 hover:bg-green-700 text-white"
                data-testid="btn-implement-push"
              >
                {pushMut.isPending
                  ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Pushing…</>
                  : `▶  Implement${fMcEnabled ? " (+ MC)" : ""} / Push to Sippy`}
              </Button>

              <p className="text-[10px] text-muted-foreground text-center">
                Creates auth rule via XML-RPC addAuthRule(). Review all fields above before pushing.
              </p>

            </div>
          </div>

        </div>
      )}
    </div>
  );
}

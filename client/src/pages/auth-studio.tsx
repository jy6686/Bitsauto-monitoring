import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Loader2, Search, User, ShieldCheck, CheckCircle2, AlertTriangle, Trash2, RefreshCw, ChevronRight } from "lucide-react";
import { PRODUCT_CLASSES } from "./products";

// ── Destination presets ───────────────────────────────────────────────────────
// cc = country code digits only — wildcard and CLD rule are built from:
//   { prefix }{ productCode }{ cc }   e.g.  6686 + 1 + 92  →  "6686192"
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

// Active product codes (exclude 'other')
const ACTIVE_PRODUCTS = PRODUCT_CLASSES.filter(p => p.prefix !== "other");

// ── CLD rule builders ─────────────────────────────────────────────────────────
// Wildcard:  {prefix}{productCode}{cc}*        e.g.  6686192*
// CLD rule:  s/^{prefix}{productCode}{cc}/{productCode}{cc}/
//            strips the 4-digit routing prefix, keeps product+CC for Sippy routing.
function buildCldWildcard(prefix: string, productCode: string, cc: string): string {
  return `${prefix}${productCode}${cc}*`;
}
function buildCldRule(prefix: string, productCode: string, cc: string): string {
  return `s/^${prefix}${productCode}${cc}/${productCode}${cc}/`;
}

// ── Parse prefix + product code from an existing CLD rule ─────────────────────
// e.g.  "s/^6686192/192/"  →  { prefix: "6686", productCode: "1" }
function parseCldRule(rule: string): { prefix: string; productCode: string } {
  const m = rule?.match(/^s\/\^(\d{4})([1267])/);
  if (m) return { prefix: m[1], productCode: m[2] };
  return { prefix: "", productCode: "" };
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

// ── helpers ───────────────────────────────────────────────────────────────────
function filterRgsByDest(groups: RoutingGroup[], dest: Dest | null): RoutingGroup[] {
  if (!dest || dest.label === "Custom") return groups;
  const kws = dest.keywords;
  return groups.filter(g => kws.some(k => g.name.toLowerCase().includes(k.toLowerCase())));
}

function statusColor(s: string) {
  if (s === "critical") return "bg-red-500/20 text-red-400 border-red-500/30";
  if (s === "warning")  return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
  return "bg-green-500/20 text-green-400 border-green-500/30";
}

// ─────────────────────────────────────────────────────────────────────────────
export default function AuthStudioPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  // Selection state
  const [acctSearch, setAcctSearch]       = useState("");
  const [selectedAcct, setSelectedAcct]   = useState<Account | null>(null);
  const [selectedDest, setSelectedDest]   = useState<Dest | null>(null);
  const [selectedRgId, setSelectedRgId]   = useState<string>("");
  const [pushResult, setPushResult]       = useState<{ ok: boolean; msg: string; id?: number } | null>(null);

  // Generated form (right panel) — all editable before push
  const [fRemoteIp,    setFRemoteIp]    = useState("");
  const [fCld,         setFCld]         = useState("");
  const [fCldRule,     setFCldRule]     = useState("");
  const [fMaxSess,     setFMaxSess]     = useState("0");
  const [fMaxCps,      setFMaxCps]      = useState("0");

  // CLD prefix (4-digit, auto-read from client's existing CLD rule) + product code
  const [fPrefix,      setFPrefix]      = useState("");      // auto-filled from existing rule
  const [fProductCode, setFProductCode] = useState("1");     // clickable product button

  // MC (mobile-calling) secondary rule
  const [fMcEnabled,     setFMcEnabled]     = useState(false);
  const [fMcProductCode, setFMcProductCode] = useState("7");

  // ── Data fetching ───────────────────────────────────────────────────────────
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

  // ── Derived ─────────────────────────────────────────────────────────────────
  const accounts  = acctData?.accounts ?? [];
  const allRgs    = rgData?.groups ?? [];
  const authRules = authData?.authRules ?? [];

  const filteredAccts = useMemo(() =>
    accounts.filter(a =>
      !acctSearch ||
      a.username.toLowerCase().includes(acctSearch.toLowerCase()) ||
      String(a.iAccount).includes(acctSearch)
    ), [accounts, acctSearch]);

  const filteredRgs = useMemo(() =>
    filterRgsByDest(allRgs, selectedDest), [allRgs, selectedDest]);

  const selectedRg = allRgs.find(g => String(g.iRoutingGroup) === selectedRgId) ?? null;

  // Derived IPs — prefer auth-rule IPs (accurate) over account list IPs (often empty from listAccounts)
  const derivedIps: string[] = authRules.length > 0
    ? [...new Set(authRules.map(r => r.remoteIp).filter((ip): ip is string => !!ip))]
    : (selectedAcct?.allowedIps ?? []);

  // ── Auto-fill Remote IP + parse prefix/productCode from client's existing rules ──
  // listAccounts() doesn't return allowedIps or CLD info — derive from auth rules.
  useEffect(() => {
    if (!authData?.authRules?.length) return;

    // Auto-fill IP if not already set
    if (!fRemoteIp) {
      const firstIp = authData.authRules.find(r => r.remoteIp)?.remoteIp;
      if (firstIp) setFRemoteIp(firstIp);
    }

    // Extract prefix + product code from the client's existing CLD rule
    if (!fPrefix) {
      const ruleWithCld = authData.authRules.find(r => r.cldTranslationRule);
      if (ruleWithCld?.cldTranslationRule) {
        const { prefix, productCode } = parseCldRule(ruleWithCld.cldTranslationRule);
        if (prefix) setFPrefix(prefix);
        if (productCode) setFProductCode(productCode);
      }
    }
  }, [authData]);

  // ── Auto-regenerate CLD wildcard + rule when formula inputs change ─────────
  useEffect(() => {
    if (!selectedDest || selectedDest.label === "Custom" || !selectedDest.cc) return;
    if (!fPrefix) return; // wait until prefix is known
    setFCld(buildCldWildcard(fPrefix, fProductCode, selectedDest.cc));
    setFCldRule(buildCldRule(fPrefix, fProductCode, selectedDest.cc));
  }, [selectedDest, fPrefix, fProductCode]);

  // ── Select account handler ──────────────────────────────────────────────────
  function handleSelectAcct(acct: Account) {
    setSelectedAcct(acct);
    setSelectedDest(null);
    setSelectedRgId("");
    setPushResult(null);
    setFRemoteIp((acct.allowedIps ?? [])[0] ?? "");
    setFCld("");
    setFCldRule("");
    setFMaxSess("0");
    setFMaxCps("0");
    setFMcEnabled(false);
    // Reset prefix so useEffect re-reads it from the new account's rules
    setFPrefix("");
    setFProductCode("1");
  }

  // ── Select destination handler ──────────────────────────────────────────────
  function handleSelectDest(destLabel: string) {
    const d = DESTINATIONS.find(x => x.label === destLabel) ?? null;
    setSelectedDest(d);
    setSelectedRgId("");
    setPushResult(null);
    if (d && d.label !== "Custom" && d.cc && fPrefix) {
      setFCld(buildCldWildcard(fPrefix, fProductCode, d.cc));
      setFCldRule(buildCldRule(fPrefix, fProductCode, d.cc));
    }
  }

  // ── Select RG handler ───────────────────────────────────────────────────────
  function handleSelectRg(rgId: string) {
    setSelectedRgId(rgId);
    setPushResult(null);
  }

  // ── Push mutation ───────────────────────────────────────────────────────────
  const pushMut = useMutation({
    mutationFn: async () => {
      if (!selectedAcct) throw new Error("No account selected.");

      const body: Record<string, unknown> = {
        iProtocol: 1,
        ...(fRemoteIp  ? { remoteIp:           fRemoteIp  } : {}),
        ...(fCld       ? { incomingCld:         fCld       } : {}),
        ...(fCldRule   ? { cldTranslationRule:  fCldRule   } : {}),
        ...(selectedRg ? { iRoutingGroup: selectedRg.iRoutingGroup } : {}),
        ...(fMaxSess && fMaxSess !== "0" ? { maxSessions: parseInt(fMaxSess, 10) } : {}),
        ...(fMaxCps  && fMaxCps  !== "0" ? { maxCps:      parseInt(fMaxCps, 10) }  : {}),
      };
      const r = await apiRequest("POST", `/api/sippy/accounts/${selectedAcct.iAccount}/auth-rules`, body);
      const primary = await r.json();

      // Optional MC secondary rule
      if (fMcEnabled && selectedDest && selectedDest.cc && fPrefix) {
        const mcCld     = buildCldWildcard(fPrefix, fMcProductCode, selectedDest.cc);
        const mcCldRule = buildCldRule(fPrefix, fMcProductCode, selectedDest.cc);
        const mcBody: Record<string, unknown> = {
          iProtocol: 1,
          ...(fRemoteIp  ? { remoteIp:           fRemoteIp  } : {}),
          incomingCld:        mcCld,
          cldTranslationRule: mcCldRule,
          ...(selectedRg ? { iRoutingGroup: selectedRg.iRoutingGroup } : {}),
          ...(fMaxSess && fMaxSess !== "0" ? { maxSessions: parseInt(fMaxSess, 10) } : {}),
          ...(fMaxCps  && fMaxCps  !== "0" ? { maxCps:      parseInt(fMaxCps, 10) }  : {}),
        };
        await apiRequest("POST", `/api/sippy/accounts/${selectedAcct.iAccount}/auth-rules`, mcBody);
      }

      return primary;
    },
    onSuccess: (data: any) => {
      if (data.success) {
        const extra = fMcEnabled ? " + MC rule" : "";
        setPushResult({ ok: true, msg: `Auth rule created (id=${data.iAuthentication})${extra}`, id: data.iAuthentication });
        toast({ title: "Auth rule pushed to Sippy", description: `i_authentication = ${data.iAuthentication}${extra}` });
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

  // ── Delete auth rule mutation ────────────────────────────────────────────────
  const delMut = useMutation({
    mutationFn: (iAuthentication: number) =>
      apiRequest("DELETE", `/api/sippy/auth-rules/${iAuthentication}`).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Auth rule deleted" });
      qc.invalidateQueries({ queryKey: ["/api/sippy/accounts", selectedAcct?.iAccount, "auth-rules"] });
      refetchAuth();
    },
    onError: (e: any) => toast({ variant: "destructive", title: "Delete failed", description: e.message }),
  });

  const canPush = !!selectedAcct && (!!fRemoteIp || !!fCld) && !!fPrefix;

  // ── Step badges ──────────────────────────────────────────────────────────────
  const steps = [
    { label: "Client",        done: !!selectedAcct },
    { label: "Destination",   done: !!selectedDest  },
    { label: "Routing Group", done: !!selectedRgId  },
  ];

  // ─────────────────────────────────────────────────────────────────────────────
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
              <Badge
                variant="outline"
                className={s.done
                  ? "border-green-500/40 bg-green-500/10 text-green-400 text-xs"
                  : "border-border text-muted-foreground text-xs"
                }
              >
                {s.done && <CheckCircle2 className="h-3 w-3 mr-1" />}
                {s.label}
              </Badge>
            </span>
          ))}
        </div>
      </div>

      {/* ── 3-panel body ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ══ LEFT: Account list ═══════════════════════════════════════════════ */}
        <div className="w-72 shrink-0 flex flex-col border-r border-border bg-card/40">
          <div className="p-3 border-b border-border">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={acctSearch}
                onChange={e => setAcctSearch(e.target.value)}
                placeholder="Search accounts…"
                className="pl-8 h-8 text-xs"
                data-testid="input-acct-search"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loadingAccts ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : filteredAccts.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-8">No accounts found</p>
            ) : (
              filteredAccts.map(a => (
                <button
                  key={a.iAccount}
                  onClick={() => handleSelectAcct(a)}
                  data-testid={`btn-select-acct-${a.iAccount}`}
                  className={`w-full text-left px-3 py-2.5 border-b border-border/50 hover:bg-accent transition-colors ${
                    selectedAcct?.iAccount === a.iAccount ? "bg-primary/10 border-l-2 border-l-primary" : ""
                  }`}
                >
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs font-medium truncate max-w-[140px]">{a.username}</span>
                    <Badge variant="outline" className={`text-[10px] px-1 py-0 ${statusColor(a.status)}`}>
                      {a.status}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span>#{a.iAccount}</span>
                    <span>{a.currency} {a.balance?.toFixed(2)}</span>
                  </div>
                  {(a.allowedIps ?? []).length > 0 && (
                    <div className="text-[10px] text-muted-foreground truncate mt-0.5">
                      IP: {(a.allowedIps ?? []).slice(0, 2).join(", ")}
                      {(a.allowedIps ?? []).length > 2 && ` +${(a.allowedIps ?? []).length - 2}`}
                    </div>
                  )}
                </button>
              ))
            )}
          </div>
        </div>

        {/* ══ CENTER: Provisioning Intelligence ════════════════════════════════ */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {!selectedAcct ? (
            <div className="flex flex-col items-center justify-center flex-1 text-center gap-3 text-muted-foreground">
              <User className="h-10 w-10 opacity-30" />
              <p className="text-sm">Select a client account on the left to begin</p>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-4 space-y-4">

              {/* Account summary strip */}
              <div className="rounded-lg border border-border bg-card p-3 flex flex-wrap gap-4 text-xs">
                <div><span className="text-muted-foreground">Account</span>
                  <p className="font-semibold text-sm mt-0.5">{selectedAcct.username}</p></div>
                <div><span className="text-muted-foreground">ID</span>
                  <p className="font-medium mt-0.5">#{selectedAcct.iAccount}</p></div>
                <div><span className="text-muted-foreground">Balance</span>
                  <p className="font-medium mt-0.5">{selectedAcct.currency} {selectedAcct.balance?.toFixed(4)}</p></div>
                <div>
                  <span className="text-muted-foreground">Registered IP</span>
                  {loadingAuth ? (
                    <p className="font-medium mt-0.5 text-muted-foreground flex items-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" /> loading…
                    </p>
                  ) : derivedIps.length > 0 ? (
                    <p className="font-medium font-mono mt-0.5 text-green-400">{derivedIps.join(", ")}</p>
                  ) : (
                    <p className="font-medium mt-0.5 text-muted-foreground">None registered</p>
                  )}
                </div>
                {fPrefix && (
                  <div>
                    <span className="text-muted-foreground">CLD Prefix</span>
                    <p className="font-medium font-mono mt-0.5 text-orange-400">{fPrefix}</p>
                  </div>
                )}
              </div>

              {/* ── Step 1: Destination selector ── */}
              <div className="rounded-lg border border-border bg-card p-4 space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">① Select Destination</p>
                <Select value={selectedDest?.label ?? ""} onValueChange={handleSelectDest}>
                  <SelectTrigger className="h-9 text-sm" data-testid="sel-destination">
                    <SelectValue placeholder="Choose destination country…" />
                  </SelectTrigger>
                  <SelectContent>
                    {DESTINATIONS.map(d => (
                      <SelectItem key={d.label} value={d.label}>{d.label}
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
                    ⚠ No prefix found in existing rules — enter it manually in the right panel
                  </p>
                )}
              </div>

              {/* ── Step 2: Routing group selector ── */}
              {selectedDest && (
                <div className="rounded-lg border border-border bg-card p-4 space-y-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">② Select Routing Group</p>
                  {loadingRgs ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading routing groups…
                    </div>
                  ) : (
                    <>
                      <Select value={selectedRgId} onValueChange={handleSelectRg}>
                        <SelectTrigger className="h-9 text-sm" data-testid="sel-routing-group">
                          <SelectValue placeholder={
                            filteredRgs.length === 0
                              ? "No matching groups — showing all"
                              : `Choose from ${filteredRgs.length} matched group${filteredRgs.length !== 1 ? "s" : ""}…`
                          } />
                        </SelectTrigger>
                        <SelectContent>
                          {(filteredRgs.length > 0 ? filteredRgs : allRgs).map(g => (
                            <SelectItem key={g.iRoutingGroup} value={String(g.iRoutingGroup)}>
                              {g.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {selectedRg && (
                        <Badge className="text-xs bg-green-500/10 text-green-400 border-green-500/30" variant="outline">
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          {selectedRg.name}  (id={selectedRg.iRoutingGroup})
                        </Badge>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* ── Existing auth rules table ── */}
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
                  <p className="text-xs text-muted-foreground text-center py-6">No auth rules — account has open access or rules not loaded</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border bg-muted/30">
                          {["#","Remote IP","Incoming CLD","CLD Rule","RG Id","Sessions",""].map(h => (
                            <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {authRules.map((rule, i) => (
                          <tr key={rule.iAuthentication} className="border-b border-border/50 hover:bg-accent/40">
                            <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
                            <td className="px-3 py-2 font-mono">{rule.remoteIp ?? "—"}</td>
                            <td className="px-3 py-2 font-mono">{rule.incomingCld ?? rule.incomingCli ?? "—"}</td>
                            <td className="px-3 py-2 font-mono text-muted-foreground">{rule.cldTranslationRule ?? "—"}</td>
                            <td className="px-3 py-2">{rule.iRoutingGroup ?? "—"}</td>
                            <td className="px-3 py-2">{rule.maxSessions ?? "∞"}</td>
                            <td className="px-3 py-2">
                              <Button variant="ghost" size="icon" className="h-6 w-6"
                                onClick={() => delMut.mutate(rule.iAuthentication)}
                                disabled={delMut.isPending}
                                data-testid={`btn-del-rule-${rule.iAuthentication}`}>
                                {delMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3 text-red-400" />}
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

            </div>
          )}
        </div>

        {/* ══ RIGHT: Generated Auth Rule + Push ════════════════════════════════ */}
        <div className="w-80 shrink-0 flex flex-col border-l border-border bg-card/40">
          <div className="px-4 py-3 border-b border-border">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Generated Auth Rule</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Review all fields before pushing to Sippy</p>
          </div>

          {!selectedAcct ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <p className="text-xs text-center px-4">Select a client to see the generated rule</p>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-4 space-y-3">

              {/* Protocol */}
              <div>
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">Protocol</Label>
                <div className="mt-1 h-8 px-3 rounded-md border border-border bg-muted/40 flex items-center text-xs text-muted-foreground">
                  SIP  (fixed)
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

              {/* ── CLD formula ── */}
              <div className="rounded-md border border-border bg-muted/20 p-3 space-y-2.5">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                  CLD Formula <span className="text-orange-400 normal-case font-mono font-normal">= prefix + product + CC</span>
                </p>

                {/* 4-digit prefix — auto-read from client's existing CLD rule */}
                <div>
                  <Label className="text-[10px] text-muted-foreground">
                    4-digit Prefix
                    {fPrefix
                      ? <span className="ml-1 text-green-400">← from client rules</span>
                      : <span className="ml-1 text-amber-400">← enter manually</span>}
                  </Label>
                  <Input
                    value={fPrefix}
                    onChange={e => setFPrefix(e.target.value.replace(/\D/g, "").slice(0, 4))}
                    placeholder="e.g. 6686"
                    maxLength={4}
                    className="mt-1 h-7 text-xs font-mono"
                    data-testid="input-prefix"
                  />
                </div>

                {/* Product code — clickable buttons from Products module */}
                <div>
                  <Label className="text-[10px] text-muted-foreground mb-1.5 block">Product Code</Label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {ACTIVE_PRODUCTS.map(p => {
                      const isSelected = fProductCode === p.prefix;
                      return (
                        <button
                          key={p.prefix}
                          onClick={() => setFProductCode(p.prefix)}
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
                    return sel ? (
                      <p className={`text-[10px] mt-1.5 ${sel.color}`}>{sel.label}</p>
                    ) : null;
                  })()}
                </div>
              </div>

              {/* Incoming CLD (auto-generated, still editable) */}
              <div>
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
                  Incoming CLD/DNIS <span className="text-violet-400">← destination prefix</span>
                </Label>
                <Input value={fCld} onChange={e => setFCld(e.target.value)}
                  placeholder="e.g. 6686192*"
                  className="mt-1 h-8 text-xs font-mono"
                  data-testid="input-incoming-cld" />
              </div>

              {/* CLD Translation Rule */}
              <div>
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
                  CLD Tr. Rule <span className="text-orange-400">← auto-generated</span>
                </Label>
                <Input value={fCldRule} onChange={e => setFCldRule(e.target.value)}
                  placeholder="e.g. s/^6686192/192/"
                  className="mt-1 h-8 text-xs font-mono"
                  data-testid="input-cld-rule" />
              </div>

              {/* Routing Group */}
              <div>
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
                  Routing Group <span className="text-green-400">← key field</span>
                </Label>
                <div className={`mt-1 h-8 px-3 rounded-md border flex items-center text-xs font-mono truncate ${
                  selectedRg ? "border-green-500/40 bg-green-500/10 text-green-300" : "border-border bg-muted/40 text-muted-foreground"
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

              {/* ── MC secondary rule ── */}
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
                          <button
                            key={p.prefix}
                            onClick={() => setFMcProductCode(p.prefix)}
                            data-testid={`btn-mc-product-${p.prefix}`}
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
                    {selectedDest && selectedDest.cc && fPrefix && (
                      <div className="text-[10px] font-mono space-y-0.5 bg-background/60 rounded p-1.5">
                        <p className="text-violet-400">{buildCldWildcard(fPrefix, fMcProductCode, selectedDest.cc)}</p>
                        <p className="text-orange-400">{buildCldRule(fPrefix, fMcProductCode, selectedDest.cc)}</p>
                      </div>
                    )}
                    {(!selectedDest || !selectedDest.cc) && (
                      <p className="text-[10px] text-muted-foreground">Select a destination first</p>
                    )}
                  </>
                )}
              </div>

              <Separator className="my-1" />

              {/* Push result */}
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

              {!fPrefix && selectedAcct && !loadingAuth && (
                <p className="text-[10px] text-amber-400 text-center">
                  ⚠ Enter the 4-digit prefix above to enable Push
                </p>
              )}

              {/* IMPLEMENT button */}
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
                Creates auth rule in Sippy via XML-RPC addAuthRule(). Review all fields above before pushing.
              </p>

            </div>
          )}
        </div>

      </div>
    </div>
  );
}

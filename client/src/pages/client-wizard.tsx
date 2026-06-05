import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Users, ChevronRight, ChevronLeft, CheckCircle2, Plus, Trash2,
  AlertTriangle, ShieldCheck, Server, Network, FileText,
  Loader2, Info, Eye, EyeOff, Tag, Package, Lock, LockOpen,
  Copy, Check, Save, Zap,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Company } from "@shared/schema";

// ── Constants ─────────────────────────────────────────────────────────────────

const STEPS = [
  { id: 1, label: "Department & Company", icon: Users },
  { id: 2, label: "Rate Sheet Config",    icon: FileText },
  { id: 3, label: "Technical Config",     icon: Server },
  { id: 4, label: "IPs & Products",       icon: Network },
  { id: 5, label: "Review & Save",        icon: CheckCircle2 },
];

const DEPARTMENTS = [
  { value: "retail",      label: "Retail" },
  { value: "wholesale",   label: "Wholesale" },
  { value: "enterprise",  label: "Enterprise" },
  { value: "carrier",     label: "Carrier" },
];

const TRUNK_PRODUCTS = [
  { name: "First Class",     border: "border-amber-500/50",   activeBg: "bg-amber-500/15",   text: "text-amber-400",   panelBorder: "border-amber-500/40" },
  { name: "Business Class",  border: "border-blue-500/50",    activeBg: "bg-blue-500/15",    text: "text-blue-400",    panelBorder: "border-blue-500/40" },
  { name: "Special Charlie", border: "border-violet-500/50",  activeBg: "bg-violet-500/15",  text: "text-violet-400",  panelBorder: "border-violet-500/40" },
  { name: "Special Bravo",   border: "border-emerald-500/50", activeBg: "bg-emerald-500/15", text: "text-emerald-400", panelBorder: "border-emerald-500/40" },
];
const TRUNK_PRODUCT_NAMES = TRUNK_PRODUCTS.map(p => p.name);

const PRODUCT_COLOR: Record<string, string> = {
  "First Class":    "bg-amber-500/10 text-amber-400 border-amber-500/30",
  "Business Class": "bg-blue-500/10 text-blue-400 border-blue-500/30",
  "Special Charlie":"bg-violet-500/10 text-violet-400 border-violet-500/30",
  "Special Bravo":  "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
};

const CODECS_VISUAL = [
  { value: "0",  label: "G.711u",  sub: "PCMU · 64 kbps",    quality: "High" },
  { value: "8",  label: "G.711a",  sub: "PCMA · 64 kbps",    quality: "High" },
  { value: "9",  label: "G.722",   sub: "HD Voice · 64 kbps", quality: "HD" },
  { value: "18", label: "G.729",   sub: "Low BW · 8 kbps",   quality: "Low BW" },
  { value: "none",label: "None",   sub: "No preference",      quality: "—" },
];

const INVOICE_TILES = [
  { value: "Standard",  desc: "Monthly invoice with full itemization" },
  { value: "Retail",    desc: "Simplified retail billing summary" },
  { value: "Wholesale", desc: "Wholesale rate card + traffic summary" },
  { value: "Custom",    desc: "Custom format — configured separately" },
];

const SHEET_FORMAT_OPTIONS = ["Full CSV", "Excel XLSX", "PDF", "Partial Update", "A2Z"];

function genPassword(len = 12) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface TrunkConfig {
  trunkName: string; routingGroupId: string; maxTime: string; maxSessions: string;
  maxCps: string; codec: string; useCodecOnly: boolean; lifetime: string;
  relayType: string; prefix: string; cldTranslation: string;
  assertedIdRule: string; useAssertedId: boolean; preventLoops: boolean;
  allowRegistration: boolean; blocked: boolean;
}
interface IpEntry { ip: string; trunk: string; description: string; status: string; }

const emptyTrunk = (): TrunkConfig => ({
  trunkName: "", routingGroupId: "", maxTime: "3600", maxSessions: "0", maxCps: "",
  codec: "0", useCodecOnly: false, lifetime: "never", relayType: "0",
  prefix: "", cldTranslation: "s/^//", assertedIdRule: "", useAssertedId: false,
  preventLoops: false, allowRegistration: true, blocked: false,
});
const emptyIp = (): IpEntry => ({ ip: "", trunk: "", description: "", status: "pending" });

// ── Small reusable UI helpers ─────────────────────────────────────────────────

function TogglePill({ value, active, onClick, children }: { value: string; active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
        active
          ? "bg-amber-500/15 border-amber-500/50 text-amber-400 shadow-sm"
          : "border-border text-muted-foreground hover:border-border/80 hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function SegmentedControl({ options, value, onChange }: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex rounded-md border border-border overflow-hidden text-xs">
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`flex-1 px-3 py-1.5 font-medium transition-colors ${
            value === o.value
              ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
              : "text-muted-foreground hover:bg-muted/40"
          } ${i > 0 ? "border-l border-border" : ""}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function QuickChips({ options, onPick }: { options: { label: string; value: string }[]; onPick: (v: string) => void }) {
  return (
    <div className="flex gap-1 flex-wrap">
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          onClick={() => onPick(o.value)}
          className="text-[10px] px-2 py-0.5 rounded border border-border text-muted-foreground hover:border-blue-500/40 hover:text-blue-400 transition-colors"
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── CLD live preview ──────────────────────────────────────────────────────────
function CldPreview({ rule, prefix }: { rule: string; prefix: string }) {
  const sample = prefix ? `${prefix}12345` : "88881234";
  const [matched, setMatched] = useState<string | null>(null);
  useEffect(() => {
    try {
      const m = rule.match(/^s\/\^(.*?)\/\/(.*)/);
      if (m) {
        const stripped = sample.replace(new RegExp("^" + m[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "");
        setMatched(stripped);
      } else {
        setMatched(null);
      }
    } catch { setMatched(null); }
  }, [rule, sample]);

  if (!rule || rule === "s/^//") return null;
  return (
    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground bg-muted/20 border border-border/40 rounded px-2 py-1">
      <span className="font-mono text-foreground/60">{sample}</span>
      <ChevronRight className="h-3 w-3 shrink-0" />
      <span className="font-mono text-emerald-400">{matched ?? sample}</span>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function ClientWizardPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [step, setStep] = useState(1);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [showPass, setShowPass] = useState(false);
  const [copied, setCopied] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [usernameLocked, setUsernameLocked] = useState(false);

  // ── Step 1 state ────────────────────────────────────────────────────────────
  const [s1, setS1] = useState({
    department: "retail", companyId: "", password: genPassword(),
    displayName: "", userId: "", notifEmailTo: "", notifEmailCc: "",
    balanceThreshold: "", a2zNotif: false, rateNotif: "full_sheet",
  });

  // ── Step 2 state ────────────────────────────────────────────────────────────
  const [s2, setS2] = useState({
    invoiceTemplate: "Standard",
    ratesheetFormats: ["Full CSV"] as string[],
    dialcodeFormat: "E.164",
    prefixStyle: "with_plus",
    servicePlanId: "",
  });

  // ── Step 3 state ────────────────────────────────────────────────────────────
  const [trunks, setTrunks] = useState<TrunkConfig[]>([emptyTrunk()]);

  // ── Step 4 state ────────────────────────────────────────────────────────────
  const [ips, setIps] = useState<IpEntry[]>([emptyIp()]);
  const [manualProducts, setManualProducts] = useState<string[]>([]);

  // ── Derived: products from trunk names ──────────────────────────────────────
  const derivedProducts = Array.from(new Set(
    trunks.map(t => t.trunkName).filter(n => TRUNK_PRODUCT_NAMES.includes(n))
  ));
  const productsAreDerived = derivedProducts.length > 0;
  const activeProducts = productsAreDerived ? derivedProducts : manualProducts;

  // ── Data fetching ───────────────────────────────────────────────────────────
  const { data: companiesData } = useQuery<{ companies: Company[] }>({ queryKey: ["/api/companies"] });
  const { data: routingData }   = useQuery<{ groups: { id: number; name: string }[] }>({
    queryKey: ["/api/sippy/routing-groups"], retry: false,
  });
  const { data: billingPlansData } = useQuery<{ plans: { id: number; name: string }[]; error?: string }>({
    queryKey: ["/api/sippy/billing-plans"], retry: false,
  });

  const companies      = companiesData?.companies ?? [];
  const routingGroups  = routingData?.groups ?? [];
  const billingPlans   = billingPlansData?.plans ?? [];
  const selectedCompany = companies.find(c => String(c.id) === s1.companyId);

  // Filter companies by department
  const filteredCompanies = companies.filter(c =>
    !s1.department ||
    (c as any).department === s1.department ||
    c.companyType === s1.department
  );

  // ── Mutations ───────────────────────────────────────────────────────────────
  const submitIpMutation = useMutation({
    mutationFn: (payload: any) => apiRequest("POST", "/api/client-ip-requests", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/client-ip-requests"] });
      toast({ title: "IP registered successfully" });
    },
    onError: (e: any) => toast({ title: "IP registration failed", description: e?.message, variant: "destructive" }),
  });

  const createClientMutation = useMutation({
    mutationFn: (payload: any) => apiRequest("POST", "/api/client-wizard/submit", payload),
    onSuccess: () => {
      setSubmitted(true);
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      toast({ title: "Client draft saved — IPs pending approval" });
    },
    onError: (e: any) => toast({ title: e.message || "Failed to save draft", variant: "destructive" }),
  });

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const updateTrunk = (idx: number, k: keyof TrunkConfig, v: any) =>
    setTrunks(p => p.map((t, i) => i === idx ? { ...t, [k]: v } : t));

  const handlePrefixChange = (idx: number, raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, 8);
    setTrunks(p => p.map((t, i) => {
      if (i !== idx) return t;
      const cld = digits.length >= 4 ? `s/^${digits}//` : t.cldTranslation;
      return { ...t, prefix: digits, cldTranslation: cld };
    }));
  };

  const selectTrunkProduct = (idx: number, productName: string) => {
    const already = trunks[idx].trunkName === productName;
    updateTrunk(idx, "trunkName", already ? "" : productName);
  };

  const routingGroupHealthy = (rgId: string) =>
    routingGroups.some(g => String(g.id) === rgId);

  const copyPassword = () => {
    navigator.clipboard.writeText(s1.password).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const shortCodeSuggest = (idx: number) => {
    const code = selectedCompany?.shortCode?.replace(/[^A-Z0-9]/gi, "").slice(0, 6).toUpperCase() ?? "TRUNK";
    return `${code}-${idx + 1}`;
  };

  // ── Step completion indicators ───────────────────────────────────────────────
  const stepComplete = (s: number): boolean => {
    if (s === 1) return !!s1.companyId && !!s1.userId.trim() && !!s1.password.trim();
    if (s === 2) return true;
    if (s === 3) return trunks.length > 0 && trunks.every(t => !!t.routingGroupId);
    if (s === 4) return ips.some(ip => ip.ip.trim());
    return false;
  };

  // ── Blur validation (inline) ────────────────────────────────────────────────
  const touch = (field: string) => setTouched(p => ({ ...p, [field]: true }));
  const fieldError = (field: string) => touched[field] ? errors[field] : undefined;

  // ── Validation ──────────────────────────────────────────────────────────────
  const validate = useCallback(() => {
    const errs: Record<string, string> = {};
    if (step === 1) {
      if (!s1.companyId) errs.companyId = "Company is required";
      if (!s1.userId.trim()) errs.userId = "Username is required";
      if (!s1.password.trim()) errs.password = "Password is required";
    }
    if (step === 3) {
      trunks.forEach((t, i) => {
        if (!t.routingGroupId) errs[`rg_${i}`] = "Routing group required";
      });
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }, [step, s1, trunks]);

  const next = () => { if (validate()) setStep(s => Math.min(s + 1, 5)); };
  const back = () => setStep(s => Math.max(s - 1, 1));

  // Enter key to advance
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && step < 5) next();
  };

  const buildPayload = () => ({
    step1: { ...s1, a2zNotif: s1.a2zNotif ? "yes" : "no" },
    step2: {
      invoiceTemplate: s2.invoiceTemplate,
      ratesheetFull: s2.ratesheetFormats.includes("Full CSV") ? "Full CSV" : s2.ratesheetFormats[0] ?? "Full CSV",
      ratesheetPartial: s2.ratesheetFormats.includes("Partial Update") ? "Partial Update" : "",
      ratesheetAtoz: s2.ratesheetFormats.includes("A2Z") ? "A2Z" : "",
      ratesheetFormats: s2.ratesheetFormats,
      dialcodeFormat: s2.dialcodeFormat,
      prefixStyle: s2.prefixStyle,
      servicePlanId: s2.servicePlanId || undefined,
    },
    trunks,
    ips: ips.filter(ip => ip.ip.trim()),
    iCustomer: 1,
    selectedProducts: activeProducts,
  });

  const handleSubmit = () => createClientMutation.mutate(buildPayload());

  const handleSaveDraft = () => {
    if (!s1.companyId || !s1.userId) {
      toast({ title: "Complete Step 1 before saving a draft", variant: "destructive" });
      return;
    }
    createClientMutation.mutate(buildPayload());
  };

  // ── Paste-multiple IPs ──────────────────────────────────────────────────────
  const handleIpPaste = (idx: number, e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData("text");
    const lines = pasted.split(/[\n\r,;]/).map(l => l.trim()).filter(l => /\d/.test(l));
    if (lines.length > 1) {
      e.preventDefault();
      const newRows = lines.map(ip => ({ ...emptyIp(), ip }));
      setIps(p => {
        const copy = [...p];
        copy.splice(idx, 1, ...newRows);
        return copy;
      });
      toast({ title: `Detected ${lines.length} IPs — split into separate rows` });
    }
  };

  // ── Toggle rate sheet format ────────────────────────────────────────────────
  const toggleFormat = (fmt: string) =>
    setS2(p => ({
      ...p,
      ratesheetFormats: p.ratesheetFormats.includes(fmt)
        ? p.ratesheetFormats.filter(f => f !== fmt)
        : [...p.ratesheetFormats, fmt],
    }));

  // ────────────────────────────────────────────────────────────────────────────
  // SUCCESS SCREEN
  // ────────────────────────────────────────────────────────────────────────────
  if (submitted) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <Card className="border-emerald-500/30 bg-emerald-500/5">
          <CardContent className="p-8 text-center space-y-4">
            <CheckCircle2 className="h-12 w-12 text-emerald-400 mx-auto" />
            <h2 className="text-lg font-semibold">Client Draft Saved</h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              The client configuration has been saved. IPs are pending admin approval.
              Once approved, an admin can provision from the Companies page.
            </p>
            <div className="text-left space-y-2 mt-4">
              {[
                { done: true,  label: "Client draft saved in BitsAuto" },
                { done: true,  label: "IPs submitted — pending admin approval" },
                { done: false, label: "Admin approves all submitted IPs" },
                { done: false, label: "Admin clicks Provision on the Companies page" },
                { done: false, label: "Sippy account + auth rules created in batch" },
                { done: false, label: "Run test call and verify CDR" },
              ].map((item, i) => (
                <div key={i} className={`flex items-center gap-2 text-sm ${item.done ? "text-emerald-400" : "text-muted-foreground"}`}>
                  {item.done ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <div className="h-3.5 w-3.5 shrink-0 border border-muted-foreground/30 rounded-full" />}
                  {item.label}
                </div>
              ))}
            </div>
            {activeProducts.length > 0 && (
              <div className="text-left pt-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Products Saved</p>
                <div className="flex flex-wrap gap-1.5">
                  {activeProducts.map(p => (
                    <Badge key={p} variant="outline" className={`text-[10px] ${PRODUCT_COLOR[p] ?? ""}`}>{p}</Badge>
                  ))}
                </div>
              </div>
            )}
            <div className="flex gap-2 justify-center pt-2">
              <Button variant="outline" size="sm" onClick={() => navigate("/company/list")}>Go to Companies</Button>
              <Button size="sm" onClick={() => { setSubmitted(false); setStep(1); setManualProducts([]); setTrunks([emptyTrunk()]); }}>Create Another</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ────────────────────────────────────────────────────────────────────────────
  // WIZARD SHELL
  // ────────────────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5" onKeyDown={handleKeyDown}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-amber-400" />
          <h1 className="text-xl font-semibold">Create Client Account</h1>
          <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-400 border-amber-500/20">
            Root Level — Not under RTST1
          </Badge>
        </div>
        {/* Save Draft visible on all steps */}
        {step > 1 && (
          <Button
            size="sm" variant="outline"
            className="gap-1.5 text-xs border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
            disabled={createClientMutation.isPending}
            onClick={handleSaveDraft}
          >
            {createClientMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            Save Draft
          </Button>
        )}
      </div>

      {/* Step breadcrumbs with completion dots */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {STEPS.map((s, i) => {
          const done = step > s.id;
          const active = step === s.id;
          const complete = done && stepComplete(s.id);
          return (
            <div key={s.id} className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => done && setStep(s.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-medium transition-colors ${
                  active  ? "bg-amber-500/10 border-amber-500/30 text-amber-400" :
                  done    ? "bg-muted/30 border-border text-muted-foreground cursor-pointer hover:border-border/80 hover:text-foreground" :
                            "border-border/40 text-muted-foreground/60"
                }`}
              >
                {complete ? <CheckCircle2 className="h-3 w-3 text-emerald-400" /> :
                 done     ? <span className="text-muted-foreground">{s.id}</span> :
                            <span>{s.id}</span>}
                <span className="hidden sm:inline">{s.label}</span>
                {active && <span className="h-1.5 w-1.5 rounded-full bg-amber-400 ml-0.5" />}
              </button>
              {i < STEPS.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground/40 shrink-0" />}
            </div>
          );
        })}
      </div>

      <div className="w-full bg-border/30 rounded-full h-1">
        <div className="bg-amber-500 h-1 rounded-full transition-all duration-300" style={{ width: `${(step / 5) * 100}%` }} />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            {(() => { const S = STEPS[step - 1]; return <S.icon className="h-4 w-4 text-amber-400" />; })()}
            {STEPS[step - 1].label}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">

          {/* ══════════════════════════════════════════════════════════════════
              STEP 1 — Department & Company
          ══════════════════════════════════════════════════════════════════ */}
          {step === 1 && (
            <div className="space-y-5">

              {/* Department — toggle pills */}
              <div className="space-y-2">
                <Label className="text-xs">Department<span className="text-rose-400 ml-0.5">*</span></Label>
                <div className="flex flex-wrap gap-2">
                  {DEPARTMENTS.map(d => (
                    <TogglePill
                      key={d.value}
                      value={d.value}
                      active={s1.department === d.value}
                      onClick={() => setS1(p => ({ ...p, department: d.value, companyId: "" }))}
                    >
                      {d.label}
                    </TogglePill>
                  ))}
                </div>
              </div>

              {/* Company — filtered by department */}
              <div className="space-y-1.5">
                <Label className="text-xs">Company<span className="text-rose-400 ml-0.5">*</span></Label>
                <Select
                  value={s1.companyId}
                  onValueChange={v => {
                    const co = companies.find(c => String(c.id) === v);
                    const name = co?.name ?? "";
                    const coAny = co as any;
                    const email = coAny?.invoiceEmail || coAny?.contacts?.billing?.[0]?.email || "";
                    setS1(p => ({
                      ...p, companyId: v, displayName: name,
                      userId: usernameLocked ? p.userId : name.replace(/[^a-zA-Z0-9._-]/g, ""),
                      notifEmailTo: email || p.notifEmailTo,
                    }));
                  }}
                >
                  <SelectTrigger data-testid="select-company" className={`h-9 text-sm ${fieldError("companyId") ? "border-rose-500" : ""}`}>
                    <SelectValue placeholder="Select company…" />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredCompanies.map(c => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name}
                        <span className="text-muted-foreground text-[10px] ml-1.5">({c.shortCode})</span>
                      </SelectItem>
                    ))}
                    {filteredCompanies.length === 0 && (
                      <SelectItem value="_none" disabled>No {s1.department} companies yet</SelectItem>
                    )}
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-2">
                  {fieldError("companyId") && <p className="text-[10px] text-rose-400">{fieldError("companyId")}</p>}
                  <a href="/company/create" className="text-[10px] text-blue-400 hover:underline ml-auto flex items-center gap-0.5">
                    <Plus className="h-3 w-3" /> Create Company
                  </a>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Display Name — auto-filled from company */}
                <div className="space-y-1.5">
                  <Label className="text-xs">Display Name<span className="text-rose-400 ml-0.5">*</span></Label>
                  <Input
                    data-testid="input-displayName"
                    className="h-9 text-sm"
                    value={s1.displayName}
                    onChange={e => {
                      const val = e.target.value;
                      setS1(p => ({
                        ...p,
                        displayName: val,
                        userId: usernameLocked ? p.userId : val.replace(/[^a-zA-Z0-9._-]/g, ""),
                      }));
                    }}
                    onBlur={() => touch("displayName")}
                    placeholder="Sippy display name"
                  />
                  <p className="text-[10px] text-muted-foreground">Auto-filled from company name — editable</p>
                </div>

                {/* Sippy Username — with lock/unlock */}
                <div className="space-y-1.5">
                  <Label className="text-xs">Sippy Username<span className="text-rose-400 ml-0.5">*</span></Label>
                  <div className="relative">
                    <Input
                      data-testid="input-userId"
                      className={`h-9 text-sm font-mono pr-9 ${fieldError("userId") ? "border-rose-500" : ""}`}
                      value={s1.userId}
                      onChange={e => setS1(p => ({ ...p, userId: e.target.value.replace(/[^a-zA-Z0-9._-]/g, "") }))}
                      onBlur={() => touch("userId")}
                      placeholder="e.g. Internal-PTCL"
                    />
                    <button
                      type="button"
                      title={usernameLocked ? "Locked — won't mirror display name" : "Unlocked — mirrors display name"}
                      onClick={() => setUsernameLocked(p => !p)}
                      className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {usernameLocked ? <Lock className="h-3.5 w-3.5 text-amber-400" /> : <LockOpen className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    {usernameLocked ? "🔒 Locked — not mirroring display name" : "Auto-mirrors display name · click 🔓 to lock"}
                  </p>
                  {fieldError("userId") && <p className="text-[10px] text-rose-400">{fieldError("userId")}</p>}
                </div>

                {/* Password — with copy icon */}
                <div className="space-y-1.5">
                  <Label className="text-xs">Password<span className="text-rose-400 ml-0.5">*</span></Label>
                  <div className="relative">
                    <Input
                      data-testid="input-password"
                      type={showPass ? "text" : "password"}
                      className="h-9 text-sm pr-16"
                      value={s1.password}
                      onChange={e => setS1(p => ({ ...p, password: e.target.value }))}
                    />
                    <div className="absolute right-1 top-1.5 flex items-center gap-0.5">
                      <button type="button" title="Copy password" onClick={copyPassword}
                        className="p-1 text-muted-foreground hover:text-foreground transition-colors">
                        {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>
                      <button type="button" onClick={() => setShowPass(p => !p)}
                        className="p-1 text-muted-foreground hover:text-foreground transition-colors">
                        {showPass ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>
                  <button type="button" className="text-[10px] text-blue-400 hover:underline"
                    onClick={() => setS1(p => ({ ...p, password: genPassword() }))}>
                    Re-generate
                  </button>
                </div>

                {/* Notification Email — auto-filled from company contacts */}
                <div className="space-y-1.5">
                  <Label className="text-xs">Notification Email (To)</Label>
                  <Input data-testid="input-notifEmailTo" type="email" className="h-9 text-sm"
                    value={s1.notifEmailTo}
                    onChange={e => setS1(p => ({ ...p, notifEmailTo: e.target.value }))}
                    placeholder="Auto-filled from company contacts"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Notification Email (CC)</Label>
                  <Input data-testid="input-notifEmailCc" type="email" className="h-9 text-sm"
                    value={s1.notifEmailCc}
                    onChange={e => setS1(p => ({ ...p, notifEmailCc: e.target.value }))}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Balance Threshold Alert</Label>
                  <Input data-testid="input-balanceThreshold" type="number" className="h-9 text-sm"
                    value={s1.balanceThreshold}
                    onChange={e => setS1(p => ({ ...p, balanceThreshold: e.target.value }))}
                    placeholder="0"
                  />
                </div>

                {/* A2Z Notification — toggle switch */}
                <div className="space-y-1.5">
                  <Label className="text-xs">A2Z Notification</Label>
                  <div className="flex items-center gap-3 h-9 px-1">
                    <Switch
                      data-testid="switch-a2zNotif"
                      checked={s1.a2zNotif}
                      onCheckedChange={v => setS1(p => ({ ...p, a2zNotif: v }))}
                    />
                    <span className="text-sm text-muted-foreground">{s1.a2zNotif ? "Enabled" : "Disabled"}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════
              STEP 2 — Rate Sheet Config
          ══════════════════════════════════════════════════════════════════ */}
          {step === 2 && (
            <div className="space-y-6">

              {/* Invoice Template — clickable tiles */}
              <div className="space-y-2">
                <Label className="text-xs">Invoice Template</Label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {INVOICE_TILES.map(tile => (
                    <button
                      key={tile.value}
                      type="button"
                      onClick={() => setS2(p => ({ ...p, invoiceTemplate: tile.value }))}
                      className={`text-left p-3 rounded-lg border transition-all space-y-1 ${
                        s2.invoiceTemplate === tile.value
                          ? "border-amber-500/50 bg-amber-500/10 text-amber-400"
                          : "border-border text-muted-foreground hover:border-border/80"
                      }`}
                    >
                      <div className="text-xs font-semibold">{tile.value}</div>
                      <div className="text-[10px] leading-snug opacity-80">{tile.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Rate Sheet Formats — multi-select tags */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Rate Sheet Formats to Generate</Label>
                  <div className="flex gap-2">
                    <button type="button" className="text-[10px] text-blue-400 hover:underline"
                      onClick={() => setS2(p => ({ ...p, ratesheetFormats: [...SHEET_FORMAT_OPTIONS] }))}>
                      Select All
                    </button>
                    <button type="button" className="text-[10px] text-muted-foreground hover:underline"
                      onClick={() => setS2(p => ({ ...p, ratesheetFormats: [] }))}>
                      Clear
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {SHEET_FORMAT_OPTIONS.map(fmt => {
                    const active = s2.ratesheetFormats.includes(fmt);
                    return (
                      <button
                        key={fmt}
                        type="button"
                        onClick={() => toggleFormat(fmt)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-all ${
                          active
                            ? "bg-blue-500/15 border-blue-500/50 text-blue-400"
                            : "border-border text-muted-foreground hover:border-border/80"
                        }`}
                      >
                        {active && <CheckCircle2 className="h-3 w-3" />}
                        {fmt}
                      </button>
                    );
                  })}
                </div>
                {s2.ratesheetFormats.length === 0 && (
                  <p className="text-[10px] text-amber-400 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" /> Select at least one format
                  </p>
                )}
              </div>

              {/* Dialcode Format — 2-option toggle */}
              <div className="space-y-2">
                <Label className="text-xs">Dialcode Format</Label>
                <SegmentedControl
                  value={s2.dialcodeFormat}
                  onChange={v => setS2(p => ({ ...p, dialcodeFormat: v }))}
                  options={[{ value: "E.164", label: "E.164 (international)" }, { value: "National", label: "National" }]}
                />
              </div>

              {/* Prefix Style — toggle with live example */}
              <div className="space-y-2">
                <Label className="text-xs">Prefix Style</Label>
                <SegmentedControl
                  value={s2.prefixStyle}
                  onChange={v => setS2(p => ({ ...p, prefixStyle: v }))}
                  options={[{ value: "with_plus", label: "+44... (with plus)" }, { value: "without_plus", label: "44... (no plus)" }]}
                />
                <p className="text-[10px] text-muted-foreground">
                  Example: <span className="font-mono">{s2.prefixStyle === "with_plus" ? "+447911123456" : "447911123456"}</span>
                </p>
              </div>

              {/* Billing Package — selects an existing Sippy Service Plan */}
              <div className="space-y-2">
                <Label className="text-xs">Billing Package (Sippy Service Plan)</Label>
                {billingPlans.length === 0 ? (
                  <div className="flex items-center gap-2 text-[10px] text-amber-400 border border-amber-500/30 rounded-lg px-3 py-2 bg-amber-500/5">
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    {billingPlansData?.error
                      ? `Could not load plans: ${billingPlansData.error}. Provision will auto-select.`
                      : "Loading billing plans from Sippy…"}
                  </div>
                ) : (
                  <Select
                    value={s2.servicePlanId}
                    onValueChange={v => setS2(p => ({ ...p, servicePlanId: v }))}
                  >
                    <SelectTrigger className="h-8 text-xs" data-testid="select-billing-package">
                      <SelectValue placeholder="— Auto-select during provisioning —" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">— Auto-select during provisioning —</SelectItem>
                      {billingPlans.map(bp => (
                        <SelectItem key={bp.id} value={String(bp.id)}>
                          {bp.name} <span className="text-muted-foreground">(#{bp.id})</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <p className="text-[10px] text-muted-foreground">
                  Selects the Sippy billing plan assigned to this account. Choose one that matches the client's product tier, or leave blank to auto-detect.
                </p>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════
              STEP 3 — Technical Config
          ══════════════════════════════════════════════════════════════════ */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 p-3 rounded-md border border-amber-500/30 bg-amber-500/5 text-amber-400 text-xs">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                Routing Group is required. Leaving it blank causes account to inherit from parent — root cause of "No Route Found" errors.
              </div>

              {trunks.map((t, idx) => {
                const product = TRUNK_PRODUCTS.find(p => p.name === t.trunkName);
                return (
                  <div
                    key={idx}
                    className={`border rounded-lg p-4 space-y-4 transition-colors ${
                      product ? product.panelBorder : "border-border/50"
                    }`}
                  >
                    {/* Trunk header */}
                    <div className="flex items-center justify-between">
                      <h3 className={`text-sm font-semibold ${product ? product.text : ""}`}>
                        {t.trunkName || `Trunk ${idx + 1}`}
                      </h3>
                      {trunks.length > 1 && (
                        <Button size="sm" variant="ghost" className="h-7 text-rose-400 text-xs"
                          onClick={() => setTrunks(p => p.filter((_, i) => i !== idx))}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </div>

                    {/* Product tiles for trunk name */}
                    <div className="space-y-1.5">
                      <Label className="text-xs">Trunk Type / Product</Label>
                      <div className="flex flex-wrap gap-2">
                        {TRUNK_PRODUCTS.map(p => (
                          <button
                            key={p.name}
                            type="button"
                            onClick={() => selectTrunkProduct(idx, p.name)}
                            className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                              t.trunkName === p.name
                                ? `${p.activeBg} ${p.border} ${p.text}`
                                : "border-border text-muted-foreground hover:border-border/80"
                            }`}
                          >
                            {t.trunkName === p.name && <CheckCircle2 className="inline h-3 w-3 mr-1" />}
                            {p.name}
                          </button>
                        ))}
                        {/* Custom name option */}
                        <button
                          type="button"
                          onClick={() => updateTrunk(idx, "trunkName", t.trunkName && !TRUNK_PRODUCT_NAMES.includes(t.trunkName) ? "" : shortCodeSuggest(idx))}
                          className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                            t.trunkName && !TRUNK_PRODUCT_NAMES.includes(t.trunkName)
                              ? "bg-muted/40 border-border text-foreground"
                              : "border-dashed border-border text-muted-foreground hover:border-border/80"
                          }`}
                        >
                          Custom…
                        </button>
                      </div>
                      {/* Custom name input shown when Custom is picked */}
                      {t.trunkName && !TRUNK_PRODUCT_NAMES.includes(t.trunkName) && (
                        <Input
                          data-testid={`input-trunk-name-${idx}`}
                          className="h-8 text-sm mt-1"
                          value={t.trunkName}
                          onChange={e => updateTrunk(idx, "trunkName", e.target.value)}
                          placeholder={shortCodeSuggest(idx)}
                        />
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {/* Routing Group — open combobox */}
                      <div className="space-y-1.5 col-span-full sm:col-span-1">
                        <Label className="text-xs">Default Routing Group<span className="text-rose-400 ml-0.5">*</span></Label>
                        <div className="relative">
                          <input
                            data-testid={`input-rg-${idx}`}
                            list={`rg-list-${idx}`}
                            className={`flex h-8 w-full rounded-md border bg-background px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${errors[`rg_${idx}`] ? "border-rose-500" : "border-input"}`}
                            placeholder="Pick from list or type group ID…"
                            value={t.routingGroupId ? (routingGroups.find(g => String(g.id) === t.routingGroupId)?.name ?? t.routingGroupId) : ""}
                            onChange={e => {
                              const raw = e.target.value;
                              const match = routingGroups.find(g => g.name === raw);
                              updateTrunk(idx, "routingGroupId", match ? String(match.id) : raw);
                            }}
                          />
                          <datalist id={`rg-list-${idx}`}>
                            {routingGroups.map(rg => <option key={rg.id} value={rg.name} />)}
                          </datalist>
                        </div>
                        {t.routingGroupId && routingGroupHealthy(t.routingGroupId) && (
                          <p className="text-[10px] text-emerald-400 flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" />
                            {routingGroups.find(g => String(g.id) === t.routingGroupId)?.name}
                          </p>
                        )}
                        {errors[`rg_${idx}`] && <p className="text-[10px] text-rose-400">{errors[`rg_${idx}`]}</p>}
                      </div>

                      {/* Max Call Time */}
                      <div className="space-y-1.5">
                        <Label className="text-xs">Max Call Time (s)</Label>
                        <Input data-testid={`input-maxTime-${idx}`} type="number" className="h-8 text-sm" value={t.maxTime} onChange={e => updateTrunk(idx, "maxTime", e.target.value)} />
                        <QuickChips options={[{ label: "1h", value: "3600" }, { label: "2h", value: "7200" }, { label: "4h", value: "14400" }]} onPick={v => updateTrunk(idx, "maxTime", v)} />
                      </div>

                      {/* Max Sessions */}
                      <div className="space-y-1.5">
                        <Label className="text-xs">Max Sessions</Label>
                        <Input data-testid={`input-maxSessions-${idx}`} type="number" className="h-8 text-sm" value={t.maxSessions} onChange={e => updateTrunk(idx, "maxSessions", e.target.value)} />
                        <QuickChips options={[{ label: "Unlimited", value: "0" }, { label: "10", value: "10" }, { label: "50", value: "50" }, { label: "100", value: "100" }]} onPick={v => updateTrunk(idx, "maxSessions", v)} />
                      </div>

                      {/* Max CPS */}
                      <div className="space-y-1.5">
                        <Label className="text-xs">Max CPS</Label>
                        <Input data-testid={`input-maxCps-${idx}`} type="number" className="h-8 text-sm" value={t.maxCps} onChange={e => updateTrunk(idx, "maxCps", e.target.value)} placeholder="Unlimited" />
                        <QuickChips options={[{ label: "1", value: "1" }, { label: "5", value: "5" }, { label: "10", value: "10" }, { label: "50", value: "50" }]} onPick={v => updateTrunk(idx, "maxCps", v)} />
                      </div>
                    </div>

                    {/* Codec — visual tiles */}
                    <div className="space-y-1.5">
                      <Label className="text-xs">Preferred Codec</Label>
                      <div className="flex flex-wrap gap-2">
                        {CODECS_VISUAL.map(c => (
                          <button
                            key={c.value}
                            type="button"
                            data-testid={`codec-tile-${c.value}-${idx}`}
                            onClick={() => updateTrunk(idx, "codec", c.value)}
                            className={`flex flex-col items-start px-3 py-2 rounded-lg border text-left transition-all ${
                              t.codec === c.value
                                ? "bg-blue-500/15 border-blue-500/50 text-blue-400"
                                : "border-border text-muted-foreground hover:border-border/80"
                            }`}
                          >
                            <span className="text-xs font-semibold">{c.label}</span>
                            <span className="text-[10px] opacity-75">{c.sub}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Media Relay — 3-way segmented control */}
                    <div className="space-y-1.5">
                      <Label className="text-xs">Media Relay</Label>
                      <SegmentedControl
                        value={t.relayType}
                        onChange={v => updateTrunk(idx, "relayType", v)}
                        options={[{ value: "0", label: "Default" }, { value: "1", label: "Always" }, { value: "2", label: "Never" }]}
                      />
                    </div>

                    {/* Prefix + CLD with live preview */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs flex items-center gap-1">
                          <Tag className="h-3 w-3 text-violet-400" /> Account Prefix
                        </Label>
                        <Input
                          data-testid={`input-prefix-${idx}`}
                          className="h-8 text-sm font-mono"
                          value={t.prefix}
                          onChange={e => handlePrefixChange(idx, e.target.value)}
                          placeholder="e.g. 8888"
                          maxLength={8}
                        />
                        {t.prefix.length >= 4 && (
                          <p className="text-[10px] text-violet-400 flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" /> CLD auto-set to <span className="font-mono">s/^{t.prefix}//</span>
                          </p>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">CLD Translation Rule</Label>
                        <Input
                          data-testid={`input-cldRule-${idx}`}
                          className="h-8 text-sm font-mono"
                          value={t.cldTranslation}
                          onChange={e => updateTrunk(idx, "cldTranslation", e.target.value)}
                        />
                        <CldPreview rule={t.cldTranslation} prefix={t.prefix} />
                      </div>
                    </div>

                    {/* Checkboxes — Allow Registration / Blocked separated */}
                    <div className="flex flex-wrap gap-x-6 gap-y-2 pt-1">
                      <div className="flex items-center gap-1.5">
                        <input type="checkbox" id={`useCodecOnly-${idx}`} data-testid={`check-useCodecOnly-${idx}`}
                          checked={t.useCodecOnly} onChange={e => updateTrunk(idx, "useCodecOnly", e.target.checked)}
                          className="h-3.5 w-3.5 rounded border-border accent-amber-500" />
                        <label htmlFor={`useCodecOnly-${idx}`} className="text-xs cursor-pointer">Use Preferred Codec Only</label>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <input type="checkbox" id={`preventLoops-${idx}`} data-testid={`check-preventLoops-${idx}`}
                          checked={t.preventLoops} onChange={e => updateTrunk(idx, "preventLoops", e.target.checked)}
                          className="h-3.5 w-3.5 rounded border-border accent-amber-500" />
                        <label htmlFor={`preventLoops-${idx}`} className="text-xs cursor-pointer">Prevent Call Loops</label>
                      </div>
                      {/* Visual separator between registration vs blocked */}
                      <div className="w-full border-t border-border/30 my-0.5" />
                      <div className="flex items-center gap-1.5">
                        <input type="checkbox" id={`allowReg-${idx}`} data-testid={`check-allowRegistration-${idx}`}
                          checked={t.allowRegistration} onChange={e => updateTrunk(idx, "allowRegistration", e.target.checked)}
                          className="h-3.5 w-3.5 rounded border-border accent-emerald-500" />
                        <label htmlFor={`allowReg-${idx}`} className="text-xs cursor-pointer text-emerald-500/90">Allow Registration</label>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <input type="checkbox" id={`blocked-${idx}`} data-testid={`check-blocked-${idx}`}
                          checked={t.blocked} onChange={e => updateTrunk(idx, "blocked", e.target.checked)}
                          className="h-3.5 w-3.5 rounded border-border accent-rose-500" />
                        <label htmlFor={`blocked-${idx}`} className="text-xs cursor-pointer text-rose-400">Blocked</label>
                      </div>
                    </div>
                  </div>
                );
              })}

              <Button data-testid="btn-add-trunk" size="sm" variant="outline" className="gap-1.5 text-xs"
                onClick={() => setTrunks(p => [...p, emptyTrunk()])}>
                <Plus className="h-3 w-3" /> Add Another Trunk
              </Button>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════
              STEP 4 — IPs & Products
          ══════════════════════════════════════════════════════════════════ */}
          {step === 4 && (
            <div className="space-y-6">

              {/* IP Addresses */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium">Client IP Addresses</h3>
                  <Button data-testid="btn-add-ip" size="sm" variant="outline" className="h-7 text-xs gap-1"
                    onClick={() => setIps(p => [...p, emptyIp()])}>
                    <Plus className="h-3 w-3" /> Add IP
                  </Button>
                </div>
                <div className="flex items-center gap-2 p-3 rounded-md border border-blue-500/30 bg-blue-500/5 text-blue-400 text-xs mb-3">
                  <Info className="h-3.5 w-3.5 shrink-0" />
                  Paste multiple IPs separated by newline, comma, or semicolon — they'll auto-split into rows.
                </div>
                <div className="space-y-2">
                  {ips.map((ip, idx) => (
                    <div key={idx} className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
                      <div className="space-y-1">
                        <Label className="text-[10px]">IP Address<span className="text-rose-400">*</span></Label>
                        <Input
                          data-testid={`input-ip-${idx}`}
                          className="h-7 text-xs font-mono"
                          value={ip.ip}
                          onChange={e => setIps(p => p.map((x, i) => i === idx ? { ...x, ip: e.target.value } : x))}
                          onPaste={e => handleIpPaste(idx, e)}
                          placeholder="192.168.1.1"
                        />
                      </div>
                      {/* Trunk — dropdown from Step 3 trunks */}
                      <div className="space-y-1">
                        <Label className="text-[10px]">Trunk</Label>
                        <Select
                          value={ip.trunk || "_none"}
                          onValueChange={v => setIps(p => p.map((x, i) => i === idx ? { ...x, trunk: v === "_none" ? "" : v } : x))}
                        >
                          <SelectTrigger data-testid={`select-ip-trunk-${idx}`} className="h-7 text-xs">
                            <SelectValue placeholder="Any trunk" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="_none">Any trunk</SelectItem>
                            {trunks.filter(t => t.trunkName).map((t, ti) => (
                              <SelectItem key={ti} value={t.trunkName}>{t.trunkName}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px]">Description</Label>
                        <Input data-testid={`input-ip-desc-${idx}`} className="h-7 text-xs" value={ip.description}
                          onChange={e => setIps(p => p.map((x, i) => i === idx ? { ...x, description: e.target.value } : x))} />
                      </div>
                      <div className="flex items-end gap-1">
                        <Button
                          data-testid={`btn-submit-ip-${idx}`}
                          size="sm" variant="outline" className="h-7 text-xs gap-1"
                          disabled={!ip.ip.trim() || submitIpMutation.isPending}
                          onClick={() => {
                            const clientName = selectedCompany?.name || s1.userId || "";
                            if (!clientName.trim()) {
                              toast({ title: "Select a company first", variant: "destructive" }); return;
                            }
                            submitIpMutation.mutate({
                              clientName,
                              companyId: s1.companyId ? parseInt(s1.companyId, 10) : null,
                              ipAddress: ip.ip.trim(),
                              trunk: ip.trunk || null,
                              description: ip.description || null,
                            });
                          }}
                        >
                          <CheckCircle2 className="h-3 w-3" /> Register
                        </Button>
                        <Button data-testid={`btn-remove-ip-${idx}`} size="sm" variant="ghost" className="h-7 text-rose-400"
                          onClick={() => setIps(p => p.filter((_, i) => i !== idx))} disabled={ips.length === 1}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Products — auto-derived from trunk names, or manual */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Package className="h-4 w-4 text-amber-400" />
                  <h3 className="text-sm font-medium">Products Offered</h3>
                  {productsAreDerived
                    ? <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/30">Auto-derived from trunk config</Badge>
                    : <span className="text-[10px] text-muted-foreground">(select all that apply)</span>
                  }
                  {!productsAreDerived && (
                    <div className="ml-auto flex gap-2">
                      <button type="button" className="text-[10px] text-blue-400 hover:underline"
                        onClick={() => setManualProducts(TRUNK_PRODUCT_NAMES)}>Select All</button>
                      <button type="button" className="text-[10px] text-muted-foreground hover:underline"
                        onClick={() => setManualProducts([])}>Clear</button>
                    </div>
                  )}
                </div>

                {productsAreDerived ? (
                  <div className="flex flex-wrap gap-2 p-3 border border-emerald-500/20 bg-emerald-500/5 rounded-lg">
                    {derivedProducts.map(p => (
                      <Badge key={p} variant="outline" className={`text-xs ${PRODUCT_COLOR[p] ?? ""}`}>{p}</Badge>
                    ))}
                    <p className="w-full text-[10px] text-muted-foreground mt-1">
                      Derived from trunk names in Step 3. Go back to change.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {TRUNK_PRODUCTS.map(({ name: p, activeBg, border, text }) => {
                      const checked = manualProducts.includes(p);
                      return (
                        <button
                          key={p}
                          type="button"
                          data-testid={`check-product-${p.replace(/\s+/g, "-").toLowerCase()}`}
                          onClick={() => setManualProducts(prev => checked ? prev.filter(x => x !== p) : [...prev, p])}
                          className={`flex items-center gap-2 border rounded-lg p-3 text-left transition-all ${
                            checked ? `${activeBg} ${border} ${text}` : "border-border/50 text-muted-foreground hover:border-border"
                          }`}
                        >
                          <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                            checked ? "border-current" : "border-muted-foreground/40"
                          }`}>
                            {checked && <CheckCircle2 className="h-3 w-3" />}
                          </div>
                          <span className="text-xs font-medium leading-tight">{p}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════
              STEP 5 — Review & Save
          ══════════════════════════════════════════════════════════════════ */}
          {step === 5 && (
            <div className="space-y-4">
              {/* Each section clickable to jump back */}
              {[
                {
                  label: "Department & Company", jumpTo: 1,
                  rows: [
                    ["Company",          selectedCompany?.name || s1.companyId],
                    ["Department",       s1.department],
                    ["Sippy Username",   s1.userId],
                    ["Customer Context", "i_customer = 1 (Root — not under RTST1)"],
                    ["Notif Email",      s1.notifEmailTo || "—"],
                    ["A2Z Notif",        s1.a2zNotif ? "Enabled" : "Disabled"],
                  ]
                },
                {
                  label: "Rate Sheet Config", jumpTo: 2,
                  rows: [
                    ["Invoice Template", s2.invoiceTemplate],
                    ["Formats",         s2.ratesheetFormats.join(", ") || "None selected"],
                    ["Dialcode Format", s2.dialcodeFormat],
                    ["Prefix Style",    s2.prefixStyle.replace("_", " ")],
                    ["Billing Package", s2.servicePlanId ? (billingPlans.find(b => String(b.id) === s2.servicePlanId)?.name ?? `Plan #${s2.servicePlanId}`) : "Auto-select"],
                  ]
                },
              ].map(section => (
                <button
                  key={section.label}
                  type="button"
                  onClick={() => setStep(section.jumpTo)}
                  className="w-full text-left border border-border/40 hover:border-border rounded-lg p-3 transition-colors group"
                >
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{section.label}</p>
                    <span className="text-[10px] text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity">Click to edit →</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    {section.rows.map(([l, v]) => (
                      <div key={l} className="flex items-start gap-2">
                        <span className="text-[10px] text-muted-foreground w-28 shrink-0">{l}</span>
                        <span className="text-[10px] font-medium truncate">{v as string}</span>
                      </div>
                    ))}
                  </div>
                </button>
              ))}

              {/* Trunk review — clickable to Step 3 */}
              <button type="button" onClick={() => setStep(3)}
                className="w-full text-left border border-border/40 hover:border-border rounded-lg p-3 transition-colors group">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Technical Config ({trunks.length} trunk{trunks.length !== 1 ? "s" : ""})
                  </p>
                  <span className="text-[10px] text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity">Click to edit →</span>
                </div>
                <div className="space-y-2">
                  {trunks.map((t, i) => {
                    const product = TRUNK_PRODUCTS.find(p => p.name === t.trunkName);
                    return (
                      <div key={i} className={`border rounded p-2 text-xs space-y-1 ${product ? product.panelBorder : "border-border/30"}`}>
                        <div className={`font-medium ${product ? product.text : ""}`}>{t.trunkName || `Trunk ${i + 1}`}</div>
                        <div className="grid grid-cols-3 gap-1 text-[10px] text-muted-foreground">
                          <span>RG: <span className={routingGroupHealthy(t.routingGroupId) ? "text-emerald-400" : "text-rose-400"}>
                            {routingGroups.find(g => String(g.id) === t.routingGroupId)?.name || (t.routingGroupId || "⚠ Not set")}
                          </span></span>
                          <span>Sessions: {t.maxSessions === "0" ? "Unlimited" : t.maxSessions || "—"}</span>
                          <span>CPS: {t.maxCps || "—"}</span>
                        </div>
                        {t.cldTranslation && t.cldTranslation !== "s/^//" && (
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-[10px] bg-muted/30 px-1.5 py-0.5 rounded">{t.cldTranslation}</span>
                            <CldPreview rule={t.cldTranslation} prefix={t.prefix} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </button>

              {/* IPs + Products review */}
              <button type="button" onClick={() => setStep(4)}
                className="w-full text-left border border-border/40 hover:border-border rounded-lg p-3 transition-colors group">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">IPs & Products</p>
                  <span className="text-[10px] text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity">Click to edit →</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {ips.filter(ip => ip.ip.trim()).map((ip, i) => (
                    <span key={i} className="text-[10px] font-mono bg-muted/30 border border-border/40 rounded px-1.5 py-0.5">{ip.ip}</span>
                  ))}
                  {activeProducts.map(p => (
                    <Badge key={p} variant="outline" className={`text-[10px] ${PRODUCT_COLOR[p] ?? ""}`}>{p}</Badge>
                  ))}
                </div>
              </button>

              <div className="flex items-center gap-2 p-3 rounded-md border border-amber-500/30 bg-amber-500/5 text-amber-400 text-xs">
                <Info className="h-3.5 w-3.5 shrink-0" />
                Saving this draft does NOT create an account in Sippy. An admin must approve IPs and click Provision on the Companies page.
              </div>
              <div className="flex items-center gap-2 p-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 text-emerald-400 text-xs">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                Account will be created at root level (i_customer = 1) — no routing inheritance issues.
              </div>
            </div>
          )}

        </CardContent>
      </Card>

      {/* Footer — navigation + save draft on all steps */}
      <div className="flex items-center justify-between gap-2">
        <Button data-testid="btn-wizard-back" variant="outline" onClick={back} disabled={step === 1} className="gap-1.5">
          <ChevronLeft className="h-4 w-4" /> Back
        </Button>

        <div className="flex items-center gap-2">
          {step > 1 && step < 5 && (
            <Button
              size="sm" variant="ghost"
              className="gap-1.5 text-xs text-muted-foreground hover:text-amber-400"
              disabled={createClientMutation.isPending}
              onClick={handleSaveDraft}
            >
              <Save className="h-3.5 w-3.5" /> Save Draft
            </Button>
          )}
          {step < 5 ? (
            <Button data-testid="btn-wizard-next" onClick={next} className="gap-1.5">
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              data-testid="btn-wizard-submit"
              onClick={handleSubmit}
              disabled={createClientMutation.isPending}
              className="gap-1.5"
            >
              {createClientMutation.isPending
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving Draft…</>
                : <><Zap className="h-4 w-4" /> Save Client Draft</>
              }
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

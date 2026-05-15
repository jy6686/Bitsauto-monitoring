import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Users, ChevronRight, ChevronLeft, CheckCircle2, Plus, Trash2,
  AlertTriangle, ShieldCheck, Server, Network, FileText,
  Loader2, Info, Eye, EyeOff, Tag, Package,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Company } from "@shared/schema";

const STEPS = [
  { id: 1, label: "Department & Company",  icon: Users },
  { id: 2, label: "Rate Sheet Config",     icon: FileText },
  { id: 3, label: "Technical Config",      icon: Server },
  { id: 4, label: "IPs & Products",        icon: Network },
  { id: 5, label: "Review & Save",         icon: CheckCircle2 },
];

const CODECS = [
  { value: "none", label: "None / Disabled" },
  { value: "0",    label: "G.711u (PCMU)" },
  { value: "8",    label: "G.711a (PCMA)" },
  { value: "9",    label: "G.722" },
  { value: "18",   label: "G.729" },
  { value: "3",    label: "GSM" },
  { value: "4",    label: "G.723" },
  { value: "15",   label: "G.728" },
];

const PRODUCTS = [
  { id: "First Class",    color: "amber" },
  { id: "Business Class", color: "blue"  },
  { id: "Special Charlie",color: "violet"},
  { id: "Special Bravo",  color: "emerald"},
];

const PRODUCT_COLOR: Record<string, string> = {
  "First Class":    "bg-amber-500/10 text-amber-400 border-amber-500/30",
  "Business Class": "bg-blue-500/10 text-blue-400 border-blue-500/30",
  "Special Charlie":"bg-violet-500/10 text-violet-400 border-violet-500/30",
  "Special Bravo":  "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
};

const RELAY_TYPES     = [{ v:"0", l:"Default" },{ v:"1", l:"Always Relay" },{ v:"2", l:"Never Relay" }];
const INVOICE_TEMPLATES = ["Standard","Retail","Wholesale","Custom"];
const SHEET_FORMATS   = ["Full CSV","Excel XLSX","PDF","Partial Update","A2Z"];

function genPassword(len = 12) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#";
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

interface TrunkConfig {
  trunkName: string; routingGroupId: string; maxTime: string; maxSessions: string;
  maxCps: string; codec: string; useCodecOnly: boolean; lifetime: string;
  relayType: string;
  prefix: string;           // 4-digit account prefix (auto-generates CLD rule)
  cldTranslation: string;
  assertedIdRule: string;
  useAssertedId: boolean; preventLoops: boolean; allowRegistration: boolean; blocked: boolean;
}
interface IpEntry { ip: string; trunk: string; description: string; status: string; }

const emptyTrunk = (): TrunkConfig => ({
  trunkName:"", routingGroupId:"", maxTime:"3600", maxSessions:"0", maxCps:"",
  codec:"none", useCodecOnly:false, lifetime:"never", relayType:"0",
  prefix:"", cldTranslation:"s/^//", assertedIdRule:"", useAssertedId:false,
  preventLoops:false, allowRegistration:true, blocked:false,
});
const emptyIp = (): IpEntry => ({ ip:"", trunk:"", description:"", status:"pending" });

export default function ClientWizardPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [errors, setErrors] = useState<Record<string,string>>({});
  const [showPass, setShowPass] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const [s1, setS1] = useState({
    department:"retail", companyId:"", password:genPassword(),
    displayName:"", userId:"", notifEmailTo:"", notifEmailCc:"",
    balanceThreshold:"", a2zNotif:"no", rateNotif:"full_sheet",
  });
  const [s2, setS2] = useState({
    invoiceTemplate:"Standard", ratesheetFull:"Full CSV", ratesheetPartial:"Partial Update",
    ratesheetAtoz:"A2Z", dialcodeFormat:"E.164", prefixStyle:"with_plus",
  });
  const [trunks, setTrunks] = useState<TrunkConfig[]>([emptyTrunk()]);
  const [ips, setIps] = useState<IpEntry[]>([emptyIp()]);
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);

  const { data: companiesData } = useQuery<{ companies: Company[] }>({ queryKey: ["/api/companies"] });
  const { data: routingData } = useQuery<{ groups: { id: number; name: string }[] }>({
    queryKey: ["/api/sippy/routing-groups"],
    retry: false,
  });

  const submitIpMutation = useMutation({
    mutationFn: (payload: any) => apiRequest("POST", "/api/client-ip-requests", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/client-ip-requests"] });
      toast({ title: "IP registered successfully" });
    },
    onError: (e: any) => {
      const msg = e?.message || String(e) || "Failed to register IP";
      toast({ title: "IP registration failed", description: msg, variant: "destructive" });
    },
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

  const companies     = companiesData?.companies ?? [];
  const routingGroups = routingData?.groups ?? [];
  const selectedCompany = companies.find(c => String(c.id) === s1.companyId);

  const validate = () => {
    const errs: Record<string,string> = {};
    if (step === 1) {
      if (!s1.companyId) errs.companyId = "Company is required";
      if (!s1.userId.trim()) errs.userId = "User ID is required";
      if (!s1.password.trim()) errs.password = "Password is required";
    }
    if (step === 3) {
      trunks.forEach((t, i) => {
        if (!t.routingGroupId) errs[`rg_${i}`] = "Routing group required";
      });
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const next = () => { if (validate()) setStep(s => Math.min(s + 1, 5)); };
  const back = () => setStep(s => Math.max(s - 1, 1));

  const updateTrunk = (idx: number, k: keyof TrunkConfig, v: any) =>
    setTrunks(p => p.map((t, i) => i === idx ? { ...t, [k]: v } : t));

  // When prefix field changes, auto-generate CLD rule for 4-digit codes
  const handlePrefixChange = (idx: number, raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, 8);
    setTrunks(p => p.map((t, i) => {
      if (i !== idx) return t;
      const cld = digits.length >= 4 ? `s/^${digits}//` : t.cldTranslation;
      return { ...t, prefix: digits, cldTranslation: cld };
    }));
  };

  const toggleProduct = (p: string) =>
    setSelectedProducts(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);

  const routingGroupHealthy = (rgId: string) =>
    rgId && routingGroups.some(g => String(g.id) === rgId);

  const handleSubmit = () => {
    const validIps = ips.filter(ip => ip.ip.trim());
    createClientMutation.mutate({
      step1: s1, step2: s2, trunks, ips: validIps,
      iCustomer: 1, selectedProducts,
    });
  };

  if (submitted) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <Card className="border-emerald-500/30 bg-emerald-500/5">
          <CardContent className="p-8 text-center space-y-4">
            <CheckCircle2 className="h-12 w-12 text-emerald-400 mx-auto" />
            <h2 className="text-lg font-semibold">Client Draft Saved</h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              The client configuration has been saved. IPs are pending admin approval.
              Once all IPs are approved, an admin can provision this client to Sippy from the Companies page.
            </p>
            <div className="text-left space-y-2 mt-4">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Next Steps</p>
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
            {selectedProducts.length > 0 && (
              <div className="text-left pt-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Products Saved</p>
                <div className="flex flex-wrap gap-1.5">
                  {selectedProducts.map(p => (
                    <Badge key={p} variant="outline" className={`text-[10px] ${PRODUCT_COLOR[p] ?? ""}`}>{p}</Badge>
                  ))}
                </div>
              </div>
            )}
            <div className="flex gap-2 justify-center pt-2">
              <Button variant="outline" size="sm" onClick={() => navigate("/company/list")}>Go to Companies</Button>
              <Button size="sm" onClick={() => { setSubmitted(false); setStep(1); setSelectedProducts([]); }}>Create Another</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex items-center gap-2">
        <Users className="h-5 w-5 text-amber-400" />
        <h1 className="text-xl font-semibold">Create Client Account</h1>
        <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-400 border-amber-500/20">Root Level — Not under RTST1</Badge>
      </div>

      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {STEPS.map((s, i) => (
          <div key={s.id} className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => step > s.id && setStep(s.id)}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border transition-colors ${
                step === s.id ? "bg-amber-500/10 border-amber-500/30 text-amber-400" :
                step > s.id ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 cursor-pointer" :
                "border-border text-muted-foreground"
              }`}
            >
              {step > s.id ? <CheckCircle2 className="h-3 w-3" /> : <span>{s.id}</span>}
              <span className="hidden sm:inline">{s.label}</span>
            </button>
            {i < STEPS.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />}
          </div>
        ))}
      </div>

      <div className="w-full bg-border/30 rounded-full h-1">
        <div className="bg-amber-500 h-1 rounded-full transition-all" style={{ width: `${(step / 5) * 100}%` }} />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            {(() => { const S = STEPS[step-1]; return <S.icon className="h-4 w-4 text-amber-400" />; })()}
            {STEPS[step-1].label}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">

          {/* ── STEP 1 — Department & Company ─────────────────────────────── */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Department<span className="text-rose-400 ml-0.5">*</span></Label>
                  <Select value={s1.department} onValueChange={v => setS1(p => ({ ...p, department: v, companyId: "" }))}>
                    <SelectTrigger data-testid="select-department" className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="retail">Retail</SelectItem>
                      <SelectItem value="wholesale">Wholesale</SelectItem>
                      <SelectItem value="enterprise">Enterprise</SelectItem>
                      <SelectItem value="carrier">Carrier</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Company<span className="text-rose-400 ml-0.5">*</span></Label>
                  <Select value={s1.companyId} onValueChange={v => {
                    const co = companies.find(c => String(c.id) === v);
                    const name = co ? co.name : "";
                    setS1(p => ({ ...p, companyId: v, displayName: name, userId: name.toLowerCase().replace(/[^a-z0-9._-]/g, "") }));
                  }}>
                    <SelectTrigger data-testid="select-company" className={`h-8 text-sm ${errors.companyId ? "border-rose-500" : ""}`}><SelectValue placeholder="Select company…" /></SelectTrigger>
                    <SelectContent>
                      {companies.filter(c => !s1.department || c.department === s1.department || c.companyType === s1.department).map(c => (
                        <SelectItem key={c.id} value={String(c.id)}>{c.name} <span className="text-muted-foreground text-[10px]">({c.shortCode})</span></SelectItem>
                      ))}
                      {companies.length === 0 && <SelectItem value="_none" disabled>No companies — create one first</SelectItem>}
                    </SelectContent>
                  </Select>
                  {errors.companyId && <p className="text-[10px] text-rose-400">{errors.companyId}</p>}
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Display Name<span className="text-rose-400 ml-0.5">*</span></Label>
                  <Input
                    data-testid="input-displayName"
                    className="h-8 text-sm"
                    value={s1.displayName}
                    onChange={e => setS1(p => ({
                      ...p,
                      displayName: e.target.value,
                      userId: e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ""),
                    }))}
                    placeholder="Sippy display name"
                  />
                  <p className="text-[10px] text-muted-foreground">Sippy account display name — username auto-derives (lowercase)</p>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Sippy Username<span className="text-rose-400 ml-0.5">*</span></Label>
                  <Input
                    data-testid="input-userId"
                    className={`h-8 text-sm font-mono ${errors.userId ? "border-rose-500" : ""}`}
                    value={s1.userId}
                    onChange={e => setS1(p => ({ ...p, userId: e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, "") }))}
                    placeholder="lowercase, alphanumeric"
                  />
                  <p className="text-[10px] text-muted-foreground">Sippy requires lowercase alphanumeric only</p>
                  {errors.userId && <p className="text-[10px] text-rose-400">{errors.userId}</p>}
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Password<span className="text-rose-400 ml-0.5">*</span></Label>
                  <div className="relative">
                    <Input
                      data-testid="input-password"
                      type={showPass ? "text" : "password"}
                      className="h-8 text-sm pr-8"
                      value={s1.password}
                      onChange={e => setS1(p => ({ ...p, password: e.target.value }))}
                    />
                    <button type="button" className="absolute right-2 top-2 text-muted-foreground hover:text-foreground" onClick={() => setShowPass(p => !p)}>
                      {showPass ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                  <button type="button" className="text-[10px] text-blue-400 hover:underline" onClick={() => setS1(p => ({ ...p, password: genPassword() }))}>Re-generate</button>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Notification Email (To)</Label>
                  <Input data-testid="input-notifEmailTo" type="email" className="h-8 text-sm" value={s1.notifEmailTo} onChange={e => setS1(p => ({ ...p, notifEmailTo: e.target.value }))} />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Notification Email (CC)</Label>
                  <Input data-testid="input-notifEmailCc" type="email" className="h-8 text-sm" value={s1.notifEmailCc} onChange={e => setS1(p => ({ ...p, notifEmailCc: e.target.value }))} />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Balance Threshold Alert</Label>
                  <Input data-testid="input-balanceThreshold" type="number" className="h-8 text-sm" value={s1.balanceThreshold} onChange={e => setS1(p => ({ ...p, balanceThreshold: e.target.value }))} placeholder="0" />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">A2Z Notification</Label>
                  <Select value={s1.a2zNotif} onValueChange={v => setS1(p => ({ ...p, a2zNotif: v }))}>
                    <SelectTrigger data-testid="select-a2zNotif" className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="yes">Yes</SelectItem>
                      <SelectItem value="no">No</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {!s1.companyId && (
                <div className="flex items-center gap-2 p-3 rounded-md border border-amber-500/30 bg-amber-500/5 text-amber-400 text-xs">
                  <Info className="h-3.5 w-3.5 shrink-0" />
                  No company selected.{" "}
                  <a href="/company/create" className="underline font-medium hover:text-amber-300">Create a company first</a> if the list is empty.
                </div>
              )}
            </div>
          )}

          {/* ── STEP 2 — Rate Sheet Config ─────────────────────────────────── */}
          {step === 2 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {([
                ["invoiceTemplate", "Invoice Template", INVOICE_TEMPLATES],
                ["ratesheetFull",   "Full Rate Sheet Format", SHEET_FORMATS],
                ["ratesheetPartial","Partial Rate Sheet Format", SHEET_FORMATS],
                ["ratesheetAtoz",  "A2Z Rate Sheet Format", SHEET_FORMATS],
                ["dialcodeFormat", "Dialcode Format", ["E.164","National","Local"]],
                ["prefixStyle",    "Prefix Style", ["with_plus","without_plus"]],
              ] as [keyof typeof s2, string, string[]][]).map(([key, label, opts]) => (
                <div key={key} className="space-y-1.5">
                  <Label className="text-xs">{label}</Label>
                  <Select value={s2[key]} onValueChange={v => setS2(p => ({ ...p, [key]: v }))}>
                    <SelectTrigger data-testid={`select-${key}`} className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>{opts.map(o => <SelectItem key={o} value={o}>{o.replace("_"," ")}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          )}

          {/* ── STEP 3 — Technical Config ──────────────────────────────────── */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 p-3 rounded-md border border-amber-500/30 bg-amber-500/5 text-amber-400 text-xs">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                Routing Group is required. Leaving it blank causes the account to inherit from the parent customer — this is the root cause of "No Route Found" errors.
              </div>

              {trunks.map((t, idx) => (
                <div key={idx} className="border border-border/50 rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium">Trunk {idx + 1}</h3>
                    {trunks.length > 1 && (
                      <Button size="sm" variant="ghost" className="h-7 text-rose-400 text-xs" onClick={() => setTrunks(p => p.filter((_,i) => i !== idx))}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Trunk / Switch Name</Label>
                      <Input data-testid={`input-trunk-name-${idx}`} className="h-8 text-sm" value={t.trunkName} onChange={e => updateTrunk(idx, "trunkName", e.target.value)} placeholder="e.g. SB-1 PREMIUM" />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs">Default Routing Group<span className="text-rose-400 ml-0.5">*</span></Label>
                      <Select value={t.routingGroupId} onValueChange={v => updateTrunk(idx, "routingGroupId", v)}>
                        <SelectTrigger data-testid={`select-rg-${idx}`} className={`h-8 text-sm ${errors[`rg_${idx}`] ? "border-rose-500" : ""}`}><SelectValue placeholder="Select group…" /></SelectTrigger>
                        <SelectContent>
                          {routingGroups.map(rg => <SelectItem key={rg.id} value={String(rg.id)}>{rg.name}</SelectItem>)}
                          {routingGroups.length === 0 && <SelectItem value="_none" disabled>Loading groups…</SelectItem>}
                        </SelectContent>
                      </Select>
                      {t.routingGroupId && routingGroupHealthy(t.routingGroupId) && (
                        <p className="text-[10px] text-emerald-400 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Group found</p>
                      )}
                      {errors[`rg_${idx}`] && <p className="text-[10px] text-rose-400">{errors[`rg_${idx}`]}</p>}
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs">Max Call Time (s)</Label>
                      <Input data-testid={`input-maxTime-${idx}`} type="number" className="h-8 text-sm" value={t.maxTime} onChange={e => updateTrunk(idx, "maxTime", e.target.value)} />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs">Max Sessions (0=unlimited)</Label>
                      <Input data-testid={`input-maxSessions-${idx}`} type="number" className="h-8 text-sm" value={t.maxSessions} onChange={e => updateTrunk(idx, "maxSessions", e.target.value)} />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs">Max CPS</Label>
                      <Input data-testid={`input-maxCps-${idx}`} type="number" className="h-8 text-sm" value={t.maxCps} onChange={e => updateTrunk(idx, "maxCps", e.target.value)} />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs">Preferred Codec</Label>
                      <Select value={t.codec} onValueChange={v => updateTrunk(idx, "codec", v)}>
                        <SelectTrigger data-testid={`select-codec-${idx}`} className="h-8 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>{CODECS.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs">Media Relay Type</Label>
                      <Select value={t.relayType} onValueChange={v => updateTrunk(idx, "relayType", v)}>
                        <SelectTrigger data-testid={`select-relay-${idx}`} className="h-8 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>{RELAY_TYPES.map(r => <SelectItem key={r.v} value={r.v}>{r.l}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>

                    {/* ── Prefix + CLD (linked) ─────────────────────────── */}
                    <div className="space-y-1.5">
                      <Label className="text-xs flex items-center gap-1">
                        <Tag className="h-3 w-3 text-violet-400" />
                        Account Prefix
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
                      {t.prefix.length > 0 && t.prefix.length < 4 && (
                        <p className="text-[10px] text-muted-foreground">Enter 4+ digits to auto-generate CLD rule</p>
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
                      <p className="text-[10px] text-muted-foreground">Auto-filled when prefix ≥ 4 digits</p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-4 pt-1">
                    {([
                      ["useCodecOnly",   "Use Preferred Codec Only"],
                      ["preventLoops",   "Prevent Call Loops"],
                      ["allowRegistration","Allow Registration"],
                      ["blocked",        "Blocked"],
                    ] as [keyof TrunkConfig, string][]).map(([k, lbl]) => (
                      <div key={k} className="flex items-center gap-1.5">
                        <Checkbox
                          data-testid={`check-${k}-${idx}`}
                          id={`${k}-${idx}`}
                          checked={!!t[k]}
                          onCheckedChange={v => updateTrunk(idx, k, !!v)}
                        />
                        <label htmlFor={`${k}-${idx}`} className="text-xs cursor-pointer">{lbl}</label>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              <Button data-testid="btn-add-trunk" size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => setTrunks(p => [...p, emptyTrunk()])}>
                <Plus className="h-3 w-3" /> Add Another Trunk
              </Button>
            </div>
          )}

          {/* ── STEP 4 — IPs & Products ────────────────────────────────────── */}
          {step === 4 && (
            <div className="space-y-6">

              {/* IP Addresses */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium">Client IP Addresses</h3>
                  <Button data-testid="btn-add-ip" size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setIps(p => [...p, emptyIp()])}>
                    <Plus className="h-3 w-3" /> Add IP
                  </Button>
                </div>
                <div className="flex items-center gap-2 p-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 text-emerald-400 text-xs mb-3">
                  <Info className="h-3.5 w-3.5 shrink-0" />
                  Add the client IP addresses below. Click Register to save each IP — no approval step required.
                </div>
                {ips.map((ip, idx) => (
                  <div key={idx} className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end mb-2">
                    <div className="space-y-1">
                      <Label className="text-[10px]">IP Address<span className="text-rose-400">*</span></Label>
                      <Input data-testid={`input-ip-${idx}`} className="h-7 text-xs font-mono" value={ip.ip} onChange={e => setIps(p => p.map((x,i) => i===idx ? {...x, ip:e.target.value} : x))} placeholder="192.168.1.1" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px]">Trunk</Label>
                      <Input data-testid={`input-ip-trunk-${idx}`} className="h-7 text-xs" value={ip.trunk} onChange={e => setIps(p => p.map((x,i) => i===idx ? {...x, trunk:e.target.value} : x))} placeholder="e.g. SB-1" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px]">Description</Label>
                      <Input data-testid={`input-ip-desc-${idx}`} className="h-7 text-xs" value={ip.description} onChange={e => setIps(p => p.map((x,i) => i===idx ? {...x, description:e.target.value} : x))} />
                    </div>
                    <div className="flex items-end gap-1">
                      <Button
                        data-testid={`btn-submit-ip-${idx}`}
                        size="sm" variant="outline" className="h-7 text-xs gap-1"
                        disabled={!ip.ip.trim() || submitIpMutation.isPending}
                        onClick={() => {
                          const clientName = selectedCompany?.name || s1.userId || "";
                          if (!clientName.trim()) {
                            toast({ title: "Select a company first before registering an IP", variant: "destructive" });
                            return;
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
                      <Button data-testid={`btn-remove-ip-${idx}`} size="sm" variant="ghost" className="h-7 text-rose-400" onClick={() => setIps(p => p.filter((_,i) => i !== idx))} disabled={ips.length === 1}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Products Offered */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Package className="h-4 w-4 text-amber-400" />
                  <h3 className="text-sm font-medium">Products Offered</h3>
                  <span className="text-[10px] text-muted-foreground">(select all that apply)</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {PRODUCTS.map(({ id: p }) => {
                    const checked = selectedProducts.includes(p);
                    return (
                      <button
                        key={p}
                        data-testid={`check-product-${p.replace(/\s+/g, "-").toLowerCase()}`}
                        onClick={() => toggleProduct(p)}
                        className={`flex items-center gap-2 border rounded-lg p-3 text-left transition-all ${
                          checked
                            ? `${PRODUCT_COLOR[p]} border-opacity-60`
                            : "border-border/50 text-muted-foreground hover:border-border"
                        }`}
                      >
                        <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                          checked ? "border-current bg-current/20" : "border-muted-foreground/40"
                        }`}>
                          {checked && <CheckCircle2 className="h-3 w-3" />}
                        </div>
                        <span className="text-xs font-medium leading-tight">{p}</span>
                      </button>
                    );
                  })}
                </div>
                {selectedProducts.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {selectedProducts.map(p => (
                      <Badge key={p} variant="outline" className={`text-[10px] ${PRODUCT_COLOR[p] ?? ""}`}>{p}</Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── STEP 5 — Review & Save ─────────────────────────────────────── */}
          {step === 5 && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                {[
                  { label:"Company",            value: selectedCompany?.name || s1.companyId },
                  { label:"Department",         value: s1.department },
                  { label:"Sippy Username",     value: s1.userId },
                  { label:"Customer Context",   value: "i_customer = 1 (Root — not under RTST1)" },
                  { label:"Invoice Template",   value: s2.invoiceTemplate },
                  { label:"Rate Sheet Format",  value: s2.ratesheetFull },
                  { label:"Prefix Style",       value: s2.prefixStyle.replace("_"," ") },
                  { label:"Notification Email", value: s1.notifEmailTo || "—" },
                  { label:"Trunks Configured",  value: `${trunks.length} trunk(s)` },
                  { label:"IPs Registered",     value: `${ips.filter(i => i.ip.trim()).length} IP(s) — pending admin approval` },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-start gap-2">
                    <span className="text-xs text-muted-foreground w-36 shrink-0">{label}</span>
                    <span className="text-xs font-medium">{value}</span>
                  </div>
                ))}
              </div>

              {/* Per-trunk summary with prefix */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Per-Trunk Configuration</p>
                {trunks.map((t, i) => (
                  <div key={i} className="border border-border/40 rounded p-3 text-xs space-y-1">
                    <div className="font-medium">{t.trunkName || `Trunk ${i+1}`}</div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 text-muted-foreground">
                      <span>RG: <span className={routingGroupHealthy(t.routingGroupId) ? "text-emerald-400" : "text-rose-400"}>{routingGroups.find(g => String(g.id) === t.routingGroupId)?.name || (t.routingGroupId ? t.routingGroupId : "⚠ Not set")}</span></span>
                      <span>Max Sessions: {t.maxSessions || "unlimited"}</span>
                      <span>CPS: {t.maxCps || "—"}</span>
                      <span>Codec: {CODECS.find(c => c.value === t.codec)?.label || t.codec}</span>
                    </div>
                    {(t.prefix || t.cldTranslation !== "s/^//") && (
                      <div className="flex items-center gap-3 text-muted-foreground pt-0.5">
                        {t.prefix && (
                          <span className="flex items-center gap-1">
                            <Tag className="h-3 w-3 text-violet-400" />
                            Prefix: <span className="font-mono text-violet-300">{t.prefix}</span>
                          </span>
                        )}
                        <span className="font-mono text-[10px] bg-muted/30 px-1.5 py-0.5 rounded">{t.cldTranslation}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Products summary */}
              {selectedProducts.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Products Offered</p>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedProducts.map(p => (
                      <Badge key={p} variant="outline" className={`text-[10px] ${PRODUCT_COLOR[p] ?? ""}`}>{p}</Badge>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 p-3 rounded-md border border-amber-500/30 bg-amber-500/5 text-amber-400 text-xs">
                <Info className="h-3.5 w-3.5 shrink-0" />
                Saving this draft does NOT create an account in Sippy. An admin must approve the IPs and then click Provision on the Companies page.
              </div>
              <div className="flex items-center gap-2 p-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 text-emerald-400 text-xs">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                When provisioned, the account will be created at root level (i_customer = 1) — not under RTST1. No routing inheritance issues.
              </div>
            </div>
          )}

        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <Button data-testid="btn-wizard-back" variant="outline" onClick={back} disabled={step === 1} className="gap-1.5">
          <ChevronLeft className="h-4 w-4" /> Back
        </Button>
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
            {createClientMutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving Draft…</> : "Save Client Draft"}
          </Button>
        )}
      </div>
    </div>
  );
}

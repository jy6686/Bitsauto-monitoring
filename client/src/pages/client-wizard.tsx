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
import { Textarea } from "@/components/ui/textarea";
import {
  Users, ChevronRight, ChevronLeft, CheckCircle2, Plus, Trash2,
  AlertTriangle, Clock, ShieldCheck, Server, Network, FileText,
  ShieldAlert, Loader2, Info, Eye, EyeOff
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Company } from "@shared/schema";

const STEPS = [
  { id: 1, label: "Department & Company",  icon: Users },
  { id: 2, label: "Rate Sheet Config",     icon: FileText },
  { id: 3, label: "Technical Config",      icon: Server },
  { id: 4, label: "IPs & Trunks",          icon: Network },
  { id: 5, label: "Auth Rules",            icon: ShieldCheck },
  { id: 6, label: "Validation Rules",      icon: ShieldAlert },
  { id: 7, label: "Review & Submit",       icon: CheckCircle2 },
];

const CODECS = [
  { value: "none", label: "None / Disabled" },
  { value: "0", label: "G.711u (PCMU)" },
  { value: "8", label: "G.711a (PCMA)" },
  { value: "9", label: "G.722" },
  { value: "18", label: "G.729" },
  { value: "3", label: "GSM" },
  { value: "4", label: "G.723" },
  { value: "15", label: "G.728" },
];

const TRUNKS = ["PREMIUM","STANDARD PLUS","STANDARD","BUSINESS","CHARLIE"];
const RELAY_TYPES = [{ v:"0", l:"Default" },{ v:"1", l:"Always Relay" },{ v:"2", l:"Never Relay" }];
const INVOICE_TEMPLATES = ["Standard","Retail","Wholesale","Custom"];
const SHEET_FORMATS = ["Full CSV","Excel XLSX","PDF","Partial Update","A2Z"];

function genPassword(len = 12) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#";
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

interface TrunkConfig {
  trunkName: string; routingGroupId: string; maxTime: string; maxSessions: string;
  maxCps: string; codec: string; useCodecOnly: boolean; lifetime: string;
  relayType: string; cldTranslation: string; assertedIdRule: string;
  useAssertedId: boolean; preventLoops: boolean; allowRegistration: boolean; blocked: boolean;
}
interface IpEntry { ip: string; trunk: string; description: string; status: string; }
interface AuthRule { trunk: string; ip: string; authType: string; techPrefix: string; cliRule: string; trustCli: boolean; }
interface ValidationRule { type: string; pattern: string; action: string; }

const emptyTrunk = (): TrunkConfig => ({
  trunkName:"", routingGroupId:"", maxTime:"3600", maxSessions:"0", maxCps:"",
  codec:"none", useCodecOnly:false, lifetime:"never", relayType:"0",
  cldTranslation:"s/^//", assertedIdRule:"", useAssertedId:false,
  preventLoops:false, allowRegistration:true, blocked:false,
});
const emptyIp = (): IpEntry => ({ ip:"", trunk:"", description:"", status:"pending" });
const emptyAuth = (): AuthRule => ({ trunk:"", ip:"", authType:"ip", techPrefix:"", cliRule:"", trustCli:false });
const emptyRule = (): ValidationRule => ({ type:"cli_format", pattern:"", action:"block" });

export default function ClientWizardPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [errors, setErrors] = useState<Record<string,string>>({});
  const [showPass, setShowPass] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [createdAccountId, setCreatedAccountId] = useState<number | null>(null);

  const [s1, setS1] = useState({ department:"retail", companyId:"", password:genPassword(), userId:"", notifEmailTo:"", notifEmailCc:"", balanceThreshold:"", a2zNotif:"no", rateNotif:"full_sheet" });
  const [s2, setS2] = useState({ invoiceTemplate:"Standard", ratesheetFull:"Full CSV", ratesheetPartial:"Partial Update", ratesheetAtoz:"A2Z", dialcodeFormat:"E.164", prefixStyle:"with_plus" });
  const [trunks, setTrunks] = useState<TrunkConfig[]>([emptyTrunk()]);
  const [ips, setIps] = useState<IpEntry[]>([emptyIp()]);
  const [authRules, setAuthRules] = useState<AuthRule[]>([emptyAuth()]);
  const [validRules, setValidRules] = useState<ValidationRule[]>([]);

  const { data: companiesData } = useQuery<{ companies: Company[] }>({ queryKey: ["/api/companies"] });
  const { data: routingData } = useQuery<{ groups: { id: number; name: string }[] }>({
    queryKey: ["/api/sippy/routing-groups"],
    retry: false,
  });
  const { data: billingData } = useQuery<{ plans: { id: number; name: string }[] }>({
    queryKey: ["/api/sippy/billing-plans"],
    retry: false,
  });

  const { data: ipRequestsData } = useQuery<{ requests: { ipAddress: string; status: string; trunk: string }[] }>({
    queryKey: ["/api/client-ip-requests"],
    enabled: step === 5,
  });

  const submitIpMutation = useMutation({
    mutationFn: (payload: any) => apiRequest("POST", "/api/client-ip-requests", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/client-ip-requests"] });
      toast({ title: "IP submitted for approval" });
    },
  });

  const createClientMutation = useMutation({
    mutationFn: (payload: any) => apiRequest("POST", "/api/client-wizard/submit", payload),
    onSuccess: (data: any) => {
      setCreatedAccountId(data?.iAccount ?? null);
      setSubmitted(true);
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      toast({ title: "Client account created in Sippy" });
    },
    onError: (e: any) => toast({ title: e.message || "Failed to create account", variant: "destructive" }),
  });

  const companies = companiesData?.companies ?? [];
  const routingGroups = routingData?.groups ?? [];
  const billingPlans = billingData?.plans ?? [];
  const selectedCompany = companies.find(c => String(c.id) === s1.companyId);

  const ipRequests = ipRequestsData?.requests ?? [];
  const approvedIps = ipRequests.filter(r => r.status === "approved").map(r => r.ipAddress);
  const pendingIps = ipRequests.filter(r => r.status === "pending");

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

  const next = () => { if (validate()) setStep(s => Math.min(s + 1, 7)); };
  const back = () => setStep(s => Math.max(s - 1, 1));

  const updateTrunk = (idx: number, k: keyof TrunkConfig, v: any) =>
    setTrunks(p => p.map((t, i) => i === idx ? { ...t, [k]: v } : t));

  const routingGroupHealthy = (rgId: string) => {
    return rgId && routingGroups.some(g => String(g.id) === rgId);
  };

  const handleSubmit = () => {
    const validIps = ips.filter(ip => ip.ip.trim());
    const pendingIpList = validIps.filter(ip => !approvedIps.includes(ip.ip));
    if (pendingIpList.length > 0) {
      toast({ title: "IPs pending approval — submit them for review first", variant: "destructive" });
      return;
    }
    createClientMutation.mutate({ step1: s1, step2: s2, trunks, ips: validIps, authRules, validRules, iCustomer: 1 });
  };

  if (submitted) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <Card className="border-emerald-500/30 bg-emerald-500/5">
          <CardContent className="p-8 text-center space-y-4">
            <CheckCircle2 className="h-12 w-12 text-emerald-400 mx-auto" />
            <h2 className="text-lg font-semibold">Client Account Created</h2>
            {createdAccountId && <p className="text-sm text-muted-foreground">Sippy Account ID: <span className="font-mono text-foreground">{createdAccountId}</span></p>}
            <div className="text-left space-y-2 mt-4">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Post-Creation Checklist</p>
              {[
                { done: true,  label: "Company record exists in BitsAuto" },
                { done: true,  label: "Client account created in Sippy (i_customer = 1, root level)" },
                { done: true,  label: "Added to BitsAuto monitoring" },
                { done: false, label: "Verify routing group has active vendor connections for target destinations" },
                { done: false, label: "Confirm rate sheet delivered to client email" },
                { done: false, label: "Run test call from new account" },
                { done: false, label: "Check CDR after test call" },
                { done: false, label: "Confirm balance threshold alerts working" },
              ].map((item, i) => (
                <div key={i} className={`flex items-center gap-2 text-sm ${item.done ? "text-emerald-400" : "text-muted-foreground"}`}>
                  {item.done ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <div className="h-3.5 w-3.5 shrink-0 border border-muted-foreground/30 rounded-full" />}
                  {item.label}
                </div>
              ))}
            </div>
            <div className="flex gap-2 justify-center pt-2">
              <Button variant="outline" size="sm" onClick={() => navigate("/company/list")}>View Companies</Button>
              <Button size="sm" onClick={() => { setSubmitted(false); setStep(1); }}>Create Another</Button>
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
        <div className="bg-amber-500 h-1 rounded-full transition-all" style={{ width: `${(step / 7) * 100}%` }} />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            {(() => { const S = STEPS[step-1]; return <S.icon className="h-4 w-4 text-amber-400" />; })()}
            {STEPS[step-1].label}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">

          {/* STEP 1 */}
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
                    setS1(p => ({ ...p, companyId: v, userId: co ? co.shortCode.toLowerCase() : "" }));
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
                  <Label className="text-xs">User ID<span className="text-rose-400 ml-0.5">*</span></Label>
                  <Input data-testid="input-userId" className={`h-8 text-sm ${errors.userId ? "border-rose-500" : ""}`} value={s1.userId} onChange={e => setS1(p => ({ ...p, userId: e.target.value }))} placeholder="Auto-generated from company" />
                  {errors.userId && <p className="text-[10px] text-rose-400">{errors.userId}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Password<span className="text-rose-400 ml-0.5">*</span></Label>
                  <div className="relative">
                    <Input data-testid="input-password" type={showPass ? "text" : "password"} className="h-8 text-sm pr-8" value={s1.password} onChange={e => setS1(p => ({ ...p, password: e.target.value }))} />
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
                  No company selected. <a href="/company/create" className="underline">Create a company first</a> if the list is empty.
                </div>
              )}
            </div>
          )}

          {/* STEP 2 */}
          {step === 2 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {([
                ["invoiceTemplate", "Invoice Template", INVOICE_TEMPLATES],
                ["ratesheetFull", "Full Rate Sheet Format", SHEET_FORMATS],
                ["ratesheetPartial", "Partial Rate Sheet Format", SHEET_FORMATS],
                ["ratesheetAtoz", "A2Z Rate Sheet Format", SHEET_FORMATS],
                ["dialcodeFormat", "Dialcode Format", ["E.164","National","Local"]],
                ["prefixStyle", "Prefix Style", ["with_plus","without_plus"]],
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

          {/* STEP 3 */}
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
                    <div className="space-y-1.5">
                      <Label className="text-xs">CLD Translation Rule</Label>
                      <Input data-testid={`input-cldRule-${idx}`} className="h-8 text-sm font-mono" value={t.cldTranslation} onChange={e => updateTrunk(idx, "cldTranslation", e.target.value)} />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-4 pt-1">
                    {([
                      ["useCodecOnly", "Use Preferred Codec Only"],
                      ["preventLoops", "Prevent Call Loops"],
                      ["allowRegistration", "Allow Registration"],
                      ["blocked", "Blocked"],
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

          {/* STEP 4 */}
          {step === 4 && (
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium">Client IP Addresses</h3>
                  <Button data-testid="btn-add-ip" size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setIps(p => [...p, emptyIp()])}>
                    <Plus className="h-3 w-3" /> Add IP
                  </Button>
                </div>
                <div className="flex items-center gap-2 p-3 rounded-md border border-blue-500/30 bg-blue-500/5 text-blue-400 text-xs mb-3">
                  <Info className="h-3.5 w-3.5 shrink-0" />
                  Each IP must be submitted for approval before authentication rules can be created. IPs show as Pending until approved.
                </div>
                {ips.map((ip, idx) => (
                  <div key={idx} className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end mb-2">
                    <div className="space-y-1">
                      <Label className="text-[10px]">IP Address<span className="text-rose-400">*</span></Label>
                      <Input data-testid={`input-ip-${idx}`} className="h-7 text-xs font-mono" value={ip.ip} onChange={e => setIps(p => p.map((x,i) => i===idx ? {...x, ip:e.target.value} : x))} placeholder="192.168.1.1" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px]">Trunk</Label>
                      <Select value={ip.trunk} onValueChange={v => setIps(p => p.map((x,i) => i===idx ? {...x, trunk:v} : x))}>
                        <SelectTrigger data-testid={`select-ip-trunk-${idx}`} className="h-7 text-xs"><SelectValue placeholder="Trunk…" /></SelectTrigger>
                        <SelectContent>{TRUNKS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px]">Description</Label>
                      <Input data-testid={`input-ip-desc-${idx}`} className="h-7 text-xs" value={ip.description} onChange={e => setIps(p => p.map((x,i) => i===idx ? {...x, description:e.target.value} : x))} />
                    </div>
                    <div className="flex items-end gap-1">
                      <Button data-testid={`btn-submit-ip-${idx}`} size="sm" variant="outline" className="h-7 text-xs gap-1"
                        disabled={!ip.ip.trim() || submitIpMutation.isPending}
                        onClick={() => submitIpMutation.mutate({ clientName: selectedCompany?.name || s1.userId, companyId: s1.companyId || null, ipAddress: ip.ip, trunk: ip.trunk, description: ip.description, submittedBy: "current_user" })}>
                        <Clock className="h-3 w-3" /> Submit
                      </Button>
                      <Button data-testid={`btn-remove-ip-${idx}`} size="sm" variant="ghost" className="h-7 text-rose-400" onClick={() => setIps(p => p.filter((_,i) => i !== idx))} disabled={ips.length === 1}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              <div>
                <h3 className="text-sm font-medium mb-3">Trunk Assignment</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                  {TRUNKS.map(t => (
                    <div key={t} className="flex items-center gap-1.5 border border-border/50 rounded p-2">
                      <Checkbox data-testid={`check-trunk-${t}`} id={`trunk-${t}`} />
                      <label htmlFor={`trunk-${t}`} className="text-xs cursor-pointer">{t}</label>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* STEP 5 */}
          {step === 5 && (
            <div className="space-y-4">
              {pendingIps.length > 0 && (
                <div className="p-3 rounded-md border border-amber-500/30 bg-amber-500/5 text-amber-400 text-xs space-y-1">
                  <div className="flex items-center gap-1.5 font-medium"><Clock className="h-3.5 w-3.5" /> {pendingIps.length} IP(s) Pending Approval</div>
                  {pendingIps.map((r, i) => (
                    <div key={i} className="font-mono">{r.ipAddress} — {r.trunk} — awaiting review</div>
                  ))}
                  <div className="mt-1">Auth rules are locked until these IPs are approved. Check the <a href="/approvals" className="underline">Approval Queue</a>.</div>
                </div>
              )}
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium">Authentication Rules <span className="text-xs text-muted-foreground">(approved IPs only)</span></h3>
                <Button data-testid="btn-add-auth" size="sm" variant="outline" className="h-7 text-xs gap-1"
                  disabled={approvedIps.length === 0}
                  onClick={() => setAuthRules(p => [...p, emptyAuth()])}>
                  <Plus className="h-3 w-3" /> Add Rule
                </Button>
              </div>
              {approvedIps.length === 0 && pendingIps.length === 0 && (
                <p className="text-xs text-muted-foreground">No approved IPs yet. Submit IPs in Step 4 and wait for approval.</p>
              )}
              {authRules.map((r, idx) => (
                <div key={idx} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 items-end border border-border/30 rounded p-3">
                  <div className="space-y-1">
                    <Label className="text-[10px]">Trunk</Label>
                    <Select value={r.trunk} onValueChange={v => setAuthRules(p => p.map((x,i) => i===idx ? {...x, trunk:v} : x))}>
                      <SelectTrigger data-testid={`select-auth-trunk-${idx}`} className="h-7 text-xs"><SelectValue placeholder="Trunk…" /></SelectTrigger>
                      <SelectContent>{TRUNKS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px]">IP Address</Label>
                    <Select value={r.ip} onValueChange={v => setAuthRules(p => p.map((x,i) => i===idx ? {...x, ip:v} : x))}>
                      <SelectTrigger data-testid={`select-auth-ip-${idx}`} className="h-7 text-xs"><SelectValue placeholder="IP…" /></SelectTrigger>
                      <SelectContent>{approvedIps.map(ip => <SelectItem key={ip} value={ip}>{ip}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px]">Auth Type</Label>
                    <Select value={r.authType} onValueChange={v => setAuthRules(p => p.map((x,i) => i===idx ? {...x, authType:v} : x))}>
                      <SelectTrigger data-testid={`select-auth-type-${idx}`} className="h-7 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ip">IP Auth</SelectItem>
                        <SelectItem value="sip_digest">SIP Digest</SelectItem>
                        <SelectItem value="both">Both</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px]">Tech Prefix</Label>
                    <Input data-testid={`input-auth-prefix-${idx}`} className="h-7 text-xs font-mono" value={r.techPrefix} onChange={e => setAuthRules(p => p.map((x,i) => i===idx ? {...x, techPrefix:e.target.value} : x))} placeholder="e.g. 101" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px]">CLI Rule</Label>
                    <Input data-testid={`input-auth-cli-${idx}`} className="h-7 text-xs" value={r.cliRule} onChange={e => setAuthRules(p => p.map((x,i) => i===idx ? {...x, cliRule:e.target.value} : x))} />
                  </div>
                  <div className="flex items-end gap-1">
                    <div className="flex items-center gap-1"><Checkbox data-testid={`check-auth-trustcli-${idx}`} id={`trustcli-${idx}`} checked={r.trustCli} onCheckedChange={v => setAuthRules(p => p.map((x,i) => i===idx ? {...x, trustCli:!!v} : x))} /><label htmlFor={`trustcli-${idx}`} className="text-[10px]">Trust CLI</label></div>
                    <Button size="sm" variant="ghost" className="h-7 text-rose-400" onClick={() => setAuthRules(p => p.filter((_,i) => i !== idx))}><Trash2 className="h-3 w-3" /></Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* STEP 6 */}
          {step === 6 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">Validation Rules <span className="text-xs text-muted-foreground">(optional)</span></h3>
                <Button data-testid="btn-add-rule" size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setValidRules(p => [...p, emptyRule()])}>
                  <Plus className="h-3 w-3" /> Add Rule
                </Button>
              </div>
              {validRules.length === 0 && <p className="text-xs text-muted-foreground">No validation rules added. Rules restrict which numbers can be called through this account.</p>}
              {validRules.map((r, idx) => (
                <div key={idx} className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end border border-border/30 rounded p-3">
                  <div className="space-y-1">
                    <Label className="text-[10px]">Rule Type</Label>
                    <Select value={r.type} onValueChange={v => setValidRules(p => p.map((x,i) => i===idx ? {...x, type:v} : x))}>
                      <SelectTrigger data-testid={`select-rule-type-${idx}`} className="h-7 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cli_format">CLI Format</SelectItem>
                        <SelectItem value="cld_prefix">CLD Prefix</SelectItem>
                        <SelectItem value="geo_block">Geo Block</SelectItem>
                        <SelectItem value="time_window">Time Window</SelectItem>
                        <SelectItem value="max_attempts">Max Attempts</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px]">Pattern / Value</Label>
                    <Input data-testid={`input-rule-pattern-${idx}`} className="h-7 text-xs font-mono" value={r.pattern} onChange={e => setValidRules(p => p.map((x,i) => i===idx ? {...x, pattern:e.target.value} : x))} placeholder="e.g. ^\\+44" />
                  </div>
                  <div className="flex gap-2 items-end">
                    <div className="space-y-1 flex-1">
                      <Label className="text-[10px]">Action</Label>
                      <Select value={r.action} onValueChange={v => setValidRules(p => p.map((x,i) => i===idx ? {...x, action:v} : x))}>
                        <SelectTrigger data-testid={`select-rule-action-${idx}`} className="h-7 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="block">Block</SelectItem>
                          <SelectItem value="allow">Allow Only</SelectItem>
                          <SelectItem value="flag">Flag</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Button size="sm" variant="ghost" className="h-7 text-rose-400" onClick={() => setValidRules(p => p.filter((_,i) => i !== idx))}><Trash2 className="h-3 w-3" /></Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* STEP 7 — Review */}
          {step === 7 && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                {[
                  { label:"Company", value: selectedCompany?.name || s1.companyId },
                  { label:"Department", value: s1.department },
                  { label:"User ID", value: s1.userId },
                  { label:"Customer Context", value: "i_customer = 1 (Root — not under RTST1)" },
                  { label:"Invoice Template", value: s2.invoiceTemplate },
                  { label:"Rate Sheet Format", value: s2.ratesheetFull },
                  { label:"Prefix Style", value: s2.prefixStyle.replace("_"," ") },
                  { label:"Notification Email", value: s1.notifEmailTo || "—" },
                  { label:"Trunks Configured", value: `${trunks.length} trunk(s)` },
                  { label:"IPs Submitted", value: `${ips.filter(i => i.ip.trim()).length} IP(s)` },
                  { label:"Auth Rules", value: `${authRules.filter(r => r.ip).length} rule(s)` },
                  { label:"Validation Rules", value: `${validRules.length} rule(s)` },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-start gap-2">
                    <span className="text-xs text-muted-foreground w-36 shrink-0">{label}</span>
                    <span className="text-xs font-medium">{value}</span>
                  </div>
                ))}
              </div>

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
                  </div>
                ))}
              </div>

              {pendingIps.length > 0 && (
                <div className="flex items-center gap-2 p-3 rounded-md border border-rose-500/30 bg-rose-500/5 text-rose-400 text-xs">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  {pendingIps.length} IP(s) still pending approval. Approve them in the Approval Queue before submitting.
                </div>
              )}

              <div className="flex items-center gap-2 p-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 text-emerald-400 text-xs">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                This account will be created at root level (i_customer = 1) — not under RTST1. No routing inheritance issues.
              </div>
            </div>
          )}

        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <Button data-testid="btn-wizard-back" variant="outline" onClick={back} disabled={step === 1} className="gap-1.5">
          <ChevronLeft className="h-4 w-4" /> Back
        </Button>
        {step < 7 ? (
          <Button data-testid="btn-wizard-next" onClick={next} className="gap-1.5">
            Next <ChevronRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            data-testid="btn-wizard-submit"
            onClick={handleSubmit}
            disabled={createClientMutation.isPending || pendingIps.length > 0}
            className="gap-1.5"
          >
            {createClientMutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Creating in Sippy…</> : "Create Client in Sippy"}
          </Button>
        )}
      </div>
    </div>
  );
}

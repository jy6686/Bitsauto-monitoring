import { useState, useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Building2, ChevronRight, ChevronLeft, CheckCircle2, Plus, Trash2, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const STEPS = [
  { id: 1, label: "Basic Information" },
  { id: 2, label: "Billing Information" },
  { id: 3, label: "Contacts & Bank" },
];

const COUNTRIES = ["United Kingdom","United States","Pakistan","India","Bangladesh","UAE","Saudi Arabia","Germany","France","Australia","Canada","Nigeria","Kenya","Egypt","South Africa","Other"];
const TIMEZONES = ["GMT+00:00 | UTC","GMT+01:00 | London","GMT+02:00 | Cairo","GMT+03:00 | Riyadh","GMT+04:00 | Dubai","GMT+05:00 | Karachi","GMT+05:30 | Mumbai","GMT+06:00 | Dhaka","GMT+07:00 | Bangkok","GMT+08:00 | Singapore","GMT+09:00 | Tokyo","GMT-05:00 | New York","GMT-08:00 | Los Angeles"];
const CURRENCIES = ["USD","EUR","GBP","AED","SAR","PKR","INR","BDT","NGN","KES","EGP"];
const BILLING_CYCLES = ["weekly_cutoff","monthly","daily","bi_weekly"];
const BILLING_CYCLE_LABELS: Record<string,string> = { weekly_cutoff:"Weekly Cutoff", monthly:"Monthly", daily:"Daily", bi_weekly:"Bi-Weekly" };
const PAYMENT_TERMS = ["prepaid","postpaid","credit"];
const CONTRACT_TYPES = ["bilateral","client","vendor"];
const COMPANY_TYPES = ["retail","wholesale"];
const DEPARTMENTS = ["retail","wholesale","enterprise","carrier","reseller"];

interface Contact { firstName: string; lastName: string; email: string; phone: string; fax: string; }
interface BankAccount { bankName: string; accountTitle: string; accountNo: string; iban: string; swiftCode: string; currency: string; country: string; address: string; remarks: string; }

const emptyContact = (): Contact => ({ firstName:"", lastName:"", email:"", phone:"", fax:"" });
const emptyBank = (): BankAccount => ({ bankName:"", accountTitle:"", accountNo:"", iban:"", swiftCode:"", currency:"USD", country:"", address:"", remarks:"" });

const defaultBasic = () => ({
  name:"", shortCode:"", country:"", kam:"", status:"active",
  companyType:"retail", contractType:"bilateral", department:"retail",
  team:"", clientTimezone:"", vendorTimezone:"", currency:"USD",
});
const defaultBilling = () => ({
  vendorBillingCycle:"weekly_cutoff", vendorGracePeriod:3, vendorCreditLimit:0, disputeOverPct:0,
  clientBillingCycle:"weekly_cutoff", clientGracePeriod:3, clientCreditLimit:0, disputeOverVal:0,
  paymentTerm:"prepaid", legalNameCi:"", legalNameVen:"", invoiceEmail:"",
});
const defaultContacts = () => ({
  technical:[emptyContact()], finance:[emptyContact()], commercial:[emptyContact()], billing:[emptyContact()],
});

export default function CompanyCreatePage() {
  const [, navigate] = useLocation();
  const params = useParams<{ id?: string }>();
  const companyId = params.id ? parseInt(params.id, 10) : null;
  const isEdit = !!companyId;
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [errors, setErrors] = useState<Record<string,string>>({});
  const [populated, setPopulated] = useState(false);

  // Company Profile Setup hands the name over as ?name=… so it is never typed
  // twice. Editable afterwards — it is a starting value, not a lock.
  const [basic, setBasic] = useState(() => {
    const prefill = new URLSearchParams(window.location.search).get("name")?.trim() ?? "";
    return prefill ? { ...defaultBasic(), name: prefill } : defaultBasic();
  });
  const [billing, setBilling] = useState(defaultBilling());
  const [contacts, setContacts] = useState<Record<string,Contact[]>>(defaultContacts());
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  /** Client SIP IPs captured at creation. Recorded PENDING — admin approval is unchanged. */
  const [clientIps, setClientIps] = useState("");

  const { data: kamsData } = useQuery<{ id: number; name: string; email: string; orgRole: string }[]>({
    queryKey: ["/api/kam"],
    retry: false,
  });

  const { data: existingData, isLoading: loadingExisting } = useQuery<{ companies: any[] }>({
    queryKey: ["/api/companies"],
    enabled: isEdit,
  });

  useEffect(() => {
    if (!isEdit || populated || !existingData) return;
    const co = existingData.companies?.find((c: any) => c.id === companyId);
    if (!co) return;
    setBasic({
      name: co.name ?? "",
      shortCode: co.shortCode ?? "",
      country: co.country ?? "",
      kam: co.kam ?? "",
      status: co.status ?? "active",
      companyType: co.companyType ?? "retail",
      contractType: co.contractType ?? "bilateral",
      department: co.department ?? "retail",
      team: co.team ?? "",
      clientTimezone: co.clientTimezone ?? "",
      vendorTimezone: co.vendorTimezone ?? "",
      currency: co.currency ?? "USD",
    });
    setBilling({
      vendorBillingCycle: co.vendorBillingCycle ?? "weekly_cutoff",
      vendorGracePeriod: co.vendorGracePeriod ?? 3,
      vendorCreditLimit: co.vendorCreditLimit ?? 0,
      disputeOverPct: co.disputeOverPct ?? 0,
      clientBillingCycle: co.clientBillingCycle ?? "weekly_cutoff",
      clientGracePeriod: co.clientGracePeriod ?? 3,
      clientCreditLimit: co.clientCreditLimit ?? 0,
      disputeOverVal: co.disputeOverVal ?? 0,
      paymentTerm: co.paymentTerm ?? "prepaid",
      legalNameCi: co.legalNameCi ?? "",
      legalNameVen: co.legalNameVen ?? "",
      invoiceEmail: co.invoiceEmail ?? "",
    });
    setPopulated(true);
  }, [isEdit, existingData, companyId, populated]);

  const createMutation = useMutation({
    // .json() — the response was previously discarded, so everything the endpoint reports
    // about what it actually managed to do was unreachable to the UI.
    mutationFn: (payload: any) => apiRequest("POST", "/api/companies", payload).then(r => r.json()),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });

      // Creating a company does three more things that can each fail on their own: the
      // Sippy tariff, the Sippy service plan, and the initial IP requests. All three are
      // deliberately non-fatal — a switch outage must not cost a customer record — so the
      // create returns 200 either way, and "Company created successfully" was shown even
      // when none of them had happened. That is how Test-098 came to exist with nothing in
      // Sippy, and Test-982 with the operator's IP silently dropped.
      const ips = data?.ips as { requested: number; created: number; error: string | null } | undefined;
      const com = data?.commercial as { tariffId: number | null; servicePlanId: number | null; error: string | null } | undefined;

      const done: string[] = [];
      const failed: string[] = [];
      if (com?.tariffId)      done.push(`Tariff #${com.tariffId}`);
      else if (com?.error)    failed.push("Tariff");
      if (com?.servicePlanId) done.push(`Service plan #${com.servicePlanId}`);
      else if (com?.error)    failed.push("Service plan");
      if (ips?.created)       done.push(`${ips.created} IP${ips.created !== 1 ? "s" : ""} pending approval`);
      if (ips?.error)         failed.push(`${ips.requested} IP${ips.requested !== 1 ? "s" : ""}`);

      if (failed.length) {
        toast({
          title: `Company created — ${failed.join(" and ")} could not be recorded`,
          description: `${done.length ? done.join(" · ") + ". " : ""}${com?.error ?? ips?.error ?? ""} Retry from the company card once resolved.`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Company created",
          description: done.length ? done.join(" · ") : undefined,
        });
      }
      navigate("/company/list");
    },
    onError: (e: any) => toast({ title: e.message || "Failed to create company", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: (payload: any) => apiRequest("PATCH", `/api/companies/${companyId}`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      toast({ title: "Company updated successfully" });
      navigate("/company/list");
    },
    onError: (e: any) => toast({ title: e.message || "Failed to update company", variant: "destructive" }),
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  const setB = (k: string, v: any) => setBasic(p => ({ ...p, [k]: v }));
  const setBl = (k: string, v: any) => setBilling(p => ({ ...p, [k]: v }));

  const updateContact = (type: string, idx: number, k: keyof Contact, v: string) => {
    setContacts(p => { const arr = [...p[type]]; arr[idx] = { ...arr[idx], [k]: v }; return { ...p, [type]: arr }; });
  };
  const addContact = (type: string) => setContacts(p => ({ ...p, [type]: [...p[type], emptyContact()] }));
  const removeContact = (type: string, idx: number) => setContacts(p => ({ ...p, [type]: p[type].filter((_,i) => i !== idx) }));

  /** Split on newline, comma or semicolon — an operator pasting an interconnect form
   *  should not have to reformat it. Shared by validation and submit so the two cannot
   *  disagree about what counts as an IP. */
  const parseIps = (raw: string) => raw.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);

  const validateStep = () => {
    const errs: Record<string,string> = {};
    if (step === 1) {
      if (!basic.name.trim()) errs.name = "Company name is required";
      if (!basic.shortCode.trim()) errs.shortCode = "Short code is required";
      if (!basic.department) errs.department = "Department is required";
    }
    // Step 3 — REQUIRED on create. Provisioning cannot start without an approved IP, so
    // treating it as optional only defers the stop: the company is created, the card says
    // "no IP yet", and someone comes back to the same customer later. Not enforced on
    // edit: existing IPs live in the approval table, and this field would be empty there.
    if (step === 3 && !isEdit) {
      const ips = parseIps(clientIps);
      if (!ips.length) {
        errs.clientIps = "At least one client SIP IP is required.";
      } else {
        // Shape only, deliberately — an IP that is well-formed but wrong is a business
        // problem the admin approval step exists to catch. This catches the typo.
        const bad = ips.filter(ip => !/^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/.test(ip)
                                  || ip.split('/')[0].split('.').some(o => Number(o) > 255));
        if (bad.length) errs.clientIps = `Not a valid IPv4 address: ${bad.slice(0, 3).join(', ')}`;
      }
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const next = () => { if (validateStep()) setStep(s => Math.min(s + 1, 3)); };
  const back = () => setStep(s => Math.max(s - 1, 1));

  const handleSubmit = () => {
    // Submit validates too. next() only runs on the Next button, so without this the
    // required IP could be skipped entirely by landing on step 3 and pressing Create.
    if (!validateStep()) return;
    const pocContacts = Object.entries(contacts).flatMap(([type, list]) =>
      list.filter(c => c.firstName || c.email).map(c => ({ contactType: type, ...c }))
    );
    const initialIps = parseIps(clientIps);
    const payload = { basic, billing, contacts: pocContacts, bankAccounts, initialIps };
    if (isEdit) {
      updateMutation.mutate(payload);
    } else {
      createMutation.mutate(payload);
    }
  };

  const field = (label: string, key: string, value: string, onChange: (v: string) => void, required = false, type = "text") => (
    <div className="space-y-1.5" key={key}>
      <Label className="text-xs">{label}{required && <span className="text-rose-400 ml-0.5">*</span>}</Label>
      <Input
        data-testid={`input-${key}`}
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`h-8 text-sm ${errors[key] ? "border-rose-500" : ""}`}
      />
      {errors[key] && <p className="text-[10px] text-rose-400">{errors[key]}</p>}
    </div>
  );

  const selectField = (label: string, key: string, value: string, onChange: (v: string) => void, options: string[], labels?: Record<string,string>, required = false) => (
    <div className="space-y-1.5" key={key}>
      <Label className="text-xs">{label}{required && <span className="text-rose-400 ml-0.5">*</span>}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger data-testid={`select-${key}`} className="h-8 text-sm">
          <SelectValue placeholder="Select…" />
        </SelectTrigger>
        <SelectContent>
          {options.map(o => <SelectItem key={o} value={o}>{labels?.[o] ?? o.charAt(0).toUpperCase() + o.slice(1)}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );

  if (isEdit && loadingExisting && !populated) {
    return (
      <div className="p-6 flex items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading company…
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-2">
        <Building2 className="h-5 w-5 text-blue-400" />
        {/* Name the company being created, so the subject is never ambiguous
            once the wizard is several steps deep. */}
        <h1 className="text-xl font-semibold">
          {isEdit ? "Edit Company" : "Create New Company"}
          {!isEdit && basic.name.trim() && (
            <span className="text-muted-foreground font-normal">: {basic.name.trim()}</span>
          )}
        </h1>
        {isEdit && <Badge variant="outline" className="text-[10px] text-blue-400 border-blue-500/30 bg-blue-500/10">Editing #{companyId}</Badge>}
      </div>

      <div className="flex items-center gap-2">
        {STEPS.map((s, i) => (
          <div key={s.id} className="flex items-center gap-2">
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
              step === s.id ? "bg-blue-500/10 border-blue-500/30 text-blue-400" :
              step > s.id ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" :
              "border-border text-muted-foreground"
            }`}>
              {step > s.id ? <CheckCircle2 className="h-3 w-3" /> : <span>{s.id}</span>}
              {s.label}
            </div>
            {i < STEPS.length - 1 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
          </div>
        ))}
      </div>

      <div className="w-full bg-border/30 rounded-full h-1.5">
        <div className="bg-blue-500 h-1.5 rounded-full transition-all" style={{ width: `${(step / 3) * 100}%` }} />
      </div>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">{STEPS[step-1].label}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">

          {step === 1 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {field("Company Name", "name", basic.name, v => setB("name", v), true)}
              {field("Short Code", "shortCode", basic.shortCode, v => setB("shortCode", v.toUpperCase()), true)}
              {selectField("Country", "country", basic.country, v => setB("country", v), COUNTRIES)}
              <div className="space-y-1.5">
                <Label className="text-xs">KAM (Account Manager)<span className="text-rose-400 ml-0.5">*</span></Label>
                <Select value={basic.kam} onValueChange={v => setB("kam", v)}>
                  <SelectTrigger data-testid="select-kam" className="h-8 text-sm"><SelectValue placeholder="Select KAM…" /></SelectTrigger>
                  <SelectContent>
                    {(kamsData ?? []).map(k => <SelectItem key={k.id} value={k.name}>{k.name}{k.orgRole && k.orgRole !== 'KAM' ? ` (${k.orgRole})` : ''}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {selectField("Status", "status", basic.status, v => setB("status", v), ["active","inactive"])}
              {selectField("Company Type", "companyType", basic.companyType, v => setB("companyType", v), COMPANY_TYPES, undefined, true)}
              {selectField("Contract Type", "contractType", basic.contractType, v => setB("contractType", v), CONTRACT_TYPES, undefined, true)}
              {selectField("Department", "department", basic.department, v => setB("department", v), DEPARTMENTS, undefined, true)}
              {field("Team", "team", basic.team, v => setB("team", v))}
              {selectField("Client Timezone", "clientTimezone", basic.clientTimezone, v => setB("clientTimezone", v), TIMEZONES)}
              {selectField("Vendor Timezone", "vendorTimezone", basic.vendorTimezone, v => setB("vendorTimezone", v), TIMEZONES)}
              {selectField("Currency", "currency", basic.currency, v => setB("currency", v), CURRENCIES, undefined, true)}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-medium mb-3 text-muted-foreground uppercase tracking-wide text-[10px]">Vendor Billing</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {selectField("Vendor Billing Cycle", "vendorBillingCycle", billing.vendorBillingCycle, v => setBl("vendorBillingCycle", v), BILLING_CYCLES, BILLING_CYCLE_LABELS, true)}
                  <div className="space-y-1.5"><Label className="text-xs">Vendor Grace Period (days)<span className="text-rose-400 ml-0.5">*</span></Label><Input data-testid="input-vendorGracePeriod" type="number" className="h-8 text-sm" value={billing.vendorGracePeriod} onChange={e => setBl("vendorGracePeriod", Number(e.target.value))} /></div>
                  <div className="space-y-1.5"><Label className="text-xs">Vendor Credit Limit<span className="text-rose-400 ml-0.5">*</span></Label><Input data-testid="input-vendorCreditLimit" type="number" className="h-8 text-sm" value={billing.vendorCreditLimit} onChange={e => setBl("vendorCreditLimit", Number(e.target.value))} /></div>
                  <div className="space-y-1.5"><Label className="text-xs">Dispute Over %<span className="text-rose-400 ml-0.5">*</span></Label><Input data-testid="input-disputeOverPct" type="number" className="h-8 text-sm" value={billing.disputeOverPct} onChange={e => setBl("disputeOverPct", Number(e.target.value))} /></div>
                </div>
              </div>
              <div>
                <h3 className="text-sm font-medium mb-3 text-muted-foreground uppercase tracking-wide text-[10px]">Client Billing</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {selectField("Client Billing Cycle", "clientBillingCycle", billing.clientBillingCycle, v => setBl("clientBillingCycle", v), BILLING_CYCLES, BILLING_CYCLE_LABELS, true)}
                  <div className="space-y-1.5"><Label className="text-xs">Client Grace Period (days)<span className="text-rose-400 ml-0.5">*</span></Label><Input data-testid="input-clientGracePeriod" type="number" className="h-8 text-sm" value={billing.clientGracePeriod} onChange={e => setBl("clientGracePeriod", Number(e.target.value))} /></div>
                  <div className="space-y-1.5"><Label className="text-xs">Client Credit Limit<span className="text-rose-400 ml-0.5">*</span></Label><Input data-testid="input-clientCreditLimit" type="number" className="h-8 text-sm" value={billing.clientCreditLimit} onChange={e => setBl("clientCreditLimit", Number(e.target.value))} /></div>
                  <div className="space-y-1.5"><Label className="text-xs">Dispute Over Value<span className="text-rose-400 ml-0.5">*</span></Label><Input data-testid="input-disputeOverVal" type="number" className="h-8 text-sm" value={billing.disputeOverVal} onChange={e => setBl("disputeOverVal", Number(e.target.value))} /></div>
                </div>
              </div>
              <div>
                <h3 className="text-sm font-medium mb-3 text-muted-foreground uppercase tracking-wide text-[10px]">Payment & Legal</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {selectField("Payment Term", "paymentTerm", billing.paymentTerm, v => setBl("paymentTerm", v), PAYMENT_TERMS)}
                  {field("Legal Name — Client Invoice", "legalNameCi", billing.legalNameCi, v => setBl("legalNameCi", v))}
                  {field("Legal Name — Vendor Invoice", "legalNameVen", billing.legalNameVen, v => setBl("legalNameVen", v))}
                  {field("Invoice Email", "invoiceEmail", billing.invoiceEmail, v => setBl("invoiceEmail", v), false, "email")}
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6">
              {!isEdit && (
                <div className="border border-border/50 rounded-lg p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium">
                      Client SIP IP(s) <span className="text-red-400">*</span>
                    </h3>
                  </div>
                  <Textarea
                    data-testid="input-client-ips"
                    rows={3}
                    placeholder={"145.239.9.179\n104.245.246.110"}
                    value={clientIps}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setClientIps(e.target.value)}
                    className={cn("text-sm font-mono", errors.clientIps && "border-red-500/60")}
                  />
                  {/* One line, not a paragraph. The previous help text explained the internal
                      approval mechanism — pending status, who approves, what reaches Sippy —
                      which is our workflow, not the operator's decision. What they need to
                      know is the format and that someone approves it next. */}
                  <p className="text-[11px] text-muted-foreground">
                    One per line or comma-separated. Submitted for admin approval after creation.
                  </p>
                  {errors.clientIps && (
                    <p className="text-[11px] text-red-400">{errors.clientIps}</p>
                  )}
                </div>
              )}
              {(["technical","finance","commercial","billing"] as const).map(type => (
                <div key={type} className="border border-border/50 rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium capitalize">{type} Contacts</h3>
                    <Button data-testid={`btn-add-contact-${type}`} size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => addContact(type)}>
                      <Plus className="h-3 w-3" /> Add More
                    </Button>
                  </div>
                  {contacts[type].map((c, idx) => (
                    <div key={idx} className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-end">
                      <div className="space-y-1"><Label className="text-[10px]">First Name<span className="text-rose-400">*</span></Label><Input data-testid={`input-${type}-firstname-${idx}`} className="h-7 text-xs" value={c.firstName} onChange={e => updateContact(type, idx, "firstName", e.target.value)} /></div>
                      <div className="space-y-1"><Label className="text-[10px]">Last Name</Label><Input data-testid={`input-${type}-lastname-${idx}`} className="h-7 text-xs" value={c.lastName} onChange={e => updateContact(type, idx, "lastName", e.target.value)} /></div>
                      <div className="space-y-1"><Label className="text-[10px]">Email<span className="text-rose-400">*</span></Label><Input data-testid={`input-${type}-email-${idx}`} type="email" className="h-7 text-xs" value={c.email} onChange={e => updateContact(type, idx, "email", e.target.value)} /></div>
                      <div className="space-y-1"><Label className="text-[10px]">Phone</Label><Input data-testid={`input-${type}-phone-${idx}`} className="h-7 text-xs" value={c.phone} onChange={e => updateContact(type, idx, "phone", e.target.value)} /></div>
                      <Button data-testid={`btn-remove-contact-${type}-${idx}`} size="sm" variant="ghost" className="h-7 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 mt-4" disabled={contacts[type].length === 1} onClick={() => removeContact(type, idx)}><Trash2 className="h-3 w-3" /></Button>
                    </div>
                  ))}
                </div>
              ))}

              <div className="border border-border/50 rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium">Bank Information <span className="text-xs text-muted-foreground">(optional)</span></h3>
                  <Button data-testid="btn-add-bank" size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setBankAccounts(p => [...p, emptyBank()])}>
                    <Plus className="h-3 w-3" /> Add Bank
                  </Button>
                </div>
                {bankAccounts.map((b, idx) => (
                  <div key={idx} className="grid grid-cols-2 sm:grid-cols-4 gap-2 border border-border/30 rounded p-3">
                    <div className="space-y-1"><Label className="text-[10px]">Bank Name<span className="text-rose-400">*</span></Label><Input data-testid={`input-bank-name-${idx}`} className="h-7 text-xs" value={b.bankName} onChange={e => setBankAccounts(p => p.map((x,i) => i===idx ? {...x, bankName:e.target.value} : x))} /></div>
                    <div className="space-y-1"><Label className="text-[10px]">Account Title<span className="text-rose-400">*</span></Label><Input data-testid={`input-bank-title-${idx}`} className="h-7 text-xs" value={b.accountTitle} onChange={e => setBankAccounts(p => p.map((x,i) => i===idx ? {...x, accountTitle:e.target.value} : x))} /></div>
                    <div className="space-y-1"><Label className="text-[10px]">Account No.<span className="text-rose-400">*</span></Label><Input data-testid={`input-bank-no-${idx}`} className="h-7 text-xs" value={b.accountNo} onChange={e => setBankAccounts(p => p.map((x,i) => i===idx ? {...x, accountNo:e.target.value} : x))} /></div>
                    <div className="space-y-1"><Label className="text-[10px]">Swift Code<span className="text-rose-400">*</span></Label><Input data-testid={`input-bank-swift-${idx}`} className="h-7 text-xs" value={b.swiftCode} onChange={e => setBankAccounts(p => p.map((x,i) => i===idx ? {...x, swiftCode:e.target.value} : x))} /></div>
                    <div className="space-y-1"><Label className="text-[10px]">IBAN</Label><Input data-testid={`input-bank-iban-${idx}`} className="h-7 text-xs" value={b.iban} onChange={e => setBankAccounts(p => p.map((x,i) => i===idx ? {...x, iban:e.target.value} : x))} /></div>
                    <div className="space-y-1"><Label className="text-[10px]">Country<span className="text-rose-400">*</span></Label><Input data-testid={`input-bank-country-${idx}`} className="h-7 text-xs" value={b.country} onChange={e => setBankAccounts(p => p.map((x,i) => i===idx ? {...x, country:e.target.value} : x))} /></div>
                    <div className="space-y-1"><Label className="text-[10px]">Currency</Label>
                      <Select value={b.currency} onValueChange={v => setBankAccounts(p => p.map((x,i) => i===idx ? {...x, currency:v} : x))}>
                        <SelectTrigger data-testid={`select-bank-currency-${idx}`} className="h-7 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-end"><Button data-testid={`btn-remove-bank-${idx}`} size="sm" variant="ghost" className="h-7 text-rose-400 hover:text-rose-300" onClick={() => setBankAccounts(p => p.filter((_,i) => i !== idx))}><Trash2 className="h-3 w-3" /></Button></div>
                    <div className="space-y-1 col-span-2"><Label className="text-[10px]">Address</Label><Input data-testid={`input-bank-address-${idx}`} className="h-7 text-xs" value={b.address} onChange={e => setBankAccounts(p => p.map((x,i) => i===idx ? {...x, address:e.target.value} : x))} /></div>
                    <div className="space-y-1 col-span-2"><Label className="text-[10px]">Remarks</Label><Input data-testid={`input-bank-remarks-${idx}`} className="h-7 text-xs" value={b.remarks} onChange={e => setBankAccounts(p => p.map((x,i) => i===idx ? {...x, remarks:e.target.value} : x))} /></div>
                  </div>
                ))}
                {bankAccounts.length === 0 && <p className="text-xs text-muted-foreground">No bank accounts added yet.</p>}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <Button data-testid="btn-wizard-back" variant="outline" onClick={back} disabled={step === 1} className="gap-1.5">
          <ChevronLeft className="h-4 w-4" /> Back
        </Button>
        {step < 3 ? (
          <Button data-testid="btn-wizard-next" onClick={next} className="gap-1.5">
            Next <ChevronRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button data-testid="btn-wizard-submit" onClick={handleSubmit} disabled={isPending} className="gap-1.5">
            {isPending ? <><Loader2 className="h-4 w-4 animate-spin" />{isEdit ? "Saving…" : "Creating…"}</> : isEdit ? "Save Changes" : "Create Company"}
          </Button>
        )}
      </div>
    </div>
  );
}

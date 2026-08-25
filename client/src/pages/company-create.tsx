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
import { Building2, ChevronRight, ChevronLeft, CheckCircle2, Plus, Trash2, Loader2, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { checkIpList, parseIpList } from "@shared/ip";

const STEPS = [
  { id: 1, label: "Basic Information" },
  { id: 2, label: "Billing Information" },
  { id: 3, label: "Contacts & Bank" },
];

const COUNTRIES = ["United Kingdom","United States","Pakistan","India","Bangladesh","UAE","Saudi Arabia","Germany","France","Australia","Canada","Nigeria","Kenya","Egypt","South Africa","Other"];
const TIMEZONES = ["GMT+00:00 | UTC","GMT+01:00 | London","GMT+02:00 | Cairo","GMT+03:00 | Riyadh","GMT+04:00 | Dubai","GMT+05:00 | Karachi","GMT+05:30 | Mumbai","GMT+06:00 | Dhaka","GMT+07:00 | Bangkok","GMT+08:00 | Singapore","GMT+09:00 | Tokyo","GMT-05:00 | New York","GMT-08:00 | Los Angeles"];
const CURRENCIES = ["USD","EUR","GBP","AED","SAR","PKR","INR","BDT","NGN","KES","EGP"];
// Bi-monthly is 1–15 and 16–end of month (an accounting period), not a
// rolling 14 days. bi_weekly is kept so existing records still resolve; it
// normalizes to bi_monthly server-side.
const BILLING_CYCLES = ["weekly_cutoff","bi_monthly","monthly","daily","bi_weekly"];
const BILLING_CYCLE_LABELS: Record<string,string> = { weekly_cutoff:"Weekly (Mon–Sun)", bi_monthly:"Bi-Monthly (1–15, 16–EOM)", monthly:"Monthly", daily:"Daily", bi_weekly:"Bi-Weekly (legacy → bi-monthly)" };
// Commercial terms live on the company profile and drive the invoice due date
// directly — a term that states its own length ("net_30") needs no second
// lookup. "postpaid" and "credit" are kept so existing records still resolve.
const PAYMENT_TERMS = ["prepaid","net_7","net_15","net_30","net_45","net_60","postpaid","credit"];
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
  /** Empty = let the platform allocate. Set only when the operator deliberately picks one,
   *  which should be rare — auto is correct for essentially every company. */
  const [accountPrefix, setAccountPrefix] = useState("");
  const [pickPrefix, setPickPrefix] = useState(false);
  /** What the customer BUYS. Persisted to company_products, not wizard_draft — the
   *  provisioning engine and rate generator both query it. */
  const [productIds, setProductIds] = useState<number[]>([]);
  /** Destination ids, not country names. The rate engine, routing matrix and catalogue all
   *  key on destination — "Pakistan" would leave provisioning guessing between Pakistan
   *  Fixed, Pakistan Mobile and each operator breakout. */
  const [marketIds, setMarketIds] = useState<number[]>([]);

  const { data: freePrefixes } = useQuery<{ prefixes: string[] }>({
    queryKey: ["/api/account-prefixes/available", accountPrefix],
    queryFn: () => fetch(`/api/account-prefixes/available?q=${encodeURIComponent(accountPrefix)}&limit=20`)
      .then(r => r.json()),
    enabled: pickPrefix,
  });

  const { data: sellableProducts } = useQuery<Array<{ id: number; code: string; name: string; color?: string }>>({
    queryKey: ["/api/rate-manager/products"],
  });

  const { data: commercialDests } = useQuery<{ destinations: Array<{ id: number; prefix: string; name: string; countryCode: string | null }> }>({
    queryKey: ["/api/commercial-destinations"],
  });

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
    // Contacts too. They render as four empty rows otherwise, which reads as a company
    // with no contacts rather than a form that did not load them. Harmless to save today —
    // the PUT handler ignores contacts — but the display is still wrong, and the moment
    // that handler learns to write them the blank form becomes a deletion.
    if (Array.isArray(co.contacts) && co.contacts.length) {
      const byType: Record<string, Contact[]> = defaultContacts();
      for (const c of co.contacts) {
        const t = String(c.contactType ?? '').toLowerCase();
        if (!(t in byType)) continue;
        const row = { firstName: c.firstName ?? '', lastName: c.lastName ?? '',
                      email: c.email ?? '', phone: c.phone ?? '', fax: c.fax ?? '' };
        if (byType[t].length === 1 && !byType[t][0].firstName && !byType[t][0].email) byType[t][0] = row;
        else byType[t].push(row);
      }
      setContacts(byType);
    }
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
      const intent = data?.intent as { products: number; markets: number; error: string | null } | undefined;
      if (intent?.products)   done.push(`${intent.products} product${intent.products !== 1 ? "s" : ""}`);
      if (intent?.markets)    done.push(`${intent.markets} destination${intent.markets !== 1 ? "s" : ""}`);
      if (intent?.error)      failed.push("Product selection");

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
    onError: (e: any) => {
      // A field rejection belongs under the field. The toast still fires — the operator may
      // be looking at the button, not at step 3 — but the message also lands where the
      // correction has to be made, and survives the toast timing out.
      if (e?.body?.field === 'clientSipIps') {
        setStep(3);
        setErrors(prev => ({ ...prev, clientIps: e.message }));
      }
      toast({ title: e.message || "Failed to create company", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    // PUT, not PATCH. The route is app.put('/api/companies/:id') — a PATCH 404s, so
    // saving an edit has never worked; it failed as "not found" rather than as anything
    // an operator would connect to the Save button.
    mutationFn: (payload: any) => apiRequest("PUT", `/api/companies/${companyId}`, payload),
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
  const parseIps = parseIpList;

  // Recomputed on every keystroke, not on Next. Shape errors are cheap to check and the
  // operator is looking at the field right now; deferring the message to the button means
  // finding out about a typo after moving on from it.
  //
  // Shape only, deliberately — an IP that is well-formed but wrong is a business problem
  // the admin approval step exists to catch. This catches the typo.
  const ipCheck = checkIpList(clientIps);
  const ipsInvalid = !isEdit && ipCheck.invalid.length > 0;
  const ipsMissing = !isEdit && ipCheck.ips.length === 0;

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
    //
    // The per-address messages render under the field from ipCheck; this flag only stops
    // the step. Repeating the detail in a second place would let the two drift.
    if (step === 3 && !isEdit && ipsMissing) {
      errs.clientIps = "At least one client SIP IP is required.";
    }
    setErrors(errs);
    // ipsInvalid blocks without an entry in `errs` — the per-address messages are already
    // on screen under the field, and a summary line saying the same thing again would be
    // a second copy to keep in step with them.
    return Object.keys(errs).length === 0 && !(step === 3 && ipsInvalid);
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
    const payload = { basic, billing, contacts: pocContacts, bankAccounts, initialIps,
                      ...(accountPrefix ? { accountPrefix } : {}),
                      ...(productIds.length ? { productIds } : {}),
                      ...(marketIds.length ? { marketDestinationIds: marketIds } : {}) };
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
                    className={cn("text-sm font-mono",
                      (errors.clientIps || ipsInvalid) && "border-red-500/60 focus-visible:ring-red-500/40")}
                    aria-invalid={ipsInvalid || Boolean(errors.clientIps)}
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

                  {/* One line per bad address, naming the address and what is wrong with it.
                      A single "invalid IP address" over a three-line field makes the operator
                      work out which line — and the valid ones must not look accused. The
                      line number is shown only when there is more than one address, since
                      "Line 1" on a single-address field is noise. */}
                  {ipCheck.invalid.map(bad => (
                    <p key={bad.line} className="text-[11px] text-red-400 flex items-start gap-1.5">
                      <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
                      <span>
                        {ipCheck.ips.length > 1 && <span className="text-red-400/70">Line {bad.line}: </span>}
                        <span className="font-mono">{bad.value}</span> — {bad.message}
                      </span>
                    </p>
                  ))}
                  {/* Stated positively so the operator knows the field was read, not merely
                      that nothing complained. */}
                  {!ipsInvalid && ipCheck.ips.length > 0 && (
                    <p className="text-[11px] text-emerald-500 flex items-center gap-1.5">
                      <CheckCircle2 className="h-3 w-3 shrink-0" />
                      {ipCheck.ips.length === 1
                        ? 'Valid IPv4 address.'
                        : `${ipCheck.ips.length} valid IPv4 addresses.`}
                    </p>
                  )}

                  {/* What the customer buys. Cards rather than a dropdown: four to eight
                      options that an operator sets on every single company, where a
                      dropdown costs two clicks and hides the other choices. */}
                  <div className="pt-3 mt-3 border-t border-border/40 space-y-2">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-medium">Products</h3>
                      <span className="text-[11px] text-muted-foreground">
                        {productIds.length ? `${productIds.length} selected` : 'none — platform default applies'}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      {(sellableProducts ?? []).map(p => {
                        const on = productIds.includes(p.id);
                        return (
                          <button
                            key={p.id} type="button"
                            onClick={() => setProductIds(v => on ? v.filter(x => x !== p.id) : [...v, p.id])}
                            className={cn(
                              "text-left px-3 py-2 rounded-lg border transition-colors",
                              on ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-300"
                                 : "border-border/50 hover:border-emerald-500/40",
                            )}
                            data-testid={`btn-product-${p.code}`}
                          >
                            <div className="flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full shrink-0"
                                    style={{ background: on ? undefined : (p.color || '#6366f1') }} />
                              <span className="text-xs font-medium truncate">{p.name}</span>
                            </div>
                            <div className="text-[10px] text-muted-foreground mt-0.5">{p.code}</div>
                          </button>
                        );
                      })}
                    </div>
                    {!productIds.length && (
                      <p className="text-[11px] text-muted-foreground">
                        Leave empty to sell every product. A selection is a deliberate restriction.
                      </p>
                    )}
                  </div>

                  {/* Destinations, grouped by country so 32 rows stay scannable. Selecting
                      a country heading takes all of its destinations — a convenience over
                      the real unit, not a substitute for it. */}
                  <div className="pt-3 mt-3 border-t border-border/40 space-y-2">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-medium">Destinations</h3>
                      <span className="text-[11px] text-muted-foreground">
                        {marketIds.length ? `${marketIds.length} selected` : 'none — every commercial destination applies'}
                      </span>
                    </div>
                    {(() => {
                      const all = commercialDests?.destinations ?? [];
                      const groups = all.reduce((m, d) => {
                        const k = d.countryCode ?? '—';
                        (m[k] ??= []).push(d);
                        return m;
                      }, {} as Record<string, typeof all>);
                      const toggle = (ids: number[], on: boolean) =>
                        setMarketIds(v => on ? v.filter(x => !ids.includes(x)) : [...new Set([...v, ...ids])]);
                      return (
                        <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                          {Object.entries(groups).map(([cc, dests]) => {
                            const ids = dests.map(d => d.id);
                            const allOn = ids.every(i => marketIds.includes(i));
                            return (
                              <div key={cc}>
                                <button type="button"
                                  onClick={() => toggle(ids, allOn)}
                                  className="text-[11px] font-medium text-muted-foreground hover:text-foreground mb-1"
                                >
                                  +{cc} · {allOn ? 'clear all' : 'select all'} ({dests.length})
                                </button>
                                <div className="flex flex-wrap gap-1">
                                  {dests.map(d => {
                                    const on = marketIds.includes(d.id);
                                    return (
                                      <button key={d.id} type="button"
                                        onClick={() => toggle([d.id], on)}
                                        title={`${d.prefix} — ${d.name}`}
                                        className={cn(
                                          "px-2 py-0.5 rounded border text-[10px]",
                                          on ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-300"
                                             : "border-border/50 hover:border-emerald-500/40",
                                        )}
                                        data-testid={`btn-market-${d.prefix}`}
                                      >
                                        <span className="font-mono">{d.prefix}</span>{' '}
                                        <span className="text-muted-foreground">{d.name}</span>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                          {!all.length && (
                            <p className="text-[11px] text-muted-foreground">
                              No commercial destinations yet — assign destinations to products on the Product Registry page.
                            </p>
                          )}
                        </div>
                      );
                    })()}
                  </div>

                  {/* PROGRESSIVE DISCLOSURE. Auto is right for essentially every company —
                      the allocator falls back to a scan and can only fail when the whole
                      1001-9999 space is gone. Showing a picker by default would invite an
                      operator to invent a number the platform could have chosen correctly.
                      The chosen value is validated server-side on save; this list is stale
                      the moment it renders. */}
                  <div className="pt-3 mt-3 border-t border-border/40 space-y-2">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-medium">Account Prefix</h3>
                      {!pickPrefix ? (
                        <button type="button" className="text-[11px] underline text-muted-foreground hover:text-foreground"
                          onClick={() => setPickPrefix(true)} data-testid="link-choose-prefix">
                          choose manually
                        </button>
                      ) : (
                        <button type="button" className="text-[11px] underline text-muted-foreground hover:text-foreground"
                          onClick={() => { setPickPrefix(false); setAccountPrefix(""); }}>
                          use automatic
                        </button>
                      )}
                    </div>

                    {!pickPrefix ? (
                      <p className="text-[11px] text-muted-foreground">
                        Allocated automatically when the company is created.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        <Input
                          value={accountPrefix}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                            setAccountPrefix(e.target.value.replace(/\D/g, "").slice(0, 4))}
                          placeholder="type to filter…"
                          inputMode="numeric"
                          className="h-8 w-32 text-sm font-mono"
                          data-testid="input-account-prefix"
                        />
                        <div className="flex flex-wrap gap-1">
                          {(freePrefixes?.prefixes ?? []).map((p: string) => (
                            <button
                              key={p} type="button"
                              onClick={() => setAccountPrefix(p)}
                              className={cn(
                                "px-2 py-0.5 rounded border font-mono text-[11px]",
                                accountPrefix === p
                                  ? "border-emerald-500/60 text-emerald-400 bg-emerald-500/10"
                                  : "border-border/50 hover:border-emerald-500/40",
                              )}
                              data-testid={`btn-prefix-${p}`}
                            >
                              {p}
                            </button>
                          ))}
                          {!freePrefixes?.prefixes?.length && (
                            <span className="text-[11px] text-muted-foreground">
                              No free prefix matches “{accountPrefix}”.
                            </span>
                          )}
                        </div>
                        {accountPrefix.length === 4 && (
                          <p className="text-[11px] text-emerald-400">
                            Will use {accountPrefix} — checked again on save.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
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
          <div className="flex items-center gap-3">
            {/* Said out loud. A button that is disabled for a reason the operator cannot see
                reads as a broken page, and they retry rather than look up the field. */}
            {ipsInvalid && (
              <span className="text-[11px] text-red-400">
                Correct the SIP IP address{ipCheck.invalid.length > 1 ? 'es' : ''} above to continue.
              </span>
            )}
            <Button
              data-testid="btn-wizard-submit"
              onClick={handleSubmit}
              disabled={isPending || ipsInvalid}
              className="gap-1.5"
            >
              {isPending ? <><Loader2 className="h-4 w-4 animate-spin" />{isEdit ? "Saving…" : "Creating…"}</> : isEdit ? "Save Changes" : "Create Company"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

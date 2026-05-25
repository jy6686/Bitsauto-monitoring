import { useState, useEffect, useMemo } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Building2, Users, Server, Globe, Palette, CheckCircle2,
  ChevronRight, ChevronLeft, Save, Zap, AlertTriangle,
  CheckCircle, Clock, Phone, Mail, CreditCard, Shield,
  Key, Layers, Info, Loader2, UserPlus, FileText,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ── Constants ──────────────────────────────────────────────────────────────────

const COMPANY_TYPES = [
  { value: "retail",     label: "Retail",     desc: "Consumer / SME VoIP clients" },
  { value: "wholesale",  label: "Wholesale",   desc: "Bulk traffic, resale services" },
  { value: "reseller",   label: "Reseller",    desc: "Downstream white-label clients" },
  { value: "carrier",    label: "Carrier",     desc: "Wholesale interconnect, SS7" },
  { value: "enterprise", label: "Enterprise",  desc: "Large enterprise telephony" },
];

const CURRENCIES  = ["USD","EUR","GBP","AED","SAR","PKR","INR","BDT","NGN","KES","EGP"];
const COUNTRIES   = ["United Kingdom","United States","Pakistan","India","Bangladesh","UAE","Saudi Arabia","Germany","France","Australia","Canada","Nigeria","Kenya","Egypt","South Africa","Other"];
const TIMEZONES   = ["GMT+00:00 | UTC","GMT+01:00 | London","GMT+02:00 | Cairo","GMT+03:00 | Riyadh","GMT+04:00 | Dubai","GMT+05:00 | Karachi","GMT+05:30 | Mumbai","GMT+06:00 | Dhaka","GMT+07:00 | Bangkok","GMT+08:00 | Singapore","GMT+09:00 | Tokyo","GMT-05:00 | New York","GMT-08:00 | Los Angeles"];
const LANGUAGES   = ["English","Arabic","Urdu","Hindi","French","German","Spanish","Portuguese","Swahili","Bengali"];
const BILLING_CYCLES = [
  { value: "weekly_cutoff", label: "Weekly Cutoff" },
  { value: "monthly",       label: "Monthly" },
  { value: "daily",         label: "Daily" },
  { value: "bi_weekly",     label: "Bi-Weekly" },
];
const PAYMENT_TERMS = [
  { value: "prepaid",  label: "Prepaid" },
  { value: "postpaid", label: "Postpaid" },
  { value: "credit",   label: "Credit" },
];
const CODECS = [
  { value: "g711u",  label: "G.711u (PCMU)",   desc: "64 kbps, North America" },
  { value: "g711a",  label: "G.711a (PCMA)",   desc: "64 kbps, Europe/Asia" },
  { value: "g722",   label: "G.722 HD",         desc: "64 kbps, HD Voice" },
  { value: "g729",   label: "G.729",            desc: "8 kbps, low bandwidth" },
  { value: "any",    label: "Any / Passthrough", desc: "No codec restriction" },
];
const FRAUD_PROFILES = [
  { value: "standard",   label: "Standard",     desc: "Default detection rules" },
  { value: "high",       label: "High Alert",   desc: "Strict FAS/IRSF detection" },
  { value: "wholesale",  label: "Wholesale",    desc: "Relaxed for trusted carriers" },
  { value: "custom",     label: "Custom",       desc: "Configured separately" },
];

// ── Helper to derive steps based on company type ──────────────────────────────

function getSteps(companyType: string) {
  const isReseller = companyType === "reseller" || companyType === "wholesale";
  const steps = [
    { id: 1, label: "Company Info",    short: "Company",     icon: Building2 },
    { id: 2, label: "Contacts & Billing", short: "Contacts", icon: Users     },
    { id: 3, label: "Telecom Provisioning", short: "Provisioning", icon: Server },
    { id: 4, label: "Portal & Access", short: "Portal",     icon: Globe     },
    ...(isReseller ? [{ id: 5, label: "White Label", short: "Branding", icon: Palette }] : []),
    { id: isReseller ? 6 : 5, label: "Review & Activate", short: "Activate", icon: CheckCircle2 },
  ];
  return steps;
}

function toShortCode(name: string) {
  return name.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface ContactEntry { name: string; email: string; phone: string; }
const emptyContact = (): ContactEntry => ({ name: "", email: "", phone: "" });

const defaultS1 = () => ({
  name: "", shortCode: "", companyType: "retail", currency: "USD",
  timezone: "GMT+00:00 | UTC", country: "", language: "English",
  kam: "", status: "active", notes: "",
});
const defaultS2 = () => ({
  billingContact:   emptyContact(),
  technicalContact: emptyContact(),
  nocContact:       emptyContact(),
  invoiceEmail: "", billingCycle: "monthly", paymentTerm: "prepaid",
  creditLimit: "", taxVat: "", legalName: "",
});
const defaultS3 = () => ({
  routingGroupId: "", cpsLimit: "", concurrentCallsLimit: "", codec: "any",
  didAllocation: "", sipAuthEnabled: false, ipAuthEnabled: true,
  allowedRegions: "", fraudProfile: "standard", cliRules: "",
  customNotes: "",
});
const defaultS4 = () => ({
  enableClientPortal: false, enableResellerPortal: false,
  initialUserEmail: "", apiAccess: false, ipWhitelist: "",
  mfaRequired: false, permissionProfile: "standard",
});
const defaultS5 = () => ({
  logoUrl: "", portalDomain: "", smtpFrom: "", primaryColor: "#6366F1",
  invoiceBranding: "", portalName: "", supportEmail: "",
});

// ── Small UI helpers ──────────────────────────────────────────────────────────

function Field({ label, required, error, hint, children }: {
  label: string; required?: boolean; error?: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-foreground/80">
        {label}{required && <span className="text-rose-400 ml-0.5">*</span>}
      </Label>
      {children}
      {hint && !error && <p className="text-[10px] text-muted-foreground/60">{hint}</p>}
      {error && <p className="text-[10px] text-rose-400 flex items-center gap-1"><AlertTriangle className="w-2.5 h-2.5" />{error}</p>}
    </div>
  );
}

function SectionHeading({ icon: Icon, label, desc }: { icon: React.ComponentType<{className?: string}>; label: string; desc?: string }) {
  return (
    <div className="flex items-center gap-3 pb-3 border-b border-border/50 mb-5">
      <div className="w-7 h-7 rounded-lg bg-amber-500/15 border border-amber-500/25 flex items-center justify-center shrink-0">
        <Icon className="w-3.5 h-3.5 text-amber-400" />
      </div>
      <div>
        <p className="text-sm font-semibold text-foreground">{label}</p>
        {desc && <p className="text-[10px] text-muted-foreground/60 mt-0.5">{desc}</p>}
      </div>
    </div>
  );
}

function TypeCard({ value, label, desc, active, onClick }: {
  value: string; label: string; desc: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left p-3 rounded-lg border transition-all ${
        active
          ? "bg-amber-500/10 border-amber-500/50 shadow-sm"
          : "border-border hover:border-border/80 hover:bg-muted/30"
      }`}
    >
      <p className={`text-xs font-semibold ${active ? "text-amber-400" : "text-foreground/80"}`}>{label}</p>
      <p className="text-[10px] text-muted-foreground/60 mt-0.5">{desc}</p>
    </button>
  );
}

function ContactBlock({
  title, icon: Icon, contact, onChange,
}: {
  title: string;
  icon: React.ComponentType<{className?: string}>;
  contact: ContactEntry;
  onChange: (k: keyof ContactEntry, v: string) => void;
}) {
  return (
    <div className="rounded-lg border border-border/50 bg-muted/10 p-4 space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-3.5 h-3.5 text-muted-foreground/60" />
        <span className="text-xs font-semibold text-foreground/80">{title}</span>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Full Name">
          <Input className="h-8 text-xs" value={contact.name} onChange={e => onChange("name", e.target.value)} placeholder="John Smith" />
        </Field>
        <Field label="Email">
          <Input className="h-8 text-xs" type="email" value={contact.email} onChange={e => onChange("email", e.target.value)} placeholder="john@company.com" />
        </Field>
        <Field label="Phone">
          <Input className="h-8 text-xs" value={contact.phone} onChange={e => onChange("phone", e.target.value)} placeholder="+44 20 1234 5678" />
        </Field>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function CompanyOnboardingPage() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const { toast } = useToast();

  const params = new URLSearchParams(search);
  const resumeId = params.get("resumeId") ? parseInt(params.get("resumeId")!, 10) : null;

  const [step, setStep] = useState(1);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [draftId, setDraftId] = useState<number | null>(resumeId);
  const [activating, setActivating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const [s1, setS1] = useState(defaultS1());
  const [s2, setS2] = useState(defaultS2());
  const [s3, setS3] = useState(defaultS3());
  const [s4, setS4] = useState(defaultS4());
  const [s5, setS5] = useState(defaultS5());

  const steps = useMemo(() => getSteps(s1.companyType), [s1.companyType]);
  const totalSteps = steps.length;
  const isReseller = s1.companyType === "reseller" || s1.companyType === "wholesale";
  const reviewStep = isReseller ? 6 : 5;
  const isReview = step === reviewStep;

  // ── Data queries ────────────────────────────────────────────────────────────

  const { data: kamsData } = useQuery<{ id: number; name: string; email: string; orgRole: string }[]>({
    queryKey: ["/api/kam"], retry: false,
  });

  const { data: routingGroupsData } = useQuery<{ groups: { groupId: number; groupName: string }[] }>({
    queryKey: ["/api/sippy/routing-groups/list"],
    retry: false,
    staleTime: 60_000,
  });

  // ── Resume draft ────────────────────────────────────────────────────────────

  const { data: resumeData } = useQuery<{ company: any }>({
    queryKey: ["/api/companies", resumeId],
    queryFn: () => fetch(`/api/companies/${resumeId}`).then(r => r.json()),
    enabled: !!resumeId,
  });

  useEffect(() => {
    if (!resumeData?.company?.wizardDraft) return;
    try {
      const draft = JSON.parse(resumeData.company.wizardDraft);
      if (draft.s1) setS1(draft.s1);
      if (draft.s2) setS2(draft.s2);
      if (draft.s3) setS3(draft.s3);
      if (draft.s4) setS4(draft.s4);
      if (draft.s5) setS5(draft.s5);
      toast({ title: "Draft resumed", description: `Continuing onboarding for ${resumeData.company.name}` });
    } catch { /* ignore bad draft JSON */ }
  }, [resumeData]);

  // ── Auto shortcode ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (s1.name && !s1.shortCode) {
      setS1(p => ({ ...p, shortCode: toShortCode(p.name) }));
    }
  }, [s1.name]);

  // ── Validation ──────────────────────────────────────────────────────────────

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (step === 1) {
      if (!s1.name.trim())      errs.name      = "Company name is required";
      if (!s1.shortCode.trim()) errs.shortCode  = "Short code is required";
      if (!s1.companyType)      errs.companyType = "Select a company type";
    }
    if (step === 2) {
      if (!s2.invoiceEmail.trim()) errs.invoiceEmail = "Invoice email is required";
      if (s2.billingContact.email && !/\S+@\S+\.\S+/.test(s2.billingContact.email))
        errs.billingEmail = "Invalid billing contact email";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const next = () => { if (validate()) setStep(s => Math.min(s + 1, totalSteps)); };
  const back = () => setStep(s => Math.max(s - 1, 1));

  // ── Build payload ───────────────────────────────────────────────────────────

  const buildPayload = () => {
    const contacts = [
      s2.billingContact.email   ? { contactType: "billing",   firstName: s2.billingContact.name.split(" ")[0] || "Billing",   lastName: s2.billingContact.name.split(" ").slice(1).join(" ") || "",   email: s2.billingContact.email,   phone: s2.billingContact.phone   } : null,
      s2.technicalContact.email ? { contactType: "technical",  firstName: s2.technicalContact.name.split(" ")[0] || "Technical", lastName: s2.technicalContact.name.split(" ").slice(1).join(" ") || "", email: s2.technicalContact.email, phone: s2.technicalContact.phone } : null,
      s2.nocContact.email       ? { contactType: "noc",        firstName: s2.nocContact.name.split(" ")[0] || "NOC",           lastName: s2.nocContact.name.split(" ").slice(1).join(" ") || "",       email: s2.nocContact.email,       phone: s2.nocContact.phone       } : null,
    ].filter(Boolean);

    const wizardDraft = JSON.stringify({ s1, s2, s3, s4, s5, savedAt: new Date().toISOString() });

    return {
      basic: {
        name: s1.name.trim(),
        shortCode: s1.shortCode.trim().toUpperCase(),
        country: s1.country,
        kam: s1.kam,
        status: s1.status,
        companyType: s1.companyType,
        contractType: "bilateral",
        department: s1.companyType,
        clientTimezone: s1.timezone,
        currency: s1.currency,
        notes: s1.notes,
      },
      billing: {
        clientBillingCycle: s2.billingCycle,
        paymentTerm: s2.paymentTerm,
        clientCreditLimit: parseFloat(s2.creditLimit) || 0,
        invoiceEmail: s2.invoiceEmail,
        legalNameCi: s2.legalName,
      },
      contacts,
      bankAccounts: [],
      wizardDraft,
    };
  };

  // ── Save Draft ──────────────────────────────────────────────────────────────

  const saveDraft = async () => {
    if (!s1.name.trim() || !s1.shortCode.trim()) {
      toast({ title: "Enter company name and short code before saving a draft", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const payload = buildPayload();
      if (draftId) {
        await apiRequest("PUT", `/api/companies/${draftId}`, {
          ...payload.basic,
          wizardDraft: payload.wizardDraft,
        });
        toast({ title: "Draft saved", description: `Updated draft for ${s1.name}` });
      } else {
        const res = await apiRequest("POST", "/api/companies", payload);
        const data = await res.json();
        if (data.company?.id) {
          setDraftId(data.company.id);
          // Attach the full wizardDraft to the created record
          await apiRequest("PUT", `/api/companies/${data.company.id}`, { wizardDraft: payload.wizardDraft });
          toast({ title: "Draft saved", description: `Draft created for ${s1.name}` });
          queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
        }
      }
    } catch (e: any) {
      toast({ title: "Failed to save draft", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // ── Activate ────────────────────────────────────────────────────────────────

  const activate = async (activateLater = false) => {
    if (!validate()) return;
    setActivating(true);
    try {
      const payload = buildPayload();
      let companyId = draftId;

      if (!companyId) {
        const res = await apiRequest("POST", "/api/companies", payload);
        const data = await res.json();
        if (!data.company?.id) throw new Error(data.message || "Failed to create company");
        companyId = data.company.id;
      } else {
        await apiRequest("PUT", `/api/companies/${companyId}`, {
          ...payload.basic,
          clientBillingCycle: payload.billing.clientBillingCycle,
          paymentTerm: payload.billing.paymentTerm,
          clientCreditLimit: payload.billing.clientCreditLimit,
          invoiceEmail: payload.billing.invoiceEmail,
          legalNameCi: payload.billing.legalNameCi,
        });
      }

      // Store full wizard draft + status
      const status = activateLater ? "draft" : "active";
      await apiRequest("PUT", `/api/companies/${companyId}`, {
        wizardDraft: payload.wizardDraft,
        provisioningStatus: status,
      });

      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });

      if (activateLater) {
        toast({ title: "Saved — activation pending", description: `${s1.name} is saved as draft. Resume anytime from the company list.` });
        navigate("/company/list");
      } else {
        setDone(true);
        toast({ title: "Company activated!", description: `${s1.name} is now active. Use Quick Create Account to provision Sippy credentials.` });
      }
    } catch (e: any) {
      toast({ title: "Activation failed", description: e.message, variant: "destructive" });
    } finally {
      setActivating(false);
    }
  };

  // ── Done screen ─────────────────────────────────────────────────────────────

  if (done) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-16 text-center space-y-6">
        <div className="w-16 h-16 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mx-auto">
          <CheckCircle className="w-8 h-8 text-emerald-400" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-foreground">{s1.name} is now active</h2>
          <p className="text-sm text-muted-foreground mt-2">
            The company record has been created and activated. Use <strong>Quick Create Account</strong> to provision Sippy credentials and set up trunks.
          </p>
        </div>
        <div className="flex items-center justify-center gap-3 flex-wrap">
          <Button onClick={() => navigate("/company/list")} variant="outline" className="gap-2">
            <Building2 className="w-4 h-4" /> View Company List
          </Button>
          <Button onClick={() => navigate("/client/wizard")} className="gap-2 bg-amber-500 hover:bg-amber-600 text-black">
            <UserPlus className="w-4 h-4" /> Quick Create Account
          </Button>
          <Button onClick={() => { setDone(false); setStep(1); setS1(defaultS1()); setS2(defaultS2()); setS3(defaultS3()); setS4(defaultS4()); setS5(defaultS5()); setDraftId(null); }} variant="ghost" className="gap-2">
            <Zap className="w-4 h-4" /> Onboard Another
          </Button>
        </div>
      </div>
    );
  }

  // ── Main layout ─────────────────────────────────────────────────────────────

  const pct = ((step - 1) / (totalSteps - 1)) * 100;

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">

      {/* ── Page header ───────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Building2 className="w-5 h-5 text-amber-400" />
            Company Onboarding Wizard
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Enterprise telecom onboarding — company, contacts, provisioning, portal, and activation
          </p>
        </div>
        <div className="flex items-center gap-2">
          {step > 1 && (
            <Button variant="outline" size="sm" onClick={saveDraft} disabled={saving} className="gap-1.5 text-xs h-8" data-testid="btn-save-draft">
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
              Save Draft
            </Button>
          )}
          <Badge variant="outline" className="text-[10px] text-muted-foreground">
            Step {step} of {totalSteps}
          </Badge>
        </div>
      </div>

      {/* ── Progress bar ──────────────────────────────────────────────────── */}
      <div className="h-1 rounded-full bg-muted/40 overflow-hidden">
        <div className="h-full bg-amber-500 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>

      {/* ── Horizontal stepper ────────────────────────────────────────────── */}
      <div className="flex items-center gap-0 overflow-x-auto">
        {steps.map((s, idx) => {
          const done    = step > s.id;
          const active  = step === s.id;
          const pending = step < s.id;
          const Icon = s.icon;
          return (
            <div key={s.id} className="flex items-center flex-1 min-w-0">
              <button
                onClick={() => done && setStep(s.id)}
                disabled={pending}
                className={`flex items-center gap-2 px-2 py-1.5 rounded-lg flex-1 min-w-0 transition-all text-left ${
                  active  ? "bg-amber-500/12 border border-amber-500/30" :
                  done    ? "cursor-pointer hover:bg-muted/30" :
                  "opacity-40 cursor-not-allowed"
                }`}
                data-testid={`step-btn-${s.id}`}
              >
                <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold border ${
                  done   ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-400" :
                  active ? "bg-amber-500/20  border-amber-500/50  text-amber-400" :
                  "bg-muted/30 border-border text-muted-foreground"
                }`}>
                  {done ? <CheckCircle2 className="w-3 h-3" /> : <Icon className="w-3 h-3" />}
                </div>
                <span className={`text-[11px] font-medium truncate hidden sm:block ${active ? "text-amber-400" : done ? "text-muted-foreground" : "text-muted-foreground/50"}`}>
                  {s.short}
                </span>
              </button>
              {idx < steps.length - 1 && <ChevronRight className="w-3 h-3 text-muted-foreground/30 shrink-0" />}
            </div>
          );
        })}
      </div>

      {/* ── Step content ──────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border/60 bg-card p-6 min-h-[380px]">

        {/* ── STEP 1 — Company Information ─────────────────────────────── */}
        {step === 1 && (
          <div className="space-y-6">
            <SectionHeading icon={Building2} label="Company Information" desc="Core identity and classification for this client" />

            <div>
              <p className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-widest mb-3">Company Type</p>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {COMPANY_TYPES.map(t => (
                  <TypeCard key={t.value} {...t} active={s1.companyType === t.value} onClick={() => setS1(p => ({ ...p, companyType: t.value }))} />
                ))}
              </div>
              {errors.companyType && <p className="text-[10px] text-rose-400 mt-1">{errors.companyType}</p>}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Company Name" required error={errors.name}>
                <Input className="h-9 text-sm" value={s1.name} onChange={e => setS1(p => ({ ...p, name: e.target.value }))} placeholder="Acme Telecom Ltd." data-testid="input-company-name" />
              </Field>
              <Field label="Short Code" required error={errors.shortCode} hint="Up to 6 chars, auto-generated from name">
                <Input className="h-9 text-sm font-mono uppercase" value={s1.shortCode} maxLength={6} onChange={e => setS1(p => ({ ...p, shortCode: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") }))} placeholder="ACMTEL" data-testid="input-short-code" />
              </Field>
              <Field label="Country">
                <Select value={s1.country} onValueChange={v => setS1(p => ({ ...p, country: v }))}>
                  <SelectTrigger className="h-9 text-sm" data-testid="select-country"><SelectValue placeholder="Select country" /></SelectTrigger>
                  <SelectContent>{COUNTRIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Currency">
                <Select value={s1.currency} onValueChange={v => setS1(p => ({ ...p, currency: v }))}>
                  <SelectTrigger className="h-9 text-sm" data-testid="select-currency"><SelectValue /></SelectTrigger>
                  <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Timezone">
                <Select value={s1.timezone} onValueChange={v => setS1(p => ({ ...p, timezone: v }))}>
                  <SelectTrigger className="h-9 text-sm" data-testid="select-timezone"><SelectValue /></SelectTrigger>
                  <SelectContent>{TIMEZONES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Language">
                <Select value={s1.language} onValueChange={v => setS1(p => ({ ...p, language: v }))}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>{LANGUAGES.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Account Manager (KAM)">
                <Select value={s1.kam} onValueChange={v => setS1(p => ({ ...p, kam: v }))}>
                  <SelectTrigger className="h-9 text-sm" data-testid="select-kam"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Unassigned</SelectItem>
                    {(kamsData ?? []).map(k => <SelectItem key={k.id} value={k.name}>{k.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Status">
                <Select value={s1.status} onValueChange={v => setS1(p => ({ ...p, status: v }))}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                    <SelectItem value="suspended">Suspended</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field label="Notes / Internal Remarks">
              <Textarea className="text-sm min-h-[72px] resize-none" value={s1.notes} onChange={e => setS1(p => ({ ...p, notes: e.target.value }))} placeholder="Internal notes, KAM context, special instructions…" />
            </Field>
          </div>
        )}

        {/* ── STEP 2 — Contacts & Billing ──────────────────────────────── */}
        {step === 2 && (
          <div className="space-y-6">
            <SectionHeading icon={Users} label="Contacts & Billing" desc="Operational contacts and financial configuration" />

            <div className="space-y-3">
              <ContactBlock title="Billing Contact" icon={CreditCard} contact={s2.billingContact}   onChange={(k, v) => setS2(p => ({ ...p, billingContact:   { ...p.billingContact,   [k]: v } }))} />
              <ContactBlock title="Technical Contact" icon={Server}   contact={s2.technicalContact} onChange={(k, v) => setS2(p => ({ ...p, technicalContact: { ...p.technicalContact, [k]: v } }))} />
              <ContactBlock title="NOC Contact"       icon={Phone}    contact={s2.nocContact}       onChange={(k, v) => setS2(p => ({ ...p, nocContact:       { ...p.nocContact,       [k]: v } }))} />
            </div>

            <div className="pt-2">
              <p className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-widest mb-4">Billing Configuration</p>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Invoice Email" required error={errors.invoiceEmail}>
                  <Input className="h-9 text-sm" type="email" value={s2.invoiceEmail} onChange={e => setS2(p => ({ ...p, invoiceEmail: e.target.value }))} placeholder="billing@company.com" data-testid="input-invoice-email" />
                </Field>
                <Field label="Legal Company Name (Invoice)">
                  <Input className="h-9 text-sm" value={s2.legalName} onChange={e => setS2(p => ({ ...p, legalName: e.target.value }))} placeholder="Acme Telecom Limited" />
                </Field>
                <Field label="Billing Cycle">
                  <Select value={s2.billingCycle} onValueChange={v => setS2(p => ({ ...p, billingCycle: v }))}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>{BILLING_CYCLES.map(b => <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <Field label="Payment Terms">
                  <Select value={s2.paymentTerm} onValueChange={v => setS2(p => ({ ...p, paymentTerm: v }))}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>{PAYMENT_TERMS.map(pt => <SelectItem key={pt.value} value={pt.value}>{pt.label}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <Field label="Credit Limit" hint="0 = no credit limit">
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{s1.currency}</span>
                    <Input className="h-9 text-sm pl-11" type="number" min="0" value={s2.creditLimit} onChange={e => setS2(p => ({ ...p, creditLimit: e.target.value }))} placeholder="0" />
                  </div>
                </Field>
                <Field label="Tax / VAT Number">
                  <Input className="h-9 text-sm" value={s2.taxVat} onChange={e => setS2(p => ({ ...p, taxVat: e.target.value }))} placeholder="GB123456789" />
                </Field>
              </div>
            </div>
          </div>
        )}

        {/* ── STEP 3 — Telecom Provisioning ────────────────────────────── */}
        {step === 3 && (
          <div className="space-y-6">
            <SectionHeading icon={Server} label="Telecom Provisioning" desc="Routing, capacity, authentication and fraud settings" />

            <div className="grid grid-cols-2 gap-4">
              <Field label="Routing Group" hint="Maps to Sippy routing group on activation">
                <Select value={s3.routingGroupId} onValueChange={v => setS3(p => ({ ...p, routingGroupId: v }))}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select routing group" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">None — assign after activation</SelectItem>
                    {(routingGroupsData?.groups ?? []).map(g => (
                      <SelectItem key={g.groupId} value={String(g.groupId)}>{g.groupName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Codec Policy">
                <Select value={s3.codec} onValueChange={v => setS3(p => ({ ...p, codec: v }))}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>{CODECS.map(c => <SelectItem key={c.value} value={c.value}>{c.label} — {c.desc}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Max CPS (Calls Per Second)" hint="Leave blank for unlimited">
                <Input className="h-9 text-sm" type="number" min="0" value={s3.cpsLimit} onChange={e => setS3(p => ({ ...p, cpsLimit: e.target.value }))} placeholder="e.g. 10" />
              </Field>
              <Field label="Max Concurrent Calls" hint="Leave blank for unlimited">
                <Input className="h-9 text-sm" type="number" min="0" value={s3.concurrentCallsLimit} onChange={e => setS3(p => ({ ...p, concurrentCallsLimit: e.target.value }))} placeholder="e.g. 200" />
              </Field>
              <Field label="DID Allocation" hint="Number range or pool name">
                <Input className="h-9 text-sm" value={s3.didAllocation} onChange={e => setS3(p => ({ ...p, didAllocation: e.target.value }))} placeholder="+44 20 XXXX XXXX pool" />
              </Field>
              <Field label="Allowed Regions" hint="Comma-separated regions or 'all'">
                <Input className="h-9 text-sm" value={s3.allowedRegions} onChange={e => setS3(p => ({ ...p, allowedRegions: e.target.value }))} placeholder="UK, EU, US, Middle East" />
              </Field>
              <Field label="Fraud Profile">
                <Select value={s3.fraudProfile} onValueChange={v => setS3(p => ({ ...p, fraudProfile: v }))}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>{FRAUD_PROFILES.map(f => <SelectItem key={f.value} value={f.value}>{f.label} — {f.desc}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="CLI Rules" hint="Translation / stripping rules">
                <Input className="h-9 text-sm font-mono" value={s3.cliRules} onChange={e => setS3(p => ({ ...p, cliRules: e.target.value }))} placeholder="s/^44/0/" />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-muted/10">
                <div>
                  <p className="text-xs font-medium text-foreground/80">IP Authentication</p>
                  <p className="text-[10px] text-muted-foreground/60 mt-0.5">Allow calls from authorised IPs without SIP digest</p>
                </div>
                <Switch checked={s3.ipAuthEnabled} onCheckedChange={v => setS3(p => ({ ...p, ipAuthEnabled: v }))} data-testid="switch-ip-auth" />
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-muted/10">
                <div>
                  <p className="text-xs font-medium text-foreground/80">SIP Digest Authentication</p>
                  <p className="text-[10px] text-muted-foreground/60 mt-0.5">Require SIP username/password credentials</p>
                </div>
                <Switch checked={s3.sipAuthEnabled} onCheckedChange={v => setS3(p => ({ ...p, sipAuthEnabled: v }))} data-testid="switch-sip-auth" />
              </div>
            </div>

            <Field label="Provisioning Notes">
              <Textarea className="text-sm min-h-[64px] resize-none" value={s3.customNotes} onChange={e => setS3(p => ({ ...p, customNotes: e.target.value }))} placeholder="Special routing requirements, SBC config notes, trunk preferences…" />
            </Field>

            <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-500/8 border border-blue-500/20">
              <Info className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />
              <p className="text-[11px] text-blue-300/80">
                Provisioning config is saved to the company record. Full Sippy account creation (SIP credentials, trunk groups) is done via <strong>Quick Create Account</strong> after activation.
              </p>
            </div>
          </div>
        )}

        {/* ── STEP 4 — Portal & Access ──────────────────────────────────── */}
        {step === 4 && (
          <div className="space-y-5">
            <SectionHeading icon={Globe} label="Portal & Access" desc="Client portal access, API credentials and security policy" />

            <div className="space-y-3">
              {[
                { key: "enableClientPortal",   label: "Enable Client Portal",   desc: "Allow this company to access the self-service portal", testId: "switch-client-portal" },
                { key: "enableResellerPortal",  label: "Enable Reseller Portal", desc: "Allow downstream reseller management portal access",   testId: "switch-reseller-portal" },
                { key: "apiAccess",             label: "API Access",             desc: "Enable REST API access with key authentication",       testId: "switch-api-access" },
                { key: "mfaRequired",           label: "Require MFA",            desc: "Enforce multi-factor authentication for all portal users", testId: "switch-mfa" },
              ].map(item => (
                <div key={item.key} className="flex items-center justify-between p-3.5 rounded-lg border border-border/50 bg-muted/10">
                  <div>
                    <p className="text-xs font-medium text-foreground/80">{item.label}</p>
                    <p className="text-[10px] text-muted-foreground/60 mt-0.5">{item.desc}</p>
                  </div>
                  <Switch
                    checked={(s4 as any)[item.key]}
                    onCheckedChange={v => setS4(p => ({ ...p, [item.key]: v }))}
                    data-testid={item.testId}
                  />
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Initial User Email" hint="Leave blank to skip user creation">
                <Input className="h-9 text-sm" type="email" value={s4.initialUserEmail} onChange={e => setS4(p => ({ ...p, initialUserEmail: e.target.value }))} placeholder="admin@company.com" data-testid="input-initial-user" />
              </Field>
              <Field label="Permission Profile">
                <Select value={s4.permissionProfile} onValueChange={v => setS4(p => ({ ...p, permissionProfile: v }))}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="standard">Standard</SelectItem>
                    <SelectItem value="read_only">Read-Only</SelectItem>
                    <SelectItem value="full_admin">Full Admin</SelectItem>
                    <SelectItem value="reseller_admin">Reseller Admin</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="IP Whitelist" hint="Comma-separated CIDRs for portal access">
                <Input className="h-9 text-sm font-mono" value={s4.ipWhitelist} onChange={e => setS4(p => ({ ...p, ipWhitelist: e.target.value }))} placeholder="192.168.1.0/24, 10.0.0.1" />
              </Field>
            </div>
          </div>
        )}

        {/* ── STEP 5 — White Label (resellers/wholesale only) ───────────── */}
        {step === 5 && isReseller && (
          <div className="space-y-5">
            <SectionHeading icon={Palette} label="White Label & Branding" desc="Custom portal identity, branding and downstream reseller setup" />

            <div className="grid grid-cols-2 gap-4">
              <Field label="Portal Name" hint="Shown in browser title and portal header">
                <Input className="h-9 text-sm" value={s5.portalName} onChange={e => setS5(p => ({ ...p, portalName: e.target.value }))} placeholder="Acme Voice Portal" />
              </Field>
              <Field label="Custom Portal Domain" hint="e.g. portal.acmevoice.com">
                <Input className="h-9 text-sm font-mono" value={s5.portalDomain} onChange={e => setS5(p => ({ ...p, portalDomain: e.target.value }))} placeholder="portal.acmevoice.com" />
              </Field>
              <Field label="Support Email">
                <Input className="h-9 text-sm" type="email" value={s5.supportEmail} onChange={e => setS5(p => ({ ...p, supportEmail: e.target.value }))} placeholder="support@acmevoice.com" />
              </Field>
              <Field label="SMTP From Address" hint="Sender address for portal emails">
                <Input className="h-9 text-sm" type="email" value={s5.smtpFrom} onChange={e => setS5(p => ({ ...p, smtpFrom: e.target.value }))} placeholder="noreply@acmevoice.com" />
              </Field>
              <Field label="Brand Primary Color">
                <div className="flex gap-2 items-center">
                  <input type="color" value={s5.primaryColor} onChange={e => setS5(p => ({ ...p, primaryColor: e.target.value }))} className="w-9 h-9 rounded border border-border cursor-pointer" />
                  <Input className="h-9 text-sm font-mono flex-1" value={s5.primaryColor} onChange={e => setS5(p => ({ ...p, primaryColor: e.target.value }))} placeholder="#6366F1" />
                </div>
              </Field>
              <Field label="Logo URL" hint="Direct URL to company logo (PNG/SVG)">
                <Input className="h-9 text-sm" value={s5.logoUrl} onChange={e => setS5(p => ({ ...p, logoUrl: e.target.value }))} placeholder="https://cdn.acmevoice.com/logo.png" />
              </Field>
              <Field label="Invoice Branding" hint="Company name shown on generated invoices" className="col-span-2">
                <Input className="h-9 text-sm" value={s5.invoiceBranding} onChange={e => setS5(p => ({ ...p, invoiceBranding: e.target.value }))} placeholder="Acme Telecom Limited — Powered by Bitsauto" />
              </Field>
            </div>

            <div className="flex items-start gap-2 p-3 rounded-lg bg-violet-500/8 border border-violet-500/20">
              <Layers className="w-3.5 h-3.5 text-violet-400 shrink-0 mt-0.5" />
              <p className="text-[11px] text-violet-300/80">
                White label settings are stored on the company record. Full theme deployment and DNS configuration is done via <strong>Settings → Organization → White Labeling</strong>.
              </p>
            </div>
          </div>
        )}

        {/* ── STEP 6 / 5 — Review & Activate ──────────────────────────── */}
        {isReview && (
          <div className="space-y-5">
            <SectionHeading icon={CheckCircle2} label="Review & Activate" desc="Confirm all details before activating the company" />

            {/* Summary grid */}
            <div className="grid grid-cols-2 gap-3">
              {/* Company summary */}
              <div className="rounded-lg border border-border/50 bg-muted/10 p-4 space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 mb-3 flex items-center gap-1.5"><Building2 className="w-3 h-3" /> Company</p>
                {[
                  ["Name",       s1.name       ],
                  ["Type",       s1.companyType ],
                  ["Short Code", s1.shortCode   ],
                  ["Country",    s1.country     ],
                  ["Currency",   s1.currency    ],
                  ["KAM",        s1.kam || "Unassigned"],
                ].map(([k,v]) => (
                  <div key={k} className="flex justify-between text-xs">
                    <span className="text-muted-foreground/60">{k}</span>
                    <span className="font-medium text-foreground/80 text-right">{v || "—"}</span>
                  </div>
                ))}
              </div>
              {/* Billing summary */}
              <div className="rounded-lg border border-border/50 bg-muted/10 p-4 space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 mb-3 flex items-center gap-1.5"><CreditCard className="w-3 h-3" /> Billing</p>
                {[
                  ["Invoice Email",   s2.invoiceEmail ],
                  ["Billing Cycle",   s2.billingCycle ],
                  ["Payment Terms",   s2.paymentTerm  ],
                  ["Credit Limit",    s2.creditLimit ? `${s1.currency} ${s2.creditLimit}` : "None"],
                  ["Tax / VAT",       s2.taxVat || "—"],
                ].map(([k,v]) => (
                  <div key={k} className="flex justify-between text-xs">
                    <span className="text-muted-foreground/60">{k}</span>
                    <span className="font-medium text-foreground/80 text-right">{v || "—"}</span>
                  </div>
                ))}
              </div>
              {/* Provisioning summary */}
              <div className="rounded-lg border border-border/50 bg-muted/10 p-4 space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 mb-3 flex items-center gap-1.5"><Server className="w-3 h-3" /> Provisioning</p>
                {[
                  ["Routing Group",  s3.routingGroupId ? `RG#${s3.routingGroupId}` : "Assign after activation"],
                  ["Codec",          CODECS.find(c => c.value === s3.codec)?.label || s3.codec],
                  ["CPS Limit",      s3.cpsLimit || "Unlimited"],
                  ["Concurrency",    s3.concurrentCallsLimit || "Unlimited"],
                  ["Fraud Profile",  FRAUD_PROFILES.find(f => f.value === s3.fraudProfile)?.label || s3.fraudProfile],
                  ["IP Auth",        s3.ipAuthEnabled ? "Enabled" : "Disabled"],
                ].map(([k,v]) => (
                  <div key={k} className="flex justify-between text-xs">
                    <span className="text-muted-foreground/60">{k}</span>
                    <span className="font-medium text-foreground/80 text-right">{v}</span>
                  </div>
                ))}
              </div>
              {/* Portal & Access summary */}
              <div className="rounded-lg border border-border/50 bg-muted/10 p-4 space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 mb-3 flex items-center gap-1.5"><Globe className="w-3 h-3" /> Portal & Access</p>
                {[
                  ["Client Portal",   s4.enableClientPortal  ? "Enabled" : "Disabled"],
                  ["Reseller Portal", s4.enableResellerPortal ? "Enabled" : "Disabled"],
                  ["API Access",      s4.apiAccess            ? "Enabled" : "Disabled"],
                  ["MFA",            s4.mfaRequired           ? "Required" : "Optional"],
                  ["Initial User",   s4.initialUserEmail || "None"],
                ].map(([k,v]) => (
                  <div key={k} className="flex justify-between text-xs">
                    <span className="text-muted-foreground/60">{k}</span>
                    <span className="font-medium text-foreground/80 text-right">{v}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Validation checks */}
            <div className="rounded-lg border border-border/50 bg-muted/10 p-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 mb-3 flex items-center gap-1.5"><Shield className="w-3 h-3" /> Validation</p>
              <div className="space-y-2">
                {[
                  { ok: !!s1.name.trim(),         msg: "Company name is set" },
                  { ok: !!s1.shortCode.trim(),    msg: "Short code is set" },
                  { ok: !!s2.invoiceEmail.trim(), msg: "Invoice email is configured" },
                  { ok: !!s1.currency,            msg: "Currency is selected" },
                  { ok: s2.billingContact.email ? /\S+@\S+\.\S+/.test(s2.billingContact.email) : true, msg: "Billing contact email is valid" },
                  { ok: !!s3.fraudProfile,        msg: "Fraud profile is assigned" },
                ].map(({ ok, msg }) => (
                  <div key={msg} className="flex items-center gap-2 text-xs">
                    {ok
                      ? <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      : <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    }
                    <span className={ok ? "text-foreground/70" : "text-amber-400"}>{msg}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

      </div>

      {/* ── Navigation ────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3">
        <Button variant="outline" onClick={back} disabled={step === 1} className="gap-1.5" data-testid="btn-back">
          <ChevronLeft className="w-4 h-4" /> Back
        </Button>

        <div className="flex items-center gap-2">
          {isReview ? (
            <>
              <Button variant="outline" onClick={() => activate(true)} disabled={activating || saving} className="gap-1.5 text-sm" data-testid="btn-activate-later">
                {activating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Clock className="w-3.5 h-3.5" />}
                Activate Later
              </Button>
              <Button onClick={() => activate(false)} disabled={activating} className="gap-1.5 bg-amber-500 hover:bg-amber-600 text-black font-semibold" data-testid="btn-activate">
                {activating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                Activate Company
              </Button>
            </>
          ) : (
            <Button onClick={next} className="gap-1.5 bg-amber-500 hover:bg-amber-600 text-black font-semibold" data-testid="btn-next">
              Next <ChevronRight className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

    </div>
  );
}

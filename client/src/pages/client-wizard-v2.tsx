/**
 * Customer Preparation Wizard 2.0 — Onboarding 2.0, Sprint 2.1.
 *
 * The wizard PREPARES a customer; it never writes to Sippy. KAM, NOC and Commercial can
 * all run it, so anything it created on the switch would make the admin-only provision
 * gate meaningless. See docs/capabilities/ONBOARDING-2.0.md §3.1.
 *
 * Same five steps and the same POST /api/client-wizard/submit contract as the legacy
 * wizard — buildPayload() below produces a byte-compatible payload. What changed is what
 * the operator is ASKED. Everything technical now comes from the Provisioning Profile at
 * provision time (Sprint 2.3); until then the previous defaults are sent unchanged, so
 * this release alters the UI and nothing else.
 *
 * Removed from the UI (category D/E): tariff, service plan, billing package, rate upload,
 * routing group, product package, codec, media relay, max CPS, max sessions, credit limit,
 * internal ids, and the applied profiles/policies themselves. The operator does not choose
 * them and does not need to see them.
 *
 * Served at /client-wizard only when platform flag `customer_preparation_wizard_v2` is on;
 * otherwise the legacy wizard renders. Legacy stays reachable at /client-wizard-legacy.
 */
import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Users, Contact as ContactIcon, Receipt, Network, CheckCircle2,
  ChevronLeft, ChevronRight, Plus, Trash2, Copy, Eye, EyeOff, ShieldCheck, AlertTriangle,
} from "lucide-react";

const STEPS = [
  { id: 1, label: "Company",        icon: Users },
  { id: 2, label: "Contacts",       icon: ContactIcon },
  { id: 3, label: "Commercial",     icon: Receipt },
  { id: 4, label: "Authentication", icon: Network },
  { id: 5, label: "Review",         icon: CheckCircle2 },
];

const DEPARTMENTS = [
  { value: "retail",     label: "Retail" },
  { value: "wholesale",  label: "Wholesale" },
  { value: "enterprise", label: "Enterprise" },
  { value: "carrier",    label: "Carrier" },
];

/** Contact roles the notification profile resolves against (migration 040). */
const CONTACT_ROLES = [
  { key: "primary",   label: "Primary Contact",   hint: "Welcome, account notices" },
  { key: "technical", label: "Technical Contact", hint: "Traffic, fraud, SIP alerts" },
  { key: "billing",   label: "Billing Contact",   hint: "Invoices, balance alerts" },
] as const;

type ContactRole = typeof CONTACT_ROLES[number]["key"];
interface Contact { name: string; email: string; phone: string; }
interface IpEntry { ip: string; trunk: string; description: string; status: string; }

const emptyContact = (): Contact => ({ name: "", email: "", phone: "" });
const emptyIp      = (): IpEntry  => ({ ip: "", trunk: "", description: "", status: "pending" });

function genPassword(len = 12) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

/**
 * Technical defaults sent to the unchanged API. These are NOT operator choices and are
 * NOT shown. They reproduce the legacy wizard's defaults exactly, so behaviour is
 * identical; Sprint 2.3 replaces them with the Provisioning Profile at provision time.
 */
const SILENT_TECHNICAL_DEFAULTS = {
  step2: {
    invoiceTemplate:  "Standard",
    ratesheetFull:    "Full CSV",
    ratesheetPartial: "",
    ratesheetAtoz:    "",
    ratesheetFormats: ["Full CSV"],
    dialcodeFormat:   "E.164",
    prefixStyle:      "with_plus",
    // servicePlanId omitted — auto-detect, as "Auto-select" did (DEFECT-CP-002 is why the
    // control is gone rather than defaulted to a specific plan).
  },
  trunk: {
    trunkName: "First Class", routingGroupId: "", maxTime: "3600", maxSessions: "0",
    maxCps: "", codec: "0", useCodecOnly: false, lifetime: "never", relayType: "0",
    prefix: "", cldTranslation: "s/^//", assertedIdRule: "", useAssertedId: false,
    preventLoops: false, allowRegistration: true, blocked: false,
  },
  selectedProducts: ["First Class"] as string[],
  destinations:     [] as unknown[],
};

// ── UI helpers ────────────────────────────────────────────────────────────────
function Field({ label, required, hint, children }: {
  label: string; required?: boolean; hint?: string; children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground mb-1 block">
        {label}{required && <span className="text-rose-400 ml-0.5">*</span>}
      </label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground/70 mt-1">{hint}</p>}
    </div>
  );
}

const inputCls =
  "w-full px-3 py-2 text-sm rounded-lg bg-background border border-border " +
  "focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors";

/**
 * A readiness row is actionable, not decorative: when a check fails it names the specific
 * reason and offers a jump to the step that fixes it. "✗ Authentication" alone makes the
 * operator hunt for what is wrong.
 */
function ReadinessRow({ ok, label, detail, onFix }: {
  ok: boolean; label: string; detail: string; onFix?: () => void;
}) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-border/50 last:border-0 gap-3">
      <div className="flex items-center gap-2 min-w-0">
        {ok
          ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          : <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />}
        <span className="text-sm shrink-0">{label}</span>
        {!ok && <span className="text-xs text-amber-400/90 truncate">— {detail}</span>}
      </div>
      {ok
        ? <span className="text-xs text-emerald-400 shrink-0">{detail}</span>
        : onFix && (
          <button type="button" onClick={onFix}
            className="text-xs text-primary hover:underline shrink-0 whitespace-nowrap">
            Fix →
          </button>
        )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function ClientWizardV2Page() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [step, setStep] = useState(1);
  const [submitted, setSubmitted] = useState(false);
  const [showPw, setShowPw] = useState(false);

  // Step 1 — company (business only)
  const [company, setCompany] = useState({
    department: "retail", companyId: "", displayName: "", userId: "",
    password: genPassword(),
  });

  // Step 2 — contacts by role. The notification profile maps events to these roles, so
  // the operator never configures a per-customer notification matrix (migration 040).
  const [contacts, setContacts] = useState<Record<ContactRole, Contact>>({
    primary: emptyContact(), technical: emptyContact(), billing: emptyContact(),
  });

  // Step 4 — authentication
  const [authType, setAuthType] = useState<"ip" | "registration">("ip");
  const [ips, setIps] = useState<IpEntry[]>([emptyIp()]);

  const { data: companies = [] } = useQuery<any[]>({ queryKey: ["/api/companies"] });
  const selected = companies.find((c: any) => String(c.id) === company.companyId);

  // Step 3 — commercial terms. These are COMPANY columns; the wizard is another view of
  // them, never a second copy. Edits save through PUT /api/companies/:id, so there is one
  // database column, one source of truth, and no context switch to a different screen.
  const [terms, setTerms] = useState({
    paymentTerm: "", clientBillingCycle: "", clientGracePeriod: 3,
    disputeOverVal: 100, currency: "USD",
  });
  const [termsLoadedFor, setTermsLoadedFor] = useState<string>("");

  // Load the selected company's real values once per selection. Payment term falls back to
  // the company-type rule rather than a blank, so the default is visible and overridable.
  if (selected && termsLoadedFor !== company.companyId) {
    setTermsLoadedFor(company.companyId);
    setTerms({
      paymentTerm:        selected.paymentTerm        ?? (company.department === "wholesale" ? "postpaid" : "prepaid"),
      clientBillingCycle: selected.clientBillingCycle ?? "weekly_cutoff",
      clientGracePeriod:  selected.clientGracePeriod  ?? 3,
      disputeOverVal:     selected.disputeOverVal     ?? 100,
      currency:           selected.currency           ?? "USD",
    });
  }

  const termsDirty = !!selected && (
    terms.paymentTerm        !== (selected.paymentTerm        ?? terms.paymentTerm) ||
    terms.clientBillingCycle !== (selected.clientBillingCycle ?? terms.clientBillingCycle) ||
    terms.clientGracePeriod  !== (selected.clientGracePeriod  ?? terms.clientGracePeriod) ||
    terms.disputeOverVal     !== (selected.disputeOverVal     ?? terms.disputeOverVal) ||
    terms.currency           !== (selected.currency           ?? terms.currency)
  );

  const saveTermsMutation = useMutation({
    // __source tags the audit entry so a later reader can tell a wizard edit from a
    // company-editor edit without inferring it from timing.
    mutationFn: () => apiRequest("PUT", `/api/companies/${company.companyId}`, { ...terms, __source: "preparation-wizard" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      toast({ title: "Commercial terms saved to the company" });
    },
    onError: (e: any) => toast({ title: e.message || "Could not save terms", variant: "destructive" }),
  });

  const submitMutation = useMutation({
    mutationFn: (payload: any) => apiRequest("POST", "/api/client-wizard/submit", payload),
    onSuccess: () => {
      setSubmitted(true);
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      toast({ title: "Customer prepared — ready for provision" });
    },
    onError: (e: any) => toast({ title: e.message || "Failed to save draft", variant: "destructive" }),
  });

  /**
   * Identical shape to the legacy wizard's payload — the API is untouched in Sprint 2.1.
   * Contact roles collapse into the existing notif fields so no data is lost today; the
   * structured `contacts` key rides along additively for Sprint 2.3 to consume.
   */
  const buildPayload = () => ({
    step1: {
      department:       company.department,
      companyId:        company.companyId,
      password:         company.password,
      displayName:      company.displayName,
      userId:           company.userId,
      notifEmailTo:     contacts.primary.email,
      notifEmailCc:     [contacts.technical.email, contacts.billing.email].filter(Boolean).join(","),
      balanceThreshold: "",
      a2zNotif:         "no",
      rateNotif:        "full_sheet",
    },
    step2: SILENT_TECHNICAL_DEFAULTS.step2,
    trunks: [SILENT_TECHNICAL_DEFAULTS.trunk],
    ips: ips.filter(i => i.ip.trim()),
    iCustomer: 1,
    selectedProducts: SILENT_TECHNICAL_DEFAULTS.selectedProducts,
    destinations: SILENT_TECHNICAL_DEFAULTS.destinations,
    // Additive — ignored by the current endpoint, consumed in Sprint 2.3.
    contacts,
    authType,
  });

  // ── Readiness ───────────────────────────────────────────────────────────────
  // Each check names the SPECIFIC reason it fails and which step fixes it, so Review is
  // an actionable checklist rather than a verdict the operator has to interpret.
  const checks = [
    {
      key: "company", step: 1, label: "Company",
      ok: !!company.companyId && !!company.displayName.trim() && !!company.userId.trim(),
      why: !company.companyId ? "No company selected"
         : !company.displayName.trim() ? "Display name is empty"
         : "Account username is empty",
    },
    {
      key: "contacts", step: 2, label: "Contacts",
      ok: !!contacts.primary.email.trim(),
      why: "Primary contact email is required — it receives the welcome notification",
    },
    {
      key: "commercial", step: 3, label: "Commercial",
      ok: !!selected,
      why: "Select a company in Step 1 to load its terms",
    },
    {
      key: "auth", step: 4, label: "Authentication",
      ok: authType === "registration" || ips.some(i => i.ip.trim()),
      why: "No IP address added — IP authentication needs at least one",
    },
  ];
  const ready = checks.every(c => c.ok);

  // ── Unsaved-work guard ──────────────────────────────────────────────────────
  // Any entered work counts, not only the commercial terms: losing a half-filled wizard to
  // a stray refresh is the kind of small loss that pushes operators back to spreadsheets.
  const hasUnsavedWork = !submitted && (
    !!company.companyId || !!company.displayName.trim() || !!company.userId.trim() ||
    CONTACT_ROLES.some(r => contacts[r.key].name || contacts[r.key].email || contacts[r.key].phone) ||
    ips.some(i => i.ip.trim()) || termsDirty
  );

  useEffect(() => {
    if (!hasUnsavedWork) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasUnsavedWork]);

  const setContact = (role: ContactRole, k: keyof Contact, v: string) =>
    setContacts(p => ({ ...p, [role]: { ...p[role], [k]: v } }));

  if (submitted) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-10">
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.07] px-6 py-8 text-center space-y-3">
          <ShieldCheck className="w-10 h-10 text-emerald-400 mx-auto" />
          <h2 className="text-lg font-semibold text-emerald-300">Customer prepared</h2>
          <p className="text-sm text-emerald-300/80">
            {company.displayName} is ready for provision. An administrator will approve the IPs
            and provision the account — nothing has been created on the switch yet.
          </p>
          <button onClick={() => navigate("/company/list")}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium">
            Back to Companies
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <div className="flex items-center gap-3 mb-1">
        <Users className="w-5 h-5 text-primary" />
        <h1 className="text-xl font-semibold">
          Prepare Customer{selected ? <span className="text-muted-foreground font-normal">: {selected.name}</span> : null}
        </h1>
      </div>
      <p className="text-xs text-muted-foreground mb-6">
        Collects the business information needed to provision. Nothing is created in Sippy here.
      </p>

      {/* Stepper */}
      <div className="flex items-center gap-2 mb-6 flex-wrap">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          const active = step === s.id, done = step > s.id;
          return (
            <div key={s.id} className="flex items-center gap-2">
              <button onClick={() => setStep(s.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                  active ? "bg-primary/10 border-primary/50 text-primary"
                  : done ? "border-emerald-500/40 text-emerald-400"
                  : "border-border text-muted-foreground"}`}>
                <Icon className="w-3.5 h-3.5" />{s.id}. {s.label}
              </button>
              {i < STEPS.length - 1 && <ChevronRight className="w-3 h-3 text-muted-foreground/40" />}
            </div>
          );
        })}
      </div>

      <div className="rounded-xl border border-border bg-card p-6 space-y-5">
        {/* ── STEP 1 — Company ── */}
        {step === 1 && (
          <>
            <h2 className="text-sm font-semibold">Company Information</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Company" required>
                <select className={inputCls} value={company.companyId}
                  onChange={e => {
                    const c = companies.find((x: any) => String(x.id) === e.target.value);
                    setCompany(p => ({
                      ...p, companyId: e.target.value,
                      displayName: p.displayName || c?.name || "",
                      userId:      p.userId      || c?.shortCode?.toLowerCase() || "",
                    }));
                  }}>
                  <option value="">Select company…</option>
                  {companies.map((c: any) => (
                    <option key={c.id} value={c.id}>{c.name}{c.shortCode ? ` (${c.shortCode})` : ""}</option>
                  ))}
                </select>
              </Field>
              <Field label="Department" required>
                <select className={inputCls} value={company.department}
                  onChange={e => setCompany(p => ({ ...p, department: e.target.value }))}>
                  {DEPARTMENTS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
              </Field>
              <Field label="Display Name" required hint="Shown on the account — defaults to the company name">
                <input className={inputCls} value={company.displayName}
                  onChange={e => setCompany(p => ({ ...p, displayName: e.target.value }))} />
              </Field>
              <Field label="Account Username" required hint="Auto-filled from the short code — editable">
                <input className={inputCls} value={company.userId}
                  onChange={e => setCompany(p => ({ ...p, userId: e.target.value }))} />
              </Field>
              <Field label="Password" required hint="Generated — regenerate or edit if needed">
                <div className="flex gap-2">
                  <input className={inputCls} type={showPw ? "text" : "password"} value={company.password}
                    onChange={e => setCompany(p => ({ ...p, password: e.target.value }))} />
                  <button type="button" onClick={() => setShowPw(v => !v)}
                    className="px-2 rounded-lg border border-border text-muted-foreground">
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                  <button type="button" onClick={() => navigator.clipboard?.writeText(company.password)}
                    className="px-2 rounded-lg border border-border text-muted-foreground">
                    <Copy className="w-4 h-4" />
                  </button>
                  <button type="button" onClick={() => setCompany(p => ({ ...p, password: genPassword() }))}
                    className="px-3 rounded-lg border border-border text-xs text-muted-foreground whitespace-nowrap">
                    Re-generate
                  </button>
                </div>
              </Field>
            </div>
          </>
        )}

        {/* ── STEP 2 — Contacts ── */}
        {step === 2 && (
          <>
            <h2 className="text-sm font-semibold">Contacts</h2>
            <p className="text-xs text-muted-foreground">
              Notifications are addressed by role, configured once by an administrator. Enter the
              people; the platform decides which of them receives what.
            </p>
            {CONTACT_ROLES.map(role => (
              <div key={role.key} className="rounded-lg border border-border p-4 space-y-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-medium">
                    {role.label}{role.key === "primary" && <span className="text-rose-400 ml-0.5">*</span>}
                  </span>
                  <span className="text-[11px] text-muted-foreground">{role.hint}</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <input className={inputCls} placeholder="Name" value={contacts[role.key].name}
                    onChange={e => setContact(role.key, "name", e.target.value)} />
                  <input className={inputCls} placeholder="Email" type="email" value={contacts[role.key].email}
                    onChange={e => setContact(role.key, "email", e.target.value)} />
                  <input className={inputCls} placeholder="Phone (optional)" value={contacts[role.key].phone}
                    onChange={e => setContact(role.key, "phone", e.target.value)} />
                </div>
              </div>
            ))}
          </>
        )}

        {/* ── STEP 3 — Commercial ── */}
        {step === 3 && (
          <>
            <h2 className="text-sm font-semibold">Commercial Terms</h2>
            {!selected ? (
              <p className="text-sm text-amber-400">Select a company in Step 1 first.</p>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  Edited here and saved onto the company record itself — the wizard is another
                  view of the same fields, not a second copy of them.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Field label="Payment Term" hint="Defaults from company type — Wholesale postpaid, Retail prepaid">
                    <select className={inputCls} value={terms.paymentTerm}
                      onChange={e => setTerms(p => ({ ...p, paymentTerm: e.target.value }))}>
                      <option value="prepaid">Prepaid</option>
                      <option value="postpaid">Postpaid</option>
                    </select>
                  </Field>
                  <Field label="Billing Cycle">
                    <select className={inputCls} value={terms.clientBillingCycle}
                      onChange={e => setTerms(p => ({ ...p, clientBillingCycle: e.target.value }))}>
                      <option value="weekly_cutoff">Weekly (7 days)</option>
                      <option value="biweekly_cutoff">Bi-Weekly (14 days)</option>
                      <option value="monthly_cutoff">Monthly</option>
                    </select>
                  </Field>
                  <Field label="Grace Period (days)">
                    <input className={inputCls} type="number" min={0} value={terms.clientGracePeriod}
                      onChange={e => setTerms(p => ({ ...p, clientGracePeriod: Number(e.target.value) }))} />
                  </Field>
                  <Field label="Dispute Value (USD)" hint="Policy is USD 100 or 1%, whichever governs">
                    <input className={inputCls} type="number" min={0} step="0.01" value={terms.disputeOverVal}
                      onChange={e => setTerms(p => ({ ...p, disputeOverVal: Number(e.target.value) }))} />
                  </Field>
                  <Field label="Currency">
                    <select className={inputCls} value={terms.currency}
                      onChange={e => setTerms(p => ({ ...p, currency: e.target.value }))}>
                      {["USD", "AED", "EUR", "GBP"].map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </Field>
                </div>
                <div className="flex items-center justify-between pt-1">
                  <p className="text-[11px] text-muted-foreground">
                    Credit limit is not here — Finance owns it in Balance Management.
                  </p>
                  {termsDirty && (
                    <button type="button" disabled={saveTermsMutation.isPending}
                      onClick={() => saveTermsMutation.mutate()}
                      className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium disabled:opacity-40">
                      {saveTermsMutation.isPending ? "Saving…" : "Save terms"}
                    </button>
                  )}
                </div>
              </>
            )}
          </>
        )}

        {/* ── STEP 4 — Authentication ── */}
        {step === 4 && (
          <>
            <h2 className="text-sm font-semibold">Authentication</h2>
            <div className="flex gap-2">
              {(["ip", "registration"] as const).map(t => (
                <button key={t} type="button" onClick={() => setAuthType(t)}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-medium ${
                    authType === t ? "bg-primary/10 border-primary/50 text-primary"
                                   : "border-border text-muted-foreground"}`}>
                  {t === "ip" ? "IP Authentication" : "Registration"}
                </button>
              ))}
            </div>

            {authType === "ip" && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  IPs are submitted for approval. Traffic stays blocked until an administrator
                  approves them — preparing a customer never opens the switch.
                </p>
                {ips.map((row, i) => (
                  <div key={i} className="flex gap-2">
                    <input className={inputCls} placeholder="IP address or CIDR" value={row.ip}
                      onChange={e => setIps(p => p.map((r, j) => j === i ? { ...r, ip: e.target.value } : r))}
                      onPaste={e => {
                        const lines = e.clipboardData.getData("text").split(/[\n\r,;]/)
                          .map(l => l.trim()).filter(l => /\d/.test(l));
                        if (lines.length > 1) {
                          e.preventDefault();
                          setIps(p => { const c = [...p]; c.splice(i, 1, ...lines.map(ip => ({ ...emptyIp(), ip }))); return c; });
                          toast({ title: `Detected ${lines.length} IPs — split into rows` });
                        }
                      }} />
                    <input className={inputCls} placeholder="Description (optional)" value={row.description}
                      onChange={e => setIps(p => p.map((r, j) => j === i ? { ...r, description: e.target.value } : r))} />
                    <button type="button" onClick={() => setIps(p => p.filter((_, j) => j !== i))}
                      className="px-2 rounded-lg border border-border text-rose-400"><Trash2 className="w-4 h-4" /></button>
                  </div>
                ))}
                <button type="button" onClick={() => setIps(p => [...p, emptyIp()])}
                  className="inline-flex items-center gap-1 text-xs text-primary">
                  <Plus className="w-3.5 h-3.5" /> Add IP
                </button>
              </div>
            )}
          </>
        )}

        {/* ── STEP 5 — Review ── */}
        {step === 5 && (
          <>
            <h2 className="text-sm font-semibold">Provision Readiness</h2>
            <div className="rounded-lg border border-border px-4 py-2">
              {checks.map(c => (
                <ReadinessRow key={c.key} ok={c.ok} label={c.label}
                  detail={c.ok
                    ? (c.key === "commercial" && termsDirty ? "Unsaved edits — saved on submit" : "Complete")
                    : c.why}
                  onFix={() => setStep(c.step)} />
              ))}
            </div>
            <div className={`rounded-lg px-4 py-3 text-sm font-medium ${
              ready ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-300"
                    : "bg-amber-500/10 border border-amber-500/30 text-amber-300"}`}>
              {ready ? "READY FOR PROVISION" : "Not ready — complete the steps above"}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Saving prepares the customer. An administrator approves the IPs and provisions the
              account; nothing is created in Sippy until then.
            </p>
          </>
        )}
      </div>

      {/* Nav */}
      <div className="flex items-center justify-between mt-5">
        <button type="button" disabled={step === 1} onClick={() => setStep(s => s - 1)}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-border text-sm disabled:opacity-40">
          <ChevronLeft className="w-4 h-4" /> Back
        </button>
        {step < 5 ? (
          <button type="button" onClick={() => setStep(s => s + 1)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium">
            Next <ChevronRight className="w-4 h-4" />
          </button>
        ) : (
          <button type="button" disabled={!ready || submitMutation.isPending || saveTermsMutation.isPending}
            onClick={async () => {
              // Persist any unsaved commercial edits to the company FIRST. Without this an
              // operator who edits terms and goes straight to Save silently loses them —
              // they live on the company, not in the draft payload.
              if (termsDirty) {
                try { await saveTermsMutation.mutateAsync(); }
                catch { return; }   // error already surfaced; don't submit a half-saved customer
              }
              submitMutation.mutate(buildPayload());
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-40">
            {submitMutation.isPending || saveTermsMutation.isPending ? "Saving…" : "Save — Ready for Provision"}
          </button>
        )}
      </div>
    </div>
  );
}

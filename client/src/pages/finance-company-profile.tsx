// Settings → Finance → Company Profile
//
// Why this page exists: `settings` is a singleton row, and the issuer-identity
// columns on it (billing*, remit*, invoice document metadata — migrations 075/076)
// are the ONE authoritative record the invoice renderer reads for every document
// it produces. There is deliberately no per-invoice override and no second copy:
// configure the issuer here and every invoice picks it up. Unconfigured fields
// stay honest on the document — the renderer prints "Not configured" (or omits
// the block) rather than inventing a legal name, payment terms or bank details.
//
// PATCH /api/settings accepts any subset of columns (admin-only, audited), so
// Save sends only the fields that actually changed, with '' normalised to NULL
// so an emptied field truly unsets the column.
//
// NOTE: the file is finance-company-profile.tsx (not company-profile.tsx)
// because @/pages/company-profile already exists — it is the Org Management
// company-creation wizard at /company-profile, an unrelated surface.

import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Building2, Mail, Scale, Landmark, FileText, Send, Save, Loader2,
} from "lucide-react";
import { api } from "@shared/routes";
import { apiRequest } from "@/lib/queryClient";
import { useSettings } from "@/hooks/use-settings";
import { useToast } from "@/hooks/use-toast";

// ── Field inventory ───────────────────────────────────────────────────────────
// Exactly the columns this page owns. The PATCH body only ever contains keys
// from this list, so nothing else on the settings row can be disturbed here.

const PROFILE_KEYS = [
  // Company information
  "billingLegalName", "billingTradingName", "billingRegistrationNumber",
  "billingTaxId", "billingVatNumber", "billingWebsite", "billingRegisteredAddress",
  // Billing contacts
  "billingContactEmail", "billingSupportEmail", "billingDisputeEmail",
  // Commercial defaults
  "billingDefaultPaymentTerm", "billingDefaultCurrency",
  // Bank / remittance details
  "remitBeneficiaryName", "remitBankName", "remitBankBranch", "remitBankAddress",
  "remitAccountNumber", "remitIban", "remitSwift", "remitCorrespondentBank",
  "remitCurrency", "remitNotes",
  // Invoice document
  "invoiceNumberPrefix", "invoiceNumberFormat", "invoiceDecimalPlaces",
  "invoiceDateFormat", "invoiceFooterNote", "invoiceTermsNote",
] as const;

type ProfileKey = (typeof PROFILE_KEYS)[number];
type ProfileForm = Record<ProfileKey, string>;

const EMPTY_FORM = Object.fromEntries(PROFILE_KEYS.map(k => [k, ""])) as ProfileForm;

const EMAIL_KEYS: ProfileKey[] = ["billingContactEmail", "billingSupportEmail", "billingDisputeEmail"];
// Deliberately loose: something@something.tld — a hint, not a validator.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PAYMENT_TERM_OPTIONS = [
  { value: "",        label: "Not configured — invoices show 'Not configured'" },
  { value: "prepaid", label: "Prepaid" },
  { value: "net_7",   label: "Net 7" },
  { value: "net_15",  label: "Net 15" },
  { value: "net_30",  label: "Net 30" },
  { value: "net_45",  label: "Net 45" },
  { value: "net_60",  label: "Net 60" },
];

const DATE_FORMAT_OPTIONS = [
  { value: "",            label: "Default (YYYY-MM-DD)" },
  { value: "YYYY-MM-DD",  label: "YYYY-MM-DD" },
  { value: "DD MMM YYYY", label: "DD MMM YYYY" },
  { value: "DD/MM/YYYY",  label: "DD/MM/YYYY" },
  { value: "MM/DD/YYYY",  label: "MM/DD/YYYY" },
];

// ── Presentational helpers (module level so inputs never remount mid-typing) ──

const INPUT_CLS = "w-full px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";

function Field({ label, value, onChange, testId, placeholder, hint, invalid, type = "text", min, max, className }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  testId: string;
  placeholder?: string;
  hint?: string;
  invalid?: boolean;
  type?: string;
  min?: number;
  max?: number;
  className?: string;
}) {
  return (
    <div className={`space-y-1.5 ${className ?? ""}`}>
      <label className="text-sm font-medium">{label}</label>
      <input
        type={type}
        data-testid={testId}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        min={min}
        max={max}
        className={`${INPUT_CLS} ${invalid ? "border-red-500/70" : "border-border"}`}
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function AreaField({ label, value, onChange, testId, placeholder, hint, rows = 3 }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  testId: string;
  placeholder?: string;
  hint?: string;
  rows?: number;
}) {
  return (
    <div className="space-y-1.5 md:col-span-2">
      <label className="text-sm font-medium">{label}</label>
      <textarea
        data-testid={testId}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className={`${INPUT_CLS} border-border resize-y`}
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function SelectField({ label, value, onChange, testId, options, hint }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  testId: string;
  options: { value: string; label: string }[];
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">{label}</label>
      <select
        data-testid={testId}
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`${INPUT_CLS} border-border`}
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function SectionCard({ icon: Icon, title, desc, note, children }: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  desc?: string;
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <section className="bg-card border border-border rounded-xl shadow-sm p-6 space-y-4">
        <div className="flex items-start gap-3">
          <Icon className="h-5 w-5 text-primary mt-0.5 shrink-0" />
          <div>
            <h2 className="text-base font-semibold">{title}</h2>
            {desc && <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>}
          </div>
        </div>
        {children}
      </section>
      {note && <p className="text-xs text-muted-foreground px-1">{note}</p>}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function FinanceCompanyProfilePage() {
  const { data: settings, isLoading } = useSettings();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [form, setForm] = useState<ProfileForm>(EMPTY_FORM);
  const [snapshot, setSnapshot] = useState<ProfileForm | null>(null);

  // Hydrate from the singleton row; the snapshot is the dirty-diff baseline.
  useEffect(() => {
    if (!settings) return;
    const next = { ...EMPTY_FORM };
    for (const k of PROFILE_KEYS) {
      const v = (settings as Record<string, unknown>)[k];
      next[k] = v == null ? "" : String(v);
    }
    setForm(next);
    setSnapshot(next);
  }, [settings]);

  const set = (k: ProfileKey) => (v: string) => setForm(f => ({ ...f, [k]: v }));

  const dirty = snapshot != null && PROFILE_KEYS.some(k => form[k] !== snapshot[k]);

  const emailInvalid = (k: ProfileKey) => {
    const v = form[k].trim();
    return v !== "" && !EMAIL_SHAPE.test(v);
  };
  const anyEmailInvalid = EMAIL_KEYS.some(emailInvalid);

  const saveMut = useMutation({
    mutationFn: (payload: Record<string, string | number | null>) =>
      apiRequest("PATCH", "/api/settings", payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [api.settings.get.path] });
      toast({ title: "Company profile saved" });
    },
    onError: (err: any) =>
      toast({ title: "Save failed", description: err?.message, variant: "destructive" }),
  });

  const handleSave = () => {
    if (!snapshot) return;
    // Only the fields that changed vs the loaded snapshot; '' → null so an
    // emptied field genuinely unsets the column instead of storing ''.
    const payload: Record<string, string | number | null> = {};
    for (const k of PROFILE_KEYS) {
      if (form[k] === snapshot[k]) continue;
      const raw = form[k].trim();
      if (k === "invoiceDecimalPlaces") {
        const n = parseInt(raw, 10);
        payload[k] = raw === "" || !Number.isFinite(n) ? null : Math.min(6, Math.max(0, n));
      } else {
        payload[k] = raw === "" ? null : raw;
      }
    }
    if (Object.keys(payload).length === 0) return;
    saveMut.mutate(payload);
  };

  if (isLoading) {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-6" data-testid="company-profile-skeleton">
        <div className="h-9 w-72 max-w-full rounded-lg bg-muted animate-pulse" />
        <div className="h-4 w-96 max-w-full rounded bg-muted animate-pulse" />
        {[0, 1, 2, 3, 4].map(i => (
          <div key={i} className="h-40 rounded-xl border border-border bg-card animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Building2 className="h-7 w-7 text-primary mt-0.5 shrink-0" />
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-company-profile-title">Company Profile</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            The issuer identity printed on every invoice — legal identity, billing contacts, bank
            remittance details and document defaults all come from this single record.
          </p>
        </div>
        <button
          type="button"
          data-testid="button-save-company-profile"
          onClick={handleSave}
          disabled={!dirty || anyEmailInvalid || saveMut.isPending}
          title={anyEmailInvalid ? "Fix the highlighted email address first" : undefined}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 shrink-0"
        >
          {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saveMut.isPending ? "Saving…" : "Save changes"}
        </button>
      </div>

      {/* 1. Company Information */}
      <SectionCard icon={Building2} title="Company Information" desc="Legal identity of the invoice issuer as it appears on the document header.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Legal Name" value={form.billingLegalName} onChange={set("billingLegalName")}
            testId="input-billing-legal-name" placeholder="Ichibaan Logic FZE" />
          <Field label="Trading Name" value={form.billingTradingName} onChange={set("billingTradingName")}
            testId="input-billing-trading-name" placeholder="Trading-as name, if different" />
          <Field label="Registration Number" value={form.billingRegistrationNumber} onChange={set("billingRegistrationNumber")}
            testId="input-billing-registration-number" placeholder="Company / licence number" />
          <Field label="Tax ID" value={form.billingTaxId} onChange={set("billingTaxId")}
            testId="input-billing-tax-id" placeholder="TRN / EIN / tax reference" />
          <Field label="VAT Number" value={form.billingVatNumber} onChange={set("billingVatNumber")}
            testId="input-billing-vat-number" placeholder="VAT registration number" />
          <Field label="Website" value={form.billingWebsite} onChange={set("billingWebsite")}
            testId="input-billing-website" placeholder="https://example.com" />
          <AreaField label="Registered Address" value={form.billingRegisteredAddress} onChange={set("billingRegisteredAddress")}
            testId="input-billing-registered-address" placeholder={"Street\nCity\nCountry"} />
        </div>
      </SectionCard>

      {/* 2. Billing Contacts */}
      <SectionCard
        icon={Mail}
        title="Billing Contacts"
        desc="Contact addresses printed on the invoice for customer queries."
        note="The billing email prints on invoices as the queries contact; the dispute email prints as the disputes contact and, when unset, falls back to the billing email."
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Billing Email" value={form.billingContactEmail} onChange={set("billingContactEmail")}
            testId="input-billing-contact-email" placeholder="billing@example.com" type="email"
            invalid={emailInvalid("billingContactEmail")}
            hint={emailInvalid("billingContactEmail") ? "Doesn't look like an email address" : undefined} />
          <Field label="Support Email" value={form.billingSupportEmail} onChange={set("billingSupportEmail")}
            testId="input-billing-support-email" placeholder="support@example.com" type="email"
            invalid={emailInvalid("billingSupportEmail")}
            hint={emailInvalid("billingSupportEmail") ? "Doesn't look like an email address" : undefined} />
          <Field label="Dispute Email" value={form.billingDisputeEmail} onChange={set("billingDisputeEmail")}
            testId="input-billing-dispute-email" placeholder="disputes@example.com" type="email"
            invalid={emailInvalid("billingDisputeEmail")}
            hint={emailInvalid("billingDisputeEmail") ? "Doesn't look like an email address" : undefined} />
        </div>
      </SectionCard>

      {/* 3. Commercial Defaults */}
      <SectionCard
        icon={Scale}
        title="Commercial Defaults"
        desc="Fallback commercial terms used only when a company has none of its own."
        note={'Per-company terms always win; this default applies only when a company has no terms of its own. When nothing is configured anywhere the invoice deliberately prints "Not configured" instead of inventing terms.'}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SelectField label="Default Payment Term" value={form.billingDefaultPaymentTerm}
            onChange={set("billingDefaultPaymentTerm")} testId="select-billing-default-payment-term"
            options={PAYMENT_TERM_OPTIONS} />
          <Field label="Default Currency" value={form.billingDefaultCurrency} onChange={set("billingDefaultCurrency")}
            testId="input-billing-default-currency" placeholder="USD" />
        </div>
      </SectionCard>

      {/* 4. Bank Details */}
      <SectionCard
        icon={Landmark}
        title="Bank Details"
        desc="Remittance details printed on the invoice payment page."
        note="These are YOUR receiving account details shown to customers — not customer bank accounts."
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Beneficiary Name" value={form.remitBeneficiaryName} onChange={set("remitBeneficiaryName")}
            testId="input-remit-beneficiary-name" placeholder="Account holder as registered with the bank" />
          <Field label="Bank Name" value={form.remitBankName} onChange={set("remitBankName")}
            testId="input-remit-bank-name" placeholder="Bank name" />
          <Field label="Bank Branch" value={form.remitBankBranch} onChange={set("remitBankBranch")}
            testId="input-remit-bank-branch" placeholder="Branch name / code" />
          <Field label="Account Number" value={form.remitAccountNumber} onChange={set("remitAccountNumber")}
            testId="input-remit-account-number" placeholder="Account number" />
          <Field label="IBAN" value={form.remitIban} onChange={set("remitIban")}
            testId="input-remit-iban" placeholder="AE00 0000 0000 0000 0000 000" />
          <Field label="SWIFT / BIC" value={form.remitSwift} onChange={set("remitSwift")}
            testId="input-remit-swift" placeholder="XXXXXXXX" />
          <Field label="Correspondent Bank" value={form.remitCorrespondentBank} onChange={set("remitCorrespondentBank")}
            testId="input-remit-correspondent-bank" placeholder="Intermediary bank, if any" />
          <Field label="Remit Currency" value={form.remitCurrency} onChange={set("remitCurrency")}
            testId="input-remit-currency" placeholder="USD" />
          <AreaField label="Bank Address" value={form.remitBankAddress} onChange={set("remitBankAddress")}
            testId="input-remit-bank-address" placeholder={"Bank street address\nCity, Country"} />
          <AreaField label="Remittance Notes" value={form.remitNotes} onChange={set("remitNotes")}
            testId="input-remit-notes" placeholder="e.g. reference format the payer should include" />
        </div>
      </SectionCard>

      {/* 5. Invoice Document */}
      <SectionCard icon={FileText} title="Invoice Document" desc="Numbering, formatting and footer text applied to every generated invoice.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Invoice Number Prefix" value={form.invoiceNumberPrefix} onChange={set("invoiceNumberPrefix")}
            testId="input-invoice-number-prefix" placeholder="C" />
          <Field label="Invoice Number Format" value={form.invoiceNumberFormat} onChange={set("invoiceNumberFormat")}
            testId="input-invoice-number-format" placeholder="{PREFIX}-{YY}{MM}-{SEQ:4}"
            hint={"Tokens: {PREFIX} {YYYY} {YY} {MM} {SEQ:n}. Unset uses the default shown in the placeholder."} />
          <Field label="Decimal Places" value={form.invoiceDecimalPlaces} onChange={set("invoiceDecimalPlaces")}
            testId="input-invoice-decimal-places" type="number" min={0} max={6} placeholder="2" />
          <SelectField label="Date Format" value={form.invoiceDateFormat} onChange={set("invoiceDateFormat")}
            testId="select-invoice-date-format" options={DATE_FORMAT_OPTIONS} />
          <AreaField label="Footer Note" value={form.invoiceFooterNote} onChange={set("invoiceFooterNote")}
            testId="input-invoice-footer-note" placeholder="Printed at the bottom of every invoice" />
          <AreaField label="Terms Note" value={form.invoiceTermsNote} onChange={set("invoiceTermsNote")}
            testId="input-invoice-terms-note" placeholder="Payment terms wording"
            hint="Printed in the payment-instructions terms block." />
        </div>
      </SectionCard>

      {/* 6. Pointer to email delivery — deliberately NOT duplicated here */}
      <div
        className="bg-muted/20 border border-border rounded-xl p-4 text-sm text-muted-foreground flex items-start gap-3"
        data-testid="card-email-delivery-pointer"
      >
        <Send className="h-4 w-4 mt-0.5 shrink-0" />
        <span>
          Email delivery &amp; templates — SMTP credentials and outbound invoice email settings live in
          the{" "}
          <Link to="/settings" className="text-primary underline underline-offset-2 hover:text-primary/80 transition-colors">
            Invoice Email Delivery
          </Link>{" "}
          panel under Settings; this page does not duplicate them.
        </span>
      </div>
    </div>
  );
}

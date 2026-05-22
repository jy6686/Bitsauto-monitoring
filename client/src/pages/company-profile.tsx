import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Loader2, CheckCircle2, AlertTriangle, Building2, ArrowRight,
  Receipt, FileText, ExternalLink, ChevronRight, ChevronLeft,
  Globe, CreditCard, Settings,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const BILLING_CYCLES = [
  { value: '1', label: 'Weekly'    },
  { value: '2', label: 'Bi-Weekly' },
  { value: '3', label: 'Monthly'   },
  { value: '4', label: 'Quarterly' },
  { value: '5', label: 'Annually'  },
];

const COMMON_CURRENCIES = [
  'USD', 'EUR', 'GBP', 'AED', 'AUD', 'CAD', 'CHF', 'CNY',
  'HKD', 'INR', 'JPY', 'MXN', 'NOK', 'NZD', 'SEK', 'SGD',
  'SAR', 'PKR', 'BDT', 'NGN', 'KES', 'EGP',
];

const STEPS = [
  { id: 1, label: 'Company Details',  icon: Building2  },
  { id: 2, label: 'Review & Confirm', icon: FileText   },
  { id: 3, label: 'Done',             icon: CheckCircle2 },
];

type CreationResult = {
  success: boolean;
  partial?: boolean;
  name?: string;
  planName?: string;
  tariffId?: number;
  planId?: number | null;
  alreadyExists?: boolean;
  manualStep?: string;
  sippyPortalLink?: string;
  error?: string;
};

export default function CompanyProfilePage() {
  const queryClient = useQueryClient();

  const [wizardStep, setWizardStep] = useState(1);
  const [companyName, setCompanyName]     = useState('');
  const [currency, setCurrency]           = useState('USD');
  const [billingCycle, setBillingCycle]   = useState('3');
  const [errors, setErrors]               = useState<Record<string, string>>({});

  const [creating, setCreating] = useState(false);
  const [result, setResult]     = useState<CreationResult | null>(null);

  const { data: sippySession } = useQuery<{ active: boolean; username?: string }>({
    queryKey: ['/api/sippy/session'],
    refetchInterval: 30_000,
  });
  const hasSession = sippySession?.active === true;

  const billingLabel = BILLING_CYCLES.find(c => c.value === billingCycle)?.label ?? 'Monthly';

  const fieldCls = "w-full px-3 py-2 text-sm rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors";
  const labelCls = "text-xs font-medium text-muted-foreground mb-1 block";

  function validateStep1() {
    const errs: Record<string, string> = {};
    if (!companyName.trim()) errs.name = 'Company name is required';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function goNext() {
    if (wizardStep === 1 && !validateStep1()) return;
    setWizardStep(s => s + 1);
  }
  function goBack() {
    setWizardStep(s => s - 1);
    setResult(null);
  }

  async function handleCreate() {
    setCreating(true);
    setResult(null);
    try {
      const r = await fetch('/api/sippy/company-profile/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: companyName.trim(),
          currency,
          billingCycle: Number(billingCycle),
        }),
      });
      const res: CreationResult = await r.json();
      setResult(res);
      if (res.success) {
        queryClient.invalidateQueries({ queryKey: ['/api/sippy/billing-plans'] });
        queryClient.invalidateQueries({ queryKey: ['/api/sippy/tariffs'] });
        setWizardStep(3);
      }
    } catch (e: any) {
      setResult({ success: false, error: e.message });
    } finally {
      setCreating(false);
    }
  }

  function resetWizard() {
    setWizardStep(1);
    setCompanyName('');
    setCurrency('USD');
    setBillingCycle('3');
    setResult(null);
    setErrors({});
  }

  return (
    <div className="p-6 max-w-3xl space-y-6">

      {/* ── Page Header ─────────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2.5">
          <Building2 className="w-6 h-6 text-primary" />
          Company Profile Setup
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Creates a matching <strong>Tariff</strong> and <strong>Service Plan</strong> in Sippy,
          then guides you to the New Sippy Account wizard.
        </p>
      </div>

      {/* ── Sippy session guard ─────────────────────────────────────────────── */}
      {!hasSession && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.07] px-4 py-3 flex items-center gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          <span className="text-sm text-amber-300">
            Not connected to Sippy — check{' '}
            <Link href="/settings">
              <a className="underline hover:text-amber-200">Settings → Sippy API</a>
            </Link>.
          </span>
        </div>
      )}

      {/* ── Step indicator ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          const isDone    = wizardStep > s.id;
          const isCurrent = wizardStep === s.id;
          return (
            <div key={s.id} className="flex items-center gap-2">
              <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                isCurrent ? 'bg-blue-500/10 border-blue-500/30 text-blue-400'
                : isDone   ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                :            'border-border text-muted-foreground'
              }`}>
                {isDone
                  ? <CheckCircle2 className="h-3 w-3" />
                  : <Icon className="h-3 w-3" />}
                {s.label}
              </div>
              {i < STEPS.length - 1 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />}
            </div>
          );
        })}
      </div>

      {/* ── Progress bar ────────────────────────────────────────────────────── */}
      <div className="w-full bg-border/30 rounded-full h-1.5">
        <div
          className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
          style={{ width: `${((wizardStep - 1) / (STEPS.length - 1)) * 100}%` }}
        />
      </div>

      {/* ── Step 1: Company Details ─────────────────────────────────────────── */}
      {wizardStep === 1 && (
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="w-4 h-4 text-blue-400" />
              Company Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">

            {/* Company name */}
            <div>
              <label className={labelCls}>
                Company / Display Name <span className="text-rose-400">*</span>
              </label>
              <input
                data-testid="input-company-name"
                value={companyName}
                onChange={e => { setCompanyName(e.target.value); setErrors({}); }}
                placeholder="e.g. Acme Telecom"
                className={`${fieldCls} ${errors.name ? 'border-rose-500' : ''}`}
              />
              {errors.name && (
                <p className="text-[10px] text-rose-400 mt-1">{errors.name}</p>
              )}
              {companyName.trim() && !errors.name && (
                <p className="text-xs text-muted-foreground mt-1">
                  Both the tariff and service plan will be named{' '}
                  <span className="text-foreground font-medium">"{companyName.trim()}"</span>.
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Currency */}
              <div>
                <label className={labelCls}>
                  Tariff Currency <span className="text-rose-400">*</span>
                </label>
                <select
                  data-testid="select-currency"
                  value={currency}
                  onChange={e => setCurrency(e.target.value)}
                  className={fieldCls}
                >
                  {COMMON_CURRENCIES.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              {/* Billing Cycle */}
              <div>
                <label className={labelCls}>Billing Cycle</label>
                <select
                  data-testid="select-billing-cycle"
                  value={billingCycle}
                  onChange={e => setBillingCycle(e.target.value)}
                  className={fieldCls}
                >
                  {BILLING_CYCLES.map(c => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
            </div>

          </CardContent>
        </Card>
      )}

      {/* ── Step 2: Review & Confirm ────────────────────────────────────────── */}
      {wizardStep === 2 && (
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="w-4 h-4 text-blue-400" />
              Review &amp; Confirm
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">

            {/* Summary of what will be created */}
            <div className="rounded-lg border border-border bg-muted/20 p-5 space-y-4">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                What will be created in Sippy
              </p>

              {/* Tariff */}
              <div className="flex items-start gap-3 p-3 rounded-lg bg-card border border-violet-500/20">
                <div className="w-7 h-7 rounded-md bg-violet-500/10 flex items-center justify-center shrink-0 mt-0.5">
                  <Receipt className="w-3.5 h-3.5 text-violet-400" />
                </div>
                <div>
                  <p className="text-sm font-medium">Tariff</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Name: <span className="text-foreground font-medium">"{companyName.trim()}"</span>
                    {' '}· Currency:{' '}
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-violet-500/30 text-violet-400 bg-violet-500/10">
                      {currency}
                    </Badge>
                  </p>
                </div>
              </div>

              {/* Service Plan */}
              <div className="flex items-start gap-3 p-3 rounded-lg bg-card border border-sky-500/20">
                <div className="w-7 h-7 rounded-md bg-sky-500/10 flex items-center justify-center shrink-0 mt-0.5">
                  <FileText className="w-3.5 h-3.5 text-sky-400" />
                </div>
                <div>
                  <p className="text-sm font-medium">Service Plan</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Name: <span className="text-foreground font-medium">"{companyName.trim()}"</span>
                    {' '}· Billing:{' '}
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-sky-500/30 text-sky-400 bg-sky-500/10">
                      {billingLabel}
                    </Badge>
                    {' '}· Calls Duration Round-Up
                  </p>
                </div>
              </div>
            </div>

            {/* Config summary chips */}
            <div className="flex flex-wrap gap-2 text-xs">
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-muted/30">
                <Building2 className="w-3 h-3 text-muted-foreground" />
                <span className="text-muted-foreground">Company:</span>
                <span className="font-medium">{companyName.trim()}</span>
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-muted/30">
                <Globe className="w-3 h-3 text-muted-foreground" />
                <span className="text-muted-foreground">Currency:</span>
                <span className="font-medium">{currency}</span>
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-muted/30">
                <CreditCard className="w-3 h-3 text-muted-foreground" />
                <span className="text-muted-foreground">Billing:</span>
                <span className="font-medium">{billingLabel}</span>
              </div>
            </div>

            {/* Creation progress / error while submitting */}
            {creating && (
              <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 flex items-center gap-2 text-sm text-primary">
                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                Creating tariff and service plan in Sippy…
              </div>
            )}
            {result && !result.success && (
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 flex items-start gap-3 text-sm text-rose-300">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-rose-400" />
                <div className="space-y-1">
                  <p className="font-medium">Creation failed</p>
                  <p className="text-xs text-rose-400/80">{result.error}</p>
                  {result.tariffId && (
                    <p className="text-xs text-rose-400/60">Note: Tariff was already created (ID {result.tariffId}).</p>
                  )}
                </div>
              </div>
            )}

            {/* Create button */}
            <Button
              data-testid="button-create"
              onClick={handleCreate}
              disabled={creating || !hasSession}
              className="w-full gap-2"
            >
              {creating
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating…</>
                : <><Building2 className="w-4 h-4" /> Create Tariff + Service Plan</>}
            </Button>

          </CardContent>
        </Card>
      )}

      {/* ── Step 3: Done ────────────────────────────────────────────────────── */}
      {wizardStep === 3 && result && (
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              Setup Complete
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">

            {/* Success — full creation */}
            {result.success && !result.partial && (
              <div className="space-y-4">
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.07] px-5 py-4">
                  <p className="text-sm font-semibold text-emerald-300 mb-3">
                    {result.alreadyExists
                      ? 'Tariff & Service Plan already exist — reused'
                      : 'Tariff & Service Plan created successfully'}
                  </p>
                  <div className="space-y-2 text-xs text-emerald-300/80">
                    <div className="flex items-center gap-2">
                      <Receipt className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                      <span>
                        Tariff{' '}
                        <span className="font-medium text-emerald-200">"{result.name}"</span>
                        {' '}— ID {result.tariffId}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <FileText className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                      <span>
                        Service Plan{' '}
                        <span className="font-medium text-emerald-200">"{result.planName ?? result.name}"</span>
                        {' '}— ID {result.planId}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Next step: open account wizard */}
                <div className="rounded-lg border border-border bg-card p-4 space-y-3">
                  <p className="text-sm font-medium">Next step: Create a Sippy Account</p>
                  <p className="text-xs text-muted-foreground">
                    The tariff and service plan are ready. You can now open the New Sippy Account wizard to create a customer account that uses this service plan.
                  </p>
                  <Link href="/clients?openWizard=1">
                    <a
                      data-testid="link-open-wizard"
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
                    >
                      New Sippy Account
                      <ArrowRight className="w-4 h-4" />
                    </a>
                  </Link>
                </div>
              </div>
            )}

            {/* Partial — tariff created, plan needs manual step */}
            {result.success && result.partial && (
              <div className="space-y-4">
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.07] px-5 py-4 space-y-3">
                  <p className="text-sm font-semibold text-amber-300">Tariff created — Service Plan needs manual setup</p>
                  <div className="space-y-2 text-xs">
                    <div className="flex items-center gap-2 text-emerald-400">
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      <span>
                        Tariff{' '}
                        <span className="font-medium">"{result.name}"</span>
                        {' '}created — Tariff ID {result.tariffId}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-amber-400">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      <span>Service Plan could not be created automatically — requires Sippy portal</span>
                    </div>
                  </div>
                </div>

                {result.manualStep && (
                  <div className="rounded-md bg-amber-500/10 border border-amber-500/20 px-4 py-3 text-xs text-amber-300 space-y-2">
                    <p className="font-semibold text-amber-200">Steps to complete in Sippy:</p>
                    <div className="space-y-0.5">
                      {result.manualStep.split('\n').filter(Boolean).map((line: string, i: number) => (
                        <p key={i} className={line.match(/^\d+\./) ? 'pl-1' : 'opacity-70'}>{line}</p>
                      ))}
                    </div>
                  </div>
                )}

                {result.sippyPortalLink && (
                  <a
                    data-testid="link-sippy-service-plans"
                    href={result.sippyPortalLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-amber-500/20 border border-amber-500/40 text-amber-200 text-xs font-medium hover:bg-amber-500/30 transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Open Sippy → Add Service Plan
                  </a>
                )}
                <p className="text-xs text-muted-foreground/70">
                  After creating the plan in Sippy, click "Start Over" and run setup again with the same name — it will detect and reuse it automatically.
                </p>
              </div>
            )}

            {/* Start over button */}
            <Button variant="outline" size="sm" onClick={resetWizard} className="gap-1.5" data-testid="button-start-over">
              <Settings className="w-3.5 h-3.5" />
              Start Over
            </Button>

          </CardContent>
        </Card>
      )}

      {/* ── Wizard navigation ───────────────────────────────────────────────── */}
      {wizardStep < 3 && (
        <div className="flex items-center justify-between">
          <Button
            data-testid="btn-wizard-back"
            variant="outline"
            onClick={goBack}
            disabled={wizardStep === 1}
            className="gap-1.5"
          >
            <ChevronLeft className="h-4 w-4" /> Back
          </Button>

          {wizardStep === 1 && (
            <Button
              data-testid="btn-wizard-next"
              onClick={goNext}
              disabled={!hasSession}
              className="gap-1.5"
            >
              Review <ChevronRight className="h-4 w-4" />
            </Button>
          )}

          {/* Step 2 has its own Create button inside the card */}
          {wizardStep === 2 && (
            <Button
              data-testid="btn-wizard-back-step2"
              variant="outline"
              onClick={goBack}
              className="gap-1.5"
            >
              <ChevronLeft className="h-4 w-4" /> Edit Details
            </Button>
          )}
        </div>
      )}

    </div>
  );
}

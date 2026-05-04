import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Loader2, CheckCircle2, AlertTriangle, Building2, ArrowRight,
  Receipt, FileText,
} from "lucide-react";

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
];

export default function CompanyProfilePage() {
  const queryClient = useQueryClient();

  const [companyName, setCompanyName] = useState('');
  const [currency, setCurrency]       = useState('USD');
  const [billingCycle, setBillingCycle] = useState('3');

  const [step, setStep] = useState<'idle' | 'tariff' | 'plan' | 'done'>('idle');
  const [result, setResult] = useState<{
    success: boolean;
    partial?: boolean;
    name?: string;
    tariffId?: number;
    planId?: number | null;
    alreadyExists?: boolean;
    manualStep?: string;
    error?: string;
  } | null>(null);

  const { data: sippySession } = useQuery<{ active: boolean; username?: string }>({
    queryKey: ['/api/sippy/session'],
    refetchInterval: 30_000,
  });
  const hasSession = sippySession?.active === true;

  const creating = step === 'tariff' || step === 'plan';

  async function handleCreate() {
    if (!companyName.trim()) return;
    setResult(null);
    setStep('tariff');
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
      const res = await r.json();
      setResult(res);
      if (res.success) {
        queryClient.invalidateQueries({ queryKey: ['/api/sippy/billing-plans'] });
        queryClient.invalidateQueries({ queryKey: ['/api/sippy/tariffs'] });
      }
    } catch (e: any) {
      setResult({ success: false, error: e.message });
    } finally {
      setStep('done');
    }
  }

  const fieldCls = "w-full px-3 py-2 text-sm rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary/50";
  const labelCls = "text-xs font-medium text-muted-foreground mb-1 block";

  return (
    <div className="p-6 max-w-2xl space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2.5">
          <Building2 className="w-6 h-6 text-primary" />
          Company Profile
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Creates a matching <strong>Tariff</strong> and <strong>Service Plan</strong> in Sippy using the same company name, then you can open the New Sippy Account wizard.
        </p>
      </div>

      {/* Session guard */}
      {!hasSession ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.07] px-4 py-3 text-sm text-amber-300">
          Not connected to Sippy — check <strong>Settings → Sippy API</strong>.
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card p-6 space-y-5">

          {/* Company name */}
          <div>
            <label className={labelCls}>
              Company / Display Name <span className="text-rose-400">*</span>
            </label>
            <input
              data-testid="input-company-name"
              value={companyName}
              onChange={e => { setCompanyName(e.target.value); setResult(null); setStep('idle'); }}
              placeholder="e.g. Acme Telecom"
              className={`${fieldCls} ${!companyName.trim() ? 'border-amber-500/50' : ''}`}
            />
            {companyName.trim() && (
              <p className="text-xs text-muted-foreground mt-1">
                Both the tariff and service plan will be named <span className="text-foreground font-medium">"{companyName.trim()}"</span>.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Currency */}
            <div>
              <label className={labelCls}>Tariff Currency <span className="text-rose-400">*</span></label>
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

          {/* What will be created summary */}
          <div className="rounded-lg border border-border bg-muted/20 px-4 py-3 space-y-2 text-xs text-muted-foreground">
            <p className="font-medium text-foreground text-[11px] uppercase tracking-wide mb-1">Will be created</p>
            <div className="flex items-center gap-2">
              <Receipt className="w-3.5 h-3.5 text-violet-400 shrink-0" />
              <span>
                Tariff <span className="text-foreground font-medium">"{companyName.trim() || '…'}"</span>
                {' '}· currency <span className="text-foreground font-medium">{currency}</span>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <FileText className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              <span>
                Service Plan <span className="text-foreground font-medium">"{companyName.trim() || '…'}"</span>
                {' '}· {BILLING_CYCLES.find(c => c.value === billingCycle)?.label}
                {' '}· Calls Duration Round-Up
              </span>
            </div>
          </div>

          {/* Progress indicator while creating */}
          {creating && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 space-y-2 text-sm">
              <div className="flex items-center gap-2 text-primary">
                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                <span>
                  {step === 'tariff' ? 'Step 1/2 — Creating tariff in Sippy…' : 'Step 2/2 — Creating service plan…'}
                </span>
              </div>
            </div>
          )}

          {/* Create button */}
          <button
            data-testid="button-create"
            onClick={handleCreate}
            disabled={!companyName.trim() || creating}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {creating
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Building2 className="w-4 h-4" />}
            {creating ? 'Creating…' : 'Create Tariff + Service Plan'}
          </button>

          {/* Result banner */}
          {step === 'done' && result && (
            <div className={`rounded-lg px-4 py-3 text-sm flex items-start gap-3 ${
              !result.success
                ? 'bg-rose-500/10 border border-rose-500/30 text-rose-300'
                : result.partial
                  ? 'bg-amber-500/10 border border-amber-500/30 text-amber-300'
                  : 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
            }`}>
              {!result.success
                ? <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-rose-400" />
                : result.partial
                  ? <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-400" />
                  : <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-400" />}
              <div className="space-y-1.5 w-full">
                {result.success && !result.partial && (
                  <>
                    <p className="font-medium text-emerald-200">
                      {result.alreadyExists ? 'Tariff &amp; Service Plan already exist — reused' : 'Tariff &amp; Service Plan created'}
                    </p>
                    <div className="text-xs text-emerald-300/80 space-y-0.5">
                      <p>
                        <Receipt className="w-3 h-3 inline mr-1 text-violet-400" />
                        Tariff <span className="font-medium text-emerald-200">"{result.name}"</span> — ID {result.tariffId}
                      </p>
                      <p>
                        <FileText className="w-3 h-3 inline mr-1 text-sky-400" />
                        Service Plan <span className="font-medium text-emerald-200">"{result.name}"</span> — ID {result.planId}
                      </p>
                    </div>
                    <Link href="/clients?openWizard=1">
                      <a
                        data-testid="link-open-wizard"
                        className="inline-flex items-center gap-1.5 mt-2 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
                      >
                        New Sippy Account <ArrowRight className="w-3.5 h-3.5" />
                      </a>
                    </Link>
                  </>
                )}

                {result.success && result.partial && (
                  <>
                    <p className="font-medium text-amber-200">Tariff created — Service Plan needs manual setup</p>
                    <div className="text-xs text-amber-300/80 space-y-1">
                      <p className="flex items-center gap-1.5">
                        <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                        Tariff <span className="font-medium text-amber-200">"{result.name}"</span> created — Tariff ID {result.tariffId}
                      </p>
                      <p className="flex items-center gap-1.5">
                        <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
                        Service Plan could not be created automatically (Sippy admin portal not accessible from this server)
                      </p>
                    </div>
                    {result.manualStep && (
                      <div className="mt-2 rounded-md bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-xs text-amber-300/90 leading-relaxed">
                        <p className="font-semibold text-amber-200 mb-0.5">Manual step required:</p>
                        <p>{result.manualStep}</p>
                      </div>
                    )}
                    <p className="text-xs text-amber-300/60 mt-1">
                      Once the service plan is created, re-run this with the same name — it will detect the existing plan automatically.
                    </p>
                  </>
                )}

                {!result.success && (
                  <div className="space-y-2">
                    <p>{result.error}</p>
                    {result.tariffId && (
                      <p className="text-xs text-rose-300/70">
                        Note: Tariff was already created (ID {result.tariffId}).
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
}

import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Loader2, CheckCircle2, AlertTriangle, Building2, ArrowRight, RefreshCw,
} from "lucide-react";

const BILLING_CYCLES = [
  { value: '1', label: 'Weekly'     },
  { value: '2', label: 'Bi-Weekly'  },
  { value: '3', label: 'Monthly'    },
  { value: '4', label: 'Quarterly'  },
  { value: '5', label: 'Annually'   },
];

export default function CompanyProfilePage() {
  const queryClient = useQueryClient();

  const [companyName, setBillingName] = useState('');
  const [billingCycle, setBillingCycle] = useState('3');
  const [tariffId, setTariffId] = useState('');
  const [tariffManual, setTariffManual] = useState(false);
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<{
    success: boolean; planId?: number; planName?: string; error?: string;
  } | null>(null);

  const { data: sippySession } = useQuery<{ active: boolean; username?: string }>({
    queryKey: ['/api/sippy/session'],
    refetchInterval: 30_000,
  });
  const hasSession = sippySession?.active === true;

  const { data: tariffListRaw, isLoading: tariffListLoading, refetch: refetchTariffs } = useQuery<
    Array<{ iTariff: number; name: string; currency: string }> | { tariffs: []; error: string }
  >({
    queryKey: ['/api/sippy/tariffs'],
    queryFn: () => fetch('/api/sippy/tariffs').then(r => r.json()),
    staleTime: 5 * 60_000,
    enabled: hasSession,
  });
  const tariffList: Array<{ iTariff: number; name: string; currency: string }> =
    Array.isArray(tariffListRaw) ? tariffListRaw : [];

  useEffect(() => {
    if (tariffManual || !companyName.trim() || !tariffList.length) return;
    const needle = companyName.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    const exact = tariffList.find(t => t.name.toLowerCase().replace(/[^a-z0-9]/g, '') === needle);
    const partial = tariffList.find(t => {
      const n = t.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      return n.includes(needle) || needle.includes(n);
    });
    const match = exact ?? partial;
    if (match) setTariffId(String(match.iTariff));
    else setTariffId('');
  }, [companyName, tariffList, tariffManual]);

  async function handleCreatePlan() {
    if (!companyName.trim() || !tariffId) return;
    setCreating(true);
    setResult(null);
    try {
      const r = await fetch('/api/sippy/service-plans/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planName: companyName.trim(),
          iTariff: Number(tariffId),
          billingCycle: Number(billingCycle),
        }),
      });
      const res = await r.json();
      setResult(res);
      if (res.success) {
        queryClient.invalidateQueries({ queryKey: ['/api/sippy/billing-plans'] });
      }
    } catch (e: any) {
      setResult({ success: false, error: e.message });
    } finally {
      setCreating(false);
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
          Create a Sippy Service Plan before onboarding a new account. Once done, open the New Sippy Account wizard.
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
            <label className={labelCls}>Company / Display Name <span className="text-rose-400">*</span></label>
            <input
              data-testid="input-company-name"
              value={companyName}
              onChange={e => setBillingName(e.target.value)}
              placeholder="e.g. Acme Telecom"
              className={`${fieldCls} ${!companyName.trim() ? 'border-amber-500/50' : ''}`}
            />
            {!companyName.trim() && (
              <p className="text-xs text-amber-400 mt-1">Required — used as the Service Plan name.</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
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

            {/* Basic Tariff */}
            <div>
              <label className={labelCls}>
                Basic Tariff <span className="text-rose-400">*</span>
                {!tariffManual && companyName.trim() && tariffId && (
                  <span className="ml-2 text-[10px] text-violet-400 font-normal normal-case tracking-normal">
                    auto-matched by name
                  </span>
                )}
              </label>
              {tariffListLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading tariffs…
                </div>
              ) : tariffList.length === 0 ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-amber-400">No tariffs found</span>
                  <button onClick={() => refetchTariffs()} className="text-xs text-primary hover:underline flex items-center gap-1">
                    <RefreshCw className="w-3 h-3" /> Retry
                  </button>
                </div>
              ) : (
                <select
                  data-testid="select-tariff"
                  value={tariffId}
                  onChange={e => { setTariffId(e.target.value); setTariffManual(true); }}
                  className={`${fieldCls} ${!tariffId ? 'border-amber-500/50' : ''}`}
                >
                  <option value="">— Select tariff —</option>
                  {tariffList.map(t => (
                    <option key={t.iTariff} value={String(t.iTariff)}>
                      {t.name}{t.currency ? ` (${t.currency})` : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* Fixed settings summary */}
          <div className="rounded-lg border border-border bg-muted/20 px-4 py-3 grid grid-cols-2 gap-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-muted border border-border text-foreground font-medium">Calls Duration</span>
              Round-Up
            </div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-muted border border-border text-foreground font-medium">Billing Cycle</span>
              {BILLING_CYCLES.find(c => c.value === billingCycle)?.label}
            </div>
          </div>

          {/* Create button */}
          <button
            data-testid="button-create-plan"
            onClick={handleCreatePlan}
            disabled={!companyName.trim() || !tariffId || creating}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {creating
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Building2 className="w-4 h-4" />}
            {creating ? 'Creating Service Plan…' : 'Create Service Plan in Sippy'}
          </button>

          {/* Result banner */}
          {result && (
            <div className={`rounded-lg px-4 py-3 text-sm flex items-start gap-3 ${
              result.success
                ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
                : 'bg-rose-500/10 border border-rose-500/30 text-rose-300'
            }`}>
              {result.success
                ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-400" />
                : <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-rose-400" />}
              <div className="space-y-1.5">
                {result.success ? (
                  <>
                    <p className="font-medium text-emerald-200">Service Plan created successfully</p>
                    <p className="text-xs text-emerald-300/80">
                      "{result.planName}" (ID {result.planId}) is ready in Sippy.
                    </p>
                    <Link href="/clients?openWizard=1">
                      <a
                        data-testid="link-open-wizard"
                        className="inline-flex items-center gap-1.5 mt-1 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
                      >
                        New Sippy Account <ArrowRight className="w-3.5 h-3.5" />
                      </a>
                    </Link>
                  </>
                ) : (
                  <p>{result.error}</p>
                )}
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
}
